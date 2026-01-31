#!/usr/bin/env node
/**
 * Character Sprite Sheet Generation Script
 * Generates animated character sprite sheets (64x512 vertical strips with 8 frames each)
 * using local ComfyUI (default) or HuggingFace API.
 *
 * Sprite Convention:
 *   - Frame size: 64x64 pixels
 *   - Frames per animation: 8
 *   - Sheet size: 64x512 pixels (vertical strip)
 *   - Layout: Frames stacked top-to-bottom
 *
 * Usage:
 *   node scripts/ai-images/generate-characters.js                     # Generate all
 *   node scripts/ai-images/generate-characters.js --type player       # Player classes only
 *   node scripts/ai-images/generate-characters.js --type enemies      # Enemies only
 *   node scripts/ai-images/generate-characters.js --class warrior     # Specific class
 *   node scripts/ai-images/generate-characters.js --biome forest      # Enemies by biome
 *   node scripts/ai-images/generate-characters.js --id goblin_warrior # Specific enemy
 *   node scripts/ai-images/generate-characters.js --animation idle    # Only idle animations
 *   node scripts/ai-images/generate-characters.js --dry-run           # Preview
 *   node scripts/ai-images/generate-characters.js --force             # Regenerate existing
 *
 * Environment variables:
 *   HUGGINGFACE_API_TOKEN - Required only for --huggingface mode
 *   IMAGE_GENERATOR_ROOT - Path to image-generator project (required)
 */

const path = require('path');
const fs = require('fs');
const {
  loadMetadata,
  saveMetadata,
  markAssetGenerated,
  generateCharacterFrame,
  generateAnimation,
  generateReferenceImage,
  log,
  fileExists,
  delay,
  ensureDirectoryExists,
  getProjectRoot,
  getMetadataDir,
  buildThemedPrompt,
  buildSD15CharacterPrompt,
  buildSD15ReferencePrompt,
  createBackup,
  checkImageMagick,
  getEffectiveLoraModel,
  loadRegenerationQueue,
  clearRegenerationMarker,
  parseBaseArgs,
  applyKeyFilter,
  concatenateVerticalStrip,
  loadCharacterMetadata
} = require('./lib');

// Configuration
const PROJECT_ROOT = getProjectRoot();
const METADATA_DIR = getMetadataDir();
const OUTPUT_BASE_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/characters');
const TEMP_DIR = path.join(PROJECT_ROOT, 'ai-images-temp/characters');

// Frame configuration
const FRAME_COUNT = 8;
const FRAME_SIZE = 64;

/**
 * Parse command line arguments
 */
function parseArgs() {
  // Support --id as an alias for --key
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id' && i + 1 < args.length) {
      // Convert --id to --key for applyKeyFilter compatibility
      args.splice(i + 2, 0, '--key', args[i + 1]);
    }
  }

  return parseBaseArgs(process.argv.slice(2), {
    extraFlags: {
      type: { flag: '--type', type: 'string', default: null },
      class: { flag: '--class', type: 'string', default: null },
      biome: { flag: '--biome', type: 'string', default: null },
      id: { flag: '--id', type: 'string', default: null },
      animation: { flag: '--animation', type: 'string', default: null },
      // SD1.5 animation generation mode
      mode: { flag: '--mode', type: 'string', default: 'flux' },
      controlnetWeight: { flag: '--controlnet-weight', type: 'number', default: 0.7 },
      ipadapterWeight: { flag: '--ipadapter-weight', type: 'number', default: 0.6 },
      reference: { flag: '--reference', type: 'string', default: null },
      referenceOnly: { flag: '--reference-only', type: 'boolean', default: false }
    }
  });
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
Character Sprite Sheet Generation Script
Generates animated character sprite sheets (64x512 vertical strips).

Sprite Convention:
  Frame size: 64x64 pixels
  Frames per animation: 8
  Sheet size: 64x512 pixels (vertical strip)
  Layout: Frames stacked top-to-bottom (idle frames 0-3, walk/action frames 4-7)

