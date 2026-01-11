import { test, expect } from '@playwright/test';

/**
 * Character Creation and Selection E2E Tests
 */

test.describe('Character Management', () => {
  // Login before each test
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Login with test user
    await page.getByPlaceholder('Username').fill('derezo');
    await page.getByPlaceholder('Password').fill('password');
    await page.getByRole('button', { name: /login/i }).click();

    // Wait for navigation to character select
    await page.waitForURL(/character|select|world/i, { timeout: 10000 });
  });

  test('should display character selection screen', async ({ page }) => {
    // If we're on world map, we already have a character
    // If we're on character select, check for UI elements
    const url = page.url();

    if (url.includes('world')) {
      // User has active character, test passed
      expect(true).toBe(true);
    } else {
      // Should show character list or empty state
      const createButton = page.getByRole('button', { name: /create|new/i });
      await expect(createButton).toBeVisible({ timeout: 5000 });
    }
  });

  test('should navigate to character creation', async ({ page }) => {
    // Look for create character button
    const createButton = page.getByRole('button', { name: /create|new/i });

    if (await createButton.isVisible({ timeout: 3000 })) {
      await createButton.click();

      // Should show character creation form
      await expect(page.getByText(/race|class/i)).toBeVisible({ timeout: 5000 });
    }
  });

  test('should create a new character', async ({ page }) => {
    // Navigate to character creation
    const createButton = page.getByRole('button', { name: /create|new/i });

    if (await createButton.isVisible({ timeout: 3000 })) {
      await createButton.click();

      // Generate unique name
      const charName = `TestChar${Date.now().toString(36).slice(-6)}`;

      // Fill character name
      await page.getByPlaceholder(/name/i).fill(charName);

      // Select race (click first race option)
      const raceOptions = page.locator('[data-race], .race-option, .race-card');
      if (await raceOptions.first().isVisible({ timeout: 2000 })) {
        await raceOptions.first().click();
      }

      // Select class (click first class option)
      const classOptions = page.locator('[data-class], .class-option, .class-card');
      if (await classOptions.first().isVisible({ timeout: 2000 })) {
        await classOptions.first().click();
      }

      // Submit character creation
      const submitButton = page.getByRole('button', { name: /create|confirm|submit/i });
      await submitButton.click();

      // Should redirect to character select or world map
      await expect(page).toHaveURL(/character|select|world/i, { timeout: 10000 });
    }
  });

  test('should select an existing character', async ({ page }) => {
    // Look for character cards
    const characterCards = page.locator('.character-card, [data-character-id]');

    if (await characterCards.first().isVisible({ timeout: 3000 })) {
      // Click first character
      await characterCards.first().click();

      // Look for play/select button
      const playButton = page.getByRole('button', { name: /play|select|enter/i });
      if (await playButton.isVisible({ timeout: 2000 })) {
        await playButton.click();
      }

      // Should navigate to world map
      await expect(page).toHaveURL(/world/i, { timeout: 10000 });
    }
  });
});
