/**
 * Unit tests for WebSocket session replacement and zombie cleanup logic
 *
 * Tests the guards in handleDisconnect that prevent:
 * 1. Stale socket cleanup when replaced by newer session
 * 2. Stale connectionId cleanup when replaced by newer connection
 * 3. Zombie cleanup when no connectionId is registered (undefined guard)
 *
 * Also tests the auth flow session replacement:
 * 1. Old connection gets session_replaced message and is closed
 * 2. New connection successfully authenticates
 * 3. Connection maps are updated correctly
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// =============================================================================
// MOCK STATE
// =============================================================================

// Simulates the Maps from index.js
let connections;
let activeConnectionIds;
let cleanupCalls;
let broadcastCalls;

// =============================================================================
// TEST HELPERS
// =============================================================================

function resetMocks() {
  connections = new Map();
  activeConnectionIds = new Map();
  cleanupCalls = [];
  broadcastCalls = [];
}

/**
 * Mock WebSocket class for testing
 */
class MockWebSocket {
  constructor(id) {
    this.id = id;
    this.messages = [];
    this.closed = false;
    this.closeCode = null;
    this.closeReason = null;
    this.readyState = 1; // OPEN
  }

  send(data) {
    this.messages.push(JSON.parse(data));
  }

  close(code, reason) {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = 3; // CLOSED
  }
}

/**
 * Simulated handleDisconnect that matches index.js logic
 * This allows us to test the guard logic in isolation
 */
function testHandleDisconnect(
  userId,
  username,
  ws,
  connectionId,
  { mockConnections, mockActiveConnectionIds, mockCleanup, mockBroadcast }
) {
  if (!userId) return { skipped: true, reason: 'no_user_id' };

  // Guard 1: Check if this socket is still the active connection
  const currentWs = mockConnections.get(userId);
  if (ws !== null && currentWs !== ws) {
    return { skipped: true, reason: 'stale_socket' };
  }

  // Guard 2: Check if connectionId matches (with undefined exception for zombie cleanup)
  const currentConnId = mockActiveConnectionIds.get(userId);
  if (connectionId !== null && currentConnId !== undefined && currentConnId !== connectionId) {
    return { skipped: true, reason: 'stale_connection_id' };
  }

  // Full cleanup proceeds
  mockCleanup(userId);
  mockActiveConnectionIds.delete(userId);
  mockConnections.delete(userId);
  mockBroadcast(userId, username, 'offline');

  return { skipped: false, reason: 'cleaned_up' };
}

/**
 * Simulated handleAuth session replacement logic
 */
function testHandleAuth(
  newWs,
  userId,
  username,
  connectionId,
  { mockConnections, mockActiveConnectionIds }
) {
  const existingConnection = mockConnections.get(userId);
  let sessionReplaced = false;
  let oldConnectionId = null;

  if (existingConnection && existingConnection !== newWs && existingConnection.readyState === 1) {
    sessionReplaced = true;
    oldConnectionId = mockActiveConnectionIds.get(userId);

    existingConnection.send(JSON.stringify({
      type: 'session_replaced',
      payload: {
        message: 'Another session has connected',
        replacedBy: connectionId
      }
    }));
    existingConnection.close(1000, 'Session replaced by new connection');
  }

  // Set up new connection
  mockConnections.set(userId, newWs);
  mockActiveConnectionIds.set(userId, connectionId);

  return { sessionReplaced, oldConnectionId };
}

// =============================================================================
// TESTS: handleDisconnect Guards
// =============================================================================

