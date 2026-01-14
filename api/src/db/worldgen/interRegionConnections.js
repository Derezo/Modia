/**
 * Inter-Region Connections Module (Phase 5 of 5-Region World Generation)
 *
 * This module handles the generation of connections between regions, creating
 * the world's cross-region infrastructure:
 * - Bridge nodes at region border midpoints (chokepoints)
 * - Wilderness zones for medium-length borders (higher difficulty battle areas)
 * - Trade routes for long borders (safer paths connecting cities)
 * - Grand Palace at the farthest multi-region vertex
 *
 * Connection Type Rules (based on border length):
 * - Short borders (< 10 units): Bridge only
 * - Medium borders (10-20 units): Bridge + wilderness zone (2-4 nodes)
 * - Long borders (20+ units): Bridge + wilderness + trade route (3-5 nodes)
 *
 * Dependencies:
 * - Phase 1 (castlePlacement.js): Castle positions for distance calculations
 * - Phase 2 (voronoiPartitioning.js): Region borders and palace position
 * - Phase 3 (nodeGeneration.js): Regional nodes to connect to
 * - Phase 4 (internalConnections.js): Internal connections for validation
 *
 * @module worldgen/interRegionConnections
 */

import { INTER_REGION_CONFIG, BRIDGE_NAMES } from './constants.js';
import { SeededRandom } from '../../config/constants.js';
import { getRegionBorders, findGrandPalacePosition, createVoronoiRegions } from './voronoiPartitioning.js';
import { generateCastlePlacements } from './castlePlacement.js';
import { generateAllRegionNodes } from './nodeGeneration.js';
import { generateAllRegionConnections } from './internalConnections.js';

/**
 * Find the nearest node in a region to a given point
 * Optionally filter by node type
 *
 * @param {number} x - X coordinate to search from
 * @param {number} y - Y coordinate to search from
 * @param {Array} regionNodes - Nodes in the region
 * @param {string|null} nodeType - Optional filter by node type (e.g., 'city')
 * @param {number} maxDist - Maximum distance to consider
 * @returns {{node: Object, index: number, distance: number}|null} Nearest node or null
 */
export function findNearestNodeInRegion(x, y, regionNodes, nodeType = null, maxDist = Infinity) {
  let nearest = null;
  let nearestDist = Infinity;
  let nearestIndex = -1;

  for (let i = 0; i < regionNodes.length; i++) {
    const node = regionNodes[i];

    // Filter by node type if specified
    if (nodeType && node.nodeType !== nodeType) continue;

    const dist = Math.hypot(node.x - x, node.y - y);

    if (dist < nearestDist && dist <= maxDist) {
      nearestDist = dist;
      nearest = node;
      nearestIndex = i;
    }
  }

  if (!nearest) return null;

  return {
    node: nearest,
    index: nearestIndex,
    distance: nearestDist
  };
}

/**
 * Find frontier nodes in a region (nodes near the region boundary)
 * Frontier nodes are battle terrain nodes near the border
 *
 * @param {Array} regionNodes - Nodes in the region
 * @param {number} borderX - X coordinate of border midpoint
 * @param {number} borderY - Y coordinate of border midpoint
 * @param {number} maxDist - Maximum distance to consider
 * @returns {Array} Array of frontier nodes sorted by distance
 */
