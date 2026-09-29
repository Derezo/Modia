import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { request, uniqueUsername, uniqueEmail, resetRateLimitersViaApi, cleanupTestUser } from '../testHelper.js';

describe('Auth API', () => {
  let testUser = null;
  const createdUserIds = [];

  // Reset rate limiters before running auth tests to avoid 429 errors
  before(async () => {
    await resetRateLimitersViaApi();
  });

  // Clean up all created test users after tests complete
  after(async () => {
    for (const userId of createdUserIds) {
      await cleanupTestUser(userId);
    }
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      const username = uniqueUsername();
      const email = uniqueEmail();

      const res = await request('POST', '/api/auth/register', {
        username,
        email,
        password: 'TestPassword123!'
      });

      assert.strictEqual(res.status, 201);
      assert.ok(res.body.accessToken);
      assert.ok(res.body.refreshToken);
      assert.strictEqual(res.body.user.username, username);
      assert.strictEqual(res.body.user.email, email);

      // Store for later tests
      testUser = {
        username,
        email,
        password: 'TestPassword123!',
        accessToken: res.body.accessToken,
        refreshToken: res.body.refreshToken,
        userId: res.body.user.id
      };
      createdUserIds.push(res.body.user.id);
    });

    it('should reject registration with missing username', async () => {
      const res = await request('POST', '/api/auth/register', {
        email: uniqueEmail(),
        password: 'TestPassword123!'
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error || res.body.message);
    });

    it('should reject registration with missing email', async () => {
      const res = await request('POST', '/api/auth/register', {
        username: uniqueUsername(),
        password: 'TestPassword123!'
      });

      assert.strictEqual(res.status, 400);
    });

    it('should reject registration with missing password', async () => {
      const res = await request('POST', '/api/auth/register', {
        username: uniqueUsername(),
        email: uniqueEmail()
      });

      assert.strictEqual(res.status, 400);
    });

    it('should reject registration with short password', async () => {
      const res = await request('POST', '/api/auth/register', {
        username: uniqueUsername(),
        email: uniqueEmail(),
        password: 'test'
      });

      assert.strictEqual(res.status, 400);
    });

    it('should reject duplicate username', async () => {
      const username = uniqueUsername();
      const email1 = uniqueEmail();
      const email2 = uniqueEmail();

      // First registration
      const firstRes = await request('POST', '/api/auth/register', {
        username,
        email: email1,
        password: 'TestPassword123!'
      });
      if (firstRes.body?.user?.id) createdUserIds.push(firstRes.body.user.id);

      // Second registration with same username
      const res = await request('POST', '/api/auth/register', {
        username,
        email: email2,
        password: 'TestPassword123!'
      });

      assert.strictEqual(res.status, 409);
    });

    it('should reject duplicate email', async () => {
      const email = uniqueEmail();
      const username1 = uniqueUsername();
      const username2 = uniqueUsername();

      // First registration
      const firstRes = await request('POST', '/api/auth/register', {
        username: username1,
        email,
        password: 'TestPassword123!'
      });
      if (firstRes.body?.user?.id) createdUserIds.push(firstRes.body.user.id);

      // Second registration with same email
      const res = await request('POST', '/api/auth/register', {
        username: username2,
        email,
        password: 'TestPassword123!'
      });

      assert.strictEqual(res.status, 409);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login successfully with correct credentials', async () => {
      assert.ok(testUser, 'Test user should be created from registration tests');

      const res = await request('POST', '/api/auth/login', {
        username: testUser.username,
        password: testUser.password
      });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.accessToken);
      assert.ok(res.body.refreshToken);
      assert.strictEqual(res.body.user.username, testUser.username);

      // Update tokens for later tests
      testUser.accessToken = res.body.accessToken;
      testUser.refreshToken = res.body.refreshToken;
    });

    it('should reject login with incorrect password', async () => {
      const res = await request('POST', '/api/auth/login', {
        username: testUser.username,
        password: 'wrongTestPassword'
      });

      assert.strictEqual(res.status, 401);
    });

    it('should reject login with non-existent username', async () => {
      const res = await request('POST', '/api/auth/login', {
        username: 'nonexistentuser12345',
        password: 'someTestPassword'
      });

      assert.strictEqual(res.status, 401);
    });

    it('should reject login with missing credentials', async () => {
      const res = await request('POST', '/api/auth/login', {});

      assert.strictEqual(res.status, 400);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh tokens successfully', async () => {
      assert.ok(testUser, 'Test user should be created');

      const res = await request('POST', '/api/auth/refresh', {
        refreshToken: testUser.refreshToken
      });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.accessToken);
      assert.ok(res.body.refreshToken);

      // Update tokens
      testUser.accessToken = res.body.accessToken;
      testUser.refreshToken = res.body.refreshToken;
    });

    it('should reject invalid refresh token', async () => {
      const res = await request('POST', '/api/auth/refresh', {
        refreshToken: 'invalid-token-here'
      });

      assert.ok([400, 401, 403].includes(res.status));
    });

    it('should reject missing refresh token', async () => {
      const res = await request('POST', '/api/auth/refresh', {});

      assert.strictEqual(res.status, 400);
    });

    it('should invalidate old token after rotation (reuse detection)', async () => {
      // Create a fresh user for this test to avoid affecting other tests
      const username = uniqueUsername();
      const email = uniqueEmail();

      const regRes = await request('POST', '/api/auth/register', {
        username,
        email,
        password: 'TestPassword123!'
      });
      assert.strictEqual(regRes.status, 201);
      if (regRes.body?.user?.id) createdUserIds.push(regRes.body.user.id);

      const originalToken = regRes.body.refreshToken;

      // Rotate the token
      const refreshRes = await request('POST', '/api/auth/refresh', {
        refreshToken: originalToken
      });
      assert.strictEqual(refreshRes.status, 200);
      assert.ok(refreshRes.body.refreshToken);
      assert.notStrictEqual(refreshRes.body.refreshToken, originalToken);

      // Attempt to reuse the original token - should fail
      const reuseRes = await request('POST', '/api/auth/refresh', {
        refreshToken: originalToken
      });
      assert.strictEqual(reuseRes.status, 401, 'Rotated-out token should be rejected');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return current user info with valid token', async () => {
      assert.ok(testUser, 'Test user should be created');

      const res = await request('GET', '/api/auth/me', null, testUser.accessToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.user.username, testUser.username);
      assert.strictEqual(res.body.user.email, testUser.email);
    });

    it('should reject request without token', async () => {
      const res = await request('GET', '/api/auth/me');

      assert.strictEqual(res.status, 401);
    });

    it('should reject request with invalid token', async () => {
      const res = await request('GET', '/api/auth/me', null, 'invalid-token');

      assert.strictEqual(res.status, 401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout successfully', async () => {
      // Create a new user to logout (so we don't affect other tests)
      const username = uniqueUsername();
      const email = uniqueEmail();

      const regRes = await request('POST', '/api/auth/register', {
        username,
        email,
        password: 'TestPassword123!'
      });

      assert.strictEqual(regRes.status, 201);
      if (regRes.body?.user?.id) createdUserIds.push(regRes.body.user.id);

      const res = await request('POST', '/api/auth/logout', {
        refreshToken: regRes.body.refreshToken
      }, regRes.body.accessToken);

      assert.strictEqual(res.status, 200);

      // Old refresh token should no longer work
      const refreshRes = await request('POST', '/api/auth/refresh', {
        refreshToken: regRes.body.refreshToken
      });

      assert.ok([400, 401, 403].includes(refreshRes.status));
    });

    it('should logout one session while keeping another session valid', async () => {
      // Create a new user for this test
      const username = uniqueUsername();
      const email = uniqueEmail();

      const regRes = await request('POST', '/api/auth/register', {
        username,
        email,
        password: 'TestPassword123!'
      });

      assert.strictEqual(regRes.status, 201);
      if (regRes.body?.user?.id) createdUserIds.push(regRes.body.user.id);

      // Session A
      const sessionA = {
        accessToken: regRes.body.accessToken,
        refreshToken: regRes.body.refreshToken
      };

      // Create Session B by logging in again
      const loginRes = await request('POST', '/api/auth/login', {
        username,
        password: 'TestPassword123!'
      });

      assert.strictEqual(loginRes.status, 200);
      const sessionB = {
        accessToken: loginRes.body.accessToken,
        refreshToken: loginRes.body.refreshToken
      };

      // Both sessions should work initially
      const meA = await request('GET', '/api/auth/me', null, sessionA.accessToken);
      const meB = await request('GET', '/api/auth/me', null, sessionB.accessToken);
      assert.strictEqual(meA.status, 200, 'Session A should be valid');
      assert.strictEqual(meB.status, 200, 'Session B should be valid');

      // Logout Session A only
      const logoutRes = await request('POST', '/api/auth/logout', {
        refreshToken: sessionA.refreshToken
      }, sessionA.accessToken);
      assert.strictEqual(logoutRes.status, 200);

      // Session A's refresh token should no longer work
      const refreshA = await request('POST', '/api/auth/refresh', {
        refreshToken: sessionA.refreshToken
      });
      assert.ok(
        [400, 401, 403].includes(refreshA.status),
        'Session A refresh should fail after logout'
      );

      // Session B should still work (both access and refresh)
      const meBAfter = await request('GET', '/api/auth/me', null, sessionB.accessToken);
      assert.strictEqual(meBAfter.status, 200, 'Session B access token should still be valid');

      const refreshB = await request('POST', '/api/auth/refresh', {
        refreshToken: sessionB.refreshToken
      });
      assert.strictEqual(refreshB.status, 200, 'Session B refresh should still work');
    });
  });
});
