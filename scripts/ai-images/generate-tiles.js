#!/usr/bin/env node
/**
 * Tile Generation Script
 * Generates isometric terrain tiles using local ComfyUI (default) or HuggingFace API
 *
 * Usage:
 *   node scripts/ai-images/generate-tiles.js                    # Generate using local ComfyUI
 *   node scripts/ai-images/generate-tiles.js --huggingface      # Use HuggingFace API instead
 *   node scripts/ai-images/generate-tiles.js --dry-run          # Preview without generating
 *   node scripts/ai-images/generate-tiles.js --key forest_grass_1  # Generate specific tile
 *   node scripts/ai-images/generate-tiles.js --biome forest     # Generate tiles for biome
 *   node scripts/ai-images/generate-tiles.js --force            # Regenerate even if exists
 *
 * Environment variables:
 *   HUGGINGFACE_API_TOKEN - Required for --huggingface mode
 *   IMAGE_GENERATOR_ROOT - Path to image-generator project (required)
 */

const path = require('path');
const {
  loadTileMetadata,
  markAssetGenerated,
  generateTile,
  log,
  fileExists,
  delay,
  ensureDirectoryExists,
  getProjectRoot,
  buildTilePrompt,
  createBackup
} = require('./lib');

// Configuration
const PROJECT_ROOT = getProjectRoot();
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/sprites/terrain');

/**
 * Parse command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    key: null,
    biome: null,
    category: null,  // floors, walls, slopes
    force: false,
    local: true,     // Local ComfyUI is now the default
    huggingface: false,
    backup: false,
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
      case '--biome':
        options.biome = args[++i];
        break;
      case '--category':
        options.category = args[++i];
        break;
      case '--force':
        options.force = true;
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
      case '--backup':
        options.backup = true;
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
Tile Generation Script
Generates isometric terrain tiles using local ComfyUI (default) or HuggingFace API

Usage:
  node scripts/ai-images/generate-tiles.js [options]

Options:
  --dry-run           Show what would be generated without calling APIs
  --key <id>          Generate specific tile by key (e.g., forest_grass_1)
  --biome <name>      Generate only for specific biome (forest, cave, mountain, bridge, castle)
  --category <type>   Generate only specific category (floors, walls, slopes)
  --force             Regenerate even if file exists
  --backup            Backup existing files before regeneration
  --huggingface, --hf Use HuggingFace API instead of local ComfyUI
  --local             Use local ComfyUI (default, explicit flag optional)
  --help, -h          Show this help message

Environment variables:
  IMAGE_GENERATOR_ROOT   Path to image-generator project (required)
  HUGGINGFACE_API_TOKEN  Required only for --huggingface mode

Examples:
  node scripts/ai-images/generate-tiles.js --dry-run
  node scripts/ai-images/generate-tiles.js --biome forest
  node scripts/ai-images/generate-tiles.js --category walls
  node scripts/ai-images/generate-tiles.js --category slopes --biome mountain
  node scripts/ai-images/generate-tiles.js --key forest_grass_1 --force
  node scripts/ai-images/generate-tiles.js --huggingface --biome cave  # Use HF API
`);
}

/**
 * Get the output path for a tile
 * @param {Object} tile - Tile metadata
 * @param {string} biome - Biome name
 * @param {number} variantIndex - Variant index (0 for first/only)
 * @returns {string} Full file system path
 */
function getOutputPath(tile, biome, variantIndex = 0) {
  // Build filename - only append variantIndex if tile has multiple variants
  // If tile.variants <= 1, the key already contains the variant (e.g., grass_0)
  const numVariants = tile.variants || 1;
  const filename = numVariants > 1
    ? `${tile.id}_${variantIndex}.png`
    : `${tile.id}.png`;

  // Handle outputPath from tile metadata
  if (tile.outputPath) {
    return path.join(OUTPUT_DIR, tile.outputPath, filename);
  }

  // Default based on category
  const category = tile._tileCategory || 'floors';
  if (category === 'walls') {
    return path.join(OUTPUT_DIR, biome, 'walls', filename);
  }
  if (category === 'slopes') {
    return path.join(OUTPUT_DIR, biome, 'slopes', filename);
  }
  return path.join(OUTPUT_DIR, biome, filename);
}

/**
 * Check if a tile needs generation
 * @param {Object} tile - Tile metadata
 * @param {string} biome - Biome name
 * @param {Object} options - CLI options
 * @returns {boolean} True if tile should be generated
 */
function needsGeneration(tile, biome, options) {
  if (options.force) {
    return true;
  }

  if (tile.generated) {
    return false;
  }

  // Check if all variants exist
  for (let i = 0; i < (tile.variants || 1); i++) {
    const outputPath = getOutputPath(tile, biome, i);
    if (!fileExists(outputPath)) {
      return true;
    }
  }

  return false;
}

