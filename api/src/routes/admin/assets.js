/**
 * @module admin/assets
 * @description Asset CRUD operations for AI-generated image management
 *
 * Key responsibilities:
 * - Asset listing and filtering by category (tiles, portraits, items, icons, nodes, overlays, obstacles, characters)
 * - Single asset retrieval with prompt construction
 * - Asset metadata updates (prompts, seeds, evaluation status)
 * - Regeneration marking (single and bulk)
 * - Bulk metadata updates
 * - Regeneration queue management (get, clear, process)
 * - Asset statistics
 *
 * Route groups:
 * - GET /assets/:category - List assets with filters
 * - GET /assets/:category/:id - Get single asset
 * - GET /assets/:category/:id/prompt - Get prompt breakdown
 * - PUT /assets/:category/:id - Update asset metadata
 * - PUT /assets/:category/:id/mark-regeneration - Mark for regeneration
 * - PUT /assets/mark-multiple - Bulk regeneration marking
 * - POST /assets/bulk-update - Bulk metadata updates
 * - GET /regeneration-queue - Get all queued items
 * - POST /regeneration-queue/clear - Clear the queue
 * - POST /generate/regeneration-queue - Process the queue
 * - GET /stats - Generation statistics
 *
 * @see shared.js - Common utilities and helpers
 * @see adminGenerationService.js - Queue management service
 */

import express from 'express';
import path from 'path';
import { AppError, asyncHandler } from '../../middleware/errorHandler.js';
import { loadJsonFile, saveJsonFile } from '../../utils/jsonFileUtils.js';
import { VALID_CATEGORIES, VALID_LORA_MODELS } from '../../utils/assetConstants.js';
import { assertValidAssetId, validateAssetIds, fileLocks } from '../../utils/assetLocking.js';
import adminGenerationService from '../../services/adminGenerationService.js';
import {
  PROJECT_ROOT,
  METADATA_DIR,
  metadataUtils,
  ensureUtilities,
  loadTraitData,
  constructPortraitPrompt,
  constructCharacterPrompt,
  constructFullPrompt,
  enrichAssetWithPath,
  findAssetById,
} from './shared.js';

const router = express.Router();

// ============================================================================
// STATISTICS (must be before /:category to avoid being caught by param route)
// ============================================================================

/**
 * GET /stats
 * Generation statistics for all categories
 */
router.get('/stats', asyncHandler(async (req, res) => {
  ensureUtilities();

  try {
    const stats = metadataUtils.getAllStats();
    res.json(stats);
  } catch (error) {
    throw new AppError(`Failed to get stats: ${error.message}`, 500);
  }
}));

// ============================================================================
// REGENERATION QUEUE (must be before /:category to avoid being caught by param route)
// ============================================================================

/**
 * GET /regeneration-queue
 * Get all assets marked for regeneration across all categories (image + audio)
 */
router.get('/regeneration-queue', asyncHandler(async (req, res) => {
  ensureUtilities();

  const queue = {};
  let totalCount = 0;

  // Load image assets
  for (const category of VALID_CATEGORIES) {
    try {
      const data = metadataUtils.loadCategoryAssets(category);
      const needsRegen = data.assets.filter(a => a.needsRegeneration === true);
      if (needsRegen.length > 0) {
        queue[category] = needsRegen;
        totalCount += needsRegen.length;
      }
    } catch (error) {
      console.warn(`[Admin] Failed to load ${category} for queue:`, error.message);
    }
  }

  // Load audio assets (music and SFX)
  const AUDIO_METADATA_DIR = path.join(PROJECT_ROOT, 'audio-metadata');

  // Load music tracks
  try {
    const musicManifest = await loadJsonFile(path.join(AUDIO_METADATA_DIR, 'music/manifest.json'));
    if (musicManifest) {
      const musicTracks = [];
      for (const [cat, info] of Object.entries(musicManifest.categories || {})) {
        for (const file of (info.files || [])) {
          const data = await loadJsonFile(path.join(AUDIO_METADATA_DIR, 'music', file));
          if (data?.tracks) {
            for (const track of data.tracks) {
              if (track.needsRegeneration === true) {
                musicTracks.push({ ...track, _sourceFile: file, _category: cat });
              }
            }
          }
        }
      }
      if (musicTracks.length > 0) {
        queue.music = musicTracks;
        totalCount += musicTracks.length;
      }
    }
  } catch (error) {
    console.warn('[Admin] Failed to load music for queue:', error.message);
  }

  // Load SFX effects
  try {
    const sfxManifest = await loadJsonFile(path.join(AUDIO_METADATA_DIR, 'sfx/manifest.json'));
    if (sfxManifest) {
      const sfxEffects = [];
      for (const [cat, info] of Object.entries(sfxManifest.categories || {})) {
        for (const file of (info.files || [])) {
          const data = await loadJsonFile(path.join(AUDIO_METADATA_DIR, 'sfx', file));
          if (data?.effects) {
            for (const effect of data.effects) {
              if (effect.needsRegeneration === true) {
                sfxEffects.push({ ...effect, _sourceFile: file, _category: cat });
              }
            }
          }
        }
      }
      if (sfxEffects.length > 0) {
        queue.sfx = sfxEffects;
        totalCount += sfxEffects.length;
      }
    }
  } catch (error) {
    console.warn('[Admin] Failed to load SFX for queue:', error.message);
  }

  res.json({
    totalCount,
    queue
  });
}));

