/**
 * Internal Connections Module (Phase 4 of 5-Region World Generation)
 *
 * This module generates internal connections within each region using:
 * - Prim's algorithm for MST (minimum spanning tree) from castle
 * - Extra connections beyond MST for route variety
 * - Ring distance calculation via BFS from castle
 * - Adjacency rule enforcement (no settlement-to-settlement connections)
 *
 * Connection Rules:
 * - Settlements (castle, city, village, guild, keep, palace) cannot connect directly
 * - Castle can only connect to battle nodes
 * - Each node must meet MIN_CONNECTIONS requirements
 * - Each node cannot exceed MAX_CONNECTIONS limits
 *
 * Ring Distance Assignment (based on BFS hops from castle):
 * - Ring 0: Castle itself (distance 0)
 * - Ring 1: 1-2 hops from castle
 * - Ring 2: 3-5 hops from castle
 * - Ring 3: 6+ hops from castle
 *
 * Dependencies:
 * - Phase 1 (castlePlacement.js): Castle positions
 * - Phase 2 (voronoiPartitioning.js): Region boundaries
 * - Phase 3 (nodeGeneration.js): Node positions and types
 *
 * @module worldgen/internalConnections
 */

import {
  CONNECTION_CONFIG,
  MIN_CONNECTIONS,
  MAX_CONNECTIONS,
  INTER_REGION_CONFIG,
  REGION_INTERMEDIATE_CONFIG,
  normalizeRegionName
} from './constants.js';
import { SeededRandom } from '../../config/constants.js';
import { generateCastlePlacements } from './castlePlacement.js';
import { createVoronoiRegions } from './voronoiPartitioning.js';
import { generateAllRegionNodes } from './nodeGeneration.js';

// ============================================================================
// INTERMEDIATE NODE GENERATION HELPERS
// ============================================================================

/**
 * Pick a terrain type based on weighted probabilities
 *
 * @param {Object} weights - Object mapping terrain types to weights (should sum to ~1.0)
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {string} Selected terrain type
 */
function weightedPick(weights, rng) {
  const roll = rng.next();
  let cumulative = 0;

  for (const [terrain, weight] of Object.entries(weights)) {
    cumulative += weight;
    if (roll < cumulative) {
      return terrain;
    }
  }

  // Fallback to first key if weights don't sum to 1.0
  return Object.keys(weights)[0];
}

/**
 * Pick a unique name from a pool, avoiding already-used names
 *
 * @param {Array<string>} namePool - Available names
 * @param {Set<string>} usedNames - Names already used in this region
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {string} Selected unique name
 */
function pickUniqueName(namePool, usedNames, rng) {
  // Find available names
  const available = namePool.filter(name => !usedNames.has(name));

  if (available.length > 0) {
    const name = rng.pick(available);
    usedNames.add(name);
    return name;
  }

  // If all names used, generate a numbered variant with safety bound
  const baseName = rng.pick(namePool);
  let suffix = 2;
  let name = `${baseName} ${suffix}`;
  const maxSuffix = 100; // Safety bound to prevent infinite loops
  while (usedNames.has(name) && suffix < maxSuffix) {
    suffix++;
    name = `${baseName} ${suffix}`;
  }
  usedNames.add(name);
  return name;
}

/**
 * Create a region-appropriate intermediate node for gap infill
 *
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {Object} region - Region object with id and name
 * @param {SeededRandom} rng - Seeded random generator
 * @param {Set<string>} usedNames - Names already used (will be mutated)
 * @returns {Object} New intermediate node
 */
export function createRegionIntermediateNode(x, y, region, rng, usedNames) {
  const regionKey = normalizeRegionName(region.name);
  const config = REGION_INTERMEDIATE_CONFIG[regionKey];

  if (!config) {
    // Fallback for unknown regions
    console.warn(`  Warning: No intermediate config for region "${region.name}", using default`);
    return {
      x,
      y,
      nodeType: 'forest',
      displayTerrain: 'forest',
      regionId: region.id,
      regionName: region.name,
      ringDistance: null,
      hopDistance: null,
      isIntermediateNode: true,
      excludeFromTotals: true,
      name: `Waypoint at (${x.toFixed(1)}, ${y.toFixed(1)})`
    };
  }

  // Pick terrain subtype based on weights
  const displayTerrain = weightedPick(config.terrainWeights, rng);
  const nodeType = config.terrainBaseTypes[displayTerrain];

  // Pick unique name
  const name = pickUniqueName(config.namePool, usedNames, rng);

  return {
    x,
    y,
    nodeType,
    displayTerrain,
    regionId: region.id,
    regionName: region.name,
    ringDistance: null,  // Will be calculated by BFS later
    hopDistance: null,
    isIntermediateNode: true,
    excludeFromTotals: true,
    name
  };
}

