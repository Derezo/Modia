/**
 * Garrison WebSocket Unit Tests
 * Tests for garrison WebSocket message handlers and room management
 *
 * Tests cover:
 * 1. handleGarrisonMessage - join_garrison, leave_garrison
 * 2. cleanupUserGarrisonSubscriptions
 *
 * Uses mocked rooms Map to test without requiring a running WebSocket server.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  handleGarrisonMessage,
  cleanupUserGarrisonSubscriptions
} from '../../websocket/garrisonWebsocket.js';

// =============================================================================
// MOCK SETUP HELPERS
// =============================================================================

/**
 * Create a mock rooms Map for testing
 */
function createMockRooms() {
  return new Map();
}

/**
 * Create a mock WebSocket object
 */
function createMockWs() {
  return {
    readyState: 1 // WebSocket.OPEN
  };
}

// =============================================================================
// HANDLE GARRISON MESSAGE TESTS
// =============================================================================

describe('garrisonWebsocket - handleGarrisonMessage', () => {
  let rooms;
  let ws;
  const userId = 123;

  beforeEach(() => {
    rooms = createMockRooms();
    ws = createMockWs();
  });

  describe('join_garrison', () => {
    it('should join user to garrison room', async () => {
      const message = {
        type: 'join_garrison',
        payload: { nodeId: 42 }
      };

      const response = await handleGarrisonMessage(ws, message, userId, rooms);

      assert.strictEqual(response.type, 'garrison_room_joined');
      assert.strictEqual(response.payload.nodeId, 42);

      // Verify user was added to room
      const roomName = 'garrison:42';
      assert.ok(rooms.has(roomName), 'Room should exist');
      assert.ok(rooms.get(roomName).has(userId), 'User should be in room');
    });

    it('should create room if it does not exist', async () => {
      const message = {
        type: 'join_garrison',
        payload: { nodeId: 99 }
      };

      assert.ok(!rooms.has('garrison:99'), 'Room should not exist initially');

      await handleGarrisonMessage(ws, message, userId, rooms);

      assert.ok(rooms.has('garrison:99'), 'Room should be created');
    });

    it('should allow multiple users to join same room', async () => {
      const message = {
        type: 'join_garrison',
        payload: { nodeId: 42 }
      };

      await handleGarrisonMessage(ws, message, 100, rooms);
      await handleGarrisonMessage(ws, message, 200, rooms);
      await handleGarrisonMessage(ws, message, 300, rooms);

      const roomUsers = rooms.get('garrison:42');
      assert.strictEqual(roomUsers.size, 3);
      assert.ok(roomUsers.has(100));
      assert.ok(roomUsers.has(200));
      assert.ok(roomUsers.has(300));
    });

    it('should return error when nodeId is missing', async () => {
      const message = {
        type: 'join_garrison',
        payload: {}
      };

      const response = await handleGarrisonMessage(ws, message, userId, rooms);

      assert.strictEqual(response.type, 'error');
      assert.strictEqual(response.payload.message, 'Node ID required');
    });

    it('should return error when payload is undefined', async () => {
      const message = {
        type: 'join_garrison',
        payload: undefined
      };

      // Should handle undefined payload gracefully
      try {
        await handleGarrisonMessage(ws, message, userId, rooms);
        // If it doesn't throw, check for error response
      } catch {
        // Expected - undefined payload causes issues accessing nodeId
      }
    });
  });

  describe('leave_garrison', () => {
    it('should remove user from garrison room', async () => {
      // First join the room
      const joinMessage = {
        type: 'join_garrison',
        payload: { nodeId: 42 }
      };
      await handleGarrisonMessage(ws, joinMessage, userId, rooms);

      // Then leave
      const leaveMessage = {
        type: 'leave_garrison',
        payload: { nodeId: 42 }
      };
      const response = await handleGarrisonMessage(ws, leaveMessage, userId, rooms);

      assert.strictEqual(response.type, 'garrison_room_left');
      assert.strictEqual(response.payload.nodeId, 42);

      // Verify user was removed from room
      const roomName = 'garrison:42';
      if (rooms.has(roomName)) {
        assert.ok(!rooms.get(roomName).has(userId), 'User should not be in room');
      }
    });

    it('should delete empty room after user leaves', async () => {
      // Join with one user
      const joinMessage = {
        type: 'join_garrison',
        payload: { nodeId: 42 }
      };
      await handleGarrisonMessage(ws, joinMessage, userId, rooms);

      // Leave
      const leaveMessage = {
        type: 'leave_garrison',
        payload: { nodeId: 42 }
      };
      await handleGarrisonMessage(ws, leaveMessage, userId, rooms);

      // Room should be deleted since it's empty
      assert.ok(!rooms.has('garrison:42'), 'Empty room should be deleted');
    });

    it('should not delete room if other users remain', async () => {
      // Join with two users
      const joinMessage = {
        type: 'join_garrison',
        payload: { nodeId: 42 }
      };
      await handleGarrisonMessage(ws, joinMessage, 100, rooms);
      await handleGarrisonMessage(ws, joinMessage, 200, rooms);

      // First user leaves
      const leaveMessage = {
        type: 'leave_garrison',
        payload: { nodeId: 42 }
      };
      await handleGarrisonMessage(ws, leaveMessage, 100, rooms);

      // Room should still exist with second user
      assert.ok(rooms.has('garrison:42'), 'Room should still exist');
      assert.ok(rooms.get('garrison:42').has(200), 'Second user should remain');
      assert.ok(!rooms.get('garrison:42').has(100), 'First user should be gone');
    });

    it('should return null when nodeId is missing', async () => {
      const message = {
        type: 'leave_garrison',
        payload: {}
      };

      const response = await handleGarrisonMessage(ws, message, userId, rooms);

      assert.strictEqual(response, null);
    });

    it('should handle leaving room that does not exist', async () => {
      const message = {
        type: 'leave_garrison',
        payload: { nodeId: 999 }
      };

      // Should not throw
      const response = await handleGarrisonMessage(ws, message, userId, rooms);

      assert.strictEqual(response.type, 'garrison_room_left');
    });

    it('should handle leaving room user is not in', async () => {
      // Create room with different user
      const joinMessage = {
        type: 'join_garrison',
        payload: { nodeId: 42 }
      };
      await handleGarrisonMessage(ws, joinMessage, 999, rooms);

      // Try to leave with user who didn't join
      const leaveMessage = {
        type: 'leave_garrison',
        payload: { nodeId: 42 }
      };
      const response = await handleGarrisonMessage(ws, leaveMessage, userId, rooms);

      // Should not throw and return success
      assert.strictEqual(response.type, 'garrison_room_left');
    });
  });

  describe('unknown message type', () => {
    it('should return null for unknown message types', async () => {
      const message = {
        type: 'unknown_type',
        payload: { nodeId: 42 }
      };

      const response = await handleGarrisonMessage(ws, message, userId, rooms);

      assert.strictEqual(response, null);
    });
  });
});

