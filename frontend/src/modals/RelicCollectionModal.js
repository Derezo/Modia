/**
 * RelicCollectionModal - Display player's relic collection
 *
 * Shows all collectible relics organized by category:
 * - Zodiac Crystals (12 zodiac signs with element-based coloring)
 * - Adventure Relics (permanent bonuses from exploration)
 *
 * Uses ParchmentModal styling pattern for consistency with game UI.
 */

import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow,
  getParchmentScrollbarCSS
} from '../ui/parchment/index.js';
import { ZODIAC_SHRINE_BUFFS } from '@shared/constants.js';
import { escapeHtml } from '../utils/escapeHtml.js';

const P = PARCHMENT_COLORS;
const STYLE_ID = 'relic-collection-modal-styles';

// Element colors for zodiac crystals
const ELEMENT_COLORS = {
  fire: { bg: '#ff6b4a', glow: 'rgba(255, 107, 74, 0.4)', text: '#ff8c6b' },
  earth: { bg: '#4a8b4a', glow: 'rgba(74, 139, 74, 0.4)', text: '#6aab6a' },
  air: { bg: '#4aafcf', glow: 'rgba(74, 175, 207, 0.4)', text: '#6acfef' },
  water: { bg: '#4a6acf', glow: 'rgba(74, 106, 207, 0.4)', text: '#6a8aef' }
};

// Zodiac sign display info
const ZODIAC_INFO = {
  aries: { symbol: '\u2648', element: 'fire' },
  taurus: { symbol: '\u2649', element: 'earth' },
  gemini: { symbol: '\u264a', element: 'air' },
  cancer: { symbol: '\u264b', element: 'water' },
  leo: { symbol: '\u264c', element: 'fire' },
  virgo: { symbol: '\u264d', element: 'earth' },
  libra: { symbol: '\u264e', element: 'air' },
  scorpio: { symbol: '\u264f', element: 'water' },
  sagittarius: { symbol: '\u2650', element: 'fire' },
  capricorn: { symbol: '\u2651', element: 'earth' },
  aquarius: { symbol: '\u2652', element: 'air' },
  pisces: { symbol: '\u2653', element: 'water' }
};

export class RelicCollectionModal {
  /**
   * @param {Object} options
   * @param {Object} options.game - Game instance
   * @param {Function} options.onClose - Callback when modal closes
   */
  constructor(options) {
    this.game = options.game;
    this.onClose = options.onClose;

    this.element = null;
    this.abortController = null;

    // Data state
    this.zodiacData = null;
    this.relicsData = null;
    this.isLoading = true;
    this.error = null;

    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .relic-collection-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        font-family: Georgia, 'Times New Roman', serif;
      }

      .relic-collection-modal {
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder(3)};
        border-radius: 12px;
        box-shadow: ${getParchmentShadow()}, 0 0 40px rgba(0, 0, 0, 0.5);
        max-width: 500px;
        width: 90%;
        max-height: 85vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .relic-collection-header {
        padding: 16px 20px;
        background: linear-gradient(to bottom, ${P.dark}, ${P.mid});
        border-bottom: ${getParchmentBorder()};
        text-align: center;
      }

      .relic-collection-title {
        margin: 0 0 4px 0;
        color: ${P.accent.gold};
        font-size: 20px;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
      }

      .relic-collection-subtitle {
        color: ${P.text.secondary};
        font-size: 13px;
        font-style: italic;
      }

      .relic-collection-content {
        padding: 16px;
        overflow-y: auto;
        /* Hover lift / tooltips must not add a horizontal scrollbar */
        overflow-x: hidden;
        flex: 1;
      }

      ${getParchmentScrollbarCSS('.relic-collection-content')}

      .relic-collection-section {
        margin-bottom: 20px;
      }

      .relic-collection-section:last-child {
        margin-bottom: 0;
      }

