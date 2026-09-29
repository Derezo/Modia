/**
 * @module marketplace/orderManagement
 * @description Order placement, execution, and cancellation.
 *
 * Key responsibilities:
 * - Place limit orders with automatic matching
 * - Execute market orders at best available price
 * - Cancel open orders and return reservations
 * - Execute trades between matched orders
 * - Track user orders and trade history
 *
 * @see orderBook.js - Order book queries
 * @see escrow.js - Gold/item reservation
 */

import { AppError } from '../../middleware/errorHandler.js';
import { MAX_GOLD } from '../../config/constants.js';
import { MAX_OPEN_ORDERS_PER_USER } from '../../../../shared/constants.js';
import * as marketplaceWebsocket from '../marketplaceWebsocket.js';
import * as dailyQuestService from '../dailyQuestService.js';
import { pool } from '../../config/database.js';
import { DEFAULT_TAX_RATE } from './constants.js';
import { getOrderBook, getMatchingOrders } from './orderBook.js';
import {
  reserveGold,
  releaseGold,
  escrowItems,
  releaseEscrowedItems,
  reduceEscrow,
  consumeReservation,
  addItemToUser
} from './escrow.js';
import { getMarketplaceFeeRate } from '../relicService.js';

/**
 * Helper to get party leader character ID for a user (for quest tracking)
 * @param {number} userId - User ID
 * @returns {Promise<number|null>} Character ID or null
 */
async function getPartyLeaderId(userId) {
  const result = await pool.query(
    'SELECT id FROM characters WHERE user_id = $1 AND party_slot = 1',
    [userId]
  );
  return result.rows[0]?.id || null;
}

/**
 * Execute a trade between two orders
 * Applies a 5% seller fee which is logged to marketplace_tax_ledger
 * @param {Object} client - Database client
 * @param {Object} buyOrder - Buy order details
 * @param {Object} sellOrder - Sell order details
 * @param {number} quantity - Quantity to trade
 * @param {number} executionPrice - Price per item
 * @param {string|null} itemName - Item name for notifications
 * @param {number} sellerTaxRate - Tax rate to apply to seller
 * @returns {Promise<Object>} Trade result with audit info
 */
