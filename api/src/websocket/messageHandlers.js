/**
 * @module WebSocketMessageHandlers
 * @description Message handlers for specific WebSocket message types.
 *
 * Key responsibilities:
 * - Chat message handling (global, party, private messages)
 * - Coliseum queue management
 * - Party invites and management
 * - Node/tavern presence
 * - Marketplace subscriptions
 * - Garrison subscriptions
 * - Admin generation controls (dev only)
 * - Battle sync and ACK handling
 *
 * @see index.js - Main WebSocket handler that uses these handlers
 */

import { WebSocket } from 'ws';
import chatService from '../services/chatService.js';
import { verifyCharacterOwnership } from '../services/characterService.js';
import presenceService from '../services/presenceService.js';
import { isBlocked } from '../services/friendService.js';
import coliseumService from '../services/coliseumService.js';
import { submitFormation } from '../services/coliseum/matchLifecycle.js';
import {
  handleSurrender as coliseumHandleSurrender,
  handlePlayerReconnect as coliseumHandlePlayerReconnect
} from '../services/coliseum/turnTimer.js';
import { disconnectTracking } from '../services/coliseum/constants.js';
import { recordReconnection } from '../services/ratingService.js';
import { cancelDisconnect as cancelBattleDisconnect } from '../services/battleReconnection.js';
// Note: partyWebsocket is no longer imported here - party invites are handled via REST API
import adminGenerationService from '../services/adminGenerationService.js';
import audioGenerationService from '../services/adminAudioGenerationService.js';
import {
  createBattleMapUpgradeRequiredPayload,
  createNegotiatedBattleStateSnapshot,
  handleAck,
  registerBattleMapCapabilities,
  sendWithAck
} from '../services/messageReliability.js';
import {
  BattleStateNotFoundError,
  battleStateRepository
} from '../services/battle/BattleStateRepository.js';
import { recordBattleMapResyncRequest } from '../services/battle/BattleMapOperations.js';
import { getParticipantAvailableActions } from
  '../services/battle/participantActionAvailability.js';
import { assertBattleMapCapabilities } from '../../../shared/battleStateProtocol.js';

import {
  connections,
  validateRoomAccess,
  addUserToRoom,
  removeUserFromRoom,
  getRoomUsers,
  isUserInRoom,
  broadcastToRoom
} from './roomManager.js';

// ============================================================
// Battle State Helper
// ============================================================

/**
 * Build a complete battle snapshot for explicit resync requests.
 * Known transient fields retain their backwards-compatible defaults, while
 * every stored map, unit, and battle field remains present in the response.
 *
 * @param {Object} state - Stored battle state
 * @returns {Object} Complete battle state snapshot
 */
function buildBattleStateForSync(state) {
  const storedState = state && typeof state === 'object' ? state : {};

  return {
    ...storedState,
    turnCount: storedState.turnCount ?? storedState.turn ?? 0,
    status: storedState.status ?? 'active',
    units: Array.isArray(storedState.units)
      ? storedState.units.map(unit => ({
        ...unit,
        ct: unit.ct ?? 0,
        hasActed: unit.hasActed ?? false,
        moveUsed: unit.moveUsed ?? false,
        actUsed: unit.actUsed ?? false,
        turnPhase: unit.turnPhase ?? 'ready',
        statusEffects: unit.statusEffects ?? []
      }))
      : []
  };
}

/**
 * Get battle state for sync request
 * @param {number} battleId - Battle ID
 * @returns {Object|null} Battle state or null if not found
 */
async function getBattleStateForSync(battleId, clientCapabilities, userId = null) {
  try {
    const battle = await battleStateRepository.loadBattle(battleId, {
      requireActive: true
    });
    const { negotiation, snapshot } = createNegotiatedBattleStateSnapshot(
      battle,
      clientCapabilities
    );
    return {
      battle,
      state: battle.battleMapSchemaVersion === 1
        ? buildBattleStateForSync(battle.state)
        : undefined,
      stateRevision: battle.stateRevision,
      availableActions: userId === null
        ? null
        : getParticipantAvailableActions(battle, battle.state, userId),
      negotiation,
      snapshot
    };
  } catch (error) {
    if (error instanceof BattleStateNotFoundError) {
      return null;
    }
    throw error;
  }
}

