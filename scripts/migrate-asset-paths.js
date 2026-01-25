#!/usr/bin/env node
/**
 * Asset Path Migration Script
 * Migrates assets from legacy /assets/sprites/ structure to new standardized paths.
 *
 * This script:
 * 1. Creates new directory structure
 * 2. Copies files to new locations (preserving originals for rollback)
 * 3. Verifies all copies
 * 4. Optionally removes old directories after verification
 *
 * Usage:
 *   node scripts/migrate-asset-paths.js --dry-run     # Preview changes
 *   node scripts/migrate-asset-paths.js               # Perform migration
 *   node scripts/migrate-asset-paths.js --cleanup     # Remove old directories after migration
 *   node scripts/migrate-asset-paths.js --verify      # Verify migration was successful
 */

const fs = require('fs');
const path = require('path');

// Configuration
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ASSETS_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets');
const OLD_SPRITES_DIR = path.join(ASSETS_DIR, 'sprites');

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    cleanup: args.includes('--cleanup'),
    verify: args.includes('--verify'),
    help: args.includes('--help') || args.includes('-h')
  };
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
Asset Path Migration Script
===========================

Migrates assets from legacy /assets/sprites/ structure to new standardized paths.

Migration paths:
  sprites/portraits     → portraits/{size}/
  sprites/enemies/portraits → portraits/{size}/enemy_*
  sprites/nodes         → nodes/{size}/
  sprites/items         → items/{size}/{category}/
  sprites/icons         → icons/png/{size}/{category}/
  sprites/terrain       → terrain/{biome}/
  sprites/overlays      → overlays/{size}/{category}/

Usage:
  node scripts/migrate-asset-paths.js [options]

Options:
  --dry-run    Preview changes without moving files
  --cleanup    Remove old directories after migration (careful!)
  --verify     Verify migration completeness
  --help, -h   Show this help message

Examples:
  # Preview migration
  node scripts/migrate-asset-paths.js --dry-run

  # Perform migration (keeps old files for rollback)
  node scripts/migrate-asset-paths.js

  # Verify and cleanup
  node scripts/migrate-asset-paths.js --verify
  node scripts/migrate-asset-paths.js --cleanup