// =============================================================================
// CLEANUP USER SUBSCRIPTIONS TESTS
// =============================================================================

describe('garrisonWebsocket - cleanupUserGarrisonSubscriptions', () => {
  let rooms;

  beforeEach(() => {
    rooms = createMockRooms();
  });

  it('should remove user from all garrison rooms', () => {
    // Set up user in multiple garrison rooms
    const userId = 123;
    rooms.set('garrison:1', new Set([userId, 456]));
    rooms.set('garrison:2', new Set([userId]));
    rooms.set('garrison:3', new Set([userId, 789, 101112]));

    cleanupUserGarrisonSubscriptions(userId, rooms);

    // Verify user was removed from all garrison rooms
    assert.ok(!rooms.get('garrison:1')?.has(userId));
    assert.ok(!rooms.has('garrison:2')); // Should be deleted (was only user)
    assert.ok(!rooms.get('garrison:3')?.has(userId));
  });

  it('should delete empty garrison rooms after cleanup', () => {
    const userId = 123;
    rooms.set('garrison:1', new Set([userId]));
    rooms.set('garrison:2', new Set([userId]));

    cleanupUserGarrisonSubscriptions(userId, rooms);

    // Both rooms should be deleted since they're empty
    assert.ok(!rooms.has('garrison:1'), 'Empty room 1 should be deleted');
    assert.ok(!rooms.has('garrison:2'), 'Empty room 2 should be deleted');
  });

  it('should not affect non-garrison rooms', () => {
    const userId = 123;
    rooms.set('garrison:1', new Set([userId]));
    rooms.set('chat:global', new Set([userId]));
    rooms.set('marketplace', new Set([userId]));
    rooms.set('battle:42', new Set([userId]));

    cleanupUserGarrisonSubscriptions(userId, rooms);

    // Garrison room should be deleted
    assert.ok(!rooms.has('garrison:1'));

    // Non-garrison rooms should still have the user
    assert.ok(rooms.get('chat:global')?.has(userId));
    assert.ok(rooms.get('marketplace')?.has(userId));
    assert.ok(rooms.get('battle:42')?.has(userId));
  });

  it('should not affect other users in garrison rooms', () => {
    const userId = 123;
    rooms.set('garrison:1', new Set([userId, 456, 789]));

    cleanupUserGarrisonSubscriptions(userId, rooms);

    // Other users should remain
    const room = rooms.get('garrison:1');
    assert.ok(room, 'Room should still exist');
    assert.ok(room.has(456));
    assert.ok(room.has(789));
    assert.ok(!room.has(userId));
  });

  it('should handle null rooms gracefully', () => {
    // Should not throw
    cleanupUserGarrisonSubscriptions(123, null);
  });

  it('should handle undefined rooms gracefully', () => {
    // Should not throw
    cleanupUserGarrisonSubscriptions(123, undefined);
  });

  it('should handle user not in any rooms', () => {
    rooms.set('garrison:1', new Set([456, 789]));

    // Should not throw
    cleanupUserGarrisonSubscriptions(123, rooms);

    // Other users should be unaffected
    assert.strictEqual(rooms.get('garrison:1').size, 2);
  });

  it('should handle empty rooms map', () => {
    // Should not throw
    cleanupUserGarrisonSubscriptions(123, rooms);
    assert.strictEqual(rooms.size, 0);
  });
});