// ============================================================
// Chat Handlers
// ============================================================

/**
 * Handle chat message
 */
async function handleChatMessage(ws, userId, username, payload) {
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
      const ownsCharacter = await verifyCharacterOwnership(payload.characterId, userId);
      if (!ownsCharacter) {
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: 'Invalid character' }
        }));
        return;
      }

      const roomType = chatRoom === 'global' ? 'global' : 'party';
      const partyId = chatRoom.startsWith('party:') ? parseInt(chatRoom.split(':')[1], 10) : null;

      await chatService.saveMessage({
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
  } catch (err) {
    console.error('Chat message error:', err);
  }
}

/**
 * Handle private message
 */
async function handlePrivateMessage(ws, userId, username, payload) {
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

    // Parse target user ID as number
    const targetId = parseInt(targetUserId, 10);
    if (isNaN(targetId)) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Invalid target user ID' }
      }));
      return;
    }

    // Cannot message yourself
    if (targetId === userId) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Cannot send message to yourself' }
      }));
      return;
    }

    // Check if either user has blocked the other
    const blocked = await isBlocked(userId, targetId);
    if (blocked) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Cannot message this user' }
      }));
      return;
    }

    // CharacterId is required for DMs (DB column is NOT NULL)
    if (!characterId) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'A character is required to send messages' }
      }));
      return;
    }

    // Verify character ownership
    const ownsCharacter = await verifyCharacterOwnership(characterId, userId);
    if (!ownsCharacter) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Invalid character' }
      }));
      return;
    }

    const savedMessage = await chatService.saveMessage({
      characterId,
      senderUserId: userId,
      roomType: 'dm',
      message: dmMessage.substring(0, 500),
      targetUserId: targetId
    });

    const recipientWs = connections.get(targetId);
    if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
      recipientWs.send(JSON.stringify({
        type: 'private_message_received',
        payload: {
          id: savedMessage.id,
          senderId: userId,
          senderUsername: username,
          message: savedMessage.message,
          timestamp: savedMessage.created_at
        }
      }));
    }

    ws.send(JSON.stringify({
      type: 'private_message_sent',
      payload: {
        id: savedMessage.id,
        targetUserId: targetId,
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
 * Handle typing indicator
 */
function handleTypingIndicator(ws, userId, username, payload) {
  if (!userId) return;

  try {
    const { room, isTyping } = payload;
    if (!room) return;

    if (isTyping) {
      presenceService.setTypingIndicator(room, userId, username);
    } else {
      presenceService.clearTypingIndicator(userId, room);
    }

    if (isUserInRoom(room, userId)) {
      broadcastToRoom(room, {
        type: 'user_typing',
        payload: { room, userId, username, isTyping }
      }, userId);
    }
  } catch (err) {
    console.error('Typing indicator error:', err);
  }
}

/**
 * Handle add reaction
 */
async function handleAddReaction(ws, userId, username, payload) {
  if (!userId) {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Not authenticated' }
    }));
    return;
  }

  try {
    const { messageId, emoji, room } = payload;

    if (!messageId || !emoji) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Message ID and emoji are required' }
      }));
      return;
    }

    const result = await chatService.addReaction(messageId, userId, emoji);

    if (room && isUserInRoom(room, userId)) {
      broadcastToRoom(room, {
        type: 'reaction_added',
        payload: { messageId, emoji, userId, username, reactions: result.reactions }
      });
    } else {
      ws.send(JSON.stringify({
        type: 'reaction_added',
        payload: { messageId, emoji, userId, reactions: result.reactions }
      }));
    }
  } catch (err) {
    console.error('Add reaction error:', err);
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Failed to add reaction' }
    }));
  }
}

