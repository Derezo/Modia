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
import { completeBattleTerminalTransition } from '../battle/BattleTerminalTransition.js';
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
    handleTurnTimeout(battleId, playerId, isPvE, timerId).catch(error => {
      console.error(`Failed to process turn timeout for battle ${battleId}:`, error);
    });
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
 * Install a delayed/reconnection timer only if the captured turn is still the
 * authoritative turn and no timer generation is already installed.
 */
export async function startTurnTimerIfCurrent(
  battleId,
  playerId,
  isPvE,
  expectedRevision
) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new TypeError('expectedRevision must be a nonnegative safe integer');
  }
  if (turnTimers.has(battleId)) {
    return { installed: false, reason: 'timer_already_active' };
  }

  let battle;
  try {
    battle = await battleStateRepository.loadBattle(battleId, {
      requireActive: true
    });
  } catch (error) {
    if (error?.code === 'BATTLE_NOT_FOUND'
      || error?.code === 'BATTLE_LIFECYCLE_CONFLICT'
      || error?.code === 'BATTLE_STATE_LIFECYCLE_ERROR') {
      return { installed: false, reason: 'battle_inactive' };
    }
    throw error;
  }

  if (battle.stateRevision !== expectedRevision) {
    return { installed: false, reason: 'stale_revision' };
  }
  const activeUnit = battle.state.units?.find(
    unit => unit.id === battle.state.activeUnitId
  );
  if (activeUnit?.type !== 'player'
    || String(activeUnit.ownerId) !== String(playerId)) {
    return { installed: false, reason: 'turn_changed' };
  }

  // No await occurs between this final generation check and installation.
  // A successor installed while the repository read was pending wins.
  if (turnTimers.has(battleId)) {
    return { installed: false, reason: 'timer_already_active' };
  }
  startTurnTimer(battleId, playerId, isPvE);
  return { installed: true, reason: 'current_turn' };
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

function cancelTurnTimerIfCurrent(battleId, expectedTimerId) {
  const timer = turnTimers.get(battleId);
  if (!timer || (expectedTimerId !== undefined
    && timer.timerId !== expectedTimerId)) {
    return false;
  }
  clearTimeout(timer.timerId);
  turnTimers.delete(battleId);
  return true;
}

function claimTurnTimerGeneration(battleId, expectedTimerId) {
  const timer = turnTimers.get(battleId);
  if (!timer
    || timer.timerId !== expectedTimerId
    || timer.claimed === true) {
    return null;
  }
  timer.claimed = true;
  return timer;
}

function isStaleTimeoutTransitionError(error) {
  return error?.code === 'BATTLE_STATE_CONFLICT'
    || error?.code === 'BATTLE_LIFECYCLE_CONFLICT'
    || error?.code === 'COLISEUM_BATTLE_ALREADY_TERMINAL';
}

/**
 * Handle turn timeout (player didn't act in time)
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player who timed out
 * @param {boolean} isPvE - Whether this is a PvE battle (no forfeit penalties in PvE)
 * @param {*} expectedTimerId - Exact timer handle that initiated this callback
 */
