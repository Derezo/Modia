/**
 * Recruit Service Unit Tests
 * Tests for recruit price calculation and constants
 *
 * Most functions require database access and are tested via integration tests.
 * Only testing the pure function calculateRecruitPrice and constants.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateRecruitPrice,
  RECRUIT_PRICING,
  TRAIT_RARITY_WEIGHTS,
  TRAIT_COUNT_WEIGHTS,
  ADDITIONAL_SKILL_COUNT_WEIGHTS,
  getStarterSkillId
} from '../../services/recruitService.js';

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
  });

  describe('stat variance', () => {
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

      // New pricing: no discount for below-average stats
      assert.strictEqual(nerfedPrice, basePrice, 'Negative variance should not change price');
    });

    it('should calculate variance correctly (+15%)', () => {
      const recruit = { stat_variance_percent: 15, traits: [], skills: [] };

      const price = calculateRecruitPrice(recruit);

      // BASE_PRICE + (15 * STAT_VARIANCE_BONUS) = 400 + (15 * 5) = 475
      const expectedPrice = RECRUIT_PRICING.BASE_PRICE + (15 * RECRUIT_PRICING.STAT_VARIANCE_BONUS);
      assert.strictEqual(price, expectedPrice);
    });

    it('should handle undefined stat_variance_percent', () => {
      const recruit = { traits: [], skills: [] };

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

    it('should handle undefined traits', () => {
      const recruit = { stat_variance_percent: 0, skills: [] };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
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

      // First free, second costs 250 * 1 * 1 = 250
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

      // First T1L1 free, T2L1 costs 250 * 2 * 1 = 500
      const expectedSkillPrice = RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 2 * 1;
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + expectedSkillPrice);
    });

    it('should handle undefined skills', () => {
      const recruit = { stat_variance_percent: 0, traits: [] };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
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

      // Base: 400
      // Variance: 10 * 5 = 50
      // Traits: 100 + 1000 = 1100
      // Skills: 0 + 500 = 500
      // Total: 400 + 50 + 1100 + 500 = 2050
      const expectedVariance = 10 * RECRUIT_PRICING.STAT_VARIANCE_BONUS;
      const expectedTraits = RECRUIT_PRICING.TRAIT_PRICES.common + RECRUIT_PRICING.TRAIT_PRICES.rare;
      const expectedSkills = RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 2 * 1; // Second skill (T2L1)

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + expectedVariance + expectedTraits + expectedSkills);
    });

    it('should floor intermediate calculations', () => {
      const recruit = {
        stat_variance_percent: 7,  // 7 * 5 = 35 (integer)
        traits: [],
        skills: []
      };

      const price = calculateRecruitPrice(recruit);

      // BASE + (7 * 5) = 400 + 35 = 435
      const expected = RECRUIT_PRICING.BASE_PRICE + Math.floor(7 * RECRUIT_PRICING.STAT_VARIANCE_BONUS);
      assert.strictEqual(price, expected);
      assert.ok(Number.isInteger(price), 'Price should be an integer');
    });
  });
});

describe('Recruit Service Constants', () => {
  describe('RECRUIT_PRICING', () => {
    it('should have base price', () => {
      assert.ok(RECRUIT_PRICING.BASE_PRICE > 0);
    });

    it('should have stat variance bonus', () => {
      assert.ok(RECRUIT_PRICING.STAT_VARIANCE_BONUS > 0);
    });

    it('should have trait prices for all rarities', () => {
      assert.ok(RECRUIT_PRICING.TRAIT_PRICES.common > 0);
      assert.ok(RECRUIT_PRICING.TRAIT_PRICES.uncommon > 0);
      assert.ok(RECRUIT_PRICING.TRAIT_PRICES.rare > 0);
      assert.ok(RECRUIT_PRICING.TRAIT_PRICES.legendary > 0);
    });

    it('should have increasing trait prices by rarity', () => {
      const { common, uncommon, rare, legendary } = RECRUIT_PRICING.TRAIT_PRICES;
      assert.ok(uncommon > common, 'Uncommon should cost more than common');
      assert.ok(rare > uncommon, 'Rare should cost more than uncommon');
      assert.ok(legendary > rare, 'Legendary should cost more than rare');
    });

    it('should have skill price multiplier', () => {
      assert.ok(RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER > 0);
    });
  });

  describe('TRAIT_RARITY_WEIGHTS', () => {
    it('should have all rarity tiers', () => {
      assert.ok('common' in TRAIT_RARITY_WEIGHTS);
      assert.ok('uncommon' in TRAIT_RARITY_WEIGHTS);
      assert.ok('rare' in TRAIT_RARITY_WEIGHTS);
      assert.ok('legendary' in TRAIT_RARITY_WEIGHTS);
    });

    it('should have decreasing probability for higher rarities', () => {
      assert.ok(TRAIT_RARITY_WEIGHTS.common > TRAIT_RARITY_WEIGHTS.uncommon);
      assert.ok(TRAIT_RARITY_WEIGHTS.uncommon > TRAIT_RARITY_WEIGHTS.rare);
      assert.ok(TRAIT_RARITY_WEIGHTS.rare > TRAIT_RARITY_WEIGHTS.legendary);
    });

    it('should sum to 100', () => {
      const total = Object.values(TRAIT_RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
      assert.strictEqual(total, 100);
    });
  });

  describe('TRAIT_COUNT_WEIGHTS', () => {
    it('should have options for 1 and 2 traits', () => {
      assert.ok(1 in TRAIT_COUNT_WEIGHTS);
      assert.ok(2 in TRAIT_COUNT_WEIGHTS);
    });

    it('should favor single trait', () => {
      assert.ok(TRAIT_COUNT_WEIGHTS[1] > TRAIT_COUNT_WEIGHTS[2]);
    });

    it('should sum to 100', () => {
      const total = Object.values(TRAIT_COUNT_WEIGHTS).reduce((a, b) => a + b, 0);
      assert.strictEqual(total, 100);
    });
  });

  describe('ADDITIONAL_SKILL_COUNT_WEIGHTS', () => {
    it('should have options for 0, 1, and 2 additional skills', () => {
      assert.ok(0 in ADDITIONAL_SKILL_COUNT_WEIGHTS);
      assert.ok(1 in ADDITIONAL_SKILL_COUNT_WEIGHTS);
      assert.ok(2 in ADDITIONAL_SKILL_COUNT_WEIGHTS);
    });

    it('should favor no extra skills', () => {
      assert.ok(ADDITIONAL_SKILL_COUNT_WEIGHTS[0] >= ADDITIONAL_SKILL_COUNT_WEIGHTS[1]);
      assert.ok(ADDITIONAL_SKILL_COUNT_WEIGHTS[1] >= ADDITIONAL_SKILL_COUNT_WEIGHTS[2]);
    });

    it('should sum to 100', () => {
      const total = Object.values(ADDITIONAL_SKILL_COUNT_WEIGHTS).reduce((a, b) => a + b, 0);
      assert.strictEqual(total, 100);
    });
  });

  describe('getStarterSkillId', () => {
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

    it('should return null for unknown class', () => {
      assert.strictEqual(getStarterSkillId('unknown'), null);
    });
  });
});
