#!/usr/bin/env node
/**
 * Sound Effects Generation Script
 * Generates SFX using ElevenLabs API based on metadata configuration
 *
 * Usage:
 *   node scripts/audio/generate-sfx.js                      # Generate all pending SFX
 *   node scripts/audio/generate-sfx.js --dry-run            # Preview without generating
 *   node scripts/audio/generate-sfx.js --key attack_sword_1 # Generate specific effect
 *   node scripts/audio/generate-sfx.js --category combat    # Generate combat sounds
 *   node scripts/audio/generate-sfx.js --force              # Regenerate even if file exists
 *
 * Environment variables:
 *   ELEVENLABS_API_KEY - Required API key for ElevenLabs
 */

const path = require('path');
const {
  ElevenLabsSFXGenerator,
  loadMetadata,
  saveMetadata,
  fileExists,
  log,
  delay,
  ensureDirectoryExists
} = require('./lib');

// Configuration
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const METADATA_DIR = path.join(PROJECT_ROOT, 'audio-metadata/sfx');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/audio/sfx');

/**
 * Parse command line arguments
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    keys: [],  // Support multiple --key arguments
    category: null,
    force: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--key':
        // Support multiple --key arguments
        options.keys.push(args[++i]);
        break;
      case '--category':
        options.category = args[++i];
        break;
      case '--force':
        options.force = true;
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
Sound Effects Generation Script
Generates SFX using ElevenLabs API based on metadata configuration

Usage:
  node scripts/audio/generate-sfx.js [options]

Options:
  --dry-run         Show what would be generated without calling APIs
  --key <id>        Generate specific effect by key (e.g., attack_sword_1)
  --category <cat>  Generate only specific category (combat, skills, ambient, interactions, ui)
  --force           Regenerate even if file exists
  --help, -h        Show this help message

Environment variables:
  ELEVENLABS_API_KEY  Required API key for ElevenLabs

Examples:
  node scripts/audio/generate-sfx.js --dry-run
  node scripts/audio/generate-sfx.js --category combat
  node scripts/audio/generate-sfx.js --category ui --force
  node scripts/audio/generate-sfx.js --key impact_critical

Note:
  Prompts must have at most 1 comma. ElevenLabs generates multiple sounds
  for comma-separated concepts, causing files longer than specified duration.
  Write prompts that describe ONE sound with adjectives, not multiple sounds.

  BAD:  "sword slash, metal cutting, whoosh, impact"
  GOOD: "Fantasy sword slash with sharp metallic whoosh and light impact"
`);
}

/**
 * Load all SFX metadata from all category files
 * @returns {Object} Combined metadata by category
 */
function loadAllSFXMetadata() {
  const manifest = loadMetadata(path.join(METADATA_DIR, 'manifest.json'));
  if (!manifest) {
    throw new Error('Failed to load SFX manifest.json');
  }

  const metadata = {
    manifest,
    effects: [],
    byCategory: {}
  };

  for (const [category, info] of Object.entries(manifest.categories)) {
    metadata.byCategory[category] = [];

    for (const filePath of info.files) {
      const fullPath = path.join(METADATA_DIR, filePath);
      const data = loadMetadata(fullPath);

      if (!data) {
        log(`Warning: Failed to load ${filePath}`, 'warn');
        continue;
      }

      const effects = data.effects || [];
      for (const effect of effects) {
        effect._sourceFile = filePath;
        effect._category = category;
        metadata.effects.push(effect);
        metadata.byCategory[category].push(effect);
      }
    }
  }

  return metadata;
}

/**
 * Filter effects based on CLI options
 * @param {Array} effects - All effects
 * @param {Object} options - CLI options
 * @returns {Array} Filtered effects
 */
function filterEffects(effects, options) {
  let filtered = effects;

  // Filter by specific keys (supports multiple --key arguments)
  if (options.keys && options.keys.length > 0) {
    filtered = filtered.filter(e => options.keys.includes(e.id));
  }

  // Filter by category
  if (options.category) {
    filtered = filtered.filter(e => e._category === options.category);
  }

  return filtered;
}

/**
 * Get the full output path for an effect
 * @param {Object} effect - Effect metadata
 * @returns {string} Full file system path
 */
