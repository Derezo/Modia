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
import {
  createBattleStateSnapshotV1,
  negotiateBattleMapCapabilities
} from '../../../shared/battleStateProtocol.js';
import {
  BattleStateNotFoundError,
  battleStateRepository
} from './battle/BattleStateRepository.js';
import {
  assertBattleMapWirePayloadWithinBudget,
  isBattleMapReferenceDeltaEnabled,
  recordBattleMapCapabilityNegotiation,
  recordBattleMapSchemaOrHashRejection,
  recordBattleMapWebsocketDelivery
} from './battle/BattleMapOperations.js';
import { getParticipantBattleView } from './battleOutcomeService.js';
import { getParticipantAvailableActions } from
  './battle/participantActionAvailability.js';

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
 * Pending ACKs by connection: connectionId -> Map<battleId:seq, PendingMessage>
 * @type {Map<number, Map<string, PendingMessage>>}
 */
const pendingAcks = new Map();

/**
 * Sequence counters per battle per user: normalized battleId -> Map<userId, currentSeq>
 * Each user gets independent sequences within a battle to prevent gaps
 * when broadcasting to multiple users.
 * @type {Map<string, Map<number, number>>}
 */
const battleSequences = new Map();

/**
 * Explicitly declared map capabilities by WebSocket and battle. A missing
 * entry is intentionally different from a legacy V1 declaration: it must
 * never be treated as V2 support.
 * @type {WeakMap<WebSocket, Map<number, Object>>}
 */
const battleMapCapabilitiesBySocket = new WeakMap();

/**
 * In-flight full-state recovery by normalized connection and battle. Reliable
 * deltas use this barrier so a snapshot loaded asynchronously cannot be sent
 * after a newer update for the same recipient and battle.
 * @type {Map<string, { barrier: Promise<void>, completion: Promise<Object> }>}
 */
const fullSyncRecoveries = new Map();

/**
 * Store an explicit capability declaration for later reliability resyncs.
 * Validation is performed by negotiation before this function is called.
 */
export function registerBattleMapCapabilities(ws, battleId, capabilities) {
  const numericBattleId = Number(battleId);
  if (!ws || !Number.isSafeInteger(numericBattleId) || numericBattleId <= 0) {
    throw new TypeError('A WebSocket and positive integer battleId are required');
  }
  if (capabilities === undefined || capabilities === null) {
    battleMapCapabilitiesBySocket.get(ws)?.delete(numericBattleId);
    return;
  }
  let socketCapabilities = battleMapCapabilitiesBySocket.get(ws);
  if (!socketCapabilities) {
    socketCapabilities = new Map();
    battleMapCapabilitiesBySocket.set(ws, socketCapabilities);
  }
  socketCapabilities.set(numericBattleId, capabilities);
}

export function getRegisteredBattleMapCapabilities(ws, battleId) {
  return battleMapCapabilitiesBySocket.get(ws)?.get(Number(battleId));
}

/**
 * Negotiate delivery against the persisted map envelope and build the exact
 * revisioned snapshot when the declaration is compatible.
 */
export function createNegotiatedBattleStateSnapshot(
  battle,
  clientCapabilities,
  options = {}
) {
  const isV3Battle = battle.battleMapSchemaVersion === 3;
  const referenceDeltaEnabled = options.referenceDeltaEnabled ??
    (isV3Battle ? false : isBattleMapReferenceDeltaEnabled());
  const hadCachedMaps = Array.isArray(clientCapabilities?.cachedMaps)
    && clientCapabilities.cachedMaps.length > 0;
  // V3 activation and transport are catalog-driven, never runtime-gated.
  // Keep the legacy V2 rollout behavior isolated to V2 snapshots.
  const allowCachedMapReference = isV3Battle || referenceDeltaEnabled;
  const effectiveCapabilities = !allowCachedMapReference && clientCapabilities
    ? { ...clientCapabilities, cachedMaps: [] }
    : clientCapabilities;
  let negotiation;
  try {
    negotiation = negotiateBattleMapCapabilities({
      clientCapabilities: effectiveCapabilities,
      existingMap: battle.map
    });
  } catch (error) {
    recordBattleMapSchemaOrHashRejection();
    throw error;
  }
  recordBattleMapCapabilityNegotiation({
    compatible: negotiation.compatible,
    mapDelivery: negotiation.mapDelivery,
    hadCachedMaps
  });
  if (!negotiation.compatible) {
    return { negotiation, snapshot: null };
  }
  let snapshot;
  try {
    snapshot = createBattleStateSnapshotV1({
      battleId: battle.battleId,
      stateRevision: battle.stateRevision,
      battleMap: battle.map,
      mutableState: battle.mutableState,
      mapDelivery: negotiation.mapDelivery
    });
  } catch (error) {
    recordBattleMapSchemaOrHashRejection();
    throw error;
  }
  assertBattleMapWirePayloadWithinBudget(snapshot, 'initialSnapshot');
  return { negotiation, snapshot };
}

