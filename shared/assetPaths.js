/**
 * @module assetPaths
 * @description Single source of truth for asset path construction across Modia.
 *
 * This module provides utilities for generating asset URLs consistently across
 * the frontend (via @shared alias), API (via relative import), and scripts.
 *
 * Key responsibilities:
 * - Define size presets and defaults for each asset category
 * - Generate legacy paths matching current file structure
 * - Generate standardized paths for future migration
 * - Provide output paths for asset generation scripts
 *
 * @example
 * // Frontend usage
 * import { getAssetUrl, DEFAULT_SIZES } from '@shared/assetPaths.js';
 * const iconUrl = getAssetUrl('icons', 'action_attack', { subcategory: 'actions', size: 32 });
 *
 * @example
 * // API/Script usage
 * import { getOutputPath } from '../../../shared/assetPaths.js';
 * const savePath = getOutputPath('tiles', 'forest_grass_1', { subcategory: 'forest' });
 */

/**
 * Available size options for each asset category
 * @type {Object.<string, number[]>}
 */
export const SIZE_PRESETS = {
  tiles: [64],
  portraits: [64, 128, 256],
  items: [32, 64, 128],
  icons: [16, 24, 32, 48, 64, 128],
  nodes: [48, 96],
  overlays: [32, 48, 64, 128]
};

/**
 * Default size for each asset category when not specified
 * @type {Object.<string, number>}
 */
export const DEFAULT_SIZES = {
  tiles: 64,
  portraits: 64,
  items: 64,
  icons: 32,
  nodes: 96,
  overlays: 64
};

/**
 * Valid asset categories
 * @type {string[]}
 */
export const ASSET_CATEGORIES = ['tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays'];

/**
 * Base path for assets (relative to public directory)
 * @type {string}
 */
const ASSETS_BASE = '/assets';

/**
 * Validates that a category is supported
 * @param {string} category - The asset category
 * @throws {Error} If category is not supported
 */
function validateCategory(category) {
  if (!ASSET_CATEGORIES.includes(category)) {
    throw new Error(`Invalid asset category: ${category}. Must be one of: ${ASSET_CATEGORIES.join(', ')}`);
  }
}

/**
 * Gets the effective size for an asset, using default if not specified
 * @param {string} category - The asset category
 * @param {number} [size] - Optional size override
 * @returns {number} The effective size to use
 */
function getEffectiveSize(category, size) {
  if (size !== undefined) {
    return size;
  }
  return DEFAULT_SIZES[category];
}

/**
 * Generates a legacy path for tiles
 * Handles floors, walls, and slopes with different path patterns:
 * - Floors: /assets/sprites/terrain/{biome}/{key}.png
 * - Walls:  /assets/sprites/terrain/{biome}/walls/{terrain}_wall.png
 * - Slopes: /assets/sprites/terrain/{biome}/slopes/{direction}_{levels}.png
 *
 * @param {string} id - The tile identifier (e.g., 'grass_0', 'wall_base_grass', 'slope_base_north_1')
 * @param {Object} options - Options
 * @param {string} [options.subcategory] - The biome/terrain type (e.g., 'forest', 'cave', 'base')
 * @param {string} [options.tileCategory] - The tile category ('floors', 'walls', 'slopes')
 * @returns {string} The legacy path
 */
function getLegacyTilePath(id, options = {}) {
  const { subcategory = 'base', tileCategory = 'floors' } = options;

  // Handle walls: wall_{biome}_{terrain} -> {biome}/walls/{terrain}_wall.png
  if (tileCategory === 'walls' || id.startsWith('wall_')) {
    // Extract terrain from key like "wall_base_grass" or "wall_castle_default"
    const match = id.match(/^wall_[^_]+_(.+)$/);
    if (match) {
      const terrain = match[1];
      return `${ASSETS_BASE}/sprites/terrain/${subcategory}/walls/${terrain}_wall.png`;
    }
    // Fallback for unexpected wall format
    return `${ASSETS_BASE}/sprites/terrain/${subcategory}/walls/${id}.png`;
  }

  // Handle slopes: slope_{biome}_{direction}_{levels} -> {biome}/slopes/{direction}_{levels}.png
  // Also handles stairs: stairs_{biome}_{direction}_{levels} -> {biome}/slopes/stairs_{direction}_{levels}.png
  if (tileCategory === 'slopes' || id.startsWith('slope_') || id.startsWith('stairs_')) {
    // Handle stairs_base_north_1 -> slopes/stairs_north_1.png
    if (id.startsWith('stairs_')) {
      const match = id.match(/^stairs_[^_]+_(.+)$/);
      if (match) {
        return `${ASSETS_BASE}/sprites/terrain/${subcategory}/slopes/stairs_${match[1]}.png`;
      }
    }
    // Handle slope_base_north_1 -> slopes/north_1.png
    const match = id.match(/^slope_[^_]+_(.+)$/);
    if (match) {
      return `${ASSETS_BASE}/sprites/terrain/${subcategory}/slopes/${match[1]}.png`;
    }
    // Fallback for unexpected slope format
    return `${ASSETS_BASE}/sprites/terrain/${subcategory}/slopes/${id}.png`;
  }

  // Default: floors - use key directly
  return `${ASSETS_BASE}/sprites/terrain/${subcategory}/${id}.png`;
}

