/**
 * Unit tests for Shop Refresh Service
 *
 * Tests the checkAndRefreshShops function which handles periodic restocking
 * of NPC shop inventories. Each shop type has different restock intervals:
 * - Blacksmith: 24 hours (weapons/armor - slow production)
 * - Apothecary: 12 hours (consumables - moderate production)
 * - Farm: 6 hours (materials - fast production)
 *
 * Restocking is ADDITIVE - new stock is added to existing quantity,
 * capped at the restock_quantity maximum.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  query,
  pool,
  getClient
} from '../testHelper.js';

// Import the service being tested
import {
  checkAndRefreshShops,
  forceRestockShop,
  getRestockStatus
} from '../../services/shopRefreshService.js';
import shopRefreshService from '../../services/shopRefreshService.js';

describe('Shop Refresh Service', () => {
  let testNodeId = null;
  let testItemId = null;

  before(async () => {
    // Find a world node with a shop for testing
    const nodeResult = await query(
      `SELECT DISTINCT node_id FROM npc_shop_inventory LIMIT 1`
    );

    if (nodeResult.rows.length === 0) {
      // Create a test shop entry if none exist
      const worldNodeResult = await query(
        `SELECT id FROM world_nodes LIMIT 1`
      );

      if (worldNodeResult.rows.length === 0) {
        throw new Error('No world nodes found for testing');
      }

      testNodeId = worldNodeResult.rows[0].id;

      // Find a suitable item
      const itemResult = await query(
        `SELECT id FROM item_templates WHERE item_type = 'material' LIMIT 1`
      );

      if (itemResult.rows.length === 0) {
        throw new Error('No items found for testing');
      }

      testItemId = itemResult.rows[0].id;

      // Create test shop inventory
      await query(
        `INSERT INTO npc_shop_inventory (node_id, shop_type, item_template_id, quantity, restock_quantity, last_restock)
         VALUES ($1, 'farm', $2, 5, 20, NOW() - INTERVAL '7 hours')
         ON CONFLICT (node_id, shop_type, item_template_id) DO NOTHING`,
        [testNodeId, testItemId]
      );
    } else {
      testNodeId = nodeResult.rows[0].node_id;

      // Get an item from this shop
      const itemResult = await query(
        `SELECT item_template_id FROM npc_shop_inventory WHERE node_id = $1 LIMIT 1`,
        [testNodeId]
      );
      testItemId = itemResult.rows[0].item_template_id;
    }
  });

  after(async () => {
    // Clean up any test data we created
    // Note: We only clean up if we created the test data
    // Existing shop inventory should remain
  });

  describe('REFRESH_INTERVALS', () => {
    it('should have different intervals for each shop type', () => {
      const intervals = shopRefreshService.REFRESH_INTERVALS;

      assert.ok(intervals, 'REFRESH_INTERVALS should be exported');
      assert.ok(intervals.blacksmith, 'Blacksmith interval should exist');
      assert.ok(intervals.apothecary, 'Apothecary interval should exist');
      assert.ok(intervals.farm, 'Farm interval should exist');

      // Verify ordering: blacksmith > apothecary > farm
      assert.ok(
        intervals.blacksmith > intervals.apothecary,
        'Blacksmith should have longer interval than apothecary'
      );
      assert.ok(
        intervals.apothecary > intervals.farm,
        'Apothecary should have longer interval than farm'
      );

      // Verify specific values (in milliseconds)
      assert.strictEqual(intervals.blacksmith, 24 * 60 * 60 * 1000, 'Blacksmith should be 24 hours');
      assert.strictEqual(intervals.apothecary, 12 * 60 * 60 * 1000, 'Apothecary should be 12 hours');
      assert.strictEqual(intervals.farm, 6 * 60 * 60 * 1000, 'Farm should be 6 hours');
    });
  });

  describe('checkAndRefreshShops', () => {
    it('should return stats object with restocked and errors counts', async () => {
      const stats = await checkAndRefreshShops();

      assert.ok(stats, 'Stats should be returned');
      assert.ok(typeof stats.restocked === 'number', 'restocked should be a number');
      assert.ok(typeof stats.errors === 'number', 'errors should be a number');
      assert.ok(stats.restocked >= 0, 'restocked count should be non-negative');
      assert.ok(stats.errors >= 0, 'errors count should be non-negative');
    });

    it('should not restock items at max quantity', async () => {
      const client = await getClient();

      try {
        await client.query('BEGIN');

        // Set item to max quantity with recent restock
        await client.query(
          `UPDATE npc_shop_inventory
           SET quantity = restock_quantity, last_restock = NOW()
           WHERE node_id = $1 AND item_template_id = $2`,
          [testNodeId, testItemId]
        );

        await client.query('COMMIT');

        // Get quantity before refresh
        const beforeResult = await query(
          `SELECT quantity FROM npc_shop_inventory
           WHERE node_id = $1 AND item_template_id = $2`,
          [testNodeId, testItemId]
        );
        const quantityBefore = beforeResult.rows[0].quantity;

        // Run refresh
        await checkAndRefreshShops();

        // Verify quantity unchanged
        const afterResult = await query(
          `SELECT quantity FROM npc_shop_inventory
           WHERE node_id = $1 AND item_template_id = $2`,
          [testNodeId, testItemId]
        );
        const quantityAfter = afterResult.rows[0].quantity;

        assert.strictEqual(
          quantityAfter,
          quantityBefore,
          'Max quantity items should not be restocked'
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });

    it('should restock items below max when interval has passed', async () => {
      const client = await getClient();

      try {
        await client.query('BEGIN');

        // Set item to low quantity with old restock time (farm = 6 hours)
        await client.query(
          `UPDATE npc_shop_inventory
           SET quantity = 2, restock_quantity = 20, last_restock = NOW() - INTERVAL '7 hours', shop_type = 'farm'
           WHERE node_id = $1 AND item_template_id = $2`,
          [testNodeId, testItemId]
        );

        await client.query('COMMIT');

        // Get quantity before refresh
        const beforeResult = await query(
          `SELECT quantity, restock_quantity FROM npc_shop_inventory
           WHERE node_id = $1 AND item_template_id = $2`,
          [testNodeId, testItemId]
        );
        const quantityBefore = beforeResult.rows[0].quantity;
        const restockQty = beforeResult.rows[0].restock_quantity;

        // Run refresh
        await checkAndRefreshShops();

        // Verify quantity increased
        const afterResult = await query(
          `SELECT quantity FROM npc_shop_inventory
           WHERE node_id = $1 AND item_template_id = $2`,
          [testNodeId, testItemId]
        );
        const quantityAfter = afterResult.rows[0].quantity;

        assert.ok(
          quantityAfter > quantityBefore,
          `Quantity should increase from ${quantityBefore} after restock`
        );

        // Verify it did not exceed max
        assert.ok(
          quantityAfter <= restockQty,
          `Quantity ${quantityAfter} should not exceed max ${restockQty}`
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });

    it('should not restock if interval has not passed', async () => {
      const client = await getClient();

      try {
        await client.query('BEGIN');

        // Set item to low quantity but with RECENT restock time
        await client.query(
          `UPDATE npc_shop_inventory
           SET quantity = 5, restock_quantity = 20, last_restock = NOW() - INTERVAL '1 minute', shop_type = 'farm'
           WHERE node_id = $1 AND item_template_id = $2`,
          [testNodeId, testItemId]
        );

        await client.query('COMMIT');

        // Get quantity before refresh
        const beforeResult = await query(
          `SELECT quantity FROM npc_shop_inventory
           WHERE node_id = $1 AND item_template_id = $2`,
          [testNodeId, testItemId]
        );
        const quantityBefore = beforeResult.rows[0].quantity;

        // Run refresh
        await checkAndRefreshShops();

        // Verify quantity unchanged (interval not passed)
        const afterResult = await query(
          `SELECT quantity FROM npc_shop_inventory
           WHERE node_id = $1 AND item_template_id = $2`,
          [testNodeId, testItemId]
        );
        const quantityAfter = afterResult.rows[0].quantity;

        assert.strictEqual(
          quantityAfter,
          quantityBefore,
          'Should not restock when interval has not passed'
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });

    it('should add 25% of max capacity per restock (minimum 1)', async () => {
      const client = await getClient();

      try {
        await client.query('BEGIN');

        // Set item to 0 quantity with old restock
        await client.query(
          `UPDATE npc_shop_inventory
           SET quantity = 0, restock_quantity = 20, last_restock = NOW() - INTERVAL '7 hours', shop_type = 'farm'
           WHERE node_id = $1 AND item_template_id = $2`,
          [testNodeId, testItemId]
        );

        await client.query('COMMIT');

        // Run refresh
        await checkAndRefreshShops();

        // Verify quantity is 25% of max (20 * 0.25 = 5)
        const afterResult = await query(
          `SELECT quantity FROM npc_shop_inventory
           WHERE node_id = $1 AND item_template_id = $2`,
          [testNodeId, testItemId]
        );
        const quantityAfter = afterResult.rows[0].quantity;

        // 25% of 20 = 5
        assert.strictEqual(
          quantityAfter,
          5,
          'Should add 25% of max capacity (20 * 0.25 = 5)'
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });

    it('should cap restock at max quantity', async () => {
      const client = await getClient();

      try {
        await client.query('BEGIN');

        // Set item to just below max with old restock
        await client.query(
          `UPDATE npc_shop_inventory
           SET quantity = 18, restock_quantity = 20, last_restock = NOW() - INTERVAL '7 hours', shop_type = 'farm'
           WHERE node_id = $1 AND item_template_id = $2`,
          [testNodeId, testItemId]
        );

        await client.query('COMMIT');

        // Run refresh
        await checkAndRefreshShops();

        // Verify quantity is capped at 20, not 18 + 5 = 23
        const afterResult = await query(
          `SELECT quantity FROM npc_shop_inventory
           WHERE node_id = $1 AND item_template_id = $2`,
          [testNodeId, testItemId]
        );
        const quantityAfter = afterResult.rows[0].quantity;

        assert.strictEqual(
          quantityAfter,
          20,
          'Quantity should be capped at max (20), not 18 + 5 = 23'
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });

    it('should add minimum 1 item even for small restock_quantity', async () => {
      const client = await getClient();

      try {
        await client.query('BEGIN');

        // Set item with small restock_quantity (3) where 25% = 0.75 -> rounds to 0
        // But minimum should be 1
        await client.query(
          `UPDATE npc_shop_inventory
           SET quantity = 0, restock_quantity = 3, last_restock = NOW() - INTERVAL '7 hours', shop_type = 'farm'
           WHERE node_id = $1 AND item_template_id = $2`,
          [testNodeId, testItemId]
        );

        await client.query('COMMIT');

        // Run refresh
        await checkAndRefreshShops();

        // Verify at least 1 item was added
        const afterResult = await query(
          `SELECT quantity FROM npc_shop_inventory
           WHERE node_id = $1 AND item_template_id = $2`,
          [testNodeId, testItemId]
        );
        const quantityAfter = afterResult.rows[0].quantity;

        assert.ok(
          quantityAfter >= 1,
          'Should add at least 1 item even for small restock_quantity'
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });
  });

  describe('forceRestockShop', () => {
    it('should set all items to max quantity', async () => {
      const client = await getClient();

      try {
        await client.query('BEGIN');

        // Ensure low quantity
        await client.query(
          `UPDATE npc_shop_inventory
           SET quantity = 1
           WHERE node_id = $1`,
          [testNodeId]
        );

        await client.query('COMMIT');

        // Get the shop type
        const typeResult = await query(
          `SELECT DISTINCT shop_type FROM npc_shop_inventory WHERE node_id = $1`,
          [testNodeId]
        );
        const shopType = typeResult.rows[0].shop_type;

        // Force restock
        const restockedCount = await forceRestockShop(testNodeId, shopType);

        assert.ok(restockedCount > 0, 'Should report items restocked');

        // Verify all items at max
        const verifyResult = await query(
          `SELECT COUNT(*) as count FROM npc_shop_inventory
           WHERE node_id = $1 AND shop_type = $2 AND quantity < restock_quantity`,
          [testNodeId, shopType]
        );

        assert.strictEqual(
          parseInt(verifyResult.rows[0].count, 10),
          0,
          'All items should be at max quantity after force restock'
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });
  });

  describe('getRestockStatus', () => {
    it('should return correct status information', async () => {
      // Get a shop type from the test node
      const typeResult = await query(
        `SELECT DISTINCT shop_type FROM npc_shop_inventory WHERE node_id = $1 LIMIT 1`,
        [testNodeId]
      );

      if (typeResult.rows.length === 0) {
        console.log('Skipping getRestockStatus test - no shop inventory found');
        return;
      }

      const shopType = typeResult.rows[0].shop_type;

      const status = await getRestockStatus(testNodeId, shopType);

      assert.ok(status, 'Status should be returned');
      assert.strictEqual(status.shopType, shopType, 'Shop type should match');
      assert.strictEqual(status.nodeId, testNodeId, 'Node ID should match');
      assert.ok(typeof status.totalItems === 'number', 'totalItems should be a number');
      assert.ok(typeof status.lowStockItems === 'number', 'lowStockItems should be a number');
      assert.ok(status.restockIntervalMs > 0, 'restockIntervalMs should be positive');
      assert.ok(status.restockIntervalHours > 0, 'restockIntervalHours should be positive');
      assert.ok(typeof status.isOverdue === 'boolean', 'isOverdue should be boolean');
    });

    it('should correctly identify overdue status', async () => {
      const client = await getClient();

      try {
        await client.query('BEGIN');

        // Set old restock time (definitely overdue for farm)
        await client.query(
          `UPDATE npc_shop_inventory
           SET last_restock = NOW() - INTERVAL '7 hours', shop_type = 'farm', quantity = 1, restock_quantity = 10
           WHERE node_id = $1`,
          [testNodeId]
        );

        await client.query('COMMIT');

        const status = await getRestockStatus(testNodeId, 'farm');

        assert.strictEqual(
          status.isOverdue,
          true,
          'Should be marked as overdue (7 hours > 6 hour interval)'
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });
  });
});