describe('WebSocket Session Replacement - handleDisconnect guards', () => {
  beforeEach(() => {
    resetMocks();
  });

  describe('stale socket guard', () => {
    it('should skip cleanup when ws does not match current connection', () => {
      const userId = 1;
      const username = 'player1';
      const oldWs = new MockWebSocket('old');
      const newWs = new MockWebSocket('new');

      // New connection is registered
      connections.set(userId, newWs);
      activeConnectionIds.set(userId, 'conn_new');

      // Old connection's close handler fires
      const result = testHandleDisconnect(userId, username, oldWs, 'conn_old', {
        mockConnections: connections,
        mockActiveConnectionIds: activeConnectionIds,
        mockCleanup: (uid) => cleanupCalls.push(uid),
        mockBroadcast: (uid, name, status) => broadcastCalls.push({ uid, name, status })
      });

      assert.strictEqual(result.skipped, true);
      assert.strictEqual(result.reason, 'stale_socket');
      assert.strictEqual(cleanupCalls.length, 0, 'Should not cleanup stale socket');
      assert.strictEqual(broadcastCalls.length, 0, 'Should not broadcast for stale socket');
      // New connection should remain
      assert.strictEqual(connections.get(userId), newWs);
    });

    it('should proceed with cleanup when ws matches current connection', () => {
      const userId = 1;
      const username = 'player1';
      const ws = new MockWebSocket('current');

      connections.set(userId, ws);
      activeConnectionIds.set(userId, 'conn_1');

      const result = testHandleDisconnect(userId, username, ws, 'conn_1', {
        mockConnections: connections,
        mockActiveConnectionIds: activeConnectionIds,
        mockCleanup: (uid) => cleanupCalls.push(uid),
        mockBroadcast: (uid, name, status) => broadcastCalls.push({ uid, name, status })
      });

      assert.strictEqual(result.skipped, false);
      assert.strictEqual(result.reason, 'cleaned_up');
      assert.strictEqual(cleanupCalls.length, 1);
      assert.strictEqual(cleanupCalls[0], userId);
      assert.strictEqual(broadcastCalls.length, 1);
    });
  });

  describe('connectionId guard', () => {
    it('should skip cleanup when connectionId does not match registered one', () => {
      const userId = 1;
      const username = 'player1';
      const ws = new MockWebSocket('current');

      connections.set(userId, ws);
      activeConnectionIds.set(userId, 'conn_new'); // Newer connectionId registered

      // Stale connectionId trying to cleanup
      const result = testHandleDisconnect(userId, username, ws, 'conn_old', {
        mockConnections: connections,
        mockActiveConnectionIds: activeConnectionIds,
        mockCleanup: (uid) => cleanupCalls.push(uid),
        mockBroadcast: (uid, name, status) => broadcastCalls.push({ uid, name, status })
      });

      assert.strictEqual(result.skipped, true);
      assert.strictEqual(result.reason, 'stale_connection_id');
      assert.strictEqual(cleanupCalls.length, 0);
    });

    it('should allow cleanup when currentConnId is undefined (zombie cleanup)', () => {
      const userId = 1;
      const username = 'player1';
      const ws = new MockWebSocket('zombie');

      connections.set(userId, ws);
      // No activeConnectionId registered (undefined)

      const result = testHandleDisconnect(userId, username, ws, 'some_conn_id', {
        mockConnections: connections,
        mockActiveConnectionIds: activeConnectionIds,
        mockCleanup: (uid) => cleanupCalls.push(uid),
        mockBroadcast: (uid, name, status) => broadcastCalls.push({ uid, name, status })
      });

      assert.strictEqual(result.skipped, false);
      assert.strictEqual(result.reason, 'cleaned_up');
      assert.strictEqual(cleanupCalls.length, 1);
    });

    it('should allow cleanup when connectionId is null (legacy/heartbeat cleanup)', () => {
      const userId = 1;
      const username = 'player1';
      const ws = new MockWebSocket('current');

      connections.set(userId, ws);
      activeConnectionIds.set(userId, 'conn_1');

      // connectionId = null means caller doesn't have a connectionId (legacy behavior)
      const result = testHandleDisconnect(userId, username, ws, null, {
        mockConnections: connections,
        mockActiveConnectionIds: activeConnectionIds,
        mockCleanup: (uid) => cleanupCalls.push(uid),
        mockBroadcast: (uid, name, status) => broadcastCalls.push({ uid, name, status })
      });

      assert.strictEqual(result.skipped, false);
      assert.strictEqual(result.reason, 'cleaned_up');
    });

    it('should allow cleanup when connectionId matches registered one', () => {
      const userId = 1;
      const username = 'player1';
      const ws = new MockWebSocket('current');

      connections.set(userId, ws);
      activeConnectionIds.set(userId, 'conn_1');

      const result = testHandleDisconnect(userId, username, ws, 'conn_1', {
        mockConnections: connections,
        mockActiveConnectionIds: activeConnectionIds,
        mockCleanup: (uid) => cleanupCalls.push(uid),
        mockBroadcast: (uid, name, status) => broadcastCalls.push({ uid, name, status })
      });

      assert.strictEqual(result.skipped, false);
      assert.strictEqual(result.reason, 'cleaned_up');
      assert.strictEqual(cleanupCalls.length, 1);
    });
  });

  describe('no userId', () => {
    it('should skip immediately when userId is null', () => {
      const result = testHandleDisconnect(null, null, null, null, {
        mockConnections: connections,
        mockActiveConnectionIds: activeConnectionIds,
        mockCleanup: (uid) => cleanupCalls.push(uid),
        mockBroadcast: (uid, name, status) => broadcastCalls.push({ uid, name, status })
      });

      assert.strictEqual(result.skipped, true);
      assert.strictEqual(result.reason, 'no_user_id');
    });
  });
});

// =============================================================================
// TESTS: handleAuth Session Replacement
// =============================================================================

