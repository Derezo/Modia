/**
 * useActivityLog Hook
 * Fetches real job history from the generation queue API
 * and transforms it into activity log format for the Dashboard.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../lib/api';
import { formatRelativeTime, formatDurationHuman } from '../utils/timeFormat';

/**
 * Calculate and format job duration between two timestamps
 */
function formatJobDuration(startedAt, completedAt) {
  if (!startedAt || !completedAt) return null;

  const start = new Date(startedAt);
  const end = new Date(completedAt);
  const diffMs = end - start;

  return formatDurationHuman(diffMs);
}

/**
 * Transform job to activity format
 */
function jobToActivity(job) {
  const imageCount = job.generatedImages?.length || job.progress?.current || 0;
  const category = job.category || 'unknown';

  let message = '';
  let type = 'generate';
  let status = 'info';

  switch (job.status) {
    case 'completed':
      message = `Generated ${imageCount} ${category}${imageCount !== 1 ? '' : ''} asset${imageCount !== 1 ? 's' : ''}`;
      status = 'success';
      break;
    case 'failed':
      message = `Failed to generate ${category}: ${job.error || 'Unknown error'}`;
      status = 'error';
      type = 'error';
      break;
    case 'cancelled':
      message = `Cancelled ${category} generation`;
      status = 'warning';
      type = 'cancel';
      break;
    default:
      message = `${category} generation`;
      status = 'info';
  }

  return {
    id: job.id,
    type,
    message,
    time: formatRelativeTime(job.completedAt || job.startedAt),
    status,
    details: {
      category,
      imageCount,
      duration: formatJobDuration(job.startedAt, job.completedAt),
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    },
  };
}

/**
 * Hook to fetch and manage activity log
 * @param {Object} options - Hook options
 * @param {number} options.limit - Maximum activities to show (default 20)
 * @param {number} options.refreshInterval - Refresh interval in ms (default 30000, 0 to disable)
 */
export function useActivityLog({ limit = 20, refreshInterval = 30000 } = {}) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    try {
      const data = await api.getQueue();

      // Transform job history to activities
      const history = data.history || [];
      const transformed = history.slice(0, limit).map(jobToActivity);

      setActivities(transformed);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch activity log:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  // Initial fetch
  useEffect(() => {
    refetch();
  }, [refetch]);

  // Optional auto-refresh
  useEffect(() => {
    if (refreshInterval <= 0) return;

    const interval = setInterval(refetch, refreshInterval);
    return () => clearInterval(interval);
  }, [refetch, refreshInterval]);

  // Compute summary stats
  const stats = useMemo(() => {
    const completed = activities.filter((a) => a.status === 'success').length;
    const failed = activities.filter((a) => a.status === 'error').length;
    const cancelled = activities.filter((a) => a.status === 'warning').length;

    return { completed, failed, cancelled, total: activities.length };
  }, [activities]);

  return {
    activities,
    loading,
    error,
    stats,
    refetch,
  };
}

export default useActivityLog;
