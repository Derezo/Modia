// Shared constants between frontend and backend
// This file uses ESM format for modern JavaScript compatibility

// Character Races
export const RACES = {
  HUMAN: 'human',
  ELF: 'elf',
  DWARF: 'dwarf',
  VAMPIRE: 'vampire',
  ORC: 'orc'
};

/**
 * Racial Regions - each race has a homeland region with dominant terrain
 *
 * @typedef {Object} Region
 * @property {number} id - Unique region identifier (1-5)
 * @property {string} race - The race that inhabits this region (matches RACES values)
 * @property {string} name - Display name for the region
 * @property {string} castleName - Name of the region's capital castle
 * @property {string} dominantTerrain - Primary terrain type (matches NODE_TYPES: 'forest', 'cave', 'mountain')
 * @property {string[]} secondaryTerrains - Secondary terrain types in order of prevalence
 *
 * Terrain values are strings that match NODE_TYPES.FOREST, NODE_TYPES.CAVE, NODE_TYPES.MOUNTAIN.
 * They cannot use NODE_TYPES references here because NODE_TYPES is defined later in the file.
 */
export const REGIONS = {
  HEARTLANDS: {
    id: 1,
    race: RACES.HUMAN,
    name: 'Heartlands',
    castleName: "King's Keep",
    dominantTerrain: 'forest',
    secondaryTerrains: ['cave', 'mountain']
  },
  SYLVAN_REACHES: {
    id: 2,
    race: RACES.ELF,
    name: 'Sylvan Reaches',
    castleName: 'Starlight Citadel',
    dominantTerrain: 'forest',
    secondaryTerrains: ['mountain', 'cave']
  },
  IRON_DEPTHS: {
    id: 3,
    race: RACES.DWARF,
    name: 'Iron Depths',
    castleName: 'Stone Throne',
    dominantTerrain: 'cave',
    secondaryTerrains: ['mountain', 'forest']
  },
  SHADOWMERE: {
    id: 4,
    race: RACES.VAMPIRE,
    name: 'Shadowmere',
    castleName: 'Obsidian Spire',
    dominantTerrain: 'cave',
    secondaryTerrains: ['forest', 'mountain']
  },
  BLOODPLAINS: {
    id: 5,
    race: RACES.ORC,
    name: 'Bloodplains',
    castleName: "Warchief's Hold",
    dominantTerrain: 'mountain',
    secondaryTerrains: ['cave', 'forest']
  }
};

/**
 * Terrain distribution weights for region generation
 *
 * When generating terrain nodes for a region:
 * - DOMINANT_WEIGHT (70%): Probability of placing the region's dominant terrain
 * - SECONDARY_WEIGHT (30%): Split evenly among secondary terrains in the order listed
 *   (e.g., if 2 secondary terrains, each gets 15%)
 */
export const TERRAIN_DISTRIBUTION = {
  DOMINANT_WEIGHT: 0.70,
  SECONDARY_WEIGHT: 0.30
};

// Garrison configuration for castle recruitment
export const GARRISON_CONFIG = {
  recruitsPerCastle: { min: 8, max: 12 },
  raceWeight: { regional: 0.7, random: 0.3 },
  classWeight: { regional: 0.7, random: 0.3 },
  regionalClasses: {
    heartlands: ['warrior', 'chemist'],
    elven_glade: ['wizard', 'monk'],
    dwarven_holds: ['warrior', 'monk'],
    orcish_steppes: ['warrior', 'chemist'],
    feral_wilds: ['monk', 'chemist'],
  },
};

// Character Classes
export const CLASSES = {
  WARRIOR: 'warrior',
  WIZARD: 'wizard',
  MONK: 'monk',
  CHEMIST: 'chemist'
};

