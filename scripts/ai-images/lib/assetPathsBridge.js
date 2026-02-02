/**
 * CommonJS bridge to shared/assetPaths.js (ESM)
 *
 * Provides cached async access to the canonical asset path module plus
 * synchronous constants for code that cannot use async/await.
 *
 * Pattern adapted from resizeUtils.js dynamic import cache.
 */

const path = require('path');
const { getProjectRoot } = require('./imageUtils');

// Cached dynamic import (ESM from CJS)
let _cache = null;

/**
 * Get the shared assetPaths ESM module (cached after first call)
 * @returns {Promise<Object>} The shared/assetPaths.js module
 */
async function getAssetPathsModule() {
  if (!_cache) {
    _cache = await import('../../../shared/assetPaths.js');
  }
  return _cache;
}

/**
 * Resize-specific size presets not defined in shared/assetPaths.js
 * These are only used for resize operations on non-square tile types.
 * @type {Object.<string, number[]>}
 */
const RESIZE_SPECIFIC_PRESETS = {
  walls: [64],   // 128x32 AI -> 64x16 (non-square resize)
  slopes: [64]   // 128x160 AI -> 64x80 (non-square resize)
};

// Cached merged SIZE_PRESETS
let _mergedSizePresets = null;

/**
 * Get SIZE_PRESETS merged with resize-specific additions (cached)
 * @returns {Promise<Object>} Merged size presets object
 */
async function getSizePresets() {
  if (!_mergedSizePresets) {
    const assetPaths = await getAssetPathsModule();
    _mergedSizePresets = {
      ...assetPaths.SIZE_PRESETS,
      ...RESIZE_SPECIFIC_PRESETS
    };
  }
  return _mergedSizePresets;
}

/**
 * Synchronous base directory mapping: category -> relative path under assets/
 * Matches the canonical paths in shared/assetPaths.js.
 */
const CATEGORY_BASE_DIRS = {
  tiles: 'sprites/terrain',
  portraits: 'portraits',
  items: 'items',
  icons: 'icons',
  nodes: 'nodes',
  overlays: 'overlays',
  characters: 'characters',
  obstacles: 'obstacles'
};

/**
 * Get absolute filesystem path to a category's asset root directory (sync)
 * @param {string} category - Asset category (tiles, portraits, items, icons, nodes, overlays)
 * @returns {string|null} Absolute path or null if unknown category
 */
function getOutputDir(category) {
  const baseDir = CATEGORY_BASE_DIRS[category];
  if (!baseDir) return null;
  return path.join(getProjectRoot(), 'frontend/public/assets', baseDir);
}

/**
 * Get absolute filesystem path to an asset's originals file (async)
 * Delegates to shared/assetPaths.js getOriginalsPath() for canonical path construction.
 * @param {string} category - Asset category
 * @param {string} id - Asset identifier
 * @param {Object} [options] - Options passed to getOriginalsPath (subcategory, etc.)
 * @returns {Promise<string>} Absolute filesystem path to the originals file
 */
async function getOriginalsFilePath(category, id, options = {}) {
  const assetPaths = await getAssetPathsModule();
  // getOriginalsPath returns a URL-style path like /assets/portraits/originals/foo.png
  // We need the filesystem path: {projectRoot}/frontend/public/assets/...
  const urlPath = assetPaths.getOriginalsPath(category, id, options);
  return path.join(getProjectRoot(), 'frontend/public', urlPath);
}

/**
 * Get absolute filesystem path for a character sprite sheet (async)
 * @param {string} id - Character identifier (class for players, id for enemies)
 * @param {Object} [options] - Options
 * @param {string} [options.type='player'] - Character type ('player' or 'enemy')
 * @param {string} [options.biome] - Biome (required for enemies)
 * @param {string} [options.animation='idle'] - Animation type
 * @param {string} [options.extension='png'] - File extension (PNG for generation output)
 * @returns {Promise<string>} Absolute filesystem path
 */
async function getCharacterOutputPath(id, options = {}) {
  const assetPaths = await getAssetPathsModule();
  const urlPath = assetPaths.getCharacterPath(id, { ...options, extension: options.extension || 'png' });
  return path.join(getProjectRoot(), 'frontend/public', urlPath);
}

/**
 * Get absolute filesystem path for a character reference image (async)
 * @param {string} id - Character identifier
 * @param {Object} [options] - Options
 * @param {string} [options.type='player'] - Character type
 * @param {string} [options.biome] - Biome (required for enemies)
 * @returns {Promise<string>} Absolute filesystem path to reference image
 */
async function getCharacterReferencePath(id, options = {}) {
  const assetPaths = await getAssetPathsModule();
  const urlPath = assetPaths.getCharacterReferencePath(id, options);
  return path.join(getProjectRoot(), 'frontend/public', urlPath);
}

/**
 * Get absolute filesystem path for a character directory (async)
 * @param {string} id - Character identifier
 * @param {Object} [options] - Options
 * @param {string} [options.type='player'] - Character type
 * @param {string} [options.biome] - Biome (required for enemies)
 * @returns {Promise<string>} Absolute filesystem path to character directory
 */
async function getCharacterDirectoryPath(id, options = {}) {
  const assetPaths = await getAssetPathsModule();
  const urlPath = assetPaths.getCharacterDirectory(id, options);
  return path.join(getProjectRoot(), 'frontend/public', urlPath);
}

/**
 * Get obstacle output path (async)
 * @param {string} id - Obstacle identifier
 * @param {string} category - Obstacle category ('rocks' or 'trees')
 * @param {Object} [options] - Options
 * @param {string} [options.extension='png'] - File extension
 * @returns {Promise<string>} Absolute filesystem path
 */
async function getObstacleOutputPath(id, category, options = {}) {
  const assetPaths = await getAssetPathsModule();
  const urlPath = assetPaths.getObstaclePath(id, category, { extension: options.extension || 'png' });
  return path.join(getProjectRoot(), 'frontend/public', urlPath);
}

module.exports = {
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
};
