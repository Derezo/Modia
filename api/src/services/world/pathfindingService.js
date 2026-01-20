/**
 * Pathfinding Service - BFS-based world navigation
 */

import { query } from '../../config/database.js';

// Combat node types that require clearance (forest, cave, mountain, bridge)
export const COMBAT_NODE_TYPES = ['forest', 'cave', 'mountain', 'bridge'];

/**
 * Build adjacency map from world node connections
 * @param {Object[]} connections - Array of {from_node_id, to_node_id} pairs
 * @returns {Map<number, Set<number>>} Adjacency map
 */
export function buildAdjacencyMap(connections) {
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
export function bfsPath(fromNodeId, toNodeId, adjacency, blockedNodes = new Set()) {
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
export async function getBlockedNodes(userId) {
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
export async function getClearedNodes(userId) {
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
export async function getVisitedNodes(userId) {
  const result = await query(
    `SELECT node_id FROM user_node_discovery
     WHERE user_id = $1 AND discovery_method = 'travel'`,
    [userId]
  );
  return new Set(result.rows.map(r => r.node_id));
}

/**
 * Load all world connections and build adjacency map
 * @returns {Promise<Map<number, Set<number>>>} Adjacency map
 */
export async function loadAdjacencyMap() {
  const result = await query(
    'SELECT from_node_id, to_node_id FROM world_node_connections'
  );
  return buildAdjacencyMap(result.rows);
}

/**
 * Find shortest path between two world nodes
 * @param {number} fromNodeId - Starting node ID
 * @param {number} toNodeId - Destination node ID
 * @param {number|null} userId - User ID for blocking check (null to ignore blocking)
 * @returns {Promise<{path: number[], distance: number, blockedInPath: number[]}|null>}
 */
export async function findWorldPath(fromNodeId, toNodeId, userId = null) {
  const adjacency = await loadAdjacencyMap();

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

/**
 * Get all reachable nodes from a starting position
 * @param {number} fromNodeId - Starting node ID
 * @param {number} userId - User ID for blocking check
 * @returns {Promise<Set<number>>} Set of reachable node IDs
 */
export async function getReachableNodes(fromNodeId, userId) {
  const adjacency = await loadAdjacencyMap();
  const blockedNodes = await getBlockedNodes(userId);

  const reachable = new Set([fromNodeId]);
  const queue = [fromNodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    const neighbors = adjacency.get(current) || new Set();

    for (const neighbor of neighbors) {
      if (!reachable.has(neighbor)) {
        reachable.add(neighbor);
        // Can traverse through cleared nodes
        if (!blockedNodes.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }
  }

  return reachable;
}
