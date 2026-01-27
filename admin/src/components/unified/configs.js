/**
 * Asset Type Configurations
 *
 * Centralized configuration for all asset types (images and audio).
 * Used by unified components to render type-specific UI.
 */

/**
 * Image asset filter configurations
 */
export const IMAGE_FILTER_CONFIG = {
  tiles: {
    biome: ['forest', 'cave', 'mountain', 'bridge', 'castle'],
    subcategory: ['floors', 'walls', 'slopes'],
  },
  portraits: {
    subcategory: ['player', 'enemy'],
  },
  items: {
    subcategory: ['weapons', 'armor', 'accessories', 'consumables'],
  },
  icons: {
    subcategory: ['actions', 'status', 'menu', 'augments'],
  },
  nodes: {
    // No category-specific filters, just status
  },
  overlays: {
    subcategory: ['rarity', 'augments'],
  },
};

/**
 * Audio asset filter configurations
 */
export const AUDIO_FILTER_CONFIG = {
  music: {
    subcategory: [
      { value: 'regions', label: 'Regional Themes' },
      { value: 'battle', label: 'Battle Music' },
      { value: 'core', label: 'Core Tracks' },
    ],
  },
  sfx: {
    subcategory: [
      { value: 'combat', label: 'Combat' },
      { value: 'skills', label: 'Skills' },
      { value: 'ambient', label: 'Ambient' },
      { value: 'interactions', label: 'Interactions' },
      { value: 'ui', label: 'UI Sounds' },
    ],
  },
};

/**
 * Status filter options
 */
export const STATUS_OPTIONS = {
  image: [
    { value: 'all', label: 'All Status' },
    { value: 'generated', label: 'Generated' },
    { value: 'pending', label: 'Pending' },
    { value: 'needsRegen', label: 'Needs Regen' },
  ],
  audio: [
    { value: 'all', label: 'All Status' },
    { value: 'generated', label: 'Generated' },
    { value: 'pending', label: 'Pending' },
  ],
};

/**
 * Grid display configurations
 */
export const GRID_CONFIG = {
  tiles: {
    cardAspect: 'square',
    gridCols: { sm: 3, md: 4, lg: 6, xl: 8 },
    showVariants: true,
  },
  portraits: {
    cardAspect: 'portrait',
    gridCols: { sm: 2, md: 3, lg: 4, xl: 5 },
    showVariants: false,
  },
  items: {
    cardAspect: 'square',
    gridCols: { sm: 3, md: 4, lg: 5, xl: 6 },
    showVariants: false,
  },
  icons: {
    cardAspect: 'square',
    gridCols: { sm: 4, md: 5, lg: 6, xl: 8 },
    showVariants: false,
  },
  nodes: {
    cardAspect: 'square',
    gridCols: { sm: 3, md: 4, lg: 5, xl: 6 },
    showVariants: true,
  },
  overlays: {
    cardAspect: 'square',
    gridCols: { sm: 4, md: 5, lg: 6, xl: 8 },
    showVariants: false,
  },
  music: {
    cardAspect: 'video', // 16:9
    gridCols: { sm: 1, md: 2, lg: 3, xl: 4 },
    showWaveform: true,
    showDuration: true,
  },
  sfx: {
    cardAspect: 'video',
    gridCols: { sm: 2, md: 3, lg: 4, xl: 5 },
    showWaveform: true,
    showDuration: true,
  },
};

/**
 * Get filter configuration for a type
 * @param {string} assetType - Asset type (tiles, portraits, music, etc.)
 * @returns {object} Filter configuration
 */
export function getFilterConfig(assetType) {
  return IMAGE_FILTER_CONFIG[assetType] || AUDIO_FILTER_CONFIG[assetType] || {};
}

/**
 * Get grid configuration for a type
 * @param {string} assetType - Asset type
 * @returns {object} Grid configuration
 */
export function getGridConfig(assetType) {
  return GRID_CONFIG[assetType] || {
    cardAspect: 'square',
    gridCols: { sm: 3, md: 4, lg: 5, xl: 6 },
  };
}

/**
 * Get status options for a type
 * @param {string} assetType - Asset type
 * @returns {Array} Status filter options
 */
export function getStatusOptions(assetType) {
  const isAudio = assetType === 'music' || assetType === 'sfx';
  return STATUS_OPTIONS[isAudio ? 'audio' : 'image'];
}

/**
 * Check if asset type is audio
 * @param {string} assetType - Asset type
 * @returns {boolean}
 */
export function isAudioType(assetType) {
  return assetType === 'music' || assetType === 'sfx';
}

/**
 * Check if asset type is image
 * @param {string} assetType - Asset type
 * @returns {boolean}
 */
export function isImageType(assetType) {
  return !isAudioType(assetType);
}

/**
 * Category display labels
 */
export const CATEGORY_LABELS = {
  tiles: 'Tiles',
  portraits: 'Portraits',
  items: 'Items',
  icons: 'Icons',
  nodes: 'Nodes',
  overlays: 'Overlays',
  music: 'Music',
  sfx: 'Sound Effects',
};

/**
 * Get human-readable label for a category
 * @param {string} assetType - Asset type
 * @returns {string} Display label
 */
export function getCategoryLabel(assetType) {
  return CATEGORY_LABELS[assetType] || assetType.charAt(0).toUpperCase() + assetType.slice(1);
}
