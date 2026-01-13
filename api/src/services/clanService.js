/**
 * Clan Service
 * Handles clan creation, membership, invites, and messaging
 */

import { query } from '../config/database.js';
import * as notificationService from './notificationService.js';

/**
 * List all clans with optional search
 * @param {string} searchQuery - Optional search query
 * @param {number} limit - Max results
 * @returns {Promise<object[]>} List of clans
 */
export async function listClans(searchQuery, limit = 20) {
  let sql = `
    SELECT c.id, c.name, c.tag, c.description, c.max_members, c.created_at,
           u.username as leader_username,
           (SELECT COUNT(*) FROM clan_members WHERE clan_id = c.id) as member_count
    FROM clans c
    JOIN users u ON c.leader_id = u.id
  `;

  const params = [];

  if (searchQuery && searchQuery.length >= 2) {
    sql += ` WHERE c.name ILIKE $1 OR c.tag ILIKE $1`;
    params.push(`%${searchQuery}%`);
  }

  sql += ` ORDER BY member_count DESC, c.created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await query(sql, params);

  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    tag: row.tag,
    description: row.description,
    maxMembers: row.max_members,
    memberCount: parseInt(row.member_count, 10),
    leaderUsername: row.leader_username,
    createdAt: row.created_at
  }));
}

/**
 * Create a new clan
 * @param {number} userId - Creator's user ID (becomes leader)
 * @param {object} clanData - Clan details
 * @returns {Promise<object>} Created clan
 */
export async function createClan(userId, { name, tag, description }) {
  // Check if user is already in a clan
  const existingMembership = await query(
    'SELECT clan_id FROM clan_members WHERE user_id = $1',
    [userId]
  );

  if (existingMembership.rows.length > 0) {
    throw new Error('You are already in a clan. Leave your current clan first.');
  }

  // Check if clan name exists
  const existingName = await query(
    'SELECT id FROM clans WHERE LOWER(name) = LOWER($1)',
    [name]
  );

  if (existingName.rows.length > 0) {
    throw new Error('A clan with that name already exists');
  }

  // Check if clan tag exists
  const existingTag = await query(
    'SELECT id FROM clans WHERE LOWER(tag) = LOWER($1)',
    [tag]
  );

  if (existingTag.rows.length > 0) {
    throw new Error('A clan with that tag already exists');
  }

  // Create the clan
  const clanResult = await query(
    `INSERT INTO clans (name, tag, leader_id, description, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING id, name, tag, leader_id, description, max_members, created_at`,
    [name, tag, userId, description || null]
  );

  const clan = clanResult.rows[0];

  // Add creator as a member with leader role
  await query(
    `INSERT INTO clan_members (clan_id, user_id, role, joined_at)
     VALUES ($1, $2, 'leader', NOW())`,
    [clan.id, userId]
  );

  // Get username for response
  const userResult = await query('SELECT username FROM users WHERE id = $1', [userId]);

  return {
    id: clan.id,
    name: clan.name,
    tag: clan.tag,
    description: clan.description,
    maxMembers: clan.max_members,
    memberCount: 1,
    leaderUsername: userResult.rows[0]?.username,
    createdAt: clan.created_at
  };
}

/**
 * Get a user's current clan
 * @param {number} userId - User ID
 * @returns {Promise<object|null>} Clan details or null
 */
export async function getUserClan(userId) {
  const result = await query(
    `SELECT c.id, c.name, c.tag, c.description, c.max_members, c.created_at,
            u.username as leader_username,
            cm.role as my_role,
            (SELECT COUNT(*) FROM clan_members WHERE clan_id = c.id) as member_count
     FROM clan_members cm
     JOIN clans c ON cm.clan_id = c.id
     JOIN users u ON c.leader_id = u.id
     WHERE cm.user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    description: row.description,
    maxMembers: row.max_members,
    memberCount: parseInt(row.member_count, 10),
    leaderUsername: row.leader_username,
    myRole: row.my_role,
    createdAt: row.created_at
  };
}

/**
 * Get clan details with members
 * @param {number} clanId - Clan ID
 * @returns {Promise<object|null>} Clan details or null
 */