export function findFrontierNodes(regionNodes, borderX, borderY, maxDist = INTER_REGION_CONFIG.MAX_FRONTIER_SEARCH_DIST) {
  const battleTerrains = ['forest', 'cave', 'mountain'];
  const nonSettlements = ['forest', 'cave', 'mountain', 'bridge'];

  // First pass: try to find Ring 2-3 battle nodes
  let candidates = regionNodes
    .map((node, index) => ({
      node,
      index,
      distance: Math.hypot(node.x - borderX, node.y - borderY)
    }))
    .filter(n => {
      // Must be battle terrain (not a settlement)
      if (!battleTerrains.includes(n.node.nodeType)) return false;
      // Must be within search distance
      if (n.distance > maxDist) return false;
      // Prefer Ring 2-3 nodes (farther from castle)
      if (n.node.ringDistance !== undefined && n.node.ringDistance < 2) return false;
      return true;
    })
    .sort((a, b) => a.distance - b.distance);

  // Fallback 1: if no Ring 2-3 nodes found, accept any battle terrain node (any ring)
  if (candidates.length === 0) {
    candidates = regionNodes
      .map((node, index) => ({
        node,
        index,
        distance: Math.hypot(node.x - borderX, node.y - borderY)
      }))
      .filter(n => {
        // Must be battle terrain (not a settlement)
        if (!battleTerrains.includes(n.node.nodeType)) return false;
        // Extended search distance for fallback
        if (n.distance > maxDist * 2) return false;
        return true;
      })
      .sort((a, b) => a.distance - b.distance);
  }

  // Fallback 2: if still no nodes found, accept any non-settlement node with no distance limit
  if (candidates.length === 0) {
    candidates = regionNodes
      .map((node, index) => ({
        node,
        index,
        distance: Math.hypot(node.x - borderX, node.y - borderY)
      }))
      .filter(n => {
        // Must be non-settlement
        if (!nonSettlements.includes(n.node.nodeType)) return false;
        return true;
      })
      .sort((a, b) => a.distance - b.distance);
  }

  // Fallback 3: if absolutely nothing found, return nearest node regardless of type
  if (candidates.length === 0) {
    candidates = regionNodes
      .map((node, index) => ({
        node,
        index,
        distance: Math.hypot(node.x - borderX, node.y - borderY)
      }))
      .filter(n => n.node.nodeType !== 'castle') // Just avoid the castle
      .sort((a, b) => a.distance - b.distance);
  }

  return candidates;
}

/**
 * Generate a thematic bridge name for a region border
 *
 * @param {string} region1Name - Name of first region
 * @param {string} region2Name - Name of second region
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {string} Bridge name
 */
export function generateBridgeName(region1Name, region2Name, rng) {
  // Sort region names for consistent key lookup
  const names = [region1Name, region2Name].sort();
  const key = names.join('-');

  const bridgeNames = BRIDGE_NAMES[key];
  if (bridgeNames && bridgeNames.length > 0) {
    return rng.pick(bridgeNames);
  }

  // Fallback: generic bridge name
  const fallbackNames = ['Border Bridge', 'Realm Crossing', 'The Great Span', 'Alliance Bridge'];
  return rng.pick(fallbackNames);
}

/**
 * Create a bridge node at the border midpoint
 * Bridge connects exactly two regions (max 2 connections)
 *
 * @param {Object} border - Border data from getRegionBorders()
 * @param {Map} nodesByRegion - Map of regionId -> nodes array
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {Object} Bridge node with connection info
 */
export function createBridgeNode(border, nodesByRegion, rng) {
  const { midpoint, region1, region2, region1Name, region2Name } = border;

  // border.region1/region2 are 0-indexed, nodesByRegion keys are 1-indexed (regionId)
  const r1Nodes = nodesByRegion.get(region1 + 1);
  const r2Nodes = nodesByRegion.get(region2 + 1);

  if (!r1Nodes || !r2Nodes) {
    console.warn(`  Warning: Could not find nodes for regions ${region1 + 1}/${region2 + 1}`);
    return null;
  }

  // Create the bridge node
  const bridgeNode = {
    x: midpoint.x,
    y: midpoint.y,
    nodeType: 'bridge',
    regionId: null,                    // Bridge is between regions
    regionName: 'Border',
    distFromCastle: Infinity,          // Not associated with any castle
    ringDistance: 4,                   // Special ring for inter-region
    hopDistance: -1,                   // Will be calculated during final connectivity
    isBridge: true,
    connectsRegions: [region1, region2],
    region1Name,
    region2Name,
    name: generateBridgeName(region1Name, region2Name, rng)
  };

  const frontier1 = findFrontierNodes(r1Nodes, midpoint.x, midpoint.y);
  const frontier2 = findFrontierNodes(r2Nodes, midpoint.x, midpoint.y);

  if (frontier1.length === 0 || frontier2.length === 0) {
    console.warn(`  Warning: No frontier nodes found for bridge between ${region1Name} and ${region2Name}`);
    return null;
  }

  // Store connection targets (will be connected during final phase)
  bridgeNode.connectTo = {
    region1: frontier1[0],
    region2: frontier2[0]
  };

  console.log(`    Bridge: "${bridgeNode.name}" at (${midpoint.x.toFixed(1)}, ${midpoint.y.toFixed(1)})`);
  console.log(`      Connects: ${region1Name} node at ${frontier1[0].distance.toFixed(1)} <-> ${region2Name} node at ${frontier2[0].distance.toFixed(1)}`);

  return bridgeNode;
}

