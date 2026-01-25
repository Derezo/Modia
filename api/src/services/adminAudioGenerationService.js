/**
 * Admin Audio Generation Service
 * Queue management for AI audio generation (Suno for music, ElevenLabs for SFX)
 *
 * Handles:
 * - Job queue with pending, current, completed, failed states
 * - Child process spawning for generation scripts
 * - Progress parsing from stdout
 * - WebSocket event broadcasting to admin:audio-generation room
 * - Cancel/pause/resume functionality
 * - Suno task status checking
 *
 * @module adminAudioGenerationService
 * @see adminAudio.js - Audio admin routes
 * @see scripts/audio/generate-music.js - Music generation script
 * @see scripts/audio/generate-sfx.js - SFX generation script
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { broadcastToRoom } from '../websocket/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SCRIPTS_DIR = path.join(PROJECT_ROOT, 'scripts/audio');

// Room name for audio generation events
const GENERATION_ROOM = 'admin:audio-generation';

// Valid audio types
const VALID_AUDIO_TYPES = ['music', 'sfx'];

// Type to script mapping
const SCRIPT_MAP = {
  music: 'generate-music.js',
  sfx: 'generate-sfx.js'
};

// Generation state
const state = {
  queue: [],           // Pending jobs
  current: null,       // Currently running job
  history: [],         // Completed/failed jobs (last 50)
  process: null,       // Child process reference
  paused: false,       // Queue paused state
  stdout: [],          // Current job stdout lines (last 500)
  generatedAssets: []  // Assets generated in current job
};

/**
 * Generate unique job ID
 * @returns {string} Unique job ID
 */