/**
 * POST /regeneration-queue/clear
 * Clear all items from the regeneration queue
 * Body: { category?: string }
 */
router.post('/regeneration-queue/clear', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { category } = req.body;
  const AUDIO_METADATA_DIR = path.join(PROJECT_ROOT, 'audio-metadata');
  const ALL_CATEGORIES = [...VALID_CATEGORIES, 'music', 'sfx'];

  // If category specified, validate it
  if (category && !ALL_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}`, 400);
  }

  let totalCleared = 0;

  // Handle image categories
  const imageCategoriesToClear = category
    ? (VALID_CATEGORIES.includes(category) ? [category] : [])
    : VALID_CATEGORIES;

  for (const cat of imageCategoriesToClear) {
    try {
      const data = metadataUtils.loadCategoryAssets(cat);
      const needsRegen = data.assets.filter(a => a.needsRegeneration === true);

      for (const asset of needsRegen) {
        try {
          metadataUtils.updateAssetStatus(cat, asset._sourceFile, asset.id, {
            needsRegeneration: false,
            regenerationQueuedAt: null
          });
          totalCleared++;
        } catch (error) {
          console.warn(`[Admin] Failed to clear ${cat}/${asset.id}:`, error.message);
        }
      }
    } catch (error) {
      console.warn(`[Admin] Failed to load ${cat} for clearing:`, error.message);
    }
  }

  // Handle music if no category or category is 'music'
  if (!category || category === 'music') {
    try {
      const musicManifest = await loadJsonFile(path.join(AUDIO_METADATA_DIR, 'music/manifest.json'));
      if (musicManifest) {
        for (const [_cat, info] of Object.entries(musicManifest.categories || {})) {
          for (const file of (info.files || [])) {
            const filePath = path.join(AUDIO_METADATA_DIR, 'music', file);
            const data = await loadJsonFile(filePath);
            if (data?.tracks) {
              let modified = false;
              for (const track of data.tracks) {
                if (track.needsRegeneration === true) {
                  track.needsRegeneration = false;
                  delete track.regenerationQueuedAt;
                  totalCleared++;
                  modified = true;
                }
              }
              if (modified) {
                await saveJsonFile(filePath, data);
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn('[Admin] Failed to clear music queue:', error.message);
    }
  }

  // Handle SFX if no category or category is 'sfx'
  if (!category || category === 'sfx') {
    try {
      const sfxManifest = await loadJsonFile(path.join(AUDIO_METADATA_DIR, 'sfx/manifest.json'));
      if (sfxManifest) {
        for (const [_cat, info] of Object.entries(sfxManifest.categories || {})) {
          for (const file of (info.files || [])) {
            const filePath = path.join(AUDIO_METADATA_DIR, 'sfx', file);
            const data = await loadJsonFile(filePath);
            if (data?.effects) {
              let modified = false;
              for (const effect of data.effects) {
                if (effect.needsRegeneration === true) {
                  effect.needsRegeneration = false;
                  delete effect.regenerationQueuedAt;
                  totalCleared++;
                  modified = true;
                }
              }
              if (modified) {
                await saveJsonFile(filePath, data);
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn('[Admin] Failed to clear SFX queue:', error.message);
    }
  }

  res.json({
    message: `Cleared ${totalCleared} items from regeneration queue`,
    cleared: totalCleared,
    category: category || 'all'
  });
}));

/**
 * POST /generate/regeneration-queue
 * Process all assets marked for regeneration
 * Body: { category?: string, options?: object }
 */
router.post('/generate/regeneration-queue', asyncHandler(async (req, res) => {
  const { category, options = {} } = req.body;

  // Validate category if provided
  if (category && !VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}. Valid: ${VALID_CATEGORIES.join(', ')}`, 400);
  }

  try {
    if (category) {
      // Single category specified
      const result = adminGenerationService.queueJob(
        category,
        { queueMode: true },
        { ...options, force: true }
      );
      res.status(202).json({
        message: 'Regeneration queue job started',
        ...result
      });
    } else {
      // No category specified - queue jobs for all categories that have pending items
      ensureUtilities();
      const results = [];
      for (const cat of VALID_CATEGORIES) {
        try {
          const queued = metadataUtils.loadRegenerationQueue(cat);
          console.log(`[Admin] Regeneration queue for ${cat}: ${queued.length} items`);
          if (queued.length > 0) {
            const result = adminGenerationService.queueJob(
              cat,
              { queueMode: true },
              { ...options, force: true }
            );
            results.push({ category: cat, count: queued.length, ...result });
          }
        } catch (catErr) {
          console.warn(`[Admin] Failed to load regeneration queue for ${cat}:`, catErr.message);
        }
      }
      if (results.length === 0) {
        res.json({ message: 'No items in regeneration queue' });
      } else {
        res.status(202).json({
          message: `Queued ${results.length} generation jobs`,
          jobs: results
        });
      }
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(err.message, 500);
  }
}));

