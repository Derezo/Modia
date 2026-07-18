/**
 * @module BattleStatsTable
 * @description DOM-based battle statistics table for post-battle summary display.
 *
 * Displays team performance metrics in a data table format with character portraits,
 * grouped by ownerUsername. Features slide-in/out animations and MVP highlighting.
 *
 * Key responsibilities:
 * - Render battle statistics in tabular format with portraits
 * - Group units by owner username with separator rows
 * - Determine MVP based on highest damage dealt
 * - Handle responsive layout for mobile devices
 * - Animate show/hide transitions
 *
 * @see BattleOutroSequence.js - Orchestrates victory/defeat animations
 * @see BattleIntro.js - Similar DOM-based component pattern
 */

import { escapeHtml } from './battleLogUtils.js';
import { getAssetPath, getNpcPortraitId } from '../../../shared/assetPaths.js';

/**
 * BattleStatsTable - Post-battle statistics display component
 *
 * Usage:
 *   const statsTable = new BattleStatsTable(battleScene);
 *   statsTable.show(unitStats, isPvP, isVictory, localUserId, localUsername);
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
    this.isPvP = false; // Track PvP mode for fallback color logic
  }

  /**
   * Show the stats table with slide-in animation
   * @param {Array} unitStats - Array of unit stat objects
   * @param {boolean} isPvP - Whether this is a PvP battle
   * @param {boolean} isVictory - Whether the local player won
   * @param {number} localUserId - The local player's user ID
   * @param {string} localUsername - The local player's username
   */
  show(unitStats, isPvP, isVictory, localUserId, localUsername) {
    if (this.isVisible) {
      this.hide();
    }

    this.isPvP = isPvP; // Store for fallback color logic
    this.createTableDOM(unitStats, isPvP, isVictory, localUserId, localUsername);
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
   * Create the DOM structure for the stats table in data table format
   * @param {Array} unitStats - Array of unit stat objects
   * @param {boolean} isPvP - Whether this is a PvP battle
   * @param {boolean} isVictory - Whether the local player won
   * @param {number} localUserId - The local player's user ID
   * @param {string} localUsername - The local player's username
   */
  createTableDOM(unitStats, isPvP, isVictory, localUserId, localUsername) {
    this.addStyles();

    // Group units by owner and determine MVP
    const { groups, mvpId } = this.groupUnitsByOwner(unitStats, isPvP, isVictory, localUserId, localUsername);

    // Create container
    this.container = document.createElement('div');
    this.container.className = 'battle-stats-table';
    this.container.innerHTML = `
      <div class="bst-header">BATTLE STATISTICS</div>
      <div class="bst-table-wrapper">
        <table class="bst-table">
          <thead>
            <tr class="bst-table-header">
              <th class="bst-col-character">Character</th>
              <th class="bst-col-stat">DMG Dealt</th>
              <th class="bst-col-stat">DMG Taken</th>
              <th class="bst-col-stat">Healing</th>
              <th class="bst-col-stat bst-col-narrow">Kills</th>
              <th class="bst-col-stat bst-col-narrow">Deaths</th>
            </tr>
          </thead>
          <tbody>
            ${this.renderTableBody(groups, mvpId)}
          </tbody>
        </table>
      </div>
    `;

    // Add to game UI overlay
    this.scene.game.uiOverlay.appendChild(this.container);
  }

  /**
   * Group units by owner username
   * @param {Array} unitStats - Array of unit stat objects
   * @param {boolean} isPvP - Whether this is a PvP battle
   * @param {boolean} isVictory - Whether the local player won
   * @param {number} localUserId - The local player's user ID
   * @param {string} localUsername - The local player's username
   * @returns {Object} { groups: Array<{username, units}>, mvpId }
   */
  groupUnitsByOwner(unitStats, isPvP, isVictory, localUserId, localUsername) {
    const groups = [];
    let mvpId = null;

    if (isPvP) {
      // PvP: Group by ownerUsername
      // First group: Local player's units
      const localUnits = unitStats.filter(u => u.ownerId === localUserId);
      const opponentUnits = unitStats.filter(u => u.ownerId !== localUserId);

      if (localUnits.length > 0) {
        const displayName = localUnits[0].ownerUsername || localUsername || 'You';
        groups.push({
          username: displayName,
          units: localUnits,
          isLocal: true
        });
      }

      // Group opponent units by their ownerUsername
      const opponentsByOwner = new Map();
      for (const unit of opponentUnits) {
        const ownerName = unit.ownerUsername || 'Opponent';
        if (!opponentsByOwner.has(ownerName)) {
          opponentsByOwner.set(ownerName, []);
        }
        opponentsByOwner.get(ownerName).push(unit);
      }

      for (const [ownerName, units] of opponentsByOwner) {
        groups.push({
          username: ownerName,
          units: units,
          isLocal: false
        });
      }

      // Determine MVP (highest damage dealt on winning team)
      if (isVictory && localUnits.length > 0) {
        const topUnit = localUnits.reduce((best, unit) => {
          const damage = unit.damageDealt || 0;
          return damage > (best.damageDealt || 0) ? unit : best;
        }, localUnits[0]);
        // Only assign MVP if the top unit actually dealt damage
        if ((topUnit.damageDealt || 0) > 0) {
          mvpId = topUnit.id;
        }
      }
    } else {
      // PvE: Players first, then enemies
      const playerUnits = unitStats.filter(u => u.type === 'player');
      const enemyUnits = unitStats.filter(u => u.type === 'enemy');

      // Group players by ownerUsername
      const playersByOwner = new Map();
      for (const unit of playerUnits) {
        const ownerName = unit.ownerUsername || localUsername || 'Your Party';
        if (!playersByOwner.has(ownerName)) {
          playersByOwner.set(ownerName, []);
        }
        playersByOwner.get(ownerName).push(unit);
      }

      for (const [ownerName, units] of playersByOwner) {
        groups.push({
          username: ownerName,
          units: units,
          isLocal: true
        });
      }

      // Enemies grouped together
      if (enemyUnits.length > 0) {
        groups.push({
          username: 'Enemies',
          units: enemyUnits,
          isLocal: false
        });
      }

      // Determine MVP (highest damage dealt on player team)
      if (isVictory && playerUnits.length > 0) {
        const topUnit = playerUnits.reduce((best, unit) => {
          const damage = unit.damageDealt || 0;
          return damage > (best.damageDealt || 0) ? unit : best;
        }, playerUnits[0]);
        // Only assign MVP if the top unit actually dealt damage
        if ((topUnit.damageDealt || 0) > 0) {
          mvpId = topUnit.id;
        }
      }
    }

    return { groups, mvpId };
  }

  /**
   * Render the table body with groups and unit rows
   * @param {Array} groups - Array of group objects {username, units, isLocal}
   * @param {string|null} mvpId - ID of the MVP unit
   * @returns {string} HTML string for table body
   */
  renderTableBody(groups, mvpId) {
    if (groups.length === 0) {
      return `
        <tr>
          <td colspan="6" class="bst-empty">No battle statistics available</td>
        </tr>
      `;
    }

    let html = '';
    let rowIndex = 0;

    for (const group of groups) {
      // Add separator row for group
      html += `
        <tr class="bst-separator-row">
          <td colspan="6" class="bst-separator-cell">
            <span class="bst-separator-text">${escapeHtml(group.username)}</span>
          </td>
        </tr>
      `;

      // Add unit rows
      for (const unit of group.units) {
        const isMvp = unit.id === mvpId;
        const zebraClass = rowIndex % 2 === 0 ? 'bst-row-even' : 'bst-row-odd';
        const mvpClass = isMvp ? 'bst-row-mvp' : '';

        html += this.renderUnitRow(unit, isMvp, zebraClass, mvpClass, group.isLocal);
        rowIndex++;
      }
    }

    return html;
  }

  /**
   * Render a single unit row
   * @param {Object} unit - Unit stat object
   * @param {boolean} isMvp - Whether this unit is MVP
   * @param {string} zebraClass - Zebra striping class
   * @param {string} mvpClass - MVP styling class
   * @param {boolean} isLocal - Whether this unit belongs to the local player's team
   * @returns {string} HTML string for the row
   */
  renderUnitRow(unit, isMvp, zebraClass, mvpClass, isLocal = true) {
    const portraitPath = this.getPortraitPath(unit);
    const fallbackLetter = (unit.name || 'U').charAt(0).toUpperCase();
    // In PvP, use isLocal to determine color (both sides are type:'player')
    // In PvE, fall back to type-based coloring
    const isOpponent = this.isPvP ? !isLocal : unit.type === 'enemy';
    const fallbackColor = isOpponent ? '#8b4444' : '#4a6088';

    const levelInfo = `Lv.${unit.level || 1}`;
    const raceClass = unit.race
      ? `${this.capitalize(unit.race)} ${this.capitalize(unit.class || unit.type || '')}`
      : this.capitalize(unit.class || unit.type || 'Unknown');

    return `
      <tr class="bst-unit-row ${zebraClass} ${mvpClass}">
        <td class="bst-col-character">
          <div class="bst-character-cell">
            <div class="bst-portrait-container">
              <img
                src="${escapeHtml(portraitPath)}"
                alt="${escapeHtml(unit.name || 'Unit')}"
                class="bst-portrait"
                data-image-fallback data-fallback-display="flex"
              />
              <div class="bst-portrait-fallback" style="display:none; background-color: ${fallbackColor};">
                ${escapeHtml(fallbackLetter)}
              </div>
              ${isMvp ? '<div class="bst-mvp-badge">MVP</div>' : ''}
            </div>
            <div class="bst-character-info">
              <div class="bst-unit-name">${escapeHtml(unit.name || 'Unknown')}</div>
              <div class="bst-unit-details">${escapeHtml(levelInfo)} ${escapeHtml(raceClass)}</div>
            </div>
          </div>
        </td>
        <td class="bst-col-stat bst-stat-damage">${this.formatNumber(unit.damageDealt || 0)}</td>
        <td class="bst-col-stat bst-stat-taken">${this.formatNumber(unit.damageTaken || 0)}</td>
        <td class="bst-col-stat bst-stat-healing">${this.formatNumber(unit.healingDone || 0)}</td>
        <td class="bst-col-stat bst-col-narrow bst-stat-kills">${unit.kills || 0}</td>
        <td class="bst-col-stat bst-col-narrow bst-stat-deaths">${unit.deaths || 0}</td>
      </tr>
    `;
  }

  /**
   * Get the portrait path for a unit
   * @param {Object} unit - Unit object with type, race, class, gender, enemyType, enemyId
   * @returns {string} Path to portrait image
   */
  getPortraitPath(unit) {
    const size = 48; // Use compact portrait size
    if (unit.type === 'enemy') {
      return getAssetPath('portraits', getNpcPortraitId(
        unit,
        unit.enemyType || unit.class || 'unknown'
      ), { size });
    } else {
      // Player portrait path: /assets/portraits/{size}/{race}_{gender}_{class}.webp
      const race = (unit.race || 'human').toLowerCase();
      const gender = (unit.gender || 'male').toLowerCase();
      const charClass = (unit.class || 'warrior').toLowerCase();
      return `/assets/portraits/${size}/${race}_${gender}_${charClass}.webp`;
    }
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
        max-width: 90vw;
        max-height: 75vh;
        opacity: 0;
        transition: opacity 0.35s ease, transform 0.35s ease;
        z-index: 150;
        box-shadow:
          0 8px 32px rgba(0, 0, 0, 0.5),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        font-family: 'Georgia', 'Times New Roman', serif;
        display: flex;
        flex-direction: column;
      }

      .battle-stats-table.visible {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }

      /* Header */
      .bst-header {
        font-size: 18px;
        font-weight: bold;
        text-align: center;
        padding: 16px 20px 12px;
        color: #d4c4a8;
        text-transform: uppercase;
        letter-spacing: 2px;
        border-bottom: 2px solid #5a4a3a;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
      }

      /* Table Wrapper - scrollable */
      .bst-table-wrapper {
        overflow-y: auto;
        overflow-x: auto;
        flex: 1;
        padding: 0 4px 4px;
      }

      /* Table */
      .bst-table {
        width: 100%;
        border-collapse: collapse;
        min-width: 600px;
      }

      /* Table Header */
      .bst-table-header th {
        position: sticky;
        top: 0;
        background: rgba(50, 45, 38, 0.98);
        color: #b8a888;
        font-size: 12px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 1px;
        padding: 12px 8px;
        text-align: right;
        border-bottom: 2px solid #5a4a3a;
        z-index: 10;
      }

      .bst-table-header th.bst-col-character {
        text-align: left;
        min-width: 200px;
      }

      .bst-col-stat {
        min-width: 80px;
      }

      .bst-col-narrow {
        min-width: 50px;
      }

      /* Separator Row */
      .bst-separator-row {
        background: rgba(90, 74, 58, 0.4);
      }

      .bst-separator-cell {
        padding: 4px 12px;
        text-align: center;
      }

      .bst-separator-text {
        color: #c4b494;
        font-size: 13px;
        font-weight: bold;
        letter-spacing: 1px;
      }

      .bst-separator-text::before,
      .bst-separator-text::after {
        content: '\\2500\\2500';
        margin: 0 12px;
        color: #7a6a5a;
      }

      /* Unit Rows */
      .bst-unit-row {
        transition: background-color 0.2s ease;
      }

      .bst-row-even {
        background: rgba(60, 52, 42, 0.6);
      }

      .bst-row-odd {
        background: rgba(50, 44, 36, 0.6);
      }

      .bst-unit-row:hover {
        background: rgba(80, 70, 55, 0.7);
      }

      .bst-row-mvp {
        background: rgba(255, 215, 0, 0.1) !important;
        animation: mvpRowGlow 2s ease-in-out infinite alternate;
      }

      @keyframes mvpRowGlow {
        from {
          background: rgba(255, 215, 0, 0.08);
        }
        to {
          background: rgba(255, 215, 0, 0.15);
        }
      }

      /* Character Cell */
      .bst-character-cell {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 8px;
      }

      /* Portrait Container */
      .bst-portrait-container {
        position: relative;
        width: 48px;
        height: 48px;
        flex-shrink: 0;
      }

      .bst-portrait {
        width: 48px;
        height: 48px;
        object-fit: contain;
        border-radius: 4px;
        border: 2px solid #5a4a3a;
        background: rgba(30, 25, 20, 0.8);
      }

      .bst-portrait-fallback {
        width: 48px;
        height: 48px;
        border-radius: 4px;
        border: 2px solid #5a4a3a;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        font-weight: bold;
        color: #fff;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
      }

      /* MVP Badge */
      .bst-mvp-badge {
        position: absolute;
        top: -6px;
        right: -6px;
        background: linear-gradient(to bottom, #ffd700, #c9a227);
        color: #2a1f0a;
        font-size: 9px;
        font-weight: bold;
        padding: 2px 6px;
        border-radius: 3px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
        z-index: 5;
      }

      /* Character Info */
      .bst-character-info {
        flex: 1;
        min-width: 0;
      }

      .bst-unit-name {
        font-size: 14px;
        font-weight: bold;
        color: #e8dcc8;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
      }

      .bst-unit-details {
        font-size: 11px;
        color: #a8988a;
        margin-top: 3px;
      }

      /* Stat Columns */
      .bst-unit-row td.bst-col-stat {
        font-family: 'Consolas', 'Monaco', monospace;
        font-size: 12px;
        font-weight: bold;
        text-align: right;
        padding: 4px 8px;
        vertical-align: middle;
      }

      .bst-stat-damage {
        color: #e87070;
      }

      .bst-stat-taken {
        color: #a89888;
      }

      .bst-stat-healing {
        color: #70c870;
      }

      .bst-stat-kills {
        color: #88b8e8;
      }

      .bst-stat-deaths {
        color: #e87070;
      }

      /* Empty State */
      .bst-empty {
        text-align: center;
        color: #7a6a5a;
        font-style: italic;
        padding: 40px 20px;
      }

      /* Scrollbar Styling */
      .bst-table-wrapper::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }

      .bst-table-wrapper::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.2);
        border-radius: 4px;
      }

      .bst-table-wrapper::-webkit-scrollbar-thumb {
        background: rgba(139, 115, 85, 0.6);
        border-radius: 4px;
      }

      .bst-table-wrapper::-webkit-scrollbar-thumb:hover {
        background: rgba(139, 115, 85, 0.8);
      }

      .bst-table-wrapper::-webkit-scrollbar-corner {
        background: transparent;
      }

      /* Mobile Styles */
      @media (max-width: 700px) {
        .battle-stats-table {
          max-height: 60vh;
        }

        .bst-header {
          font-size: 15px;
          padding: 12px 16px 10px;
          letter-spacing: 1px;
        }

        .bst-table {
          min-width: 500px;
        }

        .bst-table-header th {
          font-size: 10px;
          padding: 8px 6px;
        }

        .bst-portrait-container {
          width: 32px;
          height: 32px;
        }

        .bst-portrait,
        .bst-portrait-fallback {
          width: 32px;
          height: 32px;
        }

        .bst-portrait-fallback {
          font-size: 14px;
        }

        .bst-character-cell {
          gap: 6px;
          padding: 3px 6px;
        }

        .bst-unit-name {
          font-size: 11px;
        }

        .bst-unit-details {
          font-size: 9px;
        }

        .bst-unit-row td.bst-col-stat {
          font-size: 10px;
          padding: 3px 6px;
        }

        .bst-separator-cell {
          padding: 3px 10px;
        }

        .bst-separator-text {
          font-size: 11px;
        }

        .bst-separator-text::before,
        .bst-separator-text::after {
          margin: 0 8px;
        }

        .bst-mvp-badge {
          font-size: 8px;
          padding: 1px 4px;
          top: -4px;
          right: -4px;
        }
      }

      /* Very small screens */
      @media (max-width: 500px) {
        .bst-table {
          min-width: 450px;
        }

        .bst-col-stat {
          min-width: 55px;
        }

        .bst-col-narrow {
          min-width: 40px;
        }
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
