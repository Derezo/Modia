/**
 * Region Service - World region queries and data
 */

import { query } from '../../config/database.js';

/**
 * Get all regions with node counts
 * @param {number|null} userId - Optional user ID for discovery stats
 * @returns {Promise<Object[]>} Array of regions with stats
 */
export async function getAllRegions(userId = null) {
  let sql;
  const params = [];

  if (userId) {
    params.push(userId);
    sql = `
      SELECT
        wr.id,
        wr.name,
        wr.race,
        wr.description,
        COUNT(wn.id) as node_count,
        (SELECT COUNT(*)
         FROM user_node_discovery und
         WHERE und.user_id = $1 AND wn.region_id = wr.id) as discovered_nodes
      FROM world_regions wr
      LEFT JOIN world_nodes wn ON wn.region_id = wr.id
      GROUP BY wr.id, wr.name, wr.race, wr.description
      ORDER BY wr.name`;
  } else {
    sql = `
      SELECT
        wr.id,
        wr.name,
        wr.race,
        wr.description,
        COUNT(wn.id) as node_count
      FROM world_regions wr
      LEFT JOIN world_nodes wn ON wn.region_id = wr.id
      GROUP BY wr.id, wr.name, wr.race, wr.description
      ORDER BY wr.name`;
  }

  const result = await query(sql, params);

  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    race: row.race,
    description: row.description,
    nodeCount: parseInt(row.node_count, 10),
    discovered: row.discovered_nodes ? parseInt(row.discovered_nodes, 10) : undefined
  }));
}

/**
 * Get region by ID
 * @param {number} regionId - Region ID
 * @returns {Promise<Object|null>} Region data or null
 */
export async function getRegionById(regionId) {
  const result = await query(
    'SELECT * FROM world_regions WHERE id = $1',
    [regionId]
  );
  return result.rows[0] || null;
}

/**
 * Get region by race name
 * @param {string} race - Race name (human, elf, dwarf, vampire, orc)
 * @returns {Promise<Object|null>} Region data or null
 */
export async function getRegionByRace(race) {
  const result = await query(
    'SELECT * FROM world_regions WHERE race = $1',
    [race.toLowerCase()]
  );
  return result.rows[0] || null;
}

/**
 * Get region details with full node information
 * @param {number} regionId - Region ID
 * @param {number} userId - User ID for discovery/clearance status
 * @returns {Promise<Object>} Region with nodes and stats
 */
export async function getRegionDetails(regionId, userId) {
  // Get region info
  const regionResult = await query(
    'SELECT * FROM world_regions WHERE id = $1',
    [regionId]
  );

  if (regionResult.rows.length === 0) {
    return null;
  }

  const region = regionResult.rows[0];

  // Get nodes with user status
  const nodesResult = await query(
    `SELECT
       wn.*,
       CASE WHEN und.node_id IS NOT NULL THEN true ELSE false END as discovered,
       CASE WHEN unc.node_id IS NOT NULL THEN true ELSE false END as cleared
     FROM world_nodes wn
     LEFT JOIN user_node_discovery und ON wn.id = und.node_id AND und.user_id = $2
     LEFT JOIN user_node_clearance unc ON wn.id = unc.node_id AND unc.user_id = $2
     WHERE wn.region_id = $1
     ORDER BY wn.name`,
    [regionId, userId]
  );

  // Get discovery stats
  const statsResult = await query(
    `SELECT
       COUNT(*) FILTER (WHERE und.discovery_method = 'travel') as visited_count,
       COUNT(*) as discovered_count,
       (SELECT COUNT(*) FROM world_nodes WHERE region_id = $1) as total_nodes
     FROM user_node_discovery und
     JOIN world_nodes wn ON wn.id = und.node_id
     WHERE und.user_id = $2 AND wn.region_id = $1`,
    [regionId, userId]
  );

  const stats = statsResult.rows[0];

  return {
    ...region,
    nodes: nodesResult.rows,
    discovery: {
      visited: parseInt(stats.visited_count || 0, 10),
      discovered: parseInt(stats.discovered_count || 0, 10),
      total: parseInt(stats.total_nodes || 0, 10)
    }
  };
}

/**
 * Get region boundaries (polygon points for map rendering)
 * @returns {Promise<Object[]>} Array of regions with boundary points
 */
export async function getRegionBoundaries() {
  const result = await query(
    `SELECT id, name, race, boundary_points
     FROM world_regions
     WHERE boundary_points IS NOT NULL`
  );

  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    race: row.race,
    boundaryPoints: row.boundary_points
  }));
}

/**
 * Get the region containing a specific node
 * @param {number} nodeId - Node ID
 * @returns {Promise<Object|null>} Region data or null
 */
export async function getRegionForNode(nodeId) {
  const result = await query(
    `SELECT wr.*
     FROM world_regions wr
     JOIN world_nodes wn ON wn.region_id = wr.id
     WHERE wn.id = $1`,
    [nodeId]
  );
  return result.rows[0] || null;
}

/**
 * Get all regions with castle nodes
 * @returns {Promise<Object[]>} Regions with their castle node info
 */
export async function getRegionsWithCastles() {
  const result = await query(
    `SELECT
       wr.*,
       wn.id as castle_node_id,
       wn.name as castle_name,
       wn.x as castle_x,
       wn.y as castle_y
     FROM world_regions wr
     LEFT JOIN world_nodes wn ON wn.region_id = wr.id AND wn.node_type = 'castle'
     ORDER BY wr.name`
  );

  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    race: row.race,
    description: row.description,
    castle: row.castle_node_id ? {
      nodeId: row.castle_node_id,
      name: row.castle_name,
      x: row.castle_x,
      y: row.castle_y
    } : null
  }));
}
