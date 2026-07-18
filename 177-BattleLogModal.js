/**
 * @module BattleLogModal
 * @description Full-featured modal dialog showing complete battle history with filtering.
 *
 * Key responsibilities:
 * - Display complete battle log with turn grouping
 * - Filter entries by type (All, Damage, Healing, Status, Movement)
 * - Enhanced damage breakdown (base + crit + modifiers)
 * - Clickable unit names for camera pan / info card
 * - Efficient rendering for 100+ entries
 * - Unread entry tracking
 *
 * @see BattleLogPanel.js - Collapsible inline log panel (compact view)
 * @see battleLogUtils.js - Shared formatting utilities
 * @see ParchmentModal.js - Modal base component
 */

import { ParchmentModal } from '../ui/parchment/ParchmentModal.js';
import { PARCHMENT_COLORS, PARCHMENT_TYPOGRAPHY, PARCHMENT_SPACING } from '../ui/parchment/ParchmentTheme.js';
import {
  LOG_COLORS,
  getEntryType,
  escapeHtml
} from './battleLogUtils.js';
import { buildPortraitId, getClassLetter } from './turnOrderUtils.js';
import { getAssetPath } from '@shared/assetPaths.js';

const P = PARCHMENT_COLORS;
const T = PARCHMENT_TYPOGRAPHY;
const S = PARCHMENT_SPACING;

const STYLE_ID = 'battle-log-modal-styles';

/**
 * Filter types for battle log entries
 */
const FILTER_TYPES = {
  all: { label: 'All', matches: () => true },
  damage: { label: 'Damage', matches: (e) => e.result?.damage > 0 || e.result?.missed },
  healing: { label: 'Healing', matches: (e) => e.result?.healing > 0 },
  status: { label: 'Status', matches: (e) => e.result?.statusApplied || e.result?.statusRemoved },
  movement: { label: 'Move', matches: (e) => e.action?.type === 'move' }
};

/**
 * BattleLogModal - Full modal showing complete battle history with filtering
 */
export default class BattleLogModal {
  /**
   * @param {Object} options - Configuration options
   * @param {Function} [options.onUnitClick] - Callback when a unit name is clicked (receives unit object)
   * @param {Function} [options.onClose] - Callback when modal is closed
   * @param {number} [options.maxEntries=200] - Maximum entries to store
   */
  constructor(options = {}) {
    this.onUnitClick = options.onUnitClick || null;
    this.onClose = options.onClose || null;
    this.maxEntries = options.maxEntries || 200;

    this.entries = [];
    this.activeFilter = 'all';
    this.battleStartTime = null;
    this.lastOpenedEntryCount = 0;
    this.isOpen = false;
    this.visibleTurnLimit = 10; // Initial visible turns for performance
    this.showAllTurns = false;

    this.modal = null;
    this.contentElement = null;
    this.filterBar = null;
    this.logList = null;
    this.abortController = null;

    this.injectStyles();
  }

  /**
   * Inject component styles (only once per page)
   */
  injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Battle Log Modal Content */
      .battle-log-modal-content {
        display: flex;
        flex-direction: column;
        height: 400px;
        max-height: 60vh;
        margin: -16px;
      }

      /* Filter Bar */
      .battle-log-filter-bar {
        display: flex;
        gap: 4px;
        padding: ${S.sm} ${S.md};
        background: linear-gradient(to bottom, ${P.mid} 0%, ${P.dark} 100%);
        border-bottom: 1px solid ${P.border};
        flex-shrink: 0;
        flex-wrap: wrap;
      }

      .battle-log-filter-btn {
        background: ${P.light};
        border: 1px solid ${P.border};
        border-radius: 3px;
        color: ${P.text.secondary};
        font-family: ${T.fontFamily};
        font-size: ${T.sizes.xs};
        padding: 4px 10px;
        cursor: pointer;
        transition: all 0.15s ease;
        min-width: 50px;
        text-align: center;
      }

      .battle-log-filter-btn:hover {
        background: ${P.mid};
        border-color: ${P.borderDark};
      }

