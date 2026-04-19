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
 * @see services/audio/audioMetadataService.js - Metadata loading/updating
 */

import express from 'express';
import path from 'path';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { loadJsonFile } from '../utils/jsonFileUtils.js';
import {
  VALID_AUDIO_TYPES,
  VALID_MUSIC_CATEGORIES,
  VALID_SFX_CATEGORIES
} from '../utils/assetConstants.js';
import { assertValidAssetId } from '../utils/assetLocking.js';
import { validateSFXPrompt } from '../utils/audioValidation.js';
import {
  generateWaveformWithFFmpeg,
  generatePseudoWaveform
} from '../utils/waveformGenerator.js';
import audioGenerationService from '../services/adminAudioGenerationService.js';
import { existsSync } from 'fs';
import { extractDurationWithFallback } from '../utils/audioDurationExtractor.js';
import {
  loadMusicMetadata,
  loadSFXMetadata,
  updateAudioMetadata,
  transformAssetForResponse,
  verifyFileExists,
  resolveAudioPath,
  markForRegeneration,
  markMultipleForRegeneration,
  getMetadataDir
} from '../services/audio/audioMetadataService.js';

const router = express.Router();

// SECURITY: Admin mode is STRICTLY disabled in production
const isProduction = process.env.NODE_ENV === 'production';

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

// Apply dev mode check to all routes (rate limiting removed - requireDevMode already blocks production)
router.use(requireDevMode);

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

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Track');

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

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Track');

  // Validate allowed update fields
  const allowedFields = [
    'name', 'sunoPrompt', 'style', 'model', 'volume', 'fadeIn', 'fadeOut',
    'loop', 'generated', 'generatedAt', 'taskId', 'status', 'notes',
    'needsRegeneration', 'priority', 'primaryVariantId', 'duration'
  ];
  const invalidFields = Object.keys(updates).filter(key => !allowedFields.includes(key));

  if (invalidFields.length > 0) {
    throw new AppError(`Invalid update fields: ${invalidFields.join(', ')}. Allowed: ${allowedFields.join(', ')}`, 400);
  }

  // If primaryVariantId is being set, also update related fields
  if (updates.primaryVariantId) {
    const { tracks } = await loadMusicMetadata();
    const track = tracks.find(t => t.id === id);
    if (track) {
      const variant = track.variants?.find(v => v.id === updates.primaryVariantId);
      if (variant) {
        // Update the main path to match primary variant
        updates.path = variant.path;

        // Update isPrimary flags on all variants
        if (track.variants) {
          updates.variants = track.variants.map(v => ({
            ...v,
            isPrimary: v.id === updates.primaryVariantId
          }));
        }
      }
    }
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

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Track');

  if (!variantPath) {
    throw new AppError('variantPath is required', 400);
  }

  // Find variant by path to get its ID and update all related fields
  const { tracks } = await loadMusicMetadata();
  const track = tracks.find(t => t.id === id);

  if (!track) {
    throw new AppError(`Track not found: ${id}`, 404);
  }

  const variant = track.variants?.find(v => v.path === variantPath);

  const updates = {
    primaryVariantId: variant?.id || null,
    path: variantPath
  };

  // Update isPrimary flags on all variants
  if (track.variants) {
    updates.variants = track.variants.map(v => ({
      ...v,
      isPrimary: v.path === variantPath
    }));
  }

  const updatedTrack = await updateAudioMetadata('music', id, updates);

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

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Effect');

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

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Effect');

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

// ============================================================================
// REGENERATION QUEUE ROUTES
// ============================================================================

/**
 * GET /api/admin/audio/regeneration-queue
 * Get all audio assets marked for regeneration
 */
router.get('/regeneration-queue', asyncHandler(async (req, res) => {
  const [musicData, sfxData] = await Promise.all([
    loadMusicMetadata(),
    loadSFXMetadata()
  ]);

  const queue = {};
  let totalCount = 0;

  // Filter music tracks marked for regeneration
  const musicNeedsRegen = musicData.tracks.filter(t => t.needsRegeneration === true);
  if (musicNeedsRegen.length > 0) {
    queue.music = musicNeedsRegen;
    totalCount += musicNeedsRegen.length;
  }

  // Filter SFX effects marked for regeneration
  const sfxNeedsRegen = sfxData.effects.filter(e => e.needsRegeneration === true);
  if (sfxNeedsRegen.length > 0) {
    queue.sfx = sfxNeedsRegen;
    totalCount += sfxNeedsRegen.length;
  }

  res.json({ totalCount, queue });
}));

/**
 * PUT /api/admin/audio/:type/:id/mark-regeneration
 * Mark a single audio asset for regeneration
 * Body: { mark: boolean }
 */
router.put('/:type/:id/mark-regeneration', asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const { mark = true } = req.body;

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Audio asset');

  if (!VALID_AUDIO_TYPES.includes(type)) {
    throw new AppError(`Invalid audio type: ${type}. Valid: ${VALID_AUDIO_TYPES.join(', ')}`, 400);
  }

  const result = await markForRegeneration(type, id, mark);
  res.json(result);
}));