export async function executeTrade(client, buyOrder, sellOrder, quantity, executionPrice, itemName = null, sellerTaxRate = DEFAULT_TAX_RATE) {
  const itemTemplateId = buyOrder.item_template_id || sellOrder.item_template_id;

  // Record the trade
  const tradeResult = await client.query(
    `INSERT INTO market_trades
     (buy_order_id, sell_order_id, item_template_id, buyer_id, seller_id, price, quantity, total_gold)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      buyOrder.id,
      sellOrder.id,
      itemTemplateId,
      buyOrder.user_id,
      sellOrder.user_id,
      executionPrice,
      quantity,
      executionPrice * quantity
    ]
  );
  const tradeId = tradeResult.rows[0].id;

  // Update order fill quantities (triggers will update status)
  await client.query(
    'UPDATE market_orders SET quantity_filled = quantity_filled + $1 WHERE id = $2',
    [quantity, buyOrder.id]
  );

  await client.query(
    'UPDATE market_orders SET quantity_filled = quantity_filled + $1 WHERE id = $2',
    [quantity, sellOrder.id]
  );

  // Calculate marketplace fee (5% seller fee by default)
  const grossAmount = executionPrice * quantity;
  const taxAmount = Math.floor(grossAmount * sellerTaxRate);
  const netAmount = grossAmount - taxAmount;

  // Handle price improvement: if execution price < buy order's limit price, refund the difference
  // First, get the buy order's limit price to calculate price improvement
  const buyOrderPriceResult = await client.query(
    'SELECT price FROM market_orders WHERE id = $1',
    [buyOrder.id]
  );
  const buyLimitPrice = buyOrderPriceResult.rows[0] ? parseInt(buyOrderPriceResult.rows[0].price, 10) : executionPrice;

  // Amount to consume from reservation is based on the buy order's limit price (what was reserved)
  const reservedAmountUsed = buyLimitPrice * quantity;

  // Refund price improvement to buyer (if any)
  const priceImprovement = (buyLimitPrice - executionPrice) * quantity;
  if (priceImprovement > 0) {
    await client.query(
      'UPDATE users SET gold = LEAST(gold + $1, $2) WHERE id = $3',
      [priceImprovement, MAX_GOLD, buyOrder.user_id]
    );
  }

  // Consume buyer's gold reservation (the amount actually reserved at limit price)
  await consumeReservation(client, buyOrder.id, reservedAmountUsed);

  // Add gold to seller (NET amount after fee, capped at MAX_GOLD)
  await client.query(
    'UPDATE users SET gold = LEAST(gold + $1, $2) WHERE id = $3',
    [netAmount, MAX_GOLD, sellOrder.user_id]
  );

  // Log the tax to marketplace_tax_ledger for audit trail
  if (taxAmount > 0) {
    await client.query(
      `INSERT INTO marketplace_tax_ledger
       (order_id, trade_id, seller_id, buyer_id, item_template_id, gross_amount, tax_amount, net_amount, tax_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [sellOrder.id, tradeId, sellOrder.user_id, buyOrder.user_id, itemTemplateId, grossAmount, taxAmount, netAmount, sellerTaxRate]
    );
  }

  // Reduce seller's item escrow
  await reduceEscrow(client, sellOrder.id, quantity);

  // Get buyer's user for item delivery
  const buyOrderResult = await client.query(
    'SELECT user_id, item_template_id FROM market_orders WHERE id = $1',
    [buyOrder.id]
  );
  const buyOrderData = buyOrderResult.rows[0];

  // Deliver items to buyer's shared pool
  await addItemToUser(
    client,
    buyOrderData.user_id,
    buyOrderData.item_template_id,
    quantity
  );

  // Get updated order statuses for notifications
  const buyOrderStatusResult = await client.query(
    'SELECT quantity, quantity_filled, status FROM market_orders WHERE id = $1',
    [buyOrder.id]
  );
  const sellOrderStatusResult = await client.query(
    'SELECT quantity, quantity_filled, status FROM market_orders WHERE id = $1',
    [sellOrder.id]
  );

  const buyOrderStatus = buyOrderStatusResult.rows[0];
  const sellOrderStatus = sellOrderStatusResult.rows[0];

  const newBuyStatus = buyOrderStatus.status;
  const newSellStatus = sellOrderStatus.status;
  const buyRemainingQty = buyOrderStatus.quantity - buyOrderStatus.quantity_filled;
  const sellRemainingQty = sellOrderStatus.quantity - sellOrderStatus.quantity_filled;

  // WebSocket notifications (wrapped in try-catch to not break the transaction)
  try {
    // Notify buyer (pays gross amount)
    marketplaceWebsocket.notifyOrderFilled(buyOrder.user_id, {
      orderId: buyOrder.id,
      side: 'buy',
      itemTemplateId: itemTemplateId,
      itemName: itemName,
      price: executionPrice,
      quantity: quantity,
      totalGold: grossAmount,
      remainingQuantity: buyRemainingQty,
      orderStatus: newBuyStatus, // 'filled' or 'partial'
      newGoldBalance: null // Will be updated in caller if needed
    });

    // Notify seller (receives net amount after fee)
    marketplaceWebsocket.notifyOrderFilled(sellOrder.user_id, {
      orderId: sellOrder.id,
      side: 'sell',
      itemTemplateId: itemTemplateId,
      itemName: itemName,
      price: executionPrice,
      quantity: quantity,
      totalGold: netAmount, // Net amount after 5% fee
      grossGold: grossAmount,
      taxAmount: taxAmount,
      taxRate: sellerTaxRate,
      remainingQuantity: sellRemainingQty,
      orderStatus: newSellStatus
    });

    // Broadcast trade to item subscribers
    marketplaceWebsocket.broadcastTrade({
      itemTemplateId: itemTemplateId,
      itemName: itemName,
      price: executionPrice,
      quantity: quantity
    });
  } catch (wsError) {
    console.error('WebSocket notification failed in executeTrade:', wsError);
  }

  // NOTE: Audit logging moved to route handler (after transaction commits) to avoid deadlocks
  // The audit service uses a separate DB connection which causes FK check deadlocks

  // Daily/Weekly quest progress hooks (fire-and-forget pattern)
  // Track items sold for seller
  getPartyLeaderId(sellOrder.user_id).then(characterId => {
    if (characterId) {
      dailyQuestService.updateProgress(characterId, 'items_sold', quantity, {})
        .catch(err => console.warn('[Quest] items_sold progress failed:', err.message));

      // Track gold earned for seller (net amount after tax)
      if (netAmount > 0) {
        dailyQuestService.updateProgress(characterId, 'gold_earned', netAmount, {})
          .catch(err => console.warn('[Quest] gold_earned progress failed:', err.message));
      }
    }
  }).catch(err => console.warn('[Quest] Failed to get characterId for marketplace:', err.message));

  return {
    quantity,
    price: executionPrice,
    totalGold: grossAmount,
    netGold: netAmount,
    taxAmount,
    taxRate: sellerTaxRate,
    // Include trade info for post-transaction audit logging
    _auditInfo: {
      buyerId: buyOrder.user_id,
      sellerId: sellOrder.user_id,
      buyOrderId: buyOrder.id,
      sellOrderId: sellOrder.id,
      itemTemplateId: itemTemplateId
    }
  };
}

