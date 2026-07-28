/**
 * Voronoi Partitioning Module
 *
 * Phase 2 of the 6-phase regional world generation system.
 *
 * This module takes castle placements from Phase 1 and generates Voronoi regions:
 * - Cell polygons defining each region's boundary
 * - Edges that form borders between adjacent regions
 * - Vertices where 3+ regions meet (used for Grand Palace placement)
 *
 * The Voronoi diagram naturally partitions the world into 5 regions, with each
 * region's territory being the set of all points closer to its castle than any other.
 *
 * @module worldgen/voronoiPartitioning
 */

import { Delaunay } from 'd3-delaunay';
import { SeededRandom } from '../../config/constants.js';
import { VORONOI_CONFIG } from './constants.js';
import { generateCastlePlacements } from './castlePlacement.js';

/**
 * Create Voronoi regions from castle positions
 *
 * This function takes the castle placements from Phase 1 and generates:
 * 1. Cell polygons defining each region's boundary
 * 2. Edges that form borders between regions
 * 3. Vertices where 3+ regions meet (important for Grand Palace placement)
 *
 * @param {Array<{x: number, y: number, region: Object}>} castles - Castle positions from generateCastlePlacements
 * @returns {Object} Voronoi data structure:
 *   - delaunay: The Delaunay triangulation object
 *   - voronoi: The Voronoi diagram object
 *   - cells: Array of {regionIndex, polygon, centroid, area} for each region
 *   - edges: Array of {region1, region2, points, length} for each border
 *   - vertices: Array of {x, y, adjacentRegions} for each vertex point
 */
