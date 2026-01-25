/**
 * useWaveform Hook
 * React hook for fetching and caching waveform visualization data
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';

// In-memory cache for waveform data to avoid re-fetching
const waveformCache = new Map();

// Maximum cache size to prevent memory bloat
const MAX_CACHE_SIZE = 50;

/**
 * Evict oldest entries if cache is too large
 */
function pruneCache() {
  if (waveformCache.size > MAX_CACHE_SIZE) {
    const keysToDelete = Array.from(waveformCache.keys())
      .slice(0, waveformCache.size - MAX_CACHE_SIZE);
    keysToDelete.forEach((key) => waveformCache.delete(key));
  }
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

    // Check cache first (unless forcing refresh)
    if (!force && waveformCache.has(cacheKey)) {
      setWaveform(waveformCache.get(cacheKey));
      setLoading(false);
      setError(null);
      return;
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
        // Cache the result
        waveformCache.set(cacheKey, result);
        pruneCache();

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
    // Check cache immediately
    if (waveformCache.has(cacheKey)) {
      setWaveform(waveformCache.get(cacheKey));
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

          // Check cache first
          if (waveformCache.has(cacheKey)) {
            results[id] = waveformCache.get(cacheKey);
            return;
          }

          try {
            const result = await api.getAudioWaveform(audioType, id);
            waveformCache.set(cacheKey, result);
            pruneCache();
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
 * Clear all cached waveforms
 */
export function clearWaveformCache() {
  waveformCache.clear();
}

export default useWaveform;
