import express from 'express';
import { query } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import presenceService from '../services/presenceService.js';
import * as staminaService from '../services/staminaService.js';

const router = express.Router();

// Combat node types that require clearance (forest, cave, mountain, bridge)
const COMBAT_NODE_TYPES = ['forest', 'cave', 'mountain', 'bridge'];

/**
 * Build adjacency map from world node connections
 * @param {Object[]} connections - Array of {from_node_id, to_node_id} pairs
 * @returns {Map<number, Set<number>>} Adjacency map
 */
function buildAdjacencyMap(connections) {
  const adj = new Map();
  for (const conn of connections) {
    const from = conn.from_node_id;
    const to = conn.to_node_id;
    if (!adj.has(from)) adj.set(from, new Set());
    if (!adj.has(to)) adj.set(to, new Set());
    adj.get(from).add(to);
    adj.get(to).add(from);
  }
  return adj;
}

/**
 * Find shortest path between two nodes using BFS
 * Respects node blocking: cannot pass THROUGH blocked nodes, but CAN travel TO them
 * @param {number} fromNodeId - Starting node ID
 * @param {number} toNodeId - Destination node ID
 * @param {Map<number, Set<number>>} adjacency - Adjacency map
 * @param {Set<number>} blockedNodes - Set of blocked node IDs (cannot pass through)
 * @returns {number[]|null} Array of node IDs forming the path, or null if no path
 */
function bfsPath(fromNodeId, toNodeId, adjacency, blockedNodes = new Set()) {
  if (fromNodeId === toNodeId) {
    return [fromNodeId];
  }

  const visited = new Set([fromNodeId]);
  const queue = [[fromNodeId]];

  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];

    const neighbors = adjacency.get(current) || new Set();
    for (const neighbor of neighbors) {
      // Destination is always reachable (can travel TO blocked node to fight)
      if (neighbor === toNodeId) {
        return [...path, neighbor];
      }
      // Skip blocked intermediate nodes (cannot pass THROUGH)
      if (blockedNodes.has(neighbor)) {
        continue;
      }
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }

  return null; // No path found
}

/**
 * Get set of blocked node IDs for a user
 * Combat nodes (forest, cave, mountain, bridge) are blocked until cleared
 * @param {number} userId - User ID
 * @returns {Promise<Set<number>>} Set of blocked node IDs
 */
async function getBlockedNodes(userId) {
  const result = await query(
    `SELECT wn.id FROM world_nodes wn
     WHERE wn.node_type IN ('forest', 'cave', 'mountain', 'bridge')
     AND NOT EXISTS (
       SELECT 1 FROM user_node_clearance unc
       WHERE unc.user_id = $1 AND unc.node_id = wn.id
     )`,
    [userId]
  );
  return new Set(result.rows.map(r => r.id));
}

/**
 * Get cleared nodes for a user
 * @param {number} userId - User ID
 * @returns {Promise<Set<number>>} Set of cleared node IDs
 */
async function getClearedNodes(userId) {
  const result = await query(
    'SELECT node_id FROM user_node_clearance WHERE user_id = $1',
    [userId]
  );
  return new Set(result.rows.map(r => r.node_id));
}

/**
 * Get nodes that user has physically traveled to (not just discovered via adjacency)
 * @param {number} userId - User ID
 * @returns {Promise<Set<number>>} Set of visited node IDs
 */
async function getVisitedNodes(userId) {
  const result = await query(
    `SELECT node_id FROM user_node_discovery
     WHERE user_id = $1 AND discovery_method = 'travel'`,
    [userId]
  );
  return new Set(result.rows.map(r => r.node_id));
}

/**
 * Find shortest path between two world nodes
 * @param {number} fromNodeId - Starting node ID
 * @param {number} toNodeId - Destination node ID
 * @param {number|null} userId - User ID for blocking check (null to ignore blocking)
 * @returns {Promise<{path: number[], distance: number, blockedInPath: number[]}|null>}
 */
