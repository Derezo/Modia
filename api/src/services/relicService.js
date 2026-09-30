/**
 * Relic Service - Manages relic acquisition and effects
 *
 * Relics are account-wide collectibles that unlock premium features:
 * - Wayfarer's Compass: Fast travel to region castles
 * - Vitality Charm: Restore stamina at towns for gold
 * - Merchant's Seal: Reduced marketplace fees
 * - Cartographer's Eye: Extended watchtower vision
 */

import { query } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Get all relic templates with user ownership status
 * @param {number} userId - User ID
 * @returns {Promise<Array>} List of relics with owned flag
 */
export async function getAllRelics(userId) {
  const result = await query(
    `SELECT
       rt.id,
       rt.key,
       rt.name,
       rt.description,
       rt.rarity,
       rt.acquisition_type,
       rt.acquisition_id,
       rt.effects,
       CASE WHEN ur.id IS NOT NULL THEN true ELSE false END as owned,
       ur.acquired_at
     FROM relic_templates rt
     LEFT JOIN user_relics ur ON ur.relic_id = rt.id AND ur.user_id = $1
     ORDER BY rt.rarity DESC, rt.name`,
    [userId]
  );

  return Promise.all(result.rows.map(async (row) => {
    // Unowned relics carry whether they can be claimed now and, if not,
    // what is still required (the same check claimRelic enforces).
    const eligibility = row.owned
      ? { canClaim: false, validationMessage: '' }
      : await checkRelicEligibility(userId, row);
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      rarity: row.rarity,
      acquisitionType: row.acquisition_type,
      effects: row.effects,
      owned: row.owned,
      acquiredAt: row.acquired_at,
      claimable: eligibility.canClaim,
      requirement: eligibility.validationMessage || null
    };
  }));
}

/**
 * Get user's owned relics
 * @param {number} userId - User ID
 * @returns {Promise<Array>} List of owned relics
 */
export async function getOwnedRelics(userId) {
  const result = await query(
    `SELECT
       rt.id,
       rt.key,
       rt.name,
       rt.description,
       rt.rarity,
       rt.effects,
       ur.acquired_at
     FROM user_relics ur
     JOIN relic_templates rt ON rt.id = ur.relic_id
     WHERE ur.user_id = $1
     ORDER BY ur.acquired_at DESC`,
    [userId]
  );

  return result.rows.map(row => ({
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    rarity: row.rarity,
    effects: row.effects,
    acquiredAt: row.acquired_at
  }));
}

/**
 * Check if user owns a specific relic by key
 * @param {number} userId - User ID
 * @param {string} relicKey - Relic key (e.g., 'wayfarers_compass')
 * @returns {Promise<boolean>} True if user owns the relic
 */
export async function hasRelic(userId, relicKey) {
  const result = await query(
    `SELECT 1 FROM user_relics ur
     JOIN relic_templates rt ON rt.id = ur.relic_id
     WHERE ur.user_id = $1 AND rt.key = $2`,
    [userId, relicKey]
  );
  return result.rows.length > 0;
}

/**
 * Get relic effects if user owns it
 * @param {number} userId - User ID
 * @param {string} relicKey - Relic key
 * @param {{ query: Function }} [db] - Optional database executor (pool or transaction client)
 * @returns {Promise<Object|null>} Relic effects or null if not owned
 */
export async function getRelicEffects(userId, relicKey, db = { query }) {
  const result = await db.query(
    `SELECT rt.effects FROM user_relics ur
     JOIN relic_templates rt ON rt.id = ur.relic_id
     WHERE ur.user_id = $1 AND rt.key = $2`,
    [userId, relicKey]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0].effects;
}

/**
 * Grant a relic to a user
 * @param {number} userId - User ID
 * @param {string} relicKey - Relic key to grant
 * @returns {Promise<Object>} Result with relic info
 */
export async function grantRelic(userId, relicKey) {
  // Get relic template
  const templateResult = await query(
    'SELECT id, name, description, rarity, effects FROM relic_templates WHERE key = $1',
    [relicKey]
  );

  if (templateResult.rows.length === 0) {
    throw new Error(`Relic not found: ${relicKey}`);
  }

  const template = templateResult.rows[0];

  // Insert user_relic (ON CONFLICT handles duplicate)
  const insertResult = await query(
    `INSERT INTO user_relics (user_id, relic_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, relic_id) DO NOTHING
     RETURNING id, acquired_at`,
    [userId, template.id]
  );

  const alreadyOwned = insertResult.rows.length === 0;

  return {
    relicId: template.id,
    relicKey,
    name: template.name,
    description: template.description,
    rarity: template.rarity,
    effects: template.effects,
    alreadyOwned,
    acquiredAt: alreadyOwned ? null : insertResult.rows[0].acquired_at
  };
}

