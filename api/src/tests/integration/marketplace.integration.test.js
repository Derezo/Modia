/**
 * Integration tests for Marketplace API
 *
 * Tests the sellable inventory endpoint and related marketplace functionality.
 * These tests require a running API server.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  request,
  createTestUser,
  createTestCharacter,
  cleanupTestUser,
  query,
  getClient
} from '../testHelper.js';

describe('Marketplace API', () => {
  let testUser = null;
  let testUser2 = null;
  let testCharacter = null;
  let testCharacter2 = null;
  let tradeableItemId = null;
  let nonTradeableItemId = null;

  before(async () => {
    // Create test users and characters
    testUser = await createTestUser();
    testUser2 = await createTestUser();
    testCharacter = await createTestCharacter(testUser.accessToken);
    testCharacter2 = await createTestCharacter(testUser2.accessToken);

    // Find tradeable items (can be any type)
    const tradeableResult = await query(
      `SELECT id FROM item_templates
       WHERE is_tradeable IS NOT FALSE
       LIMIT 1`
    );

    const nonTradeableResult = await query(
      `SELECT id FROM item_templates
       WHERE is_tradeable = FALSE
       LIMIT 1`
    );

    if (tradeableResult.rows.length > 0) {
      tradeableItemId = tradeableResult.rows[0].id;
    }

    if (nonTradeableResult.rows.length > 0) {
      nonTradeableItemId = nonTradeableResult.rows[0].id;
    }
  });

  after(async () => {
    // Cleanup test data
    if (testUser) {
      await cleanupTestUser(testUser.userId);
    }
    if (testUser2) {
      await cleanupTestUser(testUser2.userId);
    }
  });

  describe('GET /api/marketplace/inventory/sellable', () => {
    it('should require authentication', async () => {
      const res = await request('GET', '/api/marketplace/inventory/sellable');

      assert.strictEqual(res.status, 401, 'Should reject unauthenticated request');
    });

    it('should return success response with items array', async () => {
      const res = await request(
        'GET',
        '/api/marketplace/inventory/sellable',
        null,
        testUser.accessToken
      );

      assert.strictEqual(res.status, 200, 'Should return 200 OK');
      assert.ok(res.body.success, 'Should have success flag');
      assert.ok(Array.isArray(res.body.items), 'Should return items array');
    });

    it('should return only unequipped tradeable items', async () => {
      if (!tradeableItemId) {
        console.log('Skipping test - no tradeable items available');
        return;
      }

      const client = await getClient();
      let createdUnequippedId = null;
      let createdEquippedId = null;

      try {
        await client.query('BEGIN');

        // Add an unequipped item to the user's shared inventory.
        const unequippedResult = await client.query(
          `INSERT INTO character_items (user_id, item_template_id, quantity, equipped_slot)
           VALUES ($1, $2, 5, NULL) RETURNING id`,
          [testUser.userId, tradeableItemId]
        );
        createdUnequippedId = unequippedResult.rows[0].id;

        // Give character an equipped item (if we have an equipment item)
        const equipmentResult = await client.query(
          `SELECT id FROM item_templates
           WHERE is_tradeable IS NOT FALSE AND item_type = 'weapon'
           LIMIT 1`
        );

        if (equipmentResult.rows.length > 0) {
          const equippedResult = await client.query(
            `INSERT INTO character_items (character_id, item_template_id, quantity, equipped_slot)
             VALUES ($1, $2, 1, 'main_hand') RETURNING id`,
            [testCharacter.id, equipmentResult.rows[0].id]
          );
          createdEquippedId = equippedResult.rows[0].id;
        }

        await client.query('COMMIT');

        // Fetch sellable inventory
        const res = await request(
          'GET',
          '/api/marketplace/inventory/sellable',
          null,
          testUser.accessToken
        );

        assert.strictEqual(res.status, 200);

        // The unequipped item should appear in sellable items
        const hasUnequippedItem = res.body.items.some(
          item => item.instanceId === createdUnequippedId
        );

        // If we created an equipped item, it should NOT appear
        if (createdEquippedId) {
          const hasEquippedItem = res.body.items.some(
            item => item.instanceId === createdEquippedId
          );
          assert.strictEqual(
            hasEquippedItem,
            false,
            'Equipped items should not appear in sellable inventory'
          );
        }

        assert.ok(
          hasUnequippedItem,
          'Unequipped tradeable items should appear in sellable inventory'
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        // Cleanup
        if (createdUnequippedId) {
          await query('DELETE FROM character_items WHERE id = $1', [createdUnequippedId]).catch(() => {});
        }
        if (createdEquippedId) {
          await query('DELETE FROM character_items WHERE id = $1', [createdEquippedId]).catch(() => {});
        }
        client.release();
      }
    });

    it('should exclude items that are not tradeable', async () => {
      if (!nonTradeableItemId) {
        console.log('Skipping test - no non-tradeable items available');
        return;
      }

      const client = await getClient();
      let createdItemId = null;

      try {
        await client.query('BEGIN');

        // Add a non-tradeable item to the user's shared inventory.
        const result = await client.query(
          `INSERT INTO character_items (user_id, item_template_id, quantity, equipped_slot)
           VALUES ($1, $2, 3, NULL) RETURNING id`,
          [testUser.userId, nonTradeableItemId]
        );
        createdItemId = result.rows[0].id;

        await client.query('COMMIT');

        // Fetch sellable inventory
        const res = await request(
          'GET',
          '/api/marketplace/inventory/sellable',
          null,
          testUser.accessToken
        );

        assert.strictEqual(res.status, 200);

        // Non-tradeable item should not appear
        const hasNonTradeableItem = res.body.items.some(
          item => item.templateId === nonTradeableItemId
        );

        assert.strictEqual(
          hasNonTradeableItem,
          false,
          'Non-tradeable items should not appear in sellable inventory'
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        if (createdItemId) {
          await query('DELETE FROM character_items WHERE id = $1', [createdItemId]).catch(() => {});
        }
        client.release();
      }
    });

    it('should exclude items already listed on marketplace', async () => {
      if (!tradeableItemId) {
        console.log('Skipping test - no tradeable items available');
        return;
      }

      const client = await getClient();
      let characterItemId = null;
      let listingId = null;

      try {
        await client.query('BEGIN');

        // Find a non-stackable tradeable item for listing
        const weaponResult = await client.query(
          `SELECT id FROM item_templates
           WHERE is_tradeable IS NOT FALSE
           AND item_type = 'weapon'
           AND (is_stackable IS NULL OR is_stackable = FALSE)
           LIMIT 1`
        );

        if (weaponResult.rows.length === 0) {
          console.log('Skipping test - no non-stackable tradeable items available');
          await client.query('ROLLBACK');
          return;
        }

        const weaponId = weaponResult.rows[0].id;

        // Create the item in the user's shared inventory.
        const itemResult = await client.query(
          `INSERT INTO character_items (user_id, item_template_id, quantity, equipped_slot, modifications)
           VALUES ($1, $2, 1, NULL, '{}')
           RETURNING id`,
          [testUser.userId, weaponId]
        );
        characterItemId = itemResult.rows[0].id;

        // Create a listing for this item
        const listingResult = await client.query(
          `INSERT INTO item_listings (seller_id, character_id, character_item_id, item_template_id, price, status)
           VALUES ($1, $2, $3, $4, 1000, 'active')
           RETURNING id`,
          [testUser.userId, testCharacter.id, characterItemId, weaponId]
        );
        listingId = listingResult.rows[0].id;

        // Mark item as listed
        await client.query(
          'UPDATE character_items SET modifications = $1::jsonb WHERE id = $2',
          [JSON.stringify({ listed: true }), characterItemId]
        );

        await client.query('COMMIT');

        // Fetch sellable inventory
        const res = await request(
          'GET',
          '/api/marketplace/inventory/sellable',
          null,
          testUser.accessToken
        );

        assert.strictEqual(res.status, 200);

        // The listed item should not appear
        const hasListedItem = res.body.items.some(
          item => item.instanceId === characterItemId
        );

        assert.strictEqual(
          hasListedItem,
          false,
          'Already listed items should not appear in sellable inventory'
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        // Cleanup
        if (listingId) {
          await query('DELETE FROM item_listings WHERE id = $1', [listingId]).catch(() => {});
        }
        if (characterItemId) {
          await query('DELETE FROM character_items WHERE id = $1', [characterItemId]).catch(() => {});
        }
        client.release();
      }
    });

    it('should return every matching item instance from the shared inventory', async () => {
      if (!tradeableItemId) {
        console.log('Skipping test - no tradeable items available');
        return;
      }

      const client = await getClient();
      let item1Id = null;
      let item2Id = null;

      try {
        await client.query('BEGIN');

        // Shared inventory can contain separate instances of the same template.
        const item1Result = await client.query(
          `INSERT INTO character_items (user_id, item_template_id, quantity, equipped_slot)
           VALUES ($1, $2, 3, NULL) RETURNING id`,
          [testUser.userId, tradeableItemId]
        );
        item1Id = item1Result.rows[0].id;

        const item2Result = await client.query(
          `INSERT INTO character_items (user_id, item_template_id, quantity, equipped_slot)
           VALUES ($1, $2, 2, NULL) RETURNING id`,
          [testUser.userId, tradeableItemId]
        );
        item2Id = item2Result.rows[0].id;

        await client.query('COMMIT');

        // Fetch sellable inventory
        const res = await request(
          'GET',
          '/api/marketplace/inventory/sellable',
          null,
          testUser.accessToken
        );

        assert.strictEqual(res.status, 200);

        const instanceIds = new Set(res.body.items.map(item => item.instanceId));

        assert.ok(
          instanceIds.has(item1Id),
          'Should include the first shared item instance'
        );
        assert.ok(
          instanceIds.has(item2Id),
          'Should include the second shared item instance'
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        if (item1Id) {
          await query('DELETE FROM character_items WHERE id = $1', [item1Id]).catch(() => {});
        }
        if (item2Id) {
          await query('DELETE FROM character_items WHERE id = $1', [item2Id]).catch(() => {});
        }
        client.release();
      }
    });

    it('should return item details including name, type, and quantity', async () => {
      if (!tradeableItemId) {
        console.log('Skipping test - no tradeable items available');
        return;
      }

      const client = await getClient();
      let createdItemId = null;

      try {
        await client.query('BEGIN');

        // Ensure the shared inventory has an item.
        const itemResult = await client.query(
          `INSERT INTO character_items (user_id, item_template_id, quantity, equipped_slot)
           VALUES ($1, $2, 7, NULL) RETURNING id`,
          [testUser.userId, tradeableItemId]
        );
        createdItemId = itemResult.rows[0].id;

        await client.query('COMMIT');

        // Fetch sellable inventory
        const res = await request(
          'GET',
          '/api/marketplace/inventory/sellable',
          null,
          testUser.accessToken
        );

        assert.strictEqual(res.status, 200);
        assert.ok(res.body.items.length > 0, 'Should have at least one item');

        // Find our created item
        const item = res.body.items.find(i => i.instanceId === createdItemId);
        assert.ok(item, 'Should find our created item');

        // Verify essential fields are present
        assert.ok(item.instanceId !== undefined, 'Should have instanceId');
        assert.ok(item.templateId !== undefined, 'Should have templateId');
        assert.ok(item.name !== undefined, 'Should have name');
        assert.ok(item.type !== undefined, 'Should have type');
        assert.ok(item.quantity !== undefined, 'Should have quantity');
        assert.ok(item.spriteId !== undefined, 'Should have spriteId for icon rendering');
        assert.strictEqual(item.quantity, 7, 'Quantity should be 7');

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        if (createdItemId) {
          await query('DELETE FROM character_items WHERE id = $1', [createdItemId]).catch(() => {});
        }
        client.release();
      }
    });

    it('should not return items from other users', async () => {
      if (!tradeableItemId) {
        console.log('Skipping test - no tradeable items available');
        return;
      }

      const client = await getClient();
      let otherUserItemId = null;

      try {
        await client.query('BEGIN');

        // Give testUser2 a shared-pool item.
        const result = await client.query(
          `INSERT INTO character_items (user_id, item_template_id, quantity, equipped_slot)
           VALUES ($1, $2, 10, NULL) RETURNING id`,
          [testUser2.userId, tradeableItemId]
        );
        otherUserItemId = result.rows[0].id;

        await client.query('COMMIT');

        // Fetch sellable inventory for testUser (NOT testUser2)
        const res = await request(
          'GET',
          '/api/marketplace/inventory/sellable',
          null,
          testUser.accessToken
        );

        assert.strictEqual(res.status, 200);

        // Should not contain items from testUser2's shared inventory.
        const hasOtherUserItem = res.body.items.some(
          item => item.instanceId === otherUserItemId
        );

        assert.strictEqual(
          hasOtherUserItem,
          false,
          'Should not return items from other users'
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        if (otherUserItemId) {
          await query('DELETE FROM character_items WHERE id = $1', [otherUserItemId]).catch(() => {});
        }
        client.release();
      }
    });
  });

  describe('GET /api/marketplace/search', () => {
    it('should require authentication', async () => {
      const res = await request('GET', '/api/marketplace/search');

      assert.strictEqual(res.status, 401, 'Should reject unauthenticated request');
    });

    it('should return items array on success', async () => {
      const res = await request(
        'GET',
        '/api/marketplace/search',
        null,
        testUser.accessToken
      );

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.items), 'Should return items array');
    });

    it('should filter by search term', async () => {
      const res = await request(
        'GET',
        '/api/marketplace/search?q=sword',
        null,
        testUser.accessToken
      );

      assert.strictEqual(res.status, 200);

      // If we have results, they should contain "sword" in name
      for (const item of res.body.items) {
        assert.ok(
          item.name.toLowerCase().includes('sword'),
          `Item name "${item.name}" should contain "sword"`
        );
      }
    });

    it('should filter by item type', async () => {
      const res = await request(
        'GET',
        '/api/marketplace/search?type=weapon',
        null,
        testUser.accessToken
      );

      assert.strictEqual(res.status, 200);

      // All results should be weapons
      for (const item of res.body.items) {
        assert.strictEqual(
          item.itemType,
          'weapon',
          `Item type should be weapon, got ${item.itemType}`
        );
      }
    });

    it('should respect limit parameter', async () => {
      const res = await request(
        'GET',
        '/api/marketplace/search?limit=5',
        null,
        testUser.accessToken
      );

      assert.strictEqual(res.status, 200);
      assert.ok(
        res.body.items.length <= 5,
        `Should return at most 5 items, got ${res.body.items.length}`
      );
    });
  });

  describe('GET /api/marketplace/orders/mine', () => {
    it('should require authentication', async () => {
      const res = await request('GET', '/api/marketplace/orders/mine');

      assert.strictEqual(res.status, 401);
    });

    it('should return orders array', async () => {
      const res = await request(
        'GET',
        '/api/marketplace/orders/mine',
        null,
        testUser.accessToken
      );

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.orders !== undefined, 'Should have orders property');
      assert.ok(Array.isArray(res.body.orders), 'orders should be an array');
    });
  });

  describe('POST /api/marketplace/orders/limit - Validation', () => {
    it('should require authentication', async () => {
      const res = await request('POST', '/api/marketplace/orders/limit', {
        itemTemplateId: 1,
        side: 'buy',
        price: 100,
        quantity: 1,
        characterId: 1
      });

      assert.strictEqual(res.status, 401);
    });

    it('should reject invalid side value', async () => {
      const res = await request(
        'POST',
        '/api/marketplace/orders/limit',
        {
          itemTemplateId: tradeableItemId || 1,
          side: 'invalid',
          price: 100,
          quantity: 1,
          characterId: testCharacter.id
        },
        testUser.accessToken
      );

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error, 'Should have error message');
    });

    it('should reject price below 1', async () => {
      const res = await request(
        'POST',
        '/api/marketplace/orders/limit',
        {
          itemTemplateId: tradeableItemId || 1,
          side: 'buy',
          price: 0,
          quantity: 1,
          characterId: testCharacter.id
        },
        testUser.accessToken
      );

      assert.strictEqual(res.status, 400);
    });

    it('should reject quantity above 9999', async () => {
      const res = await request(
        'POST',
        '/api/marketplace/orders/limit',
        {
          itemTemplateId: tradeableItemId || 1,
          side: 'buy',
          price: 100,
          quantity: 10000,
          characterId: testCharacter.id
        },
        testUser.accessToken
      );

      assert.strictEqual(res.status, 400);
    });

    it('should reject non-integer price', async () => {
      const res = await request(
        'POST',
        '/api/marketplace/orders/limit',
        {
          itemTemplateId: tradeableItemId || 1,
          side: 'buy',
          price: 'abc',
          quantity: 1,
          characterId: testCharacter.id
        },
        testUser.accessToken
      );

      assert.strictEqual(res.status, 400);
    });

    it('should reject character not owned by user', async () => {
      const res = await request(
        'POST',
        '/api/marketplace/orders/limit',
        {
          itemTemplateId: tradeableItemId || 1,
          side: 'buy',
          price: 100,
          quantity: 1,
          characterId: testCharacter2.id // Owned by testUser2
        },
        testUser.accessToken
      );

      assert.strictEqual(res.status, 404);
    });
  });
});
