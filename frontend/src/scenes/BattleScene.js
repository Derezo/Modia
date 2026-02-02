/**
 * @module BattleScene
 * @description Orchestrates tactical turn-based combat on an isometric grid with camera system.
 *
 * Key responsibilities:
 * - Battle initialization and state management (units, turns, actions)
 * - Isometric grid rendering with terrain and unit display
 * - Unit movement with height animation and occlusion transparency
 * - Action submission and turn management
 * - Camera control and battle intro/outro sequences
 *
 * Height Movement:
 * - Units animate with parabolic arc when moving between elevations
 * - Shadow follows terrain surface during movement
 * - Occlusion cache updates per-frame for transparent blocking tiles
 *
 * @see BattleInputHandler.js - Mouse/touch/keyboard input and tile cycling
 * @see BattleWebSocketManager.js - Real-time event handling
 * @see BattleAudioManager.js - Audio playback and music management
 * @see BattleGrid.js - Grid rendering and coordinate conversion
 * @see BattleUnit.js - Unit state, animation, and elevation tracking
 * @see BattleUI.js - HUD elements and action menus
 * @see BattleCamera.js - Viewport and follow behavior
 */
import { Scene } from './Scene.js';
import { BattleGrid } from '../battle/BattleGrid.js';
import { BattleUnit } from '../battle/BattleUnit.js';
import { BattleUI } from '../battle/BattleUI.js';
import { BattleAnimations, ANIMATION_TIMING } from '../battle/BattleAnimations.js';
import { BattlePathfinding } from '../battle/BattlePathfinding.js';
import { BattleCamera } from '../battle/BattleCamera.js';
import { BattleIntro } from '../battle/BattleIntro.js';
import { BattleOutroSequence } from '../battle/BattleOutroSequence.js';
import { RadialMenu } from '../battle/RadialMenu.js';
import { BattleActionBar } from '../battle/BattleActionBar.js';
import { TerrainTooltip } from '../battle/TerrainTooltip.js';
import { BattleContextMenu } from '../battle/BattleContextMenu.js';
import { GridCursor } from '../battle/GridCursor.js';
import { BossPhaseIndicator } from '../battle/BossPhaseIndicator.js';
import { BattleWebSocketManager } from '../battle/BattleWebSocketManager.js';
import { BattleInputHandler } from '../battle/BattleInputHandler.js';
import { BattleAudioManager } from '../battle/BattleAudioManager.js';
import { isSelfTargetingSkill, getVisualCategory } from '../battle/SkillEffectCategories.js';
import { calculateDamagePreview, calculateItemPreview } from '@shared/battleMath.js';
import { CLASS_MOVEMENT } from '@shared/constants.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { BattleLoadingScreen } from '../ui/parchment/BattleLoadingScreen.js';

/**
 * BattleScene - Tactical turn-based combat on an isometric grid with camera
 */
export class BattleScene extends Scene {
  constructor(game) {
    super(game);

    // Battle state
    this.battleId = null;
    this.battleState = null;
    this.mapSeed = null;
    this.nodeType = null; // Node type for terrain generation (forest, mountain, etc.)

    // Components
    this.grid = null;
    this.units = new Map();
    this.ui = null;
    this.animations = null;
    this.pathfinding = null;
    this.camera = null;
    this.intro = null;
    this.isIntroPlaying = false;
    this.radialMenu = null;

    // Interaction state
    this.selectedUnit = null;
    this.hoveredTile = null;
    this.currentAction = null; // 'move' | 'attack' | 'skill' | 'item'
    this.rewardsModal = null;
    this.validTiles = [];
    this.pendingAction = null;
    this.selectedSkillId = null;
    this.selectedItemId = null;
    this.selectedInventoryId = null;
    this.lockedTarget = null; // { tile: {x,y}, unit: <unit or null> } - prevents tile cycling during targeting

    // Mobile/touch support for terrain preview
    this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.selectedMoveTile = null; // For two-tap movement on mobile

    // Input handler manages mouse/touch/keyboard events and tile cycling
    this.inputHandler = null;

    // Movement range (base value, could be modified by stats)
    this.movementRange = 3;
    this.attackRange = 1;

    // Two-action turn state
    this.canMove = true;
    this.canAct = true;
    this.turnPhase = 'ready'; // 'ready' | 'partial' | 'done'

    // Turn transition tracking
    this.lastActiveUnitId = null;
    this.wsHandledTurnTransition = false; // Prevents duplicate camera pan when WebSocket already handled it
    this.inEnemySequence = false; // Track if we're in a sequence of enemy turns
    this.lastTurnWasEnemy = false; // Track if previous turn was enemy

    // WebSocket manager handles turn events and synchronization
    this.wsManager = null;
    this.playerTurnPending = false; // True when player's turn is queued but not yet shown

    // Audio manager handles all battle audio/music
    this.audioManager = new BattleAudioManager(this);

    // Battle end state
    this.battleEnded = false;
    this.outroSequence = null;

    // Boss phase indicator
    this.bossPhaseIndicator = null;
    this.isBossBattle = false;
    this.guildmasterData = null;

    // Battle log turn counter
    this.battleLogTurnCounter = 0;

    // Asset loading state - prevents rendering before terrain sprites are cached
    this.isLoadingAssets = true;

    // Loading screen overlay with progress
    this.loadingScreen = null;
  }

  /**
   * Enter the battle scene
   */
  async enter(data) {
    // data = { battleId, mapSeed, mapWidth, mapHeight, state, initialEnemyActions, battleType, opponentUsername, nodeType }
    this.battleId = data.battleId;
    this.mapSeed = data.mapSeed;
    this.battleState = data.state;
    this.nodeType = data.nodeType || null; // Store nodeType from server for terrain generation
    this.initialEnemyActions = data.initialEnemyActions || null;
    this.battleType = data.battleType || 'pve'; // 'pve', 'pvp', 'pvp_coliseum', 'pve_coop'
    this.opponentUsername = data.opponentUsername || null;
    // Detect PvP: explicit battleType OR player2Id present in state (indicates two human players)
    this.isPvP = this.battleType === 'pvp' ||
                 this.battleType === 'pvp_coliseum' ||
                 data.state?.player2Id != null;
    this.isBossBattle = data.isBossBattle || false;
    this.guildmasterData = data.guildmaster || null;

    // Reset battle end state for new battle (scene instances are reused)
    this.battleEnded = false;
    this.outroSequence = null;

    // PvP turn timer state
    this.pvpTurnTimer = null;
    this.pvpTurnDeadline = null;

    // Initialize grid with asset loader for sprite rendering
    this.grid = new BattleGrid(this.game.canvas, data.mapWidth || 32, data.mapHeight || 32);
    this.grid.setAssetLoader(this.game.assetLoader);
    this.grid.generateTerrain(this.mapSeed, this.getNodeType());

    // Initialize animations
    this.animations = new BattleAnimations();

    // Initialize pathfinding (needs units reference)
    this.pathfinding = new BattlePathfinding(this.grid, this.units);

    // Create units from battle state
    this.initializeUnits(data.state.units);

    // Preload terrain tiles, obstacles, and enemy sprites
    // Block rendering until assets are cached to avoid fallback diamond rendering
    this.isLoadingAssets = true;
    const nodeType = this.getNodeType();

    // Create and show loading screen
    this.loadingScreen = new BattleLoadingScreen(this.game);
    this.loadingScreen.show();

    // Debug: log unit data to see enemyId values
    console.log('[BattleScene] Unit data from server:', data.state.units.map(u => ({
      id: u.id, name: u.name, type: u.type, enemyId: u.enemyId, biome: u.biome
    })));

    const enemyIds = [...new Set(
      data.state.units
        .filter(u => u.type === 'enemy' && u.enemyId)
        .map(u => u.enemyId)
    )];
    console.log(`[BattleScene] Enemy IDs to preload: [${enemyIds.join(', ')}]`);

    // Also collect player character classes to preload
    const playerClasses = [...new Set(
      data.state.units
        .filter(u => u.type === 'player' && u.class)
        .map(u => u.class.toLowerCase())
    )];
    console.log(`[BattleScene] Player classes to preload: [${playerClasses.join(', ')}]`);

    // Estimate total assets for accurate progress bar
    const { AssetLoader } = await import('../core/AssetLoader.js');
    const terrainCount = AssetLoader.TERRAIN_TYPES.length * AssetLoader.VARIANTS_PER_TERRAIN + 9; // +9 for walls
    const obstacleCount = 10; // rocks + trees
    const enemyCount = enemyIds.length * 4; // 4 animations each
    const playerCount = playerClasses.length * 5; // 5 animations each
    const totalAssets = terrainCount + obstacleCount + enemyCount + playerCount;
    let loadedTotal = 0;

    const makeProgressCallback = (phase) => () => {
      loadedTotal++;
      this.loadingScreen.updateProgress(loadedTotal, totalAssets, phase);
    };

    // AWAIT preload to ensure terrain sprites are cached before rendering
    try {
      await Promise.all([
        this.game.assetLoader.preloadTerrainSet(nodeType, {
          onProgress: makeProgressCallback('Loading terrain...')
        }),
        this.game.assetLoader.preloadObstacles({
          onProgress: makeProgressCallback('Loading obstacles...')
        }),
        this.game.assetLoader.preloadEnemies(nodeType, enemyIds, {
          onProgress: makeProgressCallback('Loading enemies...')
        }),
        ...playerClasses.map(cls =>
          this.game.assetLoader.preloadCharacter(cls, {
            onProgress: makeProgressCallback('Loading characters...')
          })
        )
      ]);
      console.log(`[BattleScene] Preloaded terrain, obstacles, ${enemyIds.length} enemy types, and ${playerClasses.length} player classes for ${nodeType}`);

      // Reinitialize unit sprites now that assets are loaded
      for (const unit of this.units.values()) {
        unit.initializeSprites();
      }
    } catch (err) {
      console.warn('[BattleScene] Asset preload failed:', err.message);
      // Continue anyway - fallback diamond rendering will work
    }

    this.isLoadingAssets = false;
    this.loadingScreen.hide();

    // Initialize camera after units so we can center on first player
    this.camera = new BattleCamera(this.game.canvas.width, this.game.canvas.height);
    const mapDimensions = this.grid.getMapPixelDimensions();
    this.camera.setBoundsFromWorld(
      mapDimensions.worldMinX,
      mapDimensions.worldMinY,
      mapDimensions.worldMaxX,
      mapDimensions.worldMaxY
    );

    // Center camera on the first player unit (or map center if no players)
    const firstPlayer = Array.from(this.units.values()).find(u => u.type === 'player');
    if (firstPlayer) {
      this.camera.centerOn(firstPlayer.screenX, firstPlayer.screenY, true);
    } else {
      const mapCenter = this.grid.getMapCenter();
      this.camera.centerOn(mapCenter.x, mapCenter.y, true);
    }

    // Update pathfinding with units
    this.pathfinding.setUnits(this.units);

    // Initialize UI
    this.ui = new BattleUI(this.game);
    this.ui.create(this.battleState, {
      onMove: () => this.startMoveAction(),
      onAttack: () => this.startAttackAction(),
      onSkill: () => this.showSkillMenu(),
      onSelectSkill: (skillId) => this.startSkillAction(skillId),
      onItem: () => this.showItemMenu(),
      onSelectItem: (itemData) => this.startItemAction(itemData),
      onWait: () => this.submitAction('wait'),
      onConfirm: () => this.confirmAction(),
      onCancel: () => this.cancelAction(),
      onContinue: () => this.endBattle(),
      onSurrender: () => this.handleSurrender(),
      onUnitPreview: (unit) => this.handleUnitPreview(unit)
    });

    // Enable PvP mode if this is a PvP battle
    if (this.isPvP) {
      this.ui.enablePvPMode();
    }

    // Initialize radial action menu (contextual, shown on unit click)
    this.radialMenu = new RadialMenu(this.game);
    this.radialMenu.create({
      onMove: () => this.startMoveAction(),
      onAttack: () => this.startAttackAction(),
      onWait: () => this.submitAction('wait'),
      onCancel: () => this.cancelAction(),
      onSkillSelect: (skillId) => this.startSkillAction(skillId),
      onItemSelect: (itemData) => this.startItemAction(itemData),
      getSkills: () => this.getActiveUnitSkillsForRadial(),
      getItems: () => this.getActiveUnitItemsForRadial()
    });

    // Initialize persistent action bar (always visible during player turn)
    this.actionBar = new BattleActionBar(this.game);
    this.actionBar.create({
      onMove: () => this.startMoveAction(),
      onAttack: () => this.startAttackAction(),
      onWait: () => this.submitAction('wait'),
      onCancel: () => this.cancelAction(),
      onSkillSelect: (skillId) => this.startSkillAction(skillId),
      onItemSelect: (itemData) => this.startItemAction(itemData),
      getSkills: () => this.getActiveUnitSkillsForRadial(),
      getItems: () => this.getActiveUnitItemsForRadial()
    });

    // Initialize FFT-style context menu (shown on right-click or unit click on desktop)
    this.contextMenu = new BattleContextMenu(this.game);
    this.contextMenu.create({
      onMove: () => this.startMoveAction(),
      onAttack: () => this.startAttackAction(),
      onWait: () => this.submitAction('wait'),
      onCancel: () => this.cancelAction(),
      onSkillSelect: (skillId) => this.startSkillAction(skillId),
      onItemSelect: (itemData) => this.startItemAction(itemData),
      getSkills: () => this.getActiveUnitSkillsForRadial(),
      getItems: () => this.getActiveUnitItemsForRadial()
    });

    // Initialize grid cursor for keyboard navigation
    this.gridCursor = new GridCursor(this.game, this.grid);
    this.gridCursor.create({
      onMove: (x, y) => this.handleCursorMove(x, y),
      onSelect: (x, y) => this.handleCursorSelect(x, y),
      onCycleUnit: (direction) => this.handleCycleUnit(direction),
      isMenuOpen: () => this.isAnyMenuOpen()
    });

    // Initialize boss phase indicator if this is a boss battle
    this.initializeBossIndicator();

    // Initialize terrain tooltip (DOM-based)
    this.terrainTooltip = new TerrainTooltip();
    this.terrainTooltip.attachTo(this.game.container);

    // Setup input handler for mouse/touch/keyboard events
    this.inputHandler = new BattleInputHandler(this);
    this.inputHandler.setup();

    // Setup WebSocket handlers for real-time events
    this.setupWebSocketHandlers();

    // Start battle intro sequence
    this.intro = new BattleIntro(this);
    this.intro.start();
    this.isIntroPlaying = true;
    this.ui.hide(); // Hide action menu during intro

    // Start battle music using MusicContext for region-aware playback
    this.audioManager.playBattleMusic();

    // Update UI with initial state (will show after intro)
    this.updateUI();
  }

