import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { chatReactionLimiter, presenceUpdateLimiter } from '../middleware/socialRateLimiter.js';
import chatService from '../services/chatService.js';
import presenceService from '../services/presenceService.js';
import { query } from '../config/database.js';
import { parseIdParam, parseDateParam, parseLimit } from '../utils/parseParams.js';

const router = express.Router();

/**
 * GET /api/chat/history/:roomType
 * Get chat history for a room type
 */
router.get('/history/:roomType', authenticate, asyncHandler(async (req, res) => {
  const { roomType } = req.params;
  const { before, limit = 50, nodeId, partyId } = req.query;

  // Validate room type
  const validRoomTypes = ['global', 'party'];
  if (!validRoomTypes.includes(roomType)) {
    throw new AppError('Invalid room type', 400);
  }

  // Parse and validate params
  const parsedBefore = parseDateParam(before, 'before');
  const parsedLimit = parseLimit(limit, 50, 100);

  // For party chat, require partyId and verify membership
  if (roomType === 'party') {
    if (!partyId) {
      throw new AppError('partyId is required for party chat history', 400);
    }
    const parsedPartyId = parseIdParam(partyId, 'partyId');

    // Verify user is a member of this party
    const memberCheck = await query(
      'SELECT 1 FROM party_members WHERE party_id = $1 AND user_id = $2',
      [parsedPartyId, req.user.userId]
    );

    if (memberCheck.rows.length === 0) {
      throw new AppError('Access denied', 403);
    }

    const messages = await chatService.getHistory(roomType, {
      before: parsedBefore,
      limit: parsedLimit,
      nodeId: null,
      partyId: parsedPartyId
    });

    return res.json({ messages });
  }

  // Global chat, optionally narrowed to one node's local messages
  const parsedNodeId = nodeId ? parseIdParam(nodeId, 'nodeId') : null;

  const messages = await chatService.getHistory(roomType, {
    before: parsedBefore,
    limit: parsedLimit,
    nodeId: parsedNodeId,
    partyId: null
  });

  res.json({ messages });
}));

/**
 * GET /api/chat/dm/:targetUserId
 * Get DM history with a specific user
 */
router.get('/dm/:targetUserId', authenticate, asyncHandler(async (req, res) => {
  const targetId = parseIdParam(req.params.targetUserId, 'target user ID');
  const { before, limit = 50 } = req.query;

  const parsedBefore = parseDateParam(before, 'before');
  const parsedLimit = parseLimit(limit, 50, 100);

  const messages = await chatService.getDMHistory(req.user.userId, targetId, {
    before: parsedBefore,
    limit: parsedLimit
  });

  res.json({ messages });
}));

/**
 * GET /api/chat/conversations
 * Get recent DM conversations for current user
 */
router.get('/conversations', authenticate, asyncHandler(async (req, res) => {
  const conversations = await chatService.getRecentDMConversations(
    req.user.userId,
    parseLimit(req.query.limit, 20, 50)
  );

  res.json({ conversations });
}));

/**
 * POST /api/chat/reaction
 * Add a reaction to a message
 */
router.post('/reaction', authenticate, chatReactionLimiter, asyncHandler(async (req, res) => {
  const { messageId, emoji } = req.body;

  if (!messageId || !emoji) {
    throw new AppError('Message ID and emoji are required', 400);
  }

  // Emoji format and message visibility are enforced in chatService so the
  // WebSocket path gets the same rules.
  const result = await chatService.addReaction(messageId, req.user.userId, emoji);

  res.json(result);
}));

/**
 * DELETE /api/chat/reaction
 * Remove a reaction from a message
 */
router.delete('/reaction', authenticate, chatReactionLimiter, asyncHandler(async (req, res) => {
  const { messageId, emoji } = req.body;

  if (!messageId || !emoji) {
    throw new AppError('Message ID and emoji are required', 400);
  }

  const result = await chatService.removeReaction(messageId, req.user.userId, emoji);

  res.json(result);
}));

/**
 * GET /api/chat/online
 * Get online players (excludes those with showOnlineStatus=false)
 */
router.get('/online', authenticate, asyncHandler(async (req, res) => {
  const { nodeId, limit } = req.query;

  const players = await presenceService.getOnlinePlayersWithPrivacy({
    nodeId: nodeId ? parseIdParam(nodeId, 'nodeId') : null,
    limit: parseLimit(limit, 100, 200),
    requesterId: req.user.userId // Ensure requester always sees themselves
  });

  res.json({ players });
}));

/**
 * PUT /api/chat/presence
 * Update current user's presence status
 */
router.put('/presence', authenticate, presenceUpdateLimiter, asyncHandler(async (req, res) => {
  const { status, customMessage } = req.body;

  const validStatuses = ['online', 'away', 'busy'];
  if (status && !validStatuses.includes(status)) {
    throw new AppError('Invalid status. Must be: online, away, or busy', 400);
  }

  // undefined = no change, null / '' / whitespace = clear, string = set
  const normalizedMessage = presenceService.normalizeCustomMessage(customMessage);

  const presence = await presenceService.setPresence(
    req.user.userId,
    status || 'online',
    { customMessage: normalizedMessage }
  );

  res.json({ presence });
}));

/**
 * GET /api/chat/presence/:userId
 * Get a specific user's presence (respects showOnlineStatus privacy)
 */
router.get('/presence/:userId', authenticate, asyncHandler(async (req, res) => {
  const targetUserId = parseIdParam(req.params.userId, 'userId');

  // Users can always see their own presence
  if (targetUserId === req.user.userId) {
    const presence = await presenceService.getPresence(targetUserId);
    if (!presence) {
      throw new AppError('User presence not found', 404);
    }
    return res.json({ presence });
  }

  // Check underlying presence first - 404 if no record exists
  const rawPresence = await presenceService.getPresence(targetUserId);
  if (!rawPresence) {
    throw new AppError('User presence not found', 404);
  }

  // Return privacy-masked presence for other users
  const presence = await presenceService.getPresenceWithPrivacy(targetUserId);
  res.json({ presence });
}));

export default router;
