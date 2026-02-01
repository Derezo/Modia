/**
 * Shared Category Constants
 *
 * Centralized category definitions for the admin dashboard.
 * These should be kept in sync with api/src/utils/assetConstants.js
 *
 * @module categories
 */

/**
 * Valid image asset categories
 * Fallback - kept in sync with api/src/utils/assetConstants.js
 * @type {string[]}
 */
export const IMAGE_CATEGORIES = [
  'tiles',
  'portraits',
  'items',
  'icons',
  'nodes',
  'overlays',
  'obstacles',
  'characters',
];

/**
 * Valid audio asset categories
 * @type {string[]}
 */
export const AUDIO_CATEGORIES = ['music', 'sfx'];

/**
 * Human-readable labels for all categories
 * @type {Object<string, string>}
 */
export const CATEGORY_LABELS = {
  tiles: 'Tiles',
  portraits: 'Portraits',
  items: 'Items',
  icons: 'Icons',
  nodes: 'Nodes',
  overlays: 'Overlays',
  obstacles: 'Obstacles',
  characters: 'Characters',
  music: 'Music',
  sfx: 'Sound Effects',
};

/**
 * Get human-readable label for a category
 * Falls back to title-cased category name for unknown categories
 *
 * @param {string} category - Category identifier
 * @returns {string} Display label
 */
export function getCategoryLabel(category) {
  if (CATEGORY_LABELS[category]) {
    return CATEGORY_LABELS[category];
  }
  // Warn about unknown category in development
  if (import.meta.env.DEV) {
    console.warn(`[categories] Unknown category: "${category}" - using fallback label`);
  }
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * Check if a category is an image category
 * @param {string} category - Category to check
 * @returns {boolean}
 */
export function isImageCategory(category) {
  return IMAGE_CATEGORIES.includes(category);
}

/**
 * Check if a category is an audio category
 * @param {string} category - Category to check
 * @returns {boolean}
 */
export function isAudioCategory(category) {
  return AUDIO_CATEGORIES.includes(category);
}

/**
 * Check if a category is valid (either image or audio)
 * @param {string} category - Category to check
 * @returns {boolean}
 */
export function isValidCategory(category) {
  return isImageCategory(category) || isAudioCategory(category);
}
