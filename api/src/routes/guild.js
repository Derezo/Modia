/**
 * Guild Routes - Guild recruitment system
 * Endpoints for viewing and purchasing recruits from guild nodes
 */

const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const recruitService = require('../services/recruitService');

// Class-specific action labels for guild UI
const ACTION_LABELS = {
  warrior: 'Recruit Soldier',
  wizard: 'Take on Apprentice',
  monk: 'Accept Initiate',
  chemist: 'Hire Assistant'
};

/**
 * Verify user has discovered this guild node
 * @param {number} userId - User ID
 * @param {number} nodeId - Node ID
 * @throws {AppError} if node not discovered
 */
async function verifyNodeDiscovery(userId, nodeId) {
  const discoveryCheck = await query(
    'SELECT 1 FROM user_node_discovery WHERE user_id = $1 AND node_id = $2',
    [userId, nodeId]
  );

  if (discoveryCheck.rows.length === 0) {
    throw new AppError('Guild not yet discovered', 403);
  }
}

/**
 * Verify node is a guild and return guild info
 * @param {number} nodeId - Node ID
 * @returns {Object} Guild node data
 * @throws {AppError} if node not found or not a guild
 */
async function verifyGuildNode(nodeId) {
  const nodeResult = await query(
    `SELECT id, name, node_type, guild_class, recruit_refresh_hour, last_recruit_refresh
     FROM world_nodes WHERE id = $1`,
    [nodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new AppError('Node not found', 404);
  }

  const node = nodeResult.rows[0];

  if (node.node_type !== 'guild') {
    throw new AppError('This node is not a guild', 400);
  }

  return node;
}

/**
 * Calculate next refresh time from refresh hour
 * @param {number} refreshHour - Hour (0-23 UTC) when refresh occurs
 * @param {Date} lastRefresh - Last refresh timestamp
 * @returns {Date} Next refresh time
 */
function calculateNextRefresh(refreshHour, lastRefresh) {
  const now = new Date();
  const next = new Date(now);

  // Set to the refresh hour for today
  next.setUTCHours(refreshHour, 0, 0, 0);

  // If current hour >= refresh hour, next refresh is tomorrow
  if (now.getUTCHours() >= refreshHour) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next;
}

// ============================================
// GET /api/guild/:nodeId/recruits - Get available recruits
// ============================================
router.get('/:nodeId/recruits', authenticate, asyncHandler(async (req, res) => {
  const { nodeId } = req.params;
  const nodeIdNum = parseInt(nodeId, 10);

  if (isNaN(nodeIdNum)) {
    throw new AppError('Invalid node ID', 400);
  }

  // Verify user has discovered this node
  await verifyNodeDiscovery(req.user.userId, nodeIdNum);

  // Verify it's a guild node
  await verifyGuildNode(nodeIdNum);

  // Check if refresh is needed (lazy refresh on access)
  await recruitService.checkAndRefreshIfNeeded(nodeIdNum);

  // Get available recruits from service
  let recruits = await recruitService.getAvailableRecruits(nodeIdNum);

  // Emergency restock: if all recruits have been purchased, spawn emergency recruits
  if (recruits.length === 0) {
    await recruitService.spawnEmergencyRecruits(nodeIdNum);
    recruits = await recruitService.getAvailableRecruits(nodeIdNum);
  }

  res.json({
    nodeId: nodeIdNum,
    recruits
  });
}));

// ============================================
// POST /api/guild/:nodeId/recruit/:recruitId/purchase - Purchase a recruit
// ============================================
router.post('/:nodeId/recruit/:recruitId/purchase', authenticate, asyncHandler(async (req, res) => {
  const { nodeId, recruitId } = req.params;
  const nodeIdNum = parseInt(nodeId, 10);
  const recruitIdNum = parseInt(recruitId, 10);

  if (isNaN(nodeIdNum)) {
    throw new AppError('Invalid node ID', 400);
  }

  if (isNaN(recruitIdNum)) {
    throw new AppError('Invalid recruit ID', 400);
  }

  // Verify user has discovered this node
  await verifyNodeDiscovery(req.user.userId, nodeIdNum);

  // Verify it's a guild node
  await verifyGuildNode(nodeIdNum);

  // Verify recruit belongs to this node and is available
  const recruitCheck = await query(
    'SELECT node_id, purchased_by FROM guild_recruits WHERE id = $1',
    [recruitIdNum]
  );

  if (recruitCheck.rows.length === 0) {
    throw new AppError('Recruit not found', 404);
  }

  const recruit = recruitCheck.rows[0];

  if (recruit.node_id !== nodeIdNum) {
    throw new AppError('Recruit not found at this guild', 404);
  }

  if (recruit.purchased_by !== null) {
    throw new AppError('Recruit has already been purchased', 400);
  }

  // Purchase the recruit (service handles gold check, character creation, etc.)
  try {
    const result = await recruitService.purchaseRecruit(recruitIdNum, req.user.userId);

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
// GET /api/guild/:nodeId/info - Get guild info
// ============================================
router.get('/:nodeId/info', authenticate, asyncHandler(async (req, res) => {
  const { nodeId } = req.params;
  const nodeIdNum = parseInt(nodeId, 10);

  if (isNaN(nodeIdNum)) {
    throw new AppError('Invalid node ID', 400);
  }

  // Verify user has discovered this node
  await verifyNodeDiscovery(req.user.userId, nodeIdNum);

  // Check if refresh is needed (lazy refresh on access)
  await recruitService.checkAndRefreshIfNeeded(nodeIdNum);

  // Get guild node info (re-fetch after potential refresh to get updated last_recruit_refresh)
  const guild = await verifyGuildNode(nodeIdNum);

  // Count available recruits
  const countResult = await query(
    'SELECT COUNT(*) as count FROM guild_recruits WHERE node_id = $1 AND purchased_by IS NULL',
    [nodeIdNum]
  );
  const recruitCount = parseInt(countResult.rows[0].count, 10);

  // Calculate next refresh time
  const nextRefresh = calculateNextRefresh(
    guild.recruit_refresh_hour || 0,
    guild.last_recruit_refresh
  );

  // Get action label for this guild class
  const actionLabel = ACTION_LABELS[guild.guild_class] || 'Recruit Member';

  res.json({
    nodeId: nodeIdNum,
    nodeName: guild.name,
    guildClass: guild.guild_class,
    recruitRefreshHour: guild.recruit_refresh_hour,
    lastRefresh: guild.last_recruit_refresh,
    nextRefresh: nextRefresh.toISOString(),
    recruitCount,
    actionLabel
  });
}));

module.exports = router;
