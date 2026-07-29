/**
 * Health Endpoint Integration Tests
 * Tests for /api/health endpoints (basic check, readiness, metrics)
 *
 * These are smoke tests that verify the health endpoints return
 * expected response structures. Requires server running and database connected.
 *
 * @category integration
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { request } from '../testHelper.js';

describe('Health Endpoints', () => {
  describe('GET /api/health', () => {
    it('should return 200 with expected fields', async () => {
      const res = await request('GET', '/api/health');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'ok');
      assert.ok(res.body.timestamp, 'Response should include timestamp');
      assert.ok(res.body.version, 'Response should include version');

      // Validate timestamp is valid ISO 8601
      const timestamp = new Date(res.body.timestamp);
      assert.ok(!isNaN(timestamp.getTime()), 'Timestamp should be valid date');
    });
  });

  describe('GET /api/health/ready', () => {
    it('should return 200 with database status when DB is connected', async () => {
      const res = await request('GET', '/api/health/ready');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'ok');
      assert.ok(res.body.timestamp, 'Response should include timestamp');
      assert.ok(res.body.version, 'Response should include version');
      assert.ok(res.body.checks, 'Response should include readiness checks');
      assert.ok(res.body.checks.database, 'Checks should include database status');
      assert.strictEqual(res.body.checks.database.status, 'up');
      assert.ok(
        res.body.checks.terminalEffects,
        'Checks should include terminal-effect delivery status'
      );
    });
  });

  describe('GET /api/health/metrics', () => {
    it('should return 200 with all metric categories', async () => {
      const res = await request('GET', '/api/health/metrics');

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.status, 'Response should include status');
      assert.ok(res.body.timestamp, 'Response should include timestamp');
      assert.ok(res.body.version, 'Response should include version');
      assert.ok(typeof res.body.uptime === 'number', 'Response should include numeric uptime');

      // Verify memory metrics
      assert.ok(res.body.memory, 'Response should include memory object');
      assert.ok(typeof res.body.memory.heapUsed === 'number', 'Memory should include heapUsed');
      assert.ok(typeof res.body.memory.heapTotal === 'number', 'Memory should include heapTotal');
      assert.ok(typeof res.body.memory.rss === 'number', 'Memory should include rss');

      // Verify database metrics
      assert.ok(res.body.database, 'Response should include database object');
      assert.ok(res.body.database.status, 'Database should include status');
      assert.ok(res.body.database.pool, 'Database should include pool metrics');
      assert.ok(typeof res.body.database.pool.total === 'number', 'Database pool should include total');
      assert.ok(typeof res.body.database.pool.idle === 'number', 'Database pool should include idle');
      assert.ok(typeof res.body.database.pool.waiting === 'number', 'Database pool should include waiting');

      // Verify websocket metrics
      assert.ok(res.body.websocket, 'Response should include websocket object');
      assert.ok(typeof res.body.websocket.connections === 'number', 'Websocket should include connections');
      assert.ok(typeof res.body.websocket.rooms === 'number', 'Websocket should include rooms');

      // Verify battle architecture operational metrics
      assert.ok(res.body.terminalEffects, 'Response should include terminal-effect metrics');
      assert.ok(res.body.battleMaps, 'Response should include battle-map metrics');
      assert.ok(
        ['up', 'observing', 'degraded'].includes(res.body.battleMaps.status),
        'Battle-map metrics should include a known operational status'
      );
    });

    it('should not report unhealthy when required dependencies are available', async () => {
      const res = await request('GET', '/api/health/metrics');

      assert.strictEqual(res.status, 200);
      assert.ok(
        ['healthy', 'degraded'].includes(res.body.status),
        `Expected healthy or degraded status, received ${res.body.status}`
      );
      assert.strictEqual(res.body.database.status, 'connected');
    });
  });
});
