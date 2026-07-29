/**
 * Battle Reconnection Service
 *
 * Handles player disconnection/reconnection during battles:
 * - Tracks disconnected players
 * - Manages reconnection state
 * - Provides battle state recovery
 * - Handles turn timeout for disconnected players
 */

import battleWebsocket from './battleWebsocket.js';
import { startTurnTimer } from './coliseumService.js';
import {
  BattleStateNotFoundError,
  battleStateRepository
} from './battle/BattleStateRepository.js';

// Track disconnected players: Map<battleId, Map<playerId, { disconnectTime, timeout }>>
const disconnectedPlayers = new Map();

// Default timeout before a disconnected player is considered to have abandoned (30 seconds)
const DISCONNECT_TIMEOUT = 30000;

// Grace period after reconnection before turn timer resumes
const RECONNECT_GRACE_PERIOD = 3000;

/**
 * Handle player disconnection during battle
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player who disconnected
 * @param {string} playerName - Player's display name
 */
async function handleDisconnect(battleId, playerId, playerName) {
  // Get or create disconnect map for this battle
  if (!disconnectedPlayers.has(battleId)) {
    disconnectedPlayers.set(battleId, new Map());
  }

  const battleDisconnects = disconnectedPlayers.get(battleId);

  // Don't re-add if already tracking (multiple disconnect events)
  if (battleDisconnects.has(playerId)) {
    return;
  }

  const disconnectInfo = {
    playerId,
    playerName,
    disconnectTime: Date.now(),
    timeout: null
  };

  // Set timeout for abandonment
  disconnectInfo.timeout = setTimeout(async () => {
    await handleAbandonTimeout(battleId, playerId);
  }, DISCONNECT_TIMEOUT);

  battleDisconnects.set(playerId, disconnectInfo);

  // Update battle state to reflect disconnection
  const committedState = await updateBattleDisconnectState(battleId, playerId, true);

  if (committedState) {
    if (committedState.update) {
      await battleWebsocket.broadcastStateUpdate(battleId, committedState.update);
    }
    battleWebsocket.broadcastPlayerDisconnected(battleId, playerId, playerName);
  }

  console.log(`[Reconnection] Player ${playerName} (${playerId}) disconnected from battle ${battleId}`);
}

/**
 * Handle player reconnection during battle
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player who reconnected
 * @param {string} playerName - Player's display name
 * @returns {Object|null} Battle state for reconnection, or null if not found
 */
async function handleReconnect(battleId, playerId, playerName) {
  // Check if player was tracked as disconnected
  const battleDisconnects = disconnectedPlayers.get(battleId);

  if (battleDisconnects?.has(playerId)) {
    const disconnectInfo = battleDisconnects.get(playerId);

    // Clear the abandonment timeout
    if (disconnectInfo.timeout) {
      clearTimeout(disconnectInfo.timeout);
    }

    // Remove from disconnected tracking
    battleDisconnects.delete(playerId);

    // Clean up empty battle maps
    if (battleDisconnects.size === 0) {
      disconnectedPlayers.delete(battleId);
    }

    console.log(`[Reconnection] Player ${playerName} (${playerId}) reconnected to battle ${battleId}`);
  }

  let battleState = await getBattleStateForReconnect(battleId, playerId);
  if (!battleState) {
    return null;
  }

  // Update battle state to reflect reconnection
  const committedState = await updateBattleDisconnectState(battleId, playerId, false);

  // Get the repository-fresh state after the reconnect commit.
  battleState = await getBattleStateForReconnect(battleId, playerId);

  if (battleState) {
    if (committedState?.update) {
      await battleWebsocket.broadcastStateUpdate(battleId, committedState.update);
    }
    // Notify other players of reconnection
    battleWebsocket.broadcastPlayerReconnected(battleId, playerId, playerName);

    // Rejoin the battle room
    // Note: This should be called by the route handler with socket access

    // For PvP battles, restart turn timer if it's this player's turn
    const isPvP = battleState.battleType === 'pvp' || battleState.battleType === 'pvp_coliseum';
    if (isPvP && battleState.state) {
      const state = battleState.state;
      const activeUnit = state.units?.find(u => u.id === state.activeUnitId);
      if (activeUnit && activeUnit.ownerId === playerId) {
        // Give player a grace period (minimum 5 seconds) to orient themselves
        // after reconnection before their turn timer starts
        const gracePeriodMs = Math.max(5000, RECONNECT_GRACE_PERIOD);
        setTimeout(() => {
          startTurnTimer(battleId, playerId, false);
        }, gracePeriodMs);

        console.log(`[Reconnection] PvP turn timer will restart in ${gracePeriodMs}ms for player ${playerId}`);
      }
    }

    return {
      state: battleState,
      gracePeriod: RECONNECT_GRACE_PERIOD
    };
  }

  return null;
}

