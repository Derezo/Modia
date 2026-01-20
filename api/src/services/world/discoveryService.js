/**
 * Discovery Service - Node discovery and fog of war management
 */

import { query } from '../../config/database.js';

/**
 * Check if a node is discovered by a user
 * @param {number} userId - User ID
 * @param {number} nodeId - Node ID
 * @returns {Promise<boolean>} Whether node is discovered
 */
export async function isNodeDiscovered(userId, nodeId) {
  const result = await query(
    'SELECT 1 FROM user_node_discovery WHERE user_id = $1 AND node_id = $2',
    [userId, nodeId]
  );
  return result.rows.length > 0;
}

/**
 * Get all discovered node IDs for a user
 * @param {number} userId - User ID
 * @returns {Promise<Set<number>>} Set of discovered node IDs
 */
export async function getDiscoveredNodeIds(userId) {
  const result = await query(
    'SELECT node_id FROM user_node_discovery WHERE user_id = $1',
    [userId]
  );
  return new Set(result.rows.map(r => r.node_id));
}

/**
 * Discover a node and its adjacent nodes
 * Uses the database function discover_node_and_adjacent
 * @param {number} userId - User ID
 * @param {number} nodeId - Node ID to discover
 * @param {Object} client - Optional database client for transactions
 */
export async function discoverNodeAndAdjacent(userId, nodeId, client = null) {
  const queryFn = client ? client.query.bind(client) : query;
  await queryFn('SELECT discover_node_and_adjacent($1, $2)', [userId, nodeId]);
}

/**
 * Get discovery count before and after discovering a node
 * Used to determine how many new nodes were discovered
 * @param {number} userId - User ID
 * @param {number} nodeId - Node ID to discover
 * @returns {Promise<{before: number, after: number, newCount: number}>}
 */
export async function discoverAndCountNew(userId, nodeId) {
  const beforeResult = await query(
    'SELECT COUNT(*) as count FROM user_node_discovery WHERE user_id = $1',
    [userId]
  );
  const before = parseInt(beforeResult.rows[0].count, 10);

  await discoverNodeAndAdjacent(userId, nodeId);

  const afterResult = await query(
    'SELECT COUNT(*) as count FROM user_node_discovery WHERE user_id = $1',
    [userId]
  );
  const after = parseInt(afterResult.rows[0].count, 10);

  return {
    before,
    after,
    newCount: after - before
  };
}

/**
 * Get discovered nodes with full details for a user
 * @param {number} userId - User ID
 * @returns {Promise<Object[]>} Array of discovered nodes with details
 */
export async function getDiscoveredNodes(userId) {
  const result = await query(
    `SELECT
       wn.id,
       wn.x,
       wn.y,
       wn.name,
       wn.node_type,
       wn.region_id,
       wn.features,
       wn.difficulty_tier,
       und.discovered_at,
       und.discovery_method,
       CASE WHEN und.discovery_method = 'travel' THEN true ELSE false END as visited,
       CASE WHEN unc.node_id IS NOT NULL THEN true ELSE false END as cleared,
       wr.name as region_name,
       wr.race as region_race
     FROM world_nodes wn
     INNER JOIN user_node_discovery und ON wn.id = und.node_id
     LEFT JOIN user_node_clearance unc ON wn.id = unc.node_id AND unc.user_id = $1
     LEFT JOIN world_regions wr ON wn.region_id = wr.id
     WHERE und.user_id = $1`,
    [userId]
  );
  return result.rows;
}

/**
 * Get connections between discovered nodes
 * @param {number} userId - User ID
 * @returns {Promise<Object[]>} Array of connections
 */
export async function getDiscoveredConnections(userId) {
  const result = await query(
    `SELECT wnc.from_node_id, wnc.to_node_id
     FROM world_node_connections wnc
     WHERE wnc.from_node_id IN (SELECT node_id FROM user_node_discovery WHERE user_id = $1)
       AND wnc.to_node_id IN (SELECT node_id FROM user_node_discovery WHERE user_id = $1)`,
    [userId]
  );
  return result.rows;
}

/**
 * Get discovery statistics for a user
 * @param {number} userId - User ID
 * @returns {Promise<Object>} Discovery stats (overall and by region)
 */
