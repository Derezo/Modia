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

import { resolveAugmentOverlay } from '../../../shared/overlayMapping.js';

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
  initiative: 'Initiative',

  // Fishing gear
  wait_reduction: 'Bite Wait Reduction',
  fishing_tackle: 'Fishing Tackle'
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
  CDMG: 'CDMG',

  accuracy: 'ACC',
  evasion: 'EVA',
  speed: 'SPD',
  initiative: 'INIT',

  physical_attack: 'P.ATK',
  physical_defense: 'P.DEF',

  wait_reduction: 'WAIT',
  fishing_tackle: 'TACKLE'
};

/**
 * Stat keys whose fractional values (e.g. 0.15) represent percentages.
 */
const PERCENT_STAT_KEYS = new Set([
  'criticalChance', 'crit_chance', 'CRIT',
  'criticalDamage', 'crit_damage', 'CDMG',
  'evasion', 'accuracy', 'wait_reduction'
]);

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
 * Format only the amount part of a stat ("+5", "+15%", "-2").
 * Boolean flags (e.g. fishing_tackle: true) have no amount and return ''.
 * @param {string} key - Stat key
 * @param {number|boolean} value - Stat value
 * @returns {string} Formatted amount
 */
export function formatStatAmount(key, value) {
  if (typeof value === 'boolean') return '';
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '');
  const sign = num > 0 ? '+' : '';
  if (PERCENT_STAT_KEYS.has(key) && Math.abs(num) < 1) {
    return `${sign}${Math.round(num * 100)}%`;
  }
  return `${sign}${num}`;
}

/**
 * Format a stat with its value
 * @param {string} key - Stat key
 * @param {number|boolean} value - Stat value
 * @param {boolean} [abbreviated=false] - Use abbreviated name
 * @returns {string} Formatted stat with value (e.g., "Strength +5" or "+5 STR")
 */
export function formatStatValue(key, value, abbreviated = false) {
  const name = formatStatName(key, abbreviated);

  // Boolean flags render as a plain label, never "+true"
  if (typeof value === 'boolean') {
    return value ? name : '';
  }

  const amount = formatStatAmount(key, value);

  if (abbreviated) {
    return `${amount} ${name}`;
  }

  return `${name} ${amount}`;
}

/**
 * Format an augment effect for display
 * @param {Object} augment - Augment object with effect data
 * @returns {string} Human-readable effect description
 */
export function formatAugmentEffect(augment) {
  if (!augment) return '';
  if (typeof augment === 'string') return formatStatName(augment);

  const text = describeAugmentEffect(augment);
  // Never surface broken interpolations like "+undefined Luck" or "NaN%"
  if (/undefined|NaN|null/.test(text)) {
    return augment.name || formatStatName(augment.category || '') || 'Unknown effect';
  }
  return text;
}

/**
 * Describe an augment's effect (unguarded; see formatAugmentEffect)
 * @param {Object} augment - Augment object
 * @returns {string} Effect text
 */