/**
 * Check whether a user meets a relic's acquisition requirements.
 * Shared by claimRelic (enforcement) and getAllRelics (so the collection UI
 * can disable Claim and say what is still needed).
 * @param {number} userId - User ID
 * @param {{key:string, acquisition_type:string, acquisition_id:*}} template - relic_templates row
 * @returns {Promise<{canClaim: boolean, validationMessage: string}>}
 */
export async function checkRelicEligibility(userId, template) {
  let canClaim = false;
  let validationMessage = '';

  switch (template.acquisition_type) {
    case 'quest':
      // Quest relics are class-agnostic: complete any advancement quest of the
      // required tier or higher, whatever the starting class.
      // The acquisition_id (if set) is the minimum tier (default: tier 1); a
      // lower-tier quest must not satisfy a higher requirement.
      {
        const requiredTier = parseInt(template.acquisition_id, 10) || 1;
        const questResult = await query(
          `SELECT 1 FROM character_quests cq
           JOIN characters c ON c.id = cq.character_id
           JOIN advancement_quest_templates aqt ON aqt.id = cq.quest_template_id
           WHERE c.user_id = $1
             AND aqt.tier >= $2
             AND cq.status = 'completed'
           LIMIT 1`,
          [userId, requiredTier]
        );
        canClaim = questResult.rows.length > 0;
        validationMessage = canClaim ? '' : `Complete a tier ${requiredTier} or higher guild advancement quest to claim this relic`;
      }
      break;

    case 'node':
      // For cartographers_eye (watchtower relic): check if user has visited ANY watchtower.
      // This is world-seed-independent and matches the relic's description.
      // Other node relics may use specific acquisition_id if needed.
      if (template.key === 'cartographers_eye') {
        const watchtowerResult = await query(
          `SELECT 1 FROM user_node_discovery und
           JOIN world_nodes wn ON wn.id = und.node_id
           WHERE und.user_id = $1 AND und.discovery_method = 'travel' AND wn.node_type = 'watchtower'
           LIMIT 1`,
          [userId]
        );
        canClaim = watchtowerResult.rows.length > 0;
        validationMessage = canClaim ? '' : 'Visit any watchtower to claim this relic';
      } else if (template.acquisition_id) {
        // Other node relics: check specific node by ID
        const nodeResult = await query(
          `SELECT 1 FROM user_node_discovery
           WHERE user_id = $1 AND node_id = $2 AND discovery_method = 'travel'`,
          [userId, template.acquisition_id]
        );
        canClaim = nodeResult.rows.length > 0;
        validationMessage = canClaim ? '' : 'Visit the required location to claim this relic';
      } else {
        // SECURITY: No acquisition_id and not a special case means relic is not yet claimable
        canClaim = false;
        validationMessage = 'This relic is not yet obtainable';
      }
      break;

    case 'shop':
      // Relics from shops are purchased, not claimed - handled separately
      canClaim = false;
      validationMessage = 'This relic must be purchased from a shop';
      break;

    case 'guild':
      // Check guild advancement rank by verifying character class tier
      // acquisition_id is the minimum tier required (1-4)
      // Characters in advanced classes have reached that tier
      if (template.acquisition_id) {
        const requiredTier = parseInt(template.acquisition_id, 10);
        // Get highest tier class across all user's characters
        const guildResult = await query(
          `SELECT c.class FROM characters c
           WHERE c.user_id = $1`,
          [userId]
        );
        // Check if any character has achieved the required tier
        const tierClasses = {
          // Tier 1 advanced classes
          1: ['knight', 'battlemage', 'elementalist', 'white_mage', 'martial_artist', 'brawler', 'medic', 'plague_doctor'],
          // Tier 2 advanced classes
          2: ['paladin', 'guardian', 'summoner', 'conjurer', 'martial_artist', 'brawler', 'medic', 'plague_doctor'],
          // Tier 3 advanced classes
          3: ['warlord', 'oracle', 'ascetic', 'artificer'],
          // Tier 4 = max tier classes
          4: ['warlord', 'oracle', 'ascetic', 'artificer']
        };
        const validClasses = tierClasses[requiredTier] || [];
        const hasRequiredTier = guildResult.rows.some(row => validClasses.includes(row.class));
        canClaim = hasRequiredTier;
        validationMessage = canClaim ? '' : `Advance a character to guild tier ${requiredTier} to claim this relic`;
      } else {
        // SECURITY: No acquisition_id means relic is not yet claimable
        canClaim = false;
        validationMessage = 'This relic is not yet obtainable';
      }
      break;

    case 'achievement':
      // Achievement relics: special case for merchants_seal (marketplace sales)
      // Other achievement relics use pvp_achievements table
      if (template.key === 'merchants_seal') {
        // merchants_seal: complete at least 1 marketplace sale, through
        // either the commodity order book (market_trades) or an equipment
        // item listing (item_listing_sales)
        const salesResult = await query(
          `SELECT 1 FROM market_trades WHERE seller_id = $1
           UNION ALL
           SELECT 1 FROM item_listing_sales WHERE seller_id = $1
           LIMIT 1`,
          [userId]
        );
        canClaim = salesResult.rows.length > 0;
        validationMessage = canClaim ? '' : 'Complete at least one marketplace sale to claim this relic';
      } else if (template.acquisition_id) {
        // Other achievement relics: check pvp_achievements table
        const achievementResult = await query(
          `SELECT 1 FROM pvp_achievements
           WHERE user_id = $1 AND achievement_key = $2`,
          [userId, template.acquisition_id]
        );
        canClaim = achievementResult.rows.length > 0;
        validationMessage = canClaim ? '' : 'Complete the required achievement to claim this relic';
      } else {
        // SECURITY: No acquisition_id and not a special case means relic is not yet claimable
        canClaim = false;
        validationMessage = 'This relic is not yet obtainable';
      }
      break;

    default:
      canClaim = false;
      validationMessage = 'Unknown acquisition type';
  }

  return { canClaim, validationMessage };
}