/**
 * Generates a legacy path for portraits
 * Pattern: /assets/sprites/portraits/{id}.png OR /assets/sprites/enemies/portraits/{id}.png
 * Size variants use subdirectories: /assets/sprites/portraits/128x128/{id}.png
 * @param {string} id - The portrait identifier (e.g., 'human_male_warrior', 'goblin_warrior')
 * @param {Object} options - Options
 * @param {string} [options.subcategory] - 'characters' or 'enemies'
 * @param {number} [options.size] - Size variant (64, 128, 256). Default (64) uses root directory.
 * @returns {string} The legacy path
 */
function getLegacyPortraitPath(id, options = {}) {
  const { subcategory = 'characters', size } = options;
  const effectiveSize = size !== undefined ? size : DEFAULT_SIZES.portraits;

  // Use subdirectory pattern for non-default sizes: portraits/128x128/human_male_warrior.png
  // Default size (64) uses root directory for backward compatibility
  const sizeDir = effectiveSize !== DEFAULT_SIZES.portraits ? `${effectiveSize}x${effectiveSize}/` : '';

  if (subcategory === 'enemies') {
    return `${ASSETS_BASE}/sprites/enemies/portraits/${sizeDir}${id}.png`;
  }
  return `${ASSETS_BASE}/sprites/portraits/${sizeDir}${id}.png`;
}

/**
 * Generates a legacy path for items
 * Pattern: /assets/sprites/items/{subcategory}/{id}_{size}.png
 * @param {string} id - The item identifier (e.g., 'sword_iron')
 * @param {Object} options - Options
 * @param {string} [options.subcategory] - Item type ('weapons', 'armor', 'accessories', 'consumables')
 * @param {number} [options.size] - Size variant
 * @returns {string} The legacy path
 */
function getLegacyItemPath(id, options = {}) {
  const { subcategory = 'weapons' } = options;
  const size = getEffectiveSize('items', options.size);
  return `${ASSETS_BASE}/sprites/items/${subcategory}/${id}_${size}.png`;
}

/**
 * Generates a legacy path for icons
 * Pattern: /assets/icons/png/{size}/{subcategory}-{id}.png
 * @param {string} id - The icon identifier (e.g., 'action_attack')
 * @param {Object} options - Options
 * @param {string} [options.subcategory] - Icon category ('actions', 'status', 'ui', etc.)
 * @param {number} [options.size] - Size variant
 * @returns {string} The legacy path
 */
function getLegacyIconPath(id, options = {}) {
  const { subcategory = 'actions' } = options;
  const size = getEffectiveSize('icons', options.size);
  return `${ASSETS_BASE}/icons/png/${size}/${subcategory}-${id}.png`;
}

/**
 * Generates a legacy path for world map nodes
 * Pattern: /assets/sprites/nodes/{id}.png
 * Size variants use subdirectories: /assets/sprites/nodes/48x48/{id}.png
 * @param {string} id - The node id (e.g., 'node_castle', 'node_tavern', 'node_forest')
 *                      Note: Metadata stores full id with 'node_' prefix
 * @param {Object} options - Options
 * @param {number} [options.size] - Size variant (48, 96). Default (96) uses root directory.
 * @returns {string} The legacy path
 */
function getLegacyNodePath(id, options = {}) {
  const { size } = options;
  const effectiveSize = size !== undefined ? size : DEFAULT_SIZES.nodes;

  // Use subdirectory pattern for non-default sizes: nodes/48x48/node_castle.png
  // Default size (96) uses root directory for backward compatibility
  const sizeDir = effectiveSize !== DEFAULT_SIZES.nodes ? `${effectiveSize}x${effectiveSize}/` : '';

  // ID already includes 'node_' prefix from metadata (e.g., 'node_castle')
  return `${ASSETS_BASE}/sprites/nodes/${sizeDir}${id}.png`;
}

/**
 * Generates a legacy path for overlays
 * Pattern: /assets/sprites/overlays/{subcategory}/{id}.png
 * @param {string} id - The overlay identifier (e.g., 'rare', 'epic')
 * @param {Object} options - Options
 * @param {string} [options.subcategory] - Overlay type ('rarity', 'augments')
 * @returns {string} The legacy path
 */
