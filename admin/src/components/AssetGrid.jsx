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
} from '@radix-ui/react-icons';

import AssetCard from './AssetCard';
import AssetDetail from './AssetDetail';
import FilterBar from './FilterBar';
import { useAssets } from '../hooks/useAssets';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useToast } from '../contexts/ToastContext';
import { api } from '../lib/api';

/**
 * Bulk action bar component
 */
function BulkActionBar({ selectedCount, onAddToQueue, onGenerateNow, onClearSelection, loading }) {
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
          onClick={onAddToQueue}
          disabled={loading}
          className="btn-gold flex items-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <ReloadIcon className="w-4 h-4 animate-spin" />
          ) : (
            <ListBulletIcon className="w-4 h-4" />
          )}
          Add to Queue
        </button>

        <button
          type="button"
          onClick={onGenerateNow}
          disabled={loading}
          className="btn-ghost flex items-center gap-2 disabled:opacity-50"
          title="Skip queue and generate immediately"
        >
          <RocketIcon className="w-4 h-4" />
          Generate Now
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

  // Filter state
  const [filters, setFilters] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [actionLoading, setActionLoading] = useState(false);

  // Detail panel state
  const [detailAsset, setDetailAsset] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Refs
  const closeTimeoutRef = useRef(null);
  const refetchTimeoutRef = useRef(null);
  const searchInputRef = useRef(null);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
      if (refetchTimeoutRef.current) clearTimeout(refetchTimeoutRef.current);
    };
  }, []);

  // Fetch assets
  const { data, loading, error, refetch } = useAssets(category, filters);

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
  const handleDetailUpdate = useCallback(() => {
    // Refetch to get updated data
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
      const selectedAssetIds = Array.from(selectedIds);

      // Mark items for regeneration instead of immediate execution
      await api.markMultipleForRegeneration(category, selectedAssetIds, true);

      toast.success(`Added ${selectedAssetIds.length} item(s) to regeneration queue`);

      // Clear selection after marking
      clearSelection();

      // Refresh to show updated markers
      if (refetchTimeoutRef.current) clearTimeout(refetchTimeoutRef.current);
      refetchTimeoutRef.current = setTimeout(() => {
        refetch();
      }, 500);
    } catch (err) {
      toast.error(err.message || 'Failed to add to queue');
    } finally {
      setActionLoading(false);
    }
  }, [selectedIds, category, clearSelection, refetch, toast]);

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
      // Get selected asset IDs
      const selectedAssetIds = Array.from(selectedIds);

      // Check how many are already generated (for messaging)
      const alreadyGenerated = filteredAssets.filter(
        (a) => selectedIds.has(a.key || a.id) && a.generated
      ).length;

      // Use generateAssetsByIds with force:true to allow regeneration
      await api.generateAssetsByIds(category, selectedAssetIds, { force: true });

      const message = alreadyGenerated > 0
        ? `Queued ${selectedAssetIds.length} asset(s) for (re)generation`
        : `Generation queued for ${selectedAssetIds.length} asset(s)`;
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
  }, [selectedIds, filteredAssets, category, clearSelection, refetch, toast]);

  /**
   * Select/deselect all visible assets
   */
  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredAssets.length) {
      // Deselect all
      setSelectedIds(new Set());
    } else {
      // Select all
      const allIds = new Set(filteredAssets.map((a) => a.key || a.id));
      setSelectedIds(allIds);
    }
  }, [selectedIds.size, filteredAssets]);

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
    const asset = filteredAssets.find((a) => (a.key || a.id) === firstSelectedId);
    if (asset) {
      handleAssetClick(asset);
    }
  }, [selectedIds, filteredAssets, handleAssetClick]);

  // Register keyboard shortcuts
  useKeyboardShortcuts({
    onGenerate: handleAddToQueue,  // Shift+G now adds to queue
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
            {selectedIds.size === filteredAssets.length ? 'Deselect All' : 'Select All'}
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
            const id = asset.key || asset.id;
            // For tiles, include biome AND tileCategory to ensure unique keys
            // across different biomes (e.g., forest/floors/grass_0 vs cave/floors/grass_0)
            const uniqueKey = category === 'tiles' && asset._biome && asset._tileCategory
              ? `${asset._biome}_${asset._tileCategory}_${id}`
              : category === 'tiles' && asset._tileCategory
              ? `${asset._tileCategory}_${id}`
              : id;
            return (
              <AssetCard
                key={uniqueKey}
                asset={asset}
                category={category}
                selected={selectedIds.has(id)}
                onSelect={handleSelect}
                onClick={handleAssetClick}
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
    </div>
  );
}
