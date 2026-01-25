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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { broadcastToRoom } from '../websocket/index.js';
import { loadJsonFile, saveJsonFile } from '../utils/jsonFileUtils.js';
import { VALID_AUDIO_TYPES, AUDIO_SCRIPT_MAP } from '../utils/assetConstants.js';
import { validateSFXPrompt } from '../utils/audioValidation.js';
import { generateJobId as generateJobIdBase, parseProgress as parseProgressBase } from './generationUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const SCRIPTS_DIR = path.join(PROJECT_ROOT, 'scripts/audio');
const AI_IMAGE_METADATA_DIR = path.join(PROJECT_ROOT, 'ai-image-metadata');
const SEED_STATE_FILE = path.join(AI_IMAGE_METADATA_DIR, 'seed-state.json');
const AUDIO_METADATA_DIR = path.join(PROJECT_ROOT, 'audio-metadata');

// Room name for audio generation events
const GENERATION_ROOM = 'admin:audio-generation';

// Use imported AUDIO_SCRIPT_MAP as SCRIPT_MAP
const SCRIPT_MAP = AUDIO_SCRIPT_MAP;

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

// Pending Suno tasks for auto-polling
const pendingSunoTasks = new Map();

// Suno polling interval (30 seconds)
const SUNO_POLL_INTERVAL_MS = 30 * 1000;

// Post-completion polling duration (15 seconds)
const POST_COMPLETION_POLL_DURATION_MS = 15 * 1000;

// Track post-completion polling state
let postCompletionPollingEndTime = null;

// Suno poller interval reference
let sunoPollerInterval = null;

/**
 * Generate unique audio job ID
 * Uses shared generateJobId with 'audio_job' prefix
 * @returns {string} Unique job ID
 */