function describeAugmentEffect(augment) {

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
      // Rolled instances store the amount in augment.value; templates use
      // augment.bonus ([min, max] or a number) or effect.value.
      const statName = formatStatName(effect.stat || augment.stat);
      const raw = augment.bonus ?? augment.value ?? value;
      const statValue = Array.isArray(raw) ? raw[1] : raw;
      if (statValue === undefined || statValue === null || statValue === '') {
        return augment.name || `+${statName}`;
      }
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

  const getItemStats = (item) => sumItemStats(item, { includeCombat: true });

  const currentStats = getItemStats(currentItem);
  const newStats = getItemStats(newItem);

  // Get all stat keys
  const allKeys = new Set([...Object.keys(currentStats), ...Object.keys(newStats)]);

  for (const stat of allKeys) {
    // Boolean flags (e.g. fishing_tackle) have no numeric delta
    if (typeof currentStats[stat] === 'boolean' || typeof newStats[stat] === 'boolean') continue;
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

/**
 * Rarity names in tier order (1-based numeric rarity maps to index - 1)
 */
export const RARITY_NAMES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/**
 * Parchment-readable rarity text colours
 */
export const RARITY_TEXT_COLORS = {
  common: '#5a4a3a',
  uncommon: '#2d6b2d',
  rare: '#0055aa',
  epic: '#7722aa',
  legendary: '#cc6600'
};

/**
 * Normalize a rarity value (1-5, "4", "Epic", "epic") to its lowercase name.
 * Unknown values fall back to 'common' so it is always safe in class names.
 * @param {number|string|null|undefined} rarity - Raw rarity
 * @returns {string} Rarity name
 */
export function normalizeRarity(rarity) {
  if (rarity === null || rarity === undefined || rarity === '') return 'common';
  const num = Number(rarity);
  if (Number.isInteger(num)) {
    return RARITY_NAMES[num - 1] || 'common';
  }
  const name = String(rarity).toLowerCase();
  return RARITY_NAMES.includes(name) ? name : 'common';
}

/**
 * Sum an item's base and bonus stats per key. A bonus stat that shares a key
 * with a base stat adds to it (it does not replace it). Boolean flags are kept
 * as-is; non-numeric values are skipped.
 * @param {Object|null} item - Item with baseStats/bonusStats
 * @param {Object} [options]
 * @param {boolean} [options.includeCombat=false] - Also include item.attack / item.defense
 * @returns {Object} Summed stats
 */
export function sumItemStats(item, options = {}) {
  const { includeCombat = false } = options;
  const stats = {};
  if (!item) return stats;

  if (includeCombat) {
    if (item.attack) stats.attack = Number(item.attack) || 0;
    if (item.defense) stats.defense = Number(item.defense) || 0;
  }

  for (const source of [item.baseStats, item.bonusStats]) {
    if (!source || typeof source !== 'object') continue;
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'boolean') {
        if (value) stats[key] = true;
        continue;
      }
      const num = Number(value);
      if (!num || !Number.isFinite(num)) continue;
      stats[key] = (typeof stats[key] === 'number' ? stats[key] : 0) + num;
    }
  }

  // Drop keys that summed to zero
  for (const [key, value] of Object.entries(stats)) {
    if (value === 0) delete stats[key];
  }

  return stats;
}

/**
 * Rough item power used for sorting and upgrade detection:
 * attack + defense + every numeric summed stat.
 * @param {Object|null} item - Item
 * @returns {number} Power value
 */
export function calculateItemPower(item) {
  if (!item) return 0;
  return Object.values(sumItemStats(item, { includeCombat: true }))
    .reduce((total, v) => total + (typeof v === 'number' ? v : 0), 0);
}

/**
 * Augment icon files in public/assets/icons/png/{size}/augments
 */
export const AUGMENT_ICON_FILES = new Set([
  'accuracy_boost', 'accuracy', 'agility', 'area', 'armor', 'block', 'chain',
  'cleanse', 'cooldown', 'cost', 'crit_chance', 'critical', 'crit', 'damage_boost',
  'damage', 'dark', 'defense', 'demon-slayer', 'dragon-slayer', 'duration',
  'elemental_fire', 'elemental_ice', 'elemental_lightning', 'evasion', 'fire',
  'healing_boost', 'healing', 'holy', 'hp', 'ice', 'intelligence', 'lifesteal',
  'lightning', 'luck', 'magic_defense', 'mp_regen', 'mp', 'pierce', 'poison',
  'power', 'protection', 'range', 'regen', 'shield', 'speed', 'spell_resist',
  'splash', 'stagger', 'strength', 'undead-slayer', 'vitality'
]);

/**
 * Aliases from augment categories / effect types without their own icon
 * file to the closest existing icon.
 */
