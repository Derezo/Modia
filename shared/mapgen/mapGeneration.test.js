/**
 * Map Generation Unit Tests
 * Tests for procedural battle map generation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateTerrain,
  generateTerrainOnly,
  getSpawnProtectionZones,
  MIN_MAP_DIMENSION,
  MIN_ARENA_MAP_WIDTH,
  MIN_ARENA_MAP_HEIGHT
} from '../mapGeneration.js';
import { discretizeElevation, isImpassable, TERRAIN_COSTS, IMPASSABLE_TERRAIN } from '../terrain.js';
import { hasValidPath } from '../pathfinding.js';
import { ARCHETYPES } from './archetypes/archetypeDefinitions.js';
import { NODE_TYPE_ARCHETYPE_WEIGHTS } from './archetypes/ArchetypeSelector.js';
import {
  NODE_TYPE_CONFIGS,
  RACE_SUBTYPE_CONFIGS
} from './nodeTypeAlgorithms.js';
import {
  OBSTACLE_ASSET_CATALOG,
  getObstacleAssetCategory
} from '../obstacles.js';

// All valid terrain types (passable + impassable)
const VALID_TERRAIN_TYPES = [...Object.keys(TERRAIN_COSTS), ...IMPASSABLE_TERRAIN];

describe('Map Generation', () => {
  describe('Determinism Tests', () => {
    it('should produce identical terrain with same seed', () => {
      const seed = 12345;
      const result1 = generateTerrain(seed, 'forest', 16, 16);
      const result2 = generateTerrain(seed, 'forest', 16, 16);

      assert.deepStrictEqual(result1.terrain, result2.terrain, 'Terrain should be identical');
      assert.deepStrictEqual(result1.obstacles, result2.obstacles, 'Obstacles should be identical');
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

    it('should reject dimensions outside the supported integer contract', () => {
      assert.throws(
        () => generateTerrain(12345, 'forest', MIN_MAP_DIMENSION - 1, 32),
        { name: 'RangeError' }
      );
      assert.throws(
        () => generateTerrain(12345, 'forest', 32, 12.5),
        { name: 'RangeError' }
      );
      assert.throws(
        () => generateTerrain(12345, 'forest', Number.NaN, 32),
        { name: 'RangeError' }
      );
      assert.throws(
        () => generateTerrain(12345, 'arena', MIN_ARENA_MAP_WIDTH - 1, MIN_ARENA_MAP_HEIGHT),
        { name: 'RangeError' }
      );
      assert.throws(
        () => generateTerrain(12345, 'arena', MIN_ARENA_MAP_WIDTH, MIN_ARENA_MAP_HEIGHT - 1),
        { name: 'RangeError' }
      );
    });

    it('should preserve exact dimensions for every public grid at the minimum size', () => {
      const result = generateTerrain(12345, 'mountain', MIN_MAP_DIMENSION, MIN_MAP_DIMENSION, {
        elevation: true
      });

      for (const layer of ['terrain', 'obstacles', 'variants', 'elevation']) {
        assert.strictEqual(result[layer].length, MIN_MAP_DIMENSION, `${layer} height should match`);
        for (const row of result[layer]) {
          assert.strictEqual(row.length, MIN_MAP_DIMENSION, `${layer} row width should match`);
        }
      }
    });

    it('should protect both complete arena formations at its minimum dimensions', () => {
      const result = generateTerrain(
        12345,
        'arena',
        MIN_ARENA_MAP_WIDTH,
        MIN_ARENA_MAP_HEIGHT,
        { elevation: true }
      );

      for (const zone of getSpawnProtectionZones(
        'arena',
        MIN_ARENA_MAP_WIDTH,
        MIN_ARENA_MAP_HEIGHT
      )) {
        for (let y = zone.y; y < zone.y + zone.height; y++) {
          for (let x = zone.x; x < zone.x + zone.width; x++) {
            assert.ok(!isImpassable(result.terrain[y][x]));
            assert.strictEqual(result.obstacles[y][x], null);
            assert.strictEqual(discretizeElevation(result.elevation[y][x]), 0);
          }
        }
      }
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

    it('should generate valid blocking props without contaminating spawn strips', () => {
      const result = generateTerrain(12345, 'forest', 32, 32);
      const props = result.obstacles.flat().filter(Boolean);

      assert.ok(props.length > 0, 'Forest maps should include environmental props');
      for (const prop of props) {
        assert.ok(prop.type === 'rocks' || prop.type === 'trees');
        assert.equal(prop.passable, false);
      }
    });

    it('should report metadata from the final validated obstacle grid', () => {
      const result = generateTerrain(0, 'forest', 32, 32, { includeMetadata: true });
      const finalObstacleCount = result.obstacles.flat().filter(Boolean).length;
      const validation = result.metadata.validationResult;

      assert.strictEqual(result.metadata.obstacleCount, finalObstacleCount);
      assert.ok(Number.isInteger(validation.iterations));
      assert.strictEqual(validation.repaired, validation.iterations > 0);
      assert.ok(validation.finalAnalysis);
      assert.strictEqual(typeof validation.finalAnalysis.walkableRatio, 'number');
    });
  });

  describe('Node Type Tests', () => {
    it('should only reference defined archetypes from node weight tables', () => {
      for (const [nodeType, weights] of Object.entries(NODE_TYPE_ARCHETYPE_WEIGHTS)) {
        for (const archetypeName of Object.keys(weights)) {
          assert.ok(ARCHETYPES[archetypeName], `${nodeType} references missing archetype ${archetypeName}`);
        }
      }
    });

    it('should define a deliberate config for every weighted runtime node type', () => {
      for (const nodeType of Object.keys(NODE_TYPE_ARCHETYPE_WEIGHTS)) {
        assert.ok(
          NODE_TYPE_CONFIGS[nodeType] || RACE_SUBTYPE_CONFIGS[nodeType],
          `${nodeType} must not silently inherit forest configuration`
        );
      }
      assert.ok(NODE_TYPE_CONFIGS.guild, 'Guild advancement battles require an explicit config');
      assert.ok(NODE_TYPE_ARCHETYPE_WEIGHTS.guild, 'Guild advancement battles require curated archetype weights');
    });

    it('should only request obstacle variants present in the runtime catalog', () => {
      const configs = { ...NODE_TYPE_CONFIGS, ...RACE_SUBTYPE_CONFIGS };

      for (const [nodeType, config] of Object.entries(configs)) {
        for (const [ruleType, rule] of Object.entries(config.obstacleRules || {})) {
          const category = getObstacleAssetCategory(rule.variants?.[0], ruleType);
          const available = OBSTACLE_ASSET_CATALOG[category];
          assert.ok(available, `${nodeType}.${ruleType} resolves to an unknown obstacle category`);
          for (const variant of rule.variants || []) {
            assert.ok(
              available.includes(variant),
              `${nodeType}.${ruleType} requests missing ${category} variant ${variant}`
            );
          }
        }
      }
    });

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

    it('should generate a finite elevated bridge with normalized elevation', () => {
      const result = generateTerrain(12345, 'bridge', 32, 32, { elevation: true });
      const levelsByTerrain = new Map();

      for (let y = 0; y < result.terrain.length; y++) {
        for (let x = 0; x < result.terrain[y].length; x++) {
          const terrain = result.terrain[y][x];
          const rawElevation = result.elevation[y][x];
          assert.ok(rawElevation >= 0 && rawElevation <= 1, 'Public elevation must be normalized');
          if (!levelsByTerrain.has(terrain)) levelsByTerrain.set(terrain, new Set());
          levelsByTerrain.get(terrain).add(discretizeElevation(rawElevation));
        }
      }

      assert.deepStrictEqual([...levelsByTerrain.get('water')], [-1]);
      assert.deepStrictEqual([...levelsByTerrain.get('stone')].sort(), [0, 1]);
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

    it('should protect the exact Coliseum formation rectangles across seeds', () => {
      for (let seed = 0; seed < 16; seed++) {
        const result = generateTerrain(seed, 'arena', 32, 32, { elevation: true });
        const zones = getSpawnProtectionZones('arena', 32, 32);

        for (const zone of zones) {
          for (let y = zone.y; y < zone.y + zone.height; y++) {
            for (let x = zone.x; x < zone.x + zone.width; x++) {
              assert.ok(!isImpassable(result.terrain[y][x]), `Seed ${seed}: arena spawn (${x},${y}) must be passable`);
              assert.strictEqual(result.obstacles[y][x], null, `Seed ${seed}: arena spawn (${x},${y}) must be empty`);
              assert.strictEqual(discretizeElevation(result.elevation[y][x]), 0, `Seed ${seed}: arena spawn (${x},${y}) must be flat`);
              if (zone.forceTerrain) {
                assert.strictEqual(result.terrain[y][x], 'stone', `Seed ${seed}: formation tile (${x},${y}) must use arena stone`);
              }
            }
          }
        }
      }
    });

    it('should protect every standard PvE and guild enemy coordinate', () => {
      for (const nodeType of ['forest', 'cave', 'guild']) {
        for (let seed = 0; seed < 12; seed++) {
          const result = generateTerrain(seed, nodeType, 32, 32, { elevation: true });
          for (let y = 0; y < 32; y++) {
            for (const x of [0, 1, 2, 3, 4, 5, 6, 25, 26, 27, 28, 29, 30, 31]) {
              assert.ok(!isImpassable(result.terrain[y][x]), `Seed ${seed}: ${nodeType} spawn (${x},${y}) must be passable`);
              assert.strictEqual(result.obstacles[y][x], null, `Seed ${seed}: ${nodeType} spawn (${x},${y}) must be empty`);
              assert.strictEqual(discretizeElevation(result.elevation[y][x]), 0, `Seed ${seed}: ${nodeType} spawn (${x},${y}) must be flat`);
            }
          }
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