async function findWorldPath(fromNodeId, toNodeId, userId = null) {
  // Load all connections
  const result = await query(
    'SELECT from_node_id, to_node_id FROM world_node_connections'
  );

  const adjacency = buildAdjacencyMap(result.rows);

  // Get blocked nodes if userId provided
  const blockedNodes = userId ? await getBlockedNodes(userId) : new Set();

  const path = bfsPath(fromNodeId, toNodeId, adjacency, blockedNodes);

  if (!path) {
    return null;
  }

  // Find which nodes in the path are blocked (for UI display)
  const blockedInPath = path.filter(nodeId => blockedNodes.has(nodeId));

  return {
    path,
    distance: path.length - 1, // Number of edges, not nodes
    blockedInPath
  };
}

// GET /api/world/seed - Get global world seed
router.get('/seed', asyncHandler(async (req, res) => {
  const seed = parseInt(process.env.WORLD_SEED || '12345', 10);
  res.json({ seed });
}));

// GET /api/world/nodes - Get discovered nodes for user (fog of war + clearance status)
router.get('/nodes', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  // Get only discovered nodes for this user, including clearance status
  const result = await query(
    `SELECT wn.id, wn.node_type, wn.name, wn.x_coord, wn.y_coord, wn.distance_from_center,
            wn.features, wn.guild_class, wn.local_seed, wn.difficulty_tier,
            und.discovered_at,
            und.discovery_method,
            CASE WHEN und.discovery_method = 'travel' THEN true ELSE false END as visited,
            -- Clearance status: combat nodes need clearing
            CASE WHEN unc.node_id IS NOT NULL THEN true ELSE false END as cleared,
            -- Blocked status: combat nodes that aren't cleared
            CASE WHEN wn.node_type IN ('forest', 'cave', 'mountain', 'bridge')
                  AND unc.node_id IS NULL THEN true ELSE false END as blocked
     FROM world_nodes wn
     INNER JOIN user_node_discovery und ON wn.id = und.node_id
     LEFT JOIN user_node_clearance unc ON wn.id = unc.node_id AND unc.user_id = $1
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

// GET /api/world/path/:targetNodeId - Preview path to a node (without traveling)
router.get('/path/:targetNodeId', authenticate, asyncHandler(async (req, res) => {
  const { targetNodeId } = req.params;
  const userId = req.user.userId;

  // Get user's current position
  const charResult = await query(
    `SELECT c.current_node_id, c.id as character_id
     FROM characters c
     WHERE c.user_id = $1 AND c.party_slot = 1`,
    [userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('No active party character', 400);
  }

  const currentNodeId = charResult.rows[0].current_node_id;
  const characterId = charResult.rows[0].character_id;

  // Check if destination is discovered
  const discoveryCheck = await query(
    'SELECT 1 FROM user_node_discovery WHERE user_id = $1 AND node_id = $2',
    [userId, targetNodeId]
  );

  if (discoveryCheck.rows.length === 0) {
    throw new AppError('Destination node has not been discovered', 400);
  }

  // Find path (with blocking awareness)
  const pathResult = await findWorldPath(currentNodeId, parseInt(targetNodeId, 10), userId);

  if (!pathResult) {
    // Path might be blocked - provide helpful error
    throw new AppError('No path found. Clear blocked nodes to reach destination.', 400);
  }

  // Get current stamina
  const staminaInfo = await staminaService.getStaminaInfo(characterId);
  const cost = pathResult.distance;
  const affordable = staminaInfo.current >= cost;

  // Get node names along the path with clearance info
  const pathNodesResult = await query(
    `SELECT wn.id, wn.name, wn.node_type,
            CASE WHEN unc.node_id IS NOT NULL THEN true ELSE false END as cleared,
            CASE WHEN wn.node_type IN ('forest', 'cave', 'mountain', 'bridge')
                  AND unc.node_id IS NULL THEN true ELSE false END as blocked
     FROM world_nodes wn
     LEFT JOIN user_node_clearance unc ON wn.id = unc.node_id AND unc.user_id = $2
     WHERE wn.id = ANY($1)
     ORDER BY array_position($1, wn.id)`,
    [pathResult.path, userId]
  );

  // Check if destination is a blocked node (player wants to fight there)
  const destinationBlocked = pathResult.blockedInPath.includes(parseInt(targetNodeId, 10));

  // Check if traveling FROM a blocked node to a non-visited destination
  const blockedNodes = await getBlockedNodes(userId);
  const originBlocked = blockedNodes.has(currentNodeId);
  let cannotReachFromOrigin = false;

  if (originBlocked) {
    const visitedNodes = await getVisitedNodes(userId);
    cannotReachFromOrigin = !visitedNodes.has(parseInt(targetNodeId, 10));
  }

  res.json({
    path: pathResult.path,
    pathNodes: pathNodesResult.rows,
    distance: pathResult.distance,
    cost,
    affordable: affordable && !cannotReachFromOrigin,
    currentStamina: staminaInfo.current,
    maxStamina: staminaInfo.max,
    // Blocking info
    blockedNodes: pathResult.blockedInPath,
    destinationBlocked,
    pathBlocked: false, // Path was found, so it's not completely blocked
    // Origin blocking info (when at a blocked node)
    originBlocked,
    cannotReachFromOrigin
  });
}));

// POST /api/world/travel - Move party to any discovered node
router.post('/travel', authenticate, asyncHandler(async (req, res) => {
  const { targetNodeId } = req.body;

  if (!targetNodeId) {
    throw new AppError('targetNodeId is required', 400);
  }

  // Get user's current position and party leader character
  const charResult = await query(
    `SELECT current_node_id, id as character_id FROM characters
     WHERE user_id = $1 AND party_slot = 1`,
    [req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('No active party character', 400);
  }

  const currentNodeId = charResult.rows[0].current_node_id;
  const characterId = charResult.rows[0].character_id;

  // Already at destination
  if (currentNodeId === targetNodeId) {
    throw new AppError('Already at destination', 400);
  }

  // Check if in battle
  const battleCheck = await query(
    'SELECT in_battle FROM characters WHERE user_id = $1 AND in_battle = true LIMIT 1',
    [req.user.userId]
  );

  if (battleCheck.rows.length > 0) {
    throw new AppError('Cannot travel while in battle', 400);
  }

  // Check if destination is discovered
  const discoveryCheck = await query(
    'SELECT 1 FROM user_node_discovery WHERE user_id = $1 AND node_id = $2',
    [req.user.userId, targetNodeId]
  );

  if (discoveryCheck.rows.length === 0) {
    throw new AppError('Destination node has not been discovered', 400);
  }

  // Find shortest path with blocking awareness
  const pathResult = await findWorldPath(currentNodeId, targetNodeId, req.user.userId);

  if (!pathResult) {
    throw new AppError('No path found to destination', 400);
  }

  // Check for blocked intermediate nodes (can travel TO a blocked node, but not THROUGH)
  // blockedInPath contains all blocked nodes in the path including destination
  // We allow:
  // - Leaving from current node (even if blocked) - player can always leave their position
  // - Traveling TO a blocked node (destination) - to initiate battle
  // We block: traveling THROUGH other blocked nodes to reach destination
  const blockedIntermediates = pathResult.blockedInPath.filter(
    nodeId => nodeId !== targetNodeId && nodeId !== currentNodeId
  );

  if (blockedIntermediates.length > 0) {
    // Get names of blocked nodes for better error message
    const blockedNamesResult = await query(
      `SELECT name FROM world_nodes WHERE id = ANY($1)`,
      [blockedIntermediates]
    );
    const blockedNames = blockedNamesResult.rows.map(r => r.name).join(', ');
    throw new AppError(
      `Path is blocked by uncleared nodes: ${blockedNames}. Clear them in battle first.`,
      400
    );
  }

  // Check if traveling FROM a blocked node to a non-visited destination
  // From a blocked node, player can only retreat to previously visited nodes
  const blockedNodes = await getBlockedNodes(req.user.userId);
  if (blockedNodes.has(currentNodeId)) {
    const visitedNodes = await getVisitedNodes(req.user.userId);
    if (!visitedNodes.has(targetNodeId)) {
      throw new AppError(
        'You must defeat the enemies here before exploring further, or retreat to a previously visited location.',
        400
      );
    }
  }

  const travelCost = pathResult.distance;

  // Check and deduct stamina
  const hasStamina = await staminaService.hasEnoughStamina(characterId, travelCost);
  if (!hasStamina) {
    const staminaInfo = await staminaService.getStaminaInfo(characterId);
    throw new AppError(
      `Insufficient stamina: have ${staminaInfo.current}, need ${travelCost}`,
      400
    );
  }

  // Deduct stamina
  await staminaService.deductStamina(characterId, travelCost);

  // Move all party characters to destination
  await query(
    `UPDATE characters SET current_node_id = $1
     WHERE user_id = $2 AND party_slot IS NOT NULL`,
    [targetNodeId, req.user.userId]
  );

  // Discover all intermediate nodes and their adjacents (player "travels through")
  const newDiscoveries = [];
  for (const nodeId of pathResult.path) {
    const beforeCount = await query(
      'SELECT COUNT(*) as count FROM user_node_discovery WHERE user_id = $1',
      [req.user.userId]
    );
    await query('SELECT discover_node_and_adjacent($1, $2)', [req.user.userId, nodeId]);
    const afterCount = await query(
      'SELECT COUNT(*) as count FROM user_node_discovery WHERE user_id = $1',
      [req.user.userId]
    );
    if (parseInt(afterCount.rows[0].count) > parseInt(beforeCount.rows[0].count)) {
      newDiscoveries.push(nodeId);
    }
  }

  // Get new node details
  const nodeResult = await query(
    `SELECT id, node_type, name, features, guild_class, local_seed, difficulty_tier
     FROM world_nodes WHERE id = $1`,
    [targetNodeId]
  );

  // Get path node details for animation
  const pathNodesResult = await query(
    `SELECT id, name, node_type, x_coord, y_coord FROM world_nodes WHERE id = ANY($1) ORDER BY array_position($1, id)`,
    [pathResult.path]
  );

  // Get character name for movement events
  const charNameResult = await query(
    'SELECT name FROM characters WHERE user_id = $1 AND party_slot = 1',
    [req.user.userId]
  );
  const characterName = charNameResult.rows[0]?.name || 'Unknown';

  // Update node presence tracking and broadcast events
  presenceService.moveNode(
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

  // Get updated stamina info
  const staminaInfo = await staminaService.getStaminaInfo(characterId);

  res.json({
    message: 'Traveled successfully',
    path: pathResult.path,
    pathNodes: pathNodesResult.rows,
    cost: travelCost,
    currentNode: nodeResult.rows[0],
    stamina: staminaInfo,
    newDiscoveries,
    playersAtNode: presenceService.getPlayersAtNode(targetNodeId)
  });
}));

// GET /api/world/current - Get current node + available actions
router.get('/current', authenticate, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT wn.id, wn.node_type, wn.name, wn.features, wn.guild_class,
            wn.local_seed, wn.difficulty_tier,
            CASE WHEN unc.node_id IS NOT NULL THEN true ELSE false END as cleared,
            CASE WHEN wn.node_type IN ('forest', 'cave', 'mountain', 'bridge')
                 AND unc.node_id IS NULL THEN true ELSE false END as blocked
     FROM characters c
     JOIN world_nodes wn ON c.current_node_id = wn.id
     LEFT JOIN user_node_clearance unc ON wn.id = unc.node_id AND unc.user_id = $1
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