/**
 * Place a limit order with automatic matching
 * @param {Object} client - Database client
 * @param {number} userId - User placing the order
 * @param {number} characterId - Character ID for context
 * @param {number} itemTemplateId - Item template ID
 * @param {string} side - 'buy' or 'sell'
 * @param {number} price - Limit price per item
 * @param {number} quantity - Quantity to trade
 * @returns {Promise<Object>} Order result with trades and post-commit info
 */
export async function placeLimitOrder(client, userId, characterId, itemTemplateId, side, price, quantity) {
  console.log('[placeLimitOrder] Starting', { userId, characterId, itemTemplateId, side, price, quantity });

  // Check open order count - max per user
  const orderCountResult = await client.query(
    `SELECT COUNT(*) as count FROM market_orders
     WHERE user_id = $1 AND status IN ('open', 'partial')`,
    [userId]
  );
  console.log('[placeLimitOrder] Order count:', orderCountResult.rows[0].count);
  if (parseInt(orderCountResult.rows[0].count, 10) >= MAX_OPEN_ORDERS_PER_USER) {
    throw new AppError(`Maximum of ${MAX_OPEN_ORDERS_PER_USER} open orders allowed. Cancel existing orders first.`, 400);
  }

  // Validate item is tradeable and stackable (non-stackable items must use item listings)
  const itemResult = await client.query(
    'SELECT id, name, is_tradeable, is_stackable FROM item_templates WHERE id = $1',
    [itemTemplateId]
  );
  console.log('[placeLimitOrder] Item found:', itemResult.rows[0]);

  if (itemResult.rows.length === 0) {
    throw new AppError('Item not found', 404);
  }

  if (itemResult.rows[0].is_tradeable === false) {
    throw new AppError('This item cannot be traded', 400);
  }

  // Non-stackable items (equipment) must use item listings to preserve modifications
  if (itemResult.rows[0].is_stackable === false) {
    throw new AppError('Unique items must be sold via item listings', 400);
  }

  // Create the order
  console.log('[placeLimitOrder] Inserting order...');
  const orderResult = await client.query(
    `INSERT INTO market_orders (user_id, character_id, item_template_id, side, price, quantity)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, character_id, item_template_id, side, price, quantity, quantity_filled, status, created_at`,
    [userId, characterId, itemTemplateId, side, price, quantity]
  );

  const order = orderResult.rows[0];
  console.log('[placeLimitOrder] Order created:', order);

  // Reserve gold for buy orders or escrow items for sell orders
  if (side === 'buy') {
    const totalCost = price * quantity;
    console.log('[placeLimitOrder] Reserving gold:', totalCost);
    await reserveGold(client, userId, order.id, totalCost);
    console.log('[placeLimitOrder] Gold reserved successfully');
  } else {
    console.log('[placeLimitOrder] Escrowing items');
    await escrowItems(client, order.id, userId, characterId, itemTemplateId, quantity);
    console.log('[placeLimitOrder] Items escrowed successfully');
  }

  // Try to match with existing orders
  const trades = [];
  let remainingQuantity = quantity;
  const itemName = itemResult.rows[0].name;

  const matchingOrders = await getMatchingOrders(client, itemTemplateId, side, price, userId);

  for (const matchOrder of matchingOrders.rows) {
    if (remainingQuantity <= 0) break;

    const availableQty = matchOrder.quantity - matchOrder.quantity_filled;
    const tradeQty = Math.min(remainingQuantity, availableQty);

    // Execution price is the resting order's price (price-time priority)
    const executionPrice = parseInt(matchOrder.price, 10);

    let buyOrder, sellOrder, sellerUserId;
    if (side === 'buy') {
      buyOrder = { id: order.id, user_id: userId, item_template_id: itemTemplateId };
      sellOrder = matchOrder;
      sellerUserId = matchOrder.user_id;
    } else {
      buyOrder = matchOrder;
      sellOrder = { id: order.id, user_id: userId, item_template_id: itemTemplateId };
      sellerUserId = userId;
    }

    // Get the seller's tax rate (may be reduced by Merchant's Seal relic)
    const sellerTaxRate = await getMarketplaceFeeRate(sellerUserId);

    const trade = await executeTrade(client, buyOrder, sellOrder, tradeQty, executionPrice, itemName, sellerTaxRate);
    trades.push(trade);

    remainingQuantity -= tradeQty;
  }

  // Safety net: release any leftover gold reservation if order is fully filled
  // (handles edge cases like price improvement leaving excess reservation)
  if (remainingQuantity === 0 && side === 'buy') {
    await releaseGold(client, order.id);
  }

  // Refetch order to get updated status
  const updatedOrderResult = await client.query(
    'SELECT * FROM market_orders WHERE id = $1',
    [order.id]
  );

  const updatedOrder = updatedOrderResult.rows[0];

  console.log('[placeLimitOrder] Preparing return value...');

  // Prepare return value - WebSocket and audit logging will happen AFTER transaction commits
  // to avoid deadlocks (audit service uses separate connection that can't see uncommitted data)
  const result = {
    order: updatedOrder,
    trades,
    itemName: itemName,
    // Include info for post-transaction operations
    _postCommit: {
      itemTemplateId,
      userId,
      characterId,
      orderId: order.id,
      side,
      price,
      quantity
    }
  };

  console.log('[placeLimitOrder] Returning result, order id:', result.order.id);
  return result;
}

