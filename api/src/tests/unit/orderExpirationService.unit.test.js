/**
 * Unit tests for Order Expiration Service
 *
 * Tests the expireOldOrders function which handles automatic expiration
 * of marketplace orders that have been open for longer than 7 days.
 *
 * For expired buy orders: reserved gold is returned to the user
 * For expired sell orders: escrowed items are returned to the character
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  query,
  pool,
  getClient,
  createTestUser,
  createTestCharacter,
  cleanupTestUser
} from '../testHelper.js';

// Import the service being tested
import {
  expireOldOrders,
  getExpirationConfig
} from '../../services/orderExpirationService.js';

describe('Order Expiration Service', () => {
  let testUser = null;
  let testCharacter = null;
  let tradeableItemId = null;

  before(async () => {
    // Create test user and character
    testUser = await createTestUser();
    testCharacter = await createTestCharacter(testUser.accessToken);

    // Find a tradeable item for testing (can be any type)
    const itemResult = await query(
      `SELECT id FROM item_templates
       WHERE is_tradeable IS NOT FALSE
       LIMIT 1`
    );

    if (itemResult.rows.length === 0) {
      throw new Error('No tradeable items found for testing');
    }
    tradeableItemId = itemResult.rows[0].id;
  });

  after(async () => {
    // Cleanup test data
    if (testUser) {
      await cleanupTestUser(testUser.userId);
    }
  });

  describe('getExpirationConfig', () => {
    it('should return configuration object', () => {
      const config = getExpirationConfig();

      assert.ok(config, 'Config should be returned');
      assert.strictEqual(config.expiryDays, 7, 'Default expiry should be 7 days');
      assert.ok(config.checkIntervalMs > 0, 'Check interval should be positive');
      assert.ok(typeof config.isRunning === 'boolean', 'isRunning should be boolean');
    });
  });

  describe('expireOldOrders', () => {
    it('should return stats object with expired and errors counts', async () => {
      const stats = await expireOldOrders();

      assert.ok(stats, 'Stats should be returned');
      assert.ok(typeof stats.expired === 'number', 'expired should be a number');
      assert.ok(typeof stats.errors === 'number', 'errors should be a number');
      assert.ok(stats.expired >= 0, 'expired count should be non-negative');
      assert.ok(stats.errors >= 0, 'errors count should be non-negative');
    });

    it('should not expire orders created within 7 days', async () => {
      const client = await getClient();
      let orderId = null;

      try {
        await client.query('BEGIN');

        // Give user some gold
        await client.query(
          'UPDATE users SET gold = gold + 10000 WHERE id = $1',
          [testUser.userId]
        );

        // Create a fresh buy order (should NOT be expired)
        const orderResult = await client.query(
          `INSERT INTO market_orders (user_id, character_id, item_template_id, side, price, quantity, status, created_at)
           VALUES ($1, $2, $3, 'buy', 100, 1, 'open', NOW())
           RETURNING id`,
          [testUser.userId, testCharacter.id, tradeableItemId]
        );
        orderId = orderResult.rows[0].id;

        // Create gold reservation
        await client.query(
          `INSERT INTO gold_reservations (user_id, order_id, amount) VALUES ($1, $2, 100)`,
          [testUser.userId, orderId]
        );

        await client.query('COMMIT');

        // Run expiration
        const stats = await expireOldOrders();

        // Verify order is still open
        const checkResult = await query(
          'SELECT status FROM market_orders WHERE id = $1',
          [orderId]
        );

        assert.strictEqual(
          checkResult.rows[0].status,
          'open',
          'Fresh order should still be open'
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        // Cleanup
        if (orderId) {
          await query('DELETE FROM gold_reservations WHERE order_id = $1', [orderId]).catch(() => {});
          await query('DELETE FROM market_orders WHERE id = $1', [orderId]).catch(() => {});
        }
        client.release();
      }
    });

    it('should expire buy orders older than 7 days and release gold', async () => {
      const client = await getClient();
      let orderId = null;

      try {
        await client.query('BEGIN');

        // Record initial gold
        const initialGoldResult = await client.query(
          'SELECT gold FROM users WHERE id = $1',
          [testUser.userId]
        );
        const initialGold = initialGoldResult.rows[0].gold;

        // Ensure user has enough gold
        await client.query(
          'UPDATE users SET gold = GREATEST(gold, 10000) WHERE id = $1',
          [testUser.userId]
        );

        // Create an old buy order (8 days ago)
        const orderResult = await client.query(
          `INSERT INTO market_orders (user_id, character_id, item_template_id, side, price, quantity, status, created_at)
           VALUES ($1, $2, $3, 'buy', 500, 2, 'open', NOW() - INTERVAL '8 days')
           RETURNING id`,
          [testUser.userId, testCharacter.id, tradeableItemId]
        );
        orderId = orderResult.rows[0].id;

        // Create gold reservation (500 * 2 = 1000 gold reserved)
        const reservationAmount = 1000;
        await client.query(
          `INSERT INTO gold_reservations (user_id, order_id, amount) VALUES ($1, $2, $3)`,
          [testUser.userId, orderId, reservationAmount]
        );

        // Deduct the reserved gold
        await client.query(
          'UPDATE users SET gold = gold - $1 WHERE id = $2',
          [reservationAmount, testUser.userId]
        );

        await client.query('COMMIT');

        // Get gold before expiration
        const beforeExpireResult = await query(
          'SELECT gold FROM users WHERE id = $1',
          [testUser.userId]
        );
        const goldBeforeExpire = beforeExpireResult.rows[0].gold;

        // Run expiration
        const stats = await expireOldOrders();

        // Verify order is now expired
        const orderCheckResult = await query(
          'SELECT status FROM market_orders WHERE id = $1',
          [orderId]
        );

        assert.strictEqual(
          orderCheckResult.rows[0].status,
          'expired',
          'Old order should be expired'
        );

        // Verify gold was returned
        const afterExpireResult = await query(
          'SELECT gold FROM users WHERE id = $1',
          [testUser.userId]
        );
        const goldAfterExpire = afterExpireResult.rows[0].gold;

        assert.strictEqual(
          goldAfterExpire,
          goldBeforeExpire + reservationAmount,
          'Reserved gold should be returned to user'
        );

        // Verify gold reservation was deleted
        const reservationCheck = await query(
          'SELECT * FROM gold_reservations WHERE order_id = $1',
          [orderId]
        );

        assert.strictEqual(
          reservationCheck.rows.length,
          0,
          'Gold reservation should be deleted'
        );

        // Verify audit log was created
        const auditCheck = await query(
          `SELECT * FROM marketplace_audit WHERE order_id = $1 AND event_type = 'order_expired'`,
          [orderId]
        );

        assert.ok(
          auditCheck.rows.length > 0,
          'Audit log entry should be created for expired order'
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        // Cleanup
        if (orderId) {
          await query('DELETE FROM marketplace_audit WHERE order_id = $1', [orderId]).catch(() => {});
          await query('DELETE FROM gold_reservations WHERE order_id = $1', [orderId]).catch(() => {});
          await query('DELETE FROM market_orders WHERE id = $1', [orderId]).catch(() => {});
        }
        client.release();
      }
    });

    it('should expire sell orders older than 7 days and return escrowed items', async () => {
      const client = await getClient();
      let orderId = null;
      let createdItemId = null;

      try {
        await client.query('BEGIN');

        // Create an item for the character to sell
        const itemResult = await client.query(
          `INSERT INTO character_items (character_id, item_template_id, quantity)
           VALUES ($1, $2, 10) RETURNING id`,
          [testCharacter.id, tradeableItemId]
        );
        createdItemId = itemResult.rows[0].id;

        // Get initial item quantity
        const initialQtyResult = await client.query(
          `SELECT COALESCE(SUM(quantity), 0) as total
           FROM character_items
           WHERE character_id = $1 AND item_template_id = $2 AND equipped_slot IS NULL`,
          [testCharacter.id, tradeableItemId]
        );
        const initialQuantity = parseInt(initialQtyResult.rows[0].total, 10);

        // Create an old sell order (8 days ago)
        const escrowedQuantity = 5;
        const orderResult = await client.query(
          `INSERT INTO market_orders (user_id, character_id, item_template_id, side, price, quantity, status, created_at)
           VALUES ($1, $2, $3, 'sell', 100, $4, 'open', NOW() - INTERVAL '8 days')
           RETURNING id`,
          [testUser.userId, testCharacter.id, tradeableItemId, escrowedQuantity]
        );
        orderId = orderResult.rows[0].id;

        // Create item escrow and deduct from inventory
        await client.query(
          `INSERT INTO item_escrow (order_id, character_id, item_template_id, quantity)
           VALUES ($1, $2, $3, $4)`,
          [orderId, testCharacter.id, tradeableItemId, escrowedQuantity]
        );

        await client.query(
          `UPDATE character_items SET quantity = quantity - $1
           WHERE id = $2`,
          [escrowedQuantity, createdItemId]
        );

        await client.query('COMMIT');

        // Get quantity before expiration
        const beforeQtyResult = await query(
          `SELECT COALESCE(SUM(quantity), 0) as total
           FROM character_items
           WHERE character_id = $1 AND item_template_id = $2 AND equipped_slot IS NULL`,
          [testCharacter.id, tradeableItemId]
        );
        const quantityBeforeExpire = parseInt(beforeQtyResult.rows[0].total, 10);

        // Run expiration
        await expireOldOrders();

        // Verify order is now expired
        const orderCheckResult = await query(
          'SELECT status FROM market_orders WHERE id = $1',
          [orderId]
        );

        assert.strictEqual(
          orderCheckResult.rows[0].status,
          'expired',
          'Old sell order should be expired'
        );

        // Verify items were returned
        const afterQtyResult = await query(
          `SELECT COALESCE(SUM(quantity), 0) as total
           FROM character_items
           WHERE character_id = $1 AND item_template_id = $2 AND equipped_slot IS NULL`,
          [testCharacter.id, tradeableItemId]
        );
        const quantityAfterExpire = parseInt(afterQtyResult.rows[0].total, 10);

        assert.strictEqual(
          quantityAfterExpire,
          quantityBeforeExpire + escrowedQuantity,
          'Escrowed items should be returned to character'
        );

        // Verify item escrow was deleted
        const escrowCheck = await query(
          'SELECT * FROM item_escrow WHERE order_id = $1',
          [orderId]
        );

        assert.strictEqual(
          escrowCheck.rows.length,
          0,
          'Item escrow should be deleted'
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        // Cleanup
        if (orderId) {
          await query('DELETE FROM marketplace_audit WHERE order_id = $1', [orderId]).catch(() => {});
          await query('DELETE FROM item_escrow WHERE order_id = $1', [orderId]).catch(() => {});
          await query('DELETE FROM market_orders WHERE id = $1', [orderId]).catch(() => {});
        }
        if (createdItemId) {
          await query('DELETE FROM character_items WHERE id = $1', [createdItemId]).catch(() => {});
        }
        client.release();
      }
    });

    it('should expire partial orders and release remaining gold', async () => {
      const client = await getClient();
      let orderId = null;

      try {
        await client.query('BEGIN');

        // Ensure user has gold
        await client.query(
          'UPDATE users SET gold = GREATEST(gold, 10000) WHERE id = $1',
          [testUser.userId]
        );

        // Create an old partial buy order (8 days ago)
        // Original: 10 qty at 100g each, 3 filled, 7 remaining
        const originalQty = 10;
        const filledQty = 3;
        const remainingQty = originalQty - filledQty;
        const pricePerUnit = 100;

        const orderResult = await client.query(
          `INSERT INTO market_orders (user_id, character_id, item_template_id, side, price, quantity, quantity_filled, status, created_at)
           VALUES ($1, $2, $3, 'buy', $4, $5, $6, 'partial', NOW() - INTERVAL '8 days')
           RETURNING id`,
          [testUser.userId, testCharacter.id, tradeableItemId, pricePerUnit, originalQty, filledQty]
        );
        orderId = orderResult.rows[0].id;

        // Create gold reservation for remaining amount only
        const remainingGold = remainingQty * pricePerUnit;
        await client.query(
          `INSERT INTO gold_reservations (user_id, order_id, amount) VALUES ($1, $2, $3)`,
          [testUser.userId, orderId, remainingGold]
        );

        // Deduct the reserved gold
        await client.query(
          'UPDATE users SET gold = gold - $1 WHERE id = $2',
          [remainingGold, testUser.userId]
        );

        await client.query('COMMIT');

        // Get gold before expiration
        const beforeExpireResult = await query(
          'SELECT gold FROM users WHERE id = $1',
          [testUser.userId]
        );
        const goldBeforeExpire = beforeExpireResult.rows[0].gold;

        // Run expiration
        await expireOldOrders();

        // Verify order is expired
        const orderCheckResult = await query(
          'SELECT status FROM market_orders WHERE id = $1',
          [orderId]
        );

        assert.strictEqual(
          orderCheckResult.rows[0].status,
          'expired',
          'Partial order should be expired'
        );

        // Verify remaining gold was returned
        const afterExpireResult = await query(
          'SELECT gold FROM users WHERE id = $1',
          [testUser.userId]
        );
        const goldAfterExpire = afterExpireResult.rows[0].gold;

        assert.strictEqual(
          goldAfterExpire,
          goldBeforeExpire + remainingGold,
          'Remaining reserved gold should be returned'
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        // Cleanup
        if (orderId) {
          await query('DELETE FROM marketplace_audit WHERE order_id = $1', [orderId]).catch(() => {});
          await query('DELETE FROM gold_reservations WHERE order_id = $1', [orderId]).catch(() => {});
          await query('DELETE FROM market_orders WHERE id = $1', [orderId]).catch(() => {});
        }
        client.release();
      }
    });

    it('should handle empty result set gracefully', async () => {
      // Run with no expired orders (assuming clean state)
      // This should not throw
      const stats = await expireOldOrders();

      assert.ok(stats, 'Should return stats even with no expired orders');
      assert.ok(stats.errors >= 0, 'Errors should be non-negative');
    });

    it('should continue processing if one order fails', async () => {
      // This test verifies error isolation - if one order fails to expire,
      // others should still be processed
      const client = await getClient();
      let order1Id = null;
      let order2Id = null;

      try {
        await client.query('BEGIN');

        // Give user gold
        await client.query(
          'UPDATE users SET gold = GREATEST(gold, 10000) WHERE id = $1',
          [testUser.userId]
        );

        // Create two old orders
        const order1Result = await client.query(
          `INSERT INTO market_orders (user_id, character_id, item_template_id, side, price, quantity, status, created_at)
           VALUES ($1, $2, $3, 'buy', 100, 1, 'open', NOW() - INTERVAL '8 days')
           RETURNING id`,
          [testUser.userId, testCharacter.id, tradeableItemId]
        );
        order1Id = order1Result.rows[0].id;

        const order2Result = await client.query(
          `INSERT INTO market_orders (user_id, character_id, item_template_id, side, price, quantity, status, created_at)
           VALUES ($1, $2, $3, 'buy', 200, 1, 'open', NOW() - INTERVAL '8 days')
           RETURNING id`,
          [testUser.userId, testCharacter.id, tradeableItemId]
        );
        order2Id = order2Result.rows[0].id;

        // Create reservation for order 2 only (order 1 will fail to release)
        await client.query(
          `INSERT INTO gold_reservations (user_id, order_id, amount) VALUES ($1, $2, $3)`,
          [testUser.userId, order2Id, 200]
        );

        await client.query('COMMIT');

        // Run expiration - should handle order 1 failure and continue to order 2
        const stats = await expireOldOrders();

        // Both orders should be attempted
        // order1 should have 0 gold returned (no reservation)
        // order2 should work normally

        // Verify at least some orders were processed
        assert.ok(
          stats.expired > 0 || stats.errors > 0,
          'Some orders should have been processed'
        );

      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        // Cleanup
        if (order1Id || order2Id) {
          await query('DELETE FROM marketplace_audit WHERE order_id = ANY($1)', [[order1Id, order2Id].filter(Boolean)]).catch(() => {});
          await query('DELETE FROM gold_reservations WHERE order_id = ANY($1)', [[order1Id, order2Id].filter(Boolean)]).catch(() => {});
          await query('DELETE FROM market_orders WHERE id = ANY($1)', [[order1Id, order2Id].filter(Boolean)]).catch(() => {});
        }
        client.release();
      }
    });
  });
});
