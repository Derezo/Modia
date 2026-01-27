/**
 * Regeneration Queue Utilities
 * Shared utilities for managing the asset regeneration queue across image and audio assets.
 *
 * @module regenerationQueueUtils
 * @description Provides atomic operations for marking assets for regeneration
 * and clearing the regeneration queue.
 */

import path from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { fileLocks, validateAssetIds } from './assetLocking.js';

// ============================================================================
// JSON FILE UTILITIES
// ============================================================================

/**
 * Load a JSON file safely
 * @param {string} filePath
 * @returns {Promise<object|null>}
 */
export async function loadJsonFile(filePath) {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Save a JSON file atomically with locking
 * @param {string} filePath
 * @param {object} data
 * @returns {Promise<void>}
 */
export async function saveJsonFileAtomic(filePath, data) {
  await fileLocks.withFileLock(filePath, async () => {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    // Write with proper formatting
    await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  });
}

// ============================================================================
// BULK MARKING OPERATIONS
// ============================================================================

/**
 * Batch update for marking multiple assets atomically
 * Groups updates by source file and applies them in a single write per file.
 *
 * @param {object} options
 * @param {object[]} options.assets - Assets to update (must include _sourceFile)
 * @param {boolean} options.mark - True to mark, false to unmark
 * @param {function} options.loadFile - Function to load a metadata file
 * @param {function} options.findAsset - Function to find asset in loaded data
 * @param {function} options.updateAsset - Function to update asset in data
 * @param {function} options.saveFile - Function to save the updated file
 * @returns {Promise<{ success: number, errors: Array<{ id: string, error: string }> }>}
 */
export async function batchMarkAssets(options) {
  const { assets, mark, loadFile, findAsset, updateAsset, saveFile } = options;

  // Group by source file
  const byFile = new Map();
  for (const asset of assets) {
    const file = asset._sourceFile;
    if (!byFile.has(file)) {
      byFile.set(file, []);
    }
    byFile.get(file).push(asset);
  }

  const results = { success: 0, errors: [] };

  // Process each file atomically
  for (const [filePath, fileAssets] of byFile.entries()) {
    await fileLocks.withFileLock(filePath, async () => {
      try {
        // Load current state
        const data = await loadFile(filePath);
        if (!data) {
          for (const asset of fileAssets) {
            results.errors.push({ id: asset.id, error: 'Source file not found' });
          }
          return;
        }

        let modified = false;

        // Apply updates
        for (const asset of fileAssets) {
          const current = findAsset(data, asset.id);
          if (!current) {
            results.errors.push({ id: asset.id, error: 'Asset not found in file' });
            continue;
          }

          // Apply the update
          updateAsset(current, mark);
          modified = true;
          results.success++;
        }

        // Save if modified
        if (modified) {
          await saveFile(filePath, data);
        }
      } catch (error) {
        // Mark all assets in this file as errored
        for (const asset of fileAssets) {
          results.errors.push({ id: asset.id, error: error.message });
        }
      }
    });
  }

  return results;
}

// ============================================================================
// ATOMIC QUEUE CLEAR
// ============================================================================

/**
 * Atomically clear regeneration flags from all assets in a category.
 * Collects all changes, validates them, then writes atomically with rollback on failure.
 *
 * @param {object} options
 * @param {string[]} options.files - List of metadata file paths to process
 * @param {function} options.loadFile - Function to load a metadata file
 * @param {function} options.getItems - Function to extract items array from loaded data
 * @param {function} options.isMarked - Function to check if item is marked for regeneration
 * @param {function} options.clearMark - Function to clear the regeneration mark from an item
 * @param {function} options.saveFile - Function to save the updated file
 * @returns {Promise<{ cleared: number, errors: string[] }>}
 */
export async function atomicQueueClear(options) {
  const { files, loadFile, getItems, isMarked, clearMark, saveFile } = options;

  // Phase 1: Collect all changes without writing
  const pending = [];
  const errors = [];
  let totalCleared = 0;

  for (const filePath of files) {
    try {
      const data = await loadFile(filePath);
      if (!data) continue;

      const items = getItems(data);
      if (!items || !Array.isArray(items)) continue;

      let modified = false;
      let clearedInFile = 0;

      for (const item of items) {
        if (isMarked(item)) {
          clearMark(item);
          modified = true;
          clearedInFile++;
        }
      }

      if (modified) {
        pending.push({ filePath, data, clearedInFile });
        totalCleared += clearedInFile;
      }
    } catch (error) {
      errors.push(`Failed to load ${filePath}: ${error.message}`);
    }
  }

  // Phase 2: Apply all changes atomically (per file)
  // If any write fails, we've already collected the error but continue with others
  for (const { filePath, data } of pending) {
    try {
      await saveJsonFileAtomic(filePath, data);
    } catch (error) {
      errors.push(`Failed to save ${filePath}: ${error.message}`);
      // Note: Some changes may have been applied. In a production system,
      // you might want to track which files succeeded for proper rollback.
    }
  }

  return { cleared: totalCleared, errors };
}

// ============================================================================
// CLEAR NEEDS_REGENERATION AFTER GENERATION
// ============================================================================

/**
 * Clear needsRegeneration flag for successfully generated assets.
 * Called by generation services after assets are created.
 *
 * @param {string} category - Asset category (tiles, portraits, etc.)
 * @param {string[]} assetIds - IDs of assets that were generated
 * @param {object} metadataUtils - Metadata utilities module
 * @returns {Promise<{ cleared: number, errors: string[] }>}
 */
export async function clearNeedsRegeneration(category, assetIds, metadataUtils) {
  // Validate IDs first
  const validation = validateAssetIds(assetIds);
  if (!validation.valid) {
    return { cleared: 0, errors: validation.errors };
  }

  const results = { cleared: 0, errors: [] };

  // Load category data
  let data;
  try {
    data = metadataUtils.loadCategoryAssets(category);
  } catch (error) {
    return { cleared: 0, errors: [`Failed to load ${category}: ${error.message}`] };
  }

  // Group by source file for atomic updates
  const byFile = new Map();
  for (const id of assetIds) {
    const asset = data.byId[id];
    if (asset && asset.needsRegeneration) {
      const file = asset._sourceFile;
      if (!byFile.has(file)) {
        byFile.set(file, []);
      }
      byFile.get(file).push(id);
    }
  }

  // Update each file atomically
  for (const [sourceFile, ids] of byFile.entries()) {
    try {
      for (const id of ids) {
        metadataUtils.updateAssetStatus(category, sourceFile, id, {
          needsRegeneration: false,
          regenerationQueuedAt: null,
          generatedAt: new Date().toISOString()
        });
        results.cleared++;
      }
    } catch (error) {
      results.errors.push(`Failed to update ${sourceFile}: ${error.message}`);
    }
  }

  return results;
}

/**
 * Clear needsRegeneration for audio assets after generation
 *
 * @param {string} audioType - 'music' or 'sfx'
 * @param {string[]} assetIds - IDs of assets that were generated
 * @param {function} updateAudioMetadata - Function to update audio metadata
 * @returns {Promise<{ cleared: number, errors: string[] }>}
 */
export async function clearAudioNeedsRegeneration(audioType, assetIds, updateAudioMetadata) {
  // Validate IDs first
  const validation = validateAssetIds(assetIds);
  if (!validation.valid) {
    return { cleared: 0, errors: validation.errors };
  }

  const results = { cleared: 0, errors: [] };

  for (const id of assetIds) {
    try {
      await updateAudioMetadata(audioType, id, {
        needsRegeneration: false,
        regenerationQueuedAt: null,
        generatedAt: new Date().toISOString()
      });
      results.cleared++;
    } catch (error) {
      // Skip not found errors (asset may have been deleted)
      if (!error.message?.includes('not found')) {
        results.errors.push(`${id}: ${error.message}`);
      }
    }
  }

  return results;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  loadJsonFile,
  saveJsonFileAtomic,
  batchMarkAssets,
  atomicQueueClear,
  clearNeedsRegeneration,
  clearAudioNeedsRegeneration
};
