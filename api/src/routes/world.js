import express from 'express';
import { query, withTransaction } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { travelLimiter } from '../middleware/gameplayRateLimiter.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import presenceService from '../services/presenceService.js';
import * as staminaService from '../services/staminaService.js';
import { SHRINE_BUFFS, SHRINE_COOLDOWN_HOURS } from '../../../shared/constants.js';

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

// ============================================================================
// REGION ENDPOINTS (Multi-castle support)
// ============================================================================

// GET /api/world/regions - List all regions with their castles
router.get('/regions', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  // Get all regions with their key node details
  const regionsResult = await query(
    `SELECT
       wr.id,
       wr.race,
       wr.dominant_terrain,
       wr.secondary_terrains,
       wr.boundary_polygon,
       wr.castle_node_id,
       wr.keep_node_id,
       wr.guild_node_id,
       -- Castle node details
       cn.name as castle_name,
       cn.x_coord as castle_x,
       cn.y_coord as castle_y,
       -- Keep node details
       kn.name as keep_name,
       kn.x_coord as keep_x,
       kn.y_coord as keep_y,
       -- Guild node details
       gn.name as guild_name,
       gn.x_coord as guild_x,
       gn.y_coord as guild_y,
       gn.guild_class,
       -- Node counts per region
       (SELECT COUNT(*) FROM world_nodes WHERE region_id = wr.id) as total_nodes,
       -- Discovered nodes in this region for the user
       (SELECT COUNT(*)
        FROM user_node_discovery und
        JOIN world_nodes wn ON wn.id = und.node_id
        WHERE und.user_id = $1 AND wn.region_id = wr.id) as discovered_nodes
     FROM world_regions wr
     LEFT JOIN world_nodes cn ON cn.id = wr.castle_node_id
     LEFT JOIN world_nodes kn ON kn.id = wr.keep_node_id
     LEFT JOIN world_nodes gn ON gn.id = wr.guild_node_id
     ORDER BY wr.id`
    , [userId]
  );

  // Transform to structured response
  const regions = regionsResult.rows.map(row => ({
    id: row.id,
    race: row.race,
    dominantTerrain: row.dominant_terrain,
    secondaryTerrains: row.secondary_terrains,
    boundaryPolygon: row.boundary_polygon,
    castle: row.castle_node_id ? {
      nodeId: row.castle_node_id,
      name: row.castle_name,
      x: row.castle_x,
      y: row.castle_y
    } : null,
    keep: row.keep_node_id ? {
      nodeId: row.keep_node_id,
      name: row.keep_name,
      x: row.keep_x,
      y: row.keep_y
    } : null,
    guild: row.guild_node_id ? {
      nodeId: row.guild_node_id,
      name: row.guild_name,
      x: row.guild_x,
      y: row.guild_y,
      guildClass: row.guild_class
    } : null,
    nodeStats: {
      total: parseInt(row.total_nodes, 10),
      discovered: parseInt(row.discovered_nodes, 10)
    }
  }));

  res.json({ regions });
}));

