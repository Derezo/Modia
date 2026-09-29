/**
 * ItemDataTable Columns - Column configuration and render functions
 *
 * This module defines the column system for ItemDataTable, including:
 * - Column renderers that format cell content
 * - Column configurations with width, sorting, and alignment
 * - Preset column combinations for common use cases (shop, marketplace, inventory)
 * - Filter options for dropdown menus
 *
 * @module ItemDataTableColumns
 *
 * @example
 * // Using a preset
 * const columns = COLUMN_PRESETS.shop; // ['rarity', 'iconName', 'supplyLevel', 'quantity', 'price']
 *
 * @example
 * // Custom column selection
 * const customColumns = ['rarity', 'iconName', 'type', 'stats', 'price'];
 *
 * @example
 * // Accessing column config
 * const priceConfig = COLUMN_CONFIGS.price;
 * console.log(priceConfig.width); // '80px'
 * console.log(priceConfig.sortable); // true
 */

import { Icon } from '../Icon.js';
import { ItemIcon } from '../ItemIcon.js';

import { escapeHtml, escapeHtmlAttribute } from '../../utils/escapeHtml.js';
import {
  formatStatValue,
  sumItemStats,
  calculateItemPower,
  normalizeRarity,
  describeAugment,
  resolveAugmentIconName
} from '../../utils/statDisplay.js';

/**
 * Format a stat delta/value in the compact "+5 STR" form
 * @param {string} stat - Stat key
 * @param {number|boolean} value - Value
 * @returns {string} Formatted text
 */
function formatStatAbbrev(stat, value) {
  return formatStatValue(stat, value, true);
}

/**
 * Numeric entries of an item's summed stats
 * @param {Object} item - Item
 * @param {boolean} [includeCombat=false] - Include attack/defense
 * @returns {Array<[string, number|boolean]>}
 */
function statEntries(item, includeCombat = false) {
  return Object.entries(sumItemStats(item, { includeCombat }))
    .filter(([, v]) => v === true || (typeof v === 'number' && v !== 0));
}

/**
 * Render the item name span with rarity colour, ellipsis and full-name tooltip
 * @param {Object} item - Item
 * @param {string} fallback - Fallback name
 * @returns {string} HTML
 */
function renderItemName(item, fallback) {
  const rawName = item.name || item.templateName || fallback;
  const rarityClass = `rarity-${normalizeRarity(item.rarity)}`;
  const augmentCount = Array.isArray(item.augments) ? item.augments.length : 0;
  const augmentTitle = augmentCount > 0
    ? item.augments.map(aug => describeAugment(aug).text).filter(Boolean).join('\n')
    : '';
  const augmentChip = augmentCount > 0
    ? `<span class="item-data-table-aug-count" title="${escapeHtmlAttribute(augmentTitle)}">${augmentCount} aug</span>`
    : '';
  return `<span class="item-data-table-item-name ${rarityClass}" title="${escapeHtmlAttribute(rawName)}">${escapeHtml(rawName)}</span>${augmentChip}`;
}

/**
 * Capitalize first letter
 * @param {string} str - String to capitalize
 * @returns {string} Capitalized string
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Column render functions.
 *
 * Each renderer takes an item object and returns an HTML string.
 * Renderers handle null/undefined values gracefully.
 *
 * @type {Object.<string, function(Object): string>}
 *
 * @property {function} rarity - Empty renderer (rarity shown via row border)
 * @property {function} iconName - Icon + item name with rarity coloring
 * @property {function} quantity - Stack quantity (hidden if <= 1)
 * @property {function} price - Price in gold with 'g' suffix
 * @property {function} stats - Top 3 stats abbreviated (e.g., "+5 STR, +3 INT")
 * @property {function} augments - Augment icons (max 4)
 * @property {function} seller - Seller character name
 * @property {function} type - Capitalized item type
 * @property {function} supplyLevel - Shop supply level badge
 * @property {function} estimatedPrice - Estimated/suggested price with ~ prefix
 */
