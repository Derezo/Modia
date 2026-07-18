/**
 * AssetGrid - Virtualized-like grid display for assets
 * Uses CSS grid with lazy loading for performance on large lists
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  ListBulletIcon,
  RocketIcon,
  Cross2Icon,
  ReloadIcon,
  ExclamationTriangleIcon,
  Pencil2Icon,
} from '@radix-ui/react-icons';

import AssetCard from './AssetCard';
import AssetDetail from './AssetDetail';
import FilterBar from './FilterBar';
import BulkEditModal from './BulkEditModal';
import { useAssets } from '../hooks/useAssets';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useToast } from '../contexts/ToastContext';
import { useGenerationContext } from '../contexts/GenerationContext';
import { api } from '../lib/api';
import {
  getAssetRawId,
  getAssetSelectionId,
  getSelectedAssets,
  groupTileAssetsByScope,
} from '../lib/assetIdentity';

/**
 * Bulk action bar component
 */
function BulkActionBar({
  selectedCount,
  onAddToQueue,
  onGenerateNow,
  onBulkEdit,
  onClearSelection,
  loading,
}) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50">
      <div className="card px-6 py-4 flex items-center gap-4 shadow-lg border border-accent-gold/30">
        <span className="text-parchment-200 font-medium">
          {selectedCount} selected
        </span>

        <div className="w-px h-6 bg-midnight-600" />

        <button
          type="button"
          onClick={onAddToQueue}
          disabled={loading}
          className="btn-gold flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <ReloadIcon className="w-4 h-4 animate-spin" />
          ) : (
            <ListBulletIcon className="w-4 h-4" />
          )}
          Add to Queue ({selectedCount})
        </button>

        <button
          type="button"
          onClick={onGenerateNow}
          disabled={loading}
          className="btn-ghost flex items-center gap-2 disabled:opacity-50"
          title="Skip queue and generate immediately"
        >
          <RocketIcon className="w-4 h-4" />
          Generate Now ({selectedCount})
        </button>

        <button
          type="button"
          onClick={onBulkEdit}
          disabled={loading}
          className="btn-ghost flex items-center gap-2 disabled:opacity-50"
          title="Edit metadata for selected assets"
        >
          <Pencil2Icon className="w-4 h-4" />
          Bulk Edit
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
        No assets found
      </h3>
      <p className="text-parchment-400 mb-4">
        {hasFilters
          ? 'Try adjusting your filters to see more results.'
          : 'No assets are available in this category.'}
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
 * Loading skeleton component
 */
