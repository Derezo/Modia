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
 * Synchronous base directory mapping: category -> relative path under assets/
 * Matches the canonical paths in shared/assetPaths.js.
 */
const CATEGORY_BASE_DIRS = {
  tiles: 'sprites/terrain',
  portraits: 'portraits',
  items: 'items',
  icons: 'icons',
  nodes: 'nodes',
  overlays: 'overlays'
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

module.exports = {
  getAssetPathsModule,
  CATEGORY_BASE_DIRS,
  getOutputDir,
  getOriginalsFilePath
};