export async function getDiscoveryStats(userId) {
  // Overall stats
  const overallResult = await query(
    `SELECT
       COUNT(*) FILTER (WHERE discovery_method = 'travel') as visited_count,
       COUNT(*) as discovered_count,
       (SELECT COUNT(*) FROM world_nodes) as total_count
     FROM user_node_discovery
     WHERE user_id = $1`,
    [userId]
  );

  // Stats by region
  const regionResult = await query(
    `SELECT
       wr.id,
       wr.name,
       wr.race,
       COUNT(und.node_id) FILTER (WHERE und.discovery_method = 'travel') as visited_count,
       COUNT(und.node_id) as discovered_count,
       COUNT(wn.id) as total_count
     FROM world_regions wr
     LEFT JOIN world_nodes wn ON wn.region_id = wr.id
     LEFT JOIN user_node_discovery und ON und.node_id = wn.id AND und.user_id = $1
     GROUP BY wr.id, wr.name, wr.race
     ORDER BY wr.name`,
    [userId]
  );

  const overall = overallResult.rows[0];

  return {
    overall: {
      visitedCount: parseInt(overall.visited_count || 0, 10),
      discoveredCount: parseInt(overall.discovered_count || 0, 10),
      totalCount: parseInt(overall.total_count || 0, 10)
    },
    byRegion: regionResult.rows.map(row => ({
      id: row.id,
      name: row.name,
      race: row.race,
      visitedCount: parseInt(row.visited_count || 0, 10),
      discoveredCount: parseInt(row.discovered_count || 0, 10),
      totalCount: parseInt(row.total_count || 0, 10)
    }))
  };
}

/**
 * Get region discovery stats for a specific region
 * @param {number} userId - User ID
 * @param {number} regionId - Region ID
 * @returns {Promise<Object>} Region discovery stats
 */
export async function getRegionDiscoveryStats(userId, regionId) {
  const result = await query(
    `SELECT
       COUNT(*) FILTER (WHERE und.discovery_method = 'travel') as visited_count,
       COUNT(*) as discovered_count,
       (SELECT COUNT(*) FROM world_nodes WHERE region_id = $2) as total_nodes
     FROM user_node_discovery und
     JOIN world_nodes wn ON wn.id = und.node_id
     WHERE und.user_id = $1 AND wn.region_id = $2`,
    [userId, regionId]
  );

  const stats = result.rows[0];
  return {
    visited: parseInt(stats.visited_count || 0, 10),
    discovered: parseInt(stats.discovered_count || 0, 10),
    total: parseInt(stats.total_nodes || 0, 10)
  };
}

/**
 * Record a lore discovery at a discovery node
 * @param {number} userId - User ID
 * @param {number} nodeId - Discovery node ID
 * @param {string|null} loreKey - Optional lore key
 * @returns {Promise<{isNew: boolean}>}
 */
export async function recordLoreDiscovery(userId, nodeId, loreKey = null) {
  // Check if already discovered
  const existing = await query(
    'SELECT 1 FROM user_discoveries WHERE user_id = $1 AND node_id = $2',
    [userId, nodeId]
  );

  if (existing.rows.length > 0) {
    return { isNew: false };
  }

  // Record the discovery
  await query(
    `INSERT INTO user_discoveries (user_id, node_id, lore_key)
     VALUES ($1, $2, $3)`,
    [userId, nodeId, loreKey]
  );

  return { isNew: true };
}

/**
 * Get user's lore discoveries
 * @param {number} userId - User ID
 * @returns {Promise<Object[]>} Array of discoveries with node info
 */
export async function getUserLoreDiscoveries(userId) {
  const result = await query(
    `SELECT ud.discovered_at, ud.lore_key, wn.name, wn.id as node_id
     FROM user_discoveries ud
     JOIN world_nodes wn ON wn.id = ud.node_id
     WHERE ud.user_id = $1
     ORDER BY ud.discovered_at DESC`,
    [userId]
  );

  const totalResult = await query(
    'SELECT COUNT(*) as total FROM world_nodes WHERE node_type = \'discovery\''
  );

  return {
    discoveries: result.rows,
    discoveredCount: result.rows.length,
    totalCount: parseInt(totalResult.rows[0].total, 10)
  };
}
