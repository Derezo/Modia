/**
 * FilterBar - Reusable filter controls for asset browsing
 * Provides category-specific filtering options (biome, subcategory, status)
 * Shows active filter chips for quick visibility and removal
 */

import { forwardRef, useMemo } from 'react';
import { MagnifyingGlassIcon, Cross2Icon, ReloadIcon } from '@radix-ui/react-icons';

/**
 * Filter configuration by category
 */
const FILTER_CONFIG = {
  tiles: {
    biome: ['base', 'forest', 'cave', 'mountain', 'bridge', 'castle'],
    subcategory: ['floors', 'walls', 'slopes'],
  },
  portraits: {
    subcategory: ['player', 'enemy'],
  },
  items: {
    subcategory: ['weapons', 'armor', 'accessories', 'consumables'],
  },
  icons: {
    subcategory: ['actions', 'status', 'menu', 'augments', 'resources', 'zodiac'],
  },
  nodes: {
    // No category-specific filters, just status
  },
  overlays: {
    subcategory: ['rarity', 'augments'],
  },
};

/**
 * Status options available for all categories
 */
const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'generated', label: 'Generated' },
  { value: 'pending', label: 'Pending' },
  { value: 'needsRegen', label: 'Needs Regen' },
];

/**
 * Filter label mappings for display
 */
const FILTER_LABELS = {
  biome: 'Biome',
  subcategory: 'Type',
  status: 'Status',
  search: 'Search',
};

/**
 * Active filter chip component
 */
function FilterChip({ label, value, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 bg-midnight-700 rounded-full text-xs text-parchment-300">
      <span className="text-parchment-500">{label}:</span>
      <span className="font-medium">{value}</span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 text-parchment-500 hover:text-parchment-200 transition-colors"
        aria-label={`Remove ${label} filter`}
      >
        <Cross2Icon className="w-3 h-3" />
      </button>
    </span>
  );
}

const FilterBar = forwardRef(function FilterBar({
  category,
  filters,
  onFilterChange,
  onSearchChange,
  searchQuery = '',
  onRefresh,
  loading = false,
  summary = null,
}, ref) {
  const config = FILTER_CONFIG[category] || {};

  /**
   * Handle individual filter change
   */
  const handleChange = (key, value) => {
    onFilterChange({
      ...filters,
      [key]: value === 'all' ? undefined : value,
    });
  };

  /**
   * Remove a single filter
   */
  const removeFilter = (key) => {
    if (key === 'search') {
      onSearchChange('');
    } else {
      const newFilters = { ...filters };
      delete newFilters[key];
      onFilterChange(newFilters);
    }
  };

  /**
   * Clear all filters
   */
  const clearFilters = () => {
    onFilterChange({});
    onSearchChange('');
  };

  /**
   * Build list of active filters for chip display
   */
  const activeFilters = useMemo(() => {
    const active = [];

    if (searchQuery) {
      active.push({
        key: 'search',
        label: FILTER_LABELS.search,
        value: searchQuery.length > 20 ? `${searchQuery.slice(0, 20)}...` : searchQuery,
      });
    }

    if (filters.biome) {
      active.push({
        key: 'biome',
        label: FILTER_LABELS.biome,
        value: filters.biome.charAt(0).toUpperCase() + filters.biome.slice(1),
      });
    }

    if (filters.subcategory) {
      active.push({
        key: 'subcategory',
        label: FILTER_LABELS.subcategory,
        value: filters.subcategory.charAt(0).toUpperCase() + filters.subcategory.slice(1),
      });
    }

    if (filters.status) {
      const statusOption = STATUS_OPTIONS.find((opt) => opt.value === filters.status);
      active.push({
        key: 'status',
        label: FILTER_LABELS.status,
        value: statusOption?.label || filters.status,
      });
    }

    return active;
  }, [searchQuery, filters]);

  /**
   * Check if any filters are active
   */
  const hasActiveFilters = activeFilters.length > 0;

  return (
    <div className="card p-4 mb-6">
      <div className="flex flex-wrap items-center gap-4">
        {/* Search input */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-parchment-400" />
          <input
            ref={ref}
            type="text"
            placeholder="Search by ID... (press / to focus)"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                       text-parchment-100 placeholder-parchment-500
                       focus:outline-none focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/30"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-parchment-400 hover:text-parchment-200"
              aria-label="Clear search"
            >
              <Cross2Icon className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Biome filter (tiles only) */}
        {config.biome && (
          <select
            value={filters.biome || 'all'}
            onChange={(e) => handleChange('biome', e.target.value)}
            className="px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                       text-parchment-200 focus:outline-none focus:border-accent-gold
                       cursor-pointer"
          >
            <option value="all">All Biomes</option>
            {config.biome.map((biome) => (
              <option key={biome} value={biome}>
                {biome.charAt(0).toUpperCase() + biome.slice(1)}
              </option>
            ))}
          </select>
        )}

        {/* Subcategory filter */}
        {config.subcategory && (
          <select
            value={filters.subcategory || 'all'}
            onChange={(e) => handleChange('subcategory', e.target.value)}
            className="px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                       text-parchment-200 focus:outline-none focus:border-accent-gold
                       cursor-pointer"
          >
            <option value="all">All Types</option>
            {config.subcategory.map((sub) => (
              <option key={sub} value={sub}>
                {sub.charAt(0).toUpperCase() + sub.slice(1)}
              </option>
            ))}
          </select>
        )}

        {/* Status filter */}
        <select
          value={filters.status || 'all'}
          onChange={(e) => handleChange('status', e.target.value)}
          className="px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                     text-parchment-200 focus:outline-none focus:border-accent-gold
                     cursor-pointer"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Clear filters button */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="btn-ghost flex items-center gap-2 text-sm"
          >
            <Cross2Icon className="w-4 h-4" />
            Clear
          </button>
        )}

        {/* Refresh button */}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="btn-ghost flex items-center gap-2 text-sm disabled:opacity-50"
          aria-label="Refresh assets"
        >
          <ReloadIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>

        {/* Summary stats */}
        {summary && (
          <div className="ml-auto text-sm text-parchment-400">
            <span className="text-parchment-200 font-medium">{summary.generated}</span>
            {' / '}
            <span>{summary.total}</span>
            {' generated'}
            {summary.pending > 0 && (
              <span className="ml-2 text-accent-gold">
                ({summary.pending} pending)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Active filter chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-midnight-700">
          <span className="text-xs text-parchment-500">Active filters:</span>
          {activeFilters.map((filter) => (
            <FilterChip
              key={filter.key}
              label={filter.label}
              value={filter.value}
              onRemove={() => removeFilter(filter.key)}
            />
          ))}
          {activeFilters.length > 1 && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-parchment-400 hover:text-parchment-200 transition-colors ml-2"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
});

export default FilterBar;