  /**
   * Exit the battle scene
   */
  exit() {
    // Clean up input handler (events and tile cycling timers)
    if (this.inputHandler) {
      this.inputHandler.cleanup();
      this.inputHandler = null;
    }

    // Clean up PvP turn timer
    if (this.pvpTurnTimer) {
      clearInterval(this.pvpTurnTimer);
      this.pvpTurnTimer = null;
    }

    // Clean up WebSocket handlers
    this.cleanupWebSocketHandlers();

    if (this.ui) {
      this.ui.destroy();
      this.ui = null;
    }

    if (this.radialMenu) {
      this.radialMenu.destroy();
      this.radialMenu = null;
    }

    if (this.actionBar) {
      this.actionBar.destroy();
      this.actionBar = null;
    }

    if (this.contextMenu) {
      this.contextMenu.destroy();
      this.contextMenu = null;
    }

    if (this.gridCursor) {
      this.gridCursor.destroy();
      this.gridCursor = null;
    }

    if (this.grid) {
      this.grid.destroy();
      this.grid = null;
    }

    if (this.bossPhaseIndicator) {
      this.bossPhaseIndicator.destroy();
      this.bossPhaseIndicator = null;
    }

    if (this.terrainTooltip) {
      this.terrainTooltip.destroy();
      this.terrainTooltip = null;
    }

    if (this.rewardsModal) {
      this.rewardsModal.destroy();
      this.rewardsModal = null;
    }

    if (this.loadingScreen) {
      this.loadingScreen.destroy();
      this.loadingScreen = null;
    }

    this.units.clear();
    this.validTiles = [];
    this.currentAction = null;
    this.selectedUnit = null;
  }

  /**
   * Get node type for terrain generation
   * Prioritizes nodeType from battle data over game state
   */
  getNodeType() {
    // Prefer nodeType from server (set in enter())
    if (this.nodeType) {
      return this.nodeType;
    }
    // Fall back to game state for backwards compatibility
    const currentNode = this.game.state.get('currentNode');
    return currentNode?.node_type || 'forest';
  }

  /**
   * Initialize boss phase indicator if this is a boss battle
   */
  initializeBossIndicator() {
    // Check for boss in battle state
    const bossUnit = this.battleState.units.find(u => u.isBoss || u.type === 'enemy' && u.maxPhases > 1);

    // Also check guildmaster data from advancement battle
    if (this.guildmasterData || bossUnit) {
      const bossData = {
        name: this.guildmasterData?.name || bossUnit?.name || 'Boss',
        title: this.guildmasterData?.title || bossUnit?.title || null,
        currentPhase: this.guildmasterData?.currentPhase || bossUnit?.currentPhase || 1,
        maxPhases: this.guildmasterData?.maxPhases || bossUnit?.maxPhases || 1,
        phaseName: bossUnit?.phaseName || 'Phase 1',
        hp: bossUnit?.hp || 100,
        maxHp: bossUnit?.maxHp || 100
      };

      this.bossPhaseIndicator = new BossPhaseIndicator(this.game);
      this.bossPhaseIndicator.create(bossData);
      this.isBossBattle = true;

      console.log('[BattleScene] Boss indicator created:', bossData);
    }
  }

  /**
   * Handle boss phase transition from WebSocket
   * @param {Object} payload - Phase transition data
   */
  handleBossPhaseTransition(payload) {
    console.log('[BattleScene] Boss phase transition:', payload);

    if (this.bossPhaseIndicator) {
      this.bossPhaseIndicator.playPhaseTransition({
        newPhase: payload.newPhase,
        phaseName: payload.phaseName,
        message: payload.message
      });
    }

    // Update the boss unit in our local state
    const bossUnit = this.units.get(payload.bossId);
    if (bossUnit) {
      bossUnit.currentPhase = payload.newPhase;
      bossUnit.phaseName = payload.phaseName;
    }
  }

  /**
   * Update boss HP display
   * @param {string} bossId - Boss unit ID
   * @param {number} newHp - New HP value
   */
  updateBossHp(bossId, newHp) {
    if (this.bossPhaseIndicator) {
      const bossUnit = this.units.get(bossId);
      if (bossUnit) {
        this.bossPhaseIndicator.update({
          hp: newHp,
          maxHp: bossUnit.maxHp
        });
      }
    }
  }

  /**
   * Initialize units from battle state
   */
  initializeUnits(unitData) {
    this.units.clear();

    for (const data of unitData) {
      const unit = new BattleUnit(data, this.grid);
      this.units.set(data.id, unit);

      // Set asset loader for sprite rendering
      if (this.game.assetLoader) {
        unit.setAssetLoader(this.game.assetLoader);
      }
    }
  }

  /**
   * Setup WebSocket handlers for real-time battle events
   */
  setupWebSocketHandlers() {
    // Defensive cleanup to prevent handler stacking if setup is called twice
    if (this.wsManager) {
      this.wsManager.cleanup();
    }
    this.wsManager = new BattleWebSocketManager(this);
    this.wsManager.setup();
  }

  /**
   * Clean up WebSocket handlers
   */
  cleanupWebSocketHandlers() {
    if (this.wsManager) {
      this.wsManager.cleanup();
      this.wsManager = null;
    }
  }

  // Getters and delegates for WebSocket manager state access
  get isProcessingQueue() {
    return this.wsManager?.isProcessingQueue ?? false;
  }

  get turnEventQueue() {
    return this.wsManager?.turnEventQueue ?? [];
  }

  /**
   * Queue a turn event for sequential processing (delegates to wsManager)
   */
  queueTurnEvent(event) {
    if (this.wsManager) {
      this.wsManager.queueTurnEvent(event);
    }
  }

  /**
   * Add an entry to the battle log
   * @param {Object} actor - The unit performing the action
   * @param {string} actionType - Type of action (attack, skill, move, wait, item)
   * @param {Object} target - The target unit (optional)
   * @param {Object} result - The action result
   */
  addBattleLogEntry(actor, actionType, target, result) {
    if (!this.ui) return;

    // Build log entry with full portrait data for rendering
    const entry = {
      timestamp: Date.now(),
      turn: this.battleLogTurnCounter || 1,
      actor: actor ? {
        id: actor.id,
        name: actor.name,
        isPlayer: actor.type === 'player',
        // Portrait data for rendering
        type: actor.type,
        race: actor.race,
        gender: actor.gender,
        class: actor.class,
        enemyId: actor.enemyId
      } : { name: 'Unknown', isPlayer: false },
      action: {
        type: actionType,
        name: this.getActionName(actionType, result)
      },
      element: result?.element || 'physical',
      target: target ? {
        id: target.id,
        name: target.name,
        isPlayer: target.type === 'player',
        // Portrait data for rendering
        type: target.type,
        race: target.race,
        gender: target.gender,
        class: target.class,
        enemyId: target.enemyId
      } : null,
      result: {
        damage: result?.damage || 0,
        baseDamage: result?.baseDamage || null,
        critBonus: result?.critBonus || null,
        isCritical: result?.isCritical || false,
        missed: result?.missed || false,
        healing: result?.healing || 0,
        mpRestored: result?.mpRestored || 0,
        statusApplied: result?.statusApplied || null,
        damageType: result?.damageType || 'physical'
      }
    };

    // For movement, add position data if available
    if (actionType === 'move' && result?.from && result?.to) {
      entry.result.from = result.from;
      entry.result.to = result.to;
    }

    this.ui.addBattleLogEntry(entry);
  }

  /**
   * Get a display name for an action
   * @param {string} actionType - The action type
   * @param {Object} result - The action result (may contain skill/item name)
   * @returns {string} Display name
   */
  getActionName(actionType, result) {
    switch (actionType) {
      case 'attack':
        return 'Attack';
      case 'skill':
        return result?.skillName || 'Skill';
      case 'move':
        return 'Move';
      case 'wait':
        return 'Wait';
      case 'item':
        return result?.itemName || 'Item';
      default:
        return actionType;
    }
  }

