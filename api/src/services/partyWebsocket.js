/**
 * Party WebSocket Service - Handles real-time party invite and membership events
 */

// Lazy-load websocket to avoid circular dependency
// websocket/index.js imports this file, so we can't destructure at top level
let _websocket = null;
function getWebsocket() {
  if (!_websocket) {
    _websocket = require('../websocket/index');
  }
  return _websocket;
}
const { query } = require('../config/database');

// Pending invites: inviteId -> { fromUserId, toUserId, fromUsername, characterId, expiresAt }
const pendingInvites = new Map();

// Invite ID counter
let inviteIdCounter = 1;

// Invite expiration time (5 minutes)
const INVITE_EXPIRATION_MS = 5 * 60 * 1000;

/**
 * Send a party invite to another player
 * @param {number} fromUserId - Inviting user ID
 * @param {string} fromUsername - Inviting user's username
 * @param {number} toUserId - Target user ID
 * @param {number} characterId - Character initiating invite
 * @returns {Object} Invite result
 */
async function sendInvite(fromUserId, fromUsername, toUserId, characterId) {
  // Check if target is already in a party
  const partyCheck = await query(
    `SELECT p.id FROM parties p
     JOIN party_members pm ON p.id = pm.party_id
     WHERE pm.user_id = $1`,
    [toUserId]
  );

  // Note: For now, this is a simplified implementation
  // In a full implementation, you'd check party membership from DB

  // Create invite
  const inviteId = inviteIdCounter++;
  const invite = {
    id: inviteId,
    fromUserId,
    fromUsername,
    toUserId,
    characterId,
    createdAt: Date.now(),
    expiresAt: Date.now() + INVITE_EXPIRATION_MS
  };

  pendingInvites.set(inviteId, invite);

  // Send invite to target user
  getWebsocket().sendToUser(toUserId, {
    type: 'party:invite_received',
    payload: {
      inviteId,
      fromUserId,
      fromUsername,
      expiresAt: invite.expiresAt
    }
  });

  // Set expiration timeout
  setTimeout(() => {
    expireInvite(inviteId);
  }, INVITE_EXPIRATION_MS);

  return { success: true, inviteId };
}

/**
 * Accept a party invite
 * @param {number} inviteId - Invite ID
 * @param {number} userId - Accepting user ID
 * @param {string} username - Accepting user's username
 * @returns {Object} Result
 */
async function acceptInvite(inviteId, userId, username) {
  const invite = pendingInvites.get(inviteId);

  if (!invite) {
    return { success: false, error: 'Invite not found or expired' };
  }

  if (invite.toUserId !== userId) {
    return { success: false, error: 'This invite is not for you' };
  }

  if (Date.now() > invite.expiresAt) {
    pendingInvites.delete(inviteId);
    return { success: false, error: 'Invite has expired' };
  }

  // Remove invite
  pendingInvites.delete(inviteId);

  // Notify the inviter
  getWebsocket().sendToUser(invite.fromUserId, {
    type: 'party:invite_accepted',
    payload: {
      inviteId,
      userId,
      username
    }
  });

  // Notify the new member
  getWebsocket().sendToUser(userId, {
    type: 'party:joined',
    payload: {
      inviteId,
      leaderId: invite.fromUserId,
      leaderUsername: invite.fromUsername
    }
  });

  // In a full implementation, you'd:
  // 1. Create or get the party from database
  // 2. Add the user to the party
  // 3. Join them to the party WebSocket room
  // 4. Broadcast party:member_joined to all party members

  return { success: true };
}

/**
 * Decline a party invite
 * @param {number} inviteId - Invite ID
 * @param {number} userId - Declining user ID
 * @returns {Object} Result
 */
function declineInvite(inviteId, userId) {
  const invite = pendingInvites.get(inviteId);

  if (!invite) {
    return { success: false, error: 'Invite not found or expired' };
  }

  if (invite.toUserId !== userId) {
    return { success: false, error: 'This invite is not for you' };
  }

  pendingInvites.delete(inviteId);

  // Notify the inviter
  getWebsocket().sendToUser(invite.fromUserId, {
    type: 'party:invite_declined',
    payload: {
      inviteId,
      userId
    }
  });

  return { success: true };
}

/**
 * Expire an invite (called by timeout)
 */
