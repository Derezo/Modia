/**
 * Internal Node Generation (Phase 3 of 5-Region World Generation)
 *
 * This module handles the generation of nodes within each region using
 * Poisson disk sampling. It creates spatially distributed nodes that
 * maintain minimum spacing and assigns appropriate types based on
 * distance rings from the castle.
 *
 * Phase 3 Flow:
 * 1. For each region, use Poisson disk sampling within the Voronoi cell
 * 2. Generate ~60-80 nodes per region with minimum 3.5 spacing
 * 3. Assign node types based on distance bands from castle:
 *    - Ring 0 (0-5): Battle nodes only (guards around castle)
 *    - Ring 1 (5-12): Cities, villages, battle nodes
 *    - Ring 2 (12-20): Keep, guild, villages, battle nodes
 *    - Ring 3 (20+): Battle nodes, future terminators
 * 4. Ensure required counts: 2-3 cities, 1 keep, 1 guild, 6-10 villages
 *
 * Dependencies:
 * - Phase 1 (castlePlacement.js): Castle positions as seed points
 * - Phase 2 (voronoiPartitioning.js): Region boundary polygons
 *
 * @module worldgen/nodeGeneration
 */

import {
  REGION_NODE_CONFIG,
  GUILD_CONFIG,
  NODE_DISTRIBUTION,
  WATCHTOWER_CONFIG,
  ZODIAC_CONFIG,
  TERRAIN_ANTI_CLUSTERING
} from './constants.js';
import { SeededRandom, TERRAIN_DISTRIBUTION } from '../../config/constants.js';
import { generateCastlePlacements } from './castlePlacement.js';
import { createVoronoiRegions } from './voronoiPartitioning.js';

/**
 * Check if a point is inside a polygon using ray casting algorithm
 *
 * @param {number} x - X coordinate of point
 * @param {number} y - Y coordinate of point
 * @param {Array<[number, number]>} polygon - Array of [x, y] vertices (closed polygon)
 * @returns {boolean} True if point is inside polygon
 */
export function isPointInPolygon(x, y, polygon) {
  let inside = false;
  const n = polygon.length;

  // Ray casting: count intersections with polygon edges
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    // Check if ray from point going right intersects this edge
    const intersect = ((yi > y) !== (yj > y)) &&
                      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Calculate bounding box of a polygon
 *
 * @param {Array<[number, number]>} polygon - Polygon vertices
 * @returns {{minX: number, maxX: number, minY: number, maxY: number}}
 */
export function getPolygonBoundingBox(polygon) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return { minX, maxX, minY, maxY };
}

/**
 * Generate Poisson disk samples within a polygon boundary
 * Uses the active-list algorithm by Bridson (2007)
 *
 * @param {Array<[number, number]>} polygon - Polygon vertices [[x,y], ...]
 * @param {number} minDistance - Minimum distance between samples (3.5)
 * @param {SeededRandom} rng - Seeded random generator
 * @param {number} targetCount - Target number of nodes (~60-80)
 * @param {{x: number, y: number}} startPoint - Initial seed point (castle position)
 * @returns {Array<{x: number, y: number}>} Generated sample positions
 */
