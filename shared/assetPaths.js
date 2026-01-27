/**
 * @module assetPaths
 * @description Single source of truth for asset path construction across Modia.
 *
 * This module provides utilities for generating asset URLs consistently across
 * the frontend (via @shared alias), API (via relative import), and scripts.
 *
 * Key responsibilities:
 * - Define size presets and defaults for each asset category
 * - Generate standardized paths for all asset types
 * - Provide output paths for asset generation scripts
 * - Provide originals paths for source image preservation
 *
 * @example
 * // Frontend usage
 * import { getAssetPath, getOptimalSize } from '@shared/assetPaths.js';
 * const iconPath = getAssetPath('icons', 'attack', { subcategory: 'actions', size: 32 });
 *
 * @example
 * // API/Script usage
 * import { getOutputPath } from '../../../shared/assetPaths.js';
 * const savePath = getOutputPath('portraits', 'human_male_warrior', { size: 64 });
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
  nodes: [48, 64, 96, 128, 256],
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
 * Generates path for portraits (unified player + enemy)
 * Pattern: /assets/portraits/{size}/{id}.png
 * - Player IDs: {race}_{gender}_{class} (e.g., 'human_male_warrior')
 * - Enemy IDs: enemy_{name} (e.g., 'enemy_goblin_warrior')
 *
 * @param {string} id - The portrait identifier
 * @param {Object} options - Options
 * @param {number} [options.size] - Size variant (64, 128, 256)
 * @returns {string} The portrait path
 */
function getPortraitPath(id, options = {}) {
  const size = getEffectiveSize('portraits', options.size);
  return `${ASSETS_BASE}/portraits/${size}/${id}.png`;
}

/**
 * Generates path for world map nodes
 * Pattern: /assets/nodes/{size}/{id}.png
 * IDs no longer have 'node_' prefix (e.g., 'castle', not 'node_castle')
 *
 * @param {string} id - The node identifier (e.g., 'castle', 'tavern', 'guild_warrior')
 * @param {Object} options - Options
 * @param {number} [options.size] - Size variant (48, 64, 96, 128, 256)
 * @returns {string} The node path
 */
function getNodePath(id, options = {}) {
  const size = getEffectiveSize('nodes', options.size);
  return `${ASSETS_BASE}/nodes/${size}/${id}.png`;
}

/**
 * Generates path for items
 * Pattern: /assets/items/{size}/{subcategory}/{id}.png
 *
 * @param {string} id - The item identifier (e.g., 'sword_iron')
 * @param {Object} options - Options
 * @param {string} [options.subcategory='weapons'] - Item type
 * @param {number} [options.size] - Size variant (32, 64, 128)
 * @returns {string} The item path
 */
function getItemPath(id, options = {}) {
  const { subcategory = 'weapons' } = options;
  const size = getEffectiveSize('items', options.size);
  return `${ASSETS_BASE}/items/${size}/${subcategory}/${id}.png`;
}

/**
 * Generates path for icons
 * Pattern: /assets/icons/png/{size}/{subcategory}/{id}.png
 *
 * @param {string} id - The icon identifier (e.g., 'attack')
 * @param {Object} options - Options
 * @param {string} [options.subcategory='actions'] - Icon category
 * @param {number} [options.size] - Size variant (16, 24, 32, 48, 64, 128)
 * @returns {string} The icon path
 */
function getIconPath(id, options = {}) {
  const { subcategory = 'actions' } = options;
  const size = getEffectiveSize('icons', options.size);
  return `${ASSETS_BASE}/icons/png/${size}/${subcategory}/${id}.png`;
}

/**
 * Generates path for terrain tiles
 * Pattern: /assets/sprites/terrain/{biome}/{id}.png
 * For walls: /assets/sprites/terrain/{biome}/walls/{terrain}_wall.png
 * For slopes: /assets/sprites/terrain/{biome}/slopes/{direction}_{levels}.png
 *
 * @param {string} id - The tile identifier (e.g., 'grass_0', 'wall_forest_grass', 'slope_north_1')
 * @param {Object} options - Options
 * @param {string} [options.subcategory='forest'] - Biome type (forest, cave, mountain, bridge, castle)
 * @param {string} [options.tileCategory='floors'] - Tile category (floors, walls, slopes)
 * @returns {string} The tile path
 */
