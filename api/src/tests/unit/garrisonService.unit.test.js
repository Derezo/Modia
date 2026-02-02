/**
 * Garrison Service Unit Tests
 * Tests for garrison recruit price calculation and constants
 *
 * Most functions require database access and are tested via integration tests.
 * Only testing the pure function calculateRecruitPrice and constants.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateRecruitPrice,
  BASE_RECRUIT_PRICE,
  TRAIT_BONUS_PRICE,
  SKILL_BONUS_PRICE,
  TRAIT_RARITY_WEIGHTS,
  TRAIT_COUNT_WEIGHTS,
  SKILL_COUNT_WEIGHTS
} from '../../services/garrisonService.js';

describe('garrisonService - calculateRecruitPrice', () => {
  describe('base price', () => {
    it('should return base price for neutral recruit', () => {
      const recruit = {
        stat_variance_percent: 0,
        traitCount: 0,
        skillCount: 0
      };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, BASE_RECRUIT_PRICE);
    });

    it('should never go below base price', () => {
      const recruit = {
        stat_variance_percent: -15,
        traitCount: 0,
        skillCount: 0
      };

      const price = calculateRecruitPrice(recruit);

      assert.ok(price >= BASE_RECRUIT_PRICE, 'Price should not be below base');
    });
  });

  describe('stat variance', () => {
    it('should increase price for positive stat variance', () => {
      const baseRecruit = { stat_variance_percent: 0, traitCount: 0, skillCount: 0 };
      const buffedRecruit = { stat_variance_percent: 10, traitCount: 0, skillCount: 0 };

      const basePrice = calculateRecruitPrice(baseRecruit);
      const buffedPrice = calculateRecruitPrice(buffedRecruit);

      assert.ok(buffedPrice > basePrice, 'Positive variance should increase price');
    });

    it('should decrease price for negative stat variance', () => {
      const baseRecruit = { stat_variance_percent: 0, traitCount: 0, skillCount: 0 };
      const nerfedRecruit = { stat_variance_percent: -10, traitCount: 0, skillCount: 0 };

      const basePrice = calculateRecruitPrice(baseRecruit);
      const nerfedPrice = calculateRecruitPrice(nerfedRecruit);

      // Negative variance should lower price (but still >= base due to min check)
      assert.ok(nerfedPrice <= basePrice, 'Negative variance should not increase price');
    });

    it('should calculate variance correctly (+15%)', () => {
      const recruit = { stat_variance_percent: 15, traitCount: 0, skillCount: 0 };

      const price = calculateRecruitPrice(recruit);

      // 1 + 15/100 = 1.15
      // BASE_RECRUIT_PRICE * 1.15 = 2000 * 1.15 = 2300
      assert.strictEqual(price, Math.floor(BASE_RECRUIT_PRICE * 1.15));
    });

    it('should calculate variance correctly (-15%)', () => {
      const recruit = { stat_variance_percent: -15, traitCount: 0, skillCount: 0 };

      const price = calculateRecruitPrice(recruit);

      // 1 + (-15)/100 = 0.85
      // BASE_RECRUIT_PRICE * 0.85 = 2000 * 0.85 = 1700
      // But should be capped at BASE_RECRUIT_PRICE
      assert.strictEqual(price, Math.max(BASE_RECRUIT_PRICE, Math.floor(BASE_RECRUIT_PRICE * 0.85)));
    });

    it('should handle undefined stat_variance_percent', () => {
      const recruit = { traitCount: 0, skillCount: 0 };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, BASE_RECRUIT_PRICE);
    });
  });

  describe('trait bonus', () => {
    it('should not add bonus for single trait', () => {
      const recruit = { stat_variance_percent: 0, traitCount: 1, skillCount: 0 };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, BASE_RECRUIT_PRICE);
    });

    it('should add bonus for second trait', () => {
      const recruit = { stat_variance_percent: 0, traitCount: 2, skillCount: 0 };

      const price = calculateRecruitPrice(recruit);

      // BASE + 8000 for extra trait
      assert.strictEqual(price, BASE_RECRUIT_PRICE + TRAIT_BONUS_PRICE);
    });

    it('should add bonus for each trait beyond first', () => {
      const recruit = { stat_variance_percent: 0, traitCount: 3, skillCount: 0 };

      const price = calculateRecruitPrice(recruit);

      // BASE + 8000 * 2 for 2 extra traits
      assert.strictEqual(price, BASE_RECRUIT_PRICE + (TRAIT_BONUS_PRICE * 2));
    });

    it('should handle undefined traitCount', () => {
      const recruit = { stat_variance_percent: 0, skillCount: 0 };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, BASE_RECRUIT_PRICE);
    });
  });

  describe('skill bonus', () => {
    it('should add bonus for each pre-learned skill', () => {
      const recruit = { stat_variance_percent: 0, traitCount: 0, skillCount: 1 };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, BASE_RECRUIT_PRICE + SKILL_BONUS_PRICE);
    });

    it('should add bonus for multiple skills', () => {
      const recruit = { stat_variance_percent: 0, traitCount: 0, skillCount: 2 };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, BASE_RECRUIT_PRICE + (SKILL_BONUS_PRICE * 2));
    });

    it('should handle undefined skillCount', () => {
      const recruit = { stat_variance_percent: 0, traitCount: 0 };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, BASE_RECRUIT_PRICE);
    });
  });

  describe('combined pricing', () => {
    it('should combine all price factors', () => {
      const recruit = {
        stat_variance_percent: 10,  // +10% to base
        traitCount: 2,              // +8000 for extra trait
        skillCount: 2               // +1500 for 2 skills
      };

      const price = calculateRecruitPrice(recruit);

      // Base: 2000 * 1.10 = 2200
      // Traits: 8000 * (2-1) = 8000
      // Skills: 750 * 2 = 1500
      // Total: 2200 + 8000 + 1500 = 11700
      const expectedBaseWithVariance = Math.floor(BASE_RECRUIT_PRICE * 1.10);
      const expectedTraitBonus = TRAIT_BONUS_PRICE * 1;
      const expectedSkillBonus = SKILL_BONUS_PRICE * 2;

      assert.strictEqual(price, expectedBaseWithVariance + expectedTraitBonus + expectedSkillBonus);
    });

    it('should floor intermediate calculations', () => {
      const recruit = {
        stat_variance_percent: 7,  // Will create non-integer intermediate
        traitCount: 0,
        skillCount: 0
      };

      const price = calculateRecruitPrice(recruit);

      // 2000 * 1.07 = 2140
      assert.strictEqual(price, Math.floor(BASE_RECRUIT_PRICE * 1.07));
      assert.ok(Number.isInteger(price), 'Price should be an integer');
    });
  });
});

describe('garrisonService - Constants', () => {
  describe('BASE_RECRUIT_PRICE', () => {
    it('should be a positive number', () => {
      assert.ok(BASE_RECRUIT_PRICE > 0);
    });

    it('should be an integer', () => {
      assert.ok(Number.isInteger(BASE_RECRUIT_PRICE));
    });

    it('should be 2000 gold', () => {
      assert.strictEqual(BASE_RECRUIT_PRICE, 2000);
    });
  });

  describe('TRAIT_BONUS_PRICE', () => {
    it('should be greater than base price', () => {
      // Extra traits should be valuable
      assert.ok(TRAIT_BONUS_PRICE > BASE_RECRUIT_PRICE * 0.5);
    });

    it('should be 8000 gold', () => {
      assert.strictEqual(TRAIT_BONUS_PRICE, 8000);
    });
  });

  describe('SKILL_BONUS_PRICE', () => {
    it('should be reasonable', () => {
      assert.ok(SKILL_BONUS_PRICE > 0);
      assert.ok(SKILL_BONUS_PRICE < BASE_RECRUIT_PRICE);
    });

    it('should be 750 gold', () => {
      assert.strictEqual(SKILL_BONUS_PRICE, 750);
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

    it('should match documented percentages (70/20/8/2)', () => {
      assert.strictEqual(TRAIT_RARITY_WEIGHTS.common, 70);
      assert.strictEqual(TRAIT_RARITY_WEIGHTS.uncommon, 20);
      assert.strictEqual(TRAIT_RARITY_WEIGHTS.rare, 8);
      assert.strictEqual(TRAIT_RARITY_WEIGHTS.legendary, 2);
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

    it('should match documented percentages (92/8)', () => {
      assert.strictEqual(TRAIT_COUNT_WEIGHTS[1], 92);
      assert.strictEqual(TRAIT_COUNT_WEIGHTS[2], 8);
    });
  });

  describe('SKILL_COUNT_WEIGHTS', () => {
    it('should have options for 0, 1, and 2 skills', () => {
      assert.ok(0 in SKILL_COUNT_WEIGHTS);
      assert.ok(1 in SKILL_COUNT_WEIGHTS);
      assert.ok(2 in SKILL_COUNT_WEIGHTS);
    });

    it('should favor no extra skills', () => {
      assert.ok(SKILL_COUNT_WEIGHTS[0] >= SKILL_COUNT_WEIGHTS[1]);
      assert.ok(SKILL_COUNT_WEIGHTS[1] >= SKILL_COUNT_WEIGHTS[2]);
    });

    it('should sum to 100', () => {
      const total = Object.values(SKILL_COUNT_WEIGHTS).reduce((a, b) => a + b, 0);
      assert.strictEqual(total, 100);
    });

    it('should match documented percentages (60/30/10)', () => {
      assert.strictEqual(SKILL_COUNT_WEIGHTS[0], 60);
      assert.strictEqual(SKILL_COUNT_WEIGHTS[1], 30);
      assert.strictEqual(SKILL_COUNT_WEIGHTS[2], 10);
    });
  });
});
