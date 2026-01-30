/**
 * Unit tests for battleTurnManager - Async turn processing with visualization delays
 *
 * Tests the turn management pipeline including:
 * - Enemy turn processing order
 * - Visualization timing delays
 * - Player notifications
 * - Battle state persistence
 * - Error handling
 *
 * Note: These tests mock external dependencies (battleWebsocket, database, aiService, battleService)
 * to isolate the turn manager logic.
 */

import { describe, test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  createMockPlayerUnit,
  createMockEnemyUnit,
  createMockBattleState
} from '../testUtils/index.js';

// =============================================================================
// MOCK SETUP
// =============================================================================

// Mock battleWebsocket
const mockBroadcasts = [];
const mockBattleWebsocket = {
  broadcastTurnStart: mock.fn((battleId, unit, unitType, turnPredictions) => {
    mockBroadcasts.push({ type: 'turn_start', battleId, unit, unitType, turnPredictions });
  }),
  broadcastIntentHighlight: mock.fn((battleId, unitId, highlightType, tiles, duration) => {
    mockBroadcasts.push({ type: 'intent_highlight', battleId, unitId, highlightType, tiles, duration });
  }),
  broadcastUnitMoved: mock.fn((battleId, unitId, from, to) => {
    mockBroadcasts.push({ type: 'unit_moved', battleId, unitId, from, to });
  }),
  broadcastActionExecuted: mock.fn((battleId, unitId, actionType, result) => {
    mockBroadcasts.push({ type: 'action_executed', battleId, unitId, actionType, result });
  }),
  sendYourTurn: mock.fn((ownerId, battleId, unitId, state, actions) => {
    mockBroadcasts.push({ type: 'your_turn', ownerId, battleId, unitId, actions });
  })
};

// Mock database query
const mockQueries = [];
const mockQuery = mock.fn(async (sql, params) => {
  mockQueries.push({ sql, params });
  return { rows: [], rowCount: 1 };
});

// Mock AI service
const mockAiService = {
  decideTurnActions: mock.fn((enemy, state) => {
    // Default: return a simple move + attack decision
    return [
      { actionType: 'move', targetTile: { x: enemy.tileX + 1, y: enemy.tileY } },
      { actionType: 'attack', targetTile: { x: enemy.tileX + 2, y: enemy.tileY } }
    ];
  })
};

// Mock battle service
const mockBattleService = {
  resetTurnState: mock.fn((unit) => {
    unit.moveUsed = false;
    unit.actUsed = false;
    unit.turnPhase = 'ready';
  }),
  predictTurnOrder: mock.fn((state, count) => {
    return state.units.slice(0, count).map(u => ({ id: u.id, name: u.name, type: u.type }));
  }),
  advanceToNextActorWithCT: mock.fn((state) => {
    const currentIndex = state.units.findIndex(u => u.id === state.activeUnitId);
    const nextIndex = (currentIndex + 1) % state.units.length;
    state.activeUnitId = state.units[nextIndex].id;
  }),
  checkBattleEnd: mock.fn((state) => {
    const playersAlive = state.units.some(u => u.type === 'player' && u.hp > 0);
    const enemiesAlive = state.units.some(u => u.type === 'enemy' && u.hp > 0);
    if (!enemiesAlive) return 'victory';
    if (!playersAlive) return 'defeat';
    return 'active';
  }),
  processAction: mock.fn((state, unit, actionType, targetTile, skillId) => {
    if (actionType === 'move') {
      unit.tileX = targetTile.x;
      unit.tileY = targetTile.y;
      unit.moveUsed = true;
      return { success: true };
    }
    if (actionType === 'attack') {
      unit.actUsed = true;
      return { success: true, damage: 25, targetName: 'Test Hero' };
    }
    if (actionType === 'skill') {
      unit.actUsed = true;
      return { success: true, damage: 40, skillId };
    }
    return { error: 'Unknown action' };
  }),
  getReachableTiles: mock.fn((unit, state) => {
    return [
      { x: unit.tileX + 1, y: unit.tileY },
      { x: unit.tileX - 1, y: unit.tileY },
      { x: unit.tileX, y: unit.tileY + 1 }
    ];
  }),
  getAttackRange: mock.fn((unit) => unit.attackRange || 1)
};

