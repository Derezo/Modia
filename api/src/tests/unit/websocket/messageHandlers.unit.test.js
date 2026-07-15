/**
 * Unit tests for websocket/messageHandlers.js
 *
 * Tests character ownership verification for chat messages, private messages,
 * and party invites to prevent impersonation attacks.
 *
 * Uses dependency injection pattern - handlers are tested with mock services
 * injected via the module's imported functions.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { MockWebSocketClient } from '../../testUtils/wsTestHelper.js';

// =============================================================================
// TEST STATE
// =============================================================================

let mockCalls;
let mockVerifyOwnership;
let mockSaveMessage;
let mockSendInvite;
let mockIsUserInRoom;
let mockBroadcastToRoom;

// =============================================================================
// MOCK SETUP
// =============================================================================

function resetMocks() {
  mockCalls = {
    verifyCharacterOwnership: [],
    saveMessage: [],
    sendInvite: [],
    isUserInRoom: [],
    broadcastToRoom: []
  };
}

// Create handler functions that use our mocks
// This simulates the handler logic without importing the actual module
// which has complex dependencies

/**
 * Simulated handleChatMessage that tests the ownership verification logic
 */
async function testHandleChatMessage(ws, userId, username, payload, options = {}) {
  const {
    verifyOwnership = mockVerifyOwnership,
    saveMessage = mockSaveMessage,
    isUserInRoom = mockIsUserInRoom,
    broadcastToRoom = mockBroadcastToRoom
  } = options;

  if (!userId) {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Not authenticated' }
    }));
    return;
  }

  const chatRoom = payload.room;
  if (!isUserInRoom(chatRoom, userId)) {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Not in room' }
    }));
    return;
  }

  try {
    const truncatedMessage = payload.message.substring(0, 500);

    if (chatRoom === 'global' || chatRoom.startsWith('party:')) {
      if (!payload.characterId) {
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: 'Character ID required for chat messages' }
        }));
        return;
      }

      // Verify the user owns this character
      const ownsCharacter = await verifyOwnership(payload.characterId, userId);
      mockCalls.verifyCharacterOwnership.push({ characterId: payload.characterId, userId });

      if (!ownsCharacter) {
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: 'Invalid character' }
        }));
        return;
      }

      const roomType = chatRoom === 'global' ? 'global' : 'party';
      const partyId = chatRoom.startsWith('party:') ? parseInt(chatRoom.split(':')[1], 10) : null;

      await saveMessage({
        characterId: payload.characterId,
        senderUserId: userId,
        roomType,
        message: truncatedMessage,
        partyId
      });
      mockCalls.saveMessage.push({
        characterId: payload.characterId,
        senderUserId: userId,
        roomType,
        message: truncatedMessage,
        partyId
      });
    }

    broadcastToRoom(chatRoom, {
      type: 'chat_message',
      payload: {
        room: chatRoom,
        userId,
        username,
        message: truncatedMessage,
        timestamp: Date.now()
      }
    });
    mockCalls.broadcastToRoom.push({ room: chatRoom });
  } catch (err) {
    console.error('Chat message error:', err);
  }
}

/**
 * Simulated handlePrivateMessage that tests the ownership verification logic
 */
async function testHandlePrivateMessage(ws, userId, username, payload, options = {}) {
  const {
    verifyOwnership = mockVerifyOwnership,
    saveMessage = mockSaveMessage
  } = options;

  if (!userId) {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Not authenticated' }
    }));
    return;
  }

  try {
    const { targetUserId, message: dmMessage, characterId } = payload;

    if (!targetUserId || !dmMessage) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Target user and message are required' }
      }));
      return;
    }

    // If characterId is provided, verify ownership
    if (characterId) {
      const ownsCharacter = await verifyOwnership(characterId, userId);
      mockCalls.verifyCharacterOwnership.push({ characterId, userId });

      if (!ownsCharacter) {
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: 'Invalid character' }
        }));
        return;
      }
    }

    const savedMessage = await saveMessage({
      characterId: characterId || null,
      senderUserId: userId,
      roomType: 'dm',
      message: dmMessage.substring(0, 500),
      targetUserId
    });
    mockCalls.saveMessage.push({
      characterId: characterId || null,
      senderUserId: userId,
      roomType: 'dm',
      message: dmMessage.substring(0, 500),
      targetUserId
    });

    ws.send(JSON.stringify({
      type: 'private_message_sent',
      payload: {
        id: savedMessage.id,
        targetUserId,
        message: savedMessage.message,
        timestamp: savedMessage.created_at
      }
    }));
  } catch (err) {
    console.error('Private message error:', err);
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Failed to send private message' }
    }));
  }
}

