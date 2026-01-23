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

import { PHASE6_CONFIG, INTER_REGION_CONFIG, ZODIAC_CONFIG, TERRAIN_ANTI_CLUSTERING, NODE_DISTRIBUTION, GUILD_CONFIG } from './constants.js';
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
 * Validate battle terrain clustering.
 * Detects clusters where 3+ same-type battle nodes are within N graph hops.
 *
 * @param {Array<Object>} allNodes - All nodes in the world
 * @param {Array<Object>} allConnections - All connections
 * @returns {Object} Validation results with cluster details
 */
export function validateTerrainClustering(allNodes, allConnections) {
  const config = TERRAIN_ANTI_CLUSTERING;

  if (!config.VALIDATION_ENABLED) {
    return { passed: true, clusters: [], skipped: true };
  }

  console.log('\n  Validating terrain clustering...');

  // Build adjacency list for graph traversal
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

  // Find battle nodes
  const battleTypes = NODE_DISTRIBUTION.BATTLE_TYPES;
  const battleNodeIndices = [];
  for (let i = 0; i < allNodes.length; i++) {
    if (battleTypes.includes(allNodes[i].nodeType)) {
      battleNodeIndices.push(i);
    }
  }

  // For each battle node, count same-type nodes within N hops
  const clusters = [];
  const visitedClusters = new Set(); // Track clusters to avoid duplicates

  for (const startIdx of battleNodeIndices) {
    const startNode = allNodes[startIdx];
    const terrainType = startNode.nodeType;

    // BFS up to CLUSTER_HOP_DISTANCE hops
    const visited = new Set([startIdx]);
    const queue = [{ idx: startIdx, depth: 0 }];
    const sameTypeNeighbors = [startIdx];

    while (queue.length > 0) {
      const { idx, depth } = queue.shift();

      if (depth >= config.CLUSTER_HOP_DISTANCE) continue;

      for (const neighborIdx of adjacency.get(idx)) {
        if (visited.has(neighborIdx)) continue;
        visited.add(neighborIdx);

        const neighborNode = allNodes[neighborIdx];
        if (neighborNode.nodeType === terrainType) {
          sameTypeNeighbors.push(neighborIdx);
        }

        queue.push({ idx: neighborIdx, depth: depth + 1 });
      }
    }

    // Check if cluster exceeds max size
    if (sameTypeNeighbors.length > config.MAX_CLUSTER_SIZE) {
      // Create unique cluster ID (sorted indices)
      const clusterKey = sameTypeNeighbors.sort((a, b) => a - b).join('-');
      if (!visitedClusters.has(clusterKey)) {
        visitedClusters.add(clusterKey);
        clusters.push({
          terrainType,
          size: sameTypeNeighbors.length,
          nodeIndices: sameTypeNeighbors,
          nodes: sameTypeNeighbors.map(i => ({
            name: allNodes[i].name || `Node at (${allNodes[i].x?.toFixed(1)}, ${allNodes[i].y?.toFixed(1)})`,
            region: allNodes[i].regionName
          }))
        });
      }
    }
  }

  const passed = clusters.length === 0;

  if (passed) {
    console.log(`    No terrain clusters exceed ${config.MAX_CLUSTER_SIZE} same-type nodes within ${config.CLUSTER_HOP_DISTANCE} hops`);
  } else {
    console.log(`    WARNING: Found ${clusters.length} terrain clusters exceeding max size`);
    for (const cluster of clusters.slice(0, 5)) {
      console.log(`      - ${cluster.terrainType} cluster: ${cluster.size} nodes (${cluster.nodes.map(n => n.region).join(', ')})`);
    }
    if (clusters.length > 5) {
      console.log(`      ... and ${clusters.length - 5} more clusters`);
    }
  }

  return { passed, clusters, totalBattleNodes: battleNodeIndices.length };
}

/**
 * Validate guild distribution and same-type spacing.
 * Ensures guilds are well-distributed globally and same types aren't clustered.
 *
 * @param {Array<Object>} allNodes - All nodes in the world
 * @returns {Object} Validation results with guild distribution details
 */
