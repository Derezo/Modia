/**
 * Admin Audio Routes - Asset Manager for AI-generated audio (development only)
 *
 * SECURITY: These endpoints are NEVER available in production, regardless of env vars.
 * They are only available when NODE_ENV is 'development' or 'test'.
 * They provide access to audio generation metadata and queue management.
 *
 * @module adminAudio
 * @description Manages music tracks (Suno) and SFX effects (ElevenLabs) for the game.
 *
 * Key responsibilities:
 * - List and filter music tracks by category/region/status
 * - List and filter SFX effects by category/subcategory/status
 * - Update audio metadata (prompts, generation status)
 * - Validate SFX prompts (comma count check)
 * - Queue audio generation jobs
 * - Check Suno task status
 * - Set primary variant for music tracks
 *
 * @see admin.js - Image asset admin routes (pattern reference)
 * @see adminAudioGenerationService.js - Generation queue service
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { createLimiter } from '../middleware/rateLimiterFactory.js';
import { loadJsonFile, saveJsonFile } from '../utils/jsonFileUtils.js';
import {
  VALID_AUDIO_TYPES,
  VALID_MUSIC_CATEGORIES,
  VALID_SFX_CATEGORIES
} from '../utils/assetConstants.js';
import { validateSFXPrompt } from '../utils/audioValidation.js';
import {
  generateWaveformWithFFmpeg,
  generatePseudoWaveform
} from '../utils/waveformGenerator.js';
import audioGenerationService from '../services/adminAudioGenerationService.js';
import { existsSync } from 'fs';

const router = express.Router();

// Get project paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const METADATA_DIR = path.join(PROJECT_ROOT, 'audio-metadata');

// SECURITY: Admin mode is STRICTLY disabled in production
const isProduction = process.env.NODE_ENV === 'production';

// Rate limiter for admin endpoints (30 requests per minute)
const adminRateLimiter = createLimiter({
  name: 'admin-audio',
  windowMs: 60 * 1000,
  maxRequests: 30,
  message: 'Admin audio endpoint rate limit exceeded. Please wait.',
  useUserKey: false // IP-based since no auth
});

/**
 * Middleware to check admin mode is enabled
 * SECURITY: Explicitly blocks production even if DEBUG=true is set
 */
