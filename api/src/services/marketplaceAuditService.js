/**
 * Marketplace Audit Service
 *
 * Provides audit logging for all marketplace operations.
 * Logs are stored in the marketplace_audit table for security monitoring,
 * debugging, and analytics.
 */

import { query } from '../config/database.js';

/**
 * Log a marketplace order placement
 * @param {number} userId - User placing the order
 * @param {number} characterId - Character associated with the order
 * @param {number} orderId - The created order ID
 * @param {Object} details - Order details (itemTemplateId, side, price, quantity, etc.)
 * @param {Object} req - Express request object (optional)
 */
export async function logOrderPlacement(userId, characterId, orderId, details, req = null) {
  await query(
    `INSERT INTO marketplace_audit
     (event_type, user_id, character_id, order_id, item_template_id, event_data, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      'order_placed',
      userId,
      characterId,
      orderId,
      details.itemTemplateId,
      JSON.stringify(details),
      req?.ip || null,
      req?.get?.('user-agent') || null
    ]
  );
}

/**
 * Log order cancellation
 * @param {number} userId - User cancelling the order
 * @param {number} orderId - The cancelled order ID
 * @param {Object} details - Cancellation details
 * @param {Object} req - Express request object (optional)
 */
export async function logOrderCancellation(userId, orderId, details, req = null) {
  await query(
    `INSERT INTO marketplace_audit
     (event_type, user_id, order_id, item_template_id, event_data, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      'order_cancelled',
      userId,
      orderId,
      details.itemTemplateId,
      JSON.stringify(details),
      req?.ip || null,
      req?.get?.('user-agent') || null
    ]
  );
}

/**
 * Log trade execution between buyer and seller
 * @param {number} buyerId - Buyer user ID
 * @param {number} sellerId - Seller user ID
 * @param {Object} tradeDetails - Trade details including orderIds, price, quantity
 * @param {Object} req - Express request object (optional)
 */
export async function logTradeExecution(buyerId, sellerId, tradeDetails, req = null) {
  // Log for buyer
  await query(
    `INSERT INTO marketplace_audit
     (event_type, user_id, order_id, item_template_id, event_data, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      'trade_executed',
      buyerId,
      tradeDetails.buyOrderId,
      tradeDetails.itemTemplateId,
      JSON.stringify({ ...tradeDetails, role: 'buyer' }),
      req?.ip || null,
      req?.get?.('user-agent') || null
    ]
  );

  // Log for seller (no request context as they may not be the initiator)
  await query(
    `INSERT INTO marketplace_audit
     (event_type, user_id, order_id, item_template_id, event_data, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      'trade_executed',
      sellerId,
      tradeDetails.sellOrderId,
      tradeDetails.itemTemplateId,
      JSON.stringify({ ...tradeDetails, role: 'seller' }),
      null,
      null
    ]
  );
}

/**
 * Log market buy execution
 * @param {number} userId - User executing the market buy
 * @param {number} characterId - Character associated with the purchase
 * @param {Object} details - Market buy details
 * @param {Object} req - Express request object (optional)
 */
export async function logMarketBuy(userId, characterId, details, req = null) {
  await query(
    `INSERT INTO marketplace_audit
     (event_type, user_id, character_id, item_template_id, event_data, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      'market_buy',
      userId,
      characterId,
      details.itemTemplateId,
      JSON.stringify(details),
      req?.ip || null,
      req?.get?.('user-agent') || null
    ]
  );
}

/**
 * Log market sell execution
 * @param {number} userId - User executing the market sell
 * @param {number} characterId - Character associated with the sale
 * @param {Object} details - Market sell details
 * @param {Object} req - Express request object (optional)
 */
export async function logMarketSell(userId, characterId, details, req = null) {
  await query(
    `INSERT INTO marketplace_audit
     (event_type, user_id, character_id, item_template_id, event_data, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      'market_sell',
      userId,
      characterId,
      details.itemTemplateId,
      JSON.stringify(details),
      req?.ip || null,
      req?.get?.('user-agent') || null
    ]
  );
}

/**
 * Log validation failure
 * @param {number} userId - User who failed validation
 * @param {string} attemptedAction - The action that was attempted
 * @param {string[]} errors - Array of validation error messages
 * @param {Object} req - Express request object (optional)
 */
