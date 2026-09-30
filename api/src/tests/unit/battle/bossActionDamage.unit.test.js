/**
 * processActionBossDamage: each damaged boss is processed once per action.
 *
 * An AoE result lists its primary target in result.targetId/damage AND in
 * result.aoeTargets. The route used to run processBossDamage for both, so a
 * boss whose HP fell below two thresholds in one AoE hit jumped two phases.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { processActionBossDamage } from '../../../services/bossService.js';

function bossState(overrides = {}) {
  return {
    currentPhase: 1,
    maxPhases: 3,
    phaseName: 'Phase 1',
    baseStats: { attack: 10, defense: 5, magicAttack: 10, magicDefense: 5, agility: 10 },
    ...overrides
  };
}

function boss(id, hp) {
  return {
    id,
    name: `Boss ${id}`,
    type: 'enemy',
    hp,
    maxHp: 100,
    phases: [
      { name: 'Phase 1', threshold: 1.0 },
      { name: 'Phase 2', threshold: 0.5 },
      { name: 'Phase 3', threshold: 0.25 }
    ]
  };
}

describe('processActionBossDamage', () => {
  it('an AoE hit crossing two thresholds advances the boss one phase, like a single-target hit', () => {
    const b = boss('boss1', 20); // already applied: 100 -> 20, below 0.5 and 0.25
    const state = { units: [b], bossStates: { boss1: bossState() } };
    const aoeResult = {
      targetId: 'boss1',
      targetType: 'enemy',
      damage: 80,
      aoeTargets: [{ targetId: 'boss1', targetType: 'enemy', damage: 80, isCenter: true }]
    };

    const transitions = processActionBossDamage(state, aoeResult);

    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].boss, b);
    assert.equal(state.bossStates.boss1.currentPhase, 2);

    const single = boss('boss2', 20);
    const singleState = { units: [single], bossStates: { boss2: bossState() } };
    processActionBossDamage(singleState, { targetId: 'boss2', targetType: 'enemy', damage: 80 });
    assert.equal(singleState.bossStates.boss2.currentPhase, state.bossStates.boss1.currentPhase);
  });

  it('processes every damaged boss in an AoE once and ignores allies, misses and the dead', () => {
    const b1 = boss('b1', 40);
    const b2 = boss('b2', 45);
    const dead = boss('b3', 0);
    const state = {
      units: [b1, b2, dead, { id: 'ally', type: 'player', hp: 10, maxHp: 10 }],
      bossStates: { b1: bossState(), b2: bossState(), b3: bossState() }
    };
    const transitions = processActionBossDamage(state, {
      targetId: 'b1',
      targetType: 'enemy',
      damage: 115,
      aoeTargets: [
        { targetId: 'b1', targetType: 'enemy', damage: 60, isCenter: true },
        { targetId: 'b2', targetType: 'enemy', damage: 55 },
        { targetId: 'b3', targetType: 'enemy', damage: 30 },
        { targetId: 'ally', targetType: 'player', damage: 5 },
        { targetId: 'b2', targetType: 'enemy', damage: 0, missed: true }
      ]
    });

    assert.deepEqual(transitions.map(t => t.boss.id), ['b1', 'b2']);
    assert.equal(state.bossStates.b1.currentPhase, 2);
    assert.equal(state.bossStates.b2.currentPhase, 2);
    assert.equal(state.bossStates.b3.currentPhase, 1);
  });

  it('returns nothing without boss states or damage', () => {
    assert.deepEqual(processActionBossDamage({ units: [] }, { damage: 5 }), []);
    const state = { units: [boss('b', 40)], bossStates: { b: bossState() } };
    assert.deepEqual(processActionBossDamage(state, { targetId: 'b', targetType: 'enemy', damage: 0 }), []);
  });
});
