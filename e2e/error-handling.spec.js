import { test, expect } from './fixtures.js';
import {
  AUTH_SELECTORS,
  apiCall,
  createPlayer,
  enterWorldMap,
  generateTestCredentials,
  gotoAuth,
  sessionToken,
  waitForScene,
  waitForWorldMapReady
} from './helpers/index.js';

/**
 * Error Handling E2E Tests
 *
 * Tests how the application handles various error scenarios:
 * - Network failures
 * - Session expiration
 * - Rate limiting
 * - Invalid game actions
 *
 * Name-length and insufficient-gold validation live with their features in
 * character-creation.spec.js and shop.spec.js.
 */

test.describe('Authentication Errors', () => {
  test('should show error for invalid credentials', async ({ page }) => {
    await gotoAuth(page);

    await page.locator(AUTH_SELECTORS.username).fill('invaliduser');
    await page.locator(AUTH_SELECTORS.password).fill('wrongpassword');
    await page.locator(AUTH_SELECTORS.submit).click();

    // Should show error message
    const error = page.locator(AUTH_SELECTORS.error);
    await expect(error).toBeVisible({ timeout: 5000 });
    await expect(error).toHaveText(/invalid|incorrect/i);

    // Should stay on the login form
    await expect(page.locator(AUTH_SELECTORS.form)).toBeVisible();
  });

  test('should show error for empty username', async ({ page }) => {
    await gotoAuth(page);

    await page.locator(AUTH_SELECTORS.password).fill('somepassword');
    await page.locator(AUTH_SELECTORS.submit).click();

    // Should show validation error
    const usernameInput = page.locator(AUTH_SELECTORS.username);
    const isInvalid = await usernameInput.evaluate(el => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });

  test('should show error for empty password', async ({ page }) => {
    await gotoAuth(page);

    await page.locator(AUTH_SELECTORS.username).fill('someuser');
    await page.locator(AUTH_SELECTORS.submit).click();

    // Should show validation error or error message
    const passwordInput = page.locator(AUTH_SELECTORS.password);
    const isInvalid = await passwordInput.evaluate(el => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });
});

test.describe('Session Handling', () => {
  test('should return to login when the stored session is no longer valid', async ({ page, request }) => {
    const player = await createPlayer(request);
    await enterWorldMap(page, player);

    // Simulate a session that expired while the tab was closed: both tokens
    // in sessionStorage are rejected by the API on the next start-up.
    await page.evaluate(() => {
      const saved = JSON.parse(sessionStorage.getItem('modia_auth'));
      sessionStorage.setItem('modia_auth', JSON.stringify({
        ...saved,
        token: 'expired.access.token',
        refreshToken: 'expired-refresh-token'
      }));
    });
    await page.reload();

    await waitForScene(page, 'login', 20000);
    await expect(page.locator(AUTH_SELECTORS.form)).toBeVisible({ timeout: 10000 });
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('modia_auth')));
    expect(stored.token).toBeNull();
    expect(stored.refreshToken).toBeNull();
  });

  test('should refresh a rejected access token and retry the request', async ({ page, request }) => {
    const player = await createPlayer(request);
    await enterWorldMap(page, player);
    const before = await page.evaluate(() => JSON.parse(sessionStorage.getItem('modia_auth')));
    expect(before.token).toBeTruthy();
    expect(before.refreshToken).toBeTruthy();
    // Tokens live in sessionStorage, never in localStorage.
    expect(await page.evaluate(() => localStorage.getItem('accessToken'))).toBeNull();

    // The API client now holds an access token the server rejects, as if it
    // had expired. The next request gets a 401, refreshes and is retried.
    const me = await page.evaluate(async () => {
      window.game.api.setToken('expired.access.token');
      return window.game.api.get('/auth/me');
    });
    expect(me.user.username).toBe(player.username);

    const after = await page.evaluate(() => JSON.parse(sessionStorage.getItem('modia_auth')));
    expect(after.token).toBeTruthy();
    // The rejected token was replaced everywhere. Do not compare against
    // before.token: access tokens carry only userId/username and a
    // second-resolution iat, so a refresh in the same second as login yields
    // a byte-identical (and valid) token. The rotated refresh token below is
    // what proves a refresh happened.
    expect(after.token).not.toBe('expired.access.token');
    expect(await page.evaluate(() => window.game.api.token)).toBe(after.token);
    expect(after.refreshToken).toBeTruthy();
    expect(after.refreshToken).not.toBe(before.refreshToken);
    expect(await sessionToken(page)).toBe(after.token);
    await waitForScene(page, 'worldMap');
  });
});