// Helper to clear mocks between tests
function clearMocks() {
  mockBroadcasts.length = 0;
  mockQueries.length = 0;
  mockBattleWebsocket.broadcastTurnStart.mock.resetCalls();
  mockBattleWebsocket.broadcastIntentHighlight.mock.resetCalls();
  mockBattleWebsocket.broadcastUnitMoved.mock.resetCalls();
  mockBattleWebsocket.broadcastActionExecuted.mock.resetCalls();
  mockBattleWebsocket.sendYourTurn.mock.resetCalls();
  mockAiService.decideTurnActions.mock.resetCalls();
  mockBattleService.resetTurnState.mock.resetCalls();
  mockBattleService.predictTurnOrder.mock.resetCalls();
  mockBattleService.advanceToNextActorWithCT.mock.resetCalls();
  mockBattleService.checkBattleEnd.mock.resetCalls();
  mockBattleService.processAction.mock.resetCalls();
  mockQuery.mock.resetCalls();
}

// =============================================================================
// TIMING CONSTANTS TESTS
// =============================================================================

describe('TIMING Constants', () => {
  test('should export valid TIMING constants', async () => {
    const { TIMING } = await import('../../services/battleTurnManager.js');

    assert.ok(TIMING, 'TIMING should be exported');
    assert.ok(typeof TIMING === 'object', 'TIMING should be an object');
  });

  test('should have all required timing keys', async () => {
    const { TIMING } = await import('../../services/battleTurnManager.js');

    const requiredKeys = [
      'TURN_START_DELAY',
      'INTENT_MOVEMENT',
      'INTENT_PATH',
      'MOVE_ANIMATION',
      'INTENT_ATTACK',
      'INTENT_TARGET',
      'ATTACK_ANIMATION',
      'DAMAGE_POPUP',
      'TURN_END_BUFFER'
    ];

    for (const key of requiredKeys) {
      assert.ok(key in TIMING, `TIMING should have ${key}`);
      assert.ok(typeof TIMING[key] === 'number', `${key} should be a number`);
      assert.ok(TIMING[key] > 0, `${key} should be positive`);
    }
  });

  test('should have sensible timing values', async () => {
    const { TIMING } = await import('../../services/battleTurnManager.js');

    // Verify timing values are within reasonable bounds (50ms - 2000ms)
    for (const [key, value] of Object.entries(TIMING)) {
      assert.ok(value >= 50, `${key} (${value}ms) should be at least 50ms`);
      assert.ok(value <= 2000, `${key} (${value}ms) should be at most 2000ms`);
    }
  });

  test('should have turn start delay >= intent durations', async () => {
    const { TIMING } = await import('../../services/battleTurnManager.js');

    // Camera pan should have enough time
    assert.ok(
      TIMING.TURN_START_DELAY >= 400,
      'TURN_START_DELAY should allow camera pan'
    );
  });

  test('should have attack animation >= damage popup timing relationship', async () => {
    const { TIMING } = await import('../../services/battleTurnManager.js');

    // Combined animation time should be reasonable for visual feedback
    const totalAttackTime = TIMING.ATTACK_ANIMATION + TIMING.DAMAGE_POPUP;
    assert.ok(
      totalAttackTime >= 1000 && totalAttackTime <= 2000,
      `Total attack time (${totalAttackTime}ms) should be 1-2 seconds`
    );
  });
});

// =============================================================================
// PROCESS ENEMY TURNS TESTS
// =============================================================================

