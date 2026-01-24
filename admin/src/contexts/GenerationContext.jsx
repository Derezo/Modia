/**
 * GenerationContext - Global generation state provider
 *
 * Wraps useGeneration hook to provide generation state across the app.
 * Persists generation state across page navigation.
 */

import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { useGeneration, calculateETA } from '../hooks/useGeneration';

const GenerationContext = createContext(null);

/**
 * Generation provider component
 * Wraps the app to provide global generation state
 */
export function GenerationProvider({ children }) {
  // Get generation state from hook
  const generation = useGeneration();

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

  // Computed state
  const isProcessing = generation.stats?.isProcessing || false;
  const pendingCount = generation.pendingJobs?.length || 0;
  const currentProgress = generation.currentJob?.progress || generation.progress;
  const eta = generation.currentJob?.startedAt
    ? calculateETA(currentProgress, generation.currentJob.startedAt)
    : null;

  // Memoize context value
  const contextValue = useMemo(() => ({
    // Generation state from hook
    ...generation,

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
  }), [
    generation,
    isProcessing,
    pendingCount,
    eta,
    currentProgress,
    panelOpen,
    panelMinimized,
    openPanel,
    closePanel,
    toggleMinimize,
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
 */
export function useGenerationContext() {
  const context = useContext(GenerationContext);
  if (!context) {
    throw new Error('useGenerationContext must be used within a GenerationProvider');
  }
  return context;
}

export default GenerationContext;