test.describe('Network Error Handling', () => {
  test('should show error when server is unreachable', async ({ page }) => {
    await gotoAuth(page);

    // Block API requests
    await page.route('**/api/**', route => {
      route.abort('failed');
    });

    // Try to login
    const { username, password } = generateTestCredentials();
    await page.locator(AUTH_SELECTORS.username).fill(username);
    await page.locator(AUTH_SELECTORS.password).fill(password);
    await page.locator(AUTH_SELECTORS.submit).click();

    // Should show network error
    const error = page.locator(`${AUTH_SELECTORS.error}:visible, .error, [role="alert"], .toast-error, :text("network"):visible, :text("connection"):visible, :text("failed"):visible`);
    await expect(error.first()).toBeVisible({ timeout: 5000 });
  });

  test('should show a loading state while the login request is pending', async ({ page }) => {
    await gotoAuth(page);

    // Hold the login request open until the test releases it.
    let release;
    const released = new Promise(resolve => { release = resolve; });
    await page.route(url => url.pathname === '/api/auth/login', async route => {
      await released;
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid credentials' })
      });
    });

    const { username, password } = generateTestCredentials();
    await page.locator(AUTH_SELECTORS.username).fill(username);
    await page.locator(AUTH_SELECTORS.password).fill(password);
    await page.locator(AUTH_SELECTORS.submit).click();

    const submit = page.locator(AUTH_SELECTORS.submit);
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText(/Logging in/i);
    await expect(page.locator('#auth-panel')).toHaveClass(/form-loading/);

    release();

    await expect(submit).toBeEnabled({ timeout: 5000 });
    await expect(submit).toHaveText(/^Login$/);
    await expect(page.locator(AUTH_SELECTORS.error)).toHaveText(/invalid/i);
  });
});

test.describe('Rate Limiting', () => {
  test('should show rate limit error after too many requests', async ({ page }) => {
    // Mock rate limit response
    let requestCount = 0;
    await page.route('**/api/auth/login', route => {
      requestCount++;
      if (requestCount > 3) {
        route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Too many requests. Please wait.' })
        });
      } else {
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Invalid credentials' })
        });
      }
    });

    await gotoAuth(page);

    // Make multiple rapid login attempts
    for (let i = 0; i < 5; i++) {
      await page.locator(AUTH_SELECTORS.username).fill(`user${i}`);
      await page.locator(AUTH_SELECTORS.password).fill('wrongpass');
      await page.locator(AUTH_SELECTORS.submit).click();
      await page.waitForTimeout(100);
    }

    // Should eventually show rate limit error
    const rateLimitError = page.locator(':text("too many"):visible, :text("rate limit"):visible, :text("wait"):visible');
    await expect(rateLimitError.first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Game State Errors', () => {
  test('should reject travel to a node that does not exist', async ({ page, request }) => {
    const player = await createPlayer(request);
    await enterWorldMap(page, player);
    const token = await sessionToken(page);
    const { body: before } = await apiCall(request, 'GET', '/world/current', { token });

    const { status, body } = await apiCall(request, 'POST', '/world/travel', {
      token,
      data: { targetNodeId: 999999 },
      expectStatus: 400
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/not been discovered/i);

    const { body: after } = await apiCall(request, 'GET', '/world/current', { token });
    expect(after.currentNode.id).toBe(before.currentNode.id);
  });

  test('should reject travel to an undiscovered node in another region', async ({ page, request }) => {
    const player = await createPlayer(request);
    await enterWorldMap(page, player);
    const token = await sessionToken(page);
    const { body: current } = await apiCall(request, 'GET', '/world/current', { token });
    const { body: regions } = await apiCall(request, 'GET', '/world/regions', { token });
    const foreignCastle = regions.regions
      .map(region => region.castle?.nodeId)
      .find(nodeId => nodeId && nodeId !== current.currentNode.id);
    expect(foreignCastle, 'another region has a castle').toBeTruthy();

    const { body } = await apiCall(request, 'POST', '/world/travel', {
      token,
      data: { targetNodeId: foreignCastle },
      expectStatus: 400
    });
    expect(body.error).toMatch(/not been discovered/i);

    // The client is unaffected and still shows the starting node.
    await expect(page.locator('.node-action-menu__name')).toHaveText(current.currentNode.name);
  });

  test('should reject a malformed travel target', async ({ page, request }) => {
    const player = await createPlayer(request);
    await enterWorldMap(page, player);
    const token = await sessionToken(page);

    const { body } = await apiCall(request, 'POST', '/world/travel', {
      token,
      data: { targetNodeId: 'not-a-number' },
      expectStatus: 400
    });
    expect(typeof body.error).toBe('string');
  });
});

test.describe('WebSocket Error Handling', () => {
  test('should reconnect and re-authenticate after the socket drops', async ({ page, request }) => {
    const player = await createPlayer(request);
    await enterWorldMap(page, player);
    await expect.poll(() => page.evaluate(() =>
      window.game.socket?.ws?.readyState === WebSocket.OPEN && window.game.socket.hasAuthenticatedOnce === true
    ), { timeout: 15000 }).toBe(true);

    await page.evaluate(() => {
      // 'connect' is dispatched when a reconnected socket authenticates.
      window.__reconnected = false;
      window.game.socket.on('connect', () => { window.__reconnected = true; });
      window.__droppedSocket = window.game.socket.ws;
      window.__droppedSocket.close();
    });

    // A new socket replaces the dropped one and authenticates again.
    await expect.poll(() => page.evaluate(() => {
      const socket = window.game.socket;
      return window.__reconnected
        && socket.ws !== window.__droppedSocket
        && socket.ws?.readyState === WebSocket.OPEN;
    }), { timeout: 20000 }).toBe(true);

    await waitForWorldMapReady(page);
  });
});
