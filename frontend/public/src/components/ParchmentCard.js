/**
 * ParchmentCard - Unified character/enemy card with classic RPG parchment styling
 *
 * Features:
 * - Warm tan parchment background with paper texture
 * - Horizontal layout: portrait left, info center, stats right
 * - Green HP bar, blue MP bar with current/max values
 * - Two-row stats grid (STR INT AGI / VIT LCK)
 * - Modes: 'compact' (battle) and 'detailed' (formation)
 * - Supports player (tan border) and enemy (red-tinted border) types
 *
 * Usage:
 *   const card = new ParchmentCard({ mode: 'compact', type: 'player' });
 *   container.appendChild(card.element);
 *   card.setCharacter(characterData);
 */
export class ParchmentCard {
  /**
   * @param {Object} options
   * @param {string} options.mode - 'compact' or 'detailed' (default: 'compact')
   * @param {string} options.type - 'player' or 'enemy' (default: 'player')
   * @param {boolean} options.showStats - Whether to show stats grid (default: true)
   * @param {boolean} options.showPortrait - Whether to show portrait (default: true)
   */
  constructor(options = {}) {
    this.mode = options.mode || 'compact';
    this.type = options.type || 'player';
    this.showStats = options.showStats !== false;
    this.showPortrait = options.showPortrait !== false;

    this.character = null;
    this.element = null;
    // Track last known values for change detection (objects may be mutated in place)
    this.lastKnownValues = { hp: null, mp: null, hp_current: null, mp_current: null };

    this.createElement();
  }

  createElement() {
    this.element = document.createElement('div');
    this.element.className = `parchment-card parchment-card--${this.type}`;
    this.element.innerHTML = this.getEmptyStateHTML();
    this.addStyles();
  }

