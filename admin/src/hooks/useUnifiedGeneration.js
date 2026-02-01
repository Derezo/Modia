/**
 * useUnifiedGeneration Hook
 * Aggregates all three generation queues (images, music, SFX) into a unified view
 *
 * Listens to:
 * - asset:generation_update (unified events)
 * - generation:* (image-specific events)
 * - audio:* (music/sfx-specific events)
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as socket from '../lib/socket';
import { ConnectionState } from '../lib/socket';
import { api } from '../lib/api';

// Storage keys for persisting stdout
const UNIFIED_STDOUT_KEY = 'admin_unified_stdout';
const MAX_STDOUT_LINES = 500;
const MAX_GENERATED_ASSETS = 100;

/**
 * Hook for unified generation state across images, music, and SFX
 */
export function useUnifiedGeneration() {
  // Connection state
  const [connected, setConnected] = useState(false);
  const [connectionState, setConnectionState] = useState(ConnectionState.DISCONNECTED);

  // Per-queue state
  const [queues, setQueues] = useState({
    images: { current: null, pending: [], paused: false, progress: null },
    music: { current: null, pending: [], paused: false, progress: null },
    sfx: { current: null, pending: [], paused: false, progress: null }
  });

  // Ref to track current queues state for non-React callbacks
  const queuesRef = useRef(queues);

  // Merged console output with source tags
  const [stdout, setStdout] = useState([]);
  const stdoutRef = useRef([]);

  // Generated assets (unified list)
  const [generatedAssets, setGeneratedAssets] = useState([]);
  const generatedAssetsRef = useRef([]);

  // Keep queuesRef in sync with queues state
  useEffect(() => {
    queuesRef.current = queues;
  }, [queues]);

  // Load persisted stdout on mount
  useEffect(() => {
    try {
      const persisted = localStorage.getItem(UNIFIED_STDOUT_KEY);
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
      localStorage.setItem(UNIFIED_STDOUT_KEY, JSON.stringify(lines.slice(-MAX_STDOUT_LINES)));
    } catch (err) {
      // Ignore storage errors
    }
  }, []);

  // Add a line to stdout with source tag
  const addStdoutLine = useCallback((source, line, lineType = 'stdout') => {
    // Dedup: skip if same source+line appeared in last 5 entries within 2 seconds
    const recentDupe = stdoutRef.current.slice(-5).some(entry =>
      entry.source === source && entry.line === line &&
      (Date.now() - new Date(entry.timestamp).getTime()) < 2000
    );
    if (recentDupe) return;

    const entry = {
      source,
      line,
      lineType,
      timestamp: new Date().toISOString()
    };

    const newStdout = [...stdoutRef.current, entry].slice(-MAX_STDOUT_LINES);
    stdoutRef.current = newStdout;
    setStdout(newStdout);
    persistStdout(newStdout);
  }, [persistStdout]);

  // Normalize path to web path for consistent dedup (strip filesystem prefix)
  const normalizePath = useCallback((p) => {
    if (!p) return p;
    const publicIndex = p.indexOf('/public/');
    return publicIndex !== -1 ? p.slice(publicIndex + 7) : p;
  }, []);

  // Add a generated asset
  const addGeneratedAsset = useCallback((type, path, additionalData = {}) => {
    const normalizedPath = normalizePath(path);
    // Dedup: skip if asset with same normalized path already exists (guard against undefined matching undefined)
    if (normalizedPath && generatedAssetsRef.current.some(a => normalizePath(a.path) === normalizedPath)) return;

    const asset = {
      type, // 'image', 'music', or 'sfx'
      path: normalizedPath || path,
      timestamp: new Date().toISOString(),
      ...additionalData
    };

    const newAssets = [asset, ...generatedAssetsRef.current].slice(0, MAX_GENERATED_ASSETS);
    generatedAssetsRef.current = newAssets;
    setGeneratedAssets(newAssets);
  }, [normalizePath]);

  // Fetch initial state from API for all queues
  const fetchAllQueueStates = useCallback(async () => {
    try {
      // Fetch image and audio queue states in parallel
      const [imageData, audioData] = await Promise.all([
        api.getQueue().catch(() => ({})),
        api.getAudioQueue().catch(() => ({}))
      ]);

      setQueues({
        images: {
          current: imageData.current || null,
          pending: imageData.pending || [],
          paused: imageData.paused || false,
          progress: imageData.current?.progress || null
        },
        music: {
          current: audioData.current?.type === 'music' ? audioData.current : null,
          pending: (audioData.pending || []).filter(j => j.type === 'music'),
          paused: audioData.paused || false,
          progress: audioData.current?.type === 'music' ? audioData.current?.progress : null
        },
        sfx: {
          current: audioData.current?.type === 'sfx' ? audioData.current : null,
          pending: (audioData.pending || []).filter(j => j.type === 'sfx'),
          paused: audioData.paused || false,
          progress: audioData.current?.type === 'sfx' ? audioData.current?.progress : null
        }
      });
    } catch (err) {
      console.error('Failed to fetch queue states:', err);
    }
  }, []);

  // Connect to WebSocket and set up event handlers
  useEffect(() => {
    const unsubscribers = [];

    // Set up connection callbacks (with cleanup support)
    unsubscribers.push(socket.onConnect(() => {
      setConnected(true);
      fetchAllQueueStates();
    }));

    unsubscribers.push(socket.onDisconnect(() => {
      setConnected(false);
    }));

    unsubscribers.push(socket.onStateChange((newState) => {
      setConnectionState(newState);
      setConnected(newState === ConnectionState.AUTHENTICATED);
    }));

    // ========== UNIFIED EVENT HANDLER ==========
    unsubscribers.push(
      socket.on('asset:generation_update', (payload) => {
        const { source, eventType, job, progress, line, lineType } = payload;

        // Handle stdout events
        if (eventType === 'stdout' && line) {
          addStdoutLine(source, line, lineType || 'stdout');
        }

        // Handle asset_generated events (real-time asset updates)
        if (eventType === 'asset_generated' && payload.asset) {
          addGeneratedAsset(payload.asset.type, payload.asset.path, payload.asset);
        }

        // Handle progress events
        if (eventType === 'progress') {
          setQueues(prev => ({
            ...prev,
            [source]: {
              ...prev[source],
              progress
            }
          }));
        }

        // Handle job started
        if (eventType === 'started' && job) {
          // Add validation and fallback for source
          const effectiveSource = source || (job?.type === 'audio' ? (job?.category === 'sfx' ? 'sfx' : 'music') : 'images');
          if (!effectiveSource || !['images', 'music', 'sfx'].includes(effectiveSource)) {
            console.warn('[useUnifiedGeneration] Cannot determine source for started event:', payload);
            return;
          }
          setQueues(prev => ({
            ...prev,
            [effectiveSource]: {
              ...prev[effectiveSource],
              current: job,
              progress: null
            }
          }));
        }

        // Handle job completed
        if (eventType === 'completed' && job) {
          // Add generated assets (may have already been added via asset_generated events)
          if (job.generatedAssets && job.generatedAssets.length > 0) {
            job.generatedAssets.forEach(asset => {
              addGeneratedAsset(asset.type, asset.path, asset);
            });
          }

          setQueues(prev => ({
            ...prev,
            [source]: {
              ...prev[source],
              current: null,
              progress: null
            }
          }));
        }

        // Handle job failed
        if (eventType === 'failed') {
          setQueues(prev => ({
            ...prev,
            [source]: {
              ...prev[source],
              current: null,
              progress: null
            }
          }));
        }

        // Handle job queued
        if (eventType === 'queued' && job) {
          setQueues(prev => ({
            ...prev,
            [source]: {
              ...prev[source],
              pending: [...prev[source].pending, job]
            }
          }));
        }
      })
    );

    // ========== LEGACY STDOUT FALLBACK HANDLERS ==========
    // Re-added for backwards compatibility when unified events don't contain stdout
    unsubscribers.push(
      socket.on('generation:stdout', ({ line, type }) => {
        if (line?.text) {
          addStdoutLine('images', line.text, type || line.type || 'stdout');
        } else if (typeof line === 'string') {
          addStdoutLine('images', line, type || 'stdout');
        }
      })
    );

    unsubscribers.push(
      socket.on('audio:log', ({ message, level, category }) => {
        if (message) {
          const source = category === 'sfx' ? 'sfx' : 'music';
          addStdoutLine(source, message, level === 'error' ? 'stderr' : 'stdout');
        }
      })
    );

    // ========== IMAGE-SPECIFIC HANDLERS ==========
    unsubscribers.push(
      socket.on('generation:queue_update', (payload) => {
        setQueues(prev => ({
          ...prev,
          images: {
            current: payload.current,
            pending: payload.pending || [],
            paused: payload.paused || false,
            progress: payload.current?.progress || prev.images.progress
          }
        }));
      })
    );

    unsubscribers.push(
      socket.on('generation:started', () => {
        // Clear stdout for new job
        // (handled by unified event, but keep for direct events)
      })
    );

    // NOTE: generation:stdout handler removed - now handled by unified asset:generation_update events
    // to prevent duplicate console lines

    unsubscribers.push(
      socket.on('generation:progress', (payload) => {
        setQueues(prev => ({
          ...prev,
          images: {
            ...prev.images,
            progress: payload.progress
          }
        }));
      })
    );

    // ========== AUDIO-SPECIFIC HANDLERS ==========
    unsubscribers.push(
      socket.on('audio:queue_update', (payload) => {
        const current = payload.current;
        const pending = payload.pending || [];

        setQueues(prev => ({
          ...prev,
          music: {
            current: current?.type === 'music' ? current : null,
            pending: pending.filter(j => j.type === 'music'),
            paused: payload.paused || false,
            progress: current?.type === 'music' ? current?.progress : null
          },
          sfx: {
            current: current?.type === 'sfx' ? current : null,
            pending: pending.filter(j => j.type === 'sfx'),
            paused: payload.paused || false,
            progress: current?.type === 'sfx' ? current?.progress : null
          }
        }));
      })
    );

    unsubscribers.push(
      socket.on('audio:progress', (payload) => {
        const { progress } = payload;
        // NOTE: stdout logging removed - now handled by unified asset:generation_update events
        // NOTE: saved asset detection removed - now handled by unified asset_generated events

        // Update progress only
        setQueues(prev => {
          const source = prev.music.current ? 'music' : prev.sfx.current ? 'sfx' : null;
          if (source && progress) {
            return {
              ...prev,
              [source]: {
                ...prev[source],
                progress
              }
            };
          }
          return prev;
        });
      })
    );

    // NOTE: audio:log handler removed - now handled by unified asset:generation_update events

    unsubscribers.push(
      socket.on('audio:job_completed', (payload) => {
        const job = payload.job;
        if (job?.generatedAssets) {
          job.generatedAssets.forEach(assetPath => {
            addGeneratedAsset(job.type === 'music' ? 'music' : 'sfx', assetPath);
          });
        }
      })
    );

    // Connect if not already connected
    if (!socket.isConnected()) {
      socket.connect();
    } else {
      // Already connected, fetch states
      fetchAllQueueStates();
    }

    return () => {
      unsubscribers.forEach(unsub => unsub && unsub());
    };
  }, [fetchAllQueueStates, addStdoutLine, addGeneratedAsset]);

  // Stuck queue detection watchdog
  useEffect(() => {
    const POLL_INTERVAL = 30000; // 30 seconds
    const STUCK_THRESHOLD = 60000; // 1 minute without progress

    const checkForStuckQueues = async () => {
      if (!connected) return;

      const sources = ['images', 'music', 'sfx'];

      for (const source of sources) {
        const queue = queuesRef.current[source];
        if (!queue) continue;

        // Check if queue might be stuck
        if (queue.current && !queue.paused && queue.pending?.length > 0) {
          const lastActivity = queue.progress?.timestamp
            ? new Date(queue.progress.timestamp).getTime()
            : queue.current.startedAt
              ? new Date(queue.current.startedAt).getTime()
              : Date.now();

          if (Date.now() - lastActivity > STUCK_THRESHOLD) {
            console.warn(`[Watchdog] Stuck queue detected: ${source}, triggering recovery`);
            try {
              const endpoint = source === 'images'
                ? '/api/admin/generate/recover'
                : '/api/admin/audio/recover';
              const response = await fetch(endpoint, { method: 'POST' });
              const result = await response.json();
              console.log(`[Watchdog] Recovery result for ${source}:`, result);
            } catch (err) {
              console.error(`[Watchdog] Recovery failed for ${source}:`, err);
            }
          }
        }
      }
    };

    const interval = setInterval(checkForStuckQueues, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [connected]);

  // Control actions
  const cancelJob = useCallback(async (source, jobId) => {
    try {
      if (source === 'images') {
        await api.cancelJob(jobId);
      } else {
        await api.cancelAudioJob(jobId);
      }
      fetchAllQueueStates();
    } catch (err) {
      console.error(`Failed to cancel ${source} job:`, err);
    }
  }, [fetchAllQueueStates]);

  const pauseQueue = useCallback(async (source) => {
    try {
      if (source === 'images') {
        await fetch('/api/admin/generate/pause', { method: 'POST' });
      } else {
        await fetch('/api/admin/audio/generate/pause', { method: 'POST' });
      }
      fetchAllQueueStates();
    } catch (err) {
      console.error(`Failed to pause ${source} queue:`, err);
    }
  }, [fetchAllQueueStates]);

  const resumeQueue = useCallback(async (source) => {
    try {
      if (source === 'images') {
        await fetch('/api/admin/generate/resume', { method: 'POST' });
      } else {
        await fetch('/api/admin/audio/generate/resume', { method: 'POST' });
      }
      fetchAllQueueStates();
    } catch (err) {
      console.error(`Failed to resume ${source} queue:`, err);
    }
  }, [fetchAllQueueStates]);

  // Clear stdout
  const clearStdout = useCallback(() => {
    stdoutRef.current = [];
    setStdout([]);
    persistStdout([]);
  }, [persistStdout]);

  // Clear generated assets
  const clearGeneratedAssets = useCallback(() => {
    generatedAssetsRef.current = [];
    setGeneratedAssets([]);
  }, []);

  // Computed values
  const anyActive = useMemo(() => {
    return queues.images.current || queues.music.current || queues.sfx.current;
  }, [queues]);

  const totalPending = useMemo(() => {
    return queues.images.pending.length + queues.music.pending.length + queues.sfx.pending.length;
  }, [queues]);

  // Queue summary for the status bar
  const queueSummary = useMemo(() => ({
    images: {
      isActive: !!queues.images.current,
      pendingCount: queues.images.pending.length,
      isPaused: queues.images.paused,
      progress: queues.images.progress
    },
    music: {
      isActive: !!queues.music.current,
      pendingCount: queues.music.pending.length,
      isPaused: queues.music.paused,
      progress: queues.music.progress
    },
    sfx: {
      isActive: !!queues.sfx.current,
      pendingCount: queues.sfx.pending.length,
      isPaused: queues.sfx.paused,
      progress: queues.sfx.progress
    }
  }), [queues]);

  return {
    // Connection state
    connected,
    connectionState,

    // Per-queue state
    queues,

    // Aggregated state
    anyActive,
    totalPending,
    queueSummary,

    // Merged console output
    stdout,
    clearStdout,

    // Generated assets
    generatedAssets,
    clearGeneratedAssets,

    // Controls
    cancelJob,
    pauseQueue,
    resumeQueue,
    refresh: fetchAllQueueStates
  };
}

export default useUnifiedGeneration;
