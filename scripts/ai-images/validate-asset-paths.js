#!/usr/bin/env node
/**
 * Validate Asset Paths - Cross-reference metadata with filesystem
 *
 * Uses shared/assetPaths.js as the single source of truth to validate:
 * - Metadata entries have corresponding files on disk
 * - Files on disk have corresponding metadata entries (detect orphans)
 * - Paths follow canonical conventions
 *
 * Usage:
 *   node scripts/ai-images/validate-asset-paths.js
 *   node scripts/ai-images/validate-asset-paths.js --category portraits
 *   node scripts/ai-images/validate-asset-paths.js --verbose
 *   node scripts/ai-images/validate-asset-paths.js --json
 */

const path = require('path');
const fs = require('fs');
const { program } = require('commander');
const { fileExists, getProjectRoot } = require('./lib/imageUtils');
const { getAssetPathsModule, CATEGORY_BASE_DIRS } = require('./lib/assetPathsBridge');

const PROJECT_ROOT = getProjectRoot();
const METADATA_ROOT = path.join(PROJECT_ROOT, 'ai-image-metadata');
const ASSETS_ROOT = path.join(PROJECT_ROOT, 'frontend/public/assets');

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m'
};

/**
 * Category metadata configuration
 * Maps categories to their metadata file locations and asset key extractors
 */
const CATEGORY_METADATA = {
  portraits: {
    metadataFiles: ['portraits/combinations.json', 'portraits/enemies.json'],
    getAssets: (data) => {
      if (data.portraits) return data.portraits;
      if (data.enemies) return data.enemies;
      return [];
    },
    getAssetId: (asset) => asset.id,
    getSubcategory: () => null
  },
  nodes: {
    metadataFiles: ['nodes/locations.json'],
    getAssets: (data) => data.nodes || [],
    getAssetId: (asset) => asset.id,
    getSubcategory: () => null
  },
  items: {
    metadataFiles: ['items/weapons.json', 'items/armor.json', 'items/accessories.json', 'items/consumables.json'],
    getAssets: (data) => data.items || [],
    getAssetId: (asset) => asset.id,
    getSubcategory: (data) => data.category // 'weapons', 'armor', etc.
  },
  icons: {
    metadataFiles: ['icons/actions.json', 'icons/status.json', 'icons/menu.json', 'icons/augments.json', 'icons/zodiac.json', 'icons/resources.json'],
    getAssets: (data) => data.icons || [],
    getAssetId: (asset) => asset.id,
    getSubcategory: (data) => data.category // 'actions', 'status', etc.
  },
  overlays: {
    metadataFiles: ['overlays/rarity.json', 'overlays/augments.json'],
    getAssets: (data) => data.overlays || [],
    getAssetId: (asset) => asset.id,
    getSubcategory: (data) => data.category // 'rarity', 'augments'
  },
  tiles: {
    metadataFiles: [
      'tiles/floors/forest.json', 'tiles/floors/cave.json', 'tiles/floors/mountain.json',
      'tiles/floors/bridge.json', 'tiles/floors/castle.json',
      'tiles/walls/forest.json', 'tiles/walls/cave.json', 'tiles/walls/mountain.json',
      'tiles/walls/bridge.json', 'tiles/walls/castle.json',
      'tiles/slopes/forest.json', 'tiles/slopes/cave.json', 'tiles/slopes/mountain.json',
      'tiles/slopes/bridge.json', 'tiles/slopes/castle.json'
    ],
    getAssets: (data) => data.tiles || [],
    getAssetId: (asset) => asset.id,
    getSubcategory: (data) => data.biome // 'forest', 'cave', etc.
  },
  obstacles: {
    metadataFiles: ['obstacles/rocks.json', 'obstacles/trees.json'],
    getAssets: (data) => data.obstacles || [],
    getAssetId: (asset) => asset.id,
    getSubcategory: (data) => data.category // 'rocks', 'trees'
  },
  characters: {
    metadataFiles: [
      'characters/players.json',
      'characters/enemies/forest.json', 'characters/enemies/cave.json',
      'characters/enemies/mountain.json', 'characters/enemies/bridge.json',
      'characters/enemies/castle.json'
    ],
    getAssets: (data) => data.characters || data.players || data.enemies || [],
    getAssetId: (asset) => asset.id,
    getSubcategory: (data, filePath) => {
      // Determine type from file path
      if (filePath.includes('/enemies/')) {
        const biome = path.basename(filePath, '.json');
        return { type: 'enemy', biome };
      }
      return { type: 'player' };
    }
  }
};

/**
 * Load a metadata JSON file safely
 */