/**
 * Insert intermediate nodes along an edge that exceeds max spacing
 *
 * @param {Object} nodeA - Start node with x, y
 * @param {Object} nodeB - End node with x, y
 * @param {number} maxSpacing - Maximum allowed distance between nodes
 * @param {SeededRandom} rng - Seeded random generator
 * @param {Object} region - Region object with id and name
 * @param {Set<string>} usedNames - Names already used (will be mutated)
 * @param {Array<Object>} existingNodes - Current node array (for index calculation)
 * @param {number} indexA - Index of nodeA in the combined array
 * @param {number} indexB - Index of nodeB in the combined array
 * @returns {Object} Result with nodes array and connections array
 */
export function insertIntermediatesForEdge(nodeA, nodeB, maxSpacing, rng, region, usedNames, existingNodes, indexA, indexB) {
  const dx = nodeB.x - nodeA.x;
  const dy = nodeB.y - nodeA.y;
  const totalDistance = Math.hypot(dx, dy);

  // Calculate how many segments we need (each segment <= maxSpacing)
  // Use INTERMEDIATE_SPACING for target spacing (provides margin under max)
  const targetSpacing = INTER_REGION_CONFIG.INTERMEDIATE_SPACING;
  const segmentCount = Math.ceil(totalDistance / targetSpacing);

  // We need segmentCount - 1 intermediate nodes
  const intermediateCount = segmentCount - 1;

  if (intermediateCount <= 0) {
    // No intermediates needed - return direct connection
    return {
      nodes: [],
      connections: [{ from: indexA, to: indexB, distance: totalDistance }]
    };
  }

  const nodes = [];
  const connections = [];

  // Create intermediate nodes evenly spaced along the edge
  let prevIndex = indexA;

  for (let i = 1; i <= intermediateCount; i++) {
    const t = i / segmentCount;  // Parameter along the line [0, 1]
    const x = nodeA.x + dx * t;
    const y = nodeA.y + dy * t;

    const intermediateNode = createRegionIntermediateNode(x, y, region, rng, usedNames);
    nodes.push(intermediateNode);

    // Index of this new node will be existingNodes.length + nodes.length - 1
    const newIndex = existingNodes.length + nodes.length - 1;

    // Connect previous node to this intermediate
    const prevNode = prevIndex === indexA ? nodeA : nodes[nodes.length - 2];
    const distToPrev = Math.hypot(x - prevNode.x, y - prevNode.y);
    connections.push({ from: prevIndex, to: newIndex, distance: distToPrev });

    prevIndex = newIndex;
  }

  // Connect last intermediate to nodeB
  const lastNode = nodes[nodes.length - 1];
  const distToEnd = Math.hypot(nodeB.x - lastNode.x, nodeB.y - lastNode.y);
  connections.push({ from: prevIndex, to: indexB, distance: distToEnd });

  return { nodes, connections };
}

/**
 * Process all connections and insert intermediate nodes where spacing exceeds max
 * This is a post-processing step after all connections are established
 *
 * IMPORTANT: Caller MUST append returned intermediateNodes to the original nodes array
 * immediately after this call for connection indices to be valid.
 *
 * @param {Array<Object>} nodes - Array of region nodes
 * @param {Array<{from: number, to: number, distance?: number}>} connections - Connections to process
 * @param {SeededRandom} rng - Seeded random generator
 * @param {Object} region - Region object with id and name
 * @returns {Object} Result with processedConnections and intermediateNodes arrays
 */
