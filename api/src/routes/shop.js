import express from 'express';
import { query, withTransaction } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';
import { MAX_GOLD } from '../config/constants.js';
import { shopBuyLimiter, shopSellLimiter } from '../middleware/economyRateLimiter.js';
import {
  getCaravanInventoryWithStock,
  processPurchase as processCaravanPurchase
} from '../services/caravanService.js';
import { CARAVAN_REFRESH_INTERVAL } from '../db/templates/caravanItems.js';

const router = express.Router();

// Valid shop types and which node types/features support them
const SHOP_CONFIG = {
  blacksmith: {
    nodeTypes: ['castle', 'city'],
    features: ['blacksmith'],
    itemTypes: ['weapon', 'armor']
  },
  apothecary: {
    nodeTypes: ['castle', 'city', 'village'],
    features: ['apothecary'],
    itemTypes: ['consumable']
  },
  farm: {
    nodeTypes: ['village'],
    features: ['farm'],
    itemTypes: ['material', 'consumable']
  },
  caravan: {
    nodeTypes: ['merchant_caravan'],
    features: [],
    itemTypes: ['consumable', 'material', 'weapon', 'armor', 'accessory']
  }
};

// Price modifiers based on supply level
// Scarce (0-2): 120%, Low (3-5): 100%, Medium (6-10): 85%, High (11-20): 70%, Surplus (21+): 60%
const SUPPLY_LEVELS = {
  scarce: { min: 0, max: 2, modifier: 1.20, label: 'Scarce' },
  low: { min: 3, max: 5, modifier: 1.00, label: 'Low' },
  medium: { min: 6, max: 10, modifier: 0.85, label: 'Medium' },
  high: { min: 11, max: 20, modifier: 0.70, label: 'High' },
  surplus: { min: 21, max: Infinity, modifier: 0.60, label: 'Surplus' }
};

// Sell price is always 50% of base value
const SELL_MODIFIER = 0.50;

/**
 * Get supply level info for a given quantity
 */
function getSupplyLevel(quantity) {
  for (const [key, level] of Object.entries(SUPPLY_LEVELS)) {
    if (quantity >= level.min && quantity <= level.max) {
      return { level: key, ...level };
    }
  }
  return { level: 'surplus', ...SUPPLY_LEVELS.surplus };
}

/**
 * Calculate buy price based on supply
 */
function calculateBuyPrice(basePrice, quantity) {
  const supply = getSupplyLevel(quantity);
  return Math.ceil(basePrice * supply.modifier);
}

/**
 * Calculate sell price (always 50% of base)
 */
function calculateSellPrice(basePrice) {
  return Math.floor(basePrice * SELL_MODIFIER);
}

/**
 * Verify node has the specified shop type
 */
async function verifyShopAccess(nodeId, shopType) {
  const nodeResult = await query(
    'SELECT id, node_type, features, name FROM world_nodes WHERE id = $1',
    [nodeId]
  );

  if (nodeResult.rows.length === 0) {
    throw new AppError('Node not found', 404);
  }

  const node = nodeResult.rows[0];
  const config = SHOP_CONFIG[shopType];

  if (!config) {
    throw new AppError('Invalid shop type', 400);
  }

  // Check if node type supports this shop
  const nodeTypeSupported = config.nodeTypes.includes(node.node_type);

  // Check if node has the shop feature
  const features = node.features || [];
  const hasFeature = config.features.some(f => features.includes(f));

  if (!nodeTypeSupported && !hasFeature) {
    throw new AppError(`This location does not have a ${shopType}`, 400);
  }

  return node;
}

/**
 * Verify character is at the specified node
 */
async function verifyCharacterAtNode(userId, nodeId) {
  const charResult = await query(
    `SELECT c.id, c.name, c.current_node_id, c.in_battle
     FROM characters c
     WHERE c.user_id = $1 AND c.party_slot IS NOT NULL
     ORDER BY c.party_slot
     LIMIT 1`,
    [userId]
  );

  if (charResult.rows.length === 0) {
    throw new AppError('No active character in party', 400);
  }

  const character = charResult.rows[0];

  if (character.current_node_id !== nodeId) {
    throw new AppError('You must be at this location to use the shop', 400);
  }

  if (character.in_battle) {
    throw new AppError('Cannot use shop during battle', 400);
  }

  return character;
}

