#!/usr/bin/env node
/**
 * Generate All Visual Assets Script
 * Generates pending visual assets; terrain uses the deterministic compiler.
 *
 * Usage:
 *   node scripts/ai-images/generate-all.js                  # Generate all pending
 *   node scripts/ai-images/generate-all.js --dry-run        # Preview without generating
 *   node scripts/ai-images/generate-all.js --category tiles # Generate specific category
 *   node scripts/ai-images/generate-all.js --force          # Regenerate all
 *
 * Environment variables:
 *   HUGGINGFACE_API_TOKEN - Required API token for HuggingFace
 *   IMAGE_GENERATOR_ROOT - Path to image-generator project (optional)
 */

const path = require('path');
const { spawn } = require('child_process');
const {
  getAllStats,
  log,
  getProjectRoot
} = require('./lib');

// Configuration
const SCRIPT_DIR = __dirname;

const CATEGORY_SCRIPTS = {
  // Tiles use the deterministic geometry compiler. Keep them in this command
  // for compatibility, but never send them through an AI backend.
  tiles: '../tiles/generate-isometric-tiles.js',
  portraits: 'generate-portraits.js',
  items: 'generate-items.js',
  icons: 'generate-icons.js',
  nodes: 'generate-nodes.js',
  overlays: 'generate-overlays.js',
  obstacles: 'generate-obstacles.js',
  characters: 'generate-characters.js'
};

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    category: null,
    force: false,
    verbose: false,
    quiet: false,
    delay: 2000,  // Default 2 second delay between requests
    local: true,
    huggingface: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--category':
        options.category = args[++i];
        break;
      case '--force':
        options.force = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--quiet':
      case '-q':
        options.quiet = true;
        break;
      case '--delay':
        options.delay = parseInt(args[++i], 10);
        break;
      case '--huggingface':
      case '--hf':
        options.huggingface = true;
        options.local = false;
        break;
      case '--local':
        options.local = true;
        options.huggingface = false;
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
Generate All Visual Assets Script
Generates pending visual assets; terrain uses the deterministic compiler

Usage:
  node scripts/ai-images/generate-all.js [options]

Options:
  --dry-run            Show what would be generated without calling APIs
  --category <cat>     Generate one category listed below
  --force              Regenerate even if files exist
  --verbose, -v        Show detailed output including full prompt construction
  --quiet, -q          Suppress all output except errors
  --delay <ms>         Delay between requests in milliseconds (default: 2000)
  --huggingface, --hf  Use HuggingFace API instead of local ComfyUI (AI categories)
  --local              Use local ComfyUI for AI categories (default)
  --help, -h           Show this help message

Categories:
  tiles      - Deterministically compiled isometric terrain materials
  portraits  - Character portraits (race × gender × class)
  items      - Equipment and consumable sprites
  icons      - UI icons (actions, status, menu, augments)
  nodes      - World map node icons
  overlays   - Rarity and augment effect overlays
  obstacles  - Environment obstacles for battle maps (rocks, trees)
  characters - Animated character sprite sheets (64x512 vertical strips)

Environment variables:
  HUGGINGFACE_API_TOKEN  Required API token for HuggingFace
  IMAGE_GENERATOR_ROOT   Path to image-generator project (optional)

Examples:
  node scripts/ai-images/generate-all.js --dry-run
  node scripts/ai-images/generate-all.js --category tiles
  node scripts/ai-images/generate-all.js --force
