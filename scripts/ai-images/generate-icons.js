#!/usr/bin/env node
/**
 * Icon Generation Script
 * Generates UI icons using local ComfyUI (default) or HuggingFace API.
 * Icons are generated at 128x128 source size for better quality, then downscaled to 64x64.
 *
 * Usage:
 *   node scripts/ai-images/generate-icons.js                    # Generate using local ComfyUI
 *   node scripts/ai-images/generate-icons.js --huggingface      # Use HuggingFace API instead
 *   node scripts/ai-images/generate-icons.js --dry-run          # Preview
 *   node scripts/ai-images/generate-icons.js --key action_attack  # Generate specific
 *   node scripts/ai-images/generate-icons.js --category actions   # Filter by category
 *   node scripts/ai-images/generate-icons.js --force            # Regenerate existing
 *
 * Environment variables:
 *   HUGGINGFACE_API_TOKEN - Required only for --huggingface mode
 *   IMAGE_GENERATOR_ROOT - Path to image-generator project (required)
 */

const path = require('path');
const {
  loadIconMetadata,
  markAssetGenerated,
  generateIcon,
  log,
  fileExists,
  delay,
  ensureDirectoryExists,
  getProjectRoot,
  buildThemedPrompt,
  createBackup,
  getEffectiveLoraModel,
  loadRegenerationQueue,
  clearRegenerationMarker
} = require('./lib');

// Configuration
const PROJECT_ROOT = getProjectRoot();
// New icons path with originals directory
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/icons/originals');

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
    lora: null,   // LoRA model override (v1, v2, modern-pixel, retro-pixel)
    queue: false, // Process icons marked for regeneration
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--key':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          log('--key requires a value', 'error');
          process.exit(1);
        }
        options.key = args[++i];
        break;
      case '--category':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          log('--category requires a value', 'error');
          process.exit(1);
        }
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
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          log('--delay requires a value', 'error');
          process.exit(1);
        }
        options.delay = parseInt(args[++i], 10);
        break;
      case '--lora': {
        const validLoraModels = ['v1', 'v2', 'modern-pixel', 'retro-pixel'];
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          log('--lora requires a value (v1, v2, modern-pixel, retro-pixel)', 'error');
          process.exit(1);
        }
        options.lora = args[++i];
        if (!validLoraModels.includes(options.lora)) {
          log(`Invalid --lora value: ${options.lora}. Valid options: ${validLoraModels.join(', ')}`, 'error');
          process.exit(1);
        }
        break;
      }
      case '--queue':
        options.queue = true;
        options.force = true;  // Queue mode implies --force since icons are marked for regen
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
Icon Generation Script
Generates UI icons using local ComfyUI (default) or HuggingFace API.
Icons are generated at 128x128 source size for better quality, then downscaled to 64x64.

Usage:
  node scripts/ai-images/generate-icons.js [options]

Options:
  --dry-run           Show what would be generated without calling APIs
  --key <id>          Generate specific icon (e.g., action_attack)
  --category <cat>    Filter by category (actions, status, menu, augments)
  --force             Regenerate even if file exists
  --backup            Create backup of existing files before regenerating
  --huggingface, --hf Use HuggingFace API instead of local ComfyUI
  --local             Use local ComfyUI (default, explicit flag optional)
  --verbose, -v       Show detailed output including full prompt construction
  --quiet, -q         Suppress all output except errors
  --delay <ms>        Delay between requests in milliseconds (default: 2000)
  --lora <model>      LoRA model override:
                        v1 - Flat 2D style (GRPZA trigger) [default for icons]
                        v2 - Textured/isometric style (wbgmsst trigger)
                        modern-pixel - Modern pixel art
                        retro-pixel - Classic 8-bit pixel art
  --help, -h          Show this help message

Environment variables:
  IMAGE_GENERATOR_ROOT   Path to image-generator project (required)
  HUGGINGFACE_API_TOKEN  Required only for --huggingface mode

Examples:
  node scripts/ai-images/generate-icons.js --dry-run
  node scripts/ai-images/generate-icons.js --category actions
  node scripts/ai-images/generate-icons.js --key action_attack --force
  node scripts/ai-images/generate-icons.js --huggingface --category menu  # Use HF API