/**
 * Execute a market order (immediate execution at best available price)
 * @param {Object} client - Database client
 * @param {number} userId - User placing the order
 * @param {number} characterId - Character ID for context
 * @param {number} itemTemplateId - Item template ID
 * @param {string} side - 'buy' or 'sell'
 * @param {number} quantity - Quantity to trade
 * @returns {Promise<Object>} Execution result with trades
 */
export async function executeMarketOrder(client, userId, characterId, itemTemplateId, side, quantity) {
  // Validate item is tradeable and stackable (non-stackable items must use item listings)
  const itemResult = await client.query(
    'SELECT id, name, is_tradeable, is_stackable FROM item_templates WHERE id = $1',
    [itemTemplateId]
  );

  if (itemResult.rows.length === 0) {
    throw new AppError('Item not found', 404);
  }

  if (itemResult.rows[0].is_tradeable === false) {
    throw new AppError('This item cannot be traded', 400);
  }

  // Non-stackable items (equipment) must use item listings to preserve modifications
  if (itemResult.rows[0].is_stackable === false) {
    throw new AppError('Unique items must be sold via item listings', 400);
  }

  // Get available orders to match
  let matchingOrders;
  if (side === 'buy') {
    // Get all sell orders sorted by price ASC
    matchingOrders = await client.query(
      `SELECT id, user_id, character_id, price, quantity, quantity_filled
       FROM market_orders
       WHERE item_template_id = $1
         AND side = 'sell'
         AND status IN ('open', 'partial')
         AND user_id != $2
       ORDER BY price ASC, created_at ASC
       FOR UPDATE`,
      [itemTemplateId, userId]
    );
  } else {
    // Get all buy orders sorted by price DESC
    matchingOrders = await client.query(
      `SELECT id, user_id, character_id, price, quantity, quantity_filled
       FROM market_orders
       WHERE item_template_id = $1
         AND side = 'buy'
         AND status IN ('open', 'partial')
         AND user_id != $2
       ORDER BY price DESC, created_at ASC
       FOR UPDATE`,
      [itemTemplateId, userId]
    );
  }

  // Calculate total cost/proceeds and check availability
  let totalAvailable = 0;
  let totalCost = 0;
  const ordersToMatch = [];

  for (const order of matchingOrders.rows) {
    if (totalAvailable >= quantity) break;

    const availableQty = order.quantity - order.quantity_filled;
    const matchQty = Math.min(quantity - totalAvailable, availableQty);

    ordersToMatch.push({ order, matchQty });
    totalAvailable += matchQty;
    totalCost += parseInt(order.price, 10) * matchQty;
  }

  if (totalAvailable < quantity) {
    throw new AppError(`Insufficient liquidity. Only ${totalAvailable} available at market`, 400);
  }

  // For buy orders: check user has enough gold
  if (side === 'buy') {
    const userResult = await client.query(
      'SELECT gold FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (userResult.rows[0].gold < totalCost) {
      throw new AppError(`Insufficient gold. Need ${totalCost}, have ${userResult.rows[0].gold}`, 400);
    }

    // Deduct gold from buyer
    await client.query(
      'UPDATE users SET gold = gold - $1 WHERE id = $2',
      [totalCost, userId]
    );
  } else {
    // For sell orders: escrow items first
    // Check user has enough items in shared pool (unlisted)
    const itemCheck = await client.query(
      `SELECT COALESCE(SUM(quantity), 0) as total
       FROM character_items
       WHERE user_id = $1
         AND item_template_id = $2
         AND equipped_slot IS NULL
         AND character_id IS NULL
         AND (listed IS NULL OR listed = FALSE)`,
      [userId, itemTemplateId]
    );

    if (parseInt(itemCheck.rows[0].total, 10) < quantity) {
      throw new AppError(`Insufficient items. Have ${itemCheck.rows[0].total}, need ${quantity}`, 400);
    }

    // Deduct items from seller's shared pool (unlisted only)
    const deductResult = await client.query(
      `SELECT id, quantity
       FROM character_items
       WHERE user_id = $1
         AND item_template_id = $2
         AND equipped_slot IS NULL
         AND character_id IS NULL
         AND (listed IS NULL OR listed = FALSE)
       ORDER BY quantity DESC
       FOR UPDATE`,
      [userId, itemTemplateId]
    );

    let remaining = quantity;
    for (const item of deductResult.rows) {
      if (remaining <= 0) break;

      const deductAmount = Math.min(remaining, item.quantity);
      if (deductAmount >= item.quantity) {
        await client.query('DELETE FROM character_items WHERE id = $1', [item.id]);
      } else {
        await client.query(
          'UPDATE character_items SET quantity = quantity - $1 WHERE id = $2',
          [deductAmount, item.id]
        );
      }
      remaining -= deductAmount;
    }
  }

  // Execute all matches
  const trades = [];
  let totalProceeds = 0;

  for (const { order, matchQty } of ordersToMatch) {
    const executionPrice = parseInt(order.price, 10);

    // Record trade
    await client.query(
      `INSERT INTO market_trades
       (buy_order_id, sell_order_id, item_template_id, buyer_id, seller_id, price, quantity, total_gold)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        side === 'buy' ? null : order.id,
        side === 'sell' ? null : order.id,
        itemTemplateId,
        side === 'buy' ? userId : order.user_id,
        side === 'sell' ? userId : order.user_id,
        executionPrice,
        matchQty,
        executionPrice * matchQty
      ]
    );

    // Update the matched order
    await client.query(
      'UPDATE market_orders SET quantity_filled = quantity_filled + $1 WHERE id = $2',
      [matchQty, order.id]
    );

    if (side === 'buy') {
      // Get seller's tax rate (may be reduced by Merchant's Seal relic)
      const sellerTaxRate = await getMarketplaceFeeRate(order.user_id);

      // Calculate marketplace fee for seller
      const grossGold = executionPrice * matchQty;
      const taxAmount = Math.floor(grossGold * sellerTaxRate);
      const netGold = grossGold - taxAmount;

      // Transfer NET gold to seller after fee (capped at MAX_GOLD)
      await client.query(
        'UPDATE users SET gold = LEAST(gold + $1, $2) WHERE id = $3',
        [netGold, MAX_GOLD, order.user_id]
      );

      // Log the tax
      if (taxAmount > 0) {
        await client.query(
          `INSERT INTO marketplace_tax_ledger
           (order_id, seller_id, buyer_id, item_template_id, gross_amount, tax_amount, net_amount, tax_rate)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [order.id, order.user_id, userId, itemTemplateId, grossGold, taxAmount, netGold, sellerTaxRate]
        );
      }

      // Reduce seller's escrow
      await reduceEscrow(client, order.id, matchQty);

      // Give items to buyer's shared pool
      await addItemToUser(client, userId, itemTemplateId, matchQty);
    } else {
      // Buyer pays from their reservation
      // Get the buy order's limit price to handle price improvement
      const buyOrderPriceResult = await client.query(
        'SELECT price, user_id FROM market_orders WHERE id = $1',
        [order.id]
      );
      const buyLimitPrice = parseInt(buyOrderPriceResult.rows[0].price, 10);
      const buyerUserId = buyOrderPriceResult.rows[0].user_id;

      // Amount reserved was at the buy order's limit price
      const reservedAmount = buyLimitPrice * matchQty;
      const actualCost = executionPrice * matchQty;

      // Refund price improvement to buyer if execution price < limit price
      const priceImprovement = (buyLimitPrice - executionPrice) * matchQty;
      if (priceImprovement > 0) {
        await client.query(
          'UPDATE users SET gold = LEAST(gold + $1, $2) WHERE id = $3',
          [priceImprovement, MAX_GOLD, buyerUserId]
        );
      }

      // Consume from buyer's reservation (amount reserved at limit price)
      await consumeReservation(client, order.id, reservedAmount);

      // Track gross proceeds; tax will be applied when seller receives
      totalProceeds += actualCost;

      // Buyer receives items in their shared pool
      await addItemToUser(client, buyerUserId, itemTemplateId, matchQty);
    }

    trades.push({
      orderId: order.id,
      quantity: matchQty,
      price: executionPrice,
      totalGold: executionPrice * matchQty
    });
  }

  // For sell orders: give gold to seller (fee may be reduced by Merchant's Seal relic)
  let totalTax = 0;
  let netProceeds = totalProceeds;
  let sellerTaxRate = DEFAULT_TAX_RATE;
  if (side === 'sell' && totalProceeds > 0) {
    // Get seller's tax rate (may be reduced by Merchant's Seal relic)
    sellerTaxRate = await getMarketplaceFeeRate(userId);
    totalTax = Math.floor(totalProceeds * sellerTaxRate);
    netProceeds = totalProceeds - totalTax;

    await client.query(
      'UPDATE users SET gold = LEAST(gold + $1, $2) WHERE id = $3',
      [netProceeds, MAX_GOLD, userId]
    );

    // Log the tax for the market sell order
    if (totalTax > 0) {
      await client.query(
        `INSERT INTO marketplace_tax_ledger
         (seller_id, item_template_id, gross_amount, tax_amount, net_amount, tax_rate)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, itemTemplateId, totalProceeds, totalTax, netProceeds, sellerTaxRate]
      );
    }
  }

  // Note: cleanup of zero-amount reservations/escrow is no longer needed
  // consumeReservation and reduceEscrow now delete rows that reach 0

  const itemName = itemResult.rows[0].name;

  // WebSocket notifications for filled orders and trades
  try {
    // Notify counterparties of their filled orders
    for (const { order, matchQty } of ordersToMatch) {
      const executionPrice = parseInt(order.price, 10);
      const orderStatusResult = await client.query(
        'SELECT quantity, quantity_filled, status FROM market_orders WHERE id = $1',
        [order.id]
      );
      const orderStatus = orderStatusResult.rows[0];

      // Notify the counterparty (the resting order owner)
      marketplaceWebsocket.notifyOrderFilled(order.user_id, {
        orderId: order.id,
        side: side === 'buy' ? 'sell' : 'buy', // Counterparty has opposite side
        itemTemplateId: itemTemplateId,
        itemName: itemName,
        price: executionPrice,
        quantity: matchQty,
        totalGold: executionPrice * matchQty,
        remainingQuantity: orderStatus.quantity - orderStatus.quantity_filled,
        orderStatus: orderStatus.status
      });

      // Broadcast trade to item subscribers
      marketplaceWebsocket.broadcastTrade({
        itemTemplateId: itemTemplateId,
        itemName: itemName,
        price: executionPrice,
        quantity: matchQty
      });
    }

    // Broadcast order book update
    const updatedOrderBook = await getOrderBook(client, itemTemplateId, 20);
    marketplaceWebsocket.broadcastOrderBookUpdate(itemTemplateId, updatedOrderBook);
  } catch (wsError) {
    console.error('WebSocket notification failed in executeMarketOrder:', wsError);
  }

  // NOTE: Audit logging moved to route handler (after transaction commits) to avoid deadlocks

  return {
    trades,
    totalQuantity: quantity,
    totalGold: side === 'buy' ? totalCost : totalProceeds,
    netGold: side === 'sell' ? netProceeds : totalCost,
    taxAmount: side === 'sell' ? totalTax : 0,
    taxRate: side === 'sell' ? sellerTaxRate : DEFAULT_TAX_RATE,
    averagePrice: (side === 'buy' ? totalCost : totalProceeds) / quantity,
    itemName: itemName,
    // Include info for post-transaction audit logging
    _postCommit: {
      userId,
      characterId,
      itemTemplateId,
      side,
      quantity,
      totalGold: side === 'buy' ? totalCost : netProceeds,
      tradesCount: trades.length
    }
  };
}

/**
 * Cancel an open order
 * @param {Object} client - Database client
 * @param {number} orderId - Order ID to cancel
 * @param {number} userId - User requesting cancellation
 * @returns {Promise<Object>} Cancellation result
 */
export async function cancelOrder(client, orderId, userId) {
  // Get order with lock
  const orderResult = await client.query(
    `SELECT id, user_id, character_id, item_template_id, side, price, quantity, quantity_filled, status
     FROM market_orders
     WHERE id = $1
     FOR UPDATE`,
    [orderId]
  );

  if (orderResult.rows.length === 0) {
    throw new AppError('Order not found', 404);
  }

  const order = orderResult.rows[0];

  if (order.user_id !== userId) {
    throw new AppError('Not authorized to cancel this order', 403);
  }

  if (!['open', 'partial'].includes(order.status)) {
    throw new AppError('Order cannot be cancelled', 400);
  }

  const remainingQuantity = order.quantity - order.quantity_filled;

  // Return reserved gold or escrowed items
  let actualRefundedGold = 0;
  if (order.side === 'buy') {
    // releaseGold returns the actual amount released (may differ from calculated due to price improvement)
    actualRefundedGold = await releaseGold(client, orderId);
  } else {
    // Return remaining escrowed items to user's shared pool
    await releaseEscrowedItems(client, orderId, order.user_id);
  }

  // Update order status
  await client.query(
    'UPDATE market_orders SET status = \'cancelled\', updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [orderId]
  );

  // Get item name
  const itemNameResult = await client.query(
    'SELECT name FROM item_templates WHERE id = $1',
    [order.item_template_id]
  );

  const refundedGold = order.side === 'buy' ? actualRefundedGold : 0;
  const returnedItems = order.side === 'sell' ? remainingQuantity : 0;

  // Notify user of cancellation
  try {
    marketplaceWebsocket.notifyOrderCancelled(userId, {
      orderId: orderId,
      itemTemplateId: order.item_template_id,
      refundedGold: refundedGold,
      returnedItems: returnedItems
    });

    // Broadcast order book update
    const updatedOrderBook = await getOrderBook(client, order.item_template_id, 20);
    marketplaceWebsocket.broadcastOrderBookUpdate(order.item_template_id, updatedOrderBook);
  } catch (wsError) {
    console.error('WebSocket notification failed in cancelOrder:', wsError);
  }

  // NOTE: Audit logging moved to route handler (after transaction commits) to avoid deadlocks

  return {
    orderId,
    side: order.side,
    returnedQuantity: remainingQuantity,
    returnedGold: refundedGold,
    itemName: itemNameResult.rows[0].name,
    // Include info for post-transaction audit logging
    _postCommit: {
      userId,
      itemTemplateId: order.item_template_id,
      price: order.price
    }
  };
}

/**
 * Get user's open orders
 * @param {Object} client - Database client
 * @param {number} userId - User ID
 * @param {string|null} status - Filter by status (null = open/partial)
 * @returns {Promise<Array>} List of orders
 */
export async function getUserOrders(client, userId, status = null) {
  console.log('[getUserOrders] Fetching orders for userId:', userId, 'status:', status);
  let query = `
    SELECT
      mo.id,
      mo.item_template_id,
      mo.side,
      mo.price,
      mo.quantity,
      mo.quantity_filled,
      mo.status,
      mo.created_at,
      it.name as item_name,
      it.item_type,
      it.rarity,
      it.sprite_id
    FROM market_orders mo
    JOIN item_templates it ON mo.item_template_id = it.id
    WHERE mo.user_id = $1
  `;

  const params = [userId];

  if (status) {
    query += ' AND mo.status = $2';
    params.push(status);
  } else {
    query += ' AND mo.status IN (\'open\', \'partial\')';
  }

  query += ' ORDER BY mo.created_at DESC';

  const result = await client.query(query, params);
  console.log('[getUserOrders] Found', result.rows.length, 'orders');

  return result.rows.map(row => ({
    id: row.id,
    itemTemplateId: row.item_template_id,
    itemName: row.item_name,
    itemType: row.item_type,
    rarity: row.rarity,
    spriteId: row.sprite_id,
    side: row.side,
    price: parseInt(row.price, 10),
    quantity: parseInt(row.quantity, 10),
    quantityFilled: parseInt(row.quantity_filled, 10),
    quantityRemaining: parseInt(row.quantity, 10) - parseInt(row.quantity_filled, 10),
    status: row.status,
    createdAt: row.created_at
  }));
}

/**
 * Get trade history for an item
 * @param {Object} client - Database client
 * @param {number} itemTemplateId - Item template ID
 * @param {number} limit - Maximum trades to return
 * @returns {Promise<Array>} List of trades
 */
export async function getTradeHistory(client, itemTemplateId, limit = 50) {
  const result = await client.query(
    `SELECT
       mt.price,
       mt.quantity,
       mt.total_gold,
       mt.executed_at,
       it.name as item_name
     FROM market_trades mt
     JOIN item_templates it ON mt.item_template_id = it.id
     WHERE mt.item_template_id = $1
     ORDER BY mt.executed_at DESC
     LIMIT $2`,
    [itemTemplateId, limit]
  );

  return result.rows.map(row => ({
    price: parseInt(row.price, 10),
    quantity: parseInt(row.quantity, 10),
    totalGold: parseInt(row.total_gold, 10),
    executedAt: row.executed_at,
    itemName: row.item_name
  }));
}
