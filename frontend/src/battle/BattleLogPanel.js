/**
 * BattleLogPanel - Scrollable battle log showing detailed combat history
 *
 * Features:
 * - Collapsed state: Shows only last 2 entries
 * - Expanded state: Shows up to 50 entries with scrolling
 * - Color-coded entries by action type
 * - Parchment theme styling with burgundy title
 * - Mobile-friendly with 44px touch targets
 */

import { PARCHMENT_COLORS, PARCHMENT_TYPOGRAPHY, PARCHMENT_SPACING } from '../ui/parchment/ParchmentTheme.js';
import {
  LOG_COLORS,
  formatDamageResult,
  formatStatusEffect,
  getEntryType,
  escapeHtml
} from './battleLogUtils.js';

const P = PARCHMENT_COLORS;
const T = PARCHMENT_TYPOGRAPHY;
const S = PARCHMENT_SPACING;

export default class BattleLogPanel {
  /**
   * @param {Object} options
   * @param {number} options.maxEntries - Maximum entries to store (default 50)
   * @param {string} options.position - 'left' or 'right' (default 'right')
   */
  constructor(options = {}) {
    this.maxEntries = options.maxEntries || 50;
    this.position = options.position || 'right';
    this.isExpanded = false;
    this.entries = [];

    // Bound handlers for cleanup
    this.boundToggle = this.toggle.bind(this);

    this.element = this.createElement();
    this.injectStyles();
  }

  /**
   * Create the main panel element
   */
  createElement() {
    const panel = document.createElement('div');
    panel.className = 'battle-log-panel battle-log-panel--collapsed';
    panel.innerHTML = `
      <div class="battle-log-panel__header">
        <span class="battle-log-panel__title">Log</span>
        <span class="battle-log-panel__chevron">&#9660;</span>
      </div>
      <div class="battle-log-panel__list"></div>
    `;

    // Header click toggles expand/collapse
    const header = panel.querySelector('.battle-log-panel__header');
    header.addEventListener('click', this.boundToggle);

    return panel;
  }

