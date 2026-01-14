import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import pg from 'pg';
import { Delaunay } from 'd3-delaunay';
import { SeededRandom, CITY_OPTIONS, CASTLE_FEATURES, REGIONS, TERRAIN_DISTRIBUTION } from '../config/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../../.env') });

const { Pool } = pg;

// Increment this version when seed data changes significantly
// This allows dev-setup.sh to detect when re-seeding might be needed
const SEED_VERSION = 1;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'modia',
  user: process.env.DB_USER || 'modia',
  password: process.env.DB_PASSWORD || '',
});

const NODE_NAME_PREFIXES = {
  city: ['New', 'Old', 'Port', 'Fort', 'North', 'South', 'East', 'West'],
  village: ['Little', 'Green', 'Quiet', 'Sunny', 'Misty', 'Hidden'],
  forest: ['Dark', 'Ancient', 'Whispering', 'Emerald', 'Twisted', 'Silent'],
  cave: ['Crystal', 'Shadow', 'Echo', 'Deep', 'Forgotten', 'Frost'],
  mountain: ['Storm', 'Iron', 'Snow', 'Thunder', 'Sky', 'Fire'],
  bridge: ['Stone', 'Hanging', 'Old', 'Broken', 'King\'s', 'Troll'],
  guild: ['Warriors\'', 'Wizards\'', 'Monks\'', 'Chemists\''],
  chest: ['Hidden', 'Ancient', 'Lost', 'Forgotten', 'Buried', 'Legendary'],
  shrine: ['Sacred', 'Ancient', 'Mystic', 'Holy', 'Blessed', 'Divine'],
  discovery: ['Ruined', 'Ancient', 'Lost', 'Forgotten', 'Mysterious', 'Legendary']
};

const NODE_NAME_SUFFIXES = {
  city: ['Haven', 'Gate', 'Hold', 'Watch', 'Keep', 'Port'],
  village: ['Hollow', 'Dell', 'Crossing', 'Rest', 'Vale', 'Hamlet'],
  forest: ['Woods', 'Grove', 'Thicket', 'Wilds', 'Depths', 'Glade'],
  cave: ['Caverns', 'Grotto', 'Depths', 'Tunnels', 'Lair', 'Mine'],
  mountain: ['Peak', 'Summit', 'Crag', 'Ridge', 'Heights', 'Pass'],
  bridge: ['Crossing', 'Pass', 'Span', 'Way', 'Arch', 'Ford'],
  guild: ['Hall', 'Sanctum', 'Lodge', 'Academy', 'Tower', 'Keep'],
  chest: ['Trove', 'Cache', 'Hoard', 'Vault', 'Treasury', 'Bounty'],
  shrine: ['Altar', 'Sanctum', 'Temple', 'Monument', 'Obelisk', 'Pillar'],
  discovery: ['Ruins', 'Monument', 'Archive', 'Relic', 'Artifact', 'Mystery']
};

const PALACE_FEATURES = ['throne_room', 'treasury', 'royal_guard'];

// Connection count constraints for world generation
const MIN_CONNECTIONS = {
  castle: 5,
  city: 3,
  village: 2,
  guild: 2,
  forest: 2,
  cave: 2,
  mountain: 2,
  bridge: 2,
  // Terminator nodes have exactly 1 connection
  chest: 1,
  shrine: 1,
  discovery: 1
};

const MAX_CONNECTIONS = {
  bridge: 2,  // Bridges act as chokepoints with exactly 2 connections
  // Terminator nodes are dead ends
  chest: 1,
  shrine: 1,
  discovery: 1
};

// Terminator node types for edge detection (used in assignTerminatorNodes)
const _TERMINATOR_TYPES = ['chest', 'shrine', 'discovery'];

// Obstacle types for terrain barriers
const OBSTACLE_TYPES = {
  LAKE: 'lake',
  MOUNTAIN_RANGE: 'mountain_range',
  DENSE_FOREST: 'dense_forest'
};

/**
 * Validate if two node types can be connected
 * Prevents same-type settlement adjacency
 */
function isValidConnection(type1, type2) {
  const settlements = ['city', 'village', 'castle', 'guild'];

  // Same-type settlements cannot be adjacent
  if (type1 === type2 && settlements.includes(type1)) {
    return false;
  }

  // Castle-city adjacency is also discouraged (too similar in importance)
  if ((type1 === 'castle' && type2 === 'city') ||
      (type1 === 'city' && type2 === 'castle')) {
    return false;
  }

  return true;
}

// ============================================================================
// CASTLE PLACEMENT ALGORITHM (Phase 1 of 5-Region World Generation)
// ============================================================================

/**
 * Constants for castle placement algorithm
 */
const CASTLE_PLACEMENT = {
  MIN_DISTANCE: 25,           // Minimum distance between any two castles
  POSITION_RANGE: 30,         // Castles spawn in [-30, 30] range
  FORCE_MAX_ITERATIONS: 500,  // Max iterations for force-directed simulation
  FORCE_REPULSION: 3.0,       // Repulsion force strength multiplier
  FORCE_DAMPING: 0.95,        // Velocity damping to prevent oscillation
  LLOYD_ITERATIONS: 3,        // Number of Lloyd's relaxation iterations
  LLOYD_STRENGTH: 0.2,        // How strongly points move toward centroid (0-1)
  BOUNDARY_PADDING: 2         // Keep castles this far from edge
};

/**
 * Calculate Euclidean distance between two points
 * @param {Object} a - Point with x, y coordinates
 * @param {Object} b - Point with x, y coordinates
 * @returns {number} Distance between points
 */
function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Find the minimum distance between any two positions in an array
 * @param {Array<{x: number, y: number}>} positions - Array of positions
 * @returns {number} Minimum distance between any pair
 */
function findMinimumPairDistance(positions) {
  let minDist = Infinity;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dist = distanceBetween(positions[i], positions[j]);
      if (dist < minDist) {
        minDist = dist;
      }
    }
  }
  return minDist;
}

/**
 * Clamp a position to stay within bounds
 * @param {number} value - Coordinate value
 * @param {number} range - Max absolute value (e.g., 30 means [-30, 30])
 * @param {number} padding - Distance from edge to maintain
 * @returns {number} Clamped value
 */
function clampToBounds(value, range, padding) {
  const limit = range - padding;
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * Force-directed simulation - pushes castles apart until minimum distance achieved
 * Uses repulsion forces similar to charged particles with boundary repulsion
 *
 * @param {Array<{x: number, y: number}>} positions - Initial castle positions
 * @param {number} minDistance - Minimum required distance between castles
 * @param {number} maxIterations - Maximum iterations before giving up
 * @returns {Array<{x: number, y: number}>} Updated positions
 */
function applyForceDirectedRepulsion(positions, minDistance = CASTLE_PLACEMENT.MIN_DISTANCE, maxIterations = CASTLE_PLACEMENT.FORCE_MAX_ITERATIONS) {
  // Deep copy to avoid mutating input
  const pos = positions.map(p => ({ x: p.x, y: p.y }));
  const n = pos.length;
  const range = CASTLE_PLACEMENT.POSITION_RANGE;
  const padding = CASTLE_PLACEMENT.BOUNDARY_PADDING;

  // Track velocities for smoother movement
  const velocities = pos.map(() => ({ x: 0, y: 0 }));

  for (let iter = 0; iter < maxIterations; iter++) {
    // Check if we've achieved minimum distance
    const currentMinDist = findMinimumPairDistance(pos);
    if (currentMinDist >= minDistance) {
      console.log(`  Force-directed: converged after ${iter} iterations (min dist: ${currentMinDist.toFixed(2)})`);
      return pos;
    }

    // Calculate forces for each position
    const forces = pos.map(() => ({ x: 0, y: 0 }));

    for (let i = 0; i < n; i++) {
      // Inter-castle repulsion
      for (let j = i + 1; j < n; j++) {
        const dx = pos[j].x - pos[i].x;
        const dy = pos[j].y - pos[i].y;
        const dist = Math.hypot(dx, dy);

        // Only apply repulsion if too close
        if (dist < minDistance && dist > 0.001) {
          // Repulsion force inversely proportional to distance squared
          // Stronger when closer, prevents overlap
          const gap = minDistance - dist;
          const forceMagnitude = CASTLE_PLACEMENT.FORCE_REPULSION * (gap / minDistance) * (gap / dist);

          // Normalize direction and apply force
          const fx = (dx / dist) * forceMagnitude;
          const fy = (dy / dist) * forceMagnitude;

          // Apply equal and opposite forces
          forces[i].x -= fx;
          forces[i].y -= fy;
          forces[j].x += fx;
          forces[j].y += fy;
        }
      }

      // Boundary repulsion - push away from edges
      const limit = range - padding;
      const boundaryForce = 1.0;

      // Left/right boundaries
      if (pos[i].x < -limit + 5) {
        forces[i].x += boundaryForce * ((-limit + 5) - pos[i].x);
      } else if (pos[i].x > limit - 5) {
        forces[i].x -= boundaryForce * (pos[i].x - (limit - 5));
      }

      // Top/bottom boundaries
      if (pos[i].y < -limit + 5) {
        forces[i].y += boundaryForce * ((-limit + 5) - pos[i].y);
      } else if (pos[i].y > limit - 5) {
        forces[i].y -= boundaryForce * (pos[i].y - (limit - 5));
      }
    }

    // Apply forces with velocity damping for stability
    for (let i = 0; i < n; i++) {
      // Update velocity with damping
      velocities[i].x = (velocities[i].x + forces[i].x) * CASTLE_PLACEMENT.FORCE_DAMPING;
      velocities[i].y = (velocities[i].y + forces[i].y) * CASTLE_PLACEMENT.FORCE_DAMPING;

      // Apply velocity to position
      pos[i].x = clampToBounds(pos[i].x + velocities[i].x, range, padding);
      pos[i].y = clampToBounds(pos[i].y + velocities[i].y, range, padding);
    }
  }

  console.log(`  Force-directed: max iterations reached (min dist: ${findMinimumPairDistance(pos).toFixed(2)})`);
  return pos;
}

/**
 * Lloyd's relaxation - moves points toward more even distribution
 * Approximates Voronoi-based relaxation by moving points toward the centroid
 * of their nearest neighbors, promoting even spacing
 *
 * @param {Array<{x: number, y: number}>} positions - Castle positions
 * @param {number} iterations - Number of relaxation iterations
 * @returns {Array<{x: number, y: number}>} Relaxed positions
 */
function applyLloydsRelaxation(positions, iterations = CASTLE_PLACEMENT.LLOYD_ITERATIONS) {
  // Deep copy to avoid mutating input
  let pos = positions.map(p => ({ x: p.x, y: p.y }));
  const n = pos.length;

  for (let iter = 0; iter < iterations; iter++) {
    const newPos = [];

    for (let i = 0; i < n; i++) {
      // Find the centroid of all other points (simplified Lloyd's)
      // In true Lloyd's, we'd use Voronoi cells, but for 5 points
      // we can approximate by moving slightly toward the global centroid
      // while being repelled by nearby points

      // Calculate centroid of all points
      let cx = 0, cy = 0;
      for (let j = 0; j < n; j++) {
        cx += pos[j].x;
        cy += pos[j].y;
      }
      cx /= n;
      cy /= n;

      // Move point slightly away from centroid to promote spread
      // This is the opposite of traditional Lloyd's, but works better
      // for spreading points evenly across the map
      const dx = pos[i].x - cx;
      const dy = pos[i].y - cy;
      const distFromCenter = Math.hypot(dx, dy);

      // Calculate target position: move away from centroid
      // but not too far (balanced by LLOYD_STRENGTH)
      let newX, newY;
      if (distFromCenter > 0.001) {
        // Normalize and push outward
        const targetDist = distFromCenter + CASTLE_PLACEMENT.LLOYD_STRENGTH * 5;
        newX = cx + (dx / distFromCenter) * targetDist;
        newY = cy + (dy / distFromCenter) * targetDist;
      } else {
        // Point is at centroid, push it in a random direction
        // Use position index for determinism
        const angle = (i / n) * Math.PI * 2;
        newX = pos[i].x + Math.cos(angle) * 5;
        newY = pos[i].y + Math.sin(angle) * 5;
      }

      // Blend between old and new position
      newPos.push({
        x: clampToBounds(
          pos[i].x + (newX - pos[i].x) * CASTLE_PLACEMENT.LLOYD_STRENGTH,
          CASTLE_PLACEMENT.POSITION_RANGE,
          CASTLE_PLACEMENT.BOUNDARY_PADDING
        ),
        y: clampToBounds(
          pos[i].y + (newY - pos[i].y) * CASTLE_PLACEMENT.LLOYD_STRENGTH,
          CASTLE_PLACEMENT.POSITION_RANGE,
          CASTLE_PLACEMENT.BOUNDARY_PADDING
        )
      });
    }

    pos = newPos;
  }

  console.log(`  Lloyd's relaxation: ${iterations} iterations complete`);
  return pos;
}

/**
 * Generate initial castle positions using force-directed placement
 *
 * Algorithm:
 * 1. Generate 5 random positions in [-30, 30] range
 * 2. Apply force-directed repulsion until min distance 25 achieved between all pairs
 * 3. Apply Lloyd's relaxation (3 iterations) for even spread
 * 4. Apply final force-directed pass to enforce minimum distance constraint
 * 5. Shuffle REGIONS and assign to positions (seeded for determinism)
 *
 * @param {SeededRandom} rng - Seeded random number generator
 * @returns {Array<{x: number, y: number, region: Object}>} Castle positions with assigned regions
 */
function generateCastlePlacements(rng) {
  console.log('\nGenerating castle placements for 5 regions...');

  const regionList = Object.values(REGIONS);
  const numCastles = regionList.length; // 5

  // Step 1: Generate initial random positions
  console.log('  Step 1: Generating initial random positions...');
  let positions = [];
  for (let i = 0; i < numCastles; i++) {
    positions.push({
      x: rng.nextInt(-CASTLE_PLACEMENT.POSITION_RANGE, CASTLE_PLACEMENT.POSITION_RANGE),
      y: rng.nextInt(-CASTLE_PLACEMENT.POSITION_RANGE, CASTLE_PLACEMENT.POSITION_RANGE)
    });
  }

  const initialMinDist = findMinimumPairDistance(positions);
  console.log(`  Initial positions: min distance = ${initialMinDist.toFixed(2)}`);

  // Step 2: Apply force-directed repulsion
  console.log('  Step 2: Applying force-directed repulsion...');
  positions = applyForceDirectedRepulsion(positions, CASTLE_PLACEMENT.MIN_DISTANCE, CASTLE_PLACEMENT.FORCE_MAX_ITERATIONS);

  const postForceDist = findMinimumPairDistance(positions);
  console.log(`  Post-force positions: min distance = ${postForceDist.toFixed(2)}`);

  // Step 3: Apply Lloyd's relaxation for even spread
  console.log('  Step 3: Applying Lloyd\'s relaxation...');
  positions = applyLloydsRelaxation(positions, CASTLE_PLACEMENT.LLOYD_ITERATIONS);

  const postLloydDist = findMinimumPairDistance(positions);
  console.log(`  Post-Lloyd positions: min distance = ${postLloydDist.toFixed(2)}`);

  // Step 4: Final force-directed pass to enforce minimum distance
  // Lloyd's may have moved some castles closer together
  console.log('  Step 4: Final constraint enforcement...');
  positions = applyForceDirectedRepulsion(positions, CASTLE_PLACEMENT.MIN_DISTANCE, CASTLE_PLACEMENT.FORCE_MAX_ITERATIONS);

  const finalMinDist = findMinimumPairDistance(positions);
  console.log(`  Final positions: min distance = ${finalMinDist.toFixed(2)}`);

  // Step 5: Shuffle regions and assign to positions
  console.log('  Step 5: Assigning regions to positions...');
  const shuffledRegions = rng.shuffle([...regionList]);

  const castles = positions.map((pos, i) => ({
    x: Math.round(pos.x * 10) / 10, // Round to 1 decimal place
    y: Math.round(pos.y * 10) / 10,
    region: shuffledRegions[i]
  }));

  // Log castle placements
  console.log('\n  Castle placements:');
  for (const castle of castles) {
    console.log(`    ${castle.region.castleName} (${castle.region.name}): (${castle.x}, ${castle.y})`);
  }

  // Validation check
  if (finalMinDist < CASTLE_PLACEMENT.MIN_DISTANCE) {
    console.warn(`  WARNING: Minimum distance ${finalMinDist.toFixed(2)} is below target ${CASTLE_PLACEMENT.MIN_DISTANCE}`);
  }

  return castles;
}

/**
 * Validation function to test castle placement algorithm
 * Can be called directly to verify the algorithm works correctly
 *
 * @param {number} seed - Random seed for testing
 * @returns {Object} Validation results
 */
function validateCastlePlacement(seed = 12345) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('CASTLE PLACEMENT VALIDATION');
  console.log(`${'='.repeat(60)}`);
  console.log(`Testing with seed: ${seed}`);

  const rng = new SeededRandom(seed);
  const castles = generateCastlePlacements(rng);

  // Calculate all pairwise distances
  const distances = [];
  for (let i = 0; i < castles.length; i++) {
    for (let j = i + 1; j < castles.length; j++) {
      const dist = distanceBetween(castles[i], castles[j]);
      distances.push({
        from: castles[i].region.name,
        to: castles[j].region.name,
        distance: dist
      });
    }
  }

  // Sort by distance
  distances.sort((a, b) => a.distance - b.distance);

  console.log('\n  Pairwise distances (sorted):');
  for (const d of distances) {
    const status = d.distance >= CASTLE_PLACEMENT.MIN_DISTANCE ? 'OK' : 'FAIL';
    console.log(`    ${d.from} <-> ${d.to}: ${d.distance.toFixed(2)} [${status}]`);
  }

  const minDist = distances[0].distance;
  const maxDist = distances[distances.length - 1].distance;
  const avgDist = distances.reduce((sum, d) => sum + d.distance, 0) / distances.length;

  const passed = minDist >= CASTLE_PLACEMENT.MIN_DISTANCE;

  console.log('\n  Summary:');
  console.log(`    Minimum distance: ${minDist.toFixed(2)} (required: ${CASTLE_PLACEMENT.MIN_DISTANCE})`);
  console.log(`    Maximum distance: ${maxDist.toFixed(2)}`);
  console.log(`    Average distance: ${avgDist.toFixed(2)}`);
  console.log(`    Validation: ${passed ? 'PASSED' : 'FAILED'}`);
  console.log(`${'='.repeat(60)}\n`);

  return {
    castles,
    distances,
    minDist,
    maxDist,
    avgDist,
    passed
  };
}

