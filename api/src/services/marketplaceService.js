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
import * as marketplaceAudit from './marketplaceAuditService.js';

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
 * Escrow items for a sell order
 */
async function escrowItems(client, orderId, characterId, itemTemplateId, quantity) {
  // Check character has enough items (not equipped)
  const itemResult = await client.query(
    `SELECT id, quantity
     FROM character_items
     WHERE character_id = $1
       AND item_template_id = $2
       AND equipped_slot IS NULL
     ORDER BY quantity DESC
     FOR UPDATE`,
    [characterId, itemTemplateId]
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

  // Deduct items from inventory
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

  // Create escrow record
  await client.query(
    'INSERT INTO item_escrow (order_id, character_id, item_template_id, quantity) VALUES ($1, $2, $3, $4)',
    [orderId, characterId, itemTemplateId, quantity]
  );

  return quantity;
}

/**
 * Release escrowed items (on order cancel)
 */
async function releaseEscrowedItems(client, orderId, characterId = null) {
  // Get escrow record
  const escrowResult = await client.query(
    'SELECT character_id, item_template_id, quantity FROM item_escrow WHERE order_id = $1',
    [orderId]
  );

  if (escrowResult.rows.length === 0) {
    return 0;
  }

  const escrow = escrowResult.rows[0];
  const targetCharId = characterId || escrow.character_id;

  // Return items to character
  await addItemToCharacter(client, targetCharId, escrow.item_template_id, escrow.quantity);

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
 * Add items to a character's inventory (stacking consumables/materials)
 */
async function addItemToCharacter(client, characterId, itemTemplateId, quantity) {
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
    // Try to stack with existing item
    const existingResult = await client.query(
      `SELECT id, quantity FROM character_items
       WHERE character_id = $1 AND item_template_id = $2 AND equipped_slot IS NULL`,
      [characterId, itemTemplateId]
    );

    if (existingResult.rows.length > 0) {
      await client.query(
        'UPDATE character_items SET quantity = quantity + $1 WHERE id = $2',
        [quantity, existingResult.rows[0].id]
      );
      return;
    }
  }

  // Create new item entry (or multiple for non-stackable)
  if (stackable) {
    await client.query(
      'INSERT INTO character_items (character_id, item_template_id, quantity) VALUES ($1, $2, $3)',
      [characterId, itemTemplateId, quantity]
    );
  } else {
    // Non-stackable items get individual entries
    for (let i = 0; i < quantity; i++) {
      await client.query(
        'INSERT INTO character_items (character_id, item_template_id, quantity) VALUES ($1, $2, 1)',
        [characterId, itemTemplateId]
      );
    }
  }
}

/**
 * Execute a trade between two orders
 */
async function executeTrade(client, buyOrder, sellOrder, quantity, executionPrice, itemName = null) {
  const itemTemplateId = buyOrder.item_template_id || sellOrder.item_template_id;

  // Record the trade
  await client.query(
    `INSERT INTO market_trades
     (buy_order_id, sell_order_id, item_template_id, buyer_id, seller_id, price, quantity, total_gold)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
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

  // Update order fill quantities (triggers will update status)
  await client.query(
    'UPDATE market_orders SET quantity_filled = quantity_filled + $1 WHERE id = $2',
    [quantity, buyOrder.id]
  );

  await client.query(
    'UPDATE market_orders SET quantity_filled = quantity_filled + $1 WHERE id = $2',
    [quantity, sellOrder.id]
  );

  // Transfer gold from buyer's reservation to seller
  const totalGold = executionPrice * quantity;

  // Reduce buyer's gold reservation
  await client.query(
    'UPDATE gold_reservations SET amount = amount - $1 WHERE order_id = $2',
    [totalGold, buyOrder.id]
  );

  // Add gold to seller (capped at MAX_GOLD to prevent overflow)
  await client.query(
    'UPDATE users SET gold = LEAST(gold + $1, $2) WHERE id = $3',
    [totalGold, MAX_GOLD, sellOrder.user_id]
  );

  // Reduce seller's item escrow
  await reduceEscrow(client, sellOrder.id, quantity);

  // Get buyer's character for item delivery
  const buyOrderResult = await client.query(
    'SELECT character_id, item_template_id FROM market_orders WHERE id = $1',
    [buyOrder.id]
  );
  const buyOrderData = buyOrderResult.rows[0];

  // Deliver items to buyer's character
  await addItemToCharacter(
    client,
    buyOrderData.character_id,
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
    // Notify buyer
    marketplaceWebsocket.notifyOrderFilled(buyOrder.user_id, {
      orderId: buyOrder.id,
      side: 'buy',
      itemTemplateId: itemTemplateId,
      itemName: itemName,
      price: executionPrice,
      quantity: quantity,
      totalGold: totalGold,
      remainingQuantity: buyRemainingQty,
      orderStatus: newBuyStatus, // 'filled' or 'partial'
      newGoldBalance: null // Will be updated in caller if needed
    });

    // Notify seller
    marketplaceWebsocket.notifyOrderFilled(sellOrder.user_id, {
      orderId: sellOrder.id,
      side: 'sell',
      itemTemplateId: itemTemplateId,
      itemName: itemName,
      price: executionPrice,
      quantity: quantity,
      totalGold: totalGold,
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

  // Audit log (wrapped in try-catch to not break the transaction)
  try {
    await marketplaceAudit.logTradeExecution(buyOrder.user_id, sellOrder.user_id, {
      buyOrderId: buyOrder.id,
      sellOrderId: sellOrder.id,
      itemTemplateId: itemTemplateId,
      price: executionPrice,
      quantity: quantity,
      totalGold: totalGold
    });
  } catch (auditError) {
    console.error('Audit logging failed in executeTrade:', auditError);
  }

  return {
    quantity,
    price: executionPrice,
    totalGold
  };
}

/**
 * Place a limit order with automatic matching
 */
async function placeLimitOrder(client, userId, characterId, itemTemplateId, side, price, quantity) {
  // Check open order count - max per user
  const orderCountResult = await client.query(
    `SELECT COUNT(*) as count FROM market_orders
     WHERE user_id = $1 AND status IN ('open', 'partial')`,
    [userId]
  );
  if (parseInt(orderCountResult.rows[0].count, 10) >= MAX_OPEN_ORDERS_PER_USER) {
    throw new AppError(`Maximum of ${MAX_OPEN_ORDERS_PER_USER} open orders allowed. Cancel existing orders first.`, 400);
  }

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

  // Create the order
  const orderResult = await client.query(
    `INSERT INTO market_orders (user_id, character_id, item_template_id, side, price, quantity)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, character_id, item_template_id, side, price, quantity, quantity_filled, status, created_at`,
    [userId, characterId, itemTemplateId, side, price, quantity]
  );

  const order = orderResult.rows[0];

  // Reserve gold for buy orders or escrow items for sell orders
  if (side === 'buy') {
    const totalCost = price * quantity;
    await reserveGold(client, userId, order.id, totalCost);
  } else {
    await escrowItems(client, order.id, characterId, itemTemplateId, quantity);
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

  // Broadcast order book update after order is placed/filled
  try {
    const updatedOrderBook = await getOrderBook(client, itemTemplateId, 20);
    marketplaceWebsocket.broadcastOrderBookUpdate(itemTemplateId, updatedOrderBook);
  } catch (wsError) {
    console.error('WebSocket order book broadcast failed in placeLimitOrder:', wsError);
  }

  // Audit log for order placement
  try {
    await marketplaceAudit.logOrderPlacement(userId, characterId, order.id, {
      itemTemplateId,
      side,
      price,
      quantity,
      immediatelyFilled: updatedOrder.status === 'filled',
      partiallyFilled: updatedOrder.status === 'partial'
    });
  } catch (auditError) {
    console.error('Audit logging failed in placeLimitOrder:', auditError);
  }

  return {
    order: updatedOrder,
    trades,
    itemName: itemName
  };
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
    // Check character has enough items
    const itemCheck = await client.query(
      `SELECT COALESCE(SUM(quantity), 0) as total
       FROM character_items
       WHERE character_id = $1
         AND item_template_id = $2
         AND equipped_slot IS NULL`,
      [characterId, itemTemplateId]
    );

    if (parseInt(itemCheck.rows[0].total, 10) < quantity) {
      throw new AppError(`Insufficient items. Have ${itemCheck.rows[0].total}, need ${quantity}`, 400);
    }

    // Deduct items from seller
    const itemResult = await client.query(
      `SELECT id, quantity
       FROM character_items
       WHERE character_id = $1
         AND item_template_id = $2
         AND equipped_slot IS NULL
       ORDER BY quantity DESC
       FOR UPDATE`,
      [characterId, itemTemplateId]
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
      // Transfer gold to seller and reduce their reservation (capped at MAX_GOLD)
      await client.query(
        'UPDATE users SET gold = LEAST(gold + $1, $2) WHERE id = $3',
        [executionPrice * matchQty, MAX_GOLD, order.user_id]
      );

      // Reduce seller's escrow
      await reduceEscrow(client, order.id, matchQty);

      // Give items to buyer
      await addItemToCharacter(client, characterId, itemTemplateId, matchQty);
    } else {
      // Buyer pays from their reservation
      const goldCost = executionPrice * matchQty;
      await client.query(
        'UPDATE gold_reservations SET amount = amount - $1 WHERE order_id = $2',
        [goldCost, order.id]
      );

      // Seller receives gold
      totalProceeds += goldCost;

      // Buyer receives items
      const buyerOrderResult = await client.query(
        'SELECT character_id FROM market_orders WHERE id = $1',
        [order.id]
      );
      await addItemToCharacter(client, buyerOrderResult.rows[0].character_id, itemTemplateId, matchQty);
    }

    trades.push({
      orderId: order.id,
      quantity: matchQty,
      price: executionPrice,
      totalGold: executionPrice * matchQty
    });
  }

  // For sell orders: give gold to seller (capped at MAX_GOLD)
  if (side === 'sell') {
    await client.query(
      'UPDATE users SET gold = LEAST(gold + $1, $2) WHERE id = $3',
      [totalProceeds, MAX_GOLD, userId]
    );
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

  // Audit log for market order execution
  try {
    if (side === 'buy') {
      await marketplaceAudit.logMarketBuy(userId, characterId, {
        itemTemplateId,
        quantity,
        totalGold: totalCost,
        averagePrice: totalCost / quantity,
        tradesCount: trades.length
      });
    } else {
      await marketplaceAudit.logMarketSell(userId, characterId, {
        itemTemplateId,
        quantity,
        totalGold: totalProceeds,
        averagePrice: totalProceeds / quantity,
        tradesCount: trades.length
      });
    }
  } catch (auditError) {
    console.error('Audit logging failed in executeMarketOrder:', auditError);
  }

  return {
    trades,
    totalQuantity: quantity,
    totalGold: side === 'buy' ? totalCost : totalProceeds,
    averagePrice: (side === 'buy' ? totalCost : totalProceeds) / quantity,
    itemName: itemName
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
    // Return remaining escrowed items to the character
    await releaseEscrowedItems(client, orderId, order.character_id);
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

  // Audit log
  try {
    await marketplaceAudit.logOrderCancellation(userId, orderId, {
      itemTemplateId: order.item_template_id,
      side: order.side,
      remainingQuantity: remainingQuantity,
      price: order.price
    });
  } catch (auditError) {
    console.error('Audit logging failed in cancelOrder:', auditError);
  }

  return {
    orderId,
    side: order.side,
    returnedQuantity: remainingQuantity,
    returnedGold: refundedGold,
    itemName: itemResult.rows[0].name
  };
}

/**
 * Get user's open orders
 */
async function getUserOrders(client, userId, status = null) {
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
      COALESCE(ask.best_ask, 0) as best_ask,
      COALESCE(bid.best_bid, 0) as best_bid,
      COALESCE(vol.volume_24h, 0) as volume_24h
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

  query += ` ORDER BY COALESCE(vol.volume_24h, 0) DESC, it.name ASC LIMIT $${paramIndex}`;
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
    bestAsk: row.best_ask ? parseInt(row.best_ask, 10) : null,
    bestBid: row.best_bid ? parseInt(row.best_bid, 10) : null,
    volume24h: parseInt(row.volume_24h, 10) || 0
  }));
}

export {
  getOrderBook,
  getMatchingOrders,
  reserveGold,
  releaseGold,
  escrowItems,
  releaseEscrowedItems,
  addItemToCharacter,
  executeTrade,
  placeLimitOrder,
  executeMarketOrder,
  cancelOrder,
  getUserOrders,
  getTradeHistory,
  searchItems
};