export function createBattleMapUpgradeRequiredPayload(negotiation) {
  return {
    code: 'battle_map_upgrade_required',
    message: 'This battle map requires a newer client.',
    requiredBattleMapSchemaVersion: negotiation.requiredBattleMapSchemaVersion,
    requiredHashVersion: negotiation.requiredHashVersion,
    requiredMutableStateProtocolVersion: negotiation.requiredMutableStateProtocolVersion
  };
}

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
    this.isRecoverySnapshot =
      message?.type === 'battle:state_update' &&
      message?.payload?.reason === 'full_sync';
    this.timestamp = Date.now();
    this.retries = 0;
    this.timeoutId = null;
  }
}

// ============================================================
// Core Functions
// ============================================================

function getBattleIdentity(battleId) {
  return String(battleId);
}

function getPendingAckKey(battleId, seq) {
  return `${getBattleIdentity(battleId)}:${seq}`;
}

function getFullSyncRecoveryKey(connectionId, battleId) {
  return `${String(connectionId)}:${getBattleIdentity(battleId)}`;
}

function handleDetachedRetry(connectionId, battleId, seq) {
  void scheduleRetry(connectionId, battleId, seq).catch(error => {
    recordBattleMapWebsocketDelivery('recovery_failed');
    console.error('[MessageReliability] Retry processing failed:', error);
  });
}

/**
 * Classify reliable battle-state messages for the configured wire budgets.
 * Full snapshots take precedence if a payload happens to contain both forms.
 *
 * @param {Object} message - Message before or after reliability decoration
 * @returns {'initialSnapshot'|'mutableDelta'|null}
 */
export function classifyReliableBattleMapWirePayload(message) {
  if (message?.type !== 'battle:state_update' || !message.payload) {
    return null;
  }
  if (
    message.payload.snapshot !== undefined ||
    message.payload.state !== undefined ||
    message.payload.reason === 'full_sync'
  ) {
    return 'initialSnapshot';
  }
  if (message.payload.update !== undefined) {
    return 'mutableDelta';
  }
  return null;
}

/**
 * Measure the exact ACK-decorated object that will be serialized and sent.
 * The shared assertion owns the same bounded per-message compression model as
 * the WebSocket server.
 *
 * @param {Object} reliableMessage - Final outbound reliable message
 * @returns {Object|null} Measured sizes, or null for non battle-map messages
 */
export function assertReliableBattleMapWirePayloadWithinBudget(reliableMessage) {
  const kind = classifyReliableBattleMapWirePayload(reliableMessage);
  return kind
    ? assertBattleMapWirePayloadWithinBudget(reliableMessage, kind)
    : null;
}

/**
 * Get the next sequence number for a battle and user
 * @param {number} battleId - Battle ID
 * @param {number} userId - User/connection ID
 * @returns {number} Next sequence number
 */
