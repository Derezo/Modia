/**
 * Path Utilities for Generation Scripts
 * Fail-fast path validation and project root detection
 *
 * @module pathUtils
 * @description Provides path validation utilities with descriptive error messages.
 * Used by both audio and image generation scripts to ensure paths are valid
 * before attempting file operations.
 */

const fs = require('fs');
const path = require('path');

/**
 * Cache for validated project root
 * @type {string|null}
 */
let cachedProjectRoot = null;

/**
 * Expected files/directories at project root for validation
 * @type {string[]}
 */
const PROJECT_ROOT_MARKERS = [
  'package.json',
  'api',
  'frontend',
  'shared'
];

/**
 * Validate that a path exists, throw if not
 * Provides descriptive error messages for debugging path issues.
 *
 * @param {string} filePath - Path to validate
 * @param {string} [context=''] - Error context message (e.g., "Loading metadata file")
 * @throws {Error} If path does not exist
 * @returns {string} The validated path (for chaining)
 *
 * @example
 * const configPath = requirePath('/path/to/config.json', 'Loading generation config');
 * const data = JSON.parse(fs.readFileSync(configPath));
 */
function requirePath(filePath, context = '') {
  if (!filePath) {
    const contextMsg = context ? ` (${context})` : '';
    throw new Error(`Path is required${contextMsg}: received ${filePath}`);
  }

  if (!fs.existsSync(filePath)) {
    const contextMsg = context ? `${context}: ` : '';
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
    throw new Error(`${contextMsg}Path does not exist: ${absolutePath}`);
  }

  return filePath;
}

/**
 * Validate that a file exists (not a directory), throw if not
 *
 * @param {string} filePath - Path to validate
 * @param {string} [context=''] - Error context message
 * @throws {Error} If path does not exist or is not a file
 * @returns {string} The validated path
 */
function requireFile(filePath, context = '') {
  requirePath(filePath, context);

  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    const contextMsg = context ? `${context}: ` : '';
    throw new Error(`${contextMsg}Path exists but is not a file: ${filePath}`);
  }

  return filePath;
}

/**
 * Validate that a directory exists, throw if not
 *
 * @param {string} dirPath - Path to validate
 * @param {string} [context=''] - Error context message
 * @throws {Error} If path does not exist or is not a directory
 * @returns {string} The validated path
 */
function requireDirectory(dirPath, context = '') {
  requirePath(dirPath, context);

  const stats = fs.statSync(dirPath);
  if (!stats.isDirectory()) {
    const contextMsg = context ? `${context}: ` : '';
    throw new Error(`${contextMsg}Path exists but is not a directory: ${dirPath}`);
  }

  return dirPath;
}

/**
 * Validate directory exists, create if missing
 * Uses recursive mkdir to create parent directories as needed.
 *
 * @param {string} dirPath - Path to the directory
 * @returns {string} The path that was ensured
 */
function ensureDirectory(dirPath) {
  if (!dirPath) {
    throw new Error('Directory path is required');
  }

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  return dirPath;
}

/**
 * Get project root with validation
 * Walks up from the current module location to find the Modia project root,
 * validating it has the expected structure.
 *
 * @param {Object} [options={}] - Options
 * @param {boolean} [options.useCache=true] - Whether to use cached result
 * @returns {string} Absolute path to Modia project root
 * @throws {Error} If project root cannot be found or validated
 */
function getValidatedProjectRoot(options = {}) {
  const { useCache = true } = options;

  if (useCache && cachedProjectRoot) {
    return cachedProjectRoot;
  }

  // Start from this file's location and walk up
  let currentDir = __dirname;
  let attempts = 0;
  const maxAttempts = 10; // Prevent infinite loops

  while (attempts < maxAttempts) {
    // Check if this directory has all required markers
    const hasAllMarkers = PROJECT_ROOT_MARKERS.every(marker => {
      const markerPath = path.join(currentDir, marker);
      return fs.existsSync(markerPath);
    });

    if (hasAllMarkers) {
      // Additional validation: check package.json has correct name
      try {
        const pkgPath = path.join(currentDir, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name === 'modia' || pkg.workspaces) {
          cachedProjectRoot = currentDir;
          return currentDir;
        }
      } catch {
        // package.json parse failed, continue searching
      }
    }

    // Move up one directory
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
    attempts++;
  }

  throw new Error(
    `Could not find Modia project root. ` +
    `Expected to find: ${PROJECT_ROOT_MARKERS.join(', ')}. ` +
    `Started search from: ${__dirname}`
  );
}

/**
 * Clear the cached project root (useful for testing)
 */
function clearProjectRootCache() {
  cachedProjectRoot = null;
}

/**
 * Resolve a path relative to the project root
 *
 * @param {...string} segments - Path segments to join
 * @returns {string} Absolute path
 */
function fromProjectRoot(...segments) {
  const root = getValidatedProjectRoot();
  return path.join(root, ...segments);
}

/**
 * Check if a path is within the project root
 *
 * @param {string} targetPath - Path to check
 * @returns {boolean} True if path is within project root
 */
function isWithinProject(targetPath) {
  const root = getValidatedProjectRoot();
  const absoluteTarget = path.resolve(targetPath);
  return absoluteTarget.startsWith(root);
}

module.exports = {
  requirePath,
  requireFile,
  requireDirectory,
  ensureDirectory,
  getValidatedProjectRoot,
  clearProjectRootCache,
  fromProjectRoot,
  isWithinProject
};
