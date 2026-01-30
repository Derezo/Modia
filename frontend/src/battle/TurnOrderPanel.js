/**
 * TurnOrderPanel - Collapsible turn order display for battle UI
 *
 * Features:
 * - Collapsed state: Shows only the next character (not current active)
 * - Expanded state: Shows next 5 turns visible, scrollable to 20
 * - Tap-to-preview: Tapping a unit pans camera and shows their card
 * - Parchment theme styling with burgundy title
 * - Mobile-friendly with 44px touch targets
 */

import { PARCHMENT_COLORS, PARCHMENT_TYPOGRAPHY, PARCHMENT_SPACING } from '../ui/parchment/ParchmentTheme.js';
import { getUnitPortraitHtml, getClassLetter } from './turnOrderUtils.js';

const P = PARCHMENT_COLORS;
const T = PARCHMENT_TYPOGRAPHY;
const S = PARCHMENT_SPACING;

export default class TurnOrderPanel {
  /**
   * @param {Object} options
   * @param {Function} options.onUnitTap - Callback when a unit is tapped (unit) => void
   * @param {Function} options.onPreviewUnit - Callback to show unit in target panel (unit) => void
   */
  constructor(options = {}) {
    this.isExpanded = false;
    this.predictions = [];
    this.selectedPreviewUnit = null;
    this.iconCache = new Map();
    this.currentRenderId = 0; // For preventing stale async renders

    this.callbacks = {
      onUnitTap: options.onUnitTap || null,
      onPreviewUnit: options.onPreviewUnit || null
    };

    // Bound handlers for cleanup
    this.boundHandleListClick = this.handleListClick.bind(this);
    this.boundToggle = this.toggle.bind(this);

    this.element = this.createElement();
    this.injectStyles();
  }

  /**
   * Create the main panel element
   */
  createElement() {
    const panel = document.createElement('div');
    panel.className = 'turn-order-panel turn-order-panel--collapsed';
    panel.innerHTML = `
      <div class="turn-order-panel__header">
        <span class="turn-order-panel__title">Next</span>
        <span class="turn-order-panel__chevron">&#9660;</span>
      </div>
      <div class="turn-order-panel__list"></div>
    `;

    // Header click toggles expand/collapse (using bound handler for cleanup)
    const header = panel.querySelector('.turn-order-panel__header');
    header.addEventListener('click', this.boundToggle);

    // Use event delegation for list items (single listener, no leaks)
    const list = panel.querySelector('.turn-order-panel__list');
    list.addEventListener('click', this.boundHandleListClick);

    return panel;
  }

  /**
   * Handle click on list (event delegation)
   * @param {Event} e - Click event
   */
  handleListClick(e) {
    const item = e.target.closest('.turn-order-item');
    if (!item) return;

    e.stopPropagation();
    const unitId = item.dataset.unitId;
    // Find the prediction - skip index 0 (active unit) when searching
    const prediction = this.predictions.slice(1).find(p => String(p.id) === unitId);
    if (prediction) {
      this.handleItemClick(prediction);
    }
  }

