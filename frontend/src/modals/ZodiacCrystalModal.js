/**
 * ZodiacCrystalModal - Collection grid modal for zodiac crystals
 *
 * Displays all 12 zodiac crystals in a 4x3 grid with element filtering.
 * Features animated crystal orbs, progress tracking, and collection bonuses.
 *
 * Key responsibilities:
 * - Render 4x3 grid of zodiac crystals with element-based styling
 * - Filter crystals by element (Fire, Earth, Air, Water)
 * - Show collection progress with circular progress ring
 * - Display collection bonus status
 * - Trigger detail modal on crystal selection
 *
 * @see CrystalOrb.js - Individual crystal rendering
 * @see ConstellationData.js - Zodiac info and element colors
 */

import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow,
  getParchmentScrollbarCSS
} from '../ui/parchment/index.js';
import { CrystalOrb } from './zodiac/CrystalOrb.js';
import { ZODIAC_INFO, ELEMENT_COLORS } from './zodiac/ConstellationData.js';

const P = PARCHMENT_COLORS;
const STYLE_ID = 'zodiac-crystal-modal-styles';

// Ordered zodiac signs (matches traditional order)
const ZODIAC_ORDER = [
  'aries', 'taurus', 'gemini', 'cancer',
  'leo', 'virgo', 'libra', 'scorpio',
  'sagittarius', 'capricorn', 'aquarius', 'pisces'
];

// Filter tab colors
const FILTER_COLORS = {
  all: { bg: P.border, text: P.text.inverse },
  fire: { bg: '#ff6b4a', text: '#fff' },
  earth: { bg: '#4a8b4a', text: '#fff' },
  air: { bg: '#4aafcf', text: '#fff' },
  water: { bg: '#4a6acf', text: '#fff' }
};

export class ZodiacCrystalModal {
  /**
   * @param {Object} options
   * @param {Object} options.game - Game instance
   * @param {Function} options.onClose - Callback when modal closes
   * @param {Function} options.onCrystalSelect - Callback when crystal is clicked (sign, crystal)
   */
  constructor(options) {
    this.game = options.game;
    this.onClose = options.onClose;
    this.onCrystalSelect = options.onCrystalSelect;

    this.element = null;
    this.abortController = null;

    // Data state
    this.zodiacData = null;
    this.crystalMap = new Map(); // sign -> crystal data
    this.isLoading = true;
    this.error = null;

    // Filter state
    this.activeFilter = 'all';

    // Crystal orbs for animation
    this.crystalOrbs = new Map();
    this.animationFrameId = null;
    this.lastAnimationTime = 0;

    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .zodiac-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        font-family: Georgia, 'Times New Roman', serif;
      }

      .zodiac-modal {
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder(3)};
        border-radius: 12px;
        box-shadow: ${getParchmentShadow()}, 0 0 60px rgba(0, 0, 0, 0.5);
        width: 580px;
        max-width: 95%;
        max-height: 85vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      /* Header */
      .zodiac-modal-header {
        padding: 16px 20px;
        background: linear-gradient(to bottom, ${P.dark}, ${P.mid});
        border-bottom: ${getParchmentBorder()};
        display: flex;
        align-items: center;
        justify-content: space-between;
        position: relative;
      }

      .zodiac-modal-close {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 28px;
        height: 28px;
        border: none;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 50%;
        color: ${P.text.primary};
        font-size: 18px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
      }

      .zodiac-modal-close:hover {
        background: rgba(0, 0, 0, 0.4);
        color: ${P.text.inverse};
      }

      .zodiac-modal-title-group {
        display: flex;
        align-items: center;
        gap: 16px;
      }

      .zodiac-progress-ring {
        width: 48px;
        height: 48px;
        position: relative;
      }

      .zodiac-progress-ring svg {
        transform: rotate(-90deg);
      }

      .zodiac-progress-ring-bg {
        stroke: rgba(0, 0, 0, 0.2);
        fill: none;
      }

