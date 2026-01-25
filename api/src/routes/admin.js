/**
 * @module admin
 * @description Admin Routes for AI-generated image asset management (development only)
 *
 * SECURITY: These endpoints are NEVER available in production, regardless of env vars.
 * They are only available when NODE_ENV is 'development' or 'test'.
 *
 * Key responsibilities:
 * - Asset listing and filtering by category (tiles, portraits, items, icons, nodes, overlays)
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
import { createLimiter } from '../middleware/rateLimiterFactory.js';
import { loadJsonFile, saveJsonFile } from '../utils/jsonFileUtils.js';
import { VALID_CATEGORIES } from '../utils/assetConstants.js';
import adminGenerationService from '../services/adminGenerationService.js';

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

// Rate limiter for admin endpoints (100 requests per minute base = 500/min in dev, 200/min in prod)
const adminRateLimiter = createLimiter({
  name: 'admin',
  windowMs: 60 * 1000,
  maxRequests: 100,
  message: 'Admin endpoint rate limit exceeded. Please wait.',
  useUserKey: false // IP-based since no auth
});

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

// Apply dev mode check and rate limiting to all routes
router.use(requireDevMode);
router.use(adminRateLimiter);

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

  // Use module-level constant
  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}`, 400);
  }

  // Validate allowed update fields
  const allowedFields = ['prompt', 'seed', 'evaluation', 'issues', 'notes', 'priority', 'generated', 'generatedAt', 'needsRegeneration'];
  const invalidFields = Object.keys(updates).filter(key => !allowedFields.includes(key));
  if (invalidFields.length > 0) {
    throw new AppError(`Invalid update fields: ${invalidFields.join(', ')}. Allowed: ${allowedFields.join(', ')}`, 400);
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
 * GET /api/admin/regeneration-queue
 * Get all assets marked for regeneration across all categories
 */
router.get('/regeneration-queue', asyncHandler(async (req, res) => {
  ensureUtilities();

  const queue = {};
  let totalCount = 0;

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
    // Queue mode processes assets marked with needsRegeneration: true
    const result = adminGenerationService.queueJob(
      category || 'tiles',  // Default to tiles for now
      { queueMode: true },  // Special filter for regeneration queue
      { ...options, force: true }  // Force regeneration
    );

    res.status(202).json({
      message: 'Regeneration queue job started',
      ...result
    });
  } catch (err) {
    throw new AppError(err.message, 400);
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