  /**
   * Handle click on a tile
   * @param {number} x - Tile X coordinate
   * @param {number} y - Tile Y coordinate
   * @param {Object} mousePos - Optional mouse position { mouseX, mouseY } for context menu
   */
  handleTileClick(x, y, mousePos = null) {
    // If there's a pending action awaiting confirmation
    if (this.pendingAction) {
      const target = this.pendingAction.targetTile;
      if (target.x === x && target.y === y) {
        // Clicking the same target tile again = confirm
        this.confirmAction();
        return;
      } else {
        // Clicking elsewhere = cancel
        this.cancelAction();
        return;
      }
    }

    // Check if clicking on active player unit - show action menu
    // In PvP, only show for local player's units
    const activeUnit = this.getActiveUnit();
    const localUserId = this.game.localUserId;
    const isLocalUnit = this.isPvP
      ? activeUnit?.isLocalPlayerUnit(localUserId)
      : activeUnit?.type === 'player';
    if (!this.currentAction && activeUnit && isLocalUnit) {
      if (x === activeUnit.gridX && y === activeUnit.gridY) {
        this.showActionMenu(mousePos);
        return;
      }
    }

    // Check if click is on a valid tile for current action
    const isValidTile = this.validTiles.some(t => t.x === x && t.y === y);

    if (this.currentAction === 'move' && isValidTile) {
      // Two-tap support for mobile: first tap selects, second tap confirms
      if (this.isTouchDevice) {
        const isSameTile = this.selectedMoveTile &&
          this.selectedMoveTile.x === x && this.selectedMoveTile.y === y;

        if (isSameTile) {
          // Second tap on same tile - confirm move
          this.selectedMoveTile = null;
          this.pendingAction = { type: 'move', targetTile: { x, y } };
          this.ui.showConfirmation(`Move to (${x}, ${y})?`);
        } else {
          // First tap or different tile - select for preview
          this.selectedMoveTile = { x, y };
          // Don't show confirmation yet, just show tooltip
        }
      } else {
        // Desktop: immediate confirmation dialog
        this.pendingAction = { type: 'move', targetTile: { x, y } };
        this.ui.showConfirmation(`Move to (${x}, ${y})?`);
      }
    } else if (this.currentAction === 'move' && !isValidTile && this.isTouchDevice) {
      // Tapped outside valid area on mobile - clear selection
      this.selectedMoveTile = null;
    } else if (this.currentAction === 'attack' && isValidTile) {
      // Tile-based targeting: allow attacking any valid tile
      const target = this.getUnitAt(x, y);
      this.pendingAction = { type: 'attack', targetTile: { x, y }, target };
      // Lock target to prevent tile cycling from changing it during confirmation
      this.lockedTarget = { tile: { x, y }, unit: target };

      // Confirm message based on target
      if (target) {
        this.ui.showConfirmation(`Attack ${target.name}?`);
      } else {
        this.ui.showConfirmation('Attack empty tile?');
      }
    } else if (this.currentAction === 'skill' && isValidTile) {
      // Tile-based skill targeting
      const target = this.getUnitAt(x, y);
      const skill = this.getUnitActiveSkills(this.getActiveUnit()).find(s => s.id === this.selectedSkillId);
      this.pendingAction = { type: 'skill', targetTile: { x, y }, target, skillId: this.selectedSkillId };
      // Lock target to prevent tile cycling from changing it during confirmation
      this.lockedTarget = { tile: { x, y }, unit: target };

      // Confirm message based on target
      if (target) {
        this.ui.showConfirmation(`Use ${skill?.name || 'skill'} on ${target.name}?`);
      } else {
        this.ui.showConfirmation(`Use ${skill?.name || 'skill'} on tile?`);
      }
    } else if (this.currentAction === 'item' && isValidTile) {
      // Item targeting (allies only)
      const target = this.getUnitAt(x, y);
      if (!target || target.type !== 'player') {
        parchmentToast.warning('Invalid Target', 'Must target an ally');
        return;
      }
      const item = (this.battleState.consumables || []).find(i => i.itemId === this.selectedItemId);
      this.pendingAction = { type: 'item', targetTile: { x, y }, target, itemId: this.selectedItemId };
      // Lock target to prevent tile cycling from changing it during confirmation
      this.lockedTarget = { tile: { x, y }, unit: target };

      this.ui.showConfirmation(`Use ${item?.name || 'item'} on ${target.name}?`);
    }
  }

  /**
   * Start move action - show valid movement tiles
   */
  startMoveAction() {
    // Two-action system: check if move is available
    if (!this.canMove) {
      parchmentToast.warning('Action Used', 'Already moved this turn');
      return;
    }

    this.hideRadialMenu();
    this.currentAction = 'move';
    const activeUnit = this.getActiveUnit();

    if (activeUnit) {
      // Prefer server-provided reachable tiles if available
      if (this.serverAvailableActions?.movement?.reachableTiles) {
        this.validTiles = this.serverAvailableActions.movement.reachableTiles;
      } else {
        // Fall back to client-side pathfinding
        this.validTiles = this.pathfinding.getReachableTiles(
          activeUnit.gridX,
          activeUnit.gridY,
          this.movementRange
        );
      }
    }

    this.ui.setActionsEnabled(false);
    this.ui.showTargetingMode();
  }

  /**
   * Start attack action - show valid attack targets
   */
  startAttackAction() {
    // Two-action system: check if act is available
    if (!this.canAct) {
      parchmentToast.warning('Action Used', 'Already acted this turn');
      return;
    }

    this.hideRadialMenu();
    this.currentAction = 'attack';
    const activeUnit = this.getActiveUnit();

    if (activeUnit) {
      // Prefer server-provided attack targets if available
      if (this.serverAvailableActions?.attacks?.targets) {
        // Convert server targets to tile format
        this.validTiles = this.serverAvailableActions.attacks.targets.map(t => ({
          x: t.tileX ?? t.x,
          y: t.tileY ?? t.y,
          unitId: t.id,
          distance: t.distance
        }));
      } else {
        // Fall back to client-side calculation
        this.validTiles = this.pathfinding.getAttackableTiles(
          activeUnit.gridX,
          activeUnit.gridY,
          this.attackRange
        );
      }
    }

    this.ui.setActionsEnabled(false);
    this.ui.showTargetingMode();
  }

  /**
   * Show skill selection menu
   */
  showSkillMenu() {
    // Two-action system: check if act is available
    if (!this.canAct) {
      parchmentToast.warning('Action Used', 'Already acted this turn');
      return;
    }

    const activeUnit = this.getActiveUnit();
    if (!activeUnit) return;

    // Get active skills for this unit
    const skills = this.getUnitActiveSkills(activeUnit);
    this.ui.showSkillPanel(skills, activeUnit.mp);
  }

  /**
   * Get active (usable in combat) skills for a unit
   * @param {Object} unit - The unit to get skills for
   * @returns {Array} Array of skill objects
   */
  getUnitActiveSkills(unit) {
    // Use skills from battle state (loaded from character_skills)
    if (unit.skills && unit.skills.length > 0) {
      // Add icons based on skill type/name for display
      return unit.skills.filter(s => s.type === 'active').map(skill => ({
        ...skill,
        icon: this.getSkillIcon(skill.id, unit.class)
      }));
    }

    // Fallback: return empty array if no skills learned
    // (Character needs to learn skills via Formation → Skills tab)
    return [];
  }

  /**
   * Get icon for a skill based on its ID and class
   * @param {string} skillId - The skill ID
   * @param {string} unitClass - The unit's class
   * @returns {string} Icon emoji
   */
  getSkillIcon(skillId, _unitClass) {
    const skillIcons = {
      // Warrior skills
      slash: '⚔️', power_strike: '💥', bash: '🛡️', cleave: '🔪', rend: '🩸',
      crushing_blow: '💪', whirlwind: '🌀', executioner: '☠️', blade_storm: '⚔️',
      guard: '🛡️', shield_block: '🛡️', parry: '↩️', taunt: '😤', fortify: '🏰',
      shield_wall: '🧱', aegis: '👼', last_stand: '💀', iron_fortress: '🏯',
      charge: '🏃', knockback: '👊', war_cry: '📢', intimidate: '😠',
      ground_slam: '💥', rally: '📣',

      // Wizard skills
      fire_bolt: '🔥', ignite: '🔥', fireball: '🔥', flame_shield: '🔥',
      combustion: '💥', wall_of_fire: '🔥', inferno: '🔥', meteor: '☄️',
      ice_shard: '❄️', frost: '❄️', blizzard: '❄️', ice_armor: '🧊',
      frozen_prison: '🧊', glacial_spike: '❄️', absolute_zero: '❄️', ice_age: '❄️',
      spark: '⚡', static: '⚡', lightning_bolt: '⚡', chain_lightning: '⚡',
      thunder_strike: '⚡', paralysis: '⚡', overcharge: '⚡', tempest: '🌩️',

      // Monk skills
      palm_strike: '🤚', kick: '🦵', combo: '👊', flying_kick: '🦶',
      chain_combo: '👊', counter_strike: '↩️', ultimate_combo: '💫', pressure_point: '👆',
      fists_of_fury: '👊', meditate: '🧘', ki_strike: '✨', ki_shield: '💠',
      focus: '🎯', ki_burst: '💥', inner_peace: '☮️', ki_storm: '🌊',
      transcendence: '✨', dash: '💨', dodge: '🏃', swift_strike: '⚡',
      afterimage: '👤', untouchable: '💫', phantom_step: '👻',

      // Chemist skills
      potion_throw: '🧪', antidote: '💊', mega_potion: '🧪', elixir: '✨',
      cure_all: '💚', full_life: '💖', super_potion: '🧪', mass_heal: '💚',
      panacea: '🌟', acid_flask: '⚗️', poison_vial: '☠️', toxic_cloud: '💨',
      corrosive: '🧪', plague: '☣️', acid_rain: '🌧️', virulent: '☠️',
      pandemic: '☣️', bomb_throw: '💣', flash_bomb: '💡', timed_bomb: '⏰',
      cluster_bomb: '💣', smoke_bomb: '💨', mega_bomb: '💣', minefield: '💣',
      nuclear_option: '☢️'
    };

    return skillIcons[skillId] || '✨';
  }

  /**
   * Get active unit skills formatted for radial menu
   * @returns {Array} Array of skill objects for radial menu
   */
  getActiveUnitSkillsForRadial() {
    const activeUnit = this.getActiveUnit();
    if (!activeUnit) return [];

    return this.getUnitActiveSkills(activeUnit);
  }

  /**
   * Get active unit items formatted for radial menu
   * @returns {Array} Array of item objects for radial menu
   */
  getActiveUnitItemsForRadial() {
    const consumables = this.battleState?.consumables || [];
    return consumables.map(item => ({
      ...item,
      name: item.name,
      quantity: item.quantity,
      itemId: item.itemId,
      inventoryId: item.inventoryId
    }));
  }

  /**
   * Get the user's preferred action menu style
   * @returns {'radial' | 'context' | 'actionbar'}
   */
  getActionMenuStyle() {
    return this.game.getUserSetting('battle.actionMenuStyle', 'radial');
  }

  /**
   * Show the appropriate action menu based on user preference
   * @param {Object} mousePos - Optional mouse position { mouseX, mouseY } for context menu
   */
  showActionMenu(mousePos = null) {
    // Don't show menu during battle intro
    if (this.isIntroPlaying) return;

    const activeUnit = this.getActiveUnit();
    if (!activeUnit || activeUnit.type !== 'player') return;

    const style = this.getActionMenuStyle();

    switch (style) {
      case 'context':
        this.showContextMenuForUnit(activeUnit, mousePos);
        break;
      case 'actionbar':
        // Action bar is already shown via updateUI, no additional action needed
        break;
      case 'radial':
      default:
        this.showRadialMenu();
        break;
    }
  }

  /**
   * Convert canvas logical coordinates to UI overlay screen coordinates
   * The canvas uses a 800x600 logical coordinate system, but is scaled and centered
   * via CSS. DOM elements in the UI overlay need screen pixel coordinates.
   * @param {number} canvasX - X coordinate in canvas logical space
   * @param {number} canvasY - Y coordinate in canvas logical space
   * @returns {Object} { x, y } in screen pixels relative to UI overlay
   */
  canvasToOverlayCoords(canvasX, canvasY) {
    const canvas = this.game.canvas;
    const canvasRect = canvas.getBoundingClientRect();
    const overlayRect = this.game.uiOverlay.getBoundingClientRect();

    // Canvas logical size
    const logicalWidth = canvas.width;
    const logicalHeight = canvas.height;

    // Convert logical coords to screen coords
    // Scale factor: canvasRect.width / logicalWidth
    const scaleX = canvasRect.width / logicalWidth;
    const scaleY = canvasRect.height / logicalHeight;

    // Position in screen pixels relative to canvas
    const canvasScreenX = canvasX * scaleX;
    const canvasScreenY = canvasY * scaleY;

    // Add canvas offset relative to overlay
    const offsetX = canvasRect.left - overlayRect.left;
    const offsetY = canvasRect.top - overlayRect.top;

    return {
      x: offsetX + canvasScreenX,
      y: offsetY + canvasScreenY
    };
  }