export const COLUMN_RENDERERS = {
  /**
   * Rarity column - renders empty, rarity shown via row border
   */
  rarity: () => '',

  /**
   * Icon + Name column
   * Uses composited icons for items with augments (lazy loaded to avoid blocking)
   */
  iconName: (item) => {
    // Initial render uses standard icon (non-blocking)
    const iconHtml = ItemIcon.html({ item, size: 'sm' });

    // Generate unique ID for async update
    const itemId = item.id || item.inventory_id || Math.random().toString(36).slice(2);
    const iconContainerId = `item-icon-${String(itemId).replace(/[^\w-]/g, '_')}`;

    // Check if compositing is needed (has augments and valid rarity/sprite)
    const hasAugments = item.augments && item.augments.length > 0;
    const canComposite = hasAugments && (item.sprite_id || item.spriteId);

    if (canComposite) {
      // Schedule async compositing after initial render
      queueMicrotask(() => {
        const container = document.getElementById(iconContainerId);
        if (!container) return;

        // Use ItemIcon.compositeHtml for augmented items
        ItemIcon.compositeHtml({ item, size: 'sm' })
          .then(compositeIconHtml => {
            // Only update if container still exists
            const current = document.getElementById(iconContainerId);
            if (current) {
              current.innerHTML = compositeIconHtml;
            }
          })
          .catch(() => {
            // On failure, keep the standard icon (already rendered)
          });
      });
    }

    return `
      <div class="item-data-table-icon-name">
        <span id="${iconContainerId}">${iconHtml}</span>
        ${renderItemName(item, 'Unknown Item')}
      </div>
    `;
  },

  /**
   * Quantity column. Unlimited stock (caravan starter gear) renders as infinity.
   */
  quantity: (item) => {
    if (item.unlimitedStock === true || item.quantity === Infinity) {
      return '<span class="item-data-table-quantity item-data-table-quantity--unlimited" title="Unlimited stock">&infin;</span>';
    }
    if (!item.quantity || item.quantity <= 1) return '';
    return `<span class="item-data-table-quantity">x${escapeHtml(String(item.quantity))}</span>`;
  },

  /**
   * Price column with gold icon
   */
  price: (item) => {
    if (item.price === undefined || item.price === null) return '-';
    const priceValue = typeof item.price === 'number' ? item.price.toLocaleString() : item.price;
    return `
      <span class="item-data-table-price">
        ${priceValue}g
      </span>
    `;
  },

  /**
   * Stats preview column - shows top 3 stats
   */
  stats: (item) => {
    // Base and bonus stats sum per key (a bonus adds to, not replaces, the base)
    const entries = statEntries(item);

    if (entries.length === 0) return '-';

    const all = entries.map(([k, v]) => formatStatAbbrev(k, v));
    const shown = entries
      .slice(0, 3)
      .map(([k, v]) => {
        const cls = typeof v === 'number' && v < 0 ? 'stat-negative' : 'item-data-table-stat-bonus';
        return `<span class="${cls}">${escapeHtml(formatStatAbbrev(k, v))}</span>`;
      })
      .join(', ');
    return `<span class="item-data-table-stats" title="${escapeHtmlAttribute(all.join(', '))}">${shown}</span>`;
  },

  /**
   * Augments column - shows augment icons
   */
  augments: (item) => {
    if (!item.augments || item.augments.length === 0) return '-';

    return `
      <div class="item-data-table-augments">
        ${item.augments.slice(0, 4).map(aug => {
    const { text } = describeAugment(aug);
    return Icon.html('augments', resolveAugmentIconName(aug), { size: 'sm', title: text }) || '';
  }).join('')}
      </div>
    `;
  },

  /**
   * Seller column
   */
  seller: (item) => {
    if (!item.seller) return '-';
    return `<span class="item-data-table-seller">${escapeHtml(item.seller)}</span>`;
  },

  /**
   * Type column
   */
  type: (item) => {
    return `<span class="item-data-table-type">${capitalize(item.type || '')}</span>`;
  },

  /**
   * Supply level column - shows stock availability badge for shops
   * @param {Object} item - Item with supplyLevel and optional supplyLabel
   * @returns {string} HTML for supply badge
   */
  supplyLevel: (item) => {
    const level = item.supplyLevel || 'medium';
    const label = item.supplyLabel || capitalize(level);
    return `<span class="item-data-table-supply-badge supply-${level}">${escapeHtml(label)}</span>`;
  },

  /**
   * Estimated price column - shows suggested/estimated price for inventory items
   * @param {Object} item - Item with estimatedPrice
   * @returns {string} HTML for estimated price
   */
  estimatedPrice: (item) => {
    if (item.estimatedPrice === undefined || item.estimatedPrice === null) return '-';
    const priceValue = typeof item.estimatedPrice === 'number' ? item.estimatedPrice.toLocaleString() : item.estimatedPrice;
    return `
      <span class="item-data-table-price item-data-table-estimated-price">
        ~${priceValue}g
      </span>
    `;
  },

  /**
   * Equipment slot column - shows slot name for equipment slot tables
   * @param {Object} row - Row with slotName property
   * @returns {string} HTML for slot name
   */
  slot: (row) => {
    const slotName = row.slotName || capitalize(row.slotKey || '');
    return `<span class="item-data-table-slot">${escapeHtml(slotName)}</span>`;
  },

  /**
   * Equipped item column - shows currently equipped item or "Empty"
   * Uses composited icons for items with augments (lazy loaded to avoid blocking)
   * @param {Object} row - Row with item property (can be null)
   * @returns {string} HTML for equipped item
   */
  equippedItem: (row) => {
    if (!row.item) {
      return '<span class="item-data-table-empty-slot">Empty</span>';
    }

    const item = row.item;
    const iconHtml = ItemIcon.html({ item, size: 'sm' });

    // Generate unique ID for async update
    const itemId = item.id || item.inventory_id || Math.random().toString(36).slice(2);
    const iconContainerId = `equipped-icon-${String(itemId).replace(/[^\w-]/g, '_')}`;

    // Check if compositing is needed (has augments and valid rarity/sprite)
    const hasAugments = item.augments && item.augments.length > 0;
    const canComposite = hasAugments && (item.sprite_id || item.spriteId);

    if (canComposite) {
      // Schedule async compositing after initial render
      queueMicrotask(() => {
        const container = document.getElementById(iconContainerId);
        if (!container) return;

        ItemIcon.compositeHtml({ item, size: 'sm' })
          .then(compositeIconHtml => {
            const current = document.getElementById(iconContainerId);
            if (current) {
              current.innerHTML = compositeIconHtml;
            }
          })
          .catch(() => {
            // On failure, keep the standard icon
          });
      });
    }

    return `
      <div class="item-data-table-icon-name">
        <span id="${iconContainerId}">${iconHtml}</span>
        ${renderItemName(item, 'Unknown')}
      </div>
    `;
  },

  /**
   * Stat comparison column - shows stat differences vs currently equipped item
   * Requires options.compareItem to be passed to the renderer
   * @param {Object} item - Item to compare
   * @param {Object} options - Options containing compareItem
   * @returns {string} HTML for stat comparison
   */
  statComparison: (item, options = {}) => {
    const current = options.compareItem;

    // If no comparison item, show dashes
    if (!current && !item) return '-';

    // Summed stats (attack/defense included) for both items
    const itemStats = sumItemStats(item, { includeCombat: true });
    const currentStats = sumItemStats(current, { includeCombat: true });
    const itemPower = calculateItemPower(item);
    const currentPower = calculateItemPower(current);

    // If comparing to nothing (empty slot), show all as positive
    if (!current) {
      const entries = statEntries(item, true);
      if (entries.length === 0) return '-';
      return entries.slice(0, 3)
        .map(([k, v]) => `<span class="${typeof v === 'number' && v < 0 ? 'stat-negative' : 'stat-positive'}">${escapeHtml(formatStatAbbrev(k, v))}</span>`)
        .join(', ');
    }

    // Calculate differences, attack/defense first
    const diffs = [];
    const keys = new Set([...Object.keys(itemStats), ...Object.keys(currentStats)]);
    const ordered = ['attack', 'defense', ...[...keys].filter(k => k !== 'attack' && k !== 'defense')];
    for (const key of ordered) {
      if (diffs.length >= 3) break;
      const a = itemStats[key];
      const b = currentStats[key];
      if (typeof a === 'boolean' || typeof b === 'boolean') continue;
      const diff = (a || 0) - (b || 0);
      if (diff !== 0) {
        const cls = diff > 0 ? 'stat-positive' : 'stat-negative';
        diffs.push(`<span class="${cls}">${escapeHtml(formatStatAbbrev(key, diff))}</span>`);
      }
    }

    if (diffs.length === 0) {
      // No stat differences, show overall comparison
      if (itemPower > currentPower) {
        return '<span class="stat-positive">Better</span>';
      } else if (itemPower < currentPower) {
        return '<span class="stat-negative">Worse</span>';
      }
      return '<span class="stat-neutral">Same</span>';
    }

    return diffs.join(', ');
  }
};

