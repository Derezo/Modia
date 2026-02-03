/**
 * Background Removal Utilities
 * Provides configuration loading and background removal processing for AI-generated images.
 *
 * Configuration is loaded from ai-image-metadata/manifest.json under the "backgroundRemoval" key.
 * Each category can have its own model setting or use the global default.
 */

const path = require('path');
const { getMetadataDir, fileExists, loadMetadata, log } = require('./imageUtils');
const { removeBackground } = require('./pythonRunner');

/**
 * Default background removal configuration
 * Used when manifest.json doesn't have backgroundRemoval config
 */
const DEFAULT_CONFIG = {
  enabled: false,
  defaultModel: 'isnet-general-use',
  categorySettings: {},
  availableModels: [
    'u2net',
    'u2netp',
    'u2net_human_seg',
    'u2net_cloth_seg',
    'silueta',
    'isnet-general-use',
    'isnet-anime',
    'sam'
  ]
};

/**
 * Cached configuration to avoid repeated file reads
 * @type {Object|null}
 */
let cachedConfig = null;

/**
 * Load the backgroundRemoval configuration from manifest.json
 * Returns the backgroundRemoval config object, or defaults if not present.
 *
 * @returns {Object} Background removal configuration
 * @property {boolean} enabled - Whether background removal is globally enabled
 * @property {string} defaultModel - Default rembg model name
 * @property {Object} categorySettings - Per-category override settings
 * @property {string[]} availableModels - List of available rembg models
 */
function getBackgroundRemovalConfig() {
  // Return cached config if available
  if (cachedConfig !== null) {
    return cachedConfig;
  }

  const manifestPath = path.join(getMetadataDir(), 'manifest.json');

  // Check if manifest exists
  if (!fileExists(manifestPath)) {
    log('Manifest not found, using default background removal config', 'warning');
    cachedConfig = { ...DEFAULT_CONFIG };
    return cachedConfig;
  }

  // Load manifest
  const manifest = loadMetadata(manifestPath);

  // Handle missing or malformed config
  if (!manifest || !manifest.backgroundRemoval) {
    cachedConfig = { ...DEFAULT_CONFIG };
    return cachedConfig;
  }

  // Merge with defaults to ensure all fields are present
  cachedConfig = {
    ...DEFAULT_CONFIG,
    ...manifest.backgroundRemoval,
    categorySettings: {
      ...DEFAULT_CONFIG.categorySettings,
      ...(manifest.backgroundRemoval.categorySettings || {})
    }
  };

  return cachedConfig;
}

/**
 * Clear the cached configuration
 * Useful for testing or when manifest is modified at runtime
 */
function clearConfigCache() {
  cachedConfig = null;
}

/**
 * Check if background removal is enabled for a given category
 *
 * @param {string} category - Asset category name (e.g., 'portraits', 'items', 'icons')
 * @returns {boolean} True if background removal should be applied for this category
 */
function shouldRemoveBackground(category) {
  const config = getBackgroundRemovalConfig();

  // If globally disabled, return false
  if (!config.enabled) {
    return false;
  }

  // Check category-specific setting
  const categoryConfig = config.categorySettings[category];

  // If no category config, background removal is not enabled for this category
  if (!categoryConfig) {
    return false;
  }

  // Return the category's enabled setting (defaults to false if not specified)
  return categoryConfig.enabled === true;
}

/**
 * Get the rembg model to use for a given category
 * Returns category-specific model if configured, otherwise the default model.
 *
 * @param {string} category - Asset category name (e.g., 'portraits', 'items', 'icons')
 * @returns {string} Model name to pass to rembg (e.g., 'isnet-general-use', 'u2net')
 */
function getBackgroundRemovalModel(category) {
  const config = getBackgroundRemovalConfig();

  // Check for category-specific model
  const categoryConfig = config.categorySettings[category];
  if (categoryConfig && categoryConfig.model) {
    return categoryConfig.model;
  }

  // Fall back to default model
  return config.defaultModel;
}

/**
 * Process an image to remove its background
 * Creates a temporary file with the processed result.
 *
 * @param {string} originalPath - Absolute path to the original image
 * @param {Object} [options={}] - Processing options
 * @param {string} [options.category] - Asset category (used to determine model if model not specified)
 * @param {string} [options.model] - Explicit rembg model to use (overrides category default)
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @param {boolean} [options.quiet=false] - Suppress output
 * @returns {Promise<{success: boolean, tempPath?: string, error?: string}>}
 *   - success: Whether background removal succeeded
 *   - tempPath: Path to the temporary file with background removed (if successful)
 *   - error: Error message (if failed)
 */
async function processWithBackgroundRemoval(originalPath, options = {}) {
  const { category, model, verbose = false, quiet = false } = options;

  // Validate input path exists
  if (!fileExists(originalPath)) {
    return {
      success: false,
      error: `Original file not found: ${originalPath}`
    };
  }

  // Determine which model to use
  let effectiveModel = model;
  if (!effectiveModel && category) {
    effectiveModel = getBackgroundRemovalModel(category);
  }
  if (!effectiveModel) {
    // Fall back to the default model from config
    const config = getBackgroundRemovalConfig();
    effectiveModel = config.defaultModel;
  }

  // Generate temp file path
  // Pattern: {originalName}_nobg_{timestamp}.png in same directory as original
  const originalDir = path.dirname(originalPath);
  const originalExt = path.extname(originalPath);
  const originalBasename = path.basename(originalPath, originalExt);
  const timestamp = Date.now();
  const tempFilename = `${originalBasename}_nobg_${timestamp}.png`;
  const tempPath = path.join(originalDir, tempFilename);

  try {
    // Run the Python background removal script
    const result = await removeBackground(originalPath, tempPath, {
      verbose,
      quiet,
      model: effectiveModel
    });

    if (!result.success) {
      return {
        success: false,
        error: `Background removal failed with exit code ${result.exitCode}: ${result.stderr}`
      };
    }

    // Verify the temp file was created
    if (!fileExists(tempPath)) {
      return {
        success: false,
        error: `Background removal completed but output file not found: ${tempPath}`
      };
    }

    return {
      success: true,
      tempPath
    };
  } catch (err) {
    return {
      success: false,
      error: `Background removal error: ${err.message}`
    };
  }
}

module.exports = {
  getBackgroundRemovalConfig,
  clearConfigCache,
  shouldRemoveBackground,
  getBackgroundRemovalModel,
  processWithBackgroundRemoval
};
