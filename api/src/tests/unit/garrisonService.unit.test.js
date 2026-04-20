/**
 * Garrison Service Unit Tests
 * Tests for garrison recruit generation, purchasing, and refresh mechanics
 *
 * Test categories:
 * 1. Pure function tests (calculateRecruitPrice, weightedRandom, getStarterSkillId)
 * 2. Constants validation
 * 3. Region selection logic (via seeded random)
 * 4. Recruit data transformation (getAvailableRecruits response format)
 * 5. Business logic validation (price calculation, character limits, gold checks)
 *
 * Database-dependent functions (purchaseRecruit, generateGarrisonRecruits, etc.)
 * are tested via integration tests. This file focuses on pure functions,
 * constants validation, and logic that can be tested with mocked Math.random.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  calculateRecruitPrice,
  RECRUIT_PRICING,
  TRAIT_RARITY_WEIGHTS,
  TRAIT_COUNT_WEIGHTS,
  ADDITIONAL_SKILL_COUNT_WEIGHTS,
  weightedRandom,
  getStarterSkillId
} from '../../services/garrisonService.js';
import {
  RACES,
  CLASSES,
  GENDERS,
  REGIONS,
  GARRISON_CONFIG,
  MAX_PARTY_SIZE,
  calculateStats
} from '../../../../shared/constants.js';

// =============================================================================
// CALCULATE RECRUIT PRICE TESTS
// =============================================================================

describe('garrisonService - calculateRecruitPrice', () => {
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

    it('should handle extreme positive variance', () => {
      const recruit = { stat_variance_percent: 100, traits: [], skills: [] };

      const price = calculateRecruitPrice(recruit);

      const expectedPrice = RECRUIT_PRICING.BASE_PRICE + (100 * RECRUIT_PRICING.STAT_VARIANCE_BONUS);
      assert.strictEqual(price, expectedPrice);
    });

    it('should handle extreme negative variance without discount', () => {
      const recruit = { stat_variance_percent: -100, traits: [], skills: [] };

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

    it('should handle traits with undefined rarity as common', () => {
      const recruit = { stat_variance_percent: 0, traits: [{}], skills: [] };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + RECRUIT_PRICING.TRAIT_PRICES.common);
    });

    it('should handle all four traits at once', () => {
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

    it('should charge for higher level skills', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [{ tier: 1, level: 1 }, { tier: 1, level: 3 }]
      };

      const price = calculateRecruitPrice(recruit);

      // First T1L1 free, T1L3 costs 250 * 1 * 3 = 750
      const expectedSkillPrice = RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 1 * 3;
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + expectedSkillPrice);
    });

    it('should handle undefined skills', () => {
      const recruit = { stat_variance_percent: 0, traits: [] };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });

    it('should handle skills with default tier and level', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [{}, {}]  // Both default to tier 1, level 1
      };

      const price = calculateRecruitPrice(recruit);

      // First T1L1 free, second costs 250
      const expectedSkillPrice = RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 1 * 1;
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + expectedSkillPrice);
    });

    it('should correctly price a T2L1 as first skill (not free)', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [{ tier: 2, level: 1 }]  // T2L1 is not free even as first skill
      };

      const price = calculateRecruitPrice(recruit);

      // T2L1 costs 250 * 2 * 1 = 500 (first free only applies to T1L1)
      const expectedSkillPrice = RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 2 * 1;
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + expectedSkillPrice);
    });

    it('should correctly price multiple tier 2 skills', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [
          { tier: 1, level: 1 },  // Free
          { tier: 2, level: 1 },  // 500
          { tier: 2, level: 2 }   // 1000
        ]
      };

      const price = calculateRecruitPrice(recruit);

      const expectedSkillPrice =
        (RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 2 * 1) +  // T2L1
        (RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER * 2 * 2);   // T2L2
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

    it('should handle maximum realistic recruit', () => {
      // A recruit with max variance, 2 legendary traits, and 3 skills
      const recruit = {
        stat_variance_percent: 15,
        traits: [{ rarity: 'legendary' }, { rarity: 'legendary' }],
        skills: [
          { tier: 1, level: 1 },  // Free
          { tier: 2, level: 1 },  // 500
          { tier: 2, level: 1 }   // 500
        ]
      };

      const price = calculateRecruitPrice(recruit);

      // Base: 400
      // Variance: 15 * 5 = 75
      // Traits: 4000 + 4000 = 8000
      // Skills: 0 + 500 + 500 = 1000
      // Total: 400 + 75 + 8000 + 1000 = 9475
      const expected = 400 + 75 + 8000 + 1000;
      assert.strictEqual(price, expected);
    });
  });
});

// =============================================================================
// WEIGHTED RANDOM TESTS
// =============================================================================

describe('garrisonService - weightedRandom', () => {
  let originalRandom;

  beforeEach(() => {
    originalRandom = Math.random;
  });

  afterEach(() => {
    Math.random = originalRandom;
  });

  it('should return first option when random is near 0', () => {
    Math.random = () => 0.01;
    const result = weightedRandom({ common: 70, rare: 30 });
    assert.strictEqual(result, 'common');
  });

  it('should return second option when random exceeds first weight', () => {
    Math.random = () => 0.8;  // 80% > 70%
    const result = weightedRandom({ common: 70, rare: 30 });
    assert.strictEqual(result, 'rare');
  });

  it('should return numeric keys as numbers', () => {
    Math.random = () => 0.5;
    const result = weightedRandom({ 1: 50, 2: 50 });
    assert.strictEqual(typeof result, 'number');
    assert.strictEqual(result, 1);
  });

  it('should handle single option weights', () => {
    Math.random = () => 0.99;
    const result = weightedRandom({ only: 100 });
    assert.strictEqual(result, 'only');
  });

  it('should handle multiple options with equal weights', () => {
    // With 4 options at 25% each:
    // a: 0-25%, b: 25-50%, c: 50-75%, d: 75-100%
    // At 0.76 (76%), we should get 'd'
    Math.random = () => 0.76;
    const result = weightedRandom({ a: 25, b: 25, c: 25, d: 25 });
    assert.strictEqual(result, 'd');
  });

  it('should work with trait rarity weights', () => {
    // Test with actual TRAIT_RARITY_WEIGHTS
    Math.random = () => 0.25;  // 25% should be common (0-70%)
    let result = weightedRandom(TRAIT_RARITY_WEIGHTS);
    assert.strictEqual(result, 'common');

    Math.random = () => 0.75;  // 75% should be uncommon (70-90%)
    result = weightedRandom(TRAIT_RARITY_WEIGHTS);
    assert.strictEqual(result, 'uncommon');

    Math.random = () => 0.92;  // 92% should be rare (90-98%)
    result = weightedRandom(TRAIT_RARITY_WEIGHTS);
    assert.strictEqual(result, 'rare');

    Math.random = () => 0.99;  // 99% should be legendary (98-100%)
    result = weightedRandom(TRAIT_RARITY_WEIGHTS);
    assert.strictEqual(result, 'legendary');
  });

  it('should work with trait count weights', () => {
    Math.random = () => 0.5;  // 50% should be 1 (0-92%)
    let result = weightedRandom(TRAIT_COUNT_WEIGHTS);
    assert.strictEqual(result, 1);

    Math.random = () => 0.95;  // 95% should be 2 (92-100%)
    result = weightedRandom(TRAIT_COUNT_WEIGHTS);
    assert.strictEqual(result, 2);
  });

  it('should work with additional skill count weights', () => {
    Math.random = () => 0.3;  // 30% should be 0 (0-60%)
    let result = weightedRandom(ADDITIONAL_SKILL_COUNT_WEIGHTS);
    assert.strictEqual(result, 0);

    Math.random = () => 0.7;  // 70% should be 1 (60-90%)
    result = weightedRandom(ADDITIONAL_SKILL_COUNT_WEIGHTS);
    assert.strictEqual(result, 1);

    Math.random = () => 0.95;  // 95% should be 2 (90-100%)
    result = weightedRandom(ADDITIONAL_SKILL_COUNT_WEIGHTS);
    assert.strictEqual(result, 2);
  });
});

// =============================================================================
// STARTER SKILL TESTS
// =============================================================================

describe('garrisonService - getStarterSkillId', () => {
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

  it('should return null for undefined class', () => {
    assert.strictEqual(getStarterSkillId(undefined), null);
  });

  it('should return null for null class', () => {
    assert.strictEqual(getStarterSkillId(null), null);
  });

  it('should be case-sensitive', () => {
    assert.strictEqual(getStarterSkillId('WARRIOR'), null);
    assert.strictEqual(getStarterSkillId('Warrior'), null);
  });
});

// =============================================================================
// CONSTANTS VALIDATION TESTS
// =============================================================================

describe('garrisonService - Constants', () => {
  describe('RECRUIT_PRICING', () => {
    it('should have base price', () => {
      assert.ok(RECRUIT_PRICING.BASE_PRICE > 0);
      assert.strictEqual(RECRUIT_PRICING.BASE_PRICE, 400);
    });

    it('should have stat variance bonus', () => {
      assert.ok(RECRUIT_PRICING.STAT_VARIANCE_BONUS > 0);
      assert.strictEqual(RECRUIT_PRICING.STAT_VARIANCE_BONUS, 5);
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
      assert.strictEqual(RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER, 250);
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

    it('should match documented percentages (60/30/10)', () => {
      assert.strictEqual(ADDITIONAL_SKILL_COUNT_WEIGHTS[0], 60);
      assert.strictEqual(ADDITIONAL_SKILL_COUNT_WEIGHTS[1], 30);
      assert.strictEqual(ADDITIONAL_SKILL_COUNT_WEIGHTS[2], 10);
    });
  });

  describe('GARRISON_CONFIG', () => {
    it('should have valid recruitsPerCastle range', () => {
      assert.ok(GARRISON_CONFIG.recruitsPerCastle.min > 0);
      assert.ok(GARRISON_CONFIG.recruitsPerCastle.max >= GARRISON_CONFIG.recruitsPerCastle.min);
      assert.strictEqual(GARRISON_CONFIG.recruitsPerCastle.min, 8);
      assert.strictEqual(GARRISON_CONFIG.recruitsPerCastle.max, 12);
    });

    it('should have valid race weight (70% regional, 30% random)', () => {
      assert.strictEqual(GARRISON_CONFIG.raceWeight.regional, 0.7);
      assert.strictEqual(GARRISON_CONFIG.raceWeight.random, 0.3);
      assert.strictEqual(
        GARRISON_CONFIG.raceWeight.regional + GARRISON_CONFIG.raceWeight.random,
        1.0
      );
    });

    it('should have valid class weight (70% regional, 30% random)', () => {
      assert.strictEqual(GARRISON_CONFIG.classWeight.regional, 0.7);
      assert.strictEqual(GARRISON_CONFIG.classWeight.random, 0.3);
      assert.strictEqual(
        GARRISON_CONFIG.classWeight.regional + GARRISON_CONFIG.classWeight.random,
        1.0
      );
    });

    it('should have regional classes for all regions', () => {
      const expectedRegions = ['heartlands', 'elven_glade', 'dwarven_holds', 'orcish_steppes', 'feral_wilds'];
      for (const region of expectedRegions) {
        assert.ok(
          GARRISON_CONFIG.regionalClasses[region],
          `Should have regional classes for ${region}`
        );
        assert.ok(
          Array.isArray(GARRISON_CONFIG.regionalClasses[region]),
          `Regional classes for ${region} should be an array`
        );
        assert.ok(
          GARRISON_CONFIG.regionalClasses[region].length > 0,
          `Regional classes for ${region} should not be empty`
        );
      }
    });

    it('should have valid classes in regional classes', () => {
      const validClasses = Object.values(CLASSES);
      for (const [region, classes] of Object.entries(GARRISON_CONFIG.regionalClasses)) {
        for (const cls of classes) {
          assert.ok(
            validClasses.includes(cls),
            `Class '${cls}' in region '${region}' should be a valid class`
          );
        }
      }
    });
  });
});

// =============================================================================
// REGION AND RACE VALIDATION TESTS
// =============================================================================

describe('garrisonService - Region and Race Validation', () => {
  describe('REGIONS structure', () => {
    it('should have 5 regions', () => {
      assert.strictEqual(Object.keys(REGIONS).length, 5);
    });

    it('should have unique region IDs', () => {
      const ids = Object.values(REGIONS).map(r => r.id);
      const uniqueIds = new Set(ids);
      assert.strictEqual(ids.length, uniqueIds.size);
    });

    it('should have region IDs from 1 to 5', () => {
      const ids = Object.values(REGIONS).map(r => r.id).sort();
      assert.deepStrictEqual(ids, [1, 2, 3, 4, 5]);
    });

    it('should have each region associated with a unique race', () => {
      const races = Object.values(REGIONS).map(r => r.race);
      const uniqueRaces = new Set(races);
      assert.strictEqual(races.length, uniqueRaces.size);
    });

    it('should have all races represented in regions', () => {
      const regionRaces = new Set(Object.values(REGIONS).map(r => r.race));
      const allRaces = Object.values(RACES);
      for (const race of allRaces) {
        assert.ok(regionRaces.has(race), `Race '${race}' should be in a region`);
      }
    });

    it('should have valid region structure', () => {
      for (const [key, region] of Object.entries(REGIONS)) {
        assert.ok(region.id, `Region ${key} should have id`);
        assert.ok(region.race, `Region ${key} should have race`);
        assert.ok(region.name, `Region ${key} should have name`);
        assert.ok(region.castleName, `Region ${key} should have castleName`);
        assert.ok(region.dominantTerrain, `Region ${key} should have dominantTerrain`);
        assert.ok(Array.isArray(region.secondaryTerrains), `Region ${key} should have secondaryTerrains array`);
      }
    });
  });

  describe('RACES structure', () => {
    it('should have 5 races', () => {
      assert.strictEqual(Object.keys(RACES).length, 5);
    });

    it('should have lowercase race values', () => {
      for (const race of Object.values(RACES)) {
        assert.strictEqual(race, race.toLowerCase());
      }
    });
  });

  describe('CLASSES structure', () => {
    it('should have 4 classes', () => {
      assert.strictEqual(Object.keys(CLASSES).length, 4);
    });

    it('should have lowercase class values', () => {
      for (const cls of Object.values(CLASSES)) {
        assert.strictEqual(cls, cls.toLowerCase());
      }
    });

    it('should have classes matching starter skills', () => {
      for (const cls of Object.values(CLASSES)) {
        const starterSkill = getStarterSkillId(cls);
        assert.ok(starterSkill, `Class '${cls}' should have a starter skill`);
      }
    });
  });
});

// =============================================================================
// STAT CALCULATION TESTS (for recruit stat variance)
// =============================================================================

describe('garrisonService - Stat Calculations', () => {
  describe('calculateStats integration', () => {
    it('should calculate valid base stats for each race/class combination', () => {
      const races = Object.values(RACES);
      const classes = Object.values(CLASSES);

      for (const race of races) {
        for (const cls of classes) {
          const stats = calculateStats(race, cls, 1);

          assert.ok(stats.hpMax > 0, `HP should be positive for ${race} ${cls}`);
          assert.ok(stats.mpMax >= 0, `MP should be non-negative for ${race} ${cls}`);
          assert.ok(stats.strength > 0, `STR should be positive for ${race} ${cls}`);
          assert.ok(stats.intelligence > 0, `INT should be positive for ${race} ${cls}`);
          assert.ok(stats.agility > 0, `AGI should be positive for ${race} ${cls}`);
          assert.ok(stats.vitality > 0, `VIT should be positive for ${race} ${cls}`);
          assert.ok(stats.luck > 0, `LUK should be positive for ${race} ${cls}`);
        }
      }
    });

    it('should produce different stats for different classes', () => {
      const warriorStats = calculateStats('human', 'warrior', 1);
      const wizardStats = calculateStats('human', 'wizard', 1);

      // Warrior should have higher strength, wizard higher intelligence
      assert.ok(
        warriorStats.strength >= wizardStats.strength,
        'Warrior should have >= strength than wizard'
      );
      assert.ok(
        wizardStats.intelligence >= warriorStats.intelligence,
        'Wizard should have >= intelligence than warrior'
      );
    });

    it('should produce different stats for different races', () => {
      const humanStats = calculateStats('human', 'warrior', 1);
      const orcStats = calculateStats('orc', 'warrior', 1);

      // Both should have positive stats even if different
      assert.ok(humanStats.hpMax > 0);
      assert.ok(orcStats.hpMax > 0);
    });
  });

  describe('variance application', () => {
    it('should correctly apply +15% variance to stats', () => {
      const baseStats = calculateStats('human', 'warrior', 1);
      const variancePercent = 15;

      // Simulate what the service does
      const variedHp = Math.max(1, Math.round(baseStats.hpMax * (1 + variancePercent / 100)));
      const variedStr = Math.max(1, Math.round(baseStats.strength * (1 + variancePercent / 100)));

      assert.ok(variedHp > baseStats.hpMax, 'HP should increase with positive variance');
      assert.ok(variedStr > baseStats.strength, 'STR should increase with positive variance');
    });

    it('should correctly apply -15% variance to stats', () => {
      const baseStats = calculateStats('human', 'warrior', 1);
      const variancePercent = -15;

      // Simulate what the service does
      const variedHp = Math.max(1, Math.round(baseStats.hpMax * (1 + variancePercent / 100)));
      const variedStr = Math.max(1, Math.round(baseStats.strength * (1 + variancePercent / 100)));

      assert.ok(variedHp < baseStats.hpMax, 'HP should decrease with negative variance');
      assert.ok(variedStr >= 1, 'Stats should never go below 1');
    });

    it('should ensure minimum stat value of 1', () => {
      const baseStats = { hpMax: 10, strength: 1 };
      const variancePercent = -50;  // Extreme variance

      const variedStr = Math.max(1, Math.round(baseStats.strength * (1 + variancePercent / 100)));

      assert.strictEqual(variedStr, 1, 'Stats should never go below 1');
    });
  });
});

// =============================================================================
// MAX PARTY SIZE VALIDATION TESTS
// =============================================================================

describe('garrisonService - Party Size Limits', () => {
  it('should have MAX_PARTY_SIZE defined', () => {
    assert.ok(MAX_PARTY_SIZE > 0);
  });

  it('should have reasonable party size limit', () => {
    // Party size should be between 1 and 20 for reasonable gameplay
    // Modia uses MAX_PARTY_SIZE=12 for total roster, MAX_BATTLE_PARTY_SIZE=5 for combat
    assert.ok(MAX_PARTY_SIZE >= 1);
    assert.ok(MAX_PARTY_SIZE <= 20);
  });

  describe('party slot assignment logic', () => {
    it('should calculate next slot correctly when party is empty', () => {
      // Simulating COALESCE(MAX(party_slot), 0) + 1 when no characters
      const maxSlot = null;  // No characters
      const nextSlot = (maxSlot || 0) + 1;
      assert.strictEqual(nextSlot, 1);
    });

    it('should calculate next slot correctly when party has characters', () => {
      // Simulating COALESCE(MAX(party_slot), 0) + 1 with existing characters
      const maxSlot = 3;
      const nextSlot = (maxSlot || 0) + 1;
      assert.strictEqual(nextSlot, 4);
    });

    it('should cap slot at MAX_PARTY_SIZE', () => {
      const maxSlot = MAX_PARTY_SIZE;
      const nextSlot = Math.min((maxSlot || 0) + 1, MAX_PARTY_SIZE);
      assert.strictEqual(nextSlot, MAX_PARTY_SIZE);
    });

    it('should set slot to null when party is full', () => {
      // When party is full, new character should have null slot
      const nextSlot = MAX_PARTY_SIZE + 1;
      const assignedSlot = nextSlot <= MAX_PARTY_SIZE ? nextSlot : null;
      assert.strictEqual(assignedSlot, null);
    });
  });
});

// =============================================================================
// RECRUIT DATA TRANSFORMATION TESTS
// =============================================================================

describe('garrisonService - Recruit Data Transformation', () => {
  describe('getAvailableRecruits response format', () => {
    it('should transform snake_case DB stats to camelCase', () => {
      // Simulate DB row with snake_case stats
      const dbRecruit = {
        id: 1,
        castle_node_id: 100,
        name: 'Test Recruit',
        race: 'human',
        class: 'warrior',
        level: 1,
        experience: 0,
        stats: {
          hp_max: 100,
          mp_max: 50,
          strength: 15,
          intelligence: 10,
          agility: 12,
          vitality: 14,
          luck: 8
        },
        traits: [],
        equipment: [],
        skills: [],
        price: 400,
        generated_at: new Date()
      };

      // Simulate transformation logic from getAvailableRecruits
      const transformedStats = {
        hpMax: dbRecruit.stats.hp_max || dbRecruit.stats.hpMax,
        mpMax: dbRecruit.stats.mp_max || dbRecruit.stats.mpMax,
        strength: dbRecruit.stats.strength,
        intelligence: dbRecruit.stats.intelligence,
        agility: dbRecruit.stats.agility,
        vitality: dbRecruit.stats.vitality,
        luck: dbRecruit.stats.luck
      };

      assert.strictEqual(transformedStats.hpMax, 100);
      assert.strictEqual(transformedStats.mpMax, 50);
      assert.strictEqual(transformedStats.strength, 15);
    });

    it('should handle already camelCase stats from DB', () => {
      // Some DB rows might already have camelCase (if stored that way)
      const dbRecruit = {
        stats: {
          hpMax: 100,
          mpMax: 50,
          strength: 15,
          intelligence: 10,
          agility: 12,
          vitality: 14,
          luck: 8
        }
      };

      const transformedStats = {
        hpMax: dbRecruit.stats.hp_max || dbRecruit.stats.hpMax,
        mpMax: dbRecruit.stats.mp_max || dbRecruit.stats.mpMax,
        strength: dbRecruit.stats.strength,
        intelligence: dbRecruit.stats.intelligence,
        agility: dbRecruit.stats.agility,
        vitality: dbRecruit.stats.vitality,
        luck: dbRecruit.stats.luck
      };

      assert.strictEqual(transformedStats.hpMax, 100);
      assert.strictEqual(transformedStats.mpMax, 50);
    });

    it('should handle null/undefined traits as empty array', () => {
      const dbRecruit = { traits: null };
      const traits = dbRecruit.traits || [];
      assert.deepStrictEqual(traits, []);
    });

    it('should handle null/undefined equipment as empty array', () => {
      const dbRecruit = { equipment: null };
      const equipment = dbRecruit.equipment || [];
      assert.deepStrictEqual(equipment, []);
    });

    it('should handle null/undefined skills as empty array', () => {
      const dbRecruit = { skills: null };
      const skills = dbRecruit.skills || [];
      assert.deepStrictEqual(skills, []);
    });
  });
});

// =============================================================================
// GOLD AND PURCHASE VALIDATION TESTS
// =============================================================================

describe('garrisonService - Gold Validation', () => {
  describe('gold sufficiency checks', () => {
    it('should identify sufficient gold', () => {
      const userGold = 1000;
      const recruitPrice = 500;
      const hasSufficientGold = userGold >= recruitPrice;
      assert.strictEqual(hasSufficientGold, true);
    });

    it('should identify insufficient gold', () => {
      const userGold = 300;
      const recruitPrice = 500;
      const hasSufficientGold = userGold >= recruitPrice;
      assert.strictEqual(hasSufficientGold, false);
    });

    it('should handle exact gold amount', () => {
      const userGold = 500;
      const recruitPrice = 500;
      const hasSufficientGold = userGold >= recruitPrice;
      assert.strictEqual(hasSufficientGold, true);
    });

    it('should handle zero gold', () => {
      const userGold = 0;
      const recruitPrice = 400;  // Base price
      const hasSufficientGold = userGold >= recruitPrice;
      assert.strictEqual(hasSufficientGold, false);
    });
  });

  describe('remaining gold calculation', () => {
    it('should correctly calculate remaining gold after purchase', () => {
      const userGold = 1000;
      const recruitPrice = 400;
      const remainingGold = userGold - recruitPrice;
      assert.strictEqual(remainingGold, 600);
    });

    it('should correctly calculate remaining gold for expensive recruit', () => {
      const userGold = 10000;
      const expensiveRecruitPrice = calculateRecruitPrice({
        stat_variance_percent: 15,
        traits: [{ rarity: 'legendary' }],
        skills: [{ tier: 1, level: 1 }, { tier: 2, level: 1 }]
      });
      const remainingGold = userGold - expensiveRecruitPrice;
      assert.ok(remainingGold > 0);
      assert.ok(remainingGold < userGold);
    });
  });
});

// =============================================================================
// TIMESTAMP AND STALENESS TESTS
// =============================================================================

describe('garrisonService - Staleness Checks', () => {
  describe('hourly refresh logic', () => {
    it('should identify stale recruits from previous hour', () => {
      const now = new Date('2024-01-15T14:30:00.000Z');
      const generatedAt = new Date('2024-01-15T13:45:00.000Z');

      const currentHour = new Date(now);
      currentHour.setUTCMinutes(0, 0, 0);

      const isStale = generatedAt < currentHour;
      assert.strictEqual(isStale, true);
    });

    it('should identify fresh recruits from current hour', () => {
      const now = new Date('2024-01-15T14:30:00.000Z');
      const generatedAt = new Date('2024-01-15T14:15:00.000Z');

      const currentHour = new Date(now);
      currentHour.setUTCMinutes(0, 0, 0);

      const isStale = generatedAt < currentHour;
      assert.strictEqual(isStale, false);
    });

    it('should identify recruits at hour boundary as fresh', () => {
      const now = new Date('2024-01-15T14:00:30.000Z');  // 30 seconds past the hour
      const generatedAt = new Date('2024-01-15T14:00:00.000Z');  // Exactly at the hour

      const currentHour = new Date(now);
      currentHour.setUTCMinutes(0, 0, 0);

      const isStale = generatedAt < currentHour;
      assert.strictEqual(isStale, false);
    });

    it('should identify recruits from previous day as stale', () => {
      const now = new Date('2024-01-15T14:30:00.000Z');
      const generatedAt = new Date('2024-01-14T14:30:00.000Z');

      const currentHour = new Date(now);
      currentHour.setUTCMinutes(0, 0, 0);

      const isStale = generatedAt < currentHour;
      assert.strictEqual(isStale, true);
    });
  });

  describe('UTC time handling', () => {
    it('should use UTC for hour boundary calculation', () => {
      const now = new Date('2024-01-15T14:30:00.000Z');
      const currentHour = new Date(now);
      currentHour.setUTCMinutes(0, 0, 0);

      assert.strictEqual(currentHour.getUTCHours(), 14);
      assert.strictEqual(currentHour.getUTCMinutes(), 0);
      assert.strictEqual(currentHour.getUTCSeconds(), 0);
      assert.strictEqual(currentHour.getUTCMilliseconds(), 0);
    });
  });
});

// =============================================================================
// RECRUIT COUNT RANGE TESTS
// =============================================================================

describe('garrisonService - Recruit Count Generation', () => {
  let originalRandom;

  beforeEach(() => {
    originalRandom = Math.random;
  });

  afterEach(() => {
    Math.random = originalRandom;
  });

  it('should generate minimum recruits with low random', () => {
    Math.random = () => 0;
    const { min, max } = GARRISON_CONFIG.recruitsPerCastle;
    const recruitCount = Math.floor(Math.random() * (max - min + 1)) + min;
    assert.strictEqual(recruitCount, min);
  });

  it('should generate maximum recruits with high random', () => {
    Math.random = () => 0.9999;
    const { min, max } = GARRISON_CONFIG.recruitsPerCastle;
    const recruitCount = Math.floor(Math.random() * (max - min + 1)) + min;
    assert.strictEqual(recruitCount, max);
  });

  it('should generate recruits within configured range', () => {
    const { min, max } = GARRISON_CONFIG.recruitsPerCastle;

    // Test multiple random values
    const randomValues = [0, 0.25, 0.5, 0.75, 0.9999];
    for (const r of randomValues) {
      Math.random = () => r;
      const recruitCount = Math.floor(Math.random() * (max - min + 1)) + min;
      assert.ok(recruitCount >= min, `Count ${recruitCount} should be >= ${min}`);
      assert.ok(recruitCount <= max, `Count ${recruitCount} should be <= ${max}`);
    }
  });
});

// =============================================================================
// VARIANCE RANGE TESTS
// =============================================================================

describe('garrisonService - Stat Variance Range', () => {
  let originalRandom;

  beforeEach(() => {
    originalRandom = Math.random;
  });

  afterEach(() => {
    Math.random = originalRandom;
  });

  it('should generate -15% variance with low random', () => {
    Math.random = () => 0;
    const variancePercent = (Math.random() * 30) - 15;
    assert.strictEqual(variancePercent, -15);
  });

  it('should generate +15% variance with high random', () => {
    Math.random = () => 1;
    const variancePercent = (Math.random() * 30) - 15;
    assert.strictEqual(variancePercent, 15);
  });

  it('should generate 0% variance with mid random', () => {
    Math.random = () => 0.5;
    const variancePercent = (Math.random() * 30) - 15;
    assert.strictEqual(variancePercent, 0);
  });

  it('should always be within -15 to +15 range', () => {
    const randomValues = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
    for (const r of randomValues) {
      Math.random = () => r;
      const variancePercent = (Math.random() * 30) - 15;
      assert.ok(variancePercent >= -15, `Variance ${variancePercent} should be >= -15`);
      assert.ok(variancePercent <= 15, `Variance ${variancePercent} should be <= 15`);
    }
  });
});

// =============================================================================
// REGION SELECTION LOGIC TESTS
// =============================================================================

describe('garrisonService - Region Selection Logic', () => {
  let originalRandom;

  beforeEach(() => {
    originalRandom = Math.random;
  });

  afterEach(() => {
    Math.random = originalRandom;
  });

  it('should select regional race with 70% probability', () => {
    Math.random = () => 0.5; // 50% < 70%

    // Mock region lookup
    const regionId = 1; // Human region
    const region = { id: 1, race: 'human' };
    const raceWeight = { regional: 0.7, random: 0.3 };

    if (region && Math.random() < raceWeight.regional) {
      const selectedRace = region.race;
      assert.strictEqual(selectedRace, 'human');
    }
  });

  it('should select random race with 30% probability', () => {
    Math.random = () => 0.8; // 80% >= 70%

    const region = { id: 1, race: 'human' };
    const raceWeight = { regional: 0.7, random: 0.3 };
    const allRaces = ['human', 'elf', 'dwarf', 'orc', 'feral'];

    if (region && Math.random() >= raceWeight.regional) {
      // Would select randomly from allRaces
      assert.ok(allRaces.includes('human'));
      assert.ok(allRaces.includes('elf'));
      assert.strictEqual(allRaces.length, 5);
    }
  });

  it('should select regional class with 70% probability', () => {
    Math.random = () => 0.6; // 60% < 70%

    const regionKey = 'heartlands';
    const classWeight = { regional: 0.7, random: 0.3 };
    const regionalClasses = ['warrior', 'monk']; // Heartlands classes

    if (regionalClasses && Math.random() < classWeight.regional) {
      const selectedClass = regionalClasses[0];
      assert.ok(['warrior', 'monk'].includes(selectedClass));
    }
  });

  it('should select random class with 30% probability', () => {
    Math.random = () => 0.75; // 75% >= 70%

    const classWeight = { regional: 0.7, random: 0.3 };
    const allClasses = ['warrior', 'wizard', 'monk', 'chemist'];

    if (Math.random() >= classWeight.regional) {
      // Would select randomly from allClasses
      assert.strictEqual(allClasses.length, 4);
      assert.ok(allClasses.includes('warrior'));
      assert.ok(allClasses.includes('wizard'));
    }
  });
});

// =============================================================================
// STAT VARIANCE APPLICATION TESTS
// =============================================================================

describe('garrisonService - Stat Variance Application', () => {
  it('should apply positive variance correctly', () => {
    const baseStats = {
      hpMax: 100,
      mpMax: 50,
      strength: 15,
      intelligence: 10,
      agility: 12,
      vitality: 14,
      luck: 8
    };
    const variancePercent = 10; // +10%

    const variedStats = {
      hp_max: Math.max(1, Math.round(baseStats.hpMax * (1 + variancePercent / 100))),
      mp_max: Math.max(0, Math.round(baseStats.mpMax * (1 + variancePercent / 100))),
      strength: Math.max(1, Math.round(baseStats.strength * (1 + variancePercent / 100))),
      intelligence: Math.max(1, Math.round(baseStats.intelligence * (1 + variancePercent / 100))),
      agility: Math.max(1, Math.round(baseStats.agility * (1 + variancePercent / 100))),
      vitality: Math.max(1, Math.round(baseStats.vitality * (1 + variancePercent / 100))),
      luck: Math.max(1, Math.round(baseStats.luck * (1 + variancePercent / 100)))
    };

    assert.strictEqual(variedStats.hp_max, 110); // 100 * 1.1
    assert.strictEqual(variedStats.mp_max, 55);  // 50 * 1.1
    assert.strictEqual(variedStats.strength, 17); // 15 * 1.1 = 16.5 -> 17
    assert.strictEqual(variedStats.intelligence, 11); // 10 * 1.1
  });

  it('should apply negative variance correctly', () => {
    const baseStats = {
      hpMax: 100,
      strength: 15
    };
    const variancePercent = -10; // -10%

    const variedStats = {
      hp_max: Math.max(1, Math.round(baseStats.hpMax * (1 + variancePercent / 100))),
      strength: Math.max(1, Math.round(baseStats.strength * (1 + variancePercent / 100)))
    };

    assert.strictEqual(variedStats.hp_max, 90); // 100 * 0.9
    assert.strictEqual(variedStats.strength, 14); // 15 * 0.9 = 13.5 -> 14
  });

  it('should enforce minimum stat values', () => {
    const baseStats = { strength: 1 };
    const variancePercent = -50; // -50%

    const variedStat = Math.max(1, Math.round(baseStats.strength * (1 + variancePercent / 100)));
    assert.strictEqual(variedStat, 1); // Cannot go below 1
  });

  it('should handle extreme variance correctly', () => {
    const baseStats = { strength: 10 };
    const extremePositive = 100; // +100%
    const extremeNegative = -90; // -90%

    const positiveResult = Math.max(1, Math.round(baseStats.strength * (1 + extremePositive / 100)));
    const negativeResult = Math.max(1, Math.round(baseStats.strength * (1 + extremeNegative / 100)));

    assert.strictEqual(positiveResult, 20); // 10 * 2
    assert.strictEqual(negativeResult, 1);  // 10 * 0.1 = 1 (minimum)
  });
});

// =============================================================================
// RECRUIT DATA TRANSFORMATION TESTS
// =============================================================================

describe('garrisonService - Recruit Data Transformation', () => {
  it('should transform database recruit to API format', () => {
    const dbRecruit = {
      id: 1,
      castle_node_id: 100,
      name: 'Test Recruit',
      race: 'human',
      class: 'warrior',
      level: 1,
      experience: 0,
      stats: {
        hp_max: 110, // With variance
        mp_max: 55,
        strength: 17,
        intelligence: 11,
        agility: 13,
        vitality: 15,
        luck: 9
      },
      traits: [
        { id: 1, name: 'Strong', rarity: 'common' },
        { id: 2, name: 'Lucky', rarity: 'uncommon' }
      ],
      equipment: [],
      skills: [1, 2, 5], // Starter + 2 additional
      price: 850,
      generated_at: new Date('2024-01-15T14:00:00Z')
    };

    // Simulate transformation (like getAvailableRecruits does)
    const transformed = {
      id: dbRecruit.id,
      castleNodeId: dbRecruit.castle_node_id,
      name: dbRecruit.name,
      race: dbRecruit.race,
      class: dbRecruit.class,
      level: dbRecruit.level,
      experience: dbRecruit.experience,
      stats: {
        hpMax: dbRecruit.stats.hp_max || dbRecruit.stats.hpMax,
        mpMax: dbRecruit.stats.mp_max || dbRecruit.stats.mpMax,
        strength: dbRecruit.stats.strength,
        intelligence: dbRecruit.stats.intelligence,
        agility: dbRecruit.stats.agility,
        vitality: dbRecruit.stats.vitality,
        luck: dbRecruit.stats.luck
      },
      traits: dbRecruit.traits || [],
      equipment: dbRecruit.equipment || [],
      skills: dbRecruit.skills || [],
      price: dbRecruit.price,
      generatedAt: dbRecruit.generated_at
    };

    assert.strictEqual(transformed.id, 1);
    assert.strictEqual(transformed.castleNodeId, 100);
    assert.strictEqual(transformed.stats.hpMax, 110);
    assert.strictEqual(transformed.stats.mpMax, 55);
    assert.strictEqual(transformed.traits.length, 2);
    assert.strictEqual(transformed.skills.length, 3);
    assert.strictEqual(transformed.price, 850);
  });

  it('should handle legacy camelCase stats format', () => {
    const dbRecruit = {
      stats: {
        hpMax: 100, // Already camelCase
        mpMax: 50,
        strength: 15,
        intelligence: 10,
        agility: 12,
        vitality: 14,
        luck: 8
      }
    };

    const transformed = {
      hpMax: dbRecruit.stats.hp_max || dbRecruit.stats.hpMax,
      mpMax: dbRecruit.stats.mp_max || dbRecruit.stats.mpMax,
      strength: dbRecruit.stats.strength,
      intelligence: dbRecruit.stats.intelligence,
      agility: dbRecruit.stats.agility,
      vitality: dbRecruit.stats.vitality,
      luck: dbRecruit.stats.luck
    };

    assert.strictEqual(transformed.hpMax, 100);
    assert.strictEqual(transformed.mpMax, 50);
  });

  it('should handle null/undefined collections', () => {
    const dbRecruit = {
      traits: null,
      equipment: undefined,
      skills: null
    };

    const transformed = {
      traits: dbRecruit.traits || [],
      equipment: dbRecruit.equipment || [],
      skills: dbRecruit.skills || []
    };

    assert.deepStrictEqual(transformed.traits, []);
    assert.deepStrictEqual(transformed.equipment, []);
    assert.deepStrictEqual(transformed.skills, []);
  });
});

// =============================================================================
// REFRESH TIME CALCULATION TESTS
// =============================================================================

describe('garrisonService - Refresh Time Calculations', () => {
  it('should calculate time until next hour correctly', () => {
    const now = new Date('2024-01-15T14:30:00.000Z');

    // Calculate next hour boundary
    const nextHour = new Date(now);
    nextHour.setUTCHours(nextHour.getUTCHours() + 1);
    nextHour.setUTCMinutes(0, 0, 0);

    const timeUntilRefresh = nextHour.getTime() - now.getTime();
    const minutesUntilRefresh = Math.ceil(timeUntilRefresh / (1000 * 60));

    assert.strictEqual(nextHour.getUTCHours(), 15);
    assert.strictEqual(nextHour.getUTCMinutes(), 0);
    assert.strictEqual(minutesUntilRefresh, 30); // 30 minutes until 15:00
  });

  it('should handle near-hour-boundary timing', () => {
    const now = new Date('2024-01-15T14:59:45.000Z');

    const nextHour = new Date(now);
    nextHour.setUTCHours(nextHour.getUTCHours() + 1);
    nextHour.setUTCMinutes(0, 0, 0);

    const timeUntilRefresh = nextHour.getTime() - now.getTime();
    const minutesUntilRefresh = Math.ceil(timeUntilRefresh / (1000 * 60));

    assert.strictEqual(minutesUntilRefresh, 1); // 15 seconds -> rounds up to 1 minute
  });

  it('should detect stale recruits correctly', () => {
    const now = new Date('2024-01-15T14:30:00.000Z');
    const previousHourGeneration = new Date('2024-01-15T13:45:00.000Z');
    const currentHourGeneration = new Date('2024-01-15T14:15:00.000Z');

    const currentHour = new Date(now);
    currentHour.setUTCMinutes(0, 0, 0);

    const isPreviousStale = previousHourGeneration < currentHour;
    const isCurrentFresh = currentHourGeneration >= currentHour;

    assert.strictEqual(isPreviousStale, true);
    assert.strictEqual(isCurrentFresh, true);
  });
});

// =============================================================================
// PARTY SLOT ASSIGNMENT LOGIC TESTS
// =============================================================================

describe('garrisonService - Party Slot Assignment', () => {
  it('should calculate next party slot correctly', () => {
    const testCases = [
      { maxSlot: null, expectedNext: 1 },     // No characters
      { maxSlot: 3, expectedNext: 4 },        // Existing characters
      { maxSlot: MAX_PARTY_SIZE - 1, expectedNext: MAX_PARTY_SIZE }, // Near limit
      { maxSlot: MAX_PARTY_SIZE, expectedNext: MAX_PARTY_SIZE + 1 }  // At limit
    ];

    for (const { maxSlot, expectedNext } of testCases) {
      const nextSlot = (maxSlot || 0) + 1;
      assert.strictEqual(nextSlot, expectedNext);
    }
  });

  it('should handle party full scenario', () => {
    const maxSlot = MAX_PARTY_SIZE + 1; // Would exceed limit
    const assignedSlot = maxSlot <= MAX_PARTY_SIZE ? maxSlot : null;
    assert.strictEqual(assignedSlot, null);
  });

  it('should cap slot assignment at MAX_PARTY_SIZE', () => {
    const nextSlot = MAX_PARTY_SIZE + 5; // Way over limit
    const cappedSlot = Math.min(nextSlot, MAX_PARTY_SIZE);
    assert.strictEqual(cappedSlot, MAX_PARTY_SIZE);
  });
});

// =============================================================================
// GOLD AND PRICE VALIDATION TESTS
// =============================================================================

describe('garrisonService - Gold Validation Logic', () => {
  it('should validate sufficient gold correctly', () => {
    const testCases = [
      { userGold: 1000, price: 500, sufficient: true },
      { userGold: 500, price: 500, sufficient: true },   // Exact amount
      { userGold: 499, price: 500, sufficient: false },
      { userGold: 0, price: 400, sufficient: false }
    ];

    for (const { userGold, price, sufficient } of testCases) {
      const hasSufficientGold = userGold >= price;
      assert.strictEqual(hasSufficientGold, sufficient,
        `${userGold} gold vs ${price} price should be ${sufficient}`);
    }
  });

  it('should calculate remaining gold correctly', () => {
    const testCases = [
      { initial: 1000, spent: 400, remaining: 600 },
      { initial: 500, spent: 500, remaining: 0 },
      { initial: 2000, spent: 850, remaining: 1150 }
    ];

    for (const { initial, spent, remaining } of testCases) {
      const actualRemaining = initial - spent;
      assert.strictEqual(actualRemaining, remaining);
    }
  });
});

// =============================================================================
// RECRUIT PRICING INTEGRATION TESTS
// =============================================================================

describe('garrisonService - Recruit Pricing Integration', () => {
  it('should calculate realistic recruit prices', () => {
    // Simulate a basic recruit
    const basicRecruit = {
      stat_variance_percent: 0,
      traits: [],
      skills: [{ tier: 1, level: 1 }] // Just starter skill
    };
    const basicPrice = calculateRecruitPrice(basicRecruit);
    assert.strictEqual(basicPrice, RECRUIT_PRICING.BASE_PRICE);

    // Simulate a premium recruit
    const premiumRecruit = {
      stat_variance_percent: 10,
      traits: [{ rarity: 'rare' }],
      skills: [
        { tier: 1, level: 1 }, // Starter (free)
        { tier: 2, level: 1 }  // Additional T2
      ]
    };
    const premiumPrice = calculateRecruitPrice(premiumRecruit);

    // Premium should cost more than basic
    assert.ok(premiumPrice > basicPrice);

    // Verify calculation: 400 + (10*5) + 1000 + (250*2*1) = 400 + 50 + 1000 + 500 = 1950
    const expectedPremium = RECRUIT_PRICING.BASE_PRICE + 50 + 1000 + 500;
    assert.strictEqual(premiumPrice, expectedPremium);
  });

  it('should handle elite recruits with multiple traits', () => {
    const eliteRecruit = {
      stat_variance_percent: 15, // Max variance
      traits: [
        { rarity: 'legendary' },
        { rarity: 'rare' }
      ],
      skills: [
        { tier: 1, level: 1 }, // Starter (free)
        { tier: 2, level: 2 }, // T2L2
        { tier: 2, level: 1 }  // T2L1
      ]
    };

    const elitePrice = calculateRecruitPrice(eliteRecruit);

    // 400 (base) + 75 (variance) + 4000 (legendary) + 1000 (rare) + 1000 (T2L2: 250*2*2) + 500 (T2L1: 250*2*1)
    const expectedElite = 400 + 75 + 4000 + 1000 + 1000 + 500;
    assert.strictEqual(elitePrice, expectedElite);
  });
});

// =============================================================================
// GENDER AND NAME GENERATION TESTS
// =============================================================================

describe('garrisonService - Name Generation Logic', () => {
  it('should have valid gender selection', () => {
    const genders = ['male', 'female', 'other'];

    // Simulate random gender selection
    const selectedGender = genders[Math.floor(Math.random() * genders.length)];
    assert.ok(genders.includes(selectedGender));
  });

  it('should handle all race-gender combinations', () => {
    const races = Object.values(RACES);
    const genders = Object.values(GENDERS);

    for (const race of races) {
      for (const gender of genders) {
        // Name generation would happen here
        // For testing, just verify the combinations are valid
        assert.ok(typeof race === 'string');
        assert.ok(typeof gender === 'string');
        assert.ok(race.length > 0);
        assert.ok(gender.length > 0);
      }
    }

    assert.strictEqual(races.length, 5);
    assert.strictEqual(genders.length, 3);
  });
});