// GET /api/world/regions/:regionId - Get single region details
router.get('/regions/:regionId', authenticate, asyncHandler(async (req, res) => {
  const { regionId } = req.params;
  const userId = req.user.userId;

  if (!regionId || isNaN(parseInt(regionId, 10))) {
    throw new AppError('Invalid region ID', 400);
  }

  const regionResult = await query(
    `SELECT
       wr.id,
       wr.race,
       wr.dominant_terrain,
       wr.secondary_terrains,
       wr.boundary_polygon,
       wr.castle_node_id,
       wr.keep_node_id,
       wr.guild_node_id,
       wr.created_at,
       -- Castle node details
       cn.name as castle_name,
       cn.x_coord as castle_x,
       cn.y_coord as castle_y,
       cn.features as castle_features,
       -- Keep node details
       kn.name as keep_name,
       kn.x_coord as keep_x,
       kn.y_coord as keep_y,
       kn.features as keep_features,
       -- Guild node details
       gn.name as guild_name,
       gn.x_coord as guild_x,
       gn.y_coord as guild_y,
       gn.guild_class,
       gn.features as guild_features
     FROM world_regions wr
     LEFT JOIN world_nodes cn ON cn.id = wr.castle_node_id
     LEFT JOIN world_nodes kn ON kn.id = wr.keep_node_id
     LEFT JOIN world_nodes gn ON gn.id = wr.guild_node_id
     WHERE wr.id = $1`,
    [regionId]
  );

  if (regionResult.rows.length === 0) {
    throw new AppError('Region not found', 404);
  }

  const row = regionResult.rows[0];

  // Get node counts by type for this region
  const nodeStatsResult = await query(
    `SELECT
       node_type,
       COUNT(*) as count
     FROM world_nodes
     WHERE region_id = $1
     GROUP BY node_type
     ORDER BY node_type`,
    [regionId]
  );

  // Get ring distribution for this region
  const ringStatsResult = await query(
    `SELECT
       ring_distance,
       COUNT(*) as count
     FROM world_nodes
     WHERE region_id = $1 AND ring_distance IS NOT NULL
     GROUP BY ring_distance
     ORDER BY ring_distance`,
    [regionId]
  );

  // Get user's discovery progress in this region
  const discoveryResult = await query(
    `SELECT
       COUNT(*) FILTER (WHERE und.discovery_method = 'travel') as visited_count,
       COUNT(*) as discovered_count,
       (SELECT COUNT(*) FROM world_nodes WHERE region_id = $2) as total_nodes
     FROM user_node_discovery und
     JOIN world_nodes wn ON wn.id = und.node_id
     WHERE und.user_id = $1 AND wn.region_id = $2`,
    [userId, regionId]
  );

  // Get user's clearance progress in this region
  const clearanceResult = await query(
    `SELECT
       COUNT(*) as cleared_count,
       (SELECT COUNT(*) FROM world_nodes
        WHERE region_id = $2 AND node_type IN ('forest', 'cave', 'mountain', 'bridge')) as clearable_nodes
     FROM user_node_clearance unc
     JOIN world_nodes wn ON wn.id = unc.node_id
     WHERE unc.user_id = $1 AND wn.region_id = $2`,
    [userId, regionId]
  );

  const nodeStats = {};
  for (const stat of nodeStatsResult.rows) {
    nodeStats[stat.node_type] = parseInt(stat.count, 10);
  }

  const ringStats = {};
  for (const stat of ringStatsResult.rows) {
    ringStats[`ring${stat.ring_distance}`] = parseInt(stat.count, 10);
  }

  const discovery = discoveryResult.rows[0];
  const clearance = clearanceResult.rows[0];

  const region = {
    id: row.id,
    race: row.race,
    dominantTerrain: row.dominant_terrain,
    secondaryTerrains: row.secondary_terrains,
    boundaryPolygon: row.boundary_polygon,
    createdAt: row.created_at,
    castle: row.castle_node_id ? {
      nodeId: row.castle_node_id,
      name: row.castle_name,
      x: row.castle_x,
      y: row.castle_y,
      features: row.castle_features
    } : null,
    keep: row.keep_node_id ? {
      nodeId: row.keep_node_id,
      name: row.keep_name,
      x: row.keep_x,
      y: row.keep_y,
      features: row.keep_features
    } : null,
    guild: row.guild_node_id ? {
      nodeId: row.guild_node_id,
      name: row.guild_name,
      x: row.guild_x,
      y: row.guild_y,
      guildClass: row.guild_class,
      features: row.guild_features
    } : null,
    nodeStats,
    ringStats,
    userProgress: {
      visited: parseInt(discovery.visited_count, 10),
      discovered: parseInt(discovery.discovered_count, 10),
      total: parseInt(discovery.total_nodes, 10),
      cleared: parseInt(clearance.cleared_count, 10),
      clearable: parseInt(clearance.clearable_nodes, 10)
    }
  };

  res.json({ region });
}));

