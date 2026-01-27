/**
 * Cache Unit Tests
 *
 * Tests TranspositionTable, KillerMoves, HistoryHeuristic,
 * PerformanceTracker, cloneState, applyActionToState, estimateActionDamage.
 * No mocking needed - pure data structures.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  TranspositionTable,
  KillerMoves,
  HistoryHeuristic,
  PerformanceTracker,
  cloneState,
  applyActionToState,
  estimateActionDamage
} from '../../../services/ai/cache.js';
import { createMockUnit, createMockBattleState } from './mockHelpers.js';

describe('TranspositionTable', () => {
  let tt;

  beforeEach(() => {
    tt = new TranspositionTable(100);
  });

  describe('constructor', () => {
    it('initializes with default max size', () => {
      const defaultTt = new TranspositionTable();
      assert.strictEqual(defaultTt.maxSize, 10000);
    });

    it('initializes with custom max size', () => {
      assert.strictEqual(tt.maxSize, 100);
    });

    it('starts with zero hits and misses', () => {
      assert.strictEqual(tt.hits, 0);
      assert.strictEqual(tt.misses, 0);
    });
  });

  describe('hashState()', () => {
    it('produces deterministic hash for same state', () => {
      const state = createMockBattleState(
        [{ tileX: 3, tileY: 5 }],
        [{ tileX: 10, tileY: 5 }]
      );
      const h1 = tt.hashState(state, 2, 'enemy');
      const h2 = tt.hashState(state, 2, 'enemy');
      assert.strictEqual(h1, h2);
    });

    it('produces different hash for different depths', () => {
      const state = createMockBattleState([{}], [{}]);
      const h1 = tt.hashState(state, 1, 'enemy');
      const h2 = tt.hashState(state, 2, 'enemy');
      assert.notStrictEqual(h1, h2);
    });

    it('produces different hash for different perspectives', () => {
      const state = createMockBattleState([{}], [{}]);
      const h1 = tt.hashState(state, 1, 'player');
      const h2 = tt.hashState(state, 1, 'enemy');
      assert.notStrictEqual(h1, h2);
    });

    it('excludes dead units from hash', () => {
      const state = createMockBattleState(
        [{ hp: 100 }],
        [{ hp: 0 }]
      );
      const h1 = tt.hashState(state, 1, 'enemy');
      // Dead enemy not included
      assert.ok(!h1.includes('enemy_1'));
    });
  });

  describe('store() and lookup()', () => {
    it('stores and retrieves an entry', () => {
      tt.store('key1', { score: 42, depth: 2, bestAction: { type: 'attack' } });
      const result = tt.lookup('key1');
      assert.ok(result);
      assert.strictEqual(result.score, 42);
      assert.strictEqual(result.depth, 2);
    });

    it('returns null for missing key', () => {
      const result = tt.lookup('missing');
      assert.strictEqual(result, null);
    });

    it('increments misses on miss', () => {
      tt.lookup('missing');
      assert.strictEqual(tt.misses, 1);
    });

    it('increments hits on hit', () => {
      tt.store('key1', { score: 10, depth: 1 });
      tt.lookup('key1');
      assert.strictEqual(tt.hits, 1);
    });

    it('respects minDepth parameter', () => {
      tt.store('key1', { score: 10, depth: 1 });
      const shallow = tt.lookup('key1', 1);
      assert.ok(shallow);
      const tooDeep = tt.lookup('key1', 3);
      assert.strictEqual(tooDeep, null);
    });

    it('evicts oldest entry when at capacity', () => {
      const smallTt = new TranspositionTable(3);
      smallTt.store('a', { score: 1, depth: 1 });
      smallTt.store('b', { score: 2, depth: 1 });
      smallTt.store('c', { score: 3, depth: 1 });
      // At capacity, adding new should evict 'a'
      smallTt.store('d', { score: 4, depth: 1 });
      assert.strictEqual(smallTt.lookup('a'), null);
      assert.ok(smallTt.lookup('d'));
    });
  });

  describe('clear()', () => {
    it('clears all entries and resets counters', () => {
      tt.store('key1', { score: 10, depth: 1 });
      tt.lookup('key1');
      tt.clear();
      assert.strictEqual(tt.table.size, 0);
      assert.strictEqual(tt.hits, 0);
      assert.strictEqual(tt.misses, 0);
    });
  });

  describe('getStats()', () => {
    it('returns correct statistics', () => {
      tt.store('k1', { score: 10, depth: 1 });
      tt.store('k2', { score: 20, depth: 1 });
      tt.lookup('k1'); // hit
      tt.lookup('missing'); // miss
      const stats = tt.getStats();
      assert.strictEqual(stats.size, 2);
      assert.strictEqual(stats.maxSize, 100);
      assert.strictEqual(stats.hits, 1);
      assert.strictEqual(stats.misses, 1);
      assert.strictEqual(stats.hitRate, '50.0%');
    });

    it('returns N/A hit rate when no lookups', () => {
      const stats = tt.getStats();
      assert.strictEqual(stats.hitRate, 'N/A');
    });
  });
});

describe('KillerMoves', () => {
  let km;

  beforeEach(() => {
    km = new KillerMoves(5);
  });

  describe('constructor', () => {
    it('initializes with correct depth slots', () => {
      assert.strictEqual(km.killers.length, 5);
    });

    it('all slots start as [null, null]', () => {
      for (const slot of km.killers) {
        assert.deepStrictEqual(slot, [null, null]);
      }
    });
  });

  describe('store()', () => {
    it('stores a killer move at the given depth', () => {
      const action = { type: 'attack', targetId: 'e1' };
      km.store(0, action);
      const killers = km.get(0);
      assert.strictEqual(killers.length, 1);
      assert.strictEqual(killers[0].type, 'attack');
    });

    it('shifts existing killer to second slot', () => {
      const a1 = { type: 'attack', targetId: 'e1' };
      const a2 = { type: 'skill', targetId: 'e2', skillId: 's1' };
      km.store(0, a1);
      km.store(0, a2);
      const killers = km.get(0);
      assert.strictEqual(killers.length, 2);
      assert.strictEqual(killers[0].type, 'skill');
      assert.strictEqual(killers[1].type, 'attack');
    });

    it('does not store duplicate', () => {
      const action = { type: 'attack', targetId: 'e1' };
      km.store(0, action);
      km.store(0, { type: 'attack', targetId: 'e1' });
      const killers = km.get(0);
      assert.strictEqual(killers.length, 1);
    });

    it('ignores out-of-range depth', () => {
      km.store(100, { type: 'attack', targetId: 'e1' });
      // Should not throw
    });
  });

  describe('get()', () => {
    it('returns empty array for empty depth', () => {
      const killers = km.get(0);
      assert.strictEqual(killers.length, 0);
    });

    it('returns empty array for out-of-range depth', () => {
      const killers = km.get(100);
      assert.strictEqual(killers.length, 0);
    });
  });

  describe('actionsEqual()', () => {
    it('matches identical actions', () => {
      const a = { type: 'attack', targetId: 'e1', skillId: null, position: { x: 5, y: 5 } };
      const b = { type: 'attack', targetId: 'e1', skillId: null, position: { x: 5, y: 5 } };
      assert.strictEqual(km.actionsEqual(a, b), true);
    });

    it('rejects different types', () => {
      const a = { type: 'attack', targetId: 'e1' };
      const b = { type: 'skill', targetId: 'e1' };
      assert.strictEqual(km.actionsEqual(a, b), false);
    });

    it('handles null inputs', () => {
      assert.strictEqual(km.actionsEqual(null, { type: 'attack' }), false);
      assert.strictEqual(km.actionsEqual({ type: 'attack' }, null), false);
    });
  });

  describe('clear()', () => {
    it('resets all slots', () => {
      km.store(0, { type: 'attack', targetId: 'e1' });
      km.clear();
      assert.strictEqual(km.get(0).length, 0);
    });
  });
});

describe('HistoryHeuristic', () => {
  let hh;

  beforeEach(() => {
    hh = new HistoryHeuristic();
  });

  describe('getScore()', () => {
    it('returns 0 for unknown action', () => {
      assert.strictEqual(hh.getScore({ type: 'attack', targetId: 'e1' }), 0);
    });
  });

  describe('update()', () => {
    it('adds depth^2 to action score', () => {
      const action = { type: 'attack', targetId: 'e1' };
      hh.update(action, 3);
      assert.strictEqual(hh.getScore(action), 9); // 3^2
    });

    it('accumulates scores', () => {
      const action = { type: 'attack', targetId: 'e1' };
      hh.update(action, 2); // +4
      hh.update(action, 3); // +9
      assert.strictEqual(hh.getScore(action), 13);
    });
  });

  describe('age()', () => {
    it('decays scores by 10%', () => {
      const action = { type: 'attack', targetId: 'e1' };
      hh.update(action, 10); // 100
      hh.age();
      assert.strictEqual(hh.getScore(action), 90); // floor(100 * 0.9)
    });

    it('removes entries that decay to 0', () => {
      const action = { type: 'attack', targetId: 'e1' };
      hh.update(action, 1); // 1
      hh.age(); // floor(1 * 0.9) = 0 -> deleted
      assert.strictEqual(hh.getScore(action), 0);
    });
  });

  describe('clear()', () => {
    it('resets all history', () => {
      hh.update({ type: 'attack', targetId: 'e1' }, 5);
      hh.clear();
      assert.strictEqual(hh.getScore({ type: 'attack', targetId: 'e1' }), 0);
    });
  });
});

describe('PerformanceTracker', () => {
  let pt;

  beforeEach(() => {
    pt = new PerformanceTracker();
  });

  describe('decision tracking', () => {
    it('tracks a complete decision lifecycle', () => {
      pt.startDecision('unit1');
      pt.nodeEvaluated(1);
      pt.nodeEvaluated(2);
      pt.branchPruned();
      pt.cacheHit();
      const result = pt.endDecision({ action: 'attack' });
      assert.ok(result);
      assert.strictEqual(result.unitId, 'unit1');
      assert.strictEqual(result.nodesEvaluated, 2);
      assert.strictEqual(result.maxDepthReached, 2);
      assert.strictEqual(result.prunedBranches, 1);
      assert.strictEqual(result.cacheHits, 1);
      assert.ok(result.duration >= 0);
    });

    it('handles no current decision gracefully', () => {
      pt.nodeEvaluated(1); // no-op
      pt.branchPruned(); // no-op
      pt.cacheHit(); // no-op
      const result = pt.endDecision({}); // returns null
      assert.strictEqual(result, null);
    });

    it('limits stored decisions to 100', () => {
      for (let i = 0; i < 110; i++) {
        pt.startDecision(`unit_${i}`);
        pt.endDecision({ action: 'wait' });
      }
      assert.strictEqual(pt.decisions.length, 100);
    });
  });

  describe('getAverageStats()', () => {
    it('returns null when no decisions', () => {
      assert.strictEqual(pt.getAverageStats(), null);
    });

    it('computes averages correctly', () => {
      pt.startDecision('u1');
      pt.nodeEvaluated(1);
      pt.nodeEvaluated(2);
      pt.endDecision({});
      pt.startDecision('u2');
      pt.nodeEvaluated(1);
      pt.endDecision({});
      const stats = pt.getAverageStats();
      assert.strictEqual(stats.count, 2);
      // 2 nodes + 1 node = 3, avg = 1.5 -> rounds to 2
      assert.ok(stats.avgNodesEvaluated >= 1);
      assert.strictEqual(stats.maxDepthReached, 2);
    });
  });
});

describe('cloneState()', () => {
  it('creates a deep enough clone of battle state', () => {
    const state = createMockBattleState(
      [{ hp: 100, statusEffects: [{ type: 'poison' }] }],
      [{ hp: 150 }]
    );
    const clone = cloneState(state);

    // Modify clone should not affect original
    clone.units[0].hp = 50;
    assert.strictEqual(state.units[0].hp, 100);
  });

  it('clones statusEffects array independently', () => {
    const state = createMockBattleState(
      [{ statusEffects: [{ type: 'poison' }] }],
      [{}]
    );
    const clone = cloneState(state);
    clone.units[0].statusEffects.push({ type: 'blind' });
    assert.strictEqual(state.units[0].statusEffects.length, 1);
  });

  it('shares terrain reference (immutable)', () => {
    const state = createMockBattleState([{}], [{}]);
    const clone = cloneState(state);
    assert.strictEqual(clone.terrain, state.terrain);
  });
});

describe('applyActionToState()', () => {
  it('applies move action', () => {
    const state = createMockBattleState([{}], [{}]);
    const unit = state.units[0];
    applyActionToState(state, unit, { type: 'move', position: { x: 8, y: 9 } });
    assert.strictEqual(unit.tileX, 8);
    assert.strictEqual(unit.tileY, 9);
    assert.strictEqual(unit.moveUsed, true);
  });

  it('applies attack action (reduces target HP)', () => {
    const state = createMockBattleState(
      [{ strength: 50, attack: 20 }],
      [{ hp: 200, maxHp: 200, vitality: 10, defense: 5 }]
    );
    const attacker = state.units[0];
    const target = state.units[1];
    applyActionToState(state, attacker, {
      type: 'attack',
      targetId: target.id
    });
    assert.ok(target.hp < 200, `Target HP should decrease, got ${target.hp}`);
    assert.strictEqual(attacker.actUsed, true);
  });

  it('applies skill action and deducts MP', () => {
    const state = createMockBattleState(
      [{ strength: 50, attack: 20, mp: 50 }],
      [{ hp: 200, vitality: 10, defense: 5 }]
    );
    const attacker = state.units[0];
    const target = state.units[1];
    applyActionToState(state, attacker, {
      type: 'skill',
      targetId: target.id,
      skill: { power: 150, mpCost: 15 }
    });
    assert.ok(target.hp < 200);
    assert.strictEqual(attacker.mp, 35);
    assert.strictEqual(attacker.actUsed, true);
  });

  it('applies wait action', () => {
    const state = createMockBattleState([{}], [{}]);
    const unit = state.units[0];
    applyActionToState(state, unit, { type: 'wait' });
    assert.strictEqual(unit.moveUsed, true);
    assert.strictEqual(unit.actUsed, true);
  });

  it('handles missing unit gracefully', () => {
    const state = createMockBattleState([{}], [{}]);
    const fakeUnit = { id: 'nonexistent' };
    const result = applyActionToState(state, fakeUnit, { type: 'wait' });
    assert.strictEqual(result, state); // returns state unchanged
  });

  it('does not reduce HP below 0', () => {
    const state = createMockBattleState(
      [{ strength: 999, attack: 999 }],
      [{ hp: 1, maxHp: 200, vitality: 1, defense: 0 }]
    );
    const attacker = state.units[0];
    const target = state.units[1];
    applyActionToState(state, attacker, {
      type: 'attack',
      targetId: target.id
    });
    assert.strictEqual(target.hp, 0);
  });
});

describe('estimateActionDamage()', () => {
  it('calculates basic damage', () => {
    const attacker = createMockUnit({ strength: 30, attack: 15 });
    const target = createMockUnit({ vitality: 20, defense: 10 });
    const damage = estimateActionDamage(attacker, target, {});
    // (30 + 15) * (100/100) - (20 + 10) * 0.15 = 45 - 4.5 = 40.5 -> floor = 40
    assert.strictEqual(damage, 40);
  });

  it('returns minimum of 1 damage', () => {
    const attacker = createMockUnit({ strength: 1, attack: 0 });
    const target = createMockUnit({ vitality: 100, defense: 100 });
    const damage = estimateActionDamage(attacker, target, {});
    assert.strictEqual(damage, 1);
  });

  it('scales with skill power', () => {
    const attacker = createMockUnit({ strength: 40, attack: 10 });
    const target = createMockUnit({ vitality: 10, defense: 5 });
    const d100 = estimateActionDamage(attacker, target, { skill: { power: 100 } });
    const d200 = estimateActionDamage(attacker, target, { skill: { power: 200 } });
    assert.ok(d200 > d100, `200 power (${d200}) should deal more than 100 power (${d100})`);
  });

  it('uses default power of 100 when no skill', () => {
    const attacker = createMockUnit({ strength: 30, attack: 15 });
    const target = createMockUnit({ vitality: 20, defense: 10 });
    const d1 = estimateActionDamage(attacker, target, {});
    const d2 = estimateActionDamage(attacker, target, { skill: { power: 100 } });
    assert.strictEqual(d1, d2);
  });
});
