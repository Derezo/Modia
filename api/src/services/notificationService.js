/**
 * Notification Service
 * Handles creating, retrieving, and managing notifications
 * Integrates with WebSocket for real-time delivery
 */

import { query } from '../config/database.js';
import ws from '../websocket/index.js';

// Notification types and their default expiry times (in milliseconds)
const NOTIFICATION_TYPES = {
  friend_request: null,           // Never expires
  friend_accepted: 24 * 60 * 60 * 1000,  // 24 hours
  party_invite: 5 * 60 * 1000,    // 5 minutes
  match_found: 30 * 1000,         // 30 seconds
  match_result: 24 * 60 * 60 * 1000,  // 24 hours
  system: null,                   // Never expires
  lfg_application: 30 * 60 * 1000 // 30 minutes
};

/**
 * Create and send a notification to a user
 * @param {number} userId - Target user ID
 * @param {string} type - Notification type (friend_request, party_invite, etc.)
 * @param {string} title - Short notification title
 * @param {string} message - Optional longer message
 * @param {object} payload - Action data (inviteId, requestId, etc.)
 * @param {Date|null} expiresAt - Custom expiry time (uses default if null)
 * @returns {Promise<object>} The created notification
 */
export async function createNotification(userId, type, title, message = null, payload = {}, expiresAt = null) {
  // Calculate expiry time
  let expiry = expiresAt;
  if (!expiry && NOTIFICATION_TYPES[type]) {
    expiry = new Date(Date.now() + NOTIFICATION_TYPES[type]);
  }

  const result = await query(
    `INSERT INTO notifications (user_id, type, title, message, payload, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, type, title, message, payload, expires_at, created_at`,
    [userId, type, title, message, payload, expiry]
  );

  const notification = result.rows[0];

  // Send real-time notification via WebSocket
  ws.sendToUser(userId, {
    type: 'notification:new',
    payload: {
      id: notification.id,
      notificationType: notification.type,
      title: notification.title,
      message: notification.message,
      payload: notification.payload,
      expiresAt: notification.expires_at,
      createdAt: notification.created_at
    }
  });

  return notification;
}

/**
 * Get all notifications for a user
 * @param {number} userId - User ID
 * @param {boolean} includeRead - Include read notifications
 * @param {boolean} includeDismissed - Include dismissed notifications
 * @param {number} limit - Maximum notifications to return
 * @returns {Promise<object[]>} Array of notifications
 */
export async function getNotifications(userId, includeRead = false, includeDismissed = false, limit = 50) {
  let whereClause = 'WHERE user_id = $1';
  const params = [userId];

  if (!includeRead) {
    whereClause += ' AND read_at IS NULL';
  }

  if (!includeDismissed) {
    whereClause += ' AND dismissed_at IS NULL';
  }

  // Exclude expired notifications
  whereClause += ' AND (expires_at IS NULL OR expires_at > NOW())';

  const result = await query(
    `SELECT id, type, title, message, payload, read_at, expires_at, created_at
     FROM notifications
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows;
}

/**
 * Get unread notification count for a user
 * @param {number} userId - User ID
 * @returns {Promise<number>} Unread count
 */
export async function getUnreadCount(userId) {
  const result = await query(
    `SELECT COUNT(*) as count
     FROM notifications
     WHERE user_id = $1
       AND read_at IS NULL
       AND dismissed_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [userId]
  );

  return parseInt(result.rows[0].count, 10);
}

/**
 * Mark a notification as read
 * @param {number} notificationId - Notification ID
 * @param {number} userId - User ID (for authorization)
 * @returns {Promise<boolean>} Success
 */
export async function markAsRead(notificationId, userId) {
  const result = await query(
    `UPDATE notifications
     SET read_at = NOW()
     WHERE id = $1 AND user_id = $2 AND read_at IS NULL
     RETURNING id`,
    [notificationId, userId]
  );

  return result.rows.length > 0;
}

/**
 * Mark all notifications as read for a user
 * @param {number} userId - User ID
 * @returns {Promise<number>} Number of notifications marked as read
 */
export async function markAllAsRead(userId) {
  const result = await query(
    `UPDATE notifications
     SET read_at = NOW()
     WHERE user_id = $1 AND read_at IS NULL
     RETURNING id`,
    [userId]
  );

  return result.rows.length;
}

/**
 * Dismiss (hide) a notification
 * @param {number} notificationId - Notification ID
 * @param {number} userId - User ID (for authorization)
 * @returns {Promise<boolean>} Success
 */
export async function dismissNotification(notificationId, userId) {
  const result = await query(
    `UPDATE notifications
     SET dismissed_at = NOW()
     WHERE id = $1 AND user_id = $2 AND dismissed_at IS NULL
     RETURNING id`,
    [notificationId, userId]
  );

  return result.rows.length > 0;
}

/**
 * Get a specific notification by ID
 * @param {number} notificationId - Notification ID
 * @param {number} userId - User ID (for authorization)
 * @returns {Promise<object|null>} Notification or null
 */
export async function getNotification(notificationId, userId) {
  const result = await query(
    `SELECT id, type, title, message, payload, read_at, dismissed_at, expires_at, created_at
     FROM notifications
     WHERE id = $1 AND user_id = $2`,
    [notificationId, userId]
  );

  return result.rows[0] || null;
}

/**
 * Delete expired notifications (cleanup job)
 * @returns {Promise<number>} Number of deleted notifications
 */
export async function cleanupExpired() {
  const result = await query(
    `DELETE FROM notifications
     WHERE expires_at IS NOT NULL
       AND expires_at < NOW()
     RETURNING id`
  );

  return result.rows.length;
}

/**
 * Send a notification for an expiring item (like party invite about to expire)
 * @param {number} notificationId - The notification to update
 * @param {number} userId - User ID
 */
export async function notifyExpiring(notificationId, userId) {
  const notification = await getNotification(notificationId, userId);
  if (!notification || notification.dismissed_at) return;

  ws.sendToUser(userId, {
    type: 'notification:expiring',
    payload: {
      id: notificationId,
      expiresAt: notification.expires_at
    }
  });
}

/**
 * Cancel/remove a notification (e.g., when party invite is withdrawn)
 * @param {number} notificationId - Notification ID
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} Success
 */
export async function cancelNotification(notificationId, userId) {
  const result = await query(
    `DELETE FROM notifications
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [notificationId, userId]
  );

  if (result.rows.length > 0) {
    ws.sendToUser(userId, {
      type: 'notification:cancelled',
      payload: { id: notificationId }
    });
    return true;
  }

  return false;
}

/**
 * Find notification by payload criteria
 * Useful for finding a notification to cancel when an invite is withdrawn
 * @param {number} userId - User ID
 * @param {string} type - Notification type
 * @param {object} payloadMatch - Key-value pairs to match in payload
 * @returns {Promise<object|null>} Notification or null
 */
export async function findByPayload(userId, type, payloadMatch) {
  const result = await query(
    `SELECT id, type, title, message, payload, read_at, expires_at, created_at
     FROM notifications
     WHERE user_id = $1
       AND type = $2
       AND payload @> $3
       AND dismissed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, type, payloadMatch]
  );

  return result.rows[0] || null;
}

export default {
  createNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  dismissNotification,
  getNotification,
  cleanupExpired,
  notifyExpiring,
  cancelNotification,
  findByPayload,
  NOTIFICATION_TYPES
};
