/**
 * Marketplace Service - Order Book and Matching Engine
 *
 * Implements price-time priority matching:
 * - Buy orders match with lowest priced sell orders first
 * - Sell orders match with highest priced buy orders first
 * - At same price, earlier orders have priority
 * - Partial fills allowed
 */

import { AppError } from '../middleware/errorHandler.js';
import { MAX_GOLD } from '../config/constants.js';
import { MAX_OPEN_ORDERS_PER_USER } from '../../../shared/constants.js';
import * as marketplaceWebsocket from './marketplaceWebsocket.js';
// Note: marketplaceAudit is imported dynamically in route handlers (after transaction commits)
// to avoid deadlocks caused by FK checks on locked rows

/**
 * Get the order book for an item (aggregated by price level)
 */
async function getOrderBook(client, itemTemplateId, depth = 20) {
  // Get buy orders (bids) - highest price first
  const bidsResult = await client.query(
    `SELECT
       price,
       SUM(quantity - quantity_filled) as total_quantity,
       COUNT(*) as order_count
     FROM market_orders
     WHERE item_template_id = $1
       AND side = 'buy'
       AND status IN ('open', 'partial')
     GROUP BY price
     ORDER BY price DESC
     LIMIT $2`,
    [itemTemplateId, depth]
  );

  // Get sell orders (asks) - lowest price first
  const asksResult = await client.query(
    `SELECT
       price,
       SUM(quantity - quantity_filled) as total_quantity,
       COUNT(*) as order_count
     FROM market_orders
     WHERE item_template_id = $1
       AND side = 'sell'
       AND status IN ('open', 'partial')
     GROUP BY price
     ORDER BY price ASC
     LIMIT $2`,
    [itemTemplateId, depth]
  );

  // Calculate spread
  const bestBid = bidsResult.rows[0]?.price || 0;
  const bestAsk = asksResult.rows[0]?.price || 0;
  const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : null;

  return {
    itemTemplateId,
    bids: bidsResult.rows.map(r => ({
      price: parseInt(r.price, 10),
      quantity: parseInt(r.total_quantity, 10),
      orderCount: parseInt(r.order_count, 10)
    })),
    asks: asksResult.rows.map(r => ({
      price: parseInt(r.price, 10),
      quantity: parseInt(r.total_quantity, 10),
      orderCount: parseInt(r.order_count, 10)
    })),
    bestBid: parseInt(bestBid, 10),
    bestAsk: parseInt(bestAsk, 10),
    spread
  };
}

/**
 * Get matching orders for a new order
 * For buy: get sell orders with price <= buyPrice (lowest first)
 * For sell: get buy orders with price >= sellPrice (highest first)
 */
async function getMatchingOrders(client, itemTemplateId, side, price, excludeUserId) {
  if (side === 'buy') {
    // Match with sell orders at or below our price
    return client.query(
      `SELECT id, user_id, character_id, price, quantity, quantity_filled
       FROM market_orders
       WHERE item_template_id = $1
         AND side = 'sell'
         AND status IN ('open', 'partial')
         AND price <= $2
         AND user_id != $3
       ORDER BY price ASC, created_at ASC
       FOR UPDATE`,
      [itemTemplateId, price, excludeUserId]
    );
  } else {
    // Match with buy orders at or above our price
    return client.query(
      `SELECT id, user_id, character_id, price, quantity, quantity_filled
       FROM market_orders
       WHERE item_template_id = $1
         AND side = 'buy'
         AND status IN ('open', 'partial')
         AND price >= $2
         AND user_id != $3
       ORDER BY price DESC, created_at ASC
       FOR UPDATE`,
      [itemTemplateId, price, excludeUserId]
    );
  }
}

/**
 * Reserve gold for a buy order
 */
