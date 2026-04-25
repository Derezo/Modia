// Action sequence tracking for stale/duplicate action detection in battles.
// Used by POST /api/battle/action to reject replayed or out-of-order client submissions.

const lastActionSequences = new Map();

const SEQUENCE_ENTRY_TTL_MS = 60 * 60 * 1000;
const SEQUENCE_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

let cleanupTimer = null;

export function startCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    for (const [key, value] of lastActionSequences.entries()) {
      if (now - value.timestamp > SEQUENCE_ENTRY_TTL_MS) {
        lastActionSequences.delete(key);
        cleanedCount++;
      }
    }
    if (cleanedCount > 0) {
      console.log(`[Battle] Cleaned ${cleanedCount} stale action sequence entries`);
    }
  }, SEQUENCE_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

export function stopCleanupTimer() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

export function validateActionSequence(battleId, userId, actionSequence) {
  const key = `${battleId}:${userId}`;
  const entry = lastActionSequences.get(key);
  const lastSequence = entry ? entry.sequence : 0;

  if (actionSequence === undefined || actionSequence === null) {
    return { valid: true };
  }

  if (actionSequence <= lastSequence) {
    console.warn(`[Battle] Stale action sequence rejected: battle=${battleId}, user=${userId}, received=${actionSequence}, last=${lastSequence}`);
    return { valid: false, error: 'Action sequence is stale or duplicate' };
  }

  lastActionSequences.set(key, { sequence: actionSequence, timestamp: Date.now() });
  return { valid: true };
}

export function resetActionSequence(battleId, userId) {
  const key = `${battleId}:${userId}`;
  lastActionSequences.delete(key);
}

export function cleanupBattleSequences(battleId) {
  for (const key of lastActionSequences.keys()) {
    if (key.startsWith(`${battleId}:`)) {
      lastActionSequences.delete(key);
    }
  }
}

export function _resetForTests() {
  lastActionSequences.clear();
}