const AUGMENT_ICON_ALIASES = {
  // Slayer files are kebab-case
  demon_slayer: 'demon-slayer',
  dragon_slayer: 'dragon-slayer',
  undead_slayer: 'undead-slayer',
  // Consumable augment categories
  buff_str: 'strength',
  buff_int: 'intelligence',
  buff_agi: 'agility',
  buff_vit: 'vitality',
  hot_minor: 'regen',
  hot_major: 'regen',
  hot_percent: 'regen',
  cleanse_minor: 'cleanse',
  cleanse_major: 'cleanse',
  cleanse_all: 'cleanse',
  revive_bonus: 'healing',
  revive_full: 'healing',
  revive_immunity: 'protection',
  potency: 'damage_boost',
  empowerment: 'power',
  instant: 'speed',
  aoe: 'area',
  concentration: 'mp_regen',
  mp_bonus: 'mp',
  spell_cost: 'cost',
  // Effect types (used when an augment has no category)
  fire_damage: 'fire',
  ice_damage: 'ice',
  lightning_damage: 'lightning',
  holy_damage: 'holy',
  dark_damage: 'dark',
  poison_chance: 'poison',
  poison_dot: 'poison',
  burn_chance: 'fire',
  slow_chance: 'ice',
  stun_chance: 'stagger',
  damage_bonus: 'damage_boost',
  physical_attack: 'damage',
  physical_defense: 'defense',
  damage_reduction: 'protection',
  block_chance: 'block',
  magic_resist: 'spell_resist',
  damage_vs: 'damage_boost',
  hp_max_bonus: 'hp',
  mp_max_bonus: 'mp',
  hp_regen: 'regen',
  heal_on_hit: 'healing',
  initiative: 'speed',
  effect_multiplier: 'damage_boost',
  hot: 'regen',
  spell_cost_reduction: 'cost',
  buff: 'power',
  revive_hp_bonus: 'healing',
  // Stat shorthands
  magicDefense: 'magic_defense',
  crit_damage: 'critical'
};

/** Icon used when an augment category has no mapping */
export const DEFAULT_AUGMENT_ICON = 'power';

/**
 * Resolve an augment (object or category string) to an existing icon file name.
 * @param {Object|string|null} augmentOrCategory - Augment or its category
 * @returns {string} Icon name that exists under icons/png/{size}/augments
 */
export function resolveAugmentIconName(augmentOrCategory) {
  const candidates = [];
  if (typeof augmentOrCategory === 'string') {
    candidates.push(augmentOrCategory);
  } else if (augmentOrCategory && typeof augmentOrCategory === 'object') {
    candidates.push(
      augmentOrCategory.category,
      augmentOrCategory.effect?.type,
      augmentOrCategory.type,
      augmentOrCategory.effect?.stat,
      augmentOrCategory.stat
    );
  }

  for (const raw of candidates) {
    if (!raw || typeof raw !== 'string') continue;
    if (AUGMENT_ICON_FILES.has(raw)) return raw;
    const alias = AUGMENT_ICON_ALIASES[raw];
    if (alias) return alias;
    const kebab = raw.replace(/_/g, '-');
    if (AUGMENT_ICON_FILES.has(kebab)) return kebab;
    const snake = raw.replace(/-/g, '_');
    if (AUGMENT_ICON_FILES.has(snake)) return snake;
  }

  return DEFAULT_AUGMENT_ICON;
}

/**
 * Augment icon names that shared/overlayMapping.js has no overlay alias for,
 * mapped to the closest authored overlay.
 */
const AUGMENT_ICON_TO_OVERLAY = {
  accuracy_boost: 'augment_critical',
  crit_chance: 'augment_critical',
  damage_boost: 'augment_critical',
  elemental_fire: 'augment_fire',
  elemental_ice: 'augment_ice',
  elemental_lightning: 'augment_lightning',
  evasion: 'augment_speed',
  cooldown: 'augment_speed',
  healing_boost: 'augment_vitality',
  shield: 'augment_earth',
  stagger: 'augment_stun',
  splash: 'augment_chain',
  area: 'augment_chain',
  range: 'augment_pierce',
  cost: 'augment_arcane',
  duration: 'augment_arcane'
};

/**
 * Resolve an augment (object or category string) to an authored overlay id
 * (e.g. 'augment_fire') for item compositing.
 *
 * Tries each of the augment's identifiers (category, effect type, type, stat)
 * against the shared overlay mapping first, then falls back through
 * resolveAugmentIconName so every category that has an icon also gets an
 * overlay. Unknown augments return null rather than a misleading glow.
 * @param {Object|string|null} augment - Augment or its category
 * @returns {string|null} Overlay id safe to pass to getAssetPath, or null
 */