/**
 * Claim a relic (validates acquisition requirements)
 * @param {number} userId - User ID
 * @param {number} relicId - Relic template ID
 * @returns {Promise<Object>} Result with claimed relic info
 */
export async function claimRelic(userId, relicId) {
  // Get relic template
  const templateResult = await query(
    `SELECT id, key, name, description, rarity, acquisition_type, acquisition_id, effects
     FROM relic_templates WHERE id = $1`,
    [relicId]
  );

  if (templateResult.rows.length === 0) {
    // SECURITY: Use AppError(404) instead of plain Error so errorHandler returns proper 404
    throw new AppError('Relic not found', 404);
  }

  const template = templateResult.rows[0];

  // Check if already owned
  const existingResult = await query(
    'SELECT id FROM user_relics WHERE user_id = $1 AND relic_id = $2',
    [userId, relicId]
  );

  if (existingResult.rows.length > 0) {
    return {
      success: false,
      message: 'You already own this relic',
      relic: {
        id: template.id,
        key: template.key,
        name: template.name
      }
    };
  }

  // Validate acquisition requirements based on type
  const { canClaim, validationMessage } = await checkRelicEligibility(userId, template);

  if (!canClaim) {
    return {
      success: false,
      message: validationMessage,
      relic: {
        id: template.id,
        key: template.key,
        name: template.name,
        acquisitionType: template.acquisition_type
      }
    };
  }

  // Grant the relic
  const insertResult = await query(
    `INSERT INTO user_relics (user_id, relic_id)
     VALUES ($1, $2)
     RETURNING id, acquired_at`,
    [userId, relicId]
  );

  return {
    success: true,
    message: `You have acquired the ${template.name}!`,
    relic: {
      id: template.id,
      key: template.key,
      name: template.name,
      description: template.description,
      rarity: template.rarity,
      effects: template.effects,
      acquiredAt: insertResult.rows[0].acquired_at
    }
  };
}

/**
 * Get the effective marketplace fee rate for a user
 * Default is 5%, but Merchant's Seal reduces it to 3%
 * @param {number} userId - User ID
 * @param {{ query: Function }} [db] - Optional database executor (pool or transaction client)
 * @returns {Promise<number>} Fee rate (0.05 or 0.03)
 */
export async function getMarketplaceFeeRate(userId, db = { query }) {
  const effects = await getRelicEffects(userId, 'merchants_seal', db);

  if (effects && effects.fee_rate) {
    return effects.fee_rate;
  }

  return 0.05; // Default 5% fee
}

/**
 * Get fast travel cost between nodes
 * @param {number} fromRegionId - Source region ID
 * @param {number} toRegionId - Destination region ID
 * @returns {number} Gold cost for fast travel
 */
export function calculateFastTravelCost(fromRegionId, toRegionId) {
  const baseCost = 100;
  const costPerRegion = 50;

  // Same region travel is just base cost
  if (fromRegionId === toRegionId) {
    return baseCost;
  }

  // Distance is based on region difference (simplified - actual distance would use coordinates)
  const regionDistance = Math.abs(toRegionId - fromRegionId);
  return baseCost + (regionDistance * costPerRegion);
}

/**
 * Get stamina restore cost per point
 * @param {number} userId - User ID (for potential relic modifiers)
 * @returns {Promise<number>} Gold cost per stamina point
 */
export async function getStaminaRestoreCost(userId) {
  const effects = await getRelicEffects(userId, 'vitality_charm');

  if (effects && effects.cost_per_point) {
    return effects.cost_per_point;
  }

  return 100; // Default 100 gold per stamina point
}
