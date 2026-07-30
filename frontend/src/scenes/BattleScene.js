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
 * Extracted modules (to reduce file size):
 * - BattleHighlights.js - Tile highlight color computation
 * - BattleMinimap.js - Minimap overlay rendering
 * - battleCoords.js - Canvas-to-overlay coordinate conversion
 * - skillIcons.js - Skill icon emoji mappings
 * - battleLog.js - Battle log entry building
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
import { BattleMapSession } from '../battle/BattleMapSession.js';
import { BattleInputHandler } from '../battle/BattleInputHandler.js';
import { BattleAudioManager } from '../battle/BattleAudioManager.js';
import {
  collectBattleMapAssetManifest
} from '../battle/BattleMapAssets.js';
import { applyBattleMapPatch } from '../battle/mergeBattleState.js';
import {
  transitionFromBattleIfCurrent,
  waitForPostBattleSessionRefresh
} from '../battle/BattleSessionState.js';
import {
  isSelfTargetingSkill,
  getVisualCategory,
  getActionVisualDescriptor,
  resolveActionSkill
} from '../battle/SkillEffectCategories.js';
import { buildHighlights } from '../battle/BattleHighlights.js';
import { renderMinimap as renderMinimapOverlay } from '../battle/BattleMinimap.js';
import { canvasToOverlayCoords as convertCanvasToOverlay } from '../battle/battleCoords.js';
import { getSkillIcon as lookupSkillIcon } from '../battle/skillIcons.js';
import { buildBattleLogEntry, getActionName as lookupActionName } from '../battle/battleLog.js';
import { calculateDamagePreview, calculateItemPreview } from '@shared/battleMath.js';
import { CLASS_MOVEMENT } from '@shared/constants.js';
import { getNpcVisualIdentity, getPlayerCharacterIdentity } from '@shared/assetPaths.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { BattleLoadingScreen } from '../ui/parchment/BattleLoadingScreen.js';
import { responsive } from '../core/Responsive.js';

export function createBattleCommandId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `battle-action-${Date.now()}-${Math.random().toString(36).slice(2, 13)}`;
}

export function createAssetPreloadProgress(loadingScreen) {
  const phases = new Map();

  const publish = (label) => {
    const totals = Array.from(phases.values());
    const total = totals.reduce((sum, phase) => sum + phase.total, 0);
    const loaded = totals.reduce((sum, phase) => sum + phase.loaded, 0);
    if (total <= 0) {
      loadingScreen.updateProgress(0, 1, label);
      return;
    }
    loadingScreen.updateProgress(Math.min(total, Math.max(0, loaded)), total, label);
  };

  return {
    track(key, label) {
      return (loaded, total) => {
        const safeTotal = Number.isFinite(total) ? Math.max(0, total) : 0;
        const safeLoaded = Number.isFinite(loaded)
          ? Math.min(safeTotal, Math.max(0, loaded))
          : 0;
        phases.set(key, { loaded: safeLoaded, total: safeTotal });
        publish(label);
      };
    },
    finish(label = 'Ready') {
      const total = Array.from(phases.values())
        .reduce((sum, phase) => sum + phase.total, 0);
      loadingScreen.updateProgress(Math.max(1, total), Math.max(1, total), label);
    }
  };
}

/**
 * BattleScene - Tactical turn-based combat on an isometric grid with camera
 */
export class BattleScene extends Scene {
  constructor(game) {
    super(game);

    // Battle state
    this.battleId = null;
    this.battleState = null;
    this.mapSession = null;
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
    this.canWait = true;
    this.turnPhase = 'ready'; // 'ready' | 'partial' | 'done'
    this.inputEnabled = false;
    this.isActionSubmitting = false;
    this.stateRevision = null;
    this.retryableActionIntent = null;
    this.processedCommandIds = new Set();

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
    this.battleExitInProgress = false;
    this.postBattleRefreshWait = null;

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

    // V2 maps cannot render without their exact authored assets. Preserve the
    // failed response and error so the loading overlay can offer a safe retry.
    this.assetLoadError = null;
    this.assetLoadRetryData = null;
    this.assetLoadRetryInProgress = false;
  }

