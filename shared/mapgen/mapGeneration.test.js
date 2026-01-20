/**
 * Map Generation Unit Tests
 * Tests for procedural battle map generation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateTerrain, generateTerrainOnly } from '../mapGeneration.js';
import { isImpassable, TERRAIN_COSTS, IMPASSABLE_TERRAIN } from '../terrain.js';
import { hasValidPath } from '../pathfinding.js';

// All valid terrain types (passable + impassable)
const VALID_TERRAIN_TYPES = [...Object.keys(TERRAIN_COSTS), ...IMPASSABLE_TERRAIN];

describe('Map Generation', () => {
  describe('Determinism Tests', () => {
    it('should produce identical terrain with same seed', () => {
      const seed = 12345;
      const result1 = generateTerrain(seed, 'forest', 16, 16);
      const result2 = generateTerrain(seed, 'forest', 16, 16);

      assert.deepStrictEqual(result1.terrain, result2.terrain, 'Terrain should be identical');
      assert.deepStrictEqual(result1.variants, result2.variants, 'Variants should be identical');
    });

    it('should produce identical results with same seed and nodeType', () => {
      const seed = 54321;
      const nodeTypes = ['forest', 'cave', 'mountain'];

      for (const nodeType of nodeTypes) {
        const result1 = generateTerrain(seed, nodeType, 16, 16);
        const result2 = generateTerrain(seed, nodeType, 16, 16);
        assert.deepStrictEqual(result1.terrain, result2.terrain, `${nodeType} should be deterministic`);
      }
    });

    it('should produce different terrain with different seeds', () => {
      const result1 = generateTerrain(11111, 'forest', 16, 16);
      const result2 = generateTerrain(22222, 'forest', 16, 16);

      assert.notDeepStrictEqual(result1.terrain, result2.terrain, 'Different seeds should produce different terrain');
    });
  });

  describe('Basic Generation Tests', () => {
    it('should return correct structure with terrain, obstacles, variants', () => {
      const result = generateTerrain(12345, 'forest', 16, 16);

      assert.ok(result.terrain, 'Should have terrain');
      assert.ok(result.obstacles, 'Should have obstacles');
      assert.ok(result.variants, 'Should have variants');
      assert.ok(Array.isArray(result.terrain), 'Terrain should be an array');
    });

    it('should match requested dimensions', () => {
      const width = 24;
      const height = 18;
      const result = generateTerrain(12345, 'forest', width, height);

      assert.strictEqual(result.terrain.length, height, 'Terrain height should match');
      assert.strictEqual(result.terrain[0].length, width, 'Terrain width should match');
      assert.strictEqual(result.obstacles.length, height, 'Obstacles height should match');
    });

    it('should only contain valid terrain types', () => {
      const result = generateTerrain(12345, 'forest', 20, 20);

      for (let y = 0; y < result.terrain.length; y++) {
        for (let x = 0; x < result.terrain[y].length; x++) {
          const terrain = result.terrain[y][x];
          assert.ok(VALID_TERRAIN_TYPES.includes(terrain), `Invalid terrain at (${x},${y}): ${terrain}`);
        }
      }
    });

    it('should generate variants as numbers 0-3', () => {
      const result = generateTerrain(12345, 'forest', 16, 16);

      for (let y = 0; y < result.variants.length; y++) {
        for (let x = 0; x < result.variants[y].length; x++) {
          const variant = result.variants[y][x];
          assert.ok(typeof variant === 'number' && variant >= 0 && variant <= 3, `Invalid variant at (${x},${y})`);
        }
      }
    });
  });

  describe('Node Type Tests', () => {
    it('should generate forest maps', () => {
      const result = generateTerrain(12345, 'forest', 20, 20);
      assert.ok(result.terrain, 'Forest map should generate');
      assert.strictEqual(result.terrain.length, 20);
    });

    it('should generate cave maps', () => {
      const result = generateTerrain(12345, 'cave', 20, 20);
      assert.ok(result.terrain, 'Cave map should generate');
    });

    it('should generate mountain maps', () => {
      const result = generateTerrain(12345, 'mountain', 20, 20);
      assert.ok(result.terrain, 'Mountain map should generate');
    });

    it('should handle unknown node type with default', () => {
      const result = generateTerrain(12345, 'unknown_biome', 16, 16);
      assert.ok(result.terrain, 'Unknown node type should use default');
    });
  });

  describe('Spawn Area Tests', () => {
    it('should have clear player spawn area (columns 0-4)', () => {
      const result = generateTerrain(12345, 'cave', 32, 20);

      for (let y = 0; y < 20; y++) {
        for (let x = 0; x < 5; x++) {
          const terrain = result.terrain[y][x];
          assert.ok(!isImpassable(terrain), `Player spawn at (${x},${y}) should be passable`);
          assert.strictEqual(result.obstacles[y][x], null, `Player spawn at (${x},${y}) should have no obstacle`);
        }
      }
    });

    it('should have clear enemy spawn area (last 5 columns)', () => {
      const width = 32;
      const height = 20;
      const result = generateTerrain(12345, 'cave', width, height);

      for (let y = 0; y < height; y++) {
        for (let x = width - 5; x < width; x++) {
          const terrain = result.terrain[y][x];
          assert.ok(!isImpassable(terrain), `Enemy spawn at (${x},${y}) should be passable`);
          assert.strictEqual(result.obstacles[y][x], null, `Enemy spawn at (${x},${y}) should have no obstacle`);
        }
      }
    });
  });

  describe('Connectivity Tests', () => {
    it('should have path from player spawn to enemy spawn', () => {
      const width = 32;
      const height = 20;
      const result = generateTerrain(12345, 'cave', width, height);

      const hasPath = hasValidPath(2, Math.floor(height / 2), width - 3, Math.floor(height / 2), result.terrain, width, height);
      assert.ok(hasPath, 'Should have valid path between spawn areas');
    });

    it('should maintain connectivity across multiple seeds', () => {
      const width = 32;
      const height = 20;
      const seeds = [111, 222, 333, 444, 555];

      for (const seed of seeds) {
        const result = generateTerrain(seed, 'cave', width, height);
        const hasPath = hasValidPath(2, Math.floor(height / 2), width - 3, Math.floor(height / 2), result.terrain, width, height);
        assert.ok(hasPath, `Seed ${seed} should produce connected map`);
      }
    });
  });

  describe('generateTerrainOnly', () => {
    it('should return only terrain grid', () => {
      const terrain = generateTerrainOnly(12345, 'forest', 16, 16);

      assert.ok(Array.isArray(terrain), 'Should return array');
      assert.strictEqual(terrain.length, 16, 'Should have correct height');
      assert.strictEqual(terrain[0].length, 16, 'Should have correct width');
      assert.ok(typeof terrain[0][0] === 'string', 'Should contain terrain strings');
    });

    it('should be deterministic', () => {
      const terrain1 = generateTerrainOnly(99999, 'mountain', 16, 16);
      const terrain2 = generateTerrainOnly(99999, 'mountain', 16, 16);

      assert.deepStrictEqual(terrain1, terrain2, 'Same seed should produce same terrain');
    });
  });
});