export function poissonDiskSampleInPolygon(polygon, minDistance, rng, targetCount, startPoint) {
  const samples = [];
  const activeList = [];

  // Get bounding box for spatial grid
  const bounds = getPolygonBoundingBox(polygon);

  // Spatial grid for efficient neighbor lookup
  const cellSize = minDistance / Math.sqrt(2);
  const gridWidth = Math.ceil((bounds.maxX - bounds.minX) / cellSize);
  const gridHeight = Math.ceil((bounds.maxY - bounds.minY) / cellSize);
  const grid = new Array(gridWidth * gridHeight).fill(null);

  // Helper to get grid index
  function getGridIndex(x, y) {
    const gx = Math.floor((x - bounds.minX) / cellSize);
    const gy = Math.floor((y - bounds.minY) / cellSize);
    if (gx < 0 || gx >= gridWidth || gy < 0 || gy >= gridHeight) return -1;
    return gy * gridWidth + gx;
  }

  // Helper to check if position is valid (inside polygon and not too close to others)
  function isValidPosition(x, y) {
    // Must be inside the polygon
    if (!isPointInPolygon(x, y, polygon)) return false;

    // Check distance from nearby samples
    const gx = Math.floor((x - bounds.minX) / cellSize);
    const gy = Math.floor((y - bounds.minY) / cellSize);

    // Check neighboring cells (2-cell radius to be safe)
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) continue;

        const idx = ny * gridWidth + nx;
        const neighbor = grid[idx];
        if (neighbor) {
          const dist = Math.hypot(neighbor.x - x, neighbor.y - y);
          if (dist < minDistance) return false;
        }
      }
    }

    return true;
  }

  // Helper to add a sample
  function addSample(x, y) {
    const sample = { x, y };
    samples.push(sample);
    activeList.push(sample);
    const idx = getGridIndex(x, y);
    if (idx >= 0) grid[idx] = sample;
    return sample;
  }

  // Start with the castle position (or centroid if castle is outside polygon)
  if (isPointInPolygon(startPoint.x, startPoint.y, polygon)) {
    addSample(startPoint.x, startPoint.y);
  } else {
    // Find a valid starting point near the centroid
    const centroidX = polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length;
    const centroidY = polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length;

    // Try centroid first
    if (isPointInPolygon(centroidX, centroidY, polygon)) {
      addSample(centroidX, centroidY);
    } else {
      // Fallback: find any point inside the polygon
      let found = false;
      for (let attempt = 0; attempt < 100 && !found; attempt++) {
        const x = bounds.minX + rng.next() * (bounds.maxX - bounds.minX);
        const y = bounds.minY + rng.next() * (bounds.maxY - bounds.minY);
        if (isPointInPolygon(x, y, polygon)) {
          addSample(x, y);
          found = true;
        }
      }
      if (!found) {
        console.warn('  Warning: Could not find valid starting point in polygon');
        return samples;
      }
    }
  }

  // Poisson disk sampling main loop
  while (activeList.length > 0 && samples.length < targetCount * 1.5) {
    // Pick a random active point
    const activeIdx = rng.nextInt(0, activeList.length - 1);
    const activePoint = activeList[activeIdx];

    let foundCandidate = false;

    // Try to find a valid candidate around this point
    for (let attempt = 0; attempt < REGION_NODE_CONFIG.MAX_POISSON_ATTEMPTS; attempt++) {
      const angle = rng.next() * Math.PI * 2;
      const distance = minDistance + rng.next() * minDistance; // [r, 2r]
      const candidateX = activePoint.x + Math.cos(angle) * distance;
      const candidateY = activePoint.y + Math.sin(angle) * distance;

      if (isValidPosition(candidateX, candidateY)) {
        addSample(candidateX, candidateY);
        foundCandidate = true;
        break;
      }
    }

    // If no valid candidate found, remove this point from active list
    if (!foundCandidate) {
      activeList.splice(activeIdx, 1);
    }
  }

  return samples;
}

/**
 * Get the primary guild type for a region based on its dominant race
 *
 * @param {Object} region - Region config
 * @returns {string} Guild type (warrior, wizard, monk, chemist)
 */
function getPrimaryGuildType(region) {
  const raceToGuild = GUILD_CONFIG.RACE_PRIMARY_GUILD;
  return raceToGuild[region.race] || 'warrior';
}

/**
 * Assign node types to generated positions within a region
 * Uses distance from castle as proxy for ring assignment (graph distance computed in Phase 4)
 *
 * Updated to support:
 * - 3 guilds per region (1 primary in Ring 1, 2 secondary in Rings 2-3)
 * - Activity nodes (fishing_spot, merchant_caravan, ruins)
 * - Watchtowers (very rare, outer rings only)
 * - Farms (outer ring settlements)
 * - Rebalanced node distribution (40-50% battle, 20-30% activity, 20-30% settlement)
 *
 * @param {Array<{x: number, y: number}>} positions - Generated node positions
 * @param {{x: number, y: number}} castle - Castle position
 * @param {Object} region - Region config from REGIONS constant
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {Array<Object>} Nodes with assigned types
 */