      .relic-section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 1px solid ${P.border};
      }

      .relic-section-title {
        font-size: 15px;
        font-weight: bold;
        color: ${P.text.primary};
        margin: 0;
      }

      .relic-section-progress {
        font-size: 12px;
        color: ${P.accent.copper};
        font-weight: bold;
      }

      /* Zodiac Grid */
      .zodiac-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
      }

      .zodiac-crystal {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 10px 6px;
        border-radius: 8px;
        background: rgba(139, 115, 85, 0.1);
        border: 1px solid rgba(139, 115, 85, 0.3);
        transition: all 0.2s ease;
        cursor: default;
        position: relative;
      }

      .zodiac-crystal--collected {
        border-color: var(--element-color);
        box-shadow: 0 0 8px var(--element-glow);
      }

      .zodiac-crystal--uncollected {
        opacity: 0.5;
        filter: grayscale(0.7);
      }

      .zodiac-crystal:hover {
        transform: translateY(-2px);
        background: rgba(139, 115, 85, 0.2);
      }

      .zodiac-symbol {
        font-size: 24px;
        margin-bottom: 4px;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .zodiac-crystal--collected .zodiac-symbol {
        color: var(--element-color);
      }

      .zodiac-crystal--uncollected .zodiac-symbol {
        color: ${P.text.muted};
      }

      .zodiac-name {
        font-size: 10px;
        font-weight: bold;
        text-transform: capitalize;
        color: ${P.text.primary};
        text-align: center;
      }

      .zodiac-crystal--uncollected .zodiac-name {
        color: ${P.text.muted};
      }

      .zodiac-bonus {
        font-size: 9px;
        color: ${P.text.secondary};
        margin-top: 2px;
      }

      /* Crystal tooltip on hover */
      .zodiac-crystal-tooltip {
        position: absolute;
        bottom: calc(100% + 8px);
        left: 50%;
        transform: translateX(-50%);
        background: ${P.dark};
        border: 1px solid ${P.border};
        border-radius: 6px;
        padding: 8px 10px;
        min-width: 140px;
        z-index: 10;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.15s, visibility 0.15s;
        pointer-events: none;
      }

      .zodiac-crystal:hover .zodiac-crystal-tooltip {
        opacity: 1;
        visibility: visible;
      }

      .tooltip-crystal-name {
        font-size: 11px;
        font-weight: bold;
        color: var(--element-text);
        margin-bottom: 4px;
      }

      .tooltip-blessing-name {
        font-size: 10px;
        color: ${P.text.secondary};
        margin-bottom: 2px;
      }

      .tooltip-blessing-desc {
        font-size: 9px;
        color: ${P.text.muted};
        font-style: italic;
      }

      /* Collection Bonus */
      .collection-bonus {
        margin-top: 16px;
        padding: 12px;
        background: linear-gradient(135deg, rgba(255, 215, 0, 0.1), rgba(139, 115, 85, 0.1));
        border: 1px dashed ${P.accent.copper};
        border-radius: 8px;
        text-align: center;
      }

      .collection-bonus--active {
        background: linear-gradient(135deg, rgba(255, 215, 0, 0.2), rgba(139, 115, 85, 0.15));
        border-style: solid;
        border-color: ${P.accent.gold};
      }

      .collection-bonus-title {
        font-size: 13px;
        font-weight: bold;
        color: ${P.accent.gold};
        margin-bottom: 4px;
      }

      .collection-bonus-desc {
        font-size: 11px;
        color: ${P.text.secondary};
      }

      /* Adventure Relics */
      .relic-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .relic-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        background: rgba(139, 115, 85, 0.1);
        border: 1px solid rgba(139, 115, 85, 0.3);
        border-radius: 8px;
      }

      .relic-item--owned {
        border-color: ${P.accent.copper};
      }

      .relic-item--locked {
        opacity: 0.5;
      }

      .relic-icon {
        font-size: 24px;
        width: 32px;
        text-align: center;
      }

      .relic-info {
        flex: 1;
      }

      .relic-name {
        font-size: 13px;
        font-weight: bold;
        color: ${P.text.primary};
        margin-bottom: 2px;
      }

      .relic-desc {
        font-size: 11px;
        color: ${P.text.secondary};
      }

      .relic-status {
        font-size: 10px;
        font-weight: bold;
        padding: 2px 8px;
        border-radius: 10px;
      }

      .relic-status--owned {
        background: rgba(74, 117, 72, 0.2);
        color: ${P.state.success};
      }

      .relic-status--locked {
        background: rgba(139, 68, 68, 0.2);
        color: ${P.state.error};
      }

      /* Loading/Error states */
      .relic-collection-loading,
      .relic-collection-error {
        text-align: center;
        padding: 40px 20px;
        color: ${P.text.secondary};
      }

      .relic-collection-error {
        color: ${P.state.error};
      }

      /* Footer */
      .relic-collection-footer {
        padding: 12px 16px;
        border-top: ${getParchmentBorder()};
        display: flex;
        justify-content: center;
      }

      .relic-collection-btn {
        padding: 8px 24px;
        border: ${getParchmentBorder()};
        border-radius: 6px;
        font-family: inherit;
        font-size: 13px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.15s ease;
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
        color: ${P.text.primary};
      }

      .relic-collection-btn:hover:not(:disabled) {
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
      }

      .relic-collection-btn:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .relic-requirement {
        margin-top: 2px;
        font-size: 10px;
        font-style: italic;
        color: ${P.state.error};
      }

      @media (max-width: 480px) {
        .relic-collection-modal {
          width: 95%;
          max-height: 90vh;
        }

        .zodiac-grid {
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
        }

        .zodiac-crystal {
          padding: 8px 4px;
        }

        .zodiac-symbol {
          font-size: 20px;
        }

        .zodiac-name {
          font-size: 9px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  async loadData() {
    this.isLoading = true;
    this.error = null;

    try {
      // Fetch zodiac collection and ALL relics (not just owned) in parallel
      // GET /relics returns all relics with ownership status
      const [zodiacResponse, relicsResponse] = await Promise.all([
        this.game.api.get('/world/zodiac-collection'),
        this.game.api.get('/relics')
      ]);

      this.zodiacData = zodiacResponse;
      this.relicsData = relicsResponse;
      this.isLoading = false;
    } catch (err) {
      console.error('Failed to load relic data:', err);
      this.error = err.message || 'Failed to load collection';
      this.isLoading = false;
    }
  }

  async claimRelic(relicId) {
    try {
      const result = await this.game.api.claimRelic(relicId);
      if (result.success) {
        // Reload data to show updated ownership
        await this.loadData();
        this.updateContent();
        // Show success toast using typed helper
        if (this.game.toast) {
          this.game.toast.success('Relic Claimed', result.message || 'Relic claimed!');
        }
      } else {
        // Show validation message using typed helper
        if (this.game.toast) {
          this.game.toast.warning('Cannot Claim', result.message || 'Cannot claim this relic');
        }
      }
    } catch (err) {
      console.error('Failed to claim relic:', err);
      // Show error toast using typed helper
      if (this.game.toast) {
        this.game.toast.error('Claim Failed', err.message || 'Failed to claim relic');
      }
    }
  }

  updateContent() {
    if (!this.element) return;
    const content = this.element.querySelector('.relic-collection-content');
    if (!content) return;

    if (this.isLoading) {
      content.innerHTML = '<div class="relic-collection-loading">Loading collection...</div>';
    } else if (this.error) {
      content.innerHTML = `<div class="relic-collection-error">${escapeHtml(this.error)}</div>`;
    } else {
      content.innerHTML = '';
      content.appendChild(this.createZodiacSection());
      content.appendChild(this.createRelicsSection());
    }
  }

  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'relic-collection-overlay';

    const modal = document.createElement('div');
    modal.className = 'relic-collection-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'relic-collection-header';
    header.innerHTML = `
      <h2 class="relic-collection-title">Relic Collection</h2>
      <p class="relic-collection-subtitle">Your treasures and artifacts</p>
    `;
    modal.appendChild(header);

    // Content
    const content = document.createElement('div');
    content.className = 'relic-collection-content';

    if (this.isLoading) {
      content.innerHTML = '<div class="relic-collection-loading">Loading collection...</div>';
    } else if (this.error) {
      content.innerHTML = `<div class="relic-collection-error">${escapeHtml(this.error)}</div>`;
    } else {
      content.appendChild(this.createZodiacSection());
      content.appendChild(this.createRelicsSection());
    }

    modal.appendChild(content);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'relic-collection-footer';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'relic-collection-btn';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => this.close(), { signal: this.abortController.signal });
    footer.appendChild(closeBtn);

    modal.appendChild(footer);
    this.element.appendChild(modal);

    // Close on overlay click
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) {
        this.close();
      }
    }, { signal: this.abortController.signal });
  }

  createZodiacSection() {
    const section = document.createElement('div');
    section.className = 'relic-collection-section';

    const { crystals, totalCollected, collectionComplete, collectionBonus } = this.zodiacData;

    // Section header with progress
    const header = document.createElement('div');
    header.className = 'relic-section-header';
    header.innerHTML = `
      <h3 class="relic-section-title">Zodiac Crystals</h3>
      <span class="relic-section-progress">${totalCollected}/12</span>
    `;
    section.appendChild(header);

    // Zodiac grid
    const grid = document.createElement('div');
    grid.className = 'zodiac-grid';

    for (const crystal of crystals) {
      grid.appendChild(this.createZodiacCrystal(crystal));
    }

    section.appendChild(grid);

    // Collection bonus
    const bonus = document.createElement('div');
    bonus.className = `collection-bonus ${collectionComplete ? 'collection-bonus--active' : ''}`;

    if (collectionComplete && collectionBonus) {
      bonus.innerHTML = `
        <div class="collection-bonus-title">${escapeHtml(collectionBonus.title)}</div>
        <div class="collection-bonus-desc">+5% all stats, dual blessing slots unlocked</div>
      `;
    } else {
      bonus.innerHTML = `
        <div class="collection-bonus-title">Celestial Wanderer</div>
        <div class="collection-bonus-desc">Collect all 12 crystals for +5% all stats and dual blessings</div>
      `;
    }
    section.appendChild(bonus);

    return section;
  }

  createZodiacCrystal(crystal) {
    const { sign, name, bonus, collected } = crystal;
    const info = ZODIAC_INFO[sign];
    const element = info?.element || 'earth';
    const colors = ELEMENT_COLORS[element];
    const buffInfo = ZODIAC_SHRINE_BUFFS[sign];

    const el = document.createElement('div');
    el.className = `zodiac-crystal ${collected ? 'zodiac-crystal--collected' : 'zodiac-crystal--uncollected'}`;
    el.style.setProperty('--element-color', colors.bg);
    el.style.setProperty('--element-glow', colors.glow);
    el.style.setProperty('--element-text', colors.text);

    // Format bonus type for display
    const bonusTypeDisplay = this.formatBonusType(bonus.type);
    const bonusValue = `+${Math.round(bonus.value * 100)}%`;

    el.innerHTML = `
      <span class="zodiac-symbol">${info?.symbol || '?'}</span>
      <span class="zodiac-name">${escapeHtml(sign)}</span>
      <span class="zodiac-bonus">${bonusValue} ${bonusTypeDisplay}</span>
      <div class="zodiac-crystal-tooltip">
        <div class="tooltip-crystal-name" style="color: ${colors.text}">${escapeHtml(name)}</div>
        <div class="tooltip-blessing-name">${escapeHtml(buffInfo?.name || 'Unknown Blessing')}</div>
        <div class="tooltip-blessing-desc">${escapeHtml(buffInfo?.description || '')}</div>
      </div>
    `;

    return el;
  }

  formatBonusType(type) {
    const typeMap = {
      physical_damage: 'DMG',
      defense: 'DEF',
      crit_chance: 'CRIT',
      healing_received: 'HEAL'
    };
    return typeMap[type] || type;
  }

  createRelicsSection() {
    const section = document.createElement('div');
    section.className = 'relic-collection-section';

    const relics = this.relicsData?.relics || [];
    const ownedCount = relics.filter(r => r.owned).length;
    const totalCount = relics.length;

    // Section header
    const header = document.createElement('div');
    header.className = 'relic-section-header';
    header.innerHTML = `
      <h3 class="relic-section-title">Adventure Relics</h3>
      <span class="relic-section-progress">${ownedCount}/${totalCount}</span>
    `;
    section.appendChild(header);

    // Relic list
    const list = document.createElement('div');
    list.className = 'relic-list';

    if (relics.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = `
        text-align: center;
        padding: 20px;
        color: ${P.text.muted};
        font-style: italic;
        font-size: 12px;
      `;
      empty.textContent = 'No relics available. Explore the world to find them!';
      list.appendChild(empty);
    } else {
      for (const relic of relics) {
        list.appendChild(this.createRelicItem(relic));
      }
    }

    section.appendChild(list);
    return section;
  }

  createRelicItem(relic) {
    const el = document.createElement('div');
    el.className = `relic-item ${relic.owned ? 'relic-item--owned' : 'relic-item--locked'}`;

    // Get icon based on relic key or type
    const icon = this.getRelicIcon(relic.key);

    if (relic.owned) {
      el.innerHTML = `
        <span class="relic-icon">${icon}</span>
        <div class="relic-info">
          <div class="relic-name">${escapeHtml(relic.name)}</div>
          <div class="relic-desc">${escapeHtml(relic.description || 'A mysterious artifact')}</div>
        </div>
        <span class="relic-status relic-status--owned">Owned</span>
      `;
    } else {
      // claimable/requirement come from GET /relics; older payloads without
      // them keep the button enabled and let the server decide.
      const claimable = relic.claimable !== false;
      const requirement = !claimable && relic.requirement
        ? `<div class="relic-requirement">${escapeHtml(relic.requirement)}</div>`
        : '';
      el.innerHTML = `
        <span class="relic-icon">${icon}</span>
        <div class="relic-info">
          <div class="relic-name">${escapeHtml(relic.name)}</div>
          <div class="relic-desc">${escapeHtml(relic.description || 'A mysterious artifact')}</div>
          ${requirement}
        </div>
      `;

      // Add Claim button for unowned relics
      const claimBtn = document.createElement('button');
      claimBtn.className = 'relic-collection-btn relic-claim-btn';
      claimBtn.textContent = 'Claim';
      claimBtn.disabled = !claimable;
      if (!claimable && relic.requirement) claimBtn.title = relic.requirement;
      claimBtn.style.cssText = 'padding: 4px 12px; font-size: 11px;';
      claimBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.claimRelic(relic.id);
      }, { signal: this.abortController.signal });
      el.appendChild(claimBtn);
    }

    return el;
  }

  getRelicIcon(relicKey) {
    const iconMap = {
      wayfarers_compass: '\u{1F9ED}',    // compass
      vitality_charm: '\u2764\uFE0F',     // heart
      merchants_seal: '\u{1FA99}',        // coin
      cartographers_eye: '\u{1F5FA}\uFE0F', // map
      scholars_quill: '\u{1F4DC}',        // scroll
      warriors_crest: '\u{1F6E1}\uFE0F',  // shield
      default: '\u2728'                   // sparkles
    };
    return iconMap[relicKey] || iconMap.default;
  }

  async show() {
    this.abortController = new AbortController();

    // Load data first
    await this.loadData();

    // Create and show modal
    this.createElement();
    this.game.uiOverlay.appendChild(this.element);
  }

  close() {
    if (this.onClose) {
      this.onClose();
    }
    this.destroy();
  }

  destroy() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.element?.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