  /**
   * Show context menu for active unit
   * @param {Object} unit - The unit to show menu for
   * @param {Object} mousePos - Optional mouse position { mouseX, mouseY }
   */
  showContextMenuForUnit(unit, mousePos = null) {
    if (!unit) return;

    let menuX, menuY;

    if (mousePos) {
      // Use actual mouse position (from left-click)
      menuX = mousePos.mouseX;
      menuY = mousePos.mouseY;
    } else {
      // Fall back to unit's screen position (for keyboard navigation)
      const worldPos = this.grid.gridToScreenWorld(unit.gridX, unit.gridY);
      const screenPos = this.camera.worldToScreen(worldPos.x, worldPos.y);
      // Convert canvas coords to overlay coords
      const overlayPos = this.canvasToOverlayCoords(screenPos.x, screenPos.y - 40);
      menuX = overlayPos.x;
      menuY = overlayPos.y;
    }

    this.contextMenu.show(
      menuX,
      menuY,
      this.canMove,
      this.canAct,
      unit.mp
    );
  }

  /**
   * Show radial menu for active unit
   */
  showRadialMenu() {
    // Don't show radial menu during battle intro
    if (this.isIntroPlaying) return;

    const activeUnit = this.getActiveUnit();
    if (!activeUnit || activeUnit.type !== 'player') return;

    // Get unit's screen position in canvas coordinates
    const worldPos = this.grid.gridToScreenWorld(activeUnit.gridX, activeUnit.gridY);
    const screenPos = this.camera.worldToScreen(worldPos.x, worldPos.y);

    // Convert canvas coords to overlay coords for DOM positioning
    const overlayPos = this.canvasToOverlayCoords(screenPos.x, screenPos.y - 40);

    // Update radial menu segment availability
    this.radialMenu.setSegmentEnabled('move', this.canMove);
    this.radialMenu.setSegmentEnabled('attack', this.canAct);
    this.radialMenu.setSegmentEnabled('skill', this.canAct);
    this.radialMenu.setSegmentEnabled('item', this.canAct);

    // Show radial menu above the unit
    this.radialMenu.show(overlayPos.x, overlayPos.y, activeUnit.mp);
  }

  /**
   * Hide radial menu
   */
  hideRadialMenu() {
    if (this.radialMenu) {
      this.radialMenu.hide();
    }
  }

  /**
   * Check if any menu is currently open
   */
  isAnyMenuOpen() {
    return (this.radialMenu?.isVisible) ||
           (this.contextMenu?.isVisible) ||
           (this.actionBar?.activeDropdown);
  }

  /**
   * Handle escape key - returns true if handled (prevents settings modal)
   * Called by Game.js global ESC handler
   */
  handleEscape() {
    // If an action is in progress, cancel it
    if (this.currentAction !== null) {
      this.cancelAction();
      return true;
    }

    // If any menu is open, close it
    if (this.radialMenu?.isVisible) {
      this.hideRadialMenu();
      return true;
    }
    if (this.contextMenu?.isVisible) {
      this.contextMenu.hide();
      return true;
    }
    if (this.actionBar?.activeDropdown) {
      this.actionBar.closeDropdown();
      return true;
    }

    // Nothing to handle - allow settings to open
    return false;
  }

  /**
   * Handle grid cursor movement
   */
  handleCursorMove(x, y) {
    // Update hovered tile to cursor position
    this.hoveredTile = { x, y };

    // Show target info if hovering over enemy
    const unit = this.getUnitAt(x, y);
    if (unit && unit.type === 'enemy') {
      this.ui.showTargetInfo(unit);
    } else {
      this.ui.hideTargetInfo();
    }

    // Update damage preview for keyboard navigation
    const worldPos = this.grid.gridToScreenWorld(x, y);
    const screenPos = this.camera.worldToScreen(worldPos.x, worldPos.y);
    this.updateDamagePreview({ x, y }, screenPos);
  }

  /**
   * Handle grid cursor selection
   */
  handleCursorSelect(x, y) {
    const activeUnit = this.getActiveUnit();
    if (!activeUnit || activeUnit.type !== 'player') return;

    // If no action is in progress, check what's at cursor
    if (!this.currentAction) {
      const unit = this.getUnitAt(x, y);

      // If selecting active unit, show action menu (respects user preference)
      if (unit && unit.id === activeUnit.id) {
        this.showActionMenu(); // No mousePos - will use unit position fallback
      }
    } else {
      // Action in progress - treat as tile click
      this.handleTileClick(x, y);
    }
  }

  /**
   * Handle cycling through units with Tab
   */
  handleCycleUnit(direction) {
    const unitArray = Array.from(this.units.values());
    if (unitArray.length === 0) return;

    this.gridCursor.cycleToUnit(unitArray, direction);

    // Pan camera to new cursor position
    const pos = this.gridCursor.getPosition();
    const worldPos = this.grid.gridToScreenWorld(pos.x, pos.y);
    this.camera.centerOn(worldPos.x, worldPos.y);
  }

  /**
   * Update damage preview based on current hover and action mode
   * Uses UI-based preview on the target parchment card
   */
  updateDamagePreview(hoveredTile, _screenPos) {
    const activeUnit = this.getActiveUnit();
    if (!activeUnit || activeUnit.type !== 'player') {
      this.ui.hideDamagePreview();
      return;
    }

    // Check user setting for damage preview
    if (!this.game.getUserSetting('battle.showDamagePreview', true)) {
      this.ui.hideDamagePreview();
      return;
    }

    // Only show preview during attack, skill, or item targeting
    if (!['attack', 'skill', 'item'].includes(this.currentAction)) {
      this.ui.hideDamagePreview();
      return;
    }

    // Check if hovered tile is a valid target
    const isValidTarget = this.validTiles.some(
      t => t.x === hoveredTile.x && t.y === hoveredTile.y
    );
    if (!isValidTarget) {
      this.ui.hideDamagePreview();
      return;
    }

    // Get target unit at hovered tile
    const targetUnit = this.getUnitAt(hoveredTile.x, hoveredTile.y);
    if (!targetUnit) {
      this.ui.hideDamagePreview();
      return;
    }

    // Make the target card sticky so it stays visible during targeting
    this.ui.setTargetSticky(targetUnit);

    let previewData = null;

    if (this.currentAction === 'item' && this.selectedItemId) {
      // Item preview - find item from consumables
      const item = this.battleState.consumables?.find(
        i => String(i.itemId) === String(this.selectedItemId)
      );
      if (item) {
        previewData = calculateItemPreview(item, targetUnit);
      }
    } else {
      // Attack or skill preview
      let skill = null;
      if (this.currentAction === 'skill' && this.selectedSkillId) {
        skill = this.getUnitActiveSkills(activeUnit).find(s => s.id === this.selectedSkillId);
      }
      previewData = this.calculateDamagePreviewData(activeUnit, targetUnit, skill);
    }

    // Show on UI target card
    if (previewData) {
      this.ui.showDamagePreview(previewData);
    } else {
      this.ui.hideDamagePreview();
    }
  }

  /**
   * Calculate damage preview data for UI display
   * Uses shared battleMath module for consistent calculations with server
   */
  calculateDamagePreviewData(attacker, defender, skill) {
    return calculateDamagePreview(attacker, defender, skill);
  }

  /**
   * Start skill action - show valid target tiles for skill
   * @param {string} skillId - The skill to use
   */
  startSkillAction(skillId) {
    this.hideRadialMenu();
    this.currentAction = 'skill';
    this.selectedSkillId = skillId;
    const activeUnit = this.getActiveUnit();
    const skill = this.getUnitActiveSkills(activeUnit).find(s => s.id === skillId);

    if (!skill) {
      parchmentToast.error('Skill Error', 'Skill not found');
      return;
    }

    // Check if unit has enough MP
    if (activeUnit.mp < skill.mpCost) {
      parchmentToast.warning('Not Enough MP', `Need ${skill.mpCost} MP to use this skill`);
      return;
    }

    // Check if this is a self-targeting skill (meditation, buffs, cleanses, etc.)
    if (isSelfTargetingSkill(skill)) {
      this.startSelfTargetSkillAction(skillId, skill, activeUnit);
      return;
    }

    if (activeUnit && skill) {
      // Prefer server-provided skill targets if available
      const serverSkill = this.serverAvailableActions?.skills?.find(s => s.id === skillId);
      if (serverSkill?.targets) {
        // Convert server targets to tile format
        this.validTiles = serverSkill.targets.map(t => ({
          x: t.tileX ?? t.x,
          y: t.tileY ?? t.y,
          unitId: t.unitId ?? t.id,
          distance: t.distance
        }));
      } else {
        // Fall back to client-side calculation
        this.validTiles = this.pathfinding.getAttackableTiles(
          activeUnit.gridX,
          activeUnit.gridY,
          skill.range || this.attackRange
        );
      }
    }

    this.ui.hideSkillPanel();
    this.ui.setActionsEnabled(false);
    this.ui.showTargetingMode();
  }

  /**
   * Start a self-targeting skill action
   * Self-targeting skills (meditation, buffs, cleanses) target the caster only
   * @param {string} skillId - The skill ID
   * @param {Object} skill - The skill definition
   * @param {Object} activeUnit - The unit using the skill
   */
  startSelfTargetSkillAction(skillId, skill, activeUnit) {
    // Highlight only the caster's tile
    this.validTiles = [{
      x: activeUnit.gridX,
      y: activeUnit.gridY,
      unitId: activeUnit.id,
      isSelf: true
    }];

    // Show aura effect preview on the caster
    const screenPos = this.grid.tileToScreen(activeUnit.gridX, activeUnit.gridY);
    const visualCategory = getVisualCategory(skill);
    this.animations.addSelfAuraEffect(
      screenPos.x + this.camera.x,
      screenPos.y + this.camera.y - 32,
      visualCategory
    );

    // Set up pending action for immediate confirmation
    this.pendingAction = {
      type: 'skill',
      skillId,
      targetTile: { x: activeUnit.gridX, y: activeUnit.gridY },
      target: activeUnit,
      isSelfTarget: true
    };
    // Lock target to prevent tile cycling from changing it during confirmation
    this.lockedTarget = { tile: { x: activeUnit.gridX, y: activeUnit.gridY }, unit: activeUnit };

    // Show self-target preview on active unit card
    if (this.game.getUserSetting('battle.showDamagePreview', true)) {
      const previewData = this.calculateDamagePreviewData(activeUnit, activeUnit, skill);
      if (previewData) {
        this.ui.showActiveUnitPreview(previewData);
      }
    }

    // Show confirmation UI
    this.ui.hideSkillPanel();
    this.ui.setActionsEnabled(false);
    this.ui.showTargetingMode();

    // Show toast with skill name
    parchmentToast.info(skill.name, 'Click to confirm or press Escape to cancel');
  }

  /**
   * Show item selection menu
   */
  showItemMenu() {
    // Two-action system: check if act is available
    if (!this.canAct) {
      parchmentToast.warning('Action Used', 'Already acted this turn');
      return;
    }

    // Get consumables from battle state
    const consumables = this.battleState.consumables || [];
    this.ui.showItemPanel(consumables);
  }

