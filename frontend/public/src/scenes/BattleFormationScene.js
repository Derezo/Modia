import { Scene } from './Scene.js';
import { ParchmentCard } from '../components/ParchmentCard.js';
import { FormationGrid } from './formation/FormationGrid.js';
import { StartBattleButton } from './formation/StartBattleButton.js';
import { BattlefieldTheme } from './formation/themes/BattlefieldTheme.js';
import { PitFighterTheme } from './formation/themes/PitFighterTheme.js';
import { ArcaneChamberTheme } from './formation/themes/ArcaneChamberTheme.js';
import { ArmoryTheme } from './formation/themes/ArmoryTheme.js';
import { DojoTheme } from './formation/themes/DojoTheme.js';
import { ClockworkTheme } from './formation/themes/ClockworkTheme.js';

/**
 * BattleFormationScene - Pre-battle character placement on isometric grid
 *
 * Players place up to 5 characters from their battle party on a 5x4 isometric grid
 * before starting combat. Features context-aware theming, responsive layout,
 * and immersive ambient effects.
 */
export class BattleFormationScene extends Scene {
  constructor(game) {
    super(game);

    // Scene context (from enter() data)
    this.battleContext = null;  // { type: 'pve'|'pvp'|'guild', node, enemies, guildClass }

    // Theme system
    this.theme = null;
    this.nodeType = 'forest';

    // Grid component
    this.formationGrid = null;
    this.gridCanvas = null;

    // Character placement state
    this.placedCharacters = new Map();  // "x,y" -> character object
    this.placementOrder = [];           // Track order for FIFO removal
    this.selectedCharacter = null;      // Currently selected (for detail card)

    // Party data
    this.battleParty = [];     // Up to 5 chars from party slots 1-5
    this.enemies = [];         // Enemy preview data

    // Interaction state
    this.hoveredTile = null;
    this.longPressTimer = null;
    this.longPressThreshold = 500;
    this.pressedTile = null;
    this.justRemovedByLongPress = false;

    // Layout state
    this.isMobile = false;
    this.isDrawerOpen = true;
    this.isBottomSheetExpanded = false;

    // DOM elements
    this.uiElement = null;
    this.abortController = null;

    // Components
    this.characterCard = null;
    this.startButton = null;

    // Animation
    this.lastTime = 0;
    this.animationId = null;
  }

  async enter(data = {}) {
    this.battleContext = data;
    this.abortController = new AbortController();

    // Determine node type and battle context
    this.nodeType = data.node?.node_type || 'forest';
    this.battleType = this.determineBattleType(data);

    // Initialize theme based on battle context
    this.initializeTheme();

    // Load battle party
    await this.loadBattleParty();

    // Load enemy preview data
    await this.loadEnemies(data);

    // Detect mobile layout
    this.isMobile = window.innerWidth < 768;

    // Create UI
    this.createUI();
    this.setupEventListeners();

    // Start animation loop
    this.startAnimationLoop();

    // Initial render
    this.updateUnplacedRoster();
  }