      .battle-log-filter-btn--active {
        background: linear-gradient(to bottom, ${P.border} 0%, ${P.borderDark} 100%);
        color: ${P.text.inverse};
        border-color: ${P.borderDark};
      }

      .battle-log-filter-btn--active:hover {
        background: linear-gradient(to bottom, ${P.borderLight} 0%, ${P.border} 100%);
      }

      /* Log List Container */
      .battle-log-list {
        flex: 1;
        overflow-y: auto;
        padding: ${S.sm};
        scrollbar-width: thin;
        scrollbar-color: ${P.border} ${P.light};
      }

      .battle-log-list::-webkit-scrollbar {
        width: 10px;
      }

      .battle-log-list::-webkit-scrollbar-track {
        background: ${P.light};
        border-radius: 5px;
      }

      .battle-log-list::-webkit-scrollbar-thumb {
        background: linear-gradient(to bottom, ${P.border}, ${P.borderDark});
        border-radius: 5px;
        border: 2px solid ${P.light};
      }

      /* Turn Separator */
      .battle-log-turn-separator {
        display: flex;
        align-items: center;
        margin: ${S.md} 0 ${S.sm};
        gap: ${S.sm};
        color: ${P.text.muted};
        font-size: ${T.sizes.xs};
        font-weight: ${T.weights.bold};
      }

      .battle-log-turn-separator:first-child {
        margin-top: 0;
      }

      .battle-log-turn-separator__line {
        flex: 1;
        height: 1px;
        background: linear-gradient(to right, transparent, ${P.border}, transparent);
      }

      .battle-log-turn-separator__text {
        padding: 0 ${S.sm};
        background: ${P.mid};
        border-radius: 2px;
        white-space: nowrap;
      }

      /* Log Entry Card */
      .battle-log-entry-card {
        background: ${P.light};
        border: 1px solid ${P.border};
        border-radius: 4px;
        padding: ${S.sm} ${S.md};
        margin-bottom: ${S.sm};
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
      }

      .battle-log-entry-card:last-child {
        margin-bottom: 0;
      }

      .battle-log-entry-card--critical {
        background: rgba(255, 204, 0, 0.12);
        border-color: ${LOG_COLORS.critical};
      }

      .battle-log-entry-card--healing {
        border-left: 3px solid ${LOG_COLORS.healing};
      }

      .battle-log-entry-card--damage {
        border-left: 3px solid ${LOG_COLORS.damage};
      }

      .battle-log-entry-card--status {
        border-left: 3px solid ${LOG_COLORS.status};
      }

      .battle-log-entry-card--movement {
        border-left: 3px solid ${LOG_COLORS.movement};
      }

      .battle-log-entry-card--item {
        border-left: 3px solid ${LOG_COLORS.item};
      }

      .battle-log-entry-card--wait {
        border-left: 3px solid ${LOG_COLORS.wait};
      }

      .battle-log-entry-card--buff {
        border-left: 3px solid ${LOG_COLORS.buff};
      }

      .battle-log-entry-card--debuff {
        border-left: 3px solid ${LOG_COLORS.debuff};
      }

      /* Entry Header (Actor -> Target) */
      .battle-log-entry-header {
        display: flex;
        align-items: center;
        font-size: ${T.sizes.sm};
        margin-bottom: 4px;
        flex-wrap: wrap;
        gap: 4px;
      }

