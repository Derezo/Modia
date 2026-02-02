/**
 * @module admin/generation
 * @description Generation queue control routes for AI image generation
 *
 * Key responsibilities:
 * - Queue job submission
 * - Queue control (pause, resume, cancel)
 * - Job status monitoring
 * - Queue health and recovery
 * - Generation settings (backend, seed)
 *
 * Route groups:
 * - POST /generate - Queue a generation job
 * - POST /generate/cancel - Cancel jobs
 * - POST /generate/pause - Pause the queue
 * - POST /generate/resume - Resume the queue
 * - GET /generate/queue - Get queue status
 * - GET /generate/health - Get queue health
 * - POST /generate/recover - Recover from stuck state
 * - GET /generate/job/:jobId - Get specific job status
 * - GET /generate/config - Get generation configuration
 * - POST /generate/seed/reset - Reset incremental seed
 * - GET /generate/settings - Get generation settings
 * - POST /generate/settings - Set generation settings
 *
 * @see adminGenerationService.js - Queue management service
 */

import express from 'express';
import { AppError, asyncHandler } from '../../middleware/errorHandler.js';
import adminGenerationService from '../../services/adminGenerationService.js';
import { VALID_CATEGORIES } from './shared.js';

const router = express.Router();

// ============================================================================
// JOB SUBMISSION
// ============================================================================

/**
 * POST /generate
 * Queue generation job (returns job ID)
 * Body: { category, filters, options }
 */
router.post('/', asyncHandler(async (req, res) => {
  const { category, filters = {}, options = {} } = req.body;

  if (!VALID_CATEGORIES.includes(category)) {
    throw new AppError(`Invalid category: ${category}`, 400);
  }

  try {
    // Handle animations array - queue one job per animation
    if (category === 'characters' && Array.isArray(options.animations) && options.animations.length > 0) {
      const jobs = [];
      for (const animation of options.animations) {
        // Create job with singular 'animation' instead of 'animations' array
        const jobOptions = { ...options, animation };
        delete jobOptions.animations;  // Remove the array to avoid confusion
        const result = adminGenerationService.queueJob(category, filters, jobOptions);
        jobs.push(result);
      }
      return res.status(202).json({
        message: `Queued ${jobs.length} animation job(s)`,
        jobs
      });
    }

    // Original single-job handling
    const result = adminGenerationService.queueJob(category, filters, options);
    res.status(202).json({
      message: 'Generation job queued',
      ...result
    });
  } catch (err) {
    throw new AppError(err.message, 400);
  }
}));

// ============================================================================
// QUEUE CONTROL
// ============================================================================

/**
 * POST /generate/cancel
 * Cancel current/all jobs
 * Body: { all?: boolean, jobId?: string }
 */
router.post('/cancel', asyncHandler(async (req, res) => {
  const { all = false, jobId } = req.body;
  const result = adminGenerationService.cancelJobs({ all, jobId });

  res.json({
    message: result.cancelledCount > 0 ? `Cancelled ${result.cancelledCount} job(s)` : 'No jobs to cancel',
    ...result
  });
}));

/**
 * POST /generate/pause
 * Pause the queue (current job continues)
 */
router.post('/pause', asyncHandler(async (req, res) => {
  const result = adminGenerationService.pauseQueue();
  res.json({
    message: 'Queue paused',
    ...result
  });
}));

/**
 * POST /generate/resume
 * Resume the queue
 */
router.post('/resume', asyncHandler(async (req, res) => {
  const result = adminGenerationService.resumeQueue();
  res.json({
    message: 'Queue resumed',
    ...result
  });
}));

// ============================================================================
// QUEUE STATUS
// ============================================================================

/**
 * GET /generate/queue
 * Get queue status
 */
router.get('/queue', asyncHandler(async (req, res) => {
  const status = adminGenerationService.getQueueStatus();
  res.json(status);
}));

/**
 * GET /generate/health
 * Get queue health status for monitoring
 */
router.get('/health', (req, res) => {
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
 * POST /generate/recover
 * Clear stuck job and restart queue processing
 */
router.post('/recover', (req, res) => {
  const result = adminGenerationService.recoverQueue();
  res.json(result);
});

/**
 * GET /generate/job/:jobId
 * Get specific job status
 */
router.get('/job/:jobId', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const job = adminGenerationService.getJob(jobId);

  if (!job) {
    throw new AppError(`Job not found: ${jobId}`, 404);
  }

  res.json(job);
}));

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * GET /generate/config
 * Get current generation configuration
 * Returns: backend, seedMode, fixedSeed, loraDefaults, delay, verbose
 */
router.get('/config', asyncHandler(async (req, res) => {
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
 * POST /generate/seed/reset
 * Reset the incremental seed counter
 * Body: { seed?: number }
 */
router.post('/seed/reset', asyncHandler(async (req, res) => {
  const { seed = 42 } = req.body;
  adminGenerationService.resetIncrementalSeed(seed);
  res.json({
    message: 'Incremental seed reset',
    seed
  });
}));

/**
 * GET /generate/settings
 * Get current generation settings (backend preference)
 */
router.get('/settings', asyncHandler(async (req, res) => {
  const backend = adminGenerationService.getGenerationBackend();
  const validBackends = adminGenerationService.getValidBackends();

  res.json({
    backend,
    validBackends
  });
}));

/**
 * POST /generate/settings
 * Set generation settings (backend preference)
 * Body: { backend: 'comfyui' | 'huggingface' }
 */
router.post('/settings', asyncHandler(async (req, res) => {
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

export default router;