/**
 * Handle remove reaction
 */
async function handleRemoveReaction(ws, userId, payload) {
  if (!userId) return;

  try {
    const { messageId, emoji, room } = payload;
    if (!messageId || !emoji) return;

    const result = await chatService.removeReaction(messageId, userId, emoji);

    if (room && isUserInRoom(room, userId)) {
      broadcastToRoom(room, {
        type: 'reaction_removed',
        payload: { messageId, emoji, userId, reactions: result.reactions }
      });
    } else {
      ws.send(JSON.stringify({
        type: 'reaction_removed',
        payload: { messageId, emoji, reactions: result.reactions }
      }));
    }
  } catch (err) {
    console.error('Remove reaction error:', err);
  }
}

// ============================================================
// Room Handlers
// ============================================================

/**
 * Handle join room
 */
async function handleJoinRoom(ws, userId, username, payload) {
  if (!userId) {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Not authenticated' }
    }));
    return;
  }

  const roomName = payload.room;

  try {
    const accessResult = await validateRoomAccess(userId, roomName);
    if (!accessResult.authorized) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: accessResult.error || 'Access denied to room' }
      }));
      return;
    }
  } catch (err) {
    console.error('Room access validation error:', err);
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Failed to validate room access' }
    }));
    return;
  }

  addUserToRoom(roomName, userId);

  broadcastToRoom(roomName, {
    type: 'user_joined',
    payload: { room: roomName, userId, username }
  }, userId);

  ws.send(JSON.stringify({
    type: 'room_joined',
    payload: {
      room: roomName,
      users: getRoomUsers(roomName)
    }
  }));
}

/**
 * Handle leave room
 */
function handleLeaveRoom(ws, userId, payload) {
  if (!userId) return;

  const leaveRoom = payload.room;
  if (isUserInRoom(leaveRoom, userId)) {
    broadcastToRoom(leaveRoom, {
      type: 'user_left',
      payload: { room: leaveRoom, userId }
    }, userId);

    removeUserFromRoom(leaveRoom, userId);
  }

  ws.send(JSON.stringify({
    type: 'room_left',
    payload: { room: leaveRoom }
  }));
}

// ============================================================
// Coliseum Handlers
// ============================================================

/**
 * Handle coliseum queue join
 */
async function handleColiseumQueueJoin(ws, userId, username, payload) {
  if (!userId) return;
  try {
    const {
      queueType,
      partyLevel,
      partySize,
      battleMapCapabilities
    } = payload || {};
    if (battleMapCapabilities !== undefined && battleMapCapabilities !== null) {
      assertBattleMapCapabilities(battleMapCapabilities);
    }
    const result = await coliseumService.joinQueue(
      queueType || '1v1',
      userId,
      username,
      partyLevel || 1,
      partySize || 1,
      battleMapCapabilities ?? null
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
      payload: {
        ...(err instanceof TypeError && { code: 'battle_map_capabilities_invalid' }),
        message: err instanceof TypeError
          ? 'Invalid battle map capabilities'
          : 'Failed to join queue'
      }
    }));
  }
}

/**
 * Handle coliseum queue leave
 */
async function handleColiseumQueueLeave(userId, payload) {
  if (!userId) return;
  try {
    const { queueType } = payload;
    await coliseumService.leaveQueue(queueType, userId);
  } catch (err) {
    console.error('Coliseum queue leave error:', err);
  }
}

/**
 * Handle coliseum ready
 */
async function handleColiseumReady(ws, userId, payload) {
  if (!userId) return;
  try {
    const { matchId } = payload;
    const result = await coliseumService.playerReady(matchId, userId);
    if (!result.success) {
      ws.send(JSON.stringify({
        type: 'coliseum:error',
        payload: { message: result.error }
      }));
    }
  } catch (err) {
    console.error('Coliseum ready error:', err);
    ws.send(JSON.stringify({
      type: 'coliseum:error',
      payload: { message: 'Failed to mark as ready' }
    }));
  }
}

