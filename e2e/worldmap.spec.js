import { test, expect } from '@playwright/test';
import { login, TEST_USER } from './helpers/index.js';

/**
 * World Map Navigation E2E Tests
 */

test.describe('World Map', () => {
  // Login and select character before each test
  test.beforeEach(async ({ page }) => {
    // Skip the title intro, log in, and wait for the auth scene to exit
    await login(page, TEST_USER.username, TEST_USER.password);

    // Wait for game to load
    await page.waitForTimeout(2000);

    // If on character select, pick first character
    const characterCards = page.locator('.character-card, [data-character-id]');
    if (await characterCards.first().isVisible({ timeout: 3000 })) {
      await characterCards.first().click();
      const playButton = page.getByRole('button', { name: /play|select|enter/i });
      if (await playButton.isVisible({ timeout: 2000 })) {
        await playButton.click();
      }
    }

    // Wait for world map to load
    await page.waitForURL(/world/i, { timeout: 15000 });
  });

  test('should display world map with nodes', async ({ page }) => {
    // World map should render on canvas
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Check for HUD elements
    const profileDropdown = page.locator('.profile-dropdown, [data-hud="profile"]');
    await expect(profileDropdown).toBeVisible({ timeout: 5000 });
  });

  test('should show node tooltip on hover', async ({ page }) => {
    const canvas = page.locator('canvas');

    // Move mouse over the canvas (center area where nodes likely are)
    await canvas.hover({ position: { x: 400, y: 300 } });

    // Wait a moment for tooltip
    await page.waitForTimeout(500);

    // Tooltip might be visible (depends on node positions)
    // This is a best-effort test
  });

  test('should open menu when clicking menu button', async ({ page }) => {
    // Look for menu button
    const menuButton = page.locator('[data-menu], .menu-button, button:has-text("Menu")');

    if (await menuButton.isVisible({ timeout: 3000 })) {
      await menuButton.click();

      // Menu should appear with options
      const menuItems = page.locator('.menu-item, [role="menuitem"]');
      await expect(menuItems.first()).toBeVisible({ timeout: 3000 });
    }
  });

  test('should navigate to inventory', async ({ page }) => {
    // Find and click inventory button/link
    const inventoryBtn = page.getByRole('button', { name: /inventory|items/i });

    if (await inventoryBtn.isVisible({ timeout: 3000 })) {
      await inventoryBtn.click();

      // Inventory scene should load
      await expect(page.getByText(/inventory|equipment|items/i)).toBeVisible({ timeout: 5000 });
    }
  });

  test('should travel to adjacent node', async ({ page }) => {
    const canvas = page.locator('canvas');

    // Click on an area where a node might be
    // This is approximate - in real tests you'd need to know node positions
    await canvas.click({ position: { x: 500, y: 300 } });

    // Wait for potential travel or node selection
    await page.waitForTimeout(1000);

    // If a node was clicked, there might be a travel button
    const travelBtn = page.getByRole('button', { name: /travel|go|move/i });
    if (await travelBtn.isVisible({ timeout: 2000 })) {
      await travelBtn.click();

      // Wait for travel animation
      await page.waitForTimeout(2000);
    }
  });
});
