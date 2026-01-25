/**
 * Asset path helper with fallback support for transition period
 * Tries canonical paths first, falls back to legacy sprite paths
 */

import { getAssetPath, DEFAULT_SIZES } from '@shared/assetPaths.js';

/**
 * Get subcategory for an asset based on category and asset metadata
 */
export function getAssetSubcategory(asset, category) {
  // Handle different field names per category
  if (category === 'tiles') {
    return asset._biome || asset.outputPath || 'base';
  }
  if (category === 'items') {
    return asset._itemCategory || asset._subcategory || asset.subcategory || 'weapons';
  }
  if (category === 'icons') {
    return asset._iconCategory || asset._subcategory || asset.subcategory || 'actions';
  }
  if (category === 'portraits') {
    return asset._type || asset.type;
  }
  if (category === 'overlays') {
    return asset._overlayCategory || asset._subcategory || asset.subcategory || 'rarity';
  }
  return asset._subcategory || asset.subcategory;
}

/**
 * Get extra options for asset path generation (e.g., tileCategory for tiles)
 */
export function getAssetExtraOptions(asset, category) {
  const options = {};
  if (category === 'tiles' && asset._tileCategory) {
    options.tileCategory = asset._tileCategory;
  }
  return options;
}

/**
 * Get legacy fallback paths for assets that may not have been migrated yet
 */
function getLegacyPaths(category, id, options = {}) {
  const { subcategory } = options;

  switch (category) {
    case 'portraits': {
      const isEnemy = subcategory === 'enemy' || subcategory === 'enemies';
      if (isEnemy) {
        return [`/assets/sprites/enemies/portraits/${id}.png`];
      }
      return [`/assets/sprites/portraits/${id}.png`];
    }
    case 'items':
      return [`/assets/sprites/items/${subcategory || 'weapons'}/${id}.png`];
    case 'nodes':
      return [`/assets/sprites/nodes/${id}.png`];
    case 'overlays':
      return [`/assets/sprites/overlays/${subcategory || 'rarity'}/${id}.png`];
    default:
      return [];
  }
}

/**
 * Get asset URLs with fallback support
 * Returns array of URLs to try in order (canonical first, then legacy)
 *
 * @param {string} category - Asset category
 * @param {string} id - Asset identifier
 * @param {Object} options - Options (subcategory, size, etc.)
 * @returns {string[]} Array of URLs to try
 */
export function getAssetUrlsWithFallback(category, id, options = {}) {
  const urls = [];
  const size = options.size || DEFAULT_SIZES[category];

  // Primary: canonical path from assetPaths.js
  try {
    urls.push(getAssetPath(category, id, { ...options, size }));
  } catch (e) {
    // Category not supported, skip canonical path
  }

  // Fallback: legacy sprite paths
  const legacyPaths = getLegacyPaths(category, id, options);
  urls.push(...legacyPaths);

  return urls;
}

/**
 * Get primary asset URL (canonical path)
 * Use this when you expect files to be in the correct location
 */
export function getAssetUrl(category, id, options = {}) {
  const size = options.size || DEFAULT_SIZES[category];
  return getAssetPath(category, id, { ...options, size });
}

/**
 * Get asset URL for grid display with fallback
 * Computes path from asset metadata
 */
export function getAssetImageUrl(asset, category) {
  const id = asset.key || asset.id;
  const subcategory = getAssetSubcategory(asset, category);
  const extraOptions = getAssetExtraOptions(asset, category);
  const size = DEFAULT_SIZES[category];

  // For tiles, use the canonical path directly (tiles work correctly)
  if (category === 'tiles') {
    return getAssetPath(category, id, { subcategory, size, ...extraOptions });
  }

  // For other categories, get fallback URLs and return the first one
  // Components should use onError to try next URL
  const urls = getAssetUrlsWithFallback(category, id, { subcategory, size, ...extraOptions });
  return urls[0] || null;
}

/**
 * Create an image loader that tries multiple URLs
 * Returns a function that can be used as onError handler
 */
export function createFallbackLoader(urls, onAllFailed) {
  let currentIndex = 0;

  return function handleError(event) {
    currentIndex++;
    if (currentIndex < urls.length) {
      event.target.src = urls[currentIndex];
    } else if (onAllFailed) {
      onAllFailed();
    }
  };
}