function expireInvite(inviteId) {
  const invite = pendingInvites.get(inviteId);
  if (!invite) return;

  pendingInvites.delete(inviteId);

  // Notify both parties
  getWebsocket().sendToUser(invite.fromUserId, {
    type: 'party:invite_expired',
    payload: { inviteId }
  });

  getWebsocket().sendToUser(invite.toUserId, {
    type: 'party:invite_expired',
    payload: { inviteId }
  });
}

/**
 * Broadcast party member joined event
 * @param {number} partyId - Party ID
 * @param {number} userId - New member user ID
 * @param {string} username - New member username
 * @param {string} characterName - New member's character name
 */
function broadcastMemberJoined(partyId, userId, username, characterName) {
  const roomName = `party:${partyId}`;

  getWebsocket().broadcastToRoom(roomName, {
    type: 'party:member_joined',
    payload: {
      partyId,
      userId,
      username,
      characterName,
      timestamp: Date.now()
    }
  });
}

/**
 * Broadcast party member left event
 * @param {number} partyId - Party ID
 * @param {number} userId - Leaving member user ID
 * @param {string} username - Leaving member username
 * @param {string} reason - 'left' | 'kicked' | 'disconnected'
 */
function broadcastMemberLeft(partyId, userId, username, reason = 'left') {
  const roomName = `party:${partyId}`;

  getWebsocket().broadcastToRoom(roomName, {
    type: 'party:member_left',
    payload: {
      partyId,
      userId,
      username,
      reason,
      timestamp: Date.now()
    }
  });
}

/**
 * Broadcast party disbanded event
 * @param {number} partyId - Party ID
 * @param {string} reason - Reason for disbanding
 */
function broadcastPartyDisbanded(partyId, reason = 'Leader left') {
  const roomName = `party:${partyId}`;

  getWebsocket().broadcastToRoom(roomName, {
    type: 'party:disbanded',
    payload: {
      partyId,
      reason,
      timestamp: Date.now()
    }
  });

  // Clean up room
  if (rooms.has(roomName)) {
    rooms.delete(roomName);
  }
}

/**
 * Broadcast party leader changed
 * @param {number} partyId - Party ID
 * @param {number} newLeaderId - New leader user ID
 * @param {string} newLeaderUsername - New leader username
 */
function broadcastLeaderChanged(partyId, newLeaderId, newLeaderUsername) {
  const roomName = `party:${partyId}`;

  getWebsocket().broadcastToRoom(roomName, {
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
function joinPartyRoom(partyId, userId) {
  const roomName = `party:${partyId}`;

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
function leavePartyRoom(partyId, userId) {
  const roomName = `party:${partyId}`;

  if (rooms.has(roomName)) {
    rooms.get(roomName).delete(userId);
    if (rooms.get(roomName).size === 0) {
      rooms.delete(roomName);
    }
  }
}

/**
 * Get pending invites for a user
 * @param {number} userId - User ID
 * @returns {Array} Pending invites
 */
function getPendingInvitesForUser(userId) {
  const invites = [];
  const now = Date.now();

  pendingInvites.forEach((invite) => {
    if (invite.toUserId === userId && invite.expiresAt > now) {
      invites.push({
        inviteId: invite.id,
        fromUserId: invite.fromUserId,
        fromUsername: invite.fromUsername,
        expiresAt: invite.expiresAt
      });
    }
  });

  return invites;
}

/**
 * Clean up user's invites on disconnect
 * @param {number} userId - User ID
 */
function cleanupUserInvites(userId) {
  // Cancel all invites from this user
  const toCancel = [];

  pendingInvites.forEach((invite, inviteId) => {
    if (invite.fromUserId === userId) {
      toCancel.push({ inviteId, toUserId: invite.toUserId });
    }
  });

  toCancel.forEach(({ inviteId, toUserId }) => {
    pendingInvites.delete(inviteId);
    getWebsocket().sendToUser(toUserId, {
      type: 'party:invite_expired',
      payload: { inviteId, reason: 'Inviter disconnected' }
    });
  });
}

module.exports = {
  sendInvite,
  acceptInvite,
  declineInvite,
  broadcastMemberJoined,
  broadcastMemberLeft,
  broadcastPartyDisbanded,
  broadcastLeaderChanged,
  joinPartyRoom,
  leavePartyRoom,
  getPendingInvitesForUser,
  cleanupUserInvites
};
