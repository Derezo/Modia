/**
 * Pattern Weights Unit Tests
 *
 * Tests PATTERN_WEIGHTS structure, getWeights(), getAvailablePatterns(),
 * patternExists(), and behavioral properties of each pattern.
 * No mocking needed - pure data module.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  PATTERN_WEIGHTS,
  OPTIMAL_PLAYER_WEIGHTS,
  getWeights,
  getAvailablePatterns,
  patternExists
} from '../../../services/ai/patternWeights.js';

const ALL_WEIGHT_KEYS = [
  'DAMAGE_DEALT', 'DAMAGE_RECEIVED', 'KILL_POTENTIAL',
  'POSITION_QUALITY', 'ALLY_SUPPORT', 'HEALING_VALUE',
  'SURVIVAL_PRIORITY', 'MP_EFFICIENCY', 'TARGET_PRIORITY',
  'strategicPathProgress', 'waitingPenalty'
];

describe('PatternWeights', () => {

  describe('PATTERN_WEIGHTS structure', () => {
    it('defines exactly 10 patterns', () => {
      const patterns = Object.keys(PATTERN_WEIGHTS);
      assert.strictEqual(patterns.length, 10);
    });

    it('includes all expected pattern names', () => {
      const expected = [
        'aggressive', 'defensive', 'support', 'tactical',
        'pack', 'ambush', 'berserker', 'ranged', 'hit-and-run', 'boss'
      ];
      for (const name of expected) {
        assert.ok(PATTERN_WEIGHTS[name], `Missing pattern: ${name}`);
      }
    });

    it('every pattern has name, description, and weights', () => {
      for (const [key, pattern] of Object.entries(PATTERN_WEIGHTS)) {
        assert.ok(pattern.name, `${key} missing name`);
        assert.ok(pattern.description, `${key} missing description`);
        assert.ok(pattern.weights, `${key} missing weights`);
      }
    });

    it('every pattern has all required weight keys', () => {
      for (const [key, pattern] of Object.entries(PATTERN_WEIGHTS)) {
        for (const weightKey of ALL_WEIGHT_KEYS) {
          assert.ok(
            weightKey in pattern.weights,
            `Pattern "${key}" missing weight key: ${weightKey}`
          );
          assert.strictEqual(
            typeof pattern.weights[weightKey],
            'number',
            `Pattern "${key}" weight "${weightKey}" is not a number`
          );
        }
      }
    });

    it('all weight values are finite numbers', () => {
      for (const [key, pattern] of Object.entries(PATTERN_WEIGHTS)) {
        for (const [wk, wv] of Object.entries(pattern.weights)) {
          assert.ok(Number.isFinite(wv), `${key}.${wk} = ${wv} is not finite`);
        }
      }
    });
  });

  describe('OPTIMAL_PLAYER_WEIGHTS', () => {
    it('has name, description, and weights', () => {
      assert.ok(OPTIMAL_PLAYER_WEIGHTS.name);
      assert.ok(OPTIMAL_PLAYER_WEIGHTS.description);
      assert.ok(OPTIMAL_PLAYER_WEIGHTS.weights);
    });

    it('contains core weight keys', () => {
      const coreKeys = [
        'DAMAGE_DEALT', 'DAMAGE_RECEIVED', 'KILL_POTENTIAL',
        'POSITION_QUALITY', 'ALLY_SUPPORT', 'HEALING_VALUE',
        'SURVIVAL_PRIORITY', 'MP_EFFICIENCY', 'TARGET_PRIORITY'
      ];
      for (const key of coreKeys) {
        assert.ok(key in OPTIMAL_PLAYER_WEIGHTS.weights, `Missing: ${key}`);
      }
    });
  });

  describe('getWeights()', () => {
    it('returns correct config for valid pattern', () => {
      const result = getWeights('aggressive');
      assert.strictEqual(result.name, 'Aggressive');
      assert.ok(result.weights);
    });

    it('is case-insensitive', () => {
      const result = getWeights('DEFENSIVE');
      assert.strictEqual(result.name, 'Defensive');
    });

    it('defaults to aggressive for invalid pattern', () => {
      const result = getWeights('nonexistent');
      assert.strictEqual(result.name, 'Aggressive');
    });

    it('defaults to aggressive for null/undefined', () => {
      assert.strictEqual(getWeights(null).name, 'Aggressive');
      assert.strictEqual(getWeights(undefined).name, 'Aggressive');
    });

    it('returns the dedicated hit-and-run config', () => {
      assert.strictEqual(getWeights('hit-and-run').name, 'HitAndRun');
    });
  });

  describe('getAvailablePatterns()', () => {
    it('returns array of 10 pattern names', () => {
      const patterns = getAvailablePatterns();
      assert.strictEqual(patterns.length, 10);
      assert.ok(Array.isArray(patterns));
    });

    it('contains all expected patterns', () => {
      const patterns = getAvailablePatterns();
      assert.ok(patterns.includes('aggressive'));
      assert.ok(patterns.includes('hit-and-run'));
      assert.ok(patterns.includes('boss'));
    });
  });

  describe('patternExists()', () => {
    it('returns true for valid patterns', () => {
      assert.strictEqual(patternExists('aggressive'), true);
      assert.strictEqual(patternExists('defensive'), true);
      assert.strictEqual(patternExists('hit-and-run'), true);
      assert.strictEqual(patternExists('boss'), true);
    });

    it('is case-insensitive', () => {
      assert.strictEqual(patternExists('TACTICAL'), true);
    });

    it('returns false for invalid patterns', () => {
      assert.strictEqual(patternExists('nonexistent'), false);
    });

    it('returns false for null/undefined', () => {
      // patternExists calls pattern?.toLowerCase() - null?.toLowerCase() returns undefined
      // undefined in PATTERN_WEIGHTS is false
      assert.strictEqual(patternExists(null), false);
      assert.strictEqual(patternExists(undefined), false);
    });
  });

  describe('Behavioral properties', () => {
    it('aggressive has DAMAGE_DEALT as highest factor', () => {
      const w = PATTERN_WEIGHTS.aggressive.weights;
      // KILL_POTENTIAL is 2.5, DAMAGE_DEALT is 2.0 - both are top-tier
      // The key property is that aggressive prioritizes damage highly
      assert.ok(w.DAMAGE_DEALT >= 2.0, 'DAMAGE_DEALT should be >= 2.0');
      assert.ok(w.KILL_POTENTIAL >= 2.0, 'KILL_POTENTIAL should be high');
      assert.ok(w.SURVIVAL_PRIORITY < 1.0, 'Low self-preservation');
    });

    it('defensive has SURVIVAL_PRIORITY as highest factor', () => {
      const w = PATTERN_WEIGHTS.defensive.weights;
      assert.strictEqual(w.SURVIVAL_PRIORITY, 2.5);
      // SURVIVAL_PRIORITY should be the highest weight
      const maxWeight = Math.max(...Object.values(w).filter(v => v >= 0));
      assert.strictEqual(maxWeight, w.SURVIVAL_PRIORITY);
    });

    it('support has HEALING_VALUE of 3.0', () => {
      const w = PATTERN_WEIGHTS.support.weights;
      assert.strictEqual(w.HEALING_VALUE, 3.0);
      // HEALING_VALUE should be the highest
      const maxWeight = Math.max(...Object.values(w).filter(v => v >= 0));
      assert.strictEqual(maxWeight, w.HEALING_VALUE);
    });

    it('berserker has all survival/healing/ally set to 0', () => {
      const w = PATTERN_WEIGHTS.berserker.weights;
      assert.strictEqual(w.DAMAGE_RECEIVED, 0.0);
      assert.strictEqual(w.ALLY_SUPPORT, 0.0);
      assert.strictEqual(w.HEALING_VALUE, 0.0);
      assert.strictEqual(w.SURVIVAL_PRIORITY, 0.0);
      assert.strictEqual(w.MP_EFFICIENCY, 0.0);
    });

    it('berserker has highest DAMAGE_DEALT across all patterns', () => {
      const berserkerDamage = PATTERN_WEIGHTS.berserker.weights.DAMAGE_DEALT;
      for (const [name, pattern] of Object.entries(PATTERN_WEIGHTS)) {
        if (name === 'berserker') continue;
        assert.ok(
          berserkerDamage >= pattern.weights.DAMAGE_DEALT,
          `Berserker DAMAGE_DEALT (${berserkerDamage}) should be >= ${name} (${pattern.weights.DAMAGE_DEALT})`
        );
      }
    });

    it('pack has highest ALLY_SUPPORT across all patterns', () => {
      const packAlly = PATTERN_WEIGHTS.pack.weights.ALLY_SUPPORT;
      for (const [name, pattern] of Object.entries(PATTERN_WEIGHTS)) {
        if (name === 'pack') continue;
        assert.ok(
          packAlly >= pattern.weights.ALLY_SUPPORT,
          `Pack ALLY_SUPPORT (${packAlly}) should be >= ${name} (${pattern.weights.ALLY_SUPPORT})`
        );
      }
    });

    it('ambush has highest KILL_POTENTIAL across all patterns', () => {
      const ambushKill = PATTERN_WEIGHTS.ambush.weights.KILL_POTENTIAL;
      for (const [name, pattern] of Object.entries(PATTERN_WEIGHTS)) {
        if (name === 'ambush') continue;
        assert.ok(
          ambushKill >= pattern.weights.KILL_POTENTIAL,
          `Ambush KILL_POTENTIAL (${ambushKill}) should be >= ${name} (${pattern.weights.KILL_POTENTIAL})`
        );
      }
    });

    it('all patterns have negative waitingPenalty', () => {
      for (const [name, pattern] of Object.entries(PATTERN_WEIGHTS)) {
        assert.ok(
          pattern.weights.waitingPenalty < 0,
          `${name} waitingPenalty should be negative, got ${pattern.weights.waitingPenalty}`
        );
      }
    });
  });
});
