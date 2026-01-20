/**
 * Phase 6: Validation & Cleanup
 *
 * Final phase of 5-region world generation system.
 * Validates world connectivity, assigns difficulty tiers, and creates terminator nodes.
 *
 * Functions:
 * - calculateDifficultyTier: Assign difficulty 1-5 based on ring distance and node type
 * - assignTerminatorNodesRegional: Convert Ring 3+ dead-ends to chest/shrine/discovery
 * - verifyConnectivity: BFS flood fill to ensure all nodes are reachable
 * - validateAndCleanup: Main orchestration function for Phase 6
 * - validatePhase6: Test function to run full validation with sample data
 */

import { PHASE6_CONFIG, INTER_REGION_CONFIG } from './constants.js';
import { SeededRandom } from '../../config/constants.js';
import { generateCastlePlacements } from './castlePlacement.js';
import { createVoronoiRegions } from './voronoiPartitioning.js';
import { generateAllRegionNodes } from './nodeGeneration.js';
import { generateAllRegionConnections } from './internalConnections.js';
import { generateInterRegionConnections } from './interRegionConnections.js';

/**
 * Calculate difficulty tier based on ring distance
 *
 * Tier mapping:
 * - Ring 0 (castle): Tier 1 (safe)
 * - Ring 1: Tier 1-2 (beginner)
 * - Ring 2: Tier 2-3 (intermediate)
 * - Ring 3: Tier 3-4 (advanced)
 * - Palace: Tier 5 (endgame)
 *
 * @param {Object} node - Node with ringDistance and nodeType
 * @returns {number} Difficulty tier (1-5)
 */
export function calculateDifficultyTier(node) {
  // Special cases
  if (node.nodeType === 'castle') return 1;
  if (node.nodeType === 'palace') return 5;

  // Settlements in Ring 0-1 are safe
  if (['city', 'village', 'guild', 'keep'].includes(node.nodeType)) {
    if (node.ringDistance <= 1) return 1;
    if (node.ringDistance === 2) return 2;
    return 3;
  }

  // Battle nodes based on ring distance
  switch (node.ringDistance) {
    case 0: return 1;  // Castle area
    case 1: return 2;  // Near castle
    case 2: return 3;  // Mid region
    case 3: return 4;  // Outer region
    default: return 4; // Inter-region/wilderness
  }
}

/**
 * Assign terminator types to dead-end nodes in Ring 3
 * Dead-end nodes have exactly 1 connection
 *
 * Distribution:
 * - 30% chest (one-time loot)
 * - 30% shrine (temporary buffs)
 * - 40% discovery (lore/exploration rewards)
 *
 * @param {Array<Object>} allNodes - All nodes (will be mutated)
 * @param {Array<Object>} allConnections - All connections
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {Object} Terminator assignment stats
 */
