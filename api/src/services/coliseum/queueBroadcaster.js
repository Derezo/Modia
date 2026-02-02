/**
 * @module coliseum/queueBroadcaster
 * @description WebSocket notification functions for queue updates and player lists.
 *
 * Handles broadcasting queue status changes, player lists, and global queue
 * statistics to connected clients via WebSocket.
 */

import { query } from '../../config/database.js';
import { getTier } from '../../../../shared/coliseum.js';
import {
  matchmakingQueues,
  getWebsocket,
  QUEUE_SETTINGS
} from './constants.js';

/**
 * Calculate estimated wait time
 * @param {number} queueSize - Current queue size
 * @param {number} position - Player's position in queue
 * @returns {number} Estimated wait in seconds
 */
export function calculateEstimatedWait(queueSize, position) {
  // Average match time ~5 minutes, so estimate based on position
  const averageMatchTime = 300; // 5 minutes in seconds
  return Math.ceil(position / 2) * averageMatchTime;
}

/**
 * Simple obfuscation for user IDs in queue display
 * @param {number} userId - User ID
 * @returns {string} Obfuscated ID
 */
export function obfuscateUserId(userId) {
  // Simple hash for display purposes (not cryptographic)
  const hash = (userId * 2654435761) >>> 0;
  return hash.toString(36).substring(0, 8);
}

/**
 * Get queue status for a specific queue type
 * @param {string} queueType - Queue type
 * @returns {Object} Queue status
 */
export function getQueueStatus(queueType) {
  const queue = matchmakingQueues.get(queueType) || [];
  return {
    queueType,
    queueSize: queue.length,
    averageWait: calculateEstimatedWait(queue.length, queue.length)
  };
}

/**
 * Get all queue statuses
 * @returns {Array<Object>} Array of queue statuses
 */
export function getAllQueueStatuses() {
  return Object.keys(QUEUE_SETTINGS).map(type => getQueueStatus(type));
}

/**
 * Broadcast queue update to all waiting players in a specific queue
 * @param {string} queueType - Queue type
 */
export async function broadcastQueueUpdate(queueType) {
  const queue = matchmakingQueues.get(queueType) || [];

  const ws = await getWebsocket();

  // Send position updates to each player
  queue.forEach((player, index) => {
    ws.sendToUser(player.userId, {
      type: 'coliseum:queue_update',
      payload: {
        queueType,
        position: index + 1,
        queueSize: queue.length,
        estimatedWait: calculateEstimatedWait(queue.length, index)
      }
    });
  });
}

/**
 * Broadcast queue sizes to all players in coliseum lobby
 */
export async function broadcastGlobalQueueStatus() {
  const ws = await getWebsocket();
  const statuses = getAllQueueStatuses();

  // Broadcast to coliseum:lobby room
  ws.broadcastToRoom('coliseum:lobby', {
    type: 'coliseum:queue_stats_update',
    payload: { queues: statuses }
  });
}

/**
 * Get players in a queue with their details
 * @param {string} queueType - Queue type (1v1, 3v3, 5v5)
 * @param {number|null} requestingUserId - The user requesting the list (for isCurrentUser flag)
 * @returns {Promise<Array>} Array of player objects with details
 */
export async function getQueuePlayers(queueType, requestingUserId = null) {
  const queue = matchmakingQueues.get(queueType) || [];
  if (queue.length === 0) return [];

  const now = Date.now();

  // Get all user IDs in queue
  const userIds = queue.map(p => p.userId);

  // Batch fetch ratings from database (including win_streak for badges)
  const ratingsResult = await query(
    `SELECT user_id, rating, tier, win_streak FROM pvp_ratings
     WHERE user_id = ANY($1) AND queue_type = $2`,
    [userIds, queueType]
  );

  const ratingsMap = new Map();
  for (const row of ratingsResult.rows) {
    ratingsMap.set(row.user_id, { rating: row.rating, tier: row.tier, winStreak: row.win_streak || 0 });
  }

  // Build player list with enriched data
  const players = queue.map((player, index) => {
    const ratingData = ratingsMap.get(player.userId) || { rating: 1000, tier: null, winStreak: 0 };
    const tierInfo = getTier(ratingData.rating);
    const waitTimeSeconds = Math.floor((now - player.queuedAt) / 1000);

    return {
      position: index + 1,
      oduscatedId: obfuscateUserId(player.userId),
      username: player.username,
      rating: ratingData.rating,
      tier: ratingData.tier || tierInfo.name.toLowerCase(),
      tierColor: tierInfo.color,
      tierIcon: tierInfo.icon,
      partyLevel: player.partyLevel,
      waitTime: waitTimeSeconds,
      winStreak: ratingData.winStreak,
      isCurrentUser: requestingUserId !== null && player.userId === requestingUserId
    };
  });

  return players;
}

/**
 * Broadcast queue players update to all players in a specific queue
 * @param {string} queueType - Queue type
 */
export async function broadcastQueuePlayersUpdate(queueType) {
  const queue = matchmakingQueues.get(queueType) || [];
  if (queue.length === 0) return;

  const ws = await getWebsocket();
  const now = Date.now();

  // Get ratings for all players in batch (including win_streak for badges)
  const userIds = queue.map(p => p.userId);
  const ratingsResult = await query(
    `SELECT user_id, rating, tier, win_streak FROM pvp_ratings
     WHERE user_id = ANY($1) AND queue_type = $2`,
    [userIds, queueType]
  );

  const ratingsMap = new Map();
  for (const row of ratingsResult.rows) {
    ratingsMap.set(row.user_id, { rating: row.rating, tier: row.tier, winStreak: row.win_streak || 0 });
  }

  // Send personalized update to each player in the queue
  for (const player of queue) {
    const players = queue.map((p, index) => {
      const ratingData = ratingsMap.get(p.userId) || { rating: 1000, tier: null, winStreak: 0 };
      const tierInfo = getTier(ratingData.rating);
      const waitTimeSeconds = Math.floor((now - p.queuedAt) / 1000);

      return {
        position: index + 1,
        oduscatedId: obfuscateUserId(p.userId),
        username: p.username,
        rating: ratingData.rating,
        tier: ratingData.tier || tierInfo.name.toLowerCase(),
        tierColor: tierInfo.color,
        tierIcon: tierInfo.icon,
        partyLevel: p.partyLevel,
        waitTime: waitTimeSeconds,
        winStreak: ratingData.winStreak,
        isCurrentUser: p.userId === player.userId
      };
    });

    ws.sendToUser(player.userId, {
      type: 'coliseum:queue_players_update',
      payload: {
        queueType,
        players,
        totalPlayers: players.length
      }
    });
  }
}