/**
 * Handle coliseum lobby join
 */
function handleColiseumLobbyJoin(userId) {
  if (!userId) return;
  addUserToRoom('coliseum:lobby', userId);
}

/**
 * Handle coliseum lobby leave
 */
function handleColiseumLobbyLeave(userId) {
  if (!userId) return;
  removeUserFromRoom('coliseum:lobby', userId);
}

/**
 * Handle coliseum formation submit
 */
async function handleColiseumFormationSubmit(ws, userId, payload) {
  if (!userId) return;
  try {
    const { matchId, formation } = payload;
    const result = await submitFormation(matchId, userId, formation);
    if (!result.success) {
      ws.send(JSON.stringify({
        type: 'coliseum:error',
        payload: { message: result.error }
      }));
    }
  } catch (err) {
    console.error('Coliseum formation submit error:', err);
    ws.send(JSON.stringify({
      type: 'coliseum:error',
      payload: { message: 'Failed to submit formation' }
    }));
  }
}

// ============================================================
// Battle Handlers
// ============================================================

/**
 * Handle join battle
 */
async function handleJoinBattle(ws, userId, payload) {
  if (!userId) return;
  try {
    const { battleId, battleMapCapabilities } = payload || {};
    const numericBattleId = Number(battleId);
    if (!Number.isSafeInteger(numericBattleId) || numericBattleId <= 0) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Invalid battleId' }
      }));
      return;
    }
    const battleRoom = `battle:${numericBattleId}`;

    const accessResult = await validateRoomAccess(userId, battleRoom);
    if (!accessResult.authorized) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: accessResult.error || 'Access denied to battle' }
      }));
      return;
    }

    if (battleMapCapabilities !== undefined && battleMapCapabilities !== null) {
      assertBattleMapCapabilities(battleMapCapabilities);
    } else {
      // Clear before loading/negotiating: even a legacy client that cannot
      // consume this battle must not leave an earlier V2 declaration active.
      registerBattleMapCapabilities(ws, numericBattleId, battleMapCapabilities);
    }
    const syncState = await getBattleStateForSync(numericBattleId, battleMapCapabilities);
    if (!syncState) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Battle not found or not active' }
      }));
      return;
    }
    if (!syncState.negotiation.compatible) {
      ws.send(JSON.stringify({
        type: 'battle_map_upgrade_required',
        payload: createBattleMapUpgradeRequiredPayload(syncState.negotiation)
      }));
      return;
    }
    // A successful join/rejoin is also a capability declaration boundary.
    // Omission or null means legacy behavior and must clear any declaration
    // cached earlier on this same socket.
    if (battleMapCapabilities !== undefined && battleMapCapabilities !== null) {
      registerBattleMapCapabilities(ws, numericBattleId, battleMapCapabilities);
    }

    addUserToRoom(battleRoom, userId);
    const joinedPayload = { battleId };
    if (battleMapCapabilities !== undefined && battleMapCapabilities !== null) {
      joinedPayload.battleMapCapabilities = syncState.negotiation;
      joinedPayload.snapshot = syncState.snapshot;
    }
    ws.send(JSON.stringify({
      type: 'battle_room_joined',
      payload: joinedPayload
    }));

    // Cancel any pending disconnect abandon timeout for ALL battle types.
    // This prevents the 30s abandon timer from firing after a WS blip/reconnect.
    cancelBattleDisconnect(numericBattleId, userId);

    // For pvp_coliseum battles, also handle coliseum-specific reconnect tracking
    if (syncState.battle?.battleType === 'pvp_coliseum') {
      const battleTracking = disconnectTracking.get(numericBattleId);
      const playerTracking = battleTracking?.[userId];
      if (playerTracking && !playerTracking.reconnected) {
        coliseumHandlePlayerReconnect(numericBattleId, userId);
        // Record reconnection in rating system
        if (playerTracking.disconnectId) {
          recordReconnection(playerTracking.disconnectId).catch(err => {
            console.error('Failed to record reconnection:', err);
          });
        }
      }
    }
  } catch (err) {
    console.error('Join battle room error:', err);
    ws.send(JSON.stringify({
      type: 'error',
      payload: {
        ...(err instanceof TypeError && { code: 'battle_map_capabilities_invalid' }),
        message: err instanceof TypeError
          ? 'Invalid battle map capabilities'
          : 'Failed to join battle room'
      }
    }));
  }
}

