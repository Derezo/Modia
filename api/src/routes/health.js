import express from 'express';
import { pool } from '../config/database.js';
import { connections, rooms } from '../websocket/index.js';
import { isRedisConfigured, isRedisConnected, pingRedis } from '../config/redis.js';
import { isUsingRedisStore, getAllLimiterStats } from '../middleware/rateLimiterFactory.js';
import { battleTerminalOutbox } from '../services/battle/BattleTerminalOutbox.js';
import { battleTerminalOutboxWorker } from '../services/battle/BattleTerminalOutboxWorker.js';
import { getBattleMapOperationalMetrics } from '../services/battle/BattleMapOperations.js';
import { determineOverallHealthStatus } from '../services/healthStatus.js';
import { getFishingMetrics } from '../services/fishingMetrics.js';
import { getMetricsSnapshot as getWebSocketMetricsSnapshot } from '../websocket/wsMetrics.js';

const router = express.Router();

const VERSION = '1.0.0';
const startTime = Date.now();

// Request tracking for metrics
let requestStats = {
  total: 0,
  errors: 0,
  byEndpoint: {}
};

/**
 * Middleware to track request statistics.
 * Call trackRequest() from other middleware or routes to update stats.
 */
export function trackRequest(endpoint, isError = false) {
  requestStats.total++;
  if (isError) requestStats.errors++;

  if (!requestStats.byEndpoint[endpoint]) {
    requestStats.byEndpoint[endpoint] = { total: 0, errors: 0 };
  }
  requestStats.byEndpoint[endpoint].total++;
  if (isError) requestStats.byEndpoint[endpoint].errors++;
}

/**
 * Measure latency of an async operation.
 */
async function measureLatency(operation) {
  const start = Date.now();
  try {
    await operation();
    return { success: true, latency: Date.now() - start };
  } catch (error) {
    return { success: false, latency: Date.now() - start, error: error.message };
  }
}

/**
 * GET /api/health
 * Basic health check for load balancers.
 * No authentication required.
 */
router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: VERSION
  });
});

/**
 * GET /api/health/ready
 * Readiness check for deployment verification.
 * Verifies database and Redis connectivity.
 * No authentication required.
 */
router.get('/ready', async (req, res) => {
  const checks = {
    database: { status: 'up', latency: 0 },
    redis: { status: 'unconfigured', latency: 0 },
    terminalEffects: { status: 'up', latency: 0 }
  };

  let isReady = true;

  // Check database
  const dbResult = await measureLatency(() => pool.query('SELECT 1'));
  if (dbResult.success) {
    checks.database = { status: 'up', latency: dbResult.latency };
  } else {
    checks.database = { status: 'down', latency: dbResult.latency, error: dbResult.error };
    isReady = false;
  }

  // Check Redis (if configured)
  if (isRedisConfigured()) {
    const redisResult = await measureLatency(() => pingRedis());
    if (redisResult.success) {
      checks.redis = { status: 'up', latency: redisResult.latency };
    } else {
      // Redis being down is degraded, not failed (we have in-memory fallback)
      checks.redis = { status: 'degraded', latency: redisResult.latency, error: redisResult.error };
    }
  }

  let terminalDelivery = null;
  const terminalResult = await measureLatency(async () => {
    terminalDelivery = await battleTerminalOutbox.getDeliveryStatus();
  });
  const terminalWorker = battleTerminalOutboxWorker.getStatus();
  if (
    !terminalResult.success ||
    !terminalWorker.running ||
    terminalWorker.schemaBlocked
  ) {
    checks.terminalEffects = {
      status: 'down',
      latency: terminalResult.latency,
      worker: terminalWorker,
      ...(terminalResult.error && { error: terminalResult.error })
    };
    isReady = false;
  } else {
    checks.terminalEffects = {
      status: terminalDelivery.exhausted > 0 ? 'degraded' : 'up',
      latency: terminalResult.latency,
      worker: terminalWorker,
      delivery: terminalDelivery
    };
  }

  const status = isReady ? 'ok' : 'error';
  const httpStatus = isReady ? 200 : 503;

  res.status(httpStatus).json({
    status,
    timestamp: new Date().toISOString(),
    version: VERSION,
    checks
  });
});

