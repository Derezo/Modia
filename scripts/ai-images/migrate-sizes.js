#!/usr/bin/env node
/**
 * Migrate existing assets to generate missing size variants
 *
 * Usage:
 *   node scripts/ai-images/migrate-sizes.js --category nodes
 *   node scripts/ai-images/migrate-sizes.js --category icons --size 64
 *   node scripts/ai-images/migrate-sizes.js --all --dry-run
 *   node scripts/ai-images/migrate-sizes.js --category items --subcategory weapons
 */

const path = require('path');
const fs = require('fs');
const { program } = require('commander');
const {
  resizeImage,
  SIZE_PRESETS,
  fileExists,
  ensureDirectoryExists,
  log,
  checkImageMagick
} = require('./lib');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ASSETS_ROOT = path.join(PROJECT_ROOT, 'frontend/public/assets');

/**
 * Source locations for each category
 * Defines where to find original/largest images and how to identify them
 */
const SOURCE_LOCATIONS = {
  nodes: {
    source: 'sprites/nodes',
    pattern: /^node_(.+)\.png$/,
    largest: 96,
    outputPattern: (id, size) => ({
      dir: path.join(ASSETS_ROOT, 'sprites/nodes', `${size}x${size}`),
      filename: `node_${id}.png`
    })
  },
  portraits: {
    source: 'sprites/portraits',
    pattern: /^(.+)\.png$/,
    largest: 256,
    outputPattern: (id, size) => ({
      dir: path.join(ASSETS_ROOT, 'sprites/portraits', `${size}x${size}`),
      filename: `${id}.png`
    })
  },
  items: {
    source: 'sprites/items',
    // Items use suffix pattern: item_64.png -> item_48.png, item_32.png
    // Largest available is 64
    pattern: /^(.+)_64\.png$/,
    largest: 64,
    sizes: [32, 48],
    hasSubcategories: true,
    outputPattern: (id, size, subcategory) => ({
      dir: path.join(ASSETS_ROOT, 'sprites/items', subcategory),
      filename: `${id}_${size}.png`
    })
  },
  icons: {
    // Icons are in size subdirectories: icons/png/48/{category}-{name}.png
    // Largest available is 64, but we use 48 as source for smaller sizes
    source: 'icons/png/48',
    pattern: /^(.+)\.png$/,
    largest: 48,
    // Override size presets for icons since actual largest is 48
    sizes: [16, 24, 32],
    outputPattern: (id, size) => ({
      dir: path.join(ASSETS_ROOT, 'icons/png', String(size)),
      filename: `${id}.png`
    })
  }
};

/**
 * Find source files in a directory matching the category pattern
 * @param {string} sourceDir - Directory to search
 * @param {Object} config - Category configuration
 * @param {Object} options - Search options
 * @returns {Array<{sourcePath: string, id: string, subcategory?: string}>}
 */
function findSourceFiles(sourceDir, config, options = {}) {
  const files = [];
  const { subcategory: filterSubcategory } = options;

  if (!fs.existsSync(sourceDir)) {
    log(`Source directory not found: ${sourceDir}`, 'warn');
    return files;
  }

  /**
   * Recursively find files matching the pattern
   */
  function scanDirectory(dir, currentSubcategory = null) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip size subdirectories (16x16, 32x32, etc.)
        if (/^\d+x\d+$/.test(entry.name)) continue;
        // Skip hidden directories
        if (entry.name.startsWith('.')) continue;

        // For items with subcategories, track the subcategory name
        if (config.hasSubcategories) {
          // If filtering by subcategory, only scan matching subdirectories
          if (filterSubcategory && entry.name !== filterSubcategory) continue;
          scanDirectory(fullPath, entry.name);
        } else {
          scanDirectory(fullPath, currentSubcategory);
        }
      } else if (entry.isFile() && entry.name.endsWith('.png')) {
        const match = entry.name.match(config.pattern);
        if (match) {
          files.push({
            sourcePath: fullPath,
            id: match[1],
            subcategory: currentSubcategory
          });
        }
      }
    }
  }

  scanDirectory(sourceDir);
  return files;
}

