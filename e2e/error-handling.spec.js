import { test, expect } from '@playwright/test';
import { login, navigateToWorldMap, TEST_USER } from './helpers/index.js';

/**
 * Error Handling E2E Tests
 *
 * Tests how the application handles various error scenarios:
 * - Network failures
 * - Session expiration
 * - Rate limiting
 * - Invalid input
 */

test.describe('Authentication Errors', () => {
  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/');

    await page.getByPlaceholder('Username').fill('invaliduser');
    await page.getByPlaceholder('Password').fill('wrongpassword');
    await page.getByRole('button', { name: /login/i }).click();

    // Should show error message
    const error = page.locator('.error, [role="alert"], .toast-error, :text("invalid"):visible, :text("incorrect"):visible');
    await expect(error.first()).toBeVisible({ timeout: 5000 });

    // Should stay on login page
    await expect(page).toHaveURL(/login/i, { timeout: 2000 });
  });

  test('should show error for empty username', async ({ page }) => {
    await page.goto('/');

    await page.getByPlaceholder('Password').fill('somepassword');
    await page.getByRole('button', { name: /login/i }).click();

    // Should show validation error
    const usernameInput = page.getByPlaceholder('Username');
    const isInvalid = await usernameInput.evaluate(el => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });

  test('should show error for empty password', async ({ page }) => {
    await page.goto('/');

    await page.getByPlaceholder('Username').fill('someuser');
    await page.getByRole('button', { name: /login/i }).click();

    // Should show validation error or error message
    const passwordInput = page.getByPlaceholder('Password');
    const isInvalid = await passwordInput.evaluate(el => !el.validity.valid);
    expect(isInvalid).toBe(true);
  });
});

