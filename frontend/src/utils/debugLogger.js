/**
 * Debug Logger Utility - Centralized conditional logging
 *
 * Provides debug logging that only outputs when the corresponding
 * developer setting is enabled. Uses dot-notation paths to check settings.
 *
 * Usage:
 *   import { debugLog, debugWarn, setGameInstance } from '../utils/debugLogger.js';
 *
 *   // Initialize with game reference (call once in Game.js init)
 *   setGameInstance(game);
 *
 *   // Log conditionally based on settings
 *   debugLog('audio.logMusicChanges', 'Now playing:', trackId);
 *   debugWarn('audio.logMissingAssets', 'Missing asset:', assetId);
 */

let gameInstance = null;

// Track open console groups for safety when toggling settings mid-group
const openGroups = new Set();

/**
 * Set the game instance for settings lookup
 * @param {Game} game - The game instance
 */
export function setGameInstance(game) {
  gameInstance = game;
}

/**
 * Check if developer mode is enabled
 * @returns {boolean}
 */
function isDeveloperModeEnabled() {
  if (!gameInstance) return false;
  const settings = gameInstance.state?.get('userSettings');
  return settings?.developer?.enabled === true;
}

/**
 * Get a developer setting value by path
 * @param {string} settingPath - Dot-notation path (e.g., 'audio.logMusicChanges')
 * @returns {boolean}
 */
function getDevSetting(settingPath) {
  if (!gameInstance) return false;
  if (!isDeveloperModeEnabled()) return false;

  const settings = gameInstance.state?.get('userSettings');
  if (!settings?.developer) return false;

  const parts = settingPath.split('.');
  let value = settings.developer;

  for (const part of parts) {
    if (value === undefined || value === null) return false;
    value = value[part];
  }

  return value === true;
}

/**
 * Format the debug prefix
 * @param {string} settingPath - The setting path for categorization
 * @returns {string}
 */
function formatPrefix(settingPath) {
  return `[DEBUG:${settingPath}]`;
}

/**
 * Conditional debug log - outputs only if the setting is enabled
 * @param {string} settingPath - Dot-notation path to the setting (e.g., 'audio.logMusicChanges')
 * @param {...any} args - Arguments to log
 */
export function debugLog(settingPath, ...args) {
  if (getDevSetting(settingPath)) {
    console.log(formatPrefix(settingPath), ...args);
  }
}

/**
 * Conditional debug warn - outputs only if the setting is enabled
 * @param {string} settingPath - Dot-notation path to the setting
 * @param {...any} args - Arguments to log
 */
export function debugWarn(settingPath, ...args) {
  if (getDevSetting(settingPath)) {
    console.warn(formatPrefix(settingPath), ...args);
  }
}

/**
 * Conditional debug error - outputs only if the setting is enabled
 * @param {string} settingPath - Dot-notation path to the setting
 * @param {...any} args - Arguments to log
 */
export function debugError(settingPath, ...args) {
  if (getDevSetting(settingPath)) {
    console.error(formatPrefix(settingPath), ...args);
  }
}

/**
 * Conditional debug group - creates a collapsible group only if setting is enabled
 * Tracks open groups to safely close them if settings change mid-group
 * @param {string} settingPath - Dot-notation path to the setting
 * @param {string} label - Group label
 */
export function debugGroup(settingPath, label) {
  if (getDevSetting(settingPath)) {
    console.group(formatPrefix(settingPath), label);
    openGroups.add(settingPath);
  }
}

/**
 * Conditional debug groupEnd - ends a group if it was opened
 * Uses tracking Set to safely close groups even if settings changed mid-group
 * @param {string} settingPath - Dot-notation path to the setting
 */
export function debugGroupEnd(settingPath) {
  if (openGroups.has(settingPath)) {
    console.groupEnd();
    openGroups.delete(settingPath);
  }
}

/**
 * Close all open debug groups - call when settings change or on cleanup
 * Prevents orphaned console groups when developer settings are toggled
 */
export function closeAllDebugGroups() {
  for (const _ of openGroups) {
    console.groupEnd();
  }
  openGroups.clear();
}

/**
 * Conditional debug table - outputs a table only if setting is enabled
 * @param {string} settingPath - Dot-notation path to the setting
 * @param {any} data - Data to display in table format
 */
export function debugTable(settingPath, data) {
  if (getDevSetting(settingPath)) {
    console.log(formatPrefix(settingPath));
    console.table(data);
  }
}

/**
 * Check if a specific debug setting is enabled
 * Useful for conditional code blocks that do more than just logging
 * @param {string} settingPath - Dot-notation path to the setting
 * @returns {boolean}
 */
export function isDebugEnabled(settingPath) {
  return getDevSetting(settingPath);
}

/**
 * Check if developer mode is globally enabled
 * @returns {boolean}
 */
export function isDevModeEnabled() {
  return isDeveloperModeEnabled();
}

export default {
  setGameInstance,
  debugLog,
  debugWarn,
  debugError,
  debugGroup,
  debugGroupEnd,
  closeAllDebugGroups,
  debugTable,
  isDebugEnabled,
  isDevModeEnabled
};
