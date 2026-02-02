/**
 * @module world/navigation
 * @description World navigation routes - regions, nodes, pathfinding, travel
 *
 * Key responsibilities:
 * - Region listing and details
 * - Node discovery and details
 * - Path preview and travel
 * - Current location and presence
 *
 * @see ../world.js - Main router that composes this module
 */
import express from 'express';
import { query } from '../../config/database.js';
import { authenticate } from '../../middleware/auth.js';
import { travelLimiter } from '../../middleware/gameplayRateLimiter.js';
import { asyncHandler, AppError } from '../../middleware/errorHandler.js';
import presenceService from '../../services/presenceService.js';
import * as staminaService from '../../services/staminaService.js';
import * as dailyQuestService from '../../services/dailyQuestService.js';
import {
  getBlockedNodes,
  getVisitedNodes,
  findWorldPath
} from '../../services/world/pathfindingService.js';

const router = express.Router();

// Re-export pathfinding functions for backward compatibility
export { getBlockedNodes, getVisitedNodes, findWorldPath };

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

// GET /api/world/seed - Get global world seed
router.get('/seed', asyncHandler(async (req, res) => {
  const seed = parseInt(process.env.WORLD_SEED || '12345', 10);
  res.json({ seed });
}));

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
      'SELECT name FROM world_nodes WHERE id = ANY($1)',
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

  // Get new node details (including region for quest tracking)
  const nodeResult = await query(
    `SELECT wn.id, wn.node_type, wn.name, wn.features, wn.guild_class,
            wn.local_seed, wn.difficulty_tier, wn.region_id
     FROM world_nodes wn WHERE wn.id = $1`,
    [targetNodeId]
  );

  // Get path node details for animation
  const pathNodesResult = await query(
    'SELECT id, name, node_type, x_coord, y_coord FROM world_nodes WHERE id = ANY($1) ORDER BY array_position($1, id)',
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
  const { broadcastToRoom, rooms } = await import('../../websocket/index.js');

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

  // Daily/Weekly quest progress hooks (fire-and-forget pattern)
  const destNode = nodeResult.rows[0];

  // Track node visits (count all unique nodes in path)
  dailyQuestService.updateProgress(characterId, 'visit_nodes', pathResult.path.length, {
    nodeType: destNode.node_type
  }).catch(err => console.warn('[Quest] visit_nodes progress failed:', err.message));

  // Track region visits (only count unique new region if destination differs from origin)
  if (destNode.region_id) {
    // Get origin region
    const originRegion = await query(
      'SELECT region_id FROM world_nodes WHERE id = $1',
      [currentNodeId]
    );
    const originRegionId = originRegion.rows[0]?.region_id;

    // If we entered a new region, track it
    if (originRegionId !== destNode.region_id) {
      dailyQuestService.updateProgress(characterId, 'visit_regions', 1, {
        regionId: destNode.region_id
      }).catch(err => console.warn('[Quest] visit_regions progress failed:', err.message));
    }
  }

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
    `SELECT wn.id, wn.node_type, wn.name, wn.x_coord, wn.y_coord, wn.features, wn.guild_class,
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

export default router;
