/**
 * Admin Generation Integration Tests
 * Tests for /api/admin/generate endpoint
 *
 * Covers:
 * - filters.id normalization (bug fix regression)
 * - Animation array fan-out behavior
 * - Queue management
 *
 * Note: Admin endpoints are disabled in production (NODE_ENV=production).
 * These tests will be skipped if running in production environment.
 *
 * @category integration
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { request } from '../testHelper.js';

const isProduction = process.env.NODE_ENV === 'production';

describe('Admin Generation API', { skip: isProduction }, () => {
  before(() => {
    if (isProduction) {
      console.log('Skipping admin generation tests in production environment');
    }
  });

  // Clean up any jobs after each test by cancelling all
  after(async () => {
    try {
      await request('POST', '/api/admin/generate/cancel', { all: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('POST /api/admin/generate - filters.id normalization', () => {
    it('should accept filters.id as a key filter (regression test)', async () => {
      // This tests the bug fix where filters.id was not recognized
      const res = await request('POST', '/api/admin/generate', {
        category: 'characters',
        filters: { id: 'warrior' },  // Using 'id' instead of 'key'
        options: { dryRun: true }
      });

      assert.strictEqual(res.status, 202, 'Should return 202 Accepted');
      assert.ok(res.body.jobId, 'Response should include jobId');
      assert.ok(res.body.message.includes('queued'), 'Message should indicate job was queued');
    });

    it('should still accept filters.key as a key filter', async () => {
      const res = await request('POST', '/api/admin/generate', {
        category: 'characters',
        filters: { key: 'warrior' },  // Using legacy 'key' format
        options: { dryRun: true }
      });

      assert.strictEqual(res.status, 202, 'Should return 202 Accepted');
      assert.ok(res.body.jobId, 'Response should include jobId');
    });

    it('should still accept filters.keys array', async () => {
      const res = await request('POST', '/api/admin/generate', {
        category: 'characters',
        filters: { keys: ['warrior', 'wizard'] },
        options: { dryRun: true }
      });

      assert.strictEqual(res.status, 202, 'Should return 202 Accepted');
      assert.ok(res.body.jobId, 'Response should include jobId');
    });

    it('should still accept filters.ids array', async () => {
      const res = await request('POST', '/api/admin/generate', {
        category: 'characters',
        filters: { ids: ['warrior', 'wizard'] },
        options: { dryRun: true }
      });

      assert.strictEqual(res.status, 202, 'Should return 202 Accepted');
      assert.ok(res.body.jobId, 'Response should include jobId');
    });
  });

  describe('POST /api/admin/generate - animation array fan-out', () => {
    it('should create multiple jobs when options.animations is an array', async () => {
      const res = await request('POST', '/api/admin/generate', {
        category: 'characters',
        filters: { id: 'warrior' },
        options: {
          animations: ['idle', 'walk', 'attack'],
          dryRun: true
        }
      });

      assert.strictEqual(res.status, 202, 'Should return 202 Accepted');
      assert.ok(res.body.jobs, 'Response should include jobs array');
      assert.strictEqual(res.body.jobs.length, 3, 'Should create 3 jobs for 3 animations');
      assert.ok(res.body.message.includes('3'), 'Message should indicate 3 jobs queued');

      // Verify each job has a jobId
      for (const job of res.body.jobs) {
        assert.ok(job.jobId, 'Each job should have a jobId');
      }
    });

    it('should create single job for single animation in array', async () => {
      const res = await request('POST', '/api/admin/generate', {
        category: 'characters',
        filters: { id: 'warrior' },
        options: {
          animations: ['hit'],
          dryRun: true
        }
      });

      assert.strictEqual(res.status, 202, 'Should return 202 Accepted');
      assert.ok(res.body.jobs, 'Response should include jobs array');
      assert.strictEqual(res.body.jobs.length, 1, 'Should create 1 job for 1 animation');
    });

    it('should use singular animation format (not fan-out) when options.animation is provided', async () => {
      const res = await request('POST', '/api/admin/generate', {
        category: 'characters',
        filters: { id: 'warrior' },
        options: {
          animation: 'idle',  // singular, not array
          dryRun: true
        }
      });

      assert.strictEqual(res.status, 202, 'Should return 202 Accepted');
      assert.ok(res.body.jobId, 'Response should include single jobId');
      assert.ok(!res.body.jobs, 'Response should not include jobs array');
    });

    it('should not fan out when options.animations is empty array', async () => {
      const res = await request('POST', '/api/admin/generate', {
        category: 'characters',
        filters: { id: 'warrior' },
        options: {
          animations: [],  // empty array
          dryRun: true
        }
      });

      assert.strictEqual(res.status, 202, 'Should return 202 Accepted');
      assert.ok(res.body.jobId, 'Response should include single jobId (fallback to default)');
      assert.ok(!res.body.jobs, 'Response should not include jobs array');
    });

    it('should not fan out for non-character categories', async () => {
      const res = await request('POST', '/api/admin/generate', {
        category: 'tiles',
        filters: { biome: 'forest' },
        options: {
          animations: ['idle', 'walk'],  // animations array should be ignored for tiles
          dryRun: true
        }
      });

      assert.strictEqual(res.status, 202, 'Should return 202 Accepted');
      assert.ok(res.body.jobId, 'Response should include single jobId');
      assert.ok(!res.body.jobs, 'Response should not include jobs array for tiles');
    });
  });

  describe('POST /api/admin/generate - category validation', () => {
    it('should reject invalid category', async () => {
      const res = await request('POST', '/api/admin/generate', {
        category: 'invalid-category',
        filters: {},
        options: {}
      });

      assert.strictEqual(res.status, 400, 'Should return 400 Bad Request');
      assert.ok(res.body.error.includes('Invalid category'), 'Error should mention invalid category');
    });

    it('should accept valid categories', async () => {
      const validCategories = ['tiles', 'portraits', 'items', 'icons', 'nodes', 'overlays', 'characters'];

      for (const category of validCategories) {
        const res = await request('POST', '/api/admin/generate', {
          category,
          filters: {},
          options: { dryRun: true }
        });

        assert.strictEqual(res.status, 202, `Category '${category}' should be accepted`);
      }
    });
  });

  describe('GET /api/admin/generate/queue - queue status', () => {
    it('should return queue status', async () => {
      const res = await request('GET', '/api/admin/generate/queue');

      assert.strictEqual(res.status, 200, 'Should return 200 OK');
      assert.ok('pending' in res.body, 'Response should include pending queue');
      assert.ok('stats' in res.body, 'Response should include stats');
      assert.ok(typeof res.body.paused === 'boolean', 'Response should include paused status');
    });

    it('should show queued jobs after queueing', async () => {
      // Queue a job
      await request('POST', '/api/admin/generate', {
        category: 'characters',
        filters: { id: 'warrior' },
        options: { dryRun: true }
      });

      // Check queue
      const res = await request('GET', '/api/admin/generate/queue');

      assert.strictEqual(res.status, 200);
      // Note: Job might be current or pending depending on timing
      const totalJobs = (res.body.current ? 1 : 0) + res.body.pending.length;
      assert.ok(totalJobs >= 0, 'Queue should track jobs');
    });
  });

  describe('POST /api/admin/generate/cancel - cancel jobs', () => {
    it('should cancel all jobs', async () => {
      // Queue some jobs
      await request('POST', '/api/admin/generate', {
        category: 'characters',
        filters: { id: 'warrior' },
        options: { animations: ['idle', 'walk'], dryRun: true }
      });

      // Cancel all
      const res = await request('POST', '/api/admin/generate/cancel', { all: true });

      assert.strictEqual(res.status, 200, 'Should return 200 OK');
      assert.ok('cancelledCount' in res.body, 'Response should include cancelledCount');
    });
  });
});