  /**
   * Start item action - show valid target tiles for item
   * Without Throw Item skill: self-only with immediate confirmation
   * With Throw Item skill (Chemist): ranged ally targeting
   * @param {Object} itemData - Object with itemId and inventoryId
   */
  startItemAction(itemData) {
    this.hideRadialMenu();
    this.currentAction = 'item';
    this.selectedItemId = itemData.itemId;
    this.selectedInventoryId = itemData.inventoryId;

    const activeUnit = this.getActiveUnit();
    const throwItemSkill = this.getThrowItemSkill(activeUnit);

    if (throwItemSkill) {
      // Has Throw Item skill - allow ranged ally targeting
      // Range: 2 + floor(level / 5) tiles
      const range = 2 + Math.floor(throwItemSkill.level / 5);
      this.validTiles = this.pathfinding.getAttackableTiles(
        activeUnit.gridX,
        activeUnit.gridY,
        range
      );

      // Filter to only include tiles with ally units (including self)
      // In PvP, use teamId to determine allies
      const localUserId = this.game.localUserId;
      const localTeamId = this.isPvP
        ? (Array.from(this.units.values()).find(u => u.ownerId === localUserId)?.teamId ?? 1)
        : 1;
      const allyPositions = this.battleState.units
        .filter(u => {
          if (this.isPvP) {
            // In PvP, allies are units on the same team
            return (u.teamId ?? 1) === localTeamId && u.hp > 0;
          }
          return u.type === 'player' && u.hp > 0;
        })
        .map(u => ({ x: u.tileX, y: u.tileY }));

      this.validTiles = this.validTiles.filter(tile =>
        allyPositions.some(pos => pos.x === tile.x && pos.y === tile.y)
      );

      this.ui.hideItemPanel();
      this.ui.setActionsEnabled(false);
      this.ui.showTargetingMode();
    } else {
      // No Throw Item skill - self-only with confirmation dialog
      this.validTiles = [];
      const item = this.battleState.consumables?.find(i => i.itemId === this.selectedItemId);
      this.pendingAction = {
        type: 'item',
        targetTile: { x: activeUnit.gridX, y: activeUnit.gridY },
        target: activeUnit,
        itemId: this.selectedItemId
      };
      this.ui.hideItemPanel();
      this.ui.showConfirmation(`Use ${item?.name || 'item'} on ${activeUnit.name}?`);
    }
  }

  /**
   * Get the Throw Item skill from a unit's skills array
   * @param {Object} unit - The unit to check
   * @returns {Object|null} The throw_item skill with level, or null if not found
   */
  getThrowItemSkill(unit) {
    if (!unit?.skills) return null;
    return unit.skills.find(s => s.id === 'throw_item');
  }

  /**
   * Confirm pending action
   */
  async confirmAction() {
    this.ui.hideConfirmation();

    if (this.pendingAction) {
      // Validate locked target is still valid (could have died via concurrent action)
      if (this.lockedTarget?.unit && this.lockedTarget.unit.hp <= 0) {
        parchmentToast.warning('Target Defeated', 'The target was defeated');
        this.cancelAction();
        return;
      }
      await this.submitAction(this.pendingAction.type, this.pendingAction.targetTile);
    }

    this.cancelAction();
  }

  /**
   * Cancel current action
   */
  cancelAction() {
    this.hideRadialMenu();
    this.currentAction = null;
    this.validTiles = [];
    this.pendingAction = null;
    this.lockedTarget = null; // Clear target lock
    this.selectedSkillId = null;
    this.selectedItemId = null;
    this.selectedInventoryId = null;
    this.selectedMoveTile = null; // Clear mobile two-tap selection
    this.ui.hideConfirmation();
    this.ui.hideSkillPanel();
    this.ui.hideItemPanel();
    this.ui.hideTargetingMode();
    this.ui.setActionsEnabled(true);

    // Clear sticky target and damage preview when action cancelled
    this.ui.clearTargetSticky();

    // Clear active unit preview (for self-targeting skills)
    this.ui.hideActiveUnitPreview();
  }

  /**
   * Submit action to server
   */
  async submitAction(actionType, targetTile = null) {
    this.hideRadialMenu();
    const activeUnit = this.getActiveUnit();
    if (!activeUnit) return;

    try {
      this.ui.setActionsEnabled(false);

      // Build action payload
      const actionData = {
        battleId: this.battleId,
        actionType,
        unitId: activeUnit.id,
        targetTile
      };

      // Add skill or item ID depending on action type
      if (actionType === 'skill') {
        actionData.skillId = this.selectedSkillId;
        // Play specific skill sound (e.g., skill_fireball, skill_inferno)
        this.audioManager.playSkillSound({ id: this.selectedSkillId }, this.units.get(activeUnit?.id));
      } else if (actionType === 'item') {
        // For items, we use skillId field to pass the item's itemId
        // (backend expects skillId for item type lookups)
        actionData.skillId = this.selectedItemId;
        actionData.inventoryId = this.selectedInventoryId;
      }

      const result = await this.game.api.submitBattleAction(actionData);

      // Process action result
      await this.processActionResult(result);

    } catch (err) {
      parchmentToast.error('Action Failed', err.message);
      this.ui.setActionsEnabled(true);
    }
  }

  /**
   * Process action result from server
   * Handles two-action turn system where turnContinues=true means player has more actions
   */
  async processActionResult(result) {
    const { state, actionResult, enemyActions, battleStatus, turnContinues, availableActions } = result;

    // Handle player movement
    if (actionResult.moved && this.pendingAction?.targetTile) {
      const unit = this.units.get(this.getActiveUnit()?.id);
      if (unit) {
        const from = { x: unit.gridX, y: unit.gridY };
        const to = this.pendingAction.targetTile;
        unit.moveTo(to.x, to.y);
        // Use consistent distance-based timing
        const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
        const moveDuration = Math.max(ANIMATION_TIMING.MOVEMENT_MIN_MS, distance * ANIMATION_TIMING.MOVEMENT_PER_TILE_MS);
        await this.waitForAnimation(moveDuration);
      }
    }

    // Handle empty tile attack (no target)
    if (actionResult.attackedEmptyTile) {
      const attacker = this.units.get(this.getActiveUnit()?.id);
      if (attacker && this.pendingAction?.targetTile) {
        // Play attack animation toward empty tile
        attacker.playAttackAnimation?.(
          this.pendingAction.targetTile.x,
          this.pendingAction.targetTile.y
        );
        await this.waitForAnimation(300);
      }
    }

    // Handle AoE skill damage (hits multiple units)
    if (actionResult.isAoE && actionResult.aoeTargets) {
      const attacker = this.units.get(this.getActiveUnit()?.id);
      // Note: Skill sound already played in submitAction when skill was cast

      // Play attacker animation toward target tile
      if (attacker && this.pendingAction?.targetTile) {
        attacker.playAttackAnimation(
          this.pendingAction.targetTile.x,
          this.pendingAction.targetTile.y
        );
        await this.waitForAnimation(200);
      }

      // Flash all AoE tiles
      if (actionResult.aoeTiles) {
        for (const tile of actionResult.aoeTiles) {
          const tilePos = this.grid.gridToScreenWorld(tile.x, tile.y);
          const color = tile.isCenter ? '#ff8800' : '#ffaa44';
          this.animations.addFlash(tilePos.x, tilePos.y, color);
        }
      }

      // Apply damage to each affected unit simultaneously
      const deathAnimations = [];
      for (const targetInfo of actionResult.aoeTargets) {
        const target = this.units.get(targetInfo.targetId);
        if (!target) continue;

        // Play hit animation and impact sound
        target.playHitAnimation();
        this.audioManager.playImpactSound({ damage: targetInfo.damage, isCritical: targetInfo.isCritical });

        // Show damage number
        this.animations.addDamageNumber(
          target.screenX,
          target.screenY - 40,
          targetInfo.damage,
          targetInfo.isCritical
        );

        // Particle effect (different color for allies hit by friendly fire)
        const isAllyHit = targetInfo.targetType === 'player';
        const particleColor = isAllyHit ? '#ff8844' : '#ff4444';
        this.animations.addParticleBurst(target.screenX, target.screenY - 32, particleColor);

        // Update unit HP
        target.hp = Math.max(0, target.hp - targetInfo.damage);

        // Track deaths for animation later
        if (!target.isAlive()) {
          deathAnimations.push(target);
        }

        // Show status effect if applied and play sound
        if (targetInfo.effectApplied) {
          this.audioManager.playStatusEffectSound(targetInfo.effectApplied);
          this.animations.addDamageNumber(
            target.screenX,
            target.screenY - 60,
            targetInfo.effectApplied.toUpperCase(),
            false
          );
        }
      }

      await this.waitForAnimation(300);

      // Play death animations for killed units
      for (const target of deathAnimations) {
        target.playDeathAnimation();
      }
      if (deathAnimations.length > 0) {
        await this.waitForAnimation(400);
      }
    }

    // Handle single-target player damage (non-AoE)
    if (!actionResult.isAoE && actionResult.damage > 0 && actionResult.targetId) {
      const attacker = this.units.get(this.getActiveUnit()?.id);
      const target = this.units.get(actionResult.targetId);
      // Note: Skill sound already played in submitAction when skill was cast

      if (target) {
        // Attacker faces target and plays attack animation
        if (attacker) {
          attacker.playAttackAnimation(target.gridX, target.gridY);
          await this.waitForAnimation(200); // Wait for attack windup
        }

        // Target plays hit animation
        target.playHitAnimation();
        // Use impact sound system
        this.audioManager.playImpactSound(actionResult);
        this.animations.addDamageNumber(target.screenX, target.screenY - 40, actionResult.damage, actionResult.isCritical);
        this.animations.addFlash(target.screenX, target.screenY - 32, '#ff4444');
        this.animations.addParticleBurst(target.screenX, target.screenY - 32, '#ff4444');
        target.hp = Math.max(0, target.hp - actionResult.damage);

        // Play status effect sound if effect was applied
        if (actionResult.effectApplied || actionResult.statusApplied) {
          this.audioManager.playStatusEffectSound(actionResult.effectApplied || actionResult.statusApplied);
        }

        await this.waitForAnimation(300);

        // Play death animation if target died
        if (!target.isAlive()) {
          target.playDeathAnimation();
          await this.waitForAnimation(400);
        }
      }
    }

    // Handle player miss
    if (actionResult.missed && actionResult.targetId) {
      const target = this.units.get(actionResult.targetId);
      if (target) {
        this.audioManager.playImpactSound({ missed: true });
        this.animations.addDamageNumber(target.screenX, target.screenY - 40, 'MISS', false);
        await this.waitForAnimation(300);
      }
    }

    // Handle item use effects (healing, MP restore, cleanse, revive)
    if (actionResult.itemUsed && actionResult.itemEffects) {
      for (const effect of actionResult.itemEffects) {
        const target = this.units.get(effect.targetId);
        if (!target) continue;

        if (effect.type === 'heal') {
          this.audioManager.playSound('heal');
          target.hp = Math.min(target.maxHp, target.hp + effect.amount);
          this.animations.addHealNumber(target.screenX, target.screenY - 40, effect.amount);
          this.animations.addParticleBurst(target.screenX, target.screenY - 32, '#44ff44');
          await this.waitForAnimation(300);
        } else if (effect.type === 'mpRestore') {
          this.audioManager.playSound('heal');
          target.mp = Math.min(target.maxMp, target.mp + effect.amount);
          this.animations.addHealNumber(target.screenX, target.screenY - 40, effect.amount);
          this.animations.addParticleBurst(target.screenX, target.screenY - 32, '#4488ff');
          await this.waitForAnimation(300);
        } else if (effect.type === 'cleanse') {
          this.audioManager.playSound('heal');
          this.animations.addHealNumber(target.screenX, target.screenY - 40, 'Cleansed');
          await this.waitForAnimation(300);
        } else if (effect.type === 'revive') {
          this.audioManager.playSound('heal');
          target.hp = effect.amount;
          this.animations.addHealNumber(target.screenX, target.screenY - 40, 'Revive!');
          this.animations.addParticleBurst(target.screenX, target.screenY - 32, '#ffdd44');
          await this.waitForAnimation(300);
        }
      }

      // Update consumables in battle state after using an item
      if (this.battleState.consumables) {
        const usedItem = this.battleState.consumables.find(c => c.itemId === actionResult.itemUsed);
        if (usedItem) {
          usedItem.quantity--;
          if (usedItem.quantity <= 0) {
            this.battleState.consumables = this.battleState.consumables.filter(c => c.itemId !== actionResult.itemUsed);
          }
        }
      }
    }

    // Add battle log entry for player action
    // (WebSocket excludes the acting player, so we create the entry from HTTP response)
    if (this.pendingAction && actionResult) {
      const activeUnit = this.units.get(this.getActiveUnit()?.id);
      const targetUnit = actionResult.targetId ? this.units.get(actionResult.targetId) : null;
      const actionType = this.pendingAction.type;

      // Build result object with all relevant data
      const logResult = {
        damage: actionResult.damage || 0,
        isCritical: actionResult.isCritical || false,
        missed: actionResult.missed || false,
        healing: actionResult.healing || 0,
        mpRestored: actionResult.mpRestored || 0,
        skillName: actionResult.skillName,
        itemName: actionResult.itemName,
        statusApplied: actionResult.effectApplied || actionResult.statusApplied,
        element: actionResult.element,
        damageType: actionResult.damageType
      };

      // For movement, add position data
      if (actionType === 'move' && this.pendingAction.targetTile) {
        logResult.from = { x: activeUnit?.gridX, y: activeUnit?.gridY };
        logResult.to = this.pendingAction.targetTile;
      }

      this.addBattleLogEntry(activeUnit, actionType, targetUnit, logResult);
    }

    // Sync enemy action results from HTTP response
    // NOTE: Camera panning and animations are handled by WebSocket events (turn_start, intent_highlight, action_executed)
    // This block only syncs final HP state to ensure consistency if WebSocket events are delayed
    if (enemyActions && enemyActions.length > 0) {
      this.ui.hideActionMenu();
      console.log(`[Battle] Syncing ${enemyActions.length} enemy action results from HTTP response`);

      for (const enemyAction of enemyActions) {
        // Sync HP changes from enemy attacks
        if (enemyAction.result?.damage > 0 && enemyAction.result?.targetId) {
          const target = this.units.get(enemyAction.result.targetId);
          if (target) {
            // Sync HP (WebSocket handlers will animate this)
            target.hp = Math.max(0, target.hp - enemyAction.result.damage);
          }
        }

        // NOTE: Enemy position sync removed - WebSocket unit_moved handles animated movement
        // The syncUnitsWithState call below will catch any missed position updates
        // Direct position snapping here was canceling movement animations
      }
    }

    // Update battle state SELECTIVELY - don't override activeUnitId from HTTP response
    // WebSocket turn_start is authoritative for turn transitions (prevents duplicate camera panning)
    // HTTP response arrives before WebSocket, so if we set activeUnitId here, updateUI() triggers
    // camera pan, then turn_start arrives and triggers it AGAIN
    console.log('[Camera] processActionResult - syncing unit data only (activeUnitId stays:', this.battleState?.activeUnitId, ')');
    this.syncUnitsWithState(state.units);

    // Update turn predictions if available (for turn order display)
    if (state.turnPredictions) {
      this.battleState.turnPredictions = state.turnPredictions;
    }

    // Clear action state
    this.currentAction = null;
    this.validTiles = [];
    this.pendingAction = null;
    this.lockedTarget = null; // Clear target lock

    // Clear sticky target and damage preview when action completes
    this.ui.clearTargetSticky();

    // Store full availableActions for use in action methods
    this.serverAvailableActions = availableActions || null;

    // Check battle end - queue so it waits for death animations
    if (battleStatus !== 'active') {
      console.log('[BattleScene] Queueing battle_end from HTTP response:', {
        status: battleStatus,
        hasRewards: !!actionResult.rewards,
        queueLength: this.turnEventQueue.length,
        isProcessing: this.isProcessingQueue,
        battleEnded: this.battleEnded
      });
      this.queueTurnEvent({
        type: 'battle_end',
        status: battleStatus,
        rewards: actionResult.rewards
      });
    } else if (turnContinues) {
      // Two-action system: turn not complete, update available actions
      this.canMove = availableActions?.canMove ?? false;
      this.canAct = availableActions?.canAct ?? false;
      this.turnPhase = 'partial';

      // Update UI to show remaining options
      this.updateUIForPartialTurn();
    } else {
      // Turn complete - reset turn state for next turn
      this.canMove = true;
      this.canAct = true;
      this.turnPhase = 'ready';

      // Mark that we're entering enemy sequence (prevents camera drift to player)
      // This flag is set BEFORE WebSocket events arrive, preventing the race condition
      this.inEnemySequence = true;
      console.log('[Camera] Turn complete, entering enemy sequence (camera will wait for queue)');

      // Don't call updateUI() here - let the queue system handle turn transitions
      // The queue will process enemy turn_start events, then player turn_start,
      // which will call updateUI() at the appropriate time
    }
  }

