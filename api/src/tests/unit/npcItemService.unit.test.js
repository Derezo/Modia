/**
 * NPC Item Service Unit Tests
 *
 * Tests for NPC consumable item generation based on archetype and difficulty tier.
 * Pure functions with no database dependency.
 *
 * Note: Some functions use Math.random() for probabilistic drops. Tests handle this by:
 * - Testing deterministic outcomes (guaranteed items, guaranteed empty)
 * - Validating item structure regardless of random outcome
 * - Running statistical tests over many iterations for probability-based behavior
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  generateNpcItems,
  generateIntelligentNpcItems,
  generateBeastItems,
  generateDragonItems,
  NPC_ITEM_TABLES,
  INTELLIGENT_ARCHETYPES,
  BEAST_ARCHETYPES
} from '../../services/npcItemService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_EFFECT_TYPES = ['heal_hp', 'heal_mp', 'heal_both'];
const REQUIRED_ITEM_FIELDS = ['itemId', 'name', 'effectType', 'effectValue', 'quantity'];

/**
 * Assert every item in the array has the required shape and canonical effectType.
 */
function assertValidItems(items) {
  assert.ok(Array.isArray(items), 'Result should be an array');
  for (const item of items) {
    for (const field of REQUIRED_ITEM_FIELDS) {
      assert.ok(field in item, `Item missing required field: ${field}`);
    }
    assert.ok(
      VALID_EFFECT_TYPES.includes(item.effectType),
      `Invalid effectType "${item.effectType}" - must be one of ${VALID_EFFECT_TYPES.join(', ')}`
    );
    assert.strictEqual(typeof item.effectValue, 'number', 'effectValue must be numeric');
    assert.ok(item.effectValue > 0, 'effectValue must be positive');
    assert.strictEqual(typeof item.quantity, 'number', 'quantity must be numeric');
    assert.ok(item.quantity >= 1, 'quantity must be at least 1');
  }
}

// ---------------------------------------------------------------------------
// NPC_ITEM_TABLES
// ---------------------------------------------------------------------------

describe('NPC_ITEM_TABLES', () => {
  it('contains expected item keys', () => {
    const expectedKeys = ['health_potion', 'hi_potion', 'mana_potion', 'hi_ether', 'elixir'];
    for (const key of expectedKeys) {
      assert.ok(NPC_ITEM_TABLES[key], `Missing item table entry: ${key}`);
    }
  });

  it('all items use canonical DB effectTypes', () => {
    for (const [key, item] of Object.entries(NPC_ITEM_TABLES)) {
      assert.ok(
        VALID_EFFECT_TYPES.includes(item.effectType),
        `${key} has non-canonical effectType: ${item.effectType}`
      );
    }
  });

  it('all items have numeric effectValue', () => {
    for (const [key, item] of Object.entries(NPC_ITEM_TABLES)) {
      assert.strictEqual(typeof item.effectValue, 'number', `${key} effectValue should be number`);
      assert.ok(item.effectValue > 0, `${key} effectValue should be positive`);
    }
  });

  it('all items have numeric itemId', () => {
    for (const [key, item] of Object.entries(NPC_ITEM_TABLES)) {
      assert.strictEqual(typeof item.itemId, 'number', `${key} itemId should be number`);
    }
  });

  it('health_potion restores 50 HP', () => {
    assert.strictEqual(NPC_ITEM_TABLES.health_potion.effectType, 'heal_hp');
    assert.strictEqual(NPC_ITEM_TABLES.health_potion.effectValue, 50);
  });

  it('hi_potion restores 150 HP', () => {
    assert.strictEqual(NPC_ITEM_TABLES.hi_potion.effectType, 'heal_hp');
    assert.strictEqual(NPC_ITEM_TABLES.hi_potion.effectValue, 150);
  });

  it('elixir uses heal_both effectType', () => {
    assert.strictEqual(NPC_ITEM_TABLES.elixir.effectType, 'heal_both');
  });
});

// ---------------------------------------------------------------------------
// Archetype Constants
// ---------------------------------------------------------------------------

describe('Archetype Constants', () => {
  it('INTELLIGENT_ARCHETYPES contains humanoid, demon, undead, construct', () => {
    const expected = ['humanoid', 'demon', 'undead', 'construct'];
    for (const arch of expected) {
      assert.ok(INTELLIGENT_ARCHETYPES.includes(arch), `Missing intelligent archetype: ${arch}`);
    }
  });

  it('BEAST_ARCHETYPES contains beast, insect, plant, elemental', () => {
    const expected = ['beast', 'insect', 'plant', 'elemental'];
    for (const arch of expected) {
      assert.ok(BEAST_ARCHETYPES.includes(arch), `Missing beast archetype: ${arch}`);
    }
  });

  it('intelligent and beast lists do not overlap', () => {
    for (const arch of INTELLIGENT_ARCHETYPES) {
      assert.ok(!BEAST_ARCHETYPES.includes(arch), `${arch} appears in both lists`);
    }
  });

  it('dragon is in neither list (handled separately)', () => {
    assert.ok(!INTELLIGENT_ARCHETYPES.includes('dragon'));
    assert.ok(!BEAST_ARCHETYPES.includes('dragon'));
  });
});

