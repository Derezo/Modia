/**
 * Unit tests for battle/aoeService.js
 *
 * Tests AoE (Area of Effect) tile calculations and unit targeting.
 * All functions are pure and stateless.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  getAoETiles,
  getUnitsInAoE
} from '../../../services/battle/aoeService.js';

// =============================================================================
// getAoETiles - Circle Pattern
// =============================================================================

describe('getAoETiles - circle pattern', () => {
  it('returns center tile only for radius 0', () => {
    const tiles = getAoETiles(5, 5, 0, 'circle');

    assert.strictEqual(tiles.length, 1);
    assert.deepStrictEqual(tiles[0], { x: 5, y: 5, isCenter: true });
  });

  it('returns 5 tiles for radius 1 (center + 4 adjacent)', () => {
    const tiles = getAoETiles(5, 5, 1, 'circle');

    // Radius 1: center + 4 cardinal directions
    assert.strictEqual(tiles.length, 5);

    const center = tiles.find(t => t.isCenter);
    assert.ok(center, 'Should have center tile');
    assert.deepStrictEqual(center, { x: 5, y: 5, isCenter: true });

    // Check we have all 4 cardinal neighbors
    const nonCenter = tiles.filter(t => !t.isCenter);
    assert.strictEqual(nonCenter.length, 4);
  });

  it('returns 13 tiles for radius 2 (diamond shape)', () => {
    const tiles = getAoETiles(0, 0, 2, 'circle');

    // Radius 2 Manhattan distance creates a diamond:
    // - 1 center (0,0)
    // - 4 at distance 1
    // - 8 at distance 2 (but diagonal tiles count as 2)
    // Total: 1 + 4 + 8 = 13
    assert.strictEqual(tiles.length, 13);
  });

  it('returns 25 tiles for radius 3', () => {
    const tiles = getAoETiles(10, 10, 3, 'circle');

    // Radius 3: 1 + 4 + 8 + 12 = 25
    assert.strictEqual(tiles.length, 25);
  });

  it('marks only center tile as isCenter', () => {
    const tiles = getAoETiles(5, 5, 2, 'circle');

    const centerTiles = tiles.filter(t => t.isCenter);
    assert.strictEqual(centerTiles.length, 1);
    assert.strictEqual(centerTiles[0].x, 5);
    assert.strictEqual(centerTiles[0].y, 5);
  });

  it('respects target position offset', () => {
    const tiles = getAoETiles(100, 200, 1, 'circle');

    const center = tiles.find(t => t.isCenter);
    assert.strictEqual(center.x, 100);
    assert.strictEqual(center.y, 200);

    // All tiles should be within radius of target
    for (const tile of tiles) {
      const dist = Math.abs(tile.x - 100) + Math.abs(tile.y - 200);
      assert.ok(dist <= 1, `Tile (${tile.x}, ${tile.y}) is outside radius 1`);
    }
  });

  it('uses circle as default pattern', () => {
    const withPattern = getAoETiles(0, 0, 1, 'circle');
    const withDefault = getAoETiles(0, 0, 1); // No pattern specified

    assert.deepStrictEqual(withDefault, withPattern);
  });

  it('handles negative coordinates', () => {
    const tiles = getAoETiles(-5, -10, 1, 'circle');

    const center = tiles.find(t => t.isCenter);
    assert.strictEqual(center.x, -5);
    assert.strictEqual(center.y, -10);

    // Should still have 5 tiles
    assert.strictEqual(tiles.length, 5);
  });
});

// =============================================================================
// getAoETiles - Cross Pattern
// =============================================================================

describe('getAoETiles - cross pattern', () => {
  it('returns center tile only for radius 0', () => {
    // Cross with radius 0 should just be center
    const tiles = getAoETiles(5, 5, 0, 'cross');

    assert.strictEqual(tiles.length, 1);
    assert.deepStrictEqual(tiles[0], { x: 5, y: 5, isCenter: true });
  });

  it('returns 5 tiles for radius 1 (center + 4 cardinal)', () => {
    const tiles = getAoETiles(5, 5, 1, 'cross');

    assert.strictEqual(tiles.length, 5);

    // Verify center
    const center = tiles.find(t => t.isCenter);
    assert.ok(center);
    assert.strictEqual(center.x, 5);
    assert.strictEqual(center.y, 5);

    // Verify cardinal directions
    const coords = tiles.map(t => `${t.x},${t.y}`);
    assert.ok(coords.includes('5,5'));   // center
    assert.ok(coords.includes('5,4'));   // north
    assert.ok(coords.includes('5,6'));   // south
    assert.ok(coords.includes('4,5'));   // west
    assert.ok(coords.includes('6,5'));   // east
  });

  it('returns 9 tiles for radius 2 (center + 2 in each direction)', () => {
    const tiles = getAoETiles(5, 5, 2, 'cross');

    // Cross pattern: center + 2 tiles in each of 4 directions
    assert.strictEqual(tiles.length, 9);

    const coords = tiles.map(t => `${t.x},${t.y}`);
    // North direction
    assert.ok(coords.includes('5,4'));
    assert.ok(coords.includes('5,3'));
    // South direction
    assert.ok(coords.includes('5,6'));
    assert.ok(coords.includes('5,7'));
    // West direction
    assert.ok(coords.includes('4,5'));
    assert.ok(coords.includes('3,5'));
    // East direction
    assert.ok(coords.includes('6,5'));
    assert.ok(coords.includes('7,5'));
  });

  it('does not include diagonal tiles', () => {
    const tiles = getAoETiles(5, 5, 2, 'cross');

    const coords = tiles.map(t => `${t.x},${t.y}`);
    // Diagonals should NOT be included
    assert.ok(!coords.includes('6,6'));
    assert.ok(!coords.includes('4,4'));
    assert.ok(!coords.includes('6,4'));
    assert.ok(!coords.includes('4,6'));
  });
});

// =============================================================================
// getAoETiles - Line Pattern
// =============================================================================

describe('getAoETiles - line pattern', () => {
  it('returns tiles in north direction (0)', () => {
    const tiles = getAoETiles(5, 5, 3, 'line', 0);

    // Line going north: (5,5), (5,4), (5,3), (5,2)
    assert.strictEqual(tiles.length, 4);

    const coords = tiles.map(t => `${t.x},${t.y}`);
    assert.ok(coords.includes('5,5'));
    assert.ok(coords.includes('5,4'));
    assert.ok(coords.includes('5,3'));
    assert.ok(coords.includes('5,2'));
  });

  it('returns tiles in east direction (2)', () => {
    const tiles = getAoETiles(5, 5, 3, 'line', 2);

    // Line going east: (5,5), (6,5), (7,5), (8,5)
    assert.strictEqual(tiles.length, 4);

    const coords = tiles.map(t => `${t.x},${t.y}`);
    assert.ok(coords.includes('5,5'));
    assert.ok(coords.includes('6,5'));
    assert.ok(coords.includes('7,5'));
    assert.ok(coords.includes('8,5'));
  });

  it('returns tiles in south direction (4)', () => {
    const tiles = getAoETiles(5, 5, 3, 'line', 4);

    // Line going south: (5,5), (5,6), (5,7), (5,8)
    const coords = tiles.map(t => `${t.x},${t.y}`);
    assert.ok(coords.includes('5,5'));
    assert.ok(coords.includes('5,6'));
    assert.ok(coords.includes('5,7'));
    assert.ok(coords.includes('5,8'));
  });

  it('returns tiles in diagonal direction (1 = NE)', () => {
    const tiles = getAoETiles(5, 5, 2, 'line', 1);

    // Line going northeast: (5,5), (6,4), (7,3)
    const coords = tiles.map(t => `${t.x},${t.y}`);
    assert.ok(coords.includes('5,5'));
    assert.ok(coords.includes('6,4'));
    assert.ok(coords.includes('7,3'));
  });

  it('marks starting tile as center', () => {
    const tiles = getAoETiles(5, 5, 3, 'line', 0);

    const center = tiles.find(t => t.isCenter);
    assert.ok(center);
    assert.strictEqual(center.x, 5);
    assert.strictEqual(center.y, 5);
  });

  it('wraps direction values (direction 8 = direction 0)', () => {
    const direction8 = getAoETiles(5, 5, 2, 'line', 8);
    const direction0 = getAoETiles(5, 5, 2, 'line', 0);

    // Should be equivalent (both north)
    const coords8 = direction8.map(t => `${t.x},${t.y}`).sort();
    const coords0 = direction0.map(t => `${t.x},${t.y}`).sort();
    assert.deepStrictEqual(coords8, coords0);
  });

  it('includes starting tile for radius 0', () => {
    const tiles = getAoETiles(5, 5, 0, 'line', 0);

    assert.strictEqual(tiles.length, 1);
    assert.strictEqual(tiles[0].x, 5);
    assert.strictEqual(tiles[0].y, 5);
  });
});

// =============================================================================
// getUnitsInAoE
// =============================================================================

describe('getUnitsInAoE', () => {
  const createUnit = (id, x, y, hp = 100) => ({
    id,
    tileX: x,
    tileY: y,
    hp
  });

  it('returns empty array when no units in AoE', () => {
    const units = [
      createUnit(1, 0, 0),
      createUnit(2, 10, 10)
    ];

    const result = getUnitsInAoE(units, 5, 5, 1, 'circle');

    assert.deepStrictEqual(result, []);
  });

  it('returns unit at center position', () => {
    const units = [createUnit(1, 5, 5)];

    const result = getUnitsInAoE(units, 5, 5, 1, 'circle');

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].unit.id, 1);
    assert.strictEqual(result[0].isCenter, true);
  });

  it('returns units within radius', () => {
    const units = [
      createUnit(1, 5, 5),  // center
      createUnit(2, 5, 4),  // 1 north
      createUnit(3, 6, 5),  // 1 east
      createUnit(4, 5, 3),  // 2 north (outside radius 1)
    ];

    const result = getUnitsInAoE(units, 5, 5, 1, 'circle');

    assert.strictEqual(result.length, 3);

    const unitIds = result.map(r => r.unit.id);
    assert.ok(unitIds.includes(1));
    assert.ok(unitIds.includes(2));
    assert.ok(unitIds.includes(3));
    assert.ok(!unitIds.includes(4));
  });

  it('marks center unit correctly', () => {
    const units = [
      createUnit(1, 5, 5),  // at center
      createUnit(2, 5, 4)   // not at center
    ];

    const result = getUnitsInAoE(units, 5, 5, 2, 'circle');

    const centerUnit = result.find(r => r.unit.id === 1);
    const edgeUnit = result.find(r => r.unit.id === 2);

    assert.strictEqual(centerUnit.isCenter, true);
    assert.strictEqual(edgeUnit.isCenter, false);
  });

  it('excludes dead units (hp <= 0)', () => {
    const units = [
      createUnit(1, 5, 5, 100),  // alive
      createUnit(2, 5, 4, 0),    // dead
      createUnit(3, 6, 5, -10)   // dead (negative)
    ];

    const result = getUnitsInAoE(units, 5, 5, 1, 'circle');

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].unit.id, 1);
  });

  it('finds units in cross pattern', () => {
    const units = [
      createUnit(1, 5, 5),  // center
      createUnit(2, 5, 3),  // 2 north (in cross)
      createUnit(3, 6, 4)   // diagonal (not in cross)
    ];

    const result = getUnitsInAoE(units, 5, 5, 2, 'cross');

    const unitIds = result.map(r => r.unit.id);
    assert.ok(unitIds.includes(1));
    assert.ok(unitIds.includes(2));
    assert.ok(!unitIds.includes(3));  // diagonal excluded from cross
  });

  it('handles empty unit array', () => {
    const result = getUnitsInAoE([], 5, 5, 3, 'circle');

    assert.deepStrictEqual(result, []);
  });

  it('handles large radius', () => {
    const units = [
      createUnit(1, 0, 0),
      createUnit(2, 10, 0),
      createUnit(3, 0, 10),
      createUnit(4, 10, 10)
    ];

    const result = getUnitsInAoE(units, 5, 5, 10, 'circle');

    // All units should be within Manhattan distance 10 from (5,5)
    assert.strictEqual(result.length, 4);
  });

  it('returns unit objects with original properties', () => {
    const units = [
      { id: 1, tileX: 5, tileY: 5, hp: 100, name: 'TestUnit', customProp: 'value' }
    ];

    const result = getUnitsInAoE(units, 5, 5, 1, 'circle');

    assert.strictEqual(result[0].unit.name, 'TestUnit');
    assert.strictEqual(result[0].unit.customProp, 'value');
  });

  it('uses circle pattern by default', () => {
    const units = [createUnit(1, 5, 5)];

    const withPattern = getUnitsInAoE(units, 5, 5, 1, 'circle');
    const withDefault = getUnitsInAoE(units, 5, 5, 1);

    assert.strictEqual(withDefault.length, withPattern.length);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('AoE Edge Cases', () => {
  it('getAoETiles with radius 0 returns single tile', () => {
    const circle = getAoETiles(0, 0, 0, 'circle');
    const cross = getAoETiles(0, 0, 0, 'cross');

    assert.strictEqual(circle.length, 1);
    assert.strictEqual(cross.length, 1);
  });

  it('getAoETiles handles very large radius', () => {
    const tiles = getAoETiles(0, 0, 10, 'circle');

    // Radius 10 circle: should have many tiles
    // Formula: sum of 4*i for i=1 to r, plus 1 for center
    // = 1 + 4*(1+2+...+10) = 1 + 4*55 = 221
    assert.strictEqual(tiles.length, 221);
  });

  it('getUnitsInAoE handles multiple units on same tile', () => {
    // This shouldn't normally happen in game, but test the behavior
    // The implementation uses Array.find() which returns only the first match per tile
    const units = [
      { id: 1, tileX: 5, tileY: 5, hp: 100 },
      { id: 2, tileX: 5, tileY: 5, hp: 50 }
    ];

    const result = getUnitsInAoE(units, 5, 5, 1, 'circle');

    // Only first unit per tile is found due to find() behavior
    // This is acceptable since game logic prevents multiple units per tile
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].unit.id, 1);
    assert.ok(result[0].isCenter);
  });

  it('getAoETiles produces unique coordinates', () => {
    const tiles = getAoETiles(5, 5, 3, 'circle');

    const coords = tiles.map(t => `${t.x},${t.y}`);
    const uniqueCoords = [...new Set(coords)];

    assert.strictEqual(coords.length, uniqueCoords.length, 'All tiles should have unique coordinates');
  });

  it('line pattern direction values map correctly', () => {
    // Test all 8 directions
    const directions = [
      { dir: 0, expectedDelta: { dx: 0, dy: -1 } },   // N
      { dir: 1, expectedDelta: { dx: 1, dy: -1 } },   // NE
      { dir: 2, expectedDelta: { dx: 1, dy: 0 } },    // E
      { dir: 3, expectedDelta: { dx: 1, dy: 1 } },    // SE
      { dir: 4, expectedDelta: { dx: 0, dy: 1 } },    // S
      { dir: 5, expectedDelta: { dx: -1, dy: 1 } },   // SW
      { dir: 6, expectedDelta: { dx: -1, dy: 0 } },   // W
      { dir: 7, expectedDelta: { dx: -1, dy: -1 } }   // NW
    ];

    for (const { dir, expectedDelta } of directions) {
      const tiles = getAoETiles(5, 5, 1, 'line', dir);

      // Should have 2 tiles: center and one in direction
      assert.strictEqual(tiles.length, 2, `Direction ${dir} should produce 2 tiles`);

      const nonCenter = tiles.find(t => !t.isCenter);
      const actualDx = nonCenter.x - 5;
      const actualDy = nonCenter.y - 5;

      assert.strictEqual(actualDx, expectedDelta.dx, `Direction ${dir} dx`);
      assert.strictEqual(actualDy, expectedDelta.dy, `Direction ${dir} dy`);
    }
  });
});
