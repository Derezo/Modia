/**
 * Quest Routes - Daily/Weekly Quest System API
 *
 * Provides endpoints for:
 * - Getting assigned daily/weekly quests
 * - Getting quest markers for world map nodes
 * - Claiming quest rewards (single or all)
 * - Streak information
 * - First Blood and Perfect Week leaderboards
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { questReadLimiter, questClaimLimiter, questRefreshLimiter } from '../middleware/gameplayRateLimiter.js';
import * as dailyQuestService from '../services/dailyQuestService.js';
import { parseIntOrThrow } from '../utils/validateNumericParam.js';

const router = express.Router();

// ============================================
// QUEST RETRIEVAL
// ============================================

/**
 * GET /api/quests/daily/:characterId
 * Get daily quests for a character with streak info
 */
router.get('/daily/:characterId', authenticate, questReadLimiter, asyncHandler(async (req, res) => {
  const characterId = parseInt(req.params.characterId, 10);

  if (isNaN(characterId)) {
    throw new AppError('Invalid character ID', 400);
  }

  // Verify character ownership
  const { pool } = await import('../config/database.js');
  const charResult = await pool.query(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  // Refresh quests if needed
  const refreshResult = await dailyQuestService.refreshQuestsIfNeeded(characterId);

  // Get daily quests with streak
  const result = await dailyQuestService.getDailyQuests(characterId);

  // Get Perfect Week progress
  const perfectWeek = await dailyQuestService.getPerfectWeekProgress(characterId);

  res.json({
    ...result,
    refreshed: refreshResult.dailyRefreshed,
    perfectWeek
  });
}));

/**
 * GET /api/quests/weekly/:characterId
 * Get weekly quests for a character
 */
router.get('/weekly/:characterId', authenticate, questReadLimiter, asyncHandler(async (req, res) => {
  const characterId = parseInt(req.params.characterId, 10);

  if (isNaN(characterId)) {
    throw new AppError('Invalid character ID', 400);
  }

  // Verify character ownership
  const { pool } = await import('../config/database.js');
  const charResult = await pool.query(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  // Refresh quests if needed
  const refreshResult = await dailyQuestService.refreshQuestsIfNeeded(characterId);

  // Get weekly quests
  const result = await dailyQuestService.getWeeklyQuests(characterId);

  res.json({
    ...result,
    refreshed: refreshResult.weeklyRefreshed
  });
}));

/**
 * GET /api/quests/markers/:characterId
 * Get world node markers for active quests
 * Returns nodes that are relevant to the character's uncompleted quests
 */
router.get('/markers/:characterId', authenticate, questReadLimiter, asyncHandler(async (req, res) => {
  const characterId = parseInt(req.params.characterId, 10);

  if (isNaN(characterId)) {
    throw new AppError('Invalid character ID', 400);
  }

  // Verify character ownership
  const { pool } = await import('../config/database.js');
  const charResult = await pool.query(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  // Get quest-relevant nodes
  const nodeQuestMap = await dailyQuestService.getQuestRelevantNodes(characterId);

  // Convert Map to array format for JSON response
  const markers = [];
  for (const [nodeId, quests] of nodeQuestMap) {
    markers.push({
      nodeId,
      quests
    });
  }

  res.json({ markers });
}));

/**
 * POST /api/quests/refresh/:characterId
 * Force refresh quests for a character (for testing/admin)
 */
router.post('/refresh/:characterId', authenticate, questRefreshLimiter, asyncHandler(async (req, res) => {
  const characterId = parseInt(req.params.characterId, 10);

  if (isNaN(characterId)) {
    throw new AppError('Invalid character ID', 400);
  }

  // Verify character ownership
  const { pool } = await import('../config/database.js');
  const charResult = await pool.query(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  const result = await dailyQuestService.refreshQuestsIfNeeded(characterId);

  res.json({
    success: true,
    dailyRefreshed: result.dailyRefreshed,
    weeklyRefreshed: result.weeklyRefreshed,
    dailyQuests: result.dailyQuests,
    weeklyQuests: result.weeklyQuests
  });
}));

// ============================================
// REWARD CLAIMING
// ============================================

/**
 * POST /api/quests/:questId/claim
 * Claim reward for a single quest
 */
router.post('/:questId/claim', authenticate, questClaimLimiter, asyncHandler(async (req, res) => {
  const questId = parseInt(req.params.questId, 10);
  const { characterId } = req.body;

  if (isNaN(questId)) {
    throw new AppError('Invalid quest ID', 400);
  }

  const parsedCharacterId = parseIntOrThrow(characterId, 'character ID');

  // Verify character ownership
  const { pool } = await import('../config/database.js');
  const charResult = await pool.query(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [parsedCharacterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  const reward = await dailyQuestService.claimReward(questId, parsedCharacterId);

  // Finding 39: Check and grant completion bonus after single quest claims too
  // grantCompletionBonus is idempotent (checks character_completion_bonuses table)
  let completionBonus = null;
  try {
    completionBonus = await dailyQuestService.grantCompletionBonus(parsedCharacterId);
  } catch (err) {
    console.warn('[Quest] Completion bonus check failed:', err.message);
  }

  // Get updated user gold (after potential completion bonus)
  const goldResult = await pool.query(
    'SELECT gold FROM users WHERE id = $1',
    [req.user.userId]
  );

  res.json({
    success: true,
    reward,
    completionBonus,
    newGold: goldResult.rows[0].gold
  });
}));

/**
 * POST /api/quests/claim-all
 * Claim all completed quest rewards
 */
router.post('/claim-all', authenticate, questClaimLimiter, asyncHandler(async (req, res) => {
  const { characterId } = req.body;
  const parsedCharacterId = parseIntOrThrow(characterId, 'character ID');

  // Verify character ownership
  const { pool } = await import('../config/database.js');
  const charResult = await pool.query(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [parsedCharacterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  const result = await dailyQuestService.claimAllRewards(parsedCharacterId);

  // Get updated user gold
  const goldResult = await pool.query(
    'SELECT gold FROM users WHERE id = $1',
    [req.user.userId]
  );

  res.json({
    success: true,
    ...result,
    newGold: goldResult.rows[0].gold
  });
}));

// ============================================
// STREAK INFORMATION
// ============================================

/**
 * GET /api/quests/streaks/:characterId
 * Get streak information for a character
 */
router.get('/streaks/:characterId', authenticate, questReadLimiter, asyncHandler(async (req, res) => {
  const characterId = parseInt(req.params.characterId, 10);

  if (isNaN(characterId)) {
    throw new AppError('Invalid character ID', 400);
  }

  // Verify character ownership
  const { pool } = await import('../config/database.js');
  const charResult = await pool.query(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  const streak = await dailyQuestService.getStreakInfo(characterId);
  const perfectWeek = await dailyQuestService.getPerfectWeekProgress(characterId);

  res.json({
    ...streak,
    perfectWeek
  });
}));

// ============================================
// LEADERBOARDS
// ============================================

/**
 * GET /api/quests/first-blood
 * Get today's First Blood winners
 */
router.get('/first-blood', authenticate, questReadLimiter, asyncHandler(async (req, res) => {
  const winners = await dailyQuestService.getFirstBloodWinners();

  res.json({
    winners,
    date: new Date().toISOString().split('T')[0]
  });
}));

/**
 * GET /api/quests/champions
 * Get Perfect Week champions leaderboard
 */
router.get('/champions', authenticate, questReadLimiter, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  const champions = await dailyQuestService.getPerfectWeekChampions(limit);

  res.json({
    champions
  });
}));

export default router;
