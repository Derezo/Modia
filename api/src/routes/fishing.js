/**
 * Fishing routes.
 *
 * All mutations carry a UUID actionId and are protected by both the economy
 * limiter and the service's durable phase/idempotency checks.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { fishingLimiter } from '../middleware/economyRateLimiter.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import {
  endSession,
  getActiveSessionStatus,
  getSessionStatus,
  getSetup,
  hookBite,
  releaseCast,
  resolveAttempt,
  selectGear,
  startCast,
  startSession,
  submitReelCue
} from '../services/fishingService.js';

const router = Router();

function nodeIdFrom(req) {
  const nodeId = Number(req.params.nodeId);
  if (!Number.isSafeInteger(nodeId) || nodeId <= 0) {
    throw new AppError('Fishing node ID is invalid', 400);
  }
  return nodeId;
}

function bodyFrom(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

router.get('/status', authenticate, asyncHandler(async (req, res) => {
  const status = await getActiveSessionStatus(req.user.userId);
  res.json(status || { active: false, session: null });
}));

router.get('/:nodeId/setup', authenticate, asyncHandler(async (req, res) => {
  res.json(await getSetup(req.user.userId, nodeIdFrom(req)));
}));

router.post(
  '/:nodeId/start',
  authenticate,
  fishingLimiter,
  asyncHandler(async (req, res) => {
    res.json(await startSession(
      req.user.userId,
      nodeIdFrom(req),
      bodyFrom(req)
    ));
  })
);

router.post(
  '/:nodeId/gear',
  authenticate,
  fishingLimiter,
  asyncHandler(async (req, res) => {
    res.json(await selectGear(
      req.user.userId,
      nodeIdFrom(req),
      bodyFrom(req)
    ));
  })
);

router.post(
  '/:nodeId/cast',
  authenticate,
  fishingLimiter,
  asyncHandler(async (req, res) => {
    res.json(await startCast(
      req.user.userId,
      nodeIdFrom(req),
      bodyFrom(req)
    ));
  })
);

router.post(
  '/:nodeId/casts/:attemptId/release',
  authenticate,
  fishingLimiter,
  asyncHandler(async (req, res) => {
    res.json(await releaseCast(
      req.user.userId,
      nodeIdFrom(req),
      req.params.attemptId,
      bodyFrom(req)
    ));
  })
);

router.post(
  '/:nodeId/casts/:attemptId/hook',
  authenticate,
  fishingLimiter,
  asyncHandler(async (req, res) => {
    res.json(await hookBite(
      req.user.userId,
      nodeIdFrom(req),
      req.params.attemptId,
      bodyFrom(req)
    ));
  })
);

router.post(
  '/:nodeId/casts/:attemptId/reel',
  authenticate,
  fishingLimiter,
  asyncHandler(async (req, res) => {
    res.json(await submitReelCue(
      req.user.userId,
      nodeIdFrom(req),
      req.params.attemptId,
      bodyFrom(req)
    ));
  })
);

router.post(
  '/:nodeId/casts/:attemptId/resolve',
  authenticate,
  fishingLimiter,
  asyncHandler(async (req, res) => {
    res.json(await resolveAttempt(
      req.user.userId,
      nodeIdFrom(req),
      req.params.attemptId,
      bodyFrom(req)
    ));
  })
);

router.post(
  '/:nodeId/end',
  authenticate,
  fishingLimiter,
  asyncHandler(async (req, res) => {
    const body = bodyFrom(req);
    res.json(await endSession(
      req.user.userId,
      nodeIdFrom(req),
      body.sessionId,
      body
    ));
  })
);

router.get('/:nodeId/status', authenticate, asyncHandler(async (req, res) => {
  const status = await getSessionStatus(req.user.userId, nodeIdFrom(req));
  res.json(status || { active: false, session: null });
}));

const gone = asyncHandler(async (_req, _res) => {
  throw new AppError(
    'This legacy fishing endpoint is gone. Upgrade to the cast protocol.',
    410
  );
});

router.post('/:nodeId/catch', authenticate, fishingLimiter, gone);
router.post('/:nodeId/big-one', authenticate, fishingLimiter, gone);

export default router;