function requireDevMode(req, res, next) {
  if (isProduction) {
    console.warn(`[SECURITY] Admin audio endpoint access attempted in production by IP: ${req.ip}`);
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
 * Load all music tracks from metadata files
 * @param {object} filters - Optional filters (category, region, status)
 * @returns {object} { tracks, summary }
 */
async function loadMusicMetadata(filters = {}) {
  const manifest = await loadJsonFile(path.join(METADATA_DIR, 'music/manifest.json'));
  if (!manifest) {
    throw new AppError('Music manifest not found', 500);
  }

  const tracks = [];
  const categoriesToLoad = filters.category
    ? [filters.category]
    : VALID_MUSIC_CATEGORIES;

  for (const category of categoriesToLoad) {
    const categoryInfo = manifest.categories[category];
    if (!categoryInfo) continue;

    for (const file of categoryInfo.files) {
      const filePath = path.join(METADATA_DIR, 'music', file);
      const data = await loadJsonFile(filePath);
      if (!data) continue;

      // Handle different file structures
      const tracksInFile = data.tracks || [];
      for (const track of tracksInFile) {
        // Add source file reference for updates
        tracks.push({
          ...track,
          _sourceFile: file,
          _category: category,
          _region: data.region || null
        });
      }
    }
  }

  // Apply filters
  let filteredTracks = tracks;

  if (filters.region) {
    filteredTracks = filteredTracks.filter(t => t.region === filters.region);
  }

  if (filters.status === 'generated') {
    filteredTracks = filteredTracks.filter(t => t.generated === true);
  } else if (filters.status === 'pending') {
    filteredTracks = filteredTracks.filter(t => !t.generated);
  }

  // Calculate summary
  const total = filteredTracks.length;
  const generated = filteredTracks.filter(t => t.generated === true).length;
  const pending = total - generated;

  return {
    tracks: filteredTracks,
    summary: {
      total,
      generated,
      pending,
      percentComplete: total > 0 ? Math.round((generated / total) * 100) : 0
    }
  };
}

/**
 * Load all SFX effects from metadata files
 * @param {object} filters - Optional filters (category, subcategory, status)
 * @returns {object} { effects, summary }
 */
async function loadSFXMetadata(filters = {}) {
  const manifest = await loadJsonFile(path.join(METADATA_DIR, 'sfx/manifest.json'));
  if (!manifest) {
    throw new AppError('SFX manifest not found', 500);
  }

  const effects = [];
  const categoriesToLoad = filters.category
    ? [filters.category]
    : VALID_SFX_CATEGORIES;

  for (const category of categoriesToLoad) {
    const categoryInfo = manifest.categories[category];
    if (!categoryInfo) continue;

    for (const file of categoryInfo.files) {
      const filePath = path.join(METADATA_DIR, 'sfx', file);
      const data = await loadJsonFile(filePath);
      if (!data) continue;

      // Handle different file structures
      const effectsInFile = data.effects || [];
      for (const effect of effectsInFile) {
        // Add source file reference for updates
        effects.push({
          ...effect,
          _sourceFile: file,
          _category: category
        });
      }
    }
  }

  // Apply filters
  let filteredEffects = effects;

  if (filters.subcategory) {
    filteredEffects = filteredEffects.filter(e => e.subcategory === filters.subcategory);
  }

  if (filters.status === 'generated') {
    filteredEffects = filteredEffects.filter(e => e.generated === true);
  } else if (filters.status === 'pending') {
    filteredEffects = filteredEffects.filter(e => !e.generated);
  }

  // Calculate summary
  const total = filteredEffects.length;
  const generated = filteredEffects.filter(e => e.generated === true).length;
  const pending = total - generated;

  return {
    effects: filteredEffects,
    summary: {
      total,
      generated,
      pending,
      percentComplete: total > 0 ? Math.round((generated / total) * 100) : 0
    }
  };
}

/**
 * Update audio metadata in source file
 * @param {string} type - 'music' or 'sfx'
 * @param {string} id - Asset ID
 * @param {object} updates - Fields to update
 * @returns {object} Updated asset
 */
async function updateAudioMetadata(type, id, updates) {
  // First find the asset to get its source file
  let asset = null;
  let sourceFilePath = null;
  let arrayKey = null;

  if (type === 'music') {
    const { tracks } = await loadMusicMetadata();
    asset = tracks.find(t => t.id === id);
    if (asset) {
      sourceFilePath = path.join(METADATA_DIR, 'music', asset._sourceFile);
      arrayKey = 'tracks';
    }
  } else {
    const { effects } = await loadSFXMetadata();
    asset = effects.find(e => e.id === id);
    if (asset) {
      sourceFilePath = path.join(METADATA_DIR, 'sfx', asset._sourceFile);
      arrayKey = 'effects';
    }
  }

  if (!asset || !sourceFilePath) {
    throw new AppError(`${type === 'music' ? 'Track' : 'Effect'} not found: ${id}`, 404);
  }

  // Load the source file
  const fileData = await loadJsonFile(sourceFilePath);
  if (!fileData) {
    throw new AppError(`Source file not found: ${asset._sourceFile}`, 500);
  }

  // Find and update the asset in the array
  const assetArray = fileData[arrayKey] || [];
  const assetIndex = assetArray.findIndex(a => a.id === id);

  if (assetIndex === -1) {
    throw new AppError(`Asset not found in source file: ${id}`, 500);
  }

  // Apply updates (excluding internal fields)
  const cleanUpdates = { ...updates };
  delete cleanUpdates._sourceFile;
  delete cleanUpdates._category;
  delete cleanUpdates._region;

  assetArray[assetIndex] = {
    ...assetArray[assetIndex],
    ...cleanUpdates
  };

  fileData[arrayKey] = assetArray;

  // Save the file
  await saveJsonFile(sourceFilePath, fileData);

  return assetArray[assetIndex];
}

/**
 * Transform audio asset to include dashboard-expected status field
 * Maps `generated: true/false` to `status: 'exists'|'missing'`
 * @param {object} asset - The audio asset (track or effect)
 * @returns {object} Asset with status field added
 */
function transformAssetForResponse(asset) {
  return {
    ...asset,
    status: asset.generated ? 'exists' : 'missing'
  };
}

// ============================================================================
// MUSIC ROUTES
// ============================================================================

/**
 * GET /api/admin/audio/music
 * List music tracks with filters
 * Query params: category, region, status (all|generated|pending)
 */
router.get('/music', asyncHandler(async (req, res) => {
  const { category, region, status } = req.query;

  // Validate category if provided
  if (category && !VALID_MUSIC_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}. Valid: ${VALID_MUSIC_CATEGORIES.join(', ')}`, 400);
  }

  const { tracks, summary } = await loadMusicMetadata({ category, region, status });

  res.json({
    type: 'music',
    filters: { category, region, status },
    summary,
    assets: tracks.map(transformAssetForResponse)
  });
}));

/**
 * GET /api/admin/audio/music/:id
 * Get single music track
 */
router.get('/music/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { tracks } = await loadMusicMetadata();
  const track = tracks.find(t => t.id === id);

  if (!track) {
    throw new AppError(`Track not found: ${id}`, 404);
  }

  res.json(transformAssetForResponse(track));
}));

/**
 * PUT /api/admin/audio/music/:id
 * Update music track metadata
 */
router.put('/music/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // Validate allowed update fields
  const allowedFields = [
    'name', 'sunoPrompt', 'style', 'model', 'volume', 'fadeIn', 'fadeOut',
    'loop', 'generated', 'generatedAt', 'taskId', 'status', 'notes',
    'needsRegeneration', 'priority', 'primaryVariant'
  ];
  const invalidFields = Object.keys(updates).filter(key => !allowedFields.includes(key));

  if (invalidFields.length > 0) {
    throw new AppError(`Invalid update fields: ${invalidFields.join(', ')}. Allowed: ${allowedFields.join(', ')}`, 400);
  }

  const updatedTrack = await updateAudioMetadata('music', id, updates);

  res.json({
    message: 'Track updated successfully',
    track: updatedTrack
  });
}));

/**
 * POST /api/admin/audio/music/:id/primary
 * Set primary variant for a music track
 * Body: { variantPath: string }
 */
router.post('/music/:id/primary', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { variantPath } = req.body;

  if (!variantPath) {
    throw new AppError('variantPath is required', 400);
  }

  const updatedTrack = await updateAudioMetadata('music', id, {
    primaryVariant: variantPath,
    path: variantPath
  });

  res.json({
    message: 'Primary variant set successfully',
    track: updatedTrack
  });
}));

// ============================================================================
// SFX ROUTES
// ============================================================================

/**
 * GET /api/admin/audio/sfx
 * List SFX effects with filters
 * Query params: category, subcategory, status (all|generated|pending)
 */
router.get('/sfx', asyncHandler(async (req, res) => {
  const { category, subcategory, status } = req.query;

  // Validate category if provided
  if (category && !VALID_SFX_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}. Valid: ${VALID_SFX_CATEGORIES.join(', ')}`, 400);
  }

  const { effects, summary } = await loadSFXMetadata({ category, subcategory, status });

  res.json({
    type: 'sfx',
    filters: { category, subcategory, status },
    summary,
    assets: effects.map(transformAssetForResponse)
  });
}));

