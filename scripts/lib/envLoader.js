/**
 * Environment Variable Loader
 * Load environment variables from .env file
 *
 * @module envLoader
 * @description Parses .env files and populates process.env.
 * Does not override existing environment variables.
 * Used by both audio and image generation scripts.
 */

const fs = require('fs');
const path = require('path');
const { getValidatedProjectRoot } = require('./pathUtils');

/**
 * Whether env has been loaded (to prevent duplicate loading)
 * @type {boolean}
 */
let envLoaded = false;

/**
 * Parse a .env file content into key-value pairs
 *
 * @param {string} content - Content of .env file
 * @returns {Object<string, string>} Parsed key-value pairs
 */
function parseEnvContent(content) {
  const result = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

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

      result[key] = value;
    }
  }

  return result;
}

/**
 * Load environment variables from .env file
 * Looks for .env in project root. Does not override existing env vars.
 *
 * @param {Object} [options={}] - Options
 * @param {string} [options.envPath] - Custom path to .env file
 * @param {boolean} [options.force=false] - Force reload even if already loaded
 * @param {boolean} [options.override=false] - Override existing env vars
 * @returns {Object} Object containing loaded variables and any errors
 */
function loadEnv(options = {}) {
  const { envPath, force = false, override = false } = options;

  // Skip if already loaded (unless forced)
  if (envLoaded && !force) {
    return { loaded: false, variables: {}, reason: 'Already loaded' };
  }

  // Determine path to .env file
  let targetPath = envPath;
  if (!targetPath) {
    try {
      const projectRoot = getValidatedProjectRoot();
      targetPath = path.join(projectRoot, '.env');
    } catch (error) {
      return { loaded: false, variables: {}, error: error.message };
    }
  }

  // Check if .env file exists
  if (!fs.existsSync(targetPath)) {
    return { loaded: false, variables: {}, reason: '.env file not found' };
  }

  try {
    const content = fs.readFileSync(targetPath, 'utf8');
    const parsed = parseEnvContent(content);
    const loaded = {};

    for (const [key, value] of Object.entries(parsed)) {
      // Only set if not already defined (unless override is true)
      if (override || process.env[key] === undefined) {
        process.env[key] = value;
        loaded[key] = value;
      }
    }

    envLoaded = true;
    return { loaded: true, variables: loaded };
  } catch (error) {
    return { loaded: false, variables: {}, error: error.message };
  }
}

/**
 * Get an environment variable with a default value
 *
 * @param {string} key - Environment variable name
 * @param {string} [defaultValue=''] - Default value if not set
 * @returns {string} Environment variable value or default
 */
function getEnv(key, defaultValue = '') {
  return process.env[key] ?? defaultValue;
}

/**
 * Get an environment variable, throwing if not set
 *
 * @param {string} key - Environment variable name
 * @param {string} [context=''] - Context for error message
 * @returns {string} Environment variable value
 * @throws {Error} If environment variable is not set
 */
function requireEnv(key, context = '') {
  const value = process.env[key];
  if (value === undefined) {
    const contextMsg = context ? ` (${context})` : '';
    throw new Error(`Required environment variable not set: ${key}${contextMsg}`);
  }
  return value;
}

/**
 * Check if an environment variable is set to a truthy value
 * Truthy values: '1', 'true', 'yes', 'on' (case-insensitive)
 *
 * @param {string} key - Environment variable name
 * @returns {boolean} True if set to a truthy value
 */
function isEnvTrue(key) {
  const value = process.env[key];
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/**
 * Reset the envLoaded flag (useful for testing)
 */
function resetEnvLoaded() {
  envLoaded = false;
}

module.exports = {
  loadEnv,
  getEnv,
  requireEnv,
  isEnvTrue,
  parseEnvContent,
  resetEnvLoaded
};
