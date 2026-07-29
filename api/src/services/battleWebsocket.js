/**
 * @module battleWebsocket
 * @description Battle WebSocket Service - Handles real-time battle event broadcasting
 * with message reliability for critical events.
 *
 * Key responsibilities:
 * - Room management for battle participants
 * - Broadcasting state updates and turn events
 * - ACK-required messaging for critical battle events
 * - Fire-and-forget for non-critical/self-correcting messages
 *
 * @see messageReliability.js - ACK tracking and retry system
 * @see websocket/index.js - WebSocket connection/room management
 */

import { assertBattleMutableStateUpdateV1 } from '../../../shared/battleStateProtocol.js';
import { battleStateRepository } from './battle/BattleStateRepository.js';
import {
  ACK_TIMEOUT_MS,
  MAX_RETRIES,
  broadcastWithAck,
  cleanupBattle as cleanupBattleAcks,
  cleanupUserSequence,
  createBattleMapUpgradeRequiredPayload,
  createNegotiatedBattleStateSnapshot,
  getRegisteredBattleMapCapabilities,
  sendWithAck,
  sendWithAckAfterRecovery
} from './messageReliability.js';
import {
  assertBattleMapWirePayloadWithinBudget,
  isBattleMapReferenceDeltaEnabled,
  recordBattleMapReferenceDeltaFallback
} from './battle/BattleMapOperations.js';
import { getParticipantBattleView } from './battleOutcomeService.js';

// Lazy-load websocket to avoid circular dependency
let _websocket = null;
async function getWebsocket() {
  if (!_websocket) {
    _websocket = await import('../websocket/index.js');
  }
  return _websocket;
}

// Track battle rooms: battleId -> Set of userIds
const battleRooms = new Map();

function getParticipantStateUpdate(update, userId) {
  const { mutableState } = update;
  if (mutableState.status !== 'victory' && mutableState.status !== 'defeat') {
    return update;
  }

  const participantBattle = getParticipantBattleView({
    battleType: mutableState.battleType,
    player1Id: mutableState.player1Id,
    player2Id: mutableState.player2Id,
    winnerId: mutableState.winnerId,
    status: mutableState.status,
    rewards: mutableState.rewards,
    mutableState
  }, userId);

  return {
    ...update,
    mutableState: participantBattle.mutableState
  };
}

/**
 * Join a user to a battle room
 * @param {number} battleId - Battle ID
 * @param {number} userId - User ID
 */
async function joinBattle(battleId, userId) {
  const roomName = `battle:${battleId}`;

  if (!battleRooms.has(battleId)) {
    battleRooms.set(battleId, new Set());
  }
  battleRooms.get(battleId).add(userId);

  // Also add to WebSocket room system
  const ws = await getWebsocket();
  const { rooms } = ws;
  if (!rooms.has(roomName)) {
    rooms.set(roomName, new Set());
  }
  rooms.get(roomName).add(userId);
}

/**
 * Remove a user from a battle room
 * @param {number} battleId - Battle ID
 * @param {number} userId - User ID
 */
async function leaveBattle(battleId, userId) {
  const roomName = `battle:${battleId}`;

  if (battleRooms.has(battleId)) {
    battleRooms.get(battleId).delete(userId);
    if (battleRooms.get(battleId).size === 0) {
      battleRooms.delete(battleId);
    }
  }

  // Remove from WebSocket room
  const ws = await getWebsocket();
  const { rooms } = ws;
  if (rooms.has(roomName)) {
    rooms.get(roomName).delete(userId);
    if (rooms.get(roomName).size === 0) {
      rooms.delete(roomName);
    }
  }

  // Clean up user's sequence counter to prevent memory accumulation
  cleanupUserSequence(battleId, userId);
}