/**
 * GET /api/admin/audio/sfx/:id
 * Get single SFX effect
 */
router.get('/sfx/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { effects } = await loadSFXMetadata();
  const effect = effects.find(e => e.id === id);

  if (!effect) {
    throw new AppError(`Effect not found: ${id}`, 404);
  }

  res.json(transformAssetForResponse(effect));
}));

/**
 * PUT /api/admin/audio/sfx/:id
 * Update SFX effect metadata
 */
router.put('/sfx/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  // Validate allowed update fields
  const allowedFields = [
    'name', 'prompt', 'duration', 'volume', 'variations',
    'generated', 'generatedAt', 'notes', 'needsRegeneration', 'priority'
  ];
  const invalidFields = Object.keys(updates).filter(key => !allowedFields.includes(key));

  if (invalidFields.length > 0) {
    throw new AppError(`Invalid update fields: ${invalidFields.join(', ')}. Allowed: ${allowedFields.join(', ')}`, 400);
  }

  // Validate prompt if being updated
  if (updates.prompt) {
    const validation = validateSFXPrompt(updates.prompt);
    if (!validation.valid) {
      throw new AppError(validation.message, 400);
    }
  }

  const updatedEffect = await updateAudioMetadata('sfx', id, updates);

  res.json({
    message: 'Effect updated successfully',
    effect: updatedEffect
  });
}));

