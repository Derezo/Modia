#!/usr/bin/env node
/**
 * Portrait Generation Script
 * Generates character portraits using local ComfyUI (default) or HuggingFace API
 *
 * Usage:
 *   node scripts/ai-images/generate-portraits.js                       # Generate using local ComfyUI
 *   node scripts/ai-images/generate-portraits.js --huggingface         # Use HuggingFace API instead
 *   node scripts/ai-images/generate-portraits.js --dry-run             # Preview without generating
 *   node scripts/ai-images/generate-portraits.js --key human_male_warrior  # Generate specific
 *   node scripts/ai-images/generate-portraits.js --race elf            # Filter by race
 *   node scripts/ai-images/generate-portraits.js --class wizard        # Filter by class
 *   node scripts/ai-images/generate-portraits.js --force               # Regenerate existing
 *
 * Environment variables:
 *   HUGGINGFACE_API_TOKEN - Required only for --huggingface mode
 *   IMAGE_GENERATOR_ROOT - Path to image-generator project (required)
 */

const path = require('path');
const {
  loadPortraitMetadata,
  markAssetGenerated,
  generatePortrait,
  log,
  fileExists,
  delay,
  ensureDirectoryExists,
  getProjectRoot,
  buildThemedPrompt,
  createBackup,
  postProcessPortrait,
  checkImageMagick
} = require('./lib');

// Configuration
const PROJECT_ROOT = getProjectRoot();
// New unified portraits directory - player and enemy portraits in same location
// Enemy portraits use 'enemy_' prefix in filename (e.g., enemy_goblin_warrior.png)
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/portraits/originals');
const ENEMY_OUTPUT_DIR = OUTPUT_DIR; // Same directory, enemy_ prefix distinguishes them
// For Python script's fallback_dir
const ENEMY_OUTPUT_BASE = path.join(PROJECT_ROOT, 'frontend/public/assets/portraits');

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    key: null,
    type: 'all',       // player, enemy, or all
    race: null,
    gender: null,
    class: null,
    advancedClass: null,
    archetype: null,   // enemy archetype filter
    region: null,      // enemy region filter
    force: false,
    backup: false,
    local: true,       // Local ComfyUI is now the default
    huggingface: false,
    verbose: false,
    quiet: false,
    delay: 2000,  // Default 2 second delay between requests
    lora: null,   // LoRA model override (v1, v2, modern-pixel, retro-pixel)
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
      case '--type':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          log('--type requires a value', 'error');
          process.exit(1);
        }
        options.type = args[++i];
        break;
      case '--race':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          log('--race requires a value', 'error');
          process.exit(1);
        }
        options.race = args[++i];
        break;
      case '--gender':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          log('--gender requires a value', 'error');
          process.exit(1);
        }
        options.gender = args[++i];
        break;
      case '--class':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          log('--class requires a value', 'error');
          process.exit(1);
        }
        options.class = args[++i];
        break;
      case '--advanced-class':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          log('--advanced-class requires a value', 'error');
          process.exit(1);
        }
        options.advancedClass = args[++i];
        break;
      case '--archetype':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          log('--archetype requires a value', 'error');
          process.exit(1);
        }
        options.archetype = args[++i];
        break;
      case '--region':
        if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
          log('--region requires a value', 'error');
          process.exit(1);
        }
        options.region = args[++i];
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
Portrait Generation Script
Generates character portraits using local ComfyUI (default) or HuggingFace API

Usage:
  node scripts/ai-images/generate-portraits.js [options]

Options:
  --dry-run              Show what would be generated without calling APIs
  --key <id>             Generate specific portrait (e.g., human_male_warrior, goblin_warrior)
  --type <type>          Filter by portrait type: player, enemy, or all (default: all)
  --race <race>          Filter player portraits by race (human, elf, dwarf, vampire, orc)
  --gender <gender>      Filter player portraits by gender (male, female, other)
  --class <class>        Filter player portraits by class (warrior, wizard, monk, chemist)
  --advanced-class <cls> Filter to specific advanced class (berserker, paladin, etc.)
  --archetype <type>     Filter enemy portraits by archetype (beast, humanoid, undead, elemental)
  --region <name>        Filter enemy portraits by region (forest, cave, mountain, bridge, palace)
  --force                Regenerate even if file exists
  --backup               Backup existing portraits before regeneration
  --huggingface, --hf    Use HuggingFace API instead of local ComfyUI
  --local                Use local ComfyUI (default, explicit flag optional)
  --verbose, -v          Show detailed output including full prompt construction
  --quiet, -q            Suppress all output except errors
  --delay <ms>           Delay between requests in milliseconds (default: 2000)
  --lora <model>         LoRA model override:
                           v1 - Flat 2D style (GRPZA trigger) [default for portraits]
                           v2 - Textured/isometric style (wbgmsst trigger)
                           modern-pixel - Modern pixel art
                           retro-pixel - Classic 8-bit pixel art
  --help, -h             Show this help message