      .zodiac-progress-ring-fill {
        stroke: ${P.accent.copper};
        fill: none;
        stroke-linecap: round;
        transition: stroke-dashoffset 0.5s ease;
      }

      .zodiac-progress-ring--complete .zodiac-progress-ring-fill {
        stroke: #ffd700;
      }

      .zodiac-progress-text {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 12px;
        font-weight: bold;
        color: ${P.text.primary};
      }

      .zodiac-modal-title {
        margin: 0;
        color: ${P.accent.copper};
        font-size: 20px;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
      }

      .zodiac-modal-subtitle {
        margin: 4px 0 0 0;
        color: ${P.text.secondary};
        font-size: 12px;
        font-style: italic;
      }

      /* Filter Tabs */
      .zodiac-filter-tabs {
        display: flex;
        gap: 6px;
        padding: 12px 16px;
        background: rgba(0, 0, 0, 0.05);
        border-bottom: 1px solid ${P.border};
      }

      .zodiac-filter-tab {
        padding: 6px 14px;
        border: 1px solid rgba(0, 0, 0, 0.15);
        border-radius: 16px;
        background: rgba(0, 0, 0, 0.05);
        color: ${P.text.secondary};
        font-size: 12px;
        font-family: inherit;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .zodiac-filter-tab:hover {
        background: rgba(0, 0, 0, 0.1);
      }

      .zodiac-filter-tab--active {
        background: var(--tab-bg);
        color: var(--tab-text);
        border-color: var(--tab-bg);
      }

      /* Grid Content */
      .zodiac-modal-content {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
      }

      ${getParchmentScrollbarCSS('.zodiac-modal-content')}

      .zodiac-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
      }

      /* Crystal Cell */
      .zodiac-crystal-cell {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 12px 8px 10px;
        border-radius: 10px;
        background: rgba(139, 115, 85, 0.08);
        border: 2px solid rgba(139, 115, 85, 0.2);
        cursor: pointer;
        transition: all 0.3s ease;
        position: relative;
        opacity: 1;
        transform: scale(1);
      }

      .zodiac-crystal-cell--filtered {
        opacity: 0.3;
        transform: scale(0.9);
        pointer-events: none;
      }

      .zodiac-crystal-cell--collected {
        border-color: var(--element-color);
        background: var(--element-glow);
      }

      .zodiac-crystal-cell--uncollected {
        filter: saturate(0.3);
      }

      .zodiac-crystal-cell:hover:not(.zodiac-crystal-cell--filtered) {
        transform: scale(1.08) translateY(-4px);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
        z-index: 1;
      }

