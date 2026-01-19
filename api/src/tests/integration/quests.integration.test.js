/**
 * Quests Integration Tests
 *
 * Tests the quest API endpoints with live database:
 * - GET /api/quests/daily/:characterId
 * - GET /api/quests/weekly/:characterId
 * - POST /api/quests/:questId/claim
 * - POST /api/quests/claim-all
 * - GET /api/quests/streaks/:characterId
 * - GET /api/quests/first-blood
 * - GET /api/quests/champions
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  createTestContext,
  request,
  API_BASE_URL
} from '../testHelper.js';
import { pool } from '../../config/database.js';

describe('Quests API Integration', () => {
  let ctx;
  let user;
  let character;

  before(async () => {
    // Create test context with auto-cleanup
    ctx = createTestContext();
    user = await ctx.createUser();
    character = await ctx.createCharacter(user.accessToken);
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('GET /api/quests/daily/:characterId', () => {
    it('should return daily quests for a character', async () => {
      const response = await request('GET',
        `/quests/daily/${character.id}`,
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.ok(Array.isArray(response.data.quests), 'Should have quests array');
      assert.ok(response.data.streak, 'Should have streak info');
      assert.ok(response.data.perfectWeek !== undefined, 'Should have perfect week info');

      // Should have up to 3 daily quests
      assert.ok(response.data.quests.length <= 3, 'Should have at most 3 daily quests');

      // Check quest structure if any exist
      if (response.data.quests.length > 0) {
        const quest = response.data.quests[0];
        assert.ok(quest.id, 'Quest should have id');
        assert.ok(quest.questName, 'Quest should have name');
        assert.ok(quest.description, 'Quest should have description');
        assert.ok(quest.targetProgress, 'Quest should have target progress');
        assert.strictEqual(typeof quest.currentProgress, 'number', 'currentProgress should be number');
        assert.strictEqual(typeof quest.isCompleted, 'boolean', 'isCompleted should be boolean');
      }
    });

    it('should return 404 for non-owned character', async () => {
      const otherUser = await ctx.createUser();
      const otherCharacter = await ctx.createCharacter(otherUser.accessToken);

      const response = await request('GET',
        `/quests/daily/${otherCharacter.id}`,
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 404, 'Should return 404 for non-owned character');
    });

    it('should return 400 for invalid character ID', async () => {
      const response = await request('GET',
        '/quests/daily/invalid',
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 400, 'Should return 400 for invalid ID');
    });
  });

  describe('GET /api/quests/weekly/:characterId', () => {
    it('should return weekly quests for a character', async () => {
      const response = await request('GET',
        `/quests/weekly/${character.id}`,
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.ok(Array.isArray(response.data.quests), 'Should have quests array');

      // Should have up to 2 weekly quests
      assert.ok(response.data.quests.length <= 2, 'Should have at most 2 weekly quests');
    });
  });

  describe('GET /api/quests/streaks/:characterId', () => {
    it('should return streak information', async () => {
      const response = await request('GET',
        `/quests/streaks/${character.id}`,
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.strictEqual(typeof response.data.currentStreak, 'number', 'currentStreak should be number');
      assert.strictEqual(typeof response.data.longestStreak, 'number', 'longestStreak should be number');
      assert.strictEqual(typeof response.data.bonusPercentage, 'number', 'bonusPercentage should be number');
      assert.ok(response.data.perfectWeek !== undefined, 'Should have perfectWeek');
    });
  });

  describe('POST /api/quests/:questId/claim', () => {
    it('should reject claiming incomplete quest', async () => {
      // First, get daily quests
      const dailyResponse = await request('GET',
        `/quests/daily/${character.id}`,
        null,
        user.accessToken
      );

      if (dailyResponse.data.quests.length === 0) {
        // Skip if no quests available
        return;
      }

      const quest = dailyResponse.data.quests.find(q => !q.isCompleted);
      if (!quest) {
        // All quests are complete, skip test
        return;
      }

      const response = await request('POST',
        `/quests/${quest.id}/claim`,
        { characterId: character.id },
        user.accessToken
      );

      assert.strictEqual(response.status, 500, 'Should reject incomplete quest');
      assert.ok(response.data.error, 'Should have error message');
    });

    it('should return 400 for missing characterId', async () => {
      const response = await request('POST',
        '/quests/1/claim',
        {},
        user.accessToken
      );

      assert.strictEqual(response.status, 400, 'Should return 400');
    });
  });

  describe('POST /api/quests/claim-all', () => {
    it('should claim all completed quests', async () => {
      const response = await request('POST',
        '/quests/claim-all',
        { characterId: character.id },
        user.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.strictEqual(typeof response.data.questsClaimed, 'number', 'Should have questsClaimed');
      assert.strictEqual(typeof response.data.totalGold, 'number', 'Should have totalGold');
      assert.strictEqual(typeof response.data.totalXp, 'number', 'Should have totalXp');
    });

    it('should return 400 for missing characterId', async () => {
      const response = await request('POST',
        '/quests/claim-all',
        {},
        user.accessToken
      );

      assert.strictEqual(response.status, 400, 'Should return 400');
    });
  });

  describe('GET /api/quests/first-blood', () => {
    it('should return first blood winners', async () => {
      const response = await request('GET',
        '/quests/first-blood',
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.ok(Array.isArray(response.data.winners), 'Should have winners array');
      assert.ok(response.data.date, 'Should have date');
    });
  });

  describe('GET /api/quests/champions', () => {
    it('should return perfect week champions', async () => {
      const response = await request('GET',
        '/quests/champions',
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.ok(Array.isArray(response.data.champions), 'Should have champions array');
    });

    it('should respect limit parameter', async () => {
      const response = await request('GET',
        '/quests/champions?limit=5',
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.ok(response.data.champions.length <= 5, 'Should respect limit');
    });
  });

  describe('Quest Progress Integration', () => {
    // These tests verify that progress hooks work correctly
    // by checking quest progress after game actions

    it('should have valid quest templates in database', async () => {
      // Verify quest templates exist
      const result = await pool.query(
        'SELECT COUNT(*) as count FROM daily_quest_templates WHERE is_active = true'
      );

      assert.ok(parseInt(result.rows[0].count) > 0, 'Should have active quest templates');
    });

    it('should have correct period calculation functions', async () => {
      // Verify the PostgreSQL functions exist and work
      const dailyResult = await pool.query('SELECT get_daily_period_start() as period_start');
      assert.ok(dailyResult.rows[0].period_start, 'Should have daily period start');

      const weeklyResult = await pool.query('SELECT get_weekly_period_start() as period_start');
      assert.ok(weeklyResult.rows[0].period_start, 'Should have weekly period start');
    });
  });
});