async function reserveGold(client, userId, orderId, amount) {
  // Check user has enough gold
  const userResult = await client.query(
    'SELECT gold FROM users WHERE id = $1 FOR UPDATE',
    [userId]
  );

  if (userResult.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  const availableGold = userResult.rows[0].gold;
  if (availableGold < amount) {
    throw new AppError(`Insufficient gold. Need ${amount}, have ${availableGold}`, 400);
  }

  // Deduct gold
  await client.query(
    'UPDATE users SET gold = gold - $1 WHERE id = $2',
    [amount, userId]
  );

  // Create reservation record
  await client.query(
    'INSERT INTO gold_reservations (user_id, order_id, amount) VALUES ($1, $2, $3)',
    [userId, orderId, amount]
  );

  return amount;
}

/**
 * Release reserved gold (on order cancel or partial unfill)
 */
async function releaseGold(client, orderId, amount = null) {
  // Get reservation
  const reservationResult = await client.query(
    'SELECT user_id, amount FROM gold_reservations WHERE order_id = $1',
    [orderId]
  );

  if (reservationResult.rows.length === 0) {
    return 0; // No reservation to release
  }

  const reservation = reservationResult.rows[0];
  const releaseAmount = amount || reservation.amount;

  // Return gold to user (capped at MAX_GOLD to prevent overflow)
  await client.query(
    'UPDATE users SET gold = LEAST(gold + $1, $2) WHERE id = $3',
    [releaseAmount, MAX_GOLD, reservation.user_id]
  );

  if (amount && amount < reservation.amount) {
    // Partial release - update reservation
    await client.query(
      'UPDATE gold_reservations SET amount = amount - $1 WHERE order_id = $2',
      [amount, orderId]
    );
  } else {
    // Full release - delete reservation
    await client.query(
      'DELETE FROM gold_reservations WHERE order_id = $1',
      [orderId]
    );
  }

  return releaseAmount;
}

/**
 * Escrow items for a sell order from user's shared pool
 */
async function escrowItems(client, orderId, userId, characterId, itemTemplateId, quantity) {
  // Check user has enough items in shared pool (not equipped)
  const itemResult = await client.query(
    `SELECT id, quantity
     FROM character_items
     WHERE user_id = $1
       AND item_template_id = $2
       AND equipped_slot IS NULL
     ORDER BY quantity DESC
     FOR UPDATE`,
    [userId, itemTemplateId]
  );

  let remaining = quantity;
  const itemsToDeduct = [];

  for (const item of itemResult.rows) {
    if (remaining <= 0) break;

    const deductAmount = Math.min(remaining, item.quantity);
    itemsToDeduct.push({ id: item.id, amount: deductAmount, totalQty: item.quantity });
    remaining -= deductAmount;
  }

  if (remaining > 0) {
    throw new AppError(`Insufficient items. Need ${quantity}, have ${quantity - remaining}`, 400);
  }

  // Deduct items from shared pool
  for (const item of itemsToDeduct) {
    if (item.amount >= item.totalQty) {
      await client.query('DELETE FROM character_items WHERE id = $1', [item.id]);
    } else {
      await client.query(
        'UPDATE character_items SET quantity = quantity - $1 WHERE id = $2',
        [item.amount, item.id]
      );
    }
  }

  // Create escrow record (keep character_id for historical context)
  await client.query(
    'INSERT INTO item_escrow (order_id, character_id, item_template_id, quantity) VALUES ($1, $2, $3, $4)',
    [orderId, characterId, itemTemplateId, quantity]
  );

  return quantity;
}

/**
 * Release escrowed items (on order cancel)
 */
async function releaseEscrowedItems(client, orderId, userId = null) {
  // Get escrow record
  const escrowResult = await client.query(
    'SELECT character_id, item_template_id, quantity FROM item_escrow WHERE order_id = $1',
    [orderId]
  );

  if (escrowResult.rows.length === 0) {
    return 0;
  }

  const escrow = escrowResult.rows[0];

  // Get user_id from order if not provided
  let targetUserId = userId;
  if (!targetUserId) {
    const orderResult = await client.query(
      'SELECT user_id FROM market_orders WHERE id = $1',
      [orderId]
    );
    targetUserId = orderResult.rows[0]?.user_id;
  }

  if (!targetUserId) {
    throw new AppError('Cannot determine user for escrow release', 500);
  }

  // Return items to user's shared pool
  await addItemToUser(client, targetUserId, escrow.item_template_id, escrow.quantity);

  // Delete escrow record
  await client.query('DELETE FROM item_escrow WHERE order_id = $1', [orderId]);

  return escrow.quantity;
}

/**
 * Reduce escrowed items (after partial fill)
 */
async function reduceEscrow(client, orderId, quantityFilled) {
  await client.query(
    'UPDATE item_escrow SET quantity = quantity - $1 WHERE order_id = $2',
    [quantityFilled, orderId]
  );
}

/**
 * Add items to a user's shared inventory (stacking consumables/materials)
 */
async function addItemToUser(client, userId, itemTemplateId, quantity) {
  // Get item type to determine if stackable
  const itemResult = await client.query(
    'SELECT item_type FROM item_templates WHERE id = $1',
    [itemTemplateId]
  );

  if (itemResult.rows.length === 0) {
    throw new AppError('Item template not found', 404);
  }

  const itemType = itemResult.rows[0].item_type;
  const stackable = ['consumable', 'material'].includes(itemType);

  if (stackable) {
    // Try to stack with existing item in shared pool
    const existingResult = await client.query(
      `SELECT id, quantity FROM character_items
       WHERE user_id = $1 AND item_template_id = $2 AND equipped_slot IS NULL`,
      [userId, itemTemplateId]
    );

    if (existingResult.rows.length > 0) {
      await client.query(
        'UPDATE character_items SET quantity = quantity + $1 WHERE id = $2',
        [quantity, existingResult.rows[0].id]
      );
      return;
    }
  }

  // Create new item entry in shared pool (or multiple for non-stackable)
  if (stackable) {
    await client.query(
      'INSERT INTO character_items (user_id, item_template_id, quantity) VALUES ($1, $2, $3)',
      [userId, itemTemplateId, quantity]
    );
  } else {
    // Non-stackable items get individual entries
    for (let i = 0; i < quantity; i++) {
      await client.query(
        'INSERT INTO character_items (user_id, item_template_id, quantity) VALUES ($1, $2, 1)',
        [userId, itemTemplateId]
      );
    }
  }
}

// Default marketplace tax rate (5%)
const DEFAULT_TAX_RATE = 0.05;

/**
 * Execute a trade between two orders
 * Applies a 5% seller fee which is logged to marketplace_tax_ledger
 */
async function executeTrade(client, buyOrder, sellOrder, quantity, executionPrice, itemName = null, sellerTaxRate = DEFAULT_TAX_RATE) {
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

  // Reduce buyer's gold reservation (full amount)
  await client.query(
    'UPDATE gold_reservations SET amount = amount - $1 WHERE order_id = $2',
    [grossAmount, buyOrder.id]
  );

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
 */
async function placeLimitOrder(client, userId, characterId, itemTemplateId, side, price, quantity) {
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

  // Validate item is tradeable
  const itemResult = await client.query(
    'SELECT id, name, is_tradeable FROM item_templates WHERE id = $1',
    [itemTemplateId]
  );
  console.log('[placeLimitOrder] Item found:', itemResult.rows[0]);

  if (itemResult.rows.length === 0) {
    throw new AppError('Item not found', 404);
  }

  if (itemResult.rows[0].is_tradeable === false) {
    throw new AppError('This item cannot be traded', 400);
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

    let buyOrder, sellOrder;
    if (side === 'buy') {
      buyOrder = { id: order.id, user_id: userId, item_template_id: itemTemplateId };
      sellOrder = matchOrder;
    } else {
      buyOrder = matchOrder;
      sellOrder = { id: order.id, user_id: userId, item_template_id: itemTemplateId };
    }

    const trade = await executeTrade(client, buyOrder, sellOrder, tradeQty, executionPrice, itemName);
    trades.push(trade);

    remainingQuantity -= tradeQty;
  }

  // Clean up empty reservations/escrow
  if (remainingQuantity === 0) {
    if (side === 'buy') {
      await client.query('DELETE FROM gold_reservations WHERE order_id = $1 AND amount <= 0', [order.id]);
    } else {
      await client.query('DELETE FROM item_escrow WHERE order_id = $1 AND quantity <= 0', [order.id]);
    }
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
 */
async function executeMarketOrder(client, userId, characterId, itemTemplateId, side, quantity) {
  // Validate item is tradeable
  const itemResult = await client.query(
    'SELECT id, name, is_tradeable FROM item_templates WHERE id = $1',
    [itemTemplateId]
  );

  if (itemResult.rows.length === 0) {
    throw new AppError('Item not found', 404);
  }

  if (itemResult.rows[0].is_tradeable === false) {
    throw new AppError('This item cannot be traded', 400);
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
    const itemResult = await client.query(
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
    for (const item of itemResult.rows) {
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
      // Calculate marketplace fee for seller (5% fee)
      const grossGold = executionPrice * matchQty;
      const taxAmount = Math.floor(grossGold * DEFAULT_TAX_RATE);
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
          [order.id, order.user_id, userId, itemTemplateId, grossGold, taxAmount, netGold, DEFAULT_TAX_RATE]
        );
      }

      // Reduce seller's escrow
      await reduceEscrow(client, order.id, matchQty);

      // Give items to buyer's shared pool
      await addItemToUser(client, userId, itemTemplateId, matchQty);
    } else {
      // Buyer pays from their reservation (full amount)
      const goldCost = executionPrice * matchQty;
      await client.query(
        'UPDATE gold_reservations SET amount = amount - $1 WHERE order_id = $2',
        [goldCost, order.id]
      );

      // Track gross proceeds; tax will be applied when seller receives
      totalProceeds += goldCost;

      // Buyer receives items in their shared pool
      const buyerOrderResult = await client.query(
        'SELECT user_id FROM market_orders WHERE id = $1',
        [order.id]
      );
      await addItemToUser(client, buyerOrderResult.rows[0].user_id, itemTemplateId, matchQty);
    }

    trades.push({
      orderId: order.id,
      quantity: matchQty,
      price: executionPrice,
      totalGold: executionPrice * matchQty
    });
  }

  // For sell orders: give gold to seller (after 5% fee, capped at MAX_GOLD)
  let totalTax = 0;
  let netProceeds = totalProceeds;
  if (side === 'sell' && totalProceeds > 0) {
    totalTax = Math.floor(totalProceeds * DEFAULT_TAX_RATE);
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
        [userId, itemTemplateId, totalProceeds, totalTax, netProceeds, DEFAULT_TAX_RATE]
      );
    }
  }

  // Clean up empty reservations/escrow
  for (const { order } of ordersToMatch) {
    await client.query('DELETE FROM gold_reservations WHERE order_id = $1 AND amount <= 0', [order.id]);
    await client.query('DELETE FROM item_escrow WHERE order_id = $1 AND quantity <= 0', [order.id]);
  }

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
    taxRate: DEFAULT_TAX_RATE,
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
 */
async function cancelOrder(client, orderId, userId) {
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
  if (order.side === 'buy') {
    const returnGold = order.price * remainingQuantity;
    await releaseGold(client, orderId);
  } else {
    // Return remaining escrowed items to user's shared pool
    await releaseEscrowedItems(client, orderId, order.user_id);
  }

  // Update order status
  await client.query(
    "UPDATE market_orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
    [orderId]
  );

  // Get item name
  const itemResult = await client.query(
    'SELECT name FROM item_templates WHERE id = $1',
    [order.item_template_id]
  );

  const refundedGold = order.side === 'buy' ? order.price * remainingQuantity : 0;
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
    itemName: itemResult.rows[0].name,
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
 */
async function getUserOrders(client, userId, status = null) {
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
      it.rarity
    FROM market_orders mo
    JOIN item_templates it ON mo.item_template_id = it.id
    WHERE mo.user_id = $1
  `;

  const params = [userId];

  if (status) {
    query += ' AND mo.status = $2';
    params.push(status);
  } else {
    query += " AND mo.status IN ('open', 'partial')";
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
 */
async function getTradeHistory(client, itemTemplateId, limit = 50) {
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

/**
 * Search tradeable items
 */
async function searchItems(client, searchTerm = '', itemType = null, limit = 50) {
  let query = `
    SELECT
      it.id,
      it.name,
      it.description,
      it.item_type,
      it.equipment_slot,
      it.stat_bonuses,
      it.level_requirement,
      it.base_price,
      it.rarity,
      it.is_stackable,
      COALESCE(ask.best_ask, 0) as best_ask,
      COALESCE(bid.best_bid, 0) as best_bid,
      COALESCE(vol.volume_24h, 0) as volume_24h,
      COALESCE(ord.open_orders, 0) as open_orders,
      COALESCE(listings.listing_count, 0) as listing_count,
      listings.min_listing_price,
      listings.max_listing_price
    FROM item_templates it
    LEFT JOIN LATERAL (
      SELECT MIN(price) as best_ask
      FROM market_orders
      WHERE item_template_id = it.id
        AND side = 'sell'
        AND status IN ('open', 'partial')
    ) ask ON true
    LEFT JOIN LATERAL (
      SELECT MAX(price) as best_bid
      FROM market_orders
      WHERE item_template_id = it.id
        AND side = 'buy'
        AND status IN ('open', 'partial')
    ) bid ON true
    LEFT JOIN LATERAL (
      SELECT SUM(quantity) as volume_24h
      FROM market_trades
      WHERE item_template_id = it.id
        AND executed_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
    ) vol ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as open_orders
      FROM market_orders
      WHERE item_template_id = it.id
        AND status IN ('open', 'partial')
    ) ord ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) as listing_count,
        MIN(price) as min_listing_price,
        MAX(price) as max_listing_price
      FROM item_listings
      WHERE item_template_id = it.id
        AND status = 'active'
    ) listings ON true
    WHERE (it.is_tradeable IS NULL OR it.is_tradeable = TRUE)
  `;

  const params = [];
  let paramIndex = 1;

  if (searchTerm) {
    query += ` AND it.name ILIKE $${paramIndex}`;
    params.push(`%${searchTerm}%`);
    paramIndex++;
  }

  if (itemType) {
    query += ` AND it.item_type = $${paramIndex}`;
    params.push(itemType);
    paramIndex++;
  }

  // Sort by open orders (most active first), then alphabetically
  query += ` ORDER BY COALESCE(ord.open_orders, 0) DESC, it.name ASC LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await client.query(query, params);

  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    itemType: row.item_type,
    equipmentSlot: row.equipment_slot,
    statBonuses: row.stat_bonuses,
    levelRequirement: row.level_requirement,
    basePrice: row.base_price,
    rarity: row.rarity,
    isStackable: row.is_stackable || false,
    bestAsk: row.best_ask ? parseInt(row.best_ask, 10) : null,
    bestBid: row.best_bid ? parseInt(row.best_bid, 10) : null,
    volume24h: parseInt(row.volume_24h, 10) || 0,
    openOrders: parseInt(row.open_orders, 10) || 0,
    listingCount: parseInt(row.listing_count, 10) || 0,
    minListingPrice: row.min_listing_price ? parseInt(row.min_listing_price, 10) : null,
    maxListingPrice: row.max_listing_price ? parseInt(row.max_listing_price, 10) : null
  }));
}

