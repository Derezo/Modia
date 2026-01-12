/**
 * MarketplaceItemPanel - Display item variants/listings for a template
 * Shows full generated names, augments, stats, and allows purchasing
 */

import { Icon } from './Icon.js';

// Augment icon mappings
const AUGMENT_ICONS = {
  fire: { category: 'augments', name: 'fire' },
  ice: { category: 'augments', name: 'ice' },
  lightning: { category: 'augments', name: 'lightning' },
  poison: { category: 'augments', name: 'poison' },
  holy: { category: 'augments', name: 'holy' },
  dark: { category: 'augments', name: 'dark' },
  strength: { category: 'augments', name: 'strength' },
  intelligence: { category: 'augments', name: 'intelligence' },
  agility: { category: 'augments', name: 'agility' },
  vitality: { category: 'augments', name: 'vitality' },
  luck: { category: 'augments', name: 'luck' },
  critical: { category: 'augments', name: 'critical' },
  defense: { category: 'augments', name: 'defense' },
  dragon_slayer: { category: 'augments', name: 'dragon-slayer' },
  undead_slayer: { category: 'augments', name: 'undead-slayer' },
  demon_slayer: { category: 'augments', name: 'demon-slayer' }
};

// Parchment theme colors (shared with marketplace scene)
const PARCHMENT = {
  bg: {
    light: '#f0e8d8',
    medium: '#d4c4a8',
    dark: '#c9b899',
    darker: '#bfae8a'
  },
  border: {
    light: '#8b7355',
    dark: '#6b5344',
    darker: '#4a3a2a'
  },
  text: {
    primary: '#2d2418',
    secondary: '#5a4a3a',
    muted: '#7a6a5a',
    accent: '#2d2418'  // Use dark brown for readable accented text
  },
  rarity: {
    common: '#7a6a5a',
    uncommon: '#4a7548',
    rare: '#4a6a8b',
    epic: '#6b4488',
    legendary: '#aa8833'
  }
};

export class MarketplaceItemPanel {
  constructor(game) {
    this.game = game;
    this.element = null;
    this.templateId = null;
    this.templateName = null;
    this.listings = [];
    this.isOpen = false;
    this.onBuy = null;
    this.onClose = null;

    this.addStyles();
  }

