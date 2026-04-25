/**
 * Chest Loot Service
 *
 * Generates deterministic loot for treasure chests based on distance from center.
 * Uses SeededRandom for reproducibility - same (userId, nodeId) always yields same loot.
 *
 * Distance tiers:
 * - 0-5: 50% chance of 1 common item
 * - 6-10: 1 common + 30% chance uncommon
 * - 11-15: 1 uncommon + 20% rare
 * - 16+: 1 rare + 10% epic
 */

import { SeededRandom } from '../../config/constants.js';
import { ITEM_TEMPLATES } from '../../db/templates/items.js';

// Rarity ID mapping (matches item_templates.rarity column)
const RARITY = {
  COMMON: 1,
  UNCOMMON: 2,
  RARE: 3,
  EPIC: 4,
  LEGENDARY: 5
};

// Rarity name mapping for response
const RARITY_NAMES = {
  1: 'common',
  2: 'uncommon',
  3: 'rare',
  4: 'epic',
  5: 'legendary'
};

/**
 * Get items from templates pool filtered by rarity
 * @param {number} rarityId - Rarity level (1-5)
 * @returns {Array} Array of item templates with that rarity
 */
function getItemPoolByRarity(rarityId) {
  return ITEM_TEMPLATES.filter(item => item.rarity === rarityId);
}

/**
 * Generate chest loot based on distance from center
 *
 * @param {Object} options
 * @param {number} options.userId - User ID for deterministic seed
 * @param {number} options.nodeId - Node ID for deterministic seed
 * @param {number} options.distance - Distance from center (world units)
 * @returns {Array<{template_id: number, quantity: number, rarity: string, name: string}>}
 */
export function generateChestLoot({ userId, nodeId, distance }) {
  // Deterministic seed: same user + node = same loot
  const seed = userId * 1000003 + nodeId;
  const rng = new SeededRandom(seed);

  const items = [];

  // Distance tier logic
  if (distance <= 5) {
    // Tier 1: 50% chance of 1 common
    if (rng.next() < 0.5) {
      const item = rollItem(rng, RARITY.COMMON);
      if (item) items.push(item);
    }
  } else if (distance <= 10) {
    // Tier 2: 1 common guaranteed + 30% uncommon
    const commonItem = rollItem(rng, RARITY.COMMON);
    if (commonItem) items.push(commonItem);

    if (rng.next() < 0.3) {
      const uncommonItem = rollItem(rng, RARITY.UNCOMMON);
      if (uncommonItem) items.push(uncommonItem);
    }
  } else if (distance <= 15) {
    // Tier 3: 1 uncommon guaranteed + 20% rare
    const uncommonItem = rollItem(rng, RARITY.UNCOMMON);
    if (uncommonItem) items.push(uncommonItem);

    if (rng.next() < 0.2) {
      const rareItem = rollItem(rng, RARITY.RARE);
      if (rareItem) items.push(rareItem);
    }
  } else {
    // Tier 4 (16+): 1 rare guaranteed + 10% epic
    const rareItem = rollItem(rng, RARITY.RARE);
    if (rareItem) items.push(rareItem);

    if (rng.next() < 0.1) {
      const epicItem = rollItem(rng, RARITY.EPIC);
      if (epicItem) items.push(epicItem);
    }
  }

  return items;
}

/**
 * Roll a single item from the pool of a given rarity
 * @param {SeededRandom} rng - Random number generator
 * @param {number} rarityId - Rarity level
 * @returns {Object|null} Item object or null if pool is empty
 */
function rollItem(rng, rarityId) {
  const pool = getItemPoolByRarity(rarityId);

  if (pool.length === 0) {
    return null;
  }

  const template = rng.pick(pool);
  // template_id is 1-indexed (array index + 1)
  const templateId = ITEM_TEMPLATES.indexOf(template) + 1;

  return {
    template_id: templateId,
    quantity: 1,
    rarity: RARITY_NAMES[rarityId],
    name: template.name
  };
}

/**
 * Add items to user's shared inventory
 * Stacks consumables/materials, creates individual entries for equipment
 *
 * @param {Object} client - Database client (for transactions)
 * @param {number} userId - User ID
 * @param {Array} items - Array of items from generateChestLoot
 */
export async function addItemsToInventory(client, userId, items) {
  for (const item of items) {
    const template = ITEM_TEMPLATES[item.template_id - 1];
    const isStackable = ['consumable', 'material'].includes(template?.item_type);

    if (isStackable) {
      // Try to stack with existing item
      const existingResult = await client.query(
        `SELECT id, quantity FROM character_items
         WHERE user_id = $1 AND item_template_id = $2 AND equipped_slot IS NULL`,
        [userId, item.template_id]
      );

      if (existingResult.rows.length > 0) {
        await client.query(
          'UPDATE character_items SET quantity = quantity + $1 WHERE id = $2',
          [item.quantity, existingResult.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO character_items (user_id, item_template_id, quantity)
           VALUES ($1, $2, $3)`,
          [userId, item.template_id, item.quantity]
        );
      }
    } else {
      // Equipment items don't stack
      for (let i = 0; i < item.quantity; i++) {
        await client.query(
          `INSERT INTO character_items (user_id, item_template_id, quantity)
           VALUES ($1, $2, 1)`,
          [userId, item.template_id]
        );
      }
    }
  }
}

// Export for testing
export { getItemPoolByRarity, rollItem, RARITY, RARITY_NAMES };
