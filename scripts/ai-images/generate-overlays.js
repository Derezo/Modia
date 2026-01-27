#!/usr/bin/env node
/**
 * Overlay Sprite Generation Script
 * Generates rarity and augment overlay sprites using local ComfyUI (default) or HuggingFace API
 *
 * Usage:
 *   node scripts/ai-images/generate-overlays.js                    # Generate all overlays using local ComfyUI
 *   node scripts/ai-images/generate-overlays.js --huggingface      # Use HuggingFace API instead
 *   node scripts/ai-images/generate-overlays.js --dry-run          # Preview
 *   node scripts/ai-images/generate-overlays.js --key augment_fire # Generate specific overlay
 *   node scripts/ai-images/generate-overlays.js --rarity           # Generate rarity overlays only
 *   node scripts/ai-images/generate-overlays.js --augments         # Generate augment overlays only
 *   node scripts/ai-images/generate-overlays.js --force            # Regenerate existing
 *
 * Environment variables:
 *   HUGGINGFACE_API_TOKEN - Required only for --huggingface mode
 *   IMAGE_GENERATOR_ROOT - Path to image-generator project (required)
 */

const path = require('path');
const {
  loadOverlayMetadata,
  markAssetGenerated,
  generateOverlay,
  log,
  fileExists,
  delay,
  ensureDirectoryExists,
  getProjectRoot,
  buildThemedPrompt,
  createBackup,
  generateCanonicalSizeVariants,
  checkImageMagick,
  getEffectiveLoraModel,
  parseBaseArgs,
  applyKeyFilter
} = require('./lib');

// Configuration
const PROJECT_ROOT = getProjectRoot();
// New overlays path with originals directory and size in path
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/overlays/originals');

/**
 * Parse command line arguments
 */