export function createVoronoiRegions(castles) {
  console.log('\nCreating Voronoi partitioning from castle positions...');

  if (!Array.isArray(castles) || castles.length === 0) {
    throw new Error('Voronoi partitioning requires at least one castle generator');
  }

  const identities = castles.map((castle, index) => {
    const regionId = castle?.regionId ?? castle?.region?.id;
    const castleKey = castle?.castleKey ?? (
      regionId == null ? null : `castle:${regionId}`
    );

    if (regionId == null || castleKey == null) {
      throw new Error(`Voronoi castle generator at index ${index} is missing castleKey/regionId`);
    }
    if (!Number.isFinite(castle?.x) || !Number.isFinite(castle?.y)) {
      throw new Error(
        `Voronoi castle generator ${castleKey} (regionId ${regionId}) has nonfinite coordinates`
      );
    }

    return { castleKey, regionId };
  });

  const duplicateCastleKeys = identities
    .map(({ castleKey }) => castleKey)
    .filter((castleKey, index, all) => all.indexOf(castleKey) !== index);
  const duplicateRegionIds = identities
    .map(({ regionId }) => regionId)
    .filter((regionId, index, all) => all.indexOf(regionId) !== index);
  if (duplicateCastleKeys.length > 0 || duplicateRegionIds.length > 0) {
    throw new Error(
      'Voronoi castle identities must be unique: ' +
      `duplicate castleKeys [${[...new Set(duplicateCastleKeys)].join(', ')}], ` +
      `duplicate regionIds [${[...new Set(duplicateRegionIds)].join(', ')}]`
    );
  }

  // Freeze the exact finalized values supplied by castle placement and use
  // this same coordinate set as the Delaunay/Voronoi generators.
  const generatorPoints = Object.freeze(
    castles.map(castle => Object.freeze([castle.x, castle.y]))
  );

  // Step 1: Create Delaunay triangulation
  const delaunay = Delaunay.from(generatorPoints);

  // Step 2: Generate Voronoi diagram with bounding box
  // The bounding box should be larger than the world to ensure all edges are finite
  const voronoi = delaunay.voronoi(VORONOI_CONFIG.WORLD_BOUNDS);

  // Step 3: Extract cell polygons for each region
  const cells = new Array(castles.length).fill(null);
  const cellsByRegion = new Map();
  const cellsByCastleKey = new Map();
  for (const { regionId, castleKey } of identities) {
    cellsByRegion.set(regionId, null);
    cellsByCastleKey.set(castleKey, null);
  }

  for (let i = 0; i < castles.length; i++) {
    const polygon = voronoi.cellPolygon(i);

    if (polygon) {
      // Calculate centroid and area for potential use in node distribution
      const { centroid, area } = calculatePolygonProperties(polygon);

      const cell = {
        regionIndex: i,
        regionId: identities[i].regionId,
        castleKey: identities[i].castleKey,
        region: castles[i].region,
        castle: Object.freeze({
          x: generatorPoints[i][0],
          y: generatorPoints[i][1]
        }),
        polygon: polygon,
        centroid: centroid,
        area: area
      };
      cells[i] = cell;
      cellsByRegion.set(cell.regionId, cell);
      cellsByCastleKey.set(cell.castleKey, cell);

      console.log(`  Region ${i + 1} (${castles[i].region.name}): area=${area.toFixed(1)}, centroid=(${centroid.x.toFixed(1)}, ${centroid.y.toFixed(1)})`);
    } else {
      console.warn(`  Warning: No polygon for region ${i} (${castles[i].region.name})`);
    }
  }

  const invalidCells = cells.flatMap((cell, index) => {
    const reasons = [];
    if (!cell) {
      reasons.push('missing polygon');
    } else {
      if (!Array.isArray(cell.polygon) || cell.polygon.length === 0) {
        reasons.push('empty polygon');
      } else if (cell.polygon.length < 4) {
        reasons.push(`degenerate polygon (${cell.polygon.length} points)`);
      } else if (cell.polygon.some(point =>
        !Array.isArray(point) ||
        !Number.isFinite(point[0]) ||
        !Number.isFinite(point[1])
      )) {
        reasons.push('nonfinite polygon coordinates');
      }
      if (!Number.isFinite(cell.area)) {
        reasons.push('nonfinite area');
      } else if (cell.area <= 0.001) {
        reasons.push(`degenerate area (${cell.area})`);
      }
      if (!Number.isFinite(cell.centroid?.x) || !Number.isFinite(cell.centroid?.y)) {
        reasons.push('nonfinite centroid');
      }
    }

    return reasons.length === 0
      ? []
      : [{
        index,
        castleKey: identities[index].castleKey,
        regionId: identities[index].regionId,
        reasons
      }];
  });

  if (invalidCells.length > 0) {
    const descriptions = invalidCells.map(invalid =>
      `${invalid.castleKey} (regionId ${invalid.regionId}, index ${invalid.index}): ` +
      invalid.reasons.join(', ')
    );
    const error = new Error(
      `Voronoi partitioning produced invalid cells for ${descriptions.join('; ')}`
    );
    error.code = 'INVALID_VORONOI_CELLS';
    error.invalidCells = invalidCells;
    error.cells = cells;
    error.cellsByRegion = cellsByRegion;
    error.cellsByCastleKey = cellsByCastleKey;
    throw error;
  }

  // Step 4: Extract edges (borders between regions)
  const edges = extractVoronoiEdges(voronoi, castles);
  console.log(`  Found ${edges.length} region border edges`);

  // Step 5: Extract vertices (points where 3+ regions meet)
  const vertices = extractVoronoiVertices(voronoi, castles);
  console.log(`  Found ${vertices.length} multi-region vertices`);

  return {
    delaunay,
    voronoi,
    generatorPoints,
    cells,
    cellsByRegion,
    cellsByCastleKey,
    edges,
    vertices
  };
}

/**
 * Calculate the centroid and area of a polygon
 * Uses the shoelace formula for area and centroid calculation
 *
 * @param {Array<[number, number]>} polygon - Array of [x, y] coordinates
 * @returns {{centroid: {x, y}, area: number}}
 */
