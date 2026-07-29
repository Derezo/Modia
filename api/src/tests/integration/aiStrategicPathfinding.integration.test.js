/**
 * AI Strategic Pathfinding Unit Tests
 *
 * Tests the strategic pathfinding system for AI multi-turn movement planning:
 * - Path calculation to nearest enemy
 * - Movement scoring based on path progress
 * - Best strategic move selection
 *
 * These tests validate that AI units can plan efficient routes toward enemies
 * over multiple turns, preventing the AI from getting stuck or waiting
 * when enemies are far away.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  createMockPlayerUnit,
  createMockEnemyUnit,
  createMockBattleState,
  createMockGrid
} from '../testUtils/index.js';
import {
  calculateStrategicPath,
  scoreStrategicMovement,
  findBestStrategicMove
} from '../../services/ai/strategicPathfinding.js';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate a simple grass grid for testing
 * @param {number} width - Grid width
 * @param {number} height - Grid height
 * @returns {Array<Array>} 2D terrain array
 */
function generateGrassGrid(width, height) {
  return createMockGrid(width, height, 'grass');
}

/**
 * Generate a grid with obstacles blocking certain paths
 * @param {number} width - Grid width
 * @param {number} height - Grid height
 * @param {Array<{x: number, y: number}>} obstacles - Array of obstacle positions
 * @returns {Array<Array>} 2D terrain array with obstacles
 */
function generateGridWithObstacles(width, height, obstacles) {
  const grid = generateGrassGrid(width, height);
  for (const obs of obstacles) {
    if (grid[obs.y] && grid[obs.y][obs.x]) {
      grid[obs.y][obs.x] = {
        x: obs.x,
        y: obs.y,
        type: 'rock',
        movementCost: Infinity,
        passable: false
      };
    }
  }
  return grid;
}

// =============================================================================
// PATH FINDING TESTS
// =============================================================================