// GET /api/world/nodes - Get discovered nodes for user (fog of war + clearance status)
router.get('/nodes', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  // Get only discovered nodes for this user, including clearance status and region info
  const result = await query(
    `SELECT wn.id, wn.node_type, wn.name, wn.x_coord, wn.y_coord, wn.distance_from_center,
            wn.features, wn.guild_class, wn.local_seed, wn.difficulty_tier,
            wn.region_id, wn.region_race, wn.ring_distance,
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
    `SELECT wn.id, wn.node_type, wn.name, wn.x_coord, wn.y_coord, wn.distance_from_center,
            wn.features, wn.guild_class, wn.local_seed, wn.difficulty_tier,
            wn.region_id, wn.region_race, wn.ring_distance,
            wr.race as region_name, wr.dominant_terrain as region_terrain
     FROM world_nodes wn
     LEFT JOIN world_regions wr ON wr.id = wn.region_id
     WHERE wn.id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new AppError('Node not found', 404);
  }

  // Get connected nodes with their region info
  const connectionsResult = await query(
    `SELECT wn.id, wn.node_type, wn.name, wn.region_id, wn.region_race, wnc.path_type
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

  // Get node names along the path with clearance and region info
  const pathNodesResult = await query(
    `SELECT wn.id, wn.name, wn.node_type,
            wn.region_id, wn.region_race,
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

  // Detect region crossings in the path
  const pathNodes = pathNodesResult.rows;
  const regionsCrossed = [];
  let prevRegionId = null;
  for (const node of pathNodes) {
    if (node.region_id !== prevRegionId && node.region_id !== null) {
      regionsCrossed.push({
        regionId: node.region_id,
        regionRace: node.region_race,
        entryNodeId: node.id,
        entryNodeName: node.name
      });
      prevRegionId = node.region_id;
    }
  }

  res.json({
    path: pathResult.path,
    pathNodes,
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
    cannotReachFromOrigin,
    // Cross-region travel info
    regionsCrossed,
    crossesRegions: regionsCrossed.length > 1
  });
}));