export function validateGuildSpacing(allNodes) {
  if (!GUILD_CONFIG.VALIDATION_ENABLED) {
    return { passed: true, skipped: true };
  }

  console.log('\n  Validating guild spacing...');

  // Collect all guilds by type
  const guildsByType = {
    warrior: [],
    wizard: [],
    monk: [],
    chemist: []
  };

  for (const node of allNodes) {
    if (node.nodeType === 'guild' && node.guildType) {
      guildsByType[node.guildType].push(node);
    }
  }

  const violations = [];
  const warnings = [];

  // Check 1: Global count per type
  for (const [type, guilds] of Object.entries(guildsByType)) {
    if (guilds.length < GUILD_CONFIG.GLOBAL_MIN_PER_TYPE) {
      violations.push(`${type}: only ${guilds.length} guilds (min: ${GUILD_CONFIG.GLOBAL_MIN_PER_TYPE})`);
    }
    if (guilds.length > GUILD_CONFIG.GLOBAL_MAX_PER_TYPE) {
      warnings.push(`${type}: ${guilds.length} guilds exceeds recommended max of ${GUILD_CONFIG.GLOBAL_MAX_PER_TYPE}`);
    }
  }

  // Check 2: Same-type spacing
  const spacingViolations = [];
  for (const [type, guilds] of Object.entries(guildsByType)) {
    for (let i = 0; i < guilds.length; i++) {
      for (let j = i + 1; j < guilds.length; j++) {
        const dist = Math.hypot(guilds[i].x - guilds[j].x, guilds[i].y - guilds[j].y);
        if (dist < GUILD_CONFIG.MIN_SAME_TYPE_SPACING) {
          spacingViolations.push({
            type,
            distance: dist,
            minRequired: GUILD_CONFIG.MIN_SAME_TYPE_SPACING,
            guild1: guilds[i].regionName || 'unknown',
            guild2: guilds[j].regionName || 'unknown'
          });
        }
      }
    }
  }

  if (spacingViolations.length > 0) {
    warnings.push(`${spacingViolations.length} same-type guild pairs are closer than ${GUILD_CONFIG.MIN_SAME_TYPE_SPACING} units`);
  }

  const passed = violations.length === 0;

  if (passed && warnings.length === 0) {
    console.log('    Guild distribution: PASS');
    console.log(`    Distribution: ${Object.entries(guildsByType).map(([t, g]) => `${t}:${g.length}`).join(', ')}`);
  } else {
    if (violations.length > 0) {
      console.log('    Guild distribution: FAIL');
      for (const v of violations) {
        console.log(`      - ${v}`);
      }
    }
    if (warnings.length > 0) {
      console.log('    Guild spacing warnings:');
      for (const w of warnings) {
        console.log(`      - ${w}`);
      }
      for (const sv of spacingViolations.slice(0, 3)) {
        console.log(`        ${sv.type}: ${sv.guild1} <-> ${sv.guild2} = ${sv.distance.toFixed(1)} units`);
      }
    }
  }

  return {
    passed,
    guildsByType: Object.fromEntries(Object.entries(guildsByType).map(([t, g]) => [t, g.length])),
    violations,
    warnings,
    spacingViolations
  };
}

/**
 * Validate zodiac shrine placement.
 * Ensures exactly 12 zodiac shrines (one of each type) exist in the world.
 *
 * @param {Array<Object>} allNodes - All nodes in the world
 * @returns {Object} Validation results with pass status and details
 */