      .battle-log-entry-unit-wrapper {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .battle-log-entry-portrait {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        object-fit: cover;
        border: 1px solid ${P.border.medium};
        vertical-align: middle;
        flex-shrink: 0;
      }

      .battle-log-entry-portrait--player {
        border-color: ${P.state.info};
      }

      .battle-log-entry-portrait--enemy {
        border-color: ${P.state.error};
      }

      .battle-log-entry-portrait-fallback {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: ${T.sizes.xs};
        font-weight: ${T.weights.bold};
        color: ${P.text.inverse};
        flex-shrink: 0;
      }

      .battle-log-entry-portrait-fallback--player {
        background: ${P.state.info};
      }

      .battle-log-entry-portrait-fallback--enemy {
        background: ${P.state.error};
      }

      .battle-log-entry-unit {
        font-weight: ${T.weights.bold};
        cursor: pointer;
        padding: 1px 4px;
        border-radius: 2px;
        transition: background 0.15s ease;
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: inline-block;
        vertical-align: middle;
      }

      .battle-log-entry-unit:hover,
      .battle-log-entry-unit:focus {
        background: rgba(139, 115, 85, 0.2);
        text-decoration: underline;
        outline: none;
      }

      .battle-log-entry-unit--player {
        color: ${P.state.info};
      }

      .battle-log-entry-unit--enemy {
        color: ${P.state.error};
      }

      .battle-log-entry-arrow {
        color: ${P.text.muted};
        font-size: ${T.sizes.xs};
      }

      /* Action Name */
      .battle-log-entry-action {
        font-size: ${T.sizes.sm};
        font-style: italic;
        color: ${P.text.secondary};
        margin-bottom: 4px;
      }

      /* Result Display */
      .battle-log-entry-result {
        font-size: ${T.sizes.sm};
      }

      .battle-log-entry-damage {
        font-weight: ${T.weights.bold};
        color: ${LOG_COLORS.damage};
      }

      .battle-log-entry-healing {
        font-weight: ${T.weights.bold};
        color: ${LOG_COLORS.healing};
      }

      .battle-log-entry-critical {
        color: ${LOG_COLORS.critical};
        font-weight: ${T.weights.bold};
        margin-left: 4px;
      }

      .battle-log-entry-miss {
        color: ${LOG_COLORS.miss};
        font-style: italic;
      }

      .battle-log-entry-breakdown {
        font-size: 10px;
        color: ${P.text.muted};
        margin-top: 2px;
      }

      /* Status Effect Badge */
      .battle-log-entry-status {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-top: 4px;
        padding: 2px 6px;
        background: rgba(204, 170, 68, 0.15);
        border: 1px solid ${LOG_COLORS.status};
        border-radius: 3px;
        font-size: ${T.sizes.xs};
        color: ${P.text.secondary};
      }

      .battle-log-entry-status--debuff {
        background: rgba(204, 136, 68, 0.15);
        border-color: ${LOG_COLORS.debuff};
      }

      .battle-log-entry-status__icon {
        font-size: 12px;
      }

      /* Movement Display */
      .battle-log-entry-movement {
        color: ${LOG_COLORS.movement};
        font-size: ${T.sizes.xs};
      }

      /* Wait Display */
      .battle-log-entry-wait {
        color: ${LOG_COLORS.wait};
        font-style: italic;
        font-size: ${T.sizes.sm};
      }

      /* Item Display */
      .battle-log-entry-item {
        color: ${LOG_COLORS.item};
      }

      /* Death/Defeat Display */
      .battle-log-entry-death {
        color: ${P.state.error};
        font-weight: ${T.weights.bold};
        margin-top: 4px;
        padding: 2px 6px;
        background: rgba(139, 68, 68, 0.15);
        border-radius: 3px;
        display: inline-block;
      }

      /* Empty State */
      .battle-log-empty {
        text-align: center;
        padding: ${S.xl};
        color: ${P.text.muted};
        font-style: italic;
      }

      /* Show More Button */
      .battle-log-show-more {
        padding: ${S.md};
        text-align: center;
      }

      .battle-log-show-more__btn {
        background: ${P.light};
        border: 1px solid ${P.border};
        border-radius: 4px;
        color: ${P.text.secondary};
        font-family: ${T.fontFamily};
        font-size: ${T.sizes.sm};
        padding: ${S.sm} ${S.lg};
        cursor: pointer;
        transition: all 0.15s ease;
        min-height: 36px;
      }

      .battle-log-show-more__btn:hover {
        background: ${P.mid};
        border-color: ${P.borderDark};
        color: ${P.text.primary};
      }

      .battle-log-show-more__btn:focus {
        outline: 2px solid ${P.border};
        outline-offset: 2px;
      }

      /* Mobile responsiveness */
      @media (max-width: 480px) {
        .battle-log-modal-content {
          height: 350px;
          max-height: 65vh;
        }

        .battle-log-filter-bar {
          padding: ${S.xs} ${S.sm};
          gap: 3px;
        }

        .battle-log-filter-btn {
          padding: 4px 8px;
          font-size: 10px;
          min-width: 40px;
        }

        .battle-log-entry-card {
          padding: ${S.xs} ${S.sm};
        }

        .battle-log-entry-unit {
          max-width: 100px;
          font-size: ${T.sizes.xs};
        }

        .battle-log-entry-header {
          font-size: ${T.sizes.xs};
        }

        .battle-log-entry-action {
          font-size: ${T.sizes.xs};
        }

        .battle-log-entry-result {
          font-size: ${T.sizes.xs};
        }

        .battle-log-turn-separator__text {
          font-size: 10px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Build the modal content element
   * @returns {HTMLElement} The content container
   */
  buildContent() {
    const container = document.createElement('div');
    container.className = 'battle-log-modal-content';

    // Filter bar
    this.filterBar = document.createElement('div');
    this.filterBar.className = 'battle-log-filter-bar';
    this.renderFilterBar();
    container.appendChild(this.filterBar);

    // Log list
    this.logList = document.createElement('div');
    this.logList.className = 'battle-log-list';
    container.appendChild(this.logList);

    this.contentElement = container;
    return container;
  }

  /**
   * Render the filter bar buttons
   */
  renderFilterBar() {
    if (!this.filterBar) return;

    this.filterBar.innerHTML = '';

    Object.entries(FILTER_TYPES).forEach(([key, filter]) => {
      const btn = document.createElement('button');
      btn.className = 'battle-log-filter-btn';
      if (key === this.activeFilter) {
        btn.classList.add('battle-log-filter-btn--active');
      }
      btn.textContent = filter.label;
      btn.dataset.filter = key;
      this.filterBar.appendChild(btn);
    });
  }

  /**
   * Render the log entries
   */
  renderEntries() {
    if (!this.logList) return;

    const filteredEntries = this.getFilteredEntries();

    if (filteredEntries.length === 0) {
      this.logList.innerHTML = `
        <div class="battle-log-empty">
          ${this.entries.length === 0 ? 'No actions yet' : 'No matching entries'}
        </div>
      `;
      return;
    }

    // Group entries by turn
    const groupedByTurn = this.groupEntriesByTurn(filteredEntries);

    // Build HTML efficiently
    const fragments = [];
    const allTurns = Object.keys(groupedByTurn).sort((a, b) => Number(b) - Number(a));

    // Limit visible turns for performance with large logs
    const visibleTurns = this.showAllTurns
      ? allTurns
      : allTurns.slice(0, this.visibleTurnLimit);
    const hiddenTurnCount = allTurns.length - visibleTurns.length;

    for (const turn of visibleTurns) {
      const turnEntries = groupedByTurn[turn];
      const timestamp = this.formatTimestamp(turnEntries[0]?.timestamp);

      fragments.push(`
        <div class="battle-log-turn-separator">
          <span class="battle-log-turn-separator__line"></span>
          <span class="battle-log-turn-separator__text">Turn ${turn} (${timestamp})</span>
          <span class="battle-log-turn-separator__line"></span>
        </div>
      `);

      for (const entry of turnEntries) {
        fragments.push(this.renderEntry(entry));
      }
    }

    // Add "Show More" button if there are hidden turns
    if (hiddenTurnCount > 0) {
      fragments.push(`
        <div class="battle-log-show-more">
          <button class="battle-log-show-more__btn" type="button">
            Show ${hiddenTurnCount} more turn${hiddenTurnCount !== 1 ? 's' : ''}...
          </button>
        </div>
      `);
    }

    this.logList.innerHTML = fragments.join('');

    // Bind unit click handlers
    this.bindUnitClickHandlers();

    // Bind show more button
    this.bindShowMoreHandler();
  }

  /**
   * Get entries filtered by active filter
   * @returns {Array} Filtered entries
   */
  getFilteredEntries() {
    const filter = FILTER_TYPES[this.activeFilter];
    if (!filter || this.activeFilter === 'all') {
      return [...this.entries];
    }
    return this.entries.filter(filter.matches);
  }

  /**
   * Group entries by turn number
   * @param {Array} entries - Entries to group
   * @returns {Object} Entries grouped by turn
   */
  groupEntriesByTurn(entries) {
    const groups = {};
    for (const entry of entries) {
      const turn = entry.turn || 0;
      if (!groups[turn]) {
        groups[turn] = [];
      }
      groups[turn].push(entry);
    }
    return groups;
  }

  /**
   * Format timestamp as relative time since battle start
   * @param {number} timestamp - Entry timestamp
   * @returns {string} Formatted time string (e.g., "0:45")
   */
  formatTimestamp(timestamp) {
    if (!timestamp || !this.battleStartTime) {
      return '0:00';
    }

    const elapsed = Math.max(0, timestamp - this.battleStartTime);
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;

    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Render a single log entry
   * @param {Object} entry - Log entry data
   * @returns {string} HTML string
   */
  renderEntry(entry) {
    const { actor, target, action, result } = entry;
    const entryType = getEntryType(action, result);
    const isCritical = result?.isCritical;

    const criticalClass = isCritical ? ' battle-log-entry-card--critical' : '';
    const typeClass = ` battle-log-entry-card--${entryType}`;

    return `
      <div class="battle-log-entry-card${typeClass}${criticalClass}">
        ${this.renderEntryHeader(actor, target)}
        ${this.renderEntryAction(action)}
        ${this.renderEntryResult(action, result)}
        ${this.renderEntryStatus(result)}
        ${this.renderEntryDeath(result)}
      </div>
    `;
  }

  /**
   * Render portrait HTML for a unit (synchronous - uses img tag with src)
   * @param {Object} unit - Unit info with portrait data
   * @param {string} typeClass - 'player' or 'enemy'
   * @returns {string} HTML string
   */
  renderUnitPortrait(unit, typeClass) {
    // Check if we have portrait data
    if (unit?.race || unit?.class || unit?.enemyId) {
      const portraitId = buildPortraitId(unit);
      const portraitSrc = getAssetPath('portraits', portraitId, { size: 64 });

      return `<img
        src="${portraitSrc}"
        alt=""
        class="battle-log-entry-portrait battle-log-entry-portrait--${typeClass}"
        data-image-fallback data-fallback-display="inline-flex"
      ><span class="battle-log-entry-portrait-fallback battle-log-entry-portrait-fallback--${typeClass}" style="display:none;">${getClassLetter(unit.class)}</span>`;
    }

    // Fallback to letter only
    const letter = getClassLetter(unit?.class);
    return `<span class="battle-log-entry-portrait-fallback battle-log-entry-portrait-fallback--${typeClass}">${letter}</span>`;
  }

  /**
   * Render entry header with actor and target portraits
   * @param {Object} actor - Actor info
   * @param {Object} target - Target info (optional)
   * @returns {string} HTML string
   */
  renderEntryHeader(actor, target) {
    const actorClass = actor?.isPlayer ? 'player' : 'enemy';
    const actorId = actor?.id || '';
    const actorName = escapeHtml(actor?.name || 'Unknown');

    let html = `
      <div class="battle-log-entry-header">
        <span class="battle-log-entry-unit-wrapper">
          ${this.renderUnitPortrait(actor, actorClass)}
          <span class="battle-log-entry-unit battle-log-entry-unit--${actorClass}"
                data-unit-id="${actorId}"
                data-unit-name="${actorName}"
                data-unit-is-player="${actor?.isPlayer || false}"
                tabindex="0"
                role="button"
                title="${actorName}"
                aria-label="View ${actorName}">
            ${actorName}
          </span>
        </span>
    `;

    if (target) {
      const targetClass = target?.isPlayer ? 'player' : 'enemy';
      const targetId = target?.id || '';
      const targetName = escapeHtml(target?.name || 'Unknown');

      html += `
        <span class="battle-log-entry-arrow" aria-hidden="true">-></span>
        <span class="battle-log-entry-unit-wrapper">
          ${this.renderUnitPortrait(target, targetClass)}
          <span class="battle-log-entry-unit battle-log-entry-unit--${targetClass}"
                data-unit-id="${targetId}"
                data-unit-name="${targetName}"
                data-unit-is-player="${target?.isPlayer || false}"
                tabindex="0"
                role="button"
                title="${targetName}"
                aria-label="View ${targetName}">
            ${targetName}
          </span>
        </span>
      `;
    }

    html += '</div>';
    return html;
  }

  /**
   * Render the action name
   * @param {Object} action - Action info
   * @returns {string} HTML string
   */
  renderEntryAction(action) {
    if (!action) return '';

    const actionType = action.type || 'unknown';
    const actionName = action.name || 'Action';

    // Don't show action line for simple actions like wait/move
    if (actionType === 'wait') {
      return '<div class="battle-log-entry-wait">Waited</div>';
    }

    if (actionType === 'move') {
      return ''; // Movement is shown in result
    }

    return `<div class="battle-log-entry-action">${escapeHtml(actionName)}</div>`;
  }

  /**
   * Render the action result
   * @param {Object} action - Action info
   * @param {Object} result - Result data
   * @returns {string} HTML string
   */
  renderEntryResult(action, result) {
    if (!result) return '';

    const actionType = action?.type || 'unknown';

    // Movement result
    if (actionType === 'move') {
      return this.renderMovementResult(result);
    }

    // Wait has no result
    if (actionType === 'wait') {
      return '';
    }

    // Damage result
    if (result.missed) {
      return '<div class="battle-log-entry-result"><span class="battle-log-entry-miss">MISS</span></div>';
    }

    if (result.damage > 0) {
      return this.renderDamageResult(result);
    }

    // Healing result
    if (result.healing > 0) {
      return this.renderHealingResult(result);
    }

    // MP restoration
    if (result.mpRestored > 0) {
      return `
        <div class="battle-log-entry-result">
          <span style="color: ${P.state.info}; font-weight: bold;">+${result.mpRestored} MP</span>
        </div>
      `;
    }

    return '';
  }

  /**
   * Render damage result with breakdown
   * @param {Object} result - Damage result
   * @returns {string} HTML string
   */
  renderDamageResult(result) {
    let html = '<div class="battle-log-entry-result">';

    html += `<span class="battle-log-entry-damage">-${result.damage} HP</span>`;

    if (result.isCritical) {
      html += '<span class="battle-log-entry-critical">CRIT!</span>';
    }

    // Show breakdown if available
    if (result.baseDamage && result.isCritical && result.critBonus) {
      html += `<div class="battle-log-entry-breakdown">(${result.baseDamage} base + ${result.critBonus} crit)</div>`;
    } else if (result.modifiers) {
      // Show modifier breakdown if available
      const modParts = [];
      if (result.baseDamage) modParts.push(`${result.baseDamage} base`);
      for (const [key, value] of Object.entries(result.modifiers)) {
        if (value !== 0) {
          modParts.push(`${value > 0 ? '+' : ''}${value} ${key}`);
        }
      }
      if (modParts.length > 0) {
        html += `<div class="battle-log-entry-breakdown">(${modParts.join(' ')})</div>`;
      }
    }

    html += '</div>';
    return html;
  }

  /**
   * Render healing result
   * @param {Object} result - Healing result
   * @returns {string} HTML string
   */
  renderHealingResult(result) {
    return `
      <div class="battle-log-entry-result">
        <span class="battle-log-entry-healing">+${result.healing} HP</span>
      </div>
    `;
  }

  /**
   * Render movement result
   * @param {Object} result - Movement result
   * @returns {string} HTML string
   */
  renderMovementResult(result) {
    if (result.from && result.to) {
      return `
        <div class="battle-log-entry-movement">
          Moved (${result.from.x},${result.from.y}) -> (${result.to.x},${result.to.y})
        </div>
      `;
    }
    return '<div class="battle-log-entry-movement">Moved</div>';
  }

  /**
   * Render status effect if applied
   * @param {Object} result - Result data
   * @returns {string} HTML string
   */
  renderEntryStatus(result) {
    if (!result?.statusApplied && !result?.statusRemoved) return '';

    let html = '';

    if (result.statusApplied) {
      const effect = result.statusApplied;
      const duration = result.statusDuration ? ` (${result.statusDuration} turns)` : '';
      const isDebuff = this.isDebuffEffect(effect);
      const debuffClass = isDebuff ? ' battle-log-entry-status--debuff' : '';
      const icon = this.getStatusIcon(effect);

      html += `
        <div class="battle-log-entry-status${debuffClass}">
          <span class="battle-log-entry-status__icon">${icon}</span>
          Applied: ${escapeHtml(effect)}${duration}
        </div>
      `;
    }

    if (result.statusRemoved) {
      html += `
        <div class="battle-log-entry-status">
          Removed: ${escapeHtml(result.statusRemoved)}
        </div>
      `;
    }

    return html;
  }

  /**
   * Render death notification if unit was defeated
   * @param {Object} result - Result data
   * @returns {string} HTML string
   */
  renderEntryDeath(result) {
    if (!result?.targetDefeated) return '';

    return '<div class="battle-log-entry-death">Defeated!</div>';
  }

  /**
   * Check if status effect is a debuff
   * @param {string} effect - Effect name
   * @returns {boolean}
   */
  isDebuffEffect(effect) {
    if (!effect) return false;
    const debuffs = ['poison', 'blind', 'slow', 'silence', 'paralyze', 'confuse', 'bleed', 'burn', 'freeze', 'stun'];
    return debuffs.some(d => effect.toLowerCase().includes(d));
  }

  /**
   * Get icon for status effect
   * @param {string} effect - Effect name
   * @returns {string} Icon character
   */
  getStatusIcon(effect) {
    if (!effect) return '';
    const effectLower = effect.toLowerCase();

    const icons = {
      burn: '\uD83D\uDD25',      // fire
      poison: '\u2620\uFE0F',    // skull
      freeze: '\u2744\uFE0F',    // snowflake
      stun: '\u26A1',            // lightning
      blind: '\uD83D\uDC41\uFE0F', // eye
      slow: '\uD83D\uDC22',      // turtle
      haste: '\uD83D\uDCA8',     // dash
      regen: '\u2764\uFE0F',     // heart
      shield: '\uD83D\uDEE1\uFE0F', // shield
      strength: '\uD83D\uDCAA',  // muscle
    };

    for (const [key, icon] of Object.entries(icons)) {
      if (effectLower.includes(key)) return icon;
    }

    return '\u2728'; // sparkles default
  }

  /**
   * Bind click and keyboard handlers for unit names.
   * Note: Listeners are automatically cleaned up when logList.innerHTML is replaced
   * or when this.abortController is aborted on modal close.
   */
  bindUnitClickHandlers() {
    if (!this.logList || !this.onUnitClick) return;

    const unitElements = this.logList.querySelectorAll('.battle-log-entry-unit');
    unitElements.forEach(el => {
      const handleActivate = (e) => {
        e.stopPropagation();
        const unit = {
          id: el.dataset.unitId,
          name: el.dataset.unitName,
          isPlayer: el.dataset.unitIsPlayer === 'true'
        };
        this.onUnitClick(unit);
      };

      el.addEventListener('click', handleActivate, { signal: this.abortController?.signal });

      // Support Enter/Space key activation
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleActivate(e);
        }
      }, { signal: this.abortController?.signal });
    });
  }

  /**
   * Bind click handler for "Show More" button
   */
  bindShowMoreHandler() {
    if (!this.logList) return;

    const showMoreBtn = this.logList.querySelector('.battle-log-show-more__btn');
    if (showMoreBtn) {
      showMoreBtn.addEventListener('click', () => {
        this.showAllTurns = true;
        this.renderEntries();
      }, { signal: this.abortController?.signal });
    }
  }

  /**
   * Open the modal
   */
  open() {
    if (this.isOpen) return;

    // Reset visibility state
    this.showAllTurns = false;

    // Mark as read
    this.lastOpenedEntryCount = this.entries.length;

    // Create abort controller for event cleanup
    this.abortController = new AbortController();

    // Build content
    const content = this.buildContent();

    // Create modal
    this.modal = new ParchmentModal({
      title: 'Battle Log',
      content: content,
      size: 'lg',
      closable: true,
      closeOnOverlay: true,
      closeOnEscape: true,
      onClose: () => {
        this.handleClose();
      }
    });

    // Bind filter click events
    this.filterBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.battle-log-filter-btn');
      if (btn) {
        this.setFilter(btn.dataset.filter);
      }
    }, { signal: this.abortController.signal });

