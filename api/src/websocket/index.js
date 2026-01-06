const WebSocket = require('ws');
const { verifyAccessToken } = require('../config/jwt');

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

            broadcastToRoom(chatRoom, {
              type: 'chat_message',
              payload: {
                room: chatRoom,
                userId,
                username,
                message: payload.message.substring(0, 500), // Limit message length
                timestamp: Date.now()
              }
            });
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

module.exports = {
  setupWebSocket,
  broadcastToRoom,
  sendToUser,
  connections,
  rooms
};
