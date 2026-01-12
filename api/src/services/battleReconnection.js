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
import { query } from '../config/database.js';

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

  // Notify other players
  battleWebsocket.broadcastPlayerDisconnected(battleId, playerId, playerName);

  // Update battle state to reflect disconnection
  await updateBattleDisconnectState(battleId, playerId, true);

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

  // Update battle state to reflect reconnection
  await updateBattleDisconnectState(battleId, playerId, false);

  // Get current battle state for the player
  const battleState = await getBattleStateForReconnect(battleId, playerId);

  if (battleState) {
    // Notify other players of reconnection
    battleWebsocket.broadcastPlayerReconnected(battleId, playerId, playerName);

    // Rejoin the battle room
    // Note: This should be called by the route handler with socket access

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

  // Get battle state to check if it's their turn
  const result = await query(
    'SELECT battle_state, battle_type FROM battles WHERE id = $1 AND status = $2',
    [battleId, 'active']
  );

  if (result.rows.length === 0) {
    return; // Battle already ended
  }

  const battle = result.rows[0];
  const state = battle.battle_state;

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

    // Update database
    await query(
      'UPDATE battles SET battle_state = $1 WHERE id = $2',
      [JSON.stringify(state), battleId]
    );

    // Broadcast the auto-wait action
    battleWebsocket.broadcastActionExecuted(battleId, activeUnit.id, 'wait', {
      reason: 'disconnect_timeout'
    });

    // Broadcast turn change
    const nextUnit = state.units?.find(u => u.id === state.activeUnitId);
    if (nextUnit) {
      const turnPredictions = battleService.predictTurnOrder(state, 10);
      battleWebsocket.broadcastTurnStart(
        battleId,
        nextUnit,
        nextUnit.type,
        turnPredictions
      );
    }
  }

  // Mark player as abandoned in battle state
  if (!state.abandonedPlayers) {
    state.abandonedPlayers = [];
  }
  state.abandonedPlayers.push(playerId);

  await query(
    'UPDATE battles SET battle_state = $1 WHERE id = $2',
    [JSON.stringify(state), battleId]
  );

  // Broadcast abandonment notification
  battleWebsocket.broadcastStateUpdate(battleId, {
    type: 'player_abandoned',
    playerId,
    playerName: disconnectInfo.playerName
  });
}

/**
 * Update battle state to track disconnection status
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player ID
 * @param {boolean} isDisconnected - Whether player is disconnected
 */
async function updateBattleDisconnectState(battleId, playerId, isDisconnected) {
  const result = await query(
    'SELECT battle_state FROM battles WHERE id = $1',
    [battleId]
  );

  if (result.rows.length === 0) {
    return;
  }

  const state = result.rows[0].battle_state;

  // Track disconnected players in state
  if (!state.disconnectedPlayers) {
    state.disconnectedPlayers = [];
  }

  if (isDisconnected && !state.disconnectedPlayers.includes(playerId)) {
    state.disconnectedPlayers.push(playerId);
  } else if (!isDisconnected) {
    state.disconnectedPlayers = state.disconnectedPlayers.filter(id => id !== playerId);
  }

  await query(
    'UPDATE battles SET battle_state = $1 WHERE id = $2',
    [JSON.stringify(state), battleId]
  );
}

/**
 * Get battle state for reconnecting player
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player ID
 * @returns {Object|null} Battle state or null
 */
async function getBattleStateForReconnect(battleId, playerId) {
  const result = await query(
    `SELECT b.id, b.battle_state, b.status, b.battle_type,
            b.player1_id, b.player2_id
     FROM battles b
     WHERE b.id = $1
       AND (b.player1_id = $2 OR b.player2_id = $2 OR
            EXISTS (SELECT 1 FROM battle_players bp WHERE bp.battle_id = b.id AND bp.player_id = $2))`,
    [battleId, playerId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const battle = result.rows[0];

  // Return full state for reconnection
  return {
    battleId: battle.id,
    status: battle.status,
    battleType: battle.battle_type,
    state: battle.battle_state
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
