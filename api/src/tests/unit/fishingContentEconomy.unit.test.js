import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ALL_FISH_TYPES,
  BIG_CATCH_RARITY_WEIGHTS,
  FISH_TYPES,
  NORMAL_RARITY_WEIGHTS,
  REGION_FISH_POOLS,
  calculateFishValue,
  getFishById,
  getPublicFishPool,
  getWaitDurationMs,
  normalizeBiome,
  selectFishForCatch
} from '../../db/templates/fish.js';
import {
  FISHING_GEAR,
  RODS,
  TACKLE,
  getRodByKey,
  getTackleByKey
} from '../../db/templates/fishingGear.js';
import { ENEMY_TEMPLATES } from '../../db/templates/enemies.js';
import { generateCaravanInventory } from '../../services/caravanService.js';
import {
  rollFixedDrops,
  storeDroppedItem
} from '../../services/itemDropService.js';

const EXPECTED_POOLS = {
  heartlands: ['bass', 'carp', 'bream', 'pike', 'golden_koi', 'ancient_carp', 'leviathan_scale'],
  sylvan_reaches: ['trout', 'perch', 'salmon', 'golden_koi', 'moonfish', 'sea_dragon', 'leviathan_scale'],
  iron_depths: ['blind_cavefish', 'catfish', 'eel', 'electric_eel', 'crystal_sturgeon', 'ancient_carp', 'leviathan_scale'],
  shadowmere: ['dusk_bream', 'eel', 'bloodfin', 'moonfish', 'electric_eel', 'sea_dragon', 'leviathan_scale'],
  bloodplains: ['ash_perch', 'carp', 'pike', 'ember_koi', 'ironjaw_sturgeon', 'sea_dragon', 'leviathan_scale']
};

describe('fishing fish catalog', () => {
  it('preserves all legacy IDs and adds the canonical regional pools', () => {
    assert.equal(FISH_TYPES.length, 15);
    assert.equal(ALL_FISH_TYPES.length, 22);

    for (const [biome, expectedIds] of Object.entries(EXPECTED_POOLS)) {
      assert.deepEqual(REGION_FISH_POOLS[biome], expectedIds);
      assert.deepEqual(getPublicFishPool(biome).map(fish => fish.id), expectedIds);
    }
    assert.equal(getFishById('blind_cavefish')?.name, 'Blind Cavefish');
  });

  it('normalizes region_race values and safely falls back to Common Waters', () => {
    assert.equal(normalizeBiome('human'), 'heartlands');
    assert.equal(normalizeBiome('Sylvan Reaches'), 'sylvan_reaches');
    assert.equal(normalizeBiome('dwarf'), 'iron_depths');
    assert.equal(normalizeBiome('vampire'), 'shadowmere');
    assert.equal(normalizeBiome('orc'), 'bloodplains');
    assert.equal(normalizeBiome(null), 'common_waters');
    assert.equal(normalizeBiome('future_region'), 'common_waters');
  });

  it('uses the exact normal and Big Catch rarity weights', () => {
    assert.deepEqual(NORMAL_RARITY_WEIGHTS.near, { common: 80, uncommon: 19, rare: 1 });
    assert.deepEqual(NORMAL_RARITY_WEIGHTS.mid, { common: 60, uncommon: 32, rare: 7, epic: 1 });
    assert.deepEqual(NORMAL_RARITY_WEIGHTS.deep, { common: 45, uncommon: 40, rare: 14, epic: 1 });
    assert.deepEqual(BIG_CATCH_RARITY_WEIGHTS, { rare: 70, epic: 25, legendary: 5 });

    assert.equal(selectFishForCatch({ biome: 'human', depth: 'near', random: () => 0.799 }).rarity, 'common');
    assert.equal(selectFishForCatch({ biome: 'human', depth: 'near', random: () => 0.80 }).rarity, 'uncommon');
    assert.equal(selectFishForCatch({ biome: 'human', depth: 'near', random: () => 0.995 }).rarity, 'rare');
    assert.equal(selectFishForCatch({ biome: 'human', depth: 'mid', random: () => 0.995 }).rarity, 'epic');
    assert.equal(selectFishForCatch({ biome: 'human', depth: 'deep', random: () => 0.995 }).rarity, 'epic');
    assert.equal(selectFishForCatch({ biome: 'human', isBigCatch: true, random: () => 0.69 }).rarity, 'rare');
    assert.equal(selectFishForCatch({ biome: 'human', isBigCatch: true, random: () => 0.70 }).rarity, 'epic');
    assert.equal(selectFishForCatch({ biome: 'human', isBigCatch: true, random: () => 0.96 }).rarity, 'legendary');
  });

  it('keeps legendary fish out of every normal depth', () => {
    for (const biome of Object.keys(EXPECTED_POOLS)) {
      for (const depth of ['near', 'mid', 'deep']) {
        for (let step = 0; step < 100; step++) {
          const random = () => (step + 0.5) / 100;
          assert.notEqual(
            selectFishForCatch({ biome, depth, random }).rarity,
            'legendary'
          );
        }
      }
    }
  });

  it('uses the requested value bands and normalizes regional expectation', () => {
    const bands = {
      common: [2, 3],
      uncommon: [4, 6],
      rare: [14, 16],
      epic: [40, 50],
      legendary: [120, 120]
    };
    for (const fish of ALL_FISH_TYPES) {
      const [min, max] = bands[fish.rarity];
      assert.ok(fish.baseValue >= min && fish.baseValue <= max, fish.id);
    }

    for (const depth of ['near', 'mid', 'deep']) {
      const expectations = Object.keys(EXPECTED_POOLS).map(biome => {
        const fish = getPublicFishPool(biome);
        return Object.entries(NORMAL_RARITY_WEIGHTS[depth]).reduce((total, [rarity, weight]) => {
          const values = fish.filter(entry => entry.rarity === rarity).map(entry => entry.baseValue);
          return total + ((values.reduce((sum, value) => sum + value, 0) / values.length) * weight / 100);
        }, 0);
      });
      const mean = expectations.reduce((sum, value) => sum + value, 0) / expectations.length;
      for (const expected of expectations) {
        assert.ok(Math.abs(expected - mean) / mean <= 0.10, `${depth}: ${expected} vs ${mean}`);
      }
    }
  });

  it('applies Big Catch, size, and difficulty value modifiers', () => {
    const fish = { baseValue: 100 };
    assert.equal(calculateFishValue(fish, 1, false, 1), 100);
    assert.equal(calculateFishValue(fish, 1.25, false, 1), 125);
    assert.equal(calculateFishValue(fish, 1, true, 1), 200);
    assert.equal(calculateFishValue(fish, 1, false, 3), 110);
    assert.equal(calculateFishValue(fish, 1.5, true, 3), 330);
  });
});