export function resolveAugmentOverlayId(augment) {
  const candidates = typeof augment === 'string'
    ? [augment]
    : (augment && typeof augment === 'object'
      ? [augment.category, augment.effect?.type, augment.type, augment.effect?.stat, augment.stat]
      : []);

  for (const candidate of candidates) {
    const overlayId = resolveAugmentOverlay(candidate);
    if (overlayId) return overlayId;
  }

  const iconName = resolveAugmentIconName(augment);
  if (iconName === DEFAULT_AUGMENT_ICON && !candidates.includes(DEFAULT_AUGMENT_ICON)) {
    // resolveAugmentIconName fell back to its generic icon: no real match
    return null;
  }
  return resolveAugmentOverlay(iconName) || AUGMENT_ICON_TO_OVERLAY[iconName] || null;
}

/**
 * Resolve and deduplicate overlay ids for a list of augments, preserving order.
 * @param {Array<Object|string>} augments - Augments or categories
 * @returns {string[]} Overlay ids
 */
export function resolveAugmentOverlayIds(augments) {
  if (!Array.isArray(augments)) return [];
  const resolved = [];
  for (const augment of augments) {
    const overlayId = resolveAugmentOverlayId(augment);
    if (overlayId && !resolved.includes(overlayId)) resolved.push(overlayId);
  }
  return resolved;
}

/**
 * Augment effect types that the server currently applies. Stat bonuses are
 * folded into bonusStats and counted by the equipment stat aggregation; the
 * other effect types are displayed but not yet applied in combat.
 */
export const ACTIVE_AUGMENT_EFFECT_TYPES = new Set([
  'stat_bonus',
  'crit_chance',
  'crit_damage',
  'lifesteal'
]);

/**
 * Whether an augment's effect is applied by the server today
 * @param {Object} augment - Augment
 * @returns {boolean}
 */
export function isAugmentEffectActive(augment) {
  if (!augment || typeof augment !== 'object') return false;
  const type = augment.effect?.type;
  if (!type) return false;
  return ACTIVE_AUGMENT_EFFECT_TYPES.has(type);
}

/**
 * Describe an augment for display: its name, effect text and (for rolled
 * equipment augments) the stat it added.
 * @param {Object|string} augment - Augment
 * @returns {{name: string, effect: string, statText: string, active: boolean, text: string}}
 */
export function describeAugment(augment) {
  if (!augment) return { name: '', effect: '', statText: '', active: false, text: '' };
  if (typeof augment === 'string') {
    const label = formatStatName(augment);
    return { name: label, effect: '', statText: '', active: false, text: label };
  }

  const effect = formatAugmentEffect(augment);
  const name = augment.name || '';
  const isStatBonus = augment.effect?.type === 'stat_bonus';
  const numericValue = Number(augment.value);
  const statText = !isStatBonus && augment.stat && Number.isFinite(numericValue) && numericValue !== 0
    ? formatStatValue(augment.stat, numericValue, false)
    : '';
  const effectPart = name && effect === name ? '' : effect;
  const text = [
    name && effectPart ? `${name}: ${effectPart}` : (name || effectPart),
    statText ? `(${statText})` : ''
  ].filter(Boolean).join(' ');

  return { name, effect: effectPart, statText, active: isAugmentEffectActive(augment), text };
}

/**
 * Whether an item's type and template slot fit an equipment slot.
 * Mirrors the server rule in POST /api/inventory/equip: armor and accessories
 * must match their template slot exactly; a main_hand weapon may go in either
 * hand; an off_hand item only in off_hand.
 * @param {Object} item - Inventory item (type, equipmentSlot)
 * @param {string} slotKey - Target slot
 * @returns {boolean}
 */
export function matchesEquipmentSlot(item, slotKey) {
  if (!item || !slotKey) return false;
  const typeSlots = {
    weapon: ['main_hand', 'off_hand'],
    shield: ['off_hand'],
    armor: ['head', 'body', 'legs', 'feet'],
    accessory: ['accessory']
  };
  const type = String(item.type || item.item_type || '').toLowerCase();
  if (!(typeSlots[type] || []).includes(slotKey)) return false;

  const templateSlot = item.equipmentSlot || item.equipment_slot || null;
  if (!templateSlot) return true;

  if (type === 'weapon' || type === 'shield') {
    if (templateSlot === 'off_hand') return slotKey === 'off_hand';
    return true; // main_hand weapons may be dual-wielded in off_hand
  }
  return templateSlot === slotKey;
}