/**
 * Get the target output path for a sized variant
 * @param {string} category - Asset category
 * @param {string} id - Asset identifier
 * @param {number} size - Target size
 * @param {string|null} subcategory - Subcategory for items
 * @returns {string} Full path to the output file
 */
function getTargetPath(category, id, size, subcategory) {
  const config = SOURCE_LOCATIONS[category];
  if (!config || !config.outputPattern) {
    throw new Error(`No output pattern defined for category: ${category}`);
  }

  const { dir, filename } = config.outputPattern(id, size, subcategory);
  return path.join(dir, filename);
}

/**
 * Migrate a single category, generating missing size variants
 * @param {string} category - Category name (nodes, icons, items, portraits)
 * @param {Object} options - Migration options
 * @returns {Promise<{processed: number, generated: number, skipped: number, failed: number}>}
 */
async function migrateCategory(category, options = {}) {
  const { size, dryRun = false, verbose = false, subcategory } = options;
  const config = SOURCE_LOCATIONS[category];

  if (!config) {
    log(`Unknown category: ${category}`, 'error');
    return { processed: 0, generated: 0, skipped: 0, failed: 0 };
  }

  const sourceDir = path.join(ASSETS_ROOT, config.source);

  // Determine which sizes to generate
  // Use category-specific sizes if defined, otherwise fall back to SIZE_PRESETS
  const allTargetSizes = config.sizes || SIZE_PRESETS[category] || [];
  const sizesToGenerate = size
    ? [size]
    : allTargetSizes.filter(s => s !== config.largest);

  if (sizesToGenerate.length === 0) {
    log(`No sizes to generate for ${category}`, 'info');
    return { processed: 0, generated: 0, skipped: 0, failed: 0 };
  }

  const results = { processed: 0, generated: 0, skipped: 0, failed: 0 };

  // Find source files
  const files = findSourceFiles(sourceDir, config, { subcategory });

  if (!options.quiet) {
    log(`Found ${files.length} source files in ${category}`, 'info');
    log(`Target sizes: ${sizesToGenerate.join(', ')}`, 'info');
  }

  for (const { sourcePath, id, subcategory: fileSubcategory } of files) {
    results.processed++;

    for (const targetSize of sizesToGenerate) {
      const targetPath = getTargetPath(category, id, targetSize, fileSubcategory);
      const relativePath = path.relative(ASSETS_ROOT, targetPath);

      if (fileExists(targetPath)) {
        results.skipped++;
        if (verbose) {
          log(`  Skip (exists): ${relativePath}`, 'info');
        }
        continue;
      }

      if (dryRun) {
        console.log(`  [DRY RUN] Would generate: ${relativePath}`);
        results.generated++;
        continue;
      }

      ensureDirectoryExists(path.dirname(targetPath));
      const result = await resizeImage(sourcePath, targetPath, targetSize);

      if (result.success) {
        results.generated++;
        if (verbose) {
          log(`  Generated: ${relativePath}`, 'success');
        }
      } else {
        results.failed++;
        log(`  Failed: ${targetPath} - ${result.error}`, 'error');
      }
    }
  }

  return results;
}

/**
 * Migrate all categories
 * @param {Object} options - Migration options
 * @returns {Promise<{processed: number, generated: number, skipped: number, failed: number}>}
 */
async function migrateAll(options = {}) {
  const totals = { processed: 0, generated: 0, skipped: 0, failed: 0 };
  const categories = Object.keys(SOURCE_LOCATIONS);

  for (const category of categories) {
    if (!options.quiet) {
      console.log('');
      log(`=== Migrating ${category} ===`, 'info');
    }

    const result = await migrateCategory(category, options);
    totals.processed += result.processed;
    totals.generated += result.generated;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
  }

  return totals;
}

/**
 * Display help with examples
 */
