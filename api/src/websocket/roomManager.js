/**
 * @module WebSocketRoomManager
 * @description Manages WebSocket room subscriptions, membership, and broadcasting.
 *
 * Key responsibilities:
 * - Room membership tracking (userId -> rooms, room -> userIds)
 * - Room access authorization validation
 * - Broadcasting messages to rooms
 * - Sending messages to specific users
 * - Presence change broadcasting
 * - Room cleanup on disconnect
 *
 * Room types and authorization:
 * - global, chat:global - All authenticated users
 * - coliseum:* - All authenticated users
 * - battle:{battleId} - Verified battle participants
 * - party:{partyId} - Verified party members
 * - node:{nodeId}, tavern:{nodeId} - Character location verified
 * - garrison:{nodeId} - Character location verified
 * - marketplace, marketplace:item:* - All authenticated users
 * - courtyard - All authenticated users (social hub)
 * - admin:generation, admin:audio-generation - Dev/test only
 *
 * @see index.js - Main WebSocket handler that uses this module
 */

import { WebSocket } from 'ws';
import { query } from '../config/database.js';
import * as userSettingsService from '../services/userSettingsService.js';

// ============================================================
// State Management
// ============================================================

// Active connections mapped by userId
const connections = new Map();

// Room subscriptions: roomName -> Set of userIds
const rooms = new Map();

// ============================================================
// Room Access Validation
// ============================================================

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
        `SELECT b.id FROM battles b
         WHERE b.id = $1
           AND b.status = 'active'
           AND (
             b.player1_id = $2
             OR b.player2_id = $2
             OR EXISTS (
               SELECT 1 FROM battle_players bp
               WHERE bp.battle_id = b.id AND bp.user_id = $2
             )
           )`,
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

  // Tavern and SocialHub global rooms are allowed for all authenticated users
  if (roomName === 'tavern' || roomName === 'socialHub') {
    return { authorized: true };
  }

  // Garrison rooms: verify user's character is at that node
  if (roomName.startsWith('garrison:')) {
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
        return { authorized: false, error: 'Character not at this garrison location' };
      }
      return { authorized: true };
    } catch {
      return { authorized: false, error: 'Failed to verify garrison access' };
    }
  }

  // Admin generation rooms - allowed for all authenticated users in dev/test mode
  // SECURITY: Production check is handled by admin routes, but we add extra protection here
  if (roomName === 'admin:generation' || roomName === 'admin:audio-generation') {
    if (process.env.NODE_ENV === 'production') {
      return { authorized: false, error: 'Admin rooms disabled in production' };
    }
    return { authorized: true };
  }

  // Unknown room type - deny by default (security)
  return { authorized: false, error: 'Unknown room type' };
}

// ============================================================
// Room Membership Management
// ============================================================

/**
 * Add a user to a room
 * @param {string} roomName - Room name
 * @param {number} userId - User ID
 */
function addUserToRoom(roomName, userId) {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, new Set());
  }
  rooms.get(roomName).add(userId);
}

/**
 * Remove a user from a room
 * @param {string} roomName - Room name
 * @param {number} userId - User ID
 * @returns {boolean} True if room was deleted (empty), false otherwise
 */
function removeUserFromRoom(roomName, userId) {
  if (rooms.has(roomName)) {
    rooms.get(roomName).delete(userId);
    if (rooms.get(roomName).size === 0) {
      rooms.delete(roomName);
      return true;
    }
  }
  return false;
}

/**
 * Get all users in a room
 * @param {string} roomName - Room name
 * @returns {number[]} Array of user IDs
 */
function getRoomUsers(roomName) {
  const roomUsers = rooms.get(roomName);
  return roomUsers ? Array.from(roomUsers) : [];
}

/**
 * Check if a user is in a room
 * @param {string} roomName - Room name
 * @param {number} userId - User ID
 * @returns {boolean}
 */
function isUserInRoom(roomName, userId) {
  const roomUsers = rooms.get(roomName);
  return roomUsers ? roomUsers.has(userId) : false;
}

/**
 * Remove a user from all rooms they're in
 * @param {number} userId - User ID
 * @param {Function} onLeaveRoom - Callback called for each room left (roomName, remainingUsers)
 */
function removeUserFromAllRooms(userId, onLeaveRoom = null) {
  rooms.forEach((users, roomName) => {
    if (users.has(userId)) {
      users.delete(userId);
      if (onLeaveRoom) {
        onLeaveRoom(roomName, users.size);
      }
      if (users.size === 0) {
        rooms.delete(roomName);
      }
    }
  });
}

// ============================================================
// Connection Management
// ============================================================

/**
 * Register a user's WebSocket connection
 * @param {number} userId - User ID
 * @param {WebSocket} ws - WebSocket connection
 */
function setConnection(userId, ws) {
  connections.set(userId, ws);
}

/**
 * Get a user's WebSocket connection
 * @param {number} userId - User ID
 * @returns {WebSocket|undefined}
 */
function getConnection(userId) {
  return connections.get(userId);
}

/**
 * Remove a user's WebSocket connection (compare-and-delete)
 * Only removes if the stored connection matches the provided ws.
 * @param {number} userId - User ID
 * @param {WebSocket|null} ws - Optional WebSocket to compare against
 * @returns {boolean} True if connection was removed, false if it didn't match
 */
function removeConnection(userId, ws = null) {
  if (ws === null) {
    // Legacy unconditional delete (kept for backwards compatibility)
    connections.delete(userId);
    return true;
  }
  // Compare-and-delete: only remove if the stored connection is this socket
  const stored = connections.get(userId);
  if (stored === ws) {
    connections.delete(userId);
    return true;
  }
  return false;
}

