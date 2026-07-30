/**
 * Unit tests for turnOrderService.js
 * Tests CT-based turn system and initiative calculations
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  createMockPlayerUnit,
  createMockEnemyUnit,
  createMockBattleState,
  withSeededRandom
} from '../testUtils/index.js';
import {
  calculateInitiative,
  sortByInitiative,
  initializeCT,
  advanceCTUntilReady,
  getNextActor,
  consumeCT,
  predictTurnOrder,
  advanceToNextActor,
  advanceToNextActorWithCT,
  CT_THRESHOLD
} from '../../services/battle/turnOrderService.js';
import { createBattleMutableStateV1 } from '../../../../shared/battleStateProtocol.js';

// =============================================================================
// CONSTANTS
// =============================================================================

describe('CT_THRESHOLD', () => {
  test('should be 100', () => {
    assert.strictEqual(CT_THRESHOLD, 100, 'CT threshold should be 100');
  });
});

// =============================================================================
// INITIATIVE TESTS
// =============================================================================

describe('calculateInitiative', () => {
  test('should calculate initiative based on agility', () => {
    const lowAgi = withSeededRandom(12345, () => {
      const unit = createMockPlayerUnit({ agility: 10 });
      return calculateInitiative(unit);
    });

    const highAgi = withSeededRandom(12345, () => {
      const unit = createMockPlayerUnit({ agility: 50 });
      return calculateInitiative(unit);
    });

    assert.ok(highAgi > lowAgi, 'Higher agility should give higher initiative');
  });

  test('should add random variance', () => {
    const results = [];
    const unit = createMockPlayerUnit({ agility: 20 });

    for (let seed = 0; seed < 50; seed++) {
      const result = withSeededRandom(seed, () => {
        return calculateInitiative(unit);
      });
      results.push(result);
    }

    const minInit = Math.min(...results);
    const maxInit = Math.max(...results);

    assert.ok(maxInit > minInit, 'Initiative should have random variance');
  });

  test('should return positive integer', () => {
    const result = withSeededRandom(12345, () => {
      const unit = createMockPlayerUnit({ agility: 15 });
      return calculateInitiative(unit);
    });

    assert.ok(Number.isInteger(result), 'Initiative should be an integer');
    assert.ok(result > 0, 'Initiative should be positive');
  });
});

describe('sortByInitiative', () => {
  test('should sort units by initiative descending', () => {
    const sorted = withSeededRandom(12345, () => {
      const units = [
        createMockPlayerUnit({ id: 'p1', agility: 5 }),
        createMockEnemyUnit({ id: 'e1', agility: 30 }),
        createMockPlayerUnit({ id: 'p2', agility: 15 })
      ];
      return sortByInitiative(units);
    });

    for (let i = 0; i < sorted.length - 1; i++) {
      assert.ok(sorted[i].initiative >= sorted[i + 1].initiative,
        'Units should be sorted by initiative descending');
    }
  });

  test('should not modify original array', () => {
    const original = [
      createMockPlayerUnit({ id: 'p1', agility: 5 }),
      createMockEnemyUnit({ id: 'e1', agility: 30 })
    ];
    const originalOrder = original.map(u => u.id);

    withSeededRandom(12345, () => {
      sortByInitiative(original);
    });

    assert.deepStrictEqual(original.map(u => u.id), originalOrder,
      'Original array should not be modified');
  });

  test('should add initiative property to returned units', () => {
    const sorted = withSeededRandom(12345, () => {
      const units = [createMockPlayerUnit({ id: 'p1', agility: 10 })];
      return sortByInitiative(units);
    });

    assert.ok(typeof sorted[0].initiative === 'number', 'Should add initiative property');
  });

  test('should handle empty array', () => {
    const sorted = sortByInitiative([]);
    assert.strictEqual(sorted.length, 0);
  });

  test('should handle single unit', () => {
    const sorted = withSeededRandom(12345, () => {
      const units = [createMockPlayerUnit({ id: 'p1', agility: 10 })];
      return sortByInitiative(units);
    });

    assert.strictEqual(sorted.length, 1);
    assert.ok(sorted[0].initiative !== undefined);
  });
});

// =============================================================================
// CT SYSTEM TESTS
// =============================================================================

describe('initializeCT', () => {
  test('should set initial CT based on agility', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 0 }),
      createMockEnemyUnit({ id: 'e1', agility: 20, ct: 0 })
    ];

    withSeededRandom(12345, () => {
      initializeCT(units);
    });

    units.forEach(u => {
      assert.ok(typeof u.ct === 'number', 'CT should be set');
      assert.ok(!isNaN(u.ct), 'CT should not be NaN');
    });
  });

  test('should give faster units higher initial CT on average', () => {
    let fastTotal = 0;
    let slowTotal = 0;
    const trials = 50;

    for (let seed = 0; seed < trials; seed++) {
      withSeededRandom(seed, () => {
        const slowUnit = createMockPlayerUnit({ id: 'p1', agility: 10, ct: 0 });
        const fastUnit = createMockEnemyUnit({ id: 'e1', agility: 40, ct: 0 });
        initializeCT([slowUnit, fastUnit]);
        slowTotal += slowUnit.ct;
        fastTotal += fastUnit.ct;
      });
    }

    assert.ok(fastTotal > slowTotal,
      `Fast units (${fastTotal}) should have more total CT than slow units (${slowTotal})`);
  });

  test('should handle empty units array', () => {
    // Should not throw
    initializeCT([]);
  });
});

describe('advanceCTUntilReady', () => {
  test('should increment CT until at least one unit reaches threshold', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 0, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 20, ct: 0, hp: 50 })
    ];
    const state = { units };

    const ticks = advanceCTUntilReady(state);

    const readyUnit = units.find(u => u.ct >= CT_THRESHOLD);
    assert.ok(readyUnit, 'At least one unit should be ready after advancing CT');
    assert.ok(ticks > 0, 'Should have taken some ticks');
  });

  test('should not advance if a unit is already ready', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 150, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 20, ct: 0, hp: 50 })
    ];
    const state = { units };

    const ticks = advanceCTUntilReady(state);

    assert.strictEqual(ticks, 0, 'Should not advance when unit already ready');
  });

  test('should return 0 for empty units array', () => {
    const state = { units: [] };

    const ticks = advanceCTUntilReady(state);

    assert.strictEqual(ticks, 0);
  });

  test('should only advance alive units', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 0, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 20, ct: 0, hp: 0 }) // Dead
    ];
    const state = { units };
    const initialDeadCT = units[1].ct;

    advanceCTUntilReady(state);

    assert.strictEqual(units[1].ct, initialDeadCT, 'Dead unit CT should not change');
  });

  test('should have safety limit for max ticks', () => {
    // This tests the safety limit indirectly - if all units have 0 agility,
    // they would need infinite ticks, but the loop should terminate
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 0, ct: 0, hp: 100 })
    ];
    const state = { units };

    // Should complete without hanging
    const ticks = advanceCTUntilReady(state);

    assert.ok(ticks <= 1000, 'Should respect safety limit');
  });
});

describe('getNextActor', () => {
  test('should return unit with highest CT >= 100', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 50, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 20, ct: 150, hp: 50 })
    ];
    const state = { units };

    const next = getNextActor(state);

    assert.strictEqual(next.id, 'e1', 'Should return unit with highest CT');
  });

  test('should return null if no unit has CT >= 100', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 50, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 20, ct: 80, hp: 50 })
    ];
    const state = { units };

    const next = getNextActor(state);

    assert.strictEqual(next, null, 'Should return null if no unit ready');
  });

  test('should use agility as tie-breaker', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 100, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 20, ct: 100, hp: 50 })
    ];
    const state = { units };

    const next = getNextActor(state);

    assert.strictEqual(next.id, 'e1', 'Higher agility should win tie');
  });

  test('should prefer players over enemies as final tie-breaker', () => {
    const units = [
      createMockEnemyUnit({ id: 'e1', agility: 15, ct: 100, hp: 50 }),
      createMockPlayerUnit({ id: 'p1', agility: 15, ct: 100, hp: 100 })
    ];
    const state = { units };

    const next = getNextActor(state);

    assert.strictEqual(next.id, 'p1', 'Player should have priority in ties');
  });

  test('should ignore dead units', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 200, hp: 0 }), // Dead
      createMockEnemyUnit({ id: 'e1', agility: 20, ct: 100, hp: 50 })
    ];
    const state = { units };

    const next = getNextActor(state);

    assert.strictEqual(next.id, 'e1', 'Should skip dead units');
  });

  test('should return null for empty units array', () => {
    const state = { units: [] };

    const next = getNextActor(state);

    assert.strictEqual(next, null);
  });
});

describe('consumeCT', () => {
  test('should subtract CT_THRESHOLD from unit CT', () => {
    const unit = createMockPlayerUnit({ ct: 150 });

    consumeCT(unit);

    assert.strictEqual(unit.ct, 50, 'CT should be reduced by 100');
  });

  test('should not let CT go negative', () => {
    const unit = createMockPlayerUnit({ ct: 80 });

    consumeCT(unit);

    assert.strictEqual(unit.ct, 0, 'CT should not go below 0');
  });

  test('should set CT to 0 when exactly at threshold', () => {
    const unit = createMockPlayerUnit({ ct: 100 });

    consumeCT(unit);

    assert.strictEqual(unit.ct, 0);
  });

  test('should handle very high CT values', () => {
    const unit = createMockPlayerUnit({ ct: 500 });

    consumeCT(unit);

    assert.strictEqual(unit.ct, 400);
  });
});

describe('authoritative turn-start status processing', () => {
  test('processes all periodic statuses when production selects an actor', () => {
    const actor = createMockPlayerUnit({
      id: 'actor',
      hp: 1000,
      maxHp: 1000,
      ct: 100,
      traits: [],
      statusEffects: [
        { type: 'poison', duration: 2 },
        { type: 'burn', duration: 2 },
        { type: 'regen', duration: 2 },
        { type: 'zodiac_poison', duration: 2, damagePercent: 0.03 }
      ]
    });
    const opponent = createMockEnemyUnit({
      id: 'opponent',
      hp: 100,
      ct: 0
    });
    const state = { units: [actor, opponent] };

    const selected = advanceToNextActor(state);

    assert.strictEqual(selected, actor);
    assert.strictEqual(actor.hp, 940);
    assert.deepStrictEqual(
      actor.turnStartEffects.map(effect => effect.type),
      ['poison_damage', 'burn_damage', 'regen_heal', 'zodiac_poison']
    );
  });

  test('skips an actor defeated by turn-start damage', () => {
    const doomed = createMockPlayerUnit({
      id: 'doomed',
      hp: 1,
      maxHp: 100,
      ct: 200,
      agility: 50,
      traits: [],
      damageTaken: 0,
      deaths: 0,
      statusEffects: [{ type: 'poison', duration: 1 }]
    });
    const survivor = createMockEnemyUnit({
      id: 'survivor',
      hp: 100,
      ct: 100,
      agility: 10,
      statusEffects: []
    });
    const teammate = createMockPlayerUnit({
      id: 'teammate',
      hp: 100,
      ct: 0,
      statusEffects: []
    });
    const state = { units: [doomed, survivor, teammate] };

    const selected = advanceToNextActor(state);

    assert.strictEqual(selected, survivor);
    assert.strictEqual(state.activeUnitId, survivor.id);
    assert.strictEqual(doomed.hp, 0);
    assert.strictEqual(doomed.damageTaken, 1);
    assert.strictEqual(doomed.deaths, 1);
    assert.strictEqual(doomed.statusEffects.length, 0);
  });

  test('does not select an opponent after DoT defeats the last team member', () => {
    const doomed = createMockPlayerUnit({
      id: 'doomed',
      hp: 1,
      maxHp: 100,
      ct: 200,
      agility: 50,
      traits: [],
      statusEffects: [{ type: 'poison', duration: 1 }]
    });
    const opponent = createMockEnemyUnit({
      id: 'opponent',
      hp: 100,
      ct: 100,
      statusEffects: []
    });
    const state = { units: [doomed, opponent] };

    const selected = advanceToNextActor(state);

    assert.strictEqual(selected, null);
    assert.strictEqual(state.activeUnitId, null);
    assert.strictEqual(state.activeUnitIndex, -1);
    assert.strictEqual(opponent.turnStartEffects, undefined);
  });

  test('finalizes a duration-1 restriction only after the full actor turn', () => {
    const stunned = createMockPlayerUnit({
      id: 'stunned',
      hp: 100,
      ct: 200,
      agility: 1,
      statusEffects: [{ type: 'stun', duration: 1 }]
    });
    const opponent = createMockEnemyUnit({
      id: 'opponent',
      hp: 100,
      ct: 100,
      agility: 50,
      statusEffects: []
    });
    const state = { units: [stunned, opponent] };

    assert.strictEqual(advanceToNextActor(state), stunned);
    assert.strictEqual(stunned.statusEffects[0].type, 'stun');
    assert.strictEqual(stunned.statusEffects[0].expiresAfterTurn, true);

    advanceToNextActorWithCT(state);

    assert.strictEqual(stunned.statusEffects.length, 0);
    assert.deepStrictEqual(stunned.turnEndEffects, [{
      type: 'effect_expired',
      effect: 'stun'
    }]);
    assert.strictEqual(state.activeUnitId, opponent.id);
  });
});

describe('predictTurnOrder', () => {
  test('should predict specified number of turns', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 90, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 15, ct: 80, hp: 50 })
    ];
    const state = { units };

    const predictions = predictTurnOrder(state, 5);

    assert.strictEqual(predictions.length, 5, 'Should predict 5 turns');
  });

  test('should include id, name, type, and class in predictions', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', name: 'Hero', class: 'warrior', agility: 10, ct: 90, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 15, ct: 80, hp: 50 })
    ];
    const state = { units };

    const predictions = predictTurnOrder(state, 1);

    assert.ok(predictions[0].id, 'Should have id');
    assert.ok(predictions[0].name, 'Should have name');
    assert.ok(predictions[0].type, 'Should have type');
  });

  test('should preserve canonical NPC identity in prediction DTOs across zones', () => {
    const unit = createMockEnemyUnit({
      id: 'e1',
      enemyId: 'dark_knight',
      biome: 'castle',
      agility: 20,
      ct: 100,
      hp: 50
    });

    const [prediction] = predictTurnOrder({ units: [unit] }, 1);

    assert.deepStrictEqual(prediction.visualIdentity, {
      kind: 'npc',
      id: 'e1',
      visualId: 'dark_knight',
      primaryBiome: 'palace'
    });
    assert.strictEqual(prediction.enemyId, 'dark_knight');
    assert.strictEqual(prediction.spriteId, 'dark_knight');
    assert.strictEqual(prediction.primaryBiome, 'palace');
  });

  test('should produce canonical JSON-safe prediction DTOs for mutable battle state', () => {
    const units = [
      createMockPlayerUnit({
        id: 'p1',
        agility: 20,
        ct: 100,
        hp: 100,
        enemyId: undefined,
        spriteId: undefined
      }),
      createMockEnemyUnit({
        id: 'e1',
        agility: 10,
        ct: 100,
        hp: 50,
        race: undefined,
        gender: undefined
      })
    ];

    const predictions = predictTurnOrder({ units }, 2);

    assert.deepStrictEqual(predictions, JSON.parse(JSON.stringify(predictions)));
    assert.doesNotThrow(() => createBattleMutableStateV1({
      units: [],
      turnPredictions: predictions
    }));
  });

  test('should not modify actual unit CT values', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 90, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 15, ct: 80, hp: 50 })
    ];
    const originalCTs = units.map(u => u.ct);
    const state = { units };

    predictTurnOrder(state, 10);

    units.forEach((u, i) => {
      assert.strictEqual(u.ct, originalCTs[i], 'Original CT should not be modified');
    });
  });

  test('should return empty array for empty units', () => {
    const state = { units: [] };

    const predictions = predictTurnOrder(state, 5);

    assert.strictEqual(predictions.length, 0);
  });

  test('should only include alive units in predictions', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 90, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 15, ct: 80, hp: 0 }) // Dead
    ];
    const state = { units };

    const predictions = predictTurnOrder(state, 5);

    // All predictions should be from the alive unit
    predictions.forEach(p => {
      assert.strictEqual(p.id, 'p1', 'Only alive unit should appear in predictions');
    });
  });

  test('should handle single unit', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 0, hp: 100 })
    ];
    const state = { units };

    const predictions = predictTurnOrder(state, 3);

    assert.strictEqual(predictions.length, 3);
    predictions.forEach(p => {
      assert.strictEqual(p.id, 'p1');
    });
  });

  test('should use default count of 10 when not specified', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 90, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 15, ct: 80, hp: 50 })
    ];
    const state = { units };

    const predictions = predictTurnOrder(state);

    assert.strictEqual(predictions.length, 10);
  });

  test('should reflect faster units getting more turns', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 0, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 30, ct: 0, hp: 50 }) // Much faster
    ];
    const state = { units };

    const predictions = predictTurnOrder(state, 20);

    const playerTurns = predictions.filter(p => p.id === 'p1').length;
    const enemyTurns = predictions.filter(p => p.id === 'e1').length;

    assert.ok(enemyTurns > playerTurns,
      `Faster unit (${enemyTurns} turns) should get more turns than slower (${playerTurns})`);
  });

  test('should handle zero agility units', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 0, ct: 90, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 0, ct: 80, hp: 50 })
    ];
    const state = { units };

    // Should complete without hanging
    const predictions = predictTurnOrder(state, 5);

    // All units get base CT gain of 5, so predictions should still work
    assert.ok(predictions.length <= 5);
  });

  test('should handle units with very high CT', () => {
    const units = [
      createMockPlayerUnit({ id: 'p1', agility: 10, ct: 500, hp: 100 }),
      createMockEnemyUnit({ id: 'e1', agility: 15, ct: 300, hp: 50 })
    ];
    const state = { units };

    const predictions = predictTurnOrder(state, 3);

    // First turns should go to units already over threshold
    assert.strictEqual(predictions[0].id, 'p1', 'Highest CT should go first');
    assert.strictEqual(predictions.length, 3);
  });
});
