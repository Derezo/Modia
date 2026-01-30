/**
 * CaravanService - Generates and manages caravan inventory
 *
 * The merchant caravan system provides traveling shops that visit
 * different regions, offering exclusive items not found in regular shops.
 *
 * Features:
 * - Seeded random inventory generation (deterministic per caravan)
 * - 48-hour refresh cycle
 * - Regional specialty items based on caravan location
 * - Stock tracking per caravan with purchase recording
 *
 * @module caravanService
 */

import { SeededRandom } from '../config/constants.js';
import { query, withTransaction } from '../config/database.js';
import {
  CARAVAN_PRICE_MODIFIER,
  CARAVAN_REFRESH_INTERVAL,
  getStockLimits,
  getItemsForRegion,
  getRegionalItems
} from '../db/templates/caravanItems.js';

/**
 * Generate caravan inventory using seeded randomness
 *
 * @param {number} seed - Random seed for deterministic generation
 * @param {string} regionRace - The race of the region where caravan is located
 * @returns {Array<Object>} Generated inventory items with stock and pricing
 */
export function generateCaravanInventory(seed, regionRace) {
  const rng = new SeededRandom(seed);
  const inventory = [];

  // Get items available in this region
  const availableItems = getItemsForRegion(regionRace);

  // Shuffle items for variety (deterministic based on seed)
  const shuffledItems = rng.shuffle(availableItems);

  // Select a subset of items to stock (70-90% of available items)
  const itemCount = Math.floor(shuffledItems.length * (0.7 + rng.next() * 0.2));
  const selectedItems = shuffledItems.slice(0, itemCount);

  // Ensure at least one regional item is always included if available
  const regionalItems = getRegionalItems(regionRace);
  if (regionalItems.length > 0) {
    const guaranteedRegional = rng.pick(regionalItems);
    if (!selectedItems.find(item => item.id === guaranteedRegional.id)) {
      selectedItems.push(guaranteedRegional);
    }
  }

  // Generate stock for each selected item
  for (const item of selectedItems) {
    const stockLimits = getStockLimits(item.id, item.type);
    const quantity = rng.nextInt(stockLimits.min, stockLimits.max);

    // Apply caravan pricing premium
    const price = Math.floor(item.basePrice * CARAVAN_PRICE_MODIFIER);

    inventory.push({
      itemId: item.id,
      name: item.name,
      type: item.type,
      description: item.description,
      effect: item.effect || null,
      equipSlot: item.equipSlot || null,
      statBonuses: item.statBonuses || null,
      region: item.region || null,
      quantity,
      maxQuantity: quantity, // Track original stock for display
      price,
      basePrice: item.basePrice,
      sprite_id: item.sprite_id || null
    });
  }

  // Sort: regional items first, then by type, then by name
  inventory.sort((a, b) => {
    // Regional items first
    if (a.region && !b.region) return -1;
    if (!a.region && b.region) return 1;

    // Then by type
    const typeOrder = ['consumable', 'weapon', 'armor', 'accessory', 'material'];
    const typeA = typeOrder.indexOf(a.type);
    const typeB = typeOrder.indexOf(b.type);
    if (typeA !== typeB) return typeA - typeB;

    // Then by name
    return a.name.localeCompare(b.name);
  });

  return inventory;
}

/**
 * Get caravan data for a specific node
 *
 * @param {number} nodeId - World node ID of the caravan
 * @returns {Promise<Object|null>} Caravan data or null if not a caravan node
 */
export async function getCaravanData(nodeId) {
  const nodeResult = await query(
    `SELECT
       id, name, node_type, local_seed, region_id,
       caravan_inventory_seed, caravan_last_refresh
     FROM world_nodes
     WHERE id = $1 AND node_type = 'merchant_caravan'`,
    [nodeId]
  );

  if (nodeResult.rows.length === 0) {
    return null;
  }

  const node = nodeResult.rows[0];

  // Get region race for regional items
  let regionRace = 'human'; // Default fallback
  if (node.region_id) {
    const regionResult = await query(
      'SELECT race FROM world_regions WHERE id = $1',
      [node.region_id]
    );
    if (regionResult.rows.length > 0) {
      regionRace = regionResult.rows[0].race;
    }
  } else if (node.region_race) {
    // Use region_race column if region_id not set
    regionRace = node.region_race;
  }

  // Determine if refresh is needed
  const now = new Date();
  const lastRefresh = node.caravan_last_refresh
    ? new Date(node.caravan_last_refresh)
    : null;
  const needsRefresh = !lastRefresh ||
    (now.getTime() - lastRefresh.getTime()) >= CARAVAN_REFRESH_INTERVAL;

  // Use existing seed or generate based on node seed + time window
  let inventorySeed = node.caravan_inventory_seed;
  if (needsRefresh || !inventorySeed) {
    // Generate new seed based on node local_seed and current 48-hour window
    const timeWindow = Math.floor(now.getTime() / CARAVAN_REFRESH_INTERVAL);
    inventorySeed = (node.local_seed * 31337) ^ timeWindow;
  }

  // Generate inventory
  const inventory = generateCaravanInventory(inventorySeed, regionRace);

  // Calculate time until next refresh
  const nextRefresh = lastRefresh
    ? new Date(lastRefresh.getTime() + CARAVAN_REFRESH_INTERVAL)
    : new Date(now.getTime() + CARAVAN_REFRESH_INTERVAL);
  const msUntilRefresh = Math.max(0, nextRefresh.getTime() - now.getTime());
  const hoursUntilRefresh = Math.ceil(msUntilRefresh / (60 * 60 * 1000));

  return {
    nodeId: node.id,
    nodeName: node.name,
    regionRace,
    inventory,
    inventorySeed,
    lastRefresh,
    nextRefresh,
    hoursUntilRefresh,
    needsRefresh
  };
}

