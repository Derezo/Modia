/**
 * Admin Generation Service
 * Queue management for AI image generation with WebSocket streaming
 *
 * Handles:
 * - Job queue with pending, current, completed, failed states
 * - Child process spawning for generation scripts
 * - Progress parsing from stdout
 * - WebSocket event broadcasting to admin:generation room
 * - Cancel/pause/resume functionality
 * - Full configuration support (backend, LoRA, seed, variants, etc.)
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { broadcastToRoom } from '../websocket/index.js';
import {
  VALID_CATEGORIES,
  VALID_LORA_MODELS,
  VALID_BACKENDS,
  DEFAULT_LORA_BY_CATEGORY,
  CATEGORY_SCRIPT_MAP
} from '../utils/assetConstants.js';
import { generateJobId, parseProgress as parseProgressBase, parseStepProgress } from './generationUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SCRIPTS_DIR = path.join(PROJECT_ROOT, 'scripts/ai-images');
const THEME_PATH = path.join(PROJECT_ROOT, 'ai-image-metadata/theme.json');

// Room name for generation events
const GENERATION_ROOM = 'admin:generation';

// Re-export for backwards compatibility (use imported DEFAULT_LORA_BY_CATEGORY)
const DEFAULT_LORA = DEFAULT_LORA_BY_CATEGORY;

/**
 * Read generation configuration from theme.json
 * Returns defaults if theme.json is unavailable
 */
async function getGenerationConfig() {
  try {
    const themeData = await readFile(THEME_PATH, 'utf-8');
    const theme = JSON.parse(themeData);

    return {
      // Backend: 'local' (default) or 'huggingface'
      backend: theme.generationBackend || 'local',

      // Seed settings
      seedMode: theme.seedMode || 'random', // 'random', 'fixed', 'incremental'
      fixedSeed: theme.fixedSeed || 42,

      // LoRA defaults per category
      loraDefaults: theme.loraDefaults || DEFAULT_LORA,

      // Advanced settings
      variants: theme.variants || 1,
      delay: theme.generationDelay || 2000,
      verbose: theme.generationVerbose || false
    };
  } catch (error) {
    console.warn('[AdminGeneration] Could not read theme.json, using defaults:', error.message);
    return {
      backend: 'local',
      seedMode: 'random',
      fixedSeed: 42,
      loraDefaults: DEFAULT_LORA,
      variants: 1,
      delay: 2000,
      verbose: false
    };
  }
}

// Track incremental seed across jobs
let incrementalSeed = 42;

// In-memory backend selection (can be changed at runtime without modifying theme.json)
// Valid values: 'comfyui' (local), 'huggingface'
let generationBackend = 'comfyui';

// Use imported CATEGORY_SCRIPT_MAP as SCRIPT_MAP
const SCRIPT_MAP = CATEGORY_SCRIPT_MAP;

// Generation state
const state = {
  queue: [],           // Pending jobs
  current: null,       // Currently running job
  history: [],         // Completed/failed jobs (last 50)
  process: null,       // Child process reference
  paused: false,       // Queue paused state
  stdout: [],          // Current job stdout lines (last 500)
  generatedImages: []  // Images generated in current job
};

// Note: generateJobId imported from generationUtils.js

/**
 * Broadcast event to admin:generation room
 */
function broadcast(type, payload) {
  broadcastToRoom(GENERATION_ROOM, { type, payload });
}

/**
 * Broadcast unified asset generation event
 * This normalizes all generation events across images, music, and SFX
 * @param {string} eventType - Event type (started, progress, completed, failed, queued)
 * @param {object} data - Event-specific data
 */
function broadcastUnified(eventType, data) {
  broadcastToRoom('admin:generation', {
    type: 'asset:generation_update',
    payload: {
      source: 'images',
      eventType,
      timestamp: new Date().toISOString(),
      ...data
    }
  });
}

/**
 * Send queue update to all subscribers
 */
function broadcastQueueUpdate() {
  broadcast('generation:queue_update', {
    current: state.current,
    pending: state.queue,
    paused: state.paused,
    stats: {
      pendingCount: state.queue.length,
      historyCount: state.history.length,
      isProcessing: state.current !== null
    }
  });
}

/**
 * Parse progress from stdout line (image-specific)
 * Uses shared parseProgress with step progress support
 * @param {string} line - Stdout line to parse
 * @returns {Object|null} Parsed progress or null
 */
