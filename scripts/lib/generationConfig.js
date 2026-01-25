/**
 * Generation Configuration
 * Shared settings for audio and image generation
 *
 * @module generationConfig
 * @description Provides shared configuration values for generation scripts.
 * Centralizes default seeds, model lists, and common paths.
 */

const path = require('path');
const { getValidatedProjectRoot } = require('./pathUtils');
const { getEnv } = require('./envLoader');

/**
 * Default random seed for reproducible generation
 * @type {number}
 */
const DEFAULT_SEED = 42;

/**
 * Valid LoRA models for image generation
 * These must match models available in the image-generator project
 * @type {Object<string, string>}
 */
const LORA_MODELS = {
  // Primary model for fantasy pixel art
  PIXEL_ART: 'pixel-art-xl-v1.1',

  // Alternative models for specific styles
  FANTASY_ICONS: 'fantasy-icons-v1',
  PORTRAITS: 'portraits-v1',
  TILES: 'tiles-v1',

  // Default model (alias)
  DEFAULT: 'pixel-art-xl-v1.1'
};

/**
 * Valid LoRA model names (for validation)
 * @type {string[]}
 */
const VALID_LORA_MODELS = Object.values(LORA_MODELS);

/**
 * Check if a LoRA model name is valid
 *
 * @param {string} modelName - Model name to validate
 * @returns {boolean} True if valid
 */
function isValidLoraModel(modelName) {
  return VALID_LORA_MODELS.includes(modelName);
}

/**
 * Get common paths used by generation scripts
 * All paths are absolute and based on the validated project root.
 *
 * @returns {Object} Object containing common paths
 */
function getCommonPaths() {
  const projectRoot = getValidatedProjectRoot();

  return {
    // Project root
    projectRoot,

    // Metadata directories
    imageMetadata: path.join(projectRoot, 'ai-image-metadata'),
    audioMetadata: path.join(projectRoot, 'audio-metadata'),

    // Output directories
    assets: path.join(projectRoot, 'frontend', 'public', 'assets'),
    audioOutput: path.join(projectRoot, 'frontend', 'public', 'assets', 'audio'),
    imageOutput: path.join(projectRoot, 'frontend', 'public', 'assets'),

    // Script directories
    scripts: path.join(projectRoot, 'scripts'),
    audioScripts: path.join(projectRoot, 'scripts', 'audio'),
    imageScripts: path.join(projectRoot, 'scripts', 'ai-images'),

    // External tool directories (from environment)
    imageGenerator: getImageGeneratorRoot()
  };
}

/**
 * Get the image generator root directory
 * Uses IMAGE_GENERATOR_ROOT env var or default location.
 *
 * @returns {string} Absolute path to image-generator project
 */
function getImageGeneratorRoot() {
  const fromEnv = getEnv('IMAGE_GENERATOR_ROOT');
  if (fromEnv) {
    return fromEnv;
  }

  // Default location relative to home directory
  const homeDir = getEnv('HOME', '/home/wizard');
  return path.join(homeDir, 'Projects', 'image-generator', 'modia-generators');
}

/**
 * Get the metadata directory for a specific category
 *
 * @param {string} category - Category name (e.g., 'tiles', 'portraits', 'items')
 * @returns {string} Absolute path to metadata directory
 */
function getMetadataDir(category) {
  const { imageMetadata } = getCommonPaths();
  return path.join(imageMetadata, category);
}

/**
 * Default generation options
 * @type {Object}
 */
const DEFAULT_GENERATION_OPTIONS = {
  // Random seed for reproducibility
  seed: DEFAULT_SEED,

  // Number of variants to generate
  variants: 1,

  // Whether to skip files that already exist
  skipExisting: true,

  // Dry run mode (don't actually generate)
  dryRun: false,

  // Verbose output
  verbose: false,

  // Quiet mode (suppress output)
  quiet: false,

  // Default LoRA model
  loraModel: LORA_MODELS.DEFAULT
};

/**
 * Standard image sizes used for game assets
 * Maps size category to pixel dimensions
 * @type {Object<string, number>}
 */
const STANDARD_IMAGE_SIZES = {
  // Portrait sizes
  portrait_small: 64,
  portrait_medium: 128,
  portrait_large: 256,

  // Tile sizes (square)
  tile_small: 32,
  tile_medium: 64,
  tile_large: 128,

  // Icon sizes
  icon_small: 24,
  icon_medium: 32,
  icon_large: 48,

  // Node sizes (world map)
  node_small: 48,
  node_medium: 64,
  node_large: 96,

  // Item sizes
  item_small: 32,
  item_medium: 48,
  item_large: 64
};

/**
 * AI generation resolutions (for image generators)
 * Higher resolutions for AI, then downscaled
 * @type {Object<string, number>}
 */
const AI_GENERATION_RESOLUTIONS = {
  portrait: 512,
  tile: 512,
  icon: 256,
  item: 256,
  node: 512
};

/**
 * Rate limiting settings for API calls
 * @type {Object}
 */
const RATE_LIMITS = {
  // Delay between API calls in ms
  image: {
    local: 1000,      // Local ComfyUI
    huggingface: 3000 // HuggingFace API
  },
  audio: {
    suno: 5000,       // Suno API
    elevenlabs: 2000  // ElevenLabs API
  }
};

module.exports = {
  DEFAULT_SEED,
  LORA_MODELS,
  VALID_LORA_MODELS,
  isValidLoraModel,
  getCommonPaths,
  getImageGeneratorRoot,
  getMetadataDir,
  DEFAULT_GENERATION_OPTIONS,
  STANDARD_IMAGE_SIZES,
  AI_GENERATION_RESOLUTIONS,
  RATE_LIMITS
};
