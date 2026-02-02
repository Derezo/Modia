/**
 * useWaveform Hook
 * React hook for fetching and caching waveform visualization data
 *
 * Caching strategy:
 * - L1: In-memory LRU cache (fast, limited to MAX_CACHE_SIZE entries)
 * - L2: IndexedDB persistent cache (slower, 7-day TTL)
 *
 * Lookup order: in-memory -> IndexedDB -> API fetch
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { initWaveformCache, getFromIndexedDB, setInIndexedDB, clearAllWaveformCache } from '../lib/waveformCache.js';

// In-memory LRU cache for waveform data
// Stores { data, lastAccess } for each entry
const waveformCache = new Map();

// Maximum cache size for in-memory cache
const MAX_CACHE_SIZE = 500;

// Flag to track IndexedDB initialization
let indexedDBInitialized = false;

/**
 * Initialize IndexedDB on first use
 */
async function ensureIndexedDBInitialized() {
  if (!indexedDBInitialized) {
    await initWaveformCache();
    indexedDBInitialized = true;
  }
}

/**
 * Get entry from in-memory cache, updating access time on hit
 * @param {string} cacheKey - Cache key to look up
 * @returns {any|null} Cached data or null if not found
 */
function getFromMemoryCache(cacheKey) {
  const entry = waveformCache.get(cacheKey);
  if (entry) {
    // Update access time for LRU tracking
    entry.lastAccess = Date.now();
    return entry.data;
  }
  return null;
}

/**
 * Store entry in in-memory cache with LRU eviction
 * @param {string} cacheKey - Cache key
 * @param {any} data - Data to cache
 */
function setInMemoryCache(cacheKey, data) {
  // If cache is at capacity, evict least recently used entries
  if (waveformCache.size >= MAX_CACHE_SIZE) {
    evictLRUEntries();
  }

  waveformCache.set(cacheKey, {
    data,
    lastAccess: Date.now(),
  });
}

/**
 * Evict least recently used entries when cache is full
 * Removes 10% of entries to avoid frequent evictions
 */
function evictLRUEntries() {
  const entriesToEvict = Math.max(1, Math.floor(MAX_CACHE_SIZE * 0.1));

  // Convert to array and sort by lastAccess (oldest first)
  const entries = Array.from(waveformCache.entries())
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

  // Delete the oldest entries
  for (let i = 0; i < entriesToEvict && i < entries.length; i++) {
    waveformCache.delete(entries[i][0]);
  }
}

/**
 * Promote an entry from IndexedDB to in-memory cache
 * @param {string} cacheKey - Cache key
 * @param {any} data - Data to promote
 */
function promoteToMemoryCache(cacheKey, data) {
  setInMemoryCache(cacheKey, data);
}

/**
 * Hook for fetching waveform data for an audio asset
 * @param {string} audioType - 'music' or 'sfx'
 * @param {string} id - Asset ID
 * @param {boolean} enabled - Whether to fetch (default true)
 * @returns {object} Waveform state
 */
