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
import { ANIMATION_TIMING } from './BattleAnimations.js';
import { BattleStatePoller } from './BattleStatePoller.js';
import { connectionQuality } from '../api/connectionQuality.js';

const QUEUE_TIMEOUT_MS = 5000; // 5 second timeout for queue events

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

    // Timeout and polling state
    this.timeoutCount = 0;
    this.statePoller = null;
    this.connectionQuality = connectionQuality;

    // Setup guard to prevent handler stacking
    this.isSetup = false;
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
    // Guard against duplicate setup calls (prevents handler stacking)
    if (this.isSetup) {
      console.log('[Battle WS] Setup already called, skipping duplicate setup');
      return;
    }
    this.isSetup = true;

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
        // Skip own action - already processed via HTTP response
        if (payload.submitterId && payload.submitterId === this.game.localUserId) {
          console.log('[Battle WS] Skipping own action (already processed via HTTP)');
          return;
        }
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

    // Handle turn timer started (for PvP/multiplayer battles)
    const turnTimerStartedUnsub = socket.on('battle:turn_timer_started', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleTurnTimerStarted(payload);
      }
    });
    this.wsUnsubscribers.push(turnTimerStartedUnsub);

    // Handle turn skipped (player timed out)
    const turnSkippedUnsub = socket.on('battle:turn_skipped', (payload) => {
      if (payload.battleId === this.battleId) {
        this.handleTurnSkipped(payload);
      }
    });
    this.wsUnsubscribers.push(turnSkippedUnsub);

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

    // Initialize state poller for defensive synchronization
    this.statePoller = new BattleStatePoller(
      this.battleId,
      (serverState) => this.handleStateDrift(serverState),
      this.game
    );
    this.statePoller.start();
  }

  /**
   * Clean up WebSocket handlers
   */
  cleanup() {
    // Reset setup guard so setup() can be called again if needed
    this.isSetup = false;

    // Stop state poller
    this.statePoller?.stop();
    this.statePoller = null;
    this.timeoutCount = 0;

    // Clean up reliability manager for this battle
    const websocket = this.game?.websocket;
    if (websocket?.getReliabilityManager) {
      websocket.getReliabilityManager().cleanup(this.battleId);
    }

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

        // Apply turn state from availableActions (two-action system)
        if (response.availableActions) {
          this.scene.canMove = response.availableActions.canMove ?? true;
          this.scene.canAct = response.availableActions.canAct ?? true;
          const bothAvailable = this.scene.canMove && this.scene.canAct;
          const neitherAvailable = !this.scene.canMove && !this.scene.canAct;
          this.scene.turnPhase = bothAvailable ? 'ready' : (neitherAvailable ? 'done' : 'partial');
          console.log(`[Battle] Turn state restored: canMove=${this.scene.canMove}, canAct=${this.scene.canAct}, turnPhase=${this.scene.turnPhase}`);
        } else {
          // Not player's turn - disable actions until turn_start arrives
          this.scene.canMove = false;
          this.scene.canAct = false;
          this.scene.turnPhase = 'done';
          console.log('[Battle] Not player turn on rejoin - actions disabled');
        }

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

    // Update poller baseline to prevent false drift detection
    this.updatePollerState();
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
    this.scene.audioManager.playSound('turn_start');

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

  /**
   * Handle turn timer started event (for PvP/multiplayer battles)
   */
  handleTurnTimerStarted(payload) {
    const { playerId, duration, startTime } = payload;
    const localUserId = this.game?.user?.id;

    // Convert duration from milliseconds to seconds
    const durationSeconds = Math.floor(duration / 1000);

    // Calculate remaining time accounting for network latency
    const elapsed = Date.now() - startTime;
    const remainingSeconds = Math.max(0, Math.floor((duration - elapsed) / 1000));

    console.log(`[Battle WS] Turn timer started for player ${playerId}, duration: ${durationSeconds}s, remaining: ${remainingSeconds}s`);

    // Only show timer if it's for the local player's turn
    if (playerId === localUserId) {
      this.scene.startPvPTurnTimer(remainingSeconds);
    } else {
      // It's the opponent's turn - stop showing our timer
      this.scene.stopPvPTurnTimer();
    }
  }

  /**
   * Handle turn skipped event (player timed out)
   * Shows escalating warnings based on timeouts remaining:
   * - First timeout: info level
   * - Second timeout (2 remaining): warning level with badge
   * - Final timeout (1 remaining): error level with critical sound and badge
   */
  handleTurnSkipped(payload) {
    const { playerId, timeoutsRemaining, reason } = payload;
    const localUserId = this.game?.user?.id;

    console.log(`[Battle WS] Turn skipped for player ${playerId}, reason: ${reason}, timeouts remaining: ${timeoutsRemaining}`);

    if (playerId === localUserId && timeoutsRemaining !== null) {
      // Local player's turn was skipped - show escalating warnings
      if (timeoutsRemaining === 1) {
        // FINAL WARNING - next timeout forfeits
        parchmentToast.error('FINAL WARNING',
          'Your turn was skipped! One more timeout will forfeit the match!',
          { duration: 5000 });
        this.game.audio?.playSFX?.('warning_critical');
        // Show persistent warning badge
        this.scene.pvpUI?.showTimeoutWarning(timeoutsRemaining);
      } else if (timeoutsRemaining === 2) {
        // Second timeout - yellow warning
        parchmentToast.warning('Turn Skipped',
          `Your turn was skipped! ${timeoutsRemaining} timeouts remaining before forfeit.`);
        // Show persistent warning badge
        this.scene.pvpUI?.showTimeoutWarning(timeoutsRemaining);
      } else {
        // First timeout - info level
        parchmentToast.info('Turn Skipped', 'Your turn was skipped due to timeout.');
      }
      this.scene.stopPvPTurnTimer();
    } else if (playerId === localUserId) {
      // PvE or null timeoutsRemaining
      parchmentToast.info('Turn Skipped', 'Your turn was skipped due to timeout.');
      this.scene.stopPvPTurnTimer();
    } else {
      // Opponent's turn was skipped
      parchmentToast.info('Turn Skipped', "Opponent's turn was skipped due to timeout.");
    }
  }

  // ===========================================================================
  // TURN EVENT QUEUE
  // ===========================================================================

  /**
   * Generate a deduplication key for a turn event
   * @param {Object} event - The turn event
   * @returns {string} A unique key for this logical event
   */
  getEventDeduplicationKey(event) {
    switch (event.type) {
      case 'turn_start':
        return `turn_start:${event.unitId}`;
      case 'unit_moved':
        return `unit_moved:${event.unitId}:${event.to?.x},${event.to?.y}`;
      case 'action_executed':
        return `action_executed:${event.actorId}:${event.actionType}:${event.result?.targetId || 'none'}`;
      case 'intent_highlight':
        return `intent_highlight:${event.unitId}:${event.highlightType}`;
      case 'battle_end':
        return `battle_end:${event.status}`;
      default:
        return `${event.type}:${Date.now()}`; // Unique key for unknown types
    }
  }

  /**
   * Queue a turn event for sequential processing
   * This ensures animations play in order without interruption
   */
  queueTurnEvent(event) {
    // Check for logical duplicate already in queue
    const newKey = this.getEventDeduplicationKey(event);
    const isDuplicate = this.turnEventQueue.some(
      queued => this.getEventDeduplicationKey(queued) === newKey
    );

    if (isDuplicate) {
      console.log(`[Battle Queue] Skipping duplicate event: ${event.type}`, newKey);
      return;
    }

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

    // Pause state poller during queue processing to avoid false drift detection
    this.statePoller?.pause();

    try {
      while (this.turnEventQueue.length > 0) {
        const event = this.turnEventQueue.shift();
        try {
          await this.processSingleTurnEventWithTimeout(event);
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

      // Resume state poller and update local state
      this.statePoller?.resume();
      this.updatePollerState();
    }
  }

  /**
   * Process a single turn event with a timeout wrapper
   * If the event takes longer than QUEUE_TIMEOUT_MS, it is forcefully skipped
   */
  async processSingleTurnEventWithTimeout(event) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Queue event timeout')), QUEUE_TIMEOUT_MS);
    });

    try {
      await Promise.race([
        this.processSingleTurnEvent(event),
        timeoutPromise
      ]);
    } catch (error) {
      if (error.message === 'Queue event timeout') {
        console.warn(`[Battle Queue] Queue timeout: ${event.type}`, event);
        this.handleQueueTimeout(event);
      } else {
        throw error;
      }
    }
  }

  /**
   * Handle a queue event timeout
   * Forces animations to complete, tracks timeout count, and triggers resync if needed
   * @param {Object} _event - The timed out event (unused but kept for debugging)
   */
  handleQueueTimeout(_event) {
    // Force-complete pending animations
    if (this.animations?.forceComplete) {
      this.animations.forceComplete();
    }

    // Increment timeout counter
    this.timeoutCount++;

    // Update connection quality
    connectionQuality.onRetryScheduled();

    // If multiple timeouts, trigger full resync
    if (this.timeoutCount >= 3) {
      console.warn('[Battle Queue] Multiple queue timeouts - requesting full state sync');
      this.requestFullStateSync();
      this.timeoutCount = 0;
    }
  }

  /**
   * Request a full state sync from the server via WebSocket
   */
  requestFullStateSync() {
    const socket = this.game?.socket;
    if (socket) {
      socket.send({
        type: 'battle:request_sync',
        battleId: this.battleId
      });
    }
  }

  /**
   * Handle state drift detected by the poller
   * Applies the authoritative server state
   */
  handleStateDrift(serverState) {
    console.warn('[Battle WS] State drift detected - applying server state');

    // Apply the server state to the battle
    this.applyServerState(serverState);

    // Reset timeout counter since we've synced
    this.timeoutCount = 0;

    // Update connection quality
    connectionQuality.onAckReceived();

    // Fix: Update poller baseline so it doesn't detect drift again
    this.updatePollerState();
  }

  /**
   * Apply server state to local battle state
   * Updates unit positions, HP, MP, and turn state
   */
  applyServerState(serverState) {
    // Update units from server state
    if (serverState.units && this.units) {
      for (const serverUnit of serverState.units) {
        const localUnit = this.units.get(serverUnit.id);
        if (localUnit) {
          // Validate server position data - skip invalid positions to prevent NaN
          const serverX = serverUnit.x;
          const serverY = serverUnit.y;
          if (typeof serverX !== 'number' || typeof serverY !== 'number' ||
              isNaN(serverX) || isNaN(serverY)) {
            console.warn(`[Battle WS] Invalid position for unit ${serverUnit.id}: x=${serverX}, y=${serverY}`);
            continue; // Skip this unit's position update
          }

          // Fix: Use gridX/gridY (BattleUnit properties), not x/y
          if (localUnit.gridX !== serverX || localUnit.gridY !== serverY) {
            localUnit.gridX = serverX;
            localUnit.gridY = serverY;
            // Update screen position to match grid position
            if (this.scene.grid) {
              const screenPos = this.scene.grid.gridToScreenWorld(serverX, serverY);
              if (localUnit.isMoving) {
                // Unit is mid-animation: only update target, let animation continue
                // This matches how syncUnitsWithState handles moving units
                localUnit.targetScreenX = screenPos.x;
                localUnit.targetScreenY = screenPos.y;
              } else {
                // Unit is stationary: snap to new position immediately
                localUnit.screenX = screenPos.x;
                localUnit.screenY = screenPos.y;
                localUnit.targetScreenX = screenPos.x;
                localUnit.targetScreenY = screenPos.y;
              }
            }
          }
          localUnit.hp = serverUnit.hp ?? localUnit.hp;
          localUnit.mp = serverUnit.mp ?? localUnit.mp;
          // Update status effects if provided
          if (serverUnit.statusEffects) {
            localUnit.statusEffects = serverUnit.statusEffects;
          }
        }
      }
    }

    // Update turn state
    if (serverState.activeUnitId !== undefined) {
      this.battleState.activeUnitId = serverState.activeUnitId;
    }
    if (serverState.turnCount !== undefined) {
      this.scene.battleLogTurnCounter = serverState.turnCount;
    }

    // Emit event for scene to handle full refresh if needed
    if (this.scene.onStateSync) {
      this.scene.onStateSync(serverState);
    }
  }

  /**
   * Update the poller's local state for drift comparison
   */
  updatePollerState() {
    if (!this.statePoller || !this.scene) return;

    const state = {
      activeUnitId: this.battleState?.activeUnitId,
      turnCount: this.battleLogTurnCounter || 0,
      status: this.battleState?.status || 'active',
      units: this.units ? Array.from(this.units.values()).map(u => ({
        id: u.id,
        x: u.gridX,  // BattleUnit uses gridX/gridY, not x/y
        y: u.gridY,
        hp: u.hp,
        mp: u.mp
      })) : []
    };

    this.statePoller.setLocalState(state);
  }

  /**
   * Expose connection quality manager for UI components
   * @returns {ConnectionQualityManager}
   */
  getConnectionQualityManager() {
    return this.connectionQuality;
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

    // Determine if this is the local player's unit for UI display
    // Server sends 'player_local' to ALL clients, but we need to show
    // "Your Turn!" only to the actual owner of the unit
    const localUserId = this.game.localUserId;
    const isLocalUnit = activeUnit?.isLocalPlayerUnit(localUserId);

    // Determine display unit type:
    // - 'player_local' if it's our turn (shows "Your Turn!")
    // - 'player_remote' if it's opponent's player unit (shows "Player's Turn")
    // - 'enemy' for AI enemies
    let displayUnitType = unitType;
    if (isPlayerTurn) {
      displayUnitType = isLocalUnit ? 'player_local' : 'player_remote';
    }

    // Update turn order UI
    if (this.ui) {
      this.ui.updateTurnOrder(this.battleState);

      // Build unit data object for turn indicator display
      const unitData = {
        name: activeUnit?.name || unitName,
        level: activeUnit?.level || 1,
        race: activeUnit?.race || null,
        class: activeUnit?.class || null,
        type: activeUnit?.type || 'enemy'
      };
      this.ui.showTurnIndicator(unitData, displayUnitType);
    }

    // Camera handling - ALWAYS pan to active unit for awareness
    // In PvP, players need to see what their opponent is doing

    if (position && this.camera && this.grid) {
      // Clear intent highlights at start of each turn
      if (this.grid) this.grid.clearIntentHighlights();

      const worldPos = this.grid.gridToScreenWorld(position.x, position.y);

      // CRITICAL: Set follow target to current active unit BEFORE panning
      // This prevents camera from drifting back to player after transition ends
      if (activeUnit) {
        this.camera.setFollowTarget(activeUnit);
      }

      // Pan to active unit and wait for animation to complete
      // Use consistent timing for all units
      console.log(`[Queue] Panning to ${unitName} at (${position.x}, ${position.y})`);
      await new Promise(resolve => {
        this.camera.startTurnTransition(worldPos.x, worldPos.y, resolve, ANIMATION_TIMING.CAMERA_PAN_DURATION);
      });

      // Add settling delay after camera pan for smooth transitions
      await this.scene.waitForAnimation(ANIMATION_TIMING.TURN_SETTLE_DELAY);

      if (isPlayerTurn && isLocalUnit) {
        // Local player's turn
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
        // Enemy turn OR opponent's turn in PvP
        this.inEnemySequence = true;
        this.lastTurnWasEnemy = true;

        // Show thinking indicator for enemy/opponent
        if (activeUnit) {
          activeUnit.setThinking(true);
        }

        // Show enemy/opponent's parchment card during their turn
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
      const moveDuration = Math.max(ANIMATION_TIMING.MOVEMENT_MIN_MS, distance * ANIMATION_TIMING.MOVEMENT_PER_TILE_MS);
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
        this.scene.audioManager.playSkillSound({ id: result.skillId }, actor);
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
          this.scene.audioManager.playImpactSound(result);
          this.animations.addDamageNumber(target.screenX, target.screenY - 40, result.damage, result.isCritical);
          this.animations.addFlash(target.screenX, target.screenY - 32, '#ff4444');
          target.hp = Math.max(0, target.hp - result.damage);
        } else if (result.missed) {
          // Play miss sound
          this.scene.audioManager.playImpactSound({ missed: true });
          this.animations.addDamageNumber(target.screenX, target.screenY - 40, 'MISS', false);
        }
      }

      // Play status effect sound if effect was applied
      if (result.effectApplied || result.statusApplied) {
        this.scene.audioManager.playStatusEffectSound(result.effectApplied || result.statusApplied);
      }

      // Wait longer if camera will pan to different unit (so damage numbers complete)
      const nextEvent = this.turnEventQueue[0];
      const willPanToDifferentUnit = nextEvent?.type === 'turn_start' &&
                                      nextEvent.unitId !== actorId;
      const waitDuration = willPanToDifferentUnit
        ? ANIMATION_TIMING.ACTION_WAIT_FULL
        : ANIMATION_TIMING.ACTION_WAIT_SHORT;
      await this.scene.waitForAnimation(waitDuration);

      // Add settling delay before turn transition for smooth visual feedback
      if (willPanToDifferentUnit) {
        await this.scene.waitForAnimation(ANIMATION_TIMING.TURN_SETTLE_DELAY);
      }
    }

    // Play item animation
    if (actionType === 'item') {
      const effectType = result.effectType || 'heal_hp';

      if (actor && target) {
        // Item arc from actor to target with effect particles
        this.animations.addItemUseEffect(
          actor.screenX, actor.screenY,
          target.screenX, target.screenY,
          effectType
        );
      }

      // Wait for arc animation, then show result numbers
      await this.scene.waitForAnimation(800);

      if (target && result.itemEffects) {
        let yOffset = 0;
        for (const effect of result.itemEffects) {
          const effectTarget = effect.targetId ? this.units.get(effect.targetId) : target;
          if (!effectTarget) continue;

          if (effect.type === 'heal' && effect.amount > 0) {
            this.animations.addHealNumber(effectTarget.screenX, effectTarget.screenY - 40 + yOffset, effect.amount);
            effectTarget.hp = Math.min(effectTarget.maxHp, effectTarget.hp + effect.amount);
            yOffset -= 20;
          }
          if (effect.type === 'mpRestore' && effect.amount > 0) {
            this.animations.addMpRestoreNumber(effectTarget.screenX, effectTarget.screenY - 40 + yOffset, effect.amount);
            effectTarget.mp = Math.min(effectTarget.maxMp, effectTarget.mp + effect.amount);
            yOffset -= 20;
          }
          if (effect.type === 'revive' && effect.amount > 0) {
            this.animations.addHealNumber(effectTarget.screenX, effectTarget.screenY - 40, effect.amount);
            effectTarget.hp = effect.amount;
          }
          if (effect.type === 'cleanse') {
            this.animations.addStatusEffect(effectTarget.screenX, effectTarget.screenY - 40, 'Cleansed!');
          }
        }
      }

      // Wait for result numbers to display
      await this.scene.waitForAnimation(ANIMATION_TIMING.ACTION_WAIT_FULL);
    }
  }
}