/**
 * POST /api/admin/audio/sfx/validate
 * Validate SFX prompt (check comma count <= 1)
 * Body: { prompt: string }
 */
router.post('/sfx/validate', asyncHandler(async (req, res) => {
  const { prompt } = req.body;

  const validation = validateSFXPrompt(prompt);

  res.json({
    prompt,
    ...validation
  });
}));

// ============================================================================
// STATS ROUTES
// ============================================================================

/**
 * GET /api/admin/audio/stats
 * Overall audio stats (total, generated, pending for both types)
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const [musicData, sfxData] = await Promise.all([
    loadMusicMetadata(),
    loadSFXMetadata()
  ]);

  res.json({
    music: musicData.summary,
    sfx: sfxData.summary,
    overall: {
      total: musicData.summary.total + sfxData.summary.total,
      generated: musicData.summary.generated + sfxData.summary.generated,
      pending: musicData.summary.pending + sfxData.summary.pending,
      percentComplete: Math.round(
        ((musicData.summary.generated + sfxData.summary.generated) /
          (musicData.summary.total + sfxData.summary.total)) * 100
      ) || 0
    }
  });
}));

/**
 * GET /api/admin/audio/:type/:id/waveform
 * Get waveform data - generates on-demand if not in metadata
 */
router.get('/:type/:id/waveform', asyncHandler(async (req, res) => {
  const { type, id } = req.params;

  if (!VALID_AUDIO_TYPES.includes(type)) {
    throw new AppError(`Invalid audio type: ${type}. Valid: ${VALID_AUDIO_TYPES.join(', ')}`, 400);
  }

  let asset = null;

  if (type === 'music') {
    const { tracks } = await loadMusicMetadata();
    asset = tracks.find(t => t.id === id);
  } else {
    const { effects } = await loadSFXMetadata();
    asset = effects.find(e => e.id === id);
  }

  if (!asset) {
    throw new AppError(`${type === 'music' ? 'Track' : 'Effect'} not found: ${id}`, 404);
  }

  // Return cached waveform if available
  if (asset.waveform) {
    return res.json({
      id,
      type,
      waveform: asset.waveform
    });
  }

  // Generate waveform on-demand for generated assets
  if (!asset.generated) {
    throw new AppError('Asset not yet generated - waveform unavailable', 404);
  }

  // Resolve audio file path
  let audioPath;
  if (asset.path) {
    // Remove leading slash and resolve from frontend public dir
    const relativePath = asset.path.startsWith('/') ? asset.path.slice(1) : asset.path;
    audioPath = path.join(PROJECT_ROOT, 'frontend', 'public', relativePath);
  } else {
    throw new AppError('Asset path not found in metadata', 404);
  }

  try {
    // Use ffmpeg for real waveform generation
    const peaks = await generateWaveformWithFFmpeg(audioPath, 100);

    // Persist waveform to metadata
    try {
      await audioGenerationService.persistWaveformData(type, id, peaks);
    } catch (persistErr) {
      console.warn(`Failed to persist waveform for ${type}/${id}:`, persistErr.message);
    }

    res.json({
      id,
      type,
      waveform: peaks
    });
  } catch (err) {
    // Fallback: generate deterministic pseudo-waveform from asset ID
    // This ensures each asset looks unique even without ffmpeg
    console.warn(`Waveform generation failed for ${type}/${id}, using fallback:`, err.message);

    // generatePseudoWaveform has null check (H1 fix)
    const peaks = generatePseudoWaveform(id, 100);

    // Persist fallback waveform to metadata
    try {
      await audioGenerationService.persistWaveformData(type, id, peaks);
    } catch (persistErr) {
      console.warn(`Failed to persist fallback waveform for ${type}/${id}:`, persistErr.message);
    }

    res.json({
      id,
      type,
      waveform: peaks,
      fallback: true
    });
  }
}));

