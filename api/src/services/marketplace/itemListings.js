/**
 * @module marketplace/itemListings
 * @description Unique item listings with modifications/augments.
 *
 * Key responsibilities:
 * - Create listings for unique (non-stackable) items
 * - Calculate suggested prices based on rarity/augments
 * - Handle listing purchase with seller fee
 * - Manage listing cancellation
 *
 * @see escrow.js - Item escrow for sell orders
 * @see constants.js - Price calculation multipliers
 */

import { AppError } from '../../middleware/errorHandler.js';
import { MAX_GOLD } from '../../config/constants.js';
import { DEFAULT_TAX_RATE, AUGMENT_VALUES, RARITY_MULTIPLIERS } from './constants.js';

/**
 * Calculate suggested price for an item based on its properties
 * @param {Object} item - Item with basePrice, rarity, augments
 * @returns {Object} Suggested price and breakdown
 */
export function calculateSuggestedPrice(item) {
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
 * @param {Object} client - Database client
 * @param {number} itemTemplateId - Item template ID
 * @returns {Promise<Array>} List of listings with modifications
 */
export async function getItemListings(client, itemTemplateId) {
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
       it.sprite_id,
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
      itemType: row.item_type,
      rarity: mods.rarity || 'common',
      material: mods.material || null,
      baseStats: mods.baseStats || row.template_stats || {},
      bonusStats: mods.bonusStats || {},
      augments: mods.augments || [],
      spriteId: row.sprite_id,
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
 * @param {Object} client - Database client
 * @param {Array<number>} templateIds - Item template IDs to aggregate
 * @returns {Promise<Object>} Aggregates by template ID
 */
export async function getListingAggregates(client, templateIds) {
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
 * @param {Object} client - Database client
 * @param {number} userId - Seller user ID
 * @param {number} characterId - Character ID for context
 * @param {number} characterItemId - Character item instance ID
 * @param {number} price - Listing price
 * @returns {Promise<Object>} Created listing info
 */
export async function createItemListing(client, userId, characterId, characterItemId, price) {
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
    'SELECT id FROM item_listings WHERE character_item_id = $1 AND status = \'active\'',
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
    'UPDATE character_items SET modifications = modifications || \'{"listed": true}\'::jsonb WHERE id = $1',
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
 * @param {Object} client - Database client
 * @param {number} buyerUserId - Buyer user ID
 * @param {number} buyerCharacterId - Buyer character ID
 * @param {number} listingId - Listing ID to purchase
 * @param {number} sellerTaxRate - Tax rate to apply
 * @returns {Promise<Object>} Purchase result
 */
export async function buyItemListing(client, buyerUserId, buyerCharacterId, listingId, sellerTaxRate = DEFAULT_TAX_RATE) {
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
    'UPDATE item_listings SET status = \'sold\', updated_at = CURRENT_TIMESTAMP WHERE id = $1',
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
 * @param {Object} client - Database client
 * @param {number} userId - User requesting cancellation
 * @param {number} listingId - Listing ID to cancel
 * @returns {Promise<Object>} Cancellation result
 */
export async function cancelItemListing(client, userId, listingId) {
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
    'UPDATE character_items SET modifications = $1 WHERE id = $2',
    [mods, listing.character_item_id]
  );

  // Update listing status
  await client.query(
    'UPDATE item_listings SET status = \'cancelled\', updated_at = CURRENT_TIMESTAMP WHERE id = $1',
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
 * @param {Object} client - Database client
 * @param {number} userId - User ID
 * @returns {Promise<Array>} List of user's active listings
 */
export async function getUserListings(client, userId) {
  const result = await client.query(
    `SELECT
       il.id as listing_id,
       il.price,
       il.suggested_price,
       il.created_at,
       il.modifications_snapshot as modifications,
       il.item_template_id,
       it.name as template_name,
       it.item_type,
       it.sprite_id
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
      spriteId: row.sprite_id,
      price: parseInt(row.price, 10),
      suggestedPrice: row.suggested_price ? parseInt(row.suggested_price, 10) : null,
      createdAt: row.created_at
    };
  });
}

/**
 * Get sellable items from user's inventory
 * Returns items that are: unequipped, tradeable, and not already listed on marketplace
 * @param {import('pg').PoolClient} client - Database client
 * @param {number} userId - User ID
 * @returns {Promise<Array>} List of sellable items with suggested prices
 */
export async function getSellableInventory(client, userId) {
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
      it.is_stackable,
      it.sprite_id
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
      spriteId: row.sprite_id,
      estimatedPrice: suggestedPrice
    };
  });

  return items;
}
