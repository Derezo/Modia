/**
 * @module HeartbeatManager
 * @description Client-side heartbeat system for WebSocket connection health monitoring.
 *
 * Sends periodic heartbeat messages to the server and tracks responses to detect
 * unhealthy connections. Calculates round-trip latency for connection quality metrics.
 *
 * Protocol:
 * - Client sends: { type: 'heartbeat', timestamp: <epoch_ms> }
 * - Server responds: { type: 'heartbeat_ack', timestamp: <echo>, serverTime: <server_epoch_ms> }
 *
 * @see websocket.js - WebSocket client that integrates this manager
 */

/**
 * Manages heartbeat messages for WebSocket connection health monitoring.
 */
export class HeartbeatManager {
  /**
   * Create a HeartbeatManager instance.
   * @param {Function} sendFn - Function to send WebSocket messages, receives message object
   * @param {Function} onUnhealthy - Callback invoked when connection becomes unhealthy
   */
  constructor(sendFn, onUnhealthy) {
    this.send = sendFn;
    this.onUnhealthy = onUnhealthy;

    // Configuration
    this.intervalMs = 15000;      // Send heartbeat every 15 seconds
    this.timeoutMs = 5000;        // Wait 5 seconds for response
    this.maxMissed = 2;           // Connection unhealthy after 2 missed responses

    // State
    this.missedCount = 0;
    this.latencyMs = 0;
    this.pendingTimestamp = null;
    this.interval = null;
    this.timeout = null;
    this.running = false;
  }

  /**
   * Start the heartbeat monitoring.
   * Sends first heartbeat immediately, then continues at configured interval.
   */
  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.missedCount = 0;

    // Send first heartbeat immediately
    this.sendHeartbeat();

    // Continue sending at interval
    this.interval = setInterval(() => {
      this.sendHeartbeat();
    }, this.intervalMs);
  }

  /**
   * Stop the heartbeat monitoring.
   * Clears all timers and resets state.
   */
  stop() {
    this.running = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    this.pendingTimestamp = null;
  }

  /**
   * Send a heartbeat message to the server.
   * Starts a timeout to detect missed responses.
   */
  sendHeartbeat() {
    if (!this.running) {
      return;
    }

    // Record when we sent this heartbeat
    this.pendingTimestamp = Date.now();

    // Send heartbeat message
    this.send({
      type: 'heartbeat',
      timestamp: this.pendingTimestamp
    });

    // Start timeout for response
    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    this.timeout = setTimeout(() => {
      this.handleMissed();
    }, this.timeoutMs);
  }

  /**
   * Handle a missed heartbeat response.
   * Increments missed count and triggers unhealthy callback if threshold exceeded.
   */
  handleMissed() {
    this.missedCount++;
    this.timeout = null;

    console.warn(
      `Heartbeat missed (${this.missedCount}/${this.maxMissed}). ` +
      `No response within ${this.timeoutMs}ms.`
    );

    if (this.missedCount >= this.maxMissed) {
      console.error('Connection unhealthy - missed too many heartbeats');

      if (this.onUnhealthy) {
        this.onUnhealthy();
      }
    }
  }

  /**
   * Handle a heartbeat acknowledgment from the server.
   * Calculates latency and resets missed count.
   * @param {number} serverTimestamp - The timestamp echoed back from the server
   * @returns {number} The calculated round-trip latency in milliseconds
   */
  handleAck(_serverTimestamp) {
    // Clear the timeout since we got a response
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    // Calculate latency from the pending timestamp
    if (this.pendingTimestamp) {
      this.latencyMs = Date.now() - this.pendingTimestamp;
    }

    // Reset missed count on successful response
    this.missedCount = 0;

    return this.latencyMs;
  }

  /**
   * Get the current latency measurement.
   * @returns {number} The most recent round-trip latency in milliseconds
   */
  getLatency() {
    return this.latencyMs;
  }

  /**
   * Check if the connection is currently healthy.
   * @returns {boolean} True if missed count is below threshold
   */
  isHealthy() {
    return this.missedCount < this.maxMissed;
  }

  /**
   * Get the current missed heartbeat count.
   * @returns {number} Number of consecutive missed heartbeats
   */
  getMissedCount() {
    return this.missedCount;
  }

  /**
   * Update configuration values.
   * Should be called before start() for changes to take effect.
   * @param {Object} config - Configuration options
   * @param {number} [config.intervalMs] - Heartbeat interval in milliseconds
   * @param {number} [config.timeoutMs] - Response timeout in milliseconds
   * @param {number} [config.maxMissed] - Maximum missed heartbeats before unhealthy
   */
  configure(config) {
    if (config.intervalMs !== undefined) {
      this.intervalMs = config.intervalMs;
    }
    if (config.timeoutMs !== undefined) {
      this.timeoutMs = config.timeoutMs;
    }
    if (config.maxMissed !== undefined) {
      this.maxMissed = config.maxMissed;
    }
  }
}

export default HeartbeatManager;