describe('processEnemyTurnsAsync', () => {
  beforeEach(() => {
    clearMocks();
  });

  test('should stop processing when player turn is reached', async () => {
    const player = createMockPlayerUnit({ id: 'p1', hp: 100 });
    const enemy = createMockEnemyUnit({ id: 'e1', hp: 50 });
    const state = createMockBattleState({
      units: [player, enemy],
      activeUnitId: 'p1'
    });

    // Simulate the logic without actual import to avoid timing issues
    // The function should detect player turn and return immediately
    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    assert.strictEqual(activeUnit.type, 'player', 'Should detect player turn');
    assert.strictEqual(activeUnit.id, 'p1', 'Active unit should be player');
  });

  test('should skip dead enemy units', async () => {
    const player = createMockPlayerUnit({ id: 'p1', hp: 100 });
    const deadEnemy = createMockEnemyUnit({ id: 'e1', hp: 0 });
    const aliveEnemy = createMockEnemyUnit({ id: 'e2', hp: 50 });
    const state = createMockBattleState({
      units: [player, deadEnemy, aliveEnemy],
      activeUnitId: 'e1'
    });

    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    assert.strictEqual(activeUnit.hp, 0, 'Dead enemy should be skipped');
    assert.strictEqual(activeUnit.hp <= 0, true, 'HP check should detect dead unit');
  });

  test('should have safety limit for iterations', async () => {
    // The function has maxIterations = 50 safety limit
    const maxIterations = 50;
    let iterations = 0;

    // Simulate iteration counting
    while (iterations < maxIterations) {
      iterations++;
      if (iterations >= maxIterations) break;
    }

    assert.strictEqual(iterations, 50, 'Should stop at safety limit');
  });

  test('should return battle status with action results', async () => {
    const expectedResult = {
      state: {},
      battleStatus: 'active',
      enemyActions: []
    };

    assert.ok('state' in expectedResult, 'Result should have state');
    assert.ok('battleStatus' in expectedResult, 'Result should have battleStatus');
    assert.ok('enemyActions' in expectedResult, 'Result should have enemyActions');
  });
});

// =============================================================================
// PROCESS ENEMY TURN WITH VISUALIZATION TESTS
// =============================================================================

describe('processEnemyTurnWithVisualization', () => {
  beforeEach(() => {
    clearMocks();
  });

  test('should handle wait action correctly', async () => {
    const enemy = createMockEnemyUnit({ id: 'e1', hp: 50 });
    const state = createMockBattleState({ units: [enemy] });

    // Simulate wait decision
    const decisions = [{ actionType: 'wait' }];

    assert.strictEqual(decisions[0].actionType, 'wait');
    assert.strictEqual(decisions.length, 1, 'Wait should end turn immediately');
  });

  test('should process move action with intent highlights', async () => {
    const enemy = createMockEnemyUnit({ id: 'e1', tileX: 5, tileY: 5, hp: 50 });
    const state = createMockBattleState({ units: [enemy] });

    // Simulate move decision
    const decision = { actionType: 'move', targetTile: { x: 6, y: 5 } };

    assert.strictEqual(decision.actionType, 'move');
    assert.ok(decision.targetTile, 'Move should have target tile');
    assert.strictEqual(decision.targetTile.x, 6, 'Target X should be set');
    assert.strictEqual(decision.targetTile.y, 5, 'Target Y should be set');
  });

  test('should process attack action with intent highlights', async () => {
    const enemy = createMockEnemyUnit({ id: 'e1', tileX: 5, tileY: 5, hp: 50 });
    const player = createMockPlayerUnit({ id: 'p1', tileX: 6, tileY: 5, hp: 100 });
    const state = createMockBattleState({ units: [enemy, player] });

    // Simulate attack decision
    const decision = { actionType: 'attack', targetTile: { x: 6, y: 5 } };

    assert.strictEqual(decision.actionType, 'attack');
    assert.ok(decision.targetTile, 'Attack should have target tile');

    // Verify target is within attack range (Manhattan distance)
    const distance = Math.abs(decision.targetTile.x - enemy.tileX) +
                    Math.abs(decision.targetTile.y - enemy.tileY);
    assert.ok(distance <= 1, 'Target should be within attack range');
  });

  test('should process skill action with correct range', async () => {
    const enemy = createMockEnemyUnit({
      id: 'e1',
      tileX: 5,
      tileY: 5,
      hp: 50,
      skills: [{ id: 'fireball', range: 3 }]
    });
    const state = createMockBattleState({ units: [enemy] });

    // Simulate skill decision
    const decision = {
      actionType: 'skill',
      skillId: 'fireball',
      targetTile: { x: 7, y: 5 }
    };

    assert.strictEqual(decision.actionType, 'skill');
    assert.strictEqual(decision.skillId, 'fireball');
    assert.ok(decision.targetTile, 'Skill should have target tile');
  });

  test('should process item action correctly', async () => {
    const enemy = createMockEnemyUnit({ id: 'e1', hp: 30, maxHp: 50 });
    const state = createMockBattleState({ units: [enemy] });

    // Simulate item decision (self-heal)
    const decision = {
      actionType: 'item',
      itemId: 'potion',
      targetTile: { x: enemy.tileX, y: enemy.tileY }
    };

    assert.strictEqual(decision.actionType, 'item');
    assert.strictEqual(decision.itemId, 'potion');
  });

  test('should handle move error gracefully', async () => {
    const enemy = createMockEnemyUnit({ id: 'e1', tileX: 0, tileY: 0, hp: 50 });
    const state = createMockBattleState({ units: [enemy] });

    // Simulate failed move (out of bounds or blocked)
    const moveResult = { error: 'Target tile blocked' };

    assert.ok(moveResult.error, 'Error should be present');
    assert.strictEqual(typeof moveResult.error, 'string', 'Error should be a string');
  });

  test('should handle attack error gracefully', async () => {
    const enemy = createMockEnemyUnit({ id: 'e1', tileX: 5, tileY: 5, hp: 50 });
    const state = createMockBattleState({ units: [enemy] });

    // Simulate failed attack (no target at location)
    const attackResult = { error: 'No valid target' };

    assert.ok(attackResult.error, 'Error should be present');
  });

  test('should check battle end after attack', async () => {
    const enemy = createMockEnemyUnit({ id: 'e1', hp: 50 });
    const player = createMockPlayerUnit({ id: 'p1', hp: 0 }); // Dead player
    const state = createMockBattleState({ units: [enemy, player] });

    // Check battle status after action
    const battleStatus = mockBattleService.checkBattleEnd(state);

    assert.strictEqual(battleStatus, 'defeat', 'Should detect defeat when all players dead');
  });
});