/**
 * GET /api/admin/audio/waveforms/status
 * Get statistics on waveform coverage for all audio assets
 */
router.get('/waveforms/status', asyncHandler(async (req, res) => {
  const [musicData, sfxData] = await Promise.all([
    loadMusicMetadata(),
    loadSFXMetadata()
  ]);

  // Count waveform coverage for music
  const musicWithWaveform = musicData.tracks.filter(t => t.waveform && t.generated).length;
  const musicGenerated = musicData.tracks.filter(t => t.generated).length;
  const musicMissing = musicGenerated - musicWithWaveform;

  // Count waveform coverage for SFX
  const sfxWithWaveform = sfxData.effects.filter(e => e.waveform && e.generated).length;
  const sfxGenerated = sfxData.effects.filter(e => e.generated).length;
  const sfxMissing = sfxGenerated - sfxWithWaveform;

  res.json({
    music: {
      total: musicData.summary.total,
      generated: musicGenerated,
      withWaveform: musicWithWaveform,
      missing: musicMissing,
      percentCoverage: musicGenerated > 0 ? Math.round((musicWithWaveform / musicGenerated) * 100) : 0
    },
    sfx: {
      total: sfxData.summary.total,
      generated: sfxGenerated,
      withWaveform: sfxWithWaveform,
      missing: sfxMissing,
      percentCoverage: sfxGenerated > 0 ? Math.round((sfxWithWaveform / sfxGenerated) * 100) : 0
    },
    overall: {
      totalGenerated: musicGenerated + sfxGenerated,
      withWaveform: musicWithWaveform + sfxWithWaveform,
      missing: musicMissing + sfxMissing,
      percentCoverage: (musicGenerated + sfxGenerated) > 0
        ? Math.round(((musicWithWaveform + sfxWithWaveform) / (musicGenerated + sfxGenerated)) * 100)
        : 0
    }
  });
}));

/**
 * POST /api/admin/audio/waveforms/regenerate
 * Regenerate waveforms for all generated assets using real ffmpeg
 * Query params: ?type=music|sfx&force=true
 */
router.post('/waveforms/regenerate', asyncHandler(async (req, res) => {
  const { type, force = false } = req.query;

  // Validate type if provided
  if (type && !VALID_AUDIO_TYPES.includes(type)) {
    throw new AppError(`Invalid audio type: ${type}. Valid: ${VALID_AUDIO_TYPES.join(', ')}`, 400);
  }

  const results = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  // Helper to process assets
  const processAssets = async (assets, assetType) => {
    for (const asset of assets) {
      if (!asset.generated || !asset.path) {
        results.skipped++;
        continue;
      }

      // Skip if already has waveform and not forcing
      if (asset.waveform && force !== 'true') {
        results.skipped++;
        continue;
      }

      results.processed++;

      try {
        const relativePath = asset.path.startsWith('/') ? asset.path.slice(1) : asset.path;
        const audioPath = path.join(PROJECT_ROOT, 'frontend', 'public', relativePath);

        // Use ffmpeg for real waveform generation
        const peaks = await generateWaveformWithFFmpeg(audioPath, 100);

        // Persist waveform to metadata
        await audioGenerationService.persistWaveformData(assetType, asset.id, peaks);
        results.succeeded++;
      } catch (err) {
        results.failed++;
        results.errors.push({
          id: asset.id,
          type: assetType,
          error: err.message
        });

        // Generate fallback waveform
        try {
          const peaks = generatePseudoWaveform(asset.id, 100);
          await audioGenerationService.persistWaveformData(assetType, asset.id, peaks);
        } catch {
          // Ignore fallback failure
        }
      }
    }
  };

  // Process requested types
  if (!type || type === 'music') {
    const { tracks } = await loadMusicMetadata();
    await processAssets(tracks, 'music');
  }

  if (!type || type === 'sfx') {
    const { effects } = await loadSFXMetadata();
    await processAssets(effects, 'sfx');
  }

  res.json({
    message: 'Waveform regeneration complete',
    filter: type || 'all',
    force: force === 'true',
    results
  });
}));

