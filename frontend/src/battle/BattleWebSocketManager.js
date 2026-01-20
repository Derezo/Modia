/**
 * BattleWebSocketManager - Handles WebSocket events for battle synchronization
 *
 * Manages:
 * - WebSocket event subscriptions
 * - Remote state updates and synchronization
 * - Turn event queue processing
 * - Reconnection logic
 *
 * Uses delegate pattern - receives scene reference for state/component access
 */

import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { debugLog } from '../utils/debugLogger.js';

export class BattleWebSocketManager {
  /**
   * @param {BattleScene} scene - Reference to the battle scene
   */
  constructor(scene) {
    this.scene = scene;
    this.wsUnsubscribers = [];

    // Turn event queue state
    this.turnEventQueue = [];
    this.isProcessingQueue = false;
  }

  // ===========================================================================
  // GETTERS - Access scene properties
  // ===========================================================================

  get game() { return this.scene.game; }
  get battleId() { return this.scene.battleId; }
  get battleState() { return this.scene.battleState; }
  set battleState(value) { this.scene.battleState = value; }
  get units() { return this.scene.units; }
  get ui() { return this.scene.ui; }
  get grid() { return this.scene.grid; }
  get camera() { return this.scene.camera; }
  get animations() { return this.scene.animations; }
  get selectedUnit() { return this.scene.selectedUnit; }
  set selectedUnit(value) { this.scene.selectedUnit = value; }
  get inEnemySequence() { return this.scene.inEnemySequence; }
  set inEnemySequence(value) { this.scene.inEnemySequence = value; }
  get lastTurnWasEnemy() { return this.scene.lastTurnWasEnemy; }
  set lastTurnWasEnemy(value) { this.scene.lastTurnWasEnemy = value; }
  get battleLogTurnCounter() { return this.scene.battleLogTurnCounter; }
  set battleLogTurnCounter(value) { this.scene.battleLogTurnCounter = value; }

  // ===========================================================================
  // SETUP & CLEANUP
  // ===========================================================================

