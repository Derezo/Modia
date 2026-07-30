const DEFAULT_MAX_COMPLETED_NOTIFICATIONS = 512;

/**
 * Coordinate revision-scoped player handoff notifications.
 *
 * Every invocation reloads authoritative state before consulting completed
 * success state. Concurrent invocations share one job, while sequential exact
 * replays skip only the already-successful notification side effect.
 */
export function createPlayerHandoffCoordinator({
  loadBattle,
  notifyPlayerTurn,
  maxCompletedNotifications = DEFAULT_MAX_COMPLETED_NOTIFICATIONS
}) {
  if (typeof loadBattle !== 'function') {
    throw new TypeError('loadBattle must be a function');
  }
  if (typeof notifyPlayerTurn !== 'function') {
    throw new TypeError('notifyPlayerTurn must be a function');
  }
  if (!Number.isSafeInteger(maxCompletedNotifications) ||
    maxCompletedNotifications < 1) {
    throw new TypeError('maxCompletedNotifications must be a positive safe integer');
  }

  const activeNotifications = new Map();
  const completedNotifications = new Map();

  function pruneCompletedNotifications(battleId, authoritativeRevision) {
    for (const [jobKey, completed] of completedNotifications) {
      if (String(completed.battleId) === String(battleId) &&
        completed.stateRevision !== authoritativeRevision) {
        completedNotifications.delete(jobKey);
      }
    }
  }

  function rememberCompletedNotification(jobKey, completed) {
    completedNotifications.delete(jobKey);
    completedNotifications.set(jobKey, completed);
    while (completedNotifications.size > maxCompletedNotifications) {
      const oldestJobKey = completedNotifications.keys().next().value;
      completedNotifications.delete(oldestJobKey);
    }
  }

  async function notifyPlayerTurnIfCurrent(
    battleId,
    expectedState,
    expectedRevision
  ) {
    const jobKey = `${battleId}:${expectedRevision}`;
    const activeJobKey = JSON.stringify([
      String(battleId),
      expectedRevision,
      String(expectedState?.activeUnitId)
    ]);
    const activeNotification = activeNotifications.get(activeJobKey);
    if (activeNotification) return activeNotification;

    const notification = (async () => {
      const authoritativeBattle = await loadBattle(battleId);
      const authoritativeState = authoritativeBattle.state;
      pruneCompletedNotifications(
        battleId,
        authoritativeBattle.stateRevision
      );
      const authoritativeUnit = authoritativeState.units?.find(
        unit => unit.id === authoritativeState.activeUnitId
      );
      const handoffIsCurrent = authoritativeBattle.status === 'active' &&
        authoritativeBattle.stateRevision === expectedRevision &&
        String(authoritativeState.activeUnitId) ===
          String(expectedState.activeUnitId) &&
        authoritativeUnit?.type === 'player';

      if (!handoffIsCurrent) {
        return {
          state: authoritativeState,
          stateRevision: authoritativeBattle.stateRevision,
          notified: false,
          duplicate: false
        };
      }

      if (completedNotifications.has(jobKey)) {
        return {
          state: authoritativeState,
          stateRevision: authoritativeBattle.stateRevision,
          notified: true,
          duplicate: true
        };
      }

      await notifyPlayerTurn(
        battleId,
        authoritativeState,
        authoritativeBattle.stateRevision
      );
      rememberCompletedNotification(jobKey, {
        battleId,
        stateRevision: authoritativeBattle.stateRevision
      });
      return {
        state: authoritativeState,
        stateRevision: authoritativeBattle.stateRevision,
        notified: true,
        duplicate: false
      };
    })();
    activeNotifications.set(activeJobKey, notification);
    try {
      return await notification;
    } finally {
      if (activeNotifications.get(activeJobKey) === notification) {
        activeNotifications.delete(activeJobKey);
      }
    }
  }

  return { notifyPlayerTurnIfCurrent };
}

export {
  DEFAULT_MAX_COMPLETED_NOTIFICATIONS
};