/**
 * Check if a user is currently connected
 * @param {number} userId - User ID
 * @returns {boolean}
 */
function isUserOnline(userId) {
  return connections.has(userId);
}

/**
 * Get count of online users (connected via WebSocket)
 * @returns {number}
 */
function getOnlineCount() {
  return connections.size;
}

// ============================================================
// Broadcasting
// ============================================================

/**
 * Broadcast a message to all users in a room
 * @param {string} roomName - Room name
 * @param {Object} message - Message to broadcast
 * @param {number|null} excludeUserId - Optional user ID to exclude from broadcast
 */
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

/**
 * Send a message to a specific user
 * @param {number} userId - User ID
 * @param {Object} message - Message to send
 * @returns {boolean} True if message was sent, false if user not connected
 */
function sendToUser(userId, message) {
  const ws = connections.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

/**
 * Broadcast presence change to all users in rooms that this user is part of
 * Also broadcasts to the global 'tavern' room if it exists
 *
 * PRIVACY: Users with showOnlineStatus=false have their presence masked to 'offline'
 * When options.showOnlineStatus is not provided, the setting is looked up from
 * userSettingsService automatically.
 *
 * @param {number} userId - User ID
 * @param {string} username - Username
 * @param {string} status - Presence status (online, away, busy, offline)
 * @param {string|null} customMessage - Optional custom status message
 * @param {Object} options - Additional options
 * @param {boolean|undefined} options.showOnlineStatus - Whether user shows online status (undefined = look up)
 */
function broadcastPresenceChange(userId, username, status, customMessage = null, options = {}) {
  // Wrap in async IIFE to handle privacy lookup without changing caller signature
  // Existing callers don't await this function, so this pattern is safe
  (async () => {
    try {
      // Look up privacy setting if not explicitly provided
      let showOnlineStatus = options.showOnlineStatus;
      if (showOnlineStatus === undefined) {
        showOnlineStatus = await userSettingsService.showsOnlineStatus(userId);
      }

      // PRIVACY: Mask status to 'offline' if user has disabled showOnlineStatus
      // This prevents revealing presence to other users in shared rooms
      const maskedStatus = showOnlineStatus ? status : 'offline';
      const maskedMessage = showOnlineStatus ? customMessage : null;

      // If the user is going offline anyway or is masked to offline, no need to broadcast
      // unless this is an actual disconnect (status === 'offline')
      if (!showOnlineStatus && status !== 'offline') {
        // User has privacy enabled - don't broadcast presence changes
        return;
      }

      const payload = {
        userId,
        username,
        status: maskedStatus,
        customMessage: maskedMessage,
        timestamp: Date.now()
      };

      // Broadcast to tavern room (for players in tavern)
      if (rooms.has('tavern')) {
        broadcastToRoom('tavern', {
          type: 'presence_changed',
          payload
        }, userId);
      }

      // Broadcast to socialHub room (for the SocialHub Friends tab)
      if (rooms.has('socialHub')) {
        broadcastToRoom('socialHub', {
          type: 'presence_changed',
          payload
        }, userId);
      }

      // Broadcast to global room - unconditionally so connect/disconnect reaches all
      // users in global chat, not just when the changing user happens to be in global
      if (rooms.has('global')) {
        broadcastToRoom('global', {
          type: 'presence_changed',
          payload
        }, userId);
      }
    } catch (err) {
      // Fail closed: if we can't look up privacy settings, don't broadcast
      // This is safer than accidentally revealing presence
      console.error('[RoomManager] broadcastPresenceChange error:', err.message);
    }
  })();
}

/**
 * Broadcast a node-room presence event (player:entered_node / player:left_node)
 * for a user, honouring their showOnlineStatus privacy setting.
 *
 * Users who hide their online status never announce where they are, so both
 * the enter and the leave event are suppressed. Fails closed: if the setting
 * cannot be read, nothing is broadcast.
 *
 * @param {number} nodeId - Node ID (room is `node:{nodeId}`)
 * @param {Object} message - Message to broadcast
 * @param {number} userId - The user the event is about (excluded from delivery)
 * @returns {Promise<boolean>} Whether the event was broadcast
 */
async function broadcastNodePresenceEvent(nodeId, message, userId) {
  try {
    if (!(await userSettingsService.showsOnlineStatus(userId))) {
      return false;
    }
  } catch (err) {
    console.error('[RoomManager] broadcastNodePresenceEvent error:', err.message);
    return false;
  }

  const nodeRoom = `node:${nodeId}`;
  if (!rooms.has(nodeRoom)) {
    return false;
  }
  broadcastToRoom(nodeRoom, message, userId);
  return true;
}

// ============================================================
// Exports
// ============================================================

export {
  // State access (for compatibility with existing code)
  connections,
  rooms,

  // Room access validation
  validateRoomAccess,

  // Room membership
  addUserToRoom,
  removeUserFromRoom,
  getRoomUsers,
  isUserInRoom,
  removeUserFromAllRooms,

  // Connection management
  setConnection,
  getConnection,
  removeConnection,
  isUserOnline,
  getOnlineCount,

  // Broadcasting
  broadcastToRoom,
  sendToUser,
  broadcastPresenceChange,
  broadcastNodePresenceEvent
};

export default {
  connections,
  rooms,
  validateRoomAccess,
  addUserToRoom,
  removeUserFromRoom,
  getRoomUsers,
  isUserInRoom,
  removeUserFromAllRooms,
  setConnection,
  getConnection,
  removeConnection,
  isUserOnline,
  getOnlineCount,
  broadcastToRoom,
  sendToUser,
  broadcastPresenceChange,
  broadcastNodePresenceEvent
};