export function assignTerminatorNodesRegional(allNodes, allConnections, rng) {
  console.log('\n  Assigning terminator nodes...');

  // Build connection counts for all nodes
  const connectionCounts = new Map();
  for (let i = 0; i < allNodes.length; i++) {
    connectionCounts.set(i, 0);
  }

  for (const conn of allConnections) {
    // Handle both index-based and node reference connections
    const fromIdx = typeof conn.from === 'number' ? conn.from : allNodes.indexOf(conn.from);
    const toIdx = typeof conn.to === 'number' ? conn.to : (conn.to.node ? allNodes.indexOf(conn.to.node) : allNodes.indexOf(conn.to));

    if (fromIdx >= 0) connectionCounts.set(fromIdx, connectionCounts.get(fromIdx) + 1);
    if (toIdx >= 0) connectionCounts.set(toIdx, connectionCounts.get(toIdx) + 1);
  }

  // Find candidates: Ring 3+ battle nodes with low connectivity (1-2 connections)
  // These become special terminator nodes (chest/shrine/discovery)
  const battleTypes = ['forest', 'cave', 'mountain'];
  const candidates = [];

  for (let i = 0; i < allNodes.length; i++) {
    const node = allNodes[i];
    const connCount = connectionCounts.get(i) || 0;

    // Must be Ring 3+ (outer region) or explicitly flagged inter-region nodes
    const isRing3Plus = (node.ringDistance >= PHASE6_CONFIG.MIN_RING_FOR_TERMINATOR) ||
                        (node.isWilderness);

    // Must have low connectivity (1-2 connections) - these are peripheral nodes
    const isLowDegree = connCount <= 2;

    // Must be a battle terrain type (not settlements, bridges, etc.)
    const isBattleTerrain = battleTypes.includes(node.nodeType);

    if (isRing3Plus && isLowDegree && isBattleTerrain) {
      candidates.push({ idx: i, connCount });
    }
  }

  // Sort candidates by connection count (prefer lower connectivity)
  candidates.sort((a, b) => a.connCount - b.connCount);

  console.log(`    Found ${candidates.length} low-connectivity candidates in Ring 3+`);

  // Shuffle candidates for random distribution (keeping priority by connectivity)
  // Take from lowest connectivity first, then shuffle within each tier
  const shuffled = rng.shuffle([...candidates]);

  // Calculate target count (~6% of total nodes)
  const targetCount = Math.min(
    shuffled.length,
    Math.floor(allNodes.length * PHASE6_CONFIG.TARGET_TERMINATOR_RATIO)
  );

  const stats = { chest: 0, shrine: 0, discovery: 0 };

  for (let i = 0; i < targetCount; i++) {
    const nodeIdx = shuffled[i].idx;
    const node = allNodes[nodeIdx];
    const rand = rng.next();

    if (rand < PHASE6_CONFIG.TERMINATOR_CHEST_RATIO) {
      // Chest (30%)
      node.nodeType = 'chest';
      node.isTerminator = true;
      stats.chest++;
    } else if (rand < PHASE6_CONFIG.TERMINATOR_CHEST_RATIO + PHASE6_CONFIG.TERMINATOR_SHRINE_RATIO) {
      // Shrine (30%)
      node.nodeType = 'shrine';
      node.isTerminator = true;
      node.shrineBuffType = rng.pick(PHASE6_CONFIG.SHRINE_BUFF_TYPES);
      stats.shrine++;
    } else {
      // Discovery (40%)
      node.nodeType = 'discovery';
      node.isTerminator = true;
      // Generate lore key based on position for consistency
      node.loreKey = `lore_${Math.abs(Math.round(node.x))}_${Math.abs(Math.round(node.y))}`;
      stats.discovery++;
    }
  }

  console.log(`    Assigned ${targetCount} terminators: ${stats.chest} chest, ${stats.shrine} shrine, ${stats.discovery} discovery`);

  return stats;
}

/**
 * Verify all nodes are reachable from any castle using flood fill
 *
 * @param {Array<Object>} allNodes - All nodes in the world
 * @param {Array<Object>} allConnections - All connections
 * @returns {Object} Reachability check results
 */