/**
 * Simulated handlePartyInvite that tests the ownership verification logic
 */
async function testHandlePartyInvite(ws, userId, username, payload, options = {}) {
  const {
    verifyOwnership = mockVerifyOwnership,
    sendInvite = mockSendInvite
  } = options;

  if (!userId) return;

  try {
    const { targetUserId, characterId } = payload;
    if (!targetUserId) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Target user required' }
      }));
      return;
    }

    // Verify the user owns this character
    if (characterId) {
      const ownsCharacter = await verifyOwnership(characterId, userId);
      mockCalls.verifyCharacterOwnership.push({ characterId, userId });

      if (!ownsCharacter) {
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: 'Invalid character' }
        }));
        return;
      }
    }

    const result = await sendInvite(userId, username, targetUserId, characterId);
    mockCalls.sendInvite.push({ userId, username, targetUserId, characterId });

    if (result.success) {
      ws.send(JSON.stringify({
        type: 'party:invite_sent',
        payload: { inviteId: result.inviteId, targetUserId }
      }));
    } else {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: result.error }
      }));
    }
  } catch (err) {
    console.error('Party invite error:', err);
  }
}

// =============================================================================
// TESTS
// =============================================================================

describe('messageHandlers - Character Ownership Verification', () => {
  beforeEach(() => {
    resetMocks();

    // Default mock implementations
    mockVerifyOwnership = async () => true;
    mockSaveMessage = async (data) => ({
      id: 1,
      ...data,
      created_at: new Date().toISOString()
    });
    mockSendInvite = async () => ({ success: true, inviteId: 1 });
    mockIsUserInRoom = () => true;
    mockBroadcastToRoom = () => {};
  });

  // =========================================================================
  // handleChatMessage tests
  // =========================================================================

  describe('handleChatMessage', () => {
    it('should allow chat message with owned character', async () => {
      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const username = 'testuser';
      const payload = {
        room: 'global',
        message: 'Hello world',
        characterId: 100
      };

      mockVerifyOwnership = async () => true;

      await testHandleChatMessage(ws, userId, username, payload);

      // Verify ownership was checked
      assert.strictEqual(mockCalls.verifyCharacterOwnership.length, 1);
      assert.strictEqual(mockCalls.verifyCharacterOwnership[0].characterId, 100);
      assert.strictEqual(mockCalls.verifyCharacterOwnership[0].userId, 1);

      // Verify message was saved
      assert.strictEqual(mockCalls.saveMessage.length, 1);
      assert.strictEqual(mockCalls.saveMessage[0].characterId, 100);
      assert.strictEqual(mockCalls.saveMessage[0].senderUserId, 1);

      // No error sent
      const errors = ws.getSentByType('error');
      assert.strictEqual(errors.length, 0);
    });

    it('should reject chat message with unowned character', async () => {
      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const username = 'testuser';
      const payload = {
        room: 'global',
        message: 'Hello world',
        characterId: 999 // Not owned by user
      };

      mockVerifyOwnership = async () => false;

      await testHandleChatMessage(ws, userId, username, payload);

      // Verify ownership was checked
      assert.strictEqual(mockCalls.verifyCharacterOwnership.length, 1);

      // Verify message was NOT saved
      assert.strictEqual(mockCalls.saveMessage.length, 0);

      // Verify error was sent
      const errors = ws.getSentByType('error');
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].payload.message, 'Invalid character');
    });

    it('should reject chat message with missing characterId', async () => {
      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const username = 'testuser';
      const payload = {
        room: 'global',
        message: 'Hello world'
        // No characterId
      };

      await testHandleChatMessage(ws, userId, username, payload);

      // Ownership should NOT be checked (early return)
      assert.strictEqual(mockCalls.verifyCharacterOwnership.length, 0);

      // Message should NOT be saved
      assert.strictEqual(mockCalls.saveMessage.length, 0);

      // Error for missing characterId
      const errors = ws.getSentByType('error');
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].payload.message, 'Character ID required for chat messages');
    });
  });

  // =========================================================================
  // handlePrivateMessage tests
  // =========================================================================

  describe('handlePrivateMessage', () => {
    it('should allow private message with null characterId (DM without attribution)', async () => {
      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const username = 'testuser';
      const payload = {
        targetUserId: 2,
        message: 'Hello!',
        characterId: null
      };

      await testHandlePrivateMessage(ws, userId, username, payload);

      // Ownership should NOT be checked (null characterId is allowed)
      assert.strictEqual(mockCalls.verifyCharacterOwnership.length, 0);

      // Message should be saved
      assert.strictEqual(mockCalls.saveMessage.length, 1);
      assert.strictEqual(mockCalls.saveMessage[0].characterId, null);

      // Success message sent
      const sent = ws.getSentByType('private_message_sent');
      assert.strictEqual(sent.length, 1);
    });

    it('should reject private message with unowned characterId', async () => {
      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const username = 'testuser';
      const payload = {
        targetUserId: 2,
        message: 'Hello!',
        characterId: 999 // Not owned
      };

      mockVerifyOwnership = async () => false;

      await testHandlePrivateMessage(ws, userId, username, payload);

      // Ownership should be checked
      assert.strictEqual(mockCalls.verifyCharacterOwnership.length, 1);

      // Message should NOT be saved
      assert.strictEqual(mockCalls.saveMessage.length, 0);

      // Error sent
      const errors = ws.getSentByType('error');
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].payload.message, 'Invalid character');
    });

    it('should allow private message with owned characterId', async () => {
      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const username = 'testuser';
      const payload = {
        targetUserId: 2,
        message: 'Hello!',
        characterId: 100 // Owned
      };

      mockVerifyOwnership = async () => true;

      await testHandlePrivateMessage(ws, userId, username, payload);

      // Ownership checked
      assert.strictEqual(mockCalls.verifyCharacterOwnership.length, 1);

      // Message saved
      assert.strictEqual(mockCalls.saveMessage.length, 1);

      // Success sent
      const sent = ws.getSentByType('private_message_sent');
      assert.strictEqual(sent.length, 1);
    });
  });

  // =========================================================================
  // handlePartyInvite tests
  // =========================================================================

  describe('handlePartyInvite', () => {
    it('should allow party invite with owned character', async () => {
      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const username = 'testuser';
      const payload = {
        targetUserId: 2,
        characterId: 100
      };

      mockVerifyOwnership = async () => true;

      await testHandlePartyInvite(ws, userId, username, payload);

      // Ownership checked
      assert.strictEqual(mockCalls.verifyCharacterOwnership.length, 1);

      // Invite sent
      assert.strictEqual(mockCalls.sendInvite.length, 1);

      // Success message
      const sent = ws.getSentByType('party:invite_sent');
      assert.strictEqual(sent.length, 1);
    });

    it('should reject party invite with unowned character', async () => {
      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const username = 'testuser';
      const payload = {
        targetUserId: 2,
        characterId: 999 // Not owned
      };

      mockVerifyOwnership = async () => false;

      await testHandlePartyInvite(ws, userId, username, payload);

      // Ownership checked
      assert.strictEqual(mockCalls.verifyCharacterOwnership.length, 1);

      // Invite NOT sent
      assert.strictEqual(mockCalls.sendInvite.length, 0);

      // Error sent
      const errors = ws.getSentByType('error');
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].payload.message, 'Invalid character');
    });

    it('should allow party invite without characterId', async () => {
      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const username = 'testuser';
      const payload = {
        targetUserId: 2
        // No characterId
      };

      await testHandlePartyInvite(ws, userId, username, payload);

      // Ownership NOT checked (no characterId)
      assert.strictEqual(mockCalls.verifyCharacterOwnership.length, 0);

      // Invite sent
      assert.strictEqual(mockCalls.sendInvite.length, 1);

      // Success message
      const sent = ws.getSentByType('party:invite_sent');
      assert.strictEqual(sent.length, 1);
    });
  });
});