/**
 * PUT /api/admin/audio/mark-multiple
 * Mark multiple audio assets for regeneration
 * Body: { type: 'music' | 'sfx', ids: string[], mark: boolean }
 */
router.put('/mark-multiple', asyncHandler(async (req, res) => {
  const { type, ids, mark = true } = req.body;

  if (!type || !VALID_AUDIO_TYPES.includes(type)) {
    throw new AppError(`type must be one of: ${VALID_AUDIO_TYPES.join(', ')}`, 400);
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    throw new AppError('ids array is required', 400);
  }

  const result = await markMultipleForRegeneration(type, ids, mark);
  res.json(result);
}));

/**
 * GET /api/admin/audio/:type/:id/waveform
 * Get waveform data - generates on-demand if not in metadata
 */
router.get('/:type/:id/waveform', asyncHandler(async (req, res) => {
  const { type, id } = req.params;

  // Validate asset ID to prevent path traversal
  assertValidAssetId(id, 'Audio asset');

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
    // Persisted waveform - cache for 7 days (immutable since tied to generatedAt)
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.set('ETag', `"${id}-${asset.generatedAt}"`);
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
  const audioPath = resolveAudioPath(asset.path);
  if (!audioPath) {
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

    // Freshly generated waveform - cache for 7 days (immutable since tied to generatedAt)
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.set('ETag', `"${id}-${asset.generatedAt}"`);
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

    // Fallback waveform - shorter cache (1 day) since real waveform may be regenerated
    res.set('Cache-Control', 'public, max-age=86400');
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
        const audioPath = resolveAudioPath(asset.path);

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
 * GET /api/admin/audio/health
 * Health check for queue status - returns whether queue is healthy
 */
router.get('/health', (req, res) => {
  const status = audioGenerationService.getQueueStatus();
  res.json({
    healthy: !status.current || status.pending.length === 0,
    current: status.current ? {
      id: status.current.id,
      type: status.current.type,
      startedAt: status.current.startedAt
    } : null,
    pendingCount: status.pending.length,
    paused: status.paused
  });
});

/**
 * POST /api/admin/audio/recover
 * Manual queue recovery - clears stuck job and restarts processing
 */
router.post('/recover', (req, res) => {
  const result = audioGenerationService.recoverQueue();
  res.json(result);
});

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
 * POST /api/admin/audio/generate/regeneration-queue
 * Process all audio assets marked for regeneration
 * Body: { type?: 'music'|'sfx', options?: object }
 */
router.post('/generate/regeneration-queue', asyncHandler(async (req, res) => {
  const { type, options = {} } = req.body;

  // Validate type if provided
  if (type && !VALID_AUDIO_TYPES.includes(type)) {
    throw new AppError(`Invalid audio type: ${type}. Valid: ${VALID_AUDIO_TYPES.join(', ')}`, 400);
  }

  // Load metadata and find items needing regeneration
  const [musicData, sfxData] = await Promise.all([
    loadMusicMetadata(),
    loadSFXMetadata()
  ]);

  const jobsQueued = [];
  const errors = [];

  // Process music if type is 'music' or not specified
  if (!type || type === 'music') {
    const musicNeedsRegen = musicData.tracks.filter(t => t.needsRegeneration === true);
    if (musicNeedsRegen.length > 0) {
      const musicKeys = musicNeedsRegen.map(t => t.id);
      try {
        const result = audioGenerationService.queueJob('music', { keys: musicKeys }, { ...options, force: true });
        jobsQueued.push({ type: 'music', count: musicKeys.length, ...result });
      } catch (err) {
        errors.push({ type: 'music', error: err.message });
      }
    }
  }

  // Process SFX if type is 'sfx' or not specified
  if (!type || type === 'sfx') {
    const sfxNeedsRegen = sfxData.effects.filter(e => e.needsRegeneration === true);
    if (sfxNeedsRegen.length > 0) {
      const sfxKeys = sfxNeedsRegen.map(e => e.id);
      try {
        const result = audioGenerationService.queueJob('sfx', { keys: sfxKeys }, { ...options, force: true });
        jobsQueued.push({ type: 'sfx', count: sfxKeys.length, ...result });
      } catch (err) {
        errors.push({ type: 'sfx', error: err.message });
      }
    }
  }

  if (jobsQueued.length === 0 && errors.length === 0) {
    return res.json({ message: 'No audio assets marked for regeneration', jobsQueued: [] });
  }

  res.status(202).json({
    message: `Queued ${jobsQueued.reduce((sum, j) => sum + j.count, 0)} audio asset(s) for regeneration`,
    jobsQueued,
    errors: errors.length > 0 ? errors : undefined
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
  const manifest = await loadJsonFile(path.join(getMetadataDir(), 'music/manifest.json'));
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
  const manifest = await loadJsonFile(path.join(getMetadataDir(), 'sfx/manifest.json'));
  if (!manifest) {
    throw new AppError('SFX manifest not found', 404);
  }
  res.json(manifest);
}));

// ============================================================================
// SYNC STATUS ROUTES
// ============================================================================

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
// DURATION SYNC ROUTES
// ============================================================================

/**
 * GET /api/admin/audio/verify-durations
 * Non-destructive check for duration mismatches between metadata and actual audio files
 * Query params: ?type=music|sfx (required)
 */
router.get('/verify-durations', asyncHandler(async (req, res) => {
  const { type } = req.query;

  // Validate type is required
  if (!type || !VALID_AUDIO_TYPES.includes(type)) {
    throw new AppError(`type query param is required. Valid: ${VALID_AUDIO_TYPES.join(', ')}`, 400);
  }

  const results = {
    total: 0,
    checked: 0,
    mismatches: 0,
    details: []
  };

  // Threshold for considering durations mismatched (in seconds)
  const MISMATCH_THRESHOLD = 0.5;

  // Helper to verify duration for an asset
  const verifyAssetDuration = async (asset) => {
    results.total++;

    // Only check generated assets with a path
    if (!asset.generated || !asset.path) {
      return;
    }

    const audioPath = resolveAudioPath(asset.path);
    if (!audioPath || !existsSync(audioPath)) {
      return;
    }

    results.checked++;

    // Extract actual duration from file
    const actualDuration = await extractDurationWithFallback(audioPath);
    if (actualDuration === null) {
      return;
    }

    const metadataDuration = asset.duration || 0;
    const diff = Math.abs(actualDuration - metadataDuration);

    // Flag if difference exceeds threshold
    if (diff > MISMATCH_THRESHOLD) {
      results.mismatches++;
      results.details.push({
        id: asset.id,
        name: asset.name || asset.id,
        metadataDuration: metadataDuration,
        actualDuration: Math.round(actualDuration * 100) / 100,
        diff: Math.round(diff * 100) / 100
      });
    }
  };

  // Process requested type
  if (type === 'music') {
    const { tracks } = await loadMusicMetadata();
    for (const track of tracks) {
      await verifyAssetDuration(track);
    }
  } else {
    const { effects } = await loadSFXMetadata();
    for (const effect of effects) {
      await verifyAssetDuration(effect);
    }
  }

  res.json({
    type,
    ...results
  });
}));

/**
 * POST /api/admin/audio/sync-durations
 * Scan generated assets, extract actual duration, update metadata
 * Query params: ?type=music|sfx (required), ?dryRun=true (optional)
 */
router.post('/sync-durations', asyncHandler(async (req, res) => {
  const { type, dryRun = false } = req.query;

  // Validate type is required
  if (!type || !VALID_AUDIO_TYPES.includes(type)) {
    throw new AppError(`type query param is required. Valid: ${VALID_AUDIO_TYPES.join(', ')}`, 400);
  }

  const results = {
    scanned: 0,
    mismatches: 0,
    fixed: 0,
    details: []
  };

  // Threshold for considering durations mismatched (in seconds)
  const MISMATCH_THRESHOLD = 0.5;

  // Helper to sync duration for an asset
  const syncAssetDuration = async (asset, assetType) => {
    results.scanned++;

    // Only process generated assets with a path
    if (!asset.generated || !asset.path) {
      return;
    }

    const audioPath = resolveAudioPath(asset.path);
    if (!audioPath || !existsSync(audioPath)) {
      return;
    }

    // Extract actual duration from file
    const actualDuration = await extractDurationWithFallback(audioPath);
    if (actualDuration === null) {
      return;
    }

    const metadataDuration = asset.duration || 0;
    const diff = Math.abs(actualDuration - metadataDuration);

    // Only process if difference exceeds threshold
    if (diff <= MISMATCH_THRESHOLD) {
      return;
    }

    results.mismatches++;

    const roundedDuration = Math.round(actualDuration * 100) / 100;
    const detailEntry = {
      id: asset.id,
      name: asset.name || asset.id,
      oldDuration: metadataDuration,
      newDuration: roundedDuration,
      status: dryRun === 'true' ? 'would_fix' : 'pending'
    };

    // Apply fix if not dry run
    if (dryRun !== 'true') {
      try {
        await updateAudioMetadata(assetType, asset.id, {
          duration: roundedDuration
        });
        results.fixed++;
        detailEntry.status = 'fixed';
      } catch (err) {
        detailEntry.status = 'error';
        detailEntry.error = err.message;
      }
    }

    results.details.push(detailEntry);
  };

  // Process requested type
  if (type === 'music') {
    const { tracks } = await loadMusicMetadata();
    for (const track of tracks) {
      await syncAssetDuration(track, 'music');
    }
  } else {
    const { effects } = await loadSFXMetadata();
    for (const effect of effects) {
      await syncAssetDuration(effect, 'sfx');
    }
  }

  res.json({
    message: dryRun === 'true' ? 'Dry run complete - no changes made' : 'Duration sync complete',
    type,
    dryRun: dryRun === 'true',
    ...results
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
    metadataDir: getMetadataDir(),
    validMusicCategories: VALID_MUSIC_CATEGORIES,
    validSFXCategories: VALID_SFX_CATEGORIES,
    serviceLoaded: !!audioGenerationService
  });
});

export default router;
