/**
 * E2E Test Helpers
 *
 * Shared utilities for Playwright E2E tests. Auth-form helpers live here;
 * game-state helpers (API-provisioned players, scene waits, node actions)
 * live in ./game.js and are re-exported.
 */

import { expect } from '@playwright/test';
import { uniqueCredentials, waitForWorldMapReady } from './game.js';

export * from './game.js';

/**
 * Generate unique credentials for a new test user.
 * The username carries the e2etest_ prefix that globalTeardown cleans up.
 * @returns {{ username: string, email: string, password: string }}
 */
export function generateTestCredentials() {
  return uniqueCredentials();
}

/**
 * Stable selectors for the DOM auth form rendered by AuthScene and the
 * registration wizard it opens. The form lives in the UI overlay above the
 * canvas; its placeholders change with the login/register mode, so match ids.
 */
export const AUTH_SELECTORS = Object.freeze({
  form: '#auth-form',
  username: '#username',
  email: '#email',
  password: '#password',
  confirmPassword: '#confirm-password',
  submit: '#auth-btn',
  modeToggle: '#mode-toggle',
  error: '#auth-error',
  wizard: '.regwiz-container'
});

/**
 * Open the game and get past the title intro cinematic to the login form.
 * TitleIntroScene skips on a canvas click or Space/Enter/Escape; AuthScene
 * then fades its DOM form in once its transition and font are ready.
 * @param {import('@playwright/test').Page} page - Playwright page
 */
export async function gotoAuth(page) {
  await page.goto('/');
  const form = page.locator(AUTH_SELECTORS.form);
  await expect(async () => {
    if (!(await form.isVisible())) {
      await page.keyboard.press('Escape');
    }
    await expect(form).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20000 });
  // AuthScene moves focus to #username on a timer after the fade starts.
  // Wait for that to happen: fill() types into the focused element, so a
  // late focus change would redirect a password fill into the username box.
  await expect(page.locator(AUTH_SELECTORS.username)).toBeFocused({ timeout: 5000 });
}

/**
 * Log in through the auth form.
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} username - Username
 * @param {string} password - Password
 */
export async function login(page, username, password) {
  await gotoAuth(page);

  await page.locator(AUTH_SELECTORS.username).fill(username);
  await page.locator(AUTH_SELECTORS.password).fill(password);
  await page.locator(AUTH_SELECTORS.submit).click();

  // The game is a single-page canvas app: a successful login leaves the
  // auth scene, which removes the form from the overlay.
  await expect(page.locator(AUTH_SELECTORS.form)).toHaveCount(0, { timeout: 15000 });
}

/**
 * Open the registration wizard from the login form.
 * @param {import('@playwright/test').Page} page - Playwright page
 */
export async function openRegistrationWizard(page) {
  await gotoAuth(page);
  await page.locator(AUTH_SELECTORS.modeToggle).click();
  await expect(page.locator(AUTH_SELECTORS.wizard)).toBeVisible({ timeout: 5000 });
}

/**
 * Log a provisioned player in and wait for the world map to finish loading.
 * An account with a character goes straight to the world map (the party
 * leader is selected automatically); there is no character-select screen.
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {{ username: string, password: string }} player - From createPlayer()
 */
export async function enterWorldMap(page, player) {
  await login(page, player.username, player.password);
  await waitForWorldMapReady(page);
}
