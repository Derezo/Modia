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
  getImageGeneratorRoot
};
