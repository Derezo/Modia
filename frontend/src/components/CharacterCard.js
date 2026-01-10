/**
 * CharacterCard - Reusable character information display component
 *
 * Usage:
 *   const card = new CharacterCard({ mode: 'detailed' });
 *   container.appendChild(card.element);
 *   card.setCharacter(characterData);
 *   card.update(characterData); // Update with new data
 */
export class CharacterCard {
  /**
   * @param {Object} options
   * @param {string} options.mode - Display mode: 'compact' (HP/MP only) or 'detailed' (includes stats)
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
    this.element.className = 'character-card';
    this.element.innerHTML = this.getEmptyStateHTML();
    this.addStyles();
  }

  /**
   * Add component styles (only once per page)
   */
  addStyles() {
    if (document.getElementById('character-card-styles')) return;

    const style = document.createElement('style');
    style.id = 'character-card-styles';
    style.textContent = `
      .character-card {
        transition: opacity 0.3s ease-out;
      }

      .character-card.hidden {
        opacity: 0;
        pointer-events: none;
      }

      .character-card.empty {
        opacity: 0.5;
      }

      .cc-portrait-container {
        width: 48px;
        height: 48px;
        border-radius: 4px;
        overflow: hidden;
        background: #333;
        border: 2px solid #4a90d9;
        flex-shrink: 0;
      }

      .cc-portrait-container.low-health {
        border-color: #d94a4a;
      }

      .cc-portrait-container.critical-health {
        border-color: #f44336;
        animation: pulse-danger 1s ease-in-out infinite;
      }

      @keyframes pulse-danger {
        0%, 100% { border-color: #f44336; }
        50% { border-color: #ff6b6b; }
      }

      .cc-portrait {
        width: 100%;
        height: 100%;
        image-rendering: pixelated;
        object-fit: cover;
      }

      .cc-portrait-fallback {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-size: 20px;
      }

      .cc-name {
        color: #ffd700;
        font-weight: bold;
        font-size: 13px;
        margin-bottom: 2px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .cc-subtitle {
        color: #aaa;
        font-size: 11px;
        margin-bottom: 6px;
      }

      .cc-bar-container {
        margin-bottom: 4px;
      }

      .cc-bar-label {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        margin-bottom: 2px;
      }

      .cc-bar-label-text {
        color: #aaa;
      }

      .cc-bar-value {
        color: #fff;
      }

      .cc-bar {
        height: 8px;
        background: #333;
        border-radius: 4px;
        overflow: hidden;
      }

      .cc-bar-fill {
        height: 100%;
        border-radius: 4px;
        transition: width 0.3s ease;
      }

      .cc-bar-fill.hp {
        background: #4caf50;
      }

      .cc-bar-fill.hp.warning {
        background: #ff9800;
      }

      .cc-bar-fill.hp.critical {
        background: #f44336;
      }

      .cc-bar-fill.mp {
        background: #2196f3;
      }

      .cc-stats-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px 12px;
        font-size: 11px;
        margin-top: 8px;
      }

      .cc-stat {
        display: flex;
        justify-content: space-between;
      }

      .cc-stat-label {
        font-weight: 500;
      }

      .cc-stat-label.str { color: #d94a4a; }
      .cc-stat-label.int { color: #9c27b0; }
      .cc-stat-label.agi { color: #4caf50; }
      .cc-stat-label.vit { color: #ff9800; }
      .cc-stat-label.lck { color: #ffd700; }

      .cc-stat-value {
        color: #fff;
      }

      .cc-stat.centered {
        grid-column: span 2;
        justify-self: center;
        width: 50%;
      }

      /* Layout variants */
      .character-card.layout-horizontal .cc-content {
        display: flex;
        gap: 10px;
        align-items: flex-start;
      }

      .character-card.layout-horizontal .cc-info {
        flex: 1;
        min-width: 0;
      }

      .character-card.layout-vertical .cc-header {
        text-align: center;
        margin-bottom: 12px;
      }

      .character-card.layout-vertical .cc-portrait-container {
        margin: 0 auto 8px;
      }

      .cc-empty-state {
        color: #6a6a8a;
        text-align: center;
        padding: 20px;
        font-size: 12px;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Get HTML for empty state
   */
  getEmptyStateHTML() {
    return `<div class="cc-empty-state">Select a character</div>`;
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
    const hpPercent = (hpCurrent / hpMax) * 100;
    const mpPercent = (mpCurrent / mpMax) * 100;

    // Determine health status
    const hpStatus = hpPercent > 50 ? '' : hpPercent > 25 ? 'warning' : 'critical';
    const portraitStatus = hpPercent > 50 ? '' : hpPercent > 25 ? 'low-health' : 'critical-health';

    // Portrait URL
    const gender = c.gender || 'other';
    const race = c.race || 'human';
    const charClass = c.class || 'warrior';
    const portraitUrl = `/assets/sprites/portraits/${race}_${gender}_${charClass}.png`;

    // Class info for fallback
    const classColors = {
      warrior: '#d94a4a',
      wizard: '#9c27b0',
      monk: '#4caf50',
      chemist: '#ff9800'
    };
    const classIcons = {
      warrior: '⚔️',
      wizard: '🔮',
      monk: '👊',
      chemist: '⚗️'
    };
    const classColor = classColors[charClass] || '#666';
    const classIcon = classIcons[charClass] || '?';

    // Determine layout
    const layout = this.mode === 'compact' ? 'horizontal' : 'vertical';
    this.element.className = `character-card layout-${layout}`;

    // Build HTML
    let html = '<div class="cc-content">';

    // Portrait section
    if (this.showPortrait) {
      html += `
        <div class="cc-portrait-container ${portraitStatus}">
          <img
            class="cc-portrait"
            src="${portraitUrl}"
            alt="${c.name}"
            onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
          >
          <div class="cc-portrait-fallback" style="display: none; background: ${classColor};">
            ${classIcon}
          </div>
        </div>
      `;
    }

    // Info section
    html += '<div class="cc-info">';

    // Header (name + subtitle)
    if (this.mode === 'compact') {
      html += `
        <div class="cc-name">${this.escapeHtml(c.name)}</div>
        <div class="cc-subtitle">Lv.${c.level || 1} ${this.capitalize(charClass)}</div>
      `;
    } else {
      html += `
        <div class="cc-header">
          <div class="cc-name">${this.escapeHtml(c.name)}</div>
          <div class="cc-subtitle">Lv.${c.level || 1} ${this.capitalize(race)} ${this.capitalize(charClass)}</div>
        </div>
      `;
    }

    // HP Bar
    html += `
      <div class="cc-bar-container">
        <div class="cc-bar-label">
          <span class="cc-bar-label-text">HP</span>
          <span class="cc-bar-value">${hpCurrent}/${hpMax}</span>
        </div>
        <div class="cc-bar">
          <div class="cc-bar-fill hp ${hpStatus}" style="width: ${hpPercent}%;"></div>
        </div>
      </div>
    `;

    // MP Bar
    html += `
      <div class="cc-bar-container">
        <div class="cc-bar-label">
          <span class="cc-bar-label-text">MP</span>
          <span class="cc-bar-value">${mpCurrent}/${mpMax}</span>
        </div>
        <div class="cc-bar">
          <div class="cc-bar-fill mp" style="width: ${mpPercent}%;"></div>
        </div>
      </div>
    `;

    // Stats (detailed mode only)
    if (this.mode === 'detailed') {
      html += `
        <div class="cc-stats-grid">
          <div class="cc-stat">
            <span class="cc-stat-label str">STR</span>
            <span class="cc-stat-value">${c.strength || 0}</span>
          </div>
          <div class="cc-stat">
            <span class="cc-stat-label int">INT</span>
            <span class="cc-stat-value">${c.intelligence || 0}</span>
          </div>
          <div class="cc-stat">
            <span class="cc-stat-label agi">AGI</span>
            <span class="cc-stat-value">${c.agility || 0}</span>
          </div>
          <div class="cc-stat">
            <span class="cc-stat-label vit">VIT</span>
            <span class="cc-stat-value">${c.vitality || 0}</span>
          </div>
          <div class="cc-stat centered">
            <span class="cc-stat-label lck">LCK</span>
            <span class="cc-stat-value">${c.luck || 0}</span>
          </div>
        </div>
      `;
    }

    html += '</div>'; // cc-info
    html += '</div>'; // cc-content

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
