/**
 * Debug Routes - Developer tools for testing (non-production only)
 *
 * SECURITY: These endpoints are NEVER available in production, regardless of env vars.
 * They are only available when NODE_ENV is 'development' or 'test'.
 * They allow developers to bypass gameplay mechanics for faster testing.
 */

import express from 'express';
import { query } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { COMBAT_NODE_TYPES } from '../config/constants.js';
import * as traitService from '../services/traitService.js';
import { createLimiter } from '../middleware/rateLimiterFactory.js';
import { validateAndRepairDiscovery, checkDiscoveryHealth, batchRepairAllUsers } from '../services/world/discoveryValidationService.js';
import { winBattle } from '../services/debugService.js';

const router = express.Router();

// SECURITY: Debug mode is STRICTLY disabled in production
// NODE_ENV=production always disables debug endpoints, even if DEBUG=true
const isProduction = process.env.NODE_ENV === 'production';
const isDebugMode = !isProduction && (
  process.env.DEBUG === 'true' ||
  process.env.NODE_ENV === 'development' ||
  process.env.NODE_ENV === 'test'
);

// Rate limiter for debug endpoints (10 requests per minute per user)
// Allows reasonable debugging while preventing abuse
const debugRateLimiter = createLimiter({
  name: 'debug',
  windowMs: 60 * 1000,
  maxRequests: 10,
  message: 'Debug endpoint rate limit exceeded. Please wait.',
  useUserKey: true
});

/**
 * Middleware to check debug mode is enabled
 * SECURITY: Explicitly blocks production even if DEBUG=true is set
 */
function requireDebugMode(req, res, next) {
  // Double-check production environment
  if (isProduction) {
    console.warn(`[SECURITY] Debug endpoint access attempted in production by IP: ${req.ip}`);
    return res.status(403).json({
      error: 'Debug endpoints are disabled in production'
    });
  }

  if (!isDebugMode) {
    return res.status(403).json({
      error: 'Debug endpoints are only available in development mode (NODE_ENV=development)'
    });
  }
  next();
}

// Apply debug mode check and rate limiter to all routes
router.use(requireDebugMode);
router.use(debugRateLimiter);

/**
 * POST /api/debug/clear-node/:nodeId
 * Mark a combat node as cleared without fighting the battle
 * Used by "Defeat Automatically" button on world map
 */
router.post('/clear-node/:nodeId', authenticate, asyncHandler(async (req, res) => {
  const nodeId = parseInt(req.params.nodeId, 10);
  const userId = req.user.userId;

  if (isNaN(nodeId)) {
    throw new AppError('Invalid node ID', 400);
  }

  // Verify node exists and is a combat node
  const nodeResult = await query(
    'SELECT id, node_type, name FROM world_nodes WHERE id = $1',
    [nodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new AppError('Node not found', 404);
  }

  const node = nodeResult.rows[0];

  if (!COMBAT_NODE_TYPES.includes(node.node_type)) {
    throw new AppError('This node is not a combat node', 400);
  }

  // Check if already cleared
  const existingResult = await query(
    'SELECT 1 FROM user_node_clearance WHERE user_id = $1 AND node_id = $2',
    [userId, nodeId]
  );

  if (existingResult.rows.length > 0) {
    return res.json({
      success: true,
      message: 'Node was already cleared',
      node: { id: node.id, name: node.name, type: node.node_type }
    });
  }

  // Insert clearance record (battle_id is null for debug clears)
  await query(
    `INSERT INTO user_node_clearance (user_id, node_id, battle_id)
     VALUES ($1, $2, NULL)
     ON CONFLICT (user_id, node_id) DO NOTHING`,
    [userId, nodeId]
  );

  console.log(`[DEBUG] Node ${nodeId} (${node.name}) cleared by user ${userId} via debug endpoint`);

  res.json({
    success: true,
    message: `Node "${node.name}" has been cleared`,
    node: { id: node.id, name: node.name, type: node.node_type }
  });
}));

/**
 * POST /api/debug/win-battle/:battleId
 * Instantly win the current battle
 * Used by win_battle() console function
 */
router.post('/win-battle/:battleId', authenticate, asyncHandler(async (req, res) => {
  const battleId = parseInt(req.params.battleId, 10);
  const userId = req.user.userId;

  if (isNaN(battleId)) {
    throw new AppError('Invalid battle ID', 400);
  }

  const result = await winBattle(battleId, userId);

  res.json({
    success: true,
    message: 'Battle won!',
    battleId,
    status: 'victory',
    rewards: {
      gold: result.gold,
      experience: result.experience,
      items: result.items
    }
  });
}));

/**
 * GET /api/debug/status
 * Check if debug mode is enabled
 */
router.get('/status', (req, res) => {
  res.json({
    debugEnabled: isDebugMode,
    debugEnvVar: process.env.DEBUG === 'true',
    environment: process.env.NODE_ENV || 'unknown'
  });
});

/**
 * POST /api/debug/reset-battle-state
 * Reset in_battle flag for all characters owned by the authenticated user
 * Used when characters get stuck in battle state after coliseum/connection issues
 */
router.post('/reset-battle-state', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  // Check current state
  const beforeResult = await query(
    'SELECT id, name, in_battle FROM characters WHERE user_id = $1 AND in_battle = true',
    [userId]
  );

  if (beforeResult.rows.length === 0) {
    return res.json({
      message: 'No characters were in battle state',
      updated: 0
    });
  }

  // Reset battle state
  const updateResult = await query(
    'UPDATE characters SET in_battle = false WHERE user_id = $1 AND in_battle = true RETURNING id, name',
    [userId]
  );

  console.log(`[DEBUG] Reset in_battle for user ${userId}: ${updateResult.rows.map(c => c.name).join(', ')}`);

  res.json({
    message: 'Battle state reset for characters',
    updated: updateResult.rowCount,
    characters: updateResult.rows.map(c => ({ id: c.id, name: c.name }))
  });
}));