// ============================================
// GET /api/shops/:nodeId/:shopType - Get shop inventory
// ============================================
router.get('/:nodeId/:shopType', authenticate, asyncHandler(async (req, res) => {
  const { nodeId, shopType } = req.params;
  const nodeIdNum = parseInt(nodeId, 10);

  if (isNaN(nodeIdNum)) {
    throw new AppError('Invalid node ID', 400);
  }

  // Verify shop exists at this node
  const node = await verifyShopAccess(nodeIdNum, shopType);

  // Handle caravan shops separately - they use caravanService
  if (shopType === 'caravan') {
    // Verify node is type merchant_caravan
    if (node.node_type !== 'merchant_caravan') {
      throw new AppError('This location is not a merchant caravan', 400);
    }

    // Get caravan inventory with real-time stock levels
    const caravanData = await getCaravanInventoryWithStock(nodeIdNum);

    if (!caravanData) {
      throw new AppError('Caravan inventory not available', 404);
    }

    // Format inventory for response
    const inventory = caravanData.inventory.map(item => ({
      itemId: item.itemId,
      name: item.name,
      type: item.type,
      description: item.description,
      basePrice: item.basePrice,
      price: item.price, // Already includes 15% premium
      stock: item.quantity,
      maxStock: item.maxQuantity,
      regional: !!item.region,
      caravanExclusive: true,
      effect: item.effect || null,
      equipSlot: item.equipSlot || null,
      statBonuses: item.statBonuses || null,
      inStock: item.inStock,
      spriteId: item.spriteId || item.sprite_id || null
    }));

    // Calculate time until next refresh in milliseconds
    const now = new Date();
    const refreshesIn = caravanData.nextRefresh
      ? Math.max(0, caravanData.nextRefresh.getTime() - now.getTime())
      : CARAVAN_REFRESH_INTERVAL;

    return res.json({
      isCaravan: true,
      shopType: 'caravan',
      inventory,
      refreshesIn,
      lastRefresh: caravanData.lastRefresh,
      nodeId: nodeIdNum,
      nodeName: caravanData.nodeName
    });
  }

  // Standard shop handling (blacksmith, apothecary, farm)
  // Get shop inventory with item details
  const inventoryResult = await query(
    `SELECT
       nsi.id as inventory_id,
       nsi.quantity,
       nsi.last_restock,
       it.id as template_id,
       it.name,
       it.description,
       it.item_type,
       it.equipment_slot,
       it.stat_bonuses,
       it.level_requirement,
       it.base_price,
       it.rarity,
       it.sprite_id
     FROM npc_shop_inventory nsi
     JOIN item_templates it ON nsi.item_template_id = it.id
     WHERE nsi.node_id = $1 AND nsi.shop_type = $2
     ORDER BY it.level_requirement, it.item_type, it.name`,
    [nodeIdNum, shopType]
  );

  // Format inventory with dynamic pricing
  const items = inventoryResult.rows.map(item => {
    const supply = getSupplyLevel(item.quantity);
    const buyPrice = calculateBuyPrice(item.base_price, item.quantity);

    return {
      inventoryId: item.inventory_id,
      templateId: item.template_id,
      name: item.name,
      description: item.description,
      type: item.item_type,
      equipmentSlot: item.equipment_slot,
      statBonuses: item.stat_bonuses,
      levelRequirement: item.level_requirement,
      rarity: item.rarity,
      basePrice: item.base_price,
      buyPrice: buyPrice,
      quantity: item.quantity,
      supplyLevel: supply.level,
      supplyLabel: supply.label,
      priceModifier: supply.modifier,
      spriteId: item.sprite_id
    };
  });

  res.json({
    nodeId: nodeIdNum,
    shopType,
    items
  });
}));

