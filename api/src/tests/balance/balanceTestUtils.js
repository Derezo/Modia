/**
 * Balance Test Utilities
 * Helpers for testing game balance across damage formulas, class scaling, and economy
 */

import {
  RACES,
  CLASSES,
  ADVANCED_CLASSES,
  RACE_BASE_STATS,
  CLASS_GROWTH,
  calculateStats,
  expForLevel,
  MAX_CHARACTER_LEVEL
} from '../../../../shared/constants.js';

import {
  calculatePhysicalDamage,
  calculateMagicalDamage,
  calculateHitChance,
  calculateCritChance,
  calculateCritMultiplier,
  calculateHealing
} from '../../../../shared/battleMath.js';

import { TIER_MULTIPLIERS } from '../../services/enemyService.js';

/**
 * Create a mock character with calculated stats
 * @param {Object} options - Character options
 * @param {string} options.race - Character race
 * @param {string} options.charClass - Character class
 * @param {number} options.level - Character level
 * @param {number} options.equipmentAttack - Equipment attack bonus
 * @param {number} options.equipmentDefense - Equipment defense bonus
 * @returns {Object} Mock character with all stats
 */
export function createMockCharacter({
  race = 'human',
  charClass = 'warrior',
  level = 1,
  equipmentAttack = 0,
  equipmentDefense = 0,
  equipmentMagicAttack = 0,
  equipmentMagicDefense = 0
} = {}) {
  const baseStats = calculateStats(race, charClass, level);

  return {
    race,
    class: charClass,
    level,
    hp: baseStats.hpMax,
    maxHp: baseStats.hpMax,
    mp: baseStats.mpMax,
    maxMp: baseStats.mpMax,
    strength: baseStats.strength,
    intelligence: baseStats.intelligence,
    agility: baseStats.agility,
    vitality: baseStats.vitality,
    luck: baseStats.luck,
    attack: equipmentAttack,
    defense: equipmentDefense,
    magicAttack: equipmentMagicAttack,
    magicDefense: equipmentMagicDefense,
    statusEffects: []
  };
}

/**
 * Create a mock enemy scaled by party level and difficulty tier
 * @param {Object} options - Enemy options
 * @param {number} options.partyLevel - Average party level
 * @param {number} options.tier - Difficulty tier (1-5)
 * @param {string} options.archetype - Enemy archetype (beast, undead, etc.)
 * @returns {Object} Mock enemy with scaled stats
 */
export function createMockEnemy({
  partyLevel = 1,
  tier = 1,
  archetype = 'beast'
} = {}) {
  const tierMult = TIER_MULTIPLIERS[tier] || 1.0;
  const enemyLevel = Math.floor(partyLevel * tierMult);

  // Base enemy stats by archetype
  const archetypeStats = {
    beast: { hp: 50, mp: 10, str: 12, int: 5, agi: 10, vit: 8 },
    undead: { hp: 45, mp: 30, str: 10, int: 12, agi: 6, vit: 10 },
    humanoid: { hp: 60, mp: 40, str: 10, int: 10, agi: 10, vit: 10 },
    elemental: { hp: 35, mp: 60, str: 6, int: 16, agi: 12, vit: 5 },
    dragon: { hp: 100, mp: 50, str: 16, int: 12, agi: 8, vit: 14 }
  };

  const base = archetypeStats[archetype] || archetypeStats.beast;

  return {
    type: 'enemy',
    archetype,
    level: enemyLevel,
    hp: Math.floor(base.hp * (1 + enemyLevel * 0.10)),
    maxHp: Math.floor(base.hp * (1 + enemyLevel * 0.10)),
    mp: Math.floor(base.mp * (1 + enemyLevel * 0.05)),
    maxMp: Math.floor(base.mp * (1 + enemyLevel * 0.05)),
    strength: Math.floor(base.str * (1 + enemyLevel * 0.05)),
    intelligence: Math.floor(base.int * (1 + enemyLevel * 0.05)),
    agility: Math.floor(base.agi * (1 + enemyLevel * 0.05)),
    vitality: Math.floor(base.vit * (1 + enemyLevel * 0.05)),
    luck: 10,
    attack: 0,
    defense: 0,
    magicAttack: 0,
    magicDefense: 0,
    statusEffects: []
  };
}

/**
 * Calculate DPS for a character against a target
 * @param {Object} attacker - Attacker with stats
 * @param {Object} defender - Defender with stats
 * @param {string} damageType - 'physical' or 'magical'
 * @param {number} skillPower - Skill power multiplier
 * @returns {Object} DPS metrics
 */
