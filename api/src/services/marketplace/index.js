/**
 * @module marketplace
 * @description Marketplace service aggregator - re-exports all marketplace modules.
 *
 * Key modules:
 * - orderBook.js - Order book queries and matching
 * - orderManagement.js - Order placement, execution, cancellation
 * - escrow.js - Gold/item reservation
 * - itemListings.js - Unique item listings
 * - search.js - Item search and filtering
 * - constants.js - Shared constants
 *
 * @see ../marketplaceService.js - Main entry point (re-export wrapper)
 */

// Constants
export { DEFAULT_TAX_RATE, AUGMENT_VALUES, RARITY_MULTIPLIERS, RARITY_NAMES, normalizeRarityName } from './constants.js';

// Order Book
export { getOrderBook, getMatchingOrders } from './orderBook.js';

// Escrow
export {
  reserveGold,
  releaseGold,
  escrowItems,
  releaseEscrowedItems,
  reduceEscrow,
  consumeReservation,
  addItemToUser
} from './escrow.js';

// Order Management
export {
  executeTrade,
  placeLimitOrder,
  executeMarketOrder,
  cancelOrder,
  getUserOrders,
  getTradeHistory
} from './orderManagement.js';

// Search
export { searchItems, searchItemsWithAugments } from './search.js';

// Item Listings
export {
  calculateSuggestedPrice,
  getItemListings,
  getListingAggregates,
  createItemListing,
  buyItemListing,
  cancelItemListing,
  getUserListings,
  getSellableInventory
} from './itemListings.js';
