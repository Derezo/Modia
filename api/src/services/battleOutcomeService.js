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

/**
 * Project a persisted battle envelope into one participant's terminal view.
 * The database keeps one shared Coliseum outcome, while snapshots and legacy
 * state payloads must never tell the losing client that it won.
 */
export function getParticipantBattleView(battle, userId) {
  if (!battle || typeof battle !== 'object') {
    throw new TypeError('battle is required');
  }

  const isHeadToHead = battle.battleType === 'pvp'
    || battle.battleType === 'pvp_coliseum'
    || battle.mutableState?.battleType === 'pvp'
    || battle.state?.battleType === 'pvp';
  const status = getParticipantBattleStatus({
    status: battle.status ?? battle.mutableState?.status ?? battle.state?.status ?? 'active',
    userId,
    player1Id: battle.player1Id,
    player2Id: battle.player2Id,
    winnerId: battle.winnerId,
    isHeadToHead
  });
  const rewards = status === 'victory' ? (battle.rewards ?? null) : null;

  return {
    ...battle,
    mutableState: {
      ...battle.mutableState,
      status,
      rewards
    },
    state: {
      ...battle.state,
      status,
      rewards
    }
  };
}