/**
 * Handle leave battle
 */
function handleLeaveBattle(userId, payload) {
  if (!userId) return;
  try {
    const { battleId } = payload;
    removeUserFromRoom(`battle:${battleId}`, userId);
  } catch (err) {
    console.error('Leave battle room error:', err);
  }
}

/**
 * Handle battle sync request
 * @param {WebSocket} ws - The WebSocket connection
 * @param {string} userId - The user ID
 * @param {Object} message - The full message object (sync requests send battleId at root level)
 */
async function handleBattleSyncRequest(ws, userId, message) {
  if (!userId) return;

  // Sync requests send battleId at root level, not in payload
  const battleId = message?.battleId;
  if (!battleId) {
    console.warn('[WS] Invalid battle sync request - missing battleId:', message);
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Missing battleId in sync request' }
    }));
    return;
  }
  const numericBattleId = Number(battleId);
  if (!Number.isSafeInteger(numericBattleId) || numericBattleId <= 0) {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Invalid battleId' }
    }));
    return;
  }

  // Joining a battle room performs the participant authorization check. Do
  // not expose the now-complete map/unit snapshot to an authenticated user who
  // merely guesses another active battle ID.
  if (!isUserInRoom(`battle:${numericBattleId}`, userId)) {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Access denied to battle sync' }
    }));
    return;
  }

  recordBattleMapResyncRequest(message?.reason);

  try {
    const declaredCapabilities = message?.battleMapCapabilities;
    if (declaredCapabilities !== undefined && declaredCapabilities !== null) {
      assertBattleMapCapabilities(declaredCapabilities);
    } else {
      // The declaration takes effect before repository I/O/negotiation so an
      // incompatible or missing battle cannot preserve stale V2 support.
      registerBattleMapCapabilities(ws, numericBattleId, declaredCapabilities);
    }
    // Each explicit sync request is a fresh declaration boundary. Omission or
    // null opts into legacy delivery instead of inheriting stale V2 support
    // from an earlier join/sync on this socket.
    const clientCapabilities = declaredCapabilities ?? undefined;
    const syncState = await getBattleStateForSync(
      numericBattleId,
      clientCapabilities,
      userId
    );
    if (syncState) {
      if (!syncState.negotiation.compatible) {
        ws.send(JSON.stringify({
          type: 'battle_map_upgrade_required',
          payload: createBattleMapUpgradeRequiredPayload(syncState.negotiation)
        }));
        return;
      }
      if (declaredCapabilities !== undefined && declaredCapabilities !== null) {
        registerBattleMapCapabilities(ws, numericBattleId, declaredCapabilities);
      }
      const syncPayload = {
        battleId,
        stateRevision: syncState.stateRevision,
        availableActions: syncState.availableActions,
        snapshot: syncState.snapshot,
        reason: 'full_sync'
      };
      if (syncState.state !== undefined) {
        syncPayload.state = syncState.state;
      }
      if (clientCapabilities !== undefined && clientCapabilities !== null) {
        syncPayload.battleMapCapabilities = syncState.negotiation;
      }
      sendWithAck(ws, {
        type: 'battle:state_update',
        payload: syncPayload
      }, numericBattleId, userId);
    } else {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Battle not found or not active' }
      }));
    }
  } catch (err) {
    console.error('Battle sync request error:', err);
    ws.send(JSON.stringify({
      type: 'error',
      payload: {
        ...(err instanceof TypeError && { code: 'battle_map_capabilities_invalid' }),
        message: err instanceof TypeError
          ? 'Invalid battle map capabilities'
          : 'Failed to sync battle state'
      }
    }));
  }
}

