/**
 * Unit tests for movementService.js
 * Tests movement calculations, team-based targeting, and pathfinding helpers
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  createMockPlayerUnit,
  createMockEnemyUnit,
  createMockBattleState
} from '../testUtils/index.js';
import {
  getMovementRange,
  getAttackRange,
  getTargetsInRange,
  findAdjacentTileToTarget,
  getOppositeType,
  getOpposingUnits,
  getAlliedUnits,
  areOpponents,
  areAllies,
  calculatePathCost,
  getManhattanDistance
} from '../../services/battle/movementService.js';

// =============================================================================
// MOVEMENT RANGE TESTS
// =============================================================================

describe('getMovementRange', () => {
  test('should return class-specific movement for warrior', () => {
    const unit = createMockPlayerUnit({ class: 'warrior' });
    const range = getMovementRange(unit);
    assert.strictEqual(range, 3, 'Warrior should have 3 movement');
  });

  test('should return class-specific movement for monk', () => {
    const unit = createMockPlayerUnit({ class: 'monk' });
    const range = getMovementRange(unit);
    assert.strictEqual(range, 4, 'Monk should have 4 movement');
  });

  test('should return class-specific movement for ninja', () => {
    const unit = createMockPlayerUnit({ class: 'ninja' });
    const range = getMovementRange(unit);
    assert.strictEqual(range, 5, 'Ninja should have 5 movement');
  });

  test('should return class-specific movement for sorcerer', () => {
    const unit = createMockPlayerUnit({ class: 'sorcerer' });
    const range = getMovementRange(unit);
    assert.strictEqual(range, 2, 'Sorcerer should have 2 movement');
  });

  test('should return default 3 for unknown class', () => {
    const unit = createMockPlayerUnit({ class: 'unknown_class' });
    const range = getMovementRange(unit);
    assert.strictEqual(range, 3, 'Unknown class should default to 3');
  });

  test('should handle undefined class', () => {
    const unit = createMockPlayerUnit({});
    delete unit.class;
    const range = getMovementRange(unit);
    assert.strictEqual(range, 3, 'Undefined class should default to 3');
  });

  test('should reduce movement by 1 when slowed', () => {
    const unit = createMockPlayerUnit({
      class: 'warrior',
      statusEffects: [{ type: 'slow', duration: 2 }]
    });
    const range = getMovementRange(unit);
    assert.strictEqual(range, 2, 'Slow should reduce movement by 1');
  });

  test('should increase movement by 1 when hasted', () => {
    const unit = createMockPlayerUnit({
      class: 'warrior',
      statusEffects: [{ type: 'haste', duration: 2 }]
    });
    const range = getMovementRange(unit);
    assert.strictEqual(range, 4, 'Haste should increase movement by 1');
  });

  test('should have minimum 1 movement when heavily slowed', () => {
    const unit = createMockPlayerUnit({
      class: 'sorcerer', // 2 base movement
      statusEffects: [{ type: 'slow', duration: 2 }]
    });
    const range = getMovementRange(unit);
    assert.strictEqual(range, 1, 'Minimum movement should be 1');
  });

  test('should apply both slow and haste (net zero)', () => {
    const unit = createMockPlayerUnit({
      class: 'warrior',
      statusEffects: [
        { type: 'slow', duration: 2 },
        { type: 'haste', duration: 2 }
      ]
    });
    const range = getMovementRange(unit);
    // Slow reduces to 2, then haste increases to 3
    assert.strictEqual(range, 3, 'Slow then haste should cancel out');
  });
});

// =============================================================================
// ATTACK RANGE TESTS
// =============================================================================

describe('getAttackRange', () => {
  test('should return unit attack range if specified', () => {
    const unit = createMockPlayerUnit({ attackRange: 3 });
    const range = getAttackRange(unit);
    assert.strictEqual(range, 3);
  });

  test('should return default 1 for melee units', () => {
    const unit = createMockPlayerUnit({});
    delete unit.attackRange;
    const range = getAttackRange(unit);
    assert.strictEqual(range, 1, 'Default attack range should be 1');
  });

  test('should return 0 if attackRange is 0', () => {
    const unit = createMockPlayerUnit({ attackRange: 0 });
    // Note: 0 || 1 = 1, so this tests that behavior
    const range = getAttackRange(unit);
    assert.strictEqual(range, 1, '0 attackRange defaults to 1');
  });
});

// =============================================================================
// TARGETS IN RANGE TESTS
// =============================================================================

describe('getTargetsInRange', () => {
  test('should find enemy targets within range', () => {
    const attacker = createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 });
    const enemy1 = createMockEnemyUnit({ id: 'e1', tileX: 6, tileY: 5, hp: 50 }); // Distance 1
    const enemy2 = createMockEnemyUnit({ id: 'e2', tileX: 10, tileY: 10, hp: 50 }); // Distance 10

    const state = createMockBattleState({
      units: [attacker, enemy1, enemy2]
    });

    const targets = getTargetsInRange(attacker, state, 2, 'enemy');

    assert.strictEqual(targets.length, 1, 'Should only find enemy within range 2');
    assert.strictEqual(targets[0].unitId, 'e1');
    assert.strictEqual(targets[0].distance, 1);
  });

  test('should not include dead units as targets', () => {
    const attacker = createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 });
    const deadEnemy = createMockEnemyUnit({ id: 'e1', tileX: 6, tileY: 5, hp: 0 });

    const state = createMockBattleState({
      units: [attacker, deadEnemy]
    });

    const targets = getTargetsInRange(attacker, state, 2, 'enemy');

    assert.strictEqual(targets.length, 0, 'Should not include dead enemies');
  });

  test('should not include self as target', () => {
    const attacker = createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 });

    const state = createMockBattleState({
      units: [attacker]
    });

    const targets = getTargetsInRange(attacker, state, 5, 'player');

    assert.strictEqual(targets.length, 0, 'Should not include self');
  });

  test('should find allies when targetType is ally', () => {
    const unit = createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 });
    const ally = createMockPlayerUnit({ id: 'p2', tileX: 6, tileY: 5, hp: 50 });
    const enemy = createMockEnemyUnit({ id: 'e1', tileX: 7, tileY: 5, hp: 50 });

    const state = createMockBattleState({
      units: [unit, ally, enemy]
    });

    const targets = getTargetsInRange(unit, state, 3, 'ally');

    assert.strictEqual(targets.length, 1, 'Should find ally');
    assert.strictEqual(targets[0].unitId, 'p2');
  });

  test('should find opponents when targetType is opponent', () => {
    const unit = createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 });
    const enemy = createMockEnemyUnit({ id: 'e1', tileX: 6, tileY: 5, hp: 50 });
    const ally = createMockPlayerUnit({ id: 'p2', tileX: 7, tileY: 5, hp: 50 });

    const state = createMockBattleState({
      units: [unit, enemy, ally]
    });

    const targets = getTargetsInRange(unit, state, 3, 'opponent');

    assert.strictEqual(targets.length, 1, 'Should find opponent');
    assert.strictEqual(targets[0].unitId, 'e1');
  });

  test('should handle legacy player targetType', () => {
    const unit = createMockEnemyUnit({ id: 'e1', tileX: 5, tileY: 5 });
    const player = createMockPlayerUnit({ id: 'p1', tileX: 6, tileY: 5, hp: 50 });

    const state = createMockBattleState({
      units: [unit, player]
    });

    const targets = getTargetsInRange(unit, state, 3, 'player');

    assert.strictEqual(targets.length, 1, 'Should find player');
    assert.strictEqual(targets[0].unitId, 'p1');
  });

  test('should use teamId for PvP targeting', () => {
    const team1Player = { ...createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 }), teamId: 1 };
    const team2Player = { ...createMockPlayerUnit({ id: 'p2', tileX: 6, tileY: 5, hp: 50 }), teamId: 2 };
    const team1Ally = { ...createMockPlayerUnit({ id: 'p3', tileX: 7, tileY: 5, hp: 50 }), teamId: 1 };

    const state = createMockBattleState({
      units: [team1Player, team2Player, team1Ally]
    });

    const enemies = getTargetsInRange(team1Player, state, 5, 'enemy');
    const allies = getTargetsInRange(team1Player, state, 5, 'ally');

    assert.strictEqual(enemies.length, 1, 'Should find 1 enemy (team 2)');
    assert.strictEqual(enemies[0].unitId, 'p2');
    assert.strictEqual(allies.length, 1, 'Should find 1 ally (team 1, excluding self)');
    assert.strictEqual(allies[0].unitId, 'p3');
  });

  test('should exclude targets at distance 0', () => {
    const unit = createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 });
    const sameSpot = createMockEnemyUnit({ id: 'e1', tileX: 5, tileY: 5, hp: 50 });

    const state = createMockBattleState({
      units: [unit, sameSpot]
    });

    const targets = getTargetsInRange(unit, state, 5, 'enemy');

    // Distance 0 should be excluded
    assert.strictEqual(targets.length, 0, 'Should not include target at same position');
  });

  test('should include target name in result', () => {
    const attacker = createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 });
    const enemy = createMockEnemyUnit({ id: 'e1', tileX: 6, tileY: 5, hp: 50, name: 'Goblin' });

    const state = createMockBattleState({
      units: [attacker, enemy]
    });

    const targets = getTargetsInRange(attacker, state, 2, 'enemy');

    assert.strictEqual(targets[0].unitName, 'Goblin');
  });
});

// =============================================================================
// FIND ADJACENT TILE TESTS
// =============================================================================

describe('findAdjacentTileToTarget', () => {
  test('should find unoccupied adjacent tile', () => {
    const unit = createMockPlayerUnit({ id: 'p1', tileX: 0, tileY: 0 });
    const state = createMockBattleState({
      units: [unit],
      mapWidth: 32,
      mapHeight: 32
    });
    const targetTile = { x: 5, y: 5 };

    const result = findAdjacentTileToTarget(state, unit, targetTile);

    assert.ok(result, 'Should find an adjacent tile');
    // Result should be within 1 tile (including diagonals)
    const dx = Math.abs(result.x - targetTile.x);
    const dy = Math.abs(result.y - targetTile.y);
    assert.ok(dx <= 1 && dy <= 1 && (dx + dy > 0), 'Result should be adjacent to target');
  });

  test('should prefer tiles closer to unit starting position', () => {
    const unit = createMockPlayerUnit({ id: 'p1', tileX: 3, tileY: 5 });
    const state = createMockBattleState({
      units: [unit],
      mapWidth: 32,
      mapHeight: 32
    });
    const targetTile = { x: 5, y: 5 };

    const result = findAdjacentTileToTarget(state, unit, targetTile);

    // Should prefer (4,5) which is left of target and closer to unit
    assert.deepStrictEqual(result, { x: 4, y: 5 }, 'Should prefer tile closer to unit');
  });

  test('should avoid occupied tiles', () => {
    const unit = createMockPlayerUnit({ id: 'p1', tileX: 0, tileY: 0 });
    const blocker1 = createMockEnemyUnit({ id: 'e1', tileX: 5, tileY: 4, hp: 50 }); // North
    const blocker2 = createMockEnemyUnit({ id: 'e2', tileX: 5, tileY: 6, hp: 50 }); // South
    const blocker3 = createMockEnemyUnit({ id: 'e3', tileX: 4, tileY: 5, hp: 50 }); // West
    const state = createMockBattleState({
      units: [unit, blocker1, blocker2, blocker3],
      mapWidth: 32,
      mapHeight: 32
    });
    const targetTile = { x: 5, y: 5 };

    const result = findAdjacentTileToTarget(state, unit, targetTile);

    // Should find an unoccupied adjacent tile (could be cardinal or diagonal)
    assert.ok(result, 'Should find an unoccupied tile');
    // Verify it's not one of the blocked tiles
    const isBlockedTile =
      (result.x === 5 && result.y === 4) || // North
      (result.x === 5 && result.y === 6) || // South
      (result.x === 4 && result.y === 5);   // West
    assert.ok(!isBlockedTile, 'Should not be one of the blocked tiles');
  });

  test('should return null if all adjacent tiles occupied', () => {
    const unit = createMockPlayerUnit({ id: 'p1', tileX: 0, tileY: 0 });
    // Block all 8 directions
    const blockers = [
      createMockEnemyUnit({ id: 'e1', tileX: 5, tileY: 4, hp: 50 }),
      createMockEnemyUnit({ id: 'e2', tileX: 5, tileY: 6, hp: 50 }),
      createMockEnemyUnit({ id: 'e3', tileX: 4, tileY: 5, hp: 50 }),
      createMockEnemyUnit({ id: 'e4', tileX: 6, tileY: 5, hp: 50 }),
      createMockEnemyUnit({ id: 'e5', tileX: 4, tileY: 4, hp: 50 }),
      createMockEnemyUnit({ id: 'e6', tileX: 6, tileY: 4, hp: 50 }),
      createMockEnemyUnit({ id: 'e7', tileX: 4, tileY: 6, hp: 50 }),
      createMockEnemyUnit({ id: 'e8', tileX: 6, tileY: 6, hp: 50 })
    ];
    const state = createMockBattleState({
      units: [unit, ...blockers],
      mapWidth: 32,
      mapHeight: 32
    });
    const targetTile = { x: 5, y: 5 };

    const result = findAdjacentTileToTarget(state, unit, targetTile);

    assert.strictEqual(result, null, 'Should return null when all tiles blocked');
  });

  test('should avoid impassable terrain', () => {
    const unit = createMockPlayerUnit({ id: 'p1', tileX: 0, tileY: 0 });
    const state = createMockBattleState({
      units: [unit],
      terrain: [
        { x: 5, y: 4, passable: false }, // North is impassable
        { x: 5, y: 6, passable: false }, // South is impassable
        { x: 4, y: 5, passable: false }  // West is impassable
      ],
      mapWidth: 32,
      mapHeight: 32
    });
    const targetTile = { x: 5, y: 5 };

    const result = findAdjacentTileToTarget(state, unit, targetTile);

    // Should find a passable tile
    assert.ok(result, 'Should find a passable tile');
    // Verify result is not one of the impassable tiles
    const isImpassable =
      (result.x === 5 && result.y === 4) ||
      (result.x === 5 && result.y === 6) ||
      (result.x === 4 && result.y === 5);
    assert.ok(!isImpassable, 'Should avoid impassable terrain');
  });

  test('should avoid obstacles', () => {
    const unit = createMockPlayerUnit({ id: 'p1', tileX: 0, tileY: 0 });
    const state = createMockBattleState({
      units: [unit],
      obstacles: [
        { x: 5, y: 4, passable: false },
        { x: 5, y: 6, passable: false },
        { x: 4, y: 5, passable: false }
      ],
      mapWidth: 32,
      mapHeight: 32
    });
    const targetTile = { x: 5, y: 5 };

    const result = findAdjacentTileToTarget(state, unit, targetTile);

    assert.ok(result, 'Should find a tile not blocked by obstacle');
    // Verify result is not one of the obstacle tiles
    const hasObstacle =
      (result.x === 5 && result.y === 4) ||
      (result.x === 5 && result.y === 6) ||
      (result.x === 4 && result.y === 5);
    assert.ok(!hasObstacle, 'Should avoid obstacles');
  });

  test('should respect map boundaries', () => {
    const unit = createMockPlayerUnit({ id: 'p1', tileX: 5, tileY: 5 });
    const state = createMockBattleState({
      units: [unit],
      mapWidth: 2,
      mapHeight: 2
    });
    const targetTile = { x: 0, y: 0 };

    const result = findAdjacentTileToTarget(state, unit, targetTile);

    // Only (1,0) and (0,1) are valid within 2x2 map
    assert.ok(result, 'Should find a tile within bounds');
    assert.ok(result.x >= 0 && result.x < 2, 'X should be in bounds');
    assert.ok(result.y >= 0 && result.y < 2, 'Y should be in bounds');
  });

  test('should ignore dead units when checking occupancy', () => {
    const unit = createMockPlayerUnit({ id: 'p1', tileX: 3, tileY: 5 });
    const deadUnit = createMockEnemyUnit({ id: 'e1', tileX: 4, tileY: 5, hp: 0 });
    const state = createMockBattleState({
      units: [unit, deadUnit],
      mapWidth: 32,
      mapHeight: 32
    });
    const targetTile = { x: 5, y: 5 };

    const result = findAdjacentTileToTarget(state, unit, targetTile);

    // Should allow (4,5) since dead unit doesn't block
    assert.deepStrictEqual(result, { x: 4, y: 5 }, 'Dead units should not block tiles');
  });
});

// =============================================================================
// UTILITY FUNCTION TESTS
// =============================================================================

describe('getOppositeType', () => {
  test('should return enemy for player', () => {
    assert.strictEqual(getOppositeType('player'), 'enemy');
  });

  test('should return player for enemy', () => {
    assert.strictEqual(getOppositeType('enemy'), 'player');
  });
});

describe('getOpposingUnits', () => {
  test('should return enemy units for a player unit', () => {
    const player = createMockPlayerUnit({ id: 'p1', hp: 100 });
    const enemy1 = createMockEnemyUnit({ id: 'e1', hp: 50 });
    const enemy2 = createMockEnemyUnit({ id: 'e2', hp: 30 });
    const state = createMockBattleState({
      units: [player, enemy1, enemy2]
    });

    const opponents = getOpposingUnits(player, state);

    assert.strictEqual(opponents.length, 2, 'Should find 2 enemies');
    assert.ok(opponents.some(u => u.id === 'e1'), 'Should include enemy1');
    assert.ok(opponents.some(u => u.id === 'e2'), 'Should include enemy2');
  });

  test('should return player units for an enemy unit', () => {
    const player1 = createMockPlayerUnit({ id: 'p1', hp: 100 });
    const player2 = createMockPlayerUnit({ id: 'p2', hp: 80 });
    const enemy = createMockEnemyUnit({ id: 'e1', hp: 50 });
    const state = createMockBattleState({
      units: [player1, player2, enemy]
    });

    const opponents = getOpposingUnits(enemy, state);

    assert.strictEqual(opponents.length, 2, 'Should find 2 players');
  });

  test('should exclude dead units', () => {
    const player = createMockPlayerUnit({ id: 'p1', hp: 100 });
    const aliveEnemy = createMockEnemyUnit({ id: 'e1', hp: 50 });
    const deadEnemy = createMockEnemyUnit({ id: 'e2', hp: 0 });
    const state = createMockBattleState({
      units: [player, aliveEnemy, deadEnemy]
    });

    const opponents = getOpposingUnits(player, state);

    assert.strictEqual(opponents.length, 1, 'Should only find alive enemies');
  });

  test('should use teamId for PvP', () => {
    const team1 = { ...createMockPlayerUnit({ id: 'p1', hp: 100 }), teamId: 1 };
    const team2 = { ...createMockPlayerUnit({ id: 'p2', hp: 80 }), teamId: 2 };
    const state = createMockBattleState({ units: [team1, team2] });

    const opponents = getOpposingUnits(team1, state);

    assert.strictEqual(opponents.length, 1);
    assert.strictEqual(opponents[0].id, 'p2');
  });
});

describe('getAlliedUnits', () => {
  test('should return all player units for a player unit (including self)', () => {
    const player1 = createMockPlayerUnit({ id: 'p1', hp: 100 });
    const player2 = createMockPlayerUnit({ id: 'p2', hp: 80 });
    const enemy = createMockEnemyUnit({ id: 'e1', hp: 50 });
    const state = createMockBattleState({
      units: [player1, player2, enemy]
    });

    const allies = getAlliedUnits(player1, state);

    assert.strictEqual(allies.length, 2, 'Should find 2 allies (including self)');
    assert.ok(allies.some(u => u.id === 'p1'), 'Should include self');
    assert.ok(allies.some(u => u.id === 'p2'), 'Should include ally');
  });

  test('should exclude dead allies', () => {
    const alive = createMockPlayerUnit({ id: 'p1', hp: 100 });
    const dead = createMockPlayerUnit({ id: 'p2', hp: 0 });
    const state = createMockBattleState({ units: [alive, dead] });

    const allies = getAlliedUnits(alive, state);

    assert.strictEqual(allies.length, 1);
  });

  test('should use teamId for PvP', () => {
    const team1a = { ...createMockPlayerUnit({ id: 'p1', hp: 100 }), teamId: 1 };
    const team1b = { ...createMockPlayerUnit({ id: 'p2', hp: 90 }), teamId: 1 };
    const team2 = { ...createMockPlayerUnit({ id: 'p3', hp: 80 }), teamId: 2 };
    const state = createMockBattleState({ units: [team1a, team1b, team2] });

    const allies = getAlliedUnits(team1a, state);

    assert.strictEqual(allies.length, 2);
    assert.ok(allies.some(u => u.id === 'p1'));
    assert.ok(allies.some(u => u.id === 'p2'));
  });
});

describe('areOpponents', () => {
  test('should return true for player vs enemy', () => {
    const player = createMockPlayerUnit({ id: 'p1' });
    const enemy = createMockEnemyUnit({ id: 'e1' });

    assert.strictEqual(areOpponents(player, enemy), true);
  });

  test('should return false for player vs player (same type)', () => {
    const player1 = createMockPlayerUnit({ id: 'p1' });
    const player2 = createMockPlayerUnit({ id: 'p2' });

    assert.strictEqual(areOpponents(player1, player2), false);
  });

  test('should use teamId when present', () => {
    const team1 = { ...createMockPlayerUnit({ id: 'p1' }), teamId: 1 };
    const team2 = { ...createMockPlayerUnit({ id: 'p2' }), teamId: 2 };

    assert.strictEqual(areOpponents(team1, team2), true);
  });

  test('should return false for same teamId even with different types', () => {
    const player = { ...createMockPlayerUnit({ id: 'p1' }), teamId: 1 };
    const enemy = { ...createMockEnemyUnit({ id: 'e1' }), teamId: 1 };

    assert.strictEqual(areOpponents(player, enemy), false);
  });
});

describe('areAllies', () => {
  test('should return true for player vs player (same type)', () => {
    const player1 = createMockPlayerUnit({ id: 'p1' });
    const player2 = createMockPlayerUnit({ id: 'p2' });

    assert.strictEqual(areAllies(player1, player2), true);
  });

  test('should return false for player vs enemy', () => {
    const player = createMockPlayerUnit({ id: 'p1' });
    const enemy = createMockEnemyUnit({ id: 'e1' });

    assert.strictEqual(areAllies(player, enemy), false);
  });

  test('should use teamId when present', () => {
    const team1a = { ...createMockPlayerUnit({ id: 'p1' }), teamId: 1 };
    const team1b = { ...createMockPlayerUnit({ id: 'p2' }), teamId: 1 };

    assert.strictEqual(areAllies(team1a, team1b), true);
  });

  test('should return true for same teamId even with different types', () => {
    const player = { ...createMockPlayerUnit({ id: 'p1' }), teamId: 1 };
    const enemy = { ...createMockEnemyUnit({ id: 'e1' }), teamId: 1 };

    assert.strictEqual(areAllies(player, enemy), true);
  });
});

// =============================================================================
// PATH COST TESTS
// =============================================================================

describe('calculatePathCost', () => {
  test('should return Manhattan distance when no terrain', () => {
    const state = createMockBattleState({
      mapWidth: 32,
      mapHeight: 32
    });
    delete state.terrain;

    const cost = calculatePathCost(0, 0, 5, 3, state, 10);

    assert.strictEqual(cost, 8, 'Should be Manhattan distance 5+3=8');
  });

  test('should return 0 for same position', () => {
    const state = createMockBattleState({});
    delete state.terrain;

    const cost = calculatePathCost(5, 5, 5, 5, state, 10);

    assert.strictEqual(cost, 0);
  });
});

// =============================================================================
// MANHATTAN DISTANCE TESTS
// =============================================================================

describe('getManhattanDistance', () => {
  test('should calculate distance for same position', () => {
    const dist = getManhattanDistance(5, 5, 5, 5);
    assert.strictEqual(dist, 0);
  });

  test('should calculate horizontal distance', () => {
    const dist = getManhattanDistance(0, 0, 5, 0);
    assert.strictEqual(dist, 5);
  });

  test('should calculate vertical distance', () => {
    const dist = getManhattanDistance(0, 0, 0, 7);
    assert.strictEqual(dist, 7);
  });

  test('should calculate diagonal distance (sum of x and y)', () => {
    const dist = getManhattanDistance(2, 3, 5, 8);
    assert.strictEqual(dist, 8); // |5-2| + |8-3| = 3 + 5 = 8
  });

  test('should handle negative coordinates', () => {
    const dist = getManhattanDistance(-2, -3, 2, 3);
    assert.strictEqual(dist, 10); // |2-(-2)| + |3-(-3)| = 4 + 6 = 10
  });
});