// POST /api/world/travel - Move party to any discovered node
router.post('/travel', authenticate, travelLimiter, asyncHandler(async (req, res) => {
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
            wn.region_id, wn.region_race, wn.ring_distance,
            wr.race as region_name, wr.dominant_terrain as region_terrain,
            wr.castle_node_id as region_castle_id,
            CASE WHEN unc.node_id IS NOT NULL THEN true ELSE false END as cleared,
            CASE WHEN wn.node_type IN ('forest', 'cave', 'mountain', 'bridge')
                 AND unc.node_id IS NULL THEN true ELSE false END as blocked
     FROM characters c
     JOIN world_nodes wn ON c.current_node_id = wn.id
     LEFT JOIN world_regions wr ON wr.id = wn.region_id
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

  // Build region info object
  const regionInfo = node.region_id ? {
    id: node.region_id,
    race: node.region_race,
    name: node.region_name,
    terrain: node.region_terrain,
    castleNodeId: node.region_castle_id,
    ringDistance: node.ring_distance
  } : null;

  res.json({
    currentNode: node,
    region: regionInfo,
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

  // Overall stats
  const stats = await query(
    `SELECT
       COUNT(*) FILTER (WHERE discovery_method = 'travel') as visited_count,
       COUNT(*) as discovered_count,
       (SELECT COUNT(*) FROM world_nodes) as total_nodes
     FROM user_node_discovery
     WHERE user_id = $1`,
    [userId]
  );

  // Per-region stats
  const regionStats = await query(
    `SELECT
       wr.id as region_id,
       wr.race as region_race,
       COUNT(und.node_id) FILTER (WHERE und.discovery_method = 'travel') as visited_count,
       COUNT(und.node_id) as discovered_count,
       (SELECT COUNT(*) FROM world_nodes WHERE region_id = wr.id) as total_nodes
     FROM world_regions wr
     LEFT JOIN world_nodes wn ON wn.region_id = wr.id
     LEFT JOIN user_node_discovery und ON und.node_id = wn.id AND und.user_id = $1
     GROUP BY wr.id, wr.race
     ORDER BY wr.id`,
    [userId]
  );

  res.json({
    ...stats.rows[0],
    byRegion: regionStats.rows.map(row => ({
      regionId: row.region_id,
      regionRace: row.region_race,
      visitedCount: parseInt(row.visited_count || 0, 10),
      discoveredCount: parseInt(row.discovered_count || 0, 10),
      totalNodes: parseInt(row.total_nodes, 10)
    }))
  });
}));

// GET /api/world/obstacles - Get terrain obstacles for world map rendering
router.get('/obstacles', authenticate, asyncHandler(async (req, res) => {
  const obstacles = await query(
    `SELECT id, obstacle_type, x, y, radius, length, angle
     FROM world_obstacles
     ORDER BY id`
  );

  res.json({ obstacles: obstacles.rows });
}));

// ============================================================================
// TERMINATOR NODE ENDPOINTS (Chest, Shrine, Discovery)
// ============================================================================

/**
 * Verify user is physically at a node
 * @param {number} userId - User ID
 * @param {number} nodeId - Node ID to check
 * @returns {Promise<boolean>} True if user is at the node
 */
async function verifyUserAtNode(userId, nodeId) {
  const result = await query(
    `SELECT 1 FROM characters
     WHERE user_id = $1 AND party_slot = 1 AND current_node_id = $2`,
    [userId, nodeId]
  );
  return result.rows.length > 0;
}

// Maximum gold value to prevent integer overflow
const MAX_GOLD = 2147483647;

// POST /api/world/nodes/:id/claim-chest - Claim one-time chest loot
router.post('/nodes/:id/claim-chest', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const nodeId = parseInt(req.params.id, 10);

  // Verify user is at this node
  const atNode = await verifyUserAtNode(userId, nodeId);
  if (!atNode) {
    throw new AppError('You must be at this location to claim the treasure', 400);
  }

  // Verify the node exists and is a chest type
  const nodeResult = await query(
    'SELECT id, node_type, distance_from_center FROM world_nodes WHERE id = $1',
    [nodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new AppError('Node not found', 404);
  }

  const node = nodeResult.rows[0];
  if (node.node_type !== 'chest') {
    throw new AppError('This node is not a treasure chest', 400);
  }

  // Generate loot based on distance (farther = better rewards)
  const distance = node.distance_from_center;
  const baseGold = 100 + (distance * 15);
  const goldVariance = Math.floor(baseGold * 0.2);
  const goldAwarded = baseGold + Math.floor(Math.random() * goldVariance * 2) - goldVariance;

  // TODO: Add item drops based on distance tier
  const itemsAwarded = [];

  // Atomically insert claim - prevents race condition via unique constraint
  // ON CONFLICT DO NOTHING returns 0 rows if already claimed
  const claimResult = await query(
    `INSERT INTO user_chest_claims (user_id, node_id, gold_awarded, items_awarded)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, node_id) DO NOTHING
     RETURNING id`,
    [userId, nodeId, goldAwarded, JSON.stringify(itemsAwarded)]
  );

  if (claimResult.rows.length === 0) {
    throw new AppError('You have already claimed this treasure', 400);
  }

  // Award gold to user's active character with overflow protection
  const charResult = await query(
    `UPDATE characters SET gold = LEAST(gold + $1, $3)
     WHERE user_id = $2 AND is_active = true
     RETURNING id, gold`,
    [goldAwarded, userId, MAX_GOLD]
  );

  res.json({
    success: true,
    gold_awarded: goldAwarded,
    items_awarded: itemsAwarded,
    new_gold_balance: charResult.rows[0]?.gold || null,
    message: `You found ${goldAwarded} gold in the treasure chest!`
  });
}));

// POST /api/world/nodes/:id/visit-shrine - Apply shrine buff
router.post('/nodes/:id/visit-shrine', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const nodeId = parseInt(req.params.id, 10);

  // Verify user is at this node
  const atNode = await verifyUserAtNode(userId, nodeId);
  if (!atNode) {
    throw new AppError('You must be at this location to receive the blessing', 400);
  }

  // Verify the node exists and is a shrine type
  const nodeResult = await query(
    'SELECT id, node_type, shrine_buff_type FROM world_nodes WHERE id = $1',
    [nodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new AppError('Node not found', 404);
  }

  const node = nodeResult.rows[0];
  if (node.node_type !== 'shrine') {
    throw new AppError('This node is not a shrine', 400);
  }

  const buffType = node.shrine_buff_type;
  const buffInfo = SHRINE_BUFFS[buffType];
  if (!buffInfo) {
    throw new AppError('Invalid shrine buff type', 500);
  }

  // Check cooldown
  const visitCheck = await query(
    `SELECT expires_at, last_visited_at FROM user_shrine_visits
     WHERE user_id = $1 AND node_id = $2`,
    [userId, nodeId]
  );

  const now = new Date();
  if (visitCheck.rows.length > 0) {
    const lastVisit = new Date(visitCheck.rows[0].last_visited_at);
    const cooldownMs = SHRINE_COOLDOWN_HOURS * 60 * 60 * 1000;
    if (now - lastVisit < cooldownMs) {
      const remainingMs = cooldownMs - (now - lastVisit);
      const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
      throw new AppError(`Shrine is on cooldown. Return in ${remainingHours} hour(s).`, 400);
    }
  }

  // Calculate expiration time
  const expiresAt = new Date(now.getTime() + buffInfo.duration * 60 * 60 * 1000);

  // Upsert the shrine visit
  await query(
    `INSERT INTO user_shrine_visits (user_id, node_id, buff_type, expires_at, last_visited_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, node_id) DO UPDATE SET
       buff_type = $3,
       expires_at = $4,
       last_visited_at = $5`,
    [userId, nodeId, buffType, expiresAt, now]
  );

  res.json({
    success: true,
    buff_name: buffInfo.name,
    buff_description: buffInfo.description,
    expires_at: expiresAt,
    duration_hours: buffInfo.duration,
    message: `You received the blessing: ${buffInfo.name}!`
  });
}));

