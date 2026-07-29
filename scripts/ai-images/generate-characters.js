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
const { pathToFileURL } = require('url');
const sharp = require('sharp');
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
  loadCharacterMetadata,
  updateAssetStatus,
  convertToWebp
} = require('./lib');

const {
  VALID_LORA_MODELS,
  VALID_SD15_LORA_MODELS
} = require('./lib/parseArgs');

const {
  getCharacterOutputPath,
  getCharacterReferencePath,
  getCharacterDirectoryPath,
  getAssetPathsModule
} = require('./lib/assetPathsBridge');

// Configuration
const PROJECT_ROOT = getProjectRoot();
const METADATA_DIR = getMetadataDir();
const OUTPUT_BASE_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/characters');
const TEMP_DIR = path.join(PROJECT_ROOT, 'ai-images-temp/characters');
const PREPARED_REFERENCE_DIR = path.join(TEMP_DIR, 'references');
const REJECTED_SPRITE_DIR = path.join(PROJECT_ROOT, 'ai-images-temp/rejected/characters');

// Frame configuration
const FRAME_COUNT = 8;
const FRAME_SIZE = 64;
const VALID_GENERATION_MODES = ['flux', 'sd15'];

/**
 * Parse command line arguments
 */
function parseArgs(argv = process.argv.slice(2)) {
  // Support --id as an alias for --key
  const args = [...argv];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id' && i + 1 < args.length) {
      // Convert --id to --key for applyKeyFilter compatibility
      args.splice(i + 2, 0, '--key', args[i + 1]);
    }
  }

  return parseBaseArgs(args, {
    extraFlags: {
      type: { flag: '--type', type: 'string', default: null },
      class: { flag: '--class', type: 'string', default: null },
      biome: { flag: '--biome', type: 'string', default: null },
      id: { flag: '--id', type: 'string', default: null },
      animation: { flag: '--animation', type: 'string', default: null },
      // SD1.5 animation generation mode
      mode: { flag: '--mode', type: 'string', default: null },
      controlnetWeight: { flag: '--controlnet-weight', type: 'number', default: null },
      ipadapterWeight: { flag: '--ipadapter-weight', type: 'number', default: null },
      reference: { flag: '--reference', type: 'string', default: null },
      referenceOnly: { flag: '--reference-only', type: 'boolean', default: false },
      referencePose: { flag: '--reference-pose', type: 'string', default: 'idle' },
      autoReference: { flag: '--auto-reference', type: 'boolean', default: false }
    }
  });
}

/**
 * Return the first value that is neither null nor undefined.
 */
function firstConfiguredValue(...values) {
  return values.find(value => value !== null && value !== undefined);
}

/**
 * Resolve the generation mode for one character.
 *
 * An explicit CLI mode always wins. Without one, portrait-matched player
 * Canonical player variants use the identity-preserving SD1.5 pipeline while
 * enemies keep their historical Flux behavior.
 */
function resolveGenerationMode(character, explicitMode = null) {
  if (explicitMode !== null && explicitMode !== undefined) {
    if (!VALID_GENERATION_MODES.includes(explicitMode)) {
      throw new Error(
        `Invalid generation mode '${explicitMode}'. Valid modes: ${VALID_GENERATION_MODES.join(', ')}`
      );
    }
    return explicitMode;
  }

  return character?._type === 'player' && character?._variant === true
    ? 'sd15'
    : 'flux';
}

/**
 * Fail before generation if a LoRA belongs to the wrong model family.
 */
function validateLoraForMode(loraModel, mode, usage, characterId = 'unknown') {
  const validModels = mode === 'sd15' ? VALID_SD15_LORA_MODELS : VALID_LORA_MODELS;
  const familyName = mode === 'sd15' ? 'SD1.5' : 'Flux';

  if (!loraModel) {
    throw new Error(
      `No ${familyName} ${usage} LoRA configured for character '${characterId}'. ` +
      `Valid ${familyName} LoRAs: ${validModels.join(', ')}`
    );
  }

  if (!validModels.includes(loraModel)) {
    throw new Error(
      `${familyName} ${usage} LoRA '${loraModel}' for character '${characterId}' is incompatible ` +
      `with ${familyName} generation. Valid ${familyName} LoRAs: ${validModels.join(', ')}`
    );
  }
}

