/**
 * Asset Locking Utilities
 * Provides mutex-based locking and ID validation for admin asset operations.
 *
 * @module assetLocking
 * @description Prevents race conditions during concurrent asset updates
 * and validates asset IDs to prevent path traversal attacks.
 */

/**
 * AsyncMutex - Simple async mutex for preventing race conditions
 * Uses a queue-based approach to ensure fair ordering of lock requests.
 */
export class AsyncMutex {
  constructor() {
    this._locked = false;
    this._queue = [];
  }

  /**
   * Check if mutex is currently locked
   * @returns {boolean}
   */
  get locked() {
    return this._locked;
  }

  /**
   * Acquire the lock
   * @param {number} [timeout=30000] - Maximum time to wait for lock in ms
   * @returns {Promise<void>}
   * @throws {Error} If timeout exceeded
   */
  async acquire(timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // Remove from queue on timeout
        const idx = this._queue.indexOf(tryAcquire);
        if (idx >= 0) this._queue.splice(idx, 1);
        reject(new Error(`Mutex acquisition timeout after ${timeout}ms`));
      }, timeout);

      const tryAcquire = () => {
        if (!this._locked) {
          this._locked = true;
          clearTimeout(timeoutId);
          resolve();
          return true;
        }
        return false;
      };

      if (!tryAcquire()) {
        this._queue.push(tryAcquire);
      }
    });
  }

  /**
   * Release the lock
   */
  release() {
    this._locked = false;
    // Try to give lock to next waiter
    while (this._queue.length > 0) {
      const next = this._queue.shift();
      if (next()) break;
    }
  }

  /**
   * Execute a function with the lock held
   * @template T
   * @param {() => Promise<T>} fn - Async function to execute
   * @param {number} [timeout=30000] - Lock acquisition timeout
   * @returns {Promise<T>}
   */
  async withLock(fn, timeout = 30000) {
    await this.acquire(timeout);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * File-based mutex manager
 * Maintains separate locks per file path to allow concurrent writes to different files.
 */
class FileLockManager {
  constructor() {
    this._locks = new Map();
    this._lastUsed = new Map();
    this._cleanupInterval = null;
    this._maxAge = 5 * 60 * 1000; // Clean up locks unused for 5 minutes
  }

  /**
   * Get or create a mutex for a file path
   * @param {string} filePath
   * @returns {AsyncMutex}
   */
  getLock(filePath) {
    if (!this._locks.has(filePath)) {
      this._locks.set(filePath, new AsyncMutex());
      this._startCleanupIfNeeded();
    }
    this._lastUsed.set(filePath, Date.now());
    return this._locks.get(filePath);
  }

  /**
   * Execute a function with the file lock held
   * @template T
   * @param {string} filePath
   * @param {() => Promise<T>} fn
   * @param {number} [timeout]
   * @returns {Promise<T>}
   */
  async withFileLock(filePath, fn, timeout) {
    const mutex = this.getLock(filePath);
    return mutex.withLock(fn, timeout);
  }

  _startCleanupIfNeeded() {
    if (this._cleanupInterval) return;
    this._cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [path, lastUsed] of this._lastUsed.entries()) {
        if (now - lastUsed > this._maxAge) {
          const mutex = this._locks.get(path);
          // Only clean up if not currently locked
          if (mutex && !mutex.locked) {
            this._locks.delete(path);
            this._lastUsed.delete(path);
          }
        }
      }
      // Stop cleanup if no locks remain
      if (this._locks.size === 0) {
        clearInterval(this._cleanupInterval);
        this._cleanupInterval = null;
      }
    }, 60000); // Clean up every minute
  }

  /**
   * Get current stats
   * @returns {{ activeLocks: number, totalPaths: number }}
   */
  getStats() {
    let activeLocks = 0;
    for (const mutex of this._locks.values()) {
      if (mutex.locked) activeLocks++;
    }
    return {
      activeLocks,
      totalPaths: this._locks.size
    };
  }
}

// Singleton file lock manager instance
export const fileLocks = new FileLockManager();

// ============================================================================
// ASSET ID VALIDATION
// ============================================================================

/**
 * Pattern for valid asset IDs
 * Allows alphanumeric characters, underscores, and hyphens.
 * Prevents path traversal by disallowing dots, slashes, and other special characters.
 */
export const ASSET_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Maximum length for asset IDs
 */
export const MAX_ASSET_ID_LENGTH = 128;

/**
 * Validate an asset ID
 * @param {string} id - Asset ID to validate
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateAssetId(id) {
  if (typeof id !== 'string') {
    return { valid: false, error: 'Asset ID must be a string' };
  }

  if (id.length === 0) {
    return { valid: false, error: 'Asset ID cannot be empty' };
  }

  if (id.length > MAX_ASSET_ID_LENGTH) {
    return { valid: false, error: `Asset ID exceeds maximum length of ${MAX_ASSET_ID_LENGTH}` };
  }

  // Check for path traversal attempts
  if (id.includes('..') || id.includes('/') || id.includes('\\')) {
    return { valid: false, error: 'Asset ID contains invalid path characters' };
  }

  if (!ASSET_ID_PATTERN.test(id)) {
    return { valid: false, error: 'Asset ID contains invalid characters. Only alphanumeric, underscore, and hyphen allowed.' };
  }

  return { valid: true };
}

/**
 * Validate an asset ID and throw if invalid
 * @param {string} id - Asset ID to validate
 * @param {string} [context='Asset'] - Context for error message
 * @throws {Error} If ID is invalid
 */
export function assertValidAssetId(id, context = 'Asset') {
  const result = validateAssetId(id);
  if (!result.valid) {
    const error = new Error(`${context} ID validation failed: ${result.error}`);
    error.statusCode = 400;
    throw error;
  }
}

/**
 * Validate multiple asset IDs
 * @param {string[]} ids - Array of asset IDs
 * @returns {{ valid: boolean, invalidIds: string[], errors: string[] }}
 */
export function validateAssetIds(ids) {
  if (!Array.isArray(ids)) {
    return { valid: false, invalidIds: [], errors: ['IDs must be an array'] };
  }

  const invalidIds = [];
  const errors = [];

  for (const id of ids) {
    const result = validateAssetId(id);
    if (!result.valid) {
      invalidIds.push(id);
      errors.push(`${id}: ${result.error}`);
    }
  }

  return {
    valid: invalidIds.length === 0,
    invalidIds,
    errors
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  AsyncMutex,
  fileLocks,
  ASSET_ID_PATTERN,
  MAX_ASSET_ID_LENGTH,
  validateAssetId,
  assertValidAssetId,
  validateAssetIds
};