Usage:
  node scripts/ai-images/generate-characters.js [options]

Options:
  --dry-run           Show what would be generated without calling APIs
  --type <type>       Filter by type: 'player' or 'enemies'
  --class <class>     Filter player characters by class (warrior, wizard, monk, chemist)
  --biome <biome>     Filter enemies by biome (forest, cave, mountain, bridge)
  --id <id>           Generate specific character by ID
  --animation <anim>  Generate only specific animation (idle, walk, attack, hurt, death, cast)
  --key <id>          Alias for --id (for consistency with other scripts)
  --force             Regenerate even if files exist
  --backup            Create backup of existing files before regenerating
  --huggingface, --hf Use HuggingFace API instead of local ComfyUI
  --local             Use local ComfyUI (default, explicit flag optional)
  --verbose, -v       Show detailed output including full prompt construction
  --quiet, -q         Suppress all output except errors
  --delay <ms>        Delay between requests in milliseconds (default: 2000)
  --lora <model>      LoRA model override:
                        v1 - Flat 2D style (GRPZA trigger) [default for characters]
                        v2 - Textured/isometric style (wbgmsst trigger)
                        modern-pixel - Modern pixel art
                        retro-pixel - Classic 8-bit pixel art
  --help, -h          Show this help message

SD1.5 Animation Mode Options:
  --mode <flux|sd15>          Generation mode (default: flux)
                                flux - Frame-by-frame Flux generation (current default)
                                sd15 - SD1.5 with ControlNet pose + IP-Adapter
  --controlnet-weight <0-1>   ControlNet pose guidance weight (default: 0.7)
                                Higher = stricter pose adherence
  --ipadapter-weight <0-1>    IP-Adapter reference weight (default: 0.6)
                                Higher = more style consistency with reference
  --reference <path>          Path to reference image for style consistency
                                If not provided, generates one automatically
  --reference-only            Generate only the reference image (skip animations)
                                Useful for creating/reviewing reference images first

Environment variables:
  IMAGE_GENERATOR_ROOT   Path to image-generator project (required)
  HUGGINGFACE_API_TOKEN  Required only for --huggingface mode

Examples:
  # Standard Flux generation (default)
  node scripts/ai-images/generate-characters.js --dry-run
  node scripts/ai-images/generate-characters.js --type player
  node scripts/ai-images/generate-characters.js --type enemies --biome forest
  node scripts/ai-images/generate-characters.js --id warrior --animation idle --force
  node scripts/ai-images/generate-characters.js --class wizard --animation cast

  # SD1.5 animation generation
  node scripts/ai-images/generate-characters.js --mode sd15 --id warrior
  node scripts/ai-images/generate-characters.js --mode sd15 --controlnet-weight 0.8 --id goblin
  node scripts/ai-images/generate-characters.js --mode sd15 --reference ./ref.png --id warrior

  # Generate reference image only
  node scripts/ai-images/generate-characters.js --mode sd15 --reference-only --id warrior
