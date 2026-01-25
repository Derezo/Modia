/**
 * useRegenerationQueue Hook
 * React hook for managing the regeneration queue state
 *
 * The regeneration queue allows users to mark assets for batch regeneration
 * rather than immediately executing generation commands. This provides:
 * - Visual queue management before execution
 * - Ability to add/remove items before starting
 * - Batch execution with --queue mode
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

/**
 * Hook for managing regeneration queue state
 * @returns {object} Queue state and actions
 */
export function useRegenerationQueue() {
  // Queue state: { totalCount: number, queue: { [category]: Asset[] } }
  const [queue, setQueue] = useState({ totalCount: 0, queue: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Fetch the current regeneration queue from the API
   */
  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getRegenerationQueue();
      setQueue(data);
    } catch (err) {
      console.error('[useRegenerationQueue] Failed to fetch queue:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Mark or unmark a single item for regeneration
   * @param {string} category - Asset category
   * @param {string} id - Asset ID
   * @param {boolean} mark - True to mark, false to unmark
   */
  const markItem = useCallback(async (category, id, mark = true) => {
    try {
      // Determine if this is an audio category
      const isAudio = category === 'music' || category === 'sfx';

      if (isAudio) {
        await api.markAudioForRegeneration(category, id, mark);
      } else {
        await api.markForRegeneration(category, id, mark);
      }

      // Refresh the queue
      await fetchQueue();
    } catch (err) {
      console.error('[useRegenerationQueue] Failed to mark item:', err);
      setError(err.message);
    }
  }, [fetchQueue]);

  /**
   * Mark or unmark multiple items for regeneration
   * @param {string} category - Asset category
   * @param {string[]} ids - Array of asset IDs
   * @param {boolean} mark - True to mark, false to unmark
   */
  const markMultiple = useCallback(async (category, ids, mark = true) => {
    try {
      // Determine if this is an audio category
      const isAudio = category === 'music' || category === 'sfx';

      if (isAudio) {
        await api.markMultipleAudioForRegeneration(category, ids, mark);
      } else {
        await api.markMultipleForRegeneration(category, ids, mark);
      }

      // Refresh the queue
      await fetchQueue();
    } catch (err) {
      console.error('[useRegenerationQueue] Failed to mark multiple items:', err);
      setError(err.message);
    }
  }, [fetchQueue]);

  /**
   * Clear all items in a specific category from the queue
   * @param {string} category - Category to clear
   */
  const clearCategory = useCallback(async (category) => {
    const categoryQueue = queue.queue[category] || [];
    const ids = categoryQueue.map(item => item.id);

    if (ids.length === 0) return;

    try {
      const isAudio = category === 'music' || category === 'sfx';

      if (isAudio) {
        await api.markMultipleAudioForRegeneration(category, ids, false);
      } else {
        await api.markMultipleForRegeneration(category, ids, false);
      }

      await fetchQueue();
    } catch (err) {
      console.error('[useRegenerationQueue] Failed to clear category:', err);
      setError(err.message);
    }
  }, [queue, fetchQueue]);

  /**
   * Clear all items from the queue
   */
  const clearAll = useCallback(async () => {
    try {
      await api.clearRegenerationQueue();
      await fetchQueue();
    } catch (err) {
      console.error('[useRegenerationQueue] Failed to clear queue:', err);
      setError(err.message);
    }
  }, [fetchQueue]);

  /**
   * Start batch generation for queued items
   * @param {object} options - Generation options
   * @param {string} options.category - Optional category to process (all if omitted)
   */
  const startBatchGeneration = useCallback(async (options = {}) => {
    try {
      const { category } = options;
      const isAudioCategory = category === 'music' || category === 'sfx';

      if (isAudioCategory) {
        // Use audio-specific endpoint for music/sfx
        await api.processAudioRegenerationQueue({ type: category });
      } else if (!category) {
        // No category specified - process both image and audio queues
        // Check if we have any audio items in the queue
        const hasMusic = (queue.queue.music || []).length > 0;
        const hasSfx = (queue.queue.sfx || []).length > 0;

        // Process image queue (for image categories like tiles, portraits, etc.)
        await api.processRegenerationQueue(options);

        // Also process audio queue if there are audio items
        if (hasMusic || hasSfx) {
          await api.processAudioRegenerationQueue({});
        }
      } else {
        // Image category - use image endpoint
        await api.processRegenerationQueue(options);
      }
      // Don't refresh immediately - the queue will be cleared as items are processed
    } catch (err) {
      console.error('[useRegenerationQueue] Failed to start batch generation:', err);
      setError(err.message);
    }
  }, [queue.queue]);

  // Fetch queue on mount
  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  return {
    // Queue data
    queue: queue.queue,
    totalCount: queue.totalCount,
    loading,
    error,

    // Actions
    fetchQueue,
    markItem,
    markMultiple,
    clearCategory,
    clearAll,
    startBatchGeneration,

    // Helpers
    getCategoryCount: (category) => (queue.queue[category] || []).length,
    hasItems: queue.totalCount > 0,
  };
}

export default useRegenerationQueue;
