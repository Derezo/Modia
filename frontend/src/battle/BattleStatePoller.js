import { debugLog } from '../utils/debugLogger.js';

/**
 * @module BattleStatePoller
 * @description Defensive polling for battle state synchronization.
 *
 * Periodically fetches server state and detects drift between local
 * and server state. When drift is detected, triggers a callback to
 * apply the authoritative server state.
 *
 * Supports two modes:
 * - Full sync mode: Compares all state fields and triggers full resync on drift
 * - Critical-only mode: Only checks critical fields (activeUnitId, turnCount, status)
 *   and notifies via callback without applying full sync (useful during animations)
 *
 * Uses ETag-based caching to minimize bandwidth when state is unchanged.
 *
 * @see BattleWebSocketManager.js - Primary real-time sync mechanism
 * @see BattleScene.js - Orchestrates battle and handles drift recovery
 */
export class BattleStatePoller {
  /**
   * Create a new BattleStatePoller
   * @param {number} battleId - The battle ID to poll
   * @param {function} onDriftDetected - Callback when state drift is detected (full sync mode)
   * @param {Object} game - Game instance for API access
   * @param {function} [onCriticalDrift] - Callback when critical drift is detected (critical-only mode)
   */
  constructor(battleId, onDriftDetected, game, onCriticalDrift = null) {
    this.battleId = battleId;
    this.onDriftDetected = onDriftDetected;
    this.onCriticalDrift = onCriticalDrift;
    this.game = game;
    this.pollIntervalMs = 10000; // Poll every 10 seconds
    this.criticalPollIntervalMs = 3000; // Poll every 3 seconds in critical mode
    this.interval = null;
    this.lastETag = null;
    this.lastPollTime = null;
    this.paused = false;
    this.criticalOnly = false; // When true, only check critical fields
    this.localState = null; // For comparison
    this.pendingFullSync = false; // Track if full sync needed after critical mode ends
  }

