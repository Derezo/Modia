import { Scene } from './Scene.js';
import { InventoryPanel } from '../components/InventoryPanel.js';
import { SkillTreePanel } from '../components/SkillTreePanel.js';

/**
 * FormationScene - Party management, equipment, and skills hub
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
  }

  async enter() {
    await this.loadCharacters();
    this.createUI();
    this.setupEventListeners();
  }

  exit() {
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

  async loadCharacters() {
    try {
      const result = await this.game.api.getCharacters();
      this.characters = result.characters || [];
    } catch (err) {
      console.error('Failed to load characters:', err);
      this.game.showNotification('Failed to load characters', 'error');
    }
  }

  createUI() {
    const container = document.createElement('div');
    container.id = 'formation-scene';
    container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      display: flex;
      flex-direction: column;
    `;

    container.innerHTML = `
      <!-- Header -->
      <div style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 24px;
        background: rgba(0,0,0,0.3);
        border-bottom: 1px solid #3a3a5a;
      ">
        <h2 style="margin: 0; color: #ffd700;">Party Formation</h2>
        <button class="btn btn-secondary" id="back-btn">Back to Map</button>
      </div>

      <!-- Main Content -->
      <div style="
        display: flex;
        flex: 1;
        padding: 16px;
        gap: 16px;
        overflow: hidden;
      ">
        <!-- Left Panel: Character Grid -->
        <div class="ui-panel" style="width: 320px; display: flex; flex-direction: column;">
          <div class="ui-panel-header">Party (${this.characters.length}/12)</div>
          <div style="padding: 8px; font-size: 11px; color: #8a8aaa; border-bottom: 1px solid #3a3a5a;">
            Slots 1-5 are your battle party
          </div>
          <div id="character-grid" style="
            flex: 1;
            overflow-y: auto;
            padding: 8px;
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
          ">
            ${this.renderCharacterGrid()}
          </div>
        </div>

        <!-- Right Panel: Character Details -->
        <div class="ui-panel" style="flex: 1; display: flex; flex-direction: column;">
          <div class="ui-panel-header">
            <span id="detail-title">Select a Character</span>
          </div>

          <!-- Tab Navigation -->
          <div id="tab-nav" style="
            display: flex;
            border-bottom: 1px solid #3a3a5a;
            display: none;
          ">
            <button class="tab-btn active" data-tab="stats">Stats</button>
            <button class="tab-btn" data-tab="equipment">Equipment</button>
            <button class="tab-btn" data-tab="skills">Skills</button>
          </div>

          <!-- Tab Content -->
          <div id="detail-content" style="flex: 1; overflow-y: auto; padding: 16px;">
            <div style="color: #8a8aaa; text-align: center; padding: 40px;">
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
      .character-slot {
        aspect-ratio: 1;
        background: rgba(0,0,0,0.3);
        border: 2px solid #3a3a5a;
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        padding: 4px;
      }
      .character-slot:hover {
        border-color: #6ab0f3;
        background: rgba(74, 144, 217, 0.2);
      }
      .character-slot.selected {
        border-color: #ffd700;
        background: rgba(255, 215, 0, 0.2);
      }
      .character-slot.battle-party {
        border-color: #4caf50;
      }
      .character-slot.empty {
        border-style: dashed;
        opacity: 0.5;
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
      }
      .character-slot .char-name {
        font-size: 10px;
        color: #fff;
        text-align: center;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        width: 100%;
      }
      .character-slot .char-level {
        font-size: 9px;
        color: #8a8aaa;
      }
      .tab-btn {
        flex: 1;
        padding: 10px;
        background: none;
        border: none;
        color: #8a8aaa;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: all 0.2s;
      }
      .tab-btn:hover {
        color: #fff;
        background: rgba(255,255,255,0.05);
      }
      .tab-btn.active {
        color: #ffd700;
        border-bottom-color: #ffd700;
      }
      .stat-row {
        display: flex;
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px solid #2a2a4a;
      }
      .stat-label {
        color: #8a8aaa;
      }
      .stat-value {
        color: #fff;
        font-weight: bold;
      }
      .equipment-slot {
        display: flex;
        align-items: center;
        padding: 12px;
        background: rgba(0,0,0,0.2);
        border-radius: 8px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .equipment-slot:hover {
        background: rgba(74, 144, 217, 0.2);
      }
      .equipment-slot .slot-icon {
        width: 40px;
        height: 40px;
        background: rgba(0,0,0,0.3);
        border-radius: 8px;
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
        color: #fff;
        font-weight: bold;
      }
      .equipment-slot .slot-item {
        font-size: 12px;
        color: #8a8aaa;
      }
      .skill-item {
        display: flex;
        align-items: center;
        padding: 12px;
        background: rgba(0,0,0,0.2);
        border-radius: 8px;
        margin-bottom: 8px;
      }
      .skill-icon {
        width: 40px;
        height: 40px;
        background: linear-gradient(135deg, #4a90d9, #357abd);
        border-radius: 8px;
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
        color: #fff;
        font-weight: bold;
      }
      .skill-desc {
        font-size: 11px;
        color: #8a8aaa;
      }
      .xp-bar {
        height: 6px;
        background: #2a2a4a;
        border-radius: 3px;
        margin-top: 8px;
        overflow: hidden;
      }
      .xp-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, #4caf50, #8bc34a);
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
            <div style="color: #5a5a7a; font-size: 20px;">+</div>
            <div class="char-name" style="color: #5a5a7a;">Empty</div>
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
    this.uiElement.querySelectorAll('.tab-btn').forEach(btn => {
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
    this.uiElement.querySelectorAll('.tab-btn').forEach(btn => {
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
          ">
            ${this.getClassIcon(char.class)}
          </div>
          <div>
            <div style="font-size: 18px; font-weight: bold; color: #fff;">${char.name}</div>
            <div style="color: #8a8aaa;">${this.capitalize(char.race)} ${this.capitalize(char.class)}</div>
            <div style="color: #ffd700;">Level ${char.level}</div>
          </div>
        </div>

        <!-- HP Bar -->
        <div style="margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: #8a8aaa;">HP</span>
            <span style="color: #fff;">${char.hp_current} / ${char.hp_max}</span>
          </div>
          <div style="height: 8px; background: #2a2a4a; border-radius: 4px; overflow: hidden;">
            <div style="height: 100%; width: ${hpPercent}%; background: linear-gradient(90deg, #f44336, #4caf50);"></div>
          </div>
        </div>

        <!-- MP Bar -->
        <div style="margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: #8a8aaa;">MP</span>
            <span style="color: #fff;">${char.mp_current} / ${char.mp_max}</span>
          </div>
          <div style="height: 8px; background: #2a2a4a; border-radius: 4px; overflow: hidden;">
            <div style="height: 100%; width: ${mpPercent}%; background: #2196f3;"></div>
          </div>
        </div>

        <!-- XP Bar -->
        <div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: #8a8aaa;">Experience</span>
            <span style="color: #fff;">${char.experience || 0}</span>
          </div>
          <div class="xp-bar">
            <div class="xp-bar-fill" style="width: ${this.getXPProgress(char)}%;"></div>
          </div>
        </div>
      </div>

      <div class="ui-panel-header" style="margin-bottom: 12px;">Base Stats</div>
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
    return `<div id="equipment-panel-container" style="height: 100%;"></div>`;
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
    return `<div id="skills-panel-container" style="height: 100%;"></div>`;
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
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