export function assignRegionNodeTypes(positions, castle, region, rng) {
  // Calculate distance from castle for each position
  const nodesWithDist = positions.map((pos, idx) => ({
    x: pos.x,
    y: pos.y,
    distFromCastle: Math.hypot(pos.x - castle.x, pos.y - castle.y),
    isCastle: idx === 0 && pos.x === castle.x && pos.y === castle.y,
    nodeType: null,
    guildType: null,  // For guilds: warrior, wizard, monk, chemist
    regionId: region.id,
    regionName: region.name
  }));

  // Sort by distance for easier assignment
  nodesWithDist.sort((a, b) => a.distFromCastle - b.distFromCastle);

  // First node at castle position gets castle type (if it matches)
  const castleNode = nodesWithDist.find(n =>
    Math.abs(n.x - castle.x) < 0.5 && Math.abs(n.y - castle.y) < 0.5
  );
  if (castleNode) {
    castleNode.nodeType = 'castle';
    castleNode.isCastle = true;
  }

  // Count targets
  const cityCount = rng.nextInt(REGION_NODE_CONFIG.CITY_COUNT_MIN, REGION_NODE_CONFIG.CITY_COUNT_MAX);
  const villageCount = rng.nextInt(REGION_NODE_CONFIG.VILLAGE_COUNT_MIN, REGION_NODE_CONFIG.VILLAGE_COUNT_MAX);
  const farmCount = rng.nextInt(NODE_DISTRIBUTION.FARM_COUNT_MIN, NODE_DISTRIBUTION.FARM_COUNT_MAX);
  const keepCount = REGION_NODE_CONFIG.KEEP_COUNT;

  // Guild setup: Only primary guild assigned here (race-appropriate)
  // Secondary guilds are assigned globally in assignGlobalSecondaryGuilds()
  const primaryGuildType = getPrimaryGuildType(region);

  let citiesAssigned = 0;
  let villagesAssigned = 0;
  let farmsAssigned = 0;
  let keepAssigned = 0;
  let primaryGuildAssigned = false;
  let watchtowerAssigned = false;

  // Activity node counters
  let fishingAssigned = 0;
  let caravanAssigned = 0;
  let ruinsAssigned = 0;

  // Target activity node count (20-30% of total)
  const activityTarget = Math.floor(positions.length * (NODE_DISTRIBUTION.ACTIVITY_PERCENT.min +
    rng.next() * (NODE_DISTRIBUTION.ACTIVITY_PERCENT.max - NODE_DISTRIBUTION.ACTIVITY_PERCENT.min)));

  // Track assigned battle nodes for anti-clustering
  const assignedBattleNodes = [];
  const battleTypes = NODE_DISTRIBUTION.BATTLE_TYPES;

  /**
   * Helper to pick battle terrain with neighbor-aware anti-clustering.
   * Reduces probability of same-type terrain when neighbors of that type exist nearby.
   *
   * @param {Object} currentNode - The node being assigned (with x, y)
   * @returns {string} Selected terrain type (forest, cave, mountain)
   */
  function pickBattleTerrain(currentNode) {
    const config = TERRAIN_ANTI_CLUSTERING;

    // If anti-clustering is disabled, use simple probabilistic selection
    if (!config.ENABLED) {
      if (rng.next() < TERRAIN_DISTRIBUTION.DOMINANT_WEIGHT) {
        return region.dominantTerrain;
      }
      return rng.pick(region.secondaryTerrains);
    }

    // Count same-type neighbors within anti-cluster radius
    const neighborCounts = { forest: 0, cave: 0, mountain: 0 };
    for (const neighbor of assignedBattleNodes) {
      const dist = Math.hypot(currentNode.x - neighbor.x, currentNode.y - neighbor.y);
      if (dist <= config.ANTI_CLUSTER_RADIUS && battleTypes.includes(neighbor.nodeType)) {
        neighborCounts[neighbor.nodeType]++;
      }
    }

    // Calculate adjusted weights
    const dominantType = region.dominantTerrain;
    const secondaryTypes = region.secondaryTerrains;
    const allTerrainTypes = [dominantType, ...secondaryTypes.filter(t => t !== dominantType)];

    // Start with base weights
    const weights = {};
    for (const type of allTerrainTypes) {
      if (type === dominantType) {
        weights[type] = TERRAIN_DISTRIBUTION.DOMINANT_WEIGHT; // 0.70
      } else {
        // Split remaining weight among secondary types
        weights[type] = (1 - TERRAIN_DISTRIBUTION.DOMINANT_WEIGHT) / secondaryTypes.length;
      }
    }

    // Apply penalties for clustering
    for (const type of allTerrainTypes) {
      const count = neighborCounts[type] || 0;

      // Hard cap: if too many same-type nearby, zero out this type
      if (count >= config.MAX_SAME_TYPE_NEARBY) {
        weights[type] = 0;
        continue;
      }

      // Soft penalty: reduce weight by penalty factor per neighbor
      for (let i = 0; i < count; i++) {
        weights[type] *= (1 - config.SAME_TYPE_PENALTY);
      }
    }

    // Ensure minimum dominant ratio is preserved (regional identity)
    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
    if (totalWeight > 0 && weights[dominantType] / totalWeight < config.MIN_DOMINANT_RATIO) {
      // Boost dominant type to minimum ratio
      const targetDominant = config.MIN_DOMINANT_RATIO * totalWeight / (1 - config.MIN_DOMINANT_RATIO);
      weights[dominantType] = Math.max(weights[dominantType], targetDominant);
    }

    // Normalize and select
    const normalizedTotal = Object.values(weights).reduce((sum, w) => sum + w, 0);
    if (normalizedTotal === 0) {
      // Fallback: all types blocked, pick any secondary
      return rng.pick(secondaryTypes);
    }

    // Weighted random selection
    const roll = rng.next() * normalizedTotal;
    let cumulative = 0;
    for (const type of allTerrainTypes) {
      cumulative += weights[type];
      if (roll <= cumulative) {
        return type;
      }
    }

    // Fallback (shouldn't reach)
    return dominantType;
  }

  // Helper to pick activity node type
  function pickActivityType() {
    const types = NODE_DISTRIBUTION.ACTIVITY_TYPES;
    return types[rng.nextInt(0, types.length - 1)];
  }

  // Assign types based on distance bands
  for (const node of nodesWithDist) {
    if (node.nodeType) continue; // Skip already assigned (castle)

    const dist = node.distFromCastle;

    // Ring 0 (0-5): Battle nodes only (guards around castle)
    if (dist <= REGION_NODE_CONFIG.RING_0_MAX_DIST) {
      node.nodeType = pickBattleTerrain(node);
      assignedBattleNodes.push(node);
      continue;
    }

    // Ring 1 (5-12): Primary guild, Cities, Villages, Activity nodes, Battle nodes
    if (dist <= REGION_NODE_CONFIG.RING_1_MAX_DIST) {
      // Primary guild (race-appropriate, must be in Ring 1)
      if (!primaryGuildAssigned && dist >= 6 && dist <= 10 && rng.next() < 0.35) {
        node.nodeType = 'guild';
        node.guildType = primaryGuildType;
        primaryGuildAssigned = true;
        continue;
      }
      // Cities in mid-ring (prioritize 6-10 distance)
      if (citiesAssigned < cityCount && dist >= 6 && dist <= 10 && rng.next() < 0.35) {
        node.nodeType = 'city';
        citiesAssigned++;
        continue;
      }
      // Villages
      if (villagesAssigned < villageCount / 2 && rng.next() < 0.25) {
        node.nodeType = 'village';
        villagesAssigned++;
        continue;
      }
      // Activity nodes (in Ring 1)
      const totalActivity = fishingAssigned + caravanAssigned + ruinsAssigned;
      if (totalActivity < activityTarget / 2 && rng.next() < 0.2) {
        node.nodeType = pickActivityType();
        if (node.nodeType === 'fishing_spot') fishingAssigned++;
        else if (node.nodeType === 'merchant_caravan') caravanAssigned++;
        else if (node.nodeType === 'ruins') ruinsAssigned++;
        continue;
      }
      // Default: battle terrain
      node.nodeType = pickBattleTerrain(node);
      assignedBattleNodes.push(node);
      continue;
    }

    // Ring 2 (12-20): Keep, Villages, Farms, Activity nodes, Battle nodes
    // Note: Secondary guilds are assigned globally after all regions are processed
    if (dist <= REGION_NODE_CONFIG.RING_2_MAX_DIST) {
      // Keep (place in 14-18 range)
      if (keepAssigned < keepCount && dist >= 14 && dist <= 18 && rng.next() < 0.25) {
        node.nodeType = 'keep';
        keepAssigned++;
        continue;
      }
      // Farms (outer ring settlements)
      if (farmsAssigned < farmCount && dist >= NODE_DISTRIBUTION.FARM_MIN_RING * 5 && rng.next() < 0.2) {
        node.nodeType = 'farm';
        farmsAssigned++;
        continue;
      }
      // Remaining villages
      if (villagesAssigned < villageCount && rng.next() < 0.2) {
        node.nodeType = 'village';
        villagesAssigned++;
        continue;
      }
      // Activity nodes
      const totalActivity = fishingAssigned + caravanAssigned + ruinsAssigned;
      if (totalActivity < activityTarget && rng.next() < 0.25) {
        node.nodeType = pickActivityType();
        if (node.nodeType === 'fishing_spot') fishingAssigned++;
        else if (node.nodeType === 'merchant_caravan') caravanAssigned++;
        else if (node.nodeType === 'ruins') ruinsAssigned++;
        continue;
      }
      // Default: battle terrain
      node.nodeType = pickBattleTerrain(node);
      assignedBattleNodes.push(node);
      continue;
    }

    // Ring 3 (20+): Watchtower, Activity nodes, Battle nodes (converted to terminators in Phase 6)
    // Watchtower (very rare, outer rings only)
    if (!watchtowerAssigned && dist >= WATCHTOWER_CONFIG.MIN_RING * 5 && rng.next() < WATCHTOWER_CONFIG.SPAWN_CHANCE * 0.3) {
      node.nodeType = 'watchtower';
      watchtowerAssigned = true;
      continue;
    }
    // Activity nodes in outer ring
    const totalActivity = fishingAssigned + caravanAssigned + ruinsAssigned;
    if (totalActivity < activityTarget && rng.next() < 0.2) {
      node.nodeType = pickActivityType();
      if (node.nodeType === 'fishing_spot') fishingAssigned++;
      else if (node.nodeType === 'merchant_caravan') caravanAssigned++;
      else if (node.nodeType === 'ruins') ruinsAssigned++;
      continue;
    }
    // Default: battle terrain
    node.nodeType = pickBattleTerrain(node);
    assignedBattleNodes.push(node);
  }

  // ============================================================================
  // Pass 2: Ensure required counts are met
  // ============================================================================

  // Primary guild (must be in Ring 1)
  if (!primaryGuildAssigned) {
    const availableForPrimaryGuild = nodesWithDist.filter(n =>
      n.nodeType !== 'castle' && n.nodeType !== 'city' && n.nodeType !== 'guild' &&
      n.distFromCastle >= 5 && n.distFromCastle <= 12
    );
    if (availableForPrimaryGuild.length > 0) {
      const idx = rng.nextInt(0, availableForPrimaryGuild.length - 1);
      const node = availableForPrimaryGuild[idx];
      node.nodeType = 'guild';
      node.guildType = primaryGuildType;
      primaryGuildAssigned = true;
    }
  }

  // Cities
  const availableForCity = nodesWithDist.filter(n =>
    n.nodeType !== 'castle' && n.nodeType !== 'city' && n.nodeType !== 'guild' &&
    n.distFromCastle >= 6 && n.distFromCastle <= 12
  );
  while (citiesAssigned < cityCount && availableForCity.length > 0) {
    const idx = rng.nextInt(0, availableForCity.length - 1);
    const node = availableForCity.splice(idx, 1)[0];
    node.nodeType = 'city';
    citiesAssigned++;
  }

  // Keep
  const availableForKeep = nodesWithDist.filter(n =>
    n.nodeType !== 'castle' && n.nodeType !== 'city' && n.nodeType !== 'keep' && n.nodeType !== 'guild' &&
    n.distFromCastle >= 12 && n.distFromCastle <= 20
  );
  while (keepAssigned < keepCount && availableForKeep.length > 0) {
    const idx = rng.nextInt(0, availableForKeep.length - 1);
    const node = availableForKeep.splice(idx, 1)[0];
    node.nodeType = 'keep';
    keepAssigned++;
  }

  // Note: Secondary guilds are assigned globally in assignGlobalSecondaryGuilds()

  // Villages (fill to target)
  const availableForVillage = nodesWithDist.filter(n =>
    !['castle', 'city', 'keep', 'guild', 'village', 'farm', 'watchtower'].includes(n.nodeType) &&
    n.distFromCastle >= 5 && n.distFromCastle <= 18
  );
  while (villagesAssigned < villageCount && availableForVillage.length > 0) {
    const idx = rng.nextInt(0, availableForVillage.length - 1);
    const node = availableForVillage.splice(idx, 1)[0];
    node.nodeType = 'village';
    villagesAssigned++;
  }

  // Farms (fill to target if any remain)
  const availableForFarm = nodesWithDist.filter(n =>
    !['castle', 'city', 'keep', 'guild', 'village', 'farm', 'watchtower'].includes(n.nodeType) &&
    n.distFromCastle >= 10
  );
  while (farmsAssigned < farmCount && availableForFarm.length > 0) {
    const idx = rng.nextInt(0, availableForFarm.length - 1);
    const node = availableForFarm.splice(idx, 1)[0];
    node.nodeType = 'farm';
    farmsAssigned++;
  }

  return nodesWithDist;
}