  exit() {
    this.stopAnimationLoop();

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.characterCard) {
      this.characterCard.destroy();
      this.characterCard = null;
    }
    if (this.startButton) {
      this.startButton.destroy();
      this.startButton = null;
    }
    if (this.theme) {
      this.theme.destroy();
      this.theme = null;
    }
    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
    this.formationGrid = null;
    this.gridCanvas = null;
    this.placedCharacters.clear();
    this.placementOrder = [];
  }

  /**
   * Determine battle type for theming
   */
  determineBattleType(data) {
    // Coliseum PvP battles
    if (data.type === 'pvp' || data.type === 'coliseum') {
      return 'coliseum';
    }

    // Guild advancement battles
    if (data.type === 'guild' || data.guildClass) {
      return `guild_${data.guildClass || 'warrior'}`;
    }

    // Standard PvE node battles
    return 'battlefield';
  }

  /**
   * Initialize theme based on battle type
   */
  initializeTheme() {
    switch (this.battleType) {
      case 'coliseum':
        this.theme = new PitFighterTheme(this);
        break;
      case 'guild_wizard':
        this.theme = new ArcaneChamberTheme(this);
        break;
      case 'guild_warrior':
        this.theme = new ArmoryTheme(this);
        break;
      case 'guild_monk':
        this.theme = new DojoTheme(this);
        break;
      case 'guild_chemist':
        this.theme = new ClockworkTheme(this);
        break;
      default:
        // Standard battlefield theme for all node types
        this.theme = new BattlefieldTheme(this, this.nodeType);
    }

    this.theme.init();
  }

  /**
   * Get button type based on battle context
   */
  getButtonType() {
    switch (this.battleType) {
      case 'coliseum': return 'fist';
      case 'guild_wizard': return 'spellbook';
      case 'guild_warrior': return 'axe';
      case 'guild_monk': return 'palm';
      case 'guild_chemist': return 'lever';
      default: return 'swords';
    }
  }

  async loadBattleParty() {
    try {
      const result = await this.game.api.getCharacters();
      const characters = result.characters || [];
      this.battleParty = characters
        .filter(c => c.party_slot >= 1 && c.party_slot <= 5)
        .sort((a, b) => a.party_slot - b.party_slot);
    } catch (err) {
      console.error('Failed to load battle party:', err);
      this.battleParty = [];
    }
  }

  async loadEnemies(data) {
    if (data.node?.id) {
      try {
        const preview = await this.game.api.getEncounterPreview(data.node.id);
        this.enemies = preview.possibleEnemies || [];
      } catch (err) {
        console.error('Failed to load encounter preview:', err);
        this.enemies = [];
      }
    } else {
      this.enemies = [];
    }
  }

  createUI() {
    const container = document.createElement('div');
    container.id = 'battle-formation-scene';
    container.className = this.isMobile ? 'formation-mobile' : 'formation-desktop';
    container.style.cssText = this.theme.getContainerStyles();

    const nodeName = this.battleContext?.node?.name || 'Battle Zone';
    const themeTitle = this.theme.getTitle();

    if (this.isMobile) {
      container.innerHTML = this.getMobileLayout(nodeName, themeTitle);
    } else {
      container.innerHTML = this.getDesktopLayout(nodeName, themeTitle);
    }

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;

    // Initialize grid canvas
    this.gridCanvas = container.querySelector('#formation-grid-canvas');
    this.initializeGrid();

    // Initialize ParchmentCard component
    this.characterCard = new ParchmentCard({ mode: 'detailed', type: 'player' });
    const cardContainer = container.querySelector('#card-content');
    if (cardContainer) {
      cardContainer.appendChild(this.characterCard.element);
    }

    // Initialize Start Battle button
    const buttonContainer = container.querySelector('#start-button-container');
    if (buttonContainer) {
      this.startButton = new StartBattleButton({
        type: this.getButtonType(),
        disabled: true,
        onClick: () => this.startBattle()
      });
      buttonContainer.appendChild(this.startButton.element);
    }

    // Add styles
    this.addStyles();
  }

  getDesktopLayout(nodeName, themeTitle) {
    return `
      <!-- Header -->
      <div class="formation-header">
        <button class="back-btn" id="back-btn">
          <span class="back-icon">&#8592;</span>
        </button>
        <div class="header-titles">
          <h2 class="battle-title-animated">${themeTitle}</h2>
          <div class="node-name">${nodeName}</div>
        </div>
      </div>

      <!-- Main Content -->
      <div class="formation-main">
        <!-- Side Drawer (fixed width) -->
        <div class="formation-drawer" id="party-drawer">
          <div class="drawer-header">
            <span class="drawer-title">Your Party</span>
          </div>
          <div class="drawer-roster" id="unplaced-roster">
            <!-- Character cards go here -->
          </div>
          <div class="drawer-divider"></div>
          <div class="drawer-detail" id="card-content">
            <!-- ParchmentCard goes here -->
          </div>
        </div>

        <!-- Center Content -->
        <div class="formation-center">
          <!-- Enemy Roster -->
          <div class="enemy-section">
            <div class="enemy-label">Enemies Ahead</div>
            <div class="enemy-roster" id="enemy-roster">
              ${this.renderEnemyRoster()}
            </div>
          </div>

          <!-- Grid Area -->
          <div class="grid-area">
            <canvas id="formation-grid-canvas" width="400" height="220"></canvas>
            <div class="grid-instructions">
              Click to place &bull; Long press to remove
            </div>
          </div>

          <!-- Start Button -->
          <div class="start-section">
            <div id="start-button-container"></div>
          </div>
        </div>
      </div>
    `;
  }

  getMobileLayout(nodeName, themeTitle) {
    return `
      <!-- Header (compact) -->
      <div class="formation-header formation-header--mobile">
        <button class="back-btn" id="back-btn">
          <span class="back-icon">&#8592;</span>
        </button>
        <div class="header-titles">
          <h2 class="battle-title-animated battle-title--mobile">${themeTitle}</h2>
        </div>
      </div>

      <!-- Enemy Roster (horizontal scroll) -->
      <div class="enemy-section enemy-section--mobile">
        <div class="enemy-roster enemy-roster--mobile" id="enemy-roster">
          ${this.renderEnemyRoster()}
        </div>
      </div>

      <!-- Grid Area (full width) -->
      <div class="grid-area grid-area--mobile">
        <canvas id="formation-grid-canvas" width="360" height="200"></canvas>
      </div>

      <!-- Start Button (fixed) -->
      <div class="start-section start-section--mobile">
        <div id="start-button-container"></div>
      </div>

      <!-- Bottom Sheet -->
      <div class="bottom-sheet ${this.isBottomSheetExpanded ? 'expanded' : ''}" id="bottom-sheet">
        <div class="sheet-handle" id="sheet-handle">
          <div class="handle-bar"></div>
          <span class="sheet-title">Party (${this.battleParty.length})</span>
        </div>
        <div class="sheet-content">
          <div class="drawer-roster" id="unplaced-roster">
            <!-- Character cards go here -->
          </div>
          <div class="drawer-detail" id="card-content">
            <!-- ParchmentCard goes here -->
          </div>
        </div>
      </div>
    `;
  }

  renderEnemyRoster() {
    if (this.enemies.length === 0) {
      return '<div class="enemy-unknown">Unknown enemies await...</div>';
    }

    return this.enemies.map((enemy, index) => {
      const isBoss = enemy.isBoss || enemy.level > 10;
      const threatClass = isBoss ? 'threat-boss' : '';

      return `
        <div class="enemy-card ${threatClass}" data-enemy-index="${index}">
          <div class="enemy-portrait">
            <div class="enemy-icon">${enemy.name.charAt(0)}</div>
            ${isBoss ? '<div class="boss-indicator">&#9760;</div>' : ''}
          </div>
          <div class="enemy-info">
            <div class="enemy-name">${enemy.name}</div>
            <div class="enemy-level">Lv.${enemy.level || '?'}</div>
          </div>
          ${isBoss ? '<div class="threat-aura"></div>' : ''}
        </div>
      `;
    }).join('');
  }

  initializeGrid() {
    this.formationGrid = new FormationGrid({
      canvas: this.gridCanvas,
      assetLoader: this.game.assetLoader,
      theme: this.theme,
      nodeType: this.nodeType,
      gridWidth: 5,
      gridHeight: 4
    });
  }

  setupEventListeners() {
    const opts = { signal: this.abortController.signal };

    // Back button
    const backBtn = this.uiElement.querySelector('#back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.goBack(), opts);
    }

    // Grid canvas interactions
    if (this.gridCanvas) {
      this.gridCanvas.addEventListener('click', (e) => this.handleGridClick(e), opts);
      this.gridCanvas.addEventListener('mousemove', (e) => this.handleGridHover(e), opts);
      this.gridCanvas.addEventListener('mouseleave', () => {
        this.hoveredTile = null;
        this.formationGrid?.setHoveredTile(null);
      }, opts);

      // Long press for removal
      this.gridCanvas.addEventListener('mousedown', (e) => this.handleGridMouseDown(e), opts);
      this.gridCanvas.addEventListener('mouseup', () => this.handleGridMouseUp(), opts);

      // Touch support
      this.gridCanvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = this.gridCanvas.getBoundingClientRect();
        this.handleGridMouseDown({
          offsetX: touch.clientX - rect.left,
          offsetY: touch.clientY - rect.top
        });
      }, opts);

      this.gridCanvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.handleGridMouseUp();
        if (!this.longPressTimer) {
          const touch = e.changedTouches[0];
          const rect = this.gridCanvas.getBoundingClientRect();
          this.handleGridClick({
            offsetX: touch.clientX - rect.left,
            offsetY: touch.clientY - rect.top
          });
        }
      }, opts);
    }

    // Mobile bottom sheet
    if (this.isMobile) {
      const sheetHandle = this.uiElement.querySelector('#sheet-handle');
      if (sheetHandle) {
        sheetHandle.addEventListener('click', () => this.toggleBottomSheet(), opts);
      }
    }

    // Window resize
    window.addEventListener('resize', () => this.handleResize(), opts);
  }

  goBack() {
    // Return to world map
    this.game.scenes.switchTo('worldMap');
  }

  handleResize() {
    const wasMobile = this.isMobile;
    this.isMobile = window.innerWidth < 768;

    if (wasMobile !== this.isMobile) {
      // Layout changed, need to rebuild UI
      this.rebuildUI();
    }
  }

  rebuildUI() {
    // Save state
    const savedPlaced = new Map(this.placedCharacters);
    const savedOrder = [...this.placementOrder];
    const savedSelected = this.selectedCharacter;

    // Cleanup
    if (this.characterCard) {
      this.characterCard.destroy();
      this.characterCard = null;
    }
    if (this.startButton) {
      this.startButton.destroy();
      this.startButton = null;
    }
    if (this.uiElement) {
      this.uiElement.remove();
    }

    // Rebuild
    this.createUI();
    this.setupEventListeners();

    // Restore state
    this.placedCharacters = savedPlaced;
    this.placementOrder = savedOrder;
    this.selectedCharacter = savedSelected;

    this.updateUnplacedRoster();
    this.updateDetailCard();
    this.updateStartButton();
  }

  toggleBottomSheet() {
    this.isBottomSheetExpanded = !this.isBottomSheetExpanded;
    const sheet = this.uiElement.querySelector('#bottom-sheet');
    if (sheet) {
      sheet.classList.toggle('expanded', this.isBottomSheetExpanded);
    }
  }

  // Grid interactions
  handleGridClick(e) {
    if (this.justRemovedByLongPress) {
      this.justRemovedByLongPress = false;
      return;
    }

    const tile = this.formationGrid?.screenToGrid(e.offsetX, e.offsetY);
    if (!tile) return;

    const key = `${tile.x},${tile.y}`;

    if (this.placedCharacters.has(key)) {
      this.cycleCharacterOnTile(key);
    } else {
      this.placeCharacterOnTile(key);
    }

    this.updateGrid();
    this.updateUnplacedRoster();
    this.updateStartButton();
    this.updateTension();
  }

  handleGridHover(e) {
    const tile = this.formationGrid?.screenToGrid(e.offsetX, e.offsetY);
    if (!tile || (this.hoveredTile?.x === tile.x && this.hoveredTile?.y === tile.y)) return;

    this.hoveredTile = tile;
    this.formationGrid?.setHoveredTile(tile);

    const key = `${tile.x},${tile.y}`;
    if (this.placedCharacters.has(key)) {
      this.selectedCharacter = this.placedCharacters.get(key);
      this.updateDetailCard();
    }
  }

  handleGridMouseDown(e) {
    const tile = this.formationGrid?.screenToGrid(e.offsetX, e.offsetY);
    if (!tile) return;

    const key = `${tile.x},${tile.y}`;
    if (!this.placedCharacters.has(key)) return;

    this.pressedTile = key;
    this.formationGrid?.setPressedTile(key);
    this.justRemovedByLongPress = false;

    this.longPressTimer = setTimeout(() => {
      this.removeCharacter(key);
      this.updateGrid();
      this.updateUnplacedRoster();
      this.updateStartButton();
      this.updateTension();
      this.longPressTimer = null;
      this.justRemovedByLongPress = true;
    }, this.longPressThreshold);
  }

  handleGridMouseUp() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.pressedTile = null;
    this.formationGrid?.setPressedTile(null);
  }

  // Character placement logic
  placeCharacterOnTile(gridKey) {
    const placedIds = new Set(
      Array.from(this.placedCharacters.values()).map(c => c.id)
    );
    const unplaced = this.battleParty.filter(c => !placedIds.has(c.id));

    if (unplaced.length > 0) {
      const nextChar = unplaced[0];

      if (this.placedCharacters.size >= 5) {
        const oldestKey = this.placementOrder.shift();
        this.placedCharacters.delete(oldestKey);
      }

      this.placedCharacters.set(gridKey, nextChar);
      this.placementOrder.push(gridKey);
      this.selectedCharacter = nextChar;
      this.updateDetailCard();
      return;
    }

    if (this.battleParty.length === 1 && this.placedCharacters.size === 1) {
      const [existingKey, char] = this.placedCharacters.entries().next().value;
      this.placedCharacters.delete(existingKey);
      this.placementOrder = this.placementOrder.filter(k => k !== existingKey);

      this.placedCharacters.set(gridKey, char);
      this.placementOrder.push(gridKey);
      this.selectedCharacter = char;
      this.updateDetailCard();
      return;
    }

    if (this.placedCharacters.size > 0 && this.placementOrder.length > 0) {
      const oldestKey = this.placementOrder.shift();
      const charToMove = this.placedCharacters.get(oldestKey);
      this.placedCharacters.delete(oldestKey);

      this.placedCharacters.set(gridKey, charToMove);
      this.placementOrder.push(gridKey);
      this.selectedCharacter = charToMove;
      this.updateDetailCard();

      this.game.showNotification?.(`Moved ${charToMove.name}`, 'info');
    }
  }

  cycleCharacterOnTile(gridKey) {
    const currentChar = this.placedCharacters.get(gridKey);
    const currentIdx = this.battleParty.findIndex(c => c.id === currentChar.id);

    let nextIdx = (currentIdx + 1) % this.battleParty.length;
    let nextChar = this.battleParty[nextIdx];

    for (const [key, char] of this.placedCharacters) {
      if (char.id === nextChar.id && key !== gridKey) {
        this.placedCharacters.set(key, currentChar);
        break;
      }
    }

    this.placedCharacters.set(gridKey, nextChar);
    this.selectedCharacter = nextChar;
    this.updateDetailCard();
  }

  removeCharacter(gridKey) {
    this.placedCharacters.delete(gridKey);
    this.placementOrder = this.placementOrder.filter(k => k !== gridKey);

    if (this.selectedCharacter) {
      const stillPlaced = Array.from(this.placedCharacters.values())
        .some(c => c.id === this.selectedCharacter.id);
      if (!stillPlaced) {
        this.selectedCharacter = null;
        this.updateDetailCard();
      }
    }

    this.game.showNotification?.('Character removed', 'info');
  }

  // UI updates
  updateGrid() {
    if (this.formationGrid) {
      this.formationGrid.setPlacedCharacters(this.placedCharacters);
    }
  }

  updateDetailCard() {
    if (this.characterCard) {
      this.characterCard.setCharacter(this.selectedCharacter);
    }
  }

  updateStartButton() {
    if (this.startButton) {
      this.startButton.setDisabled(this.placedCharacters.size === 0);
    }
  }

  updateTension() {
    if (this.theme) {
      this.theme.updateTension(this.placedCharacters.size, this.battleParty.length);
    }
  }

  updateUnplacedRoster() {
    const roster = this.uiElement?.querySelector('#unplaced-roster');
    if (!roster) return;

    const placedIds = new Set(
      Array.from(this.placedCharacters.values()).map(c => c.id)
    );
    const unplaced = this.battleParty.filter(c => !placedIds.has(c.id));

    if (unplaced.length === 0 && this.placedCharacters.size > 0) {
      roster.innerHTML = '<div class="all-placed">All characters placed!</div>';
      return;
    }

    roster.innerHTML = this.battleParty.map(char => {
      const isPlaced = placedIds.has(char.id);
      const isSelected = this.selectedCharacter?.id === char.id;
      const gender = char.gender || 'other';
      const portraitUrl = `/assets/sprites/portraits/${char.race}_${gender}_${char.class}.png`;

      return `
        <div class="roster-char ${isPlaced ? 'placed' : ''} ${isSelected ? 'selected' : ''}"
             data-char-id="${char.id}">
          <div class="roster-portrait">
            <img src="${portraitUrl}" alt="${char.name}"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="roster-fallback" style="display:none; background:${this.getClassColor(char.class)}">
              ${this.getClassIcon(char.class)}
            </div>
            ${isPlaced ? '<div class="placed-check">&#10003;</div>' : ''}
          </div>
          <div class="roster-name">${char.name}</div>
        </div>
      `;
    }).join('');

    // Attach click handlers
    roster.querySelectorAll('.roster-char').forEach(el => {
      el.addEventListener('click', () => {
        const charId = parseInt(el.dataset.charId);
        const char = this.battleParty.find(c => c.id === charId);
        if (char) {
          this.selectedCharacter = char;
          this.updateDetailCard();
          this.updateUnplacedRoster();
        }
      }, { signal: this.abortController.signal });
    });
  }

  // Animation loop
  startAnimationLoop() {
    this.lastTime = performance.now();
    this.animate();
  }

  stopAnimationLoop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  animate() {
    const now = performance.now();
    const deltaTime = now - this.lastTime;
    this.lastTime = now;

    // Update theme animations
    if (this.theme) {
      this.theme.update(deltaTime);
    }

    // Update grid animations
    if (this.formationGrid) {
      this.formationGrid.update(deltaTime);
      this.formationGrid.render();
    }

    this.animationId = requestAnimationFrame(() => this.animate());
  }

  // Battle start
  async startBattle() {
    if (this.placedCharacters.size === 0) {
      this.game.showNotification('Place at least one character!', 'warning');
      return;
    }

    const formation = {};
    for (const [key, char] of this.placedCharacters) {
      const [x, y] = key.split(',').map(Number);
      formation[char.id] = { tileX: x, tileY: y };
    }

    try {
      const battleData = await this.game.api.startBattle({ formation });

      this.game.scenes.switchTo('battle', {
        ...battleData,
        playerFormation: formation
      });
    } catch (err) {
      this.game.showNotification(err.message || 'Failed to start battle', 'error');
    }
  }

  // Utility methods
  getClassColor(className) {
    const colors = {
      warrior: '#c62828',
      wizard: '#1565c0',
      monk: '#f9a825',
      chemist: '#2e7d32',
      berserker: '#b71c1c',
      sorcerer: '#0d47a1',
      ninja: '#4a148c',
      alchemist: '#1b5e20'
    };
    return colors[className] || '#666';
  }

  getClassIcon(className) {
    const icons = {
      warrior: 'W',
      wizard: 'M',
      monk: 'K',
      chemist: 'C',
      berserker: 'B',
      sorcerer: 'S',
      ninja: 'N',
      alchemist: 'A'
    };
    return icons[className] || '?';
  }

  addStyles() {
    if (document.getElementById('formation-scene-styles')) return;

    const style = document.createElement('style');
    style.id = 'formation-scene-styles';
    style.textContent = `
      /* ========== LAYOUT ========== */

      .formation-header {
        padding: 12px 16px;
        background: rgba(0,0,0,0.5);
        border-bottom: 2px solid #4a4a6a;
        display: flex;
        align-items: center;
        gap: 16px;
      }

      .formation-header--mobile {
        padding: 8px 12px;
      }

      .back-btn {
        background: rgba(0,0,0,0.3);
        border: 2px solid #4a4a6a;
        border-radius: 8px;
        padding: 8px 12px;
        color: #ccc;
        cursor: pointer;
        transition: all 0.2s;
      }

      .back-btn:hover {
        background: rgba(74, 74, 106, 0.5);
        color: #fff;
      }

      .back-icon {
        font-size: 18px;
      }

      .header-titles {
        flex: 1;
      }

      .battle-title-animated {
        margin: 0;
        font-size: 20px;
        background: linear-gradient(90deg, #ffd700 0%, #ff6b35 25%, #ffd700 50%, #ff6b35 75%, #ffd700 100%);
        background-size: 200% auto;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        animation: shimmer-gold 3s linear infinite;
        text-transform: uppercase;
        letter-spacing: 2px;
      }

      .battle-title--mobile {
        font-size: 16px;
      }

      @keyframes shimmer-gold {
        0% { background-position: 0% center; }
        100% { background-position: 200% center; }
      }

      .node-name {
        color: #8a8aaa;
        font-size: 12px;
        margin-top: 4px;
      }

      /* ========== MAIN CONTENT (DESKTOP) ========== */

      .formation-main {
        flex: 1;
        display: flex;
        overflow: hidden;
      }

      /* Side Drawer */
      .formation-drawer {
        width: 280px;
        min-width: 280px;
        max-width: 280px;
        background: rgba(0,0,0,0.4);
        border-right: 2px solid #4a4a6a;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .drawer-header {
        padding: 12px 16px;
        border-bottom: 1px solid #3a3a5a;
      }

      .drawer-title {
        color: #ffd700;
        font-size: 14px;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      .drawer-roster {
        flex: 1;
        padding: 12px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .drawer-divider {
        height: 2px;
        background: linear-gradient(90deg, transparent, #4a4a6a, transparent);
        margin: 8px 0;
      }

      .drawer-detail {
        padding: 12px;
        min-height: 120px;
      }

      /* Center Content */
      .formation-center {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      /* ========== ENEMY SECTION ========== */

      .enemy-section {
        padding: 12px 16px;
        background: rgba(139, 0, 0, 0.15);
        border-bottom: 1px solid #5a3a3a;
      }

      .enemy-section--mobile {
        padding: 8px 12px;
        overflow-x: auto;
      }

      .enemy-label {
        color: #ff6b6b;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 8px;
      }

      .enemy-roster {
        display: flex;
        gap: 12px;
        justify-content: center;
        flex-wrap: wrap;
      }

      .enemy-roster--mobile {
        flex-wrap: nowrap;
        justify-content: flex-start;
      }

      .enemy-card {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 8px;
        background: rgba(0,0,0,0.3);
        border: 2px solid #5a3a3a;
        border-radius: 8px;
        min-width: 70px;
        transition: all 0.2s;
      }

      .enemy-card.threat-boss {
        border-color: #8b0000;
        box-shadow: 0 0 10px rgba(139, 0, 0, 0.4);
      }

      .enemy-portrait {
        position: relative;
        width: 40px;
        height: 40px;
        background: rgba(139, 0, 0, 0.4);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 4px;
      }

      .enemy-icon {
        color: #ff6b6b;
        font-size: 18px;
        font-weight: bold;
      }

      .boss-indicator {
        position: absolute;
        top: -4px;
        right: -4px;
        font-size: 14px;
        color: #ff0000;
      }

      .enemy-info {
        text-align: center;
      }

      .enemy-name {
        color: #fff;
        font-size: 11px;
        white-space: nowrap;
      }

      .enemy-level {
        color: #aaa;
        font-size: 9px;
      }

      .threat-aura {
        position: absolute;
        inset: -4px;
        border-radius: 12px;
        border: 2px solid rgba(255, 0, 0, 0.3);
        animation: threat-pulse 2s ease-in-out infinite;
        pointer-events: none;
      }

      @keyframes threat-pulse {
        0%, 100% { opacity: 0.3; transform: scale(1); }
        50% { opacity: 0.7; transform: scale(1.05); }
      }

      .enemy-unknown {
        color: #8a8aaa;
        font-style: italic;
        padding: 12px;
      }

      /* ========== GRID AREA ========== */

      .grid-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }

      .grid-area--mobile {
        padding: 8px;
      }

      #formation-grid-canvas {
        border-radius: 8px;
      }

      .grid-instructions {
        color: #6a6a8a;
        font-size: 11px;
        margin-top: 12px;
        text-align: center;
      }

      /* ========== START SECTION ========== */

      .start-section {
        padding: 16px;
        display: flex;
        justify-content: center;
        background: rgba(0,0,0,0.3);
        border-top: 1px solid #3a3a5a;
      }

      .start-section--mobile {
        padding: 12px;
        position: sticky;
        bottom: 0;
      }

      /* ========== ROSTER CHARACTERS ========== */

      .roster-char {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 12px;
        background: rgba(0,0,0,0.3);
        border: 2px solid #4a4a6a;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .roster-char:hover {
        background: rgba(74, 74, 106, 0.3);
        border-color: #6a6a8a;
      }

      .roster-char.selected {
        border-color: #ffd700;
        background: rgba(255, 215, 0, 0.1);
      }

      .roster-char.placed {
        opacity: 0.6;
      }

      .roster-char.placed .roster-portrait {
        filter: grayscale(0.5);
      }

      .roster-portrait {
        position: relative;
        width: 40px;
        height: 40px;
        border-radius: 4px;
        overflow: hidden;
        border: 2px solid #4a4a6a;
      }

      .roster-portrait img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        image-rendering: pixelated;
      }

      .roster-fallback {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-weight: bold;
        font-size: 16px;
      }

      .placed-check {
        position: absolute;
        bottom: -2px;
        right: -2px;
        width: 16px;
        height: 16px;
        background: #4caf50;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-size: 10px;
        font-weight: bold;
      }

      .roster-name {
        flex: 1;
        color: #fff;
        font-size: 13px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .all-placed {
        color: #4caf50;
        text-align: center;
        padding: 16px;
        font-size: 13px;
      }

      /* ========== MOBILE BOTTOM SHEET ========== */

      .bottom-sheet {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(20, 20, 35, 0.95);
        border-top: 2px solid #4a4a6a;
        border-radius: 16px 16px 0 0;
        transform: translateY(calc(100% - 48px));
        transition: transform 0.3s ease;
        max-height: 60vh;
        z-index: 100;
      }

      .bottom-sheet.expanded {
        transform: translateY(0);
      }

      .sheet-handle {
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
      }

      .handle-bar {
        width: 40px;
        height: 4px;
        background: #4a4a6a;
        border-radius: 2px;
        margin: 0 auto;
      }

      .sheet-title {
        flex: 1;
        color: #ffd700;
        font-size: 14px;
        font-weight: bold;
        text-align: center;
      }

      .sheet-content {
        padding: 0 16px 16px;
        overflow-y: auto;
        max-height: calc(60vh - 48px);
      }

      /* ========== RESPONSIVE ========== */

      @media (max-width: 768px) {
        .formation-drawer {
          display: none;
        }

        .enemy-roster {
          justify-content: flex-start;
          flex-wrap: nowrap;
          overflow-x: auto;
          padding-bottom: 8px;
        }

        .enemy-card {
          flex-shrink: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  update(deltaTime) {
    // Main update handled by animation loop
  }

  render(ctx) {
    // UI is HTML-based
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
