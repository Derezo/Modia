import express from 'express';
import { query } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { RACES, CLASSES, GENDERS, MAX_PARTY_SIZE, calculateStats, STARTING_EXPERIENCE } from '../config/constants.js';
import * as staminaService from '../services/staminaService.js';
import { discoverNodeAndAdjacent } from '../services/world/discoveryService.js';
import {
  characterCreateLimiter,
  characterDeleteLimiter,
  characterUpdateLimiter
} from '../middleware/characterRateLimiter.js';

const router = express.Router();

// Starter equipment by class (weapon, armor, accessory)
const STARTER_EQUIPMENT = {
  warrior: ['Trainee Sword', 'Trainee Tunic', 'Warrior\'s Pendant'],
  wizard: ['Novice Wand', 'Student Robe', 'Mage\'s Crystal'],
  monk: ['Initiate Wraps', 'Initiate Gi', 'Monk\'s Beads'],
  chemist: ['Mixing Rod', 'Alchemist Coat', 'Reagent Pouch']
};

// Starter skills by class (first skill in each class tree)
const STARTER_SKILLS = {
  warrior: ['power_strike'],
  wizard: ['fireball'],
  monk: ['palm_strike'],
  chemist: ['brew_potion']
};

// GET /api/characters - List all user's characters
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, name, race, class, gender, level, experience, spent_xp,
            hp_current, hp_max, mp_current, mp_max,
            strength, intelligence, agility, vitality, luck,
            party_slot, current_node_id, in_battle, created_at,
            stamina, stamina_updated_at, max_stamina
     FROM characters
     WHERE user_id = $1
     ORDER BY party_slot ASC NULLS LAST, created_at ASC`,
    [req.user.userId]
  );

  // Auto-repair: Ensure at least one character has party_slot = 1
  // This handles legacy characters created before auto-assignment was added
  if (result.rows.length > 0 && !result.rows.some(c => c.party_slot === 1)) {
    const firstChar = result.rows[0];
    await query(
      'UPDATE characters SET party_slot = 1 WHERE id = $1',
      [firstChar.id]
    );
    firstChar.party_slot = 1;
  }

  // Calculate current stamina with regeneration for each character
  const characters = result.rows.map(char => ({
    ...char,
    stamina_current: staminaService.calculateCurrentStamina(char)
  }));

  // Prevent browser caching to avoid showing stale character lists across sessions
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  res.json({ characters });
}));

// POST /api/characters - Create new character
router.post('/', authenticate, characterCreateLimiter, asyncHandler(async (req, res) => {
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

  if (parseInt(countResult.rows[0].count, 10) >= MAX_PARTY_SIZE) {
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

  // Look up home region by race for spawn location
  const regionResult = await query(
    'SELECT id, castle_node_id FROM world_regions WHERE race = $1',
    [race]
  );

  if (regionResult.rows.length === 0) {
    throw new AppError('Invalid race for spawn location', 400);
  }

  const region = regionResult.rows[0];
  const spawnNodeId = region.castle_node_id;
  const homeRegionId = region.id;

  // Insert character at racial homeland castle with starting experience
  // Note: Gold is stored at user level (users.gold), not per-character
  const result = await query(
    `INSERT INTO characters (
       user_id, name, race, class, gender, level, experience,
       hp_current, hp_max, mp_current, mp_max,
       strength, intelligence, agility, vitality, luck,
       party_slot, current_node_id, home_region_id
     )
     VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $7, $8, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING *`,
    [
      req.user.userId, name, race, characterClass, gender,
      STARTING_EXPERIENCE,
      stats.hpMax, stats.mpMax,
      stats.strength, stats.intelligence, stats.agility, stats.vitality, stats.luck,
      nextSlot <= MAX_PARTY_SIZE ? nextSlot : null,
      spawnNodeId,
      homeRegionId
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

  // Grant starter skills
  const starterSkills = STARTER_SKILLS[characterClass];
  if (starterSkills) {
    for (const skillId of starterSkills) {
      await query(
        `INSERT INTO character_skills (character_id, skill_id, level)
         VALUES ($1, $2, 1)
         ON CONFLICT (character_id, skill_id) DO NOTHING`,
        [character.id, skillId]
      );
    }
  }

  // Initialize node discovery for character's spawn location
  // This ensures the racial homeland castle and adjacent nodes are visible on the world map
  await discoverNodeAndAdjacent(req.user.userId, spawnNodeId);

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

  const character = {
    ...result.rows[0],
    stamina_current: staminaService.calculateCurrentStamina(result.rows[0])
  };

  res.json({ character });
}));

// GET /api/characters/:id/stamina - Get detailed stamina info for a character
router.get('/:id/stamina', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Verify ownership
  const ownership = await query(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [id, req.user.userId]
  );

  if (ownership.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  const staminaInfo = await staminaService.getStaminaInfo(parseInt(id, 10));
  res.json({ stamina: staminaInfo });
}));

// PUT /api/characters/:id - Update character (name only for now)
router.put('/:id', authenticate, characterUpdateLimiter, asyncHandler(async (req, res) => {
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
router.delete('/:id', authenticate, characterDeleteLimiter, asyncHandler(async (req, res) => {
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

// POST /api/characters/respawn - Return all party characters to home region castle
router.post('/respawn', authenticate, asyncHandler(async (req, res) => {
  // Get party leader to determine home region
  const leaderResult = await query(
    `SELECT c.id, c.home_region_id, wr.castle_node_id, c.in_battle
     FROM characters c
     LEFT JOIN world_regions wr ON c.home_region_id = wr.id
     WHERE c.user_id = $1 AND c.party_slot = 1`,
    [req.user.userId]
  );

  if (leaderResult.rows.length === 0) {
    throw new AppError('No party leader found', 404);
  }

  const leader = leaderResult.rows[0];

  if (leader.in_battle) {
    throw new AppError('Cannot respawn while in battle', 400);
  }

  if (!leader.home_region_id || !leader.castle_node_id) {
    throw new AppError('Character has no home region set', 400);
  }

  // Move all party members to the party leader's home castle
  const result = await query(
    `UPDATE characters
     SET current_node_id = $1
     WHERE user_id = $2 AND party_slot IS NOT NULL
     RETURNING id, name, current_node_id`,
    [leader.castle_node_id, req.user.userId]
  );

  res.json({
    message: 'Party respawned at home castle',
    nodeId: leader.castle_node_id,
    characters: result.rows
  });
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
      max: char.hp_max + (parseInt(char.equip_hp, 10) || 0),
      base: char.hp_max,
      bonus: parseInt(char.equip_hp, 10) || 0
    },
    mp: {
      current: char.mp_current,
      max: char.mp_max + (parseInt(char.equip_mp, 10) || 0),
      base: char.mp_max,
      bonus: parseInt(char.equip_mp, 10) || 0
    },
    strength: char.strength + (parseInt(char.equip_strength, 10) || 0),
    intelligence: char.intelligence + (parseInt(char.equip_intelligence, 10) || 0),
    agility: char.agility + (parseInt(char.equip_agility, 10) || 0),
    vitality: char.vitality + (parseInt(char.equip_vitality, 10) || 0),
    luck: char.luck + (parseInt(char.equip_luck, 10) || 0),
    attack: parseInt(char.equip_attack, 10) || 0,
    defense: parseInt(char.equip_defense, 10) || 0,
    magicAttack: parseInt(char.equip_magic_attack, 10) || 0,
    magicDefense: parseInt(char.equip_magic_defense, 10) || 0,
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
      strength: parseInt(char.equip_strength, 10) || 0,
      intelligence: parseInt(char.equip_intelligence, 10) || 0,
      agility: parseInt(char.equip_agility, 10) || 0,
      vitality: parseInt(char.equip_vitality, 10) || 0,
      luck: parseInt(char.equip_luck, 10) || 0,
      hp: parseInt(char.equip_hp, 10) || 0,
      mp: parseInt(char.equip_mp, 10) || 0,
      attack: parseInt(char.equip_attack, 10) || 0,
      defense: parseInt(char.equip_defense, 10) || 0,
      magicAttack: parseInt(char.equip_magic_attack, 10) || 0,
      magicDefense: parseInt(char.equip_magic_defense, 10) || 0
    }
  };

  res.json({ stats: finalStats });
}));

export default router;
