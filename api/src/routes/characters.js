import express from 'express';
import { query, withTransaction } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { RACES, CLASSES, GENDERS, MAX_PARTY_SIZE, calculateStats, STARTING_EXPERIENCE, RACE_BASE_STATS } from '../config/constants.js';
import { validateCharacterName } from '../utils/nameValidation.js';
import * as staminaService from '../services/staminaService.js';
import { assertNoUnsettledFishingSession } from '../services/fishingTravelGuard.js';
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

/**
 * Respawn a party after serializing against battle lifecycle writes.
 *
 * Locking every owned character shares the same row-lock boundary used by
 * battle creation. The battles table remains authoritative, while in_battle
 * also blocks movement when terminal cleanup has not completed yet.
 */
export async function respawnPartyWithClient(client, userId) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('respawnPartyWithClient requires a pg client');
  }

  const userResult = await client.query(
    'SELECT id FROM users WHERE id = $1 FOR UPDATE',
    [userId]
  );
  if (!userResult.rows[0]) {
    throw new AppError('User not found', 404);
  }

  const charactersResult = await client.query(
    `SELECT c.id, c.party_slot, c.home_region_id, wr.castle_node_id, c.in_battle
     FROM characters c
     LEFT JOIN world_regions wr ON c.home_region_id = wr.id
     WHERE c.user_id = $1
     ORDER BY CASE WHEN c.party_slot = 1 THEN 0 ELSE 1 END, c.id
     FOR UPDATE OF c`,
    [userId]
  );
  const leader = charactersResult.rows.find(character => character.party_slot === 1);
  if (!leader) {
    throw new AppError('No party leader found', 404);
  }

  const activeBattleResult = await client.query(
    `SELECT id
     FROM battles
     WHERE status = 'active'
       AND (
         player1_id = $1
         OR player2_id = $1
         OR EXISTS (
           SELECT 1
           FROM battle_players
           WHERE battle_players.battle_id = battles.id
             AND battle_players.user_id = $1
         )
       )
     LIMIT 1`,
    [userId]
  );
  if (
    activeBattleResult.rows.length > 0
    || charactersResult.rows.some(character => character.in_battle)
  ) {
    throw new AppError('Cannot respawn while in battle', 400);
  }
  await assertNoUnsettledFishingSession(client, userId);

  if (!leader.home_region_id || !leader.castle_node_id) {
    throw new AppError('Character has no home region set', 400);
  }

  const result = await client.query(
    `UPDATE characters
     SET current_node_id = $1
     WHERE user_id = $2 AND party_slot IS NOT NULL
     RETURNING id, name, current_node_id`,
    [leader.castle_node_id, userId]
  );
  return {
    nodeId: leader.castle_node_id,
    characters: result.rows
  };
}

/**
 * Delete a character while sharing the user-wide lifecycle lock used by
 * battle creation. The target checks and delete must all use this client.
 */
async function deleteCharacterWithClient(client, userId, characterId) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('deleteCharacterWithClient requires a pg client');
  }

  const charactersResult = await client.query(
    `SELECT id, in_battle
     FROM characters
     WHERE user_id = $1
     ORDER BY id
     FOR UPDATE`,
    [userId]
  );
  const character = charactersResult.rows.find(
    candidate => String(candidate.id) === String(characterId)
  );
  if (!character) {
    throw new AppError('Character not found', 404);
  }
  if (character.in_battle) {
    throw new AppError('Cannot delete character while in battle', 400);
  }

  const oldestResult = await client.query(
    `SELECT id
     FROM characters
     WHERE user_id = $1
     ORDER BY created_at ASC, id ASC
     LIMIT 1`,
    [userId]
  );
  if (String(oldestResult.rows[0]?.id) === String(characterId)) {
    throw new AppError('Cannot delete main character', 400);
  }

  const deleteResult = await client.query(
    'DELETE FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, userId]
  );
  if (deleteResult.rowCount !== 1) {
    throw new AppError('Character not found', 404);
  }
}

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

  // Calculate current stamina with the user's active shrine regeneration
  // windows. The batch service keeps this summary consistent with the
  // dedicated stamina endpoint and world-travel checks.
  const staminaByCharacter = await staminaService.getPartyStaminaInfo(
    result.rows.map(character => character.id)
  );
  const characters = result.rows.map(char => ({
    ...char,
    stamina_current: staminaByCharacter[char.id]?.current
      ?? staminaService.calculateCurrentStamina(char)
  }));

  // Prevent browser caching to avoid showing stale character lists across sessions
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  res.json({ characters });
}));