// ============================================================================
// GENERATION QUEUE ROUTES
// ============================================================================

/**
 * POST /api/admin/audio/generate
 * Queue audio generation job
 * Body: { type: 'music'|'sfx', filters, options }
 */
router.post('/generate', asyncHandler(async (req, res) => {
  const { type, filters = {}, options = {} } = req.body;

  if (!VALID_AUDIO_TYPES.includes(type)) {
    throw new AppError(`Invalid audio type: ${type}. Valid: ${VALID_AUDIO_TYPES.join(', ')}`, 400);
  }

  try {
    const result = audioGenerationService.queueJob(type, filters, options);
    res.status(202).json({
      message: 'Audio generation job queued',
      ...result
    });
  } catch (err) {
    throw new AppError(err.message, 400);
  }
}));

/**
 * GET /api/admin/audio/generate/queue
 * Get queue status
 */
router.get('/generate/queue', asyncHandler(async (req, res) => {
  const status = audioGenerationService.getQueueStatus();
  res.json(status);
}));

/**
 * POST /api/admin/audio/generate/cancel
 * Cancel current/all jobs
 * Body: { all?: boolean, jobId?: string }
 */
router.post('/generate/cancel', asyncHandler(async (req, res) => {
  const { all = false, jobId } = req.body;
  const result = audioGenerationService.cancelJobs({ all, jobId });

  res.json({
    message: result.cancelledCount > 0 ? `Cancelled ${result.cancelledCount} job(s)` : 'No jobs to cancel',
    ...result
  });
}));

/**
 * GET /api/admin/audio/suno/status/:taskId
 * Check Suno task status
 */
router.get('/suno/status/:taskId', asyncHandler(async (req, res) => {
  const { taskId } = req.params;

  if (!taskId || !/^[a-f0-9]+$/.test(taskId)) {
    throw new AppError('Invalid task ID format', 400);
  }

  try {
    const status = await audioGenerationService.checkSunoStatus(taskId);
    res.json(status);
  } catch (err) {
    throw new AppError(`Failed to check Suno status: ${err.message}`, 500);
  }
}));

// ============================================================================
// MANIFEST ROUTES
// ============================================================================

/**
 * GET /api/admin/audio/manifest/music
 * Get music manifest
 */
router.get('/manifest/music', asyncHandler(async (req, res) => {
  const manifest = await loadJsonFile(path.join(METADATA_DIR, 'music/manifest.json'));
  if (!manifest) {
    throw new AppError('Music manifest not found', 404);
  }
  res.json(manifest);
}));

/**
 * GET /api/admin/audio/manifest/sfx
 * Get SFX manifest
 */
router.get('/manifest/sfx', asyncHandler(async (req, res) => {
  const manifest = await loadJsonFile(path.join(METADATA_DIR, 'sfx/manifest.json'));
  if (!manifest) {
    throw new AppError('SFX manifest not found', 404);
  }
  res.json(manifest);
}));

// ============================================================================
// SYNC STATUS ROUTE
// ============================================================================

/**
 * Verify if an audio file exists on disk
 * @param {string} audioPath - Path from metadata (e.g., '/audio/music/...')
 * @returns {boolean} Whether the file exists
 */
function verifyFileExists(audioPath) {
  if (!audioPath) return false;

  // Remove leading slash and resolve from frontend public dir
  const relativePath = audioPath.startsWith('/') ? audioPath.slice(1) : audioPath;
  const fullPath = path.join(PROJECT_ROOT, 'frontend', 'public', relativePath);

  return existsSync(fullPath);
}

/**
 * POST /api/admin/audio/sync-status
 * Synchronize metadata 'generated' flag with actual file existence
 * Fixes mismatches where metadata says generated but file is missing or vice versa
 * Query params: ?type=music|sfx&dryRun=true
 */