export function processConnectionsWithGapInfill(nodes, connections, rng, region) {
  const MAX_SPACING = INTER_REGION_CONFIG.MAX_NODE_SPACING;
  const intermediateNodes = [];
  const usedNames = new Set();
  const processedConnections = [];

  for (const conn of connections) {
    const nodeA = nodes[conn.from];
    const nodeB = nodes[conn.to];
    const dist = conn.distance !== undefined
      ? conn.distance
      : Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y);

    if (dist <= MAX_SPACING) {
      // Connection is within limit, keep it as-is
      processedConnections.push(conn);
    } else {
      // Need to insert intermediate nodes
      const targetSpacing = INTER_REGION_CONFIG.INTERMEDIATE_SPACING;
      const segmentCount = Math.ceil(dist / targetSpacing);
      const intermediateCount = segmentCount - 1;

      const dx = nodeB.x - nodeA.x;
      const dy = nodeB.y - nodeA.y;

      let prevIndex = conn.from;

      for (let i = 1; i <= intermediateCount; i++) {
        const t = i / segmentCount;  // Parameter along line [0, 1]
        const x = nodeA.x + dx * t;
        const y = nodeA.y + dy * t;

        const intermediateNode = createRegionIntermediateNode(x, y, region, rng, usedNames);
        intermediateNodes.push(intermediateNode);

        // New node index = original nodes length + intermediates added so far - 1
        const newIndex = nodes.length + intermediateNodes.length - 1;

        // Get previous node for distance calculation
        let prevNode;
        if (prevIndex < nodes.length) {
          prevNode = nodes[prevIndex];
        } else {
          prevNode = intermediateNodes[prevIndex - nodes.length];
        }

        const distToPrev = Math.hypot(x - prevNode.x, y - prevNode.y);
        processedConnections.push({ from: prevIndex, to: newIndex, distance: distToPrev });

        prevIndex = newIndex;
      }

      // Connect last intermediate to nodeB
      const lastNode = intermediateNodes[intermediateNodes.length - 1];
      const distToEnd = Math.hypot(nodeB.x - lastNode.x, nodeB.y - lastNode.y);
      processedConnections.push({ from: prevIndex, to: conn.to, distance: distToEnd });
    }
  }

  return { connections: processedConnections, intermediateNodes };
}

/**
 * Check if a node type is a settlement type
 * Settlements cannot connect directly to other settlements
 *
 * @param {string} nodeType - Node type to check
 * @returns {boolean} True if settlement type
 */
export function isSettlement(nodeType) {
  return ['castle', 'city', 'village', 'guild', 'keep', 'palace', 'farm'].includes(nodeType);
}

/**
 * Check if a connection between two node types is valid
 * Settlement-to-settlement connections are invalid
 * Castle can only connect to battle nodes
 *
 * @param {string} type1 - First node type
 * @param {string} type2 - Second node type
 * @returns {boolean} True if connection is valid
 */
export function isValidAdjacency(type1, type2) {
  const isSettlement1 = isSettlement(type1);
  const isSettlement2 = isSettlement(type2);

  // Settlements cannot connect directly to other settlements
  if (isSettlement1 && isSettlement2) {
    return false;
  }

  // Castle can only connect to battle nodes (not settlements)
  if (type1 === 'castle' && isSettlement2) {
    return false;
  }
  if (type2 === 'castle' && isSettlement1) {
    return false;
  }

  return true;
}

/**
 * Build MST connections within a single region using Prim's algorithm
 * Starts from the castle and expands outward
 * Penalizes invalid connections (settlement-to-settlement) to prefer valid ones
 *
 * @param {Array<Object>} nodes - Array of nodes with x, y, nodeType
 * @param {number} castleIndex - Index of the castle node in the array
 * @returns {Array<{from: number, to: number}>} MST connections
 */
export function buildRegionMST(nodes, castleIndex) {
  const connections = [];
  const inTree = new Set([castleIndex]);  // Start with castle

  while (inTree.size < nodes.length) {
    let bestEdge = null;
    let bestCost = Infinity;

    // Find the cheapest edge from tree to non-tree node
    for (const i of inTree) {
      for (let j = 0; j < nodes.length; j++) {
        if (inTree.has(j)) continue;

        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.hypot(dx, dy);

        // Apply penalty for invalid adjacencies
        const valid = isValidAdjacency(nodes[i].nodeType, nodes[j].nodeType);
        const cost = valid ? dist : dist * CONNECTION_CONFIG.INVALID_PENALTY;

        if (cost < bestCost) {
          bestCost = cost;
          bestEdge = { from: i, to: j, distance: dist };
        }
      }
    }

    if (bestEdge) {
      connections.push(bestEdge);
      inTree.add(bestEdge.to);
    } else {
      // No edge found - should not happen in connected region
      console.warn('  Warning: MST construction stuck, some nodes may be unreachable');
      break;
    }
  }

  return connections;
}

