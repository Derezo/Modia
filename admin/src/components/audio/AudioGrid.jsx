/**
 * AudioGrid - Grid display for audio assets (music or sfx)
 * Follows pattern from AssetGrid.jsx for image assets.
 *
 * @module AudioGrid
 * @description Main component for displaying and managing audio assets with filtering,
 * bulk selection, and generation capabilities.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  RocketIcon,
  Cross2Icon,
  ReloadIcon,
  ExclamationTriangleIcon,
  SpeakerLoudIcon,
} from '@radix-ui/react-icons';

import AudioCard from './AudioCard';
import AudioDetail from './AudioDetail';
import AudioFilterBar from './AudioFilterBar';
import PollingStatusCard from './PollingStatusCard';
import { useAudioAssets } from '../../hooks/useAudioAssets';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';

/**
 * Bulk action bar component
 */
function BulkActionBar({ selectedCount, onGenerate, onClearSelection, loading }) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="card px-6 py-4 flex items-center gap-4 shadow-lg border border-accent-gold/30">
        <span className="text-parchment-200 font-medium">
          {selectedCount} selected
        </span>

        <div className="w-px h-6 bg-midnight-600" />

        <button
          type="button"
          onClick={onGenerate}
          disabled={loading}
          className="btn-gold flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <ReloadIcon className="w-4 h-4 animate-spin" />
          ) : (
            <RocketIcon className="w-4 h-4" />
          )}
          Generate Selected
        </button>

        <button
          type="button"
          onClick={onClearSelection}
          className="btn-ghost flex items-center gap-2"
        >
          <Cross2Icon className="w-4 h-4" />
          Clear
        </button>
      </div>
    </div>
  );
}

/**
 * Empty state component
 */
function EmptyState({ hasFilters, onClearFilters }) {
  return (
    <div className="card p-12 text-center">
      <ExclamationTriangleIcon className="w-12 h-12 text-parchment-500 mx-auto mb-4" />
      <h3 className="text-lg font-display font-semibold text-parchment-200 mb-2">
        No audio assets found
      </h3>
      <p className="text-parchment-400 mb-4">
        {hasFilters
          ? 'Try adjusting your filters to see more results.'
          : 'No audio assets are available in this category.'}
      </p>
      {hasFilters && (
        <button type="button" onClick={onClearFilters} className="btn-ghost">
          Clear Filters
        </button>
      )}
    </div>
  );
}

/**
 * Loading skeleton component for audio grid
 */
function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="card overflow-hidden animate-pulse">
          <div className="aspect-video bg-midnight-800" />
          <div className="p-2 border-t border-midnight-700">
            <div className="h-4 bg-midnight-800 rounded w-3/4 mb-1" />
            <div className="h-3 bg-midnight-800 rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Main AudioGrid component
 *
 * @param {Object} props - Component props
 * @param {string} props.audioType - 'music' or 'sfx'
 * @param {string} props.pageTitle - Page title text
 * @param {string} props.pageDescription - Page description text
 * @param {boolean} [props.showVariants] - Show variant selector for music tracks
 * @param {boolean} [props.showPollingStatus] - Show polling status cards for pending tracks
 */
