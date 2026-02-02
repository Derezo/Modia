/**
 * @module ConnectionQualityManager
 * @description Tracks WebSocket connection quality and notifies listeners of state changes.
 *
 * Connection states:
 * - healthy: Heartbeat OK, no retries, <200ms latency
 * - degraded: 1-2 pending retries OR 200-500ms latency
 * - unstable: 3+ retries OR >500ms latency OR recent reconnect
 * - disconnected: WebSocket closed
 * - reconnecting: Active reconnection attempt
 *
 * @see websocket.js - Primary consumer for connection events
 * @see ConnectionIndicator.js - UI component displaying connection state
 */

/**
 * Connection quality states
 * @readonly
 * @enum {string}
 */
export const ConnectionState = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNSTABLE: 'unstable',
  DISCONNECTED: 'disconnected',
  RECONNECTING: 'reconnecting'
};

/**
 * Manages connection quality state and notifies listeners of changes.
 */
export class ConnectionQualityManager {
  constructor() {
    /** @type {string} Current connection state */
    this.state = ConnectionState.DISCONNECTED;

    /** @type {number} Current latency in milliseconds */
    this.latencyMs = 0;

    /** @type {number} Number of pending message retries */
    this.pendingRetries = 0;

    /** @type {boolean} Whether WebSocket is connected */
    this.connected = false;

    /** @type {boolean} Whether reconnection is in progress */
    this.reconnecting = false;

    /** @type {number|null} Timestamp of last received message */
    this.lastMessageTime = null;

    /** @type {Array<function>} Registered change listeners */
    this.listeners = [];
  }

  /**
   * Update the measured latency and recalculate state.
   * @param {number} ms - Latency in milliseconds
   */
  updateLatency(ms) {
    this.latencyMs = ms;
    this.recalculateState();
  }

  /**
   * Called when a message retry is scheduled.
   * Increments pending retry count and recalculates state.
   */
  onRetryScheduled() {
    this.pendingRetries++;
    this.recalculateState();
  }

  /**
   * Called when an acknowledgment is received for a pending message.
   * Decrements pending retry count and updates last message time.
   */
  onAckReceived() {
    this.pendingRetries = Math.max(0, this.pendingRetries - 1);
    this.lastMessageTime = Date.now();
    this.recalculateState();
  }

  /**
   * Called when any message is received.
   * Updates last message time but does not recalculate state
   * (latency and retries are more significant indicators).
   */
  onMessageReceived() {
    this.lastMessageTime = Date.now();
  }

  /**
   * Called when WebSocket disconnects.
   * Sets state to disconnected and notifies listeners.
   */
  onDisconnect() {
    this.connected = false;
    this.state = ConnectionState.DISCONNECTED;
    this.notify();
  }

  /**
   * Called when reconnection attempt begins.
   * Sets state to reconnecting and notifies listeners.
   */
  onReconnecting() {
    this.reconnecting = true;
    this.state = ConnectionState.RECONNECTING;
    this.notify();
  }

  /**
   * Called when reconnection succeeds.
   * Resets retry count and recalculates state.
   */
  onReconnected() {
    this.connected = true;
    this.reconnecting = false;
    this.pendingRetries = 0;
    this.recalculateState();
  }

  /**
   * Called on initial connection.
   * Sets state to healthy and notifies listeners.
   */
  onConnected() {
    this.connected = true;
    this.reconnecting = false;
    this.state = ConnectionState.HEALTHY;
    this.notify();
  }

  /**
   * Recalculate connection state based on current metrics.
   * Notifies listeners only if state changed.
   */
  recalculateState() {
    const newState = this.calculateState();
    if (newState !== this.state) {
      this.state = newState;
      this.notify();
    }
  }

  /**
   * Calculate connection state based on current metrics.
   * @returns {string} The calculated connection state
   */
  calculateState() {
    if (!this.connected) {
      return ConnectionState.DISCONNECTED;
    }
    if (this.reconnecting) {
      return ConnectionState.RECONNECTING;
    }
    if (this.pendingRetries >= 3 || this.latencyMs > 500) {
      return ConnectionState.UNSTABLE;
    }
    if (this.pendingRetries >= 1 || this.latencyMs > 200) {
      return ConnectionState.DEGRADED;
    }
    return ConnectionState.HEALTHY;
  }

  /**
   * Register a callback to be notified of state changes.
   * @param {function} callback - Function called with new state on changes
   * @returns {function} Unsubscribe function
   */
  onChange(callback) {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Notify all registered listeners of the current state.
   */
  notify() {
    const stateInfo = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(stateInfo);
      } catch (error) {
        console.error('[ConnectionQuality] Listener error:', error);
      }
    }
  }

  /**
   * Get the current connection quality state and metrics.
   * @returns {{state: string, latencyMs: number, pendingRetries: number, lastMessageTime: number|null}}
   */
  getState() {
    return {
      state: this.state,
      latencyMs: this.latencyMs,
      pendingRetries: this.pendingRetries,
      lastMessageTime: this.lastMessageTime
    };
  }
}

// Export singleton instance for app-wide use
export const connectionQuality = new ConnectionQualityManager();
