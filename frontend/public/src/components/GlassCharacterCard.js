/**
 * GlassCharacterCard - Unified character detail card with glass morphism styling
 *
 * Features:
 * - Glass morphism effect (frosted glass with backdrop-filter blur)
 * - 64x64 portrait with health-based border colors
 * - HP/MP bars with inline current/max values on right
 * - Compact 2-row stats grid (STR, INT, AGI | VIT, LCK)
 *
 * Usage:
 *   const card = new GlassCharacterCard({ mode: 'detailed' });
 *   container.appendChild(card.element);
 *   card.setCharacter(characterData);
 */
export class GlassCharacterCard {
  /**
   * @param {Object} options
   * @param {string} options.mode - Display mode: 'compact' or 'detailed' (default: 'detailed')
   * @param {boolean} options.showPortrait - Whether to show portrait (default: true)
   * @param {boolean} options.autoHide - Auto-hide after display (default: false)
   * @param {number} options.autoHideDelay - Delay before auto-hide in ms (default: 2000)
   */
  constructor(options = {}) {
    this.mode = options.mode || 'detailed';
    this.showPortrait = options.showPortrait !== false;
    this.autoHide = options.autoHide || false;
    this.autoHideDelay = options.autoHideDelay || 2000;

    this.character = null;
    this.element = null;
    this.hideTimeout = null;

    this.createElement();
  }

