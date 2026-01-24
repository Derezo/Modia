/**
 * Friend System API Routes
 * Handles friend requests, blocking, favorites, and player search
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import * as friendService from '../services/friendService.js';
import {
  friendRequestLimiter,
  friendActionLimiter,
  blockUserLimiter
} from '../middleware/socialRateLimiter.js';

const router = express.Router();

/**
 * GET /api/friends
 * Get all friends for the authenticated user with online status
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const friends = await friendService.getFriends(req.user.userId);

  res.json({
    success: true,
    friends
  });
}));

/**
 * GET /api/friends/requests
 * Get pending incoming friend requests
 */
router.get('/requests', authenticate, asyncHandler(async (req, res) => {
  const requests = await friendService.getPendingRequests(req.user.userId);

  res.json({
    success: true,
    requests
  });
}));

/**
 * GET /api/friends/blocked
 * Get list of blocked users
 */
router.get('/blocked', authenticate, asyncHandler(async (req, res) => {
  const blocked = await friendService.getBlockedUsers(req.user.userId);

  res.json({
    success: true,
    blocked
  });
}));

/**
 * POST /api/friends/request/:username
 * Send a friend request to a user by username
 */
router.post('/request/:username', authenticate, friendRequestLimiter, asyncHandler(async (req, res) => {
  const { username } = req.params;

  if (!username || username.trim().length === 0) {
    throw new AppError('Username is required', 400);
  }

  try {
    const request = await friendService.sendFriendRequest(req.user.userId, username.trim());

    res.status(201).json({
      success: true,
      message: 'Friend request sent',
      request
    });
  } catch (error) {
    // Convert service errors to appropriate HTTP errors
    if (error.message === 'User not found') {
      throw new AppError(error.message, 404);
    }
    if (error.message.includes('Cannot') || error.message.includes('already')) {
      throw new AppError(error.message, 400);
    }
    throw error;
  }
}));

/**
 * POST /api/friends/accept/:requestId
 * Accept a pending friend request
 */
router.post('/accept/:requestId', authenticate, friendActionLimiter, asyncHandler(async (req, res) => {
  const requestId = parseInt(req.params.requestId, 10);

  if (isNaN(requestId)) {
    throw new AppError('Invalid request ID', 400);
  }

  try {
    const friendship = await friendService.acceptRequest(requestId, req.user.userId);

    res.json({
      success: true,
      message: 'Friend request accepted',
      friendship
    });
  } catch (error) {
    if (error.message === 'Friend request not found') {
      throw new AppError(error.message, 404);
    }
    if (error.message.includes('cannot')) {
      throw new AppError(error.message, 403);
    }
    if (error.message.includes('no longer pending')) {
      throw new AppError(error.message, 400);
    }
    throw error;
  }
}));

/**
 * POST /api/friends/decline/:requestId
 * Decline a pending friend request
 */
router.post('/decline/:requestId', authenticate, friendActionLimiter, asyncHandler(async (req, res) => {
  const requestId = parseInt(req.params.requestId, 10);

  if (isNaN(requestId)) {
    throw new AppError('Invalid request ID', 400);
  }

  try {
    await friendService.declineRequest(requestId, req.user.userId);

    res.json({
      success: true,
      message: 'Friend request declined'
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      throw new AppError(error.message, 404);
    }
    throw error;
  }
}));

/**
 * DELETE /api/friends/:friendId
 * Remove a friend (unfriend)
 */
router.delete('/:friendId', authenticate, friendActionLimiter, asyncHandler(async (req, res) => {
  const friendId = parseInt(req.params.friendId, 10);

  if (isNaN(friendId)) {
    throw new AppError('Invalid friend ID', 400);
  }

  try {
    await friendService.unfriend(req.user.userId, friendId);

    res.json({
      success: true,
      message: 'Friend removed'
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      throw new AppError(error.message, 404);
    }
    throw error;
  }
}));

/**
 * POST /api/friends/:friendId/block
 * Block a user
 */
router.post('/:friendId/block', authenticate, blockUserLimiter, asyncHandler(async (req, res) => {
  const blockedId = parseInt(req.params.friendId, 10);

  if (isNaN(blockedId)) {
    throw new AppError('Invalid user ID', 400);
  }

  try {
    const block = await friendService.blockUser(req.user.userId, blockedId);

    res.json({
      success: true,
      message: 'User blocked',
      block
    });
  } catch (error) {
    if (error.message.includes('yourself')) {
      throw new AppError(error.message, 400);
    }
    throw error;
  }
}));

/**
 * DELETE /api/friends/:friendId/block
 * Unblock a user
 */
router.delete('/:friendId/block', authenticate, blockUserLimiter, asyncHandler(async (req, res) => {
  const blockedId = parseInt(req.params.friendId, 10);

  if (isNaN(blockedId)) {
    throw new AppError('Invalid user ID', 400);
  }

  try {
    await friendService.unblockUser(req.user.userId, blockedId);

    res.json({
      success: true,
      message: 'User unblocked'
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      throw new AppError(error.message, 404);
    }
    throw error;
  }
}));

/**
 * PUT /api/friends/:friendId
 * Update friend metadata (favorite status, note)
 */
router.put('/:friendId', authenticate, asyncHandler(async (req, res) => {
  const friendId = parseInt(req.params.friendId, 10);

  if (isNaN(friendId)) {
    throw new AppError('Invalid friend ID', 400);
  }

  const { isFavorite, note } = req.body;

  // Validate input
  if (isFavorite === undefined && note === undefined) {
    throw new AppError('At least one of isFavorite or note must be provided', 400);
  }

  if (isFavorite !== undefined && typeof isFavorite !== 'boolean') {
    throw new AppError('isFavorite must be a boolean', 400);
  }

  if (note !== undefined && note !== null && typeof note !== 'string') {
    throw new AppError('note must be a string or null', 400);
  }

  try {
    const friendship = await friendService.updateFriend(req.user.userId, friendId, {
      isFavorite,
      note
    });

    res.json({
      success: true,
      message: 'Friend updated',
      friendship
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      throw new AppError(error.message, 404);
    }
    if (error.message.includes('No updates')) {
      throw new AppError(error.message, 400);
    }
    throw error;
  }
}));

/**
 * GET /api/players/search
 * Search for players by username
 * Query params:
 *   - q: search query (min 2 characters)
 *   - limit: max results (default 20, max 50)
 */
router.get('/search', authenticate, asyncHandler(async (req, res) => {
  const { q, limit = '20' } = req.query;

  if (!q || q.trim().length < 2) {
    throw new AppError('Search query must be at least 2 characters', 400);
  }

  const parsedLimit = Math.min(parseInt(limit, 10) || 20, 50);

  try {
    const players = await friendService.searchPlayers(q.trim(), req.user.userId, parsedLimit);

    res.json({
      success: true,
      players
    });
  } catch (error) {
    if (error.message.includes('at least')) {
      throw new AppError(error.message, 400);
    }
    throw error;
  }
}));

export default router;
