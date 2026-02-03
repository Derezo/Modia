/**
 * @module messageReliability
 * @description Server-side ACK tracking and retry system for WebSocket message delivery.
 *
 * Key responsibilities:
 * - Track pending ACKs per connection and battle
 * - Auto-retry messages up to MAX_RETRIES times
 * - Trigger full state sync when retries exhausted
 * - Cleanup stale pending ACKs periodically
 *
 * @see battleWebsocket.js - Uses this for reliable battle message delivery
 * @see websocket/index.js - WebSocket connection/room management
 */

import { WebSocket } from 'ws';

// ============================================================
// Configuration Constants
// ============================================================

/** Timeout before retrying unacknowledged messages (ms) */
export const ACK_TIMEOUT_MS = 2000;

/** Maximum retry attempts before triggering full state sync */
export const MAX_RETRIES = 3;

/** Interval for cleaning up stale pending ACKs (ms) */
export const CLEANUP_INTERVAL_MS = 30000;

// ============================================================
// State Tracking
// ============================================================

/**
 * Pending ACKs by connection: connectionId -> Map<seq, PendingMessage>
 * @type {Map<number, Map<number, PendingMessage>>}
 */
const pendingAcks = new Map();

/**
 * Sequence counters per battle per user: battleId -> Map<userId, currentSeq>
 * Each user gets independent sequences within a battle to prevent gaps
 * when broadcasting to multiple users.
 * @type {Map<number, Map<number, number>>}
 */
const battleSequences = new Map();

// ============================================================
// PendingMessage Class
// ============================================================

/**
 * Represents a message awaiting ACK
 */
