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

      // Finding 40: Now correctly returns 409 (conflict) instead of 500 (server error)
      assert.strictEqual(response.status, 409, 'Should reject incomplete quest with 409');
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

  describe('Completion bonus on single claims (Finding 39)', () => {
    it('grants and returns the daily completion bonus on the last one-at-a-time claim', async () => {
      const bonusUser = await ctx.createUser();
      const bonusChar = await ctx.createCharacter(bonusUser.accessToken);

      const daily = await request('GET', `/api/quests/daily/${bonusChar.id}`, null, bonusUser.accessToken);
      assert.strictEqual(daily.status, 200, JSON.stringify(daily.body));
      const quests = daily.body.quests;
      assert.ok(quests.length >= 3, `expected 3 daily quests, got ${quests.length}`);

      await pool.query(
        `UPDATE character_daily_quests SET is_completed = TRUE
         WHERE character_id = $1 AND period = 'daily' AND period_start = get_daily_period_start()`,
        [bonusChar.id]
      );

      const responses = [];
      for (const quest of quests) {
        const res = await request('POST', `/api/quests/${quest.id}/claim`,
          { characterId: bonusChar.id }, bonusUser.accessToken);
        assert.strictEqual(res.status, 200, JSON.stringify(res.body));
        responses.push(res.body);
      }

      assert.ok(responses.slice(0, -1).every(r => r.completionBonus === null),
        'no bonus before the last claim');
      const lastBonus = responses.at(-1).completionBonus;
      assert.ok(lastBonus && lastBonus.gold >= 0 && lastBonus.xp >= 0, JSON.stringify(lastBonus));

      const granted = await pool.query(
        `SELECT COUNT(*)::int AS n FROM character_completion_bonuses
         WHERE character_id = $1 AND period_start = get_daily_period_start()`,
        [bonusChar.id]
      );
      assert.strictEqual(granted.rows[0].n, 1);
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

  describe('Streak Calculation (Finding 37)', () => {
    // These tests verify the streak calculation uses SQL date arithmetic
    // to avoid timezone drift between JS Date and Postgres DATE.

    it('should increment streak when last_login_date is yesterday', async () => {
      const testUser = await ctx.createUser();
      const testChar = await ctx.createCharacter(testUser.accessToken);

      // Set up streak with last_login_date = yesterday, current_streak = 3
      // Use INSERT ON CONFLICT because character creation doesn't create a streak record
      await pool.query(
        `INSERT INTO character_login_streaks (character_id, last_login_date, current_streak, longest_streak)
         VALUES ($1, CURRENT_DATE - 1, 3, 3)
         ON CONFLICT (character_id) DO UPDATE SET
           last_login_date = CURRENT_DATE - 1,
           current_streak = 3,
           longest_streak = 3`,
        [testChar.id]
      );

      // Fetch daily quests to trigger refreshQuestsIfNeeded -> updateStreak
      const response = await request('GET',
        `/api/quests/daily/${testChar.id}`,
        null,
        testUser.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');

      // Verify streak was incremented
      const streakResult = await pool.query(
        'SELECT current_streak, longest_streak FROM character_login_streaks WHERE character_id = $1',
        [testChar.id]
      );
      assert.strictEqual(streakResult.rows[0].current_streak, 4, 'Streak should be 4 (3 + 1)');
      assert.strictEqual(streakResult.rows[0].longest_streak, 4, 'Longest streak should update to 4');
    });

    it('should start new character with streak of 1', async () => {
      const testUser = await ctx.createUser();
      const testChar = await ctx.createCharacter(testUser.accessToken);

      // Remove any existing streak record to simulate first login
      await pool.query(
        'DELETE FROM character_login_streaks WHERE character_id = $1',
        [testChar.id]
      );

      // Fetch daily quests to trigger streak creation
      const response = await request('GET',
        `/api/quests/daily/${testChar.id}`,
        null,
        testUser.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');

      // Verify streak is 1
      const streakResult = await pool.query(
        'SELECT current_streak, longest_streak FROM character_login_streaks WHERE character_id = $1',
        [testChar.id]
      );
      assert.strictEqual(streakResult.rows[0].current_streak, 1, 'New character should have streak 1');
      assert.strictEqual(streakResult.rows[0].longest_streak, 1, 'Longest streak should be 1');
    });

    it('should reset streak when last_login_date is more than 1 day ago', async () => {
      const testUser = await ctx.createUser();
      const testChar = await ctx.createCharacter(testUser.accessToken);

      // Set up streak with last_login_date = 3 days ago, current_streak = 5
      // Use INSERT ON CONFLICT because character creation doesn't create a streak record
      await pool.query(
        `INSERT INTO character_login_streaks (character_id, last_login_date, current_streak, longest_streak)
         VALUES ($1, CURRENT_DATE - 3, 5, 10)
         ON CONFLICT (character_id) DO UPDATE SET
           last_login_date = CURRENT_DATE - 3,
           current_streak = 5,
           longest_streak = 10`,
        [testChar.id]
      );

      // Fetch daily quests to trigger streak update
      const response = await request('GET',
        `/api/quests/daily/${testChar.id}`,
        null,
        testUser.accessToken
      );

      assert.strictEqual(response.status, 200, 'Should return 200');

      // Verify streak was reset to 1
      const streakResult = await pool.query(
        'SELECT current_streak, longest_streak FROM character_login_streaks WHERE character_id = $1',
        [testChar.id]
      );
      assert.strictEqual(streakResult.rows[0].current_streak, 1, 'Streak should reset to 1');
      assert.strictEqual(streakResult.rows[0].longest_streak, 10, 'Longest streak should be preserved');
    });
  });

  describe('Concurrent Quest Request Race Condition', () => {
    // Tests that concurrent GET /daily, /weekly, /markers requests
    // do not cause 409 "Resource already exists" errors due to
    // race conditions in quest creation.

    it('should handle concurrent daily/weekly/markers requests without 409 errors', async () => {
      // Create a fresh user/character with no quests
      const testUser = await ctx.createUser();
      const testChar = await ctx.createCharacter(testUser.accessToken);

      // Clear any existing quests and streaks to simulate first-time login
      await pool.query(
        'DELETE FROM character_daily_quests WHERE character_id = $1',
        [testChar.id]
      );
      await pool.query(
        'DELETE FROM character_login_streaks WHERE character_id = $1',
        [testChar.id]
      );

      // Fire all three requests concurrently - this used to cause race condition
      const [dailyResponse, weeklyResponse, markersResponse] = await Promise.all([
        request('GET', `/api/quests/daily/${testChar.id}`, null, testUser.accessToken),
        request('GET', `/api/quests/weekly/${testChar.id}`, null, testUser.accessToken),
        request('GET', `/api/quests/markers/${testChar.id}`, null, testUser.accessToken)
      ]);

      // All requests should succeed - none should get 409
      assert.strictEqual(dailyResponse.status, 200,
        `Daily should return 200, got ${dailyResponse.status}: ${JSON.stringify(dailyResponse.body)}`);
      assert.strictEqual(weeklyResponse.status, 200,
        `Weekly should return 200, got ${weeklyResponse.status}: ${JSON.stringify(weeklyResponse.body)}`);
      assert.strictEqual(markersResponse.status, 200,
        `Markers should return 200, got ${markersResponse.status}: ${JSON.stringify(markersResponse.body)}`);

      // Critical: Verify quests were actually returned (not empty due to race condition)
      // The blocking advisory lock ensures the losing requests wait for commits
      assert.ok(dailyResponse.body.quests.length > 0,
        `Daily quests should not be empty, got ${JSON.stringify(dailyResponse.body.quests)}`);
      assert.ok(weeklyResponse.body.quests.length > 0,
        `Weekly quests should not be empty, got ${JSON.stringify(weeklyResponse.body.quests)}`);

      // Verify quests were actually created (exactly once)
      const questCount = await pool.query(
        `SELECT COUNT(*) as count FROM character_daily_quests
         WHERE character_id = $1 AND period_end > NOW()`,
        [testChar.id]
      );
      const count = parseInt(questCount.rows[0].count);

      // Should have 3 daily + 2 weekly = 5 quests (or fewer if templates not available)
      assert.ok(count > 0, 'Should have created some quests');
      assert.ok(count <= 5, `Should have at most 5 quests (3 daily + 2 weekly), got ${count}`);

      // Run the same concurrent requests again - should still succeed
      const [daily2, weekly2, markers2] = await Promise.all([
        request('GET', `/api/quests/daily/${testChar.id}`, null, testUser.accessToken),
        request('GET', `/api/quests/weekly/${testChar.id}`, null, testUser.accessToken),
        request('GET', `/api/quests/markers/${testChar.id}`, null, testUser.accessToken)
      ]);

      assert.strictEqual(daily2.status, 200, 'Second daily request should succeed');
      assert.strictEqual(weekly2.status, 200, 'Second weekly request should succeed');
      assert.strictEqual(markers2.status, 200, 'Second markers request should succeed');
    });
  });

  describe('Visit Quest Deduplication (Finding 38 & 115)', () => {
    // These tests verify that visit_nodes and visit_regions quests
    // properly deduplicate progress using progress_data.

    it('should not count revisiting the same node twice', async () => {
      const testUser = await ctx.createUser();
      const testChar = await ctx.createCharacter(testUser.accessToken);

      // Get a visit_nodes quest
      const questResult = await pool.query(
        `SELECT cdq.id, cdq.current_progress, cdq.target_progress
         FROM character_daily_quests cdq
         JOIN daily_quest_templates dqt ON dqt.id = cdq.quest_template_id
         WHERE cdq.character_id = $1
           AND dqt.objective_type = 'visit_nodes'
           AND cdq.is_completed = FALSE
         LIMIT 1`,
        [testChar.id]
      );

      if (questResult.rows.length === 0) {
        // No visit_nodes quest assigned, skip test
        return;
      }

      const quest = questResult.rows[0];
      const initialProgress = quest.current_progress;

      // Import dailyQuestService to call updateProgress directly
      const dailyQuestService = await import('../../services/dailyQuestService.js');

      // Visit node 999 for the first time
      await dailyQuestService.updateProgress(testChar.id, 'visit_nodes', 1, {
        nodeType: 'tavern',
        nodeId: 999
      });

      // Check progress increased by 1
      const afterFirst = await pool.query(
        'SELECT current_progress, progress_data FROM character_daily_quests WHERE id = $1',
        [quest.id]
      );
      assert.strictEqual(afterFirst.rows[0].current_progress, initialProgress + 1, 'Progress should increase by 1');
      assert.ok(afterFirst.rows[0].progress_data?.visited_node_ids?.includes(999), 'Node 999 should be tracked');

      // Visit node 999 again - should NOT increase progress
      await dailyQuestService.updateProgress(testChar.id, 'visit_nodes', 1, {
        nodeType: 'tavern',
        nodeId: 999
      });

      const afterSecond = await pool.query(
        'SELECT current_progress FROM character_daily_quests WHERE id = $1',
        [quest.id]
      );
      assert.strictEqual(afterSecond.rows[0].current_progress, initialProgress + 1, 'Revisit should not increase progress');
    });

    it('should not count crossing the same region border multiple times', async () => {
      const testUser = await ctx.createUser();
      const testChar = await ctx.createCharacter(testUser.accessToken);

      // Get a visit_regions quest
      const questResult = await pool.query(
        `SELECT cdq.id, cdq.current_progress, cdq.target_progress
         FROM character_daily_quests cdq
         JOIN daily_quest_templates dqt ON dqt.id = cdq.quest_template_id
         WHERE cdq.character_id = $1
           AND dqt.objective_type = 'visit_regions'
           AND cdq.is_completed = FALSE
         LIMIT 1`,
        [testChar.id]
      );

      if (questResult.rows.length === 0) {
        // No visit_regions quest assigned, skip test
        return;
      }

      const quest = questResult.rows[0];
      const initialProgress = quest.current_progress;

      // Import dailyQuestService
      const dailyQuestService = await import('../../services/dailyQuestService.js');

      // Visit region 1 for the first time
      await dailyQuestService.updateProgress(testChar.id, 'visit_regions', 1, {
        regionId: 1
      });

      // Check progress increased
      const afterFirst = await pool.query(
        'SELECT current_progress, progress_data FROM character_daily_quests WHERE id = $1',
        [quest.id]
      );
      assert.strictEqual(afterFirst.rows[0].current_progress, initialProgress + 1, 'Progress should increase by 1');
      assert.ok(afterFirst.rows[0].progress_data?.visited_region_ids?.includes(1), 'Region 1 should be tracked');

      // Cross back and forth 5 times - should NOT give +5
      for (let i = 0; i < 5; i++) {
        await dailyQuestService.updateProgress(testChar.id, 'visit_regions', 1, {
          regionId: 1
        });
      }

      const afterMany = await pool.query(
        'SELECT current_progress FROM character_daily_quests WHERE id = $1',
        [quest.id]
      );
      // Progress should still be initialProgress + 1 (not +6)
      assert.strictEqual(afterMany.rows[0].current_progress, initialProgress + 1, 'Border crossing should not count multiple times');
    });
  });
});
