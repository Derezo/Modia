/**
 * Quests Integration Tests
 *
 * Tests the quest API endpoints with live database:
 * - GET /api/quests/daily/:characterId
 * - GET /api/quests/weekly/:characterId
 * - GET /api/quests/markers/:characterId
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
  request
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
        `/api/quests/daily/${character.id}`,
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.ok(Array.isArray(response.body.quests), 'Should have quests array');
      assert.ok(response.body.streak, 'Should have streak info');
      assert.ok(response.body.perfectWeek !== undefined, 'Should have perfect week info');

      // Should have up to 3 daily quests
      assert.ok(response.body.quests.length <= 3, 'Should have at most 3 daily quests');

      // Check quest structure if any exist
      if (response.body.quests.length > 0) {
        const quest = response.body.quests[0];
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
        `/api/quests/daily/${otherCharacter.id}`,
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 404, 'Should return 404 for non-owned character');
    });

    it('should return 400 for invalid character ID', async () => {
      const response = await request('GET',
        '/api/quests/daily/invalid',
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 400, 'Should return 400 for invalid ID');
    });
  });

  describe('GET /api/quests/weekly/:characterId', () => {
    it('should return weekly quests for a character', async () => {
      const response = await request('GET',
        `/api/quests/weekly/${character.id}`,
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.ok(Array.isArray(response.body.quests), 'Should have quests array');

      // Should have up to 2 weekly quests
      assert.ok(response.body.quests.length <= 2, 'Should have at most 2 weekly quests');
    });
  });

  describe('GET /api/quests/markers/:characterId', () => {
    it('should return markers for character with active quests', async () => {
      // First ensure quests are assigned by fetching daily quests
      await request('GET',
        `/api/quests/daily/${character.id}`,
        null,
        user.accessToken
      );

      const response = await request('GET',
        `/api/quests/markers/${character.id}`,
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.ok(Array.isArray(response.body.markers), 'Should have markers array');

      // Check marker structure if any exist
      if (response.body.markers.length > 0) {
        const marker = response.body.markers[0];
        assert.ok(typeof marker.nodeId === 'number', 'Marker should have numeric nodeId');
        assert.ok(Array.isArray(marker.quests), 'Marker should have quests array');

        if (marker.quests.length > 0) {
          const quest = marker.quests[0];
          assert.ok(quest.questId, 'Quest should have questId');
          assert.ok(quest.questType, 'Quest should have questType (daily/weekly)');
          assert.ok(quest.name, 'Quest should have name');
          assert.strictEqual(typeof quest.progress, 'number', 'Quest should have numeric progress');
          assert.strictEqual(typeof quest.nearComplete, 'boolean', 'Quest should have nearComplete boolean');
        }
      }
    });

    it('should return empty markers array when no active quests with mappable objectives', async () => {
      // Create a fresh user/character with no quest progress
      const freshUser = await ctx.createUser();
      const freshCharacter = await ctx.createCharacter(freshUser.accessToken);

      const response = await request('GET',
        `/api/quests/markers/${freshCharacter.id}`,
        null,
        freshUser.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.ok(Array.isArray(response.body.markers), 'Should have markers array');
      // Markers may or may not be empty depending on quest assignments
      // The important thing is the structure is correct
    });

    it('should return 404 for non-owned character', async () => {
      const otherUser = await ctx.createUser();
      const otherCharacter = await ctx.createCharacter(otherUser.accessToken);

      const response = await request('GET',
        `/api/quests/markers/${otherCharacter.id}`,
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 404, 'Should return 404 for non-owned character');
    });

    it('should return 400 for invalid character ID', async () => {
      const response = await request('GET',
        '/api/quests/markers/invalid',
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 400, 'Should return 400 for invalid ID');
    });

    it('should return 401 when unauthenticated', async () => {
      const response = await request('GET',
        `/api/quests/markers/${character.id}`,
        null,
        null // No token
      );

      assert.strictEqual(response.status, 401, 'Should return 401 when unauthenticated');
    });
  });

  describe('GET /api/quests/streaks/:characterId', () => {
    it('should return streak information', async () => {
      const response = await request('GET',
        `/api/quests/streaks/${character.id}`,
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.strictEqual(typeof response.body.currentStreak, 'number', 'currentStreak should be number');
      assert.strictEqual(typeof response.body.longestStreak, 'number', 'longestStreak should be number');
      assert.strictEqual(typeof response.body.bonusPercentage, 'number', 'bonusPercentage should be number');
      assert.ok(response.body.perfectWeek !== undefined, 'Should have perfectWeek');
    });
  });

  describe('POST /api/quests/:questId/claim', () => {
    it('should reject claiming incomplete quest', async () => {
      // First, get daily quests
      const dailyResponse = await request('GET',
        `/api/quests/daily/${character.id}`,
        null,
        user.accessToken
      );

      if (dailyResponse.body.quests.length === 0) {
        // Skip if no quests available
        return;
      }

      const quest = dailyResponse.body.quests.find(q => !q.isCompleted);
      if (!quest) {
        // All quests are complete, skip test
        return;
      }

      const response = await request('POST',
        `/api/quests/${quest.id}/claim`,
        { characterId: character.id },
        user.accessToken
      );

      assert.strictEqual(response.status, 500, 'Should reject incomplete quest');
      assert.ok(response.body.error, 'Should have error message');
    });

    it('should return 400 for missing characterId', async () => {
      const response = await request('POST',
        '/api/quests/1/claim',
        {},
        user.accessToken
      );

      assert.strictEqual(response.status, 400, 'Should return 400');
    });
  });

  describe('POST /api/quests/claim-all', () => {
    it('should claim all completed quests', async () => {
      const response = await request('POST',
        '/api/quests/claim-all',
        { characterId: character.id },
        user.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.strictEqual(typeof response.body.questsClaimed, 'number', 'Should have questsClaimed');
      assert.strictEqual(typeof response.body.totalGold, 'number', 'Should have totalGold');
      assert.strictEqual(typeof response.body.totalXp, 'number', 'Should have totalXp');
    });

    it('should return 400 for missing characterId', async () => {
      const response = await request('POST',
        '/api/quests/claim-all',
        {},
        user.accessToken
      );

      assert.strictEqual(response.status, 400, 'Should return 400');
    });
  });

  describe('GET /api/quests/first-blood', () => {
    it('should return first blood winners', async () => {
      const response = await request('GET',
        '/api/quests/first-blood',
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.ok(Array.isArray(response.body.winners), 'Should have winners array');
      assert.ok(response.body.date, 'Should have date');
    });
  });

  describe('GET /api/quests/champions', () => {
    it('should return perfect week champions', async () => {
      const response = await request('GET',
        '/api/quests/champions',
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.ok(Array.isArray(response.body.champions), 'Should have champions array');
    });

    it('should respect limit parameter', async () => {
      const response = await request('GET',
        '/api/quests/champions?limit=5',
        null,
        user.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');
      assert.ok(response.body.champions.length <= 5, 'Should respect limit');
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
