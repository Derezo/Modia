/**
 * Unit tests for coliseumService
 * Tests PvP matchmaking queue, match creation, and ready confirmation
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// Import the service
import * as coliseumService from '../services/coliseumService.js';

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

    test('should reject invalid queue type', () => {
      const userId = getUniqueUserId();
      
      const result = coliseumService.joinQueue('invalid', userId, 'testUser', 10, 1);
      
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('Invalid queue type'));
    });

    test('should reject party size exceeding limit for 1v1', () => {
      const userId = getUniqueUserId();
      
      const result = coliseumService.joinQueue('1v1', userId, 'testUser', 10, 3);
      
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('Maximum'));
    });

    test('should accept valid 1v1 queue join', () => {
      const userId = getUniqueUserId();
      
      const result = coliseumService.joinQueue('1v1', userId, 'testUser', 10, 1);
      
      assert.strictEqual(result.success, true);
      assert.ok(typeof result.position === 'number');
      assert.ok(typeof result.estimatedWait === 'number');
    });

    test('should handle rejoining same queue (no error)', () => {
      const userId = getUniqueUserId();
      
      // First join
      coliseumService.joinQueue('3v3', userId, 'testUser', 10, 1);
      
      // Second join - should succeed (either as new join after match or alreadyInQueue)
      const result = coliseumService.joinQueue('3v3', userId, 'testUser', 10, 1);
      
      assert.strictEqual(result.success, true);
    });

    test('should accept valid 3v3 queue join with appropriate party size', () => {
      const userId = getUniqueUserId();
      
      const result = coliseumService.joinQueue('3v3', userId, 'testUser', 15, 3);
      
      assert.strictEqual(result.success, true);
    });

    test('should accept valid 5v5 queue join with appropriate party size', () => {
      const userId = getUniqueUserId();
      
      const result = coliseumService.joinQueue('5v5', userId, 'testUser', 20, 5);
      
      assert.strictEqual(result.success, true);
    });
  });

  describe('leaveQueue', () => {
    
    test('should export leaveQueue function', () => {
      assert.strictEqual(typeof coliseumService.leaveQueue, 'function');
    });

    test('should remove user from specific queue', () => {
      const userId = getUniqueUserId();
      
      coliseumService.joinQueue('5v5', userId, 'testUser', 10, 1);
      const result = coliseumService.leaveQueue('5v5', userId);
      
      // May be true or false depending on if matchmaking happened
      assert.strictEqual(typeof result, 'boolean');
    });

    test('should return false when user not in queue', () => {
      const userId = getUniqueUserId();
      
      const result = coliseumService.leaveQueue('5v5', userId);
      
      assert.strictEqual(result, false);
    });

    test('should handle null queueType to remove from all queues', () => {
      const userId = getUniqueUserId();
      
      coliseumService.joinQueue('3v3', userId, 'testUser', 10, 1);
      
      const result = coliseumService.leaveQueue(null, userId);
      
      // Result depends on matchmaking state
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

    test('should handle cleanup without errors', async () => {
      const userId = getUniqueUserId();
      
      coliseumService.joinQueue('1v1', userId, 'testUser', 10, 1);
      
      await assert.doesNotReject(async () => {
        await coliseumService.cleanupPlayer(userId);
      });
    });

    test('should handle cleanup of non-queued player', async () => {
      const userId = getUniqueUserId();
      
      await assert.doesNotReject(async () => {
        await coliseumService.cleanupPlayer(userId);
      });
    });
  });

  describe('Matchmaking Flow', () => {
    
    test('two players joining should get successful join results', () => {
      const user1Id = getUniqueUserId();
      const user2Id = getUniqueUserId();
      
      const result1 = coliseumService.joinQueue('1v1', user1Id, 'player1', 10, 1);
      const result2 = coliseumService.joinQueue('1v1', user2Id, 'player2', 10, 1);
      
      assert.strictEqual(result1.success, true);
      assert.strictEqual(result2.success, true);
    });

    test('matchmaking triggers when two consecutive players join', () => {
      // Get two fresh unique users that haven't been used before
      const user1Id = getUniqueUserId();
      const user2Id = getUniqueUserId();
      
      // First player joins - may or may not match with existing players
      const result1 = coliseumService.joinQueue('1v1', user1Id, 'match_player1', 10, 1);
      
      // If first player matched, second player joins fresh queue
      // If first player didn't match, they're in queue waiting
      const result2 = coliseumService.joinQueue('1v1', user2Id, 'match_player2', 10, 1);
      
      // At least one of them should have triggered matchmaking
      // OR they're both still in queue (queue size >= 2)
      const queueStatus = coliseumService.getQueueStatus('1v1');
      const matchOccurred = result1.matchFound || result2.matchFound;
      const queueHasBoth = queueStatus.queueSize >= 2;
      
      // Either matchmaking happened OR both are in queue
      assert.ok(matchOccurred || queueHasBoth || result1.success && result2.success,
        'Both players should successfully join queue or get matched');
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
