import express from 'express';
import { pool } from '../config/database.js';
import { connections, rooms } from '../websocket/index.js';

const router = express.Router();

const VERSION = '1.0.0';

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
 * Verifies database connectivity.
 * No authentication required.
 */
router.get('/ready', async (req, res) => {
  try {
    // Verify database connectivity with a simple query
    await pool.query('SELECT 1');

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: VERSION,
      database: { status: 'connected' }
    });
  } catch (error) {
    console.error('Health check failed - database unreachable:', error.message);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      version: VERSION,
      database: { status: 'disconnected', error: error.message }
    });
  }
});

/**
 * GET /api/health/metrics
 * Detailed metrics for monitoring systems.
 * Includes pool stats, WebSocket connections, and memory usage.
 * No authentication required.
 */
router.get('/metrics', async (req, res) => {
  let databaseStatus = 'connected';
  let databaseError = null;

  try {
    await pool.query('SELECT 1');
  } catch (error) {
    databaseStatus = 'disconnected';
    databaseError = error.message;
  }

  const memoryUsage = process.memoryUsage();

  res.json({
    status: databaseStatus === 'connected' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: VERSION,
    uptime: Math.floor(process.uptime()),
    memory: {
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      rss: memoryUsage.rss
    },
    database: {
      status: databaseStatus,
      poolTotal: pool.totalCount,
      poolIdle: pool.idleCount,
      poolWaiting: pool.waitingCount,
      ...(databaseError && { error: databaseError })
    },
    websocket: {
      connections: connections.size,
      rooms: rooms.size
    }
  });
});

export default router;