function generateJobId() {
  return generateJobIdBase('audio_job');
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
 * Broadcast unified asset generation event
 * This normalizes all generation events across images, music, and SFX
 * @param {string} eventType - Event type (started, progress, completed, failed, queued)
 * @param {string} source - Source type ('music' or 'sfx')
 * @param {object} data - Event-specific data
 */
function broadcastUnified(eventType, source, data) {
  // Broadcast to the main admin:generation room for unified view
  broadcastToRoom('admin:generation', {
    type: 'asset:generation_update',
    payload: {
      source,
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

// Audio-specific progress patterns (Suno/ElevenLabs)
const AUDIO_EXTRA_PATTERNS = [
  {
    regex: /Queued:\s*(\S+)/i,
    processor: (match) => ({ type: 'queued', taskId: match[1] })
  },
  {
    regex: /Downloading:\s*(\S+)/i,
    processor: (match) => ({ type: 'downloading', asset: match[1] })
  }
];

/**
 * Parse progress from stdout line (audio-specific)
 * Uses shared parseProgress with audio-specific patterns
 * @param {string} line - Stdout line to parse
 * @returns {object|null} Parsed progress or null
 */
function parseProgress(line) {
  return parseProgressBase(line, {
    fileExtension: 'mp3',
    extraPatterns: AUDIO_EXTRA_PATTERNS
  });
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
    // Support both 'key' (singular) and 'keys' (array) for regeneration
    if (job.filters?.key) {
      args.push('--key', job.filters.key);
    } else if (Array.isArray(job.filters?.keys) && job.filters.keys.length > 0) {
      job.filters.keys.forEach(k => args.push('--key', k));
    }
  } else if (job.type === 'sfx') {
    if (job.filters?.category) args.push('--category', job.filters.category);
    if (job.filters?.subcategory) args.push('--subcategory', job.filters.subcategory);
    // Support both 'key' (singular) and 'keys' (array) for regeneration
    if (job.filters?.key) {
      args.push('--key', job.filters.key);
    } else if (Array.isArray(job.filters?.keys) && job.filters.keys.length > 0) {
      job.filters.keys.forEach(k => args.push('--key', k));
    }
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

  // Broadcast unified event
  broadcastUnified('started', job.type, {
    jobId: job.id,
    job: {
      id: job.id,
      type: job.type,
      filters: job.filters,
      status: 'running'
    }
  });

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

          // Broadcast unified progress
          broadcastUnified('progress', job.type, {
            jobId: job.id,
            progress,
            generatedCount: state.generatedAssets.length
          });

          // Broadcast unified stdout for each line
          broadcastUnified('stdout', job.type, {
            jobId: job.id,
            line,
            lineType: 'stdout'
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

      // Broadcast unified stderr
      broadcastUnified('stdout', job.type, {
        jobId: job.id,
        line,
        lineType: 'stderr'
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

  // Enable post-completion polling for 15 seconds to catch final Suno task updates
  enablePostCompletionPolling();

  broadcast('audio:job_completed', { job });

  // Broadcast unified completed/failed event
  broadcastUnified(status, job.type, {
    jobId: job.id,
    job: {
      id: job.id,
      type: job.type,
      filters: job.filters,
      status,
      error: job.error || null,
      generatedAssets: job.generatedAssets.map(path => ({
        type: job.type === 'music' ? 'music' : 'sfx',
        path,
        timestamp: new Date().toISOString()
      }))
    }
  });

  broadcastQueueUpdate();

  // Process next job
  setImmediate(processNextJob);
}

// Note: validateSFXPrompt is imported from ../utils/audioValidation.js

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

  // Validate SFX prompts before queuing (non-strict: missing prompt ok, may use metadata default)
  if (type === 'sfx' && options.prompt) {
    const validation = validateSFXPrompt(options.prompt, { strictMode: false });
    if (!validation.valid) {
      throw new Error(`Invalid SFX prompt: ${validation.message}`);
    }
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

  // Broadcast unified queue event
  broadcastUnified('queued', type, {
    jobId: job.id,
    position,
    job: {
      id: job.id,
      type,
      filters,
      status: 'pending'
    }
  });

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

// ============================================================================
// SUNO TASK AUTO-POLLING
// ============================================================================

/**
 * Register a Suno task for auto-polling
 * @param {string} taskId - Suno task ID
 * @param {object} trackInfo - Track information { type, id, name, ... }
 */
function registerSunoTask(taskId, trackInfo) {
  pendingSunoTasks.set(taskId, {
    taskId,
    trackInfo,
    registeredAt: new Date().toISOString(),
    lastPolledAt: null,
    pollCount: 0
  });

  broadcast('audio:suno_task_registered', {
    taskId,
    trackInfo,
    pendingCount: pendingSunoTasks.size
  });

  console.log(`[Suno Poller] Registered task ${taskId} for polling (${pendingSunoTasks.size} pending)`);
}

/**
 * Poll all pending Suno tasks and update status
 */
async function pollSunoTasks() {
  if (pendingSunoTasks.size === 0) {
    // Check if we should continue polling after job completion
    if (postCompletionPollingEndTime && Date.now() < postCompletionPollingEndTime) {
      // Continue polling for 15 seconds after job completion
      return;
    }
    return;
  }

  console.log(`[Suno Poller] Polling ${pendingSunoTasks.size} pending tasks...`);

  for (const [taskId, taskData] of pendingSunoTasks) {
    try {
      const status = await checkSunoStatus(taskId);
      taskData.lastPolledAt = new Date().toISOString();
      taskData.pollCount++;

      if (status.status === 'SUCCESS') {
        console.log(`[Suno Poller] Task ${taskId} completed successfully`);

        // Update audio metadata if we have track info
        if (taskData.trackInfo) {
          try {
            await updateAudioMetadataFromTask(taskData.trackInfo, status);
          } catch (err) {
            console.error(`[Suno Poller] Failed to update metadata for ${taskId}:`, err.message);
          }
        }

        // Remove from pending and broadcast success
        pendingSunoTasks.delete(taskId);
        broadcast('audio:suno_task_complete', {
          taskId,
          trackInfo: taskData.trackInfo,
          status,
          pendingCount: pendingSunoTasks.size
        });

      } else if (status.status === 'FAILED') {
        console.log(`[Suno Poller] Task ${taskId} failed`);

        // Remove from pending and broadcast failure
        pendingSunoTasks.delete(taskId);
        broadcast('audio:suno_task_failed', {
          taskId,
          trackInfo: taskData.trackInfo,
          status,
          error: status.error || status.message,
          pendingCount: pendingSunoTasks.size
        });

      } else {
        // Still pending - update the stored data
        pendingSunoTasks.set(taskId, taskData);
      }
    } catch (err) {
      console.error(`[Suno Poller] Error polling task ${taskId}:`, err.message);
    }
  }
}

/**
 * Update audio metadata from completed Suno task
 * @param {object} trackInfo - Track info from registration
 * @param {object} _status - Status response from Suno (unused until API integration)
 */
async function updateAudioMetadataFromTask(trackInfo, _status) {
  // This updates the metadata based on Suno task completion
  // The actual file path and metadata updates depend on trackInfo structure
  if (!trackInfo.type || !trackInfo.id) {
    console.warn('[Suno Poller] Cannot update metadata - missing type or id in trackInfo');
    return;
  }

  // For now, just log - actual implementation would update the metadata file
  // when Suno API integration is complete (_status will contain the audio URL, etc.)
  console.log(`[Suno Poller] Would update metadata for ${trackInfo.type}/${trackInfo.id}`);
}

/**
 * Start the Suno task poller
 */
function startSunoPoller() {
  if (sunoPollerInterval) {
    console.log('[Suno Poller] Poller already running');
    return;
  }

  sunoPollerInterval = setInterval(pollSunoTasks, SUNO_POLL_INTERVAL_MS);
  console.log(`[Suno Poller] Started polling every ${SUNO_POLL_INTERVAL_MS / 1000}s`);
}

/**
 * Stop the Suno task poller
 */
function stopSunoPoller() {
  if (sunoPollerInterval) {
    clearInterval(sunoPollerInterval);
    sunoPollerInterval = null;
    console.log('[Suno Poller] Stopped polling');
  }
}

/**
 * Get pending Suno tasks
 * @returns {Array} Array of pending task data
 */
function getPendingSunoTasks() {
  return Array.from(pendingSunoTasks.values());
}

// ============================================================================
// POST-COMPLETION QUEUE POLLING (2.2)
// ============================================================================

/**
 * Enable post-completion polling for 15 seconds after a job completes
 * This allows any final Suno tasks from the job to be detected
 */
function enablePostCompletionPolling() {
  postCompletionPollingEndTime = Date.now() + POST_COMPLETION_POLL_DURATION_MS;
  console.log(`[Queue Poller] Post-completion polling enabled for ${POST_COMPLETION_POLL_DURATION_MS / 1000}s`);
}

// ============================================================================
// WAVEFORM PERSISTENCE (2.3)
// ============================================================================

/**
 * Update audio metadata with waveform data
 * @param {string} type - 'music' or 'sfx'
 * @param {string} id - Asset ID
 * @param {Array<number>} waveform - Waveform peaks array
 * @returns {Promise<boolean>} Success status
 */
async function persistWaveformData(type, id, waveform) {
  try {
    // Find the asset's source file
    let sourceFilePath = null;
    let arrayKey = null;

    if (type === 'music') {
      // Load music manifest to find source file
      const manifest = await loadJsonFile(path.join(AUDIO_METADATA_DIR, 'music/manifest.json'));
      if (manifest?.categories) {
        for (const categoryKey of Object.keys(manifest.categories)) {
          const categoryFile = manifest.categories[categoryKey];
          const categoryData = await loadJsonFile(path.join(AUDIO_METADATA_DIR, 'music', categoryFile));
          if (categoryData?.tracks) {
            const track = categoryData.tracks.find(t => t.id === id);
            if (track) {
              sourceFilePath = path.join(AUDIO_METADATA_DIR, 'music', categoryFile);
              arrayKey = 'tracks';
              break;
            }
          }
        }
      }
    } else {
      // Load SFX manifest to find source file
      const manifest = await loadJsonFile(path.join(AUDIO_METADATA_DIR, 'sfx/manifest.json'));
      if (manifest?.categories) {
        for (const categoryKey of Object.keys(manifest.categories)) {
          const categoryData = manifest.categories[categoryKey];
          if (categoryData?.file) {
            const sfxData = await loadJsonFile(path.join(AUDIO_METADATA_DIR, 'sfx', categoryData.file));
            if (sfxData?.effects) {
              const effect = sfxData.effects.find(e => e.id === id);
              if (effect) {
                sourceFilePath = path.join(AUDIO_METADATA_DIR, 'sfx', categoryData.file);
                arrayKey = 'effects';
                break;
              }
            }
          }
        }
      }
    }

    if (!sourceFilePath || !arrayKey) {
      console.warn(`[Waveform] Could not find source file for ${type}/${id}`);
      return false;
    }

    // Load, update, and save the file
    const fileData = await loadJsonFile(sourceFilePath);
    if (!fileData || !fileData[arrayKey]) {
      return false;
    }

    const assetIndex = fileData[arrayKey].findIndex(a => a.id === id);
    if (assetIndex === -1) {
      return false;
    }

    fileData[arrayKey][assetIndex].waveform = waveform;
    await saveJsonFile(sourceFilePath, fileData);

    console.log(`[Waveform] Persisted waveform for ${type}/${id}`);
    return true;
  } catch (err) {
    console.error(`[Waveform] Failed to persist waveform for ${type}/${id}:`, err.message);
    return false;
  }
}

// ============================================================================
// INCREMENTAL SEED PERSISTENCE (2.5)
// ============================================================================

/**
 * Read the current seed value from seed-state.json
 * @returns {number} Current seed value (defaults to 1 if file doesn't exist)
 */
function readSeedState() {
  try {
    if (existsSync(SEED_STATE_FILE)) {
      const data = readFileSync(SEED_STATE_FILE, 'utf8');
      const state = JSON.parse(data);
      return state.seed || 1;
    }
  } catch (err) {
    console.warn(`[Seed State] Failed to read seed-state.json: ${err.message}`);
  }
  return 1;
}

/**
 * Save the seed value to seed-state.json
 * @param {number} seed - Seed value to save
 * @returns {boolean} Success status
 */
function saveSeedState(seed) {
  try {
    // Ensure directory exists
    if (!existsSync(AI_IMAGE_METADATA_DIR)) {
      mkdirSync(AI_IMAGE_METADATA_DIR, { recursive: true });
    }

    const state = {
      seed,
      lastUpdated: new Date().toISOString()
    };

    writeFileSync(SEED_STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`[Seed State] Saved seed value: ${seed}`);
    return true;
  } catch (err) {
    console.error(`[Seed State] Failed to save seed-state.json: ${err.message}`);
    return false;
  }
}

// I2 FIX: Simple mutex to prevent seed race conditions
let seedLock = false;

/**
 * Get the next seed value and increment
 * Uses a simple mutex to prevent race conditions when multiple calls happen simultaneously
 * @returns {Promise<number>} The seed value to use (increments after reading)
 */
async function getNextSeed() {
  // Wait for lock with exponential backoff
  let attempts = 0;
  while (seedLock) {
    await new Promise(r => setTimeout(r, 10 * Math.pow(2, attempts)));
    attempts++;
    if (attempts > 5) {
      console.warn('[Seed State] Lock timeout, proceeding anyway');
      break;
    }
  }

  seedLock = true;
  try {
    const currentSeed = readSeedState();
    saveSeedState(currentSeed + 1);
    return currentSeed;
  } finally {
    seedLock = false;
  }
}

/**
 * Get current seed value without incrementing
 * @returns {number} Current seed value
 */
function getCurrentSeed() {
  return readSeedState();
}

// ============================================================================
// START POLLER ON SERVICE LOAD
// ============================================================================

// Start the Suno poller when the service is loaded
startSunoPoller();

export default {
  queueJob,
  cancelJobs,
  pauseQueue,
  resumeQueue,
  getQueueStatus,
  getJob,
  checkSunoStatus,
  VALID_AUDIO_TYPES,
  // Suno auto-polling
  registerSunoTask,
  getPendingSunoTasks,
  startSunoPoller,
  stopSunoPoller,
  // Waveform persistence
  persistWaveformData,
  // Seed state management
  readSeedState,
  saveSeedState,
  getNextSeed,
  getCurrentSeed
};

// Named export for registerSunoTask (frequently used)
export { registerSunoTask };