function generateJobId() {
  return `audio_job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Broadcast event to admin:audio-generation room
 * @param {string} type - Event type
 * @param {object} payload - Event payload
 */
function broadcast(type, payload) {
  broadcastToRoom(GENERATION_ROOM, { type, payload });
}

/**
 * Send queue update to all subscribers
 */
function broadcastQueueUpdate() {
  broadcast('audio:queue_update', {
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
 * - [1/10] Generating: track_name
 * - Queued: task_id
 * - Downloading: track_name
 * - Generated: track_name
 * - Saved: /path/to/file.mp3
 * @param {string} line - Stdout line to parse
 * @returns {object|null} Parsed progress or null
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

  // Match Queued: task_id pattern
  const queuedMatch = line.match(/Queued:\s*(\S+)/i);
  if (queuedMatch) {
    return {
      type: 'queued',
      taskId: queuedMatch[1]
    };
  }

  // Match Downloading: pattern
  const downloadingMatch = line.match(/Downloading:\s*(\S+)/i);
  if (downloadingMatch) {
    return {
      type: 'downloading',
      asset: downloadingMatch[1]
    };
  }

  // Match Saved: path pattern for completed audio
  const savedMatch = line.match(/Saved:\s*(.+\.mp3)/i);
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
 * Build command line arguments for audio generation script
 * @param {object} job - The job object
 * @returns {string[]} Command line arguments
 */
function buildScriptArgs(job) {
  const args = [];

  // Type-specific filters
  if (job.type === 'music') {
    if (job.filters?.category) args.push('--category', job.filters.category);
    if (job.filters?.region) args.push('--region', job.filters.region);
    if (job.filters?.key) args.push('--key', job.filters.key);
  } else if (job.type === 'sfx') {
    if (job.filters?.category) args.push('--category', job.filters.category);
    if (job.filters?.subcategory) args.push('--subcategory', job.filters.subcategory);
    if (job.filters?.key) args.push('--key', job.filters.key);
  }

  // Common options
  if (job.options?.dryRun) args.push('--dry-run');
  if (job.options?.force) args.push('--force');
  if (job.options?.wait) args.push('--wait');
  if (job.options?.limit) args.push('--limit', String(job.options.limit));

  return args;
}

/**
 * Execute the next job in queue
 */
async function processNextJob() {
  if (state.paused || state.current || state.queue.length === 0) {
    return;
  }

  const job = state.queue.shift();
  state.current = job;
  state.stdout = [];
  state.generatedAssets = [];

  job.status = 'running';
  job.startedAt = new Date().toISOString();

  broadcastQueueUpdate();
  broadcast('audio:job_started', { job });

  // Get script path
  const scriptName = SCRIPT_MAP[job.type];
  if (!scriptName) {
    completeJob(job, 'failed', `Unknown audio type: ${job.type}`);
    return;
  }

  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  if (!existsSync(scriptPath)) {
    completeJob(job, 'failed', `Script not found: ${scriptPath}`);
    return;
  }

  const args = buildScriptArgs(job);

  try {
    const child = spawn('node', [scriptPath, ...args], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, FORCE_COLOR: '0' }
    });

    state.process = child;

    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        // Keep last 500 lines
        if (state.stdout.length >= 500) {
          state.stdout.shift();
        }
        state.stdout.push(line);

        const progress = parseProgress(line);
        if (progress) {
          job.progress = progress;

          if (progress.type === 'saved') {
            state.generatedAssets.push(progress.path);
          }

          broadcast('audio:progress', {
            jobId: job.id,
            progress,
            line,
            generatedCount: state.generatedAssets.length
          });
        }
      }
    });

    child.stderr.on('data', (data) => {
      const line = `[stderr] ${data.toString().trim()}`;
      if (state.stdout.length >= 500) {
        state.stdout.shift();
      }
      state.stdout.push(line);

      broadcast('audio:log', {
        jobId: job.id,
        line,
        level: 'error'
      });
    });

    child.on('close', (code) => {
      state.process = null;
      const status = code === 0 ? 'completed' : 'failed';
      const error = code !== 0 ? `Process exited with code ${code}` : null;
      completeJob(job, status, error);
    });

    child.on('error', (err) => {
      state.process = null;
      completeJob(job, 'failed', err.message);
    });
  } catch (error) {
    completeJob(job, 'failed', error.message);
  }
}

/**
 * Complete a job and process the next one
 * @param {object} job - Job to complete
 * @param {string} status - Final status ('completed' or 'failed')
 * @param {string|null} error - Error message if failed
 */
function completeJob(job, status, error = null) {
  job.status = status;
  job.completedAt = new Date().toISOString();
  job.error = error;
  job.generatedAssets = [...state.generatedAssets];
  job.stdout = [...state.stdout];

  // Add to history, keep last 50
  state.history.unshift(job);
  if (state.history.length > 50) {
    state.history.pop();
  }

  state.current = null;
  state.stdout = [];
  state.generatedAssets = [];

  broadcast('audio:job_completed', { job });
  broadcastQueueUpdate();

  // Process next job
  setImmediate(processNextJob);
}

/**
 * Queue a new generation job
 * @param {string} type - 'music' or 'sfx'
 * @param {object} filters - Type-specific filters
 * @param {object} options - Generation options
 * @returns {object} { jobId, position }
 */
function queueJob(type, filters = {}, options = {}) {
  if (!VALID_AUDIO_TYPES.includes(type)) {
    throw new Error(`Invalid audio type: ${type}. Valid: ${VALID_AUDIO_TYPES.join(', ')}`);
  }

  const job = {
    id: generateJobId(),
    type,
    filters,
    options,
    status: 'pending',
    createdAt: new Date().toISOString(),
    progress: null,
    error: null
  };

  state.queue.push(job);
  const position = state.queue.length;

  broadcastQueueUpdate();
  broadcast('audio:job_queued', { job, position });

  // Start processing if not already
  setImmediate(processNextJob);

  return { jobId: job.id, position };
}

/**
 * Cancel job(s)
 * @param {object} options - { all?: boolean, jobId?: string }
 * @returns {object} { cancelledCount }
 */
function cancelJobs({ all = false, jobId } = {}) {
  let cancelledCount = 0;

  if (all) {
    // Cancel all pending jobs
    cancelledCount = state.queue.length;
    state.queue = [];

    // Kill current process if running
    if (state.process) {
      state.process.kill('SIGTERM');
      cancelledCount++;
    }
  } else if (jobId) {
    // Cancel specific job
    const queueIndex = state.queue.findIndex(j => j.id === jobId);
    if (queueIndex !== -1) {
      state.queue.splice(queueIndex, 1);
      cancelledCount = 1;
    } else if (state.current?.id === jobId && state.process) {
      state.process.kill('SIGTERM');
      cancelledCount = 1;
    }
  }

  if (cancelledCount > 0) {
    broadcastQueueUpdate();
  }

  return { cancelledCount };
}

/**
 * Pause the queue (current job continues)
 * @returns {object} { paused }
 */
function pauseQueue() {
  state.paused = true;
  broadcastQueueUpdate();
  return { paused: true };
}

/**
 * Resume the queue
 * @returns {object} { paused }
 */
function resumeQueue() {
  state.paused = false;
  broadcastQueueUpdate();
  setImmediate(processNextJob);
  return { paused: false };
}

/**
 * Get current queue status
 * @returns {object} Queue status
 */
function getQueueStatus() {
  return {
    current: state.current,
    pending: state.queue,
    history: state.history.slice(0, 10), // Last 10 jobs
    paused: state.paused,
    stats: {
      pendingCount: state.queue.length,
      historyCount: state.history.length,
      isProcessing: state.current !== null
    }
  };
}

/**
 * Get specific job by ID
 * @param {string} jobId - Job ID
 * @returns {object|null} Job or null
 */
function getJob(jobId) {
  if (state.current?.id === jobId) {
    return {
      ...state.current,
      stdout: state.stdout,
      generatedAssets: state.generatedAssets
    };
  }

  const queuedJob = state.queue.find(j => j.id === jobId);
  if (queuedJob) return queuedJob;

  const historyJob = state.history.find(j => j.id === jobId);
  return historyJob || null;
}

/**
 * Check Suno task status
 * This is a placeholder - the actual implementation would call Suno API
 * @param {string} taskId - Suno task ID
 * @returns {Promise<object>} Task status
 */
async function checkSunoStatus(taskId) {
  // This would be implemented to call Suno API
  // For now, return a placeholder indicating the feature needs API integration
  return {
    taskId,
    status: 'unknown',
    message: 'Suno API integration pending. Check scripts/audio/suno-api.js for implementation.'
  };
}

export default {
  queueJob,
  cancelJobs,
  pauseQueue,
  resumeQueue,
  getQueueStatus,
  getJob,
  checkSunoStatus,
  VALID_AUDIO_TYPES
};
