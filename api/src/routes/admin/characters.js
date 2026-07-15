/**
 * @module admin/characters
 * @description Character animation management routes for SD1.5 generation
 *
 * Key responsibilities:
 * - Animation listing with generation status
 * - SD1.5 animation generation with ControlNet/IP-Adapter weights
 * - Reference image management for IP-Adapter
 * - SD1.5 weight configuration and presets
 * - Frame description overrides per character
 *
 * Route groups:
 * - GET /assets/characters/:id/animations - List animations with status
 * - POST /assets/characters/:id/animations/:animation/generate - Generate animation
 * - GET /assets/characters/:id/reference - Get reference image status
 * - POST /assets/characters/:id/reference/generate - Generate reference image
 * - PUT /assets/characters/:id/weights - Update SD1.5 weights
 * - GET /assets/characters/:id/weights/presets - Get weight presets
 * - GET /assets/characters/:id/frame-descriptions - Get frame descriptions
 * - PUT /assets/characters/:id/frame-descriptions - Update frame descriptions
 * - DELETE /assets/characters/:id/frame-descriptions/:animation - Delete animation overrides
 *
 * @see shared.js - Common utilities and helpers
 * @see adminGenerationService.js - Queue management service
 */

import express from 'express';
import path from 'path';
import { existsSync } from 'fs';
import { AppError, asyncHandler } from '../../middleware/errorHandler.js';
import { VALID_SD15_LORA_MODELS } from '../../utils/assetConstants.js';
import { assertValidAssetId, fileLocks } from '../../utils/assetLocking.js';
import adminGenerationService from '../../services/adminGenerationService.js';
import { resolveSd15CandidateDefaults } from './characterGenerationDefaults.js';
import {
  PROJECT_ROOT,
  METADATA_DIR,
  metadataUtils,
  ensureUtilities,
} from './shared.js';

const router = express.Router();

// ============================================================================
// ANIMATION MANAGEMENT
// ============================================================================

/**
 * GET /assets/characters/:id/animations
 * List animations for a character with generation status
 * Returns all animations defined for the character with their generation status
 */
router.get('/:id/animations', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { id } = req.params;

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Character');

  // Load character metadata
  const charData = metadataUtils.loadCharacterMetadata({ id });
  const character = charData.characters.find(c => c.id === id);

  if (!character) {
    throw new AppError(`Character not found: ${id}`, 404);
  }

  // Get animations list - either from character or from class traits
  const animations = character.animations || character._classTraits?.defaultAnimations || [];
  const generatedAnimations = character.generatedAnimations || {};

  // Build animation status list
  const animationStatus = animations.map(animation => ({
    animation,
    generated: generatedAnimations[animation] === true,
    generatedAt: generatedAnimations[`${animation}_generatedAt`] || null
  }));

  // Load manifest for animation descriptions
  const manifest = charData.manifest;
  const animationDescriptions = manifest?.animations || {};

  res.json({
    characterId: id,
    characterType: character._type,
    totalAnimations: animations.length,
    generatedCount: animationStatus.filter(a => a.generated).length,
    sd15Config: character.sd15Config || {
      controlnetWeight: null,
      ipadapterWeight: null,
      referenceImage: null,
      referenceGeneratedAt: null
    },
    animations: animationStatus.map(status => ({
      ...status,
      description: animationDescriptions[status.animation]?.description || null,
      frameCount: animationDescriptions[status.animation]?.frameCount || 8
    }))
  });
}));

/**
 * POST /assets/characters/:id/animations/:animation/generate
 * Generate a single animation for a character using SD1.5
 * Body: { controlnetWeight?: number, ipadapterWeight?: number, force?: boolean, loraModel?: string }
 */
