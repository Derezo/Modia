/**
 * Asset path helper for canonical asset paths
 * All assets use the canonical path structure from shared/assetPaths.js
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
 * Get canonical asset URLs
 * Returns array with the canonical path for the asset
 *
 * @param {string} category - Asset category
 * @param {string} id - Asset identifier
 * @param {Object} options - Options (subcategory, size, etc.)
 * @returns {string[]} Array of URLs (canonical path)
 */
export function getAssetUrls(category, id, options = {}) {
  const urls = [];
  const size = options.size || DEFAULT_SIZES[category];

  try {
    urls.push(getAssetPath(category, id, { ...options, size }));
  } catch (e) {
    // Category not supported
  }

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
 * Get asset URL for grid display
 * Computes canonical path from asset metadata
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

  // For other categories, get canonical URLs and return the first one
  const urls = getAssetUrls(category, id, { subcategory, size, ...extraOptions });
  return urls[0] || null;
}
