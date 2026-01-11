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

describe('Marketplace Rate Limiting', () => {
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
    resetAllLimiterStats();
  });

  after(async () => {
    if (testUser) {
      await cleanupTestUser(testUser.userId);
    }
    await runCleanup();
  });

  beforeEach(() => {
    // Reset stats between test groups
    resetAllLimiterStats();
  });

  describe('Order Placement Rate Limiting', () => {
    it('should allow limit orders up to the limit', async () => {
      // orderLimiter has base 5 requests, production 2x = 10 per minute
      const limit = 10;

      const responses = await fireRequests(
        limit,
        'POST',
        '/api/marketplace/orders/limit',
        {
          itemTemplateId: 1,
          price: 100,
          quantity: 1,
          side: 'buy'
        },
        testUser.accessToken
      );

      const rateLimited = responses.filter(r => r.status === 429);
      assert.strictEqual(
        rateLimited.length,
        0,
        `Expected no rate limited responses within limit, got ${rateLimited.length}`
      );
    });

    it('should block limit orders beyond the limit', async () => {
      // Fire 10 requests first (within limit)
      await fireRequests(
        10,
        'POST',
        '/api/marketplace/orders/limit',
        { itemTemplateId: 1, price: 100, quantity: 1, side: 'buy' },
        testUser.accessToken
      );

      // Now fire more to exceed limit
      const extraRequests = 3;
      const responses = await fireRequests(
        extraRequests,
        'POST',
        '/api/marketplace/orders/limit',
        { itemTemplateId: 1, price: 100, quantity: 1, side: 'buy' },
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
        rateLimited[0].body.error.includes('Too many orders'),
        'Expected order rate limit message'
      );
    });
  });

  describe('Market Order Rate Limiting', () => {
    it('should have stricter limits for market orders', async () => {
      // marketOrderLimiter has base 2 requests, production 2x = 4 per minute
      // This is the most restrictive limiter
      const limit = 4;
      const overLimit = 2;

      const responses = await fireRequests(
        limit + overLimit,
        'POST',
        '/api/marketplace/orders/market',
        {
          itemTemplateId: 1,
          quantity: 1,
          side: 'buy'
        },
        testUser.accessToken
      );

      const rateLimited = responses.filter(r => r.status === 429);
      assert.ok(
        rateLimited.length >= overLimit,
        `Expected at least ${overLimit} rate limited responses, got ${rateLimited.length}`
      );

      // Check error message
      assert.ok(
        rateLimited[0].body.error.includes('Too many market orders'),
        'Expected market order rate limit message'
      );
    });
  });

  describe('Order Cancellation Rate Limiting', () => {
    it('should allow cancellations up to the limit', async () => {
      // cancelLimiter has base 10 requests, production 2x = 20 per minute
      const limit = 20;

      const responses = await fireRequests(
        limit,
        'DELETE',
        '/api/marketplace/orders/12345',
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

    it('should block cancellations beyond the limit', async () => {
      // Fire 20 requests first
      await fireRequests(20, 'DELETE', '/api/marketplace/orders/12345', null, testUser.accessToken);

      // Now fire more to exceed limit
      const extraRequests = 5;
      const responses = await fireRequests(
        extraRequests,
        'DELETE',
        '/api/marketplace/orders/12345',
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

  describe('Read Operations Rate Limiting', () => {
    it('should allow more read requests (most lenient)', async () => {
      // readLimiter has base 30 requests, production 2x = 60 per minute
      const limit = 60;

      const responses = await fireRequests(
        limit,
        'GET',
        '/api/marketplace/orderbook/1',
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

    it('should still block excessive read requests', async () => {
      // Fire 60 requests first
      await fireRequests(60, 'GET', '/api/marketplace/orderbook/1', null, testUser.accessToken);

      // Now fire more to exceed limit
      const extraRequests = 5;
      const responses = await fireRequests(
        extraRequests,
        'GET',
        '/api/marketplace/orderbook/1',
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

  describe('Search Operations Rate Limiting', () => {
    it('should rate limit search operations', async () => {
      // searchLimiter has base 15 requests, production 2x = 30 per minute
      const limit = 30;
      const overLimit = 5;

      const responses = await fireRequests(
        limit + overLimit,
        'GET',
        '/api/marketplace/search?query=sword',
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
        rateLimited[0].body.error.includes('Too many search requests'),
        'Expected search rate limit message'
      );
    });

    it('should track stats correctly', async () => {
      const stats = getRateLimiterStats('marketplace:search');
      assert.ok(stats, 'Marketplace search limiter stats should exist');
      assert.ok(stats.calls > 0, 'Should have tracked calls');
      assert.ok(stats.blocked > 0, 'Should have tracked blocked requests');
    });
  });

  describe('Limiter Independence', () => {
    it('should track different limiters independently', async () => {
      resetAllLimiterStats();

      // Fire requests to different endpoints
      await fireRequests(5, 'GET', '/api/marketplace/orderbook/1', null, testUser.accessToken);
      await fireRequests(3, 'GET', '/api/marketplace/search?query=test', null, testUser.accessToken);

      const readStats = getRateLimiterStats('marketplace:read');
      const searchStats = getRateLimiterStats('marketplace:search');

      assert.strictEqual(readStats.calls, 5, 'Read limiter should have 5 calls');
      assert.strictEqual(searchStats.calls, 3, 'Search limiter should have 3 calls');
    });
  });
});
