import { debugLog } from '../utils/debugLogger.js';

/**
 * @module BattleStatePoller
 * @description Defensive polling for battle state synchronization.
 *
 * Periodically fetches server state and detects drift between local
 * and server state. When drift is detected, triggers a callback to
 * apply the authoritative server state.
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
   * @param {function} onDriftDetected - Callback when state drift is detected
   * @param {Object} game - Game instance for API access
   */
  constructor(battleId, onDriftDetected, game) {
    this.battleId = battleId;
    this.onDriftDetected = onDriftDetected;
    this.game = game;
    this.pollIntervalMs = 10000; // Poll every 10 seconds
    this.interval = null;
    this.lastETag = null;
    this.lastPollTime = null;
    this.paused = false;
    this.localState = null; // For comparison
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
      if (this.lastETag) {
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
      if (newETag) {
        this.lastETag = newETag;
      }

      const serverState = await response.json();
      debugLog('battle.stateSync', 'Poll received server state', serverState);

      // Check for drift
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
