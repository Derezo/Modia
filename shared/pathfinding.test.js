/**
 * Pathfinding Unit Tests
 * Tests for movement calculations in tactical combat
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getReachableTiles,
  calculatePathCost,
  findPath,
  getManhattanDistance,
  getAttackableTiles,
  hasValidPath,
  analyzeMapConnectivity,
  createTraversalView,
  validateTraversalView,
  canEnterTile,
  getStepCost,
  getReachableTilesForTraversal,
  calculateTraversalPathCost,
  findTraversalPath
} from './pathfinding.js';

// Helper to create a simple terrain grid
function createGrid(width, height, defaultTerrain = 'grass') {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => defaultTerrain)
  );
}

// Helper to set terrain at specific positions
function setTerrain(grid, positions, terrain) {
  for (const { x, y } of positions) {
    if (grid[y] && grid[y][x] !== undefined) {
      grid[y][x] = terrain;
    }
  }
  return grid;
}

function createView({
  width = 3,
  height = 3,
  terrain = createGrid(width, height),
  obstacles = Array.from({ length: height }, () => Array(width).fill(null)),
  elevation = Array.from({ length: height }, () => Array(width).fill(0.33)),
  elevationConnections = Array.from(
    { length: height },
    () => Array(width).fill(null)
  ),
  units = [],
  movementPolicy = {}
} = {}) {
  return createTraversalView({
    terrain,
    obstacles,
    elevation,
    elevationConnections,
    units,
    dimensions: { width, height },
    movementPolicy
  });
}

describe('TraversalView object API', () => {
  it('validates all row-major layers against the declared dimensions', () => {
    const view = createView();
    assert.strictEqual(validateTraversalView(view).dimensions.width, 3);

    assert.throws(
      () => createTraversalView({
        terrain: createGrid(2, 1),
        dimensions: { width: 2, height: 2 }
      }),
      /terrain must be a row-major grid with 2 rows/
    );
  });

  it('blocks ordinary movement through passable:false obstacles', () => {
    const obstacles = Array.from({ length: 3 }, () => Array(3).fill(null));
    obstacles[1][2] = { type: 'pillar', passable: false };
    const view = createView({ obstacles });

    assert.strictEqual(
      canEnterTile(view, { x: 1, y: 1 }, { x: 2, y: 1 }),
      false
    );
    assert.strictEqual(
      getStepCost(view, { x: 1, y: 1 }, { x: 2, y: 1 }),
      Infinity
    );
    assert.strictEqual(
      getReachableTilesForTraversal(view, {
        start: { x: 1, y: 1 },
        range: 1
      }).some(tile => tile.x === 2 && tile.y === 1),
      false
    );
  });

  it('traverses passable:true obstacles at the underlying terrain cost', () => {
    const terrain = createGrid(3, 3);
    terrain[1][2] = 'forest';
    const obstacles = Array.from({ length: 3 }, () => Array(3).fill(null));
    obstacles[1][2] = { type: 'brush', passable: true };
    const view = createView({ terrain, obstacles });

    assert.strictEqual(
      canEnterTile(view, { x: 1, y: 1 }, { x: 2, y: 1 }),
      true
    );
    assert.strictEqual(
      getStepCost(view, { x: 1, y: 1 }, { x: 2, y: 1 }),
      2
    );
  });

  it('uses V2 semantic terrain passability and movement costs', () => {
    const terrain = createGrid(3, 3);
    terrain[1][1] = {
      material: 'stone',
      movementCost: 1.75,
      passable: true,
      regionId: 'region:test'
    };
    terrain[1][2] = {
      material: 'grass',
      movementCost: 0,
      passable: false,
      regionId: 'region:test'
    };
    const view = createView({ terrain });

    assert.strictEqual(
      getStepCost(view, { x: 0, y: 1 }, { x: 1, y: 1 }),
      1.75
    );
    assert.strictEqual(
      canEnterTile(view, { x: 1, y: 1 }, { x: 2, y: 1 }),
      false
    );
  });

  it('does not accept decorations as a collision layer', () => {
    const view = createTraversalView({
      terrain: createGrid(2, 1),
      obstacles: [[null, null]],
      elevation: [[0.33, 0.33]],
      elevationConnections: [[null, null]],
      units: [],
      dimensions: { width: 2, height: 1 },
      movementPolicy: {},
      decorations: [[null, { type: 'flowers', passable: false }]]
    });

    assert.strictEqual('decorations' in view, false);
    assert.strictEqual(
      canEnterTile(view, { x: 0, y: 0 }, { x: 1, y: 0 }),
      true
    );
  });

  it('blocks occupied tiles and applies one goal-occupied policy to cost and path', () => {
    const units = [{ tileX: 2, tileY: 1, hp: 100 }];
    const blockedView = createView({ units });
    const allowedView = createView({
      units,
      movementPolicy: { allowOccupiedGoal: true }
    });
    const request = {
      start: { x: 1, y: 1 },
      goal: { x: 2, y: 1 }
    };

    assert.strictEqual(calculateTraversalPathCost(blockedView, request), Infinity);
    assert.strictEqual(findTraversalPath(blockedView, request), null);
    assert.strictEqual(calculateTraversalPathCost(allowedView, request), 1);
    assert.deepStrictEqual(findTraversalPath(allowedView, request), [
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 1, z: 0 }
    ]);
  });

  it('uses the same directional elevation connection cost in every object API', () => {
    const elevation = [[0.33, 0.66]];
    const elevationConnections = [[
      { e: { type: 'long_ramp', levels: 2 } },
      { w: { type: 'long_ramp', levels: 2 } }
    ]];
    const view = createView({
      width: 2,
      height: 1,
      elevation,
      elevationConnections
    });
    const start = { x: 0, y: 0 };
    const goal = { x: 1, y: 0 };

    assert.strictEqual(canEnterTile(view, start, goal, { goal }), true);
    assert.strictEqual(getStepCost(view, start, goal, { goal }), 2);
    assert.deepStrictEqual(
      getReachableTilesForTraversal(view, { start, range: 2 }),
      [{ x: 1, y: 0, z: 2, cost: 2 }]
    );
    assert.strictEqual(
      calculateTraversalPathCost(view, { start, goal, maxCost: 2 }),
      2
    );
    assert.deepStrictEqual(findTraversalPath(view, { start, goal }), [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 2 }
    ]);
  });

  it('supports explicit ability policies without local obstacle exceptions', () => {
    const obstacles = [[null, { type: 'rocks', passable: false }]];
    const view = createView({
      width: 2,
      height: 1,
      obstacles,
      movementPolicy: {
        canTraverseObstacle: () => true,
        getStepCost: ({ defaultCost }) => defaultCost + 1
      }
    });

    assert.strictEqual(
      getStepCost(view, { x: 0, y: 0 }, { x: 1, y: 0 }),
      2
    );
  });
});

describe('getManhattanDistance', () => {
  it('should return 0 for same position', () => {
    assert.strictEqual(getManhattanDistance(5, 5, 5, 5), 0);
  });

  it('should calculate horizontal distance correctly', () => {
    assert.strictEqual(getManhattanDistance(0, 0, 5, 0), 5);
    assert.strictEqual(getManhattanDistance(5, 0, 0, 0), 5);
  });

  it('should calculate vertical distance correctly', () => {
    assert.strictEqual(getManhattanDistance(0, 0, 0, 5), 5);
    assert.strictEqual(getManhattanDistance(0, 5, 0, 0), 5);
  });

  it('should calculate diagonal distance correctly', () => {
    assert.strictEqual(getManhattanDistance(0, 0, 3, 4), 7);
    assert.strictEqual(getManhattanDistance(2, 3, 5, 1), 5);
  });

  it('should handle negative coordinates', () => {
    assert.strictEqual(getManhattanDistance(-2, -3, 2, 3), 10);
  });
});

describe('getReachableTiles', () => {
  it('should return empty array with 0 movement range', () => {
    const terrain = createGrid(10, 10);
    const result = getReachableTiles(5, 5, 0, terrain, [], 10, 10);
    assert.strictEqual(result.length, 0);
  });

  it('should return 4 tiles with movement range 1 on open terrain', () => {
    const terrain = createGrid(10, 10);
    const result = getReachableTiles(5, 5, 1, terrain, [], 10, 10);
    assert.strictEqual(result.length, 4);

    // Check all 4 cardinal directions are included
    const positions = result.map(t => `${t.x},${t.y}`);
    assert.ok(positions.includes('4,5'), 'Should include left tile');
    assert.ok(positions.includes('6,5'), 'Should include right tile');
    assert.ok(positions.includes('5,4'), 'Should include top tile');
    assert.ok(positions.includes('5,6'), 'Should include bottom tile');
  });

  it('should return more tiles with larger movement range', () => {
    const terrain = createGrid(10, 10);
    const result1 = getReachableTiles(5, 5, 1, terrain, [], 10, 10);
    const result2 = getReachableTiles(5, 5, 2, terrain, [], 10, 10);
    const result3 = getReachableTiles(5, 5, 3, terrain, [], 10, 10);

    assert.ok(result2.length > result1.length, 'Range 2 should cover more than range 1');
    assert.ok(result3.length > result2.length, 'Range 3 should cover more than range 2');
  });

  it('should not include starting position in reachable tiles', () => {
    const terrain = createGrid(10, 10);
    const result = getReachableTiles(5, 5, 3, terrain, [], 10, 10);
    const hasStart = result.some(t => t.x === 5 && t.y === 5);
    assert.strictEqual(hasStart, false, 'Should not include starting position');
  });

  it('should respect map boundaries', () => {
    const terrain = createGrid(5, 5);
    const result = getReachableTiles(0, 0, 3, terrain, [], 5, 5);

    // All tiles should be within bounds
    for (const tile of result) {
      assert.ok(tile.x >= 0 && tile.x < 5, `X should be in bounds: ${tile.x}`);
      assert.ok(tile.y >= 0 && tile.y < 5, `Y should be in bounds: ${tile.y}`);
    }
  });

  it('should not include tiles blocked by units', () => {
    const terrain = createGrid(10, 10);
    const units = [
      { tileX: 6, tileY: 5, hp: 100 } // Unit blocking right
    ];
    const result = getReachableTiles(5, 5, 1, terrain, units, 10, 10);

    const hasBlocked = result.some(t => t.x === 6 && t.y === 5);
    assert.strictEqual(hasBlocked, false, 'Should not include tile with unit');
    assert.strictEqual(result.length, 3, 'Should have 3 reachable tiles');
  });

  it('should block movement on dead units (corpses remain on battlefield)', () => {
    const terrain = createGrid(10, 10);
    const units = [
      { tileX: 6, tileY: 5, hp: 0 } // Dead unit (corpse)
    ];
    const result = getReachableTiles(5, 5, 1, terrain, units, 10, 10);

    const hasTile = result.some(t => t.x === 6 && t.y === 5);
    assert.strictEqual(hasTile, false, 'Should NOT include tile with dead unit corpse');
    assert.strictEqual(result.length, 3, 'Should have 3 reachable tiles (corpse blocks one)');
  });

  it('should handle forest terrain with higher movement cost', () => {
    const terrain = createGrid(10, 10);
    setTerrain(terrain, [{ x: 6, y: 5 }], 'forest'); // Forest costs 2

    const result = getReachableTiles(5, 5, 1, terrain, [], 10, 10);
    const hasForest = result.some(t => t.x === 6 && t.y === 5);

    // With only 1 movement, shouldn't reach the forest tile (costs 2)
    assert.strictEqual(hasForest, false, 'Should not reach forest with movement 1');

    // With 2 movement, should reach the forest tile
    const result2 = getReachableTiles(5, 5, 2, terrain, [], 10, 10);
    const hasForest2 = result2.some(t => t.x === 6 && t.y === 5);
    assert.ok(hasForest2, 'Should reach forest with movement 2');
  });

  it('should not include impassable terrain', () => {
    const terrain = createGrid(10, 10);
    setTerrain(terrain, [{ x: 6, y: 5 }], 'rock'); // Rock is impassable

    const result = getReachableTiles(5, 5, 5, terrain, [], 10, 10);
    const hasRock = result.some(t => t.x === 6 && t.y === 5);

    assert.strictEqual(hasRock, false, 'Should not include rock tile');
  });

  it('should include cost in returned tiles', () => {
    const terrain = createGrid(10, 10);
    const result = getReachableTiles(5, 5, 2, terrain, [], 10, 10);

    for (const tile of result) {
      assert.ok(typeof tile.cost === 'number', 'Each tile should have a cost');
      assert.ok(tile.cost > 0 && tile.cost <= 2, 'Cost should be within range');
    }
  });
});

describe('calculatePathCost', () => {
  it('should return 0 for same start and target', () => {
    const terrain = createGrid(10, 10);
    const cost = calculatePathCost(5, 5, 5, 5, terrain, [], 10, 10, 10);
    assert.strictEqual(cost, 0);
  });

  it('should return 1 for adjacent tile on grass', () => {
    const terrain = createGrid(10, 10);
    const cost = calculatePathCost(5, 5, 6, 5, terrain, [], 10, 10, 10);
    assert.strictEqual(cost, 1);
  });

  it('should return correct cost for longer path', () => {
    const terrain = createGrid(10, 10);
    const cost = calculatePathCost(5, 5, 8, 5, terrain, [], 10, 10, 10);
    assert.strictEqual(cost, 3, 'Should cost 3 to move 3 tiles on grass');
  });

  it('should return Infinity when target is unreachable', () => {
    const terrain = createGrid(10, 10);
    // Block all paths with rock (impassable)
    for (let y = 0; y < 10; y++) {
      terrain[y][7] = 'rock';
    }

    const cost = calculatePathCost(5, 5, 9, 5, terrain, [], 10, 10, 10);
    assert.strictEqual(cost, Infinity, 'Should return Infinity for unreachable tile');
  });

  it('should find path around obstacles', () => {
    const terrain = createGrid(10, 10);
    terrain[5][6] = 'rock'; // Block direct path with rock (impassable)

    const cost = calculatePathCost(5, 5, 7, 5, terrain, [], 10, 10, 10);
    assert.ok(cost > 2 && cost < Infinity, 'Should find path around obstacle');
  });

  it('should return Manhattan distance when no terrain provided', () => {
    const cost = calculatePathCost(0, 0, 5, 3, null, [], 10, 10, 10);
    assert.strictEqual(cost, 8, 'Should return Manhattan distance without terrain');
  });

  it('should account for terrain costs', () => {
    const terrain = createGrid(10, 10);
    setTerrain(terrain, [{ x: 6, y: 5 }], 'forest'); // Forest costs 2

    const costViaForest = calculatePathCost(5, 5, 7, 5, terrain, [], 10, 10, 10);

    // Going through forest: 1 (grass) + 2 (forest) = 3
    assert.ok(costViaForest >= 3, 'Should account for forest cost');
  });
});

describe('findPath', () => {
  it('should return path with single element for same start and end', () => {
    const terrain = createGrid(10, 10);
    const path = findPath(5, 5, 5, 5, terrain, [], 10, 10);

    assert.ok(path, 'Path should exist');
    assert.strictEqual(path.length, 1, 'Path should have single element');
    assert.strictEqual(path[0].x, 5);
    assert.strictEqual(path[0].y, 5);
  });

  it('should return direct path for adjacent tiles', () => {
    const terrain = createGrid(10, 10);
    const path = findPath(5, 5, 6, 5, terrain, [], 10, 10);

    assert.ok(path, 'Path should exist');
    assert.strictEqual(path.length, 2, 'Path should have 2 elements');
    assert.deepStrictEqual(path[0], { x: 5, y: 5 });
    assert.deepStrictEqual(path[1], { x: 6, y: 5 });
  });

  it('should return null when no path exists', () => {
    const terrain = createGrid(10, 10);
    // Block all paths with rock (impassable)
    for (let y = 0; y < 10; y++) {
      terrain[y][7] = 'rock';
    }

    const path = findPath(5, 5, 9, 5, terrain, [], 10, 10);
    assert.strictEqual(path, null, 'Should return null for unreachable destination');
  });

  it('should find optimal path around obstacles', () => {
    const terrain = createGrid(10, 10);
    terrain[5][6] = 'rock'; // Block direct path with rock (impassable)

    const path = findPath(5, 5, 7, 5, terrain, [], 10, 10);

    assert.ok(path, 'Path should exist');
    assert.ok(path.length > 3, 'Path should go around obstacle');

    // Verify path doesn't go through rock
    const hasRock = path.some(p => p.x === 6 && p.y === 5);
    assert.strictEqual(hasRock, false, 'Path should not go through rock');
  });

  it('should start and end at correct positions', () => {
    const terrain = createGrid(10, 10);
    const path = findPath(2, 3, 7, 8, terrain, [], 10, 10);

    assert.ok(path, 'Path should exist');
    assert.deepStrictEqual(path[0], { x: 2, y: 3 }, 'Should start at start position');
    assert.deepStrictEqual(path[path.length - 1], { x: 7, y: 8 }, 'Should end at end position');
  });

  it('should avoid tiles occupied by units', () => {
    const terrain = createGrid(10, 10);
    const units = [{ tileX: 6, tileY: 5, hp: 100 }];

    const path = findPath(5, 5, 7, 5, terrain, units, 10, 10);

    assert.ok(path, 'Path should exist');
    const goesThrough = path.some(p => p.x === 6 && p.y === 5);
    assert.strictEqual(goesThrough, false, 'Path should avoid occupied tile');
  });

  it('should allow ending on occupied destination', () => {
    const terrain = createGrid(10, 10);
    const units = [{ tileX: 7, tileY: 5, hp: 100 }]; // Target is occupied

    const path = findPath(5, 5, 7, 5, terrain, units, 10, 10);

    assert.ok(path, 'Path should exist even if destination is occupied');
    assert.deepStrictEqual(path[path.length - 1], { x: 7, y: 5 });
  });
});

describe('getAttackableTiles', () => {
  it('should return empty array with 0 attack range', () => {
    const result = getAttackableTiles(5, 5, 0, 10, 10);
    assert.strictEqual(result.length, 0);
  });

  it('should return 4 tiles with attack range 1', () => {
    const result = getAttackableTiles(5, 5, 1, 10, 10);
    assert.strictEqual(result.length, 4);

    const positions = result.map(t => `${t.x},${t.y}`);
    assert.ok(positions.includes('4,5'), 'Should include left');
    assert.ok(positions.includes('6,5'), 'Should include right');
    assert.ok(positions.includes('5,4'), 'Should include up');
    assert.ok(positions.includes('5,6'), 'Should include down');
  });

  it('should return correct number of tiles for range 2', () => {
    // Range 2: 4 at distance 1 + 8 at distance 2 = 12 tiles
    const result = getAttackableTiles(5, 5, 2, 10, 10);
    assert.strictEqual(result.length, 12);
  });

  it('should not include starting position', () => {
    const result = getAttackableTiles(5, 5, 3, 10, 10);
    const hasStart = result.some(t => t.x === 5 && t.y === 5);
    assert.strictEqual(hasStart, false);
  });

  it('should respect map boundaries', () => {
    const result = getAttackableTiles(0, 0, 2, 5, 5);

    for (const tile of result) {
      assert.ok(tile.x >= 0 && tile.x < 5);
      assert.ok(tile.y >= 0 && tile.y < 5);
    }
  });

  it('should include distance in returned tiles', () => {
    const result = getAttackableTiles(5, 5, 3, 10, 10);

    for (const tile of result) {
      assert.ok(typeof tile.distance === 'number');
      const expectedDistance = Math.abs(tile.x - 5) + Math.abs(tile.y - 5);
      assert.strictEqual(tile.distance, expectedDistance);
    }
  });
});

describe('hasValidPath', () => {
  it('should return true when path exists', () => {
    const terrain = createGrid(10, 10);
    const result = hasValidPath(0, 0, 9, 9, terrain, 10, 10);
    assert.strictEqual(result, true);
  });

  it('should return true for adjacent tiles', () => {
    const terrain = createGrid(10, 10);
    const result = hasValidPath(5, 5, 6, 5, terrain, 10, 10);
    assert.strictEqual(result, true);
  });

  it('should return true for same position', () => {
    const terrain = createGrid(10, 10);
    const result = hasValidPath(5, 5, 5, 5, terrain, 10, 10);
    assert.strictEqual(result, true);
  });

  it('should return false when path is blocked', () => {
    const terrain = createGrid(10, 10);
    // Create a wall of rock (impassable)
    for (let y = 0; y < 10; y++) {
      terrain[y][5] = 'rock';
    }

    const result = hasValidPath(0, 5, 9, 5, terrain, 10, 10);
    assert.strictEqual(result, false);
  });

  it('should find path around obstacles', () => {
    const terrain = createGrid(10, 10);
    // Partial wall of rock
    for (let y = 0; y < 8; y++) {
      terrain[y][5] = 'rock';
    }
    // Gap at bottom (grass is passable)
    terrain[8][5] = 'grass';
    terrain[9][5] = 'grass';

    const result = hasValidPath(0, 5, 9, 5, terrain, 10, 10);
    assert.strictEqual(result, true);
  });

  it('should ignore units (unlike findPath)', () => {
    // hasValidPath doesn't take units - it only checks terrain
    const terrain = createGrid(10, 10);
    const result = hasValidPath(0, 0, 9, 9, terrain, 10, 10);
    assert.strictEqual(result, true);
  });
});

describe('analyzeMapConnectivity', () => {
  it('should report good connectivity for open map', () => {
    const terrain = createGrid(20, 15);
    const result = analyzeMapConnectivity(terrain, 20, 15);

    assert.ok(result.hasMinimumPaths, 'Open map should have minimum paths');
    assert.ok(result.pathCount >= 2, 'Should have at least 2 paths');
    assert.strictEqual(result.bottlenecks.length, 0, 'Should have no bottlenecks');
  });

  it('should detect blocked map', () => {
    const terrain = createGrid(20, 15);
    // Block all paths with rock (impassable)
    for (let y = 0; y < 15; y++) {
      terrain[y][10] = 'rock';
    }

    const result = analyzeMapConnectivity(terrain, 20, 15);

    assert.strictEqual(result.pathCount, 0, 'Blocked map should have 0 paths');
    assert.strictEqual(result.hasMinimumPaths, false, 'Blocked map should not have minimum paths');
  });

  it('should detect bottlenecks', () => {
    const terrain = createGrid(20, 15);
    // Create a narrow passage with rock (impassable) - only 3 passable tiles
    for (let y = 0; y < 15; y++) {
      if (y < 6 || y > 8) { // Leave only 3 tiles passable (y=6,7,8)
        terrain[y][10] = 'rock';
      }
    }

    const result = analyzeMapConnectivity(terrain, 20, 15);

    // The bottleneck detection looks for columns with < 4 passable tiles
    assert.ok(result.bottlenecks.length > 0, 'Should detect bottleneck');
  });

  it('should return connectivity object with required properties', () => {
    const terrain = createGrid(20, 15);
    const result = analyzeMapConnectivity(terrain, 20, 15);

    assert.ok('pathCount' in result, 'Should have pathCount');
    assert.ok('hasMinimumPaths' in result, 'Should have hasMinimumPaths');
    assert.ok('bottlenecks' in result, 'Should have bottlenecks');
    assert.ok(Array.isArray(result.bottlenecks), 'bottlenecks should be array');
  });
});

// ============================================================================
// EXTENDED PATHFINDING TESTS
// ============================================================================

describe('Pathfinding Performance', () => {
  it('should complete 32x32 grid pathfinding in under 1000ms', () => {
    const size = 32;
    const terrain = createGrid(size, size);

    const start = performance.now();
    const path = findPath(0, 0, size - 1, size - 1, terrain, [], size, size);
    const elapsed = performance.now() - start;

    assert.ok(path, 'Path should exist on open 32x32 grid');
    assert.ok(path.length > 0, 'Path should have waypoints');
    assert.ok(elapsed < 1000, `Pathfinding took ${elapsed.toFixed(2)}ms, should be < 1000ms`);
  });
});

describe('Mixed Terrain Cost Pathfinding', () => {
  it('should prefer lower-cost path over shorter-distance path', () => {
    // Create a 10x5 grid. Direct route (row 2) goes through forest (cost 2 each).
    // Alternate route goes around through grass (cost 1 each) via rows 0 or 4.
    const terrain = createGrid(10, 5);

    // Fill row 2 columns 2-7 with forest (cost 2 per tile)
    for (let x = 2; x <= 7; x++) {
      terrain[2][x] = 'forest';
    }

    // Path from (0,2) to (9,2)
    const path = findPath(0, 2, 9, 2, terrain, [], 10, 5);

    assert.ok(path, 'Path should exist');
    assert.deepStrictEqual(path[0], { x: 0, y: 2 }, 'Should start at (0,2)');
    assert.deepStrictEqual(path[path.length - 1], { x: 9, y: 2 }, 'Should end at (9,2)');

    // The optimal path should avoid the forest strip.
    // Count how many path tiles are in the forest row (y=2) between x=2..7
    const forestTiles = path.filter(p => p.y === 2 && p.x >= 2 && p.x <= 7);

    // A* should route around forest because 6 forest tiles cost 12 movement
    // while going around costs ~9-11 via grass depending on exact route.
    // The path should use fewer forest tiles than the direct 6.
    assert.ok(forestTiles.length < 6,
      `Path should avoid most forest tiles, used ${forestTiles.length}/6 forest tiles`);
  });

  it('should handle water terrain with cost 3', () => {
    const terrain = createGrid(10, 5);

    // Place water tiles along the direct path at row 2
    for (let x = 3; x <= 5; x++) {
      terrain[2][x] = 'water';
    }

    // findPath should still find a path (water is passable, cost 3)
    const path = findPath(0, 2, 9, 2, terrain, [], 10, 5);
    assert.ok(path, 'Path should exist even with water tiles');
    assert.ok(path.length > 0, 'Path should have waypoints');

    // calculatePathCost through water should be higher than through grass
    const costViaWater = calculatePathCost(0, 2, 9, 2, terrain, [], 20, 10, 5);

    const grassTerrain = createGrid(10, 5);
    const costViaGrass = calculatePathCost(0, 2, 9, 2, grassTerrain, [], 20, 10, 5);

    assert.ok(costViaWater >= costViaGrass,
      `Water path cost (${costViaWater}) should be >= grass path cost (${costViaGrass})`);
  });

  it('should correctly calculate path cost through multi-cost terrain', () => {
    const terrain = createGrid(5, 1);
    // All grass: cost should be 4 (4 steps)
    const grassCost = calculatePathCost(0, 0, 4, 0, terrain, [], 10, 5, 1);
    assert.strictEqual(grassCost, 4, 'All grass path should cost 4');

    // Put forest in the middle: cost should increase
    terrain[0][2] = 'forest'; // cost 2 instead of 1
    const forestCost = calculatePathCost(0, 0, 4, 0, terrain, [], 10, 5, 1);
    assert.strictEqual(forestCost, 5, 'Path through 1 forest tile should cost 5 (3 grass + 1 forest)');
  });
});
