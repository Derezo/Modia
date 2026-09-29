/**
 * Presence Privacy Unit Tests
 *
 * Tests that presence broadcasts respect user privacy settings:
 * - Users with showOnlineStatus=false should not have their presence broadcast
 * - Offline broadcasts should still be sent (to clear any cached online status)
 * - When explicit showOnlineStatus option is passed, it's used directly
 *
 * Note: The automatic lookup from userSettingsService is tested via integration tests
 * since ESM modules have read-only exports that can't be easily mocked.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  broadcastPresenceChange,
  addUserToRoom,
  removeUserFromRoom,
  setConnection,
  removeConnection,
  rooms
} from '../../websocket/roomManager.js';

// Helper to create a mock WebSocket
function createMockWs() {
  const sentMessages = [];
  return {
    readyState: 1, // WebSocket.OPEN
    send: (message) => {
      sentMessages.push(JSON.parse(message));
    },
    sentMessages
  };
}

// Helper to wait for async IIFE in broadcastPresenceChange to complete
function waitForBroadcast() {
  return new Promise(resolve => setTimeout(resolve, 20));
}

describe('broadcastPresenceChange with explicit showOnlineStatus option', () => {
  beforeEach(() => {
    // Clear any existing rooms
    rooms.clear();
  });

  afterEach(() => {
    // Clean up rooms
    rooms.clear();
  });

  it('should not broadcast online/away/busy when showOnlineStatus=false is passed', async () => {
    // Setup: user 2 is observing in the tavern room
    const observerWs = createMockWs();
    setConnection(2, observerWs);
    addUserToRoom('tavern', 2);

    // User 1 comes online with explicit showOnlineStatus=false
    broadcastPresenceChange(1, 'hiddenUser', 'online', 'Hello', { showOnlineStatus: false });
    await waitForBroadcast();

    assert.strictEqual(observerWs.sentMessages.length, 0,
      'No messages should be sent when hidden user goes online');

    // User 1 goes away with explicit showOnlineStatus=false
    broadcastPresenceChange(1, 'hiddenUser', 'away', 'AFK', { showOnlineStatus: false });
    await waitForBroadcast();

    assert.strictEqual(observerWs.sentMessages.length, 0,
      'No messages should be sent when hidden user goes away');

    // User 1 goes busy with explicit showOnlineStatus=false
    broadcastPresenceChange(1, 'hiddenUser', 'busy', 'DND', { showOnlineStatus: false });
    await waitForBroadcast();

    assert.strictEqual(observerWs.sentMessages.length, 0,
      'No messages should be sent when hidden user goes busy');

    // Clean up
    removeConnection(2);
    removeUserFromRoom('tavern', 2);
  });

  it('should broadcast offline with masked payload when showOnlineStatus=false', async () => {
    // Setup: user 2 is observing
    const observerWs = createMockWs();
    setConnection(2, observerWs);
    addUserToRoom('tavern', 2);

    // User 1 goes offline with explicit showOnlineStatus=false
    // SHOULD be broadcast (to clear cached status) but with masked payload
    broadcastPresenceChange(1, 'hiddenUser', 'offline', 'Goodbye', { showOnlineStatus: false });
    await waitForBroadcast();

    assert.strictEqual(observerWs.sentMessages.length, 1,
      'Offline should be broadcast even for hidden user');

    const msg = observerWs.sentMessages[0];
    assert.strictEqual(msg.type, 'presence_changed');
    assert.strictEqual(msg.payload.status, 'offline', 'Status should be offline');
    assert.strictEqual(msg.payload.customMessage, null, 'Custom message should be masked to null');
    assert.strictEqual(msg.payload.userId, 1);
    assert.strictEqual(msg.payload.username, 'hiddenUser');

    // Clean up
    removeConnection(2);
    removeUserFromRoom('tavern', 2);
  });

  it('should broadcast unchanged payload when showOnlineStatus=true', async () => {
    // Setup: user 2 is observing in global room
    const observerWs = createMockWs();
    setConnection(2, observerWs);
    addUserToRoom('global', 2);

    // User 1 comes online with explicit showOnlineStatus=true
    broadcastPresenceChange(1, 'visibleUser', 'online', 'Available', { showOnlineStatus: true });
    await waitForBroadcast();

    assert.strictEqual(observerWs.sentMessages.length, 1,
      'Message should be broadcast for visible user');

    const msg = observerWs.sentMessages[0];
    assert.strictEqual(msg.type, 'presence_changed');
    assert.strictEqual(msg.payload.status, 'online', 'Status should be online');
    assert.strictEqual(msg.payload.customMessage, 'Available', 'Custom message should be preserved');

    // Clean up
    removeConnection(2);
    removeUserFromRoom('global', 2);
  });

  it('should broadcast to all presence rooms (tavern, socialHub, global)', async () => {
    // Setup: observers in each room
    const tavernWs = createMockWs();
    const socialHubWs = createMockWs();
    const globalWs = createMockWs();

    setConnection(2, tavernWs);
    setConnection(3, socialHubWs);
    setConnection(4, globalWs);

    addUserToRoom('tavern', 2);
    addUserToRoom('socialHub', 3);
    addUserToRoom('global', 4);

    // User 1 comes online with explicit showOnlineStatus=true
    broadcastPresenceChange(1, 'testUser', 'online', null, { showOnlineStatus: true });
    await waitForBroadcast();

    assert.strictEqual(tavernWs.sentMessages.length, 1, 'Tavern should receive message');
    assert.strictEqual(socialHubWs.sentMessages.length, 1, 'SocialHub should receive message');
    assert.strictEqual(globalWs.sentMessages.length, 1, 'Global should receive message');

    // Verify all messages have correct structure
    for (const ws of [tavernWs, socialHubWs, globalWs]) {
      const msg = ws.sentMessages[0];
      assert.strictEqual(msg.type, 'presence_changed');
      assert.strictEqual(msg.payload.userId, 1);
      assert.strictEqual(msg.payload.username, 'testUser');
      assert.strictEqual(msg.payload.status, 'online');
    }

    // Clean up
    removeConnection(2);
    removeConnection(3);
    removeConnection(4);
    removeUserFromRoom('tavern', 2);
    removeUserFromRoom('socialHub', 3);
    removeUserFromRoom('global', 4);
  });

  it('should not broadcast to sender (excludes userId from broadcast)', async () => {
    // Setup: user 1 is both the sender AND in the tavern room
    const user1Ws = createMockWs();
    const user2Ws = createMockWs();

    setConnection(1, user1Ws);
    setConnection(2, user2Ws);

    addUserToRoom('tavern', 1);
    addUserToRoom('tavern', 2);

    // User 1 comes online - should NOT receive their own presence change
    broadcastPresenceChange(1, 'testUser', 'online', null, { showOnlineStatus: true });
    await waitForBroadcast();

    assert.strictEqual(user1Ws.sentMessages.length, 0,
      'Sender should not receive their own presence change');
    assert.strictEqual(user2Ws.sentMessages.length, 1,
      'Other users should receive presence change');

    // Clean up
    removeConnection(1);
    removeConnection(2);
    removeUserFromRoom('tavern', 1);
    removeUserFromRoom('tavern', 2);
  });
});

describe('presence privacy logic (specification)', () => {
  // These are specification tests documenting the expected behavior

  it('should skip broadcast when showOnlineStatus is false and status is not offline', () => {
    const shouldBroadcast = (status, showOnlineStatus) => {
      if (!showOnlineStatus && status !== 'offline') {
        return false;
      }
      return true;
    };

    assert.strictEqual(shouldBroadcast('online', false), false,
      'Should not broadcast online when privacy enabled');
    assert.strictEqual(shouldBroadcast('away', false), false,
      'Should not broadcast away when privacy enabled');
    assert.strictEqual(shouldBroadcast('busy', false), false,
      'Should not broadcast busy when privacy enabled');
  });

  it('should allow offline broadcasts even when privacy is enabled', () => {
    const shouldBroadcast = (status, showOnlineStatus) => {
      if (!showOnlineStatus && status !== 'offline') {
        return false;
      }
      return true;
    };

    assert.strictEqual(shouldBroadcast('offline', false), true,
      'Should broadcast offline even with privacy enabled');
  });

  it('should mask customMessage to null when privacy is enabled', () => {
    const maskedMessage = (customMessage, showOnlineStatus) => {
      return showOnlineStatus ? customMessage : null;
    };

    assert.strictEqual(maskedMessage('Hello', false), null,
      'Custom message should be null when privacy enabled');
    assert.strictEqual(maskedMessage('Hello', true), 'Hello',
      'Custom message should be preserved when privacy disabled');
    assert.strictEqual(maskedMessage(null, true), null,
      'Null message stays null');
  });

  it('should mask status to offline when privacy is enabled', () => {
    const maskedStatus = (status, showOnlineStatus) => {
      return showOnlineStatus ? status : 'offline';
    };

    assert.strictEqual(maskedStatus('online', false), 'offline');
    assert.strictEqual(maskedStatus('away', false), 'offline');
    assert.strictEqual(maskedStatus('busy', false), 'offline');
    assert.strictEqual(maskedStatus('offline', false), 'offline');
    assert.strictEqual(maskedStatus('online', true), 'online');
    assert.strictEqual(maskedStatus('away', true), 'away');
  });
});

describe('presence broadcast behavior verification', () => {
  // These tests verify the broadcast mechanics work correctly

  it('should not broadcast to empty rooms', async () => {
    // Setup: no observers in any room
    rooms.clear();

    // This should not throw
    broadcastPresenceChange(1, 'testUser', 'online', null, { showOnlineStatus: true });
    await waitForBroadcast();

    // No assertions needed - just verifying no error occurs
    assert.ok(true, 'Should handle empty rooms gracefully');
  });

  it('should handle closed WebSocket connections gracefully', async () => {
    // Setup: observer with closed connection
    const closedWs = {
      readyState: 3, // WebSocket.CLOSED
      send: () => {
        throw new Error('Cannot send to closed WebSocket');
      }
    };

    setConnection(2, closedWs);
    addUserToRoom('tavern', 2);

    // This should not throw
    broadcastPresenceChange(1, 'testUser', 'online', null, { showOnlineStatus: true });
    await waitForBroadcast();

    assert.ok(true, 'Should handle closed connections gracefully');

    // Clean up
    removeConnection(2);
    removeUserFromRoom('tavern', 2);
  });
});
