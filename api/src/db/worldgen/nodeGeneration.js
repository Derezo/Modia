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

import { REGION_NODE_CONFIG } from './constants.js';
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
 * Assign node types to generated positions within a region
 * Uses distance from castle as proxy for ring assignment (graph distance computed in Phase 4)
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
  const keepCount = REGION_NODE_CONFIG.KEEP_COUNT;
  const guildCount = REGION_NODE_CONFIG.GUILD_COUNT;

  let citiesAssigned = 0;
  let villagesAssigned = 0;
  let keepAssigned = 0;
  let guildAssigned = 0;

  // Helper to pick battle terrain based on region configuration
  function pickBattleTerrain() {
    if (rng.next() < TERRAIN_DISTRIBUTION.DOMINANT_WEIGHT) {
      return region.dominantTerrain; // 70% dominant
    } else {
      return rng.pick(region.secondaryTerrains); // 30% secondary
    }
  }

  // Assign types based on distance bands
  for (const node of nodesWithDist) {
    if (node.nodeType) continue; // Skip already assigned (castle)

    const dist = node.distFromCastle;

    // Ring 0 (0-5): Battle nodes only (guards around castle)
    if (dist <= REGION_NODE_CONFIG.RING_0_MAX_DIST) {
      node.nodeType = pickBattleTerrain();
      continue;
    }

    // Ring 1 (5-12): Cities, Villages, Battle nodes
    if (dist <= REGION_NODE_CONFIG.RING_1_MAX_DIST) {
      // Cities in mid-ring (prioritize 6-10 distance)
      if (citiesAssigned < cityCount && dist >= 6 && dist <= 10 && rng.next() < 0.4) {
        node.nodeType = 'city';
        citiesAssigned++;
        continue;
      }
      // Villages
      if (villagesAssigned < villageCount / 2 && rng.next() < 0.3) {
        node.nodeType = 'village';
        villagesAssigned++;
        continue;
      }
      // Default: battle terrain
      node.nodeType = pickBattleTerrain();
      continue;
    }

    // Ring 2 (12-20): Keep, Guild, Villages, Battle nodes
    if (dist <= REGION_NODE_CONFIG.RING_2_MAX_DIST) {
      // Keep (place in 14-18 range)
      if (keepAssigned < keepCount && dist >= 14 && dist <= 18 && rng.next() < 0.25) {
        node.nodeType = 'keep';
        keepAssigned++;
        continue;
      }
      // Guild (place in 13-17 range)
      if (guildAssigned < guildCount && dist >= 13 && dist <= 17 && rng.next() < 0.25) {
        node.nodeType = 'guild';
        guildAssigned++;
        continue;
      }
      // Remaining villages
      if (villagesAssigned < villageCount && rng.next() < 0.25) {
        node.nodeType = 'village';
        villagesAssigned++;
        continue;
      }
      // Default: battle terrain
      node.nodeType = pickBattleTerrain();
      continue;
    }

    // Ring 3 (20+): Battle nodes, future terminators (converted in Phase 6)
    node.nodeType = pickBattleTerrain();
  }

  // Ensure required counts are met (pass 2 for any missing)
  // Cities
  const availableForCity = nodesWithDist.filter(n =>
    n.nodeType !== 'castle' && n.nodeType !== 'city' &&
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
    n.nodeType !== 'castle' && n.nodeType !== 'city' && n.nodeType !== 'keep' &&
    n.distFromCastle >= 12 && n.distFromCastle <= 20
  );
  while (keepAssigned < keepCount && availableForKeep.length > 0) {
    const idx = rng.nextInt(0, availableForKeep.length - 1);
    const node = availableForKeep.splice(idx, 1)[0];
    node.nodeType = 'keep';
    keepAssigned++;
  }

  // Guild
  const availableForGuild = nodesWithDist.filter(n =>
    n.nodeType !== 'castle' && n.nodeType !== 'city' && n.nodeType !== 'keep' && n.nodeType !== 'guild' &&
    n.distFromCastle >= 12 && n.distFromCastle <= 20
  );
  while (guildAssigned < guildCount && availableForGuild.length > 0) {
    const idx = rng.nextInt(0, availableForGuild.length - 1);
    const node = availableForGuild.splice(idx, 1)[0];
    node.nodeType = 'guild';
    guildAssigned++;
  }

  // Villages (fill to target)
  const availableForVillage = nodesWithDist.filter(n =>
    n.nodeType !== 'castle' && n.nodeType !== 'city' && n.nodeType !== 'keep' && n.nodeType !== 'guild' && n.nodeType !== 'village' &&
    n.distFromCastle >= 5 && n.distFromCastle <= 18
  );
  while (villagesAssigned < villageCount && availableForVillage.length > 0) {
    const idx = rng.nextInt(0, availableForVillage.length - 1);
    const node = availableForVillage.splice(idx, 1)[0];
    node.nodeType = 'village';
    villagesAssigned++;
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

    if (cities < 2 || cities > 3) {
      issues.push(`Region ${regionId} has ${cities} cities (expected 2-3)`);
    }
    if (keeps !== 1) {
      issues.push(`Region ${regionId} has ${keeps} keeps (expected 1)`);
    }
    if (guilds !== 1) {
      issues.push(`Region ${regionId} has ${guilds} guilds (expected 1)`);
    }
    if (villages < 6 || villages > 10) {
      issues.push(`Region ${regionId} has ${villages} villages (expected 6-10)`);
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
