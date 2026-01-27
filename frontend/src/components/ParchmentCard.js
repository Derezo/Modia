import { getAssetPath, getOptimalSize } from '@shared/assetPaths.js';

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
    this.damagePreviewElement = null;
    // Track last known values for change detection (objects may be mutated in place)
    this.lastKnownValues = { hp_current: null, mp_current: null };

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

      /* Damage Preview Overlay */
      .pc-damage-preview {
        position: absolute;
        top: -8px;
        left: -8px;
        background:
          linear-gradient(135deg, rgba(180, 160, 130, 0.15) 0%, transparent 50%),
          linear-gradient(to bottom, #e8dcc8 0%, #d9ccb8 50%, #cfc0a8 100%);
        border: 2px solid #7a6548;
        border-radius: 4px;
        padding: 6px 10px;
        box-shadow:
          0 2px 6px rgba(0, 0, 0, 0.25),
          inset 0 1px 0 rgba(255, 255, 255, 0.4);
        font-family: 'Georgia', 'Times New Roman', serif;
        z-index: 10;
        min-width: 90px;
        opacity: 0;
        transform: translateY(-4px);
        transition: opacity 0.15s ease, transform 0.15s ease;
        pointer-events: none;
      }

      .pc-damage-preview.visible {
        opacity: 1;
        transform: translateY(0);
      }

      .pc-damage-preview--kill {
        border-color: #8b4444;
        background:
          linear-gradient(135deg, rgba(180, 130, 130, 0.2) 0%, transparent 50%),
          linear-gradient(to bottom, #e8dcc8 0%, #d9ccb8 50%, #cfc0a8 100%);
      }

      .pc-damage-preview--heal {
        border-color: #4a7548;
        background:
          linear-gradient(135deg, rgba(130, 180, 130, 0.15) 0%, transparent 50%),
          linear-gradient(to bottom, #e8dcc8 0%, #d9ccb8 50%, #cfc0a8 100%);
      }

      .pc-dmg-row {
        display: flex;
        align-items: baseline;
        gap: 6px;
        margin-bottom: 3px;
      }

      .pc-dmg-row:last-child {
        margin-bottom: 0;
      }

      .pc-dmg-range {
        font-size: 15px;
        font-weight: bold;
        color: #5a3a28;
        font-family: 'Consolas', 'Monaco', monospace;
        letter-spacing: -0.5px;
      }

      .pc-dmg-range--kill {
        color: #8b3030;
      }

      .pc-dmg-range--heal {
        color: #3a6830;
      }

      .pc-dmg-label {
        font-size: 9px;
        color: #6a5a48;
        text-transform: uppercase;
        font-weight: bold;
        letter-spacing: 0.5px;
      }

      .pc-dmg-kill {
        font-size: 9px;
        font-weight: bold;
        color: #8b3030;
        text-transform: uppercase;
        margin-left: auto;
        padding: 1px 4px;
        background: rgba(139, 48, 48, 0.15);
        border-radius: 2px;
      }

      .pc-dmg-secondary {
        display: flex;
        gap: 10px;
        font-size: 10px;
        color: #5a4a38;
      }

      .pc-dmg-hit {
        color: #4a6040;
      }

      .pc-dmg-hit.warning {
        color: #8a6a30;
      }

      .pc-dmg-hit.low {
        color: #8a4a30;
      }

      .pc-dmg-crit {
        color: #6a4a68;
      }
    `;
    document.head.appendChild(style);
  }

  getEmptyStateHTML() {
    return '<div class="pc-empty-state">Select a character</div>';
  }

  setCharacter(character) {
    // Skip if same character AND no HP/MP changes (prevent flicker on mouse move)
    if (this.character && character && this.character.id === character.id) {
      // Compare against lastKnownValues, not the object itself (object may be mutated in place)
      const currentHp = character.hp_current ?? 0;
      const currentMp = character.mp_current ?? 0;
      const needsUpdate =
        this.lastKnownValues.hp_current !== currentHp ||
        this.lastKnownValues.mp_current !== currentMp;
      if (!needsUpdate) return;
    }
    this.character = character;
    this.render();

    // Store current values for future comparison
    this.lastKnownValues.hp_current = character?.hp_current ?? 0;
    this.lastKnownValues.mp_current = character?.mp_current ?? 0;
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
    const hpMax = c.hp_max || 1;
    const mpMax = c.mp_max || 1;
    const hpCurrent = c.hp_current ?? 0;
    const mpCurrent = c.mp_current ?? 0;
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
    // Enemy sprite identifier (sprite_id from database, stored as enemyId on units)
    const enemySpriteId = c.enemyId || c.sprite_id || '';

    // Build subtitle based on type
    let subtitle = '';
    if (this.type === 'enemy') {
      subtitle = `Lv.${level} ${this.capitalize(charClass)}`;
    } else {
      subtitle = race
        ? `Lv.${level} ${this.capitalize(race)} ${this.capitalize(charClass)}`
        : `Lv.${level} ${this.capitalize(charClass)}`;
    }

    // Portrait URL - enemies use their sprite_id, players use race_gender_class
    // Display size is 56px, optimal size is 64px
    const optimalSize = getOptimalSize('portraits', 56);
    const portraitUrl = this.type === 'enemy'
      ? getAssetPath('portraits', enemySpriteId || charClass, { subcategory: 'enemies', size: optimalSize })
      : getAssetPath('portraits', `${race}_${gender}_${charClass}`, { size: optimalSize });

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

  /**
   * Show damage preview overlay on the card
   * @param {Object} data - Preview data from DamagePreview calculations
   * @param {number} data.minDamage - Minimum damage (or minHeal for healing)
   * @param {number} data.maxDamage - Maximum damage (or maxHeal for healing)
   * @param {number} data.hitChance - Hit chance (0-1)
   * @param {number} data.critChance - Critical hit chance (0-1)
   * @param {number} data.critDamage - Damage on critical hit
   * @param {boolean} data.willKill - Whether this would kill the target
   * @param {string} data.type - 'physical', 'magical', or 'heal'
   */
  showDamagePreview(data) {
    if (!data) return;

    // Create damage preview element if it doesn't exist
    if (!this.damagePreviewElement) {
      this.damagePreviewElement = document.createElement('div');
      this.damagePreviewElement.className = 'pc-damage-preview';
      this.element.style.position = 'relative';
      this.element.appendChild(this.damagePreviewElement);
    }

    const isHeal = data.type === 'heal';
    const min = isHeal ? data.minHeal : data.minDamage;
    const max = isHeal ? data.maxHeal : data.maxDamage;
    const hitPercent = Math.round(data.hitChance * 100);
    const critPercent = Math.round((data.critChance || 0) * 100);

    // Determine hit chance styling
    let hitClass = '';
    if (hitPercent < 70) hitClass = 'low';
    else if (hitPercent < 90) hitClass = 'warning';

    // Build HTML
    let html = '<div class="pc-dmg-row">';

    if (isHeal) {
      html += `<span class="pc-dmg-range pc-dmg-range--heal">+${min}-${max}</span>`;
      html += '<span class="pc-dmg-label">HP</span>';
      if (data.isOverheal) {
        html += '<span class="pc-dmg-label" style="color: #8a7a60;">(overheal)</span>';
      }
    } else {
      html += `<span class="pc-dmg-range ${data.willKill ? 'pc-dmg-range--kill' : ''}">${min}-${max}</span>`;
      html += '<span class="pc-dmg-label">dmg</span>';
      if (data.willKill) {
        html += '<span class="pc-dmg-kill">Kill</span>';
      }
    }

    html += '</div>';

    // Secondary row: hit chance and crit info
    if (!isHeal) {
      html += '<div class="pc-dmg-secondary">';
      html += `<span class="pc-dmg-hit ${hitClass}">${hitPercent}% hit</span>`;
      if (critPercent > 0) {
        html += `<span class="pc-dmg-crit">${critPercent}% crit \u2192 ${data.critDamage}</span>`;
      }
      html += '</div>';
    }

    this.damagePreviewElement.innerHTML = html;

    // Update modifier classes
    this.damagePreviewElement.classList.remove('pc-damage-preview--kill', 'pc-damage-preview--heal');
    if (isHeal) {
      this.damagePreviewElement.classList.add('pc-damage-preview--heal');
    } else if (data.willKill) {
      this.damagePreviewElement.classList.add('pc-damage-preview--kill');
    }

    // Show with animation
    requestAnimationFrame(() => {
      this.damagePreviewElement.classList.add('visible');
    });
  }

  /**
   * Hide damage preview overlay
   */
  hideDamagePreview() {
    if (this.damagePreviewElement) {
      this.damagePreviewElement.classList.remove('visible');
    }
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
    this.damagePreviewElement = null;
    this.character = null;
  }
}