/**
 * Handle ACK
 * @param {string} userId - The user ID
 * @param {Object} message - The full message object (ACK messages send battleId/seq at root level)
 */
function handleAckMessage(userId, message) {
  if (!userId) return;

  // ACK messages send battleId and seq at root level, not in payload
  const battleId = message?.battleId;
  const seq = parseInt(message?.seq, 10);

  if (!battleId || isNaN(seq)) {
    console.warn('[WS] Invalid ACK message:', message);
    return;
  }
  handleAck(userId, battleId, seq);
}

/**
 * Handle battle surrender (PvP only)
 */
async function handleBattleSurrender(ws, userId, payload) {
  if (!userId) return;

  try {
    const { battleId } = payload;
    if (!battleId) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Battle ID required for surrender' }
      }));
      return;
    }

    // Verify user is in this battle
    const battleRoom = `battle:${battleId}`;
    if (!isUserInRoom(battleRoom, userId)) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Not in this battle' }
      }));
      return;
    }

    // Call the coliseum surrender handler
    await coliseumHandleSurrender(battleId, userId);
  } catch (err) {
    console.error('Battle surrender error:', err);
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Failed to process surrender' }
    }));
  }
}

// ============================================================
// Party Handlers
// ============================================================

// NOTE: Party invites are handled via REST API (POST /api/party/multiplayer/:partyId/invite)
// not via WebSocket. The old WS handlers (handlePartyInvite, handlePartyInviteAccept,
// handlePartyInviteDecline) were removed because they called partyWebsocket functions
// with the old positional signature. The REST route creates the DB invite and calls
// partyWebsocket.sendInvite with the new object signature.

/**
 * Handle party leave
 */
function handlePartyLeave(ws, userId) {
  if (!userId) return;
  try {
    ws.send(JSON.stringify({
      type: 'party:left',
      payload: { userId }
    }));
  } catch (err) {
    console.error('Party leave error:', err);
  }
}

// ============================================================
// Node Handlers
// ============================================================

/**
 * Handle join node
 */
async function handleJoinNode(ws, userId, username, payload) {
  if (!userId) return;
  try {
    const { nodeId } = payload;
    const nodeRoom = `node:${nodeId}`;

    const accessResult = await validateRoomAccess(userId, nodeRoom);
    if (!accessResult.authorized) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: accessResult.error || 'Access denied to node' }
      }));
      return;
    }

    addUserToRoom(nodeRoom, userId);

    const playersAtNode = presenceService.getPlayersAtNode(nodeId);

    ws.send(JSON.stringify({
      type: 'node_room_joined',
      payload: { nodeId, playersAtNode }
    }));

    broadcastToRoom(nodeRoom, {
      type: 'player:entered_node',
      payload: { nodeId, userId, username, timestamp: Date.now() }
    }, userId);
  } catch (err) {
    console.error('Join node room error:', err);
  }
}

/**
 * Handle leave node
 */
function handleLeaveNode(userId, username, payload) {
  if (!userId) return;
  try {
    const { nodeId } = payload;
    const nodeRoom = `node:${nodeId}`;

    if (isUserInRoom(nodeRoom, userId)) {
      broadcastToRoom(nodeRoom, {
        type: 'player:left_node',
        payload: { nodeId, userId, username, timestamp: Date.now() }
      }, userId);

      removeUserFromRoom(nodeRoom, userId);
    }
  } catch (err) {
    console.error('Leave node room error:', err);
  }
}

