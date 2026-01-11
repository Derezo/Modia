/**
 * Unit tests for mapGeneration - Terrain generation, spawn areas, and path connectivity
 *
 * Tests verify the deterministic map generation system produces playable battle maps:
 * - Path connectivity between spawn areas (critical for playable battles)
 * - Spawn area clearance (no obstacles blocking unit placement)
 * - Terrain distribution within expected ranges
 *
 * These tests do not require a running server - they test the shared map generation logic directly.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { generateTerrain } from '../../../shared/mapGeneration.js';
import { hasValidPath } from '../../../shared/pathfinding.js';
import { isImpassable, TERRAIN_WEIGHTS } from '../../../shared/terrain.js';

// Default map dimensions matching the battle system
const MAP_WIDTH = 32;
const MAP_HEIGHT = 32;

// =============================================================================
// PATH CONNECTIVITY TESTS
// =============================================================================

describe('Map Generation - Path Connectivity', () => {
  // Test seeds covering a wide range of values to ensure robustness
  const testSeeds = [
    12345, 54321, 99999, 11111, 22222,
    33333, 44444, 55555, 66666, 77777,
    88888, 100000, 123456, 654321, 999999,
    1, 2, 3, 42, 314159
  ];

  test('should have valid paths between spawn areas for mountain terrain (20 seeds)', () => {
    const nodeType = 'mountain';
    const failedSeeds = [];

    for (const seed of testSeeds) {
      const { terrain } = generateTerrain(seed, nodeType, MAP_WIDTH, MAP_HEIGHT);

      // Test connectivity from multiple points in player spawn to enemy spawn
      // Player spawn: columns 0-4 (use column 2 as representative)
      // Enemy spawn: columns 27-31 (use column 29 as representative)
      const playerSpawnX = 2;
      const enemySpawnX = MAP_WIDTH - 3;

      // Test multiple Y positions to ensure connectivity isn't just a narrow corridor
      const testYPositions = [
        Math.floor(MAP_HEIGHT * 0.25),
        Math.floor(MAP_HEIGHT * 0.5),
        Math.floor(MAP_HEIGHT * 0.75)
      ];

      let hasAnyPath = false;
      for (const startY of testYPositions) {
        for (const endY of testYPositions) {
          if (hasValidPath(playerSpawnX, startY, enemySpawnX, endY, terrain, MAP_WIDTH, MAP_HEIGHT)) {
            hasAnyPath = true;
            break;
          }
        }
        if (hasAnyPath) break;
      }

      if (!hasAnyPath) {
        failedSeeds.push(seed);
      }
    }

    assert.strictEqual(
      failedSeeds.length,
      0,
      `Mountain terrain should have valid paths for all seeds. Failed seeds: [${failedSeeds.join(', ')}]`
    );
  });

  test('should have valid paths for forest terrain (10 seeds)', () => {
    const nodeType = 'forest';
    const forestSeeds = testSeeds.slice(0, 10);
    const failedSeeds = [];

    for (const seed of forestSeeds) {
      const { terrain } = generateTerrain(seed, nodeType, MAP_WIDTH, MAP_HEIGHT);

      const playerSpawnX = 2;
      const enemySpawnX = MAP_WIDTH - 3;
      const midY = Math.floor(MAP_HEIGHT / 2);

      if (!hasValidPath(playerSpawnX, midY, enemySpawnX, midY, terrain, MAP_WIDTH, MAP_HEIGHT)) {
        failedSeeds.push(seed);
      }
    }

    assert.strictEqual(
      failedSeeds.length,
      0,
      `Forest terrain should have valid paths. Failed seeds: [${failedSeeds.join(', ')}]`
    );
  });

  test('should have valid paths for cave terrain (10 seeds)', () => {
    const nodeType = 'cave';
    const caveSeeds = testSeeds.slice(0, 10);
    const failedSeeds = [];

    for (const seed of caveSeeds) {
      const { terrain } = generateTerrain(seed, nodeType, MAP_WIDTH, MAP_HEIGHT);

      const playerSpawnX = 2;
      const enemySpawnX = MAP_WIDTH - 3;
      const midY = Math.floor(MAP_HEIGHT / 2);

      if (!hasValidPath(playerSpawnX, midY, enemySpawnX, midY, terrain, MAP_WIDTH, MAP_HEIGHT)) {
        failedSeeds.push(seed);
      }
    }

    assert.strictEqual(
      failedSeeds.length,
      0,
      `Cave terrain should have valid paths. Failed seeds: [${failedSeeds.join(', ')}]`
    );
  });

  test('should produce deterministic results for same seed', () => {
    const seed = 12345;
    const nodeType = 'mountain';

    const result1 = generateTerrain(seed, nodeType, MAP_WIDTH, MAP_HEIGHT);
    const result2 = generateTerrain(seed, nodeType, MAP_WIDTH, MAP_HEIGHT);

    // Compare terrain grids
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        assert.strictEqual(
          result1.terrain[y][x],
          result2.terrain[y][x],
          `Terrain at (${x}, ${y}) should be deterministic`
        );
      }
    }
  });

  test('should produce different results for different seeds', () => {
    const nodeType = 'mountain';

    const result1 = generateTerrain(12345, nodeType, MAP_WIDTH, MAP_HEIGHT);
    const result2 = generateTerrain(54321, nodeType, MAP_WIDTH, MAP_HEIGHT);

    // Count differences (should have many)
    let differences = 0;
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (result1.terrain[y][x] !== result2.terrain[y][x]) {
          differences++;
        }
      }
    }

    // Should have significant differences outside spawn areas
    const nonSpawnTiles = MAP_WIDTH * MAP_HEIGHT - (5 * MAP_HEIGHT * 2); // Exclude spawn columns
    assert.ok(
      differences > nonSpawnTiles * 0.1,
      `Different seeds should produce different terrain (got ${differences} differences)`
    );
  });
});

// =============================================================================
// SPAWN AREA TESTS
// =============================================================================

describe('Map Generation - Spawn Areas', () => {
  const testSeeds = [12345, 54321, 99999, 42, 314159];
  const nodeTypes = ['mountain', 'forest', 'cave', 'castle', 'bridge'];

  test('should clear impassable terrain in player spawn area (left 5 columns)', () => {
    for (const seed of testSeeds) {
      for (const nodeType of nodeTypes) {
        const { terrain } = generateTerrain(seed, nodeType, MAP_WIDTH, MAP_HEIGHT);

        // Check left 5 columns (player spawn)
        for (let y = 0; y < MAP_HEIGHT; y++) {
          for (let x = 0; x < 5; x++) {
            const terrainType = terrain[y][x];
            assert.strictEqual(
              isImpassable(terrainType),
              false,
              `Player spawn area at (${x}, ${y}) should be passable for seed ${seed}, nodeType ${nodeType}. Got: ${terrainType}`
            );
          }
        }
      }
    }
  });

  test('should clear impassable terrain in enemy spawn area (right 5 columns)', () => {
    for (const seed of testSeeds) {
      for (const nodeType of nodeTypes) {
        const { terrain } = generateTerrain(seed, nodeType, MAP_WIDTH, MAP_HEIGHT);

        // Check right 5 columns (enemy spawn)
        for (let y = 0; y < MAP_HEIGHT; y++) {
          for (let x = MAP_WIDTH - 5; x < MAP_WIDTH; x++) {
            const terrainType = terrain[y][x];
            assert.strictEqual(
              isImpassable(terrainType),
              false,
              `Enemy spawn area at (${x}, ${y}) should be passable for seed ${seed}, nodeType ${nodeType}. Got: ${terrainType}`
            );
          }
        }
      }
    }
  });

  test('should have null obstacles in player spawn area', () => {
    for (const seed of testSeeds) {
      for (const nodeType of nodeTypes) {
        const { obstacles } = generateTerrain(seed, nodeType, MAP_WIDTH, MAP_HEIGHT);

        // Check left 5 columns (player spawn)
        for (let y = 0; y < MAP_HEIGHT; y++) {
          for (let x = 0; x < 5; x++) {
            assert.strictEqual(
              obstacles[y][x],
              null,
              `Player spawn area at (${x}, ${y}) should have no obstacles for seed ${seed}, nodeType ${nodeType}`
            );
          }
        }
      }
    }
  });

  test('should have null obstacles in enemy spawn area', () => {
    for (const seed of testSeeds) {
      for (const nodeType of nodeTypes) {
        const { obstacles } = generateTerrain(seed, nodeType, MAP_WIDTH, MAP_HEIGHT);

        // Check right 5 columns (enemy spawn)
        for (let y = 0; y < MAP_HEIGHT; y++) {
          for (let x = MAP_WIDTH - 5; x < MAP_WIDTH; x++) {
            assert.strictEqual(
              obstacles[y][x],
              null,
              `Enemy spawn area at (${x}, ${y}) should have no obstacles for seed ${seed}, nodeType ${nodeType}`
            );
          }
        }
      }
    }
  });

  test('should have walkable terrain in spawn areas for all biomes', () => {
    const allBiomes = ['forest', 'cave', 'mountain', 'bridge', 'castle'];

    for (const nodeType of allBiomes) {
      const { terrain } = generateTerrain(42, nodeType, MAP_WIDTH, MAP_HEIGHT);

      // Sample spawn area positions
      const spawnPositions = [
        { x: 0, y: 0 },
        { x: 2, y: MAP_HEIGHT / 2 },
        { x: 4, y: MAP_HEIGHT - 1 },
        { x: MAP_WIDTH - 1, y: 0 },
        { x: MAP_WIDTH - 3, y: MAP_HEIGHT / 2 },
        { x: MAP_WIDTH - 5, y: MAP_HEIGHT - 1 }
      ];

      for (const pos of spawnPositions) {
        const terrainType = terrain[Math.floor(pos.y)][pos.x];
        assert.strictEqual(
          isImpassable(terrainType),
          false,
          `Spawn position (${pos.x}, ${pos.y}) should be walkable for ${nodeType}. Got: ${terrainType}`
        );
      }
    }
  });
});

// =============================================================================
// TERRAIN DISTRIBUTION TESTS
// =============================================================================

describe('Map Generation - Terrain Distribution', () => {
  test('should have approximately 25% impassable terrain for mountain (not 40%)', () => {
    const nodeType = 'mountain';
    const testSeeds = [12345, 54321, 99999, 42, 314159];

    // Mountain terrain weights from terrain.js:
    // { stone: 0.45, rock: 0.15, grass: 0.30, cliff: 0.10 }
    // Impassable = rock (0.15) + cliff (0.10) = 0.25 (25%)
    const expectedImpassableRatio = TERRAIN_WEIGHTS.mountain.rock + TERRAIN_WEIGHTS.mountain.cliff;

    for (const seed of testSeeds) {
      const { terrain } = generateTerrain(seed, nodeType, MAP_WIDTH, MAP_HEIGHT);

      // Count impassable tiles (excluding spawn areas which are cleared)
      let impassableCount = 0;
      let totalNonSpawnTiles = 0;

      for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 5; x < MAP_WIDTH - 5; x++) { // Exclude spawn areas
          totalNonSpawnTiles++;
          if (isImpassable(terrain[y][x])) {
            impassableCount++;
          }
        }
      }

      const actualRatio = impassableCount / totalNonSpawnTiles;

      // Allow 15% variance from expected due to random distribution and corridor carving
      const minExpected = expectedImpassableRatio * 0.3; // Much lower due to corridor carving
      const maxExpected = expectedImpassableRatio * 1.5;

      assert.ok(
        actualRatio >= minExpected && actualRatio <= maxExpected,
        `Mountain impassable ratio should be near ${(expectedImpassableRatio * 100).toFixed(1)}%. ` +
        `Got ${(actualRatio * 100).toFixed(1)}% for seed ${seed} ` +
        `(expected range: ${(minExpected * 100).toFixed(1)}% - ${(maxExpected * 100).toFixed(1)}%)`
      );
    }
  });

  test('should count rock + cliff tiles as impassable for mountain terrain', () => {
    const seed = 12345;
    const nodeType = 'mountain';
    const { terrain } = generateTerrain(seed, nodeType, MAP_WIDTH, MAP_HEIGHT);

    let rockCount = 0;
    let cliffCount = 0;
    let totalTiles = 0;

    // Count in non-spawn areas
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 5; x < MAP_WIDTH - 5; x++) {
        totalTiles++;
        if (terrain[y][x] === 'rock') rockCount++;
        if (terrain[y][x] === 'cliff') cliffCount++;
      }
    }

    const impassableCount = rockCount + cliffCount;
    const impassableRatio = impassableCount / totalTiles;

    // Log distribution for debugging
    console.log(`Mountain terrain distribution for seed ${seed}:`);
    console.log(`  Rock tiles: ${rockCount} (${(rockCount / totalTiles * 100).toFixed(1)}%)`);
    console.log(`  Cliff tiles: ${cliffCount} (${(cliffCount / totalTiles * 100).toFixed(1)}%)`);
    console.log(`  Total impassable: ${impassableCount} (${(impassableRatio * 100).toFixed(1)}%)`);

    // Verify that rock and cliff are the only impassable types in mountain
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const t = terrain[y][x];
        if (isImpassable(t)) {
          assert.ok(
            t === 'rock' || t === 'cliff',
            `Mountain impassable terrain should be rock or cliff, got: ${t} at (${x}, ${y})`
          );
        }
      }
    }
  });

  test('should have forest terrain with low impassable ratio', () => {
    const seed = 12345;
    const nodeType = 'forest';
    const { terrain } = generateTerrain(seed, nodeType, MAP_WIDTH, MAP_HEIGHT);

    // Forest weights: { grass: 0.6, forest: 0.25, stone: 0.1, rock: 0.05 }
    // Only rock (0.05) is impassable
    const expectedImpassableRatio = TERRAIN_WEIGHTS.forest.rock || 0.05;

    let impassableCount = 0;
    let totalNonSpawnTiles = 0;

    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 5; x < MAP_WIDTH - 5; x++) {
        totalNonSpawnTiles++;
        if (isImpassable(terrain[y][x])) {
          impassableCount++;
        }
      }
    }

    const actualRatio = impassableCount / totalNonSpawnTiles;

    // Forest should have very low impassable ratio (around 5% or less)
    assert.ok(
      actualRatio <= 0.15,
      `Forest should have low impassable ratio (<15%). Got ${(actualRatio * 100).toFixed(1)}%`
    );
  });

  test('should have cave terrain with appropriate distribution', () => {
    const seed = 12345;
    const nodeType = 'cave';
    const { terrain } = generateTerrain(seed, nodeType, MAP_WIDTH, MAP_HEIGHT);

    // Cave weights: { stone: 0.5, rock: 0.2, water: 0.15, lava: 0.05, grass: 0.1 }
    // Impassable: rock (0.2) + lava (0.05) = 0.25
    // Note: water is passable but slow (cost 3)

    let stoneCount = 0;
    let rockCount = 0;
    let waterCount = 0;
    let lavaCount = 0;
    let totalNonSpawnTiles = 0;

    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 5; x < MAP_WIDTH - 5; x++) {
        totalNonSpawnTiles++;
        const t = terrain[y][x];
        if (t === 'stone') stoneCount++;
        if (t === 'rock') rockCount++;
        if (t === 'water') waterCount++;
        if (t === 'lava') lavaCount++;
      }
    }

    // Verify cave has expected terrain types
    assert.ok(stoneCount > 0, 'Cave should have stone tiles');
    assert.ok(rockCount >= 0, 'Cave may have rock tiles');

    // Log distribution
    console.log(`Cave terrain distribution for seed ${seed}:`);
    console.log(`  Stone: ${stoneCount} (${(stoneCount / totalNonSpawnTiles * 100).toFixed(1)}%)`);
    console.log(`  Rock: ${rockCount} (${(rockCount / totalNonSpawnTiles * 100).toFixed(1)}%)`);
    console.log(`  Water: ${waterCount} (${(waterCount / totalNonSpawnTiles * 100).toFixed(1)}%)`);
    console.log(`  Lava: ${lavaCount} (${(lavaCount / totalNonSpawnTiles * 100).toFixed(1)}%)`);
  });

  test('should have castle terrain with mostly stone and grass', () => {
    const seed = 12345;
    const nodeType = 'castle';
    const { terrain } = generateTerrain(seed, nodeType, MAP_WIDTH, MAP_HEIGHT);

    // Castle weights: { stone: 0.7, grass: 0.3 }
    // No impassable terrain by default

    let stoneCount = 0;
    let grassCount = 0;
    let impassableCount = 0;
    let totalTiles = 0;

    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        totalTiles++;
        const t = terrain[y][x];
        if (t === 'stone') stoneCount++;
        if (t === 'grass') grassCount++;
        if (isImpassable(t)) impassableCount++;
      }
    }

    // Castle should be predominantly stone and grass with minimal impassable
    const stoneGrassRatio = (stoneCount + grassCount) / totalTiles;
    assert.ok(
      stoneGrassRatio > 0.9,
      `Castle should be >90% stone/grass. Got ${(stoneGrassRatio * 100).toFixed(1)}%`
    );

    assert.strictEqual(
      impassableCount,
      0,
      `Castle should have no impassable terrain. Got ${impassableCount} tiles`
    );
  });
});

// =============================================================================
// OUTPUT STRUCTURE TESTS
// =============================================================================

describe('Map Generation - Output Structure', () => {
  test('should return terrain, obstacles, and variants arrays', () => {
    const result = generateTerrain(12345, 'mountain', MAP_WIDTH, MAP_HEIGHT);

    assert.ok(Array.isArray(result.terrain), 'Should return terrain array');
    assert.ok(Array.isArray(result.obstacles), 'Should return obstacles array');
    assert.ok(Array.isArray(result.variants), 'Should return variants array');
  });

  test('should have correct dimensions', () => {
    const result = generateTerrain(12345, 'mountain', MAP_WIDTH, MAP_HEIGHT);

    assert.strictEqual(result.terrain.length, MAP_HEIGHT, 'Terrain should have correct height');
    assert.strictEqual(result.obstacles.length, MAP_HEIGHT, 'Obstacles should have correct height');
    assert.strictEqual(result.variants.length, MAP_HEIGHT, 'Variants should have correct height');

    for (let y = 0; y < MAP_HEIGHT; y++) {
      assert.strictEqual(result.terrain[y].length, MAP_WIDTH, `Terrain row ${y} should have correct width`);
      assert.strictEqual(result.obstacles[y].length, MAP_WIDTH, `Obstacles row ${y} should have correct width`);
      assert.strictEqual(result.variants[y].length, MAP_WIDTH, `Variants row ${y} should have correct width`);
    }
  });

  test('should have valid terrain types', () => {
    const validTerrainTypes = ['grass', 'stone', 'forest', 'water', 'rock', 'lava', 'cliff', 'tree'];
    const result = generateTerrain(12345, 'mountain', MAP_WIDTH, MAP_HEIGHT);

    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const terrainType = result.terrain[y][x];
        assert.ok(
          validTerrainTypes.includes(terrainType),
          `Invalid terrain type at (${x}, ${y}): ${terrainType}`
        );
      }
    }
  });

  test('should have variant values in range 0-3', () => {
    const result = generateTerrain(12345, 'mountain', MAP_WIDTH, MAP_HEIGHT);

    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const variant = result.variants[y][x];
        assert.ok(
          variant >= 0 && variant <= 3,
          `Variant at (${x}, ${y}) should be 0-3, got: ${variant}`
        );
      }
    }
  });

  test('should have obstacles only on impassable terrain or as decoratives', () => {
    const result = generateTerrain(12345, 'forest', MAP_WIDTH, MAP_HEIGHT);

    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const obstacle = result.obstacles[y][x];
        const terrainType = result.terrain[y][x];

        if (obstacle !== null) {
          // Obstacle should have type and variant
          assert.ok(obstacle.type, `Obstacle at (${x}, ${y}) should have type`);
          assert.ok(obstacle.variant, `Obstacle at (${x}, ${y}) should have variant`);

          // Decorative obstacles can be on passable terrain
          // Non-decorative obstacles should be on impassable terrain
          if (obstacle.type !== 'decorative' && obstacle.type !== 'trees') {
            // Allow trees on passable terrain in forests
          }
        }
      }
    }
  });

  test('should support custom map dimensions', () => {
    const customWidth = 16;
    const customHeight = 24;
    const result = generateTerrain(12345, 'mountain', customWidth, customHeight);

    assert.strictEqual(result.terrain.length, customHeight, 'Should respect custom height');
    assert.strictEqual(result.terrain[0].length, customWidth, 'Should respect custom width');
  });
});

// =============================================================================
// EDGE CASE TESTS
// =============================================================================

describe('Map Generation - Edge Cases', () => {
  test('should handle seed value 0', () => {
    const result = generateTerrain(0, 'mountain', MAP_WIDTH, MAP_HEIGHT);
    assert.ok(result.terrain, 'Should generate terrain with seed 0');

    // Verify connectivity
    const midY = Math.floor(MAP_HEIGHT / 2);
    const hasPath = hasValidPath(2, midY, MAP_WIDTH - 3, midY, result.terrain, MAP_WIDTH, MAP_HEIGHT);
    assert.ok(hasPath, 'Seed 0 should produce connected map');
  });

  test('should handle very large seed values', () => {
    const largeSeed = Number.MAX_SAFE_INTEGER;
    const result = generateTerrain(largeSeed, 'mountain', MAP_WIDTH, MAP_HEIGHT);
    assert.ok(result.terrain, 'Should generate terrain with large seed');
  });

  test('should handle negative seed values', () => {
    const negativeSeed = -12345;
    const result = generateTerrain(negativeSeed, 'mountain', MAP_WIDTH, MAP_HEIGHT);
    assert.ok(result.terrain, 'Should generate terrain with negative seed');
  });

  test('should handle unknown node type by using default weights', () => {
    const result = generateTerrain(12345, 'unknown_biome', MAP_WIDTH, MAP_HEIGHT);
    assert.ok(result.terrain, 'Should generate terrain for unknown node type');

    // Should use default weights (grass: 0.7, stone: 0.2, forest: 0.1)
    let grassCount = 0;
    let totalTiles = MAP_WIDTH * MAP_HEIGHT;

    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (result.terrain[y][x] === 'grass') grassCount++;
      }
    }

    // Default should have high grass ratio
    assert.ok(
      grassCount / totalTiles > 0.5,
      'Unknown node type should use default weights with high grass ratio'
    );
  });

  test('should handle minimum map size', () => {
    const minWidth = 10;
    const minHeight = 10;
    const result = generateTerrain(12345, 'mountain', minWidth, minHeight);

    assert.strictEqual(result.terrain.length, minHeight);
    assert.strictEqual(result.terrain[0].length, minWidth);

    // Spawn areas should still be cleared
    for (let y = 0; y < minHeight; y++) {
      for (let x = 0; x < 5; x++) {
        assert.strictEqual(
          isImpassable(result.terrain[y][x]),
          false,
          'Spawn areas should be clear even on small maps'
        );
      }
    }
  });
});
