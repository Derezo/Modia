/**
 * Backup and Restore Utilities for AI Image Generation
 * Handles creating and restoring backups of assets before regeneration
 */

const fs = require('fs');
const path = require('path');
const {
  ensureDirectoryExists,
  fileExists,
  loadMetadata,
  saveMetadata,
  getProjectRoot,
  getMetadataDir,
  log
} = require('./imageUtils');

/**
 * Get the backup directory root
 * @returns {string} Absolute path to ai-image-backups directory
 */
function getBackupDir() {
  return path.join(getProjectRoot(), 'ai-image-backups');
}

/**
 * Format a timestamp for backup directory names
 * @param {Date} date - Date to format
 * @returns {string} Formatted timestamp (YYYY-MM-DD_HH-MM-SS)
 */
function formatBackupTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

/**
 * Parse a backup timestamp string back to a Date
 * @param {string} timestamp - Timestamp string (YYYY-MM-DD_HH-MM-SS)
 * @returns {Date|null} Parsed date or null if invalid
 */
function parseBackupTimestamp(timestamp) {
  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const [, year, month, day, hours, minutes, seconds] = match;
  return new Date(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    parseInt(hours, 10),
    parseInt(minutes, 10),
    parseInt(seconds, 10)
  );
}

/**
 * Get the image output directory for a category
 * @param {string} category - Asset category
 * @returns {string} Path to the image output directory
 */
function getImageOutputDir(category) {
  const projectRoot = getProjectRoot();

  // Map category to canonical image output paths (matches shared/assetPaths.js)
  const categoryPaths = {
    tiles: path.join(projectRoot, 'frontend/public/assets/sprites/terrain'),
    portraits: path.join(projectRoot, 'frontend/public/assets/portraits'),
    items: path.join(projectRoot, 'frontend/public/assets/items'),
    icons: path.join(projectRoot, 'frontend/public/assets/icons'),
    nodes: path.join(projectRoot, 'frontend/public/assets/nodes'),
    overlays: path.join(projectRoot, 'frontend/public/assets/overlays')
  };

  return categoryPaths[category] || null;
}

/**
 * Copy a file if it exists
 * @param {string} src - Source path
 * @param {string} dest - Destination path
 * @returns {boolean} True if file was copied
 */
function copyFileIfExists(src, dest) {
  if (!fileExists(src)) {
    return false;
  }

  const destDir = path.dirname(dest);
  ensureDirectoryExists(destDir);

  try {
    fs.copyFileSync(src, dest);
    return true;
  } catch (error) {
    log(`Failed to copy ${src} to ${dest}: ${error.message}`, 'warn');
    return false;
  }
}

/**
 * Copy a directory recursively
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 * @returns {number} Number of files copied
 */
function copyDirectoryRecursive(src, dest) {
  if (!fileExists(src)) {
    return 0;
  }

  ensureDirectoryExists(dest);
  let fileCount = 0;

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      fileCount += copyDirectoryRecursive(srcPath, destPath);
    } else {
      if (copyFileIfExists(srcPath, destPath)) {
        fileCount++;
      }
    }
  }

  return fileCount;
}

/**
 * Get the image path for an asset
 * @param {Object} asset - Asset object with category and id
 * @returns {string|null} Path to the image file or null
 */
