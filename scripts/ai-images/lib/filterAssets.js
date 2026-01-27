/**
 * @module filterAssets
 * @description Shared asset filtering utilities for AI image generation scripts.
 *
 * Provides key-based filtering that works across all asset types (icons, tiles,
 * portraits, items, nodes, overlays). Supports matching on both a primary ID
 * field and a fallback 'key' field.
 */

/**
 * Apply key-based filtering to assets.
 *
 * Matches assets whose primary ID field or 'key' field appears in the provided
 * keys array. When keys is empty or not provided, all assets are returned.
 *
 * @param {Array} assets - Array of asset objects
 * @param {string[]} keys - Keys to filter by (empty = no filter)
 * @param {string} [idField='id'] - Primary ID field name to match against
 * @returns {Array} Filtered assets (or all assets if no keys provided)
 *
 * @example
 * const filtered = applyKeyFilter(allIcons, ['action_attack', 'action_defend']);
 *
 * @example
 * // Use a custom ID field
 * const filtered = applyKeyFilter(tiles, ['forest_grass_1'], 'tileId');
 */
function applyKeyFilter(assets, keys, idField = 'id') {
  if (!keys || keys.length === 0) return assets;
  const keySet = new Set(keys);
  return assets.filter(a => keySet.has(a[idField]) || keySet.has(a.key));
}

module.exports = { applyKeyFilter };