/**
 * Add extra connections beyond MST for route variety
 * Respects adjacency rules and connection limits
 *
 * @param {Array<Object>} nodes - Array of nodes with x, y, nodeType
 * @param {Array<{from: number, to: number}>} mstConnections - MST connections
 * @param {SeededRandom} rng - Seeded random generator
 * @param {number} extraRatio - Percentage of extra connections (0.20 = 20%)
 * @returns {Array<{from: number, to: number}>} All connections (MST + extra)
 */
export function addExtraConnections(nodes, mstConnections, rng, extraRatio = CONNECTION_CONFIG.EXTRA_CONNECTION_RATIO) {
  const connections = [...mstConnections];

  // Track existing connections
  const connectionSet = new Set(
    connections.map(c => `${Math.min(c.from, c.to)},${Math.max(c.from, c.to)}`)
  );

  // Count connections per node
  const connectionCounts = new Map();
  for (let i = 0; i < nodes.length; i++) {
    connectionCounts.set(i, 0);
  }
  for (const conn of connections) {
    connectionCounts.set(conn.from, connectionCounts.get(conn.from) + 1);
    connectionCounts.set(conn.to, connectionCounts.get(conn.to) + 1);
  }

  // Calculate target extra connections
  const extraCount = Math.floor(nodes.length * extraRatio);
  let added = 0;

  // Build list of potential extra connections
  const potentialConnections = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const key = `${i},${j}`;
      if (connectionSet.has(key)) continue;

      const dist = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
      if (dist > CONNECTION_CONFIG.MAX_CONNECTION_DISTANCE) continue;

      // Must be valid adjacency
      if (!isValidAdjacency(nodes[i].nodeType, nodes[j].nodeType)) continue;

      potentialConnections.push({ from: i, to: j, distance: dist });
    }
  }

  // Sort by distance (prefer shorter connections)
  potentialConnections.sort((a, b) => a.distance - b.distance);

  // Shuffle with bias toward shorter connections
  // Take shorter ones first but with some randomness
  for (let i = 0; i < potentialConnections.length && added < extraCount; i++) {
    const conn = potentialConnections[i];

    // Check max connections
    const maxFrom = MAX_CONNECTIONS[nodes[conn.from].nodeType];
    const maxTo = MAX_CONNECTIONS[nodes[conn.to].nodeType];

    if (maxFrom && connectionCounts.get(conn.from) >= maxFrom) continue;
    if (maxTo && connectionCounts.get(conn.to) >= maxTo) continue;

    // Add with some randomness (70% chance for nearby, decreasing)
    const acceptChance = 0.7 - (i / potentialConnections.length) * 0.4;
    if (rng.next() < acceptChance) {
      const key = `${Math.min(conn.from, conn.to)},${Math.max(conn.from, conn.to)}`;
      connections.push({ from: conn.from, to: conn.to, distance: conn.distance });
      connectionSet.add(key);
      connectionCounts.set(conn.from, connectionCounts.get(conn.from) + 1);
      connectionCounts.set(conn.to, connectionCounts.get(conn.to) + 1);
      added++;
    }
  }

  return connections;
}

/**
 * Calculate ring distance (graph BFS distance from castle)
 * Updates node.ringDistance property based on hop count
 *
 * Ring mapping:
 * - Ring 0: Castle itself (distance 0)
 * - Ring 1: 1-2 hops from castle
 * - Ring 2: 3-5 hops from castle
 * - Ring 3: 6+ hops from castle
 *
 * @param {Array<Object>} nodes - Array of nodes (will be mutated with ringDistance)
 * @param {Array<{from: number, to: number}>} connections - All connections
 * @param {number} castleIndex - Index of the castle node
 */