// GET /api/world/active-buffs - Get user's active shrine buffs
router.get('/active-buffs', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  const buffs = await query(
    `SELECT usv.buff_type, usv.expires_at, wn.name as shrine_name
     FROM user_shrine_visits usv
     JOIN world_nodes wn ON wn.id = usv.node_id
     WHERE usv.user_id = $1 AND usv.expires_at > NOW()
     ORDER BY usv.expires_at ASC`,
    [userId]
  );

  const activeBuffs = buffs.rows.map(buff => ({
    buff_type: buff.buff_type,
    buff_info: SHRINE_BUFFS[buff.buff_type],
    expires_at: buff.expires_at,
    shrine_name: buff.shrine_name
  }));

  res.json({ buffs: activeBuffs });
}));

// POST /api/world/nodes/:id/discover - Unlock discovery content
router.post('/nodes/:id/discover', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const nodeId = parseInt(req.params.id, 10);

  // Verify user is at this node
  const atNode = await verifyUserAtNode(userId, nodeId);
  if (!atNode) {
    throw new AppError('You must be at this location to explore the discovery', 400);
  }

  // Verify the node exists and is a discovery type
  const nodeResult = await query(
    'SELECT id, node_type, lore_key, name FROM world_nodes WHERE id = $1',
    [nodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new AppError('Node not found', 404);
  }

  const node = nodeResult.rows[0];
  if (node.node_type !== 'discovery') {
    throw new AppError('This node is not a discovery site', 400);
  }

  // Check if already discovered
  const discoveryCheck = await query(
    'SELECT 1 FROM user_discoveries WHERE user_id = $1 AND node_id = $2',
    [userId, nodeId]
  );

  const alreadyDiscovered = discoveryCheck.rows.length > 0;

  if (!alreadyDiscovered) {
    // Record the discovery
    await query(
      `INSERT INTO user_discoveries (user_id, node_id, lore_key)
       VALUES ($1, $2, $3)`,
      [userId, nodeId, node.lore_key]
    );
  }

  // TODO: Return actual lore content based on lore_key
  const loreContent = {
    title: node.name,
    text: `You discovered ancient secrets at ${node.name}. The mysteries of this place have been recorded in your journal.`,
    lore_key: node.lore_key
  };

  res.json({
    success: true,
    already_discovered: alreadyDiscovered,
    lore: loreContent,
    message: alreadyDiscovered
      ? `You revisit the ${node.name}, recalling its secrets.`
      : `You have discovered ${node.name}!`
  });
}));

