/**
 * effectiveStats - a character's stats with equipped gear added, matching
 * what the battle server uses (base stats + each equipped item's rolled
 * baseStats + augment bonusStats).
 *
 * Works on GET /characters rows, which carry `equipment: { [slot]: { baseStats,
 * bonusStats } }`. Rows without equipment come back unchanged.
 */

import { sumItemStats } from './statDisplay.js';

const PRIMARY_STATS = ['strength', 'intelligence', 'agility', 'vitality', 'luck'];

/**
 * Sum every equipped item's stats into one bonus map.
 * hp_max/mp_max are folded into hp/mp.
 * @param {Object} equipment - { [slot]: item }
 * @returns {Object} e.g. { strength: 15, vitality: 2, hp: 13 }
 */
export function sumEquipmentBonuses(equipment) {
  const bonuses = {};
  if (!equipment || typeof equipment !== 'object') return bonuses;
  for (const item of Object.values(equipment)) {
    const stats = sumItemStats(item);
    for (const [rawKey, value] of Object.entries(stats)) {
      if (typeof value !== 'number') continue;
      const key = rawKey === 'hp_max' ? 'hp' : rawKey === 'mp_max' ? 'mp' : rawKey;
      bonuses[key] = (bonuses[key] || 0) + value;
    }
  }
  return bonuses;
}

/**
 * @param {Object} character - GET /characters row (snake_case)
 * @returns {Object} copy with primary stats and hp_max/mp_max including gear,
 *   plus `equipmentBonuses` for callers that want to show the split
 */
export function withEquipmentStats(character) {
  if (!character) return character;
  const bonuses = sumEquipmentBonuses(character.equipment);
  const result = { ...character, equipmentBonuses: bonuses };
  for (const key of PRIMARY_STATS) {
    if (bonuses[key]) result[key] = (Number(character[key]) || 0) + bonuses[key];
  }
  if (bonuses.hp) result.hp_max = (Number(character.hp_max) || 0) + bonuses.hp;
  if (bonuses.mp) result.mp_max = (Number(character.mp_max) || 0) + bonuses.mp;
  return result;
}