export function calculateRingDistances(nodes, connections, castleIndex) {
  // Build adjacency list
  const adjacency = new Map();
  for (let i = 0; i < nodes.length; i++) {
    adjacency.set(i, []);
  }
  for (const conn of connections) {
    adjacency.get(conn.from).push(conn.to);
    adjacency.get(conn.to).push(conn.from);
  }

  // BFS from castle
  const hopDistances = new Map();
  const visited = new Set();
  const queue = [{ index: castleIndex, hops: 0 }];

  while (queue.length > 0) {
    const { index, hops } = queue.shift();

    if (visited.has(index)) continue;
    visited.add(index);
    hopDistances.set(index, hops);

    // Add neighbors
    for (const neighbor of adjacency.get(index)) {
      if (!visited.has(neighbor)) {
        queue.push({ index: neighbor, hops: hops + 1 });
      }
    }
  }

  // Convert hop distances to ring distances
  for (let i = 0; i < nodes.length; i++) {
    const hops = hopDistances.get(i);

    if (hops === undefined) {
      // Node not reachable (should not happen)
      console.warn(`  Warning: Node ${i} not reachable from castle`);
      nodes[i].ringDistance = 3;  // Treat as outer ring
      nodes[i].hopDistance = -1;
      continue;
    }

    nodes[i].hopDistance = hops;

    if (hops === 0) {
      nodes[i].ringDistance = 0;  // Castle
    } else if (hops <= CONNECTION_CONFIG.RING_THRESHOLDS.RING_1) {
      nodes[i].ringDistance = 1;  // 1-2 hops
    } else if (hops <= CONNECTION_CONFIG.RING_THRESHOLDS.RING_2) {
      nodes[i].ringDistance = 2;  // 3-5 hops
    } else {
      nodes[i].ringDistance = 3;  // 6+ hops
    }
  }
}

/**
 * Validate and fix adjacency rules
 * Removes any settlement-to-settlement connections that slipped through
 * Also removes castle connections to settlements
 *
 * @param {Array<Object>} nodes - Array of nodes
 * @param {Array<{from: number, to: number}>} connections - Connections to validate
 * @returns {Array<{from: number, to: number}>} Filtered valid connections
 */
export function enforceAdjacencyRules(nodes, connections) {
  const validConnections = [];
  let removedCount = 0;

  for (const conn of connections) {
    const type1 = nodes[conn.from].nodeType;
    const type2 = nodes[conn.to].nodeType;

    if (isValidAdjacency(type1, type2)) {
      validConnections.push(conn);
    } else {
      removedCount++;
    }
  }

  if (removedCount > 0) {
    console.log(`    Removed ${removedCount} invalid connections`);
  }

  return validConnections;
}

/**
 * Ensure minimum connections are met for each node
 * Tries to add connections while respecting adjacency rules
 *
 * @param {Array<Object>} nodes - Array of nodes
 * @param {Array<{from: number, to: number}>} connections - Current connections
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {Array<{from: number, to: number}>} Updated connections
 */
export function ensureMinimumConnections(nodes, connections, _rng) {
  const connectionSet = new Set(
    connections.map(c => `${Math.min(c.from, c.to)},${Math.max(c.from, c.to)}`)
  );

  // Count connections per node
  const connectionCounts = new Map();
  for (let i = 0; i < nodes.length; i++) {
    connectionCounts.set(i, 0);
  }
  for (const conn of connections) {
    connectionCounts.set(conn.from, connectionCounts.get(conn.from) + 1);
    connectionCounts.set(conn.to, connectionCounts.get(conn.to) + 1);
  }

  // Try to add connections for nodes below minimum
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const minConn = MIN_CONNECTIONS[node.nodeType] || 2;
    const _maxConn = MAX_CONNECTIONS[node.nodeType];

    while (connectionCounts.get(i) < minConn) {
      // Find nearby valid targets
      const candidates = nodes
        .map((n, idx) => ({
          idx,
          dist: Math.hypot(n.x - node.x, n.y - node.y),
          type: n.nodeType
        }))
        .filter(n => {
          if (n.idx === i) return false;
          const key = `${Math.min(i, n.idx)},${Math.max(i, n.idx)}`;
          if (connectionSet.has(key)) return false;
          // Check max for target
          const targetMax = MAX_CONNECTIONS[n.type];
          if (targetMax && connectionCounts.get(n.idx) >= targetMax) return false;
          // Must be valid adjacency
          if (!isValidAdjacency(node.nodeType, n.type)) return false;
          return true;
        })
        .sort((a, b) => a.dist - b.dist);

      if (candidates.length === 0) {
        // No valid candidates - this can happen if surrounded by settlements
        break;
      }

      // Pick nearest valid candidate
      const target = candidates[0];
      const key = `${Math.min(i, target.idx)},${Math.max(i, target.idx)}`;
      const dist = Math.hypot(nodes[i].x - nodes[target.idx].x, nodes[i].y - nodes[target.idx].y);

      connections.push({ from: i, to: target.idx, distance: dist });
      connectionSet.add(key);
      connectionCounts.set(i, connectionCounts.get(i) + 1);
      connectionCounts.set(target.idx, connectionCounts.get(target.idx) + 1);
    }
  }

  return connections;
}