/**
 * Create wilderness zone for medium+ borders
 * 2-4 battle nodes with higher difficulty tier
 *
 * @param {Object} border - Border data from getRegionBorders()
 * @param {Object|null} bridgeNode - Bridge node already created for this border (may be null)
 * @param {Map} nodesByRegion - Map of regionId -> nodes array
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {Array} Array of wilderness nodes
 */
export function createWildernessZone(border, bridgeNode, nodesByRegion, rng) {
  const { points, midpoint, region1, region2, region1Name, region2Name } = border;

  // border.region1/region2 are 0-indexed, nodesByRegion keys are 1-indexed (regionId)
  const r1Nodes = nodesByRegion.get(region1 + 1);
  const r2Nodes = nodesByRegion.get(region2 + 1);

  // Collect terrain types from each region
  const battleTerrains1 = r1Nodes
    .filter(n => ['forest', 'cave', 'mountain'].includes(n.nodeType))
    .map(n => n.nodeType);
  const battleTerrains2 = r2Nodes
    .filter(n => ['forest', 'cave', 'mountain'].includes(n.nodeType))
    .map(n => n.nodeType);

  // Mix terrains from both regions
  const mixedTerrains = [...battleTerrains1.slice(0, 5), ...battleTerrains2.slice(0, 5)];
  if (mixedTerrains.length === 0) {
    mixedTerrains.push('forest', 'cave', 'mountain');
  }

  // Determine node count based on border length
  const nodeCount = Math.min(
    INTER_REGION_CONFIG.WILDERNESS_MAX_NODES,
    Math.max(
      INTER_REGION_CONFIG.WILDERNESS_MIN_NODES,
      Math.floor(border.edgeLength / 8)
    )
  );

  const wildernessNodes = [];
  const spacing = INTER_REGION_CONFIG.WILDERNESS_SPACING;

  // Use bridge position or border midpoint as center reference
  const centerX = bridgeNode ? bridgeNode.x : midpoint.x;
  const centerY = bridgeNode ? bridgeNode.y : midpoint.y;

  // Place nodes along the border
  for (let i = 0; i < nodeCount; i++) {
    // Calculate position along the border
    let nodeX, nodeY;

    if (points && points.length >= 2) {
      // Use actual border points if available
      const t = (i + 0.5) / nodeCount;
      const pointIndex = Math.floor(t * (points.length - 1));
      const nextIndex = Math.min(pointIndex + 1, points.length - 1);

      const localT = (t * (points.length - 1)) - pointIndex;
      nodeX = points[pointIndex].x + (points[nextIndex].x - points[pointIndex].x) * localT;
      nodeY = points[pointIndex].y + (points[nextIndex].y - points[pointIndex].y) * localT;
    } else {
      // Fallback: place nodes around the center (bridge or midpoint)
      const angle = (i / nodeCount) * Math.PI + rng.next() * 0.5;
      const dist = spacing * (1 + i * 0.3);
      nodeX = centerX + Math.cos(angle) * dist;
      nodeY = centerY + Math.sin(angle) * dist;
    }

    // Add some randomness to position
    nodeX += (rng.next() - 0.5) * 2;
    nodeY += (rng.next() - 0.5) * 2;

    // Pick terrain from mixed pool
    const terrain = rng.pick(mixedTerrains);

    // Calculate base difficulty from nearby regions
    const nearestR1 = findNearestNodeInRegion(nodeX, nodeY, r1Nodes);
    const nearestR2 = findNearestNodeInRegion(nodeX, nodeY, r2Nodes);
    let baseDifficulty = 3; // Default mid-tier

    if (nearestR1 && nearestR2) {
      baseDifficulty = Math.max(
        nearestR1.node.difficultyTier || 3,
        nearestR2.node.difficultyTier || 3
      );
    }

    const wildernessNode = {
      x: nodeX,
      y: nodeY,
      nodeType: terrain,
      regionId: null,
      regionName: `${region1Name}/${region2Name} Border`,
      distFromCastle: Infinity,
      ringDistance: 4,
      hopDistance: -1,
      isWilderness: true,
      borderRegions: [region1, region2],
      difficultyTier: Math.min(5, baseDifficulty + INTER_REGION_CONFIG.WILDERNESS_DIFFICULTY_BONUS),
      name: `Border ${terrain.charAt(0).toUpperCase() + terrain.slice(1)}`
    };

    wildernessNodes.push(wildernessNode);
  }

  console.log(`    Wilderness Zone: ${wildernessNodes.length} nodes between ${region1Name} and ${region2Name}`);

  return wildernessNodes;
}