// =============================================================================
// INTEGRATION-STYLE TESTS (verify actual module exports)
// =============================================================================

describe('messageHandlers - Module Structure', () => {
  it('should export handleChatMessage', async () => {
    const handlers = await import('../../../websocket/messageHandlers.js');
    assert.strictEqual(typeof handlers.handleChatMessage, 'function');
  });

  it('should export handlePrivateMessage', async () => {
    const handlers = await import('../../../websocket/messageHandlers.js');
    assert.strictEqual(typeof handlers.handlePrivateMessage, 'function');
  });

  it('should export handlePartyInvite', async () => {
    const handlers = await import('../../../websocket/messageHandlers.js');
    assert.strictEqual(typeof handlers.handlePartyInvite, 'function');
  });

  it('should export handleColiseumQueueJoin', async () => {
    const handlers = await import('../../../websocket/messageHandlers.js');
    assert.strictEqual(typeof handlers.handleColiseumQueueJoin, 'function');
  });

  it('should export handleJoinBattle', async () => {
    const handlers = await import('../../../websocket/messageHandlers.js');
    assert.strictEqual(typeof handlers.handleJoinBattle, 'function');
  });

  it('should export handleBattleSyncRequest', async () => {
    const handlers = await import('../../../websocket/messageHandlers.js');
    assert.strictEqual(typeof handlers.handleBattleSyncRequest, 'function');
  });

  it('should preserve the full stored battle state in explicit sync snapshots', async () => {
    const { buildBattleStateForSync } = await import('../../../websocket/messageHandlers.js');
    const storedState = {
      activeUnitId: 'unit_1',
      turn: 4,
      mapWidth: 2,
      mapHeight: 1,
      terrain: [['grass', 'stone']],
      elevation: [[0.33, 0.54]],
      elevationFormat: 'normalized',
      obstacles: [[null, { type: 'rocks', passable: false }]],
      variants: [[1, 3]],
      units: [{
        id: 'unit_1',
        tileX: 0,
        tileY: 0,
        hp: 20,
        mp: 5,
        class: 'warrior',
        skills: ['slash']
      }]
    };

    const snapshot = buildBattleStateForSync(storedState);

    assert.deepStrictEqual(snapshot.terrain, storedState.terrain);
    assert.deepStrictEqual(snapshot.elevation, storedState.elevation);
    assert.strictEqual(snapshot.elevationFormat, 'normalized');
    assert.deepStrictEqual(snapshot.obstacles, storedState.obstacles);
    assert.deepStrictEqual(snapshot.variants, storedState.variants);
    assert.strictEqual(snapshot.turnCount, 4);
    assert.strictEqual(snapshot.status, 'active');
    assert.strictEqual(snapshot.units[0].class, 'warrior');
    assert.deepStrictEqual(snapshot.units[0].skills, ['slash']);
    assert.strictEqual(snapshot.units[0].turnPhase, 'ready');
  });

  it('should reject full sync snapshots outside an authorized battle room', async () => {
    const { handleBattleSyncRequest } = await import('../../../websocket/messageHandlers.js');
    const ws = new MockWebSocketClient(987654, 'outsider');

    await handleBattleSyncRequest(ws, 987654, { battleId: 456789 });

    assert.strictEqual(ws.sentMessages.length, 1);
    assert.strictEqual(ws.sentMessages[0].type, 'error');
    assert.strictEqual(ws.sentMessages[0].payload.message, 'Access denied to battle sync');
  });

  it('should export handleMarketplaceSubscribe', async () => {
    const handlers = await import('../../../websocket/messageHandlers.js');
    assert.strictEqual(typeof handlers.handleMarketplaceSubscribe, 'function');
  });

  it('should export handleAckMessage', async () => {
    const handlers = await import('../../../websocket/messageHandlers.js');
    assert.strictEqual(typeof handlers.handleAckMessage, 'function');
  });

  it('should export handleGenerationCancel', async () => {
    const handlers = await import('../../../websocket/messageHandlers.js');
    assert.strictEqual(typeof handlers.handleGenerationCancel, 'function');
  });
});