// ============================================
// ITEM LISTINGS - For unique items with modifications
// ============================================

/**
 * Augment value multipliers by category
 */
const AUGMENT_VALUES = {
  // Elemental
  fire: 0.8,
  ice: 0.8,
  lightning: 0.8,
  poison: 0.6,
  holy: 0.9,
  dark: 0.9,
  // Stats
  strength: 1.0,
  intelligence: 1.0,
  agility: 1.0,
  vitality: 1.0,
  luck: 0.8,
  // Combat
  critical: 1.0,
  speed: 0.9,
  damage: 1.1,
  power: 1.0,
  // Defense
  defense: 0.9,
  magic_defense: 0.9,
  armor: 0.8,
  block: 0.9,
  spell_resist: 0.8,
  protection: 1.0,
  // Enemy-slayer
  dragon_slayer: 1.2,
  undead_slayer: 1.1,
  demon_slayer: 1.2,
  // Support
  hp: 0.9,
  mp: 0.9,
  regen: 0.7,
  mp_regen: 0.7,
  accuracy: 0.8,
  crit: 1.0,
  // Consumable
  effect_multiplier: 1.0,
  hot: 0.8,
  hot_percent: 1.0,
  mp_bonus: 0.7,
  mp_regen: 0.8,
  spell_cost_reduction: 0.9,
  cleanse: 1.2,
  buff: 0.8,
  revive_hp_bonus: 0.6,
  revive_full: 1.5,
  revive_immunity: 1.0,
  instant: 1.5,
  aoe: 1.2
};