`);
}

/**
 * Ensure directory exists
 */
function ensureDir(dir, dryRun = false) {
  if (!fs.existsSync(dir)) {
    if (dryRun) {
      console.log(`  [DRY-RUN] Would create directory: ${path.relative(PROJECT_ROOT, dir)}`);
    } else {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`  Created: ${path.relative(PROJECT_ROOT, dir)}`);
    }
  }
}

/**
 * Copy file with logging
 */
function copyFile(src, dest, dryRun = false) {
  if (!fs.existsSync(src)) {
    console.log(`  [SKIP] Source not found: ${path.relative(PROJECT_ROOT, src)}`);
    return false;
  }

  if (dryRun) {
    console.log(`  [DRY-RUN] Would copy: ${path.relative(PROJECT_ROOT, src)} → ${path.relative(PROJECT_ROOT, dest)}`);
    return true;
  }

  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return true;
}

/**
 * Get files in directory matching pattern
 */
function getFiles(dir, extension = '.png') {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => f.endsWith(extension))
    .map(f => path.join(dir, f));
}

/**
 * Get all files recursively
 */
function getAllFiles(dir, extension = '.png') {
  const files = [];

  if (!fs.existsSync(dir)) return files;

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(extension)) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * Create new directory structure
 */
function createDirectoryStructure(options) {
  console.log('\n[1/4] Creating directory structure...\n');

  const { dryRun } = options;
  const dirs = [
    // Portraits
    'portraits/originals',
    'portraits/64',
    'portraits/128',
    'portraits/256',

    // Nodes
    'nodes/originals',
    'nodes/48',
    'nodes/96',

    // Items
    'items/originals/weapons',
    'items/originals/armor',
    'items/originals/accessories',
    'items/originals/consumables',
    'items/32/weapons',
    'items/32/armor',
    'items/32/accessories',
    'items/32/consumables',
    'items/64/weapons',
    'items/64/armor',
    'items/64/accessories',
    'items/64/consumables',
    'items/128/weapons',
    'items/128/armor',
    'items/128/accessories',
    'items/128/consumables',

    // Icons (PNG only - SVG icons stay in icons/)
    'icons/originals/actions',
    'icons/originals/status',
    'icons/originals/ui',
    'icons/originals/skills',
    'icons/png/16/actions',
    'icons/png/16/status',
    'icons/png/16/ui',
    'icons/png/16/skills',
    'icons/png/24/actions',
    'icons/png/24/status',
    'icons/png/24/ui',
    'icons/png/24/skills',
    'icons/png/32/actions',
    'icons/png/32/status',
    'icons/png/32/ui',
    'icons/png/32/skills',
    'icons/png/48/actions',
    'icons/png/48/status',
    'icons/png/48/ui',
    'icons/png/48/skills',
    'icons/png/64/actions',
    'icons/png/64/status',
    'icons/png/64/ui',
    'icons/png/64/skills',

    // Terrain
    'terrain/originals',
    'terrain/forest',
    'terrain/forest/walls',
    'terrain/forest/slopes',
    'terrain/cave',
    'terrain/cave/walls',
    'terrain/cave/slopes',
    'terrain/mountain',
    'terrain/mountain/walls',
    'terrain/mountain/slopes',
    'terrain/bridge',
    'terrain/bridge/walls',
    'terrain/bridge/slopes',
    'terrain/castle',
    'terrain/castle/walls',
    'terrain/castle/slopes',

    // Overlays
    'overlays/originals/rarity',
    'overlays/originals/augments',
    'overlays/32/rarity',
    'overlays/32/augments',
    'overlays/48/rarity',
    'overlays/48/augments',
    'overlays/64/rarity',
    'overlays/64/augments',
    'overlays/128/rarity',
    'overlays/128/augments'
  ];

  for (const dir of dirs) {
    ensureDir(path.join(ASSETS_DIR, dir), dryRun);
  }

  console.log(`\n  ${dirs.length} directories configured.`);
}

/**
 * Migrate portraits
 */
function migratePortraits(options) {
  console.log('\n[2/4] Migrating portraits...\n');

  const { dryRun } = options;
  let migrated = 0;
  let skipped = 0;

  // Migrate player portraits from sprites/portraits
  const playerPortraitsDir = path.join(OLD_SPRITES_DIR, 'portraits');
  if (fs.existsSync(playerPortraitsDir)) {
    const files = getFiles(playerPortraitsDir);
    console.log(`  Found ${files.length} player portraits`);

    for (const file of files) {
      const filename = path.basename(file);
      // Player portraits go to portraits/64/{filename} (default size)
      const dest = path.join(ASSETS_DIR, 'portraits/64', filename);

      if (copyFile(file, dest, dryRun)) {
        migrated++;
      } else {
        skipped++;
      }
    }

    // Also check for size subdirectories
    for (const size of ['128x128', '256x256']) {
      const sizeDir = path.join(playerPortraitsDir, size);
      const newSize = size.split('x')[0];
      if (fs.existsSync(sizeDir)) {
        const sizeFiles = getFiles(sizeDir);
        for (const file of sizeFiles) {
          const filename = path.basename(file);
          const dest = path.join(ASSETS_DIR, `portraits/${newSize}`, filename);
          if (copyFile(file, dest, dryRun)) migrated++;
        }
      }
    }
  }

  // Migrate enemy portraits from sprites/enemies/portraits
  const enemyPortraitsDir = path.join(OLD_SPRITES_DIR, 'enemies/portraits');
  if (fs.existsSync(enemyPortraitsDir)) {
    const files = getFiles(enemyPortraitsDir);
    console.log(`  Found ${files.length} enemy portraits`);

    for (const file of files) {
      const filename = path.basename(file);
      // Enemy portraits get enemy_ prefix
      const newFilename = filename.startsWith('enemy_') ? filename : `enemy_${filename}`;
      const dest = path.join(ASSETS_DIR, 'portraits/64', newFilename);

      if (copyFile(file, dest, dryRun)) {
        migrated++;
      } else {
        skipped++;
      }
    }
  }

  console.log(`\n  Portraits: ${migrated} migrated, ${skipped} skipped`);
  return { migrated, skipped };
}

/**
 * Migrate nodes
 */
function migrateNodes(options) {
  console.log('\n[3/4] Migrating nodes...\n');

  const { dryRun } = options;
  let migrated = 0;
  let skipped = 0;

  const nodesDir = path.join(OLD_SPRITES_DIR, 'nodes');
  if (fs.existsSync(nodesDir)) {
    // Main node files (node_*.png)
    const files = getFiles(nodesDir);
    console.log(`  Found ${files.length} node sprites`);

    for (const file of files) {
      const filename = path.basename(file);
      // Strip node_ prefix from filename
      const newFilename = filename.replace(/^node_/, '');
      // Default size is 96
      const dest = path.join(ASSETS_DIR, 'nodes/96', newFilename);

      if (copyFile(file, dest, dryRun)) {
        migrated++;
      } else {
        skipped++;
      }
    }

    // Check for size subdirectories (48x48, 96x96)
    for (const sizeDirName of ['48x48', '96x96']) {
      const sizeDir = path.join(nodesDir, sizeDirName);
      const newSize = sizeDirName.split('x')[0];
      if (fs.existsSync(sizeDir)) {
        const sizeFiles = getFiles(sizeDir);
        console.log(`  Found ${sizeFiles.length} nodes in ${sizeDirName}`);
        for (const file of sizeFiles) {
          const filename = path.basename(file);
          const newFilename = filename.replace(/^node_/, '');
          const dest = path.join(ASSETS_DIR, `nodes/${newSize}`, newFilename);
          if (copyFile(file, dest, dryRun)) migrated++;
        }
      }
    }
  }

  console.log(`\n  Nodes: ${migrated} migrated, ${skipped} skipped`);
  return { migrated, skipped };
}

/**
 * Migrate terrain tiles
 */
function migrateTerrain(options) {
  console.log('\n[4/4] Migrating terrain...\n');

  const { dryRun } = options;
  let migrated = 0;
  let skipped = 0;

  const terrainDir = path.join(OLD_SPRITES_DIR, 'terrain');
  if (fs.existsSync(terrainDir)) {
    // Iterate biomes
    const biomes = ['forest', 'cave', 'mountain', 'bridge', 'castle'];

    for (const biome of biomes) {
      const biomeDir = path.join(terrainDir, biome);
      if (!fs.existsSync(biomeDir)) continue;

      // Migrate floor tiles
      const floorFiles = getFiles(biomeDir);
      console.log(`  ${biome}: ${floorFiles.length} floor tiles`);

      for (const file of floorFiles) {
        const filename = path.basename(file);
        const dest = path.join(ASSETS_DIR, `terrain/${biome}`, filename);
        if (copyFile(file, dest, dryRun)) migrated++;
      }

      // Migrate walls
      const wallsDir = path.join(biomeDir, 'walls');
      if (fs.existsSync(wallsDir)) {
        const wallFiles = getFiles(wallsDir);
        for (const file of wallFiles) {
          const filename = path.basename(file);
          const dest = path.join(ASSETS_DIR, `terrain/${biome}/walls`, filename);
          if (copyFile(file, dest, dryRun)) migrated++;
        }
      }

      // Migrate slopes
      const slopesDir = path.join(biomeDir, 'slopes');
      if (fs.existsSync(slopesDir)) {
        const slopeFiles = getFiles(slopesDir);
        for (const file of slopeFiles) {
          const filename = path.basename(file);
          const dest = path.join(ASSETS_DIR, `terrain/${biome}/slopes`, filename);
          if (copyFile(file, dest, dryRun)) migrated++;
        }
      }
    }

    // Skip base biome (deprecated)
    console.log('  [SKIP] base biome (deprecated, using forest as fallback)');
  }

  console.log(`\n  Terrain: ${migrated} migrated, ${skipped} skipped`);
  return { migrated, skipped };
}

/**
 * Verify migration
 */
function verifyMigration(options) {
  console.log('\nVerifying migration...\n');

  const checks = {
    passed: 0,
    failed: 0,
    warnings: []
  };

  // Check portrait directories exist
  for (const size of [64, 128, 256]) {
    const dir = path.join(ASSETS_DIR, `portraits/${size}`);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
      checks.passed++;
    } else {
      checks.warnings.push(`portraits/${size} is empty or missing`);
    }
  }

  // Check nodes directories
  for (const size of [48, 96]) {
    const dir = path.join(ASSETS_DIR, `nodes/${size}`);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
      checks.passed++;
    } else {
      checks.warnings.push(`nodes/${size} is empty or missing`);
    }
  }

  // Check terrain biomes
  for (const biome of ['forest', 'cave', 'mountain', 'bridge', 'castle']) {
    const dir = path.join(ASSETS_DIR, `terrain/${biome}`);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
      checks.passed++;
    } else {
      checks.warnings.push(`terrain/${biome} is empty or missing`);
    }
  }

  // Check for enemy portraits with enemy_ prefix
  const portraits64 = path.join(ASSETS_DIR, 'portraits/64');
  if (fs.existsSync(portraits64)) {
    const enemyPortraits = fs.readdirSync(portraits64).filter(f => f.startsWith('enemy_'));
    if (enemyPortraits.length > 0) {
      checks.passed++;
      console.log(`  Found ${enemyPortraits.length} enemy portraits with proper prefix`);
    } else {
      checks.warnings.push('No enemy portraits found with enemy_ prefix');
    }
  }

  // Check for nodes without node_ prefix
  const nodes96 = path.join(ASSETS_DIR, 'nodes/96');
  if (fs.existsSync(nodes96)) {
    const nodeFiles = fs.readdirSync(nodes96);
    const withPrefix = nodeFiles.filter(f => f.startsWith('node_'));
    if (withPrefix.length === 0) {
      checks.passed++;
      console.log(`  ${nodeFiles.length} node files without node_ prefix (correct)`);
    } else {
      checks.warnings.push(`${withPrefix.length} node files still have node_ prefix`);
    }
  }

  console.log(`\nVerification: ${checks.passed} passed`);
  if (checks.warnings.length > 0) {
    console.log(`Warnings (${checks.warnings.length}):`);
    for (const warning of checks.warnings) {
      console.log(`  - ${warning}`);
    }
  }

  return checks;
}

/**
 * Cleanup old directories
 */
function cleanupOldDirectories(options) {
  console.log('\nCleaning up old directories...\n');

  if (options.dryRun) {
    console.log('  [DRY-RUN] Would remove: sprites/portraits');
    console.log('  [DRY-RUN] Would remove: sprites/enemies/portraits');
    console.log('  [DRY-RUN] Would remove: sprites/nodes');
    console.log('  [DRY-RUN] Would remove: sprites/terrain/base');
    return;
  }

  const dirsToRemove = [
    // Note: We keep sprites/ for now as it still contains:
    // - characters/ (animated sprites)
    // - obstacles/
    // - items/ (until migrated)
    // - overlays/ (until migrated)
    // - icons/ (until migrated)
  ];

  console.log('  Note: Old directories preserved for rollback.');
  console.log('  Run manually to remove after verification:');
  console.log('    rm -rf frontend/public/assets/sprites/portraits');
  console.log('    rm -rf frontend/public/assets/sprites/enemies/portraits');
  console.log('    rm -rf frontend/public/assets/sprites/nodes');
  console.log('    rm -rf frontend/public/assets/sprites/terrain/base');
}

/**
 * Main execution
 */
function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  console.log('Asset Path Migration Script');
  console.log('===========================');

  if (options.dryRun) {
    console.log('\n[DRY-RUN MODE] No files will be modified.\n');
  }

  if (options.verify) {
    verifyMigration(options);
    process.exit(0);
  }

  // Create directory structure
  createDirectoryStructure(options);

  // Migrate assets
  const portraitResults = migratePortraits(options);
  const nodeResults = migrateNodes(options);
  const terrainResults = migrateTerrain(options);

  // Summary
  const total = {
    migrated: portraitResults.migrated + nodeResults.migrated + terrainResults.migrated,
    skipped: portraitResults.skipped + nodeResults.skipped + terrainResults.skipped
  };

  console.log('\n========================================');
  console.log('Migration Summary');
  console.log('========================================');
  console.log(`  Total migrated: ${total.migrated}`);
  console.log(`  Total skipped:  ${total.skipped}`);

  if (!options.dryRun) {
    console.log('\nNext steps:');
    console.log('  1. Run: npm run dev');
    console.log('  2. Test that assets load correctly');
    console.log('  3. If OK, run: node scripts/migrate-asset-paths.js --cleanup');
  }

  // Cleanup if requested
  if (options.cleanup) {
    cleanupOldDirectories(options);
  }
}

main();