  addStyles() {
    if (document.getElementById('parchment-card-styles')) return;

    const style = document.createElement('style');
    style.id = 'parchment-card-styles';
    style.textContent = `
      /* Parchment Card Base */
      .parchment-card {
        background:
          linear-gradient(135deg, rgba(180, 160, 130, 0.1) 0%, transparent 50%),
          linear-gradient(225deg, rgba(100, 80, 60, 0.1) 0%, transparent 50%),
          linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
        border: 2px solid #8b7355;
        border-radius: 4px;
        box-shadow:
          0 3px 8px rgba(0, 0, 0, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.3),
          inset 0 -1px 0 rgba(0, 0, 0, 0.1);
        padding: 8px 10px;
        min-width: 260px;
        font-family: 'Georgia', 'Times New Roman', serif;
      }

      .parchment-card--enemy {
        border-color: #8b5555;
        background:
          linear-gradient(135deg, rgba(150, 100, 100, 0.15) 0%, transparent 50%),
          linear-gradient(225deg, rgba(100, 60, 60, 0.1) 0%, transparent 50%),
          linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
      }

      .parchment-card.hidden {
        display: none;
      }

      .parchment-card.empty {
        opacity: 0.6;
      }

      /* Main Layout - Horizontal */
      .pc-content {
        display: flex;
        gap: 10px;
        align-items: flex-start;
      }

      /* Portrait Section */
      .pc-portrait-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        flex-shrink: 0;
      }

      .pc-portrait-container {
        width: 56px;
        height: 56px;
        border: 2px solid #6b5344;
        border-radius: 3px;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.2);
        box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);
      }

      .parchment-card--enemy .pc-portrait-container {
        border-color: #7b4444;
      }

      .pc-portrait {
        width: 100%;
        height: 100%;
        image-rendering: pixelated;
        object-fit: cover;
      }

      .pc-portrait-fallback {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        font-weight: bold;
        color: #fff;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
      }

      .pc-level-badge {
        margin-top: 4px;
        font-size: 10px;
        color: #4a3c2a;
        font-weight: bold;
      }

      /* Info Section - Center */
      .pc-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .pc-name {
        font-size: 13px;
        font-weight: bold;
        color: #2d2418;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
        line-height: 1.2;
      }

      .pc-subtitle {
        font-size: 10px;
        color: #5a4a3a;
        line-height: 1.2;
        margin-bottom: 2px;
      }

      /* HP/MP Bars */
      .pc-bar-row {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 16px;
      }

      .pc-bar-label {
        width: 20px;
        font-size: 10px;
        font-weight: bold;
        text-transform: uppercase;
      }

      .pc-bar-label.hp { color: #3d6b35; }
      .pc-bar-label.mp { color: #35527a; }

      .pc-bar-wrapper {
        flex: 1;
        height: 14px;
        max-width: 120px;
        background: rgba(0, 0, 0, 0.35);
        border-radius: 3px;
        border: 1px solid rgba(0, 0, 0, 0.4);
        overflow: hidden;
        box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3);
        position: relative;
      }

      .pc-bar-fill {
        height: 100%;
        border-radius: 2px;
        transition: width 0.3s ease;
      }

      .pc-bar-fill.hp {
        background: linear-gradient(to bottom, #5a9e4a 0%, #4a8c3a 50%, #3d7530 100%);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .pc-bar-fill.hp.warning {
        background: linear-gradient(to bottom, #d4a840 0%, #c49530 50%, #a87d25 100%);
      }

      .pc-bar-fill.hp.critical {
        background: linear-gradient(to bottom, #c45a5a 0%, #a84040 50%, #8b3030 100%);
      }

      .pc-bar-fill.mp {
        background: linear-gradient(to bottom, #5080b0 0%, #406a95 50%, #355580 100%);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .pc-bar-value-inside {
        position: absolute;
        right: 5px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 9px;
        font-family: 'Consolas', 'Monaco', monospace;
        font-weight: bold;
        color: #fff;
        text-shadow:
          -1px -1px 0 #000,
          1px -1px 0 #000,
          -1px 1px 0 #000,
          1px 1px 0 #000;
        white-space: nowrap;
      }

      /* Stats Section - Right (Vertical Layout) */
      .pc-stats {
        display: flex;
        flex-direction: column;
        gap: 1px;
        padding-left: 8px;
        border-left: 1px solid rgba(0, 0, 0, 0.15);
        min-width: 55px;
      }

      .pc-stat {
        display: flex;
        gap: 3px;
        font-size: 10px;
        justify-content: flex-end;
      }

      .pc-stat-label {
        font-weight: bold;
        text-transform: uppercase;
      }

      .pc-stat-label.str { color: #8b4444; }
      .pc-stat-label.int { color: #6b4488; }
      .pc-stat-label.agi { color: #448844; }
      .pc-stat-label.vit { color: #aa7733; }
      .pc-stat-label.lck { color: #aa8833; }

      .pc-stat-value {
        color: #2d2418;
        font-family: 'Consolas', 'Monaco', monospace;
        font-weight: bold;
        min-width: 24px;
        text-align: right;
      }

      /* Empty State */
      .pc-empty-state {
        color: #5a4a3a;
        text-align: center;
        padding: 16px 12px;
        font-size: 11px;
        font-style: italic;
      }

      /* Detailed mode adjustments */
      .parchment-card.parchment-card--detailed {
        padding: 10px 12px;
      }

      .parchment-card--detailed .pc-portrait-container {
        width: 64px;
        height: 64px;
      }

      .parchment-card--detailed .pc-name {
        font-size: 14px;
      }

      .parchment-card--detailed .pc-bar-row {
        height: 16px;
      }

      .parchment-card--detailed .pc-bar-wrapper {
        height: 12px;
      }
    `;
    document.head.appendChild(style);
  }

  getEmptyStateHTML() {
    return `<div class="pc-empty-state">Select a character</div>`;
  }

  setCharacter(character) {
    // Skip if same character AND no HP/MP changes (prevent flicker on mouse move)
    if (this.character && character && this.character.id === character.id) {
      // Compare against lastKnownValues, not the object itself (object may be mutated in place)
      const currentHp = character.hp_current ?? character.hp ?? 0;
      const currentMp = character.mp_current ?? character.mp ?? 0;
      const needsUpdate =
        this.lastKnownValues.hp !== currentHp ||
        this.lastKnownValues.mp !== currentMp;
      if (!needsUpdate) return;
    }
    this.character = character;
    this.render();

    // Store current values for future comparison
    this.lastKnownValues.hp = character?.hp_current ?? character?.hp ?? 0;
    this.lastKnownValues.mp = character?.mp_current ?? character?.mp ?? 0;
  }

  update(updates) {
    if (!this.character) return;
    Object.assign(this.character, updates);
    this.render();
  }