/**
 * Broadcast battle state update to all participants
 * CRITICAL: Uses ACK-required, per-client delivery. Clients that declared the
 * revisioned protocol receive only the immutable-map reference plus mutable
 * update. Undeclared legacy clients receive the authoritative flattened state.
 * @param {number} battleId - Battle ID
 * @param {Object} update - BattleMutableStateUpdateV1 from BattleStateRepository
 * @param {number} excludeUserId - Optional user to exclude from broadcast
 * @returns {Promise<Map<number, number>>} userId -> reliability sequence
 */
async function broadcastStateUpdate(battleId, update, excludeUserId = null) {
  assertBattleMutableStateUpdateV1(update);
  if (String(update.battleId) !== String(battleId)) {
    throw new TypeError(
      `State update battleId ${update.battleId} does not match room battleId ${battleId}`
    );
  }

  const roomName = `battle:${battleId}`;
  const ws = await getWebsocket();
  const { rooms, connections } = ws;
  const roomUsers = rooms.get(roomName);
  const results = new Map();
  if (!roomUsers || roomUsers.size === 0) return results;

  const recipients = [...roomUsers].filter(userId => userId !== excludeUserId);
  let useReferenceDelta = isBattleMapReferenceDeltaEnabled();
  if (useReferenceDelta) {
    try {
      assertBattleMapWirePayloadWithinBudget(update, 'mutableDelta');
    } catch (error) {
      if (error?.code !== 'BATTLE_MAP_WIRE_PAYLOAD_TOO_LARGE') throw error;
      useReferenceDelta = false;
      recordBattleMapReferenceDeltaFallback();
    }
  } else {
    recordBattleMapReferenceDeltaFallback();
  }
  const hasLegacyRecipient = recipients.some(userId => {
    const connection = connections.get(userId);
    return connection && getRegisteredBattleMapCapabilities(connection, battleId) === undefined;
  });
  let persistedEnvelope = hasLegacyRecipient || !useReferenceDelta
    ? await battleStateRepository.loadBattle(battleId)
    : null;
  const loadPersistedEnvelope = async () => {
    persistedEnvelope ??= await battleStateRepository.loadBattle(battleId);
    return persistedEnvelope;
  };

  for (const userId of recipients) {
    const connection = connections.get(userId);
    if (!connection) continue;

    const declaredCapabilities = getRegisteredBattleMapCapabilities(connection, battleId);
    const payload = {
      battleId,
      stateRevision: update.stateRevision,
      timestamp: Date.now()
    };
    if (declaredCapabilities === undefined) {
      payload.state = getParticipantBattleView(
        await loadPersistedEnvelope(),
        userId
      ).state;
    } else if (useReferenceDelta) {
      payload.update = getParticipantStateUpdate(update, userId);
    } else {
      const participantBattle = getParticipantBattleView(
        await loadPersistedEnvelope(),
        userId
      );
      const { negotiation, snapshot } = createNegotiatedBattleStateSnapshot(
        participantBattle,
        declaredCapabilities,
        { referenceDeltaEnabled: false }
      );
      if (!negotiation.compatible) {
        sendWithAck(connection, {
          type: 'battle_map_upgrade_required',
          payload: createBattleMapUpgradeRequiredPayload(negotiation)
        }, battleId, userId);
        continue;
      }
      payload.snapshot = snapshot;
      payload.battleMapCapabilities = negotiation;
    }

    let seq;
    try {
      seq = await sendWithAckAfterRecovery(connection, {
        type: 'battle:state_update',
        payload
      }, battleId, userId);
    } catch (error) {
      // The reliability metadata and participant-specific projection are part
      // of the actual wire envelope. If those final bytes push a reference
      // delta over its smaller budget, retry the same sequence slot with a
      // negotiated full snapshot rather than dropping the state update.
      if (
        error?.code !== 'BATTLE_MAP_WIRE_PAYLOAD_TOO_LARGE' ||
        payload.update === undefined
      ) {
        throw error;
      }

      recordBattleMapReferenceDeltaFallback();
      const participantBattle = getParticipantBattleView(
        await loadPersistedEnvelope(),
        userId
      );
      const { negotiation, snapshot } = createNegotiatedBattleStateSnapshot(
        participantBattle,
        declaredCapabilities,
        { referenceDeltaEnabled: false }
      );
      if (!negotiation.compatible) {
        sendWithAck(connection, {
          type: 'battle_map_upgrade_required',
          payload: createBattleMapUpgradeRequiredPayload(negotiation)
        }, battleId, userId);
        continue;
      }

      delete payload.update;
      payload.snapshot = snapshot;
      payload.battleMapCapabilities = negotiation;
      seq = await sendWithAckAfterRecovery(connection, {
        type: 'battle:state_update',
        payload
      }, battleId, userId);
    }
    if (seq >= 1) results.set(userId, seq);
  }

  return results;
}

