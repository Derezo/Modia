#!/usr/bin/env node
/**
 * Obstacle Generation Script
 * Generates environment obstacles (rocks, trees, etc.) using local ComfyUI (default) or HuggingFace API.
 * Obstacles are generated at 1024x1024 source size, processed with background removal, then resized.
 *
 * Usage:
 *   node scripts/ai-images/generate-obstacles.js                    # Generate using local ComfyUI
 *   node scripts/ai-images/generate-obstacles.js --huggingface      # Use HuggingFace API instead
 *   node scripts/ai-images/generate-obstacles.js --dry-run          # Preview
 *   node scripts/ai-images/generate-obstacles.js --key rock_small   # Generate specific
 *   node scripts/ai-images/generate-obstacles.js --category rocks   # Filter by category
 *   node scripts/ai-images/generate-obstacles.js --force            # Regenerate existing
 *
 * Environment variables:
 *   HUGGINGFACE_API_TOKEN - Required only for --huggingface mode
 *   IMAGE_GENERATOR_ROOT - Path to image-generator project (required)
 */

const path = require('path');
const {
  loadObstacleMetadata,
  markAssetGenerated,
  generateObstacle,
  log,
  fileExists,
  delay,
  ensureDirectoryExists,
  getProjectRoot,
  buildThemedPrompt,
  createBackup,
  checkImageMagick,
  getEffectiveLoraModel,
  loadRegenerationQueue,
  clearRegenerationMarker,
  parseBaseArgs,
  applyKeyFilter,
  loadCategoryManifest,
  resizeImageNonSquare
} = require('./lib');

// Configuration
const PROJECT_ROOT = getProjectRoot();
// Obstacles output path - matches AssetLoader.loadObstacle() expectation: /assets/obstacles/{category}/{id}.png
const OUTPUT_BASE_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/obstacles');

/**
 * Parse command line arguments
 */
