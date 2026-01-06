// Character Races
const RACES = {
  HUMAN: 'human',
  ELF: 'elf',
  DWARF: 'dwarf',
  VAMPIRE: 'vampire',
  ORC: 'orc'
};

// Character Classes
const CLASSES = {
  WARRIOR: 'warrior',
  WIZARD: 'wizard',
  MONK: 'monk',
  CHEMIST: 'chemist'
};

// Base stats by race
const RACE_BASE_STATS = {
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
const CLASS_GROWTH = {
  [CLASSES.WARRIOR]: { hp: 15, mp: 3, strength: 3, intelligence: 1, agility: 1, vitality: 2 },
  [CLASSES.WIZARD]: { hp: 8, mp: 12, strength: 1, intelligence: 4, agility: 1, vitality: 1 },
  [CLASSES.MONK]: { hp: 10, mp: 6, strength: 2, intelligence: 2, agility: 3, vitality: 1 },
  [CLASSES.CHEMIST]: { hp: 10, mp: 8, strength: 1, intelligence: 2, agility: 2, vitality: 2 }
};

// Movement range by class
const CLASS_MOVEMENT = {
  [CLASSES.WARRIOR]: 3,
  [CLASSES.WIZARD]: 2,
  [CLASSES.MONK]: 4,
  [CLASSES.CHEMIST]: 3
};

// Node types
const NODE_TYPES = {
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
const BATTLE_NODE_TYPES = [NODE_TYPES.FOREST, NODE_TYPES.CAVE, NODE_TYPES.MOUNTAIN, NODE_TYPES.BRIDGE];

// Node features
const CASTLE_FEATURES = ['coliseum', 'tavern', 'courtyard', 'throne', 'blacksmith', 'apothecary', 'temple', 'stables', 'marketplace'];
const CITY_OPTIONS = ['blacksmith', 'apothecary', 'temple', 'stables'];

// Game limits
const MAX_PARTY_SIZE = 12;
const MAX_BATTLE_PARTY_SIZE = 5;
const MAX_CHARACTER_LEVEL = 256;
const STARTING_GOLD = 100;

// Experience formula: exp required for level N
const expForLevel = (level) => {
  return Math.floor(100 * Math.pow(level, 1.8));
};

// Calculate total stats for a character
const calculateStats = (race, charClass, level) => {
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
};

module.exports = {
  RACES,
  CLASSES,
  RACE_BASE_STATS,
  CLASS_GROWTH,
  CLASS_MOVEMENT,
  NODE_TYPES,
  BATTLE_NODE_TYPES,
  CASTLE_FEATURES,
  CITY_OPTIONS,
  MAX_PARTY_SIZE,
  MAX_BATTLE_PARTY_SIZE,
  MAX_CHARACTER_LEVEL,
  STARTING_GOLD,
  expForLevel,
  calculateStats
};
