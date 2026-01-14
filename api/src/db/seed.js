import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import pg from 'pg';
import { SeededRandom, CITY_OPTIONS, CASTLE_FEATURES, REGIONS } from '../config/constants.js';

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
async function generateWorld(seed) {
  const rng = new SeededRandom(seed);

  function generateNodeName(type) {
    const prefixes = NODE_NAME_PREFIXES[type] || NODE_NAME_PREFIXES.city;
    const suffixes = NODE_NAME_SUFFIXES[type] || NODE_NAME_SUFFIXES.city;
    return `${rng.pick(prefixes)} ${rng.pick(suffixes)}`;
  }

  console.log('Generating world with 300+ nodes using Poisson disk sampling...');

  // Step 0: Generate terrain obstacles first
  const obstacles = generateObstacles(rng);

  // Step 1: Generate node positions (avoiding obstacles)
  const positions = generateNodePlacements(rng, 320, 3.5, obstacles);
  console.log(`Generated ${positions.length} node positions`);

  // Step 2: Assign node types based on distance
  const typedNodes = assignNodeTypes(rng, positions);

  // Step 3: Build MST for guaranteed connectivity
  const mstConnections = buildMinimumSpanningTree(typedNodes);
  console.log(`MST created with ${mstConnections.length} connections`);

  // Step 4: Add extra connections for variety (validates adjacency rules)
  const extraConnections = addLocalConnections(rng, typedNodes, mstConnections, 0.25);
  console.log(`Connections after local additions: ${extraConnections.length}`);

  // Step 5: Enforce connection constraints (min/max per node type)
  const allConnections = enforceConnectionConstraints(rng, typedNodes, extraConnections);
  console.log(`Final connections after constraints: ${allConnections.length}`);

  // Step 6: Assign terminator nodes at map edges
  assignTerminatorNodes(rng, typedNodes, allConnections);

  // Step 7: Build final node objects
  // Track guild index for staggered refresh hours (0, 6, 12, 18 hours)
  let guildIndex = 0;
  const GUILD_REFRESH_HOURS = [0, 6, 12, 18]; // Staggered across the day

  const nodes = typedNodes.map(node => {
    const nodeObj = {
      node_type: node.type,
      name: node.type === 'castle' ? 'Royal Castle' :
            node.type === 'palace' ? 'Ancient Palace' :
            node.type === 'guild' ? `${node.guildClass.charAt(0).toUpperCase() + node.guildClass.slice(1)}s' Guild` :
            generateNodeName(node.type),
      x_coord: Math.round(node.x),
      y_coord: Math.round(node.y),
      distance_from_center: Math.round(node.dist),
      features: JSON.stringify(generateNodeFeatures(rng, node.type)),
      guild_class: node.guildClass || null,
      local_seed: rng.nextInt(1, 1000000),
      difficulty_tier: getDifficultyTier(node.dist, node.type),
      recruit_refresh_hour: null,
      is_terminator: node.isTerminator || false,
      shrine_buff_type: node.shrineBuffType || null,
      lore_key: node.loreKey || null
    };

    // Assign staggered refresh hours to guild nodes
    if (node.type === 'guild') {
      nodeObj.recruit_refresh_hour = GUILD_REFRESH_HOURS[guildIndex % GUILD_REFRESH_HOURS.length];
      guildIndex++;
    }

    return nodeObj;
  });

  return { nodes, connections: allConnections, obstacles };
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
    await client.query('TRUNCATE world_obstacles, world_node_connections, world_nodes RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE item_templates RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE enemy_templates RESTART IDENTITY CASCADE');
    // Clear shop inventory (will be re-seeded)
    await client.query('TRUNCATE npc_shop_inventory RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE shop_transactions RESTART IDENTITY CASCADE');
    // Clear marketplace data (will be re-seeded with dev test data)
    await client.query('TRUNCATE market_trades RESTART IDENTITY CASCADE');
    await client.query('TRUNCATE market_orders RESTART IDENTITY CASCADE');

    // Generate world
    const worldSeed = parseInt(process.env.WORLD_SEED || '12345', 10);
    console.log(`\nGenerating world with seed: ${worldSeed}`);
    const { nodes, connections, obstacles } = await generateWorld(worldSeed);

    // Insert nodes
    console.log(`\nInserting ${nodes.length} world nodes...`);
    const nodeIds = [];
    for (const node of nodes) {
      const result = await client.query(
        `INSERT INTO world_nodes (node_type, name, x_coord, y_coord, distance_from_center, features, guild_class, local_seed, difficulty_tier, recruit_refresh_hour, is_terminator, shrine_buff_type, lore_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [node.node_type, node.name, node.x_coord, node.y_coord, node.distance_from_center, node.features, node.guild_class, node.local_seed, node.difficulty_tier, node.recruit_refresh_hour, node.is_terminator, node.shrine_buff_type, node.lore_key]
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
    const castleId = nodeIds[0]; // First node is always the castle
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