export async function logValidationFailure(userId, attemptedAction, errors, req = null) {
  await query(
    `INSERT INTO marketplace_audit
     (event_type, user_id, event_data, success, error_message, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      'validation_failed',
      userId,
      JSON.stringify({ action: attemptedAction, errors }),
      false,
      errors.join('; '),
      req?.ip || null,
      req?.get?.('user-agent') || null
    ]
  );
}

/**
 * Log access denied (e.g., not at castle)
 * @param {number} userId - User who was denied access
 * @param {string} reason - Reason for denial
 * @param {Object} req - Express request object (optional)
 */
export async function logAccessDenied(userId, reason, req = null) {
  await query(
    `INSERT INTO marketplace_audit
     (event_type, user_id, event_data, success, error_message, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      'access_denied',
      userId,
      JSON.stringify({ reason }),
      false,
      reason,
      req?.ip || null,
      req?.get?.('user-agent') || null
    ]
  );
}

/**
 * Log rate limit exceeded
 * @param {number} userId - User who hit the rate limit
 * @param {string} endpoint - The endpoint that was rate limited
 * @param {Object} req - Express request object (optional)
 */
export async function logRateLimitExceeded(userId, endpoint, req = null) {
  await query(
    `INSERT INTO marketplace_audit
     (event_type, user_id, event_data, success, error_message, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      'rate_limit_exceeded',
      userId,
      JSON.stringify({ endpoint }),
      false,
      `Rate limit exceeded for ${endpoint}`,
      req?.ip || null,
      req?.get?.('user-agent') || null
    ]
  );
}

/**
 * Query audit log (for admin use)
 * @param {Object} filters - Query filters
 * @param {number} filters.userId - Filter by user ID
 * @param {string} filters.eventType - Filter by event type
 * @param {number} filters.orderId - Filter by order ID
 * @param {Date} filters.startDate - Filter by start date
 * @param {Date} filters.endDate - Filter by end date
 * @param {number} filters.limit - Maximum results (default 100)
 * @param {number} filters.offset - Results offset (default 0)
 * @returns {Promise<Array>} Matching audit log entries
 */
export async function queryAuditLog(filters = {}) {
  let whereClause = 'WHERE 1=1';
  const params = [];
  let paramIndex = 1;

  if (filters.userId) {
    whereClause += ` AND user_id = $${paramIndex++}`;
    params.push(filters.userId);
  }
  if (filters.eventType) {
    whereClause += ` AND event_type = $${paramIndex++}`;
    params.push(filters.eventType);
  }
  if (filters.orderId) {
    whereClause += ` AND order_id = $${paramIndex++}`;
    params.push(filters.orderId);
  }
  if (filters.startDate) {
    whereClause += ` AND created_at >= $${paramIndex++}`;
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    whereClause += ` AND created_at <= $${paramIndex++}`;
    params.push(filters.endDate);
  }
  if (filters.success !== undefined) {
    whereClause += ` AND success = $${paramIndex++}`;
    params.push(filters.success);
  }
  if (filters.itemTemplateId) {
    whereClause += ` AND item_template_id = $${paramIndex++}`;
    params.push(filters.itemTemplateId);
  }

  const limit = filters.limit || 100;
  const offset = filters.offset || 0;

  const result = await query(
    `SELECT * FROM marketplace_audit ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, limit, offset]
  );

  return result.rows;
}

/**
 * Get audit statistics for a time period
 * @param {Date} startDate - Start of period
 * @param {Date} endDate - End of period
 * @returns {Promise<Object>} Statistics object
 */
export async function getAuditStats(startDate, endDate) {
  const result = await query(
    `SELECT
       event_type,
       COUNT(*) as count,
       COUNT(*) FILTER (WHERE success = true) as success_count,
       COUNT(*) FILTER (WHERE success = false) as failure_count
     FROM marketplace_audit
     WHERE created_at >= $1 AND created_at <= $2
     GROUP BY event_type
     ORDER BY count DESC`,
    [startDate, endDate]
  );

  return result.rows.reduce((acc, row) => {
    acc[row.event_type] = {
      total: parseInt(row.count, 10),
      success: parseInt(row.success_count, 10),
      failure: parseInt(row.failure_count, 10)
    };
    return acc;
  }, {});
}

/**
 * Get recent suspicious activity
 * @param {number} thresholdMinutes - Time window to check (default 60)
 * @param {number} thresholdCount - Number of failures to consider suspicious (default 10)
 * @returns {Promise<Array>} Users with suspicious activity
 */
export async function getSuspiciousActivity(thresholdMinutes = 60, thresholdCount = 10) {
  const result = await query(
    `SELECT
       user_id,
       COUNT(*) as failure_count,
       array_agg(DISTINCT event_type) as event_types,
       array_agg(DISTINCT ip_address) as ip_addresses,
       MIN(created_at) as first_failure,
       MAX(created_at) as last_failure
     FROM marketplace_audit
     WHERE success = false
       AND created_at > NOW() - INTERVAL '${thresholdMinutes} minutes'
     GROUP BY user_id
     HAVING COUNT(*) >= $1
     ORDER BY failure_count DESC`,
    [thresholdCount]
  );

  return result.rows;
}
