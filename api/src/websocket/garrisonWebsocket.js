/**
 * Garrison WebSocket Service
 * Handles real-time garrison recruit updates and purchase notifications
 *
 * Room pattern: garrison:{nodeId}
 *
 * Events broadcast:
 * - garrison_purchase: When a recruit is purchased { recruitId, purchasedBy }
 * - garrison_refresh: On hourly refresh { recruits: [...] }
 */

// Lazy-load websocket to avoid circular dependency
// websocket/index.js imports this file, so we can't import at top level
let _websocket = null;
async function getWebsocket() {
  if (!_websocket) {
    _websocket = await import('./index.js');
  }
  return _websocket;
}

/**
 * Handle garrison-related WebSocket messages
 * @param {WebSocket} ws - The WebSocket connection
 * @param {Object} message - The parsed message { type, payload }
 * @param {number} userId - The authenticated user ID
 * @param {Map} rooms - The rooms Map from websocket/index.js
 * @returns {Object|null} Response to send back, or null if handled internally
 */
async function handleGarrisonMessage(ws, message, userId, rooms) {
  const { type, payload } = message;

  switch (type) {
    case 'join_garrison': {
      const { nodeId } = payload;
      if (!nodeId) {
        return {
          type: 'error',
          payload: { message: 'Node ID required' }
        };
      }

      const roomName = `garrison:${nodeId}`;

      if (!rooms.has(roomName)) {
        rooms.set(roomName, new Set());
      }
      rooms.get(roomName).add(userId);

      return {
        type: 'garrison_room_joined',
        payload: { nodeId }
      };
    }

    case 'leave_garrison': {
      const { nodeId } = payload;
      if (!nodeId) {
        return null;
      }

      const roomName = `garrison:${nodeId}`;

      if (rooms.has(roomName)) {
        rooms.get(roomName).delete(userId);
        if (rooms.get(roomName).size === 0) {
          rooms.delete(roomName);
        }
      }

      return {
        type: 'garrison_room_left',
        payload: { nodeId }
      };
    }

    default:
      return null;
  }
}

/**
 * Broadcast when a recruit is purchased from a garrison
 * @param {number} nodeId - The garrison node ID
 * @param {number} recruitId - The purchased recruit's ID
 * @param {Object} purchasedBy - Info about who purchased { userId, username, characterName }
 */
async function broadcastGarrisonPurchase(nodeId, recruitId, purchasedBy) {
  const roomName = `garrison:${nodeId}`;
  const ws = await getWebsocket();

  ws.broadcastToRoom(roomName, {
    type: 'garrison_purchase',
    payload: {
      nodeId,
      recruitId,
      purchasedBy: {
        userId: purchasedBy.userId,
        username: purchasedBy.username,
        characterName: purchasedBy.characterName
      },
      timestamp: Date.now()
    }
  });
}

/**
 * Broadcast when garrison recruits refresh (hourly)
 * @param {number} nodeId - The garrison node ID
 * @param {Array} recruits - The new array of available recruits
 */
async function broadcastGarrisonRefresh(nodeId, recruits) {
  const roomName = `garrison:${nodeId}`;
  const ws = await getWebsocket();

  ws.broadcastToRoom(roomName, {
    type: 'garrison_refresh',
    payload: {
      nodeId,
      recruits,
      timestamp: Date.now()
    }
  });
}

/**
 * Clean up garrison room subscriptions for a user
 * Called when user disconnects
 * @param {number} userId - User ID
 * @param {Map} rooms - The rooms Map
 */
function cleanupUserGarrisonSubscriptions(userId, rooms) {
  if (!rooms) return;

  for (const [roomName, userIds] of rooms.entries()) {
    if (roomName.startsWith('garrison:')) {
      userIds.delete(userId);
      if (userIds.size === 0) {
        rooms.delete(roomName);
      }
    }
  }
}

export {
  handleGarrisonMessage,
  broadcastGarrisonPurchase,
  broadcastGarrisonRefresh,
  cleanupUserGarrisonSubscriptions
};

export default {
  handleGarrisonMessage,
  broadcastGarrisonPurchase,
  broadcastGarrisonRefresh,
  cleanupUserGarrisonSubscriptions
};
