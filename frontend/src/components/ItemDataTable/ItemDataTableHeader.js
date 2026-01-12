/**
 * ItemDataTableHeader - Sortable header component for ItemDataTable
 */

import { COLUMN_CONFIGS } from './itemDataTableColumns.js';

/**
 * Renders and manages the sortable header row
 */
export class ItemDataTableHeader {
  /**
   * @param {Array<string>} columns - Array of column keys to display
   * @param {Function} onSort - Callback when a column header is clicked for sorting
   */
  constructor(columns, onSort = null) {
    this.columns = columns;
    this.onSort = onSort;
    this.sortColumn = null;
    this.sortDirection = 'asc';
  }

  /**
   * Render the header row
   * @returns {string} HTML string
   */
  render() {
    const cells = this.columns.map(columnKey => {
      const config = COLUMN_CONFIGS[columnKey];
      if (!config) return '';

      const isSorted = this.sortColumn === columnKey;
      const sortedClass = isSorted ? 'sorted' : '';
      const sortableClass = config.sortable ? 'sortable' : '';
      const sortIcon = this.getSortIcon(columnKey);

      // Calculate width style
      let widthStyle = '';
      if (config.width === 'flex' || config.flex) {
        widthStyle = `flex: ${config.flex || 1};`;
      } else if (config.width) {
        widthStyle = `width: ${config.width}; flex-shrink: 0;`;
      }

      // Align style
      const alignStyle = config.align ? `justify-content: ${config.align === 'right' ? 'flex-end' : config.align === 'center' ? 'center' : 'flex-start'};` : '';

      return `
        <div
          class="item-data-table-header-cell ${sortableClass} ${sortedClass}"
          data-column="${columnKey}"
          data-sortable="${config.sortable}"
          style="${widthStyle} ${alignStyle}"
        >
          ${this.escapeHtml(config.label)}
          ${config.sortable ? `<span class="item-data-table-sort-icon">${sortIcon}</span>` : ''}
        </div>
      `;
    }).join('');

    return `<div class="item-data-table-header">${cells}</div>`;
  }

  /**
   * Get the sort icon for a column
   * @param {string} columnKey - Column key
   * @returns {string} Sort icon character
   */
  getSortIcon(columnKey) {
    if (this.sortColumn !== columnKey) {
      return '⇅';
    }
    return this.sortDirection === 'asc' ? '▲' : '▼';
  }

  /**
   * Bind click events for sorting
   * @param {HTMLElement} container - Container element
   * @param {AbortSignal} signal - AbortController signal for cleanup
   */
  bindEvents(container, signal) {
    const header = container.querySelector('.item-data-table-header');
    if (!header) return;

    header.addEventListener('click', (e) => {
      const cell = e.target.closest('.item-data-table-header-cell');
      if (!cell) return;

      const sortable = cell.dataset.sortable === 'true';
      if (!sortable) return;

      const columnKey = cell.dataset.column;
      this.handleSort(columnKey);
    }, { signal });
  }

  /**
   * Handle sort column click
   * @param {string} columnKey - Column key that was clicked
   */
  handleSort(columnKey) {
    if (this.sortColumn === columnKey) {
      // Toggle direction
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      // New column, start with ascending
      this.sortColumn = columnKey;
      this.sortDirection = 'asc';
    }

    if (this.onSort) {
      const config = COLUMN_CONFIGS[columnKey];
      const sortKey = config?.sortKey || columnKey;
      this.onSort(sortKey, this.sortDirection);
    }
  }

  /**
   * Set current sort state
   * @param {string} column - Column key
   * @param {string} direction - 'asc' or 'desc'
   */
  setSort(column, direction) {
    this.sortColumn = column;
    this.sortDirection = direction;
  }

  /**
   * Clear sort state
   */
  clearSort() {
    this.sortColumn = null;
    this.sortDirection = 'asc';
  }

  /**
   * Escape HTML entities
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Cleanup
   */
  destroy() {
    this.onSort = null;
  }
}

export default ItemDataTableHeader;
