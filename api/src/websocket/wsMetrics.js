/**
 * @module WebSocketMetrics
 * @description WebSocket monitoring and diagnostics for observability.
 *
 * Key responsibilities:
 * - Track heartbeat health metrics (received, acks, timeouts)
 * - Track connection lifecycle metrics (connects, disconnects, replacements)
 * - Structured logging for WebSocket events
 * - Periodic health reports
 *
 * Configuration:
 * - WS_METRICS_INTERVAL_MS: How often to log metrics (default: 5 minutes)
 * - DEBUG: Enable verbose logging when true
 *
 * @see index.js - Main WebSocket handler that uses this module
 */

// ============================================================
// Configuration
// ============================================================

// Metrics reporting interval (default 5 minutes, configurable via env)
const METRICS_INTERVAL_MS = parseInt(process.env.WS_METRICS_INTERVAL_MS, 10) || 5 * 60 * 1000;

// Debug mode from environment
const DEBUG = process.env.DEBUG === 'true';

// ============================================================
// Metrics State
// ============================================================

const metrics = {
  // Heartbeat metrics
  heartbeatsReceived: 0,
  heartbeatAcksSent: 0,
  heartbeatTimeouts: 0,

  // Connection lifecycle metrics
  connectionsOpened: 0,
  connectionsClosed: 0,
  authSuccesses: 0,
  authFailures: 0,
  authTimeouts: 0,
  sessionsReplaced: 0,
  zombiesCleaned: 0,
  staleConnectionsRejected: 0,

  // Rate limiting metrics
  rateLimitHits: 0,

  // Error metrics
  messageErrors: 0,
  unknownMessageTypes: 0,

  // Timing
  startTime: Date.now(),
  lastReportTime: Date.now()
};

// ============================================================
// Structured Logging
// ============================================================

/**
 * Log levels for WebSocket events
 */
const LogLevel = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR'
};

/**
 * Structured log function for WebSocket events
 * @param {string} level - Log level (DEBUG, INFO, WARN, ERROR)
 * @param {string} event - Event type identifier
 * @param {Object} data - Additional data to log
 */
function wsLog(level, event, data = {}) {
  // Skip DEBUG logs unless DEBUG mode is enabled
  if (level === LogLevel.DEBUG && !DEBUG) {
    return;
  }

  const timestamp = new Date().toISOString();
  const prefix = `[WebSocket:${event}]`;

  // Sanitize data - remove sensitive fields and convert non-serializable values
  const sanitized = { ...data };
  delete sanitized.token;
  delete sanitized.password;

  // Format based on level
  const logData = {
    level,
    event,
    ...sanitized,
    timestamp
  };

  const message = `${prefix} ${JSON.stringify(logData)}`;

  switch (level) {
    case LogLevel.ERROR:
      console.error(message);
      break;
    case LogLevel.WARN:
      console.warn(message);
      break;
    default:
      console.log(message);
  }
}

// ============================================================
// Metric Increment Functions
// ============================================================

function incrementHeartbeatsReceived() {
  metrics.heartbeatsReceived++;
}

function incrementHeartbeatAcksSent() {
  metrics.heartbeatAcksSent++;
}

function incrementHeartbeatTimeouts() {
  metrics.heartbeatTimeouts++;
}

function incrementConnectionsOpened() {
  metrics.connectionsOpened++;
}

function incrementConnectionsClosed() {
  metrics.connectionsClosed++;
}

function incrementAuthSuccesses() {
  metrics.authSuccesses++;
}

function incrementAuthFailures() {
  metrics.authFailures++;
}

function incrementAuthTimeouts() {
  metrics.authTimeouts++;
}

function incrementSessionsReplaced() {
  metrics.sessionsReplaced++;
}

function incrementZombiesCleaned() {
  metrics.zombiesCleaned++;
}

function incrementStaleConnectionsRejected() {
  metrics.staleConnectionsRejected++;
}

function incrementRateLimitHits() {
  metrics.rateLimitHits++;
}

