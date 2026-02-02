import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CHARACTER_ANIMATIONS,
  CHARACTER_TYPES,
  ENEMY_BIOMES,
  OBSTACLE_CATEGORIES,
  ASSET_CATEGORIES,
  SIZE_PRESETS,
  DEFAULT_SIZES,
  getCharacterPath,
  getCharacterAnimationPaths,
  getCharacterDirectory,
  getCharacterReferencePath,
  getObstaclePath,
  getAssetPath,
  getOriginalsPath,
  getOutputPath
} from './assetPaths.js';

describe('assetPaths', () => {
  describe('constants', () => {
    it('should export CHARACTER_ANIMATIONS with all animation types', () => {
      assert.ok(Array.isArray(CHARACTER_ANIMATIONS));
      assert.ok(CHARACTER_ANIMATIONS.includes('idle'));
      assert.ok(CHARACTER_ANIMATIONS.includes('walk'));
      assert.ok(CHARACTER_ANIMATIONS.includes('attack'));
      assert.ok(CHARACTER_ANIMATIONS.includes('hurt'));
      assert.ok(CHARACTER_ANIMATIONS.includes('death'));
      assert.ok(CHARACTER_ANIMATIONS.includes('dead'));
      assert.ok(CHARACTER_ANIMATIONS.includes('cast'));
      assert.ok(CHARACTER_ANIMATIONS.includes('victory'));
    });

    it('should export CHARACTER_TYPES', () => {
      assert.deepStrictEqual(CHARACTER_TYPES, ['player', 'enemy']);
    });

    it('should export ENEMY_BIOMES', () => {
      assert.deepStrictEqual(ENEMY_BIOMES, ['forest', 'cave', 'mountain', 'bridge', 'castle']);
    });

    it('should export OBSTACLE_CATEGORIES', () => {
      assert.deepStrictEqual(OBSTACLE_CATEGORIES, ['rocks', 'trees']);
    });

    it('should include characters and obstacles in ASSET_CATEGORIES', () => {
      assert.ok(ASSET_CATEGORIES.includes('characters'));
      assert.ok(ASSET_CATEGORIES.includes('obstacles'));
    });

    it('should have SIZE_PRESETS for characters and obstacles', () => {
      assert.deepStrictEqual(SIZE_PRESETS.characters, [64]);
      assert.deepStrictEqual(SIZE_PRESETS.obstacles, [64]);
    });

    it('should have DEFAULT_SIZES for characters and obstacles', () => {
      assert.strictEqual(DEFAULT_SIZES.characters, 64);
      assert.strictEqual(DEFAULT_SIZES.obstacles, 64);
    });
  });

  describe('getCharacterPath', () => {
    it('should generate player character path with default animation', () => {
      const path = getCharacterPath('warrior');
      assert.strictEqual(path, '/assets/characters/player/warrior/warrior_idle.webp');
    });

    it('should generate player character path with specified animation', () => {
      const path = getCharacterPath('mage', { animation: 'attack' });
      assert.strictEqual(path, '/assets/characters/player/mage/mage_attack.webp');
    });

    it('should generate enemy character path', () => {
      const path = getCharacterPath('goblin_warrior', { type: 'enemy', biome: 'forest' });
      assert.strictEqual(path, '/assets/characters/enemies/forest/goblin_warrior/goblin_warrior_idle.webp');
    });

    it('should generate enemy character path with animation', () => {
      const path = getCharacterPath('skeleton', { type: 'enemy', biome: 'cave', animation: 'dead' });
      assert.strictEqual(path, '/assets/characters/enemies/cave/skeleton/skeleton_dead.webp');
    });

    it('should accept "enemies" as type alias', () => {
      const path = getCharacterPath('orc', { type: 'enemies', biome: 'mountain' });
      assert.strictEqual(path, '/assets/characters/enemies/mountain/orc/orc_idle.webp');
    });

    it('should support custom extension', () => {
      const path = getCharacterPath('warrior', { animation: 'idle', extension: 'png' });
      assert.strictEqual(path, '/assets/characters/player/warrior/warrior_idle.png');
    });

    it('should throw error for enemy without biome', () => {
      assert.throws(() => {
        getCharacterPath('goblin', { type: 'enemy' });
      }, /biome required/);
    });
  });

  describe('getCharacterAnimationPaths', () => {
    it('should return all animation paths by default', () => {
      const paths = getCharacterAnimationPaths('warrior');
      assert.strictEqual(paths.length, CHARACTER_ANIMATIONS.length);
      assert.ok(paths.some(p => p.animation === 'idle'));
      assert.ok(paths.some(p => p.animation === 'dead'));
    });

    it('should filter by specified animations', () => {
      const paths = getCharacterAnimationPaths('warrior', { animations: ['idle', 'attack'] });
      assert.strictEqual(paths.length, 2);
      assert.strictEqual(paths[0].animation, 'idle');
      assert.strictEqual(paths[1].animation, 'attack');
    });

    it('should work for enemies', () => {
      const paths = getCharacterAnimationPaths('goblin', {
        type: 'enemy',
        biome: 'forest',
        animations: ['idle', 'dead']
      });
      assert.strictEqual(paths.length, 2);
      assert.strictEqual(paths[0].path, '/assets/characters/enemies/forest/goblin/goblin_idle.webp');
      assert.strictEqual(paths[1].path, '/assets/characters/enemies/forest/goblin/goblin_dead.webp');
    });
  });

  describe('getCharacterDirectory', () => {
    it('should return player character directory', () => {
      const dir = getCharacterDirectory('warrior');
      assert.strictEqual(dir, '/assets/characters/player/warrior');
    });

    it('should return enemy character directory', () => {
      const dir = getCharacterDirectory('goblin', { type: 'enemy', biome: 'forest' });
      assert.strictEqual(dir, '/assets/characters/enemies/forest/goblin');
    });

    it('should throw for enemy without biome', () => {
      assert.throws(() => {
        getCharacterDirectory('goblin', { type: 'enemy' });
      }, /biome required/);
    });
  });

  describe('getCharacterReferencePath', () => {
    it('should return player reference path', () => {
      const path = getCharacterReferencePath('warrior');
      assert.strictEqual(path, '/assets/characters/player/warrior/warrior_reference.png');
    });

    it('should return enemy reference path', () => {
      const path = getCharacterReferencePath('goblin', { type: 'enemy', biome: 'forest' });
      assert.strictEqual(path, '/assets/characters/enemies/forest/goblin/goblin_reference.png');
    });
  });

  describe('getObstaclePath', () => {
    it('should generate rock obstacle path', () => {
      const path = getObstaclePath('rock_small', 'rocks');
      assert.strictEqual(path, '/assets/obstacles/rocks/rock_small.webp');
    });

    it('should generate tree obstacle path', () => {
      const path = getObstaclePath('tree_oak', 'trees');
      assert.strictEqual(path, '/assets/obstacles/trees/tree_oak.webp');
    });

    it('should support custom extension', () => {
      const path = getObstaclePath('rock_large', 'rocks', { extension: 'png' });
      assert.strictEqual(path, '/assets/obstacles/rocks/rock_large.png');
    });

    it('should throw for invalid category', () => {
      assert.throws(() => {
        getObstaclePath('boulder', 'invalid');
      }, /Invalid obstacle category/);
    });
  });

  describe('getAssetPath with new categories', () => {
    it('should handle characters category', () => {
      const path = getAssetPath('characters', 'warrior', { animation: 'attack' });
      assert.strictEqual(path, '/assets/characters/player/warrior/warrior_attack.webp');
    });

    it('should handle obstacles category with default subcategory', () => {
      const path = getAssetPath('obstacles', 'rock_small');
      assert.strictEqual(path, '/assets/obstacles/rocks/rock_small.webp');
    });

    it('should handle obstacles category with explicit subcategory', () => {
      const path = getAssetPath('obstacles', 'tree_oak', { subcategory: 'trees' });
      assert.strictEqual(path, '/assets/obstacles/trees/tree_oak.webp');
    });
  });

  describe('getOriginalsPath with new categories', () => {
    it('should return character reference path for characters', () => {
      const path = getOriginalsPath('characters', 'warrior');
      assert.strictEqual(path, '/assets/characters/player/warrior/warrior_reference.png');
    });

    it('should return enemy reference path for enemy characters', () => {
      const path = getOriginalsPath('characters', 'goblin', { type: 'enemy', biome: 'forest' });
      assert.strictEqual(path, '/assets/characters/enemies/forest/goblin/goblin_reference.png');
    });

    it('should return obstacle originals path', () => {
      const path = getOriginalsPath('obstacles', 'rock_small', { subcategory: 'rocks' });
      assert.strictEqual(path, '/assets/obstacles/originals/rocks/rock_small.webp');
    });
  });

  describe('getOutputPath with new categories', () => {
    it('should prepend frontend/public to character paths', () => {
      const path = getOutputPath('characters', 'warrior', { animation: 'idle' });
      assert.strictEqual(path, 'frontend/public/assets/characters/player/warrior/warrior_idle.webp');
    });

    it('should prepend frontend/public to obstacle paths', () => {
      const path = getOutputPath('obstacles', 'rock_small', { subcategory: 'rocks' });
      assert.strictEqual(path, 'frontend/public/assets/obstacles/rocks/rock_small.webp');
    });
  });
});