export function useWaveform(audioType, id, enabled = true) {
  const [waveform, setWaveform] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Track the current request to handle race conditions
  const requestIdRef = useRef(0);

  const cacheKey = `${audioType}:${id}`;

  const refetch = useCallback(async (force = false) => {
    if (!enabled || !audioType || !id) {
      setLoading(false);
      return;
    }

    // Initialize IndexedDB on first use
    await ensureIndexedDBInitialized();

    // Check in-memory cache first (unless forcing refresh)
    if (!force) {
      const memoryData = getFromMemoryCache(cacheKey);
      if (memoryData) {
        setWaveform(memoryData);
        setLoading(false);
        setError(null);
        return;
      }

      // Check IndexedDB cache
      const indexedDBData = await getFromIndexedDB(cacheKey);
      if (indexedDBData) {
        // Promote to in-memory cache for faster subsequent access
        promoteToMemoryCache(cacheKey, indexedDBData);
        setWaveform(indexedDBData);
        setLoading(false);
        setError(null);
        return;
      }
    }

    setLoading(true);
    setError(null);

    // Increment request ID to track this specific request
    requestIdRef.current += 1;
    const currentRequestId = requestIdRef.current;

    try {
      const result = await api.getAudioWaveform(audioType, id);

      // Only update state if this is still the current request
      if (currentRequestId === requestIdRef.current) {
        // Store in both caches
        setInMemoryCache(cacheKey, result);
        setInIndexedDB(cacheKey, result); // Fire and forget, don't await

        setWaveform(result);
        setError(null);
      }
    } catch (err) {
      // Only update error if this is still the current request
      if (currentRequestId === requestIdRef.current) {
        setError(err.message);
        console.error(`Failed to fetch waveform for ${audioType}/${id}:`, err);
      }
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [audioType, id, enabled, cacheKey]);

  // Fetch on mount or when dependencies change
  useEffect(() => {
    // Check in-memory cache immediately (synchronous)
    const memoryData = getFromMemoryCache(cacheKey);
    if (memoryData) {
      setWaveform(memoryData);
      setLoading(false);
      setError(null);
      return;
    }

    if (enabled && audioType && id) {
      refetch();
    }
  }, [audioType, id, enabled, cacheKey, refetch]);

  /**
   * Clear the cached waveform for this asset
   */
  const clearCache = useCallback(() => {
    waveformCache.delete(cacheKey);
    setWaveform(null);
  }, [cacheKey]);

  return {
    waveform,
    loading,
    error,
    refetch: () => refetch(true), // Force refetch
    clearCache,
  };
}

/**
 * Hook for batch fetching multiple waveforms
 * Useful for list views where multiple waveforms need to be loaded
 * @param {Array} assets - Array of { audioType, id } objects
 * @param {boolean} enabled - Whether to fetch
 * @returns {object} Batch waveform state
 */
export function useWaveformBatch(assets = [], enabled = true) {
  const [waveforms, setWaveforms] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const requestIdRef = useRef(0);

  const refetch = useCallback(async () => {
    if (!enabled || assets.length === 0) {
      setLoading(false);
      return;
    }

    // Initialize IndexedDB on first use
    await ensureIndexedDBInitialized();

    setLoading(true);
    setError(null);

    requestIdRef.current += 1;
    const currentRequestId = requestIdRef.current;

    const results = {};
    const errors = [];

    // Fetch in batches of 5 to avoid overwhelming the server
    const batchSize = 5;
    for (let i = 0; i < assets.length; i += batchSize) {
      const batch = assets.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async ({ audioType, id }) => {
          const cacheKey = `${audioType}:${id}`;

          // Check in-memory cache first
          const memoryData = getFromMemoryCache(cacheKey);
          if (memoryData) {
            results[id] = memoryData;
            return;
          }

          // Check IndexedDB cache
          const indexedDBData = await getFromIndexedDB(cacheKey);
          if (indexedDBData) {
            promoteToMemoryCache(cacheKey, indexedDBData);
            results[id] = indexedDBData;
            return;
          }

          // Fetch from API
          try {
            const result = await api.getAudioWaveform(audioType, id);
            // Store in both caches
            setInMemoryCache(cacheKey, result);
            setInIndexedDB(cacheKey, result); // Fire and forget
            results[id] = result;
          } catch (err) {
            errors.push({ id, error: err.message });
          }
        })
      );
    }

    // Only update state if this is still the current request
    if (currentRequestId === requestIdRef.current) {
      setWaveforms(results);
      if (errors.length > 0) {
        setError(`Failed to load ${errors.length} waveform(s)`);
      }
      setLoading(false);
    }
  }, [assets, enabled]);

  // Track asset IDs as a string for dependency comparison
  const assetIds = assets.map((a) => a.id).join(',');

  useEffect(() => {
    if (enabled && assets.length > 0) {
      refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, assetIds]);

  return {
    waveforms,
    loading,
    error,
    refetch,
  };
}

/**
 * Normalize waveform data to a specific number of bars
 * @param {Array<number>} data - Raw waveform amplitude data
 * @param {number} barCount - Number of bars to normalize to
 * @returns {Array<number>} Normalized data with `barCount` values
 */
export function normalizeWaveform(data, barCount = 50) {
  if (!data || data.length === 0) {
    return new Array(barCount).fill(0);
  }

  if (data.length === barCount) {
    return data;
  }

  const normalized = [];
  const step = data.length / barCount;

  for (let i = 0; i < barCount; i++) {
    const start = Math.floor(i * step);
    const end = Math.floor((i + 1) * step);

    // Average the values in this range
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < data.length; j++) {
      sum += data[j];
      count++;
    }

    normalized.push(count > 0 ? sum / count : 0);
  }

  return normalized;
}

/**
 * Clear all cached waveforms (both in-memory and IndexedDB)
 * @returns {Promise<number>} Number of entries cleared from IndexedDB (-1 if failed)
 */
export async function clearWaveformCache() {
  waveformCache.clear();
  return await clearAllWaveformCache();
}

export default useWaveform;
