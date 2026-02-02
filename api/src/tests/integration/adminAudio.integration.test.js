/**
 * Admin Audio Integration Tests
 * Tests for /api/admin/audio endpoints (verify-status, sync-status)
 *
 * Note: Admin endpoints are disabled in production (NODE_ENV=production).
 * These tests will be skipped if running in production environment.
 *
 * @category integration
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { request } from '../testHelper.js';

const isProduction = process.env.NODE_ENV === 'production';

describe('Admin Audio Endpoints', { skip: isProduction }, () => {
  before(() => {
    if (isProduction) {
      console.log('Skipping admin audio tests in production environment');
    }
  });

  describe('GET /api/admin/audio/verify-status', () => {
    it('should return verification results with expected fields', async () => {
      const res = await request('GET', '/api/admin/audio/verify-status');

      assert.strictEqual(res.status, 200);
      assert.ok('results' in res.body, 'Response should include results');
      assert.ok('healthy' in res.body, 'Response should include healthy flag');
      assert.ok('filter' in res.body, 'Response should include filter');

      // Verify results structure
      const { results } = res.body;
      assert.ok(typeof results.scanned === 'number', 'Results should include scanned count');
      assert.ok(typeof results.mismatches === 'number', 'Results should include mismatches count');
      assert.ok(Array.isArray(results.markedGeneratedButMissing), 'Results should include markedGeneratedButMissing array');
      assert.ok(Array.isArray(results.fileExistsButNotMarked), 'Results should include fileExistsButNotMarked array');
    });

    it('should filter by music type', async () => {
      const res = await request('GET', '/api/admin/audio/verify-status?type=music');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.filter, 'music');
      assert.ok('results' in res.body);
      assert.ok('healthy' in res.body);
    });

    it('should filter by sfx type', async () => {
      const res = await request('GET', '/api/admin/audio/verify-status?type=sfx');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.filter, 'sfx');
      assert.ok('results' in res.body);
      assert.ok('healthy' in res.body);
    });

    it('should return 400 for invalid type', async () => {
      const res = await request('GET', '/api/admin/audio/verify-status?type=invalid');

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Invalid audio type'));
    });

    it('should return all types when no filter specified', async () => {
      const res = await request('GET', '/api/admin/audio/verify-status');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.filter, 'all');
    });
  });

  describe('POST /api/admin/audio/sync-status', () => {
    it('should perform dry-run sync without making changes', async () => {
      const res = await request('POST', '/api/admin/audio/sync-status?dryRun=true');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.dryRun, true);
      assert.ok('results' in res.body, 'Response should include results');
      assert.ok(res.body.message.includes('Dry run'), 'Message should indicate dry run');

      // Verify results structure
      const { results } = res.body;
      assert.ok(typeof results.scanned === 'number', 'Results should include scanned count');
      assert.ok(typeof results.mismatches === 'number', 'Results should include mismatches count');
      assert.ok(typeof results.fixed === 'number', 'Results should include fixed count');
      assert.ok(Array.isArray(results.details), 'Results should include details array');

      // In dry run mode, fixed should always be 0
      assert.strictEqual(results.fixed, 0, 'Dry run should not fix any mismatches');
    });

    it('should filter by music type in dry-run', async () => {
      const res = await request('POST', '/api/admin/audio/sync-status?type=music&dryRun=true');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.filter, 'music');
      assert.strictEqual(res.body.dryRun, true);
    });

    it('should filter by sfx type in dry-run', async () => {
      const res = await request('POST', '/api/admin/audio/sync-status?type=sfx&dryRun=true');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.filter, 'sfx');
      assert.strictEqual(res.body.dryRun, true);
    });

    it('should return 400 for invalid type', async () => {
      const res = await request('POST', '/api/admin/audio/sync-status?type=invalid&dryRun=true');

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Invalid audio type'));
    });

    it('should return all types when no filter specified', async () => {
      const res = await request('POST', '/api/admin/audio/sync-status?dryRun=true');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.filter, 'all');
    });
  });

  describe('GET /api/admin/audio/status', () => {
    it('should return API status with expected fields', async () => {
      const res = await request('GET', '/api/admin/audio/status');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.enabled, true);
      assert.ok('environment' in res.body, 'Response should include environment');
      assert.ok('metadataDir' in res.body, 'Response should include metadataDir');
      assert.ok('validMusicCategories' in res.body, 'Response should include validMusicCategories');
      assert.ok('validSFXCategories' in res.body, 'Response should include validSFXCategories');
      assert.ok('serviceLoaded' in res.body, 'Response should include serviceLoaded');
    });
  });

  describe('GET /api/admin/audio/verify-durations', () => {
    it('should require type query parameter', async () => {
      const res = await request('GET', '/api/admin/audio/verify-durations');

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('type query param is required'));
    });

    it('should verify durations for music type', async () => {
      const res = await request('GET', '/api/admin/audio/verify-durations?type=music');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.type, 'music');
      assert.ok(typeof res.body.total === 'number', 'Response should include total count');
      assert.ok(typeof res.body.checked === 'number', 'Response should include checked count');
      assert.ok(typeof res.body.mismatches === 'number', 'Response should include mismatches count');
      assert.ok(Array.isArray(res.body.details), 'Response should include details array');
    });

    it('should verify durations for sfx type', async () => {
      const res = await request('GET', '/api/admin/audio/verify-durations?type=sfx');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.type, 'sfx');
      assert.ok(typeof res.body.total === 'number', 'Response should include total count');
      assert.ok(typeof res.body.checked === 'number', 'Response should include checked count');
      assert.ok(typeof res.body.mismatches === 'number', 'Response should include mismatches count');
      assert.ok(Array.isArray(res.body.details), 'Response should include details array');
    });

    it('should return 400 for invalid type', async () => {
      const res = await request('GET', '/api/admin/audio/verify-durations?type=invalid');

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('type query param is required'));
    });
  });

  describe('POST /api/admin/audio/sync-durations', () => {
    it('should require type query parameter', async () => {
      const res = await request('POST', '/api/admin/audio/sync-durations');

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('type query param is required'));
    });

    it('should perform dry-run sync for music type', async () => {
      const res = await request('POST', '/api/admin/audio/sync-durations?type=music&dryRun=true');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.type, 'music');
      assert.strictEqual(res.body.dryRun, true);
      assert.ok(res.body.message.includes('Dry run'), 'Message should indicate dry run');
      assert.ok(typeof res.body.scanned === 'number', 'Response should include scanned count');
      assert.ok(typeof res.body.mismatches === 'number', 'Response should include mismatches count');
      assert.ok(typeof res.body.fixed === 'number', 'Response should include fixed count');
      assert.ok(Array.isArray(res.body.details), 'Response should include details array');

      // In dry run mode, fixed should always be 0
      assert.strictEqual(res.body.fixed, 0, 'Dry run should not fix any mismatches');
    });

    it('should perform dry-run sync for sfx type', async () => {
      const res = await request('POST', '/api/admin/audio/sync-durations?type=sfx&dryRun=true');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.type, 'sfx');
      assert.strictEqual(res.body.dryRun, true);
      assert.ok(res.body.message.includes('Dry run'), 'Message should indicate dry run');
      assert.ok(typeof res.body.scanned === 'number', 'Response should include scanned count');
      assert.ok(typeof res.body.mismatches === 'number', 'Response should include mismatches count');
      assert.ok(typeof res.body.fixed === 'number', 'Response should include fixed count');
      assert.ok(Array.isArray(res.body.details), 'Response should include details array');

      // In dry run mode, fixed should always be 0
      assert.strictEqual(res.body.fixed, 0, 'Dry run should not fix any mismatches');
    });

    it('should return 400 for invalid type', async () => {
      const res = await request('POST', '/api/admin/audio/sync-durations?type=invalid&dryRun=true');

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('type query param is required'));
    });
  });
});
