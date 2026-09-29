import { query } from '../config/database.js';
import * as userSettingsService from './userSettingsService.js';

/**
 * Presence Service - Handles player online status tracking and node presence
 */

// In-memory cache for faster presence lookups (synced with DB)
const presenceCache = new Map();

// Typing indicators (in-memory only, no persistence needed)
const typingUsers = new Map(); // roomKey -> Set of { userId, username, timestamp }

// Node presence tracking: nodeId -> Map of userId -> { username, characterName, timestamp }
const nodePresence = new Map();

/**
 * Set a user's presence status
 * @param {number} userId - User ID
 * @param {string} status - Status (online, away, busy, offline)
 * @param {Object} options - Additional options
 * @param {string|null|undefined} options.customMessage - Custom message (undefined = no change, null = clear)
 * @param {number|null} options.currentNodeId - Current node ID
 * @returns {Object} Updated presence
 */
async function setPresence(userId, status, options = {}) {
  const { customMessage, currentNodeId = null } = options;

  // Determine if we should update customMessage
  // undefined = keep existing, null = clear, string = set
  const shouldUpdateMessage = customMessage !== undefined;

  const result = await query(
    `INSERT INTO player_presence (user_id, status, custom_message, current_node_id, last_activity)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE SET
       status = $2,
       custom_message = CASE WHEN $5 THEN $3 ELSE player_presence.custom_message END,
       current_node_id = COALESCE($4, player_presence.current_node_id),
       last_activity = CURRENT_TIMESTAMP
     RETURNING *`,
    [userId, status, customMessage ?? null, currentNodeId, shouldUpdateMessage]
  );

  const presence = result.rows[0];

  // Update cache
  presenceCache.set(userId, {
    status: presence.status,
    customMessage: presence.custom_message,
    lastActivity: presence.last_activity,
    currentNodeId: presence.current_node_id
  });

  return presence;
}

/**
 * Get a user's presence
 * @param {number} userId - User ID
 * @returns {Object|null} Presence data
 */
