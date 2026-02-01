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
export const VALID_CATEGORIES = ['tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays', 'obstacles', 'characters'];

/**
 * Valid LoRA models for Flux image generation
 * @type {string[]}
 */
export const VALID_LORA_MODELS = ['v1', 'v2', 'modern-pixel', 'retro-pixel'];

/**
 * Valid SD1.5 LoRA models for character animation generation
 * @type {string[]}
 */
export const VALID_SD15_LORA_MODELS = ['pixel-art-xl', '16-bit-pixel', 'all-in-one-pixel', 'retro-game-art', 'cps2-pixel-art'];

/**
 * Default SD1.5 LoRA for character animations
 * @type {string}
 */
export const DEFAULT_SD15_LORA = 'pixel-art-xl';

/**
 * Valid quality presets for SD1.5 generation
 * @type {string[]}
 */
export const VALID_QUALITY_PRESETS = ['fast', 'balanced', 'quality'];

/**
 * Default quality preset
 * @type {string}
 */
export const DEFAULT_QUALITY_PRESET = 'quality';

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
  overlays: 'v1',
  obstacles: 'v2',
  characters: 'v1'
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
  overlays: 'generate-overlays.js',
  obstacles: 'generate-obstacles.js',
  characters: 'generate-characters.js'
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
  VALID_SD15_LORA_MODELS,
  DEFAULT_SD15_LORA,
  VALID_QUALITY_PRESETS,
  DEFAULT_QUALITY_PRESET,
  VALID_BACKENDS,
  VALID_SEED_MODES,
  DEFAULT_LORA_BY_CATEGORY,
  CATEGORY_SCRIPT_MAP,
  VALID_AUDIO_TYPES,
  VALID_MUSIC_CATEGORIES,
  VALID_SFX_CATEGORIES,
  AUDIO_SCRIPT_MAP
};