describe('calculateStrategicPath', () => {
  test('finds path to nearest enemy', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 2,
      tileY: 5,
      movement: 3
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 15,
      tileY: 5,
      hp: 100
    });

    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const result = calculateStrategicPath(aiUnit, state);

    assert.ok(result.path !== null, 'Path should be found');
    assert.ok(result.path.length > 0, 'Path should have at least one node');
    assert.ok(result.targetEnemy !== null, 'Target enemy should be set');
    assert.strictEqual(result.targetEnemy.id, 'player_1', 'Target should be the player unit');
    assert.ok(result.turnsToReach >= 1, 'Should calculate turns to reach');
    assert.ok(result.nextWaypoint !== null, 'Should have next waypoint');
  });

  test('returns null path when no enemies exist', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5,
      movement: 3
    });

    // State with only the AI unit (no enemies from its perspective)
    const state = createMockBattleState({
      units: [aiUnit],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const result = calculateStrategicPath(aiUnit, state);

    assert.strictEqual(result.path, null, 'Path should be null when no enemies');
    assert.strictEqual(result.nextWaypoint, null, 'Waypoint should be null');
    assert.strictEqual(result.targetEnemy, null, 'Target enemy should be null');
    assert.strictEqual(result.turnsToReach, Infinity, 'Turns to reach should be Infinity');
  });

  test('returns null path when all enemies are dead', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5,
      movement: 3
    });

    const deadPlayer = createMockPlayerUnit({
      id: 'player_1',
      tileX: 15,
      tileY: 5,
      hp: 0  // Dead
    });

    const state = createMockBattleState({
      units: [aiUnit, deadPlayer],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const result = calculateStrategicPath(aiUnit, state);

    assert.strictEqual(result.path, null, 'Path should be null when all enemies are dead');
    assert.strictEqual(result.targetEnemy, null, 'Target enemy should be null');
  });

  test('returns correct turnsToReach based on path length and movement', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 0,
      tileY: 5,
      movement: 3
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 10,
      tileY: 5,
      hp: 100
    });

    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const result = calculateStrategicPath(aiUnit, state);

    // Path length is 10 (from 0 to 10), movement is 3
    // turnsToReach = ceil((pathLength - 1) / movement) = ceil(10 / 3) = 4
    assert.ok(result.path !== null, 'Path should be found');
    const expectedTurns = Math.ceil((result.path.length - 1) / aiUnit.movement);
    assert.strictEqual(result.turnsToReach, expectedTurns, 'Turns to reach should match calculation');
  });

  test('finds nearest enemy when multiple enemies exist', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 10,
      tileY: 10,
      movement: 3
    });

    const nearPlayer = createMockPlayerUnit({
      id: 'player_near',
      tileX: 13,  // 3 tiles away
      tileY: 10,
      hp: 100
    });

    const farPlayer = createMockPlayerUnit({
      id: 'player_far',
      tileX: 25,  // 15 tiles away
      tileY: 10,
      hp: 100
    });

    const state = createMockBattleState({
      units: [aiUnit, nearPlayer, farPlayer],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const result = calculateStrategicPath(aiUnit, state);

    assert.ok(result.path !== null, 'Path should be found');
    assert.strictEqual(result.targetEnemy.id, 'player_near', 'Should target nearest enemy');
  });

  test('calculates path around obstacles', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5,
      movement: 3
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 10,
      tileY: 5,
      hp: 100
    });

    // Create a wall of obstacles between the units
    const obstacles = [
      { x: 7, y: 3 }, { x: 7, y: 4 }, { x: 7, y: 5 }, { x: 7, y: 6 }, { x: 7, y: 7 }
    ];

    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain: generateGridWithObstacles(32, 32, obstacles),
      mapWidth: 32,
      mapHeight: 32
    });

    const result = calculateStrategicPath(aiUnit, state);

    // Path should exist and go around obstacles
    assert.ok(result.path !== null, 'Path should be found around obstacles');
    assert.ok(result.path.length > 5, 'Path should be longer due to obstacle avoidance');
  });

  test('uses obstacle layers and persisted elevation connections', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 0,
      tileY: 0,
      movement: 2
    });
    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 2,
      tileY: 0,
      hp: 100
    });
    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain: [[
        { material: 'grass', movementCost: 1, passable: true, regionId: 'r1' },
        { material: 'grass', movementCost: 2, passable: true, regionId: 'r1' },
        { material: 'grass', movementCost: 1, passable: true, regionId: 'r1' }
      ]],
      obstacles: [],
      elevation: [[0.5, 0.7, 0.7]],
      elevationFormat: 'normalized',
      elevationConnections: [{
        id: 'connection:ramp',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 0 },
        kind: 'ramp',
        direction: 'e',
        elevationDelta: 0.2,
        bidirectional: true,
        featureId: 'route:main'
      }],
      mapWidth: 3,
      mapHeight: 1
    });

    const connected = calculateStrategicPath(aiUnit, state);
    assert.deepStrictEqual(
      connected.path,
      [
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 2 },
        { x: 2, y: 0, z: 2 }
      ],
      'strategic targeting explicitly permits its occupied enemy goal'
    );
    assert.strictEqual(connected.turnsToReach, 2);

    state.obstacles = [{
      id: 'obstacle:rock',
      x: 1,
      y: 0,
      kind: 'rock',
      assetKey: 'mountain/rock',
      blocking: true,
      movementCost: 0,
      featureId: 'r1'
    }];
    assert.strictEqual(calculateStrategicPath(aiUnit, state).path, null);
  });

  test('does not bank unused movement points between strategic turns', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 0,
      tileY: 0,
      movement: 3
    });
    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 3,
      tileY: 0,
      hp: 100
    });
    const terrain = [[0, 1, 2, 3].map(index => ({
      material: 'grass',
      movementCost: index === 0 ? 1 : 2,
      passable: true,
      regionId: 'r1'
    }))];
    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain,
      mapWidth: 4,
      mapHeight: 1
    });

    const result = calculateStrategicPath(aiUnit, state);

    assert.strictEqual(result.turnsToReach, 3);
    assert.deepStrictEqual(
      { x: result.nextWaypoint.x, y: result.nextWaypoint.y },
      { x: 1, y: 0 }
    );
  });
});

// =============================================================================
// MOVEMENT SCORING TESTS
// =============================================================================

