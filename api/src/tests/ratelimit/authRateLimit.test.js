import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  rateLimitedRequest,
  fireRequests,
  uniqueEmail,
  uniqueUsername,
  resetAllLimiterStats,
  getRateLimiterStats,
  isRateLimitingEnabled,
  cleanupTestUser,
  runCleanup
} from '../testHelper.js';

describe('Auth Rate Limiting', () => {
  const createdUserIds = [];

  before(async () => {
    // Verify rate limiting is enabled for these tests
    assert.strictEqual(
      isRateLimitingEnabled(),
      true,
      'Rate limiting must be enabled for rate limit tests. Set TEST_RATE_LIMITS=true'
    );
    await resetAllLimiterStats();
  });

  after(async () => {
    // Clean up any users created during testing
    for (const userId of createdUserIds) {
      await cleanupTestUser(userId);
    }
    await runCleanup();
  });

  describe('Login Rate Limiting', () => {
    it('should allow requests up to the limit', async () => {
      // TEST_RATE_LIMITS uses the configured base maximum.
      const limit = 10;
      const credentials = {
        username: 'nonexistent_user',
        password: 'testInvalidCredential123'
      };

      // Fire requests up to the limit
      const responses = await fireRequests(limit, 'POST', '/api/auth/login', credentials);

      // All should get through (though they'll be 401 unauthorized)
      const rateLimited = responses.filter(r => r.status === 429);
      assert.strictEqual(
        rateLimited.length,
        0,
        `Expected no rate limited responses within limit, got ${rateLimited.length}`
      );
    });

    it('should block requests beyond the limit', async () => {
      // Continue from previous test - we've already used 10 requests
      // Fire a few more to trigger rate limiting
      const extraRequests = 5;
      const credentials = {
        username: 'nonexistent_user',
        password: 'testInvalidCredential123'
      };

      const responses = await fireRequests(extraRequests, 'POST', '/api/auth/login', credentials);

      // All should be rate limited
      const rateLimited = responses.filter(r => r.status === 429);
      assert.strictEqual(
        rateLimited.length,
        extraRequests,
        `Expected all ${extraRequests} requests to be rate limited, got ${rateLimited.length}`
      );

      // Check error message
      assert.ok(
        rateLimited[0].body.error.includes('Too many login attempts'),
        'Expected rate limit error message'
      );
    });

    it('should track stats correctly', async () => {
      const stats = await getRateLimiterStats('auth');
      assert.ok(stats, 'Auth limiter stats should exist');
      assert.ok(stats.calls > 0, 'Should have tracked calls');
      assert.ok(stats.blocked > 0, 'Should have tracked blocked requests');
    });
  });

  describe('Registration Rate Limiting', () => {
    before(async () => {
      // Reset stats for this test group
      await resetAllLimiterStats();
    });

    it('should rate limit registration attempts', async () => {
      // Auth limiter is shared between login and register
      // Fire many registration requests with unique emails
      const limit = 10;
      const overLimit = 5;
      const totalRequests = limit + overLimit;

      const requests = [];
      for (let i = 0; i < totalRequests; i++) {
        requests.push({
          username: uniqueUsername(),
          email: uniqueEmail(),
          password: 'TestPassword123!'
        });
      }

      const responses = [];
      for (const body of requests) {
        const res = await rateLimitedRequest('POST', '/api/auth/register', body);
        responses.push(res);

        // Track created users for cleanup
        if (res.status === 201 && res.body.user) {
          createdUserIds.push(res.body.user.id);
        }
      }

      // Count successful registrations and rate limited
      const successful = responses.filter(r => r.status === 201);
      const rateLimited = responses.filter(r => r.status === 429);

      // Should have roughly 'limit' successful and 'overLimit' rate limited
      assert.ok(
        successful.length <= limit,
        `Expected at most ${limit} successful registrations, got ${successful.length}`
      );
      assert.ok(
        rateLimited.length >= overLimit - 1, // Allow some timing variance
        `Expected at least ${overLimit - 1} rate limited requests, got ${rateLimited.length}`
      );
    });
  });
});