  /**
   * Inject component styles into document
   */
  injectStyles() {
    if (document.getElementById('battle-log-panel-styles')) return;

    const style = document.createElement('style');
    style.id = 'battle-log-panel-styles';
    style.textContent = `
      .battle-log-panel {
        background: linear-gradient(to bottom, ${P.light} 0%, ${P.mid} 50%, ${P.dark} 100%);
        border: 2px solid ${P.border};
        border-radius: 4px;
        box-shadow: 0 3px 8px ${P.shadow},
                    inset 0 1px 0 ${P.highlight},
                    inset 0 -1px 0 rgba(0, 0, 0, 0.1);
        font-family: ${T.fontFamily};
        min-width: 220px;
        max-width: 280px;
        overflow: hidden;
        transition: max-height 0.3s ease;
      }

      .battle-log-panel__header {
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

      .battle-log-panel__header:hover {
        background: linear-gradient(to bottom, ${P.borderLight}, ${P.border});
      }

      .battle-log-panel__header:active {
        background: linear-gradient(to bottom, ${P.borderDark}, ${P.borderDark});
      }

      .battle-log-panel__title {
        color: ${P.accent.burgundy};
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .battle-log-panel__chevron {
        font-size: 10px;
        transition: transform 0.3s ease;
        color: ${P.text.inverse};
        opacity: 0.7;
      }

      .battle-log-panel--expanded .battle-log-panel__chevron {
        transform: rotate(180deg);
      }

      .battle-log-panel__list {
        overflow: hidden;
        transition: max-height 0.3s ease;
      }

      .battle-log-panel--collapsed .battle-log-panel__list {
        max-height: 88px;
      }

      .battle-log-panel--expanded .battle-log-panel__list {
        max-height: 400px;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: ${P.border} ${P.light};
      }

      .battle-log-panel--expanded .battle-log-panel__list::-webkit-scrollbar {
        width: 8px;
      }

      .battle-log-panel--expanded .battle-log-panel__list::-webkit-scrollbar-track {
        background: ${P.light};
        border-radius: 4px;
      }

      .battle-log-panel--expanded .battle-log-panel__list::-webkit-scrollbar-thumb {
        background: ${P.border};
        border-radius: 4px;
      }

      .battle-log-entry {
        padding: 6px 10px;
        min-height: 38px;
        border-bottom: 1px solid rgba(107, 83, 68, 0.15);
        font-size: ${T.sizes.xs};
        line-height: 1.4;
        box-sizing: border-box;
      }

      .battle-log-entry:last-child {
        border-bottom: none;
      }

      .battle-log-entry__header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 2px;
      }

      .battle-log-entry__turn {
        font-size: 9px;
        color: ${P.text.muted};
        background: rgba(0, 0, 0, 0.1);
        padding: 1px 4px;
        border-radius: 2px;
      }

      .battle-log-entry__actor {
        font-weight: ${T.weights.bold};
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        margin-right: 4px;
      }

      .battle-log-entry__actor--player {
        color: ${P.state.info};
      }

      .battle-log-entry__actor--enemy {
        color: ${P.state.error};
      }

      .battle-log-entry__content {
        color: ${P.text.secondary};
      }

      .battle-log-entry__action {
        font-style: italic;
      }

      .battle-log-entry__result {
        margin-top: 2px;
      }

      .battle-log-entry__damage {
        font-weight: ${T.weights.bold};
      }

      .battle-log-entry__critical {
        color: ${LOG_COLORS.critical};
        font-weight: ${T.weights.bold};
      }

      .battle-log-entry__miss {
        color: ${LOG_COLORS.miss};
        font-style: italic;
      }

      .battle-log-entry__healing {
        color: ${LOG_COLORS.healing};
        font-weight: ${T.weights.bold};
      }

      .battle-log-entry__status {
        color: ${LOG_COLORS.status};
      }

      .battle-log-entry__movement {
        color: ${LOG_COLORS.movement};
      }

      .battle-log-entry__wait {
        color: ${LOG_COLORS.wait};
        font-style: italic;
      }

      .battle-log-entry--damage {
        border-left: 3px solid ${LOG_COLORS.damage};
      }

      .battle-log-entry--healing {
        border-left: 3px solid ${LOG_COLORS.healing};
      }

      .battle-log-entry--buff {
        border-left: 3px solid ${LOG_COLORS.buff};
      }

      .battle-log-entry--debuff {
        border-left: 3px solid ${LOG_COLORS.debuff};
      }

      .battle-log-entry--status {
        border-left: 3px solid ${LOG_COLORS.status};
      }

      .battle-log-entry--movement {
        border-left: 3px solid ${LOG_COLORS.movement};
      }

      .battle-log-entry--wait {
        border-left: 3px solid ${LOG_COLORS.wait};
      }

      .battle-log-entry--item {
        border-left: 3px solid ${LOG_COLORS.item};
      }

      .battle-log-entry--critical {
        background: rgba(255, 204, 0, 0.1);
      }

      .battle-log-panel__empty {
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
    this.element.classList.toggle('battle-log-panel--collapsed', !this.isExpanded);
    this.element.classList.toggle('battle-log-panel--expanded', this.isExpanded);

    // Update title
    const title = this.element.querySelector('.battle-log-panel__title');
    title.textContent = this.isExpanded ? 'Battle Log' : 'Log';

    // Scroll to bottom when expanding
    if (this.isExpanded) {
      const list = this.element.querySelector('.battle-log-panel__list');
      if (list) {
        requestAnimationFrame(() => {
          list.scrollTop = list.scrollHeight;
        });
      }
    }
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
   * Add a new log entry
   * @param {Object} entry - Log entry data
   * @param {number} entry.timestamp - Timestamp of action
   * @param {number} entry.turn - Turn number
   * @param {Object} entry.actor - Actor info { name, isPlayer }
   * @param {Object} entry.action - Action info { type, name }
   * @param {string} entry.element - Element type (physical, fire, etc.)
   * @param {Object} entry.target - Target info { name, isPlayer } (optional)
   * @param {Object} entry.result - Result data (damage, healing, status, etc.)
   */
  addEntry(entry) {
    // Add to beginning (newest first for display, but we'll render newest at bottom)
    this.entries.push(entry);

    // Trim to max entries
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    this.render();

    // Auto-scroll to bottom when new entry is added
    const list = this.element.querySelector('.battle-log-panel__list');
    if (list) {
      requestAnimationFrame(() => {
        list.scrollTop = list.scrollHeight;
      });
    }
  }

  /**
   * Clear all entries (for new battle)
   */
  clear() {
    this.entries = [];
    this.render();
  }

  /**
   * Render the log list
   */
  render() {
    const list = this.element.querySelector('.battle-log-panel__list');
    if (!list) return;

    if (this.entries.length === 0) {
      list.innerHTML = '<div class="battle-log-panel__empty">No actions yet</div>';
      return;
    }

    // Show entries (collapsed: last 2, expanded: all)
    const visibleEntries = this.isExpanded
      ? this.entries
      : this.entries.slice(-2);

    list.innerHTML = visibleEntries.map(entry => this.renderEntry(entry)).join('');
  }

  /**
   * Render a single log entry
   * @param {Object} entry - Log entry data
   * @returns {string} HTML string
   */
  renderEntry(entry) {
    const { turn, actor, action, target, result } = entry;
    const entryType = getEntryType(action, result);
    const isCritical = result?.isCritical;

    const actorClass = actor?.isPlayer ? 'player' : 'enemy';
    const criticalClass = isCritical ? ' battle-log-entry--critical' : '';

    const contentHtml = this.renderContent(action, target, result);

    return `
      <div class="battle-log-entry battle-log-entry--${entryType}${criticalClass}">
        <div class="battle-log-entry__header">
          <span class="battle-log-entry__actor battle-log-entry__actor--${actorClass}">
            ${escapeHtml(actor?.name || 'Unknown')}
          </span>
          <span class="battle-log-entry__turn">T${turn || '?'}</span>
        </div>
        <div class="battle-log-entry__content">
          ${contentHtml}
        </div>
      </div>
    `;
  }

  /**
   * Render the content of a log entry based on action type
   * @param {Object} action - Action info
   * @param {Object} target - Target info
   * @param {Object} result - Result data
   * @returns {string} HTML string
   */
  renderContent(action, target, result) {
    const actionType = action?.type || 'unknown';
    const actionName = action?.name || 'Action';

    switch (actionType) {
      case 'attack':
      case 'skill':
        return this.renderAttackContent(actionName, target, result, actionType === 'skill');

      case 'move':
        return this.renderMoveContent(result);

      case 'wait':
        return '<span class="battle-log-entry__wait">Waited</span>';

      case 'item':
        return this.renderItemContent(actionName, target, result);

      default:
        return `<span class="battle-log-entry__action">${escapeHtml(actionName)}</span>`;
    }
  }

  /**
   * Render attack/skill content
   */
  renderAttackContent(actionName, target, result, isSkill) {
    const targetName = target?.name || 'target';
    let html = '';

    if (isSkill) {
      html += `<span class="battle-log-entry__action">${escapeHtml(actionName)}</span>`;
    } else {
      html += '<span class="battle-log-entry__action">Attack</span>';
    }

    html += ` &rarr; ${escapeHtml(targetName)}`;

    // Use shared formatDamageResult utility
    const damageFormatted = formatDamageResult(result, { mutedColor: P.text.muted });
    if (!damageFormatted.isEmpty) {
      html += `<div class="battle-log-entry__result">${damageFormatted.html}</div>`;
    }

    // Status effects using shared formatStatusEffect utility
    if (result?.statusApplied) {
      const statusFormatted = formatStatusEffect(result.statusApplied);
      html += `<div>${statusFormatted.html}</div>`;
    }

    return html;
  }

  /**
   * Render movement content
   */
  renderMoveContent(result) {
    if (result?.from && result?.to) {
      return `<span class="battle-log-entry__movement">
        Moved (${result.from.x},${result.from.y}) &rarr; (${result.to.x},${result.to.y})
      </span>`;
    }
    return '<span class="battle-log-entry__movement">Moved</span>';
  }

  /**
   * Render item usage content
   */
  renderItemContent(itemName, target, result) {
    const targetName = target?.name || 'self';
    let html = `<span class="battle-log-entry__action">Used ${escapeHtml(itemName)}</span>`;
    html += ` on ${escapeHtml(targetName)}`;

    if (result?.healing > 0) {
      html += `<div class="battle-log-entry__result">
        <span class="battle-log-entry__healing">+${result.healing} HP</span>
      </div>`;
    }

    if (result?.mpRestored > 0) {
      html += `<div class="battle-log-entry__result">
        <span style="color: ${P.state.info};">+${result.mpRestored} MP</span>
      </div>`;
    }

    return html;
  }

  /**
   * Set panel position (left or right)
   * @param {string} position - 'left' or 'right'
   */
  setPosition(position) {
    this.position = position;
  }

  /**
   * Show the panel
   */
  show() {
    this.element.style.display = '';
  }

  /**
   * Hide the panel
   */
  hide() {
    this.element.style.display = 'none';
  }

  /**
   * Destroy the panel and clean up
   */
  destroy() {
    const header = this.element.querySelector('.battle-log-panel__header');
    if (header) {
      header.removeEventListener('click', this.boundToggle);
    }
    this.element.remove();
    this.entries = [];
    // Styles are static and shared - leave them in place
  }
}
