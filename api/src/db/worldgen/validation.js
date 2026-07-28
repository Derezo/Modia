/**
 * Finalized World Validation
 *
 * Pure validation for the canonical graph produced by worldAssembly.js, plus
 * retained compatibility helpers for callers of the former six-phase API.
 *
 * Functions:
 * - calculateDifficultyTier: Assign difficulty 1-5 based on ring distance and node type
 * - assignTerminatorNodesRegional: Legacy low-degree reward-site conversion helper
 * - verifyConnectivity: BFS flood fill to ensure all nodes are reachable
 * - validateAndCleanup: Read-only compatibility wrapper around final validation
 * - validatePhase6: Compatibility smoke test using the canonical assembler
 */

import {
  PHASE6_CONFIG,
  INTER_REGION_CONFIG,
  ZODIAC_CONFIG,
  TERRAIN_ANTI_CLUSTERING,
  NODE_DISTRIBUTION,
  GUILD_CONFIG,
  FINALIZED_WORLD_DOMAINS,
  OPENING_PROGRESSION_CONFIG,
  REGIONAL_ACTIVITY_PROFILES
} from './constants.js';
import { isBlockingNode } from '../../../../shared/constants.js';

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
  // Route construction owns explicit route risk. Finalization calls this only
  // when difficultyTier itself is absent, so this precedence preserves a
  // declared route tier before falling back to generic type/ring behavior.
  if (node.routeDifficultyTier != null) return node.routeDifficultyTier;

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
 * Legacy helper that assigns reward-site types to low-degree Ring 3 nodes.
 * Canonical generation uses worldAssembly.js, which explicitly controls the
 * configured mix of degree-2 route sites and degree-1 dead ends.
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

  // Retained legacy ordering; the canonical assembler owns reward-site tuning.
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
export function validateGuildSpacing(allNodes, regions = []) {
  if (!GUILD_CONFIG.VALIDATION_ENABLED) {
    return { passed: true, skipped: true };
  }

  console.log('\n  Validating guild spacing...');

  // Collect all guilds by type
  const guildsByType = Object.fromEntries(
    GUILD_CONFIG.TYPES.map((type) => [type, []])
  );
  const violations = [];
  const warnings = [];
  const guildsByRegion = new Map();

  for (const node of allNodes) {
    if (node.nodeType !== 'guild') continue;
    const guildType = node.guildType ?? node.guildClass;
    if (!GUILD_CONFIG.TYPES.includes(guildType)) {
      violations.push(
        `${node.nodeKey ?? node.name ?? '<unknown>'}: unsupported guild class ${guildType ?? '<missing>'}`
      );
      continue;
    }
    if (node.guildType != null
        && node.guildClass != null
        && node.guildType !== node.guildClass) {
      violations.push(
        `${node.nodeKey ?? node.name ?? '<unknown>'}: guildType ${node.guildType} disagrees with guildClass ${node.guildClass}`
      );
    }
    guildsByType[guildType].push(node);
    const regionalGuilds = guildsByRegion.get(node.regionId) ?? [];
    regionalGuilds.push(node);
    guildsByRegion.set(node.regionId, regionalGuilds);
  }

  // Check 1: Global count per type
  for (const [type, guilds] of Object.entries(guildsByType)) {
    if (guilds.length < GUILD_CONFIG.GLOBAL_MIN_PER_TYPE) {
      violations.push(`${type}: only ${guilds.length} guilds (min: ${GUILD_CONFIG.GLOBAL_MIN_PER_TYPE})`);
    }
    if (guilds.length > GUILD_CONFIG.GLOBAL_MAX_PER_TYPE) {
      violations.push(`${type}: ${guilds.length} guilds exceeds max of ${GUILD_CONFIG.GLOBAL_MAX_PER_TYPE}`);
    }
  }

  // Check 2: Exact configured per-region guild count.
  const configuredRegionIds = regions.length > 0
    ? regions.map((region) => region.id)
    : [...new Set(allNodes
      .filter((node) => node.regionId != null)
      .map((node) => node.regionId))];
  for (const regionId of configuredRegionIds) {
    const regionalGuilds = guildsByRegion.get(regionId) ?? [];
    const count = regionalGuilds.length;
    if (count !== GUILD_CONFIG.PER_REGION) {
      violations.push(
        `region ${regionId}: ${count} guilds (expected ${GUILD_CONFIG.PER_REGION})`
      );
    } else if (new Set(regionalGuilds.map((guild) =>
      guild.guildType ?? guild.guildClass
    )).size !== count) {
      violations.push(`region ${regionId}: guild classes must be distinct`);
    }
  }

  // Check 3: Same-type spacing remains advisory.
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
export function validateAndCleanup(finalizedWorld, ...legacyArguments) {
  if (legacyArguments.length > 0
      || !finalizedWorld
      || !Array.isArray(finalizedWorld.nodes)
      || !Array.isArray(finalizedWorld.connections)) {
    throw new TypeError(
      'validateAndCleanup now accepts one finalized canonical world; '
      + 'use assembleWorld() to perform deterministic finalization'
    );
  }
  const validation = validateFinalizedWorld(finalizedWorld);
  return {
    ...finalizedWorld,
    allNodes: finalizedWorld.nodes,
    allConnections: finalizedWorld.connections,
    validation
  };
}

/**
 * Validate the finalized canonical graph without modifying it.
 *
 * Hard invariant failures are returned as structured errors. Advisory quality
 * findings remain warnings so callers can report them without silently
 * accepting corrupt identity, geometry, or graph data.
 *
 * @param {object} world
 * @returns {{valid: boolean, errors: Array<object>, warnings: Array<object>,
 *   metrics: object}}
 */
export function validateFinalizedWorld(world) {
  const errors = [];
  const warnings = [];
  const nodes = Array.isArray(world?.nodes) ? world.nodes : [];
  const connections = Array.isArray(world?.connections) ? world.connections : [];
  const routeManifest = Array.isArray(world?.routeManifest) ? world.routeManifest : [];
  const castles = Array.isArray(world?.castles) ? world.castles : [];
  const regions = Array.isArray(world?.regions) ? world.regions : [];

  const addError = (code, message, details = {}) => {
    errors.push({ code, message, ...details });
  };
  const addWarning = (code, message, details = {}) => {
    warnings.push({ code, message, ...details });
  };

  const nodeIndexByKey = new Map();
  const coordinateOwners = new Map();
  const polygonByRegionId = new Map(
    regions.map((region) => [region.id, region.boundaryPolygon])
  );
  const pointIsInOrOnPolygon = (x, y, polygon) => {
    if (!Array.isArray(polygon) || polygon.length < 3) return false;
    let inside = false;
    for (let index = 0, previous = polygon.length - 1;
      index < polygon.length;
      previous = index++) {
      const [x1, y1] = polygon[previous];
      const [x2, y2] = polygon[index];
      const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
      if (Math.abs(cross) <= 1e-9
          && x >= Math.min(x1, x2) - 1e-9
          && x <= Math.max(x1, x2) + 1e-9
          && y >= Math.min(y1, y2) - 1e-9
          && y <= Math.max(y1, y2) + 1e-9) {
        return true;
      }
      if ((y2 > y) !== (y1 > y)
          && x < ((x1 - x2) * (y - y2)) / (y1 - y2) + x2) {
        inside = !inside;
      }
    }
    return inside;
  };
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (typeof node.nodeKey !== 'string' || node.nodeKey.length === 0) {
      addError('NODE_KEY_MISSING', `Node ${index} has no stable node key`, { index });
    } else if (nodeIndexByKey.has(node.nodeKey)) {
      addError('NODE_KEY_DUPLICATE', `Duplicate node key ${node.nodeKey}`, {
        nodeKey: node.nodeKey
      });
    } else {
      nodeIndexByKey.set(node.nodeKey, index);
    }
    if (!Number.isInteger(node.x) || !Number.isInteger(node.y)) {
      addError('NODE_COORDINATE_INVALID', `Node ${node.nodeKey ?? index} has non-integer coordinates`);
    }
    const coordinateKey = `${node.x},${node.y}`;
    if (coordinateOwners.has(coordinateKey)) {
      addError('NODE_COORDINATE_DUPLICATE', `Nodes share coordinate ${coordinateKey}`, {
        firstNodeKey: coordinateOwners.get(coordinateKey),
        secondNodeKey: node.nodeKey
      });
    } else {
      coordinateOwners.set(coordinateKey, node.nodeKey);
    }
    if (node.regionId != null) {
      const polygon = polygonByRegionId.get(node.regionId);
      if (!pointIsInOrOnPolygon(node.x, node.y, polygon)) {
        addError(
          'REGIONAL_NODE_OUTSIDE_CELL',
          `Regional node ${node.nodeKey ?? index} is outside its Voronoi cell`,
          { nodeKey: node.nodeKey, regionId: node.regionId }
        );
      }
    }
    const { MIN: minimumTier, MAX: maximumTier } =
      FINALIZED_WORLD_DOMAINS.DIFFICULTY_TIER;
    if (!Number.isInteger(node.difficultyTier)
        || node.difficultyTier < minimumTier
        || node.difficultyTier > maximumTier) {
      addError('DIFFICULTY_TIER_INVALID', `Node ${node.nodeKey ?? index} has invalid difficulty tier`, {
        difficultyTier: node.difficultyTier
      });
    }
    const allowedRingDistances = node.nodeType === 'palace'
      ? [FINALIZED_WORLD_DOMAINS.PALACE_RING_DISTANCE]
      : node.regionId == null
        ? [FINALIZED_WORLD_DOMAINS.INTER_REGION_RING_DISTANCE]
        : FINALIZED_WORLD_DOMAINS.REGIONAL_RING_DISTANCES;
    if (!allowedRingDistances.includes(node.ringDistance)) {
      addError('RING_DISTANCE_INVALID', `Node ${node.nodeKey ?? index} has invalid ring distance`, {
        ringDistance: node.ringDistance,
        allowedRingDistances
      });
    }
    if (node.nodeType === 'castle' && node.ringDistance !== 0) {
      addError('CASTLE_RING_DISTANCE_INVALID', `Castle ${node.nodeKey ?? index} must have ring distance 0`, {
        ringDistance: node.ringDistance
      });
    }
    if (node.routeDifficultyTier != null
        && (!Number.isInteger(node.routeDifficultyTier)
          || node.routeDifficultyTier < minimumTier
          || node.routeDifficultyTier > maximumTier
          || node.difficultyTier !== node.routeDifficultyTier)) {
      addError(
        'ROUTE_DIFFICULTY_PRECEDENCE_INVALID',
        `Node ${node.nodeKey ?? index} does not preserve its declared route tier`,
        {
          difficultyTier: node.difficultyTier,
          routeDifficultyTier: node.routeDifficultyTier
        }
      );
    }
    if (!node.routeId) {
      const carriesRouteMetadata = node.routePairKey != null
        || node.routeKind != null
        || node.routeOrder != null
        || node.segmentIndex != null
        || node.segmentKind != null
        || node.difficultyPolicy != null
        || node.routeDifficultyTier != null
        || (Array.isArray(node.regionPair) && node.regionPair.length > 0);
      if (carriesRouteMetadata) {
        addError(
          'ORDINARY_NODE_ROUTE_METADATA_INVALID',
          `Ordinary node ${node.nodeKey ?? index} carries partial route identity`,
          {
            routePairKey: node.routePairKey ?? null,
            routeKind: node.routeKind ?? null,
            routeOrder: node.routeOrder ?? null,
            segmentIndex: node.segmentIndex ?? null,
            segmentKind: node.segmentKind ?? null,
            difficultyPolicy: node.difficultyPolicy ?? null,
            routeDifficultyTier: node.routeDifficultyTier ?? null,
            regionPair: node.regionPair ?? null
          }
        );
      }
    } else if (!node.routeKind
        || !Array.isArray(node.regionPair)
        || node.regionPair.length < 2
        || !Number.isInteger(node.segmentIndex)
        || node.segmentIndex < 0
        || typeof node.segmentKind !== 'string'
        || node.segmentKind.length === 0
        || typeof node.difficultyPolicy !== 'string'
        || node.difficultyPolicy.length === 0
        || (node.routeKind !== 'palace' && !node.routePairKey)) {
      addError(
        'ROUTE_NODE_METADATA_INVALID',
        `Routed node ${node.nodeKey ?? index} has incomplete route identity`
      );
    }
    if (node.nodeType === 'ruins'
        && (!Number.isInteger(node.ruinsTier) || node.ruinsTier < 1 || node.ruinsTier > 3)) {
      addError('RUINS_TIER_INVALID', `Ruins ${node.nodeKey ?? index} has invalid reward tier`, {
        ruinsTier: node.ruinsTier
      });
    }
  }

  const castleByKey = new Map();
  for (const castle of castles) {
    if (!castle?.castleKey || castleByKey.has(castle.castleKey)) {
      addError(
        'CASTLE_IDENTITY_INVALID',
        `Castle placement has a missing or duplicate key ${castle?.castleKey ?? '<missing>'}`
      );
      continue;
    }
    castleByKey.set(castle.castleKey, castle);
  }
  const regionCastleKeys = new Set();
  for (const region of regions) {
    const generator = region?.generatorPoint;
    if (!region?.castleKey || regionCastleKeys.has(region.castleKey)
        || !Number.isFinite(generator?.x) || !Number.isFinite(generator?.y)) {
      addError(
        'VORONOI_GENERATOR_IDENTITY_INVALID',
        `Region ${region?.id ?? '<missing>'} has invalid generator identity`
      );
      continue;
    }
    regionCastleKeys.add(region.castleKey);
    const castle = castleByKey.get(region.castleKey);
    const castleNode = Number.isInteger(region.castleNodeIndex)
      ? nodes[region.castleNodeIndex]
      : null;
    if (!castle || castle.regionId !== region.id
        || castle.x !== generator.x || castle.y !== generator.y
        || castleNode?.nodeType !== 'castle'
        || castleNode?.regionId !== region.id
        || castleNode?.x !== generator.x
        || castleNode?.y !== generator.y) {
      addError(
        'CASTLE_GENERATOR_COORDINATE_MISMATCH',
        `Castle ${region.castleKey} does not exactly match its frozen Voronoi generator`,
        {
          regionId: region.id,
          generator,
          placement: castle ? { x: castle.x, y: castle.y } : null,
          finalized: castleNode ? { x: castleNode.x, y: castleNode.y } : null
        }
      );
    }
  }

  const adjacency = Array.from({ length: nodes.length }, () => []);
  const edgeIdentities = new Set();
  const edgeKeys = new Set();
  for (let index = 0; index < connections.length; index++) {
    const connection = connections[index];
    if (typeof connection.edgeKey !== 'string' || connection.edgeKey.length === 0) {
      addError('EDGE_KEY_MISSING', `Connection ${index} has no stable edge key`);
    } else if (edgeKeys.has(connection.edgeKey)) {
      addError('EDGE_KEY_DUPLICATE', `Duplicate edge key ${connection.edgeKey}`);
    } else {
      edgeKeys.add(connection.edgeKey);
    }
    const from = nodeIndexByKey.get(connection.fromNodeKey);
    const to = nodeIndexByKey.get(connection.toNodeKey);
    if (from === undefined || to === undefined) {
      addError('EDGE_ENDPOINT_UNRESOLVED', `Connection ${connection.edgeKey ?? index} has an unknown endpoint`, {
        fromNodeKey: connection.fromNodeKey,
        toNodeKey: connection.toNodeKey
      });
      continue;
    }
    if (from === to) {
      addError('EDGE_SELF_REFERENCE', `Connection ${connection.edgeKey ?? index} is a self edge`);
      continue;
    }
    if (connection.from !== from || connection.to !== to) {
      addError('EDGE_INDEX_MISMATCH', `Connection ${connection.edgeKey ?? index} indices do not match its keys`);
    }
    const identity = [connection.fromNodeKey, connection.toNodeKey].sort().join('\u0000');
    if (edgeIdentities.has(identity)) {
      addError('EDGE_DUPLICATE', `Duplicate connection ${identity}`);
      continue;
    }
    edgeIdentities.add(identity);
    adjacency[from].push(to);
    adjacency[to].push(from);

    const distance = Math.hypot(nodes[to].x - nodes[from].x, nodes[to].y - nodes[from].y);
    if (distance > INTER_REGION_CONFIG.MAX_NODE_SPACING) {
      addError('EDGE_SPACING_EXCEEDED', `Connection ${connection.edgeKey ?? index} exceeds maximum spacing`, {
        distance,
        maxSpacing: INTER_REGION_CONFIG.MAX_NODE_SPACING
      });
    }
  }

  const routedConnections = connections.filter((connection) => Boolean(connection.routeId));
  for (const connection of connections.filter((candidate) => !candidate.routeId)) {
    if (connection.routePairKey != null
        || connection.routeKind != null
        || connection.segmentIndex != null
        || connection.segmentOrder != null
        || connection.segmentKind != null
        || connection.difficultyPolicy != null
        || connection.routeDifficultyTier != null
        || (Array.isArray(connection.regionPair) && connection.regionPair.length > 0)) {
      addError(
        'ORDINARY_EDGE_ROUTE_METADATA_INVALID',
        `Ordinary connection ${connection.edgeKey} carries partial route identity`,
        {
          routePairKey: connection.routePairKey ?? null,
          routeKind: connection.routeKind ?? null,
          segmentIndex: connection.segmentIndex ?? null,
          segmentOrder: connection.segmentOrder ?? null,
          segmentKind: connection.segmentKind ?? null,
          difficultyPolicy: connection.difficultyPolicy ?? null,
          routeDifficultyTier: connection.routeDifficultyTier ?? null,
          regionPair: connection.regionPair ?? null
        }
      );
    }
  }

  const routedConnectionsById = new Map();
  const routeOrders = new Map();
  for (const connection of routedConnections) {
    if (!connection.routeKind || !Array.isArray(connection.regionPair)
        || !Number.isInteger(connection.segmentOrder) || connection.segmentOrder < 0
        || connection.segmentIndex !== connection.segmentOrder
        || typeof connection.segmentKind !== 'string'
        || typeof connection.difficultyPolicy !== 'string') {
      addError(
        'ROUTE_SEGMENT_METADATA_INVALID',
        `Connection ${connection.edgeKey} has incomplete route-segment metadata`
      );
    }
    if (connection.routeKind !== 'palace' && !connection.routePairKey) {
      addError(
        'ROUTE_PAIR_KEY_MISSING',
        `Connection ${connection.edgeKey} has no competing-pair identity`
      );
    }
    const routeConnections = routedConnectionsById.get(connection.routeId) ?? [];
    routeConnections.push(connection);
    routedConnectionsById.set(connection.routeId, routeConnections);
    const orders = routeOrders.get(connection.routeId) ?? [];
    orders.push(connection.segmentOrder);
    routeOrders.set(connection.routeId, orders);
  }
  for (const [routeId, orders] of routeOrders) {
    const sorted = [...orders].sort((left, right) => left - right);
    if (sorted.some((order, index) => order !== index)) {
      addError(
        'ROUTE_SEGMENT_ORDER_INVALID',
        `Route ${routeId} segment order must be unique and contiguous`,
        { segmentOrders: sorted }
      );
    }
  }

  const manifestByRouteId = new Map();
  for (const entry of routeManifest) {
    if (!entry?.routeId || manifestByRouteId.has(entry.routeId)) {
      addError(
        'ROUTE_MANIFEST_ROUTE_DUPLICATE',
        `Route manifest has a missing or duplicate route ID ${entry?.routeId ?? '<missing>'}`
      );
      continue;
    }
    manifestByRouteId.set(entry.routeId, entry);
  }
  if (routeManifest.length !== routedConnectionsById.size) {
    addError(
      'ROUTE_MANIFEST_CARDINALITY_MISMATCH',
      'Route manifest must contain exactly one entry for every canonical route',
      {
        manifestEntries: routeManifest.length,
        routedConnectionGroups: routedConnectionsById.size
      }
    );
  }

  const regionById = new Map(regions.map((region) => [region.id, region]));
  for (const [routeId, routeConnections] of routedConnectionsById) {
    const entry = manifestByRouteId.get(routeId);
    const first = routeConnections[0];
    if (!entry
        || entry.routePairKey !== (first.routePairKey ?? null)
        || entry.routeKind !== first.routeKind
        || entry.difficultyPolicy !== first.difficultyPolicy
        || JSON.stringify(entry.regionPair) !== JSON.stringify(first.regionPair)) {
      addError(
        'ROUTE_MANIFEST_ROUTE_MISMATCH',
        `Route manifest does not reproduce route-level metadata for ${routeId}`
      );
      continue;
    }

    const incidentCount = new Map();
    for (const connection of routeConnections) {
      for (const nodeKey of [connection.fromNodeKey, connection.toNodeKey]) {
        incidentCount.set(nodeKey, (incidentCount.get(nodeKey) ?? 0) + 1);
      }
    }
    const expectedEndpoints = [...incidentCount.keys()]
      .filter((nodeKey) => {
        const node = nodes[nodeIndexByKey.get(nodeKey)];
        return node?.routeId !== routeId
          || node?.nodeType === 'palace'
          || incidentCount.get(nodeKey) === 1;
      })
      .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
      .map((nodeKey) => {
        const node = nodes[nodeIndexByKey.get(nodeKey)];
        return {
          nodeKey,
          nodeType: node?.nodeType,
          regionId: node?.regionId ?? null,
          regionName: node?.regionName ?? null
        };
      });
    if (JSON.stringify(entry.endpointIdentities) !== JSON.stringify(expectedEndpoints)) {
      addError(
        'ROUTE_MANIFEST_ENDPOINT_MISMATCH',
        `Route manifest endpoint identities do not match ${routeId}`
      );
    }

    const expectedRegions = first.regionPair.map((regionId) => {
      const region = regionById.get(regionId);
      return {
        regionId,
        regionName: region?.name,
        castleKey: region?.castleKey
      };
    });
    if (expectedRegions.some((region) => !region.regionName || !region.castleKey)
        || JSON.stringify(entry.declaredRegions) !== JSON.stringify(expectedRegions)) {
      addError(
        'ROUTE_MANIFEST_REGION_MISMATCH',
        `Route manifest declared regions do not match ${routeId}`
      );
    }

    const expectedSegments = [...routeConnections]
      .sort((left, right) =>
        left.segmentIndex - right.segmentIndex
        || left.edgeKey.localeCompare(right.edgeKey)
      )
      .map((connection) => ({
        edgeKey: connection.edgeKey,
        segmentIndex: connection.segmentIndex,
        segmentKind: connection.segmentKind,
        fromNodeKey: connection.fromNodeKey,
        toNodeKey: connection.toNodeKey,
        pathType: connection.pathType,
        difficultyPolicy: connection.difficultyPolicy,
        routeDifficultyTier: connection.routeDifficultyTier ?? null
      }));
    if (JSON.stringify(entry.segments) !== JSON.stringify(expectedSegments)) {
      addError(
        'ROUTE_MANIFEST_SEGMENT_MISMATCH',
        `Route manifest ordered segments do not match ${routeId}`
      );
    }

    const blockingTiers = nodes
      .filter((node) => node.routeId === routeId && isBlockingNode(node))
      .map((node) => node.difficultyTier)
      .sort((left, right) => left - right);
    const expectedTierPolicy = {
      supportedTierDomain: [1, 5],
      blockingTiers,
      blockingTierFloor: blockingTiers.length > 0 ? Math.min(...blockingTiers) : null,
      blockingTierCeiling: blockingTiers.length > 0 ? Math.max(...blockingTiers) : null
    };
    if (!entry.tierPolicy
        || JSON.stringify(entry.tierPolicy.supportedTierDomain)
          !== JSON.stringify(expectedTierPolicy.supportedTierDomain)
        || JSON.stringify(entry.tierPolicy.blockingTiers)
          !== JSON.stringify(expectedTierPolicy.blockingTiers)
        || entry.tierPolicy.blockingTierFloor !== expectedTierPolicy.blockingTierFloor
        || entry.tierPolicy.blockingTierCeiling !== expectedTierPolicy.blockingTierCeiling) {
      addError(
        'ROUTE_MANIFEST_TIER_POLICY_MISMATCH',
        `Route manifest tier policy does not match ${routeId}`
      );
    }
  }

  const competingManifestRoutes = new Map();
  for (const entry of routeManifest) {
    if (!entry.routePairKey || !['trade', 'wilderness'].includes(entry.routeKind)) continue;
    const pair = competingManifestRoutes.get(entry.routePairKey) ?? {};
    pair[entry.routeKind] = entry;
    competingManifestRoutes.set(entry.routePairKey, pair);
  }
  for (const [routePairKey, pair] of competingManifestRoutes) {
    if (!pair.trade || !pair.wilderness) continue;
    const tradeCeiling = pair.trade.tierPolicy?.blockingTierCeiling;
    const wildernessFloor = pair.wilderness.tierPolicy?.blockingTierFloor;
    const expectedComparison = {
      routePairKey,
      lowerRiskRouteId: pair.trade.routeId,
      higherRiskRouteId: pair.wilderness.routeId,
      requiredTierGap: 1,
      observedTierGap: Number.isInteger(tradeCeiling)
        && Number.isInteger(wildernessFloor)
        ? wildernessFloor - tradeCeiling
        : null
    };
    for (const entry of [pair.trade, pair.wilderness]) {
      if (JSON.stringify(entry.tierPolicy?.comparison)
          !== JSON.stringify(expectedComparison)) {
        addError(
          'ROUTE_MANIFEST_COMPARISON_MISMATCH',
          `Route manifest risk comparison does not match ${routePairKey}`
        );
      }
    }
  }

  // Route declarations must agree with endpoint identities encoded before
  // persistence. Routed components can intersect at shared nodes, so validate
  // each edge against its endpoint keys and aggregate its physical regional
  // attachments by the independently derived pair.
  const nonPalaceRouted = routedConnections.filter((connection) =>
    connection.routeKind !== 'palace'
    && Array.isArray(connection.regionPair)
    && connection.regionPair.length === 2
  );
  const attachedRegionsByRoute = new Map();
  const pairFromNodeKey = (nodeKey) => {
    const matches = [...nodeKey.matchAll(
      /route:(?:trade|wilderness|bridge|infill):(\d+)-(\d+):node/g
    )];
    const pairs = [...new Set(matches.map((match) => {
      const pair = [Number(match[1]), Number(match[2])].sort((a, b) => a - b);
      return pair.join('-');
    }))];
    return pairs.length === 1 ? pairs[0] : null;
  };
  for (const connection of nonPalaceRouted) {
    const endpointNodes = [nodes[connection.from], nodes[connection.to]];
    let endpointPairs = [...new Set(endpointNodes
      .map((node) => node && pairFromNodeKey(node.nodeKey))
      .filter(Boolean))];
    const physicalEndpointRegions = [...new Set(endpointNodes
      .map((node) => node?.regionId)
      .filter(Number.isInteger))]
      .sort((left, right) => left - right);
    if (endpointPairs.length === 0 && physicalEndpointRegions.length === 2) {
      endpointPairs = [physicalEndpointRegions.join('-')];
    }
    if (endpointPairs.length !== 1) {
      addError(
        'ROUTE_ENDPOINT_IDENTITY_UNRESOLVED',
        `Connection ${connection.edgeKey} does not have one unambiguous endpoint-key identity`,
        {
          endpointPairs,
          endpointNodes: endpointNodes.map((node) => ({
            nodeKey: node?.nodeKey,
            regionId: node?.regionId,
            routePairKey: node?.routePairKey
          }))
        }
      );
      continue;
    }
    const expectedRegionPair = endpointPairs[0].split('-').map(Number);
    const expectedPairKey = `route-pair:${endpointPairs[0]}`;
    if (JSON.stringify(connection.regionPair) !== JSON.stringify(expectedRegionPair)
        || connection.routePairKey !== expectedPairKey) {
      addError(
        'ROUTE_ENDPOINT_IDENTITY_MISMATCH',
        `Connection ${connection.edgeKey} route identity does not match its endpoint keys`,
        { expectedRegionPair, expectedRoutePairKey: expectedPairKey }
      );
    }
    const routeAttachment = attachedRegionsByRoute.get(connection.routeId) ?? {
      routeKind: connection.routeKind,
      expectedPairKey,
      regions: new Set()
    };
    for (const node of endpointNodes) {
      if (Number.isInteger(node?.regionId)) {
        routeAttachment.regions.add(node.regionId);
        if (!expectedRegionPair.includes(node.regionId)) {
          addError(
            'ROUTE_ENDPOINT_REGION_MISMATCH',
            `Connection ${connection.edgeKey} attaches to region ${node.regionId} outside its route pair`,
            { expectedRegionPair }
          );
        }
      }
    }
    if (['trade', 'wilderness'].includes(connection.routeKind)) {
      attachedRegionsByRoute.set(connection.routeId, routeAttachment);
    }
  }
  for (const [routeId, routeAttachment] of attachedRegionsByRoute) {
    const expectedRegions = routeAttachment.expectedPairKey
      .slice('route-pair:'.length)
      .split('-')
      .map(Number);
    const actualRegions = [...routeAttachment.regions].sort((a, b) => a - b);
    if (JSON.stringify(actualRegions) !== JSON.stringify(expectedRegions)) {
      addError(
        'ROUTE_ENDPOINT_REGIONS_INVALID',
        `${routeId} must physically attach to both declared regions`,
        {
          routeId,
          routeKind: routeAttachment.routeKind,
          expectedRegions,
          actualRegions
        }
      );
    }
  }

  const castleIndices = nodes
    .map((node, index) => node.nodeType === 'castle' ? index : -1)
    .filter((index) => index >= 0);
  if (castleIndices.length !== 5 || castles.length !== 5 || regions.length !== 5) {
    addError('WORLD_CARDINALITY_INVALID', 'A finalized world must contain five castles and five regions', {
      castleNodes: castleIndices.length,
      castles: castles.length,
      regions: regions.length
    });
  }

  const regionIds = new Set(regions.map((region) => region.id));
  if (regionIds.size !== regions.length) {
    addError('REGION_ID_DUPLICATE', 'Region IDs must be unique');
  }
  for (const castle of castles) {
    const castleNode = nodes.find((node) =>
      node.nodeType === 'castle' && node.regionId === castle.regionId
    );
    if (!castleNode) {
      addError('CASTLE_NODE_MISSING', `Region ${castle.regionId} has no castle node`);
    } else if (castleNode.x !== castle.x || castleNode.y !== castle.y) {
      addError('CASTLE_COORDINATE_MISMATCH', `Region ${castle.regionId} castle coordinates changed after partitioning`);
    }
  }

  const visited = new Set();
  const queue = castleIndices.length > 0 ? [castleIndices[0]] : [];
  let head = 0;
  if (queue.length > 0) visited.add(queue[0]);
  while (head < queue.length) {
    const current = queue[head++];
    for (const neighbor of adjacency[current]) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  if (visited.size !== nodes.length) {
    addError('GRAPH_DISCONNECTED', 'Every node must be reachable from a castle', {
      reachable: visited.size,
      total: nodes.length,
      orphanedNodeKeys: nodes
        .filter((_, index) => !visited.has(index))
        .map((node) => node.nodeKey)
    });
  }

  const zodiacResult = validateZodiacShrines(nodes);
  if (!zodiacResult.passed) {
    addError('ZODIAC_SHRINES_INVALID', 'The finalized world must contain one shrine of every zodiac type', {
      missingTypes: zodiacResult.missingTypes,
      duplicateTypes: zodiacResult.duplicateTypes
    });
  }
  const guildResult = validateGuildSpacing(nodes, regions);
  if (!guildResult.passed) {
    addError('GUILD_DISTRIBUTION_INVALID', 'The finalized guild distribution is incomplete', {
      violations: guildResult.violations
    });
  }
  for (const warning of guildResult.warnings ?? []) {
    addWarning('GUILD_SPACING_ADVISORY', warning);
  }

  const openingMetrics = [];
  const approvedOpeningTypes = new Set(
    OPENING_PROGRESSION_CONFIG.APPROVED_SAFE_TYPES
  );
  for (const castleIndex of castleIndices) {
    const castle = nodes[castleIndex];
    const designatedEdges = connections.filter((connection) =>
      connection.openingRole === 'designated_safe_edge'
      && (connection.from === castleIndex || connection.to === castleIndex)
    );
    if (designatedEdges.length !== 1) {
      addError(
        'CASTLE_OPENING_EDGE_INVALID',
        `Castle ${castle.nodeKey} must have exactly one designated safe edge`,
        { designatedEdgeCount: designatedEdges.length }
      );
    } else {
      const destinationIndex = designatedEdges[0].from === castleIndex
        ? designatedEdges[0].to
        : designatedEdges[0].from;
      const destination = nodes[destinationIndex];
      if (destination?.openingRole !== 'designated_safe_destination'
          || !approvedOpeningTypes.has(destination.nodeType)
          || destination.regionId !== castle.regionId
          || destination.nodeKey !== castle.openingDestinationNodeKey) {
        addError(
          'CASTLE_OPENING_DESTINATION_INVALID',
          `Castle ${castle.nodeKey} opening edge does not identify its approved regional destination`
        );
      }
    }

    const safeComponent = new Set([castleIndex]);
    const safeQueue = [castleIndex];
    let safeHead = 0;
    while (safeHead < safeQueue.length) {
      const current = safeQueue[safeHead++];
      for (const neighbor of adjacency[current]) {
        if (isBlockingNode(nodes[neighbor]) || safeComponent.has(neighbor)) continue;
        safeComponent.add(neighbor);
        safeQueue.push(neighbor);
      }
    }
    const unapproved = [...safeComponent]
      .filter((index) => !approvedOpeningTypes.has(nodes[index].nodeType));
    if (unapproved.length > 0) {
      addError(
        'CASTLE_OPENING_UNAPPROVED_NODE',
        `Castle ${castle.nodeKey} safe component exposes unapproved content`,
        { nodeKeys: unapproved.map((index) => nodes[index].nodeKey) }
      );
    }
    if (safeComponent.size > OPENING_PROGRESSION_CONFIG.MAX_SAFE_COMPONENT_SIZE) {
      addError(
        'CASTLE_OPENING_COMPONENT_TOO_LARGE',
        `Castle ${castle.nodeKey} safe component exceeds its configured bound`,
        { size: safeComponent.size }
      );
    }
    const boundary = new Set();
    for (const safeIndex of safeComponent) {
      for (const neighbor of adjacency[safeIndex]) {
        if (!safeComponent.has(neighbor)) boundary.add(neighbor);
      }
    }
    if (boundary.size === 0) {
      addError(
        'CASTLE_OPENING_BOUNDARY_EMPTY',
        `Castle ${castle.nodeKey} has no opening combat boundary`
      );
    }
    const invalidBoundary = [...boundary].filter((index) =>
      !isBlockingNode(nodes[index])
      || nodes[index].difficultyTier !== OPENING_PROGRESSION_CONFIG.REQUIRED_BOUNDARY_TIER
    );
    if (invalidBoundary.length > 0) {
      addError(
        'CASTLE_OPENING_BOUNDARY_INVALID',
        `Castle ${castle.nodeKey} opening boundary must contain only Tier-1 blockers`,
        { nodeKeys: invalidBoundary.map((index) => nodes[index].nodeKey) }
      );
    }
    openingMetrics.push({
      castleNodeKey: castle.nodeKey,
      safeComponentSize: safeComponent.size,
      boundarySize: boundary.size
    });
  }

  const routePairs = new Map();
  for (const node of nodes) {
    if (!node.routePairKey || !['trade', 'wilderness'].includes(node.routeKind)) continue;
    const pair = routePairs.get(node.routePairKey) ?? { trade: [], wilderness: [] };
    if (isBlockingNode(node)) pair[node.routeKind].push(node);
    routePairs.set(node.routePairKey, pair);
  }
  for (const [routePairKey, pair] of routePairs) {
    if (pair.trade.length === 0 || pair.wilderness.length === 0) continue;
    const wildernessFloor = Math.min(
      ...pair.wilderness.map((node) => node.difficultyTier)
    );
    if (wildernessFloor <= 1) {
      addError(
        'ROUTE_TIER_POLICY_UNSATISFIABLE',
        `${routePairKey} has no supported lower tier for its competing trade route`,
        { wildernessFloor }
      );
      continue;
    }
    const invalidTrade = pair.trade.filter((node) =>
      !Number.isInteger(node.difficultyTier)
      || node.difficultyTier < 1
      || node.difficultyTier > 5
      || node.difficultyTier > wildernessFloor - 1
    );
    if (invalidTrade.length > 0) {
      addError(
        'TRADE_ROUTE_DIFFICULTY_INVALID',
        `${routePairKey} contains trade encounters that are not lower risk`,
        {
          wildernessFloor,
          nodeKeys: invalidTrade.map((node) => node.nodeKey)
        }
      );
    }
  }

  const terminators = nodes.filter((node) => node.isTerminator);
  const terminatorDegrees = terminators.map((node) => ({
    nodeKey: node.nodeKey,
    degree: adjacency[nodeIndexByKey.get(node.nodeKey)]?.length ?? 0
  }));
  const deadEndTerminatorCount = terminatorDegrees
    .filter(({ degree }) => degree === 1).length;
  if (world.rewardSiteStats?.assigned < world.rewardSiteStats?.target) {
    addWarning(
      'REWARD_SITE_CANDIDATES_INSUFFICIENT',
      'The world remained valid but could not safely reach the reward-site target',
      world.rewardSiteStats
    );
  }

  const activityMetrics = regions.map((region) => {
    const profile = REGIONAL_ACTIVITY_PROFILES[region.race] ?? {};
    const regionalNodes = nodes.filter((node) => node.regionId === region.id);
    const activityNodes = nodes.filter((node) =>
      node.regionId === region.id
      && NODE_DISTRIBUTION.ACTIVITY_TYPES.includes(node.nodeType)
    );
    return {
      regionId: region.id,
      race: region.race,
      total: activityNodes.length,
      regionalNodeCount: regionalNodes.length,
      density: regionalNodes.length === 0 ? 0 : activityNodes.length / regionalNodes.length,
      configuredDensityRange: NODE_DISTRIBUTION.ACTIVITY_PERCENT,
      configuredShares: profile,
      counts: Object.fromEntries(
        NODE_DISTRIBUTION.ACTIVITY_TYPES.map((type) => [
          type,
          activityNodes.filter((node) => node.nodeType === type).length
        ])
      )
    };
  });

  const clusteringResult = validateTerrainClustering(nodes, connections);
  if (!clusteringResult.passed) {
    addWarning('TERRAIN_CLUSTERING_ADVISORY', 'Battle terrain clustering exceeds the preferred limit', {
      clusterCount: clusteringResult.clusters.length
    });
  }

  const degrees = adjacency.map((neighbors) => neighbors.length);
  const degreeDistribution = Object.fromEntries(
    [...new Set(degrees)].sort((left, right) => left - right).map((degree) => [
      degree,
      degrees.filter((value) => value === degree).length
    ])
  );
  const isZodiacShrine = (node) =>
    node.nodeType === 'shrine'
    && typeof node.shrineBuffType === 'string'
    && node.shrineBuffType.startsWith('zodiac_');
  const isProgressionAnchor = (node) =>
    ['castle', 'palace'].includes(node.nodeType) || isZodiacShrine(node);
  const progressionAnchors = new Set(nodes
    .map((node, index) => isProgressionAnchor(node) ? index : -1)
    .filter((index) => index >= 0));

  const discovery = Array(nodes.length).fill(-1);
  const low = Array(nodes.length).fill(-1);
  const parent = Array(nodes.length).fill(-1);
  const subtreeAnchors = Array(nodes.length).fill(0);
  const articulationAnchorSeparators = new Set();
  const anchorSeparatingBridges = [];
  let discoveryTime = 0;
  const visitCritical = (current) => {
    discovery[current] = low[current] = discoveryTime++;
    subtreeAnchors[current] = progressionAnchors.has(current) ? 1 : 0;
    let childCount = 0;
    for (const neighbor of adjacency[current]) {
      if (discovery[neighbor] < 0) {
        parent[neighbor] = current;
        childCount++;
        visitCritical(neighbor);
        subtreeAnchors[current] += subtreeAnchors[neighbor];
        low[current] = Math.min(low[current], low[neighbor]);
        const childSeparatesAnchor = subtreeAnchors[neighbor] > 0
          && progressionAnchors.size - subtreeAnchors[neighbor]
            - (progressionAnchors.has(current) ? 1 : 0) > 0;
        if (low[neighbor] >= discovery[current] && childSeparatesAnchor) {
          articulationAnchorSeparators.add(current);
        }
        if (low[neighbor] > discovery[current] && childSeparatesAnchor) {
          anchorSeparatingBridges.push([
            nodes[current].nodeKey,
            nodes[neighbor].nodeKey
          ].sort());
        }
      } else if (neighbor !== parent[current]) {
        low[current] = Math.min(low[current], discovery[neighbor]);
      }
    }
    if (parent[current] === -1 && childCount < 2) {
      articulationAnchorSeparators.delete(current);
    }
  };
  for (let index = 0; index < nodes.length; index++) {
    if (discovery[index] < 0) visitCritical(index);
  }

  const visitedCorridorEdges = new Set();
  let longestSingleChoiceCorridor = 0;
  let longestSingleChoiceCorridorPath = [];
  const edgeIdentityFor = (left, right) => [left, right].sort((a, b) => a - b).join(':');
  for (let start = 0; start < nodes.length; start++) {
    if (degrees[start] === 2) continue;
    for (const first of adjacency[start]) {
      const firstEdge = edgeIdentityFor(start, first);
      if (visitedCorridorEdges.has(firstEdge)) continue;
      visitedCorridorEdges.add(firstEdge);
      let previous = start;
      let current = first;
      let length = 1;
      const path = [nodes[start].nodeKey, nodes[first].nodeKey];
      while (degrees[current] === 2) {
        const next = adjacency[current].find((neighbor) => neighbor !== previous);
        const edgeIdentity = edgeIdentityFor(current, next);
        if (visitedCorridorEdges.has(edgeIdentity)) break;
        visitedCorridorEdges.add(edgeIdentity);
        previous = current;
        current = next;
        path.push(nodes[current].nodeKey);
        length++;
      }
      if (length > longestSingleChoiceCorridor) {
        longestSingleChoiceCorridor = length;
        longestSingleChoiceCorridorPath = path;
      }
    }
  }

  const routeAlternatives = [];
  const pairKeys = new Set(routedConnections
    .map((connection) => connection.routePairKey)
    .filter(Boolean));
  for (const routePairKey of [...pairKeys].sort()) {
    const tradeEdges = routedConnections.filter((connection) =>
      connection.routePairKey === routePairKey && connection.routeKind === 'trade'
    );
    const wildernessEdges = routedConnections.filter((connection) =>
      connection.routePairKey === routePairKey && connection.routeKind === 'wilderness'
    );
    if (tradeEdges.length === 0 || wildernessEdges.length === 0) continue;
    const segmentSet = (edges) => new Set(edges.map((edge) =>
      [edge.fromNodeKey, edge.toNodeKey].sort().join('\u0000')
    ));
    const tradeSegments = segmentSet(tradeEdges);
    const wildernessSegments = segmentSet(wildernessEdges);
    const sharedSegments = [...tradeSegments]
      .filter((segmentKey) => wildernessSegments.has(segmentKey));
    const segmentUnionSize = new Set([...tradeSegments, ...wildernessSegments]).size;
    const tradeTiers = nodes.filter((node) =>
      node.routePairKey === routePairKey && node.routeKind === 'trade'
        && isBlockingNode(node)
    ).map((node) => node.difficultyTier);
    const wildernessTiers = nodes.filter((node) =>
      node.routePairKey === routePairKey && node.routeKind === 'wilderness'
        && isBlockingNode(node)
    ).map((node) => node.difficultyTier);
    const tradeRewardCount = nodes.filter((node) =>
      node.routePairKey === routePairKey && node.routeKind === 'trade' && node.isTerminator
    ).length;
    const wildernessRewardCount = nodes.filter((node) =>
      node.routePairKey === routePairKey && node.routeKind === 'wilderness' && node.isTerminator
    ).length;
    const tradeMaximumTier = tradeTiers.length === 0 ? null : Math.max(...tradeTiers);
    const wildernessMinimumTier = wildernessTiers.length === 0
      ? null
      : Math.min(...wildernessTiers);
    const riskTierDelta = tradeMaximumTier == null || wildernessMinimumTier == null
      ? null
      : wildernessMinimumTier - tradeMaximumTier;
    routeAlternatives.push({
      routePairKey,
      tradeSegmentCount: tradeEdges.length,
      wildernessSegmentCount: wildernessEdges.length,
      sharedSegmentCount: sharedSegments.length,
      sharedSegmentRatio: segmentUnionSize === 0
        ? 0
        : sharedSegments.length / segmentUnionSize,
      tradeMaximumTier,
      wildernessMinimumTier,
      riskTierDelta,
      tradeRewardCount,
      wildernessRewardCount,
      lowerRiskDominance: tradeEdges.length <= wildernessEdges.length
        && riskTierDelta > 0
        && tradeRewardCount >= wildernessRewardCount
    });
  }

  const deadEnds = degrees.filter((degree) => degree === 1).length;
  const unrewardedDeadEnds = nodes.filter((node, index) =>
    degrees[index] === 1 && !node.isTerminator
  ).length;
  const minimumCombatGates = castleIndices.map((castleIndex) => {
    const distances = Array(nodes.length).fill(Infinity);
    distances[castleIndex] = 0;
    const queue = [castleIndex];
    let queueHead = 0;
    while (queueHead < queue.length) {
      const current = queue[queueHead++];
      for (const neighbor of adjacency[current]) {
        const cost = isBlockingNode(nodes[neighbor]) ? 1 : 0;
        const candidate = distances[current] + cost;
        if (candidate >= distances[neighbor]) continue;
        distances[neighbor] = candidate;
        queue.push(neighbor);
      }
    }
    const castle = nodes[castleIndex];
    const valuesFor = (predicate) => nodes
      .map((node, index) => predicate(node) ? distances[index] : null)
      .filter(Number.isFinite);
    const summarizeGates = (values) => values.length === 0
      ? { minimum: null, maximum: null }
      : { minimum: Math.min(...values), maximum: Math.max(...values) };
    return {
      castleNodeKey: castle.nodeKey,
      regionalExits: summarizeGates(valuesFor((node) =>
        node.routePairKey && node.regionPair?.includes(castle.regionId)
      )),
      zodiacShrines: summarizeGates(valuesFor(isZodiacShrine)),
      palace: summarizeGates(valuesFor((node) => node.nodeType === 'palace')),
      otherCastles: summarizeGates(valuesFor((node) =>
        node.nodeType === 'castle' && node.nodeKey !== castle.nodeKey
      ))
    };
  });

  const graphStretch = [];
  const progressionAnchorIndices = [...progressionAnchors].sort((left, right) =>
    nodes[left].nodeKey.localeCompare(nodes[right].nodeKey)
  );
  for (const sourceIndex of castleIndices) {
    const hops = Array(nodes.length).fill(Infinity);
    hops[sourceIndex] = 0;
    const hopQueue = [sourceIndex];
    let hopHead = 0;
    while (hopHead < hopQueue.length) {
      const current = hopQueue[hopHead++];
      for (const neighbor of adjacency[current]) {
        if (hops[neighbor] !== Infinity) continue;
        hops[neighbor] = hops[current] + 1;
        hopQueue.push(neighbor);
      }
    }

    const pathDistances = Array(nodes.length).fill(Infinity);
    pathDistances[sourceIndex] = 0;
    const frontier = [[0, sourceIndex]];
    const pushFrontier = (entry) => {
      frontier.push(entry);
      let child = frontier.length - 1;
      while (child > 0) {
        const parentIndex = Math.floor((child - 1) / 2);
        if (frontier[parentIndex][0] <= frontier[child][0]) break;
        [frontier[parentIndex], frontier[child]] = [frontier[child], frontier[parentIndex]];
        child = parentIndex;
      }
    };
    const popFrontier = () => {
      const first = frontier[0];
      const last = frontier.pop();
      if (frontier.length > 0) {
        frontier[0] = last;
        let parentIndex = 0;
        let settling = true;
        while (settling) {
          const left = parentIndex * 2 + 1;
          const right = left + 1;
          let smallest = parentIndex;
          if (left < frontier.length && frontier[left][0] < frontier[smallest][0]) {
            smallest = left;
          }
          if (right < frontier.length && frontier[right][0] < frontier[smallest][0]) {
            smallest = right;
          }
          if (smallest === parentIndex) {
            settling = false;
          } else {
            [frontier[parentIndex], frontier[smallest]] = [
              frontier[smallest],
              frontier[parentIndex]
            ];
            parentIndex = smallest;
          }
        }
      }
      return first;
    };
    while (frontier.length > 0) {
      const [distance, current] = popFrontier();
      if (distance !== pathDistances[current]) continue;
      for (const neighbor of adjacency[current]) {
        const edgeLength = Math.hypot(
          nodes[neighbor].x - nodes[current].x,
          nodes[neighbor].y - nodes[current].y
        );
        const candidate = distance + edgeLength;
        if (candidate >= pathDistances[neighbor]) continue;
        pathDistances[neighbor] = candidate;
        pushFrontier([candidate, neighbor]);
      }
    }

    for (const targetIndex of progressionAnchorIndices) {
      if (targetIndex === sourceIndex) continue;
      const directDistance = Math.hypot(
        nodes[targetIndex].x - nodes[sourceIndex].x,
        nodes[targetIndex].y - nodes[sourceIndex].y
      );
      const minimumGeometricHops = Math.max(
        1,
        Math.ceil(directDistance / INTER_REGION_CONFIG.MAX_NODE_SPACING)
      );
      graphStretch.push({
        fromNodeKey: nodes[sourceIndex].nodeKey,
        toNodeKey: nodes[targetIndex].nodeKey,
        hops: hops[targetIndex],
        pathDistance: pathDistances[targetIndex],
        directDistance,
        hopStretch: hops[targetIndex] / minimumGeometricHops,
        euclideanStretch: directDistance === 0
          ? null
          : pathDistances[targetIndex] / directDistance
      });
    }
  }

  // These are review bands, not validity thresholds. Crossing one emits a
  // reproducible advisory so corpus analysis can establish whether a future
  // retry/hard rule is justified by player-facing evidence.
  const reviewBands = {
    openingSafeComponentUpper: 8,
    combatGateSpikeUpper: 8,
    singleChoiceCorridorUpper: 12,
    anchorSeparatorShareUpper: 0.08,
    routeSharedSegmentRatioUpper: 0.5
  };
  const reviewBandCrossings = [];
  const recordReviewBandCrossing = (band, value, payload) => {
    const upper = reviewBands[band];
    if (!Number.isFinite(value) || value <= upper) return;
    const crossing = { band, value, upper, payload };
    reviewBandCrossings.push(crossing);
    addWarning(
      'GRAPH_QUALITY_REVIEW_BAND_EXCEEDED',
      `${band} exceeded its soft playtest review band`,
      crossing
    );
  };
  for (const opening of openingMetrics) {
    recordReviewBandCrossing(
      'openingSafeComponentUpper',
      opening.safeComponentSize,
      { castleNodeKey: opening.castleNodeKey }
    );
  }
  for (const gates of minimumCombatGates) {
    for (const [anchorKind, range] of Object.entries(gates)) {
      if (anchorKind === 'castleNodeKey') continue;
      recordReviewBandCrossing(
        'combatGateSpikeUpper',
        range.maximum,
        { castleNodeKey: gates.castleNodeKey, anchorKind }
      );
    }
  }
  recordReviewBandCrossing(
    'singleChoiceCorridorUpper',
    longestSingleChoiceCorridor,
    { nodeKeys: longestSingleChoiceCorridorPath }
  );
  recordReviewBandCrossing(
    'anchorSeparatorShareUpper',
    nodes.length === 0 ? 0 : articulationAnchorSeparators.size / nodes.length,
    {
      nodeKeys: [...articulationAnchorSeparators]
        .map((index) => nodes[index].nodeKey)
        .sort()
    }
  );
  for (const route of routeAlternatives) {
    recordReviewBandCrossing(
      'routeSharedSegmentRatioUpper',
      route.sharedSegmentRatio,
      { routePairKey: route.routePairKey }
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metrics: {
      nodeCount: nodes.length,
      connectionCount: connections.length,
      reachableNodeCount: visited.size,
      terminatorCount: terminators.length,
      deadEndTerminatorCount,
      openingComponents: openingMetrics,
      activityProfiles: activityMetrics,
      graphQuality: {
        degreeDistribution,
        deadEndRatio: nodes.length === 0 ? 0 : deadEnds / nodes.length,
        unrewardedDeadEndRatio: nodes.length === 0 ? 0 : unrewardedDeadEnds / nodes.length,
        articulationAnchorSeparators: [...articulationAnchorSeparators]
          .map((index) => nodes[index].nodeKey)
          .sort(),
        anchorSeparatingBridges: anchorSeparatingBridges.sort(),
        longestSingleChoiceCorridor,
        longestSingleChoiceCorridorPath,
        graphStretch,
        minimumCombatGates,
        rewardSiteGateDeltas: world.rewardSiteStats?.gateDeltas ?? [],
        routeAlternatives,
        lowerRiskDominanceCount: routeAlternatives
          .filter((route) => route.lowerRiskDominance).length,
        reviewBands,
        reviewBandCrossings
      },
      routeCount: new Set(
        connections.map((connection) => connection.routeId).filter(Boolean)
      ).size
    }
  };
}

/**
 * Validation function for Phase 6: Validation & Cleanup
 *
 * @param {number} seed - Random seed for testing
 * @returns {Object} Validation results
 */
export async function validatePhase6(seed = 12345) {
  const { assembleWorld } = await import('./worldAssembly.js');
  const world = assembleWorld({ seed });
  return {
    world,
    phase6Result: validateAndCleanup(world),
    passed: world.validation.valid,
    issues: world.validation.errors
  };
}
