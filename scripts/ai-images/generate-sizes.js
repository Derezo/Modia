#!/usr/bin/env node
/**
 * Size Variant Generation Script
 * Generate multiple size variants from 128x128 source images
 *
 * Usage:
 *   node scripts/ai-images/generate-sizes.js                     # All categories
 *   node scripts/ai-images/generate-sizes.js --category items    # Items only
 *   node scripts/ai-images/generate-sizes.js --category overlays # Overlays only
 *   node scripts/ai-images/generate-sizes.js --file path/to.png  # Single file
 *   node scripts/ai-images/generate-sizes.js --sizes 32,48,64    # Custom sizes
 *   node scripts/ai-images/generate-sizes.js --force             # Overwrite existing
 *
 * Generates size variants: 16x16, 24x24, 32x32, 48x48, 64x64 (from 128x128 source)
 */

const path = require('path');
const {
  log,
  getProjectRoot,
  checkImageMagick,
  generateSizeVariants,
  generateSizeVariantsForDirectory,
  SIZE_PRESETS,
  STANDARD_SIZES
} = require('./lib');

// Configuration
const PROJECT_ROOT = getProjectRoot();
const SPRITES_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/sprites');

// Category directories mapping
const CATEGORY_DIRS = {
  items: path.join(SPRITES_DIR, 'items'),
  icons: path.join(SPRITES_DIR, 'icons'),
  overlays: path.join(SPRITES_DIR, 'overlays'),
  nodes: path.join(SPRITES_DIR, 'nodes'),
  portraits: path.join(SPRITES_DIR, 'portraits')
};

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    category: null,
    file: null,
    sizes: null,
    force: false,
    recursive: true,
    verbose: false,
    quiet: false,
    dryRun: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--category':
      case '-c':
        options.category = args[++i];
        break;
      case '--file':
      case '-f':
        options.file = args[++i];
        break;
      case '--sizes':
      case '-s':
        options.sizes = args[++i].split(',').map(s => parseInt(s.trim(), 10));
        break;
      case '--force':
        options.force = true;
        break;
      case '--no-recursive':
        options.recursive = false;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--quiet':
      case '-q':
        options.quiet = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (arg.startsWith('--')) {
          log(`Unknown option: ${arg}`, 'warn');
        }
    }
  }

  return options;
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
Size Variant Generation Script
Generate multiple size variants from 128x128 source images using ImageMagick

Usage:
  node scripts/ai-images/generate-sizes.js [options]

Options:
  --category, -c <cat>  Process specific category (items, icons, overlays, nodes, portraits)
  --file, -f <path>     Process a single file
  --sizes, -s <list>    Custom sizes (comma-separated, e.g., "32,48,64")
  --force               Overwrite existing size variants
  --no-recursive        Don't process subdirectories
  --verbose, -v         Show detailed output
  --quiet, -q           Suppress output except errors
  --dry-run             Show what would be generated without doing it
  --help, -h            Show this help message

Size Presets by Category:
  items:     ${SIZE_PRESETS.items.join(', ')} (inventory, tooltips, details)
  icons:     ${SIZE_PRESETS.icons.join(', ')} (UI at various densities)
  overlays:  ${SIZE_PRESETS.overlays.join(', ')} (match item sizes)
  nodes:     ${SIZE_PRESETS.nodes.join(', ')} (world map)
  portraits: ${SIZE_PRESETS.portraits.join(', ')} (character portraits)

Standard sizes: ${STANDARD_SIZES.join(', ')}

Examples:
  node scripts/ai-images/generate-sizes.js                      # All categories
  node scripts/ai-images/generate-sizes.js --category items     # Items only
  node scripts/ai-images/generate-sizes.js --file items/weapons/sword_long.png
  node scripts/ai-images/generate-sizes.js --sizes 32,64 --force
  node scripts/ai-images/generate-sizes.js --dry-run --verbose

Output Structure:
  Source:  items/weapons/sword_long.png (128x128)
  Variants:
    items/weapons/32x32/sword_long.png
    items/weapons/48x48/sword_long.png
    items/weapons/64x64/sword_long.png
