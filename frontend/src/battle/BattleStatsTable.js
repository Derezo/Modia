/**
 * @module BattleStatsTable
 * @description DOM-based character stats table for post-battle summary display.
 *
 * Displays team performance metrics in a two-column layout with parchment styling.
 * Features slide-in/out animations and MVP highlighting for the winning team.
 *
 * Key responsibilities:
 * - Render battle statistics for both teams
 * - Determine MVP based on highest damage dealt
 * - Handle responsive layout for mobile devices
 * - Animate show/hide transitions
 *
 * @see BattleOutroSequence.js - Orchestrates victory/defeat animations
 * @see BattleIntro.js - Similar DOM-based component pattern
 */

import { escapeHtml } from './battleLogUtils.js';

/**
 * BattleStatsTable - Post-battle statistics display component
 *
 * Usage:
 *   const statsTable = new BattleStatsTable(battleScene);
 *   statsTable.show(unitStats, isPvP, isVictory, localUserId);
 *   // Later...
 *   statsTable.hide();
 *   statsTable.destroy();
 */
export class BattleStatsTable {
  constructor(battleScene) {
    this.scene = battleScene;
    this.container = null;
    this.isVisible = false;
    this.animationTimeout = null;
  }

  /**
   * Show the stats table with slide-in animation
   * @param {Array} unitStats - Array of unit stat objects
   * @param {boolean} isPvP - Whether this is a PvP battle
   * @param {boolean} isVictory - Whether the local player won
   * @param {number} localUserId - The local player's user ID
   */
  show(unitStats, isPvP, isVictory, localUserId) {
    if (this.isVisible) {
      this.hide();
    }

    this.createDOM(unitStats, isPvP, isVictory, localUserId);
    this.isVisible = true;

    // Trigger slide-in animation after DOM insertion
    requestAnimationFrame(() => {
      if (this.container) {
        this.container.classList.add('visible');
      }
    });
  }

  /**
   * Hide the stats table with slide-out animation
   */
  hide() {
    if (!this.isVisible || !this.container) return;

    this.container.classList.remove('visible');

    // Remove from DOM after animation completes
    this.animationTimeout = setTimeout(() => {
      this.cleanup();
    }, 400);
  }

  /**
   * Create the DOM structure for the stats table
   * @param {Array} unitStats - Array of unit stat objects
   * @param {boolean} isPvP - Whether this is a PvP battle
   * @param {boolean} isVictory - Whether the local player won
   * @param {number} localUserId - The local player's user ID
   */
  createDOM(unitStats, isPvP, isVictory, localUserId) {
    this.addStyles();

    // Separate units into teams
    const { allies, opponents, mvpId } = this.categorizeUnits(unitStats, isPvP, isVictory, localUserId);

    // Create container
    this.container = document.createElement('div');
    this.container.className = 'battle-stats-table';
    this.container.innerHTML = `
      <div class="bst-content">
        <div class="bst-team-column bst-allies">
          <div class="bst-team-header bst-header-ally">Your Team</div>
          <div class="bst-cards-container">
            ${this.renderTeamColumn(allies, true, mvpId)}
          </div>
        </div>
        <div class="bst-team-column bst-opponents">
          <div class="bst-team-header bst-header-opponent">Opponent Team</div>
          <div class="bst-cards-container">
            ${this.renderTeamColumn(opponents, false, mvpId)}
          </div>
        </div>
      </div>
    `;

    // Add to game UI overlay
    this.scene.game.uiOverlay.appendChild(this.container);
  }

  /**
   * Categorize units into allies and opponents, determine MVP
   * @param {Array} unitStats - Array of unit stat objects
   * @param {boolean} isPvP - Whether this is a PvP battle
   * @param {boolean} isVictory - Whether the local player won
   * @param {number} localUserId - The local player's user ID
   * @returns {Object} { allies, opponents, mvpId }
   */
  categorizeUnits(unitStats, isPvP, isVictory, localUserId) {
    let allies = [];
    let opponents = [];

    if (isPvP) {
      // PvP: allies = units owned by local player
      allies = unitStats.filter(u => u.ownerId === localUserId);
      opponents = unitStats.filter(u => u.ownerId !== localUserId);
    } else {
      // PvE: allies = player type, opponents = enemy type
      allies = unitStats.filter(u => u.type === 'player');
      opponents = unitStats.filter(u => u.type === 'enemy');
    }

    // Determine MVP (highest damage dealt on winning team)
    let mvpId = null;
    if (isVictory && allies.length > 0) {
      const topAlly = allies.reduce((best, unit) => {
        const damage = unit.damageDealt || 0;
        return damage > (best.damageDealt || 0) ? unit : best;
      }, allies[0]);
      mvpId = topAlly.id;
    }

    return { allies, opponents, mvpId };
  }

