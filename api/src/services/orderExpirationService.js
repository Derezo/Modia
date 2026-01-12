/**
 * Order Expiration Service
 *
 * Handles automatic expiration of marketplace orders that have been open
 * for longer than the configured expiry period (7 days by default).
 *
 * For expired buy orders: reserved gold is returned to the user
 * For expired sell orders: escrowed items are returned to the character
 *
 * Runs on an hourly schedule.
 */

import { pool } from '../config/database.js';
import { sendToUser } from '../websocket/index.js';
import {
  releaseGold,
  releaseEscrowedItems
} from './marketplaceService.js';

// Configuration
const ORDER_EXPIRY_DAYS = 7;
const CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds

let expirationIntervalId = null;

/**
 * Log order expiration to audit table
 * @param {Object} client - Database client
 * @param {number} userId - User whose order expired
 * @param {number} orderId - The expired order ID
 * @param {Object} details - Expiration details
 */
async function logOrderExpiration(client, userId, orderId, details) {
  await client.query(
    `INSERT INTO marketplace_audit
     (event_type, user_id, order_id, item_template_id, event_data)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      'order_expired',
      userId,
      orderId,
      details.itemTemplateId,
      JSON.stringify(details)
    ]
  );
}

/**
 * Find and expire all orders older than ORDER_EXPIRY_DAYS
 * @returns {Promise<{expired: number, errors: number}>} Statistics
 */
export async function expireOldOrders() {
  const client = await pool.connect();
  const stats = { expired: 0, errors: 0, notifications: [] };

  try {
    await client.query('BEGIN');

    // Find expired orders with FOR UPDATE to lock them
    const expiredOrdersResult = await client.query(
      `SELECT
         mo.id,
         mo.user_id,
         mo.character_id,
         mo.item_template_id,
         mo.side,
         mo.price,
         mo.quantity,
         mo.quantity_filled,
         mo.created_at,
         it.name as item_name
       FROM market_orders mo
       JOIN item_templates it ON mo.item_template_id = it.id
       WHERE mo.status IN ('open', 'partial')
         AND mo.created_at < NOW() - INTERVAL '1 day' * $1
       FOR UPDATE OF mo`,
      [ORDER_EXPIRY_DAYS]
    );

    const expiredOrders = expiredOrdersResult.rows;

    if (expiredOrders.length === 0) {
      await client.query('COMMIT');
      return stats;
    }

    console.log(`[OrderExpiration] Found ${expiredOrders.length} orders to expire`);

    for (const order of expiredOrders) {
      try {
        const remainingQuantity = order.quantity - order.quantity_filled;
        const orderId = order.id;

        if (order.side === 'buy') {
          // Release reserved gold back to user
          const goldReleased = await releaseGold(client, orderId);
          console.log(`[OrderExpiration] Released ${goldReleased} gold for buy order ${orderId}`);
        } else {
          // Return escrowed items to character
          const itemsReturned = await releaseEscrowedItems(client, orderId, order.character_id);
          console.log(`[OrderExpiration] Returned ${itemsReturned} items for sell order ${orderId}`);
        }

        // Update order status to expired
        await client.query(
          `UPDATE market_orders
           SET status = 'expired', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [orderId]
        );

        // Log to audit table
        await logOrderExpiration(client, order.user_id, orderId, {
          side: order.side,
          itemTemplateId: order.item_template_id,
          itemName: order.item_name,
          price: order.price,
          quantityOriginal: order.quantity,
          quantityFilled: order.quantity_filled,
          quantityExpired: remainingQuantity,
          createdAt: order.created_at
        });

        // Queue WebSocket notification
        stats.notifications.push({
          userId: order.user_id,
          payload: {
            type: 'marketplace:order_expired',
            orderId: orderId,
            itemName: order.item_name,
            side: order.side,
            price: order.price,
            quantityExpired: remainingQuantity
          }
        });

        stats.expired++;
      } catch (orderError) {
        console.error(`[OrderExpiration] Error expiring order ${order.id}:`, orderError);
        stats.errors++;
        // Continue processing other orders even if one fails
      }
    }

    await client.query('COMMIT');

    // Send WebSocket notifications after commit (outside transaction)
    for (const notification of stats.notifications) {
      try {
        sendToUser(notification.userId, notification.payload);
      } catch (wsError) {
        console.error(`[OrderExpiration] WebSocket notification failed for user ${notification.userId}:`, wsError);
      }
    }

    console.log(`[OrderExpiration] Completed: ${stats.expired} expired, ${stats.errors} errors`);
    return stats;

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[OrderExpiration] Transaction failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Start the order expiration scheduler
 * Runs immediately on start, then every CHECK_INTERVAL
 */
export function startExpirationScheduler() {
  if (expirationIntervalId) {
    console.log('[OrderExpiration] Scheduler already running');
    return;
  }

  console.log(`[OrderExpiration] Starting scheduler (${ORDER_EXPIRY_DAYS} day expiry, hourly check)`);

  // Run immediately on startup
  expireOldOrders().catch(err => {
    console.error('[OrderExpiration] Initial run failed:', err);
  });

  // Schedule hourly checks
  expirationIntervalId = setInterval(() => {
    expireOldOrders().catch(err => {
      console.error('[OrderExpiration] Scheduled run failed:', err);
    });
  }, CHECK_INTERVAL);
}

/**
 * Stop the order expiration scheduler
 */
export function stopExpirationScheduler() {
  if (expirationIntervalId) {
    clearInterval(expirationIntervalId);
    expirationIntervalId = null;
    console.log('[OrderExpiration] Scheduler stopped');
  }
}

/**
 * Get expiration configuration (for debugging/admin)
 */
export function getExpirationConfig() {
  return {
    expiryDays: ORDER_EXPIRY_DAYS,
    checkIntervalMs: CHECK_INTERVAL,
    isRunning: expirationIntervalId !== null
  };
}
