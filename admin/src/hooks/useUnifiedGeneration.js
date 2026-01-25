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

  // Merged console output with source tags
  const [stdout, setStdout] = useState([]);
  const stdoutRef = useRef([]);

  // Generated assets (unified list)
  const [generatedAssets, setGeneratedAssets] = useState([]);
  const generatedAssetsRef = useRef([]);

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

  // Add a generated asset
  const addGeneratedAsset = useCallback((type, path, additionalData = {}) => {
    const asset = {
      type, // 'image', 'music', or 'sfx'
      path,
      timestamp: new Date().toISOString(),
      ...additionalData
    };

    const newAssets = [asset, ...generatedAssetsRef.current].slice(0, MAX_GENERATED_ASSETS);
    generatedAssetsRef.current = newAssets;
    setGeneratedAssets(newAssets);
  }, []);

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
    // Set up connection callbacks
    socket.onConnect(() => {
      setConnected(true);
      fetchAllQueueStates();
    });

    socket.onDisconnect(() => {
      setConnected(false);
    });

    socket.onStateChange((newState) => {
      setConnectionState(newState);
      setConnected(newState === ConnectionState.AUTHENTICATED);
    });

    const unsubscribers = [];

    // ========== UNIFIED EVENT HANDLER ==========
    unsubscribers.push(
      socket.on('asset:generation_update', (payload) => {
        const { source, eventType, job, progress, line, lineType } = payload;

        // Handle stdout events
        if (eventType === 'stdout' && line) {
          addStdoutLine(source, line, lineType || 'stdout');
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
          setQueues(prev => ({
            ...prev,
            [source]: {
              ...prev[source],
              current: job,
              progress: null
            }
          }));
        }

        // Handle job completed
        if (eventType === 'completed' && job) {
          // Add generated assets
          if (job.generatedAssets) {
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

    unsubscribers.push(
      socket.on('generation:stdout', (payload) => {
        const { line } = payload;
        if (line?.text) {
          addStdoutLine('images', line.text, line.type || 'stdout');

          // Check for saved image
          if (line.text.includes('Saved:')) {
            const match = line.text.match(/Saved:\s*(.+\.png)/i);
            if (match) {
              addGeneratedAsset('image', match[1]);
            }
          }
        }
      })
    );

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
        const { line, progress } = payload;
        // Determine source from current job and update state
        setQueues(prev => {
          const source = prev.music.current ? 'music' : prev.sfx.current ? 'sfx' : null;

          // Handle stdout logging
          if (line && source) {
            addStdoutLine(source, line, 'stdout');

            // Check for saved audio
            if (typeof line === 'string' && line.includes('Saved:')) {
              const match = line.match(/Saved:\s*(.+\.mp3)/i);
              if (match) {
                addGeneratedAsset(source, match[1]);
              }
            }
          }

          // Update progress
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

    unsubscribers.push(
      socket.on('audio:log', (payload) => {
        const { line, level } = payload;
        // Determine source from current job using state updater
        setQueues(prev => {
          const source = prev.music.current ? 'music' : prev.sfx.current ? 'sfx' : null;
          if (line && source) {
            addStdoutLine(source, line, level === 'error' ? 'stderr' : 'stdout');
          }
          return prev; // No state change needed
        });
      })
    );

    unsubscribers.push(
      socket.on('audio:job_completed', (payload) => {
        const job = payload.job;
        if (job?.generatedAssets) {
          job.generatedAssets.forEach(path => {
            addGeneratedAsset(job.type === 'music' ? 'music' : 'sfx', path);
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