`);
}

/**
 * Process a single file
 */
async function processSingleFile(filePath, options) {
  const { sizes, force, verbose, dryRun } = options;

  // Determine category from path for preset
  let preset = null;
  for (const [cat, dir] of Object.entries(CATEGORY_DIRS)) {
    if (filePath.includes(dir) || filePath.includes(`/${cat}/`)) {
      preset = cat;
      break;
    }
  }

  const targetSizes = sizes || (preset ? SIZE_PRESETS[preset] : STANDARD_SIZES);

  if (dryRun) {
    log(`Would generate sizes for: ${filePath}`, 'info');
    log(`  Sizes: ${targetSizes.filter(s => s !== 128).join(', ')}`, 'info');
    log(`  Preset: ${preset || 'standard'}`, 'info');
    return { generated: 0, skipped: 0, failed: 0 };
  }

  const result = await generateSizeVariants(filePath, {
    sizes: targetSizes,
    force,
    verbose
  });

  return {
    generated: result.generated.length,
    skipped: result.skipped.length,
    failed: result.failed.length
  };
}

/**
 * Process a category directory
 */
async function processCategory(category, options) {
  const { sizes, force, recursive, verbose, dryRun, quiet } = options;

  const categoryDir = CATEGORY_DIRS[category];
  if (!categoryDir) {
    log(`Unknown category: ${category}`, 'error');
    return null;
  }

  if (!quiet) {
    log(`Processing category: ${category}`, 'info');
    log(`  Directory: ${categoryDir}`, 'info');
    log(`  Sizes: ${(sizes || SIZE_PRESETS[category] || STANDARD_SIZES).filter(s => s !== 128).join(', ')}`, 'info');
  }

  if (dryRun) {
    // Count files that would be processed
    const fs = require('fs');
    let count = 0;

    function countFiles(dir) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (/^\d+x\d+$/.test(entry.name)) continue;
          if (recursive) countFiles(path.join(dir, entry.name));
        } else if (entry.isFile() && entry.name.endsWith('.png')) {
          count++;
        }
      }
    }

    countFiles(categoryDir);
    log(`Would process ${count} source images`, 'info');
    return { total: count, generated: 0, skipped: 0, failed: 0 };
  }

  return generateSizeVariantsForDirectory(categoryDir, {
    sizes,
    preset: category,
    recursive,
    force,
    verbose
  });
}

/**
 * Main execution
 */
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Check ImageMagick
  if (!checkImageMagick()) {
    log('ImageMagick not found. Please install it:', 'error');
    log('  Ubuntu/Debian: sudo apt install imagemagick', 'info');
    log('  macOS: brew install imagemagick', 'info');
    process.exit(1);
  }

  if (!options.quiet) {
    log('Size Variant Generation Script', 'info');
    log('================================', 'info');
    if (options.dryRun) {
      log('[DRY RUN MODE]', 'warn');
    }
  }

  const totals = {
    total: 0,
    generated: 0,
    skipped: 0,
    failed: 0
  };

  // Process single file
  if (options.file) {
    const filePath = path.isAbsolute(options.file)
      ? options.file
      : path.join(SPRITES_DIR, options.file);

    const result = await processSingleFile(filePath, options);
    totals.total = 1;
    totals.generated = result.generated;
    totals.skipped = result.skipped;
    totals.failed = result.failed;
  }
  // Process single category
  else if (options.category) {
    const result = await processCategory(options.category, options);
    if (result) {
      totals.total = result.total;
      totals.generated = result.generated;
      totals.skipped = result.skipped;
      totals.failed = result.failed;
    }
  }
  // Process all categories
  else {
    for (const category of Object.keys(CATEGORY_DIRS)) {
      if (!options.quiet) {
        console.log('');
      }
      const result = await processCategory(category, options);
      if (result) {
        totals.total += result.total;
        totals.generated += result.generated;
        totals.skipped += result.skipped;
        totals.failed += result.failed;
      }
    }
  }

  // Summary
  if (!options.quiet) {
    console.log('\n========================================');
    log('Generation Summary', 'info');
    console.log('========================================');
    console.log(`  Source images: ${totals.total}`);
    console.log(`  Generated:     ${totals.generated}`);
    console.log(`  Skipped:       ${totals.skipped}`);
    console.log(`  Failed:        ${totals.failed}`);
    console.log('');
  }

  process.exit(totals.failed > 0 ? 1 : 0);
}

main().catch(error => {
  log(`Unexpected error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
