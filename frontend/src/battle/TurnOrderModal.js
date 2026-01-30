/**
 * @module TurnOrderModal
 * @description Full modal showing next 10 turns with rich unit information.
 *
 * Features:
 * - Unit portraits (64x64) with class/enemy images
 * - HP bars with color gradient (green -> yellow -> red)
 * - CT (Charge Time) progress bars showing turn readiness
 * - Status effect icons with remaining duration in turns
 * - Click unit to trigger callback (for camera pan + info card)
 * - Player/enemy color coding (blue/red borders)
 * - "CURRENT TURN" section for active unit, "UPCOMING" for next 9
 * - Scrollable content if needed
 *
 * @see TurnOrderPanel.js - Collapsible inline turn order display
 * @see turnOrderUtils.js - Shared bar and icon utilities
 */

import { ParchmentModal } from '../ui/parchment/ParchmentModal.js';
import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  getParchmentScrollbarCSS
} from '../ui/parchment/ParchmentTheme.js';
import {
  formatHPBar,
  formatCTBar,
  getUnitPortraitHtml,
  BAR_COLORS
} from './turnOrderUtils.js';
import { escapeHtml } from './battleLogUtils.js';

const P = PARCHMENT_COLORS;
const T = PARCHMENT_TYPOGRAPHY;
const S = PARCHMENT_SPACING;

const STYLE_ID = 'turn-order-modal-styles';

/**
 * Status effect icons and colors for display
 */
const STATUS_EFFECT_CONFIG = {
  poison: { icon: '\u2620\uFE0F', color: '#9c27b0', name: 'Poison' },
  burn: { icon: '\uD83D\uDD25', color: '#ff5722', name: 'Burn' },
  freeze: { icon: '\u2744\uFE0F', color: '#03a9f4', name: 'Freeze' },
  paralyze: { icon: '\u26A1', color: '#ffeb3b', name: 'Paralyze' },
  sleep: { icon: '\uD83D\uDCA4', color: '#9e9e9e', name: 'Sleep' },
  blind: { icon: '\uD83D\uDC41\uFE0F', color: '#424242', name: 'Blind' },
  silence: { icon: '\uD83E\uDD10', color: '#795548', name: 'Silence' },
  slow: { icon: '\uD83D\uDC22', color: '#607d8b', name: 'Slow' },
  haste: { icon: '\u2728', color: '#00bfff', name: 'Haste' },
  rage: { icon: '\uD83D\uDCA2', color: '#dc143c', name: 'Rage' },
  fortify: { icon: '\uD83D\uDEE1\uFE0F', color: '#4682b4', name: 'Fortify' },
  protect: { icon: '\uD83D\uDEE1\uFE0F', color: '#4682b4', name: 'Protect' },
  shell: { icon: '\uD83D\uDD2E', color: '#9c27b0', name: 'Shell' },
  regen: { icon: '\uD83D\uDC9A', color: '#4caf50', name: 'Regen' },
  bless: { icon: '\u2B50', color: '#ffd700', name: 'Bless' },
  curse: { icon: '\uD83D\uDC80', color: '#1a1a2e', name: 'Curse' },
  stun: { icon: '\uD83D\uDCAB', color: '#ff9800', name: 'Stun' },
  charging: { icon: '\u23F3', color: '#2196f3', name: 'Charging' }
};

/**
 * TurnOrderModal - Full modal showing next 10 turns with rich unit information
 */
export default class TurnOrderModal {
  /**
   * @param {Object} options - Modal configuration
   * @param {Function} [options.onUnitClick] - Called when a unit row is clicked
   * @param {Function} [options.onClose] - Called when modal is closed
   */
  constructor(options = {}) {
    this.callbacks = {
      onUnitClick: options.onUnitClick || null,
      onClose: options.onClose || null
    };

    this.turnQueue = [];
    this.iconCache = new Map();
    this.currentRenderId = 0;
    this.modal = null;
    this.contentContainer = null;

    // Bound handlers for event delegation
    this.boundHandleContentClick = this.handleContentClick.bind(this);
    this.boundHandleContentKeydown = this.handleContentKeydown.bind(this);

    this.injectStyles();
  }

