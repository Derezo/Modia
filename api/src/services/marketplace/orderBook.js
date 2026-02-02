/**
 * @module marketplace/orderBook
 * @description Order book queries and price matching.
 *
 * Key responsibilities:
 * - Get aggregated order book (bids/asks)
 * - Find matching orders for price-time priority
 * - Calculate spread between best bid/ask
 *
 * @see orderManagement.js - Uses order book for order matching
 */

/**
 * Get the order book for an item (aggregated by price level)
 * @param {Object} client - Database client
 * @param {number} itemTemplateId - Item template ID
 * @param {number} depth - Number of price levels to return
 * @returns {Promise<Object>} Order book with bids, asks, and spread
 */
export async function getOrderBook(client, itemTemplateId, depth = 20) {
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
 * @param {Object} client - Database client
 * @param {number} itemTemplateId - Item template ID
 * @param {string} side - 'buy' or 'sell'
 * @param {number} price - Price to match against
 * @param {number} excludeUserId - User ID to exclude (can't match own orders)
 * @returns {Promise<Object>} Query result with matching orders
 */
export async function getMatchingOrders(client, itemTemplateId, side, price, excludeUserId) {
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
