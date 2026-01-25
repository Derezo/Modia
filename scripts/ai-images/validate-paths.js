#!/usr/bin/env node
/**
 * Validate asset paths and size variant coverage
 *
 * Checks that all generated assets have proper size variants in the correct locations.
 * Reports coverage percentages per category and size.
 *
 * Usage:
 *   node scripts/ai-images/validate-paths.js
 *   node scripts/ai-images/validate-paths.js --category icons
 *   node scripts/ai-images/validate-paths.js --verbose
 *   node scripts/ai-images/validate-paths.js --json
 */

const path = require('path');
const fs = require('fs');
const { program } = require('commander');
const { SIZE_PRESETS } = require('./lib/resizeUtils');
const { fileExists, getProjectRoot } = require('./lib/imageUtils');

const PROJECT_ROOT = getProjectRoot();
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
 * Expected file locations per category
 * sizePattern determines how size variants are organized:
 * - 'directory': {baseDir}/{size}/{subcategory}-{id}.png (icons in icons/png/)
 * - 'suffix': {baseDir}/{subcategory}/{id}_{size}.png (items)
 * - 'sizeDir': {baseDir}/{subcategory}/{size}x{size}/{id}.png (standard)
 * - 'none': No size variants, single file at {baseDir}/{id}.png
 */
const CATEGORY_CONFIGS = {
  icons: {
    baseDir: 'icons/png',
    sizePattern: 'directory', // {baseDir}/{size}/{subcategory}-{id}.png
    subcategories: ['actions', 'status', 'ui', 'skills', 'items', 'augments', 'menu']
  },
  items: {
    baseDir: 'sprites/items',
    sizePattern: 'suffix', // {baseDir}/{subcategory}/{id}_{size}.png
    subcategories: ['weapons', 'armor', 'accessories', 'consumables']
  },
  nodes: {
    baseDir: 'sprites/nodes',
    sizePattern: 'none' // Currently no size variants
  },
  portraits: {
    baseDir: 'sprites/portraits',
    sizePattern: 'none' // Currently no size variants
  },
  tiles: {
    baseDir: 'sprites/terrain',
    sizePattern: 'none', // Isometric tiles are a single size
    subcategories: ['base', 'bridge', 'castle', 'cave', 'forest', 'mountain', 'default']
  },
  overlays: {
    baseDir: 'sprites/overlays',
    sizePattern: 'none'
  }
};

/**
 * Find all assets for a given category by scanning directories
 * @param {string} category - Category name
 * @param {Object} config - Category configuration
 * @returns {Array<{id: string, subcategory?: string, basePath: string}>}
 */
