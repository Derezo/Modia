import { createHash, timingSafeEqual } from 'node:crypto';

import express from 'express';

import {
  getBattleMapOperationalDiagnostics,
  getBattleMapOperationalMetrics
} from '../services/battle/BattleMapOperations.js';

export const BATTLE_MAP_DIAGNOSTICS_TOKEN_ENV =
  'BATTLE_MAP_DIAGNOSTICS_TOKEN';

const MINIMUM_TOKEN_BYTES = 32;

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function bearerToken(authorization) {
  if (typeof authorization !== 'string') return null;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1] ?? null;
}

/**
 * Protect seed/hash-level diagnostics with a separate operator credential.
 * Player JWTs are intentionally insufficient, and an absent or undersized
 * operator token makes the route unavailable.
 */
export function requireBattleMapDiagnosticsToken(req, res, next) {
  const configuredToken =
    process.env[BATTLE_MAP_DIAGNOSTICS_TOKEN_ENV]?.trim() ?? '';
  if (Buffer.byteLength(configuredToken, 'utf8') < MINIMUM_TOKEN_BYTES) {
    return res.status(404).json({ error: 'Not found' });
  }

  const suppliedToken = bearerToken(req.headers.authorization);
  if (!suppliedToken) {
    return res.status(401).json({ error: 'Operator token required' });
  }

  if (!timingSafeEqual(digest(suppliedToken), digest(configuredToken))) {
    return res.status(403).json({ error: 'Invalid operator token' });
  }

  next();
}

const router = express.Router();

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
router.use(requireBattleMapDiagnosticsToken);

/**
 * GET /api/operations/battle-maps/diagnostics
 * Bounded seed/hash diagnostics for production incident triage.
 */
router.get('/diagnostics', (_req, res) => {
  res.json({
    timestamp: new Date().toISOString(),
    metrics: getBattleMapOperationalMetrics(),
    diagnostics: getBattleMapOperationalDiagnostics()
  });
});

export default router;
