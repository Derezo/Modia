/**
 * @module coliseum/turnTimer
 * @description Turn timing, timeout handling, and forfeit management for PvP battles.
 *
 * Key responsibilities:
 * - Starting and canceling turn timers
 * - Handling turn timeouts (skip turn or forfeit)
 * - Managing disconnect tracking and reconnection
 * - Processing forfeits (surrender, timeout, disconnect)
 *
 * @see matchLifecycle.js - Match completion after forfeit
 * @see battleService.js - Battle state updates for skipped turns
 */

import * as battleService from '../battleService.js';
import * as battleWebsocket from '../battleWebsocket.js';
import battleStateRepository from '../battle/BattleStateRepository.js';
import {
  recordDisconnect as recordDisconnectEvent,
  forgiveDisconnect,
  checkAndUseWeeklyGrace
} from '../ratingService.js';
import {
  turnTimers,
  turnTimeoutCounts,
  disconnectTracking,
  getWebsocket,
  PVP_TURN_TIMEOUT,
  DISCONNECT_FORFEIT_TIME,
  MAX_TURN_TIMEOUTS
} from './constants.js';

// Forward declaration - will be set by matchLifecycle to avoid circular import
let completeMatchFn = null;

/**
 * Set the completeMatch function reference (called by matchLifecycle.js)
 * @param {Function} fn - The completeMatch function
 */
export function setCompleteMatchFn(fn) {
  completeMatchFn = fn;
}

/**
 * Start the turn timer for a PvP or multiplayer-PvE battle
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Current player's user ID
 * @param {boolean} isPvE - Whether this is a PvE battle (affects forfeit behavior)
 */
export function startTurnTimer(battleId, playerId, isPvE = false) {
  // Cancel any existing timer
  cancelTurnTimer(battleId);

  const timerId = setTimeout(() => {
    handleTurnTimeout(battleId, playerId, isPvE);
  }, PVP_TURN_TIMEOUT);

  turnTimers.set(battleId, {
    timerId,
    startTime: Date.now(),
    playerId,
    isPvE
  });

  // Initialize timeout counts if needed
  if (!turnTimeoutCounts.has(battleId)) {
    turnTimeoutCounts.set(battleId, {});
  }

  // Broadcast timer started
  getWebsocket().then(ws => {
    ws.broadcastToRoom(`battle:${battleId}`, {
      type: 'battle:turn_timer_started',
      payload: {
        battleId,
        playerId,
        duration: PVP_TURN_TIMEOUT,
        startTime: Date.now()
      }
    });
  }).catch(err => console.error('Failed to broadcast turn timer:', err));
}

/**
 * Cancel the turn timer for a battle
 * @param {number} battleId - Battle ID
 */
export function cancelTurnTimer(battleId) {
  const timer = turnTimers.get(battleId);
  if (timer) {
    clearTimeout(timer.timerId);
    turnTimers.delete(battleId);
  }
}

/**
 * Handle turn timeout (player didn't act in time)
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player who timed out
 * @param {boolean} isPvE - Whether this is a PvE battle (no forfeit penalties in PvE)
 */
async function handleTurnTimeout(battleId, playerId, isPvE = false) {
  const counts = turnTimeoutCounts.get(battleId) || {};
  counts[playerId] = (counts[playerId] || 0) + 1;
  turnTimeoutCounts.set(battleId, counts);

  const timeoutsRemaining = MAX_TURN_TIMEOUTS - counts[playerId];

  // In PvP, third timeout = forfeit; in PvE, just skip turns indefinitely
  if (!isPvE && counts[playerId] >= MAX_TURN_TIMEOUTS) {
    // Third timeout = forfeit (PvP only)
    console.log(`[Coliseum] Player ${playerId} forfeited battle ${battleId} due to timeout`);
    await endMatchByForfeit(battleId, playerId, 'timeout_forfeit');
  } else {
    // Skip turn and notify
    const logPrefix = isPvE ? '[Battle]' : '[Coliseum]';
    console.log(`${logPrefix} Skipping turn for player ${playerId} in battle ${battleId} (${timeoutsRemaining} remaining)`);

    // Skip the turn by ending it
    await skipPlayerTurn(battleId, playerId, isPvE);

    // Notify players
    const ws = await getWebsocket();
    ws.broadcastToRoom(`battle:${battleId}`, {
      type: 'battle:turn_skipped',
      payload: {
        battleId,
        playerId,
        timeoutsRemaining: isPvE ? null : timeoutsRemaining, // Don't show forfeit countdown in PvE
        reason: 'timeout'
      }
    });
  }
}

/**
 * Skip a player's turn (used for timeout)
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player whose turn to skip
 * @param {boolean} isPvE - Whether this is a PvE battle
 */
