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
  generateCanonicalSizeVariants,
  checkImageMagick,
  getEffectiveLoraModel,
  loadRegenerationQueue,
  clearRegenerationMarker,
  parseBaseArgs,
  applyKeyFilter
} = require('./lib');

// Configuration
const PROJECT_ROOT = getProjectRoot();
// New unified portraits directory - player and enemy portraits in same location
// Enemy portraits use 'enemy_' prefix in filename (e.g., enemy_goblin_warrior.png)
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/portraits/originals');
const ENEMY_OUTPUT_DIR = OUTPUT_DIR; // Same directory, enemy_ prefix distinguishes them
// For Python script's fallback_dir - note: Python output_manager adds 'portraits/' subdirectory
// So we pass the parent directory to avoid double 'portraits/portraits/'
const ENEMY_OUTPUT_BASE = path.join(PROJECT_ROOT, 'frontend/public/assets');

/**
 * Parse command line arguments
 */
function parseArgs() {
  return parseBaseArgs(process.argv.slice(2), {
    extraFlags: {
      type:          { flag: '--type',           type: 'string', default: 'all' },
      race:          { flag: '--race',           type: 'string', default: null },
      gender:        { flag: '--gender',         type: 'string', default: null },
      class:         { flag: '--class',          type: 'string', default: null },
      advancedClass: { flag: '--advanced-class', type: 'string', default: null },
      archetype:     { flag: '--archetype',      type: 'string', default: null },
      region:        { flag: '--region',         type: 'string', default: null }
    }
  });
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
  --key <id>             Generate specific portrait (repeatable, e.g., --key human_male_warrior --key goblin_warrior)
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
  let filtered = applyKeyFilter(portraits, options.keys);
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

  // Load metadata - either from queue or full metadata
  let metadata;
  let portraitsToGenerate;

  if (options.queue) {
    // Queue mode: load only portraits marked for regeneration
    log('Queue mode: loading portraits marked for regeneration', 'info');
    try {
      const queuedPortraits = loadRegenerationQueue('portraits');
      log(`Found ${queuedPortraits.length} portraits in regeneration queue`, 'info');

      metadata = {
        portraits: queuedPortraits,
        raceTraits: {},
        genderTraits: {},
        classTraits: {},
        advancedClassTraits: {},
        archetypeTraits: {},
        regionTraits: {}
      };

      portraitsToGenerate = queuedPortraits;
    } catch (error) {
      log(`Failed to load regeneration queue: ${error.message}`, 'error');
      process.exit(1);
    }
  } else {
    // Standard mode: load all portraits and filter
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
    portraitsToGenerate = filteredPortraits.filter(p =>
      needsGeneration(p, options)
    );
    const skipped = filteredPortraits.length - portraitsToGenerate.length;

    if (skipped > 0) {
      log(`Skipping ${skipped} portraits (already exist or generated)`, 'info');
    }
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
      // Use custom prompt override if available, otherwise build from traits
      if (portrait.prompt) {
        basePrompt = portrait.prompt;
      } else {
        const archetypeTraits = metadata.archetypeTraits[portrait.archetype] || portrait.archetype;
        const regionTraits = metadata.regionTraits[portrait.region] || portrait.region;
        const visualTraits = portrait.visualTraits || '';
        basePrompt = `${archetypeTraits} ${regionTraits} ${visualTraits} monster creature enemy`;
      }
    } else {
      // Use custom prompt override if available, otherwise build from traits
      if (portrait.prompt) {
        basePrompt = portrait.prompt;
      } else {
        const raceTraits = metadata.raceTraits[portrait.race] || portrait.race;
        const genderTraits = metadata.genderTraits[portrait.gender] || portrait.gender;
        let classTraits;
        if (portrait.isAdvanced && metadata.advancedClassTraits[portrait.class]) {
          classTraits = metadata.advancedClassTraits[portrait.class];
        } else {
          classTraits = metadata.classTraits[portrait.class] || portrait.class;
        }
        basePrompt = `${raceTraits} ${genderTraits} ${classTraits}`;
      }
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
        // Use custom prompt override if available, otherwise build from traits
        let enemyPrompt;
        if (portrait.prompt) {
          enemyPrompt = portrait.prompt;
        } else {
          const archetypeTraits = metadata.archetypeTraits[portrait.archetype] || portrait.archetype;
          const regionTraits = metadata.regionTraits[portrait.region] || portrait.region;
          const visualTraits = portrait.visualTraits || '';
          enemyPrompt = `${visualTraits} ${archetypeTraits} ${regionTraits} monster creature`;
        }

        // Generate enemy portrait using prompt/key mode with custom output dir
        // Note: Python script adds 'portraits/' to the fallback_dir, so we use ENEMY_OUTPUT_BASE
        // Determine LoRA model: CLI override > asset-level > category default
        const effectiveLoraModel = options.lora || getEffectiveLoraModel(portrait, 'portraits');
        result = await generatePortrait({
          prompt: enemyPrompt,
          key: portrait.id,
          seed: portrait.seed,
          outputDir: ENEMY_OUTPUT_BASE,
          isEnemy: true,
          loraModel: effectiveLoraModel
        }, {
          verbose: options.verbose,
          quiet: options.quiet,
          local: options.local,
          huggingface: options.huggingface
        });
      } else if (portrait.isAdvanced) {
        // Use custom prompt override if available, otherwise build from traits
        let advancedPrompt;
        if (portrait.prompt) {
          advancedPrompt = portrait.prompt;
        } else {
          const raceTraits = metadata.raceTraits[portrait.race] || portrait.race;
          const genderTraits = metadata.genderTraits[portrait.gender] || portrait.gender;
          const classTraits = metadata.advancedClassTraits[portrait.class] || portrait.class;
          advancedPrompt = `${raceTraits} ${genderTraits} ${classTraits}`;
        }

        // Determine LoRA model: CLI override > asset-level > category default
        const effectiveLoraModelAdvanced = options.lora || getEffectiveLoraModel(portrait, 'portraits');
        result = await generatePortrait({
          prompt: advancedPrompt,
          key: portrait.id,
          seed: portrait.seed,
          isAdvanced: true,
          loraModel: effectiveLoraModelAdvanced
        }, {
          verbose: options.verbose,
          quiet: options.quiet,
          local: options.local,
          huggingface: options.huggingface
        });
      } else {
        // Generate base class player portrait using race/gender/class mode
        // Determine LoRA model: CLI override > asset-level > category default
        const effectiveLoraModelBase = options.lora || getEffectiveLoraModel(portrait, 'portraits');
        result = await generatePortrait({
          race: portrait.race,
          gender: portrait.gender,
          characterClass: portrait.class,
          seed: portrait.seed,
          loraModel: effectiveLoraModelBase
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

        // Clear regeneration marker if in queue mode
        if (options.queue && portrait.needsRegeneration) {
          clearRegenerationMarker(portrait);
        }

        log(`Generated: ${portrait.id}`, 'success');
        log(`Saved: ${getOutputPath(portrait)}`, 'info');

        // Post-process to generate canonical size variants
        // Python now saves processed 1024x1024 original directly to originals/
        if (checkImageMagick()) {
          const portraitId = portrait._type === 'enemy'
            ? `enemy_${portrait.id}`
            : portrait.id;

          const sourcePath = path.join(OUTPUT_DIR, `${portraitId}.png`);

          const postResult = await generateCanonicalSizeVariants(
            sourcePath,
            'portraits',
            portraitId,
            {
              sizes: [64, 128, 256],
              force: options.force,
              verbose: options.verbose
            }
          );

          if (postResult.success) {
            if (options.verbose && postResult.generated.length > 0) {
              log(`  Size variants: ${postResult.generated.length} generated`, 'info');
            }
          } else if (options.verbose) {
            log(`  Warning: Post-processing failed for ${portrait.id}`, 'warn');
            if (postResult.errors.length > 0) {
              for (const err of postResult.errors) {
                log(`    - ${err.size || 'unknown'}: ${err.error}`, 'warn');
              }
            }
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
