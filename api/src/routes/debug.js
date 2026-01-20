/**
 * Debug Routes - Developer tools for testing (DEBUG=true only)
 *
 * These endpoints are only available when DEBUG=true in the environment.
 * They allow developers to bypass gameplay mechanics for faster testing.
 */

import express from 'express';
import { query, pool } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import battleWebsocket from '../services/battleWebsocket.js';
import { COMBAT_NODE_TYPES } from '../config/constants.js';

const router = express.Router();

// Check if debug mode is enabled
// Debug endpoints are available when:
// - DEBUG=true in environment, OR
// - NODE_ENV=development (local development)
const isDebugMode = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';

/**
 * Middleware to check debug mode is enabled
 */
function requireDebugMode(req, res, next) {
  if (!isDebugMode) {
    return res.status(403).json({
      error: 'Debug endpoints are only available in development mode (NODE_ENV=development or DEBUG=true)'
    });
  }
  next();
}

// Apply debug mode check to all routes
router.use(requireDebugMode);

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

  // Get battle state
  const battleResult = await query(
    `SELECT b.id, b.status, b.party_ids, b.node_id, b.battle_type,
            wn.node_type, wn.name as node_name
     FROM battles b
     LEFT JOIN world_nodes wn ON wn.id = b.node_id
     WHERE b.id = $1`,
    [battleId]
  );

  if (battleResult.rows.length === 0) {
    throw new AppError('Battle not found', 404);
  }

  const battle = battleResult.rows[0];

  if (battle.status !== 'active') {
    throw new AppError(`Battle is not active (status: ${battle.status})`, 400);
  }

  // Verify user is in this battle
  const partyIds = battle.party_ids || [];
  const isParticipant = partyIds.some(id => {
    // partyIds might be character IDs or user IDs depending on battle type
    return true; // For debug mode, allow winning any battle
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Mark all enemy units as dead
    await client.query(
      `UPDATE battle_units
       SET hp_current = 0
       WHERE battle_id = $1 AND unit_type = 'enemy'`,
      [battleId]
    );

    // Calculate rewards (simplified for debug)
    const enemyResult = await client.query(
      `SELECT COUNT(*) as count, SUM(COALESCE(reward_gold, 10)) as gold, SUM(COALESCE(reward_exp, 25)) as exp
       FROM battle_units
       WHERE battle_id = $1 AND unit_type = 'enemy'`,
      [battleId]
    );

    const enemyData = enemyResult.rows[0];
    const gold = parseInt(enemyData.gold, 10) || 50;
    const exp = parseInt(enemyData.exp, 10) || 100;

    // Award gold to user
    await client.query(
      'UPDATE users SET gold = gold + $1 WHERE id = $2',
      [gold, userId]
    );

    // Award XP to party characters
    await client.query(
      `UPDATE characters
       SET experience = experience + $1
       WHERE party_slot IS NOT NULL AND user_id = $2`,
      [exp, userId]
    );

    // Mark characters as not in battle
    await client.query(
      `UPDATE characters
       SET in_battle = false
       WHERE party_slot IS NOT NULL AND user_id = $1`,
      [userId]
    );

    // Mark battle as won
    await client.query(
      `UPDATE battles
       SET status = 'victory',
           ended_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [battleId]
    );

    // Clear the combat node if applicable
    if (battle.node_id && COMBAT_NODE_TYPES.includes(battle.node_type)) {
      await client.query(
        `INSERT INTO user_node_clearance (user_id, node_id, battle_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, node_id) DO NOTHING`,
        [userId, battle.node_id, battleId]
      );
    }

    await client.query('COMMIT');

    const rewards = { gold, experience: exp, items: [] };

    // Broadcast battle end via WebSocket
    battleWebsocket.broadcastBattleEnd(battleId, 'victory', rewards);

    console.log(`[DEBUG] Battle ${battleId} won by user ${userId} via debug endpoint`);

    res.json({
      success: true,
      message: 'Battle won!',
      battleId,
      status: 'victory',
      rewards
    });

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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

export default router;