export function calculateDPS(attacker, defender, damageType = 'physical', skillPower = 100) {
  const damageCalc = damageType === 'magical'
    ? calculateMagicalDamage(attacker, defender, skillPower)
    : calculatePhysicalDamage(attacker, defender, skillPower);

  const hitChance = calculateHitChance(attacker, defender);
  const critChance = calculateCritChance(attacker);
  const critMult = calculateCritMultiplier(attacker);

  // Expected damage per hit (accounting for crit)
  const avgDamage = damageCalc.avgDamage;
  const expectedCritDamage = avgDamage * critMult;
  const dph = (avgDamage * (1 - critChance) + expectedCritDamage * critChance) * hitChance;

  return {
    minDamage: damageCalc.minDamage,
    maxDamage: damageCalc.maxDamage,
    avgDamage: damageCalc.avgDamage,
    hitChance,
    critChance,
    critMultiplier: critMult,
    damagePerHit: dph,
    turnsToKill: Math.ceil(defender.hp / dph)
  };
}

/**
 * Calculate effective HP (accounting for defense)
 * @param {Object} unit - Unit with stats
 * @returns {number} Effective HP value
 */
export function calculateEffectiveHP(unit) {
  // EHP formula accounts for physical damage reduction
  const defenseReduction = (unit.vitality + unit.defense) * 0.5 * 0.3;
  // For each point of defense reduction, we need to take that much more "raw" damage
  // EHP = HP * (1 + defenseReduction / 100)
  return Math.floor(unit.hp * (1 + defenseReduction / 100));
}

/**
 * Simulate a battle between two units and return statistics
 * @param {Object} attacker - Attacking unit
 * @param {Object} defender - Defending unit
 * @param {string} damageType - 'physical' or 'magical'
 * @returns {Object} Battle simulation results
 */
export function simulateBattle(attacker, defender, damageType = 'physical') {
  const attackerDPS = calculateDPS(attacker, defender, damageType);
  const defenderDPS = calculateDPS(defender, attacker, 'physical');

  return {
    attackerTurnsToKill: attackerDPS.turnsToKill,
    defenderTurnsToKill: defenderDPS.turnsToKill,
    attackerWins: attackerDPS.turnsToKill <= defenderDPS.turnsToKill,
    attackerDPS: attackerDPS.damagePerHit,
    defenderDPS: defenderDPS.damagePerHit
  };
}

/**
 * Get all class/race combinations for testing
 * @returns {Array<{race: string, charClass: string}>}
 */
export function getAllCombinations() {
  const races = Object.values(RACES);
  const allClasses = [...Object.values(CLASSES), ...Object.values(ADVANCED_CLASSES)];
  const combinations = [];

  for (const race of races) {
    for (const charClass of allClasses) {
      combinations.push({ race, charClass });
    }
  }

  return combinations;
}

/**
 * Test levels for progression checks
 */
export const TEST_LEVELS = [1, 5, 10, 20, 30, 50, 100];

/**
 * All difficulty tiers
 */
export const ALL_TIERS = [1, 2, 3, 4, 5];

/**
 * Calculate gold per hour based on battle rewards
 * @param {Object} options - Options
 * @param {number} options.goldPerBattle - Average gold per battle
 * @param {number} options.battlesPerHour - Estimated battles per hour
 * @returns {number} Gold per hour
 */
export function calculateGoldPerHour({ goldPerBattle, battlesPerHour = 10 }) {
  return goldPerBattle * battlesPerHour;
}

/**
 * Calculate experience per hour
 * @param {Object} options - Options
 * @param {number} options.expPerBattle - Average exp per battle
 * @param {number} options.battlesPerHour - Estimated battles per hour
 * @returns {number} Exp per hour
 */
export function calculateExpPerHour({ expPerBattle, battlesPerHour = 10 }) {
  return expPerBattle * battlesPerHour;
}

/**
 * Calculate time to level (in hours)
 * @param {number} currentLevel - Current level
 * @param {number} targetLevel - Target level
 * @param {number} expPerHour - Experience gained per hour
 * @returns {number} Hours to reach target level
 */
export function calculateTimeToLevel(currentLevel, targetLevel, expPerHour) {
  let totalExp = 0;
  for (let level = currentLevel + 1; level <= targetLevel; level++) {
    totalExp += expForLevel(level);
  }
  return totalExp / expPerHour;
}

export {
  RACES,
  CLASSES,
  ADVANCED_CLASSES,
  RACE_BASE_STATS,
  CLASS_GROWTH,
  calculateStats,
  expForLevel,
  MAX_CHARACTER_LEVEL,
  calculatePhysicalDamage,
  calculateMagicalDamage,
  calculateHitChance,
  calculateCritChance,
  calculateCritMultiplier,
  calculateHealing,
  TIER_MULTIPLIERS
};