// POST /api/characters - Create new character
router.post('/', authenticate, characterCreateLimiter, asyncHandler(async (req, res) => {
  const { name: rawName, race, characterClass, gender = 'other' } = req.body;

  // Validation
  if (!rawName || !race || !characterClass) {
    throw new AppError('Name, race, and class are required', 400);
  }

  // Validate and sanitize character name (throws AppError on invalid)
  const name = validateCharacterName(rawName);

  if (!Object.values(RACES).includes(race)) {
    throw new AppError(`Invalid race. Must be one of: ${Object.values(RACES).join(', ')}`, 400);
  }

  if (!Object.values(CLASSES).includes(characterClass)) {
    throw new AppError(`Invalid class. Must be one of: ${Object.values(CLASSES).join(', ')}`, 400);
  }

  if (!Object.values(GENDERS).includes(gender)) {
    throw new AppError(`Invalid gender. Must be one of: ${Object.values(GENDERS).join(', ')}`, 400);
  }

  // Block manual character creation after first character
  // Party members must be recruited through guild recruitment
  const existingCount = await query(
    'SELECT COUNT(*) FROM characters WHERE user_id = $1',
    [req.user.userId]
  );
  if (parseInt(existingCount.rows[0].count, 10) > 0) {
    throw new AppError('Cannot create characters manually. Use guild recruitment.', 400);
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

  if (!spawnNodeId) {
    console.error(`[CharacterCreate] ERROR: No castle_node_id for race ${race} in world_regions`);
    throw new AppError('Unable to determine spawn location', 500);
  }

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

  // Grant starting trait based on race/class combination
  const startingTraitResult = await query(
    'SELECT trait_id FROM starting_trait_mappings WHERE race = $1 AND class = $2',
    [race, characterClass]
  );

  if (startingTraitResult.rows.length > 0) {
    const traitId = startingTraitResult.rows[0].trait_id;
    await query(
      `INSERT INTO character_traits (character_id, trait_id)
       VALUES ($1, $2)
       ON CONFLICT (character_id, trait_id) DO NOTHING`,
      [character.id, traitId]
    );
    console.log(`[CharacterCreate] Assigned starting trait ${traitId} to character ${character.id}`);
  }

  // Initialize node discovery for character's spawn location
  // This ensures the racial homeland castle and adjacent nodes are visible on the world map
  console.log(`[CharacterCreate] Discovering spawn node for user ${req.user.userId}: nodeId=${spawnNodeId}`);

  try {
    await discoverNodeAndAdjacent(req.user.userId, spawnNodeId);

    // Verify discovery succeeded
    const verifyResult = await query(
      'SELECT COUNT(*) as count FROM user_node_discovery WHERE user_id = $1',
      [req.user.userId]
    );
    console.log(`[CharacterCreate] Discovery complete: user ${req.user.userId} now has ${verifyResult.rows[0].count} discovered nodes`);

    if (parseInt(verifyResult.rows[0].count, 10) === 0) {
      console.error(`[CharacterCreate] WARNING: Discovery produced 0 nodes for user ${req.user.userId}, spawnNodeId=${spawnNodeId}`);
    }
  } catch (err) {
    console.error(`[CharacterCreate] Discovery FAILED for user ${req.user.userId}, spawnNodeId=${spawnNodeId}:`, err.message);
    // Don't throw - character was created, discovery failure shouldn't block
  }

  res.status(201).json({ character });
}));

// Racial trait display names (for preview)
const RACIAL_TRAIT_NAMES = {
  exp_bonus: 'Quick Learner',
  mp_regen: 'Arcane Flow',
  gold_bonus: 'Lucky Find',
  lifesteal: 'Blood Hunger',
  crit_damage: 'Savage Strikes'
};

const RACIAL_TRAIT_DESCRIPTIONS = {
  exp_bonus: '+10% experience gained',
  mp_regen: '+20% MP regeneration',
  gold_bonus: '+15% gold from battles',
  lifesteal: '10% of damage dealt heals HP',
  crit_damage: '+25% critical hit damage'
};

// GET /api/characters/preview - Get character preview for race/class combination
router.get('/preview', asyncHandler(async (req, res) => {
  const { race, characterClass } = req.query;

  // Validation
  if (!race || !characterClass) {
    throw new AppError('Race and class are required', 400);
  }

  if (!Object.values(RACES).includes(race)) {
    throw new AppError(`Invalid race. Must be one of: ${Object.values(RACES).join(', ')}`, 400);
  }

  if (!Object.values(CLASSES).includes(characterClass)) {
    throw new AppError(`Invalid class. Must be one of: ${Object.values(CLASSES).join(', ')}`, 400);
  }

  // Calculate level 1 stats
  const stats = calculateStats(race, characterClass, 1);

  // Get racial trait from RACE_BASE_STATS
  const raceStats = RACE_BASE_STATS[race];
  const racialTrait = {
    name: RACIAL_TRAIT_NAMES[raceStats.trait] || raceStats.trait,
    description: RACIAL_TRAIT_DESCRIPTIONS[raceStats.trait] || `${raceStats.trait}: ${raceStats.traitValue}`,
    type: 'racial',
    effectType: raceStats.trait,
    effectValue: raceStats.traitValue
  };

  // Get starting trait from database
  const traitResult = await query(
    `SELECT t.id, t.name, t.description, t.effect_type, t.effect_value
     FROM starting_trait_mappings stm
     JOIN traits t ON stm.trait_id = t.id
     WHERE stm.race = $1 AND stm.class = $2`,
    [race, characterClass]
  );

  let startingTrait = null;
  if (traitResult.rows.length > 0) {
    const row = traitResult.rows[0];
    startingTrait = {
      id: row.id,
      name: row.name,
      description: row.description,
      type: 'starting',
      effectType: row.effect_type,
      effectValue: parseFloat(row.effect_value)
    };
  }

  res.json({
    stats,
    traits: {
      racial: racialTrait,
      starting: startingTrait
    }
  });
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

  const staminaInfo = await staminaService.getStaminaInfo(parseInt(id, 10));
  const character = {
    ...result.rows[0],
    stamina_current: staminaInfo.current
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
  const { name: rawName } = req.body;

  if (!rawName) {
    throw new AppError('Name is required', 400);
  }

  // Validate and sanitize character name (throws AppError on invalid)
  const name = validateCharacterName(rawName);

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
  await withTransaction(
    client => deleteCharacterWithClient(client, req.user.userId, id)
  );

  res.json({ message: 'Character deleted successfully' });
}));

// POST /api/characters/respawn - Return all party characters to home region castle
router.post('/respawn', authenticate, asyncHandler(async (req, res) => {
  const result = await withTransaction(
    client => respawnPartyWithClient(client, req.user.userId)
  );

  res.json({
    message: 'Party respawned at home castle',
    ...result
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
