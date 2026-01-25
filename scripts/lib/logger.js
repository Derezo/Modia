/**
 * Logger Utilities for Generation Scripts
 * Consistent logging with timestamps and log levels
 *
 * @module logger
 * @description Provides structured logging with configurable debug output.
 * Used by both audio and image generation scripts for consistent output.
 */

/**
 * Log levels with numeric values for filtering
 * @type {Object<string, number>}
 */
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  success: 1,
  warn: 2,
  error: 3
};

/**
 * Log level prefixes for display
 * @type {Object<string, string>}
 */
const LEVEL_PREFIXES = {
  debug: '[DEBUG]',
  info: '[INFO]',
  success: '[SUCCESS]',
  warn: '[WARN]',
  error: '[ERROR]'
};

/**
 * Check if debug logging is enabled
 * Set DEBUG=1, AUDIO_DEBUG=1, or IMAGE_DEBUG=1 to enable verbose debug output
 *
 * @returns {boolean} True if debug logging is enabled
 */
function isDebugEnabled() {
  return process.env.DEBUG === '1' ||
         process.env.AUDIO_DEBUG === '1' ||
         process.env.IMAGE_DEBUG === '1';
}

/**
 * Get current timestamp in ISO format
 *
 * @returns {string} ISO timestamp string
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Log a message with timestamp prefix
 *
 * @param {string} message - Message to log
 * @param {string} [level='info'] - Log level (debug, info, success, warn, error)
 */
function log(message, level = 'info') {
  // Skip debug messages unless debug mode is enabled
  if (level === 'debug' && !isDebugEnabled()) {
    return;
  }

  const timestamp = getTimestamp();
  const prefix = LEVEL_PREFIXES[level] || LEVEL_PREFIXES.info;

  const output = `${timestamp} ${prefix} ${message}`;

  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

/**
 * Log an info message
 * @param {string} message - Message to log
 */
function info(message) {
  log(message, 'info');
}

/**
 * Log a success message
 * @param {string} message - Message to log
 */
function success(message) {
  log(message, 'success');
}

/**
 * Log a warning message
 * @param {string} message - Message to log
 */
function warn(message) {
  log(message, 'warn');
}

/**
 * Log an error message
 * @param {string} message - Message to log
 */
function error(message) {
  log(message, 'error');
}

/**
 * Log a debug message (only shown when DEBUG=1)
 * @param {string} message - Message to log
 */
function debug(message) {
  log(message, 'debug');
}

/**
 * Create a scoped logger with a prefix
 * Useful for distinguishing output from different modules.
 *
 * @param {string} scope - Scope prefix (e.g., 'TileGen', 'AudioGen')
 * @returns {Object} Logger object with scoped log methods
 *
 * @example
 * const logger = createScopedLogger('TileGen');
 * logger.info('Starting generation'); // [INFO] [TileGen] Starting generation
 */
function createScopedLogger(scope) {
  const prefix = scope ? `[${scope}] ` : '';

  return {
    log: (message, level = 'info') => log(`${prefix}${message}`, level),
    info: (message) => log(`${prefix}${message}`, 'info'),
    success: (message) => log(`${prefix}${message}`, 'success'),
    warn: (message) => log(`${prefix}${message}`, 'warn'),
    error: (message) => log(`${prefix}${message}`, 'error'),
    debug: (message) => log(`${prefix}${message}`, 'debug')
  };
}

/**
 * Format bytes as human-readable string
 *
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
 * Format a duration in milliseconds to human-readable string
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted string (e.g., "1m 30s", "500ms")
 */
function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

module.exports = {
  LOG_LEVELS,
  isDebugEnabled,
  getTimestamp,
  log,
  info,
  success,
  warn,
  error,
  debug,
  createScopedLogger,
  formatBytes,
  formatDuration
};