class PendingMessage {
  /**
   * @param {Object} message - Original message payload
   * @param {WebSocket} ws - WebSocket connection
   * @param {number} battleId - Battle ID
   * @param {number} seq - Sequence number
   */
  constructor(message, ws, battleId, seq) {
    this.message = message;
    this.ws = ws;
    this.battleId = battleId;
    this.seq = seq;
    this.timestamp = Date.now();
    this.retries = 0;
    this.timeoutId = null;
  }
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Get the next sequence number for a battle and user
 * @param {number} battleId - Battle ID
 * @param {number} userId - User/connection ID
 * @returns {number} Next sequence number
 */
export function getNextSequence(battleId, userId) {
  if (!battleSequences.has(battleId)) {
    battleSequences.set(battleId, new Map());
  }
  const userSequences = battleSequences.get(battleId);

  const current = userSequences.get(userId) || 0;
  // Reset at a reasonable upper bound to prevent overflow
  const next = current >= Number.MAX_SAFE_INTEGER - 1 ? 1 : current + 1;
  userSequences.set(userId, next);
  return next;
}

/**
 * Send a message with ACK tracking and automatic retry
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Message to send (will have seq and ack added)
 * @param {number} battleId - Battle ID
 * @param {number} connectionId - Connection identifier (userId)
 * @returns {number} Sequence number assigned to the message, or -1 if connection not open
 */
export function sendWithAck(ws, message, battleId, connectionId) {
  // Check connection state BEFORE incrementing sequence to prevent gaps
  if (ws.readyState !== WebSocket.OPEN) {
    console.warn(`[MessageReliability] Cannot send - connection not open for connection=${connectionId}, readyState=${ws.readyState}`);
    return -1;
  }

  // Get next sequence number (only after confirming connection is open)
  const seq = getNextSequence(battleId, connectionId);

  // Add reliability fields to message
  const reliableMessage = {
    ...message,
    seq,
    ack: true,
    battleId
  };

  // Create pending message record
  const pending = new PendingMessage(reliableMessage, ws, battleId, seq);

  // Store in pending ACKs map
  if (!pendingAcks.has(connectionId)) {
    pendingAcks.set(connectionId, new Map());
  }
  pendingAcks.get(connectionId).set(seq, pending);

  // Schedule retry timeout BEFORE sending to prevent race condition:
  // If ACK arrives between send and setTimeout, the timeout would never be cleared
  pending.timeoutId = setTimeout(() => {
    scheduleRetry(connectionId, battleId, seq);
  }, ACK_TIMEOUT_MS);

  // Send the message
  try {
    ws.send(JSON.stringify(reliableMessage));
  } catch (error) {
    // Clear the timeout and remove pending since we failed to send
    clearTimeout(pending.timeoutId);
    pendingAcks.get(connectionId).delete(seq);
    console.error(`[MessageReliability] Failed to send message seq=${seq} to connection=${connectionId}:`, error);
    return -1;
  }

  return seq;
}

/**
 * Handle an incoming ACK from a client
 * @param {number} connectionId - Connection identifier (userId)
 * @param {number} battleId - Battle ID
 * @param {number} seq - Sequence number being acknowledged
 * @returns {boolean} True if ACK was expected and processed
 */
export function handleAck(connectionId, battleId, seq) {
  const connectionPending = pendingAcks.get(connectionId);
  if (!connectionPending) {
    return false;
  }

  const pending = connectionPending.get(seq);
  if (!pending) {
    return false;
  }

  // Verify battle ID matches
  if (pending.battleId !== battleId) {
    console.warn(`[MessageReliability] ACK battleId mismatch: expected=${pending.battleId}, received=${battleId}`);
    return false;
  }

  // Clear timeout and remove from pending
  if (pending.timeoutId) {
    clearTimeout(pending.timeoutId);
  }
  connectionPending.delete(seq);

  // Clean up empty connection map
  if (connectionPending.size === 0) {
    pendingAcks.delete(connectionId);
  }

  return true;
}

/**
 * Schedule a retry for an unacknowledged message
 * @param {number} connectionId - Connection identifier (userId)
 * @param {number} battleId - Battle ID
 * @param {number} seq - Sequence number to retry
 */
export function scheduleRetry(connectionId, battleId, seq) {
  const connectionPending = pendingAcks.get(connectionId);
  if (!connectionPending) {
    return;
  }

  const pending = connectionPending.get(seq);
  if (!pending) {
    return;
  }

  // Increment retry count
  pending.retries += 1;

  if (pending.retries >= MAX_RETRIES) {
    // Max retries exceeded - trigger full state sync
    console.warn(
      `[MessageReliability] Max retries (${MAX_RETRIES}) exceeded for ` +
      `connection=${connectionId}, battle=${battleId}, seq=${seq}. Triggering full state sync.`
    );
    triggerFullStateSync(pending.ws, battleId, connectionId);
    return;
  }

  // Check connection state first
  if (pending.ws.readyState !== WebSocket.OPEN) {
    // Connection closed, clean up
    cleanupConnectionPendingForBattle(connectionId, battleId);
    return;
  }

  // Schedule next retry timeout BEFORE sending to prevent race condition:
  // If ACK arrives between send and setTimeout, the timeout would never be cleared
  pending.timeoutId = setTimeout(() => {
    scheduleRetry(connectionId, battleId, seq);
  }, ACK_TIMEOUT_MS);

  // Resend the message
  try {
    pending.ws.send(JSON.stringify(pending.message));
    console.log(
      `[MessageReliability] Retry ${pending.retries}/${MAX_RETRIES} for ` +
      `connection=${connectionId}, battle=${battleId}, seq=${seq}`
    );
  } catch (error) {
    // Clear the timeout since we failed to send
    clearTimeout(pending.timeoutId);
    console.error('[MessageReliability] Retry send failed:', error);
  }
}

/**
 * Trigger a full state sync when message delivery fails after max retries
 * Sends battle:state_update message (fire-and-forget) and clears pending ACKs
 * @param {WebSocket} ws - WebSocket connection
 * @param {number} battleId - Battle ID
 * @param {number} connectionId - Connection identifier (userId)
 */
export async function triggerFullStateSync(ws, battleId, connectionId) {
  // Validate battleId is a positive integer before any operations
  const numericBattleId = parseInt(battleId, 10);
  if (isNaN(numericBattleId) || numericBattleId <= 0 || String(numericBattleId) !== String(battleId)) {
    console.warn(`[MessageReliability] Cannot sync - invalid battleId: ${battleId}`);
    return { success: false, reason: 'invalid_battle_id' };
  }

  // Clear all pending ACKs for this battle/connection
  cleanupConnectionPendingForBattle(connectionId, numericBattleId);

  // Check if connection is still open
  if (ws.readyState !== WebSocket.OPEN) {
    console.log('[MessageReliability] Cannot sync - connection closed');
    return { success: false, reason: 'connection_closed' };
  }

  try {
    const { query } = await import('../config/database.js');

    // Fetch current battle state from database
    const result = await query(
      'SELECT battle_state FROM battles WHERE id = $1 AND status = \'active\'',
      [numericBattleId]
    );

    if (result.rows.length > 0) {
      const state = result.rows[0].battle_state;
      ws.send(JSON.stringify({
        type: 'battle:state_update',
        payload: {
          battleId: numericBattleId,
          state,
          reason: 'full_sync',
          timestamp: Date.now()
        }
      }));
      console.log(`[MessageReliability] Full state sync sent for battle=${numericBattleId}, connection=${connectionId}`);
      return { success: true };
    } else {
      console.log(`[MessageReliability] No active battle found for battle=${numericBattleId}`);
      return { success: false, reason: 'battle_not_found' };
    }
  } catch (error) {
    console.error('[MessageReliability] Failed to send full state sync:', error);
    return { success: false, reason: 'sync_failed', error };
  }
}

/**
 * Clean up all pending ACKs for a specific connection
 * Called when a client disconnects
 * @param {number} connectionId - Connection identifier (userId)
 */
export function cleanupConnection(connectionId) {
  const connectionPending = pendingAcks.get(connectionId);
  if (!connectionPending) {
    return;
  }

  // Clear all timeouts
  for (const pending of connectionPending.values()) {
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }
  }

