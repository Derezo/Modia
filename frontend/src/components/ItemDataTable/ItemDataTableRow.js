/**
 * ItemDataTableRow - Row rendering for ItemDataTable
 */

import { COLUMN_CONFIGS } from './itemDataTableColumns.js';
import { escapeHtml } from '../../utils/escapeHtml.js';

/**
 * Static class for rendering table rows
 */
export class ItemDataTableRow {
  /**
   * Render a single row
   * @param {Object} item - Item data
   * @param {Array<string>} columns - Array of column keys
   * @param {boolean} isSelected - Whether the row is selected
   * @param {number} index - Row index for data attribute
   * @returns {string} HTML string for the row
   */
  static render(item, columns, isSelected = false, index = 0) {
    const rarityClass = `rarity-${item.rarity || 'common'}`;
    const selectedClass = isSelected ? 'selected' : '';

    const cells = columns.map(columnKey => {
      const config = COLUMN_CONFIGS[columnKey];
      if (!config) return '';

      // Get rendered content
      const content = config.render ? config.render(item) : '';

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
        <div class="item-data-table-cell" style="${widthStyle} ${alignStyle}">
          ${content}
        </div>
      `;
    }).join('');

    return `
      <div
        class="item-data-table-row ${rarityClass} ${selectedClass}"
        data-index="${index}"
        data-item-id="${item.instanceId || item.templateId || item.id || index}"
      >
        ${cells}
      </div>
    `;
  }

  /**
   * Render multiple rows
   * @param {Array<Object>} items - Array of item data
   * @param {Array<string>} columns - Array of column keys
   * @param {Set<string|number>} selectedIds - Set of selected item IDs
   * @returns {string} HTML string for all rows
   */
  static renderAll(items, columns, selectedIds = new Set()) {
    if (!items || items.length === 0) {
      return `
        <div class="item-data-table-empty">
          <span>No items found</span>
        </div>
      `;
    }

    return items.map((item, index) => {
      const itemId = item.instanceId || item.templateId || item.id || index;
      const isSelected = selectedIds.has(itemId);
      return ItemDataTableRow.render(item, columns, isSelected, index);
    }).join('');
  }

  /**
   * Render loading state
   * @returns {string} HTML string for loading state
   */
  static renderLoading() {
    return `
      <div class="item-data-table-loading">
        <div class="item-data-table-spinner"></div>
      </div>
    `;
  }

  /**
   * Render empty state with custom message
   * @param {string} message - Empty state message
   * @returns {string} HTML string for empty state
   */
  static renderEmpty(message = 'No items found') {
    return `
      <div class="item-data-table-empty">
        <span>${escapeHtml(message)}</span>
      </div>
    `;
  }

}

export default ItemDataTableRow;
