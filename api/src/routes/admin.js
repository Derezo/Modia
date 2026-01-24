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
import { spawn } from 'child_process';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { createLimiter } from '../middleware/rateLimiterFactory.js';

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

  res.json(asset);
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

// In-memory queue state (placeholder until adminGenerationService is implemented)
const generationQueue = {
  current: null,
  pending: [],
  history: [],
  process: null
};

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

  // Create job
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const job = {
    id: jobId,
    category,
    filters,
    options,
    status: 'pending',
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    progress: { total: 0, completed: 0 },
    error: null
  };

  generationQueue.pending.push(job);

  // Start processing if nothing is running
  if (!generationQueue.current) {
    processNextJob();
  }

  res.status(202).json({
    message: 'Generation job queued',
    jobId,
    queuePosition: generationQueue.pending.length
  });
}));

/**
 * Process the next job in the queue
 */
function processNextJob() {
  if (generationQueue.pending.length === 0) {
    return;
  }

  const job = generationQueue.pending.shift();
  generationQueue.current = job;
  job.status = 'running';
  job.startedAt = new Date().toISOString();

  // Build command based on category
  let script;
  const args = ['--category', job.category];

  // Map category to script
  switch (job.category) {
    case 'tiles':
      script = 'generate-tiles.js';
      if (job.filters.biome) args.push('--biome', job.filters.biome);
      break;
    case 'portraits':
      script = 'generate-portraits.js';
      if (job.filters.race) args.push('--race', job.filters.race);
      if (job.filters.class) args.push('--class', job.filters.class);
      break;
    case 'items':
      script = 'generate-items.js';
      if (job.filters.subcategory) args.push('--category', job.filters.subcategory);
      break;
    case 'icons':
      script = 'generate-icons.js';
      if (job.filters.subcategory) args.push('--category', job.filters.subcategory);
      break;
    case 'nodes':
      script = 'generate-nodes.js';
      break;
    case 'overlays':
      script = 'generate-overlays.js';
      if (job.filters.subcategory) args.push('--subcategory', job.filters.subcategory);
      break;
    default:
      job.status = 'failed';
      job.error = `Unknown category: ${job.category}`;
      job.completedAt = new Date().toISOString();
      generationQueue.history.unshift(job);
      generationQueue.current = null;
      processNextJob();
      return;
  }

  // Add common options
  if (job.options.key) args.push('--key', job.options.key);
  if (job.options.force) args.push('--force');
  if (job.options.dryRun) args.push('--dry-run');
  if (job.options.limit) args.push('--limit', String(job.options.limit));

  const scriptPath = path.join(SCRIPTS_DIR, script);

  // Check if script exists
  if (!fs.existsSync(scriptPath)) {
    job.status = 'failed';
    job.error = `Generation script not found: ${script}`;
    job.completedAt = new Date().toISOString();
    generationQueue.history.unshift(job);
    generationQueue.current = null;
    processNextJob();
    return;
  }

  // Spawn the generation process
  console.log(`[Admin] Starting generation: node ${script} ${args.join(' ')}`);

  const child = spawn('node', [scriptPath, ...args], {
    cwd: SCRIPTS_DIR,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  generationQueue.process = child;

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data) => {
    stdout += data.toString();
    // Parse progress from output if available
    const match = data.toString().match(/\[(\d+)\/(\d+)\]/);
    if (match) {
      job.progress.completed = parseInt(match[1], 10);
      job.progress.total = parseInt(match[2], 10);
    }
  });

  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  child.on('close', (code) => {
    generationQueue.process = null;
    job.completedAt = new Date().toISOString();

    if (code === 0) {
      job.status = 'completed';
      job.output = stdout.slice(-5000); // Keep last 5000 chars
    } else {
      job.status = 'failed';
      job.error = stderr || `Process exited with code ${code}`;
      job.output = stdout.slice(-5000);
    }

    generationQueue.history.unshift(job);
    // Keep only last 50 jobs in history
    if (generationQueue.history.length > 50) {
      generationQueue.history = generationQueue.history.slice(0, 50);
    }

    generationQueue.current = null;
    processNextJob();
  });

  child.on('error', (error) => {
    generationQueue.process = null;
    job.status = 'failed';
    job.error = error.message;
    job.completedAt = new Date().toISOString();

    generationQueue.history.unshift(job);
    generationQueue.current = null;
    processNextJob();
  });
}

/**
 * POST /api/admin/generate/cancel
 * Cancel current/all jobs
 * Body: { all?: boolean, jobId?: string }
 */
router.post('/generate/cancel', asyncHandler(async (req, res) => {
  const { all = false, jobId } = req.body;

  let cancelledCount = 0;

  if (all) {
    // Cancel all pending jobs
    cancelledCount = generationQueue.pending.length;
    for (const job of generationQueue.pending) {
      job.status = 'cancelled';
      job.completedAt = new Date().toISOString();
      generationQueue.history.unshift(job);
    }
    generationQueue.pending = [];
  } else if (jobId) {
    // Cancel specific job
    const pendingIndex = generationQueue.pending.findIndex(j => j.id === jobId);
    if (pendingIndex >= 0) {
      const job = generationQueue.pending.splice(pendingIndex, 1)[0];
      job.status = 'cancelled';
      job.completedAt = new Date().toISOString();
      generationQueue.history.unshift(job);
      cancelledCount = 1;
    }
  }

  // Kill current process if requested
  if ((all || (jobId && generationQueue.current?.id === jobId)) && generationQueue.process) {
    generationQueue.process.kill('SIGTERM');
    if (generationQueue.current) {
      generationQueue.current.status = 'cancelled';
      generationQueue.current.completedAt = new Date().toISOString();
      generationQueue.history.unshift(generationQueue.current);
      generationQueue.current = null;
      cancelledCount++;
    }
  }

  res.json({
    message: cancelledCount > 0 ? `Cancelled ${cancelledCount} job(s)` : 'No jobs to cancel',
    cancelledCount
  });
}));

/**
 * GET /api/admin/generate/queue
 * Get queue status
 */
router.get('/generate/queue', asyncHandler(async (req, res) => {
  res.json({
    current: generationQueue.current,
    pending: generationQueue.pending,
    history: generationQueue.history.slice(0, 20), // Last 20 completed jobs
    stats: {
      pendingCount: generationQueue.pending.length,
      historyCount: generationQueue.history.length,
      isProcessing: generationQueue.current !== null
    }
  });
}));

/**
 * GET /api/admin/generate/job/:jobId
 * Get specific job status
 */
router.get('/generate/job/:jobId', asyncHandler(async (req, res) => {
  const { jobId } = req.params;

  // Check current job
  if (generationQueue.current?.id === jobId) {
    return res.json(generationQueue.current);
  }

  // Check pending jobs
  const pending = generationQueue.pending.find(j => j.id === jobId);
  if (pending) {
    return res.json(pending);
  }

  // Check history
  const historical = generationQueue.history.find(j => j.id === jobId);
  if (historical) {
    return res.json(historical);
  }

  throw new AppError(`Job not found: ${jobId}`, 404);
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
 * Expected format: 2024-01-20T15-30-00-000Z
 */
function validateTimestamp(timestamp) {
  const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
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
