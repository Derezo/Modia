/**
 * Batch Configuration Utilities
 * Parse and manage YAML batch configuration files for image generation
 */

const fs = require('fs');
const path = require('path');
const { log, getProjectRoot, getImageGeneratorRoot } = require('./imageUtils');

/**
 * Parse a YAML file (simple parser for key-value and lists)
 * For complex YAML, use Python's YAML parser via batch generation
 * @param {string} filePath - Path to YAML file
 * @returns {Object} Parsed configuration
 */
function parseSimpleYaml(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const result = {};
  let currentKey = null;
  let currentList = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') {
      continue;
    }

    // Check for list item
    if (trimmed.startsWith('- ')) {
      if (currentList) {
        currentList.push(trimmed.substring(2).trim());
      }
      continue;
    }

    // Check for key-value
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      const key = trimmed.substring(0, colonIndex).trim();
      const value = trimmed.substring(colonIndex + 1).trim();

      if (value === '') {
        // Start of a list or nested object
        currentKey = key;
        currentList = [];
        result[key] = currentList;
      } else {
        // Simple key-value
        result[key] = value;
        currentList = null;
      }
    }
  }

  return result;
}

/**
 * Resolve a batch config path
 * Checks in order:
 * 1. Absolute path
 * 2. Relative to current directory
 * 3. In image-generator/configs/ directory
 * 4. In Modia's ai-image-metadata/batch/ directory
 *
 * @param {string} configPath - Path or name of config file
 * @returns {string|null} Resolved path or null if not found
 */
function resolveBatchConfigPath(configPath) {
  // Check if already absolute
  if (path.isAbsolute(configPath) && fs.existsSync(configPath)) {
    return configPath;
  }

  // Try relative to current directory
  const relativePath = path.resolve(configPath);
  if (fs.existsSync(relativePath)) {
    return relativePath;
  }

  // Try in image-generator configs directory
  try {
    const generatorRoot = getImageGeneratorRoot();
    const generatorPath = path.join(generatorRoot, 'configs', configPath);
    if (fs.existsSync(generatorPath)) {
      return generatorPath;
    }

    // Try with .yaml extension
    const generatorPathYaml = path.join(generatorRoot, 'configs', `${configPath}.yaml`);
    if (fs.existsSync(generatorPathYaml)) {
      return generatorPathYaml;
    }
  } catch {
    // IMAGE_GENERATOR_ROOT not set, skip
  }

  // Try in Modia's batch directory
  const modiaRoot = getProjectRoot();
  const modiaBatchPath = path.join(modiaRoot, 'ai-image-metadata', 'batch', configPath);
  if (fs.existsSync(modiaBatchPath)) {
    return modiaBatchPath;
  }

  // Try with .yaml extension
  const modiaBatchPathYaml = path.join(modiaRoot, 'ai-image-metadata', 'batch', `${configPath}.yaml`);
  if (fs.existsSync(modiaBatchPathYaml)) {
    return modiaBatchPathYaml;
  }

  return null;
}

/**
 * Load and validate a batch configuration
 * @param {string} configPath - Path to batch config file
 * @returns {Object} Validated configuration
 */
function loadBatchConfig(configPath) {
  const resolvedPath = resolveBatchConfigPath(configPath);

  if (!resolvedPath) {
    throw new Error(`Batch config not found: ${configPath}`);
  }

  log(`Loading batch config: ${resolvedPath}`, 'debug');

  // For complex YAML, we'll pass it directly to Python
  // For simple preview, use the simple parser
  const config = parseSimpleYaml(resolvedPath);

  return {
    path: resolvedPath,
    config
  };
}

/**
 * Create a batch config summary for display
 * @param {Object} batchInfo - Loaded batch info from loadBatchConfig
 * @returns {string} Summary string
 */
function getBatchConfigSummary(batchInfo) {
  const { config } = batchInfo;
  const items = config.items || [];
  const variants = parseInt(config.variants, 10) || 1;

  return `Batch: ${items.length} items, ${variants} variant(s) each`;
}

module.exports = {
  parseSimpleYaml,
  resolveBatchConfigPath,
  loadBatchConfig,
  getBatchConfigSummary
};