  /**
   * Process initial enemy actions when enemy goes first at battle start
   * Called after intro completes if the server returned initialEnemyActions
   */
  async processInitialEnemyActions() {
    const enemyActions = this.initialEnemyActions;
    this.initialEnemyActions = null; // Clear so we don't process again

    // Hide action menu while enemy acts
    this.ui.hideActionMenu();

    // Process each enemy action with animations
    for (const enemyAction of enemyActions) {
      await this.waitForAnimation(300);

      const enemyUnit = this.units.get(enemyAction.unitId);
      if (!enemyUnit) continue;

      // Highlight the acting enemy
      this.selectedUnit = enemyUnit;

      // Animate movement
      if (enemyAction.result.moved && enemyAction.targetTile) {
        enemyUnit.moveTo(enemyAction.targetTile.x, enemyAction.targetTile.y);
        await this.waitForAnimation(400);
      }

      // Animate attack damage
      if (enemyAction.result.damage > 0 && enemyAction.result.targetId) {
        const target = this.units.get(enemyAction.result.targetId);
        if (target) {
          // Enemy faces target and plays attack animation
          enemyUnit.playAttackAnimation(target.gridX, target.gridY);
          this.animations.addSlash(enemyUnit.screenX, enemyUnit.screenY - 32, target.screenX, target.screenY - 32);
          await this.waitForAnimation(200);

          // Target plays hit animation
          target.playHitAnimation();
          this.animations.addDamageNumber(target.screenX, target.screenY - 40, enemyAction.result.damage, enemyAction.result.isCritical);
          this.animations.addFlash(target.screenX, target.screenY - 32, '#ff4444');
          this.animations.addParticleBurst(target.screenX, target.screenY - 32, '#ff4444');
          target.hp = Math.max(0, target.hp - enemyAction.result.damage);
          await this.waitForAnimation(300);

          // Death animation if target died
          if (!target.isAlive()) {
            target.playDeathAnimation();
            await this.waitForAnimation(400);
          }
        }
      }

      // Handle enemy miss
      if (enemyAction.result.missed && enemyAction.result.targetId) {
        const target = this.units.get(enemyAction.result.targetId);
        if (target) {
          this.animations.addDamageNumber(target.screenX, target.screenY - 40, 'MISS', false);
          await this.waitForAnimation(200);
        }
      }
    }

    // Brief pause then show player UI
    await this.waitForAnimation(300);

    // Reset turn state and update UI for player's turn
    this.canMove = true;
    this.canAct = true;
    this.turnPhase = 'ready';
    this.updateUI();
  }

  /**
   * Update UI for partial turn (two-action system)
   * Called when player has completed one action but has another available
   */
  updateUIForPartialTurn() {
    const activeUnit = this.getActiveUnit();
    if (!activeUnit || activeUnit.type !== 'player') return;

    // Update active unit card (HP/MP may have changed from skill use)
    this.ui.updateActiveUnit(activeUnit);

    // Update UI with available actions
    this.ui.updateAvailableActions(this.canMove, this.canAct);
    this.ui.showActionMenu();
    this.ui.setActionsEnabled(true);

    // Update persistent action bar with new turn state
    if (this.actionBar) {
      this.actionBar.updateTurnState(this.canMove, this.canAct, activeUnit.mp);
    }

    // Show action menu after partial turn so player can select remaining action
    // Short delay allows any action animations to settle
    setTimeout(() => {
      if (this.getActiveUnit()?.id === activeUnit.id && !this.currentAction) {
        this.showActionMenu();
      }
    }, 200);
  }

  /**
   * Sync local units with server state
   */
  syncUnitsWithState(stateUnits) {
    for (const unitData of stateUnits) {
      const unit = this.units.get(unitData.id);
      if (unit) {
        unit.hp = unitData.hp ?? unit.hp;
        unit.mp = unitData.mp ?? unit.mp;
        unit.ct = unitData.ct || 0; // Sync CT for turn order display
        unit.hasActed = unitData.hasActed;
        unit.statusEffects = unitData.statusEffects || [];

        // Sync two-action system state
        unit.moveUsed = unitData.moveUsed ?? false;
        unit.actUsed = unitData.actUsed ?? false;
        unit.turnPhase = unitData.turnPhase ?? 'ready';

        // Validate position data - skip if invalid to prevent NaN issues
        const tileX = unitData.tileX;
        const tileY = unitData.tileY;
        if (typeof tileX !== 'number' || typeof tileY !== 'number' ||
            isNaN(tileX) || isNaN(tileY)) {
          console.warn(`[BattleScene] Invalid position for unit ${unitData.id}: tileX=${tileX}, tileY=${tileY}`);
          continue; // Skip position update for this unit
        }

        // Update position if changed - but DON'T interrupt ongoing movement animations
        // WebSocket unit_moved calls moveTo() for smooth animation
        if (unit.gridX !== tileX || unit.gridY !== tileY) {
          if (unit.isMoving) {
            // Unit is animating - update target grid position AND animation target
            // so the animation reaches the correct destination
            unit.gridX = tileX;
            unit.gridY = tileY;
            // Update animation target to match new grid position
            if (this.grid) {
              const target = this.grid.gridToScreenWorld(tileX, tileY);
              unit.targetScreenX = target.x;
              unit.targetScreenY = target.y;
            }
          } else {
            // Unit is stationary - animate to new position for smooth visual
            // This handles missed WebSocket events without jarring teleportation
            unit.moveTo(tileX, tileY);
          }
        }
      }
    }
  }

  /**
   * Handle coliseum match result with enhanced PvP data
   * @param {Object} payload - Match result payload from WebSocket
   */
  handleColiseumResult(payload) {
    console.log('[BattleScene] handleColiseumResult called:', {
      isWinner: payload.isWinner,
      hasUnitStats: !!payload.unitStats,
      hasPvpResult: !!payload.pvpResult,
      battleEnded: this.battleEnded
    });

    // Don't process if battle already ended
    if (this.battleEnded) {
      console.log('[BattleScene] Coliseum result skipped - battle already ended');
      return;
    }

    // Determine battle status from isWinner
    const status = payload.isWinner ? 'victory' : 'defeat';

    // Call handleBattleEndWithStats with the enhanced data
    this.handleBattleEndWithStats(status, null, payload.pvpResult, payload.unitStats);
  }

