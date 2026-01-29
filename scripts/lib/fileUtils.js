/**
 * File Utilities for Generation Scripts
 * Common file operations for JSON and general file handling.
 * Uses cross-process file locking to prevent race conditions during
 * concurrent updates from the API server and CLI scripts.
 *
 * @module fileUtils
 * @description Provides file utilities including JSON load/save with error handling.
 * Used by both audio and image generation scripts.
 */

const fs = require('fs');
const path = require('path');
const { ensureDirectory } = require('./pathUtils');
const { withFileLockSync } = require('./fileLock');

/**
 * Check if a file exists
 *
 * @param {string} filePath - Path to the file
 * @returns {boolean} True if file exists
 */
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

/**
 * Load and parse a JSON file
 * Returns null if file doesn't exist (fail-soft for optional files).
 * Throws on parse errors to catch malformed JSON.
 *
 * @param {string} filePath - Path to the JSON file
 * @param {Object} [options={}] - Options
 * @param {*} [options.defaultValue=null] - Value to return if file doesn't exist
 * @param {boolean} [options.throwOnMissing=false] - Throw if file doesn't exist
 * @returns {*} Parsed JSON object or default value if file doesn't exist
 * @throws {Error} If file exists but contains invalid JSON
 *
 * @example
 * const config = loadJson('/path/to/config.json');
 * const required = loadJson('/path/to/required.json', { throwOnMissing: true });
 */
function loadJson(filePath, options = {}) {
  const { defaultValue = null, throwOnMissing = false } = options;

  if (!fs.existsSync(filePath)) {
    if (throwOnMissing) {
      throw new Error(`Required JSON file not found: ${filePath}`);
    }
    return defaultValue;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Save data to a JSON file with pretty formatting and cross-process locking
 * Creates parent directories if they don't exist.
 * Uses file locking to prevent race conditions with the API server.
 *
 * @param {string} filePath - Path to the JSON file
 * @param {*} data - Data to save (must be JSON-serializable)
 * @param {Object} [options={}] - Options
 * @param {number} [options.indent=2] - Number of spaces for indentation
 * @param {boolean} [options.trailingNewline=true] - Add trailing newline
 * @param {boolean} [options.useLock=true] - Whether to use file locking
 */
function saveJson(filePath, data, options = {}) {
  const { indent = 2, trailingNewline = true, useLock = true } = options;

  const doSave = () => {
    const dir = path.dirname(filePath);
    ensureDirectory(dir);

    let content = JSON.stringify(data, null, indent);
    if (trailingNewline) {
      content += '\n';
    }

    fs.writeFileSync(filePath, content);
  };

  if (useLock) {
    withFileLockSync(filePath, doSave);
  } else {
    doSave();
  }
}

/**
 * Promisified setTimeout for rate limiting and delays
 *
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>} Promise that resolves after delay
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sanitize a filename by removing invalid characters
 * Converts to lowercase and replaces special characters with underscores.
 *
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
 * Get the extension of a file path (lowercase, with dot)
 *
 * @param {string} filePath - Path to the file
 * @returns {string} Extension with dot (e.g., ".png") or empty string
 */
function getExtension(filePath) {
  return path.extname(filePath).toLowerCase();
}

/**
 * Validate that a file has one of the allowed extensions
 *
 * @param {string} filePath - Path to the file
 * @param {string[]} allowedExtensions - Array of allowed extensions (with dots)
 * @returns {boolean} True if extension is allowed
 *
 * @example
 * hasAllowedExtension('/path/to/image.png', ['.png', '.jpg']); // true
 * hasAllowedExtension('/path/to/video.mp4', ['.png', '.jpg']); // false
 */
function hasAllowedExtension(filePath, allowedExtensions) {
  const ext = getExtension(filePath);
  return allowedExtensions.includes(ext);
}

/**
 * Common image file extensions
 * @type {string[]}
 */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

/**
 * Common audio file extensions
 * @type {string[]}
 */
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.webm', '.flac'];

/**
 * Check if a file is a valid image format
 *
 * @param {string} filePath - Path to the file
 * @returns {boolean} True if valid image format
 */
function isValidImageFormat(filePath) {
  return hasAllowedExtension(filePath, IMAGE_EXTENSIONS);
}

/**
 * Check if a file is a valid audio format
 *
 * @param {string} filePath - Path to the file
 * @returns {boolean} True if valid audio format
 */
function isValidAudioFormat(filePath) {
  return hasAllowedExtension(filePath, AUDIO_EXTENSIONS);
}

/**
 * Read a file and return its contents
 *
 * @param {string} filePath - Path to the file
 * @param {string} [encoding='utf8'] - File encoding
 * @returns {string|Buffer} File contents
 */
function readFile(filePath, encoding = 'utf8') {
  return fs.readFileSync(filePath, encoding);
}

/**
 * Write content to a file
 * Creates parent directories if they don't exist.
 *
 * @param {string} filePath - Path to the file
 * @param {string|Buffer} content - Content to write
 * @param {string} [encoding='utf8'] - File encoding
 */
function writeFile(filePath, content, encoding = 'utf8') {
  const dir = path.dirname(filePath);
  ensureDirectory(dir);
  fs.writeFileSync(filePath, content, encoding);
}

/**
 * Copy a file to a new location
 * Creates parent directories if they don't exist.
 *
 * @param {string} source - Source file path
 * @param {string} destination - Destination file path
 */
function copyFile(source, destination) {
  const dir = path.dirname(destination);
  ensureDirectory(dir);
  fs.copyFileSync(source, destination);
}

/**
 * Get file size in bytes
 *
 * @param {string} filePath - Path to the file
 * @returns {number} File size in bytes, or -1 if file doesn't exist
 */
function getFileSize(filePath) {
  if (!fs.existsSync(filePath)) {
    return -1;
  }
  return fs.statSync(filePath).size;
}

module.exports = {
  fileExists,
  loadJson,
  saveJson,
  delay,
  sanitizeFilename,
  getExtension,
  hasAllowedExtension,
  IMAGE_EXTENSIONS,
  AUDIO_EXTENSIONS,
  isValidImageFormat,
  isValidAudioFormat,
  readFile,
  writeFile,
  copyFile,
  getFileSize
};
