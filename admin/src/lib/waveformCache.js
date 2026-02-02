/**
 * IndexedDB Persistent Cache for Waveforms
 *
 * Caches waveform SVG data to avoid refetching on page loads.
 * Uses IndexedDB for persistence with automatic TTL expiration.
 *
 * Database: modia-admin-cache (version 1)
 * Object Store: waveforms (keyPath: cacheKey)
 * Schema: { cacheKey: string, data: any, timestamp: number }
 * TTL: 7 days
 */

const DB_NAME = 'modia-admin-cache';
const DB_VERSION = 1;
const STORE_NAME = 'waveforms';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

// Cached database connection
let dbInstance = null;

/**
 * Initialize and open the IndexedDB database
 * Creates the object store if it doesn't exist
 * @returns {Promise<IDBDatabase|null>} Database instance or null on error
 */
export async function initWaveformCache() {
  // Return cached instance if available
  if (dbInstance) {
    return dbInstance;
  }

  // Check for IndexedDB support
  if (!window.indexedDB) {
    console.warn('[WaveformCache] IndexedDB not supported');
    return null;
  }

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        console.error('[WaveformCache] Failed to open database:', event.target.error);
        resolve(null);
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;

        // Handle connection close
        dbInstance.onclose = () => {
          dbInstance = null;
        };

        // Handle version change (database deleted or upgraded elsewhere)
        dbInstance.onversionchange = () => {
          dbInstance.close();
          dbInstance = null;
          console.log('[WaveformCache] Database version changed, connection closed');
        };

        // Run background cleanup of expired entries
        clearExpiredEntries();

        resolve(dbInstance);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create waveforms object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
          // Create index on timestamp for efficient cleanup queries
          store.createIndex('timestamp', 'timestamp', { unique: false });
          console.log('[WaveformCache] Created waveforms object store');
        }
      };
    } catch (error) {
      console.error('[WaveformCache] Error initializing database:', error);
      resolve(null);
    }
  });
}

/**
 * Retrieve an entry from the cache
 * Returns null if entry is missing, expired, or on error
 * @param {string} cacheKey - The cache key to retrieve
 * @returns {Promise<any|null>} The cached data or null
 */
export async function getFromIndexedDB(cacheKey) {
  const db = await initWaveformCache();
  if (!db) {
    return null;
  }

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(cacheKey);

      request.onerror = (event) => {
        console.error('[WaveformCache] Failed to get entry:', event.target.error);
        resolve(null);
      };

      request.onsuccess = (event) => {
        const entry = event.target.result;

        // Entry not found
        if (!entry) {
          resolve(null);
          return;
        }

        // Check TTL
        const now = Date.now();
        const age = now - entry.timestamp;

        if (age > TTL_MS) {
          // Entry expired, delete it asynchronously and return null
          deleteEntry(cacheKey);
          resolve(null);
          return;
        }

        resolve(entry.data);
      };
    } catch (error) {
      console.error('[WaveformCache] Error retrieving entry:', error);
      resolve(null);
    }
  });
}

/**
 * Store an entry in the cache with current timestamp
 * @param {string} cacheKey - The cache key to store
 * @param {any} data - The data to cache
 * @returns {Promise<boolean>} True on success, false on error
 */
export async function setInIndexedDB(cacheKey, data) {
  const db = await initWaveformCache();
  if (!db) {
    return false;
  }

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const entry = {
        cacheKey,
        data,
        timestamp: Date.now(),
      };

      const request = store.put(entry);

      request.onerror = (event) => {
        console.error('[WaveformCache] Failed to store entry:', event.target.error);
        resolve(false);
      };

      request.onsuccess = () => {
        resolve(true);
      };
    } catch (error) {
      console.error('[WaveformCache] Error storing entry:', error);
      resolve(false);
    }
  });
}

/**
 * Delete a single entry from the cache (internal helper)
 * @param {string} cacheKey - The cache key to delete
 * @returns {Promise<boolean>} True on success, false on error
 */
async function deleteEntry(cacheKey) {
  const db = await initWaveformCache();
  if (!db) {
    return false;
  }

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(cacheKey);

      request.onerror = () => {
        resolve(false);
      };

      request.onsuccess = () => {
        resolve(true);
      };
    } catch (error) {
      resolve(false);
    }
  });
}

/**
 * Clear all expired entries from the cache
 * Runs in background without blocking
 * @returns {Promise<number>} Number of entries cleared, or -1 on error
 */
export async function clearExpiredEntries() {
  const db = await initWaveformCache();
  if (!db) {
    return -1;
  }

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('timestamp');

      const cutoff = Date.now() - TTL_MS;
      const range = IDBKeyRange.upperBound(cutoff);
      const request = index.openCursor(range);

      let deletedCount = 0;

      request.onerror = (event) => {
        console.error('[WaveformCache] Failed to clear expired entries:', event.target.error);
        resolve(-1);
      };

      request.onsuccess = (event) => {
        const cursor = event.target.result;

        if (cursor) {
          // Delete expired entry
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          // Done iterating
          if (deletedCount > 0) {
            console.log(`[WaveformCache] Cleared ${deletedCount} expired entries`);
          }
          resolve(deletedCount);
        }
      };
    } catch (error) {
      console.error('[WaveformCache] Error clearing expired entries:', error);
      resolve(-1);
    }
  });
}

/**
 * Clear all entries from the waveform cache
 * Useful for manual cache reset
 * @returns {Promise<boolean>} True on success, false on error
 */
export async function clearAllWaveformCache() {
  const db = await initWaveformCache();
  if (!db) {
    return false;
  }

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = (event) => {
        console.error('[WaveformCache] Failed to clear cache:', event.target.error);
        resolve(false);
      };

      request.onsuccess = () => {
        console.log('[WaveformCache] Cache cleared');
        resolve(true);
      };
    } catch (error) {
      console.error('[WaveformCache] Error clearing cache:', error);
      resolve(false);
    }
  });
}

/**
 * Get statistics about the waveform cache
 * @returns {Promise<object>} Cache statistics { count, oldestTimestamp, newestTimestamp }
 */
export async function getCacheStats() {
  const db = await initWaveformCache();
  if (!db) {
    return { count: 0, oldestTimestamp: null, newestTimestamp: null };
  }

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const countRequest = store.count();
      const index = store.index('timestamp');

      let count = 0;
      let oldestTimestamp = null;
      let newestTimestamp = null;

      countRequest.onsuccess = () => {
        count = countRequest.result;
      };

      // Get oldest entry
      const oldestRequest = index.openCursor();
      oldestRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          oldestTimestamp = cursor.value.timestamp;
        }
      };

      // Get newest entry (reverse direction)
      const newestRequest = index.openCursor(null, 'prev');
      newestRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          newestTimestamp = cursor.value.timestamp;
        }
      };

      transaction.oncomplete = () => {
        resolve({ count, oldestTimestamp, newestTimestamp });
      };

      transaction.onerror = () => {
        resolve({ count: 0, oldestTimestamp: null, newestTimestamp: null });
      };
    } catch (error) {
      console.error('[WaveformCache] Error getting cache stats:', error);
      resolve({ count: 0, oldestTimestamp: null, newestTimestamp: null });
    }
  });
}
