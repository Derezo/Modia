/**
 * Achievement Service Unit Tests
 * Tests for PvP achievement badge logic
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';

import {
  ACHIEVEMENT_BADGES,
  getStreakBadge,
  getUserBadges,
  getPriorityBadges
} from '../../../../shared/coliseum.js';

import {
  isTierAtLeast,
  analyzeBattleOutcome,
  GIANT_SLAYER_ELO_DIFF,
  UNDERDOG_PPR_THRESHOLD,
  WIN_THRESHOLDS,
  TIER_BADGES
} from '../../services/achievementService.js';

describe('Achievement Service', () => {
  describe('ACHIEVEMENT_BADGES definitions', () => {
    test('should have all milestone badges defined', () => {
      assert.ok(ACHIEVEMENT_BADGES.first_blood);
      assert.ok(ACHIEVEMENT_BADGES.veteran);
      assert.ok(ACHIEVEMENT_BADGES.legend);
      assert.ok(ACHIEVEMENT_BADGES.climber);
      assert.ok(ACHIEVEMENT_BADGES.elite);
      assert.ok(ACHIEVEMENT_BADGES.champion);
    });

    test('should have all skill badges defined', () => {
      assert.ok(ACHIEVEMENT_BADGES.giant_slayer);
      assert.ok(ACHIEVEMENT_BADGES.underdog);
      assert.ok(ACHIEVEMENT_BADGES.flawless);
      assert.ok(ACHIEVEMENT_BADGES.comeback);
    });

    test('should have all streak badges defined', () => {
      assert.ok(ACHIEVEMENT_BADGES.on_fire);
      assert.ok(ACHIEVEMENT_BADGES.unstoppable);
      assert.ok(ACHIEVEMENT_BADGES.dominating);
    });

    test('each badge should have required properties', () => {
      for (const [key, badge] of Object.entries(ACHIEVEMENT_BADGES)) {
        assert.ok(badge.name, `${key} should have name`);
        assert.ok(badge.icon, `${key} should have icon`);
        assert.ok(badge.description, `${key} should have description`);
        assert.ok(badge.type, `${key} should have type`);
      }
    });
  });

  describe('getStreakBadge', () => {
    test('should return null for streak < 3', () => {
      assert.strictEqual(getStreakBadge(0), null);
      assert.strictEqual(getStreakBadge(1), null);
      assert.strictEqual(getStreakBadge(2), null);
    });

    test('should return on_fire for streak 3-4', () => {
      const badge = getStreakBadge(3);
      assert.strictEqual(badge.key, 'on_fire');
      assert.strictEqual(badge.name, 'On Fire');

      const badge4 = getStreakBadge(4);
      assert.strictEqual(badge4.key, 'on_fire');
    });

    test('should return unstoppable for streak 5-9', () => {
      const badge = getStreakBadge(5);
      assert.strictEqual(badge.key, 'unstoppable');
      assert.strictEqual(badge.name, 'Unstoppable');

      const badge9 = getStreakBadge(9);
      assert.strictEqual(badge9.key, 'unstoppable');
    });

    test('should return dominating for streak 10+', () => {
      const badge = getStreakBadge(10);
      assert.strictEqual(badge.key, 'dominating');
      assert.strictEqual(badge.name, 'Dominating');

      const badge100 = getStreakBadge(100);
      assert.strictEqual(badge100.key, 'dominating');
    });
  });

  describe('getUserBadges', () => {
    test('should return empty array for no achievements', () => {
      const badges = getUserBadges([], 0);
      assert.strictEqual(badges.length, 0);
    });

    test('should include stored achievements', () => {
      const achievements = [
        { achievement_key: 'first_blood', earned_at: '2026-01-01' }
      ];
      const badges = getUserBadges(achievements, 0);
      assert.strictEqual(badges.length, 1);
      assert.strictEqual(badges[0].key, 'first_blood');
      assert.strictEqual(badges[0].earnedAt, '2026-01-01');
    });

    test('should include dynamic streak badge', () => {
      const badges = getUserBadges([], 5);
      assert.strictEqual(badges.length, 1);
      assert.strictEqual(badges[0].key, 'unstoppable');
      assert.strictEqual(badges[0].isDynamic, true);
    });

    test('should combine stored and dynamic badges', () => {
      const achievements = [
        { achievement_key: 'first_blood', earned_at: '2026-01-01' },
        { achievement_key: 'veteran', earned_at: '2026-01-15' }
      ];
      const badges = getUserBadges(achievements, 10);
      assert.strictEqual(badges.length, 3);

      const keys = badges.map(b => b.key);
      assert.ok(keys.includes('first_blood'));
      assert.ok(keys.includes('veteran'));
      assert.ok(keys.includes('dominating'));
    });
  });

  describe('getPriorityBadges', () => {
    test('should limit to maxBadges', () => {
      const badges = [
        { key: 'first_blood', type: 'milestone' },
        { key: 'veteran', type: 'milestone' },
        { key: 'legend', type: 'milestone' },
        { key: 'giant_slayer', type: 'skill' }
      ];
      const priority = getPriorityBadges(badges, 3);
      assert.strictEqual(priority.length, 3);
    });

    test('should prioritize streak badges over all others', () => {
      const badges = [
        { key: 'champion', type: 'milestone' },
        { key: 'dominating', type: 'streak', minStreak: 10 },
        { key: 'giant_slayer', type: 'skill' }
      ];
      const priority = getPriorityBadges(badges, 1);
      assert.strictEqual(priority[0].key, 'dominating');
    });

    test('should prioritize tier badges after streak', () => {
      const badges = [
        { key: 'first_blood', type: 'milestone' },
        { key: 'champion', type: 'milestone' },
        { key: 'giant_slayer', type: 'skill' }
      ];
      const priority = getPriorityBadges(badges, 2);
      assert.strictEqual(priority[0].key, 'champion');
    });

    test('should prioritize skill badges after tier', () => {
      const badges = [
        { key: 'first_blood', type: 'milestone' },
        { key: 'giant_slayer', type: 'skill' }
      ];
      const priority = getPriorityBadges(badges, 1);
      assert.strictEqual(priority[0].key, 'giant_slayer');
    });
  });

  describe('isTierAtLeast', () => {
    test('should return true for same tier', () => {
      assert.strictEqual(isTierAtLeast('Gold', 'Gold'), true);
      assert.strictEqual(isTierAtLeast('Grandmaster', 'Grandmaster'), true);
    });

    test('should return true for higher tier', () => {
      assert.strictEqual(isTierAtLeast('Gold', 'Bronze'), true);
      assert.strictEqual(isTierAtLeast('Grandmaster', 'Master'), true);
      assert.strictEqual(isTierAtLeast('Master', 'Gold'), true);
    });

    test('should return false for lower tier', () => {
      assert.strictEqual(isTierAtLeast('Bronze', 'Gold'), false);
      assert.strictEqual(isTierAtLeast('Silver', 'Master'), false);
      assert.strictEqual(isTierAtLeast('Gold', 'Grandmaster'), false);
    });

    test('should return false for invalid tier', () => {
      assert.strictEqual(isTierAtLeast('InvalidTier', 'Gold'), false);
      assert.strictEqual(isTierAtLeast('Gold', 'InvalidTier'), false);
    });
  });

  describe('analyzeBattleOutcome', () => {
    test('should detect flawless victory', () => {
      const battleState = {
        player1Id: 1,
        player2Id: 2,
        units: [
          { ownerId: 1, hp: 100 },
          { ownerId: 1, hp: 100 },
          { ownerId: 2, hp: 0 },
          { ownerId: 2, hp: 0 }
        ]
      };
      const result = analyzeBattleOutcome(battleState);
      assert.strictEqual(result.flawless, true);
      assert.strictEqual(result.comeback, false);
    });

    test('should detect non-flawless victory', () => {
      const battleState = {
        player1Id: 1,
        player2Id: 2,
        units: [
          { ownerId: 1, hp: 100 },
          { ownerId: 1, hp: 0 },  // One unit died
          { ownerId: 2, hp: 0 },
          { ownerId: 2, hp: 0 }
        ]
      };
      const result = analyzeBattleOutcome(battleState);
      assert.strictEqual(result.flawless, false);
    });

    test('should detect comeback (50%+ units lost)', () => {
      const battleState = {
        player1Id: 1,
        player2Id: 2,
        units: [
          { ownerId: 1, hp: 50 },
          { ownerId: 1, hp: 0 },  // Lost 1 of 2 = 50%
          { ownerId: 2, hp: 0 },
          { ownerId: 2, hp: 0 }
        ]
      };
      const result = analyzeBattleOutcome(battleState);
      assert.strictEqual(result.comeback, true);
    });

    test('should return false for both if battle not conclusive', () => {
      const battleState = {
        player1Id: 1,
        player2Id: 2,
        units: [
          { ownerId: 1, hp: 100 },
          { ownerId: 2, hp: 100 }  // Both teams have survivors
        ]
      };
      const result = analyzeBattleOutcome(battleState);
      assert.strictEqual(result.flawless, false);
      assert.strictEqual(result.comeback, false);
    });
  });

  describe('Constants', () => {
    test('GIANT_SLAYER_ELO_DIFF should be 200', () => {
      assert.strictEqual(GIANT_SLAYER_ELO_DIFF, 200);
    });

    test('UNDERDOG_PPR_THRESHOLD should be 0.20', () => {
      assert.strictEqual(UNDERDOG_PPR_THRESHOLD, 0.20);
    });

    test('WIN_THRESHOLDS should have correct values', () => {
      assert.strictEqual(WIN_THRESHOLDS.first_blood, 1);
      assert.strictEqual(WIN_THRESHOLDS.veteran, 50);
      assert.strictEqual(WIN_THRESHOLDS.legend, 200);
    });

    test('TIER_BADGES should have correct mappings', () => {
      assert.strictEqual(TIER_BADGES.climber, 'Gold');
      assert.strictEqual(TIER_BADGES.elite, 'Master');
      assert.strictEqual(TIER_BADGES.champion, 'Grandmaster');
    });
  });
});
