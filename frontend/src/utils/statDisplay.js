/**
 * Stat Display Utilities
 *
 * Centralized formatting for stats and augment effects.
 * Provides consistent display across item detail views and equip modals.
 *
 * Usage:
 *   import { formatStatName, formatAugmentEffect } from '../utils/statDisplay.js';
 *   formatStatName('strength'); // "Strength"
 *   formatStatName('strength', true); // "STR"
 *   formatAugmentEffect(augment); // "+10% fire damage"
 */

// Full stat names mapping
const STAT_FULL_NAMES = {
  // Common variations
  strength: 'Strength',
  str: 'Strength',
  STR: 'Strength',
  intelligence: 'Intelligence',
  int: 'Intelligence',
  INT: 'Intelligence',
  agility: 'Agility',
  agi: 'Agility',
  AGI: 'Agility',
  vitality: 'Vitality',
  vit: 'Vitality',
  VIT: 'Vitality',
  dexterity: 'Dexterity',
  dex: 'Dexterity',
  DEX: 'Dexterity',
  luck: 'Luck',
  lck: 'Luck',
  LCK: 'Luck',

  // Combat stats
  attack: 'Attack',
  atk: 'Attack',
  ATK: 'Attack',
  defense: 'Defense',
  def: 'Defense',
  DEF: 'Defense',
  magicAttack: 'Magic Attack',
  magic_attack: 'Magic Attack',
  matk: 'Magic Attack',
  MATK: 'Magic Attack',
  magicDefense: 'Magic Defense',
  magic_defense: 'Magic Defense',
  mdef: 'Magic Defense',
  MDEF: 'Magic Defense',

  // Resource stats
  hp: 'HP',
  HP: 'HP',
  hp_max: 'Max HP',
  HP_MAX: 'Max HP',
  maxHp: 'Max HP',
  currentHp: 'Current HP',
  mp: 'MP',
  MP: 'MP',
  mp_max: 'Max MP',
  MP_MAX: 'Max MP',
  maxMp: 'Max MP',
  currentMp: 'Current MP',

  // Derived stats
  criticalChance: 'Critical Chance',
  crit_chance: 'Critical Chance',
  CRIT: 'Critical Chance',
  criticalDamage: 'Critical Damage',
  crit_damage: 'Critical Damage',
  CDMG: 'Critical Damage',
  accuracy: 'Accuracy',
  evasion: 'Evasion',
  speed: 'Speed',
  initiative: 'Initiative'
};

// Abbreviated stat names
const STAT_ABBREVIATIONS = {
  strength: 'STR',
  str: 'STR',
  STR: 'STR',
  intelligence: 'INT',
  int: 'INT',
  INT: 'INT',
  agility: 'AGI',
  agi: 'AGI',
  AGI: 'AGI',
  vitality: 'VIT',
  vit: 'VIT',
  VIT: 'VIT',
  dexterity: 'DEX',
  dex: 'DEX',
  DEX: 'DEX',
  luck: 'LCK',
  lck: 'LCK',
  LCK: 'LCK',

  attack: 'ATK',
  atk: 'ATK',
  ATK: 'ATK',
  defense: 'DEF',
  def: 'DEF',
  DEF: 'DEF',
  magicAttack: 'MATK',
  magic_attack: 'MATK',
  matk: 'MATK',
  MATK: 'MATK',
  magicDefense: 'MDEF',
  magic_defense: 'MDEF',
  mdef: 'MDEF',
  MDEF: 'MDEF',

  hp: 'HP',
  HP: 'HP',
  hp_max: 'Max HP',
  HP_MAX: 'Max HP',
  maxHp: 'Max HP',
  mp: 'MP',
  MP: 'MP',
  mp_max: 'Max MP',
  MP_MAX: 'Max MP',
  maxMp: 'Max MP',

  criticalChance: 'CRIT',
  crit_chance: 'CRIT',
  CRIT: 'CRIT',
  criticalDamage: 'CDMG',
  crit_damage: 'CDMG',
  CDMG: 'CDMG'
};

/**
 * Format a stat key into a display name
 * @param {string} key - Stat key (e.g., 'strength', 'MP_MAX')
 * @param {boolean} [abbreviated=false] - Use abbreviated form
 * @returns {string} Formatted stat name
 */