// ============================================
// POST /api/shops/:nodeId/:shopType/buy - Purchase item
// ============================================
router.post('/:nodeId/:shopType/buy', authenticate, shopBuyLimiter, asyncHandler(async (req, res) => {
  const { nodeId, shopType } = req.params;
  const { itemTemplateId, characterId, itemId } = req.body;
  const nodeIdNum = parseInt(nodeId, 10);

  // SECURITY: Strict quantity validation to prevent negative quantity exploits
  const quantity = parseInt(req.body.quantity, 10);
  if (!Number.isInteger(quantity) || isNaN(quantity)) {
    throw new AppError('Quantity must be a valid integer', 400);
  }

  // Validate inputs
  if (isNaN(nodeIdNum)) {
    throw new AppError('Invalid node ID', 400);
  }
  if (quantity < 1 || quantity > 99) {
    throw new AppError('Invalid quantity (1-99)', 400);
  }

  // Verify shop access
  const node = await verifyShopAccess(nodeIdNum, shopType);

  // Verify character location
  const activeChar = await verifyCharacterAtNode(req.user.userId, nodeIdNum);

  // Handle caravan purchases separately
  if (shopType === 'caravan') {
    // Caravan uses itemId (string) instead of itemTemplateId (number)
    const caravanItemId = itemId || itemTemplateId;
    if (!caravanItemId) {
      throw new AppError('Item ID required', 400);
    }

    // Verify node is type merchant_caravan
    if (node.node_type !== 'merchant_caravan') {
      throw new AppError('This location is not a merchant caravan', 400);
    }

    try {
      const result = await processCaravanPurchase(
        req.user.userId,
        nodeIdNum,
        caravanItemId,
        quantity
      );

      return res.json({
        success: true,
        message: `Purchased ${result.quantity}x ${result.itemName} for ${result.totalPrice} gold`,
        itemId: result.itemId,
        itemName: result.itemName,
        quantity: result.quantity,
        totalPrice: result.totalPrice,
        remainingGold: result.remainingGold,
        remainingStock: result.remainingStock
      });
    } catch (error) {
      // Convert service errors to AppErrors
      if (error.message.includes('Insufficient')) {
        throw new AppError(error.message, 400);
      }
      if (error.message.includes('not found') || error.message.includes('not available')) {
        throw new AppError(error.message, 404);
      }
      throw new AppError(error.message, 400);
    }
  }

  // Standard shop handling (blacksmith, apothecary, farm)
  if (!itemTemplateId) {
    throw new AppError('Item template ID required', 400);
  }

  const targetCharId = characterId || activeChar.id;

  // Verify target character belongs to user
  const targetCharResult = await query(
    'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
    [targetCharId, req.user.userId]
  );
  if (targetCharResult.rows.length === 0) {
    throw new AppError('Target character not found', 404);
  }

  const result = await withTransaction(async (client) => {
    // Get shop inventory item with lock
    const invResult = await client.query(
      `SELECT nsi.id, nsi.quantity, it.base_price, it.name, it.item_type
       FROM npc_shop_inventory nsi
       JOIN item_templates it ON nsi.item_template_id = it.id
       WHERE nsi.node_id = $1 AND nsi.shop_type = $2 AND nsi.item_template_id = $3
       FOR UPDATE`,
      [nodeIdNum, shopType, itemTemplateId]
    );

    if (invResult.rows.length === 0) {
      throw new AppError('Item not available at this shop', 404);
    }

    const shopItem = invResult.rows[0];

    if (shopItem.quantity < quantity) {
      throw new AppError(`Only ${shopItem.quantity} available`, 400);
    }

    // Calculate price (based on current stock)
    const unitPrice = calculateBuyPrice(shopItem.base_price, shopItem.quantity);
    const totalPrice = unitPrice * quantity;

    // Check user gold
    const userResult = await client.query(
      'SELECT gold FROM users WHERE id = $1 FOR UPDATE',
      [req.user.userId]
    );

    if (userResult.rows[0].gold < totalPrice) {
      throw new AppError(`Insufficient gold. Need ${totalPrice}, have ${userResult.rows[0].gold}`, 400);
    }

    // Deduct gold
    await client.query(
      'UPDATE users SET gold = gold - $1 WHERE id = $2',
      [totalPrice, req.user.userId]
    );

    // Reduce shop inventory
    await client.query(
      'UPDATE npc_shop_inventory SET quantity = quantity - $1 WHERE id = $2',
      [quantity, shopItem.id]
    );

    // Add item to user's shared inventory (stack if consumable/material)
    if (['consumable', 'material'].includes(shopItem.item_type)) {
      // Try to stack with existing item in shared pool
      const existingResult = await client.query(
        `SELECT id, quantity FROM character_items
         WHERE user_id = $1 AND item_template_id = $2 AND equipped_slot IS NULL`,
        [req.user.userId, itemTemplateId]
      );

      if (existingResult.rows.length > 0) {
        await client.query(
          'UPDATE character_items SET quantity = quantity + $1 WHERE id = $2',
          [quantity, existingResult.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO character_items (user_id, item_template_id, quantity)
           VALUES ($1, $2, $3)`,
          [req.user.userId, itemTemplateId, quantity]
        );
      }
    } else {
      // Equipment items don't stack - create individual entries in shared pool
      for (let i = 0; i < quantity; i++) {
        await client.query(
          `INSERT INTO character_items (user_id, item_template_id, quantity)
           VALUES ($1, $2, 1)`,
          [req.user.userId, itemTemplateId]
        );
      }
    }

    // Log transaction
    await client.query(
      `INSERT INTO shop_transactions
       (user_id, character_id, node_id, shop_type, item_template_id, transaction_type, quantity, price_per_unit, total_price)
       VALUES ($1, $2, $3, $4, $5, 'buy', $6, $7, $8)`,
      [req.user.userId, targetCharId, nodeIdNum, shopType, itemTemplateId, quantity, unitPrice, totalPrice]
    );

    // Get updated user gold
    const updatedUser = await client.query('SELECT gold FROM users WHERE id = $1', [req.user.userId]);

    return {
      itemName: shopItem.name,
      quantity,
      unitPrice,
      totalPrice,
      remainingGold: updatedUser.rows[0].gold
    };
  });

  res.json({
    success: true,
    message: `Purchased ${result.quantity}x ${result.itemName} for ${result.totalPrice} gold`,
    ...result
  });
}));

// ============================================
// POST /api/shops/:nodeId/:shopType/sell - Sell item
// ============================================
router.post('/:nodeId/:shopType/sell', authenticate, shopSellLimiter, asyncHandler(async (req, res) => {
  const { nodeId, shopType } = req.params;
  const { itemInstanceId } = req.body;
  const nodeIdNum = parseInt(nodeId, 10);

  // SECURITY: Strict quantity validation to prevent negative quantity exploits
  const quantity = req.body.quantity !== undefined ? parseInt(req.body.quantity, 10) : 1;
  if (!Number.isInteger(quantity) || isNaN(quantity)) {
    throw new AppError('Quantity must be a valid integer', 400);
  }

  // Validate inputs
  if (isNaN(nodeIdNum)) {
    throw new AppError('Invalid node ID', 400);
  }
  if (!itemInstanceId) {
    throw new AppError('Item instance ID required', 400);
  }
  if (quantity < 1 || quantity > 9999) {
    throw new AppError('Invalid quantity (1-9999)', 400);
  }

  // Verify shop access
  await verifyShopAccess(nodeIdNum, shopType);

  // Verify character location and get active character for transaction logging
  const activeChar = await verifyCharacterAtNode(req.user.userId, nodeIdNum);

  const result = await withTransaction(async (client) => {
    // Get item from shared inventory with lock (shared items have user_id set, character_id NULL)
    const itemResult = await client.query(
      `SELECT ci.id, ci.character_id, ci.user_id, ci.item_template_id, ci.quantity, ci.equipped_slot, ci.listed,
              it.name, it.base_price, it.item_type, it.is_tradeable
       FROM character_items ci
       JOIN item_templates it ON ci.item_template_id = it.id
       WHERE ci.id = $1 AND ci.user_id = $2
       FOR UPDATE OF ci`,
      [itemInstanceId, req.user.userId]
    );

    if (itemResult.rows.length === 0) {
      throw new AppError('Item not found', 404);
    }

    const item = itemResult.rows[0];

    // Check if listed on marketplace
    if (item.listed) {
      throw new AppError('Cannot sell items listed on the marketplace. Cancel the listing first.', 400);
    }

    // Check if equipped
    if (item.equipped_slot) {
      throw new AppError('Cannot sell equipped items. Unequip first.', 400);
    }

    // Check if tradeable (null defaults to tradeable)
    if (item.is_tradeable === false) {
      throw new AppError('This item cannot be sold', 400);
    }

    // SECURITY: Validate quantity doesn't exceed owned amount (already validated as positive integer above)
    if (quantity > item.quantity) {
      throw new AppError(`Insufficient items. You have ${item.quantity}, tried to sell ${quantity}`, 400);
    }
    const sellQuantity = quantity;

    // Calculate sell price (50% of base)
    const unitPrice = calculateSellPrice(item.base_price);
    const totalPrice = unitPrice * sellQuantity;

    // Add gold to user (capped at MAX_GOLD to prevent overflow)
    await client.query(
      'UPDATE users SET gold = LEAST(gold + $1, $2) WHERE id = $3',
      [totalPrice, MAX_GOLD, req.user.userId]
    );

    // Remove or reduce item quantity
    if (sellQuantity >= item.quantity) {
      await client.query('DELETE FROM character_items WHERE id = $1', [itemInstanceId]);
    } else {
      await client.query(
        'UPDATE character_items SET quantity = quantity - $1 WHERE id = $2',
        [sellQuantity, itemInstanceId]
      );
    }

    // Add to shop inventory (if shop sells this item type)
    const config = SHOP_CONFIG[shopType];
    if (config.itemTypes.includes(item.item_type)) {
      // Check if shop already has this item
      const shopInvResult = await client.query(
        `SELECT id FROM npc_shop_inventory
         WHERE node_id = $1 AND shop_type = $2 AND item_template_id = $3`,
        [nodeIdNum, shopType, item.item_template_id]
      );

      if (shopInvResult.rows.length > 0) {
        await client.query(
          'UPDATE npc_shop_inventory SET quantity = quantity + $1 WHERE id = $2',
          [sellQuantity, shopInvResult.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO npc_shop_inventory (node_id, shop_type, item_template_id, quantity, restock_quantity)
           VALUES ($1, $2, $3, $4, $4)`,
          [nodeIdNum, shopType, item.item_template_id, sellQuantity]
        );
      }
    }

    // Log transaction (use activeChar.id since shared inventory items have NULL character_id)
    await client.query(
      `INSERT INTO shop_transactions
       (user_id, character_id, node_id, shop_type, item_template_id, transaction_type, quantity, price_per_unit, total_price)
       VALUES ($1, $2, $3, $4, $5, 'sell', $6, $7, $8)`,
      [req.user.userId, activeChar.id, nodeIdNum, shopType, item.item_template_id, sellQuantity, unitPrice, totalPrice]
    );

    // Get updated user gold
    const updatedUser = await client.query('SELECT gold FROM users WHERE id = $1', [req.user.userId]);

    return {
      itemName: item.name,
      quantity: sellQuantity,
      unitPrice,
      totalPrice,
      newGold: updatedUser.rows[0].gold
    };
  });

  res.json({
    success: true,
    message: `Sold ${result.quantity}x ${result.itemName} for ${result.totalPrice} gold`,
    ...result
  });
}));

// ============================================
// GET /api/shops/:nodeId/:shopType/sell-inventory - Get sellable items
// ============================================
router.get('/:nodeId/:shopType/sell-inventory', authenticate, asyncHandler(async (req, res) => {
  const { nodeId, shopType } = req.params;
  const nodeIdNum = parseInt(nodeId, 10);

  if (isNaN(nodeIdNum)) {
    throw new AppError('Invalid node ID', 400);
  }

  // Verify shop access
  await verifyShopAccess(nodeIdNum, shopType);

  // Verify character location and get party character
  const _activeChar = await verifyCharacterAtNode(req.user.userId, nodeIdNum);

  // Get all user's shared pool items that can be sold (unequipped, unlisted, tradeable)
  const itemsResult = await query(
    `SELECT
       ci.id as instance_id,
       ci.quantity,
       it.id as template_id,
       it.name,
       it.description,
       it.item_type,
       it.base_price,
       it.rarity,
       it.is_tradeable,
       it.sprite_id
     FROM character_items ci
     JOIN item_templates it ON ci.item_template_id = it.id
     WHERE ci.user_id = $1
       AND ci.equipped_slot IS NULL
       AND ci.character_id IS NULL
       AND (ci.listed IS NULL OR ci.listed = FALSE)
       AND (it.is_tradeable IS NULL OR it.is_tradeable = TRUE)
     ORDER BY it.item_type, it.name`,
    [req.user.userId]
  );

  // Format items with sell prices
  const items = itemsResult.rows.map(item => ({
    instanceId: item.instance_id,
    templateId: item.template_id,
    name: item.name,
    description: item.description,
    type: item.item_type,
    rarity: item.rarity,
    quantity: item.quantity,
    basePrice: item.base_price,
    sellPrice: calculateSellPrice(item.base_price),
    spriteId: item.sprite_id
  }));

  res.json({
    nodeId: nodeIdNum,
    shopType,
    items
  });
}));

export default router;