/**
 * Rarity multipliers for price calculation
 */
const RARITY_MULTIPLIERS = {
  common: 1.0,
  uncommon: 1.5,
  rare: 2.5,
  epic: 5.0,
  legendary: 10.0
};

/**
 * Calculate suggested price for an item based on its properties
 */
function calculateSuggestedPrice(item) {
  const basePrice = item.basePrice || item.base_price || 10;
  const rarity = item.rarity || 'common';
  const augments = item.augments || [];

  // Get rarity multiplier
  const rarityMult = RARITY_MULTIPLIERS[rarity] || 1.0;

  // Calculate augment value
  let augmentValue = 0;
  for (const augment of augments) {
    const category = augment.category || 'default';
    augmentValue += AUGMENT_VALUES[category] || 0.5;
  }

  // Augment multiplier: 1.0 + (augmentValue * 0.15)
  const augmentMult = 1.0 + (augmentValue * 0.15);

  // Calculate final price
  const suggestedPrice = Math.floor(basePrice * rarityMult * augmentMult);

  return {
    suggestedPrice,
    breakdown: {
      basePrice,
      rarityMultiplier: rarityMult,
      augmentMultiplier: parseFloat(augmentMult.toFixed(2)),
      augmentCount: augments.length
    }
  };
}

/**
 * Get all active listings for a specific item template
 * Returns full modification data for each listing
 */
