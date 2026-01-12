/**
 * ItemDataTable Columns - Column configuration and render functions
 */

import { Icon } from '../Icon.js';

/**
 * Escape HTML to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Format stat abbreviation
 * @param {string} stat - Full stat name
 * @returns {string} Abbreviated stat name
 */
function formatStatAbbrev(stat) {
  const abbrevs = {
    strength: 'STR',
    intelligence: 'INT',
    agility: 'AGI',
    vitality: 'VIT',
    defense: 'DEF',
    magicDefense: 'MDEF',
    attack: 'ATK',
    magicAttack: 'MATK',
    criticalChance: 'CRIT',
    criticalDamage: 'CDMG',
    evasion: 'EVA',
    accuracy: 'ACC'
  };
  return abbrevs[stat] || stat.substring(0, 3).toUpperCase();
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
 * Column render functions
 */
export const COLUMN_RENDERERS = {
  /**
   * Rarity column - renders empty, rarity shown via row border
   */
  rarity: () => '',

  /**
   * Icon + Name column
   */
  iconName: (item) => {
    const iconType = item.type || 'weapon';
    const iconHtml = Icon.html('items', iconType, { size: 'sm' }) || '';
    const rarityClass = `rarity-${item.rarity || 'common'}`;
    const name = escapeHtml(item.name || item.templateName || 'Unknown Item');

    return `
      <div class="item-data-table-icon-name">
        ${iconHtml}
        <span class="item-data-table-item-name ${rarityClass}">${name}</span>
      </div>
    `;
  },

  /**
   * Quantity column
   */
  quantity: (item) => {
    if (!item.quantity || item.quantity <= 1) return '';
    return `<span class="item-data-table-quantity">x${item.quantity}</span>`;
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
    const stats = { ...(item.baseStats || {}), ...(item.bonusStats || {}) };
    const entries = Object.entries(stats).filter(([, v]) => v && v !== 0);

    if (entries.length === 0) return '-';

    return entries
      .slice(0, 3)
      .map(([k, v]) => {
        const sign = v > 0 ? '+' : '';
        return `<span class="item-data-table-stat-bonus">${sign}${v} ${formatStatAbbrev(k)}</span>`;
      })
      .join(', ');
  },

  /**
   * Augments column - shows augment icons
   */
  augments: (item) => {
    if (!item.augments || item.augments.length === 0) return '-';

    return `
      <div class="item-data-table-augments">
        ${item.augments.slice(0, 4).map(aug => {
          const category = aug.category || aug.type || 'holy';
          return Icon.html('augments', category, { size: 'sm' }) || '';
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
  }
};

/**
 * Column configuration definitions
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
    width: '80px',
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
  }
};

/**
 * Predefined column presets for different variants
 */
export const COLUMN_PRESETS = {
  default: ['rarity', 'iconName', 'quantity', 'price'],
  shop: ['rarity', 'iconName', 'quantity', 'price'],
  marketplace: ['rarity', 'iconName', 'stats', 'augments', 'price', 'seller'],
  inventory: ['rarity', 'iconName', 'type', 'quantity'],
  formation: ['rarity', 'iconName', 'type', 'stats']
};

/**
 * Filter options for dropdowns
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