function incrementMessageErrors() {
  metrics.messageErrors++;
}

function incrementUnknownMessageTypes() {
  metrics.unknownMessageTypes++;
}

// ============================================================
// Metrics Reporting
// ============================================================

/**
 * Calculate and return current metrics snapshot
 * @param {number} currentConnections - Current active connection count
 * @param {number} currentRooms - Current active room count
 * @returns {Object} Metrics snapshot
 */
function getMetricsSnapshot(currentConnections = 0, currentRooms = 0) {
  const now = Date.now();
  const uptimeMs = now - metrics.startTime;
  const periodMs = now - metrics.lastReportTime;

  // Calculate rates per minute for the period
  const periodMinutes = periodMs / 60000;

  const snapshot = {
    // Current state
    currentConnections,
    currentRooms,

    // Heartbeat health
    heartbeatsReceived: metrics.heartbeatsReceived,
    heartbeatAcksSent: metrics.heartbeatAcksSent,
    heartbeatTimeouts: metrics.heartbeatTimeouts,
    heartbeatSuccessRate: metrics.heartbeatsReceived > 0
      ? ((metrics.heartbeatsReceived - metrics.heartbeatTimeouts) / metrics.heartbeatsReceived * 100).toFixed(2)
      : '100.00',

    // Connection lifecycle
    connectionsOpened: metrics.connectionsOpened,
    connectionsClosed: metrics.connectionsClosed,
    authSuccesses: metrics.authSuccesses,
    authFailures: metrics.authFailures,
    authTimeouts: metrics.authTimeouts,
    sessionsReplaced: metrics.sessionsReplaced,
    zombiesCleaned: metrics.zombiesCleaned,
    staleConnectionsRejected: metrics.staleConnectionsRejected,

    // Auth success rate
    authSuccessRate: (metrics.authSuccesses + metrics.authFailures + metrics.authTimeouts) > 0
      ? (metrics.authSuccesses / (metrics.authSuccesses + metrics.authFailures + metrics.authTimeouts) * 100).toFixed(2)
      : '100.00',

    // Rate limiting
    rateLimitHits: metrics.rateLimitHits,

    // Errors
    messageErrors: metrics.messageErrors,
    unknownMessageTypes: metrics.unknownMessageTypes,

    // Rates (per minute during this period)
    connectionsPerMinute: periodMinutes > 0 ? (metrics.connectionsOpened / periodMinutes).toFixed(2) : '0.00',
    heartbeatsPerMinute: periodMinutes > 0 ? (metrics.heartbeatsReceived / periodMinutes).toFixed(2) : '0.00',

    // Timing
    uptimeMinutes: (uptimeMs / 60000).toFixed(2),
    periodMinutes: periodMinutes.toFixed(2)
  };

  return snapshot;
}

/**
 * Log periodic metrics report
 * @param {number} currentConnections - Current active connection count
 * @param {number} currentRooms - Current active room count
 */
function logMetricsReport(currentConnections = 0, currentRooms = 0) {
  const snapshot = getMetricsSnapshot(currentConnections, currentRooms);

  wsLog(LogLevel.INFO, 'metrics_report', {
    connections: {
      current: snapshot.currentConnections,
      opened: snapshot.connectionsOpened,
      closed: snapshot.connectionsClosed,
      perMinute: snapshot.connectionsPerMinute
    },
    heartbeat: {
      received: snapshot.heartbeatsReceived,
      acksSent: snapshot.heartbeatAcksSent,
      timeouts: snapshot.heartbeatTimeouts,
      successRate: `${snapshot.heartbeatSuccessRate}%`
    },
    auth: {
      successes: snapshot.authSuccesses,
      failures: snapshot.authFailures,
      timeouts: snapshot.authTimeouts,
      successRate: `${snapshot.authSuccessRate}%`
    },
    sessions: {
      replaced: snapshot.sessionsReplaced,
      zombiesCleaned: snapshot.zombiesCleaned,
      staleRejected: snapshot.staleConnectionsRejected
    },
    rooms: {
      current: snapshot.currentRooms
    },
    errors: {
      messageErrors: snapshot.messageErrors,
      rateLimitHits: snapshot.rateLimitHits,
      unknownTypes: snapshot.unknownMessageTypes
    },
    uptime: `${snapshot.uptimeMinutes} minutes`
  });

  // Reset period-based counters after report
  metrics.lastReportTime = Date.now();
}

