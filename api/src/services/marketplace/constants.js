/**
 * @module marketplace/constants
 * @description Shared constants for marketplace calculations.
 *
 * Key exports:
 * - DEFAULT_TAX_RATE - Standard marketplace seller fee (5%)
 * - AUGMENT_VALUES - Value multipliers by augment category
 * - RARITY_MULTIPLIERS - Price multipliers by item rarity
 */

// Default marketplace tax rate (5%)
export const DEFAULT_TAX_RATE = 0.05;

/**
 * Augment value multipliers by category
 * Used for calculating suggested prices on unique items
 */
export const AUGMENT_VALUES = {
  // Elemental
  fire: 0.8,
  ice: 0.8,
  lightning: 0.8,
  poison: 0.6,
  holy: 0.9,
  dark: 0.9,
  // Stats
  strength: 1.0,
  intelligence: 1.0,
  agility: 1.0,
  vitality: 1.0,
  luck: 0.8,
  // Combat
  critical: 1.0,
  speed: 0.9,
  damage: 1.1,
  power: 1.0,
  // Defense
  defense: 0.9,
  magic_defense: 0.9,
  armor: 0.8,
  block: 0.9,
  spell_resist: 0.8,
  protection: 1.0,
  // Enemy-slayer
  dragon_slayer: 1.2,
  undead_slayer: 1.1,
  demon_slayer: 1.2,
  // Support
  hp: 0.9,
  mp: 0.9,
  regen: 0.7,
  mp_regen: 0.7,
  accuracy: 0.8,
  crit: 1.0,
  // Consumable
  effect_multiplier: 1.0,
  hot: 0.8,
  hot_percent: 1.0,
  mp_bonus: 0.7,
  mp_regen_consumable: 0.8,
  spell_cost_reduction: 0.9,
  cleanse: 1.2,
  buff: 0.8,
  revive_hp_bonus: 0.6,
  revive_full: 1.5,
  revive_immunity: 1.0,
  instant: 1.5,
  aoe: 1.2
};

/**
 * Rarity multipliers for price calculation
 */
export const RARITY_MULTIPLIERS = {
  common: 1.0,
  uncommon: 1.5,
  rare: 2.5,
  epic: 5.0,
  legendary: 10.0
};

/**
 * Rarity names in order (index 0 = 1-based id 1)
 */
/**
 * Gold value of one rolled stat point, used as a floor for a rolled drop's
 * base price. Calibrated on the shop templates (Iron Sword 150g for 7 STR,
 * Bronze Axe 90g for 5 STR, Oak Staff 60g for 5 INT: ~12-21g per point).
 * HP/MP pools count at one fifth. Without the floor, drops rolled on the 2g
 * starter templates (Trainee Tunic, Warrior's Pendant) were estimated at a
 * few gold regardless of level, rarity or stats.
 */
export const STAT_POINT_GOLD = 18;
export const POOL_POINT_DIVISOR = 5;

const POOL_STATS = new Set(['hp_max', 'mp_max', 'hp', 'mp', 'maxHp', 'maxMp']);

/**
 * Gold value of a rolled item's stat block (numeric entries only).
 * @param {Object|null} stats - e.g. modifications.baseStats
 * @returns {number}
 */
export function statBlockValue(stats) {
  if (!stats || typeof stats !== 'object') return 0;
  let points = 0;
  for (const [key, raw] of Object.entries(stats)) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) continue;
    points += POOL_STATS.has(key) ? value / POOL_POINT_DIVISOR : value;
  }
  return Math.floor(points * STAT_POINT_GOLD);
}

export const RARITY_NAMES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/**
 * Normalize rarity to a string name.
 * Handles numeric ids (1-5), numeric strings ('1'-'5'), and name strings.
 * @param {number|string} rarity - The rarity value to normalize
 * @returns {string} The rarity name ('common' to 'legendary')
 */
export function normalizeRarityName(rarity) {
  if (rarity === null || rarity === undefined) {
    return 'common';
  }

  // If it's already a valid rarity name string, return it
  if (typeof rarity === 'string') {
    const lower = rarity.toLowerCase();
    if (RARITY_NAMES.includes(lower)) {
      return lower;
    }
    // Try parsing as numeric string
    const parsed = parseInt(rarity, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) {
      return RARITY_NAMES[parsed - 1];
    }
    return 'common';
  }

  // Numeric rarity (1-5)
  if (typeof rarity === 'number' && rarity >= 1 && rarity <= 5) {
    return RARITY_NAMES[rarity - 1];
  }

  return 'common';
}