export function validateZodiacShrines(allNodes) {
  console.log('\n  Validating zodiac shrines...');

  const zodiacShrines = allNodes.filter(n =>
    n.nodeType === 'shrine' && n.shrineBuffType?.startsWith('zodiac_')
  );

  // Extract zodiac types from shrines
  const foundTypes = new Set();
  for (const shrine of zodiacShrines) {
    const zodiacType = shrine.shrineBuffType.replace('zodiac_', '');
    foundTypes.add(zodiacType);
  }

  // Check for missing types
  const missingTypes = ZODIAC_CONFIG.ZODIAC_TYPES.filter(t => !foundTypes.has(t));
  const duplicateTypes = zodiacShrines.length - foundTypes.size;

  const passed = zodiacShrines.length === ZODIAC_CONFIG.PER_WORLD &&
                 missingTypes.length === 0 &&
                 duplicateTypes === 0;

  if (passed) {
    console.log(`    All ${ZODIAC_CONFIG.PER_WORLD} zodiac shrines present`);
  } else {
    console.log(`    FAILED: Found ${zodiacShrines.length}/${ZODIAC_CONFIG.PER_WORLD} zodiac shrines`);
    if (missingTypes.length > 0) {
      console.log(`    Missing types: ${missingTypes.join(', ')}`);
    }
    if (duplicateTypes > 0) {
      console.log(`    Duplicate shrines detected: ${duplicateTypes}`);
    }
  }

  return {
    passed,
    total: zodiacShrines.length,
    expected: ZODIAC_CONFIG.PER_WORLD,
    foundTypes: Array.from(foundTypes),
    missingTypes,
    duplicateTypes
  };
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

  // Step 5: Validate zodiac shrine placement
  const zodiacResult = validateZodiacShrines(allNodes);

  // Step 6: Validate terrain clustering
  const clusteringResult = validateTerrainClustering(allNodes, allConnections);

  // Step 7: Validate guild distribution and spacing
  const guildResult = validateGuildSpacing(allNodes);

  // Summary
  console.log('\n  Phase 6 Complete:');
  console.log(`    Total nodes: ${allNodes.length}`);
  console.log(`    Terminators: ${terminatorStats.chest + terminatorStats.shrine + terminatorStats.discovery}`);
  console.log(`    Connectivity: ${connectivityResult.allReachable ? 'PASS' : 'FAIL'}`);
  console.log(`    Max spacing: ${spacingResult.passed ? 'PASS' : 'FAIL'} (${spacingResult.violations.length} violations)`);
  console.log(`    Zodiac shrines: ${zodiacResult.passed ? 'PASS' : 'FAIL'} (${zodiacResult.total}/${zodiacResult.expected})`);
  console.log(`    Terrain clustering: ${clusteringResult.passed ? 'PASS' : 'WARN'} (${clusteringResult.clusters.length} clusters)`);
  console.log(`    Guild distribution: ${guildResult.passed ? 'PASS' : 'FAIL'} (${guildResult.warnings?.length || 0} warnings)`);

  return {
    allNodes,
    allConnections,
    connectivityResult,
    terminatorStats,
    spacingResult,
    zodiacResult,
    clusteringResult,
    guildResult
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

  // Check 5: Zodiac shrine placement
  if (phase6Result.zodiacResult && !phase6Result.zodiacResult.passed) {
    issues.push(`Zodiac shrines incomplete: ${phase6Result.zodiacResult.total}/${phase6Result.zodiacResult.expected}`);
    if (phase6Result.zodiacResult.missingTypes.length > 0) {
      issues.push(`Missing zodiac types: ${phase6Result.zodiacResult.missingTypes.join(', ')}`);
    }
  }

  // Check 6: Terrain clustering (warning only, doesn't fail validation)
  if (phase6Result.clusteringResult && !phase6Result.clusteringResult.passed) {
    // Log as warning but don't add to issues (doesn't fail world gen)
    console.log(`  Note: ${phase6Result.clusteringResult.clusters.length} terrain clusters detected (advisory)`);
  }

  // Check 7: Guild distribution
  if (phase6Result.guildResult && !phase6Result.guildResult.passed) {
    issues.push(`Guild distribution incomplete: ${phase6Result.guildResult.violations?.join(', ')}`);
  }
  // Guild spacing warnings don't fail validation but are logged
  if (phase6Result.guildResult?.warnings?.length > 0) {
    console.log(`  Note: ${phase6Result.guildResult.warnings.length} guild spacing warnings (advisory)`);
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
