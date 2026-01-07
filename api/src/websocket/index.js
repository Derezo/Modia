const WebSocket = require('ws');
const { verifyAccessToken } = require('../config/jwt');
const chatService = require('../services/chatService');
const presenceService = require('../services/presenceService');

// Active connections mapped by userId
const connections = new Map();

// Room subscriptions: roomName -> Set of userIds
const rooms = new Map();

function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let userId = null;
    let username = null;

    ws.isAlive = true;

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
              connections.set(userId, ws);

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
                const partyId = chatRoom.startsWith('party:') ? parseInt(chatRoom.split(':')[1]) : null;

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
            // Coliseum matchmaking handled here
            // For MVP, just acknowledge
            ws.send(JSON.stringify({
              type: 'coliseum_queue_update',
              payload: { position: 1, estimatedWait: 30 }
            }));
            break;

          case 'coliseum_queue_leave':
            if (!userId) break;
            ws.send(JSON.stringify({
              type: 'coliseum_queue_left',
              payload: {}
            }));
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
      if (userId) {
        connections.delete(userId);

        // Set user offline
        presenceService.setOffline(userId).catch(err => {
          console.error('Failed to set offline:', err);
        });

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

module.exports = {
  setupWebSocket,
  broadcastToRoom,
  sendToUser,
  broadcastPresenceChange,
  getOnlineCount,
  isUserOnline,
  connections,
  rooms
};