/**
 * Handle timeout when disconnected player doesn't reconnect
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player who timed out
 */
async function handleAbandonTimeout(battleId, playerId) {
  const battleDisconnects = disconnectedPlayers.get(battleId);

  if (!battleDisconnects?.has(playerId)) {
    return; // Already reconnected or handled
  }

  const disconnectInfo = battleDisconnects.get(playerId);

  console.log(`[Reconnection] Player ${disconnectInfo.playerName} (${playerId}) abandoned battle ${battleId}`);

  // Remove from tracking
  battleDisconnects.delete(playerId);
  if (battleDisconnects.size === 0) {
    disconnectedPlayers.delete(battleId);
  }

  let battle;
  try {
    battle = await battleStateRepository.loadBattle(battleId, {
      requireActive: true
    });
  } catch (error) {
    if (error instanceof BattleStateNotFoundError) {
      return;
    }
    throw error;
  }

  if (!battle) {
    return; // Battle already ended
  }

  const state = structuredClone(battle.state);
  let autoWaitedUnit = null;
  let nextTurn = null;

  // Check if it's the abandoned player's turn
  const activeUnit = state.units?.find(u => u.id === state.activeUnitId);

  if (activeUnit?.ownerId === playerId) {
    // Auto-wait for the disconnected player's unit
    const battleService = await import('./battleService.js');

    // Execute wait action
    activeUnit.hasActed = true;
    activeUnit.hasMoved = true;

    // Advance to next turn
    battleService.advanceToNextActorWithCT(state);

    autoWaitedUnit = activeUnit;
    const nextUnit = state.units?.find(u => u.id === state.activeUnitId);
    if (nextUnit) {
      nextTurn = {
        unit: nextUnit,
        predictions: battleService.predictTurnOrder(state, 10)
      };
    }
  }

  // Mark player as abandoned in battle state
  if (!state.abandonedPlayers) {
    state.abandonedPlayers = [];
  }
  if (!state.abandonedPlayers.includes(playerId)) {
    state.abandonedPlayers.push(playerId);
  }

  const commitResult = await battleStateRepository.commitBattleState({
    battleId,
    expectedRevision: battle.stateRevision,
    commandType: 'player_abandon_timeout',
    idempotencyKey: `player-abandon:${battleId}:${playerId}:${battle.stateRevision}`,
    flatState: state,
    allowedStatuses: ['active']
  });
  const committedEnvelope = commitResult.envelope
    ?? await battleStateRepository.loadBattle(battleId, { requireActive: true });

  if (autoWaitedUnit) {
    battleWebsocket.broadcastActionExecuted(battleId, autoWaitedUnit.id, 'wait', {
      reason: 'disconnect_timeout'
    });
  }
  if (nextTurn) {
    const committedNextUnit = committedEnvelope.state.units?.find(
      unit => unit.id === nextTurn.unit.id
    ) ?? nextTurn.unit;
    battleWebsocket.broadcastTurnStart(
      battleId,
      committedNextUnit,
      committedNextUnit.type,
      nextTurn.predictions
    );
  }
  await battleWebsocket.broadcastStateUpdate(battleId, commitResult.update);
}

/**
 * Update battle state to track disconnection status
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player ID
 * @param {boolean} isDisconnected - Whether player is disconnected
 */
