import { Scene } from './Scene.js';
import { CharacterCard } from '../components/CharacterCard.js';

/**
 * BattleFormationScene - Pre-battle character placement on isometric grid
 *
 * Players place up to 5 characters from their battle party on a 5x4 isometric grid
 * before starting combat. Shows enemy roster preview and character detail cards.
 */
export class BattleFormationScene extends Scene {
  constructor(game) {
    super(game);

    // Scene context (from enter() data)
    this.battleContext = null;  // { type: 'pve'|'pvp', node, enemies, opponent }

    // Grid configuration
    this.gridWidth = 5;
    this.gridHeight = 4;
    this.tileWidth = 64;       // Isometric diamond width
    this.tileHeight = 32;      // Isometric diamond height
    this.gridCanvas = null;    // Separate canvas for grid

    // Character placement state
    this.placedCharacters = new Map();  // "x,y" -> character object
    this.placementOrder = [];           // Track order for FIFO removal
    this.selectedCharacter = null;      // Currently selected (for detail card)

    // Party data
    this.battleParty = [];     // Up to 5 chars from party slots 1-5
    this.enemies = [];         // Enemy preview data

    // Interaction state
    this.hoveredTile = null;   // { x, y } or null
    this.longPressTimer = null;
    this.longPressThreshold = 500;  // ms for long press
    this.pressedTile = null;

    // DOM elements
    this.uiElement = null;
    this.abortController = null;

    // Shared components
    this.characterCard = null;
  }

  async enter(data = {}) {
    this.battleContext = data;
    this.abortController = new AbortController();

    // Load battle party (characters in slots 1-5)
    await this.loadBattleParty();

    // Load enemy preview data from server
    await this.loadEnemies(data);

    // Create UI
    this.createUI();
    this.setupEventListeners();

    // Auto-place characters in default positions
    this.autoPlaceCharacters();
  }

