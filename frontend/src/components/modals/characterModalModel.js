/**
 * Resolve the spendable skill-training pool without treating zero as absent.
 * Character experience is already the remaining pool in the skills API, so it
 * must not be reduced by spent XP again.
 */
export function resolveAvailableSkillXp(skillsData = {}, character = {}) {
  const rawValue = skillsData.availableXp
    ?? skillsData.xpPool
    ?? character.experience
    ?? 0;
  const numericValue = Number(rawValue);

  return Number.isFinite(numericValue)
    ? Math.max(0, numericValue)
    : 0;
}