/**
 * Refresh caravan inventory and update database
 *
 * @param {number} nodeId - World node ID of the caravan
 * @returns {Promise<Object>} New caravan data
 */
export async function refreshCaravanInventory(nodeId) {
  // Generate new seed
  const now = new Date();
  const timeWindow = Math.floor(now.getTime() / CARAVAN_REFRESH_INTERVAL);

  // Get node to use its local_seed
  const nodeResult = await query(
    'SELECT local_seed FROM world_nodes WHERE id = $1',
    [nodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new Error(`Caravan node ${nodeId} not found`);
  }

  const newSeed = (nodeResult.rows[0].local_seed * 31337) ^ timeWindow;

  // Update database
  await query(
    `UPDATE world_nodes
     SET caravan_inventory_seed = $1, caravan_last_refresh = $2
     WHERE id = $3`,
    [newSeed, now, nodeId]
  );

  // Return fresh caravan data
  return getCaravanData(nodeId);
}

/**
 * Get current stock for a specific item at a caravan
 * Stock is tracked via user_caravan_transactions table
 *
 * @param {number} nodeId - Caravan node ID
 * @param {string} itemId - Item ID to check
 * @param {number} maxQuantity - Maximum stock from generation
 * @param {Date} lastRefresh - Last inventory refresh time
 * @returns {Promise<number>} Current available stock
 */
export async function getItemStock(nodeId, itemId, maxQuantity, lastRefresh) {
  if (!lastRefresh) {
    return maxQuantity;
  }

  // Sum all purchases of this item since last refresh
  const result = await query(
    `SELECT COALESCE(SUM(
       CASE WHEN item_bought = $1 THEN 1 ELSE 0 END
     ), 0) as purchased
     FROM user_caravan_transactions
     WHERE node_id = $2
       AND transaction_at >= $3
       AND item_bought = $1`,
    [itemId, nodeId, lastRefresh]
  );

  const purchased = parseInt(result.rows[0].purchased, 10);
  return Math.max(0, maxQuantity - purchased);
}

/**
 * Record a caravan purchase transaction
 *
 * @param {number} userId - User making the purchase
 * @param {number} nodeId - Caravan node ID
 * @param {string} itemId - Item ID purchased
 * @param {number} quantity - Quantity purchased
 * @param {number} totalPrice - Total gold spent
 * @returns {Promise<Object>} Transaction record
 */
export async function recordPurchase(userId, nodeId, itemId, quantity, totalPrice) {
  return withTransaction(async (client) => {
    // Insert transaction record(s) - one per quantity for accurate stock tracking
    const transactions = [];
    for (let i = 0; i < quantity; i++) {
      const result = await client.query(
        `INSERT INTO user_caravan_transactions
         (user_id, node_id, item_bought, gold_spent, transaction_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id, transaction_at`,
        [userId, nodeId, itemId, Math.floor(totalPrice / quantity)]
      );
      transactions.push(result.rows[0]);
    }

    return {
      userId,
      nodeId,
      itemId,
      quantity,
      totalPrice,
      transactions
    };
  });
}

/**
 * Process a caravan purchase
 * Validates stock, deducts gold, records transaction, adds item to inventory
 *
 * @param {number} userId - User making the purchase
 * @param {number} nodeId - Caravan node ID
 * @param {string} itemId - Item ID to purchase
 * @param {number} quantity - Quantity to purchase (default 1)
 * @returns {Promise<Object>} Purchase result
 */
export async function processPurchase(userId, nodeId, itemId, quantity = 1) {
  return withTransaction(async (client) => {
    // Acquire advisory lock on this caravan+item combination to prevent race conditions
    // This ensures only one purchase of a specific item at a specific caravan can proceed at a time
    // Advisory lock key: combine nodeId and itemId hash
    const lockKey = nodeId * 100000 + Math.abs(itemId.split('').reduce((a, b) => a + b.charCodeAt(0), 0) % 100000);
    await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

    // Get caravan data
    const caravanData = await getCaravanData(nodeId);
    if (!caravanData) {
      throw new Error('Caravan not found at this location');
    }

    // Find item in inventory
    const inventoryItem = caravanData.inventory.find(item => item.itemId === itemId);
    if (!inventoryItem) {
      throw new Error('Item not available at this caravan');
    }

    // Check current stock (now safe due to advisory lock)
    const currentStock = await getItemStock(
      nodeId,
      itemId,
      inventoryItem.maxQuantity,
      caravanData.lastRefresh
    );

    if (currentStock < quantity) {
      throw new Error(`Insufficient stock. Only ${currentStock} available.`);
    }

    // Calculate total price
    const totalPrice = inventoryItem.price * quantity;

    // Check user gold
    const userResult = await client.query(
      'SELECT gold FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const userGold = userResult.rows[0].gold;
    if (userGold < totalPrice) {
      throw new Error(`Insufficient gold. Need ${totalPrice}, have ${userGold}.`);
    }

    // Deduct gold
    await client.query(
      'UPDATE users SET gold = gold - $1 WHERE id = $2',
      [totalPrice, userId]
    );

    // Record transaction(s)
    for (let i = 0; i < quantity; i++) {
      await client.query(
        `INSERT INTO user_caravan_transactions
         (user_id, node_id, item_bought, gold_spent, transaction_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [userId, nodeId, itemId, inventoryItem.price]
      );
    }

    // Add item to user's inventory
    // Check if user already has this item (for stackable items like consumables/materials)
    // Only stack if item is not equipment (no equipSlot)
    const isStackable = !inventoryItem.equipSlot;
    let existingItem = { rows: [] };

    if (isStackable) {
      existingItem = await client.query(
        `SELECT id, quantity FROM character_items
         WHERE user_id = $1
           AND item_template_id IS NULL
           AND character_id IS NULL
           AND equipped_slot IS NULL
           AND modifications->>'caravan_item_id' = $2`,
        [userId, itemId]
      );
    }

    if (existingItem.rows.length > 0) {
      // Update quantity
      await client.query(
        `UPDATE character_items
         SET quantity = quantity + $1
         WHERE id = $2`,
        [quantity, existingItem.rows[0].id]
      );
    } else {
      // Insert new item
      const modifications = {
        caravan_item_id: itemId,
        caravan_item_name: inventoryItem.name,
        caravan_item_type: inventoryItem.type,
        effect: inventoryItem.effect,
        equipSlot: inventoryItem.equipSlot,
        statBonuses: inventoryItem.statBonuses
      };

      await client.query(
        `INSERT INTO character_items
         (user_id, item_template_id, quantity, modifications)
         VALUES ($1, NULL, $2, $3)`,
        [userId, quantity, JSON.stringify(modifications)]
      );
    }

    // Get updated gold balance
    const updatedUser = await client.query(
      'SELECT gold FROM users WHERE id = $1',
      [userId]
    );

    return {
      success: true,
      itemId,
      itemName: inventoryItem.name,
      quantity,
      totalPrice,
      remainingGold: updatedUser.rows[0].gold,
      remainingStock: currentStock - quantity
    };
  });
}

/**
 * Get purchase history for a user at a specific caravan
 *
 * @param {number} userId - User ID
 * @param {number} nodeId - Caravan node ID
 * @param {number} limit - Maximum records to return
 * @returns {Promise<Array>} Purchase history
 */
export async function getPurchaseHistory(userId, nodeId, limit = 20) {
  const result = await query(
    `SELECT item_bought, gold_spent, transaction_at
     FROM user_caravan_transactions
     WHERE user_id = $1 AND node_id = $2
     ORDER BY transaction_at DESC
     LIMIT $3`,
    [userId, nodeId, limit]
  );

  return result.rows.map(row => ({
    itemId: row.item_bought,
    goldSpent: row.gold_spent,
    purchasedAt: row.transaction_at
  }));
}

/**
 * Check if caravan inventory needs refresh and refresh if needed
 *
 * @param {number} nodeId - Caravan node ID
 * @returns {Promise<boolean>} Whether refresh was performed
 */
export async function checkAndRefreshIfNeeded(nodeId) {
  const caravanData = await getCaravanData(nodeId);

  if (!caravanData) {
    return false;
  }

  if (caravanData.needsRefresh) {
    await refreshCaravanInventory(nodeId);
    return true;
  }

  return false;
}

/**
 * Get caravan inventory with real-time stock levels
 *
 * @param {number} nodeId - Caravan node ID
 * @returns {Promise<Object>} Caravan inventory with current stock
 */
export async function getCaravanInventoryWithStock(nodeId) {
  const caravanData = await getCaravanData(nodeId);

  if (!caravanData) {
    return null;
  }

  // Update each item with current stock
  const inventoryWithStock = await Promise.all(
    caravanData.inventory.map(async (item) => {
      const currentStock = await getItemStock(
        nodeId,
        item.itemId,
        item.maxQuantity,
        caravanData.lastRefresh
      );

      return {
        ...item,
        quantity: currentStock,
        inStock: currentStock > 0
      };
    })
  );

  return {
    ...caravanData,
    inventory: inventoryWithStock
  };
}

export default {
  generateCaravanInventory,
  getCaravanData,
  refreshCaravanInventory,
  getItemStock,
  recordPurchase,
  processPurchase,
  getPurchaseHistory,
  checkAndRefreshIfNeeded,
  getCaravanInventoryWithStock,
  CARAVAN_PRICE_MODIFIER,
  CARAVAN_REFRESH_INTERVAL
};