router.post('/:id/animations/:animation/generate', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { id, animation } = req.params;
  const { controlnetWeight, ipadapterWeight, force = false, preset, loraModel } = req.body;

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Character');

  // Validate animation name (alphanumeric and underscore only)
  if (!/^[a-zA-Z0-9_]+$/.test(animation)) {
    throw new AppError('Invalid animation name', 400);
  }

  // Load character metadata
  const charData = metadataUtils.loadCharacterMetadata({ id });
  const character = charData.characters.find(c => c.id === id);

  if (!character) {
    throw new AppError(`Character not found: ${id}`, 404);
  }

  // Verify the animation exists for this character
  const validAnimations = character.animations || character._classTraits?.defaultAnimations || [];
  if (!validAnimations.includes(animation)) {
    throw new AppError(`Animation '${animation}' not valid for character '${id}'. Valid: ${validAnimations.join(', ')}`, 400);
  }

  // Load weight presets from manifest if preset specified
  let effectiveControlnetWeight = controlnetWeight;
  let effectiveIpadapterWeight = ipadapterWeight;

  if (preset) {
    const weightPresets = charData.manifest?.weightPresets || {};
    const selectedPreset = weightPresets[preset];
    if (!selectedPreset) {
      throw new AppError(`Invalid preset: ${preset}. Valid: ${Object.keys(weightPresets).join(', ')}`, 400);
    }
    effectiveControlnetWeight = effectiveControlnetWeight ?? selectedPreset.controlnet;
    effectiveIpadapterWeight = effectiveIpadapterWeight ?? selectedPreset.ipadapter;
  }

  // Fall back to character's sd15Config, then manifest defaults
  const sd15Config = character.sd15Config || {};
  const manifestDefaults = resolveSd15CandidateDefaults(charData.manifest);

  effectiveControlnetWeight = effectiveControlnetWeight ?? sd15Config.controlnetWeight ?? manifestDefaults.controlnetWeight ?? 0.5;
  effectiveIpadapterWeight = effectiveIpadapterWeight ?? sd15Config.ipadapterWeight ?? manifestDefaults.ipadapterWeight ?? 0.5;

  // Validate weight ranges
  if (effectiveControlnetWeight < 0 || effectiveControlnetWeight > 1) {
    throw new AppError('controlnetWeight must be between 0 and 1', 400);
  }
  if (effectiveIpadapterWeight < 0 || effectiveIpadapterWeight > 1) {
    throw new AppError('ipadapterWeight must be between 0 and 1', 400);
  }

  // Validate loraModel if provided
  if (loraModel && !VALID_SD15_LORA_MODELS.includes(loraModel)) {
    throw new AppError(`Invalid loraModel: ${loraModel}. Valid: ${VALID_SD15_LORA_MODELS.join(', ')}`, 400);
  }

  // Check if reference image exists (required for SD1.5 mode)
  if (!sd15Config.referenceImage) {
    throw new AppError('Reference image required for SD1.5 generation. Generate reference image first.', 400);
  }

  try {
    // Queue the generation job with SD1.5 options
    const result = adminGenerationService.queueJob(
      'characters',
      {
        keys: [id],
        animation // Pass specific animation to generate
      },
      {
        force,
        sd15Mode: true,
        controlnetWeight: effectiveControlnetWeight,
        ipadapterWeight: effectiveIpadapterWeight,
        animation, // Specific animation to generate
        loraModel  // SD1.5 LoRA model for animation generation
      }
    );

    res.status(202).json({
      message: `Queued SD1.5 generation for ${id}/${animation}`,
      characterId: id,
      animation,
      weights: {
        controlnet: effectiveControlnetWeight,
        ipadapter: effectiveIpadapterWeight
      },
      loraModel: loraModel || null,
      ...result
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Admin character generation error:', err);
    throw new AppError('Character generation failed', 500);
  }
}));

// ============================================================================
// REFERENCE IMAGE MANAGEMENT
// ============================================================================

/**
 * GET /assets/characters/:id/reference
 * Get reference image status for a character
 */