  exit() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.characterCard) {
      this.characterCard.destroy();
      this.characterCard = null;
    }
    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
    this.gridCanvas = null;
    this.placedCharacters.clear();
    this.placementOrder = [];
  }

  async loadBattleParty() {
    try {
      const result = await this.game.api.getCharacters();
      const characters = result.characters || [];
      // Get characters in slots 1-5 (battle party)
      this.battleParty = characters
        .filter(c => c.party_slot >= 1 && c.party_slot <= 5)
        .sort((a, b) => a.party_slot - b.party_slot);
    } catch (err) {
      console.error('Failed to load battle party:', err);
      this.battleParty = [];
    }
  }

  async loadEnemies(data) {
    // Fetch possible enemies from server API
    if (data.node?.id) {
      try {
        const preview = await this.game.api.getEncounterPreview(data.node.id);
        this.enemies = preview.possibleEnemies || [];
        this.nodeType = preview.nodeType;
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
    container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `;

    const nodeName = this.battleContext?.node?.name || 'Battle Zone';
    const nodeType = this.battleContext?.type || 'pve';

    container.innerHTML = `
      <!-- Header -->
      <div style="
        padding: 16px 24px;
        background: rgba(0,0,0,0.4);
        border-bottom: 2px solid #3a3a5a;
        text-align: center;
      ">
        <h2 style="margin: 0 0 4px 0; color: #ffd700; font-size: 20px;">Battle Formation</h2>
        <div style="color: #8a8aaa; font-size: 14px;">${nodeName}</div>
      </div>

      <!-- Enemy Roster -->
      <div style="
        padding: 12px 24px;
        background: rgba(139, 0, 0, 0.2);
        border-bottom: 1px solid #5a3a3a;
      ">
        <div style="color: #ff6b6b; font-size: 12px; margin-bottom: 8px;">Possible Enemies</div>
        <div id="enemy-roster" style="display: flex; gap: 16px; flex-wrap: wrap; justify-content: center;">
          ${this.renderEnemyRoster()}
        </div>
      </div>

      <!-- Main Content: Grid + Detail Card -->
      <div style="
        flex: 1;
        display: flex;
        padding: 16px;
        gap: 16px;
        overflow: hidden;
      ">
        <!-- Grid Area -->
        <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <canvas id="formation-grid-canvas" width="400" height="200"></canvas>
          <div style="color: #8a8aaa; font-size: 11px; margin-top: 12px; text-align: center;">
            Click empty tile to place • Click occupied tile to cycle • Long press to remove
          </div>
        </div>

        <!-- Character Detail Card Container -->
        <div id="character-card-container" class="ui-panel" style="
          width: 200px;
          display: flex;
          flex-direction: column;
        ">
          <div class="ui-panel-header" style="font-size: 12px;">Character Info</div>
          <div id="card-content" style="padding: 12px; flex: 1;">
            <!-- CharacterCard component will be inserted here -->
          </div>
        </div>
      </div>

      <!-- Unplaced Characters + Start Button -->
      <div style="
        padding: 12px 24px;
        background: rgba(0,0,0,0.4);
        border-top: 2px solid #3a3a5a;
        display: flex;
        align-items: center;
        gap: 16px;
      ">
        <div style="flex: 1;">
          <div style="color: #8a8aaa; font-size: 11px; margin-bottom: 8px;">Available Characters</div>
          <div id="unplaced-roster" style="display: flex; gap: 8px;">
            ${this.renderUnplacedRoster()}
          </div>
        </div>
        <button id="start-battle-btn" class="btn btn-primary" style="
          padding: 12px 32px;
          font-size: 16px;
        ">Start Battle</button>
        <button id="back-btn" class="btn btn-secondary" style="padding: 12px 16px;">Back</button>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;

    // Get canvas reference
    this.gridCanvas = container.querySelector('#formation-grid-canvas');

    // Initialize CharacterCard component
    this.characterCard = new CharacterCard({ mode: 'detailed' });
    const cardContainer = container.querySelector('#card-content');
    if (cardContainer) {
      cardContainer.appendChild(this.characterCard.element);
    }

    // Initial render
    this.renderGrid();
  }

  renderEnemyRoster() {
    if (this.enemies.length === 0) {
      return '<div style="color: #8a8aaa;">Unknown enemies</div>';
    }

    return this.enemies.map(enemy => `
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 8px;
        background: rgba(0,0,0,0.3);
        border-radius: 8px;
        min-width: 60px;
      ">
        <div style="
          width: 48px;
          height: 48px;
          background: rgba(139, 0, 0, 0.4);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ff6b6b;
          font-size: 20px;
          margin-bottom: 4px;
        ">${enemy.name.charAt(0)}</div>
        <div style="color: #fff; font-size: 11px;">${enemy.name}</div>
      </div>
    `).join('');
  }

  renderUnplacedRoster() {
    const placedIds = new Set(
      Array.from(this.placedCharacters.values()).map(c => c.id)
    );
    const unplaced = this.battleParty.filter(c => !placedIds.has(c.id));

    if (unplaced.length === 0) {
      return '<div style="color: #4caf50; font-size: 12px;">All characters placed!</div>';
    }

    return unplaced.map(char => {
      const gender = char.gender || 'other';
      const portraitUrl = `/assets/sprites/portraits/${char.race}_${gender}_${char.class}.png`;

      return `
        <div class="unplaced-char" data-char-id="${char.id}" style="
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 6px;
          background: rgba(0,0,0,0.3);
          border: 2px solid #4a4a6a;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        ">
          <div style="
            width: 40px;
            height: 40px;
            overflow: hidden;
            border-radius: 4px;
            margin-bottom: 4px;
          ">
            <img
              src="${portraitUrl}"
              alt="${char.name}"
              style="width: 100%; height: 100%; image-rendering: pixelated; object-fit: cover;"
              onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
            >
            <div style="
              display: none;
              width: 100%;
              height: 100%;
              background: ${this.getClassColor(char.class)};
              align-items: center;
              justify-content: center;
              color: #fff;
              font-size: 16px;
            ">${this.getClassIcon(char.class)}</div>
          </div>
          <div style="color: #fff; font-size: 10px; max-width: 50px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${char.name}</div>
        </div>
      `;
    }).join('');
  }

  setupEventListeners() {
    const opts = { signal: this.abortController.signal };

    // Grid canvas interactions
    this.gridCanvas.addEventListener('click', (e) => this.handleGridClick(e), opts);
    this.gridCanvas.addEventListener('mousemove', (e) => this.handleGridHover(e), opts);
    this.gridCanvas.addEventListener('mouseleave', () => {
      this.hoveredTile = null;
      this.renderGrid();
    }, opts);

    // Long press for removal
    this.gridCanvas.addEventListener('mousedown', (e) => this.handleGridMouseDown(e), opts);
    this.gridCanvas.addEventListener('mouseup', () => this.handleGridMouseUp(), opts);

    // Touch support
    this.gridCanvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      this.handleGridMouseDown({ offsetX: touch.clientX - this.gridCanvas.getBoundingClientRect().left, offsetY: touch.clientY - this.gridCanvas.getBoundingClientRect().top });
    }, opts);
    this.gridCanvas.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.handleGridMouseUp();
      if (!this.longPressTimer) {
        // Was a tap, not long press
        const touch = e.changedTouches[0];
        this.handleGridClick({ offsetX: touch.clientX - this.gridCanvas.getBoundingClientRect().left, offsetY: touch.clientY - this.gridCanvas.getBoundingClientRect().top });
      }
    }, opts);

    // Buttons
    this.uiElement.querySelector('#start-battle-btn').addEventListener('click', () => this.startBattle(), opts);
    this.uiElement.querySelector('#back-btn').addEventListener('click', () => this.goBack(), opts);

    // Unplaced character clicks
    this.uiElement.querySelectorAll('.unplaced-char').forEach(el => {
      el.addEventListener('click', () => {
        const charId = parseInt(el.dataset.charId);
        const char = this.battleParty.find(c => c.id === charId);
        if (char) {
          this.selectedCharacter = char;
          this.updateDetailCard();
        }
      }, opts);
    });
  }

  // Grid coordinate conversions
  gridToScreen(gridX, gridY) {
    const centerX = this.gridCanvas.width / 2;
    const startY = 30;

    const screenX = centerX + (gridX - gridY) * (this.tileWidth / 2);
    const screenY = startY + (gridX + gridY) * (this.tileHeight / 2);
    return { x: screenX, y: screenY };
  }

  screenToGrid(screenX, screenY) {
    const centerX = this.gridCanvas.width / 2;
    const startY = 30;

    const worldX = screenX - centerX;
    const worldY = screenY - startY;

    const gridX = Math.floor((worldX / (this.tileWidth / 2) + worldY / (this.tileHeight / 2)) / 2);
    const gridY = Math.floor((worldY / (this.tileHeight / 2) - worldX / (this.tileWidth / 2)) / 2);

    // Bounds check
    if (gridX >= 0 && gridX < this.gridWidth && gridY >= 0 && gridY < this.gridHeight) {
      return { x: gridX, y: gridY };
    }
    return null;
  }

  handleGridClick(e) {
    const tile = this.screenToGrid(e.offsetX, e.offsetY);
    if (!tile) return;

    const key = `${tile.x},${tile.y}`;

    if (this.placedCharacters.has(key)) {
      // Cycle character on occupied tile
      this.cycleCharacterOnTile(key);
    } else {
      // Place next available character
      this.placeNextCharacter(key);
    }

    this.renderGrid();
    this.updateUnplacedRoster();
  }

  handleGridHover(e) {
    const tile = this.screenToGrid(e.offsetX, e.offsetY);
    if (!tile || (this.hoveredTile?.x === tile.x && this.hoveredTile?.y === tile.y)) return;

    this.hoveredTile = tile;
    this.renderGrid();

    // Show character info on hover
    const key = `${tile.x},${tile.y}`;
    if (this.placedCharacters.has(key)) {
      this.selectedCharacter = this.placedCharacters.get(key);
      this.updateDetailCard();
    }
  }

  handleGridMouseDown(e) {
    const tile = this.screenToGrid(e.offsetX, e.offsetY);
    if (!tile) return;

    const key = `${tile.x},${tile.y}`;
    if (!this.placedCharacters.has(key)) return;

    this.pressedTile = key;
    this.longPressTimer = setTimeout(() => {
      this.removeCharacter(key);
      this.renderGrid();
      this.updateUnplacedRoster();
      this.longPressTimer = null;
    }, this.longPressThreshold);
  }

  handleGridMouseUp() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.pressedTile = null;
  }

  placeNextCharacter(gridKey) {
    const placedIds = new Set(
      Array.from(this.placedCharacters.values()).map(c => c.id)
    );
    const unplaced = this.battleParty.filter(c => !placedIds.has(c.id));

    if (unplaced.length === 0) return;

    const nextChar = unplaced[0];

    // Enforce max 5 placement - FIFO removal
    if (this.placedCharacters.size >= 5) {
      const oldestKey = this.placementOrder.shift();
      this.placedCharacters.delete(oldestKey);
    }

    this.placedCharacters.set(gridKey, nextChar);
    this.placementOrder.push(gridKey);
    this.selectedCharacter = nextChar;
    this.updateDetailCard();
  }

  cycleCharacterOnTile(gridKey) {
    const currentChar = this.placedCharacters.get(gridKey);
    const currentIdx = this.battleParty.findIndex(c => c.id === currentChar.id);

    // Find next character (wrap around)
    let nextIdx = (currentIdx + 1) % this.battleParty.length;
    let nextChar = this.battleParty[nextIdx];

    // Check if next char is already placed elsewhere - swap them
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

    this.game.showNotification('Character removed', 'info');
  }

  autoPlaceCharacters() {
    // Auto-place battle party in default positions
    const defaultPositions = [
      { x: 2, y: 0 },  // Front center
      { x: 1, y: 1 },  // Left
      { x: 3, y: 1 },  // Right
      { x: 0, y: 2 },  // Back left
      { x: 4, y: 2 }   // Back right
    ];

    this.battleParty.slice(0, 5).forEach((char, i) => {
      if (i < defaultPositions.length) {
        const pos = defaultPositions[i];
        const key = `${pos.x},${pos.y}`;
        this.placedCharacters.set(key, char);
        this.placementOrder.push(key);
      }
    });

    this.renderGrid();
    this.updateUnplacedRoster();
  }

  renderGrid() {
    if (!this.gridCanvas) return;

    const ctx = this.gridCanvas.getContext('2d');
    ctx.clearRect(0, 0, this.gridCanvas.width, this.gridCanvas.height);

    // Render tiles
    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        this.renderTile(ctx, x, y);
      }
    }

    // Render placed characters on top
    for (const [key, char] of this.placedCharacters) {
      const [x, y] = key.split(',').map(Number);
      this.renderCharacterOnTile(ctx, x, y, char);
    }
  }

  renderTile(ctx, gridX, gridY) {
    const { x, y } = this.gridToScreen(gridX, gridY);
    const key = `${gridX},${gridY}`;
    const isOccupied = this.placedCharacters.has(key);
    const isHovered = this.hoveredTile?.x === gridX && this.hoveredTile?.y === gridY;
    const isPressed = this.pressedTile === key;

    // Draw isometric diamond
    ctx.beginPath();
    ctx.moveTo(x, y - this.tileHeight / 2);                    // Top
    ctx.lineTo(x + this.tileWidth / 2, y);                     // Right
    ctx.lineTo(x, y + this.tileHeight / 2);                    // Bottom
    ctx.lineTo(x - this.tileWidth / 2, y);                     // Left
    ctx.closePath();

    // Fill based on state
    if (isPressed) {
      ctx.fillStyle = '#8b0000';      // Dark red - being removed
    } else if (isOccupied) {
      ctx.fillStyle = '#2a4a2a';      // Dark green - occupied
    } else if (isHovered) {
      ctx.fillStyle = '#3a4a5a';      // Light gray - hover
    } else {
      ctx.fillStyle = '#252535';      // Base dark
    }
    ctx.fill();

    // Border
    if (isOccupied) {
      ctx.strokeStyle = '#4caf50';
    } else if (isHovered) {
      ctx.strokeStyle = '#6ab0f3';
    } else {
      ctx.strokeStyle = '#3a3a5a';
    }
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  renderCharacterOnTile(ctx, gridX, gridY, char) {
    const { x, y } = this.gridToScreen(gridX, gridY);

    // Draw character icon
    const color = this.getClassColor(char.class);
    const icon = this.getClassIcon(char.class);

    // Circle background
    ctx.beginPath();
    ctx.arc(x, y - 8, 14, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Icon text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, x, y - 8);

    // Name below
    ctx.font = '9px Arial';
    ctx.fillStyle = '#fff';
    ctx.fillText(char.name.substring(0, 8), x, y + 10);
  }

  updateDetailCard() {
    const container = this.uiElement.querySelector('#character-card-container');
    if (container) {
      container.style.opacity = this.selectedCharacter ? '1' : '0.5';
    }

    if (this.characterCard) {
      this.characterCard.setCharacter(this.selectedCharacter);
    }
  }

  updateUnplacedRoster() {
    const roster = this.uiElement.querySelector('#unplaced-roster');
    if (roster) {
      roster.innerHTML = this.renderUnplacedRoster();

      // Re-attach event listeners
      roster.querySelectorAll('.unplaced-char').forEach(el => {
        el.addEventListener('click', () => {
          const charId = parseInt(el.dataset.charId);
          const char = this.battleParty.find(c => c.id === charId);
          if (char) {
            this.selectedCharacter = char;
            this.updateDetailCard();
          }
        }, { signal: this.abortController.signal });
      });
    }

    // Update start button state
    const startBtn = this.uiElement.querySelector('#start-battle-btn');
    if (startBtn) {
      startBtn.disabled = this.placedCharacters.size === 0;
    }
  }

  async startBattle() {
    if (this.placedCharacters.size === 0) {
      this.game.showNotification('Place at least one character!', 'warning');
      return;
    }

    // Build formation: { characterId: { tileX, tileY } }
    const formation = {};
    for (const [key, char] of this.placedCharacters) {
      const [x, y] = key.split(',').map(Number);
      formation[char.id] = { tileX: x, tileY: y };
    }

    try {
      // Start battle with formation positions
      const battleData = await this.game.api.startBattle({ formation });

      // Transition to battle scene
      this.game.scenes.switchTo('battle', {
        ...battleData,
        playerFormation: formation
      });
    } catch (err) {
      this.game.showNotification(err.message || 'Failed to start battle', 'error');
    }
  }

  goBack() {
    // Return to world map or previous scene
    this.game.scenes.switchTo('worldMap');
  }

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

  capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }

  update(deltaTime) {
    // No per-frame updates needed
  }

  render(ctx) {
    // UI is HTML-based, just fill background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
