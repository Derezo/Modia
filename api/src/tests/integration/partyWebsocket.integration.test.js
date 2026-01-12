/**
 * Unit tests for partyWebsocket service
 * Tests party invites, broadcasts, and room management
 */

import { describe, test, beforeEach, afterEach, after } from 'node:test';
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
let characterIdCounter = 50000;

function getUniqueUserId() {
  return userIdCounter++;
}

function getUniquePartyId() {
  return partyIdCounter++;
}

function getUniqueCharacterId() {
  return characterIdCounter++;
}

describe('partyWebsocket', () => {

  describe('sendInvite', () => {
    
    test('should export sendInvite function', () => {
      assert.strictEqual(typeof partyWebsocket.sendInvite, 'function');
    });

    test('should return success with inviteId', async () => {
      const fromUserId = getUniqueUserId();
      const toUserId = getUniqueUserId();
      const characterId = getUniqueCharacterId();
      
      const result = await partyWebsocket.sendInvite(
        fromUserId,
        'testPlayer',
        toUserId,
        characterId
      );
      
      assert.strictEqual(result.success, true);
      assert.ok(typeof result.inviteId === 'number');
    });

    test('should create invite with incrementing IDs', async () => {
      const fromUserId = getUniqueUserId();
      const toUserId1 = getUniqueUserId();
      const toUserId2 = getUniqueUserId();
      
      const result1 = await partyWebsocket.sendInvite(fromUserId, 'player', toUserId1, 1);
      const result2 = await partyWebsocket.sendInvite(fromUserId, 'player', toUserId2, 1);
      
      assert.ok(result2.inviteId > result1.inviteId);
    });
  });

  describe('acceptInvite', () => {
    
    test('should export acceptInvite function', () => {
      assert.strictEqual(typeof partyWebsocket.acceptInvite, 'function');
    });

    test('should accept valid invite', async () => {
      const fromUserId = getUniqueUserId();
      const toUserId = getUniqueUserId();
      
      const inviteResult = await partyWebsocket.sendInvite(
        fromUserId,
        'inviter',
        toUserId,
        1
      );
      
      const acceptResult = await partyWebsocket.acceptInvite(
        inviteResult.inviteId,
        toUserId,
        'accepter'
      );
      
      assert.strictEqual(acceptResult.success, true);
    });

    test('should reject invite for wrong user', async () => {
      const fromUserId = getUniqueUserId();
      const toUserId = getUniqueUserId();
      const wrongUserId = getUniqueUserId();
      
      const inviteResult = await partyWebsocket.sendInvite(
        fromUserId,
        'inviter',
        toUserId,
        1
      );
      
      const acceptResult = await partyWebsocket.acceptInvite(
        inviteResult.inviteId,
        wrongUserId,
        'wrongUser'
      );
      
      assert.strictEqual(acceptResult.success, false);
      assert.ok(acceptResult.error.includes('not for you'));
    });

    test('should reject non-existent invite', async () => {
      const userId = getUniqueUserId();
      
      const result = await partyWebsocket.acceptInvite(99999, userId, 'user');
      
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('not found') || result.error.includes('expired'));
    });
  });

  describe('declineInvite', () => {
    
    test('should export declineInvite function', () => {
      assert.strictEqual(typeof partyWebsocket.declineInvite, 'function');
    });

    test('should decline valid invite', async () => {
      const fromUserId = getUniqueUserId();
      const toUserId = getUniqueUserId();
      
      const inviteResult = await partyWebsocket.sendInvite(
        fromUserId,
        'inviter',
        toUserId,
        1
      );
      
      const declineResult = await partyWebsocket.declineInvite(
        inviteResult.inviteId,
        toUserId
      );
      
      assert.strictEqual(declineResult.success, true);
    });

    test('should reject decline for wrong user', async () => {
      const fromUserId = getUniqueUserId();
      const toUserId = getUniqueUserId();
      const wrongUserId = getUniqueUserId();
      
      const inviteResult = await partyWebsocket.sendInvite(
        fromUserId,
        'inviter',
        toUserId,
        1
      );
      
      const declineResult = await partyWebsocket.declineInvite(
        inviteResult.inviteId,
        wrongUserId
      );
      
      assert.strictEqual(declineResult.success, false);
    });

    test('should reject non-existent invite', async () => {
      const userId = getUniqueUserId();
      
      const result = await partyWebsocket.declineInvite(99999, userId);
      
      assert.strictEqual(result.success, false);
    });
  });

  describe('getPendingInvitesForUser', () => {
    
    test('should export getPendingInvitesForUser function', () => {
      assert.strictEqual(typeof partyWebsocket.getPendingInvitesForUser, 'function');
    });

    test('should return empty array when no invites', () => {
      const userId = getUniqueUserId();
      
      const invites = partyWebsocket.getPendingInvitesForUser(userId);
      
      assert.ok(Array.isArray(invites));
      assert.strictEqual(invites.length, 0);
    });

    test('should return pending invites for user', async () => {
      const fromUserId = getUniqueUserId();
      const toUserId = getUniqueUserId();
      
      await partyWebsocket.sendInvite(fromUserId, 'sender', toUserId, 1);
      
      const invites = partyWebsocket.getPendingInvitesForUser(toUserId);
      
      assert.ok(invites.length >= 1);
      assert.strictEqual(invites[0].fromUserId, fromUserId);
    });

    test('should not return already accepted invites', async () => {
      const fromUserId = getUniqueUserId();
      const toUserId = getUniqueUserId();
      
      const inviteResult = await partyWebsocket.sendInvite(
        fromUserId,
        'sender',
        toUserId,
        1
      );
      
      await partyWebsocket.acceptInvite(inviteResult.inviteId, toUserId, 'receiver');
      
      const invites = partyWebsocket.getPendingInvitesForUser(toUserId);
      const found = invites.find(i => i.inviteId === inviteResult.inviteId);
      
      assert.strictEqual(found, undefined);
    });
  });

  describe('cleanupUserInvites', () => {
    
    test('should export cleanupUserInvites function', () => {
      assert.strictEqual(typeof partyWebsocket.cleanupUserInvites, 'function');
    });

    test('should cancel invites from disconnected user', async () => {
      const fromUserId = getUniqueUserId();
      const toUserId = getUniqueUserId();
      
      await partyWebsocket.sendInvite(fromUserId, 'sender', toUserId, 1);
      
      await partyWebsocket.cleanupUserInvites(fromUserId);
      
      // Invite should be removed - attempting to accept should fail
      const invites = partyWebsocket.getPendingInvitesForUser(toUserId);
      const found = invites.find(i => i.fromUserId === fromUserId);
      
      assert.strictEqual(found, undefined);
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
    
    test('should export all functions via default export', () => {
      const defaultExport = partyWebsocket.default;
      
      assert.strictEqual(typeof defaultExport.sendInvite, 'function');
      assert.strictEqual(typeof defaultExport.acceptInvite, 'function');
      assert.strictEqual(typeof defaultExport.declineInvite, 'function');
      assert.strictEqual(typeof defaultExport.broadcastMemberJoined, 'function');
      assert.strictEqual(typeof defaultExport.broadcastMemberLeft, 'function');
      assert.strictEqual(typeof defaultExport.broadcastPartyDisbanded, 'function');
      assert.strictEqual(typeof defaultExport.broadcastLeaderChanged, 'function');
      assert.strictEqual(typeof defaultExport.joinPartyRoom, 'function');
      assert.strictEqual(typeof defaultExport.leavePartyRoom, 'function');
      assert.strictEqual(typeof defaultExport.getPendingInvitesForUser, 'function');
      assert.strictEqual(typeof defaultExport.cleanupUserInvites, 'function');
    });
  });
});