// Advanced classes (require level 10+ and quest completion)
export const ADVANCED_CLASSES = {
  // Warrior advancements (T1-T4)
  BERSERKER: 'berserker',
  PALADIN: 'paladin',
  GUARDIAN: 'guardian',
  WARLORD: 'warlord',
  // Wizard advancements (T1-T4)
  SORCERER: 'sorcerer',
  SUMMONER: 'summoner',
  CONJURER: 'conjurer',
  ORACLE: 'oracle',
  // Monk advancements (T1-T4)
  NINJA: 'ninja',
  MARTIAL_ARTIST: 'martial_artist',
  BRAWLER: 'brawler',
  ASCETIC: 'ascetic',
  // Chemist advancements (T1-T4)
  ALCHEMIST: 'alchemist',
  MEDIC: 'medic',
  PLAGUE_DOCTOR: 'plague_doctor',
  ARTIFICER: 'artificer'
};

// Character genders for portrait generation
export const GENDERS = {
  MALE: 'male',
  FEMALE: 'female',
  OTHER: 'other'
};

// Guild advancement tiers: ordered by difficulty (T1 easiest -> T4 hardest)
export const GUILD_ADVANCEMENT_TIERS = {
  warrior: ['berserker', 'paladin', 'guardian', 'warlord'],
  wizard: ['sorcerer', 'summoner', 'conjurer', 'oracle'],
  monk: ['ninja', 'martial_artist', 'brawler', 'ascetic'],
  chemist: ['alchemist', 'medic', 'plague_doctor', 'artificer']
};

// Quest requirements by tier
export const TIER_REQUIREMENTS = {
  1: { materials: 5, enemies: 10, nodes: 2, bossPhases: 1 },
  2: { materials: 8, enemies: 15, nodes: 3, bossPhases: 2 },
  3: { materials: 12, enemies: 20, nodes: 4, bossPhases: 2, hasSummons: true },
  4: { materialsRare: 15, materialsEpic: 3, enemies: 25, nodes: 5, bossPhases: 3, hasAuras: true }
};

// Minimum level to start advancement quests
export const ADVANCEMENT_QUEST_MIN_LEVEL = 10;

// Node types
export const NODE_TYPES = {
  CASTLE: 'castle',
  CITY: 'city',
  VILLAGE: 'village',
  FOREST: 'forest',
  CAVE: 'cave',
  MOUNTAIN: 'mountain',
  BRIDGE: 'bridge',
  GUILD: 'guild',
  PALACE: 'palace',
  KEEP: 'keep',
  // Terminator nodes (edge of map, 1 connection)
  CHEST: 'chest',
  SHRINE: 'shrine',
  DISCOVERY: 'discovery'
};

// Battle node types (where PvE battles occur)
export const BATTLE_NODE_TYPES = [NODE_TYPES.FOREST, NODE_TYPES.CAVE, NODE_TYPES.MOUNTAIN, NODE_TYPES.BRIDGE];

// Alias for backward compatibility (used by pathfinding and clearance checks)
export const COMBAT_NODE_TYPES = BATTLE_NODE_TYPES;

// Terminator node types (special reward nodes at map edges)
export const TERMINATOR_NODE_TYPES = [NODE_TYPES.CHEST, NODE_TYPES.SHRINE, NODE_TYPES.DISCOVERY];

// Shrine buff definitions
export const SHRINE_BUFFS = {
  stamina_regen: {
    name: "Pilgrim's Rest",
    description: 'Stamina regenerates 50% faster',
    effect: 'stamina_regen_bonus',
    value: 0.5,
    duration: 4  // hours
  },
  exp_bonus: {
    name: "Scholar's Insight",
    description: '+10% experience from battles',
    effect: 'exp_bonus',
    value: 0.1,
    duration: 4
  },
  gold_bonus: {
    name: "Merchant's Fortune",
    description: '+15% gold from battles',
    effect: 'gold_bonus',
    value: 0.15,
    duration: 4
  }
};

// Shrine visit cooldown in hours
export const SHRINE_COOLDOWN_HOURS = 6;

