/**
 * User Feedback Routes
 * Allows players to submit enhancement requests, bug reports, and abuse reports
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';
import { createLimiter } from '../middleware/rateLimiterFactory.js';
import {
  submitFeedback,
  getUserFeedback
} from '../services/feedbackService.js';

const router = express.Router();

// Rate limiter for feedback submission - 10 requests per 15 minutes per user
// Feedback should be infrequent; this prevents spam abuse
const feedbackLimiter = createLimiter({
  name: 'feedback:submit',
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 10,           // Base: 10, Prod: 20, Dev: 50
  message: 'Too many feedback submissions. Please wait before submitting more.',
  useUserKey: true           // Per-user limiting (authenticated endpoint)
});

/**
 * POST /api/feedback
 * Submit user feedback
 *
 * Body:
 * - feedbackType: 'enhancement' | 'bug' | 'abuse'
 * - title: string (max 200 chars)
 * - description: string (max 2000 chars)
 * - characterId?: number (optional, for context)
 * - gameContext?: object (optional, scene/node/battle info)
 * - reportedCharacterName?: string (for abuse reports)
 */
router.post('/', authenticate, feedbackLimiter, asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  try {
    const feedback = await submitFeedback(userId, req.body, req);
    res.status(201).json({
      message: 'Feedback submitted successfully',
      feedback
    });
  } catch (error) {
    throw new AppError(error.message, 400);
  }
}));

/**
 * GET /api/feedback/my
 * Get current user's feedback submissions
 *
 * Query params:
 * - limit: number (default 20)
 * - offset: number (default 0)
 */
router.get('/my', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = parseInt(req.query.offset) || 0;

  const feedback = await getUserFeedback(userId, { limit, offset });

  res.json({ feedback });
}));

export default router;