describe('scoreStrategicMovement', () => {
  test('scores tiles on the optimal path higher', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 10,
      movement: 3
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 15,
      tileY: 10,
      hp: 100
    });

    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const strategicInfo = calculateStrategicPath(aiUnit, state);

    // Tile on the path toward enemy (straight line on y=10)
    const onPathTile = { x: 8, y: 10 };
    // Tile off the path (perpendicular direction)
    const offPathTile = { x: 5, y: 14 };

    const onPathScore = scoreStrategicMovement(onPathTile, strategicInfo, aiUnit);
    const offPathScore = scoreStrategicMovement(offPathTile, strategicInfo, aiUnit);

    assert.ok(onPathScore > offPathScore, 
      `On-path tile (${onPathScore}) should score higher than off-path tile (${offPathScore})`);
  });

  test('moving toward enemy scores higher than moving away', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 10,
      tileY: 10,
      movement: 3
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 20,
      tileY: 10,
      hp: 100
    });

    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const strategicInfo = calculateStrategicPath(aiUnit, state);

    // Tile closer to enemy
    const towardTile = { x: 13, y: 10 };
    // Tile farther from enemy
    const awayTile = { x: 7, y: 10 };

    const towardScore = scoreStrategicMovement(towardTile, strategicInfo, aiUnit);
    const awayScore = scoreStrategicMovement(awayTile, strategicInfo, aiUnit);

    assert.ok(towardScore > awayScore,
      `Moving toward enemy (${towardScore}) should score higher than moving away (${awayScore})`);
  });

  test('returns 0 when no strategic info (null path)', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5,
      movement: 3
    });

    const nullStrategicInfo = {
      path: null,
      nextWaypoint: null,
      turnsToReach: Infinity,
      targetEnemy: null
    };

    const tile = { x: 8, y: 5 };
    const score = scoreStrategicMovement(tile, nullStrategicInfo, aiUnit);

    assert.strictEqual(score, 0, 'Score should be 0 when path is null');
  });

  test('returns 0 when no waypoint', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5,
      movement: 3
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 15,
      tileY: 5,
      hp: 100
    });

    const incompleteStrategicInfo = {
      path: [{ x: 5, y: 5 }, { x: 6, y: 5 }],
      nextWaypoint: null,  // Missing waypoint
      turnsToReach: 3,
      targetEnemy: player
    };

    const tile = { x: 6, y: 5 };
    const score = scoreStrategicMovement(tile, incompleteStrategicInfo, aiUnit);

    assert.strictEqual(score, 0, 'Score should be 0 when waypoint is null');
  });

  test('returns 0 when no target enemy', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5,
      movement: 3
    });

    const incompleteStrategicInfo = {
      path: [{ x: 5, y: 5 }, { x: 6, y: 5 }],
      nextWaypoint: { x: 8, y: 5 },
      turnsToReach: 3,
      targetEnemy: null  // Missing target
    };

    const tile = { x: 6, y: 5 };
    const score = scoreStrategicMovement(tile, incompleteStrategicInfo, aiUnit);

    assert.strictEqual(score, 0, 'Score should be 0 when targetEnemy is null');
  });

  test('scores closer to waypoint higher', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5,
      movement: 3
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 15,
      tileY: 5,
      hp: 100
    });

    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const strategicInfo = calculateStrategicPath(aiUnit, state);

    // Tile right at the waypoint
    const atWaypoint = strategicInfo.nextWaypoint;
    // Tile one step before the waypoint (if waypoint is at x=8)
    const beforeWaypoint = { x: atWaypoint.x - 1, y: atWaypoint.y };

    const atWaypointScore = scoreStrategicMovement(atWaypoint, strategicInfo, aiUnit);
    const beforeWaypointScore = scoreStrategicMovement(beforeWaypoint, strategicInfo, aiUnit);

    assert.ok(atWaypointScore >= beforeWaypointScore,
      `At waypoint (${atWaypointScore}) should score >= before waypoint (${beforeWaypointScore})`);
  });
});

// =============================================================================
// BEST MOVE SELECTION TESTS
// =============================================================================

