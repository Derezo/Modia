/**
 * @module battleRewardService
 * @description Handles battle reward calculation and distribution.
 *
 * Key responsibilities:
 * - Calculate gold, XP, and item rewards from battles
 * - Distribute rewards to players and characters
 * - Update quest progress after battles
 * - Handle advancement quest completion
 *
 * @see ./battle/damageCalculator.js - Reward calculation formulas
 * @see ./itemDropService.js - Item drop rolling
 * @see ./advancementQuestService.js - Quest progress tracking
 */

import { query, withTransaction } from '../config/database.js';
import { BATTLE_NODE_TYPES, MAX_BATTLE_PARTY_SIZE, MAX_GOLD } from '../config/constants.js';
import * as battleService from './battleService.js';
import * as itemDropService from './itemDropService.js';
import * as advancementQuestService from './advancementQuestService.js';
import * as dailyQuestService from './dailyQuestService.js';

/**
 * Compute rewards data for a victorious battle.
 * Does NOT persist to database - call distributeRewards for that.
 *
 * @param {Object} state - Battle state with units
 * @param {number} battleId - Battle ID for node lookup
 * @returns {Promise<Object>} Rewards object with gold, experience, items, nodeId, difficultyTier
 */
export async function computeRewards(state, battleId) {
  const enemies = state.units.filter(u => u.type === 'enemy');
  const players = state.units.filter(u => u.type === 'player');
  const partyLevel = Math.floor(
    players.reduce((sum, u) => sum + (u.level || 1), 0) / players.length
  ) || 1;

  // Get node info for rewards calculation
  const nodeResult = await query(
    `SELECT wn.id as node_id, wn.difficulty_tier, wn.node_type
     FROM world_nodes wn
     WHERE wn.id = (SELECT node_id FROM battles WHERE id = $1)`,
    [battleId]
  );
  const nodeId = nodeResult.rows[0]?.node_id;
  const difficultyTier = nodeResult.rows[0]?.difficulty_tier || 1;
  const nodeType = nodeResult.rows[0]?.node_type || 'forest';

  // Calculate rewards using service
  const gold = battleService.calculateGoldReward(enemies, difficultyTier);
  const exp = battleService.calculateExperienceReward(enemies, partyLevel);

  // Roll item drops from each enemy
  const droppedItems = [];
  for (const enemy of enemies) {
    const drops = await itemDropService.rollDrops(enemy, difficultyTier, nodeType);
    droppedItems.push(...drops);
  }

  return {
    gold,
    experience: exp,
    droppedItems,
    items: itemDropService.formatDropsForResponse(droppedItems),
    nodeId,
    nodeType,
    difficultyTier,
    enemies,
    players
  };
}

/**
 * Distribute rewards to the user within a transaction.
 *
 * @param {number} userId - User to receive rewards
 * @param {Object} rewardsData - Output from computeRewards
 * @param {number} battleId - Battle ID
 * @returns {Promise<void>}
 */
export async function distributeRewards(userId, rewardsData, battleId) {
  const { gold, experience, droppedItems, items, nodeId, nodeType, players } = rewardsData;

  await withTransaction(async (client) => {
    // Update battle record with rewards
    const rewardsRecord = {
      gold,
      experience,
      items
    };
    await client.query(
      'UPDATE battles SET rewards = $1, ended_at = NOW() WHERE id = $2',
      [JSON.stringify(rewardsRecord), battleId]
    );

    // Award gold to user (capped at MAX_GOLD to prevent overflow)
    await client.query(
      'UPDATE users SET gold = LEAST(gold + $1, $2) WHERE id = $3',
      [gold, MAX_GOLD, userId]
    );

    // Distribute XP to battle party characters
    const xpPerCharacter = Math.floor(experience / players.length);
    await client.query(
      `UPDATE characters
       SET experience = experience + $1
       WHERE user_id = $2 AND party_slot <= $3 AND party_slot IS NOT NULL`,
      [xpPerCharacter, userId, MAX_BATTLE_PARTY_SIZE]
    );

    // Store dropped items in user's shared inventory
    for (const item of droppedItems) {
      await itemDropService.storeDroppedItem(userId, item, client);
    }

    // Clear combat node on victory (allows player to pass through in future)
    if (nodeId && BATTLE_NODE_TYPES.includes(nodeType)) {
      await client.query(
        `INSERT INTO user_node_clearance (user_id, node_id, battle_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, node_id) DO NOTHING`,
        [userId, nodeId, battleId]
      );
    }
  });
}

