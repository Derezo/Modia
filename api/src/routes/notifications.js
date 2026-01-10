/**
 * Notification API Routes
 * Handles notification retrieval and management
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import * as notificationService from '../services/notificationService.js';

const router = express.Router();

/**
 * GET /api/notifications
 * Get all notifications for the authenticated user
 * Query params:
 *   - includeRead: boolean (default false)
 *   - limit: number (default 50, max 100)
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { includeRead = 'false', limit = '50' } = req.query;
  const parsedLimit = Math.min(parseInt(limit, 10) || 50, 100);
  const shouldIncludeRead = includeRead === 'true';

  const notifications = await notificationService.getNotifications(
    req.user.userId,
    shouldIncludeRead,
    false, // Don't include dismissed
    parsedLimit
  );

  res.json({
    success: true,
    notifications
  });
}));

/**
 * GET /api/notifications/unread-count
 * Get the count of unread notifications (for badge display)
 */
router.get('/unread-count', authenticate, asyncHandler(async (req, res) => {
  const count = await notificationService.getUnreadCount(req.user.userId);

  res.json({
    success: true,
    count
  });
}));

/**
 * GET /api/notifications/:id
 * Get a specific notification
 */
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const notificationId = parseInt(req.params.id, 10);

  if (isNaN(notificationId)) {
    throw new AppError('Invalid notification ID', 400);
  }

  const notification = await notificationService.getNotification(
    notificationId,
    req.user.userId
  );

  if (!notification) {
    throw new AppError('Notification not found', 404);
  }

  res.json({
    success: true,
    notification
  });
}));

/**
 * POST /api/notifications/:id/read
 * Mark a notification as read
 */
router.post('/:id/read', authenticate, asyncHandler(async (req, res) => {
  const notificationId = parseInt(req.params.id, 10);

  if (isNaN(notificationId)) {
    throw new AppError('Invalid notification ID', 400);
  }

  const success = await notificationService.markAsRead(
    notificationId,
    req.user.userId
  );

  if (!success) {
    throw new AppError('Notification not found or already read', 404);
  }

  res.json({
    success: true,
    message: 'Notification marked as read'
  });
}));

/**
 * POST /api/notifications/read-all
 * Mark all notifications as read
 */
router.post('/read-all', authenticate, asyncHandler(async (req, res) => {
  const count = await notificationService.markAllAsRead(req.user.userId);

  res.json({
    success: true,
    message: `Marked ${count} notifications as read`,
    count
  });
}));

/**
 * DELETE /api/notifications/:id
 * Dismiss (hide) a notification
 */
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const notificationId = parseInt(req.params.id, 10);

  if (isNaN(notificationId)) {
    throw new AppError('Invalid notification ID', 400);
  }

  const success = await notificationService.dismissNotification(
    notificationId,
    req.user.userId
  );

  if (!success) {
    throw new AppError('Notification not found or already dismissed', 404);
  }

  res.json({
    success: true,
    message: 'Notification dismissed'
  });
}));

export default router;
