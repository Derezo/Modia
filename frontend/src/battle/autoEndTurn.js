/**
 * autoEndTurn user setting (battle.autoEndTurn): end the local turn with a
 * 'wait' once move and act are both spent.
 *
 * BattleScene delegates here. The scene supplies autoEndTurn, the
 * authoritative availability (serverAvailableActions / canMove / canAct /
 * canWait), zodiacAbilities, isLocalActiveUnit(), isActionSubmitting,
 * battleEnded, isIntroPlaying, entryEpoch, battleState and submitAction().
 */

/**
 * Whether the local turn should be ended right now: move and act are spent,
 * waiting is allowed, no zodiac ability is offered, and nothing else (a
 * submission, the intro, battle end) is in flight.
 * @param {Object} scene - BattleScene
 * @returns {boolean}
 */
export function shouldAutoEndTurn(scene) {
  return !!scene.autoEndTurn &&
    !!scene.serverAvailableActions &&
    !scene.canMove &&
    !scene.canAct &&
    scene.canWait &&
    !((scene.zodiacAbilities?.length || 0) > 0) &&
    scene.isLocalActiveUnit() &&
    !scene.isActionSubmitting &&
    !scene.battleEnded &&
    !scene.isIntroPlaying;
}

/**
 * Queue at most one auto 'wait' submission. Called whenever authoritative
 * availability changes and again once a submission has settled (the normal
 * HTTP path applies availability while isActionSubmitting is still true).
 * The callback re-checks the scene entry and the active unit so a stale
 * timer never ends a different turn or a later battle.
 * @param {Object} scene - BattleScene
 */
export function scheduleAutoEndTurn(scene) {
  if (scene.autoEndTurnTimer || !shouldAutoEndTurn(scene)) return;
  const epoch = scene.entryEpoch;
  const unitId = scene.battleState?.activeUnitId;
  scene.autoEndTurnTimer = setTimeout(() => {
    scene.autoEndTurnTimer = null;
    if (scene.entryEpoch !== epoch ||
        String(scene.battleState?.activeUnitId) !== String(unitId) ||
        !shouldAutoEndTurn(scene)) return;
    void scene.submitAction('wait');
  }, 0);
}

/**
 * Drop a queued auto 'wait' (scene exit).
 * @param {Object} scene - BattleScene
 */
export function cancelAutoEndTurn(scene) {
  if (scene.autoEndTurnTimer) clearTimeout(scene.autoEndTurnTimer);
  scene.autoEndTurnTimer = null;
}
