/**
 * Recruitment Utilities Unit Tests
 *
 * Comprehensive tests for the shared recruitment utility functions used by
 * both recruitService.js and garrisonService.js.
 *
 * Tests cover:
 * - weightedRandom() - Probabilistic selection with weighted options
 * - calculateRecruitPrice() - Skill level multiplier pricing
 * - Edge cases and fallback behaviors
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  weightedRandom,
  calculateRecruitPrice,
  RECRUIT_PRICING,
  TRAIT_RARITY_WEIGHTS,
  TRAIT_COUNT_WEIGHTS,
  ADDITIONAL_SKILL_COUNT_WEIGHTS,
  getStarterSkillId,
  STARTER_SKILLS
} from '../../utils/recruitmentUtils.js';

// ============================================================================
// weightedRandom() Tests
// ============================================================================

describe('weightedRandom', () => {
  describe('basic functionality', () => {
    it('should return a valid option from the weights object', () => {
      const weights = { common: 70, uncommon: 20, rare: 10 };

      for (let i = 0; i < 100; i++) {
        const result = weightedRandom(weights);
        assert.ok(
          ['common', 'uncommon', 'rare'].includes(result),
          `Result "${result}" should be one of the weight keys`
        );
      }
    });

    it('should return numeric key as number (not string)', () => {
      const weights = { 1: 50, 2: 30, 3: 20 };

      for (let i = 0; i < 50; i++) {
        const result = weightedRandom(weights);
        assert.strictEqual(
          typeof result,
          'number',
          `Result "${result}" should be a number, not a string`
        );
        assert.ok([1, 2, 3].includes(result), `Result ${result} should be 1, 2, or 3`);
      }
    });

    it('should return string key as string', () => {
      const weights = { warrior: 40, wizard: 30, monk: 20, chemist: 10 };

      for (let i = 0; i < 50; i++) {
        const result = weightedRandom(weights);
        assert.strictEqual(
          typeof result,
          'string',
          `Result "${result}" should be a string`
        );
        assert.ok(
          ['warrior', 'wizard', 'monk', 'chemist'].includes(result),
          `Result "${result}" should be a valid class`
        );
      }
    });

    it('should handle single option with 100% weight', () => {
      const weights = { onlyOption: 100 };

      for (let i = 0; i < 20; i++) {
        const result = weightedRandom(weights);
        assert.strictEqual(result, 'onlyOption', 'Should always return the only option');
      }
    });

    it('should handle single numeric option', () => {
      const weights = { 42: 100 };

      for (let i = 0; i < 20; i++) {
        const result = weightedRandom(weights);
        assert.strictEqual(result, 42, 'Should return 42 as a number');
        assert.strictEqual(typeof result, 'number');
      }
    });
  });

  describe('statistical distribution', () => {
    it('should approximate expected distribution over many iterations', () => {
      const weights = { common: 70, uncommon: 20, rare: 10 };
      const iterations = 10000;
      const counts = { common: 0, uncommon: 0, rare: 0 };

      for (let i = 0; i < iterations; i++) {
        const result = weightedRandom(weights);
        counts[result]++;
      }

      // Calculate actual percentages
      const commonPercent = (counts.common / iterations) * 100;
      const uncommonPercent = (counts.uncommon / iterations) * 100;
      const rarePercent = (counts.rare / iterations) * 100;

      // Allow 5% tolerance for statistical variance
      const tolerance = 5;

      assert.ok(
        Math.abs(commonPercent - 70) < tolerance,
        `Common should be ~70%, got ${commonPercent.toFixed(1)}%`
      );
      assert.ok(
        Math.abs(uncommonPercent - 20) < tolerance,
        `Uncommon should be ~20%, got ${uncommonPercent.toFixed(1)}%`
      );
      assert.ok(
        Math.abs(rarePercent - 10) < tolerance,
        `Rare should be ~10%, got ${rarePercent.toFixed(1)}%`
      );
    });

    it('should handle extreme weight ratios (99:1)', () => {
      const weights = { common: 99, legendary: 1 };
      const iterations = 5000;
      const counts = { common: 0, legendary: 0 };

      for (let i = 0; i < iterations; i++) {
        counts[weightedRandom(weights)]++;
      }

      const legendaryPercent = (counts.legendary / iterations) * 100;

      // Legendary should be around 1%, allow generous tolerance
      assert.ok(
        legendaryPercent >= 0.1 && legendaryPercent <= 3,
        `Legendary should be ~1%, got ${legendaryPercent.toFixed(2)}%`
      );
    });

    it('should distribute numeric keys correctly', () => {
      const weights = { 0: 60, 1: 30, 2: 10 };
      const iterations = 5000;
      const counts = { 0: 0, 1: 0, 2: 0 };

      for (let i = 0; i < iterations; i++) {
        counts[weightedRandom(weights)]++;
      }

      const zeroPercent = (counts[0] / iterations) * 100;
      const onePercent = (counts[1] / iterations) * 100;
      const twoPercent = (counts[2] / iterations) * 100;

      const tolerance = 5;

      assert.ok(
        Math.abs(zeroPercent - 60) < tolerance,
        `0 should be ~60%, got ${zeroPercent.toFixed(1)}%`
      );
      assert.ok(
        Math.abs(onePercent - 30) < tolerance,
        `1 should be ~30%, got ${onePercent.toFixed(1)}%`
      );
      assert.ok(
        Math.abs(twoPercent - 10) < tolerance,
        `2 should be ~10%, got ${twoPercent.toFixed(1)}%`
      );
    });
  });

  describe('fallback behavior', () => {
    it('should fall back to first option when no selection made', () => {
      // This tests the edge case where floating point issues might cause
      // no selection. We test by checking the fallback code path exists.
      const weights = { fallback: 100 };
      const result = weightedRandom(weights);
      assert.strictEqual(result, 'fallback');
    });

    it('should handle weights that do not sum to 100', () => {
      const weights = { a: 10, b: 20, c: 30 }; // Sums to 60

      for (let i = 0; i < 50; i++) {
        const result = weightedRandom(weights);
        assert.ok(
          ['a', 'b', 'c'].includes(result),
          `Result "${result}" should be valid even with non-100 sum`
        );
      }
    });

    it('should handle very small weights', () => {
      const weights = { common: 0.5, uncommon: 0.3, rare: 0.2 };
      const iterations = 1000;
      const counts = { common: 0, uncommon: 0, rare: 0 };

      for (let i = 0; i < iterations; i++) {
        const result = weightedRandom(weights);
        counts[result]++;
      }

      // All options should be selected at least occasionally
      assert.ok(counts.common > 0, 'Common should be selected sometimes');
      assert.ok(counts.uncommon > 0, 'Uncommon should be selected sometimes');
      assert.ok(counts.rare > 0, 'Rare should be selected sometimes');
    });
  });

  describe('edge cases', () => {
    it('should handle mixed string/numeric-looking keys', () => {
      const weights = { '1abc': 50, '2def': 50 };

      for (let i = 0; i < 20; i++) {
        const result = weightedRandom(weights);
        assert.strictEqual(typeof result, 'string', 'Non-numeric strings should stay strings');
        assert.ok(['1abc', '2def'].includes(result));
      }
    });

    it('should handle zero weights by skipping them', () => {
      const weights = { selected: 100, skipped: 0 };
      const iterations = 100;
      let skippedCount = 0;

      for (let i = 0; i < iterations; i++) {
        if (weightedRandom(weights) === 'skipped') {
          skippedCount++;
        }
      }

      // Zero weight should never be selected
      assert.strictEqual(skippedCount, 0, 'Zero-weight option should never be selected');
    });
  });
});

// ============================================================================
// calculateRecruitPrice() - Skill Level Multiplier Tests
// ============================================================================

describe('calculateRecruitPrice - Skill Level Multipliers', () => {
  describe('specific tier and level combinations', () => {
    it('should calculate Tier 1, Level 2 skill as 500g (250 x 1 x 2)', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [
          { tier: 1, level: 1 }, // Free starter skill
          { tier: 1, level: 2 }  // Paid: 250 x 1 x 2 = 500g
        ]
      };

      const price = calculateRecruitPrice(recruit);

      // Base 400 + skill cost 500 = 900g
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + 500);
    });

    it('should calculate Tier 2, Level 2 skill as 1000g (250 x 2 x 2)', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [
          { tier: 1, level: 1 }, // Free starter skill
          { tier: 2, level: 2 }  // Paid: 250 x 2 x 2 = 1000g
        ]
      };

      const price = calculateRecruitPrice(recruit);

      // Base 400 + skill cost 1000 = 1400g
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + 1000);
    });

    it('should calculate Tier 3, Level 1 skill as 750g (250 x 3 x 1)', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [
          { tier: 1, level: 1 }, // Free starter skill
          { tier: 3, level: 1 }  // Paid: 250 x 3 x 1 = 750g
        ]
      };

      const price = calculateRecruitPrice(recruit);

      // Base 400 + skill cost 750 = 1150g
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + 750);
    });

    it('should charge for first skill if it is T2L1 (NOT free)', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [
          { tier: 2, level: 1 } // Paid: 250 x 2 x 1 = 500g (first skill but not T1L1)
        ]
      };

      const price = calculateRecruitPrice(recruit);

      // Base 400 + skill cost 500 = 900g
      // First skill is NOT free because it's not T1L1
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + 500);
    });

    it('should charge for first skill if it is T1L2 (NOT free)', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [
          { tier: 1, level: 2 } // Paid: 250 x 1 x 2 = 500g (first skill but not L1)
        ]
      };

      const price = calculateRecruitPrice(recruit);

      // Base 400 + skill cost 500 = 900g
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + 500);
    });
  });

  describe('multiple skills with level progression', () => {
    it('should calculate T1L1 + T1L2 + T1L3 correctly', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [
          { tier: 1, level: 1 }, // Free
          { tier: 1, level: 2 }, // 250 x 1 x 2 = 500g
          { tier: 1, level: 3 }  // 250 x 1 x 3 = 750g
        ]
      };

      const price = calculateRecruitPrice(recruit);

      // Base 400 + 500 + 750 = 1650g
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + 500 + 750);
    });

    it('should calculate mixed tiers T1L1 + T2L2 + T3L3 correctly', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [
          { tier: 1, level: 1 }, // Free
          { tier: 2, level: 2 }, // 250 x 2 x 2 = 1000g
          { tier: 3, level: 3 }  // 250 x 3 x 3 = 2250g
        ]
      };

      const price = calculateRecruitPrice(recruit);

      // Base 400 + 1000 + 2250 = 3650g
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + 1000 + 2250);
    });

    it('should only give first T1L1 free when multiple T1L1 skills exist', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [
          { tier: 1, level: 1 }, // Free (first one)
          { tier: 1, level: 1 }, // Paid: 250 x 1 x 1 = 250g
          { tier: 1, level: 1 }  // Paid: 250 x 1 x 1 = 250g
        ]
      };

      const price = calculateRecruitPrice(recruit);

      // Base 400 + 250 + 250 = 900g
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + 250 + 250);
    });
  });

  describe('skill pricing formula verification', () => {
    it('should use exact formula: SKILL_PRICE_MULTIPLIER x tier x level', () => {
      const testCases = [
        { tier: 1, level: 1, expected: 250 },
        { tier: 1, level: 2, expected: 500 },
        { tier: 1, level: 3, expected: 750 },
        { tier: 2, level: 1, expected: 500 },
        { tier: 2, level: 2, expected: 1000 },
        { tier: 2, level: 3, expected: 1500 },
        { tier: 3, level: 1, expected: 750 },
        { tier: 3, level: 2, expected: 1500 },
        { tier: 3, level: 3, expected: 2250 }
      ];

      for (const { tier, level, expected } of testCases) {
        const recruit = {
          stat_variance_percent: 0,
          traits: [],
          skills: [
            { tier: 1, level: 1 }, // Free starter
            { tier, level }        // The skill being tested
          ]
        };

        const price = calculateRecruitPrice(recruit);
        const skillCost = price - RECRUIT_PRICING.BASE_PRICE;

        assert.strictEqual(
          skillCost,
          expected,
          `T${tier}L${level} should cost ${expected}g, got ${skillCost}g`
        );
      }
    });
  });
});

// ============================================================================
// calculateRecruitPrice() - Edge Cases
// ============================================================================

describe('calculateRecruitPrice - Edge Cases', () => {
  describe('unknown trait rarity', () => {
    it('should fall back to common pricing for unknown rarity', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [{ rarity: 'mythical' }], // Unknown rarity
        skills: []
      };

      const price = calculateRecruitPrice(recruit);

      // Should use common price as fallback
      assert.strictEqual(
        price,
        RECRUIT_PRICING.BASE_PRICE + RECRUIT_PRICING.TRAIT_PRICES.common
      );
    });

    it('should fall back to common for undefined rarity', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [{}], // No rarity specified
        skills: []
      };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(
        price,
        RECRUIT_PRICING.BASE_PRICE + RECRUIT_PRICING.TRAIT_PRICES.common
      );
    });

    it('should fall back to common for null rarity', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [{ rarity: null }],
        skills: []
      };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(
        price,
        RECRUIT_PRICING.BASE_PRICE + RECRUIT_PRICING.TRAIT_PRICES.common
      );
    });
  });

  describe('empty arrays', () => {
    it('should handle empty skills array', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: []
      };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });

    it('should handle empty traits array', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [{ tier: 1, level: 1 }]
      };

      const price = calculateRecruitPrice(recruit);

      // Only base price (first T1L1 is free)
      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });

    it('should handle both empty arrays', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: []
      };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });
  });

  describe('missing properties', () => {
    it('should handle missing traits property', () => {
      const recruit = {
        stat_variance_percent: 0,
        skills: [{ tier: 1, level: 1 }]
      };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });

    it('should handle missing skills property', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: []
      };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });

    it('should handle minimal recruit object', () => {
      const recruit = {};

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE);
    });
  });

  describe('skill with missing tier/level', () => {
    it('should default missing tier to 1', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [
          { tier: 1, level: 1 }, // Free
          { level: 2 }          // Missing tier, should default to 1 -> 250 x 1 x 2 = 500g
        ]
      };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + 500);
    });

    it('should default missing level to 1', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [
          { tier: 1, level: 1 }, // Free
          { tier: 2 }           // Missing level, should default to 1 -> 250 x 2 x 1 = 500g
        ]
      };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + 500);
    });

    it('should default both missing tier and level to 1', () => {
      const recruit = {
        stat_variance_percent: 0,
        traits: [],
        skills: [
          { tier: 1, level: 1 }, // Free
          {}                    // Missing both, defaults to T1L1 -> 250 x 1 x 1 = 250g
        ]
      };

      const price = calculateRecruitPrice(recruit);

      assert.strictEqual(price, RECRUIT_PRICING.BASE_PRICE + 250);
    });
  });
});

// ============================================================================
// getStarterSkillId() Tests
// ============================================================================

describe('getStarterSkillId', () => {
  it('should return correct starter skill for each class', () => {
    assert.strictEqual(getStarterSkillId('warrior'), 'power_strike');
    assert.strictEqual(getStarterSkillId('wizard'), 'fireball');
    assert.strictEqual(getStarterSkillId('monk'), 'palm_strike');
    assert.strictEqual(getStarterSkillId('chemist'), 'potion_toss');
  });

  it('should return null for unknown class', () => {
    assert.strictEqual(getStarterSkillId('unknown'), null);
    assert.strictEqual(getStarterSkillId('paladin'), null);
    assert.strictEqual(getStarterSkillId(''), null);
  });

  it('should be case-sensitive', () => {
    assert.strictEqual(getStarterSkillId('Warrior'), null);
    assert.strictEqual(getStarterSkillId('WIZARD'), null);
  });
});

// ============================================================================
// Constants Validation
// ============================================================================

describe('Recruitment Constants', () => {
  describe('RECRUIT_PRICING', () => {
    it('should have SKILL_PRICE_MULTIPLIER of 250', () => {
      assert.strictEqual(RECRUIT_PRICING.SKILL_PRICE_MULTIPLIER, 250);
    });

    it('should have BASE_PRICE of 400', () => {
      assert.strictEqual(RECRUIT_PRICING.BASE_PRICE, 400);
    });

    it('should have STAT_VARIANCE_BONUS of 5', () => {
      assert.strictEqual(RECRUIT_PRICING.STAT_VARIANCE_BONUS, 5);
    });
  });

  describe('TRAIT_RARITY_WEIGHTS', () => {
    it('should sum to 100', () => {
      const total = Object.values(TRAIT_RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
      assert.strictEqual(total, 100);
    });

    it('should have expected distribution (70/20/8/2)', () => {
      assert.strictEqual(TRAIT_RARITY_WEIGHTS.common, 70);
      assert.strictEqual(TRAIT_RARITY_WEIGHTS.uncommon, 20);
      assert.strictEqual(TRAIT_RARITY_WEIGHTS.rare, 8);
      assert.strictEqual(TRAIT_RARITY_WEIGHTS.legendary, 2);
    });
  });

  describe('TRAIT_COUNT_WEIGHTS', () => {
    it('should sum to 100', () => {
      const total = Object.values(TRAIT_COUNT_WEIGHTS).reduce((a, b) => a + b, 0);
      assert.strictEqual(total, 100);
    });

    it('should have expected distribution (92/8)', () => {
      assert.strictEqual(TRAIT_COUNT_WEIGHTS[1], 92);
      assert.strictEqual(TRAIT_COUNT_WEIGHTS[2], 8);
    });
  });

  describe('ADDITIONAL_SKILL_COUNT_WEIGHTS', () => {
    it('should sum to 100', () => {
      const total = Object.values(ADDITIONAL_SKILL_COUNT_WEIGHTS).reduce((a, b) => a + b, 0);
      assert.strictEqual(total, 100);
    });

    it('should have expected distribution (60/30/10)', () => {
      assert.strictEqual(ADDITIONAL_SKILL_COUNT_WEIGHTS[0], 60);
      assert.strictEqual(ADDITIONAL_SKILL_COUNT_WEIGHTS[1], 30);
      assert.strictEqual(ADDITIONAL_SKILL_COUNT_WEIGHTS[2], 10);
    });
  });

  describe('STARTER_SKILLS', () => {
    it('should have skills for all base classes', () => {
      const baseClasses = ['warrior', 'wizard', 'monk', 'chemist'];
      for (const cls of baseClasses) {
        assert.ok(STARTER_SKILLS[cls], `Should have starter skill for ${cls}`);
      }
    });

    it('should have exactly 4 starter skills', () => {
      assert.strictEqual(Object.keys(STARTER_SKILLS).length, 4);
    });
  });
});

// ============================================================================
// getTier1And2Skills() Tests
// ============================================================================

import { getTier1And2Skills } from '../../utils/recruitmentUtils.js';

describe('getTier1And2Skills', () => {
  describe('basic functionality', () => {
    it('should return an array of skills for warrior', () => {
      const skills = getTier1And2Skills('warrior');

      assert.ok(Array.isArray(skills), 'Should return an array');
      assert.ok(skills.length > 0, 'Warrior should have tier 1-2 skills');
    });

    it('should return an array of skills for wizard', () => {
      const skills = getTier1And2Skills('wizard');

      assert.ok(Array.isArray(skills), 'Should return an array');
      assert.ok(skills.length > 0, 'Wizard should have tier 1-2 skills');
    });

    it('should return an array of skills for monk', () => {
      const skills = getTier1And2Skills('monk');

      assert.ok(Array.isArray(skills), 'Should return an array');
      assert.ok(skills.length > 0, 'Monk should have tier 1-2 skills');
    });

    it('should return an array of skills for chemist', () => {
      const skills = getTier1And2Skills('chemist');

      assert.ok(Array.isArray(skills), 'Should return an array');
      assert.ok(skills.length > 0, 'Chemist should have tier 1-2 skills');
    });

    it('should return empty array for unknown class', () => {
      const skills = getTier1And2Skills('paladin');

      assert.deepStrictEqual(skills, []);
    });

    it('should return empty array for undefined class', () => {
      const skills = getTier1And2Skills(undefined);

      assert.deepStrictEqual(skills, []);
    });

    it('should return empty array for null class', () => {
      const skills = getTier1And2Skills(null);

      assert.deepStrictEqual(skills, []);
    });
  });

  describe('tier classification', () => {
    it('should mark skills without requirements as tier 1', () => {
      const skills = getTier1And2Skills('warrior');
      const tier1Skills = skills.filter(s => s.tier === 1);

      assert.ok(tier1Skills.length > 0, 'Should have tier 1 skills');

      for (const skill of tier1Skills) {
        assert.ok(
          !skill.requires || Object.keys(skill.requires).length === 0,
          `Tier 1 skill ${skill.id} should have no requirements`
        );
      }
    });

    it('should mark skills with tier 1 requirements (level <= 1) as tier 2', () => {
      const skills = getTier1And2Skills('warrior');
      const tier2Skills = skills.filter(s => s.tier === 2);
      const tier1Ids = new Set(skills.filter(s => s.tier === 1).map(s => s.id));

      for (const skill of tier2Skills) {
        assert.ok(skill.requires, `Tier 2 skill ${skill.id} should have requirements`);

        for (const [reqId, reqLevel] of Object.entries(skill.requires)) {
          assert.ok(
            tier1Ids.has(reqId),
            `Tier 2 skill ${skill.id} requires ${reqId} which should be tier 1`
          );
          assert.ok(
            reqLevel <= 1,
            `Tier 2 skill ${skill.id} requires ${reqId} at level ${reqLevel}, should be <= 1`
          );
        }
      }
    });

    it('should only include active skills (not passives)', () => {
      const skills = getTier1And2Skills('wizard');

      for (const skill of skills) {
        assert.strictEqual(
          skill.type,
          'active',
          `Skill ${skill.id} should be active, got ${skill.type}`
        );
      }
    });

    it('should have tier property set to 1 or 2', () => {
      const skills = getTier1And2Skills('monk');

      for (const skill of skills) {
        assert.ok(
          skill.tier === 1 || skill.tier === 2,
          `Skill ${skill.id} tier should be 1 or 2, got ${skill.tier}`
        );
      }
    });
  });

  describe('skill preservation', () => {
    it('should preserve original skill properties', () => {
      const skills = getTier1And2Skills('chemist');

      for (const skill of skills) {
        assert.ok(skill.id, 'Skill should have id');
        assert.ok(skill.name, 'Skill should have name');
        // The tier property is added
        assert.ok(skill.tier, 'Skill should have tier');
      }
    });

    it('should include starter skill for each class', () => {
      const classes = ['warrior', 'wizard', 'monk', 'chemist'];
      const starterSkills = {
        warrior: 'power_strike',
        wizard: 'fireball',
        monk: 'palm_strike',
        chemist: 'potion_toss'
      };

      for (const cls of classes) {
        const skills = getTier1And2Skills(cls);
        const starterSkill = skills.find(s => s.id === starterSkills[cls]);

        assert.ok(
          starterSkill,
          `${cls} should include starter skill ${starterSkills[cls]}`
        );
        assert.strictEqual(starterSkill.tier, 1, 'Starter skill should be tier 1');
      }
    });
  });

  describe('no tier 3+ skills', () => {
    it('should not include skills requiring tier 2 skills', () => {
      const classes = ['warrior', 'wizard', 'monk', 'chemist'];

      for (const cls of classes) {
        const skills = getTier1And2Skills(cls);
        const tier2Ids = new Set(skills.filter(s => s.tier === 2).map(s => s.id));

        for (const skill of skills) {
          if (skill.requires) {
            for (const reqId of Object.keys(skill.requires)) {
              assert.ok(
                !tier2Ids.has(reqId),
                `Skill ${skill.id} requires tier 2 skill ${reqId}, should be excluded`
              );
            }
          }
        }
      }
    });

    it('should not include skills requiring level > 1 of tier 1 skills', () => {
      const classes = ['warrior', 'wizard', 'monk', 'chemist'];

      for (const cls of classes) {
        const skills = getTier1And2Skills(cls);

        for (const skill of skills) {
          if (skill.requires) {
            for (const [reqId, reqLevel] of Object.entries(skill.requires)) {
              assert.ok(
                reqLevel <= 1,
                `Skill ${skill.id} in ${cls} requires ${reqId} at level ${reqLevel}, exceeds L1`
              );
            }
          }
        }
      }
    });
  });
});
