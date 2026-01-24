/**
 * AssetGrid - Virtualized-like grid display for assets
 * Uses CSS grid with lazy loading for performance on large lists
 */

import { useState, useMemo, useCallback } from 'react';
import {
  RocketIcon,
  Cross2Icon,
  ReloadIcon,
  ExclamationTriangleIcon,
  CheckCircledIcon,
} from '@radix-ui/react-icons';

import AssetCard from './AssetCard';
import FilterBar from './FilterBar';
import { useAssets } from '../hooks/useAssets';
import { api } from '../lib/api';

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
  // Filter state
  const [filters, setFilters] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);

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
   * Handle asset click (for future detail panel)
   */
  const handleAssetClick = useCallback((asset) => {
    // TODO: Open detail panel in Task 5
    // For now, just track selected asset for future use
    void asset;
  }, []);

  /**
   * Generate selected assets
   */
  const handleGenerateSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;

    setActionLoading(true);
    setActionMessage(null);

    try {
      // Find the pending assets that are selected
      const pendingSelected = filteredAssets.filter(
        (a) => selectedIds.has(a.key || a.id) && !a.generated
      );

      if (pendingSelected.length === 0) {
        setActionMessage({
          type: 'info',
          text: 'All selected assets are already generated',
        });
        setActionLoading(false);
        return;
      }

      // Queue generation for selected assets
      // For now, generate with category filter - individual asset generation requires API changes
      await api.generateAssets(category, filters, {
        limit: pendingSelected.length,
      });

      setActionMessage({
        type: 'success',
        text: `Queued generation for ${pendingSelected.length} asset(s)`,
      });

      // Clear selection after queueing
      clearSelection();

      // Refresh after a delay to show updated status
      setTimeout(() => {
        refetch();
      }, 2000);
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err.message || 'Failed to queue generation',
      });
    } finally {
      setActionLoading(false);
    }
  }, [selectedIds, filteredAssets, category, filters, clearSelection, refetch]);

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

      {/* Action message */}
      {actionMessage && (
        <div
          className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
            actionMessage.type === 'success'
              ? 'bg-accent-emerald/10 border border-accent-emerald/30'
              : actionMessage.type === 'error'
              ? 'bg-accent-ruby/10 border border-accent-ruby/30'
              : 'bg-accent-gold/10 border border-accent-gold/30'
          }`}
        >
          {actionMessage.type === 'success' ? (
            <CheckCircledIcon className="w-5 h-5 text-accent-emerald flex-shrink-0" />
          ) : actionMessage.type === 'error' ? (
            <ExclamationTriangleIcon className="w-5 h-5 text-accent-ruby flex-shrink-0" />
          ) : (
            <CheckCircledIcon className="w-5 h-5 text-accent-gold flex-shrink-0" />
          )}
          <p
            className={
              actionMessage.type === 'success'
                ? 'text-accent-emerald'
                : actionMessage.type === 'error'
                ? 'text-accent-ruby'
                : 'text-accent-gold'
            }
          >
            {actionMessage.text}
          </p>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="ml-auto text-parchment-400 hover:text-parchment-200"
            aria-label="Dismiss message"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter bar */}
      <FilterBar
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
            return (
              <AssetCard
                key={id}
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
        onGenerate={handleGenerateSelected}
        onClearSelection={clearSelection}
        loading={actionLoading}
      />
    </div>
  );
}