// Zodiac shrine effects - 12 signs with signature abilities
export const ZODIAC_SHRINE_BUFFS = {
  aries: {
    name: "Ram's Charge",
    description: 'First attack +25% crit chance',
    signatureAbility: 'rams_charge',
    element: 'fire',
    duration: 4 // hours
  },
  taurus: {
    name: 'Unmovable',
    description: 'Immune to push/pull effects',
    signatureAbility: 'unmovable',
    element: 'earth',
    duration: 4
  },
  gemini: {
    name: 'Twin Strike',
    description: 'Next attack hits twice at 60% damage',
    signatureAbility: 'twin_strike',
    element: 'air',
    duration: 4
  },
  cancer: {
    name: 'Moonshield',
    description: 'Block next instance of damage',
    signatureAbility: 'moonshield',
    element: 'water',
    duration: 4
  },
  leo: {
    name: 'Roar',
    description: 'Adjacent enemies lose 30 CT',
    signatureAbility: 'roar',
    element: 'fire',
    duration: 4
  },
  virgo: {
    name: 'Purify',
    description: 'Remove 1 debuff from self',
    signatureAbility: 'purify',
    element: 'earth',
    duration: 4
  },
  libra: {
    name: 'Balance',
    description: 'Heal equal to damage dealt (once)',
    signatureAbility: 'balance',
    element: 'air',
    duration: 4
  },
  scorpio: {
    name: 'Venom Sting',
    description: 'Apply 3% HP poison for 4 turns',
    signatureAbility: 'venom_sting',
    element: 'water',
    duration: 4
  },
  sagittarius: {
    name: 'Celestial Arrow',
    description: '+2 range on next attack',
    signatureAbility: 'celestial_arrow',
    element: 'fire',
    duration: 4
  },
  capricorn: {
    name: "Mountain's Endurance",
    description: '+25% defense for 2 turns',
    signatureAbility: 'mountains_endurance',
    element: 'earth',
    duration: 4
  },
  aquarius: {
    name: 'Cascade',
    description: 'Heal self for 20% of max HP',
    signatureAbility: 'cascade',
    element: 'air',
    duration: 4
  },
  pisces: {
    name: 'Dreamwave',
    description: '50% chance to sleep target 1 turn',
    signatureAbility: 'dreamwave',
    element: 'water',
    duration: 4
  }
};

// Zodiac crystal relics (permanent collectibles)
export const ZODIAC_CRYSTALS = {
  aries: { name: 'Crystal of the Ram', bonus: { type: 'physical_damage', value: 0.01 } },
  taurus: { name: 'Crystal of the Bull', bonus: { type: 'defense', value: 0.01 } },
  gemini: { name: 'Crystal of the Twins', bonus: { type: 'crit_chance', value: 0.01 } },
  cancer: { name: 'Crystal of the Crab', bonus: { type: 'healing_received', value: 0.01 } },
  leo: { name: 'Crystal of the Lion', bonus: { type: 'physical_damage', value: 0.01 } },
  virgo: { name: 'Crystal of the Maiden', bonus: { type: 'defense', value: 0.01 } },
  libra: { name: 'Crystal of the Scales', bonus: { type: 'crit_chance', value: 0.01 } },
  scorpio: { name: 'Crystal of the Scorpion', bonus: { type: 'healing_received', value: 0.01 } },
  sagittarius: { name: 'Crystal of the Archer', bonus: { type: 'physical_damage', value: 0.01 } },
  capricorn: { name: 'Crystal of the Sea-Goat', bonus: { type: 'defense', value: 0.01 } },
  aquarius: { name: 'Crystal of the Water-Bearer', bonus: { type: 'crit_chance', value: 0.01 } },
  pisces: { name: 'Crystal of the Fish', bonus: { type: 'healing_received', value: 0.01 } }
};

// Complete zodiac collection bonuses
export const ZODIAC_COLLECTION_BONUS = {
  title: 'Celestial Wanderer',
  allStatsBonus: 0.05, // +5% all stats
  dualBlessingSlots: true // Can hold 2 active blessings
};