/**
 * Broadcast unit movement event
 * CRITICAL: Uses ACK-required messaging for position consistency
 * @param {number} battleId - Battle ID
 * @param {number} unitId - Unit that moved
 * @param {Object} from - Previous position { x, y }
 * @param {Object} to - New position { x, y }
 * @param {number} submitterId - Optional userId who submitted the move (for frontend dedup)
 */
async function broadcastUnitMoved(battleId, unitId, from, to, submitterId = null) {
  const roomName = `battle:${battleId}`;

  // Use ACK-required broadcast for position consistency
  await broadcastWithAck(null, roomName, {
    type: 'battle:unit_moved',
    payload: {
      battleId,
      unitId,
      from,
      to,
      submitterId,  // Include submitter's userId for frontend filtering
      timestamp: Date.now()
    }
  }, battleId);
}

/**
 * Broadcast action execution result
 * CRITICAL: Uses ACK-required messaging - players must see damage/effects
 * @param {number} battleId - Battle ID
 * @param {number} actorId - Unit that performed action
 * @param {string} actionType - Type of action (attack, skill, wait)
 * @param {Object} result - Action result (damage, missed, etc.)
 * @param {number} submitterId - Optional userId who submitted the action (for frontend dedup)
 */
async function broadcastActionExecuted(battleId, actorId, actionType, result, submitterId = null) {
  const roomName = `battle:${battleId}`;

  // Use ACK-required broadcast - players must see damage/effects
  await broadcastWithAck(null, roomName, {
    type: 'battle:action_executed',
    payload: {
      battleId,
      actorId,
      actionType,
      result,
      submitterId,  // Include submitter's userId for frontend filtering
      timestamp: Date.now()
    }
  }, battleId);
}

/**
 * Broadcast turn change event
 * @param {number} battleId - Battle ID
 * @param {number} activeUnitIndex - New active unit index
 * @param {number} turn - Current turn number
 * @param {number} excludeUserId - Optional user to exclude
 * @param {string} activeUnitId - ID of the active unit (CT system)
 * @param {Array} turnPredictions - Predicted next 10 turns
 */