/**
 * @typedef {Object} ColumnConfig
 * @property {string} key - Column identifier
 * @property {string} label - Display header text
 * @property {string} width - Fixed width (e.g., '80px') or 'flex' for flexible
 * @property {number} [flex] - Flex ratio (default 1) when width is 'flex'
 * @property {boolean} sortable - Whether clicking the header sorts the column
 * @property {string} [sortKey] - Key to sort by (defaults to key)
 * @property {string} [align] - 'left' | 'center' | 'right'
 * @property {function(Object): string} render - Function that returns HTML for the cell
 */

/**
 * Column configuration definitions.
 *
 * Each configuration specifies how a column behaves and renders.
 *
 * @type {Object.<string, ColumnConfig>}
 *
 * @example
 * // Get config for a specific column
 * const config = COLUMN_CONFIGS.price;
 * // config = { key: 'price', label: 'Price', width: '80px', sortable: true, ... }
 */
export const COLUMN_CONFIGS = {
  rarity: {
    key: 'rarity',
    label: '',
    width: '4px',
    sortable: false,
    render: COLUMN_RENDERERS.rarity
  },
  iconName: {
    key: 'iconName',
    label: 'Item',
    width: 'flex',
    flex: 1,
    sortable: true,
    sortKey: 'name',
    render: COLUMN_RENDERERS.iconName
  },
  quantity: {
    key: 'quantity',
    label: 'Qty',
    width: '60px',
    sortable: true,
    sortKey: 'quantity',
    align: 'center',
    render: COLUMN_RENDERERS.quantity
  },
  price: {
    key: 'price',
    label: 'Price',
    width: '80px',
    sortable: true,
    sortKey: 'price',
    align: 'right',
    render: COLUMN_RENDERERS.price
  },
  stats: {
    key: 'stats',
    label: 'Stats',
    width: '140px',
    sortable: false,
    render: COLUMN_RENDERERS.stats
  },
  augments: {
    key: 'augments',
    label: 'Augments',
    width: '104px',
    sortable: false,
    render: COLUMN_RENDERERS.augments
  },
  seller: {
    key: 'seller',
    label: 'Seller',
    width: '100px',
    sortable: true,
    sortKey: 'seller',
    render: COLUMN_RENDERERS.seller
  },
  type: {
    key: 'type',
    label: 'Type',
    width: '80px',
    sortable: true,
    sortKey: 'type',
    render: COLUMN_RENDERERS.type
  },
  supplyLevel: {
    key: 'supplyLevel',
    label: 'Supply',
    width: '80px',
    sortable: true,
    sortKey: 'supplyLevel',
    align: 'center',
    render: COLUMN_RENDERERS.supplyLevel
  },
  estimatedPrice: {
    key: 'estimatedPrice',
    label: 'Est. Price',
    width: '90px',
    sortable: true,
    sortKey: 'estimatedPrice',
    align: 'right',
    render: COLUMN_RENDERERS.estimatedPrice
  },
  slot: {
    key: 'slot',
    label: 'Slot',
    width: '100px',
    sortable: false,
    render: COLUMN_RENDERERS.slot
  },
  equippedItem: {
    key: 'equippedItem',
    label: 'Equipped',
    width: 'flex',
    flex: 1,
    sortable: false,
    render: COLUMN_RENDERERS.equippedItem
  },
  statComparison: {
    key: 'statComparison',
    label: 'vs Current',
    width: '140px',
    sortable: false,
    render: COLUMN_RENDERERS.statComparison
  }
};

