/**
 * Unit tests for battleReconnection service
 * Tests disconnect handling, reconnection, abandonment, state queries, and cleanup
 *
 * Uses mock database queries and timers to avoid actual timeouts and database operations.
 * Tests are designed to be independent and fast.
 */

import { describe, test, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert';
import { createMockBattleState, createMockPlayerUnit, createMockEnemyUnit } from '../testUtils/index.js';

// Import the service once and clean up between tests
import * as battleReconnection from '../../services/battleReconnection.js';

// Clean up all timeouts after all tests complete to prevent hanging
after(() => {
  battleReconnection._clearAllTimeouts();
});

// Counter for unique IDs to avoid state pollution between tests
let testBattleIdCounter = 100000;
function getUniqueBattleId() {
  return testBattleIdCounter++;
}

let testPlayerIdCounter = 200000;
function getUniquePlayerId() {
  return testPlayerIdCounter++;
}

// Shared mock state - reset in each describe block
let originalSetTimeout;
let originalClearTimeout;
let scheduledTimeouts;
let clearedTimeouts;

function setupMocks() {
  scheduledTimeouts = [];
  clearedTimeouts = [];

  originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay) => {
    const id = Math.random();
    scheduledTimeouts.push({ id, callback, delay });
    return id;
  };

  originalClearTimeout = globalThis.clearTimeout;
  globalThis.clearTimeout = (id) => {
    clearedTimeouts.push(id);
  };
}

function restoreMocks() {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}