  /**
   * Render a team column of stat cards
   * @param {Array} units - Array of units for this team
   * @param {boolean} isAlly - Whether this is the ally team
   * @param {string|null} mvpId - ID of the MVP unit (if any)
   * @returns {string} HTML string for the cards
   */
  renderTeamColumn(units, isAlly, mvpId) {
    if (units.length === 0) {
      return '<div class="bst-empty">No units</div>';
    }

    return units.map(unit => {
      const isMvp = unit.id === mvpId;
      const cardClass = `bst-card ${isAlly ? 'bst-card-ally' : 'bst-card-opponent'} ${isMvp ? 'bst-card-mvp' : ''}`;

      return `
        <div class="${cardClass}">
          ${isMvp ? '<div class="bst-mvp-badge">MVP</div>' : ''}
          <div class="bst-card-header">
            <div class="bst-unit-info">
              <div class="bst-unit-name">${escapeHtml(unit.name || 'Unknown')}</div>
              <div class="bst-unit-details">
                <span class="bst-unit-class">${this.capitalize(unit.class || unit.type || 'Unknown')}</span>
                ${unit.race ? `<span class="bst-unit-race">${this.capitalize(unit.race)}</span>` : ''}
              </div>
            </div>
            <div class="bst-unit-level">Lv.${unit.level || 1}</div>
          </div>
          <div class="bst-stats-grid">
            <div class="bst-stat-row">
              <span class="bst-stat-label">DMG Dealt:</span>
              <span class="bst-stat-value bst-stat-damage">${this.formatNumber(unit.damageDealt || 0)}</span>
            </div>
            <div class="bst-stat-row">
              <span class="bst-stat-label">DMG Taken:</span>
              <span class="bst-stat-value bst-stat-taken">${this.formatNumber(unit.damageTaken || 0)}</span>
            </div>
            <div class="bst-stat-row">
              <span class="bst-stat-label">Healing:</span>
              <span class="bst-stat-value bst-stat-healing">${this.formatNumber(unit.healingDone || 0)}</span>
            </div>
            <div class="bst-stat-row">
              <span class="bst-stat-label">K / D:</span>
              <span class="bst-stat-value bst-stat-kd">
                <span class="bst-kills">${unit.kills || 0}</span>
                <span class="bst-separator">/</span>
                <span class="bst-deaths">${unit.deaths || 0}</span>
              </span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Add component styles to document head
   */
  addStyles() {
    if (document.getElementById('battle-stats-table-styles')) return;

    const style = document.createElement('style');
    style.id = 'battle-stats-table-styles';
    style.textContent = `
      /* Battle Stats Table Container */
      .battle-stats-table {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.9);
        background: rgba(40, 35, 30, 0.95);
        border: 3px solid #5a4a3a;
        border-radius: 8px;
        padding: 20px;
        max-width: 90vw;
        max-height: 70vh;
        overflow-y: auto;
        opacity: 0;
        transition: opacity 0.35s ease, transform 0.35s ease;
        z-index: 150;
        box-shadow:
          0 8px 32px rgba(0, 0, 0, 0.5),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        font-family: 'Georgia', 'Times New Roman', serif;
      }

      .battle-stats-table.visible {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }

      /* Content Layout */
      .bst-content {
        display: flex;
        gap: 24px;
        min-width: 600px;
      }

      /* Team Columns */
      .bst-team-column {
        flex: 1;
        min-width: 280px;
      }

      /* Team Headers */
      .bst-team-header {
        font-size: 16px;
        font-weight: bold;
        text-align: center;
        padding: 8px 12px;
        margin-bottom: 12px;
        border-radius: 4px;
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      .bst-header-ally {
        color: #a8c4e8;
        background: rgba(74, 96, 136, 0.3);
        border: 1px solid #4a6088;
      }

      .bst-header-opponent {
        color: #e8a8a8;
        background: rgba(139, 68, 68, 0.3);
        border: 1px solid #8b4444;
      }

      /* Cards Container */
      .bst-cards-container {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      /* Individual Cards */
      .bst-card {
        position: relative;
        background: rgba(191, 174, 138, 0.95);
        border-radius: 4px;
        padding: 10px 12px;
        box-shadow:
          0 2px 6px rgba(0, 0, 0, 0.25),
          inset 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .bst-card-ally {
        border: 2px solid #4a6088;
      }

      .bst-card-opponent {
        border: 2px solid #8b4444;
      }

      .bst-card-mvp {
        border-color: #ffd700;
        box-shadow:
          0 0 12px rgba(255, 215, 0, 0.4),
          0 2px 6px rgba(0, 0, 0, 0.25),
          inset 0 1px 0 rgba(255, 255, 255, 0.3);
        animation: mvpGlow 2s ease-in-out infinite alternate;
      }

      @keyframes mvpGlow {
        from {
          box-shadow:
            0 0 8px rgba(255, 215, 0, 0.3),
            0 2px 6px rgba(0, 0, 0, 0.25),
            inset 0 1px 0 rgba(255, 255, 255, 0.3);
        }
        to {
          box-shadow:
            0 0 16px rgba(255, 215, 0, 0.5),
            0 2px 6px rgba(0, 0, 0, 0.25),
            inset 0 1px 0 rgba(255, 255, 255, 0.3);
        }
      }

      /* MVP Badge */
      .bst-mvp-badge {
        position: absolute;
        top: -8px;
        right: 8px;
        background: linear-gradient(to bottom, #ffd700, #c9a227);
        color: #2a1f0a;
        font-size: 10px;
        font-weight: bold;
        padding: 2px 8px;
        border-radius: 3px;
        text-transform: uppercase;
        letter-spacing: 1px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      /* Card Header */
      .bst-card-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 8px;
        padding-bottom: 6px;
        border-bottom: 1px solid rgba(90, 74, 58, 0.3);
      }

      .bst-unit-info {
        flex: 1;
        min-width: 0;
      }

      .bst-unit-name {
        font-size: 14px;
        font-weight: bold;
        color: #2d2418;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .bst-unit-details {
        font-size: 11px;
        color: #5a4a3a;
        margin-top: 2px;
      }

      .bst-unit-class {
        font-weight: 600;
      }

      .bst-unit-race::before {
        content: ' - ';
        color: #7a6a5a;
      }

      .bst-unit-level {
        font-size: 12px;
        font-weight: bold;
        color: #4a3c2a;
        background: rgba(0, 0, 0, 0.1);
        padding: 2px 8px;
        border-radius: 3px;
        flex-shrink: 0;
      }

      /* Stats Grid */
      .bst-stats-grid {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .bst-stat-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
      }

      .bst-stat-label {
        color: #5a4a3a;
        font-weight: 500;
      }

      .bst-stat-value {
        font-family: 'Consolas', 'Monaco', monospace;
        font-weight: bold;
        color: #2d2418;
        min-width: 60px;
        text-align: right;
      }

      .bst-stat-damage {
        color: #8b4444;
      }

      .bst-stat-taken {
        color: #6a5a4a;
      }

      .bst-stat-healing {
        color: #3d6b35;
      }

      .bst-stat-kd {
        display: flex;
        align-items: center;
        gap: 4px;
        justify-content: flex-end;
      }

      .bst-kills {
        color: #4a6088;
      }

      .bst-separator {
        color: #7a6a5a;
      }

      .bst-deaths {
        color: #8b4444;
      }

      /* Empty State */
      .bst-empty {
        text-align: center;
        color: #7a6a5a;
        font-style: italic;
        padding: 20px;
      }

      /* Mobile Styles */
      @media (max-width: 600px) {
        .battle-stats-table {
          padding: 12px;
          max-height: 50vh;
        }

        .bst-content {
          flex-direction: column;
          min-width: unset;
          gap: 16px;
        }

        .bst-team-column {
          min-width: unset;
        }

        .bst-team-header {
          font-size: 14px;
          padding: 6px 10px;
          margin-bottom: 8px;
        }

        .bst-card {
          padding: 8px 10px;
        }

        .bst-unit-name {
          font-size: 13px;
        }

        .bst-unit-details {
          font-size: 10px;
        }

        .bst-unit-level {
          font-size: 11px;
          padding: 2px 6px;
        }

        .bst-stat-row {
          font-size: 11px;
        }

        .bst-stat-value {
          min-width: 50px;
        }
      }

      /* Scrollbar Styling */
      .battle-stats-table::-webkit-scrollbar {
        width: 8px;
      }

      .battle-stats-table::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.2);
        border-radius: 4px;
      }

      .battle-stats-table::-webkit-scrollbar-thumb {
        background: rgba(139, 115, 85, 0.6);
        border-radius: 4px;
      }

      .battle-stats-table::-webkit-scrollbar-thumb:hover {
        background: rgba(139, 115, 85, 0.8);
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Format a number with locale-aware separators
   * @param {number} num - Number to format
   * @returns {string} Formatted number string
   */
  formatNumber(num) {
    return num.toLocaleString();
  }

  /**
   * Capitalize the first letter of a string
   * @param {string} str - String to capitalize
   * @returns {string} Capitalized string
   */
  capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Clean up the DOM container
   */
  cleanup() {
    if (this.animationTimeout) {
      clearTimeout(this.animationTimeout);
      this.animationTimeout = null;
    }

    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    this.container = null;
    this.isVisible = false;
  }

  /**
   * Full cleanup and destroy
   */
  destroy() {
    this.cleanup();
    // Remove injected styles when component is destroyed
    const styleEl = document.getElementById('battle-stats-table-styles');
    if (styleEl) {
      styleEl.remove();
    }
  }
}