router.get('/:id/reference', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { id } = req.params;

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Character');

  // Load character metadata
  const charData = metadataUtils.loadCharacterMetadata({ id });
  const character = charData.characters.find(c => c.id === id);

  if (!character) {
    throw new AppError(`Character not found: ${id}`, 404);
  }

  const sd15Config = character.sd15Config || {};

  // Check if reference image file exists
  let referenceExists = false;
  if (sd15Config.referenceImage) {
    const refPath = path.join(PROJECT_ROOT, 'frontend/public', sd15Config.referenceImage);
    referenceExists = existsSync(refPath);
  }

  res.json({
    characterId: id,
    // Fields expected by UI
    exists: !!sd15Config.referenceImage && referenceExists,
    path: sd15Config.referenceImage || null,
    generatedAt: sd15Config.referenceGeneratedAt || null,
    // Backward compatibility
    hasReference: !!sd15Config.referenceImage && referenceExists,
    referenceImage: sd15Config.referenceImage || null,
    referenceGeneratedAt: sd15Config.referenceGeneratedAt || null,
    referenceExists,
    sd15Weights: {
      controlnet: sd15Config.controlnetWeight,
      ipadapter: sd15Config.ipadapterWeight,
      loraModel: sd15Config.loraModel || null,
      referenceLoraModel: sd15Config.referenceLoraModel || null,
      animationLoraModel: sd15Config.animationLoraModel || null
    }
  });
}));

/**
 * POST /assets/characters/:id/reference/generate
 * Generate reference image for a character (used for SD1.5 IP-Adapter)
 * Body: { force?: boolean, loraModel?: string, referencePose?: 'idle' | 'tpose' }
 */
router.post('/:id/reference/generate', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { id } = req.params;
  const { force = false, loraModel, referencePose } = req.body;

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Character');

  // Load character metadata
  const charData = metadataUtils.loadCharacterMetadata({ id });
  const character = charData.characters.find(c => c.id === id);

  if (!character) {
    throw new AppError(`Character not found: ${id}`, 404);
  }

  // Validate loraModel if provided
  if (loraModel && !VALID_SD15_LORA_MODELS.includes(loraModel)) {
    throw new AppError(`Invalid loraModel: ${loraModel}. Valid: ${VALID_SD15_LORA_MODELS.join(', ')}`, 400);
  }

  // Validate referencePose if provided
  const validPoses = ['idle', 'tpose'];
  if (referencePose && !validPoses.includes(referencePose)) {
    throw new AppError(`Invalid referencePose: ${referencePose}. Valid: ${validPoses.join(', ')}`, 400);
  }

  // Check if reference already exists (unless force)
  const sd15Config = character.sd15Config || {};
  if (sd15Config.referenceImage && !force) {
    const refPath = path.join(PROJECT_ROOT, 'frontend/public', sd15Config.referenceImage);
    if (existsSync(refPath)) {
      return res.status(200).json({
        message: 'Reference image already exists. Use force=true to regenerate.',
        characterId: id,
        referenceImage: sd15Config.referenceImage,
        referenceGeneratedAt: sd15Config.referenceGeneratedAt
      });
    }
  }

  try {
    // Queue the generation job for reference image only
    const result = adminGenerationService.queueJob(
      'characters',
      {
        keys: [id]
      },
      {
        force,
        referenceOnly: true, // Special flag for reference image generation
        sd15Mode: true,      // Required for reference-only generation
        loraModel,           // SD1.5 LoRA model for reference generation
        referencePose        // Reference pose: 'idle' or 'tpose'
      }
    );

    res.status(202).json({
      message: `Queued reference image generation for ${id}`,
      characterId: id,
      loraModel: loraModel || null,
      referencePose: referencePose || 'idle',
      ...result
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error('Admin character pose generation error:', err);
    throw new AppError('Pose generation failed', 500);
  }
}));

// ============================================================================
// WEIGHT CONFIGURATION
// ============================================================================

/**
 * PUT /assets/characters/:id/weights
 * Update character SD1.5 weights and LoRA models
 * Body: {
 *   controlnetWeight?: number,
 *   ipadapterWeight?: number,
 *   preset?: string,
 *   loraModel?: string,           // Legacy: single LoRA for both (deprecated)
 *   referenceLoraModel?: string,  // LoRA for reference image generation
 *   animationLoraModel?: string   // LoRA for animation frame generation
 * }
 */