// ============================================================================
// BULK OPERATIONS (must be before /:category to avoid being caught by param route)
// ============================================================================

/**
 * PUT /mark-multiple
 * Mark multiple assets for regeneration at once
 * Body: { category: string, ids: string[], mark: boolean, biome?: string }
 * Note: For tiles, biome is required to disambiguate assets with same ID
 *
 * SECURITY: Validates all IDs before processing
 * ATOMICITY: Groups updates by source file with file locking
 */
router.put('/mark-multiple', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { category, ids, mark = true, biome } = req.body;

  if (!category || !Array.isArray(ids)) {
    throw new AppError('category and ids array required', 400);
  }

  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}`, 400);
  }

  // Require biome for tiles (due to ID collisions across biomes)
  if (category === 'tiles' && !biome) {
    throw new AppError('biome required in body for tiles category', 400);
  }

  // Validate all IDs upfront to prevent path traversal
  const validation = validateAssetIds(ids);
  if (!validation.valid) {
    throw new AppError(`Invalid asset IDs: ${validation.errors.join('; ')}`, 400);
  }

  // Load category data once
  let data;
  try {
    data = metadataUtils.loadCategoryAssets(category);
  } catch (error) {
    throw new AppError(`Failed to load ${category} assets: ${error.message}`, 500);
  }

  // Track results
  const results = { success: 0, notFound: 0, errors: [] };

  // Group assets by source file to enable atomic updates per file
  const byFile = new Map();
  for (const id of ids) {
    const asset = findAssetById(data, category, id, { biome });
    if (!asset) {
      results.notFound++;
      continue;
    }
    const file = asset._sourceFile;
    if (!byFile.has(file)) {
      byFile.set(file, []);
    }
    byFile.get(file).push({ id, asset });
  }

  // Process each file with file locking to prevent race conditions
  for (const [sourceFile, assets] of byFile.entries()) {
    const filePath = path.join(METADATA_DIR, category, sourceFile);
    await fileLocks.withFileLock(filePath, async () => {
      // Re-load data inside lock to get current state (TOCTOU fix)
      const freshData = metadataUtils.loadCategoryAssets(category);

      for (const { id, asset: _asset } of assets) {
        // Re-verify asset exists with fresh data - use same disambiguation
        const freshAsset = findAssetById(freshData, category, id, { biome });
        if (!freshAsset) {
          results.errors.push({ id, error: 'Asset disappeared during update' });
          continue;
        }

        try {
          if (mark) {
            metadataUtils.updateAssetStatus(category, sourceFile, id, {
              needsRegeneration: true,
              regenerationQueuedAt: new Date().toISOString()
            });
          } else {
            metadataUtils.updateAssetStatus(category, sourceFile, id, {
              needsRegeneration: false,
              regenerationQueuedAt: null
            });
          }
          results.success++;
        } catch (error) {
          results.errors.push({ id, error: error.message });
        }
      }
    });
  }

  res.json({
    message: mark
      ? `Marked ${results.success} assets for regeneration`
      : `Cleared regeneration marker for ${results.success} assets`,
    updated: results.success,
    total: ids.length,
    notFound: results.notFound,
    errors: results.errors.length > 0 ? results.errors : undefined
  });
}));

/**
 * POST /bulk-update
 * Bulk update metadata for multiple assets
 * Body: { assetIds: string[], category: string, updates: { loraModel?, priority?, qualityScore?, note? }, biome?: string }
 * Note: For tiles, biome is required to disambiguate assets with same ID
 *
 * SECURITY: Validates all IDs before processing
 * ATOMICITY: Groups updates by source file with file locking
 */
router.post('/bulk-update', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { assetIds, category, updates, biome } = req.body;

  if (!category || !Array.isArray(assetIds) || !updates) {
    throw new AppError('category, assetIds array, and updates object required', 400);
  }

  if (assetIds.length === 0) {
    throw new AppError('assetIds array cannot be empty', 400);
  }

  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}`, 400);
  }

  // Require biome for tiles (due to ID collisions across biomes)
  if (category === 'tiles' && !biome) {
    throw new AppError('biome required in body for tiles category', 400);
  }

  // Validate all IDs upfront to prevent path traversal
  const validation = validateAssetIds(assetIds);
  if (!validation.valid) {
    throw new AppError(`Invalid asset IDs: ${validation.errors.join('; ')}`, 400);
  }

  // Validate allowed update fields
  const allowedFields = ['loraModel', 'priority', 'qualityScore', 'note'];
  const invalidFields = Object.keys(updates).filter(key => !allowedFields.includes(key));
  if (invalidFields.length > 0) {
    throw new AppError(`Invalid update fields: ${invalidFields.join(', ')}. Allowed: ${allowedFields.join(', ')}`, 400);
  }

  // Validate loraModel if provided
  if (updates.loraModel && !VALID_LORA_MODELS.includes(updates.loraModel)) {
    throw new AppError(`Invalid loraModel: ${updates.loraModel}. Valid: ${VALID_LORA_MODELS.join(', ')}`, 400);
  }

  // Validate priority if provided
  if (updates.priority !== undefined) {
    const priority = parseInt(updates.priority, 10);
    if (isNaN(priority) || priority < 0 || priority > 100) {
      throw new AppError('Priority must be a number between 0 and 100', 400);
    }
    updates.priority = priority;
  }

  // Validate qualityScore if provided (maps to 'evaluation' field in metadata)
  if (updates.qualityScore !== undefined) {
    const score = parseInt(updates.qualityScore, 10);
    if (isNaN(score) || score < 0 || score > 5) {
      throw new AppError('Quality score must be a number between 0 and 5', 400);
    }
  }

  // Load category data once
  let data;
  try {
    data = metadataUtils.loadCategoryAssets(category);
  } catch (error) {
    throw new AppError(`Failed to load ${category} assets: ${error.message}`, 500);
  }

  // Track results
  const results = { success: 0, notFound: 0, errors: [] };

  // Group assets by source file to enable atomic updates per file
  const byFile = new Map();
  for (const id of assetIds) {
    const asset = findAssetById(data, category, id, { biome });
    if (!asset) {
      results.notFound++;
      continue;
    }
    const file = asset._sourceFile;
    if (!byFile.has(file)) {
      byFile.set(file, []);
    }
    byFile.get(file).push({ id, asset });
  }

  // Process each file with file locking to prevent race conditions
  for (const [sourceFile, assets] of byFile.entries()) {
    const filePath = path.join(METADATA_DIR, category, sourceFile);
    await fileLocks.withFileLock(filePath, async () => {
      // Re-load data inside lock to get current state (TOCTOU fix)
      const freshData = metadataUtils.loadCategoryAssets(category);

      for (const { id } of assets) {
        // Re-verify asset exists with fresh data - use same disambiguation
        const freshAsset = findAssetById(freshData, category, id, { biome });
        if (!freshAsset) {
          results.errors.push({ id, error: 'Asset disappeared during update' });
          continue;
        }

        try {
          // Build the update object, mapping frontend fields to metadata fields
          const metadataUpdates = {};

          if (updates.loraModel !== undefined) {
            metadataUpdates.loraModel = updates.loraModel || null;
          }

          if (updates.priority !== undefined) {
            metadataUpdates.priority = updates.priority;
          }

          if (updates.qualityScore !== undefined) {
            // Frontend uses 'qualityScore', metadata uses 'evaluation'
            metadataUpdates.evaluation = updates.qualityScore;
          }

          if (updates.note && updates.note.trim()) {
            // Append note to existing notes
            const existingNotes = freshAsset.notes || '';
            const timestamp = new Date().toISOString().split('T')[0];
            const newNote = `[${timestamp}] ${updates.note.trim()}`;
            metadataUpdates.notes = existingNotes
              ? `${existingNotes}\n${newNote}`
              : newNote;
          }

          metadataUtils.updateAssetStatus(category, sourceFile, id, metadataUpdates);
          results.success++;
        } catch (error) {
          results.errors.push({ id, error: error.message });
        }
      }
    });
  }

  res.json({
    message: `Updated ${results.success} of ${assetIds.length} asset(s)`,
    updated: results.success,
    total: assetIds.length,
    notFound: results.notFound,
    errors: results.errors.length > 0 ? results.errors : undefined
  });
}));