router.post('/sync-status', asyncHandler(async (req, res) => {
  const { type, dryRun = false } = req.query;

  // Validate type if provided
  if (type && !VALID_AUDIO_TYPES.includes(type)) {
    throw new AppError(`Invalid audio type: ${type}. Valid: ${VALID_AUDIO_TYPES.join(', ')}`, 400);
  }

  const results = {
    scanned: 0,
    mismatches: 0,
    fixed: 0,
    details: []
  };

  // Helper to process assets
  const processAssets = async (assets, assetType) => {
    for (const asset of assets) {
      results.scanned++;

      const fileExists = verifyFileExists(asset.path);
      const metadataSaysGenerated = asset.generated === true;

      // Check for mismatch
      if (fileExists !== metadataSaysGenerated) {
        results.mismatches++;

        const mismatchInfo = {
          id: asset.id,
          type: assetType,
          name: asset.name || asset.id,
          path: asset.path,
          metadataGenerated: metadataSaysGenerated,
          fileExists,
          action: fileExists ? 'mark_generated' : 'mark_missing'
        };

        results.details.push(mismatchInfo);

        // Fix the mismatch if not a dry run
        if (dryRun !== 'true') {
          try {
            await updateAudioMetadata(assetType, asset.id, {
              generated: fileExists,
              generatedAt: fileExists && !metadataSaysGenerated ? new Date().toISOString() : asset.generatedAt
            });
            results.fixed++;
            mismatchInfo.fixed = true;
          } catch (err) {
            mismatchInfo.error = err.message;
            mismatchInfo.fixed = false;
          }
        }
      }
    }
  };

  // Process requested types
  if (!type || type === 'music') {
    const { tracks } = await loadMusicMetadata();
    await processAssets(tracks, 'music');
  }

  if (!type || type === 'sfx') {
    const { effects } = await loadSFXMetadata();
    await processAssets(effects, 'sfx');
  }

  res.json({
    message: dryRun === 'true' ? 'Dry run complete - no changes made' : 'Sync complete',
    filter: type || 'all',
    dryRun: dryRun === 'true',
    results
  });
}));

/**
 * GET /api/admin/audio/verify-status
 * Check for metadata/file mismatches without making changes
 * Query params: ?type=music|sfx
 */
router.get('/verify-status', asyncHandler(async (req, res) => {
  const { type } = req.query;

  // Validate type if provided
  if (type && !VALID_AUDIO_TYPES.includes(type)) {
    throw new AppError(`Invalid audio type: ${type}. Valid: ${VALID_AUDIO_TYPES.join(', ')}`, 400);
  }

  const results = {
    scanned: 0,
    mismatches: 0,
    markedGeneratedButMissing: [],
    fileExistsButNotMarked: []
  };

  // Helper to verify assets
  const verifyAssets = (assets, assetType) => {
    for (const asset of assets) {
      results.scanned++;

      const fileExists = verifyFileExists(asset.path);
      const metadataSaysGenerated = asset.generated === true;

      if (metadataSaysGenerated && !fileExists) {
        results.mismatches++;
        results.markedGeneratedButMissing.push({
          id: asset.id,
          type: assetType,
          name: asset.name || asset.id,
          path: asset.path
        });
      } else if (fileExists && !metadataSaysGenerated) {
        results.mismatches++;
        results.fileExistsButNotMarked.push({
          id: asset.id,
          type: assetType,
          name: asset.name || asset.id,
          path: asset.path
        });
      }
    }
  };

  // Process requested types
  if (!type || type === 'music') {
    const { tracks } = await loadMusicMetadata();
    verifyAssets(tracks, 'music');
  }

  if (!type || type === 'sfx') {
    const { effects } = await loadSFXMetadata();
    verifyAssets(effects, 'sfx');
  }

  res.json({
    filter: type || 'all',
    results,
    healthy: results.mismatches === 0
  });
}));

// ============================================================================
// STATUS ROUTE
// ============================================================================

/**
 * GET /api/admin/audio/status
 * Check admin audio API status
 */
router.get('/status', (req, res) => {
  res.json({
    enabled: true,
    environment: process.env.NODE_ENV || 'unknown',
    metadataDir: METADATA_DIR,
    validMusicCategories: VALID_MUSIC_CATEGORIES,
    validSFXCategories: VALID_SFX_CATEGORIES,
    serviceLoaded: !!audioGenerationService
  });
});

export default router;