export async function getClanDetails(clanId) {
  // Get clan info
  const clanResult = await query(
    `SELECT c.id, c.name, c.tag, c.description, c.max_members, c.created_at,
            c.leader_id, u.username as leader_username
     FROM clans c
     JOIN users u ON c.leader_id = u.id
     WHERE c.id = $1`,
    [clanId]
  );

  if (clanResult.rows.length === 0) {
    return null;
  }

  const clan = clanResult.rows[0];

  // Get members
  const membersResult = await query(
    `SELECT cm.user_id, cm.role, cm.joined_at, u.username
     FROM clan_members cm
     JOIN users u ON cm.user_id = u.id
     WHERE cm.clan_id = $1
     ORDER BY
       CASE cm.role
         WHEN 'leader' THEN 1
         WHEN 'officer' THEN 2
         ELSE 3
       END,
       cm.joined_at ASC`,
    [clanId]
  );

  return {
    id: clan.id,
    name: clan.name,
    tag: clan.tag,
    description: clan.description,
    maxMembers: clan.max_members,
    leaderId: clan.leader_id,
    leaderUsername: clan.leader_username,
    createdAt: clan.created_at,
    members: membersResult.rows.map(m => ({
      userId: m.user_id,
      username: m.username,
      role: m.role,
      joinedAt: m.joined_at
    }))
  };
}

/**
 * Leave a clan
 * @param {number} userId - User ID
 * @param {number} clanId - Clan ID
 */
export async function leaveClan(userId, clanId) {
  // Check if user is in this clan
  const memberResult = await query(
    'SELECT role FROM clan_members WHERE clan_id = $1 AND user_id = $2',
    [clanId, userId]
  );

  if (memberResult.rows.length === 0) {
    throw new Error('You are not a member of this clan');
  }

  const role = memberResult.rows[0].role;

  if (role === 'leader') {
    throw new Error('The leader cannot leave the clan. Transfer leadership or disband instead.');
  }

  // Remove member
  await query(
    'DELETE FROM clan_members WHERE clan_id = $1 AND user_id = $2',
    [clanId, userId]
  );
}

/**
 * Disband a clan (leader only)
 * @param {number} userId - User ID (must be leader)
 * @param {number} clanId - Clan ID
 */
export async function disbandClan(userId, clanId) {
  // Check if clan exists and user is leader
  const clanResult = await query(
    'SELECT leader_id FROM clans WHERE id = $1',
    [clanId]
  );

  if (clanResult.rows.length === 0) {
    throw new Error('Clan not found');
  }

  if (clanResult.rows[0].leader_id !== userId) {
    throw new Error('Only the leader can disband the clan');
  }

  // Delete clan (cascades to members and invites)
  await query('DELETE FROM clans WHERE id = $1', [clanId]);
}

/**
 * Invite a player to the clan
 * @param {number} inviterId - Inviter's user ID
 * @param {number} clanId - Clan ID
 * @param {string} username - Invitee's username
 * @returns {Promise<object>} Created invite
 */