export function verifyConnectivity(allNodes, allConnections) {
  console.log('\n  Verifying connectivity...');

  // Build adjacency list
  const adjacency = new Map();
  for (let i = 0; i < allNodes.length; i++) {
    adjacency.set(i, new Set());
  }

  for (const conn of allConnections) {
    const fromIdx = typeof conn.from === 'number' ? conn.from : allNodes.indexOf(conn.from);
    const toIdx = typeof conn.to === 'number' ? conn.to : (conn.to.node ? allNodes.indexOf(conn.to.node) : allNodes.indexOf(conn.to));

    if (fromIdx >= 0 && toIdx >= 0) {
      adjacency.get(fromIdx).add(toIdx);
      adjacency.get(toIdx).add(fromIdx);
    }
  }

  // Find any castle as starting point
  const castleIdx = allNodes.findIndex(n => n.nodeType === 'castle');
  if (castleIdx === -1) {
    console.warn('    WARNING: No castle found!');
    return { allReachable: false, orphanedNodes: [], castleIdx: -1 };
  }

  // BFS from castle
  const visited = new Set();
  const queue = [castleIdx];
  visited.add(castleIdx);

  while (queue.length > 0) {
    const current = queue.shift();
    for (const neighbor of adjacency.get(current)) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  // Check for orphaned nodes
  const orphanedNodes = [];
  for (let i = 0; i < allNodes.length; i++) {
    if (!visited.has(i)) {
      orphanedNodes.push(i);
    }
  }

  const allReachable = orphanedNodes.length === 0;
  console.log(`    Reachable: ${visited.size}/${allNodes.length}, Orphaned: ${orphanedNodes.length}`);

  return { allReachable, orphanedNodes, castleIdx, visited };
}

/**
 * Validate that all connections respect the maximum spacing constraint.
 * Returns an array of violations with details about which connections are too long.
 *
 * @param {Array<Object>} allNodes - All nodes in the world
 * @param {Array<Object>} allConnections - All connections
 * @param {number} maxSpacing - Maximum allowed distance (defaults to INTER_REGION_CONFIG.MAX_NODE_SPACING)
 * @returns {Object} Validation results with violations array and pass status
 */
export function validateMaxSpacing(allNodes, allConnections, maxSpacing = INTER_REGION_CONFIG.MAX_NODE_SPACING) {
  console.log('\n  Validating max spacing constraint...');

  const violations = [];

  for (const conn of allConnections) {
    // Resolve node references - handle both index-based and object-based connections
    let fromNode, toNode;

    if (typeof conn.from === 'number') {
      fromNode = allNodes[conn.from];
    } else {
      fromNode = conn.from;
    }

    if (typeof conn.to === 'number') {
      toNode = allNodes[conn.to];
    } else if (conn.to.node) {
      toNode = conn.to.node;
    } else {
      toNode = conn.to;
    }

    if (!fromNode || !toNode) {
      continue; // Skip invalid connections
    }

    const distance = Math.hypot(toNode.x - fromNode.x, toNode.y - fromNode.y);

    if (distance > maxSpacing) {
      violations.push({
        from: fromNode.name || `Node at (${fromNode.x?.toFixed(1)}, ${fromNode.y?.toFixed(1)})`,
        to: toNode.name || `Node at (${toNode.x?.toFixed(1)}, ${toNode.y?.toFixed(1)})`,
        distance: distance,
        maxAllowed: maxSpacing,
        connectionType: conn.connectionType || 'unknown'
      });
    }
  }

  const passed = violations.length === 0;

  if (passed) {
    console.log(`    All ${allConnections.length} connections respect max spacing of ${maxSpacing} units`);
  } else {
    console.log(`    WARNING: ${violations.length} connections exceed max spacing of ${maxSpacing} units`);
    // Show first 5 violations
    for (const v of violations.slice(0, 5)) {
      console.log(`      - ${v.from} -> ${v.to}: ${v.distance.toFixed(1)} units (${v.connectionType})`);
    }
    if (violations.length > 5) {
      console.log(`      ... and ${violations.length - 5} more violations`);
    }
  }

  return { passed, violations, totalConnections: allConnections.length };
}

/**
 * Validate Phase 4 internal connection spacing specifically.
 * Checks that all connections within each region respect the max spacing constraint.
 *
 * @param {Map<number, Array<Object>>} connectionsByRegion - Map of regionId -> connections
 * @param {Map<number, Array<Object>>} nodesByRegion - Map of regionId -> nodes
 * @param {number} maxSpacing - Maximum allowed distance (defaults to INTER_REGION_CONFIG.MAX_NODE_SPACING)
 * @returns {Object} Validation results with violations by region
 */
export function validatePhase4Spacing(connectionsByRegion, nodesByRegion, maxSpacing = INTER_REGION_CONFIG.MAX_NODE_SPACING) {
  console.log('\n  Validating Phase 4 internal connection spacing...');

  const violationsByRegion = new Map();
  let totalViolations = 0;

  for (const [regionId, connections] of connectionsByRegion) {
    const nodes = nodesByRegion.get(regionId);
    if (!nodes) {
      console.warn(`  Warning: No nodes found for region ${regionId}`);
      continue;
    }
    const regionViolations = [];

    for (const conn of connections) {
      const nodeA = nodes[conn.from];
      const nodeB = nodes[conn.to];

      if (!nodeA || !nodeB) continue;

      const distance = conn.distance !== undefined
        ? conn.distance
        : Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y);

      if (distance > maxSpacing) {
        regionViolations.push({
          from: nodeA.name || `Node ${conn.from}`,
          to: nodeB.name || `Node ${conn.to}`,
          distance,
          maxAllowed: maxSpacing,
          fromType: nodeA.nodeType,
          toType: nodeB.nodeType
        });
      }
    }

    if (regionViolations.length > 0) {
      violationsByRegion.set(regionId, regionViolations);
      totalViolations += regionViolations.length;

      // Get region name from first node
      const regionName = nodes[0]?.regionName || `Region ${regionId}`;
      console.log(`    ${regionName}: ${regionViolations.length} violations`);

      // Show first few violations
      for (const v of regionViolations.slice(0, 3)) {
        console.log(`      - ${v.from} -> ${v.to}: ${v.distance.toFixed(1)} units (max: ${maxSpacing})`);
      }
      if (regionViolations.length > 3) {
        console.log(`      ... and ${regionViolations.length - 3} more`);
      }
    }
  }

  const passed = totalViolations === 0;

  if (passed) {
    console.log(`    All Phase 4 connections respect max spacing of ${maxSpacing} units`);
  } else {
    console.log(`    FAILED: ${totalViolations} total violations across ${violationsByRegion.size} regions`);
  }

  return { passed, violationsByRegion, totalViolations };
}