// ============================================================================
// ASSET LISTING AND RETRIEVAL
// ============================================================================

/**
 * GET /:category
 * List assets with filters
 * Query params: status (all|generated|pending|needsRegen), biome, subcategory
 */
router.get('/:category', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { category } = req.params;
  const { status, biome, subcategory } = req.query;

  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}. Valid: ${VALID_CATEGORIES.join(', ')}`, 400);
  }

  let assets = [];

  try {
    switch (category) {
      case 'tiles': {
        const options = {};
        if (biome) options.biome = biome;
        if (subcategory) options.category = subcategory;
        const data = metadataUtils.loadTileMetadata(options);
        assets = data.tiles || [];
        break;
      }
      case 'portraits': {
        const filters = {};
        if (subcategory === 'player' || subcategory === 'enemy') {
          filters.type = subcategory;
        }
        const data = metadataUtils.loadPortraitMetadata(filters);
        assets = data.portraits || [];

        // Enrich portraits with constructed prompts
        const traitData = await loadTraitData();
        assets = assets.map((portrait) => {
          const { basePrompt, components } = constructPortraitPrompt(portrait, traitData);
          return {
            ...portrait,
            // Only add constructed prompt if no custom prompt exists
            prompt: portrait.prompt || basePrompt,
            promptComponents: components,
          };
        });
        break;
      }
      case 'items': {
        const data = metadataUtils.loadItemMetadata(subcategory || null);
        assets = data.items || [];
        break;
      }
      case 'icons': {
        const data = metadataUtils.loadIconMetadata(subcategory || null);
        assets = data.icons || [];
        break;
      }
      case 'nodes': {
        const data = metadataUtils.loadNodeMetadata();
        assets = data.nodes || [];
        break;
      }
      case 'overlays': {
        const data = metadataUtils.loadOverlayMetadata(subcategory || null);
        assets = data.overlays || [];
        break;
      }
      case 'obstacles': {
        const data = metadataUtils.loadObstacleMetadata(subcategory || null);
        assets = data.obstacles || [];
        break;
      }
      case 'characters': {
        const options = {};
        // Support subcategory filter for 'players' or 'enemies'
        if (subcategory === 'players' || subcategory === 'player') {
          options.type = 'player';
        } else if (subcategory === 'enemies' || subcategory === 'enemy') {
          options.type = 'enemies';
        }
        // Support biome filter for enemies
        if (biome) {
          options.biome = biome;
        }
        const data = metadataUtils.loadCharacterMetadata(options);
        assets = data.characters || [];

        // Enrich characters with constructed prompts (similar to portraits)
        assets = assets.map((character) => {
          const { basePrompt, components } = constructCharacterPrompt(character);
          return {
            ...character,
            // Only add constructed prompt if no custom prompt exists
            prompt: character.prompt || basePrompt,
            promptComponents: components,
          };
        });
        break;
      }
    }
  } catch (error) {
    throw new AppError(`Failed to load ${category} assets: ${error.message}`, 500);
  }

  // Apply status filter
  if (status === 'generated') {
    assets = assets.filter(a => a.generated === true);
  } else if (status === 'pending') {
    assets = assets.filter(a => !a.generated);
  } else if (status === 'needsRegen') {
    assets = assets.filter(a => a.needsRegeneration === true);
  }

  // Calculate summary stats
  const total = assets.length;
  const generated = assets.filter(a => a.generated === true).length;
  const pending = total - generated;

  // Add computed paths to assets
  assets = assets.map(asset => enrichAssetWithPath(asset, category));

  res.json({
    category,
    filters: { status, biome, subcategory },
    summary: {
      total,
      generated,
      pending,
      percentComplete: total > 0 ? Math.round((generated / total) * 100) : 0
    },
    assets
  });
}));

/**
 * GET /assets/:category/:id
 * Get single asset details
 * Query params for tiles: biome (required) or sourceFile
 */
router.get('/:category/:id', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { category, id } = req.params;
  const { biome, sourceFile } = req.query;

  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}`, 400);
  }

  // Require biome for tiles (due to ID collisions across biomes)
  if (category === 'tiles' && !biome && !sourceFile) {
    throw new AppError('biome or sourceFile query parameter required for tiles', 400);
  }

  let asset = null;

  try {
    const data = metadataUtils.loadCategoryAssets(category);
    asset = findAssetById(data, category, id, { biome, sourceFile });
  } catch (error) {
    throw new AppError(`Failed to load ${category} assets: ${error.message}`, 500);
  }

  if (!asset) {
    throw new AppError(`Asset not found: ${category}/${id}`, 404);
  }

  // Enrich portraits with constructed prompts
  if (category === 'portraits') {
    const traitData = await loadTraitData();
    const { basePrompt, components } = constructPortraitPrompt(asset, traitData);
    asset = {
      ...asset,
      prompt: asset.prompt || basePrompt,
      promptComponents: components,
    };
  }

  // Enrich characters with constructed prompts
  // Note: loadCategoryAssets doesn't populate trait fields, so we load via loadCharacterMetadata
  if (category === 'characters') {
    const charData = metadataUtils.loadCharacterMetadata({ id });
    const charWithTraits = charData.characters.find(c => c.id === id);
    if (charWithTraits) {
      const { basePrompt, components } = constructCharacterPrompt(charWithTraits);
      asset = {
        ...charWithTraits,
        prompt: charWithTraits.prompt || basePrompt,
        promptComponents: components,
      };
    }
  }

  res.json(asset);
}));

