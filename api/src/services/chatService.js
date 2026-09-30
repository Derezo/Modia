import { query } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Chat Service - Handles all chat-related database operations
 */

/**
 * Save a chat message to the database
 * @param {Object} messageData - Message data
 * @returns {Object} Saved message with ID
 */
async function saveMessage(messageData) {
  const {
    characterId,
    senderUserId,
    nodeId = null,
    roomType = 'global',
    message,
    targetUserId = null,
    partyId = null
  } = messageData;

  const result = await query(
    `INSERT INTO chat_messages
     (character_id, sender_user_id, node_id, room_type, message, target_user_id, party_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, character_id, sender_user_id, node_id, room_type, message,
               target_user_id, party_id, reactions, created_at`,
    [characterId, senderUserId, nodeId, roomType, message, targetUserId, partyId]
  );

  return result.rows[0];
}

/**
 * Get chat history for a room
 * @param {string} roomType - Room type (global, or party with options.partyId)
 * @param {Object} options - Query options
 * @returns {Array} Messages
 */
async function getHistory(roomType, options = {}) {
  const { limit = 50, before = null, nodeId = null, partyId = null } = options;

  // Second line of defence behind the route's membership check: party
  // history is only ever read for one party, and DMs go through
  // getDMHistory. Any other room type would return every row of that type.
  if (roomType === 'party') {
    if (!partyId) throw new AppError('partyId is required for party chat history', 400);
  } else if (roomType !== 'global') {
    throw new AppError('Invalid room type', 400);
  }

  let queryText = `
    SELECT
      cm.id,
      cm.character_id,
      cm.sender_user_id,
      cm.node_id,
      cm.room_type,
      cm.message,
      cm.target_user_id,
      cm.party_id,
      cm.reactions,
      cm.created_at,
      c.name as character_name,
      u.username as sender_username
    FROM chat_messages cm
    LEFT JOIN characters c ON cm.character_id = c.id
    LEFT JOIN users u ON cm.sender_user_id = u.id
    WHERE cm.room_type = $1
  `;

  const params = [roomType];
  let paramIndex = 2;

  if (before) {
    queryText += ` AND cm.created_at < $${paramIndex}`;
    params.push(before);
    paramIndex++;
  }

  if (nodeId && roomType === 'global') {
    // For global, optionally filter by node (local chat)
    queryText += ` AND (cm.node_id = $${paramIndex} OR cm.node_id IS NULL)`;
    params.push(nodeId);
    paramIndex++;
  }

  if (roomType === 'party') {
    queryText += ` AND cm.party_id = $${paramIndex}`;
    params.push(partyId);
    paramIndex++;
  }

  queryText += ` ORDER BY cm.created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await query(queryText, params);

  // Return in chronological order
  return result.rows.reverse();
}

/**
 * Get DM history between two users
 * @param {number} userId1 - First user ID
 * @param {number} userId2 - Second user ID
 * @param {Object} options - Query options
 * @returns {Array} Messages
 */
async function getDMHistory(userId1, userId2, options = {}) {
  const { limit = 50, before = null } = options;

  let queryText = `
    SELECT
      cm.id,
      cm.character_id,
      cm.sender_user_id,
      cm.room_type,
      cm.message,
      cm.target_user_id,
      cm.reactions,
      cm.created_at,
      c.name as character_name,
      u.username as sender_username
    FROM chat_messages cm
    LEFT JOIN characters c ON cm.character_id = c.id
    LEFT JOIN users u ON cm.sender_user_id = u.id
    WHERE cm.room_type = 'dm'
      AND (
        (cm.sender_user_id = $1 AND cm.target_user_id = $2)
        OR (cm.sender_user_id = $2 AND cm.target_user_id = $1)
      )
  `;

  const params = [userId1, userId2];
  let paramIndex = 3;

  if (before) {
    queryText += ` AND cm.created_at < $${paramIndex}`;
    params.push(before);
    paramIndex++;
  }

  queryText += ` ORDER BY cm.created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await query(queryText, params);

  // Return in chronological order
  return result.rows.reverse();
}

// Unicode emoji (including ZWJ sequences and variation selectors)
const EMOJI_RE = /^(?:[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]|\u{FE0F}|\u{200D})+$/u;
// Shortcode format like :smile: or :thumbs_up:
const SHORTCODE_RE = /^:[a-z_]{1,30}:$/;

/**
 * Validate a reaction emoji (shared by the REST and WebSocket paths).
 * @param {*} emoji - Client-supplied emoji
 * @returns {string} The emoji
 * @throws {AppError} 400 when it is not a supported emoji or shortcode
 */
function validateReactionEmoji(emoji) {
  if (typeof emoji !== 'string' || emoji.length === 0 || emoji.length > 32 ||
      (!EMOJI_RE.test(emoji) && !SHORTCODE_RE.test(emoji))) {
    throw new AppError('Invalid emoji format', 400);
  }
  return emoji;
}

/**
 * Whether a user may see (and so react to) a message: global chat is
 * public, a DM only to its two participants, party chat only to members.
 * @param {Object} message - chat_messages row
 * @param {number} userId - Viewer
 * @returns {Promise<boolean>}
 */