/**
 * Predefined column presets for different variants.
 *
 * @type {Object.<string, string[]>}
 * @property {string[]} default - Default columns for general use
 * @property {string[]} shop - Shop variant with supply level indicator
 * @property {string[]} marketplace - Marketplace variant with seller, stats, augments
 * @property {string[]} inventory - Personal inventory view
 * @property {string[]} formation - Equipment selection for formations
 * @property {string[]} sellable - Items available to list for sale (with estimated prices)
 */
export const COLUMN_PRESETS = {
  default: ['rarity', 'iconName', 'quantity', 'price'],
  shop: ['rarity', 'iconName', 'supplyLevel', 'quantity', 'price'],
  marketplace: ['rarity', 'iconName', 'stats', 'augments', 'price', 'seller'],
  inventory: ['rarity', 'iconName', 'type', 'quantity'],
  formation: ['rarity', 'iconName', 'type', 'stats'],
  sellable: ['rarity', 'iconName', 'quantity', 'estimatedPrice'],
  'equipment-slots': ['slot', 'equippedItem', 'stats'],
  'equipment-available': ['rarity', 'iconName', 'stats', 'statComparison']
};

/**
 * @typedef {Object} FilterOption
 * @property {string} value - Option value (empty string for "All")
 * @property {string} label - Display label
 */

