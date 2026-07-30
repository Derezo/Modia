/**
 * Late-bound terminal completion for turn transitions that run outside the
 * battle route request lifecycle (timers, disconnect abandonment, and similar
 * background work).
 *
 * The route owns mode-aware, atomic completion because it coordinates rewards,
 * Coliseum ratings, character lifecycle, terminal outbox work, and websocket
 * publication. Background services must hand the still-uncommitted terminal
 * state to that owner instead of persisting it as an active battle.
 */

let terminalCompletionHandler = null;

/**
 * Register the application's atomic, mode-aware terminal completion handler.
 *
 * @param {Function|null} handler
 */
export function setBattleTerminalCompletionHandler(handler) {
  if (handler !== null && typeof handler !== 'function') {
    throw new TypeError('Battle terminal completion handler must be a function or null');
  }
  terminalCompletionHandler = handler;
}

/**
 * Complete a terminal turn transition through the registered lifecycle owner.
 *
 * @param {Object} command
 * @param {Object} command.battleEnvelope - Authoritative envelope that was advanced
 * @param {Object} command.finalState - Uncommitted state after turn-start effects
 * @param {number} command.expectedRevision - Envelope revision finalState is based on
 * @param {Object} command.battleEndResult - Result from checkBattleEnd(finalState)
 * @param {number|string|null} command.actingUserId - User responsible for the transition
 * @param {string} command.reason - Presentation/audit reason
 * @param {string} command.commandType - Terminal repository command type
 * @param {string} command.idempotencyKey - Stable terminal command identity
 * @returns {Promise<Object>} Atomic completion result
 */
export async function completeBattleTerminalTransition({
  battleEnvelope,
  finalState,
  expectedRevision,
  battleEndResult,
  actingUserId,
  reason,
  commandType,
  idempotencyKey
}) {
  if (!battleEnvelope || typeof battleEnvelope !== 'object') {
    throw new TypeError('battleEnvelope is required for terminal completion');
  }
  if (!finalState || typeof finalState !== 'object') {
    throw new TypeError('finalState is required for terminal completion');
  }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new TypeError('expectedRevision must be a nonnegative safe integer');
  }
  if (!battleEndResult || battleEndResult.status === 'active') {
    throw new TypeError('battleEndResult must describe a terminal battle');
  }
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new TypeError('reason must be a non-empty string');
  }
  if (typeof commandType !== 'string' || commandType.length === 0) {
    throw new TypeError('commandType must be a non-empty string');
  }
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
    throw new TypeError('idempotencyKey must be a non-empty string');
  }
  if (!terminalCompletionHandler) {
    const error = new Error(
      'Battle terminal completion handler is not registered'
    );
    error.code = 'BATTLE_TERMINAL_HANDLER_UNAVAILABLE';
    throw error;
  }

  return terminalCompletionHandler({
    battleId: battleEnvelope.battleId,
    battleType: battleEnvelope.battleType ?? finalState.battleType,
    battleEnvelope,
    finalState,
    expectedRevision,
    battleEndResult,
    actingUserId,
    reason,
    commandType,
    idempotencyKey
  });
}