`);
}

/**
 * Get the output path for an icon
 */
function getOutputPath(icon) {
  return path.join(OUTPUT_DIR, icon._iconCategory, `${icon.id}.png`);
}

/**
 * Check if an icon needs generation
 */
function needsGeneration(icon, options) {
  if (options.force) return true;
  if (icon.generated) return false;
  return !fileExists(getOutputPath(icon));
}

/**
 * Filter icons based on CLI options
 */
function filterIcons(icons, options) {
  let filtered = icons;

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

  // Auto-enable verbose for dry-run to show all generation details
  if (options.dryRun && !options.verbose) {
    options.verbose = true;
    log('Verbose mode auto-enabled for dry-run', 'debug');
  }

  validateEnvVars(options);

  log('Icon Generation Script', 'info');
  log('======================', 'info');

  // Load metadata - either from queue or full metadata
  let metadata;
  let iconsToGenerate;

  if (options.queue) {
    // Queue mode: load only icons marked for regeneration
    log('Queue mode: loading icons marked for regeneration', 'info');
    try {
      const queuedIcons = loadRegenerationQueue('icons');
      log(`Found ${queuedIcons.length} icons in regeneration queue`, 'info');

      metadata = {
        icons: queuedIcons
      };

      iconsToGenerate = queuedIcons;
    } catch (error) {
      log(`Failed to load regeneration queue: ${error.message}`, 'error');
      process.exit(1);
    }
  } else {
    // Standard mode: load all icons and filter
    try {
      metadata = loadIconMetadata(options.category);
      log(`Loaded ${metadata.icons.length} icons`, 'info');
    } catch (error) {
      log(`Failed to load metadata: ${error.message}`, 'error');
      process.exit(1);
    }

    // Filter icons
    const filteredIcons = filterIcons(metadata.icons, options);
    log(`Filtered to ${filteredIcons.length} icons`, 'info');

    // Determine which need generation
    iconsToGenerate = filteredIcons.filter(i =>
      needsGeneration(i, options)
    );
    const skipped = filteredIcons.length - iconsToGenerate.length;

    if (skipped > 0) {
      log(`Skipping ${skipped} icons (already exist or generated)`, 'info');
    }
  }

  if (iconsToGenerate.length === 0) {
    log('No icons need generation', 'success');
    process.exit(0);
  }

  log(`\nIcons to generate: ${iconsToGenerate.length}`, 'info');
  console.log('');

  // Display what will be generated
  for (const icon of iconsToGenerate) {
    const prompt = buildThemedPrompt('icons', icon.prompt, {
      iconCategory: icon._iconCategory,
      skipTrigger: true  // Python script adds trigger word
    });

    console.log(`  - ${icon.id}`);
    console.log(`    Category: ${icon._iconCategory}`);
    console.log(`    Output: ${getOutputPath(icon)}`);
    if (options.dryRun) {
      console.log(`    Prompt: ${prompt}`);
    }
    console.log('');
  }

  // Dry run - just display
  if (options.dryRun) {
    log(`\nDry run complete. Would generate ${iconsToGenerate.length} icons.`, 'success');
    process.exit(0);
  }

  // Create backup if requested
  if (options.backup) {
    log('Creating backup of existing files...', 'info');
    const backupResult = createBackup(iconsToGenerate, { reason: 'category regeneration' });
    if (backupResult.success) {
      log(`Backup created: ${backupResult.backupDir}`, 'success');
      log(`Backed up ${backupResult.assetCount} assets`, 'info');
    } else {
      log(`Backup failed: ${backupResult.error}`, 'warn');
    }
  }

  // Ensure output directories exist
  for (const cat of ['actions', 'status', 'menu', 'augments']) {
    ensureDirectoryExists(path.join(OUTPUT_DIR, cat));
  }

  // Generate icons
  const results = {
    success: [],
    failed: []
  };

  log('\nStarting generation...', 'info');
  console.log('');

  for (let i = 0; i < iconsToGenerate.length; i++) {
    const icon = iconsToGenerate[i];

    log(`[${i + 1}/${iconsToGenerate.length}] Generating: ${icon.id}`, 'info');

    try {
      // Determine LoRA model: CLI override > asset-level > category default
      const effectiveLoraModel = options.lora || getEffectiveLoraModel(icon, 'icons');
      const result = await generateIcon({
        prompt: icon.prompt,
        key: icon.id,
        category: icon._iconCategory,
        seed: icon.seed,
        loraModel: effectiveLoraModel
      }, {
        verbose: options.verbose,
        quiet: options.quiet,
        local: options.local,
        huggingface: options.huggingface
      });

      if (result.success) {
        results.success.push({ id: icon.id, icon });

        icon._category = 'icons';
        markAssetGenerated(icon);

        // Clear regeneration marker if in queue mode
        if (options.queue && icon.needsRegeneration) {
          clearRegenerationMarker(icon);
        }

        log(`Generated: ${icon.id}`, 'success');
      } else {
        results.failed.push({
          id: icon.id,
          error: result.stderr || 'Unknown error'
        });
        log(`Failed: ${icon.id}`, 'error');
      }

      // Rate limit delay
      if (i < iconsToGenerate.length - 1 && options.delay > 0) {
        await delay(options.delay);
      }
    } catch (error) {
      log(`Failed to generate ${icon.id}: ${error.message}`, 'error');
      results.failed.push({ id: icon.id, error: error.message });
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
    log('Failed icons:', 'error');
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
