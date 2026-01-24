/**
 * React hooks for asset management
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';

/**
 * Hook to fetch overall stats
 */
export function useStats() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await api.getStats();
      setStats(data);
    } catch (err) {
      setError(err.message);
      console.error('Failed to fetch stats:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { stats, loading, error, refetch };
}

/**
 * Hook to fetch assets for a category
 */
export function useAssets(category, params = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Serialize params for dependency tracking
  const paramsKey = JSON.stringify(params);

  const refetch = useCallback(async () => {
    if (!category) return;

    setLoading(true);
    setError(null);

    try {
      const parsedParams = JSON.parse(paramsKey);
      const result = await api.getAssets(category, parsedParams);
      setData(result);
    } catch (err) {
      setError(err.message);
      console.error(`Failed to fetch ${category} assets:`, err);
    } finally {
      setLoading(false);
    }
  }, [category, paramsKey]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}

/**
 * Hook to fetch generation queue status
 */
export function useQueue() {
  const [queue, setQueue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await api.getQueue();
      setQueue(data);
    } catch (err) {
      setError(err.message);
      console.error('Failed to fetch queue:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Use ref to track processing state to avoid stale closure in interval
  const isProcessingRef = useRef(false);
  useEffect(() => {
    isProcessingRef.current = queue?.stats?.isProcessing ?? false;
  }, [queue?.stats?.isProcessing]);

  useEffect(() => {
    refetch();

    // Poll every 5 seconds when processing
    const interval = setInterval(() => {
      if (isProcessingRef.current) {
        refetch();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [refetch]);

  return { queue, loading, error, refetch };
}

/**
 * Hook for backup management
 */
export function useBackups() {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [operating, setOperating] = useState(false);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await api.getBackups();
      setBackups(data.backups || []);
    } catch (err) {
      setError(err.message);
      console.error('Failed to fetch backups:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  /**
   * Create a new backup
   * @param {string} reason - Reason for backup (e.g., 'manual', 'pre-generation')
   */
  const createBackup = useCallback(async (reason = 'manual') => {
    setOperating(true);
    setError(null);

    try {
      const result = await api.createBackup(reason);
      await refetch();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setOperating(false);
    }
  }, [refetch]);

  /**
   * Restore from a backup
   * @param {string} timestamp - Backup timestamp identifier
   */
  const restoreBackup = useCallback(async (timestamp) => {
    setOperating(true);
    setError(null);

    try {
      const result = await api.restoreBackup(timestamp);
      await refetch();
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setOperating(false);
    }
  }, [refetch]);

  /**
   * Delete a backup
   * @param {string} timestamp - Backup timestamp identifier
   */
  const deleteBackup = useCallback(async (timestamp) => {
    setOperating(true);
    setError(null);

    try {
      await api.deleteBackup(timestamp);
      await refetch();
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setOperating(false);
    }
  }, [refetch]);

  /**
   * Get backup details
   * @param {string} timestamp - Backup timestamp identifier
   */
  const getBackupDetails = useCallback(async (timestamp) => {
    try {
      return await api.getBackup(timestamp);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  return {
    backups,
    loading,
    error,
    operating,
    refetch,
    createBackup,
    restoreBackup,
    deleteBackup,
    getBackupDetails,
  };
}

/**
 * Hook for API status check
 */
export function useApiStatus() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function checkStatus() {
      try {
        const data = await api.getStatus();
        setStatus(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    checkStatus();
  }, []);

  return { status, loading, error };
}
