/**
 * Friend Service
 * Handles friend requests, blocking, favorites, and friend list management
 */

import { query } from '../config/database.js';
import * as notificationService from './notificationService.js';
import * as presenceService from './presenceService.js';

/**
 * Send a friend request to another user by username
 * @param {number} fromUserId - Sender's user ID
 * @param {string} toUsername - Recipient's username
 * @returns {Promise<object>} The created friendship request
 */
export async function sendFriendRequest(fromUserId, toUsername) {
  // Find target user by username
  const userResult = await query(
    'SELECT id, username FROM users WHERE username = $1',
    [toUsername]
  );

  if (userResult.rows.length === 0) {
    throw new Error('User not found');
  }

  const toUser = userResult.rows[0];
  const toUserId = toUser.id;

  // Cannot friend yourself
  if (fromUserId === toUserId) {
    throw new Error('Cannot send friend request to yourself');
  }

  // Check if either user has blocked the other
  const blocked = await isBlocked(fromUserId, toUserId);
  if (blocked) {
    throw new Error('Cannot send friend request to this user');
  }

  // Check for existing friendship in either direction
  const existingResult = await query(
    `SELECT id, status, user_id, friend_id FROM friendships
     WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
    [fromUserId, toUserId]
  );

  if (existingResult.rows.length > 0) {
    const existing = existingResult.rows[0];

    if (existing.status === 'accepted') {
      throw new Error('You are already friends with this user');
    }

    if (existing.status === 'pending') {
      // If the other user sent us a request, auto-accept it
      if (existing.user_id === toUserId && existing.friend_id === fromUserId) {
        return acceptRequest(existing.id, fromUserId);
      }
      throw new Error('Friend request already pending');
    }

    if (existing.status === 'blocked') {
      throw new Error('Cannot send friend request to this user');
    }
  }

  // Create the friend request
  const result = await query(
    `INSERT INTO friendships (user_id, friend_id, status, created_at)
     VALUES ($1, $2, 'pending', NOW())
     RETURNING id, user_id, friend_id, status, created_at`,
    [fromUserId, toUserId]
  );

  const friendship = result.rows[0];

  // Get sender username for notification
  const senderResult = await query(
    'SELECT username FROM users WHERE id = $1',
    [fromUserId]
  );
  const senderUsername = senderResult.rows[0]?.username || 'Unknown';

  // Send notification to recipient
  await notificationService.createNotification(
    toUserId,
    'friend_request',
    'Friend Request',
    `${senderUsername} wants to be your friend`,
    {
      requestId: friendship.id,
      fromUserId,
      fromUsername: senderUsername
    }
  );

  return {
    id: friendship.id,
    userId: friendship.user_id,
    friendId: friendship.friend_id,
    status: friendship.status,
    createdAt: friendship.created_at,
    toUsername: toUser.username
  };
}

/**
 * Accept a pending friend request
 * @param {number} requestId - The friendship request ID
 * @param {number} userId - The accepting user's ID (must be the recipient)
 * @returns {Promise<object>} The accepted friendship
 */
export async function acceptRequest(requestId, userId) {
  // Get the request and verify recipient
  const requestResult = await query(
    `SELECT f.id, f.user_id, f.friend_id, f.status, u.username as sender_username
     FROM friendships f
     JOIN users u ON f.user_id = u.id
     WHERE f.id = $1`,
    [requestId]
  );

  if (requestResult.rows.length === 0) {
    throw new Error('Friend request not found');
  }

  const request = requestResult.rows[0];

  if (request.friend_id !== userId) {
    throw new Error('You cannot accept this friend request');
  }

  if (request.status !== 'pending') {
    throw new Error('Friend request is no longer pending');
  }

  // Update the original request to accepted
  await query(
    `UPDATE friendships
     SET status = 'accepted', accepted_at = NOW()
     WHERE id = $1`,
    [requestId]
  );

  // Create the reciprocal friendship row
  await query(
    `INSERT INTO friendships (user_id, friend_id, status, created_at, accepted_at)
     VALUES ($1, $2, 'accepted', NOW(), NOW())
     ON CONFLICT (user_id, friend_id) DO UPDATE
     SET status = 'accepted', accepted_at = NOW()`,
    [userId, request.user_id]
  );

  // Get accepter username for notification
  const accepterResult = await query(
    'SELECT username FROM users WHERE id = $1',
    [userId]
  );
  const accepterUsername = accepterResult.rows[0]?.username || 'Unknown';

  // Send notification to the original requester
  await notificationService.createNotification(
    request.user_id,
    'friend_accepted',
    'Friend Request Accepted',
    `${accepterUsername} accepted your friend request`,
    {
      friendId: userId,
      friendUsername: accepterUsername
    }
  );

  return {
    id: requestId,
    userId: request.user_id,
    friendId: request.friend_id,
    status: 'accepted',
    friendUsername: request.sender_username
  };
}

/**
 * Decline a pending friend request
 * @param {number} requestId - The friendship request ID
 * @param {number} userId - The declining user's ID (must be the recipient)
 * @returns {Promise<boolean>} Success
 */
export async function declineRequest(requestId, userId) {
  const result = await query(
    `DELETE FROM friendships
     WHERE id = $1 AND friend_id = $2 AND status = 'pending'
     RETURNING id`,
    [requestId, userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Friend request not found or already processed');
  }

  return true;
}

/**
 * Remove a friend (unfriend)
 * @param {number} userId - The user performing the unfriend
 * @param {number} friendId - The friend to remove
 * @returns {Promise<boolean>} Success
 */
export async function unfriend(userId, friendId) {
  // Delete both friendship rows
  const result = await query(
    `DELETE FROM friendships
     WHERE (user_id = $1 AND friend_id = $2 AND status = 'accepted')
        OR (user_id = $2 AND friend_id = $1 AND status = 'accepted')
     RETURNING id`,
    [userId, friendId]
  );

  if (result.rows.length === 0) {
    throw new Error('Friendship not found');
  }

  return true;
}

/**
 * Block a user
 * @param {number} userId - The user doing the blocking
 * @param {number} blockedId - The user to block
 * @returns {Promise<object>} The block record
 */
export async function blockUser(userId, blockedId) {
  if (userId === blockedId) {
    throw new Error('Cannot block yourself');
  }

  // Remove any existing friendship first
  await query(
    `DELETE FROM friendships
     WHERE (user_id = $1 AND friend_id = $2)
        OR (user_id = $2 AND friend_id = $1)`,
    [userId, blockedId]
  );

  // Create or update block record
  const result = await query(
    `INSERT INTO friendships (user_id, friend_id, status, created_at)
     VALUES ($1, $2, 'blocked', NOW())
     ON CONFLICT (user_id, friend_id) DO UPDATE
     SET status = 'blocked', is_favorite = FALSE, note = NULL
     RETURNING id, user_id, friend_id, status, created_at`,
    [userId, blockedId]
  );

  return result.rows[0];
}

/**
 * Unblock a user
 * @param {number} userId - The user doing the unblocking
 * @param {number} blockedId - The user to unblock
 * @returns {Promise<boolean>} Success
 */
export async function unblockUser(userId, blockedId) {
  const result = await query(
    `DELETE FROM friendships
     WHERE user_id = $1 AND friend_id = $2 AND status = 'blocked'
     RETURNING id`,
    [userId, blockedId]
  );

  if (result.rows.length === 0) {
    throw new Error('Block not found');
  }

  return true;
}

/**
 * Update friend metadata (favorite status, note)
 * @param {number} userId - The user updating
 * @param {number} friendId - The friend to update
 * @param {object} updates - { isFavorite, note }
 * @returns {Promise<object>} The updated friendship
 */
export async function updateFriend(userId, friendId, { isFavorite, note }) {
  const updates = [];
  const params = [];
  let paramIndex = 1;

  if (isFavorite !== undefined) {
    updates.push(`is_favorite = $${paramIndex}`);
    params.push(isFavorite);
    paramIndex++;
  }

  if (note !== undefined) {
    // Limit note length
    const trimmedNote = note ? note.substring(0, 256) : null;
    updates.push(`note = $${paramIndex}`);
    params.push(trimmedNote);
    paramIndex++;
  }

  if (updates.length === 0) {
    throw new Error('No updates provided');
  }

  params.push(userId, friendId);

  const result = await query(
    `UPDATE friendships
     SET ${updates.join(', ')}
     WHERE user_id = $${paramIndex} AND friend_id = $${paramIndex + 1} AND status = 'accepted'
     RETURNING id, user_id, friend_id, is_favorite, note`,
    params
  );

  if (result.rows.length === 0) {
    throw new Error('Friendship not found');
  }

  return result.rows[0];
}

/**
 * Get user's friends list with online status
 * @param {number} userId - The user's ID
 * @returns {Promise<object[]>} Array of friends with presence info
 */
export async function getFriends(userId) {
  const result = await query(
    `SELECT
       f.id as friendship_id,
       f.friend_id,
       f.is_favorite,
       f.note,
       f.accepted_at,
       u.username,
       c.id as character_id,
       c.name as character_name,
       c.level,
       c.race,
       c.class
     FROM friendships f
     JOIN users u ON f.friend_id = u.id
     LEFT JOIN characters c ON c.user_id = f.friend_id AND c.party_slot = 1
     WHERE f.user_id = $1 AND f.status = 'accepted'
     ORDER BY f.is_favorite DESC, u.username ASC`,
    [userId]
  );

  // Enrich with online status from presence service
  const friends = await Promise.all(
    result.rows.map(async (friend) => {
      const presence = await presenceService.getPresence(friend.friend_id);
      return {
        friendshipId: friend.friendship_id,
        friendId: friend.friend_id,
        username: friend.username,
        isFavorite: friend.is_favorite,
        note: friend.note,
        acceptedAt: friend.accepted_at,
        character: friend.character_id ? {
          id: friend.character_id,
          name: friend.character_name,
          level: friend.level,
          race: friend.race,
          class: friend.class
        } : null,
        online: presence?.status === 'online',
        status: presence?.status || 'offline',
        customMessage: presence?.customMessage || null,
        currentNodeId: presence?.currentNodeId || null
      };
    })
  );

  return friends;
}

/**
 * Get pending incoming friend requests
 * @param {number} userId - The user's ID
 * @returns {Promise<object[]>} Array of pending requests
 */
export async function getPendingRequests(userId) {
  const result = await query(
    `SELECT
       f.id as request_id,
       f.user_id as from_user_id,
       f.created_at,
       u.username as from_username,
       c.name as character_name,
       c.level,
       c.race,
       c.class
     FROM friendships f
     JOIN users u ON f.user_id = u.id
     LEFT JOIN characters c ON c.user_id = f.user_id AND c.party_slot = 1
     WHERE f.friend_id = $1 AND f.status = 'pending'
     ORDER BY f.created_at DESC`,
    [userId]
  );

  return result.rows.map(row => ({
    requestId: row.request_id,
    fromUserId: row.from_user_id,
    fromUsername: row.from_username,
    createdAt: row.created_at,
    character: row.character_name ? {
      name: row.character_name,
      level: row.level,
      race: row.race,
      class: row.class
    } : null
  }));
}

/**
 * Check if either user has blocked the other
 * @param {number} userId1 - First user ID
 * @param {number} userId2 - Second user ID
 * @returns {Promise<boolean>} True if blocked
 */
export async function isBlocked(userId1, userId2) {
  const result = await query(
    `SELECT id FROM friendships
     WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
       AND status = 'blocked'`,
    [userId1, userId2]
  );

  return result.rows.length > 0;
}

/**
 * Search for players by username
 * @param {string} queryStr - Search query (min 2 chars)
 * @param {number} excludeUserId - User ID to exclude from results
 * @param {number} limit - Max results (default 20)
 * @returns {Promise<object[]>} Array of matching users
 */
export async function searchPlayers(queryStr, excludeUserId, limit = 20) {
  if (!queryStr || queryStr.length < 2) {
    throw new Error('Search query must be at least 2 characters');
  }

  // Sanitize query for LIKE pattern
  const searchPattern = `%${queryStr.replace(/[%_]/g, '\\$&')}%`;

  // Find users matching the query, excluding blocked users
  const result = await query(
    `SELECT
       u.id,
       u.username,
       c.name as character_name,
       c.level,
       c.race,
       c.class,
       CASE WHEN f.id IS NOT NULL AND f.status = 'accepted' THEN true ELSE false END as is_friend,
       CASE WHEN f.id IS NOT NULL AND f.status = 'pending' AND f.user_id = $2 THEN true ELSE false END as request_sent,
       CASE WHEN f.id IS NOT NULL AND f.status = 'pending' AND f.friend_id = $2 THEN true ELSE false END as request_received
     FROM users u
     LEFT JOIN characters c ON c.user_id = u.id AND c.party_slot = 1
     LEFT JOIN friendships f ON (
       (f.user_id = $2 AND f.friend_id = u.id) OR
       (f.user_id = u.id AND f.friend_id = $2)
     )
     WHERE u.username ILIKE $1
       AND u.id != $2
       AND NOT EXISTS (
         SELECT 1 FROM friendships block
         WHERE ((block.user_id = $2 AND block.friend_id = u.id)
            OR (block.user_id = u.id AND block.friend_id = $2))
           AND block.status = 'blocked'
       )
     ORDER BY
       CASE WHEN u.username ILIKE $3 THEN 0 ELSE 1 END,
       u.username ASC
     LIMIT $4`,
    [searchPattern, excludeUserId, `${queryStr}%`, limit]
  );

  // Enrich with online status
  const players = await Promise.all(
    result.rows.map(async (player) => {
      const presence = await presenceService.getPresence(player.id);
      return {
        id: player.id,
        username: player.username,
        character: player.character_name ? {
          name: player.character_name,
          level: player.level,
          race: player.race,
          class: player.class
        } : null,
        isFriend: player.is_friend,
        requestSent: player.request_sent,
        requestReceived: player.request_received,
        online: presence?.status === 'online',
        status: presence?.status || 'offline'
      };
    })
  );

  return players;
}

/**
 * Get blocked users list
 * @param {number} userId - The user's ID
 * @returns {Promise<object[]>} Array of blocked users
 */
export async function getBlockedUsers(userId) {
  const result = await query(
    `SELECT
       f.id as block_id,
       f.friend_id as blocked_user_id,
       f.created_at as blocked_at,
       u.username
     FROM friendships f
     JOIN users u ON f.friend_id = u.id
     WHERE f.user_id = $1 AND f.status = 'blocked'
     ORDER BY f.created_at DESC`,
    [userId]
  );

  return result.rows.map(row => ({
    blockId: row.block_id,
    blockedUserId: row.blocked_user_id,
    username: row.username,
    blockedAt: row.blocked_at
  }));
}

export default {
  sendFriendRequest,
  acceptRequest,
  declineRequest,
  unfriend,
  blockUser,
  unblockUser,
  updateFriend,
  getFriends,
  getPendingRequests,
  isBlocked,
  searchPlayers,
  getBlockedUsers
};
