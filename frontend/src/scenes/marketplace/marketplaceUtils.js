/**
 * Marketplace Utilities - Shared helper functions
 */

import { normalizeRarity } from '../../utils/statDisplay.js';
import { renderItemStatRows } from '../../components/ItemStatRows.js';

/**
 * Format a date/time for display
 * @param {string|Date} dateStr - Date to format
 * @returns {string} Formatted time string
 */
export function formatTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Capitalize a string (first letter uppercase, replace underscores with spaces)
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
export function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ') : '';
}

/**
 * Map rarity number to string name
 * @param {number|string} rarity - Rarity value
 * @returns {string} Rarity name
 */
export function getRarityName(rarity) {
  // Handles 1-5 numbers, numeric strings ("4") and names in any case
  return normalizeRarity(rarity);
}

/**
 * Format listing stats for display: the shared ItemStatRows block (full stat
 * names, "(+X base +Y bonus)" breakdowns, consumable effects as effect rows),
 * so the seller's Sell / My Listings panels read the same as the buyer's
 * listing cards, the item detail modal and the shop.
 * @param {Object} listing - Listing or sellable item (baseStats/bonusStats)
 * @returns {string} HTML string of stats ('' when there are none)
 */
export function formatListingStats(listing) {
  return renderItemStatRows(listing);
}

/**
 * Rarity colors for styling
 */
export const RARITY_COLORS = {
  common: '#7a6a5a',
  uncommon: '#4a7548',
  rare: '#4a6a8b',
  epic: '#6b4488',
  legendary: '#aa8833'
};

/**
 * Build the arguments for POST /marketplace/listings from a sellable item.
 *
 * Sellable inventory comes from the user's shared item pool, so the rows
 * carry no character id. The listing is created on behalf of the character
 * the player is trading as (the same id MarketplaceTradePanel sends).
 * @param {Object} item - Sellable item from getSellableInventory
 * @param {Object|null} activeCharacter - Active character from game state
 * @returns {{ characterId: number, characterItemId: number }}
 * @throws {Error} When there is no active character or item instance id
 */
export function buildListingRequest(item, activeCharacter) {
  const characterId = Number.parseInt(activeCharacter?.id, 10);
  if (!Number.isInteger(characterId)) {
    throw new Error('Select a character before listing items for sale.');
  }
  const characterItemId = Number.parseInt(item?.instanceId, 10);
  if (!Number.isInteger(characterItemId)) {
    throw new Error('This item cannot be listed.');
  }
  return { characterId, characterItemId };
}

/**
 * Asking price of one of the user's listings. GET /marketplace/my-listings
 * returns it as `price` (browse listings use `askPrice`).
 * @param {Object} listing
 * @returns {number}
 */
export function listingPrice(listing) {
  const value = Number(listing?.price ?? listing?.askPrice);
  return Number.isFinite(value) ? value : 0;
}
