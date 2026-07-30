/**
 * Zodiac Collection Bonus Service
 *
 * Builds the account-wide, JSON-safe combat modifiers granted by permanent
 * zodiac crystals. The aggregate can be loaded once when a battle is created
 * and shared with every player character owned by that account.
 */

import { query } from '../config/database.js';
import {
  ZODIAC_CRYSTALS,
  ZODIAC_COLLECTION_BONUS
} from '../../../shared/constants.js';

const BONUS_KEYS = Object.freeze({
  physical_damage: 'physicalDamage',
  defense: 'defense',
  crit_chance: 'critChance',
  healing_received: 'healingReceived'
});

const COLLECTION_SIZE = Object.keys(ZODIAC_CRYSTALS).length;

/**
 * Return a fresh, serializable empty collection aggregate.
 */
export function createEmptyZodiacCollectionBonus() {
  return {
    collectedSigns: [],
    totalCollected: 0,
    collectionComplete: false,
    physicalDamage: 0,
    defense: 0,
    critChance: 0,
    healingReceived: 0,
    allStats: 0
  };
}

/**
 * Normalize an aggregate before it is attached to battle state.
 * Unknown fields and invalid modifier values are intentionally discarded.
 */
export function normalizeZodiacCollectionBonus(bonus) {
  if (!bonus || typeof bonus !== 'object') {
    return createEmptyZodiacCollectionBonus();
  }

  const collectedSigns = Array.isArray(bonus.collectedSigns)
    ? [...new Set(bonus.collectedSigns.filter(sign => ZODIAC_CRYSTALS[sign]))]
    : [];

  // Modifiers are always re-derived from shared crystal definitions. This
  // prevents stale or inflated values in serialized/injected state.
  return aggregateZodiacCollectionBonuses(collectedSigns);
}

/**
 * Aggregate the bonuses for a set of collected zodiac signs.
 *
 * Duplicate and unknown signs are ignored so legacy or malformed rows cannot
 * inflate combat modifiers.
 */
export function aggregateZodiacCollectionBonuses(collectedSigns = []) {
  const aggregate = createEmptyZodiacCollectionBonus();
  const validSigns = [...new Set(
    collectedSigns.filter(sign => typeof sign === 'string' && ZODIAC_CRYSTALS[sign])
  )];

  aggregate.collectedSigns = validSigns;
  aggregate.totalCollected = validSigns.length;

  for (const sign of validSigns) {
    const crystalBonus = ZODIAC_CRYSTALS[sign].bonus;
    const aggregateKey = BONUS_KEYS[crystalBonus.type];
    if (aggregateKey) {
      aggregate[aggregateKey] += crystalBonus.value;
    }
  }

  aggregate.collectionComplete = validSigns.length >= COLLECTION_SIZE;
  aggregate.allStats = aggregate.collectionComplete
    ? ZODIAC_COLLECTION_BONUS.allStatsBonus
    : 0;

  return aggregate;
}

/**
 * Load a user's permanent zodiac collection combat aggregate.
 *
 * @param {number} userId
 * @param {{client?: {query: Function}|null}} options
 */
export async function loadZodiacCollectionBonus(userId, { client = null } = {}) {
  const executeQuery = client ? client.query.bind(client) : query;
  const result = await executeQuery(
    `SELECT zodiac_sign
     FROM user_zodiac_crystals
     WHERE user_id = $1`,
    [userId]
  );

  return aggregateZodiacCollectionBonuses(
    result.rows.map(row => row.zodiac_sign)
  );
}

/**
 * Read a collection modifier from a player battle unit.
 * NPC/enemy units never receive account collection bonuses.
 */
export function getZodiacCollectionModifier(unit, modifierName) {
  if (unit?.type !== 'player') return 0;
  const value = Number(unit.zodiacCollectionBonus?.[modifierName]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Apply the target player's healing-received modifier to an HP amount.
 * No-bonus values are returned untouched for backwards formula compatibility.
 */
export function applyHealingReceivedBonus(unit, healingAmount) {
  const modifier = getZodiacCollectionModifier(unit, 'healingReceived');
  if (modifier === 0) return healingAmount;
  return Math.floor(healingAmount * (1 + modifier));
}

export default {
  createEmptyZodiacCollectionBonus,
  normalizeZodiacCollectionBonus,
  aggregateZodiacCollectionBonuses,
  loadZodiacCollectionBonus,
  getZodiacCollectionModifier,
  applyHealingReceivedBonus
};