// Node features
export const CASTLE_FEATURES = ['coliseum', 'tavern', 'courtyard', 'throne', 'blacksmith', 'apothecary', 'temple', 'stables', 'marketplace'];
export const CITY_OPTIONS = ['blacksmith', 'apothecary', 'temple', 'stables'];

// Game limits
export const MAX_PARTY_SIZE = 12;
export const MAX_BATTLE_PARTY_SIZE = 5;
export const MAX_CHARACTER_LEVEL = 256;
export const STARTING_GOLD = 1000;
export const STARTING_EXPERIENCE = 150;

// Starting consumables for new characters (templateId from items.js)
export const STARTING_CONSUMABLES = [
  { templateId: 29, quantity: 3 },  // Hi-Potion (150 HP)
  { templateId: 31, quantity: 1 },  // Elixir (100 HP + MP)
  { templateId: 14, quantity: 2 },  // Antidote
  { templateId: 13, quantity: 2 },  // Mana Potion (30 MP)
];
export const MAX_GOLD = 2147483647; // PostgreSQL INT max - prevents overflow
export const MAX_XP = 2147483647; // PostgreSQL INT max - prevents overflow
export const MAX_OPEN_ORDERS_PER_USER = 10; // Maximum concurrent marketplace orders

// Base stats by race
export const RACE_BASE_STATS = {
  [RACES.HUMAN]: {
    hp: 100, mp: 50, strength: 10, intelligence: 10, agility: 10, vitality: 10, luck: 10,
    trait: 'exp_bonus', traitValue: 0.10
  },
  [RACES.ELF]: {
    hp: 80, mp: 80, strength: 8, intelligence: 14, agility: 12, vitality: 6, luck: 10,
    trait: 'mp_regen', traitValue: 0.20
  },
  [RACES.DWARF]: {
    hp: 120, mp: 30, strength: 14, intelligence: 6, agility: 6, vitality: 16, luck: 8,
    trait: 'gold_bonus', traitValue: 0.15
  },
  [RACES.VAMPIRE]: {
    hp: 90, mp: 60, strength: 12, intelligence: 12, agility: 14, vitality: 8, luck: 4,
    trait: 'lifesteal', traitValue: 0.10
  },
  [RACES.ORC]: {
    hp: 130, mp: 20, strength: 16, intelligence: 4, agility: 8, vitality: 14, luck: 8,
    trait: 'crit_damage', traitValue: 0.25
  }
};