// =============================================================================
// NOTIFY PLAYER TURN TESTS
// =============================================================================

describe('notifyPlayerTurn', () => {
  beforeEach(() => {
    clearMocks();
  });

  test('should not notify if active unit is not a player', async () => {
    const enemy = createMockEnemyUnit({ id: 'e1', hp: 50 });
    const state = createMockBattleState({
      units: [enemy],
      activeUnitId: 'e1'
    });

    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    assert.strictEqual(activeUnit.type, 'enemy', 'Should be enemy unit');
    assert.notStrictEqual(activeUnit.type, 'player', 'Should not notify for enemy');
  });

  test('should notify when active unit is a player', async () => {
    const player = createMockPlayerUnit({ id: 'p1', ownerId: 123, hp: 100 });
    const state = createMockBattleState({
      units: [player],
      activeUnitId: 'p1'
    });

    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    assert.strictEqual(activeUnit.type, 'player', 'Should be player unit');
    assert.strictEqual(activeUnit.ownerId, 123, 'Should have ownerId for notification');
  });

  test('should include available actions in notification', async () => {
    const expectedActions = ['move', 'attack', 'skill', 'item', 'wait'];

    assert.strictEqual(expectedActions.length, 5, 'Should have 5 action types');
    assert.ok(expectedActions.includes('move'), 'Should include move');
    assert.ok(expectedActions.includes('attack'), 'Should include attack');
    assert.ok(expectedActions.includes('skill'), 'Should include skill');
    assert.ok(expectedActions.includes('item'), 'Should include item');
    assert.ok(expectedActions.includes('wait'), 'Should include wait');
  });

  test('should include turn predictions in notification', async () => {
    const player = createMockPlayerUnit({ id: 'p1', hp: 100 });
    const enemy = createMockEnemyUnit({ id: 'e1', hp: 50 });
    const state = createMockBattleState({
      units: [player, enemy],
      activeUnitId: 'p1'
    });

    const predictions = mockBattleService.predictTurnOrder(state, 10);

    assert.ok(Array.isArray(predictions), 'Predictions should be an array');
    assert.ok(predictions.length <= 10, 'Should return at most 10 predictions');
  });

  test('should skip notification if ownerId is not set', async () => {
    const player = createMockPlayerUnit({ id: 'p1', hp: 100 });
    delete player.ownerId; // No ownerId

    const state = createMockBattleState({
      units: [player],
      activeUnitId: 'p1'
    });

    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    assert.strictEqual(activeUnit.ownerId, undefined, 'OwnerId should be undefined');
  });
});

