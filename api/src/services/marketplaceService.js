/**
 * @module marketplaceService
 * @description Re-export wrapper for modularized marketplace service.
 *
 * This file maintains backwards compatibility for existing imports.
 * All functionality has been split into focused modules:
 *
 * - marketplace/orderBook.js - Order book queries and matching
 * - marketplace/orderManagement.js - Order placement, execution, cancellation
 * - marketplace/escrow.js - Gold/item reservation
 * - marketplace/itemListings.js - Unique item listings with modifications
 * - marketplace/search.js - Item search and filtering
 * - marketplace/constants.js - Shared constants
 *
 * @see marketplace/index.js - Module aggregator
 */

export {
  // Order Book
  getOrderBook,
  getMatchingOrders,
  // Escrow
  reserveGold,
  releaseGold,
  escrowItems,
  releaseEscrowedItems,
  addItemToUser,
  // Order Management
  executeTrade,
  placeLimitOrder,
  executeMarketOrder,
  cancelOrder,
  getUserOrders,
  getTradeHistory,
  // Search
  searchItems,
  searchItemsWithAugments,
  // Item Listings
  calculateSuggestedPrice,
  getItemListings,
  getListingAggregates,
  createItemListing,
  buyItemListing,
  cancelItemListing,
  getUserListings,
  getSellableInventory
} from './marketplace/index.js';
