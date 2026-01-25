/**
 * AssetPreviewCard - Unified preview card for images and audio assets
 *
 * Displays:
 * - Image: Thumbnail preview with filename
 * - Audio: Mini waveform with play button and duration
 */

import { useState, useRef, useMemo, memo } from 'react';
import {
  ImageIcon,
  SpeakerLoudIcon,
  MixerVerticalIcon,
  PlayIcon,
  PauseIcon,
  CheckCircledIcon,
} from '@radix-ui/react-icons';

import WaveformDisplay from './audio/WaveformDisplay';

// Type colors
const TYPE_COLORS = {
  image: 'text-blue-400',
  music: 'text-purple-400',
  sfx: 'text-orange-400',
};

const TYPE_BG_COLORS = {
  image: 'bg-blue-500/20',
  music: 'bg-purple-500/20',
  sfx: 'bg-orange-500/20',
};

/**
 * Format image path for display as URL
 */
function getImageUrl(imagePath) {
  if (!imagePath) return null;

  // Convert file path to URL
  if (imagePath.includes('frontend/public')) {
    return imagePath.replace('frontend/public', '');
  }
  // Already a relative path
  if (imagePath.startsWith('/assets')) {
    return imagePath;
  }
  // Try to construct path
  return `/assets/${imagePath.split('assets/').pop() || imagePath}`;
}

/**
 * Format audio path for display as URL
 * Handles paths like /assets/audio/music/regions/track.mp3
 */
function getAudioUrl(audioPath) {
  if (!audioPath) return null;

  // Convert file path to URL
  if (audioPath.includes('frontend/public')) {
    return audioPath.replace('frontend/public', '');
  }
  // Already a web path with /assets prefix
  if (audioPath.startsWith('/assets/')) {
    return audioPath;
  }
  // Legacy path starting with /audio (add /assets prefix)
  if (audioPath.startsWith('/audio')) {
    return '/assets' + audioPath;
  }
  // Try to construct path from audio directory
  if (audioPath.includes('/audio/')) {
    return '/assets/audio/' + audioPath.split('/audio/').pop();
  }
  return audioPath;
}

/**
 * Get filename from path
 */
function getFilename(path) {
  if (!path) return 'Unknown';
  return path.split('/').pop() || path;
}

/**
 * Image preview card
 */
const ImagePreviewCard = memo(function ImagePreviewCard({ asset }) {
  const [imageError, setImageError] = useState(false);
  const imageUrl = getImageUrl(asset.path);

  return (
    <div className="group relative aspect-square bg-midnight-800 rounded-lg overflow-hidden border border-midnight-700 hover:border-blue-500/50 transition-colors">
      {!imageError && imageUrl ? (
        <img
          src={imageUrl}
          alt={getFilename(asset.path)}
          className="w-full h-full object-contain"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className="flex items-center justify-center w-full h-full text-parchment-500">
          <ImageIcon className="w-8 h-8" />
        </div>
      )}

      {/* Overlay with filename */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-midnight-950/90 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-xs text-parchment-300 truncate">
          {getFilename(asset.path)}
        </p>
      </div>

      {/* Type badge */}
      <div className="absolute top-1 left-1">
        <div className={`p-1 rounded ${TYPE_BG_COLORS.image}`}>
          <ImageIcon className={`w-3 h-3 ${TYPE_COLORS.image}`} />
        </div>
      </div>

      {/* New badge */}
      <div className="absolute top-1 right-1">
        <CheckCircledIcon className="w-4 h-4 text-accent-emerald" />
      </div>
    </div>
  );
});

/**
 * Audio preview card with waveform and playback
 */
const AudioPreviewCard = memo(function AudioPreviewCard({ asset }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioError, setAudioError] = useState(false);

  const audioUrl = getAudioUrl(asset.path);
  const isMusic = asset.type === 'music';
  const Icon = isMusic ? SpeakerLoudIcon : MixerVerticalIcon;
  const colorClass = isMusic ? TYPE_COLORS.music : TYPE_COLORS.sfx;
  const bgColorClass = isMusic ? TYPE_BG_COLORS.music : TYPE_BG_COLORS.sfx;
  const borderColorClass = isMusic ? 'hover:border-purple-500/50' : 'hover:border-orange-500/50';

  // Handle play/pause toggle
  const togglePlayback = () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  // Handle time update
  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const current = audioRef.current.currentTime;
    const total = audioRef.current.duration;
    if (total > 0) {
      setProgress(current / total);
    }
  };

  // Handle loaded metadata
  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    setDuration(audioRef.current.duration);
  };

  // Handle ended
  const handleEnded = () => {
    setIsPlaying(false);
    setProgress(0);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  };

  // Format duration
  const formattedDuration = useMemo(() => {
    if (!duration || isNaN(duration)) return '--:--';
    const mins = Math.floor(duration / 60);
    const secs = Math.floor(duration % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, [duration]);

  return (
    <div className={`group relative bg-midnight-800 rounded-lg overflow-hidden border border-midnight-700 ${borderColorClass} transition-colors`}>
      {/* Audio element */}
      {audioUrl && !audioError && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          onError={() => setAudioError(true)}
          preload="metadata"
        />
      )}

      {/* Content */}
      <div className="p-2">
        {/* Waveform or placeholder */}
        <div className="mb-2 h-10 flex items-center justify-center">
          {asset.peaks && asset.peaks.length > 0 ? (
            <WaveformDisplay
              peaks={asset.peaks}
              progress={progress}
              height={40}
              showProgress={isPlaying || progress > 0}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-parchment-600">
              <WaveformDisplay
                peaks={[]}
                progress={progress}
                height={40}
                showProgress={isPlaying || progress > 0}
              />
            </div>
          )}
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between">
          {/* Play button */}
          <button
            onClick={togglePlayback}
            disabled={audioError}
            className={`p-1.5 rounded-full ${bgColorClass} ${colorClass} hover:opacity-80 transition-opacity ${audioError ? 'opacity-30 cursor-not-allowed' : ''}`}
          >
            {isPlaying ? (
              <PauseIcon className="w-4 h-4" />
            ) : (
              <PlayIcon className="w-4 h-4" />
            )}
          </button>

          {/* Duration */}
          <span className="text-xs text-parchment-500">{formattedDuration}</span>

          {/* Type badge */}
          <div className={`p-1 rounded ${bgColorClass}`}>
            <Icon className={`w-3 h-3 ${colorClass}`} />
          </div>
        </div>

        {/* Filename */}
        <p className="text-xs text-parchment-400 truncate mt-1">
          {getFilename(asset.path)}
        </p>
      </div>

      {/* New badge */}
      <div className="absolute top-1 right-1">
        <CheckCircledIcon className="w-4 h-4 text-accent-emerald" />
      </div>
    </div>
  );
});

/**
 * Main AssetPreviewCard component
 * Routes to appropriate preview based on asset type
 */
const AssetPreviewCard = memo(function AssetPreviewCard({ asset }) {
  if (!asset || !asset.path) {
    return null;
  }

  if (asset.type === 'image') {
    return <ImagePreviewCard asset={asset} />;
  }

  if (asset.type === 'music' || asset.type === 'sfx') {
    return <AudioPreviewCard asset={asset} />;
  }

  // Unknown type - show generic card
  return (
    <div className="aspect-square bg-midnight-800 rounded-lg border border-midnight-700 flex items-center justify-center">
      <div className="text-center text-parchment-500">
        <span className="text-xs">{asset.type || 'Unknown'}</span>
      </div>
    </div>
  );
});

export default AssetPreviewCard;
