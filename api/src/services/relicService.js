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
       rt.effects,
       CASE WHEN ur.id IS NOT NULL THEN true ELSE false END as owned,
       ur.acquired_at
     FROM relic_templates rt
     LEFT JOIN user_relics ur ON ur.relic_id = rt.id AND ur.user_id = $1
     ORDER BY rt.rarity DESC, rt.name`,
    [userId]
  );

  return result.rows.map(row => ({
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    rarity: row.rarity,
    acquisitionType: row.acquisition_type,
    effects: row.effects,
    owned: row.owned,
    acquiredAt: row.acquired_at
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
 * @returns {Promise<Object|null>} Relic effects or null if not owned
 */
export async function getRelicEffects(userId, relicKey) {
  const result = await query(
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
    throw new Error('Relic not found');
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
  let canClaim = false;
  let validationMessage = '';

  switch (template.acquisition_type) {
    case 'quest':
      // Check if user has completed the required advancement quest
      // acquisition_id refers to the quest_template_id
      if (template.acquisition_id) {
        const questResult = await query(
          `SELECT 1 FROM character_quests cq
           JOIN characters c ON c.id = cq.character_id
           WHERE c.user_id = $1
             AND cq.quest_template_id = $2
             AND cq.status = 'completed'`,
          [userId, template.acquisition_id]
        );
        canClaim = questResult.rows.length > 0;
        validationMessage = canClaim ? '' : 'Complete the required quest to claim this relic';
      } else {
        // No specific quest required - check daily quest history as fallback
        const anyQuestResult = await query(
          `SELECT 1 FROM daily_quest_history dqh
           JOIN characters c ON c.id = dqh.character_id
           WHERE c.user_id = $1
           LIMIT 1`,
          [userId]
        );
        canClaim = anyQuestResult.rows.length > 0;
        validationMessage = canClaim ? '' : 'Complete at least one quest to claim this relic';
      }
      break;

    case 'node':
      // Check if user has discovered and visited the specific node
      if (template.acquisition_id) {
        const nodeResult = await query(
          `SELECT 1 FROM user_node_discovery
           WHERE user_id = $1 AND node_id = $2 AND discovery_method = 'travel'`,
          [userId, template.acquisition_id]
        );
        canClaim = nodeResult.rows.length > 0;
        validationMessage = canClaim ? '' : 'Visit the required location to claim this relic';
      } else {
        canClaim = true;
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
        // No tier required - any guild membership counts
        canClaim = true;
      }
      break;

    case 'achievement':
      // Check PvP achievements (currently the only achievement system implemented)
      // acquisition_id is the achievement_key
      if (template.acquisition_id) {
        const achievementResult = await query(
          `SELECT 1 FROM pvp_achievements
           WHERE user_id = $1 AND achievement_key = $2`,
          [userId, template.acquisition_id]
        );
        canClaim = achievementResult.rows.length > 0;
        validationMessage = canClaim ? '' : 'Complete the required achievement to claim this relic';
      } else {
        // No specific achievement required - check if user has any achievement
        const anyAchievementResult = await query(
          'SELECT 1 FROM pvp_achievements WHERE user_id = $1 LIMIT 1',
          [userId]
        );
        canClaim = anyAchievementResult.rows.length > 0;
        validationMessage = canClaim ? '' : 'Earn an achievement to claim this relic';
      }
      break;

    default:
      canClaim = false;
      validationMessage = 'Unknown acquisition type';
  }

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
 * @returns {Promise<number>} Fee rate (0.05 or 0.03)
 */
export async function getMarketplaceFeeRate(userId) {
  const effects = await getRelicEffects(userId, 'merchants_seal');

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
