/**
 * Audio Generation Utilities
 * Common utilities for audio generation scripts
 *
 * NOTE: Core utilities (path validation, logging, JSON handling, env loading)
 * are now imported from the shared library at scripts/lib/. This module
 * re-exports them for backward compatibility and adds audio-specific utilities.
 *
 * @see scripts/lib/index.js for shared utility implementations
 */

// Import shared utilities from the centralized library
// This eliminates code duplication between audio and image generation scripts
const {
  // Path utilities
  ensureDirectory: ensureDirectoryShared,

  // File utilities
  fileExists,
  loadJson,
  saveJson,
  delay,
  sanitizeFilename,
  isValidAudioFormat,

  // Logger utilities
  isDebugEnabled: isDebugEnabledShared,
  getTimestamp,
  log,
  formatBytes,

  // Environment loader
  loadEnv
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
 * Check if debug logging is enabled
 * Checks AUDIO_DEBUG=1 or DEBUG=1 environment variables.
 * Re-exported from shared library for backward compatibility.
 *
 * @returns {boolean} True if debug logging is enabled
 */
function isDebugEnabled() {
  // The shared library checks DEBUG=1, AUDIO_DEBUG=1, and IMAGE_DEBUG=1
  // This maintains the original behavior
  return isDebugEnabledShared();
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
  isValidAudioFormat,
  sanitizeFilename
};
