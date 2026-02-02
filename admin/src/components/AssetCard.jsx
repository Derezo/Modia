/**
 * AssetCard - Individual asset card for grid display
 * Shows thumbnail, state badge, ID, and selection checkbox
 *
 * State badges indicate asset lifecycle:
 * - Pending: Not yet generated (yellow)
 * - Marked: Flagged for regeneration (orange)
 * - Queued: In generation queue (blue)
 * - Generating: Currently being generated (green, animated)
 * - Generated: Complete and up-to-date (emerald)
 *
 * For character assets, also shows animation status indicators.
 */

import { useState, memo, useCallback } from 'react';
import { CheckIcon, ImageIcon, ReloadIcon, BookmarkIcon, CopyIcon } from '@radix-ui/react-icons';
import { CHARACTER_ANIMATIONS } from '@shared/assetPaths.js';
import { getAssetImageUrl, getAssetSubcategory } from '../lib/assetPathHelper.js';
import SpritePreview from './SpritePreview.jsx';

/**
 * Determine the current state of an asset based on its properties and queue status
 * @param {Object} asset - The asset object
 * @param {Set} queuedIds - Set of asset IDs currently in the generation queue
 * @param {string|null} generatingId - ID of the asset currently being generated
 * @returns {'generating'|'queued'|'marked'|'pending'|'generated'}
 */
export function getAssetState(asset, queuedIds = new Set(), generatingId = null) {
  const id = asset.key || asset.id;
  if (generatingId === id) return 'generating';
  if (queuedIds.has(id)) return 'queued';
  if (asset.needsRegeneration) return 'marked';
  if (!asset.generated) return 'pending';
  return 'generated';
}

/**
 * Badge configuration for each asset state
 */
const STATE_BADGE_CONFIG = {
  pending: {
    label: 'Pending',
    className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  },
  marked: {
    label: 'Marked',
    className: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  },
  queued: {
    label: 'Queued',
    className: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  },
  generating: {
    label: 'Generating',
    className: 'bg-green-500/20 text-green-400 border-green-500/30 animate-pulse',
  },
  generated: {
    label: 'Generated',
    className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  },
};

/**
 * AssetStateBadge - Displays a pill badge indicating asset state
 */
export function AssetStateBadge({ state }) {
  const config = STATE_BADGE_CONFIG[state];
  if (!config) return null;

  return (
    <span
      className={`
        inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium
        border ${config.className}
      `}
    >
      {config.label}
    </span>
  );
}

/**
 * Memoized to prevent re-renders when other cards' selection changes
 */
