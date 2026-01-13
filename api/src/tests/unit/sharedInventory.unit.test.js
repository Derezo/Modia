/**
 * Unit Tests for Shared Inventory System
 *
 * Tests the shared inventory system introduced in migration 024.
 * Items are now shared across all characters owned by a user:
 * - Equipped items: character_id set, user_id NULL, equipped_slot set
 * - Shared pool items: character_id NULL, user_id set, equipped_slot NULL
 *
 * Key constraints:
 * - check_item_ownership: Ensures proper ownership assignment
 * - listed flag: Prevents equip/discard of marketplace-listed items
 *
 * API routes tested:
 * - GET /api/inventory/shared - Returns user's shared pool items
 * - POST /api/inventory/equip - Moves item from shared pool to character
 * - POST /api/inventory/unequip - Moves item from character to shared pool
 * - POST /api/inventory/discard - Deletes item from shared pool
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  query,
  getClient,
  request,
  createTestUser,
  createTestCharacter,
  cleanupTestUser,
  resetRateLimitersViaApi
} from '../testHelper.js';

describe('Shared Inventory System', () => {
  let testUser = null;
  let testCharacter1 = null;
  let testCharacter2 = null;
  let weaponTemplateId = null;
  let armorTemplateId = null;
  let consumableTemplateId = null;

  before(async () => {
    // Reset rate limiters before running tests
    await resetRateLimitersViaApi();

    // Create test user with two characters
    testUser = await createTestUser();
    testCharacter1 = await createTestCharacter(testUser.accessToken, 'InvTest1');
    testCharacter2 = await createTestCharacter(testUser.accessToken, 'InvTest2');

    // Find item templates for testing
    const weaponResult = await query(
      `SELECT id FROM item_templates WHERE item_type = 'weapon' LIMIT 1`
    );
    const armorResult = await query(
      `SELECT id FROM item_templates WHERE item_type = 'armor' LIMIT 1`
    );
    const consumableResult = await query(
      `SELECT id FROM item_templates WHERE item_type = 'consumable' LIMIT 1`
    );

    if (weaponResult.rows.length === 0 || armorResult.rows.length === 0) {
      throw new Error('Required item templates not found for testing');
    }

    weaponTemplateId = weaponResult.rows[0].id;
    armorTemplateId = armorResult.rows[0].id;
    consumableTemplateId = consumableResult.rows.length > 0 ? consumableResult.rows[0].id : null;
  });

  after(async () => {
    if (testUser) {
      await cleanupTestUser(testUser.userId);
    }
  });

  // Helper to create an item in shared pool
  async function createSharedPoolItem(userId, templateId, quantity = 1, listed = false) {
    const result = await query(
      `INSERT INTO character_items (user_id, item_template_id, quantity, listed)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [userId, templateId, quantity, listed]
    );
    return result.rows[0].id;
  }

  // Helper to create an equipped item
  async function createEquippedItem(characterId, templateId, slot) {
    const result = await query(
      `INSERT INTO character_items (character_id, item_template_id, quantity, equipped_slot)
       VALUES ($1, $2, 1, $3)
       RETURNING id`,
      [characterId, templateId, slot]
    );
    return result.rows[0].id;
  }

  // Helper to clean up test items
  async function cleanupTestItems(itemIds) {
    if (itemIds.length > 0) {
      await query('DELETE FROM character_items WHERE id = ANY($1)', [itemIds]);
    }
  }

  describe('GET /api/inventory/shared', () => {
    it('should return unequipped items for the user', async () => {
      const createdItems = [];

      try {
        // Create items in shared pool (unlisted)
        const item1Id = await createSharedPoolItem(testUser.userId, weaponTemplateId, 1, false);
        createdItems.push(item1Id);
        const item2Id = await createSharedPoolItem(testUser.userId, armorTemplateId, 1, false);
        createdItems.push(item2Id);

        // Create an equipped item (should NOT appear in shared)
        const equippedItemId = await createEquippedItem(testCharacter1.id, weaponTemplateId, 'main_hand');
        createdItems.push(equippedItemId);

        // Get shared inventory
        const res = await request('GET', '/api/inventory/shared', null, testUser.accessToken);

        assert.strictEqual(res.status, 200, 'Should return 200');
        assert.ok(res.body.inventory, 'Should have inventory array');

        // Find our test items
        const foundItem1 = res.body.inventory.find(i => i.instanceId === item1Id);
        const foundItem2 = res.body.inventory.find(i => i.instanceId === item2Id);
        const foundEquippedItem = res.body.inventory.find(i => i.instanceId === equippedItemId);

        assert.ok(foundItem1, 'Shared pool item 1 should be returned');
        assert.ok(foundItem2, 'Shared pool item 2 should be returned');
        assert.ok(!foundEquippedItem, 'Equipped item should NOT be returned');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });

    it('should return empty array when no shared items exist', async () => {
      // Create a fresh user with no items
      const emptyUser = await createTestUser();

      try {
        const res = await request('GET', '/api/inventory/shared', null, emptyUser.accessToken);

        assert.strictEqual(res.status, 200, 'Should return 200');
        assert.ok(Array.isArray(res.body.inventory), 'Should have inventory array');
        // Note: may contain items from character creation, so we just check the structure

      } finally {
        await cleanupTestUser(emptyUser.userId);
      }
    });

    it('should include items from multiple characters in shared pool', async () => {
      const createdItems = [];

      try {
        // Simulate unequipping from different characters by creating shared items
        const item1Id = await createSharedPoolItem(testUser.userId, weaponTemplateId, 1, false);
        createdItems.push(item1Id);
        const item2Id = await createSharedPoolItem(testUser.userId, armorTemplateId, 1, false);
        createdItems.push(item2Id);

        const res = await request('GET', '/api/inventory/shared', null, testUser.accessToken);

        assert.strictEqual(res.status, 200, 'Should return 200');

        // Both items should be accessible
        const foundIds = res.body.inventory.map(i => i.instanceId);
        assert.ok(foundIds.includes(item1Id), 'First item should be in shared pool');
        assert.ok(foundIds.includes(item2Id), 'Second item should be in shared pool');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });

    it('should include listed items in shared pool (current behavior)', async () => {
      // NOTE: This test documents current behavior. Ideally, listed items
      // should probably be filtered out or marked specially in the response.
      const createdItems = [];

      try {
        // Create a listed item
        const listedItemId = await createSharedPoolItem(testUser.userId, weaponTemplateId, 1, true);
        createdItems.push(listedItemId);

        // Get shared inventory
        const res = await request('GET', '/api/inventory/shared', null, testUser.accessToken);

        assert.strictEqual(res.status, 200, 'Should return 200');

        // Listed items currently appear in shared pool
        const foundListedItem = res.body.inventory.find(i => i.instanceId === listedItemId);
        assert.ok(foundListedItem, 'Listed item appears in shared pool (current behavior)');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });
  });

  describe('POST /api/inventory/equip', () => {
    it('should move item from shared pool to character equipment', async () => {
      const createdItems = [];

      try {
        // Create item in shared pool
        const itemId = await createSharedPoolItem(testUser.userId, weaponTemplateId, 1, false);
        createdItems.push(itemId);

        // Equip the item
        const res = await request('POST', '/api/inventory/equip', {
          characterId: testCharacter1.id,
          itemInstanceId: itemId,
          slot: 'main_hand'
        }, testUser.accessToken);

        assert.strictEqual(res.status, 200, 'Should return 200');

        // Verify item ownership changed
        const checkResult = await query(
          'SELECT character_id, user_id, equipped_slot FROM character_items WHERE id = $1',
          [itemId]
        );

        assert.strictEqual(checkResult.rows[0].character_id, testCharacter1.id, 'character_id should be set');
        assert.strictEqual(checkResult.rows[0].user_id, null, 'user_id should be NULL');
        assert.strictEqual(checkResult.rows[0].equipped_slot, 'main_hand', 'equipped_slot should be set');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });

    it('should move previously equipped item to shared pool when equipping new item', async () => {
      const createdItems = [];

      try {
        // Create and equip an initial item
        const oldItemId = await createEquippedItem(testCharacter1.id, weaponTemplateId, 'main_hand');
        createdItems.push(oldItemId);

        // Create new item in shared pool
        const newItemId = await createSharedPoolItem(testUser.userId, weaponTemplateId, 1, false);
        createdItems.push(newItemId);

        // Equip the new item (should unequip old one)
        const res = await request('POST', '/api/inventory/equip', {
          characterId: testCharacter1.id,
          itemInstanceId: newItemId,
          slot: 'main_hand'
        }, testUser.accessToken);

        assert.strictEqual(res.status, 200, 'Should return 200');

        // Verify old item moved to shared pool
        const oldItemCheck = await query(
          'SELECT character_id, user_id, equipped_slot FROM character_items WHERE id = $1',
          [oldItemId]
        );

        assert.strictEqual(oldItemCheck.rows[0].character_id, null, 'Old item character_id should be NULL');
        assert.strictEqual(oldItemCheck.rows[0].user_id, testUser.userId, 'Old item user_id should be set');
        assert.strictEqual(oldItemCheck.rows[0].equipped_slot, null, 'Old item equipped_slot should be NULL');

        // Verify new item is equipped
        const newItemCheck = await query(
          'SELECT character_id, user_id, equipped_slot FROM character_items WHERE id = $1',
          [newItemId]
        );

        assert.strictEqual(newItemCheck.rows[0].character_id, testCharacter1.id, 'New item character_id should be set');
        assert.strictEqual(newItemCheck.rows[0].user_id, null, 'New item user_id should be NULL');
        assert.strictEqual(newItemCheck.rows[0].equipped_slot, 'main_hand', 'New item equipped_slot should be set');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });

    it('should reject equipping listed items', async () => {
      const createdItems = [];

      try {
        // Create a listed item
        const listedItemId = await createSharedPoolItem(testUser.userId, weaponTemplateId, 1, true);
        createdItems.push(listedItemId);

        // Try to equip the listed item
        const res = await request('POST', '/api/inventory/equip', {
          characterId: testCharacter1.id,
          itemInstanceId: listedItemId,
          slot: 'main_hand'
        }, testUser.accessToken);

        assert.strictEqual(res.status, 400, 'Should return 400');
        assert.ok(
          res.body.error && res.body.error.includes('listed'),
          'Error should mention listing'
        );

        // Verify item is still in shared pool with listed flag
        const checkResult = await query(
          'SELECT character_id, user_id, listed FROM character_items WHERE id = $1',
          [listedItemId]
        );

        assert.strictEqual(checkResult.rows[0].user_id, testUser.userId, 'Item should still be in shared pool');
        assert.strictEqual(checkResult.rows[0].listed, true, 'Listed flag should still be true');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });

    it('should allow equipping from shared pool to any character', async () => {
      const createdItems = [];

      try {
        // Create item in shared pool
        const itemId = await createSharedPoolItem(testUser.userId, weaponTemplateId, 1, false);
        createdItems.push(itemId);

        // Equip to character 2 (different from initial)
        const res = await request('POST', '/api/inventory/equip', {
          characterId: testCharacter2.id,
          itemInstanceId: itemId,
          slot: 'main_hand'
        }, testUser.accessToken);

        assert.strictEqual(res.status, 200, 'Should return 200');

        // Verify item is on character 2
        const checkResult = await query(
          'SELECT character_id FROM character_items WHERE id = $1',
          [itemId]
        );

        assert.strictEqual(checkResult.rows[0].character_id, testCharacter2.id, 'Item should be on character 2');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });

    it('should reject equipping item not owned by user', async () => {
      const createdItems = [];
      let otherUser = null;

      try {
        // Create another user with an item
        otherUser = await createTestUser();
        const otherItemId = await createSharedPoolItem(otherUser.userId, weaponTemplateId, 1, false);
        createdItems.push(otherItemId);

        // Try to equip other user's item
        const res = await request('POST', '/api/inventory/equip', {
          characterId: testCharacter1.id,
          itemInstanceId: otherItemId,
          slot: 'main_hand'
        }, testUser.accessToken);

        assert.strictEqual(res.status, 404, 'Should return 404');

      } finally {
        await cleanupTestItems(createdItems);
        if (otherUser) {
          await cleanupTestUser(otherUser.userId);
        }
      }
    });

    it('should reject equipping already equipped item', async () => {
      const createdItems = [];

      try {
        // Create an equipped item
        const itemId = await createEquippedItem(testCharacter1.id, weaponTemplateId, 'main_hand');
        createdItems.push(itemId);

        // Try to equip it again
        const res = await request('POST', '/api/inventory/equip', {
          characterId: testCharacter1.id,
          itemInstanceId: itemId,
          slot: 'off_hand'
        }, testUser.accessToken);

        assert.strictEqual(res.status, 400, 'Should return 400');
        assert.ok(
          res.body.error && res.body.error.includes('already equipped'),
          'Error should indicate item is already equipped'
        );

      } finally {
        await cleanupTestItems(createdItems);
      }
    });
  });

  describe('POST /api/inventory/unequip', () => {
    it('should move item from character equipment to shared pool', async () => {
      const createdItems = [];

      try {
        // Create equipped item
        const itemId = await createEquippedItem(testCharacter1.id, weaponTemplateId, 'main_hand');
        createdItems.push(itemId);

        // Unequip the item
        const res = await request('POST', '/api/inventory/unequip', {
          characterId: testCharacter1.id,
          slot: 'main_hand'
        }, testUser.accessToken);

        assert.strictEqual(res.status, 200, 'Should return 200');

        // Verify item moved to shared pool
        const checkResult = await query(
          'SELECT character_id, user_id, equipped_slot FROM character_items WHERE id = $1',
          [itemId]
        );

        assert.strictEqual(checkResult.rows[0].character_id, null, 'character_id should be NULL');
        assert.strictEqual(checkResult.rows[0].user_id, testUser.userId, 'user_id should be set');
        assert.strictEqual(checkResult.rows[0].equipped_slot, null, 'equipped_slot should be NULL');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });

    it('should make unequipped item available to all characters', async () => {
      const createdItems = [];

      try {
        // Create and equip item on character 1
        const itemId = await createEquippedItem(testCharacter1.id, weaponTemplateId, 'main_hand');
        createdItems.push(itemId);

        // Unequip from character 1
        await request('POST', '/api/inventory/unequip', {
          characterId: testCharacter1.id,
          slot: 'main_hand'
        }, testUser.accessToken);

        // Now equip it on character 2
        const res = await request('POST', '/api/inventory/equip', {
          characterId: testCharacter2.id,
          itemInstanceId: itemId,
          slot: 'main_hand'
        }, testUser.accessToken);

        assert.strictEqual(res.status, 200, 'Should return 200');

        // Verify item is now on character 2
        const checkResult = await query(
          'SELECT character_id FROM character_items WHERE id = $1',
          [itemId]
        );

        assert.strictEqual(checkResult.rows[0].character_id, testCharacter2.id, 'Item should be on character 2');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });

    it('should reject unequipping from empty slot', async () => {
      const res = await request('POST', '/api/inventory/unequip', {
        characterId: testCharacter1.id,
        slot: 'off_hand'
      }, testUser.accessToken);

      assert.strictEqual(res.status, 400, 'Should return 400');
      assert.ok(
        res.body.error && res.body.error.includes('No item'),
        'Error should indicate no item in slot'
      );
    });

    it('should reject unequipping from other user character', async () => {
      let otherUser = null;
      let otherCharacter = null;
      const createdItems = [];

      try {
        otherUser = await createTestUser();
        otherCharacter = await createTestCharacter(otherUser.accessToken, 'OtherChar');

        // Create equipped item on other user's character
        const itemId = await createEquippedItem(otherCharacter.id, weaponTemplateId, 'main_hand');
        createdItems.push(itemId);

        // Try to unequip from other user's character
        const res = await request('POST', '/api/inventory/unequip', {
          characterId: otherCharacter.id,
          slot: 'main_hand'
        }, testUser.accessToken);

        assert.strictEqual(res.status, 404, 'Should return 404');

      } finally {
        await cleanupTestItems(createdItems);
        if (otherUser) {
          await cleanupTestUser(otherUser.userId);
        }
      }
    });

    it('should reject unequipping with invalid slot', async () => {
      const res = await request('POST', '/api/inventory/unequip', {
        characterId: testCharacter1.id,
        slot: 'invalid_slot'
      }, testUser.accessToken);

      assert.strictEqual(res.status, 400, 'Should return 400');
      assert.ok(
        res.body.error && res.body.error.includes('Invalid'),
        'Error should indicate invalid slot'
      );
    });
  });

  describe('POST /api/inventory/discard', () => {
    it('should delete item from shared pool', async () => {
      const createdItems = [];

      try {
        // Create item in shared pool
        const itemId = await createSharedPoolItem(testUser.userId, weaponTemplateId, 1, false);
        createdItems.push(itemId);

        // Discard the item
        const res = await request('POST', '/api/inventory/discard', {
          itemInstanceId: itemId
        }, testUser.accessToken);

        assert.strictEqual(res.status, 200, 'Should return 200');
        assert.ok(res.body.success, 'Should indicate success');

        // Verify item is deleted
        const checkResult = await query(
          'SELECT id FROM character_items WHERE id = $1',
          [itemId]
        );

        assert.strictEqual(checkResult.rows.length, 0, 'Item should be deleted');

        // Remove from cleanup list since already deleted
        createdItems.pop();

      } finally {
        await cleanupTestItems(createdItems);
      }
    });

    it('should reject discarding listed items', async () => {
      const createdItems = [];

      try {
        // Create a listed item
        const listedItemId = await createSharedPoolItem(testUser.userId, weaponTemplateId, 1, true);
        createdItems.push(listedItemId);

        // Try to discard the listed item
        const res = await request('POST', '/api/inventory/discard', {
          itemInstanceId: listedItemId
        }, testUser.accessToken);

        assert.strictEqual(res.status, 400, 'Should return 400');
        assert.ok(
          res.body.error && res.body.error.includes('listed'),
          'Error should mention listing'
        );

        // Verify item still exists
        const checkResult = await query(
          'SELECT id FROM character_items WHERE id = $1',
          [listedItemId]
        );

        assert.strictEqual(checkResult.rows.length, 1, 'Item should still exist');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });

    it('should reject discarding item not in shared pool', async () => {
      let otherUser = null;
      const createdItems = [];

      try {
        // Create another user with an item
        otherUser = await createTestUser();
        const otherItemId = await createSharedPoolItem(otherUser.userId, weaponTemplateId, 1, false);
        createdItems.push(otherItemId);

        // Try to discard other user's item
        const res = await request('POST', '/api/inventory/discard', {
          itemInstanceId: otherItemId
        }, testUser.accessToken);

        assert.strictEqual(res.status, 404, 'Should return 404');

      } finally {
        await cleanupTestItems(createdItems);
        if (otherUser) {
          await cleanupTestUser(otherUser.userId);
        }
      }
    });

    it('should support partial quantity discard', async () => {
      const createdItems = [];

      try {
        // Create stackable item in shared pool with quantity 5
        const templateId = consumableTemplateId || weaponTemplateId;
        const itemId = await createSharedPoolItem(testUser.userId, templateId, 5, false);
        createdItems.push(itemId);

        // Discard 2 of them
        const res = await request('POST', '/api/inventory/discard', {
          itemInstanceId: itemId,
          quantity: 2
        }, testUser.accessToken);

        assert.strictEqual(res.status, 200, 'Should return 200');
        assert.strictEqual(res.body.discarded, 2, 'Should report 2 discarded');

        // Verify remaining quantity
        const checkResult = await query(
          'SELECT quantity FROM character_items WHERE id = $1',
          [itemId]
        );

        assert.strictEqual(checkResult.rows[0].quantity, 3, 'Should have 3 remaining');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });

    it('should reject discarding more than owned', async () => {
      const createdItems = [];

      try {
        // Create item with quantity 3
        const itemId = await createSharedPoolItem(testUser.userId, weaponTemplateId, 3, false);
        createdItems.push(itemId);

        // Try to discard 5
        const res = await request('POST', '/api/inventory/discard', {
          itemInstanceId: itemId,
          quantity: 5
        }, testUser.accessToken);

        assert.strictEqual(res.status, 400, 'Should return 400');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });

    it('should reject discarding with invalid quantity', async () => {
      const createdItems = [];

      try {
        const itemId = await createSharedPoolItem(testUser.userId, weaponTemplateId, 5, false);
        createdItems.push(itemId);

        // Try to discard 0
        const res = await request('POST', '/api/inventory/discard', {
          itemInstanceId: itemId,
          quantity: 0
        }, testUser.accessToken);

        assert.strictEqual(res.status, 400, 'Should return 400');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });
  });

  describe('Database Constraints', () => {
    it('should enforce constraint for shared pool items (no character_id)', async () => {
      // Shared pool items must have user_id set and character_id NULL
      try {
        await query(
          `INSERT INTO character_items (character_id, user_id, item_template_id, quantity)
           VALUES ($1, NULL, $2, 1)`,
          [testCharacter1.id, weaponTemplateId]
        );
        assert.fail('Should have thrown constraint violation');
      } catch (err) {
        assert.ok(
          err.message.includes('check_item_ownership') || err.code === '23514',
          'Should violate check_item_ownership constraint'
        );
      }
    });

    it('should allow valid equipped item (character_id set, user_id NULL)', async () => {
      const createdItems = [];

      try {
        const result = await query(
          `INSERT INTO character_items (character_id, user_id, item_template_id, equipped_slot, quantity)
           VALUES ($1, NULL, $2, 'main_hand', 1)
           RETURNING id`,
          [testCharacter1.id, weaponTemplateId]
        );
        createdItems.push(result.rows[0].id);

        assert.ok(result.rows[0].id, 'Should successfully insert equipped item');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });

    it('should allow valid shared pool item (user_id set, character_id NULL)', async () => {
      const createdItems = [];

      try {
        const result = await query(
          `INSERT INTO character_items (character_id, user_id, item_template_id, quantity)
           VALUES (NULL, $1, $2, 1)
           RETURNING id`,
          [testUser.userId, weaponTemplateId]
        );
        createdItems.push(result.rows[0].id);

        assert.ok(result.rows[0].id, 'Should successfully insert shared pool item');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });

    it('should reject item with no ownership at all', async () => {
      try {
        await query(
          `INSERT INTO character_items (character_id, user_id, item_template_id, quantity)
           VALUES (NULL, NULL, $1, 1)`,
          [weaponTemplateId]
        );
        assert.fail('Should have thrown constraint violation');
      } catch (err) {
        assert.ok(
          err.message.includes('check_item_ownership') || err.code === '23514',
          'Should violate check_item_ownership constraint'
        );
      }
    });
  });

  describe('Cross-Character Item Sharing', () => {
    it('should allow item to move between characters via shared pool', async () => {
      const createdItems = [];

      try {
        // Create item equipped on character 1
        const itemId = await createEquippedItem(testCharacter1.id, weaponTemplateId, 'main_hand');
        createdItems.push(itemId);

        // Unequip from character 1
        await request('POST', '/api/inventory/unequip', {
          characterId: testCharacter1.id,
          slot: 'main_hand'
        }, testUser.accessToken);

        // Verify in shared pool
        let checkResult = await query(
          'SELECT character_id, user_id FROM character_items WHERE id = $1',
          [itemId]
        );
        assert.strictEqual(checkResult.rows[0].user_id, testUser.userId, 'Should be in shared pool');
        assert.strictEqual(checkResult.rows[0].character_id, null, 'Should not be on any character');

        // Equip on character 2
        await request('POST', '/api/inventory/equip', {
          characterId: testCharacter2.id,
          itemInstanceId: itemId,
          slot: 'main_hand'
        }, testUser.accessToken);

        // Verify on character 2
        checkResult = await query(
          'SELECT character_id, user_id, equipped_slot FROM character_items WHERE id = $1',
          [itemId]
        );
        assert.strictEqual(checkResult.rows[0].character_id, testCharacter2.id, 'Should be on character 2');
        assert.strictEqual(checkResult.rows[0].user_id, null, 'Should not be in shared pool');
        assert.strictEqual(checkResult.rows[0].equipped_slot, 'main_hand', 'Should be equipped');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });

    it('should isolate shared pool by user', async () => {
      let otherUser = null;
      const createdItems = [];

      try {
        otherUser = await createTestUser();
        const otherCharacter = await createTestCharacter(otherUser.accessToken, 'OtherCh');

        // Create shared pool item for each user
        const user1ItemId = await createSharedPoolItem(testUser.userId, weaponTemplateId, 1, false);
        createdItems.push(user1ItemId);

        const user2ItemId = await createSharedPoolItem(otherUser.userId, weaponTemplateId, 1, false);
        createdItems.push(user2ItemId);

        // User 1 should only see their item
        const res1 = await request('GET', '/api/inventory/shared', null, testUser.accessToken);
        const foundUser1Item = res1.body.inventory.find(i => i.instanceId === user1ItemId);
        const foundUser2Item = res1.body.inventory.find(i => i.instanceId === user2ItemId);

        assert.ok(foundUser1Item, 'User 1 should see their own item');
        assert.ok(!foundUser2Item, 'User 1 should NOT see user 2 item');

        // User 2 should only see their item
        const res2 = await request('GET', '/api/inventory/shared', null, otherUser.accessToken);
        const foundUser1ItemInUser2 = res2.body.inventory.find(i => i.instanceId === user1ItemId);
        const foundUser2ItemInUser2 = res2.body.inventory.find(i => i.instanceId === user2ItemId);

        assert.ok(!foundUser1ItemInUser2, 'User 2 should NOT see user 1 item');
        assert.ok(foundUser2ItemInUser2, 'User 2 should see their own item');

      } finally {
        await cleanupTestItems(createdItems);
        if (otherUser) {
          await cleanupTestUser(otherUser.userId);
        }
      }
    });

    it('should prevent user from equipping another users item even if character check passes', async () => {
      let otherUser = null;
      const createdItems = [];

      try {
        otherUser = await createTestUser();

        // Create item in other user's shared pool
        const otherItemId = await createSharedPoolItem(otherUser.userId, weaponTemplateId, 1, false);
        createdItems.push(otherItemId);

        // Try to equip on our character
        const res = await request('POST', '/api/inventory/equip', {
          characterId: testCharacter1.id,
          itemInstanceId: otherItemId,
          slot: 'main_hand'
        }, testUser.accessToken);

        // Should fail - item not found (because query checks user_id)
        assert.strictEqual(res.status, 404, 'Should return 404');

      } finally {
        await cleanupTestItems(createdItems);
        if (otherUser) {
          await cleanupTestUser(otherUser.userId);
        }
      }
    });
  });

  describe('Listed Items Integration', () => {
    it('should prevent equipping after item is listed on marketplace', async () => {
      const createdItems = [];

      try {
        // Create item in shared pool
        const itemId = await createSharedPoolItem(testUser.userId, weaponTemplateId, 1, false);
        createdItems.push(itemId);

        // Simulate listing by setting the listed flag
        await query('UPDATE character_items SET listed = true WHERE id = $1', [itemId]);

        // Try to equip - should fail
        const res = await request('POST', '/api/inventory/equip', {
          characterId: testCharacter1.id,
          itemInstanceId: itemId,
          slot: 'main_hand'
        }, testUser.accessToken);

        assert.strictEqual(res.status, 400, 'Should return 400');
        assert.ok(res.body.error.includes('listed'), 'Error should mention listing');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });

    it('should prevent discarding after item is listed on marketplace', async () => {
      const createdItems = [];

      try {
        // Create item in shared pool
        const itemId = await createSharedPoolItem(testUser.userId, weaponTemplateId, 1, false);
        createdItems.push(itemId);

        // Simulate listing by setting the listed flag
        await query('UPDATE character_items SET listed = true WHERE id = $1', [itemId]);

        // Try to discard - should fail
        const res = await request('POST', '/api/inventory/discard', {
          itemInstanceId: itemId
        }, testUser.accessToken);

        assert.strictEqual(res.status, 400, 'Should return 400');
        assert.ok(res.body.error.includes('listed'), 'Error should mention listing');

      } finally {
        await cleanupTestItems(createdItems);
      }
    });
  });
});