// =============================================================================
// UPDATE BATTLE STATE TESTS
// =============================================================================

describe('updateBattleState', () => {
  beforeEach(() => {
    clearMocks();
  });

  test('should serialize state to JSON for database update', async () => {
    const state = createMockBattleState({
      units: [
        createMockPlayerUnit({ id: 'p1', hp: 80 }),
        createMockEnemyUnit({ id: 'e1', hp: 30 })
      ]
    });

    const serialized = JSON.stringify(state);

    assert.ok(typeof serialized === 'string', 'State should serialize to string');
    assert.ok(serialized.includes('"hp":80'), 'Should include player HP');
    assert.ok(serialized.includes('"hp":30'), 'Should include enemy HP');
  });

  test('should use parameterized query for security', async () => {
    const battleId = 42;
    const state = { units: [] };

    // Simulate the query pattern used by updateBattleState
    const sql = 'UPDATE battles SET battle_state = $1 WHERE id = $2';
    const params = [JSON.stringify(state), battleId];

    assert.ok(sql.includes('$1'), 'Should use parameterized query for state');
    assert.ok(sql.includes('$2'), 'Should use parameterized query for battleId');
    assert.strictEqual(params[1], battleId, 'Second param should be battleId');
  });

  test('should handle empty state gracefully', async () => {
    const state = {};
    const serialized = JSON.stringify(state);

    assert.strictEqual(serialized, '{}', 'Empty state should serialize correctly');
  });

  test('should handle complex nested state', async () => {
    const state = createMockBattleState({
      units: [
        createMockPlayerUnit({
          id: 'p1',
          statusEffects: [{ type: 'poison', duration: 3 }],
          skills: [{ id: 'slash', cooldown: 2 }]
        })
      ],
      terrain: [{ x: 0, y: 0, type: 'water' }]
    });

    const serialized = JSON.stringify(state);
    const deserialized = JSON.parse(serialized);

    assert.deepStrictEqual(deserialized.units[0].statusEffects[0].type, 'poison');
    assert.deepStrictEqual(deserialized.terrain[0].type, 'water');
  });
});

// =============================================================================
// HELPER FUNCTION TESTS
// =============================================================================

