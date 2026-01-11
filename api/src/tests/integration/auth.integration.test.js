import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { request, uniqueUsername, uniqueEmail } from '../testHelper.js';

describe('Auth API', () => {
  let testUser = null;

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
      await request('POST', '/api/auth/register', {
        username,
        email: email1,
        password: 'TestPassword123!'
      });

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
      await request('POST', '/api/auth/register', {
        username: username1,
        email,
        password: 'TestPassword123!'
      });

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
  });
});
