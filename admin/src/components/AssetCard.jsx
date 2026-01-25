/**
 * AssetCard - Individual asset card for grid display
 * Shows thumbnail, status badge, ID, and selection checkbox
 */

import { useState, memo } from 'react';
import { CheckIcon, ImageIcon } from '@radix-ui/react-icons';

/**
 * Get the subcategory for an asset (handles different field names)
 */
function getAssetSubcategory(asset, category) {
  // Different categories use different field names
  if (category === 'tiles') {
    return asset._tileCategory;
  }
  if (category === 'items') {
    return asset._itemCategory || asset._subcategory || asset.subcategory;
  }
  if (category === 'icons') {
    return asset._iconCategory || asset._subcategory || asset.subcategory;
  }
  if (category === 'portraits') {
    return asset._type || asset.type;
  }
  if (category === 'overlays') {
    return asset._overlayCategory || asset._subcategory || asset.subcategory;
  }
  return asset._subcategory || asset.subcategory;
}

/**
 * Get the image URL for an asset based on category and metadata
 */
function getAssetImageUrl(asset, category) {
  const id = asset.key || asset.id;

  // Build path based on category and asset metadata
  switch (category) {
    case 'tiles': {
      // Tiles are directly in the biome folder (no floors/walls/slopes subdirectory)
      const biome = asset._biome || asset.outputPath || 'base';
      return `/assets/sprites/terrain/${biome}/${asset.key}.png`;
    }
    case 'portraits': {
      // Portraits for players vs enemies
      if (asset._type === 'enemy' || asset.type === 'enemy') {
        return `/assets/sprites/enemies/portraits/${id}.png`;
      }
      return `/assets/sprites/portraits/${id}.png`;
    }
    case 'items': {
      // Items organized by subcategory with size suffix (weapons, armor, etc.)
      const subcategory = asset._itemCategory || asset._subcategory || asset.subcategory || 'weapons';
      // Items have multiple sizes (32, 48, 64) - use 64 for preview
      return `/assets/sprites/items/${subcategory}/${id}_64.png`;
    }
    case 'icons': {
      // Icons are stored as: /assets/icons/png/{size}/{subcategory}-{id}.png
      // Example: /assets/icons/png/48/actions-action_attack.png
      const subcategory = asset._iconCategory || asset._subcategory || asset.subcategory || 'actions';
      return `/assets/icons/png/48/${subcategory}-${id}.png`;
    }
    case 'nodes': {
      return `/assets/sprites/nodes/${id}.png`;
    }
    case 'overlays': {
      const subcategory = asset._overlayCategory || asset._subcategory || asset.subcategory || 'rarity';
      return `/assets/sprites/overlays/${subcategory}/${id}.png`;
    }
    default:
      return null;
  }
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
}) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const id = asset.key || asset.id;
  const isGenerated = asset.generated === true;
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

      {/* Thumbnail container */}
      <div className="aspect-square bg-midnight-950 flex items-center justify-center overflow-hidden">
        {!imageError && imageUrl && isGenerated ? (
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
        ) : (
          // Placeholder for pending or errored images
          <div className="flex flex-col items-center justify-center text-parchment-600 p-4">
            <ImageIcon className="w-8 h-8 mb-2" />
            <span className="text-xs text-center">
              {isGenerated ? 'Image unavailable' : 'Not generated'}
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
        {/* Show type/subcategory for other categories */}
        {category !== 'tiles' && (
          <p className="text-xs text-parchment-500 truncate">
            {getAssetSubcategory(asset, category) || '-'}
          </p>
        )}
      </div>
    </div>
  );
});

export default AssetCard;