function parseArgs() {
  return parseBaseArgs(process.argv.slice(2), {
    extraFlags: {
      rarity:   { flag: '--rarity',   type: 'boolean', default: false },
      augments: { flag: '--augments', type: 'boolean', default: false },
      sizes:    { flag: '--sizes',    type: 'boolean', default: false }
    },
    noQueue: true
  });
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
Overlay Sprite Generation Script
Generates rarity and augment overlay sprites using local ComfyUI (default) or HuggingFace API

Usage:
  node scripts/ai-images/generate-overlays.js [options]

Options:
  --dry-run           Show what would be generated without calling APIs
  --key <id>          Generate specific overlay (repeatable, e.g., --key rarity_uncommon --key augment_fire)
  --rarity            Generate only rarity overlays
  --augments          Generate only augment overlays
  --force             Regenerate even if file exists
  --backup            Backup existing images before regenerating
  --huggingface, --hf Use HuggingFace API instead of local ComfyUI
  --local             Use local ComfyUI (default, explicit flag optional)
  --verbose, -v       Show detailed output including full prompt construction
  --quiet, -q         Suppress all output except errors
  --delay <ms>        Delay between requests in milliseconds (default: 2000)
  --sizes             Generate size variants (32, 48, 64) after generation
  --lora <model>      LoRA model override:
                        v1 - Flat 2D style (GRPZA trigger)
                        v2 - Textured/isometric style (wbgmsst trigger) [default]
                        modern-pixel - Modern pixel art
                        retro-pixel - Classic 8-bit pixel art
  --help, -h          Show this help message

Environment variables:
  IMAGE_GENERATOR_ROOT   Path to image-generator project (required)
  HUGGINGFACE_API_TOKEN  Required only for --huggingface mode

Examples:
  node scripts/ai-images/generate-overlays.js --dry-run
  node scripts/ai-images/generate-overlays.js --rarity
  node scripts/ai-images/generate-overlays.js --augments --force
  node scripts/ai-images/generate-overlays.js --key augment_fire --force
  node scripts/ai-images/generate-overlays.js --huggingface --rarity  # Use HF API
`);
}

/**
 * Get the output path for an overlay
 */
function getOutputPath(overlay) {
  return path.join(OUTPUT_DIR, overlay._subcategory, `${overlay.id}.png`);
}

/**
 * Check if an overlay needs generation
 */
function needsGeneration(overlay, options) {
  if (options.force) return true;
  if (overlay.generated) return false;
  return !fileExists(getOutputPath(overlay));
}

/**
 * Filter overlays based on CLI options
 */
function filterOverlays(overlays, options) {
  let filtered = applyKeyFilter(overlays, options.keys);

  // Filter by subcategory if --rarity or --augments is specified
  if (options.rarity && !options.augments) {
    filtered = filtered.filter(o => o._subcategory === 'rarity');
  } else if (options.augments && !options.rarity) {
    filtered = filtered.filter(o => o._subcategory === 'augments');
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
 * Determine which subcategory to load based on options
 */
function getSubcategoryFilter(options) {
  if (options.rarity && !options.augments) {
    return 'rarity';
  } else if (options.augments && !options.rarity) {
    return 'augments';
  }
  return null; // Load all
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

  log('Overlay Sprite Generation Script', 'info');
  log('================================', 'info');

  // Load metadata
  let metadata;
  try {
    const subcategoryFilter = getSubcategoryFilter(options);
    metadata = loadOverlayMetadata(subcategoryFilter);
    log(`Loaded ${metadata.overlays.length} overlays`, 'info');
  } catch (error) {
    log(`Failed to load metadata: ${error.message}`, 'error');
    process.exit(1);
  }

  // Filter overlays
  const filteredOverlays = filterOverlays(metadata.overlays, options);
  log(`Filtered to ${filteredOverlays.length} overlays`, 'info');

  // Determine which need generation
  const overlaysToGenerate = filteredOverlays.filter(o =>
    needsGeneration(o, options)
  );
  const skipped = filteredOverlays.length - overlaysToGenerate.length;

  if (skipped > 0) {
    log(`Skipping ${skipped} overlays (already exist or generated)`, 'info');
  }

  if (overlaysToGenerate.length === 0) {
    log('No overlays need generation', 'success');
    process.exit(0);
  }

  log(`\nOverlays to generate: ${overlaysToGenerate.length}`, 'info');
  console.log('');

  // Display what will be generated
  for (const overlay of overlaysToGenerate) {
    const prompt = buildThemedPrompt('overlays', overlay.prompt, {
      subcategory: overlay._subcategory,
      skipTrigger: true  // Python script adds trigger word
    });

    console.log(`  - ${overlay.id}`);
    console.log(`    Name: ${overlay.name}`);
    console.log(`    Subcategory: ${overlay._subcategory}`);
    if (overlay.rarity) console.log(`    Rarity: ${overlay.rarity}`);
    if (overlay.element) console.log(`    Element: ${overlay.element}`);
    if (overlay.effect) console.log(`    Effect: ${overlay.effect}`);
    console.log(`    Alpha: ${overlay.alpha}`);
    console.log(`    Output: ${getOutputPath(overlay)}`);
    if (options.dryRun) {
      console.log(`    Prompt: ${prompt}`);
    }
    console.log('');
  }

  // Dry run - just display
  if (options.dryRun) {
    log(`\nDry run complete. Would generate ${overlaysToGenerate.length} overlays.`, 'success');
    process.exit(0);
  }

  // Create backup if requested
  if (options.backup) {
    log('Creating backup of existing files...', 'info');
    const backupResult = createBackup(overlaysToGenerate, { reason: 'overlay regeneration' });
    if (backupResult.success) {
      log(`Backup created: ${backupResult.backupDir}`, 'success');
      log(`Backed up ${backupResult.assetCount} assets`, 'info');
    } else {
      log(`Backup failed: ${backupResult.error}`, 'warn');
    }
  }

  // Ensure output directories exist
  ensureDirectoryExists(path.join(OUTPUT_DIR, 'rarity'));
  ensureDirectoryExists(path.join(OUTPUT_DIR, 'augments'));

  // Generate overlays
  const results = {
    success: [],
    failed: []
  };

  log('\nStarting generation...', 'info');
  console.log('');

  for (let i = 0; i < overlaysToGenerate.length; i++) {
    const overlay = overlaysToGenerate[i];

    log(`[${i + 1}/${overlaysToGenerate.length}] Generating: ${overlay.id}`, 'info');

    try {
      // Determine LoRA model: CLI override > asset-level > category default
      const effectiveLoraModel = options.lora || getEffectiveLoraModel(overlay, 'overlays');
      const result = await generateOverlay({
        prompt: overlay.prompt,
        key: overlay.id,
        subcategory: overlay._subcategory,
        seed: overlay.seed,
        loraModel: effectiveLoraModel
      }, {
        verbose: options.verbose,
        quiet: options.quiet,
        local: options.local,
        huggingface: options.huggingface
      });

      if (result.success) {
        results.success.push({ id: overlay.id, overlay });

        markAssetGenerated(overlay);

        log(`Generated: ${overlay.id}`, 'success');
        log(`Saved: ${getOutputPath(overlay)}`, 'info');

        // Always generate canonical size variants
        if (checkImageMagick()) {
          const outputPath = getOutputPath(overlay);
          const postResult = await generateCanonicalSizeVariants(
            outputPath,
            'overlays',
            overlay.id,
            {
              subcategory: overlay._subcategory,
              sizes: [32, 48, 64, 128],
              force: options.force,
              verbose: options.verbose
            }
          );

          if (postResult.success) {
            if (options.verbose && postResult.generated.length > 0) {
              log(`  Size variants: ${postResult.generated.length} generated`, 'info');
            }
          } else if (options.verbose) {
            log(`  Warning: Post-processing failed for ${overlay.id}`, 'warn');
            if (postResult.errors.length > 0) {
              for (const err of postResult.errors) {
                log(`    - ${err.size || 'unknown'}: ${err.error}`, 'warn');
              }
            }
          }
        }
      } else {
        results.failed.push({
          id: overlay.id,
          error: result.stderr || 'Unknown error'
        });
        log(`Failed: ${overlay.id}`, 'error');
      }

      // Rate limit delay
      if (i < overlaysToGenerate.length - 1 && options.delay > 0) {
        await delay(options.delay);
      }
    } catch (error) {
      log(`Failed to generate ${overlay.id}: ${error.message}`, 'error');
      results.failed.push({ id: overlay.id, error: error.message });
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
    log('Failed overlays:', 'error');
    for (const overlay of results.failed) {
      console.log(`  - ${overlay.id}: ${overlay.error}`);
    }
  }

  process.exit(results.failed.length > 0 ? 1 : 0);
}

main().catch(error => {
  log(`Unexpected error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
