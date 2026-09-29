/**
 * 'resisted' is reported only when resistance changed the outcome: a single
 * roll in [effectiveChance, baseChance). A failed base roll is a plain miss.
 * Previously every failed debuff roll against an enemy was 'resisted'.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { rollStatusEffect, processAction } from '../../../services/battle/actionProcessor.js';

function withRandom(value, callback) {
  const random = mock.method(Math, 'random', () => value);
  try {
    return callback();
  } finally {
    random.mock.restore();
  }
}

describe('rollStatusEffect', () => {
  // 30% bleed vs 10% resistance: effective 27%
  const base = 0.3;
  const effective = 0.27;

  it('applies below the effective chance', () => {
    assert.equal(withRandom(0.1, () => rollStatusEffect(base, effective, true)), 'applied');
  });

  it('is resisted only in [effective, base)', () => {
    assert.equal(withRandom(0.28, () => rollStatusEffect(base, effective, true)), 'resisted');
  });

  it('is a plain miss at or above the base chance', () => {
    assert.equal(withRandom(0.3, () => rollStatusEffect(base, effective, true)), 'missed');
    assert.equal(withRandom(0.9, () => rollStatusEffect(base, effective, true)), 'missed');
  });

  it('never reports resisted for non-debuffs', () => {
    assert.equal(withRandom(0.28, () => rollStatusEffect(0.3, 0.3, false)), 'applied');
    assert.equal(withRandom(0.35, () => rollStatusEffect(0.3, 0.3, false)), 'missed');
    // Even if a caller passed a lower effective chance, no resist without a debuff
    assert.equal(withRandom(0.28, () => rollStatusEffect(0.3, 0.27, false)), 'missed');
  });
});

describe('single-target status skill reporting', () => {
  function run(randomValue) {
    const unit = (id, team, x) => ({
      id, name: id, type: team === 1 ? 'player' : 'enemy', teamId: team,
      tileX: x, tileY: 5, hp: 500, maxHp: 500, mp: 100, maxMp: 100,
      strength: 30, vitality: 10, intelligence: 10, agility: 10, luck: 0,
      statusEffects: [], skillCooldowns: {}
    });
    const caster = { ...unit('c', 1, 5), class: 'beast', archetype: 'beast', skills: [{ id: 'rending_bite', level: 1 }] };
    const target = unit('t', 2, 6);
    const state = { units: [caster, target], width: 20, height: 20 };
    return withRandom(randomValue, () =>
      processAction(state, caster, 'skill', { x: 6, y: 5 }, 'rending_bite'));
  }

  it('does not label a failed base roll as resisted', () => {
    // rending_bite: 70% bleed. 0.8 hits but fails the base roll outright.
    const result = run(0.8);
    assert.equal(result.error, undefined);
    assert.ok(result.damage > 0, 'the bite must land so the status roll runs');
    assert.ok(!result.skillEffects.some(e => e.type === 'resisted'));
    assert.equal(result.effectResisted, undefined);
  });

  it('reports resisted when the roll falls between effective and base chance', () => {
    // 10% resistance: effective 63%, base 70%
    const result = run(0.66);
    assert.ok(result.damage > 0);
    assert.ok(result.skillEffects.some(e => e.type === 'resisted' && e.effect === 'bleed'));
    assert.equal(result.effectResisted, 'bleed');
  });
});