/**
 * Create trade route between nearest cities of adjacent regions
 * 3-5 low-tier forest nodes forming a safe path
 *
 * @param {Object} border - Border data from getRegionBorders()
 * @param {Object} bridgeNode - Bridge node already created for this border
 * @param {Map} nodesByRegion - Map of regionId -> nodes array
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {Array} Array of trade route nodes
 */
export function createTradeRoute(border, bridgeNode, nodesByRegion, rng) {
  const { midpoint, region1, region2, region1Name, region2Name } = border;

  // border.region1/region2 are 0-indexed, nodesByRegion keys are 1-indexed (regionId)
  const r1Nodes = nodesByRegion.get(region1 + 1);
  const r2Nodes = nodesByRegion.get(region2 + 1);

  // Find nearest city in each region
  const city1 = findNearestNodeInRegion(midpoint.x, midpoint.y, r1Nodes, 'city');
  const city2 = findNearestNodeInRegion(midpoint.x, midpoint.y, r2Nodes, 'city');

  // Get endpoint1 (city or village from region1)
  let endpoint1 = city1;
  if (!endpoint1) {
    endpoint1 = findNearestNodeInRegion(midpoint.x, midpoint.y, r1Nodes, 'village');
  }

  // Get endpoint2 (city or village from region2)
  let endpoint2 = city2;
  if (!endpoint2) {
    endpoint2 = findNearestNodeInRegion(midpoint.x, midpoint.y, r2Nodes, 'village');
  }

  if (!endpoint1 || !endpoint2) {
    console.warn(`  Warning: No suitable endpoints for trade route between ${region1Name} and ${region2Name}`);
    return [];
  }

  // Use bridge position or border midpoint as center reference
  const centerX = bridgeNode ? bridgeNode.x : midpoint.x;
  const centerY = bridgeNode ? bridgeNode.y : midpoint.y;

  // Calculate path from city1 -> center -> city2
  // Place trade route nodes along this path, offset from the bridge
  const nodeCount = rng.nextInt(
    INTER_REGION_CONFIG.TRADE_ROUTE_MIN_NODES,
    INTER_REGION_CONFIG.TRADE_ROUTE_MAX_NODES
  );

  const tradeRouteNodes = [];

  // Direction perpendicular to endpoint line (to offset from main path)
  const dx = endpoint2.node.x - endpoint1.node.x;
  const dy = endpoint2.node.y - endpoint1.node.y;
  const length = Math.hypot(dx, dy);

  // Avoid division by zero
  const perpX = length > 0.001 ? -dy / length : 0;
  const perpY = length > 0.001 ? dx / length : 1;

  // Offset from the bridge line
  const offsetDist = 3 + rng.next() * 2;
  const offsetDir = rng.next() > 0.5 ? 1 : -1;

  for (let i = 0; i < nodeCount; i++) {
    // Calculate position along the trade route
    const t = (i + 1) / (nodeCount + 1);

    // Interpolate between endpoints, passing through center vicinity
    let nodeX, nodeY;

    if (t < 0.5) {
      // First half: endpoint1 -> center
      const localT = t * 2;
      nodeX = endpoint1.node.x + (centerX - endpoint1.node.x) * localT;
      nodeY = endpoint1.node.y + (centerY - endpoint1.node.y) * localT;
    } else {
      // Second half: center -> endpoint2
      const localT = (t - 0.5) * 2;
      nodeX = centerX + (endpoint2.node.x - centerX) * localT;
      nodeY = centerY + (endpoint2.node.y - centerY) * localT;
    }

    // Add perpendicular offset to avoid overlapping with bridge/wilderness
    nodeX += perpX * offsetDist * offsetDir;
    nodeY += perpY * offsetDist * offsetDir;

    // Add some randomness
    nodeX += (rng.next() - 0.5) * 1.5;
    nodeY += (rng.next() - 0.5) * 1.5;

    // Trade routes are mostly forests (safe, maintained paths)
    const terrain = rng.next() < 0.8 ? 'forest' : (rng.next() < 0.5 ? 'mountain' : 'cave');

    const tradeNode = {
      x: nodeX,
      y: nodeY,
      nodeType: terrain,
      regionId: null,
      regionName: `${region1Name}-${region2Name} Trade Route`,
      distFromCastle: Infinity,
      ringDistance: 4,
      hopDistance: -1,
      isTradeRoute: true,
      tradeRegions: [region1, region2],
      difficultyTier: Math.max(1, 2 - INTER_REGION_CONFIG.TRADE_ROUTE_DIFFICULTY_REDUCTION),
      name: `Trade ${terrain.charAt(0).toUpperCase() + terrain.slice(1)}`
    };

    tradeRouteNodes.push(tradeNode);
  }

  // Store endpoint info for later connection
  if (tradeRouteNodes.length > 0) {
    tradeRouteNodes[0].connectToCity1 = { region: region1, cityIndex: endpoint1.index };
    tradeRouteNodes[tradeRouteNodes.length - 1].connectToCity2 = { region: region2, cityIndex: endpoint2.index };
  }

  console.log(`    Trade Route: ${tradeRouteNodes.length} nodes between ${region1Name} city and ${region2Name} city`);

  return tradeRouteNodes;
}

