/**
 * Unit tests for worldgen/voronoiPartitioning.js
 *
 * Tests pure helper functions for Voronoi-based region partitioning:
 * - calculatePolygonProperties: Centroid and area calculations
 * - calculateEdgeLength: Edge length calculation
 * - calculateEdgeMidpoint: Edge midpoint finding
 * - findFarthestPointFromCastles: Fallback palace positioning
 * - getRegionBorders: Border connection type determination
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  calculatePolygonProperties,
  calculateEdgeLength,
  calculateEdgeMidpoint,
  findFarthestPointFromCastles,
  getRegionBorders,
  findSharedEdge
} from '../../../db/worldgen/voronoiPartitioning.js';

// =============================================================================
// calculatePolygonProperties
// =============================================================================

describe('calculatePolygonProperties', () => {
  describe('area calculation', () => {
    it('calculates area of a unit square', () => {
      // Square from (0,0) to (1,1)
      const polygon = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0]  // closed polygon
      ];

      const { area } = calculatePolygonProperties(polygon);

      assert.ok(Math.abs(area - 1) < 0.001, `Expected area ~1, got ${area}`);
    });

    it('calculates area of a 10x10 square', () => {
      const polygon = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0]
      ];

      const { area } = calculatePolygonProperties(polygon);

      assert.ok(Math.abs(area - 100) < 0.001, `Expected area ~100, got ${area}`);
    });

    it('calculates area of a triangle', () => {
      // Right triangle with base 4 and height 3
      // Area = 0.5 * 4 * 3 = 6
      const polygon = [
        [0, 0],
        [4, 0],
        [0, 3],
        [0, 0]
      ];

      const { area } = calculatePolygonProperties(polygon);

      assert.ok(Math.abs(area - 6) < 0.001, `Expected area ~6, got ${area}`);
    });

    it('handles polygon with negative coordinates', () => {
      // Square centered at origin
      const polygon = [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
        [-5, -5]
      ];

      const { area } = calculatePolygonProperties(polygon);

      assert.ok(Math.abs(area - 100) < 0.001, `Expected area ~100, got ${area}`);
    });

    it('returns positive area regardless of winding order', () => {
      // Clockwise square
      const cw = [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0]
      ];

      // Counter-clockwise square
      const ccw = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0]
      ];

      const { area: areaCW } = calculatePolygonProperties(cw);
      const { area: areaCCW } = calculatePolygonProperties(ccw);

      assert.ok(areaCW > 0, 'Clockwise should have positive area');
      assert.ok(areaCCW > 0, 'Counter-clockwise should have positive area');
      assert.ok(Math.abs(areaCW - areaCCW) < 0.001, 'Areas should match');
    });
  });

  describe('centroid calculation', () => {
    it('finds centroid of a square at origin', () => {
      const polygon = [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0]
      ];

      const { centroid } = calculatePolygonProperties(polygon);

      assert.ok(Math.abs(centroid.x - 1) < 0.001, `Expected centroid.x ~1, got ${centroid.x}`);
      assert.ok(Math.abs(centroid.y - 1) < 0.001, `Expected centroid.y ~1, got ${centroid.y}`);
    });

    it('finds centroid of offset rectangle', () => {
      const polygon = [
        [10, 20],
        [20, 20],
        [20, 30],
        [10, 30],
        [10, 20]
      ];

      const { centroid } = calculatePolygonProperties(polygon);

      assert.ok(Math.abs(centroid.x - 15) < 0.001, `Expected centroid.x ~15, got ${centroid.x}`);
      assert.ok(Math.abs(centroid.y - 25) < 0.001, `Expected centroid.y ~25, got ${centroid.y}`);
    });

    it('finds centroid of equilateral triangle', () => {
      // Equilateral triangle with vertices at (0,0), (2,0), (1, sqrt(3))
      const h = Math.sqrt(3);
      const polygon = [
        [0, 0],
        [2, 0],
        [1, h],
        [0, 0]
      ];

      const { centroid } = calculatePolygonProperties(polygon);

      // Centroid is at (1, sqrt(3)/3)
      assert.ok(Math.abs(centroid.x - 1) < 0.01, `Expected centroid.x ~1, got ${centroid.x}`);
      assert.ok(Math.abs(centroid.y - h / 3) < 0.01, `Expected centroid.y ~${(h / 3).toFixed(2)}, got ${centroid.y}`);
    });
  });

  describe('edge cases', () => {
    it('handles degenerate polygon (line)', () => {
      // A line (no area)
      const polygon = [
        [0, 0],
        [5, 0],
        [0, 0]
      ];

      const { area, centroid } = calculatePolygonProperties(polygon);

      // Area should be very small or zero
      assert.ok(area < 1, 'Degenerate polygon should have minimal area');
    });

    it('handles single point polygon', () => {
      const polygon = [[5, 10]];

      const { centroid } = calculatePolygonProperties(polygon);

      // Should fall back to average of vertices
      assert.strictEqual(centroid.x, 5);
      assert.strictEqual(centroid.y, 10);
    });

    it('handles two point polygon', () => {
      const polygon = [
        [0, 0],
        [10, 10]
      ];

      const { centroid } = calculatePolygonProperties(polygon);

      // With area ~0, should fall back to vertex average
      // Average: (0+10)/2, (0+10)/2 = (5, 5)
      assert.ok(Math.abs(centroid.x - 5) < 1);
      assert.ok(Math.abs(centroid.y - 5) < 1);
    });
  });
});

// =============================================================================
// calculateEdgeLength
// =============================================================================

describe('calculateEdgeLength', () => {
  it('returns 0 for single point', () => {
    const points = [{ x: 5, y: 10 }];

    const length = calculateEdgeLength(points);

    assert.strictEqual(length, 0);
  });

  it('returns 0 for empty points', () => {
    const points = [];

    const length = calculateEdgeLength(points);

    assert.strictEqual(length, 0);
  });

  it('calculates distance between two points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 3, y: 4 }  // 3-4-5 triangle
    ];

    const length = calculateEdgeLength(points);

    assert.strictEqual(length, 5);
  });

  it('calculates horizontal edge length', () => {
    const points = [
      { x: 0, y: 5 },
      { x: 10, y: 5 }
    ];

    const length = calculateEdgeLength(points);

    assert.strictEqual(length, 10);
  });

  it('calculates vertical edge length', () => {
    const points = [
      { x: 5, y: 0 },
      { x: 5, y: 7 }
    ];

    const length = calculateEdgeLength(points);

    assert.strictEqual(length, 7);
  });

  it('calculates total length for multi-segment edge', () => {
    // L-shaped path: right 3, then up 4
    const points = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 }
    ];

    const length = calculateEdgeLength(points);

    // 3 + 4 = 7
    assert.strictEqual(length, 7);
  });

  it('handles diagonal segments', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 }
    ];

    // Each segment is sqrt(2) long
    const expected = Math.sqrt(2) * 2;
    const length = calculateEdgeLength(points);

    assert.ok(Math.abs(length - expected) < 0.001);
  });
});

// =============================================================================
// calculateEdgeMidpoint
// =============================================================================

describe('calculateEdgeMidpoint', () => {
  it('returns origin for empty points', () => {
    const points = [];

    const midpoint = calculateEdgeMidpoint(points);

    assert.deepStrictEqual(midpoint, { x: 0, y: 0 });
  });

  it('returns the point for single point', () => {
    const points = [{ x: 5, y: 10 }];

    const midpoint = calculateEdgeMidpoint(points);

    assert.deepStrictEqual(midpoint, { x: 5, y: 10 });
  });

  it('calculates midpoint of two points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 10 }
    ];

    const midpoint = calculateEdgeMidpoint(points);

    assert.deepStrictEqual(midpoint, { x: 5, y: 5 });
  });

  it('calculates midpoint of horizontal edge', () => {
    const points = [
      { x: 0, y: 5 },
      { x: 20, y: 5 }
    ];

    const midpoint = calculateEdgeMidpoint(points);

    assert.deepStrictEqual(midpoint, { x: 10, y: 5 });
  });

  it('returns middle point for odd number of points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },   // middle
      { x: 10, y: 10 }
    ];

    const midpoint = calculateEdgeMidpoint(points);

    // Should return the actual middle point, not interpolated
    assert.deepStrictEqual(midpoint, { x: 5, y: 5 });
  });

  it('returns middle-ish point for even number of points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 2, y: 2 },
      { x: 4, y: 4 },
      { x: 6, y: 6 }
    ];

    const midpoint = calculateEdgeMidpoint(points);

    // floor(4/2) = 2, so points[2] = (4,4)
    assert.deepStrictEqual(midpoint, { x: 4, y: 4 });
  });
});

// =============================================================================
// findFarthestPointFromCastles
// =============================================================================

describe('findFarthestPointFromCastles', () => {
  it('finds point far from single castle at center', () => {
    const castles = [{ x: 0, y: 0 }];

    const point = findFarthestPointFromCastles(castles);

    // Should be near a corner of the world bounds
    const distFromCastle = Math.hypot(point.x, point.y);
    assert.ok(distFromCastle > 30, `Point should be far from castle, got ${distFromCastle}`);
  });

  it('finds point balanced from multiple castles', () => {
    // Castles in the middle area
    const castles = [
      { x: -10, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: -10 },
      { x: 0, y: 10 }
    ];

    const point = findFarthestPointFromCastles(castles);

    // Point should be far from all castles (at a corner or edge)
    for (const castle of castles) {
      const dist = Math.hypot(point.x - castle.x, point.y - castle.y);
      assert.ok(dist > 20, `Point should be far from castle at (${castle.x}, ${castle.y})`);
    }
  });

  it('returns a point with x and y properties', () => {
    const castles = [{ x: 0, y: 0 }];

    const point = findFarthestPointFromCastles(castles);

    assert.ok('x' in point);
    assert.ok('y' in point);
    assert.strictEqual(typeof point.x, 'number');
    assert.strictEqual(typeof point.y, 'number');
  });

  it('handles castles near boundaries', () => {
    const castles = [
      { x: -45, y: -45 },  // near bottom-left
      { x: 45, y: 45 }     // near top-right
    ];

    const point = findFarthestPointFromCastles(castles);

    // Should find a corner opposite to both
    const minDist = Math.min(
      Math.hypot(point.x - castles[0].x, point.y - castles[0].y),
      Math.hypot(point.x - castles[1].x, point.y - castles[1].y)
    );
    assert.ok(minDist > 10, 'Should find a point reasonably far from both');
  });
});

// =============================================================================
// getRegionBorders
// =============================================================================

describe('getRegionBorders', () => {
  it('classifies short borders as bridge_only', () => {
    const mockVoronoiData = {
      edges: [
        {
          region1: 0,
          region2: 1,
          region1Name: 'Region A',
          region2Name: 'Region B',
          points: [{ x: 0, y: 0 }, { x: 5, y: 0 }],
          length: 5,  // < 10 units
          midpoint: { x: 2.5, y: 0 }
        }
      ]
    };

    const borders = getRegionBorders(mockVoronoiData);

    assert.strictEqual(borders.length, 1);
    assert.strictEqual(borders[0].connectionType, 'bridge_only');
    assert.strictEqual(borders[0].edgeLength, 5);
  });

  it('classifies medium borders as bridge_wilderness', () => {
    const mockVoronoiData = {
      edges: [
        {
          region1: 0,
          region2: 1,
          region1Name: 'Region A',
          region2Name: 'Region B',
          points: [{ x: 0, y: 0 }, { x: 15, y: 0 }],
          length: 15,  // >= 10, < 20 units
          midpoint: { x: 7.5, y: 0 }
        }
      ]
    };

    const borders = getRegionBorders(mockVoronoiData);

    assert.strictEqual(borders.length, 1);
    assert.strictEqual(borders[0].connectionType, 'bridge_wilderness');
  });

  it('classifies long borders as bridge_wilderness_trade', () => {
    const mockVoronoiData = {
      edges: [
        {
          region1: 0,
          region2: 1,
          region1Name: 'Region A',
          region2Name: 'Region B',
          points: [{ x: 0, y: 0 }, { x: 25, y: 0 }],
          length: 25,  // >= 20 units
          midpoint: { x: 12.5, y: 0 }
        }
      ]
    };

    const borders = getRegionBorders(mockVoronoiData);

    assert.strictEqual(borders.length, 1);
    assert.strictEqual(borders[0].connectionType, 'bridge_wilderness_trade');
  });

  it('preserves region names in output', () => {
    const mockVoronoiData = {
      edges: [
        {
          region1: 0,
          region2: 2,
          region1Name: 'Heartlands',
          region2Name: 'Frostpeak',
          points: [],
          length: 15,
          midpoint: { x: 0, y: 0 }
        }
      ]
    };

    const borders = getRegionBorders(mockVoronoiData);

    assert.strictEqual(borders[0].region1Name, 'Heartlands');
    assert.strictEqual(borders[0].region2Name, 'Frostpeak');
  });

  it('preserves midpoint coordinates', () => {
    const mockVoronoiData = {
      edges: [
        {
          region1: 0,
          region2: 1,
          region1Name: 'A',
          region2Name: 'B',
          points: [],
          length: 10,
          midpoint: { x: 42, y: 73 }
        }
      ]
    };

    const borders = getRegionBorders(mockVoronoiData);

    assert.deepStrictEqual(borders[0].midpoint, { x: 42, y: 73 });
  });

  it('handles multiple edges', () => {
    const mockVoronoiData = {
      edges: [
        { region1: 0, region2: 1, region1Name: 'A', region2Name: 'B', points: [], length: 5, midpoint: { x: 0, y: 0 } },
        { region1: 1, region2: 2, region1Name: 'B', region2Name: 'C', points: [], length: 15, midpoint: { x: 0, y: 0 } },
        { region1: 2, region2: 0, region1Name: 'C', region2Name: 'A', points: [], length: 25, midpoint: { x: 0, y: 0 } }
      ]
    };

    const borders = getRegionBorders(mockVoronoiData);

    assert.strictEqual(borders.length, 3);
    assert.strictEqual(borders[0].connectionType, 'bridge_only');       // 5 < 10
    assert.strictEqual(borders[1].connectionType, 'bridge_wilderness'); // 10 <= 15 < 20
    assert.strictEqual(borders[2].connectionType, 'bridge_wilderness_trade'); // 25 >= 20
  });

  it('handles empty edges array', () => {
    const mockVoronoiData = { edges: [] };

    const borders = getRegionBorders(mockVoronoiData);

    assert.deepStrictEqual(borders, []);
  });

  it('border connection type boundaries are correct', () => {
    // Test exact boundary values
    const createEdge = (length) => ({
      region1: 0, region2: 1, region1Name: 'A', region2Name: 'B',
      points: [], length, midpoint: { x: 0, y: 0 }
    });

    // Just under 10
    assert.strictEqual(
      getRegionBorders({ edges: [createEdge(9.99)] })[0].connectionType,
      'bridge_only'
    );

    // Exactly 10
    assert.strictEqual(
      getRegionBorders({ edges: [createEdge(10)] })[0].connectionType,
      'bridge_wilderness'
    );

    // Just under 20
    assert.strictEqual(
      getRegionBorders({ edges: [createEdge(19.99)] })[0].connectionType,
      'bridge_wilderness'
    );

    // Exactly 20
    assert.strictEqual(
      getRegionBorders({ edges: [createEdge(20)] })[0].connectionType,
      'bridge_wilderness_trade'
    );
  });
});

// =============================================================================
// findSharedEdge
// =============================================================================

describe('findSharedEdge', () => {
  // Note: findSharedEdge requires a Voronoi object with cellPolygon method
  // We'll test with a mock that simulates the expected behavior

  it('returns empty array when either polygon is null', () => {
    const mockVoronoi = {
      cellPolygon: (idx) => idx === 0 ? [[0, 0], [1, 0], [0, 0]] : null
    };

    const result = findSharedEdge(mockVoronoi, 0, 1);

    assert.deepStrictEqual(result, []);
  });

  it('returns empty array when both polygons are null', () => {
    const mockVoronoi = {
      cellPolygon: () => null
    };

    const result = findSharedEdge(mockVoronoi, 0, 1);

    assert.deepStrictEqual(result, []);
  });

  it('finds shared vertices between adjacent polygons', () => {
    // Two squares sharing an edge
    // Square A: (0,0) -> (1,0) -> (1,1) -> (0,1)
    // Square B: (1,0) -> (2,0) -> (2,1) -> (1,1)
    // Shared edge: (1,0) and (1,1)

    const mockVoronoi = {
      cellPolygon: (idx) => {
        if (idx === 0) {
          return [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
        } else {
          return [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0]];
        }
      }
    };

    const result = findSharedEdge(mockVoronoi, 0, 1);

    // Should find 2 shared points: (1,0) and (1,1)
    assert.strictEqual(result.length, 2);

    const coords = result.map(p => `${p.x},${p.y}`);
    assert.ok(coords.includes('1,0'));
    assert.ok(coords.includes('1,1'));
  });

  it('returns empty array for non-adjacent polygons', () => {
    // Two squares not touching
    const mockVoronoi = {
      cellPolygon: (idx) => {
        if (idx === 0) {
          return [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
        } else {
          return [[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]];
        }
      }
    };

    const result = findSharedEdge(mockVoronoi, 0, 1);

    assert.strictEqual(result.length, 0);
  });
});