/**
 * Filter tiles based on CLI options
 * @param {Array} tiles - All tiles
 * @param {Object} options - CLI options
 * @returns {Array} Filtered tiles
 */
function filterTiles(tiles, options) {
  let filtered = tiles;

  if (options.key) {
    filtered = filtered.filter(t => t.id === options.key || t.key === options.key);
  }

  if (options.biome) {
    filtered = filtered.filter(t => t._biome === options.biome);
  }

  if (options.category) {
    filtered = filtered.filter(t => t._tileCategory === options.category);
  }

  return filtered;
}

/**
 * Validate required environment variables
 * @param {Object} options - CLI options
 */
function validateEnvVars(options) {
  if (options.dryRun) {
    return;
  }

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

  log('Tile Generation Script', 'info');
  log('======================', 'info');

  // Load metadata
  let metadata;
  try {
    metadata = loadTileMetadata({ biome: options.biome, category: options.category });
    log(`Loaded ${metadata.tiles.length} total tiles`, 'info');
  } catch (error) {
    log(`Failed to load metadata: ${error.message}`, 'error');
    process.exit(1);
  }

  // Filter tiles
  const filteredTiles = filterTiles(metadata.tiles, options);
  log(`Filtered to ${filteredTiles.length} tiles`, 'info');

  // Determine which tiles need generation
  const tilesToGenerate = filteredTiles.filter(t =>
    needsGeneration(t, t._biome, options)
  );
  const skippedTiles = filteredTiles.length - tilesToGenerate.length;

  if (skippedTiles > 0) {
    log(`Skipping ${skippedTiles} tiles (already exist or generated)`, 'info');
  }

  if (tilesToGenerate.length === 0) {
    log('No tiles need generation', 'success');
    process.exit(0);
  }

  log(`\nTiles to generate: ${tilesToGenerate.length}`, 'info');
  console.log('');

  // Display what will be generated
  for (const tile of tilesToGenerate) {
    const biomeData = metadata.byBiome[tile._biome];
    const prompt = buildTilePrompt(tile, biomeData);

    console.log(`  - ${tile.id}`);
    console.log(`    Biome: ${tile._biome}`);
    console.log(`    Variants: ${tile.variants || 1}`);
    console.log(`    Output: ${getOutputPath(tile, tile._biome)}`);
    if (options.dryRun) {
      console.log(`    Prompt: ${prompt}`);
    }
    console.log('');
  }

  // Dry run - just display
  if (options.dryRun) {
    log(`\nDry run complete. Would generate ${tilesToGenerate.length} tiles.`, 'success');
    process.exit(0);
  }

  // Create backup if requested
  if (options.backup) {
    log('Creating backup of existing files...', 'info');
    const backupResult = createBackup(tilesToGenerate, { reason: 'category regeneration' });
    if (backupResult.success) {
      log(`Backup created: ${backupResult.backupDir}`, 'success');
      log(`Backed up ${backupResult.assetCount} assets`, 'info');
    } else {
      log(`Backup failed: ${backupResult.error}`, 'warn');
    }
  }

  // Ensure output directories exist
  for (const biome of Object.keys(metadata.byBiome)) {
    ensureDirectoryExists(path.join(OUTPUT_DIR, biome));
    ensureDirectoryExists(path.join(OUTPUT_DIR, biome, 'walls'));
    ensureDirectoryExists(path.join(OUTPUT_DIR, biome, 'slopes'));
  }

  // Generate tiles
  const results = {
    success: [],
    failed: []
  };

  log('\nStarting generation...', 'info');
  console.log('');

  for (let i = 0; i < tilesToGenerate.length; i++) {
    const tile = tilesToGenerate[i];
    const biomeData = metadata.byBiome[tile._biome];

    log(`[${i + 1}/${tilesToGenerate.length}] Generating: ${tile.id}`, 'info');

    try {
      const result = await generateTile({
        prompt: tile.prompt,
        key: tile.id,
        biome: tile._biome,
        seed: tile.seed,
        variants: tile.variants || 1
      }, { verbose: true, local: options.local });

      if (result.success) {
        results.success.push({
          id: tile.id,
          biome: tile._biome,
          tile
        });

        // Update metadata
        tile._category = 'tiles';
        markAssetGenerated(tile);

        log(`Generated: ${tile.id}`, 'success');
      } else {
        results.failed.push({
          id: tile.id,
          biome: tile._biome,
          error: result.stderr || 'Unknown error'
        });
        log(`Failed: ${tile.id}`, 'error');
      }

      // Rate limit delay between requests
      if (i < tilesToGenerate.length - 1) {
        await delay(2000);
      }
    } catch (error) {
      log(`Failed to generate ${tile.id}: ${error.message}`, 'error');
      results.failed.push({
        id: tile.id,
        biome: tile._biome,
        error: error.message
      });
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
    log('Failed tiles:', 'error');
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