/**
 * GET /assets/:category/:id/prompt
 * Get full prompt construction breakdown with theme data
 * Returns structured prompt parts for display in editor
 * Query params for tiles: biome (required) or sourceFile
 */
router.get('/:category/:id/prompt', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { category, id } = req.params;
  const { biome, sourceFile } = req.query;

  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}`, 400);
  }

  // Require biome for tiles (due to ID collisions across biomes)
  if (category === 'tiles' && !biome && !sourceFile) {
    throw new AppError('biome or sourceFile query parameter required for tiles', 400);
  }

  // Load asset
  let asset = null;
  try {
    const data = metadataUtils.loadCategoryAssets(category);
    asset = findAssetById(data, category, id, { biome, sourceFile });
  } catch (error) {
    throw new AppError(`Failed to load ${category} assets: ${error.message}`, 500);
  }

  if (!asset) {
    throw new AppError(`Asset not found: ${category}/${id}`, 404);
  }

  // Load theme
  const themePath = path.join(METADATA_DIR, 'theme.json');
  const theme = await loadJsonFile(themePath);

  // Load trait data for portraits
  const traitData = category === 'portraits' ? await loadTraitData() : null;

  // Construct full prompt breakdown
  const promptData = constructFullPrompt(asset, category, theme, traitData);

  res.json({
    assetId: id,
    category,
    ...promptData,
  });
}));

// ============================================================================
// ASSET UPDATES
// ============================================================================

/**
 * PUT /assets/:category/:id
 * Update asset metadata (prompt, seed, evaluation, issues)
 * Body for tiles must include: biome or sourceFile
 * Body for icons may include: iconCategory
 * Body for items may include: itemCategory
 */
router.put('/:category/:id', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { category, id } = req.params;
  const { biome, sourceFile, iconCategory, itemCategory, ...updates } = req.body;

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Asset');

  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}`, 400);
  }

  // Require biome for tiles (due to ID collisions across biomes)
  if (category === 'tiles' && !biome && !sourceFile) {
    throw new AppError('biome or sourceFile required in body for tiles', 400);
  }

  // Build disambiguation options
  const disambiguationOpts = { biome, sourceFile, iconCategory, itemCategory };

  // Validate allowed update fields
  const allowedFields = ['prompt', 'seed', 'evaluation', 'issues', 'notes', 'priority', 'generated', 'generatedAt', 'needsRegeneration', 'loraModel', 'controlnetWeight', 'ipadapterWeight', 'referenceImage', 'referenceImageStatus'];
  const invalidFields = Object.keys(updates).filter(key => !allowedFields.includes(key));
  if (invalidFields.length > 0) {
    throw new AppError(`Invalid update fields: ${invalidFields.join(', ')}. Allowed: ${allowedFields.join(', ')}`, 400);
  }

  // Validate loraModel if provided (using centralized constant from assetConstants.js)
  if (updates.loraModel && !VALID_LORA_MODELS.includes(updates.loraModel)) {
    throw new AppError(`Invalid loraModel: ${updates.loraModel}. Valid: ${VALID_LORA_MODELS.join(', ')}`, 400);
  }

  // Find the asset to get its source file
  let asset = null;
  try {
    const data = metadataUtils.loadCategoryAssets(category);
    asset = findAssetById(data, category, id, disambiguationOpts);
  } catch (error) {
    throw new AppError(`Failed to load ${category} assets: ${error.message}`, 500);
  }

  if (!asset) {
    throw new AppError(`Asset not found: ${category}/${id}`, 404);
  }

  // Apply updates
  try {
    metadataUtils.updateAssetStatus(category, asset._sourceFile, id, updates);
  } catch (error) {
    throw new AppError(`Failed to update asset: ${error.message}`, 500);
  }

  // Reload to return updated asset - use same disambiguation
  const updatedData = metadataUtils.loadCategoryAssets(category);
  const updatedAsset = findAssetById(updatedData, category, id, disambiguationOpts);

  res.json({
    message: 'Asset updated successfully',
    asset: updatedAsset
  });
}));

