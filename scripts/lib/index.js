/**
 * Shared Script Utilities Library
 * Common utilities for audio and image generation scripts
 *
 * @module scripts/lib
 * @description Central export point for shared utilities used by generation scripts.
 * Import from this module to get path validation, logging, file operations,
 * environment loading, and generation configuration.
 *
 * @example
 * const {
 *   requirePath, ensureDirectory, getValidatedProjectRoot,
 *   log, info, error, createScopedLogger,
 *   loadJson, saveJson, delay,
 *   loadEnv, getEnv, requireEnv,
 *   DEFAULT_SEED, LORA_MODELS, getCommonPaths
 * } = require('../lib');
 */

// Path utilities - fail-fast path validation
const {
  requirePath,
  requireFile,
  requireDirectory,
  ensureDirectory,
  getValidatedProjectRoot,
  clearProjectRootCache,
  fromProjectRoot,
  isWithinProject
} = require('./pathUtils');

// Logger utilities - consistent logging with timestamps
const {
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
} = require('./logger');

// File utilities - JSON and general file operations
const {
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
} = require('./fileUtils');

// Environment loader - .env file parsing
const {
  loadEnv,
  getEnv,
  requireEnv,
  isEnvTrue,
  parseEnvContent,
  resetEnvLoaded
} = require('./envLoader');

// Generation configuration - shared settings
const {
  DEFAULT_SEED,
  LORA_MODELS,
  VALID_LORA_MODELS,
  isValidLoraModel,
  getCommonPaths,
  getImageGeneratorRoot,
  getMetadataDir,
  DEFAULT_GENERATION_OPTIONS,
  STANDARD_IMAGE_SIZES,
  AI_GENERATION_RESOLUTIONS,
  RATE_LIMITS
} = require('./generationConfig');

// File locking utilities - cross-process synchronization
const {
  acquireLockSync,
  releaseLockSync,
  withFileLockSync,
  acquireLockAsync,
  releaseLockAsync,
  withFileLockAsync,
  getLockPath
} = require('./fileLock');

// Auto-load .env when this module is imported
// This matches the behavior of the original imageUtils.js and audioUtils.js
loadEnv();

module.exports = {
  // Path utilities
  requirePath,
  requireFile,
  requireDirectory,
  ensureDirectory,
  getValidatedProjectRoot,
  clearProjectRootCache,
  fromProjectRoot,
  isWithinProject,

  // Logger utilities
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
  formatDuration,

  // File utilities
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
  getFileSize,

  // Environment loader
  loadEnv,
  getEnv,
  requireEnv,
  isEnvTrue,
  parseEnvContent,
  resetEnvLoaded,

  // Generation configuration
  DEFAULT_SEED,
  LORA_MODELS,
  VALID_LORA_MODELS,
  isValidLoraModel,
  getCommonPaths,
  getImageGeneratorRoot,
  getMetadataDir,
  DEFAULT_GENERATION_OPTIONS,
  STANDARD_IMAGE_SIZES,
  AI_GENERATION_RESOLUTIONS,
  RATE_LIMITS,

  // File locking utilities
  acquireLockSync,
  releaseLockSync,
  withFileLockSync,
  acquireLockAsync,
  releaseLockAsync,
  withFileLockAsync,
  getLockPath
};
