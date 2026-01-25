/**
 * useAudioAssets Hook
 * React hook for fetching and managing audio assets (music or sfx) with filters
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../lib/api';

/**
 * Hook to fetch audio assets for a specific type (music or sfx)
 * @param {string} audioType - 'music' or 'sfx'
 * @param {object} filters - Filter parameters
 * @param {string} [filters.category] - Category filter (for sfx: 'combat', 'ui', etc.)
 * @param {string} [filters.region] - Region filter (for music: 'heartlands', 'mistwood', etc.)
 * @param {string} [filters.subcategory] - Subcategory filter
 * @param {string} [filters.status] - Status filter ('exists', 'missing', 'error')
 * @returns {object} Hook state and methods
 */
export function useAudioAssets(audioType, filters = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Serialize filters for dependency tracking
  const filtersKey = JSON.stringify(filters);

  const refetch = useCallback(async () => {
    if (!audioType || !['music', 'sfx'].includes(audioType)) {
      setError('Invalid audio type. Must be "music" or "sfx".');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const parsedFilters = JSON.parse(filtersKey);
      const result = await api.getAudioAssets(audioType, parsedFilters);
      setData(result);
    } catch (err) {
      setError(err.message);
      console.error(`Failed to fetch ${audioType} assets:`, err);
    } finally {
      setLoading(false);
    }
  }, [audioType, filtersKey]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Compute summary statistics from the data
  const stats = useMemo(() => {
    if (!data?.assets) {
      return { total: 0, exists: 0, missing: 0, error: 0 };
    }

    const assets = data.assets;
    return {
      total: assets.length,
      exists: assets.filter((a) => a.status === 'exists').length,
      missing: assets.filter((a) => a.status === 'missing').length,
      error: assets.filter((a) => a.status === 'error').length,
    };
  }, [data]);

  return { data, loading, error, refetch, stats };
}

/**
 * Hook to fetch a single audio asset by ID
 * @param {string} audioType - 'music' or 'sfx'
 * @param {string} id - Asset ID
 * @param {boolean} enabled - Whether to fetch (default true)
 * @returns {object} Hook state
 */
export function useAudioAsset(audioType, id, enabled = true) {
  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    if (!enabled || !audioType || !id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await api.getAudioAsset(audioType, id);
      setAsset(result);
    } catch (err) {
      setError(err.message);
      console.error(`Failed to fetch ${audioType} asset ${id}:`, err);
    } finally {
      setLoading(false);
    }
  }, [audioType, id, enabled]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  /**
   * Update the asset
   * @param {object} updates - Fields to update
   */
  const updateAsset = useCallback(async (updates) => {
    if (!audioType || !id) return;

    try {
      const result = await api.updateAudioAsset(audioType, id, updates);
      setAsset(result);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, [audioType, id]);

  return { asset, loading, error, refetch, updateAsset };
}

/**
 * Hook to fetch overall audio stats
 * @returns {object} Stats state
 */
export function useAudioStats() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await api.getAudioStats();
      setStats(data);
    } catch (err) {
      setError(err.message);
      console.error('Failed to fetch audio stats:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { stats, loading, error, refetch };
}

export default useAudioAssets;