function getAssetImagePath(asset) {
  const category = asset._category;
  const baseDir = getImageOutputDir(category);

  if (!baseDir) return null;

  // Build path based on category using canonical structure (matches shared/assetPaths.js)
  switch (category) {
    case 'tiles': {
      // Tiles: sprites/terrain/{biome}/{key}.png
      const biome = asset._biome || asset.biome;
      if (biome && asset.id) {
        return path.join(baseDir, biome, `${asset.id}.png`);
      }
      break;
    }
    case 'portraits': {
      // Portraits: portraits/originals/{id}.png
      if (asset.id) {
        return path.join(baseDir, 'originals', `${asset.id}.png`);
      }
      break;
    }
    case 'items': {
      // Items: items/originals/{itemCategory}/{id}.png
      const itemCategory = asset._itemCategory || 'misc';
      if (asset.id) {
        return path.join(baseDir, 'originals', itemCategory, `${asset.id}.png`);
      }
      break;
    }
    case 'icons': {
      // Icons: icons/originals/{iconCategory}/{id}.png
      const iconCategory = asset._iconCategory || 'misc';
      if (asset.id) {
        return path.join(baseDir, 'originals', iconCategory, `${asset.id}.png`);
      }
      break;
    }
    case 'nodes': {
      // Nodes: nodes/originals/{id}.png
      if (asset.id) {
        return path.join(baseDir, 'originals', `${asset.id}.png`);
      }
      break;
    }
    case 'overlays': {
      // Overlays: overlays/originals/{subcategory}/{id}.png
      const subcategory = asset._subcategory || 'rarity';
      if (asset.id) {
        return path.join(baseDir, 'originals', subcategory, `${asset.id}.png`);
      }
      break;
    }
  }

  return null;
}

/**
 * Create a timestamped backup of assets before regeneration
 * @param {Object[]} affectedAssets - Array of asset objects to back up
 * @param {Object} options - Backup options
 * @param {string} options.reason - Reason for the backup
 * @param {string} options.timestamp - Optional custom timestamp
 * @returns {Object} { success: true, backupDir, assetCount, timestamp } or { success: false, error }
 */