  addStyles() {
    if (document.getElementById('marketplace-item-panel-styles')) return;

    const style = document.createElement('style');
    style.id = 'marketplace-item-panel-styles';
    style.textContent = `
      .marketplace-item-panel {
        position: absolute;
        top: 0;
        right: 0;
        width: 380px;
        height: 100%;
        background: linear-gradient(to bottom, ${PARCHMENT.bg.light} 0%, ${PARCHMENT.bg.medium} 100%);
        border-left: 3px solid ${PARCHMENT.border.dark};
        display: flex;
        flex-direction: column;
        box-shadow: -4px 0 16px rgba(0, 0, 0, 0.3);
        z-index: 100;
        transform: translateX(100%);
        transition: transform 0.3s ease;
      }

      .marketplace-item-panel.open {
        transform: translateX(0);
      }

      .item-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        background: linear-gradient(to bottom, ${PARCHMENT.border.light} 0%, ${PARCHMENT.border.dark} 100%);
        border-bottom: 2px solid ${PARCHMENT.border.darker};
      }

      .item-panel-title {
        color: ${PARCHMENT.bg.light};
        font-family: Georgia, serif;
        font-size: 16px;
        font-weight: bold;
        text-shadow: 1px 1px 0 ${PARCHMENT.border.darker};
      }

      .item-panel-close {
        background: none;
        border: none;
        color: ${PARCHMENT.bg.light};
        font-size: 24px;
        cursor: pointer;
        padding: 0 8px;
        opacity: 0.8;
        transition: opacity 0.2s;
      }

      .item-panel-close:hover {
        opacity: 1;
      }

      .item-panel-content {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
      }

      .item-panel-empty {
        text-align: center;
        padding: 40px 20px;
        color: ${PARCHMENT.text.muted};
        font-family: Georgia, serif;
        font-style: italic;
      }

      /* Individual listing card */
      .listing-card {
        background: linear-gradient(to bottom, ${PARCHMENT.bg.light} 0%, ${PARCHMENT.bg.dark} 100%);
        border: 2px solid ${PARCHMENT.border.light};
        border-radius: 6px;
        margin-bottom: 12px;
        overflow: hidden;
        transition: all 0.2s;
      }

      .listing-card:hover {
        border-color: ${PARCHMENT.border.dark};
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }

      .listing-header {
        padding: 10px 12px;
        border-bottom: 1px solid ${PARCHMENT.border.light};
      }

      .listing-name {
        font-family: Georgia, serif;
        font-weight: bold;
        font-size: 14px;
        margin-bottom: 4px;
        line-height: 1.3;
      }

      .listing-name.common { color: ${PARCHMENT.rarity.common}; }
      .listing-name.uncommon { color: ${PARCHMENT.rarity.uncommon}; }
      .listing-name.rare { color: ${PARCHMENT.rarity.rare}; }
      .listing-name.epic { color: ${PARCHMENT.rarity.epic}; }
      .listing-name.legendary { color: ${PARCHMENT.rarity.legendary}; }

      .listing-meta {
        font-size: 11px;
        color: ${PARCHMENT.text.secondary};
        font-family: Georgia, serif;
      }

      .listing-body {
        padding: 10px 12px;
      }

      .listing-stats {
        margin-bottom: 8px;
      }

      .stat-row {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        padding: 2px 0;
        font-family: Consolas, monospace;
      }

      .stat-label {
        color: ${PARCHMENT.text.secondary};
      }

      .stat-value {
        color: ${PARCHMENT.text.primary};
      }

      .stat-value.bonus {
        color: #3d6b35;
      }

      .listing-augments {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px dashed ${PARCHMENT.border.light};
      }

      .augment-item {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        padding: 3px 0;
        color: #7c5cbf;
        font-family: Georgia, serif;
      }

      .augment-icon {
        font-size: 14px;
      }

      .listing-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        background: linear-gradient(to bottom, ${PARCHMENT.bg.dark} 0%, ${PARCHMENT.bg.darker} 100%);
        border-top: 1px solid ${PARCHMENT.border.light};
      }

      .listing-price {
        font-family: Consolas, monospace;
        font-size: 16px;
        font-weight: bold;
        color: ${PARCHMENT.text.primary};
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
      }

      .listing-seller {
        font-size: 11px;
        color: ${PARCHMENT.text.muted};
        font-family: Georgia, serif;
      }

      .listing-buy-btn {
        padding: 8px 16px;
        background: linear-gradient(to bottom, #5a9e4a 0%, #4a8c3a 100%);
        border: 2px solid #3d7530;
        border-radius: 4px;
        color: white;
        font-family: Georgia, serif;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        transition: all 0.2s;
      }

      .listing-buy-btn:hover {
        background: linear-gradient(to bottom, #6aae5a 0%, #5a9e4a 100%);
        transform: translateY(-1px);
      }

      .listing-buy-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      /* Loading state */
      .item-panel-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px;
        color: ${PARCHMENT.text.muted};
        font-family: Georgia, serif;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Open panel with listings for a template
   */
  async open(templateId, templateName, onBuy = null, onClose = null) {
    this.templateId = templateId;
    this.templateName = templateName;
    this.onBuy = onBuy;
    this.onClose = onClose;

    this.createPanel();
    this.showLoading();

    // Trigger open animation
    requestAnimationFrame(() => {
      this.element.classList.add('open');
    });

    this.isOpen = true;

    // Load listings
    try {
      const data = await this.game.api.getItemListings(templateId);
      this.listings = data.listings || [];
      this.render();
    } catch (err) {
      console.error('Failed to load item listings:', err);
      this.showError('Failed to load listings');
    }
  }

  /**
   * Close the panel
   */
  close() {
    if (!this.element) return;

    this.element.classList.remove('open');
    this.isOpen = false;

    // Remove after animation
    setTimeout(() => {
      if (this.element) {
        this.element.remove();
        this.element = null;
      }
    }, 300);

    if (this.onClose) {
      this.onClose();
    }
  }

  createPanel() {
    if (this.element) {
      this.element.remove();
    }

    this.element = document.createElement('div');
    this.element.className = 'marketplace-item-panel';
    this.element.innerHTML = `
      <div class="item-panel-header">
        <span class="item-panel-title">${this.templateName}</span>
        <button class="item-panel-close">&times;</button>
      </div>
      <div class="item-panel-content"></div>
    `;

    // Close button handler
    this.element.querySelector('.item-panel-close').addEventListener('click', () => {
      this.close();
    });

    // Find marketplace container and append
    const container = document.querySelector('.marketplace-container') || document.body;
    container.appendChild(this.element);
  }

  showLoading() {
    const content = this.element.querySelector('.item-panel-content');
    content.innerHTML = '<div class="item-panel-loading">Loading listings...</div>';
  }

  showError(message) {
    const content = this.element.querySelector('.item-panel-content');
    content.innerHTML = `<div class="item-panel-empty">${message}</div>`;
  }

  render() {
    const content = this.element.querySelector('.item-panel-content');

    if (this.listings.length === 0) {
      content.innerHTML = `
        <div class="item-panel-empty">
          No listings available for this item.
          <br><br>
          Be the first to list one!
        </div>
      `;
      return;
    }

    content.innerHTML = this.listings.map(listing => this.renderListingCard(listing)).join('');

    // Attach buy button handlers
    content.querySelectorAll('.listing-buy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const listingId = parseInt(btn.dataset.listingId);
        this.handleBuy(listingId);
      });
    });
  }

  renderListingCard(listing) {
    const {
      listingId,
      generatedName,
      rarity,
      material,
      baseStats,
      bonusStats,
      augments,
      askPrice,
      sellerName
    } = listing;

    // Format stats
    const baseStatsHtml = Object.entries(baseStats || {})
      .map(([stat, val]) => `
        <div class="stat-row">
          <span class="stat-label">${this.formatStatName(stat)}</span>
          <span class="stat-value">+${val}</span>
        </div>
      `).join('');

    const bonusStatsHtml = Object.entries(bonusStats || {})
      .map(([stat, val]) => `
        <div class="stat-row">
          <span class="stat-label">${this.formatStatName(stat)}</span>
          <span class="stat-value bonus">+${val}</span>
        </div>
      `).join('');

    // Format augments
    const augmentsHtml = (augments || []).map(aug => `
      <div class="augment-item">
        <span class="augment-icon">${this.getAugmentIcon(aug)}</span>
        <span>${this.formatAugmentEffect(aug)}</span>
      </div>
    `).join('');

    // Meta line: Rarity + Material
    const metaParts = [];
    if (rarity) metaParts.push(this.capitalize(rarity));
    if (material) metaParts.push(this.capitalize(material));
    const metaLine = metaParts.join(' • ');

    return `
      <div class="listing-card">
        <div class="listing-header">
          <div class="listing-name ${rarity || 'common'}">${generatedName}</div>
          <div class="listing-meta">${metaLine}</div>
        </div>
        <div class="listing-body">
          ${(baseStatsHtml || bonusStatsHtml) ? `
            <div class="listing-stats">
              ${baseStatsHtml}
              ${bonusStatsHtml}
            </div>
          ` : ''}
          ${augmentsHtml ? `
            <div class="listing-augments">
              ${augmentsHtml}
            </div>
          ` : ''}
        </div>
        <div class="listing-footer">
          <div>
            <div class="listing-price">${askPrice.toLocaleString()} gold</div>
            <div class="listing-seller">Seller: ${sellerName}</div>
          </div>
          <button class="listing-buy-btn" data-listing-id="${listingId}">Buy</button>
        </div>
      </div>
    `;
  }

  async handleBuy(listingId) {
    const listing = this.listings.find(l => l.listingId === listingId);
    if (!listing) return;

    if (this.onBuy) {
      this.onBuy(listing);
    }
  }

  /**
   * Format stat name for display
   */
  formatStatName(stat) {
    const names = {
      strength: 'STR',
      intelligence: 'INT',
      agility: 'AGI',
      vitality: 'VIT',
      luck: 'LCK',
      hp_max: 'Max HP',
      mp_max: 'Max MP',
      physical_attack: 'P.ATK',
      physical_defense: 'P.DEF',
      magic_attack: 'M.ATK',
      magic_defense: 'M.DEF'
    };
    return names[stat] || stat.toUpperCase().replace(/_/g, ' ');
  }

  /**
   * Get icon for augment category
   */
  getAugmentIcon(augment) {
    const category = augment.category || augment.effect?.type || '';
    const iconConfig = AUGMENT_ICONS[category];
    if (iconConfig) {
      return Icon.html(iconConfig.category, iconConfig.name, { size: 'sm' });
    }
    // Fallback to holy icon for unknown augments
    return Icon.html('augments', 'holy', { size: 'sm' });
  }

  /**
   * Format augment effect for display
   * (Copied from InventoryPanel for consistency)
   */
  formatAugmentEffect(augment) {
    if (!augment.effect) return augment.name || '';

    const effect = augment.effect;
    switch (effect.type) {
      case 'fire_damage':
      case 'ice_damage':
      case 'lightning_damage':
      case 'holy_damage':
      case 'dark_damage':
        return `+${Math.round(effect.value * 100)}% ${effect.type.replace('_', ' ')}`;
      case 'poison_chance':
      case 'crit_chance':
      case 'block_chance':
        return `+${Math.round(effect.value * 100)}% ${effect.type.replace('_', ' ')}`;
      case 'burn_chance':
      case 'slow_chance':
      case 'stun_chance':
        return `${Math.round(effect.value * 100)}% chance to ${effect.type.split('_')[0]}`;
      case 'lifesteal':
      case 'heal_on_hit':
        return `${Math.round(effect.value * 100)}% ${effect.type.replace('_', ' ')}`;
      case 'damage_bonus':
      case 'physical_attack':
      case 'physical_defense':
      case 'magic_defense':
      case 'damage_reduction':
        return `+${Math.round(effect.value * 100)}% ${effect.type.replace(/_/g, ' ')}`;
      case 'damage_vs':
        return `+${Math.round(effect.value * 100)}% damage vs ${effect.target}`;
      case 'stat_bonus':
        return `${augment.name}`;
      case 'effect_multiplier':
        return `${Math.round((effect.value - 1) * 100)}% stronger effect`;
      case 'hot':
        return `+${effect.value} HP/turn for ${effect.duration} turns`;
      case 'hot_percent':
        return `+${Math.round(effect.value * 100)}% max HP/turn for ${effect.duration} turns`;
      case 'mp_bonus':
        return `+${effect.value} MP restored`;
      case 'mp_regen':
        return `+${effect.value} MP/turn for ${effect.duration} turns`;
      case 'cleanse':
        return effect.targets === 'all' ? 'Cures all debuffs' : `Cures ${effect.targets.join(', ')}`;
      case 'buff':
        return `+${effect.value} ${effect.stat.toUpperCase()} for ${effect.duration} turns`;
      default:
        return augment.name || '';
    }
  }

  capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ') : '';
  }
}
