/**
 * Admin Routes - Asset Manager for AI-generated images (development only)
 *
 * SECURITY: These endpoints are NEVER available in production, regardless of env vars.
 * They are only available when NODE_ENV is 'development' or 'test'.
 * They provide access to AI image generation metadata and queue management.
 */

import express from 'express';
import { createRequire } from 'module';
import path from 'path';
import { promises as fs, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { createLimiter } from '../middleware/rateLimiterFactory.js';
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

// Valid asset categories
const VALID_CATEGORIES = ['tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays'];

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

// Rate limiter for admin endpoints (30 requests per minute)
const adminRateLimiter = createLimiter({
  name: 'admin',
  windowMs: 60 * 1000,
  maxRequests: 30,
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

/**
 * Helper to load JSON file (async)
 */
async function loadJsonFile(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to load JSON from ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Helper to save JSON file (async)
 */
async function saveJsonFile(filePath, data) {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n');
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
  const allowedFields = ['prompt', 'seed', 'evaluation', 'issues', 'notes', 'priority', 'generated', 'generatedAt'];
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
 * Body: { reason?: string, assets?: array } - if assets not provided, backs up everything
 */
router.post('/backups', asyncHandler(async (req, res) => {
  ensureUtilities();
  if (!backupUtils) {
    throw new AppError('Backup utilities not available', 500);
  }

  const { reason = 'manual', assets } = req.body;

  let assetsToBackup = assets;

  // If no assets specified, backup all categories
  if (!assetsToBackup) {
    assetsToBackup = [];
    const categories = ['tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays'];

    for (const category of categories) {
      try {
        const data = metadataUtils.loadCategoryAssets(category);
        assetsToBackup.push(...data.assets);
      } catch (error) {
        console.warn(`[Admin] Failed to load ${category} for backup:`, error.message);
      }
    }
  }

  try {
    const result = backupUtils.createBackup(assetsToBackup, { reason });

    if (!result.success) {
      throw new AppError(result.error || 'Backup failed', 500);
    }

    res.status(201).json({
      message: 'Backup created successfully',
      timestamp: result.timestamp,
      assetCount: result.assetCount,
      backupDir: result.backupDir
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
