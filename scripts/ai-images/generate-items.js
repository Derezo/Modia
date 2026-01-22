#!/usr/bin/env node
/**
 * Item Sprite Generation Script
 * Generates item sprites using local ComfyUI (default) or HuggingFace API
 *
 * Usage:
 *   node scripts/ai-images/generate-items.js                    # Generate using local ComfyUI
 *   node scripts/ai-images/generate-items.js --huggingface      # Use HuggingFace API instead
 *   node scripts/ai-images/generate-items.js --dry-run          # Preview
 *   node scripts/ai-images/generate-items.js --key sword_iron   # Generate specific
 *   node scripts/ai-images/generate-items.js --category weapons # Filter by category
 *   node scripts/ai-images/generate-items.js --force            # Regenerate existing
 *
 * Environment variables:
 *   HUGGINGFACE_API_TOKEN - Required only for --huggingface mode
 *   IMAGE_GENERATOR_ROOT - Path to image-generator project (required)
 */

const path = require('path');
const {
  loadItemMetadata,
  markAssetGenerated,
  generateItem,
  log,
  fileExists,
  delay,
  ensureDirectoryExists,
  getProjectRoot,
  buildThemedPrompt,
  createBackup
} = require('./lib');

// Configuration
const PROJECT_ROOT = getProjectRoot();
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/sprites/items');

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    key: null,
    category: null,
    force: false,
    backup: false,
    local: true,     // Local ComfyUI is now the default
    huggingface: false,
    verbose: false,
    quiet: false,
    delay: 2000,  // Default 2 second delay between requests
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--key':
        options.key = args[++i];
        break;
      case '--category':
        options.category = args[++i];
        break;
      case '--force':
        options.force = true;
        break;
      case '--backup':
        options.backup = true;
        break;
      case '--huggingface':
      case '--hf':
        options.huggingface = true;
        options.local = false;  // Disable local when using HuggingFace
        break;
      case '--local':
        // Explicit local flag (already default, but kept for clarity)
        options.local = true;
        options.huggingface = false;
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
Item Sprite Generation Script
Generates item sprites using local ComfyUI (default) or HuggingFace API

Usage:
  node scripts/ai-images/generate-items.js [options]

Options:
  --dry-run           Show what would be generated without calling APIs
  --key <id>          Generate specific item (e.g., sword_iron)
  --category <cat>    Filter by category (weapons, armor, consumables)
  --force             Regenerate even if file exists
  --backup            Backup existing images before regenerating
  --huggingface, --hf Use HuggingFace API instead of local ComfyUI
  --local             Use local ComfyUI (default, explicit flag optional)
  --verbose, -v       Show detailed output including full prompt construction
  --quiet, -q         Suppress all output except errors
  --delay <ms>        Delay between requests in milliseconds (default: 2000)
  --help, -h          Show this help message

Environment variables:
  IMAGE_GENERATOR_ROOT   Path to image-generator project (required)
  HUGGINGFACE_API_TOKEN  Required only for --huggingface mode

Examples:
  node scripts/ai-images/generate-items.js --dry-run
  node scripts/ai-images/generate-items.js --category weapons
  node scripts/ai-images/generate-items.js --key sword_iron --force
  node scripts/ai-images/generate-items.js --huggingface --category armor  # Use HF API
