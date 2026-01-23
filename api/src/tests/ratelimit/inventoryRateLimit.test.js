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

describe('Inventory Rate Limiting', () => {
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

  describe('Inventory Read Rate Limiting (gameReadLimiter)', () => {
    it('should allow read requests up to the limit', async () => {
      // gameReadLimiter has base 120 requests, used as-is in test mode
      const limit = 120;

      const responses = await fireRequests(
        limit,
        'GET',
        '/api/inventory/shared',
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
      // Fire 120 requests first (within limit)
      await fireRequests(120, 'GET', '/api/inventory/shared', null, testUser.accessToken);

      // Now fire more to exceed limit
      const extraRequests = 5;
      const responses = await fireRequests(
        extraRequests,
        'GET',
        '/api/inventory/shared',
        null,
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
        rateLimited[0].body.error.includes('Too many requests'),
        'Expected read rate limit message'
      );
    });

    it('should also rate limit character inventory endpoint', async () => {
      // Fire requests beyond the limit for character-specific endpoint
      const limit = 120;
      const overLimit = 5;

      const responses = await fireRequests(
        limit + overLimit,
        'GET',
        `/api/inventory/${testCharacter.id}`,
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

  describe('Inventory Action Rate Limiting (inventoryLimiter)', () => {
    it('should allow action requests up to the limit', async () => {
      // inventoryLimiter has base 45 requests, used as-is in test mode
      const limit = 45;

      // Fire equip requests (they may fail for other reasons, but shouldn't be rate limited)
      const responses = await fireRequests(
        limit,
        'POST',
        '/api/inventory/equip',
        { characterId: testCharacter.id, itemInstanceId: 99999, slot: 'main_hand' },
        testUser.accessToken
      );

      const rateLimited = responses.filter(r => r.status === 429);
      assert.strictEqual(
        rateLimited.length,
        0,
        `Expected no rate limited responses within limit, got ${rateLimited.length}`
      );
    });

    it('should block equip requests beyond the limit', async () => {
      // Fire 45 requests first (within limit)
      await fireRequests(
        45,
        'POST',
        '/api/inventory/equip',
        { characterId: testCharacter.id, itemInstanceId: 99999, slot: 'main_hand' },
        testUser.accessToken
      );

      // Now fire more to exceed limit
      const extraRequests = 5;
      const responses = await fireRequests(
        extraRequests,
        'POST',
        '/api/inventory/equip',
        { characterId: testCharacter.id, itemInstanceId: 99999, slot: 'main_hand' },
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
        rateLimited[0].body.error.includes('Too many inventory actions'),
        'Expected inventory action rate limit message'
      );
    });

    it('should rate limit unequip requests', async () => {
      const limit = 45;
      const overLimit = 5;

      const responses = await fireRequests(
        limit + overLimit,
        'POST',
        '/api/inventory/unequip',
        { characterId: testCharacter.id, slot: 'main_hand' },
        testUser.accessToken
      );

      const rateLimited = responses.filter(r => r.status === 429);
      assert.ok(
        rateLimited.length >= overLimit,
        `Expected at least ${overLimit} rate limited responses, got ${rateLimited.length}`
      );
    });

    it('should rate limit use item requests', async () => {
      const limit = 45;
      const overLimit = 5;

      const responses = await fireRequests(
        limit + overLimit,
        'POST',
        '/api/inventory/use',
        { itemInstanceId: 99999, targetCharacterId: testCharacter.id },
        testUser.accessToken
      );

      const rateLimited = responses.filter(r => r.status === 429);
      assert.ok(
        rateLimited.length >= overLimit,
        `Expected at least ${overLimit} rate limited responses, got ${rateLimited.length}`
      );
    });

    it('should rate limit discard item requests', async () => {
      const limit = 45;
      const overLimit = 5;

      const responses = await fireRequests(
        limit + overLimit,
        'POST',
        '/api/inventory/discard',
        { itemInstanceId: 99999 },
        testUser.accessToken
      );

      const rateLimited = responses.filter(r => r.status === 429);
      assert.ok(
        rateLimited.length >= overLimit,
        `Expected at least ${overLimit} rate limited responses, got ${rateLimited.length}`
      );
    });

    it('should track stats correctly', async () => {
      const stats = getRateLimiterStats('gameplay:inventory');
      assert.ok(stats, 'Inventory limiter stats should exist');
      assert.ok(stats.calls > 0, 'Should have tracked calls');
      assert.ok(stats.blocked > 0, 'Should have tracked blocked requests');
    });
  });
});
