/**
 * AI Image Generation Utilities
 * Common utilities for image generation scripts
 *
 * NOTE: Core utilities (path validation, logging, JSON handling, env loading)
 * are now imported from the shared library at scripts/lib/. This module
 * re-exports them for backward compatibility and adds image-specific utilities.
 *
 * @see scripts/lib/index.js for shared utility implementations
 */

const path = require('path');
const fs = require('fs');

// Import shared utilities from the centralized library
// This eliminates code duplication between audio and image generation scripts
const {
  // Path utilities
  ensureDirectory: ensureDirectoryShared,
  getValidatedProjectRoot,
  fromProjectRoot,

  // File utilities
  fileExists,
  loadJson,
  saveJson,
  delay,
  sanitizeFilename,
  isValidImageFormat,

  // Logger utilities
  isDebugEnabled,
  getTimestamp,
  log,
  formatBytes,

  // Environment loader
  loadEnv,

  // Generation config
  getImageGeneratorRoot
} = require('../../lib');

/**
 * Ensure a directory exists, creating it if necessary
 * Re-exported from shared library for backward compatibility.
 *
 * @param {string} dirPath - Path to the directory
 * @returns {void}
 */
function ensureDirectoryExists(dirPath) {
  ensureDirectoryShared(dirPath);
}

/**
 * Load and parse a JSON metadata file
 * Re-exported from shared library with adapted signature.
 *
 * @param {string} filePath - Path to the JSON file
 * @returns {Object|null} Parsed JSON object or null if file doesn't exist
 */
function loadMetadata(filePath) {
  return loadJson(filePath, { defaultValue: null });
}

/**
 * Save JSON metadata to a file with pretty formatting
 * Re-exported from shared library with adapted signature.
 *
 * @param {string} filePath - Path to the JSON file
 * @param {Object} data - Data to save
 * @returns {void}
 */
function saveMetadata(filePath, data) {
  saveJson(filePath, data);
}

/**
 * Get project root directory
 * Re-exported from shared library for backward compatibility.
 *
 * @returns {string} Absolute path to Modia project root
 */
function getProjectRoot() {
  return getValidatedProjectRoot();
}

/**
 * Get metadata directory
 *
 * @returns {string} Absolute path to ai-image-metadata directory
 */
function getMetadataDir() {
  return fromProjectRoot('ai-image-metadata');
}

/**
 * Convert a PNG image to WebP format using Sharp
 *
 * @param {string} pngPath - Path to the source PNG file
 * @param {Object} options - Conversion options
 * @param {number} [options.quality=90] - WebP quality (1-100)
 * @param {boolean} [options.keepOriginal=false] - Keep the original PNG file
 * @param {string} [options.outputPath] - Custom output path (defaults to same path with .webp extension)
 * @param {boolean} [options.verbose=false] - Log conversion details
 * @returns {Promise<{success: boolean, webpPath?: string, error?: string}>}
 */
async function convertToWebp(pngPath, options = {}) {
  const {
    quality = 90,
    keepOriginal = false,
    outputPath,
    verbose = false
  } = options;

  // Determine output path
  const webpPath = outputPath || pngPath.replace(/\.png$/i, '.webp');

  // Skip if already webp
  if (pngPath.toLowerCase().endsWith('.webp')) {
    return { success: true, webpPath: pngPath };
  }

  // Check source exists
  if (!fileExists(pngPath)) {
    return { success: false, error: `Source PNG not found: ${pngPath}` };
  }

  try {
    // Lazy-load Sharp to avoid startup cost when not needed
    const sharp = require('sharp');

    await sharp(pngPath)
      .webp({ quality })
      .toFile(webpPath);

    if (verbose) {
      const pngSize = fs.statSync(pngPath).size;
      const webpSize = fs.statSync(webpPath).size;
      const savings = ((1 - webpSize / pngSize) * 100).toFixed(1);
      log(`Converted to WebP: ${path.basename(webpPath)} (${savings}% smaller)`, 'success');
    }

    // Remove original PNG if not keeping it
    if (!keepOriginal) {
      fs.unlinkSync(pngPath);
    }

    return { success: true, webpPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Convert multiple PNG files to WebP format
 *
 * @param {string[]} pngPaths - Array of PNG file paths
 * @param {Object} options - Conversion options (same as convertToWebp)
 * @returns {Promise<{success: string[], failed: Array<{path: string, error: string}>}>}
 */
async function convertManyToWebp(pngPaths, options = {}) {
  const results = { success: [], failed: [] };

  for (const pngPath of pngPaths) {
    const result = await convertToWebp(pngPath, options);
    if (result.success) {
      results.success.push(result.webpPath);
    } else {
      results.failed.push({ path: pngPath, error: result.error });
    }
  }

  return results;
}

// Re-export all utilities for backward compatibility
// Existing code can continue to import from this file
module.exports = {
  // Re-exported from shared library
  loadEnv,
  ensureDirectoryExists,
  fileExists,
  delay,
  loadMetadata,
  saveMetadata,
  getTimestamp,
  log,
  isDebugEnabled,
  formatBytes,
  isValidImageFormat,
  sanitizeFilename,
  getProjectRoot,
  getMetadataDir,
  getImageGeneratorRoot,

  // WebP conversion utilities
  convertToWebp,
  convertManyToWebp
};