export function calculatePolygonProperties(polygon) {
  let signedArea = 0;
  let cx = 0;
  let cy = 0;
  const n = polygon.length;

  for (let i = 0; i < n - 1; i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[i + 1];

    const cross = x1 * y2 - x2 * y1;
    signedArea += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }

  const area = Math.abs(signedArea / 2);

  // Avoid division by zero for degenerate polygons
  if (area > 0.001) {
    // Divide by 6 * signedArea (not absolute) to preserve sign for centroid
    const factor = 6 * signedArea / 2;
    cx = cx / factor;
    cy = cy / factor;
  } else {
    // Fallback: average of vertices
    cx = polygon.reduce((sum, p) => sum + p[0], 0) / n;
    cy = polygon.reduce((sum, p) => sum + p[1], 0) / n;
  }

  return {
    centroid: { x: cx, y: cy },
    area: area
  };
}

/**
 * Extract edges (borders) from the Voronoi diagram
 * Each edge represents the border between two adjacent regions
 *
 * @param {Object} voronoi - d3-delaunay Voronoi object
 * @param {Array} castles - Castle positions with region info
 * @returns {Array<{region1: number, region2: number, points: Array, length: number, midpoint: {x, y}}>}
 */
export function extractVoronoiEdges(voronoi, castles) {
  const edges = [];
  const edgeSet = new Set(); // Track unique edges

  // Iterate through each cell and find shared edges with neighbors
  for (let i = 0; i < castles.length; i++) {
    // Get neighbors of cell i
    const neighbors = [...voronoi.neighbors(i)];

    for (const j of neighbors) {
      // Create normalized edge key (smaller index first)
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;

      if (!edgeSet.has(key)) {
        edgeSet.add(key);

        // Find the shared edge points between cells i and j
        const edgePoints = findSharedEdge(voronoi, i, j);

        if (edgePoints && edgePoints.length >= 2) {
          // Calculate edge length
          const length = calculateEdgeLength(edgePoints);

          // Calculate midpoint for bridge placement
          const midpoint = calculateEdgeMidpoint(edgePoints);

          edges.push({
            region1: i,
            region2: j,
            region1Id: castles[i].regionId ?? castles[i].region.id,
            region2Id: castles[j].regionId ?? castles[j].region.id,
            castle1Key: castles[i].castleKey ?? `castle:${castles[i].region.id}`,
            castle2Key: castles[j].castleKey ?? `castle:${castles[j].region.id}`,
            region1Name: castles[i].region.name,
            region2Name: castles[j].region.name,
            points: edgePoints,
            length: length,
            midpoint: midpoint
          });
        }
      }
    }
  }

  return edges;
}

/**
 * Find the shared edge points between two Voronoi cells
 *
 * @param {Object} voronoi - d3-delaunay Voronoi object
 * @param {number} cellA - Index of first cell
 * @param {number} cellB - Index of second cell
 * @returns {Array<{x, y}>} Points along the shared edge
 */
export function findSharedEdge(voronoi, cellA, cellB) {
  const polyA = voronoi.cellPolygon(cellA);
  const polyB = voronoi.cellPolygon(cellB);

  if (!polyA || !polyB) return [];

  const sharedPoints = [];
  const tolerance = 0.001; // Floating point comparison tolerance

  // Find vertices that appear in both polygons
  for (let i = 0; i < polyA.length - 1; i++) { // -1 because last point duplicates first
    const [ax, ay] = polyA[i];

    for (let j = 0; j < polyB.length - 1; j++) {
      const [bx, by] = polyB[j];

      if (Math.abs(ax - bx) < tolerance && Math.abs(ay - by) < tolerance) {
        sharedPoints.push({ x: ax, y: ay });
        break;
      }
    }
  }

  return sharedPoints;
}

/**
 * Calculate the total length of an edge (sum of segments)
 *
 * @param {Array<{x, y}>} points - Edge points
 * @returns {number} Total length
 */
