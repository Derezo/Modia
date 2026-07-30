/**
 * Fishing Routes - Idle/passive fishing at fishing_spot nodes
 *
 * Players can start fishing sessions and periodically catch fish.
 * "Big One" events occasionally occur for bonus catches.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  startSession,
  registerCatch,
  claimBigOne,
  endSession,
  getActiveSessionStatus,
  getSessionStatus
} from '../services/fishingService.js';

const router = Router();

/**
 * GET /fishing/status
 * Find the user's active session so the client can restore it after refresh.
 */
router.get('/status', authenticate, asyncHandler(async (req, res) => {
  const status = await getActiveSessionStatus(req.user.userId);
  res.json(status || { active: false });
}));

/**
 * POST /fishing/:nodeId/start
 * Start a new fishing session
 */
router.post('/:nodeId/start', authenticate, asyncHandler(async (req, res) => {
  const { nodeId } = req.params;
  const userId = req.user.userId;

  const result = await startSession(userId, parseInt(nodeId, 10));
  res.json(result);
}));

/**
 * POST /fishing/:nodeId/catch
 * Register a catch (called by client timer)
 */
router.post('/:nodeId/catch', authenticate, asyncHandler(async (req, res) => {
  const { nodeId } = req.params;
  const { sessionId } = req.body || {};
  const userId = req.user.userId;

  const result = await registerCatch(userId, parseInt(nodeId, 10), sessionId);
  res.json(result);
}));

/**
 * POST /fishing/:nodeId/big-one
 * Claim a Big One event catch
 */
router.post('/:nodeId/big-one', authenticate, asyncHandler(async (req, res) => {
  const { nodeId } = req.params;
  const { sessionId } = req.body || {};
  const userId = req.user.userId;

  const result = await claimBigOne(userId, parseInt(nodeId, 10), sessionId);
  res.json(result);
}));

/**
 * POST /fishing/:nodeId/end
 * End fishing session and collect rewards
 */
router.post('/:nodeId/end', authenticate, asyncHandler(async (req, res) => {
  const { nodeId } = req.params;
  const { sessionId } = req.body || {};
  const userId = req.user.userId;

  const result = await endSession(userId, parseInt(nodeId, 10), sessionId);
  res.json(result);
}));

/**
 * GET /fishing/:nodeId/status
 * Get current session status
 */
router.get('/:nodeId/status', authenticate, asyncHandler(async (req, res) => {
  const { nodeId } = req.params;
  const userId = req.user.userId;

  const status = await getSessionStatus(userId, parseInt(nodeId, 10));

  if (!status) {
    res.json({ active: false });
  } else {
    res.json(status);
  }
}));

export default router;
