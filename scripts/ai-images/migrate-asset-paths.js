#!/usr/bin/env node
/**
 * ONE-TIME MIGRATION SCRIPT
 *
 * This script migrates legacy assets from old path structures to the canonical
 * paths defined in shared/assetPaths.js. It should only need to be run once
 * after the path standardization refactoring.
 *
 * All generation scripts now output directly to canonical paths, so this
 * migration is not needed for newly generated assets.
 *
 * Run: npm run ai:migrate-paths
 *
 * ---------------------------------------------------------------------------
 *
 * Migration script for asset paths
 * Moves assets from legacy sprite locations to canonical paths per assetPaths.js
 *
 * Legacy locations:
 * - /assets/sprites/portraits/*.png -> portraits
 * - /assets/sprites/enemies/portraits/*.png -> portraits (enemy_* prefix)
 * - /assets/sprites/items/{subcategory}/*.png -> items
 * - /assets/sprites/nodes/*.png -> nodes
 *
 * Canonical paths (from shared/assetPaths.js):
 * - Portraits: /assets/portraits/{size}/{id}.png (sizes: 64, 128, 256)
 * - Items: /assets/items/{size}/{subcategory}/{id}.png (sizes: 32, 64, 128)
 * - Nodes: /assets/nodes/{size}/{id}.png (sizes: 48, 96)
 *
 * Usage:
 *   node scripts/ai-images/migrate-asset-paths.js [options]
 *
 * Options:
 *   --category <cat>   Migrate only this category (portraits, items, nodes)
 *   --dry-run          Show what would be done without making changes
 *   --verbose          Show detailed progress
 *   --cleanup          Remove legacy files after successful migration
 *   --force            Overwrite existing destination files
 */

const fs = require('fs');
const path = require('path');
const { log, ensureDirectoryExists, fileExists, getProjectRoot } = require('./lib/imageUtils');
const {
  getSizePresets,
  resizeImage,
  getImageDimensions
} = require('./lib/resizeUtils');

// Project paths
const PROJECT_ROOT = getProjectRoot();
const ASSETS_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets');
const SPRITES_DIR = path.join(ASSETS_DIR, 'sprites');
// External image-generator project where 1024x1024 originals are saved by Python
const IMAGE_GENERATOR_ORIGINALS = path.join(PROJECT_ROOT, '..', 'image-generator', 'outputs', 'originals');

/**
 * Build legacy path mappings with SIZE_PRESETS (async)
 * @returns {Promise<Object>} LEGACY_MAPPINGS object
 */
