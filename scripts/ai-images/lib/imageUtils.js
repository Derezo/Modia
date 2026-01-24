/**
 * AI Image Generation Utilities
 * Common utilities for image generation scripts
 */

const fs = require('fs');
const path = require('path');

/**
 * Load environment variables from .env file
 * Looks for .env in project root (three levels up from lib/)
 */
function loadEnv() {
  const envPath = path.resolve(__dirname, '../../..', '.env');

  if (!fs.existsSync(envPath)) {
    return; // No .env file, skip silently
  }

  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');

    for (const line of lines) {
      // Skip empty lines and comments
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Parse KEY=VALUE (handle quoted values)
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();

        // Remove surrounding quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        // Only set if not already defined (don't override existing env vars)
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    }
  } catch (error) {
    console.error(`Warning: Failed to load .env file: ${error.message}`);
  }
}

// Auto-load .env when this module is imported
loadEnv();

/**
 * Ensure a directory exists, creating it if necessary
 * @param {string} dirPath - Path to the directory
 * @returns {void}
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Check if a file exists
 * @param {string} filePath - Path to the file
 * @returns {boolean} True if file exists
 */
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

/**
 * Promisified setTimeout for rate limiting
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Load and parse a JSON metadata file
 * @param {string} filePath - Path to the JSON file
 * @returns {Object|null} Parsed JSON object or null if file doesn't exist
 */
function loadMetadata(filePath) {
  if (!fileExists(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to load metadata from ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Save JSON metadata to a file with pretty formatting
 * @param {string} filePath - Path to the JSON file
 * @param {Object} data - Data to save
 * @returns {void}
 */
function saveMetadata(filePath, data) {
  const dir = path.dirname(filePath);
  ensureDirectoryExists(dir);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Get a timestamp string for logging
 * @returns {string} ISO timestamp
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Check if debug logging is enabled
 * Set IMAGE_DEBUG=1 or DEBUG=1 to enable verbose debug output
 * @returns {boolean}
 */
function isDebugEnabled() {
  return process.env.IMAGE_DEBUG === '1' || process.env.DEBUG === '1';
}

/**
 * Log with timestamp prefix
 * @param {string} message - Message to log
 * @param {string} level - Log level (info, warn, error, debug)
 */
function log(message, level = 'info') {
  // Skip debug messages unless debug mode is enabled
  if (level === 'debug' && !isDebugEnabled()) {
    return;
  }

  const timestamp = getTimestamp();
  const prefix = {
    info: '[INFO]',
    warn: '[WARN]',
    error: '[ERROR]',
    success: '[SUCCESS]',
    debug: '[DEBUG]'
  }[level] || '[INFO]';

  console.log(`${timestamp} ${prefix} ${message}`);
}

/**
 * Format bytes as human-readable string
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string (e.g., "1.5 MB")
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Validate image file format
 * @param {string} filePath - Path to the image file
 * @returns {boolean} True if valid image format
 */
function isValidImageFormat(filePath) {
  const validExtensions = ['.png', '.jpg', '.jpeg', '.webp'];
  const ext = path.extname(filePath).toLowerCase();
  return validExtensions.includes(ext);
}

/**
 * Sanitize a filename by removing invalid characters
 * @param {string} name - Original filename
 * @returns {string} Sanitized filename
 */
function sanitizeFilename(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Get project root directory
 * @returns {string} Absolute path to Modia project root
 */
function getProjectRoot() {
  return path.resolve(__dirname, '../../..');
}

/**
 * Get metadata directory
 * @returns {string} Absolute path to ai-image-metadata directory
 */
function getMetadataDir() {
  return path.join(getProjectRoot(), 'ai-image-metadata');
}

/**
 * Get image generator root directory
 * @returns {string} Absolute path to image-generator project
 */
function getImageGeneratorRoot() {
  return process.env.IMAGE_GENERATOR_ROOT ||
    path.resolve(process.env.HOME, 'Projects/image-generator/modia-generators');
}

module.exports = {
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