function parseProgress(line) {
  // Try base progress patterns (asset, saved, generated)
  const baseProgress = parseProgressBase(line, { fileExtension: 'png' });
  if (baseProgress) return baseProgress;

  // Try step progress pattern (image-generation specific)
  return parseStepProgress(line);
}

/**
 * Build command line arguments for generation script
 * @param {Object} job - The job object
 * @param {Object} config - Generation configuration from theme.json
 */
function buildScriptArgs(job, config) {
  const args = [];

  // === BACKEND SELECTION ===
  // Priority: job-level override > in-memory state > theme.json config
  // If backend is 'huggingface', add the --huggingface flag
  const backend = job.options?.backend || generationBackend || config.backend;
  if (backend === 'huggingface') {
    args.push('--huggingface');
  }
  // comfyui (local) is default, no flag needed

  // === LORA MODEL ===
  // Job-level override > config default for category > hardcoded default
  const loraModel = job.options?.lora ||
    config.loraDefaults?.[job.category] ||
    DEFAULT_LORA[job.category];

  if (loraModel && VALID_LORA_MODELS.includes(loraModel)) {
    args.push('--lora', loraModel);
  }

  // === SEED ===
  // Job-level seed > seed mode from config
  if (job.options?.seed !== undefined) {
    args.push('--seed', String(job.options.seed));
  } else {
    const seedMode = job.options?.seedMode || config.seedMode;
    if (seedMode === 'fixed') {
      const seed = job.options?.fixedSeed || config.fixedSeed || 42;
      args.push('--seed', String(seed));
    } else if (seedMode === 'incremental') {
      args.push('--seed', String(incrementalSeed));
      incrementalSeed++;
    }
    // 'random' mode: don't pass --seed, let script randomize
  }

  // === VARIANTS ===
  // Only applicable to tiles and nodes
  const variants = job.options?.variants || config.variants;
  if (variants && variants > 1 && ['tiles', 'nodes'].includes(job.category)) {
    args.push('--variants', String(variants));
  }

  // === DELAY ===
  // Delay between API requests (useful for rate limiting)
  const delay = job.options?.delay || config.delay;
  if (delay && delay !== 2000) { // Only add if non-default
    args.push('--delay', String(delay));
  }

  // === FILTERS (category-specific) ===
  if (job.filters) {
    // Queue mode: process assets marked for regeneration
    if (job.filters.queueMode) {
      args.push('--queue');
    } else {
      if (job.filters.biome) args.push('--biome', job.filters.biome);
      if (job.filters.race) args.push('--race', job.filters.race);
      if (job.filters.class) args.push('--class', job.filters.class);
      if (job.filters.subcategory) args.push('--category', job.filters.subcategory);
      if (job.filters.key) args.push('--key', job.filters.key);
      if (job.filters.ids && Array.isArray(job.filters.ids)) {
        // For multiple IDs, run them sequentially
        job.filters.ids.forEach(id => args.push('--key', id));
      }
    }
  }

  // === OPTIONS ===
  if (job.options) {
    if (job.options.force) args.push('--force');
    if (job.options.dryRun) args.push('--dry-run');
    if (job.options.limit) args.push('--limit', String(job.options.limit));
    if (job.options.verbose || config.verbose) args.push('--verbose');
    if (job.options.backup) args.push('--backup');
  }

  return args;
}

/**
 * Start processing the next job in queue
 */
