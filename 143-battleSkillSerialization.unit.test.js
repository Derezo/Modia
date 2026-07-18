import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getSkillDefinition,
  resolveBattleSkill,
  serializeBattleSkill
} from '../../services/battle/skillDefinitionService.js';
import { resolveAdvancementSkills } from '../../services/guildmasterBattleService.js';

describe('canonical battle skill serialization', () => {
  it('preserves Fireball elemental mechanics and presentation in battle state', () => {
    const skill = resolveBattleSkill('wizard', {
      skill_id: 'fireball',
      level: 1
    });

    assert.equal(skill.id, 'fireball');
    assert.equal(skill.level, 1);
    assert.equal(skill.type, 'active');
    assert.equal(skill.damageType, 'magical');
    assert.equal(skill.element, 'fire');
    assert.equal(skill.range, 4);
    assert.equal(skill.mpCost, 18);
    assert.equal(skill.effect, 'burn');
    assert.equal(skill.effectChance, 0.5);
    assert.equal(skill.effectDuration, 2);
    assert.equal(skill.visualCategory, 'fire');
    assert.equal(skill.icon, '🔥');
  });

  it('preserves zero-cost, zero-range self-healing targets', () => {
    const skill = resolveBattleSkill('monk', {
      id: 'meditation',
      level: 1
    });

    assert.equal(skill.type, 'active');
    assert.equal(skill.targetSelf, true);
    assert.equal(skill.healPercent, 15);
    assert.equal(skill.mpRestore, 15);
    assert.equal(skill.range, 0);
    assert.equal(skill.mpCost, 0);
    assert.equal(skill.power, 0);
    assert.equal(skill.visualCategory, 'selfAura');
  });

  it('restores source mechanics omitted by a legacy unit DTO without losing custom values', () => {
    const legacyUnit = {
      type: 'player',
      class: 'wizard',
      skills: [{
        id: 'fireball',
        name: 'Fireball',
        level: 12,
        power: 777,
        range: 4,
        mpCost: 18,
        type: 'active'
      }]
    };

    const definition = getSkillDefinition('wizard', 'fireball', 12, legacyUnit);

    assert.equal(definition.power, 777, 'pre-scaled/local values retain precedence');
    assert.equal(definition.damageType, 'magical');
    assert.equal(definition.element, 'fire');
    assert.equal(definition.effect, 'burn');
    assert.equal(definition.effectChance > 0.5, true, 'tree mechanics still scale at learned level');
    assert.equal(definition.visualCategory, 'fire');
    assert.equal(definition.icon, '🔥');
  });

  it('resolves inherited base-class skills after class advancement', () => {
    const skill = resolveBattleSkill('sorcerer', {
      skill_id: 'fireball',
      level: 5
    });

    assert.equal(skill.id, 'fireball');
    assert.equal(skill.type, 'active');
    assert.equal(skill.damageType, 'magical');
    assert.equal(skill.element, 'fire');
  });

  it('copies nested targets, area, effects, costs, cooldowns, and animation data wholesale', () => {
    const source = {
      id: 'arcane_demo',
      name: 'Arcane Demo',
      type: 'active',
      targets: ['enemy', 'tile'],
      targetAllEnemies: true,
      area: { shape: 'cross', radius: 2 },
      healing: { percent: 5, alliesOnly: true },
      effects: [{ id: 'shock', chance: 0.75, duration: 3 }],
      effectChance: 0.75,
      effectDuration: 3,
      mpCost: 9,
      staminaCost: 4,
      cooldown: 2,
      visualCategory: 'lightning',
      icon: '⚡',
      animation: {
        caster: 'cast_staff',
        projectile: 'arc_lightning',
        impact: 'lightning_burst',
        timings: [100, 240, 400]
      }
    };

    const skill = serializeBattleSkill(source, { level: 3 });

    assert.deepEqual(skill.targets, source.targets);
    assert.deepEqual(skill.area, source.area);
    assert.deepEqual(skill.healing, source.healing);
    assert.deepEqual(skill.effects, source.effects);
    assert.equal(skill.staminaCost, 4);
    assert.equal(skill.cooldown, 2);
    assert.deepEqual(skill.animation, source.animation);

    skill.animation.timings.push(999);
    assert.deepEqual(source.animation.timings, [100, 240, 400], 'DTO is detached from config data');
  });

  it('makes learned guild advancement skills selectable while retaining passive compatibility', () => {
    const skills = resolveAdvancementSkills('wizard', [
      { skill_id: 'fireball', level: 7 },
      { skill_id: 'wizard_intellect', level: 4 }
    ]);

    const selectable = skills.filter(skill => skill.type === 'active');
    assert.deepEqual(selectable.map(skill => skill.id), ['fireball']);
    assert.equal(selectable[0].level, 7);
    assert.equal(selectable[0].element, 'fire');
    assert.equal(skills.find(skill => skill.id === 'wizard_intellect')?.type, 'passive');
  });
});
