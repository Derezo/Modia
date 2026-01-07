import { Scene } from './Scene.js';
import { BattleGrid } from '../battle/BattleGrid.js';
import { BattleUnit } from '../battle/BattleUnit.js';
import { BattleUI } from '../battle/BattleUI.js';
import { BattleAnimations } from '../battle/BattleAnimations.js';
import { BattlePathfinding } from '../battle/BattlePathfinding.js';
import { BattleCamera } from '../battle/BattleCamera.js';
import RewardsModal from '../components/RewardsModal.js';

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

    // Interaction state
    this.selectedUnit = null;
    this.hoveredTile = null;
    this.currentAction = null; // 'move' | 'attack' | 'skill'
    this.rewardsModal = null;
    this.validTiles = [];
    this.pendingAction = null;
    this.selectedSkillId = null;

    // Movement range (base value, could be modified by stats)
    this.movementRange = 3;
    this.attackRange = 1;

    // Two-action turn state
    this.canMove = true;
    this.canAct = true;
    this.turnPhase = 'ready'; // 'ready' | 'partial' | 'done'

    // Event cleanup
    this.abortController = null;

    // WebSocket event unsubscribers
    this.wsUnsubscribers = [];
  }

  /**
   * Enter the battle scene
   */
  enter(data) {
    // data = { battleId, mapSeed, mapWidth, mapHeight, state }
    this.battleId = data.battleId;
    this.mapSeed = data.mapSeed;
    this.battleState = data.state;

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
      onWait: () => this.submitAction('wait'),
      onConfirm: () => this.confirmAction(),
      onCancel: () => this.cancelAction(),
      onContinue: () => this.endBattle()
    });

    // Setup input handlers
    this.setupInputHandlers();

    // Setup WebSocket handlers for real-time events
    this.setupWebSocketHandlers();

    // Update UI with initial state
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

    // Handle turn changes
    const turnChangedUnsub = socket.on('battle:turn_changed', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleRemoteTurnChanged(payload);
      }
    });
    this.wsUnsubscribers.push(turnChangedUnsub);

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
   * Handle remote state update (for rejoins or full sync)
   */
  handleRemoteStateUpdate(payload) {
    console.log('[Battle WS] Processing state update');
    this.battleState = payload.state;
    this.syncUnitsWithState(payload.state.units);
    this.updateUI();
  }

  /**
   * Handle remote unit movement
   */
  handleRemoteUnitMoved(payload) {
    const unit = this.units.get(payload.unitId);
    if (unit) {
      unit.moveTo(payload.to.x, payload.to.y);
    }
  }

  /**
   * Handle remote action execution
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

  /**
   * Handle remote turn change
   */
  handleRemoteTurnChanged(payload) {
    this.battleState.activeUnitIndex = payload.activeUnitIndex;
    this.battleState.activeUnitId = payload.activeUnitId;
    this.battleState.turn = payload.turn;
    if (payload.turnPredictions) {
      this.battleState.turnPredictions = payload.turnPredictions;
    }
    this.updateUI();
  }

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
   * Handle click on a tile
   */
  handleTileClick(x, y) {
    // Check if click is on a valid tile for current action
    const isValidTile = this.validTiles.some(t => t.x === x && t.y === y);

    if (this.currentAction === 'move' && isValidTile) {
      this.pendingAction = { type: 'move', targetTile: { x, y } };
      this.ui.showConfirmation(`Move to (${x}, ${y})?`);
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
    // TODO: Fetch from character_skills table via API
    // For now, return mock skills based on class
    const mockSkills = {
      warrior: [
        { id: 'power_strike', name: 'Power Strike', mpCost: 5, icon: '⚔️', range: 1, description: '150% damage attack' }
      ],
      wizard: [
        { id: 'fireball', name: 'Fireball', mpCost: 8, icon: '🔥', range: 3, description: 'Fire damage attack' }
      ],
      monk: [
        { id: 'palm_strike', name: 'Palm Strike', mpCost: 4, icon: '🤚', range: 1, description: 'Quick palm attack' }
      ],
      chemist: [
        { id: 'acid_flask', name: 'Acid Flask', mpCost: 6, icon: '⚗️', range: 2, description: 'Corrosive acid damage' }
      ]
    };
    return mockSkills[unit.class?.toLowerCase()] || [];
  }

  /**
   * Start skill action - show valid target tiles for skill
   * @param {string} skillId - The skill to use
   */
  startSkillAction(skillId) {
    this.currentAction = 'skill';
    this.selectedSkillId = skillId;
    const activeUnit = this.getActiveUnit();
    const skill = this.getUnitActiveSkills(activeUnit).find(s => s.id === skillId);

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
    this.currentAction = null;
    this.validTiles = [];
    this.pendingAction = null;
    this.selectedSkillId = null;
    this.ui.hideConfirmation();
    this.ui.hideSkillPanel();
    this.ui.hideTargetingMode();
    this.ui.setActionsEnabled(true);
  }

  /**
   * Submit action to server
   */
  async submitAction(actionType, targetTile = null) {
    const activeUnit = this.getActiveUnit();
    if (!activeUnit) return;

    try {
      this.ui.setActionsEnabled(false);

      const result = await this.game.api.submitBattleAction({
        battleId: this.battleId,
        actionType,
        unitId: activeUnit.id,
        targetTile,
        skillId: this.selectedSkillId
      });

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

    // Handle player damage
    if (actionResult.damage > 0 && actionResult.targetId) {
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

    // Process enemy actions with animations
    if (enemyActions && enemyActions.length > 0) {
      this.ui.hideActionMenu();

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

            // Play death animation if target died
            if (!target.isAlive()) {
              target.playDeathAnimation();
              await this.waitForAnimation(400);
            }
          }
        }

        // Animate miss
        if (enemyAction.result.missed && enemyAction.result.targetId) {
          const target = this.units.get(enemyAction.result.targetId);
          if (target) {
            this.animations.addDamageNumber(target.screenX, target.screenY - 40, 'MISS', false);
            await this.waitForAnimation(300);
          }
        }

        // Deselect enemy
        this.selectedUnit = null;
      }
    }

    // Update battle state from server (sync all units)
    this.battleState = state;
    this.syncUnitsWithState(state.units);

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

      // Update UI for next turn
      this.updateUI();
    }
  }

  /**
   * Update UI for partial turn (two-action system)
   * Called when player has completed one action but has another available
   */
  updateUIForPartialTurn() {
    const activeUnit = this.getActiveUnit();
    if (!activeUnit || activeUnit.type !== 'player') return;

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

        // Update position if changed
        if (unit.gridX !== unitData.tileX || unit.gridY !== unitData.tileY) {
          unit.setPosition(unitData.tileX, unitData.tileY);
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

    // Update turn order
    this.ui.updateTurnOrder(this.battleState);

    // Update active unit
    const activeUnit = this.getActiveUnit();
    if (activeUnit) {
      this.ui.updateActiveUnit(activeUnit);
      activeUnit.isSelected = true;

      // Set camera to follow active unit
      this.camera.setFollowTarget(activeUnit);

      // Show action menu only for player units
      if (activeUnit.type === 'player') {
        // Two-action system: update available actions for new turn
        this.ui.updateAvailableActions(this.canMove, this.canAct);
        this.ui.showActionMenu();
        this.ui.setActionsEnabled(true);
      } else {
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

    // Handle keyboard camera movement
    const input = this.game.input;
    let dx = 0, dy = 0;

    if (input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) dy = -1;
    if (input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown')) dy = 1;
    if (input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft')) dx = -1;
    if (input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) dx = 1;

    if (dx !== 0 || dy !== 0) {
      this.camera.moveByKeys(dx, dy, deltaTime);
    }

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

    // Movement range highlights
    if (this.currentAction === 'move') {
      for (const tile of this.validTiles) {
        highlights[`${tile.x},${tile.y}`] = 'rgba(74, 144, 217, 0.4)';
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
    }

    // Hovered tile highlight
    if (this.hoveredTile) {
      const key = `${this.hoveredTile.x},${this.hoveredTile.y}`;
      if (!highlights[key]) {
        highlights[key] = 'rgba(255, 255, 255, 0.2)';
      }
    }

    // Render grid with highlights and camera
    this.grid.render(ctx, highlights, this.camera);

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

    // Render minimap
    this.renderMinimap(ctx);
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
