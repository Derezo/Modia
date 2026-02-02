/**
 * Recruitment Utilities - Shared logic for guild and garrison recruit systems
 *
 * This module consolidates recruit pricing, skill assignment, and weighted random
 * selection logic used by both recruitService.js and garrisonService.js.
 */

import { SKILL_TREES } from '../config/skillTrees.js';

// ============================================================================
// Pricing Constants
// ============================================================================

export const RECRUIT_PRICING = {
  BASE_PRICE: 400,
  STAT_VARIANCE_BONUS: 5, // +5g per 1% above average (0 for below)
  TRAIT_PRICES: {
    common: 100,
    uncommon: 300,
    rare: 1000,
    legendary: 4000
  },
  SKILL_PRICE_MULTIPLIER: 250 // 250g x tier x level (first T1L1 free)
};

// ============================================================================
// Trait Generation Weights
// ============================================================================

/**
 * Trait rarity weights: 70% common, 20% uncommon, 8% rare, 2% legendary
 */
export const TRAIT_RARITY_WEIGHTS = {
  common: 70,
  uncommon: 20,
  rare: 8,
  legendary: 2
};

/**
 * Trait count weights: 92% get 1 trait, 8% get 2 traits
 */
export const TRAIT_COUNT_WEIGHTS = {
  1: 92,
  2: 8
};

// ============================================================================
// Skill Generation Weights
// ============================================================================

/**
 * Additional skill count weights (beyond the guaranteed starter skill)
 * All recruits now receive at least 1 skill (starter), this determines EXTRA skills:
 * - 60% get 0 additional skills (just starter)
 * - 30% get 1 additional skill (starter + 1)
 * - 10% get 2 additional skills (starter + 2)
 */
export const ADDITIONAL_SKILL_COUNT_WEIGHTS = {
  0: 60,
  1: 30,
  2: 10
};

// ============================================================================
// Weighted Random Selection
// ============================================================================

/**
 * Roll a value based on weighted probabilities
 * @param {Object} weights - { option1: weight1, option2: weight2, ... }
 * @returns {string|number} Selected option key (returns as number if parseable)
 * @example
 * weightedRandom({ common: 70, rare: 30 }) // 70% chance of 'common'
 * weightedRandom({ 1: 92, 2: 8 })          // 92% chance of 1, 8% chance of 2
 */
export function weightedRandom(weights) {
  const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;

  for (const [option, weight] of Object.entries(weights)) {
    random -= weight;
    if (random <= 0) {
      // Return as number if it parses as one
      const num = Number(option);
      return isNaN(num) ? option : num;
    }
  }

  // Fallback to first option
  const firstKey = Object.keys(weights)[0];
  const num = Number(firstKey);
  return isNaN(num) ? firstKey : num;
}

// ============================================================================
// Recruit Pricing
// ============================================================================

/**
 * Calculate recruit price based on attributes
 *
 * Pricing formula:
 * - Base price: 400g
 * - Stat variance: +5g per 1% above average (no discount for below average)
 * - Traits: Add price based on rarity (all traits count)
 * - Skills: First T1L1 skill is free, others cost 250g x tier x level
 *
 * @param {Object} recruit - Recruit attributes
 * @param {number} [recruit.stat_variance_percent] - Stat variance (-15 to +15)
 * @param {Array<{rarity: string}>} [recruit.traits] - Array of trait objects with rarity
 * @param {Array<{tier: number, level: number}>} [recruit.skills] - Array of skill objects
 * @returns {number} Price in gold
 *
 * @example
 * // Recruit with +10% stats, one rare trait, and two skills (T1L1 + T2L1)
 * calculateRecruitPrice({
 *   stat_variance_percent: 10,
 *   traits: [{ rarity: 'rare' }],
 *   skills: [{ tier: 1, level: 1 }, { tier: 2, level: 1 }]
 * });
 * // => 400 + 50 + 1000 + 0 + 500 = 1950g
 */
export function calculateRecruitPrice(recruit) {
  let price = RECRUIT_PRICING.BASE_PRICE;

  // Stat variance: +5g per 1% above average (no discount for below)
  const variance = recruit.stat_variance_percent || 0;
  if (variance > 0) {
    price += Math.floor(variance * RECRUIT_PRICING.STAT_VARIANCE_BONUS);
  }

  // Traits: add price based on rarity (all traits count)
  const traits = recruit.traits || [];
  for (const trait of traits) {
    const rarity = trait.rarity || 'common';
    price += RECRUIT_PRICING.TRAIT_PRICES[rarity] || RECRUIT_PRICING.TRAIT_PRICES.common;
  }

  // Skills: first T1L1 is free, others cost 250 x tier x level
  const skills = recruit.skills || [];
  let firstFreeUsed = false;
  for (const skill of skills) {
    const tier = skill.tier || 1;
    const level = skill.level || 1;

    // First Tier 1, Level 1 skill is free
    if (!firstFreeUsed && tier === 1 && level === 1) {
      firstFreeUsed = true;
      continue;
    }

    price += RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * tier * level;
  }

  return price;
}

// ============================================================================
// Starter Skills
// ============================================================================

/**
 * Map of class to their default starter skill ID
 */
export const STARTER_SKILLS = {
  warrior: 'power_strike',
  wizard: 'fireball',
  monk: 'palm_strike',
  chemist: 'potion_toss'
};

/**
 * Get the default starter skill for a class
 * @param {string} guildClass - The class (warrior, wizard, monk, chemist)
 * @returns {string|null} Starter skill ID or null if class not found
 */
export function getStarterSkillId(guildClass) {
  return STARTER_SKILLS[guildClass] || null;
}

// ============================================================================
// Skill Tier Classification
// ============================================================================

/**
 * Get tier 1-2 skills for a class (skills without requirements or with only tier-1 requirements at level 1)
 *
 * Tier 1 skills: No prerequisites (skill.requires is undefined/null)
 * Tier 2 skills: Require only tier 1 skills at level 1 or less
 *
 * @param {string} guildClass - The class to get skills for (warrior, wizard, monk, chemist)
 * @returns {Array<Object>} Array of skill objects with tier information ({ ...skill, tier: 1|2 })
 *
 * @example
 * const skills = getTier1And2Skills('warrior');
 * // Returns: [{ id: 'power_strike', tier: 1, ... }, { id: 'cleave', tier: 2, requires: {...}, ... }]
 */
export function getTier1And2Skills(guildClass) {
  const classTree = SKILL_TREES[guildClass];
  if (!classTree) return [];

  const skills = [];
  const tier1SkillIds = new Set();

  // First pass: collect tier 1 skills (no requirements)
  for (const branch of classTree.branches) {
    for (const skill of branch.skills) {
      if (skill.type === 'active' && !skill.requires) {
        tier1SkillIds.add(skill.id);
        skills.push({ ...skill, tier: 1 });
      }
    }
  }

  // Second pass: collect tier 2 skills (require only tier 1 skills AT LEVEL 1)
  // Recruits get skills at level 1, so we can only include skills whose
  // prerequisites can be satisfied at level 1
  for (const branch of classTree.branches) {
    for (const skill of branch.skills) {
      if (skill.type === 'active' && skill.requires) {
        // Check if all requirements are tier 1 skills AND require level 1 or less
        const requiresOnlyTier1AtLevel1 = Object.entries(skill.requires).every(
          ([reqId, reqLevel]) => tier1SkillIds.has(reqId) && reqLevel <= 1
        );
        if (requiresOnlyTier1AtLevel1) {
          skills.push({ ...skill, tier: 2 });
        }
      }
    }
  }

  return skills;
}