  /**
   * Enter the battle scene
   */
  async enter(data) {
    // data = { battleId, mapSeed, mapWidth, mapHeight, state, initialEnemyActions, battleType, opponentUsername, nodeType }
    const battleResponse = data;
    this.assetLoadError = null;
    this.assetLoadRetryData = battleResponse;
    this.mapSession = new BattleMapSession();
    data = await this.mapSession.hydrateResponse(data);
    const requiresExactV2Assets = data.state?.battleMapSchemaVersion === 2;
    this.battleId = data.battleId;
    this.mapSeed = data.mapSeed;
    this.battleState = data.state;
    this.battleState.status ??= 'active';
    this.nodeType = data.nodeType || null; // Store nodeType from server for terrain generation
    // Store initial available actions from server for first turn
    this.serverAvailableActions = data.availableActions || null;
    this.stateRevision = data.stateRevision ?? data.state?.stateRevision ?? null;
    this.inputEnabled = false;
    this.isActionSubmitting = false;
    this.retryableActionIntent = null;
    this.processedCommandIds.clear();
    this.applyAuthoritativeAvailability(this.serverAvailableActions);
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
    this.battleExitInProgress = false;
    this.postBattleRefreshWait = null;

    // PvP turn timer state
    this.pvpTurnTimer = null;
    this.pvpTurnDeadline = null;

    // Initialize grid with asset loader for sprite rendering
    this.grid = new BattleGrid(this.game.canvas, data.mapWidth || 32, data.mapHeight || 32);
    this.grid.setAssetLoader(this.game.assetLoader);
    if (data.state?.battleMapSchemaVersion === 2) {
      // V2 is fully server-authored and hash-verified by BattleMapSession. Never
      // regenerate it locally, even as a visual fallback.
      applyBattleMapPatch(this.grid, data.state);
    } else {
      // V1 retains the deterministic client generation compatibility path.
      this.grid.generateTerrain(this.mapSeed, this.getNodeType());
      applyBattleMapPatch(this.grid, data.state);
    }

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

    const enemyVisuals = Array.from(new Map(
      data.state.units
        .filter(u => u.type === 'enemy')
        .map(u => getNpcVisualIdentity(u, { fallbackBiome: nodeType }))
        .filter(identity => identity.visualId)
        .map(identity => [identity.visualId, identity])
    ).values());
    console.log('[BattleScene] Enemy visuals to preload:', enemyVisuals);

    // Preload each distinct portrait-matched player visual identity. This is
    // intentionally not deduplicated by class: race/gender variants can point
    // at unique sprite strips while missing variants fall back to the class set.
    const playerCharacters = Array.from(new Map(
      data.state.units
        .filter(u => u.type === 'player')
        .map(u => {
          const identity = getPlayerCharacterIdentity(u);
          const character = {
            race: identity.race,
            gender: identity.gender,
            class: identity.className
          };
          return [identity.id, character];
        })
    ).values());
    console.log(`[BattleScene] Player variants to preload: [${playerCharacters.map(c => getPlayerCharacterIdentity(c).id).join(', ')}]`);

    // Preserve every authored identity/selection record. AssetLoader performs
    // any safe cache-key deduplication after recording the V2 selection key.
    const obstacleAssets = collectBattleMapAssetManifest(
      data.state,
      this.grid
    );
    const progress = createAssetPreloadProgress(this.loadingScreen);

    // AWAIT preload to ensure terrain sprites are cached before rendering
    try {
      await Promise.all([
        this.game.assetLoader.preloadTerrainSet(nodeType, {
          onProgress: progress.track('terrain', 'Loading terrain...'),
          requireV2Assets: requiresExactV2Assets
        }),
        this.game.assetLoader.preloadObstacles({
          obstacles: obstacleAssets,
          onProgress: progress.track('map-assets', 'Loading map assets...'),
          requireV2Assets: requiresExactV2Assets
        }),
        ...enemyVisuals.map((identity, index) =>
          this.game.assetLoader.preloadEnemies(identity.primaryBiome, [identity.visualId], {
            onProgress: progress.track(`enemy:${index}`, 'Loading enemies...')
          })
        ),
        ...playerCharacters.map((character, index) =>
          this.game.assetLoader.preloadCharacter(character, {
            onProgress: progress.track(`character:${index}`, 'Loading characters...')
          })
        )
      ]);
      progress.finish();
      console.log(`[BattleScene] Preloaded terrain, obstacles, ${enemyVisuals.length} enemy types, and ${playerCharacters.length} player variants for ${nodeType}`);

      // Reinitialize unit sprites now that assets are loaded
      for (const unit of this.units.values()) {
        unit.initializeSprites();
      }
    } catch (err) {
      console.warn('[BattleScene] Asset preload failed:', err.message);
      if (requiresExactV2Assets) {
        // A V2 map's authored records are authoritative. Entering combat with
        // fallback diamonds would make blocking geometry invisible or
        // misleading, so retain the loading state until a retry succeeds.
        this.assetLoadError = err;
        this.isLoadingAssets = true;
        this.loadingScreen.updateProgress(
          0,
          1,
          'Map assets failed to load. Press R or tap to retry.'
        );
        parchmentToast.error(
          'Battle Map Load Failed',
          'Required map art is unavailable. Retry after checking your connection.'
        );
        return false;
      }

      // V1 keeps its established permissive fallback rendering.
      progress.finish();
    }

    this.assetLoadError = null;
    this.assetLoadRetryData = null;
    this.isLoadingAssets = false;
    this.loadingScreen.hide();

    // Initialize camera after units so we can center on first player
    this.camera = new BattleCamera(this.game.targetWidth, this.game.targetHeight);
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

    // Mobile auto-fit: scale zoom so the isometric grid fits the viewport.
    // Re-applies on breakpoint changes (landscape <-> portrait).
    this._applyMobileFitZoom(mapDimensions);
    this._responsiveUnsubscribe = responsive.onChange(() => {
      this._applyMobileFitZoom(this.grid.getMapPixelDimensions());
    });

    // Apply mobile fit zoom once more after async loading completes
    // to ensure correct sizing on first paint even if resize fired during await
    this._applyMobileFitZoom(mapDimensions);

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
      getItems: () => this.getActiveUnitItemsForRadial(),
      canUseAction: (actionType, { notify = true } = {}) =>
        this.canSubmitAction(actionType, { notify })
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
      getItems: () => this.getActiveUnitItemsForRadial(),
      canUseAction: (actionType, { notify = true } = {}) =>
        this.canSubmitAction(actionType, { notify })
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
    this.terrainTooltip.attachTo(this.game.uiOverlay);

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
    return true;
  }

  /**
   * Retry an exact V2 asset preload without ever revealing the incomplete map.
   * @returns {Promise<boolean>} Whether the scene entered successfully
   */
  async retryAssetLoading() {
    if (!this.assetLoadError
      || !this.assetLoadRetryData
      || this.assetLoadRetryInProgress) {
      return false;
    }

    const retryData = this.assetLoadRetryData;
    this.assetLoadRetryInProgress = true;
    this.loadingScreen?.updateProgress(0, 1, 'Retrying map assets...');
    this.exit();

    try {
      return await this.enter(retryData);
    } catch (err) {
      this.assetLoadError = err;
      this.assetLoadRetryData = retryData;
      this.isLoadingAssets = true;
      if (!this.loadingScreen) {
        this.loadingScreen = new BattleLoadingScreen(this.game);
        this.loadingScreen.show();
      }
      this.loadingScreen.updateProgress(
        0,
        1,
        'Map assets failed to load. Press R or tap to retry.'
      );
      console.warn('[BattleScene] Asset retry failed:', err.message);
      return false;
    } finally {
      this.assetLoadRetryInProgress = false;
    }
  }

  /**
   * Handle viewport/canvas resize
   * Re-applies mobile fit zoom and updates camera viewport dimensions
   */
  onResize() {
    // Update camera viewport dimensions
    if (this.camera) {
      this.camera.updateViewport(this.game.targetWidth, this.game.targetHeight);
    }

    // Re-apply mobile fit zoom with current map dimensions
    if (this.grid) {
      this._applyMobileFitZoom(this.grid.getMapPixelDimensions());
    }
  }