async function getItemListings(client, itemTemplateId) {
  const result = await client.query(
    `SELECT
       il.id as listing_id,
       il.price,
       il.suggested_price,
       il.seller_id,
       il.created_at,
       il.modifications_snapshot as modifications,
       ci.id as character_item_id,
       it.name as template_name,
       it.base_price,
       it.item_type,
       it.stat_bonuses as template_stats,
       u.username as seller_name
     FROM item_listings il
     JOIN character_items ci ON il.character_item_id = ci.id
     JOIN item_templates it ON il.item_template_id = it.id
     JOIN users u ON il.seller_id = u.id
     WHERE il.item_template_id = $1 AND il.status = 'active'
     ORDER BY il.price ASC, il.created_at ASC`,
    [itemTemplateId]
  );

  return result.rows.map(row => {
    const mods = row.modifications || {};
    return {
      listingId: row.listing_id,
      characterItemId: row.character_item_id,
      generatedName: mods.generatedName || row.template_name,
      templateName: row.template_name,
      rarity: mods.rarity || 'common',
      material: mods.material || null,
      baseStats: mods.baseStats || row.template_stats || {},
      bonusStats: mods.bonusStats || {},
      augments: mods.augments || [],
      askPrice: parseInt(row.price, 10),
      suggestedPrice: row.suggested_price ? parseInt(row.suggested_price, 10) : null,
      sellerId: row.seller_id,
      sellerName: row.seller_name,
      createdAt: row.created_at
    };
  });
}

/**
 * Get aggregate listing info for search results
 * Returns count, price range, and rarity range for templates with listings
 */
async function getListingAggregates(client, templateIds) {
  if (!templateIds || templateIds.length === 0) return {};

  const result = await client.query(
    `SELECT
       il.item_template_id,
       COUNT(*) as listing_count,
       MIN(il.price) as min_price,
       MAX(il.price) as max_price,
       array_agg(DISTINCT il.modifications_snapshot->>'rarity') as rarities
     FROM item_listings il
     WHERE il.item_template_id = ANY($1) AND il.status = 'active'
     GROUP BY il.item_template_id`,
    [templateIds]
  );

  const aggregates = {};
  for (const row of result.rows) {
    const rarities = (row.rarities || []).filter(r => r).sort((a, b) => {
      const order = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
      return order.indexOf(a) - order.indexOf(b);
    });
    aggregates[row.item_template_id] = {
      listingCount: parseInt(row.listing_count, 10),
      minPrice: parseInt(row.min_price, 10),
      maxPrice: parseInt(row.max_price, 10),
      minRarity: rarities[0] || 'common',
      maxRarity: rarities[rarities.length - 1] || 'common'
    };
  }

  return aggregates;
}

/**
 * Create a new item listing from user's shared pool
 */
