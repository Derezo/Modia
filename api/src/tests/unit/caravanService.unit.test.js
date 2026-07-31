/**
 * Caravan Service Unit Tests
 *
 * Tests for caravan inventory generation and purchase flow.
 * These tests focus on pure functions that don't require database access.
 *
 * Functions tested:
 * - generateCaravanInventory() - Deterministic inventory generation
 *
 * Database-dependent functions (getCaravanData, processPurchase, etc.)
 * are tested via integration tests.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { generateCaravanInventory } from '../../services/caravanService.js';
import {
  CARAVAN_ITEMS,
  CARAVAN_PRICE_MODIFIER,
  CARAVAN_REFRESH_INTERVAL,
  CARAVAN_STOCK,
  getItemsForRegion,
  getRegionalItems,
  getStockLimits
} from '../../db/templates/caravanItems.js';

describe('generateCaravanInventory', () => {
  describe('deterministic generation', () => {
    it('should generate same inventory for same seed and region', () => {
      const seed = 12345;
      const region = 'human';

      const inventory1 = generateCaravanInventory(seed, region);
      const inventory2 = generateCaravanInventory(seed, region);

      assert.deepStrictEqual(inventory1, inventory2);
    });

    it('should generate different inventory for different seeds', () => {
      const region = 'human';

      const inventory1 = generateCaravanInventory(11111, region);
      const inventory2 = generateCaravanInventory(22222, region);

      // Item IDs should differ (with high probability)
      const ids1 = inventory1.map(i => i.itemId).sort();
      const ids2 = inventory2.map(i => i.itemId).sort();

      assert.notDeepStrictEqual(ids1, ids2);
    });

    it('should generate different inventory for different regions', () => {
      const seed = 12345;

      const humanInventory = generateCaravanInventory(seed, 'human');
      const elfInventory = generateCaravanInventory(seed, 'elf');

      // Should have different regional items
      const humanRegional = humanInventory.filter(i => i.region === 'human');
      const elfRegional = elfInventory.filter(i => i.region === 'elf');

      assert.ok(humanRegional.length > 0, 'Human inventory should have human regional items');
      assert.ok(elfRegional.length > 0, 'Elf inventory should have elf regional items');
      assert.strictEqual(humanInventory.filter(i => i.region === 'elf').length, 0);
      assert.strictEqual(elfInventory.filter(i => i.region === 'human').length, 0);
    });
  });

  describe('inventory contents', () => {
    it('should include at least one regional item when available', () => {
      // Test multiple seeds to ensure regional items are always present
      const regions = ['human', 'elf', 'dwarf', 'orc', 'vampire'];

      for (const region of regions) {
        const regionalItems = getRegionalItems(region);
        if (regionalItems.length > 0) {
          // Test with multiple seeds
          for (let seed = 1; seed <= 5; seed++) {
            const inventory = generateCaravanInventory(seed * 1000, region);
            const hasRegional = inventory.some(item => item.region === region);
            assert.ok(hasRegional, `Seed ${seed * 1000} for ${region} should have regional item`);
          }
        }
      }
    });

    it('should only include items available for the region', () => {
      const seed = 54321;
      const region = 'dwarf';

      const inventory = generateCaravanInventory(seed, region);
      const availableItems = getItemsForRegion(region);
      const availableIds = new Set(availableItems.map(i => i.id));

      for (const item of inventory) {
        assert.ok(
          availableIds.has(item.itemId),
          `Item ${item.itemId} should be available in ${region} region`
        );
      }
    });

    it('should select 70-90% of available items', () => {
      const region = 'human';
      const availableItems = getItemsForRegion(region).filter(
        item => !item.alwaysStock && !Number.isFinite(item.inclusionChance)
      );

      // Test multiple seeds to verify range
      for (let seed = 1; seed <= 10; seed++) {
        const inventory = generateCaravanInventory(seed * 100, region).filter(
          item => !item.alwaysStock && !Number.isFinite(item.inclusionChance)
        );
        const ratio = inventory.length / availableItems.length;

        // Allow some tolerance for the guaranteed regional item addition
        assert.ok(
          ratio >= 0.65 && ratio <= 1.0,
          `Inventory ratio ${ratio.toFixed(2)} should be roughly 70-90% of available items`
        );
      }
    });
  });

  describe('pricing', () => {
    it('should apply caravan price modifier to all items', () => {
      const seed = 99999;
      const region = 'human';

      const inventory = generateCaravanInventory(seed, region);

      for (const item of inventory) {
        const expectedPrice = Math.floor(item.basePrice * CARAVAN_PRICE_MODIFIER);
        assert.strictEqual(
          item.price,
          expectedPrice,
          `Item ${item.itemId} price should be base * ${CARAVAN_PRICE_MODIFIER}`
        );
      }
    });

    it('should preserve base price for reference', () => {
      const seed = 88888;
      const region = 'elf';

      const inventory = generateCaravanInventory(seed, region);
      const sourceItems = new Map(CARAVAN_ITEMS.map(i => [i.id, i]));

      for (const item of inventory) {
        const source = sourceItems.get(item.itemId);
        assert.strictEqual(
          item.basePrice,
          source.basePrice,
          `Item ${item.itemId} should preserve original base price`
        );
      }
    });
  });

  describe('stock quantities', () => {
    it('should generate stock within defined limits', () => {
      const seed = 77777;
      const region = 'human';

      const inventory = generateCaravanInventory(seed, region);

      for (const item of inventory) {
        if (item.unlimitedStock) {
          assert.strictEqual(item.quantity, null);
          continue;
        }
        const limits = getStockLimits(item.itemId, item.type);
        assert.ok(
          item.quantity >= limits.min && item.quantity <= limits.max,
          `Item ${item.itemId} quantity ${item.quantity} should be within [${limits.min}, ${limits.max}]`
        );
      }
    });

    it('should set maxQuantity equal to quantity', () => {
      const seed = 66666;
      const region = 'orc';

      const inventory = generateCaravanInventory(seed, region);

      for (const item of inventory) {
        assert.strictEqual(
          item.maxQuantity,
          item.quantity,
          `Item ${item.itemId} maxQuantity should equal quantity`
        );
      }
    });

    it('should respect item-specific stock overrides', () => {
      const seed = 55555;
      const region = 'human';

      // Generate multiple times to find mystery boxes
      for (let i = 0; i < 10; i++) {
        const inventory = generateCaravanInventory(seed + i, region);
        const mysteryBox = inventory.find(item => item.itemId === 'mystery_box');

        if (mysteryBox) {
          assert.strictEqual(
            mysteryBox.quantity,
            1,
            'Mystery box should have exactly 1 stock'
          );
          break;
        }
      }
    });
  });

  describe('item properties', () => {
    it('should include all required item fields', () => {
      const seed = 44444;
      const region = 'vampire';

      const inventory = generateCaravanInventory(seed, region);

      for (const item of inventory) {
        assert.ok(item.itemId, 'Item should have itemId');
        assert.ok(item.name, 'Item should have name');
        assert.ok(item.type, 'Item should have type');
        assert.ok(
          typeof item.quantity === 'number' || (item.unlimitedStock && item.quantity === null),
          'Item should have finite or explicitly unlimited quantity'
        );
        assert.ok(
          typeof item.maxQuantity === 'number' || (item.unlimitedStock && item.maxQuantity === null),
          'Item should have finite or explicitly unlimited maximum quantity'
        );
        assert.ok(typeof item.price === 'number', 'Item should have price');
        assert.ok(typeof item.basePrice === 'number', 'Item should have basePrice');
      }
    });

    it('should include equipment properties for equipment items', () => {
      const seed = 33333;
      const region = 'elf';

      const inventory = generateCaravanInventory(seed, region);
      const equipment = inventory.filter(
        item => item.type === 'weapon' || item.type === 'armor' || item.type === 'accessory'
      );

      for (const item of equipment) {
        if (item.type === 'weapon' || item.type === 'armor') {
          assert.ok(item.equipSlot, `Equipment ${item.itemId} should have equipSlot`);
        }
      }
    });

    it('should include effect for consumable items', () => {
      const seed = 22222;
      const region = 'human';

      const inventory = generateCaravanInventory(seed, region);
      const consumables = inventory.filter(item => item.type === 'consumable');

      for (const item of consumables) {
        // All caravan consumables should have effects
        const sourceItem = CARAVAN_ITEMS.find(i => i.id === item.itemId);
        if (sourceItem && sourceItem.effect) {
          assert.ok(item.effect, `Consumable ${item.itemId} should have effect`);
        }
      }
    });
  });

  describe('sorting', () => {
    it('should sort regional items first', () => {
      const seed = 11111;
      const region = 'human';

      const inventory = generateCaravanInventory(seed, region);

      // Find first non-regional item
      let foundNonRegional = false;
      for (const item of inventory) {
        if (!item.region) {
          foundNonRegional = true;
        } else if (foundNonRegional) {
          assert.fail('Regional items should come before non-regional items');
        }
      }
    });

    it('should sort by type within regional/non-regional groups', () => {
      const seed = 10101;
      const region = 'dwarf';

      const inventory = generateCaravanInventory(seed, region);
      const typeOrder = ['consumable', 'key_item', 'weapon', 'armor', 'accessory', 'material'];

      // Check non-regional items are sorted by type
      const nonRegional = inventory.filter(i => !i.region);
      let lastTypeIndex = -1;

      for (const item of nonRegional) {
        const typeIndex = typeOrder.indexOf(item.type);
        if (typeIndex < lastTypeIndex) {
          // Check if it's the same type (alphabetical within type)
          const lastItem = nonRegional[nonRegional.indexOf(item) - 1];
          if (lastItem && lastItem.type !== item.type) {
            assert.fail(`Items should be sorted by type: ${item.type} came after higher-order type`);
          }
        }
        if (typeIndex > lastTypeIndex) {
          lastTypeIndex = typeIndex;
        }
      }
    });
  });
});

describe('Caravan Service Constants', () => {
  describe('CARAVAN_PRICE_MODIFIER', () => {
    it('should be greater than 1 (premium pricing)', () => {
      assert.ok(CARAVAN_PRICE_MODIFIER > 1, 'Caravan should charge premium prices');
    });

    it('should be reasonable (not more than 50% markup)', () => {
      assert.ok(CARAVAN_PRICE_MODIFIER <= 1.5, 'Markup should not exceed 50%');
    });
  });

  describe('CARAVAN_REFRESH_INTERVAL', () => {
    it('should be 48 hours in milliseconds', () => {
      const expected = 48 * 60 * 60 * 1000;
      assert.strictEqual(CARAVAN_REFRESH_INTERVAL, expected);
    });
  });

  describe('CARAVAN_STOCK', () => {
    it('should have stock limits for all item types', () => {
      const types = ['consumable', 'material', 'key_item', 'weapon', 'armor', 'accessory'];
      for (const type of types) {
        assert.ok(CARAVAN_STOCK[type], `Should have stock limits for ${type}`);
        assert.ok(CARAVAN_STOCK[type].min > 0, `${type} min should be positive`);
        assert.ok(CARAVAN_STOCK[type].max >= CARAVAN_STOCK[type].min, `${type} max >= min`);
      }
    });

    it('should have lower limits for equipment than consumables', () => {
      assert.ok(
        CARAVAN_STOCK.weapon.max <= CARAVAN_STOCK.consumable.max,
        'Weapons should be rarer than consumables'
      );
      assert.ok(
        CARAVAN_STOCK.armor.max <= CARAVAN_STOCK.consumable.max,
        'Armor should be rarer than consumables'
      );
    });
  });

  describe('CARAVAN_ITEMS', () => {
    it('should have unique IDs', () => {
      const ids = CARAVAN_ITEMS.map(i => i.id);
      const uniqueIds = new Set(ids);
      assert.strictEqual(ids.length, uniqueIds.size, 'All item IDs should be unique');
    });

    it('should have valid types', () => {
      const validTypes = ['consumable', 'material', 'key_item', 'weapon', 'armor', 'accessory'];
      for (const item of CARAVAN_ITEMS) {
        assert.ok(
          validTypes.includes(item.type),
          `Item ${item.id} has invalid type: ${item.type}`
        );
      }
    });

    it('should have positive base prices', () => {
      for (const item of CARAVAN_ITEMS) {
        assert.ok(item.basePrice > 0, `Item ${item.id} should have positive price`);
      }
    });

    it('should have regional items for each race', () => {
      const races = ['human', 'elf', 'dwarf', 'orc', 'vampire'];
      for (const race of races) {
        const regional = getRegionalItems(race);
        assert.ok(regional.length > 0, `Should have regional items for ${race}`);
      }
    });
  });
});

describe('getItemsForRegion', () => {
  it('should return non-regional items for all regions', () => {
    const nonRegional = CARAVAN_ITEMS.filter(i => !i.region);
    const regions = ['human', 'elf', 'dwarf', 'orc', 'vampire'];

    for (const region of regions) {
      const available = getItemsForRegion(region);
      for (const item of nonRegional) {
        const found = available.find(i => i.id === item.id);
        assert.ok(found, `Non-regional item ${item.id} should be available in ${region}`);
      }
    }
  });

  it('should include regional items only for matching region', () => {
    const humanItems = getItemsForRegion('human');
    const elfItems = getItemsForRegion('elf');

    const humanRegional = humanItems.filter(i => i.region === 'human');
    const elfRegional = elfItems.filter(i => i.region === 'elf');

    assert.ok(humanRegional.length > 0);
    assert.ok(elfRegional.length > 0);

    // Human items should not contain elf regional items
    assert.strictEqual(
      humanItems.filter(i => i.region === 'elf').length,
      0,
      'Human region should not have elf items'
    );
  });
});

describe('getStockLimits', () => {
  it('should return override limits for specific items', () => {
    const mysteryBoxLimits = getStockLimits('mystery_box', 'consumable');
    assert.strictEqual(mysteryBoxLimits.min, 1);
    assert.strictEqual(mysteryBoxLimits.max, 1);
  });

  it('should return type-based limits for non-override items', () => {
    const megaPotionLimits = getStockLimits('mega_potion', 'consumable');
    assert.strictEqual(megaPotionLimits.min, CARAVAN_STOCK.consumable.min);
    assert.strictEqual(megaPotionLimits.max, CARAVAN_STOCK.consumable.max);
  });

  it('should return default limits for unknown types', () => {
    const unknownLimits = getStockLimits('unknown_item', 'unknown_type');
    assert.strictEqual(unknownLimits.min, 1);
    assert.strictEqual(unknownLimits.max, 3);
  });
});