async function processNextJob() {
  // Don't start if paused or already processing
  if (state.paused || state.current || state.queue.length === 0) {
    return;
  }

  const job = state.queue.shift();
  state.current = job;
  state.stdout = [];
  state.generatedImages = [];

  job.status = 'running';
  job.startedAt = new Date().toISOString();
  job.progress = { current: 0, total: 0, steps: { current: 0, total: 0 } };

  // Get script path
  const script = SCRIPT_MAP[job.category];
  if (!script) {
    finishJob(job, 'failed', `Unknown category: ${job.category}`);
    return;
  }

  const scriptPath = path.join(SCRIPTS_DIR, script);
  if (!existsSync(scriptPath)) {
    finishJob(job, 'failed', `Script not found: ${script}`);
    return;
  }

  // Read generation config from theme.json
  const config = await getGenerationConfig();

  // Build arguments with config
  const args = buildScriptArgs(job, config);

  console.log(`[AdminGeneration] Starting: node ${script} ${args.join(' ')}`);
  console.log(`[AdminGeneration] Config: backend=${config.backend}, seedMode=${config.seedMode}, lora=${job.options?.lora || config.loraDefaults?.[job.category] || 'default'}`);

  // Broadcast start event
  broadcast('generation:started', {
    jobId: job.id,
    category: job.category,
    filters: job.filters,
    options: job.options,
    startedAt: job.startedAt
  });

  // Broadcast unified event
  broadcastUnified('started', {
    jobId: job.id,
    job: {
      id: job.id,
      type: 'images',
      category: job.category,
      filters: job.filters,
      status: 'running'
    }
  });

  broadcastQueueUpdate();

  // Spawn child process
  const child = spawn('node', [scriptPath, ...args], {
    cwd: SCRIPTS_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env }
  });

  state.process = child;

  // Handle stdout
  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());

    for (const line of lines) {
      // Store line (keep last 500)
      state.stdout.push({
        timestamp: new Date().toISOString(),
        type: 'stdout',
        text: line
      });
      if (state.stdout.length > 500) {
        state.stdout.shift();
      }

      // Parse progress
      const progress = parseProgress(line);
      if (progress) {
        if (progress.type === 'asset') {
          job.progress.current = progress.current;
          job.progress.total = progress.total;
        } else if (progress.type === 'step') {
          job.progress.steps.current = progress.current;
          job.progress.steps.total = progress.total;
        } else if (progress.type === 'saved') {
          state.generatedImages.push({
            path: progress.path,
            timestamp: new Date().toISOString()
          });
        }

        // Broadcast progress update
        broadcast('generation:progress', {
          jobId: job.id,
          progress: job.progress,
          images: state.generatedImages.length
        });

        // Broadcast unified progress
        broadcastUnified('progress', {
          jobId: job.id,
          progress: job.progress,
          generatedCount: state.generatedImages.length
        });
      }

      // Broadcast stdout line
      broadcast('generation:stdout', {
        jobId: job.id,
        line: {
          timestamp: new Date().toISOString(),
          type: 'stdout',
          text: line
        }
      });

      // Broadcast unified stdout
      broadcastUnified('stdout', {
        jobId: job.id,
        line,
        lineType: 'stdout'
      });
    }
  });

  // Handle stderr
  child.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());

    for (const line of lines) {
      state.stdout.push({
        timestamp: new Date().toISOString(),
        type: 'stderr',
        text: line
      });
      if (state.stdout.length > 500) {
        state.stdout.shift();
      }

      broadcast('generation:stdout', {
        jobId: job.id,
        line: {
          timestamp: new Date().toISOString(),
          type: 'stderr',
          text: line
        }
      });

      // Broadcast unified stderr
      broadcastUnified('stdout', {
        jobId: job.id,
        line,
        lineType: 'stderr'
      });
    }
  });

  // Handle process exit
  child.on('close', (code) => {
    state.process = null;

    if (code === 0) {
      finishJob(job, 'completed');
    } else if (job.status === 'cancelled') {
      // Already marked as cancelled
      finishJob(job, 'cancelled');
    } else {
      finishJob(job, 'failed', `Process exited with code ${code}`);
    }
  });

  // Handle spawn errors
  child.on('error', (error) => {
    state.process = null;
    finishJob(job, 'failed', error.message);
  });
}

/**
 * Finish a job and move to history
 */
function finishJob(job, status, error = null) {
  job.status = status;
  job.completedAt = new Date().toISOString();
  job.error = error;
  job.output = state.stdout.slice(-100); // Keep last 100 lines
  job.generatedImages = [...state.generatedImages];

  // Add to history
  state.history.unshift(job);
  if (state.history.length > 50) {
    state.history = state.history.slice(0, 50);
  }

  // Clear current
  state.current = null;
  state.stdout = [];
  state.generatedImages = [];

  // Broadcast completion event
  if (status === 'completed') {
    broadcast('generation:completed', {
      jobId: job.id,
      category: job.category,
      progress: job.progress,
      generatedImages: job.generatedImages,
      completedAt: job.completedAt
    });

    // Broadcast unified completed
    broadcastUnified('completed', {
      jobId: job.id,
      job: {
        id: job.id,
        type: 'images',
        category: job.category,
        status: 'completed',
        generatedAssets: job.generatedImages.map(img => ({
          type: 'image',
          path: img.path,
          timestamp: img.timestamp
        }))
      }
    });
  } else if (status === 'failed') {
    broadcast('generation:failed', {
      jobId: job.id,
      category: job.category,
      error: job.error,
      completedAt: job.completedAt
    });

    // Broadcast unified failed
    broadcastUnified('failed', {
      jobId: job.id,
      job: {
        id: job.id,
        type: 'images',
        category: job.category,
        status: 'failed',
        error: job.error
      }
    });
  }

  broadcastQueueUpdate();

  // Process next job
  processNextJob();
}