async function broadcastTurnChanged(battleId, activeUnitIndex, turn, excludeUserId = null, activeUnitId = null, turnPredictions = null) {
  const roomName = `battle:${battleId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'battle:turn_changed',
    payload: {
      battleId,
      activeUnitIndex,
      activeUnitId,
      turn,
      turnPredictions,
      timestamp: Date.now()
    }
  }, excludeUserId);
}

/**
 * Broadcast turn start event (new protocol - triggers camera pan)
 * CRITICAL: Uses ACK-required messaging for turn flow
 * @param {number} battleId - Battle ID
 * @param {Object} unit - Active unit info { id, name, type, position }
 * @param {string} unitType - 'player_local' | 'player_remote' | 'enemy'
 * @param {Array} turnPredictions - Predicted next 10 turns
 * @param {number|null} stateRevision - Authoritative revision for this turn
 * @param {Object|null} availableActions - Authoritative actions for the owner
 * @returns {Promise<Map<number, number>>} Reliability sequences by recipient
 */
async function broadcastTurnStart(
  battleId,
  unit,
  unitType,
  turnPredictions = null,
  stateRevision = null,
  availableActions = null
) {
  const roomName = `battle:${battleId}`;

  // Use ACK-required broadcast - critical for turn flow
  return broadcastWithAck(null, roomName, {
    type: 'battle:turn_start',
    payload: {
      battleId,
      unitId: unit.id,
      unitName: unit.name,
      unitType,
      position: unit.position,
      turnPredictions,
      ...(availableActions !== null && availableActions !== undefined
        ? { availableActions }
        : {}),
      ...(stateRevision !== null && stateRevision !== undefined
        ? { stateRevision }
        : {}),
      timestamp: Date.now()
    }
  }, battleId);
}

/**
 * Broadcast intent highlight for enemy visualization
 * NOTE: Fire-and-forget - visual-only, not critical
 * @param {number} battleId - Battle ID
 * @param {string} unitId - Unit showing intent
 * @param {string} highlightType - 'movement_range' | 'attack_range' | 'target_path' | 'target_tile' | 'aoe'
 * @param {Array} tiles - Array of { x, y } tile positions
 * @param {number} duration - How long to show highlight (ms)
 */
async function broadcastIntentHighlight(battleId, unitId, highlightType, tiles, duration = 500) {
  const roomName = `battle:${battleId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'battle:intent_highlight',
    payload: {
      battleId,
      unitId,
      highlightType,
      tiles,
      duration,
      timestamp: Date.now()
    }
  });
}

/**
 * Send "your turn" notification to a specific player
 * CRITICAL: Uses ACK-required messaging - must enable player input
 * @param {number} userId - User whose turn it is
 * @param {number} battleId - Battle ID
 * @param {string} unitId - Active unit ID
 * @param {Object} state - Current battle state
 * @param {Array} availableActions - List of available actions
 * @param {number|null} stateRevision - Authoritative revision for recovery
 * @returns {Promise<number>} Reliability sequence, or -1 without an open connection
 */
async function sendYourTurn(
  userId,
  battleId,
  unitId,
  state,
  availableActions = null,
  stateRevision = null
) {
  const ws = await getWebsocket();
  const { connections } = ws;
  const connection = connections.get(userId);

  if (connection && connection.readyState === 1) { // WebSocket.OPEN = 1
    // Use ACK-required send - must enable player input
    return sendWithAckAfterRecovery(connection, {
      type: 'battle:your_turn',
      payload: {
        battleId,
        unitId,
        state,
        availableActions,
        ...(stateRevision !== null && stateRevision !== undefined
          ? { stateRevision }
          : {}),
        timestamp: Date.now()
      }
    }, battleId, userId);
  }

  return -1;
}

/**
 * Broadcast player disconnection
 * NOTE: Fire-and-forget - informational only
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Disconnected player's user ID
 * @param {string} playerName - Disconnected player's name
 */
async function broadcastPlayerDisconnected(battleId, playerId, playerName) {
  const roomName = `battle:${battleId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'battle:player_disconnected',
    payload: {
      battleId,
      playerId,
      playerName,
      timestamp: Date.now()
    }
  }, playerId);  // Don't send to the disconnected player
}

/**
 * Broadcast player reconnection
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Reconnected player's user ID
 * @param {string} playerName - Reconnected player's name
 */
async function broadcastPlayerReconnected(battleId, playerId, playerName) {
  const roomName = `battle:${battleId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'battle:player_reconnected',
    payload: {
      battleId,
      playerId,
      playerName,
      timestamp: Date.now()
    }
  });
}

/**
 * Send full state sync to a specific user (for reconnection)
 * NOTE: Fire-and-forget - full sync is self-correcting
 * @param {number} userId - User to sync
 * @param {number} battleId - Battle ID
 * @param {Object} state - Full battle state
 * @param {string} reason - 'reconnect' | 'resync' | 'initial'
 */