export function getNextSequence(battleId, userId) {
  const battleIdentity = getBattleIdentity(battleId);
  if (!battleSequences.has(battleIdentity)) {
    battleSequences.set(battleIdentity, new Map());
  }
  const userSequences = battleSequences.get(battleIdentity);

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
    recordBattleMapWebsocketDelivery('send_failed');
    return -1;
  }

  // Get next sequence number (only after confirming connection is open).
  // Preserve the previous state so a local wire-budget rejection can be
  // replaced by a fallback without leaving a sequence gap.
  const battleIdentity = getBattleIdentity(battleId);
  const existingUserSequences = battleSequences.get(battleIdentity);
  const hadPreviousSequence = existingUserSequences?.has(connectionId) === true;
  const previousSequence = existingUserSequences?.get(connectionId);
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
  const pendingKey = getPendingAckKey(battleId, seq);
  pendingAcks.get(connectionId).set(pendingKey, pending);

  // Schedule retry timeout BEFORE sending to prevent race condition:
  // If ACK arrives between send and setTimeout, the timeout would never be cleared
  pending.timeoutId = setTimeout(() => {
    handleDetachedRetry(connectionId, battleId, seq);
  }, ACK_TIMEOUT_MS);

  // Validate the exact serialized envelope, including reliability metadata,
  // immediately before transmission. Roll sequence state back on rejection so
  // an async caller can safely replace an oversized delta with a full snapshot.
  try {
    assertReliableBattleMapWirePayloadWithinBudget(reliableMessage);
  } catch (error) {
    clearTimeout(pending.timeoutId);
    pendingAcks.get(connectionId).delete(pendingKey);
    if (pendingAcks.get(connectionId).size === 0) {
      pendingAcks.delete(connectionId);
    }
    const userSequences = battleSequences.get(battleIdentity);
    if (hadPreviousSequence) {
      userSequences?.set(connectionId, previousSequence);
    } else {
      userSequences?.delete(connectionId);
      if (userSequences?.size === 0) {
        battleSequences.delete(battleIdentity);
      }
    }
    throw error;
  }

  // Send the message
  try {
    ws.send(JSON.stringify(reliableMessage));
    recordBattleMapWebsocketDelivery('sent');
  } catch (error) {
    // Clear the timeout and remove pending since we failed to send
    clearTimeout(pending.timeoutId);
    pendingAcks.get(connectionId).delete(pendingKey);
    recordBattleMapWebsocketDelivery('send_failed');
    console.error(`[MessageReliability] Failed to send message seq=${seq} to connection=${connectionId}:`, error);
    return -1;
  }

  return seq;
}

/**
 * Send once any older full-state recovery for this connection and battle has
 * completed its send attempt. The final recovery check and synchronous
 * sendWithAck call happen in the same JavaScript turn, so a newly-started
 * recovery cannot interleave between them.
 *
 * Battle state broadcasters should use this helper for mutable deltas. Full
 * recovery itself continues to use sendWithAck to avoid waiting on its own
 * barrier.
 */
export async function sendWithAckAfterRecovery(
  ws,
  message,
  battleId,
  connectionId
) {
  const recoveryKey = getFullSyncRecoveryKey(connectionId, battleId);
  let recovery = fullSyncRecoveries.get(recoveryKey);
  while (recovery) {
    await recovery.barrier;
    recovery = fullSyncRecoveries.get(recoveryKey);
  }
  return sendWithAck(ws, message, battleId, connectionId);
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

  const pendingKey = getPendingAckKey(battleId, seq);
  const pending = connectionPending.get(pendingKey);
  if (!pending) {
    return false;
  }

  // Verify battle ID matches
  if (getBattleIdentity(pending.battleId) !== getBattleIdentity(battleId)) {
    console.warn(`[MessageReliability] ACK battleId mismatch: expected=${pending.battleId}, received=${battleId}`);
    return false;
  }

  // Clear timeout and remove from pending
  if (pending.timeoutId) {
    clearTimeout(pending.timeoutId);
  }
  connectionPending.delete(pendingKey);

  // Clean up empty connection map
  if (connectionPending.size === 0) {
    pendingAcks.delete(connectionId);
  }

  recordBattleMapWebsocketDelivery('acked');
  if (pending.isRecoverySnapshot) {
    recordBattleMapWebsocketDelivery('recovery_succeeded');
  }
  return true;
}

/**
 * Schedule a retry for an unacknowledged message
 * @param {number} connectionId - Connection identifier (userId)
 * @param {number} battleId - Battle ID
 * @param {number} seq - Sequence number to retry
 */
