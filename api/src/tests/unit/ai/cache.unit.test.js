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

    it('includes defeated units because revive actions depend on them', () => {
      const state = createMockBattleState(
        [{ hp: 100 }],
        [{ hp: 0 }]
      );
      const h1 = tt.hashState(state, 1, 'enemy');
      assert.ok(h1.includes('enemy_1'));
    });

    it('distinguishes actor, action rights, statuses, cooldowns, and inventories', () => {
      const state = createMockBattleState(
        [{ statusEffects: [], skillCooldowns: {}, consumables: [] }],
        [{}],
        { consumables: [] }
      );
      const baseline = tt.hashState(state, 2, 'player', state.units[0].id);

      assert.notStrictEqual(
        baseline,
        tt.hashState(state, 2, 'player', state.units[1].id),
        'the current actor changes the legal action space'
      );

      const variants = [
        draft => { draft.units[0].teamId = 9; },
        draft => { draft.units[0].actUsed = true; },
        draft => { draft.units[0].moveUsed = true; },
        draft => { draft.units[0].statusEffects = [{ type: 'silence', duration: 2 }]; },
        draft => { draft.units[0].skillCooldowns = { fireball: 2 }; },
        draft => { draft.units[0].consumables = [{ itemId: 1, quantity: 1 }]; },
        draft => { draft.consumables = [{ itemId: 2, quantity: 1 }]; }
      ];

      for (const mutate of variants) {
        const variant = structuredClone(state);
        mutate(variant);
        assert.notStrictEqual(
          baseline,
          tt.hashState(variant, 2, 'player', variant.units[0].id)
        );
      }
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

    it('matches complete sequences only when their ordered actions match', () => {
      const move = { type: 'move', position: { x: 5, y: 5 } };
      const attack = { type: 'attack', targetId: 'e1' };
      assert.strictEqual(
        km.actionsEqual([move, attack], [{ ...move }, { ...attack }]),
        true
      );
      assert.strictEqual(km.actionsEqual([move, attack], [attack, move]), false);
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

    it('tracks complete sequences without losing action order', () => {
      const move = { type: 'move', position: { x: 5, y: 5 } };
      const attack = { type: 'attack', targetId: 'e1' };
      hh.update([move, attack], 3);

      assert.strictEqual(hh.getScore([move, attack]), 9);
      assert.strictEqual(hh.getScore([attack, move]), 0);
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

  it('simulates AoE friendly fire across the runtime pattern and starts cooldown', () => {
    const state = createMockBattleState(
      [
        { id: 'caster', tileX: 5, tileY: 5, strength: 50, attack: 20, mp: 50, hp: 200, maxHp: 200 },
        { id: 'ally', tileX: 6, tileY: 6, hp: 200, maxHp: 200 }
      ],
      [
        { id: 'center-enemy', tileX: 6, tileY: 5, hp: 200, maxHp: 200 },
        { id: 'edge-enemy', tileX: 7, tileY: 5, hp: 200, maxHp: 200 },
        { id: 'outside-enemy', tileX: 8, tileY: 5, hp: 200, maxHp: 200 }
      ]
    );
    const caster = state.units.find(unit => unit.id === 'caster');
    const ally = state.units.find(unit => unit.id === 'ally');
    const centerEnemy = state.units.find(unit => unit.id === 'center-enemy');
    const edgeEnemy = state.units.find(unit => unit.id === 'edge-enemy');
    const outsideEnemy = state.units.find(unit => unit.id === 'outside-enemy');
    const action = {
      type: 'skill',
      skillId: 'blast',
      targetId: centerEnemy.id,
      target: { x: 6, y: 5 },
      aoeCenter: { x: 6, y: 5 },
      skill: { id: 'blast', power: 100, mpCost: 10, cooldown: 3, aoeRadius: 1 }
    };

    applyActionToState(state, caster, action);

    assert.ok(centerEnemy.hp < edgeEnemy.hp, 'center target should take full damage');
    assert.ok(edgeEnemy.hp < 200, 'edge opponent should be damaged');
    assert.ok(ally.hp < 200, 'ally in the pattern should take friendly fire');
    // Finding 46: Caster is excluded from offensive AoE unless skill.includesSelf is true
    assert.strictEqual(caster.hp, 200, 'caster should NOT take self-damage (excluded from offensive AoE)');
    assert.strictEqual(outsideEnemy.hp, 200);
    assert.strictEqual(caster.skillCooldowns.blast, 3);
  });

  it('forces range-zero offensive AoEs to remain centered on the caster', () => {
    const state = createMockBattleState(
      [{ id: 'caster', tileX: 5, tileY: 5, strength: 50, attack: 20, hp: 200, maxHp: 200 }],
      [
        { id: 'nearby', tileX: 6, tileY: 5, hp: 200 },
        { id: 'stale-target', tileX: 12, tileY: 5, hp: 200 }
      ]
    );
    const caster = state.units.find(unit => unit.id === 'caster');
    const nearby = state.units.find(unit => unit.id === 'nearby');
    const staleTarget = state.units.find(unit => unit.id === 'stale-target');

    applyActionToState(state, caster, {
      type: 'skill',
      target: { x: 12, y: 5 },
      aoeCenter: { x: 12, y: 5 },
      skill: { id: 'nova', power: 100, range: 0, aoeRadius: 1 }
    });

    // Finding 46: Caster is excluded from offensive AoE unless skill.includesSelf is true
    assert.strictEqual(caster.hp, 200, 'caster excluded from offensive AoE');
    assert.ok(nearby.hp < 200, 'nearby enemy should be damaged');
    assert.strictEqual(staleTarget.hp, 200, 'stale target outside the recentered AoE');
  });

  it('includes caster in offensive AoE when skill.includesSelf is true', () => {
    const state = createMockBattleState(
      [{ id: 'caster', tileX: 5, tileY: 5, strength: 50, attack: 20, hp: 200, maxHp: 200 }],
      [{ id: 'nearby', tileX: 6, tileY: 5, hp: 200 }]
    );
    const caster = state.units.find(unit => unit.id === 'caster');
    const nearby = state.units.find(unit => unit.id === 'nearby');

    applyActionToState(state, caster, {
      type: 'skill',
      target: { x: 5, y: 5 },
      aoeCenter: { x: 5, y: 5 },
      skill: { id: 'self_destruct', power: 100, range: 0, aoeRadius: 1, includesSelf: true }
    });

    // When includesSelf is true, caster should take damage from their own AoE
    assert.ok(caster.hp < 200, 'caster takes self-damage when includesSelf is true');
    assert.ok(nearby.hp < 200, 'nearby enemy should be damaged');
  });

  it('applies caster-centered support AoE buffs to living teammates in the area', () => {
    const state = createMockBattleState(
      [
        {
          id: 'caster',
          teamId: 7,
          tileX: 5,
          tileY: 5,
          hp: 100,
          maxHp: 200,
          mp: 30,
          statusEffects: []
        },
        {
          id: 'nearby-ally',
          teamId: 7,
          tileX: 6,
          tileY: 5,
          hp: 100,
          maxHp: 200,
          statusEffects: []
        },
        {
          id: 'distant-ally',
          teamId: 7,
          tileX: 8,
          tileY: 5,
          statusEffects: []
        },
        {
          id: 'defeated-ally',
          teamId: 7,
          tileX: 5,
          tileY: 4,
          hp: 0,
          statusEffects: []
        }
      ],
      [{
        id: 'nearby-opponent',
        teamId: 8,
        tileX: 5,
        tileY: 6,
        statusEffects: []
      }]
    );
    const caster = state.units.find(unit => unit.id === 'caster');
    const nearbyAlly = state.units.find(unit => unit.id === 'nearby-ally');
    const unaffected = state.units.filter(unit =>
      unit.id !== caster.id && unit.id !== nearbyAlly.id
    );

    applyActionToState(state, caster, {
      type: 'skill',
      skillId: 'beast_howl',
      targetId: caster.id,
      target: { x: 12, y: 5 },
      aoeCenter: { x: 12, y: 5 },
      skill: {
        id: 'beast_howl',
        power: 0,
        range: 0,
        aoeRadius: 1,
        damageType: 'support',
        selfBuff: { attack: 1.2 },
        healPercent: 10,
        buffDuration: 3,
        mpCost: 5,
        cooldown: 2
      }
    });

    const expectedBuff = [{
      type: 'beast_howl_buff',
      duration: 3,
      modifiers: { attack: 1.2 }
    }];
    assert.deepStrictEqual(caster.statusEffects, expectedBuff);
    assert.deepStrictEqual(nearbyAlly.statusEffects, expectedBuff);
    for (const unit of unaffected) {
      assert.deepStrictEqual(unit.statusEffects, []);
    }
    assert.strictEqual(caster.hp, 120);
    assert.strictEqual(nearbyAlly.hp, 100);
    assert.strictEqual(caster.mp, 25);
    assert.strictEqual(caster.skillCooldowns.beast_howl, 2);
    assert.strictEqual(caster.actUsed, true);
  });

  it('simulates a damage-free single-target debuff without reducing HP', () => {
    const state = createMockBattleState(
      [{ id: 'caster', mp: 30 }],
      [{ id: 'target', hp: 200, maxHp: 200, statusEffects: [] }]
    );
    const caster = state.units.find(unit => unit.id === 'caster');
    const target = state.units.find(unit => unit.id === 'target');

    applyActionToState(state, caster, {
      type: 'skill',
      skillId: 'frozen_tomb',
      targetId: target.id,
      skill: {
        id: 'frozen_tomb',
        power: 0,
        mpCost: 10,
        cooldown: 2,
        effect: 'freeze',
        effectChance: 0.8,
        effectDuration: 2
      }
    });

    assert.strictEqual(target.hp, 200);
    assert.deepStrictEqual(target.statusEffects, [
      { type: 'freeze', duration: 2 }
    ]);
    assert.strictEqual(caster.mp, 20);
    assert.strictEqual(caster.skillCooldowns.frozen_tomb, 2);
  });

  it('simulates damage-free AoE statuses on every affected unit', () => {
    const state = createMockBattleState(
      [
        { id: 'caster', tileX: 3, tileY: 5 },
        { id: 'ally', tileX: 6, tileY: 6, hp: 200, statusEffects: [] }
      ],
      [
        { id: 'target-a', tileX: 6, tileY: 5, hp: 200, statusEffects: [] },
        { id: 'target-b', tileX: 7, tileY: 5, hp: 200, statusEffects: [] }
      ]
    );
    const caster = state.units.find(unit => unit.id === 'caster');
    const affected = state.units.filter(unit => unit.id !== caster.id);

    applyActionToState(state, caster, {
      type: 'skill',
      targetId: 'target-a',
      target: { x: 6, y: 5 },
      aoeCenter: { x: 6, y: 5 },
      skill: {
        id: 'smoke_bomb',
        power: 0,
        aoeRadius: 1,
        effect: 'blind',
        effectChance: 1,
        effectDuration: 2
      }
    });

    for (const unit of affected) {
      assert.strictEqual(unit.hp, 200);
      assert.deepStrictEqual(unit.statusEffects, [
        { type: 'blind', duration: 2 }
      ]);
    }
  });

  it('applies a self-healing skill without damaging the caster', () => {
    const state = createMockBattleState(
      [{ hp: 50, maxHp: 200, mp: 40 }],
      [{ hp: 200, maxHp: 200 }]
    );
    const caster = state.units[0];
    applyActionToState(state, caster, {
      type: 'skill',
      targetId: caster.id,
      skill: { healPercent: 25, damageType: 'heal', mpCost: 10 }
    });

    assert.strictEqual(caster.hp, 100);
    assert.strictEqual(caster.mp, 30);
    assert.strictEqual(caster.actUsed, true);
  });

  it('heals the intended target and leaves other units undamaged', () => {
    const state = createMockBattleState(
      [
        { hp: 150, maxHp: 200, mp: 50 },
        { hp: 40, maxHp: 200 }
      ],
      [{ hp: 180, maxHp: 180 }]
    );
    const caster = state.units[0];
    const ally = state.units[1];
    const enemy = state.units[2];
    applyActionToState(state, caster, {
      type: 'skill',
      targetId: ally.id,
      skill: { healPercent: 30, damageType: 'heal', targetAlly: true, mpCost: 15 }
    });

    assert.strictEqual(ally.hp, 100);
    assert.strictEqual(caster.hp, 150);
    assert.strictEqual(enemy.hp, 180);
    assert.strictEqual(caster.mp, 35);
  });

  it('defaults healing to self, caps HP, and still deducts MP', () => {
    const state = createMockBattleState(
      [{ hp: 190, maxHp: 200, mp: 25 }],
      [{ hp: 200, maxHp: 200 }]
    );
    const caster = state.units[0];
    applyActionToState(state, caster, {
      type: 'skill',
      skill: { healPercent: 50, effect: 'heal', mpCost: 5 }
    });

    assert.strictEqual(caster.hp, 200);
    assert.strictEqual(caster.mp, 20);
  });

  it('applies a range-zero group heal to every living ally only', () => {
    const state = createMockBattleState(
      [
        { tileX: 2, tileY: 2, hp: 100, maxHp: 200, mp: 40 },
        { tileX: 18, tileY: 18, hp: 20, maxHp: 100 }
      ],
      [{ tileX: 3, tileY: 2, hp: 80, maxHp: 100 }]
    );
    const caster = state.units[0];
    const distantAlly = state.units[1];
    const enemy = state.units[2];

    applyActionToState(state, caster, {
      type: 'skill',
      targetId: caster.id,
      skill: {
        targetAllAllies: true,
        range: 0,
        healPercent: 25,
        mpCost: 10
      }
    });

    assert.strictEqual(caster.hp, 150);
    assert.strictEqual(distantAlly.hp, 45);
    assert.strictEqual(enemy.hp, 80);
    assert.strictEqual(caster.mp, 30);
  });

  it('limits positive-range group healing by Manhattan distance', () => {
    const state = createMockBattleState(
      [
        { tileX: 2, tileY: 2, hp: 100, maxHp: 200 },
        { tileX: 3, tileY: 2, hp: 20, maxHp: 100 },
        { tileX: 6, tileY: 2, hp: 20, maxHp: 100 }
      ],
      []
    );
    const caster = state.units[0];
    const nearbyAlly = state.units[1];
    const distantAlly = state.units[2];

    applyActionToState(state, caster, {
      type: 'skill',
      targetId: caster.id,
      skill: {
        targetAllAllies: true,
        range: 2,
        healPercent: 25,
        mpCost: 0
      }
    });

    assert.strictEqual(caster.hp, 150);
    assert.strictEqual(nearbyAlly.hp, 45);
    assert.strictEqual(distantAlly.hp, 20);
  });

  it('applies a pure self buff without damaging the caster', () => {
    const state = createMockBattleState(
      [{ hp: 120, maxHp: 200, mp: 30 }],
      [{}]
    );
    const caster = state.units[0];

    applyActionToState(state, caster, {
      type: 'skill',
      targetId: caster.id,
      skill: {
        targetSelf: true,
        selfBuff: 'fortify',
        buffDuration: 4,
        mpCost: 10,
        power: 0
      }
    });

    assert.strictEqual(caster.hp, 120);
    assert.strictEqual(caster.mp, 20);
    assert.deepStrictEqual(caster.statusEffects, [
      { type: 'fortify', duration: 4 }
    ]);
  });

  it('distinguishes caster buff identities from hostile hybrid effects', () => {
    const cases = [
      {
        name: 'string identity',
        selfBuff: 'berserk',
        effect: 'berserk',
        casterEffect: { type: 'berserk', duration: 3 },
        targetEffects: []
      },
      {
        name: 'object type identity',
        selfBuff: { type: 'berserk', attack: 1.2 },
        effect: 'berserk',
        casterEffect: {
          type: 'berserk',
          duration: 3,
          modifiers: { type: 'berserk', attack: 1.2 }
        },
        targetEffects: []
      },
      {
        name: 'skill-id fallback identity',
        selfBuff: { attack: 1.2 },
        effect: 'beast_frenzy_buff',
        casterEffect: {
          type: 'beast_frenzy_buff',
          duration: 3,
          modifiers: { attack: 1.2 }
        },
        targetEffects: []
      },
      {
        name: 'different target effect',
        selfBuff: 'berserk',
        effect: 'weaken',
        casterEffect: { type: 'berserk', duration: 3 },
        targetEffects: [{ type: 'weaken', duration: 3 }]
      }
    ];

    for (const testCase of cases) {
      const state = createMockBattleState(
        [{ strength: 50, attack: 20, mp: 40 }],
        [{ hp: 200, maxHp: 200, vitality: 10, defense: 5 }]
      );
      const caster = state.units[0];
      const target = state.units[1];

      applyActionToState(state, caster, {
        type: 'skill',
        targetId: target.id,
        skill: {
          id: 'beast_frenzy',
          power: 80,
          mpCost: 10,
          effectDuration: 3,
          selfBuff: testCase.selfBuff,
          effect: testCase.effect
        }
      });

      assert.ok(target.hp < 200, testCase.name);
      assert.deepStrictEqual(
        target.statusEffects,
        testCase.targetEffects,
        testCase.name
      );
      assert.strictEqual(caster.mp, 30, testCase.name);
      assert.deepStrictEqual(
        caster.statusEffects,
        [testCase.casterEffect],
        testCase.name
      );
    }
  });

  it('deducts cost before restoring and caps MP without damaging the caster', () => {
    const state = createMockBattleState(
      [{ hp: 120, maxHp: 200, mp: 48, maxMp: 50 }],
      [{}]
    );
    const caster = state.units[0];

    applyActionToState(state, caster, {
      type: 'skill',
      targetId: caster.id,
      skill: {
        targetSelf: true,
        mpRestore: 40,
        mpCost: 5,
        power: 0
      }
    });

    assert.strictEqual(caster.hp, 120);
    assert.strictEqual(caster.mp, 50);
    assert.strictEqual(caster.actUsed, true);
  });

  it('preserves beneficial legacy statuses when simulating cleanse', () => {
    const beneficialStatuses = [
      { type: 'rage', duration: 2 },
      { type: 'fortify', duration: 2 },
      { type: 'haste', duration: 2 },
      { type: 'regen', duration: 2 },
      { type: 'attack_up', duration: 2 },
      { type: 'defense_up', duration: 2 },
      { type: 'magic_shield', duration: 2 },
      'berserk',
      { type: 'frenzy', duration: 2 },
      'final_stand',
      { type: 'shadow_arts', duration: 2 },
      'pack_bonus',
      { type: 'regenerate', duration: 2 },
      'unmovable',
      { type: 'fire_resist', duration: 2 },
      {
        type: 'test_rally_buff',
        duration: 2,
        modifiers: { defense: 1.25 }
      }
    ];
    const state = createMockBattleState(
      [{
        statusEffects: [
          ...beneficialStatuses,
          { type: 'poison', duration: 2 }
        ]
      }],
      [{}]
    );
    const caster = state.units[0];

    applyActionToState(state, caster, {
      type: 'skill',
      targetId: caster.id,
      skill: {
        id: 'purify',
        power: 0,
        mpCost: 0,
        targetSelf: true,
        cleanse: true
      }
    });

    assert.deepStrictEqual(caster.statusEffects, beneficialStatuses);
  });

  it('limits simulated cure items to their runtime status-effect lists', () => {
    const cases = [
      {
        effectType: 'cure_poison',
        statusEffects: [
          'poison',
          { type: 'burn', duration: 2 },
          { type: 'rage', duration: 2 }
        ],
        expected: [
          { type: 'burn', duration: 2 },
          { type: 'rage', duration: 2 }
        ]
      },
      {
        effectType: 'cure_all',
        statusEffects: [
          { type: 'poison', duration: 2 },
          'blind',
          { type: 'stun', duration: 2 },
          { type: 'rage', duration: 2 }
        ],
        expected: [
          { type: 'stun', duration: 2 },
          { type: 'rage', duration: 2 }
        ]
      }
    ];

    for (const testCase of cases) {
      const state = createMockBattleState(
        [{ statusEffects: testCase.statusEffects }],
        [{}]
      );
      const caster = state.units[0];

      applyActionToState(state, caster, {
        type: 'item',
        targetId: caster.id,
        item: { effectType: testCase.effectType }
      });

      assert.deepStrictEqual(
        caster.statusEffects,
        testCase.expected,
        testCase.effectType
      );
    }
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

  it('applies registry status modifiers like the real damage formula', () => {
    const plain = createMockUnit({ strength: 30, attack: 15 });
    const raging = createMockUnit({ strength: 30, attack: 15, statusEffects: [{ type: 'rage' }] });
    const weakened = createMockUnit({ strength: 30, attack: 15, statusEffects: [{ type: 'weaken' }] });
    const target = createMockUnit({ vitality: 20, defense: 10 });
    const fortified = createMockUnit({ vitality: 20, defense: 10, statusEffects: [{ type: 'fortify' }] });

    const base = estimateActionDamage(plain, target, {});
    // (45 * 1.2) - 4.5 = 49.5 -> 49
    assert.strictEqual(estimateActionDamage(raging, target, {}), 49);
    // (45 * 0.8) - 4.5 = 31.5 -> 31
    assert.strictEqual(estimateActionDamage(weakened, target, {}), 31);
    // 45 - (30 * 1.3 * 0.15 = 5.85) = 39.15 -> 39
    assert.strictEqual(estimateActionDamage(plain, fortified, {}), 39);
    assert.strictEqual(base, 40);
  });

  it('uses default power of 100 when no skill', () => {
    const attacker = createMockUnit({ strength: 30, attack: 15 });
    const target = createMockUnit({ vitality: 20, defense: 10 });
    const d1 = estimateActionDamage(attacker, target, {});
    const d2 = estimateActionDamage(attacker, target, { skill: { power: 100 } });
    assert.strictEqual(d1, d2);
  });
});