function getLegacyOverlayPath(id, options = {}) {
  const { subcategory = 'rarity' } = options;
  return `${ASSETS_BASE}/sprites/overlays/${subcategory}/${id}.png`;
}

/**
 * Generates a legacy path for any asset category
 * @param {string} category - Asset category ('tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays')
 * @param {string} id - Asset identifier
 * @param {Object} [options] - Category-specific options
 * @param {string} [options.subcategory] - Subcategory for organization
 * @param {number} [options.size] - Size variant (where applicable)
 * @returns {string} The legacy path
 */
export function getLegacyPath(category, id, options = {}) {
  validateCategory(category);

  switch (category) {
    case 'tiles':
      return getLegacyTilePath(id, options);
    case 'portraits':
      return getLegacyPortraitPath(id, options);
    case 'items':
      return getLegacyItemPath(id, options);
    case 'icons':
      return getLegacyIconPath(id, options);
    case 'nodes':
      return getLegacyNodePath(id, options);
    case 'overlays':
      return getLegacyOverlayPath(id, options);
    default:
      throw new Error(`Unhandled category: ${category}`);
  }
}

/**
 * Generates a standardized path for any asset (future migration target)
 * Pattern: /assets/{type}/png/{size}/{subcategory}-{id}.png
 * @param {string} category - Asset category ('tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays')
 * @param {string} id - Asset identifier
 * @param {Object} [options] - Options
 * @param {string} [options.subcategory] - Subcategory for organization
 * @param {number} [options.size] - Size variant
 * @returns {string} The standardized path
 */
export function getStandardizedPath(category, id, options = {}) {
  validateCategory(category);

  const { subcategory = 'default' } = options;
  const size = getEffectiveSize(category, options.size);

  return `${ASSETS_BASE}/${category}/png/${size}/${subcategory}-${id}.png`;
}

/**
 * Gets the asset URL based on category and options
 *
 * This is the main function for retrieving asset URLs. By default, it returns
 * legacy paths matching the current file structure. Set useLegacyPath to false
 * to get the standardized format for future migration.
 *
 * @param {string} category - Asset category ('tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays')
 * @param {string} id - Asset identifier (varies by category)
 * @param {Object} [options] - Options for path generation
 * @param {number} [options.size] - Size variant (uses category default if not specified)
 * @param {string} [options.subcategory] - Subcategory for organization (meaning varies by category)
 * @param {boolean} [options.useLegacyPath=true] - Whether to use legacy path format
 * @returns {string} The asset URL
 *
 * @example
 * // Tile (terrain) - no size variants
 * getAssetUrl('tiles', 'forest_grass_1_v0', { subcategory: 'forest' });
 * // => '/assets/sprites/terrain/forest/forest_grass_1_v0.png'
 *
 * @example
 * // Portrait - character
 * getAssetUrl('portraits', 'human_male_warrior');
 * // => '/assets/sprites/portraits/human_male_warrior.png'
 *
 * @example
 * // Portrait - enemy
 * getAssetUrl('portraits', 'goblin_warrior', { subcategory: 'enemies' });
 * // => '/assets/sprites/enemies/portraits/goblin_warrior.png'
 *
 * @example
 * // Item with size
 * getAssetUrl('items', 'sword_iron', { subcategory: 'weapons', size: 32 });
 * // => '/assets/sprites/items/weapons/sword_iron_32.png'
 *
 * @example
 * // Icon with size
 * getAssetUrl('icons', 'action_attack', { subcategory: 'actions', size: 48 });
 * // => '/assets/icons/png/48/actions-action_attack.png'
 *
 * @example
 * // Node (world map)
 * getAssetUrl('nodes', 'castle');
 * // => '/assets/sprites/nodes/node_castle.png'
 *
 * @example
 * // Overlay
 * getAssetUrl('overlays', 'rare', { subcategory: 'rarity' });
 * // => '/assets/sprites/overlays/rarity/rare.png'
 */
export function getAssetUrl(category, id, options = {}) {
  const { useLegacyPath = true, ...pathOptions } = options;

  if (useLegacyPath) {
    return getLegacyPath(category, id, pathOptions);
  }

  return getStandardizedPath(category, id, pathOptions);
}

/**
 * Gets the output path for asset generation scripts
 *
 * This returns a relative path from the project root suitable for scripts
 * that generate and save asset files. Always uses legacy format to match
 * the current directory structure.
 *
 * @param {string} category - Asset category
 * @param {string} id - Asset identifier
 * @param {Object} [options] - Options
 * @param {string} [options.subcategory] - Subcategory
 * @param {number} [options.size] - Size variant
 * @returns {string} The output path relative to project root
 *
 * @example
 * getOutputPath('tiles', 'forest_grass_1_v0', { subcategory: 'forest' });
 * // => 'frontend/public/assets/sprites/terrain/forest/forest_grass_1_v0.png'
 *
 * @example
 * getOutputPath('icons', 'action_attack', { subcategory: 'actions', size: 32 });
 * // => 'frontend/public/assets/icons/png/32/actions-action_attack.png'
 */
