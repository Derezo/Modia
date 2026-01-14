/**
 * Fishing Routes - Idle/passive fishing at fishing_spot nodes
 *
 * Players can start fishing sessions and periodically catch fish.
 * "Big One" events occasionally occur for bonus catches.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  startSession,
  registerCatch,
  claimBigOne,
  endSession,
  getSessionStatus
} from '../services/fishingService.js';

const router = Router();

/**
 * POST /fishing/:nodeId/start
 * Start a new fishing session
 */
router.post('/:nodeId/start', authenticate, async (req, res) => {
  const { nodeId } = req.params;
  const userId = req.user.userId;

  try {
    const result = await startSession(userId, parseInt(nodeId, 10));
    res.json(result);
  } catch (err) {
    console.error('Error starting fishing session:', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /fishing/:nodeId/catch
 * Register a catch (called by client timer)
 */
router.post('/:nodeId/catch', authenticate, async (req, res) => {
  const { nodeId } = req.params;
  const userId = req.user.userId;

  try {
    const result = await registerCatch(userId, parseInt(nodeId, 10));
    res.json(result);
  } catch (err) {
    console.error('Error registering catch:', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /fishing/:nodeId/big-one
 * Claim a Big One event catch
 */
router.post('/:nodeId/big-one', authenticate, async (req, res) => {
  const { nodeId } = req.params;
  const userId = req.user.userId;

  try {
    const result = await claimBigOne(userId, parseInt(nodeId, 10));
    res.json(result);
  } catch (err) {
    console.error('Error claiming big one:', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /fishing/:nodeId/end
 * End fishing session and collect rewards
 */
router.post('/:nodeId/end', authenticate, async (req, res) => {
  const { nodeId } = req.params;
  const userId = req.user.userId;

  try {
    const result = await endSession(userId, parseInt(nodeId, 10));
    res.json(result);
  } catch (err) {
    console.error('Error ending fishing session:', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /fishing/:nodeId/status
 * Get current session status
 */
router.get('/:nodeId/status', authenticate, (req, res) => {
  const { nodeId } = req.params;
  const userId = req.user.userId;

  const status = getSessionStatus(userId, parseInt(nodeId, 10));

  if (!status) {
    res.json({ active: false });
  } else {
    res.json(status);
  }
});

export default router;