  /**
   * Start the polling interval
   * Does not poll immediately - waits for first interval
   */
  start() {
    if (this.interval) {
      debugLog('battle.stateSync', 'BattleStatePoller already running');
      return;
    }

    debugLog('battle.stateSync', `Starting BattleStatePoller for battle ${this.battleId}`);
    this.interval = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  /**
   * Stop the polling interval
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      debugLog('battle.stateSync', `Stopped BattleStatePoller for battle ${this.battleId}`);
    }
  }

  /**
   * Pause polling (e.g., while animation queue is processing)
   */
  pause() {
    this.paused = true;
    debugLog('battle.stateSync', 'BattleStatePoller paused');
  }

  /**
   * Resume polling after pause
   */
  resume() {
    this.paused = false;
    debugLog('battle.stateSync', 'BattleStatePoller resumed');

    // If we had drift during critical mode, do a full sync now
    if (this.pendingFullSync) {
      this.pendingFullSync = false;
      debugLog('battle.stateSync', 'Triggering deferred full sync after resume');
      this.poll(); // Immediate poll to sync state
    }
  }

  /**
   * Enable or disable critical-only mode
   * In critical mode, only checks activeUnitId, turnCount, and status
   * and notifies via onCriticalDrift instead of triggering full sync.
   * This allows detecting important state changes during animations
   * without disrupting ongoing visual feedback.
   * @param {boolean} enabled - Whether to enable critical-only mode
   */
  setCriticalMode(enabled) {
    const wasEnabled = this.criticalOnly;
    this.criticalOnly = enabled;

    if (enabled && !wasEnabled) {
      // Switching to critical mode - restart interval with faster polling
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = setInterval(() => this.poll(), this.criticalPollIntervalMs);
        debugLog('battle.stateSync', 'BattleStatePoller switched to critical mode (faster polling)');
      }
    } else if (!enabled && wasEnabled) {
      // Switching back to normal mode - restore normal interval
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = setInterval(() => this.poll(), this.pollIntervalMs);
        debugLog('battle.stateSync', 'BattleStatePoller switched to normal mode');
      }

      // If we accumulated drift during critical mode, sync now
      if (this.pendingFullSync) {
        this.pendingFullSync = false;
        debugLog('battle.stateSync', 'Triggering deferred full sync after critical mode');
        this.poll();
      }
    }
  }

  /**
   * Update the local state for comparison
   * Called by BattleWebSocketManager when state changes
   * @param {Object} state - Local battle state
   * @param {number|string} state.activeUnitId - Currently active unit ID
   * @param {number} state.turnCount - Current turn count
   * @param {string} state.status - Battle status ('active', 'completed', etc.)
   * @param {Array} state.units - Array of unit states with id, x, y, hp
   */
  setLocalState(state) {
    this.localState = state;
    debugLog('battle.stateSync', 'Local state updated for polling comparison');
  }

  /**
   * Poll the server for current battle state
   * Compares with local state and triggers callback if drift detected
   * In critical-only mode, only checks critical fields and notifies via onCriticalDrift
   */
  async poll() {
    if (this.paused) {
      debugLog('battle.stateSync', 'Poll skipped - poller is paused');
      return;
    }

    if (!this.game?.api?.token) {
      debugLog('battle.stateSync', 'Poll skipped - no auth token available');
      return;
    }

    try {
      const headers = {
        'Authorization': `Bearer ${this.game.api.token}`,
        'Content-Type': 'application/json'
      };

      // Add If-None-Match header for ETag caching
      // Skip ETag in critical mode since we need fresh data
      if (this.lastETag && !this.criticalOnly) {
        headers['If-None-Match'] = this.lastETag;
      }

      const response = await fetch(
        `${this.game.api.baseUrl}/battle/${this.battleId}/state`,
        { method: 'GET', headers }
      );

      this.lastPollTime = Date.now();

      // 304 Not Modified - state unchanged
      if (response.status === 304) {
        debugLog('battle.stateSync', 'Poll returned 304 - state unchanged');
        return;
      }

      // Non-OK response
      if (!response.ok) {
        debugLog('battle.stateSync', `Poll failed with status ${response.status}`);
        return;
      }

      // Store new ETag
      const newETag = response.headers.get('ETag');
      // Critical polling deliberately fetches a fresh snapshot without cache
      // validators. Keep the last fully-applied ETag so the deferred normal
      // poll cannot receive a 304 for state it has not actually synchronized.
      if (newETag && !this.criticalOnly) {
        this.lastETag = newETag;
      }

      const serverState = await response.json();
      debugLog('battle.stateSync', 'Poll received server state', serverState);

      // In critical-only mode, only check critical fields
      if (this.criticalOnly) {
        const criticalDrift = this.hasCriticalDrift(serverState);
        if (criticalDrift) {
          debugLog('battle.stateSync', 'Critical drift detected during animation', criticalDrift);
          if (this.onCriticalDrift) {
            this.onCriticalDrift(criticalDrift.type, criticalDrift.serverValue, serverState);
          }
          // Mark that we need a full sync when critical mode ends
          this.pendingFullSync = true;
        }
        return;
      }

      // Full drift check in normal mode
      if (this.hasStateDrift(serverState)) {
        debugLog('battle.stateSync', 'Drift detected - triggering callback');
        if (this.onDriftDetected) {
          this.onDriftDetected(serverState);
        }
      } else {
        debugLog('battle.stateSync', 'No drift detected');
      }
    } catch (error) {
      debugLog('battle.stateSync', 'Poll error:', error.message);
    }
  }

  /**
   * Check only critical fields for drift (used during animations)
   * @param {Object} serverState - State from server
   * @returns {Object|null} Drift info with type and serverValue, or null if no critical drift
   */
  hasCriticalDrift(serverState) {
    if (!this.localState) {
      return null;
    }

    // Terminal outcome is the most important mismatch. A battle-ending update
    // commonly changes the active unit and turn count at the same time.
    if (serverState.status !== this.localState.status) {
      return {
        type: 'status_changed',
        serverValue: serverState.status,
        localValue: this.localState.status
      };
    }

    // Check active unit changed (turn changed on server)
    if (serverState.activeUnitId !== this.localState.activeUnitId) {
      return {
        type: 'turn_changed',
        serverValue: serverState.activeUnitId,
        localValue: this.localState.activeUnitId
      };
    }

    // Check turn count changed
    if (serverState.turnCount !== this.localState.turnCount) {
      return {
        type: 'turn_count_changed',
        serverValue: serverState.turnCount,
        localValue: this.localState.turnCount
      };
    }

    return null;
  }

  /**
   * Compare server state with local state to detect drift
   * @param {Object} serverState - State from server
   * @returns {boolean} True if drift is detected
   */
  hasStateDrift(serverState) {
    if (!this.localState) {
      debugLog('battle.stateSync', 'No local state to compare - no drift');
      return false;
    }

    // Check turn state
    if (serverState.activeUnitId !== this.localState.activeUnitId) {
      debugLog('battle.stateSync', 'Drift detected: activeUnitId mismatch',
        { server: serverState.activeUnitId, local: this.localState.activeUnitId });
      return true;
    }

    if (serverState.turnCount !== this.localState.turnCount) {
      debugLog('battle.stateSync', 'Drift detected: turnCount mismatch',
        { server: serverState.turnCount, local: this.localState.turnCount });
      return true;
    }

    if (serverState.status !== this.localState.status) {
      debugLog('battle.stateSync', 'Drift detected: status mismatch',
        { server: serverState.status, local: this.localState.status });
      return true;
    }

    // Check unit positions and HP
    for (const serverUnit of serverState.units) {
      const localUnit = this.localState.units?.find(u => u.id === serverUnit.id);
      if (!localUnit) {
        // New unit on server that we don't have locally - might be expected
        // during unit summoning, but worth flagging
        debugLog('battle.stateSync', `Server has unit ${serverUnit.id} not found locally`);
        continue;
      }

      if (serverUnit.x !== localUnit.x || serverUnit.y !== localUnit.y) {
        debugLog('battle.stateSync', `Drift detected: unit ${serverUnit.id} position mismatch`,
          { server: { x: serverUnit.x, y: serverUnit.y }, local: { x: localUnit.x, y: localUnit.y } });
        return true;
      }

      if (serverUnit.hp !== localUnit.hp) {
        debugLog('battle.stateSync', `Drift detected: unit ${serverUnit.id} HP mismatch`,
          { server: serverUnit.hp, local: localUnit.hp });
        return true;
      }
    }

    return false;
  }

  /**
   * Get the timestamp of the last successful poll
   * Useful for debugging and UI display
   * @returns {number|null} Timestamp in milliseconds, or null if never polled
   */
  getLastPollTime() {
    return this.lastPollTime;
  }
}

export default BattleStatePoller;