export function getOutputPath(category, id, options = {}) {
  const legacyPath = getLegacyPath(category, id, options);
  // Remove leading slash and prepend frontend/public
  return `frontend/public${legacyPath}`;
}

/**
 * Gets all size variants for an asset category
 *
 * Useful for generating multiple size variants of the same asset.
 *
 * @param {string} category - Asset category
 * @param {string} id - Asset identifier
 * @param {Object} [options] - Base options (subcategory, etc.)
 * @returns {Array<{size: number, url: string}>} Array of size/URL pairs
 *
 * @example
 * getAllSizeVariants('items', 'sword_iron', { subcategory: 'weapons' });
 * // => [
 * //   { size: 32, url: '/assets/sprites/items/weapons/sword_iron_32.png' },
 * //   { size: 64, url: '/assets/sprites/items/weapons/sword_iron_64.png' },
 * //   { size: 128, url: '/assets/sprites/items/weapons/sword_iron_128.png' }
 * // ]
 */
export function getAllSizeVariants(category, id, options = {}) {
  validateCategory(category);

  const sizes = SIZE_PRESETS[category];
  return sizes.map(size => ({
    size,
    url: getAssetUrl(category, id, { ...options, size })
  }));
}

/**
 * Checks if a size is valid for a given category
 *
 * @param {string} category - Asset category
 * @param {number} size - Size to check
 * @returns {boolean} True if the size is valid for the category
 *
 * @example
 * isValidSize('icons', 32); // => true
 * isValidSize('icons', 50); // => false
 */
export function isValidSize(category, size) {
  validateCategory(category);
  return SIZE_PRESETS[category].includes(size);
}

/**
 * Gets the default size for a category
 *
 * @param {string} category - Asset category
 * @returns {number} The default size
 */
export function getDefaultSize(category) {
  validateCategory(category);
  return DEFAULT_SIZES[category];
}

/**
 * Gets the optimal available size for a requested display size
 *
 * Returns the smallest preset size that is >= the requested display size,
 * or the largest preset size if the display exceeds all presets.
 * This ensures crisp rendering without unnecessary large assets.
 *
 * @param {string} category - Asset category
 * @param {number} displaySize - Target display size in pixels
 * @returns {number} The optimal preset size to use
 *
 * @example
 * getOptimalSize('portraits', 48);  // => 64 (smallest >= 48)
 * getOptimalSize('portraits', 64);  // => 64 (exact match)
 * getOptimalSize('portraits', 100); // => 128 (smallest >= 100)
 * getOptimalSize('portraits', 300); // => 256 (largest available)
 *
 * @example
 * getOptimalSize('nodes', 40);  // => 48 (smallest >= 40)
 * getOptimalSize('nodes', 60);  // => 96 (smallest >= 60)
 * getOptimalSize('nodes', 120); // => 96 (largest available)
 */
export function getOptimalSize(category, displaySize) {
  validateCategory(category);
  const sizes = SIZE_PRESETS[category];

  // Find smallest size >= displaySize
  for (const size of sizes) {
    if (size >= displaySize) return size;
  }

  // If display exceeds all presets, return largest
  return sizes[sizes.length - 1];
}

/**
 * Parses an asset filename to extract category, id, and options
 *
 * @param {string} filename - The filename to parse
 * @param {string} category - The asset category (needed for context)
 * @returns {Object|null} Parsed info or null if unable to parse
 *
 * @example
 * parseAssetFilename('sword_iron_32.png', 'items');
 * // => { id: 'sword_iron', size: 32 }
 *
 * @example
 * parseAssetFilename('actions-action_attack.png', 'icons');
 * // => { id: 'action_attack', subcategory: 'actions' }
 */
export function parseAssetFilename(filename, category) {
  validateCategory(category);

  // Remove .png extension
  const baseName = filename.replace(/\.png$/, '');

  switch (category) {
    case 'items': {
      // Pattern: {id}_{size}
      const match = baseName.match(/^(.+)_(\d+)$/);
      if (match) {
        return { id: match[1], size: parseInt(match[2], 10) };
      }
      return { id: baseName };
    }

    case 'icons': {
      // Pattern: {subcategory}-{id}
      const match = baseName.match(/^([^-]+)-(.+)$/);
      if (match) {
        return { subcategory: match[1], id: match[2] };
      }
      return { id: baseName };
    }

    case 'nodes': {
      // Pattern: node_{type} - return full id including prefix
      // Metadata stores full id (e.g., 'node_castle', not 'castle')
      return { id: baseName };
    }

    case 'tiles':
    case 'portraits':
    case 'overlays':
    default:
      return { id: baseName };
  }
}