async function updateBattleDisconnectState(battleId, playerId, isDisconnected) {
  let battle;
  try {
    battle = await battleStateRepository.loadBattle(battleId, {
      requireActive: true
    });
  } catch (error) {
    if (error instanceof BattleStateNotFoundError) {
      return null;
    }
    throw error;
  }

  const state = structuredClone(battle.state);

  // Track disconnected players in state
  if (!state.disconnectedPlayers) {
    state.disconnectedPlayers = [];
  }

  const wasDisconnected = state.disconnectedPlayers.includes(playerId);
  if (isDisconnected && !wasDisconnected) {
    state.disconnectedPlayers.push(playerId);
  } else if (!isDisconnected) {
    state.disconnectedPlayers = state.disconnectedPlayers.filter(id => id !== playerId);
  }

  if (wasDisconnected === isDisconnected) {
    return {
      envelope: battle,
      update: null,
      committed: false
    };
  }

  const commandType = isDisconnected ? 'player_disconnect' : 'player_reconnect';
  const result = await battleStateRepository.commitBattleState({
    battleId,
    expectedRevision: battle.stateRevision,
    commandType,
    idempotencyKey: `${commandType}:${battleId}:${playerId}:${battle.stateRevision}`,
    flatState: state,
    allowedStatuses: ['active']
  });

  const envelope = result.envelope
    ?? await battleStateRepository.loadBattle(battleId, { requireActive: true });
  return {
    envelope,
    update: result.update,
    committed: !result.idempotent
  };
}

/**
 * Get battle state for reconnecting player
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player ID
 * @returns {Object|null} Battle state or null
 */
async function getBattleStateForReconnect(battleId, playerId) {
  let battle;
  try {
    battle = await battleStateRepository.loadBattleForParticipant(
      battleId,
      playerId
    );
  } catch (error) {
    if (error instanceof BattleStateNotFoundError) {
      return null;
    }
    throw error;
  }

  // Return full state for reconnection
  return {
    battleId: battle.battleId,
    status: battle.status,
    battleType: battle.battleType,
    stateRevision: battle.stateRevision,
    battleMapSchemaVersion: battle.battleMapSchemaVersion,
    terrainGenerationVersion: battle.terrainGenerationVersion,
    fullHash: battle.fullHash,
    map: battle.map,
    mutableState: battle.mutableState,
    state: battle.state
  };
}

/**
 * Check if a player is currently disconnected from a battle
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player ID
 * @returns {boolean}
 */
function isPlayerDisconnected(battleId, playerId) {
  const battleDisconnects = disconnectedPlayers.get(battleId);
  return battleDisconnects?.has(playerId) || false;
}

/**
 * Get list of disconnected players for a battle
 * @param {number} battleId - Battle ID
 * @returns {Array} Array of disconnected player info
 */
function getDisconnectedPlayers(battleId) {
  const battleDisconnects = disconnectedPlayers.get(battleId);
  if (!battleDisconnects) {
    return [];
  }

  return Array.from(battleDisconnects.values()).map(info => ({
    playerId: info.playerId,
    playerName: info.playerName,
    disconnectTime: info.disconnectTime,
    timeRemaining: Math.max(0, DISCONNECT_TIMEOUT - (Date.now() - info.disconnectTime))
  }));
}

/**
 * Clean up tracking for a battle that has ended
 * @param {number} battleId - Battle ID
 */
function cleanupBattle(battleId) {
  const battleDisconnects = disconnectedPlayers.get(battleId);

  if (battleDisconnects) {
    // Clear all timeouts
    for (const info of battleDisconnects.values()) {
      if (info.timeout) {
        clearTimeout(info.timeout);
      }
    }

    disconnectedPlayers.delete(battleId);
  }
}

/**
 * Clear ALL tracking and timeouts (for test cleanup)
 * @private
 */
function _clearAllTimeouts() {
  for (const battleDisconnects of disconnectedPlayers.values()) {
    for (const info of battleDisconnects.values()) {
      if (info.timeout) {
        clearTimeout(info.timeout);
      }
    }
  }
  disconnectedPlayers.clear();
}

export {
  handleDisconnect,
  handleReconnect,
  handleAbandonTimeout,
  isPlayerDisconnected,
  getDisconnectedPlayers,
  cleanupBattle,
  getBattleStateForReconnect,
  _clearAllTimeouts,
  DISCONNECT_TIMEOUT,
  RECONNECT_GRACE_PERIOD
};
