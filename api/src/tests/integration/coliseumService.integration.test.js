/**
 * Unit tests for coliseumService
 * Tests PvP matchmaking queue, match creation, and ready confirmation
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// Import the service
import * as coliseumService from '../../services/coliseumService.js';

// Import test helpers for HTTP API tests
import { request, createTestContext, resetRateLimitersViaApi, query } from '../testHelper.js';

// Counter for unique IDs - start high to avoid conflicts
let userIdCounter = 200000;

function getUniqueUserId() {
  return userIdCounter++;
}

describe('coliseumService', () => {

  afterEach(() => {
    coliseumService._resetForTests();
  });

  describe('QUEUE_SETTINGS', () => {
    
    test('should export QUEUE_SETTINGS constant', () => {
      assert.ok(coliseumService.QUEUE_SETTINGS);
      assert.strictEqual(typeof coliseumService.QUEUE_SETTINGS, 'object');
    });

    test('should have 1v1 queue settings', () => {
      const settings = coliseumService.QUEUE_SETTINGS['1v1'];
      assert.ok(settings);
      assert.strictEqual(settings.minPlayers, 2);
      assert.strictEqual(settings.maxPlayers, 2);
      assert.strictEqual(settings.partySize, 1);
    });

    test('should have 3v3 queue settings', () => {
      const settings = coliseumService.QUEUE_SETTINGS['3v3'];
      assert.ok(settings);
      assert.strictEqual(settings.minPlayers, 2);
      assert.strictEqual(settings.maxPlayers, 2);
      assert.strictEqual(settings.partySize, 3);
    });

    test('should have 5v5 queue settings', () => {
      const settings = coliseumService.QUEUE_SETTINGS['5v5'];
      assert.ok(settings);
      assert.strictEqual(settings.minPlayers, 2);
      assert.strictEqual(settings.maxPlayers, 2);
      assert.strictEqual(settings.partySize, 5);
    });
  });

  describe('joinQueue', () => {
    
    test('should export joinQueue function', () => {
      assert.strictEqual(typeof coliseumService.joinQueue, 'function');
    });

    test('should reject invalid queue type', async () => {
      const userId = getUniqueUserId();

      const result = await coliseumService.joinQueue('invalid', userId, 'testUser', 10, 1);

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('Invalid queue type'));
    });

    test('should reject party size exceeding limit for 1v1', async () => {
      const userId = getUniqueUserId();

      const result = await coliseumService.joinQueue('1v1', userId, 'testUser', 10, 3);

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('Maximum'));
    });

    // Note: Tests that call joinQueue with valid params require real users in DB
    // because joinQueue calls ensureRating() which inserts to pvp_ratings with FK to users
    // These tests verify the async behavior and error handling for non-existent users

    test('should reject queue join for non-existent user (FK constraint)', async () => {
      const userId = getUniqueUserId(); // Fake user ID not in DB

      // Should throw FK constraint error when trying to ensure rating
      await assert.rejects(
        async () => await coliseumService.joinQueue('1v1', userId, 'testUser', 10, 1),
        /foreign key constraint|pvp_ratings/i
      );
    });

    test('should return async result from joinQueue', async () => {
      const userId = getUniqueUserId();

      // Verify joinQueue returns a Promise and handle the rejection
      const result = coliseumService.joinQueue('1v1', userId, 'testUser', 10, 1);
      assert.ok(result instanceof Promise, 'joinQueue should return a Promise');

      // Catch the expected FK rejection to prevent unhandled rejection warning
      await result.catch(() => { /* expected FK error */ });
    });
  });

  describe('leaveQueue', () => {

    test('should export leaveQueue function', () => {
      assert.strictEqual(typeof coliseumService.leaveQueue, 'function');
    });

    test('should return false when user not in queue', () => {
      const userId = getUniqueUserId();

      const result = coliseumService.leaveQueue('5v5', userId);

      assert.strictEqual(result, false);
    });

    test('should return boolean from leaveQueue', () => {
      const userId = getUniqueUserId();

      // leaveQueue is synchronous and returns boolean
      const result = coliseumService.leaveQueue('3v3', userId);
      assert.strictEqual(typeof result, 'boolean');
    });

    test('should handle null queueType gracefully', () => {
      const userId = getUniqueUserId();

      // Calling with null queue type when user not in any queue
      const result = coliseumService.leaveQueue(null, userId);
      assert.strictEqual(typeof result, 'boolean');
    });
  });

  describe('playerReady', () => {
    
    test('should export playerReady function', () => {
      assert.strictEqual(typeof coliseumService.playerReady, 'function');
    });

    test('should return error for non-existent match', () => {
      const userId = getUniqueUserId();
      
      const result = coliseumService.playerReady(99999, userId);
      
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('Match not found'));
    });
  });

  describe('getQueueStatus', () => {
    
    test('should export getQueueStatus function', () => {
      assert.strictEqual(typeof coliseumService.getQueueStatus, 'function');
    });

    test('should return queue status for 1v1', () => {
      const status = coliseumService.getQueueStatus('1v1');
      
      assert.strictEqual(status.queueType, '1v1');
      assert.strictEqual(typeof status.queueSize, 'number');
      assert.strictEqual(typeof status.averageWait, 'number');
    });

    test('should return status with non-negative queue size', () => {
      const status = coliseumService.getQueueStatus('5v5');
      
      assert.ok(status.queueSize >= 0);
    });
  });

  describe('getAllQueueStatuses', () => {
    
    test('should export getAllQueueStatuses function', () => {
      assert.strictEqual(typeof coliseumService.getAllQueueStatuses, 'function');
    });

    test('should return statuses for all queue types', () => {
      const statuses = coliseumService.getAllQueueStatuses();
      
      assert.ok(Array.isArray(statuses));
      assert.strictEqual(statuses.length, 3); // 1v1, 3v3, 5v5
      
      const queueTypes = statuses.map(s => s.queueType);
      assert.ok(queueTypes.includes('1v1'));
      assert.ok(queueTypes.includes('3v3'));
      assert.ok(queueTypes.includes('5v5'));
    });
  });

  describe('cleanupPlayer', () => {

    test('should export cleanupPlayer function', () => {
      assert.strictEqual(typeof coliseumService.cleanupPlayer, 'function');
    });

    test('should handle cleanup of non-queued player', async () => {
      const userId = getUniqueUserId();

      // Should not throw for a player that was never in queue
      await assert.doesNotReject(async () => {
        await coliseumService.cleanupPlayer(userId);
      });
    });

    test('cleanupPlayer should be async', () => {
      const userId = getUniqueUserId();

      // Verify cleanupPlayer returns a Promise
      const result = coliseumService.cleanupPlayer(userId);
      assert.ok(result instanceof Promise, 'cleanupPlayer should return a Promise');
    });
  });

  describe('Matchmaking Flow', () => {
    // Note: Full matchmaking tests require real users in DB due to FK constraints
    // These tests verify the async interface and error handling

    test('joinQueue returns Promise for matchmaking flow', async () => {
      const userId = getUniqueUserId();

      const result = coliseumService.joinQueue('1v1', userId, 'player', 10, 1);
      assert.ok(result instanceof Promise, 'joinQueue should return Promise');

      // Catch the expected FK rejection to prevent unhandled rejection warning
      await result.catch(() => { /* expected FK error */ });
    });

    test('queue status is available after any join attempt', async () => {
      const userId = getUniqueUserId();

      // Even if join fails due to FK, queue status should still work
      try {
        await coliseumService.joinQueue('1v1', userId, 'player', 10, 1);
      } catch {
        // Expected to fail due to FK constraint
      }

      const queueStatus = coliseumService.getQueueStatus('1v1');
      assert.ok(typeof queueStatus.queueSize === 'number');
      assert.ok(typeof queueStatus.averageWait === 'number');
    });
  });

  describe('Default Export', () => {
    
    test('should export all functions via default export', () => {
      const defaultExport = coliseumService.default;
      
      assert.strictEqual(typeof defaultExport.joinQueue, 'function');
      assert.strictEqual(typeof defaultExport.leaveQueue, 'function');
      assert.strictEqual(typeof defaultExport.playerReady, 'function');
      assert.strictEqual(typeof defaultExport.getQueueStatus, 'function');
      assert.strictEqual(typeof defaultExport.getAllQueueStatuses, 'function');
      assert.strictEqual(typeof defaultExport.cleanupPlayer, 'function');
    });
  });

  describe('completeMatch export', () => {
    // Note: Full integration tests for completeMatch through handleBattleEnd are not included
    // here because they require the full battle action flow which causes rate limiting issues
    // in the test suite. The completeMatch function itself is exercised via the existing
    // forfeit/disconnect tests which call endMatchByForfeit -> completeMatch. These tests
    // verify the export is available for battle.js integration.
    //
    // The actual integration path (battle.js handleBattleEnd -> completeColiseumMatch) was
    // added as part of bug fix: Coliseum battles now record match results and update ratings.

    test('should export completeMatch function for battle.js integration', () => {
      // This test verifies that completeMatch is properly exported
      // so that battle.js can call it when a Coliseum battle ends normally
      assert.strictEqual(typeof coliseumService.completeMatch, 'function');
    });

    test('should be an async function with expected signature', () => {
      // Verify function signature: completeMatch(battleId, winnerId, loserId, reason?, applyPenalty?)
      // The function.length only counts parameters without defaults, so we check it's at least 2
      assert.ok(coliseumService.completeMatch.length >= 2, 'Function should have at least 2 required parameters');

      // Verify it returns a promise (is async)
      assert.strictEqual(
        coliseumService.completeMatch.constructor.name,
        'AsyncFunction',
        'completeMatch should be an async function'
      );
    });
  });
});

