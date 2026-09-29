/**
 * Shop sell price: rolled rarity and augments raise the buy-back value;
 * plain template items stay at 50% of base_price.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateSellPrice, SELL_MODIFIER } from '../../services/shopPricing.js';
import { calculateSuggestedPrice } from '../../services/marketplace/itemListings.js';

const aug = (category) => ({ key: category, type: 'prefix', category });

describe('calculateSellPrice', () => {
  it('pays half of base_price for a plain template item', () => {
    assert.strictEqual(calculateSellPrice(300), 150);
    assert.strictEqual(calculateSellPrice(300, {}), 150);
    assert.strictEqual(calculateSellPrice(3, null), 1);
  });

  it('prices a rolled legendary drop well above a common copy', () => {
    const legendary = { rarity: 5, augments: [aug('power'), aug('protection'), aug('poison'), aug('regen')] };
    const common = { rarity: 1, augments: [] };
    const legendaryPrice = calculateSellPrice(90, legendary);
    const commonPrice = calculateSellPrice(90, common);
    assert.strictEqual(commonPrice, 45);
    assert.ok(legendaryPrice > commonPrice * 10, `legendary ${legendaryPrice} vs common ${commonPrice}`);
  });

  it('is half of the marketplace suggested price for rolled items', () => {
    const mods = { rarity: 3, augments: [aug('lightning'), aug('holy')] };
    const { suggestedPrice } = calculateSuggestedPrice({ basePrice: 150, rarity: 3, augments: mods.augments });
    assert.strictEqual(calculateSellPrice(150, mods), Math.floor(suggestedPrice * SELL_MODIFIER));
  });

  it('treats a missing base price as zero', () => {
    assert.strictEqual(calculateSellPrice(undefined), 0);
  });
});