  // Remove from map
  pendingAcks.delete(connectionId);
  console.log(`[MessageReliability] Cleaned up pending ACKs for connection=${connectionId}`);
}

/**
 * Clean up all pending ACKs for a specific connection and battle
 * @param {number} connectionId - Connection identifier (userId)
 * @param {number} battleId - Battle ID
 */
function cleanupConnectionPendingForBattle(connectionId, battleId) {
  const connectionPending = pendingAcks.get(connectionId);
  if (!connectionPending) {
    return;
  }

  // Find and remove all pending messages for this battle
  const seqsToRemove = [];
  for (const [seq, pending] of connectionPending.entries()) {
    if (pending.battleId === battleId) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      seqsToRemove.push(seq);
    }
  }

  for (const seq of seqsToRemove) {
    connectionPending.delete(seq);
  }

  // Clean up empty connection map
  if (connectionPending.size === 0) {
    pendingAcks.delete(connectionId);
  }
}

/**
 * Clean up user sequence for a specific user in a battle
 * Called when a user leaves a battle
 * @param {number} battleId - Battle ID
 * @param {number} userId - User ID
 */
export function cleanupUserSequence(battleId, userId) {
  const userSequences = battleSequences.get(battleId);
  if (userSequences) {
    userSequences.delete(userId);
    if (userSequences.size === 0) {
      battleSequences.delete(battleId);
    }
  }
}

/**
 * Clean up all state for a battle (sequence counter and all pending ACKs)
 * Called when a battle ends
 * @param {number} battleId - Battle ID
 */
export function cleanupBattle(battleId) {
  // Clear sequence counter (entire battle map)
  battleSequences.delete(battleId);

  // Clear all pending ACKs for this battle across all connections
  for (const [connectionId, connectionPending] of pendingAcks.entries()) {
    const seqsToRemove = [];
    for (const [seq, pending] of connectionPending.entries()) {
      if (pending.battleId === battleId) {
        if (pending.timeoutId) {
          clearTimeout(pending.timeoutId);
        }
        seqsToRemove.push(seq);
      }
    }

    for (const seq of seqsToRemove) {
      connectionPending.delete(seq);
    }

    // Clean up empty connection map
    if (connectionPending.size === 0) {
      pendingAcks.delete(connectionId);
    }
  }

  console.log(`[MessageReliability] Cleaned up battle=${battleId}`);
}

// ============================================================
// Broadcast Helper
// ============================================================

/**
 * Broadcast a message with ACK tracking to all connections in a room
 * @param {WebSocketServer} wss - WebSocket server instance (not used, kept for API compatibility)
 * @param {string} roomName - Room name (e.g., 'battle:123')
 * @param {Object} message - Message to broadcast
 * @param {number} battleId - Battle ID
 * @returns {Promise<Map<number, number>>} Map of connectionId -> sequence number (only successful sends)
 */