/**
 * Main function: generate all internal connections for a region
 * Orchestrates MST building, extra connections, gap infill, and ring distance calculation
 *
 * @param {Array<Object>} regionNodes - Nodes in this region (from Phase 3) - will be mutated with intermediate nodes
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {Object} Result containing connections and updated nodes (including intermediates)
 */
export function generateRegionConnections(regionNodes, rng) {
  // Find the castle node index
  const castleIndex = regionNodes.findIndex(n => n.nodeType === 'castle');
  if (castleIndex === -1) {
    console.error('  ERROR: No castle found in region!');
    return { connections: [], nodes: regionNodes, intermediateCount: 0 };
  }

  // Extract region info from castle node
  const castle = regionNodes[castleIndex];
  const region = {
    id: castle.regionId,
    name: castle.regionName
  };

  const regionName = region.name || 'Unknown';
  const originalNodeCount = regionNodes.length;
  console.log(`  Processing connections for ${regionName} (${originalNodeCount} nodes)...`);

  // Step 1: Build MST from castle
  const mstConnections = buildRegionMST(regionNodes, castleIndex);
  console.log(`    MST: ${mstConnections.length} connections`);

  // Step 2: Add extra connections for variety
  let allConnections = addExtraConnections(regionNodes, mstConnections, rng);
  console.log(`    After extras: ${allConnections.length} connections`);

  // Step 3: Enforce adjacency rules (remove any invalid connections)
  allConnections = enforceAdjacencyRules(regionNodes, allConnections);

  // Step 4: Ensure minimum connections are met
  allConnections = ensureMinimumConnections(regionNodes, allConnections, rng);
  console.log(`    After minimums: ${allConnections.length} connections`);

  // Step 5: Process connections with gap infill - insert intermediate nodes where needed
  const gapInfillResult = processConnectionsWithGapInfill(regionNodes, allConnections, rng, region);
  allConnections = gapInfillResult.connections;

  // Step 6: Merge intermediate nodes into region nodes array
  const intermediateCount = gapInfillResult.intermediateNodes.length;
  if (intermediateCount > 0) {
    // Push intermediate nodes onto the regionNodes array (mutating it)
    regionNodes.push(...gapInfillResult.intermediateNodes);
    console.log(`    Gap infill: Added ${intermediateCount} intermediate nodes (${originalNodeCount} -> ${regionNodes.length})`);
  }

  // Step 7: Calculate ring distances using BFS from castle (includes intermediates)
  calculateRingDistances(regionNodes, allConnections, castleIndex);

  // Count ring distribution
  const ringCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const node of regionNodes) {
    ringCounts[node.ringDistance] = (ringCounts[node.ringDistance] || 0) + 1;
  }
  console.log(`    Ring distribution: R0=${ringCounts[0]}, R1=${ringCounts[1]}, R2=${ringCounts[2]}, R3=${ringCounts[3]}`);
  console.log(`    Final connections: ${allConnections.length}`);

  return {
    connections: allConnections,
    nodes: regionNodes,
    intermediateCount
  };
}

/**
 * Generate all internal connections for all regions
 * Orchestrates Phase 4 across all 5 regions
 *
 * @param {Object} nodeData - Output from Phase 3 (generateAllRegionNodes)
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {Object} Connection data organized by region
 *   - allConnections: Array of all connections with region info
 *   - connectionsByRegion: Map of regionId -> connections array
 *   - nodesByRegion: Updated nodesByRegion with ring distances and intermediate nodes
 */