/**
 * Filter options for dropdown menus.
 *
 * Each filter type has an array of options with value/label pairs.
 * The first option in each array is typically the "All" option with empty value.
 *
 * @type {Object.<string, FilterOption[]>}
 *
 * @property {FilterOption[]} type - Item type filter options (weapon, armor, etc.)
 * @property {FilterOption[]} rarity - Rarity filter options (common to legendary)
 * @property {FilterOption[]} augment - Augment category filter options (fire, ice, etc.)
 *
 * @example
 * // Use in a select element
 * FILTER_OPTIONS.type.forEach(opt => {
 *   console.log(`<option value="${opt.value}">${opt.label}</option>`);
 * });
 */
export const FILTER_OPTIONS = {
  type: [
    { value: '', label: 'All Types' },
    { value: 'weapon', label: 'Weapons' },
    { value: 'armor', label: 'Armor' },
    { value: 'accessory', label: 'Accessories' },
    { value: 'consumable', label: 'Consumables' },
    { value: 'material', label: 'Materials' }
  ],

  rarity: [
    { value: '', label: 'All Rarities' },
    { value: 'common', label: 'Common' },
    { value: 'uncommon', label: 'Uncommon' },
    { value: 'rare', label: 'Rare' },
    { value: 'epic', label: 'Epic' },
    { value: 'legendary', label: 'Legendary' }
  ],

  augment: [
    { value: '', label: 'Any Augment' },
    { value: 'fire', label: 'Fire' },
    { value: 'ice', label: 'Ice' },
    { value: 'lightning', label: 'Lightning' },
    { value: 'poison', label: 'Poison' },
    { value: 'holy', label: 'Holy' },
    { value: 'dark', label: 'Dark' },
    { value: 'strength', label: 'Strength' },
    { value: 'intelligence', label: 'Intelligence' },
    { value: 'agility', label: 'Agility' },
    { value: 'vitality', label: 'Vitality' },
    { value: 'critical', label: 'Critical' },
    { value: 'defense', label: 'Defense' }
  ]
};

export default {
  COLUMN_RENDERERS,
  COLUMN_CONFIGS,
  COLUMN_PRESETS,
  FILTER_OPTIONS
};
