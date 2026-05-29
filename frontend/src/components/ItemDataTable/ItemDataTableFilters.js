/**
 * ItemDataTableFilters - Filter bar component for ItemDataTable
 */

import { FILTER_OPTIONS } from './itemDataTableColumns.js';
import { escapeHtml } from '../../utils/escapeHtml.js';

/**
 * Renders and manages the filter bar for ItemDataTable
 */
export class ItemDataTableFilters {
  /**
   * @param {Object} config - Filter configuration
   * @param {boolean} config.showTypeFilter - Show item type dropdown
   * @param {boolean} config.showRarityFilter - Show rarity dropdown
   * @param {boolean} config.showAugmentFilter - Show augment filter (marketplace)
   * @param {boolean} config.showSearch - Show search input
   * @param {Function} onChange - Callback when filters change
   */
  constructor(config = {}, onChange = null) {
    this.config = {
      showTypeFilter: true,
      showRarityFilter: true,
      showAugmentFilter: false,
      showSearch: true,
      ...config
    };
    this.onChange = onChange;
    this.values = {
      search: '',
      type: '',
      rarity: '',
      augment: ''
    };
    this.element = null;
    this.debounceTimer = null;
  }

  /**
   * Render the filter bar
   * @returns {string} HTML string
   */
  render() {
    const parts = [];

    // Search input
    if (this.config.showSearch) {
      parts.push(`
        <input
          type="text"
          class="item-data-table-search"
          placeholder="Search items..."
          value="${escapeHtml(this.values.search)}"
          data-filter="search"
        >
      `);
    }

    // Type filter
    if (this.config.showTypeFilter) {
      parts.push(this.renderSelect('type', FILTER_OPTIONS.type));
    }

    // Rarity filter
    if (this.config.showRarityFilter) {
      parts.push(this.renderSelect('rarity', FILTER_OPTIONS.rarity));
    }

    // Augment filter (marketplace only)
    if (this.config.showAugmentFilter) {
      parts.push(this.renderSelect('augment', FILTER_OPTIONS.augment));
    }

    return `<div class="item-data-table-filters">${parts.join('')}</div>`;
  }

  /**
   * Render a select dropdown
   * @param {string} name - Filter name
   * @param {Array} options - Array of {value, label} objects
   * @returns {string} HTML string
   */
  renderSelect(name, options) {
    const optionsHtml = options.map(opt => {
      const selected = this.values[name] === opt.value ? 'selected' : '';
      return `<option value="${escapeHtml(opt.value)}" ${selected}>${escapeHtml(opt.label)}</option>`;
    }).join('');

    return `
      <select class="item-data-table-filter-select" data-filter="${name}">
        ${optionsHtml}
      </select>
    `;
  }

  /**
   * Bind event listeners to the filter elements
   * @param {HTMLElement} container - Container element
   * @param {AbortSignal} signal - AbortController signal for cleanup
   */
  bindEvents(container, signal) {
    this.element = container.querySelector('.item-data-table-filters');
    if (!this.element) return;

    // Search input with debounce
    const searchInput = this.element.querySelector('[data-filter="search"]');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.values.search = e.target.value;
        this.debouncedChange();
      }, { signal });
    }

    // Select dropdowns
    const selects = this.element.querySelectorAll('.item-data-table-filter-select');
    selects.forEach(select => {
      select.addEventListener('change', (e) => {
        const filterName = e.target.dataset.filter;
        this.values[filterName] = e.target.value;
        this.triggerChange();
      }, { signal });
    });
  }

  /**
   * Debounced change trigger for search input
   */
  debouncedChange() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.triggerChange();
    }, 200);
  }

  /**
   * Trigger the onChange callback
   */
  triggerChange() {
    if (this.onChange) {
      this.onChange({ ...this.values });
    }
  }

  /**
   * Get current filter values
   * @returns {Object} Current filter values
   */
  getValues() {
    return { ...this.values };
  }

  /**
   * Set filter values
   * @param {Object} values - New filter values
   */
  setValues(values) {
    this.values = { ...this.values, ...values };
    this.updateUI();
  }

  /**
   * Reset all filters to default
   */
  reset() {
    this.values = {
      search: '',
      type: '',
      rarity: '',
      augment: ''
    };
    this.updateUI();
    this.triggerChange();
  }

  /**
   * Update UI to reflect current values
   */
  updateUI() {
    if (!this.element) return;

    const searchInput = this.element.querySelector('[data-filter="search"]');
    if (searchInput) {
      searchInput.value = this.values.search;
    }

    const selects = this.element.querySelectorAll('.item-data-table-filter-select');
    selects.forEach(select => {
      const filterName = select.dataset.filter;
      if (this.values[filterName] !== undefined) {
        select.value = this.values[filterName];
      }
    });
  }


  /**
   * Cleanup
   */
  destroy() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.element = null;
    this.onChange = null;
  }
}

export default ItemDataTableFilters;