/**
 * PUT /assets/:category/:id/mark-regeneration
 * Mark an asset for regeneration (adds to regeneration queue)
 * Body for tiles must include: biome or sourceFile
 */
router.put('/:category/:id/mark-regeneration', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { category, id } = req.params;
  const { mark = true, biome, sourceFile, iconCategory, itemCategory } = req.body;

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Asset');

  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}`, 400);
  }

  // Require disambiguation for categories with ID collisions
  if (category === 'tiles' && !biome && !sourceFile) {
    throw new AppError('biome or sourceFile required in body for tiles', 400);
  }

  // Build disambiguation options
  const disambiguationOpts = { biome, sourceFile, iconCategory, itemCategory };

  // Find the asset to get its source file
  let asset = null;
  try {
    const data = metadataUtils.loadCategoryAssets(category);
    asset = findAssetById(data, category, id, disambiguationOpts);
  } catch (error) {
    throw new AppError(`Failed to load ${category} assets: ${error.message}`, 500);
  }

  if (!asset) {
    throw new AppError(`Asset not found: ${category}/${id}`, 404);
  }

  // Apply the regeneration marker
  try {
    if (mark) {
      metadataUtils.updateAssetStatus(category, asset._sourceFile, id, {
        needsRegeneration: true,
        regenerationQueuedAt: new Date().toISOString()
      });
    } else {
      metadataUtils.updateAssetStatus(category, asset._sourceFile, id, {
        needsRegeneration: false,
        regenerationQueuedAt: null
      });
    }
  } catch (error) {
    throw new AppError(`Failed to update asset: ${error.message}`, 500);
  }

  // Reload to return updated asset - use same disambiguation
  const updatedData = metadataUtils.loadCategoryAssets(category);
  const updatedAsset = findAssetById(updatedData, category, id, disambiguationOpts);

  res.json({
    message: mark ? 'Asset marked for regeneration' : 'Regeneration marker cleared',
    asset: updatedAsset
  });
}));

// ============================================================================
// REPROCESS (background removal and variant regeneration)
// ============================================================================

/**
 * POST /assets/:category/:id/reprocess
 * Reprocess an asset with background removal and regenerate size variants
 * Body: { model?: string, biome?: string }
 * - model: rembg model override (optional, uses category default if not specified)
 * - biome: required for tiles to disambiguate
 */
router.post('/:category/:id/reprocess', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { category, id } = req.params;
  const { model, biome } = req.body;

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Asset');

  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}`, 400);
  }

  // Require biome for tiles
  if (category === 'tiles' && !biome) {
    throw new AppError('biome required in body for tiles', 400);
  }

  // Load backgroundRemovalUtils from scripts
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const backgroundRemovalUtils = require(path.join(PROJECT_ROOT, 'scripts/ai-images/lib/backgroundRemovalUtils.js'));
  const resizeUtils = require(path.join(PROJECT_ROOT, 'scripts/ai-images/lib/resizeUtils.js'));

  // Validate model if provided
  const config = backgroundRemovalUtils.getBackgroundRemovalConfig();
  if (model && !config.availableModels.includes(model)) {
    throw new AppError(`Invalid background removal model: ${model}. Available: ${config.availableModels.join(', ')}`, 400);
  }

  // Find the asset to get its metadata
  let asset = null;
  try {
    const data = metadataUtils.loadCategoryAssets(category);
    asset = findAssetById(data, category, id, { biome });
  } catch (error) {
    throw new AppError(`Failed to load ${category} assets: ${error.message}`, 500);
  }

  if (!asset) {
    throw new AppError(`Asset not found: ${category}/${id}`, 404);
  }

  // Get the path to the original image
  // Import assetPaths to get the originals path
  const { getOriginalsPath } = await import('../../../../shared/assetPaths.js');

  // Determine subcategory for path resolution
  let subcategory = null;
  if (category === 'tiles') {
    subcategory = biome;
  } else if (category === 'items') {
    subcategory = asset._subcategory || asset.category || 'weapons';
  } else if (category === 'icons') {
    subcategory = asset._subcategory || asset.category || 'actions';
  } else if (category === 'overlays') {
    subcategory = asset._subcategory || asset.category || 'rarity';
  } else if (category === 'obstacles') {
    subcategory = asset._subcategory || asset.category || 'rocks';
  }

  // Get the originals path (relative to frontend/public)
  const originalsRelPath = getOriginalsPath(category, id, { subcategory });
  const originalsAbsPath = path.join(PROJECT_ROOT, 'frontend/public', originalsRelPath);

  // Check if original exists (.png is primary, .webp as legacy fallback)
  const fs = await import('fs');
  let originalPath = originalsAbsPath;
  if (!fs.existsSync(originalPath)) {
    // Try .webp extension as legacy fallback
    const webpPath = originalPath.replace(/\.png$/, '.webp');
    if (fs.existsSync(webpPath)) {
      originalPath = webpPath;
    } else {
      throw new AppError(`Original file not found: ${originalsAbsPath} (also tried .webp)`, 404);
    }
  }

  // Determine the effective model
  const effectiveModel = model || backgroundRemovalUtils.getBackgroundRemovalModel(category);

  // Run background removal and generate variants
  try {
    const result = await resizeUtils.generateCanonicalSizeVariants(
      originalPath,
      category,
      id,
      {
        subcategory,
        force: true,  // Always overwrite existing variants
        verbose: true,
        backgroundRemoval: true,  // Force background removal
        backgroundRemovalModel: effectiveModel
      }
    );

    if (!result.success && result.errors.length > 0) {
      throw new AppError(`Reprocessing failed: ${result.errors.map(e => e.error).join(', ')}`, 500);
    }

    res.json({
      success: true,
      model: effectiveModel,
      backgroundRemovalApplied: result.backgroundRemovalApplied,
      variants: result.generated.map(v => v.path),
      skipped: result.skipped.map(v => v.path),
      errors: result.errors
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(`Reprocessing failed: ${error.message}`, 500);
  }
}));

export default router;