/**
 * Reset all metrics (useful for testing)
 */
function resetMetrics() {
  metrics.heartbeatsReceived = 0;
  metrics.heartbeatAcksSent = 0;
  metrics.heartbeatTimeouts = 0;
  metrics.connectionsOpened = 0;
  metrics.connectionsClosed = 0;
  metrics.authSuccesses = 0;
  metrics.authFailures = 0;
  metrics.authTimeouts = 0;
  metrics.sessionsReplaced = 0;
  metrics.zombiesCleaned = 0;
  metrics.staleConnectionsRejected = 0;
  metrics.rateLimitHits = 0;
  metrics.messageErrors = 0;
  metrics.unknownMessageTypes = 0;
  metrics.startTime = Date.now();
  metrics.lastReportTime = Date.now();
}

// ============================================================
// Metrics Interval Management
// ============================================================

let metricsInterval = null;

/**
 * Start periodic metrics reporting
 * @param {Function} getConnectionCount - Function to get current connection count
 * @param {Function} getRoomCount - Function to get current room count
 * @returns {NodeJS.Timeout} The interval ID
 */
function startMetricsReporting(getConnectionCount, getRoomCount) {
  if (metricsInterval) {
    clearInterval(metricsInterval);
  }

  wsLog(LogLevel.INFO, 'metrics_started', {
    intervalMs: METRICS_INTERVAL_MS,
    intervalMinutes: (METRICS_INTERVAL_MS / 60000).toFixed(2)
  });

  metricsInterval = setInterval(() => {
    const connections = typeof getConnectionCount === 'function' ? getConnectionCount() : 0;
    const rooms = typeof getRoomCount === 'function' ? getRoomCount() : 0;
    logMetricsReport(connections, rooms);
  }, METRICS_INTERVAL_MS);

  return metricsInterval;
}

/**
 * Stop periodic metrics reporting
 */
function stopMetricsReporting() {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
    wsLog(LogLevel.INFO, 'metrics_stopped', {});
  }
}

// ============================================================
// Exports
// ============================================================

export {
  // Logging
  wsLog,
  LogLevel,

  // Metric increments
  incrementHeartbeatsReceived,
  incrementHeartbeatAcksSent,
  incrementHeartbeatTimeouts,
  incrementConnectionsOpened,
  incrementConnectionsClosed,
  incrementAuthSuccesses,
  incrementAuthFailures,
  incrementAuthTimeouts,
  incrementSessionsReplaced,
  incrementZombiesCleaned,
  incrementStaleConnectionsRejected,
  incrementRateLimitHits,
  incrementMessageErrors,
  incrementUnknownMessageTypes,

  // Reporting
  getMetricsSnapshot,
  logMetricsReport,
  resetMetrics,
  startMetricsReporting,
  stopMetricsReporting,

  // Configuration
  METRICS_INTERVAL_MS
};

export default {
  wsLog,
  LogLevel,
  incrementHeartbeatsReceived,
  incrementHeartbeatAcksSent,
  incrementHeartbeatTimeouts,
  incrementConnectionsOpened,
  incrementConnectionsClosed,
  incrementAuthSuccesses,
  incrementAuthFailures,
  incrementAuthTimeouts,
  incrementSessionsReplaced,
  incrementZombiesCleaned,
  incrementStaleConnectionsRejected,
  incrementRateLimitHits,
  incrementMessageErrors,
  incrementUnknownMessageTypes,
  getMetricsSnapshot,
  logMetricsReport,
  resetMetrics,
  startMetricsReporting,
  stopMetricsReporting,
  METRICS_INTERVAL_MS
};
