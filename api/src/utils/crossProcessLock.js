/**
 * Cross-Process File Locking
 * Provides file-based locking that works across both the API server (async)
 * and CLI scripts (sync) to prevent race conditions when updating metadata files.
 *
 * @module crossProcessLock
 * @description Uses lockfile-based approach with exponential backoff for acquiring locks.
 *
 * Security features:
 * - Symlink validation to prevent path traversal attacks
 * - PID validation for stale lock cleanup (prevents TOCTOU race)
 * - Secure file permissions (0o700 for dirs, 0o600 for files)
 * - Process exit handlers to clean up orphaned locks
 */

import { promises as fs } from 'fs';
import {
  existsSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  readFileSync,
  lstatSync,
  chmodSync
} from 'fs';
import path from 'path';

/**
 * Default lock configuration
 */
const DEFAULT_CONFIG = {
  lockDir: path.resolve(process.cwd(), '.locks'),
  maxRetries: 50,
  retryDelayMs: 100,
  maxRetryDelayMs: 2000,
  staleThresholdMs: 60000 // Lock files older than 60s are considered stale
};

// Module-level state for cleanup
const activeLocks = new Set();
let exitHandlersRegistered = false;

/**
 * Check if a process with the given PID is still running
 * @param {number} pid - Process ID to check
 * @returns {boolean} True if process is running
 */
function isProcessRunning(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0); // Signal 0 just checks if process exists
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that the given path is not a symlink
 * @param {string} lockPath - Path to validate
 * @throws {Error} If path is a symlink
 */
