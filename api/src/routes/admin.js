/**
 * @module admin
 * @description Admin Routes for AI-generated image asset management (development only)
 *
 * SECURITY: These endpoints are NEVER available in production, regardless of env vars.
 * They are only available when NODE_ENV is 'development' or 'test'.
 *
 * Key responsibilities:
 * - Asset listing and filtering by category (tiles, portraits, items, icons, nodes, overlays, obstacles, characters)
 * - Asset metadata updates (prompts, seeds, evaluation status)
 * - Theme management and preset system for style configuration
 * - Generation queue management (queue, cancel, pause, resume jobs)
 * - Backup creation, restoration, and management
 *
 * Route groups:
 * - GET/PUT /assets/:category - Asset CRUD operations
 * - GET/PUT /theme - Theme configuration
 * - GET/POST /theme/presets - Theme preset management
 * - POST /generate - Queue generation jobs
 * - GET/POST /generate/* - Queue management endpoints
 * - GET/POST /backups - Backup operations
 *
 * @see adminGenerationService.js - Queue management service
 * @see adminAudio.js - Audio asset admin routes
 */

import express from 'express';
import { createRequire } from 'module';
import path from 'path';
import { promises as fs, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { loadJsonFile, saveJsonFile } from '../utils/jsonFileUtils.js';
import { VALID_CATEGORIES, VALID_LORA_MODELS, VALID_SD15_LORA_MODELS } from '../utils/assetConstants.js';
import { assertValidAssetId, validateAssetIds, fileLocks } from '../utils/assetLocking.js';
import adminGenerationService from '../services/adminGenerationService.js';
import { getAssetPath, DEFAULT_SIZES } from '../../../shared/assetPaths.js';
import { normalizeIconId } from '../../../shared/iconCategories.js';

const router = express.Router();

// Get project paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const METADATA_DIR = path.join(PROJECT_ROOT, 'ai-image-metadata');
const SCRIPTS_DIR = path.join(PROJECT_ROOT, 'scripts/ai-images');

// Create require for CommonJS modules
const require = createRequire(import.meta.url);

// Load CommonJS utilities from scripts directory
let metadataUtils;
let backupUtils;

try {
  metadataUtils = require(path.join(SCRIPTS_DIR, 'lib/metadataUtils.js'));
  backupUtils = require(path.join(SCRIPTS_DIR, 'lib/backupUtils.js'));
} catch (error) {
  console.warn('[Admin] Failed to load metadata utilities:', error.message);
  // Will fail on first use with helpful error
}

// SECURITY: Admin mode is STRICTLY disabled in production
const isProduction = process.env.NODE_ENV === 'production';

// Cached trait data for prompt construction
let cachedTraitData = null;

/**
 * Load trait data from portrait metadata files (cached)
 */
async function loadTraitData() {
  if (cachedTraitData) return cachedTraitData;

  const playerPath = path.join(METADATA_DIR, 'portraits/combinations.json');
  const enemyPath = path.join(METADATA_DIR, 'portraits/enemies.json');

  const [playerData, enemyData] = await Promise.all([
    loadJsonFile(playerPath),
    loadJsonFile(enemyPath),
  ]);

  cachedTraitData = {
    // Player traits
    raceTraits: playerData?.raceTraits || {},
    genderTraits: playerData?.genderTraits || {},
    classTraits: playerData?.classTraits || {},
    advancedClassTraits: playerData?.advancedClassTraits || {},
    // Enemy traits
    archetypeTraits: enemyData?.archetypeTraits || {},
    regionTraits: enemyData?.regionTraits || {},
  };

  return cachedTraitData;
}

/**
 * Construct a prompt for a portrait asset
 * @param {object} portrait - Portrait asset metadata
 * @param {object} traitData - Trait lookup data
 * @returns {object} { basePrompt, components }
 */
function constructPortraitPrompt(portrait, traitData) {
  // For enemy portraits
  if (portrait._type === 'enemy' || portrait.type === 'enemy') {
    const archetypeVal = traitData.archetypeTraits?.[portrait.archetype] || '';
    const regionVal = traitData.regionTraits?.[portrait.region] || '';
    const visualVal = portrait.visualTraits || '';

    return {
      basePrompt: [visualVal, archetypeVal, regionVal].filter(Boolean).join(' ').trim(),
      components: {
        archetype: { key: portrait.archetype, value: archetypeVal },
        region: { key: portrait.region, value: regionVal },
        visualTraits: { value: visualVal },
      },
    };
  }

  // For player portraits
  const raceVal = traitData.raceTraits?.[portrait.race] || '';
  const genderVal = traitData.genderTraits?.[portrait.gender] || '';

  // Determine if using advanced class
  const isAdvanced = !!traitData.advancedClassTraits?.[portrait.class];
  const classVal = isAdvanced
    ? traitData.advancedClassTraits[portrait.class]
    : traitData.classTraits?.[portrait.class] || '';

  return {
    basePrompt: [raceVal, genderVal, classVal].filter(Boolean).join(' ').trim(),
    components: {
      race: { key: portrait.race, value: raceVal },
      gender: { key: portrait.gender, value: genderVal },
      class: { key: portrait.class, value: classVal, isAdvanced },
    },
  };
}

/**
 * Construct a prompt for a character sprite asset
 * Characters have different trait data than portraits:
 * - Players: classTraits (visualTraits, attackStyle) + stylePrefix
 * - Enemies: biomeTraits + archetypeTraits
 * @param {object} character - Character asset metadata
 * @returns {object} { basePrompt, components }
 */
function constructCharacterPrompt(character) {
  const isPlayer = character._type === 'player';
  const stylePrefix = character._stylePrefix || '';

  if (isPlayer) {
    // Player characters: stylePrefix + class visual traits
    const classTraits = character._classTraits || {};
    const visualTraits = classTraits.visualTraits || '';

    return {
      basePrompt: [stylePrefix, visualTraits].filter(Boolean).join(' ').trim(),
      components: {
        stylePrefix: { value: stylePrefix },
        class: { key: character.class, visualTraits },
      },
    };
  } else {
    // Enemy characters: stylePrefix + biome traits + archetype traits
    const biomeTraits = character._biomeTraits || '';
    const archetypeTraits = character._archetypeTraits || '';

    return {
      basePrompt: [stylePrefix, biomeTraits, archetypeTraits].filter(Boolean).join(' ').trim(),
      components: {
        stylePrefix: { value: stylePrefix },
        biome: { key: character._biome, value: biomeTraits },
        archetype: { key: character.archetype, value: archetypeTraits },
      },
    };
  }
}

/**
 * Construct full prompt with theme data for any asset
 * @param {object} asset - Asset metadata
 * @param {string} category - Asset category
 * @param {object} theme - Theme configuration
 * @param {object} traitData - Trait lookup data (for portraits)
 * @returns {object} Full prompt construction breakdown
 */
function constructFullPrompt(asset, category, theme, traitData = null) {
  const styleTrigger = theme?.style?.trigger || 'wbgmsst';
  const styleBase = theme?.style?.basePhrase || 'ink and wash watercolor illustration';
  const categorySuffix = theme?.categoryModifiers?.[category]?.suffix || '';
  const negativePrompt = theme?.negativePrompt || '';

  let basePrompt = asset.prompt || '';
  let traitComponents = null;

  // For portraits, construct from traits if no custom prompt
  if (category === 'portraits' && traitData && !asset.prompt) {
    const constructed = constructPortraitPrompt(asset, traitData);
    basePrompt = constructed.basePrompt;
    traitComponents = constructed.components;
  }

  // For characters (sprite sheets), construct from class/biome traits if no custom prompt
  if (category === 'characters' && !asset.prompt) {
    const constructed = constructCharacterPrompt(asset);
    basePrompt = constructed.basePrompt;
    traitComponents = constructed.components;
  }

  // Full prompt assembly
  const fullPrompt = [styleTrigger, styleBase, basePrompt, categorySuffix]
    .filter(Boolean)
    .join(', ')
    .trim();

  return {
    styleTrigger,
    styleBase,
    basePrompt,
    traitComponents,
    categorySuffix,
    fullPrompt,
    negativePrompt,
  };
}

/**
 * Get the subcategory for an asset based on category
 */
function getAssetSubcategory(asset, category) {
  switch (category) {
    case 'tiles':
      return asset._biome || asset.outputPath || 'base';
    case 'items':
      return asset._itemCategory || asset._subcategory || 'weapons';
    case 'icons':
      return asset._iconCategory || asset._subcategory || 'actions';
    case 'overlays':
      return asset._overlayCategory || asset._subcategory || 'rarity';
    case 'obstacles':
      return asset._obstacleCategory || asset._subcategory || 'rocks';
    case 'characters':
      // Characters use _type (player/enemy) as the subcategory
      return asset._type || 'player';
    default:
      return null;
  }
}


/**
 * Add computed path to asset
 */
function enrichAssetWithPath(asset, category) {
  const id = asset.key || asset.id;
  const subcategory = getAssetSubcategory(asset, category);
  const size = DEFAULT_SIZES[category];

  try {
    const extraOptions = {};
    if (category === 'tiles' && asset._tileCategory) {
      extraOptions.tileCategory = asset._tileCategory;
    }

    // Normalize icon IDs to match file naming convention
    // Icon metadata uses prefixed IDs (action_attack) but files use stripped names (attack.png)
    const normalizedId = category === 'icons'
      ? normalizeIconId(id, subcategory)
      : id;

    asset.path = getAssetPath(category, normalizedId, {
      subcategory,
      size,
      ...extraOptions
    });
  } catch (e) {
    // Category not supported by getAssetPath, skip
  }

  return asset;
}

/**
 * Middleware to check admin mode is enabled
 * SECURITY: Explicitly blocks production even if DEBUG=true is set
 */
function requireDevMode(req, res, next) {
  if (isProduction) {
    console.warn(`[SECURITY] Admin endpoint access attempted in production by IP: ${req.ip}`);
    return res.status(403).json({
      error: 'Admin endpoints are disabled in production'
    });
  }
  next();
}

// Apply dev mode check to all routes (rate limiting removed - requireDevMode already blocks production)
router.use(requireDevMode);

/**
 * Helper to ensure utilities are loaded
 */
function ensureUtilities() {
  if (!metadataUtils) {
    throw new AppError('Metadata utilities not available', 500);
  }
}

// ============================================================================
// ASSET ROUTES
// ============================================================================

/**
 * GET /api/admin/assets/:category
 * List assets with filters
 * Query params: status (all|generated|pending), biome, subcategory
 */
router.get('/assets/:category', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { category } = req.params;
  const { status, biome, subcategory } = req.query;

  // Use module-level constant
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
 * GET /api/admin/assets/:category/:id
 * Get single asset details
 */
router.get('/assets/:category/:id', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { category, id } = req.params;

  // Use module-level constant
  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}`, 400);
  }

  let asset = null;

  try {
    const data = metadataUtils.loadCategoryAssets(category);
    asset = data.byId[id];
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
 * GET /api/admin/assets/:category/:id/prompt
 * Get full prompt construction breakdown with theme data
 * Returns structured prompt parts for display in editor
 */
router.get('/assets/:category/:id/prompt', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { category, id } = req.params;

  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}`, 400);
  }

  // Load asset
  let asset = null;
  try {
    const data = metadataUtils.loadCategoryAssets(category);
    asset = data.byId[id];
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

/**
 * PUT /api/admin/assets/:category/:id
 * Update asset metadata (prompt, seed, evaluation, issues)
 */
router.put('/assets/:category/:id', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { category, id } = req.params;
  const updates = req.body;

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Asset');

  // Use module-level constant
  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}`, 400);
  }

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
    asset = data.byId[id];
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

  // Reload to return updated asset
  const updatedData = metadataUtils.loadCategoryAssets(category);
  const updatedAsset = updatedData.byId[id];

  res.json({
    message: 'Asset updated successfully',
    asset: updatedAsset
  });
}));

/**
 * PUT /api/admin/assets/:category/:id/mark-regeneration
 * Mark an asset for regeneration (adds to regeneration queue)
 */
router.put('/assets/:category/:id/mark-regeneration', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { category, id } = req.params;
  const { mark = true } = req.body;  // Allow unmarking too

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Asset');

  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}`, 400);
  }

  // Find the asset to get its source file
  let asset = null;
  try {
    const data = metadataUtils.loadCategoryAssets(category);
    asset = data.byId[id];
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

  // Reload to return updated asset
  const updatedData = metadataUtils.loadCategoryAssets(category);
  const updatedAsset = updatedData.byId[id];

  res.json({
    message: mark ? 'Asset marked for regeneration' : 'Regeneration marker cleared',
    asset: updatedAsset
  });
}));

