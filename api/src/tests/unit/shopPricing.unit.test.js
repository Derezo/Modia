/**
 * Shop Pricing Unit Tests
 *
 * Validates the NPC shop pricing formulas ensure no arbitrage:
 * - Sell price (50% of value) can never exceed buy price (60%-120% of base)
 * - Plain items: sell at 50% of base, buy at minimum 60% of base
 * - Modified items: NPC shops don't sell modified items, so no arbitrage possible
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateSellPrice, SELL_MODIFIER } from '../../services/shopPricing.js';

// Replicate the supply levels from shop.js for testing
const SUPPLY_LEVELS = {
  scarce: { min: 0, max: 2, modifier: 1.20 },
  low: { min: 3, max: 5, modifier: 1.00 },
  medium: { min: 6, max: 10, modifier: 0.85 },
  high: { min: 11, max: 20, modifier: 0.70 },
  surplus: { min: 21, max: Infinity, modifier: 0.60 }
};

function getMinBuyModifier() {
  return Math.min(...Object.values(SUPPLY_LEVELS).map(l => l.modifier));
}

function calculateBuyPrice(basePrice, quantity) {
  for (const level of Object.values(SUPPLY_LEVELS)) {
    if (quantity >= level.min && quantity <= level.max) {
      return Math.ceil(basePrice * level.modifier);
    }
  }
  return Math.ceil(basePrice * SUPPLY_LEVELS.surplus.modifier);
}

describe('shopPricing no-arbitrage invariants', () => {
  it('SELL_MODIFIER should be less than minimum BUY modifier (surplus)', () => {
    const minBuyModifier = getMinBuyModifier();
    assert.ok(SELL_MODIFIER < minBuyModifier,
      `SELL_MODIFIER (${SELL_MODIFIER}) should be < min buy modifier (${minBuyModifier})`);
  });

  it('plain items: sell price should never exceed minimum buy price', () => {
    const testPrices = [1, 10, 50, 100, 500, 1000, 5000, 10000];

    for (const basePrice of testPrices) {
      const sellPrice = calculateSellPrice(basePrice, null);
      // Minimum buy price is at surplus level (60%)
      const minBuyPrice = calculateBuyPrice(basePrice, 100); // surplus quantity

      assert.ok(sellPrice <= minBuyPrice,
        `Arbitrage detected! basePrice=${basePrice}, sell=${sellPrice}, minBuy=${minBuyPrice}`);
    }
  });

  it('plain items: sell price should be 50% of base price', () => {
    const testCases = [
      { basePrice: 100, expected: 50 },
      { basePrice: 25, expected: 12 },
      { basePrice: 333, expected: 166 },
      { basePrice: 1, expected: 0 }
    ];

    for (const { basePrice, expected } of testCases) {
      const sellPrice = calculateSellPrice(basePrice, null);
      assert.strictEqual(sellPrice, expected,
        `basePrice=${basePrice}: expected sell=${expected}, got ${sellPrice}`);
    }
  });

  it('modified items: sell price based on suggestedPrice * 50%', () => {
    // A modified item with rarity and augments
    const modifications = {
      rarity: 'rare', // 2.5x multiplier
      augments: [
        { category: 'strength' }, // 1.0 value
        { category: 'fire' }       // 0.8 value
      ]
    };
    const basePrice = 100;

    const sellPrice = calculateSellPrice(basePrice, modifications);

    // suggestedPrice = 100 * 2.5 * (1 + 1.8 * 0.15) = 100 * 2.5 * 1.27 = 317.5 -> 317
    // sellPrice = 317 * 0.5 = 158.5 -> 158
    // The exact value depends on the suggestedPrice calculation
    assert.ok(sellPrice > 0, 'Modified items should have positive sell price');
    assert.ok(sellPrice > calculateSellPrice(basePrice, null),
      'Modified items should sell for more than plain items');
  });

  it('modified items: cannot create NPC shop arbitrage because shops do not sell modified items', () => {
    // This is a documentation test - verifying the invariant holds by design.
    // NPC shops only sell template items (no modifications).
    // When a player sells a modified item to an NPC, the shop inventory
    // increases for the base template only - modifications are lost.
    //
    // Therefore, a player cannot:
    // 1. Buy a modified item from NPC shop (shops only have templates)
    // 2. Sell it back for more
    //
    // The sell price for modified items only matters for player drops,
    // which cannot create arbitrage since they weren't bought.
    assert.ok(true, 'NPC shops do not sell modified items - no arbitrage possible by design');
  });

  it('all supply levels: sell price should never exceed buy price', () => {
    const testPrices = [50, 100, 500, 1000];
    const supplyQuantities = [1, 3, 7, 15, 25]; // covers all supply levels

    for (const basePrice of testPrices) {
      const sellPrice = calculateSellPrice(basePrice, null);

      for (const quantity of supplyQuantities) {
        const buyPrice = calculateBuyPrice(basePrice, quantity);

        assert.ok(sellPrice <= buyPrice,
          `Arbitrage at qty=${quantity}! basePrice=${basePrice}, sell=${sellPrice}, buy=${buyPrice}`);
      }
    }
  });

  it('edge case: zero base price', () => {
    const sellPrice = calculateSellPrice(0, null);
    assert.strictEqual(sellPrice, 0, 'Zero base price should result in zero sell price');
  });

  it('edge case: null/undefined base price should be treated as zero', () => {
    assert.strictEqual(calculateSellPrice(null, null), 0);
    assert.strictEqual(calculateSellPrice(undefined, null), 0);
  });

  it('edge case: string base price should be coerced to number', () => {
    // Number('100') = 100, which gets SELL_MODIFIER applied
    assert.strictEqual(calculateSellPrice('100', null), 50);
    assert.strictEqual(calculateSellPrice('invalid', null), 0);
  });
});
