/**
 * @deprecated This hook has been replaced by useUnifiedGeneration.js which provides
 * consolidated state management for all three generation queues (images, music, SFX).
 * The old hook only tracked image generation; the new hook tracks all sources via
 * unified WebSocket events.
 *
 * @see useUnifiedGeneration.js - Replacement hook with multi-queue support
 *
 * useGeneration Hook (Legacy)
 * React hook for managing real-time generation state via WebSocket
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import * as socket from '../lib/socket';
import { ConnectionState } from '../lib/socket';
import { api } from '../lib/api';
import { formatDurationHuman } from '../utils/timeFormat';

// Storage key for persisting stdout across reconnections
const STDOUT_STORAGE_KEY = 'admin_generation_stdout';
const MAX_STDOUT_LINES = 500;

/**
 * Hook for generation state and WebSocket events
 */
export function useGeneration() {
  // Connection state
  const [connected, setConnected] = useState(false);
  const [connectionState, setConnectionState] = useState(ConnectionState.DISCONNECTED);
  const [connectionError, setConnectionError] = useState(null);

  // Queue state
  const [currentJob, setCurrentJob] = useState(null);
  const [pendingJobs, setPendingJobs] = useState([]);
  const [paused, setPaused] = useState(false);
  const [stats, setStats] = useState({ pendingCount: 0, historyCount: 0, isProcessing: false });

  // Console output
  const [stdout, setStdout] = useState([]);
  const stdoutRef = useRef([]);

  // Generated images
  const [generatedImages, setGeneratedImages] = useState([]);

  // Progress tracking
  const [progress, setProgress] = useState({ current: 0, total: 0, steps: { current: 0, total: 0 } });

  // Load persisted stdout on mount
  useEffect(() => {
    try {
      const persisted = localStorage.getItem(STDOUT_STORAGE_KEY);
      if (persisted) {
        const parsed = JSON.parse(persisted);
        if (Array.isArray(parsed) && parsed.length > 0) {
          stdoutRef.current = parsed;
          setStdout(parsed);
        }
      }
    } catch (err) {
      // Ignore storage errors
    }
  }, []);

  // Persist stdout when it changes
  const persistStdout = useCallback((lines) => {
    try {
      localStorage.setItem(STDOUT_STORAGE_KEY, JSON.stringify(lines.slice(-MAX_STDOUT_LINES)));
    } catch (err) {
      // Ignore storage errors (quota exceeded, etc.)
    }
  }, []);

  // Fetch initial state from API
  const fetchQueueState = useCallback(async () => {
    try {
      const data = await api.getQueue();
      setCurrentJob(data.current);
      setPendingJobs(data.pending || []);
      setPaused(data.paused || false);
      setStats(data.stats || { pendingCount: 0, historyCount: 0, isProcessing: false });

      if (data.stdout && data.stdout.length > 0) {
        stdoutRef.current = data.stdout;
        setStdout(data.stdout);
        persistStdout(data.stdout);
      }
      if (data.generatedImages) {
        setGeneratedImages(data.generatedImages);
      }
      if (data.current?.progress) {
        setProgress(data.current.progress);
      }
    } catch (err) {
      console.error('Failed to fetch queue state:', err);
    }
  }, [persistStdout]);

  // Connect to WebSocket and set up event handlers
  useEffect(() => {
    // Set up connection callbacks
    socket.onConnect(() => {
      setConnected(true);
      setConnectionError(null);
      // Fetch current state when connected
      fetchQueueState();
    });

    socket.onDisconnect(() => {
      setConnected(false);
    });

    socket.onError((err) => {
      setConnectionError(err.message || 'Connection error');
    });

    // Track detailed connection state
    socket.onStateChange((newState) => {
      setConnectionState(newState);
      setConnected(newState === ConnectionState.AUTHENTICATED);
    });

    // Register event handlers
    const unsubscribers = [];

    // Queue update handler
    unsubscribers.push(
      socket.on('generation:queue_update', (payload) => {
        setCurrentJob(payload.current);
        setPendingJobs(payload.pending || []);
        setPaused(payload.paused || false);
        setStats(payload.stats || { pendingCount: 0, historyCount: 0, isProcessing: false });
      })
    );

    // Job started handler
    unsubscribers.push(
      socket.on('generation:started', (payload) => {
        console.log('[Generation] Started:', payload);
        // Reset state for new job
        stdoutRef.current = [];
        setStdout([]);
        setGeneratedImages([]);
        setProgress({ current: 0, total: 0, steps: { current: 0, total: 0 } });
        // Clear persisted stdout for new job
        persistStdout([]);
      })
    );

    // Progress update handler
    unsubscribers.push(
      socket.on('generation:progress', (payload) => {
        setProgress(payload.progress);
        if (payload.images !== undefined) {
          // Just track count, actual images come from stdout parsing
        }
      })
    );

    // Stdout handler
    unsubscribers.push(
      socket.on('generation:stdout', (payload) => {
        const line = payload.line;
        const newStdout = [...stdoutRef.current, line].slice(-MAX_STDOUT_LINES);
        stdoutRef.current = newStdout;
        setStdout(newStdout);
        persistStdout(newStdout);

        // Check for saved image in stdout
        if (line.text && line.text.includes('Saved:')) {
          const match = line.text.match(/Saved:\s*(.+\.png)/i);
          if (match) {
            setGeneratedImages((prev) => [
              ...prev,
              { path: match[1], timestamp: line.timestamp }
            ]);
          }
        }
      })
    );

    // Job completed handler
    unsubscribers.push(
      socket.on('generation:completed', (payload) => {
        console.log('[Generation] Completed:', payload);
        if (payload.generatedImages) {
          setGeneratedImages(payload.generatedImages);
        }
      })
    );

    // Job failed handler
    unsubscribers.push(
      socket.on('generation:failed', (payload) => {
        console.log('[Generation] Failed:', payload);
      })
    );

    // Connect to WebSocket
    socket.connect();

    // Cleanup
    return () => {
      unsubscribers.forEach((unsub) => unsub && unsub());
      socket.disconnect();
    };
  }, [fetchQueueState, persistStdout]);

  // Control actions
  const cancelJob = useCallback((jobId) => {
    if (socket.isAuthenticated()) {
      socket.generation.cancel(jobId);
    } else {
      // Fallback to API
      api.cancelJob(jobId).then(fetchQueueState);
    }
  }, [fetchQueueState]);

  const cancelAll = useCallback(() => {
    if (socket.isAuthenticated()) {
      socket.generation.cancelAll();
    } else {
      // Fallback to API
      api.cancelAllJobs().then(fetchQueueState);
    }
  }, [fetchQueueState]);

  const pause = useCallback(async () => {
    if (socket.isAuthenticated()) {
      socket.generation.pause();
    } else {
      // Fallback to API
      try {
        await fetch('/api/admin/generate/pause', { method: 'POST' });
        fetchQueueState();
      } catch (err) {
        console.error('Failed to pause:', err);
      }
    }
  }, [fetchQueueState]);

  const resume = useCallback(async () => {
    if (socket.isAuthenticated()) {
      socket.generation.resume();
    } else {
      // Fallback to API
      try {
        await fetch('/api/admin/generate/resume', { method: 'POST' });
        fetchQueueState();
      } catch (err) {
        console.error('Failed to resume:', err);
      }
    }
  }, [fetchQueueState]);

  // Clear stdout
  const clearStdout = useCallback(() => {
    stdoutRef.current = [];
    setStdout([]);
    persistStdout([]);
  }, [persistStdout]);

  // Manual reconnect
  const reconnect = useCallback(() => {
    setConnectionError(null);
    socket.reconnect();
  }, []);

  return {
    // Connection state
    connected,
    connectionState,
    connectionError,

    // Queue state
    currentJob,
    pendingJobs,
    paused,
    stats,

    // Progress
    progress,

    // Console output
    stdout,
    clearStdout,

    // Generated images
    generatedImages,

    // Actions
    cancelJob,
    cancelAll,
    pause,
    resume,
    refresh: fetchQueueState,
    reconnect
  };
}

/**
 * Calculate ETA based on progress
 */
export function calculateETA(progress, startedAt) {
  if (!progress || !progress.total || progress.current === 0 || !startedAt) {
    return null;
  }

  const elapsed = Date.now() - new Date(startedAt).getTime();
  const avgTimePerItem = elapsed / progress.current;
  const remaining = progress.total - progress.current;
  const etaMs = remaining * avgTimePerItem;

  return {
    ms: etaMs,
    formatted: formatDurationHuman(etaMs)
  };
}

export default useGeneration;