/**
 * Generate nodes within a single region using Poisson disk sampling
 *
 * @param {Object} region - Region data from REGIONS constant
 * @param {Array<[number, number]>} cellPolygon - Voronoi cell polygon
 * @param {{x: number, y: number}} castle - Castle position
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {Array<Object>} Array of node objects with x, y, nodeType, regionId
 */
export function generateRegionNodes(region, cellPolygon, castle, rng) {
  console.log(`  Generating nodes for ${region.name} (${region.dominantTerrain} dominant)...`);

  // Generate Poisson disk samples within the cell polygon
  const positions = poissonDiskSampleInPolygon(
    cellPolygon,
    REGION_NODE_CONFIG.MIN_SPACING,
    rng,
    REGION_NODE_CONFIG.TARGET_NODES_PER_REGION,
    castle
  );

  console.log(`    Generated ${positions.length} positions via Poisson disk sampling`);

  // Assign node types based on distance from castle
  const typedNodes = assignRegionNodeTypes(positions, castle, region, rng);

  // Count node types for logging
  const typeCounts = {};
  for (const node of typedNodes) {
    typeCounts[node.nodeType] = (typeCounts[node.nodeType] || 0) + 1;
  }

  console.log(`    Node distribution: ${JSON.stringify(typeCounts)}`);

  return typedNodes;
}