async function createItemListing(client, userId, characterId, characterItemId, price) {
  // Get the item and verify ownership from shared pool
  const itemResult = await client.query(
    `SELECT ci.id, ci.item_template_id, ci.modifications, ci.equipped_slot,
            it.name, it.base_price, it.item_type, it.is_tradeable, it.is_stackable,
            it.stat_bonuses
     FROM character_items ci
     JOIN item_templates it ON ci.item_template_id = it.id
     WHERE ci.id = $1 AND ci.user_id = $2 AND ci.equipped_slot IS NULL
     FOR UPDATE`,
    [characterItemId, userId]
  );

  if (itemResult.rows.length === 0) {
    throw new AppError('Item not found in shared inventory', 404);
  }

  const item = itemResult.rows[0];

  if (item.is_tradeable === false) {
    throw new AppError('This item cannot be traded', 400);
  }

  if (item.equipped_slot) {
    throw new AppError('Cannot list equipped items. Unequip first.', 400);
  }

  if (item.is_stackable) {
    throw new AppError('Stackable items should use the order book system', 400);
  }

  // Check if item is already listed
  const existingResult = await client.query(
    `SELECT id FROM item_listings WHERE character_item_id = $1 AND status = 'active'`,
    [characterItemId]
  );

  if (existingResult.rows.length > 0) {
    throw new AppError('This item is already listed for sale', 400);
  }

  // Calculate suggested price
  const mods = item.modifications || {};
  const { suggestedPrice } = calculateSuggestedPrice({
    basePrice: item.base_price,
    rarity: mods.rarity || 'common',
    augments: mods.augments || []
  });

  // Create listing with modification snapshot
  const listingResult = await client.query(
    `INSERT INTO item_listings
     (seller_id, character_id, character_item_id, item_template_id, price, suggested_price, modifications_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, created_at`,
    [userId, characterId, characterItemId, item.item_template_id, price, suggestedPrice, item.modifications]
  );

  const listing = listingResult.rows[0];

  // Mark the item as "listed" in modifications to prevent other operations
  await client.query(
    `UPDATE character_items SET modifications = modifications || '{"listed": true}'::jsonb WHERE id = $1`,
    [characterItemId]
  );

  return {
    listingId: listing.id,
    itemTemplateId: item.item_template_id,
    itemName: mods.generatedName || item.name,
    price,
    suggestedPrice,
    createdAt: listing.created_at
  };
}

/**
 * Buy an item from a listing
 * Applies a 5% seller fee
 */
