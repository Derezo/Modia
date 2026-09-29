/**
 * @module BattleWebSocketManager
 * @description Handles WebSocket events for battle synchronization in PvE and PvP.
 *
 * Key responsibilities:
 * - WebSocket event subscriptions and cleanup
 * - Remote state updates and synchronization
 * - Turn event queue for sequential processing
 * - State drift detection and correction via BattleStatePoller
 * - Reconnection handling after disconnects
 * - Coliseum match result handling for PvP
 *
 * @see BattleScene.js - Orchestrates battle, owns this manager
 * @see BattleStatePoller.js - Defensive state synchronization
 * @see BattleAnimations.js - Animation timing constants
 */

import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { debugLog } from '../utils/debugLogger.js';
import {
  ANIMATION_TIMING,
  getMovementPresentationDuration
} from './BattleAnimations.js';
import { BattleStatePoller } from './BattleStatePoller.js';
import { connectionQuality } from '../api/connectionQuality.js';
import { applyBattleMapPatch, mergeBattleStatePatch } from './mergeBattleState.js';
import { getBattleMapCapabilities } from './BattleMapSession.js';

const QUEUE_TIMEOUT_MS = 5000; // 5 second timeout for queue events
const TURN_RECOVERY_SYNC_DELAY_MS = 750;

function battleMapResyncReason(error) {
  const code = String(error?.code ?? '').toLowerCase();
  if (code.includes('reference')) return 'map_reference_mismatch';
  if (code.includes('cache')) return 'cache_miss';
  if (code.includes('hash') || code.includes('verification')) {
    return 'map_hash_mismatch';
  }
  return 'client_apply_error';
}

/**
 * Return the duration of the actor's currently selected sprite animation.
 *
 * BattleUnit keeps the previous sprite visible when an authored action strip is
 * unavailable. In that case animationState changes, but animatedSprite does not,
 * so only trust a populated sprite cache when it agrees with the active sprite.
 *
 * @param {Object|null} actor
 * @returns {number|null} Animation duration in milliseconds, or null when the
 *   active animation does not expose usable timing metadata.
 */
export function getActorAnimationDurationMs(actor) {
  const sprite = actor?.animatedSprite;
  if (!sprite) return null;

  const state = actor?.animationState;
  if (state && actor?.spriteCache && actor.spriteCache[state] !== sprite) {
    return null;
  }

  const frameCount = Number(sprite.frameCount);
  const frameRate = Number(sprite.frameRate);
  if (!Number.isFinite(frameCount) || frameCount <= 0 ||
      !Number.isFinite(frameRate) || frameRate <= 0) {
    return null;
  }

  return Math.ceil((frameCount / frameRate) * 1000);
}

/**
 * Keep the established presentation delay as a floor while allowing authored
 * sprite timing to extend it.
 */