export function generateAllRegionConnections(nodeData, rng) {
  console.log('\n========================================');
  console.log('PHASE 4: Internal Connections');
  console.log('========================================');

  const allConnections = [];
  const connectionsByRegion = new Map();
  const { nodesByRegion } = nodeData;

  let totalConnections = 0;
  let totalIntermediates = 0;

  for (const [regionId, regionNodes] of nodesByRegion) {
    // Generate connections for this region
    const result = generateRegionConnections(regionNodes, rng);

    // Store connections with region info
    const connectionsWithRegion = result.connections.map(conn => ({
      ...conn,
      regionId
    }));

    connectionsByRegion.set(regionId, connectionsWithRegion);
    allConnections.push(...connectionsWithRegion);
    totalConnections += result.connections.length;
    totalIntermediates += result.intermediateCount || 0;
  }

  console.log('\nPhase 4 Complete:');
  console.log(`  Generated ${totalConnections} total connections across ${nodesByRegion.size} regions`);
  console.log(`  Added ${totalIntermediates} intermediate nodes for gap infill`);

  // Summary statistics
  let totalRing0 = 0, totalRing1 = 0, totalRing2 = 0, totalRing3 = 0;
  let totalNodes = 0;
  for (const [_regionId, nodes] of nodesByRegion) {
    for (const node of nodes) {
      totalNodes++;
      if (node.ringDistance === 0) totalRing0++;
      else if (node.ringDistance === 1) totalRing1++;
      else if (node.ringDistance === 2) totalRing2++;
      else totalRing3++;
    }
  }
  console.log(`  Total nodes: ${totalNodes}`);
  console.log(`  Ring distribution: R0=${totalRing0}, R1=${totalRing1}, R2=${totalRing2}, R3=${totalRing3}`);

  return {
    allConnections,
    connectionsByRegion,
    nodesByRegion,
    totalIntermediates
  };
}

/**
 * Validation function for Phase 4: Internal Connections
 *
 * @param {number} seed - Random seed for testing
 * @returns {Object} Validation results
 */