  /**
   * Setup WebSocket handlers for real-time battle events
   */
  setup() {
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

    // Handle turn start (camera pan trigger)
    const turnStartUnsub = socket.on('battle:turn_start', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleRemoteTurnStart(payload);
      }
    });
    this.wsUnsubscribers.push(turnStartUnsub);

    // Handle intent highlights (enemy visualization)
    const intentHighlightUnsub = socket.on('battle:intent_highlight', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleRemoteIntentHighlight(payload);
      }
    });
    this.wsUnsubscribers.push(intentHighlightUnsub);

    // Handle "your turn" notification
    const yourTurnUnsub = socket.on('battle:your_turn', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleRemoteYourTurn(payload);
      }
    });
    this.wsUnsubscribers.push(yourTurnUnsub);

    // Handle player disconnection
    const playerDisconnectedUnsub = socket.on('battle:player_disconnected', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleRemotePlayerDisconnected(payload);
      }
    });
    this.wsUnsubscribers.push(playerDisconnectedUnsub);

    // Handle player reconnection
    const playerReconnectedUnsub = socket.on('battle:player_reconnected', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleRemotePlayerReconnected(payload);
      }
    });
    this.wsUnsubscribers.push(playerReconnectedUnsub);

    // Handle boss phase transition
    const phaseTransitionUnsub = socket.on('battle:phase_transition', (payload) => {
      if (payload.battleId === this.battleId) {
        this.scene.handleBossPhaseTransition(payload);
      }
    });
    this.wsUnsubscribers.push(phaseTransitionUnsub);

    // Handle full state sync (for reconnection)
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
  cleanup() {
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

  // ===========================================================================
  // RECONNECTION
  // ===========================================================================

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
      parchmentToast.info('Connection', 'Reconnecting...');

      const response = await this.game.api.request(`/battle/${this.battleId}/rejoin`);

      if (response.success) {
        console.log('[Battle] Rejoin successful');

        // Update local state with server state
        this.battleState = response.state;
        this.scene.syncUnitsWithState(response.state.units);
        this.scene.updateUI();

        // Rejoin WebSocket room
        if (this.game.socket) {
          this.game.socket.joinBattleRoom(this.battleId);
        }

        // Show reconnection notification
        parchmentToast.success('Connection', 'Reconnected!');

        // Handle grace period (brief delay before turn timer resumes)
        if (response.gracePeriod > 0) {
          console.log(`[Battle] Grace period: ${response.gracePeriod}ms`);
        }

        // Show any disconnected players
        if (response.disconnectedPlayers?.length > 0) {
          for (const player of response.disconnectedPlayers) {
            parchmentToast.warning('Player Status', `${player.playerName} is disconnected`);
          }
        }

        return true;
      }
    } catch (error) {
      console.error('[Battle] Rejoin failed:', error);

      parchmentToast.error('Connection', 'Reconnection failed');

      // If battle is no longer active, return to world map
      if (error.message?.includes('no longer active')) {
        this.game.changeScene('WorldMap');
        return false;
      }
    }

    return false;
  }

  /**
   * Handle WebSocket disconnect
   */
  handleSocketDisconnect() {
    console.log('[Battle] WebSocket disconnected during battle');

    parchmentToast.warning('Connection', 'Connection lost - attempting reconnect...');

    // Attempt reconnect after a brief delay
    setTimeout(() => {
      if (this.battleId && this.game.currentScene === this.scene) {
        this.attemptRejoin();
      }
    }, 1000);
  }

  // ===========================================================================
  // EVENT HANDLERS
  // ===========================================================================

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
    this.scene.syncUnitsWithState(payload.state.units);

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
  handleRemoteActionExecuted(payload) {
    const { actorId, actionType, result } = payload;
    console.log(`[Battle WS] Action executed: ${actorId} - ${actionType}`);

    // Queue the action for sequential processing
    // This ensures thinking indicator is cleared and animations play in order
    this.queueTurnEvent({
      type: 'action_executed',
      actorId,
      actionType,
      result
    });
  }

  /**
   * Handle remote battle end - queue as turn event so it plays after animations
   */
  handleRemoteBattleEnd(payload) {
    console.log('[Battle WS] Battle ended via WebSocket:', payload.status, {
      hasRewards: !!payload.rewards,
      queueLength: this.turnEventQueue.length,
      isProcessing: this.isProcessingQueue,
      battleEnded: this.scene.battleEnded
    });
    // Queue battle end so it waits for death animations to complete
    this.queueTurnEvent({
      type: 'battle_end',
      status: payload.status,
      rewards: payload.rewards
    });
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
   * Handle "your turn" notification
   * NOTE: This is redundant with turn_start for player turns.
   * The queue system handles camera and UI via processTurnStartEvent.
   * This handler only enables input - doesn't touch camera or call updateUI.
   */
  handleRemoteYourTurn(payload) {
    const { unitId, availableActions } = payload;
    console.log('[Battle WS] Your turn:', unitId, '(input enabled, queue handles camera)');

    // Play turn start sound for player
    this.scene.playSound('turn_start');

    // Store server-provided available actions for use in action methods
    this.scene.serverAvailableActions = availableActions || null;

    // Enable player input (but don't set activeUnitId - queue handles that)
    this.scene.inputEnabled = true;
    this.scene.currentAction = null;
    this.scene.validTiles = [];

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
    parchmentToast.warning('Player Status', `${playerName} disconnected`);

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
    parchmentToast.success('Player Status', `${playerName} reconnected`);

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
    this.scene.syncUnitsWithState(state.units);

    // Update UI
    this.scene.updateUI();
  }

  // ===========================================================================
  // TURN EVENT QUEUE
  // ===========================================================================

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

    try {
      while (this.turnEventQueue.length > 0) {
        const event = this.turnEventQueue.shift();
        try {
          await this.processSingleTurnEvent(event);
        } catch (eventError) {
          console.error(`[Battle Queue] Error processing ${event.type} event:`, eventError);
          // Continue processing remaining events even if one fails
          // For battle_end specifically, try a direct fallback
          if (event.type === 'battle_end') {
            console.log('[Battle Queue] Attempting direct battle end fallback');
            try {
              this.scene.handleBattleEnd(event.status, event.rewards);
            } catch (fallbackError) {
              console.error('[Battle Queue] Battle end fallback also failed:', fallbackError);
            }
          }
        }
      }
    } finally {
      // Always reset the flag, even if an error occurred
      this.isProcessingQueue = false;
    }
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

      case 'battle_end':
        console.log('[Battle Queue] Processing battle_end event:', {
          status: event.status,
          hasRewards: !!event.rewards,
          battleEnded: this.scene.battleEnded
        });
        // Wait extra time after death animation before showing victory/defeat
        await this.scene.waitForAnimation(800);
        console.log('[Battle Queue] Calling handleBattleEnd, battleEnded:', this.scene.battleEnded);
        this.scene.handleBattleEnd(event.status, event.rewards);
        console.log('[Battle Queue] handleBattleEnd completed');
        break;
    }
  }

  /**
   * Process turn_start event from queue
   */
  async processTurnStartEvent(event) {
    const { unitId, unitName, unitType, position, turnPredictions } = event;
    const isPlayerTurn = unitType === 'player' || unitType === 'player_local';

    debugLog('battle.logTurnEvents', 'Turn start:', {
      unitId,
      unitName,
      unitType,
      turnNumber: this.battleLogTurnCounter + 1,
      position
    });

    // Note: Turn start sound is played in handleRemoteYourTurn for player turns
    // to provide immediate audio feedback when the server signals your turn

    // Increment battle log turn counter
    this.battleLogTurnCounter++;

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

        // Clear sticky target card from enemy turn
        if (this.ui) {
          this.ui.clearTargetSticky();
          this.ui.hideTargetInfo();
        }

        // Enable player controls after camera pan
        this.scene.updateUI();
      } else {
        // Enemy turn
        this.inEnemySequence = true;
        this.lastTurnWasEnemy = true;

        // Show thinking indicator for enemy
        if (activeUnit) {
          activeUnit.setThinking(true);
        }

        // Show enemy's parchment card during their turn
        if (activeUnit && this.ui) {
          this.ui.showTargetInfo(activeUnit);
          this.ui.setTargetSticky(activeUnit);
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
      await this.scene.waitForAnimation(duration);
    }
  }

  /**
   * Process unit_moved event from queue
   */
  async processUnitMovedEvent(event) {
    const { unitId, from, to } = event;
    const unit = this.units.get(unitId);

    if (unit) {
      // Add movement to battle log
      this.scene.addBattleLogEntry(unit, 'move', null, { from, to });

      // Start the movement animation
      unit.moveTo(to.x, to.y);

      // Wait for movement animation to complete (estimate based on distance)
      const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      const moveDuration = Math.max(300, distance * 150); // 150ms per tile, minimum 300ms
      await this.scene.waitForAnimation(moveDuration);
    }
  }

  /**
   * Process action_executed event from queue
   */
  async processActionExecutedEvent(event) {
    const { actorId, actionType, result } = event;

    // Clear thinking indicator when action is executed (especially important for 'wait')
    const actor = this.units.get(actorId);
    if (actor) {
      actor.setThinking(false);
    }

    // Get target unit for logging
    const target = result?.targetId ? this.units.get(result.targetId) : null;

    // Add entry to battle log
    this.scene.addBattleLogEntry(actor, actionType, target, result);

    // Play attack/skill animation
    if (actionType === 'attack' || actionType === 'skill') {
      // Play skill sound if this is a skill action
      if (actionType === 'skill' && result.skillId) {
        this.scene.playSkillSound({ id: result.skillId }, actor);
      }

      // Find target and play damage animation
      if (target) {
        if (result.damage > 0) {
          debugLog('battle.logDamageCalculations', 'Damage dealt:', {
            attacker: actor?.name,
            target: target.name,
            damage: result.damage,
            baseDamage: result.baseDamage,
            isCritical: result.isCritical,
            critBonus: result.critBonus,
            damageType: result.damageType,
            element: result.element
          });
          target.playHitAnimation();
          // Play impact sound based on result
          this.scene.playImpactSound(result);
          this.animations.addDamageNumber(target.screenX, target.screenY - 40, result.damage, result.isCritical);
          this.animations.addFlash(target.screenX, target.screenY - 32, '#ff4444');
          target.hp = Math.max(0, target.hp - result.damage);
        } else if (result.missed) {
          // Play miss sound
          this.scene.playImpactSound({ missed: true });
          this.animations.addDamageNumber(target.screenX, target.screenY - 40, 'MISS', false);
        }
      }

      // Play status effect sound if effect was applied
      if (result.effectApplied || result.statusApplied) {
        this.scene.playStatusEffectSound(result.effectApplied || result.statusApplied);
      }

      // Wait for attack animation
      await this.scene.waitForAnimation(600);
    }
  }
}
