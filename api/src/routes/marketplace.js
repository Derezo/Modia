import express from 'express';
import { query, withTransaction, getClient } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { requireMarketplaceAccess } from '../middleware/marketplaceAccess.js';
import {
  orderLimiter,
  marketOrderLimiter,
  cancelLimiter,
  readLimiter,
  searchLimiter
} from '../middleware/marketplaceRateLimiter.js';
import * as marketplaceService from '../services/marketplaceService.js';
import { logger } from '../utils/logger.js';
import { parseIntOrThrow } from '../utils/validateNumericParam.js';

const router = express.Router();

// ============================================
// GET /api/marketplace/orderbook/:itemTemplateId - Get order book
// ============================================
router.get('/orderbook/:itemTemplateId', authenticate, readLimiter, asyncHandler(async (req, res) => {
  const { itemTemplateId } = req.params;
  const { depth = 20 } = req.query;

  const templateId = parseIntOrThrow(itemTemplateId, 'item template ID');
  const parsedDepth = parseIntOrThrow(depth, 'depth', { defaultValue: 20, min: 1, max: 100 });

  // Verify item exists and is tradeable
  const itemResult = await query(
    'SELECT id, name, is_tradeable FROM item_templates WHERE id = $1',
    [templateId]
  );

  if (itemResult.rows.length === 0) {
    throw new AppError('Item not found', 404);
  }

  if (itemResult.rows[0].is_tradeable === false) {
    throw new AppError('This item cannot be traded', 400);
  }

  const client = await getClient();
  try {
    const orderBook = await marketplaceService.getOrderBook(client, templateId, parsedDepth);
    orderBook.itemName = itemResult.rows[0].name;
    res.json(orderBook);
  } finally {
    client.release();
  }
}));

// ============================================
// GET /api/marketplace/orders/mine - Get player's open orders
// ============================================
router.get('/orders/mine', authenticate, readLimiter, asyncHandler(async (req, res) => {
  const { status } = req.query;

  const client = await getClient();
  try {
    const orders = await marketplaceService.getUserOrders(client, req.user.userId, status);
    res.json({ orders });
  } finally {
    client.release();
  }
}));

// Maximum price limit to prevent economic manipulation
const MAX_PRICE = 999999999;