describe('WebSocket Session Replacement - handleAuth', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('should send session_replaced to existing connection and close it', () => {
    const userId = 1;
    const username = 'player1';
    const oldWs = new MockWebSocket('old');
    const newWs = new MockWebSocket('new');

    // Existing connection
    connections.set(userId, oldWs);
    activeConnectionIds.set(userId, 'conn_old');

    const result = testHandleAuth(newWs, userId, username, 'conn_new', {
      mockConnections: connections,
      mockActiveConnectionIds: activeConnectionIds
    });

    assert.strictEqual(result.sessionReplaced, true);
    assert.strictEqual(result.oldConnectionId, 'conn_old');

    // Old connection should have received session_replaced
    assert.strictEqual(oldWs.messages.length, 1);
    assert.strictEqual(oldWs.messages[0].type, 'session_replaced');
    assert.strictEqual(oldWs.messages[0].payload.replacedBy, 'conn_new');

    // Old connection should be closed
    assert.strictEqual(oldWs.closed, true);
    assert.strictEqual(oldWs.closeCode, 1000);
    assert.strictEqual(oldWs.closeReason, 'Session replaced by new connection');

    // New connection should be registered
    assert.strictEqual(connections.get(userId), newWs);
    assert.strictEqual(activeConnectionIds.get(userId), 'conn_new');
  });

  it('should not replace when no existing connection', () => {
    const userId = 1;
    const username = 'player1';
    const newWs = new MockWebSocket('new');

    const result = testHandleAuth(newWs, userId, username, 'conn_new', {
      mockConnections: connections,
      mockActiveConnectionIds: activeConnectionIds
    });

    assert.strictEqual(result.sessionReplaced, false);
    assert.strictEqual(result.oldConnectionId, null);
    assert.strictEqual(connections.get(userId), newWs);
  });

  it('should not replace when existing connection is already closed', () => {
    const userId = 1;
    const username = 'player1';
    const oldWs = new MockWebSocket('old');
    oldWs.readyState = 3; // CLOSED
    const newWs = new MockWebSocket('new');

    connections.set(userId, oldWs);
    activeConnectionIds.set(userId, 'conn_old');

    const result = testHandleAuth(newWs, userId, username, 'conn_new', {
      mockConnections: connections,
      mockActiveConnectionIds: activeConnectionIds
    });

    assert.strictEqual(result.sessionReplaced, false);
    assert.strictEqual(oldWs.messages.length, 0, 'Should not send to closed connection');
    assert.strictEqual(connections.get(userId), newWs);
  });

  it('should not replace when same websocket (reconnect race)', () => {
    const userId = 1;
    const username = 'player1';
    const ws = new MockWebSocket('same');

    connections.set(userId, ws);
    activeConnectionIds.set(userId, 'conn_1');

    const result = testHandleAuth(ws, userId, username, 'conn_new', {
      mockConnections: connections,
      mockActiveConnectionIds: activeConnectionIds
    });

    assert.strictEqual(result.sessionReplaced, false);
    assert.strictEqual(ws.messages.length, 0);
    assert.strictEqual(ws.closed, false);
  });
});

// =============================================================================
// TESTS: Zombie Cleanup Integration
// =============================================================================

describe('WebSocket Zombie Cleanup', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('should clean up zombie connection that has no activeConnectionId', () => {
    const userId = 1;
    const username = 'player1';
    const zombieWs = new MockWebSocket('zombie');

    // Zombie state: connection exists but no connectionId registered
    // This happens when heartbeat timeout triggers before auth completes
    connections.set(userId, zombieWs);
    // activeConnectionIds does NOT have userId (undefined)

    const result = testHandleDisconnect(userId, username, zombieWs, null, {
      mockConnections: connections,
      mockActiveConnectionIds: activeConnectionIds,
      mockCleanup: (uid) => cleanupCalls.push(uid),
      mockBroadcast: (uid, name, status) => broadcastCalls.push({ uid, name, status })
    });

    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.reason, 'cleaned_up');
    assert.strictEqual(cleanupCalls.length, 1);
    assert.ok(!connections.has(userId), 'Connection should be removed');
  });

  it('should clean up zombie when heartbeat cleanup passes connectionId but none registered', () => {
    const userId = 1;
    const username = 'player1';
    const zombieWs = new MockWebSocket('zombie');

    // Connection exists without activeConnectionId (zombie state)
    connections.set(userId, zombieWs);
    // activeConnectionIds.get(userId) returns undefined

    // Heartbeat cleanup might pass a connectionId but none is registered
    const result = testHandleDisconnect(userId, username, zombieWs, 'orphan_conn_id', {
      mockConnections: connections,
      mockActiveConnectionIds: activeConnectionIds,
      mockCleanup: (uid) => cleanupCalls.push(uid),
      mockBroadcast: (uid, name, status) => broadcastCalls.push({ uid, name, status })
    });

    // Should proceed because currentConnId is undefined
    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.reason, 'cleaned_up');
  });
});