export function calculateEdgeLength(points) {
  if (points.length < 2) return 0;

  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    length += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }

  // For just 2 points, calculate direct distance
  if (points.length === 2) {
    length = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  }

  return length;
}

/**
 * Calculate the midpoint of an edge
 * For edges with >2 points, uses the middle point(s)
 *
 * @param {Array<{x, y}>} points - Edge points
 * @returns {{x, y}} Midpoint
 */
export function calculateEdgeMidpoint(points) {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { x: points[0].x, y: points[0].y };
  if (points.length === 2) {
    return {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2
    };
  }

  // For more points, return the middle one
  const midIndex = Math.floor(points.length / 2);
  return { x: points[midIndex].x, y: points[midIndex].y };
}

/**
 * Extract vertices from the Voronoi diagram
 * Vertices are points where 3 or more regions meet
 *
 * @param {Object} voronoi - d3-delaunay Voronoi object
 * @param {Array} castles - Castle positions with region info
 * @returns {Array<{x, y, adjacentRegions: number[], distanceFromCenter: number}>}
 */
export function extractVoronoiVertices(voronoi, castles) {
  const vertexMap = new Map(); // key: "x,y" -> Set of region indices

  // Collect all cell polygon vertices and track which regions they touch
  for (let i = 0; i < castles.length; i++) {
    const polygon = voronoi.cellPolygon(i);
    if (!polygon) continue;

    for (let j = 0; j < polygon.length - 1; j++) { // -1 to skip duplicate last point
      const [x, y] = polygon[j];

      // Quantize to avoid floating point issues
      const key = `${x.toFixed(3)},${y.toFixed(3)}`;

      if (!vertexMap.has(key)) {
        vertexMap.set(key, { x, y, regions: new Set() });
      }
      vertexMap.get(key).regions.add(i);
    }
  }

  // Filter to only vertices where 3+ regions meet
  const vertices = [];
  for (const [_key, data] of vertexMap) {
    if (data.regions.size >= 3) {
      const adjacentRegions = [...data.regions].sort((a, b) => a - b);
      const distanceFromCenter = Math.hypot(data.x, data.y);

      vertices.push({
        x: data.x,
        y: data.y,
        adjacentRegions: adjacentRegions,
        adjacentRegionIds: adjacentRegions.map(i => castles[i].regionId ?? castles[i].region.id),
        regionNames: adjacentRegions.map(i => castles[i].region.name),
        distanceFromCenter: distanceFromCenter
      });
    }
  }

  // Sort by number of adjacent regions (descending), then by distance from center (descending)
  vertices.sort((a, b) => {
    if (b.adjacentRegions.length !== a.adjacentRegions.length) {
      return b.adjacentRegions.length - a.adjacentRegions.length;
    }
    return b.distanceFromCenter - a.distanceFromCenter;
  });

  return vertices;
}

/**
 * Find the best position for the Grand Palace
 *
 * Priority order:
 * 1. Vertex where most regions meet (ideally 4-5)
 * 2. Among equal region counts, prefer vertex farthest from world center (0,0)
 * 3. Fall back to center if no suitable vertex found
 *
 * @param {Object} voronoiData - Output from createVoronoiRegions()
 * @param {Array} castles - Castle positions
 * @returns {{x: number, y: number, adjacentRegions: number[], reason: string}}
 */
function resolveFallbackPalaceAdjacency(point, castles) {
  const adjacent = castles
    .map((castle, index) => ({
      castle,
      index,
      distance: Math.hypot(point.x - castle.x, point.y - castle.y)
    }))
    .sort((left, right) =>
      left.distance - right.distance
      || String(left.castle.castleKey).localeCompare(String(right.castle.castleKey))
    )
    .slice(0, Math.min(2, castles.length));

  if (adjacent.length === 0 || adjacent.some(({ castle }) =>
    castle.regionId == null
    || !castle.castleKey
    || !castle.region?.name
  )) {
    throw new Error('Grand Palace fallback requires explicit castle and region identity');
  }
  return {
    adjacentRegions: adjacent.map(({ index }) => index),
    adjacentRegionIds: adjacent.map(({ castle }) => castle.regionId),
    regionNames: adjacent.map(({ castle }) => castle.region.name)
  };
}

