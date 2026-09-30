/**
 * @module BattleFormationScene
 * @description Pre-battle character placement on isometric grid with theming.
 *
 * Key responsibilities:
 * - Character placement on 5x4 isometric grid (up to 5 characters)
 * - Context-aware theming for PvE, PvP/Coliseum, and Guild battles
 * - Coliseum mode: 20-second countdown, formation submission via WebSocket
 * - Responsive layouts for desktop and mobile
 * - Character selection and preview via ParchmentCard
 *
 * @see FormationGrid.js - Isometric grid rendering and interaction
 * @see StartBattleButton.js - Themed battle start button with animations
 * @see themes/ - Context-specific visual themes (Battlefield, PitFighter, etc.)
 */
import { Scene } from './Scene.js';
import { ParchmentCard } from '../components/ParchmentCard.js';
import { FormationGrid } from './formation/FormationGrid.js';
import { computeFormationCanvasSize } from './formation/formationCanvasSize.js';
import { StartBattleButton } from './formation/StartBattleButton.js';
import { BattlefieldTheme } from './formation/themes/BattlefieldTheme.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { PitFighterTheme } from './formation/themes/PitFighterTheme.js';
import { ArcaneChamberTheme } from './formation/themes/ArcaneChamberTheme.js';
import { ArmoryTheme } from './formation/themes/ArmoryTheme.js';
import { DojoTheme } from './formation/themes/DojoTheme.js';
import { ClockworkTheme } from './formation/themes/ClockworkTheme.js';
import { PARCHMENT_COLORS } from '../ui/parchment/index.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { responsive } from '../core/Responsive.js';
import { getBattleFormationStyles } from './battleFormation/battleFormationStyles.js';
import { getNpcVisualIdentity, getPlayerCharacterIdentity } from '@shared/assetPaths.js';
import { installImageFallbackHandler } from '../utils/imageFallback.js';
import { withEquipmentStats } from '../utils/effectiveStats.js';

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
    this.rosterPlacementCharacterId = null; // One-shot explicit roster placement choice

    // Party data
    this.selectableCharacters = [];  // All party characters (slots 1-12), sorted by level
    this.enemies = [];               // Enemy preview data

    // Interaction state
    this.hoveredTile = null;
    this.longPressTimer = null;
    this.longPressThreshold = 500;
    this.pressedTile = null;
    this.justRemovedByLongPress = false;
    this.gridTouchGesture = null;

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

    // Scene lifecycle flag for async operation safety
    this._isActive = false;

    // Responsive subscription
    this.responsiveUnsubscribe = null;

    // DPR scaling for canvas (Finding 79)
    this.resizeObserver = null;
    this.logicalWidth = 400;
    this.logicalHeight = 220;

    // Coliseum-specific state
    this.coliseumMatchId = null;
    this.formationDeadline = null;
    this.formationCountdownInterval = null;
    this.opponentFormationSubmitted = false;
    this.formationSubmitted = false;
    this.opponentName = null;
    this.gridLocked = false;
    this.coliseumHandlers = null;
  }

  async enter(data = {}) {
    this._isActive = true;
    this.battleContext = data;
    this.abortController = new AbortController();

    // Determine node type and battle context
    this.nodeType = data.node?.node_type || 'forest';
    this.battleType = this.determineBattleType(data);

    // Initialize theme based on battle context
    this.initializeTheme();

    // Load battle party
    await this.loadBattleParty();
    if (!this._isActive) return; // Scene exited during async load

    // Preload character sprites for all party classes
    await this.preloadCharacterSprites();
    if (!this._isActive) return; // Scene exited during async load

    // The formation canvas uses the same canonical terrain source as battle.
    // Load its representative tile before the first frame so the preview does
    // not permanently fall back to a differently styled procedural diamond.
    await this.preloadFormationTerrain();
    if (!this._isActive) return; // Scene exited during async load

    // Load enemy preview data
    await this.loadEnemies(data);
    if (!this._isActive) return; // Scene exited during async load

    // Detect mobile layout using responsive singleton (mobile = <600px)
    this.isMobile = responsive.isMobile();

    // Create UI
    this.createUI();
    this.setupEventListeners();

    // Subscribe to responsive breakpoint changes
    this.responsiveUnsubscribe = responsive.onChange(() => this.onBreakpointChange());

    // Start animation loop
    this.startAnimationLoop();

    // Initial render
    this.updateUnplacedRoster();

    // Play appropriate music based on battle type
    if (this.game.musicContext) {
      if (this.battleType === 'coliseum') {
        this.game.musicContext.playColiseumTheme();
      } else if (this.battleType.startsWith('guild_')) {
        this.game.musicContext.playGuildAdvancement();
      } else {
        // Standard battle formation - keep exploration music
        this.game.musicContext.playExplorationMusic();
      }
    }

    // Coliseum-specific setup
    if (data.type === 'coliseum') {
      this.coliseumMatchId = data.matchId;
      this.formationDeadline = data.deadline;
      this.opponentName = data.opponentName || 'opponent';
      this.setupColiseumWebSocketHandlers();
    }
  }

  /**
   * Set up WebSocket handlers for coliseum formation phase
   */
  setupColiseumWebSocketHandlers() {
    if (!this.game.socket) return;

    this.coliseumHandlers = {
      'coliseum:opponent_formation_submitted': (payload) => {
        if (payload.matchId === this.coliseumMatchId) {
          this.opponentFormationSubmitted = true;
          this.updateStartButtonState();
        }
      },
      'coliseum:match_started': (payload) => {
        if (payload.battleId) {
          // Transition to battle scene
          this.game.scenes.switchTo('battle', {
            battleId: payload.battleId,
            mapSeed: payload.mapSeed,
            nodeType: 'arena',
            battleType: 'pvp',
            state: payload.state
          });
        }
      },
      'coliseum:formation_timeout': (payload) => {
        if (payload.matchId === this.coliseumMatchId) {
          parchmentToast.error('Formation Timeout', `You have been banned for ${Math.floor(payload.banDuration / 60000)} minutes`);
          this.game.scenes.switchTo('coliseum');
        }
      },
      'coliseum:match_cancelled': (payload) => {
        if (payload.matchId === this.coliseumMatchId) {
          parchmentToast.warning('Match Cancelled', payload.reason || 'Match was cancelled');
          this.game.scenes.switchTo('coliseum');
        }
      }
    };

    // Register handlers
    for (const [event, handler] of Object.entries(this.coliseumHandlers)) {
      this.game.socket.on(event, handler);
    }
  }

  exit() {
    this._isActive = false;
    this.stopAnimationLoop();

    // Unsubscribe from responsive changes
    if (this.responsiveUnsubscribe) {
      this.responsiveUnsubscribe();
      this.responsiveUnsubscribe = null;
    }

    // Disconnect ResizeObserver (Finding 79)
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clear long press timer if active
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }

    // Clean up coliseum WebSocket handlers
    if (this.coliseumHandlers && this.game.socket) {
      for (const [event, handler] of Object.entries(this.coliseumHandlers)) {
        this.game.socket.off(event, handler);
      }
      this.coliseumHandlers = null;
    }

    // Clear countdown interval
    if (this.formationCountdownInterval) {
      clearInterval(this.formationCountdownInterval);
      this.formationCountdownInterval = null;
    }

    // Reset coliseum state
    this.coliseumMatchId = null;
    this.formationDeadline = null;
    this.formationSubmitted = false;
    this.opponentFormationSubmitted = false;
    this.gridLocked = false;

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
      // Load all party characters (slots 1-12), sorted by level descending
      this.selectableCharacters = characters
        .filter(c => c.party_slot >= 1 && c.party_slot <= 12)
        .sort((a, b) => b.level - a.level);
    } catch (err) {
      console.error('Failed to load party characters:', err);
      this.selectableCharacters = [];
    }
  }

  /**
   * Preload character sprites for all distinct party visual identities.
   * Ensures sprites are in cache before FormationGrid tries to render them.
   * Only loads 'idle' animation as that's what the formation grid displays.
   *
   * @returns {Promise<void>} Resolves when all sprites are loaded (or failed gracefully)
   * @private
   */
  async preloadCharacterSprites() {
    const characters = [...new Map(
      this.selectableCharacters
        .filter(character => character.class)
        .map(character => [getPlayerCharacterIdentity(character).id, character])
    ).values()];

    if (characters.length === 0) return;

    const identities = characters.map(character => getPlayerCharacterIdentity(character).id);
    console.log(`[BattleFormationScene] Preloading sprites for: [${identities.join(', ')}]`);

    const promises = characters.map(character =>
      this.game.assetLoader.preloadCharacter(character, { animations: ['idle'] })
    );

    await Promise.allSettled(promises);
  }

  /**
   * Preload the representative floor tile used by the formation diorama.
   * @returns {Promise<void>}
   * @private
   */
  async preloadFormationTerrain() {
    const terrainByNode = {
      forest: 'grass',
      cave: 'stone',
      mountain: 'stone',
      bridge: 'stone',
      castle: 'stone',
      arena: 'stone'
    };
    const terrain = terrainByNode[this.nodeType] || 'grass';

    try {
      await this.game.assetLoader.loadTile?.(terrain, this.nodeType, 0);
    } catch (error) {
      console.warn('[BattleFormationScene] Formation terrain preload failed:', error);
    }
  }

  async loadEnemies(data) {
    if (data.node?.id) {
      try {
        const preview = await this.game.api.getEncounterPreview(data.node.id);
        this.enemies = preview.possibleEnemies || [];
        // Enemy levels are rolled at battle start; the preview only knows
        // the node's difficulty tier.
        this.encounterTier = Number.isFinite(Number(preview.difficultyTier))
          ? Number(preview.difficultyTier)
          : null;
      } catch (err) {
        console.error('Failed to load encounter preview:', err);
        this.enemies = [];
      }
    } else {
      this.enemies = [];
    }
  }

  createUI() {
    installImageFallbackHandler();

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

    // Start coliseum countdown if applicable
    if (this.battleType === 'coliseum' && this.formationDeadline) {
      this.startCountdown();
    }
  }

  /**
   * Start the formation countdown timer
   */
  startCountdown() {
    this.updateCountdownDisplay();
    this.formationCountdownInterval = setInterval(() => {
      this.updateCountdownDisplay();
    }, 1000);
  }

  /**
   * Update the countdown display
   */
  updateCountdownDisplay() {
    const timerValue = this.uiElement?.querySelector('#bf-timer-value');
    if (!timerValue) return;

    const remaining = Math.max(0, Math.ceil((this.formationDeadline - Date.now()) / 1000));
    timerValue.textContent = remaining;

    // Add urgent styling when low
    const timerContainer = this.uiElement?.querySelector('#bf-countdown-timer');
    if (timerContainer) {
      timerContainer.classList.toggle('urgent', remaining <= 5);
    }

    // Auto-submit if time runs out and we haven't submitted
    if (remaining <= 0 && !this.formationSubmitted && this.placedCharacters.size > 0) {
      this.submitColiseumFormation();
    }
  }

  getDesktopLayout(nodeName, themeTitle) {
    return `
      <!-- Header -->
      <div class="bf-formation-header">
        ${this.battleType !== 'coliseum' ? `
          <button class="bf-back-btn" id="bf-back-btn">
            <span class="bf-back-icon">&#8592;</span>
          </button>
        ` : ''}
        <div class="bf-header-titles">
          <h2 class="bf-battle-title-animated">${themeTitle}</h2>
          <div class="bf-node-name">${nodeName}</div>
        </div>
        ${this.battleType === 'coliseum' ? `
          <div class="bf-countdown-timer" id="bf-countdown-timer">
            <span class="bf-timer-label">Time remaining:</span>
            <span class="bf-timer-value" id="bf-timer-value">20</span>
          </div>
        ` : ''}
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
        ${this.battleType !== 'coliseum' ? `
          <button class="bf-back-btn" id="bf-back-btn">
            <span class="bf-back-icon">&#8592;</span>
          </button>
        ` : ''}
        <div class="bf-header-titles">
          <h2 class="bf-battle-title-animated bf-battle-title--mobile">${themeTitle}</h2>
        </div>
        ${this.battleType === 'coliseum' ? `
          <div class="bf-countdown-timer" id="bf-countdown-timer">
            <span class="bf-timer-label">Time:</span>
            <span class="bf-timer-value" id="bf-timer-value">20</span>
          </div>
        ` : ''}
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
          <span class="bf-sheet-title">Party (${this.selectableCharacters.length})</span>
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
      const npcIdentity = getNpcVisualIdentity(enemy, { fallbackBiome: this.nodeType });
      let levelHtml = '';
      if (enemy.level) {
        levelHtml = `<div class="bf-enemy-level">Lv.${escapeHtml(String(enemy.level))}</div>`;
      } else if (this.encounterTier) {
        levelHtml = `<div class="bf-enemy-level" title="Enemy levels are set when the battle starts">Tier ${this.encounterTier}</div>`;
      }
      const portraitUrl = this.game.assetLoader.getEnemyPortraitUrl(
        npcIdentity.visualId || 'unknown',
        40
      );

      return `
        <div class="bf-enemy-card ${threatClass}" data-enemy-index="${index}">
          <div class="bf-enemy-portrait">
            <img class="bf-enemy-portrait-img" src="${portraitUrl}" alt="${escapeHtml(enemy.name || '')}"
                 data-image-fallback data-fallback-display="flex">
            <div class="bf-enemy-icon" style="display: none;">${escapeHtml((enemy.name || '?').charAt(0))}</div>
            ${isBoss ? '<div class="bf-boss-indicator">&#9760;</div>' : ''}
          </div>
          <div class="bf-enemy-info">
            <div class="bf-enemy-name">${escapeHtml(enemy.name || '')}</div>
            ${levelHtml}
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
    this.formationGrid.setPlacedCharacters(this.placedCharacters);
    this.formationGrid.setHoveredTile(this.hoveredTile);
    this.formationGrid.setGridLocked(this.gridLocked);

    // Finding 79: Set up ResizeObserver for DPR scaling
    this.setupCanvasResizeObserver();
  }

  /**
   * Set up ResizeObserver for DPR-scaled canvas (Finding 79)
   */
  setupCanvasResizeObserver() {
    const gridArea = this.uiElement?.querySelector('.bf-grid-area');
    if (!gridArea || !this.gridCanvas) return;

    // createUI runs again on a breakpoint flip (rebuildUI); drop the observer
    // still watching the old, detached grid area
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCanvasForDPR();
    });
    this.resizeObserver.observe(gridArea);

    // Initial resize
    this.resizeCanvasForDPR();
  }

  /**
   * Resize canvas for device pixel ratio (Finding 79)
   */
  resizeCanvasForDPR() {
    if (!this.gridCanvas) return;

    const gridArea = this.uiElement?.querySelector('.bf-grid-area');
    if (!gridArea) return;

    const dpr = window.devicePixelRatio || 1;

    // Logical size for the available space, clamped to a usable minimum
    const size = computeFormationCanvasSize({
      clientWidth: gridArea.clientWidth,
      clientHeight: gridArea.clientHeight,
      isMobile: this.isMobile
    });
    if (!size) return; // not laid out yet; keep the current size
    const logicalW = size.width;
    const logicalH = size.height;

    // Store logical dimensions for coordinate conversion
    this.logicalWidth = logicalW;
    this.logicalHeight = logicalH;

    // Set CSS size (logical pixels)
    this.gridCanvas.style.width = `${logicalW}px`;
    this.gridCanvas.style.height = `${logicalH}px`;

    // Set backing store size (physical pixels)
    this.gridCanvas.width = Math.round(logicalW * dpr);
    this.gridCanvas.height = Math.round(logicalH * dpr);

    // Scale context for DPR
    const ctx = this.gridCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Update grid dimensions
    if (this.formationGrid) {
      this.formationGrid.setLogicalSize(logicalW, logicalH);
    }
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
        this.handleGridMouseUp();
        this.hoveredTile = null;
        this.formationGrid?.setHoveredTile(null);
      }, opts);

      // Long press for removal
      this.gridCanvas.addEventListener('mousedown', (e) => this.handleGridMouseDown(e), opts);
      this.gridCanvas.addEventListener('mouseup', () => this.handleGridMouseUp(), opts);

      // Touch support
      const touchOpts = { signal: this.abortController.signal, passive: false };
      this.gridCanvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (e.touches.length !== 1) {
          this.cancelGridTouchGesture();
          return;
        }
        const touch = e.touches[0];
        this.gridTouchGesture = {
          startX: touch.clientX,
          startY: touch.clientY,
          moved: false
        };
        this.handleGridMouseDown(touch);
        this.handleGridHover(touch);
      }, touchOpts);

      this.gridCanvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (!this.gridTouchGesture || e.touches.length !== 1) {
          this.cancelGridTouchGesture();
          return;
        }

        const touch = e.touches[0];
        const distance = Math.hypot(
          touch.clientX - this.gridTouchGesture.startX,
          touch.clientY - this.gridTouchGesture.startY
        );
        if (distance > 10) {
          this.gridTouchGesture.moved = true;
          this.handleGridMouseUp();
        }
        this.handleGridHover(touch);
      }, touchOpts);

      this.gridCanvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        const gesture = this.gridTouchGesture;
        const touch = e.changedTouches[0];
        const shouldTap = Boolean(
          gesture &&
          !gesture.moved &&
          !this.justRemovedByLongPress &&
          touch
        );
        this.handleGridMouseUp();
        this.gridTouchGesture = null;

        if (shouldTap) this.handleGridClick(touch);
        else this.justRemovedByLongPress = false;
      }, touchOpts);

      this.gridCanvas.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        this.cancelGridTouchGesture();
      }, touchOpts);
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
    // Prevent leaving during coliseum formation phase
    if (this.battleType === 'coliseum' && !this.formationSubmitted) {
      parchmentToast.warning('Cannot Leave', 'You must complete formation selection');
      return;
    }
    // Return to world map
    this.game.scenes.switchTo('worldMap');
  }

  handleResize() {
    // Legacy resize handler - breakpoint changes now handled by onBreakpointChange
    // Keep for any immediate viewport-related adjustments that don't require full rebuild
  }

  /**
   * Handle responsive breakpoint changes
   * Rebuilds UI when viewport size changes significantly
   */
  onBreakpointChange() {
    const wasMobile = this.isMobile;
    this.isMobile = responsive.isMobile();

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
    const savedRosterPlacementId = this.rosterPlacementCharacterId;

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
    this.rosterPlacementCharacterId = savedRosterPlacementId;

    this.updateGrid();
    this.formationGrid?.setHoveredTile(this.hoveredTile);
    this.formationGrid?.setGridLocked(this.gridLocked);
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
  /**
   * Get canvas point in logical (CSS) pixels
   * Finding 79: Returns CSS pixels, not device pixels, for correct DPR handling
   */
  getGridCanvasPoint(event) {
    if (!this.gridCanvas || !event) return null;
    if (Number.isFinite(event.canvasX) && Number.isFinite(event.canvasY)) {
      return { x: event.canvasX, y: event.canvasY };
    }

    const rect = this.gridCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const clientX = Number.isFinite(event.clientX)
      ? event.clientX
      : rect.left + (event.offsetX || 0);
    const clientY = Number.isFinite(event.clientY)
      ? event.clientY
      : rect.top + (event.offsetY || 0);

    // Return CSS pixels (Finding 79)
    // rect.width/height are in CSS pixels, which matches our logical coordinate space
    return {
      x: (clientX - rect.left) * (this.logicalWidth / rect.width),
      y: (clientY - rect.top) * (this.logicalHeight / rect.height)
    };
  }

  handleGridClick(e) {
    // Prevent grid interactions when locked (coliseum formation submitted)
    if (this.gridLocked) return;

    if (this.justRemovedByLongPress) {
      this.justRemovedByLongPress = false;
      return;
    }

    const point = this.getGridCanvasPoint(e);
    if (!point) return;
    const tile = this.formationGrid?.screenToGrid(point.x, point.y);
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
    const point = this.getGridCanvasPoint(e);
    if (!point) return;
    const tile = this.formationGrid?.screenToGrid(point.x, point.y);
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
    // Prevent grid interactions when locked (coliseum formation submitted)
    if (this.gridLocked) return;

    const point = this.getGridCanvasPoint(e);
    if (!point) return;
    const tile = this.formationGrid?.screenToGrid(point.x, point.y);
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

  cancelGridTouchGesture() {
    this.handleGridMouseUp();
    this.gridTouchGesture = null;
    this.justRemovedByLongPress = false;
  }

  // Character placement logic
  placeCharacterOnTile(gridKey) {
    // Prevent placement when grid is locked
    if (this.gridLocked) return;

    const placedEntries = Array.from(this.placedCharacters.entries());
    const placedIds = new Set(placedEntries.map(([, character]) => character.id));
    const unplaced = this.selectableCharacters.filter(c => !placedIds.has(c.id));

    // A roster selection is an explicit placement choice. If that character
    // is already on the board, clicking an empty tile moves them; otherwise it
    // places the selected unplaced character instead of silently choosing the
    // first member in sort order.
    const preferredId = this.rosterPlacementCharacterId;
    const selectedEntry = preferredId == null
      ? null
      : placedEntries.find(([, character]) => character.id === preferredId);

    if (selectedEntry) {
      const [previousKey, selected] = selectedEntry;
      this.placedCharacters.delete(previousKey);
      this.placementOrder = this.placementOrder.filter(key => key !== previousKey);
      this.placedCharacters.set(gridKey, selected);
      this.placementOrder.push(gridKey);
      this.selectedCharacter = selected;
      this.rosterPlacementCharacterId = null;
      this.updateDetailCard();
      return;
    }

    if (unplaced.length > 0) {
      const nextChar = unplaced.find(character => character.id === preferredId) || unplaced[0];

      if (this.placedCharacters.size >= 5) {
        const oldestKey = this.placementOrder.shift();
        this.placedCharacters.delete(oldestKey);
      }

      this.placedCharacters.set(gridKey, nextChar);
      this.placementOrder.push(gridKey);
      this.selectedCharacter = nextChar;
      this.rosterPlacementCharacterId = null;
      this.updateDetailCard();
      return;
    }

    if (this.selectableCharacters.length === 1 && this.placedCharacters.size === 1) {
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

      parchmentToast.info('Formation', `Moved ${charToMove.name}`);
    }
  }

  cycleCharacterOnTile(gridKey) {
    // Prevent cycling when grid is locked
    if (this.gridLocked) return;

    const currentChar = this.placedCharacters.get(gridKey);
    const currentIdx = this.selectableCharacters.findIndex(c => c.id === currentChar.id);

    const nextIdx = (currentIdx + 1) % this.selectableCharacters.length;
    const nextChar = this.selectableCharacters[nextIdx];

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

    parchmentToast.info('Formation', 'Character removed');
  }

  // UI updates
  updateGrid() {
    if (this.formationGrid) {
      this.formationGrid.setPlacedCharacters(this.placedCharacters);
    }
  }

  updateDetailCard() {
    if (this.characterCard && this.selectedCharacter) {
      // Transform API snake_case to camelCase for ParchmentCard. Stats
      // include equipped gear so the card matches what battle will use.
      const char = withEquipmentStats(this.selectedCharacter);
      this.characterCard.setCharacter({
        ...char,
        hp: char.hp_current,
        maxHp: char.hp_max,
        mp: char.mp_current,
        maxMp: char.mp_max
      });
    } else if (this.characterCard) {
      this.characterCard.setCharacter(null);
    }
  }

  updateStartButton() {
    this.updateStartButtonState();
  }

  /**
   * Update the start button state based on coliseum progress
   */
  updateStartButtonState() {
    if (!this.startButton) return;

    if (this.battleType === 'coliseum') {
      if (this.formationSubmitted) {
        // Show waiting state
        this.startButton.setWaitingState(true, this.opponentName);
        this.startButton.setDisabled(true);
      } else {
        this.startButton.setDisabled(this.placedCharacters.size === 0);
      }
    } else {
      this.startButton.setDisabled(this.placedCharacters.size === 0);
    }
  }

  updateTension() {
    if (this.theme) {
      this.theme.updateTension(this.placedCharacters.size, this.selectableCharacters.length);
    }
  }

  updateUnplacedRoster() {
    installImageFallbackHandler();

    const roster = this.uiElement?.querySelector('#bf-unplaced-roster');
    if (!roster) return;

    const placedIds = new Set(
      Array.from(this.placedCharacters.values()).map(c => c.id)
    );
    const unplaced = this.selectableCharacters.filter(c => !placedIds.has(c.id));

    if (unplaced.length === 0 && this.placedCharacters.size > 0) {
      roster.innerHTML = '<div class="bf-all-placed">All characters placed!</div>';
      return;
    }

    roster.innerHTML = this.selectableCharacters.map(char => {
      const isPlaced = placedIds.has(char.id);
      const isSelected = this.selectedCharacter?.id === char.id;
      const portraitUrl = this.game.assetLoader.getPortraitUrl(char, 40);

      return `
        <div class="bf-roster-char ${isPlaced ? 'placed' : ''} ${isSelected ? 'selected' : ''}"
             data-char-id="${char.id}">
          <div class="bf-roster-portrait">
            <img src="${portraitUrl}" alt="${escapeHtml(char.name || '')}"
                 data-image-fallback data-fallback-display="flex">
            <div class="bf-roster-fallback" style="display:none; background:${this.getClassColor(char.class)}">
              ${this.getClassIcon(char.class)}
            </div>
            ${isPlaced ? '<div class="bf-placed-check">&#10003;</div>' : ''}
          </div>
          <div class="bf-roster-name">${escapeHtml(char.name || '')}</div>
        </div>
      `;
    }).join('');

    // Attach click handlers
    roster.querySelectorAll('.bf-roster-char').forEach(el => {
      el.addEventListener('click', () => {
        const charId = el.dataset.charId;
        const char = this.selectableCharacters.find(c => String(c.id) === charId);
        if (char) {
          this.selectedCharacter = char;
          this.rosterPlacementCharacterId = char.id;
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
      parchmentToast.warning('Formation', 'Place at least one character!');
      return;
    }

    // For coliseum, submit formation via WebSocket
    if (this.battleType === 'coliseum') {
      await this.submitColiseumFormation();
      return;
    }

    // Standard PvE flow
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
      parchmentToast.error('Battle Error', err.message || 'Failed to start battle');
    }
  }

  /**
   * Submit formation for coliseum match
   */
  async submitColiseumFormation() {
    if (this.formationSubmitted) return;

    const formation = {};
    for (const [key, char] of this.placedCharacters) {
      const [x, y] = key.split(',').map(Number);
      formation[char.id] = { tileX: x, tileY: y };
    }

    this.formationSubmitted = true;
    this.gridLocked = true;

    // Send formation via WebSocket
    if (this.game.socket) {
      this.game.socket.send('coliseum_formation_submit', {
        matchId: this.coliseumMatchId,
        formation
      });
    }

    // Update button state
    this.updateStartButtonState();

    // Visual feedback
    this.formationGrid?.setGridLocked?.(true);
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
    style.textContent = getBattleFormationStyles();
    document.head.appendChild(style);
  }

  update(_deltaTime) {
    // Main update handled by animation loop
  }

  render(ctx) {
    // Draw parchment-themed background gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, this.game.targetHeight);
    gradient.addColorStop(0, P.light);
    gradient.addColorStop(0.5, P.mid);
    gradient.addColorStop(1, P.dark);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.game.targetWidth, this.game.targetHeight);

    // Add subtle corner flourishes
    ctx.save();
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
    ctx.moveTo(this.game.targetWidth - 20, 60);
    ctx.quadraticCurveTo(this.game.targetWidth - 20, 20, this.game.targetWidth - 60, 20);
    ctx.stroke();

    // Bottom-left flourish
    ctx.beginPath();
    ctx.moveTo(20, this.game.targetHeight - 60);
    ctx.quadraticCurveTo(20, this.game.targetHeight - 20, 60, this.game.targetHeight - 20);
    ctx.stroke();

    // Bottom-right flourish
    ctx.beginPath();
    ctx.moveTo(this.game.targetWidth - 20, this.game.targetHeight - 60);
    ctx.quadraticCurveTo(this.game.targetWidth - 20, this.game.targetHeight - 20, this.game.targetWidth - 60, this.game.targetHeight - 20);
    ctx.stroke();

    ctx.restore();
  }
}