// ============================================
// POST /api/marketplace/orders/limit - Place limit order
// ============================================
router.post('/orders/limit', authenticate, requireMarketplaceAccess, orderLimiter, asyncHandler(async (req, res) => {
  logger.debug('marketplace', 'Limit order request', { body: req.body, userId: req.user.userId });
  const { itemTemplateId, side, characterId } = req.body;

  // SECURITY: Strict price and quantity validation to prevent exploits
  const price = parseInt(req.body.price, 10);
  const quantity = parseInt(req.body.quantity, 10);

  if (!Number.isInteger(price) || isNaN(price)) {
    throw new AppError('Price must be a valid integer', 400);
  }
  if (!Number.isInteger(quantity) || isNaN(quantity)) {
    throw new AppError('Quantity must be a valid integer', 400);
  }

  // Validate inputs
  if (!itemTemplateId) {
    throw new AppError('Item template ID required', 400);
  }
  if (!['buy', 'sell'].includes(side)) {
    throw new AppError('Side must be "buy" or "sell"', 400);
  }
  if (price < 1) {
    throw new AppError('Price must be at least 1', 400);
  }
  if (price > MAX_PRICE) {
    throw new AppError(`Price cannot exceed ${MAX_PRICE}`, 400);
  }
  if (quantity < 1 || quantity > 9999) {
    throw new AppError('Quantity must be between 1 and 9999', 400);
  }

  // SECURITY: Validate total order value doesn't overflow
  const totalValue = price * quantity;
  if (totalValue > Number.MAX_SAFE_INTEGER) {
    throw new AppError('Total order value too large', 400);
  }

  // Verify character belongs to user
  const charResult = await query(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  logger.debug('marketplace', 'Character validated, starting transaction');

  const result = await withTransaction(async (client) => {
    return marketplaceService.placeLimitOrder(
      client,
      req.user.userId,
      characterId,
      parseInt(itemTemplateId, 10),
      side,
      parseInt(price, 10),
      parseInt(quantity, 10)
    );
  });

  logger.debug('marketplace', 'Transaction completed', { orderId: result?.order?.id });

  // Get updated user gold
  const userResult = await query('SELECT gold FROM users WHERE id = $1', [req.user.userId]);

  // Post-transaction operations (non-blocking, don't affect response)
  // These happen AFTER commit to avoid deadlocks with the transaction
  if (result._postCommit) {
    const pc = result._postCommit;

    // WebSocket broadcast - get fresh order book data
    setImmediate(async () => {
      try {
        const client = await getClient();
        try {
          const updatedOrderBook = await marketplaceService.getOrderBook(client, pc.itemTemplateId, 20);
          const { broadcastOrderBookUpdate } = await import('../services/marketplaceWebsocket.js');
          broadcastOrderBookUpdate(pc.itemTemplateId, updatedOrderBook);
        } finally {
          client.release();
        }
      } catch (wsError) {
        console.error('WebSocket order book broadcast failed:', wsError);
      }
    });

    // Audit logging
    setImmediate(async () => {
      try {
        const marketplaceAudit = await import('../services/marketplaceAuditService.js');
        await marketplaceAudit.logOrderPlacement(pc.userId, pc.characterId, pc.orderId, {
          itemTemplateId: pc.itemTemplateId,
          side: pc.side,
          price: pc.price,
          quantity: pc.quantity,
          immediatelyFilled: result.order.status === 'filled',
          partiallyFilled: result.order.status === 'partial'
        }, req);
      } catch (auditError) {
        console.error('Audit logging failed:', auditError);
      }
    });
  }

  res.json({
    success: true,
    message: `${side === 'buy' ? 'Buy' : 'Sell'} order placed for ${result.itemName}`,
    order: {
      id: result.order.id,
      side: result.order.side,
      price: parseInt(result.order.price, 10),
      quantity: parseInt(result.order.quantity, 10),
      quantityFilled: parseInt(result.order.quantity_filled, 10),
      status: result.order.status,
      itemName: result.itemName
    },
    trades: result.trades,
    immediatelyFilled: result.order.status === 'filled',
    partiallyFilled: result.order.status === 'partial',
    gold: userResult.rows[0].gold
  });
}));

// ============================================
// POST /api/marketplace/orders/market - Execute market order
// ============================================
router.post('/orders/market', authenticate, requireMarketplaceAccess, marketOrderLimiter, asyncHandler(async (req, res) => {
  const { itemTemplateId, side, characterId } = req.body;

  // SECURITY: Strict quantity validation to prevent exploits
  const quantity = parseInt(req.body.quantity, 10);
  if (!Number.isInteger(quantity) || isNaN(quantity)) {
    throw new AppError('Quantity must be a valid integer', 400);
  }

  // Validate inputs
  if (!itemTemplateId) {
    throw new AppError('Item template ID required', 400);
  }
  if (!['buy', 'sell'].includes(side)) {
    throw new AppError('Side must be "buy" or "sell"', 400);
  }
  if (quantity < 1 || quantity > 9999) {
    throw new AppError('Quantity must be between 1 and 9999', 400);
  }

  // Verify character belongs to user
  const charResult = await query(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  const result = await withTransaction(async (client) => {
    return marketplaceService.executeMarketOrder(
      client,
      req.user.userId,
      characterId,
      parseInt(itemTemplateId, 10),
      side,
      parseInt(quantity, 10)
    );
  });

  // Get updated user gold
  const userResult = await query('SELECT gold FROM users WHERE id = $1', [req.user.userId]);

  // Post-transaction audit logging
  if (result._postCommit) {
    const pc = result._postCommit;
    setImmediate(async () => {
      try {
        const marketplaceAudit = await import('../services/marketplaceAuditService.js');
        if (pc.side === 'buy') {
          await marketplaceAudit.logMarketBuy(pc.userId, pc.characterId, {
            itemTemplateId: pc.itemTemplateId,
            quantity: pc.quantity,
            totalGold: pc.totalGold,
            averagePrice: pc.totalGold / pc.quantity,
            tradesCount: pc.tradesCount
          }, req);
        } else {
          await marketplaceAudit.logMarketSell(pc.userId, pc.characterId, {
            itemTemplateId: pc.itemTemplateId,
            quantity: pc.quantity,
            totalGold: pc.totalGold,
            averagePrice: pc.totalGold / pc.quantity,
            tradesCount: pc.tradesCount
          }, req);
        }
      } catch (auditError) {
        console.error('Audit logging failed:', auditError);
      }
    });
  }

  res.json({
    success: true,
    message: `Market ${side} executed: ${result.totalQuantity}x ${result.itemName} @ avg ${Math.round(result.averagePrice)}g`,
    trades: result.trades,
    totalQuantity: result.totalQuantity,
    totalGold: result.totalGold,
    averagePrice: Math.round(result.averagePrice),
    gold: userResult.rows[0].gold
  });
}));

// ============================================
// DELETE /api/marketplace/orders/:orderId - Cancel order
// ============================================
router.delete('/orders/:orderId', authenticate, requireMarketplaceAccess, cancelLimiter, asyncHandler(async (req, res) => {
  const { orderId } = req.params;

  const orderIdNum = parseInt(orderId, 10);
  if (isNaN(orderIdNum)) {
    throw new AppError('Invalid order ID', 400);
  }

  const result = await withTransaction(async (client) => {
    return marketplaceService.cancelOrder(client, orderIdNum, req.user.userId);
  });

  // Get updated user gold
  const userResult = await query('SELECT gold FROM users WHERE id = $1', [req.user.userId]);

  // Post-transaction audit logging
  if (result._postCommit) {
    const pc = result._postCommit;
    setImmediate(async () => {
      try {
        const marketplaceAudit = await import('../services/marketplaceAuditService.js');
        await marketplaceAudit.logOrderCancellation(pc.userId, orderIdNum, {
          itemTemplateId: pc.itemTemplateId,
          side: result.side,
          remainingQuantity: result.returnedQuantity,
          price: pc.price
        }, req);
      } catch (auditError) {
        console.error('Audit logging failed:', auditError);
      }
    });
  }

  res.json({
    success: true,
    message: `Order cancelled. ${result.side === 'buy' ? `${result.returnedGold}g returned` : `${result.returnedQuantity}x ${result.itemName} returned`}`,
    ...result,
    gold: userResult.rows[0].gold
  });
}));

// ============================================
// GET /api/marketplace/search - Search tradeable items
// ============================================
router.get('/search', authenticate, searchLimiter, asyncHandler(async (req, res) => {
  const { q = '', type, augment, limit = 50 } = req.query;
  const parsedLimit = parseIntOrThrow(limit, 'limit', { defaultValue: 50, min: 1, max: 100 });

  const client = await getClient();
  try {
    // Use enhanced search if augment filter is provided
    const items = augment
      ? await marketplaceService.searchItemsWithAugments(
        client,
        q,
        type || null,
        augment,
        parsedLimit
      )
      : await marketplaceService.searchItems(
        client,
        q,
        type || null,
        parsedLimit
      );
    res.json({ items });
  } finally {
    client.release();
  }
}));

// ============================================
// ITEM LISTINGS - For unique items with augments
// ============================================

// ============================================
// GET /api/marketplace/items/:templateId - Get all listings for a template
// ============================================
router.get('/items/:templateId', authenticate, readLimiter, asyncHandler(async (req, res) => {
  const { templateId } = req.params;
  const templateIdNum = parseIntOrThrow(templateId, 'template ID');

  // Get template info
  const templateResult = await query(
    'SELECT id, name, item_type, base_price, is_stackable FROM item_templates WHERE id = $1',
    [templateIdNum]
  );

  if (templateResult.rows.length === 0) {
    throw new AppError('Item template not found', 404);
  }

  const template = templateResult.rows[0];

  const client = await getClient();
  try {
    const listings = await marketplaceService.getItemListings(client, templateIdNum);

    res.json({
      templateId: templateIdNum,
      templateName: template.name,
      itemType: template.item_type,
      basePrice: template.base_price,
      isStackable: template.is_stackable,
      listings
    });
  } finally {
    client.release();
  }
}));

// ============================================
// GET /api/marketplace/listings/mine - Get user's active listings
// ============================================
router.get('/listings/mine', authenticate, readLimiter, asyncHandler(async (req, res) => {
  const client = await getClient();
  try {
    const listings = await marketplaceService.getUserListings(client, req.user.userId);
    res.json({ listings });
  } finally {
    client.release();
  }
}));

// ============================================
// GET /api/marketplace/inventory/sellable - Get sellable items from user's inventory
// Returns items that are: unequipped, tradeable, and not already listed
// ============================================
router.get('/inventory/sellable', authenticate, readLimiter, asyncHandler(async (req, res) => {
  const client = await getClient();
  try {
    const items = await marketplaceService.getSellableInventory(client, req.user.userId);
    res.json({ success: true, items });
  } finally {
    client.release();
  }
}));

// ============================================
// POST /api/marketplace/listings - Create a new item listing
// ============================================
router.post('/listings', authenticate, requireMarketplaceAccess, orderLimiter, asyncHandler(async (req, res) => {
  const { characterId, characterItemId, price } = req.body;

  // Validate inputs
  if (!characterId) {
    throw new AppError('Character ID required', 400);
  }
  if (!characterItemId) {
    throw new AppError('Character item ID required', 400);
  }

  const priceNum = parseInt(price, 10);
  if (!Number.isInteger(priceNum) || isNaN(priceNum)) {
    throw new AppError('Price must be a valid integer', 400);
  }
  if (priceNum < 1) {
    throw new AppError('Price must be at least 1', 400);
  }
  if (priceNum > MAX_PRICE) {
    throw new AppError(`Price cannot exceed ${MAX_PRICE}`, 400);
  }

  // Verify character belongs to user
  const charResult = await query(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  const result = await withTransaction(async (client) => {
    return marketplaceService.createItemListing(
      client,
      req.user.userId,
      parseInt(characterId, 10),
      parseInt(characterItemId, 10),
      priceNum
    );
  });

  res.json({
    success: true,
    message: `Listed ${result.itemName} for ${result.price}g`,
    listing: result
  });
}));

// ============================================
// POST /api/marketplace/listings/:listingId/buy - Buy an item listing
// ============================================
router.post('/listings/:listingId/buy', authenticate, requireMarketplaceAccess, marketOrderLimiter, asyncHandler(async (req, res) => {
  const { listingId } = req.params;
  const { characterId } = req.body;

  const listingIdNum = parseInt(listingId, 10);
  if (isNaN(listingIdNum)) {
    throw new AppError('Invalid listing ID', 400);
  }

  if (!characterId) {
    throw new AppError('Character ID required', 400);
  }

  // Verify character belongs to user
  const charResult = await query(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [characterId, req.user.userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('Character not found', 404);
  }

  const result = await withTransaction(async (client) => {
    return marketplaceService.buyItemListing(
      client,
      req.user.userId,
      parseInt(characterId, 10),
      listingIdNum
    );
  });

  // Get updated user gold
  const userResult = await query('SELECT gold FROM users WHERE id = $1', [req.user.userId]);

  res.json({
    success: true,
    message: `Purchased ${result.itemName} for ${result.price}g`,
    purchase: result,
    gold: userResult.rows[0].gold
  });
}));

// ============================================
// DELETE /api/marketplace/listings/:listingId - Cancel a listing
// ============================================
router.delete('/listings/:listingId', authenticate, requireMarketplaceAccess, cancelLimiter, asyncHandler(async (req, res) => {
  const { listingId } = req.params;

  const listingIdNum = parseInt(listingId, 10);
  if (isNaN(listingIdNum)) {
    throw new AppError('Invalid listing ID', 400);
  }

  const result = await withTransaction(async (client) => {
    return marketplaceService.cancelItemListing(client, req.user.userId, listingIdNum);
  });

  res.json({
    success: true,
    message: `Listing for ${result.itemName} cancelled`,
    cancelled: result
  });
}));

// ============================================
// GET /api/marketplace/price-suggestion - Get suggested price for an item
// ============================================
router.get('/price-suggestion', authenticate, readLimiter, asyncHandler(async (req, res) => {
  const { characterItemId, characterId } = req.query;

  if (!characterItemId || !characterId) {
    throw new AppError('Character item ID and character ID required', 400);
  }

  // Get item with modifications
  const itemResult = await query(
    `SELECT ci.modifications, it.base_price, it.name
     FROM character_items ci
     JOIN item_templates it ON ci.item_template_id = it.id
     JOIN characters c ON ci.character_id = c.id
     WHERE ci.id = $1 AND ci.character_id = $2 AND c.user_id = $3`,
    [characterItemId, characterId, req.user.userId]
  );

  if (itemResult.rows.length === 0) {
    throw new AppError('Item not found or not owned', 404);
  }

  const item = itemResult.rows[0];
  const mods = item.modifications || {};

  const result = marketplaceService.calculateSuggestedPrice({
    basePrice: item.base_price,
    rarity: mods.rarity || 'common',
    augments: mods.augments || []
  });

  res.json({
    itemName: mods.generatedName || item.name,
    ...result
  });
}));

// ============================================
// GET /api/marketplace/history/:itemTemplateId - Trade history
// ============================================
router.get('/history/:itemTemplateId', authenticate, readLimiter, asyncHandler(async (req, res) => {
  const { itemTemplateId } = req.params;
  const { limit = 50 } = req.query;

  const templateId = parseIntOrThrow(itemTemplateId, 'item template ID');
  const parsedLimit = parseIntOrThrow(limit, 'limit', { defaultValue: 50, min: 1, max: 100 });

  // Verify item exists
  const itemResult = await query(
    'SELECT id, name FROM item_templates WHERE id = $1',
    [templateId]
  );

  if (itemResult.rows.length === 0) {
    throw new AppError('Item not found', 404);
  }

  const client = await getClient();
  try {
    const history = await marketplaceService.getTradeHistory(client, templateId, parsedLimit);
    res.json({
      itemTemplateId: templateId,
      itemName: itemResult.rows[0].name,
      trades: history
    });
  } finally {
    client.release();
  }
}));

// ============================================
// GET /api/marketplace/my-trades - User's trade history
// ============================================
router.get('/my-trades', authenticate, readLimiter, asyncHandler(async (req, res) => {
  const { limit = 50 } = req.query;
  const parsedLimit = parseIntOrThrow(limit, 'limit', { defaultValue: 50, min: 1, max: 100 });

  const result = await query(
    `SELECT
       mt.id,
       mt.item_template_id,
       it.name as item_name,
       mt.price,
       mt.quantity,
       mt.total_gold,
       mt.executed_at,
       CASE WHEN mt.buyer_id = $1 THEN 'buy' ELSE 'sell' END as side
     FROM market_trades mt
     JOIN item_templates it ON mt.item_template_id = it.id
     WHERE mt.buyer_id = $1 OR mt.seller_id = $1
     ORDER BY mt.executed_at DESC
     LIMIT $2`,
    [req.user.userId, parsedLimit]
  );

  res.json({
    trades: result.rows.map(row => ({
      id: row.id,
      itemTemplateId: row.item_template_id,
      itemName: row.item_name,
      side: row.side,
      price: parseInt(row.price, 10),
      quantity: parseInt(row.quantity, 10),
      totalGold: parseInt(row.total_gold, 10),
      executedAt: row.executed_at
    }))
  });
}));

// ============================================
// GET /api/marketplace/stats/:itemTemplateId - Item market stats
// ============================================
router.get('/stats/:itemTemplateId', authenticate, readLimiter, asyncHandler(async (req, res) => {
  const { itemTemplateId } = req.params;

  const templateId = parseInt(itemTemplateId, 10);
  if (isNaN(templateId)) {
    throw new AppError('Invalid item template ID', 400);
  }

  // Get item info
  const itemResult = await query(
    'SELECT id, name, base_price FROM item_templates WHERE id = $1',
    [templateId]
  );

  if (itemResult.rows.length === 0) {
    throw new AppError('Item not found', 404);
  }

  // Get 24h stats
  const statsResult = await query(
    `SELECT
       COUNT(*) as trade_count,
       SUM(quantity) as volume,
       SUM(total_gold) as gold_volume,
       MIN(price) as low_price,
       MAX(price) as high_price,
       AVG(price) as avg_price
     FROM market_trades
     WHERE item_template_id = $1
       AND executed_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'`,
    [templateId]
  );

  // Get last trade price
  const lastTradeResult = await query(
    `SELECT price FROM market_trades
     WHERE item_template_id = $1
     ORDER BY executed_at DESC
     LIMIT 1`,
    [templateId]
  );

  const stats = statsResult.rows[0];

  res.json({
    itemTemplateId: templateId,
    itemName: itemResult.rows[0].name,
    basePrice: itemResult.rows[0].base_price,
    stats24h: {
      tradeCount: parseInt(stats.trade_count, 10) || 0,
      volume: parseInt(stats.volume, 10) || 0,
      goldVolume: parseInt(stats.gold_volume, 10) || 0,
      lowPrice: stats.low_price ? parseInt(stats.low_price, 10) : null,
      highPrice: stats.high_price ? parseInt(stats.high_price, 10) : null,
      avgPrice: stats.avg_price ? Math.round(parseFloat(stats.avg_price)) : null
    },
    lastTradePrice: lastTradeResult.rows[0]?.price ? parseInt(lastTradeResult.rows[0].price, 10) : null
  });
}));

export default router;