// GET /api/world/watchtower-view/:nodeId - Get extended view from a watchtower
router.get('/watchtower-view/:nodeId', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const nodeId = parseInt(req.params.nodeId, 10);

  if (isNaN(nodeId)) {
    throw new AppError('Invalid node ID', 400);
  }

  // Verify the node exists and is a watchtower
  const nodeResult = await query(
    `SELECT id, node_type, name, x_coord, y_coord, watchtower_reveal_radius,
            region_id, region_race, ring_distance, features
     FROM world_nodes WHERE id = $1`,
    [nodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new AppError('Node not found', 404);
  }

  const watchtowerNode = nodeResult.rows[0];

  if (watchtowerNode.node_type !== 'watchtower') {
    throw new AppError('This node is not a watchtower', 400);
  }

  // Use the watchtower's reveal radius (default 4 if not set)
  const revealRadius = watchtowerNode.watchtower_reveal_radius ?? 4;

  // Get all connections to build adjacency map
  const connectionsResult = await query(
    'SELECT from_node_id, to_node_id FROM world_node_connections'
  );

  const adjacency = buildAdjacencyMap(connectionsResult.rows);

  // BFS to find all nodes within reveal radius
  const visited = new Map(); // nodeId -> distance from watchtower
  visited.set(nodeId, 0);
  const queue = [{ nodeId, distance: 0 }];
  const revealedNodeIds = [nodeId];

  while (queue.length > 0) {
    const { nodeId: currentId, distance } = queue.shift();

    // Don't expand beyond reveal radius
    if (distance >= revealRadius) {
      continue;
    }

    const neighbors = adjacency.get(currentId) || new Set();
    for (const neighborId of neighbors) {
      if (!visited.has(neighborId)) {
        const newDistance = distance + 1;
        visited.set(neighborId, newDistance);
        revealedNodeIds.push(neighborId);
        queue.push({ nodeId: neighborId, distance: newDistance });
      }
    }
  }

  // Fetch node details for all revealed nodes
  const nodesResult = await query(
    `SELECT wn.id, wn.x_coord, wn.y_coord, wn.node_type, wn.name,
            wn.region_id, wn.region_race, wn.ring_distance, wn.difficulty_tier,
            CASE WHEN und.node_id IS NOT NULL THEN true ELSE false END as discovered
     FROM world_nodes wn
     LEFT JOIN user_node_discovery und ON und.node_id = wn.id AND und.user_id = $2
     WHERE wn.id = ANY($1)`,
    [revealedNodeIds, userId]
  );

  // Get connections between revealed nodes
  const revealedConnectionsResult = await query(
    `SELECT from_node_id, to_node_id
     FROM world_node_connections
     WHERE from_node_id = ANY($1) AND to_node_id = ANY($1)`,
    [revealedNodeIds]
  );

  // Format revealed nodes - include name only if discovered
  const revealedNodes = nodesResult.rows.map(node => ({
    id: node.id,
    x_coord: node.x_coord,
    y_coord: node.y_coord,
    node_type: node.node_type,
    name: node.discovered ? node.name : null,
    discovered: node.discovered,
    region_id: node.region_id,
    region_race: node.region_race,
    difficulty_tier: node.difficulty_tier,
    distance_from_watchtower: visited.get(node.id)
  }));

  res.json({
    watchtowerNode: {
      id: watchtowerNode.id,
      name: watchtowerNode.name,
      x_coord: watchtowerNode.x_coord,
      y_coord: watchtowerNode.y_coord,
      node_type: watchtowerNode.node_type,
      region_id: watchtowerNode.region_id,
      region_race: watchtowerNode.region_race,
      reveal_radius: revealRadius
    },
    revealedNodes,
    revealedConnections: revealedConnectionsResult.rows
  });
}));

// GET /api/world/my-discoveries - Get user's discovery progress
router.get('/my-discoveries', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  const discoveries = await query(
    `SELECT ud.discovered_at, ud.lore_key, wn.name, wn.id as node_id
     FROM user_discoveries ud
     JOIN world_nodes wn ON wn.id = ud.node_id
     WHERE ud.user_id = $1
     ORDER BY ud.discovered_at DESC`,
    [userId]
  );

  const totalDiscoveries = await query(
    `SELECT COUNT(*) as total FROM world_nodes WHERE node_type = 'discovery'`
  );

  res.json({
    discoveries: discoveries.rows,
    discovered_count: discoveries.rows.length,
    total_count: parseInt(totalDiscoveries.rows[0].total, 10)
  });
}));