const AssetCard = memo(function AssetCard({
  asset,
  category,
  selected = false,
  onSelect,
  onClick,
  onRegenerate,
  onToggleMark,
  queuedIds = new Set(),
  generatingId = null,
}) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const id = asset.key || asset.id;
  const assetState = getAssetState(asset, queuedIds, generatingId);
  const isGenerated = assetState === 'generated';
  const isMarked = assetState === 'marked';
  const imageUrl = getAssetImageUrl(asset, category);

  /**
   * Handle checkbox click without triggering card click
   */
  const handleCheckboxClick = (e) => {
    e.stopPropagation();
    onSelect?.(id, !selected);
  };

  /**
   * Handle card click
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

  /**
   * Copy asset ID to clipboard
   */
  const copyToClipboard = useCallback(async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1500);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  }, [id]);

  /**
   * Handle regenerate click
   */
  const handleRegenerate = useCallback((e) => {
    e.stopPropagation();
    onRegenerate?.(id);
  }, [id, onRegenerate]);

  /**
   * Handle toggle mark for regeneration
   */
  const handleToggleMark = useCallback((e) => {
    e.stopPropagation();
    onToggleMark?.(id, !isMarked);
  }, [id, isMarked, onToggleMark]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
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

      {/* State badge - positioned top right */}
      <div className="absolute top-2 right-2 z-10">
        <AssetStateBadge state={assetState} />
      </div>

      {/* Quick action buttons overlay - shown on hover */}
      <div className="absolute top-10 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1">
        {onRegenerate && (
          <button
            onClick={handleRegenerate}
            className="p-1.5 bg-midnight-800/90 hover:bg-midnight-700 rounded text-parchment-400 hover:text-accent-gold transition-colors"
            title="Regenerate now"
          >
            <ReloadIcon className="w-4 h-4" />
          </button>
        )}
        {onToggleMark && (
          <button
            onClick={handleToggleMark}
            className={`p-1.5 bg-midnight-800/90 hover:bg-midnight-700 rounded transition-colors ${
              isMarked
                ? 'text-orange-400 hover:text-orange-300'
                : 'text-parchment-400 hover:text-orange-400'
            }`}
            title={isMarked ? 'Remove from queue' : 'Mark for regeneration'}
          >
            <BookmarkIcon className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={copyToClipboard}
          className={`p-1.5 bg-midnight-800/90 hover:bg-midnight-700 rounded transition-colors ${
            copyFeedback
              ? 'text-accent-emerald'
              : 'text-parchment-400 hover:text-parchment-200'
          }`}
          title={copyFeedback ? 'Copied!' : 'Copy ID'}
        >
          <CopyIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Thumbnail container */}
      <div className="aspect-square bg-midnight-950 flex items-center justify-center overflow-hidden">
        {!imageError && imageUrl && (isGenerated || asset.generated) ? (
          <>
            {/* Animated sprite preview for character sprite sheets */}
            {category === 'characters' ? (
              <SpritePreview
                src={imageUrl}
                frameWidth={64}
                frameHeight={64}
                frameCount={8}
                fps={8}
                animate={true}
                className="w-full h-full flex items-center justify-center"
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageError(true)}
              />
            ) : (
              <>
                {/* Loading placeholder */}
                {!imageLoaded && (
                  <div className="absolute inset-0 flex items-center justify-center bg-midnight-950">
                    <div className="w-8 h-8 border-2 border-midnight-600 border-t-accent-gold rounded-full animate-spin" />
                  </div>
                )}
                <img
                  src={imageUrl}
                  alt={id}
                  loading="lazy"
                  onLoad={() => setImageLoaded(true)}
                  onError={() => setImageError(true)}
                  className={`
                    w-full h-full object-contain
                    transition-opacity duration-300
                    ${imageLoaded ? 'opacity-100' : 'opacity-0'}
                  `}
                />
              </>
            )}
          </>
        ) : (
          // Placeholder for pending or errored images
          <div className="flex flex-col items-center justify-center text-parchment-600 p-4">
            <ImageIcon className="w-8 h-8 mb-2" />
            <span className="text-xs text-center">
              {asset.generated ? 'Image unavailable' : 'Not generated'}
            </span>
          </div>
        )}
      </div>

      {/* Asset ID and metadata */}
      <div className="p-2 border-t border-midnight-700">
        <p
          className="text-sm text-parchment-300 truncate font-mono"
          title={id}
        >
          {id}
        </p>
        {/* Show biome/subcategory info for tiles */}
        {category === 'tiles' && (
          <p className="text-xs text-parchment-500 truncate">
            {asset._biome || asset.outputPath} / {asset._tileCategory}
          </p>
        )}
        {/* Show animation status for character assets */}
        {category === 'characters' && asset.animations && (
          <div className="flex items-center gap-0.5 mt-1" title="Animation status">
            {CHARACTER_ANIMATIONS.map((anim) => {
              const animStatus = asset.animations?.[anim];
              const isGenerated = animStatus?.generated === true;
              const isPending = animStatus?.generated === false;
              return (
                <div
                  key={anim}
                  className={`w-2 h-2 rounded-full ${
                    isGenerated
                      ? 'bg-accent-emerald'
                      : isPending
                      ? 'bg-parchment-600'
                      : 'bg-midnight-700'
                  }`}
                  title={`${anim}: ${isGenerated ? 'generated' : 'pending'}`}
                />
              );
            })}
          </div>
        )}
        {/* Show type/subcategory for other categories (not tiles or characters with animations) */}
        {category !== 'tiles' && !(category === 'characters' && asset.animations) && (
          <p className="text-xs text-parchment-500 truncate">
            {getAssetSubcategory(asset, category) || '-'}
          </p>
        )}
      </div>
    </div>
  );
});

export default AssetCard;
