/**
 * Clan System API Routes
 * Handles clan creation, membership, invites, and messaging
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import * as clanService from '../services/clanService.js';
import { parseIdParam, parseLimit } from '../utils/parseParams.js';
import { validateDisplayName, validateFreeText } from '../utils/nameValidation.js';
import {
  clanCreateLimiter,
  clanInviteLimiter,
  clanMessageLimiter,
  clanManageLimiter
} from '../middleware/socialRateLimiter.js';

const router = express.Router();

/**
 * GET /api/clans
 * List all clans with optional search
 * Query params:
 *   - q: search query (optional)
 *   - limit: max results (default 20, max 50)
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { q, limit = '20' } = req.query;
  const parsedLimit = parseLimit(limit, 20, 50);

  const clans = await clanService.listClans(q?.trim(), parsedLimit);

  res.json({
    success: true,
    clans
  });
}));

/**
 * POST /api/clans
 * Create a new clan
 */
router.post('/', authenticate, clanCreateLimiter, asyncHandler(async (req, res) => {
  const { name, tag, description } = req.body;

  // Validate clan name with proper charset validation
  const validatedName = validateDisplayName(name, { label: 'Clan name', min: 3, max: 32 });

  // Validate tag type before calling methods on it
  if (tag === undefined || tag === null) {
    throw new AppError('Clan tag is required', 400);
  }
  if (typeof tag !== 'string') {
    throw new AppError('Clan tag must be a string', 400);
  }

  const trimmedTag = tag.trim();
  if (trimmedTag.length < 2 || trimmedTag.length > 6) {
    throw new AppError('Clan tag must be 2-6 characters', 400);
  }

  // Validate tag is alphanumeric
  if (!/^[A-Za-z0-9]+$/.test(trimmedTag)) {
    throw new AppError('Clan tag must be alphanumeric', 400);
  }

  // Validate description with free-text validation (optional, max 256)
  const validatedDescription = validateFreeText(description, { label: 'Clan description', max: 256, optional: true });

  try {
    const clan = await clanService.createClan(req.user.userId, {
      name: validatedName,
      tag: trimmedTag.toUpperCase(),
      description: validatedDescription
    });

    res.status(201).json({
      success: true,
      message: 'Clan created',
      clan
    });
  } catch (error) {
    if (error.statusCode) {
      throw error; // Already an AppError
    }
    if (error.message.includes('already')) {
      throw new AppError(error.message, 400);
    }
    throw error;
  }
}));

/**
 * GET /api/clans/my
 * Get the authenticated user's clan
 */
router.get('/my', authenticate, asyncHandler(async (req, res) => {
  const clan = await clanService.getUserClan(req.user.userId);

  res.json({
    success: true,
    clan // null if not in a clan
  });
}));

/**
 * GET /api/clans/invites
 * Get pending clan invites for the authenticated user
 */
router.get('/invites', authenticate, asyncHandler(async (req, res) => {
  const invites = await clanService.getPendingInvites(req.user.userId);

  res.json({
    success: true,
    invites
  });
}));

/**
 * GET /api/clans/:id
 * Get clan details and members
 */
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const clanId = parseIdParam(req.params.id, 'clan ID');


  const clan = await clanService.getClanDetails(clanId);

  if (!clan) {
    throw new AppError('Clan not found', 404);
  }

  res.json({
    success: true,
    clan
  });
}));

/**
 * POST /api/clans/:id/leave
 * Leave the current clan
 */
router.post('/:id/leave', authenticate, clanManageLimiter, asyncHandler(async (req, res) => {
  const clanId = parseIdParam(req.params.id, 'clan ID');


  try {
    await clanService.leaveClan(req.user.userId, clanId);

    res.json({
      success: true,
      message: 'Left clan successfully'
    });
  } catch (error) {
    if (error.message.includes('not a member')) {
      throw new AppError(error.message, 400);
    }
    if (error.message.includes('leader')) {
      throw new AppError(error.message, 400);
    }
    throw error;
  }
}));

/**
 * DELETE /api/clans/:id
 * Disband a clan (leader only)
 */
router.delete('/:id', authenticate, clanManageLimiter, asyncHandler(async (req, res) => {
  const clanId = parseIdParam(req.params.id, 'clan ID');


  try {
    await clanService.disbandClan(req.user.userId, clanId);

    res.json({
      success: true,
      message: 'Clan disbanded'
    });
  } catch (error) {
    if (error.message.includes('not the leader')) {
      throw new AppError(error.message, 403);
    }
    if (error.message.includes('not found')) {
      throw new AppError(error.message, 404);
    }
    throw error;
  }
}));