export function validateRegionConnections(seed = 12345) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('REGION CONNECTIONS VALIDATION (Phase 4)');
  console.log(`${'='.repeat(60)}`);
  console.log(`Testing with seed: ${seed}`);

  const rng = new SeededRandom(seed);

  // Run Phase 1: Castle placement
  const castles = generateCastlePlacements(rng);

  // Run Phase 2: Voronoi partitioning
  const voronoiData = createVoronoiRegions(castles);

  // Run Phase 3: Internal node generation
  const nodeData = generateAllRegionNodes(castles, voronoiData, rng);

  // Run Phase 4: Internal connections
  const connectionData = generateAllRegionConnections(nodeData, rng);

  // Validation checks
  const issues = [];

  // Check 1: All regions have connections
  for (const castle of castles) {
    const regionConnections = connectionData.connectionsByRegion.get(castle.region.id);
    if (!regionConnections || regionConnections.length === 0) {
      issues.push(`Region ${castle.region.name} has no connections`);
    }
  }

  // Check 2: All nodes are reachable (have at least 1 connection)
  for (const [regionId, nodes] of nodeData.nodesByRegion) {
    const connections = connectionData.connectionsByRegion.get(regionId) || [];
    const connectedNodes = new Set();
    for (const conn of connections) {
      connectedNodes.add(conn.from);
      connectedNodes.add(conn.to);
    }

    for (let i = 0; i < nodes.length; i++) {
      if (!connectedNodes.has(i)) {
        issues.push(`Region ${regionId}: Node ${i} (${nodes[i].nodeType}) has no connections`);
      }
    }
  }

  // Check 3: No settlement-to-settlement connections
  for (const [regionId, connections] of connectionData.connectionsByRegion) {
    const nodes = nodeData.nodesByRegion.get(regionId);
    for (const conn of connections) {
      const type1 = nodes[conn.from].nodeType;
      const type2 = nodes[conn.to].nodeType;

      if (isSettlement(type1) && isSettlement(type2)) {
        issues.push(`Region ${regionId}: Invalid settlement-to-settlement connection (${type1} -> ${type2})`);
      }
    }
  }

  // Check 4: Castle only connects to battle nodes
  for (const [regionId, connections] of connectionData.connectionsByRegion) {
    const nodes = nodeData.nodesByRegion.get(regionId);
    const castleIdx = nodes.findIndex(n => n.nodeType === 'castle');

    if (castleIdx === -1) continue;

    for (const conn of connections) {
      if (conn.from === castleIdx || conn.to === castleIdx) {
        const otherIdx = conn.from === castleIdx ? conn.to : conn.from;
        const otherType = nodes[otherIdx].nodeType;

        if (isSettlement(otherType)) {
          issues.push(`Region ${regionId}: Castle connected to settlement (${otherType})`);
        }
      }
    }
  }

  // Check 5: Ring distances are assigned
  for (const [regionId, nodes] of nodeData.nodesByRegion) {
    for (const node of nodes) {
      if (node.ringDistance === undefined) {
        issues.push(`Region ${regionId}: Node missing ringDistance`);
        break;
      }
    }
  }

  // Check 6: Castle has ring distance 0
  for (const [regionId, nodes] of nodeData.nodesByRegion) {
    const castle = nodes.find(n => n.nodeType === 'castle');
    if (castle && castle.ringDistance !== 0) {
      issues.push(`Region ${regionId}: Castle has ringDistance ${castle.ringDistance} (expected 0)`);
    }
  }

  // Check 7: Connection count constraints
  for (const [regionId, connections] of connectionData.connectionsByRegion) {
    const nodes = nodeData.nodesByRegion.get(regionId);
    const counts = new Map();
    for (let i = 0; i < nodes.length; i++) {
      counts.set(i, 0);
    }
    for (const conn of connections) {
      counts.set(conn.from, counts.get(conn.from) + 1);
      counts.set(conn.to, counts.get(conn.to) + 1);
    }

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const count = counts.get(i);
      const minConn = MIN_CONNECTIONS[node.nodeType] || 2;
      const maxConn = MAX_CONNECTIONS[node.nodeType];

      // Only check non-terminator nodes for minimum
      if (!node.isTerminator && count < minConn) {
        issues.push(`Region ${regionId}: Node ${i} (${node.nodeType}) has ${count} connections (min: ${minConn})`);
      }

      if (maxConn && count > maxConn) {
        issues.push(`Region ${regionId}: Node ${i} (${node.nodeType}) has ${count} connections (max: ${maxConn})`);
      }
    }
  }

  // Check 8: Max spacing constraint (all connections <= 13.3 units)
  const MAX_SPACING = INTER_REGION_CONFIG.MAX_NODE_SPACING;
  let spacingViolations = 0;
  for (const [regionId, connections] of connectionData.connectionsByRegion) {
    const nodes = nodeData.nodesByRegion.get(regionId);
    for (const conn of connections) {
      const nodeA = nodes[conn.from];
      const nodeB = nodes[conn.to];
      const dist = conn.distance !== undefined
        ? conn.distance
        : Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y);

      if (dist > MAX_SPACING) {
        spacingViolations++;
        if (spacingViolations <= 5) {
          issues.push(`Region ${regionId}: Connection exceeds max spacing: ${dist.toFixed(1)} > ${MAX_SPACING} units`);
        }
      }
    }
  }
  if (spacingViolations > 5) {
    issues.push(`... and ${spacingViolations - 5} more spacing violations`);
  }

  // Check 9: Intermediate nodes count
  const intermediateCount = connectionData.totalIntermediates || 0;
  console.log(`    Intermediate nodes added: ${intermediateCount}`);

  const passed = issues.length === 0;

  // Summary
  console.log('\n  Summary:');
  console.log(`    Total connections: ${connectionData.allConnections.length}`);
  console.log(`    Regions processed: ${connectionData.connectionsByRegion.size}`);
  console.log(`    Validation: ${passed ? 'PASSED' : 'FAILED'}`);

  if (!passed) {
    console.log('\n  Issues:');
    for (const issue of issues.slice(0, 20)) {
      console.log(`    - ${issue}`);
    }
    if (issues.length > 20) {
      console.log(`    ... and ${issues.length - 20} more issues`);
    }
  }

  console.log(`${'='.repeat(60)}\n`);

  return {
    castles,
    voronoiData,
    nodeData,
    connectionData,
    passed,
    issues
  };
}
