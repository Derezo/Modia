/**
 * @module marketplace/search
 * @description Item search and filtering for marketplace.
 *
 * Key responsibilities:
 * - Search tradeable items with filters
 * - Include market data (orders, listings, volume)
 * - Support augment category filtering
 *
 * @see itemListings.js - For unique item listings
 */

/**
 * Search tradeable items
 * @param {Object} client - Database client
 * @param {string} searchTerm - Search term to match item names
 * @param {string|null} itemType - Filter by item type
 * @param {number} limit - Maximum results to return
 * @returns {Promise<Array>} Array of matching items with market data
 */
export async function searchItems(client, searchTerm = '', itemType = null, limit = 50) {
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
      it.is_stackable,
      it.sprite_id,
      COALESCE(ask.best_ask, 0) as best_ask,
      COALESCE(bid.best_bid, 0) as best_bid,
      COALESCE(vol.volume_24h, 0) as volume_24h,
      COALESCE(ord.open_orders, 0) as open_orders,
      COALESCE(listings.listing_count, 0) as listing_count,
      listings.min_listing_price,
      listings.max_listing_price
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
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as open_orders
      FROM market_orders
      WHERE item_template_id = it.id
        AND status IN ('open', 'partial')
    ) ord ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) as listing_count,
        MIN(price) as min_listing_price,
        MAX(price) as max_listing_price
      FROM item_listings
      WHERE item_template_id = it.id
        AND status = 'active'
    ) listings ON true
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

  // Sort by open orders (most active first), then alphabetically
  query += ` ORDER BY COALESCE(ord.open_orders, 0) DESC, it.name ASC LIMIT $${paramIndex}`;
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
    isStackable: row.is_stackable || false,
    spriteId: row.sprite_id,
    bestAsk: row.best_ask ? parseInt(row.best_ask, 10) : null,
    bestBid: row.best_bid ? parseInt(row.best_bid, 10) : null,
    volume24h: parseInt(row.volume_24h, 10) || 0,
    openOrders: parseInt(row.open_orders, 10) || 0,
    listingCount: parseInt(row.listing_count, 10) || 0,
    minListingPrice: row.min_listing_price ? parseInt(row.min_listing_price, 10) : null,
    maxListingPrice: row.max_listing_price ? parseInt(row.max_listing_price, 10) : null
  }));
}

/**
 * Search items with augment category filter
 * Extends the base searchItems to include augment filtering.
 *
 * @param {Object} client - Database client
 * @param {string} searchTerm - Search term to match item names
 * @param {string|null} itemType - Filter by item type (weapon, armor, etc.)
 * @param {string|null} augmentCategory - Filter by augment category (fire, ice, etc.)
 * @param {number} limit - Maximum results to return
 * @returns {Promise<Array>} Array of matching items with market data
 */
export async function searchItemsWithAugments(client, searchTerm = '', itemType = null, augmentCategory = null, limit = 50) {
  // Build parameters array first to ensure proper indexing
  const params = [];
  let paramIndex = 1;

  // Pre-calculate parameter indices for augment filter (used in subquery)
  let augmentParamIndex = null;
  if (augmentCategory) {
    augmentParamIndex = paramIndex;
    params.push(JSON.stringify([{ category: augmentCategory }]));
    paramIndex++;
  }

  // Build the listings subquery with proper parameter index
  const listingsSubquery = augmentCategory
    ? `
      SELECT
        COUNT(*) as listing_count,
        MIN(price) as min_listing_price,
        MAX(price) as max_listing_price
      FROM item_listings
      WHERE item_template_id = it.id
        AND status = 'active'
        AND modifications_snapshot->'augments' @> $${augmentParamIndex}::jsonb
    `
    : `
      SELECT
        COUNT(*) as listing_count,
        MIN(price) as min_listing_price,
        MAX(price) as max_listing_price
      FROM item_listings
      WHERE item_template_id = it.id
        AND status = 'active'
    `;

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
      it.is_stackable,
      it.sprite_id,
      COALESCE(ask.best_ask, 0) as best_ask,
      COALESCE(bid.best_bid, 0) as best_bid,
      COALESCE(vol.volume_24h, 0) as volume_24h,
      COALESCE(ord.open_orders, 0) as open_orders,
      COALESCE(listings.listing_count, 0) as listing_count,
      listings.min_listing_price,
      listings.max_listing_price
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
    LEFT JOIN LATERAL (
      SELECT COUNT(*) as open_orders
      FROM market_orders
      WHERE item_template_id = it.id
        AND status IN ('open', 'partial')
    ) ord ON true
    LEFT JOIN LATERAL (
      ${listingsSubquery}
    ) listings ON true
    WHERE (it.is_tradeable IS NULL OR it.is_tradeable = TRUE)
  `;

  // Add remaining WHERE filters
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

  // Sort by activity (orders + listings), then alphabetically
  query += ` ORDER BY (COALESCE(ord.open_orders, 0) + COALESCE(listings.listing_count, 0)) DESC, it.name ASC LIMIT $${paramIndex}`;
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
    isStackable: row.is_stackable,
    spriteId: row.sprite_id,
    bestAsk: row.best_ask ? parseInt(row.best_ask, 10) : null,
    bestBid: row.best_bid ? parseInt(row.best_bid, 10) : null,
    volume24h: parseInt(row.volume_24h, 10) || 0,
    openOrders: parseInt(row.open_orders, 10) || 0,
    listingCount: parseInt(row.listing_count, 10) || 0,
    minListingPrice: row.min_listing_price ? parseInt(row.min_listing_price, 10) : null,
    maxListingPrice: row.max_listing_price ? parseInt(row.max_listing_price, 10) : null
  }));
}
