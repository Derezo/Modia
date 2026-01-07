import { Scene } from './Scene.js';
import { InventoryPanel } from '../components/InventoryPanel.js';

/**
 * InventoryScene - Full-screen inventory management
 * Shows all characters in party with tabs, inventory grid, sorting/filtering
 */
export class InventoryScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.characters = [];
    this.selectedCharacter = null;
    this.inventoryPanel = null;
    this.abortController = null;

    // Filter/sort state
    this.filterType = 'all'; // 'all', 'weapon', 'armor', 'accessory', 'consumable'
    this.sortBy = 'name'; // 'name', 'type', 'rarity'
  }

  async enter() {
    await this.loadCharacters();
    this.createUI();
    this.setupEventListeners();

    // Auto-select first character if available
    if (this.characters.length > 0) {
      this.selectCharacter(this.characters[0].id);
    }
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
    container.id = 'inventory-scene';
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
        <h2 style="margin: 0; color: #ffd700;">Inventory</h2>
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
        <!-- Left Panel: Character Tabs -->
        <div class="ui-panel" style="width: 200px; display: flex; flex-direction: column;">
          <div class="ui-panel-header">Characters</div>
          <div id="character-tabs" style="
            flex: 1;
            overflow-y: auto;
            padding: 8px;
          ">
            ${this.renderCharacterTabs()}
          </div>
        </div>

        <!-- Right Panel: Inventory -->
        <div class="ui-panel" style="flex: 1; display: flex; flex-direction: column;">
          <div class="ui-panel-header" style="display: flex; justify-content: space-between; align-items: center;">
            <span id="inventory-title">Select a Character</span>
            <!-- Filter/Sort Controls -->
            <div id="inventory-controls" style="display: none; gap: 8px;">
              <select id="filter-select" class="inventory-select">
                <option value="all">All Items</option>
                <option value="weapon">Weapons</option>
                <option value="armor">Armor</option>
                <option value="accessory">Accessories</option>
                <option value="consumable">Consumables</option>
              </select>
              <select id="sort-select" class="inventory-select">
                <option value="name">Sort: Name</option>
                <option value="type">Sort: Type</option>
                <option value="rarity">Sort: Rarity</option>
              </select>
            </div>
          </div>

          <!-- Inventory Content -->
          <div id="inventory-content" style="flex: 1; overflow-y: auto; padding: 16px;">
            <div style="color: #8a8aaa; text-align: center; padding: 40px;">
              Click a character to view their inventory
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
    if (document.getElementById('inventory-scene-styles')) return;

    const style = document.createElement('style');
    style.id = 'inventory-scene-styles';
    style.textContent = `
      .character-tab {
        display: flex;
        align-items: center;
        padding: 10px 12px;
        background: rgba(0,0,0,0.2);
        border: 2px solid transparent;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
        margin-bottom: 8px;
      }
      .character-tab:hover {
        border-color: #6ab0f3;
        background: rgba(74, 144, 217, 0.2);
      }
      .character-tab.selected {
        border-color: #ffd700;
        background: rgba(255, 215, 0, 0.2);
      }
      .character-tab .char-icon {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        color: #fff;
        margin-right: 10px;
        flex-shrink: 0;
      }
      .character-tab .char-info {
        flex: 1;
        min-width: 0;
      }
      .character-tab .char-name {
        font-size: 13px;
        color: #fff;
        font-weight: bold;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .character-tab .char-details {
        font-size: 11px;
        color: #8a8aaa;
      }
      .inventory-select {
        padding: 6px 10px;
        background: rgba(0,0,0,0.4);
        border: 1px solid #3a3a5a;
        border-radius: 4px;
        color: #fff;
        font-size: 12px;
        cursor: pointer;
      }
      .inventory-select:hover {
        border-color: #6ab0f3;
      }
      .inventory-select:focus {
        outline: none;
        border-color: #ffd700;
      }
      .inventory-select option {
        background: #1a1a2e;
        color: #fff;
      }
      /* Override inventory panel styles for scene context */
      #inventory-scene .inventory-panel {
        height: 100%;
      }
      #inventory-scene .inventory-grid {
        max-height: none;
        flex: 1;
      }
      #inventory-scene .inventory-section {
        display: flex;
        flex-direction: column;
      }
    `;
    document.head.appendChild(style);
  }

  renderCharacterTabs() {
    if (this.characters.length === 0) {
      return '<div style="color: #8a8aaa; text-align: center; padding: 20px;">No characters</div>';
    }

    return this.characters.map(char => {
      const isSelected = this.selectedCharacter?.id === char.id;
      const classColor = this.getClassColor(char.class);
      const classIcon = this.getClassIcon(char.class);

      return `
        <div class="character-tab ${isSelected ? 'selected' : ''}" data-character-id="${char.id}">
          <div class="char-icon" style="background: ${classColor};">
            ${classIcon}
          </div>
          <div class="char-info">
            <div class="char-name">${char.name}</div>
            <div class="char-details">Lv.${char.level} ${this.capitalize(char.class)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  setupEventListeners() {
    this.abortController = new AbortController();
    const opts = { signal: this.abortController.signal };

    // Back button
    this.uiElement.querySelector('#back-btn')?.addEventListener('click', () => {
      this.game.scenes.switchTo('worldMap');
    }, opts);

    // Character tabs
    this.uiElement.querySelectorAll('.character-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const charId = parseInt(tab.dataset.characterId);
        this.selectCharacter(charId);
      }, opts);
    });

    // Filter select
    this.uiElement.querySelector('#filter-select')?.addEventListener('change', (e) => {
      this.filterType = e.target.value;
      this.applyFilterSort();
    }, opts);

    // Sort select
    this.uiElement.querySelector('#sort-select')?.addEventListener('change', (e) => {
      this.sortBy = e.target.value;
      this.applyFilterSort();
    }, opts);
  }

  async selectCharacter(characterId) {
    this.selectedCharacter = this.characters.find(c => c.id === characterId);

    if (!this.selectedCharacter) return;

    // Update tab selection visuals
    this.uiElement.querySelectorAll('.character-tab').forEach(tab => {
      tab.classList.remove('selected');
      if (parseInt(tab.dataset.characterId) === characterId) {
        tab.classList.add('selected');
      }
    });

    // Update title
    this.uiElement.querySelector('#inventory-title').textContent = `${this.selectedCharacter.name}'s Inventory`;

    // Show controls
    this.uiElement.querySelector('#inventory-controls').style.display = 'flex';

    // Load inventory panel
    await this.loadInventoryPanel();
  }

  async loadInventoryPanel() {
    const container = this.uiElement.querySelector('#inventory-content');
    if (!container || !this.selectedCharacter) return;

    // Destroy previous instance if exists
    if (this.inventoryPanel) {
      this.inventoryPanel.destroy();
    }

    // Clear container and add panel container
    container.innerHTML = '<div id="inventory-panel-container" style="height: 100%;"></div>';

    const panelContainer = container.querySelector('#inventory-panel-container');

    // Create new inventory panel
    this.inventoryPanel = new InventoryPanel(this.game, panelContainer);
    this.inventoryPanel.setCharacterStats(this.selectedCharacter);

    // Store original inventory for filtering
    await this.inventoryPanel.load(this.selectedCharacter.id);
    this.originalInventory = [...this.inventoryPanel.inventory];

    // Apply current filter/sort
    this.applyFilterSort();
  }

  applyFilterSort() {
    if (!this.inventoryPanel || !this.originalInventory) return;

    // Filter
    let filtered = [...this.originalInventory];
    if (this.filterType !== 'all') {
      filtered = filtered.filter(item => item.type === this.filterType);
    }

    // Sort
    filtered.sort((a, b) => {
      switch (this.sortBy) {
        case 'name':
          return (a.name || '').localeCompare(b.name || '');
        case 'type':
          return (a.type || '').localeCompare(b.type || '');
        case 'rarity':
          return this.getRarityOrder(b.rarity) - this.getRarityOrder(a.rarity);
        default:
          return 0;
      }
    });

    // Update inventory panel with filtered/sorted items
    this.inventoryPanel.inventory = filtered;
    this.inventoryPanel.render();

    // Re-setup event listeners on the new DOM
    this.setupInventoryPanelEvents();
  }

  setupInventoryPanelEvents() {
    // The InventoryPanel handles its own events in setupEventListeners()
    // which is called in render(), so we don't need to do anything here
  }

  getRarityOrder(rarity) {
    const order = {
      common: 0,
      uncommon: 1,
      rare: 2,
      epic: 3,
      legendary: 4
    };
    return order[rarity] || 0;
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
