#!/usr/bin/env node
/**
 * AI Image Validation Script
 * Validates generated images against metadata and reports status
 *
 * Usage:
 *   node scripts/ai-images/validate-images.js              # Full validation
 *   node scripts/ai-images/validate-images.js --status     # Quick status check
 *   node scripts/ai-images/validate-images.js --category tiles  # Validate specific category
 *
 */

const path = require('path');
const fs = require('fs');
const {
  getAllStats,
  getCategoryStats,
  loadCategoryAssets,
  log,
  fileExists,
  getProjectRoot,
  formatBytes
} = require('./lib');

// Configuration
const PROJECT_ROOT = getProjectRoot();
const OUTPUT_DIRS = {
  tiles: 'frontend/public/assets/sprites/terrain',
  portraits: 'frontend/public/assets/sprites/characters/portraits',
  items: 'frontend/public/assets/sprites/items',
  icons: 'frontend/public/assets/sprites/icons',
  nodes: 'frontend/public/assets/sprites/nodes'
};

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    status: false,
    category: null,
    verbose: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--status':
        options.status = true;
        break;
      case '--category':
        options.category = args[++i];
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
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
AI Image Validation Script
Validates generated images against metadata and reports status

Usage:
  node scripts/ai-images/validate-images.js [options]

Options:
  --status           Quick status check (just show stats)
  --category <cat>   Validate specific category only
  --verbose, -v      Show detailed validation results
  --help, -h         Show this help message

Categories:
  tiles      - Isometric terrain tiles
  portraits  - Character portraits
  items      - Equipment and consumable sprites
  icons      - UI icons
  nodes      - World map node icons

Examples:
  node scripts/ai-images/validate-images.js --status
  node scripts/ai-images/validate-images.js --category tiles --verbose