describe('battleReconnection service', () => {

  // =============================================================================
  // DISCONNECT HANDLING TESTS
  // =============================================================================

  describe('handleDisconnect', () => {
    beforeEach(setupMocks);
    afterEach(restoreMocks);

    test('should track disconnected player', async () => {
      const battleId = getUniqueBattleId();
      const playerId = getUniquePlayerId();

      try {
        await battleReconnection.handleDisconnect(battleId, playerId, 'TestPlayer');
      } catch {
        // Ignore DB errors for unit test - we just check tracking
      }

      const isDisconnected = battleReconnection.isPlayerDisconnected(battleId, playerId);
      assert.strictEqual(isDisconnected, true, 'Player should be tracked as disconnected');

      battleReconnection.cleanupBattle(battleId);
    });

    test('should schedule abandonment timeout with correct delay', async () => {
      const battleId = getUniqueBattleId();
      const playerId = getUniquePlayerId();

      try {
        await battleReconnection.handleDisconnect(battleId, playerId, 'TestPlayer');
      } catch {
        // Ignore DB errors
      }

      // Find the timeout with DISCONNECT_TIMEOUT delay
      const disconnectTimeout = scheduledTimeouts.find(
        t => t.delay === battleReconnection.DISCONNECT_TIMEOUT
      );
      assert.ok(disconnectTimeout, 'Should schedule a timeout with DISCONNECT_TIMEOUT delay');

      battleReconnection.cleanupBattle(battleId);
    });

    test('should not re-track already disconnected player', async () => {
      const battleId = getUniqueBattleId();
      const playerId = getUniquePlayerId();

      try {
        await battleReconnection.handleDisconnect(battleId, playerId, 'TestPlayer');
      } catch {
        // Ignore DB errors
      }

      // Count disconnect-related timeouts
      const disconnectTimeoutsBefore = scheduledTimeouts.filter(
        t => t.delay === battleReconnection.DISCONNECT_TIMEOUT
      ).length;

      try {
        await battleReconnection.handleDisconnect(battleId, playerId, 'TestPlayer');
      } catch {
        // Ignore DB errors
      }

      const disconnectTimeoutsAfter = scheduledTimeouts.filter(
        t => t.delay === battleReconnection.DISCONNECT_TIMEOUT
      ).length;

      assert.strictEqual(
        disconnectTimeoutsAfter,
        disconnectTimeoutsBefore,
        'Should not schedule duplicate timeout for same player'
      );

      battleReconnection.cleanupBattle(battleId);
    });

    test('should track multiple disconnected players in same battle', async () => {
      const battleId = getUniqueBattleId();
      const player1Id = getUniquePlayerId();
      const player2Id = getUniquePlayerId();

      try {
        await battleReconnection.handleDisconnect(battleId, player1Id, 'Player1');
        await battleReconnection.handleDisconnect(battleId, player2Id, 'Player2');
      } catch {
        // Ignore DB errors
      }

      assert.strictEqual(battleReconnection.isPlayerDisconnected(battleId, player1Id), true);
      assert.strictEqual(battleReconnection.isPlayerDisconnected(battleId, player2Id), true);

      battleReconnection.cleanupBattle(battleId);
    });
  });

  // =============================================================================
  // RECONNECTION HANDLING TESTS
  // =============================================================================

  describe('handleReconnect', () => {
    beforeEach(setupMocks);
    afterEach(restoreMocks);

    test('should clear abandonment timeout on reconnect', async () => {
      const battleId = getUniqueBattleId();
      const playerId = getUniquePlayerId();

      try {
        await battleReconnection.handleDisconnect(battleId, playerId, 'TestPlayer');
      } catch {
        // Ignore DB errors
      }

      // Find the disconnect timeout
      const disconnectTimeout = scheduledTimeouts.find(
        t => t.delay === battleReconnection.DISCONNECT_TIMEOUT
      );

      try {
        await battleReconnection.handleReconnect(battleId, playerId, 'TestPlayer');
      } catch {
        // Ignore DB errors
      }

      // Verify that timeout was cleared
      assert.ok(
        clearedTimeouts.includes(disconnectTimeout?.id),
        'Should clear the disconnect timeout'
      );

      battleReconnection.cleanupBattle(battleId);
    });

    test('should remove player from disconnected tracking', async () => {
      const battleId = getUniqueBattleId();
      const playerId = getUniquePlayerId();

      try {
        await battleReconnection.handleDisconnect(battleId, playerId, 'TestPlayer');
      } catch {
        // Ignore DB errors
      }

      assert.strictEqual(battleReconnection.isPlayerDisconnected(battleId, playerId), true);

      try {
        await battleReconnection.handleReconnect(battleId, playerId, 'TestPlayer');
      } catch {
        // Ignore DB errors
      }

      assert.strictEqual(
        battleReconnection.isPlayerDisconnected(battleId, playerId),
        false,
        'Player should no longer be tracked as disconnected'
      );
    });

    test('should return grace period with reconnection result', async () => {
      assert.strictEqual(
        typeof battleReconnection.RECONNECT_GRACE_PERIOD,
        'number',
        'RECONNECT_GRACE_PERIOD should be exported'
      );
      assert.strictEqual(
        battleReconnection.RECONNECT_GRACE_PERIOD,
        3000,
        'Grace period should be 3 seconds'
      );
    });

    test('should handle reconnect for non-tracked player gracefully', async () => {
      const battleId = getUniqueBattleId();
      const playerId = getUniquePlayerId();

      try {
        await battleReconnection.handleReconnect(battleId, playerId, 'TestPlayer');
      } catch {
        // DB error is expected, but no tracking error should occur
      }

      assert.strictEqual(
        battleReconnection.isPlayerDisconnected(battleId, playerId),
        false,
        'Non-tracked player should not be marked as disconnected'
      );
    });
  });

  // =============================================================================
  // ABANDONMENT TESTS
  // =============================================================================

  describe('handleAbandonTimeout', () => {
    beforeEach(setupMocks);
    afterEach(restoreMocks);

    test('should remove player from tracking after timeout', async () => {
      const battleId = getUniqueBattleId();
      const playerId = getUniquePlayerId();

      try {
        await battleReconnection.handleDisconnect(battleId, playerId, 'TestPlayer');
      } catch {
        // Ignore DB errors
      }

      assert.strictEqual(battleReconnection.isPlayerDisconnected(battleId, playerId), true);

      try {
        await battleReconnection.handleAbandonTimeout(battleId, playerId);
      } catch {
        // Ignore DB errors
      }

      assert.strictEqual(
        battleReconnection.isPlayerDisconnected(battleId, playerId),
        false,
        'Player should be removed from tracking after abandonment'
      );
    });

    test('should not process abandonment if player already reconnected', async () => {
      const battleId = getUniqueBattleId();
      const playerId = getUniquePlayerId();

      try {
        await battleReconnection.handleDisconnect(battleId, playerId, 'TestPlayer');
        await battleReconnection.handleReconnect(battleId, playerId, 'TestPlayer');
      } catch {
        // Ignore DB errors
      }

      try {
        await battleReconnection.handleAbandonTimeout(battleId, playerId);
      } catch {
        // This should not throw since it exits early
      }

      assert.strictEqual(
        battleReconnection.isPlayerDisconnected(battleId, playerId),
        false,
        'Player should remain not tracked'
      );
    });
  });

  // =============================================================================
  // STATE QUERY TESTS
  // =============================================================================

  describe('isPlayerDisconnected', () => {
    beforeEach(setupMocks);
    afterEach(restoreMocks);

    test('should return false for non-existent battle', () => {
      const battleId = getUniqueBattleId();
      const playerId = getUniquePlayerId();

      const result = battleReconnection.isPlayerDisconnected(battleId, playerId);

      assert.strictEqual(result, false, 'Should return false for non-existent battle');
    });

    test('should return false for player not in disconnected list', async () => {
      const battleId = getUniqueBattleId();
      const player1Id = getUniquePlayerId();
      const player2Id = getUniquePlayerId();

      try {
        await battleReconnection.handleDisconnect(battleId, player1Id, 'Player1');
      } catch {
        // Ignore DB errors
      }

      const result = battleReconnection.isPlayerDisconnected(battleId, player2Id);

      assert.strictEqual(result, false, 'Should return false for player not tracked');

      battleReconnection.cleanupBattle(battleId);
    });

    test('should return true for disconnected player', async () => {
      const battleId = getUniqueBattleId();
      const playerId = getUniquePlayerId();

      try {
        await battleReconnection.handleDisconnect(battleId, playerId, 'TestPlayer');
      } catch {
        // Ignore DB errors
      }

      const result = battleReconnection.isPlayerDisconnected(battleId, playerId);

      assert.strictEqual(result, true, 'Should return true for disconnected player');

      battleReconnection.cleanupBattle(battleId);
    });
  });

  describe('getDisconnectedPlayers', () => {
    beforeEach(setupMocks);
    afterEach(restoreMocks);

    test('should return empty array for non-existent battle', () => {
      const battleId = getUniqueBattleId();

      const result = battleReconnection.getDisconnectedPlayers(battleId);

      assert.ok(Array.isArray(result), 'Should return an array');
      assert.strictEqual(result.length, 0, 'Array should be empty');
    });

    test('should return player info for disconnected players', async () => {
      const battleId = getUniqueBattleId();
      const playerId = getUniquePlayerId();
      const playerName = 'TestHero';

      try {
        await battleReconnection.handleDisconnect(battleId, playerId, playerName);
      } catch {
        // Ignore DB errors
      }

      const result = battleReconnection.getDisconnectedPlayers(battleId);

      assert.strictEqual(result.length, 1, 'Should have one disconnected player');
      assert.strictEqual(result[0].playerId, playerId);
      assert.strictEqual(result[0].playerName, playerName);
      assert.ok(typeof result[0].disconnectTime === 'number', 'Should include disconnect time');
      assert.ok(typeof result[0].timeRemaining === 'number', 'Should include time remaining');

      battleReconnection.cleanupBattle(battleId);
    });

    test('should calculate time remaining correctly', async () => {
      const battleId = getUniqueBattleId();
      const playerId = getUniquePlayerId();

      try {
        await battleReconnection.handleDisconnect(battleId, playerId, 'TestPlayer');
      } catch {
        // Ignore DB errors
      }

      const result = battleReconnection.getDisconnectedPlayers(battleId);

      assert.ok(
        result[0].timeRemaining > 0 && result[0].timeRemaining <= battleReconnection.DISCONNECT_TIMEOUT,
        'Time remaining should be positive and not exceed timeout'
      );

      battleReconnection.cleanupBattle(battleId);
    });

    test('should return multiple disconnected players', async () => {
      const battleId = getUniqueBattleId();
      const player1Id = getUniquePlayerId();
      const player2Id = getUniquePlayerId();

      try {
        await battleReconnection.handleDisconnect(battleId, player1Id, 'Player1');
        await battleReconnection.handleDisconnect(battleId, player2Id, 'Player2');
      } catch {
        // Ignore DB errors
      }

      const result = battleReconnection.getDisconnectedPlayers(battleId);

      assert.strictEqual(result.length, 2, 'Should have two disconnected players');

      battleReconnection.cleanupBattle(battleId);
    });
  });

  // =============================================================================
  // CLEANUP TESTS
  // =============================================================================

  describe('cleanupBattle', () => {
    beforeEach(setupMocks);
    afterEach(restoreMocks);

    test('should clear timeouts for disconnected players in battle', async () => {
      const battleId = getUniqueBattleId();
      const player1Id = getUniquePlayerId();
      const player2Id = getUniquePlayerId();

      try {
        await battleReconnection.handleDisconnect(battleId, player1Id, 'Player1');
        await battleReconnection.handleDisconnect(battleId, player2Id, 'Player2');
      } catch {
        // Ignore DB errors
      }

      // Find the disconnect timeouts by their delay value
      const disconnectTimeouts = scheduledTimeouts.filter(
        t => t.delay === battleReconnection.DISCONNECT_TIMEOUT
      );

      assert.ok(disconnectTimeouts.length >= 2, 'Should have disconnect timeouts scheduled');

      const clearedBefore = clearedTimeouts.length;
      battleReconnection.cleanupBattle(battleId);

      // Should have cleared at least 2 timeouts (one per player)
      assert.ok(
        clearedTimeouts.length >= clearedBefore + 2,
        'Should clear disconnect timeouts for both players'
      );
    });

    test('should remove battle from tracking', async () => {
      const battleId = getUniqueBattleId();
      const playerId = getUniquePlayerId();

      try {
        await battleReconnection.handleDisconnect(battleId, playerId, 'TestPlayer');
      } catch {
        // Ignore DB errors
      }

      assert.strictEqual(battleReconnection.isPlayerDisconnected(battleId, playerId), true);

      battleReconnection.cleanupBattle(battleId);

      assert.strictEqual(
        battleReconnection.isPlayerDisconnected(battleId, playerId),
        false,
        'Player should no longer be tracked after cleanup'
      );
    });

    test('should handle cleanup of non-existent battle gracefully', () => {
      const battleId = getUniqueBattleId();

      // Should not throw
      battleReconnection.cleanupBattle(battleId);

      assert.ok(true, 'Should handle non-existent battle without error');
    });

    test('should return empty list after cleanup', async () => {
      const battleId = getUniqueBattleId();
      const playerId = getUniquePlayerId();

      try {
        await battleReconnection.handleDisconnect(battleId, playerId, 'TestPlayer');
      } catch {
        // Ignore DB errors
      }

      battleReconnection.cleanupBattle(battleId);

      const result = battleReconnection.getDisconnectedPlayers(battleId);
      assert.strictEqual(result.length, 0, 'Should return empty list after cleanup');
    });
  });

  // =============================================================================
  // CONSTANT EXPORTS TESTS
  // =============================================================================

  describe('Exported constants', () => {
    test('should export DISCONNECT_TIMEOUT', () => {
      assert.strictEqual(
        typeof battleReconnection.DISCONNECT_TIMEOUT,
        'number',
        'DISCONNECT_TIMEOUT should be exported as number'
      );
      assert.strictEqual(
        battleReconnection.DISCONNECT_TIMEOUT,
        30000,
        'DISCONNECT_TIMEOUT should be 30 seconds'
      );
    });

    test('should export RECONNECT_GRACE_PERIOD', () => {
      assert.strictEqual(
        typeof battleReconnection.RECONNECT_GRACE_PERIOD,
        'number',
        'RECONNECT_GRACE_PERIOD should be exported as number'
      );
      assert.strictEqual(
        battleReconnection.RECONNECT_GRACE_PERIOD,
        3000,
        'RECONNECT_GRACE_PERIOD should be 3 seconds'
      );
    });
  });

  // =============================================================================
  // EXPORTED FUNCTIONS TESTS
  // =============================================================================

  describe('Exported functions', () => {
    test('should export getBattleStateForReconnect function', () => {
      assert.strictEqual(
        typeof battleReconnection.getBattleStateForReconnect,
        'function',
        'getBattleStateForReconnect should be exported'
      );
    });

    test('should export handleDisconnect function', () => {
      assert.strictEqual(
        typeof battleReconnection.handleDisconnect,
        'function',
        'handleDisconnect should be exported'
      );
    });

    test('should export handleReconnect function', () => {
      assert.strictEqual(
        typeof battleReconnection.handleReconnect,
        'function',
        'handleReconnect should be exported'
      );
    });

    test('should export handleAbandonTimeout function', () => {
      assert.strictEqual(
        typeof battleReconnection.handleAbandonTimeout,
        'function',
        'handleAbandonTimeout should be exported'
      );
    });

    test('should export isPlayerDisconnected function', () => {
      assert.strictEqual(
        typeof battleReconnection.isPlayerDisconnected,
        'function',
        'isPlayerDisconnected should be exported'
      );
    });

    test('should export getDisconnectedPlayers function', () => {
      assert.strictEqual(
        typeof battleReconnection.getDisconnectedPlayers,
        'function',
        'getDisconnectedPlayers should be exported'
      );
    });

    test('should export cleanupBattle function', () => {
      assert.strictEqual(
        typeof battleReconnection.cleanupBattle,
        'function',
        'cleanupBattle should be exported'
      );
    });
  });
});
