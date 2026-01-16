/**
 * Audio Generation Utilities
 * Common utilities for audio generation scripts
 */

const fs = require('fs');
const path = require('path');

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
 * Log with timestamp prefix
 * @param {string} message - Message to log
 * @param {string} level - Log level (info, warn, error)
 */
function log(message, level = 'info') {
  const timestamp = getTimestamp();
  const prefix = {
    info: '[INFO]',
    warn: '[WARN]',
    error: '[ERROR]',
    success: '[SUCCESS]'
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
 * Validate audio file format
 * @param {string} filePath - Path to the audio file
 * @returns {boolean} True if valid audio format
 */
function isValidAudioFormat(filePath) {
  const validExtensions = ['.mp3', '.wav', '.ogg', '.m4a', '.webm'];
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

module.exports = {
  ensureDirectoryExists,
  fileExists,
  delay,
  loadMetadata,
  saveMetadata,
  getTimestamp,
  log,
  formatBytes,
  isValidAudioFormat,
  sanitizeFilename
};
