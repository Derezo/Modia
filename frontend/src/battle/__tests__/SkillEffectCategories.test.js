import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getActionVisualDescriptor,
  getVisualCategory,
  resolveActionSkill
} from '../SkillEffectCategories.js';

describe('canonical battle action visuals', () => {
  it('uses element before a generic magical fallback', () => {
    assert.equal(getVisualCategory({ damageType: 'magical', element: 'fire' }), 'fire');
    assert.equal(getVisualCategory({ damageType: 'magical', element: 'frost' }), 'ice');
    assert.equal(getVisualCategory({ damageType: 'magical' }), 'holy');
  });

  it('preserves camel-cased explicit categories', () => {
    assert.equal(getVisualCategory({ visualCategory: 'selfAura' }), 'selfAura');
    assert.equal(getVisualCategory({ visualCategory: 'SELFAURA' }), 'selfAura');
  });

  it('accepts both historical skill result identifiers', () => {
    const actor = {
      skills: [
        { id: 'fireball', type: 'active', element: 'fire' },
        { id: 'meditation', type: 'active', targetSelf: true }
      ]
    };

    assert.equal(resolveActionSkill(actor, { skillUsed: 'fireball' }).element, 'fire');
    assert.equal(resolveActionSkill(actor, { skillId: 'meditation' }).targetSelf, true);
  });

  it('selects cast/projectile presentation for elemental skills', () => {
    assert.deepEqual(
      getActionVisualDescriptor('skill', { element: 'fire', damageType: 'magical' }),
      {
        category: 'fire',
        actorAnimation: 'cast',
        projectile: true,
        selfTarget: false,
        trailEnabled: true,
        primaryColor: '#ff4400',
        glowColor: 'rgba(255, 68, 0, 0.4)',
        element: 'fire'
      }
    );
  });

  it('uses a non-projectile aura for self-targeted abilities', () => {
    const descriptor = getActionVisualDescriptor('skill', {}, {
      id: 'meditation',
      targetSelf: true,
      visualCategory: 'selfAura'
    });

    assert.equal(descriptor.category, 'selfAura');
    assert.equal(descriptor.actorAnimation, 'cast');
    assert.equal(descriptor.projectile, false);
    assert.equal(descriptor.selfTarget, true);
  });

  it('keeps basic attacks in the physical attack pose', () => {
    const descriptor = getActionVisualDescriptor('attack', { damageType: 'physical' });
    assert.equal(descriptor.category, 'physical');
    assert.equal(descriptor.actorAnimation, 'attack');
    assert.equal(descriptor.projectile, false);
  });

  it('does not misclassify a self-centered AoE as a self aura', () => {
    const descriptor = getActionVisualDescriptor('skill', {
      actorId: 'caster',
      targetId: 'caster',
      isAoE: true,
      element: 'fire',
      damageType: 'magical'
    });

    assert.equal(descriptor.category, 'fire');
    assert.equal(descriptor.selfTarget, false);
    assert.equal(descriptor.projectile, true);
  });

  it('infers fallback categories from canonical action skillEffects', () => {
    assert.equal(getVisualCategory({
      skillEffects: [{ type: 'buff', effect: 'fortify' }]
    }), 'buff');
    assert.equal(getVisualCategory({
      skillEffects: [{ type: 'debuff', effect: 'blind' }]
    }), 'debuff');
    assert.equal(getVisualCategory({
      skillEffects: [{ type: 'debuff', effect: 'burn' }]
    }), 'fire');
    assert.equal(getVisualCategory({ effect: { type: 'buff' } }), 'buff');
  });

  it('honors an explicit projectile override for non-trailing categories', () => {
    const descriptor = getActionVisualDescriptor('skill', {
      visualCategory: 'physical',
      damageType: 'physical',
      projectile: true
    });

    assert.equal(descriptor.actorAnimation, 'attack');
    assert.equal(descriptor.projectile, true);
    assert.equal(descriptor.trailEnabled, false);
  });
});
