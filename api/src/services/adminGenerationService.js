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
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { broadcastToRoom } from '../websocket/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SCRIPTS_DIR = path.join(PROJECT_ROOT, 'scripts/ai-images');

// Room name for generation events
const GENERATION_ROOM = 'admin:generation';

// Valid categories
const VALID_CATEGORIES = ['tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays'];

// Category to script mapping
const SCRIPT_MAP = {
  tiles: 'generate-tiles.js',
  portraits: 'generate-portraits.js',
  items: 'generate-items.js',
  icons: 'generate-icons.js',
  nodes: 'generate-nodes.js',
  overlays: 'generate-overlays.js'
};

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

/**
 * Generate unique job ID
 */
function generateJobId() {
  return `job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Broadcast event to admin:generation room
 */
function broadcast(type, payload) {
  broadcastToRoom(GENERATION_ROOM, { type, payload });
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
 * Parse progress from stdout line
 * Expected formats:
 * - [1/10] Generating: asset_name
 * - Progress: 15/50 steps (30%)
 * - Generated: asset_name
 * - Saved: /path/to/file.png
 */
function parseProgress(line) {
  // Match [X/Y] pattern for asset progress
  const assetMatch = line.match(/\[(\d+)\/(\d+)\]/);
  if (assetMatch) {
    return {
      type: 'asset',
      current: parseInt(assetMatch[1], 10),
      total: parseInt(assetMatch[2], 10)
    };
  }

  // Match Progress: X/Y steps pattern for step progress
  const stepMatch = line.match(/Progress:\s*(\d+)\/(\d+)\s*steps/i);
  if (stepMatch) {
    return {
      type: 'step',
      current: parseInt(stepMatch[1], 10),
      total: parseInt(stepMatch[2], 10)
    };
  }

  // Match Saved: path pattern for completed image
  const savedMatch = line.match(/Saved:\s*(.+\.png)/i);
  if (savedMatch) {
    return {
      type: 'saved',
      path: savedMatch[1]
    };
  }

  // Match Generated: asset pattern
  const generatedMatch = line.match(/Generated:\s*(\S+)/i);
  if (generatedMatch) {
    return {
      type: 'generated',
      asset: generatedMatch[1]
    };
  }

  return null;
}

/**
 * Build command line arguments for generation script
 */
function buildScriptArgs(job) {
  const args = [];

  // Add filters
  if (job.filters) {
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

  // Add options
  if (job.options) {
    if (job.options.force) args.push('--force');
    if (job.options.dryRun) args.push('--dry-run');
    if (job.options.limit) args.push('--limit', String(job.options.limit));
    if (job.options.verbose) args.push('--verbose');
  }

  return args;
}

/**
 * Start processing the next job in queue
 */
function processNextJob() {
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

  // Build arguments
  const args = buildScriptArgs(job);

  console.log(`[AdminGeneration] Starting: node ${script} ${args.join(' ')}`);

  // Broadcast start event
  broadcast('generation:started', {
    jobId: job.id,
    category: job.category,
    filters: job.filters,
    options: job.options,
    startedAt: job.startedAt
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
  } else if (status === 'failed') {
    broadcast('generation:failed', {
      jobId: job.id,
      category: job.category,
      error: job.error,
      completedAt: job.completedAt
    });
  }

  broadcastQueueUpdate();

  // Process next job
  processNextJob();
}

/**
 * Queue a new generation job
 */
export function queueJob(category, filters = {}, options = {}) {
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error(`Invalid category: ${category}`);
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
 * Get valid categories
 */
export function getValidCategories() {
  return VALID_CATEGORIES;
}

export default {
  queueJob,
  cancelJobs,
  pauseQueue,
  resumeQueue,
  getQueueStatus,
  getJob,
  getValidCategories
};