export function findGrandPalacePosition(voronoiData, castles) {
  console.log('\nFinding Grand Palace position...');

  const { vertices } = voronoiData;

  if (vertices.length === 0) {
    // Fallback: place at the farthest point from all castles
    console.log('  No multi-region vertices found, using fallback position');
    const fallbackPos = findFarthestPointFromCastles(castles);
    const adjacency = resolveFallbackPalaceAdjacency(fallbackPos, castles);
    return {
      x: fallbackPos.x,
      y: fallbackPos.y,
      ...adjacency,
      reason: 'fallback_farthest_from_castles'
    };
  }

  // Vertices are already sorted by region count (desc) then distance from center (desc)
  const bestVertex = vertices[0];

  // Validate the position is not too close to any castle
  const minCastleDistance = Math.min(...castles.map(c =>
    Math.hypot(bestVertex.x - c.x, bestVertex.y - c.y)
  ));

  if (minCastleDistance < 10) {
    // Too close to a castle, try the next best vertex
    console.log(`  Best vertex too close to castle (${minCastleDistance.toFixed(1)}), checking alternatives...`);

    for (let i = 1; i < vertices.length; i++) {
      const candidate = vertices[i];
      const candidateMinDist = Math.min(...castles.map(c =>
        Math.hypot(candidate.x - c.x, candidate.y - c.y)
      ));

      if (candidateMinDist >= 10) {
        console.log(`  Selected vertex ${i}: (${candidate.x.toFixed(1)}, ${candidate.y.toFixed(1)})`);
        console.log(`    Adjacent regions: ${candidate.regionNames.join(', ')}`);
        console.log(`    Distance from center: ${candidate.distanceFromCenter.toFixed(1)}`);
        console.log(`    Min distance to castle: ${candidateMinDist.toFixed(1)}`);

        return {
          x: candidate.x,
          y: candidate.y,
          adjacentRegions: candidate.adjacentRegions,
          adjacentRegionIds: candidate.adjacentRegionIds,
          regionNames: candidate.regionNames,
          distanceFromCenter: candidate.distanceFromCenter,
          reason: 'vertex_multi_region_alternate'
        };
      }
    }

    // All vertices too close, use fallback
    console.log('  All vertices too close to castles, using fallback');
    const fallbackPos = findFarthestPointFromCastles(castles);
    const adjacency = resolveFallbackPalaceAdjacency(fallbackPos, castles);
    return {
      x: fallbackPos.x,
      y: fallbackPos.y,
      ...adjacency,
      reason: 'fallback_all_vertices_too_close'
    };
  }

  console.log(`  Selected best vertex: (${bestVertex.x.toFixed(1)}, ${bestVertex.y.toFixed(1)})`);
  console.log(`    Adjacent regions: ${bestVertex.regionNames.join(', ')}`);
  console.log(`    Distance from center: ${bestVertex.distanceFromCenter.toFixed(1)}`);
  console.log(`    Min distance to castle: ${minCastleDistance.toFixed(1)}`);

  return {
    x: bestVertex.x,
    y: bestVertex.y,
    adjacentRegions: bestVertex.adjacentRegions,
    adjacentRegionIds: bestVertex.adjacentRegionIds,
    regionNames: bestVertex.regionNames,
    distanceFromCenter: bestVertex.distanceFromCenter,
    reason: 'vertex_multi_region'
  };
}

/**
 * Find the point farthest from all castles (fallback for palace placement)
 * Samples points near the world boundary and selects the one farthest from any castle
 *
 * @param {Array} castles - Castle positions
 * @returns {{x: number, y: number}}
 */
