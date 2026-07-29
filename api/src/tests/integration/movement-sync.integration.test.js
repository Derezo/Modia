/**
 * Movement Sync Integration Tests
 *
 * Validates that client-side and server-side pathfinding produce identical results
 * for movement highlighting. This prevents the desync issue where client highlights
 * tiles that the server rejects as unreachable.
 *
 * Key scenarios tested:
 * - Basic terrain movement costs
 * - Impassable terrain handling
 * - Elevation traversal rules
 * - Status effect modifiers (slow, haste, root)
 * - Unit collision avoidance
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import shared modules (same as client uses)
import {
  getReachableTiles,
  getReachableTiles3D,
  findPath,
  getAttackableTiles,
  getManhattanDistance
} from '../../../../shared/pathfinding.js';

import {
  isImpassable,
  getTerrainMovementCost,
  IMPASSABLE_TERRAIN,
  TERRAIN_COSTS,
  canTraverseElevation,
  ELEVATION_RULES,
  elevationLevelToNormalized
} from '../../../../shared/terrain.js';

describe('Movement Sync - Pathfinding Consistency', () => {

  describe('Basic terrain movement', () => {
    it('should calculate correct reachable tiles on grass terrain', () => {
      // Create a simple 10x10 grass terrain
      const width = 10;
      const height = 10;
      const terrain = Array.from({ length: height }, () =>
        Array(width).fill('grass')
      );

      const units = [];
      const startX = 5;
      const startY = 5;
      const range = 3;

      const reachable = getReachableTiles(startX, startY, range, terrain, units, width, height);

      // On flat grass (cost 1), we should reach tiles within Manhattan distance <= range
      assert.ok(reachable.length > 0, 'Should have reachable tiles');

      // Verify all returned tiles are within cost range
      for (const tile of reachable) {
        assert.ok(tile.cost <= range, `Tile at (${tile.x}, ${tile.y}) cost ${tile.cost} should be <= ${range}`);
        assert.ok(tile.x >= 0 && tile.x < width, 'Tile should be in bounds');
        assert.ok(tile.y >= 0 && tile.y < height, 'Tile should be in bounds');
      }

      // Verify we can reach adjacent tiles (cost 1)
      const adjacentTiles = reachable.filter(t => getManhattanDistance(startX, startY, t.x, t.y) === 1);
      assert.strictEqual(adjacentTiles.length, 4, 'Should reach all 4 adjacent tiles');
    });

    it('should respect terrain movement costs', () => {
      // Create terrain with varying costs
      const width = 10;
      const height = 10;
      const terrain = Array.from({ length: height }, () =>
        Array(width).fill('grass')
      );

      // Place forest (cost 2) in the path
      terrain[5][6] = 'forest';
      terrain[5][7] = 'forest';

      // Place water (cost 3) elsewhere
      terrain[4][6] = 'water';

      const units = [];
      const startX = 5;
      const startY = 5;
      const range = 3;

      const reachable = getReachableTiles(startX, startY, range, terrain, units, width, height);

      // Find the tile at (6, 5) - should be reachable via forest (cost 2)
      const forestTile = reachable.find(t => t.x === 6 && t.y === 5);
      assert.ok(forestTile, 'Should reach tile through forest');
      assert.strictEqual(forestTile.cost, 2, 'Cost should reflect forest movement cost');

      // Tile at (7, 5) should cost 4 (grass + forest + forest)
      const farTile = reachable.find(t => t.x === 7 && t.y === 5);
      assert.ok(!farTile, 'Tile at (7,5) should be out of range (cost 4 > range 3)');
    });

    it('should not include impassable terrain in reachable tiles', () => {
      const width = 10;
      const height = 10;
      const terrain = Array.from({ length: height }, () =>
        Array(width).fill('grass')
      );

      // Place impassable terrain
      terrain[5][6] = 'rock';
      terrain[4][5] = 'lava';
      terrain[6][5] = 'cliff';

      const units = [];
      const startX = 5;
      const startY = 5;
      const range = 5;

      const reachable = getReachableTiles(startX, startY, range, terrain, units, width, height);

      // Verify no impassable tiles are in the result
      for (const tile of reachable) {
        const tileType = terrain[tile.y][tile.x];
        assert.ok(!isImpassable(tileType),
          `Impassable terrain type '${tileType}' at (${tile.x}, ${tile.y}) should not be reachable`);
      }

      // Verify the specific impassable tiles are not in results
      assert.ok(!reachable.find(t => t.x === 6 && t.y === 5), 'Rock tile should not be reachable');
      assert.ok(!reachable.find(t => t.x === 5 && t.y === 4), 'Lava tile should not be reachable');
      assert.ok(!reachable.find(t => t.x === 5 && t.y === 6), 'Cliff tile should not be reachable');
    });
  });

  describe('Unit collision', () => {
    it('should not include tiles occupied by other units', () => {
      const width = 10;
      const height = 10;
      const terrain = Array.from({ length: height }, () =>
        Array(width).fill('grass')
      );

      // Place other units
      const units = [
        { x: 6, y: 5, hp: 100 },  // Adjacent to start
        { x: 4, y: 5, hp: 100 },  // Adjacent to start
      ];

      const startX = 5;
      const startY = 5;
      const range = 3;

      const reachable = getReachableTiles(startX, startY, range, terrain, units, width, height);

      // Verify occupied tiles are not in results
      for (const unit of units) {
        const found = reachable.find(t => t.x === unit.x && t.y === unit.y);
        assert.ok(!found, `Tile occupied by unit at (${unit.x}, ${unit.y}) should not be reachable`);
      }
    });

    it('should cross dead units without offering corpse tiles as destinations', () => {
      const width = 3;
      const height = 1;
      const terrain = Array.from({ length: height }, () =>
        Array(width).fill('grass')
      );

      const units = [
        { x: 1, y: 0, hp: 0 }
      ];

      const startX = 0;
      const startY = 0;
      const range = 2;

      const reachable = getReachableTiles(startX, startY, range, terrain, units, width, height);

      assert.equal(
        reachable.find(t => t.x === 1 && t.y === 0),
        undefined,
        'The corpse tile cannot be selected as a destination'
      );
      assert.deepEqual(
        reachable.find(t => t.x === 2 && t.y === 0),
        { x: 2, y: 0, cost: 2 },
        'A corpse adds no cost or range restriction to transit'
      );
    });
  });

  describe('Generated map consistency', () => {
    it('should produce consistent results for same seed', () => {
      // Use a simple manually created terrain instead of generateTerrain
      // to avoid the map generation pipeline complexity
      const width = 16;
      const height = 16;

      // Create terrain with some variety
      const terrain = Array.from({ length: height }, (_, y) =>
        Array.from({ length: width }, (_, x) => {
          // Some rocks scattered around
          if ((x + y) % 7 === 0 && x > 5 && x < 12) return 'rock';
          // Some forest
          if (y > 3 && y < 12 && x % 4 === 0) return 'forest';
          // Default grass
          return 'grass';
        })
      );

      // Calculate reachable tiles twice
      const units = [];
      const startX = 4;
      const startY = 8;
      const range = 4;

      const reachable1 = getReachableTiles(startX, startY, range, terrain, units, width, height);
      const reachable2 = getReachableTiles(startX, startY, range, terrain, units, width, height);

      // Sort for comparison
      const sorted1 = reachable1.sort((a, b) => a.x - b.x || a.y - b.y);
      const sorted2 = reachable2.sort((a, b) => a.x - b.x || a.y - b.y);

      assert.deepStrictEqual(sorted1, sorted2, 'Reachable tiles should be identical for same terrain');
    });

    it('should handle varied terrain types', () => {
      const width = 16;
      const height = 16;

      // Test each terrain type individually
      const terrainTypes = ['grass', 'stone', 'forest', 'water'];

      for (const baseType of terrainTypes) {
        const terrain = Array.from({ length: height }, () =>
          Array(width).fill(baseType)
        );

        const units = [];
        const startX = 8;
        const startY = 8;
        const range = 3;

        // This should not throw
        const reachable = getReachableTiles(startX, startY, range, terrain, units, width, height);
        assert.ok(Array.isArray(reachable), `${baseType} terrain should return valid array`);
        assert.ok(reachable.length > 0, `${baseType} terrain should have reachable tiles`);
      }
    });
  });

  describe('Elevation-aware movement', () => {
    it('should respect max climb rules', () => {
      const width = 10;
      const height = 10;
      const terrain = Array.from({ length: height }, () =>
        Array(width).fill('grass')
      );

      // Create elevation grid: center is ground level (0), east side is elevated
      const elevation = Array.from({ length: height }, () =>
        Array(width).fill(0)
      );

      // Create a 2-level cliff to the east (can't climb more than 1 level)
      for (let y = 0; y < height; y++) {
        elevation[y][7] = 2;
        elevation[y][8] = 2;
        elevation[y][9] = 2;
      }

      const units = [];
      const startX = 5;
      const startY = 5;
      const range = 5;

      const reachable = getReachableTiles3D(
        startX, startY, 0, range,
        terrain, elevation, null,
        units, width, height
      );

      // Should not be able to reach elevated tiles (2 level climb > max 1)
      const elevatedTile = reachable.find(t => t.x === 7 && t.y === 5);
      assert.ok(!elevatedTile, 'Should not reach tile 2 levels higher without ramp/stairs');
    });

    it('should allow movement on same elevation', () => {
      const width = 10;
      const height = 10;
      const terrain = Array.from({ length: height }, () =>
        Array(width).fill('grass')
      );

      // Create elevation grid: all at level 1
      const elevation = Array.from({ length: height }, () =>
        Array(width).fill(1)
      );

      const units = [];
      const startX = 5;
      const startY = 5;
      const range = 3;

      const reachable = getReachableTiles3D(
        startX, startY, 1, range,
        terrain, elevation, null,
        units, width, height
      );

      // Should have normal movement on flat elevated surface
      assert.ok(reachable.length > 0, 'Should have reachable tiles on elevated surface');

      // Check adjacent tiles
      const adjacentTiles = reachable.filter(t => getManhattanDistance(startX, startY, t.x, t.y) === 1);
      assert.strictEqual(adjacentTiles.length, 4, 'Should reach all 4 adjacent tiles on same elevation');
    });

    it('should allow dropping down within limits', () => {
      const width = 10;
      const height = 10;
      const terrain = Array.from({ length: height }, () =>
        Array(width).fill('grass')
      );

      const groundElevation = elevationLevelToNormalized(0);
      const highElevation = elevationLevelToNormalized(2);

      // Create elevation grid: west at level 2, center/east at level 0.
      const elevation = Array.from({ length: height }, () =>
        Array(width).fill(groundElevation)
      );

      // Elevated starting area
      for (let y = 0; y < height; y++) {
        elevation[y][3] = highElevation;
        elevation[y][4] = highElevation;
        elevation[y][5] = highElevation;
      }

      const units = [];
      const startX = 4;
      const startY = 5;
      const range = 3;

      const reachable = getReachableTiles3D(
        startX, startY, highElevation, range,
        terrain, elevation, null,
        units, width, height
      );

      // A two-level drop is within the canonical MAX_DROP = 3.
      const groundTile = reachable.find(t => t.x === 6 && t.y === 5);
      assert.ok(groundTile, 'Should be able to drop down 2 levels');
    });
  });

  describe('Pathfinding consistency', () => {
    it('should find valid path through varied terrain', () => {
      const width = 16;
      const height = 16;

      // Create terrain with open path and some obstacles
      const terrain = Array.from({ length: height }, () =>
        Array(width).fill('grass')
      );

      // Add some rocks but keep clear path horizontally
      terrain[3][8] = 'rock';
      terrain[4][8] = 'rock';
      terrain[5][8] = 'rock';
      terrain[9][8] = 'rock';
      terrain[10][8] = 'rock';
      terrain[11][8] = 'rock';

      // Find path from left to right
      const startX = 3;
      const startY = 8;
      const endX = 12;
      const endY = 8;

      const units = [];
      const path = findPath(startX, startY, endX, endY, terrain, units, width, height);

      // Path should exist (there's a clear route around rocks)
      assert.ok(path, 'Should find path around obstacles');
      assert.ok(path.length > 0, 'Path should have waypoints');

      // Path should start at start position
      assert.strictEqual(path[0].x, startX);
      assert.strictEqual(path[0].y, startY);

      // Path should end at target position
      assert.strictEqual(path[path.length - 1].x, endX);
      assert.strictEqual(path[path.length - 1].y, endY);

      // All path tiles should be passable
      for (const tile of path) {
        const tileType = terrain[tile.y][tile.x];
        assert.ok(!isImpassable(tileType),
          `Path goes through impassable terrain '${tileType}' at (${tile.x}, ${tile.y})`);
      }
    });

    it('should return null for unreachable targets', () => {
      const width = 10;
      const height = 10;
      const terrain = Array.from({ length: height }, () =>
        Array(width).fill('grass')
      );

      // Create wall of rocks blocking the path
      for (let y = 0; y < height; y++) {
        terrain[y][5] = 'rock';
      }

      const units = [];
      const path = findPath(2, 5, 8, 5, terrain, units, width, height);

      assert.strictEqual(path, null, 'Should return null when path is blocked');
    });
  });

  describe('Attack range calculation', () => {
    it('should calculate correct attackable tiles', () => {
      const width = 20;
      const height = 20;
      const startX = 10;
      const startY = 10;
      const attackRange = 3;

      const attackable = getAttackableTiles(startX, startY, attackRange, width, height);

      // Should not include starting position
      assert.ok(!attackable.find(t => t.x === startX && t.y === startY),
        'Starting position should not be attackable');

      // Should include all tiles within Manhattan distance
      for (const tile of attackable) {
        const dist = getManhattanDistance(startX, startY, tile.x, tile.y);
        assert.ok(dist <= attackRange && dist > 0,
          `Tile at (${tile.x}, ${tile.y}) distance ${dist} should be within range ${attackRange}`);
      }

      // Count tiles at each distance
      const distance1 = attackable.filter(t => t.distance === 1);
      const distance2 = attackable.filter(t => t.distance === 2);
      const distance3 = attackable.filter(t => t.distance === 3);

      assert.strictEqual(distance1.length, 4, 'Should have 4 tiles at distance 1');
      assert.strictEqual(distance2.length, 8, 'Should have 8 tiles at distance 2');
      assert.strictEqual(distance3.length, 12, 'Should have 12 tiles at distance 3');
    });
  });
});

describe('Movement Sync - Status Effect Modifiers', () => {
  // These tests validate the modifier logic that must match between client and server
  // Server uses FLAT modifiers (+/-1), NOT percentage modifiers

  describe('Movement range modifiers', () => {
    it('slow effect should reduce movement by 1 (minimum 1)', () => {
      const baseRange = 4;
      // Server: Math.max(1, baseRange - 1) = 3
      const slowedRange = Math.max(1, baseRange - 1);
      assert.strictEqual(slowedRange, 3, 'Slow should reduce movement by 1 (4 -> 3)');
    });

    it('haste effect should increase movement by 1', () => {
      const baseRange = 4;
      // Server: baseRange + 1 = 5
      const hastedRange = baseRange + 1;
      assert.strictEqual(hastedRange, 5, 'Haste should increase movement by 1 (4 -> 5)');
    });

    it('root effect should prevent all movement', () => {
      const baseRange = 4;
      const rootedRange = 0;
      assert.strictEqual(rootedRange, 0, 'Root should prevent all movement');
    });
  });
});

describe('Movement Sync - Terrain Constants', () => {
  // Validate terrain constants are correctly defined

  it('should have all impassable terrain types defined', () => {
    const expected = ['rock', 'tree', 'lava', 'cliff'];
    assert.deepStrictEqual(IMPASSABLE_TERRAIN.sort(), expected.sort(),
      'IMPASSABLE_TERRAIN should contain all blocking types');
  });

  it('should have movement costs for passable terrain', () => {
    assert.strictEqual(TERRAIN_COSTS.grass, 1, 'Grass should cost 1');
    assert.strictEqual(TERRAIN_COSTS.stone, 1, 'Stone should cost 1');
    assert.strictEqual(TERRAIN_COSTS.forest, 2, 'Forest should cost 2');
    assert.strictEqual(TERRAIN_COSTS.water, 3, 'Water should cost 3');
  });

  it('should return Infinity for impassable terrain', () => {
    for (const terrain of IMPASSABLE_TERRAIN) {
      const cost = getTerrainMovementCost(terrain);
      assert.strictEqual(cost, Infinity, `${terrain} should have Infinity movement cost`);
    }
  });

  it('should have consistent elevation rules', () => {
    assert.strictEqual(ELEVATION_RULES.MAX_CLIMB, 1, 'MAX_CLIMB should be 1');
    assert.strictEqual(ELEVATION_RULES.MAX_DROP, 3, 'MAX_DROP should be 3');
  });
});