Environment variables:
  IMAGE_GENERATOR_ROOT   Path to image-generator project (required)
  HUGGINGFACE_API_TOKEN  Required only for --huggingface mode

Examples:
  node scripts/ai-images/generate-portraits.js --dry-run
  node scripts/ai-images/generate-portraits.js --dry-run --type enemy
  node scripts/ai-images/generate-portraits.js --race elf --class wizard
  node scripts/ai-images/generate-portraits.js --advanced-class berserker
  node scripts/ai-images/generate-portraits.js --type enemy --archetype beast
  node scripts/ai-images/generate-portraits.js --key human_male_warrior --force
  node scripts/ai-images/generate-portraits.js --key goblin_warrior --type enemy
  node scripts/ai-images/generate-portraits.js --huggingface --race human  # Use HF API
`);
}

/**
 * Get the output path for a portrait
 * Enemy portraits use 'enemy_' prefix in filename
 */
function getOutputPath(portrait) {
  // All portraits go to same directory, enemy has prefix
  const filename = portrait._type === 'enemy'
    ? `enemy_${portrait.id}.png`
    : `${portrait.id}.png`;
  return path.join(OUTPUT_DIR, filename);
}

/**
 * Check if a portrait needs generation
 */
function needsGeneration(portrait, options) {
  if (options.force) return true;
  if (portrait.generated) return false;
  return !fileExists(getOutputPath(portrait));
}

/**
 * Filter portraits based on CLI options
 */
function filterPortraits(portraits, options) {
  let filtered = portraits;

  if (options.key) {
    filtered = filtered.filter(p => p.id === options.key);
  }

  // Note: race/gender/class filtering is handled by loadPortraitMetadata
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

  log('Portrait Generation Script', 'info');
  log('==========================', 'info');

  // Load metadata with filters
  let metadata;
  try {
    metadata = loadPortraitMetadata({
      type: options.type,
      race: options.race,
      gender: options.gender,
      class: options.class,
      advancedClass: options.advancedClass,
      archetype: options.archetype,
      region: options.region
    });
    log(`Loaded ${metadata.portraits.length} portraits (filtered)`, 'info');
  } catch (error) {
    log(`Failed to load metadata: ${error.message}`, 'error');
    process.exit(1);
  }

  // Filter portraits
  const filteredPortraits = filterPortraits(metadata.portraits, options);
  log(`Filtered to ${filteredPortraits.length} portraits`, 'info');

  // Determine which need generation
  const portraitsToGenerate = filteredPortraits.filter(p =>
    needsGeneration(p, options)
  );
  const skipped = filteredPortraits.length - portraitsToGenerate.length;

  if (skipped > 0) {
    log(`Skipping ${skipped} portraits (already exist or generated)`, 'info');
  }

  if (portraitsToGenerate.length === 0) {
    log('No portraits need generation', 'success');
    process.exit(0);
  }

  log(`\nPortraits to generate: ${portraitsToGenerate.length}`, 'info');
  console.log('');

  // Display what will be generated
  for (const portrait of portraitsToGenerate) {
    let basePrompt;

    if (portrait._type === 'enemy') {
      // Build prompt for enemy portrait
      const archetypeTraits = metadata.archetypeTraits[portrait.archetype] || portrait.archetype;
      const regionTraits = metadata.regionTraits[portrait.region] || portrait.region;
      const visualTraits = portrait.visualTraits || '';
      basePrompt = `${archetypeTraits} ${regionTraits} ${visualTraits} monster creature enemy`;
    } else {
      // Build prompt for player portrait
      const raceTraits = metadata.raceTraits[portrait.race] || portrait.race;
      const genderTraits = metadata.genderTraits[portrait.gender] || portrait.gender;
      // Use advancedClassTraits if available and is advanced class
      let classTraits;
      if (portrait.isAdvanced && metadata.advancedClassTraits[portrait.class]) {
        classTraits = metadata.advancedClassTraits[portrait.class];
      } else {
        classTraits = metadata.classTraits[portrait.class] || portrait.class;
      }
      basePrompt = `${raceTraits} ${genderTraits} ${classTraits}`;
    }

    const prompt = buildThemedPrompt('portraits', basePrompt, { skipTrigger: true });

    console.log(`  - ${portrait.id} [${portrait._type}]`);
    if (portrait._type === 'enemy') {
      console.log(`    Name: ${portrait.name}, Archetype: ${portrait.archetype}, Region: ${portrait.region}`);
    } else {
      console.log(`    Race: ${portrait.race}, Gender: ${portrait.gender}, Class: ${portrait.class}${portrait.isAdvanced ? ' (advanced)' : ''}`);
    }
    console.log(`    Output: ${getOutputPath(portrait)}`);
    if (options.dryRun) {
      console.log(`    Prompt: ${prompt}`);
    }
    console.log('');
  }

  // Dry run - just display
  if (options.dryRun) {
    log(`\nDry run complete. Would generate ${portraitsToGenerate.length} portraits.`, 'success');
    process.exit(0);
  }

  // Create backup if requested
  if (options.backup) {
    log('Creating backup of existing files...', 'info');
    const backupResult = createBackup(portraitsToGenerate, { reason: 'category regeneration' });
    if (backupResult.success) {
      log(`Backup created: ${backupResult.backupDir}`, 'success');
      log(`Backed up ${backupResult.assetCount} assets`, 'info');
    } else {
      log(`Backup failed: ${backupResult.error}`, 'warn');
    }
  }

  // Ensure output directories exist
  const hasPlayerPortraits = portraitsToGenerate.some(p => p._type !== 'enemy');
  const hasEnemyPortraits = portraitsToGenerate.some(p => p._type === 'enemy');
  if (hasPlayerPortraits) ensureDirectoryExists(OUTPUT_DIR);
  if (hasEnemyPortraits) ensureDirectoryExists(ENEMY_OUTPUT_DIR);

  // Generate portraits
  const results = {
    success: [],
    failed: []
  };

  log('\nStarting generation...', 'info');
  console.log('');

  for (let i = 0; i < portraitsToGenerate.length; i++) {
    const portrait = portraitsToGenerate[i];

    log(`[${i + 1}/${portraitsToGenerate.length}] Generating: ${portrait.id}`, 'info');

    try {
      let result;

      if (portrait._type === 'enemy') {
        // Build prompt for enemy portrait
        const archetypeTraits = metadata.archetypeTraits[portrait.archetype] || portrait.archetype;
        const regionTraits = metadata.regionTraits[portrait.region] || portrait.region;
        const visualTraits = portrait.visualTraits || '';
        const enemyPrompt = `${visualTraits} ${archetypeTraits} ${regionTraits} monster creature`;

        // Generate enemy portrait using prompt/key mode with custom output dir
        // Note: Python script adds 'portraits/' to the fallback_dir, so we use ENEMY_OUTPUT_BASE
        result = await generatePortrait({
          prompt: enemyPrompt,
          key: portrait.id,
          seed: portrait.seed,
          outputDir: ENEMY_OUTPUT_BASE,
          isEnemy: true,
          loraModel: options.lora
        }, {
          verbose: options.verbose,
          quiet: options.quiet,
          local: options.local,
          huggingface: options.huggingface
        });
      } else if (portrait.isAdvanced) {
        // Generate advanced class portrait using prompt/key mode
        // (Python script only validates base classes: warrior, wizard, monk, chemist)
        const raceTraits = metadata.raceTraits[portrait.race] || portrait.race;
        const genderTraits = metadata.genderTraits[portrait.gender] || portrait.gender;
        const classTraits = metadata.advancedClassTraits[portrait.class] || portrait.class;
        const advancedPrompt = `${raceTraits} ${genderTraits} ${classTraits}`;

        result = await generatePortrait({
          prompt: advancedPrompt,
          key: portrait.id,
          seed: portrait.seed,
          isAdvanced: true,
          loraModel: options.lora
        }, {
          verbose: options.verbose,
          quiet: options.quiet,
          local: options.local,
          huggingface: options.huggingface
        });
      } else {
        // Generate base class player portrait using race/gender/class mode
        result = await generatePortrait({
          race: portrait.race,
          gender: portrait.gender,
          characterClass: portrait.class,
          seed: portrait.seed,
          loraModel: options.lora
        }, {
          verbose: options.verbose,
          quiet: options.quiet,
          local: options.local,
          huggingface: options.huggingface
        });
      }

      if (result.success) {
        results.success.push({ id: portrait.id, portrait });

        portrait._category = 'portraits';
        // _sourceFile is already set by loadPortraitMetadata
        markAssetGenerated(portrait);

        log(`Generated: ${portrait.id}`, 'success');

        // Post-process to generate size variants
        if (checkImageMagick()) {
          const outputPath = getOutputPath(portrait);
          const postResult = await postProcessPortrait(outputPath, {
            force: options.force,
            verbose: options.verbose
          });
          if (postResult.success) {
            if (options.verbose && postResult.variants.length > 1) {
              log(`  Size variants: ${postResult.variants.length} (source: ${postResult.sourceSize}px)`, 'info');
            }
          } else if (options.verbose) {
            log(`  Warning: Post-processing failed for ${portrait.id}`, 'warn');
          }
        }
      } else {
        results.failed.push({
          id: portrait.id,
          error: result.stderr || 'Unknown error'
        });
        log(`Failed: ${portrait.id}`, 'error');
      }

      // Rate limit delay
      if (i < portraitsToGenerate.length - 1 && options.delay > 0) {
        await delay(options.delay);
      }
    } catch (error) {
      log(`Failed to generate ${portrait.id}: ${error.message}`, 'error');
      results.failed.push({ id: portrait.id, error: error.message });
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
    log('Failed portraits:', 'error');
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
