/**
 * AudioPlayer - Audio playback controls component
 * Provides play/pause, seek bar, and time display using HTML5 Audio element.
 *
 * @module AudioPlayer
 * @description Reusable audio playback controls for music tracks and SFX.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { PlayIcon, PauseIcon, SpeakerLoudIcon, SpeakerOffIcon } from '@radix-ui/react-icons';
import { formatTime } from '../../utils/timeFormat';

/**
 * AudioPlayer component with playback controls
 *
 * @param {Object} props - Component props
 * @param {string} props.src - Audio file URL
 * @param {string} [props.className] - Additional CSS classes
 * @param {Function} [props.onPlay] - Callback when playback starts
 * @param {Function} [props.onPause] - Callback when playback pauses
 * @param {Function} [props.onEnded] - Callback when playback ends
 * @param {Function} [props.onTimeUpdate] - Callback with current time/duration
 * @param {boolean} [props.compact=false] - Use compact layout
 */
export default function AudioPlayer({
  src,
  className = '',
  onPlay,
  onPause,
  onEnded,
  onTimeUpdate,
  compact = false,
}) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  /**
   * Handle play/pause toggle
   */
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {
        // Handle autoplay restrictions
        setIsPlaying(false);
      });
    }
  }, [isPlaying]);

  /**
   * Handle seek bar interaction
   */
  const handleSeek = useCallback((e) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    audio.currentTime = percent * duration;
  }, [duration]);

  /**
   * Toggle mute state
   */
  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setIsMuted(!audio.muted);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => {
      setIsPlaying(true);
      onPlay?.();
    };
    const handlePause = () => {
      setIsPlaying(false);
      onPause?.();
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      onEnded?.();
    };
    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      onTimeUpdate?.(audio.currentTime, audio.duration);
    };
    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [onPlay, onPause, onEnded, onTimeUpdate]);

  // Reset state when src changes
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Hidden audio element */}
      <audio ref={audioRef} src={src} preload="metadata" />

      {/* Play/Pause button */}
      <button
        type="button"
        onClick={togglePlay}
        disabled={!src}
        className={`
          flex items-center justify-center rounded-full
          transition-colors disabled:opacity-50 disabled:cursor-not-allowed
          ${compact
            ? 'w-8 h-8 bg-accent-gold text-midnight-950 hover:bg-accent-gold/90'
            : 'w-10 h-10 bg-accent-gold text-midnight-950 hover:bg-accent-gold/90'}
        `}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? (
          <PauseIcon className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
        ) : (
          <PlayIcon className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
        )}
      </button>

      {/* Progress bar and time */}
      <div className="flex-1 flex items-center gap-2">
        {/* Current time */}
        <span className="text-xs text-parchment-400 font-mono min-w-[32px]">
          {formatTime(currentTime)}
        </span>

        {/* Seek bar */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={currentTime}
          onClick={handleSeek}
          className="flex-1 h-2 bg-midnight-700 rounded-full cursor-pointer group"
        >
          <div
            className="h-full bg-accent-gold rounded-full relative transition-all"
            style={{ width: `${progress}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-parchment-100 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Duration */}
        <span className="text-xs text-parchment-400 font-mono min-w-[32px]">
          {formatTime(duration)}
        </span>
      </div>

      {/* Mute button (non-compact only) */}
      {!compact && (
        <button
          type="button"
          onClick={toggleMute}
          className="p-2 text-parchment-400 hover:text-parchment-200 transition-colors"
          aria-label={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? (
            <SpeakerOffIcon className="w-4 h-4" />
          ) : (
            <SpeakerLoudIcon className="w-4 h-4" />
          )}
        </button>
      )}
    </div>
  );
}
