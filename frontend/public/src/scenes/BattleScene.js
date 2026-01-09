import { Scene } from './Scene.js';
import { BattleGrid } from '../battle/BattleGrid.js';
import { BattleUnit } from '../battle/BattleUnit.js';
import { BattleUI } from '../battle/BattleUI.js';
import { BattleAnimations } from '../battle/BattleAnimations.js';
import { BattlePathfinding } from '../battle/BattlePathfinding.js';
import { BattleCamera } from '../battle/BattleCamera.js';
import { BattleIntro } from '../battle/BattleIntro.js';
import { RadialMenu } from '../battle/RadialMenu.js';
import RewardsModal from '../components/RewardsModal.js';

// Movement range by class (mirrored from shared/constants.js)
const CLASS_MOVEMENT = {
  warrior: 3,
  wizard: 3,
  monk: 4,
  chemist: 3,
  berserker: 3,
  sorcerer: 2,
  ninja: 5,
  alchemist: 3
};

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

    // Mobile/touch support for terrain preview
    this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.selectedMoveTile = null; // For two-tap movement on mobile

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

    // Turn event queue - processes WebSocket events in sequence with proper animation timing
    this.turnEventQueue = [];
    this.isProcessingQueue = false;
    this.playerTurnPending = false; // True when player's turn is queued but not yet shown

    // Event cleanup
    this.abortController = null;

    // WebSocket event unsubscribers
    this.wsUnsubscribers = [];
  }

  /**
   * Enter the battle scene
   */
  enter(data) {
    // data = { battleId, mapSeed, mapWidth, mapHeight, state, initialEnemyActions }
    this.battleId = data.battleId;
    this.mapSeed = data.mapSeed;
    this.battleState = data.state;
    this.initialEnemyActions = data.initialEnemyActions || null;

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

    // Preload terrain tiles, obstacles, and enemy sprites in background
    // Units will get sprites when preloading completes
    const nodeType = this.getNodeType();

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

    Promise.all([
      this.game.assetLoader.preloadTerrainSet(nodeType),
      this.game.assetLoader.preloadObstacles(),
      this.game.assetLoader.preloadEnemies(nodeType, enemyIds),
      ...playerClasses.map(cls => this.game.assetLoader.preloadCharacter(cls))
    ]).then(() => {
      console.log(`Preloaded terrain, obstacles, ${enemyIds.length} enemy types, and ${playerClasses.length} player classes for ${nodeType}`);
      // Reinitialize unit sprites now that assets are loaded
      for (const unit of this.units.values()) {
        unit.initializeSprites();
      }
    }).catch(err => {
      console.warn('Failed to preload assets:', err.message);
    });

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
      onContinue: () => this.endBattle()
    });

    // Initialize radial action menu
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

    // Setup input handlers
    this.setupInputHandlers();

    // Setup WebSocket handlers for real-time events
    this.setupWebSocketHandlers();

    // Start battle intro sequence
    this.intro = new BattleIntro(this);
    this.intro.start();
    this.isIntroPlaying = true;
    this.ui.hide(); // Hide action menu during intro

    // Update UI with initial state (will show after intro)
    this.updateUI();
  }

  /**
   * Exit the battle scene
   */
  exit() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
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

    if (this.rewardsModal) {
      this.rewardsModal.destroy();
      this.rewardsModal = null;
    }

    this.units.clear();
    this.validTiles = [];
    this.currentAction = null;
    this.selectedUnit = null;
  }

  /**
   * Get node type from game state for terrain generation
   */
  getNodeType() {
    const currentNode = this.game.state.get('currentNode');
    return currentNode?.node_type || 'forest';
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
   * Setup canvas input handlers
   */
  setupInputHandlers() {
    this.abortController = new AbortController();
    const opts = { signal: this.abortController.signal };
    const canvas = this.game.canvas;

    // Mouse move - hover detection and pan tracking
    canvas.addEventListener('mousemove', (e) => {
      const pos = this.game.input.getPointerPosition();

      // Update pan if dragging
      if (this.camera.isPanning) {
        this.camera.updatePan(pos.x, pos.y);
      }

      // Update hovered tile (with camera transform)
      this.hoveredTile = this.grid.getTileAtScreen(pos.x, pos.y, this.camera);

      // Update target info if hovering over unit
      if (this.hoveredTile) {
        const unit = this.getUnitAt(this.hoveredTile.x, this.hoveredTile.y);
        if (unit && unit.type === 'enemy') {
          this.ui.showTargetInfo(unit);
        } else {
          this.ui.hideTargetInfo();
        }
      }
    }, opts);

    // Mouse down - start panning
    canvas.addEventListener('mousedown', (e) => {
      const pos = this.game.input.getPointerPosition();
      this.camera.startPan(pos.x, pos.y);
    }, opts);

    // Mouse up - end panning and handle click
    canvas.addEventListener('mouseup', (e) => {
      const panDistance = this.camera.getPanDistance();
      this.camera.endPan();

      // Only register as click if pan distance was small (not a drag)
      if (panDistance < 10) {
        const pos = this.game.input.getPointerPosition();
        const tile = this.grid.getTileAtScreen(pos.x, pos.y, this.camera);
        if (tile) {
          this.handleTileClick(tile.x, tile.y);
        }
      }
    }, opts);

    // Keyboard input for camera and actions
    window.addEventListener('keydown', (e) => {
      // Spacebar - return to follow mode
      if (e.code === 'Space') {
        e.preventDefault();
        this.camera.returnToFollowMode();
      }

      // Escape - cancel current action and return to action menu
      if (e.code === 'Escape' && this.currentAction !== null) {
        e.preventDefault();
        this.cancelAction();
      }
    }, opts);
  }

  /**
   * Setup WebSocket handlers for real-time battle events
   */
  setupWebSocketHandlers() {
    const socket = this.game.socket;
    if (!socket) return;

    // Join battle room
    socket.joinBattleRoom(this.battleId);

    // Handle battle state updates (for multiplayer sync)
    const stateUpdateUnsub = socket.on('battle:state_update', (payload) => {
      console.log('[Battle WS] State update received:', payload.battleId);
      if (payload.battleId === this.battleId) {
        this.handleRemoteStateUpdate(payload);
      }
    });
    this.wsUnsubscribers.push(stateUpdateUnsub);

    // Handle unit movement from other players
    const unitMovedUnsub = socket.on('battle:unit_moved', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleRemoteUnitMoved(payload);
      }
    });
    this.wsUnsubscribers.push(unitMovedUnsub);

    // Handle action execution from other players
    const actionExecutedUnsub = socket.on('battle:action_executed', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleRemoteActionExecuted(payload);
      }
    });
    this.wsUnsubscribers.push(actionExecutedUnsub);

    // NOTE: battle:turn_changed is DEPRECATED - use battle:turn_start instead
    // The turn_start event includes position data for camera panning and is the authoritative turn notification

    // Handle battle end
    const battleEndUnsub = socket.on('battle:end', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleRemoteBattleEnd(payload);
      }
    });
    this.wsUnsubscribers.push(battleEndUnsub);

    // Handle enemy actions batch
    const enemyActionsUnsub = socket.on('battle:enemy_actions', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleRemoteEnemyActions(payload);
      }
    });
    this.wsUnsubscribers.push(enemyActionsUnsub);

    // NEW: Handle turn start (camera pan trigger)
    const turnStartUnsub = socket.on('battle:turn_start', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleRemoteTurnStart(payload);
      }
    });
    this.wsUnsubscribers.push(turnStartUnsub);

    // NEW: Handle intent highlights (enemy visualization)
    const intentHighlightUnsub = socket.on('battle:intent_highlight', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleRemoteIntentHighlight(payload);
      }
    });
    this.wsUnsubscribers.push(intentHighlightUnsub);

    // NEW: Handle "your turn" notification
    const yourTurnUnsub = socket.on('battle:your_turn', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleRemoteYourTurn(payload);
      }
    });
    this.wsUnsubscribers.push(yourTurnUnsub);

    // NEW: Handle player disconnection
    const playerDisconnectedUnsub = socket.on('battle:player_disconnected', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleRemotePlayerDisconnected(payload);
      }
    });
    this.wsUnsubscribers.push(playerDisconnectedUnsub);

    // NEW: Handle player reconnection
    const playerReconnectedUnsub = socket.on('battle:player_reconnected', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleRemotePlayerReconnected(payload);
      }
    });
    this.wsUnsubscribers.push(playerReconnectedUnsub);

    // NEW: Handle full state sync (for reconnection)
    const stateSyncUnsub = socket.on('battle:state_sync', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleRemoteStateSync(payload);
      }
    });
    this.wsUnsubscribers.push(stateSyncUnsub);

    // Handle socket disconnect - trigger auto-reconnect
    const disconnectUnsub = socket.on('disconnect', () => {
      this.handleSocketDisconnect();
    });
    this.wsUnsubscribers.push(disconnectUnsub);

    // Handle socket reconnect - rejoin battle room
    const reconnectUnsub = socket.on('connect', () => {
      if (this.battleId) {
        console.log('[Battle WS] Socket reconnected, rejoining battle room');
        socket.joinBattleRoom(this.battleId);
        this.attemptRejoin();
      }
    });
    this.wsUnsubscribers.push(reconnectUnsub);
  }

  /**
   * Clean up WebSocket handlers
   */
  cleanupWebSocketHandlers() {
    // Unsubscribe from all WebSocket events
    for (const unsub of this.wsUnsubscribers) {
      if (typeof unsub === 'function') {
        unsub();
      }
    }
    this.wsUnsubscribers = [];

    // Leave battle room
    if (this.game.socket && this.battleId) {
      this.game.socket.leaveBattleRoom(this.battleId);
    }
  }

  /**
   * Attempt to rejoin battle after disconnect
   * @returns {Promise<boolean>} Whether rejoin was successful
   */
  async attemptRejoin() {
    if (!this.battleId) {
      console.error('[Battle] Cannot rejoin - no battle ID');
      return false;
    }

    try {
      console.log('[Battle] Attempting to rejoin battle', this.battleId);

      // Show reconnecting notification
      if (this.ui) {
        this.ui.showNotification('Reconnecting...', 'info', 5000);
      }

      const response = await this.game.api.request(`/battle/${this.battleId}/rejoin`);

      if (response.success) {
        console.log('[Battle] Rejoin successful');

        // Update local state with server state
        this.battleState = response.state;
        this.syncUnitsWithState(response.state.units);
        this.updateUI();

        // Rejoin WebSocket room
        if (this.game.socket) {
          this.game.socket.joinBattleRoom(this.battleId);
        }

        // Show reconnection notification
        if (this.ui) {
          this.ui.showNotification('Reconnected!', 'success', 2000);
        }

        // Handle grace period (brief delay before turn timer resumes)
        if (response.gracePeriod > 0) {
          console.log(`[Battle] Grace period: ${response.gracePeriod}ms`);
        }

        // Show any disconnected players
        if (response.disconnectedPlayers?.length > 0) {
          for (const player of response.disconnectedPlayers) {
            this.ui?.showNotification(
              `${player.playerName} is disconnected`,
              'warning',
              5000
            );
          }
        }

        return true;
      }
    } catch (error) {
      console.error('[Battle] Rejoin failed:', error);

      if (this.ui) {
        this.ui.showNotification('Reconnection failed', 'error', 3000);
      }

      // If battle is no longer active, return to world map
      if (error.message?.includes('no longer active')) {
        this.game.changeScene('WorldMap');
        return false;
      }
    }

    return false;
  }

  /**
   * Setup auto-reconnect on WebSocket disconnect
   * Called from the main socket connection logic
   */
  handleSocketDisconnect() {
    console.log('[Battle] WebSocket disconnected during battle');

    if (this.ui) {
      this.ui.showNotification('Connection lost - attempting reconnect...', 'warning', 5000);
    }

    // Attempt reconnect after a brief delay
    setTimeout(() => {
      if (this.battleId && this.game.currentScene === this) {
        this.attemptRejoin();
      }
    }, 1000);
  }

  /**
   * Handle remote state update (for rejoins or full sync)
   * NOTE: Only updates unit positions/HP, doesn't control camera during active play.
   * Camera is controlled by the turn event queue.
   */
  handleRemoteStateUpdate(payload) {
    console.log('[Battle WS] Processing state update (sync only, no camera control)');
    // Sync unit data but preserve activeUnitId if queue is processing
    const preserveActiveUnit = this.isProcessingQueue || this.inEnemySequence;
    const currentActiveId = this.battleState?.activeUnitId;

    this.battleState = payload.state;
    this.syncUnitsWithState(payload.state.units);

    // Restore activeUnitId if we should preserve it (queue handles transitions)
    if (preserveActiveUnit && currentActiveId) {
      this.battleState.activeUnitId = currentActiveId;
    }
    // Don't call updateUI() - let queue system handle camera and UI updates
  }

  /**
   * Handle remote unit movement - queue for sequential processing
   */
  handleRemoteUnitMoved(payload) {
    const { unitId, from, to } = payload;
    console.log(`[Battle WS] Unit moved: ${unitId} from (${from?.x},${from?.y}) to (${to?.x},${to?.y})`);

    // Queue the movement for sequential processing
    this.queueTurnEvent({
      type: 'unit_moved',
      unitId,
      from,
      to
    });
  }

  /**
   * Handle remote action execution - queue for sequential processing
   */
  async handleRemoteActionExecuted(payload) {
    const { actorId, actionType, result } = payload;

    // Show damage animation if applicable
    if (result.damage > 0 && result.targetId) {
      const target = this.units.get(result.targetId);
      if (target) {
        target.playHitAnimation();
        this.animations.addDamageNumber(target.screenX, target.screenY - 40, result.damage, result.isCritical);
        this.animations.addFlash(target.screenX, target.screenY - 32, '#ff4444');
        target.hp = Math.max(0, target.hp - result.damage);
      }
    }

    // Show miss animation
    if (result.missed && result.targetId) {
      const target = this.units.get(result.targetId);
      if (target) {
        this.animations.addDamageNumber(target.screenX, target.screenY - 40, 'MISS', false);
      }
    }
  }

  // NOTE: handleRemoteTurnChanged removed - DEPRECATED
  // Use handleRemoteTurnStart instead (battle:turn_start event)
  // The turn_start event is authoritative and includes position for camera panning

  /**
   * Handle remote battle end
   */
  handleRemoteBattleEnd(payload) {
    console.log('[Battle WS] Battle ended:', payload.status);
    this.handleBattleEnd(payload.status, payload.rewards);
  }

  /**
   * Handle batch of enemy actions from server
   */
  async handleRemoteEnemyActions(payload) {
    // These are typically already processed by the server response
    // This handler is for multiplayer scenarios
    console.log('[Battle WS] Enemy actions received:', payload.actions?.length || 0);
  }

  /**
   * Handle turn start event - queue for sequential processing
   */
  handleRemoteTurnStart(payload) {
    const { unitId, unitName, unitType, position, turnPredictions } = payload;
    console.log(`[Battle WS] Turn start: ${unitName} (${unitType})`);

    // Queue the turn start for sequential processing
    // This ensures animations complete before transitioning to next turn
    this.queueTurnEvent({
      type: 'turn_start',
      unitId,
      unitName,
      unitType,
      position,
      turnPredictions
    });
  }

  /**
   * Handle intent highlight event (enemy visualization)
   */
  handleRemoteIntentHighlight(payload) {
    const { unitId, highlightType, tiles, duration } = payload;
    console.log(`[Battle WS] Intent highlight: ${highlightType} (${tiles?.length || 0} tiles)`);

    // Queue the intent highlight for sequential processing
    this.queueTurnEvent({
      type: 'intent_highlight',
      unitId,
      highlightType,
      tiles,
      duration
    });
  }

  /**
   * Queue a turn event for sequential processing
   * This ensures animations play in order without interruption
   */
  queueTurnEvent(event) {
    this.turnEventQueue.push(event);
    this.processTurnEventQueue();
  }

  /**
   * Process turn events sequentially with proper animation timing
   * Only one event processes at a time - each waits for its animation to complete
   */
  async processTurnEventQueue() {
    // Don't start processing if already processing
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.turnEventQueue.length > 0) {
      const event = this.turnEventQueue.shift();
      await this.processSingleTurnEvent(event);
    }

    this.isProcessingQueue = false;
  }

  /**
   * Process a single turn event with appropriate animation timing
   */
  async processSingleTurnEvent(event) {
    switch (event.type) {
      case 'turn_start':
        await this.processTurnStartEvent(event);
        break;

      case 'intent_highlight':
        await this.processIntentHighlightEvent(event);
        break;

      case 'unit_moved':
        await this.processUnitMovedEvent(event);
        break;

      case 'action_executed':
        await this.processActionExecutedEvent(event);
        break;
    }
  }

  /**
   * Process turn_start event from queue
   */
  async processTurnStartEvent(event) {
    const { unitId, unitName, unitType, position, turnPredictions } = event;
    const isEnemy = unitType === 'enemy';
    const isPlayerTurn = unitType === 'player' || unitType === 'player_local';

    // Update turn predictions if provided
    if (turnPredictions) {
      this.battleState.turnPredictions = turnPredictions;
    }

    // Update active unit
    this.battleState.activeUnitId = unitId;

    // Update selection to active unit
    const activeUnit = this.units.get(unitId);
    if (activeUnit) {
      if (this.selectedUnit) {
        this.selectedUnit.isSelected = false;
      }
      this.selectedUnit = activeUnit;
      activeUnit.isSelected = true;
    }

    // Update turn order UI
    if (this.ui) {
      this.ui.updateTurnOrder(this.battleState);
      this.ui.showTurnIndicator(unitName, unitType);
    }

    // Camera handling - pan to EVERY active unit (queue handles timing)
    if (position && this.camera && this.grid) {
      const worldPos = this.grid.gridToScreenWorld(position.x, position.y);

      // Clear intent highlights at start of each turn
      if (this.grid) this.grid.clearIntentHighlights();

      // CRITICAL: Set follow target to current active unit BEFORE panning
      // This prevents camera from drifting back to player after transition ends
      if (activeUnit) {
        this.camera.setFollowTarget(activeUnit);
      }

      // Pan to active unit and wait for animation to complete
      console.log(`[Queue] Panning to ${unitName} at (${position.x}, ${position.y})`);
      await new Promise(resolve => {
        this.camera.startTurnTransition(worldPos.x, worldPos.y, resolve, 300);
      });

      if (isPlayerTurn) {
        this.inEnemySequence = false;
        this.lastTurnWasEnemy = false;

        // Enable player controls after camera pan
        this.updateUI();
      } else {
        // Enemy turn
        this.inEnemySequence = true;
        this.lastTurnWasEnemy = true;

        // Show thinking indicator for enemy
        if (activeUnit) {
          activeUnit.setThinking(true);
        }
      }
    }
  }

  /**
   * Process intent_highlight event from queue
   */
  async processIntentHighlightEvent(event) {
    const { unitId, highlightType, tiles, duration } = event;

    // Hide thinking indicator when intent is shown
    const unit = this.units.get(unitId);
    if (unit) {
      unit.setThinking(false);
    }

    // Show the highlight on the grid
    if (this.grid && tiles && tiles.length > 0) {
      this.grid.showIntentHighlight(highlightType, tiles, duration);
    }

    // Wait for the highlight duration before processing next event
    // This ensures intent visualization is visible before the action happens
    if (duration && duration > 0) {
      await this.waitForAnimation(duration);
    }
  }

  /**
   * Process unit_moved event from queue
   */
  async processUnitMovedEvent(event) {
    const { unitId, from, to } = event;
    const unit = this.units.get(unitId);

    if (unit) {
      // Start the movement animation
      unit.moveTo(to.x, to.y);

      // Wait for movement animation to complete (estimate based on distance)
      const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      const moveDuration = Math.max(300, distance * 150); // 150ms per tile, minimum 300ms
      await this.waitForAnimation(moveDuration);
    }
  }

  /**
   * Process action_executed event from queue
   */
  async processActionExecutedEvent(event) {
    const { actorId, actionType, result } = event;

    // Play attack/skill animation
    if (actionType === 'attack' || actionType === 'skill') {
      // Find target and play damage animation
      if (result?.targetId) {
        const target = this.units.get(result.targetId);
        if (target && result.damage) {
          target.showDamage(result.damage);
          target.hp = Math.max(0, target.hp - result.damage);
        }
      }

      // Wait for attack animation
      await this.waitForAnimation(600);
    }
  }

  /**
   * Handle "your turn" notification
   * NOTE: This is redundant with turn_start for player turns.
   * The queue system handles camera and UI via processTurnStartEvent.
   * This handler only enables input - doesn't touch camera or call updateUI.
   */
  handleRemoteYourTurn(payload) {
    const { unitId, availableActions } = payload;
    console.log('[Battle WS] Your turn:', unitId, '(input enabled, queue handles camera)');

    // Enable player input (but don't set activeUnitId - queue handles that)
    this.inputEnabled = true;
    this.currentAction = null;
    this.validTiles = [];

    // NOTE: Don't call updateUI() - the queue's processTurnStartEvent handles that
    // NOTE: Don't set activeUnitId - the queue's processTurnStartEvent handles that
    // This prevents camera bounce when your_turn arrives before queue processes turn_start
  }

  /**
   * Handle player disconnection notification
   */
  handleRemotePlayerDisconnected(payload) {
    const { playerId, playerName } = payload;
    console.log(`[Battle WS] Player disconnected: ${playerName}`);

    // Show notification
    if (this.ui) {
      this.ui.showNotification(`${playerName} disconnected`, 'warning', 3000);
    }

    // Mark player's units as disconnected (visual indicator)
    for (const unit of this.units.values()) {
      if (unit.ownerId === playerId) {
        unit.setDisconnected(true);
      }
    }
  }

  /**
   * Handle player reconnection notification
   */
  handleRemotePlayerReconnected(payload) {
    const { playerId, playerName } = payload;
    console.log(`[Battle WS] Player reconnected: ${playerName}`);

    // Show notification
    if (this.ui) {
      this.ui.showNotification(`${playerName} reconnected`, 'success', 3000);
    }

    // Clear disconnected state from player's units
    for (const unit of this.units.values()) {
      if (unit.ownerId === playerId) {
        unit.setDisconnected(false);
      }
    }
  }

  /**
   * Handle full state sync (for reconnection)
   */
  handleRemoteStateSync(payload) {
    const { state, reason } = payload;
    console.log(`[Battle WS] State sync: ${reason}`);

    // Update battle state
    this.battleState = state;

    // Resync all units
    this.syncUnitsWithState(state.units);

    // Update UI
    this.updateUI();

    // Show reconnect notification if applicable
    if (reason === 'reconnect' && this.ui) {
      this.ui.showNotification('Reconnected to battle', 'success', 2000);
    }
  }

  /**
   * Handle click on a tile
   */
  handleTileClick(x, y) {
    // Check if clicking on active player unit - show radial menu
    const activeUnit = this.getActiveUnit();
    if (!this.currentAction && activeUnit && activeUnit.type === 'player') {
      if (x === activeUnit.gridX && y === activeUnit.gridY) {
        this.showRadialMenu();
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

      // Confirm message based on target
      if (target) {
        this.ui.showConfirmation(`Attack ${target.name}?`);
      } else {
        this.ui.showConfirmation(`Attack empty tile?`);
      }
    } else if (this.currentAction === 'skill' && isValidTile) {
      // Tile-based skill targeting
      const target = this.getUnitAt(x, y);
      const skill = this.getUnitActiveSkills(this.getActiveUnit()).find(s => s.id === this.selectedSkillId);
      this.pendingAction = { type: 'skill', targetTile: { x, y }, target, skillId: this.selectedSkillId };

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
        this.game.showNotification?.('Must target an ally', 'warning');
        return;
      }
      const item = (this.battleState.consumables || []).find(i => i.itemId === this.selectedItemId);
      this.pendingAction = { type: 'item', targetTile: { x, y }, target, itemId: this.selectedItemId };

      this.ui.showConfirmation(`Use ${item?.name || 'item'} on ${target.name}?`);
    }
  }

  /**
   * Start move action - show valid movement tiles
   */
  startMoveAction() {
    // Two-action system: check if move is available
    if (!this.canMove) {
      this.game.showNotification?.('Already moved this turn', 'warning');
      return;
    }

    this.hideRadialMenu();
    this.currentAction = 'move';
    const activeUnit = this.getActiveUnit();

    if (activeUnit) {
      this.validTiles = this.pathfinding.getReachableTiles(
        activeUnit.gridX,
        activeUnit.gridY,
        this.movementRange
      );
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
      this.game.showNotification?.('Already acted this turn', 'warning');
      return;
    }

    this.hideRadialMenu();
    this.currentAction = 'attack';
    const activeUnit = this.getActiveUnit();

    if (activeUnit) {
      this.validTiles = this.pathfinding.getAttackableTiles(
        activeUnit.gridX,
        activeUnit.gridY,
        this.attackRange
      );
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
      this.game.showNotification?.('Already acted this turn', 'warning');
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
  getSkillIcon(skillId, unitClass) {
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
   * Show radial menu for active unit
   */
  showRadialMenu() {
    // Don't show radial menu during battle intro
    if (this.isIntroPlaying) return;

    const activeUnit = this.getActiveUnit();
    if (!activeUnit || activeUnit.type !== 'player') return;

    // Get unit's screen position
    const worldPos = this.grid.gridToScreenWorld(activeUnit.gridX, activeUnit.gridY);
    const screenPos = this.camera.worldToScreen(worldPos.x, worldPos.y);

    // Update radial menu segment availability
    this.radialMenu.setSegmentEnabled('move', this.canMove);
    this.radialMenu.setSegmentEnabled('attack', this.canAct);
    this.radialMenu.setSegmentEnabled('skill', this.canAct);
    this.radialMenu.setSegmentEnabled('item', this.canAct);

    // Show radial menu above the unit
    this.radialMenu.show(screenPos.x, screenPos.y - 40, activeUnit.mp);
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
      this.game.showNotification?.('Skill not found', 'error');
      return;
    }

    // Check if unit has enough MP
    if (activeUnit.mp < skill.mpCost) {
      this.game.showNotification?.(`Not enough MP (need ${skill.mpCost})`, 'warning');
      return;
    }

    if (activeUnit && skill) {
      this.validTiles = this.pathfinding.getAttackableTiles(
        activeUnit.gridX,
        activeUnit.gridY,
        skill.range || this.attackRange
      );
    }

    this.ui.hideSkillPanel();
    this.ui.setActionsEnabled(false);
    this.ui.showTargetingMode();
  }

  /**
   * Show item selection menu
   */
  showItemMenu() {
    // Two-action system: check if act is available
    if (!this.canAct) {
      this.game.showNotification?.('Already acted this turn', 'warning');
      return;
    }

    // Get consumables from battle state
    const consumables = this.battleState.consumables || [];
    this.ui.showItemPanel(consumables);
  }

  /**
   * Start item action - show valid target tiles for item
   * @param {Object} itemData - Object with itemId and inventoryId
   */
  startItemAction(itemData) {
    this.hideRadialMenu();
    this.currentAction = 'item';
    this.selectedItemId = itemData.itemId;
    this.selectedInventoryId = itemData.inventoryId;

    const activeUnit = this.getActiveUnit();

    // Items can target self or allies within range
    // For now, allow targeting any ally tile (range of map)
    this.validTiles = this.pathfinding.getAttackableTiles(
      activeUnit.gridX,
      activeUnit.gridY,
      10 // Items have a long range for targeting allies
    );

    // Filter to only include tiles with ally units (or empty for self-use)
    const allyPositions = this.battleState.units
      .filter(u => u.type === 'player' && u.hp > 0)
      .map(u => ({ x: u.tileX, y: u.tileY }));

    this.validTiles = this.validTiles.filter(tile =>
      allyPositions.some(pos => pos.x === tile.x && pos.y === tile.y)
    );

    this.ui.hideItemPanel();
    this.ui.setActionsEnabled(false);
    this.ui.showTargetingMode();
  }

  /**
   * Confirm pending action
   */
  async confirmAction() {
    this.ui.hideConfirmation();

    if (this.pendingAction) {
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
    this.selectedSkillId = null;
    this.selectedItemId = null;
    this.selectedInventoryId = null;
    this.selectedMoveTile = null; // Clear mobile two-tap selection
    this.ui.hideConfirmation();
    this.ui.hideSkillPanel();
    this.ui.hideItemPanel();
    this.ui.hideTargetingMode();
    this.ui.setActionsEnabled(true);
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
      this.game.showNotification(err.message, 'error');
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
        unit.moveTo(this.pendingAction.targetTile.x, this.pendingAction.targetTile.y);
        await this.waitForAnimation(500);
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

        // Play hit animation
        target.playHitAnimation();

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

        // Show status effect if applied
        if (targetInfo.effectApplied) {
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
      if (target) {
        // Attacker faces target and plays attack animation
        if (attacker) {
          attacker.playAttackAnimation(target.gridX, target.gridY);
          await this.waitForAnimation(200); // Wait for attack windup
        }

        // Target plays hit animation
        target.playHitAnimation();
        this.animations.addDamageNumber(target.screenX, target.screenY - 40, actionResult.damage, actionResult.isCritical);
        this.animations.addFlash(target.screenX, target.screenY - 32, '#ff4444');
        this.animations.addParticleBurst(target.screenX, target.screenY - 32, '#ff4444');
        target.hp = Math.max(0, target.hp - actionResult.damage);
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
          target.hp = Math.min(target.maxHp, target.hp + effect.amount);
          this.animations.addHealNumber(target.screenX, target.screenY - 40, effect.amount);
          this.animations.addParticleBurst(target.screenX, target.screenY - 32, '#44ff44');
          await this.waitForAnimation(300);
        } else if (effect.type === 'mpRestore') {
          target.mp = Math.min(target.maxMp, target.mp + effect.amount);
          this.animations.addHealNumber(target.screenX, target.screenY - 40, effect.amount);
          this.animations.addParticleBurst(target.screenX, target.screenY - 32, '#4488ff');
          await this.waitForAnimation(300);
        } else if (effect.type === 'cleanse') {
          this.animations.addHealNumber(target.screenX, target.screenY - 40, 'Cleansed');
          await this.waitForAnimation(300);
        } else if (effect.type === 'revive') {
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

    // Check battle end
    if (battleStatus !== 'active') {
      this.handleBattleEnd(battleStatus, actionResult.rewards);
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
  }

  /**
   * Sync local units with server state
   */
  syncUnitsWithState(stateUnits) {
    for (const unitData of stateUnits) {
      const unit = this.units.get(unitData.id);
      if (unit) {
        unit.hp = unitData.hp;
        unit.mp = unitData.mp;
        unit.ct = unitData.ct || 0; // Sync CT for turn order display
        unit.hasActed = unitData.hasActed;
        unit.statusEffects = unitData.statusEffects || [];

        // Update position if changed - but DON'T interrupt ongoing movement animations
        // WebSocket unit_moved calls moveTo() for smooth animation; we only snap if unit is stationary
        if (unit.gridX !== unitData.tileX || unit.gridY !== unitData.tileY) {
          if (unit.isMoving) {
            // Unit is animating - update target grid position but let animation continue
            // The animation will reach the correct destination
            unit.gridX = unitData.tileX;
            unit.gridY = unitData.tileY;
          } else {
            // Unit is stationary - safe to snap to new position (fallback for missed WebSocket)
            unit.setPosition(unitData.tileX, unitData.tileY);
          }
        }
      }
    }
  }

  /**
   * Handle battle end (victory or defeat)
   */
  handleBattleEnd(status, rewards = null) {
    this.ui.hideActionMenu();

    // Use RewardsModal for animated display
    this.rewardsModal = new RewardsModal(this.game);
    this.rewardsModal.show(status, rewards, {
      onClose: () => this.endBattle(),
      onSound: (soundId) => this.playSound(soundId)
    });
  }

  /**
   * Play sound effect (stub for future audio system)
   */
  playSound(soundId) {
    // TODO: Implement audio system
    console.log(`[Sound] ${soundId}`);
  }

  /**
   * End battle and return to world map
   */
  endBattle() {
    this.game.scenes.switchTo('worldMap');
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

      // Show radial menu for player units
      if (activeUnit.type === 'player') {
        // Two-action system: update available actions for new turn
        this.ui.updateAvailableActions(this.canMove, this.canAct);
        this.ui.setActionsEnabled(true);

        // Show radial menu automatically on player's turn (after short delay for camera)
        setTimeout(() => {
          if (this.getActiveUnit()?.id === activeUnit.id && !this.currentAction) {
            this.showRadialMenu();
          }
        }, 300);
      } else {
        this.hideRadialMenu();
        this.ui.hideActionMenu();
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
    if (!this.camera.isTurnTransitioning()) {
      const input = this.game.input;
      let dx = 0, dy = 0;

      if (input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) dy = -1;
      if (input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown')) dy = 1;
      if (input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft')) dx = -1;
      if (input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) dx = 1;

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
    if (this.currentAction === 'attack') {
      for (const tile of this.validTiles) {
        const unit = this.getUnitAt(tile.x, tile.y);
        if (unit && unit.type === 'enemy') {
          highlights[`${tile.x},${tile.y}`] = 'rgba(217, 74, 74, 0.6)';  // Bright red for enemies
        } else if (unit && unit.type === 'player') {
          highlights[`${tile.x},${tile.y}`] = 'rgba(217, 174, 74, 0.5)'; // Orange for allies
        } else {
          highlights[`${tile.x},${tile.y}`] = 'rgba(217, 74, 74, 0.3)';  // Dim red for empty tiles
        }
      }
    }

    // Skill range highlights (tile-based targeting)
    if (this.currentAction === 'skill') {
      const activeUnit = this.getActiveUnit();
      const skill = activeUnit ? this.getUnitActiveSkills(activeUnit).find(s => s.id === this.selectedSkillId) : null;

      for (const tile of this.validTiles) {
        const unit = this.getUnitAt(tile.x, tile.y);
        if (unit && unit.type === 'enemy') {
          highlights[`${tile.x},${tile.y}`] = 'rgba(148, 74, 217, 0.6)';  // Purple for enemies
        } else if (unit && unit.type === 'player') {
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

    // Render grid with highlights and camera (includes intent highlights from WebSocket)
    this.grid.renderWithIntentHighlights(ctx, highlights, this.camera);

    // Render terrain tooltip when hovering during move action
    this.renderTerrainTooltip(ctx);

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
  }

  /**
   * Render terrain tooltip when hovering over tiles during move action
   */
  renderTerrainTooltip(ctx) {
    // Only show during move action
    if (this.currentAction !== 'move') return;

    // Determine which tile to show tooltip for (hovered or selected on mobile)
    const tooltipTile = this.isTouchDevice ? this.selectedMoveTile : this.hoveredTile;
    if (!tooltipTile) return;

    // Get terrain info
    const terrain = this.grid.getTerrain(tooltipTile.x, tooltipTile.y);
    const moveCost = this.grid.getMovementCost(tooltipTile.x, tooltipTile.y);

    // Format terrain name nicely (capitalize first letter)
    const terrainName = terrain.charAt(0).toUpperCase() + terrain.slice(1);
    const tooltipText = `${terrainName} (${moveCost} mov)`;

    // Get position for tooltip
    let tooltipX, tooltipY;
    if (this.isTouchDevice && this.selectedMoveTile) {
      // On mobile, position tooltip above the selected tile
      const worldPos = this.grid.gridToWorld(tooltipTile.x, tooltipTile.y);
      const screenPos = this.camera.worldToScreen(worldPos.x, worldPos.y);
      tooltipX = screenPos.x;
      tooltipY = screenPos.y - 50;
    } else {
      // On desktop, position near cursor
      const pos = this.game.input.getPointerPosition();
      tooltipX = pos.x + 15;
      tooltipY = pos.y - 25;
    }

    // Measure text for background
    ctx.font = '12px monospace';
    const textMetrics = ctx.measureText(tooltipText);
    const padding = 6;
    const bgWidth = textMetrics.width + padding * 2;
    const bgHeight = 18;

    // Keep tooltip on screen
    tooltipX = Math.min(tooltipX, ctx.canvas.width - bgWidth - 5);
    tooltipY = Math.max(tooltipY, bgHeight + 5);

    // Draw background
    ctx.fillStyle = 'rgba(20, 20, 30, 0.85)';
    ctx.fillRect(tooltipX, tooltipY - bgHeight + 4, bgWidth, bgHeight);

    // Draw text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(tooltipText, tooltipX + padding, tooltipY);
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
