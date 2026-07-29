import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  request,
  fireRequests,
  createTestUser,
  createTestCharacter,
  resetAllLimiterStats,
  getRateLimiterStats,
  isRateLimitingEnabled,
  cleanupTestUser,
  runCleanup
} from '../testHelper.js';

describe('Battle Rate Limiting', () => {
  let testUser;
  let testCharacter;

  before(async () => {
    // Verify rate limiting is enabled for these tests
    assert.strictEqual(
      isRateLimitingEnabled(),
      true,
      'Rate limiting must be enabled for rate limit tests. Set TEST_RATE_LIMITS=true'
    );

    // Create test user and character
    testUser = await createTestUser();
    testCharacter = await createTestCharacter(testUser.accessToken);
    await resetAllLimiterStats();
  });

  after(async () => {
    if (testUser) {
      await cleanupTestUser(testUser.userId);
    }
    await runCleanup();
  });

  beforeEach(async () => {
    // Reset stats between test groups
    await resetAllLimiterStats();
  });

  describe('Battle Start Rate Limiting', () => {
    it('should allow battle start requests up to the limit', async () => {
      const limit = 5;

      // Fire requests to start battles (they may fail for other reasons, but shouldn't be rate limited)
      const responses = await fireRequests(
        limit,
        'POST',
        '/api/battle/start',
        { characterId: testCharacter.id, nodeId: 1 },
        testUser.accessToken
      );

      const rateLimited = responses.filter(r => r.status === 429);
      assert.strictEqual(
        rateLimited.length,
        0,
        `Expected no rate limited responses within limit, got ${rateLimited.length}`
      );
    });

    it('should block battle start requests beyond the limit', async () => {
      // Fire 5 requests first (within limit)
      await fireRequests(
        5,
        'POST',
        '/api/battle/start',
        { characterId: testCharacter.id, nodeId: 1 },
        testUser.accessToken
      );

      // Now fire more to exceed limit
      const extraRequests = 3;
      const responses = await fireRequests(
        extraRequests,
        'POST',
        '/api/battle/start',
        { characterId: testCharacter.id, nodeId: 1 },
        testUser.accessToken
      );

      const rateLimited = responses.filter(r => r.status === 429);
      assert.strictEqual(
        rateLimited.length,
        extraRequests,
        `Expected ${extraRequests} rate limited responses, got ${rateLimited.length}`
      );

      // Check error message
      assert.ok(
        rateLimited[0].body.error.includes('Too many battle starts'),
        'Expected battle start rate limit message'
      );
    });
  });

  describe('Battle Read Rate Limiting', () => {
    it('should allow read requests up to the limit', async () => {
      const limit = 15;

      const responses = await fireRequests(
        limit,
        'GET',
        '/api/battle/current',
        null,
        testUser.accessToken
      );

      const rateLimited = responses.filter(r => r.status === 429);
      assert.strictEqual(
        rateLimited.length,
        0,
        `Expected no rate limited responses within limit, got ${rateLimited.length}`
      );
    });

    it('should block read requests beyond the limit', async () => {
      // Fire 15 requests first (within limit)
      await fireRequests(15, 'GET', '/api/battle/current', null, testUser.accessToken);

      // Now fire more to exceed limit
      const extraRequests = 5;
      const responses = await fireRequests(
        extraRequests,
        'GET',
        '/api/battle/current',
        null,
        testUser.accessToken
      );

      const rateLimited = responses.filter(r => r.status === 429);
      assert.strictEqual(
        rateLimited.length,
        extraRequests,
        `Expected ${extraRequests} rate limited responses, got ${rateLimited.length}`
      );
    });
  });

  describe('Battle Action Rate Limiting', () => {
    it('should allow action requests up to the limit', async () => {
      const limit = 10;

      const responses = await fireRequests(
        limit,
        'POST',
        '/api/battle/action',
        { action: 'move', x: 0, y: 0 },
        testUser.accessToken
      );

      const rateLimited = responses.filter(r => r.status === 429);
      assert.strictEqual(
        rateLimited.length,
        0,
        `Expected no rate limited responses within limit, got ${rateLimited.length}`
      );
    });

    it('should block action requests beyond the limit', async () => {
      // Fire 10 requests first (within limit)
      await fireRequests(
        10,
        'POST',
        '/api/battle/action',
        { action: 'move', x: 0, y: 0 },
        testUser.accessToken
      );

      // Now fire more to exceed limit
      const extraRequests = 5;
      const responses = await fireRequests(
        extraRequests,
        'POST',
        '/api/battle/action',
        { action: 'move', x: 0, y: 0 },
        testUser.accessToken
      );

      const rateLimited = responses.filter(r => r.status === 429);
      assert.strictEqual(
        rateLimited.length,
        extraRequests,
        `Expected ${extraRequests} rate limited responses, got ${rateLimited.length}`
      );

      // Check error message
      assert.ok(
        rateLimited[0].body.error.includes('Too many battle actions'),
        'Expected battle action rate limit message'
      );
    });

    it('should track stats correctly', async () => {
      await fireRequests(
        11,
        'POST',
        '/api/battle/action',
        { action: 'move', x: 0, y: 0 },
        testUser.accessToken
      );

      const stats = await getRateLimiterStats('battle:action');
      assert.ok(stats, 'Battle action limiter stats should exist');
      assert.ok(stats.calls > 0, 'Should have tracked calls');
      assert.ok(stats.blocked > 0, 'Should have tracked blocked requests');
    });
  });

  describe('Battle Rejoin Rate Limiting', () => {
    it('should rate limit rejoin attempts', async () => {
      const limit = 5;
      const overLimit = 3;

      // Fire requests beyond the limit
      const responses = await fireRequests(
        limit + overLimit,
        'GET',
        '/api/battle/12345/rejoin',
        null,
        testUser.accessToken
      );

      const rateLimited = responses.filter(r => r.status === 429);
      assert.ok(
        rateLimited.length >= overLimit,
        `Expected at least ${overLimit} rate limited responses, got ${rateLimited.length}`
      );
    });
  });

  describe('Battle Rewards Rate Limiting', () => {
    it('should rate limit rewards requests', async () => {
      const limit = 10;
      const overLimit = 5;

      const responses = await fireRequests(
        limit + overLimit,
        'GET',
        '/api/battle/rewards/12345',
        null,
        testUser.accessToken
      );

      const rateLimited = responses.filter(r => r.status === 429);
      assert.ok(
        rateLimited.length >= overLimit,
        `Expected at least ${overLimit} rate limited responses, got ${rateLimited.length}`
      );

      // Check error message
      assert.ok(
        rateLimited[0].body.error.includes('Too many reward requests'),
        'Expected rewards rate limit message'
      );
    });
  });
});
