/**
 * User Feedback Service
 * Handles submission and management of user feedback (enhancements, bugs, abuse reports)
 */

import { query } from '../config/database.js';

const VALID_FEEDBACK_TYPES = ['enhancement', 'bug', 'abuse'];
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

/**
 * Submit user feedback
 *
 * @param {number} userId - User ID
 * @param {Object} feedbackData - Feedback data
 * @param {Object} req - Express request for context
 * @returns {Object} Created feedback record
 */
export async function submitFeedback(userId, feedbackData, req = {}) {
  const {
    feedbackType,
    title,
    description,
    characterId,
    gameContext,
    reportedCharacterName
  } = feedbackData;

  // Validate feedback type
  if (!VALID_FEEDBACK_TYPES.includes(feedbackType)) {
    throw new Error(`Invalid feedback type. Must be one of: ${VALID_FEEDBACK_TYPES.join(', ')}`);
  }

  // Validate title
  if (!title || title.trim().length === 0) {
    throw new Error('Title is required');
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new Error(`Title must be ${MAX_TITLE_LENGTH} characters or less`);
  }

  // Validate description
  if (!description || description.trim().length === 0) {
    throw new Error('Description is required');
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`Description must be ${MAX_DESCRIPTION_LENGTH} characters or less`);
  }

  // For abuse reports, look up the reported character
  let reportedUserId = null;
  let reportedCharacterId = null;
  if (feedbackType === 'abuse' && reportedCharacterName) {
    const charResult = await query(
      `SELECT c.id, c.user_id FROM characters c
       WHERE LOWER(c.name) = LOWER($1)`,
      [reportedCharacterName.trim()]
    );
    if (charResult.rows.length > 0) {
      reportedCharacterId = charResult.rows[0].id;
      reportedUserId = charResult.rows[0].user_id;
    }
  }

  // Extract request context
  const ip = req.ip || null;
  const userAgent = req.get?.('user-agent') || null;

  // Insert feedback
  const result = await query(`
    INSERT INTO user_feedback (
      feedback_type, title, description, user_id, character_id,
      game_context, ip_address, user_agent,
      reported_user_id, reported_character_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id, feedback_type, title, description, character_id,
              game_context, status, created_at
  `, [
    feedbackType,
    title.trim(),
    description.trim(),
    userId,
    characterId || null,
    JSON.stringify(gameContext || {}),
    ip,
    userAgent,
    reportedUserId,
    reportedCharacterId
  ]);

  return result.rows[0];
}

/**
 * Get user's own feedback submissions
 *
 * @param {number} userId - User ID
 * @param {Object} options - Query options
 * @returns {Array} User's feedback records
 */
export async function getUserFeedback(userId, options = {}) {
  const { limit = 20, offset = 0 } = options;

  const result = await query(`
    SELECT
      id, feedback_type, title, description, character_id,
      game_context, status, admin_notes, created_at, resolved_at
    FROM user_feedback
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `, [userId, limit, offset]);

  return result.rows;
}

/**
 * Get feedback by type for admin review
 *
 * @param {Object} options - Query options
 * @returns {Array} Feedback records
 */
export async function getFeedbackByType(options = {}) {
  const { type, status, limit = 50, offset = 0 } = options;

  let whereClause = 'WHERE 1=1';
  const params = [];

  if (type) {
    params.push(type);
    whereClause += ` AND feedback_type = $${params.length}`;
  }

  if (status) {
    params.push(status);
    whereClause += ` AND status = $${params.length}`;
  }

  params.push(limit, offset);

  const result = await query(`
    SELECT
      f.id, f.feedback_type, f.title, f.description,
      f.user_id, u.username as submitter_username,
      f.character_id, c.name as character_name,
      f.game_context, f.status, f.admin_notes,
      f.reported_user_id, ru.username as reported_username,
      f.reported_character_id, rc.name as reported_character_name,
      f.created_at, f.resolved_at
    FROM user_feedback f
    JOIN users u ON f.user_id = u.id
    LEFT JOIN characters c ON f.character_id = c.id
    LEFT JOIN users ru ON f.reported_user_id = ru.id
    LEFT JOIN characters rc ON f.reported_character_id = rc.id
    ${whereClause}
    ORDER BY f.created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);

  return result.rows;
}

/**
 * Update feedback status (admin action)
 *
 * @param {number} feedbackId - Feedback ID
 * @param {number} adminId - Admin user ID
 * @param {Object} updates - Updates to apply
 * @returns {Object} Updated feedback record
 */
export async function updateFeedbackStatus(feedbackId, adminId, updates) {
  const { status, adminNotes } = updates;

  const validStatuses = ['pending', 'reviewing', 'resolved', 'declined'];
  if (status && !validStatuses.includes(status)) {
    throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }

  const result = await query(`
    UPDATE user_feedback
    SET
      status = COALESCE($2, status),
      admin_notes = COALESCE($3, admin_notes),
      resolved_at = CASE WHEN $2 IN ('resolved', 'declined') THEN CURRENT_TIMESTAMP ELSE resolved_at END,
      resolved_by = CASE WHEN $2 IN ('resolved', 'declined') THEN $4 ELSE resolved_by END
    WHERE id = $1
    RETURNING id, feedback_type, title, status, admin_notes, resolved_at
  `, [feedbackId, status || null, adminNotes || null, adminId]);

  if (result.rows.length === 0) {
    throw new Error('Feedback not found');
  }

  return result.rows[0];
}

/**
 * Get feedback statistics
 *
 * @returns {Object} Feedback statistics
 */
export async function getFeedbackStats() {
  const result = await query(`
    SELECT
      feedback_type,
      status,
      COUNT(*) as count
    FROM user_feedback
    GROUP BY feedback_type, status
  `);

  const stats = {
    byType: {},
    byStatus: {},
    total: 0
  };

  for (const row of result.rows) {
    stats.byType[row.feedback_type] = (stats.byType[row.feedback_type] || 0) + parseInt(row.count);
    stats.byStatus[row.status] = (stats.byStatus[row.status] || 0) + parseInt(row.count);
    stats.total += parseInt(row.count);
  }

  return stats;
}