/**
 * GET /api/health/live
 * Liveness check for Kubernetes probes.
 * Returns 200 if the process is running.
 * No authentication required.
 */
router.get('/live', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime())
  });
});

/**
 * GET /api/health/metrics
 * Detailed metrics for monitoring systems.
 * Includes pool stats, WebSocket connections, memory usage, and rate limiter stats.
 * No authentication required.
 */
router.get('/metrics', async (req, res) => {
  // Database check with latency
  const dbResult = await measureLatency(() => pool.query('SELECT 1'));
  const databaseStatus = dbResult.success ? 'connected' : 'disconnected';

  // Redis check with latency (if configured)
  let redisStatus = { configured: false };
  if (isRedisConfigured()) {
    const redisResult = await measureLatency(() => pingRedis());
    redisStatus = {
      configured: true,
      connected: isRedisConnected(),
      status: redisResult.success ? 'up' : 'down',
      latency: redisResult.latency,
      ...(redisResult.error && { error: redisResult.error })
    };
  }

  let terminalDelivery = null;
  const terminalResult = await measureLatency(async () => {
    terminalDelivery = await battleTerminalOutbox.getDeliveryStatus();
  });
  const terminalWorker = battleTerminalOutboxWorker.getStatus();

  const memoryUsage = process.memoryUsage();
  const battleMapMetrics = getBattleMapOperationalMetrics();
  const websocketMetrics = getWebSocketMetricsSnapshot(
    connections.size,
    rooms.size
  );
  const fishingMetrics = getFishingMetrics();

  const overallStatus = determineOverallHealthStatus({
    databaseAvailable: dbResult.success,
    terminalDeliveryAvailable: terminalResult.success,
    terminalWorkerReady:
      terminalWorker.running && !terminalWorker.schemaBlocked,
    terminalEffectsExhausted: (terminalDelivery?.exhausted ?? 0) > 0,
    redisAvailable: !isRedisConfigured() || isRedisConnected(),
    battleMapsDegraded: battleMapMetrics.status === 'degraded'
  });

  res.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: VERSION,
    uptime: Math.floor(process.uptime()),
    startedAt: new Date(startTime).toISOString(),

    // Request statistics
    requests: {
      total: requestStats.total,
      errors: requestStats.errors,
      errorRate: requestStats.total > 0
        ? ((requestStats.errors / requestStats.total) * 100).toFixed(2) + '%'
        : '0%'
    },

    // Memory metrics
    memory: {
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      heapUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      rss: memoryUsage.rss,
      rssMB: Math.round(memoryUsage.rss / 1024 / 1024),
      external: memoryUsage.external
    },

    // Database metrics
    database: {
      status: databaseStatus,
      latency: dbResult.latency,
      pool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
      },
      ...(dbResult.error && { error: dbResult.error })
    },

    // Redis metrics
    redis: redisStatus,

    // Durable terminal-effect delivery metrics
    terminalEffects: {
      status: !terminalResult.success
        ? 'down'
        : (!terminalWorker.running ||
            terminalWorker.schemaBlocked ||
            terminalDelivery.exhausted > 0
          ? 'degraded'
          : 'up'),
      latency: terminalResult.latency,
      worker: terminalWorker,
      ...(terminalDelivery && { delivery: terminalDelivery }),
      ...(terminalResult.error && { error: terminalResult.error })
    },

    // Battle-map rollout, payload, capability, and recovery telemetry
    battleMaps: battleMapMetrics,

    // Authoritative fishing funnel, settlement, and observed economy telemetry
    fishing: fishingMetrics,

    // Rate limiter metrics
    rateLimiter: {
      store: isUsingRedisStore() ? 'redis' : 'memory',
      stats: getAllLimiterStats()
    },

    // WebSocket metrics
    websocket: {
      connections: connections.size,
      rooms: rooms.size,
      roomList: Array.from(rooms.keys()).slice(0, 20), // First 20 rooms for debugging
      metrics: websocketMetrics
    }
  });
});

/**
 * POST /api/health/stats/reset
 * Reset request statistics (useful for testing).
 * Only available in non-production environments.
 */
router.post('/stats/reset', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }

  requestStats = {
    total: 0,
    errors: 0,
    byEndpoint: {}
  };

  res.json({ status: 'ok', message: 'Stats reset' });
});

export default router;
