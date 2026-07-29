/**
 * @module coliseum/matchmaking
 * @description Queue management and PPR-based matchmaking for PvP battles.
 *
 * Key responsibilities:
 * - Managing player queue entries (join, leave, re-queue)
 * - PPR (Player Power Rating) calculation for fair matching
 * - Time-based range expansion for longer queue times
 * - Finding matchable player pairs
 *
 * @see queueBroadcaster.js - WebSocket notifications
 * @see matchLifecycle.js - Match creation after successful pairing
 */

import { query } from '../../config/database.js';
import { calculateBattlePartyPower } from '../characterValuationService.js';
import { ensureRating } from '../ratingService.js';
import {
  matchmakingQueues,
  activeMatches,
  getWebsocket,
  QUEUE_SETTINGS,
  INITIAL_PPR_RANGE,
  PPR_RANGE_EXPANSION,
  PPR_EXPANSION_INTERVAL
} from './constants.js';
import {
  calculateEstimatedWait,
  broadcastQueueUpdate,
  broadcastGlobalQueueStatus,
  broadcastQueuePlayersUpdate
} from './queueBroadcaster.js';
import { createMatch, checkQueueBan } from './matchLifecycle.js';
import { handlePlayerDisconnect } from './turnTimer.js';
import { assertBattleMapCapabilities } from '../../../../shared/battleStateProtocol.js';

/**
 * Validate and detach a client's battle-map declaration before retaining it
 * in the in-memory queue. A missing declaration is intentionally legacy V1,
 * not implicit V2 support.
 */
export function normalizeQueuedBattleMapCapabilities(capabilities) {
  if (capabilities === undefined || capabilities === null) return null;
  assertBattleMapCapabilities(capabilities);
  return structuredClone(capabilities);
}

/**
 * Check if two players are matchable based on PPR
 * @param {Object} player1 - First player queue entry
 * @param {Object} player2 - Second player queue entry
 * @returns {boolean} True if players can be matched
 */
export function arePlayersMatchable(player1, player2) {
  const now = Date.now();

  // Calculate expanded PPR range based on wait time
  // Start at 15%, expand by 5% every 30 seconds
  const getExpandedRange = (queuedAt) => {
    const waitTime = now - queuedAt;
    const expansions = Math.floor(waitTime / PPR_EXPANSION_INTERVAL);
    return INITIAL_PPR_RANGE + (expansions * PPR_RANGE_EXPANSION);
  };

  const p1Range = getExpandedRange(player1.queuedAt);
  const p2Range = getExpandedRange(player2.queuedAt);

  // Use the more generous range (longer wait time = wider range)
  const effectiveRange = Math.max(p1Range, p2Range);

  // Check if PPRs are within range of each other
  const pprDiff = Math.abs(player1.ppr - player2.ppr);
  const avgPPR = (player1.ppr + player2.ppr) / 2;
  const maxDiff = avgPPR * effectiveRange;

  return pprDiff <= maxDiff;
}

/**
 * Try to create a match from queued players
 * Uses PPR-based matchmaking with expanding range over time
 * @param {string} queueType - Queue type
 * @returns {Promise<Object>} Match result
 */
export async function tryMatchmaking(queueType) {
  const settings = QUEUE_SETTINGS[queueType];
  const queue = matchmakingQueues.get(queueType);

  if (!queue || queue.length < settings.minPlayers) {
    return { matched: false };
  }

  // Sort queue by wait time (longest waiting first)
  queue.sort((a, b) => a.queuedAt - b.queuedAt);

  // Try to find a match for the longest-waiting player
  let player1 = null;
  let player2 = null;
  let player1Index = -1;
  let player2Index = -1;

  // Find first matchable pair
  for (let i = 0; i < queue.length; i++) {
    for (let j = i + 1; j < queue.length; j++) {
      if (arePlayersMatchable(queue[i], queue[j])) {
        player1 = queue[i];
        player2 = queue[j];
        player1Index = i;
        player2Index = j;
        break;
      }
    }
    if (player1 && player2) break;
  }

  if (!player1 || !player2) {
    return { matched: false };
  }

  // Remove matched players from queue (remove higher index first to preserve indices)
  queue.splice(player2Index, 1);
  queue.splice(player1Index, 1);

  // Create the match
  const matchId = await createMatch(queueType, player1, player2);

  return { matched: true, matchId };
}