  /**
   * Create the card DOM element
   */
  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'glass-character-card';
    this.element.innerHTML = this.getEmptyStateHTML();
    this.addStyles();
  }

  /**
   * Add component styles (only once per page)
   */
  addStyles() {
    if (document.getElementById('glass-character-card-styles')) return;

    const style = document.createElement('style');
    style.id = 'glass-character-card-styles';
    style.textContent = `
      /* Glass morphism base card */
      .glass-character-card {
        background: rgba(20, 30, 50, 0.65);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        box-shadow:
          0 4px 30px rgba(0, 0, 0, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
        padding: 14px;
        transition: all 0.3s ease;
        min-width: 180px;
      }

      .glass-character-card:hover {
        background: rgba(25, 35, 55, 0.75);
        border-color: rgba(255, 215, 0, 0.2);
        box-shadow:
          0 6px 35px rgba(0, 0, 0, 0.4),
          inset 0 1px 0 rgba(255, 255, 255, 0.15);
      }

      .glass-character-card.hidden {
        opacity: 0;
        pointer-events: none;
        transform: translateY(10px);
      }

      .glass-character-card.empty {
        opacity: 0.6;
      }

      /* 64x64 Portrait */
      .gcc-portrait-container {
        width: 64px;
        height: 64px;
        border-radius: 8px;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.4);
        border: 2px solid rgba(74, 144, 217, 0.7);
        flex-shrink: 0;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }

      .gcc-portrait-container.low-health {
        border-color: rgba(255, 152, 0, 0.9);
      }

      .gcc-portrait-container.critical-health {
        border-color: rgba(244, 67, 54, 0.95);
        animation: gcc-pulse-critical 1.5s ease-in-out infinite;
      }

      @keyframes gcc-pulse-critical {
        0%, 100% {
          border-color: rgba(244, 67, 54, 0.95);
          box-shadow: 0 0 8px rgba(244, 67, 54, 0.4);
        }
        50% {
          border-color: rgba(255, 107, 107, 1);
          box-shadow: 0 0 16px rgba(244, 67, 54, 0.6);
        }
      }

      .gcc-portrait {
        width: 100%;
        height: 100%;
        image-rendering: pixelated;
        object-fit: cover;
      }

      .gcc-portrait-fallback {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-size: 24px;
      }

      /* Header info */
      .gcc-name {
        color: #ffd700;
        font-weight: bold;
        font-size: 14px;
        margin-bottom: 2px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
      }

      .gcc-subtitle {
        color: rgba(170, 170, 170, 0.9);
        font-size: 11px;
        margin-bottom: 8px;
      }

      /* HP/MP Bars with inline values */
      .gcc-bar-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }

      .gcc-bar-label {
        width: 22px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .gcc-bar-label.hp { color: #66bb6a; }
      .gcc-bar-label.mp { color: #42a5f5; }

      .gcc-bar-wrapper {
        flex: 1;
        height: 10px;
        background: rgba(0, 0, 0, 0.5);
        border-radius: 5px;
        overflow: hidden;
        box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);
      }

      .gcc-bar-fill {
        height: 100%;
        border-radius: 5px;
        transition: width 0.4s ease;
        position: relative;
      }

      .gcc-bar-fill.hp {
        background: linear-gradient(180deg, #81c784 0%, #4caf50 50%, #388e3c 100%);
        box-shadow: 0 0 6px rgba(76, 175, 80, 0.4);
      }

      .gcc-bar-fill.hp.warning {
        background: linear-gradient(180deg, #ffcc80 0%, #ff9800 50%, #f57c00 100%);
        box-shadow: 0 0 6px rgba(255, 152, 0, 0.4);
      }

      .gcc-bar-fill.hp.critical {
        background: linear-gradient(180deg, #ef9a9a 0%, #f44336 50%, #d32f2f 100%);
        box-shadow: 0 0 6px rgba(244, 67, 54, 0.5);
        animation: gcc-bar-pulse 1s ease-in-out infinite;
      }

      @keyframes gcc-bar-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }

      .gcc-bar-fill.mp {
        background: linear-gradient(180deg, #64b5f6 0%, #2196f3 50%, #1976d2 100%);
        box-shadow: 0 0 6px rgba(33, 150, 243, 0.4);
      }

      .gcc-bar-value {
        width: 54px;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.95);
        text-align: right;
        font-family: 'Consolas', 'Monaco', monospace;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
      }

      /* Compact 2-row stats grid */
      .gcc-stats-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 4px 10px;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }

      .gcc-stat {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
      }

      .gcc-stat-label {
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .gcc-stat-label.str { color: #ef5350; }
      .gcc-stat-label.int { color: #ce93d8; }
      .gcc-stat-label.agi { color: #81c784; }
      .gcc-stat-label.vit { color: #ffb74d; }
      .gcc-stat-label.lck { color: #ffd54f; }

      .gcc-stat-value {
        color: rgba(255, 255, 255, 0.9);
        font-family: 'Consolas', 'Monaco', monospace;
      }

      /* Row 2: VIT and LCK centered */
      .gcc-stats-row-2 {
        grid-column: span 3;
        display: flex;
        justify-content: center;
        gap: 24px;
      }

      .gcc-stats-row-2 .gcc-stat {
        min-width: 50px;
      }

      /* Layout variants */
      .glass-character-card.layout-horizontal .gcc-content {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }

      .glass-character-card.layout-horizontal .gcc-info {
        flex: 1;
        min-width: 0;
      }

      .glass-character-card.layout-vertical .gcc-header {
        text-align: center;
        margin-bottom: 10px;
      }

      .glass-character-card.layout-vertical .gcc-portrait-container {
        margin: 0 auto 10px;
      }

      /* Empty state */
      .gcc-empty-state {
        color: rgba(138, 138, 170, 0.8);
        text-align: center;
        padding: 24px 16px;
        font-size: 12px;
        font-style: italic;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Get HTML for empty state
   */
  getEmptyStateHTML() {
    return `<div class="gcc-empty-state">Select a character</div>`;
  }

  /**
   * Set the character to display
   * @param {Object} character - Character data object
   */
  setCharacter(character) {
    this.character = character;
    this.render();

    if (this.autoHide && character) {
      this.scheduleHide();
    }
  }

  /**
   * Update character data (partial update)
   * @param {Object} updates - Partial character data to merge
   */
  update(updates) {
    if (!this.character) return;

    Object.assign(this.character, updates);
    this.render();
  }

  /**
   * Render the card content
   */
  render() {
    if (!this.character) {
      this.element.classList.add('empty');
      this.element.innerHTML = this.getEmptyStateHTML();
      return;
    }

    this.element.classList.remove('empty', 'hidden');
    const c = this.character;

    // Calculate percentages
    const hpMax = c.hp_max || c.maxHp || 1;
    const mpMax = c.mp_max || c.maxMp || 1;
    const hpCurrent = c.hp_current ?? c.hp ?? 0;
    const mpCurrent = c.mp_current ?? c.mp ?? 0;
    const hpPercent = Math.min(100, Math.max(0, (hpCurrent / hpMax) * 100));
    const mpPercent = Math.min(100, Math.max(0, (mpCurrent / mpMax) * 100));

    // Determine health status
    const hpStatus = hpPercent > 50 ? '' : hpPercent > 25 ? 'warning' : 'critical';
    const portraitStatus = hpPercent > 50 ? '' : hpPercent > 25 ? 'low-health' : 'critical-health';

    // Portrait URL (64x64)
    const gender = c.gender || 'other';
    const race = c.race || 'human';
    const charClass = c.class || 'warrior';
    const portraitUrl = `/assets/sprites/portraits/${race}_${gender}_${charClass}.png`;

    // Class info for fallback
    const classColors = {
      warrior: '#d94a4a',
      wizard: '#9c27b0',
      monk: '#4caf50',
      chemist: '#ff9800',
      knight: '#5c6bc0',
      berserker: '#8b0000',
      sage: '#00838f',
      ninja: '#37474f'
    };
    const classIcons = {
      warrior: 'W',
      wizard: 'M',
      monk: 'K',
      chemist: 'C',
      knight: 'N',
      berserker: 'B',
      sage: 'S',
      ninja: 'A'
    };
    const classColor = classColors[charClass] || '#666';
    const classIcon = classIcons[charClass] || '?';

    // Determine layout
    const layout = this.mode === 'compact' ? 'horizontal' : 'vertical';
    this.element.className = `glass-character-card layout-${layout}`;

    // Build HTML
    let html = '<div class="gcc-content">';

    // Portrait section (64x64)
    if (this.showPortrait) {
      html += `
        <div class="gcc-portrait-container ${portraitStatus}">
          <img
            class="gcc-portrait"
            src="${portraitUrl}"
            alt="${this.escapeHtml(c.name)}"
            onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
          >
          <div class="gcc-portrait-fallback" style="display: none; background: ${classColor};">
            ${classIcon}
          </div>
        </div>
      `;
    }

    // Info section
    html += '<div class="gcc-info">';

    // Header (name + subtitle)
    if (this.mode === 'compact') {
      html += `
        <div class="gcc-name">${this.escapeHtml(c.name)}</div>
        <div class="gcc-subtitle">Lv.${c.level || 1} ${this.capitalize(charClass)}</div>
      `;
    } else {
      html += `
        <div class="gcc-header">
          <div class="gcc-name">${this.escapeHtml(c.name)}</div>
          <div class="gcc-subtitle">Lv.${c.level || 1} ${this.capitalize(race)} ${this.capitalize(charClass)}</div>
        </div>
      `;
    }

    // HP Bar with inline value on right
    html += `
      <div class="gcc-bar-row">
        <span class="gcc-bar-label hp">HP</span>
        <div class="gcc-bar-wrapper">
          <div class="gcc-bar-fill hp ${hpStatus}" style="width: ${hpPercent}%;"></div>
        </div>
        <span class="gcc-bar-value">${hpCurrent}/${hpMax}</span>
      </div>
    `;

    // MP Bar with inline value on right
    html += `
      <div class="gcc-bar-row">
        <span class="gcc-bar-label mp">MP</span>
        <div class="gcc-bar-wrapper">
          <div class="gcc-bar-fill mp" style="width: ${mpPercent}%;"></div>
        </div>
        <span class="gcc-bar-value">${mpCurrent}/${mpMax}</span>
      </div>
    `;

    // Stats grid - always show in both modes for this unified card
    // Row 1: STR, INT, AGI | Row 2: VIT, LCK (centered)
    if (this.mode === 'detailed') {
      html += `
        <div class="gcc-stats-grid">
          <div class="gcc-stat">
            <span class="gcc-stat-label str">STR</span>
            <span class="gcc-stat-value">${c.strength || 0}</span>
          </div>
          <div class="gcc-stat">
            <span class="gcc-stat-label int">INT</span>
            <span class="gcc-stat-value">${c.intelligence || 0}</span>
          </div>
          <div class="gcc-stat">
            <span class="gcc-stat-label agi">AGI</span>
            <span class="gcc-stat-value">${c.agility || 0}</span>
          </div>
          <div class="gcc-stats-row-2">
            <div class="gcc-stat">
              <span class="gcc-stat-label vit">VIT</span>
              <span class="gcc-stat-value">${c.vitality || 0}</span>
            </div>
            <div class="gcc-stat">
              <span class="gcc-stat-label lck">LCK</span>
              <span class="gcc-stat-value">${c.luck || 0}</span>
            </div>
          </div>
        </div>
      `;
    }

    html += '</div>'; // gcc-info
    html += '</div>'; // gcc-content

    this.element.innerHTML = html;
  }

  /**
   * Show the card with fade-in
   */
  show() {
    this.element.classList.remove('hidden');

    if (this.autoHide) {
      this.scheduleHide();
    }
  }

  /**
   * Hide the card with fade-out
   */
  hide() {
    this.element.classList.add('hidden');
    this.clearHideTimeout();
  }

  /**
   * Schedule auto-hide
   */
  scheduleHide() {
    this.clearHideTimeout();
    this.hideTimeout = setTimeout(() => {
      this.hide();
    }, this.autoHideDelay);
  }

  /**
   * Clear any pending hide timeout
   */
  clearHideTimeout() {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  /**
   * Capitalize a string
   */
  capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.clearHideTimeout();
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.character = null;
  }
}