export async function scheduleRetry(connectionId, battleId, seq) {
  const connectionPending = pendingAcks.get(connectionId);
  if (!connectionPending) {
    return;
  }

  const pendingKey = getPendingAckKey(battleId, seq);
  const pending = connectionPending.get(pendingKey);
  if (!pending) {
    return;
  }

  // A manually triggered retry can run before the current timer fires. Clear
  // that timer so only one retry/recovery chain remains active.
  if (pending.timeoutId) {
    clearTimeout(pending.timeoutId);
    pending.timeoutId = null;
  }

  // Increment retry count
  pending.retries += 1;

  if (pending.retries >= MAX_RETRIES) {
    // A recovery snapshot is itself ACK-tracked. If it exhausts its retry
    // budget, stop instead of recursively producing another recovery snapshot.
    // The client must reconnect or use the revision heartbeat/resync path.
    if (pending.isRecoverySnapshot) {
      console.warn(
        '[MessageReliability] Recovery snapshot exhausted retries for ' +
        `connection=${connectionId}, battle=${battleId}, seq=${seq}.`
      );
      recordBattleMapWebsocketDelivery('ack_exhausted');
      recordBattleMapWebsocketDelivery('recovery_failed');
      cleanupConnectionPendingForBattle(connectionId, battleId);
      return;
    }

    // Max retries exceeded - replace every pending update for this battle with
    // one fresh, persisted, ACK-tracked state snapshot.
    console.warn(
      `[MessageReliability] Max retries (${MAX_RETRIES}) exceeded for ` +
      `connection=${connectionId}, battle=${battleId}, seq=${seq}. Triggering full state sync.`
    );
    recordBattleMapWebsocketDelivery('ack_exhausted');
    return triggerFullStateSync(pending.ws, pending.battleId, connectionId);
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
    handleDetachedRetry(connectionId, pending.battleId, seq);
  }, ACK_TIMEOUT_MS);

  // Resend the message
  try {
    pending.ws.send(JSON.stringify(pending.message));
    recordBattleMapWebsocketDelivery('retry');
    console.log(
      `[MessageReliability] Retry ${pending.retries}/${MAX_RETRIES} for ` +
      `connection=${connectionId}, battle=${battleId}, seq=${seq}`
    );
  } catch (error) {
    // Keep the already-scheduled timeout. A synchronous transport failure is
    // still an unacknowledged delivery attempt and must progress to another
    // retry or terminal recovery instead of becoming permanently pending.
    recordBattleMapWebsocketDelivery('send_failed');
    console.error('[MessageReliability] Retry send failed:', error);
  }
}

/**
 * Trigger a full state sync when message delivery fails after max retries
 * Queues the latest authoritative battle snapshot with ACK tracking and clears
 * superseded pending ACKs. Recovery is considered successful only when the
 * client acknowledges this fresh snapshot.
 * Terminal battles remain loadable so a dropped battle:end can converge after
 * the database transaction has completed.
 * @param {WebSocket} ws - WebSocket connection
 * @param {number} battleId - Battle ID
 * @param {number} connectionId - Connection identifier (userId)
 */
export async function triggerFullStateSync(ws, battleId, connectionId) {
  // Validate battleId is a positive integer before any operations
  const numericBattleId = parseInt(battleId, 10);
  if (isNaN(numericBattleId) || numericBattleId <= 0 || String(numericBattleId) !== String(battleId)) {
    console.warn(`[MessageReliability] Cannot sync - invalid battleId: ${battleId}`);
    recordBattleMapWebsocketDelivery('recovery_failed');
    return { success: false, reason: 'invalid_battle_id' };
  }

  const recoveryKey = getFullSyncRecoveryKey(connectionId, numericBattleId);
  const existingRecovery = fullSyncRecoveries.get(recoveryKey);
  if (existingRecovery) {
    return existingRecovery.completion;
  }

  let releaseRecovery;
  const recovery = {
    barrier: new Promise(resolve => {
      releaseRecovery = resolve;
    }),
    completion: null
  };
  fullSyncRecoveries.set(recoveryKey, recovery);

  recovery.completion = performFullStateSync(
    ws,
    numericBattleId,
    connectionId
  ).finally(() => {
    if (fullSyncRecoveries.get(recoveryKey) === recovery) {
      fullSyncRecoveries.delete(recoveryKey);
    }
    releaseRecovery();
  });
  return recovery.completion;
}

