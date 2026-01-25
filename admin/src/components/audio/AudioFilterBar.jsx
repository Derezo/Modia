/**
 * AudioFilterBar - Filter controls for audio asset grids
 * Provides category, subcategory, status filtering, search, and refresh.
 *
 * @module AudioFilterBar
 * @description Specialized filter bar for music and SFX asset browsing.
 */

import { forwardRef } from 'react';
import { MagnifyingGlassIcon, Cross2Icon, ReloadIcon } from '@radix-ui/react-icons';

/**
 * Filter configuration by audio type
 */
const AUDIO_FILTER_CONFIG = {
  music: {
    subcategory: [
      { value: 'regions', label: 'Regional Themes' },
      { value: 'battle', label: 'Battle Music' },
      { value: 'core', label: 'Core Tracks' },
    ],
  },
  sfx: {
    subcategory: [
      { value: 'combat', label: 'Combat' },
      { value: 'skills', label: 'Skills' },
      { value: 'ambient', label: 'Ambient' },
      { value: 'interactions', label: 'Interactions' },
      { value: 'ui', label: 'UI Sounds' },
    ],
  },
};

/**
 * Status options for all audio types
 */
const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'generated', label: 'Generated' },
  { value: 'pending', label: 'Pending' },
];

const AudioFilterBar = forwardRef(function AudioFilterBar({
  audioType = 'music',
  filters = {},
  onFilterChange,
  searchQuery = '',
  onSearchChange,
  onRefresh,
  loading = false,
  summary = null,
}, ref) {
  const config = AUDIO_FILTER_CONFIG[audioType] || {};

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
    return searchQuery || filters.status || filters.subcategory;
  };

  return (
    <div className="card p-4 mb-6">
      <div className="flex flex-wrap items-center gap-4">
        {/* Search input */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-parchment-400" />
          <input
            ref={ref}
            type="text"
            placeholder="Search by key... (press / to focus)"
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

        {/* Category/Subcategory filter */}
        {config.subcategory && (
          <select
            value={filters.subcategory || 'all'}
            onChange={(e) => handleChange('subcategory', e.target.value)}
            className="px-3 py-2 bg-midnight-800 border border-midnight-700 rounded-lg
                       text-parchment-200 focus:outline-none focus:border-accent-gold
                       cursor-pointer"
          >
            <option value="all">All Categories</option>
            {config.subcategory.map((sub) => (
              <option key={sub.value} value={sub.value}>
                {sub.label}
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
          aria-label="Refresh audio assets"
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
});

export default AudioFilterBar;