// ============================================================================
// GOLD SINK ENDPOINTS (Fast Travel, Stamina Restore)
// ============================================================================

// GET /api/world/fast-travel/destinations - Get available fast travel destinations
router.get('/fast-travel/destinations', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  // Check if user has the Wayfarer's Compass relic
  const relicCheck = await query(
    `SELECT 1 FROM user_relics ur
     JOIN relic_templates rt ON rt.id = ur.relic_id
     WHERE ur.user_id = $1 AND rt.key = 'wayfarers_compass'`,
    [userId]
  );

  const hasRelic = relicCheck.rows.length > 0;

  // Get user's current location
  const charResult = await query(
    `SELECT c.current_node_id, wn.region_id as current_region_id
     FROM characters c
     JOIN world_nodes wn ON wn.id = c.current_node_id
     WHERE c.user_id = $1 AND c.party_slot = 1`,
    [userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('No active party character', 400);
  }

  const currentRegionId = charResult.rows[0].current_region_id;

  // Get all region castles as potential destinations
  const castlesResult = await query(
    `SELECT
       wr.id as region_id,
       wr.race as region_race,
       wn.id as node_id,
       wn.name,
       wn.x_coord,
       wn.y_coord
     FROM world_regions wr
     JOIN world_nodes wn ON wn.id = wr.castle_node_id
     ORDER BY wr.id`
  );

  // Calculate costs for each destination
  const baseCost = 100;
  const costPerRegion = 50;

  const destinations = castlesResult.rows.map(castle => {
    const regionDistance = Math.abs(castle.region_id - currentRegionId);
    const cost = baseCost + (regionDistance * costPerRegion);

    return {
      nodeId: castle.node_id,
      name: castle.name,
      regionId: castle.region_id,
      regionRace: castle.region_race,
      x: castle.x_coord,
      y: castle.y_coord,
      cost,
      isCurrentRegion: castle.region_id === currentRegionId
    };
  });

  res.json({
    hasRelic,
    currentRegionId,
    destinations
  });
}));