/**
 * Queue a new generation job
 *
 * @param {string} category - Asset category (tiles, portraits, items, icons, nodes, overlays)
 * @param {Object} filters - Filter criteria for which assets to generate
 * @param {string} filters.biome - For tiles: forest, cave, mountain, bridge, castle
 * @param {string} filters.race - For portraits: human, elf, dwarf, vampire, orc
 * @param {string} filters.class - For portraits: warrior, wizard, monk, chemist
 * @param {string} filters.subcategory - For items/icons: category name
 * @param {string} filters.key - Generate specific asset by key
 * @param {string[]} filters.ids - Generate specific assets by ID array
 * @param {Object} options - Generation options
 * @param {string} options.backend - 'local' (default) or 'huggingface'
 * @param {string} options.lora - LoRA model: 'v1', 'v2', 'modern-pixel', 'retro-pixel'
 * @param {string} options.seedMode - 'random', 'fixed', or 'incremental'
 * @param {number} options.seed - Specific seed value (overrides seedMode)
 * @param {number} options.fixedSeed - Fixed seed when seedMode='fixed'
 * @param {number} options.variants - Number of variants (tiles/nodes only)
 * @param {number} options.delay - Delay between requests in ms
 * @param {boolean} options.force - Regenerate even if exists
 * @param {boolean} options.dryRun - Preview without generating
 * @param {number} options.limit - Maximum assets to generate
 * @param {boolean} options.verbose - Verbose output
 * @param {boolean} options.backup - Create backup before generating
 */
export function queueJob(category, filters = {}, options = {}) {
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error(`Invalid category: ${category}`);
  }

  // Validate LoRA model if specified
  if (options.lora && !VALID_LORA_MODELS.includes(options.lora)) {
    throw new Error(`Invalid LoRA model: ${options.lora}. Valid: ${VALID_LORA_MODELS.join(', ')}`);
  }

  // Validate backend if specified
  if (options.backend && !VALID_BACKENDS.includes(options.backend)) {
    throw new Error(`Invalid backend: ${options.backend}. Valid: ${VALID_BACKENDS.join(', ')}`);
  }

  // Validate seedMode if specified
  if (options.seedMode && !['random', 'fixed', 'incremental'].includes(options.seedMode)) {
    throw new Error(`Invalid seedMode: ${options.seedMode}. Valid: random, fixed, incremental`);
  }

  const job = {
    id: generateJobId(),
    category,
    filters,
    options,
    status: 'pending',
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    progress: { current: 0, total: 0, steps: { current: 0, total: 0 } },
    error: null
  };

  state.queue.push(job);

  broadcastQueueUpdate();

  // Broadcast unified queue event
  broadcastUnified('queued', {
    jobId: job.id,
    position: state.queue.length,
    job: {
      id: job.id,
      type: 'images',
      category: job.category,
      filters: job.filters,
      status: 'pending'
    }
  });

  // Start processing if idle
  processNextJob();

  return {
    jobId: job.id,
    queuePosition: state.queue.length
  };
}

/**
 * Cancel a specific job or all jobs
 */
export function cancelJobs({ all = false, jobId = null } = {}) {
  let cancelledCount = 0;

  if (all) {
    // Cancel all pending jobs
    for (const job of state.queue) {
      job.status = 'cancelled';
      job.completedAt = new Date().toISOString();
      state.history.unshift(job);
      cancelledCount++;
    }
    state.queue = [];

    // Cancel current job if running
    if (state.current && state.process) {
      state.current.status = 'cancelled';
      state.process.kill('SIGTERM');
      cancelledCount++;
    }
  } else if (jobId) {
    // Check if it's the current job
    if (state.current?.id === jobId) {
      if (state.process) {
        state.current.status = 'cancelled';
        state.process.kill('SIGTERM');
        cancelledCount = 1;
      }
    } else {
      // Check pending queue
      const index = state.queue.findIndex(j => j.id === jobId);
      if (index >= 0) {
        const job = state.queue.splice(index, 1)[0];
        job.status = 'cancelled';
        job.completedAt = new Date().toISOString();
        state.history.unshift(job);
        cancelledCount = 1;
      }
    }
  }

  if (cancelledCount > 0) {
    broadcastQueueUpdate();
  }

  return { cancelledCount };
}

