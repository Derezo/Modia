export const POST_BATTLE_REFRESH_TIMEOUT_MS = 1500;

/**
 * Refresh the authoritative account and character snapshots after a battle.
 *
 * Battle rewards are persisted before the terminal battle event is delivered,
 * but the frontend keeps both values in long-lived session caches. Refreshing
 * both snapshots before leaving the battle prevents the world map and profile
 * UI from rendering the pre-battle gold and experience values.
 *
 * The requests settle independently so a transient failure in one snapshot
 * does not prevent the other from being applied or strand the player in battle.
 *
 * @param {Object} game
 * @returns {Promise<{userUpdated: boolean, charactersUpdated: boolean}>}
 */
export async function refreshPostBattleSessionState(game) {
  const api = game?.api;
  const state = game?.state;
  if (!api || !state) {
    return { userUpdated: false, charactersUpdated: false };
  }

  const sessionUserId = state.get('user')?.id ?? null;
  const [userResult, charactersResult] = await Promise.allSettled([
    Promise.resolve().then(() => api.get('/auth/me')),
    Promise.resolve().then(() => api.getCharacters())
  ]);

  // A timed-out refresh is intentionally allowed to finish in the background.
  // Do not let a response from the old session repopulate state after logout or
  // overwrite another account that signed in while the requests were pending.
  const currentUserId = state.get('user')?.id ?? null;
  if (currentUserId !== sessionUserId) {
    return { userUpdated: false, charactersUpdated: false };
  }

  let userUpdated = false;
  let charactersUpdated = false;

  if (userResult.status === 'fulfilled' && userResult.value?.user) {
    const user = userResult.value.user;
    state.set('user', user);
    // Some world-map actions still read the legacy top-level gold cache.
    if (user.gold !== undefined) state.set('gold', user.gold);
    userUpdated = true;
  } else if (userResult.status === 'rejected') {
    console.warn('[Battle] Failed to refresh account state after battle:', userResult.reason?.message);
  }

  if (charactersResult.status === 'fulfilled' &&
      Array.isArray(charactersResult.value?.characters)) {
    const characters = charactersResult.value.characters;
    const currentActiveId = state.get('activeCharacter')?.id;
    const activeCharacter = characters.find(character => character.id === currentActiveId) ||
      characters.find(character => character.party_slot === 1) ||
      characters[0] ||
      null;

    state.set('characters', characters);
    state.set('activeCharacter', activeCharacter);
    charactersUpdated = true;
  } else if (charactersResult.status === 'rejected') {
    console.warn('[Battle] Failed to refresh character state after battle:', charactersResult.reason?.message);
  }

  if (userUpdated && typeof state.persist === 'function') {
    state.persist();
  }

  return { userUpdated, charactersUpdated };
}

/**
 * Wait briefly for the post-battle snapshot without making scene navigation
 * depend on the network settling. The refresh remains observed after timeout,
 * so it may safely update the session later and cannot cause an unhandled
 * rejection.
 *
 * @param {Object} game
 * @param {Object} [options]
 * @param {number} [options.timeoutMs]
 * @param {Function} [options.scheduleTimeout]
 * @param {Function} [options.cancelTimeout]
 * @returns {Promise<{timedOut: boolean, result?: Object, completion: Promise<Object>}>}
 */
export async function waitForPostBattleSessionRefresh(game, {
  timeoutMs = POST_BATTLE_REFRESH_TIMEOUT_MS,
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout
} = {}) {
  const completion = Promise.resolve()
    .then(() => refreshPostBattleSessionState(game))
    .catch((error) => {
      console.warn('[Battle] Post-battle state refresh failed:', error.message);
      return { userUpdated: false, charactersUpdated: false };
    });

  let timeoutHandle;
  const timeout = new Promise((resolve) => {
    timeoutHandle = scheduleTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  const refreshed = completion.then(result => ({ timedOut: false, result }));
  const outcome = await Promise.race([refreshed, timeout]);

  if (!outcome.timedOut) {
    cancelTimeout(timeoutHandle);
  }

  return { ...outcome, completion };
}

/**
 * Leave battle only if it is still the active scene. Authentication failures
 * and other navigation can occur while the bounded refresh is pending, and a
 * stale battle completion must not overwrite that newer destination.
 *
 * @returns {boolean} Whether a scene transition was requested.
 */
export function transitionFromBattleIfCurrent(game, battleScene, returnScene) {
  const scenes = game?.scenes;
  if (!scenes || scenes.getCurrentScene?.() !== battleScene) {
    return false;
  }

  scenes.switchTo(returnScene);
  return true;
}