async function skipPlayerTurn(battleId, playerId, isPvE = false) {
  let battle;
  try {
    battle = await battleStateRepository.loadBattle(battleId, {
      requireActive: true
    });
  } catch (error) {
    if (error?.code === 'BATTLE_NOT_FOUND' || error?.code === 'BATTLE_STATE_LIFECYCLE_ERROR') {
      return;
    }
    throw error;
  }
  const state = JSON.parse(JSON.stringify(battle.state));
  const activeUnit = state.units.find(u => u.id === state.activeUnitId);

  if (activeUnit && activeUnit.ownerId === playerId) {
    // End this unit's turn
    battleService.advanceToNextActorWithCT(state);

    const commit = await battleStateRepository.commitBattleState({
      battleId,
      expectedRevision: battle.stateRevision,
      commandType: 'coliseum_turn_timeout',
      idempotencyKey: `coliseum-turn-timeout:${battleId}:${battle.stateRevision}:${playerId}`,
      flatState: state
    });

    // Publish the committed revision before presentation/turn events.
    await battleWebsocket.broadcastStateUpdate(battleId, commit.update);

    // Broadcast turn advanced
    const nextUnit = state.units.find(u => u.id === state.activeUnitId);
    if (nextUnit) {
      await battleWebsocket.broadcastTurnStart(battleId, {
        id: nextUnit.id,
        name: nextUnit.name,
        position: { x: nextUnit.tileX, y: nextUnit.tileY }
      }, nextUnit.type, battleService.predictTurnOrder(state, 10),
      commit.stateRevision);

      // Start new turn timer if it's a player's turn
      if (nextUnit.type === 'player' && nextUnit.ownerId) {
        startTurnTimer(battleId, nextUnit.ownerId, isPvE);
      }
    }
  }
}

/**
 * Handle player disconnect during battle
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player who disconnected
 */
export function handlePlayerDisconnect(battleId, playerId) {
  // Cancel turn timer
  cancelTurnTimer(battleId);

  // Record disconnect
  recordDisconnectEvent(playerId, null).then(disconnect => {
    // Initialize disconnect tracking
    if (!disconnectTracking.has(battleId)) {
      disconnectTracking.set(battleId, {});
    }

    const tracking = disconnectTracking.get(battleId);

    // Set forfeit timer
    const timerId = setTimeout(async () => {
      if (tracking[playerId] && !tracking[playerId].reconnected) {
        // Check if they can use weekly grace
        const usedGrace = await checkAndUseWeeklyGrace(playerId);
        if (usedGrace) {
          await forgiveDisconnect(disconnect.id);
        }
        await endMatchByForfeit(battleId, playerId, 'disconnect_forfeit', !usedGrace);
      }
    }, DISCONNECT_FORFEIT_TIME);

    tracking[playerId] = {
      disconnectTime: Date.now(),
      disconnectId: disconnect.id,
      timerId,
      reconnected: false
    };

    // Notify opponent
    getWebsocket().then(ws => {
      ws.broadcastToRoom(`battle:${battleId}`, {
        type: 'battle:opponent_disconnected',
        payload: {
          battleId,
          playerId,
          forfeitIn: DISCONNECT_FORFEIT_TIME
        }
      });
    }).catch(err => console.error('Failed to notify disconnect:', err));
  });
}

/**
 * Handle player reconnection during battle
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player who reconnected
 */
export function handlePlayerReconnect(battleId, playerId) {
  const tracking = disconnectTracking.get(battleId);
  if (tracking && tracking[playerId]) {
    // Clear forfeit timer
    clearTimeout(tracking[playerId].timerId);
    tracking[playerId].reconnected = true;

    // Notify opponent
    getWebsocket().then(ws => {
      ws.broadcastToRoom(`battle:${battleId}`, {
        type: 'battle:opponent_reconnected',
        payload: { battleId, playerId }
      });
    }).catch(err => console.error('Failed to notify reconnect:', err));

    // Restart turn timer if it's this player's turn
    battleStateRepository.loadBattle(battleId, { requireActive: true })
      .then(battle => {
        const state = battle.state;
        const activeUnit = state.units.find(u => u.id === state.activeUnitId);
        if (activeUnit && activeUnit.ownerId === playerId) {
          startTurnTimer(battleId, playerId);
        }
      })
      .catch(error => {
        if (error?.code !== 'BATTLE_NOT_FOUND'
          && error?.code !== 'BATTLE_STATE_LIFECYCLE_ERROR') {
          console.error('Failed to restore turn timer after reconnect:', error);
        }
      });
  }
}

/**
 * End match by forfeit (surrender, timeout, or disconnect)
 * @param {number} battleId - Battle ID
 * @param {number} forfeiterId - Player who forfeited
 * @param {string} reason - Reason for forfeit
 * @param {boolean} applyPenalty - Whether to apply rating penalty
 */
export async function endMatchByForfeit(battleId, forfeiterId, reason, applyPenalty = true) {
  let battle;
  try {
    battle = await battleStateRepository.loadBattle(battleId);
  } catch (error) {
    if (error?.code === 'BATTLE_NOT_FOUND') return;
    throw error;
  }
  const winnerId = forfeiterId === battle.player1Id
    ? battle.player2Id
    : battle.player1Id;
  const loserId = forfeiterId;

  // Clean up timers
  cancelTurnTimer(battleId);
  turnTimeoutCounts.delete(battleId);
  disconnectTracking.delete(battleId);

  // Complete the match with forfeit reason
  if (completeMatchFn) {
    await completeMatchFn(battleId, winnerId, loserId, reason, applyPenalty);
  } else {
    console.error('[Coliseum] completeMatch function not set - cannot complete forfeit');
  }
}

/**
 * Handle player surrender
 * @param {number} battleId - Battle ID
 * @param {number} surrenderingPlayerId - Player who is surrendering
 */
export async function handleSurrender(battleId, surrenderingPlayerId) {
  console.log(`[Coliseum] Player ${surrenderingPlayerId} surrendering battle ${battleId}`);
  await endMatchByForfeit(battleId, surrenderingPlayerId, 'surrender', true);
}
