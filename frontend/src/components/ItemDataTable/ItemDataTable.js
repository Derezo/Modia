/**
 * ItemDataTable - Modular data table component for displaying items
 *
 * A reusable sortable/filterable table component for shop, marketplace,
 * inventory, and formation scenes.
 */

import { injectItemDataTableStyles } from './itemDataTableStyles.js';
import { COLUMN_PRESETS } from './itemDataTableColumns.js';
import { ItemDataTableFilters } from './ItemDataTableFilters.js';
import { ItemDataTableHeader } from './ItemDataTableHeader.js';
import { ItemDataTableRow } from './ItemDataTableRow.js';
import { normalizeRarity } from '../../utils/statDisplay.js';

/**
 * ItemDataTable - Main component class
 */
export class ItemDataTable {
  /**
   * @param {HTMLElement} container - Parent container element
   * @param {Object} options - Configuration options
   * @param {Array<Object>} options.items - Items to display
   * @param {string} options.variant - 'default' | 'shop' | 'marketplace' | 'inventory' | 'formation'
   * @param {Array<string>} options.columns - Custom column configuration (optional)
   * @param {Object} options.filters - Filter configuration
   * @param {boolean} options.filters.showTypeFilter - Show item type dropdown
   * @param {boolean} options.filters.showRarityFilter - Show rarity dropdown
   * @param {boolean} options.filters.showAugmentFilter - Show augment filter (marketplace)
   * @param {boolean} options.filters.showSearch - Show search input
   * @param {Function} options.onRowSelect - Callback when row is selected
   * @param {Function} options.onRowDoubleClick - Callback on double-click
   * @param {string} options.selectionMode - 'single' | 'multi' | 'none'
   * @param {string} options.emptyMessage - Custom empty state message
   * @param {number} options.maxHeight - Max height for scrollable body (default: 400)
   */
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      items: [],
      variant: 'default',
      columns: null,
      filters: {
        showTypeFilter: true,
        showRarityFilter: true,
        showAugmentFilter: false,
        showSearch: true
      },
      onRowSelect: null,
      onRowDoubleClick: null,
      selectionMode: 'single',
      emptyMessage: 'No items found',
      maxHeight: 400,
      ...options
    };

    // Resolve columns from variant or custom
    this.columns = this.options.columns || COLUMN_PRESETS[this.options.variant] || COLUMN_PRESETS.default;

    // Internal state
    this.items = [...(this.options.items || [])];
    this.filteredItems = [];
    this.selectedIds = new Set();
    this.sortColumn = null;
    this.sortDirection = 'asc';
    this.isLoading = false;

    // Sub-components
    this.filtersComponent = null;
    this.headerComponent = null;

    // DOM references
    this.element = null;
    this.bodyElement = null;

    // Event cleanup
    this.abortController = null;

    // Initialize
    this.initialize();
  }

  /**
   * Initialize the component
   */
  initialize() {
    // Inject styles
    injectItemDataTableStyles();

    // Create sub-components
    this.filtersComponent = new ItemDataTableFilters(
      this.options.filters,
      (filterValues) => this.handleFilterChange(filterValues)
    );

    this.headerComponent = new ItemDataTableHeader(
      this.columns,
      (sortKey, direction) => this.handleSort(sortKey, direction)
    );

    // Apply initial filters
    this.applyFilters();

    // Render
    this.render();

    // Bind events
    this.bindEvents();
  }

  /**
   * Render the full component
   */
  render() {
    const filtersHtml = this.options.filters ? this.filtersComponent.render() : '';
    const headerHtml = this.headerComponent.render();
    const bodyHtml = this.renderBody();

    const maxHeightStyle = this.options.maxHeight ? `max-height: ${this.options.maxHeight}px;` : '';

    this.container.innerHTML = `
      <div class="item-data-table-container">
        ${filtersHtml}
        ${headerHtml}
        <div class="item-data-table-body" style="${maxHeightStyle}">
          ${bodyHtml}
        </div>
      </div>
    `;

    this.element = this.container.querySelector('.item-data-table-container');
    this.bodyElement = this.container.querySelector('.item-data-table-body');
  }

  /**
   * Render just the table body
   * @returns {string} HTML string
   */
  renderBody() {
    if (this.isLoading) {
      return ItemDataTableRow.renderLoading();
    }

    if (this.filteredItems.length === 0) {
      return ItemDataTableRow.renderEmpty(this.options.emptyMessage);
    }

    return ItemDataTableRow.renderAll(this.filteredItems, this.columns, this.selectedIds);
  }

  /**
   * Update only the body content (optimized re-render)
   */
  updateBody() {
    if (this.bodyElement) {
      this.bodyElement.innerHTML = this.renderBody();
    }
  }

  /**
   * Update the header (for sort indicators)
   */
  updateHeader() {
    const headerContainer = this.element?.querySelector('.item-data-table-header');
    if (headerContainer) {
      headerContainer.outerHTML = this.headerComponent.render();
      // Re-bind header events
      this.headerComponent.bindEvents(this.element, this.abortController.signal);
    }
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Cleanup previous listeners
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Bind filter events
    if (this.options.filters) {
      this.filtersComponent.bindEvents(this.container, signal);
    }

    // Bind header events
    this.headerComponent.bindEvents(this.container, signal);

    // Bind row click events (delegation)
    if (this.bodyElement) {
      this.bodyElement.addEventListener('click', (e) => {
        const row = e.target.closest('.item-data-table-row');
        if (row) {
          const index = parseInt(row.dataset.index, 10);
          this.handleRowClick(index, e);
        }
      }, { signal });

      // Double-click events
      this.bodyElement.addEventListener('dblclick', (e) => {
        const row = e.target.closest('.item-data-table-row');
        if (row && this.options.onRowDoubleClick) {
          const index = parseInt(row.dataset.index, 10);
          const item = this.filteredItems[index];
          if (item) {
            this.options.onRowDoubleClick(item, e);
          }
        }
      }, { signal });
    }
  }

  /**
   * Handle row click
   * @param {number} index - Row index
   * @param {Event} event - Click event
   */
  handleRowClick(index, event) {
    const item = this.filteredItems[index];
    if (!item) return;

    const itemId = item.instanceId || item.templateId || item.id || index;

    if (this.options.selectionMode === 'none') {
      // No selection, just trigger callback
      if (this.options.onRowSelect) {
        this.options.onRowSelect(item, event);
      }
      return;
    }

    if (this.options.selectionMode === 'multi') {
      // Toggle selection
      if (this.selectedIds.has(itemId)) {
        this.selectedIds.delete(itemId);
      } else {
        this.selectedIds.add(itemId);
      }
    } else {
      // Single selection
      this.selectedIds.clear();
      this.selectedIds.add(itemId);
    }

    // Update UI
    this.updateBody();

    // Trigger callback
    if (this.options.onRowSelect) {
      this.options.onRowSelect(item, event);
    }
  }

  /**
   * Handle filter change
   * @param {Object} filterValues - New filter values
   */
  handleFilterChange(filterValues) {
    this.applyFilters(filterValues);
    this.updateBody();
  }

  /**
   * Handle sort
   * @param {string} sortKey - Key to sort by
   * @param {string} direction - 'asc' or 'desc'
   */
  handleSort(sortKey, direction) {
    this.sortColumn = sortKey;
    this.sortDirection = direction;
    this.applySort();
    this.updateBody();
    this.updateHeader();
  }

  /**
   * Apply filters to items
   * @param {Object} filterValues - Filter values (optional, uses current if not provided)
   */
  applyFilters(filterValues = null) {
    const filters = filterValues || (this.filtersComponent ? this.filtersComponent.getValues() : {});

    this.filteredItems = this.items.filter(item => {
      // Search filter
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const name = (item.name || item.templateName || '').toLowerCase();
        const desc = (item.description || '').toLowerCase();
        if (!name.includes(searchLower) && !desc.includes(searchLower)) {
          return false;
        }
      }

      // Type filter
      if (filters.type && item.type !== filters.type) {
        return false;
      }

      // Rarity filter
      if (filters.rarity && normalizeRarity(item.rarity) !== filters.rarity) {
        return false;
      }

      // Augment filter
      if (filters.augment) {
        const hasAugment = item.augments?.some(aug =>
          aug.category === filters.augment || aug.type === filters.augment
        );
        if (!hasAugment) {
          return false;
        }
      }

      return true;
    });

    // Apply current sort
    this.applySort();
  }

  /**
   * Apply sorting to filtered items
   */
  applySort() {
    if (!this.sortColumn) return;

    this.filteredItems.sort((a, b) => {
      let aVal = this.getSortValue(a, this.sortColumn);
      let bVal = this.getSortValue(b, this.sortColumn);

      // Handle null/undefined
      if (aVal == null) aVal = '';
      if (bVal == null) bVal = '';

      // String comparison
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        const cmp = aVal.localeCompare(bVal);
        return this.sortDirection === 'asc' ? cmp : -cmp;
      }

      // Numeric comparison
      const cmp = aVal - bVal;
      return this.sortDirection === 'asc' ? cmp : -cmp;
    });
  }

  /**
   * Get the sort value for an item
   * @param {Object} item - Item to get value from
   * @param {string} key - Sort key
   * @returns {*} Sort value
   */
  getSortValue(item, key) {
    if (key === 'name') {
      return item.name || item.templateName || '';
    }
    return item[key];
  }

  /**
   * Set items data
   * @param {Array<Object>} items - New items array
   */
  setItems(items) {
    this.items = [...(items || [])];
    this.applyFilters();
    this.updateBody();
  }

  /**
   * Add items to existing data
   * @param {Array<Object>} items - Items to add
   */
  addItems(items) {
    this.items.push(...(items || []));
    this.applyFilters();
    this.updateBody();
  }

  /**
   * Remove an item by ID
   * @param {string|number} itemId - Item ID to remove
   */
  removeItem(itemId) {
    this.items = this.items.filter(item => {
      const id = item.instanceId || item.templateId || item.id;
      return id !== itemId;
    });
    this.selectedIds.delete(itemId);
    this.applyFilters();
    this.updateBody();
  }

  /**
   * Get selected items
   * @returns {Array<Object>} Selected items
   */
  getSelectedItems() {
    return this.filteredItems.filter(item => {
      const itemId = item.instanceId || item.templateId || item.id;
      return this.selectedIds.has(itemId);
    });
  }

  /**
   * Get first selected item (for single selection mode)
   * @returns {Object|null} Selected item or null
   */
  getSelectedItem() {
    const selected = this.getSelectedItems();
    return selected.length > 0 ? selected[0] : null;
  }

  /**
   * Clear selection
   */
  clearSelection() {
    this.selectedIds.clear();
    this.updateBody();
  }

  /**
   * Select an item by ID
   * @param {string|number} itemId - Item ID to select
   */
  selectItem(itemId) {
    if (this.options.selectionMode === 'single') {
      this.selectedIds.clear();
    }
    this.selectedIds.add(itemId);
    this.updateBody();
  }

  /**
   * Set loading state
   * @param {boolean} loading - Whether loading
   */
  setLoading(loading) {
    this.isLoading = loading;
    this.updateBody();
  }

  /**
   * Set empty message
   * @param {string} message - Empty state message
   */
  setEmptyMessage(message) {
    this.options.emptyMessage = message;
  }

  /**
   * Reset filters to default
   */
  resetFilters() {
    if (this.filtersComponent) {
      this.filtersComponent.reset();
    }
  }

  /**
   * Set max height
   * @param {number} height - Max height in pixels
   */
  setMaxHeight(height) {
    this.options.maxHeight = height;
    if (this.bodyElement) {
      this.bodyElement.style.maxHeight = `${height}px`;
    }
  }

  /**
   * Cleanup and destroy the component
   */
  destroy() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.filtersComponent) {
      this.filtersComponent.destroy();
      this.filtersComponent = null;
    }

    if (this.headerComponent) {
      this.headerComponent.destroy();
      this.headerComponent = null;
    }

    if (this.container) {
      this.container.innerHTML = '';
    }

    this.element = null;
    this.bodyElement = null;
    this.items = [];
    this.filteredItems = [];
    this.selectedIds.clear();
  }
}

export default ItemDataTable;