router.put('/:id/weights', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { id } = req.params;
  const { controlnetWeight, ipadapterWeight, preset, loraModel, referenceLoraModel, animationLoraModel } = req.body;

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Character');

  // Load character metadata
  const charData = metadataUtils.loadCharacterMetadata({ id });
  const character = charData.characters.find(c => c.id === id);

  if (!character) {
    throw new AppError(`Character not found: ${id}`, 404);
  }

  // Determine effective weights
  let effectiveControlnetWeight = controlnetWeight;
  let effectiveIpadapterWeight = ipadapterWeight;

  // Apply preset if specified
  if (preset) {
    const weightPresets = charData.manifest?.weightPresets || {};
    const selectedPreset = weightPresets[preset];
    if (!selectedPreset) {
      throw new AppError(`Invalid preset: ${preset}. Valid: ${Object.keys(weightPresets).join(', ')}`, 400);
    }
    effectiveControlnetWeight = effectiveControlnetWeight ?? selectedPreset.controlnet;
    effectiveIpadapterWeight = effectiveIpadapterWeight ?? selectedPreset.ipadapter;
  }

  // Validate weight ranges
  if (effectiveControlnetWeight !== undefined && effectiveControlnetWeight !== null) {
    if (effectiveControlnetWeight < 0 || effectiveControlnetWeight > 1) {
      throw new AppError('controlnetWeight must be between 0 and 1', 400);
    }
  }
  if (effectiveIpadapterWeight !== undefined && effectiveIpadapterWeight !== null) {
    if (effectiveIpadapterWeight < 0 || effectiveIpadapterWeight > 1) {
      throw new AppError('ipadapterWeight must be between 0 and 1', 400);
    }
  }

  // Validate loraModel fields if provided
  if (loraModel && !VALID_SD15_LORA_MODELS.includes(loraModel)) {
    throw new AppError(`Invalid loraModel: ${loraModel}. Valid: ${VALID_SD15_LORA_MODELS.join(', ')}`, 400);
  }
  if (referenceLoraModel && !VALID_SD15_LORA_MODELS.includes(referenceLoraModel)) {
    throw new AppError(`Invalid referenceLoraModel: ${referenceLoraModel}. Valid: ${VALID_SD15_LORA_MODELS.join(', ')}`, 400);
  }
  if (animationLoraModel && !VALID_SD15_LORA_MODELS.includes(animationLoraModel)) {
    throw new AppError(`Invalid animationLoraModel: ${animationLoraModel}. Valid: ${VALID_SD15_LORA_MODELS.join(', ')}`, 400);
  }

  // Build update object for sd15Config
  const sd15Config = character.sd15Config || {};
  const updates = {
    sd15Config: {
      ...sd15Config,
      ...(effectiveControlnetWeight !== undefined && { controlnetWeight: effectiveControlnetWeight }),
      ...(effectiveIpadapterWeight !== undefined && { ipadapterWeight: effectiveIpadapterWeight }),
      ...(loraModel !== undefined && { loraModel: loraModel || null }),
      ...(referenceLoraModel !== undefined && { referenceLoraModel: referenceLoraModel || null }),
      ...(animationLoraModel !== undefined && { animationLoraModel: animationLoraModel || null })
    }
  };

  // Apply updates with file locking
  const filePath = path.join(METADATA_DIR, 'characters', character._sourceFile);
  await fileLocks.withFileLock(filePath, async () => {
    try {
      metadataUtils.updateAssetStatus('characters', character._sourceFile, id, updates);
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error(`Failed to update character weights for ${id}:`, error);
      throw new AppError('Failed to update character weights', 500);
    }
  });

  // Reload to return updated character
  const updatedCharData = metadataUtils.loadCharacterMetadata({ id });
  const updatedCharacter = updatedCharData.characters.find(c => c.id === id);

  res.json({
    message: 'Character SD1.5 weights updated successfully',
    characterId: id,
    sd15Config: updatedCharacter.sd15Config,
    appliedPreset: preset || null
  });
}));

/**
 * GET /assets/characters/:id/weights/presets
 * Get available weight presets for SD1.5 generation
 */
