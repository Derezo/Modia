/**
 * Relics Routes - Account-wide collectibles that unlock premium features
 *
 * GET /api/relics - List all relics with ownership status
 * GET /api/relics/owned - Get user's owned relics
 * POST /api/relics/:id/claim - Claim a relic (validates requirements)
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { relicClaimLimiter } from '../middleware/economyRateLimiter.js';
import * as relicService from '../services/relicService.js';

const router = express.Router();

// ============================================
// GET /api/relics - List all available relics
// ============================================
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const relics = await relicService.getAllRelics(req.user.userId);

  res.json({
    success: true,
    relics
  });
}));

// ============================================
// GET /api/relics/owned - Get user's owned relics
// ============================================
router.get('/owned', authenticate, asyncHandler(async (req, res) => {
  const relics = await relicService.getOwnedRelics(req.user.userId);

  res.json({
    success: true,
    relics,
    count: relics.length
  });
}));

// ============================================
// GET /api/relics/check/:key - Check if user owns a specific relic
// ============================================
router.get('/check/:key', authenticate, asyncHandler(async (req, res) => {
  const { key } = req.params;

  const hasRelic = await relicService.hasRelic(req.user.userId, key);
  const effects = hasRelic ? await relicService.getRelicEffects(req.user.userId, key) : null;

  res.json({
    success: true,
    relicKey: key,
    owned: hasRelic,
    effects
  });
}));

// ============================================
// POST /api/relics/:id/claim - Claim a relic
// ============================================
router.post('/:id/claim', authenticate, relicClaimLimiter, asyncHandler(async (req, res) => {
  const relicId = parseInt(req.params.id, 10);

  if (isNaN(relicId)) {
    throw new AppError('Invalid relic ID', 400);
  }

  // Validation is now done server-side via DB lookups - no client context needed
  const result = await relicService.claimRelic(req.user.userId, relicId);

  if (!result.success) {
    throw new AppError(result.message, 400);
  }

  res.json(result);
}));

// ============================================
// POST /api/relics/grant/:key - Grant a relic (admin/quest reward)
// For use by quest completion handlers, achievements, etc.
// SECURITY: Only available in development mode
// ============================================
router.post('/grant/:key', authenticate, asyncHandler(async (req, res) => {
  const { key } = req.params;

  // Only allow in development - production grants should use internal service calls
  if (process.env.NODE_ENV === 'production') {
    throw new AppError('This endpoint is disabled in production', 403);
  }

  try {
    const result = await relicService.grantRelic(req.user.userId, key);

    res.json({
      success: true,
      message: result.alreadyOwned
        ? `You already own the ${result.name}`
        : `You have acquired the ${result.name}!`,
      relic: result
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Relic claim error:', err);
    throw new AppError('Failed to claim relic', 400);
  }
}));

export default router;