export async function broadcastWithAck(wss, roomName, message, battleId) {
  // Lazy-load websocket module to avoid circular dependency
  const websocket = await import('../websocket/index.js');
  const { rooms, connections } = websocket;

  const results = new Map();

  // Get all user IDs in the room
  const roomUsers = rooms.get(roomName);
  if (!roomUsers || roomUsers.size === 0) {
    return results;
  }

  // Send to each connection with ACK tracking
  for (const userId of roomUsers) {
    const ws = connections.get(userId);
    if (ws) {
      const seq = sendWithAck(ws, message, battleId, userId);
      // Only include successful sends (seq >= 1) in results
      if (seq >= 1) {
        results.set(userId, seq);
      }
    }
  }

  return results;
}

// ============================================================
// Cleanup Interval
// ============================================================

/**
 * Clean up stale pending ACKs (messages older than CLEANUP_INTERVAL_MS)
 */
function cleanupStalePendingAcks() {
  const now = Date.now();
  const staleThreshold = CLEANUP_INTERVAL_MS;

  for (const [connectionId, connectionPending] of pendingAcks.entries()) {
    const seqsToRemove = [];
    for (const [seq, pending] of connectionPending.entries()) {
      if (now - pending.timestamp > staleThreshold) {
        if (pending.timeoutId) {
          clearTimeout(pending.timeoutId);
        }
        seqsToRemove.push(seq);
        console.warn(
          '[MessageReliability] Cleaning up stale pending ACK: ' +
          `connection=${connectionId}, battle=${pending.battleId}, seq=${seq}, age=${now - pending.timestamp}ms`
        );
      }
    }

    for (const seq of seqsToRemove) {
      connectionPending.delete(seq);
    }

    // Clean up empty connection map
    if (connectionPending.size === 0) {
      pendingAcks.delete(connectionId);
    }
  }
}

// Start cleanup interval
let cleanupIntervalId = null;

/**
 * Start the cleanup interval (called on module load)
 */
function startCleanupInterval() {
  if (cleanupIntervalId) {
    return; // Already running
  }
  cleanupIntervalId = setInterval(cleanupStalePendingAcks, CLEANUP_INTERVAL_MS);
  // Don't keep process alive just for this interval
  if (cleanupIntervalId.unref) {
    cleanupIntervalId.unref();
  }
}

/**
 * Stop the cleanup interval (for testing/shutdown)
 */
export function stopCleanupInterval() {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}

// Start cleanup on module load
startCleanupInterval();

// ============================================================
// Debug/Testing Helpers
// ============================================================

/**
 * Get pending ACK count for a connection (for testing)
 * @param {number} connectionId - Connection identifier
 * @returns {number} Number of pending ACKs
 */
export function getPendingCount(connectionId) {
  const connectionPending = pendingAcks.get(connectionId);
  return connectionPending ? connectionPending.size : 0;
}

/**
 * Get all pending ACKs for a connection (for testing)
 * @param {number} connectionId - Connection identifier
 * @returns {Map<number, PendingMessage>|undefined} Pending messages map
 */
export function getPendingAcks(connectionId) {
  return pendingAcks.get(connectionId);
}

/**
 * Get current sequence number for a battle (for testing)
 * @param {number} battleId - Battle ID
 * @param {number} [userId] - Optional user ID. If provided, returns that user's sequence.
 *                            If not provided, returns max sequence across all users (backwards compat).
 * @returns {number} Current sequence number
 */
export function getCurrentSequence(battleId, userId = null) {
  const userSequences = battleSequences.get(battleId);
  if (!userSequences) return 0;

  if (userId !== null) {
    return userSequences.get(userId) || 0;
  }

  // Backwards compat: return max sequence across all users
  let maxSeq = 0;
  for (const seq of userSequences.values()) {
    if (seq > maxSeq) maxSeq = seq;
  }
  return maxSeq;
}

// ============================================================
// Default Export
// ============================================================

export default {
  // Configuration
  ACK_TIMEOUT_MS,
  MAX_RETRIES,
  CLEANUP_INTERVAL_MS,

  // Core functions
  getNextSequence,
  sendWithAck,
  handleAck,
  scheduleRetry,
  triggerFullStateSync,
  cleanupConnection,
  cleanupUserSequence,
  cleanupBattle,
  broadcastWithAck,

  // Interval management
  stopCleanupInterval,

  // Testing helpers
  getPendingCount,
  getPendingAcks,
  getCurrentSequence
};