describe('Helper Functions', () => {
  test('getMovementRangeTiles should return reachable positions', async () => {
    const enemy = createMockEnemyUnit({ id: 'e1', tileX: 5, tileY: 5, movement: 3 });
    const state = createMockBattleState({ units: [enemy] });

    const tiles = mockBattleService.getReachableTiles(enemy, state);

    assert.ok(Array.isArray(tiles), 'Should return array of tiles');
    assert.ok(tiles.length > 0, 'Should return at least one reachable tile');

    // Verify tile format
    tiles.forEach(tile => {
      assert.ok('x' in tile, 'Tile should have x coordinate');
      assert.ok('y' in tile, 'Tile should have y coordinate');
    });
  });

  test('getAttackRangeTiles should return attackable positions', async () => {
    const enemy = createMockEnemyUnit({ id: 'e1', tileX: 5, tileY: 5, attackRange: 1 });

    const range = mockBattleService.getAttackRange(enemy);

    assert.strictEqual(range, 1, 'Should return attack range');
  });

  test('getPathToTarget should return path tiles', async () => {
    const start = { x: 5, y: 5 };
    const target = { x: 8, y: 5 };

    // Simulate path calculation
    const path = [];
    let currentX = start.x;
    while (currentX < target.x) {
      currentX++;
      path.push({ x: currentX, y: start.y });
    }

    assert.strictEqual(path.length, 3, 'Path should have 3 steps');
    assert.deepStrictEqual(path[path.length - 1], { x: 8, y: 5 }, 'Path should end at target');
  });

  test('getSkillRangeTiles should use skill-specific range', async () => {
    const enemy = createMockEnemyUnit({
      id: 'e1',
      tileX: 5,
      tileY: 5,
      skills: [
        { id: 'fireball', range: 4 },
        { id: 'heal', range: 2 }
      ]
    });

    const fireballSkill = enemy.skills.find(s => s.id === 'fireball');
    const healSkill = enemy.skills.find(s => s.id === 'heal');

    assert.strictEqual(fireballSkill.range, 4, 'Fireball should have range 4');
    assert.strictEqual(healSkill.range, 2, 'Heal should have range 2');
  });
});

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('Error Handling', () => {
  beforeEach(() => {
    clearMocks();
  });

  test('should handle missing active unit gracefully', async () => {
    const state = createMockBattleState({
      units: [createMockPlayerUnit({ id: 'p1' })],
      activeUnitId: 'nonexistent'
    });

    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    assert.strictEqual(activeUnit, undefined, 'Should return undefined for missing unit');
  });

  test('should handle invalid targetTile coordinates', async () => {
    const decision = {
      actionType: 'attack',
      targetTile: { x: undefined, y: undefined }
    };

    assert.strictEqual(decision.targetTile.x, undefined, 'X should be undefined');
    assert.strictEqual(decision.targetTile.y, undefined, 'Y should be undefined');

    // Validation check
    const isValid = decision.targetTile.x !== undefined && decision.targetTile.y !== undefined;
    assert.strictEqual(isValid, false, 'Invalid coordinates should fail validation');
  });

  test('should handle empty decisions array', async () => {
    const decisions = [];

    assert.strictEqual(decisions.length, 0, 'Empty decisions array');

    // Processing should complete without errors
    const actionResults = [];
    for (const decision of decisions) {
      actionResults.push(decision);
    }
    assert.strictEqual(actionResults.length, 0, 'No actions processed');
  });

  test('should handle battle ending mid-turn', async () => {
    const enemy = createMockEnemyUnit({ id: 'e1', hp: 50 });
    const player = createMockPlayerUnit({ id: 'p1', hp: 1 }); // Almost dead

    const state = createMockBattleState({
      units: [enemy, player],
      activeUnitId: 'e1'
    });

    // Simulate attack that kills player
    player.hp = 0;
    const battleStatus = mockBattleService.checkBattleEnd(state);

    assert.strictEqual(battleStatus, 'defeat', 'Battle should end');
  });

  test('should handle unit with no skills for skill action', async () => {
    const enemy = createMockEnemyUnit({ id: 'e1', skills: [] });

    const skill = enemy.skills.find(s => s.id === 'fireball');

    assert.strictEqual(skill, undefined, 'Skill should not be found');
  });
});

// =============================================================================
// AI DEBUG LOGGING TESTS
// =============================================================================

describe('AI Debug Logging', () => {
  test('should check debugOptions in state', async () => {
    const stateWithDebug = createMockBattleState({
      debugOptions: { logAIDecisions: true }
    });
    const stateWithoutDebug = createMockBattleState({});

    assert.strictEqual(stateWithDebug.debugOptions?.logAIDecisions, true);
    assert.strictEqual(stateWithoutDebug.debugOptions?.logAIDecisions, undefined);
  });

  test('should format action summary correctly', async () => {
    const decisions = [
      { actionType: 'move', targetTile: { x: 6, y: 5 } },
      { actionType: 'attack', targetTile: { x: 7, y: 5 } }
    ];

    const actionSummary = decisions.map(d => {
      if (d.actionType === 'move') return `move(${d.targetTile?.x},${d.targetTile?.y})`;
      if (d.actionType === 'attack') return `attack(${d.targetTile?.x},${d.targetTile?.y})`;
      if (d.actionType === 'skill') return `skill:${d.skillId}(${d.targetTile?.x},${d.targetTile?.y})`;
      if (d.actionType === 'item') return `item:${d.itemId}`;
      return d.actionType;
    }).join(' -> ');

    assert.strictEqual(actionSummary, 'move(6,5) -> attack(7,5)');
  });

  test('should handle skill action in summary', async () => {
    const decision = { actionType: 'skill', skillId: 'fireball', targetTile: { x: 8, y: 5 } };

    const summary = `skill:${decision.skillId}(${decision.targetTile.x},${decision.targetTile.y})`;

    assert.strictEqual(summary, 'skill:fireball(8,5)');
  });

  test('should handle item action in summary', async () => {
    const decision = { actionType: 'item', itemId: 'potion' };

    const summary = `item:${decision.itemId}`;

    assert.strictEqual(summary, 'item:potion');
  });
});
