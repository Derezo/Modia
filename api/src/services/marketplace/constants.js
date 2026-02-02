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