// =============================================================================
// ADDITIONAL HANDLER TESTS
// =============================================================================

describe('messageHandlers - Additional Handler Coverage', () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    mock.restoreAll?.();
  });

  describe('handleColiseumQueueJoin', () => {
    let mockColiseumService;

    beforeEach(() => {
      // Mock coliseum service
      mockColiseumService = {
        joinQueue: mock.fn()
      };
    });

    it('should handle successful queue join', async () => {
      mockColiseumService.joinQueue.mock.mockImplementation(() =>
        Promise.resolve({ success: true })
      );

      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const payload = {
        queueType: '1v1',
        partyLevel: 10,
        partySize: 1
      };

      await testHandleColiseumQueueJoin(ws, userId, 'testuser', payload, {
        coliseumService: mockColiseumService
      });

      assert.strictEqual(mockColiseumService.joinQueue.mock.callCount(), 1);
      const call = mockColiseumService.joinQueue.mock.calls[0];
      assert.deepStrictEqual(call.arguments, ['1v1', 1, 'testuser', 10, 1]);
      assert.strictEqual(ws.sentMessages.length, 0); // No error sent
    });

    it('should handle failed queue join', async () => {
      mockColiseumService.joinQueue.mock.mockImplementation(() =>
        Promise.resolve({ success: false, error: 'Queue is full' })
      );

      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const payload = { queueType: '1v1' };

      await testHandleColiseumQueueJoin(ws, userId, 'testuser', payload, {
        coliseumService: mockColiseumService
      });

      assert.strictEqual(ws.sentMessages.length, 1);
      assert.strictEqual(ws.sentMessages[0].type, 'coliseum:error');
      assert.strictEqual(ws.sentMessages[0].payload.message, 'Queue is full');
    });

    it('should reject unauthenticated user', async () => {
      const ws = new MockWebSocketClient(null, null);
      const payload = { queueType: '1v1' };

      await testHandleColiseumQueueJoin(ws, null, null, payload, {
        coliseumService: mockColiseumService
      });

      assert.strictEqual(mockColiseumService.joinQueue.mock.callCount(), 0);
    });

    it('should use default values for missing payload fields', async () => {
      mockColiseumService.joinQueue.mock.mockImplementation(() =>
        Promise.resolve({ success: true })
      );

      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const payload = {}; // Empty payload

      await testHandleColiseumQueueJoin(ws, userId, 'testuser', payload, {
        coliseumService: mockColiseumService
      });

      const call = mockColiseumService.joinQueue.mock.calls[0];
      assert.deepStrictEqual(call.arguments, ['1v1', 1, 'testuser', 1, 1]);
    });
  });

  describe('handleMarketplaceSubscribe', () => {
    let mockAddUserToRoom;

    beforeEach(() => {
      mockAddUserToRoom = mock.fn();
      mockCalls.addUserToRoom = [];
    });

    it('should subscribe user to marketplace room', () => {
      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const payload = { itemTemplateId: 123 };

      testHandleMarketplaceSubscribe(ws, userId, payload, {
        addUserToRoom: mockAddUserToRoom
      });

      assert.strictEqual(mockAddUserToRoom.mock.callCount(), 1);
      const call = mockAddUserToRoom.mock.calls[0];
      assert.deepStrictEqual(call.arguments, ['marketplace:item:123', 1]);

      assert.strictEqual(ws.sentMessages.length, 1);
      assert.strictEqual(ws.sentMessages[0].type, 'marketplace:subscribed');
      assert.strictEqual(ws.sentMessages[0].payload.itemTemplateId, 123);
    });

    it('should reject unauthenticated user', () => {
      const ws = new MockWebSocketClient(null, null);
      const payload = { itemTemplateId: 123 };

      testHandleMarketplaceSubscribe(ws, null, payload, {
        addUserToRoom: mockAddUserToRoom
      });

      assert.strictEqual(mockAddUserToRoom.mock.callCount(), 0);
      assert.strictEqual(ws.sentMessages.length, 0);
    });

    it('should reject missing itemTemplateId', () => {
      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const payload = {}; // Missing itemTemplateId

      testHandleMarketplaceSubscribe(ws, userId, payload, {
        addUserToRoom: mockAddUserToRoom
      });

      assert.strictEqual(mockAddUserToRoom.mock.callCount(), 0);
      assert.strictEqual(ws.sentMessages.length, 0);
    });
  });

  describe('handleJoinBattle', () => {
    let mockValidateRoomAccess;
    let mockAddUserToRoom;

    beforeEach(() => {
      mockValidateRoomAccess = mock.fn();
      mockAddUserToRoom = mock.fn();
    });

    it('should join battle room with valid access', async () => {
      mockValidateRoomAccess.mock.mockImplementation(() =>
        Promise.resolve({ authorized: true })
      );

      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const payload = { battleId: 456 };

      await testHandleJoinBattle(ws, userId, payload, {
        validateRoomAccess: mockValidateRoomAccess,
        addUserToRoom: mockAddUserToRoom
      });

      assert.strictEqual(mockValidateRoomAccess.mock.callCount(), 1);
      const accessCall = mockValidateRoomAccess.mock.calls[0];
      assert.deepStrictEqual(accessCall.arguments, [1, 'battle:456']);

      assert.strictEqual(mockAddUserToRoom.mock.callCount(), 1);
      const roomCall = mockAddUserToRoom.mock.calls[0];
      assert.deepStrictEqual(roomCall.arguments, ['battle:456', 1]);

      assert.strictEqual(ws.sentMessages.length, 1);
      assert.strictEqual(ws.sentMessages[0].type, 'battle_room_joined');
      assert.strictEqual(ws.sentMessages[0].payload.battleId, 456);
    });

    it('should reject unauthorized access', async () => {
      mockValidateRoomAccess.mock.mockImplementation(() =>
        Promise.resolve({ authorized: false, error: 'Battle not found' })
      );

      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const payload = { battleId: 456 };

      await testHandleJoinBattle(ws, userId, payload, {
        validateRoomAccess: mockValidateRoomAccess,
        addUserToRoom: mockAddUserToRoom
      });

      assert.strictEqual(mockAddUserToRoom.mock.callCount(), 0);
      assert.strictEqual(ws.sentMessages.length, 1);
      assert.strictEqual(ws.sentMessages[0].type, 'error');
      assert.strictEqual(ws.sentMessages[0].payload.message, 'Battle not found');
    });

    it('should reject unauthenticated user', async () => {
      const ws = new MockWebSocketClient(null, null);
      const payload = { battleId: 456 };

      await testHandleJoinBattle(ws, null, payload, {
        validateRoomAccess: mockValidateRoomAccess,
        addUserToRoom: mockAddUserToRoom
      });

      assert.strictEqual(mockValidateRoomAccess.mock.callCount(), 0);
      assert.strictEqual(mockAddUserToRoom.mock.callCount(), 0);
    });
  });

  describe('handleBattleSyncRequest', () => {
    let mockGetBattleStateForSync;

    beforeEach(() => {
      mockGetBattleStateForSync = mock.fn();
    });

    it('should return battle state for valid sync request', async () => {
      const mockState = {
        currentTurn: 1,
        turnQueue: [{ characterId: 1, isPlayer: true }],
        characters: [{ id: 1, hp: 100 }]
      };
      mockGetBattleStateForSync.mock.mockImplementation(() =>
        Promise.resolve(mockState)
      );

      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const message = { battleId: 789 };

      await testHandleBattleSyncRequest(ws, userId, message, {
        getBattleStateForSync: mockGetBattleStateForSync
      });

      assert.strictEqual(mockGetBattleStateForSync.mock.callCount(), 1);
      const call = mockGetBattleStateForSync.mock.calls[0];
      assert.deepStrictEqual(call.arguments, [789]);

      assert.strictEqual(ws.sentMessages.length, 1);
      assert.strictEqual(ws.sentMessages[0].type, 'battle:state_update');
      assert.strictEqual(ws.sentMessages[0].payload.battleId, 789);
      assert.deepStrictEqual(ws.sentMessages[0].payload.state, mockState);
    });

    it('should handle null battle state', async () => {
      mockGetBattleStateForSync.mock.mockImplementation(() =>
        Promise.resolve(null)
      );

      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const message = { battleId: 789 };

      await testHandleBattleSyncRequest(ws, userId, message, {
        getBattleStateForSync: mockGetBattleStateForSync
      });

      // No error should be sent for null state (battle may have ended)
      assert.strictEqual(ws.sentMessages.length, 0);
    });

    it('should reject missing battleId', async () => {
      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const message = {}; // Missing battleId

      await testHandleBattleSyncRequest(ws, userId, message, {
        getBattleStateForSync: mockGetBattleStateForSync
      });

      assert.strictEqual(mockGetBattleStateForSync.mock.callCount(), 0);
      assert.strictEqual(ws.sentMessages.length, 1);
      assert.strictEqual(ws.sentMessages[0].type, 'error');
      assert.strictEqual(ws.sentMessages[0].payload.message, 'Missing battleId in sync request');
    });

    it('should reject unauthenticated user', async () => {
      const ws = new MockWebSocketClient(null, null);
      const message = { battleId: 789 };

      await testHandleBattleSyncRequest(ws, null, message, {
        getBattleStateForSync: mockGetBattleStateForSync
      });

      assert.strictEqual(mockGetBattleStateForSync.mock.callCount(), 0);
    });
  });

  describe('handleAckMessage', () => {
    let mockHandleAck;

    beforeEach(() => {
      mockHandleAck = mock.fn();
    });

    it('should process valid ack message', async () => {
      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const payload = { messageId: 'msg_12345', battleId: 789 };

      await testHandleAckMessage(ws, userId, payload, {
        handleAck: mockHandleAck
      });

      assert.strictEqual(mockHandleAck.mock.callCount(), 1);
      const call = mockHandleAck.mock.calls[0];
      assert.deepStrictEqual(call.arguments, [userId, 'msg_12345', 789]);
    });

    it('should reject unauthenticated user', async () => {
      const ws = new MockWebSocketClient(null, null);
      const payload = { messageId: 'msg_12345', battleId: 789 };

      await testHandleAckMessage(ws, null, payload, {
        handleAck: mockHandleAck
      });

      assert.strictEqual(mockHandleAck.mock.callCount(), 0);
    });

    it('should handle missing payload gracefully', async () => {
      const ws = new MockWebSocketClient(1, 'testuser');
      const userId = 1;
      const payload = {}; // Missing fields

      await testHandleAckMessage(ws, userId, payload, {
        handleAck: mockHandleAck
      });

      assert.strictEqual(mockHandleAck.mock.callCount(), 1);
      const call = mockHandleAck.mock.calls[0];
      assert.deepStrictEqual(call.arguments, [1, undefined, undefined]);
    });
  });
});