function parseArgs() {
  return parseBaseArgs(process.argv.slice(2), {
    extraFlags: {
      category: { flag: '--category', type: 'string', default: null },
      biome: { flag: '--biome', type: 'string', default: 'default' }
    }
  });
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
Obstacle Generation Script
Generates environment obstacles using local ComfyUI (default) or HuggingFace API.
Obstacles are generated at 1024x1024 source size, processed, then resized to target dimensions.

Usage:
  node scripts/ai-images/generate-obstacles.js [options]

Options:
  --dry-run           Show what would be generated without calling APIs
  --key <id>          Generate specific obstacle(s) (repeatable: --key a --key b)
  --category <cat>    Filter by category (rocks, trees)
  --biome <name>      Biome context for generation (default: default)
  --force             Regenerate even if file exists
  --backup            Create backup of existing files before regenerating
  --huggingface, --hf Use HuggingFace API instead of local ComfyUI
  --local             Use local ComfyUI (default, explicit flag optional)
  --verbose, -v       Show detailed output including full prompt construction
  --quiet, -q         Suppress all output except errors
  --delay <ms>        Delay between requests in milliseconds (default: 2000)
  --lora <model>      LoRA model override:
                        v1 - Flat 2D style (GRPZA trigger)
                        v2 - Textured/isometric style (wbgmsst trigger) [default for obstacles]
                        modern-pixel - Modern pixel art
                        retro-pixel - Classic 8-bit pixel art
  --help, -h          Show this help message

Environment variables:
  IMAGE_GENERATOR_ROOT   Path to image-generator project (required)
  HUGGINGFACE_API_TOKEN  Required only for --huggingface mode

Examples:
  node scripts/ai-images/generate-obstacles.js --dry-run
  node scripts/ai-images/generate-obstacles.js --category rocks
  node scripts/ai-images/generate-obstacles.js --key rock_small --force
  node scripts/ai-images/generate-obstacles.js --huggingface --category trees
`);
}

/**
 * Get the output path for an obstacle
 * Path: /assets/obstacles/{category}/{id}.png
 * Matches AssetLoader.loadObstacle() expectation
 */
function getOutputPath(obstacle) {
  const category = obstacle._obstacleCategory;
  return path.join(OUTPUT_BASE_DIR, category, `${obstacle.id}.png`);
}

/**
 * Check if an obstacle needs generation
 */
function needsGeneration(obstacle, options) {
  if (options.force) return true;
  if (obstacle.generated) return false;
  return !fileExists(getOutputPath(obstacle));
}

/**
 * Filter obstacles based on CLI options
 */
function filterObstacles(obstacles, options) {
  let filtered = applyKeyFilter(obstacles, options.keys);
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
 * Resize obstacle to target dimensions
 */
async function resizeObstacle(sourcePath, targetPath, dimensions, options = {}) {
  const { width, height } = dimensions;

  // Ensure target directory exists
  ensureDirectoryExists(path.dirname(targetPath));

  // Use non-square resize utility
  const result = await resizeImageNonSquare(sourcePath, targetPath, width, height);

  if (options.verbose && result) {
    log(`  Resized to ${width}x${height}: ${targetPath}`, 'info');
  }

  return result;
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

  log('Obstacle Generation Script', 'info');
  log('==========================', 'info');

  // Load metadata - either from queue or full metadata
  let metadata;
  let obstaclesToGenerate;

  if (options.queue) {
    // Queue mode: load only obstacles marked for regeneration
    log('Queue mode: loading obstacles marked for regeneration', 'info');
    try {
      const queuedObstacles = loadRegenerationQueue('obstacles');
      log(`Found ${queuedObstacles.length} obstacles in regeneration queue`, 'info');

      metadata = {
        obstacles: queuedObstacles
      };

      obstaclesToGenerate = queuedObstacles;
    } catch (error) {
      log(`Failed to load regeneration queue: ${error.message}`, 'error');
      process.exit(1);
    }
  } else {
    // Standard mode: load all obstacles and filter
    try {
      metadata = loadObstacleMetadata(options.category);
      log(`Loaded ${metadata.obstacles.length} obstacles`, 'info');
    } catch (error) {
      log(`Failed to load metadata: ${error.message}`, 'error');
      process.exit(1);
    }

    // Filter obstacles
    const filteredObstacles = filterObstacles(metadata.obstacles, options);
    log(`Filtered to ${filteredObstacles.length} obstacles`, 'info');

    // Determine which need generation
    obstaclesToGenerate = filteredObstacles.filter(o =>
      needsGeneration(o, options)
    );
    const skipped = filteredObstacles.length - obstaclesToGenerate.length;

    if (skipped > 0) {
      log(`Skipping ${skipped} obstacles (already exist or generated)`, 'info');
    }
  }

  if (obstaclesToGenerate.length === 0) {
    log('No obstacles need generation', 'success');
    process.exit(0);
  }

  log(`\nObstacles to generate: ${obstaclesToGenerate.length}`, 'info');
  console.log('');

  const biome = options.biome || 'default';

  // Display what will be generated
  for (const obstacle of obstaclesToGenerate) {
    const prompt = buildThemedPrompt('obstacles', obstacle.prompt, {
      obstacleCategory: obstacle._obstacleCategory,
      skipTrigger: true  // Python script adds trigger word
    });

    console.log(`  - ${obstacle.id}`);
    console.log(`    Category: ${obstacle._obstacleCategory}`);
    console.log(`    Dimensions: ${obstacle.dimensions.width}x${obstacle.dimensions.height}`);
    console.log(`    Output: ${getOutputPath(obstacle)}`);
    if (options.dryRun) {
      console.log(`    Prompt: ${prompt}`);
    }
    console.log('');
  }

  // Dry run - just display
  if (options.dryRun) {
    log(`\nDry run complete. Would generate ${obstaclesToGenerate.length} obstacles.`, 'success');
    process.exit(0);
  }

  // Create backup if requested
  if (options.backup) {
    log('Creating backup of existing files...', 'info');
    const backupResult = createBackup(obstaclesToGenerate, { reason: 'category regeneration' });
    if (backupResult.success) {
      log(`Backup created: ${backupResult.backupDir}`, 'success');
      log(`Backed up ${backupResult.assetCount} assets`, 'info');
    } else {
      log(`Backup failed: ${backupResult.error}`, 'warn');
    }
  }

  // Ensure output directories exist (read categories from manifest)
  const manifest = loadCategoryManifest('obstacles');
  const categories = manifest.categories || Object.keys(manifest.categoryFiles || {});
  for (const cat of categories) {
    ensureDirectoryExists(path.join(OUTPUT_BASE_DIR, cat));
  }

  // Generate obstacles
  const results = {
    success: [],
    failed: []
  };

  log('\nStarting generation...', 'info');
  console.log('');

  for (let i = 0; i < obstaclesToGenerate.length; i++) {
    const obstacle = obstaclesToGenerate[i];

    log(`[${i + 1}/${obstaclesToGenerate.length}] Generating: ${obstacle.id}`, 'info');

    try {
      // Determine LoRA model: CLI override > asset-level > category default
      const effectiveLoraModel = options.lora || getEffectiveLoraModel(obstacle, 'obstacles');

      const result = await generateObstacle({
        prompt: obstacle.prompt,
        key: obstacle.id,
        category: obstacle._obstacleCategory,
        biome: biome,
        seed: obstacle.seed,
        loraModel: effectiveLoraModel
      }, {
        verbose: options.verbose,
        quiet: options.quiet,
        local: options.local,
        huggingface: options.huggingface
      });

      if (result.success) {
        results.success.push({ id: obstacle.id, obstacle });

        obstacle._category = 'obstacles';
        markAssetGenerated(obstacle);

        // Clear regeneration marker if in queue mode
        if (options.queue && obstacle.needsRegeneration) {
          clearRegenerationMarker(obstacle);
        }

        log(`Generated: ${obstacle.id}`, 'success');
        log(`Saved: ${getOutputPath(obstacle)}`, 'info');

        // Post-process: resize to target dimensions if ImageMagick available
        if (checkImageMagick() && obstacle.dimensions) {
          const outputPath = getOutputPath(obstacle);

          // The Python script saves to the originals path
          // We need to resize from there to the final output
          // For now, the Python script handles the initial save
          // Additional size variants can be generated here if needed

          if (options.verbose) {
            log(`  Target dimensions: ${obstacle.dimensions.width}x${obstacle.dimensions.height}`, 'info');
          }
        }
      } else {
        results.failed.push({
          id: obstacle.id,
          error: result.stderr || 'Unknown error'
        });
        log(`Failed: ${obstacle.id}`, 'error');
      }

      // Rate limit delay
      if (i < obstaclesToGenerate.length - 1 && options.delay > 0) {
        await delay(options.delay);
      }
    } catch (error) {
      log(`Failed to generate ${obstacle.id}: ${error.message}`, 'error');
      results.failed.push({ id: obstacle.id, error: error.message });
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
    log('Failed obstacles:', 'error');
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
