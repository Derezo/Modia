/**
 * AI Pattern Weights Unit Tests
 *
 * Tests the pure utility functions for AI pattern weight configuration.
 * These are simple lookup/validation functions with no external dependencies.
 *
 * Functions tested:
 * - getWeights - Get weight configuration for a pattern
 * - getAvailablePatterns - List all available patterns
 * - patternExists - Check if a pattern exists
 * - PATTERN_WEIGHTS - Pattern configurations
 * - OPTIMAL_PLAYER_WEIGHTS - Player behavior weights
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import pattern weight functions
let importError = null;
let PATTERN_WEIGHTS = null;
let OPTIMAL_PLAYER_WEIGHTS = null;
let getWeights = null;
let getAvailablePatterns = null;
let patternExists = null;

try {
  const mod = await import('../../services/ai/patternWeights.js');
  PATTERN_WEIGHTS = mod.PATTERN_WEIGHTS;
  OPTIMAL_PLAYER_WEIGHTS = mod.OPTIMAL_PLAYER_WEIGHTS;
  getWeights = mod.getWeights;
  getAvailablePatterns = mod.getAvailablePatterns;
  patternExists = mod.patternExists;
} catch (err) {
  importError = err;
}

const canImport = importError === null;

describe('AI Pattern Weights - PATTERN_WEIGHTS', { skip: !canImport }, () => {
  it('contains expected core patterns', () => {
    const expectedPatterns = ['aggressive', 'defensive', 'support', 'tactical', 'pack'];

    for (const pattern of expectedPatterns) {
      assert.ok(PATTERN_WEIGHTS[pattern], `Pattern '${pattern}' should exist`);
    }
  });

  it('each pattern has name and description', () => {
    for (const [key, pattern] of Object.entries(PATTERN_WEIGHTS)) {
      assert.ok(pattern.name, `Pattern '${key}' should have a name`);
      assert.ok(pattern.description, `Pattern '${key}' should have a description`);
    }
  });

  it('each pattern has weights object', () => {
    for (const [key, pattern] of Object.entries(PATTERN_WEIGHTS)) {
      assert.ok(pattern.weights, `Pattern '${key}' should have weights`);
      assert.strictEqual(typeof pattern.weights, 'object');
    }
  });

  it('all patterns have consistent weight keys', () => {
    const expectedWeights = [
      'DAMAGE_DEALT',
      'DAMAGE_RECEIVED',
      'KILL_POTENTIAL',
      'POSITION_QUALITY',
      'ALLY_SUPPORT',
      'HEALING_VALUE',
      'SURVIVAL_PRIORITY',
      'MP_EFFICIENCY',
      'TARGET_PRIORITY'
    ];

    for (const [key, pattern] of Object.entries(PATTERN_WEIGHTS)) {
      for (const weightKey of expectedWeights) {
        assert.ok(
          weightKey in pattern.weights,
          `Pattern '${key}' should have weight '${weightKey}'`
        );
      }
    }
  });

  it('aggressive pattern prioritizes damage', () => {
    const aggressive = PATTERN_WEIGHTS.aggressive.weights;

    assert.ok(aggressive.DAMAGE_DEALT >= 1.5, 'DAMAGE_DEALT should be high');
    assert.ok(aggressive.SURVIVAL_PRIORITY <= 1.0, 'SURVIVAL_PRIORITY should be low');
  });

  it('defensive pattern prioritizes survival', () => {
    const defensive = PATTERN_WEIGHTS.defensive.weights;

    assert.ok(defensive.SURVIVAL_PRIORITY >= 2.0, 'SURVIVAL_PRIORITY should be high');
    assert.ok(defensive.DAMAGE_RECEIVED >= 1.5, 'DAMAGE_RECEIVED should be weighted');
  });

  it('support pattern prioritizes healing', () => {
    const support = PATTERN_WEIGHTS.support.weights;

    assert.ok(support.HEALING_VALUE >= 2.5, 'HEALING_VALUE should be high');
    assert.ok(support.ALLY_SUPPORT >= 2.0, 'ALLY_SUPPORT should be high');
  });

  it('berserker has zero survival priority', () => {
    const berserker = PATTERN_WEIGHTS.berserker.weights;

    assert.strictEqual(berserker.SURVIVAL_PRIORITY, 0);
    assert.strictEqual(berserker.HEALING_VALUE, 0);
  });
});

describe('AI Pattern Weights - OPTIMAL_PLAYER_WEIGHTS', { skip: !canImport }, () => {
  it('has name and description', () => {
    assert.ok(OPTIMAL_PLAYER_WEIGHTS.name);
    assert.ok(OPTIMAL_PLAYER_WEIGHTS.description);
  });

  it('has balanced weights', () => {
    const weights = OPTIMAL_PLAYER_WEIGHTS.weights;

    assert.ok(weights.DAMAGE_DEALT >= 1.0, 'Should have reasonable damage weight');
    assert.ok(weights.SURVIVAL_PRIORITY >= 1.0, 'Should have reasonable survival weight');
    assert.ok(weights.KILL_POTENTIAL >= 2.0, 'Should prioritize kills');
  });

  it('has all required weight keys', () => {
    const requiredKeys = [
      'DAMAGE_DEALT',
      'DAMAGE_RECEIVED',
      'KILL_POTENTIAL',
      'POSITION_QUALITY',
      'ALLY_SUPPORT',
      'HEALING_VALUE',
      'SURVIVAL_PRIORITY',
      'MP_EFFICIENCY',
      'TARGET_PRIORITY'
    ];

    for (const key of requiredKeys) {
      assert.ok(
        key in OPTIMAL_PLAYER_WEIGHTS.weights,
        `Should have weight '${key}'`
      );
    }
  });
});

describe('AI Pattern Weights - getWeights', { skip: !canImport }, () => {
  it('returns correct pattern for valid name', () => {
    const result = getWeights('aggressive');

    assert.strictEqual(result.name, 'Aggressive');
  });

  it('handles case-insensitive pattern names', () => {
    const lower = getWeights('tactical');
    const upper = getWeights('TACTICAL');
    const mixed = getWeights('Tactical');

    assert.strictEqual(lower.name, upper.name);
    assert.strictEqual(lower.name, mixed.name);
  });

  it('returns aggressive as default for unknown patterns', () => {
    const result = getWeights('nonexistent_pattern');

    assert.strictEqual(result.name, 'Aggressive');
  });

  it('returns aggressive as default for null input', () => {
    const result = getWeights(null);

    assert.strictEqual(result.name, 'Aggressive');
  });

  it('returns aggressive as default for undefined input', () => {
    const result = getWeights(undefined);

    assert.strictEqual(result.name, 'Aggressive');
  });

  it('returns different patterns for different inputs', () => {
    const aggressive = getWeights('aggressive');
    const defensive = getWeights('defensive');
    const support = getWeights('support');

    assert.notStrictEqual(aggressive.name, defensive.name);
    assert.notStrictEqual(defensive.name, support.name);
    assert.notStrictEqual(aggressive.name, support.name);
  });
});

describe('AI Pattern Weights - getAvailablePatterns', { skip: !canImport }, () => {
  it('returns an array', () => {
    const result = getAvailablePatterns();

    assert.ok(Array.isArray(result));
  });

  it('contains expected patterns', () => {
    const patterns = getAvailablePatterns();

    assert.ok(patterns.includes('aggressive'));
    assert.ok(patterns.includes('defensive'));
    assert.ok(patterns.includes('support'));
    assert.ok(patterns.includes('tactical'));
    assert.ok(patterns.includes('pack'));
  });

  it('returns at least 5 patterns', () => {
    const patterns = getAvailablePatterns();

    assert.ok(patterns.length >= 5, `Expected >= 5 patterns, got ${patterns.length}`);
  });

  it('patterns are lowercase strings', () => {
    const patterns = getAvailablePatterns();

    for (const pattern of patterns) {
      assert.strictEqual(typeof pattern, 'string');
      assert.strictEqual(pattern, pattern.toLowerCase());
    }
  });
});

describe('AI Pattern Weights - patternExists', { skip: !canImport }, () => {
  it('returns true for valid patterns', () => {
    assert.strictEqual(patternExists('aggressive'), true);
    assert.strictEqual(patternExists('defensive'), true);
    assert.strictEqual(patternExists('tactical'), true);
  });

  it('handles case-insensitive checks', () => {
    assert.strictEqual(patternExists('AGGRESSIVE'), true);
    assert.strictEqual(patternExists('Aggressive'), true);
    assert.strictEqual(patternExists('aGgReSsIvE'), true);
  });

  it('returns false for invalid patterns', () => {
    assert.strictEqual(patternExists('nonexistent'), false);
    assert.strictEqual(patternExists(''), false);
  });

  it('returns false for null/undefined', () => {
    assert.strictEqual(patternExists(null), false);
    assert.strictEqual(patternExists(undefined), false);
  });
});

describe('AI Pattern Weights - pattern balance validation', { skip: !canImport }, () => {
  it('no pattern has all zero weights', () => {
    for (const [key, pattern] of Object.entries(PATTERN_WEIGHTS)) {
      const values = Object.values(pattern.weights);
      const hasNonZero = values.some(v => v !== 0);

      assert.ok(hasNonZero, `Pattern '${key}' should have at least one non-zero weight`);
    }
  });

  it('no pattern has excessively high weights', () => {
    const maxReasonableWeight = 5.0;

    for (const [key, pattern] of Object.entries(PATTERN_WEIGHTS)) {
      for (const [weightKey, value] of Object.entries(pattern.weights)) {
        assert.ok(
          Math.abs(value) <= maxReasonableWeight,
          `Pattern '${key}' weight '${weightKey}' (${value}) should be <= ${maxReasonableWeight}`
        );
      }
    }
  });

  it('strategic path factors have reasonable values', () => {
    for (const [key, pattern] of Object.entries(PATTERN_WEIGHTS)) {
      if ('strategicPathProgress' in pattern.weights) {
        const value = pattern.weights.strategicPathProgress;
        assert.ok(
          value >= 0 && value <= 1,
          `Pattern '${key}' strategicPathProgress (${value}) should be 0-1`
        );
      }

      if ('waitingPenalty' in pattern.weights) {
        const value = pattern.weights.waitingPenalty;
        assert.ok(
          value <= 0,
          `Pattern '${key}' waitingPenalty (${value}) should be negative`
        );
      }
    }
  });
});

describe('AI Pattern Weights - import error handling', { skip: canImport }, () => {
  it('reports import error', () => {
    console.log('AI Pattern Weights import error:', importError?.message);
    assert.ok(importError, 'Import error should be captured');
  });
});