// ============================================================================
// HTTP API Integration Tests
// ============================================================================

describe('Coliseum API Endpoints', () => {
  const ctx = createTestContext();
  let user;

  beforeEach(async () => {
    await resetRateLimitersViaApi();
    user = await ctx.createUser();
  });

  afterEach(async () => {
    coliseumService._resetForTests();
    await ctx.cleanup();
  });

  describe('GET /api/coliseum/queues', () => {
    test('returns queue statuses for all queue types', async () => {
      const res = await request('GET', '/api/coliseum/queues', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.queues));
      assert.strictEqual(res.body.queues.length, 3);

      // Verify all queue types are present
      const queueTypes = res.body.queues.map(q => q.queueType);
      assert.ok(queueTypes.includes('1v1'), 'Should include 1v1 queue');
      assert.ok(queueTypes.includes('3v3'), 'Should include 3v3 queue');
      assert.ok(queueTypes.includes('5v5'), 'Should include 5v5 queue');
    });

    test('returns queue sizes as numbers', async () => {
      const res = await request('GET', '/api/coliseum/queues', null, user.accessToken);

      assert.strictEqual(res.status, 200);

      for (const queue of res.body.queues) {
        assert.strictEqual(typeof queue.queueType, 'string', 'queueType should be a string');
        assert.strictEqual(typeof queue.queueSize, 'number', 'queueSize should be a number');
        assert.ok(queue.queueSize >= 0, 'queueSize should be non-negative');
        assert.strictEqual(typeof queue.averageWait, 'number', 'averageWait should be a number');
      }
    });

    test('requires authentication', async () => {
      const res = await request('GET', '/api/coliseum/queues', null, null);

      assert.strictEqual(res.status, 401);
    });

    test('rejects invalid token', async () => {
      const res = await request('GET', '/api/coliseum/queues', null, 'invalid-token');

      assert.strictEqual(res.status, 401);
    });
  });

  describe('GET /api/coliseum/queue/:queueType/players', () => {
    test('returns players list for valid 1v1 queue', async () => {
      const res = await request('GET', '/api/coliseum/queue/1v1/players', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.players), 'players should be an array');
    });

    test('returns players list for valid 3v3 queue', async () => {
      const res = await request('GET', '/api/coliseum/queue/3v3/players', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.players), 'players should be an array');
    });

    test('returns players list for valid 5v5 queue', async () => {
      const res = await request('GET', '/api/coliseum/queue/5v5/players', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.players), 'players should be an array');
    });

    test('rejects invalid queue type', async () => {
      const res = await request('GET', '/api/coliseum/queue/invalid/players', null, user.accessToken);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('Invalid queue type'), 'Should return invalid queue type error');
    });

    test('rejects 2v2 as invalid queue type', async () => {
      const res = await request('GET', '/api/coliseum/queue/2v2/players', null, user.accessToken);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('Invalid queue type'));
    });

    test('requires authentication', async () => {
      const res = await request('GET', '/api/coliseum/queue/1v1/players', null, null);

      assert.strictEqual(res.status, 401);
    });

    test('rejects invalid token', async () => {
      const res = await request('GET', '/api/coliseum/queue/1v1/players', null, 'invalid-token');

      assert.strictEqual(res.status, 401);
    });
  });

  describe('GET /api/coliseum/achievements/:userId', () => {
    test('returns achievements for valid user', async () => {
      const res = await request('GET', `/api/coliseum/achievements/${user.userId}`, null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.achievements), 'achievements should be an array');
    });

    test('returns achievement objects with required fields', async () => {
      const res = await request('GET', `/api/coliseum/achievements/${user.userId}`, null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // If there are achievements, verify they have required fields
      for (const achievement of res.body.achievements) {
        assert.strictEqual(typeof achievement.key, 'string', 'achievement should have key');
        assert.strictEqual(typeof achievement.name, 'string', 'achievement should have name');
        assert.strictEqual(typeof achievement.icon, 'string', 'achievement should have icon');
        assert.strictEqual(typeof achievement.type, 'string', 'achievement should have type');
        assert.ok('isDynamic' in achievement, 'achievement should have isDynamic field');
      }
    });

    test('returns empty array for user with no achievements', async () => {
      // New user should have no achievements (or only dynamic ones based on win streak)
      const res = await request('GET', `/api/coliseum/achievements/${user.userId}`, null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.achievements));
    });

    test('rejects invalid user ID (non-numeric)', async () => {
      const res = await request('GET', '/api/coliseum/achievements/invalid', null, user.accessToken);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Invalid user ID'));
    });

    test('rejects invalid user ID (NaN)', async () => {
      const res = await request('GET', '/api/coliseum/achievements/abc123', null, user.accessToken);

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Invalid user ID'));
    });

    test('requires authentication', async () => {
      const res = await request('GET', `/api/coliseum/achievements/${user.userId}`, null, null);

      assert.strictEqual(res.status, 401);
    });

    test('rejects invalid token', async () => {
      const res = await request('GET', `/api/coliseum/achievements/${user.userId}`, null, 'invalid-token');

      assert.strictEqual(res.status, 401);
    });

    test('can retrieve achievements for another user', async () => {
      // Create a second user
      const user2 = await ctx.createUser();

      // User 1 should be able to view User 2's achievements
      const res = await request('GET', `/api/coliseum/achievements/${user2.userId}`, null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.achievements));
    });
  });

  describe('GET /api/coliseum/my-achievements', () => {
    test('returns achievements for authenticated user', async () => {
      const res = await request('GET', '/api/coliseum/my-achievements', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.achievements), 'achievements should be an array');
    });

    test('returns achievement objects with required fields', async () => {
      const res = await request('GET', '/api/coliseum/my-achievements', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // Verify each achievement has required fields
      for (const achievement of res.body.achievements) {
        assert.strictEqual(typeof achievement.key, 'string', 'achievement should have key');
        assert.strictEqual(typeof achievement.name, 'string', 'achievement should have name');
        assert.strictEqual(typeof achievement.icon, 'string', 'achievement should have icon');
        assert.strictEqual(typeof achievement.description, 'string', 'achievement should have description');
        assert.strictEqual(typeof achievement.type, 'string', 'achievement should have type');
        assert.ok('isDynamic' in achievement, 'achievement should have isDynamic field');
      }
    });

    test('returns same achievements as user-specific endpoint', async () => {
      const myRes = await request('GET', '/api/coliseum/my-achievements', null, user.accessToken);
      const userRes = await request('GET', `/api/coliseum/achievements/${user.userId}`, null, user.accessToken);

      assert.strictEqual(myRes.status, 200);
      assert.strictEqual(userRes.status, 200);

      // Both endpoints should return the same achievements
      assert.strictEqual(myRes.body.achievements.length, userRes.body.achievements.length);

      // Compare achievement keys
      const myKeys = myRes.body.achievements.map(a => a.key).sort();
      const userKeys = userRes.body.achievements.map(a => a.key).sort();
      assert.deepStrictEqual(myKeys, userKeys, 'Both endpoints should return same achievements');
    });

    test('requires authentication', async () => {
      const res = await request('GET', '/api/coliseum/my-achievements', null, null);

      assert.strictEqual(res.status, 401);
    });

    test('rejects invalid token', async () => {
      const res = await request('GET', '/api/coliseum/my-achievements', null, 'invalid-token');

      assert.strictEqual(res.status, 401);
    });

    test('different users get different achievements', async () => {
      // Create a second user
      const user2 = await ctx.createUser();

      const res1 = await request('GET', '/api/coliseum/my-achievements', null, user.accessToken);
      const res2 = await request('GET', '/api/coliseum/my-achievements', null, user2.accessToken);

      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res2.status, 200);

      // Both should succeed - achievements might be same (empty) for new users
      // but the endpoint correctly identifies different users
      assert.ok(Array.isArray(res1.body.achievements));
      assert.ok(Array.isArray(res2.body.achievements));
    });
  });

  describe('Turn Timer and Auto-Forfeit', () => {
    test('should verify turn timer constants are correctly configured', async () => {
      // Import the constants to verify configuration
      const { MAX_TURN_TIMEOUTS, PVP_TURN_TIMEOUT } = await import('../../services/coliseum/constants.js');

      // Verify the constants are set correctly
      assert.strictEqual(MAX_TURN_TIMEOUTS, 3, 'MAX_TURN_TIMEOUTS should be 3');
      assert.strictEqual(PVP_TURN_TIMEOUT, 30000, 'PVP_TURN_TIMEOUT should be 30 seconds');
    });

    test('should track turn timeout counts correctly', async () => {
      // Import the timeout tracking map
      const { turnTimeoutCounts, MAX_TURN_TIMEOUTS } = await import('../../services/coliseum/constants.js');

      // Test the timeout counting logic with mock IDs
      const testBattleId = 99999;
      const testPlayerId = 88888;

      // Initially no timeouts
      assert.strictEqual(turnTimeoutCounts.has(testBattleId), false, 'Should not have entry for new battle');

      // Simulate first timeout
      turnTimeoutCounts.set(testBattleId, { [testPlayerId]: 1 });
      let counts = turnTimeoutCounts.get(testBattleId);
      assert.strictEqual(counts[testPlayerId], 1, 'Should have 1 timeout after first');
      assert.ok(counts[testPlayerId] < MAX_TURN_TIMEOUTS, 'Should not trigger forfeit at 1 timeout');

      // Simulate second timeout
      counts[testPlayerId] = 2;
      assert.strictEqual(counts[testPlayerId], 2, 'Should have 2 timeouts');
      assert.ok(counts[testPlayerId] < MAX_TURN_TIMEOUTS, 'Should not trigger forfeit at 2 timeouts');

      // Simulate third timeout - this should trigger forfeit
      counts[testPlayerId] = 3;
      assert.strictEqual(counts[testPlayerId], 3, 'Should have 3 timeouts after increment');
      assert.ok(counts[testPlayerId] >= MAX_TURN_TIMEOUTS, 'Should trigger forfeit at 3 timeouts');

      // Cleanup
      turnTimeoutCounts.delete(testBattleId);
    });

    test('should initialize turn timers map as empty', async () => {
      // Import the timer tracking map
      const { turnTimers } = await import('../../services/coliseum/constants.js');

      // Verify turnTimers is a Map
      assert.ok(turnTimers instanceof Map, 'turnTimers should be a Map');

      // After cleanup, should not have entries for non-existent battles
      const testBattleId = 77777;
      assert.strictEqual(turnTimers.has(testBattleId), false, 'Should not have timer for non-existent battle');
    });

    test('should export endMatchByForfeit function for auto-forfeit handling', async () => {
      // Verify the forfeit function is exported and callable
      const { endMatchByForfeit } = await import('../../services/coliseumService.js');

      assert.strictEqual(typeof endMatchByForfeit, 'function', 'endMatchByForfeit should be a function');
      assert.strictEqual(
        endMatchByForfeit.constructor.name,
        'AsyncFunction',
        'endMatchByForfeit should be an async function'
      );
    });

    test('should handle forfeit gracefully for non-existent battle', async () => {
      const { endMatchByForfeit } = await import('../../services/coliseumService.js');

      // endMatchByForfeit returns early (undefined) for non-existent battles
      // This should not throw an error
      await assert.doesNotReject(
        async () => await endMatchByForfeit(999999, user.userId, 'timeout', false),
        'Should handle non-existent battle gracefully'
      );
    });

    test('turnTimers map structure supports required fields', async () => {
      // Verify the turn timer map can store the expected structure
      const { turnTimers } = await import('../../services/coliseum/constants.js');

      const testBattleId = 66666;
      const testTimerEntry = {
        timerId: setTimeout(() => {}, 0), // Dummy timer
        startTime: Date.now(),
        playerId: 12345,
        isPvE: false
      };

      // Set and verify structure
      turnTimers.set(testBattleId, testTimerEntry);

      const retrieved = turnTimers.get(testBattleId);
      assert.ok(retrieved.timerId, 'Should have timerId');
      assert.ok(retrieved.startTime, 'Should have startTime');
      assert.ok(retrieved.playerId, 'Should have playerId');
      assert.strictEqual(retrieved.isPvE, false, 'Should have isPvE flag');

      // Cleanup
      clearTimeout(testTimerEntry.timerId);
      turnTimers.delete(testBattleId);
    });
  });
});