/**
 * Validate and finalize all world data
 * Phase 6 orchestration function
 *
 * @param {Array<Object>} allNodes - All nodes from Phases 3+5
 * @param {Array<Object>} regionConnections - Internal connections from Phase 4
 * @param {Array<Object>} interRegionConnections - Inter-region connections from Phase 5
 * @param {Array<Object>} castles - Castle positions with region info
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {Object} Final validated world data
 */
export function validateAndCleanup(allNodes, regionConnections, interRegionConnections, castles, rng) {
  console.log('\n========================================');
  console.log('PHASE 6: Validation & Cleanup');
  console.log('========================================');

  // Combine all connections
  const allConnections = [...regionConnections, ...interRegionConnections];
  console.log(`  Total nodes: ${allNodes.length}`);
  console.log(`  Region connections: ${regionConnections.length}`);
  console.log(`  Inter-region connections: ${interRegionConnections.length}`);

  // Step 1: Calculate difficulty tiers for all nodes
  console.log('\n  Calculating difficulty tiers...');
  for (const node of allNodes) {
    node.difficultyTier = calculateDifficultyTier(node);
  }

  // Count tier distribution
  const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const node of allNodes) {
    tierCounts[node.difficultyTier] = (tierCounts[node.difficultyTier] || 0) + 1;
  }
  console.log(`    Tier distribution: T1=${tierCounts[1]}, T2=${tierCounts[2]}, T3=${tierCounts[3]}, T4=${tierCounts[4]}, T5=${tierCounts[5]}`);

  // Step 2: Assign terminators to Ring 3 dead-ends
  const terminatorStats = assignTerminatorNodesRegional(allNodes, allConnections, rng);

  // Step 3: Verify connectivity
  const connectivityResult = verifyConnectivity(allNodes, allConnections);

  if (!connectivityResult.allReachable) {
    console.warn(`    WARNING: ${connectivityResult.orphanedNodes.length} orphaned nodes detected!`);
    // Mark orphaned nodes for debugging
    for (const idx of connectivityResult.orphanedNodes) {
      allNodes[idx].isOrphaned = true;
    }
  }

  // Step 4: Validate max spacing constraint
  const spacingResult = validateMaxSpacing(allNodes, allConnections);

  // Summary
  console.log('\n  Phase 6 Complete:');
  console.log(`    Total nodes: ${allNodes.length}`);
  console.log(`    Terminators: ${terminatorStats.chest + terminatorStats.shrine + terminatorStats.discovery}`);
  console.log(`    Connectivity: ${connectivityResult.allReachable ? 'PASS' : 'FAIL'}`);
  console.log(`    Max spacing: ${spacingResult.passed ? 'PASS' : 'FAIL'} (${spacingResult.violations.length} violations)`);

  return {
    allNodes,
    allConnections,
    connectivityResult,
    terminatorStats,
    spacingResult
  };
}