`);
}

/**
 * Get expected output path for an asset
 */
function getAssetOutputPath(asset, category) {
  const baseDir = path.join(PROJECT_ROOT, OUTPUT_DIRS[category]);

  switch (category) {
    case 'tiles':
      return path.join(baseDir, asset._biome || 'default', `${asset.id}.png`);
    case 'portraits':
      return path.join(baseDir, `${asset.id}.png`);
    case 'items':
      return path.join(baseDir, asset._itemCategory || 'misc', `${asset.id}.png`);
    case 'icons':
      return path.join(baseDir, asset._iconCategory || 'misc', `${asset.id}.png`);
    case 'nodes':
      return path.join(baseDir, `${asset.id}.png`);
    default:
      return path.join(baseDir, `${asset.id}.png`);
  }
}

/**
 * Validate a single category
 */
function validateCategory(category, options) {
  const results = {
    category,
    total: 0,
    generated: 0,
    missingFiles: [],
    orphanedFiles: [],
    sizeIssues: [],
    valid: 0
  };

  try {
    const data = loadCategoryAssets(category);
    results.total = data.assets.length;

    const expectedFiles = new Set();

    for (const asset of data.assets) {
      const outputPath = getAssetOutputPath(asset, category);
      expectedFiles.add(outputPath);

      if (fileExists(outputPath)) {
        results.generated++;

        // Check file size
        const stats = fs.statSync(outputPath);
        if (stats.size < 100) {
          results.sizeIssues.push({
            id: asset.id,
            path: outputPath,
            size: stats.size,
            issue: 'File too small (possibly corrupt)'
          });
        } else {
          results.valid++;
        }

        // For tiles with variants, check all variant files
        if (category === 'tiles' && asset.variants > 1) {
          for (let i = 1; i < asset.variants; i++) {
            const variantPath = outputPath.replace('.png', `_v${i}.png`);
            expectedFiles.add(variantPath);
            if (!fileExists(variantPath)) {
              results.missingFiles.push({
                id: `${asset.id}_v${i}`,
                path: variantPath
              });
            }
          }
        }
      } else {
        if (asset.generated) {
          results.missingFiles.push({
            id: asset.id,
            path: outputPath,
            issue: 'Marked as generated but file missing'
          });
        } else {
          results.missingFiles.push({
            id: asset.id,
            path: outputPath
          });
        }
      }
    }

    // Check for orphaned files (files that exist but aren't in metadata)
    const baseDir = path.join(PROJECT_ROOT, OUTPUT_DIRS[category]);
    if (fs.existsSync(baseDir)) {
      const findFiles = (dir) => {
        const files = [];
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            files.push(...findFiles(fullPath));
          } else if (item.name.endsWith('.png')) {
            files.push(fullPath);
          }
        }
        return files;
      };

      const actualFiles = findFiles(baseDir);
      for (const file of actualFiles) {
        if (!expectedFiles.has(file)) {
          results.orphanedFiles.push(file);
        }
      }
    }
  } catch (error) {
    log(`Error validating ${category}: ${error.message}`, 'error');
  }

  return results;
}

/**
 * Print status summary
 */
function printStatus() {
  const stats = getAllStats();

  console.log('AI Image Generation Status');
  console.log('==========================');
  console.log('');

  let maxCatLen = 0;
  for (const category of Object.keys(stats.categories)) {
    if (category.length > maxCatLen) maxCatLen = category.length;
  }

  for (const [category, catStats] of Object.entries(stats.categories)) {
    const statusIcon = catStats.pending === 0 ? '✓' : '○';
    const bar = createProgressBar(catStats.percentComplete, 20);
    const padding = ' '.repeat(maxCatLen - category.length);
    console.log(`  ${statusIcon} ${category}${padding}  ${bar} ${catStats.generated}/${catStats.total} (${catStats.percentComplete}%)`);
  }

  console.log('');
  console.log(`  Total: ${stats.total.generated}/${stats.total.total} assets (${stats.total.percentComplete}% complete)`);
  console.log(`  Pending: ${stats.total.pending} assets remaining`);
}

/**
 * Create a text progress bar
 */
function createProgressBar(percent, width) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
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

  // Quick status check
  if (options.status) {
    printStatus();
    process.exit(0);
  }

  log('AI Image Validation', 'info');
  log('===================', 'info');
  console.log('');

  // Determine categories to validate
  const categories = options.category
    ? [options.category]
    : Object.keys(OUTPUT_DIRS);

  if (options.category && !OUTPUT_DIRS[options.category]) {
    log(`Unknown category: ${options.category}`, 'error');
    log(`Valid categories: ${Object.keys(OUTPUT_DIRS).join(', ')}`, 'info');
    process.exit(1);
  }

  // Validate each category
  const allResults = [];
  let totalIssues = 0;

  for (const category of categories) {
    console.log(`Validating: ${category}`);
    console.log('-'.repeat(40));

    const results = validateCategory(category, options);
    allResults.push(results);

    // Summary for category
    console.log(`  Total assets: ${results.total}`);
    console.log(`  Generated: ${results.generated} (${Math.round((results.generated / results.total) * 100)}%)`);
    console.log(`  Valid files: ${results.valid}`);
    console.log(`  Missing: ${results.missingFiles.length}`);
    console.log(`  Orphaned: ${results.orphanedFiles.length}`);
    console.log(`  Size issues: ${results.sizeIssues.length}`);

    // Verbose output
    if (options.verbose) {
      if (results.missingFiles.length > 0) {
        console.log('');
        console.log('  Missing files:');
        for (const item of results.missingFiles.slice(0, 10)) {
          console.log(`    - ${item.id}`);
        }
        if (results.missingFiles.length > 10) {
          console.log(`    ... and ${results.missingFiles.length - 10} more`);
        }
      }

      if (results.orphanedFiles.length > 0) {
        console.log('');
        console.log('  Orphaned files (not in metadata):');
        for (const file of results.orphanedFiles.slice(0, 5)) {
          console.log(`    - ${path.relative(PROJECT_ROOT, file)}`);
        }
        if (results.orphanedFiles.length > 5) {
          console.log(`    ... and ${results.orphanedFiles.length - 5} more`);
        }
      }

      if (results.sizeIssues.length > 0) {
        console.log('');
        console.log('  Size issues:');
        for (const item of results.sizeIssues) {
          console.log(`    - ${item.id}: ${formatBytes(item.size)} (${item.issue})`);
        }
      }
    }

    totalIssues += results.missingFiles.length + results.orphanedFiles.length + results.sizeIssues.length;
    console.log('');
  }

  // Overall summary
  console.log('========================================');
  log('Validation Summary', 'info');
  console.log('========================================');

  const totalGenerated = allResults.reduce((sum, r) => sum + r.generated, 0);
  const totalAssets = allResults.reduce((sum, r) => sum + r.total, 0);
  const totalValid = allResults.reduce((sum, r) => sum + r.valid, 0);

  console.log(`  Total assets: ${totalAssets}`);
  console.log(`  Generated: ${totalGenerated} (${Math.round((totalGenerated / totalAssets) * 100)}%)`);
  console.log(`  Valid: ${totalValid}`);
  console.log(`  Issues found: ${totalIssues}`);

  if (totalIssues === 0 && totalGenerated === totalAssets) {
    log('All assets are valid and complete!', 'success');
  } else if (totalIssues > 0) {
    log(`Found ${totalIssues} issues to address`, 'warn');
  }

  process.exit(totalIssues > 0 ? 1 : 0);
}

main().catch(error => {
  log(`Unexpected error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
