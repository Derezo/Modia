/**
 * Standard shrine effect lookup and reward calculations.
 *
 * Keeping the effect math pure makes shrine bonuses deterministic and keeps
 * database access injectable for focused tests.
 */

import { query } from '../config/database.js';
import { SHRINE_BUFFS } from '../../../shared/constants.js';

export const STANDARD_SHRINE_EFFECTS = Object.freeze({
  stamina_regen: Object.freeze({ rate: SHRINE_BUFFS.stamina_regen.value }),
  exp_bonus: Object.freeze({ rate: SHRINE_BUFFS.exp_bonus.value }),
  gold_bonus: Object.freeze({ rate: SHRINE_BUFFS.gold_bonus.value })
});

const STANDARD_EFFECT_TYPES = Object.freeze(Object.keys(STANDARD_SHRINE_EFFECTS));

/**
 * Return unique, supported effect types. Multiple shrines with the same
 * blessing intentionally do not multiply that blessing.
 *
 * @param {Array<string|Object>} effects - Effect names or rows with buff_type
 * @returns {string[]} Supported effect names in stable order
 */
export function normalizeStandardShrineEffectTypes(effects = []) {
  const supported = new Set(STANDARD_EFFECT_TYPES);
  const active = new Set(
    effects
      .map(effect => typeof effect === 'string' ? effect : effect?.buff_type)
      .filter(effectType => supported.has(effectType))
  );

  return STANDARD_EFFECT_TYPES.filter(effectType => active.has(effectType));
}

/**
 * Load the user's standard blessings that are active at the supplied time.
 *
 * @param {number} userId - User receiving the effects
 * @param {Object} options - Injectable database/time dependencies
 * @returns {Promise<string[]>} Unique active effect types
 */
export async function loadActiveStandardShrineEffects(
  userId,
  { queryFn = query, now = new Date() } = {}
) {
  const result = await queryFn(
    `SELECT DISTINCT buff_type
     FROM user_shrine_visits
     WHERE user_id = $1
       AND expires_at > $2
       AND buff_type = ANY($3::varchar[])`,
    [userId, now, STANDARD_EFFECT_TYPES]
  );

  return normalizeStandardShrineEffectTypes(result.rows);
}

/**
 * Load stamina blessing windows that overlap a character's lazy-regeneration
 * period. Historical overlap is retained so stamina earned while a blessing
 * was active is not lost merely because it expired before the next API read.
 *
 * @param {number} userId - Character owner
 * @param {Date} periodStart - Character stamina_updated_at
 * @param {Object} options - Injectable database/time dependencies
 * @returns {Promise<Array<{startsAt: Date, expiresAt: Date}>>}
 */
export async function loadStaminaRegenWindows(
  userId,
  periodStart,
  { queryFn = query, now = new Date() } = {}
) {
  const result = await queryFn(
    `SELECT last_visited_at, expires_at
     FROM user_shrine_visits
     WHERE user_id = $1
       AND buff_type = 'stamina_regen'
       AND expires_at > $2
       AND last_visited_at <= $3
     ORDER BY last_visited_at ASC, expires_at ASC`,
    [userId, periodStart, now]
  );

  return result.rows.map(row => ({
    startsAt: new Date(row.last_visited_at),
    expiresAt: new Date(row.expires_at)
  }));
}

/**
 * Apply standard shrine reward bonuses once to the base PvE reward amounts.
 *
 * @param {{gold: number, experience: number}} baseRewards - Unmodified rewards
 * @param {Array<string|Object>} effects - Active effect types or DB rows
 * @returns {{gold: number, experience: number, appliedBonuses: Array<Object>}}
 */
export function applyStandardShrineRewardBonuses(baseRewards, effects = []) {
  const effectTypes = normalizeStandardShrineEffectTypes(effects);
  const active = new Set(effectTypes);
  const baseGold = Math.max(0, Number(baseRewards.gold) || 0);
  const baseExperience = Math.max(0, Number(baseRewards.experience) || 0);

  const rewardDefinitions = [
    {
      effectType: 'gold_bonus',
      rewardType: 'gold',
      rate: STANDARD_SHRINE_EFFECTS.gold_bonus.rate,
      baseAmount: baseGold
    },
    {
      effectType: 'exp_bonus',
      rewardType: 'experience',
      rate: STANDARD_SHRINE_EFFECTS.exp_bonus.rate,
      baseAmount: baseExperience
    }
  ];

  const appliedBonuses = [];
  let gold = baseGold;
  let experience = baseExperience;

  for (const definition of rewardDefinitions) {
    if (!active.has(definition.effectType)) continue;

    const bonusAmount = Math.floor(definition.baseAmount * definition.rate);
    if (definition.rewardType === 'gold') {
      gold += bonusAmount;
    } else {
      experience += bonusAmount;
    }
    appliedBonuses.push({
      effectType: definition.effectType,
      rewardType: definition.rewardType,
      rate: definition.rate,
      baseAmount: definition.baseAmount,
      bonusAmount
    });
  }

  return { gold, experience, appliedBonuses };
}
