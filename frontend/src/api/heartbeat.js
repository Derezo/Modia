/**
 * @module HeartbeatManager
 * @description Client-side heartbeat system for WebSocket connection health monitoring.
 *
 * Sends periodic heartbeat messages to the server and tracks responses to detect
 * unhealthy connections. Calculates round-trip latency for connection quality metrics.
 *
 * Protocol:
 * - Client sends: { type: 'heartbeat', timestamp: <epoch_ms>, id: <monotonic_int> }
 * - Server responds: { type: 'heartbeat_ack', timestamp: <echo>, id: <echo>, serverTime: <server_epoch_ms> }
 *
 * The ID correlation eliminates race conditions where late ACKs for previous heartbeats
 * could interfere with the current heartbeat's timeout handling.
 *
 * @see websocket.js - WebSocket client that integrates this manager
 */

/**
 * Manages heartbeat messages for WebSocket connection health monitoring.
 */
export class HeartbeatManager {
  /**
   * Create a HeartbeatManager instance.
   * @param {Function} sendFn - Function to send WebSocket messages, receives message object.
   *                            Should return true if send succeeded, false otherwise.
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

    // ID correlation state - eliminates race conditions with late/stale ACKs
    this.heartbeatId = 0;           // Monotonically increasing ID
    this.pendingHeartbeatId = null; // ID of heartbeat currently awaiting ACK

    // Connection ID for server-side connection tracking
    this.connectionId = null;
  }

  /**
   * Set the connection ID for this heartbeat manager.
   * Called by WebSocketManager when a new connection is established.
   * @param {string} connectionId - The unique connection identifier
   */
  setConnectionId(connectionId) {
    this.connectionId = connectionId;
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
    this.pendingHeartbeatId = null;
    // Note: connectionId is NOT cleared here - it's managed by WebSocketManager
    // and will be updated via setConnectionId() on new connection attempts
  }

  /**
   * Send a heartbeat message to the server.
   * Starts a timeout to detect missed responses.
   *
   * Guards against:
   * - Overlapping heartbeats (skips if one is already pending)
   * - Send failures (doesn't start timeout if send fails)
   */
  sendHeartbeat() {
    if (!this.running) {
      return;
    }

    // Guard against overlapping heartbeats - skip if one is already pending
    if (this.pendingHeartbeatId !== null) {
      return;
    }

    // Generate a unique ID for this heartbeat
    this.heartbeatId++;
    const currentId = this.heartbeatId;

    // Record when we sent this heartbeat
    this.pendingTimestamp = Date.now();

    // Build heartbeat message with ID for correlation
    const heartbeatMessage = {
      type: 'heartbeat',
      timestamp: this.pendingTimestamp,
      id: currentId
    };

    // Include connectionId if available (for server-side connection tracking)
    if (this.connectionId) {
      heartbeatMessage.connectionId = this.connectionId;
    }

    // Send heartbeat message
    const sendSucceeded = this.send(heartbeatMessage);

    // Only start timeout if send actually succeeded
    if (sendSucceeded === false) {
      // Send failed - don't start timeout (would be a guaranteed "miss")
      this.pendingTimestamp = null;
      return;
    }

    // Mark this heartbeat as pending
    this.pendingHeartbeatId = currentId;

    // Start timeout for response
    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    this.timeout = setTimeout(() => {
      this.handleMissed(currentId);
    }, this.timeoutMs);
  }

  /**
   * Handle a missed heartbeat response.
   * Increments missed count and triggers unhealthy callback if threshold exceeded.
   * @param {number} missedId - The ID of the heartbeat that timed out
   */
  handleMissed(missedId) {
    // Ignore stale timeouts - only count as missed if this is still the pending heartbeat
    if (missedId !== this.pendingHeartbeatId) {
      return;
    }

    this.missedCount++;
    this.timeout = null;
    this.pendingHeartbeatId = null; // Clear pending state so next interval can send

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
   * @param {number} [ackId] - The ID echoed back from the server (undefined for backwards compat)
   * @returns {number} The calculated round-trip latency in milliseconds, or -1 if ACK was ignored
   */
  handleAck(_serverTimestamp, ackId) {
    // If ackId provided, only process if it matches the pending heartbeat
    // This filters out late/stale ACKs that arrive after a new heartbeat was sent
    // (undefined ackId accepted for backwards compatibility with older servers)
    if (ackId !== undefined && ackId !== this.pendingHeartbeatId) {
      return -1; // Stale ACK, ignore
    }

    // Clear the timeout since we got a valid response
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    // Calculate latency from the pending timestamp
    if (this.pendingTimestamp) {
      this.latencyMs = Date.now() - this.pendingTimestamp;
    }

    // Clear pending state so next interval can send
    this.pendingHeartbeatId = null;

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
