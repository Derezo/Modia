/**
 * Player-facing text for the daily completion bonus returned by
 * POST /api/quests/:questId/claim and POST /api/quests/claim-all.
 * @param {{gold:number, xp:number}|null|undefined} bonus
 * @returns {string|null} e.g. "+30g, +45 XP", or null when no bonus was granted
 */
export function formatCompletionBonus(bonus) {
  if (!bonus) return null;
  return `+${Number(bonus.gold) || 0}g, +${Number(bonus.xp) || 0} XP`;
}
