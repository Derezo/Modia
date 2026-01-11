import { Scene } from './Scene.js';
import { InventoryPanel } from '../components/InventoryPanel.js';
import { SkillTreePanel } from '../components/SkillTreePanel.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { PARCHMENT_COLORS, getParchmentGradient } from '../ui/parchment/ParchmentTheme.js';
import { responsive } from '../core/Responsive.js';
import { Icon } from '../components/Icon.js';

/**
 * FormationScene - Party management, equipment, and skills hub
 * Uses parchment theme for medieval manuscript aesthetic
 */
export class FormationScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.characters = [];
    this.selectedCharacter = null;
    this.activePanel = null; // 'stats' | 'equipment' | 'skills'
    this.abortController = null;
    this.inventoryPanel = null;
    this.skillTreePanel = null;
    this.responsiveUnsubscribe = null;
  }

  async enter() {
    await this.loadCharacters();
    this.createUI();
    this.setupEventListeners();

    // Subscribe to responsive breakpoint changes
    this.responsiveUnsubscribe = responsive.onChange(() => this.onBreakpointChange());
  }

  exit() {
    if (this.responsiveUnsubscribe) {
      this.responsiveUnsubscribe();
      this.responsiveUnsubscribe = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.inventoryPanel) {
      this.inventoryPanel.destroy();
      this.inventoryPanel = null;
    }
    if (this.skillTreePanel) {
      this.skillTreePanel.destroy();
      this.skillTreePanel = null;
    }
    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
  }

  /**
   * Handle responsive breakpoint changes
   */
  onBreakpointChange() {
    // Re-render UI to adapt to new breakpoint
    if (this.uiElement) {
      const selectedId = this.selectedCharacter?.id;
      const activeTab = this.activePanel;

      this.uiElement.remove();
      this.createUI();
      this.setupEventListeners();

      // Restore selection if there was one
      if (selectedId) {
        this.selectCharacter(selectedId);
        if (activeTab) {
          this.switchTab(activeTab);
        }
      }
    }
  }

  async loadCharacters() {
    try {
      const result = await this.game.api.getCharacters();
      this.characters = result.characters || [];
    } catch (err) {
      console.error('Failed to load characters:', err);
      parchmentToast.error('Failed to load characters', err.message);
    }
  }

  createUI() {
    const container = document.createElement('div');
    container.id = 'formation-scene';
    const isMobile = responsive.isMobile();
    const gridCols = isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)';
    const leftPanelWidth = isMobile ? '100%' : '320px';
    const flexDirection = isMobile ? 'column' : 'row';

    container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: ${getParchmentGradient('135deg')};
      display: flex;
      flex-direction: column;
      font-family: Georgia, serif;
    `;

    container.innerHTML = `
      <!-- Header -->
      <div style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 20px;
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.dark}, ${PARCHMENT_COLORS.borderDark});
        border-bottom: 2px solid ${PARCHMENT_COLORS.borderDark};
      ">
        <h2 style="margin: 0; color: ${PARCHMENT_COLORS.accent.gold}; font-size: 20px; text-shadow: 1px 1px 2px rgba(0,0,0,0.3);">
          ${Icon.html('menu', 'formation', { size: 'lg' })}
          ${responsive.showLabels() ? 'Party Formation' : ''}
        </h2>
        <button class="parchment-btn parchment-btn-secondary" id="back-btn">
          ${Icon.html('action', 'back', { label: responsive.showLabels() ? 'Back to Map' : '', size: 'md' })}
        </button>
      </div>

      <!-- Main Content -->
      <div style="
        display: flex;
        flex-direction: ${flexDirection};
        flex: 1;
        padding: 16px;
        gap: 16px;
        overflow: hidden;
      ">
        <!-- Left Panel: Character Grid -->
        <div class="parchment-panel" style="width: ${leftPanelWidth}; ${isMobile ? 'max-height: 40%;' : ''} display: flex; flex-direction: column;">
          <div class="parchment-panel-header">Party (${this.characters.length}/12)</div>
          <div style="padding: 8px; font-size: 11px; color: ${PARCHMENT_COLORS.text.secondary}; border-bottom: 1px solid ${PARCHMENT_COLORS.border}; background: ${PARCHMENT_COLORS.mid};">
            Slots 1-5 are your battle party
          </div>
          <div id="character-grid" style="
            flex: 1;
            overflow-y: auto;
            padding: 8px;
            display: grid;
            grid-template-columns: ${gridCols};
            gap: 8px;
            background: ${PARCHMENT_COLORS.light};
          ">
            ${this.renderCharacterGrid()}
          </div>
        </div>

        <!-- Right Panel: Character Details -->
        <div class="parchment-panel" style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
          <div class="parchment-panel-header">
            <span id="detail-title">Select a Character</span>
          </div>

          <!-- Tab Navigation -->
          <div id="tab-nav" style="
            display: none;
            border-bottom: 1px solid ${PARCHMENT_COLORS.border};
            background: ${PARCHMENT_COLORS.mid};
          ">
            <button class="parchment-tab-btn active" data-tab="stats">
              ${Icon.html('menu', 'stats', { label: responsive.showLabels() ? 'Stats' : '', size: 'sm' })}
            </button>
            <button class="parchment-tab-btn" data-tab="equipment">
              ${Icon.html('menu', 'inventory', { label: responsive.showLabels() ? 'Equipment' : '', size: 'sm' })}
            </button>
            <button class="parchment-tab-btn" data-tab="skills">
              ${Icon.html('menu', 'skills', { label: responsive.showLabels() ? 'Skills' : '', size: 'sm' })}
            </button>
          </div>

          <!-- Tab Content -->
          <div id="detail-content" style="flex: 1; overflow-y: auto; padding: 16px; background: ${PARCHMENT_COLORS.light};">
            <div style="color: ${PARCHMENT_COLORS.text.muted}; text-align: center; padding: 40px;">
              Click a character to view details
            </div>
          </div>
        </div>
      </div>
    `;

    // Add styles
    this.addStyles();

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;
  }

  addStyles() {
    if (document.getElementById('formation-styles')) return;

    const style = document.createElement('style');
    style.id = 'formation-styles';
    style.textContent = `
      /* Parchment Panel Styles */
      .parchment-panel {
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.light}, ${PARCHMENT_COLORS.mid});
        border: 2px solid ${PARCHMENT_COLORS.border};
        border-radius: 4px;
        box-shadow: 0 3px 8px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.3);
        overflow: hidden;
      }
      .parchment-panel-header {
        padding: 10px 14px;
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.dark}, ${PARCHMENT_COLORS.borderDark});
        border-bottom: 1px solid ${PARCHMENT_COLORS.borderDark};
        color: ${PARCHMENT_COLORS.accent.gold};
        font-weight: bold;
        font-size: 14px;
        text-shadow: 1px 1px 1px rgba(0,0,0,0.3);
      }

      /* Parchment Button Styles */
      .parchment-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        font-family: Georgia, serif;
        font-size: 13px;
        border: 2px solid ${PARCHMENT_COLORS.border};
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s ease;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }
      .parchment-btn-secondary {
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.light}, ${PARCHMENT_COLORS.mid});
        color: ${PARCHMENT_COLORS.text.primary};
      }
      .parchment-btn-secondary:hover {
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.mid}, ${PARCHMENT_COLORS.dark});
        border-color: ${PARCHMENT_COLORS.borderDark};
      }

      /* Parchment Tab Button Styles */
      .parchment-tab-btn {
        flex: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 10px 12px;
        background: transparent;
        border: none;
        border-bottom: 3px solid transparent;
        color: ${PARCHMENT_COLORS.text.secondary};
        font-family: Georgia, serif;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .parchment-tab-btn:hover {
        color: ${PARCHMENT_COLORS.text.primary};
        background: rgba(0, 0, 0, 0.05);
      }
      .parchment-tab-btn.active {
        color: ${PARCHMENT_COLORS.accent.gold};
        border-bottom-color: ${PARCHMENT_COLORS.accent.gold};
        font-weight: bold;
      }

      /* Character Slot Styles - Parchment Theme */
      .character-slot {
        aspect-ratio: 1;
        background: ${PARCHMENT_COLORS.mid};
        border: 2px solid ${PARCHMENT_COLORS.border};
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        padding: 4px;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.3);
      }
      .character-slot:hover {
        border-color: ${PARCHMENT_COLORS.accent.gold};
        background: ${PARCHMENT_COLORS.dark};
      }
      .character-slot.selected {
        border-color: ${PARCHMENT_COLORS.accent.gold};
        background: linear-gradient(to bottom, #e8d9a8, #d4c498);
        box-shadow: 0 0 8px rgba(201, 162, 39, 0.4);
      }
      .character-slot.battle-party {
        border-color: ${PARCHMENT_COLORS.state.success};
      }
      .character-slot.empty {
        border-style: dashed;
        opacity: 0.6;
        background: ${PARCHMENT_COLORS.light};
      }
      .character-slot .char-icon {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        color: #fff;
        margin-bottom: 4px;
        border: 2px solid rgba(0,0,0,0.2);
      }
      .character-slot .char-name {
        font-size: 10px;
        color: ${PARCHMENT_COLORS.text.primary};
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        width: 100%;
        font-weight: bold;
      }
      .character-slot .char-level {
        font-size: 9px;
        color: ${PARCHMENT_COLORS.text.secondary};
      }

      /* Stats Panel Styles - Parchment Theme */
      .stat-row {
        display: flex;
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px solid ${PARCHMENT_COLORS.border};
      }
      .stat-label {
        color: ${PARCHMENT_COLORS.text.secondary};
      }
      .stat-value {
        color: ${PARCHMENT_COLORS.text.primary};
        font-weight: bold;
      }

      /* Equipment Slot Styles - Parchment Theme */
      .equipment-slot {
        display: flex;
        align-items: center;
        padding: 12px;
        background: ${PARCHMENT_COLORS.mid};
        border: 1px solid ${PARCHMENT_COLORS.border};
        border-radius: 4px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .equipment-slot:hover {
        background: ${PARCHMENT_COLORS.dark};
        border-color: ${PARCHMENT_COLORS.accent.gold};
      }
      .equipment-slot .slot-icon {
        width: 40px;
        height: 40px;
        background: ${PARCHMENT_COLORS.light};
        border: 1px solid ${PARCHMENT_COLORS.border};
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: 12px;
        font-size: 20px;
      }
      .equipment-slot .slot-info {
        flex: 1;
      }
      .equipment-slot .slot-name {
        color: ${PARCHMENT_COLORS.text.primary};
        font-weight: bold;
      }
      .equipment-slot .slot-item {
        font-size: 12px;
        color: ${PARCHMENT_COLORS.text.secondary};
      }

      /* Skill Item Styles - Parchment Theme */
      .skill-item {
        display: flex;
        align-items: center;
        padding: 12px;
        background: ${PARCHMENT_COLORS.mid};
        border: 1px solid ${PARCHMENT_COLORS.border};
        border-radius: 4px;
        margin-bottom: 8px;
      }
      .skill-icon {
        width: 40px;
        height: 40px;
        background: linear-gradient(135deg, ${PARCHMENT_COLORS.state.info}, #3a5068);
        border-radius: 4px;
        border: 1px solid ${PARCHMENT_COLORS.borderDark};
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: 12px;
        font-size: 18px;
        color: #fff;
      }
      .skill-info {
        flex: 1;
      }
      .skill-name {
        color: ${PARCHMENT_COLORS.text.primary};
        font-weight: bold;
      }
      .skill-desc {
        font-size: 11px;
        color: ${PARCHMENT_COLORS.text.secondary};
      }

      /* XP Bar - Parchment Theme */
      .xp-bar {
        height: 6px;
        background: ${PARCHMENT_COLORS.borderDark};
        border-radius: 3px;
        margin-top: 8px;
        overflow: hidden;
        border: 1px solid ${PARCHMENT_COLORS.border};
      }
      .xp-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, ${PARCHMENT_COLORS.state.success}, #6a9548);
        transition: width 0.3s;
      }
    `;
    document.head.appendChild(style);
  }

  renderCharacterGrid() {
    let html = '';

    // Render existing characters
    for (let i = 0; i < 12; i++) {
      const char = this.characters.find(c => c.party_slot === i + 1);
      const isBattleParty = i < 5;
      const isSelected = this.selectedCharacter?.id === char?.id;

      if (char) {
        const classColor = this.getClassColor(char.class);
        html += `
          <div class="character-slot ${isBattleParty ? 'battle-party' : ''} ${isSelected ? 'selected' : ''}"
               data-character-id="${char.id}">
            <div class="char-icon" style="background: ${classColor};">
              ${this.getClassIcon(char.class)}
            </div>
            <div class="char-name">${char.name}</div>
            <div class="char-level">Lv.${char.level}</div>
          </div>
        `;
      } else {
        html += `
          <div class="character-slot empty ${isBattleParty ? 'battle-party' : ''}" data-slot="${i + 1}">
            <div style="color: ${PARCHMENT_COLORS.text.muted}; font-size: 20px;">+</div>
            <div class="char-name" style="color: ${PARCHMENT_COLORS.text.muted};">Empty</div>
          </div>
        `;
      }
    }

    return html;
  }

  setupEventListeners() {
    this.abortController = new AbortController();
    const opts = { signal: this.abortController.signal };

    // Back button
    this.uiElement.querySelector('#back-btn')?.addEventListener('click', () => {
      this.game.scenes.switchTo('worldMap');
    }, opts);

    // Character slots
    this.uiElement.querySelectorAll('.character-slot').forEach(slot => {
      slot.addEventListener('click', (e) => {
        const charId = slot.dataset.characterId;
        if (charId) {
          this.selectCharacter(parseInt(charId));
        }
      }, opts);
    });

    // Tab buttons
    this.uiElement.querySelectorAll('.parchment-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.dataset.tab);
      }, opts);
    });
  }

  selectCharacter(characterId) {
    this.selectedCharacter = this.characters.find(c => c.id === characterId);

    if (!this.selectedCharacter) return;

    // Update grid selection
    this.uiElement.querySelectorAll('.character-slot').forEach(slot => {
      slot.classList.remove('selected');
      if (parseInt(slot.dataset.characterId) === characterId) {
        slot.classList.add('selected');
      }
    });

    // Show tabs
    this.uiElement.querySelector('#tab-nav').style.display = 'flex';

    // Update title
    this.uiElement.querySelector('#detail-title').textContent = this.selectedCharacter.name;

    // Show stats tab by default
    this.switchTab('stats');
  }

  switchTab(tabName) {
    this.activePanel = tabName;

    // Cleanup previous panels when switching
    if (tabName !== 'equipment' && this.inventoryPanel) {
      this.inventoryPanel.destroy();
      this.inventoryPanel = null;
    }
    if (tabName !== 'skills' && this.skillTreePanel) {
      this.skillTreePanel.destroy();
      this.skillTreePanel = null;
    }

    // Update tab buttons
    this.uiElement.querySelectorAll('.parchment-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Render content
    const content = this.uiElement.querySelector('#detail-content');
    switch (tabName) {
      case 'stats':
        content.innerHTML = this.renderStatsPanel();
        break;
      case 'equipment':
        content.innerHTML = this.renderEquipmentPanel();
        this.loadEquipmentPanel();
        break;
      case 'skills':
        content.innerHTML = this.renderSkillsPanel();
        this.loadSkillsPanel();
        break;
    }
  }

  renderStatsPanel() {
    const char = this.selectedCharacter;
    if (!char) return '';

    const hpPercent = (char.hp_current / char.hp_max) * 100;
    const mpPercent = (char.mp_current / char.mp_max) * 100;

    return `
      <div style="margin-bottom: 24px;">
        <div style="display: flex; align-items: center; margin-bottom: 16px;">
          <div class="char-icon" style="
            width: 64px;
            height: 64px;
            font-size: 24px;
            background: ${this.getClassColor(char.class)};
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            margin-right: 16px;
            border: 3px solid ${PARCHMENT_COLORS.border};
          ">
            ${this.getClassIcon(char.class)}
          </div>
          <div>
            <div style="font-size: 18px; font-weight: bold; color: ${PARCHMENT_COLORS.text.primary};">${char.name}</div>
            <div style="color: ${PARCHMENT_COLORS.text.secondary};">${this.capitalize(char.race)} ${this.capitalize(char.class)}</div>
            <div style="color: ${PARCHMENT_COLORS.accent.gold}; font-weight: bold;">Level ${char.level}</div>
          </div>
        </div>

        <!-- HP Bar -->
        <div style="margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: ${PARCHMENT_COLORS.text.secondary};">HP</span>
            <span style="color: ${PARCHMENT_COLORS.text.primary}; font-weight: bold;">${char.hp_current} / ${char.hp_max}</span>
          </div>
          <div style="height: 8px; background: ${PARCHMENT_COLORS.borderDark}; border-radius: 4px; overflow: hidden; border: 1px solid ${PARCHMENT_COLORS.border};">
            <div style="height: 100%; width: ${hpPercent}%; background: linear-gradient(90deg, ${PARCHMENT_COLORS.state.error}, ${PARCHMENT_COLORS.state.success});"></div>
          </div>
        </div>

        <!-- MP Bar -->
        <div style="margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: ${PARCHMENT_COLORS.text.secondary};">MP</span>
            <span style="color: ${PARCHMENT_COLORS.text.primary}; font-weight: bold;">${char.mp_current} / ${char.mp_max}</span>
          </div>
          <div style="height: 8px; background: ${PARCHMENT_COLORS.borderDark}; border-radius: 4px; overflow: hidden; border: 1px solid ${PARCHMENT_COLORS.border};">
            <div style="height: 100%; width: ${mpPercent}%; background: ${PARCHMENT_COLORS.state.info};"></div>
          </div>
        </div>

        <!-- XP Bar -->
        <div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: ${PARCHMENT_COLORS.text.secondary};">Experience</span>
            <span style="color: ${PARCHMENT_COLORS.text.primary}; font-weight: bold;">${char.experience || 0}</span>
          </div>
          <div class="xp-bar">
            <div class="xp-bar-fill" style="width: ${this.getXPProgress(char)}%;"></div>
          </div>
        </div>
      </div>

      <div style="padding: 10px 14px; background: linear-gradient(to bottom, ${PARCHMENT_COLORS.dark}, ${PARCHMENT_COLORS.borderDark}); border-radius: 4px; margin-bottom: 12px; color: ${PARCHMENT_COLORS.accent.gold}; font-weight: bold; text-shadow: 1px 1px 1px rgba(0,0,0,0.3);">Base Stats</div>
      <div class="stat-row">
        <span class="stat-label">Strength</span>
        <span class="stat-value">${char.strength}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Intelligence</span>
        <span class="stat-value">${char.intelligence}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Agility</span>
        <span class="stat-value">${char.agility}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Vitality</span>
        <span class="stat-value">${char.vitality}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Luck</span>
        <span class="stat-value">${char.luck}</span>
      </div>
    `;
  }

  renderEquipmentPanel() {
    // Return a container div that the InventoryPanel will populate
    return '<div id="equipment-panel-container" style="height: 100%;"></div>';
  }

  async loadEquipmentPanel() {
    const container = this.uiElement.querySelector('#equipment-panel-container');
    if (!container || !this.selectedCharacter) return;

    // Destroy previous instance if exists
    if (this.inventoryPanel) {
      this.inventoryPanel.destroy();
    }

    // Create new inventory panel
    this.inventoryPanel = new InventoryPanel(this.game, container);
    this.inventoryPanel.setCharacterStats(this.selectedCharacter);
    await this.inventoryPanel.load(this.selectedCharacter.id);
  }

  renderSkillsPanel() {
    // Return a container div that the SkillTreePanel will populate
    return '<div id="skills-panel-container" style="height: 100%;"></div>';
  }

  async loadSkillsPanel() {
    const container = this.uiElement.querySelector('#skills-panel-container');
    if (!container || !this.selectedCharacter) return;

    // Destroy previous instance if exists
    if (this.skillTreePanel) {
      this.skillTreePanel.destroy();
    }

    // Create new skill tree panel
    this.skillTreePanel = new SkillTreePanel(this.game, container);
    await this.skillTreePanel.load(this.selectedCharacter.id, this.selectedCharacter.class);
  }

  getClassColor(className) {
    const colors = {
      warrior: '#c62828',
      wizard: '#1565c0',
      monk: '#f9a825',
      chemist: '#2e7d32'
    };
    return colors[className] || '#666';
  }

  getClassIcon(className) {
    const icons = {
      warrior: 'W',
      wizard: 'M',
      monk: 'K',
      chemist: 'C'
    };
    return icons[className] || '?';
  }

  getXPProgress(char) {
    // Simple XP progress calculation
    const xpForNextLevel = Math.floor(100 * Math.pow(char.level, 2.2));
    const currentXP = char.experience || 0;
    return Math.min(100, (currentXP / xpForNextLevel) * 100);
  }

  capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }

  update(deltaTime) {
    // No per-frame updates needed
  }

  render(ctx) {
    // UI is HTML-based, no canvas rendering needed
    // Draw parchment background for any canvas elements
    ctx.fillStyle = PARCHMENT_COLORS.mid;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