function findAssetsForCategory(category, config) {
  const assets = [];
  const baseDir = path.join(ASSETS_ROOT, config.baseDir);

  if (!fs.existsSync(baseDir)) {
    return assets;
  }

  const sizes = SIZE_PRESETS[category] || [];

  if (config.sizePattern === 'directory') {
    // Icons: assets are in size directories like icons/png/32/actions-action_attack.png
    // Find the largest EXISTING size directory to get the list of assets
    const sortedSizes = [...sizes].sort((a, b) => b - a); // Descending order
    let sizePath = null;
    let usedSize = null;

    for (const size of sortedSizes) {
      const testPath = path.join(baseDir, String(size));
      if (fs.existsSync(testPath)) {
        sizePath = testPath;
        usedSize = size;
        break;
      }
    }

    if (sizePath) {
      const files = fs.readdirSync(sizePath).filter(f => f.endsWith('.png'));
      for (const file of files) {
        // Parse subcategory-id.png format
        const match = file.match(/^([^-]+)-(.+)\.png$/);
        if (match) {
          assets.push({
            id: match[2],
            subcategory: match[1],
            basePath: path.join(sizePath, file),
            _referenceSize: usedSize
          });
        } else {
          // No subcategory
          assets.push({
            id: path.basename(file, '.png'),
            basePath: path.join(sizePath, file),
            _referenceSize: usedSize
          });
        }
      }
    }
  } else if (config.sizePattern === 'suffix') {
    // Items: files like weapons/axe_battle_32.png, axe_battle_48.png
    // Find base assets by looking for the largest size
    const largestSize = Math.max(...sizes);
    const subcategories = config.subcategories || [''];

    for (const subcat of subcategories) {
      const subcatDir = subcat ? path.join(baseDir, subcat) : baseDir;
      if (!fs.existsSync(subcatDir)) continue;

      const files = fs.readdirSync(subcatDir).filter(f => f.endsWith('.png'));

      // Group by base name (remove size suffix)
      const baseNames = new Set();
      for (const file of files) {
        const match = file.match(/^(.+)_(\d+)\.png$/);
        if (match && sizes.includes(parseInt(match[2], 10))) {
          baseNames.add(match[1]);
        }
      }

      for (const baseName of baseNames) {
        assets.push({
          id: baseName,
          subcategory: subcat || undefined,
          basePath: path.join(subcatDir, `${baseName}_${largestSize}.png`)
        });
      }
    }
  } else if (config.sizePattern === 'sizeDir') {
    // Standard: files in size subdirectories like items/weapons/32x32/sword.png
    const largestSize = Math.max(...sizes);
    const subcategories = config.subcategories || [''];

    for (const subcat of subcategories) {
      const subcatDir = subcat ? path.join(baseDir, subcat) : baseDir;
      const sizeSubdir = path.join(subcatDir, `${largestSize}x${largestSize}`);

      if (!fs.existsSync(sizeSubdir)) continue;

      const files = fs.readdirSync(sizeSubdir).filter(f => f.endsWith('.png'));
      for (const file of files) {
        assets.push({
          id: path.basename(file, '.png'),
          subcategory: subcat || undefined,
          basePath: path.join(sizeSubdir, file)
        });
      }
    }
  } else {
    // No size variants - find all PNG files
    const subcategories = config.subcategories || [''];

    for (const subcat of subcategories) {
      const searchDir = subcat ? path.join(baseDir, subcat) : baseDir;
      if (!fs.existsSync(searchDir)) continue;

      const entries = fs.readdirSync(searchDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.png')) {
          // Skip variant files (e.g., forest_grass_1_v0.png)
          const isVariant = /_v\d+\.png$/.test(entry.name);
          if (!isVariant) {
            assets.push({
              id: path.basename(entry.name, '.png'),
              subcategory: subcat || undefined,
              basePath: path.join(searchDir, entry.name)
            });
          }
        }
      }
    }
  }

  return assets;
}

/**
 * Get expected file path for a given asset and size
 * @param {string} category - Category name
 * @param {Object} asset - Asset info {id, subcategory, basePath}
 * @param {number} size - Target size
 * @param {Object} config - Category configuration
 * @returns {string} Expected file path
 */
function getExpectedPath(category, asset, size, config) {
  const baseDir = path.join(ASSETS_ROOT, config.baseDir);

  switch (config.sizePattern) {
    case 'directory':
      // icons/png/{size}/{subcategory}-{id}.png
      if (asset.subcategory) {
        return path.join(baseDir, String(size), `${asset.subcategory}-${asset.id}.png`);
      }
      return path.join(baseDir, String(size), `${asset.id}.png`);

    case 'suffix':
      // sprites/items/{subcategory}/{id}_{size}.png
      if (asset.subcategory) {
        return path.join(baseDir, asset.subcategory, `${asset.id}_${size}.png`);
      }
      return path.join(baseDir, `${asset.id}_${size}.png`);

    case 'sizeDir':
      // {baseDir}/{subcategory}/{size}x{size}/{id}.png
      if (asset.subcategory) {
        return path.join(baseDir, asset.subcategory, `${size}x${size}`, `${asset.id}.png`);
      }
      return path.join(baseDir, `${size}x${size}`, `${asset.id}.png`);

    case 'none':
    default:
      // No size variants
      return asset.basePath;
  }
}

/**
 * Validate a single category
 * @param {string} category - Category name
 * @param {Object} options - Validation options
 * @returns {Object} Validation results
 */