function validateGuidanceWeight(weight, name, characterId) {
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1) {
    throw new Error(
      `${name} for character '${characterId}' must be a number between 0 and 1; got ${weight}`
    );
  }
}

/**
 * Resolve all mode-specific settings for one character. This helper is pure
 * apart from the legacy Flux manifest lookup performed by getEffectiveLoraModel.
 */
function resolveCharacterGenerationConfig(character, options = {}, characterManifest = {}) {
  const characterId = character?.id || character?.class || 'unknown';
  const mode = resolveGenerationMode(character, options.mode);

  if (mode === 'flux') {
    const loraModel = options.lora || getEffectiveLoraModel(character, 'characters') || 'v1';
    validateLoraForMode(loraModel, mode, 'animation', characterId);
    return { mode, loraModel };
  }

  const variantConfig = character?.sd15Config || {};
  // Canonical player art is deterministic. SD1.5 settings now live under the
  // explicitly optional staged-candidate block; retain the legacy lookup so
  // older manifests can still stage candidates without migration downtime.
  const legacyManifestDefaults = characterManifest?.generationDefaults?.sd15 || {};
  const stagedCandidateDefaults = characterManifest?.generationDefaults?.stagedCandidate?.diffusion?.sd15 || {};
  const manifestDefaults = { ...legacyManifestDefaults, ...stagedCandidateDefaults };
  const controlnetWeight = firstConfiguredValue(
    options.controlnetWeight,
    variantConfig.controlnetWeight,
    manifestDefaults.controlnetWeight
  );
  const ipadapterWeight = firstConfiguredValue(
    options.ipadapterWeight,
    variantConfig.ipadapterWeight,
    manifestDefaults.ipadapterWeight
  );
  const referenceLoraModel = firstConfiguredValue(
    options.lora,
    variantConfig.referenceLoraModel,
    manifestDefaults.referenceLoraModel,
    manifestDefaults.loraModel
  );
  const animationLoraModel = firstConfiguredValue(
    options.lora,
    variantConfig.animationLoraModel,
    manifestDefaults.animationLoraModel,
    manifestDefaults.loraModel
  );

  validateGuidanceWeight(controlnetWeight, 'ControlNet weight', characterId);
  validateGuidanceWeight(ipadapterWeight, 'IP-Adapter weight', characterId);
  validateLoraForMode(referenceLoraModel, mode, 'reference', characterId);
  validateLoraForMode(animationLoraModel, mode, 'animation', characterId);

  return {
    mode,
    controlnetWeight,
    ipadapterWeight,
    referenceLoraModel,
    animationLoraModel
  };
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
                        Flux: v1 - Flat 2D style (GRPZA trigger)
                        v2 - Textured/isometric style (wbgmsst trigger)
                        modern-pixel - Modern pixel art
                        retro-pixel - Classic 8-bit pixel art
                        SD1.5 models: pixel-art-xl, 16-bit-pixel,
                        all-in-one-pixel, retro-game-art, cps2-pixel-art
                        Must match the selected generation mode's model family
  --help, -h          Show this help message

SD1.5 Animation Mode Options:
  --mode <flux|sd15>          Explicit generation mode override
                                If omitted: canonical player variants use SD1.5;
                                enemies use Flux
                                flux - Frame-by-frame Flux generation
                                sd15 - SD1.5 with ControlNet pose + IP-Adapter
  --controlnet-weight <0-1>   ControlNet pose guidance override
                                Otherwise resolved from character/manifest metadata
                                Higher = stricter pose adherence
  --ipadapter-weight <0-1>    IP-Adapter reference weight override
                                Otherwise resolved from character/manifest metadata
                                Higher = more style consistency with reference
  --reference <path>          Path to reference image for style consistency
                                Otherwise uses the character metadata reference;
                                use --auto-reference if that image is missing
  --reference-only            Generate only the reference image (skip animations)
                                Useful for creating/reviewing reference images first
  --reference-pose <pose>     Pose template for reference generation (default: idle)
                                Preset poses: 'idle', 'tpose'
                                Or custom path to pose image
  --auto-reference            Auto-generate reference if missing (default: false)
                                When set, animations will auto-generate reference first

Environment variables:
  IMAGE_GENERATOR_ROOT   Path to image-generator project (required)
  HUGGINGFACE_API_TOKEN  Required only for --huggingface mode

Examples:
  # Automatic mode selection (canonical player variants: SD1.5; enemies: Flux)
  node scripts/ai-images/generate-characters.js --dry-run
  node scripts/ai-images/generate-characters.js --type player
  node scripts/ai-images/generate-characters.js --type enemies --biome forest
  node scripts/ai-images/generate-characters.js --id human_male_warrior --animation idle --force
  node scripts/ai-images/generate-characters.js --class wizard --animation cast

  # SD1.5 animation generation
  node scripts/ai-images/generate-characters.js --mode sd15 --id human_male_warrior
  node scripts/ai-images/generate-characters.js --mode sd15 --controlnet-weight 0.8 --id goblin
  node scripts/ai-images/generate-characters.js --mode sd15 --reference ./ref.png --id human_male_warrior

  # Generate reference image only (with custom pose)
  node scripts/ai-images/generate-characters.js --mode sd15 --reference-only --id human_male_warrior
  node scripts/ai-images/generate-characters.js --mode sd15 --reference-only --reference-pose tpose --id human_male_warrior
  node scripts/ai-images/generate-characters.js --mode sd15 --reference-only --reference-pose ./custom_pose.png --id human_male_warrior

  # Auto-generate reference during animation generation
  node scripts/ai-images/generate-characters.js --mode sd15 --auto-reference --id human_male_warrior
  node scripts/ai-images/generate-characters.js --mode sd15 --auto-reference --reference-pose tpose --id goblin
`);
}

/**
 * Get output path for a character animation sprite sheet
 * Uses shared/assetPaths.js via the bridge module for canonical path construction
 */
async function getOutputPath(character, animation) {
  const identity = character._type === 'player' ? character : character.id;
  const outputPath = await getCharacterOutputPath(identity, {
    type: character._type,
    biome: character.biome,
    animation,
    extension: 'png'  // Generation outputs PNG first (converted to WebP after)
  });
  if (outputPath === null) {
    throw new Error(
      `Player '${character.id || character.class || 'unknown'}' is missing a canonical race/gender/class identity`
    );
  }
  return outputPath;
}

/**
 * Get temp directory for frame generation
 */
function getTempDir(character, animation) {
  if (character._type === 'player') {
    if (character._variant) {
      return path.join(TEMP_DIR, 'player', character.race, character.gender, character.class, animation);
    }
    return path.join(TEMP_DIR, 'player', character.class, animation);
  } else {
    return path.join(TEMP_DIR, 'enemies', character.biome, character.id, animation);
  }
}

/**
 * Build prompt for a specific frame
 * Supports character-specific frame description overrides
 */
function buildFramePrompt(character, animation, frameIndex, animationConfig) {
  // Check for character-specific overrides first, then manifest defaults, then generic fallback
  const characterOverride = character.frameDescriptionOverrides?.[animation]?.[frameIndex];
  const manifestDefault = animationConfig?.frameDescriptions?.[frameIndex];

  // Use override if it exists and is non-empty, otherwise use manifest default
  const frameDesc = (characterOverride && characterOverride.trim() !== '')
    ? characterOverride
    : (manifestDefault || `frame ${frameIndex + 1} of ${FRAME_COUNT}`);

  let basePrompt = '';

  if (character._type === 'player') {
    const classTraits = character._classTraits;
    const visualTraits = character.visualTraits || [
      character._raceTraits,
      character._genderTraits,
      classTraits.visualTraits
    ].filter(Boolean).join(' ');
    basePrompt = `${character._stylePrefix} ${visualTraits} ${animation} animation ${frameDesc}`;

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
async function needsGeneration(character, animation, options) {
  if (options.force) return true;

  // Check if the animation sheet already exists
  const outputPath = await getOutputPath(character, animation);
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
 * Uses shared/assetPaths.js via the bridge module for canonical path construction
 */
async function getReferenceImagePath(character, options = {}) {
  const { preferIdentitySource = true } = options;

  if (preferIdentitySource && character._variant) {
    const fullBodyReference = await getCharacterReferencePath(character, {
      type: character._type
    });
    if (fileExists(fullBodyReference)) {
      return fullBodyReference;
    }

    const identitySource = character.sd15Config?.referenceImage || character.portraitReference;
    if (identitySource) {
      return path.join(PROJECT_ROOT, 'frontend/public', identitySource.replace(/^\//, ''));
    }
  }

  const identity = character._type === 'player' ? character : character.id;
  const referencePath = await getCharacterReferencePath(identity, {
    type: character._type,
    biome: character.biome
  });
  if (referencePath === null) {
    throw new Error(
      `Player '${character.id || character.class || 'unknown'}' is missing a canonical race/gender/class identity`
    );
  }
  return referencePath;
}

/**
 * Prepare a transparent portrait/full-body reference for IP-Adapter.
 *
 * ComfyUI's image loader composites transparent pixels as black. That turns a
 * clean alpha matte into dark circles and blocks which the model then repeats
 * as scenery in generated frames. Flattening to a deterministic white stage
 * preserves the subject while matching the generation prompt and matte
 * remover.
 */
async function prepareAnimationReference(referenceImagePath, character, options = {}) {
  if (!fileExists(referenceImagePath)) {
    throw new Error(`Reference image not found: ${referenceImagePath}`);
  }

  const metadata = await sharp(referenceImagePath).metadata();
  if (!metadata.hasAlpha) return referenceImagePath;

  const outputDirectory = options.outputDirectory || PREPARED_REFERENCE_DIR;
  const safeId = String(character?.id || 'character').replace(/[^a-z0-9_-]/gi, '_');
  const preparedPath = path.join(outputDirectory, `${safeId}_ipadapter_v3.png`);
  ensureDirectoryExists(outputDirectory);

  const sourceMtime = fs.statSync(referenceImagePath).mtimeMs;
  const preparedIsCurrent = fileExists(preparedPath)
    && fs.statSync(preparedPath).mtimeMs >= sourceMtime;

  if (!preparedIsCurrent) {
    await sharp(referenceImagePath)
      .flatten({ background: '#ffffff' })
      .png()
      .toFile(preparedPath);
  }

  return preparedPath;
}

/**
 * Portrait cards are authoritative for identity but are not full-body pose
 * references. Let OpenPose dominate their composition while retaining enough
 * IP-Adapter influence for face, costume, and palette. Canonical full-body
 * references keep the balanced profile proven by the golden warrior gate.
 */
function resolveAnimationGuidance(referenceImagePath, options = {}) {
  const normalizedPath = String(referenceImagePath || '').split(path.sep).join('/');
  const isPortraitIdentitySource = normalizedPath.includes('/portraits/originals/');
  const controlnetWeight = Number(options.controlnetWeight);
  const ipadapterWeight = Number(options.ipadapterWeight);

  if (!isPortraitIdentitySource) {
    return { controlnetWeight, ipadapterWeight, mode: 'full_body_reference' };
  }

  return {
    controlnetWeight: Math.max(controlnetWeight, 0.82),
    ipadapterWeight: Math.min(ipadapterWeight, 0.45),
    mode: 'portrait_pose_dominant'
  };
}

async function validateGeneratedSpriteSheet(filePath, animation) {
  const validatorPath = path.join(PROJECT_ROOT, 'scripts/ai-images/validate-runtime-assets.mjs');
  const { inspectRaster } = await import(pathToFileURL(validatorPath).href);
  const format = path.extname(filePath).slice(1).toLowerCase() || null;
  return inspectRaster(filePath, {
    width: FRAME_SIZE,
    height: FRAME_SIZE * FRAME_COUNT,
    format,
    requireAlpha: true,
    frameWidth: FRAME_SIZE,
    frameHeight: FRAME_SIZE,
    frameCount: FRAME_COUNT,
    animation,
    maxFrameForegroundCoverage: 0.6
  });
}

function quarantineGeneratedSprite(filePath, character, animation) {
  const safeId = String(character?.id || 'character').replace(/[^a-z0-9_-]/gi, '_');
  const destinationDirectory = path.join(REJECTED_SPRITE_DIR, safeId);
  ensureDirectoryExists(destinationDirectory);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const extension = path.extname(filePath) || '.webp';
  const destination = path.join(
    destinationDirectory,
    `${safeId}_${animation}_${timestamp}${extension}`
  );
  fs.renameSync(filePath, destination);
  return destination;
}

/**
 * Generate animation using SD1.5 with ControlNet and IP-Adapter
 * This generates all frames in a single pass with pose guidance
 */
async function generateSD15Animation(character, animation, animationConfig, options) {
  const outputPath = await getOutputPath(character, animation);
  const referenceImagePath = options.reference || await getReferenceImagePath(character);
  const referenceLoraModel = options.referenceLoraModel;
  const animationLoraModel = options.animationLoraModel;

  // Check if reference image exists, generate if needed (when autoReference is enabled or reference is missing)
  const needsReferenceGeneration = !options.reference && !fileExists(referenceImagePath);

  if (needsReferenceGeneration) {
    if (!options.autoReference) {
      return {
        success: false,
        error: `Reference image not found: ${referenceImagePath}. Use --auto-reference to generate automatically, or provide --reference <path>`
      };
    }

    log(`  Generating reference image for ${character.id}...`, 'info');
    if (options.referencePose && options.referencePose !== 'idle') {
      log(`  Using reference pose: ${options.referencePose}`, 'info');
    }

    const referencePrompt = buildSD15ReferencePrompt(character, {
      loraModel: referenceLoraModel
    });

    const refResult = await generateReferenceImage({
      characterId: character.id,
      characterType: character._type,
      biome: character.biome,
      prompt: referencePrompt,
      seed: character.seed,
      outputPath: referenceImagePath,
      loraModel: referenceLoraModel,
      controlnetWeight: options.controlnetWeight,
      ipadapterWeight: options.ipadapterWeight,
      referencePose: options.referencePose
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
    loraModel: animationLoraModel
  });
  const guidance = resolveAnimationGuidance(referenceImagePath, options);
  const preparedReferenceImagePath = await prepareAnimationReference(
    referenceImagePath,
    character
  );

  // Get frame descriptions - check for character-specific overrides first
  // Character overrides are stored in character.frameDescriptionOverrides[animation]
  const characterOverrides = character.frameDescriptionOverrides?.[animation];
  const manifestDefaults = animationConfig?.frameDescriptions || null;

  // Merge overrides with defaults: use override if non-empty, otherwise use default
  let effectiveFrameDescriptions = null;
  if (characterOverrides?.length > 0 || manifestDefaults?.length > 0) {
    const frameCount = 8;
    effectiveFrameDescriptions = Array.from({ length: frameCount }, (_, i) => {
      // Use character override if it exists and is non-empty
      if (characterOverrides?.[i] && characterOverrides[i].trim() !== '') {
        return characterOverrides[i];
      }
      // Fall back to manifest default
      return manifestDefaults?.[i] || `frame ${i + 1} of ${frameCount}`;
    });
  }

  if (options.verbose) {
    log(`  SD1.5 Prompt: ${prompt}`, 'debug');
    log(`  Identity reference: ${referenceImagePath}`, 'debug');
    log(`  IP-Adapter reference: ${preparedReferenceImagePath}`, 'debug');
    log(`  Guidance mode: ${guidance.mode}`, 'debug');
    log(`  ControlNet weight: ${guidance.controlnetWeight}`, 'debug');
    log(`  IP-Adapter weight: ${guidance.ipadapterWeight}`, 'debug');
    log(`  Reference LoRA: ${referenceLoraModel}`, 'debug');
    log(`  Animation LoRA: ${animationLoraModel}`, 'debug');
    if (options.referencePose && options.referencePose !== 'idle') {
      log(`  Reference pose: ${options.referencePose}`, 'debug');
    }
    if (options.autoReference) {
      log(`  Auto-reference: enabled`, 'debug');
    }
    if (characterOverrides?.some(o => o && o.trim() !== '')) {
      log(`  Using custom frame descriptions (overrides found)`, 'debug');
    }
  }

  // Generate animation with SD1.5 pipeline
  const result = await generateAnimation({
    characterId: character.id,
    animation,
    prompt,
    controlnetWeight: guidance.controlnetWeight,
    ipadapterWeight: guidance.ipadapterWeight,
    referenceImage: preparedReferenceImagePath,
    loraModel: animationLoraModel,
    seed: character.seed,
    outputPath,
    originalsDirectory: path.join(TEMP_DIR, 'originals', character.id, animation),
    frameDescriptions: effectiveFrameDescriptions,  // Per-frame motion prompts (with overrides merged)
    autoReference: options.autoReference
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
  // Never overwrite the portrait identity source. Reference-only mode creates
  // a full-body sibling in the canonical player-variant directory.
  const referenceImagePath = await getReferenceImagePath(character, { preferIdentitySource: false });

  // Check if already exists and not forcing
  if (fileExists(referenceImagePath) && !options.force) {
    log(`Reference image already exists: ${referenceImagePath}`, 'info');
    return { success: true, skipped: true };
  }

  // Ensure output directory exists
  ensureDirectoryExists(path.dirname(referenceImagePath));

  const referencePrompt = buildSD15ReferencePrompt(character, {
    loraModel: options.referenceLoraModel
  });

  if (options.verbose) {
    log(`  Reference prompt: ${referencePrompt}`, 'debug');
    log(`  Reference LoRA: ${options.referenceLoraModel}`, 'debug');
    log(`  ControlNet weight: ${options.controlnetWeight}`, 'debug');
    log(`  IP-Adapter weight: ${options.ipadapterWeight}`, 'debug');
  }

  const result = await generateReferenceImage({
    characterId: character.id,
    characterType: character._type,
    biome: character.biome,
    prompt: referencePrompt,
    seed: character.seed,
    outputPath: referenceImagePath,
    loraModel: options.referenceLoraModel,
    controlnetWeight: options.controlnetWeight,
    ipadapterWeight: options.ipadapterWeight,
    referencePose: options.referencePose
  }, {
    verbose: options.verbose,
    quiet: options.quiet,
    dryRun: options.dryRun
  });

  if (result.success && !options.dryRun) {
    log(`Reference image saved: ${referenceImagePath}`, 'success');

    // Update metadata with reference image path
    // Convert absolute path to relative for storage
    const relativePath = referenceImagePath.replace(
      path.join(PROJECT_ROOT, 'frontend/public'),
      ''
    );

    try {
      updateAssetStatus(
        'characters',
        character._sourceFile,
        character.id,
        {
          sd15Config: {
            ...character.sd15Config,
            referenceImage: relativePath,
            referenceGeneratedAt: new Date().toISOString()
          }
        }
      );
      log(`  Metadata updated with reference path: ${relativePath}`, 'debug');
    } catch (metadataError) {
      log(`  Warning: Failed to update metadata: ${metadataError.message}`, 'warn');
    }
  } else if (result.success) {
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

  // Find and update the character across variant, archetype, and enemy files.
  const charArray = data.variants || data.players || data.characters || data.enemies;
  if (!charArray) {
    log(`Warning: No character array found in ${sourceFile}`, 'warn');
    return;
  }
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

  try {
    // Validate an explicit mode before doing any metadata or generation work.
    if (options.mode) resolveGenerationMode(null, options.mode);
  } catch (error) {
    log(error.message, 'error');
    process.exit(1);
  }

  log(
    options.mode
      ? `Mode override: ${options.mode === 'sd15' ? 'SD1.5 (ControlNet + IP-Adapter)' : 'Flux (frame-by-frame)'}`
      : 'Mode: automatic (canonical player variants: SD1.5; enemies: Flux)',
    'info'
  );

  // Load metadata
  let metadata;
  try {
    metadata = loadCharacterMetadata({
      type: options.type,
      class: options.class,
      id: options.id
    });
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

  // Resolve and validate the full configuration before generating anything.
  // This prevents a category-level Flux LoRA (such as v1) from silently being
  // passed into an SD1.5 workflow.
  let characterPlans;
  try {
    characterPlans = filteredCharacters.map(character => ({
      character,
      generationConfig: resolveCharacterGenerationConfig(character, options, metadata.manifest)
    }));
  } catch (error) {
    log(`Invalid generation configuration: ${error.message}`, 'error');
    process.exit(1);
  }

  const modeCounts = characterPlans.reduce((counts, plan) => {
    counts[plan.generationConfig.mode]++;
    return counts;
  }, { flux: 0, sd15: 0 });
  log(`Resolved modes: ${modeCounts.sd15} SD1.5, ${modeCounts.flux} Flux`, 'info');

  // Handle --reference-only mode for SD1.5
  if (options.referenceOnly) {
    const nonSD15Plans = characterPlans.filter(plan => plan.generationConfig.mode !== 'sd15');
    if (nonSD15Plans.length > 0) {
      const sampleIds = nonSD15Plans.slice(0, 5).map(plan => plan.character.id).join(', ');
      const suffix = nonSD15Plans.length > 5 ? ', ...' : '';
      log(
        `--reference-only requires SD1.5 mode, but ${nonSD15Plans.length} selected character(s) ` +
        `resolved to Flux (${sampleIds}${suffix}). Pass --mode sd15 to override.`,
        'error'
      );
      process.exit(1);
    }

    log(`\nGenerating reference images for ${characterPlans.length} characters...`, 'info');

    const refResults = { success: [], failed: [], skipped: [] };

    for (let i = 0; i < characterPlans.length; i++) {
      const { character, generationConfig } = characterPlans[i];
      log(`[${i + 1}/${characterPlans.length}] ${character.id}`, 'info');

      try {
        const result = await generateReferenceOnly(character, {
          ...options,
          ...generationConfig
        });
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

      if (i < characterPlans.length - 1 && options.delay > 0) {
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

  for (const { character, generationConfig } of characterPlans) {
    const animations = getAnimationsToGenerate(character, options, metadata.animations);

    for (const animation of animations) {
      if (await needsGeneration(character, animation, options)) {
        animationsToGenerate.push({
          character,
          animation,
          animationConfig: metadata.animations[animation],
          generationConfig
        });
      }
    }
  }

  // Calculate skipped count (need async iteration)
  let skippedCount = 0;
  for (const char of filteredCharacters) {
    const anims = getAnimationsToGenerate(char, options, metadata.animations);
    for (const a of anims) {
      if (!(await needsGeneration(char, a, options))) {
        skippedCount++;
      }
    }
  }

  if (skippedCount > 0) {
    log(`Skipping ${skippedCount} animations (already exist or generated)`, 'info');
  }

  if (animationsToGenerate.length === 0) {
    log('No animations need generation', 'success');
    process.exit(0);
  }

  // ImageMagick is required if any selected item uses the legacy Flux pipeline.
  const hasFluxAnimations = animationsToGenerate.some(
    item => item.generationConfig.mode === 'flux'
  );
  if (!options.dryRun && hasFluxAnimations && !checkImageMagick()) {
    log('ImageMagick not found. Required for Flux sprite sheet concatenation.', 'error');
    log('Install with: sudo apt-get install imagemagick', 'info');
    process.exit(1);
  }

  log(`\nAnimations to generate: ${animationsToGenerate.length}`, 'info');
  console.log('');

  // Display what will be generated
  for (const item of animationsToGenerate) {
    const { character, animation, animationConfig, generationConfig } = item;
    console.log(`  - ${character.id} / ${animation}`);
    console.log(`    Type: ${character._type}`);
    console.log(`    Mode: ${generationConfig.mode === 'sd15' ? 'SD1.5 (ControlNet + IP-Adapter)' : 'Flux (frame-by-frame)'}`);
    console.log(`    Frames: ${FRAME_COUNT} (${FRAME_SIZE}x${FRAME_SIZE} each)`);
    console.log(`    Output: ${await getOutputPath(character, animation)}`);

    if (options.verbose) {
      if (generationConfig.mode === 'sd15') {
        const sd15Prompt = buildSD15CharacterPrompt(character, animation, {
          loraModel: generationConfig.animationLoraModel
        });
        console.log(`    SD1.5 prompt: ${sd15Prompt}`);
        console.log(`    Reference: ${options.reference || await getReferenceImagePath(character)}`);
        console.log(`    Reference LoRA: ${generationConfig.referenceLoraModel}`);
        console.log(`    Animation LoRA: ${generationConfig.animationLoraModel}`);
        console.log(`    ControlNet weight: ${generationConfig.controlnetWeight}`);
        console.log(`    IP-Adapter weight: ${generationConfig.ipadapterWeight}`);
      } else {
        const samplePrompt = buildFramePrompt(character, animation, 0, animationConfig);
        console.log(`    Sample prompt (frame 0): ${samplePrompt}`);
        console.log(`    Flux LoRA: ${generationConfig.loraModel}`);
      }
    }
    console.log('');
  }

  // Dry run - just display
  if (options.dryRun) {
    log(`\nDry run complete. Would generate ${animationsToGenerate.length} sprite sheets.`, 'success');
    const fluxAnimationCount = animationsToGenerate.filter(
      item => item.generationConfig.mode === 'flux'
    ).length;
    log(`Resolved modes: ${animationsToGenerate.length - fluxAnimationCount} SD1.5, ${fluxAnimationCount} Flux`, 'info');
    if (fluxAnimationCount > 0) {
      log(`Flux frames: ${fluxAnimationCount * FRAME_COUNT}`, 'info');
    }
    process.exit(0);
  }

  // Create backup if requested
  if (options.backup) {
    log('Creating backup of existing files...', 'info');
    // Collect existing output paths (async)
    const outputPaths = await Promise.all(
      animationsToGenerate.map(item => getOutputPath(item.character, item.animation))
    );
    const existingPaths = outputPaths.filter(p => fileExists(p));

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
    const { character, animation, animationConfig, generationConfig } = animationsToGenerate[i];
    const animationKey = `${character.id}/${animation}`;

    log(`[${i + 1}/${animationsToGenerate.length}] Generating: ${animationKey}`, 'info');

    try {
      // Ensure output directory exists
      const outputPath = await getOutputPath(character, animation);
      ensureDirectoryExists(path.dirname(outputPath));

      // Mode-specific generation
      if (generationConfig.mode === 'sd15') {
        // SD1.5 mode: Use ControlNet + IP-Adapter for consistent animations
        log(`  Using SD1.5 pipeline...`, 'info');

        const result = await generateSD15Animation(character, animation, animationConfig, {
          ...options,
          ...generationConfig
        });

        if (result.success) {
          const validation = await validateGeneratedSpriteSheet(outputPath, animation);
          if (!validation.valid) {
            const rejectedPath = quarantineGeneratedSprite(outputPath, character, animation);
            const reasons = validation.problems
              .map(problem => `${problem.code}: ${problem.message}`)
              .join('; ');
            results.failed.push({
              id: animationKey,
              error: `Generated sheet failed runtime validation: ${reasons}`,
              rejectedPath
            });
            log(`Rejected: ${animationKey} - ${reasons}`, 'error');
            log(`Preserved rejected sheet: ${rejectedPath}`, 'info');
            continue;
          }

          // Convert PNG sprite sheet to WebP format
          const webpResult = await convertToWebp(outputPath, { verbose: options.verbose });
          const finalPath = webpResult.success ? webpResult.webpPath : outputPath;

          if (!webpResult.success) {
            log(`Warning: WebP conversion failed for ${outputPath}: ${webpResult.error}`, 'warn');
          }

          results.success.push({ id: animationKey, character, animation, generationConfig });
          markAnimationGenerated(character, animation);
          log(`Generated: ${animationKey}`, 'success');
          log(`Saved: ${finalPath}`, 'info');

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
            loraModel: generationConfig.loraModel
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
          // Convert PNG sprite sheet to WebP format
          const webpResult = await convertToWebp(outputPath, { verbose: options.verbose });
          const finalPath = webpResult.success ? webpResult.webpPath : outputPath;

          if (!webpResult.success) {
            log(`Warning: WebP conversion failed for ${outputPath}: ${webpResult.error}`, 'warn');
          }

          results.success.push({ id: animationKey, character, animation, generationConfig });
          markAnimationGenerated(character, animation);
          log(`Generated: ${animationKey}`, 'success');
          log(`Saved: ${finalPath}`, 'info');

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
  const successfulFluxCount = results.success.filter(
    result => result.generationConfig.mode === 'flux'
  ).length;
  const successfulSD15Count = results.success.length - successfulFluxCount;
  console.log(`  Modes: ${successfulSD15Count} SD1.5, ${successfulFluxCount} Flux`);
  console.log(`  Sprite sheets: ${results.success.length}`);
  if (successfulFluxCount > 0) {
    console.log(`  Flux frames generated: ${successfulFluxCount * FRAME_COUNT}`);
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

module.exports = {
  firstConfiguredValue,
  resolveGenerationMode,
  validateLoraForMode,
  validateGuidanceWeight,
  resolveCharacterGenerationConfig,
  prepareAnimationReference,
  resolveAnimationGuidance,
  validateGeneratedSpriteSheet,
  quarantineGeneratedSprite
};

if (require.main === module) {
  main().catch(error => {
    log(`Unexpected error: ${error.message}`, 'error');
    console.error(error);
    process.exit(1);
  });
}
