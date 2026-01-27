/**
 * GenerationContext - Global generation state provider
 *
 * Wraps useUnifiedGeneration hook to provide generation state across the app.
 * Persists generation state across page navigation.
 *
 * Provides a backward-compatible interface for components that expect the
 * single-queue API (currentJob, pendingJobs) while using the unified hook
 * internally.
 */

import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { useUnifiedGeneration } from '../hooks/useUnifiedGeneration';
import { calculateETA } from '../utils/timeFormat';

const GenerationContext = createContext(null);

/**
 * Generation provider component
 * Wraps the app to provide global generation state
 */
export function GenerationProvider({ children }) {
  // Get generation state from unified hook
  const unified = useUnifiedGeneration();

  // Panel visibility state
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMinimized, setPanelMinimized] = useState(true);

  // Panel controls
  const openPanel = useCallback(() => {
    setPanelOpen(true);
    setPanelMinimized(false);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setPanelMinimized(true);
  }, []);

  const toggleMinimize = useCallback(() => {
    if (panelMinimized) {
      setPanelOpen(true);
      setPanelMinimized(false);
    } else {
      setPanelMinimized(true);
    }
  }, [panelMinimized]);

  // ========== BACKWARD COMPATIBILITY LAYER ==========
  // Map unified state to legacy single-queue interface for GenerationNotificationPanel

  // Current job: prioritize images, then music, then sfx
  const currentJob = useMemo(() => {
    return unified.queues.images.current
      || unified.queues.music.current
      || unified.queues.sfx.current
      || null;
  }, [unified.queues]);

  // Pending jobs: combine all queues
  const pendingJobs = useMemo(() => {
    return [
      ...unified.queues.images.pending,
      ...unified.queues.music.pending,
      ...unified.queues.sfx.pending,
    ];
  }, [unified.queues]);

  // Paused: any queue paused
  const paused = useMemo(() => {
    return unified.queues.images.paused
      || unified.queues.music.paused
      || unified.queues.sfx.paused;
  }, [unified.queues]);

  // Stats: computed from unified state
  const stats = useMemo(() => ({
    pendingCount: unified.totalPending,
    historyCount: 0, // Not tracked in unified hook
    isProcessing: unified.anyActive,
  }), [unified.totalPending, unified.anyActive]);

  // Progress: from active queue
  const progress = useMemo(() => {
    const active = unified.queues.images.progress
      || unified.queues.music.progress
      || unified.queues.sfx.progress;
    return active || { current: 0, total: 0, steps: { current: 0, total: 0 } };
  }, [unified.queues]);

  // Generated images: filter from unified assets
  const generatedImages = useMemo(() => {
    return unified.generatedAssets
      .filter(asset => asset.type === 'image')
      .map(asset => ({ path: asset.path, timestamp: asset.timestamp }));
  }, [unified.generatedAssets]);

  // Computed state
  const isProcessing = unified.anyActive;
  const pendingCount = unified.totalPending;
  const currentProgress = progress;
  const eta = currentJob?.startedAt
    ? calculateETA(currentProgress, currentJob.startedAt)
    : null;

  // Legacy control actions (wrap unified actions)
  const cancelJob = useCallback((jobId) => {
    // Determine which queue the job belongs to
    if (unified.queues.images.current?.id === jobId ||
        unified.queues.images.pending.some(j => j.id === jobId)) {
      unified.cancelJob('images', jobId);
    } else if (unified.queues.music.current?.id === jobId ||
               unified.queues.music.pending.some(j => j.id === jobId)) {
      unified.cancelJob('music', jobId);
    } else if (unified.queues.sfx.current?.id === jobId ||
               unified.queues.sfx.pending.some(j => j.id === jobId)) {
      unified.cancelJob('sfx', jobId);
    }
  }, [unified]);

  const cancelAll = useCallback(() => {
    // Cancel all queues - this would need to be implemented in the unified hook
    // For now, cancel current jobs in each queue
    if (unified.queues.images.current) {
      unified.cancelJob('images', unified.queues.images.current.id);
    }
    if (unified.queues.music.current) {
      unified.cancelJob('music', unified.queues.music.current.id);
    }
    if (unified.queues.sfx.current) {
      unified.cancelJob('sfx', unified.queues.sfx.current.id);
    }
  }, [unified]);

  const pause = useCallback(() => {
    // Pause all queues
    unified.pauseQueue('images');
    unified.pauseQueue('music');
  }, [unified]);

  const resume = useCallback(() => {
    // Resume all queues
    unified.resumeQueue('images');
    unified.resumeQueue('music');
  }, [unified]);

  const reconnect = useCallback(() => {
    // Unified hook handles reconnection via socket connection
    unified.refresh();
  }, [unified]);

  // Memoize context value
  const contextValue = useMemo(() => ({
    // ========== UNIFIED STATE (NEW API) ==========
    unified,

    // ========== BACKWARD COMPATIBLE STATE (LEGACY API) ==========
    // Connection state
    connected: unified.connected,
    connectionState: unified.connectionState,
    connectionError: null, // Unified hook doesn't expose this

    // Queue state (combined view)
    currentJob,
    pendingJobs,
    paused,
    stats,

    // Progress
    progress,

    // Console output
    stdout: unified.stdout,
    clearStdout: unified.clearStdout,

    // Generated images
    generatedImages,

    // Computed state
    isProcessing,
    pendingCount,
    eta,
    currentProgress,

    // Panel visibility
    panelOpen,
    panelMinimized,

    // Panel controls
    openPanel,
    closePanel,
    toggleMinimize,

    // Actions
    cancelJob,
    cancelAll,
    pause,
    resume,
    refresh: unified.refresh,
    reconnect,
  }), [
    unified,
    currentJob,
    pendingJobs,
    paused,
    stats,
    progress,
    generatedImages,
    isProcessing,
    pendingCount,
    eta,
    currentProgress,
    panelOpen,
    panelMinimized,
    openPanel,
    closePanel,
    toggleMinimize,
    cancelJob,
    cancelAll,
    pause,
    resume,
    reconnect,
  ]);

  return (
    <GenerationContext.Provider value={contextValue}>
      {children}
    </GenerationContext.Provider>
  );
}

/**
 * Hook to use generation context
 *
 * Usage:
 *   const { currentJob, isProcessing, openPanel } = useGenerationContext();
 *
 * For new components, prefer using the unified state directly:
 *   const { unified } = useGenerationContext();
 *   // or import useUnifiedGeneration directly
 */
export function useGenerationContext() {
  const context = useContext(GenerationContext);
  if (!context) {
    throw new Error('useGenerationContext must be used within a GenerationProvider');
  }
  return context;
}

// Re-export calculateETA for backward compatibility
export { calculateETA };

export default GenerationContext;