function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {Array.from({ length: 18 }).map((_, i) => (
        <div key={i} className="card overflow-hidden animate-pulse">
          <div className="aspect-square bg-midnight-800" />
          <div className="p-2 border-t border-midnight-700">
            <div className="h-4 bg-midnight-800 rounded w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Main AssetGrid component
 */
export default function AssetGrid({
  category,
  pageTitle,
  pageDescription,
  pageIcon: PageIcon,
}) {
  // Toast notifications
  const toast = useToast();

  // Generation context for queue status
  const { unified } = useGenerationContext();

  // Extract queued IDs and currently generating ID from generation context
  const { queuedIds, generatingId } = useMemo(() => {
    const queue = unified?.queues?.images;
    if (!queue) {
      return { queuedIds: new Set(), generatingId: null };
    }

    // Get currently generating asset ID
    const currentId = queue.current?.assetId || queue.current?.key || null;

    // Build set of pending asset IDs
    const pendingIds = new Set();
    if (queue.pending) {
      for (const job of queue.pending) {
        const id = job.assetId || job.key;
        if (id) pendingIds.add(id);
      }
    }

    return { queuedIds: pendingIds, generatingId: currentId };
  }, [unified?.queues?.images]);

  // Filter state
  const [filters, setFilters] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [actionLoading, setActionLoading] = useState(false);

  // Detail panel state
  const [detailAsset, setDetailAsset] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Bulk edit modal state
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  // Refs
  const closeTimeoutRef = useRef(null);
  const refetchTimeoutRef = useRef(null);
  const searchInputRef = useRef(null);
  const scrollPositionRef = useRef(null);
  const lastSaveTimeRef = useRef(0); // Tracks when detailAsset was last saved via API

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
      if (refetchTimeoutRef.current) clearTimeout(refetchTimeoutRef.current);
    };
  }, []);

  // Fetch assets
  const { data, loading, error, refetch } = useAssets(category, filters);

  // Refetch assets when generation finishes (active → idle)
  const wasGeneratingRef = useRef(false);
  useEffect(() => {
    const isActive = !!unified?.anyActive;
    if (wasGeneratingRef.current && !isActive) {
      refetch();
    }
    wasGeneratingRef.current = isActive;
  }, [unified?.anyActive, refetch]);

  // Update detail panel when assets refetch (e.g., after bulk edit)
  useEffect(() => {
    if (detailAsset && data?.assets) {
      // Skip sync if we just saved (within last 2 seconds)
      // This prevents stale cached refetch data from overwriting fresh API save response
      const timeSinceLastSave = Date.now() - lastSaveTimeRef.current;
      if (timeSinceLastSave < 2000) {
        return;
      }

      const detailSelectionId = getAssetSelectionId(detailAsset, category);
      const updatedAsset = data.assets.find(
        (asset) => getAssetSelectionId(asset, category) === detailSelectionId
      );
      if (updatedAsset && JSON.stringify(updatedAsset) !== JSON.stringify(detailAsset)) {
        setDetailAsset(updatedAsset);
      }
    }
  }, [category, data?.assets, detailAsset]);

  // Restore scroll position after data updates (from detail panel save/regenerate)
  useEffect(() => {
    if (scrollPositionRef.current !== null && data?.assets && !loading) {
      requestAnimationFrame(() => {
        window.scrollTo(0, scrollPositionRef.current);
        scrollPositionRef.current = null;
      });
    }
  }, [data?.assets, loading]);

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

  // Selection stores scoped UI identities. Resolve those identities back to
  // full assets before sending raw metadata keys to an API.
  const selectedAssets = useMemo(
    () => getSelectedAssets(data?.assets, selectedIds, category),
    [category, data?.assets, selectedIds]
  );

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
  const handleDetailUpdate = useCallback((updatedAsset) => {
    // Save scroll position before refetch
    scrollPositionRef.current = window.scrollY;

    if (updatedAsset) {
      // We have fresh data from the API response - use it directly
      // Record save time so sync useEffect won't overwrite with stale refetch data
      lastSaveTimeRef.current = Date.now();
      setDetailAsset(updatedAsset);
    }

    // Always refetch to keep grid in sync
    refetch();
  }, [refetch]);

  /**
   * Add selected assets to the regeneration queue (marks them, doesn't execute)
   */
  const handleAddToQueue = useCallback(async () => {
    if (selectedIds.size === 0) {
      toast.info('No assets selected');
      return;
    }

    setActionLoading(true);

    try {
      const selectedAssetIds = selectedAssets.map(getAssetRawId);

      // Tile keys are scoped by biome and tile category in metadata.
      if (category === 'tiles') {
        await Promise.all(
          groupTileAssetsByScope(selectedAssets).map(({ biome, subcategory, assetIds }) =>
            api.markMultipleForRegeneration(category, assetIds, true, { biome, subcategory })
          )
        );
      } else {
        // Non-tiles: IDs are unique, no grouping needed
        await api.markMultipleForRegeneration(category, selectedAssetIds, true);
      }

      toast.success(`Added ${selectedAssetIds.length} item(s) to regeneration queue`);

      // Clear selection after marking
      clearSelection();

      // Refresh to show updated markers (preserve scroll)
      scrollPositionRef.current = window.scrollY;
      if (refetchTimeoutRef.current) clearTimeout(refetchTimeoutRef.current);
      refetchTimeoutRef.current = setTimeout(() => {
        refetch();
      }, 500);
    } catch (err) {
      toast.error(err.message || 'Failed to add to queue');
    } finally {
      setActionLoading(false);
    }
  }, [selectedIds.size, selectedAssets, category, clearSelection, refetch, toast]);

  /**
   * Generate selected assets immediately (bypasses queue)
   */
  const handleGenerateNow = useCallback(async () => {
    if (selectedIds.size === 0) {
      toast.info('No assets selected');
      return;
    }

    setActionLoading(true);

    try {
      const selectedAssetIds = selectedAssets.map(getAssetRawId);

      // Check how many are already generated (for messaging)
      const alreadyGenerated = selectedAssets.filter((asset) => asset.generated).length;

      // Use generateAssetsByIds with force:true to allow regeneration
      if (category === 'tiles') {
        await Promise.all(
          groupTileAssetsByScope(selectedAssets).map(({ biome, subcategory, assetIds }) =>
            api.generateAssetsByIds(
              category,
              assetIds,
              { force: true },
              { biome, subcategory }
            )
          )
        );
      } else {
        await api.generateAssetsByIds(category, selectedAssetIds, { force: true });
      }

      const message = alreadyGenerated > 0
        ? `Queued ${selectedAssetIds.length} asset(s) for (re)generation`
        : `Generation queued for ${selectedAssetIds.length} asset(s)`;
      toast.success(message);

      // Clear selection after queueing
      clearSelection();

      // Refresh after a delay to show updated status (preserve scroll)
      scrollPositionRef.current = window.scrollY;
      if (refetchTimeoutRef.current) clearTimeout(refetchTimeoutRef.current);
      refetchTimeoutRef.current = setTimeout(() => {
        refetch();
      }, 2000);
    } catch (err) {
      toast.error(err.message || 'Failed to queue generation');
    } finally {
      setActionLoading(false);
    }
  }, [selectedIds.size, selectedAssets, category, clearSelection, refetch, toast]);

  /**
   * Select/deselect all visible assets
   */
  const handleSelectAll = useCallback(() => {
    const allVisibleSelected = filteredAssets.every((asset) =>
      selectedIds.has(getAssetSelectionId(asset, category))
    );

    if (allVisibleSelected) {
      // Deselect all
      setSelectedIds(new Set());
    } else {
      // Select all
      const allIds = new Set(
        filteredAssets.map((asset) => getAssetSelectionId(asset, category))
      );
      setSelectedIds(allIds);
    }
  }, [category, filteredAssets, selectedIds]);

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
    const asset = selectedAssets[0];
    if (asset) {
      handleAssetClick(asset);
    }
  }, [selectedAssets, selectedIds.size, handleAssetClick]);

  /**
   * Quick action: Regenerate single asset immediately
   */
  const handleQuickRegenerate = useCallback(async (asset) => {
    const id = getAssetRawId(asset);
    const extraFilters = category === 'tiles'
      ? {
          biome: asset._biome,
          subcategory: asset._tileCategory,
        }
      : {};

    try {
      await api.generateAssetsByIds(category, [id], { force: true }, extraFilters);
      toast.success(`Regenerating ${id}...`);
      // Refresh after a delay (preserve scroll)
      scrollPositionRef.current = window.scrollY;
      if (refetchTimeoutRef.current) clearTimeout(refetchTimeoutRef.current);
      refetchTimeoutRef.current = setTimeout(() => {
        refetch();
      }, 2000);
    } catch (err) {
      toast.error(err.message || 'Failed to regenerate');
    }
  }, [category, refetch, toast]);

  /**
   * Quick action: Toggle mark for regeneration
   * @param {object} asset - The full asset object (includes subcategory info for disambiguation)
   * @param {boolean} mark - Whether to mark or unmark
   */
  const handleQuickToggleMark = useCallback(async (asset, mark) => {
    const id = asset.key || asset.id;
    // Build disambiguation options for categories with ID collisions
    const options = {};
    if (category === 'tiles') {
      options.biome = asset._biome;
    } else if (category === 'icons') {
      options.iconCategory = asset._iconCategory;
    } else if (category === 'items') {
      options.itemCategory = asset._itemCategory;
    }
    // sourceFile is most precise fallback
    if (asset._sourceFile) {
      options.sourceFile = asset._sourceFile;
    }

    try {
      await api.markForRegeneration(category, id, mark, options);
      toast.success(mark ? `Marked ${id} for regeneration` : `Removed ${id} from queue`);
      // Refresh to show updated status (preserve scroll)
      scrollPositionRef.current = window.scrollY;
      if (refetchTimeoutRef.current) clearTimeout(refetchTimeoutRef.current);
      refetchTimeoutRef.current = setTimeout(() => {
        refetch();
      }, 300);
    } catch (err) {
      toast.error(err.message || 'Failed to update');
    }
  }, [category, refetch, toast]);

  /**
   * Open bulk edit modal
   */
  const handleOpenBulkEdit = useCallback(() => {
    if (selectedIds.size === 0) {
      toast.info('No assets selected');
      return;
    }
    setBulkEditOpen(true);
  }, [selectedIds.size, toast]);

  /**
   * Handle bulk edit update complete
   */
  const handleBulkEditUpdate = useCallback(() => {
    clearSelection();
    // Preserve scroll position after bulk edit
    scrollPositionRef.current = window.scrollY;
    refetch();
  }, [clearSelection, refetch]);

  /**
   * Get the currently focused asset index for keyboard navigation
   */
  const getFocusedIndex = useCallback(() => {
    if (selectedIds.size === 0) return -1;
    const lastSelected = Array.from(selectedIds).pop();
    return filteredAssets.findIndex(
      (asset) => getAssetSelectionId(asset, category) === lastSelected
    );
  }, [category, selectedIds, filteredAssets]);

  /**
   * Vim-style navigation: Select next asset (j key)
   */
  const handleSelectNext = useCallback(() => {
    if (filteredAssets.length === 0) return;

    const currentIndex = getFocusedIndex();
    const nextIndex = currentIndex < filteredAssets.length - 1 ? currentIndex + 1 : 0;
    const nextAsset = filteredAssets[nextIndex];
    const nextId = getAssetSelectionId(nextAsset, category);

    setSelectedIds(new Set([nextId]));
  }, [category, filteredAssets, getFocusedIndex]);

  /**
   * Vim-style navigation: Select previous asset (k key)
   */
  const handleSelectPrev = useCallback(() => {
    if (filteredAssets.length === 0) return;

    const currentIndex = getFocusedIndex();
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : filteredAssets.length - 1;
    const prevAsset = filteredAssets[prevIndex];
    const prevId = getAssetSelectionId(prevAsset, category);

    setSelectedIds(new Set([prevId]));
  }, [category, filteredAssets, getFocusedIndex]);

  /**
   * Open selected asset detail (Enter key)
   */
  const handleOpenSelected = useCallback(() => {
    if (selectedIds.size === 0) return;

    const asset = selectedAssets[0];
    if (asset) {
      handleAssetClick(asset);
    }
  }, [selectedAssets, selectedIds.size, handleAssetClick]);

  /**
   * Regenerate selected assets (r key)
   */
  const handleRegenerateSelected = useCallback(async () => {
    if (selectedIds.size === 0) {
      toast.info('No assets selected');
      return;
    }

    const selectedAssetIds = selectedAssets.map(getAssetRawId);
    try {
      if (category === 'tiles') {
        await Promise.all(
          groupTileAssetsByScope(selectedAssets).map(({ biome, subcategory, assetIds }) =>
            api.generateAssetsByIds(
              category,
              assetIds,
              { force: true },
              { biome, subcategory }
            )
          )
        );
      } else {
        await api.generateAssetsByIds(category, selectedAssetIds, { force: true });
      }
      toast.success(`Regenerating ${selectedAssetIds.length} asset(s)...`);
      // Refresh after a delay (preserve scroll)
      scrollPositionRef.current = window.scrollY;
      if (refetchTimeoutRef.current) clearTimeout(refetchTimeoutRef.current);
      refetchTimeoutRef.current = setTimeout(() => {
        refetch();
      }, 2000);
    } catch (err) {
      toast.error(err.message || 'Failed to regenerate');
    }
  }, [selectedIds.size, selectedAssets, category, refetch, toast]);

  /**
   * Toggle mark for regeneration on selected assets (m key)
   */
  const handleMarkSelected = useCallback(async () => {
    if (selectedIds.size === 0) {
      toast.info('No assets selected');
      return;
    }

    const selectedAssetIds = selectedAssets.map(getAssetRawId);
    // Check if any are already marked - if so, unmark all; otherwise mark all
    const anyMarked = selectedAssets.some((asset) => asset.needsRegeneration);
    const mark = !anyMarked;

    try {
      // Tile metadata keys are only unique inside a biome/tile category.
      if (category === 'tiles') {
        await Promise.all(
          groupTileAssetsByScope(selectedAssets).map(({ biome, subcategory, assetIds }) =>
            api.markMultipleForRegeneration(category, assetIds, mark, { biome, subcategory })
          )
        );
      } else {
        await api.markMultipleForRegeneration(category, selectedAssetIds, mark);
      }

      toast.success(
        anyMarked
          ? `Removed ${selectedAssetIds.length} item(s) from queue`
          : `Marked ${selectedAssetIds.length} item(s) for regeneration`
      );
      // Refresh to show updated status (preserve scroll)
      scrollPositionRef.current = window.scrollY;
      if (refetchTimeoutRef.current) clearTimeout(refetchTimeoutRef.current);
      refetchTimeoutRef.current = setTimeout(() => {
        refetch();
      }, 300);
    } catch (err) {
      toast.error(err.message || 'Failed to update');
    }
  }, [selectedIds.size, selectedAssets, category, refetch, toast]);

  // Register keyboard shortcuts with vim-style navigation
  useKeyboardShortcuts({
    onGenerate: handleAddToQueue,
    onSelectAll: handleSelectAll,
    onEdit: handleEdit,
    onEscape: handleEscape,
    onFocusSearch: handleFocusSearch,
    onSelectNext: handleSelectNext,
    onSelectPrev: handleSelectPrev,
    onOpenSelected: handleOpenSelected,
    onRegenerate: handleRegenerateSelected,
    onMark: handleMarkSelected,
    onAddToQueue: handleAddToQueue,
    isDetailOpen: detailOpen,
  });

  return (
    <div className="p-6 max-w-7xl mx-auto pb-24">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-midnight-800 rounded-lg">
          <PageIcon className="w-6 h-6 text-accent-gold" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-display font-bold text-parchment-100">
            {pageTitle}
          </h1>
          <p className="text-parchment-400">{pageDescription}</p>
        </div>

        {/* Select all button */}
        {filteredAssets.length > 0 && (
          <button
            type="button"
            onClick={handleSelectAll}
            className="btn-ghost text-sm"
          >
            {filteredAssets.every((asset) =>
              selectedIds.has(getAssetSelectionId(asset, category))
            ) ? 'Deselect All' : 'Select All'}
          </button>
        )}
      </div>

      {/* Filter bar */}
      <FilterBar
        ref={searchInputRef}
        category={category}
        filters={filters}
        onFilterChange={handleFilterChange}
        searchQuery={searchQuery}
        onSearchChange={handleSearchChange}
        onRefresh={refetch}
        loading={loading}
        summary={data?.summary}
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

      {/* Asset grid */}
      {!loading && filteredAssets.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filteredAssets.map((asset) => {
            const selectionId = getAssetSelectionId(asset, category);
            return (
              <AssetCard
                key={selectionId}
                asset={asset}
                category={category}
                selectionId={selectionId}
                selected={selectedIds.has(selectionId)}
                onSelect={handleSelect}
                onClick={handleAssetClick}
                onRegenerate={handleQuickRegenerate}
                onToggleMark={handleQuickToggleMark}
                queuedIds={queuedIds}
                generatingId={generatingId}
              />
            );
          })}
        </div>
      )}

      {/* Results count */}
      {!loading && filteredAssets.length > 0 && (
        <div className="mt-6 text-center text-sm text-parchment-500">
          Showing {filteredAssets.length} of {data?.summary?.total || 0} assets
        </div>
      )}

      {/* Bulk action bar */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        onAddToQueue={handleAddToQueue}
        onGenerateNow={handleGenerateNow}
        onBulkEdit={handleOpenBulkEdit}
        onClearSelection={clearSelection}
        loading={actionLoading}
      />

      {/* Asset detail slide-over panel */}
      <AssetDetail
        asset={detailAsset}
        category={category}
        open={detailOpen}
        onClose={handleDetailClose}
        onUpdate={handleDetailUpdate}
      />

      {/* Bulk edit modal */}
      <BulkEditModal
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        selectedIds={Array.from(selectedIds)}
        category={category}
        assets={data?.assets || []}
        onUpdate={handleBulkEditUpdate}
      />
    </div>
  );
}
