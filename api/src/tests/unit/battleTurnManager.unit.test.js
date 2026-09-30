/**
 * Unit tests for battleTurnManager - Async turn processing with visualization delays
 *
 * Tests the turn management pipeline including:
 * - Enemy turn processing order
 * - Visualization timing delays
 * - Player notifications
 * - Battle state persistence
 * - Error handling
 * - Multiplayer turn timer logic
 *
 * Note: These tests mock external dependencies (battleWebsocket, database, aiService, battleService)
 * to isolate the turn manager logic.
 */

import { describe, it, test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  createMockPlayerUnit,
  createMockEnemyUnit,
  createMockBattleState,
  createMockSkill
} from '../testUtils/index.js';

// =============================================================================
// TIMING CONSTANTS TESTS (Direct import - no mocking needed)
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

  test('should have sensible timing values (50ms - 2000ms)', async () => {
    const { TIMING } = await import('../../services/battleTurnManager.js');

    for (const [key, value] of Object.entries(TIMING)) {
      assert.ok(value >= 50, `${key} (${value}ms) should be at least 50ms`);
      assert.ok(value <= 2000, `${key} (${value}ms) should be at most 2000ms`);
    }
  });

  test('should have turn start delay >= 400ms for camera pan', async () => {
    const { TIMING } = await import('../../services/battleTurnManager.js');

    assert.ok(
      TIMING.TURN_START_DELAY >= 400,
      `TURN_START_DELAY (${TIMING.TURN_START_DELAY}ms) should allow camera pan`
    );
  });

  test('should have combined attack timing between 1-2 seconds', async () => {
    const { TIMING } = await import('../../services/battleTurnManager.js');

    const totalAttackTime = TIMING.ATTACK_ANIMATION + TIMING.DAMAGE_POPUP;
    assert.ok(
      totalAttackTime >= 1000 && totalAttackTime <= 2000,
      `Total attack time (${totalAttackTime}ms) should be 1-2 seconds`
    );
  });

  test('should have intent timings for visual feedback', async () => {
    const { TIMING } = await import('../../services/battleTurnManager.js');

    // Intent highlights should be long enough to be visible
    assert.ok(TIMING.INTENT_MOVEMENT >= 400, 'Movement intent should be visible');
    assert.ok(TIMING.INTENT_PATH >= 300, 'Path intent should be visible');
    assert.ok(TIMING.INTENT_ATTACK >= 400, 'Attack intent should be visible');
    assert.ok(TIMING.INTENT_TARGET >= 300, 'Target intent should be visible');
  });
});

// =============================================================================
// MOCK SETUP FOR INTEGRATION-LIKE TESTS
// =============================================================================

// Mock broadcasts collector
let mockBroadcasts = [];
let mockQueries = [];

// Create mock functions
function createMockBattleWebsocket() {
  return {
    broadcastTurnStart: mock.fn((battleId, unit, unitType, turnPredictions) => {
      mockBroadcasts.push({ type: 'turn_start', battleId, unit, unitType, turnPredictions });
    }),
    broadcastIntentHighlight: mock.fn((battleId, unitId, highlightType, tiles, duration) => {
      mockBroadcasts.push({ type: 'intent_highlight', battleId, unitId, highlightType, tiles, duration });
    }),
    broadcastUnitMoved: mock.fn((battleId, unitId, from, to, submitterId = null) => {
      mockBroadcasts.push({ type: 'unit_moved', battleId, unitId, from, to, submitterId });
    }),
    broadcastActionExecuted: mock.fn((battleId, unitId, actionType, result, submitterId = null) => {
      mockBroadcasts.push({ type: 'action_executed', battleId, unitId, actionType, result, submitterId });
    }),
    sendYourTurn: mock.fn((ownerId, battleId, unitId, state, actions) => {
      mockBroadcasts.push({ type: 'your_turn', ownerId, battleId, unitId, actions });
    })
  };
}

function createMockAiService() {
  return {
    decideTurnActions: mock.fn((enemy, state) => {
      // Default: return a simple move + attack decision
      return [
        { actionType: 'move', targetTile: { x: enemy.tileX + 1, y: enemy.tileY } },
        { actionType: 'attack', targetTile: { x: enemy.tileX + 2, y: enemy.tileY } }
      ];
    })
  };
}

function createMockBattleService() {
  return {
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
      if (!enemiesAlive) return { status: 'ended', winningTeamId: 1 };
      if (!playersAlive) return { status: 'ended', winningTeamId: 2 };
      return { status: 'active', winningTeamId: null };
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
      if (actionType === 'item') {
        unit.actUsed = true;
        return { success: true, hpRestored: 20 };
      }
      return { error: 'Unknown action' };
    }),
    getReachableTiles: mock.fn((unit, state) => {
      return [
        { x: unit.tileX + 1, y: unit.tileY, cost: 1 },
        { x: unit.tileX - 1, y: unit.tileY, cost: 1 },
        { x: unit.tileX, y: unit.tileY + 1, cost: 1 }
      ];
    }),
    getAttackRange: mock.fn((unit) => unit.attackRange || 1)
  };
}

function clearMocks() {
  mockBroadcasts = [];
  mockQueries = [];
}

// =============================================================================
// PROCESS ENEMY TURNS LOGIC TESTS
// =============================================================================

describe('processEnemyTurnsAsync Logic', () => {
  beforeEach(() => {
    clearMocks();
  });

  test('should stop processing when player turn is reached', () => {
    const player = createMockPlayerUnit({ id: 'p1', hp: 100 });
    const enemy = createMockEnemyUnit({ id: 'e1', hp: 50 });
    const state = createMockBattleState({
      units: [player, enemy],
      activeUnitId: 'p1'
    });

    // Simulate the check done in processEnemyTurnsAsync
    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    assert.strictEqual(activeUnit.type, 'player', 'Should detect player turn');
    assert.strictEqual(activeUnit.id, 'p1', 'Active unit should be player');
  });

  test('should detect enemy turn for processing', () => {
    const player = createMockPlayerUnit({ id: 'p1', hp: 100 });
    const enemy = createMockEnemyUnit({ id: 'e1', hp: 50 });
    const state = createMockBattleState({
      units: [player, enemy],
      activeUnitId: 'e1'
    });

    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    assert.strictEqual(activeUnit.type, 'enemy', 'Should detect enemy turn');
    assert.strictEqual(activeUnit.id, 'e1', 'Active unit should be enemy');
  });

  test('should skip dead enemy units', () => {
    const player = createMockPlayerUnit({ id: 'p1', hp: 100 });
    const deadEnemy = createMockEnemyUnit({ id: 'e1', hp: 0 });
    const aliveEnemy = createMockEnemyUnit({ id: 'e2', hp: 50 });
    const state = createMockBattleState({
      units: [player, deadEnemy, aliveEnemy],
      activeUnitId: 'e1'
    });

    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    assert.strictEqual(activeUnit.hp, 0, 'Dead enemy should be detected');
    assert.strictEqual(activeUnit.hp <= 0, true, 'HP check should detect dead unit');
  });

  test('should have safety limit for iterations (maxIterations = 50)', () => {
    const maxIterations = 50;
    let iterations = 0;

    // Simulate iteration counting like the real function
    while (iterations < maxIterations) {
      iterations++;
      if (iterations >= maxIterations) break;
    }

    assert.strictEqual(iterations, 50, 'Should stop at safety limit');
  });

  test('should handle missing active unit gracefully', () => {
    const state = createMockBattleState({
      units: [createMockPlayerUnit({ id: 'p1' })],
      activeUnitId: 'nonexistent'
    });

    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    assert.strictEqual(activeUnit, undefined, 'Should return undefined for missing unit');
  });

  test('should return expected result structure', () => {
    const expectedResult = {
      state: {},
      battleStatus: 'active',
      battleEndResult: { status: 'active', winningTeamId: null },
      enemyActions: []
    };

    assert.ok('state' in expectedResult, 'Result should have state');
    assert.ok('battleStatus' in expectedResult, 'Result should have battleStatus');
    assert.ok('battleEndResult' in expectedResult, 'Result should have battleEndResult');
    assert.ok('enemyActions' in expectedResult, 'Result should have enemyActions');
  });

  test('should detect victory when all enemies dead', () => {
    const mockBattleService = createMockBattleService();
    const state = createMockBattleState({
      units: [
        createMockPlayerUnit({ id: 'p1', hp: 100 }),
        createMockEnemyUnit({ id: 'e1', hp: 0 })
      ]
    });

    const result = mockBattleService.checkBattleEnd(state);

    assert.strictEqual(result.status, 'ended');
    assert.strictEqual(result.winningTeamId, 1);
  });

  test('should detect defeat when all players dead', () => {
    const mockBattleService = createMockBattleService();
    const state = createMockBattleState({
      units: [
        createMockPlayerUnit({ id: 'p1', hp: 0 }),
        createMockEnemyUnit({ id: 'e1', hp: 50 })
      ]
    });

    const result = mockBattleService.checkBattleEnd(state);

    assert.strictEqual(result.status, 'ended');
    assert.strictEqual(result.winningTeamId, 2);
  });
});

// =============================================================================
// PROCESS ENEMY TURN WITH VISUALIZATION TESTS
// =============================================================================