function getOutputPath(effect) {
  // Effect paths start with /assets/audio/sfx/
  // We need to map to frontend/public/assets/audio/sfx/
  const relativePath = effect.path.replace(/^\/assets\/audio\/sfx\//, '');
  return path.join(OUTPUT_DIR, relativePath);
}

/**
 * Check if an effect needs generation
 * @param {Object} effect - Effect metadata
 * @param {Object} options - CLI options
 * @returns {boolean} True if effect should be generated
 */
function needsGeneration(effect, options) {
  // If force flag, always generate
  if (options.force) {
    return true;
  }

  // Check if already marked as generated
  if (effect.generated) {
    return false;
  }

  // Check if file already exists
  const outputPath = getOutputPath(effect);
  if (fileExists(outputPath)) {
    return false;
  }

  return true;
}

/**
 * Mark effect as generated in metadata
 * @param {Object} effect - Effect that was generated
 */
function markEffectGenerated(effect) {
  const filePath = path.join(METADATA_DIR, effect._sourceFile);
  const data = loadMetadata(filePath);

  if (!data) {
    log(`Failed to load ${effect._sourceFile} for update`, 'error');
    return;
  }

  const effectIndex = data.effects.findIndex(e => e.id === effect.id);
  if (effectIndex !== -1) {
    data.effects[effectIndex].generated = true;
    data.effects[effectIndex].generatedAt = new Date().toISOString();
    saveMetadata(filePath, data);
  }
}

/**
 * Check prompt complexity and fail if it contains too many commas.
 * ElevenLabs generates multiple sounds sequentially when prompts contain commas,
 * causing files to be much longer than requested duration.
 *
 * STRICT MODE: Maximum 1 comma allowed (2 segments max)
 * Pattern: "adjective adjective noun" OR "description with secondary quality"
 *
 * @param {Object} effect - Effect metadata with prompt and duration
 * @returns {Object|null} Error object if prompt is invalid, null if OK
 */
function checkPromptComplexity(effect) {
  const prompt = effect.prompt || '';
  // Count comma-separated segments (distinct concepts)
  const segments = prompt.split(',').map(s => s.trim()).filter(s => s.length > 0);

  // BLOCK generation if prompt has more than 1 comma (2+ segments)
  // Rule: prompts should describe ONE sound with adjectives, not list multiple sounds
  if (segments.length > 1) {
    return {
      id: effect.id,
      commaCount: segments.length - 1,
      prompt: prompt,
      tip: 'Rewrite to describe ONE sound with adjectives - use "with" and "and" instead of commas'
    };
  }
  return null;
}

/**
 * Validate required environment variables
 * @param {Object} options - CLI options
 * @returns {boolean} True if validation passed, exits otherwise
 */
function validateEnvVars(options) {
  // Skip validation for dry-run mode
  if (options.dryRun) {
    return true;
  }

  if (!process.env.ELEVENLABS_API_KEY) {
    log('Missing ELEVENLABS_API_KEY in environment', 'error');
    log(`Expected .env file location: ${path.resolve(__dirname, '../..', '.env')}`, 'info');
    log('Set it with: export ELEVENLABS_API_KEY=your_api_key', 'info');
    process.exit(1);
  }

  return true;
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

  // Early validation of environment variables
  validateEnvVars(options);

  log('SFX Generation Script', 'info');
  log('=====================', 'info');

  // Load metadata
  let metadata;
  try {
    metadata = loadAllSFXMetadata();
    log(`Loaded ${metadata.effects.length} total effects`, 'info');
  } catch (error) {
    log(`Failed to load metadata: ${error.message}`, 'error');
    process.exit(1);
  }

  // Filter effects
  const filteredEffects = filterEffects(metadata.effects, options);
  log(`Filtered to ${filteredEffects.length} effects`, 'info');

  // Determine which effects need generation
  const effectsToGenerate = filteredEffects.filter(e => needsGeneration(e, options));
  const skippedEffects = filteredEffects.length - effectsToGenerate.length;

  if (skippedEffects > 0) {
    log(`Skipping ${skippedEffects} effects (already exist or generated)`, 'info');
  }

  if (effectsToGenerate.length === 0) {
    log('No effects need generation', 'success');
    process.exit(0);
  }

  log(`\nEffects to generate: ${effectsToGenerate.length}`, 'info');
  console.log('');

  // Check all prompts upfront for comma issues
  const promptErrors = [];
  for (const effect of effectsToGenerate) {
    const error = checkPromptComplexity(effect);
    if (error) {
      promptErrors.push(error);
    }
  }

  // Block generation if any prompts have too many commas
  if (promptErrors.length > 0) {
    log(`\nERROR: ${promptErrors.length} effect(s) have prompts with too many commas`, 'error');
    log('ElevenLabs generates multiple sounds for comma-separated concepts, causing longer files.\n', 'error');

    for (const err of promptErrors) {
      log(`  ${err.id}: ${err.commaCount} commas`, 'error');
      log(`    Prompt: "${err.prompt}"`, 'error');
      log(`    Fix: ${err.tip}\n`, 'info');
    }

    log('Fix the prompts in audio-metadata/sfx/ before generating.', 'error');
    process.exit(1);
  }

  // Display what will be generated
  for (const effect of effectsToGenerate) {
    console.log(`  - ${effect.id}`);
    console.log(`    Name: ${effect.name}`);
    console.log(`    Category: ${effect._category}`);
    console.log(`    Duration: ${effect.duration}s`);
    console.log(`    Output: ${getOutputPath(effect)}`);
    if (options.dryRun) {
      console.log(`    Prompt: ${effect.prompt}`);
      console.log(`    Chars: ${effect.prompt.length}`);
      console.log(`    Commas: ${(effect.prompt.match(/,/g) || []).length}`);
    }
    console.log('');
  }

  // Dry run - just display
  if (options.dryRun) {
    log(`\nDry run complete. Would generate ${effectsToGenerate.length} effects.`, 'success');
    process.exit(0);
  }

  // API key is validated at start of main(), safe to use directly
  const apiKey = process.env.ELEVENLABS_API_KEY;

  // Initialize generator
  const generator = new ElevenLabsSFXGenerator(apiKey);

  // Ensure output directories exist
  ensureDirectoryExists(path.join(OUTPUT_DIR, 'combat'));
  ensureDirectoryExists(path.join(OUTPUT_DIR, 'skills'));
  ensureDirectoryExists(path.join(OUTPUT_DIR, 'ambient'));
  ensureDirectoryExists(path.join(OUTPUT_DIR, 'interactions'));
  ensureDirectoryExists(path.join(OUTPUT_DIR, 'ui'));

  // Generate effects
  const results = {
    successful: [],
    failed: []
  };

  log('\nStarting generation...', 'info');
  console.log('');

  for (let i = 0; i < effectsToGenerate.length; i++) {
    const effect = effectsToGenerate[i];
    const outputPath = getOutputPath(effect);
    log(`[${i + 1}/${effectsToGenerate.length}] Generating: ${effect.id}`, 'info');

    try {
      // Determine if this is an ambient sound (longer duration)
      const isAmbient = effect._category === 'ambient' || effect.duration >= 10;

      // Generate effect (synchronous - ElevenLabs returns immediately)
      const result = isAmbient
        ? await generator.generateAmbient(effect.prompt, outputPath, {
            duration: effect.duration,
            promptInfluence: 0.5
          })
        : await generator.generateSFX(effect.prompt, outputPath, {
            duration: effect.duration,
            promptInfluence: 0.5
          });

      results.successful.push({
        id: effect.id,
        name: effect.name,
        path: result.path,
        size: result.size
      });

      // Mark as generated in metadata
      markEffectGenerated(effect);

      log(`Generated ${effect.id} (${result.size} bytes)`, 'success');

      // Rate limit delay between requests
      if (i < effectsToGenerate.length - 1) {
        await delay(500);
      }
    } catch (error) {
      log(`Failed to generate ${effect.id}: ${error.message}`, 'error');
      results.failed.push({
        id: effect.id,
        name: effect.name,
        error: error.message
      });
    }
  }

  // Summary
  console.log('\n========================================');
  log('Generation Summary', 'info');
  console.log('========================================');
  console.log(`  Successful: ${results.successful.length}`);
  console.log(`  Failed:     ${results.failed.length}`);
  console.log('');

  if (results.successful.length > 0) {
    log('Generated effects:', 'info');
    let totalBytes = 0;
    for (const effect of results.successful) {
      console.log(`  - ${effect.id} (${effect.size} bytes)`);
      totalBytes += effect.size;
    }
    console.log('');
    log(`Total size: ${(totalBytes / 1024).toFixed(2)} KB`, 'info');
  }

  if (results.failed.length > 0) {
    log('Failed effects:', 'error');
    for (const effect of results.failed) {
      console.log(`  - ${effect.id}: ${effect.error}`);
    }
  }

  process.exit(results.failed.length > 0 ? 1 : 0);
}

main().catch(error => {
  log(`Unexpected error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