async function sendStateSync(userId, battleId, state, reason = 'reconnect') {
  const ws = await getWebsocket();
  ws.sendToUser(userId, {
    type: 'battle:state_sync',
    payload: {
      battleId,
      state,
      reason,
      timestamp: Date.now()
    }
  });
}

/**
 * Broadcast battle end event
 * CRITICAL: Uses ACK-required messaging - players must know battle is over
 *
 * For PvP battles: Sends player-perspective status to each player
 * - Winner receives status: 'victory'
 * - Loser receives status: 'defeat'
 *
 * For PvE battles: Broadcasts same status to all participants
 *
 * @param {number} battleId - Battle ID
 * @param {string} status - 'victory' | 'defeat' (for PvE, or default for PvP)
 * @param {Object} rewards - Rewards data (gold, exp, items)
 * @param {Object} pvpInfo - Optional PvP-specific info { player1Id, player2Id, winningTeamId }
 */
async function broadcastBattleEnd(battleId, status, rewards = null, pvpInfo = null) {
  const roomName = `battle:${battleId}`;
  const ws = await getWebsocket();
  const { rooms, connections } = ws;

  // Get all user IDs in the room
  const roomUsers = rooms.get(roomName);

  // For PvP battles with player info, send player-perspective status
  if (pvpInfo && pvpInfo.player1Id && pvpInfo.player2Id && pvpInfo.winningTeamId) {
    const { player1Id, player2Id, winningTeamId } = pvpInfo;
    const winnerId = winningTeamId === 1 ? player1Id : player2Id;
    const loserId = winningTeamId === 1 ? player2Id : player1Id;

    console.log(`[BattleWS] PvP battle:end - battleId=${battleId}, winnerId=${winnerId}, loserId=${loserId}, winningTeamId=${winningTeamId}`);

    // Send victory to winner
    const winnerWs = connections.get(winnerId);
    if (winnerWs && winnerWs.readyState === 1) { // WebSocket.OPEN = 1
      sendWithAck(winnerWs, {
        type: 'battle:end',
        payload: {
          battleId,
          status: 'victory',
          rewards,
          timestamp: Date.now()
        }
      }, battleId, winnerId);
      console.log(`[BattleWS] Sent 'victory' to player ${winnerId}`);
    }

    // Send defeat to loser
    const loserWs = connections.get(loserId);
    if (loserWs && loserWs.readyState === 1) {
      sendWithAck(loserWs, {
        type: 'battle:end',
        payload: {
          battleId,
          status: 'defeat',
          rewards: null, // Loser doesn't get rewards
          timestamp: Date.now()
        }
      }, battleId, loserId);
      console.log(`[BattleWS] Sent 'defeat' to player ${loserId}`);
    }

    // Send to any other spectators in the room (if any)
    if (roomUsers) {
      for (const userId of roomUsers) {
        if (userId !== winnerId && userId !== loserId) {
          const spectatorWs = connections.get(userId);
          if (spectatorWs && spectatorWs.readyState === 1) {
            sendWithAck(spectatorWs, {
              type: 'battle:end',
              payload: {
                battleId,
                status, // Use the provided status for spectators
                rewards,
                timestamp: Date.now()
              }
            }, battleId, userId);
          }
        }
      }
    }
  } else {
    // PvE battle - broadcast same status to all participants
    console.log(`[BattleWS] PvE battle:end - battleId=${battleId}, status=${status}`);
    await broadcastWithAck(null, roomName, {
      type: 'battle:end',
      payload: {
        battleId,
        status,
        rewards,
        timestamp: Date.now()
      }
    }, battleId);
  }

  // Retain terminal ACKs through every retry plus the terminal full-sync
  // fallback. Cleaning up at the old fixed five-second mark made the fallback
  // (which begins around six seconds) unreachable.
  const terminalReliabilityWindow = ACK_TIMEOUT_MS * (MAX_RETRIES + 1) + 1000;
  const cleanupTimer = setTimeout(() => {
    cleanupBattleRoom(battleId);
  }, terminalReliabilityWindow);
  cleanupTimer.unref?.();
}