describe('findBestStrategicMove', () => {
  test('selects tile that progresses toward enemy', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 10,
      movement: 3
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 15,
      tileY: 10,
      hp: 100
    });

    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    // Reachable tiles within movement range
    const reachableTiles = [
      { x: 6, y: 10, cost: 1 },  // Toward enemy
      { x: 7, y: 10, cost: 2 },  // Further toward enemy
      { x: 8, y: 10, cost: 3 },  // Even further toward enemy
      { x: 4, y: 10, cost: 1 },  // Away from enemy
      { x: 5, y: 9, cost: 1 },   // Perpendicular
      { x: 5, y: 11, cost: 1 }   // Perpendicular
    ];

    const result = findBestStrategicMove(aiUnit, reachableTiles, state);

    assert.ok(result.tile !== null, 'Should select a tile');
    assert.ok(result.strategicScore > 0, 'Should have positive strategic score');
    // Best tile should be the one that progresses most toward the enemy
    assert.ok(result.tile.x > aiUnit.tileX, 'Selected tile should be toward enemy (higher x)');
  });

  test('returns null tile when no path exists', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5,
      movement: 3
    });

    // No enemies in state
    const state = createMockBattleState({
      units: [aiUnit],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const reachableTiles = [
      { x: 6, y: 5, cost: 1 },
      { x: 7, y: 5, cost: 2 },
      { x: 8, y: 5, cost: 3 }
    ];

    const result = findBestStrategicMove(aiUnit, reachableTiles, state);

    assert.strictEqual(result.tile, null, 'Tile should be null when no path exists');
    assert.strictEqual(result.strategicScore, 0, 'Score should be 0');
    assert.ok(result.strategicInfo.path === null, 'Strategic info should have null path');
  });

  test('handles empty reachable tiles array', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5,
      movement: 3
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 15,
      tileY: 5,
      hp: 100
    });

    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const reachableTiles = [];

    const result = findBestStrategicMove(aiUnit, reachableTiles, state);

    assert.strictEqual(result.tile, null, 'Tile should be null when no reachable tiles');
  });

  test('selects best from limited options', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 10,
      tileY: 10,
      movement: 2
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 20,
      tileY: 10,
      hp: 100
    });

    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    // Only two options: toward or away
    const reachableTiles = [
      { x: 12, y: 10, cost: 2 },  // Toward enemy
      { x: 8, y: 10, cost: 2 }    // Away from enemy
    ];

    const result = findBestStrategicMove(aiUnit, reachableTiles, state);

    assert.ok(result.tile !== null, 'Should select a tile');
    assert.strictEqual(result.tile.x, 12, 'Should select tile toward enemy');
  });

  test('provides strategic info with result', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5,
      movement: 3
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 15,
      tileY: 5,
      hp: 100
    });

    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const reachableTiles = [
      { x: 6, y: 5, cost: 1 },
      { x: 7, y: 5, cost: 2 },
      { x: 8, y: 5, cost: 3 }
    ];

    const result = findBestStrategicMove(aiUnit, reachableTiles, state);

    assert.ok(result.strategicInfo !== undefined, 'Should include strategic info');
    assert.ok(result.strategicInfo.path !== null, 'Strategic info should have path');
    assert.ok(result.strategicInfo.targetEnemy !== null, 'Strategic info should have target enemy');
    assert.ok(result.strategicInfo.turnsToReach !== undefined, 'Strategic info should have turns to reach');
  });

  test('prefers tile on optimal path over slightly closer off-path tile', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 10,
      movement: 3
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 15,
      tileY: 10,
      hp: 100
    });

    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    // On-path tile (straight toward enemy)
    const onPathTile = { x: 8, y: 10, cost: 3 };
    // Off-path tile at same x but different y
    const offPathTile = { x: 8, y: 12, cost: 3 };

    const reachableTiles = [onPathTile, offPathTile];

    const result = findBestStrategicMove(aiUnit, reachableTiles, state);

    // The on-path tile should be selected due to path bonus
    assert.strictEqual(result.tile.y, 10, 'Should prefer on-path tile');
  });
});

// =============================================================================
// EDGE CASES AND REGRESSION TESTS
// =============================================================================