async function getPresence(userId) {
  // Check cache first
  if (presenceCache.has(userId)) {
    return presenceCache.get(userId);
  }

  const result = await query(
    `SELECT pp.*, u.username
     FROM player_presence pp
     JOIN users u ON pp.user_id = u.id
     WHERE pp.user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const presence = result.rows[0];

  // Update cache
  presenceCache.set(userId, {
    userId: presence.user_id,
    username: presence.username,
    status: presence.status,
    customMessage: presence.custom_message,
    lastActivity: presence.last_activity,
    currentNodeId: presence.current_node_id
  });

  return presenceCache.get(userId);
}

/**
 * Get all online players
 * @param {Object} options - Filter options
 * @returns {Array} Online players
 */
async function getOnlinePlayers(options = {}) {
  const { nodeId = null, limit = 100 } = options;

  let queryText = `
    SELECT
      pp.user_id,
      pp.status,
      pp.custom_message,
      pp.current_node_id,
      pp.last_activity,
      u.username,
      (
        SELECT c.name FROM characters c
        WHERE c.user_id = pp.user_id
        ORDER BY (c.party_slot = 1) DESC NULLS LAST, c.level DESC, c.id ASC
        LIMIT 1
      ) AS character_name
    FROM player_presence pp
    JOIN users u ON pp.user_id = u.id
    WHERE pp.status != 'offline'
  `;

  const params = [];
  let paramIndex = 1;

  if (nodeId) {
    queryText += ` AND pp.current_node_id = $${paramIndex}`;
    params.push(nodeId);
    paramIndex++;
  }

  queryText += ` ORDER BY pp.last_activity DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await query(queryText, params);

  // Update cache
  result.rows.forEach(row => {
    presenceCache.set(row.user_id, {
      userId: row.user_id,
      username: row.username,
      status: row.status,
      customMessage: row.custom_message,
      lastActivity: row.last_activity,
      currentNodeId: row.current_node_id
    });
  });

  return result.rows.map(row => ({
    userId: row.user_id,
    username: row.username,
    // Active party leader (falls back to highest level); Tavern shows this.
    characterName: row.character_name ?? null,
    status: row.status,
    customMessage: row.custom_message,
    currentNodeId: row.current_node_id,
    lastActivity: row.last_activity
  }));
}

/**
 * Update last activity timestamp
 * @param {number} userId - User ID
 */
async function updateActivity(userId) {
  await query(
    'UPDATE player_presence SET last_activity = CURRENT_TIMESTAMP WHERE user_id = $1',
    [userId]
  );

  // Update cache
  if (presenceCache.has(userId)) {
    const cached = presenceCache.get(userId);
    cached.lastActivity = new Date();
  }
}

/**
 * Set user offline
 * @param {number} userId - User ID
 */
async function setOffline(userId) {
  await query(
    'UPDATE player_presence SET status = \'offline\' WHERE user_id = $1',
    [userId]
  );

  // Update cache
  if (presenceCache.has(userId)) {
    const cached = presenceCache.get(userId);
    cached.status = 'offline';
  }

  // Clean up typing indicators
  clearTypingIndicator(userId);
}

/**
 * Set typing indicator for a user in a room
 * @param {string} roomKey - Room identifier (e.g., 'global', 'party:123', 'dm:1:2')
 * @param {number} userId - User ID
 * @param {string} username - Username
 */
function setTypingIndicator(roomKey, userId, username) {
  if (!typingUsers.has(roomKey)) {
    typingUsers.set(roomKey, new Map());
  }

  const roomTyping = typingUsers.get(roomKey);
  roomTyping.set(userId, {
    userId,
    username,
    timestamp: Date.now()
  });

  // Auto-clear after 5 seconds
  setTimeout(() => {
    const current = roomTyping.get(userId);
    if (current && Date.now() - current.timestamp >= 5000) {
      roomTyping.delete(userId);
      if (roomTyping.size === 0) {
        typingUsers.delete(roomKey);
      }
    }
  }, 5000);
}

/**
 * Clear typing indicator for a user
 * @param {number} userId - User ID
 * @param {string} roomKey - Optional specific room
 */
function clearTypingIndicator(userId, roomKey = null) {
  if (roomKey) {
    const roomTyping = typingUsers.get(roomKey);
    if (roomTyping) {
      roomTyping.delete(userId);
      if (roomTyping.size === 0) {
        typingUsers.delete(roomKey);
      }
    }
  } else {
    // Clear from all rooms
    typingUsers.forEach((roomTyping, key) => {
      roomTyping.delete(userId);
      if (roomTyping.size === 0) {
        typingUsers.delete(key);
      }
    });
  }
}

/**
 * Get users typing in a room
 * @param {string} roomKey - Room identifier
 * @returns {Array} Users currently typing
 */
function getTypingUsers(roomKey) {
  const roomTyping = typingUsers.get(roomKey);
  if (!roomTyping) return [];

  const now = Date.now();
  const activeTypers = [];

  roomTyping.forEach((data, _odUserId) => {
    // Only include if typing within last 5 seconds
    if (now - data.timestamp < 5000) {
      activeTypers.push({
        userId: data.userId,
        username: data.username
      });
    }
  });

  return activeTypers;
}

/**
 * Clean up stale presence entries (users who went offline without proper disconnect)
 * Should be called periodically
 */
async function cleanupStalePresence() {
  // Mark users as offline if no activity for 5 minutes
  await query(
    `UPDATE player_presence
     SET status = 'offline'
     WHERE status != 'offline'
       AND last_activity < NOW() - INTERVAL '5 minutes'`
  );

  // Clear from cache
  presenceCache.forEach((data, _odUserId) => {
    if (data.status !== 'offline') {
      const lastActivity = new Date(data.lastActivity);
      if (Date.now() - lastActivity.getTime() > 5 * 60 * 1000) {
        data.status = 'offline';
      }
    }
  });
}

/**
 * Get presence cache (for WebSocket broadcast optimization)
 */
function getPresenceCache() {
  return presenceCache;
}

// ============================================
// Node Presence Tracking
// ============================================

/**
 * Track a player entering a node
 * @param {number} nodeId - Node ID
 * @param {number} userId - User ID
 * @param {string} username - Username
 * @param {string} characterName - Active character name
 * @returns {Object} Entry info
 */
function enterNode(nodeId, userId, username, characterName = null) {
  if (!nodePresence.has(nodeId)) {
    nodePresence.set(nodeId, new Map());
  }

  const nodeUsers = nodePresence.get(nodeId);
  const entry = {
    userId,
    username,
    characterName,
    enteredAt: Date.now()
  };

  nodeUsers.set(userId, entry);

  // Also update presence cache with current node
  if (presenceCache.has(userId)) {
    presenceCache.get(userId).currentNodeId = nodeId;
  }

  return entry;
}

/**
 * Track a player leaving a node
 * @param {number} nodeId - Node ID
 * @param {number} userId - User ID
 * @returns {Object|null} Exit info or null if not found
 */
function leaveNode(nodeId, userId) {
  if (!nodePresence.has(nodeId)) {
    return null;
  }

  const nodeUsers = nodePresence.get(nodeId);
  const userData = nodeUsers.get(userId);

  if (userData) {
    nodeUsers.delete(userId);

    // Clean up empty node
    if (nodeUsers.size === 0) {
      nodePresence.delete(nodeId);
    }

    return userData;
  }

  return null;
}

/**
 * Move a player from one node to another
 * @param {number} fromNodeId - Previous node ID
 * @param {number} toNodeId - New node ID
 * @param {number} userId - User ID
 * @param {string} username - Username
 * @param {string} characterName - Active character name
 * @returns {Object} Movement info with left and entered data
 */
function moveNode(fromNodeId, toNodeId, userId, username, characterName = null) {
  const leftData = leaveNode(fromNodeId, userId);
  const enteredData = enterNode(toNodeId, userId, username, characterName);

  return {
    left: leftData,
    entered: enteredData,
    fromNodeId,
    toNodeId
  };
}

/**
 * Get all players at a node
 * @param {number} nodeId - Node ID
 * @returns {Array} Array of player info
 */
function getPlayersAtNode(nodeId) {
  if (!nodePresence.has(nodeId)) {
    return [];
  }

  const nodeUsers = nodePresence.get(nodeId);
  return Array.from(nodeUsers.values());
}

/**
 * Get count of players at a node
 * @param {number} nodeId - Node ID
 * @returns {number} Player count
 */
function getNodePlayerCount(nodeId) {
  if (!nodePresence.has(nodeId)) {
    return 0;
  }
  return nodePresence.get(nodeId).size;
}

/**
 * Get current node for a user from cache
 * @param {number} userId - User ID
 * @returns {number|null} Node ID or null
 */
function getUserCurrentNode(userId) {
  const presence = presenceCache.get(userId);
  return presence?.currentNodeId || null;
}

/**
 * Clear a user from all nodes (on disconnect)
 * @param {number} userId - User ID
 * @returns {Array} Array of nodeIds the user was removed from
 */
function clearUserFromAllNodes(userId) {
  const removedFrom = [];

  nodePresence.forEach((nodeUsers, nodeId) => {
    if (nodeUsers.has(userId)) {
      nodeUsers.delete(userId);
      removedFrom.push(nodeId);

      if (nodeUsers.size === 0) {
        nodePresence.delete(nodeId);
      }
    }
  });

  return removedFrom;
}

/**
 * Get the node presence map (for debugging/monitoring)
 */
function getNodePresenceMap() {
  return nodePresence;
}

/**
 * Get presence for a user, respecting their showOnlineStatus privacy setting
 * @param {number} userId - User ID
 * @returns {Object|null} Presence data with status masked if privacy is set
 */
async function getPresenceWithPrivacy(userId) {
  const presence = await getPresence(userId);
  const showsOnline = await userSettingsService.showsOnlineStatus(userId);

  if (!showsOnline) {
    return {
      userId,
      status: 'offline',
      customMessage: null,
      lastActivity: null,
      currentNodeId: null
    };
  }

  return presence;
}

/**
 * Get all players at a node, filtered by privacy settings
 * @param {number} nodeId - Node ID
 * @param {Object} [options]
 * @param {number} [options.requesterId] - Requesting user; always kept in their own list
 * @returns {Promise<Array>} Array of player info, excluding those who hide online status
 */
async function getPlayersAtNodeWithPrivacy(nodeId, { requesterId } = {}) {
  if (!nodePresence.has(nodeId)) {
    return [];
  }

  const nodeUsers = nodePresence.get(nodeId);
  const players = Array.from(nodeUsers.values());

  // Filter out players who have showOnlineStatus disabled
  const filteredPlayers = await Promise.all(
    players.map(async (player) => {
      if (requesterId && Number(player.userId) === Number(requesterId)) {
        return player;
      }
      const showsOnline = await userSettingsService.showsOnlineStatus(player.userId);
      return showsOnline ? player : null;
    })
  );

  return filteredPlayers.filter(p => p !== null);
}

/**
 * Get online players filtered by privacy settings
 * @param {Object} options - Filter options
 * @param {number} options.requesterId - ID of the requesting user (always included)
 * @returns {Promise<Array>} Online players (excluding those with hidden status, except requester)
 */
async function getOnlinePlayersWithPrivacy(options = {}) {
  const { requesterId, ...queryOptions } = options;
  const players = await getOnlinePlayers(queryOptions);

  // Filter out players who have showOnlineStatus disabled, but always include requester
  const filteredPlayers = await Promise.all(
    players.map(async (player) => {
      // Always include the requester themselves
      if (requesterId && player.userId === requesterId) {
        return player;
      }
      const showsOnline = await userSettingsService.showsOnlineStatus(player.userId);
      return showsOnline ? player : null;
    })
  );

  return filteredPlayers.filter(p => p !== null);
}

export {
  setPresence,
  getPresence,
  getOnlinePlayers,
  updateActivity,
  setOffline,
  setTypingIndicator,
  clearTypingIndicator,
  getTypingUsers,
  cleanupStalePresence,
  getPresenceCache,
  // Node tracking
  enterNode,
  leaveNode,
  moveNode,
  getPlayersAtNode,
  getNodePlayerCount,
  getUserCurrentNode,
  clearUserFromAllNodes,
  getNodePresenceMap,
  // Privacy-respecting functions
  getPresenceWithPrivacy,
  getPlayersAtNodeWithPrivacy,
  getOnlinePlayersWithPrivacy
};

export default {
  setPresence,
  getPresence,
  getOnlinePlayers,
  updateActivity,
  setOffline,
  setTypingIndicator,
  clearTypingIndicator,
  getTypingUsers,
  cleanupStalePresence,
  getPresenceCache,
  enterNode,
  leaveNode,
  moveNode,
  getPlayersAtNode,
  getNodePlayerCount,
  getUserCurrentNode,
  clearUserFromAllNodes,
  getNodePresenceMap,
  getPresenceWithPrivacy,
  getPlayersAtNodeWithPrivacy,
  getOnlinePlayersWithPrivacy
};