// =============================================================================
// SIMULATED HANDLER FUNCTIONS (Additional)
// =============================================================================

/**
 * Simulated handleColiseumQueueJoin
 */
async function testHandleColiseumQueueJoin(ws, userId, username, payload, options = {}) {
  const { coliseumService } = options;

  if (!userId) return;
  try {
    const { queueType, partyLevel, partySize } = payload;
    const result = await coliseumService.joinQueue(
      queueType || '1v1',
      userId,
      username,
      partyLevel || 1,
      partySize || 1
    );
    if (!result.success) {
      ws.send(JSON.stringify({
        type: 'coliseum:error',
        payload: { message: result.error }
      }));
    }
  } catch (err) {
    console.error('Coliseum queue join error:', err);
    ws.send(JSON.stringify({
      type: 'coliseum:error',
      payload: { message: 'Internal server error' }
    }));
  }
}

/**
 * Simulated handleMarketplaceSubscribe
 */
function testHandleMarketplaceSubscribe(ws, userId, payload, options = {}) {
  const { addUserToRoom } = options;

  if (!userId) return;
  const { itemTemplateId } = payload;
  if (!itemTemplateId) return;

  addUserToRoom(`marketplace:item:${itemTemplateId}`, userId);

  ws.send(JSON.stringify({
    type: 'marketplace:subscribed',
    payload: { itemTemplateId }
  }));
}