export async function handleTurnTimeout(
  battleId,
  playerId,
  isPvE = false,
  expectedTimerId = undefined
) {
  // A canceled/replaced timer may already be queued in the event loop. Only
  // the currently registered timer is allowed to mutate timeout counts or the
  // battle lifecycle.
  const timer = turnTimers.get(battleId);
  if (!timer
    || (expectedTimerId !== undefined && timer.timerId !== expectedTimerId)
    || String(timer.playerId) !== String(playerId)
    || timer.isPvE !== isPvE) {
    return { outcome: 'stale_timer' };
  }

  let authoritativeBattle;
  try {
    authoritativeBattle = await battleStateRepository.loadBattle(battleId, {
      requireActive: true
    });
  } catch (error) {
    if (error?.code === 'BATTLE_NOT_FOUND'
      || error?.code === 'BATTLE_LIFECYCLE_CONFLICT'
      || error?.code === 'BATTLE_STATE_LIFECYCLE_ERROR') {
      cancelTurnTimerIfCurrent(battleId, timer.timerId);
      return { outcome: 'stale_battle' };
    }
    throw error;
  }
  const authoritativeActiveUnit = authoritativeBattle.state.units.find(
    unit => unit.id === authoritativeBattle.state.activeUnitId
  );
  if (String(authoritativeActiveUnit?.ownerId) !== String(playerId)) {
    cancelTurnTimerIfCurrent(battleId, timer.timerId);
    return { outcome: 'stale_turn' };
  }
  if (!claimTurnTimerGeneration(battleId, timer.timerId)) {
    return { outcome: 'stale_timer' };
  }

  const counts = turnTimeoutCounts.get(battleId) || {};
  const nextTimeoutCount = (counts[playerId] || 0) + 1;
  const timeoutsRemaining = MAX_TURN_TIMEOUTS - nextTimeoutCount;

  // In PvP, third timeout = forfeit; in PvE, just skip turns indefinitely
  if (!isPvE && nextTimeoutCount >= MAX_TURN_TIMEOUTS) {
    // Third timeout = forfeit (PvP only)
    console.log(`[Coliseum] Player ${playerId} forfeited battle ${battleId} due to timeout`);
    try {
      await endMatchByForfeit(
        battleId,
        playerId,
        'timeout_forfeit',
        true,
        { expectedRevision: authoritativeBattle.stateRevision }
      );
    } catch (error) {
      if (!isStaleTimeoutTransitionError(error)) throw error;
      cancelTurnTimerIfCurrent(battleId, timer.timerId);
      return { outcome: 'stale_transition' };
    }
    return { outcome: 'forfeit' };
  } else {
    // Skip turn and notify
    const logPrefix = isPvE ? '[Battle]' : '[Coliseum]';
    console.log(`${logPrefix} Skipping turn for player ${playerId} in battle ${battleId} (${timeoutsRemaining} remaining)`);

    // Skip the turn by ending it
    let transition;
    try {
      transition = await skipPlayerTurn(
        battleId,
        playerId,
        isPvE,
        authoritativeBattle
      );
    } catch (error) {
      if (!isStaleTimeoutTransitionError(error)) throw error;
      cancelTurnTimerIfCurrent(battleId, timer.timerId);
      return { outcome: 'stale_transition' };
    }
    if (transition.outcome !== 'advanced') {
      if (transition.outcome === 'terminal') {
        cancelTurnTimerIfCurrent(battleId, timer.timerId);
        turnTimeoutCounts.delete(battleId);
        disconnectTracking.delete(battleId);
      }
      return transition;
    }
    // If the successor is not another timed player turn, retire the expired
    // source timer. If startTurnTimer already installed a successor, the token
    // guard preserves it.
    cancelTurnTimerIfCurrent(battleId, timer.timerId);
    counts[playerId] = nextTimeoutCount;
    turnTimeoutCounts.set(battleId, counts);

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
    return transition;
  }
}

/**
 * Skip a player's turn (used for timeout)
 * @param {number} battleId - Battle ID
 * @param {number} playerId - Player whose turn to skip
 * @param {boolean} isPvE - Whether this is a PvE battle
 */