/**
 * GET /api/debug/verify-traits/:characterId
 * Debug endpoint to verify trait loading for a character
 * Returns both loaded traits and raw database entries for comparison
 */
router.get('/verify-traits/:characterId', authenticate, asyncHandler(async (req, res) => {
  const characterId = parseInt(req.params.characterId, 10);

  // Verify character ownership
  const charResult = await query(
    'SELECT id, name, class, level FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  const character = charResult.rows[0];

  // Load traits using the service (what would be used in battle)
  const traitsLoaded = await traitService.loadCharacterTraits([characterId]);

  // Get raw database entries for comparison
  const dbTraits = await query(
    `SELECT ct.id as assignment_id, ct.character_id, ct.trait_id, ct.acquired_at,
            t.id, t.name, t.description, t.effect_type, t.effect_value, t.rarity, t.category
     FROM character_traits ct
     JOIN traits t ON ct.trait_id = t.id
     WHERE ct.character_id = $1`,
    [characterId]
  );

  res.json({
    character: {
      id: character.id,
      name: character.name,
      class: character.class,
      level: character.level
    },
    traitsLoaded: traitsLoaded[characterId] || [],
    rawDatabaseEntries: dbTraits.rows,
    summary: {
      hasTraits: (traitsLoaded[characterId]?.length || 0) > 0,
      traitCount: traitsLoaded[characterId]?.length || 0,
      dbEntryCount: dbTraits.rows.length
    }
  });
}));

/**
 * GET /api/debug/discovery-health/:userId
 * Check discovery health for a user without repairing
 * Note: Debug mode already restricts to dev/test environments
 */
router.get('/discovery-health/:userId', authenticate, asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) {
    throw new AppError('Invalid user ID', 400);
  }
  console.log(`[DEBUG] User ${req.user.userId} checking discovery health for user ${userId}`);
  const health = await checkDiscoveryHealth(userId);
  res.json(health);
}));

/**
 * POST /api/debug/repair-discovery/:userId
 * Validate and repair discovery state for a specific user
 * Note: Debug mode already restricts to dev/test environments
 */
router.post('/repair-discovery/:userId', authenticate, asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) {
    throw new AppError('Invalid user ID', 400);
  }
  console.log(`[DEBUG] User ${req.user.userId} repairing discovery for user ${userId}`);
  const healthBefore = await checkDiscoveryHealth(userId);
  const repairResult = await validateAndRepairDiscovery(userId);
  const healthAfter = await checkDiscoveryHealth(userId);
  res.json({ healthBefore, repairResult, healthAfter });
}));

/**
 * POST /api/debug/repair-all-discovery
 * Batch repair all users with discovery issues (admin only - use with caution)
 */
router.post('/repair-all-discovery', authenticate, asyncHandler(async (req, res) => {
  console.log(`[DEBUG] Batch discovery repair initiated by user ${req.user.userId}`);
  const result = await batchRepairAllUsers();
  res.json(result);
}));

export default router;