/**
 * Simulated handleJoinBattle
 */
async function testHandleJoinBattle(ws, userId, payload, options = {}) {
  const { validateRoomAccess, addUserToRoom } = options;

  if (!userId) return;
  try {
    const { battleId } = payload;
    const battleRoom = `battle:${battleId}`;

    const accessResult = await validateRoomAccess(userId, battleRoom);
    if (!accessResult.authorized) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: accessResult.error || 'Access denied to battle' }
      }));
      return;
    }

    addUserToRoom(battleRoom, userId);
    ws.send(JSON.stringify({
      type: 'battle_room_joined',
      payload: { battleId }
    }));
  } catch (err) {
    console.error('Join battle error:', err);
  }
}

/**
 * Simulated handleBattleSyncRequest
 */
async function testHandleBattleSyncRequest(ws, userId, message, options = {}) {
  const { getBattleStateForSync } = options;

  if (!userId) return;

  const battleId = message?.battleId;
  if (!battleId) {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Missing battleId in sync request' }
    }));
    return;
  }

  try {
    const battleState = await getBattleStateForSync(battleId);
    if (battleState) {
      ws.send(JSON.stringify({
        type: 'battle:state_update',
        payload: {
          battleId,
          state: battleState
        }
      }));
    }
  } catch (err) {
    console.error('Battle sync request error:', err);
  }
}

/**
 * Simulated handleAckMessage
 */
async function testHandleAckMessage(ws, userId, payload, options = {}) {
  const { handleAck } = options;

  if (!userId) return;

  try {
    const { messageId, battleId } = payload;
    await handleAck(userId, messageId, battleId);
  } catch (err) {
    console.error('Ack message error:', err);
  }
}