async function buyItemListing(client, buyerUserId, buyerCharacterId, listingId, sellerTaxRate = DEFAULT_TAX_RATE) {
  // Get and lock the listing
  const listingResult = await client.query(
    `SELECT il.*, ci.id as ci_id, ci.modifications, it.name as template_name
     FROM item_listings il
     JOIN character_items ci ON il.character_item_id = ci.id
     JOIN item_templates it ON il.item_template_id = it.id
     WHERE il.id = $1 AND il.status = 'active'
     FOR UPDATE`,
    [listingId]
  );

  if (listingResult.rows.length === 0) {
    throw new AppError('Listing not found or no longer available', 404);
  }

  const listing = listingResult.rows[0];

  // Can't buy your own listing
  if (listing.seller_id === buyerUserId) {
    throw new AppError('Cannot buy your own listing', 400);
  }

  // Check buyer has enough gold
  const buyerResult = await client.query(
    'SELECT gold FROM users WHERE id = $1 FOR UPDATE',
    [buyerUserId]
  );

  if (buyerResult.rows.length === 0) {
    throw new AppError('Buyer not found', 404);
  }

  const buyerGold = buyerResult.rows[0].gold;
  const grossPrice = parseInt(listing.price, 10);

  if (buyerGold < grossPrice) {
    throw new AppError(`Insufficient gold. Need ${grossPrice}, have ${buyerGold}`, 400);
  }

  // Calculate marketplace fee (5% seller fee)
  const taxAmount = Math.floor(grossPrice * sellerTaxRate);
  const netPrice = grossPrice - taxAmount;

  // Transfer gold: buyer pays full amount
  await client.query(
    'UPDATE users SET gold = gold - $1 WHERE id = $2',
    [grossPrice, buyerUserId]
  );

  // Transfer gold: seller receives NET amount after fee (capped)
  await client.query(
    'UPDATE users SET gold = LEAST(gold + $1, $2) WHERE id = $3',
    [netPrice, MAX_GOLD, listing.seller_id]
  );

  // Log the tax to marketplace_tax_ledger
  if (taxAmount > 0) {
    await client.query(
      `INSERT INTO marketplace_tax_ledger
       (listing_id, seller_id, buyer_id, item_template_id, gross_amount, tax_amount, net_amount, tax_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [listingId, listing.seller_id, buyerUserId, listing.item_template_id, grossPrice, taxAmount, netPrice, sellerTaxRate]
    );
  }

  // Transfer item to buyer's shared pool and remove "listed" flag
  const mods = listing.modifications || {};
  delete mods.listed;

  await client.query(
    `UPDATE character_items
     SET user_id = $1, character_id = NULL, modifications = $2
     WHERE id = $3`,
    [buyerUserId, mods, listing.character_item_id]
  );

  // Update listing status
  await client.query(
    `UPDATE item_listings SET status = 'sold', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [listingId]
  );

  // Record the sale
  await client.query(
    `INSERT INTO item_listing_sales
     (listing_id, buyer_id, buyer_character_id, seller_id, item_template_id, price, modifications)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [listingId, buyerUserId, buyerCharacterId, listing.seller_id, listing.item_template_id, grossPrice, listing.modifications]
  );

  const itemName = mods.generatedName || listing.template_name;

  return {
    listingId,
    itemTemplateId: listing.item_template_id,
    itemName,
    price: grossPrice,
    netPrice,
    taxAmount,
    taxRate: sellerTaxRate,
    sellerId: listing.seller_id,
    buyerId: buyerUserId,
    characterItemId: listing.character_item_id
  };
}

/**
 * Cancel an item listing
 */
async function cancelItemListing(client, userId, listingId) {
  // Get and lock the listing
  const listingResult = await client.query(
    `SELECT il.*, ci.modifications, it.name as template_name
     FROM item_listings il
     JOIN character_items ci ON il.character_item_id = ci.id
     JOIN item_templates it ON il.item_template_id = it.id
     WHERE il.id = $1 AND il.status = 'active'
     FOR UPDATE`,
    [listingId]
  );

  if (listingResult.rows.length === 0) {
    throw new AppError('Listing not found or already cancelled/sold', 404);
  }

  const listing = listingResult.rows[0];

  if (listing.seller_id !== userId) {
    throw new AppError('Not authorized to cancel this listing', 403);
  }

  // Remove "listed" flag from item
  const mods = listing.modifications || {};
  delete mods.listed;

  await client.query(
    `UPDATE character_items SET modifications = $1 WHERE id = $2`,
    [mods, listing.character_item_id]
  );

  // Update listing status
  await client.query(
    `UPDATE item_listings SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [listingId]
  );

  const itemName = mods.generatedName || listing.template_name;

  return {
    listingId,
    itemTemplateId: listing.item_template_id,
    itemName,
    characterItemId: listing.character_item_id
  };
}

/**
 * Get user's active listings
 */
async function getUserListings(client, userId) {
  const result = await client.query(
    `SELECT
       il.id as listing_id,
       il.price,
       il.suggested_price,
       il.created_at,
       il.modifications_snapshot as modifications,
       il.item_template_id,
       it.name as template_name,
       it.item_type
     FROM item_listings il
     JOIN item_templates it ON il.item_template_id = it.id
     WHERE il.seller_id = $1 AND il.status = 'active'
     ORDER BY il.created_at DESC`,
    [userId]
  );

  return result.rows.map(row => {
    const mods = row.modifications || {};
    return {
      listingId: row.listing_id,
      itemTemplateId: row.item_template_id,
      generatedName: mods.generatedName || row.template_name,
      templateName: row.template_name,
      itemType: row.item_type,
      rarity: mods.rarity || 'common',
      price: parseInt(row.price, 10),
      suggestedPrice: row.suggested_price ? parseInt(row.suggested_price, 10) : null,
      createdAt: row.created_at
    };
  });
}

/**
 * Search items with augment category filter
 * Extends the base searchItems to include augment filtering.
 *
 * @param {Object} client - Database client
 * @param {string} searchTerm - Search term to match item names
 * @param {string|null} itemType - Filter by item type (weapon, armor, etc.)
 * @param {string|null} augmentCategory - Filter by augment category (fire, ice, etc.)
 * @param {number} limit - Maximum results to return
 * @returns {Promise<Array>} Array of matching items with market data
 */
async function searchItemsWithAugments(client, searchTerm = '', itemType = null, augmentCategory = null, limit = 50) {
  // Build parameters array first to ensure proper indexing
  const params = [];
  let paramIndex = 1;

  // Pre-calculate parameter indices for augment filter (used in subquery)
  let augmentParamIndex = null;
  if (augmentCategory) {
    augmentParamIndex = paramIndex;
    params.push(JSON.stringify([{ category: augmentCategory }]));
    paramIndex++;
  }

  // Build the listings subquery with proper parameter index
  const listingsSubquery = augmentCategory
    ? `
      SELECT
        COUNT(*) as listing_count,
        MIN(price) as min_listing_price,
        MAX(price) as max_listing_price
      FROM item_listings
      WHERE item_template_id = it.id
        AND status = 'active'
        AND modifications_snapshot->'augments' @> $${augmentParamIndex}::jsonb
    `
    : `
      SELECT
        COUNT(*) as listing_count,
        MIN(price) as min_listing_price,
        MAX(price) as max_listing_price
      FROM item_listings
      WHERE item_template_id = it.id
        AND status = 'active'
    `;

  let query = `
    SELECT
      it.id,
      it.name,
      it.description,
      it.item_type,
      it.equipment_slot,
      it.stat_bonuses,
      it.level_requirement,
      it.base_price,
      it.rarity,
      it.is_stackable,
      COALESCE(ask.best_ask, 0) as best_ask,
      COALESCE(bid.best_bid, 0) as best_bid,
      COALESCE(vol.volume_24h, 0) as volume_24h,
      COALESCE(ord.open_orders, 0) as open_orders,
      COALESCE(listings.listing_count, 0) as listing_count,
      listings.min_listing_price,
      listings.max_listing_price
    FROM item_templates it
    LEFT JOIN LATERAL (
      SELECT MIN(price) as best_ask
      FROM market_orders
      WHERE item_template_id = it.id
        AND side = 'sell'
        AND status IN ('open', 'partial')
    ) ask ON true
    LEFT JOIN LATERAL (
      SELECT MAX(price) as best_bid
      FROM market_orders
      WHERE item_template_id = it.id
        AND side = 'buy'
        AND status IN ('open', 'partial')
    ) bid ON true
    LEFT JOIN LATERAL (
      SELECT SUM(quantity) as volume_24h
      FROM market_trades
      WHERE item_template_id = it.id
        AND executed_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
    ) vol ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as open_orders
      FROM market_orders
      WHERE item_template_id = it.id
        AND status IN ('open', 'partial')
    ) ord ON true
    LEFT JOIN LATERAL (
      ${listingsSubquery}
    ) listings ON true
    WHERE (it.is_tradeable IS NULL OR it.is_tradeable = TRUE)
  `;

  // Add remaining WHERE filters
  if (searchTerm) {
    query += ` AND it.name ILIKE $${paramIndex}`;
    params.push(`%${searchTerm}%`);
    paramIndex++;
  }

  if (itemType) {
    query += ` AND it.item_type = $${paramIndex}`;
    params.push(itemType);
    paramIndex++;
  }

  // Sort by activity (orders + listings), then alphabetically
  query += ` ORDER BY (COALESCE(ord.open_orders, 0) + COALESCE(listings.listing_count, 0)) DESC, it.name ASC LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await client.query(query, params);

  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    itemType: row.item_type,
    equipmentSlot: row.equipment_slot,
    statBonuses: row.stat_bonuses,
    levelRequirement: row.level_requirement,
    basePrice: row.base_price,
    rarity: row.rarity,
    isStackable: row.is_stackable,
    bestAsk: row.best_ask ? parseInt(row.best_ask, 10) : null,
    bestBid: row.best_bid ? parseInt(row.best_bid, 10) : null,
    volume24h: parseInt(row.volume_24h, 10) || 0,
    openOrders: parseInt(row.open_orders, 10) || 0,
    listingCount: parseInt(row.listing_count, 10) || 0,
    minListingPrice: row.min_listing_price ? parseInt(row.min_listing_price, 10) : null,
    maxListingPrice: row.max_listing_price ? parseInt(row.max_listing_price, 10) : null
  }));
}

/**
 * Get sellable items from user's inventory
 * Returns items that are: unequipped, tradeable, and not already listed on marketplace
 * @param {import('pg').PoolClient} client - Database client
 * @param {number} userId - User ID
 * @returns {Promise<Array>} List of sellable items with suggested prices
 */
async function getSellableInventory(client, userId) {
  // Query user's shared pool for tradeable items
  const result = await client.query(`
    SELECT
      ci.id as instance_id,
      ci.item_template_id as template_id,
      ci.quantity,
      ci.modifications,
      it.name,
      it.description,
      it.item_type,
      it.equipment_slot,
      it.stat_bonuses,
      it.level_requirement,
      it.base_price,
      it.rarity,
      it.is_stackable
    FROM character_items ci
    JOIN item_templates it ON ci.item_template_id = it.id
    WHERE ci.user_id = $1
      AND ci.equipped_slot IS NULL
      AND (it.is_tradeable IS NULL OR it.is_tradeable = TRUE)
      AND NOT EXISTS (
        SELECT 1 FROM item_listings il
        WHERE il.character_item_id = ci.id
        AND il.status = 'active'
      )
    ORDER BY it.item_type, it.rarity DESC, it.name
  `, [userId]);

  // Calculate suggested prices for each item
  const items = result.rows.map((row) => {
    // Extract augments from modifications if present
    const modifications = row.modifications || {};
    const augments = modifications.augments || [];

    // Calculate suggested price using the sync function
    const { suggestedPrice } = calculateSuggestedPrice({
      basePrice: row.base_price,
      rarity: modifications.rarity || row.rarity || 'common',
      augments
    });

    // Calculate stats from modifications
    const baseStats = row.stat_bonuses || {};
    const bonusStats = modifications.bonusStats || {};

    return {
      instanceId: row.instance_id,
      templateId: row.template_id,
      name: row.name,
      description: row.description,
      type: row.item_type,
      equipmentSlot: row.equipment_slot,
      baseStats,
      bonusStats,
      levelRequirement: row.level_requirement,
      basePrice: row.base_price,
      rarity: row.rarity,
      isStackable: row.is_stackable,
      quantity: row.quantity,
      augments,
      modifications,
      estimatedPrice: suggestedPrice
    };
  });

  return items;
}

export {
  getOrderBook,
  getMatchingOrders,
  reserveGold,
  releaseGold,
  escrowItems,
  releaseEscrowedItems,
  addItemToUser,
  executeTrade,
  placeLimitOrder,
  executeMarketOrder,
  cancelOrder,
  getUserOrders,
  getTradeHistory,
  searchItems,
  // Item listings for unique items
  calculateSuggestedPrice,
  getItemListings,
  getListingAggregates,
  createItemListing,
  buyItemListing,
  cancelItemListing,
  getUserListings,
  searchItemsWithAugments,
  getSellableInventory
};