/**
 * Reason a character cannot use an item (level or class), or null if they can.
 * @param {Object} item - Item (level_requirement, class_restriction)
 * @param {Object} [character] - { level, class }
 * @returns {string|null} e.g. "Requires Lv 15" or "Warrior, Mage only"
 */
export function getEquipRestriction(item, character) {
  if (!item) return null;
  const reqs = getItemRequirements(item);
  if (reqs.level > 0 && character && Number(character.level || 0) < reqs.level) {
    return `Requires Lv ${reqs.level}`;
  }
  if (reqs.classes.length > 0 && character) {
    const charClass = String(character.class || character.className || '').toLowerCase();
    if (!reqs.classes.some(c => String(c).toLowerCase() === charClass)) {
      return `${reqs.classes.map(c => formatStatName(String(c))).join(', ')} only`;
    }
  }
  return null;
}

/**
 * Keys that describe what a consumable does rather than a stat it grants.
 * Some templates store these in stat_bonuses (e.g. Mega-Potion hp_restore,
 * Mystery Box opens_to); they are shown as effects, not "+N" stats.
 */
export const ITEM_EFFECT_KEYS = new Set([
  'hp_restore', 'mp_restore', 'hp_full', 'mp_full', 'cure_all', 'cure_poison',
  'revive', 'hp_percent', 'opens_to', 'teleport', 'battle_escape', 'guaranteed',
  'fog_reveal', 'stamina_restore', 'discount', 'scope', 'mark_node', 'nearest',
  'buff', 'duration', 'lifesteal_buff'
]);

const EFFECT_TYPE_LABELS = {
  heal_hp: (v) => (v ? `Restores ${v} HP` : 'Restores HP'),
  heal_mp: (v) => (v ? `Restores ${v} MP` : 'Restores MP'),
  heal_both: (v) => (v ? `Restores ${v} HP and MP` : 'Restores HP and MP'),
  cure_poison: () => 'Cures poison',
  cure_all: () => 'Cures all ailments',
  revive: (v) => (v ? `Revives a fallen ally at ${v}% HP` : 'Revives a fallen ally')
};

const OPENS_TO_LABELS = {
  random_rare: 'Contains a random rare item',
  random_rare_plus: 'Contains a random rare or better item'
};

/**
 * Human-readable lines describing what a consumable does, from any of the
 * shapes the API uses: a caravan `effect` object, template
 * `effectType`/`effectValue` (or snake_case), and effect keys that some
 * templates keep in their stat bonuses.
 * @param {Object|null} item - Item
 * @returns {string[]} Effect lines (empty when the item has no effect)
 */
