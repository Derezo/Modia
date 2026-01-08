const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { RACES, CLASSES, GENDERS, MAX_PARTY_SIZE, calculateStats } = require('../config/constants');

// Starter equipment by class (weapon, armor, accessory)
const STARTER_EQUIPMENT = {
  warrior: ['Trainee Sword', 'Trainee Tunic', "Warrior's Pendant"],
  wizard: ['Novice Wand', 'Student Robe', "Mage's Crystal"],
  monk: ['Initiate Wraps', 'Initiate Gi', "Monk's Beads"],
  chemist: ['Mixing Rod', 'Alchemist Coat', 'Reagent Pouch']
};

// GET /api/characters - List all user's characters
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, name, race, class, gender, level, experience,
            hp_current, hp_max, mp_current, mp_max,
            strength, intelligence, agility, vitality, luck,
            party_slot, current_node_id, in_battle, created_at
     FROM characters
     WHERE user_id = $1
     ORDER BY party_slot ASC NULLS LAST, created_at ASC`,
    [req.user.userId]
  );

  res.json({ characters: result.rows });
}));

// POST /api/characters - Create new character
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const { name, race, characterClass, gender = 'other' } = req.body;

  // Validation
  if (!name || !race || !characterClass) {
    throw new AppError('Name, race, and class are required', 400);
  }

  if (name.length < 2 || name.length > 24) {
    throw new AppError('Character name must be between 2 and 24 characters', 400);
  }

  if (!Object.values(RACES).includes(race)) {
    throw new AppError(`Invalid race. Must be one of: ${Object.values(RACES).join(', ')}`, 400);
  }

  if (!Object.values(CLASSES).includes(characterClass)) {
    throw new AppError(`Invalid class. Must be one of: ${Object.values(CLASSES).join(', ')}`, 400);
  }

  if (!Object.values(GENDERS).includes(gender)) {
    throw new AppError(`Invalid gender. Must be one of: ${Object.values(GENDERS).join(', ')}`, 400);
  }

  // Check character limit
  const countResult = await query(
    'SELECT COUNT(*) FROM characters WHERE user_id = $1',
    [req.user.userId]
  );

  if (parseInt(countResult.rows[0].count) >= MAX_PARTY_SIZE) {
    throw new AppError(`Cannot have more than ${MAX_PARTY_SIZE} characters`, 400);
  }

  // Calculate initial stats
  const stats = calculateStats(race, characterClass, 1);

  // Find next available party slot
  const slotResult = await query(
    `SELECT COALESCE(MAX(party_slot), 0) + 1 as next_slot
     FROM characters WHERE user_id = $1 AND party_slot IS NOT NULL`,
    [req.user.userId]
  );
  const nextSlot = Math.min(slotResult.rows[0].next_slot, MAX_PARTY_SIZE);

  // Insert character
  const result = await query(
    `INSERT INTO characters (
       user_id, name, race, class, gender, level, experience,
       hp_current, hp_max, mp_current, mp_max,
       strength, intelligence, agility, vitality, luck,
       party_slot, current_node_id
     )
     VALUES ($1, $2, $3, $4, $5, 1, 0, $6, $6, $7, $7, $8, $9, $10, $11, $12, $13,
             (SELECT id FROM world_nodes WHERE node_type = 'castle' LIMIT 1))
     RETURNING *`,
    [
      req.user.userId, name, race, characterClass, gender,
      stats.hpMax, stats.mpMax,
      stats.strength, stats.intelligence, stats.agility, stats.vitality, stats.luck,
      nextSlot <= MAX_PARTY_SIZE ? nextSlot : null
    ]
  );

  const character = result.rows[0];

  // Grant starter equipment
  const starterItems = STARTER_EQUIPMENT[characterClass];
  if (starterItems) {
    for (const itemName of starterItems) {
      await query(
        `INSERT INTO character_items (character_id, item_template_id, quantity, is_equipped, equipped_slot)
         SELECT $1, id, 1, true, equipment_slot
         FROM item_templates WHERE name = $2`,
        [character.id, itemName]
      );
    }
  }

  res.status(201).json({ character });
}));

// GET /api/characters/:id - Get character details
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await query(
    `SELECT c.*, wn.name as current_node_name, wn.node_type as current_node_type
     FROM characters c
     LEFT JOIN world_nodes wn ON c.current_node_id = wn.id
     WHERE c.id = $1 AND c.user_id = $2`,
    [id, req.user.userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  res.json({ character: result.rows[0] });
}));

// PUT /api/characters/:id - Update character (name only for now)
router.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name) {
    throw new AppError('Name is required', 400);
  }

  if (name.length < 2 || name.length > 24) {
    throw new AppError('Character name must be between 2 and 24 characters', 400);
  }

  const result = await query(
    `UPDATE characters SET name = $1
     WHERE id = $2 AND user_id = $3
     RETURNING *`,
    [name, id, req.user.userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  res.json({ character: result.rows[0] });
}));

// DELETE /api/characters/:id - Delete character
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Check if character is in battle
  const checkResult = await query(
    'SELECT in_battle FROM characters WHERE id = $1 AND user_id = $2',
    [id, req.user.userId]
  );

  if (checkResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  if (checkResult.rows[0].in_battle) {
    throw new AppError('Cannot delete character while in battle', 400);
  }

  await query('DELETE FROM characters WHERE id = $1 AND user_id = $2', [id, req.user.userId]);

  res.json({ message: 'Character deleted successfully' });
}));

// GET /api/characters/:id/stats - Get computed stats with equipment
router.get('/:id/stats', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Get base character stats with equipped item bonuses
  // Combines: base stats + item_templates.stat_bonuses + character_items.modifications
  const charResult = await query(
    `SELECT c.*,
            COALESCE(SUM(
              COALESCE((it.stat_bonuses->>'strength')::int, 0) +
              COALESCE((ci.modifications->>'strength')::int, 0)
            ), 0) as equip_strength,
            COALESCE(SUM(
              COALESCE((it.stat_bonuses->>'intelligence')::int, 0) +
              COALESCE((ci.modifications->>'intelligence')::int, 0)
            ), 0) as equip_intelligence,
            COALESCE(SUM(
              COALESCE((it.stat_bonuses->>'agility')::int, 0) +
              COALESCE((ci.modifications->>'agility')::int, 0)
            ), 0) as equip_agility,
            COALESCE(SUM(
              COALESCE((it.stat_bonuses->>'vitality')::int, 0) +
              COALESCE((ci.modifications->>'vitality')::int, 0)
            ), 0) as equip_vitality,
            COALESCE(SUM(
              COALESCE((it.stat_bonuses->>'luck')::int, 0) +
              COALESCE((ci.modifications->>'luck')::int, 0)
            ), 0) as equip_luck,
            COALESCE(SUM(
              COALESCE((it.stat_bonuses->>'hp')::int, 0) +
              COALESCE((ci.modifications->>'hp_max')::int, 0)
            ), 0) as equip_hp,
            COALESCE(SUM(
              COALESCE((it.stat_bonuses->>'mp')::int, 0) +
              COALESCE((ci.modifications->>'mp_max')::int, 0)
            ), 0) as equip_mp,
            COALESCE(SUM(
              COALESCE((it.stat_bonuses->>'attack')::int, 0) +
              COALESCE((ci.modifications->>'attack')::int, 0)
            ), 0) as equip_attack,
            COALESCE(SUM(
              COALESCE((it.stat_bonuses->>'defense')::int, 0) +
              COALESCE((ci.modifications->>'defense')::int, 0)
            ), 0) as equip_defense,
            COALESCE(SUM(
              COALESCE((it.stat_bonuses->>'magic_attack')::int, 0) +
              COALESCE((ci.modifications->>'magic_attack')::int, 0)
            ), 0) as equip_magic_attack,
            COALESCE(SUM(
              COALESCE((it.stat_bonuses->>'magic_defense')::int, 0) +
              COALESCE((ci.modifications->>'magic_defense')::int, 0)
            ), 0) as equip_magic_defense
     FROM characters c
     LEFT JOIN character_items ci ON c.id = ci.character_id AND ci.equipped_slot IS NOT NULL
     LEFT JOIN item_templates it ON ci.item_template_id = it.id
     WHERE c.id = $1 AND c.user_id = $2
     GROUP BY c.id`,
    [id, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  const char = charResult.rows[0];

  // Calculate final stats (base + equipment bonuses)
  const finalStats = {
    id: char.id,
    name: char.name,
    race: char.race,
    class: char.class,
    level: char.level,
    experience: char.experience,
    hp: {
      current: char.hp_current,
      max: char.hp_max + (parseInt(char.equip_hp) || 0),
      base: char.hp_max,
      bonus: parseInt(char.equip_hp) || 0
    },
    mp: {
      current: char.mp_current,
      max: char.mp_max + (parseInt(char.equip_mp) || 0),
      base: char.mp_max,
      bonus: parseInt(char.equip_mp) || 0
    },
    strength: char.strength + (parseInt(char.equip_strength) || 0),
    intelligence: char.intelligence + (parseInt(char.equip_intelligence) || 0),
    agility: char.agility + (parseInt(char.equip_agility) || 0),
    vitality: char.vitality + (parseInt(char.equip_vitality) || 0),
    luck: char.luck + (parseInt(char.equip_luck) || 0),
    attack: parseInt(char.equip_attack) || 0,
    defense: parseInt(char.equip_defense) || 0,
    magicAttack: parseInt(char.equip_magic_attack) || 0,
    magicDefense: parseInt(char.equip_magic_defense) || 0,
    // Include base stats for comparison
    base: {
      strength: char.strength,
      intelligence: char.intelligence,
      agility: char.agility,
      vitality: char.vitality,
      luck: char.luck,
      hpMax: char.hp_max,
      mpMax: char.mp_max
    },
    // Include equipment bonuses breakdown
    equipmentBonuses: {
      strength: parseInt(char.equip_strength) || 0,
      intelligence: parseInt(char.equip_intelligence) || 0,
      agility: parseInt(char.equip_agility) || 0,
      vitality: parseInt(char.equip_vitality) || 0,
      luck: parseInt(char.equip_luck) || 0,
      hp: parseInt(char.equip_hp) || 0,
      mp: parseInt(char.equip_mp) || 0,
      attack: parseInt(char.equip_attack) || 0,
      defense: parseInt(char.equip_defense) || 0,
      magicAttack: parseInt(char.equip_magic_attack) || 0,
      magicDefense: parseInt(char.equip_magic_defense) || 0
    }
  };

  res.json({ stats: finalStats });
}));

module.exports = router;
