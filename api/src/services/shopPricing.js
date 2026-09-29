/**
 * @module shopPricing
 * @description NPC shop sell pricing.
 *
 * A shop buys an item back at SELL_MODIFIER (50%) of its value. For a plain
 * template item (bought from a shop, or a stackable consumable/material) the
 * value is the template base_price, whose tier is already priced in. For a
 * rolled drop the value also reflects the rolled rarity and augments, using
 * the same formula as the marketplace suggested price, so a Legendary
 * 4-augment axe no longer sells for the same few coins as a plain one.
 *
 * Only unique (non-stacking) equipment gets the rolled valuation. Stackable
 * consumables and materials always sell at 50% of base_price, whatever their
 * modifications: every add-to-inventory path (shop buy, marketplace fills,
 * chest loot, caravan) tops up an existing stack, so a rolled rarity on one
 * dropped potion would otherwise re-price every unit bought into that stack
 * and let a player buy at list price and sell back at 5-10x (infinite gold).
 * The rolled valuation is opt-in by item type, so an unknown or missing type
 * gets the plain price (fail closed).
 *
 * Used by both GET sell-inventory (the price shown) and POST sell (the price
 * paid) so the two can never disagree.
 */

import { calculateSuggestedPrice } from './marketplace/itemListings.js';

export const SELL_MODIFIER = 0.50;

/** Item types that are unique instances and may be priced on their rolls. */
export const ROLLED_VALUE_ITEM_TYPES = new Set(['weapon', 'armor', 'accessory']);

/**
 * @param {number} basePrice - item_templates.base_price
 * @param {Object|null} [modifications] - character_items.modifications
 * @param {string} [itemType] - item_templates.item_type; only equipment types
 *   in ROLLED_VALUE_ITEM_TYPES are priced on rolled rarity/augments
 * @returns {number} Unit sell price in gold (integer, >= 0)
 */
export function calculateSellPrice(basePrice, modifications = null, itemType = null) {
  const base = Number(basePrice) || 0;
  if (!ROLLED_VALUE_ITEM_TYPES.has(itemType)) {
    return Math.floor(base * SELL_MODIFIER);
  }
  const mods = modifications || {};
  const augments = Array.isArray(mods.augments) ? mods.augments : [];
  const rolled = mods.rarity !== null && mods.rarity !== undefined;

  if (!rolled && augments.length === 0) {
    return Math.floor(base * SELL_MODIFIER);
  }

  const { suggestedPrice } = calculateSuggestedPrice({
    basePrice: base,
    rarity: mods.rarity,
    augments,
    baseStats: rolled ? mods.baseStats : null
  });
  return Math.floor(suggestedPrice * SELL_MODIFIER);
}
