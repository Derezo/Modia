/**
 * Tests for Coliseum tier system
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  getTier,
  getTierName,
  getTierColor,
  isInTier,
  getNextTierProgress,
  getAllTiers,
  getTierIcon,
  COLISEUM_TIERS,
  TIER_ICONS
} from './coliseum.js';

describe('Coliseum Tier System', () => {
  describe('getTier', () => {
    test('returns Unranked for ratings below 1000', () => {
      assert.strictEqual(getTier(0).name, 'Unranked');
      assert.strictEqual(getTier(500).name, 'Unranked');
      assert.strictEqual(getTier(999).name, 'Unranked');
    });

    test('returns Bronze for ratings 1000-1199', () => {
      assert.strictEqual(getTier(1000).name, 'Bronze');
      assert.strictEqual(getTier(1100).name, 'Bronze');
      assert.strictEqual(getTier(1199).name, 'Bronze');
    });

    test('returns Silver for ratings 1200-1399', () => {
      assert.strictEqual(getTier(1200).name, 'Silver');
      assert.strictEqual(getTier(1300).name, 'Silver');
      assert.strictEqual(getTier(1399).name, 'Silver');
    });

    test('returns Gold for ratings 1400-1599', () => {
      assert.strictEqual(getTier(1400).name, 'Gold');
      assert.strictEqual(getTier(1500).name, 'Gold');
      assert.strictEqual(getTier(1599).name, 'Gold');
    });

    test('returns Platinum for ratings 1600-1799', () => {
      assert.strictEqual(getTier(1600).name, 'Platinum');
      assert.strictEqual(getTier(1700).name, 'Platinum');
      assert.strictEqual(getTier(1799).name, 'Platinum');
    });

    test('returns Master for ratings 1800-1999', () => {
      assert.strictEqual(getTier(1800).name, 'Master');
      assert.strictEqual(getTier(1900).name, 'Master');
      assert.strictEqual(getTier(1999).name, 'Master');
    });

    test('returns Grandmaster for ratings 2000+', () => {
      assert.strictEqual(getTier(2000).name, 'Grandmaster');
      assert.strictEqual(getTier(2500).name, 'Grandmaster');
      assert.strictEqual(getTier(3000).name, 'Grandmaster');
    });

    test('returns correct colors for each tier', () => {
      assert.strictEqual(getTier(500).color, '#6a6a6a');    // Unranked - Gray
      assert.strictEqual(getTier(1000).color, '#cd7f32');   // Bronze
      assert.strictEqual(getTier(1200).color, '#a8a8a8');   // Silver
      assert.strictEqual(getTier(1400).color, '#b8956a');   // Gold
      assert.strictEqual(getTier(1600).color, '#7ec8e8');   // Platinum - Ice blue
      assert.strictEqual(getTier(1800).color, '#9a6ab8');   // Master - Purple
      assert.strictEqual(getTier(2000).color, '#c45a5a');   // Grandmaster - Crimson
    });

    test('returns correct icons for each tier', () => {
      assert.strictEqual(getTier(500).icon, null);          // Unranked - no icon
      assert.strictEqual(getTier(1000).icon, 'shield');     // Bronze
      assert.strictEqual(getTier(1200).icon, 'swords');     // Silver
      assert.strictEqual(getTier(1400).icon, 'crown');      // Gold
      assert.strictEqual(getTier(1600).icon, 'diamond');    // Platinum
      assert.strictEqual(getTier(1800).icon, 'star');       // Master
      assert.strictEqual(getTier(2000).icon, 'trophy');     // Grandmaster
    });
  });

  describe('getTierName', () => {
    test('returns tier name string', () => {
      assert.strictEqual(getTierName(999), 'Unranked');
      assert.strictEqual(getTierName(1000), 'Bronze');
      assert.strictEqual(getTierName(2000), 'Grandmaster');
    });
  });

  describe('getTierColor', () => {
    test('returns tier color hex string', () => {
      assert.strictEqual(getTierColor(1000), '#cd7f32');
      assert.strictEqual(getTierColor(2000), '#c45a5a');
    });
  });

  describe('isInTier', () => {
    test('returns true when rating is in specified tier', () => {
      assert.strictEqual(isInTier(1050, 'Bronze'), true);
      assert.strictEqual(isInTier(1500, 'Gold'), true);
    });

    test('returns false when rating is not in specified tier', () => {
      assert.strictEqual(isInTier(1050, 'Silver'), false);
      assert.strictEqual(isInTier(2000, 'Bronze'), false);
    });

    test('returns false for invalid tier name', () => {
      assert.strictEqual(isInTier(1000, 'InvalidTier'), false);
    });
  });

  describe('getNextTierProgress', () => {
    test('returns next tier and points needed', () => {
      const progress = getNextTierProgress(1150);
      assert.strictEqual(progress.nextTier.name, 'Silver');
      assert.strictEqual(progress.pointsNeeded, 50);
    });

    test('returns null for Grandmaster tier', () => {
      const progress = getNextTierProgress(2500);
      assert.strictEqual(progress, null);
    });

    test('returns Bronze as next tier for Unranked', () => {
      const progress = getNextTierProgress(500);
      assert.strictEqual(progress.nextTier.name, 'Bronze');
      assert.strictEqual(progress.pointsNeeded, 500);
    });
  });

  describe('getAllTiers', () => {
    test('returns all 7 tiers', () => {
      const tiers = getAllTiers();
      assert.strictEqual(tiers.length, 7);
    });

    test('returns tiers in descending order by minRating', () => {
      const tiers = getAllTiers();
      assert.strictEqual(tiers[0].name, 'Grandmaster');
      assert.strictEqual(tiers[6].name, 'Unranked');
    });
  });

  describe('getTierIcon', () => {
    test('returns unicode character for valid icon names', () => {
      assert.strictEqual(getTierIcon('trophy'), '\u{1F3C6}');
      assert.strictEqual(getTierIcon('star'), '\u{2B50}');
      assert.strictEqual(getTierIcon('shield'), '\u{1F6E1}');
    });

    test('returns empty string for null or invalid icon names', () => {
      assert.strictEqual(getTierIcon(null), '');
      assert.strictEqual(getTierIcon('invalid'), '');
    });
  });

  describe('COLISEUM_TIERS constant', () => {
    test('has all required tiers', () => {
      assert.ok(COLISEUM_TIERS.GRANDMASTER);
      assert.ok(COLISEUM_TIERS.MASTER);
      assert.ok(COLISEUM_TIERS.PLATINUM);
      assert.ok(COLISEUM_TIERS.GOLD);
      assert.ok(COLISEUM_TIERS.SILVER);
      assert.ok(COLISEUM_TIERS.BRONZE);
      assert.ok(COLISEUM_TIERS.UNRANKED);
    });

    test('each tier has required properties', () => {
      Object.values(COLISEUM_TIERS).forEach(tier => {
        assert.ok(typeof tier.name === 'string');
        assert.ok(typeof tier.minRating === 'number');
        assert.ok(typeof tier.color === 'string');
        // icon can be string or null
        assert.ok(tier.icon === null || typeof tier.icon === 'string');
      });
    });
  });
});