    // Render entries
    this.renderEntries();

    // Open modal
    this.modal.open();
    this.isOpen = true;

    // Auto-scroll to bottom (newest entries)
    requestAnimationFrame(() => {
      if (this.logList) {
        this.logList.scrollTop = 0; // Scroll to top since newest turns are at top
      }
    });
  }

  /**
   * Close the modal
   */
  close() {
    if (!this.isOpen || !this.modal) return;
    this.modal.close();
  }

  /**
   * Handle modal close
   */
  handleClose() {
    this.isOpen = false;

    // Cleanup event listeners
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Clear references
    this.contentElement = null;
    this.filterBar = null;
    this.logList = null;
    this.modal = null;

    // Call callback
    if (this.onClose) {
      this.onClose();
    }
  }

  /**
   * Set the active filter
   * @param {string} filterKey - Filter key (all, damage, healing, status, movement)
   */
  setFilter(filterKey) {
    if (!FILTER_TYPES[filterKey]) return;
    if (filterKey === this.activeFilter) return;

    this.activeFilter = filterKey;
    this.renderFilterBar();
    this.renderEntries();
  }

  /**
   * Add a new log entry
   * @param {Object} entry - Log entry data
   * @param {number} entry.timestamp - Timestamp of action
   * @param {number} entry.turn - Turn number
   * @param {Object} entry.actor - Actor info { id, name, isPlayer }
   * @param {Object} [entry.target] - Target info { id, name, isPlayer }
   * @param {Object} entry.action - Action info { type, name }
   * @param {Object} [entry.result] - Result data (damage, healing, status, etc.)
   */
  addEntry(entry) {
    // Set battle start time from first entry
    if (this.entries.length === 0 && entry.timestamp) {
      this.battleStartTime = entry.timestamp;
    }

    // Add entry
    this.entries.push(entry);

    // Trim to max entries
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    // Re-render if modal is open
    if (this.isOpen) {
      this.renderEntries();
    }
  }

  /**
   * Get the number of unread entries since last modal open
   * @returns {number} Unread count
   */
  getUnreadCount() {
    return Math.max(0, this.entries.length - this.lastOpenedEntryCount);
  }

  /**
   * Clear all entries (for new battle)
   */
  clear() {
    this.entries = [];
    this.battleStartTime = null;
    this.lastOpenedEntryCount = 0;

    if (this.isOpen) {
      this.renderEntries();
    }
  }

  /**
   * Check if the modal is currently open
   * @returns {boolean}
   */
  isVisible() {
    return this.isOpen;
  }

  /**
   * Destroy the modal and clean up resources
   */
  destroy() {
    this.close();
    this.entries = [];
    this.battleStartTime = null;
    this.onUnitClick = null;
    this.onClose = null;
  }
}
