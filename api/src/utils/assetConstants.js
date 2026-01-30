/**
 * Asset Generation Constants
 * Single source of truth for asset generation configuration.
 *
 * @module assetConstants
 * @description Shared constants used by admin routes and generation services.
 * Import from this module instead of duplicating these values.
 */

/**
 * Valid asset categories for AI image generation
 * @type {string[]}
 */
export const VALID_CATEGORIES = ['tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays'];

/**
 * Valid LoRA models for image generation
 * @type {string[]}
 */
export const VALID_LORA_MODELS = ['v1', 'v2', 'modern-pixel', 'retro-pixel'];

/**
 * Valid generation backends
 * @type {string[]}
 */
export const VALID_BACKENDS = ['comfyui', 'huggingface'];

/**
 * Valid seed modes for generation
 * @type {string[]}
 */
export const VALID_SEED_MODES = ['random', 'fixed', 'incremental'];

/**
 * Default LoRA model per category
 * Matches Python prompt_templates.py configuration
 * @type {Object<string, string>}
 */
export const DEFAULT_LORA_BY_CATEGORY = {
  tiles: 'v2',
  portraits: 'v1',
  items: 'v1',
  icons: 'v1',
  nodes: 'v2',
  overlays: 'v1'
};

/**
 * Category to script mapping for generation
 * @type {Object<string, string>}
 */
export const CATEGORY_SCRIPT_MAP = {
  tiles: 'generate-tiles.js',
  portraits: 'generate-portraits.js',
  items: 'generate-items.js',
  icons: 'generate-icons.js',
  nodes: 'generate-nodes.js',
  overlays: 'generate-overlays.js'
};

/**
 * Valid audio types for audio generation
 * @type {string[]}
 */
export const VALID_AUDIO_TYPES = ['music', 'sfx'];

/**
 * Valid music categories
 * @type {string[]}
 */
export const VALID_MUSIC_CATEGORIES = ['regions', 'battle', 'core'];

/**
 * Valid SFX categories
 * @type {string[]}
 */
export const VALID_SFX_CATEGORIES = ['combat', 'skills', 'ambient', 'interactions', 'ui'];

/**
 * Audio type to script mapping
 * @type {Object<string, string>}
 */
export const AUDIO_SCRIPT_MAP = {
  music: 'generate-music.js',
  sfx: 'generate-sfx.js'
};

export default {
  VALID_CATEGORIES,
  VALID_LORA_MODELS,
  VALID_BACKENDS,
  VALID_SEED_MODES,
  DEFAULT_LORA_BY_CATEGORY,
  CATEGORY_SCRIPT_MAP,
  VALID_AUDIO_TYPES,
  VALID_MUSIC_CATEGORIES,
  VALID_SFX_CATEGORIES,
  AUDIO_SCRIPT_MAP
};
