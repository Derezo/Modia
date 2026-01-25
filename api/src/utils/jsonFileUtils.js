/**
 * JSON File Utilities
 * Shared utilities for loading and saving JSON files in admin routes
 *
 * @module jsonFileUtils
 */

import { promises as fs, existsSync } from 'fs';
import path from 'path';

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
 * Save data to a JSON file
 * Creates parent directories if they don't exist
 * @param {string} filePath - Absolute path to JSON file
 * @param {object} data - Data to serialize and save
 */
export async function saveJsonFile(filePath, data) {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n');
}