/**
 * Pause the queue (current job continues, no new jobs start)
 */
export function pauseQueue() {
  state.paused = true;
  broadcastQueueUpdate();
  return { paused: true };
}

/**
 * Resume the queue
 */
export function resumeQueue() {
  state.paused = false;
  broadcastQueueUpdate();
  processNextJob();
  return { paused: false };
}

/**
 * Get queue status
 */
export function getQueueStatus() {
  return {
    current: state.current,
    pending: state.queue,
    history: state.history.slice(0, 20),
    paused: state.paused,
    stdout: state.stdout.slice(-100),
    generatedImages: state.generatedImages,
    stats: {
      pendingCount: state.queue.length,
      historyCount: state.history.length,
      isProcessing: state.current !== null
    }
  };
}

/**
 * Get a specific job by ID
 */
export function getJob(jobId) {
  // Check current
  if (state.current?.id === jobId) {
    return {
      ...state.current,
      stdout: state.stdout,
      generatedImages: state.generatedImages
    };
  }

  // Check pending
  const pending = state.queue.find(j => j.id === jobId);
  if (pending) return pending;

  // Check history
  const historical = state.history.find(j => j.id === jobId);
  if (historical) return historical;

  return null;
}

/**
 * Get valid asset categories for generation
 * @returns {string[]} Array of valid category names: tiles, portraits, items, icons, nodes, overlays
 */
export function getValidCategories() {
  return VALID_CATEGORIES;
}

/**
 * Get valid LoRA model identifiers
 * @returns {string[]} Array of valid LoRA model names: v1, v2, modern-pixel, retro-pixel
 */
export function getValidLoraModels() {
  return VALID_LORA_MODELS;
}

/**
 * Get default LoRA model mapping for each category
 * @returns {Object<string, string>} Map of category name to default LoRA model
 * @example
 * // Returns: { tiles: 'v2', portraits: 'v1', items: 'v1', ... }
 */
export function getDefaultLora() {
  return { ...DEFAULT_LORA };
}

/**
 * Get current generation configuration from theme.json
 * @returns {Promise<Object>} Configuration object with backend, seedMode, fixedSeed, loraDefaults, variants, delay, verbose
 */
export async function getConfig() {
  return getGenerationConfig();
}

/**
 * Reset the incremental seed counter to a specified value
 * Used when seedMode='incremental' to restart or set a specific seed sequence
 * @param {number} [seed=42] - The seed value to reset to
 */
export function resetIncrementalSeed(seed = 42) {
  incrementalSeed = seed;
}

/**
 * Set the generation backend and persist to theme.json
 * @param {string} backend - 'comfyui' or 'huggingface'
 * @throws {Error} If backend is invalid
 */
export function setGenerationBackend(backend) {
  if (!VALID_BACKENDS.includes(backend)) {
    throw new Error(`Invalid backend: ${backend}. Valid: ${VALID_BACKENDS.join(', ')}`);
  }
  generationBackend = backend;

  // I1 FIX: Persist backend selection to theme.json
  try {
    const themeData = readFileSync(THEME_PATH, 'utf-8');
    const theme = JSON.parse(themeData);
    theme.generationBackend = backend;
    writeFileSync(THEME_PATH, JSON.stringify(theme, null, 2));
    console.log(`[AdminGeneration] Backend set and persisted to: ${backend}`);
  } catch (err) {
    // Log but don't fail - in-memory value still works
    console.warn(`[AdminGeneration] Backend set to ${backend} (persistence failed: ${err.message})`);
  }
}

/**
 * Get the current generation backend
 * @returns {string} Current backend ('comfyui' or 'huggingface')
 */
export function getGenerationBackend() {
  return generationBackend;
}

/**
 * Get valid backends
 * @returns {string[]} Array of valid backend names
 */
export function getValidBackends() {
  return [...VALID_BACKENDS];
}

export default {
  queueJob,
  cancelJobs,
  pauseQueue,
  resumeQueue,
  getQueueStatus,
  getJob,
  getValidCategories,
  getValidLoraModels,
  getDefaultLora,
  getConfig,
  resetIncrementalSeed,
  setGenerationBackend,
  getGenerationBackend,
  getValidBackends
};
