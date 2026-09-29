/**
 * Offensive AoEs exclude their caster, including power-0 hostile-status AoEs
 * (smoke_bomb blind, ferocious_roar fear). The runtime used to exclude the
 * caster only for damaging AoEs, so these debuffed the caster itself while
 * the AI simulator (ai/cache.js) assumed they did not.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { processAction } from '../../../services/battle/actionProcessor.js';
import {
  excludesCasterFromAoE,
  hasHostileStatusSkillComponent
} from '../../../services/battle/skillClassification.js';

function makeUnit(id, team, x, y, extra = {}) {
  return {
    id, name: id, type: team === 1 ? 'player' : 'enemy', teamId: team,
    tileX: x, tileY: y, hp: 100, maxHp: 100, mp: 100, maxMp: 100,
    strength: 10, vitality: 10, intelligence: 10, agility: 10, luck: 0,
    statusEffects: [], skillCooldowns: {}, ...extra
  };
}

function withLowRandom(callback) {
  const random = mock.method(Math, 'random', () => 0.01);
  try {
    return callback();
  } finally {
    random.mock.restore();
  }
}

describe('AoE caster exclusion', () => {
  it('smoke_bomb blinds the enemy but never its own caster', () => {
    const caster = makeUnit('c', 1, 5, 5, { class: 'thief', skills: [{ id: 'smoke_bomb', level: 1 }] });
    const enemy = makeUnit('e', 2, 6, 5);
    const state = { units: [caster, enemy], width: 20, height: 20 };

    const result = withLowRandom(() =>
      processAction(state, caster, 'skill', { x: 6, y: 5 }, 'smoke_bomb'));

    assert.equal(result.error, undefined);
    const targets = result.aoeTargets.map(t => t.targetId);
    assert.ok(!targets.includes('c'), 'caster not in its own smoke');
    assert.ok(targets.includes('e'));
    assert.ok(!caster.statusEffects.some(e => e.type === 'blind'));
    assert.ok(enemy.statusEffects.some(e => e.type === 'blind'));
  });

  it('an enemy fear roar does not frighten the roaring monster', () => {
    const caster = makeUnit('m', 2, 5, 5, {
      class: 'beast', archetype: 'beast', skills: [{ id: 'ferocious_roar', level: 1 }]
    });
    const hero = makeUnit('h', 1, 6, 5);
    const state = { units: [caster, hero], width: 20, height: 20 };

    const result = withLowRandom(() =>
      processAction(state, caster, 'skill', { x: 6, y: 5 }, 'ferocious_roar'));

    assert.equal(result.error, undefined);
    assert.ok(!result.aoeTargets.some(t => t.targetId === 'm'));
    assert.ok(!caster.statusEffects.some(e => e.type === 'fear'));
  });

  it('classifies power-0 hostile AoEs as caster-excluding, like the AI simulator', () => {
    const smoke = { power: 0, range: 3, aoeRadius: 2, effect: 'blind' };
    assert.equal(hasHostileStatusSkillComponent(smoke), true);
    assert.equal(excludesCasterFromAoE(smoke), true);
    assert.equal(excludesCasterFromAoE({ ...smoke, includesSelf: true }), false);
    // Support AoEs still include the caster
    const rally = { power: 0, range: 0, aoeRadius: 3, selfBuff: 'attack_up', effect: 'attack_up' };
    assert.equal(excludesCasterFromAoE(rally), false);
  });
});
