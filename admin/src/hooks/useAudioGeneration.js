/**
 * useAudioGeneration Hook
 * React hook for managing real-time audio generation state via WebSocket
 *
 * Similar to useGeneration but for audio (music/sfx) generation
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import * as socket from '../lib/socket';
import { api } from '../lib/api';

// Storage key for persisting stdout across reconnections
const STDOUT_STORAGE_KEY = 'admin_audio_generation_stdout';
const MAX_STDOUT_LINES = 500;

/**
 * Hook for audio generation state and WebSocket events
 */
export function useAudioGeneration() {
  // Connection state (shared with main generation)
  const [connected, setConnected] = useState(false);

  // Queue state
  const [currentJob, setCurrentJob] = useState(null);
  const [pendingJobs, setPendingJobs] = useState([]);
  const [paused, setPaused] = useState(false);
  const [stats, setStats] = useState({ pendingCount: 0, historyCount: 0, isProcessing: false });

  // Console output
  const [stdout, setStdout] = useState([]);
  const stdoutRef = useRef([]);

  // Generated assets
  const [generatedAssets, setGeneratedAssets] = useState([]);

  // Progress tracking
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  // Suno task tracking (for async music generation)
  const [sunoTasks, setSunoTasks] = useState(new Map());

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
      const data = await api.getAudioQueue();
      setCurrentJob(data.current);
      setPendingJobs(data.pending || []);
      setPaused(data.paused || false);
      setStats(data.stats || { pendingCount: 0, historyCount: 0, isProcessing: false });

      if (data.stdout && data.stdout.length > 0) {
        stdoutRef.current = data.stdout;
        setStdout(data.stdout);
        persistStdout(data.stdout);
      }
      if (data.generatedAssets) {
        setGeneratedAssets(data.generatedAssets);
      }
      if (data.current?.progress) {
        setProgress(data.current.progress);
      }
    } catch (err) {
      console.error('Failed to fetch audio queue state:', err);
    }
  }, [persistStdout]);

  // Connect to WebSocket and set up event handlers
  useEffect(() => {
    // Set up connection callbacks
    socket.onConnect(() => {
      setConnected(true);
      fetchQueueState();
    });

    socket.onDisconnect(() => {
      setConnected(false);
    });

    // Register audio-specific event handlers
    const unsubscribers = [];

    // Queue update handler
    unsubscribers.push(
      socket.on('audio:queue_update', (payload) => {
        setCurrentJob(payload.current);
        setPendingJobs(payload.pending || []);
        setPaused(payload.paused || false);
        setStats(payload.stats || { pendingCount: 0, historyCount: 0, isProcessing: false });
      })
    );

    // Job started handler
    unsubscribers.push(
      socket.on('audio:job_started', (payload) => {
        console.log('[AudioGeneration] Started:', payload);
        // Reset state for new job
        stdoutRef.current = [];
        setStdout([]);
        setGeneratedAssets([]);
        setProgress({ current: 0, total: 0 });
        persistStdout([]);
      })
    );

    // Progress update handler
    unsubscribers.push(
      socket.on('audio:progress', (payload) => {
        if (payload.progress) {
          setProgress(payload.progress);
        }
        if (payload.line) {
          const newStdout = [...stdoutRef.current, payload.line].slice(-MAX_STDOUT_LINES);
          stdoutRef.current = newStdout;
          setStdout(newStdout);
          persistStdout(newStdout);
        }
      })
    );

    // Log handler
    unsubscribers.push(
      socket.on('audio:log', (payload) => {
        const newStdout = [...stdoutRef.current, payload.line].slice(-MAX_STDOUT_LINES);
        stdoutRef.current = newStdout;
        setStdout(newStdout);
        persistStdout(newStdout);
      })
    );

    // Job completed handler
    unsubscribers.push(
      socket.on('audio:job_completed', (payload) => {
        console.log('[AudioGeneration] Completed:', payload);
        if (payload.job?.generatedAssets) {
          setGeneratedAssets(payload.job.generatedAssets);
        }
      })
    );

    // Suno task update handler
    unsubscribers.push(
      socket.on('audio:suno_task_update', (payload) => {
        setSunoTasks(prev => {
          const updated = new Map(prev);
          updated.set(payload.taskId, payload);
          return updated;
        });
      })
    );

    // Connect to WebSocket (if not already connected)
    if (!socket.isConnected()) {
      socket.connect();
    }

    // Cleanup
    return () => {
      unsubscribers.forEach((unsub) => unsub && unsub());
    };
  }, [fetchQueueState, persistStdout]);

  // Control actions
  const cancelJob = useCallback(async (jobId) => {
    try {
      await api.cancelAudioJob(jobId);
      fetchQueueState();
    } catch (err) {
      console.error('Failed to cancel audio job:', err);
    }
  }, [fetchQueueState]);

  const cancelAll = useCallback(async () => {
    try {
      await api.cancelAllAudioJobs();
      fetchQueueState();
    } catch (err) {
      console.error('Failed to cancel all audio jobs:', err);
    }
  }, [fetchQueueState]);

  const pause = useCallback(async () => {
    try {
      await fetch('/api/admin/audio/generate/pause', { method: 'POST' });
      fetchQueueState();
    } catch (err) {
      console.error('Failed to pause:', err);
    }
  }, [fetchQueueState]);

  const resume = useCallback(async () => {
    try {
      await fetch('/api/admin/audio/generate/resume', { method: 'POST' });
      fetchQueueState();
    } catch (err) {
      console.error('Failed to resume:', err);
    }
  }, [fetchQueueState]);

  // Check Suno task status
  const checkSunoStatus = useCallback(async (taskId) => {
    try {
      const status = await api.getSunoTaskStatus(taskId);
      setSunoTasks(prev => {
        const updated = new Map(prev);
        updated.set(taskId, status);
        return updated;
      });
      return status;
    } catch (err) {
      console.error('Failed to check Suno status:', err);
      return null;
    }
  }, []);

  // Clear stdout
  const clearStdout = useCallback(() => {
    stdoutRef.current = [];
    setStdout([]);
    persistStdout([]);
  }, [persistStdout]);

  return {
    // Connection state
    connected,

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

    // Generated assets
    generatedAssets,

    // Suno tasks
    sunoTasks,
    checkSunoStatus,

    // Actions
    cancelJob,
    cancelAll,
    pause,
    resume,
    refresh: fetchQueueState,
  };
}

export default useAudioGeneration;
