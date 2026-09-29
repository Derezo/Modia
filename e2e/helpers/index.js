/**
 * E2E Test Helpers
 *
 * Shared utilities for Playwright E2E tests.
 * Import these in your spec files to reduce boilerplate.
 */

import { expect } from '@playwright/test';

// Default test user credentials (seeded in dev database)
export const TEST_USER = {
  username: 'derezo',
  password: 'password'
};

/**
 * Generate unique credentials for a new test user
 * @returns {{ username: string, email: string, password: string }}
 */
export function generateTestCredentials() {
  const timestamp = Date.now();
  return {
    username: `e2etest_${timestamp}`,
    email: `e2etest_${timestamp}@test.com`,
    password: 'TestPassword123!'
  };
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
 * Login to the game with given credentials
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} username - Username
 * @param {string} password - Password
 */
export async function login(page, username = TEST_USER.username, password = TEST_USER.password) {
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
 * Register a new account through step 1 of the registration wizard.
 * Leaves the page on wizard step 2 (character creation); a new account's
 * first character is created by the wizard itself.
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} username - Username
 * @param {string} email - Email
 * @param {string} password - Password
 */
export async function register(page, username, email, password) {
  await openRegistrationWizard(page);

  await page.locator('#regwiz-username').fill(username);
  await page.locator('#regwiz-email').fill(email);
  await page.locator('#regwiz-password').fill(password);
  await page.locator('#regwiz-confirm').fill(password);
  await page.locator('#regwiz-next').click();

  await expect(page.locator('.regwiz-title')).toContainText(/create.*hero/i, { timeout: 10000 });
}

/**
 * Select a character from the character select screen
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {number} index - Character index (0-based)
 */
export async function selectCharacter(page, index = 0) {
  await page.waitForTimeout(1000);

  const characterCards = page.locator('.character-card, [data-character-id]');

  // Wait for characters to load
  if (await characterCards.first().isVisible({ timeout: 5000 })) {
    // Select the character at the given index
    const cards = await characterCards.all();
    if (cards.length > index) {
      await cards[index].click();

      // Click play/select button
      const playButton = page.getByRole('button', { name: /play|select|enter/i });
      if (await playButton.isVisible({ timeout: 2000 })) {
        await playButton.click();
      }
    }
  }
}

/**
 * Navigate to the world map (login + character select)
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string} username - Username
 * @param {string} password - Password
 */
export async function navigateToWorldMap(page, username = TEST_USER.username, password = TEST_USER.password) {
  await login(page, username, password);
  await selectCharacter(page, 0);

  // Wait for world map to load
  await page.waitForURL(/world/i, { timeout: 15000 });

  // Verify canvas is rendered
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();

  // Wait for HUD to indicate full load
  const profileDropdown = page.locator('.profile-dropdown, [data-hud="profile"]');
  await expect(profileDropdown).toBeVisible({ timeout: 5000 });
}

/**
 * Initiate a battle from the world map
 * Returns true if battle was started successfully
 * @param {import('@playwright/test').Page} page - Playwright page
 * @returns {Promise<boolean>}
 */
export async function startBattle(page) {
  await page.waitForTimeout(2000);

  // Look for a battle/fight button
  const battleButton = page.getByRole('button', { name: /fight|battle|engage/i });

  if (await battleButton.isVisible({ timeout: 3000 })) {
    await battleButton.click();
    await page.waitForTimeout(2000);

    // Click start battle in formation scene
    const startBattleBtn = page.getByRole('button', { name: /start.*battle|begin.*battle|fight/i });
    if (await startBattleBtn.isVisible({ timeout: 5000 })) {
      await startBattleBtn.click();
      await page.waitForTimeout(4000); // Wait for intro animation
      return true;
    }
  }

  return false;
}

/**
 * Enter a battle (login + world map + start battle)
 * @param {import('@playwright/test').Page} page - Playwright page
 * @returns {Promise<boolean>}
 */
export async function enterBattle(page) {
  await navigateToWorldMap(page);
  return await startBattle(page);
}

/**
 * Wait for the battle scene to be fully loaded
 * @param {import('@playwright/test').Page} page - Playwright page
 */
export async function waitForBattleLoaded(page) {
  const battleUI = page.locator('#battle-ui, [data-scene="battle"]');
  await expect(battleUI).toBeVisible({ timeout: 10000 });

  // Wait for turn order panel
  const turnOrderPanel = page.locator('#turn-order-container, .turn-order-panel');
  await expect(turnOrderPanel).toBeVisible({ timeout: 5000 });
}

/**
 * Execute a battle action by clicking the action button
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {'attack'|'skill'|'item'|'wait'|'move'} action - Action type
 */
