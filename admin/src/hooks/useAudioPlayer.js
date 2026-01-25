/**
 * useAudioPlayer Hook
 * React hook for audio playback with shared state across the application.
 * Ensures only one audio plays at a time.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

// Singleton state for global audio management
// This ensures only one audio plays at a time across all components
let globalAudioElement = null;
let globalCurrentTrack = null;
let globalIsPlaying = false;
const listeners = new Set();

/**
 * Notify all listeners of state changes
 */
function notifyListeners() {
  listeners.forEach((listener) => listener({
    currentTrack: globalCurrentTrack,
    isPlaying: globalIsPlaying,
  }));
}

/**
 * Stop any currently playing audio
 */
function stopGlobalAudio() {
  if (globalAudioElement) {
    globalAudioElement.pause();
    globalAudioElement.currentTime = 0;
    globalAudioElement = null;
  }
  globalIsPlaying = false;
  globalCurrentTrack = null;
  notifyListeners();
}

/**
 * Hook for audio playback with shared state
 * Ensures only one audio plays at a time across the app
 * @returns {object} Audio player state and controls
 */
export function useAudioPlayer() {
  const [state, setState] = useState({
    currentTrack: globalCurrentTrack,
    isPlaying: globalIsPlaying,
  });

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const audioRef = useRef(null);

  // Subscribe to global state changes
  useEffect(() => {
    const listener = (newState) => {
      setState(newState);
      // Sync local ref with global element
      audioRef.current = globalAudioElement;
    };

    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);

  /**
   * Play an audio track
   * @param {object} track - Track info { id, url, title, audioType }
   */
  const play = useCallback(async (track) => {
    if (!track?.url) {
      setError('No URL provided');
      return;
    }

    // Stop any currently playing audio
    stopGlobalAudio();

    setLoading(true);
    setError(null);
    setCurrentTime(0);

    try {
      const audio = new Audio();

      // Set up event listeners before setting src
      audio.addEventListener('loadedmetadata', () => {
        setDuration(audio.duration);
        setLoading(false);
      });

      audio.addEventListener('timeupdate', () => {
        setCurrentTime(audio.currentTime);
      });

      audio.addEventListener('ended', () => {
        globalIsPlaying = false;
        notifyListeners();
      });

      audio.addEventListener('error', () => {
        const errorMessages = {
          1: 'Audio loading aborted',
          2: 'Network error while loading audio',
          3: 'Audio decoding failed',
          4: 'Audio source not supported',
        };
        const code = audio.error?.code || 0;
        setError(errorMessages[code] || 'Unknown audio error');
        setLoading(false);
        globalIsPlaying = false;
        notifyListeners();
      });

      audio.volume = volume;
      audio.src = track.url;

      // Wait for audio to be ready
      await audio.play();

      // Update global state
      globalAudioElement = audio;
      globalCurrentTrack = track;
      globalIsPlaying = true;
      audioRef.current = audio;

      notifyListeners();
    } catch (err) {
      setError(err.message || 'Failed to play audio');
      setLoading(false);
    }
  }, [volume]);

  /**
   * Pause the current audio
   */
  const pause = useCallback(() => {
    if (globalAudioElement) {
      globalAudioElement.pause();
      globalIsPlaying = false;
      notifyListeners();
    }
  }, []);

  /**
   * Resume the paused audio
   */
  const resume = useCallback(async () => {
    if (globalAudioElement && !globalIsPlaying) {
      try {
        await globalAudioElement.play();
        globalIsPlaying = true;
        notifyListeners();
      } catch (err) {
        setError(err.message || 'Failed to resume audio');
      }
    }
  }, []);

  /**
   * Toggle play/pause
   * @param {object} [track] - Optional track to play if nothing is playing
   */
  const toggle = useCallback(async (track) => {
    // If a track is provided and it's different from current, play it
    if (track && track.id !== globalCurrentTrack?.id) {
      await play(track);
      return;
    }

    // If same track or no track provided, toggle current state
    if (globalIsPlaying) {
      pause();
    } else if (globalAudioElement) {
      await resume();
    } else if (track) {
      await play(track);
    }
  }, [play, pause, resume]);

  /**
   * Stop audio and reset
   */
  const stop = useCallback(() => {
    stopGlobalAudio();
    setCurrentTime(0);
    setDuration(0);
    setError(null);
  }, []);

  /**
   * Seek to a specific time
   * @param {number} time - Time in seconds
   */
  const seek = useCallback((time) => {
    if (globalAudioElement) {
      globalAudioElement.currentTime = Math.max(0, Math.min(time, globalAudioElement.duration));
      setCurrentTime(globalAudioElement.currentTime);
    }
  }, []);

  /**
   * Seek by percentage (0-1)
   * @param {number} percentage - Percentage of duration (0-1)
   */
  const seekPercent = useCallback((percentage) => {
    if (globalAudioElement && globalAudioElement.duration) {
      seek(percentage * globalAudioElement.duration);
    }
  }, [seek]);

  /**
   * Set volume (0-1)
   * @param {number} vol - Volume level
   */
  const setVolumeLevel = useCallback((vol) => {
    const clampedVol = Math.max(0, Math.min(1, vol));
    setVolume(clampedVol);
    if (globalAudioElement) {
      globalAudioElement.volume = clampedVol;
    }
  }, []);

  /**
   * Check if a specific track is currently playing
   * @param {string} trackId - Track ID to check
   * @returns {boolean}
   */
  const isTrackPlaying = useCallback((trackId) => {
    return state.isPlaying && state.currentTrack?.id === trackId;
  }, [state.isPlaying, state.currentTrack]);

  /**
   * Check if a specific track is the current track (playing or paused)
   * @param {string} trackId - Track ID to check
   * @returns {boolean}
   */
  const isCurrentTrack = useCallback((trackId) => {
    return state.currentTrack?.id === trackId;
  }, [state.currentTrack]);

  return {
    // State
    currentTrack: state.currentTrack,
    isPlaying: state.isPlaying,
    currentTime,
    duration,
    volume,
    loading,
    error,

    // Controls
    play,
    pause,
    resume,
    toggle,
    stop,
    seek,
    seekPercent,
    setVolume: setVolumeLevel,

    // Helpers
    isTrackPlaying,
    isCurrentTrack,

    // Direct audio element ref (for advanced use)
    audioRef,
  };
}

// Re-export formatTime from shared utility for backwards compatibility
export { formatTime } from '../utils/timeFormat';

/**
 * Calculate progress percentage
 * @param {number} currentTime - Current playback time
 * @param {number} duration - Total duration
 * @returns {number} Progress percentage (0-100)
 */
export function calculateProgress(currentTime, duration) {
  if (!duration || duration === 0) return 0;
  return (currentTime / duration) * 100;
}

export default useAudioPlayer;