`);
}

/**
 * Get the output path for an item
 */
function getOutputPath(item) {
  return path.join(OUTPUT_DIR, item._itemCategory, `${item.id}.png`);
}

/**
 * Check if an item needs generation
 */
function needsGeneration(item, options) {
  if (options.force) return true;
  if (item.generated) return false;
  return !fileExists(getOutputPath(item));
}

/**
 * Filter items based on CLI options
 */
function filterItems(items, options) {
  let filtered = items;

  if (options.key) {
    filtered = filtered.filter(i => i.id === options.key);
  }

  return filtered;
}

/**
 * Validate required environment variables
 */
function validateEnvVars(options) {
  if (options.dryRun) return;

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

  validateEnvVars(options);

  log('Item Sprite Generation Script', 'info');
  log('=============================', 'info');

  // Load metadata
  let metadata;
  try {
    metadata = loadItemMetadata(options.category);
    log(`Loaded ${metadata.items.length} items`, 'info');
  } catch (error) {
    log(`Failed to load metadata: ${error.message}`, 'error');
    process.exit(1);
  }

  // Filter items
  const filteredItems = filterItems(metadata.items, options);
  log(`Filtered to ${filteredItems.length} items`, 'info');

  // Determine which need generation
  const itemsToGenerate = filteredItems.filter(i =>
    needsGeneration(i, options)
  );
  const skipped = filteredItems.length - itemsToGenerate.length;

  if (skipped > 0) {
    log(`Skipping ${skipped} items (already exist or generated)`, 'info');
  }

  if (itemsToGenerate.length === 0) {
    log('No items need generation', 'success');
    process.exit(0);
  }

  log(`\nItems to generate: ${itemsToGenerate.length}`, 'info');
  console.log('');

  // Display what will be generated
  for (const item of itemsToGenerate) {
    const prompt = buildThemedPrompt('items', item.prompt, {
      rarity: item.rarity,
      itemCategory: item._itemCategory,
      skipTrigger: true  // Python script adds trigger word
    });

    console.log(`  - ${item.id}`);
    console.log(`    Category: ${item._itemCategory}`);
    console.log(`    Rarity: ${item.rarity || 'common'}`);
    console.log(`    Output: ${getOutputPath(item)}`);
    if (options.dryRun) {
      console.log(`    Prompt: ${prompt}`);
    }
    console.log('');
  }

  // Dry run - just display
  if (options.dryRun) {
    log(`\nDry run complete. Would generate ${itemsToGenerate.length} items.`, 'success');
    process.exit(0);
  }

  // Create backup if requested
  if (options.backup) {
    log('Creating backup of existing files...', 'info');
    const backupResult = createBackup(itemsToGenerate, { reason: 'category regeneration' });
    if (backupResult.success) {
      log(`Backup created: ${backupResult.backupDir}`, 'success');
      log(`Backed up ${backupResult.assetCount} assets`, 'info');
    } else {
      log(`Backup failed: ${backupResult.error}`, 'warn');
    }
  }

  // Ensure output directories exist
  for (const cat of ['weapons', 'armor', 'consumables']) {
    ensureDirectoryExists(path.join(OUTPUT_DIR, cat));
  }

  // Generate items
  const results = {
    success: [],
    failed: []
  };

  log('\nStarting generation...', 'info');
  console.log('');

  for (let i = 0; i < itemsToGenerate.length; i++) {
    const item = itemsToGenerate[i];

    log(`[${i + 1}/${itemsToGenerate.length}] Generating: ${item.id}`, 'info');

    try {
      const result = await generateItem({
        prompt: item.prompt,
        key: item.id,
        category: item._itemCategory,
        seed: item.seed
      }, {
        verbose: options.verbose,
        quiet: options.quiet,
        local: options.local,
        huggingface: options.huggingface
      });

      if (result.success) {
        results.success.push({ id: item.id, item });

        item._category = 'items';
        markAssetGenerated(item);

        log(`Generated: ${item.id}`, 'success');
      } else {
        results.failed.push({
          id: item.id,
          error: result.stderr || 'Unknown error'
        });
        log(`Failed: ${item.id}`, 'error');
      }

      // Rate limit delay
      if (i < itemsToGenerate.length - 1 && options.delay > 0) {
        await delay(options.delay);
      }
    } catch (error) {
      log(`Failed to generate ${item.id}: ${error.message}`, 'error');
      results.failed.push({ id: item.id, error: error.message });
    }
  }

  // Summary
  console.log('\n========================================');
  log('Generation Summary', 'info');
  console.log('========================================');
  console.log(`  Success: ${results.success.length}`);
  console.log(`  Failed:  ${results.failed.length}`);
  console.log('');

  if (results.failed.length > 0) {
    log('Failed items:', 'error');
    for (const item of results.failed) {
      console.log(`  - ${item.id}: ${item.error}`);
    }
  }

  process.exit(results.failed.length > 0 ? 1 : 0);
}

main().catch(error => {
  log(`Unexpected error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