function createBackup(affectedAssets, options = {}) {
  try {
    const { reason = 'regeneration', timestamp = formatBackupTimestamp() } = options;

    const backupRoot = getBackupDir();
    const backupDir = path.join(backupRoot, timestamp);

    log(`Creating backup at ${backupDir}`, 'info');
    ensureDirectoryExists(backupDir);

  // Track what we're backing up
  const manifest = {
    timestamp,
    createdAt: new Date().toISOString(),
    reason,
    assetCount: 0,
    metadataFiles: [],
    imageFiles: [],
    categories: {}
  };

  // 1. Copy theme.json
  const themeSource = path.join(getMetadataDir(), 'theme.json');
  const themeDest = path.join(backupDir, 'theme.json');
  if (copyFileIfExists(themeSource, themeDest)) {
    log('Backed up theme.json', 'debug');
  }

  // 2. Group assets by category and source file
  const assetsByFile = new Map();
  const categoriesToBackup = new Set();

  for (const asset of affectedAssets) {
    const category = asset._category;
    const sourceFile = asset._sourceFile;

    if (!category || !sourceFile) {
      log(`Skipping asset without category/sourceFile: ${JSON.stringify(asset)}`, 'warn');
      continue;
    }

    categoriesToBackup.add(category);

    const fileKey = `${category}/${sourceFile}`;
    if (!assetsByFile.has(fileKey)) {
      assetsByFile.set(fileKey, []);
    }
    assetsByFile.get(fileKey).push(asset);
  }

  // 3. Copy affected metadata files
  const metadataBackupDir = path.join(backupDir, 'metadata');

  for (const fileKey of assetsByFile.keys()) {
    const sourcePath = path.join(getMetadataDir(), fileKey);
    const destPath = path.join(metadataBackupDir, fileKey);

    if (copyFileIfExists(sourcePath, destPath)) {
      manifest.metadataFiles.push(fileKey);
      log(`Backed up metadata: ${fileKey}`, 'debug');
    }
  }

  // Also backup manifest files for affected categories
  for (const category of categoriesToBackup) {
    const manifestFile = `${category}/manifest.json`;
    const sourcePath = path.join(getMetadataDir(), manifestFile);
    const destPath = path.join(metadataBackupDir, manifestFile);

    if (copyFileIfExists(sourcePath, destPath)) {
      if (!manifest.metadataFiles.includes(manifestFile)) {
        manifest.metadataFiles.push(manifestFile);
      }
    }

    // Initialize category tracking
    manifest.categories[category] = {
      assetCount: 0,
      imagesCopied: 0
    };
  }

  // 4. Copy affected image files
  const imagesBackupDir = path.join(backupDir, 'images');

  for (const asset of affectedAssets) {
    const imagePath = getAssetImagePath(asset);

    if (!imagePath) {
      continue;
    }

    if (!fileExists(imagePath)) {
      // Image doesn't exist yet, nothing to back up
      continue;
    }

    // Calculate relative path from project root for consistent structure
    const category = asset._category;
    const imageOutputDir = getImageOutputDir(category);
    const relativePath = path.relative(imageOutputDir, imagePath);
    const destPath = path.join(imagesBackupDir, category, relativePath);

    if (copyFileIfExists(imagePath, destPath)) {
      manifest.imageFiles.push({
        category,
        assetId: asset.id,
        relativePath
      });
      manifest.categories[category].imagesCopied++;
      log(`Backed up image: ${category}/${relativePath}`, 'debug');
    }
  }

  // 5. Update manifest counts
  for (const [fileKey, assets] of assetsByFile) {
    const category = fileKey.split('/')[0];
    manifest.categories[category].assetCount += assets.length;
  }

  manifest.assetCount = affectedAssets.length;

  // 6. Save the backup manifest
  const manifestPath = path.join(backupDir, 'manifest.json');
  saveMetadata(manifestPath, manifest);

    log(`Backup complete: ${manifest.assetCount} assets, ${manifest.metadataFiles.length} metadata files, ${manifest.imageFiles.length} images`, 'success');

    return {
      success: true,
      backupDir,
      assetCount: manifest.assetCount,
      timestamp
    };
  } catch (error) {
    log(`Backup failed: ${error.message}`, 'error');
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Restore from a backup
 * @param {string} timestamp - Backup timestamp to restore
 * @returns {Object} { success: true, assetCount, imagesRestored, timestamp } or throws on error
 */
function restoreBackup(timestamp) {
  const backupDir = path.join(getBackupDir(), timestamp);

  if (!fileExists(backupDir)) {
    throw new Error(`Backup not found: ${timestamp}`);
  }

  const manifestPath = path.join(backupDir, 'manifest.json');
  const manifest = loadMetadata(manifestPath);

  if (!manifest) {
    throw new Error(`Backup manifest not found or invalid: ${timestamp}`);
  }

  log(`Restoring backup from ${timestamp}`, 'info');

  let restoredCount = 0;

  // 1. Restore theme.json
  const themeSource = path.join(backupDir, 'theme.json');
  const themeDest = path.join(getMetadataDir(), 'theme.json');
  if (copyFileIfExists(themeSource, themeDest)) {
    log('Restored theme.json', 'debug');
  }

  // 2. Restore metadata files
  const metadataBackupDir = path.join(backupDir, 'metadata');

  for (const metadataFile of manifest.metadataFiles || []) {
    const sourcePath = path.join(metadataBackupDir, metadataFile);
    const destPath = path.join(getMetadataDir(), metadataFile);

    if (copyFileIfExists(sourcePath, destPath)) {
      log(`Restored metadata: ${metadataFile}`, 'debug');
    }
  }

  // 3. Restore image files
  const imagesBackupDir = path.join(backupDir, 'images');

  for (const imageInfo of manifest.imageFiles || []) {
    const { category, relativePath } = imageInfo;
    const sourcePath = path.join(imagesBackupDir, category, relativePath);
    const destDir = getImageOutputDir(category);
    const destPath = path.join(destDir, relativePath);

    if (copyFileIfExists(sourcePath, destPath)) {
      restoredCount++;
      log(`Restored image: ${category}/${relativePath}`, 'debug');
    }
  }

  log(`Restore complete: ${restoredCount} images restored from ${manifest.assetCount} assets`, 'success');

  return {
    success: true,
    restored: restoredCount,
    assetCount: manifest.assetCount,
    imagesRestored: restoredCount,
    timestamp
  };
}

/**
 * List available backups
 * @returns {Object[]} Array of { timestamp, assetCount, reason, createdAt }
 */
function listBackups() {
  const backupRoot = getBackupDir();

  if (!fileExists(backupRoot)) {
    return [];
  }

  const backups = [];

  try {
    const entries = fs.readdirSync(backupRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Validate timestamp format
      const timestamp = entry.name;
      if (!parseBackupTimestamp(timestamp)) continue;

      const manifestPath = path.join(backupRoot, timestamp, 'manifest.json');
      const manifest = loadMetadata(manifestPath);

      if (manifest) {
        backups.push({
          timestamp,
          assetCount: manifest.assetCount || 0,
          reason: manifest.reason || 'unknown',
          createdAt: manifest.createdAt || null,
          categories: manifest.categories || {},
          metadataFiles: manifest.metadataFiles?.length || 0,
          imageFiles: manifest.imageFiles?.length || 0
        });
      }
    }
  } catch (error) {
    log(`Failed to list backups: ${error.message}`, 'error');
    return [];
  }

  // Sort by timestamp descending (most recent first)
  backups.sort((a, b) => {
    const dateA = parseBackupTimestamp(a.timestamp);
    const dateB = parseBackupTimestamp(b.timestamp);
    return dateB - dateA;
  });

  return backups;
}

/**
 * Get the most recent backup timestamp
 * @returns {string|null} Most recent backup timestamp or null if no backups exist
 */
function getLatestBackup() {
  const backups = listBackups();
  return backups.length > 0 ? backups[0].timestamp : null;
}

/**
 * Get detailed information about a specific backup
 * @param {string} timestamp - Backup timestamp to look up
 * @returns {Object|null} Backup info { timestamp, assetCount, totalSize, categories, reason, createdAt } or null if not found
 */
function getBackupInfo(timestamp) {
  const backups = listBackups();
  const backup = backups.find(b => b.timestamp === timestamp);

  if (!backup) {
    return null;
  }

  // Calculate total size by walking the backup directory
  const backupDir = path.join(getBackupDir(), timestamp);
  let totalSize = 0;

  try {
    const calculateDirSize = (dir) => {
      if (!fileExists(dir)) return 0;
      let size = 0;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          size += calculateDirSize(entryPath);
        } else {
          size += fs.statSync(entryPath).size;
        }
      }
      return size;
    };
    totalSize = calculateDirSize(backupDir);
  } catch (error) {
    log(`Failed to calculate backup size: ${error.message}`, 'warn');
  }

  return {
    timestamp: backup.timestamp,
    assetCount: backup.assetCount,
    totalSize,
    categories: backup.categories,
    reason: backup.reason,
    createdAt: backup.createdAt
  };
}

