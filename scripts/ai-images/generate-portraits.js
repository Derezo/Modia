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
  createBackup
} = require('./lib');

// Configuration
const PROJECT_ROOT = getProjectRoot();
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/sprites/characters/portraits');

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    key: null,
    race: null,
    gender: null,
    class: null,
    force: false,
    backup: false,
    local: true,     // Local ComfyUI is now the default
    huggingface: false,
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
      case '--race':
        options.race = args[++i];
        break;
      case '--gender':
        options.gender = args[++i];
        break;
      case '--class':
        options.class = args[++i];
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
  --dry-run           Show what would be generated without calling APIs
  --key <id>          Generate specific portrait (e.g., human_male_warrior)
  --race <race>       Filter by race (human, elf, dwarf, vampire, orc)
  --gender <gender>   Filter by gender (male, female, other)
  --class <class>     Filter by class (warrior, wizard, monk, chemist)
  --force             Regenerate even if file exists
  --backup            Backup existing portraits before regeneration
  --huggingface, --hf Use HuggingFace API instead of local ComfyUI
  --local             Use local ComfyUI (default, explicit flag optional)
  --help, -h          Show this help message

Environment variables:
  IMAGE_GENERATOR_ROOT   Path to image-generator project (required)
  HUGGINGFACE_API_TOKEN  Required only for --huggingface mode

Examples:
  node scripts/ai-images/generate-portraits.js --dry-run
  node scripts/ai-images/generate-portraits.js --race elf --class mage
  node scripts/ai-images/generate-portraits.js --key human_male_warrior --force
  node scripts/ai-images/generate-portraits.js --huggingface --race human  # Use HF API
`);
}

/**
 * Get the output path for a portrait
 */
function getOutputPath(portrait) {
  return path.join(OUTPUT_DIR, `${portrait.id}.png`);
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

  validateEnvVars(options);

  log('Portrait Generation Script', 'info');
  log('==========================', 'info');

  // Load metadata with filters
  let metadata;
  try {
    metadata = loadPortraitMetadata({
      race: options.race,
      gender: options.gender,
      class: options.class
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
    // Build a base prompt from portrait traits
    const raceTraits = metadata.raceTraits[portrait.race] || portrait.race;
    const genderTraits = metadata.genderTraits[portrait.gender] || portrait.gender;
    const classTraits = metadata.classTraits[portrait.class] || portrait.class;
    const basePrompt = `${raceTraits} ${genderTraits} ${classTraits}`;

    const prompt = buildThemedPrompt('portraits', basePrompt, {});

    console.log(`  - ${portrait.id}`);
    console.log(`    Race: ${portrait.race}, Gender: ${portrait.gender}, Class: ${portrait.class}`);
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

  // Ensure output directory exists
  ensureDirectoryExists(OUTPUT_DIR);

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
      const result = await generatePortrait({
        race: portrait.race,
        gender: portrait.gender,
        characterClass: portrait.class,
        seed: portrait.seed
      }, { verbose: true });

      if (result.success) {
        results.success.push({ id: portrait.id, portrait });

        portrait._category = 'portraits';
        portrait._sourceFile = 'combinations.json';
        markAssetGenerated(portrait);

        log(`Generated: ${portrait.id}`, 'success');
      } else {
        results.failed.push({
          id: portrait.id,
          error: result.stderr || 'Unknown error'
        });
        log(`Failed: ${portrait.id}`, 'error');
      }

      // Rate limit delay
      if (i < portraitsToGenerate.length - 1) {
        await delay(2000);
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