// Export validation function for testing (can be imported and called directly)
export { generateCastlePlacements, applyForceDirectedRepulsion, applyLloydsRelaxation, validateCastlePlacement, CASTLE_PLACEMENT };

// ============================================================================
// END CASTLE PLACEMENT ALGORITHM
// ============================================================================

// ============================================================================
// VORONOI PARTITIONING (Phase 2 of 5-Region World Generation)
// ============================================================================

/**
 * Constants for Voronoi generation
 */
const VORONOI_CONFIG = {
  WORLD_BOUNDS: [-50, -50, 50, 50],  // [xMin, yMin, xMax, yMax] - larger than castle range
  MIN_VERTEX_DISTANCE: 5,            // Minimum distance between vertices
  CENTER_THRESHOLD: 5                // Distance from center to consider as "center"
};

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
function createVoronoiRegions(castles) {
  console.log('\nCreating Voronoi partitioning from castle positions...');

  // Convert castle positions to flat array for d3-delaunay
  const points = castles.map(c => [c.x, c.y]);

  // Step 1: Create Delaunay triangulation
  const delaunay = Delaunay.from(points);

  // Step 2: Generate Voronoi diagram with bounding box
  // The bounding box should be larger than the world to ensure all edges are finite
  const voronoi = delaunay.voronoi(VORONOI_CONFIG.WORLD_BOUNDS);

  // Step 3: Extract cell polygons for each region
  const cells = [];
  for (let i = 0; i < castles.length; i++) {
    const polygon = voronoi.cellPolygon(i);

    if (polygon) {
      // Calculate centroid and area for potential use in node distribution
      const { centroid, area } = calculatePolygonProperties(polygon);

      cells.push({
        regionIndex: i,
        region: castles[i].region,
        castle: { x: castles[i].x, y: castles[i].y },
        polygon: polygon,
        centroid: centroid,
        area: area
      });

      console.log(`  Region ${i + 1} (${castles[i].region.name}): area=${area.toFixed(1)}, centroid=(${centroid.x.toFixed(1)}, ${centroid.y.toFixed(1)})`);
    } else {
      console.warn(`  Warning: No polygon for region ${i} (${castles[i].region.name})`);
    }
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
    cells,
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
function calculatePolygonProperties(polygon) {
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
function extractVoronoiEdges(voronoi, castles) {
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
function findSharedEdge(voronoi, cellA, cellB) {
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
function calculateEdgeLength(points) {
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
function calculateEdgeMidpoint(points) {
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
function extractVoronoiVertices(voronoi, castles) {
  const vertexMap = new Map(); // key: "x,y" -> Set of region indices
  const tolerance = 0.001;

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
  for (const [key, data] of vertexMap) {
    if (data.regions.size >= 3) {
      const adjacentRegions = [...data.regions].sort((a, b) => a - b);
      const distanceFromCenter = Math.hypot(data.x, data.y);

      vertices.push({
        x: data.x,
        y: data.y,
        adjacentRegions: adjacentRegions,
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
function findGrandPalacePosition(voronoiData, castles) {
  console.log('\nFinding Grand Palace position...');

  const { vertices } = voronoiData;

  if (vertices.length === 0) {
    // Fallback: place at the farthest point from all castles
    console.log('  No multi-region vertices found, using fallback position');
    const fallbackPos = findFarthestPointFromCastles(castles);
    return {
      x: fallbackPos.x,
      y: fallbackPos.y,
      adjacentRegions: [],
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
          regionNames: candidate.regionNames,
          distanceFromCenter: candidate.distanceFromCenter,
          reason: 'vertex_multi_region_alternate'
        };
      }
    }

    // All vertices too close, use fallback
    console.log('  All vertices too close to castles, using fallback');
    const fallbackPos = findFarthestPointFromCastles(castles);
    return {
      x: fallbackPos.x,
      y: fallbackPos.y,
      adjacentRegions: [],
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
function findFarthestPointFromCastles(castles) {
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
function getRegionBorders(voronoiData) {
  const { edges } = voronoiData;

  return edges.map(edge => {
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
function findRegionForPoint(voronoiData, x, y) {
  return voronoiData.delaunay.find(x, y);
}

/**
 * Validation function to test Voronoi partitioning
 * Can be called directly to verify the algorithm works correctly
 *
 * @param {number} seed - Random seed for testing
 * @returns {Object} Validation results
 */
function validateVoronoiPartitioning(seed = 12345) {
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

// Export Voronoi functions for testing
export {
  createVoronoiRegions,
  findGrandPalacePosition,
  getRegionBorders,
  findRegionForPoint,
  validateVoronoiPartitioning,
  VORONOI_CONFIG
};

// ============================================================================
// END VORONOI PARTITIONING
// ============================================================================

// ============================================================================
// INTERNAL NODE GENERATION (Phase 3 of 5-Region World Generation)
// ============================================================================

/**
 * Constants for region node generation
 */
const REGION_NODE_CONFIG = {
  MIN_SPACING: 3.5,                    // Minimum distance between nodes (Poisson disk)
  TARGET_NODES_PER_REGION: 70,         // Target ~60-80 nodes per region
  MAX_POISSON_ATTEMPTS: 30,            // Attempts per active point in Poisson disk
  CITY_COUNT_MIN: 2,
  CITY_COUNT_MAX: 3,
  VILLAGE_COUNT_MIN: 6,
  VILLAGE_COUNT_MAX: 10,
  KEEP_COUNT: 1,
  GUILD_COUNT: 1,
  // Distance bands from castle (Euclidean proxy for ring assignment)
  RING_0_MAX_DIST: 5,                  // Guard battle nodes only
  RING_1_MAX_DIST: 12,                 // Cities, villages
  RING_2_MAX_DIST: 20,                 // Keep, guild, villages, battle
  // Beyond RING_2: Ring 3 - battle nodes, future terminators
};

/**
 * Check if a point is inside a polygon using ray casting algorithm
 *
 * @param {number} x - X coordinate of point
 * @param {number} y - Y coordinate of point
 * @param {Array<[number, number]>} polygon - Array of [x, y] vertices (closed polygon)
 * @returns {boolean} True if point is inside polygon
 */
function isPointInPolygon(x, y, polygon) {
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
function getPolygonBoundingBox(polygon) {
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
function poissonDiskSampleInPolygon(polygon, minDistance, rng, targetCount, startPoint) {
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
function assignRegionNodeTypes(positions, castle, region, rng) {
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
function generateRegionNodes(region, cellPolygon, castle, rng) {
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
function generateAllRegionNodes(castles, voronoiData, rng) {
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
function validateRegionNodeGeneration(seed = 12345) {
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

// Export Phase 3 functions for testing
export {
  isPointInPolygon,
  poissonDiskSampleInPolygon,
  assignRegionNodeTypes,
  generateRegionNodes,
  generateAllRegionNodes,
  validateRegionNodeGeneration,
  REGION_NODE_CONFIG
};

// ============================================================================
// END INTERNAL NODE GENERATION
// ============================================================================

// ============================================================================
// INTERNAL CONNECTIONS (Phase 4 of 5-Region World Generation)
// ============================================================================

/**
 * Constants for internal connection generation
 */
const CONNECTION_CONFIG = {
  EXTRA_CONNECTION_RATIO: 0.20,        // 20% extra connections beyond MST
  MAX_CONNECTION_DISTANCE: 12,         // Maximum edge distance for extra connections
  INVALID_PENALTY: 10000,              // Cost multiplier for invalid connections in MST
  RING_THRESHOLDS: {
    RING_1: 2,                         // 1-2 hops from castle = Ring 1
    RING_2: 5,                         // 3-5 hops from castle = Ring 2
    // 6+ hops = Ring 3
  }
};

/**
 * Check if a node type is a settlement type
 * Settlements cannot connect directly to other settlements
 *
 * @param {string} nodeType - Node type to check
 * @returns {boolean} True if settlement type
 */
function isSettlement(nodeType) {
  return ['castle', 'city', 'village', 'guild', 'keep', 'palace'].includes(nodeType);
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
function isValidAdjacency(type1, type2) {
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
function buildRegionMST(nodes, castleIndex) {
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
function addExtraConnections(nodes, mstConnections, rng, extraRatio = CONNECTION_CONFIG.EXTRA_CONNECTION_RATIO) {
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
function calculateRingDistances(nodes, connections, castleIndex) {
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
function enforceAdjacencyRules(nodes, connections) {
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
function ensureMinimumConnections(nodes, connections, rng) {
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
    const maxConn = MAX_CONNECTIONS[node.nodeType];

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
 * Orchestrates MST building, extra connections, and ring distance calculation
 *
 * @param {Array<Object>} regionNodes - Nodes in this region (from Phase 3)
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {Object} Result containing connections and updated nodes
 */
function generateRegionConnections(regionNodes, rng) {
  // Find the castle node index
  const castleIndex = regionNodes.findIndex(n => n.nodeType === 'castle');
  if (castleIndex === -1) {
    console.error('  ERROR: No castle found in region!');
    return { connections: [], nodes: regionNodes };
  }

  const regionName = regionNodes[0]?.regionName || 'Unknown';
  console.log(`  Processing connections for ${regionName} (${regionNodes.length} nodes)...`);

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

  // Step 5: Calculate ring distances using BFS from castle
  calculateRingDistances(regionNodes, allConnections, castleIndex);

  // Count ring distribution
  const ringCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const node of regionNodes) {
    ringCounts[node.ringDistance] = (ringCounts[node.ringDistance] || 0) + 1;
  }
  console.log(`    Ring distribution: R0=${ringCounts[0]}, R1=${ringCounts[1]}, R2=${ringCounts[2]}, R3=${ringCounts[3]}`);

  return {
    connections: allConnections,
    nodes: regionNodes
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
 *   - nodesByRegion: Updated nodesByRegion with ring distances
 */
function generateAllRegionConnections(nodeData, rng) {
  console.log('\n========================================');
  console.log('PHASE 4: Internal Connections');
  console.log('========================================');

  const allConnections = [];
  const connectionsByRegion = new Map();
  const { nodesByRegion } = nodeData;

  let totalConnections = 0;

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
  }

  console.log(`\nPhase 4 Complete: Generated ${totalConnections} total connections across ${nodesByRegion.size} regions`);

  // Summary statistics
  let totalRing0 = 0, totalRing1 = 0, totalRing2 = 0, totalRing3 = 0;
  for (const [_regionId, nodes] of nodesByRegion) {
    for (const node of nodes) {
      if (node.ringDistance === 0) totalRing0++;
      else if (node.ringDistance === 1) totalRing1++;
      else if (node.ringDistance === 2) totalRing2++;
      else totalRing3++;
    }
  }
  console.log(`Global ring distribution: R0=${totalRing0}, R1=${totalRing1}, R2=${totalRing2}, R3=${totalRing3}`);

  return {
    allConnections,
    connectionsByRegion,
    nodesByRegion
  };
}

/**
 * Validation function for Phase 4: Internal Connections
 *
 * @param {number} seed - Random seed for testing
 * @returns {Object} Validation results
 */
function validateRegionConnections(seed = 12345) {
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

// Export Phase 4 functions for testing
export {
  isSettlement,
  isValidAdjacency,
  buildRegionMST,
  addExtraConnections,
  calculateRingDistances,
  enforceAdjacencyRules,
  ensureMinimumConnections,
  generateRegionConnections,
  generateAllRegionConnections,
  validateRegionConnections,
  CONNECTION_CONFIG
};

// ============================================================================
// END INTERNAL CONNECTIONS
// ============================================================================

// ============================================================================
// INTER-REGION CONNECTIONS (Phase 5 of 5-Region World Generation)
// ============================================================================

/**
 * Constants for inter-region connection generation
 */
const INTER_REGION_CONFIG = {
  // Border length thresholds for connection type determination
  BORDER_SHORT_THRESHOLD: 10,          // < 10 = bridge only
  BORDER_MEDIUM_THRESHOLD: 20,         // 10-20 = bridge + wilderness
  // >= 20 = bridge + wilderness + trade route

  // Wilderness zone settings
  WILDERNESS_MIN_NODES: 2,
  WILDERNESS_MAX_NODES: 4,
  WILDERNESS_SPACING: 4.0,             // Distance between wilderness nodes
  WILDERNESS_DIFFICULTY_BONUS: 1,      // Higher difficulty tier for border conflicts

  // Trade route settings
  TRADE_ROUTE_MIN_NODES: 3,
  TRADE_ROUTE_MAX_NODES: 5,
  TRADE_ROUTE_DIFFICULTY_REDUCTION: 1, // Lower difficulty for trade routes

  // Node connection settings
  MAX_FRONTIER_SEARCH_DIST: 15,        // Max distance to search for frontier nodes
};

/**
 * Thematic bridge names based on region pairs
 * Keys are sorted region names joined with '-'
 */
const BRIDGE_NAMES = {
  'Bloodplains-Heartlands': ['Border Crossing', 'War\'s End Bridge', 'Truce Span'],
  'Bloodplains-Iron Depths': ['Forge Pass', 'Iron Bridge', 'Anvil Crossing'],
  'Bloodplains-Shadowmere': ['Blood Moon Bridge', 'Crimson Crossing', 'Dusk Span'],
  'Bloodplains-Sylvan Reaches': ['Wildwood Bridge', 'Thorn Crossing', 'Hunter\'s Pass'],
  'Heartlands-Iron Depths': ['Deep Road Bridge', 'Mine Gate', 'Merchant\'s Crossing'],
  'Heartlands-Shadowmere': ['Twilight Bridge', 'Shadow\'s Edge', 'Dawn Crossing'],
  'Heartlands-Sylvan Reaches': ['Woodland Bridge', 'Green Gate', 'Forest Crossing'],
  'Iron Depths-Shadowmere': ['Darkmine Bridge', 'Hollow Crossing', 'Echo Pass'],
  'Iron Depths-Sylvan Reaches': ['Rootstone Bridge', 'Elder Crossing', 'Deep Green Pass'],
  'Shadowmere-Sylvan Reaches': ['Twilight Crossing', 'Moon Bridge', 'Dusk Gate']
};

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
function findNearestNodeInRegion(x, y, regionNodes, nodeType = null, maxDist = Infinity) {
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
function findFrontierNodes(regionNodes, borderX, borderY, maxDist = INTER_REGION_CONFIG.MAX_FRONTIER_SEARCH_DIST) {
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
function generateBridgeName(region1Name, region2Name, rng) {
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
 * @param {Array} allNodes - All generated nodes (will be mutated)
 * @param {SeededRandom} rng - Seeded random generator
 * @returns {Object} Bridge node with connection info
 */
function createBridgeNode(border, nodesByRegion, rng) {
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
function createWildernessZone(border, bridgeNode, nodesByRegion, rng) {
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
function createTradeRoute(border, bridgeNode, nodesByRegion, rng) {
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
function createGrandPalace(palacePosition) {
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
function generateInterRegionConnections(voronoiData, nodesByRegion, allNodes, castles, rng) {
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
function validateInterRegionConnections(seed = 12345) {
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

// Export Phase 5 functions for testing
export {
  findNearestNodeInRegion,
  findFrontierNodes,
  generateBridgeName,
  createBridgeNode,
  createWildernessZone,
  createTradeRoute,
  createGrandPalace,
  generateInterRegionConnections,
  validateInterRegionConnections,
  INTER_REGION_CONFIG,
  BRIDGE_NAMES
};

// ============================================================================
// END INTER-REGION CONNECTIONS
// ============================================================================

// ============================================================================
// PHASE 6: VALIDATION & CLEANUP (Final Phase of 5-Region World Generation)
// ============================================================================

/**
 * Phase 6 Configuration Constants
 */
const PHASE6_CONFIG = {
  // Terminator distribution: 30% chest, 30% shrine, 40% discovery
  TERMINATOR_CHEST_RATIO: 0.30,
  TERMINATOR_SHRINE_RATIO: 0.30,
  // Note: Discovery gets the remainder (40%)

  // Shrine buff types available
  SHRINE_BUFF_TYPES: ['stamina_regen', 'exp_bonus', 'gold_bonus'],

  // Minimum ring distance for terminators
  MIN_RING_FOR_TERMINATOR: 3,

  // Target terminator percentage of total nodes
  TARGET_TERMINATOR_RATIO: 0.06  // ~6% of nodes become terminators
};

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
function calculateDifficultyTier(node) {
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
function assignTerminatorNodesRegional(allNodes, allConnections, rng) {
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
function verifyConnectivity(allNodes, allConnections) {
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
function validateAndCleanup(allNodes, regionConnections, interRegionConnections, castles, rng) {
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

  // Summary
  console.log('\n  Phase 6 Complete:');
  console.log(`    Total nodes: ${allNodes.length}`);
  console.log(`    Terminators: ${terminatorStats.chest + terminatorStats.shrine + terminatorStats.discovery}`);
  console.log(`    Connectivity: ${connectivityResult.allReachable ? 'PASS' : 'FAIL'}`);

  return {
    allNodes,
    allConnections,
    connectivityResult,
    terminatorStats
  };
}

/**
 * Validation function for Phase 6: Validation & Cleanup
 *
 * @param {number} seed - Random seed for testing
 * @returns {Object} Validation results
 */
function validatePhase6(seed = 12345) {
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

// Export Phase 6 functions for testing
export {
  calculateDifficultyTier,
  assignTerminatorNodesRegional,
  verifyConnectivity,
  validateAndCleanup,
  validatePhase6,
  PHASE6_CONFIG
};

// ============================================================================
// END PHASE 6: VALIDATION & CLEANUP
// ============================================================================

/**
 * Spatial hash grid for O(1) collision detection
 */
class SpatialGrid {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  getKey(x, y) {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }

  insert(point) {
    const key = this.getKey(point.x, point.y);
    if (!this.cells.has(key)) this.cells.set(key, []);
    this.cells.get(key).push(point);
  }

  getNeighbors(x, y, radius) {
    const neighbors = [];
    const cellRadius = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);

    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        if (this.cells.has(key)) {
          neighbors.push(...this.cells.get(key));
        }
      }
    }
    return neighbors;
  }
}

/**
 * Generate terrain obstacles (lakes, mountain ranges, dense forests)
 * These provide visual barriers that nodes are placed around
 */
function generateObstacles(rng) {
  const obstacles = [];
  const MIN_CENTER_DISTANCE = 8;  // Keep obstacles away from castle area

  // Helper to check if obstacle overlaps with existing ones
  function overlapsExisting(x, y, radius, existingObstacles) {
    for (const obs of existingObstacles) {
      const dist = Math.hypot(x - obs.x, y - obs.y);
      const minDist = (radius || 5) + (obs.radius || obs.length / 2 || 5) + 2;
      if (dist < minDist) return true;
    }
    return false;
  }

  // Generate lakes (2-3)
  const lakeCount = rng.nextInt(2, 4);
  for (let i = 0; i < lakeCount; i++) {
    let attempts = 0;
    while (attempts < 20) {
      const x = rng.nextInt(-25, 25);
      const y = rng.nextInt(-25, 25);
      const radius = rng.nextInt(4, 7);

      if (Math.hypot(x, y) > MIN_CENTER_DISTANCE && !overlapsExisting(x, y, radius, obstacles)) {
        obstacles.push({
          obstacle_type: OBSTACLE_TYPES.LAKE,
          x, y, radius,
          length: null,
          angle: null
        });
        break;
      }
      attempts++;
    }
  }

  // Generate mountain ranges (2-4)
  const mountainCount = rng.nextInt(2, 5);
  for (let i = 0; i < mountainCount; i++) {
    let attempts = 0;
    while (attempts < 20) {
      const x = rng.nextInt(-30, 30);
      const y = rng.nextInt(-30, 30);
      const length = rng.nextInt(8, 14);
      const angle = rng.next() * Math.PI * 2;

      if (Math.hypot(x, y) > MIN_CENTER_DISTANCE && !overlapsExisting(x, y, length / 2, obstacles)) {
        obstacles.push({
          obstacle_type: OBSTACLE_TYPES.MOUNTAIN_RANGE,
          x, y,
          radius: null,
          length,
          angle
        });
        break;
      }
      attempts++;
    }
  }

  // Generate dense forests (3-5)
  const forestCount = rng.nextInt(3, 6);
  for (let i = 0; i < forestCount; i++) {
    let attempts = 0;
    while (attempts < 20) {
      const x = rng.nextInt(-25, 25);
      const y = rng.nextInt(-25, 25);
      const radius = rng.nextInt(3, 5);

      if (Math.hypot(x, y) > MIN_CENTER_DISTANCE && !overlapsExisting(x, y, radius, obstacles)) {
        obstacles.push({
          obstacle_type: OBSTACLE_TYPES.DENSE_FOREST,
          x, y, radius,
          length: null,
          angle: null
        });
        break;
      }
      attempts++;
    }
  }

  console.log(`Generated ${obstacles.length} terrain obstacles`);
  return obstacles;
}

/**
 * Check if a point is inside any obstacle
 */
function isInObstacle(x, y, obstacles) {
  for (const obs of obstacles) {
    if (obs.obstacle_type === OBSTACLE_TYPES.LAKE ||
        obs.obstacle_type === OBSTACLE_TYPES.DENSE_FOREST) {
      // Circular obstacle
      const dist = Math.hypot(x - obs.x, y - obs.y);
      if (dist < obs.radius) return true;
    } else if (obs.obstacle_type === OBSTACLE_TYPES.MOUNTAIN_RANGE) {
      // Linear obstacle - check distance to line segment
      const halfLength = obs.length / 2;
      const dx = Math.cos(obs.angle) * halfLength;
      const dy = Math.sin(obs.angle) * halfLength;
      const x1 = obs.x - dx, y1 = obs.y - dy;
      const x2 = obs.x + dx, y2 = obs.y + dy;

      // Point to line segment distance
      const A = x - x1, B = y - y1;
      const C = x2 - x1, D = y2 - y1;
      const dot = A * C + B * D;
      const lenSq = C * C + D * D;
      let param = lenSq !== 0 ? dot / lenSq : -1;
      param = Math.max(0, Math.min(1, param));

      const nearX = x1 + param * C;
      const nearY = y1 + param * D;
      const dist = Math.hypot(x - nearX, y - nearY);

      if (dist < 2) return true;  // Mountain range has ~2 unit width
    }
  }
  return false;
}

/**
 * Generate node positions using Poisson disk sampling
 * Creates organic, natural-looking node distribution
 * Avoids placing nodes inside obstacle zones
 */
function generateNodePlacements(rng, targetCount = 300, minDistance = 3.5, obstacles = []) {
  const nodes = [];
  const grid = new SpatialGrid(minDistance);
  const activeList = [];

  // Start with castle at center
  const center = { x: 0, y: 0 };
  nodes.push(center);
  grid.insert(center);
  activeList.push(center);

  // Poisson disk sampling
  while (activeList.length > 0 && nodes.length < targetCount) {
    const idx = rng.nextInt(0, activeList.length - 1);
    const point = activeList[idx];
    let found = false;

    for (let attempt = 0; attempt < 30; attempt++) {
      const angle = rng.next() * Math.PI * 2;
      const distance = minDistance + rng.next() * minDistance;
      const newX = point.x + Math.cos(angle) * distance;
      const newY = point.y + Math.sin(angle) * distance;

      // Check if point is inside an obstacle
      if (isInObstacle(newX, newY, obstacles)) {
        continue;
      }

      // Check distance from all nearby points
      const neighbors = grid.getNeighbors(newX, newY, minDistance);
      const valid = neighbors.every(n => {
        const dx = n.x - newX;
        const dy = n.y - newY;
        return Math.sqrt(dx * dx + dy * dy) >= minDistance;
      });

      if (valid) {
        const newNode = { x: newX, y: newY };
        nodes.push(newNode);
        grid.insert(newNode);
        activeList.push(newNode);
        found = true;
        break;
      }
    }

    if (!found) {
      activeList.splice(idx, 1);
    }
  }

  return nodes;
}

/**
 * Assign node types based on distance from center
 * Creates natural biome distribution with inner civilization, outer wilderness
 */
function assignNodeTypes(rng, nodes) {
  // Calculate distances and sort
  const withDist = nodes.map((n, i) => ({
    ...n,
    index: i,
    dist: Math.sqrt(n.x * n.x + n.y * n.y)
  }));

  // Type distribution by distance bands (no guild/palace here - handled separately)
  const bands = [
    { maxDist: 8,  types: ['village', 'forest', 'city'] },
    { maxDist: 20, types: ['village', 'city', 'forest', 'cave', 'mountain'] },
    { maxDist: 35, types: ['forest', 'mountain', 'cave', 'city', 'bridge'] },
    { maxDist: Infinity, types: ['mountain', 'cave', 'forest', 'bridge'] }
  ];

  // Track guild placement (one per class)
  const guildClasses = ['warrior', 'wizard', 'monk', 'chemist'];
  let nextGuildClass = 0;
  let palacePlaced = false;

  for (const node of withDist) {
    if (node.index === 0) {
      node.type = 'castle'; // Center is always castle
      continue;
    }

    const band = bands.find(b => node.dist <= b.maxDist);

    // Place guilds in mid-distance band (5-12 distance)
    if (nextGuildClass < guildClasses.length && node.dist >= 5 && node.dist <= 12) {
      if (rng.next() < 0.15) { // 15% chance for eligible nodes
        node.type = 'guild';
        node.guildClass = guildClasses[nextGuildClass];
        nextGuildClass++;
        continue;
      }
    }

    // Place palace in outer band (distance 30+) exactly once
    if (!palacePlaced && node.dist >= 30 && rng.next() < 0.08) {
      node.type = 'palace';
      palacePlaced = true;
      continue;
    }

    node.type = band.types[rng.nextInt(0, band.types.length - 1)];
  }

  // Ensure at least one palace exists
  if (!palacePlaced) {
    const outerNodes = withDist.filter(n => n.dist >= 25 && n.type !== 'castle' && n.type !== 'guild');
    if (outerNodes.length > 0) {
      const palaceNode = outerNodes[rng.nextInt(0, outerNodes.length - 1)];
      palaceNode.type = 'palace';
    }
  }

  // Ensure all guilds are placed
  while (nextGuildClass < guildClasses.length) {
    const eligibleNodes = withDist.filter(n =>
      n.dist >= 5 && n.dist <= 15 &&
      n.type !== 'castle' && n.type !== 'guild' && n.type !== 'palace'
    );
    if (eligibleNodes.length > 0) {
      const guildNode = eligibleNodes[rng.nextInt(0, eligibleNodes.length - 1)];
      guildNode.type = 'guild';
      guildNode.guildClass = guildClasses[nextGuildClass];
      nextGuildClass++;
    } else {
      break; // No more eligible nodes
    }
  }

  return withDist;
}

/**
 * Build Minimum Spanning Tree using Prim's algorithm
 * Guarantees all nodes are connected to the castle
 * Penalizes invalid adjacencies (same-type settlements) to prefer valid connections
 */
function buildMinimumSpanningTree(nodes) {
  const connections = [];
  const inTree = new Set([0]); // Start with castle (index 0)

  // Cost multiplier for invalid connections (makes them last resort)
  const INVALID_CONNECTION_PENALTY = 1000;

  while (inTree.size < nodes.length) {
    let bestEdge = null;
    let bestCost = Infinity;

    for (const i of inTree) {
      for (let j = 0; j < nodes.length; j++) {
        if (inTree.has(j)) continue;

        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Apply penalty for invalid connections (same-type settlements)
        const valid = isValidConnection(nodes[i].type, nodes[j].type);
        const cost = valid ? dist : dist * INVALID_CONNECTION_PENALTY;

        if (cost < bestCost) {
          bestCost = cost;
          bestEdge = { from: i, to: j };
        }
      }
    }

    if (bestEdge) {
      connections.push(bestEdge);
      inTree.add(bestEdge.to);
    }
  }

  return connections;
}

/**
 * Count connections for each node
 */
function getConnectionCounts(nodes, connections) {
  const counts = new Map();
  for (let i = 0; i < nodes.length; i++) {
    counts.set(i, 0);
  }
  for (const conn of connections) {
    counts.set(conn.from, counts.get(conn.from) + 1);
    counts.set(conn.to, counts.get(conn.to) + 1);
  }
  return counts;
}

/**
 * Add extra connections for variety (keeps graph connected)
 * Creates shortcuts and alternate routes
 * Validates adjacency rules and respects connection limits
 */
function addLocalConnections(rng, nodes, mstConnections, extraRatio = 0.25) {
  const connections = [...mstConnections];
  const connectionSet = new Set(
    mstConnections.map(c => `${Math.min(c.from, c.to)},${Math.max(c.from, c.to)}`)
  );

  // Track connection counts for max limit enforcement
  const connectionCounts = getConnectionCounts(nodes, connections);

  const extraCount = Math.floor(nodes.length * extraRatio);

  for (let i = 0; i < extraCount; i++) {
    const nodeIdx = rng.nextInt(0, nodes.length - 1);
    const node = nodes[nodeIdx];

    // Check if this node has hit max connections
    const nodeType = node.type;
    const maxConn = MAX_CONNECTIONS[nodeType];
    if (maxConn && connectionCounts.get(nodeIdx) >= maxConn) {
      continue;
    }

    // Find nearby nodes that pass adjacency validation
    const nearby = nodes
      .map((n, idx) => ({ idx, dist: Math.sqrt((n.x - node.x) ** 2 + (n.y - node.y) ** 2), type: n.type }))
      .filter(n => {
        if (n.idx === nodeIdx) return false;
        if (n.dist >= 8) return false;
        // Check max connections for target
        const targetMax = MAX_CONNECTIONS[n.type];
        if (targetMax && connectionCounts.get(n.idx) >= targetMax) return false;
        // Validate adjacency rules
        return isValidConnection(nodeType, n.type);
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5);

    if (nearby.length > 0) {
      const target = nearby[rng.nextInt(0, nearby.length - 1)];
      const key = `${Math.min(nodeIdx, target.idx)},${Math.max(nodeIdx, target.idx)}`;

      if (!connectionSet.has(key)) {
        connections.push({ from: nodeIdx, to: target.idx });
        connectionSet.add(key);
        connectionCounts.set(nodeIdx, connectionCounts.get(nodeIdx) + 1);
        connectionCounts.set(target.idx, connectionCounts.get(target.idx) + 1);
      }
    }
  }

  return connections;
}

/**
 * Ensure minimum connections are met and enforce max connections
 * Post-processes the connection graph
 */
function enforceConnectionConstraints(rng, nodes, connections) {
  // Build initial connection set (used for deduplication tracking below)
  const _connectionSet = new Set(
    connections.map(c => `${Math.min(c.from, c.to)},${Math.max(c.from, c.to)}`)
  );
  const connectionCounts = getConnectionCounts(nodes, connections);

  // Remove excess connections from bridge nodes (max 2)
  const connectionsToRemove = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const maxConn = MAX_CONNECTIONS[node.type];
    if (maxConn && connectionCounts.get(i) > maxConn) {
      // Find non-MST connections to remove (preserve connectivity)
      const nodeConnections = connections
        .map((c, idx) => ({ ...c, idx }))
        .filter(c => c.from === i || c.to === i);

      // Sort by distance (remove longer connections first)
      nodeConnections.sort((a, b) => {
        const distA = Math.hypot(nodes[a.from].x - nodes[a.to].x, nodes[a.from].y - nodes[a.to].y);
        const distB = Math.hypot(nodes[b.from].x - nodes[b.to].x, nodes[b.from].y - nodes[b.to].y);
        return distB - distA;
      });

      while (connectionCounts.get(i) > maxConn && nodeConnections.length > 0) {
        const conn = nodeConnections.shift();
        const other = conn.from === i ? conn.to : conn.from;
        // Don't remove if it would leave other node with < 2 connections
        if (connectionCounts.get(other) > 2) {
          connectionsToRemove.push(conn.idx);
          connectionCounts.set(i, connectionCounts.get(i) - 1);
          connectionCounts.set(other, connectionCounts.get(other) - 1);
        }
      }
    }
  }

  // Remove flagged connections
  const finalConnections = connections.filter((_, idx) => !connectionsToRemove.includes(idx));
  const finalConnectionSet = new Set(
    finalConnections.map(c => `${Math.min(c.from, c.to)},${Math.max(c.from, c.to)}`)
  );
  const finalCounts = getConnectionCounts(nodes, finalConnections);

  // Add connections to meet minimums
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const minConn = MIN_CONNECTIONS[node.type] || 2;

    while (finalCounts.get(i) < minConn) {
      // Find nearest node that can accept a connection (must pass adjacency validation)
      const candidates = nodes
        .map((n, idx) => ({
          idx,
          dist: Math.hypot(n.x - node.x, n.y - node.y),
          type: n.type
        }))
        .filter(n => {
          if (n.idx === i) return false;
          const key = `${Math.min(i, n.idx)},${Math.max(i, n.idx)}`;
          if (finalConnectionSet.has(key)) return false;
          // Check max for target
          const targetMax = MAX_CONNECTIONS[n.type];
          if (targetMax && finalCounts.get(n.idx) >= targetMax) return false;
          // Validate adjacency - only allow valid connections
          if (!isValidConnection(node.type, n.type)) return false;
          return true;
        })
        .sort((a, b) => a.dist - b.dist);

      if (candidates.length === 0) break;

      const target = candidates[0];
      const key = `${Math.min(i, target.idx)},${Math.max(i, target.idx)}`;
      finalConnections.push({ from: i, to: target.idx });
      finalConnectionSet.add(key);
      finalCounts.set(i, finalCounts.get(i) + 1);
      finalCounts.set(target.idx, finalCounts.get(target.idx) + 1);
    }
  }

  return finalConnections;
}

/**
 * Assign terminator nodes at map edges
 * Converts battle nodes with 1 connection that are far from center
 */
function assignTerminatorNodes(rng, nodes, connections) {
  const connectionCounts = getConnectionCounts(nodes, connections);
  const MIN_DISTANCE_FOR_TERMINATOR = 25;

  // Find candidates: degree-1 nodes at edge, currently battle nodes
  const battleTypes = ['forest', 'cave', 'mountain'];
  const candidates = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (connectionCounts.get(i) === 1 &&
        node.dist >= MIN_DISTANCE_FOR_TERMINATOR &&
        battleTypes.includes(node.type)) {
      candidates.push(i);
    }
  }

  // Shuffle and assign terminator types (30% chest, 30% shrine, 40% discovery)
  const shuffled = rng.shuffle([...candidates]);
  const targetCount = Math.min(shuffled.length, Math.floor(nodes.length * 0.06)); // ~6% of nodes

  for (let i = 0; i < targetCount; i++) {
    const nodeIdx = shuffled[i];
    const rand = rng.next();

    if (rand < 0.3) {
      nodes[nodeIdx].type = 'chest';
      nodes[nodeIdx].isTerminator = true;
    } else if (rand < 0.6) {
      nodes[nodeIdx].type = 'shrine';
      nodes[nodeIdx].isTerminator = true;
      // Assign a random shrine buff type
      const buffTypes = ['stamina_regen', 'exp_bonus', 'gold_bonus'];
      nodes[nodeIdx].shrineBuffType = rng.pick(buffTypes);
    } else {
      nodes[nodeIdx].type = 'discovery';
      nodes[nodeIdx].isTerminator = true;
      // Assign a lore key based on position
      nodes[nodeIdx].loreKey = `lore_${Math.abs(Math.round(nodes[nodeIdx].x))}_${Math.abs(Math.round(nodes[nodeIdx].y))}`;
    }
  }

  console.log(`Assigned ${targetCount} terminator nodes (from ${candidates.length} candidates)`);
  return nodes;
}

/**
 * Generate features for a node based on its type
 */
function generateNodeFeatures(rng, nodeType) {
  switch (nodeType) {
    case 'castle':
      return CASTLE_FEATURES;
    case 'palace':
      return PALACE_FEATURES;
    case 'city': {
      const shuffled = rng.shuffle(CITY_OPTIONS);
      return ['tavern', shuffled[0], shuffled[1]];
    }
    case 'village': {
      const features = ['farm'];
      if (rng.next() > 0.5) features.push('apothecary');
      return features;
    }
    case 'guild':
      return ['guild_hall', 'training_ground'];
    default:
      return [];
  }
}

/**
 * Calculate difficulty tier based on distance from center
 */
function getDifficultyTier(dist, nodeType) {
  if (nodeType === 'castle') return 1;
  if (nodeType === 'palace') return 5;

  if (dist <= 8) return 1;
  if (dist <= 15) return 2;
  if (dist <= 25) return 3;
  if (dist <= 35) return 4;
  return 5;
}

/**
 * Main world generation function
 * Uses Poisson disk sampling for organic node placement
 * Uses MST for guaranteed connectivity to castle
 */
/**
 * NEW Regional World Generation Function
 *
 * Orchestrates all 6 phases of the 5-region world generation system:
 * Phase 1: Castle Placement (force-directed + Lloyd's relaxation)
 * Phase 2: Voronoi Partitioning (region boundaries)
 * Phase 3: Internal Node Generation (Poisson disk sampling per region)
 * Phase 4: Internal Connections (MST + extra connections per region)
 * Phase 5: Inter-Region Connections (bridges, wilderness, trade routes, palace)
 * Phase 6: Validation & Cleanup (terminators, difficulty tiers, connectivity)
 *
 * @param {number} seed - World seed for deterministic generation
 * @returns {Object} Database-ready world data { nodes, connections, obstacles, regions }
 */
async function generateWorld(seed) {
  const rng = new SeededRandom(seed);

  console.log('\n========================================');
  console.log('5-REGION WORLD GENERATION');
  console.log(`World Seed: ${seed}`);
  console.log('========================================\n');

  // Node name generation helper
  function generateNodeName(type, region = null) {
    const prefixes = NODE_NAME_PREFIXES[type] || NODE_NAME_PREFIXES.city;
    const suffixes = NODE_NAME_SUFFIXES[type] || NODE_NAME_SUFFIXES.city;
    const baseName = `${rng.pick(prefixes)} ${rng.pick(suffixes)}`;
    return baseName;
  }

  // Step 0: Generate terrain obstacles first (shared across regions)
  console.log('Generating terrain obstacles...');
  const obstacles = generateObstacles(rng);

  // ========================================
  // PHASE 1: Castle Placement
  // ========================================
  const castles = generateCastlePlacements(rng);

  // ========================================
  // PHASE 2: Voronoi Partitioning
  // ========================================
  const voronoiData = createVoronoiRegions(castles);

  // ========================================
  // PHASE 3: Internal Node Generation
  // ========================================
  const nodeData = generateAllRegionNodes(castles, voronoiData, rng);

  // ========================================
  // PHASE 4: Internal Connections
  // ========================================
  const connectionData = generateAllRegionConnections(nodeData, rng);

  // ========================================
  // PHASE 5: Inter-Region Connections
  // ========================================
  const interRegionData = generateInterRegionConnections(
    voronoiData,
    nodeData.nodesByRegion,
    nodeData.allNodes,
    castles,
    rng
  );

  // Merge all nodes (internal + inter-region)
  const mergedNodes = [...nodeData.allNodes, ...interRegionData.interRegionNodes];

  // Build region offset map for local->global index conversion
  // nodeData.allNodes is ordered by region (based on iteration order of nodesByRegion)
  const regionOffsetsForPhase6 = new Map();
  let phase6Offset = 0;
  for (const [regionId, regionNodes] of nodeData.nodesByRegion) {
    regionOffsetsForPhase6.set(regionId, phase6Offset);
    phase6Offset += regionNodes.length;
  }

  // Convert Phase 4 connections from local to global indices for Phase 6
  const globalRegionConnections = connectionData.allConnections.map(conn => {
    const offset = regionOffsetsForPhase6.get(conn.regionId) || 0;
    return {
      from: offset + conn.from,
      to: offset + conn.to,
      regionId: conn.regionId
    };
  });

  // ========================================
  // PHASE 6: Validation & Cleanup
  // ========================================
  const phase6Result = validateAndCleanup(
    mergedNodes,
    globalRegionConnections,
    interRegionData.interRegionConnections,
    castles,
    rng
  );

  // ========================================
  // Build Database-Ready Output
  // ========================================
  console.log('\n========================================');
  console.log('Building Database-Ready Output');
  console.log('========================================');

  // Track guild index for staggered refresh hours
  let guildIndex = 0;
  const GUILD_REFRESH_HOURS = [0, 6, 12, 18];

  // Build node map for inter-region connection resolution
  const nodeMap = new Map();
  phase6Result.allNodes.forEach((node, idx) => {
    nodeMap.set(node, idx);
  });

  // Track used coordinates to handle duplicates
  const usedCoords = new Set();

  // Convert nodes to database format
  const nodes = phase6Result.allNodes.map((node, idx) => {
    // Generate appropriate name
    let name;
    if (node.nodeType === 'castle') {
      // Use region's castle name if available
      const regionInfo = castles.find(c => c.region.id === node.regionId);
      name = regionInfo ? regionInfo.region.castleName : 'Castle';
    } else if (node.nodeType === 'palace') {
      name = 'Grand Palace';
    } else if (node.nodeType === 'guild') {
      // Guild name based on region's designated class
      const regionInfo = castles.find(c => c.region.id === node.regionId);
      const guildClass = regionInfo ? getGuildClassForRace(regionInfo.region.race) : 'warrior';
      node.guildClass = guildClass;
      name = `${guildClass.charAt(0).toUpperCase() + guildClass.slice(1)}s' Guild`;
    } else if (node.nodeType === 'keep') {
      const regionInfo = castles.find(c => c.region.id === node.regionId);
      name = regionInfo ? `${regionInfo.region.name} Keep` : 'Keep';
    } else if (node.name) {
      name = node.name;
    } else {
      name = generateNodeName(node.nodeType, node.regionName);
    }

    // Calculate distance from center (0,0)
    const distFromCenter = Math.round(Math.hypot(node.x, node.y));

    // Handle coordinate collisions by offsetting duplicates
    let x_coord = Math.round(node.x);
    let y_coord = Math.round(node.y);
    let coordKey = `${x_coord},${y_coord}`;

    // If coordinate already used, find a nearby available spot
    let offset = 1;
    while (usedCoords.has(coordKey)) {
      // Try offsets in a spiral pattern
      const offsets = [
        [offset, 0], [-offset, 0], [0, offset], [0, -offset],
        [offset, offset], [-offset, -offset], [offset, -offset], [-offset, offset]
      ];
      let found = false;
      for (const [dx, dy] of offsets) {
        const newX = Math.round(node.x) + dx;
        const newY = Math.round(node.y) + dy;
        const newKey = `${newX},${newY}`;
        if (!usedCoords.has(newKey)) {
          x_coord = newX;
          y_coord = newY;
          coordKey = newKey;
          found = true;
          break;
        }
      }
      if (!found) offset++;
      if (offset > 10) break; // Safety limit
    }
    usedCoords.add(coordKey);

    const nodeObj = {
      node_type: node.nodeType,
      name: name,
      x_coord: x_coord,
      y_coord: y_coord,
      distance_from_center: distFromCenter,
      features: JSON.stringify(generateNodeFeatures(rng, node.nodeType)),
      guild_class: node.guildClass || null,
      local_seed: rng.nextInt(1, 1000000),
      difficulty_tier: node.difficultyTier || calculateDifficultyTier(node),
      recruit_refresh_hour: null,
      is_terminator: node.isTerminator || false,
      shrine_buff_type: node.shrineBuffType || null,
      lore_key: node.loreKey || null,
      // NEW regional columns
      region_id: node.regionId || null,
      region_race: getRegionRace(node.regionId, castles),
      ring_distance: node.ringDistance || null
    };

    // Assign staggered refresh hours to guild nodes
    if (node.nodeType === 'guild') {
      nodeObj.recruit_refresh_hour = GUILD_REFRESH_HOURS[guildIndex % GUILD_REFRESH_HOURS.length];
      guildIndex++;
    }

    return nodeObj;
  });

  // Convert connections to index-based format for database insertion
  const connections = [];
  const connectionSet = new Set(); // Prevent duplicates

  // Add region internal connections
  // These are already converted to global indices in globalRegionConnections
  for (const conn of globalRegionConnections) {
    const fromIdx = conn.from;
    const toIdx = conn.to;

    // Validate indices
    if (fromIdx >= 0 && fromIdx < phase6Result.allNodes.length &&
        toIdx >= 0 && toIdx < phase6Result.allNodes.length) {
      const key = `${Math.min(fromIdx, toIdx)},${Math.max(fromIdx, toIdx)}`;
      if (!connectionSet.has(key)) {
        connections.push({ from: fromIdx, to: toIdx });
        connectionSet.add(key);
      }
    }
  }

  console.log(`  Region internal connections: ${connections.length}`);

  // Add inter-region connections
  // These use node object references, need to find their indices
  for (const conn of interRegionData.interRegionConnections) {
    // Handle various connection formats from Phase 5
    let fromIdx, toIdx;

    // From node - can be node object or number (should be node object from Phase 5)
    if (typeof conn.from === 'number') {
      fromIdx = conn.from;
    } else {
      fromIdx = nodeMap.get(conn.from);
    }

    // To node - can be direct node, { node, distance } format, or number
    if (typeof conn.to === 'number') {
      toIdx = conn.to;
    } else if (conn.to && conn.to.node) {
      toIdx = nodeMap.get(conn.to.node);
    } else {
      toIdx = nodeMap.get(conn.to);
    }

    if (fromIdx !== undefined && toIdx !== undefined &&
        fromIdx >= 0 && fromIdx < phase6Result.allNodes.length &&
        toIdx >= 0 && toIdx < phase6Result.allNodes.length) {
      const key = `${Math.min(fromIdx, toIdx)},${Math.max(fromIdx, toIdx)}`;
      if (!connectionSet.has(key)) {
        connections.push({ from: fromIdx, to: toIdx });
        connectionSet.add(key);
      }
    }
  }

  console.log(`  Total connections after inter-region: ${connections.length}`)

  // Build regions data for world_regions table
  const regions = castles.map((castle, idx) => {
    // Find the castle node index
    const castleNode = nodes.find(n =>
      n.node_type === 'castle' && n.region_id === castle.region.id
    );
    const castleNodeIdx = castleNode ? nodes.indexOf(castleNode) : null;

    // Find keep and guild node indices for this region
    const keepNode = nodes.find(n =>
      n.node_type === 'keep' && n.region_id === castle.region.id
    );
    const keepNodeIdx = keepNode ? nodes.indexOf(keepNode) : null;

    const guildNode = nodes.find(n =>
      n.node_type === 'guild' && n.region_id === castle.region.id
    );
    const guildNodeIdx = guildNode ? nodes.indexOf(guildNode) : null;

    // Get the Voronoi cell polygon for boundary
    const cell = voronoiData.cells[idx];
    const boundaryPolygon = cell ? cell.polygon : null;

    return {
      id: castle.region.id,
      race: castle.region.race,
      castle_node_idx: castleNodeIdx,
      keep_node_idx: keepNodeIdx,
      guild_node_idx: guildNodeIdx,
      dominant_terrain: castle.region.dominantTerrain,
      secondary_terrains: castle.region.secondaryTerrains,
      boundary_polygon: boundaryPolygon
    };
  });

  // Summary
  console.log(`\nWorld Generation Complete:`);
  console.log(`  Total nodes: ${nodes.length}`);
  console.log(`  Total connections: ${connections.length}`);
  console.log(`  Regions: ${regions.length}`);
  console.log(`  Obstacles: ${obstacles.length}`);

  // Count by region
  const nodeCounts = {};
  for (const node of nodes) {
    const regionId = node.region_id || 'inter-region';
    nodeCounts[regionId] = (nodeCounts[regionId] || 0) + 1;
  }
  console.log(`  Nodes by region: ${JSON.stringify(nodeCounts)}`);

  return { nodes, connections, obstacles, regions };
}

/**
 * Get the guild class associated with a race's region
 * Each race has an affinity for a particular class
 *
 * @param {string} race - Race identifier
 * @returns {string} Guild class
 */
function getGuildClassForRace(race) {
  const raceToGuild = {
    human: 'warrior',
    elf: 'wizard',
    dwarf: 'monk',       // Dwarves are disciplined (monk fits)
    vampire: 'chemist',  // Alchemical nature
    orc: 'warrior'       // Combat focused
  };
  return raceToGuild[race] || 'warrior';
}

/**
 * Get the race for a region ID by looking up castle data
 *
 * @param {number} regionId - Region ID
 * @param {Array} castles - Castle data from Phase 1
 * @returns {string|null} Race identifier or null
 */
function getRegionRace(regionId, castles) {
  if (!regionId) return null;
  const castle = castles.find(c => c.region.id === regionId);
  return castle ? castle.region.race : null;
}

async function seedItems() {
  // Items are seeded in order - templateId corresponds to array index + 1
  const items = [
    // Weapons (templateId 1-6)
    { name: 'Rusty Sword', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 3 }, level_requirement: 1, base_price: 50, rarity: 1, description: 'A worn blade, but still sharp enough to cut.' },           // 1
    { name: 'Iron Sword', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 7 }, level_requirement: 5, base_price: 150, rarity: 2, description: 'A sturdy iron blade forged by skilled smiths.' },            // 2
    { name: 'Steel Blade', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 12, agility: 3 }, level_requirement: 15, base_price: 400, rarity: 3, description: 'High-quality steel, perfectly balanced.' },   // 3
    { name: 'Oak Staff', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { intelligence: 5 }, level_requirement: 1, base_price: 60, rarity: 1, description: 'A simple staff carved from oak wood.' },                  // 4
    { name: 'Mystic Staff', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { intelligence: 10, mp_max: 20 }, level_requirement: 10, base_price: 300, rarity: 2, description: 'Imbued with magical essence.' },         // 5
    { name: 'Combat Gloves', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 4, agility: 3 }, level_requirement: 1, base_price: 45, rarity: 1, description: 'Reinforced gloves for martial artists.' },     // 6

    // Armor (templateId 7-9)
    { name: 'Leather Armor', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { vitality: 3, hp_max: 15 }, level_requirement: 1, base_price: 80, rarity: 1, description: 'Light armor that allows free movement.' },           // 7
    { name: 'Chain Mail', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { vitality: 6, hp_max: 30 }, level_requirement: 8, base_price: 250, rarity: 2, description: 'Interlocking rings provide solid protection.' },       // 8
    { name: 'Cloth Robe', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { intelligence: 3, mp_max: 15 }, level_requirement: 1, base_price: 70, rarity: 1, description: 'A robe favored by spellcasters.' },                 // 9

    // Accessories (templateId 10-11)
    { name: 'Lucky Charm', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { luck: 5 }, level_requirement: 1, base_price: 100, rarity: 2, description: 'A four-leaf clover preserved in crystal.' },                 // 10
    { name: 'Ring of Vitality', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { hp_max: 25, vitality: 3 }, level_requirement: 5, base_price: 200, rarity: 2, description: 'Pulses with life energy.' },            // 11

    // Consumables (templateId 12-15)
    { name: 'Health Potion', item_type: 'consumable', effect_type: 'heal_hp', effect_value: 50, base_price: 25, rarity: 1, description: 'Restores 50 HP when consumed.' },                                                              // 12
    { name: 'Mana Potion', item_type: 'consumable', effect_type: 'heal_mp', effect_value: 30, base_price: 30, rarity: 1, description: 'Restores 30 MP when consumed.' },                                                                // 13
    { name: 'Antidote', item_type: 'consumable', effect_type: 'cure_poison', effect_value: 0, base_price: 15, rarity: 1, description: 'Cures poison status.' },                                                                         // 14
    { name: 'Phoenix Feather', item_type: 'consumable', effect_type: 'revive', effect_value: 50, base_price: 500, rarity: 4, description: 'Revives a fallen ally with 50% HP.' },                                                       // 15

    // Additional Weapons (templateId 16-20)
    { name: 'Bronze Axe', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 5 }, level_requirement: 3, base_price: 90, rarity: 1, description: 'A heavy axe with a bronze head.' },                          // 16
    { name: 'Iron Axe', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 9, vitality: 2 }, level_requirement: 8, base_price: 220, rarity: 2, description: 'A brutish weapon favored by warriors.' },         // 17
    { name: 'Apprentice Wand', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { intelligence: 3, mp_max: 10 }, level_requirement: 1, base_price: 40, rarity: 1, description: 'A basic wand for magic students.' },     // 18
    { name: 'Steel Fist', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 7, agility: 5 }, level_requirement: 10, base_price: 180, rarity: 2, description: 'Metal knuckles for devastating punches.' },     // 19
    { name: 'Throwing Knives', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { agility: 6, luck: 3 }, level_requirement: 5, base_price: 120, rarity: 2, description: 'A set of balanced throwing blades.' },          // 20

    // Additional Armor (templateId 21-25)
    { name: 'Leather Helm', item_type: 'armor', equipment_slot: 'head', stat_bonuses: { vitality: 2 }, level_requirement: 1, base_price: 40, rarity: 1, description: 'A simple leather cap.' },                                         // 21
    { name: 'Iron Helm', item_type: 'armor', equipment_slot: 'head', stat_bonuses: { vitality: 4, strength: 1 }, level_requirement: 8, base_price: 120, rarity: 2, description: 'Solid iron protection for the head.' },                // 22
    { name: 'Leather Boots', item_type: 'armor', equipment_slot: 'feet', stat_bonuses: { agility: 2 }, level_requirement: 1, base_price: 35, rarity: 1, description: 'Comfortable boots for travel.' },                                 // 23
    { name: 'Iron Greaves', item_type: 'armor', equipment_slot: 'feet', stat_bonuses: { vitality: 3, agility: 1 }, level_requirement: 8, base_price: 100, rarity: 2, description: 'Heavy leg armor.' },                                 // 24
    { name: 'Wizard Hat', item_type: 'armor', equipment_slot: 'head', stat_bonuses: { intelligence: 4, mp_max: 10 }, level_requirement: 5, base_price: 90, rarity: 2, description: 'A pointy hat imbued with magic.' },                 // 25

    // Additional Accessories (templateId 26-28)
    { name: 'Iron Ring', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { strength: 2, vitality: 1 }, level_requirement: 1, base_price: 50, rarity: 1, description: 'A simple iron band.' },                        // 26
    { name: 'Mage Ring', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { intelligence: 4, mp_max: 15 }, level_requirement: 5, base_price: 150, rarity: 2, description: 'Enhances magical power.' },                // 27
    { name: 'Speed Amulet', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { agility: 5 }, level_requirement: 3, base_price: 130, rarity: 2, description: 'Increases reflexes and speed.' },                        // 28

    // Additional Consumables (templateId 29-32)
    { name: 'Hi-Potion', item_type: 'consumable', effect_type: 'heal_hp', effect_value: 150, base_price: 100, rarity: 2, description: 'Restores 150 HP when consumed.' },                                                               // 29
    { name: 'Hi-Ether', item_type: 'consumable', effect_type: 'heal_mp', effect_value: 80, base_price: 120, rarity: 2, description: 'Restores 80 MP when consumed.' },                                                                  // 30
    { name: 'Elixir', item_type: 'consumable', effect_type: 'heal_both', effect_value: 100, base_price: 300, rarity: 3, description: 'Restores 100 HP and 50 MP.' },                                                                    // 31
    { name: 'Status Cure', item_type: 'consumable', effect_type: 'cure_all', effect_value: 0, base_price: 75, rarity: 2, description: 'Cures all negative status effects.' },                                                           // 32

    // Guild Starter Equipment (base_price = 2 for 1 gold sell value)
    // Warrior Guild
    { name: 'Trainee Sword', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { strength: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'A simple blade given to warrior initiates.' },                   // 33
    { name: 'Trainee Tunic', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { vitality: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'Padded cloth worn during basic training.' },                            // 34
    { name: "Warrior's Pendant", item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { hp_max: 5 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'A token of the warrior guild.' },                            // 35

    // Wizard Guild
    { name: 'Novice Wand', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { intelligence: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'A basic focus for channeling magic.' },                         // 36
    { name: 'Student Robe', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { mp_max: 5 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'Standard robes for magic students.' },                                     // 37
    { name: "Mage's Crystal", item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { intelligence: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'A small crystal attuned to mana.' },                      // 38

    // Monk Guild
    { name: 'Initiate Wraps', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { agility: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'Cloth wraps for hand-to-hand combat.' },                          // 39
    { name: 'Initiate Gi', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { agility: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'Light garments for martial training.' },                                   // 40
    { name: "Monk's Beads", item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { luck: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'Prayer beads blessed by the monastery.' },                          // 41

    // Chemist Guild
    { name: 'Mixing Rod', item_type: 'weapon', equipment_slot: 'main_hand', stat_bonuses: { intelligence: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'A tool for stirring potions and reagents.' },                    // 42
    { name: 'Alchemist Coat', item_type: 'armor', equipment_slot: 'body', stat_bonuses: { hp_max: 3, mp_max: 3 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'Protective garment with many pockets.' },                     // 43
    { name: 'Reagent Pouch', item_type: 'accessory', equipment_slot: 'accessory', stat_bonuses: { luck: 1 }, level_requirement: 1, base_price: 2, rarity: 1, description: 'A small bag of basic alchemical supplies.' }                       // 44
  ];

  for (const item of items) {
    await pool.query(
      `INSERT INTO item_templates (name, description, item_type, equipment_slot, stat_bonuses, level_requirement, effect_type, effect_value, base_price, rarity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT DO NOTHING`,
      [
        item.name,
        item.description || null,
        item.item_type,
        item.equipment_slot || null,
        JSON.stringify(item.stat_bonuses || {}),
        item.level_requirement || 1,
        item.effect_type || null,
        item.effect_value || null,
        item.base_price || 0,
        item.rarity || 1
      ]
    );
  }

  console.log(`Seeded ${items.length} item templates`);
}

async function seedEnemies() {
  const enemies = [
    // Tier 1 - Forest (starter area)
    {
      name: 'Goblin Warrior',
      sprite_id: 'goblin_warrior',
      base_hp: 40, base_mp: 10, base_strength: 8, base_intelligence: 4, base_agility: 6,
      spawn_node_types: ['forest'], ai_type: 'aggressive',
      experience_reward: 20, gold_reward_min: 5, gold_reward_max: 15, min_difficulty_tier: 1,
      drop_table: { dropChance: 0.6, minItems: 0, maxItems: 1, rarityWeights: { common: 85, uncommon: 15 }, itemPool: [{ templateId: 1, weight: 50 }, { templateId: 12, weight: 50 }] }
    },
    {
      name: 'Gray Wolf',
      sprite_id: 'gray_wolf',
      base_hp: 35, base_mp: 5, base_strength: 10, base_intelligence: 2, base_agility: 10,
      spawn_node_types: ['forest', 'mountain'], ai_type: 'pack',
      experience_reward: 25, gold_reward_min: 3, gold_reward_max: 10, min_difficulty_tier: 1,
      drop_table: { dropChance: 0.5, minItems: 0, maxItems: 1, rarityWeights: { common: 90, uncommon: 10 }, itemPool: [{ templateId: 12, weight: 70 }, { templateId: 13, weight: 30 }] }
    },
    {
      name: 'Forest Slime',
      sprite_id: 'forest_slime',
      base_hp: 30, base_mp: 10, base_strength: 5, base_intelligence: 3, base_agility: 4,
      spawn_node_types: ['forest', 'cave'], ai_type: 'defensive',
      experience_reward: 10, gold_reward_min: 1, gold_reward_max: 5, min_difficulty_tier: 1,
      drop_table: { dropChance: 0.4, minItems: 0, maxItems: 1, rarityWeights: { common: 95, uncommon: 5 }, itemPool: [{ templateId: 12, weight: 100 }] }
    },

    // Tier 1-2 - Caves
    {
      name: 'Cave Bat',
      sprite_id: 'cave_bat',
      base_hp: 25, base_mp: 15, base_strength: 5, base_intelligence: 6, base_agility: 12,
      spawn_node_types: ['cave'], ai_type: 'hit-and-run',
      experience_reward: 15, gold_reward_min: 2, gold_reward_max: 8, min_difficulty_tier: 1,
      drop_table: { dropChance: 0.35, minItems: 0, maxItems: 1, rarityWeights: { common: 90, uncommon: 10 }, itemPool: [{ templateId: 13, weight: 100 }] }
    },
    {
      name: 'Giant Spider',
      sprite_id: 'giant_spider',
      base_hp: 45, base_mp: 20, base_strength: 10, base_intelligence: 5, base_agility: 9,
      spawn_node_types: ['cave', 'forest'], ai_type: 'ambush',
      experience_reward: 35, gold_reward_min: 8, gold_reward_max: 20, min_difficulty_tier: 2,
      drop_table: { dropChance: 0.65, minItems: 0, maxItems: 2, rarityWeights: { common: 70, uncommon: 25, rare: 5 }, itemPool: [{ templateId: 13, weight: 40 }, { templateId: 7, weight: 30 }, { templateId: 12, weight: 30 }] }
    },
    {
      name: 'Skeleton Warrior',
      sprite_id: 'skeleton_warrior',
      base_hp: 50, base_mp: 0, base_strength: 12, base_intelligence: 2, base_agility: 6,
      spawn_node_types: ['cave'], ai_type: 'tactical',
      experience_reward: 40, gold_reward_min: 10, gold_reward_max: 25, min_difficulty_tier: 2,
      drop_table: { dropChance: 0.7, minItems: 0, maxItems: 2, rarityWeights: { common: 60, uncommon: 30, rare: 10 }, itemPool: [{ templateId: 1, weight: 35 }, { templateId: 2, weight: 25 }, { templateId: 7, weight: 40 }] }
    },
    {
      name: 'Stone Golem',
      sprite_id: 'stone_golem',
      base_hp: 80, base_mp: 0, base_strength: 15, base_intelligence: 1, base_agility: 2,
      spawn_node_types: ['cave', 'mountain'], ai_type: 'defensive',
      experience_reward: 50, gold_reward_min: 15, gold_reward_max: 30, min_difficulty_tier: 2,
      drop_table: { dropChance: 0.75, minItems: 1, maxItems: 2, rarityWeights: { common: 50, uncommon: 35, rare: 15 }, itemPool: [{ templateId: 8, weight: 50 }, { templateId: 11, weight: 50 }] }
    },

    // Tier 2-3 - Mountains
    {
      name: 'Mountain Troll',
      sprite_id: 'mountain_troll',
      base_hp: 100, base_mp: 5, base_strength: 18, base_intelligence: 3, base_agility: 4,
      spawn_node_types: ['mountain', 'bridge'], ai_type: 'aggressive',
      experience_reward: 75, gold_reward_min: 25, gold_reward_max: 50, min_difficulty_tier: 3,
      drop_table: { dropChance: 0.8, minItems: 1, maxItems: 2, rarityWeights: { common: 40, uncommon: 40, rare: 18, epic: 2 }, itemPool: [{ templateId: 2, weight: 30 }, { templateId: 3, weight: 25 }, { templateId: 8, weight: 25 }, { templateId: 15, weight: 20 }] }
    },
    {
      name: 'Troll Shaman',
      sprite_id: 'troll_shaman',
      base_hp: 70, base_mp: 50, base_strength: 10, base_intelligence: 14, base_agility: 6,
      spawn_node_types: ['mountain'], ai_type: 'support',
      experience_reward: 65, gold_reward_min: 20, gold_reward_max: 45, min_difficulty_tier: 3,
      abilities: [{ type: 'heal', power: 30 }, { type: 'debuff', effect: 'slow' }],
      drop_table: { dropChance: 0.8, minItems: 1, maxItems: 2, rarityWeights: { common: 35, uncommon: 40, rare: 20, epic: 5 }, itemPool: [{ templateId: 4, weight: 35 }, { templateId: 5, weight: 35 }, { templateId: 13, weight: 30 }] }
    },
    {
      name: 'Harpy',
      sprite_id: 'harpy',
      base_hp: 55, base_mp: 30, base_strength: 12, base_intelligence: 8, base_agility: 14,
      spawn_node_types: ['mountain'], ai_type: 'hit-and-run',
      experience_reward: 55, gold_reward_min: 15, gold_reward_max: 35, min_difficulty_tier: 3,
      drop_table: { dropChance: 0.7, minItems: 0, maxItems: 2, rarityWeights: { common: 45, uncommon: 40, rare: 15 }, itemPool: [{ templateId: 10, weight: 40 }, { templateId: 6, weight: 30 }, { templateId: 13, weight: 30 }] }
    },

    // Tier 2 - Bridges
    {
      name: 'Bridge Bandit',
      sprite_id: 'bridge_bandit',
      base_hp: 45, base_mp: 20, base_strength: 12, base_intelligence: 8, base_agility: 8,
      spawn_node_types: ['bridge'], ai_type: 'tactical',
      experience_reward: 35, gold_reward_min: 20, gold_reward_max: 40, min_difficulty_tier: 2,
      drop_table: { dropChance: 0.75, minItems: 1, maxItems: 2, rarityWeights: { common: 55, uncommon: 35, rare: 10 }, itemPool: [{ templateId: 1, weight: 30 }, { templateId: 6, weight: 30 }, { templateId: 10, weight: 20 }, { templateId: 12, weight: 20 }] }
    },
    {
      name: 'Bandit Captain',
      sprite_id: 'bandit_captain',
      base_hp: 65, base_mp: 25, base_strength: 14, base_intelligence: 10, base_agility: 10,
      spawn_node_types: ['bridge'], ai_type: 'tactical',
      experience_reward: 55, gold_reward_min: 35, gold_reward_max: 60, min_difficulty_tier: 2,
      drop_table: { dropChance: 0.85, minItems: 1, maxItems: 3, rarityWeights: { common: 40, uncommon: 40, rare: 17, epic: 3 }, itemPool: [{ templateId: 2, weight: 25 }, { templateId: 3, weight: 20 }, { templateId: 8, weight: 25 }, { templateId: 10, weight: 15 }, { templateId: 15, weight: 15 }] }
    },
    {
      name: 'Bridge Troll',
      sprite_id: 'bridge_troll',
      base_hp: 90, base_mp: 10, base_strength: 16, base_intelligence: 4, base_agility: 5,
      spawn_node_types: ['bridge'], ai_type: 'aggressive',
      experience_reward: 70, gold_reward_min: 30, gold_reward_max: 55, min_difficulty_tier: 3,
      drop_table: { dropChance: 0.8, minItems: 1, maxItems: 2, rarityWeights: { common: 35, uncommon: 45, rare: 18, epic: 2 }, itemPool: [{ templateId: 3, weight: 35 }, { templateId: 8, weight: 35 }, { templateId: 11, weight: 30 }] }
    },

    // Tier 4+ - Palace area
    {
      name: 'Dark Knight',
      sprite_id: 'dark_knight',
      base_hp: 120, base_mp: 30, base_strength: 20, base_intelligence: 8, base_agility: 10,
      spawn_node_types: ['palace'], ai_type: 'tactical',
      experience_reward: 120, gold_reward_min: 50, gold_reward_max: 100, min_difficulty_tier: 4,
      drop_table: { dropChance: 0.9, minItems: 1, maxItems: 3, rarityWeights: { common: 20, uncommon: 40, rare: 30, epic: 10 }, itemPool: [{ templateId: 3, weight: 30 }, { templateId: 8, weight: 30 }, { templateId: 11, weight: 25 }, { templateId: 15, weight: 15 }] }
    },
    {
      name: 'Shadow Assassin',
      sprite_id: 'shadow_assassin',
      base_hp: 75, base_mp: 40, base_strength: 16, base_intelligence: 12, base_agility: 18,
      spawn_node_types: ['palace'], ai_type: 'ambush',
      experience_reward: 100, gold_reward_min: 40, gold_reward_max: 80, min_difficulty_tier: 4,
      drop_table: { dropChance: 0.85, minItems: 1, maxItems: 2, rarityWeights: { common: 25, uncommon: 40, rare: 28, epic: 7 }, itemPool: [{ templateId: 6, weight: 40 }, { templateId: 10, weight: 35 }, { templateId: 15, weight: 25 }] }
    },
    {
      name: 'Palace Guard',
      sprite_id: 'palace_guard',
      base_hp: 100, base_mp: 20, base_strength: 16, base_intelligence: 6, base_agility: 8,
      spawn_node_types: ['palace'], ai_type: 'defensive',
      experience_reward: 90, gold_reward_min: 35, gold_reward_max: 70, min_difficulty_tier: 4,
      drop_table: { dropChance: 0.85, minItems: 1, maxItems: 2, rarityWeights: { common: 30, uncommon: 40, rare: 25, epic: 5 }, itemPool: [{ templateId: 2, weight: 30 }, { templateId: 8, weight: 35 }, { templateId: 11, weight: 35 }] }
    }
  ];

  for (const enemy of enemies) {
    await pool.query(
      `INSERT INTO enemy_templates (name, sprite_id, base_hp, base_mp, base_strength, base_intelligence, base_agility, spawn_node_types, ai_type, abilities, drop_table, experience_reward, gold_reward_min, gold_reward_max, min_difficulty_tier)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT DO NOTHING`,
      [
        enemy.name,
        enemy.sprite_id,
        enemy.base_hp,
        enemy.base_mp,
        enemy.base_strength,
        enemy.base_intelligence,
        enemy.base_agility,
        enemy.spawn_node_types,
        enemy.ai_type || 'aggressive',
        JSON.stringify(enemy.abilities || []),
        JSON.stringify(enemy.drop_table || {}),
        enemy.experience_reward,
        enemy.gold_reward_min || 1,
        enemy.gold_reward_max,
        enemy.min_difficulty_tier || 1
      ]
    );
  }

  console.log(`Seeded ${enemies.length} enemy templates`);
}

/**
 * Seed shop inventory for all nodes with shops
 * @param {Array} nodeIds - Array of node IDs (index matches nodes array)
 * @param {Array} nodes - Array of node objects with features
 */
async function seedShopInventory(nodeIds, nodes) {
  // Item template IDs by shop type
  // Based on seedItems() order: weapons 1-6, armor 7-9, accessories 10-11, consumables 12-15,
  // more weapons 16-20, more armor 21-25, more accessories 26-28, more consumables 29-32

  const shopStock = {
    blacksmith: {
      // Weapons and armor
      items: [
        { templateId: 1, qty: 10 },  // Rusty Sword
        { templateId: 4, qty: 8 },   // Oak Staff
        { templateId: 6, qty: 8 },   // Combat Gloves
        { templateId: 7, qty: 10 },  // Leather Armor
        { templateId: 9, qty: 8 },   // Cloth Robe
        { templateId: 16, qty: 6 },  // Bronze Axe
        { templateId: 18, qty: 6 },  // Apprentice Wand
        { templateId: 21, qty: 10 }, // Leather Helm
        { templateId: 23, qty: 10 }, // Leather Boots
        // Higher level items (less stock)
        { templateId: 2, qty: 4 },   // Iron Sword
        { templateId: 8, qty: 4 },   // Chain Mail
        { templateId: 17, qty: 3 },  // Iron Axe
        { templateId: 19, qty: 3 },  // Steel Fist
        { templateId: 22, qty: 4 },  // Iron Helm
        { templateId: 24, qty: 4 },  // Iron Greaves
        { templateId: 25, qty: 3 },  // Wizard Hat
      ]
    },
    apothecary: {
      // Consumables
      items: [
        { templateId: 12, qty: 20 }, // Health Potion
        { templateId: 13, qty: 15 }, // Mana Potion
        { templateId: 14, qty: 10 }, // Antidote
        { templateId: 29, qty: 8 },  // Hi-Potion
        { templateId: 30, qty: 6 },  // Hi-Ether
        { templateId: 31, qty: 3 },  // Elixir
        { templateId: 32, qty: 5 },  // Status Cure
        { templateId: 15, qty: 2 },  // Phoenix Feather (rare)
      ]
    },
    farm: {
      // Basic consumables at lower prices (village economy)
      items: [
        { templateId: 12, qty: 15 }, // Health Potion
        { templateId: 13, qty: 10 }, // Mana Potion
        { templateId: 14, qty: 8 },  // Antidote
      ]
    }
  };

  // Map features to shop types
  const featureToShop = {
    blacksmith: 'blacksmith',
    apothecary: 'apothecary',
    farm: 'farm'
  };

  let insertCount = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nodeId = nodeIds[i];
    const features = JSON.parse(node.features || '[]');

    for (const feature of features) {
      const shopType = featureToShop[feature];
      if (!shopType || !shopStock[shopType]) continue;

      const stock = shopStock[shopType];
      for (const item of stock.items) {
        await pool.query(
          `INSERT INTO npc_shop_inventory (node_id, shop_type, item_template_id, quantity, restock_quantity)
           VALUES ($1, $2, $3, $4, $4)
           ON CONFLICT (node_id, shop_type, item_template_id) DO NOTHING`,
          [nodeId, shopType, item.templateId, item.qty]
        );
        insertCount++;
      }
    }
  }

  console.log(`Seeded ${insertCount} shop inventory entries`);
}

/**
 * Seed developer test data with derezo user and generated equipment
 * Only runs in development environment
 */
async function seedDeveloperTestData(castleId) {
  // Skip in production
  if (process.env.NODE_ENV === 'production') {
    console.log('Skipping dev seed data in production');
    return;
  }

  console.log('\nSeeding developer test data...');

  // Import bcrypt for password hashing
  const bcrypt = await import('bcrypt');
  // nosec: Test password for development seed data only
  const hashedPassword = await bcrypt.default.hash('password', 10);

  // Create or update derezo user with 30,000 gold
  const userResult = await pool.query(
    `INSERT INTO users (username, email, password_hash, gold)
     VALUES ('derezo', 'derezo@test.local', $1, 30000)
     ON CONFLICT (username) DO UPDATE SET gold = 30000
     RETURNING id`,
    [hashedPassword]
  );
  const userId = userResult.rows[0].id;

  // Check if character already exists
  const existingChar = await pool.query(
    `SELECT id FROM characters WHERE user_id = $1 AND name = 'Derezo'`,
    [userId]
  );

  let characterId;
  if (existingChar.rows.length > 0) {
    characterId = existingChar.rows[0].id;
    console.log('  Developer character already exists, updating items...');

    // Ensure party_slot is set (may be missing from older seeds)
    await pool.query(
      'UPDATE characters SET party_slot = 1 WHERE id = $1 AND party_slot IS NULL',
      [characterId]
    );

    // Clear existing items for fresh test data
    await pool.query('DELETE FROM character_items WHERE character_id = $1', [characterId]);
  } else {
    // Create male elf wizard character at level 25
    const charResult = await pool.query(
      `INSERT INTO characters (user_id, name, race, class, gender, level, experience,
       current_node_id, hp_current, hp_max, mp_current, mp_max,
       strength, intelligence, agility, vitality, luck, party_slot)
       VALUES ($1, 'Derezo', 'elf', 'wizard', 'male', 25, 50000,
       $2, 200, 200, 300, 300, 12, 35, 18, 14, 15, 1)
       RETURNING id`,
      [userId, castleId]
    );
    characterId = charResult.rows[0].id;
    console.log('  Created developer character: Derezo (level 25 elf wizard)');
  }

  // Import item generation functions
  const { generateItem, storeDroppedItem } = await import('../services/itemDropService.js');

  // Test items covering various rarities and types
  const testItems = [
    // Legendary wizard staff (high level)
    { templateId: 5, seed: 999001, level: 90, rarity: 'legendary' },
    // Epic wizard robe
    { templateId: 9, seed: 999002, level: 80, rarity: 'epic' },
    // Rare wizard hat
    { templateId: 25, seed: 999003, level: 60, rarity: 'rare' },
    // Legendary accessory
    { templateId: 11, seed: 999004, level: 85, rarity: 'legendary' },
    // Epic boots
    { templateId: 24, seed: 999005, level: 70, rarity: 'epic' },
    // Rare accessory
    { templateId: 10, seed: 999006, level: 50, rarity: 'rare' },
    // Rare weapon for testing
    { templateId: 1, seed: 999007, level: 30, rarity: 'rare' },
    // Epic weapon
    { templateId: 2, seed: 999008, level: 40, rarity: 'epic' },
    // Legendary weapon
    { templateId: 3, seed: 999009, level: 50, rarity: 'legendary' },
    // Armor variations
    { templateId: 7, seed: 999010, level: 35, rarity: 'rare' },
    { templateId: 8, seed: 999011, level: 45, rarity: 'epic' },
    // Consumables (should NOT have equipment augments)
    { templateId: 12, seed: 999012, level: 1, rarity: 'common' },
    { templateId: 29, seed: 999013, level: 1, rarity: 'uncommon' },
    { templateId: 15, seed: 999014, level: 1, rarity: 'epic' },
    // Uncommon items for comparison
    { templateId: 1, seed: 999015, level: 10, rarity: 'uncommon' },
    { templateId: 7, seed: 999016, level: 15, rarity: 'uncommon' },
  ];

  let createdCount = 0;
  for (const itemDef of testItems) {
    try {
      const item = await generateItem(
        itemDef.templateId,
        itemDef.seed,
        itemDef.level,
        itemDef.rarity
      );
      if (item) {
        await storeDroppedItem(userId, item);
        console.log(`  Created: ${item.generatedName} (${item.rarity})`);
        createdCount++;
      }
    } catch (err) {
      console.error(`  Failed to create item ${itemDef.templateId}:`, err.message);
    }
  }

  // Initialize fog of war discovery for the user
  await pool.query('SELECT discover_node_and_adjacent($1, $2)', [userId, castleId]);

  console.log(`Developer seed data created: user 'derezo' with ${createdCount} items`);
  console.log('  Login: derezo / password');
  console.log('  Gold: 30,000');

  // Seed marketplace data for chart testing
  await seedMarketplaceData(userId, characterId);
}

/**
 * Seed marketplace trade history for chart data
 * Creates realistic price fluctuations over the past 14 days for common items
 */
async function seedMarketplaceData(userId, characterId) {
  // Skip in production
  if (process.env.NODE_ENV === 'production') {
    console.log('Skipping marketplace seed data in production');
    return;
  }

  console.log('\nSeeding marketplace trade history...');

  const rng = new SeededRandom(54321);

  // Items to seed trade history for (templateId: basePrice)
  const tradedItems = [
    { templateId: 1, basePrice: 50 },   // Rusty Sword
    { templateId: 2, basePrice: 150 },  // Iron Sword
    { templateId: 7, basePrice: 80 },   // Leather Armor
    { templateId: 8, basePrice: 250 },  // Chain Mail
    { templateId: 12, basePrice: 25 },  // Health Potion (high volume)
    { templateId: 13, basePrice: 30 },  // Mana Potion (high volume)
    { templateId: 21, basePrice: 40 },  // Leather Helm
    { templateId: 29, basePrice: 100 }, // Hi-Potion
    { templateId: 10, basePrice: 100 }, // Lucky Charm
    { templateId: 6, basePrice: 45 },   // Combat Gloves
  ];

  const now = new Date();
  let totalTrades = 0;

  for (const item of tradedItems) {
    // Determine trade volume based on item type
    const isConsumable = item.templateId >= 12 && item.templateId <= 15 || item.templateId >= 29;
    const tradesPerDay = isConsumable ? rng.nextInt(8, 15) : rng.nextInt(2, 6);

    // Generate trades for the past 14 days
    for (let daysAgo = 14; daysAgo >= 0; daysAgo--) {
      const dayTrades = rng.nextInt(Math.floor(tradesPerDay * 0.5), Math.ceil(tradesPerDay * 1.5));

      // Create a price trend (random walk with mean reversion)
      let priceMultiplier = 1 + (rng.next() - 0.5) * 0.2; // ±10% base variation

      // Add some market events (occasional spikes/dips)
      if (rng.next() < 0.1) {
        priceMultiplier *= (0.8 + rng.next() * 0.4); // ±20% event
      }

      for (let t = 0; t < dayTrades; t++) {
        // Individual trade price variation
        const tradeVariation = 1 + (rng.next() - 0.5) * 0.1; // ±5% per trade
        const price = Math.round(item.basePrice * priceMultiplier * tradeVariation);
        const quantity = isConsumable ? rng.nextInt(1, 10) : rng.nextInt(1, 3);

        // Calculate trade timestamp within the day
        const tradeDate = new Date(now);
        tradeDate.setDate(tradeDate.getDate() - daysAgo);
        tradeDate.setHours(rng.nextInt(6, 22), rng.nextInt(0, 59), rng.nextInt(0, 59));

        // Insert trade record (null order IDs for seeded data)
        await pool.query(
          `INSERT INTO market_trades
           (buy_order_id, sell_order_id, item_template_id, buyer_id, seller_id, price, quantity, total_gold, executed_at)
           VALUES (NULL, NULL, $1, $2, $3, $4, $5, $6, $7)`,
          [
            item.templateId,
            userId,        // buyer
            userId,        // seller (self-trades for seed data)
            price,
            quantity,
            price * quantity,
            tradeDate
          ]
        );
        totalTrades++;
      }

      // Evolve price for next day (mean reversion)
      priceMultiplier = priceMultiplier * 0.9 + 1.0 * 0.1 + (rng.next() - 0.5) * 0.1;
    }
  }

  // Also seed some active orders for order book depth
  console.log('Seeding active market orders...');
  let orderCount = 0;

  for (const item of tradedItems.slice(0, 5)) { // Top 5 items
    // Create some buy orders (bids)
    for (let i = 0; i < rng.nextInt(3, 6); i++) {
      const bidPrice = Math.round(item.basePrice * (0.85 + rng.next() * 0.1)); // 85-95% of base
      const quantity = rng.nextInt(1, 5);

      await pool.query(
        `INSERT INTO market_orders
         (user_id, character_id, item_template_id, side, price, quantity, status, created_at)
         VALUES ($1, $2, $3, 'buy', $4, $5, 'open', NOW() - INTERVAL '${rng.nextInt(1, 72)} hours')`,
        [userId, characterId, item.templateId, bidPrice, quantity]
      );
      orderCount++;
    }

    // Create some sell orders (asks)
    for (let i = 0; i < rng.nextInt(3, 6); i++) {
      const askPrice = Math.round(item.basePrice * (1.05 + rng.next() * 0.15)); // 105-120% of base
      const quantity = rng.nextInt(1, 5);

      await pool.query(
        `INSERT INTO market_orders
         (user_id, character_id, item_template_id, side, price, quantity, status, created_at)
         VALUES ($1, $2, $3, 'sell', $4, $5, 'open', NOW() - INTERVAL '${rng.nextInt(1, 72)} hours')`,
        [userId, characterId, item.templateId, askPrice, quantity]
      );
      orderCount++;
    }
  }

  console.log(`Seeded ${totalTrades} market trades and ${orderCount} active orders`);
}

/**
 * Save seed metadata for smart seeding detection in dev-setup.sh
 * This allows the setup script to know if:
 * - The world seed has changed
 * - The seed version has been updated
 * - How many items/enemies/nodes were seeded
 */
async function saveSeedMetadata(client, worldSeed, nodeCount) {
  // Get counts from the database
  const itemCount = await client.query('SELECT COUNT(*) FROM item_templates');
  const enemyCount = await client.query('SELECT COUNT(*) FROM enemy_templates');

  // Upsert the seed metadata (only one row allowed)
  await client.query(`
    INSERT INTO seed_metadata (id, seed_version, world_seed, item_template_count, enemy_template_count, world_node_count, seeded_at)
    VALUES (1, $1, $2, $3, $4, $5, NOW())
    ON CONFLICT (id) DO UPDATE SET
      seed_version = EXCLUDED.seed_version,
      world_seed = EXCLUDED.world_seed,
      item_template_count = EXCLUDED.item_template_count,
      enemy_template_count = EXCLUDED.enemy_template_count,
      world_node_count = EXCLUDED.world_node_count,
      seeded_at = NOW()
  `, [SEED_VERSION, worldSeed, itemCount.rows[0].count, enemyCount.rows[0].count, nodeCount]);

  console.log(`\nSeed metadata saved: version=${SEED_VERSION}, world_seed=${worldSeed}`);
}

async function main() {
  const client = await pool.connect();

  try {
    console.log('Starting database seed...\n');

    // Clear existing data (in reverse dependency order)
    // RESTART IDENTITY resets auto-increment sequences so IDs start from 1
    console.log('Clearing existing data...');
    // Clear world_regions first since it references world_nodes
    await client.query('TRUNCATE world_regions RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE world_obstacles, world_node_connections, world_nodes RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE item_templates RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE enemy_templates RESTART IDENTITY CASCADE');
    // Clear shop inventory (will be re-seeded)
    await client.query('TRUNCATE npc_shop_inventory RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE shop_transactions RESTART IDENTITY CASCADE');
    // Clear marketplace data (will be re-seeded with dev test data)
    await client.query('TRUNCATE market_trades RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE market_orders RESTART IDENTITY CASCADE');

    // Generate world using 5-region system
    const worldSeed = parseInt(process.env.WORLD_SEED || '12345', 10);
    console.log(`\nGenerating world with seed: ${worldSeed}`);
    const { nodes, connections, obstacles, regions } = await generateWorld(worldSeed);

    // Insert world_regions FIRST (without node references) to satisfy foreign key
    // We'll update with node IDs after nodes are inserted
    console.log(`\nInserting ${regions.length} world regions (phase 1 - without node refs)...`);
    for (const region of regions) {
      await client.query(
        `INSERT INTO world_regions (id, race, dominant_terrain, secondary_terrains, boundary_polygon)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           race = EXCLUDED.race,
           dominant_terrain = EXCLUDED.dominant_terrain,
           secondary_terrains = EXCLUDED.secondary_terrains,
           boundary_polygon = EXCLUDED.boundary_polygon`,
        [
          region.id,
          region.race,
          region.dominant_terrain,
          JSON.stringify(region.secondary_terrains),
          region.boundary_polygon ? JSON.stringify(region.boundary_polygon) : null
        ]
      );
    }

    // Insert nodes with new regional columns
    console.log(`\nInserting ${nodes.length} world nodes...`);
    const nodeIds = [];
    for (const node of nodes) {
      const result = await client.query(
        `INSERT INTO world_nodes (node_type, name, x_coord, y_coord, distance_from_center, features, guild_class, local_seed, difficulty_tier, recruit_refresh_hour, is_terminator, shrine_buff_type, lore_key, region_id, region_race, ring_distance)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id`,
        [
          node.node_type,
          node.name,
          node.x_coord,
          node.y_coord,
          node.distance_from_center,
          node.features,
          node.guild_class,
          node.local_seed,
          node.difficulty_tier,
          node.recruit_refresh_hour,
          node.is_terminator,
          node.shrine_buff_type,
          node.lore_key,
          node.region_id,
          node.region_race,
          node.ring_distance
        ]
      );
      nodeIds.push(result.rows[0].id);
    }

    // Insert connections (single row per connection, normalized with smaller ID first)
    console.log(`Inserting ${connections.length} node connections...`);
    for (const conn of connections) {
      // Normalize connection to always have smaller ID first (bidirectional paths)
      const fromId = Math.min(nodeIds[conn.from], nodeIds[conn.to]);
      const toId = Math.max(nodeIds[conn.from], nodeIds[conn.to]);
      await client.query(
        `INSERT INTO world_node_connections (from_node_id, to_node_id, path_type)
         VALUES ($1, $2, 'road')
         ON CONFLICT DO NOTHING`,
        [fromId, toId]
      );
    }

    // Insert terrain obstacles
    console.log(`\nInserting ${obstacles.length} terrain obstacles...`);
    for (const obs of obstacles) {
      await client.query(
        `INSERT INTO world_obstacles (obstacle_type, x, y, radius, length, angle)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [obs.obstacle_type, obs.x, obs.y, obs.radius, obs.length, obs.angle]
      );
    }

    // Update world_regions with node ID references (phase 2)
    console.log(`\nUpdating ${regions.length} world regions with node references...`);
    for (const region of regions) {
      // Map node indices to actual node IDs
      const castleNodeId = region.castle_node_idx !== null ? nodeIds[region.castle_node_idx] : null;
      const keepNodeId = region.keep_node_idx !== null ? nodeIds[region.keep_node_idx] : null;
      const guildNodeId = region.guild_node_idx !== null ? nodeIds[region.guild_node_idx] : null;

      await client.query(
        `UPDATE world_regions SET
           castle_node_id = $2,
           keep_node_id = $3,
           guild_node_id = $4
         WHERE id = $1`,
        [
          region.id,
          castleNodeId,
          keepNodeId,
          guildNodeId
        ]
      );
    }
    console.log(`Updated ${regions.length} regions with node references`)

    // Seed items
    console.log('\nSeeding items...');
    await seedItems();

    // Seed enemies
    console.log('\nSeeding enemies...');
    await seedEnemies();

    // Seed shop inventory
    console.log('\nSeeding shop inventory...');
    await seedShopInventory(nodeIds, nodes);

    // Re-initialize user discovery for all existing users (fog of war)
    console.log('\nRe-initializing user discovery...');
    // Find the first castle node (Human Heartlands castle by default)
    const castleIdx = nodes.findIndex(n => n.node_type === 'castle');
    const castleId = castleIdx >= 0 ? nodeIds[castleIdx] : nodeIds[0];
    console.log(`  Using castle node ID ${castleId} (index ${castleIdx}) as starting point`);

    const usersResult = await client.query('SELECT id FROM users');
    for (const user of usersResult.rows) {
      await client.query('SELECT discover_node_and_adjacent($1, $2)', [user.id, castleId]);
    }
    console.log(`Initialized discovery for ${usersResult.rows.length} users`);

    // Seed developer test data (derezo user with test items)
    await seedDeveloperTestData(castleId);

    // Save seed metadata for smart seeding detection
    await saveSeedMetadata(client, worldSeed, nodes.length);

    console.log('\nSeed completed successfully!');
    console.log(`Total nodes: ${nodes.length}`);
    console.log(`Total connections: ${connections.length} (single-row, bidirectional travel)`);

  } catch (err) {
    console.error('Seed failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