function validateNotSymlink(lockPath) {
  try {
    const stat = lstatSync(lockPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Security violation: Lock path is a symlink: ${lockPath}`);
    }
  } catch (err) {
    // ENOENT is fine - file doesn't exist yet
    if (err.code !== 'ENOENT') throw err;
  }
}

/**
 * Read lock file contents safely
 * @param {string} lockPath - Path to lock file
 * @returns {{pid: number, timestamp: number, file: string}|null}
 */
function readLockContents(lockPath) {
  try {
    const contents = readFileSync(lockPath, 'utf8');
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

/**
 * Clean up all active locks held by this process
 */
function cleanupActiveLocks() {
  for (const lockPath of activeLocks) {
    try {
      unlinkSync(lockPath);
    } catch {
      // Ignore errors during cleanup
    }
  }
  activeLocks.clear();
}

/**
 * Register process exit handlers to clean up locks
 */
function registerExitHandlers() {
  if (exitHandlersRegistered) return;
  exitHandlersRegistered = true;

  process.on('exit', cleanupActiveLocks);

  process.on('SIGTERM', () => {
    cleanupActiveLocks();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    cleanupActiveLocks();
    process.exit(0);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception, cleaning up locks:', err);
    cleanupActiveLocks();
    process.exit(1);
  });
}

// Ensure lock directory exists with secure permissions
function ensureLockDir(lockDir = DEFAULT_CONFIG.lockDir) {
  if (!existsSync(lockDir)) {
    mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  } else {
    // Ensure existing directory has correct permissions
    try {
      chmodSync(lockDir, 0o700);
    } catch {
      // May fail if not owner, ignore
    }
  }
}

/**
 * Get the lock file path for a given file
 * @param {string} filePath - Path to the file being locked
 * @param {string} [lockDir] - Directory to store lock files
 * @returns {string} Path to the lock file
 */
function getLockPath(filePath, lockDir = DEFAULT_CONFIG.lockDir) {
  // Create a safe filename from the path
  const safeName = filePath
    .replace(/[^a-zA-Z0-9]/g, '_')
    .substring(0, 200); // Limit length
  return path.join(lockDir, `${safeName}.lock`);
}

/**
 * Check if a lock file is stale (left over from a crashed process)
 * Also validates that the owning process is no longer running.
 * @param {string} lockPath - Path to the lock file
 * @param {number} [staleThresholdMs] - Threshold in ms
 * @returns {boolean}
 */
function isLockStale(lockPath, staleThresholdMs = DEFAULT_CONFIG.staleThresholdMs) {
  try {
    if (!existsSync(lockPath)) return false;

    // Validate not a symlink before reading
    validateNotSymlink(lockPath);

    const stat = lstatSync(lockPath);
    const isOld = Date.now() - stat.mtimeMs > staleThresholdMs;

    if (isOld) {
      // Also check if the owning process is still running
      const contents = readLockContents(lockPath);
      if (contents && contents.pid) {
        // If process is still running, lock is not stale regardless of age
        if (isProcessRunning(contents.pid)) {
          return false;
        }
      }
      return true;
    }

    // Not old enough to be considered stale by time alone
    // But check if owning process is dead
    const contents = readLockContents(lockPath);
    if (contents && contents.pid) {
      // If process is not running, lock is stale
      return !isProcessRunning(contents.pid);
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Safely remove a stale lock file with PID validation
 * @param {string} lockPath - Path to lock file
 * @returns {boolean} True if lock was removed
 */
function removeStaleLock(lockPath) {
  try {
    // Re-validate before deletion to prevent TOCTOU
    validateNotSymlink(lockPath);

    const contents = readLockContents(lockPath);
    if (contents && contents.pid && isProcessRunning(contents.pid)) {
      // Process is still running, don't delete
      return false;
    }

    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely remove a stale lock file with PID validation (async version)
 * @param {string} lockPath - Path to lock file
 * @returns {Promise<boolean>} True if lock was removed
 */
async function removeStaleLockAsync(lockPath) {
  try {
    // Re-validate before deletion to prevent TOCTOU
    validateNotSymlink(lockPath);

    const contents = readLockContents(lockPath);
    if (contents && contents.pid && isProcessRunning(contents.pid)) {
      // Process is still running, don't delete
      return false;
    }

    await fs.unlink(lockPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to acquire a lock (async version for API)
 * @param {string} filePath - Path to the file being locked
 * @param {object} [options] - Options
 * @param {number} [options.maxRetries] - Maximum retries
 * @param {number} [options.retryDelayMs] - Initial retry delay
 * @param {string} [options.lockDir] - Lock directory
 * @returns {Promise<{acquired: boolean, lockPath: string}>}
 */
export async function acquireLockAsync(filePath, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  ensureLockDir(config.lockDir);
  registerExitHandlers();

  const lockPath = getLockPath(filePath, config.lockDir);

  let retries = 0;
  let delay = config.retryDelayMs;

  while (retries < config.maxRetries) {
    try {
      // Validate not a symlink before any operation
      validateNotSymlink(lockPath);

      // Remove stale lock if present (with PID validation)
      if (isLockStale(lockPath, config.staleThresholdMs)) {
        await removeStaleLockAsync(lockPath);
      }

      // Try to create lock file exclusively with secure permissions
      const lockContent = JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        file: filePath
      });

      await fs.writeFile(lockPath, lockContent, { flag: 'wx', mode: 0o600 });

      // Track this lock for cleanup on exit
      activeLocks.add(lockPath);

      return { acquired: true, lockPath };
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Lock exists, wait and retry
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, config.maxRetryDelayMs);
        retries++;
      } else {
        throw err;
      }
    }
  }

  return { acquired: false, lockPath };
}

/**
 * Release a lock (async version for API)
 * @param {string} lockPath - Path to the lock file
 */
export async function releaseLockAsync(lockPath) {
  try {
    // Validate not a symlink
    validateNotSymlink(lockPath);

    // Only delete if we own this lock
    const contents = readLockContents(lockPath);
    if (contents && contents.pid !== process.pid) {
      console.error(`[Lock] Attempted to release lock owned by another process: ${lockPath}`);
      return;
    }

    await fs.unlink(lockPath);
    activeLocks.delete(lockPath);
  } catch (err) {
    // Ignore if already deleted
    if (err.code !== 'ENOENT') {
      console.error(`[Lock] Failed to release lock ${lockPath}:`, err.message);
    }
    activeLocks.delete(lockPath);
  }
}

/**
 * Execute an async function with a file lock
 * @template T
 * @param {string} filePath - Path to the file being locked
 * @param {() => Promise<T>} fn - Async function to execute
 * @param {object} [options] - Lock options
 * @returns {Promise<T>}
 */
export async function withFileLockAsync(filePath, fn, options = {}) {
  const result = await acquireLockAsync(filePath, options);

  if (!result.acquired) {
    throw new Error(`Failed to acquire lock for ${filePath} after max retries`);
  }

  try {
    return await fn();
  } finally {
    await releaseLockAsync(result.lockPath);
  }
}

/**
 * Try to acquire a lock (sync version for CLI scripts)
 * @param {string} filePath - Path to the file being locked
 * @param {object} [options] - Options
 * @returns {{acquired: boolean, lockPath: string}}
 */
export function acquireLockSync(filePath, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  ensureLockDir(config.lockDir);
  registerExitHandlers();

  const lockPath = getLockPath(filePath, config.lockDir);

  let retries = 0;
  let delay = config.retryDelayMs;

  while (retries < config.maxRetries) {
    try {
      // Validate not a symlink before any operation
      validateNotSymlink(lockPath);

      // Remove stale lock if present (with PID validation)
      if (isLockStale(lockPath, config.staleThresholdMs)) {
        removeStaleLock(lockPath);
      }

      // Try to create lock file exclusively with secure permissions
      writeFileSync(lockPath, JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        file: filePath
      }), { flag: 'wx', mode: 0o600 });

      // Track this lock for cleanup on exit
      activeLocks.add(lockPath);

      return { acquired: true, lockPath };
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Lock exists, busy-wait
        const start = Date.now();
        while (Date.now() - start < delay) {
          // Busy wait (not ideal but necessary for sync)
        }
        delay = Math.min(delay * 1.5, config.maxRetryDelayMs);
        retries++;
      } else {
        throw err;
      }
    }
  }

  return { acquired: false, lockPath };
}

/**
 * Release a lock (sync version for CLI scripts)
 * @param {string} lockPath - Path to the lock file
 */
export function releaseLockSync(lockPath) {
  try {
    // Validate not a symlink
    validateNotSymlink(lockPath);

    // Only delete if we own this lock
    const contents = readLockContents(lockPath);
    if (contents && contents.pid !== process.pid) {
      console.error(`[Lock] Attempted to release lock owned by another process: ${lockPath}`);
      return;
    }

    unlinkSync(lockPath);
    activeLocks.delete(lockPath);
  } catch (err) {
    // Ignore if already deleted
    if (err.code !== 'ENOENT') {
      console.error(`[Lock] Failed to release lock ${lockPath}:`, err.message);
    }
    activeLocks.delete(lockPath);
  }
}

/**
 * Execute a sync function with a file lock
 * @template T
 * @param {string} filePath - Path to the file being locked
 * @param {() => T} fn - Sync function to execute
 * @param {object} [options] - Lock options
 * @returns {T}
 */
export function withFileLockSync(filePath, fn, options = {}) {
  const result = acquireLockSync(filePath, options);

  if (!result.acquired) {
    throw new Error(`Failed to acquire lock for ${filePath} after max retries`);
  }

  try {
    return fn();
  } finally {
    releaseLockSync(result.lockPath);
  }
}

export default {
  acquireLockAsync,
  releaseLockAsync,
  withFileLockAsync,
  acquireLockSync,
  releaseLockSync,
  withFileLockSync,
  getLockPath
};