export default function AudioGrid({
  audioType,
  pageTitle,
  pageDescription,
  showVariants = false,
  showPollingStatus = false,
}) {
  // Toast notifications
  const toast = useToast();

  // Filter state
  const [filters, setFilters] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [actionLoading, setActionLoading] = useState(false);

  // Detail panel state
  const [detailAsset, setDetailAsset] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Audio playback state
  const [currentlyPlaying, setCurrentlyPlaying] = useState(null);
  const [playProgress, setPlayProgress] = useState(0);
  const audioRef = useRef(null);

  // Refs
  const closeTimeoutRef = useRef(null);
  const refetchTimeoutRef = useRef(null);
  const searchInputRef = useRef(null);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
      if (refetchTimeoutRef.current) clearTimeout(refetchTimeoutRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Fetch audio assets
  const { data, loading, error, refetch } = useAudioAssets(audioType, filters);

  // Filter assets by search query (client-side)
  const filteredAssets = useMemo(() => {
    if (!data?.assets) return [];
    if (!searchQuery) return data.assets;

    const query = searchQuery.toLowerCase();
    return data.assets.filter((asset) => {
      const id = (asset.key || asset.id || '').toLowerCase();
      return id.includes(query);
    });
  }, [data?.assets, searchQuery]);

  // Separate pending (with taskId) and generated assets for music
  const { pendingAssets, displayAssets } = useMemo(() => {
    if (!showPollingStatus) {
      return { pendingAssets: [], displayAssets: filteredAssets };
    }

    const pending = filteredAssets.filter((a) => a.taskId && !a.generated);
    const display = filteredAssets.filter((a) => !a.taskId || a.generated);
    return { pendingAssets: pending, displayAssets: display };
  }, [filteredAssets, showPollingStatus]);

  // Build summary for filter bar
  const summary = useMemo(() => {
    if (!data?.assets) return null;
    const total = data.assets.length;
    const generated = data.assets.filter((a) => a.generated).length;
    const pending = total - generated;
    return { total, generated, pending };
  }, [data?.assets]);

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return searchQuery || Object.values(filters).some(Boolean);
  }, [searchQuery, filters]);

  /**
   * Handle filter changes
   */
  const handleFilterChange = useCallback((newFilters) => {
    setFilters(newFilters);
    setSelectedIds(new Set()); // Clear selection on filter change
  }, []);

  /**
   * Handle search change
   */
  const handleSearchChange = useCallback((query) => {
    setSearchQuery(query);
  }, []);

  /**
   * Handle asset selection
   */
  const handleSelect = useCallback((id, selected) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  /**
   * Clear all selections
   */
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  /**
   * Clear all filters
   */
  const clearFilters = useCallback(() => {
    setFilters({});
    setSearchQuery('');
  }, []);

  /**
   * Handle audio playback toggle
   */
  const handlePlayToggle = useCallback((asset) => {
    const assetId = asset.key || asset.id;

    // If currently playing this asset, pause it
    if (currentlyPlaying === assetId) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setCurrentlyPlaying(null);
      setPlayProgress(0);
      return;
    }

    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
    }

    // Get audio URL - use path from metadata first, fallback with correct /assets prefix
    const audioUrl = asset.audioUrl || asset.path || `/assets/audio/${audioType}/${asset.key || asset.id}.mp3`;

    // Create new audio element
    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    // Set up event handlers
    audio.addEventListener('timeupdate', () => {
      if (audio.duration) {
        setPlayProgress(audio.currentTime / audio.duration);
      }
    });

    audio.addEventListener('ended', () => {
      setCurrentlyPlaying(null);
      setPlayProgress(0);
    });

    audio.addEventListener('error', () => {
      toast.error('Failed to play audio');
      setCurrentlyPlaying(null);
      setPlayProgress(0);
    });

    // Start playback
    audio.play().then(() => {
      setCurrentlyPlaying(assetId);
    }).catch(() => {
      toast.error('Failed to play audio');
    });
  }, [audioType, currentlyPlaying, toast]);

  /**
   * Handle asset click - opens the detail panel
   */
  const handleAssetClick = useCallback((asset) => {
    setDetailAsset(asset);
    setDetailOpen(true);
  }, []);

  /**
   * Close detail panel
   */
  const handleDetailClose = useCallback(() => {
    setDetailOpen(false);
    // Delay clearing asset to allow close animation
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = setTimeout(() => setDetailAsset(null), 300);
  }, []);

  /**
   * Handle asset update from detail panel
   */
  const handleDetailUpdate = useCallback(() => {
    // Refetch to get updated data
    refetch();
  }, [refetch]);

  /**
   * Generate selected assets
   */
  const handleGenerateSelected = useCallback(async () => {
    if (selectedIds.size === 0) {
      toast.info('No assets selected');
      return;
    }

    setActionLoading(true);

    try {
      const selectedAssetIds = Array.from(selectedIds);

      // Check how many are already generated (for messaging)
      const alreadyGenerated = displayAssets.filter(
        (a) => selectedIds.has(a.key || a.id) && a.generated
      ).length;

      // Build filters for selected keys
      await api.generateAudio(audioType, { keys: selectedAssetIds }, { force: true });

      const message = alreadyGenerated > 0
        ? `Queued ${selectedAssetIds.length} audio asset(s) for (re)generation`
        : `Generation queued for ${selectedAssetIds.length} audio asset(s)`;
      toast.success(message);

      // Clear selection after queueing
      clearSelection();

      // Refresh after a delay to show updated status
      if (refetchTimeoutRef.current) clearTimeout(refetchTimeoutRef.current);
      refetchTimeoutRef.current = setTimeout(() => {
        refetch();
      }, 2000);
    } catch (err) {
      toast.error(err.message || 'Failed to queue generation');
    } finally {
      setActionLoading(false);
    }
  }, [selectedIds, displayAssets, audioType, clearSelection, refetch, toast]);

  /**
   * Select/deselect all visible assets
   */
  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === displayAssets.length) {
      // Deselect all
      setSelectedIds(new Set());
    } else {
      // Select all
      const allIds = new Set(displayAssets.map((a) => a.key || a.id));
      setSelectedIds(allIds);
    }
  }, [selectedIds.size, displayAssets]);

  /**
   * Focus search input
   */
  const handleFocusSearch = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  /**
   * Handle escape key - close detail or clear selection
   */
  const handleEscape = useCallback(() => {
    if (detailOpen) {
      handleDetailClose();
    } else if (selectedIds.size > 0) {
      clearSelection();
    }
  }, [detailOpen, selectedIds.size, handleDetailClose, clearSelection]);

  /**
   * Edit first selected asset
   */
  const handleEdit = useCallback(() => {
    if (selectedIds.size === 0) return;

    // Find first selected asset
    const firstSelectedId = Array.from(selectedIds)[0];
    const asset = displayAssets.find((a) => (a.key || a.id) === firstSelectedId);
    if (asset) {
      handleAssetClick(asset);
    }
  }, [selectedIds, displayAssets, handleAssetClick]);

  // Register keyboard shortcuts
  useKeyboardShortcuts({
    onGenerate: handleGenerateSelected,
    onSelectAll: handleSelectAll,
    onEdit: handleEdit,
    onEscape: handleEscape,
    onFocusSearch: handleFocusSearch,
  });

  return (
    <div className="p-6 max-w-7xl mx-auto pb-24">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-midnight-800 rounded-lg">
          <SpeakerLoudIcon className="w-6 h-6 text-accent-gold" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-display font-bold text-parchment-100">
            {pageTitle}
          </h1>
          <p className="text-parchment-400">{pageDescription}</p>
        </div>

        {/* Select all button */}
        {displayAssets.length > 0 && (
          <button
            type="button"
            onClick={handleSelectAll}
            className="btn-ghost text-sm"
          >
            {selectedIds.size === displayAssets.length ? 'Deselect All' : 'Select All'}
          </button>
        )}
      </div>

      {/* Filter bar */}
      <AudioFilterBar
        ref={searchInputRef}
        audioType={audioType}
        filters={filters}
        onFilterChange={handleFilterChange}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        onRefresh={refetch}
        loading={loading}
        summary={summary}
      />

      {/* Error state */}
      {error && (
        <div className="card p-6 text-center mb-6">
          <ExclamationTriangleIcon className="w-8 h-8 text-accent-ruby mx-auto mb-2" />
          <p className="text-parchment-300 mb-4">{error}</p>
          <button type="button" onClick={refetch} className="btn-ghost">
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && !data && <LoadingSkeleton />}

      {/* Empty state */}
      {!loading && !error && filteredAssets.length === 0 && (
        <EmptyState hasFilters={hasActiveFilters} onClearFilters={clearFilters} />
      )}

      {/* Pending generation cards (music with taskId) */}
      {showPollingStatus && pendingAssets.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-display font-semibold text-parchment-200 mb-3">
            Generating...
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {pendingAssets.map((asset) => (
              <PollingStatusCard
                key={asset.key || asset.id}
                taskId={asset.taskId}
                status={asset.status || asset.taskStatus || 'pending'}
                statusMessage={asset.statusMessage}
                startedAt={asset.generationStarted}
                trackKey={asset.key || asset.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Audio asset grid */}
      {!loading && displayAssets.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {displayAssets.map((asset) => {
            const id = asset.key || asset.id;
            return (
              <AudioCard
                key={id}
                asset={asset}
                audioType={audioType}
                selected={selectedIds.has(id)}
                onSelect={handleSelect}
                onClick={handleAssetClick}
                isCurrentlyPlaying={currentlyPlaying === id}
                onPlayToggle={handlePlayToggle}
                playProgress={playProgress}
              />
            );
          })}
        </div>
      )}

      {/* Results count */}
      {!loading && displayAssets.length > 0 && (
        <div className="mt-6 text-center text-sm text-parchment-500">
          Showing {displayAssets.length} of {data?.assets?.length || 0} audio assets
        </div>
      )}

      {/* Bulk action bar */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        onGenerate={handleGenerateSelected}
        onClearSelection={clearSelection}
        loading={actionLoading}
      />

      {/* Audio detail slide-over panel */}
      <AudioDetail
        asset={detailAsset}
        audioType={audioType}
        open={detailOpen}
        onClose={handleDetailClose}
        onUpdate={handleDetailUpdate}
        showVariants={showVariants}
      />
    </div>
  );
}