function loadMetadata(filePath) {
  const fullPath = path.join(METADATA_ROOT, filePath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (error) {
    console.error(`Error reading ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * Find all files in a directory matching extension
 */
function findFilesRecursively(dir, extensions = ['.png', '.webp']) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        // Skip certain directories
        if (entry.name === 'originals' || entry.name === 'node_modules') continue;
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * Get expected filesystem path for an asset using assetPaths module
 */
async function getExpectedPath(assetPaths, category, id, options = {}) {
  const { size, subcategory } = options;

  // Use the canonical path function
  const urlPath = assetPaths.getAssetPath(category, id, { size, subcategory });
  return path.join(PROJECT_ROOT, 'frontend/public', urlPath);
}

/**
 * Validate a single category
 */
async function validateCategory(category, options = {}) {
  const { verbose = false } = options;
  const assetPaths = await getAssetPathsModule();
  const config = CATEGORY_METADATA[category];

  if (!config) {
    return {
      category,
      error: `Unknown category: ${category}`,
      missing: [],
      orphaned: [],
      inconsistent: [],
      valid: 0
    };
  }

  const results = {
    category,
    missing: [],       // In metadata but not on disk
    orphaned: [],      // On disk but not in metadata
    inconsistent: [],  // Path doesn't match canonical convention
    valid: 0,
    totalMetadata: 0,
    totalFiles: 0
  };

  // Collect all assets from metadata
  const metadataAssets = new Map(); // id -> {asset, subcategory, source}

  for (const metaFile of config.metadataFiles) {
    const data = loadMetadata(metaFile);
    if (!data) continue;

    const assets = config.getAssets(data);
    const subcategory = config.getSubcategory(data, metaFile);

    for (const asset of assets) {
      const id = config.getAssetId(asset);
      if (!id) continue;

      // Only track generated assets
      if (asset.generated !== true) continue;

      metadataAssets.set(id, {
        asset,
        subcategory,
        source: metaFile
      });
    }
  }

  results.totalMetadata = metadataAssets.size;

  // Get SIZE_PRESETS from assetPaths
  const sizes = assetPaths.SIZE_PRESETS[category] || [64];
  const defaultSize = assetPaths.DEFAULT_SIZES[category] || sizes[0];

  // Check each metadata asset for corresponding file
  for (const [id, { asset, subcategory, source }] of metadataAssets) {
    // Handle special cases for characters and obstacles
    let expectedPath;
    if (category === 'characters') {
      // Characters have animation-based paths
      const charOpts = subcategory || {};
      expectedPath = path.join(PROJECT_ROOT, 'frontend/public',
        assetPaths.getCharacterPath(id, { ...charOpts, animation: 'idle' }));
    } else if (category === 'obstacles') {
      const obsCategory = subcategory || 'rocks';
      expectedPath = path.join(PROJECT_ROOT, 'frontend/public',
        assetPaths.getObstaclePath(id, obsCategory));
    } else {
      // Check at default size
      expectedPath = await getExpectedPath(assetPaths, category, id, {
        size: defaultSize,
        subcategory: typeof subcategory === 'string' ? subcategory : undefined
      });
    }

    // Check both .webp and .png
    const webpPath = expectedPath;
    const pngPath = expectedPath.replace(/\.webp$/, '.png');

    const webpExists = fs.existsSync(webpPath);
    const pngExists = fs.existsSync(pngPath);

    if (webpExists || pngExists) {
      results.valid++;
    } else {
      results.missing.push({
        id,
        expectedPath: path.relative(PROJECT_ROOT, expectedPath),
        metadataSource: source
      });
      if (verbose) {
        console.log(colors.red + `  Missing: ${id}` + colors.reset);
        console.log(colors.dim + `    Expected: ${path.relative(PROJECT_ROOT, expectedPath)}` + colors.reset);
      }
    }
  }

  // Find files on disk to detect orphans
  const baseDir = CATEGORY_BASE_DIRS[category];
  if (baseDir) {
    const searchDir = path.join(ASSETS_ROOT, baseDir);
    const filesOnDisk = findFilesRecursively(searchDir);

    results.totalFiles = filesOnDisk.length;

    // Build set of expected file basenames from metadata
    const expectedBasenames = new Set();
    for (const [id] of metadataAssets) {
      // Add variations that could exist
      expectedBasenames.add(id);
      expectedBasenames.add(`${id}.png`);
      expectedBasenames.add(`${id}.webp`);
    }

    // Check for orphaned files (simplified check)
    for (const filePath of filesOnDisk) {
      const basename = path.basename(filePath, path.extname(filePath));

      // Skip size directories for certain categories
      const relativePath = path.relative(searchDir, filePath);
      const pathParts = relativePath.split(path.sep);

      // Skip if the basename is a known asset
      if (metadataAssets.has(basename)) continue;

      // For characters, check animation suffix
      if (category === 'characters') {
        const baseId = basename.replace(/_(?:idle|walk|attack|hurt|death|dead|cast|victory|reference)$/, '');
        if (metadataAssets.has(baseId)) continue;
      }

      // This file is potentially orphaned
      results.orphaned.push({
        path: path.relative(PROJECT_ROOT, filePath),
        basename
      });

      if (verbose) {
        console.log(colors.yellow + `  Orphaned: ${path.relative(PROJECT_ROOT, filePath)}` + colors.reset);
      }
    }
  }

  return results;
}

/**
 * Print validation report
 */
function printReport(results, verbose) {
  console.log('');
  console.log(colors.bright + '=== Asset Path Validation Report ===' + colors.reset);
  console.log('');

  let totalValid = 0;
  let totalMissing = 0;
  let totalOrphaned = 0;

  for (const result of results) {
    if (result.error) {
      console.log(colors.red + `[X] ${result.category.toUpperCase()}: ${result.error}` + colors.reset);
      continue;
    }

    const status = result.missing.length === 0 ? colors.green + '[OK]' : colors.yellow + '[!!]';
    console.log(status + colors.reset + ` ${colors.bright}${result.category.toUpperCase()}${colors.reset}`);
    console.log(`   Metadata entries: ${result.totalMetadata}`);
    console.log(`   Valid (file exists): ${colors.green}${result.valid}${colors.reset}`);

    if (result.missing.length > 0) {
      console.log(`   Missing files: ${colors.red}${result.missing.length}${colors.reset}`);
      if (verbose) {
        const shown = result.missing.slice(0, 5);
        for (const m of shown) {
          console.log(colors.dim + `     - ${m.id} (from ${m.metadataSource})` + colors.reset);
        }
        if (result.missing.length > 5) {
          console.log(colors.dim + `     ... and ${result.missing.length - 5} more` + colors.reset);
        }
      }
    }

    if (result.orphaned.length > 0) {
      console.log(`   Orphaned files: ${colors.yellow}${result.orphaned.length}${colors.reset}`);
      if (verbose) {
        const shown = result.orphaned.slice(0, 5);
        for (const o of shown) {
          console.log(colors.dim + `     - ${o.path}` + colors.reset);
        }
        if (result.orphaned.length > 5) {
          console.log(colors.dim + `     ... and ${result.orphaned.length - 5} more` + colors.reset);
        }
      }
    }

    console.log('');

    totalValid += result.valid;
    totalMissing += result.missing.length;
    totalOrphaned += result.orphaned.length;
  }

  // Summary
  console.log(colors.bright + '=== Summary ===' + colors.reset);
  console.log(`   Valid assets: ${colors.green}${totalValid}${colors.reset}`);
  console.log(`   Missing files: ${totalMissing > 0 ? colors.red : colors.green}${totalMissing}${colors.reset}`);
  console.log(`   Orphaned files: ${totalOrphaned > 0 ? colors.yellow : colors.green}${totalOrphaned}${colors.reset}`);

  if (totalMissing > 0) {
    console.log('');
    console.log(colors.dim + '   Run with --verbose to see detailed missing/orphaned files' + colors.reset);
  }

  console.log('');
}

/**
 * Print results as JSON
 */
function printJson(results) {
  const output = {
    timestamp: new Date().toISOString(),
    summary: {
      totalValid: results.reduce((sum, r) => sum + (r.valid || 0), 0),
      totalMissing: results.reduce((sum, r) => sum + (r.missing?.length || 0), 0),
      totalOrphaned: results.reduce((sum, r) => sum + (r.orphaned?.length || 0), 0)
    },
    categories: results.map(r => ({
      category: r.category,
      valid: r.valid,
      missing: r.missing?.length || 0,
      orphaned: r.orphaned?.length || 0,
      missingAssets: r.missing,
      orphanedFiles: r.orphaned
    }))
  };

  console.log(JSON.stringify(output, null, 2));
}

// CLI setup
program
  .name('validate-asset-paths')
  .description('Validate asset paths against metadata using shared/assetPaths.js')
  .option('--category <cat>', 'Validate specific category only')
  .option('-v, --verbose', 'Show detailed missing/orphaned files')
  .option('--json', 'Output results as JSON')
  .option('--list-categories', 'List available categories')
  .parse();

const cliOptions = program.opts();

// Main execution
async function main() {
  // List categories
  if (cliOptions.listCategories) {
    console.log('Available categories:');
    for (const category of Object.keys(CATEGORY_METADATA)) {
      console.log(`  ${category}`);
    }
    process.exit(0);
  }

  // Determine which categories to validate
  const categoriesToValidate = cliOptions.category
    ? [cliOptions.category]
    : Object.keys(CATEGORY_METADATA);

  // Validate unknown category
  if (cliOptions.category && !CATEGORY_METADATA[cliOptions.category]) {
    console.error(colors.red + `Unknown category: ${cliOptions.category}` + colors.reset);
    console.error(`Valid categories: ${Object.keys(CATEGORY_METADATA).join(', ')}`);
    process.exit(1);
  }

  // Run validation
  const results = [];
  for (const category of categoriesToValidate) {
    if (!cliOptions.json) {
      console.log(colors.dim + `Validating ${category}...` + colors.reset);
    }
    const result = await validateCategory(category, { verbose: cliOptions.verbose });
    results.push(result);
  }

  // Output results
  if (cliOptions.json) {
    printJson(results);
  } else {
    printReport(results, cliOptions.verbose);
  }

  // Exit with error code if issues found
  const totalMissing = results.reduce((sum, r) => sum + (r.missing?.length || 0), 0);
  process.exit(totalMissing > 0 ? 1 : 0);
}

main().catch(error => {
  console.error(colors.red + `Error: ${error.message}` + colors.reset);
  process.exit(1);
});