  /**
   * Handle click on content (event delegation)
   * @param {Event} e - Click event
   */
  handleContentClick(e) {
    const unitEl = e.target.closest('.turn-order-unit');
    if (unitEl) {
      this.activateUnit(unitEl);
    }
  }

  /**
   * Handle keydown on content (event delegation)
   * @param {KeyboardEvent} e - Keyboard event
   */
  handleContentKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      const unitEl = e.target.closest('.turn-order-unit');
      if (unitEl) {
        e.preventDefault();
        this.activateUnit(unitEl);
      }
    }
  }

  /**
   * Activate a unit element (call callback)
   * @param {HTMLElement} unitEl - Unit element
   */
  activateUnit(unitEl) {
    const unitId = unitEl.dataset.unitId;
    const unit = this.turnQueue.find(u => String(u.id) === unitId);
    if (unit && this.callbacks.onUnitClick) {
      this.callbacks.onUnitClick(unit);
    }
  }

  /**
   * Inject component styles into document
   */
  injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Turn Order Modal Content */
      .turn-order-modal-content {
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-height: 60vh;
      }

      /* Section Headers */
      .turn-order-section {
        display: flex;
        flex-direction: column;
      }

      .turn-order-section__header {
        font-size: ${T.sizes.sm};
        font-weight: ${T.weights.bold};
        color: ${P.accent.burgundy};
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding-bottom: ${S.xs};
        margin-bottom: ${S.sm};
        border-bottom: 1px solid ${P.border};
      }

      /* Unit Row */
      .turn-order-unit {
        display: flex;
        flex-direction: column;
        padding: ${S.sm} ${S.md};
        background: ${P.light};
        border: 2px solid ${P.border};
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s ease;
        margin-bottom: ${S.sm};
      }

      .turn-order-unit:last-child {
        margin-bottom: 0;
      }

      .turn-order-unit:hover,
      .turn-order-unit:focus {
        background: ${P.mid};
        border-color: ${P.borderDark};
        transform: translateX(2px);
        outline: none;
      }

      .turn-order-unit:focus {
        box-shadow: 0 0 0 2px ${P.border};
      }

      .turn-order-unit:active {
        background: ${P.dark};
        transform: translateX(4px);
      }

      .turn-order-unit--player {
        border-left: 4px solid ${P.state.info};
      }

      .turn-order-unit--enemy {
        border-left: 4px solid ${P.state.error};
      }

      .turn-order-unit--current {
        background: linear-gradient(to right, rgba(255, 215, 0, 0.15), transparent);
        border-color: ${P.accent.copper};
      }

      /* Unit Header Row */
      .turn-order-unit__header {
        display: flex;
        align-items: center;
        gap: ${S.md};
      }

      /* Portrait */
      .turn-order-unit__portrait {
        width: 64px;
        height: 64px;
        flex-shrink: 0;
        border-radius: 4px;
        overflow: hidden;
        background: ${P.mid};
        border: 2px solid ${P.border};
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .turn-order-unit__portrait img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      .turn-order-unit__portrait-fallback {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        font-weight: bold;
        color: #fff;
      }

      .turn-order-unit--player .turn-order-unit__portrait-fallback {
        background: ${P.state.info};
      }

      .turn-order-unit--enemy .turn-order-unit__portrait-fallback {
        background: ${P.state.error};
      }

      /* Unit Info */
      .turn-order-unit__info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }

      .turn-order-unit__name-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .turn-order-unit__name {
        font-size: ${T.sizes.lg};
        font-weight: ${T.weights.bold};
        color: ${P.text.primary};
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 180px;
      }

      .turn-order-unit__ct {
        font-size: ${T.sizes.sm};
        font-weight: ${T.weights.bold};
        color: ${P.text.secondary};
        white-space: nowrap;
      }

      .turn-order-unit__ct--ready {
        color: ${BAR_COLORS.ct.ready};
      }

      /* HP Bar */
      .turn-order-unit__hp-row {
        display: flex;
        align-items: center;
        gap: ${S.sm};
      }

      .turn-order-unit__hp-label {
        font-size: ${T.sizes.sm};
        font-weight: ${T.weights.bold};
        color: ${P.text.secondary};
        width: 24px;
        flex-shrink: 0;
      }

      .turn-order-unit__hp-bar {
        flex: 1;
        height: 14px;
        background: ${BAR_COLORS.hp.background};
        border-radius: 3px;
        overflow: hidden;
        border: 1px solid ${BAR_COLORS.hp.border};
      }

      .turn-order-unit__hp-fill {
        height: 100%;
        transition: width 0.3s ease, background-color 0.3s ease;
        border-radius: 2px;
      }

      .turn-order-unit__hp-text {
        font-size: ${T.sizes.sm};
        color: ${P.text.secondary};
        min-width: 70px;
        text-align: right;
      }

      /* Status Effects */
      .turn-order-unit__status {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
        min-height: 24px;
      }

      .turn-order-status-effect {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 2px 6px;
        background: rgba(0, 0, 0, 0.1);
        border-radius: 12px;
        font-size: ${T.sizes.xs};
        color: ${P.text.primary};
      }

      .turn-order-status-effect__icon {
        font-size: 12px;
      }

      .turn-order-status-effect__duration {
        font-weight: ${T.weights.bold};
        color: ${P.text.secondary};
      }

      /* Upcoming Section - Scrollable */
      .turn-order-upcoming {
        flex: 1;
        overflow-y: auto;
        min-height: 100px;
        padding-right: ${S.xs};
      }

      ${getParchmentScrollbarCSS('.turn-order-upcoming')}

      /* Upcoming Unit - Compact Version */
      .turn-order-upcoming .turn-order-unit {
        padding: ${S.xs} ${S.sm};
      }

      .turn-order-upcoming .turn-order-unit__portrait {
        width: 48px;
        height: 48px;
      }

      .turn-order-upcoming .turn-order-unit__portrait-fallback {
        font-size: 20px;
      }

      .turn-order-upcoming .turn-order-unit__name {
        font-size: ${T.sizes.base};
      }

      .turn-order-upcoming .turn-order-unit__hp-row {
        gap: ${S.xs};
      }

      .turn-order-upcoming .turn-order-unit__hp-bar {
        height: 10px;
      }

      .turn-order-upcoming .turn-order-unit__hp-text {
        font-size: ${T.sizes.xs};
        min-width: 60px;
      }

      .turn-order-upcoming .turn-order-unit__status {
        min-height: 20px;
      }

      /* Position Indicator */
      .turn-order-unit__position {
        font-size: ${T.sizes.sm};
        font-weight: ${T.weights.bold};
        color: ${P.text.muted};
        width: 20px;
        text-align: center;
        flex-shrink: 0;
      }

      /* Empty State */
      .turn-order-empty {
        padding: ${S.lg};
        text-align: center;
        color: ${P.text.muted};
        font-style: italic;
      }

      /* Mobile responsiveness */
      @media (max-width: 480px) {
        .turn-order-modal-content {
          max-height: 70vh;
        }

        .turn-order-unit__portrait {
          width: 48px;
          height: 48px;
        }

        .turn-order-unit__portrait-fallback {
          font-size: 20px;
        }

        .turn-order-unit__name {
          font-size: ${T.sizes.base};
          max-width: 120px;
        }

        .turn-order-unit__hp-text {
          font-size: ${T.sizes.xs};
          min-width: 50px;
        }

        .turn-order-unit__status {
          gap: 4px;
        }

        .turn-order-status-effect {
          padding: 1px 4px;
          font-size: 10px;
        }

        /* Compact view for upcoming units on mobile */
        .turn-order-upcoming .turn-order-unit__portrait {
          width: 36px;
          height: 36px;
        }

        .turn-order-upcoming .turn-order-unit__name {
          font-size: ${T.sizes.sm};
          max-width: 100px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Open the modal
   */
  open() {
    if (this.modal && this.modal.isVisible()) return;

    // Create content container
    this.contentContainer = document.createElement('div');
    this.contentContainer.className = 'turn-order-modal-content';

    // Attach click and keyboard handlers via event delegation (once, not on every render)
    this.contentContainer.addEventListener('click', this.boundHandleContentClick);
    this.contentContainer.addEventListener('keydown', this.boundHandleContentKeydown);

    // Create the modal using ParchmentModal
    this.modal = new ParchmentModal({
      title: 'Turn Order',
      content: this.contentContainer,
      size: 'md',
      closable: true,
      closeOnOverlay: true,
      closeOnEscape: true,
      onClose: () => {
        if (this.callbacks.onClose) {
          this.callbacks.onClose();
        }
      }
    });

    this.modal.open();
    this.render();
  }

  /**
   * Close the modal
   */
  close() {
    if (this.contentContainer) {
      this.contentContainer.removeEventListener('click', this.boundHandleContentClick);
      this.contentContainer.removeEventListener('keydown', this.boundHandleContentKeydown);
    }
    if (this.modal) {
      this.modal.close();
      this.modal = null;
      this.contentContainer = null;
    }
  }

  /**
   * Check if modal is currently open
   * @returns {boolean}
   */
  isOpen() {
    return this.modal !== null && this.modal.isVisible();
  }

  /**
   * Update the displayed turn order
   * @param {Array} turnQueue - Array of unit predictions
   */
  updateTurnOrder(turnQueue) {
    this.turnQueue = turnQueue || [];
    if (this.isOpen()) {
      this.render();
    }
  }

  /**
   * Render the turn order content
   */
  async render() {
    if (!this.contentContainer) return;

    const renderId = ++this.currentRenderId;
    const queue = this.turnQueue.slice(); // Snapshot current queue to avoid race conditions

    if (queue.length === 0) {
      this.contentContainer.innerHTML = `
        <div class="turn-order-empty">No turns to display</div>
      `;
      return;
    }

    // Build HTML for current turn and upcoming
    const [currentUnit, ...upcomingUnits] = queue.slice(0, 10);

    // Build current turn section
    let html = '';

    if (currentUnit) {
      const currentHtml = await this.renderUnit(currentUnit, 0, true);
      if (this.currentRenderId !== renderId) return;

      html += `
        <div class="turn-order-section">
          <div class="turn-order-section__header">Current Turn</div>
          ${currentHtml}
        </div>
      `;
    }

    // Build upcoming section (next 9 units)
    if (upcomingUnits.length > 0) {
      const upcomingHtml = await Promise.all(
        upcomingUnits.map((unit, i) => this.renderUnit(unit, i + 1, false))
      );
      if (this.currentRenderId !== renderId) return;

      html += `
        <div class="turn-order-section">
          <div class="turn-order-section__header">Upcoming</div>
          <div class="turn-order-upcoming">
            ${upcomingHtml.join('')}
          </div>
        </div>
      `;
    }

    this.contentContainer.innerHTML = html;
    // Click handling is done via event delegation in handleContentClick()
  }

  /**
   * Render a single unit row
   * @param {Object} unit - Unit data
   * @param {number} position - Position in queue (0 = current)
   * @param {boolean} isCurrent - Whether this is the current turn
   * @returns {Promise<string>} HTML string
   */
  async renderUnit(unit, position, isCurrent) {
    const isPlayer = unit.type === 'player';
    const typeClass = isPlayer ? 'player' : 'enemy';
    const currentClass = isCurrent ? ' turn-order-unit--current' : '';

    // Get portrait HTML
    const portraitHtml = await this.renderPortrait(unit);

    // Get HP bar data
    const hp = unit.hp ?? unit.hp_current ?? 0;
    const maxHp = unit.maxHp ?? unit.hp_max ?? 1;
    const hpData = formatHPBar(hp, maxHp);

    // Get CT data
    const ct = unit.ct ?? unit.charge_time ?? 0;
    const maxCt = 100;
    const ctData = formatCTBar(ct, maxCt);
    const ctReady = ctData.percent >= 1;

    // Get status effects HTML
    const statusHtml = this.renderStatusEffects(unit.statusEffects || []);

    // Position indicator (only for upcoming units)
    const positionHtml = !isCurrent
      ? `<div class="turn-order-unit__position">${position}.</div>`
      : '';

    const escapedName = escapeHtml(unit.name);

    return `
      <div class="turn-order-unit turn-order-unit--${typeClass}${currentClass}"
           data-unit-id="${unit.id}"
           tabindex="0"
           role="button"
           aria-label="${escapedName}, HP: ${hpData.text}, CT: ${Math.floor(ctData.percent * 100)}%">
        <div class="turn-order-unit__header">
          ${positionHtml}
          <div class="turn-order-unit__portrait">
            ${portraitHtml}
          </div>
          <div class="turn-order-unit__info">
            <div class="turn-order-unit__name-row">
              <span class="turn-order-unit__name" title="${escapedName}">${escapedName}</span>
              <span class="turn-order-unit__ct${ctReady ? ' turn-order-unit__ct--ready' : ''}">
                CT: ${Math.floor(ctData.percent * 100)}%
              </span>
            </div>
            <div class="turn-order-unit__hp-row">
              <span class="turn-order-unit__hp-label">HP:</span>
              <div class="turn-order-unit__hp-bar">
                <div class="turn-order-unit__hp-fill"
                     style="width: ${hpData.percent * 100}%; background-color: ${hpData.color};">
                </div>
              </div>
              <span class="turn-order-unit__hp-text">${hpData.text}</span>
            </div>
            <div class="turn-order-unit__status">
              ${statusHtml}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render unit portrait
   * Uses portrait assets (race_gender_class for players, enemy_id for enemies)
   * @param {Object} unit - Unit data
   * @returns {Promise<string>} HTML string
   */
  async renderPortrait(unit) {
    const size = 64;
    const portraitHtml = await getUnitPortraitHtml(unit, this.iconCache, size);

    // Check if we got an image or fallback
    if (portraitHtml.includes('<img')) {
      return portraitHtml;
    }

    // Return styled fallback
    return `<div class="turn-order-unit__portrait-fallback">${portraitHtml.replace(/<[^>]*>/g, '').trim()}</div>`;
  }

  /**
   * Render status effects badges
   * @param {Array} effects - Array of status effects
   * @returns {string} HTML string
   */
  renderStatusEffects(effects) {
    if (!effects || effects.length === 0) {
      return '';
    }

    return effects.map(effect => {
      const effectType = (effect.type || effect.name || '').toLowerCase();
      const config = STATUS_EFFECT_CONFIG[effectType] || {
        icon: '\u2753',
        color: P.text.muted,
        name: effectType
      };

      const duration = effect.duration ?? effect.remainingTurns ?? 0;
      const durationText = duration > 0 ? `(${duration})` : '';

      return `
        <span class="turn-order-status-effect"
              title="${config.name}${durationText ? ' - ' + duration + ' turns remaining' : ''}">
          <span class="turn-order-status-effect__icon" style="color: ${config.color};">
            ${config.icon}
          </span>
          ${durationText ? `<span class="turn-order-status-effect__duration">${durationText}</span>` : ''}
        </span>
      `;
    }).join('');
  }

  /**
   * Destroy the modal and clean up resources
   */
  destroy() {
    this.close();

    // Clear icon cache
    this.iconCache.clear();

    // Remove injected styles (only if safe to do so)
    // Note: We leave styles in place as other instances may use them
    // const styleElement = document.getElementById(STYLE_ID);
    // if (styleElement) {
    //   styleElement.remove();
    // }

    this.callbacks = {
      onUnitClick: null,
      onClose: null
    };
    this.turnQueue = [];
  }
}
