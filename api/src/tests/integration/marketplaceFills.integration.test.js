/**
 * Integration tests for Marketplace complete fills
 *
 * Tests that buy and sell orders of equal quantity complete successfully,
 * including the case where a market buy drains a resting sell order.
 *
 * These tests require a running API server.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  request,
  createTestUser,
  createTestCharacter,
  cleanupTestUser,
  query,
  getClient
} from '../testHelper.js';

describe('Marketplace Complete Fills', () => {
  let seller = null;
  let buyer = null;
  let sellerCharacter = null;
  let buyerCharacter = null;
  let stackableItemId = null;

  before(async () => {
    // Create test users
    seller = await createTestUser();
    buyer = await createTestUser();
    sellerCharacter = await createTestCharacter(seller.accessToken);
    buyerCharacter = await createTestCharacter(buyer.accessToken);

    // Give buyer plenty of gold for purchases
    await query('UPDATE users SET gold = 1000000 WHERE id = $1', [buyer.userId]);
    // Give seller gold too (needed for some tests)
    await query('UPDATE users SET gold = 100000 WHERE id = $1', [seller.userId]);

    // Find a stackable tradeable item (consumable or material)
    const result = await query(
      `SELECT id FROM item_templates
       WHERE is_tradeable IS NOT FALSE
       AND is_stackable = TRUE
       AND item_type IN ('consumable', 'material')
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      throw new Error('Test setup failed: no stackable tradeable items found');
    }
    stackableItemId = result.rows[0].id;
  });

  after(async () => {
    // Cleanup test data
    // NOTE: Delete marketplace-related rows first because they have FK constraints
    // on user_id and character_id that prevent character/user deletion.
    // The root fix is a migration to add ON DELETE SET NULL/CASCADE to these FKs
    // (handoff to migrations owner - see marketplace_audit and market_trades tables).
    if (seller || buyer) {
      const userIds = [seller?.userId, buyer?.userId].filter(Boolean);
      if (userIds.length > 0) {
        // market_trades has FKs on buyer_id and seller_id
        await query(
          'DELETE FROM market_trades WHERE buyer_id = ANY($1) OR seller_id = ANY($1)',
          [userIds]
        ).catch(() => {});
        // marketplace_audit has FKs on user_id and character_id
        await query(
          'DELETE FROM marketplace_audit WHERE user_id = ANY($1)',
          [userIds]
        ).catch(() => {});
        // marketplace_tax_ledger has FKs on seller_id and buyer_id
        await query(
          'DELETE FROM marketplace_tax_ledger WHERE seller_id = ANY($1) OR buyer_id = ANY($1)',
          [userIds]
        ).catch(() => {});
      }
    }
    if (sellerCharacter || buyerCharacter) {
      const characterIds = [sellerCharacter?.id, buyerCharacter?.id].filter(Boolean);
      if (characterIds.length > 0) {
        await query(
          'DELETE FROM marketplace_audit WHERE character_id = ANY($1)',
          [characterIds]
        ).catch(() => {});
      }
    }

    if (seller) {
      await cleanupTestUser(seller.userId);
    }
    if (buyer) {
      await cleanupTestUser(buyer.userId);
    }
  });

  beforeEach(async () => {
    // Give seller some items to sell
    await query(
      `INSERT INTO character_items (user_id, item_template_id, quantity)
       VALUES ($1, $2, 100)
       ON CONFLICT DO NOTHING`,
      [seller.userId, stackableItemId]
    );
    // In case item already existed, just update quantity
    await query(
      `UPDATE character_items SET quantity = 100
       WHERE user_id = $1 AND item_template_id = $2 AND equipped_slot IS NULL`,
      [seller.userId, stackableItemId]
    );
  });

  afterEach(async () => {
    // Clean up any open orders
    await query(
      `UPDATE market_orders SET status = 'cancelled'
       WHERE user_id IN ($1, $2) AND status IN ('open', 'partial')`,
      [seller.userId, buyer.userId]
    );
    // Clean up escrow and reservations
    await query(
      `DELETE FROM item_escrow WHERE order_id IN (
         SELECT id FROM market_orders WHERE user_id IN ($1, $2)
       )`,
      [seller.userId, buyer.userId]
    );
    await query(
      `DELETE FROM gold_reservations WHERE order_id IN (
         SELECT id FROM market_orders WHERE user_id IN ($1, $2)
       )`,
      [seller.userId, buyer.userId]
    );
  });

  describe('Limit order complete fills', () => {
    it('should complete a buy limit order that exactly fills a resting sell order', async () => {
      const price = 100;
      const quantity = 5;

      // Seller places a sell limit order
      const sellRes = await request(
        'POST',
        '/api/marketplace/orders/limit',
        {
          itemTemplateId: stackableItemId,
          side: 'sell',
          price,
          quantity,
          characterId: sellerCharacter.id
        },
        seller.accessToken
      );

      assert.strictEqual(sellRes.status, 200, `Sell order failed: ${JSON.stringify(sellRes.body)}`);
      assert.strictEqual(sellRes.body.order.status, 'open', 'Sell order should be open');
      const sellOrderId = sellRes.body.order.id;

      // Buyer places a matching buy limit order
      const buyRes = await request(
        'POST',
        '/api/marketplace/orders/limit',
        {
          itemTemplateId: stackableItemId,
          side: 'buy',
          price,
          quantity,
          characterId: buyerCharacter.id
        },
        buyer.accessToken
      );

      assert.strictEqual(buyRes.status, 200, `Buy order failed: ${JSON.stringify(buyRes.body)}`);
      assert.strictEqual(buyRes.body.order.status, 'filled', 'Buy order should be filled');
      assert.strictEqual(buyRes.body.immediatelyFilled, true, 'Order should be immediately filled');

      // Verify both orders are filled
      const ordersCheck = await query(
        'SELECT id, status FROM market_orders WHERE id IN ($1, $2)',
        [sellOrderId, buyRes.body.order.id]
      );
      const orderStatuses = ordersCheck.rows.reduce((acc, row) => {
        acc[row.id] = row.status;
        return acc;
      }, {});

      assert.strictEqual(orderStatuses[sellOrderId], 'filled', 'Sell order should be filled');
      assert.strictEqual(orderStatuses[buyRes.body.order.id], 'filled', 'Buy order should be filled');

      // Verify no item_escrow or gold_reservations remain
      const escrowCheck = await query(
        'SELECT COUNT(*) as count FROM item_escrow WHERE order_id IN ($1, $2)',
        [sellOrderId, buyRes.body.order.id]
      );
      assert.strictEqual(parseInt(escrowCheck.rows[0].count, 10), 0, 'No item escrow should remain');

      const reservationCheck = await query(
        'SELECT COUNT(*) as count FROM gold_reservations WHERE order_id IN ($1, $2)',
        [sellOrderId, buyRes.body.order.id]
      );
      assert.strictEqual(parseInt(reservationCheck.rows[0].count, 10), 0, 'No gold reservations should remain');

      // Verify buyer received the items
      const buyerItems = await query(
        'SELECT quantity FROM character_items WHERE user_id = $1 AND item_template_id = $2 AND equipped_slot IS NULL',
        [buyer.userId, stackableItemId]
      );
      assert.ok(buyerItems.rows.length > 0, 'Buyer should have received items');
      assert.ok(
        buyerItems.rows.reduce((sum, r) => sum + parseInt(r.quantity, 10), 0) >= quantity,
        'Buyer should have received the correct quantity'
      );
    });

    it('should complete a sell limit order that exactly fills a resting buy order', async () => {
      const price = 150;
      const quantity = 3;

      // Buyer places a buy limit order first
      const buyRes = await request(
        'POST',
        '/api/marketplace/orders/limit',
        {
          itemTemplateId: stackableItemId,
          side: 'buy',
          price,
          quantity,
          characterId: buyerCharacter.id
        },
        buyer.accessToken
      );

      assert.strictEqual(buyRes.status, 200, `Buy order failed: ${JSON.stringify(buyRes.body)}`);
      assert.strictEqual(buyRes.body.order.status, 'open', 'Buy order should be open');
      const buyOrderId = buyRes.body.order.id;

      // Seller places a matching sell limit order
      const sellRes = await request(
        'POST',
        '/api/marketplace/orders/limit',
        {
          itemTemplateId: stackableItemId,
          side: 'sell',
          price,
          quantity,
          characterId: sellerCharacter.id
        },
        seller.accessToken
      );

      assert.strictEqual(sellRes.status, 200, `Sell order failed: ${JSON.stringify(sellRes.body)}`);
      assert.strictEqual(sellRes.body.order.status, 'filled', 'Sell order should be filled');

      // Verify both orders are filled
      const ordersCheck = await query(
        'SELECT id, status FROM market_orders WHERE id IN ($1, $2)',
        [buyOrderId, sellRes.body.order.id]
      );
      const orderStatuses = ordersCheck.rows.reduce((acc, row) => {
        acc[row.id] = row.status;
        return acc;
      }, {});

      assert.strictEqual(orderStatuses[buyOrderId], 'filled', 'Buy order should be filled');
      assert.strictEqual(orderStatuses[sellRes.body.order.id], 'filled', 'Sell order should be filled');

      // Verify no escrow or reservations remain
      const escrowCheck = await query(
        'SELECT COUNT(*) as count FROM item_escrow WHERE order_id IN ($1, $2)',
        [buyOrderId, sellRes.body.order.id]
      );
      assert.strictEqual(parseInt(escrowCheck.rows[0].count, 10), 0, 'No item escrow should remain');

      const reservationCheck = await query(
        'SELECT COUNT(*) as count FROM gold_reservations WHERE order_id IN ($1, $2)',
        [buyOrderId, sellRes.body.order.id]
      );
      assert.strictEqual(parseInt(reservationCheck.rows[0].count, 10), 0, 'No gold reservations should remain');
    });
  });

  describe('Market order complete fills', () => {
    it('should complete a market buy that drains a resting sell order', async () => {
      const price = 200;
      const quantity = 4;

      // Seller places a sell limit order
      const sellRes = await request(
        'POST',
        '/api/marketplace/orders/limit',
        {
          itemTemplateId: stackableItemId,
          side: 'sell',
          price,
          quantity,
          characterId: sellerCharacter.id
        },
        seller.accessToken
      );

      assert.strictEqual(sellRes.status, 200, `Sell order failed: ${JSON.stringify(sellRes.body)}`);
      const sellOrderId = sellRes.body.order.id;

      // Buyer executes a market buy for the exact quantity
      const buyRes = await request(
        'POST',
        '/api/marketplace/orders/market',
        {
          itemTemplateId: stackableItemId,
          side: 'buy',
          quantity,
          characterId: buyerCharacter.id
        },
        buyer.accessToken
      );

      assert.strictEqual(buyRes.status, 200, `Market buy failed: ${JSON.stringify(buyRes.body)}`);
      assert.strictEqual(buyRes.body.totalQuantity, quantity, 'Should fill exact quantity');

      // Verify the sell order is filled
      const sellOrderCheck = await query(
        'SELECT status FROM market_orders WHERE id = $1',
        [sellOrderId]
      );
      assert.strictEqual(sellOrderCheck.rows[0].status, 'filled', 'Sell order should be filled');

      // Verify no item escrow remains
      const escrowCheck = await query(
        'SELECT COUNT(*) as count FROM item_escrow WHERE order_id = $1',
        [sellOrderId]
      );
      assert.strictEqual(parseInt(escrowCheck.rows[0].count, 10), 0, 'No item escrow should remain');
    });

    it('should complete a market sell that drains a resting buy order', async () => {
      const price = 250;
      const quantity = 2;

      // Buyer places a buy limit order first
      const buyRes = await request(
        'POST',
        '/api/marketplace/orders/limit',
        {
          itemTemplateId: stackableItemId,
          side: 'buy',
          price,
          quantity,
          characterId: buyerCharacter.id
        },
        buyer.accessToken
      );

      assert.strictEqual(buyRes.status, 200, `Buy order failed: ${JSON.stringify(buyRes.body)}`);
      const buyOrderId = buyRes.body.order.id;

      // Seller executes a market sell for the exact quantity
      const sellRes = await request(
        'POST',
        '/api/marketplace/orders/market',
        {
          itemTemplateId: stackableItemId,
          side: 'sell',
          quantity,
          characterId: sellerCharacter.id
        },
        seller.accessToken
      );

      assert.strictEqual(sellRes.status, 200, `Market sell failed: ${JSON.stringify(sellRes.body)}`);
      assert.strictEqual(sellRes.body.totalQuantity, quantity, 'Should fill exact quantity');

      // Verify the buy order is filled
      const buyOrderCheck = await query(
        'SELECT status FROM market_orders WHERE id = $1',
        [buyOrderId]
      );
      assert.strictEqual(buyOrderCheck.rows[0].status, 'filled', 'Buy order should be filled');

      // Verify no gold reservations remain
      const reservationCheck = await query(
        'SELECT COUNT(*) as count FROM gold_reservations WHERE order_id = $1',
        [buyOrderId]
      );
      assert.strictEqual(parseInt(reservationCheck.rows[0].count, 10), 0, 'No gold reservations should remain');
    });
  });

  describe('Price improvement', () => {
    it('should refund price improvement when buy fills at a lower price', async () => {
      const buyPrice = 300;
      const sellPrice = 200;
      const quantity = 1;

      // Get buyer's initial gold
      const initialGold = await query('SELECT gold FROM users WHERE id = $1', [buyer.userId]);
      const buyerInitialGold = parseInt(initialGold.rows[0].gold, 10);

      // Seller places a sell order at lower price
      const sellRes = await request(
        'POST',
        '/api/marketplace/orders/limit',
        {
          itemTemplateId: stackableItemId,
          side: 'sell',
          price: sellPrice,
          quantity,
          characterId: sellerCharacter.id
        },
        seller.accessToken
      );

      assert.strictEqual(sellRes.status, 200, `Sell order failed: ${JSON.stringify(sellRes.body)}`);

      // Buyer places buy order at higher price
      const buyRes = await request(
        'POST',
        '/api/marketplace/orders/limit',
        {
          itemTemplateId: stackableItemId,
          side: 'buy',
          price: buyPrice,
          quantity,
          characterId: buyerCharacter.id
        },
        buyer.accessToken
      );

      assert.strictEqual(buyRes.status, 200, `Buy order failed: ${JSON.stringify(buyRes.body)}`);

      // Verify buyer only paid the sell price (price improvement)
      const finalGold = await query('SELECT gold FROM users WHERE id = $1', [buyer.userId]);
      const buyerFinalGold = parseInt(finalGold.rows[0].gold, 10);

      // Buyer should have paid sellPrice, not buyPrice
      const goldSpent = buyerInitialGold - buyerFinalGold;
      assert.strictEqual(goldSpent, sellPrice * quantity, 'Buyer should only pay the execution price, not the limit price');

      // Verify no gold reservations remain
      const reservationCheck = await query(
        'SELECT COUNT(*) as count FROM gold_reservations WHERE order_id = $1',
        [buyRes.body.order.id]
      );
      assert.strictEqual(parseInt(reservationCheck.rows[0].count, 10), 0, 'No gold reservations should remain after price improvement');
    });
  });

  describe('Non-stackable item rejection', () => {
    it('should reject limit orders for non-stackable items', async () => {
      // Find a non-stackable item (weapon or armor)
      const nonStackableResult = await query(
        `SELECT id FROM item_templates
         WHERE is_tradeable IS NOT FALSE
         AND is_stackable = FALSE
         LIMIT 1`
      );

      if (nonStackableResult.rows.length === 0) {
        console.log('Skipping test - no non-stackable items found');
        return;
      }

      const nonStackableId = nonStackableResult.rows[0].id;

      const res = await request(
        'POST',
        '/api/marketplace/orders/limit',
        {
          itemTemplateId: nonStackableId,
          side: 'buy',
          price: 100,
          quantity: 1,
          characterId: buyerCharacter.id
        },
        buyer.accessToken
      );

      assert.strictEqual(res.status, 400, 'Should reject non-stackable items');
      assert.ok(res.body.error.includes('item listings'), 'Error should mention item listings');
    });

    it('should reject market orders for non-stackable items', async () => {
      // Find a non-stackable item
      const nonStackableResult = await query(
        `SELECT id FROM item_templates
         WHERE is_tradeable IS NOT FALSE
         AND is_stackable = FALSE
         LIMIT 1`
      );

      if (nonStackableResult.rows.length === 0) {
        console.log('Skipping test - no non-stackable items found');
        return;
      }

      const nonStackableId = nonStackableResult.rows[0].id;

      const res = await request(
        'POST',
        '/api/marketplace/orders/market',
        {
          itemTemplateId: nonStackableId,
          side: 'buy',
          quantity: 1,
          characterId: buyerCharacter.id
        },
        buyer.accessToken
      );

      assert.strictEqual(res.status, 400, 'Should reject non-stackable items');
      assert.ok(res.body.error.includes('item listings'), 'Error should mention item listings');
    });
  });
});
