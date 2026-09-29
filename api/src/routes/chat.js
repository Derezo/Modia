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
  const validRoomTypes = ['global', 'party', 'local'];
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

  // For local chat, optionally filter by nodeId
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
  const { limit = 20 } = req.query;

  const conversations = await chatService.getRecentDMConversations(
    req.user.userId,
    Math.min(parseInt(limit, 10) || 20, 50)
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

  // Validate emoji string type and length
  if (typeof emoji !== 'string' || emoji.length > 32) {
    throw new AppError('Invalid emoji format', 400);
  }

  // Validate emoji format - allow common emoji patterns or shortcodes
  // Unicode emoji (including ZWJ sequences and variation selectors)
  const emojiRegex = /^(?:[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]|\u{FE0F}|\u{200D})+$/u;
  // Shortcode format like :smile: or :thumbs_up:
  const shortcodeRegex = /^:[a-z_]{1,30}:$/;

  if (!emojiRegex.test(emoji) && !shortcodeRegex.test(emoji)) {
    throw new AppError('Invalid emoji format', 400);
  }

  // Verify message exists
  const message = await chatService.getMessageById(messageId);
  if (!message) {
    throw new AppError('Message not found', 404);
  }

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
 * Get online players
 */
router.get('/online', authenticate, asyncHandler(async (req, res) => {
  const { nodeId, limit = 100 } = req.query;

  const players = await presenceService.getOnlinePlayers({
    nodeId: nodeId ? parseInt(nodeId, 10) : null,
    limit: Math.min(parseInt(limit, 10) || 100, 200)
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

  // Validate customMessage - must be string, null, or undefined
  // undefined = no change, null or '' = clear, string = set
  let normalizedMessage;
  if (customMessage === undefined) {
    normalizedMessage = undefined; // no change
  } else if (customMessage === null || customMessage === '') {
    normalizedMessage = null; // clear
  } else if (typeof customMessage !== 'string') {
    throw new AppError('customMessage must be a string', 400);
  } else if (customMessage.length > 128) {
    throw new AppError('Custom message must be 128 characters or less', 400);
  } else {
    normalizedMessage = customMessage.trim();
    if (normalizedMessage === '') {
      normalizedMessage = null; // clear if only whitespace
    }
  }

  const presence = await presenceService.setPresence(
    req.user.userId,
    status || 'online',
    { customMessage: normalizedMessage }
  );

  res.json({ presence });
}));

/**
 * GET /api/chat/presence/:userId
 * Get a specific user's presence
 */
router.get('/presence/:userId', authenticate, asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const presence = await presenceService.getPresence(parseInt(userId, 10));

  if (!presence) {
    throw new AppError('User presence not found', 404);
  }

  res.json({ presence });
}));

export default router;