export async function skipPlayerTurn(
  battleId,
  playerId,
  isPvE = false,
  loadedBattle = null
) {
  let battle = loadedBattle;
  if (!battle) {
    try {
      battle = await battleStateRepository.loadBattle(battleId, {
        requireActive: true
      });
    } catch (error) {
      if (error?.code === 'BATTLE_NOT_FOUND'
        || error?.code === 'BATTLE_LIFECYCLE_CONFLICT'
        || error?.code === 'BATTLE_STATE_LIFECYCLE_ERROR') {
        return { outcome: 'stale_battle' };
      }
      throw error;
    }
  }
  const state = JSON.parse(JSON.stringify(battle.state));
  const activeUnit = state.units.find(u => u.id === state.activeUnitId);

  if (activeUnit && String(activeUnit.ownerId) === String(playerId)) {
    // The timed-out unit's team is the acting team: if ending its turn
    // resolves in a mutual knockout, that team loses in PvP.
    const actingTeamId = battleService.getUnitTeamId(activeUnit);
    // End this unit's turn
    battleService.advanceToNextActorWithCT(state);
    const battleEndResult = battleService.checkBattleEnd(state, { actingTeamId });
    if (battleEndResult.status !== 'active') {
      const completion = await completeBattleTerminalTransition({
        battleEnvelope: battle,
        finalState: state,
        expectedRevision: battle.stateRevision,
        battleEndResult,
        actingUserId: playerId,
        reason: 'turn_timeout',
        commandType: 'turn_timeout_terminal',
        idempotencyKey:
          `turn-timeout-terminal:${battleId}:${battle.stateRevision}:${playerId}`
      });
      return { outcome: 'terminal', battleEndResult, completion };
    }

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
    const committedState = commit.envelope?.state ?? state;
    const nextUnit = committedState.units.find(
      u => u.id === committedState.activeUnitId
    );
    if (nextUnit) {
      await battleWebsocket.broadcastTurnStart(battleId, {
        id: nextUnit.id,
        name: nextUnit.name,
        position: { x: nextUnit.tileX, y: nextUnit.tileY }
      }, nextUnit.type, battleService.predictTurnOrder(committedState, 10),
      commit.stateRevision);

      // Start new turn timer if it's a player's turn
      if (nextUnit.type === 'player' && nextUnit.ownerId) {
        startTurnTimer(battleId, nextUnit.ownerId, isPvE);
      }
    }
    return {
      outcome: 'advanced',
      stateRevision: commit.stateRevision,
      update: commit.update
    };
  }
  return { outcome: 'stale_turn' };
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

    // Clear any existing timer for this player to prevent pile-up
    if (tracking[playerId]?.timerId) {
      clearTimeout(tracking[playerId].timerId);
    }

    // Set forfeit timer
    const timerId = setTimeout(async () => {
      try {
        if (tracking[playerId] && !tracking[playerId].reconnected) {
          // Reload battle to verify it's still active before forfeiting
          let battle;
          try {
            battle = await battleStateRepository.loadBattle(battleId, {
              requireActive: true
            });
          } catch (error) {
            if (error?.code === 'BATTLE_NOT_FOUND'
              || error?.code === 'BATTLE_LIFECYCLE_CONFLICT'
              || error?.code === 'COLISEUM_BATTLE_ALREADY_TERMINAL') {
              // Battle already ended, nothing to do
              return;
            }
            throw error;
          }
          if (!battle) return;

          // Check if they can use weekly grace
          const usedGrace = await checkAndUseWeeklyGrace(playerId);
          if (usedGrace) {
            await forgiveDisconnect(disconnect.id);
          }
          await endMatchByForfeit(battleId, playerId, 'disconnect_forfeit', !usedGrace);
        }
      } catch (err) {
        console.error(`Failed to handle disconnect forfeit for battle ${battleId}:`, err);
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
  }).catch(err => console.error('Failed to record disconnect event:', err));
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
          return startTurnTimerIfCurrent(
            battleId,
            playerId,
            false,
            battle.stateRevision
          );
        }
        return null;
      })
      .catch(error => {
        if (error?.code !== 'BATTLE_NOT_FOUND'
          && error?.code !== 'BATTLE_LIFECYCLE_CONFLICT'
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
 * @param {Object} options - Optional atomic completion constraints
 * @param {number|null} options.expectedRevision - Revision the forfeit must win from
 */
export async function endMatchByForfeit(
  battleId,
  forfeiterId,
  reason,
  applyPenalty = true,
  { expectedRevision = null } = {}
) {
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

  // Complete the match with forfeit reason
  if (completeMatchFn) {
    await completeMatchFn(
      battleId,
      winnerId,
      loserId,
      reason,
      applyPenalty,
      {
        expectedRevision,
        actingUserId: forfeiterId,
        publish: true
      }
    );
    // Cleanup follows successful atomic completion. A losing stale timeout
    // must not cancel the timer installed for a newer committed successor.
    cancelTurnTimer(battleId);
    turnTimeoutCounts.delete(battleId);
    disconnectTracking.delete(battleId);
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