describe('fishing gear and caravan policies', () => {
  it('defines stable rod and tackle contracts', () => {
    assert.deepEqual(RODS.map(rod => rod.bigCatchLandingRate), [0.10, 0.20, 0.50, 0.85]);
    assert.deepEqual(RODS.map(rod => rod.basePrice), [40, 250, 1250, 5000]);
    assert.deepEqual(TACKLE.map(item => item.waitReduction), [0.15, 0.30, 0.50, 0.75]);
    assert.deepEqual(TACKLE.map(item => item.basePrice), [1, 3, 10, 40]);
    assert.equal(new Set(FISHING_GEAR.map(item => item.catalogKey)).size, 8);
    assert.deepEqual(
      RODS.map(rod => rod.catalogKey),
      ['fishing:rod:weathered', 'fishing:rod:riverwood', 'fishing:rod:silverline', 'fishing:rod:runebound']
    );
    assert.equal(getRodByKey('fishing:rod:runebound')?.bigCatchLandingRate, 0.85);
    assert.equal(getTackleByKey('fishing:tackle:abyssal_lure')?.waitReduction, 0.75);
    assert.ok(RODS.every(rod => rod.type === 'key_item'));
    assert.ok(TACKLE.every(item => item.type === 'material'));
    assert.ok(FISHING_GEAR.every(item => item.isTradeable === false));
  });

  it('applies tackle wait reductions to the same authoritative base roll', () => {
    assert.equal(getWaitDurationMs(null, () => 0), 35000);
    assert.equal(getWaitDurationMs('earthworm', () => 0), 29750);
    assert.equal(getWaitDurationMs('slime_slug', () => 0), 24500);
    assert.equal(getWaitDurationMs('gilded_spinner', () => 0), 17500);
    assert.equal(getWaitDurationMs('abyssal_lure', () => 0), 8750);
  });

  it('uses the persisted tackle reduction snapshot for an in-flight cast', () => {
    assert.equal(getWaitDurationMs('earthworm', () => 0, 0.75), 8750);
  });

  it('always stocks unlimited baseline gear and exact finite rod stock', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const inventory = generateCaravanInventory(seed, 'human');
      for (const itemId of ['weathered_rod', 'earthworm']) {
        const item = inventory.find(entry => entry.itemId === itemId);
        assert.ok(item, `${itemId} missing for seed ${seed}`);
        assert.equal(item.unlimitedStock, true);
        assert.equal(item.quantity, null);
      }
      for (const [itemId, stock] of [['riverwood_rod', 3], ['silverline_rod', 2], ['runebound_rod', 1]]) {
        const item = inventory.find(entry => entry.itemId === itemId);
        if (item) assert.equal(item.quantity, stock);
      }
    }
  });

  it('retains explicit deterministic inclusion probabilities', () => {
    const counts = new Map(FISHING_GEAR.map(item => [item.id, 0]));
    const samples = 4000;
    for (let seed = 1; seed <= samples; seed++) {
      for (const item of generateCaravanInventory(seed, 'elf')) {
        if (counts.has(item.itemId)) counts.set(item.itemId, counts.get(item.itemId) + 1);
      }
    }

    for (const item of FISHING_GEAR) {
      const observed = counts.get(item.id) / samples;
      const expected = item.alwaysStock ? 1 : item.inclusionChance;
      assert.ok(Math.abs(observed - expected) <= 0.035, `${item.id}: ${observed}`);
    }
  });
});

