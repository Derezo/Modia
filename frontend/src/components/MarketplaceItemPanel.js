/**
 * MarketplaceItemPanel - Display item variants/listings for a template
 * Shows full generated names, augments, stats, and allows purchasing
 */

import { Icon } from './Icon.js';
import { ItemIcon } from './ItemIcon.js';
import { escapeHtml, escapeHtmlAttribute } from '../utils/escapeHtml.js';
import {
  formatStatName,
  formatStatAmount,
  sumItemStats,
  normalizeRarity,
  describeAugment,
  resolveAugmentIconName
} from '../utils/statDisplay.js';


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

      .listing-item-heading {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .listing-name {
        font-family: Georgia, serif;
        font-weight: bold;
        font-size: 14px;
        margin-bottom: 4px;
        line-height: 1.3;
        overflow-wrap: anywhere;
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

      .stat-value.negative {
        color: #8b2a2a;
      }

      .stat-bonus-note {
        color: ${PARCHMENT.text.muted};
        font-size: 11px;
        margin-left: 4px;
      }

      .augment-name {
        font-weight: bold;
      }

      .augment-item.inactive .augment-effect {
        color: ${PARCHMENT.text.muted};
        font-style: italic;
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
        <span class="item-panel-title">${escapeHtml(this.templateName)}</span>
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
    content.innerHTML = `<div class="item-panel-empty">${escapeHtml(message)}</div>`;
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

    content.querySelectorAll('[data-listing-item-icon]').forEach((container) => {
      const listing = this.listings[Number(container.dataset.listingItemIcon)];
      if (!listing?.augments?.length) return;

      ItemIcon.compositeHtml({
        item: this.getListingIconItem(listing),
        size: 'md'
      }).then((html) => {
        if (container.isConnected) container.innerHTML = html;
      }).catch(() => {
        // Keep the canonical base icon rendered in the listing card.
      });
    });

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

    // Sum base and bonus stats per key; show where a bonus added to a base value
    const summed = sumItemStats({ baseStats, bonusStats });
    const statsHtml = Object.entries(summed)
      .map(([stat, val]) => {
        const bonus = Number((bonusStats || {})[stat]) || 0;
        const base = Number((baseStats || {})[stat]) || 0;
        const valueClass = typeof val === 'number' && val < 0 ? 'negative' : (bonus && !base ? 'bonus' : '');
        const note = bonus && base
          ? `<span class="stat-bonus-note">(${escapeHtml(formatStatAmount(stat, bonus))} bonus)</span>`
          : '';
        return `
        <div class="stat-row">
          <span class="stat-label">${escapeHtml(this.formatStatName(stat))}</span>
          <span class="stat-value ${valueClass}">${escapeHtml(formatStatAmount(stat, val))}${note}</span>
        </div>
      `;
      }).join('');

    // Format augments: name, effect and rolled stat
    const augmentsHtml = (augments || []).map(aug => {
      const { name, effect, statText, active } = describeAugment(aug);
      const inactive = typeof aug === 'object' && !active;
      const title = inactive && effect ? `${effect} (not yet applied in combat)` : (effect || name);
      return `
      <div class="augment-item${inactive ? ' inactive' : ''}" title="${escapeHtmlAttribute(title)}">
        <span class="augment-icon">${this.getAugmentIcon(aug)}</span>
        <span>
          ${name ? `<span class="augment-name">${escapeHtml(name)}</span>${effect ? ': ' : ''}` : ''}
          ${effect ? `<span class="augment-effect">${escapeHtml(effect)}</span>` : ''}
          ${statText ? ` (${escapeHtml(statText)})` : ''}
        </span>
      </div>
    `;
    }).join('');

    // Meta line: Rarity + Material (rarity may arrive as a 1-5 number)
    const rarityName = normalizeRarity(rarity);
    const metaParts = [this.capitalize(rarityName)];
    if (material) metaParts.push(this.capitalize(String(material)));
    const metaLine = metaParts.join(' • ');
    const listingIndex = this.listings.indexOf(listing);
    const iconItem = this.getListingIconItem(listing);

    return `
      <div class="listing-card">
        <div class="listing-header">
          <div class="listing-item-heading">
            <span data-listing-item-icon="${listingIndex}">${ItemIcon.html({ item: iconItem, size: 'md' })}</span>
            <div>
              <div class="listing-name ${rarityName}">${escapeHtml(generatedName)}</div>
              <div class="listing-meta">${escapeHtml(metaLine)}</div>
            </div>
          </div>
        </div>
        <div class="listing-body">
          ${statsHtml ? `
            <div class="listing-stats">
              ${statsHtml}
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
            <div class="listing-price">${Number(askPrice || 0).toLocaleString()} gold</div>
            <div class="listing-seller">Seller: ${escapeHtml(sellerName)}</div>
          </div>
          <button class="listing-buy-btn" data-listing-id="${listingId}">Buy</button>
        </div>
      </div>
    `;
  }

  /**
   * Adapt marketplace listing DTOs to ItemIcon's canonical field names.
   * @param {Object} listing - Marketplace listing
   * @returns {Object} ItemIcon-compatible item
   */
  getListingIconItem(listing) {
    return {
      ...listing,
      name: listing.generatedName || listing.templateName,
      type: listing.itemType || listing.item_type
    };
  }

  async handleBuy(listingId) {
    const listing = this.listings.find(l => l.listingId === listingId);
    if (!listing) return;

    if (this.onBuy) {
      this.onBuy(listing);
    }
  }

  /**
   * Format stat name for display (shared abbreviations)
   */
  formatStatName(stat) {
    return formatStatName(stat, true);
  }

  /**
   * Get icon for an augment (every category maps to an existing icon file)
   */
  getAugmentIcon(augment) {
    const { name, effect } = describeAugment(augment);
    return Icon.html('augments', resolveAugmentIconName(augment), { size: 'sm', title: name || effect });
  }

  capitalize(str) {
    if (str === null || str === undefined || str === '') return '';
    const text = String(str);
    return text.charAt(0).toUpperCase() + text.slice(1).replace(/_/g, ' ');
  }
}
