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
 * Deliver a message to one connected user (no-op when offline).
 * @param {number} userId - Target user ID
 * @param {Object} message - { type, payload }
 * @param {string} ackKey - Reliability key for sendWithAck
 */
async function sendToUser(userId, message, ackKey) {
  const ws = await getWebsocket();
  const targetWs = ws.connections?.get(userId);
  if (targetWs && targetWs.readyState === 1) {
    sendWithAck(targetWs, message, ackKey, userId);
  }
}

/**
 * Send a party invite to another player
 * Uses the DB invite ID passed from the REST route (no in-memory counter),
 * and arms a timer that expires the invite (and tells both players) if it is
 * still pending at expiresAt.
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
  await sendToUser(toUserId, {
    type: 'party:invite_received',
    payload: {
      inviteId,
      fromUserId,
      fromUsername,
      partyId,
      partyName,
      expiresAt
    }
  }, `party:invite:${inviteId}`);

  scheduleInviteExpiry(inviteId, expiresAt);

  return { success: true, inviteId };
}

/**
 * Expire an invite that is still pending once its expiresAt passes, then
 * notify both parties with party:invite_expired. An invite that was accepted
 * or declined in the meantime is left alone (the conditional UPDATE matches
 * no row).
 * @param {number} inviteId - DB invite ID
 * @param {Date|string} expiresAt - Expiration timestamp
 */
function scheduleInviteExpiry(inviteId, expiresAt) {
  const expiresMs = new Date(expiresAt).getTime();
  if (!inviteId || !Number.isFinite(expiresMs)) return;
  const delayMs = Math.max(0, expiresMs - Date.now()) + 1000;
  const timeoutId = setTimeout(() => {
    activeTimeouts.delete(timeoutId);
    expirePendingInvite(inviteId).catch(error => {
      console.error('[partyWebsocket] Failed to expire invite', inviteId, error.message);
    });
  }, delayMs);
  timeoutId.unref?.();
  activeTimeouts.add(timeoutId);
}

/**
 * Mark one pending, past-due invite expired and notify invitee and inviter.
 * @param {number} inviteId - DB invite ID
 * @returns {Promise<boolean>} Whether the invite was expired by this call
 */
async function expirePendingInvite(inviteId) {
  const { query } = await import('../config/database.js');
  const result = await query(
    `UPDATE party_invites SET invite_status = 'expired'
     WHERE id = $1 AND invite_status = 'pending' AND expires_at <= NOW()
     RETURNING party_id, inviter_id, invitee_id`,
    [inviteId]
  );
  if (result.rows.length === 0) return false;
  await notifyInviteExpired({ inviteId, ...toInviteParties(result.rows[0]) });
  return true;
}

function toInviteParties(row) {
  return {
    partyId: row.party_id,
    inviterId: row.inviter_id,
    inviteeId: row.invitee_id
  };
}

/**
 * Tell the invitee (and inviter) that an invite expired.
 * @param {Object} params
 * @param {number} params.inviteId - DB invite ID
 * @param {number} params.partyId - Party ID
 * @param {number} params.inviterId - Inviting user ID
 * @param {number} params.inviteeId - Invited user ID
 */
async function notifyInviteExpired({ inviteId, partyId, inviterId, inviteeId }) {
  const message = { type: 'party:invite_expired', payload: { inviteId, partyId } };
  await sendToUser(inviteeId, message, `party:invite_expired:${inviteId}`);
  if (inviterId) {
    await sendToUser(inviterId, message, `party:invite_expired:${inviteId}`);
  }
}

/**
 * Tell the inviter that their invite was declined.
 * The DB update is done by the REST route, which passes the inviter it read.
 *
 * @param {Object} params
 * @param {number} params.inviteId - DB invite ID
 * @param {number} params.partyId - Party ID
 * @param {number} params.inviterId - Inviting user ID (notified)
 * @param {number} params.userId - Declining user ID
 * @param {string} params.username - Declining user's username
 * @returns {Object} Result
 */
async function declineInvite({ inviteId, partyId, inviterId, userId, username }) {
  if (!inviterId) return { success: false };
  await sendToUser(inviterId, {
    type: 'party:invite_declined',
    payload: { inviteId, partyId, userId, username }
  }, `party:invite_declined:${inviteId}`);
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
  notifyInviteExpired,
  expirePendingInvite,
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
  notifyInviteExpired,
  expirePendingInvite,
  broadcastMemberJoined,
  broadcastMemberLeft,
  broadcastPartyDisbanded,
  broadcastLeaderChanged,
  joinPartyRoom,
  leavePartyRoom,
  _clearAllTimeouts
};
