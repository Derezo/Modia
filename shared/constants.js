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

// Legacy: Direct advancement paths (deprecated - use GUILD_ADVANCEMENT_TIERS)
// Kept for backwards compatibility during transition
export const CLASS_ADVANCEMENT = {
  warrior: 'berserker',
  wizard: 'sorcerer',
  monk: 'ninja',
  chemist: 'alchemist'
};

// Legacy: Old level requirement (deprecated - use ADVANCEMENT_QUEST_MIN_LEVEL)
export const ADVANCEMENT_LEVEL_REQUIREMENT = 20;

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
  PALACE: 'palace'
};

// Battle node types (where PvE battles occur)
export const BATTLE_NODE_TYPES = [NODE_TYPES.FOREST, NODE_TYPES.CAVE, NODE_TYPES.MOUNTAIN, NODE_TYPES.BRIDGE];

// Node features
export const CASTLE_FEATURES = ['coliseum', 'tavern', 'courtyard', 'throne', 'blacksmith', 'apothecary', 'temple', 'stables', 'marketplace'];
export const CITY_OPTIONS = ['blacksmith', 'apothecary', 'temple', 'stables'];

// Game limits
export const MAX_PARTY_SIZE = 12;
export const MAX_BATTLE_PARTY_SIZE = 5;
export const MAX_CHARACTER_LEVEL = 256;
export const STARTING_GOLD = 100;
export const MAX_GOLD = 2147483647; // PostgreSQL INT max - prevents overflow
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

// Stat growth per level by class
export const CLASS_GROWTH = {
  // Base classes
  [CLASSES.WARRIOR]: { hp: 15, mp: 3, strength: 3, intelligence: 1, agility: 1, vitality: 2 },
  [CLASSES.WIZARD]: { hp: 8, mp: 12, strength: 1, intelligence: 4, agility: 1, vitality: 1 },
  [CLASSES.MONK]: { hp: 10, mp: 6, strength: 2, intelligence: 2, agility: 3, vitality: 1 },
  [CLASSES.CHEMIST]: { hp: 10, mp: 8, strength: 1, intelligence: 2, agility: 2, vitality: 2 },

  // Warrior advanced classes (T1-T4)
  [ADVANCED_CLASSES.BERSERKER]: { hp: 18, mp: 2, strength: 4, intelligence: 1, agility: 1, vitality: 2 },
  [ADVANCED_CLASSES.PALADIN]: { hp: 16, mp: 6, strength: 3, intelligence: 2, agility: 1, vitality: 3 },
  [ADVANCED_CLASSES.GUARDIAN]: { hp: 20, mp: 4, strength: 2, intelligence: 1, agility: 1, vitality: 4 },
  [ADVANCED_CLASSES.WARLORD]: { hp: 17, mp: 5, strength: 3, intelligence: 2, agility: 2, vitality: 2 },

  // Wizard advanced classes (T1-T4)
  [ADVANCED_CLASSES.SORCERER]: { hp: 7, mp: 15, strength: 1, intelligence: 5, agility: 1, vitality: 1 },
  [ADVANCED_CLASSES.SUMMONER]: { hp: 9, mp: 14, strength: 1, intelligence: 4, agility: 1, vitality: 2 },
  [ADVANCED_CLASSES.CONJURER]: { hp: 8, mp: 13, strength: 1, intelligence: 4, agility: 2, vitality: 1 },
  [ADVANCED_CLASSES.ORACLE]: { hp: 8, mp: 14, strength: 1, intelligence: 5, agility: 1, vitality: 1 },

  // Monk advanced classes (T1-T4)
  [ADVANCED_CLASSES.NINJA]: { hp: 10, mp: 5, strength: 2, intelligence: 2, agility: 4, vitality: 1 },
  [ADVANCED_CLASSES.MARTIAL_ARTIST]: { hp: 12, mp: 5, strength: 3, intelligence: 1, agility: 4, vitality: 1 },
  [ADVANCED_CLASSES.BRAWLER]: { hp: 14, mp: 4, strength: 3, intelligence: 1, agility: 3, vitality: 2 },
  [ADVANCED_CLASSES.ASCETIC]: { hp: 11, mp: 8, strength: 2, intelligence: 3, agility: 3, vitality: 1 },

  // Chemist advanced classes (T1-T4)
  [ADVANCED_CLASSES.ALCHEMIST]: { hp: 11, mp: 10, strength: 1, intelligence: 3, agility: 2, vitality: 2 },
  [ADVANCED_CLASSES.MEDIC]: { hp: 12, mp: 12, strength: 1, intelligence: 4, agility: 1, vitality: 2 },
  [ADVANCED_CLASSES.PLAGUE_DOCTOR]: { hp: 10, mp: 11, strength: 1, intelligence: 4, agility: 2, vitality: 1 },
  [ADVANCED_CLASSES.ARTIFICER]: { hp: 11, mp: 9, strength: 2, intelligence: 3, agility: 2, vitality: 2 }
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
export function calculateStats(race, charClass, level) {
  const baseStats = RACE_BASE_STATS[race];
  const growth = CLASS_GROWTH[charClass];

  return {
    hpMax: baseStats.hp + (growth.hp * (level - 1)),
    mpMax: baseStats.mp + (growth.mp * (level - 1)),
    strength: baseStats.strength + (growth.strength * (level - 1)),
    intelligence: baseStats.intelligence + (growth.intelligence * (level - 1)),
    agility: baseStats.agility + (growth.agility * (level - 1)),
    vitality: baseStats.vitality + (growth.vitality * (level - 1)),
    luck: baseStats.luck
  };
}