/**
 * Create the Grand Palace node at the farthest Voronoi vertex
 * The palace is the final destination, connecting multiple regions
 *
 * @param {Object} palacePosition - Position data from findGrandPalacePosition()
 * @returns {Object} Grand Palace node
 */
export function createGrandPalace(palacePosition) {
  const { x, y, adjacentRegions, regionNames } = palacePosition;

  const palace = {
    x: x,
    y: y,
    nodeType: 'palace',
    regionId: null,
    regionName: 'Grand Palace',
    distFromCastle: Infinity,
    ringDistance: 5,                   // Special ring for palace
    hopDistance: -1,
    isPalace: true,
    adjacentRegions: adjacentRegions || [],
    name: 'Grand Palace',
    difficultyTier: 5,                 // Highest difficulty
    features: ['throne_room', 'treasury', 'royal_guard']
  };

  console.log(`  Grand Palace: (${x.toFixed(1)}, ${y.toFixed(1)})`);
  if (regionNames && regionNames.length > 0) {
    console.log(`    Adjacent regions: ${regionNames.join(', ')}`);
  }

  return palace;
}

/**
 * Generate all inter-region connections
 * Orchestrates Phase 5 across all region borders
 *
 * @param {Object} voronoiData - Output from createVoronoiRegions()
 * @param {Map} nodesByRegion - Map of regionId -> nodes array
 * @param {Array} allNodes - All generated nodes (will be mutated)
 * @param {Array} castles - Castle positions with region info
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {Object} Inter-region connection data
 */
