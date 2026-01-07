const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const chatService = require('../services/chatService');
const presenceService = require('../services/presenceService');

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

  const messages = await chatService.getHistory(roomType, {
    before: before ? new Date(before) : null,
    limit: Math.min(parseInt(limit) || 50, 100),
    nodeId: nodeId ? parseInt(nodeId) : null,
    partyId: partyId ? parseInt(partyId) : null
  });

  res.json({ messages });
}));

/**
 * GET /api/chat/dm/:targetUserId
 * Get DM history with a specific user
 */
router.get('/dm/:targetUserId', authenticate, asyncHandler(async (req, res) => {
  const { targetUserId } = req.params;
  const { before, limit = 50 } = req.query;

  const targetId = parseInt(targetUserId);
  if (isNaN(targetId)) {
    throw new AppError('Invalid target user ID', 400);
  }

  const messages = await chatService.getDMHistory(req.user.userId, targetId, {
    before: before ? new Date(before) : null,
    limit: Math.min(parseInt(limit) || 50, 100)
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
    Math.min(parseInt(limit) || 20, 50)
  );

  res.json({ conversations });
}));

/**
 * POST /api/chat/reaction
 * Add a reaction to a message
 */
router.post('/reaction', authenticate, asyncHandler(async (req, res) => {
  const { messageId, emoji } = req.body;

  if (!messageId || !emoji) {
    throw new AppError('Message ID and emoji are required', 400);
  }

  // Validate emoji (simple check - allow common emoji patterns)
  const emojiRegex = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]{1,2}$/u;
  const simpleEmoji = /^:[a-z_]+:$/;
  if (!emojiRegex.test(emoji) && !simpleEmoji.test(emoji) && emoji.length > 8) {
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
router.delete('/reaction', authenticate, asyncHandler(async (req, res) => {
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
    nodeId: nodeId ? parseInt(nodeId) : null,
    limit: Math.min(parseInt(limit) || 100, 200)
  });

  res.json({ players });
}));

/**
 * PUT /api/chat/presence
 * Update current user's presence status
 */
router.put('/presence', authenticate, asyncHandler(async (req, res) => {
  const { status, customMessage } = req.body;

  const validStatuses = ['online', 'away', 'busy'];
  if (status && !validStatuses.includes(status)) {
    throw new AppError('Invalid status. Must be: online, away, or busy', 400);
  }

  if (customMessage && customMessage.length > 128) {
    throw new AppError('Custom message must be 128 characters or less', 400);
  }

  const presence = await presenceService.setPresence(
    req.user.userId,
    status || 'online',
    { customMessage }
  );

  res.json({ presence });
}));

/**
 * GET /api/chat/presence/:userId
 * Get a specific user's presence
 */
router.get('/presence/:userId', authenticate, asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const presence = await presenceService.getPresence(parseInt(userId));

  if (!presence) {
    throw new AppError('User presence not found', 404);
  }

  res.json({ presence });
}));

module.exports = router;