/**
 * Generate all internal nodes for all regions
 * Orchestrates Phase 3 across all 5 regions
 *
 * @param {Array<{x: number, y: number, region: Object}>} castles - Castle positions from Phase 1
 * @param {Object} voronoiData - Voronoi partitioning data from Phase 2
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {Object} All generated nodes organized by region
 *   - allNodes: Array of all nodes across all regions
 *   - nodesByRegion: Map of regionId -> nodes array
 */
export function generateAllRegionNodes(castles, voronoiData, rng) {
  console.log('\n========================================');
  console.log('PHASE 3: Internal Node Generation');
  console.log('========================================');

  const allNodes = [];
  const nodesByRegion = new Map();

  for (let i = 0; i < castles.length; i++) {
    const castle = castles[i];
    const cell = voronoiData.cells[i];
    const region = castle.region;

    // Get the cell polygon
    const polygon = cell.polygon;
    if (!polygon || polygon.length < 3) {
      console.warn(`  Warning: Invalid polygon for region ${region.name}, skipping`);
      continue;
    }

    // Generate nodes for this region
    const regionNodes = generateRegionNodes(
      region,
      polygon,
      { x: castle.x, y: castle.y },
      rng
    );

    // Store results
    nodesByRegion.set(region.id, regionNodes);
    allNodes.push(...regionNodes);
  }

  console.log(`\nPhase 3 Complete: Generated ${allNodes.length} total nodes across ${nodesByRegion.size} regions`);

  // Assign secondary guilds globally with same-type spacing
  assignGlobalSecondaryGuilds(allNodes, nodesByRegion, castles, rng);

  // Assign zodiac shrines globally (one of each type)
  assignZodiacShrines(allNodes, castles, rng);

  // Summary statistics
  const globalTypeCounts = {};
  for (const node of allNodes) {
    globalTypeCounts[node.nodeType] = (globalTypeCounts[node.nodeType] || 0) + 1;
  }
  console.log('Global node type distribution:', JSON.stringify(globalTypeCounts));

  return {
    allNodes,
    nodesByRegion
  };
}