/**
 * Broadcast boss phase transition to all participants
 * @param {number} battleId - Battle ID
 * @param {Object} transition - Phase transition data
 */
async function broadcastPhaseTransition(battleId, transition) {
  const roomName = `battle:${battleId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'battle:phase_transition',
    payload: {
      battleId,
      ...transition,
      timestamp: Date.now()
    }
  });
}

/**
 * Send battle state to a specific user (for rejoin)
 * NOTE: Fire-and-forget - state updates are self-correcting
 * @param {number} userId - User ID
 * @param {number} battleId - Battle ID
 * @param {Object} state - Battle state
 */
async function sendBattleState(userId, battleId, state) {
  const ws = await getWebsocket();
  ws.sendToUser(userId, {
    type: 'battle:state_update',
    payload: {
      battleId,
      state,
      rejoined: true,
      timestamp: Date.now()
    }
  });
}

/**
 * Broadcast enemy actions batch (for animation sequencing)
 * @param {number} battleId - Battle ID
 * @param {Array} enemyActions - Array of enemy action results
 * @param {number} excludeUserId - Optional user to exclude
 */
async function broadcastEnemyActions(battleId, enemyActions, excludeUserId = null) {
  const roomName = `battle:${battleId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'battle:enemy_actions',
    payload: {
      battleId,
      actions: enemyActions,
      timestamp: Date.now()
    }
  }, excludeUserId);
}

/**
 * Clean up battle room and ACK tracking
 * @param {number} battleId - Battle ID
 */
async function cleanupBattleRoom(battleId) {
  const roomName = `battle:${battleId}`;

  if (battleRooms.has(battleId)) {
    battleRooms.delete(battleId);
  }

  const ws = await getWebsocket();
  const { rooms } = ws;
  if (rooms.has(roomName)) {
    rooms.delete(roomName);
  }

  // Clean up ACK tracking for this battle
  cleanupBattleAcks(battleId);
}

/**
 * Get users in a battle room
 * @param {number} battleId - Battle ID
 * @returns {Set<number>} Set of user IDs
 */
function getBattleParticipants(battleId) {
  return battleRooms.get(battleId) || new Set();
}

export {
  // Room management
  joinBattle,
  leaveBattle,
  cleanupBattleRoom,
  getBattleParticipants,

  // State updates (ACK-required)
  broadcastStateUpdate,
  sendBattleState,
  sendStateSync,

  // Turn-based protocol
  broadcastTurnStart,      // ACK-required
  broadcastTurnChanged,    // fire-and-forget (legacy)
  broadcastIntentHighlight, // fire-and-forget
  sendYourTurn,            // ACK-required

  // Action events
  broadcastUnitMoved,      // ACK-required
  broadcastActionExecuted, // ACK-required
  broadcastEnemyActions,   // fire-and-forget

  // Battle lifecycle
  broadcastBattleEnd,      // ACK-required
  broadcastPhaseTransition,
  broadcastPlayerDisconnected, // fire-and-forget
  broadcastPlayerReconnected
};

export default {
  joinBattle,
  leaveBattle,
  cleanupBattleRoom,
  getBattleParticipants,
  broadcastStateUpdate,
  sendBattleState,
  sendStateSync,
  broadcastTurnStart,
  broadcastTurnChanged,
  broadcastIntentHighlight,
  sendYourTurn,
  broadcastUnitMoved,
  broadcastActionExecuted,
  broadcastEnemyActions,
  broadcastBattleEnd,
  broadcastPhaseTransition,
  broadcastPlayerDisconnected,
  broadcastPlayerReconnected
};