/**
 * PUT /api/admin/assets/mark-multiple
 * Mark multiple assets for regeneration at once
 * Body: { category: string, ids: string[], mark: boolean }
 *
 * SECURITY: Validates all IDs before processing
 * ATOMICITY: Groups updates by source file with file locking
 */
router.put('/assets/mark-multiple', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { category, ids, mark = true } = req.body;

  if (!category || !Array.isArray(ids)) {
    throw new AppError('category and ids array required', 400);
  }

  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}`, 400);
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
    const asset = data.byId[id];
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
        // Re-verify asset exists with fresh data
        const freshAsset = freshData.byId[id];
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
 * POST /api/admin/assets/bulk-update
 * Bulk update metadata for multiple assets
 * Body: { assetIds: string[], category: string, updates: { loraModel?, priority?, qualityScore?, note? } }
 *
 * SECURITY: Validates all IDs before processing
 * ATOMICITY: Groups updates by source file with file locking
 */
router.post('/assets/bulk-update', asyncHandler(async (req, res) => {
  ensureUtilities();

  const { assetIds, category, updates } = req.body;

  if (!category || !Array.isArray(assetIds) || !updates) {
    throw new AppError('category, assetIds array, and updates object required', 400);
  }

  if (assetIds.length === 0) {
    throw new AppError('assetIds array cannot be empty', 400);
  }

  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}`, 400);
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
    const asset = data.byId[id];
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
        // Re-verify asset exists with fresh data
        const freshAsset = freshData.byId[id];
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

