const PERSPECTIVE_OUTCOMES = new Set(['victory', 'defeat']);

/**
 * Convert a persisted head-to-head battle outcome into the requesting player's
 * perspective. Before Coliseum finalization, the shared status is team-1
 * relative; afterwards winnerId is authoritative regardless of that status.
 *
 * PvE and co-op callers must pass isHeadToHead=false so every allied participant
 * retains the shared outcome.
 */
export function getParticipantBattleStatus({
  status = 'active',
  userId,
  player1Id,
  player2Id,
  winnerId = null,
  isHeadToHead = false
}) {
  if (!isHeadToHead || !PERSPECTIVE_OUTCOMES.has(status)) return status;

  const isPlayer1 = userId === player1Id;
  const isPlayer2 = userId === player2Id;
  if (!isPlayer1 && !isPlayer2) return status;

  if (winnerId != null) {
    return userId === winnerId ? 'victory' : 'defeat';
  }

  if (isPlayer2 && player1Id != null) {
    return status === 'victory' ? 'defeat' : 'victory';
  }

  return status;
}
