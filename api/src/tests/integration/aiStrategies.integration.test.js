/**
 * AI Strategies Unit Tests
 *
 * Tests the AI decision-making system for tactical combat, focusing on:
 * - Distance metric consistency (Manhattan distance)
 * - Movement decisions
 * - Attack decisions
 * - Position evaluation
 *
 * These tests validate that the AI uses Manhattan distance consistently,
 * matching the server's action validation.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  createMockPlayerUnit,
  createMockEnemyUnit,
  createMockBattleState
} from '../testUtils/index.js';
import { getManhattanDistance } from '../../../../shared/pathfinding.js';

// Import AI modules for testing
import * as aiService from '../../services/aiService.js';
import {
  calculateDamageDealt,
  calculateDamageReceived,
  calculatePositionQuality,
  calculateAllySupport,
  findNearestEnemy,
  countTargetsInAoe,
  countNearbyEnemies
} from '../../services/ai/utilityFactors.js';
import { StateEvaluator } from '../../services/ai/stateEvaluator.js';
import { generateAllActions } from '../../services/ai/actionGenerator.js';
import { getWeights } from '../../services/ai/patternWeights.js';

// =============================================================================
// DISTANCE METRIC TESTS
// =============================================================================

describe('Manhattan Distance Consistency', () => {
  test('getManhattanDistance calculates correct distance for cardinal positions', () => {
    // Horizontal
    assert.strictEqual(getManhattanDistance(0, 0, 3, 0), 3);
    // Vertical
    assert.strictEqual(getManhattanDistance(0, 0, 0, 4), 4);
  });

  test('getManhattanDistance calculates correct distance for diagonal positions', () => {
    // Key test: diagonal (2,1) from origin should be 3, NOT 2 (Chebyshev)
    assert.strictEqual(getManhattanDistance(0, 0, 2, 1), 3);

    // More diagonal tests
    assert.strictEqual(getManhattanDistance(0, 0, 1, 1), 2);
    assert.strictEqual(getManhattanDistance(0, 0, 2, 2), 4);
    assert.strictEqual(getManhattanDistance(0, 0, 3, 3), 6);
  });

  test('Manhattan vs Chebyshev distance difference', () => {
    // This is the exact scenario that was causing bugs
    // Position (0,0) to (2,1):
    // - Chebyshev: max(2, 1) = 2
    // - Manhattan: 2 + 1 = 3
    const manhattan = getManhattanDistance(0, 0, 2, 1);
    const chebyshev = Math.max(Math.abs(2 - 0), Math.abs(1 - 0));

    assert.strictEqual(manhattan, 3, 'Manhattan distance should be 3');
    assert.strictEqual(chebyshev, 2, 'Chebyshev distance would be 2');
    assert.ok(manhattan > chebyshev, 'Manhattan should be larger than Chebyshev for diagonals');
  });
});

// =============================================================================
// ATTACK RANGE VALIDATION TESTS
// =============================================================================

describe('AI Attack Range Decisions', () => {
  test('should NOT attack diagonal target outside Manhattan range', () => {
    // Enemy at (0,0) with attackRange=2
    // Player at (1,2) - Manhattan distance=3, Chebyshev=2
    // With the bug: AI would think it's in range (Chebyshev=2 <= attackRange=2)
    // Fixed: AI should know it's NOT in range (Manhattan=3 > attackRange=2)
    const enemy = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 0,
      tileY: 0,
      attackRange: 2,
      aiType: 'aggressive'
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 1,
      tileY: 2
    });

    // Calculate distance using Manhattan
    const distance = getManhattanDistance(
      enemy.tileX, enemy.tileY,
      player.tileX, player.tileY
    );

    assert.strictEqual(distance, 3, 'Manhattan distance should be 3');
    assert.ok(distance > enemy.attackRange, 'Target should be OUT of attack range');
  });

  test('should attack cardinal target within Manhattan range', () => {
    // Enemy at (0,0) with attackRange=2
    // Player at (2,0) - Manhattan distance=2
    const enemy = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 0,
      tileY: 0,
      attackRange: 2
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 2,
      tileY: 0
    });

    const distance = getManhattanDistance(
      enemy.tileX, enemy.tileY,
      player.tileX, player.tileY
    );

    assert.strictEqual(distance, 2, 'Manhattan distance should be 2');
    assert.ok(distance <= enemy.attackRange, 'Target should be IN attack range');
  });

  test('should attack adjacent diagonal target within Manhattan range', () => {
    // Enemy at (0,0) with attackRange=2
    // Player at (1,1) - Manhattan distance=2
    const enemy = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 0,
      tileY: 0,
      attackRange: 2
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 1,
      tileY: 1
    });

    const distance = getManhattanDistance(
      enemy.tileX, enemy.tileY,
      player.tileX, player.tileY
    );

    assert.strictEqual(distance, 2, 'Manhattan distance should be 2');
    assert.ok(distance <= enemy.attackRange, 'Diagonal adjacent should be in range');
  });
});

// =============================================================================
// UTILITY FACTOR TESTS - Now using Manhattan distance
// =============================================================================

describe('calculateDamageReceived (Manhattan distance)', () => {
  test('should reject direct threat outside Manhattan range after movement is spent', () => {
    const unit = createMockPlayerUnit({
      id: 'player_1',
      tileX: 5,
      tileY: 5
    });

    // Enemy at diagonal position (7,8)
    // Manhattan distance = |5-7| + |5-8| = 2 + 3 = 5
    // Chebyshev would be max(2,3) = 3
    const enemy = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 7,
      tileY: 8,
      attackRange: 3,  // Chebyshev says in range, Manhattan says not
      moveUsed: true
    });

    const state = createMockBattleState({
      units: [unit, enemy]
    });

    // With movement already spent and Manhattan (5) > attackRange (3), the
    // enemy should not be a direct threat. Chebyshev would incorrectly count it.
    // With Chebyshev (3) <= attackRange (3): enemy would be a threat (bug)
    const threat = calculateDamageReceived(unit, unit.tileX, unit.tileY, state);

    assert.strictEqual(threat, 0, 'Enemy at Manhattan distance 5 should not threaten with range 3');
  });

  test('should discount a threat that can move into Manhattan attack range', () => {
    const unit = createMockPlayerUnit({
      id: 'player_1',
      tileX: 5,
      tileY: 5
    });
    const enemy = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 7,
      tileY: 8,
      attackRange: 3,
      movement: 3,
      moveUsed: false
    });
    const state = createMockBattleState({
      units: [unit, enemy]
    });

    const threat = calculateDamageReceived(unit, unit.tileX, unit.tileY, state);

    assert.ok(
      threat > 0,
      'Enemy should remain a discounted threat when it can move then attack'
    );
  });

  test('should detect threat from enemy within Manhattan range', () => {
    const unit = createMockPlayerUnit({
      id: 'player_1',
      tileX: 5,
      tileY: 5
    });

    // Enemy at cardinal position (5,7)
    // Manhattan distance = |5-5| + |5-7| = 0 + 2 = 2
    const enemy = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 7,
      attackRange: 2,
      strength: 20,
      attack: 10
    });

    const state = createMockBattleState({
      units: [unit, enemy]
    });

    const threat = calculateDamageReceived(unit, unit.tileX, unit.tileY, state);

    assert.ok(threat > 0, 'Enemy at Manhattan distance 2 should threaten with range 2');
  });
});

describe('findNearestEnemy (Manhattan distance)', () => {
  test('should find nearest enemy using Manhattan distance', () => {
    const unit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 0,
      tileY: 0
    });

    // Player A at (3,0) - Manhattan distance = 3
    // Player B at (2,2) - Manhattan distance = 4, Chebyshev = 2
    // With bug: B would appear closer (Chebyshev 2 < 3)
    // Fixed: A should be nearest (Manhattan 3 < 4)
    const playerA = createMockPlayerUnit({
      id: 'player_1',
      tileX: 3,
      tileY: 0
    });

    const playerB = createMockPlayerUnit({
      id: 'player_2',
      tileX: 2,
      tileY: 2
    });

    const state = createMockBattleState({
      units: [unit, playerA, playerB]
    });

    const nearest = findNearestEnemy(unit, unit.tileX, unit.tileY, state);

    assert.strictEqual(nearest.id, 'player_1', 'Player A should be nearest using Manhattan distance');
  });
});

describe('countTargetsInAoe (Manhattan distance)', () => {
  test('should count targets using Manhattan radius', () => {
    const attacker = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5
    });

    // Target at (5,7) - Manhattan distance 2
    const targetA = createMockPlayerUnit({
      id: 'player_1',
      tileX: 5,
      tileY: 7
    });

    // Target at (7,7) - Manhattan distance 4, Chebyshev 2
    // With bug: would be counted in radius 2 (Chebyshev)
    // Fixed: should NOT be counted in radius 2 (Manhattan)
    const targetB = createMockPlayerUnit({
      id: 'player_2',
      tileX: 7,
      tileY: 7
    });

    const state = createMockBattleState({
      units: [attacker, targetA, targetB]
    });

    const count = countTargetsInAoe(5, 5, 2, state, 'enemy');

    assert.strictEqual(count, 1, 'Only target at Manhattan distance 2 should be in radius 2 AoE');
  });

  test('should include diagonal target within Manhattan radius', () => {
    const attacker = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5
    });

    // Target at (6,6) - Manhattan distance 2
    const target = createMockPlayerUnit({
      id: 'player_1',
      tileX: 6,
      tileY: 6
    });

    const state = createMockBattleState({
      units: [attacker, target]
    });

    const count = countTargetsInAoe(5, 5, 2, state, 'enemy');

    assert.strictEqual(count, 1, 'Target at (1,1) offset should be in radius 2');
  });
});

describe('calculatePositionQuality (Manhattan distance)', () => {
  test('should evaluate position using Manhattan distance to enemies', () => {
    const unit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 0,
      tileY: 0,
      attackRange: 1
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 3,
      tileY: 3
    });

    const state = createMockBattleState({
      units: [unit, player]
    });

    // Position (1,1) is Manhattan 4 from player (not Chebyshev 2)
    const quality1 = calculatePositionQuality(unit, 1, 1, state);

    // Position (2,0) is also Manhattan 4 from player
    const quality2 = calculatePositionQuality(unit, 2, 0, state);

    // Both positions should have similar quality since same Manhattan distance
    // They may not be exactly equal due to other factors (corners, etc)
    assert.ok(Math.abs(quality1 - quality2) < 30,
      'Positions at same Manhattan distance should have similar quality');
  });
});

describe('countNearbyEnemies (Manhattan distance)', () => {
  test('should count enemies using Manhattan distance <= 2', () => {
    const unit = createMockPlayerUnit({
      id: 'player_1',
      tileX: 5,
      tileY: 5
    });

    // Enemy at (6,6) - Manhattan distance 2 - SHOULD be counted
    const enemyA = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 6,
      tileY: 6
    });

    // Enemy at (7,6) - Manhattan distance 3 - should NOT be counted
    // With Chebyshev (2) it would be counted (bug)
    const enemyB = createMockEnemyUnit({
      id: 'enemy_2',
      tileX: 7,
      tileY: 6
    });

    const state = createMockBattleState({
      units: [unit, enemyA, enemyB]
    });

    const count = countNearbyEnemies(5, 5, state, 'player');

    assert.strictEqual(count, 1, 'Only enemy at Manhattan distance <= 2 should be counted');
  });
});

describe('calculateAllySupport (Manhattan distance)', () => {
  test('should calculate ally support using Manhattan distance', () => {
    const unit = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5
    });

    // Ally at (6,6) - Manhattan distance 2 - SHOULD provide support
    const allyA = createMockEnemyUnit({
      id: 'enemy_2',
      tileX: 6,
      tileY: 6
    });

    // Ally at (7,6) - Manhattan distance 3 - should NOT provide support
    const allyB = createMockEnemyUnit({
      id: 'enemy_3',
      tileX: 7,
      tileY: 6
    });

    const state = createMockBattleState({
      units: [unit, allyA, allyB]
    });

    const support = calculateAllySupport(unit, 5, 5, state);

    // Ally A (distance 2) provides: (3 - 2) * 10 = 10 support
    // Ally B (distance 3) provides: 0 support (out of range)
    assert.strictEqual(support, 10, 'Only ally at Manhattan distance <= 2 should provide support');
  });
});

// =============================================================================
// AI DECISION INTEGRATION TESTS
// =============================================================================

describe('AI Decision Integration', () => {
  test('aggressive AI should move toward nearest player', async () => {
    const enemy = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 10,
      tileY: 10,
      movement: 3,
      attackRange: 1,
      aiType: 'aggressive'
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 5,
      tileY: 5
    });

    const state = createMockBattleState({
      units: [enemy, player],
      mapWidth: 20,
      mapHeight: 20
    });

    // Get AI decision
    const actions = aiService.decideTurnActions(enemy, state);

    // Should have at least a move action
    assert.ok(actions.length > 0, 'AI should produce at least one action');

    const moveAction = actions.find(a => a.actionType === 'move');
    if (moveAction) {
      // The move should reduce Manhattan distance to player
      const originalDistance = getManhattanDistance(10, 10, 5, 5);
      const newDistance = getManhattanDistance(
        moveAction.targetTile.x,
        moveAction.targetTile.y,
        5, 5
      );
      assert.ok(newDistance < originalDistance,
        'Move should reduce Manhattan distance to player');
    }
  });

  test('AI should not attempt attack when target is diagonally out of range', async () => {
    // This is the key bug scenario
    const enemy = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 0,
      tileY: 0,
      movement: 0,  // Can't move
      attackRange: 2,
      aiType: 'aggressive',
      moveUsed: true  // Already moved
    });

    // Player at (2,1) - Manhattan=3, Chebyshev=2
    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 2,
      tileY: 1
    });

    const state = createMockBattleState({
      units: [enemy, player],
      mapWidth: 10,
      mapHeight: 10
    });

    const actions = aiService.decideTurnActions(enemy, state);

    // Should NOT have an attack action because target is out of Manhattan range
    const attackAction = actions.find(a => a.actionType === 'attack');

    // With the fix, there should be no attack (or it should be a wait)
    // because the target is at Manhattan distance 3, outside attackRange 2
    if (attackAction) {
      // If there IS an attack, verify the target is within Manhattan range
      const attackDistance = getManhattanDistance(
        enemy.tileX, enemy.tileY,
        attackAction.targetTile.x, attackAction.targetTile.y
      );
      assert.ok(attackDistance <= enemy.attackRange,
        'Any attack action should target within Manhattan range');
    }
  });
});

// =============================================================================
// TARGET RESOLUTION REGRESSION TESTS (Fix for goblin warrior waiting bug)
// =============================================================================

describe('Target Resolution in Utility Scoring', () => {
  test('calculateDamageDealt should work with full unit objects', () => {
    const attacker = createMockEnemyUnit({
      id: 'enemy_1',
      strength: 20,
      attack: 15,
      tileX: 5,
      tileY: 5
    });

    const target = createMockPlayerUnit({
      id: 'player_1',
      vitality: 10,
      defense: 5,
      hp: 100,
      maxHp: 100,
      tileX: 5,
      tileY: 6
    });

    const state = createMockBattleState({
      units: [attacker, target]
    });

    const damage = calculateDamageDealt(attacker, target, null, state);

    // Damage should be > 0 when given proper unit objects
    assert.ok(damage > 0, 'Damage calculation should return positive value with full unit objects');
  });

  test('StateEvaluator should resolve targets from action.targetId', () => {
    const attacker = createMockEnemyUnit({
      id: 'enemy_1',
      strength: 20,
      attack: 15,
      tileX: 5,
      tileY: 5,
      attackRange: 1
    });

    const target = createMockPlayerUnit({
      id: 'player_1',
      vitality: 10,
      defense: 5,
      hp: 100,
      maxHp: 100,
      tileX: 5,
      tileY: 6
    });

    const state = createMockBattleState({
      units: [attacker, target]
    });

    const evaluator = new StateEvaluator(getWeights('aggressive'));

    // Create action with minimal target format (like actionGenerator produces)
    const attackAction = {
      type: 'attack',
      target: { x: 5, y: 6, unitId: 'player_1', unitName: 'TestPlayer' },
      targetId: 'player_1'
    };

    const result = evaluator.evaluateAction(attacker, attackAction, state);

    // DAMAGE_DEALT should be > 0 because target was resolved
    assert.ok(result.factors.DAMAGE_DEALT > 0,
      'StateEvaluator should resolve targetId to get full unit for damage calculation');
  });

  test('Attack action should score higher than wait when enemy is in range', () => {
    const attacker = createMockEnemyUnit({
      id: 'enemy_1',
      strength: 20,
      attack: 15,
      tileX: 5,
      tileY: 5,
      attackRange: 1,
      hp: 100,
      maxHp: 100
    });

    const target = createMockPlayerUnit({
      id: 'player_1',
      vitality: 10,
      defense: 5,
      hp: 100,
      maxHp: 100,
      tileX: 5,
      tileY: 6  // Adjacent - Manhattan distance 1
    });

    const state = createMockBattleState({
      units: [attacker, target]
    });

    const evaluator = new StateEvaluator(getWeights('aggressive'));

    const attackAction = {
      type: 'attack',
      target: { x: 5, y: 6, unitId: 'player_1', unitName: 'TestPlayer' },
      targetId: 'player_1'
    };

    const waitAction = { type: 'wait' };

    const attackResult = evaluator.evaluateAction(attacker, attackAction, state);
    const waitResult = evaluator.evaluateAction(attacker, waitAction, state);

    assert.ok(attackResult.score > waitResult.score,
      `Attack (${attackResult.score.toFixed(1)}) should score higher than wait (${waitResult.score.toFixed(1)}) when enemy is adjacent`);
  });
});

// =============================================================================
// MOVEMENT SKILL TESTS (Leap attacks like Pounce, Charge Rush)
// =============================================================================

describe('Movement Skill Generation', () => {
  test('should include movement skills (like Pounce) in action generation', () => {
    const attacker = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5,
      attackRange: 1,
      mp: 50,
      maxMp: 50,
      // Give the unit a movement skill (like Pounce)
      skills: [
        { id: 'pounce', name: 'Pounce', range: 3, mpCost: 10, power: 130, movement: true },
        { id: 'bite', name: 'Bite', range: 1, mpCost: 0, power: 100 }
      ]
    });

    const target = createMockPlayerUnit({
      id: 'player_1',
      tileX: 8,  // 3 tiles away - in range for Pounce but not Bite
      tileY: 5,
      hp: 100,
      maxHp: 100
    });

    const state = createMockBattleState({
      units: [attacker, target]
    });

    const actions = generateAllActions(attacker, state);

    // Should have a pounce action (movement skills are now supported)
    const pounceAction = actions.find(a => a.type === 'skill' && a.skillId === 'pounce');
    assert.ok(pounceAction !== undefined,
      'Movement skills (like Pounce) should be included in action generation');

    // Bite should NOT be available because target is 3 tiles away (range 1)
    const biteAction = actions.find(a => a.type === 'skill' && a.skillId === 'bite');
    assert.strictEqual(biteAction, undefined,
      'Bite (range 1) should not be available for target 3 tiles away');
  });

  test('should include non-movement skills in action generation', () => {
    const attacker = createMockEnemyUnit({
      id: 'enemy_1',
      tileX: 5,
      tileY: 5,
      attackRange: 1,
      mp: 50,
      maxMp: 50,
      skills: [
        { id: 'bite', name: 'Bite', range: 1, mpCost: 0, power: 100 }
      ]
    });

    const target = createMockPlayerUnit({
      id: 'player_1',
      tileX: 5,  // Adjacent
      tileY: 6,
      hp: 100,
      maxHp: 100
    });

    const state = createMockBattleState({
      units: [attacker, target]
    });

    const actions = generateAllActions(attacker, state);

    // Should have a bite skill action
    const biteAction = actions.find(a => a.type === 'skill' && a.skillId === 'bite');
    assert.ok(biteAction !== undefined,
      'Regular skills should be included in action generation');
  });
});

// =============================================================================
// AGGRESSIVE AI BEHAVIOR TESTS (Regression for waiting bug)
// =============================================================================

describe('Aggressive AI Attack Behavior', () => {
  test('aggressive AI should attack when enemy is adjacent, not wait', () => {
    const enemy = createMockEnemyUnit({
      id: 'enemy_1',
      name: 'Goblin Warrior',
      tileX: 5,
      tileY: 5,
      attackRange: 1,
      aiType: 'aggressive',
      strength: 15,
      attack: 10,
      hp: 50,
      maxHp: 50,
      mp: 20,
      maxMp: 20
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 5,
      tileY: 6,  // Adjacent
      hp: 100,
      maxHp: 100,
      vitality: 10,
      defense: 5
    });

    const state = createMockBattleState({
      units: [enemy, player],
      mapWidth: 10,
      mapHeight: 10
    });

    const actions = aiService.decideTurnActions(enemy, state);

    // Should have an attack action, not just wait
    const attackAction = actions.find(a => a.actionType === 'attack');
    const waitAction = actions.find(a => a.actionType === 'wait');

    // If we only got wait, the bug is back
    if (!attackAction && waitAction) {
      assert.fail('Aggressive AI chose to wait instead of attacking adjacent enemy - bug regression!');
    }

    assert.ok(attackAction !== undefined,
      'Aggressive AI should attack when player is adjacent');
  });

  test('hit-and-run AI should attack then retreat when enemy is in range', () => {
    const enemy = createMockEnemyUnit({
      id: 'enemy_1',
      name: 'Cave Bat',
      tileX: 5,
      tileY: 5,
      attackRange: 1,
      aiType: 'hit-and-run',
      movement: 4,
      strength: 8,
      attack: 5,
      hp: 30,
      maxHp: 30,
      mp: 15,
      maxMp: 15
    });

    const player = createMockPlayerUnit({
      id: 'player_1',
      tileX: 5,
      tileY: 6,  // Adjacent
      hp: 100,
      maxHp: 100
    });

    const state = createMockBattleState({
      units: [enemy, player],
      mapWidth: 15,
      mapHeight: 15
    });

    const actions = aiService.decideTurnActions(enemy, state);

    // Hit-and-run should have attack action
    const attackAction = actions.find(a => a.actionType === 'attack');
    assert.ok(attackAction !== undefined,
      'Hit-and-run AI should attack when player is in range');
  });
});
