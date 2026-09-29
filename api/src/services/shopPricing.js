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
 * Used by both GET sell-inventory (the price shown) and POST sell (the price
 * paid) so the two can never disagree.
 */

import { calculateSuggestedPrice } from './marketplace/itemListings.js';

export const SELL_MODIFIER = 0.50;

/**
 * @param {number} basePrice - item_templates.base_price
 * @param {Object|null} [modifications] - character_items.modifications
 * @returns {number} Unit sell price in gold (integer, >= 0)
 */
export function calculateSellPrice(basePrice, modifications = null) {
  const base = Number(basePrice) || 0;
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