/**
 * Assign secondary guilds globally with same-type spacing constraint.
 * Called after all regions have primary guilds assigned.
 *
 * Algorithm:
 * 1. Collect all existing guild positions and types (primaries)
 * 2. For each region needing secondary guilds:
 *    - Find candidate nodes (outer rings, not already assigned)
 *    - Score by distance to nearest same-type guild globally
 *    - Prefer types that are underrepresented
 * 3. Place guilds prioritizing maximum same-type spacing
 *
 * @param {Array} allNodes - All generated nodes
 * @param {Map} nodesByRegion - Nodes organized by region ID
 * @param {Array} castles - Castle data with region info
 * @param {SeededRandom} rng - Seeded random generator
 */
function assignGlobalSecondaryGuilds(allNodes, nodesByRegion, castles, _rng) {
  console.log('\n  Assigning secondary guilds with global spacing...');

  // Track all guild positions globally
  const guildsByType = {
    warrior: [],
    wizard: [],
    monk: [],
    chemist: []
  };

  // Collect existing primary guilds
  for (const node of allNodes) {
    if (node.nodeType === 'guild' && node.guildType) {
      guildsByType[node.guildType].push(node);
    }
  }

  console.log(`    Primary guilds found: ${Object.entries(guildsByType).map(([t, g]) => `${t}:${g.length}`).join(', ')}`);

  // For each region, assign 2 secondary guilds
  const targetSecondaryPerRegion = GUILD_CONFIG.RING_2_3_COUNT;

  for (const castle of castles) {
    const regionNodes = nodesByRegion.get(castle.region.id);
    if (!regionNodes) continue;

    // Get primary guild type for this region (to exclude)
    const primaryType = GUILD_CONFIG.RACE_PRIMARY_GUILD[castle.region.race] || 'warrior';

    // Find candidates: nodes in Ring 2-3 (distance 12-25 from castle)
    const candidates = regionNodes.filter(node => {
      if (node.nodeType === 'guild' || node.nodeType === 'castle') return false;

      // Skip settlements (except battle nodes which can be converted)
      const protectedTypes = ['city', 'village', 'keep', 'farm', 'watchtower', 'shrine'];
      if (protectedTypes.includes(node.nodeType)) return false;

      const dist = Math.hypot(node.x - castle.x, node.y - castle.y);
      return dist >= 12 && dist <= 25;
    });

    if (candidates.length < targetSecondaryPerRegion) {
      console.log(`    Warning: ${castle.region.name} has only ${candidates.length} candidates for secondary guilds`);
    }

    // Determine which guild types to assign (exclude primary)
    const availableTypes = GUILD_CONFIG.TYPES.filter(t => t !== primaryType);

    // Sort available types by global count (prefer underrepresented)
    availableTypes.sort((a, b) => guildsByType[a].length - guildsByType[b].length);

    // Assign secondary guilds
    let assigned = 0;
    for (const guildType of availableTypes) {
      if (assigned >= targetSecondaryPerRegion) break;

      // Check global cap
      if (guildsByType[guildType].length >= GUILD_CONFIG.GLOBAL_MAX_PER_TYPE) {
        continue;
      }

      // Score candidates by distance to same-type guilds
      let bestCandidate = null;
      let bestScore = -Infinity;

      for (const candidate of candidates) {
        // Skip if already used
        if (candidate.nodeType === 'guild') continue;

        // Calculate minimum distance to same-type guilds globally
        let minSameTypeDist = Infinity;
        for (const existingGuild of guildsByType[guildType]) {
          const dist = Math.hypot(candidate.x - existingGuild.x, candidate.y - existingGuild.y);
          minSameTypeDist = Math.min(minSameTypeDist, dist);
        }

        // Score = distance (higher = better spacing)
        const score = minSameTypeDist === Infinity ? 1000 : minSameTypeDist;
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        }
      }

      if (bestCandidate) {
        // Check minimum spacing constraint (soft warning)
        if (bestScore < GUILD_CONFIG.MIN_SAME_TYPE_SPACING && guildsByType[guildType].length > 0) {
          if (GUILD_CONFIG.WARN_ON_SAME_TYPE_SPACING) {
            console.log(`    Warning: ${guildType} guild in ${castle.region.name} only ${bestScore.toFixed(1)} units from nearest same-type (min: ${GUILD_CONFIG.MIN_SAME_TYPE_SPACING})`);
          }
        }

        bestCandidate.nodeType = 'guild';
        bestCandidate.guildType = guildType;
        guildsByType[guildType].push(bestCandidate);
        assigned++;
      }
    }

    if (assigned < targetSecondaryPerRegion) {
      console.log(`    Warning: ${castle.region.name} only got ${assigned}/${targetSecondaryPerRegion} secondary guilds`);
    }
  }

  // Final summary
  console.log(`    Final guild distribution: ${Object.entries(guildsByType).map(([t, g]) => `${t}:${g.length}`).join(', ')}`);

  // Validate global minimums
  for (const [type, guilds] of Object.entries(guildsByType)) {
    if (guilds.length < GUILD_CONFIG.GLOBAL_MIN_PER_TYPE) {
      console.log(`    Warning: Only ${guilds.length} ${type} guilds (min: ${GUILD_CONFIG.GLOBAL_MIN_PER_TYPE})`);
    }
  }
}

