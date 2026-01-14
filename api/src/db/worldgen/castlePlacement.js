/**
 * Castle Placement Module (Phase 1 of 5-Region World Generation)
 *
 * Generates well-spaced castle positions for the 5 game regions using:
 * - Force-directed repulsion to enforce minimum distance constraints
 * - Lloyd's relaxation for even distribution across the map
 *
 * The algorithm ensures castles are at least MIN_DISTANCE (25 units) apart
 * while staying within the POSITION_RANGE (-30 to 30) bounds.
 *
 * @module worldgen/castlePlacement
 */

import { CASTLE_PLACEMENT } from './constants.js';
import { SeededRandom, REGIONS } from '../../config/constants.js';

/**
 * Calculate Euclidean distance between two points
 * @param {Object} a - Point with x, y coordinates
 * @param {Object} b - Point with x, y coordinates
 * @returns {number} Distance between points
 */
export function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Find the minimum distance between any two positions in an array
 * @param {Array<{x: number, y: number}>} positions - Array of positions
 * @returns {number} Minimum distance between any pair
 */
export function findMinimumPairDistance(positions) {
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
export function clampToBounds(value, range, padding) {
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
export function applyForceDirectedRepulsion(positions, minDistance = CASTLE_PLACEMENT.MIN_DISTANCE, maxIterations = CASTLE_PLACEMENT.FORCE_MAX_ITERATIONS) {
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
export function applyLloydsRelaxation(positions, iterations = CASTLE_PLACEMENT.LLOYD_ITERATIONS) {
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
export function generateCastlePlacements(rng) {
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
export function validateCastlePlacement(seed = 12345) {
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