export function generateInterRegionConnections(voronoiData, nodesByRegion, allNodes, castles, rng) {
  console.log('\n========================================');
  console.log('PHASE 5: Inter-Region Connections');
  console.log('========================================');

  const borders = getRegionBorders(voronoiData);
  const interRegionNodes = [];
  const interRegionConnections = [];

  console.log(`\nProcessing ${borders.length} region borders...\n`);

  for (const border of borders) {
    console.log(`  Border: ${border.region1Name} <-> ${border.region2Name}`);
    console.log(`    Length: ${border.edgeLength.toFixed(1)}, Type: ${border.connectionType}`);

    // border.region1/region2 are 0-indexed, nodesByRegion keys are 1-indexed
    const r1Nodes = nodesByRegion.get(border.region1 + 1);
    const r2Nodes = nodesByRegion.get(border.region2 + 1);

    // 1. Always create bridge node
    const bridgeNode = createBridgeNode(border, nodesByRegion, rng);
    if (bridgeNode) {
      interRegionNodes.push(bridgeNode);

      // For bridge_only type, connect bridge directly to frontier nodes in both regions
      if (border.connectionType === 'bridge_only' && bridgeNode.connectTo) {
        // Connect to region 1 frontier
        if (bridgeNode.connectTo.region1 && bridgeNode.connectTo.region1.node) {
          interRegionConnections.push({
            from: bridgeNode,
            to: bridgeNode.connectTo.region1,
            connectionType: 'bridge_frontier'
          });
        }
        // Connect to region 2 frontier
        if (bridgeNode.connectTo.region2 && bridgeNode.connectTo.region2.node) {
          interRegionConnections.push({
            from: bridgeNode,
            to: bridgeNode.connectTo.region2,
            connectionType: 'bridge_frontier'
          });
        }
      }
    }

    // 2. Create wilderness zone for medium+ borders
    if (border.connectionType === 'bridge_wilderness' ||
        border.connectionType === 'bridge_wilderness_trade') {
      const wildernessNodes = createWildernessZone(border, bridgeNode, nodesByRegion, rng);
      interRegionNodes.push(...wildernessNodes);

      // Connect wilderness nodes to bridge and each other
      if (bridgeNode && wildernessNodes.length > 0) {
        // Connect first wilderness to bridge
        interRegionConnections.push({
          from: bridgeNode,
          to: wildernessNodes[0],
          connectionType: 'wilderness'
        });

        // Chain wilderness nodes together
        for (let i = 0; i < wildernessNodes.length - 1; i++) {
          interRegionConnections.push({
            from: wildernessNodes[i],
            to: wildernessNodes[i + 1],
            connectionType: 'wilderness'
          });
        }

        // Connect wilderness to frontier nodes in both regions for accessibility
        if (r1Nodes && r2Nodes) {
          const centerX = bridgeNode ? bridgeNode.x : border.midpoint.x;
          const centerY = bridgeNode ? bridgeNode.y : border.midpoint.y;
          const frontier1 = findFrontierNodes(r1Nodes, centerX, centerY);
          const frontier2 = findFrontierNodes(r2Nodes, centerX, centerY);

          // Connect last wilderness node to region frontiers
          const lastWilderness = wildernessNodes[wildernessNodes.length - 1];
          if (frontier1.length > 0) {
            interRegionConnections.push({
              from: lastWilderness,
              to: frontier1[0],
              connectionType: 'wilderness_frontier'
            });
          }
          if (frontier2.length > 0) {
            interRegionConnections.push({
              from: lastWilderness,
              to: frontier2[0],
              connectionType: 'wilderness_frontier'
            });
          }
        }
      }
    }

    // 3. Create trade route for long borders
    if (border.connectionType === 'bridge_wilderness_trade') {
      const tradeRouteNodes = createTradeRoute(border, bridgeNode, nodesByRegion, rng);
      interRegionNodes.push(...tradeRouteNodes);

      // Connect trade route nodes
      if (tradeRouteNodes.length > 0) {
        // Chain trade route nodes together
        for (let i = 0; i < tradeRouteNodes.length - 1; i++) {
          interRegionConnections.push({
            from: tradeRouteNodes[i],
            to: tradeRouteNodes[i + 1],
            connectionType: 'trade'
          });
        }

        // Connect trade route endpoints to their cities
        const firstNode = tradeRouteNodes[0];
        const lastNode = tradeRouteNodes[tradeRouteNodes.length - 1];

        if (firstNode.connectToCity1 && r1Nodes) {
          const cityNode = r1Nodes[firstNode.connectToCity1.cityIndex];
          if (cityNode) {
            interRegionConnections.push({
              from: firstNode,
              to: { node: cityNode, distance: 0 },
              connectionType: 'trade_city'
            });
            console.log(`      Trade route connected to ${border.region1Name} city`);
          }
        }

        if (lastNode.connectToCity2 && r2Nodes) {
          const cityNode = r2Nodes[lastNode.connectToCity2.cityIndex];
          if (cityNode) {
            interRegionConnections.push({
              from: lastNode,
              to: { node: cityNode, distance: 0 },
              connectionType: 'trade_city'
            });
            console.log(`      Trade route connected to ${border.region2Name} city`);
          }
        }
      }
    }

    console.log('');
  }

  // 4. Create Grand Palace at the farthest vertex
  const palacePosition = findGrandPalacePosition(voronoiData, castles);
  const palace = createGrandPalace(palacePosition);
  interRegionNodes.push(palace);

  // Connect palace to nearest nodes in adjacent regions
  // palace.adjacentRegions contains 0-indexed region indices
  if (palace.adjacentRegions && palace.adjacentRegions.length > 0) {
    for (const regionIdx of palace.adjacentRegions) {
      // Use 1-indexed regionId to access nodesByRegion
      const regionNodes = nodesByRegion.get(regionIdx + 1);
      if (regionNodes) {
        const nearest = findFrontierNodes(regionNodes, palace.x, palace.y);
        if (nearest.length > 0) {
          interRegionConnections.push({
            from: palace,
            to: nearest[0],
            connectionType: 'palace'
          });
          console.log(`    Palace connected to ${castles[regionIdx].region.name} frontier node`);
        }
      }
    }
  }

  // Summary
  console.log(`\nPhase 5 Complete:`);
  console.log(`  Inter-region nodes: ${interRegionNodes.length}`);
  console.log(`    - Bridges: ${interRegionNodes.filter(n => n.isBridge).length}`);
  console.log(`    - Wilderness: ${interRegionNodes.filter(n => n.isWilderness).length}`);
  console.log(`    - Trade Route: ${interRegionNodes.filter(n => n.isTradeRoute).length}`);
  console.log(`    - Palace: ${interRegionNodes.filter(n => n.isPalace).length}`);
  console.log(`  Inter-region connections: ${interRegionConnections.length}`);

  return {
    interRegionNodes,
    interRegionConnections,
    palace,
    borders
  };
}