`);
}

/**
 * Run a category generator script
 * @param {string} category - Category name
 * @param {Object} options - CLI options
 * @returns {Promise<{success: boolean, output: string}>}
 */
function buildCategoryArgs(category, options) {
  const isDeterministicTileJob = category === 'tiles';
  const args = [];

  if (options.dryRun) args.push('--dry-run');
  if (options.force) args.push('--force');
  if (options.verbose) args.push('--verbose');
  if (options.quiet) args.push('--quiet');
  if (isDeterministicTileJob) {
    // Aggregate generation must close the same metadata lifecycle as a direct
    // admin/queue compile, otherwise ai:status reports a successfully written
    // tile as pending forever.
    args.push('--update-metadata');
  } else {
    if (options.delay !== 2000) args.push('--delay', String(options.delay));
    if (options.huggingface) args.push('--huggingface');
    if (options.local && !options.huggingface) args.push('--local');
  }

  return args;
}

function runCategoryScript(category, options) {
  return new Promise((resolve) => {
    const scriptPath = path.resolve(SCRIPT_DIR, CATEGORY_SCRIPTS[category]);
    const args = buildCategoryArgs(category, options);

    log(`Running ${category} generator...`, 'info');

    const proc = spawn('node', [scriptPath, ...args], {
      stdio: 'inherit',
      cwd: getProjectRoot()
    });

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        exitCode: code
      });
    });

    proc.on('error', (error) => {
      log(`Failed to run ${category} script: ${error.message}`, 'error');
      resolve({
        success: false,
        exitCode: 1,
        error: error.message
      });
    });
  });
}

/**
 * Validate required environment variables
 */
function validateEnvVars(options, categories) {
  if (options.dryRun) return;

  // Tile-only jobs never contact an AI backend, even if a compatibility caller
  // leaves --huggingface or --local on the command line.
  if (!categories.some(category => category !== 'tiles')) return;

  // Only require HuggingFace token when using HuggingFace mode
  if (options.huggingface && !process.env.HUGGINGFACE_API_TOKEN) {
    log('Missing HUGGINGFACE_API_TOKEN in environment', 'error');
    log('Set it with: export HUGGINGFACE_API_TOKEN=hf_xxx', 'info');
    log('Or use local generation (default): remove --huggingface flag', 'info');
    process.exit(1);
  }

  // Warn about IMAGE_GENERATOR_ROOT for local mode
  if (options.local && !process.env.IMAGE_GENERATOR_ROOT) {
    log('IMAGE_GENERATOR_ROOT not set, will try default paths', 'warn');
  }
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

  if (options.category && !CATEGORY_SCRIPTS[options.category]) {
    log(`Unknown category: ${options.category}`, 'error');
    log(`Valid categories: ${Object.keys(CATEGORY_SCRIPTS).join(', ')}`, 'info');
    process.exit(1);
  }

  const categories = options.category
    ? [options.category]
    : Object.keys(CATEGORY_SCRIPTS);

  validateEnvVars(options, categories);

  log('Visual Asset Generation - All Categories', 'info');
  log('=====================================', 'info');
  console.log('');

  // Get current stats
  const stats = getAllStats();

  console.log('Current Status:');
  console.log('---------------');
  for (const [category, catStats] of Object.entries(stats.categories)) {
    const statusIcon = catStats.pending > 0 ? '○' : '●';
    console.log(`  ${statusIcon} ${category}: ${catStats.generated}/${catStats.total} (${catStats.percentComplete}%)`);
  }
  console.log('');
  console.log(`  Total: ${stats.total.generated}/${stats.total.total} (${stats.total.percentComplete}%)`);
  console.log('');

  // Run generators
  const results = {
    success: [],
    failed: []
  };

  for (const category of categories) {
    console.log('');
    console.log(`========================================`);
    console.log(`Processing: ${category}`);
    console.log(`========================================`);
    console.log('');

    const result = await runCategoryScript(category, options);

    if (result.success) {
      results.success.push(category);
    } else {
      results.failed.push({ category, exitCode: result.exitCode });
    }
  }

  // Final summary
  console.log('');
  console.log('========================================');
  log('Overall Summary', 'info');
  console.log('========================================');
  console.log(`  Categories processed: ${categories.length}`);
  console.log(`  Successful: ${results.success.length}`);
  console.log(`  Failed: ${results.failed.length}`);
  console.log('');

  if (results.failed.length > 0) {
    log('Failed categories:', 'error');
    for (const item of results.failed) {
      console.log(`  - ${item.category} (exit code: ${item.exitCode})`);
    }
  }

  // Show updated stats
  if (!options.dryRun) {
    console.log('');
    const updatedStats = getAllStats();
    console.log('Updated Status:');
    console.log('---------------');
    for (const [category, catStats] of Object.entries(updatedStats.categories)) {
      const statusIcon = catStats.pending > 0 ? '○' : '●';
      console.log(`  ${statusIcon} ${category}: ${catStats.generated}/${catStats.total} (${catStats.percentComplete}%)`);
    }
    console.log('');
    console.log(`  Total: ${updatedStats.total.generated}/${updatedStats.total.total} (${updatedStats.total.percentComplete}%)`);
  }

  process.exit(results.failed.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch(error => {
    log(`Unexpected error: ${error.message}`, 'error');
    console.error(error);
    process.exit(1);
  });
}

module.exports = { buildCategoryArgs, runCategoryScript };
