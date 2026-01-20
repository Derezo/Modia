/**
 * Tests for SpawnPlacer - Tactical spawn positioning system
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  generateTerrain,
  generateSpawnPositions,
  validateSpawnPositions,
  SpawnPlacer,
  AI_SPAWN_CONFIGS
} from './mapGeneration.js';
import { isImpassable } from './terrain.js';

describe('SpawnPlacer', () => {
  let terrain;
  let obstacles;
  const seed = 12345;
  const width = 32;
  const height = 32;

  beforeEach(() => {
    const result = generateTerrain(seed, 'forest', width, height);
    terrain = result.terrain;
    obstacles = result.obstacles;
  });

  describe('generatePlayerSpawns', () => {
    it('should generate correct number of player spawn positions', () => {
      const spawner = new SpawnPlacer({ mapWidth: width, mapHeight: height });
      const spawns = spawner.generatePlayerSpawns(terrain, { count: 15 });

      assert.strictEqual(spawns.length, 15, 'Should generate 15 spawn positions');
    });

    it('should place spawns in 3x5 formation on west side', () => {
      const spawner = new SpawnPlacer({ mapWidth: width, mapHeight: height });
      const spawns = spawner.generatePlayerSpawns(terrain, { count: 15 });

      // All spawns should be in columns 1-3 (playerSpawnColumns = 4, but we start at 1)
      for (const spawn of spawns) {
        assert.ok(spawn.x >= 1 && spawn.x <= 3, `Spawn x=${spawn.x} should be between 1-3`);
      }

      // Check for 3 columns usage
      const columns = new Set(spawns.map(s => s.x));
      assert.strictEqual(columns.size, 3, 'Should use 3 columns');
    });

    it('should only place spawns on walkable terrain', () => {
      const spawner = new SpawnPlacer({ mapWidth: width, mapHeight: height });
      const spawns = spawner.generatePlayerSpawns(terrain, { count: 15 });

      for (const spawn of spawns) {
        assert.ok(
          !isImpassable(terrain[spawn.y][spawn.x]),
          `Spawn at (${spawn.x}, ${spawn.y}) should be on walkable terrain`
        );
      }
    });

    it('should include slot numbers for formation ordering', () => {
      const spawner = new SpawnPlacer({ mapWidth: width, mapHeight: height });
      const spawns = spawner.generatePlayerSpawns(terrain, { count: 15 });

      const slots = spawns.map(s => s.slot);
      assert.deepStrictEqual(
        slots,
        Array.from({ length: 15 }, (_, i) => i),
        'Slots should be sequential from 0'
      );
    });
  });

  describe('generateEnemySpawns', () => {
    it('should generate correct number of enemy spawn positions', () => {
      const spawner = new SpawnPlacer({ mapWidth: width, mapHeight: height });
      const random = createSeededRandom(seed);
      const spawns = spawner.generateEnemySpawns(terrain, obstacles, 'aggressive', 5, random);

      assert.strictEqual(spawns.length, 5, 'Should generate 5 spawn positions');
    });

    it('should place aggressive enemies in forward positions', () => {
      const spawner = new SpawnPlacer({ mapWidth: width, mapHeight: height });
      const random = createSeededRandom(seed);
      const spawns = spawner.generateEnemySpawns(terrain, obstacles, 'aggressive', 5, random);

      for (const spawn of spawns) {
        assert.ok(
          spawn.x >= 25 && spawn.x <= 30,
          `Aggressive spawn x=${spawn.x} should be between 25-30`
        );
      }
    });

    it('should place defensive enemies in backline positions', () => {
      const spawner = new SpawnPlacer({ mapWidth: width, mapHeight: height });
      const random = createSeededRandom(seed);
      const spawns = spawner.generateEnemySpawns(terrain, obstacles, 'defensive', 5, random);

      for (const spawn of spawns) {
        assert.ok(
          spawn.x >= 28 && spawn.x <= 31,
          `Defensive spawn x=${spawn.x} should be between 28-31`
        );
      }
    });

    it('should place ambush enemies on flanks', () => {
      const spawner = new SpawnPlacer({ mapWidth: width, mapHeight: height });
      const random = createSeededRandom(seed);
      const spawns = spawner.generateEnemySpawns(terrain, obstacles, 'ambush', 4, random);

      // Ambush enemies should be on top or bottom edges
      for (const spawn of spawns) {
        const isFlank = spawn.y < 8 || spawn.y > height - 8;
        assert.ok(
          isFlank || spawn.x >= 20,
          `Ambush spawn at (${spawn.x}, ${spawn.y}) should be on flanks`
        );
      }
    });

    it('should place pack enemies in tight clusters', () => {
      const spawner = new SpawnPlacer({ mapWidth: width, mapHeight: height });
      const random = createSeededRandom(seed);
      const spawns = spawner.generateEnemySpawns(terrain, obstacles, 'pack', 4, random);

      // Calculate average distance between spawns
      let totalDist = 0;
      let count = 0;
      for (let i = 0; i < spawns.length; i++) {
        for (let j = i + 1; j < spawns.length; j++) {
          totalDist += Math.abs(spawns[i].x - spawns[j].x) + Math.abs(spawns[i].y - spawns[j].y);
          count++;
        }
      }
      const avgDist = totalDist / count;

      // Pack AI should cluster units (average distance should be relatively small)
      assert.ok(avgDist < 15, `Pack spawns average distance ${avgDist} should be clustered`);
    });

    it('should only place spawns on walkable terrain', () => {
      const spawner = new SpawnPlacer({ mapWidth: width, mapHeight: height });
      const random = createSeededRandom(seed);
      const spawns = spawner.generateEnemySpawns(terrain, obstacles, 'tactical', 7, random);

      for (const spawn of spawns) {
        assert.ok(
          !isImpassable(terrain[spawn.y][spawn.x]),
          `Enemy spawn at (${spawn.x}, ${spawn.y}) should be on walkable terrain`
        );
      }
    });

    it('should include role information for tactical positioning', () => {
      const spawner = new SpawnPlacer({ mapWidth: width, mapHeight: height });
      const random = createSeededRandom(seed);
      const spawns = spawner.generateEnemySpawns(terrain, obstacles, 'tactical', 4, random, {
        unitRoles: ['melee', 'ranged', 'support', 'melee']
      });

      const roles = spawns.map(s => s.role);
      assert.deepStrictEqual(roles, ['melee', 'ranged', 'support', 'melee']);
    });
  });

  describe('AI_SPAWN_CONFIGS', () => {
    it('should have configs for all AI types', () => {
      const expectedTypes = [
        'aggressive', 'defensive', 'support', 'tactical',
        'pack', 'ambush', 'berserker', 'ranged', 'boss'
      ];

      for (const type of expectedTypes) {
        assert.ok(AI_SPAWN_CONFIGS[type], `Should have config for ${type}`);
        assert.ok(AI_SPAWN_CONFIGS[type].xRange, `${type} should have xRange`);
        assert.ok(AI_SPAWN_CONFIGS[type].ySpread, `${type} should have ySpread`);
      }
    });
  });

  describe('validateSpawnPositions', () => {
    it('should validate all spawns are walkable', () => {
      const validSpawns = [
        { x: 2, y: 10 },
        { x: 3, y: 12 }
      ];
      const result = validateSpawnPositions(validSpawns, terrain, obstacles);

      assert.strictEqual(result.valid, true, 'Valid spawns should pass validation');
      assert.strictEqual(result.invalidPositions.length, 0);
    });

    it('should detect invalid spawn positions', () => {
      // Create a spawn on impassable terrain
      const invalidSpawns = [
        { x: -1, y: 10 }, // Out of bounds
        { x: 2, y: -1 }   // Out of bounds
      ];
      const result = validateSpawnPositions(invalidSpawns, terrain, obstacles);

      assert.strictEqual(result.valid, false, 'Invalid spawns should fail validation');
      assert.strictEqual(result.invalidPositions.length, 2);
    });
  });

  describe('generateSpawnPositions (integrated)', () => {
    it('should generate both player and enemy spawns', () => {
      const result = generateSpawnPositions(terrain, obstacles, {
        seed: 42,
        playerCount: 10,
        enemyAiType: 'tactical',
        enemyCount: 6
      });

      assert.ok(result.playerSpawns, 'Should have player spawns');
      assert.ok(result.enemySpawns, 'Should have enemy spawns');
      assert.strictEqual(result.playerSpawns.length, 10);
      assert.strictEqual(result.enemySpawns.length, 6);
    });

    it('should be deterministic with same seed', () => {
      const result1 = generateSpawnPositions(terrain, obstacles, {
        seed: 999,
        enemyAiType: 'aggressive',
        enemyCount: 5
      });

      const result2 = generateSpawnPositions(terrain, obstacles, {
        seed: 999,
        enemyAiType: 'aggressive',
        enemyCount: 5
      });

      // Enemy spawns should be identical
      for (let i = 0; i < result1.enemySpawns.length; i++) {
        assert.strictEqual(result1.enemySpawns[i].x, result2.enemySpawns[i].x);
        assert.strictEqual(result1.enemySpawns[i].y, result2.enemySpawns[i].y);
      }
    });
  });

  describe('generateTerrain with includeSpawns', () => {
    it('should include spawn positions when option is set', () => {
      const result = generateTerrain(seed, 'forest', width, height, {
        includeSpawns: true,
        playerCount: 8,
        enemyAiType: 'defensive',
        enemyCount: 4
      });

      assert.ok(result.playerSpawns, 'Should include player spawns');
      assert.ok(result.enemySpawns, 'Should include enemy spawns');
      assert.ok(result.elevation, 'Should include elevation for spawn scoring');
      assert.strictEqual(result.playerSpawns.length, 8);
      assert.strictEqual(result.enemySpawns.length, 4);
    });

    it('should work without enemy spawns if only player count given', () => {
      const result = generateTerrain(seed, 'cave', width, height, {
        includeSpawns: true,
        playerCount: 5
      });

      assert.ok(result.playerSpawns, 'Should include player spawns');
      assert.strictEqual(result.playerSpawns.length, 5);
      assert.strictEqual(result.enemySpawns, undefined, 'Should not have enemy spawns');
    });
  });
});

/**
 * Create seeded random function for testing
 */
function createSeededRandom(seed) {
  let currentSeed = seed;
  return function() {
    let t = currentSeed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