function validateCategory(category, options = {}) {
  const { verbose = false } = options;
  const config = CATEGORY_CONFIGS[category];

  if (!config) {
    return {
      category,
      error: `Unknown category: ${category}`,
      totalAssets: 0,
      sizeVariants: {},
      missing: [],
      coverage: {}
    };
  }

  const sizes = SIZE_PRESETS[category] || [];

  const results = {
    category,
    totalAssets: 0,
    sizeVariants: {},
    missing: [],
    coverage: {},
    config: {
      baseDir: config.baseDir,
      sizePattern: config.sizePattern,
      sizes: sizes
    }
  };

  // Initialize size tracking
  for (const size of sizes) {
    results.sizeVariants[size] = { found: 0, missing: 0 };
  }

  // Find all assets for this category
  const assets = findAssetsForCategory(category, config);
  results.totalAssets = assets.length;

  // For categories without size variants
  if (config.sizePattern === 'none' || sizes.length === 0) {
    results.coverage['base'] = assets.length > 0 ? 100 : 0;
    return results;
  }

  // Check size variant coverage
  for (const asset of assets) {
    for (const size of sizes) {
      const expectedPath = getExpectedPath(category, asset, size, config);

      if (fileExists(expectedPath)) {
        results.sizeVariants[size].found++;
      } else {
        results.sizeVariants[size].missing++;
        if (verbose) {
          results.missing.push({
            asset: asset.id,
            subcategory: asset.subcategory,
            size,
            expectedPath: path.relative(PROJECT_ROOT, expectedPath)
          });
        }
      }
    }
  }

  // Calculate coverage percentages
  for (const size of sizes) {
    const { found, missing } = results.sizeVariants[size];
    const total = found + missing;
    results.coverage[size] = total > 0 ? Math.round((found / total) * 100) : 0;
  }

  return results;
}

/**
 * Create a visual progress bar
 * @param {number} percent - Percentage (0-100)
 * @param {number} width - Bar width in characters
 * @returns {string} Colored progress bar
 */
function createProgressBar(percent, width = 10) {
  const filled = Math.floor(percent / (100 / width));
  const empty = width - filled;
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);

  // Color based on coverage
  let color;
  if (percent === 100) {
    color = colors.green;
  } else if (percent >= 80) {
    color = colors.yellow;
  } else {
    color = colors.red;
  }

  return color + bar + colors.reset;
}

/**
 * Get status symbol based on coverage
 * @param {number} percent - Coverage percentage
 * @returns {string} Status symbol with color
 */
function getStatusSymbol(percent) {
  if (percent === 100) {
    return colors.green + '\u2713' + colors.reset; // checkmark
  } else if (percent >= 80) {
    return colors.yellow + '\u25cb' + colors.reset; // circle
  } else {
    return colors.red + '\u2717' + colors.reset; // x
  }
}

/**
 * Print the validation report
 * @param {Array<Object>} results - Array of category validation results
 * @param {boolean} verbose - Show detailed missing files
 */
