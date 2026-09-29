import { test, expect } from './fixtures.js';
import {
  AUTH_SELECTORS,
  createPlayer,
  generateTestCredentials,
  gotoAuth,
  login,
  waitForScene,
  waitForWorldMapReady
} from './helpers/index.js';

/**
 * Authentication E2E Tests
 *
 * Tests the login form and the entry into the registration wizard.
 * The full wizard flow is covered by registration-wizard.spec.js.
 */

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAuth(page);
  });

  test('should display login scene on initial load', async ({ page }) => {
    await expect(page.locator(AUTH_SELECTORS.username)).toBeVisible();
    await expect(page.locator(AUTH_SELECTORS.password)).toBeVisible();
    await expect(page.locator(AUTH_SELECTORS.submit)).toHaveText(/login/i);
    // Register-only fields stay in the DOM but are collapsed in login mode
    // (zero height, transparent, unfocusable), so check the collapse state.
    await expect(page.locator('#email-group')).toHaveClass(/\bhidden\b/);
    await expect(page.locator('#confirm-group')).toHaveClass(/\bhidden\b/);
    await expect(page.locator(AUTH_SELECTORS.email)).toHaveAttribute('tabindex', '-1');
    await expect(page.locator(AUTH_SELECTORS.confirmPassword)).toHaveAttribute('tabindex', '-1');
  });

  test('should show error for invalid credentials', async ({ page }) => {
    const { username } = generateTestCredentials();
    await page.locator(AUTH_SELECTORS.username).fill(username);
    await page.locator(AUTH_SELECTORS.password).fill('wrongpassword');

    await page.locator(AUTH_SELECTORS.submit).click();

    const error = page.locator(AUTH_SELECTORS.error);
    await expect(error).toBeVisible({ timeout: 5000 });
    await expect(error).toHaveText(/invalid|incorrect/i);
    // A failed login stays on the auth form.
    await expect(page.locator(AUTH_SELECTORS.form)).toBeVisible();
  });

  test('should navigate to registration from login', async ({ page }) => {
    await expect(page.locator(AUTH_SELECTORS.modeToggle)).toHaveText(/register/i);
    await page.locator(AUTH_SELECTORS.modeToggle).click();

    // Register mode replaces the login form with the registration wizard.
    await expect(page.locator(AUTH_SELECTORS.wizard)).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.regwiz-title')).toContainText(/create.*account/i);
    await expect(page.locator('#regwiz-email')).toBeVisible();
    await expect(page.locator('#regwiz-confirm')).toBeVisible();
    await expect(page.locator(AUTH_SELECTORS.form)).toHaveCount(0);
  });

  test('should register a new user', async ({ page }) => {
    await page.locator(AUTH_SELECTORS.modeToggle).click();
    await expect(page.locator(AUTH_SELECTORS.wizard)).toBeVisible({ timeout: 5000 });

    const { username, email, password } = generateTestCredentials();
    await page.locator('#regwiz-username').fill(username);
    await page.locator('#regwiz-email').fill(email);
    await page.locator('#regwiz-password').fill(password);
    await page.locator('#regwiz-confirm').fill(password);

    await page.locator('#regwiz-next').click();

    // Step 1 accepted: the wizard advances to hero creation.
    await expect(page.locator('.regwiz-title')).toContainText(/create.*hero/i, { timeout: 10000 });
    await expect(page.locator('.regwiz-step-indicator.active')).toContainText('2');

    // The account and its first character are created together on submit.
    await page.locator('[data-race="human"]').click();
    await page.locator('[data-class="warrior"]').click();
    await page.locator('[data-gender="male"]').click();
    const charName = `Hero${Date.now().toString(36).slice(-6)}`;
    await page.locator('#regwiz-charname').fill(charName);
    await page.locator('#regwiz-submit').click();

    await expect(page.locator('.regwiz-success-title')).toContainText(charName, { timeout: 15000 });

    // The new account can log in and, having a character, lands on the map.
    await login(page, username, password);
    await waitForScene(page, 'worldMap');
  });

  test('should login with valid credentials', async ({ page, request }) => {
    const player = await createPlayer(request);
    await login(page, player.username, player.password);

    await expect(page.locator(AUTH_SELECTORS.error)).toHaveCount(0);
    await waitForWorldMapReady(page);
    // The session is kept in sessionStorage, not localStorage.
    const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('modia_auth')));
    expect(stored.user.username).toBe(player.username);
    expect(stored.token).toBeTruthy();
    expect(stored.refreshToken).toBeTruthy();
  });
});
