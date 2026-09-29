/**
 * ItemDataTable Styles - Scoped CSS injection for the ItemDataTable component
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentScrollbarCSS
} from '../../ui/parchment/ParchmentTheme.js';

const STYLE_ID = 'item-data-table-styles';

/**
 * Inject ItemDataTable styles into the document head
 * Only injects once, checking for existing style tag
 */
export function injectItemDataTableStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* Container */
    .item-data-table-container {
      display: flex;
      flex-direction: column;
      background: ${getParchmentGradient()};
      border: ${getParchmentBorder()};
      border-radius: ${PARCHMENT_RADIUS.md};
      overflow: hidden;
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
    }

    /* Filter Bar */
    .item-data-table-filters {
      display: flex;
      gap: ${PARCHMENT_SPACING.sm};
      padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
      background: linear-gradient(to bottom, ${PARCHMENT_COLORS.mid}, ${PARCHMENT_COLORS.light});
      border-bottom: ${getParchmentBorder(1)};
      flex-wrap: wrap;
      align-items: center;
    }

    .item-data-table-search {
      flex: 1;
      min-width: 120px;
      max-width: 200px;
      padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.sm};
      background: ${PARCHMENT_COLORS.light};
      border: 1px solid ${PARCHMENT_COLORS.border};
      border-radius: ${PARCHMENT_RADIUS.sm};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      color: ${PARCHMENT_COLORS.text.primary};
      outline: none;
      transition: border-color 0.2s ease;
    }

    .item-data-table-search:focus {
      border-color: ${PARCHMENT_COLORS.borderDark};
    }

    .item-data-table-search::placeholder {
      color: ${PARCHMENT_COLORS.text.muted};
    }

    .item-data-table-filter-select {
      padding: ${PARCHMENT_SPACING.xs} ${PARCHMENT_SPACING.sm};
      background: ${PARCHMENT_COLORS.light};
      border: 1px solid ${PARCHMENT_COLORS.border};
      border-radius: ${PARCHMENT_RADIUS.sm};
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      color: ${PARCHMENT_COLORS.text.primary};
      cursor: pointer;
      outline: none;
      min-width: 100px;
    }

    .item-data-table-filter-select:focus {
      border-color: ${PARCHMENT_COLORS.borderDark};
    }

    /* Table Header */
    .item-data-table-header {
      display: flex;
      background: linear-gradient(to bottom, ${PARCHMENT_COLORS.dark}, ${PARCHMENT_COLORS.borderDark});
      border-bottom: ${getParchmentBorder(1)};
      min-height: 36px;
    }

    .item-data-table-header-cell {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
      color: ${PARCHMENT_COLORS.text.inverse};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      text-transform: uppercase;
      letter-spacing: 0.5px;
      user-select: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .item-data-table-header-cell.sortable {
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .item-data-table-header-cell.sortable:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .item-data-table-sort-icon {
      font-size: 10px;
      opacity: 0.5;
      transition: opacity 0.15s ease;
    }

    .item-data-table-header-cell.sorted .item-data-table-sort-icon {
      opacity: 1;
    }

    /* Table Body */
    .item-data-table-body {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      max-height: 400px;
    }

    ${getParchmentScrollbarCSS('.item-data-table-body')}

    /* Table Row */
    .item-data-table-row {
      display: flex;
      align-items: center;
      padding: ${PARCHMENT_SPACING.sm} 0;
      border-bottom: 1px solid ${PARCHMENT_COLORS.border};
      cursor: pointer;
      transition: background 0.15s ease;
      min-height: 44px;
    }

    .item-data-table-row:hover {
      background: ${PARCHMENT_COLORS.mid};
    }

    .item-data-table-row.selected {
      background: linear-gradient(to bottom, #e8d9a8, #d4c498);
      border-color: ${PARCHMENT_COLORS.accent.burgundy};
    }

    .item-data-table-row:last-child {
      border-bottom: none;
    }

    /* Rarity indicators (left border) */
    .item-data-table-row.rarity-common {
      border-left: 3px solid #9e9e9e;
    }
    .item-data-table-row.rarity-uncommon {
      border-left: 3px solid #1eff00;
    }
    .item-data-table-row.rarity-rare {
      border-left: 3px solid #0070dd;
    }
    .item-data-table-row.rarity-epic {
      border-left: 3px solid #a335ee;
    }
    .item-data-table-row.rarity-legendary {
      border-left: 3px solid #ff8000;
    }

    /* Table Cell */
    .item-data-table-cell {
      display: flex;
      align-items: center;
      padding: 0 ${PARCHMENT_SPACING.md};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      color: ${PARCHMENT_COLORS.text.primary};
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Icon + Name cell */
    .item-data-table-icon-name {
      display: flex;
      align-items: center;
      gap: ${PARCHMENT_SPACING.sm};
      min-width: 0; /* lets the name ellipsize instead of being hard-clipped */
    }

    .item-data-table-icon-name > span:first-child {
      flex-shrink: 0;
    }

    .item-data-table-aug-count {
      flex-shrink: 0;
      padding: 0 5px;
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      color: ${PARCHMENT_COLORS.accent.burgundy};
      border: 1px solid currentColor;
      border-radius: 8px;
      line-height: 1.4;
    }

    .item-data-table-icon-name img {
      width: 24px;
      height: 24px;
      image-rendering: pixelated;
    }

    .item-data-table-item-name {
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item-data-table-item-name.rarity-common { color: #5a4a3a; }
    .item-data-table-item-name.rarity-uncommon { color: #2d6b2d; }
    .item-data-table-item-name.rarity-rare { color: #0055aa; }
    .item-data-table-item-name.rarity-epic { color: #7722aa; }
    .item-data-table-item-name.rarity-legendary { color: #cc6600; }

    /* Price cell */
    .item-data-table-price {
      display: flex;
      align-items: center;
      gap: 4px;
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamilyMono};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
    }

    .item-data-table-price-icon {
      width: 14px;
      height: 14px;
    }

    /* Stats preview */
    .item-data-table-stats {
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
      color: ${PARCHMENT_COLORS.text.secondary};
    }

    .item-data-table-stat-bonus {
      color: ${PARCHMENT_COLORS.state.success};
    }

    .item-data-table-stats {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item-data-table-cell .stat-negative {
      color: ${PARCHMENT_COLORS.state.error};
    }

    .item-data-table-quantity--unlimited {
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
    }

    /* Augments cell */
    .item-data-table-augments {
      display: flex;
      gap: 2px;
    }

    .item-data-table-augment-icon {
      width: 16px;
      height: 16px;
    }

    /* Empty state */
    .item-data-table-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: ${PARCHMENT_SPACING.xl};
      color: ${PARCHMENT_COLORS.text.muted};
      font-style: italic;
      min-height: 100px;
    }

    /* Loading state */
    .item-data-table-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: ${PARCHMENT_SPACING.xl};
      min-height: 100px;
    }

    .item-data-table-spinner {
      width: 24px;
      height: 24px;
      border: 3px solid ${PARCHMENT_COLORS.mid};
      border-top-color: ${PARCHMENT_COLORS.border};
      border-radius: 50%;
      animation: item-data-table-spin 0.8s linear infinite;
    }

    @keyframes item-data-table-spin {
      to { transform: rotate(360deg); }
    }

    /* Quantity cell */
    .item-data-table-quantity {
      font-family: ${PARCHMENT_TYPOGRAPHY.fontFamilyMono};
      color: ${PARCHMENT_COLORS.text.secondary};
    }

    /* Type cell */
    .item-data-table-type {
      text-transform: capitalize;
      color: ${PARCHMENT_COLORS.text.secondary};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
    }

    /* Seller cell */
    .item-data-table-seller {
      color: ${PARCHMENT_COLORS.text.secondary};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
    }

    /* Supply level badge */
    .item-data-table-supply-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: ${PARCHMENT_RADIUS.sm};
      font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
      font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: #fff;
      text-shadow: 0 1px 1px rgba(0, 0, 0, 0.3);
    }

    .item-data-table-supply-badge.supply-scarce {
      background: linear-gradient(to bottom, #c45a5a, #a04545);
    }

    .item-data-table-supply-badge.supply-low {
      background: linear-gradient(to bottom, #d4a056, #b88a45);
    }

    .item-data-table-supply-badge.supply-medium {
      background: linear-gradient(to bottom, #8b8b8b, #6e6e6e);
    }

    .item-data-table-supply-badge.supply-high {
      background: linear-gradient(to bottom, #5a9e4a, #488a3c);
    }

    .item-data-table-supply-badge.supply-surplus {
      background: linear-gradient(to bottom, #4a7eb3, #3c6a99);
    }

    /* Estimated price styling */
    .item-data-table-estimated-price {
      color: ${PARCHMENT_COLORS.text.muted};
      font-style: italic;
    }

    /* Equipment slot column */
    .item-data-table-slot {
      font-weight: 600;
      color: ${PARCHMENT_COLORS.text.primary};
    }

    /* Empty slot indicator */
    .item-data-table-empty-slot {
      color: ${PARCHMENT_COLORS.text.muted};
      font-style: italic;
    }

    /* Stat comparison colors */
    .stat-positive {
      color: ${PARCHMENT_COLORS.state.success};
      font-weight: 600;
    }

    .stat-negative {
      color: ${PARCHMENT_COLORS.state.error};
      font-weight: 600;
    }

    .stat-neutral {
      color: ${PARCHMENT_COLORS.text.muted};
    }
  `;

  document.head.appendChild(style);
}

export default { injectItemDataTableStyles };
