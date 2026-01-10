import { WebSocketServer, WebSocket } from 'ws';
import { verifyAccessToken } from '../config/jwt.js';
import chatService from '../services/chatService.js';
import presenceService from '../services/presenceService.js';
import coliseumService from '../services/coliseumService.js';
import * as partyWebsocket from '../services/partyWebsocket.js';
import * as marketplaceWebsocket from '../services/marketplaceWebsocket.js';
import { query } from '../config/database.js';

// Active connections mapped by userId
const connections = new Map();

// Room subscriptions: roomName -> Set of userIds
const rooms = new Map();

/**
 * SECURITY: Validate that a user has authorization to join a specific room
 * @param {number} userId - The user's ID
 * @param {string} roomName - The room name to validate
 * @returns {Promise<{authorized: boolean, error?: string}>}
 */
async function validateRoomAccess(userId, roomName) {
  // Global chat is allowed for all authenticated users
  if (roomName === 'global' || roomName === 'chat:global') {
    return { authorized: true };
  }

  // Coliseum queues are allowed for authenticated users
  if (roomName.startsWith('coliseum:')) {
    return { authorized: true };
  }

  // Battle rooms: verify user is a participant
  if (roomName.startsWith('battle:')) {
    const battleId = parseInt(roomName.split(':')[1], 10);
    if (isNaN(battleId)) {
      return { authorized: false, error: 'Invalid battle ID' };
    }

    try {
      const result = await query(
        `SELECT id FROM battles
         WHERE id = $1 AND (player1_id = $2 OR player2_id = $2) AND status = 'active'`,
        [battleId, userId]
      );
      if (result.rows.length === 0) {
        return { authorized: false, error: 'Not a participant in this battle' };
      }
      return { authorized: true };
    } catch {
      return { authorized: false, error: 'Failed to verify battle access' };
    }
  }

  // Party rooms: verify user is a member of the party
  if (roomName.startsWith('party:')) {
    const partyId = parseInt(roomName.split(':')[1], 10);
    if (isNaN(partyId)) {
      return { authorized: false, error: 'Invalid party ID' };
    }

    try {
      const result = await query(
        `SELECT id FROM party_members
         WHERE party_id = $1 AND user_id = $2`,
        [partyId, userId]
      );
      if (result.rows.length === 0) {
        return { authorized: false, error: 'Not a member of this party' };
      }
      return { authorized: true };
    } catch {
      return { authorized: false, error: 'Failed to verify party access' };
    }
  }

  // Node/tavern rooms: verify user's character is at that node
  if (roomName.startsWith('node:') || roomName.startsWith('tavern:')) {
    const nodeId = parseInt(roomName.split(':')[1], 10);
    if (isNaN(nodeId)) {
      return { authorized: false, error: 'Invalid node ID' };
    }

    try {
      const result = await query(
        `SELECT c.id FROM characters c
         WHERE c.user_id = $1 AND c.current_node_id = $2 AND c.party_slot IS NOT NULL
         LIMIT 1`,
        [userId, nodeId]
      );
      if (result.rows.length === 0) {
        return { authorized: false, error: 'Character not at this location' };
      }
      return { authorized: true };
    } catch {
      return { authorized: false, error: 'Failed to verify location access' };
    }
  }

  // Marketplace room is allowed for all authenticated users
  if (roomName === 'marketplace') {
    return { authorized: true };
  }

  // Marketplace item-specific rooms - allow subscribing to any item
  if (roomName.startsWith('marketplace:item:')) {
    return { authorized: true };
  }

  // Courtyard room is allowed for all authenticated users (social hub)
  if (roomName === 'courtyard') {
    return { authorized: true };
  }

  // Unknown room type - deny by default (security)
  return { authorized: false, error: 'Unknown room type' };
}

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // Initialize marketplace WebSocket service with server references
  marketplaceWebsocket.initialize(wss, rooms, connections);

  // Authentication timeout duration (10 seconds)
  const AUTH_TIMEOUT_MS = 10000;

  wss.on('connection', (ws) => {
    let userId = null;
    let username = null;

    ws.isAlive = true;

    // SECURITY: Set authentication timeout - close if not authenticated within 10 seconds
    const authTimeout = setTimeout(() => {
      if (!userId) {
        ws.send(JSON.stringify({
          type: 'auth_timeout',
          payload: { message: 'Authentication required within 10 seconds' }
        }));
        ws.close(1008, 'Authentication timeout'); // 1008 = Policy Violation
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data);
        const { type, payload } = message;

        switch (type) {
          case 'auth':
            try {
              const decoded = verifyAccessToken(payload.token);
              userId = decoded.userId;
              username = decoded.username;

              // SECURITY: Limit to 1 connection per user - close old connection if exists
              const existingConnection = connections.get(userId);
              if (existingConnection && existingConnection !== ws && existingConnection.readyState === WebSocket.OPEN) {
                existingConnection.send(JSON.stringify({
                  type: 'session_replaced',
                  payload: { message: 'Another session has connected' }
                }));
                existingConnection.close(1000, 'Session replaced by new connection');
              }

              connections.set(userId, ws);

              // Clear authentication timeout on successful auth
              clearTimeout(authTimeout);

              // Set user presence to online
              presenceService.setPresence(userId, 'online').catch(err => {
                console.error('Failed to set presence:', err);
              });

              // Broadcast presence change to relevant rooms
              broadcastPresenceChange(userId, username, 'online');

              ws.send(JSON.stringify({
                type: 'auth_success',
                payload: { userId, username }
              }));
            } catch {
              ws.send(JSON.stringify({
                type: 'auth_error',
                payload: { message: 'Invalid token' }
              }));
            }
            break;

          case 'join_room':
            if (!userId) {
              ws.send(JSON.stringify({
                type: 'error',
                payload: { message: 'Not authenticated' }
              }));
              break;
            }

            const roomName = payload.room;

            // SECURITY: Validate user has authorization to join this room
            try {
              const accessResult = await validateRoomAccess(userId, roomName);
              if (!accessResult.authorized) {
                ws.send(JSON.stringify({
                  type: 'error',
                  payload: { message: accessResult.error || 'Access denied to room' }
                }));
                break;
              }
            } catch (err) {
              console.error('Room access validation error:', err);
              ws.send(JSON.stringify({
                type: 'error',
                payload: { message: 'Failed to validate room access' }
              }));
              break;
            }

            if (!rooms.has(roomName)) {
              rooms.set(roomName, new Set());
            }
            rooms.get(roomName).add(userId);

            // Notify others in room
            broadcastToRoom(roomName, {
              type: 'user_joined',
              payload: { room: roomName, userId, username }
            }, userId);

            // Send room info to joining user
            ws.send(JSON.stringify({
              type: 'room_joined',
              payload: {
                room: roomName,
                users: Array.from(rooms.get(roomName))
              }
            }));
            break;

          case 'leave_room':
            if (!userId) break;

            const leaveRoom = payload.room;
            if (rooms.has(leaveRoom)) {
              rooms.get(leaveRoom).delete(userId);

              broadcastToRoom(leaveRoom, {
                type: 'user_left',
                payload: { room: leaveRoom, userId }
              }, userId);

              // Clean up empty rooms
              if (rooms.get(leaveRoom).size === 0) {
                rooms.delete(leaveRoom);
              }
            }

            ws.send(JSON.stringify({
              type: 'room_left',
              payload: { room: leaveRoom }
            }));
            break;

          case 'chat_message':
            if (!userId) {
              ws.send(JSON.stringify({
                type: 'error',
                payload: { message: 'Not authenticated' }
              }));
              break;
            }

            const chatRoom = payload.room;
            if (!rooms.has(chatRoom) || !rooms.get(chatRoom).has(userId)) {
              ws.send(JSON.stringify({
                type: 'error',
                payload: { message: 'Not in room' }
              }));
              break;
            }

            try {
              const truncatedMessage = payload.message.substring(0, 500);

              // Save to database for global/party rooms
              if (chatRoom === 'global' || chatRoom.startsWith('party:')) {
                const roomType = chatRoom === 'global' ? 'global' : 'party';
                const partyId = chatRoom.startsWith('party:') ? parseInt(chatRoom.split(':')[1], 10) : null;

                await chatService.saveMessage({
                  characterId: payload.characterId || null,
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
            break;

          case 'coliseum_queue_join':
            if (!userId) break;
            try {
              const { queueType, partyLevel, partySize } = payload;
              const result = coliseumService.joinQueue(
                queueType || '1v1',
                userId,
                username,
                partyLevel || 1,
                partySize || 1
              );
              if (!result.success) {
                ws.send(JSON.stringify({
                  type: 'error',
                  payload: { message: result.error }
                }));
              }
            } catch (err) {
              console.error('Coliseum queue join error:', err);
            }
            break;

          case 'coliseum_queue_leave':
            if (!userId) break;
            try {
              const { queueType: leaveQueueType } = payload;
              coliseumService.leaveQueue(leaveQueueType, userId);
            } catch (err) {
              console.error('Coliseum queue leave error:', err);
            }
            break;

          case 'coliseum_ready':
            if (!userId) break;
            try {
              const { matchId } = payload;
              const readyResult = coliseumService.playerReady(matchId, userId);
              if (!readyResult.success) {
                ws.send(JSON.stringify({
                  type: 'error',
                  payload: { message: readyResult.error }
                }));
              }
            } catch (err) {
              console.error('Coliseum ready error:', err);
            }
            break;

          case 'private_message':
            if (!userId) {
              ws.send(JSON.stringify({
                type: 'error',
                payload: { message: 'Not authenticated' }
              }));
              break;
            }

            try {
              const { targetUserId, message: dmMessage, characterId } = payload;

              if (!targetUserId || !dmMessage) {
                ws.send(JSON.stringify({
                  type: 'error',
                  payload: { message: 'Target user and message are required' }
                }));
                break;
              }

              // Save to database
              const savedMessage = await chatService.saveMessage({
                characterId: characterId || null,
                senderUserId: userId,
                roomType: 'dm',
                message: dmMessage.substring(0, 500),
                targetUserId
              });

              // Send to recipient if online
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

              // Confirm to sender
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
            break;

          case 'presence_update':
            if (!userId) {
              ws.send(JSON.stringify({
                type: 'error',
                payload: { message: 'Not authenticated' }
              }));
              break;
            }

            try {
              const { status, customMessage } = payload;
              const validStatuses = ['online', 'away', 'busy'];

              if (status && !validStatuses.includes(status)) {
                ws.send(JSON.stringify({
                  type: 'error',
                  payload: { message: 'Invalid status' }
                }));
                break;
              }

              await presenceService.setPresence(userId, status || 'online', {
                customMessage: customMessage?.substring(0, 128)
              });

              // Broadcast to all rooms user is in
              broadcastPresenceChange(userId, username, status || 'online', customMessage);

              ws.send(JSON.stringify({
                type: 'presence_updated',
                payload: { status: status || 'online', customMessage }
              }));
            } catch (err) {
              console.error('Presence update error:', err);
            }
            break;

          case 'typing_indicator':
            if (!userId) break;

            try {
              const { room, isTyping } = payload;

              if (!room) break;

              if (isTyping) {
                presenceService.setTypingIndicator(room, userId, username);
              } else {
                presenceService.clearTypingIndicator(userId, room);
              }

              // Broadcast typing status to room
              if (rooms.has(room)) {
                broadcastToRoom(room, {
                  type: 'user_typing',
                  payload: {
                    room,
                    userId,
                    username,
                    isTyping
                  }
                }, userId);
              }
            } catch (err) {
              console.error('Typing indicator error:', err);
            }
            break;

          case 'add_reaction':
            if (!userId) {
              ws.send(JSON.stringify({
                type: 'error',
                payload: { message: 'Not authenticated' }
              }));
              break;
            }

            try {
              const { messageId, emoji, room } = payload;

              if (!messageId || !emoji) {
                ws.send(JSON.stringify({
                  type: 'error',
                  payload: { message: 'Message ID and emoji are required' }
                }));
                break;
              }

              const result = await chatService.addReaction(messageId, userId, emoji);

              // Broadcast reaction to room if provided
              if (room && rooms.has(room)) {
                broadcastToRoom(room, {
                  type: 'reaction_added',
                  payload: {
                    messageId,
                    emoji,
                    userId,
                    username,
                    reactions: result.reactions
                  }
                });
              } else {
                // Just confirm to sender
                ws.send(JSON.stringify({
                  type: 'reaction_added',
                  payload: {
                    messageId,
                    emoji,
                    userId,
                    reactions: result.reactions
                  }
                }));
              }
            } catch (err) {
              console.error('Add reaction error:', err);
              ws.send(JSON.stringify({
                type: 'error',
                payload: { message: 'Failed to add reaction' }
              }));
            }
            break;

          case 'remove_reaction':
            if (!userId) break;

            try {
              const { messageId: rmMsgId, emoji: rmEmoji, room: rmRoom } = payload;

              if (!rmMsgId || !rmEmoji) break;

              const rmResult = await chatService.removeReaction(rmMsgId, userId, rmEmoji);

              // Broadcast to room if provided
              if (rmRoom && rooms.has(rmRoom)) {
                broadcastToRoom(rmRoom, {
                  type: 'reaction_removed',
                  payload: {
                    messageId: rmMsgId,
                    emoji: rmEmoji,
                    userId,
                    reactions: rmResult.reactions
                  }
                });
              } else {
                ws.send(JSON.stringify({
                  type: 'reaction_removed',
                  payload: {
                    messageId: rmMsgId,
                    emoji: rmEmoji,
                    reactions: rmResult.reactions
                  }
                }));
              }
            } catch (err) {
              console.error('Remove reaction error:', err);
            }
            break;

          // Battle room handlers
          case 'join_battle':
            if (!userId) break;
            try {
              const { battleId } = payload;
              const battleRoom = `battle:${battleId}`;

              // SECURITY: Validate user is a participant in this battle
              const battleAccessResult = await validateRoomAccess(userId, battleRoom);
              if (!battleAccessResult.authorized) {
                ws.send(JSON.stringify({
                  type: 'error',
                  payload: { message: battleAccessResult.error || 'Access denied to battle' }
                }));
                break;
              }

              if (!rooms.has(battleRoom)) {
                rooms.set(battleRoom, new Set());
              }
              rooms.get(battleRoom).add(userId);
              ws.send(JSON.stringify({
                type: 'battle_room_joined',
                payload: { battleId }
              }));
            } catch (err) {
              console.error('Join battle room error:', err);
            }
            break;

          case 'leave_battle':
            if (!userId) break;
            try {
              const { battleId: leaveBattleId } = payload;
              const leaveBattleRoom = `battle:${leaveBattleId}`;
              if (rooms.has(leaveBattleRoom)) {
                rooms.get(leaveBattleRoom).delete(userId);
                if (rooms.get(leaveBattleRoom).size === 0) {
                  rooms.delete(leaveBattleRoom);
                }
              }
            } catch (err) {
              console.error('Leave battle room error:', err);
            }
            break;

          // Party handlers
          case 'party_invite':
            if (!userId) break;
            try {
              const { targetUserId, characterId } = payload;
              if (!targetUserId) {
                ws.send(JSON.stringify({
                  type: 'error',
                  payload: { message: 'Target user required' }
                }));
                break;
              }
              const inviteResult = await partyWebsocket.sendInvite(
                userId,
                username,
                targetUserId,
                characterId
              );
              if (inviteResult.success) {
                ws.send(JSON.stringify({
                  type: 'party:invite_sent',
                  payload: { inviteId: inviteResult.inviteId, targetUserId }
                }));
              } else {
                ws.send(JSON.stringify({
                  type: 'error',
                  payload: { message: inviteResult.error }
                }));
              }
            } catch (err) {
              console.error('Party invite error:', err);
            }
            break;

          case 'party_invite_accept':
            if (!userId) break;
            try {
              const { inviteId: acceptInviteId } = payload;
              const acceptResult = await partyWebsocket.acceptInvite(
                acceptInviteId,
                userId,
                username
              );
              if (!acceptResult.success) {
                ws.send(JSON.stringify({
                  type: 'error',
                  payload: { message: acceptResult.error }
                }));
              }
            } catch (err) {
              console.error('Party invite accept error:', err);
            }
            break;

          case 'party_invite_decline':
            if (!userId) break;
            try {
              const { inviteId: declineInviteId } = payload;
              const declineResult = await partyWebsocket.declineInvite(declineInviteId, userId);
              if (!declineResult.success) {
                ws.send(JSON.stringify({
                  type: 'error',
                  payload: { message: declineResult.error }
                }));
              }
            } catch (err) {
              console.error('Party invite decline error:', err);
            }
            break;

          case 'party_leave':
            if (!userId) break;
            try {
              // In a full implementation, this would:
              // 1. Get user's party from database
              // 2. Remove user from party
              // 3. Broadcast party:member_left
              // 4. Handle leader succession if needed
              ws.send(JSON.stringify({
                type: 'party:left',
                payload: { userId }
              }));
            } catch (err) {
              console.error('Party leave error:', err);
            }
            break;

          // Node room handlers (for player presence at nodes)
          case 'join_node':
            if (!userId) break;
            try {
              const { nodeId } = payload;
              const nodeRoom = `node:${nodeId}`;

              // SECURITY: Validate user's character is at this node
              const nodeAccessResult = await validateRoomAccess(userId, nodeRoom);
              if (!nodeAccessResult.authorized) {
                ws.send(JSON.stringify({
                  type: 'error',
                  payload: { message: nodeAccessResult.error || 'Access denied to node' }
                }));
                break;
              }

              if (!rooms.has(nodeRoom)) {
                rooms.set(nodeRoom, new Set());
              }
              rooms.get(nodeRoom).add(userId);

              // Get players at this node
              const playersAtNode = presenceService.getPlayersAtNode(nodeId);

              ws.send(JSON.stringify({
                type: 'node_room_joined',
                payload: { nodeId, playersAtNode }
              }));

              // Notify others
              broadcastToRoom(nodeRoom, {
                type: 'player:entered_node',
                payload: {
                  nodeId,
                  userId,
                  username,
                  timestamp: Date.now()
                }
              }, userId);
            } catch (err) {
              console.error('Join node room error:', err);
            }
            break;

          case 'leave_node':
            if (!userId) break;
            try {
              const { nodeId: leaveNodeId } = payload;
              const leaveNodeRoom = `node:${leaveNodeId}`;

              // Notify others before leaving
              if (rooms.has(leaveNodeRoom)) {
                broadcastToRoom(leaveNodeRoom, {
                  type: 'player:left_node',
                  payload: {
                    nodeId: leaveNodeId,
                    userId,
                    username,
                    timestamp: Date.now()
                  }
                }, userId);

                rooms.get(leaveNodeRoom).delete(userId);
                if (rooms.get(leaveNodeRoom).size === 0) {
                  rooms.delete(leaveNodeRoom);
                }
              }
            } catch (err) {
              console.error('Leave node room error:', err);
            }
            break;

          // Marketplace subscription handlers
          case 'marketplace_subscribe': {
            // Subscribe to specific item's order book updates
            if (!userId) break;
            const { itemTemplateId } = payload;
            if (!itemTemplateId) break;

            const itemRoom = `marketplace:item:${itemTemplateId}`;
            if (!rooms.has(itemRoom)) {
              rooms.set(itemRoom, new Set());
            }
            rooms.get(itemRoom).add(userId);

            ws.send(JSON.stringify({
              type: 'marketplace:subscribed',
              payload: { itemTemplateId }
            }));
            break;
          }

          case 'marketplace_unsubscribe': {
            if (!userId) break;
            const { itemTemplateId: unsubId } = payload;
            if (!unsubId) break;

            const unsubRoom = `marketplace:item:${unsubId}`;
            if (rooms.has(unsubRoom)) {
              rooms.get(unsubRoom).delete(userId);
              if (rooms.get(unsubRoom).size === 0) {
                rooms.delete(unsubRoom);
              }
            }

            ws.send(JSON.stringify({
              type: 'marketplace:unsubscribed',
              payload: { itemTemplateId: unsubId }
            }));
            break;
          }

          default:
            ws.send(JSON.stringify({
              type: 'error',
              payload: { message: 'Unknown message type' }
            }));
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: 'Invalid message format' }
        }));
      }
    });

    ws.on('close', () => {
      // Clear auth timeout if still pending
      clearTimeout(authTimeout);

      if (userId) {
        connections.delete(userId);

        // Set user offline
        presenceService.setOffline(userId).catch(err => {
          console.error('Failed to set offline:', err);
        });

        // Clean up node presence
        const removedNodes = presenceService.clearUserFromAllNodes(userId);
        removedNodes.forEach(nodeId => {
          const nodeRoom = `node:${nodeId}`;
          if (rooms.has(nodeRoom)) {
            broadcastToRoom(nodeRoom, {
              type: 'player:left_node',
              payload: {
                nodeId,
                userId,
                username,
                reason: 'disconnected',
                timestamp: Date.now()
              }
            });
          }
        });

        // Clean up coliseum state
        coliseumService.cleanupPlayer(userId);

        // Clean up party invites
        partyWebsocket.cleanupUserInvites(userId);

        // Clean up marketplace item subscriptions
        marketplaceWebsocket.cleanupUserSubscriptions(userId);

        // Broadcast presence change
        broadcastPresenceChange(userId, username, 'offline');

        // Remove from all rooms
        rooms.forEach((users, roomName) => {
          if (users.has(userId)) {
            users.delete(userId);
            broadcastToRoom(roomName, {
              type: 'user_left',
              payload: { room: roomName, userId }
            });

            if (users.size === 0) {
              rooms.delete(roomName);
            }
          }
        });
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
    });
  });

  // Heartbeat to detect dead connections
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return wss;
}

function broadcastToRoom(roomName, message, excludeUserId = null) {
  const users = rooms.get(roomName);
  if (!users) return;

  const messageStr = JSON.stringify(message);
  users.forEach((userId) => {
    if (userId !== excludeUserId) {
      const ws = connections.get(userId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    }
  });
}

function sendToUser(userId, message) {
  const ws = connections.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Broadcast presence change to all users in rooms that this user is part of
 * Also broadcasts to the global 'tavern' room if it exists
 */
function broadcastPresenceChange(userId, username, status, customMessage = null) {
  const payload = {
    userId,
    username,
    status,
    customMessage,
    timestamp: Date.now()
  };

  // Broadcast to tavern room (always, for the social hub)
  if (rooms.has('tavern')) {
    broadcastToRoom('tavern', {
      type: 'presence_changed',
      payload
    }, userId);
  }

  // Broadcast to global room if user is in it
  if (rooms.has('global') && rooms.get('global').has(userId)) {
    broadcastToRoom('global', {
      type: 'presence_changed',
      payload
    }, userId);
  }
}

/**
 * Get count of online users (connected via WebSocket)
 */
function getOnlineCount() {
  return connections.size;
}

/**
 * Check if a user is currently connected
 */
function isUserOnline(userId) {
  return connections.has(userId);
}

export {
  setupWebSocket,
  broadcastToRoom,
  sendToUser,
  broadcastPresenceChange,
  getOnlineCount,
  isUserOnline,
  connections,
  rooms
};

export default {
  setupWebSocket,
  broadcastToRoom,
  sendToUser,
  broadcastPresenceChange,
  getOnlineCount,
  isUserOnline,
  connections,
  rooms
};