export function formatItemEffects(item) {
  if (!item) return [];
  const lines = [];
  const add = (line) => { if (line && !lines.includes(line)) lines.push(line); };

  const effectType = item.effectType ?? item.effect_type ?? null;
  const effectValue = Number(item.effectValue ?? item.effect_value) || 0;
  if (effectType) {
    const label = EFFECT_TYPE_LABELS[effectType];
    add(label ? label(effectValue) : formatStatName(effectType));
  }

  const sources = [];
  if (item.effect && typeof item.effect === 'object') sources.push(item.effect);
  for (const statSource of [item.statBonuses, item.stat_bonuses, item.baseStats]) {
    if (statSource && typeof statSource === 'object') {
      const effectOnly = Object.fromEntries(
        Object.entries(statSource).filter(([key]) => ITEM_EFFECT_KEYS.has(key))
      );
      if (Object.keys(effectOnly).length > 0) sources.push(effectOnly);
    }
  }

  for (const effect of sources) {
    const hp = Number(effect.hp_restore) || 0;
    const mp = Number(effect.mp_restore) || 0;
    if (hp && !effectType) add(`Restores ${hp} HP`);
    if (mp && !effectType) add(`Restores ${mp} MP`);
    if (effect.hp_full) add('Restores all HP');
    if (effect.mp_full) add('Restores all MP');
    if (effect.cure_all && effectType !== 'cure_all') add('Cures all ailments');
    if (effect.cure_poison && effectType !== 'cure_poison') add('Cures poison');
    if (effect.revive && effectType !== 'revive') {
      add(effect.hp_percent ? `Revives a fallen ally at ${effect.hp_percent}% HP` : 'Revives a fallen ally');
    }
    if (effect.opens_to) add(OPENS_TO_LABELS[effect.opens_to] || `Contains ${formatStatName(String(effect.opens_to)).toLowerCase()}`);
    if (effect.teleport) add(effect.teleport === 'nearest_castle' ? 'Teleports you to the nearest castle' : `Teleports you to ${formatStatName(String(effect.teleport)).toLowerCase()}`);
    if (effect.battle_escape) add(effect.guaranteed ? 'Guarantees escape from battle' : 'Escape from battle');
    if (effect.fog_reveal) add(`Reveals the map within ${effect.fog_reveal} nodes`);
    if (effect.stamina_restore) add(`Restores ${effect.stamina_restore} stamina`);
    if (effect.discount) {
      const pct = Math.round(Number(effect.discount) * (Number(effect.discount) < 1 ? 100 : 1));
      add(effect.scope === 'caravan_next' ? `${pct}% off your next caravan purchase` : `${pct}% discount`);
    }
    if (effect.mark_node) add(`Marks the ${effect.nearest ? 'nearest ' : ''}${formatStatName(String(effect.mark_node)).toLowerCase()} on the map`);
    if (effect.lifesteal_buff) add(`Grants ${effect.lifesteal_buff}% lifesteal`);
    if (effect.buff && typeof effect.buff === 'object') {
      const turns = Number(effect.duration) || 0;
      for (const [stat, value] of Object.entries(effect.buff)) {
        add(`${formatStatValue(stat, value)}${turns ? ` for ${turns} turns` : ''}`);
      }
    }
  }

  return lines;
}

/**
 * Whether the character could equip an item in a slot: the item fits the
 * slot (matchesEquipmentSlot) and the character meets its requirements.
 * @param {Object} item - Item
 * @param {string} slotKey - Equipment slot
 * @param {Object} [character] - { level, class }
 * @returns {boolean}
 */
export function canCharacterEquip(item, slotKey, character) {
  if (!item) return false;
  if (!matchesEquipmentSlot(item, slotKey)) return false;
  return !getEquipRestriction(item, character);
}

/**
 * Whether any inventory item is a strict power upgrade over what the
 * character wears in one of the given slots.
 * @param {Object} equipment - Map of slot key to equipped item
 * @param {Array<Object>} inventory - Unequipped items
 * @param {Object} character - { level, class }
 * @param {string[]} slots - Slot keys to check
 * @returns {boolean}
 */
export function hasEquipmentUpgrade(equipment, inventory, character, slots) {
  if (!equipment || typeof equipment !== 'object' || !Array.isArray(inventory)) return false;
  return slots.some((slotKey) => {
    const currentPower = calculateItemPower(equipment[slotKey]);
    return inventory.some(item =>
      canCharacterEquip(item, slotKey, character) && calculateItemPower(item) > currentPower
    );
  });
}

/**
 * Normalized level and class requirements of an item
 * @param {Object} item - Item
 * @returns {{level: number, classes: string[]}}
 */
export function getItemRequirements(item) {
  if (!item) return { level: 0, classes: [] };
  const level = Number(item.level_requirement ?? item.levelRequirement ?? 0) || 0;
  const rawClasses = item.class_restriction ?? item.classRestriction ?? item.classRestrictions ?? [];
  const classes = Array.isArray(rawClasses)
    ? rawClasses.filter(Boolean)
    : (typeof rawClasses === 'string' && rawClasses ? [rawClasses] : []);
  return { level, classes };
}

export default {
  formatStatName,
  formatStatValue,
  formatStatAmount,
  formatAugmentEffect,
  calculateStatChanges,
  formatStatChanges,
  normalizeRarity,
  sumItemStats,
  calculateItemPower,
  resolveAugmentIconName,
  resolveAugmentOverlayId,
  resolveAugmentOverlayIds,
  isAugmentEffectActive,
  describeAugment,
  matchesEquipmentSlot,
  getEquipRestriction,
  canCharacterEquip,
  hasEquipmentUpgrade,
  formatItemEffects,
  getItemRequirements
};
