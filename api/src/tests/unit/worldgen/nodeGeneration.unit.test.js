/**
 * Unit tests for worldgen/nodeGeneration.js
 *
 * Tests pure geometry and sampling functions:
 * - isPointInPolygon: Ray casting point-in-polygon test
 * - getPolygonBoundingBox: Bounding box calculation
 * - poissonDiskSampleInPolygon: Poisson disk sampling within polygon
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  isPointInPolygon,
  getPolygonBoundingBox,
  poissonDiskSampleInPolygon
} from '../../../db/worldgen/nodeGeneration.js';

import { SeededRandom } from '../../../config/constants.js';

// =============================================================================
// isPointInPolygon
// =============================================================================

describe('isPointInPolygon', () => {
  // Unit square: [0,0], [10,0], [10,10], [0,10]
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];

  it('returns true for a point inside a square', () => {
    assert.strictEqual(isPointInPolygon(5, 5, square), true);
  });

  it('returns true for a point near the center', () => {
    assert.strictEqual(isPointInPolygon(1, 1, square), true);
  });

  it('returns false for a point clearly outside', () => {
    assert.strictEqual(isPointInPolygon(15, 15, square), false);
  });

  it('returns false for a point to the left', () => {
    assert.strictEqual(isPointInPolygon(-5, 5, square), false);
  });

  it('returns false for a point below', () => {
    assert.strictEqual(isPointInPolygon(5, -5, square), false);
  });

  it('returns false for a point above', () => {
    assert.strictEqual(isPointInPolygon(5, 15, square), false);
  });

  it('returns true for point inside a triangle', () => {
    const triangle = [[0, 0], [10, 0], [5, 10]];
    assert.strictEqual(isPointInPolygon(5, 3, triangle), true);
  });

  it('returns false for point outside a triangle', () => {
    const triangle = [[0, 0], [10, 0], [5, 10]];
    assert.strictEqual(isPointInPolygon(0, 10, triangle), false);
  });

  it('handles concave polygon correctly', () => {
    // L-shaped polygon (concave)
    const lShape = [[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10]];

    // Inside the bottom part
    assert.strictEqual(isPointInPolygon(7, 2, lShape), true);
    // Inside the left part
    assert.strictEqual(isPointInPolygon(2, 7, lShape), true);
    // In the concave cutout (should be outside)
    assert.strictEqual(isPointInPolygon(7, 7, lShape), false);
  });

  it('handles large polygon with many vertices', () => {
    // Create a rough circle with 8 vertices
    const radius = 10;
    const polygon = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      polygon.push([
        Math.cos(angle) * radius,
        Math.sin(angle) * radius
      ]);
    }
    // Center should be inside
    assert.strictEqual(isPointInPolygon(0, 0, polygon), true);
    // Far outside
    assert.strictEqual(isPointInPolygon(20, 20, polygon), false);
  });

  it('handles negative coordinate polygons', () => {
    const polygon = [[-20, -20], [0, -20], [0, 0], [-20, 0]];
    assert.strictEqual(isPointInPolygon(-10, -10, polygon), true);
    assert.strictEqual(isPointInPolygon(5, 5, polygon), false);
  });
});

// =============================================================================
// getPolygonBoundingBox
// =============================================================================

describe('getPolygonBoundingBox', () => {
  it('calculates bounding box for a unit square', () => {
    const polygon = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const bbox = getPolygonBoundingBox(polygon);
    assert.strictEqual(bbox.minX, 0);
    assert.strictEqual(bbox.maxX, 10);
    assert.strictEqual(bbox.minY, 0);
    assert.strictEqual(bbox.maxY, 10);
  });

  it('handles negative coordinates', () => {
    const polygon = [[-5, -3], [5, -3], [5, 7], [-5, 7]];
    const bbox = getPolygonBoundingBox(polygon);
    assert.strictEqual(bbox.minX, -5);
    assert.strictEqual(bbox.maxX, 5);
    assert.strictEqual(bbox.minY, -3);
    assert.strictEqual(bbox.maxY, 7);
  });

  it('handles irregular polygon', () => {
    const polygon = [[1, 5], [3, 1], [8, 2], [6, 9], [2, 7]];
    const bbox = getPolygonBoundingBox(polygon);
    assert.strictEqual(bbox.minX, 1);
    assert.strictEqual(bbox.maxX, 8);
    assert.strictEqual(bbox.minY, 1);
    assert.strictEqual(bbox.maxY, 9);
  });

  it('handles triangle', () => {
    const triangle = [[0, 0], [10, 0], [5, 8]];
    const bbox = getPolygonBoundingBox(triangle);
    assert.strictEqual(bbox.minX, 0);
    assert.strictEqual(bbox.maxX, 10);
    assert.strictEqual(bbox.minY, 0);
    assert.strictEqual(bbox.maxY, 8);
  });

  it('handles a single point polygon', () => {
    const polygon = [[3, 7]];
    const bbox = getPolygonBoundingBox(polygon);
    assert.strictEqual(bbox.minX, 3);
    assert.strictEqual(bbox.maxX, 3);
    assert.strictEqual(bbox.minY, 7);
    assert.strictEqual(bbox.maxY, 7);
  });

  it('handles polygon spanning all quadrants', () => {
    const polygon = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
    const bbox = getPolygonBoundingBox(polygon);
    assert.strictEqual(bbox.minX, -10);
    assert.strictEqual(bbox.maxX, 10);
    assert.strictEqual(bbox.minY, -10);
    assert.strictEqual(bbox.maxY, 10);
  });
});

// =============================================================================
// poissonDiskSampleInPolygon
// =============================================================================

describe('poissonDiskSampleInPolygon', () => {
  // Large square polygon for sampling
  const largeSquare = [[-20, -20], [20, -20], [20, 20], [-20, 20]];
  const minDistance = 3.5;
  const targetCount = 50;
  const startPoint = { x: 0, y: 0 };

  it('generates samples within the polygon', () => {
    const rng = new SeededRandom(42);
    const samples = poissonDiskSampleInPolygon(largeSquare, minDistance, rng, targetCount, startPoint);

    assert.ok(samples.length > 0, 'Should generate at least one sample');

    for (const sample of samples) {
      assert.ok(
        isPointInPolygon(sample.x, sample.y, largeSquare),
        `Sample (${sample.x.toFixed(2)}, ${sample.y.toFixed(2)}) should be inside polygon`
      );
    }
  });

  it('maintains minimum distance between all samples', () => {
    const rng = new SeededRandom(42);
    const samples = poissonDiskSampleInPolygon(largeSquare, minDistance, rng, targetCount, startPoint);

    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        const dist = Math.hypot(samples[i].x - samples[j].x, samples[i].y - samples[j].y);
        assert.ok(
          dist >= minDistance * 0.99, // Small tolerance for floating point
          `Samples ${i} and ${j} too close: ${dist.toFixed(2)} < ${minDistance}`
        );
      }
    }
  });

  it('generates a reasonable number of samples', () => {
    const rng = new SeededRandom(42);
    const samples = poissonDiskSampleInPolygon(largeSquare, minDistance, rng, targetCount, startPoint);

    // For a 40x40 area with minDistance 3.5, we expect a decent number of samples
    assert.ok(samples.length >= 10, `Expected at least 10 samples, got ${samples.length}`);
    // Should not exceed targetCount * 1.5 (the loop limit)
    assert.ok(samples.length <= targetCount * 1.5, `Too many samples: ${samples.length}`);
  });

  it('is deterministic with the same seed', () => {
    const samples1 = poissonDiskSampleInPolygon(
      largeSquare, minDistance, new SeededRandom(123), targetCount, startPoint
    );
    const samples2 = poissonDiskSampleInPolygon(
      largeSquare, minDistance, new SeededRandom(123), targetCount, startPoint
    );

    assert.strictEqual(samples1.length, samples2.length, 'Same seed should produce same count');
    for (let i = 0; i < samples1.length; i++) {
      assert.strictEqual(samples1[i].x, samples2[i].x, `x mismatch at sample ${i}`);
      assert.strictEqual(samples1[i].y, samples2[i].y, `y mismatch at sample ${i}`);
    }
  });

  it('includes the start point as the first sample', () => {
    const rng = new SeededRandom(42);
    const samples = poissonDiskSampleInPolygon(largeSquare, minDistance, rng, targetCount, startPoint);

    assert.strictEqual(samples[0].x, startPoint.x, 'First sample x should match start point');
    assert.strictEqual(samples[0].y, startPoint.y, 'First sample y should match start point');
  });

  it('produces different results with different seeds', () => {
    const samples1 = poissonDiskSampleInPolygon(
      largeSquare, minDistance, new SeededRandom(1), targetCount, startPoint
    );
    const samples2 = poissonDiskSampleInPolygon(
      largeSquare, minDistance, new SeededRandom(9999), targetCount, startPoint
    );

    // At least one sample should differ (besides the start point)
    let anyDifferent = false;
    const minLen = Math.min(samples1.length, samples2.length);
    for (let i = 1; i < minLen; i++) {
      if (samples1[i].x !== samples2[i].x || samples1[i].y !== samples2[i].y) {
        anyDifferent = true;
        break;
      }
    }
    assert.ok(anyDifferent, 'Different seeds should produce different samples');
  });

  it('works with a small polygon', () => {
    const smallSquare = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
    const rng = new SeededRandom(42);
    const samples = poissonDiskSampleInPolygon(smallSquare, minDistance, rng, targetCount, startPoint);

    assert.ok(samples.length > 0, 'Should generate samples in small polygon');
    // Fewer samples expected in smaller area
    assert.ok(
      samples.length < targetCount,
      `Small polygon should produce fewer than ${targetCount} samples, got ${samples.length}`
    );
  });

  it('handles start point outside polygon by finding alternative', () => {
    const polygon = [[10, 10], [20, 10], [20, 20], [10, 20]];
    const outsideStart = { x: 0, y: 0 }; // Outside the polygon
    const rng = new SeededRandom(42);
    const samples = poissonDiskSampleInPolygon(polygon, minDistance, rng, targetCount, outsideStart);

    // Should still generate samples using the centroid or random fallback
    assert.ok(samples.length > 0, 'Should generate samples even with outside start point');

    // All samples should be inside the polygon
    for (const sample of samples) {
      assert.ok(
        isPointInPolygon(sample.x, sample.y, polygon),
        `Sample (${sample.x.toFixed(2)}, ${sample.y.toFixed(2)}) outside polygon`
      );
    }
  });
});