async function buildLegacyMappings() {
  const SIZE_PRESETS = await getSizePresets();
  return {
    portraits: {
      // Player portraits
      legacy: path.join(SPRITES_DIR, 'portraits'),
      // Enemy portraits (alternative location)
      legacyEnemy: path.join(SPRITES_DIR, 'enemies/portraits'),
      canonical: path.join(ASSETS_DIR, 'portraits'),
      originals: path.join(ASSETS_DIR, 'portraits/originals'),
      // External originals from image-generator project (1024x1024)
      externalOriginals: path.join(IMAGE_GENERATOR_ORIGINALS, 'portraits'),
      sizes: SIZE_PRESETS.portraits // [64, 128, 256]
    },
    items: {
      legacy: path.join(SPRITES_DIR, 'items'),
      canonical: path.join(ASSETS_DIR, 'items'),
      originals: path.join(ASSETS_DIR, 'items/originals'),
      sizes: SIZE_PRESETS.items, // [32, 64, 128]
      hasSubcategories: true
    },
    nodes: {
      legacy: path.join(SPRITES_DIR, 'nodes'),
      canonical: path.join(ASSETS_DIR, 'nodes'),
      originals: path.join(ASSETS_DIR, 'nodes/originals'),
      sizes: SIZE_PRESETS.nodes // [48, 96]
    }
  };
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    category: null,
    dryRun: false,
    verbose: false,
    cleanup: false,
    force: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--category':
        options.category = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--cleanup':
        options.cleanup = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
Asset Path Migration Script

Moves assets from legacy sprite locations to canonical paths.

Usage:
  node scripts/ai-images/migrate-asset-paths.js [options]

Options:
  --category <cat>   Migrate only this category (portraits, items, nodes)
  --dry-run          Show what would be done without making changes
  --verbose          Show detailed progress
  --cleanup          Remove legacy files after successful migration
  --force            Overwrite existing destination files
  --help, -h         Show this help message

Examples:
  # Preview all migrations
  node scripts/ai-images/migrate-asset-paths.js --dry-run

  # Migrate portraits only with verbose output
  node scripts/ai-images/migrate-asset-paths.js --category portraits --verbose

  # Migrate everything and remove legacy files
  node scripts/ai-images/migrate-asset-paths.js --cleanup

Canonical Path Structure:
  Portraits: /assets/portraits/{size}/{id}.png (sizes: 64, 128, 256)
  Items:     /assets/items/{size}/{subcategory}/{id}.png (sizes: 32, 64, 128)
  Nodes:     /assets/nodes/{size}/{id}.png (sizes: 48, 96)
`);
}

/**
 * Find all PNG files in a directory
 * @param {string} dir - Directory to search
 * @param {boolean} recursive - Search subdirectories
 * @returns {string[]} Array of file paths
 */
function findPngFiles(dir, recursive = false) {
  const files = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory() && recursive) {
      // Skip size directories (32, 64, 128, etc.)
      if (/^\d+$/.test(entry.name)) continue;
      // Skip originals directory
      if (entry.name === 'originals') continue;

      files.push(...findPngFiles(fullPath, true));
    } else if (entry.isFile() && entry.name.endsWith('.png')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Extract asset ID from filename
 * Removes size suffixes like _32, _64, etc.
 * @param {string} filename - The filename
 * @returns {string} The asset ID
 */
function extractAssetId(filename) {
  const base = path.basename(filename, '.png');
  // Remove size suffixes like _32, _48, _64, _128, _256
  return base.replace(/_(\d+)$/, '');
}

/**
 * Check if file is a size variant (has size suffix)
 * @param {string} filename - The filename
 * @returns {boolean} True if it's a size variant
 */
function isSizeVariant(filename) {
  const base = path.basename(filename, '.png');
  return /_(\d+)$/.test(base);
}

/**
 * Get subcategory from legacy item path
 * @param {string} filePath - Full file path
 * @param {string} legacyBase - Legacy base directory
 * @returns {string} Subcategory name
 */
function getSubcategory(filePath, legacyBase) {
  const relativePath = path.relative(legacyBase, filePath);
  const parts = relativePath.split(path.sep);
  // First part is the subcategory (e.g., 'weapons')
  return parts.length > 1 ? parts[0] : 'misc';
}

/**
 * Migrate a single asset file
 * @param {string} sourcePath - Source file path
 * @param {Object} mapping - Category mapping configuration
 * @param {Object} options - Migration options
 * @param {string} [subcategory] - Subcategory for items
 * @returns {Object} Migration result
 */
async function migrateAsset(sourcePath, mapping, options, subcategory = null) {
  const assetId = extractAssetId(path.basename(sourcePath));
  const result = {
    source: sourcePath,
    assetId,
    subcategory,
    copied: false,
    variants: [],
    skipped: [],
    errors: []
  };

  // Determine originals path
  let originalsPath;
  if (subcategory) {
    originalsPath = path.join(mapping.originals, subcategory, `${assetId}.png`);
  } else {
    originalsPath = path.join(mapping.originals, `${assetId}.png`);
  }

  // Step 1: Copy to originals if not already there
  if (!fileExists(originalsPath) || options.force) {
    if (options.dryRun) {
      log(`[DRY-RUN] Would copy to originals: ${originalsPath}`, 'info');
      result.copied = true;
    } else {
      try {
        ensureDirectoryExists(path.dirname(originalsPath));
        fs.copyFileSync(sourcePath, originalsPath);
        result.copied = true;
        if (options.verbose) {
          log(`Copied to originals: ${originalsPath}`, 'success');
        }
      } catch (err) {
        result.errors.push(`Failed to copy to originals: ${err.message}`);
        log(`Failed to copy ${sourcePath}: ${err.message}`, 'error');
        return result;
      }
    }
  } else {
    result.skipped.push(`Originals exists: ${originalsPath}`);
    if (options.verbose) {
      log(`Skipped originals (exists): ${originalsPath}`, 'info');
    }
  }

  // Step 2: Generate size variants
  // Try to use the highest quality source available:
  // 1. External originals from image-generator (1024x1024)
  // 2. Modia originals directory
  // 3. Legacy source file
  let sourceForResize = sourcePath;

  // Check for external 1024x1024 originals from image-generator project
  if (mapping.externalOriginals) {
    const externalOriginalPath = path.join(mapping.externalOriginals, `${assetId}.png`);
    if (fileExists(externalOriginalPath)) {
      sourceForResize = externalOriginalPath;
      if (options.verbose) {
        log(`Using external 1024x1024 original: ${externalOriginalPath}`, 'info');
      }
      // Also copy this to Modia's originals if we haven't already
      if (!fileExists(originalsPath) || options.force) {
        if (!options.dryRun) {
          try {
            ensureDirectoryExists(path.dirname(originalsPath));
            fs.copyFileSync(externalOriginalPath, originalsPath);
            result.copied = true;
            if (options.verbose) {
              log(`Copied external original to: ${originalsPath}`, 'success');
            }
          } catch (err) {
            log(`Warning: Could not copy external original: ${err.message}`, 'warn');
          }
        }
      }
    }
  }

  // Fall back to Modia originals if no external found
  if (sourceForResize === sourcePath && fileExists(originalsPath)) {
    sourceForResize = originalsPath;
  }

  // Get source dimensions to validate we can generate the sizes
  const dimensions = await getImageDimensions(sourceForResize);
  if (!dimensions && !options.dryRun) {
    result.errors.push(`Could not determine source image dimensions: ${sourceForResize}`);
    log(`Could not determine dimensions for ${sourceForResize}`, 'error');
    return result;
  }

  const sourceSize = dimensions ? Math.min(dimensions.width, dimensions.height) : 256;

  for (const size of mapping.sizes) {
    // Skip sizes larger than source
    if (size > sourceSize && !options.dryRun) {
      result.skipped.push(`Size ${size} > source ${sourceSize}`);
      if (options.verbose) {
        log(`Skipped size ${size} (larger than source ${sourceSize})`, 'info');
      }
      continue;
    }

    // Determine output path for this size
    let outputPath;
    if (subcategory) {
      outputPath = path.join(mapping.canonical, String(size), subcategory, `${assetId}.png`);
    } else {
      outputPath = path.join(mapping.canonical, String(size), `${assetId}.png`);
    }

    // Check if already exists
    if (fileExists(outputPath) && !options.force) {
      result.skipped.push(`Variant exists: ${outputPath}`);
      if (options.verbose) {
        log(`Skipped variant (exists): ${outputPath}`, 'info');
      }
      continue;
    }

    if (options.dryRun) {
      log(`[DRY-RUN] Would generate ${size}px variant: ${outputPath}`, 'info');
      result.variants.push(outputPath);
    } else {
      try {
        ensureDirectoryExists(path.dirname(outputPath));
        const resizeResult = await resizeImage(sourceForResize, outputPath, size);

        if (resizeResult.success) {
          result.variants.push(outputPath);
          if (options.verbose) {
            log(`Generated ${size}px variant: ${outputPath}`, 'success');
          }
        } else {
          result.errors.push(`Failed ${size}px: ${resizeResult.error}`);
          log(`Failed to generate ${size}px variant: ${resizeResult.error}`, 'error');
        }
      } catch (err) {
        result.errors.push(`Failed ${size}px: ${err.message}`);
        log(`Failed to generate ${size}px variant: ${err.message}`, 'error');
      }
    }
  }

  return result;
}

/**
 * Migrate all portraits from legacy locations
 * @param {Object} options - Migration options
 * @param {Object} LEGACY_MAPPINGS - Legacy path mappings
 * @returns {Object} Migration summary
 */
async function migratePortraits(options, LEGACY_MAPPINGS) {
  const mapping = LEGACY_MAPPINGS.portraits;
  const results = {
    category: 'portraits',
    total: 0,
    migrated: 0,
    skipped: 0,
    errors: 0,
    details: []
  };

  log('=== Migrating Portraits ===', 'info');

  // Find portraits in legacy location
  const files = findPngFiles(mapping.legacy, false);

  // Also check for enemy portraits
  const enemyFiles = findPngFiles(mapping.legacyEnemy, false);

  // Process regular portraits
  for (const file of files) {
    // Skip size variants, we want originals
    if (isSizeVariant(file)) {
      if (options.verbose) {
        log(`Skipping size variant: ${file}`, 'info');
      }
      continue;
    }

    results.total++;
    const result = await migrateAsset(file, mapping, options);
    results.details.push(result);

    if (result.errors.length > 0) {
      results.errors++;
    } else if (result.variants.length > 0 || result.copied) {
      results.migrated++;
    } else {
      results.skipped++;
    }

    // Cleanup if requested
    if (options.cleanup && !options.dryRun && result.errors.length === 0) {
      try {
        fs.unlinkSync(file);
        log(`Removed legacy file: ${file}`, 'info');
      } catch (err) {
        log(`Failed to remove legacy file: ${err.message}`, 'error');
      }
    }
  }

  // Process enemy portraits (add enemy_ prefix if not present)
  for (const file of enemyFiles) {
    if (isSizeVariant(file)) continue;

    results.total++;
    let assetId = extractAssetId(path.basename(file));

    // Add enemy_ prefix if not present
    if (!assetId.startsWith('enemy_')) {
      assetId = `enemy_${assetId}`;
    }

    // Create a modified mapping with the new asset ID
    const result = await migrateAsset(file, mapping, options);
    result.assetId = assetId; // Override with prefixed ID

    results.details.push(result);

    if (result.errors.length > 0) {
      results.errors++;
    } else if (result.variants.length > 0 || result.copied) {
      results.migrated++;
    } else {
      results.skipped++;
    }

    if (options.cleanup && !options.dryRun && result.errors.length === 0) {
      try {
        fs.unlinkSync(file);
        log(`Removed legacy file: ${file}`, 'info');
      } catch (err) {
        log(`Failed to remove legacy file: ${err.message}`, 'error');
      }
    }
  }

  // Also scan external originals directory for portraits that don't have size variants yet
  if (mapping.externalOriginals && fs.existsSync(mapping.externalOriginals)) {
    const externalFiles = findPngFiles(mapping.externalOriginals, false);
    if (options.verbose && externalFiles.length > 0) {
      log(`Found ${externalFiles.length} files in external originals directory`, 'info');
    }

    for (const file of externalFiles) {
      const assetId = extractAssetId(path.basename(file));

      // Skip if all size variants already exist
      const allVariantsExist = mapping.sizes.every(size => {
        const variantPath = path.join(mapping.canonical, String(size), `${assetId}.png`);
        return fileExists(variantPath);
      });

      if (allVariantsExist && !options.force) {
        if (options.verbose) {
          log(`All variants exist for external original: ${assetId}`, 'info');
        }
        continue;
      }

      results.total++;

      // Create a minimal result object and generate variants from external original
      const result = {
        source: file,
        assetId,
        subcategory: null,
        copied: false,
        variants: [],
        skipped: [],
        errors: []
      };

      // Copy to Modia originals if not already there
      const originalsPath = path.join(mapping.originals, `${assetId}.png`);
      if (!fileExists(originalsPath) || options.force) {
        if (options.dryRun) {
          log(`[DRY-RUN] Would copy external original to: ${originalsPath}`, 'info');
          result.copied = true;
        } else {
          try {
            ensureDirectoryExists(path.dirname(originalsPath));
            fs.copyFileSync(file, originalsPath);
            result.copied = true;
            if (options.verbose) {
              log(`Copied external original to: ${originalsPath}`, 'success');
            }
          } catch (err) {
            result.errors.push(`Failed to copy external original: ${err.message}`);
            log(`Failed to copy ${file}: ${err.message}`, 'error');
          }
        }
      }

      // Generate size variants from external original
      const dimensions = await getImageDimensions(file);
      if (!dimensions && !options.dryRun) {
        result.errors.push(`Could not determine dimensions for external original: ${file}`);
        log(`Could not determine dimensions for ${file}`, 'error');
      } else {
        const sourceSize = dimensions ? Math.min(dimensions.width, dimensions.height) : 1024;

        for (const size of mapping.sizes) {
          if (size > sourceSize && !options.dryRun) {
            result.skipped.push(`Size ${size} > source ${sourceSize}`);
            continue;
          }

          const outputPath = path.join(mapping.canonical, String(size), `${assetId}.png`);

          if (fileExists(outputPath) && !options.force) {
            result.skipped.push(`Variant exists: ${outputPath}`);
            if (options.verbose) {
              log(`Skipped variant (exists): ${outputPath}`, 'info');
            }
            continue;
          }

          if (options.dryRun) {
            log(`[DRY-RUN] Would generate ${size}px variant from external: ${outputPath}`, 'info');
            result.variants.push(outputPath);
          } else {
            try {
              ensureDirectoryExists(path.dirname(outputPath));
              const resizeResult = await resizeImage(file, outputPath, size);

              if (resizeResult.success) {
                result.variants.push(outputPath);
                if (options.verbose) {
                  log(`Generated ${size}px variant from external: ${outputPath}`, 'success');
                }
              } else {
                result.errors.push(`Failed ${size}px: ${resizeResult.error}`);
                log(`Failed to generate ${size}px variant: ${resizeResult.error}`, 'error');
              }
            } catch (err) {
              result.errors.push(`Failed ${size}px: ${err.message}`);
              log(`Failed to generate ${size}px variant: ${err.message}`, 'error');
            }
          }
        }
      }

      results.details.push(result);

      if (result.errors.length > 0) {
        results.errors++;
      } else if (result.variants.length > 0 || result.copied) {
        results.migrated++;
      } else {
        results.skipped++;
      }
    }
  }

  return results;
}

/**
 * Migrate all items from legacy locations
 * @param {Object} options - Migration options
 * @param {Object} LEGACY_MAPPINGS - Legacy path mappings
 * @returns {Object} Migration summary
 */
async function migrateItems(options, LEGACY_MAPPINGS) {
  const mapping = LEGACY_MAPPINGS.items;
  const results = {
    category: 'items',
    total: 0,
    migrated: 0,
    skipped: 0,
    errors: 0,
    details: []
  };

  log('=== Migrating Items ===', 'info');

  // Find all items (recursive, organized by subcategory)
  const files = findPngFiles(mapping.legacy, true);

  for (const file of files) {
    // Skip size variants
    if (isSizeVariant(file)) {
      if (options.verbose) {
        log(`Skipping size variant: ${file}`, 'info');
      }
      continue;
    }

    // Get subcategory from path
    const subcategory = getSubcategory(file, mapping.legacy);

    results.total++;
    const result = await migrateAsset(file, mapping, options, subcategory);
    results.details.push(result);

    if (result.errors.length > 0) {
      results.errors++;
    } else if (result.variants.length > 0 || result.copied) {
      results.migrated++;
    } else {
      results.skipped++;
    }

    if (options.cleanup && !options.dryRun && result.errors.length === 0) {
      try {
        fs.unlinkSync(file);
        log(`Removed legacy file: ${file}`, 'info');
      } catch (err) {
        log(`Failed to remove legacy file: ${err.message}`, 'error');
      }
    }
  }

  return results;
}

/**
 * Migrate all nodes from legacy locations
 * @param {Object} options - Migration options
 * @param {Object} LEGACY_MAPPINGS - Legacy path mappings
 * @returns {Object} Migration summary
 */
async function migrateNodes(options, LEGACY_MAPPINGS) {
  const mapping = LEGACY_MAPPINGS.nodes;
  const results = {
    category: 'nodes',
    total: 0,
    migrated: 0,
    skipped: 0,
    errors: 0,
    details: []
  };

  log('=== Migrating Nodes ===', 'info');

  // Find all node icons
  const files = findPngFiles(mapping.legacy, false);

  for (const file of files) {
    if (isSizeVariant(file)) {
      if (options.verbose) {
        log(`Skipping size variant: ${file}`, 'info');
      }
      continue;
    }

    results.total++;
    const result = await migrateAsset(file, mapping, options);
    results.details.push(result);

    if (result.errors.length > 0) {
      results.errors++;
    } else if (result.variants.length > 0 || result.copied) {
      results.migrated++;
    } else {
      results.skipped++;
    }

    if (options.cleanup && !options.dryRun && result.errors.length === 0) {
      try {
        fs.unlinkSync(file);
        log(`Removed legacy file: ${file}`, 'info');
      } catch (err) {
        log(`Failed to remove legacy file: ${err.message}`, 'error');
      }
    }
  }

  return results;
}

/**
 * Print migration summary
 * @param {Object[]} allResults - Array of category results
 * @param {Object} options - Migration options
 */
function printSummary(allResults, options) {
  console.log('\n' + '='.repeat(60));
  console.log(options.dryRun ? 'MIGRATION PREVIEW (DRY RUN)' : 'MIGRATION SUMMARY');
  console.log('='.repeat(60));

  let totalFiles = 0;
  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const result of allResults) {
    console.log(`\n${result.category.toUpperCase()}:`);
    console.log(`  Total files found: ${result.total}`);
    console.log(`  Migrated: ${result.migrated}`);
    console.log(`  Skipped (already exists): ${result.skipped}`);
    console.log(`  Errors: ${result.errors}`);

    totalFiles += result.total;
    totalMigrated += result.migrated;
    totalSkipped += result.skipped;
    totalErrors += result.errors;
  }

  console.log('\n' + '-'.repeat(60));
  console.log('TOTALS:');
  console.log(`  Total files: ${totalFiles}`);
  console.log(`  Migrated: ${totalMigrated}`);
  console.log(`  Skipped: ${totalSkipped}`);
  console.log(`  Errors: ${totalErrors}`);
  console.log('='.repeat(60));

  if (options.dryRun) {
    console.log('\nThis was a dry run. No files were modified.');
    console.log('Run without --dry-run to perform the actual migration.');
  }

  if (options.cleanup && !options.dryRun) {
    console.log('\nLegacy files have been removed (--cleanup was specified).');
  }
}

/**
 * Main entry point
 */
async function main() {
  const options = parseArgs();

  console.log('Asset Path Migration Script');
  console.log('===========================');

  if (options.dryRun) {
    log('DRY RUN MODE - No files will be modified', 'info');
  }

  if (options.cleanup) {
    log('CLEANUP MODE - Legacy files will be removed after migration', 'info');
  }

  // Build LEGACY_MAPPINGS with SIZE_PRESETS (async)
  const LEGACY_MAPPINGS = await buildLegacyMappings();

  const categoriesToMigrate = options.category
    ? [options.category]
    : ['portraits', 'items', 'nodes'];

  const allResults = [];

  for (const category of categoriesToMigrate) {
    let result;

    switch (category) {
      case 'portraits':
        result = await migratePortraits(options, LEGACY_MAPPINGS);
        break;
      case 'items':
        result = await migrateItems(options, LEGACY_MAPPINGS);
        break;
      case 'nodes':
        result = await migrateNodes(options, LEGACY_MAPPINGS);
        break;
      default:
        log(`Unknown category: ${category}`, 'error');
        continue;
    }

    allResults.push(result);
  }

  printSummary(allResults, options);

  // Exit with error code if there were errors
  const hasErrors = allResults.some(r => r.errors > 0);
  process.exit(hasErrors ? 1 : 0);
}

// Run the script
main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
