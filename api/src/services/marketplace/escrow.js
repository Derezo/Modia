/**
 * @module marketplace/escrow
 * @description Gold reservation and item escrow management.
 *
 * Key responsibilities:
 * - Reserve gold for buy orders
 * - Escrow items for sell orders
 * - Release reservations on order cancel
 * - Add items to user's shared inventory pool
 *
 * @see orderManagement.js - Uses escrow functions for order placement
 */

import { AppError } from '../../middleware/errorHandler.js';
import { MAX_GOLD } from '../../config/constants.js';

/**
 * Reserve gold for a buy order
 * @param {Object} client - Database client
 * @param {number} userId - User placing the order
 * @param {number} orderId - Order ID to associate reservation with
 * @param {number} amount - Amount of gold to reserve
 * @returns {Promise<number>} Amount reserved
 */
export async function reserveGold(client, userId, orderId, amount) {
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
 * @param {Object} client - Database client
 * @param {number} orderId - Order ID to release reservation for
 * @param {number|null} amount - Amount to release (null = full release)
 * @returns {Promise<number>} Amount released
 */
export async function releaseGold(client, orderId, amount = null) {
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
 * @param {Object} client - Database client
 * @param {number} orderId - Order ID to associate escrow with
 * @param {number} userId - User placing the order
 * @param {number} characterId - Character ID for historical context
 * @param {number} itemTemplateId - Item template being escrowed
 * @param {number} quantity - Quantity to escrow
 * @returns {Promise<number>} Quantity escrowed
 */
export async function escrowItems(client, orderId, userId, characterId, itemTemplateId, quantity) {
  // Check user has enough items in shared pool (not equipped, not listed, no character assigned)
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
 * @param {Object} client - Database client
 * @param {number} orderId - Order ID to release escrow for
 * @param {number|null} userId - User ID (optional, will be looked up from order)
 * @returns {Promise<number>} Quantity released
 */
export async function releaseEscrowedItems(client, orderId, userId = null) {
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
 * Deletes the row if quantity reaches 0 to avoid CHECK constraint violation.
 * @param {Object} client - Database client
 * @param {number} orderId - Order ID to reduce escrow for
 * @param {number} quantityFilled - Quantity that was filled
 * @returns {Promise<boolean>} True if escrow was fully consumed (deleted)
 */
export async function reduceEscrow(client, orderId, quantityFilled) {
  // First try to delete if the fill would reduce to 0
  const deleteResult = await client.query(
    'DELETE FROM item_escrow WHERE order_id = $1 AND quantity <= $2 RETURNING order_id',
    [orderId, quantityFilled]
  );

  if (deleteResult.rowCount > 0) {
    return true; // Escrow fully consumed
  }

  // Otherwise, decrement
  await client.query(
    'UPDATE item_escrow SET quantity = quantity - $1 WHERE order_id = $2',
    [quantityFilled, orderId]
  );
  return false;
}

/**
 * Consume gold reservation (after trade fill)
 * Deletes the row if amount would reach 0 to avoid CHECK constraint violation.
 * @param {Object} client - Database client
 * @param {number} orderId - Order ID to consume reservation for
 * @param {number} amount - Amount of gold consumed by trade
 * @returns {Promise<boolean>} True if reservation was fully consumed (deleted)
 */
export async function consumeReservation(client, orderId, amount) {
  // First try to delete if the amount would reduce to 0
  const deleteResult = await client.query(
    'DELETE FROM gold_reservations WHERE order_id = $1 AND amount <= $2 RETURNING order_id',
    [orderId, amount]
  );

  if (deleteResult.rowCount > 0) {
    return true; // Reservation fully consumed
  }

  // Otherwise, decrement
  await client.query(
    'UPDATE gold_reservations SET amount = amount - $1 WHERE order_id = $2',
    [amount, orderId]
  );
  return false;
}

/**
 * Add items to a user's shared inventory (stacking consumables/materials)
 * @param {Object} client - Database client
 * @param {number} userId - User to add items to
 * @param {number} itemTemplateId - Item template to add
 * @param {number} quantity - Quantity to add
 */
export async function addItemToUser(client, userId, itemTemplateId, quantity) {
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
    // (never into a rolled drop row: its rarity/augments belong to that unit only)
    const existingResult = await client.query(
      `SELECT id, quantity FROM character_items
       WHERE user_id = $1 AND item_template_id = $2 AND equipped_slot IS NULL
         AND (modifications IS NULL OR NOT (modifications ? 'rarity'))
       ORDER BY id
       LIMIT 1`,
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