// ---------------------------------------------------------------------------
// generateIntelligentNpcItems
// ---------------------------------------------------------------------------

describe('generateIntelligentNpcItems', () => {
  describe('tier 1-2 (low tier)', () => {
    it('returns health_potion at tier 1', () => {
      const items = generateIntelligentNpcItems(1, false);
      assertValidItems(items);
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].name, 'Health Potion');
      assert.strictEqual(items[0].effectValue, 50);
    });

    it('returns health_potion at tier 2', () => {
      const items = generateIntelligentNpcItems(2, false);
      assertValidItems(items);
      assert.strictEqual(items.length, 1);
      assert.strictEqual(items[0].name, 'Health Potion');
    });

    it('items have quantity of 1', () => {
      const items = generateIntelligentNpcItems(1, false);
      assert.strictEqual(items[0].quantity, 1);
    });
  });

  describe('tier 3+ (mid-high tier)', () => {
    it('returns hi_potion as first item at tier 3', () => {
      const items = generateIntelligentNpcItems(3, false);
      assertValidItems(items);
      assert.ok(items.length >= 1, 'Should have at least 1 item');
      assert.strictEqual(items[0].name, 'Hi-Potion');
      assert.strictEqual(items[0].effectValue, 150);
    });

    it('returns hi_potion as first item at tier 4', () => {
      const items = generateIntelligentNpcItems(4, false);
      assertValidItems(items);
      assert.strictEqual(items[0].name, 'Hi-Potion');
    });

    it('may include mana item at tier 3+', () => {
      // Run many iterations to verify mana items can appear
      let manaFound = false;
      for (let i = 0; i < 200; i++) {
        const items = generateIntelligentNpcItems(3, false);
        if (items.length > 1) {
          manaFound = true;
          // Tier 3 gets mana_potion (not hi_ether)
          assert.strictEqual(items[1].name, 'Mana Potion');
          break;
        }
      }
      assert.ok(manaFound, 'Mana Potion should appear sometimes at tier 3');
    });

    it('tier 4 gets hi_ether instead of mana_potion', () => {
      let etherFound = false;
      for (let i = 0; i < 200; i++) {
        const items = generateIntelligentNpcItems(4, false);
        if (items.length > 1) {
          etherFound = true;
          assert.strictEqual(items[1].name, 'Hi-Ether');
          break;
        }
      }
      assert.ok(etherFound, 'Hi-Ether should appear sometimes at tier 4');
    });
  });

  describe('boss behavior', () => {
    it('boss at tier 1 gets hi_potion (upgraded from health_potion)', () => {
      const items = generateIntelligentNpcItems(1, true);
      assertValidItems(items);
      assert.strictEqual(items[0].name, 'Hi-Potion');
    });

    it('boss always gets MP item', () => {
      // Boss at tier 1-3 should get mana_potion; tier 4+ gets hi_ether
      const items = generateIntelligentNpcItems(2, true);
      assertValidItems(items);
      const mpItem = items.find(i => i.effectType === 'heal_mp');
      assert.ok(mpItem, 'Boss should always have an MP item');
    });

    it('boss at low tier gets hi_ether', () => {
      // isBoss triggers tier >= 4 path for hi_ether
      const items = generateIntelligentNpcItems(2, true);
      const mpItem = items.find(i => i.effectType === 'heal_mp');
      assert.strictEqual(mpItem.name, 'Hi-Ether');
    });

    it('boss at tier 5 can get elixir', () => {
      let elixirFound = false;
      for (let i = 0; i < 200; i++) {
        const items = generateIntelligentNpcItems(5, true);
        const elixir = items.find(i => i.name === 'Elixir');
        if (elixir) {
          elixirFound = true;
          assert.strictEqual(elixir.effectType, 'heal_both');
          break;
        }
      }
      assert.ok(elixirFound, 'Tier 5 boss should sometimes have Elixir');
    });

    it('non-boss at tier 5 never gets elixir', () => {
      // Only isBoss && tier >= 5 triggers elixir
      for (let i = 0; i < 100; i++) {
        const items = generateIntelligentNpcItems(5, false);
        const elixir = items.find(i => i.name === 'Elixir');
        assert.ok(!elixir, 'Non-boss should not get elixir');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// generateBeastItems
// ---------------------------------------------------------------------------

describe('generateBeastItems', () => {
  it('returns empty array at tier 1', () => {
    const items = generateBeastItems(1);
    assert.deepStrictEqual(items, []);
  });

  it('returns empty array at tier 2', () => {
    const items = generateBeastItems(2);
    assert.deepStrictEqual(items, []);
  });

  it('returns empty array at tier 3', () => {
    const items = generateBeastItems(3);
    assert.deepStrictEqual(items, []);
  });

  it('tier 4 rarely drops items (10% chance)', () => {
    let dropCount = 0;
    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
      const items = generateBeastItems(4);
      assertValidItems(items);
      if (items.length > 0) {
        dropCount++;
        // When it drops, it should be a health_potion
        assert.strictEqual(items[0].name, 'Health Potion');
      }
    }
    // Expect roughly 10% (+/- margin)
    const rate = dropCount / iterations;
    assert.ok(rate > 0.03 && rate < 0.20,
      `Tier 4 drop rate ${(rate * 100).toFixed(1)}% outside expected range 3-20%`);
  });

  it('tier 5 has higher drop chance (25%)', () => {
    let dropCount = 0;
    const iterations = 1000;
    for (let i = 0; i < iterations; i++) {
      const items = generateBeastItems(5);
      assertValidItems(items);
      if (items.length > 0) dropCount++;
    }
    const rate = dropCount / iterations;
    assert.ok(rate > 0.15 && rate < 0.40,
      `Tier 5 drop rate ${(rate * 100).toFixed(1)}% outside expected range 15-40%`);
  });

  it('tier 5 can drop a second item (mana potion)', () => {
    let twoItemCount = 0;
    for (let i = 0; i < 2000; i++) {
      const items = generateBeastItems(5);
      if (items.length === 2) {
        twoItemCount++;
        assert.strictEqual(items[1].name, 'Mana Potion');
      }
    }
    assert.ok(twoItemCount > 0, 'Tier 5 beasts should sometimes drop two items');
  });

  it('tier 4 never drops more than one item', () => {
    for (let i = 0; i < 500; i++) {
      const items = generateBeastItems(4);
      assert.ok(items.length <= 1, 'Tier 4 beasts should have at most 1 item');
    }
  });
});

// ---------------------------------------------------------------------------
// generateDragonItems
// ---------------------------------------------------------------------------

describe('generateDragonItems', () => {
  it('always includes hi_potion at any tier', () => {
    for (let tier = 1; tier <= 5; tier++) {
      const items = generateDragonItems(tier);
      assertValidItems(items);
      const hiPotion = items.find(i => i.name === 'Hi-Potion');
      assert.ok(hiPotion, `Dragon at tier ${tier} should always have Hi-Potion`);
    }
  });

  it('tier 1-2 dragons do not get hi_ether', () => {
    for (let tier = 1; tier <= 2; tier++) {
      // No randomness in hi_ether - deterministic based on tier
      const items = generateDragonItems(tier);
      const ether = items.find(i => i.name === 'Hi-Ether');
      assert.ok(!ether, `Tier ${tier} dragon should not have Hi-Ether`);
    }
  });

  it('tier 3+ dragons always get hi_ether', () => {
    for (let tier = 3; tier <= 5; tier++) {
      const items = generateDragonItems(tier);
      const ether = items.find(i => i.name === 'Hi-Ether');
      assert.ok(ether, `Tier ${tier} dragon should always have Hi-Ether`);
    }
  });

  it('tier 4+ dragons can get elixir', () => {
    let elixirFound = false;
    for (let i = 0; i < 200; i++) {
      const items = generateDragonItems(4);
      if (items.find(i => i.name === 'Elixir')) {
        elixirFound = true;
        break;
      }
    }
    assert.ok(elixirFound, 'Tier 4 dragon should sometimes have Elixir');
  });

  it('tier 1-3 dragons never get elixir', () => {
    for (let tier = 1; tier <= 3; tier++) {
      for (let i = 0; i < 100; i++) {
        const items = generateDragonItems(tier);
        const elixir = items.find(i => i.name === 'Elixir');
        assert.ok(!elixir, `Tier ${tier} dragon should never have Elixir`);
      }
    }
  });

  it('tier 5 dragon has higher elixir chance than tier 4', () => {
    const iterations = 1000;
    let tier4Elixir = 0;
    let tier5Elixir = 0;

    for (let i = 0; i < iterations; i++) {
      if (generateDragonItems(4).find(it => it.name === 'Elixir')) tier4Elixir++;
      if (generateDragonItems(5).find(it => it.name === 'Elixir')) tier5Elixir++;
    }

    assert.ok(tier5Elixir > tier4Elixir,
      `Tier 5 elixir count (${tier5Elixir}) should exceed tier 4 (${tier4Elixir})`);
  });
});

// ---------------------------------------------------------------------------
// generateNpcItems (main entry point)
// ---------------------------------------------------------------------------

describe('generateNpcItems', () => {
  describe('routing by archetype', () => {
    it('routes intelligent archetypes to generateIntelligentNpcItems', () => {
      for (const archetype of INTELLIGENT_ARCHETYPES) {
        const items = generateNpcItems({ archetype }, 10, 1);
        assertValidItems(items);
        assert.ok(items.length >= 1,
          `${archetype} archetype should always produce items`);
      }
    });

    it('routes beast archetypes to generateBeastItems', () => {
      for (const archetype of BEAST_ARCHETYPES) {
        // Tier 1 beasts should always return empty
        const items = generateNpcItems({ archetype }, 5, 1);
        assertValidItems(items);
        assert.strictEqual(items.length, 0,
          `${archetype} at tier 1 should have no items`);
      }
    });

    it('routes dragon archetype to generateDragonItems', () => {
      const items = generateNpcItems({ archetype: 'dragon' }, 20, 1);
      assertValidItems(items);
      assert.ok(items.length >= 1, 'Dragon should always have items');
      assert.strictEqual(items[0].name, 'Hi-Potion');
    });

    it('returns empty array for unknown archetype', () => {
      const items = generateNpcItems({ archetype: 'alien' }, 10, 3);
      assert.deepStrictEqual(items, []);
    });
  });

  describe('boss override', () => {
    it('boss beasts get items regardless of tier', () => {
      const items = generateNpcItems({ archetype: 'beast', isBoss: true }, 10, 1);
      assertValidItems(items);
      assert.ok(items.length >= 1, 'Boss beast should always have items');
    });

    it('tier 5 implicitly makes any enemy a boss for item purposes', () => {
      // difficultyTier >= 5 sets isBoss = true in the source
      const items = generateNpcItems({ archetype: 'beast' }, 30, 5);
      assertValidItems(items);
      // At tier 5 with isBoss, routes to intelligent path
      assert.ok(items.length >= 1, 'Tier 5 beast should have items (boss override)');
    });

    it('boss flag on intelligent archetype upgrades items', () => {
      const normalItems = generateIntelligentNpcItems(1, false);
      const bossItems = generateIntelligentNpcItems(1, true);

      // Normal tier 1 gets health_potion, boss gets hi_potion
      assert.strictEqual(normalItems[0].name, 'Health Potion');
      assert.strictEqual(bossItems[0].name, 'Hi-Potion');
    });
  });

  describe('default archetype fallback', () => {
    it('treats missing archetype as beast', () => {
      // No archetype defaults to "beast" per source code
      const items = generateNpcItems({}, 5, 1);
      assert.deepStrictEqual(items, []);
    });
  });

  describe('item structure consistency', () => {
    it('all generated items are copies (not references to NPC_ITEM_TABLES)', () => {
      const items = generateNpcItems({ archetype: 'humanoid' }, 10, 1);
      assert.ok(items.length >= 1);

      // Mutate the returned item and verify the table is unchanged
      items[0].effectValue = 9999;
      assert.strictEqual(NPC_ITEM_TABLES.health_potion.effectValue, 50,
        'Modifying returned items should not affect NPC_ITEM_TABLES');
    });

    it('every item across all paths uses canonical effectTypes', () => {
      const testCases = [
        { archetype: 'humanoid', tier: 1 },
        { archetype: 'humanoid', tier: 3 },
        { archetype: 'humanoid', tier: 5, isBoss: true },
        { archetype: 'dragon', tier: 1 },
        { archetype: 'dragon', tier: 5 },
      ];

      for (const { archetype, tier, isBoss } of testCases) {
        const items = generateNpcItems(
          { archetype, isBoss: isBoss || false },
          tier * 10,
          tier
        );
        assertValidItems(items);
      }
    });
  });

  describe('tier progression', () => {
    it('higher tier intelligent NPCs get better or more items', () => {
      // Tier 1: health_potion (effectValue 50)
      // Tier 3+: hi_potion (effectValue 150)
      const lowItems = generateIntelligentNpcItems(1, false);
      const highItems = generateIntelligentNpcItems(3, false);

      assert.ok(highItems[0].effectValue > lowItems[0].effectValue,
        'Higher tier should have stronger healing item');
    });

    it('dragon items increase with tier', () => {
      const tier1Items = generateDragonItems(1);
      const tier3Items = generateDragonItems(3);

      assert.ok(tier3Items.length > tier1Items.length,
        'Higher tier dragons should have more items');
    });
  });
});