export function getActionWaitDuration(actorAnimationDuration, fallbackDuration) {
  const safeFallback = Number.isFinite(fallbackDuration) && fallbackDuration >= 0
    ? fallbackDuration
    : ANIMATION_TIMING.ACTION_WAIT_SHORT;
  return Number.isFinite(actorAnimationDuration) && actorAnimationDuration > 0
    ? Math.max(safeFallback, actorAnimationDuration)
    : safeFallback;
}

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
    this.battleEndPending = false;

    // Timeout and polling state
    this.timeoutCount = 0;
    this.statePoller = null;
    this.connectionQuality = connectionQuality;

    // Setup guard to prevent handler stacking
    this.isSetup = false;

    // Deferred input enable (when your_turn arrives before turn_start)
    this.pendingInputEnable = false;
    this.lastYourTurnUnitId = null;
    this.turnRecoveryTimer = null;

    // Action sequence number for validation (increments with each action)
    // This helps the server detect stale/duplicate actions after reconnection
    this.actionSequence = 0;

    // Serialize snapshot/hash verification and revision application so async
    // verification cannot reorder consecutive WebSocket updates.
    this.stateUpdateChain = Promise.resolve();

    // Revisioned map updates are accepted by BattleMapSession as soon as they
    // arrive, but their mutable state must not snap units ahead of the
    // semantic camera/intent/action presentation queue. Only the newest
    // accepted reconciliation needs to be applied when presentation is safe.
    this.deferredAuthoritativeState = null;
    this.deferredPolledState = null;
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
  get mapSession() { return this.scene.mapSession; }
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

    // Start defensive synchronization before depending on WebSocket delivery.
    // BattleScene installs this manager after async asset loading, so a terminal
    // event can already have been emitted by the time listeners are attached.
    // Seed the comparison baseline and poll immediately to recover that race.
    this.statePoller = new BattleStatePoller(
      this.battleId,
      (serverState) => this.handleStateDrift(serverState),
      this.game,
      (driftType, serverValue, serverState) => this.handleCriticalDrift(driftType, serverValue, serverState)
    );
    this.updatePollerState();
    this.statePoller.start();
    this.queueAuthoritativeBattleEnd(this.battleState?.status, this.battleState?.rewards);
    void this.statePoller.poll();

    const socket = this.game.socket;
    if (!socket) return;

    // Join battle room
    socket.joinBattleRoom(this.battleId, this.mapSession?.capabilities ?? getBattleMapCapabilities());

    // A join/rejoin can carry a negotiated full or cached snapshot.
    const roomJoinedUnsub = socket.on('battle_room_joined', (payload) => {
      if (String(payload.battleId) === String(this.battleId) && payload.snapshot) {
        this.queueRemoteStateUpdate(payload);
      }
    });
    this.wsUnsubscribers.push(roomJoinedUnsub);

    // Handle battle state updates (for multiplayer sync)
    const stateUpdateUnsub = socket.on('battle:state_update', (payload) => {
      console.log('[Battle WS] State update received:', payload.battleId);
      if (String(payload.battleId) === String(this.battleId)) {
        this.queueRemoteStateUpdate(payload);
      }
    });
    this.wsUnsubscribers.push(stateUpdateUnsub);

    // Handle unit movement from other players
    const unitMovedUnsub = socket.on('battle:unit_moved', (payload) => {
      if (payload.battleId === this.battleId) {
        // Skip own movement - already processed via HTTP response in processActionResult
        // Use explicit null check to handle edge case where userId could be 0
        if (payload.submitterId != null && payload.submitterId === this.game.localUserId) {
          console.log('[Battle WS] Skipping own movement (already processed via HTTP)');
          return;
        }
        this.handleRemoteUnitMoved(payload);
      }
    });
    this.wsUnsubscribers.push(unitMovedUnsub);

    // Handle action execution from other players
    const actionExecutedUnsub = socket.on('battle:action_executed', (payload) => {
      if (payload.battleId === this.battleId) {
        // Skip own action - already processed via HTTP response
        // Use explicit null check to handle edge case where userId could be 0
        if (payload.submitterId != null && payload.submitterId === this.game.localUserId) {
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

    // Handle coliseum match result (PvP-specific with enhanced stats)
    const matchResultUnsub = socket.on('coliseum:match_result', (payload) => {
      if (payload.battleId === this.battleId) {
        console.log('[Battle WS] Coliseum match result received:', {
          isWinner: payload.isWinner,
          hasUnitStats: !!payload.unitStats,
          hasPvpResult: !!payload.pvpResult
        });
        this.scene.handleColiseumResult(payload);
      }
    });
    this.wsUnsubscribers.push(matchResultUnsub);

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

    // Handle socket reconnect - use battle-aware rejoin sequence
    const reconnectUnsub = socket.on('connect', () => {
      if (this.battleId) {
        console.log('[Battle WS] Socket reconnected, initiating battle-aware rejoin');
        this.handleReconnected();
      }
    });
    this.wsUnsubscribers.push(reconnectUnsub);

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
    this.battleEndPending = false;
    this.stateUpdateChain = Promise.resolve();
    this.deferredAuthoritativeState = null;
    this.deferredPolledState = null;
    this.lastYourTurnUnitId = null;
    if (this.turnRecoveryTimer) {
      clearTimeout(this.turnRecoveryTimer);
      this.turnRecoveryTimer = null;
    }

    // Clean up reliability manager for this battle
    const websocket = this.game?.socket;
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
   * Reconnection tracking for debugging and metrics
   */
  reconnectionAttempts = 0;
  reconnectionSuccesses = 0;
  lastReconnectionTime = null;

  /**
   * Handle the 'connect' event with battle-specific prioritization.
   * Called when WebSocket reconnects after a disconnect.
   *
   * Battle room rejoin is prioritized over other rooms (chat, tavern) to ensure
   * the player can resume gameplay as quickly as possible.
   */
  async handleReconnected() {
    if (!this.battleId) {
      console.log('[Battle WS] Reconnected but no active battle');
      return;
    }

    console.log('[Battle WS] Reconnected - starting battle-aware rejoin sequence');
    this.reconnectionAttempts++;
    this.lastReconnectionTime = Date.now();

    // Step 1: Immediately prioritize battle room rejoin
    console.log('[Battle WS] Step 1: Rejoining battle room (priority)');
    const battleSuccess = await this.attemptRejoin();

    if (battleSuccess) {
      this.reconnectionSuccesses++;
      console.log(`[Battle WS] Battle rejoin successful (${this.reconnectionSuccesses}/${this.reconnectionAttempts} total)`);

      // Step 2: Delay non-critical room rejoins to avoid overloading
      // This ensures battle state sync completes before other traffic
      console.log('[Battle WS] Step 2: Scheduling delayed rejoin for non-critical rooms');
      setTimeout(() => {
        this.rejoinNonCriticalRooms();
      }, 500);
    } else {
      console.error('[Battle WS] Battle rejoin failed - skipping non-critical rejoins');
    }
  }

  /**
   * Rejoin non-critical rooms after battle state is synced.
   * Called with a delay after successful battle rejoin.
   */
  rejoinNonCriticalRooms() {
    const socket = this.game?.socket;
    if (!socket) return;

    console.log('[Battle WS] Rejoining non-critical rooms (chat, etc.)');

    // Rejoin global chat if user was in it
    // Note: This is informational - the socket manager handles room state
    // The actual room state restoration happens in the main websocket reconnect handler
  }

  /**
   * Get reconnection statistics for debugging/metrics.
   * @returns {{attempts: number, successes: number, successRate: number, lastAttempt: number|null}}
   */
  getReconnectionStats() {
    return {
      attempts: this.reconnectionAttempts,
      successes: this.reconnectionSuccesses,
      successRate: this.reconnectionAttempts > 0
        ? (this.reconnectionSuccesses / this.reconnectionAttempts * 100).toFixed(1)
        : 0,
      lastAttempt: this.lastReconnectionTime
    };
  }

  /**
   * Clear all pending actions and reset action-related state
   * Called after reconnection to prevent stale actions from being submitted
   */
  clearPendingActions() {
    console.log('[Battle] Clearing pending actions after reconnection');

    // Reset action sequence to avoid conflicts with server-side tracking
    this.actionSequence = 0;

    // Clear any pending action in the scene
    if (this.scene) {
      this.scene.pendingAction = null;
      this.scene.currentAction = null;
      this.scene.validTiles = [];
      this.scene.inputEnabled = false; // Will be re-enabled by turn system

      // Clear any queued inputs if the scene has such a method
      if (typeof this.scene.clearQueuedInputs === 'function') {
        this.scene.clearQueuedInputs();
      }
    }

    // Clear the turn event queue to prevent processing stale events
    // (Server will send fresh state after rejoin)
    this.turnEventQueue = [];
    this.isProcessingQueue = false;
    this.battleEndPending = false;
    this.deferredAuthoritativeState = null;
    this.deferredPolledState = null;

    // Reset pending input enable flag
    this.pendingInputEnable = false;
    this.lastYourTurnUnitId = null;
    if (this.turnRecoveryTimer) {
      clearTimeout(this.turnRecoveryTimer);
      this.turnRecoveryTimer = null;
    }

    debugLog('battle.stateSync', 'Pending actions cleared after reconnection');
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
      parchmentToast.info('Connection', 'Reconnecting...');

      // CRITICAL: Clear pending actions BEFORE requesting rejoin state
      // This prevents stale actions from being submitted while we're reconnecting
      this.clearPendingActions();

      const capabilities = this.mapSession?.capabilities ?? getBattleMapCapabilities();
      const requestOptions = {
        headers: {
          'x-battle-map-capabilities': JSON.stringify(capabilities)
        }
      };
      const response = typeof this.game.api.get === 'function'
        ? await this.game.api.get(`/battle/${this.battleId}/rejoin`, requestOptions)
        : await this.game.api.request(
          'GET',
          `/battle/${this.battleId}/rejoin`,
          null,
          requestOptions
        );

      if (response.success) {
        console.log('[Battle] Rejoin successful');

        // Serialize rejoin hydration with WebSocket revisions and reject an
        // older HTTP snapshot before it can mutate the map session or scene.
        this.stateUpdateChain = this.stateUpdateChain.then(async () => {
          const responseRevision = response.stateRevision ??
            response.state?.stateRevision ??
            response.snapshot?.stateRevision;
          if (this.scene.isStaleStateRevision?.(responseRevision)) {
            return { stale: true, hydrated: response };
          }

          const hydrated = this.mapSession
            ? await this.mapSession.hydrateResponse(response)
            : response;
          const hydratedRevision = hydrated.stateRevision ??
            hydrated.state?.stateRevision ??
            responseRevision;
          if (this.scene.isStaleStateRevision?.(hydratedRevision)) {
            return { stale: true, hydrated };
          }

          const accepted = this.scene.reconcileAuthoritativePayload({
            state: hydrated.state,
            availableActions: hydrated.availableActions || null,
            stateRevision: hydratedRevision
          });
          if (!accepted) {
            return { stale: true, hydrated };
          }

          // Apply map layers only after the state revision is accepted.
          applyBattleMapPatch(this.scene.grid, hydrated.state);
          this.battleState = this.scene.battleState;
          return { stale: false, hydrated };
        });
        const rejoinApplication = await this.stateUpdateChain;
        const hydrated = rejoinApplication.hydrated;

        // Rejoin WebSocket room
        if (this.game.socket) {
          this.game.socket.joinBattleRoom(
            this.battleId,
            this.mapSession?.capabilities ?? capabilities
          );
        }

        if (rejoinApplication.stale) {
          // clearPendingActions() locked input before the request. If a newer
          // WebSocket revision won the race, recover from that already-applied
          // authoritative state immediately and request a fresh snapshot.
          const activeUnitId = this.battleState?.activeUnitId;
          const activeUnit = this.units.get(activeUnitId);
          if (this.battleState?.status === 'active' &&
              this.scene.isLocalActiveUnit?.(activeUnit)) {
            const recovered = this.scene.recoverLocalTurn?.({
              unitId: activeUnitId,
              availableActions: this.scene.serverAvailableActions ??
                this.battleState.availableActions ??
                null,
              stateRevision: this.scene.stateRevision ??
                this.battleState.stateRevision
            });
            if (recovered) this.lastYourTurnUnitId = activeUnitId;
          }
          this.requestFullStateSync({ reason: 'stale_rejoin_snapshot' });
          void this.statePoller?.poll?.();
        }

        // Update poller state with fresh server state
        this.updatePollerState();

        // Show reconnection notification
        parchmentToast.success('Connection', 'Reconnected!');

        // Handle grace period (brief delay before turn timer resumes)
        if (!rejoinApplication.stale && hydrated.gracePeriod > 0) {
          console.log(`[Battle] Grace period: ${hydrated.gracePeriod}ms`);
        }

        // Show any disconnected players
        if (!rejoinApplication.stale &&
            hydrated.disconnectedPlayers?.length > 0) {
          for (const player of hydrated.disconnectedPlayers) {
            parchmentToast.warning('Player Status', `${player.playerName} is disconnected`);
          }
        }

        return true;
      }
    } catch (error) {
      console.error('[Battle] Rejoin failed:', error);

      parchmentToast.error('Connection', 'Reconnection failed');

      if (error?.code?.startsWith('battle_map_')) {
        this.requestFullStateSync({
          includeCachedMaps: false,
          reason: battleMapResyncReason(error)
        });
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
   * Handle WebSocket disconnect
   * Shows a toast but does NOT attempt rejoin here. The rejoin is driven by the
   * 'connect' event handler (handleReconnected) after successful re-authentication,
   * which avoids premature rejoin attempts before the socket is ready.
   */
  handleSocketDisconnect() {
    console.log('[Battle] WebSocket disconnected during battle');

    parchmentToast.warning('Connection', 'Connection lost - attempting reconnect...');
  }

  // ===========================================================================
  // EVENT HANDLERS
  // ===========================================================================

  /**
   * Handle remote state update (for rejoins or full sync)
   * NOTE: Only updates unit positions/HP, doesn't control camera during active play.
   * Camera is controlled by the turn event queue.
   */
  queueRemoteStateUpdate(payload) {
    this.stateUpdateChain = this.stateUpdateChain
      .then(() => this.handleRemoteStateUpdate(payload))
      .catch(error => {
        console.error('[Battle WS] Authoritative state update failed:', error);
        this.requestFullStateSync({
          includeCachedMaps: false,
          reason: battleMapResyncReason(error)
        });
      });
    return this.stateUpdateChain;
  }

  async handleRemoteStateUpdate(payload) {
    console.log('[Battle WS] Processing state update (sync only, no camera control)');

    const payloadRevision = payload.stateRevision ??
      payload.snapshot?.stateRevision ??
      payload.update?.stateRevision ??
      payload.delta?.stateRevision ??
      payload.state?.stateRevision ??
      null;
    // Snapshot verification mutates BattleMapSession when accepted. Reject a
    // delayed payload before that point so the map session cannot roll back
    // underneath a newer scene revision.
    if (this.scene.isStaleStateRevision?.(payloadRevision)) {
      return { status: 'duplicate', reason: 'stale_revision' };
    }
    const acceptedSessionRevision = this.mapSession?.current?.stateRevision;
    if (Number.isSafeInteger(payloadRevision) &&
        Number.isSafeInteger(acceptedSessionRevision) &&
        payloadRevision < acceptedSessionRevision) {
      return { status: 'duplicate', reason: 'stale_revision' };
    }

    let nextState;
    let mapPatch = null;
    if (payload.snapshot) {
      if (!this.mapSession) {
        throw new Error('A BattleMapSession is required for revisioned snapshots');
      }
      const accepted = await this.mapSession.acceptSnapshot(payload.snapshot);
      nextState = accepted.state;
      mapPatch = accepted.map;
    } else {
      const update = payload.update
        ?? payload.delta
        ?? (payload.state?.protocolVersion === 1 && payload.state?.mutableState
          ? payload.state
          : null)
        ?? (payload.protocolVersion === 1 && payload.mutableState ? payload : null);
      if (update) {
        if (!this.mapSession) {
          throw new Error('A BattleMapSession is required for revisioned updates');
        }
        const result = this.mapSession.acceptUpdate(update);
        if (result.status === 'duplicate') return result;
        if (result.status === 'resync_required') {
          this.requestFullStateSync({
            includeCachedMaps: result.reason !== 'map_reference_mismatch',
            reason: result.reason
          });
          return result;
        }
        nextState = result.state;
      } else if (payload.state) {
        if (this.mapSession?.current?.battleMapSchemaVersion === 2) {
          this.requestFullStateSync({ reason: 'revisioned_update_required' });
          return { status: 'resync_required', reason: 'revisioned_update_required' };
        }
        nextState = mergeBattleStatePatch(this.battleState, payload.state);
        mapPatch = payload.state;
      } else {
        this.requestFullStateSync({ reason: 'state_payload_missing' });
        return { status: 'resync_required', reason: 'state_payload_missing' };
      }
    }

    const stateRevision = payload.stateRevision ?? nextState?.stateRevision ?? null;
    if (this.scene.isStaleStateRevision?.(stateRevision)) {
      return { status: 'duplicate', reason: 'stale_revision' };
    }

    const reconciliation = {
      nextState,
      mapPatch,
      stateRevision,
      availableActions: payload.availableActions
    };
    if (this.shouldDeferAuthoritativeState()) {
      this.deferredAuthoritativeState = reconciliation;
      return { status: 'applied', state: nextState, deferred: true };
    }

    this.applyAcceptedAuthoritativeState(reconciliation);
    return { status: 'applied', state: nextState };
  }

  /**
   * Whether applying an accepted state would interrupt semantic presentation.
   * BattleMapSession may continue advancing while scene reconciliation waits.
   */
  shouldDeferAuthoritativeState() {
    return this.isProcessingQueue ||
      this.turnEventQueue.length > 0 ||
      this.scene.isActionSubmitting === true;
  }

  /**
   * Apply a state which has already passed BattleMapSession verification.
   */
  applyAcceptedAuthoritativeState({
    nextState,
    mapPatch,
    stateRevision,
    availableActions
  }) {
    if (this.scene.isStaleStateRevision?.(stateRevision)) return false;

    this.battleState = nextState;
    if (mapPatch) applyBattleMapPatch(this.scene.grid, mapPatch);
    this.queueAuthoritativeBattleEnd(nextState?.status, nextState?.rewards);

    let synchronizedAvailability = availableActions !== undefined
      ? availableActions
      : nextState?.availableActions;
    if (synchronizedAvailability === undefined) {
      const activeStateUnit = nextState?.units?.find(
        unit => String(unit.id) === String(nextState.activeUnitId)
      );
      const activeUnit = this.units.get(nextState?.activeUnitId);
      synchronizedAvailability = this.scene.isLocalActiveUnit?.(activeUnit) &&
        (typeof activeStateUnit?.moveUsed === 'boolean' ||
         typeof activeStateUnit?.actUsed === 'boolean')
        ? {
          canMove: activeStateUnit.moveUsed !== true,
          canAct: activeStateUnit.actUsed !== true,
          turnPhase: activeStateUnit.turnPhase
        }
        : null;
    }
    this.scene.reconcileAuthoritativePayload({
      state: this.battleState,
      availableActions: synchronizedAvailability,
      stateRevision
    }, { refresh: false });
    this.scene.updateUI?.();
    this.scene.refreshActionControls?.();

    // Update poller baseline to prevent false drift detection
    this.updatePollerState();
    return true;
  }

  /**
   * Flush the newest accepted state after remote event presentation or a local
   * HTTP action presentation has finished.
   *
   * BattleScene calls this after clearing isActionSubmitting. The queue also
   * calls it automatically after its final semantic event.
   */
  flushDeferredAuthoritativeState() {
    if (this.shouldDeferAuthoritativeState()) {
      return false;
    }
    if (!this.deferredAuthoritativeState && !this.deferredPolledState) {
      this.statePoller?.setCriticalMode(false);
      return false;
    }

    const reconciliation = this.deferredAuthoritativeState;
    let polledState = this.deferredPolledState;
    this.deferredAuthoritativeState = null;
    this.deferredPolledState = null;

    const acceptedRevision = reconciliation?.stateRevision;
    const polledRevision = polledState?.stateRevision;
    if (Number.isSafeInteger(acceptedRevision) &&
        Number.isSafeInteger(polledRevision) &&
        acceptedRevision >= polledRevision) {
      polledState = null;
    }

    let applied = reconciliation
      ? this.applyAcceptedAuthoritativeState(reconciliation)
      : false;
    if (polledState) {
      if (this.shouldDeferAuthoritativeState()) {
        this.deferredPolledState = polledState;
      } else {
        applied = this.applyPolledAuthoritativeState(polledState) || applied;
      }
    }
    if (!this.shouldDeferAuthoritativeState()) {
      this.statePoller?.setCriticalMode(false);
    }
    return applied;
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
    this.queueAuthoritativeBattleEnd(payload.status, payload.rewards);
  }

  /**
   * Queue one authoritative terminal outcome after any in-flight action/death
   * presentation. WebSocket delivery, HTTP responses, full syncs, and the
   * defensive poller all converge here so a missed battle:end cannot strand
   * the client in a server-completed battle.
   *
   * @param {string} status - Supported terminal outcome: victory or defeat
   * @param {Object|null} rewards - Optional victory rewards
   * @returns {boolean} Whether a new terminal event was queued
   */
  queueAuthoritativeBattleEnd(status, rewards = null) {
    if (!['victory', 'defeat'].includes(status)) return false;
    if (this.scene.battleEnded || this.battleEndPending) return false;

    this.battleEndPending = true;
    if (this.battleState) this.battleState.status = status;
    this.queueTurnEvent({ type: 'battle_end', status, rewards });
    return true;
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
    const {
      unitId,
      unitName,
      unitType,
      position,
      turnPredictions,
      availableActions,
      stateRevision
    } = payload;
    if (this.isSupersededTurnStart(payload)) {
      console.log('[Battle WS] Ignoring reordered legacy turn_start:', unitId);
      return;
    }
    console.log(`[Battle WS] Turn start: ${unitName} (${unitType})`);

    // Queue the turn start for sequential processing
    // This ensures animations complete before transitioning to next turn
    this.queueTurnEvent({
      type: 'turn_start',
      unitId,
      unitName,
      unitType,
      position,
      turnPredictions,
      availableActions,
      stateRevision
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
   * This is the complete logical recovery path when turn_start presentation is
   * missing, delayed, or reordered. Camera work remains in the turn queue.
   */
  handleRemoteYourTurn(payload) {
    const { unitId, availableActions, stateRevision, state } = payload;
    const authoritativeRevision = stateRevision ?? state?.stateRevision;
    if (this.scene.isStaleStateRevision?.(authoritativeRevision)) return;

    // Play turn start sound for player
    this.scene.audioManager.playSound('turn_start');

    if (state) {
      this.scene.reconcileAuthoritativePayload({
        state,
        availableActions,
        stateRevision: authoritativeRevision
      }, { refresh: false });
    }
    this.lastYourTurnUnitId = unitId;
    this.pendingInputEnable = false;
    if (this.turnRecoveryTimer) {
      clearTimeout(this.turnRecoveryTimer);
      this.turnRecoveryTimer = null;
    }
    const recovered = this.scene.recoverLocalTurn({
      unitId,
      availableActions,
      stateRevision: authoritativeRevision
    });
    console.log('[Battle WS] Your turn:', unitId,
      recovered ? '(controls recovered)' : '(awaiting authoritative availability)');
    if (!recovered) this.scheduleTurnRecoverySync(unitId);
  }

  isSupersededTurnStart({ unitId, stateRevision } = {}) {
    if (this.scene.isStaleStateRevision?.(stateRevision)) return true;
    return (stateRevision === null || stateRevision === undefined) &&
      this.scene.inputEnabled &&
      this.lastYourTurnUnitId != null &&
      String(unitId) !== String(this.lastYourTurnUnitId) &&
      String(this.battleState?.activeUnitId) === String(this.lastYourTurnUnitId);
  }

  scheduleTurnRecoverySync(unitId) {
    if (this.turnRecoveryTimer) clearTimeout(this.turnRecoveryTimer);
    this.turnRecoveryTimer = setTimeout(() => {
      this.turnRecoveryTimer = null;
      if (this.scene.battleEnded ||
          (this.battleState?.activeUnitId != null &&
           String(this.battleState.activeUnitId) !== String(unitId)) ||
          this.scene.inputEnabled) {
        return;
      }
      console.warn('[Battle WS] Local turn availability missing - requesting state sync');
      this.requestFullStateSync({ reason: 'turn_unlock_timeout' });
      void this.statePoller?.poll();
    }, TURN_RECOVERY_SYNC_DELAY_MS);
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
  async handleRemoteStateSync(payload) {
    const { state, reason } = payload;
    console.log(`[Battle WS] State sync: ${reason}`);

    if (payload.snapshot || payload.update || payload.delta) {
      const result = await this.queueRemoteStateUpdate(payload);
      if (result?.status === 'applied' && !result.deferred) {
        this.scene.updateUI();
      }
      return result;
    }

    // Legacy V1 full-state sync.
    if (this.mapSession?.current?.battleMapSchemaVersion === 2) {
      this.requestFullStateSync({ reason: 'revisioned_snapshot_required' });
      return { status: 'resync_required', reason: 'revisioned_snapshot_required' };
    }
    const stateRevision = payload.stateRevision ?? state?.stateRevision ?? null;
    if (this.scene.isStaleStateRevision?.(stateRevision)) {
      return { status: 'duplicate', reason: 'stale_revision' };
    }
    this.battleState = state;
    applyBattleMapPatch(this.scene.grid, state);
    this.queueAuthoritativeBattleEnd(state.status, state.rewards);
    this.scene.reconcileAuthoritativePayload({
      state,
      availableActions: payload.availableActions !== undefined
        ? payload.availableActions
        : state.availableActions,
      stateRevision
    });
    return { status: 'applied', state };
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
        this.game.audio?.playUI?.('warning');
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
        return event.stateRevision === undefined ||
          event.stateRevision === null
          ? `turn_start:${event.unitId}`
          : `turn_start:${event.unitId}:revision:${event.stateRevision}`;
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
   *
   * Uses critical-only polling mode during processing to detect important
   * state changes (turn changes, battle end) without triggering disruptive
   * full state syncs during animations.
   */
  async processTurnEventQueue() {
    // Don't start processing if already processing
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    // Switch to critical-only mode instead of pausing entirely
    // This allows detecting important state changes during animations
    // without triggering full resync that could disrupt visual feedback
    this.statePoller?.setCriticalMode(true);

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

      // Apply only after the semantic camera/intent/move/action sequence has
      // completed. A local HTTP presentation may still keep this deferred.
      this.flushDeferredAuthoritativeState();

      // A flushed terminal state can immediately start a new battle-end queue,
      // and local HTTP presentation can outlive this remote queue. Keep the
      // poller in critical mode until every presentation gate is idle.
      if (!this.shouldDeferAuthoritativeState()) {
        this.statePoller?.setCriticalMode(false);
        // The queue has drained: if an earlier event timed out or was
        // superseded, the local turn may still be locked. Unlock it.
        if (this.turnEventQueue.length === 0) {
          this.recoverStrandedLocalTurn('queue_drained');
        }
      }
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

    // Not reported to connectionQuality: a stalled animation is not a network
    // retry, and nothing ever resolved these, so the global indicator showed
    // "Slow Connection | 2 retries" at 2 ms latency for the rest of the session.

    // If multiple timeouts, trigger full resync
    if (this.timeoutCount >= 3) {
      console.warn('[Battle Queue] Multiple queue timeouts - requesting full state sync');
      this.requestFullStateSync({ reason: 'queue_timeout' });
      this.timeoutCount = 0;
    }

    // A timed-out presentation event must never leave the local turn locked.
    // The resync above may come back as a duplicate of the revision we
    // already hold, which reconciles nothing, so recover from the state the
    // client already has as well.
    this.recoverStrandedLocalTurn('queue_timeout');
  }

  /**
   * If the authoritative state says a local unit is active but input is
   * locked with nothing left to present, give the player their controls
   * back. Falls back to a state sync and poll when the client does not hold
   * the unit's availability.
   * @param {string} reason - For logs and the sync request
   * @returns {boolean} Whether controls were recovered
   */
  recoverStrandedLocalTurn(reason = 'stranded_turn') {
    const scene = this.scene;
    if (!scene || scene.battleEnded || scene.inputEnabled ||
        scene.isActionSubmitting === true || scene.isIntroPlaying) {
      return false;
    }
    const state = this.battleState || scene.battleState;
    if ((state?.status ?? 'active') !== 'active') return false;
    const activeUnitId = state?.activeUnitId;
    const activeUnit = activeUnitId != null ? this.units.get(activeUnitId) : null;
    if (!activeUnit || !scene.isLocalActiveUnit?.(activeUnit)) return false;

    const stateUnit = state?.units?.find(u => String(u.id) === String(activeUnitId));
    const derived = stateUnit &&
      (typeof stateUnit.moveUsed === 'boolean' || typeof stateUnit.actUsed === 'boolean')
      ? {
        canMove: stateUnit.moveUsed !== true,
        canAct: stateUnit.actUsed !== true,
        turnPhase: stateUnit.turnPhase
      }
      : null;
    const availability = scene.serverAvailableActions ??
      state?.availableActions ??
      derived;

    const recovered = availability
      ? scene.recoverLocalTurn?.({
        unitId: activeUnitId,
        availableActions: availability,
        stateRevision: scene.stateRevision ?? state?.stateRevision
      })
      : false;
    if (recovered) {
      this.lastYourTurnUnitId = activeUnitId;
      console.log(`[Battle Queue] Recovered local turn after ${reason}:`, activeUnitId);
      return true;
    }
    // Nothing reliable locally: ask the server and let the poller reconcile
    this.requestFullStateSync({ reason: `${reason}_recovery` });
    void this.statePoller?.poll?.();
    return false;
  }

  /**
   * Request a full state sync from the server via WebSocket
   */
  requestFullStateSync({
    includeCachedMaps = true,
    reason = 'client_requested'
  } = {}) {
    const socket = this.game?.socket;
    if (socket) {
      const capabilities = this.mapSession?.getCapabilities({ includeCachedMaps })
        ?? getBattleMapCapabilities({ includeCachedMaps });
      if (typeof socket.requestBattleSync === 'function') {
        socket.requestBattleSync(this.battleId, capabilities, reason);
      } else {
        socket.send('battle:request_sync', {
          battleId: this.battleId,
          battleMapCapabilities: capabilities,
          reason
        });
      }
    }
  }

  /**
   * Handle state drift detected by the poller
   * Applies the authoritative server state
   */
  handleStateDrift(serverState) {
    if (this.isPolledStateStale(serverState)) return false;

    if (this.shouldDeferAuthoritativeState()) {
      const pendingRevision = this.deferredPolledState?.stateRevision;
      const serverRevision = serverState?.stateRevision;
      if (!Number.isSafeInteger(pendingRevision) ||
          !Number.isSafeInteger(serverRevision) ||
          serverRevision >= pendingRevision) {
        this.deferredPolledState = serverState;
      }
      console.log('[Battle WS] State drift detected - deferring server state');
      return false;
    }

    return this.applyPolledAuthoritativeState(serverState);
  }

  /**
   * A lightweight poll response must never supersede a newer state already
   * accepted by BattleMapSession but not yet presented by the scene.
   */
  isPolledStateStale(serverState) {
    if (this.scene.isStaleStateRevision?.(serverState?.stateRevision)) {
      return true;
    }
    const serverRevision = serverState?.stateRevision;
    const acceptedRevision = this.mapSession?.current?.stateRevision;
    return Number.isSafeInteger(serverRevision) &&
      Number.isSafeInteger(acceptedRevision) &&
      serverRevision < acceptedRevision;
  }

  /**
   * Apply a lightweight poll response through its established reconciliation
   * path once presentation is safe.
   */
  applyPolledAuthoritativeState(serverState) {
    if (this.isPolledStateStale(serverState)) return false;
    console.warn('[Battle WS] State drift detected - applying server state');

    if (!this.applyServerState(serverState)) return false;
    this.queueAuthoritativeBattleEnd(serverState.status, serverState.rewards);

    // Reset timeout counter since we've synced
    this.timeoutCount = 0;

    // Update connection quality
    connectionQuality.onAckReceived();

    // Fix: Update poller baseline so it doesn't detect drift again
    this.updatePollerState();
    return true;
  }

  /**
   * Handle critical drift detected during animation queue processing
   * Notifies the scene of important state changes without interrupting animations
   * @param {string} driftType - Type of drift: 'turn_changed', 'turn_count_changed', 'status_changed'
   * @param {*} serverValue - The server's value for the changed field
   * @param {Object} serverState - Full server state for reference
   */
  handleCriticalDrift(driftType, serverValue, serverState) {
    if (this.isCriticalPollCoveredByAcceptedState(serverState)) {
      debugLog(
        'battle.stateSync',
        'Ignoring critical poll already covered by accepted WebSocket state'
      );
      return;
    }
    console.warn(`[Battle WS] Critical drift during animation: ${driftType}`, serverValue);
    if (this.scene.isStaleStateRevision?.(serverState?.stateRevision)) return;

    // A terminal snapshot takes priority even when the first reported mismatch
    // is a turn or turn-count change from the same server update.
    const terminalQueued = this.queueAuthoritativeBattleEnd(
      serverState?.status,
      serverState?.rewards
    );

    // Notify scene of critical drift - it can decide whether to interrupt animations
    if (this.scene.onCriticalDrift) {
      this.scene.onCriticalDrift(driftType, serverValue, serverState);
    }

    // For battle end, we may want to fast-forward animations
    if (terminalQueued) {
      console.log('[Battle WS] Battle ended on server - queueing authoritative outcome');
    }

    // For turn changes, log but don't interrupt - the queue should handle turn transitions
    if (driftType === 'turn_changed') {
      debugLog('battle.stateSync', 'Turn changed on server while processing animations - queue should sync');
    }
  }

  /**
   * Critical polling can observe the same committed revision before its full
   * WebSocket state is safe to present. That poll must not force-complete the
   * action/death sequence. Equal-revision polling remains useful when no full
   * accepted reconciliation is waiting and the scene itself has visual drift.
   */
  isCriticalPollCoveredByAcceptedState(serverState) {
    const serverRevision = serverState?.stateRevision;
    if (!Number.isSafeInteger(serverRevision)) return false;

    const deferredRevision = this.deferredAuthoritativeState?.stateRevision;
    if (Number.isSafeInteger(deferredRevision) &&
        deferredRevision >= serverRevision) {
      return true;
    }

    const acceptedRevision = this.mapSession?.current?.stateRevision;
    const sceneRevision = this.scene.stateRevision ??
      this.battleState?.stateRevision;
    return Number.isSafeInteger(acceptedRevision) &&
      acceptedRevision >= serverRevision &&
      (!Number.isSafeInteger(sceneRevision) ||
       sceneRevision < acceptedRevision);
  }

  /**
   * Apply server state to local battle state
   * Updates unit positions, HP, MP, and turn state
   */
  applyServerState(serverState) {
    if (this.scene.isStaleStateRevision?.(serverState.stateRevision)) {
      return false;
    }
    this.scene.noteStateRevision?.(serverState.stateRevision);

    // Update units from server state
    if (serverState.units && this.units) {
      for (const serverUnit of serverState.units) {
        const localUnit = this.units.get(serverUnit.id);
        if (localUnit) {
          // Validate server position data - skip invalid positions to prevent NaN
          const serverX = serverUnit.x ?? serverUnit.tileX;
          const serverY = serverUnit.y ?? serverUnit.tileY;
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
          // Poller snapshots bypass BattleScene.syncUnitsWithState(), so enforce
          // the same authoritative life/death presentation invariant here.
          localUnit.reconcileAnimationWithHealth?.();
          // Update status effects if provided
          if (serverUnit.statusEffects) {
            localUnit.statusEffects = serverUnit.statusEffects;
          }
          if (serverUnit.moveUsed !== undefined) {
            localUnit.moveUsed = serverUnit.moveUsed;
          }
          if (serverUnit.actUsed !== undefined) {
            localUnit.actUsed = serverUnit.actUsed;
          }
          if (serverUnit.turnPhase !== undefined) {
            localUnit.turnPhase = serverUnit.turnPhase;
          }
        }
      }
    }

    // Update turn state
    if (serverState.activeUnitId !== undefined) {
      this.battleState.activeUnitId = serverState.activeUnitId;
    }
    if (serverState.turnCount !== undefined) {
      if (this.battleState) {
        this.battleState.turn = serverState.turnCount;
        if (Object.prototype.hasOwnProperty.call(this.battleState, 'turnCount')) {
          this.battleState.turnCount = serverState.turnCount;
        }
      }
      this.scene.battleLogTurnCounter = serverState.turnCount;
    }
    if (serverState.status !== undefined && this.battleState) {
      this.battleState.status = serverState.status;
    }
    if (serverState.availableActions !== undefined) {
      this.scene.applyAuthoritativeAvailability?.(serverState.availableActions);
    } else if (serverState.turnPhase !== undefined) {
      this.scene.turnPhase = serverState.turnPhase;
    }
    this.scene.inputEnabled = this.battleState?.status === 'active' &&
      !this.scene.battleEnded &&
      this.scene.isLocalActiveUnit?.() &&
      !!this.scene.serverAvailableActions;
    this.scene.updateUI?.();
    this.scene.refreshActionControls?.();

    // Emit event for scene to handle full refresh if needed
    if (this.scene.onStateSync) {
      this.scene.onStateSync(serverState);
    }
    return true;
  }

  /**
   * Update the poller's local state for drift comparison
   */
  updatePollerState() {
    if (!this.statePoller || !this.scene) return;

    const state = {
      stateRevision: this.scene.stateRevision ?? this.battleState?.stateRevision,
      activeUnitId: this.battleState?.activeUnitId,
      turnCount: this.battleState?.turn ??
        this.battleState?.turnCount ??
        0,
      status: this.battleState?.status || 'active',
      turnPhase: this.scene.turnPhase,
      availableActions: this.scene.serverAvailableActions,
      units: this.units ? Array.from(this.units.values()).map(u => ({
        id: u.id,
        x: u.gridX,  // BattleUnit uses gridX/gridY, not x/y
        y: u.gridY,
        hp: u.hp,
        mp: u.mp,
        moveUsed: u.moveUsed,
        actUsed: u.actUsed,
        turnPhase: u.turnPhase
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
   * Get the next action sequence number and increment the counter
   * Used when submitting battle actions to help server detect stale/duplicate actions
   * @returns {number} The action sequence number to use for this action
   */
  getNextActionSequence() {
    this.actionSequence++;
    return this.actionSequence;
  }

  /**
   * Get the current action sequence number (without incrementing)
   * @returns {number} The current action sequence number
   */
  getCurrentActionSequence() {
    return this.actionSequence;
  }

  /**
   * Reset the action sequence number (called on battle start or reconnection)
   */
  resetActionSequence() {
    this.actionSequence = 0;
    debugLog('battle.stateSync', 'Action sequence reset to 0');
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
    const {
      unitId,
      unitName,
      unitType,
      position,
      turnPredictions,
      availableActions,
      stateRevision
    } = event;
    if (this.isSupersededTurnStart(event)) return;
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
    const isLocalUnit = this.scene.isLocalActiveUnit
      ? this.scene.isLocalActiveUnit(activeUnit)
      : activeUnit?.isLocalPlayerUnit(localUserId);

    // Recover the logical turn before any camera or presentation work. A
    // stalled/missing camera callback must never strand actionable state.
    if (isPlayerTurn && isLocalUnit) {
      const knownAvailability = availableActions ??
        (this.lastYourTurnUnitId === unitId
          ? this.scene.serverAvailableActions
          : null);
      const recovered = this.scene.recoverLocalTurn({
        unitId,
        availableActions: knownAvailability,
        stateRevision
      });
      if (!recovered) this.scheduleTurnRecoverySync(unitId);
    } else {
      this.scene.inputEnabled = false;
      this.scene.applyAuthoritativeAvailability?.(null);
      this.scene.clearActionTargetingState?.();
      this.scene.refreshActionControls?.();
      this.inEnemySequence = true;
      this.lastTurnWasEnemy = true;
    }

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
      if (this.isSupersededTurnStart(event)) {
        const currentActiveUnit = this.units.get(this.battleState?.activeUnitId);
        if (currentActiveUnit) this.camera.setFollowTarget(currentActiveUnit);
        return;
      }

      if (isPlayerTurn && isLocalUnit) {
        // Local player's turn
        this.inEnemySequence = false;
        this.lastTurnWasEnemy = false;

        // Clear sticky target card from enemy turn
        if (this.ui) {
          this.ui.clearTargetSticky();
          this.ui.hideTargetInfo();
        }

        // Controls were already recovered before presentation began.
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
      const moveDuration = getMovementPresentationDuration(unit, from, to);
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

    // Handle move action (animation handled by unit_moved event)
    // This is a fallback - movement is primarily broadcast via unit_moved for consistency
    if (actionType === 'move') {
      this.scene.addBattleLogEntry(actor, actionType, null, result);
      return; // Animation already handled by unit_moved event
    }

    // Get target unit for logging
    const target = result?.targetId ? this.units.get(result.targetId) : null;

    // Add entry to battle log
    this.scene.addBattleLogEntry(actor, actionType, target, result);

    if (actionType === 'zodiac_ability') {
      this.scene.presentZodiacAbility?.(actor, result, target);
      parchmentToast.info(
        result?.abilityName || 'Zodiac Ability',
        result?.message || `${actor?.name || 'A unit'} used a Zodiac signature ability`
      );
      await this.scene.waitForAnimation(ANIMATION_TIMING.ACTION_WAIT_SHORT);
      return;
    }

    // Play attack/skill animation
    if (actionType === 'attack' || actionType === 'skill') {
      const skillId = result.skillId || result.skillUsed || null;

      // Play skill sound if this is a skill action
      if (actionType === 'skill' && skillId) {
        this.scene.audioManager.playSkillSound({ id: skillId }, actor);
      }

      const aoeCenter = result.aoeTiles?.find(tile => tile.isCenter) || null;
      const resultTargetTile = aoeCenter || result.targetTile || null;
      const presentation = this.scene.playActionPresentation({
        actor,
        actionType,
        result,
        target: result.isAoE ? null : target,
        targetTile: resultTargetTile
          ? { x: resultTargetTile.x, y: resultTargetTile.y }
          : null,
        skillId
      });
      // Capture the selected action sprite before target reactions can replace
      // it (for example, when a self-targeting action also damages the actor).
      const actorAnimationDuration = presentation
        ? getActorAnimationDurationMs(actor)
        : null;
      if (presentation) {
        await this.scene.waitForAnimation(ANIMATION_TIMING.ACTION_IMPACT_DELAY);
      }

      const deathAnimations = [];

      // AoE results carry per-target damage/healing. Never apply the aggregate
      // `result.damage` to the primary target: it is only a compatibility total.
      if (result.isAoE && Array.isArray(result.aoeTargets)) {
        for (const targetInfo of result.aoeTargets) {
          const aoeTarget = this.units.get(targetInfo.targetId);
          if (!aoeTarget) continue;

          if (targetInfo.isAbsorb || targetInfo.healing > 0) {
            const healing = Number(targetInfo.healing) || 0;
            aoeTarget.hp = Math.min(aoeTarget.maxHp, aoeTarget.hp + healing);
            if (healing > 0) {
              this.animations.addHealNumber(aoeTarget.screenX, aoeTarget.screenY - 40, healing);
            }
            this.animations.addParticleBurst(
              aoeTarget.screenX,
              aoeTarget.screenY - 32,
              presentation?.descriptor.primaryColor || '#44ff88'
            );
            continue;
          }

          const damage = Number(targetInfo.damage) || 0;
          if (damage <= 0) continue;

          aoeTarget.playHitAnimation();
          this.scene.audioManager.playImpactSound({ ...result, ...targetInfo, damage });
          this.animations.addDamageNumber(
            aoeTarget.screenX,
            aoeTarget.screenY - 40,
            damage,
            targetInfo.isCritical,
            targetInfo.element || result.element,
            targetInfo.elementalModifier
          );
          const isAllyHit = actor?.teamId === aoeTarget.teamId;
          this.animations.addParticleBurst(
            aoeTarget.screenX,
            aoeTarget.screenY - 32,
            isAllyHit
              ? '#ff8844'
              : (presentation?.descriptor.primaryColor || '#ff4444')
          );
          aoeTarget.hp = Math.max(0, aoeTarget.hp - damage);

          if (targetInfo.effectApplied) {
            this.scene.audioManager.playStatusEffectSound(targetInfo.effectApplied);
            this.animations.addStatusEffect(
              aoeTarget.screenX,
              aoeTarget.screenY - 60,
              String(targetInfo.effectApplied).toUpperCase()
            );
          }
          if (!aoeTarget.isAlive()) deathAnimations.push(aoeTarget);
        }
      } else if (target) {
        // Single-target damage/healing presentation.
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
          this.animations.addDamageNumber(
            target.screenX,
            target.screenY - 40,
            result.damage,
            result.isCritical,
            result.element,
            result.elementalModifier
          );
          if (actionType !== 'skill') {
            this.animations.addFlash(target.screenX, target.screenY - 32, '#ff4444');
            this.animations.addParticleBurst(target.screenX, target.screenY - 32, '#ff4444');
          }
          target.hp = Math.max(0, target.hp - result.damage);
          if (!target.isAlive()) deathAnimations.push(target);
        } else if (result.missed) {
          // Play miss sound
          this.scene.audioManager.playImpactSound({ missed: true });
          this.animations.addMiss(target.screenX, target.screenY - 40);
        }
      }

      // Mirror the local HTTP path for non-AoE healing/restoration and status
      // feedback. AoE statuses are already presented beside each target above.
      if (actionType === 'skill' && !result.isAoE) {
        const resourceTarget = result.targetId != null
          ? this.units.get(result.targetId)
          : presentation?.descriptor.selfTarget
            ? actor
            : null;

        const healing = Number(result.healing) || 0;
        if (resourceTarget && healing > 0) {
          resourceTarget.hp = Math.min(resourceTarget.maxHp, resourceTarget.hp + healing);
          this.animations.addHealNumber(resourceTarget.screenX, resourceTarget.screenY - 40, healing);
        }

        const mpRestored = Number(result.mpRestored) || 0;
        if (resourceTarget && mpRestored > 0) {
          resourceTarget.mp = Math.min(resourceTarget.maxMp, resourceTarget.mp + mpRestored);
          this.animations.addMpRestoreNumber(resourceTarget.screenX, resourceTarget.screenY - 58, mpRestored);
        }

        const statusResults = [...(result.skillEffects || [])];
        const topLevelStatus = result.effectApplied || result.statusApplied;
        if (topLevelStatus) {
          statusResults.push({ effect: topLevelStatus, targetId: result.targetId });
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
          this.scene.audioManager.playStatusEffectSound(effect.effect || effect.status || effect.type);
        }
      }

      if (deathAnimations.length > 0) {
        // Let hit reactions and numbers register before replacing them with the
        // terminal pose, matching the local HTTP presentation order.
        await this.scene.waitForAnimation(ANIMATION_TIMING.DEATH_REACTION_DELAY);
        for (const defeated of deathAnimations) defeated.playDeathAnimation();
      }

      // Play status effect sound if effect was applied
      if (actionType !== 'skill' && (result.effectApplied || result.statusApplied)) {
        this.scene.audioManager.playStatusEffectSound(result.effectApplied || result.statusApplied);
      }

      // Wait longer if camera will pan to different unit (so damage numbers complete)
      const nextEvent = this.turnEventQueue[0];
      const willPanToDifferentUnit = nextEvent?.type === 'turn_start' &&
                                      nextEvent.unitId !== actorId;
      const fallbackWaitDuration = willPanToDifferentUnit
        ? ANIMATION_TIMING.ACTION_WAIT_FULL
        : ANIMATION_TIMING.ACTION_WAIT_SHORT;
      const waitDuration = getActionWaitDuration(
        actorAnimationDuration,
        fallbackWaitDuration
      );
      await this.scene.waitForAnimation(waitDuration);
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
      await this.scene.waitForAnimation(ANIMATION_TIMING.ITEM_TRAVEL_DURATION);

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