`);
}

/**
 * Get output path for a character animation sprite sheet
 */
function getOutputPath(character, animation) {
  if (character._type === 'player') {
    // Player: /assets/characters/player/{class}/{class}_{animation}.png
    return path.join(OUTPUT_BASE_DIR, 'player', character.class, `${character.class}_${animation}.png`);
  } else {
    // Enemy: /assets/characters/enemies/{biome}/{id}/{id}_{animation}.png
    return path.join(OUTPUT_BASE_DIR, 'enemies', character.biome, character.id, `${character.id}_${animation}.png`);
  }
}

/**
 * Get temp directory for frame generation
 */
function getTempDir(character, animation) {
  if (character._type === 'player') {
    return path.join(TEMP_DIR, 'player', character.class, animation);
  } else {
    return path.join(TEMP_DIR, 'enemies', character.biome, character.id, animation);
  }
}

/**
 * Build prompt for a specific frame
 */
function buildFramePrompt(character, animation, frameIndex, animationConfig) {
  // Get frame description from manifest config, or use generic fallback
  const frameDesc = animationConfig?.frameDescriptions?.[frameIndex] || `frame ${frameIndex + 1} of ${FRAME_COUNT}`;

  let basePrompt = '';

  if (character._type === 'player') {
    const classTraits = character._classTraits;
    basePrompt = `${character._stylePrefix} ${classTraits.visualTraits} ${animation} animation ${frameDesc}`;

    // Add attack style for attack animation
    if (animation === 'attack' && classTraits.attackStyle) {
      basePrompt += ` ${classTraits.attackStyle}`;
    }
  } else {
    // Enemy character - check for custom prompt in per-biome format
    const customAnimData = character._animationsObject?.[animation];
    if (customAnimData?.prompt) {
      // Use custom prompt from per-biome file
      basePrompt = `${character._stylePrefix || ''} ${character.visualTraits} ${customAnimData.prompt}`;
    } else {
      // Fallback to generic prompt construction
      basePrompt = `${character._stylePrefix || ''} ${character.visualTraits} ${character._archetypeTraits || ''} ${character._biomeTraits || ''} ${animation} animation ${frameDesc}`;
    }
  }

  // Add frame context for consistency
  basePrompt += ` frame ${frameIndex + 1} of ${FRAME_COUNT}`;

  return basePrompt;
}

/**
 * Check if a character animation needs generation
 */
function needsGeneration(character, animation, options) {
  if (options.force) return true;

  // Check if the animation sheet already exists
  const outputPath = getOutputPath(character, animation);
  if (fileExists(outputPath)) return false;

  // Check per-animation generated status if available
  if (character.generatedAnimations && character.generatedAnimations[animation]) {
    return false;
  }

  return true;
}

/**
 * Filter characters based on CLI options
 */
function filterCharacters(characters, options) {
  let filtered = [...characters];

  // Filter by type (already handled in loadCharacterMetadata, but double-check)
  if (options.type) {
    filtered = filtered.filter(c => c._type === options.type || (options.type === 'enemies' && c._type === 'enemy'));
  }

  // Filter by class (player only)
  if (options.class) {
    filtered = filtered.filter(c => c.class === options.class);
  }

  // Filter by biome (enemies only)
  if (options.biome) {
    filtered = filtered.filter(c => c.biome === options.biome);
  }

  // Filter by specific ID
  if (options.id) {
    filtered = filtered.filter(c => c.id === options.id);
  }

  // Apply key filter (alias for id)
  if (options.keys && options.keys.length > 0) {
    filtered = applyKeyFilter(filtered, options.keys);
  }

  return filtered;
}

/**
 * Get animations to generate for a character
 */
function getAnimationsToGenerate(character, options, animationConfigs) {
  let animations = character.animations || Object.keys(animationConfigs);

  // Filter to specific animation if requested
  if (options.animation) {
    animations = animations.filter(a => a === options.animation);
  }

  return animations;
}

/**
 * Clean up temp directory for a character animation
 */
function cleanupTempFrames(tempDir) {
  try {
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tempDir, file));
      }
      fs.rmdirSync(tempDir);
    }
  } catch (error) {
    log(`Warning: Failed to cleanup temp dir ${tempDir}: ${error.message}`, 'warn');
  }
}

/**
 * Get reference image path for a character
 */
function getReferenceImagePath(character) {
  if (character._type === 'player') {
    return path.join(OUTPUT_BASE_DIR, 'player', character.class, `${character.class}_reference.png`);
  } else {
    return path.join(OUTPUT_BASE_DIR, 'enemies', character.biome, character.id, `${character.id}_reference.png`);
  }
}

/**
 * Generate animation using SD1.5 with ControlNet and IP-Adapter
 * This generates all frames in a single pass with pose guidance
 */
async function generateSD15Animation(character, animation, animationConfig, options) {
  const outputPath = getOutputPath(character, animation);
  const referenceImagePath = options.reference || getReferenceImagePath(character);

  // Check if reference image exists, generate if needed
  if (!options.reference && !fileExists(referenceImagePath)) {
    log(`  Generating reference image for ${character.id}...`, 'info');

    const referencePrompt = buildSD15ReferencePrompt(character, {
      loraModel: options.lora
    });

    const refResult = await generateReferenceImage({
      characterId: character.id,
      prompt: referencePrompt,
      seed: character.seed,
      outputPath: referenceImagePath,
      loraModel: options.lora
    }, {
      verbose: options.verbose,
      quiet: options.quiet,
      dryRun: options.dryRun
    });

    if (!refResult.success) {
      return {
        success: false,
        error: `Failed to generate reference image: ${refResult.stderr || 'Unknown error'}`
      };
    }

    log(`  Reference image saved: ${referenceImagePath}`, 'success');
  }

  // Build SD1.5 prompt for this animation
  const prompt = buildSD15CharacterPrompt(character, animation, {
    loraModel: options.lora
  });

  if (options.verbose) {
    log(`  SD1.5 Prompt: ${prompt}`, 'debug');
    log(`  Reference: ${referenceImagePath}`, 'debug');
    log(`  ControlNet weight: ${options.controlnetWeight}`, 'debug');
    log(`  IP-Adapter weight: ${options.ipadapterWeight}`, 'debug');
  }

  // Generate animation with SD1.5 pipeline
  const result = await generateAnimation({
    characterId: character.id,
    animation,
    controlnetWeight: options.controlnetWeight,
    ipadapterWeight: options.ipadapterWeight,
    referenceImage: referenceImagePath,
    loraModel: options.lora,
    seed: character.seed,
    outputPath
  }, {
    verbose: options.verbose,
    quiet: options.quiet,
    dryRun: options.dryRun
  });

  return result;
}

/**
 * Generate only the reference image for a character (--reference-only mode)
 */
async function generateReferenceOnly(character, options) {
  const referenceImagePath = getReferenceImagePath(character);

  // Check if already exists and not forcing
  if (fileExists(referenceImagePath) && !options.force) {
    log(`Reference image already exists: ${referenceImagePath}`, 'info');
    return { success: true, skipped: true };
  }

  // Ensure output directory exists
  ensureDirectoryExists(path.dirname(referenceImagePath));

  const referencePrompt = buildSD15ReferencePrompt(character, {
    loraModel: options.lora
  });

  if (options.verbose) {
    log(`  Reference prompt: ${referencePrompt}`, 'debug');
  }

  const result = await generateReferenceImage({
    characterId: character.id,
    prompt: referencePrompt,
    seed: character.seed,
    outputPath: referenceImagePath,
    loraModel: options.lora
  }, {
    verbose: options.verbose,
    quiet: options.quiet,
    dryRun: options.dryRun
  });

  if (result.success) {
    log(`Reference image saved: ${referenceImagePath}`, 'success');
  }

  return result;
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
 * Update character metadata with generation status
 */
function markAnimationGenerated(character, animation) {
  const sourceFile = character._sourceFile;
  const metadataPath = path.join(METADATA_DIR, 'characters', sourceFile);
  const data = loadMetadata(metadataPath);

  if (!data) {
    log(`Warning: Could not load metadata file ${sourceFile}`, 'warn');
    return;
  }

  // Find and update the character - check players, characters, or enemies array
  const charArray = data.players || data.characters || data.enemies;
  const charIndex = charArray.findIndex(c => c.id === character.id);

  if (charIndex === -1) {
    log(`Warning: Character ${character.id} not found in ${sourceFile}`, 'warn');
    return;
  }

  // Initialize generatedAnimations if needed
  if (!charArray[charIndex].generatedAnimations) {
    charArray[charIndex].generatedAnimations = {};
  }

  charArray[charIndex].generatedAnimations[animation] = true;
  charArray[charIndex].generatedAt = new Date().toISOString();

  // Check if all animations are generated
  const allAnimations = character.animations || [];
  const allGenerated = allAnimations.every(a =>
    charArray[charIndex].generatedAnimations[a]
  );

  if (allGenerated) {
    charArray[charIndex].generated = true;
  }

  saveMetadata(metadataPath, data);
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

  log('Character Sprite Sheet Generation Script', 'info');
  log('========================================', 'info');

  // Display mode
  const isSD15Mode = options.mode === 'sd15';
  if (isSD15Mode) {
    log(`Mode: SD1.5 with ControlNet + IP-Adapter`, 'info');
    log(`  ControlNet weight: ${options.controlnetWeight}`, 'info');
    log(`  IP-Adapter weight: ${options.ipadapterWeight}`, 'info');
    if (options.reference) {
      log(`  Reference image: ${options.reference}`, 'info');
    }
  } else {
    log(`Mode: Flux (frame-by-frame generation)`, 'info');
  }

  // Check ImageMagick availability (required for concatenation in Flux mode)
  if (!options.dryRun && !isSD15Mode && !checkImageMagick()) {
    log('ImageMagick not found. Required for sprite sheet concatenation.', 'error');
    log('Install with: sudo apt-get install imagemagick', 'info');
    process.exit(1);
  }

  // Load metadata
  let metadata;
  try {
    metadata = loadCharacterMetadata({ type: options.type });
    log(`Loaded ${metadata.characters.length} characters`, 'info');
  } catch (error) {
    log(`Failed to load metadata: ${error.message}`, 'error');
    process.exit(1);
  }

  // Filter characters
  const filteredCharacters = filterCharacters(metadata.characters, options);
  log(`Filtered to ${filteredCharacters.length} characters`, 'info');

  if (filteredCharacters.length === 0) {
    log('No characters match the specified filters', 'info');
    process.exit(0);
  }

  // Handle --reference-only mode for SD1.5
  if (options.referenceOnly) {
    if (!isSD15Mode) {
      log('--reference-only requires --mode sd15', 'error');
      process.exit(1);
    }

    log(`\nGenerating reference images for ${filteredCharacters.length} characters...`, 'info');

    const refResults = { success: [], failed: [], skipped: [] };

    for (let i = 0; i < filteredCharacters.length; i++) {
      const character = filteredCharacters[i];
      log(`[${i + 1}/${filteredCharacters.length}] ${character.id}`, 'info');

      try {
        const result = await generateReferenceOnly(character, options);
        if (result.skipped) {
          refResults.skipped.push(character.id);
        } else if (result.success) {
          refResults.success.push(character.id);
        } else {
          refResults.failed.push({ id: character.id, error: result.error || 'Unknown error' });
        }
      } catch (error) {
        refResults.failed.push({ id: character.id, error: error.message });
        log(`Failed: ${error.message}`, 'error');
      }

      if (i < filteredCharacters.length - 1 && options.delay > 0) {
        await delay(options.delay);
      }
    }

    console.log('\n========================================');
    log('Reference Image Generation Summary', 'info');
    console.log('========================================');
    console.log(`  Generated: ${refResults.success.length}`);
    console.log(`  Skipped:   ${refResults.skipped.length}`);
    console.log(`  Failed:    ${refResults.failed.length}`);

    if (refResults.failed.length > 0) {
      log('Failed characters:', 'error');
      for (const item of refResults.failed) {
        console.log(`  - ${item.id}: ${item.error}`);
      }
    }

    process.exit(refResults.failed.length > 0 ? 1 : 0);
  }

  // Build list of animations to generate
  const animationsToGenerate = [];

  for (const character of filteredCharacters) {
    const animations = getAnimationsToGenerate(character, options, metadata.animations);

    for (const animation of animations) {
      if (needsGeneration(character, animation, options)) {
        animationsToGenerate.push({
          character,
          animation,
          animationConfig: metadata.animations[animation]
        });
      }
    }
  }

  const skippedCount = filteredCharacters.reduce((count, char) => {
    const anims = getAnimationsToGenerate(char, options, metadata.animations);
    return count + anims.filter(a => !needsGeneration(char, a, options)).length;
  }, 0);

  if (skippedCount > 0) {
    log(`Skipping ${skippedCount} animations (already exist or generated)`, 'info');
  }

  if (animationsToGenerate.length === 0) {
    log('No animations need generation', 'success');
    process.exit(0);
  }

  log(`\nAnimations to generate: ${animationsToGenerate.length}`, 'info');
  console.log('');

  // Display what will be generated
  for (const item of animationsToGenerate) {
    const { character, animation, animationConfig } = item;
    console.log(`  - ${character.id} / ${animation}`);
    console.log(`    Type: ${character._type}`);
    console.log(`    Mode: ${isSD15Mode ? 'SD1.5 (ControlNet + IP-Adapter)' : 'Flux (frame-by-frame)'}`);
    console.log(`    Frames: ${FRAME_COUNT} (${FRAME_SIZE}x${FRAME_SIZE} each)`);
    console.log(`    Output: ${getOutputPath(character, animation)}`);

    if (options.verbose) {
      if (isSD15Mode) {
        const sd15Prompt = buildSD15CharacterPrompt(character, animation, { loraModel: options.lora });
        console.log(`    SD1.5 prompt: ${sd15Prompt}`);
        console.log(`    Reference: ${options.reference || getReferenceImagePath(character)}`);
      } else {
        const samplePrompt = buildFramePrompt(character, animation, 0, animationConfig);
        console.log(`    Sample prompt (frame 0): ${samplePrompt}`);
      }
    }
    console.log('');
  }

  // Dry run - just display
  if (options.dryRun) {
    log(`\nDry run complete. Would generate ${animationsToGenerate.length} sprite sheets.`, 'success');
    if (isSD15Mode) {
      log(`Mode: SD1.5 with ControlNet (weight: ${options.controlnetWeight}) + IP-Adapter (weight: ${options.ipadapterWeight})`, 'info');
    } else {
      log(`Total frames: ${animationsToGenerate.length * FRAME_COUNT}`, 'info');
    }
    process.exit(0);
  }

  // Create backup if requested
  if (options.backup) {
    log('Creating backup of existing files...', 'info');
    // Collect existing output paths
    const existingPaths = animationsToGenerate
      .map(item => getOutputPath(item.character, item.animation))
      .filter(p => fileExists(p));

    if (existingPaths.length > 0) {
      const backupResult = createBackup(existingPaths.map(p => ({ _outputPath: p })), { reason: 'character regeneration' });
      if (backupResult.success) {
        log(`Backup created: ${backupResult.backupDir}`, 'success');
        log(`Backed up ${backupResult.assetCount} assets`, 'info');
      } else {
        log(`Backup failed: ${backupResult.error}`, 'warn');
      }
    }
  }

  // Ensure output directories exist
  ensureDirectoryExists(path.join(OUTPUT_BASE_DIR, 'player'));
  ensureDirectoryExists(path.join(OUTPUT_BASE_DIR, 'enemies'));
  ensureDirectoryExists(TEMP_DIR);

  // Generate sprite sheets
  const results = {
    success: [],
    failed: []
  };

  log('\nStarting generation...', 'info');
  console.log('');

  for (let i = 0; i < animationsToGenerate.length; i++) {
    const { character, animation, animationConfig } = animationsToGenerate[i];
    const animationKey = `${character.id}/${animation}`;

    log(`[${i + 1}/${animationsToGenerate.length}] Generating: ${animationKey}`, 'info');

    try {
      // Ensure output directory exists
      const outputPath = getOutputPath(character, animation);
      ensureDirectoryExists(path.dirname(outputPath));

      // Determine LoRA model
      const effectiveLoraModel = options.lora || getEffectiveLoraModel(character, 'characters') || 'v1';

      // Mode-specific generation
      if (isSD15Mode) {
        // SD1.5 mode: Use ControlNet + IP-Adapter for consistent animations
        log(`  Using SD1.5 pipeline...`, 'info');

        const result = await generateSD15Animation(character, animation, animationConfig, {
          ...options,
          lora: effectiveLoraModel
        });

        if (result.success) {
          results.success.push({ id: animationKey, character, animation });
          markAnimationGenerated(character, animation);
          log(`Generated: ${animationKey}`, 'success');
          log(`Saved: ${outputPath}`, 'info');

          // Clear regeneration marker if applicable
          if (options.queue && character.needsRegeneration) {
            clearRegenerationMarker(character);
          }
        } else {
          results.failed.push({ id: animationKey, error: result.error || 'SD1.5 generation failed' });
          log(`Failed: ${animationKey} - ${result.error}`, 'error');
        }
      } else {
        // Flux mode: Frame-by-frame generation with concatenation
        // Create temp directory for frames
        const tempDir = getTempDir(character, animation);
        ensureDirectoryExists(tempDir);

        // Generate all 8 frames
        const framePaths = [];
        let framesFailed = false;

        for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex++) {
          const frameKey = `${character.id}_${animation}_frame${frameIndex}`;
          const framePath = path.join(tempDir, `frame_${frameIndex}.png`);

          log(`  Frame ${frameIndex + 1}/${FRAME_COUNT}...`, 'info');

          const prompt = buildFramePrompt(character, animation, frameIndex, animationConfig);

          const result = await generateCharacterFrame({
            prompt,
            key: frameKey,
            characterType: character._type,
            characterClass: character.class,
            biome: character.biome,
            characterId: character.id,
            animation,
            frameIndex,
            seed: character.seed, // Same seed for all frames ensures consistency
            outputPath: framePath,
            loraModel: effectiveLoraModel
          }, {
            verbose: options.verbose,
            quiet: options.quiet,
            local: options.local,
            huggingface: options.huggingface
          });

          if (!result.success) {
            log(`    Frame ${frameIndex} failed: ${result.stderr || 'Unknown error'}`, 'error');
            framesFailed = true;
            break;
          }

          framePaths.push(framePath);

          // Rate limit delay between frames
          if (frameIndex < FRAME_COUNT - 1 && options.delay > 0) {
            await delay(Math.min(options.delay / 4, 500)); // Shorter delay between frames
          }
        }

        if (framesFailed) {
          results.failed.push({ id: animationKey, error: 'Frame generation failed' });
          cleanupTempFrames(tempDir);
          continue;
        }

        // Concatenate frames into vertical strip
        log(`  Concatenating ${FRAME_COUNT} frames...`, 'info');
        const concatResult = await concatenateVerticalStrip(framePaths, outputPath, {
          verbose: options.verbose
        });

        if (concatResult.success) {
          results.success.push({ id: animationKey, character, animation });
          markAnimationGenerated(character, animation);
          log(`Generated: ${animationKey}`, 'success');
          log(`Saved: ${outputPath}`, 'info');

          // Clear regeneration marker if applicable
          if (options.queue && character.needsRegeneration) {
            clearRegenerationMarker(character);
          }
        } else {
          results.failed.push({ id: animationKey, error: concatResult.error || 'Concatenation failed' });
          log(`Failed: ${animationKey} - ${concatResult.error}`, 'error');
        }

        // Cleanup temp frames
        cleanupTempFrames(tempDir);
      } // End of Flux mode else block

      // Rate limit delay between animations
      if (i < animationsToGenerate.length - 1 && options.delay > 0) {
        await delay(options.delay);
      }

    } catch (error) {
      log(`Failed to generate ${animationKey}: ${error.message}`, 'error');
      results.failed.push({ id: animationKey, error: error.message });
    }
  }

  // Summary
  console.log('\n========================================');
  log('Generation Summary', 'info');
  console.log('========================================');
  console.log(`  Mode: ${isSD15Mode ? 'SD1.5 (ControlNet + IP-Adapter)' : 'Flux (frame-by-frame)'}`);
  console.log(`  Sprite sheets: ${results.success.length}`);
  if (!isSD15Mode) {
    console.log(`  Total frames generated: ${results.success.length * FRAME_COUNT}`);
  }
  console.log(`  Failed:  ${results.failed.length}`);
  console.log('');

  if (results.failed.length > 0) {
    log('Failed animations:', 'error');
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