router.get('/:id/weights/presets', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { id } = req.params;

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Character');

  // Load character manifest for presets
  const charData = metadataUtils.loadCharacterMetadata({ id });
  const character = charData.characters.find(c => c.id === id);

  if (!character) {
    throw new AppError(`Character not found: ${id}`, 404);
  }

  const weightPresets = charData.manifest?.weightPresets || {};
  res.json({
    characterId: id,
    currentConfig: character.sd15Config || {},
    generationDefaults: resolveSd15CandidateDefaults(charData.manifest),
    presets: Object.entries(weightPresets).map(([name, values]) => ({
      name,
      controlnetWeight: values.controlnet,
      ipadapterWeight: values.ipadapter,
      description: getPresetDescription(name)
    }))
  });
}));

/**
 * Get human-readable description for a weight preset
 * @param {string} presetName - Name of the preset
 * @returns {string} Description
 */
function getPresetDescription(presetName) {
  const descriptions = {
    balanced: 'Equal weight between pose accuracy and character consistency',
    maxConsistency: 'Prioritizes character appearance consistency over pose accuracy',
    precisePoses: 'Prioritizes accurate pose matching over character consistency',
    creative: 'Lower weights for more creative/varied outputs'
  };
  return descriptions[presetName] || 'Custom preset';
}

// ============================================================================
// FRAME DESCRIPTION OVERRIDES
// ============================================================================

/**
 * GET /assets/characters/:id/frame-descriptions
 * Get frame description overrides for a character
 * Returns both default descriptions from manifest and any character-specific overrides
 */
router.get('/:id/frame-descriptions', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { id } = req.params;
  const { animation } = req.query;

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Character');

  // Load character metadata
  const charData = metadataUtils.loadCharacterMetadata({ id });
  const character = charData.characters.find(c => c.id === id);

  if (!character) {
    throw new AppError(`Character not found: ${id}`, 404);
  }

  // Get animations from manifest
  const manifestAnimations = charData.manifest?.animations || {};

  // Get character's frame description overrides
  const overrides = character.frameDescriptionOverrides || {};

  // Build response with defaults and overrides per animation
  const animations = character.animations || character._classTraits?.defaultAnimations || [];

  // If specific animation requested, return just that one
  if (animation) {
    if (!animations.includes(animation)) {
      throw new AppError(`Animation '${animation}' not valid for character '${id}'`, 400);
    }

    const animConfig = manifestAnimations[animation] || {};
    const animOverrides = overrides[animation] || [];

    return res.json({
      characterId: id,
      animation,
      defaults: animConfig.frameDescriptions || [],
      overrides: animOverrides,
      description: animConfig.description || null,
      frameCount: animConfig.frameCount || 8
    });
  }

  // Return all animations
  const result = {};
  for (const anim of animations) {
    const animConfig = manifestAnimations[anim] || {};
    result[anim] = {
      defaults: animConfig.frameDescriptions || [],
      overrides: overrides[anim] || [],
      description: animConfig.description || null,
      frameCount: animConfig.frameCount || 8
    };
  }

  res.json({
    characterId: id,
    animations: result,
    hasOverrides: Object.keys(overrides).length > 0
  });
}));

/**
 * PUT /assets/characters/:id/frame-descriptions
 * Update frame description overrides for a character
 * Body: { frameDescriptionOverrides: { animation: [frame1, frame2, ...], ... } }
 */