async function performFullStateSync(ws, numericBattleId, connectionId) {
  // Clear all pending ACKs for this battle/connection
  cleanupConnectionPendingForBattle(connectionId, numericBattleId);

  // Check if connection is still open
  if (ws.readyState !== WebSocket.OPEN) {
    console.log('[MessageReliability] Cannot sync - connection closed');
    recordBattleMapWebsocketDelivery('recovery_failed');
    return { success: false, reason: 'connection_closed' };
  }

  try {
    const persistedBattle = await battleStateRepository.loadBattle(numericBattleId);
    const battle = getParticipantBattleView(persistedBattle, connectionId);
    const clientCapabilities = getRegisteredBattleMapCapabilities(ws, numericBattleId);
    const { negotiation, snapshot } = createNegotiatedBattleStateSnapshot(
      battle,
      clientCapabilities
    );

    if (!negotiation.compatible) {
      ws.send(JSON.stringify({
        type: 'battle_map_upgrade_required',
        payload: createBattleMapUpgradeRequiredPayload(negotiation)
      }));
      recordBattleMapWebsocketDelivery('recovery_failed');
      return { success: false, reason: 'battle_map_upgrade_required' };
    }

    const payload = {
      battleId: numericBattleId,
      stateRevision: battle.stateRevision,
      availableActions: getParticipantAvailableActions(
        battle,
        battle.state,
        connectionId
      ),
      snapshot,
      reason: 'full_sync',
      timestamp: Date.now()
    };
    if (battle.battleMapSchemaVersion === 1) {
      payload.state = battle.state;
    }
    if (clientCapabilities !== undefined) {
      payload.battleMapCapabilities = negotiation;
    }

    const sequence = sendWithAck(ws, {
      type: 'battle:state_update',
      payload
    }, numericBattleId, connectionId);
    if (sequence < 0) {
      recordBattleMapWebsocketDelivery('recovery_failed');
      return { success: false, reason: 'snapshot_send_failed' };
    }
    console.log(
      '[MessageReliability] Full state sync awaiting ACK for ' +
      `battle=${numericBattleId}, connection=${connectionId}, seq=${sequence}`
    );
    return {
      success: true,
      awaitingAck: true,
      sequence,
      stateRevision: battle.stateRevision
    };
  } catch (error) {
    if (error instanceof BattleStateNotFoundError) {
      console.log(`[MessageReliability] Battle not found for battle=${numericBattleId}`);
      recordBattleMapWebsocketDelivery('recovery_failed');
      return { success: false, reason: 'battle_not_found' };
    }
    recordBattleMapWebsocketDelivery('recovery_failed');
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
  for (const [pendingKey, pending] of connectionPending.entries()) {
    if (getBattleIdentity(pending.battleId) === getBattleIdentity(battleId)) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      seqsToRemove.push(pendingKey);
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
  const battleIdentity = getBattleIdentity(battleId);
  const userSequences = battleSequences.get(battleIdentity);
  if (userSequences) {
    userSequences.delete(userId);
    if (userSequences.size === 0) {
      battleSequences.delete(battleIdentity);
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
  battleSequences.delete(getBattleIdentity(battleId));

  // Clear all pending ACKs for this battle across all connections
  for (const [connectionId, connectionPending] of pendingAcks.entries()) {
    const seqsToRemove = [];
    for (const [pendingKey, pending] of connectionPending.entries()) {
      if (getBattleIdentity(pending.battleId) === getBattleIdentity(battleId)) {
        if (pending.timeoutId) {
          clearTimeout(pending.timeoutId);
        }
        seqsToRemove.push(pendingKey);
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
    for (const [pendingKey, pending] of connectionPending.entries()) {
      if (now - pending.timestamp > staleThreshold) {
        if (pending.timeoutId) {
          clearTimeout(pending.timeoutId);
        }
        seqsToRemove.push(pendingKey);
        console.warn(
          '[MessageReliability] Cleaning up stale pending ACK: ' +
          `connection=${connectionId}, battle=${pending.battleId}, seq=${pending.seq}, age=${now - pending.timestamp}ms`
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
 * @returns {Map<string, PendingMessage>|undefined} Pending messages map
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
  const userSequences = battleSequences.get(getBattleIdentity(battleId));
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
  sendWithAckAfterRecovery,
  classifyReliableBattleMapWirePayload,
  assertReliableBattleMapWirePayloadWithinBudget,
  handleAck,
  scheduleRetry,
  triggerFullStateSync,
  registerBattleMapCapabilities,
  getRegisteredBattleMapCapabilities,
  createNegotiatedBattleStateSnapshot,
  createBattleMapUpgradeRequiredPayload,
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
