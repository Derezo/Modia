/**
 * Unit tests for skillScaling.js
 * Tests skill attribute scaling calculations
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  DEFAULT_SCALING_CONFIG,
  getScaledValue,
  scaleSkillAttributes,
  getSkillScalingPreview,
  getTotalScalingBonus
} from '../../config/skillScaling.js';

// =============================================================================
// DEFAULT CONFIG TESTS
// =============================================================================

describe('DEFAULT_SCALING_CONFIG', () => {
  test('should have power scaling', () => {
    assert.strictEqual(typeof DEFAULT_SCALING_CONFIG.power, 'number');
    assert.strictEqual(DEFAULT_SCALING_CONFIG.power, 0.8);
  });

  test('should have effectChance scaling', () => {
    assert.strictEqual(typeof DEFAULT_SCALING_CONFIG.effectChance, 'number');
    assert.strictEqual(DEFAULT_SCALING_CONFIG.effectChance, 0.003);
  });

  test('should have effectDuration scaling', () => {
    assert.strictEqual(typeof DEFAULT_SCALING_CONFIG.effectDuration, 'number');
    assert.strictEqual(DEFAULT_SCALING_CONFIG.effectDuration, 0.02);
  });

  test('should have zero default range scaling', () => {
    assert.strictEqual(DEFAULT_SCALING_CONFIG.range, 0);
  });

  test('should have zero default aoeRadius scaling', () => {
    assert.strictEqual(DEFAULT_SCALING_CONFIG.aoeRadius, 0);
  });

  test('should have healPercent scaling', () => {
    assert.strictEqual(typeof DEFAULT_SCALING_CONFIG.healPercent, 'number');
    assert.strictEqual(DEFAULT_SCALING_CONFIG.healPercent, 0.15);
  });

  test('should have mpRestore scaling', () => {
    assert.strictEqual(typeof DEFAULT_SCALING_CONFIG.mpRestore, 'number');
  });

  test('should have buffDuration scaling', () => {
    assert.strictEqual(typeof DEFAULT_SCALING_CONFIG.buffDuration, 'number');
  });
});

// =============================================================================
// getScaledValue TESTS
// =============================================================================

describe('getScaledValue', () => {
  test('should return base value for level 1', () => {
    const result = getScaledValue('power', 100, 1);
    assert.strictEqual(result, 100);
  });

  test('should return base value for level 0', () => {
    const result = getScaledValue('power', 100, 0);
    assert.strictEqual(result, 100);
  });

  test('should return base value for negative level', () => {
    const result = getScaledValue('power', 100, -5);
    assert.strictEqual(result, 100);
  });

  test('should scale power correctly', () => {
    // power increment = 0.8
    // level 50: 100 + (50-1) * 0.8 = 100 + 39.2 = 139.2
    const result = getScaledValue('power', 100, 50);
    assert.ok(Math.abs(result - 139.2) < 0.01, `Expected ~139.2, got ${result}`);
  });

  test('should scale effectChance correctly', () => {
    // effectChance increment = 0.003
    // level 50: 0.5 + (50-1) * 0.003 = 0.5 + 0.147 = 0.647
    const result = getScaledValue('effectChance', 0.5, 50);
    assert.ok(Math.abs(result - 0.647) < 0.001, `Expected ~0.647, got ${result}`);
  });

  test('should use custom increment when provided', () => {
    // Custom increment of 1.0 per level
    // level 10: 100 + (10-1) * 1.0 = 109
    const result = getScaledValue('power', 100, 10, 1.0);
    assert.strictEqual(result, 109);
  });

  test('should return undefined for undefined base value', () => {
    const result = getScaledValue('power', undefined, 50);
    assert.strictEqual(result, undefined);
  });

  test('should return null for null base value', () => {
    const result = getScaledValue('power', null, 50);
    assert.strictEqual(result, null);
  });

  test('should return 0 for zero base value', () => {
    const result = getScaledValue('power', 0, 50);
    // 0 + (50-1) * 0.8 = 39.2
    assert.ok(Math.abs(result - 39.2) < 0.01);
  });

  test('should use 0 increment for unknown attribute', () => {
    const result = getScaledValue('unknown_attribute', 100, 50);
    assert.strictEqual(result, 100, 'Unknown attribute should not scale');
  });

  test('should handle very high levels', () => {
    // level 100: 120 + (100-1) * 0.8 = 120 + 79.2 = 199.2
    const result = getScaledValue('power', 120, 100);
    assert.ok(Math.abs(result - 199.2) < 0.01, `Expected ~199.2, got ${result}`);
  });
});

// =============================================================================
// scaleSkillAttributes TESTS
// =============================================================================

describe('scaleSkillAttributes', () => {
  test('should return unchanged skill for level 1', () => {
    const skill = { id: 'test', power: 100, mpCost: 10 };
    const scaled = scaleSkillAttributes(skill, 1);

    assert.strictEqual(scaled.power, 100);
    assert.strictEqual(scaled.mpCost, 10);
  });

  test('should return unchanged skill for null skill', () => {
    const result = scaleSkillAttributes(null, 50);
    assert.strictEqual(result, null);
  });

  test('should return unchanged skill for undefined skill', () => {
    const result = scaleSkillAttributes(undefined, 50);
    assert.strictEqual(result, undefined);
  });

  test('should scale power correctly', () => {
    const skill = { id: 'test', power: 100 };
    const scaled = scaleSkillAttributes(skill, 50);

    // 100 + 49 * 0.8 = 139.2, rounded to 1 decimal = 139.2
    assert.ok(Math.abs(scaled.power - 139.2) < 0.1, `Expected ~139.2, got ${scaled.power}`);
  });

  test('should cap effectChance at 100%', () => {
    const skill = { id: 'test', effectChance: 0.9 };
    const scaled = scaleSkillAttributes(skill, 100);

    // 0.9 + 99 * 0.003 = 1.197, capped at 1.0
    assert.strictEqual(scaled.effectChance, 1.0, 'Effect chance should cap at 100%');
  });

  test('should floor effectDuration', () => {
    const skill = { id: 'test', effectDuration: 2 };
    const scaled = scaleSkillAttributes(skill, 50);

    // 2 + 49 * 0.02 = 2.98, floored to 2
    assert.strictEqual(scaled.effectDuration, 2);
  });

  test('should floor effectDuration to higher value at high levels', () => {
    const skill = { id: 'test', effectDuration: 2 };
    const scaled = scaleSkillAttributes(skill, 100);

    // 2 + 99 * 0.02 = 3.98, floored to 3
    assert.strictEqual(scaled.effectDuration, 3);
  });

  test('should scale healPercent', () => {
    const skill = { id: 'test', healPercent: 20 };
    const scaled = scaleSkillAttributes(skill, 50);

    // 20 + 49 * 0.15 = 27.35, rounded to 27.4
    assert.ok(scaled.healPercent > 27 && scaled.healPercent < 28);
  });

  test('should scale mpRestore', () => {
    const skill = { id: 'test', mpRestore: 10 };
    const scaled = scaleSkillAttributes(skill, 50);

    // 10 + 49 * 0.1 = 14.9, rounded
    assert.ok(scaled.mpRestore > 14 && scaled.mpRestore < 16);
  });

  test('should scale buffDuration', () => {
    const skill = { id: 'test', buffDuration: 3 };
    const scaled = scaleSkillAttributes(skill, 100);

    // 3 + 99 * 0.02 = 4.98, floored to 4
    assert.strictEqual(scaled.buffDuration, 4);
  });

  test('should only scale range when custom scaling provided', () => {
    const skillNoScaling = { id: 'test', range: 4 };
    const scaled1 = scaleSkillAttributes(skillNoScaling, 50);
    assert.strictEqual(scaled1.range, 4, 'Range should not scale without custom scaling');

    const skillWithScaling = { id: 'test', range: 4, scaling: { range: 0.02 } };
    const scaled2 = scaleSkillAttributes(skillWithScaling, 50);
    // 4 + 49 * 0.02 = 4.98, floored to 4
    assert.strictEqual(scaled2.range, 4);

    const scaled3 = scaleSkillAttributes(skillWithScaling, 100);
    // 4 + 99 * 0.02 = 5.98, floored to 5
    assert.strictEqual(scaled3.range, 5);
  });

  test('should only scale aoeRadius when custom scaling provided', () => {
    const skillNoScaling = { id: 'test', aoeRadius: 2 };
    const scaled1 = scaleSkillAttributes(skillNoScaling, 50);
    assert.strictEqual(scaled1.aoeRadius, 2, 'AOE radius should not scale without custom scaling');

    const skillWithScaling = { id: 'test', aoeRadius: 2, scaling: { aoeRadius: 0.01 } };
    const scaled2 = scaleSkillAttributes(skillWithScaling, 100);
    // 2 + 99 * 0.01 = 2.99, floored to 2
    assert.strictEqual(scaled2.aoeRadius, 2);
  });

  test('should only scale hits when custom scaling provided', () => {
    const skillWithScaling = { id: 'test', hits: 3, scaling: { hits: 0.02 } };
    const scaled = scaleSkillAttributes(skillWithScaling, 100);
    // 3 + 99 * 0.02 = 4.98, floored to 4
    assert.strictEqual(scaled.hits, 4);
  });

  test('should only scale chainTargets when custom scaling provided', () => {
    const skillWithScaling = { id: 'test', chainTargets: 3, scaling: { chainTargets: 0.02 } };
    const scaled = scaleSkillAttributes(skillWithScaling, 100);
    // 3 + 99 * 0.02 = 4.98, floored to 4
    assert.strictEqual(scaled.chainTargets, 4);
  });

  test('should add currentLevel to scaled skill', () => {
    const skill = { id: 'test', power: 100 };
    const scaled = scaleSkillAttributes(skill, 50);

    assert.strictEqual(scaled.currentLevel, 50);
  });

  test('should use custom power scaling', () => {
    const skill = { id: 'test', power: 100, scaling: { power: 0.5 } };
    const scaled = scaleSkillAttributes(skill, 100);

    // 100 + 99 * 0.5 = 149.5, rounded to 149.5
    assert.ok(Math.abs(scaled.power - 149.5) < 0.1);
  });

  test('should preserve non-scalable attributes', () => {
    const skill = {
      id: 'fireball',
      name: 'Fireball',
      mpCost: 15,
      power: 100,
      type: 'active'
    };
    const scaled = scaleSkillAttributes(skill, 50);

    assert.strictEqual(scaled.id, 'fireball');
    assert.strictEqual(scaled.name, 'Fireball');
    assert.strictEqual(scaled.mpCost, 15);
    assert.strictEqual(scaled.type, 'active');
  });

  test('should handle skill with no scalable attributes', () => {
    const skill = { id: 'test', mpCost: 10, type: 'passive' };
    const scaled = scaleSkillAttributes(skill, 50);

    assert.strictEqual(scaled.id, 'test');
    assert.strictEqual(scaled.mpCost, 10);
    assert.strictEqual(scaled.currentLevel, 50);
  });
});

// =============================================================================
// getSkillScalingPreview TESTS
// =============================================================================

describe('getSkillScalingPreview', () => {
  test('should return comparison object', () => {
    const skill = { id: 'test', power: 100, effectChance: 0.5 };
    const preview = getSkillScalingPreview(skill, 1, 50);

    assert.strictEqual(preview.skill, 'test');
    assert.strictEqual(preview.currentLevel, 1);
    assert.strictEqual(preview.previewLevel, 50);
    assert.ok(preview.attributes);
  });

  test('should compare power values', () => {
    const skill = { id: 'test', power: 100 };
    const preview = getSkillScalingPreview(skill, 1, 50);

    assert.strictEqual(preview.attributes.power.current, 100);
    assert.ok(preview.attributes.power.preview > 100);
    assert.strictEqual(preview.attributes.power.improved, true);
  });

  test('should compare effectChance values', () => {
    const skill = { id: 'test', effectChance: 0.5 };
    const preview = getSkillScalingPreview(skill, 1, 50);

    assert.strictEqual(preview.attributes.effectChance.current, 0.5);
    assert.ok(preview.attributes.effectChance.preview > 0.5);
    assert.strictEqual(preview.attributes.effectChance.improved, true);
  });

  test('should mark improved as false when no change', () => {
    const skill = { id: 'test', range: 4 }; // Range doesn't scale by default
    const preview = getSkillScalingPreview(skill, 1, 50);

    if (preview.attributes.range) {
      assert.strictEqual(preview.attributes.range.current, preview.attributes.range.preview);
      assert.strictEqual(preview.attributes.range.improved, false);
    }
  });

  test('should handle same level comparison', () => {
    const skill = { id: 'test', power: 100 };
    const preview = getSkillScalingPreview(skill, 50, 50);

    assert.strictEqual(preview.attributes.power.current, preview.attributes.power.preview);
    assert.strictEqual(preview.attributes.power.improved, false);
  });

  test('should only include attributes present in skill', () => {
    const skill = { id: 'test', power: 100 };
    const preview = getSkillScalingPreview(skill, 1, 50);

    assert.ok(preview.attributes.power);
    assert.strictEqual(preview.attributes.effectChance, undefined);
  });
});

// =============================================================================
// getTotalScalingBonus TESTS
// =============================================================================

describe('getTotalScalingBonus', () => {
  test('should calculate total bonus for power', () => {
    const skill = { id: 'test', power: 120 };
    const bonus = getTotalScalingBonus(skill, 100);

    assert.ok(bonus.power);
    assert.strictEqual(bonus.power.base, 120);
    // At level 100: 120 + 99 * 0.8 = 199.2
    assert.ok(Math.abs(bonus.power.max - 199.2) < 0.5);
    assert.ok(bonus.power.totalBonus > 0);
  });

  test('should calculate total bonus for effectChance', () => {
    const skill = { id: 'test', effectChance: 0.5 };
    const bonus = getTotalScalingBonus(skill, 100);

    assert.ok(bonus.effectChance);
    assert.strictEqual(bonus.effectChance.base, 0.5);
    // 0.5 + 99 * 0.003 = 0.797, doesn't reach 1.0 cap
    assert.ok(bonus.effectChance.max > 0.5 && bonus.effectChance.max < 1.0);
  });

  test('should cap effectChance at 1.0 when base is high', () => {
    const skill = { id: 'test', effectChance: 0.8 };
    const bonus = getTotalScalingBonus(skill, 100);

    assert.ok(bonus.effectChance);
    // 0.8 + 99 * 0.003 = 1.097, capped at 1.0
    assert.strictEqual(bonus.effectChance.max, 1.0);
  });

  test('should calculate total bonus for healPercent', () => {
    const skill = { id: 'test', healPercent: 20 };
    const bonus = getTotalScalingBonus(skill, 100);

    assert.ok(bonus.healPercent);
    assert.strictEqual(bonus.healPercent.base, 20);
    // At level 100: 20 + 99 * 0.15 = 34.85
    assert.ok(bonus.healPercent.max > 34 && bonus.healPercent.max < 36);
  });

  test('should use default max level of 100', () => {
    const skill = { id: 'test', power: 100 };
    const bonus = getTotalScalingBonus(skill);

    // Should use level 100
    assert.ok(Math.abs(bonus.power.max - 179.2) < 0.5);
  });

  test('should handle custom max level', () => {
    const skill = { id: 'test', power: 100 };
    const bonus = getTotalScalingBonus(skill, 50);

    // At level 50: 100 + 49 * 0.8 = 139.2
    assert.ok(Math.abs(bonus.power.max - 139.2) < 0.5);
  });

  test('should only include attributes present in skill', () => {
    const skill = { id: 'test', power: 100 };
    const bonus = getTotalScalingBonus(skill);

    assert.ok(bonus.power);
    assert.strictEqual(bonus.effectChance, undefined);
    assert.strictEqual(bonus.healPercent, undefined);
  });

  test('should handle skill with multiple attributes', () => {
    const skill = {
      id: 'test',
      power: 100,
      effectChance: 0.3,
      effectDuration: 2
    };
    const bonus = getTotalScalingBonus(skill);

    assert.ok(bonus.power);
    assert.ok(bonus.effectChance);
    assert.ok(bonus.effectDuration);
  });
});
