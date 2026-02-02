/**
 * Unit tests for traitEffectRegistry.js
 * Tests trait effect registration and lookup functions
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  createMockPlayerUnit,
  createMockTrait
} from '../testUtils/index.js';
import {
  EFFECT_PHASES,
  registerEffectHandler,
  getEffectHandler,
  hasEffectHandler,
  getRegisteredEffectTypes,
  getEffectTypesForPhase,
  applyEffectsForPhase,
  getAggregateMultiplier
} from '../../services/traits/traitEffectRegistry.js';

// =============================================================================
// EFFECT_PHASES TESTS
// =============================================================================

describe('EFFECT_PHASES', () => {
  test('should have BATTLE_START phase', () => {
    assert.strictEqual(EFFECT_PHASES.BATTLE_START, 'battleStart');
  });

  test('should have ON_DAMAGE_DEALT phase', () => {
    assert.strictEqual(EFFECT_PHASES.ON_DAMAGE_DEALT, 'onDamageDealt');
  });

  test('should have ON_DAMAGE_RECEIVED phase', () => {
    assert.strictEqual(EFFECT_PHASES.ON_DAMAGE_RECEIVED, 'onDamageReceived');
  });

  test('should have ON_TURN_START phase', () => {
    assert.strictEqual(EFFECT_PHASES.ON_TURN_START, 'onTurnStart');
  });

  test('should have ON_ATTACK phase', () => {
    assert.strictEqual(EFFECT_PHASES.ON_ATTACK, 'onAttack');
  });

  test('should have ON_KILL phase', () => {
    assert.strictEqual(EFFECT_PHASES.ON_KILL, 'onKill');
  });

  test('should have ON_DEATH phase', () => {
    assert.strictEqual(EFFECT_PHASES.ON_DEATH, 'onDeath');
  });

  test('should have ON_REWARD phase', () => {
    assert.strictEqual(EFFECT_PHASES.ON_REWARD, 'onReward');
  });
});

// =============================================================================
// HANDLER REGISTRATION TESTS
// =============================================================================

describe('registerEffectHandler', () => {
  test('should register a valid handler', () => {
    registerEffectHandler('test_effect_1', {
      phase: EFFECT_PHASES.BATTLE_START,
      description: 'Test effect',
      apply: (unit, value) => ({ type: 'test', value })
    });

    const handler = getEffectHandler('test_effect_1');
    assert.ok(handler);
    assert.strictEqual(handler.phase, EFFECT_PHASES.BATTLE_START);
  });

  test('should throw for handler without phase', () => {
    assert.throws(() => {
      registerEffectHandler('invalid_handler', {
        apply: () => {}
      });
    }, /must have phase and apply/);
  });

  test('should throw for handler without apply function', () => {
    assert.throws(() => {
      registerEffectHandler('invalid_handler', {
        phase: EFFECT_PHASES.BATTLE_START
      });
    }, /must have phase and apply/);
  });

  test('should overwrite existing handler', () => {
    registerEffectHandler('test_overwrite', {
      phase: EFFECT_PHASES.BATTLE_START,
      apply: () => ({ version: 1 })
    });

    registerEffectHandler('test_overwrite', {
      phase: EFFECT_PHASES.ON_ATTACK,
      apply: () => ({ version: 2 })
    });

    const handler = getEffectHandler('test_overwrite');
    assert.strictEqual(handler.phase, EFFECT_PHASES.ON_ATTACK);
  });
});

describe('getEffectHandler', () => {
  test('should return registered handler', () => {
    registerEffectHandler('test_get_handler', {
      phase: EFFECT_PHASES.ON_DAMAGE_DEALT,
      apply: () => {}
    });

    const handler = getEffectHandler('test_get_handler');
    assert.ok(handler);
    assert.strictEqual(handler.phase, EFFECT_PHASES.ON_DAMAGE_DEALT);
  });

  test('should return null for unregistered handler', () => {
    const handler = getEffectHandler('nonexistent_handler_xyz');
    assert.strictEqual(handler, null);
  });
});

describe('hasEffectHandler', () => {
  test('should return true for registered handler', () => {
    registerEffectHandler('test_has_handler', {
      phase: EFFECT_PHASES.BATTLE_START,
      apply: () => {}
    });

    assert.strictEqual(hasEffectHandler('test_has_handler'), true);
  });

  test('should return false for unregistered handler', () => {
    assert.strictEqual(hasEffectHandler('definitely_not_registered_xyz'), false);
  });
});

describe('getRegisteredEffectTypes', () => {
  test('should return array of registered effect types', () => {
    registerEffectHandler('test_registered_1', {
      phase: EFFECT_PHASES.BATTLE_START,
      apply: () => {}
    });

    const types = getRegisteredEffectTypes();
    assert.ok(Array.isArray(types));
    assert.ok(types.includes('test_registered_1'));
  });
});

describe('getEffectTypesForPhase', () => {
  test('should return effect types for specified phase', () => {
    registerEffectHandler('test_phase_filter_a', {
      phase: EFFECT_PHASES.ON_TURN_START,
      apply: () => {}
    });

    registerEffectHandler('test_phase_filter_b', {
      phase: EFFECT_PHASES.ON_ATTACK,
      apply: () => {}
    });

    const turnStartTypes = getEffectTypesForPhase(EFFECT_PHASES.ON_TURN_START);
    assert.ok(Array.isArray(turnStartTypes));
    assert.ok(turnStartTypes.includes('test_phase_filter_a'));
    assert.ok(!turnStartTypes.includes('test_phase_filter_b'));
  });

  test('should return empty array for phase with no handlers', () => {
    // Using a phase that might not have handlers
    const types = getEffectTypesForPhase('nonexistent_phase');
    assert.ok(Array.isArray(types));
  });
});

// =============================================================================
// APPLY EFFECTS TESTS
// =============================================================================

describe('applyEffectsForPhase', () => {
  test('should return unmodified result for unit with no traits', () => {
    const unit = createMockPlayerUnit({ traits: [] });

    const result = applyEffectsForPhase(unit, EFFECT_PHASES.BATTLE_START);

    assert.strictEqual(result.modified, false);
    assert.strictEqual(result.effects.length, 0);
  });

  test('should return unmodified result for unit with undefined traits', () => {
    const unit = createMockPlayerUnit({});
    delete unit.traits;

    const result = applyEffectsForPhase(unit, EFFECT_PHASES.BATTLE_START);

    assert.strictEqual(result.modified, false);
    assert.strictEqual(result.effects.length, 0);
  });

  test('should apply registered effect handler', () => {
    registerEffectHandler('test_apply_effect', {
      phase: EFFECT_PHASES.BATTLE_START,
      apply: (unit, value) => {
        unit.testBonus = value;
        return { type: 'bonus_applied', amount: value };
      }
    });

    const unit = createMockPlayerUnit({
      traits: [
        { name: 'Test Trait', effectType: 'test_apply_effect', effectValue: 10 }
      ]
    });

    const result = applyEffectsForPhase(unit, EFFECT_PHASES.BATTLE_START);

    assert.strictEqual(result.modified, true);
    assert.strictEqual(result.effects.length, 1);
    assert.strictEqual(result.effects[0].traitName, 'Test Trait');
    assert.strictEqual(unit.testBonus, 10);
  });

  test('should skip traits without registered handler', () => {
    const unit = createMockPlayerUnit({
      traits: [
        { name: 'Unknown Trait', effectType: 'totally_unknown_effect_type', effectValue: 5 }
      ]
    });

    const result = applyEffectsForPhase(unit, EFFECT_PHASES.BATTLE_START);

    assert.strictEqual(result.modified, false);
    assert.strictEqual(result.effects.length, 0);
  });

  test('should skip traits for different phase', () => {
    registerEffectHandler('test_different_phase', {
      phase: EFFECT_PHASES.ON_KILL,
      apply: (unit, value) => ({ type: 'kill_bonus', value })
    });

    const unit = createMockPlayerUnit({
      traits: [
        { name: 'Kill Trait', effectType: 'test_different_phase', effectValue: 10 }
      ]
    });

    const result = applyEffectsForPhase(unit, EFFECT_PHASES.BATTLE_START);

    assert.strictEqual(result.modified, false);
    assert.strictEqual(result.effects.length, 0);
  });

  test('should apply multiple traits', () => {
    registerEffectHandler('test_multi_a', {
      phase: EFFECT_PHASES.BATTLE_START,
      apply: (unit, value) => ({ type: 'a', value })
    });

    registerEffectHandler('test_multi_b', {
      phase: EFFECT_PHASES.BATTLE_START,
      apply: (unit, value) => ({ type: 'b', value })
    });

    const unit = createMockPlayerUnit({
      traits: [
        { name: 'Trait A', effectType: 'test_multi_a', effectValue: 5 },
        { name: 'Trait B', effectType: 'test_multi_b', effectValue: 10 }
      ]
    });

    const result = applyEffectsForPhase(unit, EFFECT_PHASES.BATTLE_START);

    assert.strictEqual(result.modified, true);
    assert.strictEqual(result.effects.length, 2);
  });

  test('should pass context to handler', () => {
    let receivedContext = null;

    registerEffectHandler('test_context_effect', {
      phase: EFFECT_PHASES.ON_DAMAGE_DEALT,
      apply: (unit, value, context) => {
        receivedContext = context;
        return { type: 'context_test' };
      }
    });

    const unit = createMockPlayerUnit({
      traits: [
        { name: 'Context Trait', effectType: 'test_context_effect', effectValue: 5 }
      ]
    });

    const context = { damageType: 'physical', isCritical: true };
    applyEffectsForPhase(unit, EFFECT_PHASES.ON_DAMAGE_DEALT, context);

    assert.deepStrictEqual(receivedContext, context);
  });

  test('should handle handler that returns null', () => {
    registerEffectHandler('test_null_return', {
      phase: EFFECT_PHASES.BATTLE_START,
      apply: () => null
    });

    const unit = createMockPlayerUnit({
      traits: [
        { name: 'Null Trait', effectType: 'test_null_return', effectValue: 5 }
      ]
    });

    const result = applyEffectsForPhase(unit, EFFECT_PHASES.BATTLE_START);

    // Should not count null as modified
    assert.strictEqual(result.modified, false);
    assert.strictEqual(result.effects.length, 0);
  });

  test('should catch and log handler errors', () => {
    registerEffectHandler('test_error_handler', {
      phase: EFFECT_PHASES.BATTLE_START,
      apply: () => {
        throw new Error('Test error');
      }
    });

    const unit = createMockPlayerUnit({
      traits: [
        { name: 'Error Trait', effectType: 'test_error_handler', effectValue: 5 }
      ]
    });

    // Should not throw
    const result = applyEffectsForPhase(unit, EFFECT_PHASES.BATTLE_START);

    // Error should be caught, effect not applied
    assert.strictEqual(result.modified, false);
  });
});

// =============================================================================
// AGGREGATE MULTIPLIER TESTS
// =============================================================================

describe('getAggregateMultiplier', () => {
  test('should return 1.0 for unit with no traits', () => {
    const unit = createMockPlayerUnit({ traits: [] });

    const multiplier = getAggregateMultiplier(unit, EFFECT_PHASES.ON_DAMAGE_DEALT);

    assert.strictEqual(multiplier, 1.0);
  });

  test('should return 1.0 for unit with undefined traits', () => {
    const unit = createMockPlayerUnit({});
    delete unit.traits;

    const multiplier = getAggregateMultiplier(unit, EFFECT_PHASES.ON_DAMAGE_DEALT);

    assert.strictEqual(multiplier, 1.0);
  });

  test('should aggregate multipliers from traits', () => {
    registerEffectHandler('test_multiplier_trait', {
      phase: EFFECT_PHASES.ON_DAMAGE_DEALT,
      apply: (unit, value) => ({ multiplier: value / 100 })
    });

    const unit = createMockPlayerUnit({
      traits: [
        { name: 'Damage Bonus', effectType: 'test_multiplier_trait', effectValue: 10 }
      ]
    });

    const multiplier = getAggregateMultiplier(unit, EFFECT_PHASES.ON_DAMAGE_DEALT);

    // 1.0 + 0.1 = 1.1
    assert.strictEqual(multiplier, 1.1);
  });

  test('should aggregate multiple multipliers additively', () => {
    registerEffectHandler('test_multi_multiplier', {
      phase: EFFECT_PHASES.ON_DAMAGE_DEALT,
      apply: (unit, value) => ({ multiplier: value / 100 })
    });

    const unit = createMockPlayerUnit({
      traits: [
        { name: 'Bonus A', effectType: 'test_multi_multiplier', effectValue: 10 },
        { name: 'Bonus B', effectType: 'test_multi_multiplier', effectValue: 15 }
      ]
    });

    const multiplier = getAggregateMultiplier(unit, EFFECT_PHASES.ON_DAMAGE_DEALT);

    // 1.0 + 0.1 + 0.15 = 1.25
    assert.ok(Math.abs(multiplier - 1.25) < 0.001);
  });

  test('should ignore handlers that do not return multiplier', () => {
    registerEffectHandler('test_no_multiplier', {
      phase: EFFECT_PHASES.ON_DAMAGE_DEALT,
      apply: () => ({ type: 'no_multiplier' })
    });

    const unit = createMockPlayerUnit({
      traits: [
        { name: 'No Multiplier', effectType: 'test_no_multiplier', effectValue: 10 }
      ]
    });

    const multiplier = getAggregateMultiplier(unit, EFFECT_PHASES.ON_DAMAGE_DEALT);

    assert.strictEqual(multiplier, 1.0);
  });

  test('should pass context to handlers', () => {
    let receivedContext = null;

    registerEffectHandler('test_context_multiplier', {
      phase: EFFECT_PHASES.ON_DAMAGE_DEALT,
      apply: (unit, value, context) => {
        receivedContext = context;
        return { multiplier: 0.1 };
      }
    });

    const unit = createMockPlayerUnit({
      traits: [
        { name: 'Context Multiplier', effectType: 'test_context_multiplier', effectValue: 10 }
      ]
    });

    const context = { damageType: 'physical' };
    getAggregateMultiplier(unit, EFFECT_PHASES.ON_DAMAGE_DEALT, context);

    assert.deepStrictEqual(receivedContext, context);
  });

  test('should handle handler errors gracefully', () => {
    registerEffectHandler('test_error_multiplier', {
      phase: EFFECT_PHASES.ON_DAMAGE_DEALT,
      apply: () => {
        throw new Error('Multiplier error');
      }
    });

    const unit = createMockPlayerUnit({
      traits: [
        { name: 'Error Multiplier', effectType: 'test_error_multiplier', effectValue: 10 }
      ]
    });

    // Should not throw, should return base 1.0
    const multiplier = getAggregateMultiplier(unit, EFFECT_PHASES.ON_DAMAGE_DEALT);

    assert.strictEqual(multiplier, 1.0);
  });

  test('should only apply handlers for matching phase', () => {
    registerEffectHandler('test_wrong_phase_multiplier', {
      phase: EFFECT_PHASES.ON_KILL,
      apply: () => ({ multiplier: 0.5 })
    });

    const unit = createMockPlayerUnit({
      traits: [
        { name: 'Wrong Phase', effectType: 'test_wrong_phase_multiplier', effectValue: 10 }
      ]
    });

    const multiplier = getAggregateMultiplier(unit, EFFECT_PHASES.ON_DAMAGE_DEALT);

    // Should not apply the wrong phase handler
    assert.strictEqual(multiplier, 1.0);
  });

  test('should handle negative multipliers', () => {
    registerEffectHandler('test_negative_multiplier', {
      phase: EFFECT_PHASES.ON_DAMAGE_RECEIVED,
      apply: (unit, value) => ({ multiplier: -value / 100 }) // Damage reduction
    });

    const unit = createMockPlayerUnit({
      traits: [
        { name: 'Damage Reduction', effectType: 'test_negative_multiplier', effectValue: 20 }
      ]
    });

    const multiplier = getAggregateMultiplier(unit, EFFECT_PHASES.ON_DAMAGE_RECEIVED);

    // 1.0 + (-0.2) = 0.8
    assert.ok(Math.abs(multiplier - 0.8) < 0.001);
  });
});
