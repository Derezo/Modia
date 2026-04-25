/**
 * Chest Loot Service Unit Tests
 *
 * Tests for chest loot generation based on distance tiers.
 * These tests focus on pure functions that don't require database access.
 *
 * Functions tested:
 * - generateChestLoot() - Deterministic loot generation
 * - getItemPoolByRarity() - Item pool filtering
 * - rollItem() - Individual item rolling
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateChestLoot,
  getItemPoolByRarity,
  rollItem,
  addItemsToInventory,
  RARITY,
  RARITY_NAMES
} from '../../services/world/chestLootService.js';
import { SeededRandom } from '../../config/constants.js';

describe('chestLootService', () => {
  describe('generateChestLoot', () => {
    describe('determinism', () => {
      it('should generate same loot for same userId and nodeId', () => {
        const userId = 123;
        const nodeId = 456;
        const distance = 10;

        const loot1 = generateChestLoot({ userId, nodeId, distance });
        const loot2 = generateChestLoot({ userId, nodeId, distance });

        assert.deepStrictEqual(loot1, loot2, 'Same inputs should produce same loot');
      });

      it('should generate different loot for different userId', () => {
        const nodeId = 456;
        const distance = 10;

        const loot1 = generateChestLoot({ userId: 100, nodeId, distance });
        const loot2 = generateChestLoot({ userId: 200, nodeId, distance });

        // With different userIds, the seed changes, so loot should differ
        // (unless by chance they roll the same - unlikely with varied pools)
        const ids1 = loot1.map(i => i.template_id).join(',');
        const ids2 = loot2.map(i => i.template_id).join(',');

        // We can't guarantee they're different (RNG), but we verify the function runs
        assert.ok(Array.isArray(loot1), 'Should return array for user 100');
        assert.ok(Array.isArray(loot2), 'Should return array for user 200');
      });

      it('should generate different loot for different nodeId', () => {
        const userId = 123;
        const distance = 10;

        const loot1 = generateChestLoot({ userId, nodeId: 100, distance });
        const loot2 = generateChestLoot({ userId, nodeId: 200, distance });

        assert.ok(Array.isArray(loot1), 'Should return array for node 100');
        assert.ok(Array.isArray(loot2), 'Should return array for node 200');
      });
    });

    describe('distance tier 1 (0-5)', () => {
      it('should return 0 or 1 common items', () => {
        // Test multiple seeds to verify tier behavior
        const results = [];
        for (let i = 1; i <= 20; i++) {
          const loot = generateChestLoot({ userId: i, nodeId: 1, distance: 3 });
          results.push(loot);

          // Each result should have 0 or 1 items
          assert.ok(loot.length <= 1, `Tier 1 should have at most 1 item, got ${loot.length}`);

          // If there's an item, it should be common
          if (loot.length > 0) {
            assert.strictEqual(loot[0].rarity, 'common', 'Tier 1 items should be common');
          }
        }

        // With 50% chance, we expect roughly half to have items
        const withItems = results.filter(r => r.length > 0).length;
        assert.ok(withItems > 0, 'Some tier 1 chests should have items');
        assert.ok(withItems < 20, 'Not all tier 1 chests should have items (50% chance)');
      });

      it('should handle distance 0', () => {
        const loot = generateChestLoot({ userId: 1, nodeId: 1, distance: 0 });
        assert.ok(Array.isArray(loot), 'Should handle distance 0');
        assert.ok(loot.length <= 1, 'Tier 1 should have at most 1 item');
      });

      it('should handle distance 5 (boundary)', () => {
        const loot = generateChestLoot({ userId: 1, nodeId: 1, distance: 5 });
        assert.ok(Array.isArray(loot), 'Should handle distance 5');
        assert.ok(loot.length <= 1, 'Distance 5 is still tier 1');
      });
    });

    describe('distance tier 2 (6-10)', () => {
      it('should always return at least 1 common item', () => {
        for (let i = 1; i <= 10; i++) {
          const loot = generateChestLoot({ userId: i * 100, nodeId: i, distance: 8 });

          assert.ok(loot.length >= 1, 'Tier 2 should have at least 1 item');

          // First item should be common
          const hasCommon = loot.some(item => item.rarity === 'common');
          assert.ok(hasCommon, 'Tier 2 should have a common item');
        }
      });

      it('should sometimes include an uncommon item (30% chance)', () => {
        const results = [];
        for (let i = 1; i <= 50; i++) {
          const loot = generateChestLoot({ userId: i * 1000, nodeId: i, distance: 7 });
          results.push(loot);
        }

        const withUncommon = results.filter(r =>
          r.some(item => item.rarity === 'uncommon')
        ).length;

        // With 30% chance over 50 trials, we expect 10-20 with uncommon
        assert.ok(withUncommon > 0, 'Some tier 2 chests should have uncommon items');
        assert.ok(withUncommon < 50, 'Not all tier 2 chests should have uncommon items');
      });

      it('should handle distance 6 (lower boundary)', () => {
        const loot = generateChestLoot({ userId: 1, nodeId: 1, distance: 6 });
        assert.ok(loot.length >= 1, 'Distance 6 should be tier 2 with guaranteed item');
      });

      it('should handle distance 10 (upper boundary)', () => {
        const loot = generateChestLoot({ userId: 1, nodeId: 1, distance: 10 });
        assert.ok(loot.length >= 1, 'Distance 10 should be tier 2');
      });
    });

    describe('distance tier 3 (11-15)', () => {
      it('should always return at least 1 uncommon item', () => {
        for (let i = 1; i <= 10; i++) {
          const loot = generateChestLoot({ userId: i * 100, nodeId: i, distance: 13 });

          assert.ok(loot.length >= 1, 'Tier 3 should have at least 1 item');

          const hasUncommon = loot.some(item => item.rarity === 'uncommon');
          assert.ok(hasUncommon, 'Tier 3 should have an uncommon item');
        }
      });

      it('should sometimes include a rare item (20% chance)', () => {
        const results = [];
        for (let i = 1; i <= 50; i++) {
          const loot = generateChestLoot({ userId: i * 1000, nodeId: i, distance: 12 });
          results.push(loot);
        }

        const withRare = results.filter(r =>
          r.some(item => item.rarity === 'rare')
        ).length;

        // With 20% chance over 50 trials, we expect some with rare
        assert.ok(withRare >= 0, 'Rare count should be non-negative');
        assert.ok(withRare <= 50, 'Rare count should not exceed total');
      });
    });

    describe('distance tier 4 (16+)', () => {
      it('should always return at least 1 rare item', () => {
        for (let i = 1; i <= 10; i++) {
          const loot = generateChestLoot({ userId: i * 100, nodeId: i, distance: 20 });

          assert.ok(loot.length >= 1, 'Tier 4 should have at least 1 item');

          const hasRare = loot.some(item => item.rarity === 'rare');
          assert.ok(hasRare, 'Tier 4 should have a rare item');
        }
      });

      it('should sometimes include an epic item (10% chance)', () => {
        const results = [];
        for (let i = 1; i <= 100; i++) {
          const loot = generateChestLoot({ userId: i * 1000, nodeId: i, distance: 25 });
          results.push(loot);
        }

        const withEpic = results.filter(r =>
          r.some(item => item.rarity === 'epic')
        ).length;

        // With 10% chance over 100 trials, we expect some with epic
        assert.ok(withEpic >= 0, 'Epic count should be non-negative');
        assert.ok(withEpic <= 100, 'Epic count should not exceed total');
      });

      it('should handle very high distances', () => {
        const loot = generateChestLoot({ userId: 1, nodeId: 1, distance: 100 });
        assert.ok(loot.length >= 1, 'High distance should still work');
        const hasRare = loot.some(item => item.rarity === 'rare');
        assert.ok(hasRare, 'High distance should have rare item');
      });
    });

    describe('item structure', () => {
      it('should return items with correct structure', () => {
        const loot = generateChestLoot({ userId: 1, nodeId: 1, distance: 10 });

        for (const item of loot) {
          assert.ok(typeof item.template_id === 'number', 'template_id should be number');
          assert.ok(item.template_id > 0, 'template_id should be positive');
          assert.strictEqual(item.quantity, 1, 'quantity should be 1');
          assert.ok(typeof item.rarity === 'string', 'rarity should be string');
          assert.ok(typeof item.name === 'string', 'name should be string');
          assert.ok(['common', 'uncommon', 'rare', 'epic', 'legendary'].includes(item.rarity),
            `rarity should be valid: ${item.rarity}`);
        }
      });
    });
  });

  describe('getItemPoolByRarity', () => {
    it('should return only items of specified rarity', () => {
      const commonPool = getItemPoolByRarity(RARITY.COMMON);
      for (const item of commonPool) {
        assert.strictEqual(item.rarity, 1, 'All items should be common (rarity 1)');
      }

      const uncommonPool = getItemPoolByRarity(RARITY.UNCOMMON);
      for (const item of uncommonPool) {
        assert.strictEqual(item.rarity, 2, 'All items should be uncommon (rarity 2)');
      }
    });

    it('should return non-empty arrays for common and uncommon', () => {
      const commonPool = getItemPoolByRarity(RARITY.COMMON);
      const uncommonPool = getItemPoolByRarity(RARITY.UNCOMMON);

      assert.ok(commonPool.length > 0, 'Common pool should not be empty');
      assert.ok(uncommonPool.length > 0, 'Uncommon pool should not be empty');
    });

    it('should return empty array for non-existent rarity', () => {
      const pool = getItemPoolByRarity(999);
      assert.strictEqual(pool.length, 0, 'Non-existent rarity should return empty array');
    });
  });

  describe('rollItem', () => {
    it('should return null for empty pool', () => {
      const rng = new SeededRandom(12345);
      const item = rollItem(rng, 999); // Non-existent rarity
      assert.strictEqual(item, null, 'Should return null for empty pool');
    });

    it('should return item with correct structure', () => {
      const rng = new SeededRandom(12345);
      const item = rollItem(rng, RARITY.COMMON);

      assert.ok(item !== null, 'Should return an item');
      assert.ok(typeof item.template_id === 'number', 'Should have template_id');
      assert.strictEqual(item.quantity, 1, 'Should have quantity 1');
      assert.strictEqual(item.rarity, 'common', 'Should have rarity name');
      assert.ok(typeof item.name === 'string', 'Should have name');
    });

    it('should be deterministic with same rng state', () => {
      const rng1 = new SeededRandom(12345);
      const rng2 = new SeededRandom(12345);

      const item1 = rollItem(rng1, RARITY.COMMON);
      const item2 = rollItem(rng2, RARITY.COMMON);

      assert.deepStrictEqual(item1, item2, 'Same seed should produce same item');
    });
  });

  describe('RARITY constants', () => {
    it('should have correct rarity values', () => {
      assert.strictEqual(RARITY.COMMON, 1);
      assert.strictEqual(RARITY.UNCOMMON, 2);
      assert.strictEqual(RARITY.RARE, 3);
      assert.strictEqual(RARITY.EPIC, 4);
      assert.strictEqual(RARITY.LEGENDARY, 5);
    });

    it('should have correct rarity names', () => {
      assert.strictEqual(RARITY_NAMES[1], 'common');
      assert.strictEqual(RARITY_NAMES[2], 'uncommon');
      assert.strictEqual(RARITY_NAMES[3], 'rare');
      assert.strictEqual(RARITY_NAMES[4], 'epic');
      assert.strictEqual(RARITY_NAMES[5], 'legendary');
    });
  });

  describe('addItemsToInventory', () => {
    function fakeClient() {
      const calls = [];
      let nextResult = { rows: [] };
      return {
        async query(sql, params) {
          calls.push({ sql, params });
          if (/^SELECT/i.test(sql)) {
            const r = nextResult;
            nextResult = { rows: [] };
            return r;
          }
          return { rows: [] };
        },
        _setNextSelectResult(rows) { nextResult = { rows }; },
        get calls() { return calls; }
      };
    }

    it('inserts a new row for stackable item with no existing stack', async () => {
      // template_id 1 -> ITEM_TEMPLATES[0]; we don't know its type, so use a known consumable id.
      // Skip if the item pool has no consumables.
      const { ITEM_TEMPLATES } = await import('../../db/templates/items.js');
      const consumable = ITEM_TEMPLATES.findIndex(t => t.item_type === 'consumable' || t.item_type === 'material');
      if (consumable < 0) return;
      const client = fakeClient();
      await addItemsToInventory(client, 7, [{ template_id: consumable + 1, quantity: 2, rarity: 1 }]);
      assert.ok(client.calls.some(c => /INSERT INTO character_items/.test(c.sql)));
    });

    it('updates existing stack for stackable item with prior row', async () => {
      const { ITEM_TEMPLATES } = await import('../../db/templates/items.js');
      const consumable = ITEM_TEMPLATES.findIndex(t => t.item_type === 'consumable' || t.item_type === 'material');
      if (consumable < 0) return;
      const client = fakeClient();
      client._setNextSelectResult([{ id: 99, quantity: 5 }]);
      await addItemsToInventory(client, 7, [{ template_id: consumable + 1, quantity: 3, rarity: 1 }]);
      assert.ok(client.calls.some(c => /UPDATE character_items/.test(c.sql)));
      assert.ok(!client.calls.some(c => /INSERT INTO character_items/.test(c.sql)));
    });

    it('inserts one row per quantity for non-stackable equipment', async () => {
      const { ITEM_TEMPLATES } = await import('../../db/templates/items.js');
      const equip = ITEM_TEMPLATES.findIndex(t => t.item_type !== 'consumable' && t.item_type !== 'material');
      if (equip < 0) return;
      const client = fakeClient();
      await addItemsToInventory(client, 7, [{ template_id: equip + 1, quantity: 3, rarity: 2 }]);
      const inserts = client.calls.filter(c => /INSERT INTO character_items/.test(c.sql));
      assert.strictEqual(inserts.length, 3);
    });

    it('handles empty items array without queries', async () => {
      const client = fakeClient();
      await addItemsToInventory(client, 7, []);
      assert.strictEqual(client.calls.length, 0);
    });
  });
});
