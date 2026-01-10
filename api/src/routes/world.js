import express from 'express';
import { query } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import presenceService from '../services/presenceService.js';

const router = express.Router();

// GET /api/world/seed - Get global world seed
router.get('/seed', asyncHandler(async (req, res) => {
  const seed = parseInt(process.env.WORLD_SEED || '12345', 10);
  res.json({ seed });
}));

// GET /api/world/nodes - Get discovered nodes for user (fog of war)
router.get('/nodes', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  // Get only discovered nodes for this user
  const result = await query(
    `SELECT wn.id, wn.node_type, wn.name, wn.x_coord, wn.y_coord, wn.distance_from_center,
            wn.features, wn.guild_class, wn.local_seed, wn.difficulty_tier,
            und.discovered_at,
            und.discovery_method,
            CASE WHEN und.discovery_method = 'travel' THEN true ELSE false END as visited
     FROM world_nodes wn
     INNER JOIN user_node_discovery und ON wn.id = und.node_id
     WHERE und.user_id = $1
     ORDER BY wn.distance_from_center ASC`,
    [userId]
  );

  // Get connections only between discovered nodes
  const connectionsResult = await query(
    `SELECT wnc.from_node_id, wnc.to_node_id, wnc.path_type
     FROM world_node_connections wnc
     WHERE wnc.from_node_id IN (SELECT node_id FROM user_node_discovery WHERE user_id = $1)
       AND wnc.to_node_id IN (SELECT node_id FROM user_node_discovery WHERE user_id = $1)`,
    [userId]
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

  // Discover node and adjacent nodes (fog of war)
  await query('SELECT discover_node_and_adjacent($1, $2)', [req.user.userId, targetNodeId]);

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

  // Dynamic import to avoid circular dependency
  const { broadcastToRoom, rooms } = await import('../websocket/index.js');

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

  const players = presenceService.getPlayersAtNode(parseInt(id, 10));

  res.json({
    nodeId: parseInt(id, 10),
    nodeName: nodeResult.rows[0].name,
    players,
    count: players.length
  });
}));

// GET /api/world/discovery-stats - Get discovery progress for user
router.get('/discovery-stats', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  const stats = await query(
    `SELECT
       COUNT(*) FILTER (WHERE discovery_method = 'travel') as visited_count,
       COUNT(*) as discovered_count,
       (SELECT COUNT(*) FROM world_nodes) as total_nodes
     FROM user_node_discovery
     WHERE user_id = $1`,
    [userId]
  );

  res.json(stats.rows[0]);
}));

export default router;