// ============================================================
// Marketplace Handlers
// ============================================================

/**
 * Handle marketplace subscribe
 */
function handleMarketplaceSubscribe(ws, userId, payload) {
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
 * Handle marketplace unsubscribe
 */
function handleMarketplaceUnsubscribe(ws, userId, payload) {
  if (!userId) return;
  const { itemTemplateId } = payload;
  if (!itemTemplateId) return;

  removeUserFromRoom(`marketplace:item:${itemTemplateId}`, userId);

  ws.send(JSON.stringify({
    type: 'marketplace:unsubscribed',
    payload: { itemTemplateId }
  }));
}

// ============================================================
// Garrison Handlers
// ============================================================

/**
 * Handle join garrison
 */
async function handleJoinGarrison(ws, userId, payload) {
  if (!userId) return;
  const { nodeId } = payload;
  if (!nodeId) {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Node ID required' }
    }));
    return;
  }

  const garrisonRoom = `garrison:${nodeId}`;

  const accessResult = await validateRoomAccess(userId, garrisonRoom);
  if (!accessResult.authorized) {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: accessResult.error || 'Access denied to garrison' }
    }));
    return;
  }

  addUserToRoom(garrisonRoom, userId);

  ws.send(JSON.stringify({
    type: 'garrison_room_joined',
    payload: { nodeId }
  }));
}

/**
 * Handle leave garrison
 */
function handleLeaveGarrison(ws, userId, payload) {
  if (!userId) return;
  const { nodeId } = payload;
  if (!nodeId) return;

  removeUserFromRoom(`garrison:${nodeId}`, userId);

  ws.send(JSON.stringify({
    type: 'garrison_room_left',
    payload: { nodeId }
  }));
}

// ============================================================
// Admin Generation Handlers (dev only)
// ============================================================

/**
 * Handle generation cancel
 */
function handleGenerationCancel(ws, userId, payload) {
  if (!userId) return;
  if (process.env.NODE_ENV === 'production') return;

  try {
    const { jobId } = payload;
    const result = adminGenerationService.cancelJobs({ jobId });
    ws.send(JSON.stringify({
      type: 'generation:cancel_result',
      payload: result
    }));
  } catch (err) {
    console.error('Generation cancel error:', err);
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: err.message }
    }));
  }
}

/**
 * Handle generation cancel all
 */
function handleGenerationCancelAll(ws, userId) {
  if (!userId) return;
  if (process.env.NODE_ENV === 'production') return;

  try {
    const result = adminGenerationService.cancelJobs({ all: true });
    ws.send(JSON.stringify({
      type: 'generation:cancel_all_result',
      payload: result
    }));
  } catch (err) {
    console.error('Generation cancel all error:', err);
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: err.message }
    }));
  }
}

/**
 * Handle generation pause
 */
function handleGenerationPause(ws, userId) {
  if (!userId) return;
  if (process.env.NODE_ENV === 'production') return;

  try {
    const result = adminGenerationService.pauseQueue();
    ws.send(JSON.stringify({
      type: 'generation:pause_result',
      payload: result
    }));
  } catch (err) {
    console.error('Generation pause error:', err);
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: err.message }
    }));
  }
}

/**
 * Handle generation resume
 */
function handleGenerationResume(ws, userId) {
  if (!userId) return;
  if (process.env.NODE_ENV === 'production') return;

  try {
    const result = adminGenerationService.resumeQueue();
    ws.send(JSON.stringify({
      type: 'generation:resume_result',
      payload: result
    }));
  } catch (err) {
    console.error('Generation resume error:', err);
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: err.message }
    }));
  }
}

// ============================================================
// Audio Generation Handlers (dev only)
// ============================================================

/**
 * Handle audio cancel
 */