      .zodiac-crystal-cell--collected:hover:not(.zodiac-crystal-cell--filtered) {
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25), 0 0 15px var(--element-glow);
      }

      .zodiac-crystal-orb {
        margin-bottom: 6px;
      }

      .zodiac-crystal-name {
        font-size: 11px;
        font-weight: bold;
        text-transform: capitalize;
        color: ${P.text.primary};
        text-align: center;
        margin-bottom: 2px;
      }

      .zodiac-crystal-cell--uncollected .zodiac-crystal-name {
        color: ${P.text.muted};
      }

      .zodiac-crystal-bonus {
        font-size: 9px;
        color: ${P.text.secondary};
      }

      .zodiac-crystal-cell--uncollected .zodiac-crystal-bonus {
        color: ${P.text.muted};
      }

      /* Footer Bonus Panel */
      .zodiac-modal-footer {
        padding: 14px 16px;
        border-top: ${getParchmentBorder()};
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
      }

      .zodiac-bonus-panel {
        padding: 12px 16px;
        background: linear-gradient(135deg, rgba(139, 115, 85, 0.1), rgba(139, 115, 85, 0.05));
        border: 1px dashed ${P.border};
        border-radius: 8px;
        text-align: center;
        transition: all 0.3s ease;
      }

      .zodiac-bonus-panel--active {
        background: linear-gradient(135deg, rgba(255, 215, 0, 0.2), rgba(255, 200, 100, 0.1));
        border: 2px solid #ffd700;
        box-shadow: 0 0 20px rgba(255, 215, 0, 0.3);
      }

      .zodiac-bonus-title {
        font-size: 14px;
        font-weight: bold;
        color: ${P.accent.copper};
        margin-bottom: 4px;
      }

      .zodiac-bonus-panel--active .zodiac-bonus-title {
        color: #ffd700;
      }

      .zodiac-bonus-desc {
        font-size: 12px;
        color: ${P.text.secondary};
      }

      /* Loading/Error states */
      .zodiac-modal-loading,
      .zodiac-modal-error {
        text-align: center;
        padding: 60px 20px;
        color: ${P.text.secondary};
      }

      .zodiac-modal-error {
        color: ${P.state.error};
      }

      /* Entry animation */
      .zodiac-crystal-cell--entering {
        opacity: 0;
        transform: scale(0.5);
      }

      @keyframes zodiac-crystal-enter {
        from {
          opacity: 0;
          transform: scale(0.5) rotate(-10deg);
        }
        to {
          opacity: 1;
          transform: scale(1) rotate(0deg);
        }
      }

      @media (max-width: 540px) {
        .zodiac-modal {
          width: 100%;
          max-height: 90vh;
          border-radius: 0;
        }

        .zodiac-grid {
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
        }

        .zodiac-crystal-cell {
          padding: 10px 6px 8px;
        }

        .zodiac-filter-tabs {
          flex-wrap: wrap;
          gap: 4px;
          padding: 10px 12px;
        }

        .zodiac-filter-tab {
          padding: 5px 10px;
          font-size: 11px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  async show() {
    this.abortController = new AbortController();

    await this.loadData();
    this.createElement();
    this.game.uiOverlay.appendChild(this.element);
    this.startEntryAnimation();
    this.startAnimationLoop();
  }

  async loadData() {
    this.isLoading = true;
    this.error = null;

    try {
      const response = await this.game.api.get('/world/zodiac-collection');
      this.zodiacData = response;

      // Build crystal map for easy lookup
      this.crystalMap.clear();
      for (const crystal of response.crystals) {
        this.crystalMap.set(crystal.sign, crystal);
      }

      this.isLoading = false;
    } catch (err) {
      console.error('Failed to load zodiac collection:', err);
      this.error = err.message || 'Failed to load collection';
      this.isLoading = false;
    }
  }

  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'zodiac-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'zodiac-modal';

    // Header with progress ring
    modal.appendChild(this.createHeader());

    // Filter tabs
    modal.appendChild(this.createFilterTabs());

    // Content
    const content = document.createElement('div');
    content.className = 'zodiac-modal-content';

    if (this.isLoading) {
      content.innerHTML = '<div class="zodiac-modal-loading">Loading collection...</div>';
    } else if (this.error) {
      content.innerHTML = `<div class="zodiac-modal-error">${this.error}</div>`;
    } else {
      content.appendChild(this.createGrid());
    }

    modal.appendChild(content);

    // Footer with bonus panel
    modal.appendChild(this.createFooter());

    this.element.appendChild(modal);

    // Close on overlay click
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) {
        this.close();
      }
    }, { signal: this.abortController.signal });
  }

  createHeader() {
    const header = document.createElement('div');
    header.className = 'zodiac-modal-header';

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'zodiac-modal-close';
    closeBtn.innerHTML = '\u2715';
    closeBtn.addEventListener('click', () => this.close(), { signal: this.abortController.signal });
    header.appendChild(closeBtn);

    // Title group with progress ring
    const titleGroup = document.createElement('div');
    titleGroup.className = 'zodiac-modal-title-group';

    // Progress ring
    const collected = this.zodiacData?.totalCollected ?? 0;
    const total = 12;
    const isComplete = collected === total;
    titleGroup.appendChild(this.createProgressRing(collected, total, isComplete));

    // Title text
    const titleText = document.createElement('div');
    titleText.innerHTML = `
      <h2 class="zodiac-modal-title">Zodiac Crystal Collection</h2>
      <p class="zodiac-modal-subtitle">Gather the celestial treasures</p>
    `;
    titleGroup.appendChild(titleText);

    header.appendChild(titleGroup);
    return header;
  }

  createProgressRing(collected, total, isComplete) {
    const container = document.createElement('div');
    container.className = `zodiac-progress-ring ${isComplete ? 'zodiac-progress-ring--complete' : ''}`;

    const radius = 20;
    const circumference = 2 * Math.PI * radius;
    const progress = collected / total;
    const dashOffset = circumference * (1 - progress);

    container.innerHTML = `
      <svg width="48" height="48" viewBox="0 0 48 48">
        <circle class="zodiac-progress-ring-bg" cx="24" cy="24" r="${radius}" stroke-width="4" />
        <circle class="zodiac-progress-ring-fill" cx="24" cy="24" r="${radius}" stroke-width="4"
          stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}" />
      </svg>
      <span class="zodiac-progress-text">${collected}/${total}</span>
    `;

    return container;
  }

  createFilterTabs() {
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'zodiac-filter-tabs';

    const filters = ['all', 'fire', 'earth', 'air', 'water'];
    const labels = { all: 'All', fire: 'Fire', earth: 'Earth', air: 'Air', water: 'Water' };

    for (const filter of filters) {
      const tab = document.createElement('button');
      tab.className = `zodiac-filter-tab ${this.activeFilter === filter ? 'zodiac-filter-tab--active' : ''}`;
      tab.textContent = labels[filter];
      tab.style.setProperty('--tab-bg', FILTER_COLORS[filter].bg);
      tab.style.setProperty('--tab-text', FILTER_COLORS[filter].text);

      tab.addEventListener('click', () => this.setFilter(filter), { signal: this.abortController.signal });
      tabsContainer.appendChild(tab);
    }

    this.tabsContainer = tabsContainer;
    return tabsContainer;
  }

  createGrid() {
    const grid = document.createElement('div');
    grid.className = 'zodiac-grid';

    for (const sign of ZODIAC_ORDER) {
      const crystal = this.crystalMap.get(sign);
      if (crystal) {
        grid.appendChild(this.createCrystalCell(sign, crystal));
      }
    }

    this.gridElement = grid;
    return grid;
  }

  createCrystalCell(sign, crystal) {
    const { collected, bonus } = crystal;
    const info = ZODIAC_INFO[sign];
    const colors = ELEMENT_COLORS[info?.element || 'fire'];

    const cell = document.createElement('div');
    cell.className = `zodiac-crystal-cell zodiac-crystal-cell--entering ${collected ? 'zodiac-crystal-cell--collected' : 'zodiac-crystal-cell--uncollected'}`;
    cell.dataset.sign = sign;
    cell.dataset.element = info?.element || 'fire';
    cell.style.setProperty('--element-color', colors.primary);
    cell.style.setProperty('--element-glow', colors.glow);

    // Create CrystalOrb canvas
    const orb = new CrystalOrb({
      sign,
      size: 32,
      collected,
      showConstellation: true,
      animated: collected
    });
    this.crystalOrbs.set(sign, orb);

    const orbContainer = document.createElement('div');
    orbContainer.className = 'zodiac-crystal-orb';
    orbContainer.appendChild(orb.canvas);
    cell.appendChild(orbContainer);

    // Name
    const nameEl = document.createElement('div');
    nameEl.className = 'zodiac-crystal-name';
    nameEl.textContent = info?.name || sign;
    cell.appendChild(nameEl);

    // Bonus
    const bonusEl = document.createElement('div');
    bonusEl.className = 'zodiac-crystal-bonus';
    const bonusTypeDisplay = this.formatBonusType(bonus?.type);
    const bonusValue = bonus ? `+${Math.round(bonus.value * 100)}%` : '';
    bonusEl.textContent = `${bonusValue} ${bonusTypeDisplay}`;
    cell.appendChild(bonusEl);

    // Click handler
    cell.addEventListener('click', () => this.handleCrystalClick(sign, crystal), { signal: this.abortController.signal });

    return cell;
  }

  formatBonusType(type) {
    const typeMap = {
      physical_damage: 'DMG',
      defense: 'DEF',
      crit_chance: 'CRIT',
      healing_received: 'HEAL'
    };
    return typeMap[type] || type || '';
  }

  createFooter() {
    const footer = document.createElement('div');
    footer.className = 'zodiac-modal-footer';

    const isComplete = this.zodiacData?.collectionComplete ?? false;
    const bonusPanel = document.createElement('div');
    bonusPanel.className = `zodiac-bonus-panel ${isComplete ? 'zodiac-bonus-panel--active' : ''}`;

    if (isComplete) {
      bonusPanel.innerHTML = `
        <div class="zodiac-bonus-title">Celestial Wanderer - Active!</div>
        <div class="zodiac-bonus-desc">+5% all stats, dual blessing slots unlocked</div>
      `;
    } else {
      bonusPanel.innerHTML = `
        <div class="zodiac-bonus-title">Collection Bonus</div>
        <div class="zodiac-bonus-desc">Collect all 12 for +5% all stats</div>
      `;
    }

    footer.appendChild(bonusPanel);
    return footer;
  }

  setFilter(element) {
    if (this.activeFilter === element) return;

    this.activeFilter = element;

    // Update tab styling
    const tabs = this.tabsContainer?.querySelectorAll('.zodiac-filter-tab');
    if (tabs) {
      const filters = ['all', 'fire', 'earth', 'air', 'water'];
      tabs.forEach((tab, i) => {
        tab.classList.toggle('zodiac-filter-tab--active', filters[i] === element);
      });
    }

    // Update grid cells
    const cells = this.gridElement?.querySelectorAll('.zodiac-crystal-cell');
    if (cells) {
      cells.forEach(cell => {
        const cellElement = cell.dataset.element;
        const isFiltered = element !== 'all' && cellElement !== element;
        cell.classList.toggle('zodiac-crystal-cell--filtered', isFiltered);
      });
    }
  }

  handleCrystalClick(sign, crystal) {
    if (this.onCrystalSelect) {
      this.onCrystalSelect(sign, crystal);
    }
  }

  startEntryAnimation() {
    const cells = this.gridElement?.querySelectorAll('.zodiac-crystal-cell--entering');
    if (!cells) return;

    // Spiral order for staggered animation
    const spiralOrder = [0, 1, 2, 3, 7, 11, 10, 9, 8, 4, 5, 6];

    cells.forEach((cell, index) => {
      const spiralIndex = spiralOrder[index] ?? index;
      const delay = spiralIndex * 50;

      setTimeout(() => {
        cell.classList.remove('zodiac-crystal-cell--entering');
        cell.style.animation = 'zodiac-crystal-enter 0.3s ease forwards';

        // Clear animation after it completes so CSS classes can take effect
        setTimeout(() => {
          cell.style.animation = '';
        }, 300);
      }, delay);
    });
  }

  startAnimationLoop() {
    const animate = (timestamp) => {
      if (!this.element) return;

      const deltaTime = this.lastAnimationTime ? timestamp - this.lastAnimationTime : 16;
      this.lastAnimationTime = timestamp;

      // Update all crystal orbs
      for (const orb of this.crystalOrbs.values()) {
        orb.update(deltaTime);
        orb.render();
      }

      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  close() {
    if (this.onClose) {
      this.onClose();
    }
    this.destroy();
  }

  destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Cleanup crystal orbs
    for (const orb of this.crystalOrbs.values()) {
      orb.destroy();
    }
    this.crystalOrbs.clear();

    if (this.element?.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.gridElement = null;
    this.tabsContainer = null;
  }
}