// Stat growth per level by class (includes LCK for crit/evasion/status resist scaling)
export const CLASS_GROWTH = {
  // Base classes
  [CLASSES.WARRIOR]: { hp: 15, mp: 3, strength: 3, intelligence: 1, agility: 1, vitality: 2, luck: 0.5 },
  [CLASSES.WIZARD]: { hp: 8, mp: 12, strength: 1, intelligence: 4, agility: 1, vitality: 1, luck: 0.5 },
  [CLASSES.MONK]: { hp: 10, mp: 6, strength: 2, intelligence: 2, agility: 3, vitality: 1, luck: 1.0 },
  [CLASSES.CHEMIST]: { hp: 10, mp: 8, strength: 1, intelligence: 2, agility: 2, vitality: 2, luck: 1.0 },

  // Warrior advanced classes (T1-T4)
  [ADVANCED_CLASSES.BERSERKER]: { hp: 18, mp: 2, strength: 4, intelligence: 1, agility: 1, vitality: 2, luck: 0.5 },
  [ADVANCED_CLASSES.PALADIN]: { hp: 16, mp: 6, strength: 3, intelligence: 2, agility: 1, vitality: 3, luck: 0.5 },
  [ADVANCED_CLASSES.GUARDIAN]: { hp: 20, mp: 4, strength: 2, intelligence: 1, agility: 1, vitality: 4, luck: 0.3 },
  [ADVANCED_CLASSES.WARLORD]: { hp: 17, mp: 5, strength: 3, intelligence: 2, agility: 2, vitality: 2, luck: 0.8 },

  // Wizard advanced classes (T1-T4)
  [ADVANCED_CLASSES.SORCERER]: { hp: 7, mp: 15, strength: 1, intelligence: 5, agility: 1, vitality: 1, luck: 0.5 },
  [ADVANCED_CLASSES.SUMMONER]: { hp: 9, mp: 14, strength: 1, intelligence: 4, agility: 1, vitality: 2, luck: 0.8 },
  [ADVANCED_CLASSES.CONJURER]: { hp: 8, mp: 13, strength: 1, intelligence: 4, agility: 2, vitality: 1, luck: 0.5 },
  [ADVANCED_CLASSES.ORACLE]: { hp: 8, mp: 14, strength: 1, intelligence: 5, agility: 1, vitality: 1, luck: 1.5 },

  // Monk advanced classes (T1-T4)
  [ADVANCED_CLASSES.NINJA]: { hp: 10, mp: 5, strength: 2, intelligence: 2, agility: 4, vitality: 1, luck: 1.5 },
  [ADVANCED_CLASSES.MARTIAL_ARTIST]: { hp: 12, mp: 5, strength: 3, intelligence: 1, agility: 4, vitality: 1, luck: 1.0 },
  [ADVANCED_CLASSES.BRAWLER]: { hp: 14, mp: 4, strength: 3, intelligence: 1, agility: 3, vitality: 2, luck: 0.8 },
  [ADVANCED_CLASSES.ASCETIC]: { hp: 11, mp: 8, strength: 2, intelligence: 3, agility: 3, vitality: 1, luck: 1.0 },

  // Chemist advanced classes (T1-T4)
  [ADVANCED_CLASSES.ALCHEMIST]: { hp: 11, mp: 10, strength: 1, intelligence: 3, agility: 2, vitality: 2, luck: 1.0 },
  [ADVANCED_CLASSES.MEDIC]: { hp: 12, mp: 12, strength: 1, intelligence: 4, agility: 1, vitality: 2, luck: 0.8 },
  [ADVANCED_CLASSES.PLAGUE_DOCTOR]: { hp: 10, mp: 11, strength: 1, intelligence: 4, agility: 2, vitality: 1, luck: 1.2 },
  [ADVANCED_CLASSES.ARTIFICER]: { hp: 11, mp: 9, strength: 2, intelligence: 3, agility: 2, vitality: 2, luck: 0.8 }
};

// Elemental System - 8 elements with resistance/weakness mechanics
export const ELEMENTS = {
  PHYSICAL: 'physical',  // Non-elemental, standard attacks
  FIRE: 'fire',
  ICE: 'ice',
  LIGHTNING: 'lightning',
  EARTH: 'earth',
  WIND: 'wind',
  WATER: 'water',
  HOLY: 'holy',
  DARK: 'dark'
};

// Elemental resistance levels (damage multiplier)
// Negative = weakness (takes more damage), Positive = resistance (takes less damage)
export const ELEMENTAL_RESISTANCE_LEVELS = {
  VERY_WEAK: -100,    // 200% damage (2x)
  WEAK: -50,          // 150% damage (1.5x)
  NORMAL: 0,          // 100% damage (1x)
  RESIST: 50,         // 50% damage (0.5x)
  HIGHLY_RESIST: 75,  // 25% damage (0.25x)
  IMMUNE: 100,        // 0% damage
  ABSORB: 150         // Heals instead of damages (-50% damage)
};

// Maximum elemental resistance cap (90% = always takes at least 10% damage)
export const MAX_ELEMENTAL_RESISTANCE = 90;