  render() {
    if (!this.character) {
      this.element.classList.add('empty');
      this.element.innerHTML = this.getEmptyStateHTML();
      return;
    }

    this.element.classList.remove('empty', 'hidden');
    const c = this.character;

    // Calculate HP/MP
    const hpMax = c.hp_max || c.maxHp || c.max_hp || 1;
    const mpMax = c.mp_max || c.maxMp || c.max_mp || 1;
    const hpCurrent = c.hp_current ?? c.hp ?? c.currentHp ?? 0;
    const mpCurrent = c.mp_current ?? c.mp ?? c.currentMp ?? 0;
    const hpPercent = Math.min(100, Math.max(0, (hpCurrent / hpMax) * 100));
    const mpPercent = Math.min(100, Math.max(0, (mpCurrent / mpMax) * 100));

    // HP status for bar color
    const hpStatus = hpPercent > 50 ? '' : hpPercent > 25 ? 'warning' : 'critical';

    // Character info
    const name = c.name || 'Unknown';
    const level = c.level || 1;
    const race = c.race || '';
    const charClass = c.class || c.type || 'unknown';
    const gender = c.gender || 'other';

    // Build subtitle based on type
    let subtitle = '';
    if (this.type === 'enemy') {
      subtitle = `Lv.${level} ${this.capitalize(charClass)}`;
    } else {
      subtitle = race
        ? `Lv.${level} ${this.capitalize(race)} ${this.capitalize(charClass)}`
        : `Lv.${level} ${this.capitalize(charClass)}`;
    }

    // Portrait URL
    const portraitUrl = this.type === 'enemy'
      ? `/assets/sprites/enemies/${charClass}.png`
      : `/assets/sprites/portraits/${race}_${gender}_${charClass}.png`;

    // Class colors for fallback
    const classColors = {
      warrior: '#8b4444', wizard: '#6b4488', monk: '#aa7733', chemist: '#448844',
      knight: '#5555aa', berserker: '#aa3333', sage: '#338888', ninja: '#555566',
      monster: '#665544', goblin: '#558844', wolf: '#666666', slime: '#44aa44'
    };
    const fallbackColor = classColors[charClass.toLowerCase()] || '#666655';
    const fallbackLetter = name.charAt(0).toUpperCase();

    // Update element class for mode
    this.element.className = `parchment-card parchment-card--${this.type}`;
    if (this.mode === 'detailed') {
      this.element.classList.add('parchment-card--detailed');
    }

    // Build HTML
    let html = '<div class="pc-content">';

    // Portrait section
    if (this.showPortrait) {
      html += `
        <div class="pc-portrait-section">
          <div class="pc-portrait-container">
            <img
              class="pc-portrait"
              src="${portraitUrl}"
              alt="${this.escapeHtml(name)}"
              onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
            >
            <div class="pc-portrait-fallback" style="display: none; background: ${fallbackColor};">
              ${fallbackLetter}
            </div>
          </div>
        </div>
      `;
    }

    // Info section (name, subtitle, bars)
    html += `
      <div class="pc-info">
        <div class="pc-name">${this.escapeHtml(name)}</div>
        <div class="pc-subtitle">${subtitle}</div>
        <div class="pc-bar-row">
          <span class="pc-bar-label hp">HP</span>
          <div class="pc-bar-wrapper">
            <div class="pc-bar-fill hp ${hpStatus}" style="width: ${hpPercent}%;"></div>
            <span class="pc-bar-value-inside">${hpCurrent}/${hpMax}</span>
          </div>
        </div>
        <div class="pc-bar-row">
          <span class="pc-bar-label mp">MP</span>
          <div class="pc-bar-wrapper">
            <div class="pc-bar-fill mp" style="width: ${mpPercent}%;"></div>
            <span class="pc-bar-value-inside">${mpCurrent}/${mpMax}</span>
          </div>
        </div>
      </div>
    `;

    // Stats section
    if (this.showStats) {
      const str = c.strength ?? c.str ?? 0;
      const int = c.intelligence ?? c.int ?? 0;
      const agi = c.agility ?? c.agi ?? 0;
      const vit = c.vitality ?? c.vit ?? 0;
      const lck = c.luck ?? c.lck ?? 0;

      html += `
        <div class="pc-stats">
          <div class="pc-stat"><span class="pc-stat-label str">STR</span><span class="pc-stat-value">${str}</span></div>
          <div class="pc-stat"><span class="pc-stat-label agi">AGI</span><span class="pc-stat-value">${agi}</span></div>
          <div class="pc-stat"><span class="pc-stat-label int">INT</span><span class="pc-stat-value">${int}</span></div>
          <div class="pc-stat"><span class="pc-stat-label vit">VIT</span><span class="pc-stat-value">${vit}</span></div>
          <div class="pc-stat"><span class="pc-stat-label lck">LCK</span><span class="pc-stat-value">${lck}</span></div>
        </div>
      `;
    }

    html += '</div>';
    this.element.innerHTML = html;
  }

  show() {
    this.element.classList.remove('hidden');
  }

  hide() {
    this.element.classList.add('hidden');
  }

  capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.character = null;
  }
}
