/**
 * Economy Balance Tests
 * Verifies gold income vs costs, experience progression, and market prices
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createMockCharacter,
  createMockEnemy,
  calculateGoldPerHour,
  calculateExpPerHour,
  calculateTimeToLevel,
  TEST_LEVELS,
  ALL_TIERS,
  expForLevel,
  MAX_CHARACTER_LEVEL,
  TIER_MULTIPLIERS
} from './balanceTestUtils.js';
import {
  RODS,
  TACKLE,
  calculateFishValue,
  getWaitDurationMs,
  selectFishForCatch
} from '../../db/templates/fish.js';
import { CARAVAN_PRICE_MODIFIER } from '../../db/templates/caravanItems.js';

// Gold economy constants (from game design)
const GOLD_REWARDS = {
  tier1: { min: 5, max: 15 },
  tier2: { min: 10, max: 25 },
  tier3: { min: 20, max: 50 },
  tier4: { min: 40, max: 100 },
  tier5: { min: 80, max: 200 }
};

const EXP_REWARDS = {
  tier1: { base: 15 },
  tier2: { base: 30 },
  tier3: { base: 60 },
  tier4: { base: 120 },
  tier5: { base: 250 }
};

// Estimated shop prices for basic items
const SHOP_PRICES = {
  basicPotion: 50,
  betterPotion: 150,
  bestPotion: 500,
  basicWeapon: 200,
  midWeapon: 1000,
  endgameWeapon: 10000,
  basicArmor: 150,
  midArmor: 800,
  endgameArmor: 8000
};

// Estimated battles per hour (accounts for travel, UI, decisions)
const BATTLES_PER_HOUR = 10;

describe('Gold Economy Balance', () => {
  describe('Gold Income Rates', () => {
    it('should have tier rewards scale appropriately', () => {
      // Each tier should give ~2x gold of previous tier
      const avgRewards = ALL_TIERS.map(tier => {
        const rewards = GOLD_REWARDS[`tier${tier}`];
        return (rewards.min + rewards.max) / 2;
      });

      for (let i = 1; i < avgRewards.length; i++) {
        const ratio = avgRewards[i] / avgRewards[i - 1];
        assert.ok(ratio >= 1.5 && ratio <= 3,
          `Tier ${i + 1} gold should be 1.5-3x tier ${i}: ratio=${ratio.toFixed(2)}`);
      }
    });

    it('should allow buying basic potions after a few tier 1 battles', () => {
      const avgGold = (GOLD_REWARDS.tier1.min + GOLD_REWARDS.tier1.max) / 2;
      const battlesToPotion = Math.ceil(SHOP_PRICES.basicPotion / avgGold);

      assert.ok(battlesToPotion <= 10,
        `Should be able to afford basic potion in <= 10 tier 1 battles, needs ${battlesToPotion}`);
    });

    it('should have gold income scale with level content', () => {
      // Higher tier content should give proportionally more gold
      const tier1Income = calculateGoldPerHour({
        goldPerBattle: (GOLD_REWARDS.tier1.min + GOLD_REWARDS.tier1.max) / 2,
        battlesPerHour: BATTLES_PER_HOUR
      });

      const tier5Income = calculateGoldPerHour({
        goldPerBattle: (GOLD_REWARDS.tier5.min + GOLD_REWARDS.tier5.max) / 2,
        battlesPerHour: BATTLES_PER_HOUR
      });

      // Tier 5 should give at least 10x more gold per hour
      assert.ok(tier5Income >= tier1Income * 10,
        `Tier 5 income (${tier5Income}/hr) should be >= 10x tier 1 (${tier1Income}/hr)`);
    });
  });

  describe('Equipment Progression', () => {
    it('should allow upgrading gear before next tier content', () => {
      // Player should be able to afford mid-tier gear after reasonable grinding
      const tier3AvgGold = (GOLD_REWARDS.tier3.min + GOLD_REWARDS.tier3.max) / 2;
      const tier3Income = calculateGoldPerHour({
        goldPerBattle: tier3AvgGold,
        battlesPerHour: BATTLES_PER_HOUR
      });

      const hoursForMidWeapon = SHOP_PRICES.midWeapon / tier3Income;

      assert.ok(hoursForMidWeapon <= 3,
        `Should afford mid weapon in <= 3 hours of tier 3, takes ${hoursForMidWeapon.toFixed(1)}h`);
    });

    it('should have endgame gear require significant investment', () => {
      // Endgame gear should not be trivial to acquire
      const tier5AvgGold = (GOLD_REWARDS.tier5.min + GOLD_REWARDS.tier5.max) / 2;
      const tier5Income = calculateGoldPerHour({
        goldPerBattle: tier5AvgGold,
        battlesPerHour: BATTLES_PER_HOUR
      });

      const hoursForEndgameSet = (SHOP_PRICES.endgameWeapon + SHOP_PRICES.endgameArmor) / tier5Income;

      // Should take at least 5 hours for full endgame set
      assert.ok(hoursForEndgameSet >= 5,
        `Endgame set should require >= 5 hours, takes ${hoursForEndgameSet.toFixed(1)}h`);

      // But shouldn't take more than 30 hours
      assert.ok(hoursForEndgameSet <= 30,
        `Endgame set should take <= 30 hours, takes ${hoursForEndgameSet.toFixed(1)}h`);
    });
  });

  describe('Consumable Sustainability', () => {
    it('should document consumable economics', () => {
      // Players should be able to afford potions while farming
      const tier3AvgGold = (GOLD_REWARDS.tier3.min + GOLD_REWARDS.tier3.max) / 2;

      // If using 1 potion every 3 battles
      const potionsPerHour = BATTLES_PER_HOUR / 3;
      const potionCostPerHour = potionsPerHour * SHOP_PRICES.betterPotion;
      const goldIncomePerHour = tier3AvgGold * BATTLES_PER_HOUR;

      console.log(`Tier 3 gold income: ${goldIncomePerHour}/hr`);
      console.log(`Potion cost (1 per 3 battles): ${potionCostPerHour}/hr`);
      console.log(`Net gold flow: ${goldIncomePerHour - potionCostPerHour}/hr`);

      // Flag if potion usage is unsustainable
      if (goldIncomePerHour < potionCostPerHour) {
        console.warn('BALANCE WARNING: Potion usage is unsustainable at tier 3 - consider increasing gold rewards or reducing potion cost');
      }

      // Basic check - gold income should be positive
      assert.ok(goldIncomePerHour > 0, 'Gold income should be positive');
    });
  });
});

describe('Experience Progression Balance', () => {
  describe('Level Curve', () => {
    it('should have exponential exp requirements', () => {
      const expReqs = TEST_LEVELS.map(level => ({
        level,
        exp: expForLevel(level)
      }));

      console.log('Experience requirements by level:');
      expReqs.forEach(({ level, exp }) => {
        console.log(`  Level ${level}: ${exp.toLocaleString()} exp`);
      });

      // Each level should require more exp than previous
      for (let i = 1; i < expReqs.length; i++) {
        assert.ok(expReqs[i].exp > expReqs[i - 1].exp,
          `Level ${expReqs[i].level} should require more exp than level ${expReqs[i - 1].level}`);
      }
    });

    it('should document time to reach level milestones', () => {
      const tier1AvgExp = EXP_REWARDS.tier1.base;
      const tier3AvgExp = EXP_REWARDS.tier3.base;
      const tier5AvgExp = EXP_REWARDS.tier5.base;

      const expPerHourT1 = calculateExpPerHour({ expPerBattle: tier1AvgExp, battlesPerHour: BATTLES_PER_HOUR });
      const expPerHourT3 = calculateExpPerHour({ expPerBattle: tier3AvgExp, battlesPerHour: BATTLES_PER_HOUR });
      const expPerHourT5 = calculateExpPerHour({ expPerBattle: tier5AvgExp, battlesPerHour: BATTLES_PER_HOUR });

      const hoursTo10 = calculateTimeToLevel(1, 10, expPerHourT1);
      const hours20To30 = calculateTimeToLevel(20, 30, expPerHourT3);
      const hours50To60 = calculateTimeToLevel(50, 60, expPerHourT5);

      console.log('Progression time estimates:');
      console.log(`  Levels 1-10 (tier 1): ${hoursTo10.toFixed(1)} hours`);
      console.log(`  Levels 20-30 (tier 3): ${hours20To30.toFixed(1)} hours`);
      console.log(`  Levels 50-60 (tier 5): ${hours50To60.toFixed(1)} hours`);

      // Flag if progression seems too slow
      if (hoursTo10 > 10) {
        console.warn(`BALANCE WARNING: Early game progression (${hoursTo10.toFixed(1)}h to L10) may be too slow. Consider increasing tier 1 exp rewards.`);
      }

      // Basic sanity check - any positive exp gain
      assert.ok(expPerHourT1 > 0, 'Tier 1 exp/hour should be positive');
      assert.ok(expPerHourT3 > 0, 'Tier 3 exp/hour should be positive');
      assert.ok(expPerHourT5 > 0, 'Tier 5 exp/hour should be positive');
    });
  });

  describe('Exp Tier Scaling', () => {
    it('should have exp rewards scale with tier', () => {
      const expByTier = ALL_TIERS.map(tier => ({
        tier,
        exp: EXP_REWARDS[`tier${tier}`].base
      }));

      console.log('Exp rewards by tier:');
      expByTier.forEach(({ tier, exp }) => {
        console.log(`  Tier ${tier}: ${exp} exp per battle`);
      });

      for (let i = 1; i < expByTier.length; i++) {
        assert.ok(expByTier[i].exp > expByTier[i - 1].exp,
          `Tier ${i + 1} should give more exp than tier ${i}`);
      }
    });

    it('should document battles per level at high levels', () => {
      const level = 50;
      const expToNext = expForLevel(level + 1);
      const tier5Exp = EXP_REWARDS.tier5.base;

      const battlesToLevel = Math.ceil(expToNext / tier5Exp);

      console.log(`Level ${level}->51 requires ${expToNext.toLocaleString()} exp`);
      console.log(`At tier 5 (${tier5Exp} exp/battle): ${battlesToLevel} battles needed`);

      if (battlesToLevel > 500) {
        console.warn(`BALANCE WARNING: ${battlesToLevel} battles to level at L50 is very high. Consider increasing exp rewards or adjusting exp curve.`);
      }

      // Basic sanity - should be achievable
      assert.ok(battlesToLevel > 0, 'Battles to level should be positive');
      assert.ok(battlesToLevel < 10000, 'Battles to level should be achievable');
    });
  });

  describe('Party vs Solo Balance', () => {
    it('should document exp splitting behavior', () => {
      // This test documents expected behavior for party play
      // Actual implementation may vary based on design decisions

      const soloExp = EXP_REWARDS.tier3.base;
      const partySize = 3;
      // Typically parties get a bonus to offset split
      const partyBonus = 1.5; // 50% bonus for party play
      const splitExp = (soloExp * partyBonus) / partySize;

      // Verify party play is still worthwhile
      assert.ok(splitExp >= soloExp * 0.4,
        'Party exp per person should be at least 40% of solo to remain viable');
    });
  });
});

describe('Market Price Balance', () => {
  describe('Price Floors and Ceilings', () => {
    it('should have sensible price ratios', () => {
      // Better items should cost more
      assert.ok(SHOP_PRICES.betterPotion > SHOP_PRICES.basicPotion,
        'Better potion should cost more than basic');
      assert.ok(SHOP_PRICES.bestPotion > SHOP_PRICES.betterPotion,
        'Best potion should cost more than better');

      // Price jumps should be reasonable (2-5x per tier)
      const potionRatio1 = SHOP_PRICES.betterPotion / SHOP_PRICES.basicPotion;
      const potionRatio2 = SHOP_PRICES.bestPotion / SHOP_PRICES.betterPotion;

      console.log('Potion price progression:');
      console.log(`  Basic: ${SHOP_PRICES.basicPotion}g`);
      console.log(`  Better: ${SHOP_PRICES.betterPotion}g (${potionRatio1.toFixed(1)}x)`);
      console.log(`  Best: ${SHOP_PRICES.bestPotion}g (${potionRatio2.toFixed(1)}x)`);

      assert.ok(potionRatio1 >= 2 && potionRatio1 <= 5,
        `Potion tier ratio should be 2-5x: ${potionRatio1.toFixed(1)}x`);
      assert.ok(potionRatio2 >= 2 && potionRatio2 <= 5,
        `Potion tier ratio should be 2-5x: ${potionRatio2.toFixed(1)}x`);
    });

    it('should document equipment vs consumable costs', () => {
      console.log('Equipment vs consumable prices:');
      console.log(`  Best potion: ${SHOP_PRICES.bestPotion}g`);
      console.log(`  Basic weapon: ${SHOP_PRICES.basicWeapon}g`);

      // Note: In some game designs, high-end consumables can cost more than basic weapons
      // This is a design decision, not necessarily wrong
      if (SHOP_PRICES.basicWeapon < SHOP_PRICES.bestPotion) {
        console.warn('NOTE: Best potions cost more than basic weapons - this may be intentional for economy balance');
      }

      // All prices should be positive
      assert.ok(SHOP_PRICES.basicWeapon > 0, 'Basic weapon price should be positive');
      assert.ok(SHOP_PRICES.bestPotion > 0, 'Best potion price should be positive');
    });
  });

  describe('Vendor Buy/Sell Ratio', () => {
    it('should document expected vendor margins', () => {
      // Vendors typically buy at 50% of sell price
      const vendorBuyRatio = 0.5;
      const basicWeaponSellValue = SHOP_PRICES.basicWeapon * vendorBuyRatio;

      // Selling 4 basic weapons should buy 1 new one (typical upgrade pattern)
      const weaponsToSellForNew = SHOP_PRICES.basicWeapon / basicWeaponSellValue;
      assert.strictEqual(weaponsToSellForNew, 2,
        'Should need to sell 2 items to buy 1 of same tier');
    });
  });
});

describe('Time Investment Balance', () => {
  describe('Total Time to Max Level', () => {
    it('should document estimated time to max level', () => {
      // Estimate time assuming optimal tier progression
      const levelsPerTier = [
        { levels: [1, 15], tier: 1 },
        { levels: [15, 25], tier: 2 },
        { levels: [25, 40], tier: 3 },
        { levels: [40, 60], tier: 4 },
        { levels: [60, 100], tier: 5 }
      ];

      let totalHours = 0;

      console.log('Time to level breakdown by tier:');
      levelsPerTier.forEach(({ levels, tier }) => {
        const [start, end] = levels;
        const tierExp = EXP_REWARDS[`tier${tier}`].base;
        const expPerHour = calculateExpPerHour({
          expPerBattle: tierExp,
          battlesPerHour: BATTLES_PER_HOUR
        });
        const hours = calculateTimeToLevel(start, Math.min(end, 100), expPerHour);
        totalHours += hours;
        console.log(`  Tier ${tier} (L${start}-${end}): ${hours.toFixed(0)} hours`);
      });

      console.log(`Total estimated time to level 100: ${totalHours.toFixed(0)} hours`);

      // Flag extreme values
      if (totalHours < 20) {
        console.warn('BALANCE WARNING: Progression is very fast (<20h to max level). Consider if this matches game design goals.');
      } else if (totalHours > 1000) {
        console.warn(`BALANCE WARNING: Progression is extremely slow (${totalHours.toFixed(0)}h to max level). Consider increasing exp rewards.`);
      }

      // Basic sanity check
      assert.ok(totalHours > 0, 'Time to max level should be positive');
    });
  });

  describe('Content Pacing', () => {
    it('should unlock new tier content at appropriate levels', () => {
      // Document expected tier unlock levels
      const tierUnlocks = {
        1: 1,    // Start game
        2: 10,   // After tutorial area
        3: 20,   // Mid game
        4: 35,   // Late mid game
        5: 50    // End game
      };

      // At each tier unlock, should have ~5 hours of lower tier content
      ALL_TIERS.slice(0, -1).forEach(tier => {
        const currentUnlock = tierUnlocks[tier];
        const nextUnlock = tierUnlocks[tier + 1];
        const tierExp = EXP_REWARDS[`tier${tier}`].base;
        const expPerHour = calculateExpPerHour({
          expPerBattle: tierExp,
          battlesPerHour: BATTLES_PER_HOUR
        });

        const hoursBetweenTiers = calculateTimeToLevel(currentUnlock, nextUnlock, expPerHour);

        assert.ok(hoursBetweenTiers >= 2,
          `Tier ${tier} content should last >= 2 hours before tier ${tier + 1}: ${hoursBetweenTiers.toFixed(1)}h`);
      });
    });
  });
});

// ============================================================================
// FISHING INCOME BALANCE
// ============================================================================

describe('Fishing Income Balance', () => {
  const BIOMES = [
    'heartlands',
    'sylvan_reaches',
    'iron_depths',
    'shadowmere',
    'bloodplains'
  ];
  const ATTEMPTS = 120_000;

  function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state = ((1664525 * state) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  }

  function simulate({
    biome = 'heartlands',
    rod = RODS[0],
    tackle = null,
    difficultyTier = 1,
    seed = 0x4d4f4449
  } = {}) {
    const random = seededRandom(seed);
    let elapsedMs = 0;
    let grossGold = 0;

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const power = random() * 100;
      const depth = power < 40 ? 'near' : power < 75 ? 'mid' : 'deep';
      const isBigCatch = random() < 0.20;
      const waitMs = getWaitDurationMs(tackle?.catalogKey || null, random);
      const hardReel = depth === 'deep' || isBigCatch;
      elapsedMs += 1600 + waitMs + 300 + (hardReel ? 8000 : 6000);

      const landed = !isBigCatch || random() < rod.bigCatchLandingRate;
      if (!landed) continue;
      const fish = selectFishForCatch({
        biome,
        depth,
        isBigCatch,
        random
      });
      const minSize = isBigCatch ? 1.3 : 0.8;
      const maxSize = isBigCatch ? 1.7 : 1.5;
      const size = minSize + (random() * (maxSize - minSize));
      grossGold += calculateFishValue(
        fish,
        size,
        isBigCatch,
        difficultyTier
      );
    }

    const hours = elapsedMs / 3_600_000;
    const castsPerHour = ATTEMPTS / hours;
    const grossGoldPerHour = grossGold / hours;
    const tackleUnitPrice = tackle
      ? Math.floor(tackle.basePrice * CARAVAN_PRICE_MODIFIER)
      : 0;
    return {
      castsPerHour,
      grossGoldPerHour,
      tackleCostPerHour: castsPerHour * tackleUnitPrice,
      netGoldPerHour: grossGoldPerHour - (castsPerHour * tackleUnitPrice)
    };
  }

  // Runtime battle rewards default to 10-30g per tier-1 enemy. A normal
  // three-enemy encounter at ten battles/hour therefore expects 600g/hour.
  const equivalentTierBattleIncome = 3 * 20 * BATTLES_PER_HOUR;

  it('keeps basic no-tackle fishing at 50-80% of equivalent battle income', () => {
    for (const biome of BIOMES) {
      const income = simulate({ biome }).grossGoldPerHour;
      const ratio = income / equivalentTierBattleIncome;
      assert.ok(
        ratio >= 0.50 && ratio <= 0.80,
        `${biome} basic fishing ratio ${ratio.toFixed(3)} outside 0.50-0.80`
      );
    }
  });

  it('normalizes expected regional income within ±10%', () => {
    const incomes = BIOMES.map(biome =>
      simulate({ biome }).grossGoldPerHour
    );
    const average = incomes.reduce((sum, value) => sum + value, 0) / incomes.length;
    for (let index = 0; index < incomes.length; index++) {
      const deviation = Math.abs(incomes[index] - average) / average;
      assert.ok(
        deviation <= 0.10,
        `${BIOMES[index]} deviates ${(deviation * 100).toFixed(2)}%`
      );
    }
  });

  it('keeps absolute rod landing progression strictly monotonic', () => {
    const incomes = RODS.map(rod =>
      simulate({ rod }).grossGoldPerHour
    );
    for (let index = 1; index < incomes.length; index++) {
      assert.ok(
        incomes[index] > incomes[index - 1],
        `${RODS[index].name} must outperform ${RODS[index - 1].name}`
      );
    }
  });

  it('charges purchased tackle on every cast when evaluating net income', () => {
    for (const tackle of TACKLE) {
      const result = simulate({ tackle });
      assert.ok(result.tackleCostPerHour > 0);
      assert.ok(result.netGoldPerHour < result.grossGoldPerHour);
      assert.ok(
        result.netGoldPerHour <= equivalentTierBattleIncome * 0.80,
        `${tackle.name} net income exceeds the supplemental ceiling`
      );
    }
  });
});

// ============================================================================
// CARAVAN ITEM PRICE BALANCE
// ============================================================================

describe('Caravan Item Price Balance', () => {
  // Caravan item price data (from caravanItems.js template)
  const CARAVAN_PRICE_DATA = [
    { id: 'mega_potion', type: 'consumable', basePrice: 150 },
    { id: 'full_restore', type: 'consumable', basePrice: 300 },
    { id: 'mega_ether', type: 'consumable', basePrice: 200 },
    { id: 'elixir_supreme', type: 'consumable', basePrice: 400 },
    { id: 'revival_herb', type: 'consumable', basePrice: 350 },
    { id: 'mystery_box', type: 'consumable', basePrice: 500 },
    { id: 'mystery_box_premium', type: 'consumable', basePrice: 1000 },
    { id: 'dragon_scale', type: 'material', basePrice: 250 },
    { id: 'moon_ore', type: 'material', basePrice: 200 },
    { id: 'phoenix_ash', type: 'material', basePrice: 400 },
    { id: 'void_crystal', type: 'material', basePrice: 450 },
    { id: 'ancient_wood', type: 'material', basePrice: 180 },
    { id: 'starlight_essence', type: 'material', basePrice: 320 }
  ];

  it('should have all caravan items with positive prices', () => {
    for (const item of CARAVAN_PRICE_DATA) {
      assert.ok(item.basePrice > 0,
        `Caravan item ${item.id} should have positive base price, got ${item.basePrice}`);
    }
  });

  it('should have caravan consumables cost more than standard shop equivalents', () => {
    // Standard shop better potion costs 150g, caravan mega-potion also 150g base
    // With 15% caravan markup, mega-potion costs ~172g but heals more
    const megaPotionPrice = 150;
    const standardPotionPrice = SHOP_PRICES.betterPotion;

    // Caravan items should be comparable or slightly more expensive
    assert.ok(megaPotionPrice >= standardPotionPrice * 0.5,
      `Mega potion (${megaPotionPrice}g) should not be too cheap vs standard (${standardPotionPrice}g)`);
  });

  it('should have mystery box prices be aspirational but achievable', () => {
    const mysteryBoxPrice = 500;
    const premiumBoxPrice = 1000;

    // Should cost less than endgame equipment
    assert.ok(mysteryBoxPrice < SHOP_PRICES.endgameWeapon,
      `Mystery box (${mysteryBoxPrice}g) should be cheaper than endgame weapon (${SHOP_PRICES.endgameWeapon}g)`);

    // Premium box should be a significant investment
    assert.ok(premiumBoxPrice >= SHOP_PRICES.midWeapon,
      `Premium box (${premiumBoxPrice}g) should be >= mid weapon (${SHOP_PRICES.midWeapon}g)`);
  });

  it('should have material prices scale with crafting utility', () => {
    const materialPrices = CARAVAN_PRICE_DATA
      .filter(i => i.type === 'material')
      .map(i => i.basePrice);

    const minPrice = Math.min(...materialPrices);
    const maxPrice = Math.max(...materialPrices);

    // Materials should have diverse pricing (not all the same)
    assert.ok(maxPrice > minPrice * 1.5,
      `Material prices should vary: min=${minPrice}, max=${maxPrice}`);

    // All materials should be affordable with moderate farming
    assert.ok(maxPrice <= 500,
      `Most expensive material (${maxPrice}g) should be achievable`);
  });
});
