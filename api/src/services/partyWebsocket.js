/**
 * Party WebSocket Service - Handles real-time party invite and membership events
 */

import { sendWithAck, broadcastWithAck } from './messageReliability.js';

// Lazy-load websocket to avoid circular dependency
// websocket/index.js imports this file, so we can't import at top level
let _websocket = null;
async function getWebsocket() {
  if (!_websocket) {
    _websocket = await import('../websocket/index.js');
  }
  return _websocket;
}

// Track all active timeouts for cleanup (used in tests)
const activeTimeouts = new Set();

/**
 * Send a party invite to another player
 * Uses the DB invite ID passed from the REST route (no in-memory counter).
 *
 * @param {Object} params - Invite parameters
 * @param {number} params.inviteId - DB invite ID (from party_invites table)
 * @param {Date|string} params.expiresAt - Expiration timestamp
 * @param {number} params.fromUserId - Inviting user ID
 * @param {string} params.fromUsername - Inviting user's username
 * @param {number} params.toUserId - Target user ID
 * @param {number} params.partyId - Party ID
 * @param {string} params.partyName - Party name
 * @returns {Object} Invite result
 */
async function sendInvite({ inviteId, expiresAt, fromUserId, fromUsername, toUserId, partyId, partyName }) {
  // Send invite to target user with ACK tracking
  const ws = await getWebsocket();
  const targetWs = ws.connections?.get(toUserId);
  if (targetWs && targetWs.readyState === 1) {
    sendWithAck(targetWs, {
      type: 'party:invite_received',
      payload: {
        inviteId,
        fromUserId,
        fromUsername,
        partyId,
        partyName,
        expiresAt
      }
    }, `party:invite:${inviteId}`, toUserId);
  }

  return { success: true, inviteId };
}

/**
 * Decline a party invite - just notifies the inviter via WebSocket.
 * The actual DB update is done by the REST route.
 *
 * @param {number} inviteId - Invite ID
 * @param {number} userId - Declining user ID
 * @returns {Object} Result
 */
async function declineInvite(inviteId, userId) {
  // Note: We can't get the inviter ID without a DB query here.
  // The REST route already handles the notification by updating the DB.
  // This function is kept for backwards compatibility but may not be needed.
  return { success: true };
}

/**
 * Broadcast party member joined event
 * @param {number} partyId - Party ID
 * @param {number} userId - New member user ID
 * @param {string} username - New member username
 * @param {string} characterName - New member's character name
 */
async function broadcastMemberJoined(partyId, userId, username, characterName) {
  const roomName = `party:${partyId}`;

  // Use broadcastWithAck for reliable delivery - party join is critical
  await broadcastWithAck(null, roomName, {
    type: 'party:member_joined',
    payload: {
      partyId,
      userId,
      username,
      characterName,
      timestamp: Date.now()
    }
  }, `party:${partyId}`);
}

/**
 * Broadcast party member left event
 * @param {number} partyId - Party ID
 * @param {number} userId - Leaving member user ID
 * @param {string} username - Leaving member username
 * @param {string} reason - 'left' | 'kicked' | 'disconnected'
 */
async function broadcastMemberLeft(partyId, userId, username, reason = 'left') {
  const roomName = `party:${partyId}`;

  // Use broadcastWithAck for reliable delivery - party leave/kick is critical
  await broadcastWithAck(null, roomName, {
    type: 'party:member_left',
    payload: {
      partyId,
      userId,
      username,
      reason,
      timestamp: Date.now()
    }
  }, `party:${partyId}`);
}

/**
 * Broadcast party disbanded event
 * @param {number} partyId - Party ID
 * @param {string} reason - Reason for disbanding
 */
async function broadcastPartyDisbanded(partyId, reason = 'Leader left') {
  const roomName = `party:${partyId}`;

  // Use broadcastWithAck for reliable delivery - party disband is critical
  await broadcastWithAck(null, roomName, {
    type: 'party:disbanded',
    payload: {
      partyId,
      reason,
      timestamp: Date.now()
    }
  }, `party:${partyId}`);

  // Clean up room via websocket module
  const ws = await getWebsocket();
  if (ws.rooms && ws.rooms.has(roomName)) {
    ws.rooms.delete(roomName);
  }
}

/**
 * Broadcast party leader changed
 * @param {number} partyId - Party ID
 * @param {number} newLeaderId - New leader user ID
 * @param {string} newLeaderUsername - New leader username
 */
async function broadcastLeaderChanged(partyId, newLeaderId, newLeaderUsername) {
  const roomName = `party:${partyId}`;

  const ws = await getWebsocket();
  ws.broadcastToRoom(roomName, {
    type: 'party:leader_changed',
    payload: {
      partyId,
      newLeaderId,
      newLeaderUsername,
      timestamp: Date.now()
    }
  });
}

/**
 * Join a user to a party WebSocket room
 * @param {number} partyId - Party ID
 * @param {number} userId - User ID
 */
async function joinPartyRoom(partyId, userId) {
  const roomName = `party:${partyId}`;
  const ws = await getWebsocket();
  const rooms = ws.rooms;

  if (!rooms) return;

  if (!rooms.has(roomName)) {
    rooms.set(roomName, new Set());
  }
  rooms.get(roomName).add(userId);
}

/**
 * Leave a party WebSocket room
 * @param {number} partyId - Party ID
 * @param {number} userId - User ID
 */
async function leavePartyRoom(partyId, userId) {
  const roomName = `party:${partyId}`;
  const ws = await getWebsocket();
  const rooms = ws.rooms;

  if (!rooms) return;

  if (rooms.has(roomName)) {
    rooms.get(roomName).delete(userId);
    if (rooms.get(roomName).size === 0) {
      rooms.delete(roomName);
    }
  }
}

/**
 * Clear all active timeouts (for test cleanup)
 * @private
 */
function _clearAllTimeouts() {
  for (const timeoutId of activeTimeouts) {
    clearTimeout(timeoutId);
  }
  activeTimeouts.clear();
}

export {
  sendInvite,
  declineInvite,
  broadcastMemberJoined,
  broadcastMemberLeft,
  broadcastPartyDisbanded,
  broadcastLeaderChanged,
  joinPartyRoom,
  leavePartyRoom,
  _clearAllTimeouts
};

export default {
  sendInvite,
  declineInvite,
  broadcastMemberJoined,
  broadcastMemberLeft,
  broadcastPartyDisbanded,
  broadcastLeaderChanged,
  joinPartyRoom,
  leavePartyRoom,
  _clearAllTimeouts
};