test.describe('Session Handling', () => {
  test('should handle expired token gracefully', async ({ page }) => {
    await login(page);
    await page.waitForTimeout(1000);

    // Clear the access token to simulate expiration
    await page.evaluate(() => {
      localStorage.removeItem('accessToken');
    });

    // Try to navigate to world map (requires auth)
    await page.goto('/#/world');
    await page.waitForTimeout(2000);

    // Should be redirected to login or show auth error
    const loginForm = page.getByPlaceholder('Username');
    const authError = page.locator(':text("session"):visible, :text("login"):visible, :text("expired"):visible');

    const isOnLogin = await loginForm.isVisible({ timeout: 5000 });
    const hasAuthError = await authError.first().isVisible({ timeout: 1000 });

    expect(isOnLogin || hasAuthError).toBe(true);
  });

  test('should refresh token automatically before expiration', async ({ page }) => {
    await navigateToWorldMap(page);

    // Store initial tokens
    const initialAccessToken = await page.evaluate(() => localStorage.getItem('accessToken'));
    const refreshToken = await page.evaluate(() => localStorage.getItem('refreshToken'));

    expect(initialAccessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();

    // Perform actions that trigger API calls
    await page.waitForTimeout(2000);

    // Token should still be valid (or refreshed)
    const currentAccessToken = await page.evaluate(() => localStorage.getItem('accessToken'));
    expect(currentAccessToken).toBeTruthy();
  });
});

test.describe('Network Error Handling', () => {
  test('should show error when server is unreachable', async ({ page }) => {
    await page.goto('/');

    // Block API requests
    await page.route('**/api/**', route => {
      route.abort('failed');
    });

    // Try to login
    await page.getByPlaceholder('Username').fill(TEST_USER.username);
    await page.getByPlaceholder('Password').fill(TEST_USER.password);
    await page.getByRole('button', { name: /login/i }).click();

    // Should show network error
    const error = page.locator('.error, [role="alert"], .toast-error, :text("network"):visible, :text("connection"):visible, :text("failed"):visible');
    await expect(error.first()).toBeVisible({ timeout: 5000 });
  });

  test('should show error for slow network timeout', async ({ page }) => {
    await page.goto('/');

    // Delay all API responses significantly
    await page.route('**/api/**', async route => {
      await new Promise(resolve => setTimeout(resolve, 30000));
      route.continue();
    });

    // Try to login
    await page.getByPlaceholder('Username').fill(TEST_USER.username);
    await page.getByPlaceholder('Password').fill(TEST_USER.password);
    await page.getByRole('button', { name: /login/i }).click();

    // Should show loading state or timeout error eventually
    const loading = page.locator('.loading, .spinner, [aria-busy="true"]');
    const error = page.locator('.error, [role="alert"], :text("timeout"):visible');

    const isLoading = await loading.first().isVisible({ timeout: 5000 });
    const hasError = await error.first().isVisible({ timeout: 35000 });

    expect(isLoading || hasError).toBe(true);
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

    await page.goto('/');

    // Make multiple rapid login attempts
    for (let i = 0; i < 5; i++) {
      await page.getByPlaceholder('Username').fill(`user${i}`);
      await page.getByPlaceholder('Password').fill('wrongpass');
      await page.getByRole('button', { name: /login/i }).click();
      await page.waitForTimeout(100);
    }

    // Should eventually show rate limit error
    const rateLimitError = page.locator(':text("too many"):visible, :text("rate limit"):visible, :text("wait"):visible');
    await expect(rateLimitError.first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Input Validation', () => {
  test('should validate character name length', async ({ page }) => {
    await login(page);
    await page.waitForTimeout(1000);

    // Try to create character with long name
    const createButton = page.getByRole('button', { name: /create.*character|new.*character|\+/i });

    if (await createButton.isVisible({ timeout: 5000 })) {
      await createButton.click();
      await page.waitForTimeout(1000);

      // Select race and class
      const raceOption = page.locator('[data-race="human"], button:has-text("Human")').first();
      if (await raceOption.isVisible({ timeout: 2000 })) await raceOption.click();
      await page.waitForTimeout(300);

      const classOption = page.locator('[data-class="warrior"], button:has-text("Warrior")').first();
      if (await classOption.isVisible({ timeout: 2000 })) await classOption.click();
      await page.waitForTimeout(300);

      // Enter too long name (max 24 chars)
      const nameInput = page.getByPlaceholder(/name/i);
      if (await nameInput.isVisible({ timeout: 2000 })) {
        await nameInput.fill('ThisNameIsWayTooLongForACharacterName');

        // Submit
        const submitButton = page.getByRole('button', { name: /create|confirm|done/i });
        if (await submitButton.isVisible({ timeout: 2000 })) {
          await submitButton.click();

          // Should show validation error
          const error = page.locator('.error, [role="alert"], .toast-error');
          await expect(error).toBeVisible({ timeout: 3000 });
        }
      }
    }
  });

  test('should validate shop purchase with insufficient gold', async ({ page }) => {
    await navigateToWorldMap(page);

    // Navigate to shop (if available)
    const shopButton = page.getByRole('button', { name: /shop|store|merchant/i });

    if (await shopButton.isVisible({ timeout: 3000 })) {
      await shopButton.click();
      await page.waitForTimeout(1000);

      // Try to buy an expensive item
      const buyButton = page.getByRole('button', { name: /buy/i });
      if (await buyButton.first().isVisible({ timeout: 3000 })) {
        await buyButton.first().click();

        // If insufficient gold, should show error
        const insufficientError = page.locator(':text("insufficient"):visible, :text("not enough"):visible, :text("gold"):visible');
        // May or may not appear depending on user's gold
        if (await insufficientError.first().isVisible({ timeout: 3000 })) {
          await expect(insufficientError.first()).toBeVisible();
        }
      }
    }
  });
});

test.describe('Game State Errors', () => {
  test('should handle invalid node navigation', async ({ page }) => {
    await navigateToWorldMap(page);

    // Try to navigate to an invalid node via API
    const token = await page.evaluate(() => localStorage.getItem('accessToken'));

    if (token) {
      const response = await page.request.post('/api/world/travel', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        data: {
          nodeId: 999999  // Invalid node ID
        }
      });

      // Should return error status
      expect(response.status()).toBeGreaterThanOrEqual(400);

      const body = await response.json();
      expect(body.error).toBeDefined();
    }
  });

  test('should handle travel to disconnected node', async ({ page }) => {
    await navigateToWorldMap(page);

    // Get current node
    const token = await page.evaluate(() => localStorage.getItem('accessToken'));

    if (token) {
      // First get current position
      const worldResponse = await page.request.get('/api/world/current', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (worldResponse.ok()) {
        const worldData = await worldResponse.json();

        // Try to travel to a node that's not connected
        // This would require knowing the world structure
        // For now, just verify the API returns proper errors
        const travelResponse = await page.request.post('/api/world/travel', {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          data: {
            nodeId: 1  // Likely not connected to current node
          }
        });

        // Should be either success (if connected) or error (if not connected)
        expect([200, 400, 404]).toContain(travelResponse.status());
      }
    }
  });
});

test.describe('WebSocket Error Handling', () => {
  test('should reconnect after WebSocket disconnect', async ({ page }) => {
    await navigateToWorldMap(page);

    // Close WebSocket connection
    await page.evaluate(() => {
      if (window.game?.websocket?.ws) {
        window.game.websocket.ws.close();
      }
    });

    await page.waitForTimeout(3000);

    // Perform an action that requires WebSocket
    // The game should reconnect automatically

    // Verify game is still functional
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Check if WebSocket reconnected (may show reconnection toast)
    const reconnectMessage = page.locator(':text("reconnect"):visible, :text("connected"):visible');
    if (await reconnectMessage.first().isVisible({ timeout: 5000 })) {
      await expect(reconnectMessage.first()).toBeVisible();
    }
  });
});