export async function invitePlayer(inviterId, clanId, username) {
  // Check if inviter is a member of the clan
  const memberResult = await query(
    'SELECT role FROM clan_members WHERE clan_id = $1 AND user_id = $2',
    [clanId, inviterId]
  );

  if (memberResult.rows.length === 0) {
    throw new Error('You are not a member of this clan');
  }

  // Find invitee by username
  const userResult = await query(
    'SELECT id, username FROM users WHERE username = $1',
    [username]
  );

  if (userResult.rows.length === 0) {
    throw new Error('User not found');
  }

  const inviteeId = userResult.rows[0].id;
  const inviteeUsername = userResult.rows[0].username;

  // Check if invitee is already in the clan
  const existingMember = await query(
    'SELECT user_id FROM clan_members WHERE clan_id = $1 AND user_id = $2',
    [clanId, inviteeId]
  );

  if (existingMember.rows.length > 0) {
    throw new Error('User is already in this clan');
  }

  // Check if invitee is already in a different clan
  const otherClan = await query(
    'SELECT clan_id FROM clan_members WHERE user_id = $1',
    [inviteeId]
  );

  if (otherClan.rows.length > 0) {
    throw new Error('User is already in a clan');
  }

  // Check for existing pending invite
  const existingInvite = await query(
    `SELECT id FROM clan_invites
     WHERE clan_id = $1 AND invitee_id = $2 AND status = 'pending' AND expires_at > NOW()`,
    [clanId, inviteeId]
  );

  if (existingInvite.rows.length > 0) {
    throw new Error('User already has a pending invite to this clan');
  }

  // Get clan name for notification
  const clanResult = await query('SELECT name FROM clans WHERE id = $1', [clanId]);
  const clanName = clanResult.rows[0]?.name || 'Unknown';

  // Get inviter username
  const inviterResult = await query('SELECT username FROM users WHERE id = $1', [inviterId]);
  const inviterUsername = inviterResult.rows[0]?.username || 'Unknown';

  // Create invite
  const inviteResult = await query(
    `INSERT INTO clan_invites (clan_id, inviter_id, invitee_id, status, expires_at, created_at)
     VALUES ($1, $2, $3, 'pending', NOW() + INTERVAL '7 days', NOW())
     RETURNING id, clan_id, inviter_id, invitee_id, status, expires_at, created_at`,
    [clanId, inviterId, inviteeId]
  );

  const invite = inviteResult.rows[0];

  // Send notification to invitee
  await notificationService.createNotification(
    inviteeId,
    'clan_invite',
    'Clan Invite',
    `${inviterUsername} invited you to join [${clanName}]`,
    {
      inviteId: invite.id,
      clanId,
      clanName,
      inviterId,
      inviterUsername
    }
  );

  return {
    id: invite.id,
    clanId: invite.clan_id,
    clanName,
    inviterId: invite.inviter_id,
    inviterUsername,
    inviteeId: invite.invitee_id,
    inviteeUsername,
    status: invite.status,
    expiresAt: invite.expires_at,
    createdAt: invite.created_at
  };
}

/**
 * Get pending clan invites for a user
 * @param {number} userId - User ID
 * @returns {Promise<object[]>} List of pending invites
 */
export async function getPendingInvites(userId) {
  const result = await query(
    `SELECT ci.id, ci.clan_id, ci.inviter_id, ci.expires_at, ci.created_at,
            c.name as clan_name, c.tag as clan_tag,
            u.username as inviter_username
     FROM clan_invites ci
     JOIN clans c ON ci.clan_id = c.id
     JOIN users u ON ci.inviter_id = u.id
     WHERE ci.invitee_id = $1 AND ci.status = 'pending' AND ci.expires_at > NOW()
     ORDER BY ci.created_at DESC`,
    [userId]
  );

  return result.rows.map(row => ({
    id: row.id,
    clanId: row.clan_id,
    clanName: row.clan_name,
    clanTag: row.clan_tag,
    inviterId: row.inviter_id,
    inviterUsername: row.inviter_username,
    expiresAt: row.expires_at,
    createdAt: row.created_at
  }));
}

/**
 * Accept a clan invite
 * @param {number} userId - User ID
 * @param {number} inviteId - Invite ID
 * @returns {Promise<object>} Membership details
 */
