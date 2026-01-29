/**
 * JSON File Utilities
 * Shared utilities for loading and saving JSON files in admin routes.
 * Uses cross-process file locking to prevent race conditions during
 * concurrent updates from the API server and CLI scripts.
 *
 * @module jsonFileUtils
 */

import { promises as fs, existsSync } from 'fs';
import path from 'path';
import { withFileLockAsync } from './crossProcessLock.js';

/**
 * Load and parse a JSON file
 * @param {string} filePath - Absolute path to JSON file
 * @returns {Promise<object|null>} Parsed JSON or null if not found/error
 */
export async function loadJsonFile(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to load JSON from ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Save data to a JSON file with cross-process locking
 * Creates parent directories if they don't exist.
 * Uses file locking to prevent race conditions with CLI scripts.
 *
 * @param {string} filePath - Absolute path to JSON file
 * @param {object} data - Data to serialize and save
 * @param {object} [options] - Options
 * @param {boolean} [options.useLock=true] - Whether to use file locking
 */
export async function saveJsonFile(filePath, data, options = {}) {
  const { useLock = true } = options;

  const doSave = async () => {
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }
    await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n');
  };

  if (useLock) {
    await withFileLockAsync(filePath, doSave);
  } else {
    await doSave();
  }
}

/**
 * Load, modify, and save a JSON file atomically with locking
 * This is the recommended way to update JSON files to prevent race conditions.
 *
 * @template T
 * @param {string} filePath - Absolute path to JSON file
 * @param {(data: object) => object | Promise<object>} modifier - Function to modify the data
 * @param {object} [options] - Options
 * @param {object} [options.defaultValue={}] - Default value if file doesn't exist
 * @returns {Promise<object>} The modified and saved data
 */
export async function updateJsonFile(filePath, modifier, options = {}) {
  const { defaultValue = {} } = options;

  return withFileLockAsync(filePath, async () => {
    // Load current data
    let data = await loadJsonFile(filePath);
    if (data === null) {
      data = defaultValue;
    }

    // Apply modification
    const modifiedData = await modifier(data);

    // Save
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }
    await fs.writeFile(filePath, JSON.stringify(modifiedData, null, 2) + '\n');

    return modifiedData;
  });
}
