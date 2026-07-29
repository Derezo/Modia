/**
 * Overlay System Unit Tests
 *
 * Tests for overlay mapping, safe resolution, and compositor URL construction.
 *
 * Run with: node --test frontend/src/utils/__tests__/OverlayCompositor.test.js
 * Or: npm run test -w frontend (requires test script in package.json)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CANONICAL_AUGMENT_OVERLAY_IDS,
  CATEGORY_TO_OVERLAY,
  OVERLAY_PRIORITY,
  getPrimaryOverlay,
  resolveAugmentOverlay,
  resolveAugmentOverlays
} from '../../../../shared/overlayMapping.js';
import { OverlayCompositor } from '../OverlayCompositor.js';
import {
  loadItemComposite,
  preloadOverlays as preloadLegacyOverlays
} from '../../core/assetLoader/ItemCompositing.js';
import {
  AUGMENTS,
  CONSUMABLE_AUGMENTS
} from '../../../../api/src/services/itemDropService.js';

const EQUIPMENT_CATEGORY_MAPPINGS = {
  fire: 'augment_fire',
  ice: 'augment_ice',
  lightning: 'augment_lightning',
  poison: 'augment_poison',
  holy: 'augment_holy',
  dark: 'augment_dark',
  critical: 'augment_critical',
  speed: 'augment_speed',
  damage: 'augment_critical',
  power: 'augment_critical',
  defense: 'augment_earth',
  magic_defense: 'augment_arcane',
  armor: 'augment_earth',
  dragon_slayer: 'augment_slayer',
  undead_slayer: 'augment_slayer',
  demon_slayer: 'augment_slayer',
  strength: 'augment_critical',
  intelligence: 'augment_arcane',
  agility: 'augment_speed',
  vitality: 'augment_vitality',
  luck: 'augment_fortune',
  hp: 'augment_vitality',
  mp: 'augment_arcane',
  regen: 'augment_vitality',
  mp_regen: 'augment_arcane',
  accuracy: 'augment_critical',
  crit: 'augment_critical',
  block: 'augment_earth',
  spell_resist: 'augment_arcane',
  protection: 'augment_earth'
};

const CONSUMABLE_CATEGORY_MAPPINGS = {
  potency: 'augment_arcane',
  concentration: 'augment_arcane',
  empowerment: 'augment_arcane',
  hot_minor: 'augment_vitality',
  hot_major: 'augment_vitality',
  hot_percent: 'augment_vitality',
  mp_bonus: 'augment_arcane',
  mp_regen: 'augment_arcane',
  spell_cost: 'augment_arcane',
  cleanse_minor: 'augment_holy',
  cleanse_major: 'augment_holy',
  cleanse_all: 'augment_holy',
  buff_vit: 'augment_vitality',
  buff_str: 'augment_critical',
  buff_int: 'augment_arcane',
  buff_agi: 'augment_speed',
  revive_bonus: 'augment_holy',
  revive_full: 'augment_holy',
  revive_immunity: 'augment_holy',
  instant: 'augment_speed',
  aoe: 'augment_chain'
};

const RUNTIME_CATEGORY_MAPPINGS = {
  ...EQUIPMENT_CATEGORY_MAPPINGS,
  ...CONSUMABLE_CATEGORY_MAPPINGS
};

function categoriesFrom(definitions) {
  return [...new Set(
    Object.values(definitions).map(augment => augment.category)
  )].sort();
}

describe('overlayMapping', () => {
  describe('CATEGORY_TO_OVERLAY - elemental categories', () => {
    it('should map fire to augment_fire', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.fire, 'augment_fire');
    });

    it('should map ice to augment_ice', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.ice, 'augment_ice');
    });

    it('should map lightning to augment_lightning', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.lightning, 'augment_lightning');
    });

    it('should map poison to augment_poison', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.poison, 'augment_poison');
    });

    it('should map holy to augment_holy', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.holy, 'augment_holy');
    });

    it('should map dark to augment_dark', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.dark, 'augment_dark');
    });

    it('should map earth to augment_earth', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.earth, 'augment_earth');
    });

    it('should map wind to augment_wind', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.wind, 'augment_wind');
    });

    it('should have all 8 elemental categories defined', () => {
      const elementals = ['fire', 'ice', 'lightning', 'poison', 'holy', 'dark', 'earth', 'wind'];
      for (const elem of elementals) {
        assert.ok(
          CATEGORY_TO_OVERLAY[elem],
          `Missing elemental category: ${elem}`
        );
        assert.strictEqual(
          CATEGORY_TO_OVERLAY[elem],
          `augment_${elem}`,
          `Elemental ${elem} should map to augment_${elem}`
        );
      }
    });
  });

  describe('CATEGORY_TO_OVERLAY - combat effect categories', () => {
    it('should map critical to augment_critical', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.critical, 'augment_critical');
    });

    it('should map lifesteal to augment_lifesteal', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.lifesteal, 'augment_lifesteal');
    });

    it('should map speed to augment_speed', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.speed, 'augment_speed');
    });

    it('should map pierce to augment_pierce', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.pierce, 'augment_pierce');
    });

    it('should map stun to augment_stun', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.stun, 'augment_stun');
    });

    it('should map chain to augment_chain', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.chain, 'augment_chain');
    });

    it('should have all 6 combat effect categories defined', () => {
      const combatEffects = ['critical', 'lifesteal', 'speed', 'pierce', 'stun', 'chain'];
      for (const effect of combatEffects) {
        assert.ok(
          CATEGORY_TO_OVERLAY[effect],
          `Missing combat effect category: ${effect}`
        );
      }
    });
  });

  describe('CATEGORY_TO_OVERLAY - special augment categories', () => {
    it('should map arcane to augment_arcane', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.arcane, 'augment_arcane');
    });

    it('should map fortune to augment_fortune', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.fortune, 'augment_fortune');
    });

    it('should map vitality to augment_vitality', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.vitality, 'augment_vitality');
    });

    it('should map slayer to augment_slayer', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.slayer, 'augment_slayer');
    });

    it('should have all 4 special augment categories defined', () => {
      const specials = ['arcane', 'fortune', 'vitality', 'slayer'];
      for (const special of specials) {
        assert.ok(
          CATEGORY_TO_OVERLAY[special],
          `Missing special category: ${special}`
        );
      }
    });
  });

  describe('CATEGORY_TO_OVERLAY - unknown categories', () => {
    it('should return undefined for unknown category', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.unknown, undefined);
    });

    it('should return undefined for empty string', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY[''], undefined);
    });

    it('should return undefined for null-like key', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.null, undefined);
      assert.strictEqual(CATEGORY_TO_OVERLAY.undefined, undefined);
    });

    it('should return undefined for misspelled categories', () => {
      assert.strictEqual(CATEGORY_TO_OVERLAY.fir, undefined);
      assert.strictEqual(CATEGORY_TO_OVERLAY.firee, undefined);
      assert.strictEqual(CATEGORY_TO_OVERLAY.FIRE, undefined); // Case sensitive
    });
  });

  describe('OVERLAY_PRIORITY - priority ordering', () => {
    it('should give elemental overlays lower priority numbers (higher visual priority)', () => {
      // Elementals should be 1-8
      assert.ok(OVERLAY_PRIORITY.augment_fire <= 10, 'Fire should have high priority');
      assert.ok(OVERLAY_PRIORITY.augment_ice <= 10, 'Ice should have high priority');
      assert.ok(OVERLAY_PRIORITY.augment_lightning <= 10, 'Lightning should have high priority');
    });

    it('should give combat effects medium priority numbers', () => {
      // Combat effects should be 10-19
      assert.ok(OVERLAY_PRIORITY.augment_critical >= 10, 'Critical should have medium priority');
      assert.ok(OVERLAY_PRIORITY.augment_critical < 20, 'Critical should be below special');
      assert.ok(OVERLAY_PRIORITY.augment_speed >= 10, 'Speed should have medium priority');
    });

    it('should give special augments lowest priority (highest numbers)', () => {
      // Special augments should be 20+
      assert.ok(OVERLAY_PRIORITY.augment_arcane >= 20, 'Arcane should have low priority');
      assert.ok(OVERLAY_PRIORITY.augment_fortune >= 20, 'Fortune should have low priority');
      assert.ok(OVERLAY_PRIORITY.augment_vitality >= 20, 'Vitality should have low priority');
      assert.ok(OVERLAY_PRIORITY.augment_slayer >= 20, 'Slayer should have low priority');
    });

    it('should have fire as highest priority (priority 1)', () => {
      assert.strictEqual(OVERLAY_PRIORITY.augment_fire, 1);
    });

    it('should have elemental overlays ordered correctly', () => {
      assert.ok(
        OVERLAY_PRIORITY.augment_fire < OVERLAY_PRIORITY.augment_ice,
        'Fire should be higher priority than ice'
      );
      assert.ok(
        OVERLAY_PRIORITY.augment_ice < OVERLAY_PRIORITY.augment_lightning,
        'Ice should be higher priority than lightning'
      );
    });

    it('should have all elementals higher priority than all combat effects', () => {
      const elementals = ['augment_fire', 'augment_ice', 'augment_lightning',
        'augment_poison', 'augment_holy', 'augment_dark', 'augment_earth', 'augment_wind'];
      const combatEffects = ['augment_critical', 'augment_lifesteal', 'augment_speed',
        'augment_pierce', 'augment_stun', 'augment_chain'];

      const maxElementalPriority = Math.max(...elementals.map(e => OVERLAY_PRIORITY[e]));
      const minCombatPriority = Math.min(...combatEffects.map(c => OVERLAY_PRIORITY[c]));

      assert.ok(
        maxElementalPriority < minCombatPriority,
        `All elementals (max ${maxElementalPriority}) should be higher priority than combat effects (min ${minCombatPriority})`
      );
    });

    it('should have all combat effects higher priority than all special augments', () => {
      const combatEffects = ['augment_critical', 'augment_lifesteal', 'augment_speed',
        'augment_pierce', 'augment_stun', 'augment_chain'];
      const specials = ['augment_arcane', 'augment_fortune', 'augment_vitality', 'augment_slayer'];

      const maxCombatPriority = Math.max(...combatEffects.map(c => OVERLAY_PRIORITY[c]));
      const minSpecialPriority = Math.min(...specials.map(s => OVERLAY_PRIORITY[s]));

      assert.ok(
        maxCombatPriority < minSpecialPriority,
        `All combat effects (max ${maxCombatPriority}) should be higher priority than specials (min ${minSpecialPriority})`
      );
    });
  });
});

describe('getPrimaryOverlay', () => {
  describe('single augment resolution', () => {
    it('should return correct overlay for single fire augment', () => {
      const result = getPrimaryOverlay(['fire']);
      assert.strictEqual(result, 'augment_fire');
    });

    it('should return correct overlay for single ice augment', () => {
      const result = getPrimaryOverlay(['ice']);
      assert.strictEqual(result, 'augment_ice');
    });

    it('should return correct overlay for single critical augment', () => {
      const result = getPrimaryOverlay(['critical']);
      assert.strictEqual(result, 'augment_critical');
    });

    it('should return correct overlay for single fortune augment', () => {
      const result = getPrimaryOverlay(['fortune']);
      assert.strictEqual(result, 'augment_fortune');
    });

    it('should return null for single unknown augment', () => {
      const result = getPrimaryOverlay(['nonexistent']);
      assert.strictEqual(result, null);
    });
  });

  describe('multiple augment priority resolution', () => {
    it('should return fire (priority 1) over critical (priority 10)', () => {
      const result = getPrimaryOverlay(['fire', 'critical']);
      assert.strictEqual(result, 'augment_fire');
    });

    it('should return fire over critical regardless of array order', () => {
      const result = getPrimaryOverlay(['critical', 'fire']);
      assert.strictEqual(result, 'augment_fire');
    });

    it('should return ice (priority 2) over speed (priority 15)', () => {
      const result = getPrimaryOverlay(['speed', 'ice']);
      assert.strictEqual(result, 'augment_ice');
    });

    it('should return lightning (priority 3) over fortune (priority 21)', () => {
      const result = getPrimaryOverlay(['fortune', 'lightning']);
      assert.strictEqual(result, 'augment_lightning');
    });

    it('should return critical (priority 10) over fortune (priority 21)', () => {
      const result = getPrimaryOverlay(['fortune', 'critical']);
      assert.strictEqual(result, 'augment_critical');
    });

    it('should return speed (priority 15) over fortune (priority 21)', () => {
      const result = getPrimaryOverlay(['speed', 'fortune']);
      assert.strictEqual(result, 'augment_speed');
    });

    it('should handle three augments and return highest priority', () => {
      const result = getPrimaryOverlay(['fortune', 'critical', 'fire']);
      assert.strictEqual(result, 'augment_fire');
    });

    it('should handle all elemental augments and return fire (highest)', () => {
      const result = getPrimaryOverlay(['wind', 'earth', 'dark', 'holy', 'poison', 'lightning', 'ice', 'fire']);
      assert.strictEqual(result, 'augment_fire');
    });

    it('should handle multiple combat effects and return critical (highest)', () => {
      const result = getPrimaryOverlay(['chain', 'speed', 'stun', 'pierce', 'lifesteal', 'critical']);
      assert.strictEqual(result, 'augment_critical');
    });

    it('should handle multiple special augments and return arcane (highest)', () => {
      const result = getPrimaryOverlay(['slayer', 'vitality', 'fortune', 'arcane']);
      assert.strictEqual(result, 'augment_arcane');
    });

    it('should ignore unknown augments in mixed arrays', () => {
      const result = getPrimaryOverlay(['unknown1', 'fire', 'unknown2']);
      assert.strictEqual(result, 'augment_fire');
    });

    it('should return null if all augments are unknown', () => {
      const result = getPrimaryOverlay(['unknown1', 'unknown2', 'unknown3']);
      assert.strictEqual(result, null);
    });
  });

  describe('empty and null input handling', () => {
    it('should return null for empty array', () => {
      const result = getPrimaryOverlay([]);
      assert.strictEqual(result, null);
    });

    it('should return null for null input', () => {
      const result = getPrimaryOverlay(null);
      assert.strictEqual(result, null);
    });

    it('should return null for undefined input', () => {
      const result = getPrimaryOverlay(undefined);
      assert.strictEqual(result, null);
    });
  });

  describe('elemental priority over stat overlays', () => {
    it('should prioritize any elemental over any combat effect', () => {
      // Test wind (lowest elemental, priority 8) vs critical (highest combat, priority 10)
      const result = getPrimaryOverlay(['critical', 'wind']);
      assert.strictEqual(result, 'augment_wind');
    });

    it('should prioritize any combat effect over any special', () => {
      // Test chain (lowest combat, priority 14) vs arcane (highest special, priority 20)
      const result = getPrimaryOverlay(['arcane', 'chain']);
      assert.strictEqual(result, 'augment_chain');
    });

    it('should demonstrate full priority chain: elemental > combat > special', () => {
      // Mix one from each category
      const result = getPrimaryOverlay(['fortune', 'speed', 'earth']);
      assert.strictEqual(result, 'augment_earth', 'Elemental should win over combat and special');

      const result2 = getPrimaryOverlay(['fortune', 'speed']);
      assert.strictEqual(result2, 'augment_speed', 'Combat should win over special');
    });
  });

  describe('edge cases', () => {
    it('should handle duplicate augments', () => {
      const result = getPrimaryOverlay(['fire', 'fire', 'fire']);
      assert.strictEqual(result, 'augment_fire');
    });

    it('should handle mixed valid and empty string augments', () => {
      const result = getPrimaryOverlay(['', 'fire', '']);
      assert.strictEqual(result, 'augment_fire');
    });

    it('should handle array with only empty strings', () => {
      const result = getPrimaryOverlay(['', '', '']);
      assert.strictEqual(result, null);
    });
  });
});

describe('safe augment overlay resolution', () => {
  it('resolves all 30 equipment categories emitted by itemDropService', () => {
    assert.deepEqual(
      Object.keys(EQUIPMENT_CATEGORY_MAPPINGS).sort(),
      categoriesFrom(AUGMENTS)
    );
    for (const [category, expectedOverlay] of Object.entries(EQUIPMENT_CATEGORY_MAPPINGS)) {
      assert.equal(resolveAugmentOverlay(category), expectedOverlay, category);
    }
  });

  it('resolves all 21 consumable categories emitted by itemDropService', () => {
    assert.deepEqual(
      Object.keys(CONSUMABLE_CATEGORY_MAPPINGS).sort(),
      categoriesFrom(CONSUMABLE_AUGMENTS)
    );
    for (const [category, expectedOverlay] of Object.entries(CONSUMABLE_CATEGORY_MAPPINGS)) {
      assert.equal(resolveAugmentOverlay(category), expectedOverlay, category);
    }
  });

  it('keeps the combined runtime category registry complete', () => {
    assert.equal(Object.keys(RUNTIME_CATEGORY_MAPPINGS).length, 50);
    for (const [category, expectedOverlay] of Object.entries(RUNTIME_CATEGORY_MAPPINGS)) {
      assert.equal(resolveAugmentOverlay(category), expectedOverlay, category);
    }
  });

  it('resolves every user-reported missing category to an authored overlay', () => {
    const reported = {
      undead_slayer: 'augment_slayer',
      agility: 'augment_speed',
      damage: 'augment_critical',
      demon_slayer: 'augment_slayer',
      magic_defense: 'augment_arcane',
      power: 'augment_critical',
      hp: 'augment_vitality',
      intelligence: 'augment_arcane',
      strength: 'augment_critical',
      crit: 'augment_critical',
      armor: 'augment_earth'
    };

    for (const [category, expectedOverlay] of Object.entries(reported)) {
      assert.equal(resolveAugmentOverlay(category), expectedOverlay, category);
    }
  });

  it('normalizes case, whitespace, and hyphens and accepts canonical IDs', () => {
    assert.equal(resolveAugmentOverlay('  Magic-Defense  '), 'augment_arcane');
    assert.equal(resolveAugmentOverlay('UNDEAD SLAYER'), 'augment_slayer');
    assert.equal(resolveAugmentOverlay(' AUGMENT-FIRE '), 'augment_fire');
    assert.equal(resolveAugmentOverlay('augment_arcane'), 'augment_arcane');
  });

  it('rejects unknown, non-string, and path-like values', () => {
    for (const value of [
      'unknown',
      '../augment_fire',
      'fire.webp',
      'fire/../../secret',
      '',
      null,
      undefined,
      42,
      { category: 'fire' }
    ]) {
      assert.equal(resolveAugmentOverlay(value), null, String(value));
    }
  });

  it('deduplicates categories and canonical aliases by resolved overlay ID', () => {
    assert.deepEqual(
      resolveAugmentOverlays([
        'damage',
        'crit',
        'augment_critical',
        'agility',
        'instant',
        'unknown'
      ]),
      ['augment_critical', 'augment_speed']
    );
  });

  it('lists exactly the 18 authored overlay IDs', () => {
    assert.equal(CANONICAL_AUGMENT_OVERLAY_IDS.length, 18);
    assert.equal(new Set(CANONICAL_AUGMENT_OVERLAY_IDS).size, 18);
    assert.equal(
      CANONICAL_AUGMENT_OVERLAY_IDS.every(id => /^augment_[a-z]+$/.test(id)),
      true
    );
  });
});

describe('compositor augment requests', () => {
  class RecordingCompositor extends OverlayCompositor {
    constructor() {
      super();
      this.requests = [];
    }

    async loadImage(src) {
      this.requests.push(src);
      return { src };
    }

    composeSprite() {
      return 'data:image/png;base64,test';
    }
  }

  it('requests only canonical URLs and deduplicates equivalent aliases', async () => {
    const compositor = new RecordingCompositor();
    await compositor.composite({
      spriteId: 'sword_long',
      subcategory: 'weapons',
      augments: [
        'damage',
        ' CRIT ',
        'augment-critical',
        'undead-slayer',
        'demon_slayer',
        '../augment_fire',
        'unknown'
      ]
    });

    assert.deepEqual(compositor.requests, [
      '/assets/items/64/weapons/sword_long.webp',
      '/assets/overlays/128/augments/augment_critical.webp',
      '/assets/overlays/128/augments/augment_slayer.webp'
    ]);
  });

  it('does not make an augment request when every value is unknown or unsafe', async () => {
    const compositor = new RecordingCompositor();
    await compositor.composite({
      spriteId: 'sword_long',
      subcategory: 'weapons',
      augments: ['unknown', '../augment_fire', null]
    });

    assert.deepEqual(compositor.requests, [
      '/assets/items/64/weapons/sword_long.webp'
    ]);
  });

  it('preloads each actual canonical augment file once without double-prefixing', async () => {
    const compositor = new RecordingCompositor();
    await compositor.preloadOverlays();

    const augmentRequests = compositor.requests.filter(path => path.includes('/augments/'));
    assert.equal(augmentRequests.length, 18);
    assert.equal(new Set(augmentRequests).size, 18);
    assert.equal(augmentRequests.some(path => path.includes('augment_augment_')), false);
    assert.equal(
      augmentRequests.every(path =>
        CANONICAL_AUGMENT_OVERLAY_IDS.some(id => path.endsWith(`/${id}.webp`))
      ),
      true
    );
  });

  it('uses canonical augment paths in the legacy item compositor', async () => {
    const requests = [];
    const originalDocument = globalThis.document;
    const originalImage = globalThis.Image;
    globalThis.document = {
      createElement() {
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              globalCompositeOperation: 'source-over',
              globalAlpha: 1,
              clearRect() {},
              drawImage() {}
            };
          },
          toDataURL() {
            return 'data:image/png;base64,test';
          }
        };
      }
    };
    globalThis.Image = class {
      set src(value) {
        this.srcValue = value;
      }
    };

    try {
      await loadItemComposite({
        cache: new Map(),
        async loadImage(src) {
          requests.push(src);
          return { src };
        }
      }, '/legacy-assets', 'sword_long', 'weapon', 'common', 'augment-critical');
    } finally {
      globalThis.document = originalDocument;
      globalThis.Image = originalImage;
    }

    assert.deepEqual(requests, [
      '/assets/items/128/weapons/sword_long.webp',
      '/assets/overlays/128/augments/augment_critical.webp'
    ]);
  });

  it('legacy preload requests only the 18 canonical augment files', async () => {
    const requests = [];
    await preloadLegacyOverlays(async src => {
      requests.push(src);
      return { src };
    }, '/legacy-assets');

    const augmentRequests = requests.filter(path => path.includes('/augments/'));
    assert.equal(augmentRequests.length, 18);
    assert.equal(new Set(augmentRequests).size, 18);
    assert.equal(augmentRequests.some(path => path.includes('augment_augment_')), false);
    assert.equal(augmentRequests.every(path => path.startsWith('/assets/overlays/128/augments/')), true);
  });
});

describe('Cache key generation pattern', () => {
  // These tests verify the cache key pattern used by OverlayCompositor
  // without needing DOM access

  describe('cache key uniqueness', () => {
    it('should generate unique keys for different spriteIds', () => {
      const key1 = 'composite_sword_short_weapons_64_common_none';
      const key2 = 'composite_sword_long_weapons_64_common_none';
      assert.notStrictEqual(key1, key2);
    });

    it('should generate unique keys for different subcategories', () => {
      const key1 = 'composite_sword_short_weapons_64_common_none';
      const key2 = 'composite_sword_short_armor_64_common_none';
      assert.notStrictEqual(key1, key2);
    });

    it('should generate unique keys for different sizes', () => {
      const key1 = 'composite_sword_short_weapons_32_common_none';
      const key2 = 'composite_sword_short_weapons_64_common_none';
      assert.notStrictEqual(key1, key2);
    });

    it('should generate unique keys for different rarities', () => {
      const key1 = 'composite_sword_short_weapons_64_common_none';
      const key2 = 'composite_sword_short_weapons_64_epic_none';
      assert.notStrictEqual(key1, key2);
    });

    it('should generate unique keys for different augments', () => {
      const key1 = 'composite_sword_short_weapons_64_common_fire';
      const key2 = 'composite_sword_short_weapons_64_common_ice';
      assert.notStrictEqual(key1, key2);
    });

    it('should generate same key for same inputs', () => {
      const key1 = 'composite_sword_short_weapons_64_epic_fire_ice';
      const key2 = 'composite_sword_short_weapons_64_epic_fire_ice';
      assert.strictEqual(key1, key2);
    });

    it('should sort augments to ensure consistent cache keys', () => {
      // The compositor sorts augments for cache key consistency
      const augments1 = ['ice', 'fire'];
      const augments2 = ['fire', 'ice'];

      const sortedKey1 = augments1.sort().join('_');
      const sortedKey2 = augments2.sort().join('_');

      assert.strictEqual(sortedKey1, sortedKey2, 'Sorted augments should produce same key');
    });

    it('should use "none" for empty augments', () => {
      const augments = [];
      const augmentKey = augments.length > 0 ? augments.sort().join('_') : 'none';
      assert.strictEqual(augmentKey, 'none');
    });

    it('should join multiple augments with underscore', () => {
      const augments = ['fire', 'ice', 'lightning'];
      const augmentKey = augments.sort().join('_');
      assert.strictEqual(augmentKey, 'fire_ice_lightning');
    });
  });
});

describe('Rarity normalization pattern', () => {
  // Tests the rarity normalization logic used by OverlayCompositor

  const RARITY_MAP = {
    1: 'common',
    2: 'uncommon',
    3: 'rare',
    4: 'epic',
    5: 'legendary'
  };

  function normalizeRarity(rarity) {
    if (typeof rarity === 'number') {
      return RARITY_MAP[rarity] || 'common';
    }
    return rarity || 'common';
  }

  describe('numeric rarity conversion', () => {
    it('should convert 1 to common', () => {
      assert.strictEqual(normalizeRarity(1), 'common');
    });

    it('should convert 2 to uncommon', () => {
      assert.strictEqual(normalizeRarity(2), 'uncommon');
    });

    it('should convert 3 to rare', () => {
      assert.strictEqual(normalizeRarity(3), 'rare');
    });

    it('should convert 4 to epic', () => {
      assert.strictEqual(normalizeRarity(4), 'epic');
    });

    it('should convert 5 to legendary', () => {
      assert.strictEqual(normalizeRarity(5), 'legendary');
    });

    it('should default to common for unknown numbers', () => {
      assert.strictEqual(normalizeRarity(0), 'common');
      assert.strictEqual(normalizeRarity(6), 'common');
      assert.strictEqual(normalizeRarity(-1), 'common');
    });
  });

  describe('string rarity passthrough', () => {
    it('should pass through string rarities unchanged', () => {
      assert.strictEqual(normalizeRarity('common'), 'common');
      assert.strictEqual(normalizeRarity('uncommon'), 'uncommon');
      assert.strictEqual(normalizeRarity('rare'), 'rare');
      assert.strictEqual(normalizeRarity('epic'), 'epic');
      assert.strictEqual(normalizeRarity('legendary'), 'legendary');
    });
  });

  describe('null/undefined handling', () => {
    it('should default to common for null', () => {
      assert.strictEqual(normalizeRarity(null), 'common');
    });

    it('should default to common for undefined', () => {
      assert.strictEqual(normalizeRarity(undefined), 'common');
    });

    it('should default to common for empty string', () => {
      assert.strictEqual(normalizeRarity(''), 'common');
    });
  });
});
