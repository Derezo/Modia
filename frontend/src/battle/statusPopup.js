/**
 * Status popup label for a skill effect result entry (skillEffects[]).
 *
 * Shared by the local (BattleScene) and WebSocket (BattleWebSocketManager)
 * presentation paths so both render outcomes the same way. A `resisted`
 * entry means the effect did NOT land: it must read as a resist, not as the
 * effect name (which looked exactly like a successful "BLEED"), and it must
 * not play the effect's sound.
 *
 * @param {Object} effect - { type, effect?, status? }
 * @returns {{label: string, sound: string|null}|null} null when nothing to show
 */
export function getStatusPopup(effect) {
  if (!effect) return null;
  if (effect.type === 'resisted') {
    const name = effect.effect || effect.status;
    return {
      label: name ? `${String(name).toUpperCase()} RESISTED` : 'RESISTED',
      sound: null
    };
  }

  const rawLabel = effect.effect || effect.status || effect.type;
  if (!rawLabel) return null;
  const label = effect.type === 'cleanse' && !effect.effect
    ? 'CLEANSED'
    : String(rawLabel).toUpperCase();
  return { label, sound: rawLabel };
}