function handleAudioCancel(ws, userId, payload) {
  if (!userId) return;
  if (process.env.NODE_ENV === 'production') return;

  try {
    const { jobId } = payload;
    const result = audioGenerationService.cancelJobs({ jobId });
    ws.send(JSON.stringify({
      type: 'audio:cancel_result',
      payload: result
    }));
  } catch (err) {
    console.error('Audio generation cancel error:', err);
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: err.message }
    }));
  }
}

/**
 * Handle audio cancel all
 */
function handleAudioCancelAll(ws, userId) {
  if (!userId) return;
  if (process.env.NODE_ENV === 'production') return;

  try {
    const result = audioGenerationService.cancelJobs({ all: true });
    ws.send(JSON.stringify({
      type: 'audio:cancel_all_result',
      payload: result
    }));
  } catch (err) {
    console.error('Audio generation cancel all error:', err);
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: err.message }
    }));
  }
}

/**
 * Handle audio pause
 */
function handleAudioPause(ws, userId) {
  if (!userId) return;
  if (process.env.NODE_ENV === 'production') return;

  try {
    const result = audioGenerationService.pauseQueue();
    ws.send(JSON.stringify({
      type: 'audio:pause_result',
      payload: result
    }));
  } catch (err) {
    console.error('Audio generation pause error:', err);
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: err.message }
    }));
  }
}

/**
 * Handle audio resume
 */
function handleAudioResume(ws, userId) {
  if (!userId) return;
  if (process.env.NODE_ENV === 'production') return;

  try {
    const result = audioGenerationService.resumeQueue();
    ws.send(JSON.stringify({
      type: 'audio:resume_result',
      payload: result
    }));
  } catch (err) {
    console.error('Audio generation resume error:', err);
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: err.message }
    }));
  }
}

// ============================================================
// Presence Handlers
// ============================================================

/**
 * Handle presence update
 */
async function handlePresenceUpdate(ws, userId, username, payload, broadcastPresenceChange) {
  if (!userId) {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Not authenticated' }
    }));
    return;
  }

  try {
    const { status, customMessage } = payload;
    const validStatuses = ['online', 'away', 'busy'];

    if (status && !validStatuses.includes(status)) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: 'Invalid status' }
      }));
      return;
    }

    await presenceService.setPresence(userId, status || 'online', {
      customMessage: customMessage?.substring(0, 128)
    });

    broadcastPresenceChange(userId, username, status || 'online', customMessage);

    ws.send(JSON.stringify({
      type: 'presence_updated',
      payload: { status: status || 'online', customMessage }
    }));
  } catch (err) {
    console.error('Presence update error:', err);
  }
}

// ============================================================
// Exports
// ============================================================

export {
  // Battle state helper
  buildBattleStateForSync,
  getBattleStateForSync,

  // Chat
  handleChatMessage,
  handlePrivateMessage,
  handleTypingIndicator,
  handleAddReaction,
  handleRemoveReaction,

  // Room
  handleJoinRoom,
  handleLeaveRoom,

  // Coliseum
  handleColiseumQueueJoin,
  handleColiseumQueueLeave,
  handleColiseumReady,
  handleColiseumLobbyJoin,
  handleColiseumLobbyLeave,
  handleColiseumFormationSubmit,

  // Battle
  handleJoinBattle,
  handleLeaveBattle,
  handleBattleSyncRequest,
  handleAckMessage,
  handleBattleSurrender,

  // Party (invites handled via REST API, not WS)
  handlePartyLeave,

  // Node
  handleJoinNode,
  handleLeaveNode,

  // Marketplace
  handleMarketplaceSubscribe,
  handleMarketplaceUnsubscribe,

  // Garrison
  handleJoinGarrison,
  handleLeaveGarrison,

  // Admin generation
  handleGenerationCancel,
  handleGenerationCancelAll,
  handleGenerationPause,
  handleGenerationResume,

  // Audio generation
  handleAudioCancel,
  handleAudioCancelAll,
  handleAudioPause,
  handleAudioResume,

  // Presence
  handlePresenceUpdate
};
