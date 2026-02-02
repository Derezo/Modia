/**
 * Icon Categories Unit Tests
 *
 * Tests for the icon category configuration module that provides
 * prefix mapping and ID normalization for icon assets.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ICON_PREFIX_MAP,
  ICON_SUBCATEGORIES,
  prefixIconId,
  normalizeIconId
} from './iconCategories.js';

// =============================================================================
// Constants Tests
// =============================================================================

describe('iconCategories constants', () => {
  describe('ICON_PREFIX_MAP', () => {
    it('should have prefix for actions subcategory', () => {
      assert.strictEqual(ICON_PREFIX_MAP.actions, 'action_');
    });

    it('should have prefix for status subcategory', () => {
      assert.strictEqual(ICON_PREFIX_MAP.status, 'status_');
    });

    it('should have prefix for augments subcategory', () => {
      assert.strictEqual(ICON_PREFIX_MAP.augments, 'augment_');
    });

    it('should have prefix for menu subcategory', () => {
      assert.strictEqual(ICON_PREFIX_MAP.menu, 'menu_');
    });

    it('should have prefix for resources subcategory', () => {
      assert.strictEqual(ICON_PREFIX_MAP.resources, 'resource_');
    });

    it('should have prefix for zodiac subcategory', () => {
      assert.strictEqual(ICON_PREFIX_MAP.zodiac, 'zodiac_');
    });

    it('should have exactly 6 subcategories defined', () => {
      const keys = Object.keys(ICON_PREFIX_MAP);
      assert.strictEqual(keys.length, 6);
    });

    it('should have unique prefixes for each subcategory', () => {
      const prefixes = Object.values(ICON_PREFIX_MAP);
      const uniquePrefixes = new Set(prefixes);
      assert.strictEqual(prefixes.length, uniquePrefixes.size, 'All prefixes should be unique');
    });

    it('should have prefixes ending with underscore', () => {
      for (const [subcategory, prefix] of Object.entries(ICON_PREFIX_MAP)) {
        assert.ok(prefix.endsWith('_'), `${subcategory} prefix "${prefix}" should end with underscore`);
      }
    });
  });

  describe('ICON_SUBCATEGORIES', () => {
    it('should contain all expected subcategories', () => {
      const expected = ['actions', 'augments', 'status', 'menu', 'resources', 'zodiac'];
      for (const subcategory of expected) {
        assert.ok(ICON_SUBCATEGORIES.includes(subcategory), `Should include ${subcategory}`);
      }
    });

    it('should match keys of ICON_PREFIX_MAP', () => {
      const prefixMapKeys = Object.keys(ICON_PREFIX_MAP).sort();
      const subcategories = [...ICON_SUBCATEGORIES].sort();
      assert.deepStrictEqual(subcategories, prefixMapKeys);
    });

    it('should be an array', () => {
      assert.ok(Array.isArray(ICON_SUBCATEGORIES));
    });

    it('should have exactly 6 subcategories', () => {
      assert.strictEqual(ICON_SUBCATEGORIES.length, 6);
    });
  });
});

// =============================================================================
// prefixIconId Tests
// =============================================================================

describe('prefixIconId', () => {
  describe('adds correct prefix for each subcategory', () => {
    it('should add action_ prefix for actions subcategory', () => {
      const result = prefixIconId('attack', 'actions');
      assert.strictEqual(result, 'action_attack');
    });

    it('should add status_ prefix for status subcategory', () => {
      const result = prefixIconId('poison', 'status');
      assert.strictEqual(result, 'status_poison');
    });

    it('should add augment_ prefix for augments subcategory', () => {
      const result = prefixIconId('power_up', 'augments');
      assert.strictEqual(result, 'augment_power_up');
    });

    it('should add menu_ prefix for menu subcategory', () => {
      const result = prefixIconId('inventory', 'menu');
      assert.strictEqual(result, 'menu_inventory');
    });

    it('should add resource_ prefix for resources subcategory', () => {
      const result = prefixIconId('gold', 'resources');
      assert.strictEqual(result, 'resource_gold');
    });

    it('should add zodiac_ prefix for zodiac subcategory', () => {
      const result = prefixIconId('aries', 'zodiac');
      assert.strictEqual(result, 'zodiac_aries');
    });
  });

  describe('does not double-prefix already prefixed IDs', () => {
    it('should not double-prefix action_ IDs', () => {
      const result = prefixIconId('action_attack', 'actions');
      assert.strictEqual(result, 'action_attack');
    });

    it('should not double-prefix status_ IDs', () => {
      const result = prefixIconId('status_poison', 'status');
      assert.strictEqual(result, 'status_poison');
    });

    it('should not double-prefix augment_ IDs', () => {
      const result = prefixIconId('augment_power_up', 'augments');
      assert.strictEqual(result, 'augment_power_up');
    });

    it('should not double-prefix menu_ IDs', () => {
      const result = prefixIconId('menu_inventory', 'menu');
      assert.strictEqual(result, 'menu_inventory');
    });

    it('should not double-prefix resource_ IDs', () => {
      const result = prefixIconId('resource_gold', 'resources');
      assert.strictEqual(result, 'resource_gold');
    });

    it('should not double-prefix zodiac_ IDs', () => {
      const result = prefixIconId('zodiac_aries', 'zodiac');
      assert.strictEqual(result, 'zodiac_aries');
    });
  });

  describe('returns ID unchanged for unknown subcategory', () => {
    it('should return ID unchanged for unknown subcategory', () => {
      const result = prefixIconId('some_icon', 'unknown');
      assert.strictEqual(result, 'some_icon');
    });

    it('should return ID unchanged for undefined subcategory', () => {
      const result = prefixIconId('some_icon', undefined);
      assert.strictEqual(result, 'some_icon');
    });

    it('should return ID unchanged for null subcategory', () => {
      const result = prefixIconId('some_icon', null);
      assert.strictEqual(result, 'some_icon');
    });

    it('should return ID unchanged for empty string subcategory', () => {
      const result = prefixIconId('some_icon', '');
      assert.strictEqual(result, 'some_icon');
    });
  });

  describe('edge cases', () => {
    it('should handle IDs with underscores in the name', () => {
      const result = prefixIconId('sword_slash_critical', 'actions');
      assert.strictEqual(result, 'action_sword_slash_critical');
    });

    it('should handle single-character IDs', () => {
      const result = prefixIconId('x', 'actions');
      assert.strictEqual(result, 'action_x');
    });

    it('should handle empty ID', () => {
      const result = prefixIconId('', 'actions');
      assert.strictEqual(result, 'action_');
    });

    it('should handle ID that starts with but is not equal to prefix', () => {
      // 'action' starts with 'action_' is false, so it should get prefixed
      const result = prefixIconId('action', 'actions');
      assert.strictEqual(result, 'action_action');
    });

    it('should not prefix if ID starts with a different prefix', () => {
      // If someone passes a status_ prefixed ID to actions subcategory
      // The function only checks for the matching prefix, so it will add action_
      const result = prefixIconId('status_burn', 'actions');
      assert.strictEqual(result, 'action_status_burn');
    });
  });
});

// =============================================================================
// normalizeIconId Tests
// =============================================================================

describe('normalizeIconId', () => {
  describe('returns ID unchanged (identity function)', () => {
    it('should return unprefixed ID unchanged', () => {
      const result = normalizeIconId('attack', 'actions');
      assert.strictEqual(result, 'attack');
    });

    it('should return prefixed ID unchanged', () => {
      // Post-cleanup: normalizeIconId is now an identity function
      const result = normalizeIconId('action_attack', 'actions');
      assert.strictEqual(result, 'action_attack');
    });

    it('should return ID unchanged regardless of subcategory', () => {
      const testId = 'test_icon';
      assert.strictEqual(normalizeIconId(testId, 'actions'), testId);
      assert.strictEqual(normalizeIconId(testId, 'status'), testId);
      assert.strictEqual(normalizeIconId(testId, 'augments'), testId);
      assert.strictEqual(normalizeIconId(testId, 'menu'), testId);
      assert.strictEqual(normalizeIconId(testId, 'resources'), testId);
      assert.strictEqual(normalizeIconId(testId, 'zodiac'), testId);
    });

    it('should return ID unchanged for unknown subcategory', () => {
      const result = normalizeIconId('some_icon', 'unknown');
      assert.strictEqual(result, 'some_icon');
    });

    it('should return ID unchanged for undefined subcategory', () => {
      const result = normalizeIconId('some_icon', undefined);
      assert.strictEqual(result, 'some_icon');
    });

    it('should return ID unchanged for null subcategory', () => {
      const result = normalizeIconId('some_icon', null);
      assert.strictEqual(result, 'some_icon');
    });
  });

  describe('edge cases', () => {
    it('should handle empty ID', () => {
      const result = normalizeIconId('', 'actions');
      assert.strictEqual(result, '');
    });

    it('should handle IDs with multiple underscores', () => {
      const result = normalizeIconId('sword_slash_critical_hit', 'actions');
      assert.strictEqual(result, 'sword_slash_critical_hit');
    });

    it('should handle numeric IDs', () => {
      const result = normalizeIconId('icon_123', 'actions');
      assert.strictEqual(result, 'icon_123');
    });
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('prefixIconId and normalizeIconId integration', () => {
  it('prefixIconId should be reversible with manual prefix stripping', () => {
    const original = 'attack';
    const prefixed = prefixIconId(original, 'actions');
    const stripped = prefixed.replace(/^action_/, '');
    assert.strictEqual(stripped, original);
  });

  it('should handle round-trip through prefix then normalize', () => {
    // Since normalize is now identity, the prefixed value stays prefixed
    const original = 'poison';
    const prefixed = prefixIconId(original, 'status');
    const normalized = normalizeIconId(prefixed, 'status');
    assert.strictEqual(prefixed, 'status_poison');
    assert.strictEqual(normalized, 'status_poison'); // Identity function
  });

  it('ICON_SUBCATEGORIES should provide valid keys for prefixIconId', () => {
    for (const subcategory of ICON_SUBCATEGORIES) {
      const result = prefixIconId('test', subcategory);
      const expectedPrefix = ICON_PREFIX_MAP[subcategory];
      assert.ok(result.startsWith(expectedPrefix),
        `prefixIconId with ${subcategory} should add ${expectedPrefix} prefix`);
    }
  });
});
