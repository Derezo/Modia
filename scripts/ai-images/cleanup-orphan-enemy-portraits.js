#!/usr/bin/env node

/**
 * cleanup-orphan-enemy-portraits.js
 *
 * Removes orphan enemy portrait files that are missing the 'enemy_' prefix.
 * These files are duplicates of the correctly-named versions.
 *
 * Usage:
 *   node scripts/ai-images/cleanup-orphan-enemy-portraits.js [options]
 *
 * Options:
 *   --dry-run   (default) Only log what would be deleted, don't actually delete
 *   --yes       Actually perform deletions
 *
 * Examples:
 *   npm run ai:cleanup:orphan-portraits           # Dry run
 *   npm run ai:cleanup:orphan-portraits -- --yes  # Actually delete
 */

const fs = require('fs');
const path = require('path');

// Project root
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// Known enemy sprite_ids (without the 'enemy_' prefix)
const ENEMY_SPRITE_IDS = [
  'bandit_captain',
  'bridge_bandit',
  'bridge_troll',
  'cave_bat',
  'dark_knight',
  'forest_slime',
  'giant_spider',
  'goblin_warrior',
  'gray_wolf',
  'harpy',
  'mountain_troll',
  'palace_guard',
  'shadow_assassin',
  'skeleton_warrior',
  'stone_golem',
  'troll_shaman'
];

// Directories to scan for orphan files
const PORTRAIT_DIRECTORIES = [
  'frontend/public/assets/portraits/originals',
  'frontend/public/assets/portraits/32',
  'frontend/public/assets/portraits/48',
  'frontend/public/assets/portraits/64',
  'frontend/public/assets/portraits/128',
  'frontend/public/assets/portraits/256'
];

// Supported file extensions
const SUPPORTED_EXTENSIONS = ['.png', '.webp'];

/**
 * Parse command line arguments
 * @returns {{ dryRun: boolean }}
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const hasYes = args.includes('--yes');
  const hasDryRun = args.includes('--dry-run');

  // Default to dry-run unless --yes is explicitly provided
  return {
    dryRun: !hasYes || hasDryRun
  };
}

/**
 * Find orphan files in a directory
 * @param {string} dirPath - Absolute path to the directory
 * @returns {{ orphanPath: string, correctPath: string, exists: boolean }[]}
 */
function findOrphansInDirectory(dirPath) {
  const orphans = [];

  if (!fs.existsSync(dirPath)) {
    return orphans;
  }

  const files = fs.readdirSync(dirPath);

  for (const spriteId of ENEMY_SPRITE_IDS) {
    for (const ext of SUPPORTED_EXTENSIONS) {
      const orphanFilename = `${spriteId}${ext}`;
      const correctFilename = `enemy_${spriteId}${ext}`;

      const orphanPath = path.join(dirPath, orphanFilename);
      const correctPath = path.join(dirPath, correctFilename);

      // Check if the orphan file exists
      if (files.includes(orphanFilename)) {
        // Check if the correct version exists
        const correctExists = files.includes(correctFilename);

        orphans.push({
          orphanPath,
          correctPath,
          orphanFilename,
          correctFilename,
          exists: correctExists
        });
      }
    }
  }

  return orphans;
}

/**
 * Delete a file
 * @param {string} filePath - Absolute path to the file
 * @returns {boolean} - True if deleted successfully
 */
function deleteFile(filePath) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    console.error(`  ERROR: Failed to delete ${filePath}: ${error.message}`);
    return false;
  }
}

/**
 * Main execution
 */
function main() {
  const { dryRun } = parseArgs();

  console.log('Scanning for orphan enemy portraits...\n');

  let totalOrphans = 0;
  let totalDeleted = 0;
  let totalSkipped = 0;
  let directoriesScanned = 0;

  const allOrphans = [];

  for (const relativeDir of PORTRAIT_DIRECTORIES) {
    const absoluteDir = path.join(PROJECT_ROOT, relativeDir);

    if (!fs.existsSync(absoluteDir)) {
      console.log(`Directory: ${relativeDir}/`);
      console.log('  (directory does not exist, skipping)\n');
      continue;
    }

    directoriesScanned++;
    const orphans = findOrphansInDirectory(absoluteDir);

    console.log(`Directory: ${relativeDir}/`);

    if (orphans.length === 0) {
      console.log('  No orphan files found.\n');
      continue;
    }

    for (const orphan of orphans) {
      totalOrphans++;

      if (orphan.exists) {
        console.log(`  Found orphan: ${orphan.orphanFilename} (correct version exists: ${orphan.correctFilename})`);
        allOrphans.push(orphan);

        if (!dryRun) {
          if (deleteFile(orphan.orphanPath)) {
            totalDeleted++;
          } else {
            totalSkipped++;
          }
        }
      } else {
        console.log(`  WARNING: ${orphan.orphanFilename} has no correct version (${orphan.correctFilename} missing) - SKIPPING`);
        totalSkipped++;
      }
    }

    console.log('');
  }

  // Summary
  console.log('Summary:');
  console.log(`  Total orphan files found: ${totalOrphans}`);
  console.log(`  Directories scanned: ${directoriesScanned}`);

  if (totalSkipped > 0) {
    console.log(`  Files skipped (missing correct version): ${totalSkipped}`);
  }

  if (dryRun) {
    console.log(`\n[DRY RUN] No files deleted. Run with --yes to delete orphan files.`);
  } else {
    console.log(`\n  Files deleted: ${totalDeleted}`);
    if (totalDeleted === totalOrphans - totalSkipped) {
      console.log('\nCleanup complete.');
    } else {
      console.log('\nCleanup completed with some errors.');
      process.exit(1);
    }
  }

  process.exit(0);
}

main();
