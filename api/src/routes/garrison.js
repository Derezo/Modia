/**
 * Garrison Routes - Castle garrison recruitment system
 * Endpoints for viewing and purchasing recruits from castle garrison nodes
 */

import express from 'express';
import { query } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { createLimiter } from '../middleware/rateLimiterFactory.js';
import * as garrisonService from '../services/garrisonService.js';
import { broadcastGarrisonPurchase } from '../websocket/garrisonWebsocket.js';

const router = express.Router();

/**
 * Garrison purchase rate limiter
 * Recruiting from garrison costs gold - limit to prevent abuse
 * Base: 10/min - recruiting is an infrequent action
 */
const garrisonPurchaseLimiter = createLimiter({
  name: 'economy:garrison_purchase',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 10,           // Base: 10, Prod: 20, Dev: 50
  message: 'Too many recruit purchase attempts. Please wait a moment.',
  useUserKey: true
});

/**
 * Verify node is a castle and return castle info
 * @param {number} nodeId - Node ID
 * @returns {Object} Castle node data
 * @throws {AppError} if node not found or not a castle
 */
async function verifyCastleNode(nodeId) {
  const nodeResult = await query(
    `SELECT id, name, node_type, region_id
     FROM world_nodes WHERE id = $1`,
    [nodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new AppError('Node not found', 404);
  }

  const node = nodeResult.rows[0];

  if (node.node_type !== 'castle') {
    throw new AppError('This node is not a castle', 400);
  }

  return node;
}

/**
 * Verify user's active character is at the specified castle node
 * @param {number} userId - User ID
 * @param {number} nodeId - Castle node ID
 * @throws {AppError} if user is not at the castle
 */
async function verifyUserAtCastle(userId, nodeId) {
  // Get user's lead character (party_slot = 1) to check location
  const characterResult = await query(
    `SELECT id, current_node_id FROM characters
     WHERE user_id = $1 AND party_slot = 1`,
    [userId]
  );

  if (characterResult.rows.length === 0) {
    throw new AppError('No active character found', 400);
  }

  const character = characterResult.rows[0];

  if (character.current_node_id !== nodeId) {
    throw new AppError('You must be at this castle to access the garrison', 403);
  }
}

/**
 * Calculate seconds until next hourly refresh
 * @returns {number} Seconds until next hour boundary
 */
function calculateSecondsUntilNextRefresh() {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setUTCHours(nextHour.getUTCHours() + 1, 0, 0, 0);
  return Math.floor((nextHour - now) / 1000);
}

// ============================================
// GET /api/garrison/:nodeId - Get available recruits
// ============================================
router.get('/:nodeId', authenticate, asyncHandler(async (req, res) => {
  const { nodeId } = req.params;
  const nodeIdNum = parseInt(nodeId, 10);

  if (isNaN(nodeIdNum)) {
    throw new AppError('Invalid node ID', 400);
  }

  // Verify it's a castle node
  const castle = await verifyCastleNode(nodeIdNum);

  // Verify user is at this castle
  await verifyUserAtCastle(req.user.userId, nodeIdNum);

  // Check if refresh is needed (lazy refresh on access)
  await garrisonService.checkAndRefreshIfStale(nodeIdNum);

  // Get available recruits from service
  const recruits = await garrisonService.getAvailableRecruits(nodeIdNum);

  // Calculate next refresh time (top of next hour)
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setUTCMinutes(0, 0, 0);
  nextHour.setUTCHours(nextHour.getUTCHours() + 1);

  res.json({
    nodeId: nodeIdNum,
    nodeName: castle.name,
    recruits,
    nextRefresh: nextHour.toISOString()
  });
}));

// ============================================
// POST /api/garrison/:nodeId/purchase/:recruitId - Purchase a recruit
// ============================================
router.post('/:nodeId/purchase/:recruitId', authenticate, garrisonPurchaseLimiter, asyncHandler(async (req, res) => {
  const { nodeId, recruitId } = req.params;
  const { characterName } = req.body;
  const nodeIdNum = parseInt(nodeId, 10);
  const recruitIdNum = parseInt(recruitId, 10);

  if (isNaN(nodeIdNum)) {
    throw new AppError('Invalid node ID', 400);
  }

  if (isNaN(recruitIdNum)) {
    throw new AppError('Invalid recruit ID', 400);
  }

  // Validate character name if provided
  if (characterName !== undefined && characterName !== null) {
    if (typeof characterName !== 'string') {
      throw new AppError('Character name must be a string', 400);
    }
    const trimmedName = characterName.trim();
    if (trimmedName.length < 2 || trimmedName.length > 24) {
      throw new AppError('Character name must be between 2 and 24 characters', 400);
    }
  }

  // Verify it's a castle node
  await verifyCastleNode(nodeIdNum);

  // Verify user is at this castle
  await verifyUserAtCastle(req.user.userId, nodeIdNum);

  // Verify recruit belongs to this castle and is available
  const recruitCheck = await query(
    'SELECT castle_node_id, purchased_by FROM garrison_recruits WHERE id = $1',
    [recruitIdNum]
  );

  if (recruitCheck.rows.length === 0) {
    throw new AppError('Recruit not found', 404);
  }

  const recruit = recruitCheck.rows[0];

  if (recruit.castle_node_id !== nodeIdNum) {
    throw new AppError('Recruit not found at this garrison', 404);
  }

  if (recruit.purchased_by !== null) {
    throw new AppError('Recruit has already been purchased', 400);
  }

  // Purchase the recruit (service handles gold check, character creation, etc.)
  try {
    const result = await garrisonService.purchaseRecruit(
      req.user.userId,
      recruitIdNum,
      characterName || null
    );

    // Broadcast purchase to other users viewing this garrison
    broadcastGarrisonPurchase(nodeIdNum, recruitIdNum, {
      userId: req.user.userId,
      username: req.user.username,
      characterName: result.character.name
    });

    res.json({
      success: true,
      message: `Successfully recruited ${result.character.name}`,
      character: result.character,
      goldSpent: result.goldSpent,
      remainingGold: result.remainingGold
    });
  } catch (err) {
    // Convert service errors to appropriate HTTP errors
    if (err.message.includes('Not enough gold')) {
      throw new AppError(err.message, 400);
    }
    if (err.message.includes('Cannot have more than')) {
      throw new AppError(err.message, 400);
    }
    if (err.message.includes('already been purchased')) {
      throw new AppError(err.message, 400);
    }
    throw err;
  }
}));

// ============================================
// GET /api/garrison/:nodeId/refresh-time - Seconds until next refresh
// ============================================
router.get('/:nodeId/refresh-time', authenticate, asyncHandler(async (req, res) => {
  const { nodeId } = req.params;
  const nodeIdNum = parseInt(nodeId, 10);

  if (isNaN(nodeIdNum)) {
    throw new AppError('Invalid node ID', 400);
  }

  // Verify it's a castle node
  const castle = await verifyCastleNode(nodeIdNum);

  // Verify user is at this castle
  await verifyUserAtCastle(req.user.userId, nodeIdNum);

  // Calculate seconds until next hourly refresh
  const secondsUntilRefresh = calculateSecondsUntilNextRefresh();

  res.json({
    nodeId: nodeIdNum,
    nodeName: castle.name,
    secondsUntilRefresh
  });
}));

export default router;