/**
 * Add a player to the matchmaking queue
 * @param {string} queueType - Queue type (1v1, 3v3, 5v5)
 * @param {number} userId - User ID
 * @param {string} username - Username
 * @param {number} partyLevel - Average party level
 * @param {number} partySize - Number of characters in battle party
 * @param {Object|null} battleMapCapabilities - Explicit client map protocol support
 * @returns {Promise<Object>} Queue status
 */
export async function joinQueue(
  queueType,
  userId,
  username,
  partyLevel,
  partySize,
  battleMapCapabilities = null
) {
  const settings = QUEUE_SETTINGS[queueType];
  if (!settings) {
    return { success: false, error: 'Invalid queue type' };
  }
  const queuedBattleMapCapabilities = normalizeQueuedBattleMapCapabilities(
    battleMapCapabilities
  );

  // Validate party size
  if (partySize > settings.partySize) {
    return { success: false, error: `Maximum ${settings.partySize} characters allowed for ${queueType}` };
  }

  // Check for active queue ban
  const ban = await checkQueueBan(userId, queueType);
  if (ban) {
    const ws = await getWebsocket();
    ws.sendToUser(userId, {
      type: 'coliseum:queue_banned',
      payload: { banUntil: ban.banUntil, reason: ban.reason }
    });
    return { success: false, error: `You are banned from this queue until ${new Date(ban.banUntil).toLocaleTimeString()}` };
  }

  // Check if player already has an active battle (prevents queueing while in battle)
  const activeBattle = await query(
    `SELECT id FROM battles
     WHERE (player1_id = $1 OR player2_id = $1) AND status = 'active'
     LIMIT 1`,
    [userId]
  );
  if (activeBattle.rows.length > 0) {
    return { success: false, error: 'Cannot queue while in an active battle' };
  }

  // Initialize queue if needed
  if (!matchmakingQueues.has(queueType)) {
    matchmakingQueues.set(queueType, []);
  }

  const queue = matchmakingQueues.get(queueType);

  // Check if already in queue
  const existingIndex = queue.findIndex(p => p.userId === userId);
  if (existingIndex >= 0) {
    // A reconnecting client may have upgraded or downgraded since its original
    // queue request. Use the latest explicit declaration without resetting its
    // fair matchmaking position.
    queue[existingIndex].battleMapCapabilities = queuedBattleMapCapabilities;
    return {
      success: true,
      position: existingIndex + 1,
      estimatedWait: calculateEstimatedWait(queue.length, existingIndex),
      ppr: queue[existingIndex].ppr,
      alreadyInQueue: true
    };
  }

  // Calculate Player Power Rating for matchmaking
  const ppr = await calculateBattlePartyPower(userId);

  // Ensure the player has a rating record
  await ensureRating(userId, queueType);

  // Add to queue with PPR
  const queueEntry = {
    userId,
    username,
    partyLevel,
    partySize,
    ppr,
    queuedAt: Date.now(),
    battleMapCapabilities: queuedBattleMapCapabilities
  };

  queue.push(queueEntry);

  // Join coliseum room for updates (async, fire and forget)
  getWebsocket().then(ws => {
    const roomName = `coliseum:${queueType}`;
    const { rooms } = ws;
    if (!rooms.has(roomName)) {
      rooms.set(roomName, new Set());
    }
    rooms.get(roomName).add(userId);

    // Send queue update to player
    ws.sendToUser(userId, {
      type: 'coliseum:queue_joined',
      payload: {
        queueType,
        position: queue.length,
        estimatedWait: calculateEstimatedWait(queue.length, queue.length - 1),
        queueSize: queue.length,
        ppr
      }
    });
  }).catch(err => console.error('Failed to join coliseum room:', err));

  // Try to create a match (now async due to PPR-based matching)
  const matchResult = await tryMatchmaking(queueType);

  // Broadcast global queue status to lobby (fire and forget)
  broadcastGlobalQueueStatus();

  // Broadcast queue players update to all in queue
  broadcastQueuePlayersUpdate(queueType).catch(err =>
    console.error('Failed to broadcast queue players update:', err)
  );

  return {
    success: true,
    position: queue.length,
    estimatedWait: calculateEstimatedWait(queue.length, queue.length - 1),
    queueSize: queue.length,
    ppr,
    matchFound: matchResult.matched
  };
}

