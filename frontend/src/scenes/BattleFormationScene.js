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
import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from '../ui/parchment/index.js';

// Local alias for cleaner access
const P = PARCHMENT_COLORS;

const STYLE_ID = 'battle-formation-scene-styles';

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
    // Clean up styles
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) styleEl.remove();

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
    container.className = this.isMobile ? 'bf-formation-mobile' : 'bf-formation-desktop';
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
    this.gridCanvas = container.querySelector('#bf-formation-grid-canvas');
    this.initializeGrid();

    // Initialize ParchmentCard component
    this.characterCard = new ParchmentCard({ mode: 'detailed', type: 'player' });
    const cardContainer = container.querySelector('#bf-card-content');
    if (cardContainer) {
      cardContainer.appendChild(this.characterCard.element);
    }

    // Initialize Start Battle button
    const buttonContainer = container.querySelector('#bf-start-button-container');
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
      <div class="bf-formation-header">
        <button class="bf-back-btn" id="bf-back-btn">
          <span class="bf-back-icon">&#8592;</span>
        </button>
        <div class="bf-header-titles">
          <h2 class="bf-battle-title-animated">${themeTitle}</h2>
          <div class="bf-node-name">${nodeName}</div>
        </div>
      </div>

      <!-- Main Content -->
      <div class="bf-formation-main">
        <!-- Side Drawer (fixed width) -->
        <div class="bf-formation-drawer" id="bf-party-drawer">
          <div class="bf-drawer-header">
            <span class="bf-drawer-title">Your Party</span>
          </div>
          <div class="bf-drawer-roster" id="bf-unplaced-roster">
            <!-- Character cards go here -->
          </div>
          <div class="bf-drawer-divider"></div>
          <div class="bf-drawer-detail" id="bf-card-content">
            <!-- ParchmentCard goes here -->
          </div>
        </div>

        <!-- Center Content -->
        <div class="bf-formation-center">
          <!-- Enemy Roster -->
          <div class="bf-enemy-section">
            <div class="bf-enemy-label">Enemies Ahead</div>
            <div class="bf-enemy-roster" id="bf-enemy-roster">
              ${this.renderEnemyRoster()}
            </div>
          </div>

          <!-- Grid Area -->
          <div class="bf-grid-area">
            <canvas id="bf-formation-grid-canvas" width="400" height="220"></canvas>
            <div class="bf-grid-instructions">
              Click to place &bull; Long press to remove
            </div>
          </div>

          <!-- Start Button -->
          <div class="bf-start-section">
            <div id="bf-start-button-container"></div>
          </div>
        </div>
      </div>
    `;
  }

  getMobileLayout(nodeName, themeTitle) {
    return `
      <!-- Header (compact) -->
      <div class="bf-formation-header bf-formation-header--mobile">
        <button class="bf-back-btn" id="bf-back-btn">
          <span class="bf-back-icon">&#8592;</span>
        </button>
        <div class="bf-header-titles">
          <h2 class="bf-battle-title-animated bf-battle-title--mobile">${themeTitle}</h2>
        </div>
      </div>

      <!-- Enemy Roster (horizontal scroll) -->
      <div class="bf-enemy-section bf-enemy-section--mobile">
        <div class="bf-enemy-roster bf-enemy-roster--mobile" id="bf-enemy-roster">
          ${this.renderEnemyRoster()}
        </div>
      </div>

      <!-- Grid Area (full width) -->
      <div class="bf-grid-area bf-grid-area--mobile">
        <canvas id="bf-formation-grid-canvas" width="360" height="200"></canvas>
      </div>

      <!-- Start Button (fixed) -->
      <div class="bf-start-section bf-start-section--mobile">
        <div id="bf-start-button-container"></div>
      </div>

      <!-- Bottom Sheet -->
      <div class="bf-bottom-sheet ${this.isBottomSheetExpanded ? 'expanded' : ''}" id="bf-bottom-sheet">
        <div class="bf-sheet-handle" id="bf-sheet-handle">
          <div class="bf-handle-bar"></div>
          <span class="bf-sheet-title">Party (${this.battleParty.length})</span>
        </div>
        <div class="bf-sheet-content">
          <div class="bf-drawer-roster" id="bf-unplaced-roster">
            <!-- Character cards go here -->
          </div>
          <div class="bf-drawer-detail" id="bf-card-content">
            <!-- ParchmentCard goes here -->
          </div>
        </div>
      </div>
    `;
  }

  renderEnemyRoster() {
    if (this.enemies.length === 0) {
      return '<div class="bf-enemy-unknown">Unknown enemies await...</div>';
    }

    return this.enemies.map((enemy, index) => {
      const isBoss = enemy.isBoss || enemy.level > 10;
      const threatClass = isBoss ? 'bf-threat-boss' : '';

      return `
        <div class="bf-enemy-card ${threatClass}" data-enemy-index="${index}">
          <div class="bf-enemy-portrait">
            <div class="bf-enemy-icon">${enemy.name.charAt(0)}</div>
            ${isBoss ? '<div class="bf-boss-indicator">&#9760;</div>' : ''}
          </div>
          <div class="bf-enemy-info">
            <div class="bf-enemy-name">${enemy.name}</div>
            <div class="bf-enemy-level">Lv.${enemy.level || '?'}</div>
          </div>
          ${isBoss ? '<div class="bf-threat-aura"></div>' : ''}
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
    const backBtn = this.uiElement.querySelector('#bf-back-btn');
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
      const sheetHandle = this.uiElement.querySelector('#bf-sheet-handle');
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
    const sheet = this.uiElement.querySelector('#bf-bottom-sheet');
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
    const roster = this.uiElement?.querySelector('#bf-unplaced-roster');
    if (!roster) return;

    const placedIds = new Set(
      Array.from(this.placedCharacters.values()).map(c => c.id)
    );
    const unplaced = this.battleParty.filter(c => !placedIds.has(c.id));

    if (unplaced.length === 0 && this.placedCharacters.size > 0) {
      roster.innerHTML = '<div class="bf-all-placed">All characters placed!</div>';
      return;
    }

    roster.innerHTML = this.battleParty.map(char => {
      const isPlaced = placedIds.has(char.id);
      const isSelected = this.selectedCharacter?.id === char.id;
      const gender = char.gender || 'other';
      const portraitUrl = `/assets/sprites/portraits/${char.race}_${gender}_${char.class}.png`;

      return `
        <div class="bf-roster-char ${isPlaced ? 'placed' : ''} ${isSelected ? 'selected' : ''}"
             data-char-id="${char.id}">
          <div class="bf-roster-portrait">
            <img src="${portraitUrl}" alt="${char.name}"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
            <div class="bf-roster-fallback" style="display:none; background:${this.getClassColor(char.class)}">
              ${this.getClassIcon(char.class)}
            </div>
            ${isPlaced ? '<div class="bf-placed-check">&#10003;</div>' : ''}
          </div>
          <div class="bf-roster-name">${char.name}</div>
        </div>
      `;
    }).join('');

    // Attach click handlers
    roster.querySelectorAll('.bf-roster-char').forEach(el => {
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
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* ========== LAYOUT ========== */

      .bf-formation-header {
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        background: ${P.shadow};
        border-bottom: ${getParchmentBorder()};
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.lg};
      }

      .bf-formation-header--mobile {
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
      }

      .bf-back-btn {
        background: ${P.shadow};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.lg};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        color: ${P.text.muted};
        cursor: pointer;
        transition: all 0.2s;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .bf-back-btn:hover {
        background: rgba(139, 115, 85, 0.3);
        color: ${P.text.inverse};
      }

      .bf-back-icon {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
      }

      .bf-header-titles {
        flex: 1;
      }

      .bf-battle-title-animated {
        margin: 0;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xxl};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        background: linear-gradient(90deg, ${P.accent.gold} 0%, ${P.accent.copper} 25%, ${P.accent.gold} 50%, ${P.accent.copper} 75%, ${P.accent.gold} 100%);
        background-size: 200% auto;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        animation: bf-shimmer-gold 3s linear infinite;
        text-transform: uppercase;
        letter-spacing: 2px;
      }

      .bf-battle-title--mobile {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
      }

      @keyframes bf-shimmer-gold {
        0% { background-position: 0% center; }
        100% { background-position: 200% center; }
      }

      .bf-node-name {
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        margin-top: ${PARCHMENT_SPACING.xs};
      }

      /* ========== MAIN CONTENT (DESKTOP) ========== */

      .bf-formation-main {
        flex: 1;
        display: flex;
        overflow: hidden;
      }

      /* Side Drawer */
      .bf-formation-drawer {
        width: 280px;
        min-width: 280px;
        max-width: 280px;
        background: rgba(0, 0, 0, 0.4);
        border-right: ${getParchmentBorder()};
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .bf-drawer-header {
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        border-bottom: 1px solid ${P.borderDark};
      }

      .bf-drawer-title {
        color: ${P.accent.gold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      .bf-drawer-roster {
        flex: 1;
        padding: ${PARCHMENT_SPACING.md};
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: ${PARCHMENT_SPACING.sm};
      }

      .bf-drawer-divider {
        height: 2px;
        background: linear-gradient(90deg, transparent, ${P.border}, transparent);
        margin: ${PARCHMENT_SPACING.sm} 0;
      }

      .bf-drawer-detail {
        padding: ${PARCHMENT_SPACING.md};
        min-height: 120px;
      }

      /* Center Content */
      .bf-formation-center {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      /* ========== ENEMY SECTION ========== */

      .bf-enemy-section {
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        background: rgba(139, 0, 0, 0.15);
        border-bottom: 1px solid ${P.state.error};
      }

      .bf-enemy-section--mobile {
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        overflow-x: auto;
      }

      .bf-enemy-label {
        color: ${P.state.error};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: ${PARCHMENT_SPACING.sm};
      }

      .bf-enemy-roster {
        display: flex;
        gap: ${PARCHMENT_SPACING.md};
        justify-content: center;
        flex-wrap: wrap;
      }

      .bf-enemy-roster--mobile {
        flex-wrap: nowrap;
        justify-content: flex-start;
      }

      .bf-enemy-card {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: ${PARCHMENT_SPACING.sm};
        background: ${P.shadow};
        border: 2px solid ${P.state.error};
        border-radius: ${PARCHMENT_RADIUS.lg};
        min-width: 70px;
        transition: all 0.2s;
      }

      .bf-enemy-card.bf-threat-boss {
        border-color: #8b0000;
        box-shadow: 0 0 10px rgba(139, 0, 0, 0.4);
      }

      .bf-enemy-portrait {
        position: relative;
        width: 40px;
        height: 40px;
        background: rgba(139, 0, 0, 0.4);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: ${PARCHMENT_SPACING.xs};
      }

      .bf-enemy-icon {
        color: ${P.state.error};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xl};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .bf-boss-indicator {
        position: absolute;
        top: -4px;
        right: -4px;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        color: #ff0000;
      }

      .bf-enemy-info {
        text-align: center;
      }

      .bf-enemy-name {
        color: ${P.text.inverse};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        white-space: nowrap;
      }

      .bf-enemy-level {
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: 9px;
      }

      .bf-threat-aura {
        position: absolute;
        inset: -4px;
        border-radius: ${PARCHMENT_RADIUS.lg};
        border: 2px solid rgba(255, 0, 0, 0.3);
        animation: bf-threat-pulse 2s ease-in-out infinite;
        pointer-events: none;
      }

      @keyframes bf-threat-pulse {
        0%, 100% { opacity: 0.3; transform: scale(1); }
        50% { opacity: 0.7; transform: scale(1.05); }
      }

      .bf-enemy-unknown {
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-style: italic;
        padding: ${PARCHMENT_SPACING.md};
      }

      /* ========== GRID AREA ========== */

      .bf-grid-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: ${PARCHMENT_SPACING.lg};
      }

      .bf-grid-area--mobile {
        padding: ${PARCHMENT_SPACING.sm};
      }

      #bf-formation-grid-canvas {
        border-radius: ${PARCHMENT_RADIUS.lg};
      }

      .bf-grid-instructions {
        color: ${P.text.muted};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        margin-top: ${PARCHMENT_SPACING.md};
        text-align: center;
      }

      /* ========== START SECTION ========== */

      .bf-start-section {
        padding: ${PARCHMENT_SPACING.lg};
        display: flex;
        justify-content: center;
        background: ${P.shadow};
        border-top: 1px solid ${P.borderDark};
      }

      .bf-start-section--mobile {
        padding: ${PARCHMENT_SPACING.md};
        position: sticky;
        bottom: 0;
      }

      /* ========== ROSTER CHARACTERS ========== */

      .bf-roster-char {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        background: ${P.shadow};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.lg};
        cursor: pointer;
        transition: all 0.2s;
      }

      .bf-roster-char:hover {
        background: rgba(139, 115, 85, 0.3);
        border-color: ${P.borderLight};
      }

      .bf-roster-char.selected {
        border-color: ${P.accent.gold};
        background: rgba(201, 162, 39, 0.1);
      }

      .bf-roster-char.placed {
        opacity: 0.6;
      }

      .bf-roster-char.placed .bf-roster-portrait {
        filter: grayscale(0.5);
      }

      .bf-roster-portrait {
        position: relative;
        width: 40px;
        height: 40px;
        border-radius: ${PARCHMENT_RADIUS.md};
        overflow: hidden;
        border: ${getParchmentBorder()};
      }

      .bf-roster-portrait img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        image-rendering: pixelated;
      }

      .bf-roster-fallback {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: ${P.text.inverse};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
      }

      .bf-placed-check {
        position: absolute;
        bottom: -2px;
        right: -2px;
        width: 16px;
        height: 16px;
        background: ${P.state.success};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: ${P.text.inverse};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
      }

      .bf-roster-name {
        flex: 1;
        color: ${P.text.inverse};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .bf-all-placed {
        color: ${P.state.success};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        text-align: center;
        padding: ${PARCHMENT_SPACING.lg};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
      }

      /* ========== MOBILE BOTTOM SHEET ========== */

      .bf-bottom-sheet {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(20, 20, 35, 0.95);
        border-top: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.lg} ${PARCHMENT_RADIUS.lg} 0 0;
        transform: translateY(calc(100% - 48px));
        transition: transform 0.3s ease;
        max-height: 60vh;
        z-index: 100;
      }

      .bf-bottom-sheet.expanded {
        transform: translateY(0);
      }

      .bf-sheet-handle {
        padding: ${PARCHMENT_SPACING.md} ${PARCHMENT_SPACING.lg};
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.md};
        cursor: pointer;
      }

      .bf-handle-bar {
        width: 40px;
        height: 4px;
        background: ${P.border};
        border-radius: ${PARCHMENT_RADIUS.sm};
        margin: 0 auto;
      }

      .bf-sheet-title {
        flex: 1;
        color: ${P.accent.gold};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        text-align: center;
      }

      .bf-sheet-content {
        padding: 0 ${PARCHMENT_SPACING.lg} ${PARCHMENT_SPACING.lg};
        overflow-y: auto;
        max-height: calc(60vh - 48px);
      }

      /* ========== RESPONSIVE ========== */

      @media (max-width: 768px) {
        .bf-formation-drawer {
          display: none;
        }

        .bf-enemy-roster {
          justify-content: flex-start;
          flex-wrap: nowrap;
          overflow-x: auto;
          padding-bottom: ${PARCHMENT_SPACING.sm};
        }

        .bf-enemy-card {
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
    // Draw parchment-themed background gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    gradient.addColorStop(0, P.light);
    gradient.addColorStop(0.5, P.mid);
    gradient.addColorStop(1, P.dark);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Add subtle corner flourishes
    ctx.strokeStyle = P.border;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.3;

    // Top-left flourish
    ctx.beginPath();
    ctx.moveTo(20, 60);
    ctx.quadraticCurveTo(20, 20, 60, 20);
    ctx.stroke();

    // Top-right flourish
    ctx.beginPath();
    ctx.moveTo(ctx.canvas.width - 20, 60);
    ctx.quadraticCurveTo(ctx.canvas.width - 20, 20, ctx.canvas.width - 60, 20);
    ctx.stroke();

    // Bottom-left flourish
    ctx.beginPath();
    ctx.moveTo(20, ctx.canvas.height - 60);
    ctx.quadraticCurveTo(20, ctx.canvas.height - 20, 60, ctx.canvas.height - 20);
    ctx.stroke();

    // Bottom-right flourish
    ctx.beginPath();
    ctx.moveTo(ctx.canvas.width - 20, ctx.canvas.height - 60);
    ctx.quadraticCurveTo(ctx.canvas.width - 20, ctx.canvas.height - 20, ctx.canvas.width - 60, ctx.canvas.height - 20);
    ctx.stroke();

    ctx.globalAlpha = 1.0;
  }
}