/**
 * POST /api/clans/:id/invite/:username
 * Invite a player to the clan
 */
router.post('/:id/invite/:username', authenticate, clanInviteLimiter, asyncHandler(async (req, res) => {
  const clanId = parseIdParam(req.params.id, 'clan ID');
  const { username } = req.params;


  if (!username || username.trim().length === 0) {
    throw new AppError('Username is required', 400);
  }

  try {
    const invite = await clanService.invitePlayer(req.user.userId, clanId, username.trim());

    res.status(201).json({
      success: true,
      message: 'Invite sent',
      invite
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      throw new AppError(error.message, 404);
    }
    if (error.message.includes('not a member') || error.message.includes('already')) {
      throw new AppError(error.message, 400);
    }
    throw error;
  }
}));

/**
 * POST /api/clans/invite/:inviteId/accept
 * Accept a clan invite
 */
router.post('/invite/:inviteId/accept', authenticate, clanManageLimiter, asyncHandler(async (req, res) => {
  const inviteId = parseIdParam(req.params.inviteId, 'invite ID');


  try {
    const membership = await clanService.acceptInvite(req.user.userId, inviteId);

    res.json({
      success: true,
      message: 'Joined clan',
      membership
    });
  } catch (error) {
    // Service now throws AppError with proper status codes
    if (error.statusCode) {
      throw error;
    }
    // Fallback for any legacy errors
    if (error.message.includes('not found') || error.message.includes('expired')) {
      throw new AppError(error.message, 404);
    }
    if (error.message.includes('already in a clan')) {
      throw new AppError(error.message, 400);
    }
    throw error;
  }
}));

/**
 * POST /api/clans/:id/transfer
 * Transfer clan leadership to another member (leader only)
 */
router.post('/:id/transfer', authenticate, clanManageLimiter, asyncHandler(async (req, res) => {
  const clanId = parseIdParam(req.params.id, 'clan ID');
  const { userId: targetUserId } = req.body;


  const parsedTargetUserId = parseIdParam(targetUserId, 'target user ID');

  try {
    const result = await clanService.transferLeadership(req.user.userId, clanId, parsedTargetUserId);

    res.json({
      success: true,
      message: 'Leadership transferred',
      ...result
    });
  } catch (error) {
    if (error.statusCode) {
      throw error; // Already an AppError
    }
    throw error;
  }
}));

/**
 * POST /api/clans/invite/:inviteId/decline
 * Decline a clan invite
 */
router.post('/invite/:inviteId/decline', authenticate, clanManageLimiter, asyncHandler(async (req, res) => {
  const inviteId = parseIdParam(req.params.inviteId, 'invite ID');


  try {
    await clanService.declineInvite(req.user.userId, inviteId);

    res.json({
      success: true,
      message: 'Invite declined'
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      throw new AppError(error.message, 404);
    }
    throw error;
  }
}));

/**
 * GET /api/clans/:id/messages
 * Get recent clan chat messages
 * Query params:
 *   - limit: max messages (default 50, max 100)
 *   - before: message ID for pagination
 */
router.get('/:id/messages', authenticate, asyncHandler(async (req, res) => {
  const clanId = parseIdParam(req.params.id, 'clan ID');
  const { limit = '50', before } = req.query;

  const parsedLimit = parseLimit(limit, 50, 100);
  const beforeId = before ? parseIdParam(before, 'before') : null;

  try {
    const messages = await clanService.getClanMessages(
      req.user.userId,
      clanId,
      parsedLimit,
      beforeId
    );

    res.json({
      success: true,
      messages
    });
  } catch (error) {
    if (error.message.includes('not a member')) {
      throw new AppError(error.message, 403);
    }
    throw error;
  }
}));

/**
 * POST /api/clans/:id/messages
 * Send a clan chat message
 */
router.post('/:id/messages', authenticate, clanMessageLimiter, asyncHandler(async (req, res) => {
  const clanId = parseIdParam(req.params.id, 'clan ID');
  const { message } = req.body;


  // Type check before calling string methods (prevents TypeError on non-string input)
  if (typeof message !== 'string') {
    throw new AppError('Message is required', 400);
  }

  if (message.trim().length === 0) {
    throw new AppError('Message is required', 400);
  }

  if (message.length > 500) {
    throw new AppError('Message must be 500 characters or less', 400);
  }

  try {
    const chatMessage = await clanService.sendClanMessage(
      req.user.userId,
      clanId,
      message.trim()
    );

    res.status(201).json({
      success: true,
      message: chatMessage
    });
  } catch (error) {
    if (error.message.includes('not a member')) {
      throw new AppError(error.message, 403);
    }
    throw error;
  }
}));

export default router;
