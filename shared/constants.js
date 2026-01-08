// Shared constants between frontend and backend
// Note: Backend uses CommonJS require, Frontend uses ES modules

export const RACES = {
  HUMAN: 'human',
  ELF: 'elf',
  DWARF: 'dwarf',
  VAMPIRE: 'vampire',
  ORC: 'orc'
};

export const CLASSES = {
  WARRIOR: 'warrior',
  WIZARD: 'wizard',
  MONK: 'monk',
  CHEMIST: 'chemist'
};

// Advanced classes (require level 20+ and base class)
export const ADVANCED_CLASSES = {
  BERSERKER: 'berserker',
  SORCERER: 'sorcerer',
  NINJA: 'ninja',
  ALCHEMIST: 'alchemist'
};

// Character genders for portrait generation
export const GENDERS = {
  MALE: 'male',
  FEMALE: 'female',
  OTHER: 'other'
};

// Advancement paths: base class -> advanced class
export const CLASS_ADVANCEMENT = {
  warrior: 'berserker',
  wizard: 'sorcerer',
  monk: 'ninja',
  chemist: 'alchemist'
};

export const ADVANCEMENT_LEVEL_REQUIREMENT = 20;

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

export const BATTLE_NODE_TYPES = ['forest', 'cave', 'mountain', 'bridge'];

export const MAX_PARTY_SIZE = 12;
export const MAX_BATTLE_PARTY_SIZE = 5;
export const MAX_CHARACTER_LEVEL = 256;
export const STARTING_GOLD = 100;

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
  [CLASSES.WARRIOR]: { hp: 15, mp: 3, strength: 3, intelligence: 1, agility: 1, vitality: 2 },
  [CLASSES.WIZARD]: { hp: 8, mp: 12, strength: 1, intelligence: 4, agility: 1, vitality: 1 },
  [CLASSES.MONK]: { hp: 10, mp: 6, strength: 2, intelligence: 2, agility: 3, vitality: 1 },
  [CLASSES.CHEMIST]: { hp: 10, mp: 8, strength: 1, intelligence: 2, agility: 2, vitality: 2 },
  // Advanced classes (higher growth, unlocked at level 20)
  [ADVANCED_CLASSES.BERSERKER]: { hp: 18, mp: 2, strength: 4, intelligence: 1, agility: 1, vitality: 2 },
  [ADVANCED_CLASSES.SORCERER]: { hp: 7, mp: 15, strength: 1, intelligence: 5, agility: 1, vitality: 1 },
  [ADVANCED_CLASSES.NINJA]: { hp: 10, mp: 5, strength: 2, intelligence: 2, agility: 4, vitality: 1 },
  [ADVANCED_CLASSES.ALCHEMIST]: { hp: 11, mp: 10, strength: 1, intelligence: 3, agility: 2, vitality: 2 }
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
}

// Experience formula
export function expForLevel(level) {
  return Math.floor(100 * Math.pow(level, 1.8));
}

// Calculate stats for a character
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