export function formatStatName(key, abbreviated = false) {
  if (!key) return '';

  const map = abbreviated ? STAT_ABBREVIATIONS : STAT_FULL_NAMES;
  const result = map[key];

  if (result) return result;

  // Fallback: convert snake_case/camelCase to Title Case
  if (abbreviated) {
    // For abbreviation, take first 3-4 chars
    return key.replace(/[_-]/g, '').substring(0, 4).toUpperCase();
  }

  // For full name, convert to title case
  return key
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Format a stat with its value
 * @param {string} key - Stat key
 * @param {number} value - Stat value
 * @param {boolean} [abbreviated=false] - Use abbreviated name
 * @returns {string} Formatted stat with value (e.g., "Strength +5" or "+5 STR")
 */
export function formatStatValue(key, value, abbreviated = false) {
  const name = formatStatName(key, abbreviated);
  const sign = value > 0 ? '+' : '';

  if (abbreviated) {
    return `${sign}${value} ${name}`;
  }

  return `${name} ${sign}${value}`;
}

/**
 * Format an augment effect for display
 * @param {Object} augment - Augment object with effect data
 * @returns {string} Human-readable effect description
 */
export function formatAugmentEffect(augment) {
  if (!augment) return '';

  const effect = augment.effect;
  if (!effect) {
    // Fallback to name if no effect data
    return augment.name || augment.category || 'Unknown effect';
  }

  const type = effect.type;
  const value = effect.value;

  switch (type) {
    // Elemental damage bonuses
    case 'fire_damage':
      return `+${Math.round(value * 100)}% fire damage`;
    case 'ice_damage':
      return `+${Math.round(value * 100)}% ice damage`;
    case 'lightning_damage':
      return `+${Math.round(value * 100)}% lightning damage`;
    case 'holy_damage':
      return `+${Math.round(value * 100)}% holy damage`;
    case 'dark_damage':
      return `+${Math.round(value * 100)}% dark damage`;

    // Status effect chances
    case 'poison_chance':
      return `${Math.round(value * 100)}% chance to poison`;
    case 'burn_chance':
      return effect.duration
        ? `${Math.round(value * 100)}% chance to burn (${effect.duration} turns)`
        : `${Math.round(value * 100)}% chance to burn`;
    case 'slow_chance':
      return effect.duration
        ? `${Math.round(value * 100)}% chance to slow (${effect.duration} turns)`
        : `${Math.round(value * 100)}% chance to slow`;
    case 'stun_chance':
      return `${Math.round(value * 100)}% chance to stun`;
    case 'poison_dot':
      return effect.duration
        ? `${Math.round(value * 100)}% poison damage/turn (${effect.duration} turns)`
        : `${Math.round(value * 100)}% poison damage/turn`;

    // Combat bonuses
    case 'crit_chance':
      return `+${Math.round(value * 100)}% critical chance`;
    case 'crit_damage':
      return `+${Math.round(value * 100)}% critical damage`;
    case 'initiative':
      return `+${Math.round(value * 100)}% initiative`;
    case 'damage_bonus':
      return `+${Math.round(value * 100)}% damage`;
    case 'physical_attack':
      return `+${Math.round(value * 100)}% physical attack`;

    // Defense bonuses
    case 'physical_defense':
      return `+${Math.round(value * 100)}% physical defense`;
    case 'magic_defense':
      return `+${Math.round(value * 100)}% magic defense`;
    case 'defense':
      return typeof value === 'number' && value < 1
        ? `+${Math.round(value * 100)}% defense`
        : `+${value} defense`;
    case 'damage_reduction':
      return `${Math.round(value * 100)}% damage reduction`;
    case 'block_chance':
      return `+${Math.round(value * 100)}% block chance`;
    case 'magic_resist':
      return `+${Math.round(value * 100)}% magic resistance`;

    // Enemy-type damage
    case 'damage_vs':
      return effect.target
        ? `+${Math.round(value * 100)}% damage vs ${effect.target}s`
        : `+${Math.round(value * 100)}% bonus damage`;

    // Stat bonuses
    case 'stat_bonus': {
      const statName = formatStatName(effect.stat || augment.stat);
      const statValue = augment.bonus
        ? (Array.isArray(augment.bonus) ? augment.bonus[1] : augment.bonus)
        : value;
      return `+${statValue} ${statName}`;
    }

    // Resource bonuses
    case 'hp_max_bonus':
      return `+${Math.round(value * 100)}% max HP`;
    case 'mp_max_bonus':
      return `+${Math.round(value * 100)}% max MP`;
    case 'hp_regen':
      return `+${Math.round(value * 100)}% HP regeneration`;
    case 'mp_regen':
      if (effect.duration) {
        return `+${value} MP/turn (${effect.duration} turns)`;
      }
      return `+${Math.round(value * 100)}% MP regeneration`;

    // On-hit effects
    case 'heal_on_hit':
      return `${Math.round(value * 100)}% heal on hit`;
    case 'lifesteal':
      return `${Math.round(value * 100)}% lifesteal`;

    // Consumable effects
    case 'effect_multiplier':
      return `+${Math.round((value - 1) * 100)}% effect strength`;
    case 'hot':
      return effect.duration
        ? `+${value} HP/turn (${effect.duration} turns)`
        : `+${value} HP/turn`;
    case 'hot_percent':
      return effect.duration
        ? `+${Math.round(value * 100)}% HP/turn (${effect.duration} turns)`
        : `+${Math.round(value * 100)}% HP/turn`;
    case 'mp_bonus':
      return `+${value} MP restored`;
    case 'spell_cost_reduction':
      return effect.duration
        ? `-${Math.round(value * 100)}% spell cost (${effect.duration} turns)`
        : `-${Math.round(value * 100)}% spell cost`;

    // Cleanse effects
    case 'cleanse':
      if (effect.targets === 'all') {
        return 'Removes all status effects';
      }
      if (Array.isArray(effect.targets)) {
        return `Removes ${effect.targets.join(', ')}`;
      }
      return 'Removes status effects';

    // Buff effects
    case 'buff': {
      const buffStat = formatStatName(effect.stat);
      return effect.duration
        ? `+${effect.value} ${buffStat} (${effect.duration} turns)`
        : `+${effect.value} ${buffStat}`;
    }

    // Revival effects
    case 'revive_hp_bonus':
      return `+${Math.round(value * 100)}% HP on revive`;
    case 'revive_full':
      return 'Revive with full HP';
    case 'revive_immunity':
      return effect.duration
        ? `Immunity after revive (${effect.duration} turns)`
        : 'Immunity after revive';

    // Utility effects
    case 'instant':
      return 'Instant effect';
    case 'aoe':
      return effect.radius
        ? `Affects nearby allies (${effect.radius} tile radius)`
        : 'Affects nearby allies';

    default: {
      // Fallback: try to make something readable from the type
      const readable = type
        .replace(/_/g, ' ')
        .replace(/([A-Z])/g, ' $1')
        .trim();
      if (value !== undefined && value !== null) {
        if (typeof value === 'number' && value < 1 && value > 0) {
          return `${Math.round(value * 100)}% ${readable}`;
        }
        return `+${value} ${readable}`;
      }
      return readable;
    }
  }
}

/**
 * Calculate stat changes between two items
 * @param {Object} currentItem - Currently equipped item (can be null)
 * @param {Object} newItem - New item to compare
 * @returns {Array} Array of { stat, oldValue, newValue, diff } objects
 */
export function calculateStatChanges(currentItem, newItem) {
  const changes = [];

  // Helper to get all stats from an item
  const getItemStats = (item) => {
    if (!item) return {};
    const stats = {};

    if (item.attack) stats.attack = item.attack;
    if (item.defense) stats.defense = item.defense;

    const baseStats = item.baseStats || {};
    const bonusStats = item.bonusStats || {};

    Object.entries(baseStats).forEach(([k, v]) => {
      if (v) stats[k] = (stats[k] || 0) + v;
    });
    Object.entries(bonusStats).forEach(([k, v]) => {
      if (v) stats[k] = (stats[k] || 0) + v;
    });

    return stats;
  };

  const currentStats = getItemStats(currentItem);
  const newStats = getItemStats(newItem);

  // Get all stat keys
  const allKeys = new Set([...Object.keys(currentStats), ...Object.keys(newStats)]);

  for (const stat of allKeys) {
    const oldValue = currentStats[stat] || 0;
    const newValue = newStats[stat] || 0;
    const diff = newValue - oldValue;

    if (diff !== 0) {
      changes.push({ stat, oldValue, newValue, diff });
    }
  }

  // Sort by absolute diff descending
  changes.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  return changes;
}

/**
 * Format stat changes for display
 * @param {Array} changes - Array from calculateStatChanges
 * @param {Object} [options] - Formatting options
 * @param {boolean} [options.abbreviated=false] - Use abbreviated stat names
 * @param {boolean} [options.showSign=true] - Show + sign for positive values
 * @returns {Array} Array of { stat, text, diff, className } objects
 */
export function formatStatChanges(changes, options = {}) {
  const { abbreviated = false, showSign = true } = options;

  return changes.map(({ stat, diff }) => {
    const statName = formatStatName(stat, abbreviated);
    const sign = showSign && diff > 0 ? '+' : '';
    const text = abbreviated
      ? `${statName} ${sign}${diff}`
      : `${statName} ${sign}${diff}`;

    return {
      stat,
      text,
      diff,
      className: diff > 0 ? 'stat-positive' : 'stat-negative'
    };
  });
}

export default {
  formatStatName,
  formatStatValue,
  formatAugmentEffect,
  calculateStatChanges,
  formatStatChanges
};