function getTilePath(id, options = {}) {
  const { subcategory = 'forest', tileCategory = 'floors' } = options;

  // Handle walls: wall_{biome}_{terrain} -> {biome}/walls/{terrain}_wall.png
  if (tileCategory === 'walls' || id.startsWith('wall_')) {
    const match = id.match(/^wall_[^_]+_(.+)$/);
    if (match) {
      const terrain = match[1];
      return `${ASSETS_BASE}/sprites/terrain/${subcategory}/walls/${terrain}_wall.png`;
    }
    return `${ASSETS_BASE}/sprites/terrain/${subcategory}/walls/${id}.png`;
  }

  // Handle slopes: slope_{biome}_{direction}_{levels} -> {biome}/slopes/{direction}_{levels}.png
  // Also handles stairs: stairs_{biome}_{direction}_{levels} -> {biome}/slopes/stairs_{direction}_{levels}.png
  if (tileCategory === 'slopes' || id.startsWith('slope_') || id.startsWith('stairs_')) {
    if (id.startsWith('stairs_')) {
      const match = id.match(/^stairs_[^_]+_(.+)$/);
      if (match) {
        return `${ASSETS_BASE}/sprites/terrain/${subcategory}/slopes/stairs_${match[1]}.png`;
      }
    }
    const match = id.match(/^slope_[^_]+_(.+)$/);
    if (match) {
      return `${ASSETS_BASE}/sprites/terrain/${subcategory}/slopes/${match[1]}.png`;
    }
    return `${ASSETS_BASE}/sprites/terrain/${subcategory}/slopes/${id}.png`;
  }

  // Default: floors - use id directly
  return `${ASSETS_BASE}/sprites/terrain/${subcategory}/${id}.png`;
}

/**
 * Generates path for overlays
 * Pattern: /assets/overlays/{size}/{subcategory}/{id}.png
 *
 * @param {string} id - The overlay identifier (e.g., 'rare', 'fire')
 * @param {Object} options - Options
 * @param {string} [options.subcategory='rarity'] - Overlay type (rarity, augments)
 * @param {number} [options.size] - Size variant (32, 48, 64, 128)
 * @returns {string} The overlay path
 */
function getOverlayPath(id, options = {}) {
  const { subcategory = 'rarity' } = options;
  const size = getEffectiveSize('overlays', options.size);
  return `${ASSETS_BASE}/overlays/${size}/${subcategory}/${id}.png`;
}

/**
 * Gets the asset path for any category
 *
 * This is the main function for retrieving asset paths. It generates
 * standardized paths based on category and options.
 *
 * @param {string} category - Asset category ('tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays')
 * @param {string} id - Asset identifier (varies by category)
 * @param {Object} [options] - Options for path generation
 * @param {number} [options.size] - Size variant (uses category default if not specified)
 * @param {string} [options.subcategory] - Subcategory for organization (meaning varies by category)
 * @param {string} [options.tileCategory] - For tiles only: 'floors', 'walls', or 'slopes'
 * @returns {string} The asset path
 *
 * @example
 * // Portrait (player)
 * getAssetPath('portraits', 'human_male_warrior', { size: 64 });
 * // => '/assets/portraits/64/human_male_warrior.png'
 *
 * @example
 * // Portrait (enemy)
 * getAssetPath('portraits', 'enemy_goblin_warrior', { size: 64 });
 * // => '/assets/portraits/64/enemy_goblin_warrior.png'
 *
 * @example
 * // Node (no node_ prefix)
 * getAssetPath('nodes', 'castle', { size: 96 });
 * // => '/assets/nodes/96/castle.png'
 *
 * @example
 * // Item (size in path, not filename)
 * getAssetPath('items', 'sword_iron', { subcategory: 'weapons', size: 64 });
 * // => '/assets/items/64/weapons/sword_iron.png'
 *
 * @example
 * // Icon
 * getAssetPath('icons', 'attack', { subcategory: 'actions', size: 32 });
 * // => '/assets/icons/png/32/actions/attack.png'
 *
 * @example
 * // Terrain tile
 * getAssetPath('tiles', 'grass_0', { subcategory: 'forest' });
 * // => '/assets/sprites/terrain/forest/grass_0.png'
 *
 * @example
 * // Overlay
 * getAssetPath('overlays', 'rare', { subcategory: 'rarity', size: 64 });
 * // => '/assets/overlays/64/rarity/rare.png'
 */
export function getAssetPath(category, id, options = {}) {
  validateCategory(category);

  switch (category) {
    case 'portraits':
      return getPortraitPath(id, options);
    case 'nodes':
      return getNodePath(id, options);
    case 'items':
      return getItemPath(id, options);
    case 'icons':
      return getIconPath(id, options);
    case 'tiles':
      return getTilePath(id, options);
    case 'overlays':
      return getOverlayPath(id, options);
    default:
      throw new Error(`Unhandled category: ${category}`);
  }
}