  /**
   * Exit the battle scene
   */
  exit() {
    // Clean up responsive subscription
    if (this._responsiveUnsubscribe) {
      this._responsiveUnsubscribe();
      this._responsiveUnsubscribe = null;
    }

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
    this.inputEnabled = false;
    this.isActionSubmitting = false;
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
   * Delegates to extracted battleLog module.
   * @param {Object} actor - The unit performing the action
   * @param {string} actionType - Type of action (attack, skill, move, wait, item)
   * @param {Object} target - The target unit (optional)
   * @param {Object} result - The action result
   */
  addBattleLogEntry(actor, actionType, target, result) {
    if (!this.ui) return;

    const entry = buildBattleLogEntry({
      actor,
      actionType,
      target,
      result,
      turnCounter: this.battleLogTurnCounter
    });

    this.ui.addBattleLogEntry(entry);
  }

  /**
   * Get a display name for an action
   * Delegates to extracted battleLog module.
   * @param {string} actionType - The action type
   * @param {Object} result - The action result (may contain skill/item name)
   * @returns {string} Display name
   */
  getActionName(actionType, result) {
    return lookupActionName(actionType, result);
  }

  /**
   * Whether the current actor belongs to the local player.
   */
  isLocalActiveUnit(unit = this.getActiveUnit()) {
    if (!unit) return false;
    return this.isPvP
      ? unit.isLocalPlayerUnit(this.game.localUserId)
      : unit.type === 'player';
  }

  /**
   * Apply the server's two-action availability as the single local display
   * source. A missing availability payload is deliberately treated as locked.
   */
  applyAuthoritativeAvailability(availableActions) {
    this.serverAvailableActions = availableActions || null;
    this.canMove = availableActions?.canMove === true;
    this.canAct = availableActions?.canAct === true;
    // Legacy servers did not send canWait. An active unit can always end its
    // turn, including when status effects prevent both movement and acting.
    this.canWait = !!availableActions && availableActions.canWait !== false;
    const bothAvailable = this.canMove && this.canAct;
    const neitherAvailable = !this.canMove && !this.canAct;
    this.turnPhase = availableActions?.turnPhase ??
      (bothAvailable ? 'ready' : (neitherAvailable ? 'done' : 'partial'));
  }

  getActionAvailability(actionType) {
    if (!this.serverAvailableActions) return false;
    if (actionType === 'move') return this.canMove;
    if (['attack', 'skill', 'item'].includes(actionType)) return this.canAct;
    if (actionType === 'wait') return this.canWait;
    if (actionType === 'any') return this.canMove || this.canAct || this.canWait;
    return false;
  }

  /**
   * Authoritative gate shared by menus, shortcuts, targeting, confirmation,
   * and the final network submission.
   */
  canSubmitAction(actionType, { notify = false } = {}) {
    const activeUnit = this.getActiveUnit();
    let message = null;

    if (!this.battleId || this.battleEnded ||
        (this.battleState?.status ?? 'active') !== 'active') {
      message = 'This battle is no longer active';
    } else if (!activeUnit || !this.isLocalActiveUnit(activeUnit)) {
      message = 'Wait for your active unit';
    } else if (!this.inputEnabled) {
      message = 'Battle state is still synchronizing';
    } else if (this.isActionSubmitting) {
      message = 'Your previous action is still being submitted';
    } else if (!this.getActionAvailability(actionType)) {
      message = actionType === 'move'
        ? 'Already moved this turn'
        : actionType === 'wait'
          ? 'No actions remain this turn'
          : 'Already acted this turn';
    }

    if (message && notify) {
      parchmentToast.warning('Action Unavailable', message);
    }
    return !message;
  }

  isStaleStateRevision(revision) {
    if (revision === null || revision === undefined ||
        this.stateRevision === null || this.stateRevision === undefined) {
      return false;
    }
    const incoming = Number(revision);
    const current = Number(this.stateRevision);
    return Number.isFinite(incoming) && Number.isFinite(current) && incoming < current;
  }

  noteStateRevision(revision) {
    if (revision === null || revision === undefined) return;
    if (!this.isStaleStateRevision(revision)) {
      const retryBaseRevision = this.retryableActionIntent?.baseRevision;
      if (retryBaseRevision !== null && retryBaseRevision !== undefined &&
          Number(revision) > Number(retryBaseRevision)) {
        this.retryableActionIntent = null;
      }
      this.stateRevision = revision;
      if (this.battleState) this.battleState.stateRevision = revision;
    }
  }

  clearActionTargetingState() {
    this.currentAction = null;
    this.validTiles = [];
    this.pendingAction = null;
    this.lockedTarget = null;
    this.selectedSkillId = null;
    this.selectedItemId = null;
    this.selectedInventoryId = null;
    this.selectedMoveTile = null;
    this.hideRadialMenu();
    this.ui?.hideConfirmation?.();
    this.ui?.hideSkillPanel?.();
    this.ui?.hideItemPanel?.();
    this.ui?.hideTargetingMode?.();
    this.ui?.clearTargetSticky?.();
    this.ui?.hideActiveUnitPreview?.();
  }

  refreshActionControls() {
    const activeUnit = this.getActiveUnit();
    const controlsEnabled = this.canSubmitAction('any');
    this.ui?.updateAvailableActions?.(this.canMove, this.canAct);
    this.ui?.setActionsEnabled?.(controlsEnabled);
    if (this.actionBar && activeUnit) {
      this.actionBar.updateTurnState(
        controlsEnabled && this.canMove,
        controlsEnabled && this.canAct,
        activeUnit.mp,
        controlsEnabled && this.canWait
      );
    }
  }

  /**
   * Complete, idempotent local-turn recovery used by both your_turn and
   * turn_start. Logical control recovery is independent of camera animation.
   */
  recoverLocalTurn({ unitId, availableActions, stateRevision } = {}) {
    if (!unitId || this.isStaleStateRevision(stateRevision)) return false;
    const activeUnit = this.units.get(unitId);
    if (!activeUnit || !this.isLocalActiveUnit(activeUnit)) return false;

    const startsNewLocalTurn = !this.inputEnabled ||
      String(this.battleState?.activeUnitId) !== String(unitId) ||
      (stateRevision != null && this.stateRevision != null &&
        Number(stateRevision) > Number(this.stateRevision));
    this.noteStateRevision(stateRevision);
    if (startsNewLocalTurn) {
      // A new authoritative local turn supersedes any ambiguous identity left
      // over from an earlier turn; an exact duplicate notification does not.
      this.retryableActionIntent = null;
    }
    this.battleState.status ??= 'active';
    this.battleState.activeUnitId = unitId;
    if (this.selectedUnit && this.selectedUnit !== activeUnit) {
      this.selectedUnit.isSelected = false;
    }
    this.selectedUnit = activeUnit;
    activeUnit.isSelected = true;
    this.inEnemySequence = false;
    this.lastTurnWasEnemy = false;
    this.playerTurnPending = false;
    this.clearActionTargetingState();
    this.applyAuthoritativeAvailability(
      availableActions !== undefined
        ? availableActions
        : this.serverAvailableActions
    );
    this.inputEnabled = !!this.serverAvailableActions &&
      (this.battleState?.status ?? 'active') === 'active' && !this.battleEnded;
    this.updateUI();
    this.refreshActionControls();
    return this.inputEnabled;
  }

  /**
   * Reconcile a structured success/error/poll response without allowing an
   * older replay response to regress newer WebSocket state.
   */
  reconcileAuthoritativePayload(payload = {}, { refresh = true } = {}) {
    const state = payload.state || null;
    const revision = payload.stateRevision ?? state?.stateRevision ?? null;
    if (this.isStaleStateRevision(revision)) return false;

    this.noteStateRevision(revision);
    if (state) {
      this.battleState = { ...this.battleState, ...state };
      if (state.units) this.syncUnitsWithState(state.units);
    }
    if (payload.availableActions !== undefined) {
      this.applyAuthoritativeAvailability(payload.availableActions);
    }

    this.battleState.status ??= 'active';
    this.inputEnabled = this.battleState.status === 'active' &&
      !this.battleEnded &&
      this.isLocalActiveUnit() &&
      !!this.serverAvailableActions;

    if (refresh) {
      this.updateUI();
      this.refreshActionControls();
    }
    return true;
  }

  /**
   * Handle click on a tile
   * @param {number} x - Tile X coordinate
   * @param {number} y - Tile Y coordinate
   * @param {Object} mousePos - Optional mouse position { mouseX, mouseY } for context menu
   */
  handleTileClick(x, y, mousePos = null) {
    const actionBeingTargeted = this.pendingAction?.type || this.currentAction;
    if (actionBeingTargeted &&
        !this.canSubmitAction(actionBeingTargeted, { notify: true })) {
      this.clearActionTargetingState();
      this.refreshActionControls();
      return;
    }

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
        if (!this.canSubmitAction('any', { notify: true })) return;
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
    if (!this.canSubmitAction('move', { notify: true })) return;

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
    if (!this.canSubmitAction('attack', { notify: true })) return;

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
    if (!this.canSubmitAction('skill', { notify: true })) return;

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
   * Play the actor pose and skill travel/impact effect from one normalized
   * descriptor. Both the local HTTP path and observer WebSocket path call this
   * method so the same action has the same presentation everywhere.
   */
  playActionPresentation({
    actor,
    actionType,
    result = {},
    target = null,
    targetTile = null,
    skillId = null
  }) {
    if (!actor || (actionType !== 'attack' && actionType !== 'skill')) return null;

    const skill = resolveActionSkill(actor, result, skillId);
    const descriptor = getActionVisualDescriptor(
      actionType,
      { ...result, actorId: actor.id },
      skill
    );
    const resolvedTile = targetTile || (target ? { x: target.gridX, y: target.gridY } : null) ||
      (descriptor.selfTarget ? { x: actor.gridX, y: actor.gridY } : null);
    const faceX = resolvedTile?.x ?? actor.gridX;
    const faceY = resolvedTile?.y ?? actor.gridY;

    if (descriptor.actorAnimation === 'cast') {
      actor.playCastAnimation?.(faceX, faceY);
    } else {
      actor.playAttackAnimation?.(faceX, faceY);
    }

    if (actionType === 'skill' && this.animations) {
      const targetPosition = descriptor.selfTarget
        ? { x: actor.screenX, y: actor.screenY - 32 }
        : target
          ? { x: target.screenX, y: target.screenY - 32 }
          : resolvedTile
            ? this.grid.gridToScreenWorld(resolvedTile.x, resolvedTile.y)
            : { x: actor.screenX, y: actor.screenY - 32 };
      const tileImpactOffset = !descriptor.selfTarget && !target ? 24 : 0;

      this.animations.addSkillActionEffect(
        actor.screenX,
        actor.screenY - 38,
        targetPosition.x,
        targetPosition.y - tileImpactOffset,
        descriptor,
        skill
      );
    }

    return { descriptor, skill };
  }

  /**
   * Get icon for a skill based on its ID
   * Delegates to extracted skillIcons module.
   * @param {string} skillId - The skill ID
   * @param {string} _unitClass - The unit's class (unused, for API compatibility)
   * @returns {string} Icon emoji
   */
  getSkillIcon(skillId, _unitClass) {
    return lookupSkillIcon(skillId);
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
    if (!this.canSubmitAction('any')) return;

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
   * Compute and apply a zoom that fits the battle grid inside the viewport
   * on mobile. No-op on tablet/desktop where the default 1.0 is correct.
   * Called on scene entry and on breakpoint changes.
   */
  _applyMobileFitZoom(mapDimensions) {
    if (!this.camera || !mapDimensions) return;
    const preferredZoom = this.game.getUserSetting('display.cameraZoom', 1);
    if (!responsive.isMobile()) {
      this.camera.setZoom(preferredZoom);
      return;
    }
    const mapW = mapDimensions.worldMaxX - mapDimensions.worldMinX;
    const mapH = mapDimensions.worldMaxY - mapDimensions.worldMinY;
    if (mapW <= 0 || mapH <= 0) return;
    const fit = Math.min(
      this.game.targetWidth / mapW,
      this.game.targetHeight / mapH
    );
    // Keep some padding so the grid isn't edge-to-edge
    this.camera.setZoom(fit * 0.9 * preferredZoom);
  }

  /**
   * Convert canvas logical coordinates to UI overlay screen coordinates
   * Delegates to extracted battleCoords utility.
   * @param {number} canvasX - X coordinate in canvas logical space
   * @param {number} canvasY - Y coordinate in canvas logical space
   * @returns {Object} { x, y } in screen pixels relative to UI overlay
   */
  canvasToOverlayCoords(canvasX, canvasY) {
    return convertCanvasToOverlay({
      canvasX,
      canvasY,
      canvas: this.game.canvas,
      uiOverlay: this.game.uiOverlay,
      logicalWidth: this.game.targetWidth,
      logicalHeight: this.game.targetHeight
    });
  }

  /**
   * Show context menu for active unit
   * @param {Object} unit - The unit to show menu for
   * @param {Object} mousePos - Optional mouse position { mouseX, mouseY }
   */
  showContextMenuForUnit(unit, mousePos = null) {
    if (!unit || !this.canSubmitAction('any')) return;

    let menuX, menuY;

    if (mousePos) {
      // Use actual mouse position (from left-click)
      menuX = mousePos.mouseX;
      menuY = mousePos.mouseY;
    } else {
      // Fall back to unit's screen position (for keyboard navigation)
      const worldPos = this.grid.gridToScreenWorld(unit.gridX, unit.gridY);
      const screenPos = this.camera.worldToScreen(worldPos.x, worldPos.y);
      const zoomedPos = this.camera.screenToZoomed(screenPos.x, screenPos.y - 40);
      // Convert canvas coords to overlay coords
      const overlayPos = this.canvasToOverlayCoords(zoomedPos.x, zoomedPos.y);
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
    if (!this.canSubmitAction('any')) return;

    const activeUnit = this.getActiveUnit();
    if (!activeUnit || activeUnit.type !== 'player') return;

    // Get unit's screen position in canvas coordinates
    const worldPos = this.grid.gridToScreenWorld(activeUnit.gridX, activeUnit.gridY);
    const screenPos = this.camera.worldToScreen(worldPos.x, worldPos.y);
    const zoomedPos = this.camera.screenToZoomed(screenPos.x, screenPos.y - 40);

    // Convert canvas coords to overlay coords for DOM positioning
    const overlayPos = this.canvasToOverlayCoords(zoomedPos.x, zoomedPos.y);

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
    if (!activeUnit || !this.isLocalActiveUnit(activeUnit) ||
        !this.canSubmitAction(this.currentAction || 'any')) return;

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
    if (!this.canSubmitAction('skill', { notify: true })) return;
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
    const worldPos = this.grid.gridToScreenWorld(activeUnit.gridX, activeUnit.gridY);
    const visualCategory = getVisualCategory(skill);
    this.animations.addSelfAuraEffect(
      worldPos.x,
      worldPos.y - 32,
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
    if (!this.canSubmitAction('item', { notify: true })) return;

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
    if (!this.canSubmitAction('item', { notify: true })) return;
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
    if (!this.pendingAction ||
        !this.canSubmitAction(this.pendingAction.type, { notify: true })) {
      return false;
    }

    this.ui.hideConfirmation();

    // Validate locked target is still valid (could have died via concurrent action)
    if (this.lockedTarget?.unit && this.lockedTarget.unit.hp <= 0) {
      parchmentToast.warning('Target Defeated', 'The target was defeated');
      this.cancelAction();
      return false;
    }
    const submitted = await this.submitAction(
      this.pendingAction.type,
      this.pendingAction.targetTile
    );
    this.cancelAction();
    return submitted;
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
    this.refreshActionControls();

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
    if (!activeUnit ||
        !this.canSubmitAction(actionType, { notify: true })) return false;

    const selectedSkillId = actionType === 'skill'
      ? this.selectedSkillId
      : actionType === 'item'
        ? this.selectedItemId
        : null;
    const selectedInventoryId = actionType === 'item'
      ? this.selectedInventoryId
      : null;
    const intentSignature = JSON.stringify({
      battleId: this.battleId,
      actionType,
      unitId: activeUnit.id,
      targetTile,
      skillId: selectedSkillId,
      inventoryId: selectedInventoryId
    });
    const retryIntent = this.retryableActionIntent?.signature === intentSignature
      ? this.retryableActionIntent
      : null;
    const commandId = retryIntent?.commandId ?? createBattleCommandId();
    const actionSequence = retryIntent?.actionSequence ??
      this.wsManager?.getNextActionSequence();
    const commandBaseRevision = retryIntent?.baseRevision ?? this.stateRevision;
    const submittedIntent = {
      ...(this.pendingAction || {}),
      type: actionType,
      unitId: activeUnit.id,
      targetTile,
      skillId: selectedSkillId,
      inventoryId: selectedInventoryId
    };

    this.isActionSubmitting = true;
    this.refreshActionControls();

    try {
      // Build action payload
      const actionData = {
        battleId: this.battleId,
        actionType,
        unitId: activeUnit.id,
        targetTile,
        commandId,
        stateRevision: commandBaseRevision
      };

      // Add action sequence number for server-side validation
      // This helps detect stale/duplicate actions after reconnection
      if (actionSequence !== undefined) actionData.actionSequence = actionSequence;

      // Add skill or item ID depending on action type
      if (actionType === 'skill') {
        actionData.skillId = selectedSkillId;
        // Play specific skill sound (e.g., skill_fireball, skill_inferno)
        this.audioManager.playSkillSound({ id: selectedSkillId }, this.units.get(activeUnit?.id));
      } else if (actionType === 'item') {
        // For items, we use skillId field to pass the item's itemId
        // (backend expects skillId for item type lookups)
        actionData.skillId = selectedSkillId;
        actionData.inventoryId = selectedInventoryId;
      }

      const result = await this.game.api.submitBattleAction(actionData);

      if (!this.processedCommandIds.has(commandId)) {
        await this.processActionResult(result, submittedIntent);
        this.processedCommandIds.add(commandId);
      } else {
        this.reconcileAuthoritativePayload(result);
      }
      if (this.retryableActionIntent?.commandId === commandId) {
        this.retryableActionIntent = null;
      }
      return true;

    } catch (err) {
      const responsePayload = err.data || err.response;
      const hasAuthoritativeRecovery = !!responsePayload && (
        responsePayload.state !== undefined ||
        responsePayload.snapshot !== undefined ||
        responsePayload.availableActions !== undefined ||
        responsePayload.stateRevision !== undefined
      );
      if (hasAuthoritativeRecovery) {
        this.reconcileAuthoritativePayload(responsePayload);
        this.retryableActionIntent = null;
      } else {
        // Without an authoritative successor, the outcome is ambiguous even
        // for an HTTP error: a commit may have succeeded before the response
        // failed. Preserve both identities for an exact, replay-safe retry.
        this.retryableActionIntent = {
          signature: intentSignature,
          commandId,
          actionSequence,
          baseRevision: commandBaseRevision
        };
      }
      parchmentToast.error('Action Failed', err.message);
      return false;
    } finally {
      this.isActionSubmitting = false;
      this.refreshActionControls();
    }
  }

  /**
   * Process action result from server
   * Handles two-action turn system where turnContinues=true means player has more actions
   */
  async processActionResult(result, submittedIntent = this.pendingAction) {
    const {
      state,
      actionResult,
      enemyActions,
      battleStatus,
      turnContinues,
      availableActions,
      stateRevision
    } = result;
    const responseRevision = stateRevision ?? state?.stateRevision ?? null;
    if (this.isStaleStateRevision(responseRevision)) {
      console.log('[Battle] Ignoring stale action replay response:', responseRevision);
      return false;
    }
    this.noteStateRevision(responseRevision);

    // Handle player movement
    if (actionResult.moved && submittedIntent?.targetTile) {
      const unit = this.units.get(
        submittedIntent?.unitId ?? this.getActiveUnit()?.id
      );
      if (unit) {
        const from = { x: unit.gridX, y: unit.gridY };
        const to = submittedIntent.targetTile;
        unit.moveTo(to.x, to.y);
        // Use consistent distance-based timing
        const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
        const moveDuration = Math.max(ANIMATION_TIMING.MOVEMENT_MIN_MS, distance * ANIMATION_TIMING.MOVEMENT_PER_TILE_MS);
        await this.waitForAnimation(moveDuration);
      }
    }

    // Normalize the actor pose and skill effect once before applying result
    // numbers. This replaces the separate attack-only branches below.
    const submittedActionType = submittedIntent?.type;
    const presentationActor = this.units.get(
      submittedIntent?.unitId ?? this.getActiveUnit()?.id
    );
    const primaryPresentationTarget = actionResult.targetId
      ? this.units.get(actionResult.targetId)
      : null;
    const aoeCenter = actionResult.aoeTiles?.find(tile => tile.isCenter) || null;
    const presentationTargetTile = submittedIntent?.targetTile ||
      (aoeCenter ? { x: aoeCenter.x, y: aoeCenter.y } : null);
    const actionPresentation = this.playActionPresentation({
      actor: presentationActor,
      actionType: submittedActionType,
      result: actionResult,
      // AoE travel must resolve at the selected area center, not whichever
      // affected unit happened to become the compatibility primary target.
      target: actionResult.isAoE ? null : primaryPresentationTarget,
      targetTile: presentationTargetTile,
      skillId: submittedIntent?.skillId || actionResult.skillUsed || actionResult.skillId
    });
    if (actionPresentation) {
      await this.waitForAnimation(200);
    }

    // Handle empty tile attack (no target)
    if (actionResult.attackedEmptyTile) {
      await this.waitForAnimation(100);
    }

    // Handle AoE skill damage (hits multiple units)
    if (actionResult.isAoE && actionResult.aoeTargets) {
      // Note: Skill sound already played in submitAction when skill was cast

      // Flash all AoE tiles
      if (actionResult.aoeTiles) {
        for (const tile of actionResult.aoeTiles) {
          const tilePos = this.grid.gridToScreenWorld(tile.x, tile.y);
          const baseColor = actionPresentation?.descriptor.primaryColor || '#ff8800';
          const color = tile.isCenter ? baseColor : `${baseColor}aa`;
          this.animations.addFlash(tilePos.x, tilePos.y, color);
        }
      }

      // Apply damage to each affected unit simultaneously
      const deathAnimations = [];
      for (const targetInfo of actionResult.aoeTargets) {
        const target = this.units.get(targetInfo.targetId);
        if (!target) continue;

        if (targetInfo.isAbsorb || targetInfo.healing > 0) {
          const healing = Number(targetInfo.healing) || 0;
          target.hp = Math.min(target.maxHp, target.hp + healing);
          if (healing > 0) {
            this.animations.addHealNumber(target.screenX, target.screenY - 40, healing);
          }
          // The shared area impact already played at the center. Use the same
          // lightweight per-target burst as damage instead of replaying a full
          // skill impact (flash, glow, and delayed burst) on every healed unit.
          this.animations.addParticleBurst(
            target.screenX,
            target.screenY - 32,
            actionPresentation?.descriptor.primaryColor || '#44ff88'
          );
          continue;
        }

        const damage = Number(targetInfo.damage) || 0;
        if (damage <= 0) continue;

        // Play hit animation and impact sound
        target.playHitAnimation();
        this.audioManager.playImpactSound({ ...actionResult, ...targetInfo, damage });

        // Show damage number
        this.animations.addDamageNumber(
          target.screenX,
          target.screenY - 40,
          damage,
          targetInfo.isCritical,
          targetInfo.element || actionResult.element,
          targetInfo.elementalModifier
        );

        // Keep the damage burst aligned with the skill category while retaining
        // the warm warning color for friendly fire.
        const isAllyHit = presentationActor?.teamId === target.teamId;
        const particleColor = isAllyHit
          ? '#ff8844'
          : (actionPresentation?.descriptor.primaryColor || '#ff4444');
        this.animations.addParticleBurst(target.screenX, target.screenY - 32, particleColor);

        // Update unit HP
        target.hp = Math.max(0, target.hp - damage);

        // Track deaths for animation later
        if (!target.isAlive()) {
          deathAnimations.push(target);
        }

        // Show status effect if applied and play sound
        if (targetInfo.effectApplied) {
          this.audioManager.playStatusEffectSound(targetInfo.effectApplied);
          this.animations.addStatusEffect(
            target.screenX,
            target.screenY - 60,
            targetInfo.effectApplied.toUpperCase()
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
      const target = this.units.get(actionResult.targetId);
      // Note: Skill sound already played in submitAction when skill was cast

      if (target) {
        // Target plays hit animation
        target.playHitAnimation();
        // Use impact sound system
        this.audioManager.playImpactSound(actionResult);
        this.animations.addDamageNumber(
          target.screenX,
          target.screenY - 40,
          actionResult.damage,
          actionResult.isCritical,
          actionResult.element,
          actionResult.elementalModifier
        );
        if (submittedActionType !== 'skill') {
          this.animations.addFlash(target.screenX, target.screenY - 32, '#ff4444');
          this.animations.addParticleBurst(target.screenX, target.screenY - 32, '#ff4444');
        }
        target.hp = Math.max(0, target.hp - actionResult.damage);

        // Play status effect sound if effect was applied
        if (submittedActionType !== 'skill' &&
            (actionResult.effectApplied || actionResult.statusApplied)) {
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
        this.animations.addMiss(target.screenX, target.screenY - 40);
        await this.waitForAnimation(300);
      }
    }

    // Healing, restoration, buffs, and cleanses are valid skill outcomes even
    // when no damage branch ran. AoE statuses are already handled per target
    // above, so this block is deliberately single-target only.
    if (submittedActionType === 'skill' && !actionResult.isAoE) {
      const resourceTarget = actionResult.targetId != null
        ? this.units.get(actionResult.targetId)
        : actionPresentation?.descriptor.selfTarget
          ? presentationActor
          : null;
      let showedOutcomeFeedback = false;

      const healing = Number(actionResult.healing) || 0;
      if (resourceTarget && healing > 0) {
        resourceTarget.hp = Math.min(resourceTarget.maxHp, resourceTarget.hp + healing);
        this.animations.addHealNumber(resourceTarget.screenX, resourceTarget.screenY - 40, healing);
        showedOutcomeFeedback = true;
      }

      const mpRestored = Number(actionResult.mpRestored) || 0;
      if (resourceTarget && mpRestored > 0) {
        resourceTarget.mp = Math.min(resourceTarget.maxMp, resourceTarget.mp + mpRestored);
        this.animations.addMpRestoreNumber(resourceTarget.screenX, resourceTarget.screenY - 58, mpRestored);
        showedOutcomeFeedback = true;
      }

      const statusResults = [...(actionResult.skillEffects || [])];
      const topLevelStatus = actionResult.effectApplied || actionResult.statusApplied;
      if (topLevelStatus) {
        statusResults.push({ effect: topLevelStatus, targetId: actionResult.targetId });
      }

      const shownStatuses = new Set();
      for (const effect of statusResults) {
        const effectTarget = effect.targetId != null
          ? this.units.get(effect.targetId)
          : resourceTarget;
        const rawLabel = effect.effect || effect.status || effect.type;
        if (!effectTarget || !rawLabel) continue;

        const label = effect.type === 'cleanse' && !effect.effect
          ? 'CLEANSED'
          : String(rawLabel).toUpperCase();
        const statusKey = `${effectTarget.id}:${label}`;
        if (shownStatuses.has(statusKey)) continue;
        shownStatuses.add(statusKey);

        this.animations.addStatusEffect(effectTarget.screenX, effectTarget.screenY - 74, label);
        this.audioManager.playStatusEffectSound(effect.effect || effect.status || effect.type);
        showedOutcomeFeedback = true;
      }

      if (showedOutcomeFeedback) {
        await this.waitForAnimation(300);
      }
    }

    // Handle item use effects (healing, MP restore, cleanse, revive)
    if (actionResult.itemUsed && actionResult.itemEffects) {
      for (const effect of actionResult.itemEffects) {
        const target = this.units.get(effect.targetId);
        if (!target) continue;

        if (effect.type === 'heal') {
          this.audioManager.playSound('skill_heal');
          target.hp = Math.min(target.maxHp, target.hp + effect.amount);
          this.animations.addHealNumber(target.screenX, target.screenY - 40, effect.amount);
          this.animations.addParticleBurst(target.screenX, target.screenY - 32, '#44ff44');
          await this.waitForAnimation(300);
        } else if (effect.type === 'mpRestore') {
          this.audioManager.playSound('skill_heal');
          target.mp = Math.min(target.maxMp, target.mp + effect.amount);
          this.animations.addHealNumber(target.screenX, target.screenY - 40, effect.amount);
          this.animations.addParticleBurst(target.screenX, target.screenY - 32, '#4488ff');
          await this.waitForAnimation(300);
        } else if (effect.type === 'cleanse') {
          this.audioManager.playSound('skill_heal');
          this.animations.addHealNumber(target.screenX, target.screenY - 40, 'Cleansed');
          await this.waitForAnimation(300);
        } else if (effect.type === 'revive') {
          this.audioManager.playSound('skill_heal');
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
    if (submittedIntent && actionResult) {
      const activeUnit = this.units.get(
        submittedIntent.unitId ?? this.getActiveUnit()?.id
      );
      const targetUnit = actionResult.targetId ? this.units.get(actionResult.targetId) : null;
      const actionType = submittedIntent.type;

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
      if (actionType === 'move' && submittedIntent.targetTile) {
        logResult.from = { x: activeUnit?.gridX, y: activeUnit?.gridY };
        logResult.to = submittedIntent.targetTile;
      }

      this.addBattleLogEntry(activeUnit, actionType, targetUnit, logResult);
    }

    // Action presentation intentionally awaits local animation. During that
    // time the enemy sequence can finish and a newer WebSocket revision can
    // restore the next local turn. Never let this older HTTP response overwrite
    // that successor or lock input again after it was already recovered.
    if (this.isStaleStateRevision(responseRevision)) {
      console.log(
        '[Battle] Action response was superseded during presentation; preserving WebSocket state:',
        responseRevision,
        '->',
        this.stateRevision
      );
      this.clearActionTargetingState();
      this.syncUnitsWithState(this.battleState?.units || []);
      this.updateUI();
      this.refreshActionControls();
      return true;
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

    // Update battle state selectively. WebSocket turn_start owns camera
    // presentation, while the direct-local handoff below may still update the
    // logical active unit. HTTP and WebSocket delivery are intentionally
    // treated as unordered.
    console.log('[Camera] processActionResult - syncing unit data only (activeUnitId stays:', this.battleState?.activeUnitId, ')');
    this.syncUnitsWithState(state?.units || []);

    // Update turn predictions if available (for turn order display)
    if (state?.turnPredictions) {
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
    this.applyAuthoritativeAvailability(availableActions);

    // Check battle end - queue so it waits for death animations
    if (battleStatus !== 'active') {
      this.inputEnabled = false;
      console.log('[BattleScene] Queueing battle_end from HTTP response:', {
        status: battleStatus,
        hasRewards: !!actionResult.rewards,
        queueLength: this.turnEventQueue.length,
        isProcessing: this.isProcessingQueue,
        battleEnded: this.battleEnded
      });
      this.wsManager?.queueAuthoritativeBattleEnd(battleStatus, actionResult.rewards);
    } else if (turnContinues) {
      // Two-action system: turn not complete, update available actions
      this.applyAuthoritativeAvailability(availableActions);
      this.inputEnabled = !!this.serverAvailableActions &&
        this.isLocalActiveUnit();

      // Update UI to show remaining options
      this.updateUIForPartialTurn();
    } else {
      const responseActiveUnit = state?.units?.find(
        unit => String(unit.id) === String(state.activeUnitId)
      );
      const renderedActiveUnit = responseActiveUnit
        ? this.units.get(responseActiveUnit.id)
        : null;
      const hasAuthoritativeLocalHandoff = !!availableActions &&
        !!renderedActiveUnit &&
        this.isLocalActiveUnit(renderedActiveUnit);

      if (hasAuthoritativeLocalHandoff) {
        // CT can hand a completed turn directly to another local character (or
        // back to the same fast character) without an intervening enemy. The
        // server sends that successor in this HTTP response as well as over
        // WebSocket. Recover logical control from the response so an earlier
        // turn_start/your_turn cannot be overwritten by response ordering.
        this.recoverLocalTurn({
          unitId: responseActiveUnit.id,
          availableActions,
          stateRevision: responseRevision
        });
        if (this.wsManager) {
          this.wsManager.lastYourTurnUnitId = responseActiveUnit.id;
        }
        console.log(
          '[Battle] Turn complete, recovered direct local handoff:',
          responseActiveUnit.id
        );
      } else {
        // An enemy or remote player owns the committed successor. Remain
        // logically locked while WebSocket presentation advances the turn.
        this.applyAuthoritativeAvailability(null);
        this.inputEnabled = false;
        if (this.wsManager) this.wsManager.lastYourTurnUnitId = null;

        // Mark that we're entering enemy sequence (prevents camera drift to player)
        // This flag is set BEFORE WebSocket events arrive, preventing the race condition
        this.inEnemySequence = true;
        console.log('[Camera] Turn complete, entering enemy sequence (camera will wait for queue)');

        // Don't call updateUI() here - let the queue system handle turn transitions
        // The queue will process enemy turn_start events, then player turn_start,
        // which will call updateUI() at the appropriate time
      }
    }
    return true;
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

    // Recover from the authoritative initial payload after presentation.
    this.recoverLocalTurn({
      unitId: this.battleState.activeUnitId,
      availableActions: this.serverAvailableActions,
      stateRevision: this.stateRevision
    });
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
    this.ui.setActionsEnabled(this.canSubmitAction('any'));

    // Update persistent action bar with new turn state
    if (this.actionBar) {
      this.actionBar.updateTurnState(
        this.canMove,
        this.canAct,
        activeUnit.mp,
        this.canWait
      );
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
        // State snapshots are authoritative for life/death. Preserve an active
        // death transition, but repair stale idle/live poses after reconnects,
        // polling drift, or missed presentation events.
        unit.reconcileAnimationWithHealth();
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
   * Clear all queued inputs and pending actions
   * Called after reconnection to prevent stale inputs from being processed
   */
  clearQueuedInputs() {
    console.log('[BattleScene] Clearing queued inputs');

    this.pendingAction = null;
    this.currentAction = null;
    this.validTiles = [];
    this.inputEnabled = false;
    this.applyAuthoritativeAvailability(null);
    this.selectedSkillId = null;
    this.selectedItemId = null;
    this.selectedInventoryId = null;

    // Hide any open menus
    this.hideRadialMenu();
    if (this.ui) {
      this.ui.hideSkillMenu?.();
      this.ui.hideItemMenu?.();
    }
  }

  /**
   * Handle critical drift detected during animation queue processing
   * Called by BattleWebSocketManager when the poller detects important state changes
   * (turn changed, battle ended) while animations are playing.
   * @param {string} driftType - Type of drift: 'turn_changed', 'turn_count_changed', 'status_changed'
   * @param {*} serverValue - The server's value for the changed field
   * @param {Object} _serverState - Full server state for reference (unused, for future extensions)
   */
  onCriticalDrift(driftType, serverValue, _serverState) {
    console.log(`[BattleScene] Critical drift notification: ${driftType}`, serverValue);

    // For battle end, we may want to interrupt animations and show results
    if (driftType === 'status_changed' && serverValue !== 'active') {
      console.log('[BattleScene] Battle ended on server during animations - queueing end');

      // Force complete pending animations if available
      if (this.animations?.forceComplete) {
        this.animations.forceComplete();
      }

      // The battle end will be processed when the queue finishes
      // since the poller will trigger a full sync after critical mode ends
    }

    // For turn changes during animations, just log - the queue handles turn transitions
    // The full sync after critical mode will catch any missed state
    if (driftType === 'turn_changed') {
      console.log('[BattleScene] Turn changed on server during animations - will sync after queue');
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

    // Rewards have been committed before the terminal event is delivered.
    // Start the bounded refresh under the outro so Continue normally has no
    // additional network wait, while preserving a fail-open scene exit.
    this.postBattleRefreshWait = waitForPostBattleSessionRefresh(this.game);

    // Hold surviving winners on their authored victory pose while the outro
    // sequence enters. In PvP, determine the local team rather than celebrating
    // every player-type unit.
    const localUserId = this.game.localUserId;
    const localTeamId = this.isPvP
      ? (Array.from(this.units.values()).find(unit => unit.ownerId === localUserId)?.teamId ?? 1)
      : 1;
    for (const unit of this.units.values()) {
      if (!unit.isAlive()) continue;
      const isLocalSide = this.isPvP
        ? unit.teamId === localTeamId
        : unit.type === 'player';
      const isWinner = status === 'victory' ? isLocalSide : !isLocalSide;
      if (isWinner) unit.playVictoryAnimation?.();
    }

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
  async endBattle() {
    if (this.battleExitInProgress) return;
    this.battleExitInProgress = true;

    // Clear PvP timer if running
    if (this.pvpTurnTimer) {
      clearInterval(this.pvpTurnTimer);
      this.pvpTurnTimer = null;
    }

    // Resume previous music after a short delay (after victory/defeat fanfare)
    setTimeout(() => {
      this.audioManager.resumeAfterBattle();
    }, 3000);

    // Rewards are persisted before battle:end is delivered, but the frontend's
    // account and character snapshots still predate the battle. Refresh them
    // before the destination scene reads gold or experience.
    // Return to coliseum for PvP battles, world map otherwise
    const returnScene = this.isPvP ? 'coliseum' : 'worldMap';
    try {
      const refreshResult = await (this.postBattleRefreshWait ||
        waitForPostBattleSessionRefresh(this.game));
      if (refreshResult.timedOut) {
        console.warn('[Battle] Post-battle state refresh timed out; leaving battle');
      }
    } catch (error) {
      // Timer/scheduling failures must not trap the player in a completed battle.
      console.warn('[Battle] Unable to wait for post-battle state refresh:', error.message);
    } finally {
      transitionFromBattleIfCurrent(this.game, this, returnScene);
    }
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

    // Find the actual unit in battleUnits (units is a Map)
    const unit = this.units.get(prediction.id);
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
        const controlsEnabled = this.canSubmitAction('any');
        this.ui.setActionsEnabled(controlsEnabled);

        // Show action bar only if user preference is 'actionbar'
        const actionStyle = this.getActionMenuStyle();
        if (this.actionBar && actionStyle === 'actionbar') {
          this.actionBar.show(
            controlsEnabled && this.canMove,
            controlsEnabled && this.canAct,
            activeUnit.mp,
            controlsEnabled && this.canWait
          );
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
          if (this.getActiveUnit()?.id === activeUnit.id &&
              !this.currentAction && this.canSubmitAction('any')) {
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

    if (this.assetLoadError) {
      const input = this.game.input;
      if (!this.assetLoadRetryInProgress
        && (input.isKeyPressed('KeyR')
          || input.mouseClicked
          || input.touchTapped)) {
        void this.retryAssetLoading();
      }
      input.clearFrameState();
      return;
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
          const recovered = this.recoverLocalTurn({
            unitId: this.battleState.activeUnitId,
            availableActions: this.serverAvailableActions,
            stateRevision: this.stateRevision
          });
          if (!recovered) this.updateUI();
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

    // Update camera (also advances an active turn transition exactly once)
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

    // Update terrain tooltip (DOM-based, throttled for Firefox performance)
    this.updateTerrainTooltip();

    // Update tile cycling for overlapping elevations (delegated to input handler)
    if (this.inputHandler) {
      this.inputHandler.updateTileCycling(deltaTime);
      this.inputHandler.updatePinchZoom();
    }

    // Clear input state
    this.game.input.clearFrameState();
  }

  /**
   * Render the battle scene
   */
  render(ctx) {
    // Clear background (context is DPR-pre-scaled, so use logical dims)
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, this.game.targetWidth, this.game.targetHeight);

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

    // Build tile highlights using extracted module
    const localUserId = this.game.localUserId;
    const localTeamId = this.isPvP
      ? (Array.from(this.units.values()).find(u => u.ownerId === localUserId)?.teamId ?? 1)
      : 1;
    const activeUnit = this.getActiveUnit();
    const skill = (this.currentAction === 'skill' && activeUnit)
      ? this.getUnitActiveSkills(activeUnit).find(s => s.id === this.selectedSkillId)
      : null;

    const highlights = buildHighlights({
      currentAction: this.currentAction,
      validTiles: this.validTiles,
      movementRange: this.movementRange,
      selectedMoveTile: this.selectedMoveTile,
      hoveredTile: this.hoveredTile,
      pathfinding: this.pathfinding,
      skill,
      getUnitAt: (x, y) => this.getUnitAt(x, y),
      isPvP: this.isPvP,
      localUserId,
      localTeamId
    });

    // Update occlusion cache with current unit positions before rendering
    const aliveUnits = Array.from(this.units.values()).filter(u => u.isAlive());
    this.grid.invalidateOcclusionCache();
    this.grid.updateOcclusionCache(aliveUnits);

    // Apply camera zoom as a visual scale around the viewport center.
    // Grid, units, and animations share the same transform so hit-testing
    // (which inverts via camera.screenToUnzoomed) stays consistent.
    const zoom = this.camera?.zoom || 1;
    const needsZoom = zoom !== 1;
    if (needsZoom) {
      const cx = this.game.targetWidth / 2;
      const cy = this.game.targetHeight / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(zoom, zoom);
      ctx.translate(-cx, -cy);
    }

    // Render terrain, props, and units through a single painter queue so a
    // foreground cliff can correctly cover a unit behind it.
    const allUnits = Array.from(this.units.values());
    this.grid.renderWithIntentHighlights(ctx, highlights, this.camera, {
      entities: allUnits,
      renderEntity: unit => unit.render(ctx, this.camera, localTeamId)
    });

    // Render grid cursor (keyboard navigation)
    if (this.gridCursor) {
      this.gridCursor.render(ctx, this.camera);
    }

    // Render tile cycle indicator when multiple tiles overlap (delegated to input handler)
    if (this.inputHandler) {
      this.inputHandler.renderTileCycleIndicator(ctx);
    }

    // Render animations with camera transform
    this.renderAnimationsWithCamera(ctx);

    if (needsZoom) {
      ctx.restore();
    }

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
   * Update terrain tooltip when hovering over tiles.
   * Shows terrain name, movement cost, and elevation for any hovered tile.
   * Uses fixed-position DOM tooltip in top-left corner.
   */
  updateTerrainTooltip() {
    if (!this.terrainTooltip) return;

    // Hide during intro/outro sequences
    if (this.isIntroPlaying || (this.outroSequence && !this.outroSequence.isComplete())) {
      this.terrainTooltip.hide();
      return;
    }

    // Determine which tile to show tooltip for
    // During move action on mobile, use selected move tile; otherwise use hovered tile
    const tooltipTile = (this.isTouchDevice && this.currentAction === 'move' && this.selectedMoveTile)
      ? this.selectedMoveTile
      : this.hoveredTile;
    if (!tooltipTile) {
      this.terrainTooltip.hide();
      return;
    }

    // Get terrain info and show tooltip (fixed position, no coordinates needed)
    const terrain = this.grid.getTerrain(tooltipTile.x, tooltipTile.y);
    const moveCost = this.grid.getMovementCost(tooltipTile.x, tooltipTile.y);
    const elevation = this.grid.getElevation(tooltipTile.x, tooltipTile.y);

    this.terrainTooltip.show({
      terrain,
      movementCost: moveCost,
      elevation
    });
  }

  /**
   * Render animations with camera transform
   */
  renderAnimationsWithCamera(ctx) {
    ctx.save();
    try {
      const screenOffset = this.camera.worldToScreen(0, 0);
      ctx.translate(screenOffset.x, screenOffset.y);
      this.animations.render(ctx);
    } finally {
      ctx.restore();
    }
  }

  /**
   * Render minimap in corner (delegates to extracted module)
   */
  renderMinimap(ctx) {
    const localUserId = this.game.localUserId;
    const localTeamId = this.isPvP
      ? (Array.from(this.units.values()).find(unit => unit.ownerId === localUserId)?.teamId ?? 1)
      : 1;
    renderMinimapOverlay({
      ctx,
      units: this.units,
      camera: this.camera,
      grid: this.grid,
      targetWidth: this.game.targetWidth,
      targetHeight: this.game.targetHeight,
      localTeamId
    });
  }
}
