/**
 * Equipment lifesteal applies to skills, not only basic attacks.
 *
 * computeLifesteal (trait + equipment augment 'lifesteal') is used by basic
 * attacks and by single-target and AoE skills.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert';

import { processAction } from '../../../services/battle/actionProcessor.js';

function withRandomValues(values, callback) {
  let index = 0;
  const random = mock.method(
    Math,
    'random',
    () => values[Math.min(index++, values.length - 1)]
  );
  try {
    return callback();
  } finally {
    random.mock.restore();
  }
}


describe('processAction - equipment lifesteal on skills', () => {
  function makeUnit(overrides = {}) {
    return {
      id: 'caster',
      type: 'player',
      teamId: 1,
      tileX: 5,
      tileY: 5,
      hp: 20,
      maxHp: 1000,
      mp: 100,
      maxMp: 100,
      strength: 60,
      intelligence: 60,
      agility: 10,
      vitality: 10,
      luck: 0,
      moveUsed: false,
      actUsed: false,
      turnPhase: 'ready',
      statusEffects: [],
      skillCooldowns: {},
      skills: [],
      ...overrides
    };
  }

  const strike = {
    id: 'test_lifesteal_strike',
    name: 'Test Strike',
    type: 'active',
    power: 150,
    range: 1,
    mpCost: 5,
    damageType: 'physical'
  };

  function runStrike(augmentEffects) {
    const caster = makeUnit({
      skills: [strike],
      ...(augmentEffects ? { equipmentAugmentEffects: augmentEffects } : {})
    });
    const target = makeUnit({
      id: 'target',
      type: 'enemy',
      teamId: 2,
      tileX: 6,
      hp: 1000,
      strength: 5,
      vitality: 5
    });
    const state = { units: [caster, target], mapWidth: 32, mapHeight: 32, terrain: [] };
    // 0.5: hits, no crit, mid-range variance
    const result = withRandomValues([0.5], () =>
      processAction(state, caster, 'skill', { x: 6, y: 5 }, strike.id)
    );
    return { caster, target, result };
  }

  it('heals the caster by the augment fraction of single-target skill damage', () => {
    const { caster, target, result } = runStrike({ lifesteal: 0.5 });
    assert.strictEqual(result.error, undefined);
    const dealt = 1000 - target.hp;
    assert.ok(dealt > 0, 'the skill dealt damage');
    assert.strictEqual(result.lifestealAmount, Math.floor(dealt * 0.5));
    assert.strictEqual(caster.hp, 20 + Math.floor(dealt * 0.5));
  });

  it('does not heal without a lifesteal augment', () => {
    const { caster, result } = runStrike(null);
    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.lifestealAmount, undefined);
    assert.strictEqual(caster.hp, 20);
  });
});