/**
 * Update quest progress after battle victory (non-transactional, fire-and-forget).
 *
 * @param {number} partyLeaderId - Character ID of party leader
 * @param {Object} rewardsData - Output from computeRewards
 * @param {number} battleId - Battle ID (for advancement quest)
 * @param {boolean} isAdvancementBattle - Whether this was an advancement trial
 * @param {number|null} challengerCharacterId - Character doing advancement
 * @returns {Promise<Object|null>} Advancement result if applicable
 */
export async function updateQuestProgress(
  partyLeaderId,
  rewardsData,
  battleId,
  isAdvancementBattle = false,
  challengerCharacterId = null
) {
  const { enemies, droppedItems, nodeId, nodeType, difficultyTier, gold, players } = rewardsData;

  // Track enemy kills
  for (const enemy of enemies) {
    const enemyType = enemy.archetype || enemy.type || enemy.name;
    if (enemyType) {
      try {
        await advancementQuestService.updateEnemyProgress(partyLeaderId, enemyType);
      } catch (err) {
        console.warn(`Quest progress update failed for enemy ${enemyType}:`, err.message);
      }
    }
  }

  // Track node visits
  if (nodeId && nodeType) {
    try {
      await advancementQuestService.updateNodeProgress(partyLeaderId, nodeId, nodeType);
    } catch (err) {
      console.warn(`Quest progress update failed for node ${nodeId}:`, err.message);
    }
  }

  // Track material collection from dropped items
  for (const item of droppedItems) {
    if (item.templateId) {
      try {
        await advancementQuestService.updateMaterialProgress(partyLeaderId, item.templateId);
      } catch (err) {
        console.warn(`Quest progress update failed for item ${item.templateId}:`, err.message);
      }
    }
  }

  // Daily/Weekly quest progress hooks (fire-and-forget pattern)
  // Track enemy kills
  dailyQuestService.updateProgress(partyLeaderId, 'kill_enemies', enemies.length, {})
    .catch(err => console.warn('[Quest] kill_enemies progress failed:', err.message));

  // Track battle completion
  dailyQuestService.updateProgress(partyLeaderId, 'complete_battles', 1, {
    tier: difficultyTier
  }).catch(err => console.warn('[Quest] complete_battles progress failed:', err.message));

  // Track gold earned
  if (gold > 0) {
    dailyQuestService.updateProgress(partyLeaderId, 'gold_earned', gold, {})
      .catch(err => console.warn('[Quest] gold_earned progress failed:', err.message));
  }

  // Check if this was a party battle (multiple users)
  const uniqueOwners = new Set(players.map(p => p.ownerId || p.userId).filter(Boolean));
  if (uniqueOwners.size > 1) {
    dailyQuestService.updateProgress(partyLeaderId, 'party_battles', 1, {})
      .catch(err => console.warn('[Quest] party_battles progress failed:', err.message));
  }

  // Handle advancement battle quest completion
  let advancementResult = null;
  if (isAdvancementBattle && challengerCharacterId) {
    try {
      advancementResult = await advancementQuestService.completeQuest(
        challengerCharacterId,
        battleId
      );
      console.log(`[Battle] Advancement quest completed for character ${challengerCharacterId}`);
    } catch (err) {
      console.error('[Battle] Advancement quest completion failed:', err);
      advancementResult = { error: 'Advancement quest completion failed' };
    }
  }

  return advancementResult;
}

/**
 * Clear characters' in_battle status after battle ends.
 *
 * @param {number} userId - User ID
 * @returns {Promise<void>}
 */
export async function clearInBattleStatus(userId) {
  await query(
    `UPDATE characters SET in_battle = false
     WHERE user_id = $1 AND party_slot <= $2`,
    [userId, MAX_BATTLE_PARTY_SIZE]
  );
}

/**
 * Get advancement battle info for a battle.
 *
 * @param {number} battleId - Battle ID
 * @returns {Promise<{isAdvancementBattle: boolean, challengerCharacterId: number|null}>}
 */
export async function getAdvancementBattleInfo(battleId) {
  const result = await query(
    `SELECT is_advancement_battle, challenger_character_id
     FROM battles WHERE id = $1`,
    [battleId]
  );
  return {
    isAdvancementBattle: result.rows[0]?.is_advancement_battle || false,
    challengerCharacterId: result.rows[0]?.challenger_character_id || null
  };
}

/**
 * Get party leader character ID for a user.
 *
 * @param {number} userId - User ID
 * @returns {Promise<number|null>} Party leader character ID or null
 */
export async function getPartyLeaderId(userId) {
  const result = await query(
    'SELECT id FROM characters WHERE user_id = $1 AND party_slot = 1',
    [userId]
  );
  return result.rows[0]?.id || null;
}
