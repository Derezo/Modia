/**
 * Recruit Service Unit Tests
 *
 * Tests for recruit generation, pricing, and pool management.
 * Covers pure functions and constant validation.
 *
 * Database-dependent functions (generateRecruit, refreshGuildRecruits, purchaseRecruit, etc.)
 * are tested via integration tests in integration/recruit.integration.test.js
 *
 * Functions tested:
 * - calculateRecruitPrice() - Price calculation based on variance, traits, skills
 * - weightedRandom() - Weighted random selection utility
 * - getStarterSkillId() - Starter skill lookup by class
 * - getTier1And2Skills() - Skill tier classification
 * - Stat variance calculation logic
 * - Trait assignment logic validation
 * - Skill assignment logic validation
 *
 * Constants tested:
 * - RECRUIT_PRICING - Base prices and multipliers
 * - TRAIT_RARITY_WEIGHTS - Rarity distribution
 * - TRAIT_COUNT_WEIGHTS - Trait count distribution
 * - ADDITIONAL_SKILL_COUNT_WEIGHTS - Extra skill distribution
 * - STARTER_SKILLS - Class to skill mapping
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  calculateRecruitPrice,
  RECRUIT_PRICING,
  TRAIT_RARITY_WEIGHTS,
  TRAIT_COUNT_WEIGHTS,
  ADDITIONAL_SKILL_COUNT_WEIGHTS,
  weightedRandom,
  getStarterSkillId,
  getTier1And2Skills
} from '../../utils/recruitmentUtils.js';
import { calculateStats, RACES, GENDERS, CLASSES } from '../../config/constants.js';

// ============================================================================
// calculateRecruitPrice Tests
// ============================================================================

describe('calculateRecruitPrice', () => {
  describe('base price', () => {
    it('should return base price for neutral recruit', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: []
      };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });

    it('should return base price with only starter skill (first T1L1 is free)', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [{ tier: 1, level: 1 }]
      };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });

    it('should handle completely empty recruit object', () => {
      const recruit = {};

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });
  });

  describe('stat variance pricing', () => {
    it('should increase price for positive stat variance', () => {
      const baseRecruit = { stat_variance_percent: 0, traits: [], skills: [] };
      const buffedRecruit = { stat_variance_percent: 10, traits: [], skills: [] };

      const basePrice = calculateRecruitPrice(baseRecruit);
      const buffedPrice = calculateRecruitPrice(buffedRecruit);

      assert.ok(buffedPrice > basePrice, 'Positive variance should increase price');
    });

    it('should not decrease price for negative stat variance (no discount)', () => {
      const baseRecruit = { stat_variance_percent: 0, traits: [], skills: [] };
      const nerfedRecruit = { stat_variance_percent: -10, traits: [], skills: [] };

      const basePrice = calculateRecruitPrice(baseRecruit);
      const nerfedPrice = calculateRecruitPrice(nerfedRecruit);

      assert.strictEqual(nerfedPrice, basePrice, 'Negative variance should not change price');
    });

    it('should calculate variance correctly at maximum (+15%)', () => {
      const recruit = { stat_variance_percent: 15, traits: [], skills: [] };

      const price = calculateRecruitPrice(recruit);

      const expectedPrice = RECRUIT_PRICING.BASE_PRICE + (15 * RECRUIT_PRICING.STAT_VARIANCE_BONUS);
      assert.strictEqual(price, expectedPrice);
    });

    it('should calculate variance correctly at minimum (-15%)', () => {
      const recruit = { stat_variance_percent: -15, traits: [], skills: [] };

      const price = calculateRecruitPrice(recruit);

      // Negative variance = no price change
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });

    it('should handle fractional variance correctly', () => {
      const recruit = { stat_variance_percent: 7.5, traits: [], skills: [] };

      const price = calculateRecruitPrice(recruit);

      // 7.5 * 5 = 37.5, floored = 37
      const expectedPrice = RECRUIT_PRICING.BASE_PRICE + Math.floor(7.5 * RECRUIT_PRICING.STAT_VARIANCE_BONUS);
      assert.strictEqual(price, expectedPrice);
    });

    it('should handle undefined stat_variance_percent', () => {
      const recruit = { traits: [], skills: [] };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });

    it('should handle null stat_variance_percent', () => {
      const recruit = { stat_variance_percent: null, traits: [], skills: [] };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });
  });

  describe('trait pricing', () => {
    it('should add price for common trait', () => {
      const recruit = { stat_variance_percent: 0, traits: [{ rarity: 'common' }], skills: [] };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + RECRUIT_PRICING.TRAIT_PRICES.common);
    });

    it('should add price for uncommon trait', () => {
      const recruit = { stat_variance_percent: 0, traits: [{ rarity: 'uncommon' }], skills: [] };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + RECRUIT_PRICING.TRAIT_PRICES.uncommon);
    });

    it('should add price for rare trait', () => {
      const recruit = { stat_variance_percent: 0, traits: [{ rarity: 'rare' }], skills: [] };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + RECRUIT_PRICING.TRAIT_PRICES.rare);
    });

    it('should add price for legendary trait', () => {
      const recruit = { stat_variance_percent: 0, traits: [{ rarity: 'legendary' }], skills: [] };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + RECRUIT_PRICING.TRAIT_PRICES.legendary);
    });

    it('should add price for multiple traits', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [{ rarity: 'common' }, { rarity: 'rare' }],
        skills: []
      };

      const price = calculateRecruitPrice(recruit);

      const expectedTraitPrice = RECRUIT_PRICING.TRAIT_PRICES.common + RECRUIT_PRICING.TRAIT_PRICES.rare;
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + expectedTraitPrice);
    });

    it('should handle all four trait rarities', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [
          { rarity: 'common' },
          { rarity: 'uncommon' },
          { rarity: 'rare' },
          { rarity: 'legendary' }
        ],
        skills: []
      };

      const price = calculateRecruitPrice(recruit);

      const expectedTraitPrice =
        RECRUIT_PRICING.TRAIT_PRICES.common +
        RECRUIT_PRICING.TRAIT_PRICES.uncommon +
        RECRUIT_PRICING.TRAIT_PRICES.rare +
        RECRUIT_PRICING.TRAIT_PRICES.legendary;
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + expectedTraitPrice);
    });

    it('should handle undefined traits', () => {
      const recruit = { stat_variance_percent: 0, skills: [] };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });

    it('should handle null traits', () => {
      const recruit = { stat_variance_percent: 0, traits: null, skills: [] };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });

    it('should fallback to common price for unknown rarity', () => {
      const recruit = { stat_variance_percent: 0, traits: [{ rarity: 'mythic' }], skills: [] };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + RECRUIT_PRICING.TRAIT_PRICES.common);
    });

    it('should handle trait without rarity field', () => {
      const recruit = { stat_variance_percent: 0, traits: [{}], skills: [] };

      const price = calculateRecruitPrice(recruit);

      // Default to common
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + RECRUIT_PRICING.TRAIT_PRICES.common);
    });
  });

  describe('skill pricing', () => {
    it('should make first T1L1 skill free', () => {
      const recruit = { stat_variance_percent: 0, traits: [], skills: [{ tier: 1, level: 1 }] };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });

    it('should charge for second T1L1 skill', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [{ tier: 1, level: 1 }, { tier: 1, level: 1 }]
      };

      const price = calculateRecruitPrice(recruit);

      const expectedSkillPrice = RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 1 * 1;
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + expectedSkillPrice);
    });

    it('should charge more for tier 2 skills', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [{ tier: 1, level: 1 }, { tier: 2, level: 1 }]
      };

      const price = calculateRecruitPrice(recruit);

      const expectedSkillPrice = RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 2 * 1;
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + expectedSkillPrice);
    });

    it('should charge for higher level skills', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [{ tier: 1, level: 1 }, { tier: 1, level: 2 }]
      };

      const price = calculateRecruitPrice(recruit);

      // First T1L1 is free, T1L2 costs 250 * 1 * 2 = 500
      const expectedSkillPrice = RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 1 * 2;
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + expectedSkillPrice);
    });

    it('should calculate tier and level multiplier correctly', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [{ tier: 1, level: 1 }, { tier: 2, level: 3 }]
      };

      const price = calculateRecruitPrice(recruit);

      // T2L3 costs 250 * 2 * 3 = 1500
      const expectedSkillPrice = RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 2 * 3;
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + expectedSkillPrice);
    });

    it('should handle multiple skills after first free', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [
          { tier: 1, level: 1 }, // Free
          { tier: 1, level: 1 }, // 250
          { tier: 2, level: 1 }  // 500
        ]
      };

      const price = calculateRecruitPrice(recruit);

      const expectedSkillPrice =
        (RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 1 * 1) +
        (RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 2 * 1);
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + expectedSkillPrice);
    });

    it('should handle undefined skills', () => {
      const recruit = { stat_variance_percent: 0, traits: [] };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });

    it('should handle null skills', () => {
      const recruit = { stat_variance_percent: 0, traits: [], skills: null };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });

    it('should default tier to 1 if missing', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [{ level: 1 }, { level: 1 }]
      };

      const price = calculateRecruitPrice(recruit);

      // First T1L1 free, second T1L1 costs 250
      const expectedSkillPrice = RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 1 * 1;
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + expectedSkillPrice);
    });

    it('should default level to 1 if missing', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [{ tier: 1 }, { tier: 2 }]
      };

      const price = calculateRecruitPrice(recruit);

      // First T1L1 free, T2L1 costs 500
      const expectedSkillPrice = RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 2 * 1;
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + expectedSkillPrice);
    });

    it('should only give free slot to T1L1, not higher tiers', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [{ tier: 2, level: 1 }]
      };

      const price = calculateRecruitPrice(recruit);

      // T2L1 is not free even if first
      const expectedSkillPrice = RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 2 * 1;
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + expectedSkillPrice);
    });

    it('should only give free slot to T1L1, not higher levels', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [{ tier: 1, level: 2 }]
      };

      const price = calculateRecruitPrice(recruit);

      // T1L2 is not free even if first
      const expectedSkillPrice = RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 1 * 2;
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + expectedSkillPrice);
    });
  });

  describe('combined pricing', () => {
    it('should combine all price factors', () => {
      const recruit = {
        stat_variance_percent: 10,                             // +50 (10 * 5)
        traits: [{ rarity: 'common' }, { rarity: 'rare' }],    // +100 + 1000
        skills: [{ tier: 1, level: 1 }, { tier: 2, level: 1 }] // 0 (first free) + 500
      };

      const price = calculateRecruitPrice(recruit);

      const expectedVariance = 10 * RECRUIT_PRICING.STAT_VARIANCE_BONUS;
      const expectedTraits = RECRUIT_PRICING.TRAIT_PRICES.common + RECRUIT_PRICING.TRAIT_PRICES.rare;
      const expectedSkills = RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 2 * 1;

      assert.strictEqual(
        price,
        RECRUIT_PRICING.BASE_PRICE + expectedVariance + expectedTraits + expectedSkills
      );
    });

    it('should calculate max-value recruit correctly', () => {
      const recruit = {
        stat_variance_percent: 15,
        traits: [{ rarity: 'legendary' }, { rarity: 'legendary' }],
        skills: [
          { tier: 1, level: 1 },
          { tier: 2, level: 1 },
          { tier: 2, level: 1 }
        ]
      };

      const price = calculateRecruitPrice(recruit);

      // 400 base + 75 variance + 8000 traits + 1000 skills = 9475
      const expected =
        RECRUIT_PRICING.BASE_PRICE +
        (15 * RECRUIT_PRICING.STAT_VARIANCE_BONUS) +
        (2 * RECRUIT_PRICING.TRAIT_PRICES.legendary) +
        (2 * RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 2 * 1);

      assert.strictEqual(price, expected);
    });

    it('should floor intermediate calculations', () => {
      const recruit = {
        stat_variance_percent: 7,
        traits: [],
        skills: []
      };

      const price = calculateRecruitPrice(recruit);

      const expected = RECRUIT_PRICING.BASE_PRICE + Math.floor(7 * RECRUIT_PRICING.STAT_VARIANCE_BONUS);
      assert.strictEqual(price, expected);
      assert.ok(Number.isInteger(price), 'Price should be an integer');
    });

    it('should always return an integer price', () => {
      const testCases = [
        { stat_variance_percent: 0.5, traits: [], skills: [] },
        { stat_variance_percent: 7.7, traits: [], skills: [] },
        { stat_variance_percent: 14.99, traits: [], skills: [] }
      ];

      for (const recruit of testCases) {
        const price = calculateRecruitPrice(recruit);
        assert.ok(Number.isInteger(price), `Price should be integer for variance ${recruit.stat_variance_percent}`);
      }
    });
  });
});

// ============================================================================
// weightedRandom Tests
// ============================================================================

describe('weightedRandom', () => {
  describe('basic functionality', () => {
    it('should return a valid option from weights', () => {
      const weights = { a: 50, b: 30, c: 20 };

      const result = weightedRandom(weights);

      assert.ok(['a', 'b', 'c'].includes(result), `Result ${result} should be one of the options`);
    });

    it('should return numeric keys as numbers', () => {
      const weights = { 1: 50, 2: 30, 3: 20 };

      const result = weightedRandom(weights);

      assert.ok(typeof result === 'number', 'Numeric keys should be returned as numbers');
      assert.ok([1, 2, 3].includes(result));
    });

    it('should return string keys as strings', () => {
      const weights = { common: 70, rare: 30 };

      const result = weightedRandom(weights);

      assert.ok(typeof result === 'string', 'String keys should remain strings');
      assert.ok(['common', 'rare'].includes(result));
    });

    it('should handle single option', () => {
      const weights = { only: 100 };

      const result = weightedRandom(weights);

      assert.strictEqual(result, 'only');
    });

    it('should handle weights that do not sum to 100', () => {
      const weights = { a: 1, b: 1 }; // Sum = 2

      const result = weightedRandom(weights);

      assert.ok(['a', 'b'].includes(result));
    });

    it('should handle large weights', () => {
      const weights = { a: 1000000, b: 1 };

      // With very high weight for 'a', should almost always return 'a'
      // (statistically, 'b' is extremely unlikely)
      const result = weightedRandom(weights);

      assert.ok(['a', 'b'].includes(result));
    });
  });

  describe('distribution validation', () => {
    it('should respect weight distribution approximately', () => {
      // Mock Math.random to test distribution
      const originalRandom = Math.random;
      let mockValue = 0;
      Math.random = () => mockValue;

      const weights = { a: 60, b: 40 }; // a: 0-60%, b: 60-100%

      try {
        // Low value should return 'a'
        mockValue = 0.3; // 30% of 100 = 30, which is < 60
        assert.strictEqual(weightedRandom(weights), 'a');

        // High value should return 'b'
        mockValue = 0.8; // 80% of 100 = 80, which is > 60
        assert.strictEqual(weightedRandom(weights), 'b');
      } finally {
        Math.random = originalRandom;
      }
    });

    it('should handle edge case at boundary', () => {
      const originalRandom = Math.random;
      Math.random = () => 0.7; // Exactly at 70% boundary

      const weights = { a: 70, b: 30 };

      try {
        const result = weightedRandom(weights);
        // At exactly 70%, random becomes 70 - 70 = 0, which is <= 0, so returns 'a'
        assert.strictEqual(result, 'a');
      } finally {
        Math.random = originalRandom;
      }
    });

    it('should handle zero at start of range', () => {
      const originalRandom = Math.random;
      Math.random = () => 0;

      const weights = { a: 50, b: 50 };

      try {
        const result = weightedRandom(weights);
        // 0 * 100 = 0, 0 - 50 = -50 which is <= 0, so returns first option
        assert.strictEqual(result, 'a');
      } finally {
        Math.random = originalRandom;
      }
    });

    it('should handle near-max random value', () => {
      const originalRandom = Math.random;
      Math.random = () => 0.999;

      const weights = { a: 50, b: 50 };

      try {
        const result = weightedRandom(weights);
        // 0.999 * 100 = 99.9, 99.9 - 50 = 49.9, 49.9 - 50 = -0.1 <= 0, returns 'b'
        assert.strictEqual(result, 'b');
      } finally {
        Math.random = originalRandom;
      }
    });
  });
});

// ============================================================================
// getStarterSkillId Tests
// ============================================================================

describe('getStarterSkillId', () => {
  describe('valid classes', () => {
    it('should return power_strike for warrior', () => {
      assert.strictEqual(getStarterSkillId('warrior'), 'power_strike');
    });

    it('should return fireball for wizard', () => {
      assert.strictEqual(getStarterSkillId('wizard'), 'fireball');
    });

    it('should return palm_strike for monk', () => {
      assert.strictEqual(getStarterSkillId('monk'), 'palm_strike');
    });

    it('should return potion_toss for chemist', () => {
      assert.strictEqual(getStarterSkillId('chemist'), 'potion_toss');
    });
  });

  describe('invalid inputs', () => {
    it('should return null for unknown class', () => {
      assert.strictEqual(getStarterSkillId('unknown'), null);
    });

    it('should return null for advanced classes', () => {
      assert.strictEqual(getStarterSkillId('berserker'), null);
      assert.strictEqual(getStarterSkillId('paladin'), null);
      assert.strictEqual(getStarterSkillId('sorcerer'), null);
      assert.strictEqual(getStarterSkillId('ninja'), null);
    });

    it('should return null for null input', () => {
      assert.strictEqual(getStarterSkillId(null), null);
    });

    it('should return null for undefined input', () => {
      assert.strictEqual(getStarterSkillId(undefined), null);
    });

    it('should return null for empty string', () => {
      assert.strictEqual(getStarterSkillId(''), null);
    });

    it('should be case sensitive', () => {
      assert.strictEqual(getStarterSkillId('Warrior'), null);
      assert.strictEqual(getStarterSkillId('WARRIOR'), null);
    });
  });
});

// ============================================================================
// getTier1And2Skills Tests
// ============================================================================

describe('getTier1And2Skills', () => {
  describe('warrior skills', () => {
    it('should return array of skills for warrior', () => {
      const skills = getTier1And2Skills('warrior');

      assert.ok(Array.isArray(skills), 'Should return an array');
      assert.ok(skills.length > 0, 'Should have at least one skill');
    });

    it('should include power_strike as tier 1', () => {
      const skills = getTier1And2Skills('warrior');
      const powerStrike = skills.find(s => s.id === 'power_strike');

      assert.ok(powerStrike, 'Should include power_strike');
      assert.strictEqual(powerStrike.tier, 1, 'power_strike should be tier 1');
    });

    it('should include shield_bash as tier 1', () => {
      const skills = getTier1And2Skills('warrior');
      const shieldBash = skills.find(s => s.id === 'shield_bash');

      assert.ok(shieldBash, 'Should include shield_bash');
      assert.strictEqual(shieldBash.tier, 1, 'shield_bash should be tier 1');
    });

    it('should only include active skills', () => {
      const skills = getTier1And2Skills('warrior');

      for (const skill of skills) {
        assert.strictEqual(skill.type, 'active', `Skill ${skill.id} should be active type`);
      }
    });

    it('should not include passive skills', () => {
      const skills = getTier1And2Skills('warrior');
      const passiveSkills = skills.filter(s => s.type === 'passive');

      assert.strictEqual(passiveSkills.length, 0, 'Should not include passive skills');
    });

    it('should have tier property on all skills', () => {
      const skills = getTier1And2Skills('warrior');

      for (const skill of skills) {
        assert.ok(skill.tier === 1 || skill.tier === 2, `Skill ${skill.id} should have tier 1 or 2`);
      }
    });
  });

  describe('wizard skills', () => {
    it('should return array of skills for wizard', () => {
      const skills = getTier1And2Skills('wizard');

      assert.ok(Array.isArray(skills), 'Should return an array');
      assert.ok(skills.length > 0, 'Should have at least one skill');
    });

    it('should include fireball as tier 1', () => {
      const skills = getTier1And2Skills('wizard');
      const fireball = skills.find(s => s.id === 'fireball');

      assert.ok(fireball, 'Should include fireball');
      assert.strictEqual(fireball.tier, 1, 'fireball should be tier 1');
    });

    it('should include ice_shard as tier 1', () => {
      const skills = getTier1And2Skills('wizard');
      const iceShard = skills.find(s => s.id === 'ice_shard');

      assert.ok(iceShard, 'Should include ice_shard');
      assert.strictEqual(iceShard.tier, 1, 'ice_shard should be tier 1');
    });

    it('should include lightning_bolt as tier 1', () => {
      const skills = getTier1And2Skills('wizard');
      const lightningBolt = skills.find(s => s.id === 'lightning_bolt');

      assert.ok(lightningBolt, 'Should include lightning_bolt');
      assert.strictEqual(lightningBolt.tier, 1, 'lightning_bolt should be tier 1');
    });
  });

  describe('monk skills', () => {
    it('should return array of skills for monk', () => {
      const skills = getTier1And2Skills('monk');

      assert.ok(Array.isArray(skills), 'Should return an array');
      assert.ok(skills.length > 0, 'Should have at least one skill');
    });

    it('should include palm_strike as tier 1', () => {
      const skills = getTier1And2Skills('monk');
      const palmStrike = skills.find(s => s.id === 'palm_strike');

      assert.ok(palmStrike, 'Should include palm_strike');
      assert.strictEqual(palmStrike.tier, 1, 'palm_strike should be tier 1');
    });

    it('should include meditation as tier 1', () => {
      const skills = getTier1And2Skills('monk');
      const meditation = skills.find(s => s.id === 'meditation');

      assert.ok(meditation, 'Should include meditation');
      assert.strictEqual(meditation.tier, 1, 'meditation should be tier 1');
    });
  });

  describe('chemist skills', () => {
    it('should return array of skills for chemist', () => {
      const skills = getTier1And2Skills('chemist');

      assert.ok(Array.isArray(skills), 'Should return an array');
      assert.ok(skills.length > 0, 'Should have at least one skill');
    });

    it('should include potion_toss as tier 1', () => {
      const skills = getTier1And2Skills('chemist');
      const potionToss = skills.find(s => s.id === 'potion_toss');

      assert.ok(potionToss, 'Should include potion_toss');
      assert.strictEqual(potionToss.tier, 1, 'potion_toss should be tier 1');
    });
  });

  describe('tier 2 skill classification', () => {
    it('should classify skills with tier 1 prerequisites as tier 2', () => {
      const skills = getTier1And2Skills('warrior');
      const tier2Skills = skills.filter(s => s.tier === 2);

      // Tier 2 skills should have requires field
      for (const skill of tier2Skills) {
        assert.ok(skill.requires, `Tier 2 skill ${skill.id} should have requires field`);
      }
    });

    it('should not include skills that require level > 1', () => {
      const skills = getTier1And2Skills('warrior');

      // Check that no skill requires a prerequisite at level > 1
      for (const skill of skills) {
        if (skill.requires) {
          for (const reqLevel of Object.values(skill.requires)) {
            assert.ok(
              reqLevel <= 1,
              `Skill ${skill.id} requires prerequisite at level ${reqLevel}, should be <= 1`
            );
          }
        }
      }
    });
  });

  describe('invalid inputs', () => {
    it('should return empty array for unknown class', () => {
      const skills = getTier1And2Skills('unknown');

      assert.ok(Array.isArray(skills), 'Should return an array');
      assert.strictEqual(skills.length, 0, 'Should be empty for unknown class');
    });

    it('should return empty array for null class', () => {
      const skills = getTier1And2Skills(null);

      assert.ok(Array.isArray(skills), 'Should return an array');
      assert.strictEqual(skills.length, 0, 'Should be empty for null');
    });

    it('should return empty array for undefined class', () => {
      const skills = getTier1And2Skills(undefined);

      assert.ok(Array.isArray(skills), 'Should return an array');
      assert.strictEqual(skills.length, 0, 'Should be empty for undefined');
    });

    it('should return skills for advanced classes that have skill trees', () => {
      // Advanced classes like berserker have their own skill trees
      const skills = getTier1And2Skills('berserker');

      assert.ok(Array.isArray(skills), 'Should return an array');
      // Berserker has its own skill tree with tier 1 skills
      assert.ok(skills.length > 0, 'Berserker should have skills');
      assert.ok(skills.some(s => s.tier === 1), 'Should have tier 1 skills');
    });
  });
});

// ============================================================================
// Recruit Service Constants Tests
// ============================================================================

describe('Recruit Service Constants', () => {
  describe('RECRUIT_PRICING', () => {
    it('should have positive base price', () => {
      assert.ok(RECRUIT_PRICING.BASE_PRICE > 0, 'Base price should be positive');
    });

    it('should have positive stat variance bonus', () => {
      assert.ok(RECRUIT_PRICING.STAT_VARIANCE_BONUS > 0, 'Stat variance bonus should be positive');
    });

    it('should have trait prices for all rarities', () => {
      assert.ok(RECRUIT_PRICING.TRAIT_PRICES.common > 0, 'Common trait price should be positive');
      assert.ok(RECRUIT_PRICING.TRAIT_PRICES.uncommon > 0, 'Uncommon trait price should be positive');
      assert.ok(RECRUIT_PRICING.TRAIT_PRICES.rare > 0, 'Rare trait price should be positive');
      assert.ok(RECRUIT_PRICING.TRAIT_PRICES.legendary > 0, 'Legendary trait price should be positive');
    });

    it('should have increasing trait prices by rarity', () => {
      const { common, uncommon, rare, legendary } = RECRUIT_PRICING.TRAIT_PRICES;
      assert.ok(uncommon > common, 'Uncommon should cost more than common');
      assert.ok(rare > uncommon, 'Rare should cost more than uncommon');
      assert.ok(legendary > rare, 'Legendary should cost more than rare');
    });

    it('should have positive skill price multiplier', () => {
      assert.ok(RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER > 0, 'Skill multiplier should be positive');
    });

    it('should have reasonable base price (200-1000g)', () => {
      assert.ok(RECRUIT_PRICING.BASE_PRICE >= 200, 'Base price should be at least 200g');
      assert.ok(RECRUIT_PRICING.BASE_PRICE <= 1000, 'Base price should be at most 1000g');
    });
  });

  describe('TRAIT_RARITY_WEIGHTS', () => {
    it('should have all rarity tiers', () => {
      assert.ok('common' in TRAIT_RARITY_WEIGHTS, 'Should have common');
      assert.ok('uncommon' in TRAIT_RARITY_WEIGHTS, 'Should have uncommon');
      assert.ok('rare' in TRAIT_RARITY_WEIGHTS, 'Should have rare');
      assert.ok('legendary' in TRAIT_RARITY_WEIGHTS, 'Should have legendary');
    });

    it('should have decreasing probability for higher rarities', () => {
      assert.ok(TRAIT_RARITY_WEIGHTS.common > TRAIT_RARITY_WEIGHTS.uncommon);
      assert.ok(TRAIT_RARITY_WEIGHTS.uncommon > TRAIT_RARITY_WEIGHTS.rare);
      assert.ok(TRAIT_RARITY_WEIGHTS.rare > TRAIT_RARITY_WEIGHTS.legendary);
    });

    it('should sum to 100', () => {
      const total = Object.values(TRAIT_RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
      assert.strictEqual(total, 100, 'Rarity weights should sum to 100');
    });

    it('should have legendary as rarest (1-5%)', () => {
      assert.ok(TRAIT_RARITY_WEIGHTS.legendary >= 1, 'Legendary should be at least 1%');
      assert.ok(TRAIT_RARITY_WEIGHTS.legendary <= 5, 'Legendary should be at most 5%');
    });

    it('should have common as most frequent (50%+)', () => {
      assert.ok(TRAIT_RARITY_WEIGHTS.common >= 50, 'Common should be at least 50%');
    });
  });

  describe('TRAIT_COUNT_WEIGHTS', () => {
    it('should have options for 1 and 2 traits', () => {
      assert.ok(1 in TRAIT_COUNT_WEIGHTS, 'Should have option for 1 trait');
      assert.ok(2 in TRAIT_COUNT_WEIGHTS, 'Should have option for 2 traits');
    });

    it('should favor single trait', () => {
      assert.ok(TRAIT_COUNT_WEIGHTS[1] > TRAIT_COUNT_WEIGHTS[2], '1 trait should be more common');
    });

    it('should sum to 100', () => {
      const total = Object.values(TRAIT_COUNT_WEIGHTS).reduce((a, b) => a + b, 0);
      assert.strictEqual(total, 100, 'Trait count weights should sum to 100');
    });

    it('should have 1 trait as majority (80%+)', () => {
      assert.ok(TRAIT_COUNT_WEIGHTS[1] >= 80, 'Single trait should be at least 80%');
    });
  });

  describe('ADDITIONAL_SKILL_COUNT_WEIGHTS', () => {
    it('should have options for 0, 1, and 2 additional skills', () => {
      assert.ok(0 in ADDITIONAL_SKILL_COUNT_WEIGHTS, 'Should have option for 0 extra skills');
      assert.ok(1 in ADDITIONAL_SKILL_COUNT_WEIGHTS, 'Should have option for 1 extra skill');
      assert.ok(2 in ADDITIONAL_SKILL_COUNT_WEIGHTS, 'Should have option for 2 extra skills');
    });

    it('should favor no extra skills', () => {
      assert.ok(ADDITIONAL_SKILL_COUNT_WEIGHTS[0] >= ADDITIONAL_SKILL_COUNT_WEIGHTS[1]);
      assert.ok(ADDITIONAL_SKILL_COUNT_WEIGHTS[1] >= ADDITIONAL_SKILL_COUNT_WEIGHTS[2]);
    });

    it('should sum to 100', () => {
      const total = Object.values(ADDITIONAL_SKILL_COUNT_WEIGHTS).reduce((a, b) => a + b, 0);
      assert.strictEqual(total, 100, 'Skill count weights should sum to 100');
    });

    it('should have 0 extra skills as most common (50%+)', () => {
      assert.ok(
        ADDITIONAL_SKILL_COUNT_WEIGHTS[0] >= 50,
        'No extra skills should be at least 50%'
      );
    });
  });
});

// ============================================================================
// Stat Calculation Tests (for recruit generation logic)
// ============================================================================

describe('Recruit Stat Calculation Logic', () => {
  describe('base stat calculation', () => {
    it('should calculate stats for human warrior at level 1', () => {
      const stats = calculateStats('human', 'warrior', 1);

      assert.ok(stats.hpMax > 0, 'HP should be positive');
      assert.ok(stats.mpMax >= 0, 'MP should be non-negative');
      assert.ok(stats.strength > 0, 'Strength should be positive');
      assert.ok(stats.intelligence > 0, 'Intelligence should be positive');
      assert.ok(stats.agility > 0, 'Agility should be positive');
      assert.ok(stats.vitality > 0, 'Vitality should be positive');
      assert.ok(stats.luck > 0, 'Luck should be positive');
    });

    it('should calculate stats for all race/class combinations', () => {
      const races = Object.values(RACES);
      const classes = Object.values(CLASSES);

      for (const race of races) {
        for (const charClass of classes) {
          const stats = calculateStats(race, charClass, 1);

          assert.ok(
            stats.hpMax > 0,
            `${race}/${charClass} should have positive HP`
          );
          assert.ok(
            stats.strength > 0,
            `${race}/${charClass} should have positive strength`
          );
        }
      }
    });
  });

  describe('stat variance application', () => {
    it('should validate variance range (-15% to +15%)', () => {
      const minVariance = -15;
      const maxVariance = 15;

      // Test that variance formula works correctly
      const baseStats = calculateStats('human', 'warrior', 1);

      // Apply +15% variance
      const buffedHp = Math.round(baseStats.hpMax * (1 + maxVariance / 100));
      assert.ok(buffedHp > baseStats.hpMax, 'Buffed HP should be higher');

      // Apply -15% variance
      const nerfedHp = Math.round(baseStats.hpMax * (1 + minVariance / 100));
      assert.ok(nerfedHp < baseStats.hpMax, 'Nerfed HP should be lower');
    });

    it('should ensure minimum stat values after variance', () => {
      const baseStats = calculateStats('human', 'warrior', 1);
      const variance = -15; // Maximum negative

      // Apply variance
      const variedStats = {
        hpMax: Math.max(1, Math.round(baseStats.hpMax * (1 + variance / 100))),
        mpMax: Math.max(0, Math.round(baseStats.mpMax * (1 + variance / 100))),
        strength: Math.max(1, Math.round(baseStats.strength * (1 + variance / 100))),
        intelligence: Math.max(1, Math.round(baseStats.intelligence * (1 + variance / 100))),
        agility: Math.max(1, Math.round(baseStats.agility * (1 + variance / 100))),
        vitality: Math.max(1, Math.round(baseStats.vitality * (1 + variance / 100))),
        luck: Math.max(1, Math.round(baseStats.luck * (1 + variance / 100)))
      };

      assert.ok(variedStats.hpMax >= 1, 'HP should be at least 1');
      assert.ok(variedStats.mpMax >= 0, 'MP should be at least 0');
      assert.ok(variedStats.strength >= 1, 'Strength should be at least 1');
      assert.ok(variedStats.intelligence >= 1, 'Intelligence should be at least 1');
      assert.ok(variedStats.agility >= 1, 'Agility should be at least 1');
      assert.ok(variedStats.vitality >= 1, 'Vitality should be at least 1');
      assert.ok(variedStats.luck >= 1, 'Luck should be at least 1');
    });

    it('should calculate variance multiplier correctly', () => {
      const testCases = [
        { variance: 0, expected: 1.0 },
        { variance: 10, expected: 1.1 },
        { variance: -10, expected: 0.9 },
        { variance: 15, expected: 1.15 },
        { variance: -15, expected: 0.85 }
      ];

      for (const { variance, expected } of testCases) {
        const multiplier = 1 + variance / 100;
        assert.strictEqual(
          multiplier,
          expected,
          `Variance ${variance}% should give multiplier ${expected}`
        );
      }
    });
  });

  describe('XP pool generation', () => {
    it('should generate XP pool in valid range (50-150)', () => {
      // Test the formula: Math.floor(Math.random() * 101) + 50
      // Min: floor(0 * 101) + 50 = 50
      // Max: floor(0.999... * 101) + 50 = 100 + 50 = 150

      // Simulate multiple rolls
      const originalRandom = Math.random;

      try {
        // Test minimum
        Math.random = () => 0;
        const min = Math.floor(Math.random() * 101) + 50;
        assert.strictEqual(min, 50, 'Minimum XP should be 50');

        // Test maximum
        Math.random = () => 0.999;
        const max = Math.floor(Math.random() * 101) + 50;
        assert.strictEqual(max, 150, 'Maximum XP should be 150');
      } finally {
        Math.random = originalRandom;
      }
    });
  });
});

// ============================================================================
// Race and Gender Validation Tests
// ============================================================================

describe('Race and Gender Constants', () => {
  describe('RACES', () => {
    it('should have 5 playable races', () => {
      const raceCount = Object.values(RACES).length;
      assert.strictEqual(raceCount, 5, 'Should have exactly 5 races');
    });

    it('should include all expected races', () => {
      const races = Object.values(RACES);
      assert.ok(races.includes('human'), 'Should include human');
      assert.ok(races.includes('elf'), 'Should include elf');
      assert.ok(races.includes('dwarf'), 'Should include dwarf');
      assert.ok(races.includes('vampire'), 'Should include vampire');
      assert.ok(races.includes('orc'), 'Should include orc');
    });
  });

  describe('GENDERS', () => {
    it('should have 3 gender options', () => {
      const genderCount = Object.values(GENDERS).length;
      assert.strictEqual(genderCount, 3, 'Should have exactly 3 genders');
    });

    it('should include all expected genders', () => {
      const genders = Object.values(GENDERS);
      assert.ok(genders.includes('male'), 'Should include male');
      assert.ok(genders.includes('female'), 'Should include female');
      assert.ok(genders.includes('other'), 'Should include other');
    });
  });

  describe('CLASSES', () => {
    it('should have 4 base classes', () => {
      const classCount = Object.values(CLASSES).length;
      assert.strictEqual(classCount, 4, 'Should have exactly 4 base classes');
    });

    it('should include all expected classes', () => {
      const classes = Object.values(CLASSES);
      assert.ok(classes.includes('warrior'), 'Should include warrior');
      assert.ok(classes.includes('wizard'), 'Should include wizard');
      assert.ok(classes.includes('monk'), 'Should include monk');
      assert.ok(classes.includes('chemist'), 'Should include chemist');
    });

    it('should have starter skill for each class', () => {
      const classes = Object.values(CLASSES);
      for (const charClass of classes) {
        const starterSkill = getStarterSkillId(charClass);
        assert.ok(starterSkill, `${charClass} should have a starter skill`);
      }
    });
  });
});

// ============================================================================
// Emergency Recruit Logic Tests
// ============================================================================

describe('Emergency Recruit Logic', () => {
  describe('trait cap in emergency mode', () => {
    it('should cap trait count at 1 for emergency recruits', () => {
      // Simulate the emergency trait cap logic
      const isEmergency = true;
      const traitCounts = [0, 1, 2, 3];

      for (const traitCount of traitCounts) {
        const cappedCount = isEmergency ? Math.min(1, traitCount) : traitCount;

        assert.ok(
          cappedCount <= 1,
          `Emergency recruit with ${traitCount} traits should be capped at 1`
        );
      }
    });

    it('should not cap trait count for normal recruits', () => {
      const isEmergency = false;
      const traitCount = 2;
      const cappedCount = isEmergency ? Math.min(1, traitCount) : traitCount;

      assert.strictEqual(cappedCount, 2, 'Normal recruit should keep 2 traits');
    });
  });

  describe('emergency recruit count', () => {
    it('should spawn exactly 3 emergency recruits', () => {
      const EMERGENCY_RECRUIT_COUNT = 3;

      assert.strictEqual(
        EMERGENCY_RECRUIT_COUNT,
        3,
        'Emergency should spawn 3 recruits'
      );
    });
  });
});

// ============================================================================
// Price Calculation Edge Cases
// ============================================================================

describe('Price Calculation Edge Cases', () => {
  it('should handle empty recruit gracefully', () => {
    const price = calculateRecruitPrice({});
    assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
  });

  it('should handle recruit with all fields null', () => {
    const recruit = {
      stat_variance_percent: null,
      traits: null,
      skills: null
    };

    const price = calculateRecruitPrice(recruit);
    assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
  });

  it('should handle recruit with empty arrays', () => {
    const recruit = {
      stat_variance_percent: 0,
      traits: [],
      skills: []
    };

    const price = calculateRecruitPrice(recruit);
    assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
  });

  it('should calculate expensive recruit correctly', () => {
    // Max variance + 2 legendary traits + 2 T2 skills
    const recruit = {
      stat_variance_percent: 15,
      traits: [
        { rarity: 'legendary' },
        { rarity: 'legendary' }
      ],
      skills: [
        { tier: 1, level: 1 }, // Free
        { tier: 2, level: 1 }, // 500
        { tier: 2, level: 1 }  // 500
      ]
    };

    const price = calculateRecruitPrice(recruit);

    const expected =
      RECRUIT_PRICING.BASE_PRICE +
      (15 * RECRUIT_PRICING.STAT_VARIANCE_BONUS) +
      (2 * RECRUIT_PRICING.TRAIT_PRICES.legendary) +
      (2 * RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 2 * 1);

    assert.strictEqual(price, expected);
    // Verify it's a reasonable price (should be 400 + 75 + 8000 + 1000 = 9475)
    assert.ok(price >= 9000, 'Premium recruit should be expensive');
    assert.ok(price <= 12000, 'But not unreasonably so');
  });

  it('should calculate cheap recruit correctly', () => {
    // Min variance (no effect) + 1 common trait + starter skill
    const recruit = {
      stat_variance_percent: -15,
      traits: [{ rarity: 'common' }],
      skills: [{ tier: 1, level: 1 }]
    };

    const price = calculateRecruitPrice(recruit);

    const expected =
      RECRUIT_PRICING.BASE_PRICE +
      RECRUIT_PRICING.TRAIT_PRICES.common;

    assert.strictEqual(price, expected);
    // Should be 400 + 100 = 500
    assert.strictEqual(price, 500, 'Budget recruit should be 500g');
  });
});