export async function clickBattleAction(page, action) {
  // Open action menu by clicking canvas
  const canvas = page.locator('canvas');
  await canvas.click({ position: { x: 400, y: 300 } });
  await page.waitForTimeout(500);

  const actionSelectors = {
    attack: '[data-action="attack"], .attack-action, button:has-text("Attack")',
    skill: '[data-action="skill"], .skill-action, button:has-text("Skill")',
    item: '[data-action="item"], .item-action, button:has-text("Item")',
    wait: 'button:has-text("Wait"), button:has-text("End Turn"), button:has-text("Pass")',
    move: '[data-action="move"], .move-action, button:has-text("Move")'
  };

  const actionButton = page.locator(actionSelectors[action]);
  if (await actionButton.isVisible({ timeout: 2000 })) {
    await actionButton.click();
  }
}

/**
 * Win a battle using the debug endpoint (for testing purposes)
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {number} battleId - Battle ID
 */
export async function debugWinBattle(page, battleId) {
  // Get auth token from localStorage
  const token = await page.evaluate(() => localStorage.getItem('accessToken'));

  if (!token || !battleId) {
    console.warn('Cannot use debug win - missing token or battleId');
    return false;
  }

  // Call debug endpoint
  const response = await page.request.post(`/api/debug/win-battle/${battleId}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  return response.ok();
}

/**
 * Wait for a toast/notification message
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {string|RegExp} text - Text to match
 * @param {number} timeout - Timeout in ms
 */
export async function waitForToast(page, text, timeout = 5000) {
  const toast = page.locator('.toast, .notification, [role="alert"]');
  await expect(toast.filter({ hasText: text })).toBeVisible({ timeout });
}

/**
 * Get the current gold amount from the HUD
 * @param {import('@playwright/test').Page} page - Playwright page
 * @returns {Promise<number|null>}
 */
export async function getCurrentGold(page) {
  const goldDisplay = page.locator('.gold-display, [data-gold]');
  if (await goldDisplay.isVisible({ timeout: 2000 })) {
    const text = await goldDisplay.textContent();
    const match = text?.match(/[\d,]+/);
    if (match) {
      return parseInt(match[0].replace(/,/g, ''), 10);
    }
  }
  return null;
}

/**
 * Open the menu/settings panel
 * @param {import('@playwright/test').Page} page - Playwright page
 */
export async function openMenu(page) {
  const menuButton = page.getByRole('button', { name: /menu|settings|options/i });
  if (await menuButton.isVisible({ timeout: 2000 })) {
    await menuButton.click();
  }
}

/**
 * Close any open modal
 * @param {import('@playwright/test').Page} page - Playwright page
 */
export async function closeModal(page) {
  // Try pressing Escape first
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // If modal still visible, try clicking close button
  const closeButton = page.locator('.modal-close, [data-close], button:has-text("Close")');
  if (await closeButton.isVisible({ timeout: 500 })) {
    await closeButton.click();
  }
}

/**
 * Create a new character
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {Object} options - Character options
 * @param {string} options.name - Character name
 * @param {string} options.race - Race (human, elf, dwarf, orc, vampire)
 * @param {string} options.class - Class (warrior, wizard, monk, chemist)
 */
export async function createCharacter(page, { name, race = 'human', characterClass = 'warrior' }) {
  // Navigate to character creation
  const createButton = page.getByRole('button', { name: /create.*character|new.*character/i });
  if (await createButton.isVisible({ timeout: 2000 })) {
    await createButton.click();
  }

  await page.waitForTimeout(1000);

  // Fill name
  const nameInput = page.getByPlaceholder(/name/i);
  if (await nameInput.isVisible({ timeout: 2000 })) {
    await nameInput.fill(name);
  }

  // Select race (look for race buttons or dropdown)
  const raceButton = page.locator(`[data-race="${race}"], button:has-text("${race}")`);
  if (await raceButton.isVisible({ timeout: 2000 })) {
    await raceButton.click();
  }

  // Select class
  const classButton = page.locator(`[data-class="${characterClass}"], button:has-text("${characterClass}")`);
  if (await classButton.isVisible({ timeout: 2000 })) {
    await classButton.click();
  }

  // Submit
  const submitButton = page.getByRole('button', { name: /create|confirm|done/i });
  if (await submitButton.isVisible({ timeout: 2000 })) {
    await submitButton.click();
  }

  // Wait for character to be created
  await page.waitForTimeout(2000);
}

/**
 * Navigate to a specific scene
 * @param {import('@playwright/test').Page} page - Playwright page
 * @param {'worldmap'|'shop'|'tavern'|'formation'|'settings'} scene - Scene name
 */
export async function navigateToScene(page, scene) {
  const sceneButtons = {
    worldmap: /world|map|explore/i,
    shop: /shop|store|merchant/i,
    tavern: /tavern|rest/i,
    formation: /formation|party/i,
    settings: /settings|options|menu/i
  };

  const button = page.getByRole('button', { name: sceneButtons[scene] });
  if (await button.isVisible({ timeout: 3000 })) {
    await button.click();
    await page.waitForTimeout(1000);
  }
}
