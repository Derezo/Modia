/**
 * Character Level Service
 *
 * Handles character level calculations based on spent XP.
 * Character level is derived from the cumulative XP spent on learning skills.
 *
 * Level Threshold Formula: level^2.8 * 100
 *
 * Level Progression Table:
 * Level 1:   0 XP
 * Level 2:   695 XP
 * Level 5:   8,781 XP
 * Level 10:  63,096 XP
 * Level 20:  438,531 XP
 * Level 50:  6,309,573 XP
 * Level 100: 39,810,717 XP
 */

import { CLASS_GROWTH, CLASSES } from '../../../shared/constants.js';

const LEVEL_EXPONENT = 2.8;
const LEVEL_MULTIPLIER = 100;
const MAX_CHARACTER_LEVEL = 256;

/**
 * Calculate the XP threshold required to reach a specific level
 * @param {number} level - Target level (1-256)
 * @returns {number} XP required to reach that level
 */
function getXPThresholdForLevel(level) {
  if (level <= 1) return 0;
  return Math.floor(Math.pow(level, LEVEL_EXPONENT) * LEVEL_MULTIPLIER);
}

/**
 * Calculate character level from cumulative spent XP
 * Uses binary search for efficient lookup
 * @param {number} spentXP - Total XP spent on skills
 * @returns {number} Character level (1-256)
 */
function calculateLevelFromSpentXP(spentXP) {
  if (spentXP <= 0) return 1;

  // Binary search for the highest level where threshold <= spentXP
  let low = 1;
  let high = MAX_CHARACTER_LEVEL;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (getXPThresholdForLevel(mid) <= spentXP) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low;
}

/**
 * Get progress information toward the next level
 * @param {number} spentXP - Total XP spent on skills
 * @param {number} currentLevel - Current character level (optional, calculated if not provided)
 * @returns {object} Progress info: {current, needed, percent, nextLevel}
 */
function getLevelProgress(spentXP, currentLevel = null) {
  const level = currentLevel ?? calculateLevelFromSpentXP(spentXP);

  if (level >= MAX_CHARACTER_LEVEL) {
    return {
      current: 0,
      needed: 0,
      percent: 1.0,
      nextLevel: MAX_CHARACTER_LEVEL,
      isMaxLevel: true
    };
  }

  const currentThreshold = getXPThresholdForLevel(level);
  const nextThreshold = getXPThresholdForLevel(level + 1);
  const xpIntoCurrentLevel = spentXP - currentThreshold;
  const xpNeededForNextLevel = nextThreshold - currentThreshold;

  return {
    current: xpIntoCurrentLevel,
    needed: xpNeededForNextLevel,
    percent: xpIntoCurrentLevel / xpNeededForNextLevel,
    nextLevel: level + 1,
    isMaxLevel: false
  };
}

/**
 * Calculate stat gains when leveling up
 * Uses CLASS_GROWTH from shared/constants.js as canonical source.
 * Stats gained per level-up are based on class growth rates.
 *
 * @param {number} oldLevel - Previous level
 * @param {number} newLevel - New level
 * @param {string} characterClass - Character's class
 * @returns {object} Stat gains: {hp, mp, str, int, agi, vit, luck}
 */
function calculateLevelUpStatGains(oldLevel, newLevel, characterClass) {
  const growth = CLASS_GROWTH[characterClass] || CLASS_GROWTH[CLASSES.WARRIOR];
  const levelsGained = newLevel - oldLevel;

  return {
    hp: Math.floor(growth.hp * levelsGained),
    mp: Math.floor(growth.mp * levelsGained),
    str: Math.floor(growth.strength * levelsGained),
    int: Math.floor(growth.intelligence * levelsGained),
    agi: Math.floor(growth.agility * levelsGained),
    vit: Math.floor(growth.vitality * levelsGained),
    luck: Math.floor((growth.luck || 0) * levelsGained)
  };
}

/**
 * Check if learning skills would result in level up(s)
 * @param {number} currentSpentXP - Current spent XP
 * @param {number} xpToSpend - Additional XP being spent
 * @param {number} currentLevel - Current character level
 * @returns {object|null} Level up info or null if no level up
 */
function checkForLevelUp(currentSpentXP, xpToSpend, currentLevel) {
  const newSpentXP = currentSpentXP + xpToSpend;
  const newLevel = calculateLevelFromSpentXP(newSpentXP);

  if (newLevel > currentLevel) {
    return {
      oldLevel: currentLevel,
      newLevel,
      levelsGained: newLevel - currentLevel
    };
  }

  return null;
}

/**
 * Generate a summary of level progression for display
 * @param {number} spentXP - Current spent XP
 * @returns {object} Progression summary
 */
function getLevelProgressionSummary(spentXP) {
  const level = calculateLevelFromSpentXP(spentXP);
  const progress = getLevelProgress(spentXP, level);

  return {
    level,
    spentXP,
    progress,
    thresholds: {
      current: getXPThresholdForLevel(level),
      next: progress.isMaxLevel ? null : getXPThresholdForLevel(level + 1)
    }
  };
}

export {
  getXPThresholdForLevel,
  calculateLevelFromSpentXP,
  getLevelProgress,
  calculateLevelUpStatGains,
  checkForLevelUp,
  getLevelProgressionSummary,
  LEVEL_EXPONENT,
  LEVEL_MULTIPLIER,
  MAX_CHARACTER_LEVEL
};