// POST /api/world/fast-travel - Fast travel to a region castle
router.post('/fast-travel', authenticate, travelLimiter, asyncHandler(async (req, res) => {
  const { targetNodeId } = req.body;
  const userId = req.user.userId;

  if (!targetNodeId) {
    throw new AppError('targetNodeId is required', 400);
  }

  // Check if user has the Wayfarer's Compass relic
  const relicCheck = await query(
    `SELECT rt.effects FROM user_relics ur
     JOIN relic_templates rt ON rt.id = ur.relic_id
     WHERE ur.user_id = $1 AND rt.key = 'wayfarers_compass'`,
    [userId]
  );

  if (relicCheck.rows.length === 0) {
    throw new AppError('You need the Wayfarer\'s Compass to use fast travel', 400);
  }

  // Verify target is a castle node
  const targetCheck = await query(
    `SELECT wn.id, wn.name, wn.region_id, wr.id as castle_region_id
     FROM world_nodes wn
     JOIN world_regions wr ON wr.castle_node_id = wn.id
     WHERE wn.id = $1`,
    [targetNodeId]
  );

  if (targetCheck.rows.length === 0) {
    throw new AppError('Fast travel is only available to region castles', 400);
  }

  const targetCastle = targetCheck.rows[0];

  // Get user's current position and check if in battle
  const charResult = await query(
    `SELECT c.id as character_id, c.current_node_id, c.name, wn.region_id as current_region_id, c.in_battle
     FROM characters c
     JOIN world_nodes wn ON wn.id = c.current_node_id
     WHERE c.user_id = $1 AND c.party_slot = 1`,
    [userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('No active party character', 400);
  }

  const character = charResult.rows[0];

  if (character.in_battle) {
    throw new AppError('Cannot fast travel while in battle', 400);
  }

  // Already at destination
  if (character.current_node_id === targetNodeId) {
    throw new AppError('Already at destination', 400);
  }

  // Calculate cost
  const baseCost = 100;
  const costPerRegion = 50;
  const regionDistance = Math.abs(targetCastle.castle_region_id - character.current_region_id);
  const goldCost = baseCost + (regionDistance * costPerRegion);

  // Perform all database mutations in a transaction
  const { newGold } = await withTransaction(async (client) => {
    // Check and deduct gold
    const goldResult = await client.query(
      `UPDATE users
       SET gold = gold - $1
       WHERE id = $2 AND gold >= $1
       RETURNING gold`,
      [goldCost, userId]
    );

    if (goldResult.rows.length === 0) {
      const userGold = await client.query('SELECT gold FROM users WHERE id = $1', [userId]);
      const currentGold = userGold.rows[0]?.gold || 0;
      throw new AppError(`Insufficient gold. Need ${goldCost}, have ${currentGold}`, 400);
    }

    // Move all party characters to destination
    await client.query(
      `UPDATE characters SET current_node_id = $1
       WHERE user_id = $2 AND party_slot IS NOT NULL`,
      [targetNodeId, userId]
    );

    // Discover the destination node (if not already discovered)
    await client.query('SELECT discover_node_and_adjacent($1, $2)', [userId, targetNodeId]);

    // Log the fast travel
    await client.query(
      `INSERT INTO fast_travel_log (user_id, character_id, from_node_id, to_node_id, gold_cost)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, character.character_id, character.current_node_id, targetNodeId, goldCost]
    );

    return { newGold: goldResult.rows[0].gold };
  });

  // Update presence (outside transaction - non-critical)
  presenceService.moveNode(
    character.current_node_id,
    targetNodeId,
    userId,
    req.user.username,
    character.name || 'Unknown'
  );

  // Get updated stamina info
  const staminaInfo = await staminaService.getStaminaInfo(character.character_id);

  res.json({
    success: true,
    message: `Traveled to ${targetCastle.name}`,
    goldSpent: goldCost,
    newGold,
    destination: {
      nodeId: targetNodeId,
      name: targetCastle.name,
      regionId: targetCastle.castle_region_id
    },
    stamina: staminaInfo
  });
}));

// POST /api/world/stamina/restore - Restore stamina at a town for gold
router.post('/stamina/restore', authenticate, asyncHandler(async (req, res) => {
  const { amount } = req.body;
  const userId = req.user.userId;

  // Improved input validation
  const parsedAmount = parseInt(amount, 10);
  if (isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > 100) {
    throw new AppError('amount must be a positive integer (1-100)', 400);
  }

  // Check if user has the Vitality Charm relic
  const relicCheck = await query(
    `SELECT rt.effects FROM user_relics ur
     JOIN relic_templates rt ON rt.id = ur.relic_id
     WHERE ur.user_id = $1 AND rt.key = 'vitality_charm'`,
    [userId]
  );

  if (relicCheck.rows.length === 0) {
    throw new AppError('You need the Vitality Charm to restore stamina for gold', 400);
  }

  const relicEffects = relicCheck.rows[0].effects || {};
  const costPerPoint = relicEffects.cost_per_point || 100;

  // Get user's current location and character
  const charResult = await query(
    `SELECT c.id as character_id, c.current_node_id, wn.node_type
     FROM characters c
     JOIN world_nodes wn ON wn.id = c.current_node_id
     WHERE c.user_id = $1 AND c.party_slot = 1`,
    [userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('No active party character', 400);
  }

  const character = charResult.rows[0];

  // Verify character is at a town node
  if (character.node_type !== 'town') {
    throw new AppError('Stamina restore is only available at town nodes', 400);
  }

  // Perform stamina restore and logging in a transaction
  const result = await withTransaction(async (client) => {
    // Restore stamina for gold (service handles gold deduction and stamina update)
    const restoreResult = await staminaService.restoreStaminaForGoldWithClient(
      client,
      userId,
      character.character_id,
      parsedAmount,
      costPerPoint
    );

    // Log the stamina restore
    await client.query(
      `INSERT INTO stamina_restore_log (user_id, character_id, node_id, stamina_amount, gold_cost)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, character.character_id, character.current_node_id, restoreResult.staminaRestored, restoreResult.goldSpent]
    );

    return restoreResult;
  });

  res.json({
    success: true,
    message: `Restored ${result.staminaRestored} stamina for ${result.goldSpent} gold`,
    staminaRestored: result.staminaRestored,
    goldSpent: result.goldSpent,
    newGold: result.newGold,
    stamina: result.stamina
  });
}));

export default router;
