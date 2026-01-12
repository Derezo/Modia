/**
 * ItemDataTable - Modular data table component for displaying items
 *
 * A reusable, sortable, filterable table component designed for game item displays.
 * Supports multiple variants (shop, marketplace, inventory, formation) with
 * configurable columns, filters, and selection modes.
 *
 * @module ItemDataTable
 *
 * ## Quick Start
 *
 * @example
 * // Basic usage with shop variant
 * import { ItemDataTable } from './components/ItemDataTable';
 *
 * const table = new ItemDataTable(container, {
 *   items: shopItems,
 *   variant: 'shop',
 *   onRowSelect: (item) => showItemDetails(item),
 *   onRowDoubleClick: (item) => quickBuy(item)
 * });
 *
 * ## Variants
 *
 * @example
 * // Shop variant - includes supply level badge
 * // Columns: rarity, iconName, supplyLevel, quantity, price
 * new ItemDataTable(container, { variant: 'shop', items });
 *
 * @example
 * // Marketplace variant - includes seller, stats, augments
 * // Columns: rarity, iconName, stats, augments, price, seller
 * new ItemDataTable(container, {
 *   variant: 'marketplace',
 *   items: listings,
 *   filters: { showAugmentFilter: true }
 * });
 *
 * @example
 * // Inventory variant - personal items
 * // Columns: rarity, iconName, type, quantity
 * new ItemDataTable(container, { variant: 'inventory', items: myItems });
 *
 * @example
 * // Sellable variant - items available to list for sale
 * // Columns: rarity, iconName, quantity, estimatedPrice
 * new ItemDataTable(container, { variant: 'sellable', items: sellableItems });
 *
 * ## Configuration Options
 *
 * @example
 * // Full configuration
 * new ItemDataTable(container, {
 *   // Data
 *   items: [],                          // Initial items array
 *   variant: 'shop',                    // Preset: 'default'|'shop'|'marketplace'|'inventory'|'formation'|'sellable'
 *   columns: null,                      // Custom columns array (overrides variant)
 *
 *   // Filters
 *   filters: {
 *     showTypeFilter: true,             // Show item type dropdown
 *     showRarityFilter: true,           // Show rarity dropdown
 *     showAugmentFilter: false,         // Show augment filter (marketplace)
 *     showSearch: true                  // Show search input
 *   },
 *
 *   // Events
 *   onRowSelect: (item, event) => {},   // Called when row is clicked
 *   onRowDoubleClick: (item, event) => {}, // Called on double-click
 *
 *   // Selection
 *   selectionMode: 'single',            // 'single'|'multi'|'none'
 *
 *   // UI
 *   emptyMessage: 'No items found',     // Custom empty state message
 *   maxHeight: 400                      // Max height for scrollable body (px)
 * });
 *
 * ## Public Methods
 *
 * @example
 * // Data management
 * table.setItems(newItems);             // Replace all items
 * table.addItems(moreItems);            // Append items
 * table.removeItem(itemId);             // Remove by ID
 * table.setLoading(true);               // Show loading spinner
 *
 * @example
 * // Selection
 * const item = table.getSelectedItem(); // Get single selected item
 * const items = table.getSelectedItems(); // Get all selected items (multi mode)
 * table.selectItem(itemId);             // Programmatically select
 * table.clearSelection();               // Clear all selections
 *
 * @example
 * // Filters
 * table.applyFilters({ type: 'weapon' }); // Apply filter values
 * table.resetFilters();                 // Reset to defaults
 *
 * @example
 * // UI
 * table.setMaxHeight(500);              // Update max height
 * table.setEmptyMessage('No weapons');  // Update empty message
 *
 * @example
 * // Cleanup
 * table.destroy();                      // Remove all listeners, clear DOM
 *
 * ## Item Data Structure
 *
 * Items should have these properties (all optional except name):
 *
 * @example
 * const item = {
 *   // Identity (at least one required for selection)
 *   instanceId: 'inv_123',              // Unique instance ID
 *   templateId: 5,                      // Item template ID
 *   id: 'any_id',                       // Generic ID fallback
 *
 *   // Display
 *   name: 'Iron Sword',                 // Item name (required)
 *   type: 'weapon',                     // Item type for filtering
 *   rarity: 'rare',                     // common|uncommon|rare|epic|legendary
 *   description: 'A sturdy blade',      // For search filtering
 *   quantity: 5,                        // Stack size
 *   price: 150,                         // Price in gold
 *
 *   // Stats (for stats column)
 *   baseStats: { strength: 10 },
 *   bonusStats: { agility: 5 },
 *
 *   // Augments (for augments column)
 *   augments: [{ category: 'fire', type: 'fire' }],
 *
 *   // Shop-specific
 *   supplyLevel: 'high',                // scarce|low|medium|high|surplus
 *   supplyLabel: 'High Stock',          // Display label
 *
 *   // Marketplace-specific
 *   seller: 'PlayerName',               // Seller character name
 *   estimatedPrice: 200                 // Suggested price
 * };
 */

export { ItemDataTable } from './ItemDataTable.js';
export { ItemDataTableFilters } from './ItemDataTableFilters.js';
export { ItemDataTableHeader } from './ItemDataTableHeader.js';
export { ItemDataTableRow } from './ItemDataTableRow.js';
export { COLUMN_CONFIGS, COLUMN_PRESETS, FILTER_OPTIONS, COLUMN_RENDERERS } from './itemDataTableColumns.js';
export { injectItemDataTableStyles } from './itemDataTableStyles.js';

// Default export
export { ItemDataTable as default } from './ItemDataTable.js';
