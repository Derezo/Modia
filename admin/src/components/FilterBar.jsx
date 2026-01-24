/**
 * FilterBar - Reusable filter controls for asset browsing
 * Provides category-specific filtering options (biome, subcategory, status)
 */

import { MagnifyingGlassIcon, Cross2Icon, ReloadIcon } from '@radix-ui/react-icons';

/**
 * Filter configuration by category
 */
const FILTER_CONFIG = {
  tiles: {
    biome: ['forest', 'cave', 'mountain', 'bridge', 'castle'],
    subcategory: ['floors', 'walls', 'slopes'],
  },
  portraits: {
    subcategory: ['player', 'enemy'],
  },
  items: {
    subcategory: ['weapons', 'armor', 'accessories', 'consumables'],
  },
  icons: {
    subcategory: ['actions', 'status', 'menu', 'augments'],
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
];

export default function FilterBar({
  category,
  filters,
  onFilterChange,
  onSearchChange,
  searchQuery = '',
  onRefresh,
  loading = false,
  summary = null,
}) {
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
   * Clear all filters
   */
  const clearFilters = () => {
    onFilterChange({});
    onSearchChange('');
  };

  /**
   * Check if any filters are active
   */
  const hasActiveFilters = () => {
    return (
      searchQuery ||
      filters.status ||
      filters.biome ||
      filters.subcategory
    );
  };

  return (
    <div className="card p-4 mb-6">
      <div className="flex flex-wrap items-center gap-4">
        {/* Search input */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-parchment-400" />
          <input
            type="text"
            placeholder="Search by ID..."
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
        {hasActiveFilters() && (
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
    </div>
  );
}