/**
 * Gets the path to the original source image
 *
 * Every asset category maintains an originals/ subdirectory with
 * full-resolution AI-generated source images.
 *
 * @param {string} category - Asset category
 * @param {string} id - Asset identifier
 * @param {Object} [options] - Options
 * @param {string} [options.subcategory] - Subcategory for organization
 * @returns {string} The originals path
 *
 * @example
 * getOriginalsPath('portraits', 'human_male_warrior');
 * // => '/assets/portraits/originals/human_male_warrior.png'
 *
 * @example
 * getOriginalsPath('items', 'sword_iron', { subcategory: 'weapons' });
 * // => '/assets/items/originals/weapons/sword_iron.png'
 *
 * @example
 * getOriginalsPath('tiles', 'grass_0', { subcategory: 'forest' });
 * // => '/assets/sprites/terrain/originals/forest/grass_0.png'
 */
export function getOriginalsPath(category, id, options = {}) {
  validateCategory(category);

  const { subcategory } = options;

  switch (category) {
    case 'portraits':
    case 'nodes':
      return `${ASSETS_BASE}/${category}/originals/${id}.png`;

    case 'items':
    case 'icons':
    case 'overlays': {
      const sub = subcategory || (category === 'items' ? 'weapons' : category === 'icons' ? 'actions' : 'rarity');
      return `${ASSETS_BASE}/${category}/originals/${sub}/${id}.png`;
    }

    case 'tiles': {
      const biome = subcategory || 'forest';
      return `${ASSETS_BASE}/sprites/terrain/originals/${biome}/${id}.png`;
    }

    default:
      throw new Error(`Unhandled category: ${category}`);
  }
}

/**
 * Gets the output path for asset generation scripts
 *
 * Returns a relative path from the project root suitable for scripts
 * that generate and save asset files.
 *
 * @param {string} category - Asset category
 * @param {string} id - Asset identifier
 * @param {Object} [options] - Options
 * @param {string} [options.subcategory] - Subcategory
 * @param {number} [options.size] - Size variant
 * @param {boolean} [options.original] - If true, returns path to originals directory
 * @returns {string} The output path relative to project root
 *
 * @example
 * getOutputPath('portraits', 'human_male_warrior', { size: 64 });
 * // => 'frontend/public/assets/portraits/64/human_male_warrior.png'
 *
 * @example
 * getOutputPath('nodes', 'castle', { size: 96 });
 * // => 'frontend/public/assets/nodes/96/castle.png'
 *
 * @example
 * getOutputPath('portraits', 'human_male_warrior', { original: true });
 * // => 'frontend/public/assets/portraits/originals/human_male_warrior.png'
 */
export function getOutputPath(category, id, options = {}) {
  const { original, ...pathOptions } = options;

  const assetPath = original
    ? getOriginalsPath(category, id, pathOptions)
    : getAssetPath(category, id, pathOptions);

  // Remove leading slash and prepend frontend/public
  return `frontend/public${assetPath}`;
}

/**
 * Gets all size variants for an asset category
 *
 * Useful for generating multiple size variants of the same asset.
 *
 * @param {string} category - Asset category
 * @param {string} id - Asset identifier
 * @param {Object} [options] - Base options (subcategory, etc.)
 * @returns {Array<{size: number, path: string}>} Array of size/path pairs
 *
 * @example
 * getAllSizeVariants('portraits', 'human_male_warrior');
 * // => [
 * //   { size: 64, path: '/assets/portraits/64/human_male_warrior.png' },
 * //   { size: 128, path: '/assets/portraits/128/human_male_warrior.png' },
 * //   { size: 256, path: '/assets/portraits/256/human_male_warrior.png' }
 * // ]
 */
export function getAllSizeVariants(category, id, options = {}) {
  validateCategory(category);

  const sizes = SIZE_PRESETS[category];
  return sizes.map(size => ({
    size,
    path: getAssetPath(category, id, { ...options, size })
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
 * getOptimalSize('nodes', 60);  // => 64 (smallest >= 60)
 * getOptimalSize('nodes', 120); // => 128 (smallest >= 120)
 * getOptimalSize('nodes', 300); // => 256 (largest available)
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
 * Parses an asset filename to extract id and metadata
 *
 * @param {string} filename - The filename to parse
 * @param {string} category - The asset category (needed for context)
 * @returns {Object|null} Parsed info or null if unable to parse
 *
 * @example
 * parseAssetFilename('human_male_warrior.png', 'portraits');
 * // => { id: 'human_male_warrior' }
 *
 * @example
 * parseAssetFilename('attack.png', 'icons');
 * // => { id: 'attack' }
 *
 * @example
 * parseAssetFilename('sword_iron.png', 'items');
 * // => { id: 'sword_iron' }
 */
export function parseAssetFilename(filename, category) {
  validateCategory(category);

  // Remove .png extension
  const baseName = filename.replace(/\.png$/, '');

  // All categories now use simple id without embedded size/subcategory
  return { id: baseName };
}
