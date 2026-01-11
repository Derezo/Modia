/**
 * Unit tests for presenceService
 * Tests presence status, typing indicators, and node presence tracking
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// Import the service
import * as presenceService from '../services/presenceService.js';

// Counter for unique IDs
let userIdCounter = 10000;
let nodeIdCounter = 1000;
let roomCounter = 1;

function getUniqueUserId() {
  return userIdCounter++;
}

function getUniqueNodeId() {
  return nodeIdCounter++;
}

function getUniqueRoomKey() {
  return 'room_' + roomCounter++;
}

describe('presenceService', () => {
  
  describe('Typing Indicators (in-memory)', () => {
    
    test('setTypingIndicator should track user typing in a room', () => {
      const roomKey = getUniqueRoomKey();
      const userId = getUniqueUserId();
      const username = 'typingUser';
      
      presenceService.setTypingIndicator(roomKey, userId, username);
      
      const typingUsers = presenceService.getTypingUsers(roomKey);
      assert.strictEqual(typingUsers.length, 1);
      assert.strictEqual(typingUsers[0].userId, userId);
      assert.strictEqual(typingUsers[0].username, username);
    });

    test('setTypingIndicator should handle multiple users typing', () => {
      const roomKey = getUniqueRoomKey();
      const user1Id = getUniqueUserId();
      const user2Id = getUniqueUserId();
      
      presenceService.setTypingIndicator(roomKey, user1Id, 'user1');
      presenceService.setTypingIndicator(roomKey, user2Id, 'user2');
      
      const typingUsers = presenceService.getTypingUsers(roomKey);
      assert.strictEqual(typingUsers.length, 2);
    });

    test('clearTypingIndicator should remove specific user from room', () => {
      const roomKey = getUniqueRoomKey();
      const userId = getUniqueUserId();
      
      presenceService.setTypingIndicator(roomKey, userId, 'testUser');
      presenceService.clearTypingIndicator(userId, roomKey);
      
      const typingUsers = presenceService.getTypingUsers(roomKey);
      assert.strictEqual(typingUsers.length, 0);
    });

    test('clearTypingIndicator should remove user from all rooms when no roomKey provided', () => {
      const room1 = getUniqueRoomKey();
      const room2 = getUniqueRoomKey();
      const userId = getUniqueUserId();
      
      presenceService.setTypingIndicator(room1, userId, 'testUser');
      presenceService.setTypingIndicator(room2, userId, 'testUser');
      
      presenceService.clearTypingIndicator(userId);
      
      assert.strictEqual(presenceService.getTypingUsers(room1).length, 0);
      assert.strictEqual(presenceService.getTypingUsers(room2).length, 0);
    });

    test('getTypingUsers should return empty array for non-existent room', () => {
      const roomKey = getUniqueRoomKey();
      
      const typingUsers = presenceService.getTypingUsers(roomKey);
      assert.ok(Array.isArray(typingUsers));
      assert.strictEqual(typingUsers.length, 0);
    });

    test('setTypingIndicator should update timestamp on repeated calls', () => {
      const roomKey = getUniqueRoomKey();
      const userId = getUniqueUserId();
      
      presenceService.setTypingIndicator(roomKey, userId, 'testUser');
      presenceService.setTypingIndicator(roomKey, userId, 'testUser');
      
      const typingUsersAfter = presenceService.getTypingUsers(roomKey);
      
      // Should still only have one entry
      assert.strictEqual(typingUsersAfter.length, 1);
    });
  });

  describe('Node Presence Tracking (in-memory)', () => {
    
    test('enterNode should track player at a node', () => {
      const nodeId = getUniqueNodeId();
      const userId = getUniqueUserId();
      
      const entry = presenceService.enterNode(nodeId, userId, 'testUser', 'TestCharacter');
      
      assert.strictEqual(entry.userId, userId);
      assert.strictEqual(entry.username, 'testUser');
      assert.strictEqual(entry.characterName, 'TestCharacter');
      assert.ok(typeof entry.enteredAt === 'number');
    });

    test('getPlayersAtNode should return all players at a node', () => {
      const nodeId = getUniqueNodeId();
      const user1Id = getUniqueUserId();
      const user2Id = getUniqueUserId();
      
      presenceService.enterNode(nodeId, user1Id, 'user1', 'Char1');
      presenceService.enterNode(nodeId, user2Id, 'user2', 'Char2');
      
      const players = presenceService.getPlayersAtNode(nodeId);
      assert.strictEqual(players.length, 2);
    });

    test('getPlayersAtNode should return empty array for empty node', () => {
      const nodeId = getUniqueNodeId();
      
      const players = presenceService.getPlayersAtNode(nodeId);
      assert.ok(Array.isArray(players));
      assert.strictEqual(players.length, 0);
    });

    test('leaveNode should remove player from node', () => {
      const nodeId = getUniqueNodeId();
      const userId = getUniqueUserId();
      
      presenceService.enterNode(nodeId, userId, 'testUser');
      const leftData = presenceService.leaveNode(nodeId, userId);
      
      assert.ok(leftData !== null);
      assert.strictEqual(leftData.userId, userId);
      
      const players = presenceService.getPlayersAtNode(nodeId);
      assert.strictEqual(players.length, 0);
    });

    test('leaveNode should return null for user not at node', () => {
      const nodeId = getUniqueNodeId();
      const userId = getUniqueUserId();
      
      const leftData = presenceService.leaveNode(nodeId, userId);
      assert.strictEqual(leftData, null);
    });

    test('leaveNode should return null for non-existent node', () => {
      const nodeId = getUniqueNodeId();
      const userId = getUniqueUserId();
      
      const leftData = presenceService.leaveNode(nodeId, userId);
      assert.strictEqual(leftData, null);
    });

    test('moveNode should transfer player between nodes', () => {
      const fromNodeId = getUniqueNodeId();
      const toNodeId = getUniqueNodeId();
      const userId = getUniqueUserId();
      
      presenceService.enterNode(fromNodeId, userId, 'testUser', 'TestChar');
      
      const moveResult = presenceService.moveNode(fromNodeId, toNodeId, userId, 'testUser', 'TestChar');
      
      assert.ok(moveResult.left !== null);
      assert.ok(moveResult.entered !== null);
      assert.strictEqual(moveResult.fromNodeId, fromNodeId);
      assert.strictEqual(moveResult.toNodeId, toNodeId);
      
      // Check player is now at new node
      assert.strictEqual(presenceService.getPlayersAtNode(fromNodeId).length, 0);
      assert.strictEqual(presenceService.getPlayersAtNode(toNodeId).length, 1);
    });

    test('getNodePlayerCount should return correct count', () => {
      const nodeId = getUniqueNodeId();
      const user1Id = getUniqueUserId();
      const user2Id = getUniqueUserId();
      const user3Id = getUniqueUserId();
      
      assert.strictEqual(presenceService.getNodePlayerCount(nodeId), 0);
      
      presenceService.enterNode(nodeId, user1Id, 'user1');
      assert.strictEqual(presenceService.getNodePlayerCount(nodeId), 1);
      
      presenceService.enterNode(nodeId, user2Id, 'user2');
      presenceService.enterNode(nodeId, user3Id, 'user3');
      assert.strictEqual(presenceService.getNodePlayerCount(nodeId), 3);
    });

    test('clearUserFromAllNodes should remove user from all nodes', () => {
      const node1Id = getUniqueNodeId();
      const node2Id = getUniqueNodeId();
      const node3Id = getUniqueNodeId();
      const userId = getUniqueUserId();
      
      presenceService.enterNode(node1Id, userId, 'testUser');
      presenceService.enterNode(node2Id, userId, 'testUser');
      presenceService.enterNode(node3Id, userId, 'testUser');
      
      const removedFrom = presenceService.clearUserFromAllNodes(userId);
      
      assert.strictEqual(removedFrom.length, 3);
      assert.ok(removedFrom.includes(node1Id));
      assert.ok(removedFrom.includes(node2Id));
      assert.ok(removedFrom.includes(node3Id));
      
      assert.strictEqual(presenceService.getPlayersAtNode(node1Id).length, 0);
      assert.strictEqual(presenceService.getPlayersAtNode(node2Id).length, 0);
      assert.strictEqual(presenceService.getPlayersAtNode(node3Id).length, 0);
    });

    test('clearUserFromAllNodes should return empty array if user not at any node', () => {
      const userId = getUniqueUserId();
      
      const removedFrom = presenceService.clearUserFromAllNodes(userId);
      assert.ok(Array.isArray(removedFrom));
      assert.strictEqual(removedFrom.length, 0);
    });
  });

  describe('Exported Functions', () => {
    
    test('should export setPresence function', () => {
      assert.strictEqual(typeof presenceService.setPresence, 'function');
    });

    test('should export getPresence function', () => {
      assert.strictEqual(typeof presenceService.getPresence, 'function');
    });

    test('should export getOnlinePlayers function', () => {
      assert.strictEqual(typeof presenceService.getOnlinePlayers, 'function');
    });

    test('should export updateActivity function', () => {
      assert.strictEqual(typeof presenceService.updateActivity, 'function');
    });

    test('should export setOffline function', () => {
      assert.strictEqual(typeof presenceService.setOffline, 'function');
    });

    test('should export cleanupStalePresence function', () => {
      assert.strictEqual(typeof presenceService.cleanupStalePresence, 'function');
    });

    test('should export getPresenceCache function', () => {
      assert.strictEqual(typeof presenceService.getPresenceCache, 'function');
      const cache = presenceService.getPresenceCache();
      assert.ok(cache instanceof Map);
    });

    test('should export getNodePresenceMap function', () => {
      assert.strictEqual(typeof presenceService.getNodePresenceMap, 'function');
      const map = presenceService.getNodePresenceMap();
      assert.ok(map instanceof Map);
    });

    test('should export getUserCurrentNode function', () => {
      assert.strictEqual(typeof presenceService.getUserCurrentNode, 'function');
    });
  });

  describe('Presence Cache', () => {
    
    test('getUserCurrentNode should return null for unknown user', () => {
      const userId = getUniqueUserId();
      
      const nodeId = presenceService.getUserCurrentNode(userId);
      assert.strictEqual(nodeId, null);
    });
  });

  describe('Default Export', () => {
    
    test('should export all functions via default export', () => {
      const defaultExport = presenceService.default;
      
      assert.strictEqual(typeof defaultExport.setPresence, 'function');
      assert.strictEqual(typeof defaultExport.getPresence, 'function');
      assert.strictEqual(typeof defaultExport.getOnlinePlayers, 'function');
      assert.strictEqual(typeof defaultExport.updateActivity, 'function');
      assert.strictEqual(typeof defaultExport.setOffline, 'function');
      assert.strictEqual(typeof defaultExport.setTypingIndicator, 'function');
      assert.strictEqual(typeof defaultExport.clearTypingIndicator, 'function');
      assert.strictEqual(typeof defaultExport.getTypingUsers, 'function');
      assert.strictEqual(typeof defaultExport.enterNode, 'function');
      assert.strictEqual(typeof defaultExport.leaveNode, 'function');
      assert.strictEqual(typeof defaultExport.moveNode, 'function');
      assert.strictEqual(typeof defaultExport.getPlayersAtNode, 'function');
      assert.strictEqual(typeof defaultExport.getNodePlayerCount, 'function');
      assert.strictEqual(typeof defaultExport.clearUserFromAllNodes, 'function');
    });
  });
});
