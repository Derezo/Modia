/**
 * VariantSelector - Component for selecting primary audio variant
 * Suno generates 2 variants per request; this allows selection of the primary one.
 *
 * @module VariantSelector
 * @description Lists audio variants with preview playback and selection controls.
 */

import { useState, useRef, useCallback } from 'react';
import { PlayIcon, PauseIcon, CheckCircledIcon, CircleIcon } from '@radix-ui/react-icons';
import { formatDuration } from '../../utils/timeFormat';

/**
 * VariantSelector component for music track variants
 *
 * @param {Object} props - Component props
 * @param {Object[]} props.variants - Array of variant objects with id, url, duration
 * @param {string} props.selectedId - Currently selected variant ID
 * @param {Function} props.onSelect - Callback when variant is selected
 * @param {string} [props.className] - Additional CSS classes
 */
export default function VariantSelector({
  variants = [],
  selectedId,
  onSelect,
  className = '',
}) {
  const [playingId, setPlayingId] = useState(null);
  const audioRefs = useRef({});

  /**
   * Handle play/pause toggle for a variant
   */
  const handlePlayToggle = useCallback((variant) => {
    const audio = audioRefs.current[variant.id];

    // Pause any currently playing audio
    Object.entries(audioRefs.current).forEach(([id, audioEl]) => {
      if (id !== variant.id && audioEl) {
        audioEl.pause();
        audioEl.currentTime = 0;
      }
    });

    if (!audio) return;

    if (playingId === variant.id) {
      audio.pause();
      setPlayingId(null);
    } else {
      audio.play().catch(() => {
        setPlayingId(null);
      });
      setPlayingId(variant.id);
    }
  }, [playingId]);

  /**
   * Handle audio ended event
   */
  const handleEnded = useCallback(() => {
    setPlayingId(null);
  }, []);

  /**
   * Handle variant selection
   */
  const handleSelect = useCallback((variant) => {
    onSelect?.(variant.id);
  }, [onSelect]);

  if (variants.length === 0) {
    return (
      <div className={`text-parchment-500 text-sm ${className}`}>
        No variants available
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <h4 className="text-sm font-medium text-parchment-300 mb-3">
        Select Primary Variant
      </h4>

      {variants.map((variant, index) => {
        const isSelected = variant.id === selectedId;
        const isPlaying = variant.id === playingId;

        return (
          <div
            key={variant.id}
            className={`
              flex items-center gap-3 p-3 rounded-lg
              transition-colors cursor-pointer
              ${isSelected
                ? 'bg-accent-gold/10 border border-accent-gold/30'
                : 'bg-midnight-800 border border-midnight-700 hover:border-midnight-600'}
            `}
            onClick={() => handleSelect(variant)}
            role="radio"
            aria-checked={isSelected}
            tabIndex={0}
          >
            {/* Hidden audio element */}
            <audio
              ref={(el) => { audioRefs.current[variant.id] = el; }}
              src={variant.url}
              preload="metadata"
              onEnded={handleEnded}
            />

            {/* Selection indicator */}
            <div className="flex-shrink-0">
              {isSelected ? (
                <CheckCircledIcon className="w-5 h-5 text-accent-gold" />
              ) : (
                <CircleIcon className="w-5 h-5 text-parchment-500" />
              )}
            </div>

            {/* Variant info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-parchment-200 font-medium">
                Variant {index + 1}
              </p>
              <p className="text-xs text-parchment-500 truncate">
                {variant.filename || variant.id}
              </p>
            </div>

            {/* Duration */}
            <span className="text-xs text-parchment-400 font-mono">
              {formatDuration(variant.duration)}
            </span>

            {/* Play button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePlayToggle(variant);
              }}
              className={`
                flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center
                transition-colors
                ${isPlaying
                  ? 'bg-accent-emerald text-midnight-950'
                  : 'bg-midnight-700 text-parchment-300 hover:bg-midnight-600'}
              `}
              aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
            >
              {isPlaying ? (
                <PauseIcon className="w-4 h-4" />
              ) : (
                <PlayIcon className="w-4 h-4 ml-0.5" />
              )}
            </button>
          </div>
        );
      })}

      {selectedId && (
        <p className="text-xs text-parchment-500 mt-2">
          The selected variant will be used as the primary audio file.
        </p>
      )}
    </div>
  );
}