// Racial elemental resistances
// Positive values = resistance, Negative values = weakness
export const RACIAL_RESISTANCES = {
  human: {
    // Humans are balanced, no innate resistances or weaknesses
  },
  elf: {
    fire: -25,   // 25% weak to fire (125% damage)
    ice: 25,     // 25% resist ice (75% damage)
    wind: 15     // 15% resist wind (85% damage)
  },
  dwarf: {
    fire: 25,    // 25% resist fire (75% damage)
    ice: -25,    // 25% weak to ice (125% damage)
    earth: 25    // 25% resist earth (75% damage)
  },
  vampire: {
    holy: -50,   // 50% weak to holy (150% damage)
    dark: 50,    // 50% resist dark (50% damage)
    fire: -25    // 25% weak to fire (125% damage)
  },
  orc: {
    // Orcs are physically tough but no elemental affinity
    lightning: -15  // 15% weak to lightning (115% damage)
  }
};

// Movement range by class
export const CLASS_MOVEMENT = {
  // Base classes
  [CLASSES.WARRIOR]: 3,
  [CLASSES.WIZARD]: 3,
  [CLASSES.MONK]: 4,
  [CLASSES.CHEMIST]: 3,

  // Warrior advanced classes
  [ADVANCED_CLASSES.BERSERKER]: 3,
  [ADVANCED_CLASSES.PALADIN]: 3,
  [ADVANCED_CLASSES.GUARDIAN]: 2,  // Heavy armor restricts movement
  [ADVANCED_CLASSES.WARLORD]: 3,

  // Wizard advanced classes
  [ADVANCED_CLASSES.SORCERER]: 2,
  [ADVANCED_CLASSES.SUMMONER]: 3,
  [ADVANCED_CLASSES.CONJURER]: 3,
  [ADVANCED_CLASSES.ORACLE]: 3,

  // Monk advanced classes
  [ADVANCED_CLASSES.NINJA]: 5,
  [ADVANCED_CLASSES.MARTIAL_ARTIST]: 4,
  [ADVANCED_CLASSES.BRAWLER]: 3,   // Slower, more defensive
  [ADVANCED_CLASSES.ASCETIC]: 4,

  // Chemist advanced classes
  [ADVANCED_CLASSES.ALCHEMIST]: 3,
  [ADVANCED_CLASSES.MEDIC]: 3,
  [ADVANCED_CLASSES.PLAGUE_DOCTOR]: 3,
  [ADVANCED_CLASSES.ARTIFICER]: 2  // Carries heavy equipment
};

// Seeded random number generator (Mulberry32)
export class SeededRandom {
  constructor(seed) {
    this.seed = seed;
  }

  next() {
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick(array) {
    return array[Math.floor(this.next() * array.length)];
  }

  shuffle(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // Gaussian-like distribution using Box-Muller transform
  nextGaussian() {
    const u1 = this.next();
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

// Experience formula: exp required for level N
export function expForLevel(level) {
  return Math.floor(100 * Math.pow(level, 1.8));
}

// Calculate total stats for a character
// HP formula: baseHP + classGrowth + vitBonus where vitBonus = (level/2) + (VIT * 0.5)
// LCK now grows with level based on class growth
export function calculateStats(race, charClass, level) {
  const baseStats = RACE_BASE_STATS[race];
  const growth = CLASS_GROWTH[charClass];

  // Calculate base stats with level growth
  const vitality = baseStats.vitality + (growth.vitality * (level - 1));
  const luck = baseStats.luck + ((growth.luck || 0) * (level - 1));

  // HP formula: base + class growth + VIT bonus
  // VIT bonus = (level / 2) + (VIT * 0.5)
  // This ensures low VIT still gains HP but high VIT builds get ~2x HP
  const baseHP = baseStats.hp + (growth.hp * (level - 1));
  const vitBonus = Math.floor((level / 2) + (vitality * 0.5));
  const hpMax = baseHP + vitBonus;

  return {
    hpMax,
    mpMax: baseStats.mp + (growth.mp * (level - 1)),
    strength: baseStats.strength + (growth.strength * (level - 1)),
    intelligence: baseStats.intelligence + (growth.intelligence * (level - 1)),
    agility: baseStats.agility + (growth.agility * (level - 1)),
    vitality,
    luck: Math.floor(luck)
  };
}
