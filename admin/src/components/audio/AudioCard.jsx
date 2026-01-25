/**
 * AudioCard - Grid card component for audio asset display
 * Shows waveform thumbnail, play button overlay, status badge, and selection checkbox.
 *
 * @module AudioCard
 * @description Individual audio asset card for use in AudioGrid layouts.
 */

import { useState, useCallback, memo } from 'react';
import { CheckIcon, PlayIcon, PauseIcon, SpeakerLoudIcon } from '@radix-ui/react-icons';
import WaveformDisplay from './WaveformDisplay';
import { formatDuration } from '../../utils/timeFormat';
import { useWaveform } from '../../hooks/useWaveform';

/**
 * Get audio file URL from asset metadata
 */
function getAudioUrl(asset) {
  if (asset.audioUrl) return asset.audioUrl;
  if (asset.filePath) return `/audio/${asset.filePath}`;
  if (asset.key) {
    const category = asset._category || 'music';
    return `/audio/${category}/${asset.key}.mp3`;
  }
  return null;
}

/**
 * Get display label for audio category
 */
function getCategoryLabel(asset) {
  if (asset._subcategory) {
    return asset._subcategory.replace(/_/g, ' ');
  }
  if (asset._category) {
    return asset._category;
  }
  return 'audio';
}

/**
 * Memoized AudioCard to prevent re-renders when other cards change
 */
const AudioCard = memo(function AudioCard({
  asset,
  audioType = 'sfx',
  selected = false,
  onSelect,
  onClick,
  isCurrentlyPlaying = false,
  onPlayToggle,
  playProgress = 0,
}) {
  const [isHovered, setIsHovered] = useState(false);

  const id = asset.key || asset.id;
  const isGenerated = asset.generated === true;
  const audioUrl = getAudioUrl(asset);
  const duration = asset.duration;

  // Fetch waveform data for generated assets
  const { waveform: fetchedWaveform } = useWaveform(audioType, id, isGenerated);
  const peaks = fetchedWaveform || asset.peaks || asset.waveform || [];

  /**
   * Handle checkbox click without triggering card click
   */
  const handleCheckboxClick = (e) => {
    e.stopPropagation();
    onSelect?.(id, !selected);
  };

  /**
   * Handle play button click
   */
  const handlePlayClick = useCallback((e) => {
    e.stopPropagation();
    onPlayToggle?.(asset);
  }, [asset, onPlayToggle]);

  /**
   * Handle card click to open detail panel
   */
  const handleCardClick = () => {
    onClick?.(asset);
  };

  /**
   * Handle keyboard navigation
   */
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        relative group cursor-pointer rounded-lg overflow-hidden
        transition-all duration-200
        ${selected
          ? 'ring-2 ring-accent-gold bg-midnight-800'
          : 'bg-midnight-900 border border-midnight-700 hover:border-midnight-600 hover:bg-midnight-850'}
      `}
    >
      {/* Selection checkbox */}
      <div
        className="absolute top-2 left-2 z-10"
        onClick={handleCheckboxClick}
        role="checkbox"
        aria-checked={selected}
        tabIndex={-1}
      >
        <div
          className={`
            w-5 h-5 rounded border-2 flex items-center justify-center
            transition-colors cursor-pointer
            ${selected
              ? 'bg-accent-gold border-accent-gold'
              : 'bg-midnight-900/80 border-midnight-500 group-hover:border-midnight-400'}
          `}
        >
          {selected && <CheckIcon className="w-3 h-3 text-midnight-950" />}
        </div>
      </div>

      {/* Status badge */}
      <div className="absolute top-2 right-2 z-10">
        <div
          className={`
            w-3 h-3 rounded-full border-2 border-midnight-900
            ${isGenerated ? 'bg-accent-emerald' : 'bg-accent-gold'}
          `}
          title={isGenerated ? 'Generated' : 'Pending'}
        />
      </div>

      {/* Waveform thumbnail container */}
      <div className="aspect-video bg-midnight-950 flex items-center justify-center p-3 relative">
        {isGenerated && peaks.length > 0 ? (
          <WaveformDisplay
            peaks={peaks}
            progress={isCurrentlyPlaying ? playProgress : 0}
            height={60}
            showProgress={isCurrentlyPlaying}
          />
        ) : (
          // Placeholder waveform for pending assets
          <WaveformDisplay
            peaks={[]}
            height={60}
            showProgress={false}
            colors={{
              waveform: '#3d3d4f', // midnight-700
            }}
          />
        )}

        {/* Play button overlay */}
        {isGenerated && audioUrl && (isHovered || isCurrentlyPlaying) && (
          <button
            type="button"
            onClick={handlePlayClick}
            className={`
              absolute inset-0 flex items-center justify-center
              bg-midnight-950/60 transition-opacity
              ${isHovered || isCurrentlyPlaying ? 'opacity-100' : 'opacity-0'}
            `}
            aria-label={isCurrentlyPlaying ? 'Pause' : 'Play'}
          >
            <div className="w-12 h-12 rounded-full bg-accent-gold flex items-center justify-center hover:scale-110 transition-transform">
              {isCurrentlyPlaying ? (
                <PauseIcon className="w-6 h-6 text-midnight-950" />
              ) : (
                <PlayIcon className="w-6 h-6 text-midnight-950 ml-0.5" />
              )}
            </div>
          </button>
        )}

        {/* Duration badge */}
        {duration && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-midnight-900/90 rounded text-xs text-parchment-300 font-mono">
            {formatDuration(duration)}
          </div>
        )}
      </div>

      {/* Asset info */}
      <div className="p-2 border-t border-midnight-700">
        <div className="flex items-center gap-2">
          <SpeakerLoudIcon className="w-3 h-3 text-parchment-500 flex-shrink-0" />
          <p
            className="text-sm text-parchment-300 truncate font-mono flex-1"
            title={id}
          >
            {id}
          </p>
        </div>
        <p className="text-xs text-parchment-500 truncate capitalize mt-0.5">
          {getCategoryLabel(asset)}
        </p>
      </div>
    </div>
  );
});

export default AudioCard;
