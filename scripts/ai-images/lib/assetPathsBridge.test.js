/**
 * Unit tests for assetPathsBridge.js
 *
 * Tests the CommonJS bridge module that provides access to the ESM
 * shared/assetPaths.js module from CommonJS scripts.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const {
  getAssetPathsModule,
  getSizePresets,
  RESIZE_SPECIFIC_PRESETS,
  CATEGORY_BASE_DIRS,
  getOutputDir,
  getOriginalsFilePath,
  getCharacterOutputPath,
  getCharacterReferencePath,
  getCharacterDirectoryPath,
  getObstacleOutputPath
} = require('./assetPathsBridge.js');

describe('assetPathsBridge', () => {
  describe('RESIZE_SPECIFIC_PRESETS', () => {
    it('contains walls preset', () => {
      assert.ok(RESIZE_SPECIFIC_PRESETS.walls);
      assert.deepStrictEqual(RESIZE_SPECIFIC_PRESETS.walls, [64]);
    });

    it('contains slopes preset', () => {
      assert.ok(RESIZE_SPECIFIC_PRESETS.slopes);
      assert.deepStrictEqual(RESIZE_SPECIFIC_PRESETS.slopes, [64]);
    });
  });

  describe('CATEGORY_BASE_DIRS', () => {
    it('maps tiles to sprites/terrain', () => {
      assert.strictEqual(CATEGORY_BASE_DIRS.tiles, 'sprites/terrain');
    });

    it('maps portraits to portraits', () => {
      assert.strictEqual(CATEGORY_BASE_DIRS.portraits, 'portraits');
    });

    it('maps items to items', () => {
      assert.strictEqual(CATEGORY_BASE_DIRS.items, 'items');
    });

    it('maps icons to icons', () => {
      assert.strictEqual(CATEGORY_BASE_DIRS.icons, 'icons');
    });

    it('maps nodes to nodes', () => {
      assert.strictEqual(CATEGORY_BASE_DIRS.nodes, 'nodes');
    });

    it('maps overlays to overlays', () => {
      assert.strictEqual(CATEGORY_BASE_DIRS.overlays, 'overlays');
    });

    it('maps characters to characters', () => {
      assert.strictEqual(CATEGORY_BASE_DIRS.characters, 'characters');
    });

    it('maps obstacles to obstacles', () => {
      assert.strictEqual(CATEGORY_BASE_DIRS.obstacles, 'obstacles');
    });

    it('has exactly 8 categories', () => {
      const categories = Object.keys(CATEGORY_BASE_DIRS);
      assert.strictEqual(categories.length, 8);
    });
  });

  describe('getOutputDir', () => {
    it('returns correct path for tiles category', () => {
      const result = getOutputDir('tiles');
      assert.ok(result.endsWith(path.join('frontend', 'public', 'assets', 'sprites', 'terrain')));
    });

    it('returns correct path for portraits category', () => {
      const result = getOutputDir('portraits');
      assert.ok(result.endsWith(path.join('frontend', 'public', 'assets', 'portraits')));
    });

    it('returns correct path for items category', () => {
      const result = getOutputDir('items');
      assert.ok(result.endsWith(path.join('frontend', 'public', 'assets', 'items')));
    });

    it('returns correct path for icons category', () => {
      const result = getOutputDir('icons');
      assert.ok(result.endsWith(path.join('frontend', 'public', 'assets', 'icons')));
    });

    it('returns correct path for nodes category', () => {
      const result = getOutputDir('nodes');
      assert.ok(result.endsWith(path.join('frontend', 'public', 'assets', 'nodes')));
    });

    it('returns correct path for overlays category', () => {
      const result = getOutputDir('overlays');
      assert.ok(result.endsWith(path.join('frontend', 'public', 'assets', 'overlays')));
    });

    it('returns correct path for characters category', () => {
      const result = getOutputDir('characters');
      assert.ok(result.endsWith(path.join('frontend', 'public', 'assets', 'characters')));
    });

    it('returns correct path for obstacles category', () => {
      const result = getOutputDir('obstacles');
      assert.ok(result.endsWith(path.join('frontend', 'public', 'assets', 'obstacles')));
    });

    it('returns null for unknown category', () => {
      const result = getOutputDir('unknown');
      assert.strictEqual(result, null);
    });

    it('returns null for empty string', () => {
      const result = getOutputDir('');
      assert.strictEqual(result, null);
    });

    it('returns absolute path', () => {
      const result = getOutputDir('portraits');
      assert.ok(path.isAbsolute(result), 'Expected absolute path');
    });
  });

  describe('getAssetPathsModule', () => {
    it('returns the shared assetPaths module', async () => {
      const module = await getAssetPathsModule();
      assert.ok(module);
      assert.ok(module.SIZE_PRESETS, 'Expected SIZE_PRESETS export');
      assert.ok(module.getAssetPath, 'Expected getAssetPath export');
      assert.ok(module.getOriginalsPath, 'Expected getOriginalsPath export');
    });

    it('caches the module (second call returns same reference)', async () => {
      const module1 = await getAssetPathsModule();
      const module2 = await getAssetPathsModule();
      assert.strictEqual(module1, module2, 'Expected cached reference');
    });

    it('exports SIZE_PRESETS with expected categories', async () => {
      const module = await getAssetPathsModule();
      const presets = module.SIZE_PRESETS;
      assert.ok(presets.tiles);
      assert.ok(presets.portraits);
      assert.ok(presets.items);
      assert.ok(presets.icons);
      assert.ok(presets.nodes);
      assert.ok(presets.overlays);
    });
  });

  describe('getSizePresets', () => {
    it('returns merged presets including canonical presets', async () => {
      const presets = await getSizePresets();
      // From shared/assetPaths.js
      assert.ok(presets.portraits, 'Expected portraits from canonical');
      assert.ok(presets.icons, 'Expected icons from canonical');
      assert.ok(presets.tiles, 'Expected tiles from canonical');
      assert.ok(presets.nodes, 'Expected nodes from canonical');
    });

    it('returns merged presets including resize-specific presets', async () => {
      const presets = await getSizePresets();
      // From RESIZE_SPECIFIC_PRESETS
      assert.ok(presets.walls, 'Expected walls from resize-specific');
      assert.ok(presets.slopes, 'Expected slopes from resize-specific');
    });

    it('walls preset has correct value', async () => {
      const presets = await getSizePresets();
      assert.deepStrictEqual(presets.walls, [64]);
    });

    it('slopes preset has correct value', async () => {
      const presets = await getSizePresets();
      assert.deepStrictEqual(presets.slopes, [64]);
    });

    it('caches the merged presets (second call returns same reference)', async () => {
      const presets1 = await getSizePresets();
      const presets2 = await getSizePresets();
      assert.strictEqual(presets1, presets2, 'Expected cached reference');
    });

    it('portraits has expected size variants', async () => {
      const presets = await getSizePresets();
      assert.deepStrictEqual(presets.portraits, [64, 128, 256]);
    });

    it('icons has expected size variants', async () => {
      const presets = await getSizePresets();
      assert.deepStrictEqual(presets.icons, [16, 24, 32, 48, 64, 128, 256]);
    });
  });

  describe('getOriginalsFilePath', () => {
    it('returns absolute filesystem path for portraits', async () => {
      const result = await getOriginalsFilePath('portraits', 'human_male_warrior');
      assert.ok(path.isAbsolute(result));
      assert.ok(result.includes('frontend/public'));
      assert.ok(result.includes('portraits/originals'));
      assert.ok(result.endsWith('human_male_warrior.webp'));
    });

    it('returns absolute filesystem path for items with subcategory', async () => {
      const result = await getOriginalsFilePath('items', 'sword_iron', { subcategory: 'weapons' });
      assert.ok(path.isAbsolute(result));
      assert.ok(result.includes('items/originals/weapons'));
      assert.ok(result.endsWith('sword_iron.webp'));
    });

    it('returns absolute filesystem path for tiles with subcategory', async () => {
      const result = await getOriginalsFilePath('tiles', 'grass_0', { subcategory: 'forest' });
      assert.ok(path.isAbsolute(result));
      assert.ok(result.includes('sprites/terrain/originals/forest'));
      assert.ok(result.endsWith('grass_0.webp'));
    });

    it('returns absolute filesystem path for nodes', async () => {
      const result = await getOriginalsFilePath('nodes', 'castle');
      assert.ok(path.isAbsolute(result));
      assert.ok(result.includes('nodes/originals'));
      assert.ok(result.endsWith('castle.webp'));
    });
  });

  describe('getCharacterOutputPath', () => {
    it('returns absolute path for player character', async () => {
      const result = await getCharacterOutputPath('warrior', { type: 'player', animation: 'idle' });
      assert.ok(path.isAbsolute(result));
      assert.ok(result.includes('characters/player/warrior'));
      assert.ok(result.endsWith('warrior_idle.png'));
    });

    it('uses png extension by default for generation output', async () => {
      const result = await getCharacterOutputPath('warrior');
      assert.ok(result.endsWith('.png'));
    });

    it('returns absolute path for enemy character with biome', async () => {
      const result = await getCharacterOutputPath('goblin_warrior', {
        type: 'enemy',
        biome: 'forest',
        animation: 'attack'
      });
      assert.ok(path.isAbsolute(result));
      assert.ok(result.includes('characters/enemies/forest/goblin_warrior'));
      assert.ok(result.endsWith('goblin_warrior_attack.png'));
    });

    it('defaults to idle animation', async () => {
      const result = await getCharacterOutputPath('warrior');
      assert.ok(result.includes('warrior_idle'));
    });
  });

  describe('getCharacterReferencePath', () => {
    it('returns absolute path for player reference image', async () => {
      const result = await getCharacterReferencePath('warrior');
      assert.ok(path.isAbsolute(result));
      assert.ok(result.includes('characters/player/warrior'));
      assert.ok(result.endsWith('warrior_reference.png'));
    });

    it('returns absolute path for enemy reference image', async () => {
      const result = await getCharacterReferencePath('goblin_warrior', {
        type: 'enemy',
        biome: 'forest'
      });
      assert.ok(path.isAbsolute(result));
      assert.ok(result.includes('characters/enemies/forest/goblin_warrior'));
      assert.ok(result.endsWith('goblin_warrior_reference.png'));
    });
  });

  describe('getCharacterDirectoryPath', () => {
    it('returns absolute path for player character directory', async () => {
      const result = await getCharacterDirectoryPath('warrior');
      assert.ok(path.isAbsolute(result));
      assert.ok(result.endsWith(path.join('characters', 'player', 'warrior')));
    });

    it('returns absolute path for enemy character directory', async () => {
      const result = await getCharacterDirectoryPath('goblin_warrior', {
        type: 'enemy',
        biome: 'forest'
      });
      assert.ok(path.isAbsolute(result));
      assert.ok(result.includes('characters/enemies/forest/goblin_warrior'));
    });
  });

  describe('getObstacleOutputPath', () => {
    it('returns absolute path for rock obstacle', async () => {
      const result = await getObstacleOutputPath('rock_small', 'rocks');
      assert.ok(path.isAbsolute(result));
      assert.ok(result.includes('obstacles/rocks'));
      assert.ok(result.endsWith('rock_small.png'));
    });

    it('returns absolute path for tree obstacle', async () => {
      const result = await getObstacleOutputPath('tree_oak', 'trees');
      assert.ok(path.isAbsolute(result));
      assert.ok(result.includes('obstacles/trees'));
      assert.ok(result.endsWith('tree_oak.png'));
    });

    it('uses png extension by default', async () => {
      const result = await getObstacleOutputPath('rock_small', 'rocks');
      assert.ok(result.endsWith('.png'));
    });

    it('allows custom extension', async () => {
      const result = await getObstacleOutputPath('rock_small', 'rocks', { extension: 'webp' });
      assert.ok(result.endsWith('.webp'));
    });
  });
});