function showHelp() {
  console.log(`
Asset Size Migration Script
Generate missing size variants for existing assets

Categories and their size presets:
  nodes:     ${SIZE_PRESETS.nodes?.join(', ') || 'N/A'} (source: 96x96)
  portraits: ${SIZE_PRESETS.portraits?.join(', ') || 'N/A'} (source: 256x256)
  items:     32, 48 (source: 64x64)
  icons:     16, 24, 32 (source: 48x48)

Output paths:
  nodes:     /assets/sprites/nodes/{size}x{size}/node_{id}.png
  portraits: /assets/sprites/portraits/{size}x{size}/{id}.png
  items:     /assets/sprites/items/{subcategory}/{id}_{size}.png
  icons:     /assets/icons/png/{size}/{id}.png

Examples:
  # Preview what would be generated for nodes
  node scripts/ai-images/migrate-sizes.js --category nodes --dry-run

  # Generate all missing icon sizes
  node scripts/ai-images/migrate-sizes.js --category icons

  # Generate only 64px variants for items
  node scripts/ai-images/migrate-sizes.js --category items --size 64

  # Generate only weapons subcategory for items
  node scripts/ai-images/migrate-sizes.js --category items --subcategory weapons

  # Migrate all categories with verbose output
  node scripts/ai-images/migrate-sizes.js --all --verbose

  # Preview everything
  node scripts/ai-images/migrate-sizes.js --all --dry-run
`);
}

// CLI setup
program
  .name('migrate-sizes')
  .description('Generate missing size variants for existing assets')
  .option('--category <cat>', 'Category to migrate (nodes, icons, items, portraits)')
  .option('--size <size>', 'Specific size to generate', parseInt)
  .option('--subcategory <subcat>', 'Subcategory filter (for items: weapons, armor, etc.)')
  .option('--all', 'Migrate all categories')
  .option('--dry-run', 'Show what would be done without doing it')
  .option('-v, --verbose', 'Verbose output')
  .option('-q, --quiet', 'Suppress all output except errors')
  .option('-h, --help', 'Show detailed help')
  .parse();

const opts = program.opts();

/**
 * Main execution
 */
async function main() {
  // Show help
  if (opts.help) {
    showHelp();
    process.exit(0);
  }

  // Validate options
  if (!opts.category && !opts.all) {
    log('Please specify --category <name> or --all', 'error');
    console.log('Use --help for usage examples');
    process.exit(1);
  }

  if (opts.category && opts.all) {
    log('Cannot use both --category and --all', 'error');
    process.exit(1);
  }

  if (opts.category && !SOURCE_LOCATIONS[opts.category]) {
    log(`Unknown category: ${opts.category}`, 'error');
    log(`Valid categories: ${Object.keys(SOURCE_LOCATIONS).join(', ')}`, 'info');
    process.exit(1);
  }

  if (opts.subcategory && opts.category !== 'items') {
    log('--subcategory is only valid for --category items', 'warn');
  }

  // Check ImageMagick
  if (!opts.dryRun && !checkImageMagick()) {
    log('ImageMagick not found. Please install it:', 'error');
    log('  Ubuntu/Debian: sudo apt install imagemagick', 'info');
    log('  macOS: brew install imagemagick', 'info');
    process.exit(1);
  }

  // Display header
  if (!opts.quiet) {
    log('Asset Size Migration Script', 'info');
    log('===========================', 'info');
    if (opts.dryRun) {
      log('[DRY RUN MODE]', 'warn');
    }
  }

  // Run migration
  let results;
  if (opts.all) {
    results = await migrateAll({
      dryRun: opts.dryRun,
      verbose: opts.verbose,
      quiet: opts.quiet
    });
  } else {
    results = await migrateCategory(opts.category, {
      size: opts.size,
      dryRun: opts.dryRun,
      verbose: opts.verbose,
      quiet: opts.quiet,
      subcategory: opts.subcategory
    });
  }

  // Summary
  if (!opts.quiet) {
    console.log('\n========================================');
    log('Migration Summary', 'info');
    console.log('========================================');
    console.log(`  Source files:  ${results.processed}`);
    console.log(`  Generated:     ${results.generated}`);
    console.log(`  Skipped:       ${results.skipped}`);
    console.log(`  Failed:        ${results.failed}`);
    console.log('');
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(error => {
  log(`Unexpected error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