/**
 * Validation function for Phase 6: Validation & Cleanup
 *
 * @param {number} seed - Random seed for testing
 * @returns {Object} Validation results
 */
export function validatePhase6(seed = 12345) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('PHASE 6 VALIDATION');
  console.log(`${'='.repeat(60)}`);
  console.log(`Testing with seed: ${seed}`);

  const rng = new SeededRandom(seed);

  // Run Phases 1-5
  const castles = generateCastlePlacements(rng);
  const voronoiData = createVoronoiRegions(castles);
  const nodeData = generateAllRegionNodes(castles, voronoiData, rng);
  const connectionData = generateAllRegionConnections(nodeData, rng);
  const interRegionData = generateInterRegionConnections(
    voronoiData,
    nodeData.nodesByRegion,
    nodeData.allNodes,
    castles,
    rng
  );

  // Merge all nodes (internal + inter-region)
  const mergedNodes = [...nodeData.allNodes, ...interRegionData.interRegionNodes];

  // Run Phase 6
  const phase6Result = validateAndCleanup(
    mergedNodes,
    connectionData.allConnections,
    interRegionData.interRegionConnections,
    castles,
    rng
  );

  // Validation checks
  const issues = [];

  // Check 1: All nodes have difficulty tier
  for (let i = 0; i < phase6Result.allNodes.length; i++) {
    const node = phase6Result.allNodes[i];
    if (!node.difficultyTier || node.difficultyTier < 1 || node.difficultyTier > 5) {
      issues.push(`Node ${i} has invalid difficulty tier: ${node.difficultyTier}`);
    }
  }

  // Check 2: Terminators exist in Ring 3
  const terminators = phase6Result.allNodes.filter(n => n.isTerminator);
  if (terminators.length === 0) {
    issues.push('No terminator nodes assigned');
  } else {
    const ring3Terminators = terminators.filter(n => n.ringDistance >= 3 || n.isWilderness || n.isBridge);
    if (ring3Terminators.length < terminators.length * 0.8) {
      issues.push(`Too many terminators outside Ring 3: ${terminators.length - ring3Terminators.length}`);
    }
  }

  // Check 3: Connectivity
  if (!phase6Result.connectivityResult.allReachable) {
    issues.push(`${phase6Result.connectivityResult.orphanedNodes.length} nodes not reachable from castle`);
  }

  // Check 4: Max spacing constraint
  if (phase6Result.spacingResult && !phase6Result.spacingResult.passed) {
    issues.push(`${phase6Result.spacingResult.violations.length} connections exceed max spacing of ${INTER_REGION_CONFIG.MAX_NODE_SPACING} units`);
  }

  const passed = issues.length === 0;

  console.log('\n  Summary:');
  console.log(`    Validation: ${passed ? 'PASSED' : 'FAILED'}`);

  if (!passed) {
    console.log('\n  Issues:');
    for (const issue of issues.slice(0, 10)) {
      console.log(`    - ${issue}`);
    }
  }

  console.log(`${'='.repeat(60)}\n`);

  return {
    castles,
    voronoiData,
    nodeData,
    connectionData,
    interRegionData,
    phase6Result,
    passed,
    issues
  };
}