function printReport(results, verbose) {
  console.log('');
  console.log(colors.bright + '=== Asset Path Validation Report ===' + colors.reset);
  console.log('');

  let totalAssets = 0;
  let totalMissing = 0;
  let categoriesComplete = 0;

  for (const result of results) {
    if (result.error) {
      console.log(colors.red + `\u274c ${result.category.toUpperCase()}: ${result.error}` + colors.reset);
      console.log('');
      continue;
    }

    totalAssets += result.totalAssets;

    // Category header
    console.log(colors.cyan + colors.bright + `\ud83d\udce6 ${result.category.toUpperCase()}` + colors.reset);
    console.log(colors.dim + `   Base directory: ${result.config.baseDir}` + colors.reset);
    console.log(`   Total assets: ${colors.bright}${result.totalAssets}${colors.reset}`);

    // Skip size coverage for categories without variants
    if (result.config.sizePattern === 'none' || Object.keys(result.sizeVariants).length === 0) {
      console.log(colors.dim + '   Size variants: none (single resolution)' + colors.reset);
      categoriesComplete++;
      console.log('');
      continue;
    }

    console.log('   Size coverage:');

    let categoryMissing = 0;
    let allComplete = true;

    for (const [size, coverage] of Object.entries(result.coverage)) {
      const bar = createProgressBar(coverage);
      const status = getStatusSymbol(coverage);
      const stats = result.sizeVariants[size];
      const missingCount = stats ? stats.missing : 0;

      console.log(`     ${colors.bright}${String(size).padStart(4)}px${colors.reset}: ${bar} ${String(coverage).padStart(3)}% ${status}` +
        (missingCount > 0 ? colors.dim + ` (${missingCount} missing)` + colors.reset : ''));

      categoryMissing += missingCount;
      if (coverage < 100) allComplete = false;
    }

    totalMissing += categoryMissing;
    if (allComplete) categoriesComplete++;

    // Verbose: show missing files
    if (verbose && result.missing.length > 0) {
      console.log('');
      console.log(colors.dim + '   Missing files:' + colors.reset);
      const shown = result.missing.slice(0, 10);
      for (const m of shown) {
        const assetName = m.subcategory ? `${m.subcategory}/${m.asset}` : m.asset;
        console.log(colors.red + `     - ${assetName} @ ${m.size}px` + colors.reset);
      }
      if (result.missing.length > 10) {
        console.log(colors.dim + `     ... and ${result.missing.length - 10} more` + colors.reset);
      }
    }

    console.log('');
  }

  // Summary
  console.log(colors.bright + '=== Summary ===' + colors.reset);
  console.log(`   Categories validated: ${colors.bright}${results.length}${colors.reset}`);
  console.log(`   Categories complete: ${colors.green}${categoriesComplete}${colors.reset}/${results.length}`);
  console.log(`   Total assets scanned: ${colors.bright}${totalAssets}${colors.reset}`);

  if (totalMissing > 0) {
    console.log(`   Missing size variants: ${colors.red}${totalMissing}${colors.reset}`);
    console.log('');
    console.log(colors.yellow + '   Run with --verbose to see missing file details' + colors.reset);
  } else if (totalAssets > 0) {
    console.log('');
    console.log(colors.green + '   \u2713 All size variants present!' + colors.reset);
  }

  console.log('');
}

/**
 * Print results as JSON
 * @param {Array<Object>} results - Validation results
 */
function printJson(results) {
  // Clean up results for JSON output
  const output = {
    timestamp: new Date().toISOString(),
    summary: {
      totalCategories: results.length,
      totalAssets: results.reduce((sum, r) => sum + r.totalAssets, 0),
      totalMissing: results.reduce((sum, r) => sum + r.missing.length, 0)
    },
    categories: results.map(r => ({
      category: r.category,
      totalAssets: r.totalAssets,
      coverage: r.coverage,
      missing: r.missing.length,
      config: r.config
    }))
  };

  console.log(JSON.stringify(output, null, 2));
}

// CLI setup
program
  .name('validate-paths')
  .description('Validate asset paths and size variant coverage')
  .option('--category <cat>', 'Validate specific category only')
  .option('-v, --verbose', 'Show missing file details')
  .option('--json', 'Output results as JSON')
  .option('--list-categories', 'List available categories')
  .parse();

const options = program.opts();

// List categories
if (options.listCategories) {
  console.log('Available categories:');
  for (const [name, config] of Object.entries(CATEGORY_CONFIGS)) {
    const sizes = SIZE_PRESETS[name] || [];
    console.log(`  ${name}: ${config.baseDir} (${config.sizePattern}, sizes: ${sizes.join(', ') || 'none'})`);
  }
  process.exit(0);
}

// Determine which categories to validate
const categoriesToValidate = options.category
  ? [options.category]
  : Object.keys(CATEGORY_CONFIGS);

// Validate unknown category
if (options.category && !CATEGORY_CONFIGS[options.category]) {
  console.error(colors.red + `Unknown category: ${options.category}` + colors.reset);
  console.error(`Valid categories: ${Object.keys(CATEGORY_CONFIGS).join(', ')}`);
  process.exit(1);
}

// Run validation
const results = [];
for (const category of categoriesToValidate) {
  const result = validateCategory(category, { verbose: options.verbose });
  results.push(result);
}

// Output results
if (options.json) {
  printJson(results);
} else {
  printReport(results, options.verbose);
}

// Exit with error code if missing files found
const totalMissing = results.reduce((sum, r) => sum + r.missing.length, 0);
process.exit(totalMissing > 0 ? 1 : 0);