export function findFarthestPointFromCastles(castles) {
  const boundary = VORONOI_CONFIG.WORLD_BOUNDS;
  const margin = 5; // Stay slightly inside the boundary

  let bestPoint = { x: 0, y: 0 };
  let bestMinDist = 0;

  // Sample points along the boundary
  const samples = [];
  const step = 5;

  // Top and bottom edges
  for (let x = boundary[0] + margin; x <= boundary[2] - margin; x += step) {
    samples.push({ x, y: boundary[1] + margin }); // Bottom
    samples.push({ x, y: boundary[3] - margin }); // Top
  }

  // Left and right edges
  for (let y = boundary[1] + margin; y <= boundary[3] - margin; y += step) {
    samples.push({ x: boundary[0] + margin, y }); // Left
    samples.push({ x: boundary[2] - margin, y }); // Right
  }

  // Also sample corners
  samples.push({ x: boundary[0] + margin, y: boundary[1] + margin });
  samples.push({ x: boundary[0] + margin, y: boundary[3] - margin });
  samples.push({ x: boundary[2] - margin, y: boundary[1] + margin });
  samples.push({ x: boundary[2] - margin, y: boundary[3] - margin });

  for (const point of samples) {
    const minDist = Math.min(...castles.map(c =>
      Math.hypot(point.x - c.x, point.y - c.y)
    ));

    if (minDist > bestMinDist) {
      bestMinDist = minDist;
      bestPoint = point;
    }
  }

  return bestPoint;
}

/**
 * Get border information between all pairs of adjacent regions
 * Useful for determining connection types (bridge, wilderness, trade route)
 *
 * @param {Object} voronoiData - Output from createVoronoiRegions()
 * @returns {Array<{region1: number, region2: number, edgeLength: number, midpoint: {x, y}, connectionType: string}>}
 */
export function getRegionBorders(voronoiData) {
  const { edges } = voronoiData;

  return edges.map(edge => {
    const requiredIdentityFields = [
      'region1Id',
      'region2Id',
      'castle1Key',
      'castle2Key',
      'region1Name',
      'region2Name'
    ];
    const missing = requiredIdentityFields.filter((field) =>
      edge[field] === undefined || edge[field] === null || edge[field] === ''
    );
    if (missing.length > 0) {
      throw new Error(
        `Voronoi border is missing explicit identity fields: ${missing.join(', ')}`
      );
    }

    // Determine connection type based on edge length
    // Short borders (< 10 units): Bridge chokepoint only
    // Medium borders (10-20 units): Bridge + wilderness zone
    // Long borders (20+ units): Bridge + wilderness + trade route
    let connectionType;
    if (edge.length < 10) {
      connectionType = 'bridge_only';
    } else if (edge.length < 20) {
      connectionType = 'bridge_wilderness';
    } else {
      connectionType = 'bridge_wilderness_trade';
    }

    return {
      region1: edge.region1,
      region2: edge.region2,
      region1Id: edge.region1Id,
      region2Id: edge.region2Id,
      castle1Key: edge.castle1Key,
      castle2Key: edge.castle2Key,
      region1Name: edge.region1Name,
      region2Name: edge.region2Name,
      edgeLength: edge.length,
      midpoint: edge.midpoint,
      points: edge.points,
      connectionType: connectionType
    };
  });
}

/**
 * Determine which region a point belongs to
 * Uses the Delaunay triangulation's find() method for O(log n) lookup
 *
 * @param {Object} voronoiData - Output from createVoronoiRegions()
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {number} Region index (0-4)
 */
export function findRegionForPoint(voronoiData, x, y) {
  return voronoiData.delaunay.find(x, y);
}

/**
 * Validation function to test Voronoi partitioning
 * Can be called directly to verify the algorithm works correctly
 *
 * @param {number} seed - Random seed for testing
 * @returns {Object} Validation results
 */