/**
 * POST /api/admin/regeneration-queue/clear
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
 * GET /api/admin/regeneration-queue
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
 * POST /api/admin/generate/regeneration-queue
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

/**
 * GET /api/admin/stats
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
// SD1.5 ANIMATION MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /api/admin/assets/characters/:id/animations
 * List animations for a character with generation status
 * Returns all animations defined for the character with their generation status
 */
router.get('/assets/characters/:id/animations', asyncHandler(async (req, res) => {
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
 * POST /api/admin/assets/characters/:id/animations/:animation/generate
 * Generate a single animation for a character using SD1.5
 * Body: { controlnetWeight?: number, ipadapterWeight?: number, force?: boolean, loraModel?: string }
 */
router.post('/assets/characters/:id/animations/:animation/generate', asyncHandler(async (req, res) => {
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
  const manifestDefaults = charData.manifest?.generationDefaults?.sd15 || {};

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
    throw new AppError(err.message, 500);
  }
}));

/**
 * GET /api/admin/assets/characters/:id/reference
 * Get reference image status for a character
 */
router.get('/assets/characters/:id/reference', asyncHandler(async (req, res) => {
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
 * POST /api/admin/assets/characters/:id/reference/generate
 * Generate reference image for a character (used for SD1.5 IP-Adapter)
 * Body: { force?: boolean, loraModel?: string, referencePose?: 'idle' | 'tpose' }
 */
router.post('/assets/characters/:id/reference/generate', asyncHandler(async (req, res) => {
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
    throw new AppError(err.message, 500);
  }
}));

/**
 * PUT /api/admin/assets/characters/:id/weights
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
router.put('/assets/characters/:id/weights', asyncHandler(async (req, res) => {
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
      throw new AppError(`Failed to update character weights: ${error.message}`, 500);
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
 * GET /api/admin/assets/characters/:id/weights/presets
 * Get available weight presets for SD1.5 generation
 */
router.get('/assets/characters/:id/weights/presets', asyncHandler(async (req, res) => {
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
  const generationDefaults = charData.manifest?.generationDefaults || {};

  res.json({
    characterId: id,
    currentConfig: character.sd15Config || {},
    generationDefaults: generationDefaults.sd15 || {},
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
// FRAME DESCRIPTION OVERRIDES ROUTES
// ============================================================================

/**
 * GET /api/admin/assets/characters/:id/frame-descriptions
 * Get frame description overrides for a character
 * Returns both default descriptions from manifest and any character-specific overrides
 */
router.get('/assets/characters/:id/frame-descriptions', asyncHandler(async (req, res) => {
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
 * PUT /api/admin/assets/characters/:id/frame-descriptions
 * Update frame description overrides for a character
 * Body: { frameDescriptionOverrides: { animation: [frame1, frame2, ...], ... } }
 */
router.put('/assets/characters/:id/frame-descriptions', asyncHandler(async (req, res) => {
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
      throw new AppError(`Failed to update frame descriptions: ${error.message}`, 500);
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
 * DELETE /api/admin/assets/characters/:id/frame-descriptions/:animation
 * Remove frame description overrides for a specific animation
 */
router.delete('/assets/characters/:id/frame-descriptions/:animation', asyncHandler(async (req, res) => {
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
      throw new AppError(`Failed to remove frame descriptions: ${error.message}`, 500);
    }
  });

  res.json({
    message: `Removed frame description overrides for '${animation}'`,
    characterId: id,
    animation,
    remainingOverrides: Object.keys(newOverrides)
  });
}));

// ============================================================================
// THEME ROUTES
// ============================================================================

/**
 * GET /api/admin/theme
 * Get theme.json
 */
router.get('/theme', asyncHandler(async (req, res) => {
  const themePath = path.join(METADATA_DIR, 'theme.json');
  const theme = await loadJsonFile(themePath);

  if (!theme) {
    throw new AppError('Theme file not found', 404);
  }

  res.json(theme);
}));

// Theme presets directory
const PRESETS_DIR = path.join(METADATA_DIR, 'theme-presets');

/**
 * GET /api/admin/theme/presets
 * List all available theme presets
 */
router.get('/theme/presets', asyncHandler(async (req, res) => {
  const presets = [];

  if (!existsSync(PRESETS_DIR)) {
    return res.json({ presets: [] });
  }

  const files = await fs.readdir(PRESETS_DIR);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    try {
      const presetPath = path.join(PRESETS_DIR, file);
      const preset = await loadJsonFile(presetPath);
      if (preset) {
        presets.push({
          filename: file.replace('.json', ''),
          name: preset.name || file.replace('.json', ''),
          description: preset.description || '',
          builtin: preset.builtin === true
        });
      }
    } catch (error) {
      console.warn(`[Admin] Failed to load preset ${file}:`, error.message);
    }
  }

  res.json({ presets });
}));

/**
 * GET /api/admin/theme/presets/:name
 * Get a specific theme preset
 */
router.get('/theme/presets/:name', asyncHandler(async (req, res) => {
  const { name } = req.params;

  // Validate name to prevent path traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new AppError('Invalid preset name', 400);
  }

  const presetPath = path.join(PRESETS_DIR, `${name}.json`);
  const preset = await loadJsonFile(presetPath);

  if (!preset) {
    throw new AppError(`Preset not found: ${name}`, 404);
  }

  res.json(preset);
}));

/**
 * POST /api/admin/theme/presets
 * Save current theme as a new preset
 * Body: { name: string, description?: string }
 */
router.post('/theme/presets', asyncHandler(async (req, res) => {
  const { name, description = '' } = req.body;

  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new AppError('Invalid preset name. Use only letters, numbers, underscores, and dashes.', 400);
  }

  // Check if preset exists and is builtin
  const presetPath = path.join(PRESETS_DIR, `${name}.json`);
  const existingPreset = await loadJsonFile(presetPath);
  if (existingPreset?.builtin) {
    throw new AppError('Cannot overwrite built-in preset', 400);
  }

  // Load current theme
  const themePath = path.join(METADATA_DIR, 'theme.json');
  const currentTheme = await loadJsonFile(themePath);

  if (!currentTheme) {
    throw new AppError('Current theme not found', 404);
  }

  // Create preset from current theme (exclude version and some fields)
  const preset = {
    name,
    description,
    builtin: false,
    savedAt: new Date().toISOString(),
    style: currentTheme.style,
    negativePrompt: currentTheme.negativePrompt,
    categoryModifiers: currentTheme.categoryModifiers
  };

  // Ensure presets directory exists
  if (!existsSync(PRESETS_DIR)) {
    await fs.mkdir(PRESETS_DIR, { recursive: true });
  }

  await saveJsonFile(presetPath, preset);

  res.status(201).json({
    message: 'Preset saved successfully',
    preset: {
      filename: name,
      name: preset.name,
      description: preset.description,
      builtin: false
    }
  });
}));

/**
 * POST /api/admin/theme/presets/:name/apply
 * Apply a preset to the current theme
 */
router.post('/theme/presets/:name/apply', asyncHandler(async (req, res) => {
  const { name } = req.params;

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new AppError('Invalid preset name', 400);
  }

  // Load preset
  const presetPath = path.join(PRESETS_DIR, `${name}.json`);
  const preset = await loadJsonFile(presetPath);

  if (!preset) {
    throw new AppError(`Preset not found: ${name}`, 404);
  }

  // Load current theme
  const themePath = path.join(METADATA_DIR, 'theme.json');
  const currentTheme = await loadJsonFile(themePath);

  if (!currentTheme) {
    throw new AppError('Current theme not found', 404);
  }

  // Apply preset to theme (preserve version, loraDefaults, overlayConfig, etc.)
  const updatedTheme = {
    ...currentTheme,
    name: preset.name,
    description: preset.description || currentTheme.description,
    style: { ...currentTheme.style, ...preset.style },
    negativePrompt: preset.negativePrompt || currentTheme.negativePrompt,
    categoryModifiers: { ...currentTheme.categoryModifiers, ...preset.categoryModifiers }
  };

  await saveJsonFile(themePath, updatedTheme);

  res.json({
    message: `Preset "${name}" applied successfully`,
    theme: updatedTheme
  });
}));

/**
 * DELETE /api/admin/theme/presets/:name
 * Delete a custom preset (cannot delete built-in presets)
 */
router.delete('/theme/presets/:name', asyncHandler(async (req, res) => {
  const { name } = req.params;

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new AppError('Invalid preset name', 400);
  }

  const presetPath = path.join(PRESETS_DIR, `${name}.json`);
  const preset = await loadJsonFile(presetPath);

  if (!preset) {
    throw new AppError(`Preset not found: ${name}`, 404);
  }

  if (preset.builtin) {
    throw new AppError('Cannot delete built-in preset', 400);
  }

  await fs.unlink(presetPath);

  res.json({
    message: `Preset "${name}" deleted successfully`
  });
}));

/**
 * PUT /api/admin/theme
 * Update theme.json
 */
router.put('/theme', asyncHandler(async (req, res) => {
  const themePath = path.join(METADATA_DIR, 'theme.json');
  const currentTheme = await loadJsonFile(themePath);

  if (!currentTheme) {
    throw new AppError('Theme file not found', 404);
  }

  // Merge updates with current theme
  const updatedTheme = {
    ...currentTheme,
    ...req.body,
    // Preserve nested objects by merging them too
    style: { ...currentTheme.style, ...(req.body.style || {}) },
    categoryModifiers: { ...currentTheme.categoryModifiers, ...(req.body.categoryModifiers || {}) },
    rarityModifiers: { ...currentTheme.rarityModifiers, ...(req.body.rarityModifiers || {}) },
    overlayConfig: { ...currentTheme.overlayConfig, ...(req.body.overlayConfig || {}) },
    iconCategoryModifiers: { ...currentTheme.iconCategoryModifiers, ...(req.body.iconCategoryModifiers || {}) },
    loraDefaults: { ...currentTheme.loraDefaults, ...(req.body.loraDefaults || {}) }
  };

  try {
    await saveJsonFile(themePath, updatedTheme);
  } catch (error) {
    throw new AppError(`Failed to save theme: ${error.message}`, 500);
  }

  res.json({
    message: 'Theme updated successfully',
    theme: updatedTheme
  });
}));

// ============================================================================
// GENERATION QUEUE ROUTES
// ============================================================================

/**
 * POST /api/admin/generate
 * Queue generation job (returns job ID)
 * Body: { category, filters, options }
 */
router.post('/generate', asyncHandler(async (req, res) => {
  const { category, filters = {}, options = {} } = req.body;

  // Use module-level constant
  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}`, 400);
  }

  try {
    const result = adminGenerationService.queueJob(category, filters, options);
    res.status(202).json({
      message: 'Generation job queued',
      ...result
    });
  } catch (err) {
    throw new AppError(err.message, 400);
  }
}));

/**
 * POST /api/admin/generate/cancel
 * Cancel current/all jobs
 * Body: { all?: boolean, jobId?: string }
 */
router.post('/generate/cancel', asyncHandler(async (req, res) => {
  const { all = false, jobId } = req.body;
  const result = adminGenerationService.cancelJobs({ all, jobId });

  res.json({
    message: result.cancelledCount > 0 ? `Cancelled ${result.cancelledCount} job(s)` : 'No jobs to cancel',
    ...result
  });
}));

/**
 * POST /api/admin/generate/pause
 * Pause the queue (current job continues)
 */
router.post('/generate/pause', asyncHandler(async (req, res) => {
  const result = adminGenerationService.pauseQueue();
  res.json({
    message: 'Queue paused',
    ...result
  });
}));

/**
 * POST /api/admin/generate/resume
 * Resume the queue
 */
router.post('/generate/resume', asyncHandler(async (req, res) => {
  const result = adminGenerationService.resumeQueue();
  res.json({
    message: 'Queue resumed',
    ...result
  });
}));

/**
 * GET /api/admin/generate/queue
 * Get queue status
 */
router.get('/generate/queue', asyncHandler(async (req, res) => {
  const status = adminGenerationService.getQueueStatus();
  res.json(status);
}));

/**
 * GET /api/admin/generate/health
 * Get queue health status for monitoring
 */
router.get('/generate/health', (req, res) => {
  const status = adminGenerationService.getQueueStatus();
  res.json({
    healthy: !status.current || status.pending.length === 0,
    current: status.current ? {
      id: status.current.id,
      type: status.current.type,
      category: status.current.category,
      startedAt: status.current.startedAt
    } : null,
    pendingCount: status.pending.length,
    paused: status.paused
  });
});

/**
 * POST /api/admin/generate/recover
 * Clear stuck job and restart queue processing
 */
router.post('/generate/recover', (req, res) => {
  const result = adminGenerationService.recoverQueue();
  res.json(result);
});

/**
 * GET /api/admin/generate/job/:jobId
 * Get specific job status
 */
router.get('/generate/job/:jobId', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const job = adminGenerationService.getJob(jobId);

  if (!job) {
    throw new AppError(`Job not found: ${jobId}`, 404);
  }

  res.json(job);
}));

/**
 * GET /api/admin/generate/config
 * Get current generation configuration
 * Returns: backend, seedMode, fixedSeed, loraDefaults, delay, verbose
 */
router.get('/generate/config', asyncHandler(async (req, res) => {
  const config = await adminGenerationService.getConfig();
  const validLora = adminGenerationService.getValidLoraModels();
  const defaultLora = adminGenerationService.getDefaultLora();

  res.json({
    config,
    validLoraModels: validLora,
    defaultLoraByCategory: defaultLora,
    validBackends: ['local', 'huggingface'],
    validSeedModes: ['random', 'fixed', 'incremental'],
    validCategories: adminGenerationService.getValidCategories()
  });
}));

/**
 * POST /api/admin/generate/seed/reset
 * Reset the incremental seed counter
 * Body: { seed?: number }
 */
router.post('/generate/seed/reset', asyncHandler(async (req, res) => {
  const { seed = 42 } = req.body;
  adminGenerationService.resetIncrementalSeed(seed);
  res.json({
    message: 'Incremental seed reset',
    seed
  });
}));

/**
 * GET /api/admin/generate/settings
 * Get current generation settings (backend preference)
 */
router.get('/generate/settings', asyncHandler(async (req, res) => {
  const backend = adminGenerationService.getGenerationBackend();
  const validBackends = adminGenerationService.getValidBackends();

  res.json({
    backend,
    validBackends
  });
}));

/**
 * POST /api/admin/generate/settings
 * Set generation settings (backend preference)
 * Body: { backend: 'comfyui' | 'huggingface' }
 */
router.post('/generate/settings', asyncHandler(async (req, res) => {
  const { backend } = req.body;

  if (!backend) {
    throw new AppError('backend is required', 400);
  }

  try {
    adminGenerationService.setGenerationBackend(backend);
    res.json({
      message: `Generation backend set to ${backend}`,
      backend: adminGenerationService.getGenerationBackend()
    });
  } catch (err) {
    throw new AppError(err.message, 400);
  }
}));

// ============================================================================
// BACKUP ROUTES
// ============================================================================

/**
 * GET /api/admin/backups
 * List backups
 */
router.get('/backups', asyncHandler(async (req, res) => {
  if (!backupUtils) {
    throw new AppError('Backup utilities not available', 500);
  }

  try {
    const backups = backupUtils.listBackups();
    res.json({
      backups,
      count: backups.length
    });
  } catch (error) {
    throw new AppError(`Failed to list backups: ${error.message}`, 500);
  }
}));

/**
 * POST /api/admin/backups
 * Create backup
 * Body: { reason?: string, category?: string, assets?: array }
 * - assets: explicit list of assets to backup
 * - category: specific category to backup (tiles, portraits, etc.)
 * - If neither specified, backs up everything
 */
router.post('/backups', asyncHandler(async (req, res) => {
  ensureUtilities();
  if (!backupUtils) {
    throw new AppError('Backup utilities not available', 500);
  }

  const { reason = 'manual', category, assets } = req.body;

  // Validate category if provided
  if (category && !VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}. Valid: ${VALID_CATEGORIES.join(', ')}`, 400);
  }

  let assetsToBackup = assets;

  // If no assets specified, load from category or all categories
  if (!assetsToBackup) {
    assetsToBackup = [];
    const categoriesToBackup = category ? [category] : VALID_CATEGORIES;

    for (const cat of categoriesToBackup) {
      try {
        const data = metadataUtils.loadCategoryAssets(cat);
        assetsToBackup.push(...data.assets);
      } catch (error) {
        console.warn(`[Admin] Failed to load ${cat} for backup:`, error.message);
      }
    }
  }

  // Build backup reason with category info
  const backupReason = category ? `${reason} (${category})` : reason;

  try {
    const result = backupUtils.createBackup(assetsToBackup, { reason: backupReason });

    if (!result.success) {
      throw new AppError(result.error || 'Backup failed', 500);
    }

    res.status(201).json({
      message: 'Backup created successfully',
      timestamp: result.timestamp,
      assetCount: result.assetCount,
      backupDir: result.backupDir,
      category: category || 'all'
    });
  } catch (error) {
    throw new AppError(`Failed to create backup: ${error.message}`, 500);
  }
}));

/**
 * Validate backup timestamp format to prevent path traversal
 * Expected format: 2024-01-20_15-30-00 (matches backupUtils.js formatBackupTimestamp)
 */
function validateTimestamp(timestamp) {
  const timestampPattern = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;
  return timestampPattern.test(timestamp);
}

/**
 * GET /api/admin/backups/:timestamp
 * Get backup details
 */
router.get('/backups/:timestamp', asyncHandler(async (req, res) => {
  if (!backupUtils) {
    throw new AppError('Backup utilities not available', 500);
  }

  const { timestamp } = req.params;

  if (!validateTimestamp(timestamp)) {
    throw new AppError('Invalid timestamp format', 400);
  }

  try {
    const info = backupUtils.getBackupInfo(timestamp);

    if (!info) {
      throw new AppError(`Backup not found: ${timestamp}`, 404);
    }

    res.json(info);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(`Failed to get backup info: ${error.message}`, 500);
  }
}));

/**
 * POST /api/admin/backups/:timestamp/restore
 * Restore from backup
 */
router.post('/backups/:timestamp/restore', asyncHandler(async (req, res) => {
  if (!backupUtils) {
    throw new AppError('Backup utilities not available', 500);
  }

  const { timestamp } = req.params;

  if (!validateTimestamp(timestamp)) {
    throw new AppError('Invalid timestamp format', 400);
  }

  try {
    const result = backupUtils.restoreBackup(timestamp);

    res.json({
      message: 'Backup restored successfully',
      ...result
    });
  } catch (error) {
    throw new AppError(`Failed to restore backup: ${error.message}`, 500);
  }
}));

/**
 * DELETE /api/admin/backups/:timestamp
 * Delete a backup
 */
router.delete('/backups/:timestamp', asyncHandler(async (req, res) => {
  if (!backupUtils) {
    throw new AppError('Backup utilities not available', 500);
  }

  const { timestamp } = req.params;

  if (!validateTimestamp(timestamp)) {
    throw new AppError('Invalid timestamp format', 400);
  }

  try {
    const deleted = backupUtils.deleteBackup(timestamp);

    if (!deleted) {
      throw new AppError(`Backup not found: ${timestamp}`, 404);
    }

    res.json({
      message: 'Backup deleted successfully',
      timestamp
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(`Failed to delete backup: ${error.message}`, 500);
  }
}));

// ============================================================================
// CONFIG ROUTE
// ============================================================================

/**
 * GET /api/admin/config
 * Get admin configuration including LoRA models and category defaults
 * Returns validLoraModels (array of IDs), loraModels (full metadata), and defaultLoraByCategory
 */
router.get('/config', asyncHandler(async (req, res) => {
  const manifestPath = path.join(METADATA_DIR, 'manifest.json');
  const manifest = await loadJsonFile(manifestPath);

  if (!manifest) {
    throw new AppError('Manifest file not found', 404);
  }

  res.json({
    // Array of valid model IDs (for validation)
    validLoraModels: Object.keys(manifest.loraModels || {}),
    // Full model metadata object (for display names, descriptions)
    loraModels: manifest.loraModels || {},
    // Category to default model mapping
    defaultLoraByCategory: manifest.categoryDefaults || {},
    // SD1.5 LoRA models for character animations
    sd15LoraModels: manifest.sd15LoraModels || {},
    sd15Defaults: manifest.sd15Defaults || {
      loraModel: 'pixel-art-xl',
      referenceLoraModel: 'pixel-art-xl'
    }
  });
}));

// ============================================================================
// STATUS ROUTE
// ============================================================================

/**
 * GET /api/admin/status
 * Check admin API status
 */
router.get('/status', (req, res) => {
  res.json({
    enabled: true,
    environment: process.env.NODE_ENV || 'unknown',
    metadataDir: METADATA_DIR,
    scriptsDir: SCRIPTS_DIR,
    utilitiesLoaded: {
      metadata: !!metadataUtils,
      backup: !!backupUtils
    }
  });
});

export default router;
