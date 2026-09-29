/**
 * Unit tests for partyWebsocket service
 * Tests party invites (REST-driven), broadcasts, and room management
 *
 * NOTE: Party invites are now handled via REST API (POST /api/party/multiplayer/:partyId/invite).
 * The partyWebsocket module now only handles WebSocket notifications (sendInvite) and broadcasts.
 * It no longer exports acceptInvite, getPendingInvitesForUser, or cleanupUserInvites.
 */

import { describe, test, after } from 'node:test';
import assert from 'node:assert';

// Import the service
import * as partyWebsocket from '../../services/partyWebsocket.js';

// Clean up all timeouts after all tests complete to prevent hanging
after(() => {
  partyWebsocket._clearAllTimeouts();
});

// Counter for unique IDs
let userIdCounter = 30000;
let partyIdCounter = 5000;

function getUniqueUserId() {
  return userIdCounter++;
}

function getUniquePartyId() {
  return partyIdCounter++;
}

describe('partyWebsocket', () => {

  describe('sendInvite', () => {
    test('should export sendInvite function', () => {
      assert.strictEqual(typeof partyWebsocket.sendInvite, 'function');
    });

    test('should return success with inviteId when called with proper params', async () => {
      // sendInvite now expects { inviteId, expiresAt, fromUserId, fromUsername, toUserId, partyId, partyName }
      const result = await partyWebsocket.sendInvite({
        inviteId: 12345,
        expiresAt: new Date(Date.now() + 60000),
        fromUserId: getUniqueUserId(),
        fromUsername: 'testPlayer',
        toUserId: getUniqueUserId(),
        partyId: getUniquePartyId(),
        partyName: 'Test Party'
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.inviteId, 12345);
    });
  });

  describe('declineInvite', () => {
    test('should export declineInvite function', () => {
      assert.strictEqual(typeof partyWebsocket.declineInvite, 'function');
    });

    test('should return success (no-op for backwards compatibility)', async () => {
      const result = await partyWebsocket.declineInvite(99999, getUniqueUserId());
      assert.strictEqual(result.success, true);
    });
  });

  describe('Removed Functions', () => {
    test('acceptInvite should not be exported (handled via REST)', () => {
      assert.strictEqual(partyWebsocket.acceptInvite, undefined);
    });

    test('getPendingInvitesForUser should not be exported (handled via REST)', () => {
      assert.strictEqual(partyWebsocket.getPendingInvitesForUser, undefined);
    });

    test('cleanupUserInvites should not be exported (invites are in DB now)', () => {
      assert.strictEqual(partyWebsocket.cleanupUserInvites, undefined);
    });
  });

  describe('Party Room Functions', () => {
    test('should export joinPartyRoom function', () => {
      assert.strictEqual(typeof partyWebsocket.joinPartyRoom, 'function');
    });

    test('should export leavePartyRoom function', () => {
      assert.strictEqual(typeof partyWebsocket.leavePartyRoom, 'function');
    });

    test('joinPartyRoom should not throw', async () => {
      const partyId = getUniquePartyId();
      const userId = getUniqueUserId();

      await assert.doesNotReject(async () => {
        await partyWebsocket.joinPartyRoom(partyId, userId);
      });
    });

    test('leavePartyRoom should not throw', async () => {
      const partyId = getUniquePartyId();
      const userId = getUniqueUserId();

      await assert.doesNotReject(async () => {
        await partyWebsocket.leavePartyRoom(partyId, userId);
      });
    });
  });

  describe('Broadcast Functions', () => {
    test('should export broadcastMemberJoined function', () => {
      assert.strictEqual(typeof partyWebsocket.broadcastMemberJoined, 'function');
    });

    test('should export broadcastMemberLeft function', () => {
      assert.strictEqual(typeof partyWebsocket.broadcastMemberLeft, 'function');
    });

    test('should export broadcastPartyDisbanded function', () => {
      assert.strictEqual(typeof partyWebsocket.broadcastPartyDisbanded, 'function');
    });

    test('should export broadcastLeaderChanged function', () => {
      assert.strictEqual(typeof partyWebsocket.broadcastLeaderChanged, 'function');
    });

    test('broadcastMemberJoined should not throw', async () => {
      const partyId = getUniquePartyId();
      const userId = getUniqueUserId();

      await assert.doesNotReject(async () => {
        await partyWebsocket.broadcastMemberJoined(partyId, userId, 'newMember', 'CharName');
      });
    });

    test('broadcastMemberLeft should not throw', async () => {
      const partyId = getUniquePartyId();
      const userId = getUniqueUserId();

      await assert.doesNotReject(async () => {
        await partyWebsocket.broadcastMemberLeft(partyId, userId, 'leavingMember', 'left');
      });
    });

    test('broadcastMemberLeft should accept different reasons', async () => {
      const partyId = getUniquePartyId();
      const userId = getUniqueUserId();

      await assert.doesNotReject(async () => {
        await partyWebsocket.broadcastMemberLeft(partyId, userId, 'member', 'kicked');
      });

      await assert.doesNotReject(async () => {
        await partyWebsocket.broadcastMemberLeft(partyId, userId, 'member', 'disconnected');
      });
    });

    test('broadcastPartyDisbanded should not throw', async () => {
      const partyId = getUniquePartyId();

      await assert.doesNotReject(async () => {
        await partyWebsocket.broadcastPartyDisbanded(partyId, 'Leader left');
      });
    });

    test('broadcastLeaderChanged should not throw', async () => {
      const partyId = getUniquePartyId();
      const newLeaderId = getUniqueUserId();

      await assert.doesNotReject(async () => {
        await partyWebsocket.broadcastLeaderChanged(partyId, newLeaderId, 'newLeader');
      });
    });
  });

  describe('Default Export', () => {
    test('should export all current functions via default export', () => {
      const defaultExport = partyWebsocket.default;

      assert.strictEqual(typeof defaultExport.sendInvite, 'function');
      assert.strictEqual(typeof defaultExport.declineInvite, 'function');
      assert.strictEqual(typeof defaultExport.broadcastMemberJoined, 'function');
      assert.strictEqual(typeof defaultExport.broadcastMemberLeft, 'function');
      assert.strictEqual(typeof defaultExport.broadcastPartyDisbanded, 'function');
      assert.strictEqual(typeof defaultExport.broadcastLeaderChanged, 'function');
      assert.strictEqual(typeof defaultExport.joinPartyRoom, 'function');
      assert.strictEqual(typeof defaultExport.leavePartyRoom, 'function');
      assert.strictEqual(typeof defaultExport._clearAllTimeouts, 'function');
    });
  });
});