  /**
   * Inject component styles into document
   */
  injectStyles() {
    if (document.getElementById('turn-order-panel-styles')) return;

    const style = document.createElement('style');
    style.id = 'turn-order-panel-styles';
    style.textContent = `
      .turn-order-panel {
        background: linear-gradient(to bottom, ${P.light} 0%, ${P.mid} 50%, ${P.dark} 100%);
        border: 2px solid ${P.border};
        border-radius: 4px;
        box-shadow: 0 3px 8px ${P.shadow},
                    inset 0 1px 0 ${P.highlight},
                    inset 0 -1px 0 rgba(0, 0, 0, 0.1);
        font-family: ${T.fontFamily};
        min-width: 160px;
        max-width: 200px;
        overflow: hidden;
        transition: max-height 0.3s ease;
      }

      .turn-order-panel__header {
        background: linear-gradient(to bottom, ${P.border}, ${P.borderDark});
        color: ${P.text.inverse};
        font-size: ${T.sizes.sm};
        font-weight: ${T.weights.bold};
        padding: ${S.sm} ${S.md};
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
        user-select: none;
        min-height: 36px;
      }

      .turn-order-panel__header:hover {
        background: linear-gradient(to bottom, ${P.borderLight}, ${P.border});
      }

      .turn-order-panel__header:active {
        background: linear-gradient(to bottom, ${P.borderDark}, ${P.borderDark});
      }

      .turn-order-panel__title {
        color: ${P.accent.burgundy};
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .turn-order-panel__chevron {
        font-size: 10px;
        transition: transform 0.3s ease;
        color: ${P.text.inverse};
        opacity: 0.7;
      }

      .turn-order-panel--expanded .turn-order-panel__chevron {
        transform: rotate(180deg);
      }

      .turn-order-panel__list {
        overflow: hidden;
        transition: max-height 0.3s ease;
      }

      .turn-order-panel--collapsed .turn-order-panel__list {
        max-height: 52px;
      }

      .turn-order-panel--expanded .turn-order-panel__list {
        max-height: 264px;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: ${P.border} ${P.light};
      }

      .turn-order-panel--expanded .turn-order-panel__list::-webkit-scrollbar {
        width: 8px;
      }

      .turn-order-panel--expanded .turn-order-panel__list::-webkit-scrollbar-track {
        background: ${P.light};
        border-radius: 4px;
      }

      .turn-order-panel--expanded .turn-order-panel__list::-webkit-scrollbar-thumb {
        background: ${P.border};
        border-radius: 4px;
      }

      .turn-order-item {
        display: flex;
        align-items: center;
        padding: 6px 10px;
        min-height: 44px;
        cursor: pointer;
        border-bottom: 1px solid rgba(107, 83, 68, 0.15);
        transition: background 0.15s ease;
        box-sizing: border-box;
      }

      .turn-order-item:last-child {
        border-bottom: none;
      }

      .turn-order-item:hover {
        background: rgba(139, 115, 85, 0.15);
      }

      .turn-order-item:active {
        background: rgba(139, 115, 85, 0.25);
      }

      .turn-order-item--player {
        border-left: 3px solid ${P.state.info};
      }

      .turn-order-item--enemy {
        border-left: 3px solid ${P.state.error};
      }

      .turn-order-item--selected {
        background: rgba(107, 45, 61, 0.15);
        border-left-color: ${P.accent.burgundy};
      }

      .turn-order-item__icon {
        width: 28px;
        height: 28px;
        margin-right: 10px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        overflow: hidden;
      }

      .turn-order-item__icon img {
        width: 24px;
        height: 24px;
        object-fit: contain;
      }

      .turn-order-item__icon-fallback {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: bold;
        color: #fff;
      }

      .turn-order-item--player .turn-order-item__icon-fallback {
        background: ${P.state.info};
      }

      .turn-order-item--enemy .turn-order-item__icon-fallback {
        background: ${P.state.error};
      }

      .turn-order-item__name {
        flex: 1;
        font-size: ${T.sizes.sm};
        color: ${P.text.primary};
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.3;
      }

      .turn-order-panel__empty {
        padding: ${S.md};
        text-align: center;
        color: ${P.text.muted};
        font-size: ${T.sizes.sm};
        font-style: italic;
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Toggle expanded/collapsed state
   */
  toggle() {
    this.isExpanded = !this.isExpanded;
    this.element.classList.toggle('turn-order-panel--collapsed', !this.isExpanded);
    this.element.classList.toggle('turn-order-panel--expanded', this.isExpanded);

    // Update title
    const title = this.element.querySelector('.turn-order-panel__title');
    title.textContent = this.isExpanded ? 'Turn Order' : 'Next';
  }

  /**
   * Expand the panel
   */
  expand() {
    if (!this.isExpanded) {
      this.toggle();
    }
  }

  /**
   * Collapse the panel
   */
  collapse() {
    if (this.isExpanded) {
      this.toggle();
    }
  }

  /**
   * Update turn order display
   * @param {Array} predictions - Turn predictions from battleState
   */
  update(predictions) {
    this.predictions = predictions || [];
    this.render();
  }

  /**
   * Render the turn order list
   */
  async render() {
    const renderId = ++this.currentRenderId;
    const list = this.element.querySelector('.turn-order-panel__list');
    if (!list) return;

    // Skip first prediction (active unit), show next ones
    // Collapsed: show 1, Expanded: show up to 20
    const startIndex = 1; // Skip active unit
    const maxItems = this.isExpanded ? 20 : 1;
    const visiblePredictions = this.predictions.slice(startIndex, startIndex + maxItems);

    if (visiblePredictions.length === 0) {
      list.innerHTML = '<div class="turn-order-panel__empty">No upcoming turns</div>';
      return;
    }

    // Build HTML for each prediction
    const items = await Promise.all(
      visiblePredictions.map((pred) => this.renderItem(pred))
    );

    // Check if this render is still current (prevent stale async renders)
    if (this.currentRenderId !== renderId) return;

    list.innerHTML = items.join('');
    // Click handling is done via event delegation in handleListClick()
  }

  /**
   * Render a single turn order item
   * @param {Object} prediction - Turn prediction data
   * @returns {Promise<string>} HTML string
   */
  async renderItem(prediction) {
    const isPlayer = prediction.type === 'player';
    const typeClass = isPlayer ? 'player' : 'enemy';
    const isSelected = this.selectedPreviewUnit &&
      this.selectedPreviewUnit.id === prediction.id;

    // Get icon HTML
    const iconHtml = await this.getIconHtml(prediction);

    return `
      <div class="turn-order-item turn-order-item--${typeClass}${isSelected ? ' turn-order-item--selected' : ''}"
           data-unit-id="${prediction.id}">
        <div class="turn-order-item__icon">
          ${iconHtml}
        </div>
        <span class="turn-order-item__name">${prediction.name}</span>
      </div>
    `;
  }

  /**
   * Get portrait HTML for a prediction using shared utilities
   * Uses portrait assets (race_gender_class for players, enemy_id for enemies)
   * @param {Object} prediction - Turn prediction data
   * @returns {Promise<string>} Portrait HTML
   */
  async getIconHtml(prediction) {
    // Use 32px for compact panel display
    return getUnitPortraitHtml(prediction, this.iconCache, 32);
  }

  /**
   * Get fallback icon (letter abbreviation)
   * @param {string} className - Class/type name
   * @returns {string} Fallback icon HTML
   */
  getFallbackIcon(className) {
    const letter = getClassLetter(className);
    return `<div class="turn-order-item__icon-fallback">${letter}</div>`;
  }

  /**
   * Handle item click (preview unit)
   * @param {Object} prediction - The clicked prediction
   */
  handleItemClick(prediction) {
    // Set as selected
    this.selectedPreviewUnit = prediction;

    // Re-render to show selection
    this.render();

    // Notify callbacks
    if (this.callbacks.onUnitTap) {
      this.callbacks.onUnitTap(prediction);
    }
    if (this.callbacks.onPreviewUnit) {
      this.callbacks.onPreviewUnit(prediction);
    }
  }

  /**
   * Clear the preview selection
   */
  clearPreview() {
    this.selectedPreviewUnit = null;
    this.render();
  }

  /**
   * Get the currently selected preview unit
   * @returns {Object|null} Selected unit or null
   */
  getPreviewUnit() {
    return this.selectedPreviewUnit;
  }

  /**
   * Destroy the panel and clean up
   */
  destroy() {
    // Remove event listeners
    const header = this.element.querySelector('.turn-order-panel__header');
    if (header) {
      header.removeEventListener('click', this.boundToggle);
    }
    const list = this.element.querySelector('.turn-order-panel__list');
    if (list) {
      list.removeEventListener('click', this.boundHandleListClick);
    }

    // Remove element
    this.element.remove();

    // Clear icon cache
    this.iconCache.clear();

    // Remove injected styles (only if no other instances exist)
    const styleElement = document.getElementById('turn-order-panel-styles');
    if (styleElement) {
      styleElement.remove();
    }
  }
}