router.put('/:id/frame-descriptions', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { id } = req.params;
  const { frameDescriptionOverrides } = req.body;

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Character');

  // Validate input structure
  if (frameDescriptionOverrides !== undefined && frameDescriptionOverrides !== null) {
    if (typeof frameDescriptionOverrides !== 'object' || Array.isArray(frameDescriptionOverrides)) {
      throw new AppError('frameDescriptionOverrides must be an object', 400);
    }

    // Validate each animation's overrides
    for (const [animation, frames] of Object.entries(frameDescriptionOverrides)) {
      // Validate animation name (alphanumeric and underscore only)
      if (!/^[a-zA-Z0-9_]+$/.test(animation)) {
        throw new AppError(`Invalid animation name: ${animation}`, 400);
      }

      // Validate frames array
      if (!Array.isArray(frames)) {
        throw new AppError(`Frame descriptions for '${animation}' must be an array`, 400);
      }

      if (frames.length > 8) {
        throw new AppError(`Frame descriptions for '${animation}' cannot exceed 8 elements`, 400);
      }

      // Validate each frame description
      for (let i = 0; i < frames.length; i++) {
        if (frames[i] !== '' && typeof frames[i] !== 'string') {
          throw new AppError(`Frame ${i + 1} in '${animation}' must be a string`, 400);
        }
        // Limit frame description length
        if (frames[i] && frames[i].length > 500) {
          throw new AppError(`Frame ${i + 1} description in '${animation}' exceeds 500 characters`, 400);
        }
      }
    }
  }

  // Load character metadata
  const charData = metadataUtils.loadCharacterMetadata({ id });
  const character = charData.characters.find(c => c.id === id);

  if (!character) {
    throw new AppError(`Character not found: ${id}`, 404);
  }

  // Clean up overrides - remove animations with all empty frames
  const cleanedOverrides = {};
  if (frameDescriptionOverrides) {
    for (const [animation, frames] of Object.entries(frameDescriptionOverrides)) {
      // Check if any frames have content
      const hasContent = frames.some(f => f && f.trim() !== '');
      if (hasContent) {
        // Pad array to 8 elements with empty strings
        const paddedFrames = Array.from({ length: 8 }, (_, i) => frames[i] || '');
        cleanedOverrides[animation] = paddedFrames;
      }
    }
  }

  // Build update object
  const updates = {
    frameDescriptionOverrides: Object.keys(cleanedOverrides).length > 0 ? cleanedOverrides : null
  };

  // Apply updates with file locking
  const filePath = path.join(METADATA_DIR, 'characters', character._sourceFile);
  await fileLocks.withFileLock(filePath, async () => {
    try {
      metadataUtils.updateAssetStatus('characters', character._sourceFile, id, updates);
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error(`Failed to update frame descriptions for ${id}:`, error);
      throw new AppError('Failed to update frame descriptions', 500);
    }
  });

  // Reload to return updated character
  const updatedCharData = metadataUtils.loadCharacterMetadata({ id });
  const updatedCharacter = updatedCharData.characters.find(c => c.id === id);

  res.json({
    message: 'Frame descriptions updated successfully',
    characterId: id,
    frameDescriptionOverrides: updatedCharacter.frameDescriptionOverrides || null,
    overrideCount: Object.keys(updatedCharacter.frameDescriptionOverrides || {}).length
  });
}));

/**
 * DELETE /assets/characters/:id/frame-descriptions/:animation
 * Remove frame description overrides for a specific animation
 */
router.delete('/:id/frame-descriptions/:animation', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { id, animation } = req.params;

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Character');

  // Validate animation name
  if (!/^[a-zA-Z0-9_]+$/.test(animation)) {
    throw new AppError('Invalid animation name', 400);
  }

  // Load character metadata
  const charData = metadataUtils.loadCharacterMetadata({ id });
  const character = charData.characters.find(c => c.id === id);

  if (!character) {
    throw new AppError(`Character not found: ${id}`, 404);
  }

  // Remove the specific animation from overrides
  const currentOverrides = character.frameDescriptionOverrides || {};
  if (!currentOverrides[animation]) {
    return res.json({
      message: `No overrides found for animation '${animation}'`,
      characterId: id,
      animation
    });
  }

  const newOverrides = { ...currentOverrides };
  delete newOverrides[animation];

  // Build update object
  const updates = {
    frameDescriptionOverrides: Object.keys(newOverrides).length > 0 ? newOverrides : null
  };

  // Apply updates with file locking
  const filePath = path.join(METADATA_DIR, 'characters', character._sourceFile);
  await fileLocks.withFileLock(filePath, async () => {
    try {
      metadataUtils.updateAssetStatus('characters', character._sourceFile, id, updates);
    } catch (error) {
      if (error instanceof AppError) throw error;
      console.error(`Failed to remove frame descriptions for ${id}:`, error);
      throw new AppError('Failed to remove frame descriptions', 500);
    }
  });

  res.json({
    message: `Removed frame description overrides for '${animation}'`,
    characterId: id,
    animation,
    remainingOverrides: Object.keys(newOverrides)
  });
}));

export default router;