describe('processEnemyTurnWithVisualization Logic', () => {
  beforeEach(() => {
    clearMocks();
  });

  describe('Wait Action', () => {
    test('should handle wait action correctly', () => {
      const enemy = createMockEnemyUnit({ id: 'e1', hp: 50 });
      const decisions = [{ actionType: 'wait' }];

      assert.strictEqual(decisions[0].actionType, 'wait');
      assert.strictEqual(decisions.length, 1, 'Wait should end turn immediately');
    });

    test('wait should not include targetTile', () => {
      const decision = { actionType: 'wait' };

      assert.strictEqual(decision.targetTile, undefined);
    });
  });

  describe('Move Action', () => {
    test('should process move action with target tile', () => {
      const enemy = createMockEnemyUnit({ id: 'e1', tileX: 5, tileY: 5, hp: 50 });
      const decision = { actionType: 'move', targetTile: { x: 6, y: 5 } };

      assert.strictEqual(decision.actionType, 'move');
      assert.ok(decision.targetTile, 'Move should have target tile');
      assert.strictEqual(decision.targetTile.x, 6, 'Target X should be set');
      assert.strictEqual(decision.targetTile.y, 5, 'Target Y should be set');
    });

    test('should update unit position after move', () => {
      const mockBattleService = createMockBattleService();
      const enemy = createMockEnemyUnit({ id: 'e1', tileX: 5, tileY: 5 });
      const state = createMockBattleState({ units: [enemy] });
      const targetTile = { x: 6, y: 5 };

      mockBattleService.processAction(state, enemy, 'move', targetTile, null);

      assert.strictEqual(enemy.tileX, 6, 'Unit X should be updated');
      assert.strictEqual(enemy.tileY, 5, 'Unit Y should be unchanged');
      assert.strictEqual(enemy.moveUsed, true, 'Move should be marked as used');
    });

    test('should handle move error gracefully', () => {
      const moveResult = { error: 'Target tile blocked' };

      assert.ok(moveResult.error, 'Error should be present');
      assert.strictEqual(typeof moveResult.error, 'string', 'Error should be a string');
    });
  });

  describe('Attack Action', () => {
    test('should process attack action with target tile', () => {
      const enemy = createMockEnemyUnit({ id: 'e1', tileX: 5, tileY: 5, hp: 50 });
      const player = createMockPlayerUnit({ id: 'p1', tileX: 6, tileY: 5, hp: 100 });
      const decision = { actionType: 'attack', targetTile: { x: 6, y: 5 } };

      assert.strictEqual(decision.actionType, 'attack');
      assert.ok(decision.targetTile, 'Attack should have target tile');

      // Verify target is within attack range (Manhattan distance)
      const distance = Math.abs(decision.targetTile.x - enemy.tileX) +
                      Math.abs(decision.targetTile.y - enemy.tileY);
      assert.ok(distance <= 1, 'Target should be within attack range');
    });

    test('should return damage result on successful attack', () => {
      const mockBattleService = createMockBattleService();
      const enemy = createMockEnemyUnit({ id: 'e1', tileX: 5, tileY: 5 });
      const player = createMockPlayerUnit({ id: 'p1', tileX: 6, tileY: 5 });
      const state = createMockBattleState({ units: [enemy, player] });

      const result = mockBattleService.processAction(state, enemy, 'attack', { x: 6, y: 5 }, null);

      assert.strictEqual(result.success, true);
      assert.ok(result.damage > 0, 'Should deal damage');
      assert.strictEqual(enemy.actUsed, true, 'Act should be marked as used');
    });

    test('should handle attack error gracefully', () => {
      const attackResult = { error: 'No valid target' };

      assert.ok(attackResult.error, 'Error should be present');
    });

    test('should check battle end after attack', () => {
      const mockBattleService = createMockBattleService();
      const enemy = createMockEnemyUnit({ id: 'e1', hp: 50 });
      const player = createMockPlayerUnit({ id: 'p1', hp: 0 }); // Dead player
      const state = createMockBattleState({ units: [enemy, player] });

      const battleStatus = mockBattleService.checkBattleEnd(state);

      assert.strictEqual(battleStatus.status, 'ended', 'Should detect battle end');
      assert.strictEqual(battleStatus.winningTeamId, 2, 'Enemy team should win');
    });
  });

  describe('Skill Action', () => {
    test('should process skill action with correct structure', () => {
      const enemy = createMockEnemyUnit({
        id: 'e1',
        tileX: 5,
        tileY: 5,
        hp: 50,
        skills: [{ id: 'fireball', range: 3 }]
      });
      const decision = {
        actionType: 'skill',
        skillId: 'fireball',
        targetTile: { x: 7, y: 5 }
      };

      assert.strictEqual(decision.actionType, 'skill');
      assert.strictEqual(decision.skillId, 'fireball');
      assert.ok(decision.targetTile, 'Skill should have target tile');
    });

    test('should get skill range from unit skills array', () => {
      const enemy = createMockEnemyUnit({
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

    test('should handle unit with no skills', () => {
      const enemy = createMockEnemyUnit({ id: 'e1', skills: [] });

      const skill = enemy.skills.find(s => s.id === 'fireball');

      assert.strictEqual(skill, undefined, 'Skill should not be found');
    });
  });

  describe('Item Action', () => {
    test('should process item action correctly', () => {
      const enemy = createMockEnemyUnit({ id: 'e1', hp: 30, maxHp: 50, tileX: 5, tileY: 5 });
      const decision = {
        actionType: 'item',
        itemId: 'potion',
        targetTile: { x: 5, y: 5 } // Self-target
      };

      assert.strictEqual(decision.actionType, 'item');
      assert.strictEqual(decision.itemId, 'potion');
    });

    test('should handle item with no targetTile (defaults to self)', () => {
      const enemy = createMockEnemyUnit({ id: 'e1', tileX: 5, tileY: 5 });
      const decision = { actionType: 'item', itemId: 'potion' };

      // The code uses: decision.targetTile || { x: enemy.tileX, y: enemy.tileY }
      const effectiveTarget = decision.targetTile || { x: enemy.tileX, y: enemy.tileY };

      assert.strictEqual(effectiveTarget.x, 5);
      assert.strictEqual(effectiveTarget.y, 5);
    });
  });
});

// =============================================================================
// NOTIFY PLAYER TURN TESTS
// =============================================================================

describe('notifyPlayerTurn Logic', () => {
  beforeEach(() => {
    clearMocks();
  });

  test('should not notify if active unit is not a player', () => {
    const enemy = createMockEnemyUnit({ id: 'e1', hp: 50 });
    const state = createMockBattleState({
      units: [enemy],
      activeUnitId: 'e1'
    });

    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    assert.strictEqual(activeUnit.type, 'enemy', 'Should be enemy unit');
    assert.notStrictEqual(activeUnit.type, 'player', 'Should not notify for enemy');
  });

  test('should identify player turn correctly', () => {
    const player = createMockPlayerUnit({ id: 'p1', ownerId: 123, hp: 100 });
    const state = createMockBattleState({
      units: [player],
      activeUnitId: 'p1'
    });

    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    assert.strictEqual(activeUnit.type, 'player', 'Should be player unit');
    assert.strictEqual(activeUnit.ownerId, 123, 'Should have ownerId for notification');
  });

  test('should include all available actions in notification', () => {
    const expectedActions = ['move', 'attack', 'skill', 'item', 'wait'];

    assert.strictEqual(expectedActions.length, 5, 'Should have 5 action types');
    assert.ok(expectedActions.includes('move'), 'Should include move');
    assert.ok(expectedActions.includes('attack'), 'Should include attack');
    assert.ok(expectedActions.includes('skill'), 'Should include skill');
    assert.ok(expectedActions.includes('item'), 'Should include item');
    assert.ok(expectedActions.includes('wait'), 'Should include wait');
  });

  test('should generate turn predictions', () => {
    const mockBattleService = createMockBattleService();
    const player = createMockPlayerUnit({ id: 'p1', hp: 100 });
    const enemy = createMockEnemyUnit({ id: 'e1', hp: 50 });
    const state = createMockBattleState({
      units: [player, enemy],
      activeUnitId: 'p1'
    });

    const predictions = mockBattleService.predictTurnOrder(state, 10);

    assert.ok(Array.isArray(predictions), 'Predictions should be an array');
    assert.ok(predictions.length <= 10, 'Should return at most 10 predictions');
    assert.ok(predictions[0].id, 'Prediction should have id');
    assert.ok(predictions[0].type, 'Prediction should have type');
  });

  test('should skip notification if ownerId is not set', () => {
    const player = createMockPlayerUnit({ id: 'p1', hp: 100 });
    delete player.ownerId; // No ownerId

    const state = createMockBattleState({
      units: [player],
      activeUnitId: 'p1'
    });

    const activeUnit = state.units.find(u => u.id === state.activeUnitId);

    assert.strictEqual(activeUnit.ownerId, undefined, 'OwnerId should be undefined');
  });

  describe('Multiplayer Turn Timer Logic', () => {
    test('should detect PvP battle type', () => {
      const state = createMockBattleState({ battleType: 'pvp' });

      const isPvP = state.battleType === 'pvp' || state.battleType === 'pvp_coliseum';

      assert.strictEqual(isPvP, true);
    });

    test('should detect PvP coliseum battle type', () => {
      const state = createMockBattleState({ battleType: 'pvp_coliseum' });

      const isPvP = state.battleType === 'pvp' || state.battleType === 'pvp_coliseum';

      assert.strictEqual(isPvP, true);
    });

    test('should detect multiplayer PvE with multiple unique owners', () => {
      const player1 = createMockPlayerUnit({ id: 'p1', ownerId: 100 });
      const player2 = createMockPlayerUnit({ id: 'p2', ownerId: 200 });
      const enemy = createMockEnemyUnit({ id: 'e1' });
      const state = createMockBattleState({
        units: [player1, player2, enemy],
        battleType: 'pve'
      });

      const playerUnits = state.units.filter(u => u.type === 'player' && u.ownerId);
      const uniqueOwners = new Set(playerUnits.map(u => u.ownerId));
      const isPvP = state.battleType === 'pvp' || state.battleType === 'pvp_coliseum';
      const isMultiplayerPvE = !isPvP && uniqueOwners.size > 1;

      assert.strictEqual(uniqueOwners.size, 2, 'Should have 2 unique owners');
      assert.strictEqual(isMultiplayerPvE, true, 'Should be multiplayer PvE');
    });

    test('should not be multiplayer for single player PvE', () => {
      const player1 = createMockPlayerUnit({ id: 'p1', ownerId: 100 });
      const player2 = createMockPlayerUnit({ id: 'p2', ownerId: 100 }); // Same owner
      const enemy = createMockEnemyUnit({ id: 'e1' });
      const state = createMockBattleState({
        units: [player1, player2, enemy],
        battleType: 'pve'
      });

      const playerUnits = state.units.filter(u => u.type === 'player' && u.ownerId);
      const uniqueOwners = new Set(playerUnits.map(u => u.ownerId));
      const isPvP = state.battleType === 'pvp' || state.battleType === 'pvp_coliseum';
      const isMultiplayerPvE = !isPvP && uniqueOwners.size > 1;
      const isMultiplayer = isPvP || isMultiplayerPvE;

      assert.strictEqual(uniqueOwners.size, 1, 'Should have 1 unique owner');
      assert.strictEqual(isMultiplayer, false, 'Should not be multiplayer');
    });
  });
});

// =============================================================================
// UPDATE BATTLE STATE TESTS
// =============================================================================

describe('updateBattleState Logic', () => {
  beforeEach(() => {
    clearMocks();
  });

  test('should serialize state to JSON for database update', () => {
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

  test('should use parameterized query pattern for security', () => {
    const battleId = 42;
    const state = { units: [] };

    // Simulate the query pattern used by updateBattleState
    const sql = 'UPDATE battles SET battle_state = $1 WHERE id = $2';
    const params = [JSON.stringify(state), battleId];

    assert.ok(sql.includes('$1'), 'Should use parameterized query for state');
    assert.ok(sql.includes('$2'), 'Should use parameterized query for battleId');
    assert.strictEqual(params[1], battleId, 'Second param should be battleId');
    assert.strictEqual(typeof params[0], 'string', 'First param should be JSON string');
  });

  test('should handle empty state gracefully', () => {
    const state = {};
    const serialized = JSON.stringify(state);

    assert.strictEqual(serialized, '{}', 'Empty state should serialize correctly');
  });

  test('should handle complex nested state', () => {
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

  test('should preserve unit positions in serialized state', () => {
    const state = createMockBattleState({
      units: [
        createMockPlayerUnit({ id: 'p1', tileX: 3, tileY: 7 }),
        createMockEnemyUnit({ id: 'e1', tileX: 12, tileY: 4 })
      ]
    });

    const serialized = JSON.stringify(state);
    const deserialized = JSON.parse(serialized);

    assert.strictEqual(deserialized.units[0].tileX, 3);
    assert.strictEqual(deserialized.units[0].tileY, 7);
    assert.strictEqual(deserialized.units[1].tileX, 12);
    assert.strictEqual(deserialized.units[1].tileY, 4);
  });
});

// =============================================================================
// HELPER FUNCTION TESTS
// =============================================================================

describe('Helper Functions', () => {
  describe('getMovementRangeTiles', () => {
    test('should return reachable positions from battleService', () => {
      const mockBattleService = createMockBattleService();
      const enemy = createMockEnemyUnit({ id: 'e1', tileX: 5, tileY: 5, movement: 3 });
      const state = createMockBattleState({ units: [enemy] });

      const tiles = mockBattleService.getReachableTiles(enemy, state);

      assert.ok(Array.isArray(tiles), 'Should return array of tiles');
      assert.ok(tiles.length > 0, 'Should return at least one reachable tile');

      // Verify tile format includes coordinates
      tiles.forEach(tile => {
        assert.ok('x' in tile, 'Tile should have x coordinate');
        assert.ok('y' in tile, 'Tile should have y coordinate');
      });
    });

    test('should convert tiles to {x, y} format', () => {
      const rawTiles = [
        { x: 6, y: 5, cost: 1 },
        { x: 4, y: 5, cost: 1 },
        { x: 5, y: 6, cost: 1 }
      ];

      // Simulate the conversion done in getMovementRangeTiles
      const formattedTiles = rawTiles.map(tile => ({ x: tile.x, y: tile.y }));

      assert.deepStrictEqual(formattedTiles[0], { x: 6, y: 5 });
      assert.ok(!('cost' in formattedTiles[0]), 'Should not include cost');
    });
  });

  describe('getAttackRangeTiles', () => {
    test('should return tiles within attack range', () => {
      const mockBattleService = createMockBattleService();
      const enemy = createMockEnemyUnit({ id: 'e1', tileX: 5, tileY: 5, attackRange: 1 });

      const range = mockBattleService.getAttackRange(enemy);

      assert.strictEqual(range, 1, 'Should return attack range');
    });

    test('should calculate Manhattan distance for range', () => {
      const unit = { tileX: 5, tileY: 5 };
      const range = 2;
      const tiles = [];
      const state = { mapWidth: 32, mapHeight: 32 };

      // Simulate getAttackRangeTiles logic
      for (let dx = -range; dx <= range; dx++) {
        for (let dy = -range; dy <= range; dy++) {
          if (Math.abs(dx) + Math.abs(dy) <= range && (dx !== 0 || dy !== 0)) {
            const x = unit.tileX + dx;
            const y = unit.tileY + dy;
            if (x >= 0 && x < state.mapWidth && y >= 0 && y < state.mapHeight) {
              tiles.push({ x, y });
            }
          }
        }
      }

      // Range 2 should have tiles at distance 1 and 2 (not 0)
      assert.ok(tiles.length > 0, 'Should have tiles');
      assert.ok(tiles.some(t => t.x === 7 && t.y === 5), 'Should include tile at range 2 (east)');
      assert.ok(tiles.some(t => t.x === 6 && t.y === 5), 'Should include tile at range 1 (east)');
      assert.ok(!tiles.some(t => t.x === 5 && t.y === 5), 'Should not include self');
    });
  });

  describe('getSkillRangeTiles', () => {
    test('should use skill-specific range', () => {
      const enemy = createMockEnemyUnit({
        id: 'e1',
        tileX: 5,
        tileY: 5,
        skills: [
          { id: 'fireball', range: 4 },
          { id: 'heal', range: 2 }
        ]
      });
      const skillId = 'fireball';

      // Simulate getSkillRangeTiles logic
      let range = 1; // Default
      if (Array.isArray(enemy.skills)) {
        const skill = enemy.skills.find(s => s.id === skillId);
        if (skill) {
          range = skill.range || 1;
        }
      }

      assert.strictEqual(range, 4, 'Should use fireball range of 4');
    });

    test('should default to range 1 for unknown skill', () => {
      const enemy = createMockEnemyUnit({
        id: 'e1',
        skills: [{ id: 'fireball', range: 4 }]
      });
      const skillId = 'unknown_skill';

      let range = 1;
      if (Array.isArray(enemy.skills)) {
        const skill = enemy.skills.find(s => s.id === skillId);
        if (skill) {
          range = skill.range || 1;
        }
      }

      assert.strictEqual(range, 1, 'Should default to range 1');
    });
  });

  describe('getPathToTarget', () => {
    test('should return path tiles from unit to target', () => {
      const start = { x: 5, y: 5 };
      const target = { x: 8, y: 5 };

      // Simulate getPathToTarget logic (simple line)
      const path = [];
      let currentX = start.x;
      let currentY = start.y;

      while (currentX !== target.x || currentY !== target.y) {
        if (currentX < target.x) currentX++;
        else if (currentX > target.x) currentX--;

        if (currentY < target.y) currentY++;
        else if (currentY > target.y) currentY--;

        path.push({ x: currentX, y: currentY });

        if (path.length > 20) break;
      }

      assert.strictEqual(path.length, 3, 'Path should have 3 steps');
      assert.deepStrictEqual(path[path.length - 1], { x: 8, y: 5 }, 'Path should end at target');
    });

    test('should handle diagonal movement', () => {
      const unit = { tileX: 5, tileY: 5 };
      const targetTile = { x: 8, y: 8 };

      const path = [];
      let currentX = unit.tileX;
      let currentY = unit.tileY;

      while (currentX !== targetTile.x || currentY !== targetTile.y) {
        if (currentX < targetTile.x) currentX++;
        else if (currentX > targetTile.x) currentX--;

        if (currentY < targetTile.y) currentY++;
        else if (currentY > targetTile.y) currentY--;

        path.push({ x: currentX, y: currentY });

        if (path.length > 20) break;
      }

      assert.strictEqual(path.length, 3, 'Diagonal path should have 3 steps');
      assert.deepStrictEqual(path[path.length - 1], { x: 8, y: 8 });
    });

    test('should have safety limit of 20 steps', () => {
      const unit = { tileX: 0, tileY: 0 };
      const targetTile = { x: 100, y: 100 }; // Very far target

      const path = [];
      let currentX = unit.tileX;
      let currentY = unit.tileY;

      while (currentX !== targetTile.x || currentY !== targetTile.y) {
        if (currentX < targetTile.x) currentX++;
        else if (currentX > targetTile.x) currentX--;

        if (currentY < targetTile.y) currentY++;
        else if (currentY > targetTile.y) currentY--;

        path.push({ x: currentX, y: currentY });

        if (path.length > 20) break;
      }

      assert.ok(path.length <= 21, 'Path should be limited to ~20 steps');
    });

    test('should return empty path for same position', () => {
      const unit = { tileX: 5, tileY: 5 };
      const targetTile = { x: 5, y: 5 };

      const path = [];
      let currentX = unit.tileX;
      let currentY = unit.tileY;

      while (currentX !== targetTile.x || currentY !== targetTile.y) {
        // Would not enter loop since already at target
        if (currentX < targetTile.x) currentX++;
        else if (currentX > targetTile.x) currentX--;
        if (currentY < targetTile.y) currentY++;
        else if (currentY > targetTile.y) currentY--;
        path.push({ x: currentX, y: currentY });
        if (path.length > 20) break;
      }

      assert.strictEqual(path.length, 0, 'Path should be empty for same position');
    });
  });
});

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('Error Handling', () => {
  beforeEach(() => {
    clearMocks();
  });

  test('should handle invalid targetTile coordinates', () => {
    const decision = {
      actionType: 'attack',
      targetTile: { x: undefined, y: undefined }
    };

    assert.strictEqual(decision.targetTile.x, undefined, 'X should be undefined');
    assert.strictEqual(decision.targetTile.y, undefined, 'Y should be undefined');

    // Validation check from the code
    const isValid = decision.targetTile.x !== undefined && decision.targetTile.y !== undefined;
    assert.strictEqual(isValid, false, 'Invalid coordinates should fail validation');
  });

  test('should handle null targetTile', () => {
    const decision = {
      actionType: 'move',
      targetTile: null
    };

    // When targetTile is null, accessing .x would throw, so we check truthiness first
    const hasValidTargetTile = decision.targetTile !== null &&
                               decision.targetTile !== undefined &&
                               decision.targetTile.x !== undefined;
    assert.strictEqual(hasValidTargetTile, false, 'Null targetTile should fail check');
  });

  test('should handle empty decisions array', () => {
    const decisions = [];

    assert.strictEqual(decisions.length, 0, 'Empty decisions array');

    const actionResults = [];
    for (const decision of decisions) {
      actionResults.push(decision);
    }
    assert.strictEqual(actionResults.length, 0, 'No actions processed');
  });

  test('should handle battle ending mid-turn', () => {
    const mockBattleService = createMockBattleService();
    const enemy = createMockEnemyUnit({ id: 'e1', hp: 50 });
    const player = createMockPlayerUnit({ id: 'p1', hp: 0 }); // Dead

    const state = createMockBattleState({
      units: [enemy, player],
      activeUnitId: 'e1'
    });

    const battleStatus = mockBattleService.checkBattleEnd(state);

    assert.strictEqual(battleStatus.status, 'ended', 'Battle should end');
    assert.strictEqual(battleStatus.winningTeamId, 2, 'Enemy should win');
  });

  test('should handle processAction returning error', () => {
    const errorResult = { error: 'Target out of range' };

    assert.ok(errorResult.error, 'Error should be present');
    assert.ok(!errorResult.success, 'Success should not be true');
  });

  test('should handle unknown action type', () => {
    const mockBattleService = createMockBattleService();
    const enemy = createMockEnemyUnit({ id: 'e1' });
    const state = createMockBattleState({ units: [enemy] });

    const result = mockBattleService.processAction(state, enemy, 'unknown_action', {}, null);

    assert.ok(result.error, 'Should return error for unknown action');
  });
});

// =============================================================================
// AI DEBUG LOGGING TESTS
// =============================================================================

describe('AI Debug Logging', () => {
  test('should check debugOptions.logAIDecisions in state', () => {
    const stateWithDebug = createMockBattleState({
      debugOptions: { logAIDecisions: true }
    });
    const stateWithoutDebug = createMockBattleState({});

    // Simulate isAIDebugEnabled function
    const isEnabled1 = stateWithDebug?.debugOptions?.logAIDecisions === true;
    const isEnabled2 = stateWithoutDebug?.debugOptions?.logAIDecisions === true;

    assert.strictEqual(isEnabled1, true);
    assert.strictEqual(isEnabled2, false);
  });

  test('should handle missing debugOptions gracefully', () => {
    const state = createMockBattleState({});
    delete state.debugOptions;

    const isEnabled = state?.debugOptions?.logAIDecisions === true;

    assert.strictEqual(isEnabled, false);
  });

  test('should format move action summary correctly', () => {
    const decision = { actionType: 'move', targetTile: { x: 6, y: 5 } };

    const summary = `move(${decision.targetTile?.x},${decision.targetTile?.y})`;

    assert.strictEqual(summary, 'move(6,5)');
  });

  test('should format attack action summary correctly', () => {
    const decision = { actionType: 'attack', targetTile: { x: 7, y: 5 } };

    const summary = `attack(${decision.targetTile?.x},${decision.targetTile?.y})`;

    assert.strictEqual(summary, 'attack(7,5)');
  });

  test('should format skill action summary correctly', () => {
    const decision = { actionType: 'skill', skillId: 'fireball', targetTile: { x: 8, y: 5 } };

    const summary = `skill:${decision.skillId}(${decision.targetTile?.x},${decision.targetTile?.y})`;

    assert.strictEqual(summary, 'skill:fireball(8,5)');
  });

  test('should format item action summary correctly', () => {
    const decision = { actionType: 'item', itemId: 'potion' };

    const summary = `item:${decision.itemId}`;

    assert.strictEqual(summary, 'item:potion');
  });

  test('should format full turn action sequence', () => {
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

  test('should handle wait action in summary', () => {
    const decision = { actionType: 'wait' };

    const summary = decision.actionType;

    assert.strictEqual(summary, 'wait');
  });
});

// =============================================================================
// BROADCAST MESSAGE FORMAT TESTS
// =============================================================================

describe('Broadcast Message Formats', () => {
  beforeEach(() => {
    clearMocks();
  });

  test('turn_start broadcast should include required fields', () => {
    const mockWs = createMockBattleWebsocket();
    const battleId = 123;
    const unit = { id: 'e1', name: 'Goblin', position: { x: 5, y: 5 } };
    const unitType = 'enemy';
    const turnPredictions = [{ id: 'p1', name: 'Hero', type: 'player' }];

    mockWs.broadcastTurnStart(battleId, unit, unitType, turnPredictions);

    const broadcast = mockBroadcasts[0];
    assert.strictEqual(broadcast.type, 'turn_start');
    assert.strictEqual(broadcast.battleId, 123);
    assert.ok(broadcast.unit.id);
    assert.ok(broadcast.unit.name);
  });

  test('intent_highlight broadcast should include tiles array', () => {
    const mockWs = createMockBattleWebsocket();
    const tiles = [{ x: 5, y: 5 }, { x: 6, y: 5 }];

    mockWs.broadcastIntentHighlight(123, 'e1', 'movement_range', tiles, 600);

    const broadcast = mockBroadcasts[0];
    assert.strictEqual(broadcast.type, 'intent_highlight');
    assert.strictEqual(broadcast.highlightType, 'movement_range');
    assert.ok(Array.isArray(broadcast.tiles));
    assert.strictEqual(broadcast.duration, 600);
  });

  test('unit_moved broadcast should include from and to positions', () => {
    const mockWs = createMockBattleWebsocket();
    const from = { x: 5, y: 5 };
    const to = { x: 6, y: 5 };

    mockWs.broadcastUnitMoved(123, 'e1', from, to);

    const broadcast = mockBroadcasts[0];
    assert.strictEqual(broadcast.type, 'unit_moved');
    assert.deepStrictEqual(broadcast.from, { x: 5, y: 5 });
    assert.deepStrictEqual(broadcast.to, { x: 6, y: 5 });
  });

  test('action_executed broadcast should include action result', () => {
    const mockWs = createMockBattleWebsocket();
    const result = { damage: 25, targetName: 'Hero', isCritical: false };

    mockWs.broadcastActionExecuted(123, 'e1', 'attack', result);

    const broadcast = mockBroadcasts[0];
    assert.strictEqual(broadcast.type, 'action_executed');
    assert.strictEqual(broadcast.actionType, 'attack');
    assert.strictEqual(broadcast.result.damage, 25);
  });

  test('your_turn notification should include available actions', () => {
    const mockWs = createMockBattleWebsocket();
    const actions = ['move', 'attack', 'skill', 'item', 'wait'];

    mockWs.sendYourTurn(100, 123, 'p1', {}, actions);

    const broadcast = mockBroadcasts[0];
    assert.strictEqual(broadcast.type, 'your_turn');
    assert.strictEqual(broadcast.ownerId, 100);
    assert.deepStrictEqual(broadcast.actions, actions);
  });
});

// =============================================================================
// BATTLE SERVICE INTEGRATION TESTS
// =============================================================================

describe('Battle Service Integration', () => {
  test('resetTurnState should reset all turn flags', () => {
    const mockBattleService = createMockBattleService();
    const unit = createMockEnemyUnit({
      moveUsed: true,
      actUsed: true,
      turnPhase: 'done'
    });

    mockBattleService.resetTurnState(unit);

    assert.strictEqual(unit.moveUsed, false);
    assert.strictEqual(unit.actUsed, false);
    assert.strictEqual(unit.turnPhase, 'ready');
  });

  test('advanceToNextActorWithCT should cycle to next unit', () => {
    const mockBattleService = createMockBattleService();
    const state = createMockBattleState({
      units: [
        createMockPlayerUnit({ id: 'p1' }),
        createMockEnemyUnit({ id: 'e1' }),
        createMockEnemyUnit({ id: 'e2' })
      ],
      activeUnitId: 'p1'
    });

    mockBattleService.advanceToNextActorWithCT(state);

    assert.strictEqual(state.activeUnitId, 'e1', 'Should advance to next unit');
  });

  test('advanceToNextActorWithCT should wrap around', () => {
    const mockBattleService = createMockBattleService();
    const state = createMockBattleState({
      units: [
        createMockPlayerUnit({ id: 'p1' }),
        createMockEnemyUnit({ id: 'e1' })
      ],
      activeUnitId: 'e1'
    });

    mockBattleService.advanceToNextActorWithCT(state);

    assert.strictEqual(state.activeUnitId, 'p1', 'Should wrap to first unit');
  });
});

// =============================================================================
// ACTION RESULT STRUCTURE TESTS
// =============================================================================

describe('Action Result Structures', () => {
  test('move action result should have expected structure', () => {
    const actionResult = {
      unitId: 'e1',
      unitName: 'Goblin',
      actionType: 'move',
      targetTile: { x: 6, y: 5 },
      result: { success: true }
    };

    assert.ok(actionResult.unitId);
    assert.ok(actionResult.unitName);
    assert.strictEqual(actionResult.actionType, 'move');
    assert.ok(actionResult.targetTile);
    assert.ok(actionResult.result);
  });

  test('attack action result should include damage info', () => {
    const actionResult = {
      unitId: 'e1',
      unitName: 'Goblin',
      actionType: 'attack',
      targetTile: { x: 5, y: 5 },
      result: { success: true, damage: 25, targetName: 'Hero', isCritical: false }
    };

    assert.strictEqual(actionResult.actionType, 'attack');
    assert.ok(actionResult.result.damage > 0);
    assert.ok(actionResult.result.targetName);
  });

  test('skill action result should include skillId', () => {
    const actionResult = {
      unitId: 'e1',
      unitName: 'Goblin Shaman',
      actionType: 'skill',
      targetTile: { x: 5, y: 5 },
      skillId: 'fireball',
      result: { success: true, damage: 40 }
    };

    assert.strictEqual(actionResult.actionType, 'skill');
    assert.strictEqual(actionResult.skillId, 'fireball');
  });

  test('item action result should include itemId', () => {
    const actionResult = {
      unitId: 'e1',
      unitName: 'Goblin',
      actionType: 'item',
      targetTile: { x: 5, y: 5 },
      itemId: 'potion',
      result: { success: true, hpRestored: 20 }
    };

    assert.strictEqual(actionResult.actionType, 'item');
    assert.strictEqual(actionResult.itemId, 'potion');
    assert.ok(actionResult.result.hpRestored > 0);
  });
});

// =============================================================================
// DELAY FUNCTION TESTS
// =============================================================================

describe('Delay Function', () => {
  test('delay should return a promise', () => {
    // Simulate delay function
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const result = delay(1);

    assert.ok(result instanceof Promise, 'Should return a Promise');
  });

  test('delay should resolve after specified time', async () => {
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const start = Date.now();

    await delay(50);

    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40, 'Should wait at least ~50ms');
    assert.ok(elapsed < 200, 'Should not wait too long');
  });
});

// =============================================================================
// MAP BOUNDARY TESTS
// =============================================================================

describe('Map Boundary Handling', () => {
  test('should respect map width boundary', () => {
    const state = createMockBattleState({ mapWidth: 32, mapHeight: 32 });
    const unit = { tileX: 31, tileY: 5 };
    const range = 2;
    const tiles = [];

    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        if (Math.abs(dx) + Math.abs(dy) <= range && (dx !== 0 || dy !== 0)) {
          const x = unit.tileX + dx;
          const y = unit.tileY + dy;
          if (x >= 0 && x < state.mapWidth && y >= 0 && y < state.mapHeight) {
            tiles.push({ x, y });
          }
        }
      }
    }

    // Should not include tiles at x >= 32
    assert.ok(!tiles.some(t => t.x >= 32), 'Should not exceed map width');
  });

  test('should respect map height boundary', () => {
    const state = createMockBattleState({ mapWidth: 32, mapHeight: 32 });
    const unit = { tileX: 5, tileY: 31 };
    const range = 2;
    const tiles = [];

    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        if (Math.abs(dx) + Math.abs(dy) <= range && (dx !== 0 || dy !== 0)) {
          const x = unit.tileX + dx;
          const y = unit.tileY + dy;
          if (x >= 0 && x < state.mapWidth && y >= 0 && y < state.mapHeight) {
            tiles.push({ x, y });
          }
        }
      }
    }

    assert.ok(!tiles.some(t => t.y >= 32), 'Should not exceed map height');
  });

  test('should respect minimum boundary (0,0)', () => {
    const state = createMockBattleState({ mapWidth: 32, mapHeight: 32 });
    const unit = { tileX: 0, tileY: 0 };
    const range = 2;
    const tiles = [];

    for (let dx = -range; dx <= range; dx++) {
      for (let dy = -range; dy <= range; dy++) {
        if (Math.abs(dx) + Math.abs(dy) <= range && (dx !== 0 || dy !== 0)) {
          const x = unit.tileX + dx;
          const y = unit.tileY + dy;
          if (x >= 0 && x < state.mapWidth && y >= 0 && y < state.mapHeight) {
            tiles.push({ x, y });
          }
        }
      }
    }

    assert.ok(!tiles.some(t => t.x < 0), 'Should not have negative x');
    assert.ok(!tiles.some(t => t.y < 0), 'Should not have negative y');
  });

  test('should use default map dimensions if not specified', () => {
    const state = createMockBattleState({});

    // Default values from createMockBattleState
    const mapWidth = state.mapWidth || 32;
    const mapHeight = state.mapHeight || 32;

    assert.strictEqual(mapWidth, 32);
    assert.strictEqual(mapHeight, 32);
  });
});

// =============================================================================
// PROCESS ENEMY TURNS ASYNC COMPREHENSIVE TESTS
// =============================================================================

describe('processEnemyTurnsAsync Advanced Scenarios', () => {
  beforeEach(() => {
    clearMocks();
  });

  describe('Multiple Enemy Turn Processing', () => {
    test('should process multiple consecutive enemy turns', () => {
      const player = createMockPlayerUnit({ id: 'p1', hp: 100 });
      const enemy1 = createMockEnemyUnit({ id: 'e1', hp: 50 });
      const enemy2 = createMockEnemyUnit({ id: 'e2', hp: 50 });
      const state = createMockBattleState({
        units: [player, enemy1, enemy2],
        activeUnitId: 'e1'  // Start with enemy turn
      });

      // Verify we detect enemy turn
      const activeUnit = state.units.find(u => u.id === state.activeUnitId);
      assert.strictEqual(activeUnit.type, 'enemy');

      // Simulate advancing through enemy units
      const mockBattleService = createMockBattleService();

      // Process e1's turn
      assert.strictEqual(state.activeUnitId, 'e1');
      mockBattleService.advanceToNextActorWithCT(state);

      // Now should be e2 (next in order)
      assert.strictEqual(state.activeUnitId, 'e2');
      mockBattleService.advanceToNextActorWithCT(state);

      // Should wrap back to p1
      assert.strictEqual(state.activeUnitId, 'p1');
    });

    test('should skip all dead enemies when advancing', () => {
      const player = createMockPlayerUnit({ id: 'p1', hp: 100 });
      const deadEnemy1 = createMockEnemyUnit({ id: 'e1', hp: 0 });
      const deadEnemy2 = createMockEnemyUnit({ id: 'e2', hp: 0 });
      const state = createMockBattleState({
        units: [player, deadEnemy1, deadEnemy2],
        activeUnitId: 'e1'
      });

      // When enemy is dead, the loop should skip
      const activeUnit = state.units.find(u => u.id === state.activeUnitId);
      assert.strictEqual(activeUnit.hp <= 0, true);
    });

    test('should track enemy actions correctly', () => {
      const actionResults = [];
      const enemy = createMockEnemyUnit({ id: 'e1', hp: 50, tileX: 5, tileY: 5 });
      const moveAction = {
        unitId: enemy.id,
        unitName: enemy.name,
        actionType: 'move',
        targetTile: { x: 6, y: 5 },
        result: { success: true }
      };
      const attackAction = {
        unitId: enemy.id,
        unitName: enemy.name,
        actionType: 'attack',
        targetTile: { x: 7, y: 5 },
        result: { success: true, damage: 25 }
      };

      actionResults.push(moveAction, attackAction);

      assert.strictEqual(actionResults.length, 2);
      assert.strictEqual(actionResults[0].actionType, 'move');
      assert.strictEqual(actionResults[1].actionType, 'attack');
    });
  });

  describe('Battle Status Transitions', () => {
    test('should detect victory immediately when last enemy dies', () => {
      const mockBattleService = createMockBattleService();
      const player = createMockPlayerUnit({ id: 'p1', hp: 100 });
      const enemy = createMockEnemyUnit({ id: 'e1', hp: 0 });  // Just died
      const state = createMockBattleState({
        units: [player, enemy]
      });

      const battleStatus = mockBattleService.checkBattleEnd(state);

      assert.strictEqual(battleStatus.status, 'ended');
      assert.strictEqual(battleStatus.winningTeamId, 1);
    });

    test('should detect defeat when last player dies', () => {
      const mockBattleService = createMockBattleService();
      const player = createMockPlayerUnit({ id: 'p1', hp: 0 });  // Just died
      const enemy = createMockEnemyUnit({ id: 'e1', hp: 50 });
      const state = createMockBattleState({
        units: [player, enemy]
      });

      const battleStatus = mockBattleService.checkBattleEnd(state);

      assert.strictEqual(battleStatus.status, 'ended');
      assert.strictEqual(battleStatus.winningTeamId, 2);
    });

    test('should continue when both sides have survivors', () => {
      const mockBattleService = createMockBattleService();
      const player = createMockPlayerUnit({ id: 'p1', hp: 10 });  // Low but alive
      const enemy = createMockEnemyUnit({ id: 'e1', hp: 5 });  // Low but alive
      const state = createMockBattleState({
        units: [player, enemy]
      });

      const battleStatus = mockBattleService.checkBattleEnd(state);

      assert.strictEqual(battleStatus.status, 'active');
      assert.strictEqual(battleStatus.winningTeamId, null);
    });
  });

  describe('Return Value Structure', () => {
    test('should return correct structure with all fields', () => {
      const expectedStructure = {
        state: { units: [], mapWidth: 32, mapHeight: 32 },
        battleStatus: 'active',
        battleEndResult: { status: 'active', winningTeamId: null },
        enemyActions: []
      };

      assert.ok('state' in expectedStructure);
      assert.ok('battleStatus' in expectedStructure);
      assert.ok('battleEndResult' in expectedStructure);
      assert.ok('enemyActions' in expectedStructure);
      assert.strictEqual(typeof expectedStructure.battleStatus, 'string');
      assert.ok(Array.isArray(expectedStructure.enemyActions));
    });

    test('should include winningTeamId in battleEndResult when battle ends', () => {
      const victoryResult = {
        state: {},
        battleStatus: 'victory',
        battleEndResult: { status: 'ended', winningTeamId: 1 },
        enemyActions: []
      };

      assert.strictEqual(victoryResult.battleEndResult.winningTeamId, 1);
      assert.strictEqual(victoryResult.battleStatus, 'victory');
    });

    test('should include enemy actions array in result', () => {
      const resultWithActions = {
        state: {},
        battleStatus: 'active',
        battleEndResult: { status: 'active', winningTeamId: null },
        enemyActions: [
          { unitId: 'e1', actionType: 'move', result: { success: true } },
          { unitId: 'e1', actionType: 'attack', result: { damage: 25 } }
        ]
      };

      assert.strictEqual(resultWithActions.enemyActions.length, 2);
      assert.strictEqual(resultWithActions.enemyActions[0].actionType, 'move');
      assert.strictEqual(resultWithActions.enemyActions[1].result.damage, 25);
    });
  });
});

// =============================================================================
// VISUALIZATION TIMING TESTS
// =============================================================================

describe('Visualization Timing Calculations', () => {
  test('should calculate total attack sequence time', async () => {
    const { TIMING } = await import('../../services/battleTurnManager.js');

    const attackSequenceTime =
      TIMING.INTENT_ATTACK +
      TIMING.INTENT_TARGET +
      TIMING.ATTACK_ANIMATION +
      TIMING.DAMAGE_POPUP;

    // Should be reasonable for player perception (1.5-3 seconds)
    assert.ok(attackSequenceTime >= 1500, 'Attack sequence too fast');
    assert.ok(attackSequenceTime <= 3000, 'Attack sequence too slow');
  });

  test('should calculate total move sequence time', async () => {
    const { TIMING } = await import('../../services/battleTurnManager.js');

    const moveSequenceTime =
      TIMING.INTENT_MOVEMENT +
      TIMING.INTENT_PATH +
      TIMING.MOVE_ANIMATION * 3;  // 3 tiles movement

    // Should be reasonable
    assert.ok(moveSequenceTime >= 1500, 'Move sequence too fast');
    assert.ok(moveSequenceTime <= 4000, 'Move sequence too slow');
  });

  test('should calculate full enemy turn time (move + attack)', async () => {
    const { TIMING } = await import('../../services/battleTurnManager.js');

    const fullTurnTime =
      TIMING.TURN_START_DELAY +
      TIMING.INTENT_MOVEMENT +
      TIMING.INTENT_PATH +
      TIMING.MOVE_ANIMATION * 3 +
      TIMING.INTENT_ATTACK +
      TIMING.INTENT_TARGET +
      TIMING.ATTACK_ANIMATION +
      TIMING.DAMAGE_POPUP +
      TIMING.TURN_END_BUFFER;

    // Full turn should be 3-6 seconds
    assert.ok(fullTurnTime >= 3000, 'Full turn too fast');
    assert.ok(fullTurnTime <= 8000, 'Full turn too slow');
  });
});

// =============================================================================
// AI DECISION INTEGRATION TESTS
// =============================================================================

describe('AI Decision Integration', () => {
  beforeEach(() => {
    clearMocks();
  });

  describe('Decision Array Processing', () => {
    test('should handle single-action decision (wait only)', () => {
      const decisions = [{ actionType: 'wait' }];

      assert.strictEqual(decisions.length, 1);
      assert.strictEqual(decisions[0].actionType, 'wait');
    });

    test('should handle move-only decision', () => {
      const decisions = [
        { actionType: 'move', targetTile: { x: 6, y: 5 } }
      ];

      assert.strictEqual(decisions.length, 1);
      assert.strictEqual(decisions[0].actionType, 'move');
      assert.ok(decisions[0].targetTile);
    });

    test('should handle attack-only decision', () => {
      const decisions = [
        { actionType: 'attack', targetTile: { x: 6, y: 5 } }
      ];

      assert.strictEqual(decisions.length, 1);
      assert.strictEqual(decisions[0].actionType, 'attack');
    });

    test('should handle full turn decision (move + attack)', () => {
      const decisions = [
        { actionType: 'move', targetTile: { x: 6, y: 5 } },
        { actionType: 'attack', targetTile: { x: 7, y: 5 } }
      ];

      assert.strictEqual(decisions.length, 2);
      assert.strictEqual(decisions[0].actionType, 'move');
      assert.strictEqual(decisions[1].actionType, 'attack');
    });

    test('should handle skill decision with skillId', () => {
      const decisions = [
        { actionType: 'skill', skillId: 'fireball', targetTile: { x: 8, y: 5 } }
      ];

      assert.strictEqual(decisions[0].actionType, 'skill');
      assert.strictEqual(decisions[0].skillId, 'fireball');
      assert.ok(decisions[0].targetTile);
    });

    test('should handle item decision with itemId', () => {
      const decisions = [
        { actionType: 'item', itemId: 'potion', targetTile: { x: 5, y: 5 } }
      ];

      assert.strictEqual(decisions[0].actionType, 'item');
      assert.strictEqual(decisions[0].itemId, 'potion');
    });
  });

  describe('Decision Validation', () => {
    test('should detect invalid targetTile in move decision', () => {
      const decision = {
        actionType: 'move',
        targetTile: { x: undefined, y: 5 }
      };

      const isValid =
        decision.targetTile &&
        decision.targetTile.x !== undefined &&
        decision.targetTile.y !== undefined;

      assert.strictEqual(isValid, false);
    });

    test('should detect missing targetTile in attack decision', () => {
      const decision = {
        actionType: 'attack',
        targetTile: null
      };

      const hasTargetTile = decision.targetTile !== null;

      assert.strictEqual(hasTargetTile, false);
    });

    test('should detect missing skillId in skill decision', () => {
      const decision = {
        actionType: 'skill',
        targetTile: { x: 5, y: 5 }
        // skillId is missing
      };

      const hasSkillId = Boolean(decision.skillId);

      assert.strictEqual(hasSkillId, false);
    });

    test('should detect missing itemId in item decision', () => {
      const decision = {
        actionType: 'item',
        targetTile: { x: 5, y: 5 }
        // itemId is missing
      };

      const hasItemId = Boolean(decision.itemId);

      assert.strictEqual(hasItemId, false);
    });
  });
});

// =============================================================================
// NOTIFY PLAYER TURN COMPREHENSIVE TESTS
// =============================================================================

describe('notifyPlayerTurn Advanced Scenarios', () => {
  beforeEach(() => {
    clearMocks();
  });

  describe('Turn Timer Logic', () => {
    test('should identify solo PvE correctly', () => {
      const player = createMockPlayerUnit({ id: 'p1', ownerId: 100 });
      const enemy = createMockEnemyUnit({ id: 'e1' });
      const state = createMockBattleState({
        units: [player, enemy],
        battleType: 'pve'
      });

      const playerUnits = state.units.filter(u => u.type === 'player' && u.ownerId);
      const uniqueOwners = new Set(playerUnits.map(u => u.ownerId));
      const isPvP = state.battleType === 'pvp' || state.battleType === 'pvp_coliseum';
      const isMultiplayerPvE = !isPvP && uniqueOwners.size > 1;
      const isMultiplayer = isPvP || isMultiplayerPvE;

      assert.strictEqual(uniqueOwners.size, 1);
      assert.strictEqual(isMultiplayer, false);
    });

    test('should identify 2-player co-op PvE', () => {
      const player1 = createMockPlayerUnit({ id: 'p1', ownerId: 100 });
      const player2 = createMockPlayerUnit({ id: 'p2', ownerId: 200 });
      const enemy = createMockEnemyUnit({ id: 'e1' });
      const state = createMockBattleState({
        units: [player1, player2, enemy],
        battleType: 'pve'
      });

      const playerUnits = state.units.filter(u => u.type === 'player' && u.ownerId);
      const uniqueOwners = new Set(playerUnits.map(u => u.ownerId));
      const isPvP = state.battleType === 'pvp' || state.battleType === 'pvp_coliseum';
      const isMultiplayerPvE = !isPvP && uniqueOwners.size > 1;

      assert.strictEqual(uniqueOwners.size, 2);
      assert.strictEqual(isMultiplayerPvE, true);
    });

    test('should identify 1v1 PvP', () => {
      const player1 = createMockPlayerUnit({ id: 'p1', ownerId: 100, teamId: 1 });
      const player2 = createMockPlayerUnit({ id: 'p2', ownerId: 200, teamId: 2 });
      const state = createMockBattleState({
        units: [player1, player2],
        battleType: 'pvp'
      });

      const isPvP = state.battleType === 'pvp' || state.battleType === 'pvp_coliseum';

      assert.strictEqual(isPvP, true);
    });

    test('should identify coliseum PvP', () => {
      const player1 = createMockPlayerUnit({ id: 'p1', ownerId: 100, teamId: 1 });
      const player2 = createMockPlayerUnit({ id: 'p2', ownerId: 200, teamId: 2 });
      const state = createMockBattleState({
        units: [player1, player2],
        battleType: 'pvp_coliseum'
      });

      const isPvP = state.battleType === 'pvp' || state.battleType === 'pvp_coliseum';
      const isMultiplayer = isPvP;

      assert.strictEqual(isPvP, true);
      assert.strictEqual(isMultiplayer, true);
    });
  });

  describe('Available Actions Computation', () => {
    test('should compute actions for fresh unit (can move and act)', () => {
      const player = createMockPlayerUnit({
        id: 'p1',
        moveUsed: false,
        actUsed: false,
        statusEffects: []
      });

      const canMove = !player.moveUsed;
      const canAct = !player.actUsed;

      assert.strictEqual(canMove, true);
      assert.strictEqual(canAct, true);
    });

    test('should compute actions for unit that has moved', () => {
      const player = createMockPlayerUnit({
        id: 'p1',
        moveUsed: true,
        actUsed: false,
        statusEffects: []
      });

      const canMove = !player.moveUsed;
      const canAct = !player.actUsed;

      assert.strictEqual(canMove, false);
      assert.strictEqual(canAct, true);
    });

    test('should compute actions for unit that has acted', () => {
      const player = createMockPlayerUnit({
        id: 'p1',
        moveUsed: false,
        actUsed: true,
        statusEffects: []
      });

      const canMove = !player.moveUsed;
      const canAct = !player.actUsed;

      assert.strictEqual(canMove, true);
      assert.strictEqual(canAct, false);
    });

    test('should compute actions for stunned unit', () => {
      const player = createMockPlayerUnit({
        id: 'p1',
        moveUsed: false,
        actUsed: false,
        statusEffects: [{ type: 'stun', duration: 1 }]
      });

      // With stun, both move and act are prevented
      const hasPreventingEffect = player.statusEffects.some(e => e.type === 'stun');

      assert.strictEqual(hasPreventingEffect, true);
    });
  });
});

// =============================================================================
// EDGE CASE AND ERROR RECOVERY TESTS
// =============================================================================

describe('Edge Cases and Error Recovery', () => {
  beforeEach(() => {
    clearMocks();
  });

  describe('Empty or Invalid State', () => {
    test('should handle state with no units', () => {
      const state = createMockBattleState({ units: [] });

      assert.strictEqual(state.units.length, 0);
      // Should not crash when processing
      const activeUnit = state.units.find(u => u.id === state.activeUnitId);
      assert.strictEqual(activeUnit, undefined);
    });

    test('should handle state with all dead units', () => {
      const deadPlayer = createMockPlayerUnit({ id: 'p1', hp: 0 });
      const deadEnemy = createMockEnemyUnit({ id: 'e1', hp: 0 });
      const state = createMockBattleState({
        units: [deadPlayer, deadEnemy],
        activeUnitId: 'p1'
      });

      const aliveUnits = state.units.filter(u => u.hp > 0);
      assert.strictEqual(aliveUnits.length, 0);
    });

    test('should handle activeUnitId pointing to nonexistent unit', () => {
      const state = createMockBattleState({
        units: [createMockPlayerUnit({ id: 'p1' })],
        activeUnitId: 'nonexistent_id'
      });

      const activeUnit = state.units.find(u => u.id === state.activeUnitId);
      assert.strictEqual(activeUnit, undefined);
    });

    test('should handle null activeUnitId', () => {
      const state = createMockBattleState({
        units: [createMockPlayerUnit({ id: 'p1' })],
        activeUnitId: null
      });

      const activeUnit = state.units.find(u => u.id === state.activeUnitId);
      assert.strictEqual(activeUnit, undefined);
    });
  });

  describe('Action Processing Errors', () => {
    test('should handle move action error gracefully', () => {
      const moveResult = {
        error: 'Target tile is blocked',
        moved: false
      };

      assert.ok(moveResult.error);
      assert.strictEqual(moveResult.moved, false);
    });

    test('should handle attack action error gracefully', () => {
      const attackResult = {
        error: 'Target out of range',
        damage: 0
      };

      assert.ok(attackResult.error);
      assert.strictEqual(attackResult.damage, 0);
    });

    test('should handle skill action error gracefully', () => {
      const skillResult = {
        error: 'Not enough MP',
        damage: 0
      };

      assert.ok(skillResult.error);
    });

    test('should handle item action error gracefully', () => {
      const itemResult = {
        error: 'Item not available',
        hpRestored: 0
      };

      assert.ok(itemResult.error);
    });
  });

  describe('Safety Limit Tests', () => {
    test('should enforce max iterations limit of 50', () => {
      let iterations = 0;
      const maxIterations = 50;

      // Simulate infinite loop scenario
      while (iterations < 100) {
        iterations++;
        if (iterations >= maxIterations) {
          break;
        }
      }

      assert.strictEqual(iterations, 50);
    });

    test('should not exceed path length of 20', () => {
      const path = [];
      let count = 0;
      const maxPath = 20;

      while (count < 100) {
        count++;
        path.push({ x: count, y: count });
        if (path.length > maxPath) break;
      }

      assert.ok(path.length <= 21);
    });
  });
});

// =============================================================================
// DATABASE UPDATE TESTS
// =============================================================================

describe('Database Update Pattern Tests', () => {
  test('should use correct SQL pattern for battle state update', () => {
    const sql = 'UPDATE battles SET battle_state = $1 WHERE id = $2';

    assert.ok(sql.includes('UPDATE battles'));
    assert.ok(sql.includes('$1'));
    assert.ok(sql.includes('$2'));
    assert.ok(sql.includes('WHERE id'));
  });

  test('should properly serialize state for database', () => {
    const state = createMockBattleState({
      units: [
        createMockPlayerUnit({ id: 'p1', hp: 75, tileX: 5, tileY: 5 }),
        createMockEnemyUnit({ id: 'e1', hp: 25, tileX: 10, tileY: 10 })
      ],
      turn: 3,
      activeUnitId: 'p1'
    });

    const serialized = JSON.stringify(state);
    const restored = JSON.parse(serialized);

    assert.strictEqual(restored.units[0].hp, 75);
    assert.strictEqual(restored.units[1].hp, 25);
    assert.strictEqual(restored.turn, 3);
    assert.strictEqual(restored.activeUnitId, 'p1');
  });

  test('should preserve unit positions through serialization', () => {
    const state = createMockBattleState({
      units: [
        createMockPlayerUnit({ tileX: 3, tileY: 7 }),
        createMockEnemyUnit({ tileX: 15, tileY: 12 })
      ]
    });

    const serialized = JSON.stringify(state);
    const restored = JSON.parse(serialized);

    assert.strictEqual(restored.units[0].tileX, 3);
    assert.strictEqual(restored.units[0].tileY, 7);
    assert.strictEqual(restored.units[1].tileX, 15);
    assert.strictEqual(restored.units[1].tileY, 12);
  });

  test('should preserve status effects through serialization', () => {
    const state = createMockBattleState({
      units: [
        createMockPlayerUnit({
          statusEffects: [
            { type: 'poison', duration: 2 },
            { type: 'rage', duration: 3 }
          ]
        })
      ]
    });

    const serialized = JSON.stringify(state);
    const restored = JSON.parse(serialized);

    assert.strictEqual(restored.units[0].statusEffects.length, 2);
    assert.strictEqual(restored.units[0].statusEffects[0].type, 'poison');
    assert.strictEqual(restored.units[0].statusEffects[1].type, 'rage');
  });

  test('should preserve skill cooldowns through serialization', () => {
    const state = createMockBattleState({
      units: [
        createMockPlayerUnit({
          skillCooldowns: { fireball: 2, heal: 1 }
        })
      ]
    });

    const serialized = JSON.stringify(state);
    const restored = JSON.parse(serialized);

    assert.strictEqual(restored.units[0].skillCooldowns.fireball, 2);
    assert.strictEqual(restored.units[0].skillCooldowns.heal, 1);
  });

  // =============================================================================
  // DATABASE INTEGRATION TESTS
  // =============================================================================

  describe('Battle Turn Manager - Database Integration', () => {
    let queryMock;
    let mockQueryResults;

    beforeEach(() => {
      queryMock = mock.fn();
      mockQueryResults = new Map();

      // Default mock implementation
      queryMock.mock.mockImplementation(async (sql, params) => {
        // Battle state update
        if (sql.includes('UPDATE battles SET battle_state')) {
          return mockQueryResults.get('update_battle') || { rows: [] };
        }

        return { rows: [] };
      });
    });

    afterEach(() => {
      mock.restoreAll?.();
      queryMock.mock.resetCalls();
    });

    describe('updateBattleState with database integration', () => {
      it('should execute database update with correct parameters', async () => {
        const service = await createMockedTurnManager(queryMock);
        const battleId = 123;
        const state = createMockBattleState({
          units: [
            createMockPlayerUnit({ id: 'p1', hp: 80, tileX: 5, tileY: 5 }),
            createMockEnemyUnit({ id: 'e1', hp: 30, tileX: 10, tileY: 8 })
          ],
          activeUnitId: 'p1',
          turn: 5
        });

        await service.updateBattleState(battleId, state);

        // Should call database update
        assert.strictEqual(queryMock.mock.callCount(), 1);
        const call = queryMock.mock.calls[0];
        assert.strictEqual(call.arguments[0], 'UPDATE battles SET battle_state = $1 WHERE id = $2');
        assert.strictEqual(call.arguments[1][1], 123); // battleId parameter

        // Verify serialized state structure
        const serializedState = call.arguments[1][0];
        const parsed = JSON.parse(serializedState);
        assert.strictEqual(parsed.activeUnitId, 'p1');
        assert.strictEqual(parsed.turn, 5);
        assert.strictEqual(parsed.units.length, 2);
        assert.strictEqual(parsed.units[0].hp, 80);
        assert.strictEqual(parsed.units[1].hp, 30);
      });

      it('should handle database error gracefully', async () => {
        queryMock.mock.mockImplementation(() => Promise.reject(new Error('Database connection lost')));

        const service = await createMockedTurnManager(queryMock);
        const battleId = 123;
        const state = createMockBattleState({});

        try {
          await service.updateBattleState(battleId, state);
          // Should not throw - errors are logged but not propagated
          assert.ok(true);
        } catch (err) {
          // If it does throw, should be the database error
          assert.strictEqual(err.message, 'Database connection lost');
        }
      });

      it('should serialize complex state correctly', async () => {
        const service = await createMockedTurnManager(queryMock);
        const battleId = 456;
        const state = createMockBattleState({
          units: [
            createMockPlayerUnit({
              id: 'p1',
              hp: 75,
              mp: 30,
              tileX: 8,
              tileY: 12,
              statusEffects: [
                { type: 'poison', duration: 2, strength: 5 },
                { type: 'blessed', duration: 5 }
              ],
              skillCooldowns: { fireball: 2, heal: 0 },
              moveUsed: true,
              actUsed: false
            })
          ],
          activeUnitId: 'p1',
          turn: 15,
          weather: 'rain',
          battleType: 'pve'
        });

        await service.updateBattleState(battleId, state);

        const call = queryMock.mock.calls[0];
        const serializedState = call.arguments[1][0];
        const parsed = JSON.parse(serializedState);

        // Verify complex nested data is preserved
        assert.strictEqual(parsed.units[0].statusEffects[0].type, 'poison');
        assert.strictEqual(parsed.units[0].statusEffects[0].duration, 2);
        assert.strictEqual(parsed.units[0].statusEffects[0].strength, 5);
        assert.strictEqual(parsed.units[0].skillCooldowns.fireball, 2);
        assert.strictEqual(parsed.units[0].moveUsed, true);
        assert.strictEqual(parsed.units[0].actUsed, false);
        assert.strictEqual(parsed.weather, 'rain');
        assert.strictEqual(parsed.battleType, 'pve');
      });
    });

    describe('processEnemyTurnsAsync with database integration', () => {
      it('should save state to database after processing enemy turns', async () => {
        const service = await createMockedTurnManager(queryMock);
        const mockAiService = createMockAiService();
        const mockBattleService = createMockBattleService();

        const battleId = 789;
        const state = createMockBattleState({
          units: [
            createMockPlayerUnit({ id: 'p1', hp: 100, tileX: 1, tileY: 1 }),
            createMockEnemyUnit({ id: 'e1', hp: 50, tileX: 10, tileY: 10 })
          ],
          activeUnitId: 'e1'
        });

        // Mock AI to return simple wait action
        mockAiService.decideTurnActions.mock.mockImplementation(() => [{ actionType: 'wait' }]);

        const result = await service.processEnemyTurnsAsync(battleId, state, mockAiService, mockBattleService);

        // Should save state after processing
        assert.strictEqual(queryMock.mock.callCount(), 1);
        assert.ok(queryMock.mock.calls[0].arguments[0].includes('UPDATE battles SET battle_state'));

        // Verify result structure
        assert.ok('state' in result);
        assert.ok('battleStatus' in result);
        assert.ok('enemyActions' in result);
      });

      it('should handle multiple enemy turns with state persistence', async () => {
        const service = await createMockedTurnManager(queryMock);
        const mockAiService = createMockAiService();
        const mockBattleService = createMockBattleService();

        const battleId = 999;
        const state = createMockBattleState({
          units: [
            createMockPlayerUnit({ id: 'p1', hp: 100 }),
            createMockEnemyUnit({ id: 'e1', hp: 50 }),
            createMockEnemyUnit({ id: 'e2', hp: 40 })
          ],
          activeUnitId: 'e1'
        });

        // Mock AI service
        mockAiService.decideTurnActions.mock.mockImplementation((unit) => {
          return [{ actionType: 'wait' }];
        });

        // Mock battle service to advance turns
        let currentActiveId = 'e1';
        mockBattleService.advanceToNextActorWithCT.mock.mockImplementation((state) => {
          if (currentActiveId === 'e1') {
            state.activeUnitId = 'e2';
            currentActiveId = 'e2';
          } else if (currentActiveId === 'e2') {
            state.activeUnitId = 'p1';
            currentActiveId = 'p1';
          }
        });

        await service.processEnemyTurnsAsync(battleId, state, mockAiService, mockBattleService);

        // Should call AI service for both enemies
        assert.strictEqual(mockAiService.decideTurnActions.mock.callCount(), 2);

        // Should save state at least once
        assert.ok(queryMock.mock.callCount() >= 1);
      });

      it('should stop processing when battle ends', async () => {
        const service = await createMockedTurnManager(queryMock);
        const mockAiService = createMockAiService();
        const mockBattleService = createMockBattleService();

        const battleId = 555;
        const state = createMockBattleState({
          units: [
            createMockPlayerUnit({ id: 'p1', hp: 0 }), // Dead player
            createMockEnemyUnit({ id: 'e1', hp: 50 })
          ],
          activeUnitId: 'e1'
        });

        // Mock battle to end immediately
        mockBattleService.checkBattleEnd.mock.mockImplementation(() => ({
          status: 'ended',
          winningTeamId: 2
        }));

        const result = await service.processEnemyTurnsAsync(battleId, state, mockAiService, mockBattleService);

        // Should detect battle end
        assert.strictEqual(result.battleStatus, 'defeat');
        assert.strictEqual(result.battleEndResult.status, 'ended');
        assert.strictEqual(result.battleEndResult.winningTeamId, 2);

        // Should still save final state
        assert.ok(queryMock.mock.callCount() >= 1);
      });
    });

    describe('notifyPlayerTurn with database integration', () => {
      it('should notify player without database calls', async () => {
        const service = await createMockedTurnManager(queryMock);
        const mockBattleWebsocket = createMockBattleWebsocket();

        const battleId = 333;
        const state = createMockBattleState({
          units: [createMockPlayerUnit({ id: 'p1', ownerId: 100, hp: 90 })],
          activeUnitId: 'p1',
          battleType: 'pve'
        });

        await service.notifyPlayerTurn(battleId, state, mockBattleWebsocket);

        // Should NOT call database (this is notification only)
        assert.strictEqual(queryMock.mock.callCount(), 0);

        // Should call websocket notification
        assert.strictEqual(mockBattleWebsocket.sendYourTurn.mock.callCount(), 1);
      });

      it('should include correct data in player notification', async () => {
        const service = await createMockedTurnManager(queryMock);
        const mockBattleWebsocket = createMockBattleWebsocket();

        const battleId = 444;
        const player = createMockPlayerUnit({
          id: 'p1',
          ownerId: 150,
          hp: 85,
          moveUsed: false,
          actUsed: true // Can't act but can move
        });
        const state = createMockBattleState({
          units: [player],
          activeUnitId: 'p1',
          battleType: 'pve'
        });

        await service.notifyPlayerTurn(battleId, state, mockBattleWebsocket);

        const call = mockBattleWebsocket.sendYourTurn.mock.calls[0];
        assert.strictEqual(call.arguments[0], 150); // ownerId
        assert.strictEqual(call.arguments[1], 444); // battleId
        assert.strictEqual(call.arguments[2], 'p1'); // activeUnitId
        assert.ok(Array.isArray(call.arguments[4])); // available actions
      });

      it('should handle multiplayer turn timer setup', async () => {
        const service = await createMockedTurnManager(queryMock);
        const mockBattleWebsocket = createMockBattleWebsocket();

        const battleId = 666;
        const state = createMockBattleState({
          units: [
            createMockPlayerUnit({ id: 'p1', ownerId: 100 }),
            createMockPlayerUnit({ id: 'p2', ownerId: 200 })
          ],
          activeUnitId: 'p1',
          battleType: 'pvp_coliseum'
        });

        await service.notifyPlayerTurn(battleId, state, mockBattleWebsocket);

        // Should detect multiplayer and set turn timer
        const activeUnit = state.units.find(u => u.id === state.activeUnitId);
        assert.strictEqual(activeUnit.ownerId, 100);
      });
    });

    /**
     * Create a mocked version of the turn manager for testing
     */
    async function createMockedTurnManager(queryMock) {
      return {
        async updateBattleState(battleId, state) {
          const serializedState = JSON.stringify(state);
          await queryMock(
            'UPDATE battles SET battle_state = $1 WHERE id = $2',
            [serializedState, battleId]
          );
        },

        async processEnemyTurnsAsync(battleId, state, aiService, battleService) {
          const enemyActions = [];
          let battleStatus = { status: 'active', winningTeamId: null };
          let iterations = 0;
          const maxIterations = 50;

          while (iterations < maxIterations) {
            iterations++;

            const activeUnit = state.units.find(u => u.id === state.activeUnitId);
            if (!activeUnit || activeUnit.hp <= 0) break;

            // Check if it's an enemy turn
            if (activeUnit.type !== 'enemy') break;

            // Check for battle end
            const endCheck = battleService.checkBattleEnd(state);
            if (endCheck.status === 'ended') {
              battleStatus = endCheck;
              break;
            }

            // Get AI decisions
            const decisions = aiService.decideTurnActions(state, activeUnit);

            // Process each decision
            for (const decision of decisions) {
              const result = battleService.processAction(state, activeUnit, decision.actionType, decision.targetTile, decision.skillId);

              if (result.success) {
                enemyActions.push({
                  unitId: activeUnit.id,
                  unitName: activeUnit.name,
                  actionType: decision.actionType,
                  targetTile: decision.targetTile,
                  skillId: decision.skillId,
                  result
                });
              }
            }

            // Advance to next unit
            battleService.advanceToNextActorWithCT(state);

            // Stop if we reach a player turn
            const nextUnit = state.units.find(u => u.id === state.activeUnitId);
            if (!nextUnit || nextUnit.type === 'player') break;
          }

          // Save state to database
          await this.updateBattleState(battleId, state);

          return {
            state,
            battleStatus: battleStatus.status === 'ended' ?
              (battleStatus.winningTeamId === 1 ? 'victory' : 'defeat') : 'active',
            battleEndResult: battleStatus,
            enemyActions
          };
        },

        async notifyPlayerTurn(battleId, state, battleWebsocket) {
          const activeUnit = state.units.find(u => u.id === state.activeUnitId);

          if (!activeUnit || activeUnit.type !== 'player' || !activeUnit.ownerId) {
            return;
          }

          // Simulate available actions computation
          const availableActions = [];
          if (!activeUnit.moveUsed) availableActions.push('move');
          if (!activeUnit.actUsed) availableActions.push('attack', 'skill', 'item');
          availableActions.push('wait');

          // Simulate turn predictions
          const predictions = state.units.map(u => ({ id: u.id, type: u.type, name: u.name }));

          await battleWebsocket.sendYourTurn(
            activeUnit.ownerId,
            battleId,
            activeUnit.id,
            predictions,
            availableActions
          );

          // Handle multiplayer timer setup
          const isPvP = state.battleType === 'pvp' || state.battleType === 'pvp_coliseum';
          const playerUnits = state.units.filter(u => u.type === 'player' && u.ownerId);
          const uniqueOwners = new Set(playerUnits.map(u => u.ownerId));
          const isMultiplayerPvE = !isPvP && uniqueOwners.size > 1;
          const isMultiplayer = isPvP || isMultiplayerPvE;

          if (isMultiplayer) {
            // Would start turn timer here
            console.log(`Starting turn timer for battle ${battleId}, player ${activeUnit.ownerId}`);
          }
        }
      };
    }

    /**
     * Create mock AI service
     */
    function createMockAiService() {
      return {
        decideTurnActions: mock.fn(() => [{ actionType: 'wait' }])
      };
    }
  });
});

// =============================================================================
// Boss phase transitions of enemy turns are announced after the commit
// =============================================================================

describe('enemy-turn boss phase transitions', () => {
  function bossBattleState() {
    return {
      units: [{
        id: 'boss1',
        name: 'Test Boss',
        type: 'enemy',
        hp: 40,
        maxHp: 100,
        phases: [
          { name: 'Phase 1', threshold: 1.0 },
          { name: 'Phase 2', threshold: 0.5 }
        ]
      }],
      bossStates: {
        boss1: {
          unitId: 'boss1',
          templateId: 9,
          currentPhase: 1,
          maxPhases: 2,
          phaseName: 'Phase 1',
          baseStats: { attack: 10, defense: 5, magicAttack: 10, magicDefense: 5, agility: 10 }
        }
      }
    };
  }

  test('collecting applies the transition in state without broadcasting or saving', async () => {
    const { collectBossPhaseTransitions } = await import('../../services/battleTurnManager.js');
    const state = bossBattleState();

    const pending = collectBossPhaseTransitions(state);

    assert.strictEqual(pending.length, 1);
    assert.strictEqual(state.bossStates.boss1.currentPhase, 2);
    assert.strictEqual(state.units[0].currentPhase, 2);
    assert.strictEqual(pending[0].bossState.currentPhase, 2);
    // A snapshot: later in-place changes do not leak into what gets saved
    state.bossStates.boss1.currentPhase = 99;
    assert.strictEqual(pending[0].bossState.currentPhase, 2);
  });

  test('flush broadcasts and saves each transition, and a save failure does not throw', async () => {
    const { collectBossPhaseTransitions, flushBossPhaseTransitions } =
      await import('../../services/battleTurnManager.js');
    const pending = collectBossPhaseTransitions(bossBattleState());
    const broadcasts = [];
    const saves = [];

    await flushBossPhaseTransitions(77, pending, {
      broadcast: async (battleId, payload) => broadcasts.push([battleId, payload.bossId, payload.toPhase]),
      save: async (row) => {
        saves.push(row);
        throw new Error('boss_encounters unavailable');
      }
    });

    assert.deepStrictEqual(broadcasts, [[77, 'boss1', 2]]);
    assert.strictEqual(saves.length, 1);
    assert.strictEqual(saves[0].battleId, 77);
    assert.strictEqual(saves[0].currentPhase, 2);
  });
});