describe('fixed tackle drops', () => {
  const expected = {
    'Forest Slime': ['fishing:tackle:slime_slug', 0.02],
    Harpy: ['fishing:tackle:earthworm', 0.03],
    'Bridge Bandit': ['fishing:tackle:gilded_spinner', 0.01],
    'Bridge Troll': ['fishing:tackle:abyssal_lure', 0.005]
  };

  it('declares the exact enemy-specific independent drop chances', () => {
    for (const [enemyName, [catalogKey, chance]] of Object.entries(expected)) {
      const enemy = ENEMY_TEMPLATES.find(template => template.name === enemyName);
      assert.deepEqual(enemy.drop_table.fixedDrops, [{ catalogKey, chance }]);
    }
  });

  it('rolls fixed drops without difficulty, rarity, or augment generation', () => {
    for (const [enemyName, [catalogKey, chance]] of Object.entries(expected)) {
      const template = ENEMY_TEMPLATES.find(enemy => enemy.name === enemyName);
      const enemy = { dropTable: template.drop_table, level: 99 };
      const landed = rollFixedDrops(enemy, () => chance / 2);
      const missed = rollFixedDrops(enemy, () => chance);

      assert.equal(landed.length, 1);
      assert.equal(landed[0].catalogKey, catalogKey);
      assert.equal(landed[0].rarityId, getTackleByKey(catalogKey).rarityId);
      assert.deepEqual(landed[0].augments, []);
      assert.equal(landed[0].generationSeed, null);
      assert.deepEqual(missed, []);
    }
  });

  it('resolves and stacks fixed drops through the caller transaction', async () => {
    const calls = [];
    let quantity = 0;
    const client = {
      async query(sql, params) {
        const compact = sql.replace(/\s+/g, ' ').trim();
        calls.push({ sql: compact, params });
        if (compact.startsWith('INSERT INTO item_templates')) return { rows: [{ id: 901 }] };
        if (compact.startsWith('SELECT id FROM character_items')) {
          return { rows: quantity > 0 ? [{ id: 902 }] : [] };
        }
        if (compact.startsWith('INSERT INTO character_items')) {
          quantity = 1;
          return { rows: [] };
        }
        if (compact.startsWith('UPDATE character_items')) {
          quantity += 1;
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${compact}`);
      }
    };
    const enemy = {
      dropTable: {
        fixedDrops: [{ catalogKey: 'fishing:tackle:earthworm', chance: 1 }]
      }
    };

    await storeDroppedItem(7, rollFixedDrops(enemy, () => 0)[0], client);
    await storeDroppedItem(7, rollFixedDrops(enemy, () => 0)[0], client);

    assert.equal(quantity, 2);
    assert.equal(calls[0].params[0], 'fishing:tackle:earthworm');
    assert.ok(calls.some(call => call.sql.endsWith('FOR UPDATE')));
    assert.equal(calls.filter(call => call.sql.startsWith('INSERT INTO item_templates')).length, 2);
  });
});