  /**
   * Handle battle end with optional enhanced PvP stats
   * @param {string} status - 'victory' or 'defeat'
   * @param {Object} rewards - PvE rewards (gold, xp, items)
   * @param {Object} pvpResult - PvP result data (rating, tier, rank changes)
   * @param {Array} unitStats - Per-unit battle statistics
   */
  handleBattleEndWithStats(status, rewards = null, pvpResult = null, unitStats = null) {
    console.log('[BattleScene] handleBattleEndWithStats called:', {
      status,
      hasRewards: !!rewards,
      hasPvpResult: !!pvpResult,
      hasUnitStats: !!unitStats,
      battleEnded: this.battleEnded
    });

    // Guard against double-trigger
    if (this.battleEnded) {
      console.log('[BattleScene] handleBattleEndWithStats skipped - already ended');
      return;
    }
    this.battleEnded = true;

    // Hide battle UI elements for outro
    if (this.ui) {
      this.ui.hideActionMenu();
      this.ui.hideForOutro();
      // Also disable PvP mode to hide surrender button
      if (this.isPvP) {
        this.ui.pvpUI?.disablePvPMode();
      }
    }

    // Play victory or defeat fanfare
    this.audioManager.playBattleEndMusic(status);

    // Create outro sequence with enhanced options
    console.log('[BattleScene] Creating outro sequence with enhanced stats');
    this.outroSequence = new BattleOutroSequence(this);
    this.outroSequence.start(status, rewards, {
      isPvP: this.isPvP,
      opponentName: this.opponentUsername,
      pvpResult: pvpResult,
      unitStats: unitStats,
      onComplete: () => {
        console.log('[BattleScene] Outro sequence completed, calling endBattle');
        this.endBattle();
      }
    });
  }

  /**
   * Handle battle end (victory or defeat)
   * Legacy method - delegates to handleBattleEndWithStats for backward compatibility
   */
  handleBattleEnd(status, rewards = null) {
    console.log('[BattleScene] handleBattleEnd called:', {
      status,
      hasRewards: !!rewards,
      battleEnded: this.battleEnded,
      isPvP: this.isPvP,
      opponentUsername: this.opponentUsername || null
    });

    // For PvP battles, log additional context
    if (this.isPvP) {
      console.log('[BattleScene] PvP battle outcome:', {
        status,
        myUserId: this.game.api?.userId || 'unknown',
        result: status === 'victory' ? 'I won!' : 'I lost'
      });
    }

    // Delegate to the enhanced method (without pvpResult/unitStats for legacy calls)
    this.handleBattleEndWithStats(status, rewards, null, null);
  }

  /**
   * End battle and return to appropriate scene
   */
  endBattle() {
    // Clear PvP timer if running
    if (this.pvpTurnTimer) {
      clearInterval(this.pvpTurnTimer);
      this.pvpTurnTimer = null;
    }

    // Resume previous music after a short delay (after victory/defeat fanfare)
    setTimeout(() => {
      this.audioManager.resumeAfterBattle();
    }, 3000);

    // Return to coliseum for PvP battles, world map otherwise
    const returnScene = this.isPvP ? 'coliseum' : 'worldMap';
    this.game.scenes.switchTo(returnScene);
  }

  /**
   * Handle player surrender in PvP battle
   */
  handleSurrender() {
    if (!this.isPvP || !this.battleId) return;

    // Send surrender via WebSocket
    this.game.socket.send('battle:surrender', {
      battleId: this.battleId
    });

    // Show notification
    parchmentToast.warning('Surrender', 'You surrendered the battle.');
  }

  /**
   * Handle unit preview from turn order panel - pan camera to unit
   * @param {Object} prediction - The unit prediction data with id
   */
  handleUnitPreview(prediction) {
    if (!prediction || !prediction.id) return;

    // Find the actual unit in battleUnits
    const unit = this.units.find(u => u.id === prediction.id);
    if (!unit) return;

    // Get world position from grid position
    const worldPos = this.grid.gridToScreenWorld(unit.gridX, unit.gridY);

    // Pan camera to unit with smooth transition
    this.camera.startTurnTransition(worldPos.x, worldPos.y, null, 500);
  }

  /**
   * Start PvP turn timer
   * @param {number} durationSeconds - Total turn duration (default 30s)
   */
  startPvPTurnTimer(durationSeconds = 30) {
    if (!this.isPvP || !this.ui) return;

    // Clear existing timer
    if (this.pvpTurnTimer) {
      clearInterval(this.pvpTurnTimer);
    }

    this.pvpTurnDeadline = Date.now() + (durationSeconds * 1000);

    // Show timer
    this.ui.showTurnTimer();
    this.ui.updateTurnTimer(durationSeconds, durationSeconds);

    // Update timer every 100ms for smooth countdown
    this.pvpTurnTimer = setInterval(() => {
      const remaining = Math.max(0, (this.pvpTurnDeadline - Date.now()) / 1000);
      this.ui.updateTurnTimer(remaining, durationSeconds);

      if (remaining <= 0) {
        clearInterval(this.pvpTurnTimer);
        this.pvpTurnTimer = null;
      }
    }, 100);
  }

  /**
   * Stop PvP turn timer (opponent's turn)
   */
  stopPvPTurnTimer() {
    if (this.pvpTurnTimer) {
      clearInterval(this.pvpTurnTimer);
      this.pvpTurnTimer = null;
    }
    if (this.ui) {
      this.ui.hideTurnTimer();
    }
  }

  /**
   * Get currently active unit
   */
  getActiveUnit() {
    if (!this.battleState) return null;

    // Prefer activeUnitId (new CT system), fall back to activeUnitIndex
    if (this.battleState.activeUnitId) {
      return this.units.get(this.battleState.activeUnitId);
    }

    // Fallback for old state format
    const unitData = this.battleState.units[this.battleState.activeUnitIndex];
    return unitData ? this.units.get(unitData.id) : null;
  }

  /**
   * Get movement range for a unit based on class and status effects
   * Mirrors server-side logic in battleService.getMovementRange()
   */
  getUnitMovementRange(unit) {
    if (!unit) return 3;

    // Look up class-based movement range
    const unitClass = unit.class?.toLowerCase() || 'warrior';
    let baseRange = CLASS_MOVEMENT[unitClass] || 3;

    // Apply status effects (must match server-side logic)
    if (unit.statusEffects?.some(e => e.type === 'slow')) {
      baseRange = Math.max(1, baseRange - 1);
    }
    if (unit.statusEffects?.some(e => e.type === 'haste')) {
      baseRange += 1;
    }

    return baseRange;
  }

  /**
   * Get unit at position
   */
  getUnitAt(x, y) {
    for (const unit of this.units.values()) {
      if (unit.gridX === x && unit.gridY === y && unit.isAlive()) {
        return unit;
      }
    }
    return null;
  }

  /**
   * Update UI elements
   */
  updateUI() {
    if (!this.ui || !this.battleState) return;

    console.log('[Camera] updateUI called - battleState.activeUnitId:', this.battleState.activeUnitId, 'lastActiveUnitId:', this.lastActiveUnitId);

    // Update turn order
    this.ui.updateTurnOrder(this.battleState);

    // Update active unit
    const activeUnit = this.getActiveUnit();
    console.log('[Camera] activeUnit:', activeUnit?.id, activeUnit?.name, '| lastActiveUnitId:', this.lastActiveUnitId);
    if (activeUnit) {
      this.ui.updateActiveUnit(activeUnit);
      activeUnit.isSelected = true;

      // Update movement range based on unit's class and status effects
      this.movementRange = this.getUnitMovementRange(activeUnit);

      // Check if active unit changed
      if (this.lastActiveUnitId !== activeUnit.id) {
        console.log(`[Camera] Turn change detected: ${this.lastActiveUnitId} -> ${activeUnit.id}`);
        const previousUnitId = this.lastActiveUnitId;
        this.lastActiveUnitId = activeUnit.id;

        // First unit of battle - set follow target without transition
        if (previousUnitId === null) {
          this.camera.setFollowTarget(activeUnit);
        }
        // NOTE: Camera pan REMOVED from updateUI() - WebSocket queue system handles camera transitions
      } else {
        // Same unit's turn continues - only update follow target if NOT in enemy sequence
        // During enemy sequences, camera should stay put (not drift back to player)
        if (!this.inEnemySequence && !this.isProcessingQueue) {
          this.camera.setFollowTarget(activeUnit);
        }
      }

      // Show action UI for local player's units only
      // In PvP, only enable controls when it's the local player's unit's turn
      const localUserId = this.game.localUserId;
      const isLocalPlayerTurn = this.isPvP
        ? activeUnit.isLocalPlayerUnit(localUserId)
        : activeUnit.type === 'player';

      if (isLocalPlayerTurn) {
        // Two-action system: update available actions for new turn
        this.ui.updateAvailableActions(this.canMove, this.canAct);
        this.ui.setActionsEnabled(true);

        // Show action bar only if user preference is 'actionbar'
        const actionStyle = this.getActionMenuStyle();
        if (this.actionBar && actionStyle === 'actionbar') {
          this.actionBar.show(this.canMove, this.canAct, activeUnit.mp);
        } else if (this.actionBar) {
          this.actionBar.hide();
        }

        // Enable grid cursor for player turn
        if (this.gridCursor) {
          this.gridCursor.centerOnUnit(activeUnit);
          this.gridCursor.show();
        }

        // Show action menu automatically on player's turn (after short delay for camera)
        setTimeout(() => {
          if (this.getActiveUnit()?.id === activeUnit.id && !this.currentAction) {
            this.showActionMenu();
          }
        }, 300);

        // Hide opponent turn indicator (PvP)
        if (this.isPvP) {
          this.ui.hideOpponentTurnIndicator();
        }
      } else {
        this.hideRadialMenu();
        this.ui.hideActionMenu();
        // Hide action bar during enemy/opponent turns
        if (this.actionBar) {
          this.actionBar.hide();
        }
        // Hide context menu during enemy/opponent turns
        if (this.contextMenu) {
          this.contextMenu.hide();
        }
        // Hide grid cursor during enemy/opponent turns
        if (this.gridCursor) {
          this.gridCursor.hide();
        }

        // Show opponent turn indicator in PvP when it's opponent's human-controlled unit's turn
        if (this.isPvP && activeUnit.type === 'player' && !activeUnit.isLocalPlayerUnit(localUserId)) {
          this.ui.showOpponentTurnIndicator(this.opponentUsername || 'Opponent');
        } else if (this.isPvP) {
          this.ui.hideOpponentTurnIndicator();
        }
      }
    }

    // Deselect other units
    for (const unit of this.units.values()) {
      if (unit !== activeUnit) {
        unit.isSelected = false;
      }
    }
  }