/**
 * Assign zodiac shrines globally across all regions
 * Converts 12 eligible 'shrine' nodes (or creates from battle nodes) to zodiac shrines
 *
 * @param {Array} allNodes - All generated nodes
 * @param {Array} castles - Castle positions (to calculate distances)
 * @param {SeededRandom} rng - Seeded random generator
 */
function assignZodiacShrines(allNodes, castles, rng) {
  console.log('\n  Assigning zodiac shrines...');

  const zodiacTypes = [...ZODIAC_CONFIG.ZODIAC_TYPES];
  const assignedShrines = [];

  // Find eligible nodes for zodiac shrines:
  // - Not a settlement (castle, city, village, guild, keep, farm)
  // - Not already assigned (shrine, watchtower)
  // - In outer rings (Ring 2+)
  const settlements = ['castle', 'city', 'village', 'guild', 'keep', 'farm'];
  const reserved = ['shrine', 'watchtower', 'bridge'];

  // Calculate distance from nearest castle for each node
  const eligibleNodes = allNodes.filter(node => {
    if (settlements.includes(node.nodeType) || reserved.includes(node.nodeType)) {
      return false;
    }

    // Check distance from nearest castle
    let minCastleDist = Infinity;
    for (const castle of castles) {
      const dist = Math.hypot(node.x - castle.x, node.y - castle.y);
      minCastleDist = Math.min(minCastleDist, dist);
    }

    // Must be at least MIN_RING distance (in world units * 5 for ring conversion)
    return minCastleDist >= ZODIAC_CONFIG.MIN_RING * 5;
  });

  // Shuffle eligible nodes for random selection
  for (let i = eligibleNodes.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [eligibleNodes[i], eligibleNodes[j]] = [eligibleNodes[j], eligibleNodes[i]];
  }

  // Assign zodiac types to shrines, enforcing minimum spacing
  for (const zodiacType of zodiacTypes) {
    let bestNode = null;
    let bestScore = -Infinity;

    for (const node of eligibleNodes) {
      // Skip if already assigned a zodiac type
      if (node.shrineBuffType) continue;

      // Calculate minimum distance to existing zodiac shrines
      let minShrineDist = Infinity;
      for (const shrine of assignedShrines) {
        const dist = Math.hypot(node.x - shrine.x, node.y - shrine.y);
        minShrineDist = Math.min(minShrineDist, dist);
      }

      // Skip if too close to another zodiac shrine
      if (assignedShrines.length > 0 && minShrineDist < ZODIAC_CONFIG.MIN_SPACING) {
        continue;
      }

      // Score based on distance from other shrines (prefer spread out)
      const score = minShrineDist === Infinity ? 1000 : minShrineDist;
      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }

    if (bestNode) {
      bestNode.nodeType = 'shrine';
      bestNode.shrineBuffType = `zodiac_${zodiacType}`;
      bestNode.name = ZODIAC_CONFIG.SHRINE_NAMES[zodiacType];
      assignedShrines.push(bestNode);
    }
  }

  console.log(`    Assigned ${assignedShrines.length} zodiac shrines`);
  if (assignedShrines.length < ZODIAC_CONFIG.PER_WORLD) {
    const missingCount = ZODIAC_CONFIG.PER_WORLD - assignedShrines.length;
    const missingTypes = zodiacTypes.slice(assignedShrines.length);
    console.error(`    ERROR: Only ${assignedShrines.length}/${ZODIAC_CONFIG.PER_WORLD} zodiac shrines placed! (${missingCount} missing)`);
    console.error(`    Missing zodiac types: ${missingTypes.join(', ')}`);
    console.error(`    Eligible nodes: ${eligibleNodes.length}, Candidates checked: ${eligibleNodes.filter(n => !n.shrineBuffType).length}`);
    throw new Error(`World generation failed: Could not place all ${ZODIAC_CONFIG.PER_WORLD} zodiac shrines. Only ${assignedShrines.length} placed (${missingCount} missing). Missing: ${missingTypes.join(', ')}`);
  }

  return assignedShrines;
}

