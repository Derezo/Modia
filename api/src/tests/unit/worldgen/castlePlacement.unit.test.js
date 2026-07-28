/**
 * Unit tests for worldgen/castlePlacement.js
 *
 * Tests pure math functions for castle placement:
 * - distanceBetween: Euclidean distance calculation
 * - findMinimumPairDistance: Minimum pairwise distance
 * - clampToBounds: Boundary clamping
 * - applyForceDirectedRepulsion: Force-directed repulsion simulation
 * - applyLloydsRelaxation: Lloyd's relaxation for even distribution
 * - generateCastlePlacements: Full pipeline with RNG
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  distanceBetween,
  findMinimumPairDistance,
  clampToBounds,
  applyForceDirectedRepulsion,
  applyLloydsRelaxation,
  generateCastlePlacements
} from '../../../db/worldgen/castlePlacement.js';

import { CASTLE_PLACEMENT } from '../../../db/worldgen/constants.js';
import { SeededRandom } from '../../../config/constants.js';

// =============================================================================
// distanceBetween
// =============================================================================

describe('distanceBetween', () => {
  it('returns 0 for the same point', () => {
    const p = { x: 5, y: 10 };
    assert.strictEqual(distanceBetween(p, p), 0);
  });

  it('calculates horizontal distance', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    assert.strictEqual(distanceBetween(a, b), 10);
  });

  it('calculates vertical distance', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 7 };
    assert.strictEqual(distanceBetween(a, b), 7);
  });

  it('calculates Pythagorean 3-4-5 triangle', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 3, y: 4 };
    assert.strictEqual(distanceBetween(a, b), 5);
  });

  it('handles negative coordinates', () => {
    const a = { x: -3, y: -4 };
    const b = { x: 0, y: 0 };
    assert.strictEqual(distanceBetween(a, b), 5);
  });

  it('is symmetric', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 4, y: 6 };
    assert.strictEqual(distanceBetween(a, b), distanceBetween(b, a));
  });
});

// =============================================================================
// findMinimumPairDistance
// =============================================================================

describe('findMinimumPairDistance', () => {
  it('returns Infinity for a single point', () => {
    assert.strictEqual(findMinimumPairDistance([{ x: 0, y: 0 }]), Infinity);
  });

  it('returns correct distance for two points', () => {
    const positions = [{ x: 0, y: 0 }, { x: 3, y: 4 }];
    assert.strictEqual(findMinimumPairDistance(positions), 5);
  });

  it('returns the smallest distance among three points', () => {
    const positions = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 1, y: 0 }
    ];
    // Closest pair: (0,0) and (1,0) with distance 1
    assert.strictEqual(findMinimumPairDistance(positions), 1);
  });

  it('returns 0 for overlapping points', () => {
    const positions = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 20, y: 20 }
    ];
    assert.strictEqual(findMinimumPairDistance(positions), 0);
  });

  it('returns Infinity for empty array', () => {
    assert.strictEqual(findMinimumPairDistance([]), Infinity);
  });
});

// =============================================================================
// clampToBounds
// =============================================================================

describe('clampToBounds', () => {
  it('returns value unchanged when within bounds', () => {
    // range=30, padding=2 => limit=28, so [-28, 28] is valid
    assert.strictEqual(clampToBounds(10, 30, 2), 10);
  });

  it('clamps positive overflow', () => {
    // range=30, padding=2 => limit=28
    assert.strictEqual(clampToBounds(35, 30, 2), 28);
  });

  it('clamps negative overflow', () => {
    // range=30, padding=2 => limit=28
    assert.strictEqual(clampToBounds(-35, 30, 2), -28);
  });

  it('returns boundary value at exact limit', () => {
    assert.strictEqual(clampToBounds(28, 30, 2), 28);
    assert.strictEqual(clampToBounds(-28, 30, 2), -28);
  });

  it('handles zero padding', () => {
    assert.strictEqual(clampToBounds(50, 30, 0), 30);
    assert.strictEqual(clampToBounds(-50, 30, 0), -30);
  });

  it('handles zero value within bounds', () => {
    assert.strictEqual(clampToBounds(0, 30, 2), 0);
  });
});

// =============================================================================
// applyForceDirectedRepulsion
// =============================================================================

describe('applyForceDirectedRepulsion', () => {
  it('pushes overlapping positions apart', () => {
    const positions = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 }
    ];
    const result = applyForceDirectedRepulsion(positions, 25, 500);
    const minDist = findMinimumPairDistance(result);
    // After repulsion, points should be further apart
    assert.ok(minDist > 2, `Min distance ${minDist} should be greater than initial 1`);
  });

  it('leaves well-spaced positions mostly unchanged', () => {
    const positions = [
      { x: -25, y: 0 },
      { x: 0, y: 25 },
      { x: 25, y: 0 }
    ];
    const result = applyForceDirectedRepulsion(positions, 10, 100);
    // Already well-spaced at ~35 units apart, min distance 10
    // Positions should remain roughly the same
    for (let i = 0; i < positions.length; i++) {
      const moved = distanceBetween(positions[i], result[i]);
      assert.ok(moved < 5, `Point ${i} moved ${moved} units, expected minimal movement`);
    }
  });

  it('does not mutate input positions', () => {
    const positions = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const origX = positions[0].x;
    applyForceDirectedRepulsion(positions, 25, 100);
    assert.strictEqual(positions[0].x, origX);
  });

  it('keeps positions within bounds', () => {
    const positions = [
      { x: 28, y: 28 },
      { x: 27, y: 27 },
      { x: 26, y: 26 }
    ];
    const result = applyForceDirectedRepulsion(positions, 25, 500);
    const range = CASTLE_PLACEMENT.POSITION_RANGE;
    const padding = CASTLE_PLACEMENT.BOUNDARY_PADDING;
    const limit = range - padding;
    for (const p of result) {
      assert.ok(p.x >= -limit && p.x <= limit, `x=${p.x} out of bounds [-${limit}, ${limit}]`);
      assert.ok(p.y >= -limit && p.y <= limit, `y=${p.y} out of bounds [-${limit}, ${limit}]`);
    }
  });

  it('uses the supplied seed-derived rotation to separate coincident pairs', () => {
    const positions = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    const first = applyForceDirectedRepulsion(positions, 25, 10, 0);
    const second = applyForceDirectedRepulsion(positions, 25, 10, 1);

    assert.ok(findMinimumPairDistance(first) > 0);
    assert.ok(findMinimumPairDistance(second) > 0);
    assert.notDeepStrictEqual(first, second);
  });
});

// =============================================================================
// applyLloydsRelaxation
// =============================================================================

describe('applyLloydsRelaxation', () => {
  it('does not mutate input positions', () => {
    const positions = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: -10, y: 0 }
    ];
    const origX = positions[0].x;
    applyLloydsRelaxation(positions, 3);
    assert.strictEqual(positions[0].x, origX);
  });

  it('keeps positions within bounds', () => {
    const positions = [
      { x: 25, y: 25 },
      { x: -25, y: -25 },
      { x: 20, y: -20 },
      { x: -20, y: 20 },
      { x: 0, y: 0 }
    ];
    const result = applyLloydsRelaxation(positions, 5);
    const range = CASTLE_PLACEMENT.POSITION_RANGE;
    const padding = CASTLE_PLACEMENT.BOUNDARY_PADDING;
    const limit = range - padding;
    for (const p of result) {
      assert.ok(p.x >= -limit && p.x <= limit, `x=${p.x} out of bounds`);
      assert.ok(p.y >= -limit && p.y <= limit, `y=${p.y} out of bounds`);
    }
  });

  it('returns same number of positions as input', () => {
    const positions = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: -10, y: -10 }
    ];
    const result = applyLloydsRelaxation(positions, 3);
    assert.strictEqual(result.length, positions.length);
  });

  it('moves points away from the centroid', () => {
    // Clustered points near center
    const positions = [
      { x: 5, y: 0 },
      { x: -5, y: 0 },
      { x: 0, y: 5 },
      { x: 0, y: -5 },
      { x: 10, y: 10 }
    ];
    const result = applyLloydsRelaxation(positions, 5);

    // After relaxation, the average distance from centroid should increase
    // (Lloyd's in this implementation pushes outward)
    const centroidX = positions.reduce((s, p) => s + p.x, 0) / positions.length;
    const centroidY = positions.reduce((s, p) => s + p.y, 0) / positions.length;

    const initialAvgDist = positions.reduce(
      (s, p) => s + Math.hypot(p.x - centroidX, p.y - centroidY), 0
    ) / positions.length;

    const resultCentroidX = result.reduce((s, p) => s + p.x, 0) / result.length;
    const resultCentroidY = result.reduce((s, p) => s + p.y, 0) / result.length;

    const resultAvgDist = result.reduce(
      (s, p) => s + Math.hypot(p.x - resultCentroidX, p.y - resultCentroidY), 0
    ) / result.length;

    assert.ok(
      resultAvgDist >= initialAvgDist * 0.9,
      `Average distance from centroid should not shrink significantly: ${resultAvgDist.toFixed(2)} vs initial ${initialAvgDist.toFixed(2)}`
    );
  });
});

// =============================================================================
// generateCastlePlacements
// =============================================================================

describe('generateCastlePlacements', () => {
  it('returns 5 castle positions', () => {
    const rng = new SeededRandom(42);
    const castles = generateCastlePlacements(rng);
    assert.strictEqual(castles.length, 5);
  });

  it('is deterministic with same seed', () => {
    const castles1 = generateCastlePlacements(new SeededRandom(12345));
    const castles2 = generateCastlePlacements(new SeededRandom(12345));
    for (let i = 0; i < castles1.length; i++) {
      assert.strictEqual(castles1[i].x, castles2[i].x, `x mismatch at index ${i}`);
      assert.strictEqual(castles1[i].y, castles2[i].y, `y mismatch at index ${i}`);
    }
  });

  it('positions are within POSITION_RANGE bounds', () => {
    const rng = new SeededRandom(99);
    const castles = generateCastlePlacements(rng);
    const range = CASTLE_PLACEMENT.POSITION_RANGE;
    for (const castle of castles) {
      assert.ok(
        castle.x >= -range && castle.x <= range,
        `x=${castle.x} out of range [-${range}, ${range}]`
      );
      assert.ok(
        castle.y >= -range && castle.y <= range,
        `y=${castle.y} out of range [-${range}, ${range}]`
      );
    }
  });

  it('achieves minimum pair distance >= MIN_DISTANCE', () => {
    const rng = new SeededRandom(42);
    const castles = generateCastlePlacements(rng);
    const minDist = findMinimumPairDistance(castles);
    assert.ok(
      minDist >= CASTLE_PLACEMENT.MIN_DISTANCE,
      `Min distance ${minDist.toFixed(2)} below ${CASTLE_PLACEMENT.MIN_DISTANCE}`
    );
  });

  it('assigns a region to each castle', () => {
    const rng = new SeededRandom(42);
    const castles = generateCastlePlacements(rng);
    for (const castle of castles) {
      assert.ok(castle.region, 'Castle should have a region assigned');
      assert.ok(castle.region.name, 'Region should have a name');
    }
  });

  it('assigns all 5 unique regions', () => {
    const rng = new SeededRandom(42);
    const castles = generateCastlePlacements(rng);
    const regionNames = new Set(castles.map(c => c.region.name));
    assert.strictEqual(regionNames.size, 5, `Expected 5 unique regions, got ${regionNames.size}`);
  });

  it('produces different results with different seeds', () => {
    const castles1 = generateCastlePlacements(new SeededRandom(1));
    const castles2 = generateCastlePlacements(new SeededRandom(9999));
    // At least one position should differ
    let anyDifferent = false;
    for (let i = 0; i < castles1.length; i++) {
      if (castles1[i].x !== castles2[i].x || castles1[i].y !== castles2[i].y) {
        anyDifferent = true;
        break;
      }
    }
    assert.ok(anyDifferent, 'Different seeds should produce different placements');
  });

  it('finalizes castles as frozen integer coordinates with stable identities', () => {
    const rng = new SeededRandom(42);
    const castles = generateCastlePlacements(rng);
    assert.ok(Object.isFrozen(castles));
    assert.strictEqual(new Set(castles.map(castle => castle.castleKey)).size, 5);
    assert.strictEqual(new Set(castles.map(castle => castle.regionId)).size, 5);

    for (const castle of castles) {
      assert.ok(Number.isInteger(castle.x), `x=${castle.x} is not an integer`);
      assert.ok(Number.isInteger(castle.y), `y=${castle.y} is not an integer`);
      assert.ok(Object.isFrozen(castle));
      assert.strictEqual(castle.castleKey, `castle:${castle.regionId}`);
    }
  });

  it('performs bounded deterministic resampling before fallback', () => {
    class CountingRandom extends SeededRandom {
      constructor(seed) {
        super(seed);
        this.nextIntCalls = 0;
      }

      nextInt(min, max) {
        this.nextIntCalls++;
        return super.nextInt(min, max);
      }
    }

    const rng = new CountingRandom(445);
    const castles = generateCastlePlacements(rng);

    assert.strictEqual(rng.nextIntCalls, 20, 'seed 445 should succeed on its second ordinary sample');
    assert.ok(findMinimumPairDistance(castles) >= CASTLE_PLACEMENT.MIN_DISTANCE);
  });

  it('derives coincident-candidate separation from the supplied random stream', () => {
    class CoincidentRandom {
      constructor(rotationDraw) {
        this.rotationDraw = rotationDraw;
        this.nextCalls = 0;
      }

      nextInt() {
        return 0;
      }

      next() {
        this.nextCalls++;
        return this.rotationDraw;
      }

      shuffle(values) {
        return [...values];
      }
    }

    const firstRng = new CoincidentRandom(0);
    const secondRng = new CoincidentRandom(0.25);
    const first = generateCastlePlacements(firstRng);
    const second = generateCastlePlacements(secondRng);

    assert.strictEqual(firstRng.nextCalls, 1);
    assert.strictEqual(secondRng.nextCalls, 1);
    assert.notDeepStrictEqual(
      first.map(({ x, y }) => [x, y]),
      second.map(({ x, y }) => [x, y])
    );
  });

  it('uses the well-spaced fallback only after all ordinary samples are exhausted', () => {
    class InvalidSampleRandom {
      constructor() {
        this.nextIntCalls = 0;
      }

      nextInt() {
        this.nextIntCalls++;
        return Number.NaN;
      }

      next() {
        return 0.25;
      }

      shuffle(values) {
        return [...values];
      }
    }

    const rng = new InvalidSampleRandom();
    const castles = generateCastlePlacements(rng);

    assert.strictEqual(rng.nextIntCalls, 80, 'expected 8 complete samples of 10 coordinates');
    assert.ok(findMinimumPairDistance(castles) >= CASTLE_PLACEMENT.MIN_DISTANCE);
    assert.ok(castles.every(({ x, y }) => Number.isInteger(x) && Number.isInteger(y)));
  });

  it('keeps collision regression seeds 86 and 445 distinct and deterministic', () => {
    for (const seed of [86, 445]) {
      const first = generateCastlePlacements(new SeededRandom(seed));
      const second = generateCastlePlacements(new SeededRandom(seed));

      assert.deepStrictEqual(first, second, `seed ${seed} was not deterministic`);
      assert.strictEqual(new Set(first.map(({ x, y }) => `${x},${y}`)).size, 5);
      assert.ok(findMinimumPairDistance(first) >= CASTLE_PLACEMENT.MIN_DISTANCE);
    }
  });
});