/**
 * Validation function for Phase 5: Inter-Region Connections
 *
 * @param {number} seed - Random seed for testing
 * @returns {Object} Validation results
 */
export function validateInterRegionConnections(seed = 12345) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('INTER-REGION CONNECTIONS VALIDATION (Phase 5)');
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

  // Run Phase 5: Inter-region connections
  const interRegionData = generateInterRegionConnections(
    voronoiData,
    nodeData.nodesByRegion,
    nodeData.allNodes,
    castles,
    rng
  );

  // Validation checks
  const issues = [];

  // Check 1: All borders have at least a bridge
  const bordersWithBridges = new Set();
  for (const node of interRegionData.interRegionNodes) {
    if (node.isBridge && node.connectsRegions) {
      const key = node.connectsRegions.sort().join('-');
      bordersWithBridges.add(key);
    }
  }

  for (const border of interRegionData.borders) {
    const key = [border.region1, border.region2].sort().join('-');
    if (!bordersWithBridges.has(key)) {
      issues.push(`Border ${border.region1Name}-${border.region2Name} missing bridge`);
    }
  }

  // Check 2: Medium+ borders have wilderness zones
  for (const border of interRegionData.borders) {
    if (border.connectionType === 'bridge_wilderness' ||
        border.connectionType === 'bridge_wilderness_trade') {
      const wildernessCount = interRegionData.interRegionNodes.filter(n =>
        n.isWilderness &&
        n.borderRegions &&
        n.borderRegions.includes(border.region1) &&
        n.borderRegions.includes(border.region2)
      ).length;

      if (wildernessCount < INTER_REGION_CONFIG.WILDERNESS_MIN_NODES) {
        issues.push(`Border ${border.region1Name}-${border.region2Name} has insufficient wilderness nodes: ${wildernessCount}`);
      }
    }
  }

  // Check 3: Long borders have trade routes
  for (const border of interRegionData.borders) {
    if (border.connectionType === 'bridge_wilderness_trade') {
      const tradeCount = interRegionData.interRegionNodes.filter(n =>
        n.isTradeRoute &&
        n.tradeRegions &&
        n.tradeRegions.includes(border.region1) &&
        n.tradeRegions.includes(border.region2)
      ).length;

      if (tradeCount < INTER_REGION_CONFIG.TRADE_ROUTE_MIN_NODES) {
        issues.push(`Border ${border.region1Name}-${border.region2Name} has insufficient trade route nodes: ${tradeCount}`);
      }
    }
  }

  // Check 4: Palace exists
  const palaceCount = interRegionData.interRegionNodes.filter(n => n.isPalace).length;
  if (palaceCount !== 1) {
    issues.push(`Expected 1 palace, found ${palaceCount}`);
  }

  // Check 5: Bridge nodes have valid connections
  for (const node of interRegionData.interRegionNodes) {
    if (node.isBridge && node.connectTo) {
      if (!node.connectTo.region1 || !node.connectTo.region2) {
        issues.push(`Bridge "${node.name}" missing connection targets`);
      }
    }
  }

  const passed = issues.length === 0;

  // Summary
  console.log('\n  Summary:');
  console.log(`    Borders processed: ${interRegionData.borders.length}`);
  console.log(`    Inter-region nodes: ${interRegionData.interRegionNodes.length}`);
  console.log(`    Inter-region connections: ${interRegionData.interRegionConnections.length}`);
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
    interRegionData,
    passed,
    issues
  };
}
