/**
 * Unit tests for coliseumService
 * Tests PvP matchmaking queue, match creation, and ready confirmation
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// Import the service
import * as coliseumService from '../../services/coliseumService.js';

// Counter for unique IDs - start high to avoid conflicts
let userIdCounter = 200000;

function getUniqueUserId() {
  return userIdCounter++;
}

describe('coliseumService', () => {

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
});
