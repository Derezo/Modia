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
import presenceService from '../services/presenceService.js';
import coliseumService from '../services/coliseumService.js';
import { handleSurrender as coliseumHandleSurrender } from '../services/coliseum/turnTimer.js';
import * as partyWebsocket from '../services/partyWebsocket.js';
import adminGenerationService from '../services/adminGenerationService.js';
import audioGenerationService from '../services/adminAudioGenerationService.js';
import { query } from '../config/database.js';
import { handleAck } from '../services/messageReliability.js';

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
 * Get battle state for sync request
 * @param {number} battleId - Battle ID
 * @returns {Object|null} Battle state or null if not found
 */
async function getBattleStateForSync(battleId) {
  try {
    const result = await query(
      'SELECT battle_state FROM battles WHERE id = $1 AND status = \'active\'',
      [battleId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const state = result.rows[0].battle_state;
    return {
      activeUnitId: state.activeUnitId,
      turnCount: state.turnCount || 0,
      status: state.status || 'active',
      units: state.units?.map(u => ({
        id: u.id,
        x: u.x,
        y: u.y,
        hp: u.hp,
        mp: u.mp,
        statusEffects: u.statusEffects || []
      })) || []
    };
  } catch (error) {
    console.error('Error getting battle state for sync:', error);
    return null;
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

    const savedMessage = await chatService.saveMessage({
      characterId: characterId || null,
      senderUserId: userId,
      roomType: 'dm',
      message: dmMessage.substring(0, 500),
      targetUserId
    });

    const recipientWs = connections.get(targetUserId);
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
      payload: { message: 'Failed to join queue' }
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

// ============================================================
// Battle Handlers
// ============================================================

/**
 * Handle join battle
 */
async function handleJoinBattle(ws, userId, payload) {
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
    console.error('Join battle room error:', err);
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
      payload: { message: 'Failed to sync battle state' }
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

/**
 * Handle party invite
 */
async function handlePartyInvite(ws, userId, username, payload) {
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
    const result = await partyWebsocket.sendInvite(userId, username, targetUserId, characterId);
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

/**
 * Handle party invite accept
 */
async function handlePartyInviteAccept(ws, userId, username, payload) {
  if (!userId) return;
  try {
    const { inviteId } = payload;
    const result = await partyWebsocket.acceptInvite(inviteId, userId, username);
    if (!result.success) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: result.error }
      }));
    }
  } catch (err) {
    console.error('Party invite accept error:', err);
  }
}

/**
 * Handle party invite decline
 */
async function handlePartyInviteDecline(ws, userId, payload) {
  if (!userId) return;
  try {
    const { inviteId } = payload;
    const result = await partyWebsocket.declineInvite(inviteId, userId);
    if (!result.success) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: result.error }
      }));
    }
  } catch (err) {
    console.error('Party invite decline error:', err);
  }
}

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

  // Battle
  handleJoinBattle,
  handleLeaveBattle,
  handleBattleSyncRequest,
  handleAckMessage,
  handleBattleSurrender,

  // Party
  handlePartyInvite,
  handlePartyInviteAccept,
  handlePartyInviteDecline,
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
