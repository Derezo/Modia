#!/usr/bin/env node
/**
 * @module migrate-icon-paths
 * @description Migrates icon files from legacy hyphen format to canonical subdirectory structure.
 *
 * Legacy format: /assets/icons/png/{size}/{subcategory}-{id}.png
 * Canonical format: /assets/icons/png/{size}/{subcategory}/{id}.png
 *
 * Usage:
 *   node scripts/ai-images/migrate-icon-paths.js           # Execute migration
 *   node scripts/ai-images/migrate-icon-paths.js --dry-run # Preview changes only
 *
 * @example
 * # Dry run to see what would be migrated
 * npm run ai:migrate-icon-paths -- --dry-run
 *
 * # Execute migration
 * npm run ai:migrate-icon-paths
 */

const fs = require('fs').promises;
const path = require('path');

const ICONS_BASE = path.join(__dirname, '../../frontend/public/assets/icons/png');

// All icon size directories to scan
const SIZES = ['16', '24', '32', '48', '64', '128'];

// Pattern for hyphen-format files: {subcategory}-{id}.png
// subcategory is typically lowercase letters (actions, status, etc.)
// id can contain letters, numbers, and underscores
const HYPHEN_PATTERN = /^([a-z]+)-(.+)\.png$/;

/**
 * Check if a directory exists
 * @param {string} dirPath - Directory path to check
 * @returns {Promise<boolean>}
 */
async function directoryExists(dirPath) {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a file exists
 * @param {string} filePath - File path to check
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

/**
 * Find all files matching the legacy hyphen format in a size directory
 * @param {string} sizeDir - Path to a size directory (e.g., /path/to/icons/png/32)
 * @returns {Promise<Array<{file: string, subcategory: string, id: string}>>}
 */
async function findLegacyFiles(sizeDir) {
  const legacyFiles = [];

  try {
    const entries = await fs.readdir(sizeDir, { withFileTypes: true });

    for (const entry of entries) {
      // Only process files in the root of the size directory (not subdirectories)
      if (!entry.isFile()) continue;

      const match = entry.name.match(HYPHEN_PATTERN);
      if (match) {
        legacyFiles.push({
          file: entry.name,
          subcategory: match[1],
          id: match[2]
        });
      }
    }
  } catch (err) {
    // Directory might not exist for all sizes
    if (err.code !== 'ENOENT') {
      console.error(`Error reading directory ${sizeDir}: ${err.message}`);
    }
  }

  return legacyFiles;
}

/**
 * Migrate icon files from legacy hyphen format to canonical subdirectory structure
 * @param {boolean} dryRun - If true, only preview changes without executing
 * @returns {Promise<void>}
 */
async function migrateIcons(dryRun = false) {
  console.log('Icon Path Migration Script');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'EXECUTE'}`);
  console.log(`Icons base: ${ICONS_BASE}`);
  console.log('');

  // Check if icons base directory exists
  if (!await directoryExists(ICONS_BASE)) {
    console.log('Icons base directory does not exist. Nothing to migrate.');
    return;
  }

  let totalFiles = 0;
  let migratedFiles = 0;
  let skippedFiles = 0;
  let errorFiles = 0;

  const migrations = [];

  // Scan each size directory
  for (const size of SIZES) {
    const sizeDir = path.join(ICONS_BASE, size);

    if (!await directoryExists(sizeDir)) {
      continue;
    }

    const legacyFiles = await findLegacyFiles(sizeDir);

    for (const { file, subcategory, id } of legacyFiles) {
      totalFiles++;

      const sourcePath = path.join(sizeDir, file);
      const targetDir = path.join(sizeDir, subcategory);
      const targetPath = path.join(targetDir, `${id}.png`);

      // Check if target already exists
      if (await fileExists(targetPath)) {
        console.log(`SKIP: ${size}/${file} -> target already exists`);
        skippedFiles++;
        continue;
      }

      migrations.push({
        size,
        file,
        subcategory,
        id,
        sourcePath,
        targetDir,
        targetPath
      });
    }
  }

  if (migrations.length === 0) {
    console.log('No legacy icon files found to migrate.');
    console.log('');
    console.log(`Summary: ${totalFiles} files scanned, ${skippedFiles} skipped (already migrated)`);
    return;
  }

  console.log(`Found ${migrations.length} files to migrate:`);
  console.log('');

  // Execute migrations
  for (const migration of migrations) {
    const { size, file, subcategory, id, sourcePath, targetDir, targetPath } = migration;

    const relativeSource = `${size}/${file}`;
    const relativeTarget = `${size}/${subcategory}/${id}.png`;

    console.log(`MIGRATE: ${relativeSource} -> ${relativeTarget}`);

    if (!dryRun) {
      try {
        // Create target directory if needed
        await fs.mkdir(targetDir, { recursive: true });

        // Move file to new location
        await fs.rename(sourcePath, targetPath);

        migratedFiles++;
        console.log(`  SUCCESS`);
      } catch (err) {
        errorFiles++;
        console.error(`  ERROR: ${err.message}`);
      }
    } else {
      migratedFiles++;
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Summary:');
  console.log(`  Total files scanned: ${totalFiles}`);
  console.log(`  Files migrated: ${migratedFiles}${dryRun ? ' (dry run)' : ''}`);
  console.log(`  Files skipped (already exist): ${skippedFiles}`);
  if (errorFiles > 0) {
    console.log(`  Errors: ${errorFiles}`);
  }

  if (dryRun && migrations.length > 0) {
    console.log('');
    console.log('Run without --dry-run to execute the migration.');
  }
}

// Parse command line arguments
const dryRun = process.argv.includes('--dry-run');

// Execute migration
migrateIcons(dryRun).catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