export function validateVoronoiPartitioning(seed = 12345) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('VORONOI PARTITIONING VALIDATION');
  console.log(`${'='.repeat(60)}`);
  console.log(`Testing with seed: ${seed}`);

  const rng = new SeededRandom(seed);
  const castles = generateCastlePlacements(rng);
  const voronoiData = createVoronoiRegions(castles);
  const palacePosition = findGrandPalacePosition(voronoiData, castles);
  const borders = getRegionBorders(voronoiData);

  // Validation checks
  const issues = [];

  // Check 1: All regions have valid polygons
  if (voronoiData.cells.length !== 5) {
    issues.push(`Expected 5 cells, got ${voronoiData.cells.length}`);
  }

  for (const cell of voronoiData.cells) {
    if (!cell.polygon || cell.polygon.length < 3) {
      issues.push(`Region ${cell.regionIndex} has invalid polygon`);
    }
    if (cell.area < 100) {
      issues.push(`Region ${cell.regionIndex} has very small area: ${cell.area.toFixed(1)}`);
    }
  }

  // Check 2: All regions have borders
  const regionsWithBorders = new Set();
  for (const border of borders) {
    regionsWithBorders.add(border.region1);
    regionsWithBorders.add(border.region2);
  }

  for (let i = 0; i < 5; i++) {
    if (!regionsWithBorders.has(i)) {
      issues.push(`Region ${i} has no borders (isolated)`);
    }
  }

  // Check 3: Palace position is valid
  if (palacePosition.reason.startsWith('fallback')) {
    issues.push(`Palace used fallback positioning: ${palacePosition.reason}`);
  }

  // Check 4: Test point-to-region lookup
  for (const castle of castles) {
    const regionIdx = findRegionForPoint(voronoiData, castle.x, castle.y);
    const expectedIdx = castles.indexOf(castle);
    if (regionIdx !== expectedIdx) {
      issues.push(`Castle at (${castle.x}, ${castle.y}) maps to region ${regionIdx}, expected ${expectedIdx}`);
    }
  }

  // Summary
  console.log('\n  Cells:');
  for (const cell of voronoiData.cells) {
    console.log(`    ${cell.region.name}: area=${cell.area.toFixed(0)}, vertices=${cell.polygon.length - 1}`);
  }

  console.log('\n  Borders:');
  for (const border of borders) {
    console.log(`    ${border.region1Name} <-> ${border.region2Name}: length=${border.edgeLength.toFixed(1)}, type=${border.connectionType}`);
  }

  console.log('\n  Vertices (3+ regions):');
  for (const vertex of voronoiData.vertices) {
    console.log(`    (${vertex.x.toFixed(1)}, ${vertex.y.toFixed(1)}): ${vertex.regionNames.join(', ')}`);
  }

  console.log('\n  Grand Palace:');
  console.log(`    Position: (${palacePosition.x.toFixed(1)}, ${palacePosition.y.toFixed(1)})`);
  console.log(`    Reason: ${palacePosition.reason}`);
  if (palacePosition.regionNames) {
    console.log(`    Adjacent regions: ${palacePosition.regionNames.join(', ')}`);
  }

  const passed = issues.length === 0;

  console.log('\n  Summary:');
  console.log(`    Total cells: ${voronoiData.cells.length}`);
  console.log(`    Total edges: ${voronoiData.edges.length}`);
  console.log(`    Multi-region vertices: ${voronoiData.vertices.length}`);
  console.log(`    Validation: ${passed ? 'PASSED' : 'FAILED'}`);

  if (!passed) {
    console.log('\n  Issues:');
    for (const issue of issues) {
      console.log(`    - ${issue}`);
    }
  }

  console.log(`${'='.repeat(60)}\n`);

  return {
    castles,
    voronoiData,
    palacePosition,
    borders,
    passed,
    issues
  };
}
