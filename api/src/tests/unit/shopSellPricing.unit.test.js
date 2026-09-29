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
    const legendaryPrice = calculateSellPrice(90, legendary, 'weapon');
    const commonPrice = calculateSellPrice(90, common, 'weapon');
    assert.strictEqual(commonPrice, 45);
    assert.ok(legendaryPrice > commonPrice * 10, `legendary ${legendaryPrice} vs common ${commonPrice}`);
  });

  it('is half of the marketplace suggested price for rolled items', () => {
    const mods = { rarity: 3, augments: [aug('lightning'), aug('holy')] };
    const { suggestedPrice } = calculateSuggestedPrice({ basePrice: 150, rarity: 3, augments: mods.augments });
    assert.strictEqual(calculateSellPrice(150, mods, 'armor'), Math.floor(suggestedPrice * SELL_MODIFIER));
  });

  it('prices a rolled drop on a 2g starter template by its stats, not the template', () => {
    // Rare 2-augment "Demonslayer Trainee Tunic" rolled at mid level
    const mods = { rarity: 3, baseStats: { vitality: 4, hp_max: 10 }, augments: [aug('power'), aug('protection')] };
    const price = calculateSellPrice(2, mods, 'armor');
    const plainStarter = calculateSellPrice(2);
    assert.strictEqual(plainStarter, 1, 'an unrolled starter item stays near worthless');
    assert.ok(price >= 100, `rolled starter-base rare sells for ${price}`);
  });

  it('never prices a rolled drop below its template', () => {
    const mods = { rarity: 1, baseStats: { strength: 1 }, augments: [] };
    assert.strictEqual(calculateSellPrice(400, mods, 'weapon'), 200);
  });

  it('sells a rolled consumable stack at 50% of base, whatever its rolls', () => {
    // Regression: an epic 2-augment Phoenix Feather drop used to be priced on
    // its rolls, and bought feathers stack into that row -> buy 600 / sell 1625.
    const mods = { rarity: 4, augments: [{ category: 'revive_bonus' }, { category: 'instant' }] };
    assert.strictEqual(calculateSellPrice(500, mods, 'consumable'), 250);
    assert.strictEqual(calculateSellPrice(15, { rarity: 3, augments: [aug('power')] }, 'material'), 7);
  });

  it('prices rolls only for equipment types (unknown or missing type fails closed)', () => {
    const mods = { rarity: 4, augments: [aug('power'), aug('protection')] };
    assert.ok(calculateSellPrice(500, mods, 'weapon') > 250);
    assert.ok(calculateSellPrice(500, mods, 'armor') > 250);
    assert.ok(calculateSellPrice(500, mods, 'accessory') > 250);
    assert.strictEqual(calculateSellPrice(500, mods), 250);
    assert.strictEqual(calculateSellPrice(500, mods, 'key_item'), 250);
  });

  it('treats a missing base price as zero', () => {
    assert.strictEqual(calculateSellPrice(undefined), 0);
  });
});
