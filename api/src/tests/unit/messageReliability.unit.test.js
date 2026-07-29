/**
 * Unit tests for Message Reliability System
 *
 * Tests server-side ACK tracking and retry logic (api/src/services/messageReliability.js)
 *
 * Key functionality tested:
 * - Sequence number generation per battle
 * - ACK tracking and removal
 * - Retry scheduling and max retry handling
 * - Cleanup of connections and battles
 * - Helper functions for debugging/testing
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { WebSocket } from 'ws';

import {
  getNextSequence,
  sendWithAck,
  sendWithAckAfterRecovery,
  classifyReliableBattleMapWirePayload,
  assertReliableBattleMapWirePayloadWithinBudget,
  handleAck,
  scheduleRetry,
  triggerFullStateSync,
  cleanupConnection,
  cleanupUserSequence,
  cleanupBattle,
  getPendingCount,
  getPendingAcks,
  getCurrentSequence,
  stopCleanupInterval,
  ACK_TIMEOUT_MS,
  MAX_RETRIES,
  CLEANUP_INTERVAL_MS
} from '../../services/messageReliability.js';
import {
  BATTLE_MAP_INITIAL_SNAPSHOT_COMPRESSED_BYTES_ENV,
  BATTLE_MAP_INITIAL_SNAPSHOT_UNCOMPRESSED_BYTES_ENV,
  getBattleMapOperationalMetrics,
  resetBattleMapOperationalMetrics
} from '../../services/battle/BattleMapOperations.js';
import {
  BattleStateNotFoundError,
  battleStateRepository
} from '../../services/battle/BattleStateRepository.js';
import { createBattleMutableStateV1 } from '../../../../shared/battleStateProtocol.js';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create a mock WebSocket with configurable readyState
 */
function createMockWs(readyState = WebSocket.OPEN) {
  const sentMessages = [];
  return {
    readyState,
    send: mock.fn((data) => {
      sentMessages.push(JSON.parse(data));
    }),
    sentMessages,
    getLastMessage() {
      return sentMessages[sentMessages.length - 1];
    },
    clearMessages() {
      sentMessages.length = 0;
    }
  };
}

/**
 * Generate unique battle and connection IDs for test isolation
 */
let testCounter = 0;
function uniqueId(prefix) {
  return `${prefix}_${Date.now()}_${++testCounter}`;
}

