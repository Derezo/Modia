import { Scene } from './Scene.js';
import { BattleGrid } from '../battle/BattleGrid.js';
import { BattleUnit } from '../battle/BattleUnit.js';
import { BattleUI } from '../battle/BattleUI.js';
import { BattleAnimations } from '../battle/BattleAnimations.js';
import { BattlePathfinding } from '../battle/BattlePathfinding.js';

/**
 * BattleScene - Tactical turn-based combat on an 8x8 isometric grid
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

    // Interaction state
    this.selectedUnit = null;
    this.hoveredTile = null;
    this.currentAction = null; // 'move' | 'attack'
    this.validTiles = [];
    this.pendingAction = null;

    // Movement range (base value, could be modified by stats)
    this.movementRange = 3;
    this.attackRange = 1;

    // Event cleanup
    this.abortController = null;
  }

  /**
   * Enter the battle scene
   */
  async enter(data) {
    // data = { battleId, mapSeed, mapWidth, mapHeight, state }
    this.battleId = data.battleId;
    this.mapSeed = data.mapSeed;
    this.battleState = data.state;

    // Initialize grid
    this.grid = new BattleGrid(this.game.canvas, data.mapWidth || 8, data.mapHeight || 8);
    this.grid.generateTerrain(this.mapSeed, this.getNodeType());

    // Initialize animations
    this.animations = new BattleAnimations();

    // Initialize pathfinding (needs units reference)
    this.pathfinding = new BattlePathfinding(this.grid, this.units);

    // Create units from battle state
    this.initializeUnits(data.state.units);

    // Update pathfinding with units
    this.pathfinding.setUnits(this.units);

    // Initialize UI
    this.ui = new BattleUI(this.game);
    this.ui.create(this.battleState, {
      onMove: () => this.startMoveAction(),
      onAttack: () => this.startAttackAction(),
      onWait: () => this.submitAction('wait'),
      onFlee: () => this.attemptFlee(),
      onConfirm: () => this.confirmAction(),
      onCancel: () => this.cancelAction(),
      onContinue: () => this.endBattle()
    });

    // Setup input handlers
    this.setupInputHandlers();

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

    if (this.ui) {
      this.ui.destroy();
      this.ui = null;
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
    }
  }

  /**
   * Setup canvas input handlers
   */
  setupInputHandlers() {
    this.abortController = new AbortController();
    const opts = { signal: this.abortController.signal };
    const canvas = this.game.canvas;

    canvas.addEventListener('mousemove', (e) => {
      const pos = this.game.input.getPointerPosition();
      this.hoveredTile = this.grid.getTileAtScreen(pos.x, pos.y);

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

    canvas.addEventListener('click', (e) => {
      const pos = this.game.input.getPointerPosition();
      const tile = this.grid.getTileAtScreen(pos.x, pos.y);

      if (tile) {
        this.handleTileClick(tile.x, tile.y);
      }
    }, opts);
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
    } else if (this.currentAction === 'attack') {
      const target = this.getUnitAt(x, y);
      if (target && target.type === 'enemy' && target.isAlive() && isValidTile) {
        this.pendingAction = { type: 'attack', targetTile: { x, y }, target };
        this.ui.showConfirmation(`Attack ${target.name}?`);
      }
    }
  }

  /**
   * Start move action - show valid movement tiles
   */
  startMoveAction() {
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
  }

  /**
   * Start attack action - show valid attack targets
   */
  startAttackAction() {
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
    this.ui.hideConfirmation();
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
        targetTile
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
   */
  async processActionResult(result) {
    const { state, actionResult, battleStatus } = result;

    // Handle movement
    if (actionResult.moved && this.pendingAction?.targetTile) {
      const unit = this.units.get(this.getActiveUnit()?.id);
      if (unit) {
        unit.moveTo(this.pendingAction.targetTile.x, this.pendingAction.targetTile.y);
        // Wait for movement animation
        await this.waitForAnimation(500);
      }
    }

    // Handle damage
    if (actionResult.damage > 0 && actionResult.targetId) {
      const target = this.units.get(actionResult.targetId);
      if (target) {
        // Add damage animation
        this.animations.addDamageNumber(target.screenX, target.screenY - 40, actionResult.damage, actionResult.isCritical);
        this.animations.addFlash(target.screenX, target.screenY - 32, '#ff4444');
        this.animations.addParticleBurst(target.screenX, target.screenY - 32, '#ff4444');

        // Update unit HP
        target.hp = Math.max(0, target.hp - actionResult.damage);

        await this.waitForAnimation(300);
      }
    }

    // Update battle state
    this.battleState = state;
    this.syncUnitsWithState(state.units);

    // Clear action state
    this.currentAction = null;
    this.validTiles = [];
    this.pendingAction = null;

    // Check battle end
    if (battleStatus !== 'active') {
      this.handleBattleEnd(battleStatus, actionResult.rewards);
    } else {
      // Update UI for next turn
      this.updateUI();

      // If next unit is enemy, process enemy turn
      const nextUnit = this.getActiveUnit();
      if (nextUnit && nextUnit.type === 'enemy') {
        this.ui.hideActionMenu();
        // Enemy turn is processed server-side, poll for updates
        // For now, we show the enemy's turn briefly then continue
        await this.waitForAnimation(500);
        this.ui.showActionMenu();
      }
    }
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
   * Attempt to flee from battle
   */
  async attemptFlee() {
    try {
      const result = await this.game.api.fleeBattle({ battleId: this.battleId });

      if (result.success) {
        this.game.showNotification(result.message, 'success');
        this.handleBattleEnd('fled');
      } else {
        this.game.showNotification(result.message, 'error');
        // Failed flee uses the turn
        this.updateUI();
      }
    } catch (err) {
      this.game.showNotification(err.message, 'error');
    }
  }

  /**
   * Handle battle end (victory, defeat, fled)
   */
  handleBattleEnd(status, rewards = null) {
    this.ui.hideActionMenu();
    this.ui.showResult(status, rewards);
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

      // Show action menu only for player units
      if (activeUnit.type === 'player') {
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

    // Build tile highlights
    const highlights = {};

    // Movement range highlights
    if (this.currentAction === 'move') {
      for (const tile of this.validTiles) {
        highlights[`${tile.x},${tile.y}`] = 'rgba(74, 144, 217, 0.4)';
      }
    }

    // Attack range highlights
    if (this.currentAction === 'attack') {
      for (const tile of this.validTiles) {
        const unit = this.getUnitAt(tile.x, tile.y);
        if (unit && unit.type === 'enemy') {
          highlights[`${tile.x},${tile.y}`] = 'rgba(217, 74, 74, 0.6)';
        } else {
          highlights[`${tile.x},${tile.y}`] = 'rgba(217, 74, 74, 0.3)';
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

    // Render grid with highlights
    this.grid.render(ctx, highlights);

    // Sort and render units (by Y position for depth)
    const sortedUnits = Array.from(this.units.values())
      .filter(u => u.isAlive())
      .sort((a, b) => (a.gridX + a.gridY) - (b.gridX + b.gridY));

    for (const unit of sortedUnits) {
      unit.render(ctx);
    }

    // Render dead units (faded)
    for (const unit of this.units.values()) {
      if (!unit.isAlive()) {
        ctx.globalAlpha = 0.3;
        unit.render(ctx);
        ctx.globalAlpha = 1;
      }
    }

    // Render animations on top
    this.animations.render(ctx);
  }
}