/**
 * Validation function for Phase 3: Internal Node Generation
 *
 * @param {number} seed - Random seed for testing
 * @returns {Object} Validation results
 */
export function validateRegionNodeGeneration(seed = 12345) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('REGION NODE GENERATION VALIDATION (Phase 3)');
  console.log(`${'='.repeat(60)}`);
  console.log(`Testing with seed: ${seed}`);

  const rng = new SeededRandom(seed);

  // Run Phase 1: Castle placement
  const castles = generateCastlePlacements(rng);

  // Run Phase 2: Voronoi partitioning
  const voronoiData = createVoronoiRegions(castles);

  // Run Phase 3: Internal node generation
  const { allNodes, nodesByRegion } = generateAllRegionNodes(castles, voronoiData, rng);

  // Validation checks
  const issues = [];

  // Check 1: Each region has nodes (larger Voronoi cells get more nodes, 40-120 acceptable)
  for (const castle of castles) {
    const regionNodes = nodesByRegion.get(castle.region.id);
    if (!regionNodes || regionNodes.length === 0) {
      issues.push(`Region ${castle.region.name} has no nodes`);
    } else if (regionNodes.length < 40) {
      issues.push(`Region ${castle.region.name} has too few nodes: ${regionNodes.length}`);
    } else if (regionNodes.length > 120) {
      issues.push(`Region ${castle.region.name} has too many nodes: ${regionNodes.length}`);
    }
  }

  // Check 2: Each region has exactly 1 castle
  for (const [regionId, nodes] of nodesByRegion) {
    const castleCount = nodes.filter(n => n.nodeType === 'castle').length;
    if (castleCount !== 1) {
      issues.push(`Region ${regionId} has ${castleCount} castles (expected 1)`);
    }
  }

  // Check 3: Each region has required special nodes
  for (const [regionId, nodes] of nodesByRegion) {
    const cities = nodes.filter(n => n.nodeType === 'city').length;
    const keeps = nodes.filter(n => n.nodeType === 'keep').length;
    const guilds = nodes.filter(n => n.nodeType === 'guild').length;
    const villages = nodes.filter(n => n.nodeType === 'village').length;
    const farms = nodes.filter(n => n.nodeType === 'farm').length;
    const activityNodes = nodes.filter(n =>
      ['fishing_spot', 'merchant_caravan', 'ruins'].includes(n.nodeType)
    ).length;

    if (cities < 2 || cities > 3) {
      issues.push(`Region ${regionId} has ${cities} cities (expected 2-3)`);
    }
    if (keeps !== 1) {
      issues.push(`Region ${regionId} has ${keeps} keeps (expected 1)`);
    }
    if (guilds < 2 || guilds > 3) {
      issues.push(`Region ${regionId} has ${guilds} guilds (expected 2-3)`);
    }
    if (villages < 6 || villages > 10) {
      issues.push(`Region ${regionId} has ${villages} villages (expected 6-10)`);
    }
    if (farms < 1) {
      issues.push(`Region ${regionId} has no farms (expected at least 1)`);
    }
    if (activityNodes < 3) {
      issues.push(`Region ${regionId} has too few activity nodes: ${activityNodes} (expected at least 3)`);
    }
  }

  // Check 4: Minimum spacing between nodes
  for (const [regionId, nodes] of nodesByRegion) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dist = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
        if (dist < REGION_NODE_CONFIG.MIN_SPACING * 0.9) { // 10% tolerance
          issues.push(`Region ${regionId}: nodes too close (${dist.toFixed(2)} < ${REGION_NODE_CONFIG.MIN_SPACING})`);
          break; // Only report first violation per region
        }
      }
      if (issues.length > 10) break; // Limit issue reports
    }
  }

  // Check 5: Total node count
  if (allNodes.length < 250 || allNodes.length > 500) {
    issues.push(`Total node count ${allNodes.length} outside expected range (250-500)`);
  }

  const passed = issues.length === 0;

  // Summary
  console.log('\n  Summary:');
  console.log(`    Total nodes: ${allNodes.length}`);
  console.log(`    Regions processed: ${nodesByRegion.size}`);
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
    allNodes,
    nodesByRegion,
    passed,
    issues
  };
}