export async function acceptInvite(userId, inviteId) {
  // Get invite
  const inviteResult = await query(
    `SELECT id, clan_id, invitee_id, status, expires_at
     FROM clan_invites
     WHERE id = $1`,
    [inviteId]
  );

  if (inviteResult.rows.length === 0) {
    throw new Error('Invite not found');
  }

  const invite = inviteResult.rows[0];

  if (invite.invitee_id !== userId) {
    throw new Error('Invite not found');
  }

  if (invite.status !== 'pending') {
    throw new Error('Invite is no longer pending');
  }

  if (new Date(invite.expires_at) < new Date()) {
    // Mark as expired
    await query(
      "UPDATE clan_invites SET status = 'expired' WHERE id = $1",
      [inviteId]
    );
    throw new Error('Invite has expired');
  }

  // Check if user is already in a clan
  const existingMembership = await query(
    'SELECT clan_id FROM clan_members WHERE user_id = $1',
    [userId]
  );

  if (existingMembership.rows.length > 0) {
    throw new Error('You are already in a clan. Leave your current clan first.');
  }

  // Check if clan is full
  const clanResult = await query(
    `SELECT c.max_members, (SELECT COUNT(*) FROM clan_members WHERE clan_id = c.id) as member_count
     FROM clans c WHERE c.id = $1`,
    [invite.clan_id]
  );

  if (clanResult.rows.length === 0) {
    throw new Error('Clan no longer exists');
  }

  const { max_members, member_count } = clanResult.rows[0];
  if (parseInt(member_count, 10) >= max_members) {
    throw new Error('Clan is full');
  }

  // Accept invite and add member in transaction
  await query("UPDATE clan_invites SET status = 'accepted' WHERE id = $1", [inviteId]);

  await query(
    `INSERT INTO clan_members (clan_id, user_id, role, joined_at)
     VALUES ($1, $2, 'member', NOW())`,
    [invite.clan_id, userId]
  );

  // Decline any other pending invites for this user
  await query(
    `UPDATE clan_invites SET status = 'declined'
     WHERE invitee_id = $1 AND status = 'pending' AND id != $2`,
    [userId, inviteId]
  );

  // Get clan name for response
  const clanNameResult = await query('SELECT name FROM clans WHERE id = $1', [invite.clan_id]);

  return {
    clanId: invite.clan_id,
    clanName: clanNameResult.rows[0]?.name,
    userId,
    role: 'member'
  };
}

/**
 * Decline a clan invite
 * @param {number} userId - User ID
 * @param {number} inviteId - Invite ID
 */
export async function declineInvite(userId, inviteId) {
  const result = await query(
    `UPDATE clan_invites SET status = 'declined'
     WHERE id = $1 AND invitee_id = $2 AND status = 'pending'
     RETURNING id`,
    [inviteId, userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Invite not found or already processed');
  }
}

/**
 * Get clan chat messages
 * @param {number} userId - User ID (must be member)
 * @param {number} clanId - Clan ID
 * @param {number} limit - Max messages
 * @param {number|null} beforeId - Message ID for pagination
 * @returns {Promise<object[]>} Messages
 */
export async function getClanMessages(userId, clanId, limit = 50, beforeId = null) {
  // Check if user is a member
  const memberResult = await query(
    'SELECT user_id FROM clan_members WHERE clan_id = $1 AND user_id = $2',
    [clanId, userId]
  );

  if (memberResult.rows.length === 0) {
    throw new Error('You are not a member of this clan');
  }

  let sql = `
    SELECT cm.id, cm.user_id, cm.message, cm.created_at, u.username
    FROM clan_messages cm
    JOIN users u ON cm.user_id = u.id
    WHERE cm.clan_id = $1
  `;
  const params = [clanId];

  if (beforeId) {
    sql += ` AND cm.id < $2`;
    params.push(beforeId);
  }

  sql += ` ORDER BY cm.created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await query(sql, params);

  // Return in chronological order
  return result.rows.reverse().map(row => ({
    id: row.id,
    userId: row.user_id,
    username: row.username,
    message: row.message,
    createdAt: row.created_at
  }));
}

/**
 * Send a clan chat message
 * @param {number} userId - User ID (must be member)
 * @param {number} clanId - Clan ID
 * @param {string} message - Message text
 * @returns {Promise<object>} Created message
 */
export async function sendClanMessage(userId, clanId, message) {
  // Check if user is a member
  const memberResult = await query(
    'SELECT user_id FROM clan_members WHERE clan_id = $1 AND user_id = $2',
    [clanId, userId]
  );

  if (memberResult.rows.length === 0) {
    throw new Error('You are not a member of this clan');
  }

  // Get username
  const userResult = await query('SELECT username FROM users WHERE id = $1', [userId]);
  const username = userResult.rows[0]?.username || 'Unknown';

  // Insert message
  const result = await query(
    `INSERT INTO clan_messages (clan_id, user_id, message, created_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING id, clan_id, user_id, message, created_at`,
    [clanId, userId, message]
  );

  const msg = result.rows[0];

  return {
    id: msg.id,
    clanId: msg.clan_id,
    userId: msg.user_id,
    username,
    message: msg.message,
    createdAt: msg.created_at
  };
}
