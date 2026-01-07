const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const presenceService = require('../services/presenceService');
const { broadcastToRoom, rooms } = require('../websocket/index');

// GET /api/world/seed - Get global world seed
router.get('/seed', asyncHandler(async (req, res) => {
  const seed = parseInt(process.env.WORLD_SEED || '12345');
  res.json({ seed });
}));

// GET /api/world/nodes - Get all discovered nodes for user
router.get('/nodes', authenticate, asyncHandler(async (req, res) => {
  // For MVP, return all nodes. Later we can add discovery mechanics.
  const result = await query(
    `SELECT id, node_type, name, x_coord, y_coord, distance_from_center,
            features, guild_class, local_seed, difficulty_tier
     FROM world_nodes
     ORDER BY distance_from_center ASC`
  );

  // Get connections
  const connectionsResult = await query(
    `SELECT from_node_id, to_node_id, path_type FROM world_node_connections`
  );

  res.json({
    nodes: result.rows,
    connections: connectionsResult.rows
  });
}));

// GET /api/world/nodes/:id - Get specific node details
router.get('/nodes/:id', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await query(
    `SELECT id, node_type, name, x_coord, y_coord, distance_from_center,
            features, guild_class, local_seed, difficulty_tier
     FROM world_nodes WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new AppError('Node not found', 404);
  }

  // Get connected nodes
  const connectionsResult = await query(
    `SELECT wn.id, wn.node_type, wn.name, wnc.path_type
     FROM world_node_connections wnc
     JOIN world_nodes wn ON (wnc.to_node_id = wn.id OR wnc.from_node_id = wn.id)
     WHERE (wnc.from_node_id = $1 OR wnc.to_node_id = $1)
       AND wn.id != $1`,
    [id]
  );

  res.json({
    node: result.rows[0],
    connectedNodes: connectionsResult.rows
  });
}));

// POST /api/world/travel - Move party to adjacent node
router.post('/travel', authenticate, asyncHandler(async (req, res) => {
  const { targetNodeId } = req.body;

  if (!targetNodeId) {
    throw new AppError('targetNodeId is required', 400);
  }

  // Get user's current position (from first character)
  const charResult = await query(
    `SELECT current_node_id FROM characters
     WHERE user_id = $1 AND party_slot = 1`,
    [req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('No active party character', 400);
  }

  const currentNodeId = charResult.rows[0].current_node_id;

  // Check if in battle
  const battleCheck = await query(
    'SELECT in_battle FROM characters WHERE user_id = $1 AND in_battle = true LIMIT 1',
    [req.user.userId]
  );

  if (battleCheck.rows.length > 0) {
    throw new AppError('Cannot travel while in battle', 400);
  }

  // Verify target node is connected
  const connectionResult = await query(
    `SELECT 1 FROM world_node_connections
     WHERE (from_node_id = $1 AND to_node_id = $2)
        OR (from_node_id = $2 AND to_node_id = $1)`,
    [currentNodeId, targetNodeId]
  );

  if (connectionResult.rows.length === 0) {
    throw new AppError('Target node is not connected to current location', 400);
  }

  // Move all party characters
  await query(
    `UPDATE characters SET current_node_id = $1
     WHERE user_id = $2 AND party_slot IS NOT NULL`,
    [targetNodeId, req.user.userId]
  );

  // Get new node details
  const nodeResult = await query(
    `SELECT id, node_type, name, features, guild_class, local_seed, difficulty_tier
     FROM world_nodes WHERE id = $1`,
    [targetNodeId]
  );

  // Get character name for movement events
  const charNameResult = await query(
    'SELECT name FROM characters WHERE user_id = $1 AND party_slot = 1',
    [req.user.userId]
  );
  const characterName = charNameResult.rows[0]?.name || 'Unknown';

  // Update node presence tracking and broadcast events
  const moveResult = presenceService.moveNode(
    currentNodeId,
    targetNodeId,
    req.user.userId,
    req.user.username,
    characterName
  );

  // Broadcast player_left_node to old node room
  const oldNodeRoom = `node:${currentNodeId}`;
  if (rooms.has(oldNodeRoom)) {
    broadcastToRoom(oldNodeRoom, {
      type: 'player:left_node',
      payload: {
        nodeId: currentNodeId,
        userId: req.user.userId,
        username: req.user.username,
        characterName,
        timestamp: Date.now()
      }
    }, req.user.userId);
  }

  // Broadcast player_entered_node to new node room
  const newNodeRoom = `node:${targetNodeId}`;
  if (rooms.has(newNodeRoom)) {
    broadcastToRoom(newNodeRoom, {
      type: 'player:entered_node',
      payload: {
        nodeId: targetNodeId,
        userId: req.user.userId,
        username: req.user.username,
        characterName,
        timestamp: Date.now()
      }
    }, req.user.userId);
  }

  res.json({
    message: 'Traveled successfully',
    currentNode: nodeResult.rows[0],
    playersAtNode: presenceService.getPlayersAtNode(targetNodeId)
  });
}));

// GET /api/world/current - Get current node + available actions
router.get('/current', authenticate, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT wn.id, wn.node_type, wn.name, wn.features, wn.guild_class,
            wn.local_seed, wn.difficulty_tier
     FROM characters c
     JOIN world_nodes wn ON c.current_node_id = wn.id
     WHERE c.user_id = $1 AND c.party_slot = 1`,
    [req.user.userId]
  );

  if (result.rows.length === 0) {
    throw new AppError('No active party character or location', 400);
  }

  const node = result.rows[0];

  // Determine available actions based on node type and features
  const actions = [];

  if (node.features && Array.isArray(node.features)) {
    node.features.forEach(feature => {
      actions.push({ type: 'feature', name: feature });
    });
  }

  // Battle nodes allow battle action
  if (['forest', 'cave', 'mountain', 'bridge'].includes(node.node_type)) {
    actions.push({ type: 'battle', name: 'Battle' });
  }

  res.json({
    currentNode: node,
    availableActions: actions,
    playersAtNode: presenceService.getPlayersAtNode(node.id)
  });
}));

// GET /api/world/nodes/:id/players - Get players at a specific node
router.get('/nodes/:id/players', authenticate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Verify node exists
  const nodeResult = await query(
    'SELECT id, name FROM world_nodes WHERE id = $1',
    [id]
  );

  if (nodeResult.rows.length === 0) {
    throw new AppError('Node not found', 404);
  }

  const players = presenceService.getPlayersAtNode(parseInt(id));

  res.json({
    nodeId: parseInt(id),
    nodeName: nodeResult.rows[0].name,
    players,
    count: players.length
  });
}));

module.exports = router;