  /**
   * Wait for animation duration
   */
  waitForAnimation(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update game logic
   */
  update(deltaTime) {
    // Update loading screen if visible (even before full initialization)
    if (this.loadingScreen) {
      this.loadingScreen.update(deltaTime);
    }

    // Safety check - don't update if not fully initialized
    if (!this.camera || !this.grid) return;

    // Update intro if playing
    if (this.isIntroPlaying && this.intro) {
      this.intro.update(deltaTime);
      if (this.intro.isComplete()) {
        this.isIntroPlaying = false;
        this.ui.show(); // Show action menu after intro

        // If there are initial enemy actions (enemy went first), process them
        if (this.initialEnemyActions && this.initialEnemyActions.length > 0) {
          this.processInitialEnemyActions();
        } else {
          this.updateUI();
        }
      }
      // Don't process input during intro
      return;
    }

    // Handle keyboard camera movement - skip if turn transition is active
    // This prevents accidental interruption of camera pans during turn changes
    // Note: Use arrow keys only for camera (WASD reserved for action hotkeys: W-Wait, A-Attack, S-Skill)
    if (!this.camera.isTurnTransitioning()) {
      const input = this.game.input;
      let dx = 0, dy = 0;

      if (input.isKeyDown('ArrowUp')) dy = -1;
      if (input.isKeyDown('ArrowDown')) dy = 1;
      if (input.isKeyDown('ArrowLeft')) dx = -1;
      if (input.isKeyDown('ArrowRight')) dx = 1;

      if (dx !== 0 || dy !== 0) {
        this.camera.moveByKeys(dx, dy, deltaTime);
      }
    }

    // Update turn transition animation
    this.camera.updateTurnTransition(deltaTime);

    // Update camera (smooth interpolation)
    this.camera.update(deltaTime);

    // Update animations
    this.animations.update(deltaTime);

    // Update units
    for (const unit of this.units.values()) {
      unit.update(deltaTime);
    }

    // Update grid cursor animation
    if (this.gridCursor) {
      this.gridCursor.update(deltaTime);
    }

    // Update outro sequence if active
    if (this.outroSequence && !this.outroSequence.isComplete()) {
      this.outroSequence.update(deltaTime);
    }

    // Update terrain tooltip (DOM-based)
    this.updateTerrainTooltip();

    // Update tile cycling for overlapping elevations (delegated to input handler)
    if (this.inputHandler) {
      this.inputHandler.updateTileCycling(deltaTime);
    }

    // Clear input state
    this.game.input.clearFrameState();
  }

  /**
   * Render the battle scene
   */
  render(ctx) {
    // Clear background
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Render loading screen overlay if visible
    if (this.loadingScreen) {
      this.loadingScreen.render(ctx);
      // Don't render battle content until assets are loaded
      if (this.isLoadingAssets) {
        return;
      }
    }

    // Safety check - don't render if not fully initialized
    if (!this.camera || !this.grid) return;

    // Build tile highlights
    const highlights = {};

    // Movement range highlights with opacity gradient based on terrain cost
    if (this.currentAction === 'move') {
      for (const tile of this.validTiles) {
        // Calculate opacity: tiles that cost more to reach are dimmer
        // Formula: 0.2 (min) + (remaining movement / max range) * 0.5
        const remainingMovement = this.movementRange - tile.cost;
        const opacity = 0.2 + (remainingMovement / this.movementRange) * 0.5;
        highlights[`${tile.x},${tile.y}`] = `rgba(74, 144, 217, ${opacity.toFixed(2)})`;
      }

      // Mobile: highlight selected tile brighter for two-tap feedback
      if (this.selectedMoveTile) {
        const key = `${this.selectedMoveTile.x},${this.selectedMoveTile.y}`;
        highlights[key] = 'rgba(100, 180, 255, 0.75)'; // Brighter blue for selected
      }
    }

    // Attack range highlights (tile-based targeting)
    // In PvP, use teamId to determine ally/enemy coloring
    if (this.currentAction === 'attack') {
      const localUserId = this.game.localUserId;
      const localTeamId = this.isPvP
        ? (Array.from(this.units.values()).find(u => u.ownerId === localUserId)?.teamId ?? 1)
        : 1;

      for (const tile of this.validTiles) {
        const unit = this.getUnitAt(tile.x, tile.y);
        const isEnemy = unit && (this.isPvP ? unit.isOpponent(localUserId, localTeamId) : unit.type === 'enemy');
        const isAlly = unit && (this.isPvP ? unit.isAlly(localUserId, localTeamId) : unit.type === 'player');

        if (isEnemy) {
          highlights[`${tile.x},${tile.y}`] = 'rgba(217, 74, 74, 0.6)';  // Bright red for enemies
        } else if (isAlly) {
          highlights[`${tile.x},${tile.y}`] = 'rgba(217, 174, 74, 0.5)'; // Orange for allies
        } else {
          highlights[`${tile.x},${tile.y}`] = 'rgba(217, 74, 74, 0.3)';  // Dim red for empty tiles
        }
      }
    }

    // Skill range highlights (tile-based targeting)
    // In PvP, use teamId to determine ally/enemy coloring
    if (this.currentAction === 'skill') {
      const activeUnit = this.getActiveUnit();
      const skill = activeUnit ? this.getUnitActiveSkills(activeUnit).find(s => s.id === this.selectedSkillId) : null;
      const localUserId = this.game.localUserId;
      const localTeamId = this.isPvP
        ? (Array.from(this.units.values()).find(u => u.ownerId === localUserId)?.teamId ?? 1)
        : 1;

      for (const tile of this.validTiles) {
        const unit = this.getUnitAt(tile.x, tile.y);
        const isEnemy = unit && (this.isPvP ? unit.isOpponent(localUserId, localTeamId) : unit.type === 'enemy');
        const isAlly = unit && (this.isPvP ? unit.isAlly(localUserId, localTeamId) : unit.type === 'player');

        if (isEnemy) {
          highlights[`${tile.x},${tile.y}`] = 'rgba(148, 74, 217, 0.6)';  // Purple for enemies
        } else if (isAlly) {
          highlights[`${tile.x},${tile.y}`] = 'rgba(74, 144, 217, 0.5)';  // Blue for allies
        } else {
          highlights[`${tile.x},${tile.y}`] = 'rgba(148, 74, 217, 0.3)';  // Dim purple for empty tiles
        }
      }

      // Show AoE preview when hovering over a valid tile
      if (this.hoveredTile && skill && skill.aoeRadius) {
        const isValidHover = this.validTiles.some(t => t.x === this.hoveredTile.x && t.y === this.hoveredTile.y);
        if (isValidHover) {
          const aoeTiles = this.pathfinding.getAoETiles(
            this.hoveredTile.x,
            this.hoveredTile.y,
            skill.aoeRadius,
            skill.aoePattern || 'circle'
          );

          for (const aoeTile of aoeTiles) {
            const key = `${aoeTile.x},${aoeTile.y}`;
            if (aoeTile.isCenter) {
              // Bright orange for center tile
              highlights[key] = 'rgba(255, 140, 0, 0.8)';
            } else {
              // Softer orange for adjacent AoE tiles
              highlights[key] = 'rgba(255, 165, 0, 0.5)';
            }
          }
        }
      }
    }

    // Hovered tile highlight - always show hover indicator
    if (this.hoveredTile) {
      const key = `${this.hoveredTile.x},${this.hoveredTile.y}`;
      // If tile is already highlighted for targeting, make it brighter on hover
      if (highlights[key]) {
        // Intensify existing highlight on hover
        highlights[key] = highlights[key].replace(/[\d.]+\)$/, '0.8)');
      } else {
        // Show white hover indicator for non-highlighted tiles
        highlights[key] = 'rgba(255, 255, 255, 0.4)';
      }
    }

    // Update occlusion cache with current unit positions before rendering
    const aliveUnits = Array.from(this.units.values()).filter(u => u.isAlive());
    this.grid.invalidateOcclusionCache();
    this.grid.updateOcclusionCache(aliveUnits);

    // Render grid with highlights and camera (includes intent highlights from WebSocket)
    this.grid.renderWithIntentHighlights(ctx, highlights, this.camera);

    // Render grid cursor (keyboard navigation)
    if (this.gridCursor) {
      this.gridCursor.render(ctx, this.camera);
    }

    // Render tile cycle indicator when multiple tiles overlap (delegated to input handler)
    if (this.inputHandler) {
      this.inputHandler.renderTileCycleIndicator(ctx);
    }

    // Sort and render units (by Y position for depth)
    const allUnits = Array.from(this.units.values());
    const sortedUnits = allUnits
      .filter(u => u.isAlive())
      .sort((a, b) => (a.gridX + a.gridY) - (b.gridX + b.gridY));

    for (const unit of sortedUnits) {
      unit.render(ctx, this.camera);
    }

    // Render dead units (faded)
    for (const unit of this.units.values()) {
      if (!unit.isAlive()) {
        ctx.globalAlpha = 0.3;
        unit.render(ctx, this.camera);
        ctx.globalAlpha = 1;
      }
    }

    // Render animations with camera transform
    this.renderAnimationsWithCamera(ctx);

    // Render minimap (hide during intro)
    if (!this.isIntroPlaying) {
      this.renderMinimap(ctx);
    }

    // Render intro overlay on top
    if (this.isIntroPlaying && this.intro) {
      this.intro.render(ctx);
    }

    // Render outro sequence on top of everything
    if (this.outroSequence && !this.outroSequence.isComplete()) {
      this.outroSequence.render(ctx);
    }
  }

  /**
   * Update terrain tooltip when hovering over tiles during move action.
   * Uses DOM-based tooltip for better alignment and styling.
   */
  updateTerrainTooltip() {
    if (!this.terrainTooltip) return;

    // Only show during move action
    if (this.currentAction !== 'move') {
      this.terrainTooltip.hide();
      return;
    }

    // Determine which tile to show tooltip for (hovered or selected on mobile)
    const tooltipTile = this.isTouchDevice ? this.selectedMoveTile : this.hoveredTile;
    if (!tooltipTile) {
      this.terrainTooltip.hide();
      return;
    }

    // Get terrain info
    const terrain = this.grid.getTerrain(tooltipTile.x, tooltipTile.y);
    const moveCost = this.grid.getMovementCost(tooltipTile.x, tooltipTile.y);
    const elevation = this.grid.getElevation(tooltipTile.x, tooltipTile.y);

    // Calculate position - convert canvas coords to viewport coords
    // DOM tooltip is positioned relative to game container
    let tooltipX, tooltipY;

    if (this.isTouchDevice && this.selectedMoveTile) {
      // On mobile, position tooltip above the selected tile
      const worldPos = this.grid.gridToScreenWorld(tooltipTile.x, tooltipTile.y);
      const screenPos = this.camera.worldToScreen(worldPos.x, worldPos.y);
      // Scale canvas coords to viewport coords (tooltip is in game container)
      const scale = this.game.scale || 1;
      tooltipX = screenPos.x * scale;
      tooltipY = screenPos.y * scale;
    } else {
      // On desktop, position near cursor (already in viewport coords)
      const pos = this.game.input.getPointerPosition();
      tooltipX = pos.x;
      tooltipY = pos.y;
    }

    this.terrainTooltip.show({
      terrain,
      movementCost: moveCost,
      elevation,
      x: tooltipX,
      y: tooltipY
    });
  }

  /**
   * Render animations with camera transform
   */
  renderAnimationsWithCamera(ctx) {
    ctx.save();
    const screenOffset = this.camera.worldToScreen(0, 0);
    ctx.translate(screenOffset.x, screenOffset.y);
    this.animations.render(ctx);
    ctx.restore();
  }

  /**
   * Render minimap in corner
   */
  renderMinimap(ctx) {
    const minimapSize = 120;
    const minimapX = ctx.canvas.width - minimapSize - 10;
    const minimapY = 10;
    const mapDim = this.grid.getMapPixelDimensions();

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(minimapX, minimapY, minimapSize, minimapSize);

    // Calculate scale to fit map in minimap
    const scale = (minimapSize - 10) / Math.max(mapDim.width, mapDim.height);
    const offsetX = minimapX + 5 + mapDim.offsetX * scale;
    const offsetY = minimapY + 5 + mapDim.offsetY * scale;

    // Draw units as dots
    for (const unit of this.units.values()) {
      if (!unit.isAlive()) continue;

      const dotX = offsetX + unit.screenX * scale;
      const dotY = offsetY + unit.screenY * scale;

      ctx.beginPath();
      ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
      ctx.fillStyle = unit.type === 'player' ? '#4a90d9' : '#d94a4a';
      ctx.fill();

      // Highlight active unit
      if (unit.isSelected) {
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Draw camera viewport rectangle
    const viewportWidth = ctx.canvas.width * scale;
    const viewportHeight = ctx.canvas.height * scale;
    const viewportX = offsetX + (this.camera.x - ctx.canvas.width / 2) * scale;
    const viewportY = offsetY + (this.camera.y - ctx.canvas.height / 2) * scale;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(viewportX, viewportY, viewportWidth, viewportHeight);

    // Border
    ctx.strokeStyle = '#4a4a6a';
    ctx.lineWidth = 2;
    ctx.strokeRect(minimapX, minimapY, minimapSize, minimapSize);

    // Label
    ctx.fillStyle = '#888';
    ctx.font = '10px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('WASD/Arrows: Pan | Space: Re-center', minimapX, minimapY + minimapSize + 12);
  }
}