async function canUserSeeMessage(message, userId) {
  if (!message) return false;
  if (message.room_type === 'global') return true;
  if (message.room_type === 'dm') {
    return Number(message.sender_user_id) === Number(userId) ||
      Number(message.target_user_id) === Number(userId);
  }
  if (message.room_type === 'party' && message.party_id != null) {
    const member = await query(
      'SELECT 1 FROM party_members WHERE party_id = $1 AND user_id = $2',
      [message.party_id, userId]
    );
    return member.rows.length > 0;
  }
  return false;
}

/**
 * Resolve a reaction target the user can see, or throw.
 * A hidden message is reported as not found so its existence does not leak.
 * @param {*} messageId - Client-supplied message ID
 * @param {number} userId - Reacting user
 * @returns {Promise<number>} Parsed message ID
 */
async function resolveVisibleMessageId(messageId, userId) {
  const parsedId = Number(messageId);
  if (!Number.isSafeInteger(parsedId) || parsedId < 1) {
    throw new AppError('Invalid message ID', 400);
  }
  const message = await getMessageById(parsedId);
  if (!(await canUserSeeMessage(message, userId))) {
    throw new AppError('Message not found', 404);
  }
  return parsedId;
}

/**
 * Add a reaction to a message
 * @param {number} messageId - Message ID
 * @param {number} userId - User ID adding the reaction
 * @param {string} emoji - Emoji to add
 * @returns {Object} Updated reaction data
 */
async function addReaction(messageId, userId, emoji) {
  validateReactionEmoji(emoji);
  messageId = await resolveVisibleMessageId(messageId, userId);

  // Insert into reactions table (will fail silently if duplicate)
  await query(
    `INSERT INTO chat_reactions (message_id, user_id, emoji)
     VALUES ($1, $2, $3)
     ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
    [messageId, userId, emoji]
  );

  // Get all reactions for this message
  const result = await query(
    `SELECT emoji, array_agg(user_id) as user_ids
     FROM chat_reactions
     WHERE message_id = $1
     GROUP BY emoji`,
    [messageId]
  );

  // Format reactions
  const reactions = result.rows.map(row => ({
    emoji: row.emoji,
    count: row.user_ids.length,
    userIds: row.user_ids
  }));

  // Update the JSONB reactions column on the message for quick access
  await query(
    'UPDATE chat_messages SET reactions = $1 WHERE id = $2',
    [JSON.stringify(reactions), messageId]
  );

  return { messageId, reactions };
}

/**
 * Remove a reaction from a message
 * @param {number} messageId - Message ID
 * @param {number} userId - User ID removing the reaction
 * @param {string} emoji - Emoji to remove
 * @returns {Object} Updated reaction data
 */
async function removeReaction(messageId, userId, emoji) {
  if (typeof emoji !== 'string' || emoji.length === 0 || emoji.length > 32) {
    throw new AppError('Invalid emoji format', 400);
  }
  messageId = await resolveVisibleMessageId(messageId, userId);

  await query(
    `DELETE FROM chat_reactions
     WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
    [messageId, userId, emoji]
  );

  // Get updated reactions
  const result = await query(
    `SELECT emoji, array_agg(user_id) as user_ids
     FROM chat_reactions
     WHERE message_id = $1
     GROUP BY emoji`,
    [messageId]
  );

  const reactions = result.rows.map(row => ({
    emoji: row.emoji,
    count: row.user_ids.length,
    userIds: row.user_ids
  }));

  // Update the JSONB reactions column
  await query(
    'UPDATE chat_messages SET reactions = $1 WHERE id = $2',
    [JSON.stringify(reactions), messageId]
  );

  return { messageId, reactions };
}

/**
 * Get message by ID
 * @param {number} messageId - Message ID
 * @returns {Object|null} Message or null
 */
async function getMessageById(messageId) {
  const result = await query(
    `SELECT
      cm.*,
      c.name as character_name,
      u.username as sender_username
     FROM chat_messages cm
     LEFT JOIN characters c ON cm.character_id = c.id
     LEFT JOIN users u ON cm.sender_user_id = u.id
     WHERE cm.id = $1`,
    [messageId]
  );

  return result.rows[0] || null;
}

/**
 * Get recent DM conversations for a user
 * @param {number} userId - User ID
 * @param {number} limit - Max conversations to return
 * @returns {Array} Recent DM conversations
 */
async function getRecentDMConversations(userId, limit = 20) {
  const result = await query(
    `SELECT DISTINCT ON (other_user_id)
      CASE
        WHEN cm.sender_user_id = $1 THEN cm.target_user_id
        ELSE cm.sender_user_id
      END as other_user_id,
      u.username as other_username,
      cm.message as last_message,
      cm.created_at as last_message_at
     FROM chat_messages cm
     JOIN users u ON u.id = CASE
       WHEN cm.sender_user_id = $1 THEN cm.target_user_id
       ELSE cm.sender_user_id
     END
     WHERE cm.room_type = 'dm'
       AND (cm.sender_user_id = $1 OR cm.target_user_id = $1)
     ORDER BY other_user_id, cm.created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows;
}

export {
  saveMessage,
  validateReactionEmoji,
  canUserSeeMessage,
  getHistory,
  getDMHistory,
  addReaction,
  removeReaction,
  getMessageById,
  getRecentDMConversations
};

export default {
  saveMessage,
  validateReactionEmoji,
  canUserSeeMessage,
  getHistory,
  getDMHistory,
  addReaction,
  removeReaction,
  getMessageById,
  getRecentDMConversations
};
