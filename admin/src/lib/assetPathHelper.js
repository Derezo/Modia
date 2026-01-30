/**
 * Asset path helper for canonical asset paths
 * All assets use the canonical path structure from shared/assetPaths.js
 */

import { getAssetPath, DEFAULT_SIZES } from '@shared/assetPaths.js';
import { normalizeIconId } from '@shared/iconCategories.js';

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
  if (category === 'characters') {
    return asset._type || 'players';  // 'players' or 'enemies'
  }
  if (category === 'obstacles') {
    return asset._obstacleCategory || asset._subcategory || 'rocks';
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

  // Normalize icon IDs to match file naming convention
  // Icon metadata uses full IDs (menu_fishing) but files use stripped names (fishing.png)
  const normalizedId = category === 'icons' && options.subcategory
    ? normalizeIconId(id, options.subcategory)
    : id;

  try {
    urls.push(getAssetPath(category, normalizedId, { ...options, size }));
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

  // Normalize icon IDs to match file naming convention
  // Icon metadata uses full IDs (menu_fishing) but files use stripped names (fishing.png)
  const normalizedId = category === 'icons'
    ? normalizeIconId(id, subcategory)
    : id;

  // For tiles, use the canonical path directly (tiles work correctly)
  if (category === 'tiles') {
    return getAssetPath(category, id, { subcategory, size, ...extraOptions });
  }

  // For characters, use type-based path structure (players vs enemies)
  // Pattern: /assets/sprites/characters/{type}/{size}/{id}.png
  if (category === 'characters') {
    const type = subcategory || 'players';  // 'players' or 'enemies'
    const charSize = size || 64;
    return `/assets/sprites/characters/${type}/${charSize}/${id}.png`;
  }

  // For obstacles, use category-based path structure
  // Pattern: /assets/sprites/obstacles/{obstacleCategory}/{id}.png
  if (category === 'obstacles') {
    const obstacleCategory = subcategory || 'rocks';
    return `/assets/sprites/obstacles/${obstacleCategory}/${id}.png`;
  }

  // For other categories, get canonical URLs and return the first one
  const urls = getAssetUrls(category, normalizedId, { subcategory, size, ...extraOptions });
  return urls[0] || null;
}
