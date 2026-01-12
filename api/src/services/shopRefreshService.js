/**
 * Shop Stock Refresh Service
 *
 * Handles periodic restocking of NPC shop inventories.
 * Each shop type has a different restock interval:
 * - Blacksmith: 24 hours (weapons/armor - slow production)
 * - Apothecary: 12 hours (consumables - moderate production)
 * - Farm: 6 hours (materials - fast production)
 *
 * Restocking is ADDITIVE - new stock is added to existing quantity,
 * capped at the restock_quantity maximum to prevent infinite accumulation.
 *
 * @module shopRefreshService
 */

import { query, pool } from '../config/database.js';

/**
 * Restock intervals per shop type in milliseconds
 * @type {Object.<string, number>}
 */
const REFRESH_INTERVALS = {
  blacksmith: 24 * 60 * 60 * 1000,   // 24 hours
  apothecary: 12 * 60 * 60 * 1000,   // 12 hours
  farm: 6 * 60 * 60 * 1000           // 6 hours
};

/**
 * Amount to add per restock cycle (percentage of restock_quantity)
 * e.g., 0.25 means add 25% of max capacity per cycle
 * @type {number}
 */
const RESTOCK_PERCENTAGE = 0.25;

/**
 * Minimum amount to add per restock (ensures at least some stock is added)
 * @type {number}
 */
const MIN_RESTOCK_AMOUNT = 1;

/**
 * How often to check for shops needing restock (in milliseconds)
 * @type {number}
 */
const CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

/** Interval reference for cleanup */
let refreshIntervalId = null;

/**
 * Calculate the amount to add during restock
 * @param {number} restockQuantity - Maximum capacity for this item
 * @returns {number} Amount to add
 */
function calculateRestockAmount(restockQuantity) {
  const amount = Math.floor(restockQuantity * RESTOCK_PERCENTAGE);
  return Math.max(amount, MIN_RESTOCK_AMOUNT);
}

/**
 * Check and refresh all shops that are due for restock
 * @returns {Promise<{restocked: number, errors: number}>} Stats about the operation
 */
export async function checkAndRefreshShops() {
  const client = await pool.connect();
  const stats = { restocked: 0, errors: 0 };

  try {
    await client.query('BEGIN');

    // Process each shop type separately (different intervals)
    for (const [shopType, interval] of Object.entries(REFRESH_INTERVALS)) {
      try {
        const restocked = await restockShopType(client, shopType, interval);
        stats.restocked += restocked;
      } catch (err) {
        console.error(`Failed to restock ${shopType} shops:`, err);
        stats.errors++;
      }
    }

    await client.query('COMMIT');

    if (stats.restocked > 0) {
      console.log(`Shop refresh complete: ${stats.restocked} items restocked`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Shop refresh transaction failed:', err);
    throw err;
  } finally {
    client.release();
  }

  return stats;
}

/**
 * Restock all shops of a specific type that are due
 * @param {import('pg').PoolClient} client - Database client
 * @param {string} shopType - Shop type (blacksmith, apothecary, farm)
 * @param {number} interval - Restock interval in milliseconds
 * @returns {Promise<number>} Number of items restocked
 */
async function restockShopType(client, shopType, interval) {
  // Find all shop inventory entries due for restock
  // Criteria: last_restock + interval < NOW() AND quantity < restock_quantity
  const dueResult = await client.query(
    `SELECT id, node_id, item_template_id, quantity, restock_quantity, last_restock
     FROM npc_shop_inventory
     WHERE shop_type = $1
       AND quantity < restock_quantity
       AND last_restock < NOW() - ($2 || ' milliseconds')::INTERVAL
     FOR UPDATE`,
    [shopType, interval.toString()]
  );

  if (dueResult.rows.length === 0) {
    return 0;
  }

  let restockedCount = 0;

  for (const item of dueResult.rows) {
    const addAmount = calculateRestockAmount(item.restock_quantity);
    const newQuantity = Math.min(item.quantity + addAmount, item.restock_quantity);

    // Only update if we're actually adding stock
    if (newQuantity > item.quantity) {
      await client.query(
        `UPDATE npc_shop_inventory
         SET quantity = $1, last_restock = NOW()
         WHERE id = $2`,
        [newQuantity, item.id]
      );
      restockedCount++;
    }
  }

  return restockedCount;
}

/**
 * Force restock a specific shop at a node
 * Useful for testing or admin commands
 * @param {number} nodeId - World node ID
 * @param {string} shopType - Shop type
 * @returns {Promise<number>} Number of items restocked
 */
export async function forceRestockShop(nodeId, shopType) {
  const result = await query(
    `UPDATE npc_shop_inventory
     SET quantity = restock_quantity, last_restock = NOW()
     WHERE node_id = $1 AND shop_type = $2
     RETURNING id`,
    [nodeId, shopType]
  );

  return result.rows.length;
}

/**
 * Get restock status for a shop
 * @param {number} nodeId - World node ID
 * @param {string} shopType - Shop type
 * @returns {Promise<Object>} Restock status info
 */
export async function getRestockStatus(nodeId, shopType) {
  const interval = REFRESH_INTERVALS[shopType] || REFRESH_INTERVALS.blacksmith;

  const result = await query(
    `SELECT
       COUNT(*) as total_items,
       SUM(CASE WHEN quantity < restock_quantity THEN 1 ELSE 0 END) as low_stock_items,
       MIN(last_restock) as oldest_restock,
       MAX(last_restock) as newest_restock
     FROM npc_shop_inventory
     WHERE node_id = $1 AND shop_type = $2`,
    [nodeId, shopType]
  );

  const status = result.rows[0];
  const oldestRestock = status.oldest_restock ? new Date(status.oldest_restock) : null;
  const nextRestock = oldestRestock ? new Date(oldestRestock.getTime() + interval) : null;

  return {
    shopType,
    nodeId,
    totalItems: parseInt(status.total_items, 10),
    lowStockItems: parseInt(status.low_stock_items, 10),
    restockIntervalMs: interval,
    restockIntervalHours: interval / (60 * 60 * 1000),
    oldestRestock,
    nextRestock,
    isOverdue: nextRestock ? nextRestock < new Date() : false
  };
}

/**
 * Start the shop refresh scheduler
 * Runs checkAndRefreshShops at regular intervals
 */
export function startRefreshScheduler() {
  if (refreshIntervalId) {
    console.warn('Shop refresh scheduler already running');
    return;
  }

  // Run immediately on startup
  checkAndRefreshShops().catch(err => {
    console.error('Initial shop refresh failed:', err);
  });

  // Then run at regular intervals
  refreshIntervalId = setInterval(() => {
    checkAndRefreshShops().catch(err => {
      console.error('Scheduled shop refresh failed:', err);
    });
  }, CHECK_INTERVAL);

  console.log(`Shop refresh scheduler started (checking every ${CHECK_INTERVAL / 60000} minutes)`);
}

/**
 * Stop the shop refresh scheduler
 * Useful for graceful shutdown or testing
 */
export function stopRefreshScheduler() {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
    console.log('Shop refresh scheduler stopped');
  }
}

export default {
  checkAndRefreshShops,
  forceRestockShop,
  getRestockStatus,
  startRefreshScheduler,
  stopRefreshScheduler,
  REFRESH_INTERVALS
};