describe('Strategic Pathfinding Edge Cases', () => {
  test('handles unit already adjacent to enemy', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 10,
      tileY: 10,
      movement: 3
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 11,  // Adjacent
      tileY: 10,
      hp: 100
    });

    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const result = calculateStrategicPath(aiUnit, state);

    assert.ok(result.path !== null, 'Path should exist even when adjacent');
    assert.ok(result.path.length <= 2, 'Path should be very short when adjacent');
    assert.strictEqual(result.turnsToReach, 1, 'Should reach in 1 turn when adjacent');
  });

  test('handles multiple enemies at varying distances', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 15,
      tileY: 15,
      movement: 4
    });

    const player1 = createMockPlayerUnit({
      id: 'player_1',
      tileX: 5,   // Distance: 20 Manhattan
      tileY: 5,
      hp: 100
    });

    const player2 = createMockPlayerUnit({
      id: 'player_2',
      tileX: 20,  // Distance: 10 Manhattan
      tileY: 20,
      hp: 100
    });

    const player3 = createMockPlayerUnit({
      id: 'player_3',
      tileX: 18,  // Distance: 6 Manhattan (closest)
      tileY: 18,
      hp: 100
    });

    const state = createMockBattleState({
      units: [aiUnit, player1, player2, player3],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const result = calculateStrategicPath(aiUnit, state);

    assert.ok(result.path !== null, 'Path should be found');
    assert.strictEqual(result.targetEnemy.id, 'player_3', 'Should target closest enemy');
  });

  test('handles high movement unit', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5,
      movement: 10  // High movement
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 15,
      tileY: 5,
      hp: 100
    });

    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const result = calculateStrategicPath(aiUnit, state);

    assert.ok(result.path !== null, 'Path should be found');
    // With 10 movement and 10 tiles distance, should reach in 1 turn
    assert.strictEqual(result.turnsToReach, 1, 'Should reach quickly with high movement');
  });

  test('handles low movement unit', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5,
      movement: 1  // Minimum movement
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 15,
      tileY: 5,
      hp: 100
    });

    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const result = calculateStrategicPath(aiUnit, state);

    assert.ok(result.path !== null, 'Path should be found');
    // With 1 movement and 10 tiles distance, should take 10 turns
    assert.ok(result.turnsToReach >= 10, 'Should take many turns with low movement');
  });

  test('handles unit at map corner', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 0,
      tileY: 0,
      movement: 3
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 31,
      tileY: 31,
      hp: 100
    });

    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const result = calculateStrategicPath(aiUnit, state);

    assert.ok(result.path !== null, 'Path should be found across entire map');
    assert.ok(result.path.length > 30, 'Path should be long for corner-to-corner');
  });

  test('handles missing movement property (defaults to 3)', () => {
    const aiUnit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5
    });
    // Remove movement to test default
    delete aiUnit.movement;

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 15,
      tileY: 5,
      hp: 100
    });

    const state = createMockBattleState({
      units: [aiUnit, player],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const result = calculateStrategicPath(aiUnit, state);

    assert.ok(result.path !== null, 'Path should be found');
    // Default movement of 3, path length ~10, so ~4 turns
    assert.ok(result.turnsToReach > 0, 'Turns should be calculated with default movement');
  });
});

// =============================================================================
// PLAYER UNIT PERSPECTIVE TESTS
// =============================================================================

describe('Strategic Pathfinding from Player Perspective', () => {
  test('player unit finds path to enemy', () => {
    const playerUnit = createMockPlayerUnit({
      id: 'player_1',
      tileX: 5,
      tileY: 5,
      movement: 3
    });

    const enemy = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 15,
      tileY: 5,
      hp: 50
    });

    const state = createMockBattleState({
      units: [playerUnit, enemy],
      terrain: generateGrassGrid(32, 32),
      mapWidth: 32,
      mapHeight: 32
    });

    const result = calculateStrategicPath(playerUnit, state);

    assert.ok(result.path !== null, 'Path should be found from player to enemy');
    assert.strictEqual(result.targetEnemy.id, 'enemy_1', 'Should target the enemy');
  });
});
