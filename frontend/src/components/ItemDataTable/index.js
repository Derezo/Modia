/**
 * ItemDataTable - Modular data table component for items
 *
 * @example
 * import { ItemDataTable } from './components/ItemDataTable';
 *
 * const table = new ItemDataTable(container, {
 *   items: myItems,
 *   variant: 'shop',
 *   filters: {
 *     showTypeFilter: true,
 *     showRarityFilter: true,
 *     showSearch: true
 *   },
 *   onRowSelect: (item) => handleSelect(item),
 *   onRowDoubleClick: (item) => handleDoubleClick(item)
 * });
 *
 * // Update items
 * table.setItems(newItems);
 *
 * // Get selected item
 * const selected = table.getSelectedItem();
 *
 * // Cleanup
 * table.destroy();
 */

export { ItemDataTable } from './ItemDataTable.js';
export { ItemDataTableFilters } from './ItemDataTableFilters.js';
export { ItemDataTableHeader } from './ItemDataTableHeader.js';
export { ItemDataTableRow } from './ItemDataTableRow.js';
export { COLUMN_CONFIGS, COLUMN_PRESETS, FILTER_OPTIONS, COLUMN_RENDERERS } from './itemDataTableColumns.js';
export { injectItemDataTableStyles } from './itemDataTableStyles.js';

// Default export
export { ItemDataTable as default } from './ItemDataTable.js';
