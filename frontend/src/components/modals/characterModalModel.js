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

const SUMMARY_STATS = [
  { label: 'HP', key: 'hp', baseKey: 'hp_max' },
  { label: 'MP', key: 'mp', baseKey: 'mp_max' },
  { label: 'STR', key: 'strength' },
  { label: 'INT', key: 'intelligence' },
  { label: 'AGI', key: 'agility' },
  { label: 'VIT', key: 'vitality' },
  { label: 'LCK', key: 'luck' }
];

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/**
 * Build the character stat strip: base stats plus equipped gear, matching
 * what battle uses. `stats` is the GET /characters/:id/stats payload; when it
 * is missing (request failed) the strip falls back to base stats.
 * @param {Object} character - GET /characters/:id row (base stats)
 * @param {Object|null} stats - computed stats with equipment
 * @returns {Array<{label:string, value:number, bonus:number}>}
 */
export function buildStatSummary(character = {}, stats = null) {
  const char = character || {};
  return SUMMARY_STATS.map(({ label, key, baseKey }) => {
    const base = toInt(char[baseKey || key]);
    if (!stats) return { label, value: base, bonus: 0 };

    if (key === 'hp' || key === 'mp') {
      const entry = stats[key] || {};
      const bonus = toInt(entry.bonus);
      const value = entry.max !== undefined ? toInt(entry.max) : base + bonus;
      return { label, value, bonus };
    }

    const bonus = toInt(stats.equipmentBonuses?.[key]);
    const value = stats[key] !== undefined ? toInt(stats[key]) : base + bonus;
    return { label, value, bonus };
  });
}