/**
 * Delete a backup
 * @param {string} timestamp - Backup timestamp to delete
 * @returns {boolean} True if deleted successfully
 */
function deleteBackup(timestamp) {
  const backupDir = path.join(getBackupDir(), timestamp);

  if (!fileExists(backupDir)) {
    return false;
  }

  try {
    fs.rmSync(backupDir, { recursive: true, force: true });
    log(`Deleted backup: ${timestamp}`, 'info');
    return true;
  } catch (error) {
    log(`Failed to delete backup ${timestamp}: ${error.message}`, 'error');
    return false;
  }
}

/**
 * Clean up old backups, keeping only the most recent N
 * @param {number} keepCount - Number of backups to keep
 * @returns {number} Number of backups deleted
 */
function cleanupOldBackups(keepCount = 5) {
  const backups = listBackups();

  if (backups.length <= keepCount) {
    return 0;
  }

  const toDelete = backups.slice(keepCount);
  let deletedCount = 0;

  for (const backup of toDelete) {
    if (deleteBackup(backup.timestamp)) {
      deletedCount++;
    }
  }

  log(`Cleaned up ${deletedCount} old backups`, 'info');
  return deletedCount;
}

module.exports = {
  getBackupDir,
  formatBackupTimestamp,
  parseBackupTimestamp,
  getImageOutputDir,
  getAssetImagePath,
  createBackup,
  restoreBackup,
  listBackups,
  getLatestBackup,
  getBackupInfo,
  deleteBackup,
  cleanupOldBackups
};
