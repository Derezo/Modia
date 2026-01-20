/**
 * Node Service - World node queries and details
 */

import { query } from '../../config/database.js';

/**
 * Get a node by ID with full details
 * @param {number} nodeId - Node ID
 * @returns {Promise<Object|null>} Node data or null if not found
 */
export async function getNodeById(nodeId) {
  const result = await query(
    `SELECT wn.*, wr.name as region_name, wr.race as region_race
     FROM world_nodes wn
     LEFT JOIN world_regions wr ON wn.region_id = wr.id
     WHERE wn.id = $1`,
    [nodeId]
  );
  return result.rows[0] || null;
}

/**
 * Get a node with user-specific status (cleared, discovered)
 * @param {number} nodeId - Node ID
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} Node with user status
 */
export async function getNodeWithUserStatus(nodeId, userId) {
  const result = await query(
    `SELECT
       wn.*,
       wr.name as region_name,
       wr.race as region_race,
       CASE WHEN und.node_id IS NOT NULL THEN true ELSE false END as discovered,
       CASE WHEN unc.node_id IS NOT NULL THEN true ELSE false END as cleared,
       und.discovery_method
     FROM world_nodes wn
     LEFT JOIN world_regions wr ON wn.region_id = wr.id
     LEFT JOIN user_node_discovery und ON wn.id = und.node_id AND und.user_id = $2
     LEFT JOIN user_node_clearance unc ON wn.id = unc.node_id AND unc.user_id = $2
     WHERE wn.id = $1`,
    [nodeId, userId]
  );
  return result.rows[0] || null;
}

/**
 * Get the current node for a user
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} Current node data
 */
export async function getCurrentNode(userId) {
  const result = await query(
    `SELECT wn.*, wr.name as region_name, wr.race as region_race
     FROM users u
     JOIN world_nodes wn ON wn.id = u.current_node_id
     LEFT JOIN world_regions wr ON wn.region_id = wr.id
     WHERE u.id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Get current node ID for a user
 * @param {number} userId - User ID
 * @returns {Promise<number|null>} Current node ID
 */
export async function getCurrentNodeId(userId) {
  const result = await query(
    'SELECT current_node_id FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0]?.current_node_id || null;
}

/**
 * Update user's current node
 * @param {number} userId - User ID
 * @param {number} nodeId - New node ID
 * @param {Object} client - Optional database client for transactions
 */
export async function setCurrentNode(userId, nodeId, client = null) {
  const queryFn = client ? client.query.bind(client) : query;
  await queryFn(
    'UPDATE users SET current_node_id = $1 WHERE id = $2',
    [nodeId, userId]
  );
}

/**
 * Check if a node is a combat node type
 * @param {string} nodeType - Node type
 * @returns {boolean} Whether it's a combat node
 */
export function isCombatNode(nodeType) {
  return ['forest', 'cave', 'mountain', 'bridge'].includes(nodeType);
}

/**
 * Check if a node requires clearance for a user
 * @param {number} nodeId - Node ID
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} Whether node requires clearance
 */
export async function requiresClearance(nodeId, userId) {
  const result = await query(
    `SELECT wn.node_type,
            CASE WHEN unc.node_id IS NOT NULL THEN true ELSE false END as cleared
     FROM world_nodes wn
     LEFT JOIN user_node_clearance unc ON wn.id = unc.node_id AND unc.user_id = $2
     WHERE wn.id = $1`,
    [nodeId, userId]
  );

  if (!result.rows[0]) return false;

  const { node_type, cleared } = result.rows[0];
  return isCombatNode(node_type) && !cleared;
}

/**
 * Clear a node for a user (mark as completed)
 * @param {number} userId - User ID
 * @param {number} nodeId - Node ID
 * @param {Object} client - Optional database client for transactions
 */
export async function clearNode(userId, nodeId, client = null) {
  const queryFn = client ? client.query.bind(client) : query;
  await queryFn(
    `INSERT INTO user_node_clearance (user_id, node_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, node_id) DO NOTHING`,
    [userId, nodeId]
  );
}

/**
 * Get all nodes in a region
 * @param {number} regionId - Region ID
 * @returns {Promise<Object[]>} Array of nodes
 */
export async function getNodesByRegion(regionId) {
  const result = await query(
    'SELECT * FROM world_nodes WHERE region_id = $1 ORDER BY name',
    [regionId]
  );
  return result.rows;
}

/**
 * Get node adjacent to a given node
 * @param {number} nodeId - Node ID
 * @returns {Promise<number[]>} Array of adjacent node IDs
 */
export async function getAdjacentNodeIds(nodeId) {
  const result = await query(
    `SELECT CASE
       WHEN from_node_id = $1 THEN to_node_id
       ELSE from_node_id
     END as adjacent_id
     FROM world_node_connections
     WHERE from_node_id = $1 OR to_node_id = $1`,
    [nodeId]
  );
  return result.rows.map(r => r.adjacent_id);
}

/**
 * Get castle node for a region (guild advancement location)
 * @param {number} regionId - Region ID
 * @returns {Promise<Object|null>} Castle node or null
 */
export async function getCastleNode(regionId) {
  const result = await query(
    `SELECT * FROM world_nodes
     WHERE region_id = $1 AND node_type = 'castle'
     LIMIT 1`,
    [regionId]
  );
  return result.rows[0] || null;
}

/**
 * Get all castle nodes
 * @returns {Promise<Object[]>} Array of castle nodes
 */
export async function getAllCastleNodes() {
  const result = await query(
    `SELECT wn.*, wr.name as region_name, wr.race as region_race
     FROM world_nodes wn
     LEFT JOIN world_regions wr ON wn.region_id = wr.id
     WHERE wn.node_type = 'castle'`
  );
  return result.rows;
}
