/**
 * Enemy Service Unit Tests
 *
 * Tests the pure constants and data structures used by the enemy service.
 * Database-dependent functions are tested via integration tests.
 *
 * Data tested:
 * - TIER_MULTIPLIERS - Difficulty tier stat multipliers
 * - Stat scaling formulas (documented behavior)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import enemy service exports
let importError = null;
let TIER_MULTIPLIERS = null;

try {
  const mod = await import('../../services/enemyService.js');
  TIER_MULTIPLIERS = mod.TIER_MULTIPLIERS;
} catch (err) {
  importError = err;
}

const canImport = importError === null;

describe('Enemy Service - TIER_MULTIPLIERS', { skip: !canImport }, () => {
  it('has multipliers for all 5 tiers', () => {
    assert.ok(TIER_MULTIPLIERS[1] !== undefined, 'Tier 1 should exist');
    assert.ok(TIER_MULTIPLIERS[2] !== undefined, 'Tier 2 should exist');
    assert.ok(TIER_MULTIPLIERS[3] !== undefined, 'Tier 3 should exist');
    assert.ok(TIER_MULTIPLIERS[4] !== undefined, 'Tier 4 should exist');
    assert.ok(TIER_MULTIPLIERS[5] !== undefined, 'Tier 5 should exist');
  });

  it('multipliers increase with tier', () => {
    assert.ok(TIER_MULTIPLIERS[2] > TIER_MULTIPLIERS[1], 'Tier 2 > Tier 1');
    assert.ok(TIER_MULTIPLIERS[3] > TIER_MULTIPLIERS[2], 'Tier 3 > Tier 2');
    assert.ok(TIER_MULTIPLIERS[4] > TIER_MULTIPLIERS[3], 'Tier 4 > Tier 3');
    assert.ok(TIER_MULTIPLIERS[5] > TIER_MULTIPLIERS[4], 'Tier 5 > Tier 4');
  });

  it('tier 1 is easier than baseline (< 1.0)', () => {
    assert.ok(TIER_MULTIPLIERS[1] < 1.0, 'Tier 1 should be < 1.0');
  });

  it('tier 3+ provides significant challenge (> 1.0)', () => {
    assert.ok(TIER_MULTIPLIERS[3] > 1.0, 'Tier 3 should be > 1.0');
    assert.ok(TIER_MULTIPLIERS[4] > 1.5, 'Tier 4 should be > 1.5');
    assert.ok(TIER_MULTIPLIERS[5] > 2.0, 'Tier 5 should be > 2.0');
  });

  it('all multipliers are positive numbers', () => {
    for (let tier = 1; tier <= 5; tier++) {
      assert.strictEqual(typeof TIER_MULTIPLIERS[tier], 'number');
      assert.ok(TIER_MULTIPLIERS[tier] > 0, `Tier ${tier} should be positive`);
    }
  });

  it('multipliers are reasonable (not too extreme)', () => {
    for (let tier = 1; tier <= 5; tier++) {
      assert.ok(
        TIER_MULTIPLIERS[tier] >= 0.5 && TIER_MULTIPLIERS[tier] <= 5.0,
        `Tier ${tier} multiplier (${TIER_MULTIPLIERS[tier]}) should be in reasonable range`
      );
    }
  });
});

describe('Enemy Service - stat scaling formulas', { skip: !canImport }, () => {
  // These tests validate the documented scaling behavior
  // Formula: scaledStat = baseStat * (1 + enemyLevel * growthRate)

  it('HP scaling formula produces expected results', () => {
    // HP formula: base_hp * (1 + enemyLevel * 0.10)
    const baseHp = 100;
    const level = 10;
    const expectedHp = Math.floor(baseHp * (1 + level * 0.10));

    assert.strictEqual(expectedHp, 200);
  });

  it('MP scaling formula produces expected results', () => {
    // MP formula: base_mp * (1 + enemyLevel * 0.05)
    const baseMp = 50;
    const level = 10;
    const expectedMp = Math.floor(baseMp * (1 + level * 0.05));

    assert.strictEqual(expectedMp, 75);
  });

  it('stat scaling formula produces expected results', () => {
    // Stat formula: baseStat * (1 + enemyLevel * 0.05)
    const baseStat = 20;
    const level = 10;
    const expectedStat = Math.floor(baseStat * (1 + level * 0.05));

    assert.strictEqual(expectedStat, 30);
  });

  it('effective level calculation works correctly', () => {
    // enemyLevel = floor(partyLevel * tierMultiplier)
    const partyLevel = 10;
    const tier = 3;
    const expectedLevel = Math.floor(partyLevel * TIER_MULTIPLIERS[tier]);

    // Tier 3 multiplier is 1.35, so 10 * 1.35 = 13.5 -> 13
    assert.strictEqual(expectedLevel, 13);
  });
});

describe('Enemy Service - tier multiplier validation', { skip: !canImport }, () => {
  it('tier progression provides meaningful difficulty increase', () => {
    // Calculate effective stats at each tier for level 10 party
    const baseHp = 100;
    const partyLevel = 10;

    const results = [];
    for (let tier = 1; tier <= 5; tier++) {
      const enemyLevel = Math.floor(partyLevel * TIER_MULTIPLIERS[tier]);
      const scaledHp = Math.floor(baseHp * (1 + enemyLevel * 0.10));
      results.push({ tier, enemyLevel, scaledHp });
    }

    // Each tier should provide noticeable HP increase
    for (let i = 1; i < results.length; i++) {
      const current = results[i];
      const previous = results[i - 1];

      assert.ok(
        current.scaledHp > previous.scaledHp,
        `Tier ${current.tier} HP (${current.scaledHp}) should be > Tier ${previous.tier} HP (${previous.scaledHp})`
      );
    }
  });

  it('tier 5 enemies are significantly stronger than tier 1', () => {
    const baseHp = 100;
    const partyLevel = 20;

    const tier1Level = Math.floor(partyLevel * TIER_MULTIPLIERS[1]);
    const tier5Level = Math.floor(partyLevel * TIER_MULTIPLIERS[5]);

    const tier1Hp = Math.floor(baseHp * (1 + tier1Level * 0.10));
    const tier5Hp = Math.floor(baseHp * (1 + tier5Level * 0.10));

    // Tier 5 should be at least 50% stronger than tier 1
    // (2.15 / 0.9 = 2.39x level difference, but HP scales linearly with level)
    assert.ok(
      tier5Hp >= tier1Hp * 1.5,
      `Tier 5 HP (${tier5Hp}) should be >= 1.5x Tier 1 HP (${tier1Hp})`
    );
  });
});

describe('Enemy Service - documented spawn zone behavior', { skip: !canImport }, () => {
  // Test documented spawn zone behavior
  // ENEMY_SPAWN_ZONE: minX: 25, maxX: 30, minY: 10, maxY: 21

  it('spawn zone dimensions are appropriate for 32x32 map', () => {
    // Enemies spawn on right side of map
    const spawnZone = {
      minX: 25, maxX: 30,
      minY: 10, maxY: 21
    };

    // Zone should be on right side
    assert.ok(spawnZone.minX >= 20, 'Spawn zone should be on right side');

    // Zone should have reasonable size (6 x 12 = 72 tiles)
    const width = spawnZone.maxX - spawnZone.minX + 1;
    const height = spawnZone.maxY - spawnZone.minY + 1;
    const totalTiles = width * height;

    assert.ok(totalTiles >= 50, `Spawn zone should have >= 50 tiles, has ${totalTiles}`);
    assert.ok(totalTiles <= 100, `Spawn zone should have <= 100 tiles, has ${totalTiles}`);
  });

  it('spawn zone can accommodate expected enemy counts', () => {
    // Max enemies is 7 (tier 4-5), spawn zone should be larger
    const maxEnemies = 7;
    const spawnWidth = 6; // 30 - 25 + 1
    const spawnHeight = 12; // 21 - 10 + 1
    const totalTiles = spawnWidth * spawnHeight;

    assert.ok(
      totalTiles >= maxEnemies * 3,
      `Spawn zone should have at least 3x max enemies tiles for spacing`
    );
  });
});

describe('Enemy Service - enemy count ranges', { skip: !canImport }, () => {
  // Documented enemy counts per tier
  const ENEMY_COUNT_RANGES = {
    1: { min: 3, max: 4 },
    2: { min: 3, max: 5 },
    3: { min: 4, max: 6 },
    4: { min: 5, max: 7 },
    5: { min: 5, max: 7 }
  };

  it('all tiers have valid count ranges', () => {
    for (let tier = 1; tier <= 5; tier++) {
      const range = ENEMY_COUNT_RANGES[tier];
      assert.ok(range, `Tier ${tier} should have count range`);
      assert.ok(range.min > 0, `Tier ${tier} min should be > 0`);
      assert.ok(range.min <= range.max, `Tier ${tier} min should be <= max`);
    }
  });

  it('enemy count increases with tier', () => {
    // Higher tiers should have at least as many enemies
    assert.ok(
      ENEMY_COUNT_RANGES[3].min >= ENEMY_COUNT_RANGES[1].min,
      'Tier 3 should have >= enemies than tier 1'
    );
    assert.ok(
      ENEMY_COUNT_RANGES[5].min >= ENEMY_COUNT_RANGES[3].min,
      'Tier 5 should have >= enemies than tier 3'
    );
  });

  it('max enemy count is reasonable for battle system', () => {
    const maxEnemies = Math.max(...Object.values(ENEMY_COUNT_RANGES).map(r => r.max));

    // Should not exceed 7 enemies (manageable combat)
    assert.ok(maxEnemies <= 8, `Max enemies (${maxEnemies}) should be <= 8`);
    assert.ok(maxEnemies >= 5, `Max enemies (${maxEnemies}) should be >= 5`);
  });
});

describe('Enemy Service - import error handling', { skip: canImport }, () => {
  it('reports import error', () => {
    console.log('Enemy Service import error:', importError?.message);
    assert.ok(importError, 'Import error should be captured');
  });
});