function getPendingMessage(connectionId, battleId, seq) {
  return [...(getPendingAcks(connectionId)?.values() || [])].find(
    pending => String(pending.battleId) === String(battleId) && pending.seq === seq
  );
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Message Reliability Service', () => {
  afterEach(() => {
    // Stop cleanup interval to prevent timer warnings
    stopCleanupInterval();
  });

  // ==========================================================================
  // Configuration Constants
  // ==========================================================================

  describe('Configuration Constants', () => {
    it('should export ACK_TIMEOUT_MS as a positive number', () => {
      assert.ok(typeof ACK_TIMEOUT_MS === 'number', 'ACK_TIMEOUT_MS should be a number');
      assert.ok(ACK_TIMEOUT_MS > 0, 'ACK_TIMEOUT_MS should be positive');
      assert.strictEqual(ACK_TIMEOUT_MS, 2000, 'ACK_TIMEOUT_MS should be 2000ms');
    });

    it('should export MAX_RETRIES as a positive integer', () => {
      assert.ok(typeof MAX_RETRIES === 'number', 'MAX_RETRIES should be a number');
      assert.ok(MAX_RETRIES > 0, 'MAX_RETRIES should be positive');
      assert.ok(Number.isInteger(MAX_RETRIES), 'MAX_RETRIES should be an integer');
      assert.strictEqual(MAX_RETRIES, 3, 'MAX_RETRIES should be 3');
    });

    it('should export CLEANUP_INTERVAL_MS as a positive number', () => {
      assert.ok(typeof CLEANUP_INTERVAL_MS === 'number', 'CLEANUP_INTERVAL_MS should be a number');
      assert.ok(CLEANUP_INTERVAL_MS > 0, 'CLEANUP_INTERVAL_MS should be positive');
      assert.strictEqual(CLEANUP_INTERVAL_MS, 30000, 'CLEANUP_INTERVAL_MS should be 30000ms');
    });
  });

  // ==========================================================================
  // Sequence Generation
  // ==========================================================================

  describe('getNextSequence', () => {
    it('should return incrementing sequence numbers for a battle and user', () => {
      const battleId = uniqueId('battle');
      const userId = uniqueId('user');

      const seq1 = getNextSequence(battleId, userId);
      const seq2 = getNextSequence(battleId, userId);
      const seq3 = getNextSequence(battleId, userId);

      assert.strictEqual(seq1, 1, 'First sequence should be 1');
      assert.strictEqual(seq2, 2, 'Second sequence should be 2');
      assert.strictEqual(seq3, 3, 'Third sequence should be 3');

      // Cleanup
      cleanupBattle(battleId);
    });

    it('should maintain separate sequences per battle', () => {
      const battleA = uniqueId('battleA');
      const battleB = uniqueId('battleB');
      const userId = uniqueId('user');

      const seqA1 = getNextSequence(battleA, userId);
      const seqB1 = getNextSequence(battleB, userId);
      const seqA2 = getNextSequence(battleA, userId);
      const seqB2 = getNextSequence(battleB, userId);

      assert.strictEqual(seqA1, 1, 'Battle A first sequence should be 1');
      assert.strictEqual(seqB1, 1, 'Battle B first sequence should be 1');
      assert.strictEqual(seqA2, 2, 'Battle A second sequence should be 2');
      assert.strictEqual(seqB2, 2, 'Battle B second sequence should be 2');

      // Cleanup
      cleanupBattle(battleA);
      cleanupBattle(battleB);
    });

    it('should maintain separate sequences per user in same battle', () => {
      const battleId = uniqueId('battle');
      const userA = uniqueId('userA');
      const userB = uniqueId('userB');

      const seqA1 = getNextSequence(battleId, userA);
      const seqB1 = getNextSequence(battleId, userB);
      const seqA2 = getNextSequence(battleId, userA);
      const seqB2 = getNextSequence(battleId, userB);

      assert.strictEqual(seqA1, 1, 'User A first sequence should be 1');
      assert.strictEqual(seqB1, 1, 'User B first sequence should be 1');
      assert.strictEqual(seqA2, 2, 'User A second sequence should be 2');
      assert.strictEqual(seqB2, 2, 'User B second sequence should be 2');

      // Cleanup
      cleanupBattle(battleId);
    });

    it('should start sequences at 1 for new battles', () => {
      const battleId = uniqueId('battle');
      const userId = uniqueId('user');

      const seq = getNextSequence(battleId, userId);

      assert.strictEqual(seq, 1, 'New battle should start at sequence 1');

      // Cleanup
      cleanupBattle(battleId);
    });
  });

  // ==========================================================================
  // getCurrentSequence Helper
  // ==========================================================================

  describe('getCurrentSequence', () => {
    it('should return 0 for unknown battles', () => {
      const unknownBattle = uniqueId('unknown');

      const seq = getCurrentSequence(unknownBattle);

      assert.strictEqual(seq, 0, 'Unknown battle should have sequence 0');
    });

    it('should return 0 for unknown user in known battle', () => {
      const battleId = uniqueId('battle');
      const userId = uniqueId('user');
      const unknownUser = uniqueId('unknown');

      getNextSequence(battleId, userId);

      const seq = getCurrentSequence(battleId, unknownUser);

      assert.strictEqual(seq, 0, 'Unknown user should have sequence 0');

      // Cleanup
      cleanupBattle(battleId);
    });

    it('should return current sequence for specific user', () => {
      const battleId = uniqueId('battle');
      const userId = uniqueId('user');

      getNextSequence(battleId, userId);
      getNextSequence(battleId, userId);
      getNextSequence(battleId, userId);

      const current = getCurrentSequence(battleId, userId);

      assert.strictEqual(current, 3, 'Should return current sequence number for user');

      // Cleanup
      cleanupBattle(battleId);
    });

    it('should return max sequence across all users when userId not provided', () => {
      const battleId = uniqueId('battle');
      const userA = uniqueId('userA');
      const userB = uniqueId('userB');

      // User A gets 2 messages
      getNextSequence(battleId, userA);
      getNextSequence(battleId, userA);
      // User B gets 5 messages
      for (let i = 0; i < 5; i++) {
        getNextSequence(battleId, userB);
      }

      const maxSeq = getCurrentSequence(battleId);
      const userASeq = getCurrentSequence(battleId, userA);
      const userBSeq = getCurrentSequence(battleId, userB);

      assert.strictEqual(userASeq, 2, 'User A should have sequence 2');
      assert.strictEqual(userBSeq, 5, 'User B should have sequence 5');
      assert.strictEqual(maxSeq, 5, 'Should return max sequence (5) across all users');

      // Cleanup
      cleanupBattle(battleId);
    });
  });

  // ==========================================================================
  // sendWithAck - ACK Tracking
  // ==========================================================================

  describe('sendWithAck', () => {
    it('classifies full-state and mutable-delta battle-map messages only', () => {
      assert.strictEqual(classifyReliableBattleMapWirePayload({
        type: 'battle:state_update',
        payload: { snapshot: {} }
      }), 'initialSnapshot');
      assert.strictEqual(classifyReliableBattleMapWirePayload({
        type: 'battle:state_update',
        payload: { state: {} }
      }), 'initialSnapshot');
      assert.strictEqual(classifyReliableBattleMapWirePayload({
        type: 'battle:state_update',
        payload: { reason: 'full_sync' }
      }), 'initialSnapshot');
      assert.strictEqual(classifyReliableBattleMapWirePayload({
        type: 'battle:state_update',
        payload: { update: {} }
      }), 'mutableDelta');
      assert.strictEqual(classifyReliableBattleMapWirePayload({
        type: 'party:updated',
        payload: { state: {} }
      }), null);
    });

    it('enforces the wire budget on the final ACK-decorated envelope boundary', () => {
      const mockWs = createMockWs();
      const battleId = 626262;
      const connectionId = 737373;
      const message = {
        type: 'battle:state_update',
        payload: { snapshot: { units: [] }, reason: 'full_sync' }
      };
      const previousUncompressed =
        process.env[BATTLE_MAP_INITIAL_SNAPSHOT_UNCOMPRESSED_BYTES_ENV];
      const previousCompressed =
        process.env[BATTLE_MAP_INITIAL_SNAPSHOT_COMPRESSED_BYTES_ENV];

      try {
        process.env[BATTLE_MAP_INITIAL_SNAPSHOT_UNCOMPRESSED_BYTES_ENV] = '1000000';
        process.env[BATTLE_MAP_INITIAL_SNAPSHOT_COMPRESSED_BYTES_ENV] = '1000000';
        const reliableMessage = {
          ...message,
          seq: 1,
          ack: true,
          battleId
        };
        const exactBytes =
          assertReliableBattleMapWirePayloadWithinBudget(reliableMessage).uncompressed;
        process.env[BATTLE_MAP_INITIAL_SNAPSHOT_UNCOMPRESSED_BYTES_ENV] =
          String(exactBytes);
        assert.deepStrictEqual(
          assertReliableBattleMapWirePayloadWithinBudget({ type: 'party:updated' }),
          null
        );
        assert.strictEqual(
          sendWithAck(mockWs, message, battleId, connectionId),
          1
        );
        assert.strictEqual(mockWs.send.mock.callCount(), 1);
        assert.strictEqual(handleAck(connectionId, battleId, 1), true);
        cleanupBattle(battleId);

        process.env[BATTLE_MAP_INITIAL_SNAPSHOT_UNCOMPRESSED_BYTES_ENV] =
          String(exactBytes - 1);
        assert.throws(
          () => sendWithAck(mockWs, message, battleId, connectionId),
          error => error?.code === 'BATTLE_MAP_WIRE_PAYLOAD_TOO_LARGE'
            && error?.kind === 'initialSnapshot'
            && error?.sizes?.uncompressed === exactBytes
        );
        assert.strictEqual(getPendingCount(connectionId), 0);
        assert.strictEqual(mockWs.send.mock.callCount(), 1);

        process.env[BATTLE_MAP_INITIAL_SNAPSHOT_UNCOMPRESSED_BYTES_ENV] =
          String(exactBytes);
        assert.strictEqual(
          sendWithAck(mockWs, message, battleId, connectionId),
          1,
          'a rejected envelope must not consume a sequence number'
        );
      } finally {
        cleanupConnection(connectionId);
        cleanupBattle(battleId);
        if (previousUncompressed === undefined) {
          delete process.env[BATTLE_MAP_INITIAL_SNAPSHOT_UNCOMPRESSED_BYTES_ENV];
        } else {
          process.env[BATTLE_MAP_INITIAL_SNAPSHOT_UNCOMPRESSED_BYTES_ENV] =
            previousUncompressed;
        }
        if (previousCompressed === undefined) {
          delete process.env[BATTLE_MAP_INITIAL_SNAPSHOT_COMPRESSED_BYTES_ENV];
        } else {
          process.env[BATTLE_MAP_INITIAL_SNAPSHOT_COMPRESSED_BYTES_ENV] =
            previousCompressed;
        }
      }
    });

    it('should store pending message for tracking', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      sendWithAck(mockWs, { type: 'test' }, battleId, connectionId);

      assert.strictEqual(getPendingCount(connectionId), 1, 'Should have 1 pending ACK');

      // Cleanup
      cleanupConnection(connectionId);
      cleanupBattle(battleId);
    });

    it('should add seq and ack fields to message', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      sendWithAck(mockWs, { type: 'test', payload: 'data' }, battleId, connectionId);

      const sentMsg = mockWs.getLastMessage();
      assert.strictEqual(sentMsg.type, 'test', 'Should preserve original type');
      assert.strictEqual(sentMsg.payload, 'data', 'Should preserve original payload');
      assert.strictEqual(sentMsg.seq, 1, 'Should add seq field');
      assert.strictEqual(sentMsg.ack, true, 'Should add ack field');

      // Cleanup
      cleanupConnection(connectionId);
      cleanupBattle(battleId);
    });

    it('should return the sequence number assigned', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      const seq1 = sendWithAck(mockWs, { type: 'msg1' }, battleId, connectionId);
      const seq2 = sendWithAck(mockWs, { type: 'msg2' }, battleId, connectionId);

      assert.strictEqual(seq1, 1, 'First message should get seq 1');
      assert.strictEqual(seq2, 2, 'Second message should get seq 2');

      // Cleanup
      cleanupConnection(connectionId);
      cleanupBattle(battleId);
    });

    it('should track multiple pending messages simultaneously', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      sendWithAck(mockWs, { type: 'msg1' }, battleId, connectionId);
      sendWithAck(mockWs, { type: 'msg2' }, battleId, connectionId);
      sendWithAck(mockWs, { type: 'msg3' }, battleId, connectionId);

      assert.strictEqual(getPendingCount(connectionId), 3, 'Should have 3 pending ACKs');

      // Cleanup
      cleanupConnection(connectionId);
      cleanupBattle(battleId);
    });

    it('tracks identical sequences independently across two battles on one connection', async () => {
      const mockWs = createMockWs();
      const battleA = uniqueId('battleA');
      const battleB = uniqueId('battleB');
      const connectionId = uniqueId('conn');

      const seqA = sendWithAck(mockWs, { type: 'battleA:update' }, battleA, connectionId);
      const seqB = sendWithAck(mockWs, { type: 'battleB:update' }, battleB, connectionId);

      assert.strictEqual(seqA, 1);
      assert.strictEqual(seqB, 1);
      assert.strictEqual(getPendingCount(connectionId), 2);

      mockWs.clearMessages();
      mockWs.send.mock.resetCalls();
      await scheduleRetry(connectionId, battleA, seqA);

      assert.strictEqual(mockWs.send.mock.callCount(), 1);
      assert.strictEqual(mockWs.getLastMessage().type, 'battleA:update');
      assert.strictEqual(getPendingMessage(connectionId, battleA, seqA).retries, 1);
      assert.strictEqual(getPendingMessage(connectionId, battleB, seqB).retries, 0);

      assert.strictEqual(handleAck(connectionId, battleA, seqA), true);
      assert.strictEqual(getPendingCount(connectionId), 1);
      assert.strictEqual(handleAck(connectionId, battleB, seqB), true);
      assert.strictEqual(getPendingCount(connectionId), 0);

      cleanupBattle(battleA);
      cleanupBattle(battleB);
    });

    it('uses one sequence space for numeric and string forms of the same battle', () => {
      const mockWs = createMockWs();
      const connectionId = uniqueId('conn');

      const numericSeq = sendWithAck(
        mockWs,
        { type: 'numeric:update' },
        818181,
        connectionId
      );
      const stringSeq = sendWithAck(
        mockWs,
        { type: 'string:update' },
        '818181',
        connectionId
      );

      assert.strictEqual(numericSeq, 1);
      assert.strictEqual(stringSeq, 2);
      assert.strictEqual(getPendingCount(connectionId), 2);
      assert.strictEqual(handleAck(connectionId, '818181', numericSeq), true);
      assert.strictEqual(handleAck(connectionId, 818181, stringSeq), true);
      assert.strictEqual(getPendingCount(connectionId), 0);
      assert.strictEqual(getCurrentSequence('818181', connectionId), 2);

      cleanupBattle(818181);
      assert.strictEqual(getCurrentSequence('818181', connectionId), 0);
    });

    it('should not send if WebSocket is not OPEN', () => {
      const mockWs = createMockWs(WebSocket.CLOSED);
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      const seq = sendWithAck(mockWs, { type: 'test' }, battleId, connectionId);

      assert.strictEqual(mockWs.send.mock.callCount(), 0, 'Should not send to closed socket');
      // Should NOT track the message (prevents sequence gaps)
      assert.strictEqual(seq, -1, 'Should return -1 when connection not open');
      assert.strictEqual(getPendingCount(connectionId), 0, 'Should not track pending for closed connection');

      // Cleanup
      cleanupConnection(connectionId);
      cleanupBattle(battleId);
    });
  });

  // ==========================================================================
  // handleAck - ACK Processing
  // ==========================================================================

  describe('handleAck', () => {
    it('should remove pending message on valid ACK', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      const seq = sendWithAck(mockWs, { type: 'test' }, battleId, connectionId);
      assert.strictEqual(getPendingCount(connectionId), 1, 'Should have pending before ACK');

      const result = handleAck(connectionId, battleId, seq);

      assert.strictEqual(result, true, 'handleAck should return true for valid ACK');
      assert.strictEqual(getPendingCount(connectionId), 0, 'Should have no pending after ACK');

      // Cleanup
      cleanupBattle(battleId);
    });

    it('should return false for unexpected ACK (no pending)', () => {
      const connectionId = uniqueId('conn');
      const battleId = uniqueId('battle');

      const result = handleAck(connectionId, battleId, 999);

      assert.strictEqual(result, false, 'Should return false for unexpected ACK');
    });

    it('should return false for ACK with wrong battleId', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const wrongBattleId = uniqueId('wrongBattle');
      const connectionId = uniqueId('conn');

      const seq = sendWithAck(mockWs, { type: 'test' }, battleId, connectionId);

      const result = handleAck(connectionId, wrongBattleId, seq);

      assert.strictEqual(result, false, 'Should return false for wrong battleId');
      assert.strictEqual(getPendingCount(connectionId), 1, 'Pending should remain');

      // Cleanup
      cleanupConnection(connectionId);
      cleanupBattle(battleId);
    });

    it('should handle multiple ACKs in any order', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      const seq1 = sendWithAck(mockWs, { type: 'msg1' }, battleId, connectionId);
      const seq2 = sendWithAck(mockWs, { type: 'msg2' }, battleId, connectionId);
      const seq3 = sendWithAck(mockWs, { type: 'msg3' }, battleId, connectionId);

      // ACK in reverse order
      handleAck(connectionId, battleId, seq3);
      assert.strictEqual(getPendingCount(connectionId), 2, 'Should have 2 pending after first ACK');

      handleAck(connectionId, battleId, seq1);
      assert.strictEqual(getPendingCount(connectionId), 1, 'Should have 1 pending after second ACK');

      handleAck(connectionId, battleId, seq2);
      assert.strictEqual(getPendingCount(connectionId), 0, 'Should have 0 pending after all ACKs');

      // Cleanup
      cleanupBattle(battleId);
    });

    it('should return false for duplicate ACK', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      const seq = sendWithAck(mockWs, { type: 'test' }, battleId, connectionId);

      const result1 = handleAck(connectionId, battleId, seq);
      const result2 = handleAck(connectionId, battleId, seq);

      assert.strictEqual(result1, true, 'First ACK should succeed');
      assert.strictEqual(result2, false, 'Duplicate ACK should fail');

      // Cleanup
      cleanupBattle(battleId);
    });

    it('records fresh-snapshot recovery only after the client ACKs it', () => {
      resetBattleMapOperationalMetrics();
      const mockWs = createMockWs();
      const battleId = 424242;
      const connectionId = uniqueId('conn');
      const seq = sendWithAck(mockWs, {
        type: 'battle:state_update',
        payload: { reason: 'full_sync', stateRevision: 9 }
      }, battleId, connectionId);

      assert.strictEqual(
        getBattleMapOperationalMetrics().counters.freshSnapshotRecoverySucceeded,
        0
      );
      assert.strictEqual(handleAck(connectionId, battleId, seq), true);
      assert.strictEqual(
        getBattleMapOperationalMetrics().counters.freshSnapshotRecoverySucceeded,
        1
      );

      cleanupBattle(battleId);
      resetBattleMapOperationalMetrics();
    });
  });

  // ==========================================================================
  // getPendingCount / getPendingAcks Helpers
  // ==========================================================================

  describe('getPendingCount', () => {
    it('should return 0 for unknown connection', () => {
      const unknownConn = uniqueId('unknown');

      const count = getPendingCount(unknownConn);

      assert.strictEqual(count, 0, 'Unknown connection should have 0 pending');
    });

    it('should return correct count for active connection', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      sendWithAck(mockWs, { type: 'msg1' }, battleId, connectionId);
      sendWithAck(mockWs, { type: 'msg2' }, battleId, connectionId);

      const count = getPendingCount(connectionId);

      assert.strictEqual(count, 2, 'Should return correct pending count');

      // Cleanup
      cleanupConnection(connectionId);
      cleanupBattle(battleId);
    });
  });

  describe('getPendingAcks', () => {
    it('should return undefined for unknown connection', () => {
      const unknownConn = uniqueId('unknown');

      const pending = getPendingAcks(unknownConn);

      assert.strictEqual(pending, undefined, 'Unknown connection should return undefined');
    });

    it('should return Map of pending messages', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      const seq1 = sendWithAck(mockWs, { type: 'msg1' }, battleId, connectionId);
      const seq2 = sendWithAck(mockWs, { type: 'msg2' }, battleId, connectionId);

      const pending = getPendingAcks(connectionId);

      assert.ok(pending instanceof Map, 'Should return a Map');
      assert.strictEqual(pending.size, 2, 'Map should have 2 entries');
      assert.ok(getPendingMessage(connectionId, battleId, seq1), 'Should have seq1');
      assert.ok(getPendingMessage(connectionId, battleId, seq2), 'Should have seq2');

      // Cleanup
      cleanupConnection(connectionId);
      cleanupBattle(battleId);
    });

    it('should contain PendingMessage objects with correct properties', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      const seq = sendWithAck(mockWs, { type: 'test', data: 123 }, battleId, connectionId);

      const pendingMsg = getPendingMessage(connectionId, battleId, seq);

      assert.ok(pendingMsg, 'Should have pending message');
      assert.strictEqual(pendingMsg.battleId, battleId, 'Should have correct battleId');
      assert.strictEqual(pendingMsg.seq, seq, 'Should have correct seq');
      assert.deepStrictEqual(pendingMsg.message.type, 'test', 'Should have original message type');
      assert.deepStrictEqual(pendingMsg.message.data, 123, 'Should have original message data');
      assert.strictEqual(pendingMsg.retries, 0, 'Should start with 0 retries');
      assert.ok(pendingMsg.timestamp > 0, 'Should have timestamp');
      assert.ok(pendingMsg.timeoutId !== null, 'Should have timeoutId');

      // Cleanup
      cleanupConnection(connectionId);
      cleanupBattle(battleId);
    });
  });

  // ==========================================================================
  // Cleanup Functions
  // ==========================================================================

  describe('cleanupConnection', () => {
    it('should remove all pending ACKs for connection', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      sendWithAck(mockWs, { type: 'msg1' }, battleId, connectionId);
      sendWithAck(mockWs, { type: 'msg2' }, battleId, connectionId);
      sendWithAck(mockWs, { type: 'msg3' }, battleId, connectionId);

      assert.strictEqual(getPendingCount(connectionId), 3, 'Should have 3 pending before cleanup');

      cleanupConnection(connectionId);

      assert.strictEqual(getPendingCount(connectionId), 0, 'Should have 0 pending after cleanup');
      assert.strictEqual(getPendingAcks(connectionId), undefined, 'Connection map should be removed');

      // Cleanup
      cleanupBattle(battleId);
    });

    it('should clear all timeouts for connection', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      sendWithAck(mockWs, { type: 'test' }, battleId, connectionId);

      const pending = getPendingAcks(connectionId);
      const pendingMsg = pending.values().next().value;
      assert.ok(pendingMsg.timeoutId !== null, 'Should have timeout before cleanup');

      cleanupConnection(connectionId);

      // After cleanup, getPendingAcks returns undefined so we can't check timeoutId
      // But we can verify the cleanup completed without errors
      assert.strictEqual(getPendingAcks(connectionId), undefined, 'Connection should be cleaned up');

      // Cleanup
      cleanupBattle(battleId);
    });

    it('should handle cleanup of non-existent connection gracefully', () => {
      const unknownConn = uniqueId('unknown');

      // Should not throw
      cleanupConnection(unknownConn);

      assert.strictEqual(getPendingCount(unknownConn), 0, 'Should handle gracefully');
    });
  });

  describe('cleanupUserSequence', () => {
    it('should remove sequence counter for specific user in battle', () => {
      const battleId = uniqueId('battle');
      const userA = uniqueId('userA');
      const userB = uniqueId('userB');

      getNextSequence(battleId, userA);
      getNextSequence(battleId, userA);
      getNextSequence(battleId, userB);

      assert.strictEqual(getCurrentSequence(battleId, userA), 2, 'User A should have sequence 2');
      assert.strictEqual(getCurrentSequence(battleId, userB), 1, 'User B should have sequence 1');

      cleanupUserSequence(battleId, userA);

      assert.strictEqual(getCurrentSequence(battleId, userA), 0, 'User A sequence should be reset');
      assert.strictEqual(getCurrentSequence(battleId, userB), 1, 'User B sequence should be unaffected');

      // Cleanup
      cleanupBattle(battleId);
    });

    it('should remove battle entry when last user is cleaned up', () => {
      const battleId = uniqueId('battle');
      const userId = uniqueId('user');

      getNextSequence(battleId, userId);
      assert.strictEqual(getCurrentSequence(battleId), 1, 'Should have sequence before cleanup');

      cleanupUserSequence(battleId, userId);

      assert.strictEqual(getCurrentSequence(battleId), 0, 'Battle should have no sequence after last user removed');
    });

    it('should handle cleanup of non-existent user gracefully', () => {
      const battleId = uniqueId('battle');
      const userId = uniqueId('user');
      const unknownUser = uniqueId('unknown');

      getNextSequence(battleId, userId);

      // Should not throw
      cleanupUserSequence(battleId, unknownUser);

      assert.strictEqual(getCurrentSequence(battleId, userId), 1, 'Existing user should be unaffected');

      // Cleanup
      cleanupBattle(battleId);
    });

    it('should handle cleanup of non-existent battle gracefully', () => {
      const unknownBattle = uniqueId('unknown');
      const userId = uniqueId('user');

      // Should not throw
      cleanupUserSequence(unknownBattle, userId);
    });
  });

  describe('cleanupBattle', () => {
    it('should remove sequence counter for battle', () => {
      const battleId = uniqueId('battle');
      const userId = uniqueId('user');

      getNextSequence(battleId, userId);
      getNextSequence(battleId, userId);
      assert.strictEqual(getCurrentSequence(battleId), 2, 'Should have sequence before cleanup');

      cleanupBattle(battleId);

      assert.strictEqual(getCurrentSequence(battleId), 0, 'Sequence should be reset after cleanup');
    });

    it('should remove pending ACKs for battle across all connections', () => {
      const mockWs1 = createMockWs();
      const mockWs2 = createMockWs();
      const battleId = uniqueId('battle');
      const conn1 = uniqueId('conn1');
      const conn2 = uniqueId('conn2');

      sendWithAck(mockWs1, { type: 'msg1' }, battleId, conn1);
      sendWithAck(mockWs2, { type: 'msg2' }, battleId, conn2);

      assert.strictEqual(getPendingCount(conn1), 1, 'Conn1 should have 1 pending');
      assert.strictEqual(getPendingCount(conn2), 1, 'Conn2 should have 1 pending');

      // Cleanup battle - this should clear all pending ACKs and their timeouts
      cleanupBattle(battleId);

      assert.strictEqual(getPendingCount(conn1), 0, 'Conn1 should have 0 pending after battle cleanup');
      assert.strictEqual(getPendingCount(conn2), 0, 'Conn2 should have 0 pending after battle cleanup');

      // Also cleanup connections to clear any empty maps
      cleanupConnection(conn1);
      cleanupConnection(conn2);
    });

    it('should not affect pending ACKs for other battles', () => {
      const mockWs = createMockWs();
      const battleA = uniqueId('battleA');
      const battleB = uniqueId('battleB');
      const connectionId = uniqueId('conn');

      // Send message to battle A and immediately ACK to clear timeout
      const seqA = sendWithAck(mockWs, { type: 'msgA' }, battleA, connectionId);
      // ACK battle A message to clear its timeout
      handleAck(connectionId, battleA, seqA);

      // Send message to battle B
      sendWithAck(mockWs, { type: 'msgB' }, battleB, connectionId);

      // Now resend to battle A (without ACK)
      const seqA2 = sendWithAck(mockWs, { type: 'msgA2' }, battleA, connectionId);

      // Should have 2 pending: one for battle A, one for battle B
      assert.strictEqual(getPendingCount(connectionId), 2, 'Should have 2 pending total');

      // Cleanup battle A only
      cleanupBattle(battleA);

      // Battle B message should still be pending
      assert.strictEqual(getPendingCount(connectionId), 1, 'Should have 1 pending after partial cleanup');

      // Full cleanup
      cleanupConnection(connectionId);
      cleanupBattle(battleB);
    });

    it('should handle cleanup of non-existent battle gracefully', () => {
      const unknownBattle = uniqueId('unknown');

      // Should not throw
      cleanupBattle(unknownBattle);

      assert.strictEqual(getCurrentSequence(unknownBattle), 0, 'Should handle gracefully');
    });
  });

  // ==========================================================================
  // scheduleRetry - Retry Logic
  // ==========================================================================

  describe('scheduleRetry', () => {
    it('should increment retry counter on pending message', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      const seq = sendWithAck(mockWs, { type: 'test' }, battleId, connectionId);

      let pendingMsg = getPendingMessage(connectionId, battleId, seq);
      assert.strictEqual(pendingMsg.retries, 0, 'Should start with 0 retries');

      // Manually trigger retry (normally done by timeout)
      scheduleRetry(connectionId, battleId, seq);

      pendingMsg = getPendingMessage(connectionId, battleId, seq);
      assert.strictEqual(pendingMsg.retries, 1, 'Should have 1 retry after scheduleRetry');

      // Cleanup
      cleanupConnection(connectionId);
      cleanupBattle(battleId);
    });

    it('should resend message on retry', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      const seq = sendWithAck(mockWs, { type: 'test' }, battleId, connectionId);
      // Clear messages to reset send count
      mockWs.sentMessages.length = 0;
      mockWs.send.mock.resetCalls();

      scheduleRetry(connectionId, battleId, seq);

      // Verify the message was resent (at least once - could be more if timeout fired)
      assert.ok(mockWs.send.mock.callCount() >= 1, 'Should resend message at least once');
      const resentMsg = mockWs.getLastMessage();
      assert.strictEqual(resentMsg.type, 'test', 'Should resend same message');
      assert.strictEqual(resentMsg.seq, seq, 'Should have same seq');

      // Cleanup
      cleanupConnection(connectionId);
      cleanupBattle(battleId);
    });

    it('should handle non-existent connection gracefully', () => {
      const unknownConn = uniqueId('unknown');
      const battleId = uniqueId('battle');

      // Should not throw
      scheduleRetry(unknownConn, battleId, 1);
    });

    it('should handle non-existent sequence gracefully', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      sendWithAck(mockWs, { type: 'test' }, battleId, connectionId);

      // Should not throw for non-existent seq
      scheduleRetry(connectionId, battleId, 999);

      // Cleanup
      cleanupConnection(connectionId);
      cleanupBattle(battleId);
    });

    it('should cleanup pending when WebSocket is closed on retry', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      const seq = sendWithAck(mockWs, { type: 'test' }, battleId, connectionId);

      // Close the WebSocket
      mockWs.readyState = WebSocket.CLOSED;

      // Trigger retry - should cleanup since socket is closed
      scheduleRetry(connectionId, battleId, seq);

      // Pending for this battle should be cleaned up
      assert.strictEqual(getPendingCount(connectionId), 0, 'Should cleanup when socket closed');

      // Cleanup
      cleanupBattle(battleId);
    });

    it('keeps retry progress scheduled after synchronous resend failures', async () => {
      const mockWs = createMockWs();
      const battleId = 99998;
      const connectionId = uniqueId('conn');
      const seq = sendWithAck(mockWs, { type: 'test' }, battleId, connectionId);
      mockWs.send = mock.fn(() => {
        throw new Error('synchronous retry failure');
      });
      const loadBattleMock = mock.method(
        battleStateRepository,
        'loadBattle',
        async () => {
          throw new BattleStateNotFoundError(battleId);
        }
      );

      try {
        await scheduleRetry(connectionId, battleId, seq);
        let pending = getPendingMessage(connectionId, battleId, seq);
        assert.strictEqual(pending.retries, 1);
        assert.ok(
          pending.timeoutId,
          'A failed resend must retain a future retry timer'
        );

        await scheduleRetry(connectionId, battleId, seq);
        pending = getPendingMessage(connectionId, battleId, seq);
        assert.strictEqual(pending.retries, 2);
        assert.ok(pending.timeoutId);

        await scheduleRetry(connectionId, battleId, seq);
        assert.strictEqual(loadBattleMock.mock.callCount(), 1);
        assert.strictEqual(
          getPendingCount(connectionId),
          0,
          'Terminal recovery must clean up the exhausted pending message'
        );
      } finally {
        loadBattleMock.mock.restore();
        cleanupConnection(connectionId);
        cleanupBattle(battleId);
      }
    });
  });

  // ==========================================================================
  // Max Retries and Full State Sync
  // ==========================================================================

  describe('Max Retries Behavior', () => {
    it('should cleanup pending after MAX_RETRIES exceeded', async () => {
      const mockWs = createMockWs();
      const battleId = 99999;
      const connectionId = uniqueId('conn');
      const loadBattleMock = mock.method(
        battleStateRepository,
        'loadBattle',
        async () => {
          throw new BattleStateNotFoundError(battleId);
        }
      );

      const seq = sendWithAck(mockWs, { type: 'test' }, battleId, connectionId);

      try {
        // Retry up to MAX_RETRIES times and wait for the recovery attempt to
        // finish so it cannot leak real database work beyond this test.
        for (let i = 0; i < MAX_RETRIES; i++) {
          await scheduleRetry(connectionId, battleId, seq);
        }

        // After MAX_RETRIES, pending should be cleaned up
        // (triggerFullStateSync cleans up pending for the battle)
        assert.strictEqual(getPendingCount(connectionId), 0, 'Should cleanup after max retries');
        assert.strictEqual(loadBattleMock.mock.callCount(), 1);
      } finally {
        loadBattleMock.mock.restore();
        cleanupBattle(battleId);
      }
    });

    it('should continue retrying until MAX_RETRIES is reached', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      const seq = sendWithAck(mockWs, { type: 'test' }, battleId, connectionId);

      // Retry less than MAX_RETRIES times
      for (let i = 0; i < MAX_RETRIES - 1; i++) {
        scheduleRetry(connectionId, battleId, seq);
      }

      // Should still have pending
      assert.strictEqual(getPendingCount(connectionId), 1, 'Should still have pending before max');

      const pendingMsg = getPendingMessage(connectionId, battleId, seq);
      assert.strictEqual(pendingMsg.retries, MAX_RETRIES - 1, `Should have ${MAX_RETRIES - 1} retries`);

      // Cleanup
      cleanupConnection(connectionId);
      cleanupBattle(battleId);
    });

    it('fails an unacknowledged recovery snapshot without recursive resync', async () => {
      resetBattleMapOperationalMetrics();
      const mockWs = createMockWs();
      const battleId = 434343;
      const connectionId = uniqueId('conn');
      const seq = sendWithAck(mockWs, {
        type: 'battle:state_update',
        payload: { reason: 'full_sync', stateRevision: 10 }
      }, battleId, connectionId);
      mockWs.clearMessages();
      mockWs.send.mock.resetCalls();

      for (let index = 0; index < MAX_RETRIES; index++) {
        await scheduleRetry(connectionId, battleId, seq);
      }

      assert.strictEqual(getPendingCount(connectionId), 0);
      assert.strictEqual(mockWs.send.mock.callCount(), MAX_RETRIES - 1);
      const metrics = getBattleMapOperationalMetrics();
      assert.strictEqual(metrics.counters.freshSnapshotRecoverySucceeded, 0);
      assert.strictEqual(metrics.counters.freshSnapshotRecoveryFailed, 1);

      cleanupBattle(battleId);
      resetBattleMapOperationalMetrics();
    });

    it('sends a deferred recovery snapshot before a newer delta', async () => {
      const mockWs = createMockWs();
      const battleId = 434344;
      const connectionId = uniqueId('conn');
      const map = {
        battleMapSchemaVersion: 1,
        terrainGenerationVersion: 1,
        terrainSeed: 92,
        mapWidth: 1,
        mapHeight: 1,
        terrain: [['grass']],
        elevation: [[0]],
        obstacles: []
      };
      const mutableState = createBattleMutableStateV1({
        turn: 4,
        units: [{ id: 'player-1', hp: 20, tileX: 0, tileY: 0 }]
      });
      let resolveLoad;
      const loadBattleMock = mock.method(
        battleStateRepository,
        'loadBattle',
        () => new Promise(resolve => {
          resolveLoad = resolve;
        })
      );

      try {
        const recoveryPromise = triggerFullStateSync(
          mockWs,
          battleId,
          connectionId
        );
        const deltaPromise = sendWithAckAfterRecovery(mockWs, {
          type: 'battle:state_update',
          payload: {
            battleId,
            stateRevision: 8,
            update: { turn: 5 }
          }
        }, battleId, connectionId);

        await Promise.resolve();
        assert.strictEqual(
          mockWs.sentMessages.length,
          0,
          'The newer delta must wait while the older snapshot is loading'
        );

        resolveLoad({
          battleId,
          battleMapSchemaVersion: 1,
          terrainGenerationVersion: 1,
          stateRevision: 7,
          map,
          mutableState,
          state: { ...map, ...mutableState }
        });
        const [recovery, deltaSequence] = await Promise.all([
          recoveryPromise,
          deltaPromise
        ]);

        assert.strictEqual(recovery.success, true);
        assert.strictEqual(deltaSequence, 2);
        assert.strictEqual(mockWs.sentMessages.length, 2);
        assert.strictEqual(
          mockWs.sentMessages[0].payload.reason,
          'full_sync'
        );
        assert.strictEqual(mockWs.sentMessages[0].payload.stateRevision, 7);
        assert.strictEqual(mockWs.sentMessages[0].seq, 1);
        assert.strictEqual(mockWs.sentMessages[1].payload.stateRevision, 8);
        assert.strictEqual(mockWs.sentMessages[1].seq, 2);
      } finally {
        loadBattleMock.mock.restore();
        cleanupConnection(connectionId);
        cleanupBattle(battleId);
      }
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle rapid sequential messages', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      const seqs = [];
      for (let i = 0; i < 100; i++) {
        seqs.push(sendWithAck(mockWs, { type: `msg${i}` }, battleId, connectionId));
      }

      assert.strictEqual(getPendingCount(connectionId), 100, 'Should track all 100 messages');
      assert.strictEqual(seqs[0], 1, 'First seq should be 1');
      assert.strictEqual(seqs[99], 100, 'Last seq should be 100');

      // Cleanup
      cleanupConnection(connectionId);
      cleanupBattle(battleId);
    });

    it('should assign independent sequences to each connection in same battle', () => {
      const mockWs1 = createMockWs();
      const mockWs2 = createMockWs();
      const battleId = uniqueId('battle');
      const conn1 = uniqueId('conn1');
      const conn2 = uniqueId('conn2');

      // Each connection starts at 1
      const seq1_msg1 = sendWithAck(mockWs1, { type: 'msg1' }, battleId, conn1);
      const seq2_msg1 = sendWithAck(mockWs2, { type: 'msg1' }, battleId, conn2);
      assert.strictEqual(seq1_msg1, 1, 'Conn1 first message gets seq 1');
      assert.strictEqual(seq2_msg1, 1, 'Conn2 first message also gets seq 1 (independent)');

      // Each connection increments independently
      const seq1_msg2 = sendWithAck(mockWs1, { type: 'msg2' }, battleId, conn1);
      const seq2_msg2 = sendWithAck(mockWs2, { type: 'msg2' }, battleId, conn2);
      assert.strictEqual(seq1_msg2, 2, 'Conn1 second message gets seq 2');
      assert.strictEqual(seq2_msg2, 2, 'Conn2 second message also gets seq 2 (independent)');

      // Each connection tracks its own pending
      assert.strictEqual(getPendingCount(conn1), 2, 'Conn1 has 2 pending');
      assert.strictEqual(getPendingCount(conn2), 2, 'Conn2 has 2 pending');

      // ACK for one doesn't affect the other
      handleAck(conn1, battleId, seq1_msg1);
      assert.strictEqual(getPendingCount(conn1), 1, 'Conn1 has 1 pending after ACK');
      assert.strictEqual(getPendingCount(conn2), 2, 'Conn2 still has 2 pending');

      // Cleanup
      cleanupConnection(conn1);
      cleanupConnection(conn2);
      cleanupBattle(battleId);
    });

    it('should handle send errors gracefully', () => {
      const mockWs = createMockWs();
      mockWs.send = mock.fn(() => {
        throw new Error('Send failed');
      });

      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      // Should not throw
      const seq = sendWithAck(mockWs, { type: 'test' }, battleId, connectionId);

      // Should NOT track pending when send fails (prevents sequence gaps)
      assert.strictEqual(seq, -1, 'Should return -1 when send fails');
      assert.strictEqual(getPendingCount(connectionId), 0, 'Should not track pending when send fails');

      // Cleanup
      cleanupConnection(connectionId);
      cleanupBattle(battleId);
    });

    it('should preserve message integrity through retry cycle', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      const originalPayload = {
        type: 'battle:action',
        payload: { actionType: 'move', targetTile: { x: 5, y: 5 } }
      };

      const seq = sendWithAck(mockWs, originalPayload, battleId, connectionId);
      mockWs.clearMessages();

      // Trigger retry
      scheduleRetry(connectionId, battleId, seq);

      const resentMsg = mockWs.getLastMessage();
      assert.strictEqual(resentMsg.type, 'battle:action', 'Should preserve type');
      assert.deepStrictEqual(resentMsg.payload, originalPayload.payload, 'Should preserve payload');
      assert.strictEqual(resentMsg.seq, seq, 'Should preserve seq');
      assert.strictEqual(resentMsg.ack, true, 'Should preserve ack flag');

      // Cleanup
      cleanupConnection(connectionId);
      cleanupBattle(battleId);
    });
  });

  // ==========================================================================
  // Integration-style Tests
  // ==========================================================================

  describe('Full Message Lifecycle', () => {
    it('should complete full message lifecycle: send -> ACK -> cleanup', () => {
      const mockWs = createMockWs();
      const battleId = uniqueId('battle');
      const connectionId = uniqueId('conn');

      // 1. Send message
      const seq = sendWithAck(mockWs, { type: 'test' }, battleId, connectionId);
      assert.strictEqual(getPendingCount(connectionId), 1, 'Step 1: Message pending');

      // 2. Receive ACK
      const ackResult = handleAck(connectionId, battleId, seq);
      assert.strictEqual(ackResult, true, 'Step 2: ACK processed');
      assert.strictEqual(getPendingCount(connectionId), 0, 'Step 2: No pending');

      // 3. Cleanup battle
      cleanupBattle(battleId);
      assert.strictEqual(getCurrentSequence(battleId), 0, 'Step 3: Sequence reset');
    });

    it('should handle multiple battles and connections simultaneously', () => {
      const mockWs1 = createMockWs();
      const mockWs2 = createMockWs();
      const mockWs3 = createMockWs();
      const battle1 = uniqueId('battle1');
      const battle2 = uniqueId('battle2');
      const conn1 = uniqueId('conn1');
      const conn2 = uniqueId('conn2');
      const conn3 = uniqueId('conn3');

      // Multiple messages across battles
      const b1c1seq = sendWithAck(mockWs1, { type: 'b1c1' }, battle1, conn1);
      const b1c2seq = sendWithAck(mockWs2, { type: 'b1c2' }, battle1, conn2);
      const b2c3seq = sendWithAck(mockWs3, { type: 'b2c3' }, battle2, conn3);

      // With per-user sequences, each user starts at 1 independently
      assert.strictEqual(b1c1seq, 1, 'Conn1 in battle1 gets seq 1');
      assert.strictEqual(b1c2seq, 1, 'Conn2 in battle1 also gets seq 1 (independent)');
      assert.strictEqual(b2c3seq, 1, 'Conn3 in battle2 gets seq 1');

      // Verify per-user sequence isolation
      assert.strictEqual(getCurrentSequence(battle1, conn1), 1, 'Conn1 in battle1 has seq 1');
      assert.strictEqual(getCurrentSequence(battle1, conn2), 1, 'Conn2 in battle1 has seq 1');
      assert.strictEqual(getCurrentSequence(battle2, conn3), 1, 'Conn3 in battle2 has seq 1');

      // ACK from different battles
      handleAck(conn1, battle1, b1c1seq);
      handleAck(conn3, battle2, b2c3seq);

      assert.strictEqual(getPendingCount(conn1), 0, 'Conn1 cleared');
      assert.strictEqual(getPendingCount(conn2), 1, 'Conn2 still pending');
      assert.strictEqual(getPendingCount(conn3), 0, 'Conn3 cleared');

      // Cleanup
      cleanupConnection(conn2);
      cleanupBattle(battle1);
      cleanupBattle(battle2);
    });
  });
});