/**
 * Remove a player from a specific queue
 * @param {string} queueType - Queue type
 * @param {number} userId - User ID
 * @returns {boolean} Whether the player was removed
 */
export function removeFromQueue(queueType, userId) {
  const queue = matchmakingQueues.get(queueType);
  if (!queue) return false;

  const index = queue.findIndex(p => p.userId === userId);
  if (index >= 0) {
    queue.splice(index, 1);

    // Broadcast global queue status to lobby (fire and forget)
    broadcastGlobalQueueStatus();

    // Broadcast queue players update to remaining players
    broadcastQueuePlayersUpdate(queueType).catch(err =>
      console.error('Failed to broadcast queue players update:', err)
    );

    // Leave coliseum room (async, fire and forget)
    getWebsocket().then(ws => {
      const roomName = `coliseum:${queueType}`;
      const { rooms } = ws;
      if (rooms.has(roomName)) {
        rooms.get(roomName).delete(userId);
      }

      // Send confirmation
      ws.sendToUser(userId, {
        type: 'coliseum:queue_left',
        payload: { queueType }
      });

      // Notify others of queue size change
      broadcastQueueUpdate(queueType);
    }).catch(err => console.error('Failed to leave coliseum room:', err));

    return true;
  }

  return false;
}

/**
 * Remove a player from the matchmaking queue
 * @param {string} queueType - Queue type or null for all queues
 * @param {number} userId - User ID
 * @returns {boolean} Success
 */
export function leaveQueue(queueType, userId) {
  if (queueType) {
    return removeFromQueue(queueType, userId);
  }

  // Remove from all queues
  let removed = false;
  matchmakingQueues.forEach((queue, type) => {
    if (removeFromQueue(type, userId)) {
      removed = true;
    }
  });

  return removed;
}

/**
 * Clean up player from all coliseum state (on disconnect)
 * @param {number} userId - User ID
 */
export async function cleanupPlayer(userId) {
  // Remove from all queues
  leaveQueue(null, userId);

  const ws = await getWebsocket();

  // Cancel any pending matches
  activeMatches.forEach((match, matchId) => {
    if (match.player1.userId === userId || match.player2.userId === userId) {
      if (match.status === 'pending') {
        const opponentId = match.player1.userId === userId
          ? match.player2.userId
          : match.player1.userId;

        // Send match_cancelled directly
        const opponentWs = ws.connections?.get(opponentId);
        if (opponentWs && opponentWs.readyState === 1) {
          opponentWs.send(JSON.stringify({
            type: 'coliseum:match_cancelled',
            payload: { matchId, reason: 'Opponent disconnected' }
          }));
        }

        // Re-queue opponent (preserve PPR)
        const queue = matchmakingQueues.get(match.queueType) || [];
        const opponent = match.player1.userId === userId ? match.player2 : match.player1;
        queue.unshift({
          userId: opponent.userId,
          username: opponent.username,
          partyLevel: opponent.partyLevel,
          ppr: opponent.ppr,
          queuedAt: Date.now()
        });

        activeMatches.delete(matchId);
      } else if (match.status === 'started' && match.battleId) {
        // Handle disconnect during active battle
        handlePlayerDisconnect(match.battleId, userId);
      }
    }
  });
}
