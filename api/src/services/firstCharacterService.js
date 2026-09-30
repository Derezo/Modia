/**
 * @module firstCharacterService
 * @description The one definition of a player's starting character: stats,
 * homeland spawn, starter equipment/skills/consumables/trait and initial node
 * discovery. Used by registration (registrationService) and by
 * POST /api/characters so both paths grant the same start.
 */

import { calculateStats, STARTING_EXPERIENCE } from '../config/constants.js';
import { STARTING_CONSUMABLES } from '../../../shared/constants.js';
import { discoverNodeAndAdjacent } from './world/discoveryService.js';
import { AppError } from '../middleware/errorHandler.js';

// Starter equipment by class (weapon, armor, accessory)
export const STARTER_EQUIPMENT = {
  warrior: ['Trainee Sword', 'Trainee Tunic', 'Warrior\'s Pendant'],
  wizard: ['Novice Wand', 'Student Robe', 'Mage\'s Crystal'],
  monk: ['Initiate Wraps', 'Initiate Gi', 'Monk\'s Beads'],
  chemist: ['Mixing Rod', 'Alchemist Coat', 'Reagent Pouch']
};

// Starter skills by class (first skill in each class tree)
export const STARTER_SKILLS = {
  warrior: ['power_strike'],
  wizard: ['fireball'],
  monk: ['palm_strike'],
  chemist: ['brew_potion']
};

/**
 * Create a user's first character (party_slot 1) inside the caller's
 * transaction. Inputs must already be validated.
 *
 * @param {Object} client - Transaction client
 * @param {Object} params
 * @param {number} params.userId - Owning user
 * @param {string} params.name - Validated character name
 * @param {string} params.race - Race
 * @param {string} params.characterClass - Class
 * @param {string} params.gender - Gender
 * @returns {Promise<Object>} The inserted characters row
 */
export async function createFirstCharacterWithClient(client, { userId, name, race, characterClass, gender }) {
  const stats = calculateStats(race, characterClass, 1);

  // Spawn at the race's homeland castle
  const regionResult = await client.query(
    'SELECT id, castle_node_id FROM world_regions WHERE race = $1',
    [race]
  );
  if (regionResult.rows.length === 0) {
    throw new AppError('Invalid race for spawn location', 400);
  }
  const { id: homeRegionId, castle_node_id: spawnNodeId } = regionResult.rows[0];
  if (!spawnNodeId) {
    console.error(`[CharacterCreate] No castle_node_id for race ${race} in world_regions`);
    throw new AppError('Unable to determine spawn location', 500);
  }

  // Gold lives on users, not characters
  const result = await client.query(
    `INSERT INTO characters (
       user_id, name, race, class, gender, level, experience,
       hp_current, hp_max, mp_current, mp_max,
       strength, intelligence, agility, vitality, luck,
       party_slot, current_node_id, home_region_id
     )
     VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $7, $8, $8, $9, $10, $11, $12, $13, 1, $14, $15)
     RETURNING *`,
    [
      userId, name, race, characterClass, gender,
      STARTING_EXPERIENCE,
      stats.hpMax, stats.mpMax,
      stats.strength, stats.intelligence, stats.agility, stats.vitality, stats.luck,
      spawnNodeId, homeRegionId
    ]
  );
  const character = result.rows[0];

  for (const itemName of STARTER_EQUIPMENT[characterClass] || []) {
    await client.query(
      `INSERT INTO character_items (character_id, item_template_id, quantity, is_equipped, equipped_slot)
       SELECT $1, id, 1, true, equipment_slot
       FROM item_templates WHERE name = $2`,
      [character.id, itemName]
    );
  }

  for (const skillId of STARTER_SKILLS[characterClass] || []) {
    await client.query(
      `INSERT INTO character_skills (character_id, skill_id, level)
       VALUES ($1, $2, 1)
       ON CONFLICT (character_id, skill_id) DO NOTHING`,
      [character.id, skillId]
    );
  }

  // Starting consumables go to the shared inventory (character_id NULL)
  for (const { templateId, quantity } of STARTING_CONSUMABLES) {
    await client.query(
      `INSERT INTO character_items (user_id, character_id, item_template_id, quantity, is_equipped)
       VALUES ($1, NULL, $2, $3, false)`,
      [userId, templateId, quantity]
    );
  }

  const startingTraitResult = await client.query(
    'SELECT trait_id FROM starting_trait_mappings WHERE race = $1 AND class = $2',
    [race, characterClass]
  );
  if (startingTraitResult.rows.length > 0) {
    await client.query(
      `INSERT INTO character_traits (character_id, trait_id)
       VALUES ($1, $2)
       ON CONFLICT (character_id, trait_id) DO NOTHING`,
      [character.id, startingTraitResult.rows[0].trait_id]
    );
  }

  await discoverNodeAndAdjacent(userId, spawnNodeId, client);

  return character;
}
