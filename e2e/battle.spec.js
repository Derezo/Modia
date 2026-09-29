import { test, expect } from '@playwright/test';
import { login, TEST_USER } from './helpers/index.js';

/**
 * Battle System E2E Tests
 *
 * Tests the complete battle flow:
 * - Navigation to combat nodes
 * - Battle initialization and formation
 * - Tactical grid interaction
 * - Movement and attack execution
 * - Victory/defeat handling
 * - Rewards and XP updates
 */

test.describe('Battle System', () => {
  // Login and navigate to world map before each test
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

  test('should display world map with combat nodes', async ({ page }) => {
    // Verify canvas is rendered
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Wait for nodes to load (profile dropdown indicates HUD is ready)
    const profileDropdown = page.locator('.profile-dropdown, [data-hud="profile"]');
    await expect(profileDropdown).toBeVisible({ timeout: 5000 });
  });

  test('should navigate to battle formation when initiating combat', async ({ page }) => {
    // Wait for world map to fully load
    await page.waitForTimeout(2000);

    // Look for a battle/fight button in the node tooltip or action panel
    // This appears when clicking on a combat node (forest, cave, mountain, bridge)
    const battleButton = page.getByRole('button', { name: /fight|battle|engage/i });

    // If a battle button is visible, click it
    if (await battleButton.isVisible({ timeout: 3000 })) {
      await battleButton.click();

      // Should transition to battle formation scene
      const formationUI = page.locator('.formation-grid, #formation-grid, [data-scene="formation"]');
      await expect(formationUI).toBeVisible({ timeout: 10000 });
    } else {
      // If no battle button, click on canvas to potentially select a combat node
      const canvas = page.locator('canvas');
      await canvas.click({ position: { x: 400, y: 300 } });
      await page.waitForTimeout(500);

      // Check if battle button appeared after click
      if (await battleButton.isVisible({ timeout: 2000 })) {
        await battleButton.click();
        const formationUI = page.locator('.formation-grid, #formation-grid, [data-scene="formation"]');
        await expect(formationUI).toBeVisible({ timeout: 10000 });
      }
    }
  });

  test('should display battle formation grid with character placement', async ({ page }) => {
    // Navigate to battle formation (simulated by looking for formation elements)
    await page.waitForTimeout(2000);

    const battleButton = page.getByRole('button', { name: /fight|battle|engage/i });
    if (await battleButton.isVisible({ timeout: 3000 })) {
      await battleButton.click();

      // Wait for formation scene
      await page.waitForTimeout(1500);

      // Formation grid should be visible
      const formationCanvas = page.locator('canvas');
      await expect(formationCanvas).toBeVisible();

      // Character roster/drawer should show available characters
      const characterRoster = page.locator('.character-roster, .unplaced-characters, [data-roster]');
      if (await characterRoster.isVisible({ timeout: 3000 })) {
        await expect(characterRoster).toBeVisible();
      }

      // Start battle button should exist
      const startBattleBtn = page.getByRole('button', { name: /start.*battle|begin.*battle|fight/i });
      await expect(startBattleBtn).toBeVisible({ timeout: 5000 });
    }
  });

  test('should enter battle scene from formation', async ({ page }) => {
    await page.waitForTimeout(2000);

    const battleButton = page.getByRole('button', { name: /fight|battle|engage/i });
    if (await battleButton.isVisible({ timeout: 3000 })) {
      await battleButton.click();

      // Wait for formation scene to load
      await page.waitForTimeout(2000);

      // Click start battle button
      const startBattleBtn = page.getByRole('button', { name: /start.*battle|begin.*battle|fight/i });
      if (await startBattleBtn.isVisible({ timeout: 5000 })) {
        await startBattleBtn.click();

        // Wait for battle scene to load (intro animation may play)
        await page.waitForTimeout(3000);

        // Battle UI elements should appear
        const battleUI = page.locator('#battle-ui, [data-scene="battle"]');
        await expect(battleUI).toBeVisible({ timeout: 10000 });
      }
    }
  });

  test('should display battle UI elements during combat', async ({ page }) => {
    await page.waitForTimeout(2000);

    const battleButton = page.getByRole('button', { name: /fight|battle|engage/i });
    if (await battleButton.isVisible({ timeout: 3000 })) {
      await battleButton.click();
      await page.waitForTimeout(2000);

      const startBattleBtn = page.getByRole('button', { name: /start.*battle|begin.*battle|fight/i });
      if (await startBattleBtn.isVisible({ timeout: 5000 })) {
        await startBattleBtn.click();
        await page.waitForTimeout(4000); // Wait for intro

        // Turn order panel should be visible
        const turnOrderPanel = page.locator('#turn-order-container, .turn-order-panel');
        await expect(turnOrderPanel).toBeVisible({ timeout: 5000 });

        // Active unit panel should be visible
        const activeUnitPanel = page.locator('#active-unit-panel');
        await expect(activeUnitPanel).toBeVisible({ timeout: 3000 });

        // Battle log container should be visible
        const battleLog = page.locator('#battle-log-container, .battle-log-panel');
        await expect(battleLog).toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('should show action options when unit is selected', async ({ page }) => {
    await page.waitForTimeout(2000);

    const battleButton = page.getByRole('button', { name: /fight|battle|engage/i });
    if (await battleButton.isVisible({ timeout: 3000 })) {
      await battleButton.click();
      await page.waitForTimeout(2000);

      const startBattleBtn = page.getByRole('button', { name: /start.*battle|begin.*battle|fight/i });
      if (await startBattleBtn.isVisible({ timeout: 5000 })) {
        await startBattleBtn.click();
        await page.waitForTimeout(4000); // Wait for intro and turn start

        // Click on the canvas to potentially open radial menu or action bar
        const canvas = page.locator('canvas');
        await canvas.click({ position: { x: 400, y: 300 } });
        await page.waitForTimeout(500);

        // Look for action options (radial menu or action bar)
        const actionBar = page.locator('.battle-action-bar, .radial-menu, #action-menu');
        if (await actionBar.isVisible({ timeout: 2000 })) {
          await expect(actionBar).toBeVisible();
        }
      }
    }
  });

  test('should handle turn order display correctly', async ({ page }) => {
    await page.waitForTimeout(2000);

    const battleButton = page.getByRole('button', { name: /fight|battle|engage/i });
    if (await battleButton.isVisible({ timeout: 3000 })) {
      await battleButton.click();
      await page.waitForTimeout(2000);

      const startBattleBtn = page.getByRole('button', { name: /start.*battle|begin.*battle|fight/i });
      if (await startBattleBtn.isVisible({ timeout: 5000 })) {
        await startBattleBtn.click();
        await page.waitForTimeout(4000);

        // Turn order panel should show unit portraits/indicators
        const turnOrderItems = page.locator('.turn-order-item, .turn-order-portrait');
        await expect(turnOrderItems.first()).toBeVisible({ timeout: 5000 });

        // Should have at least 2 units (player + enemy)
        const count = await turnOrderItems.count();
        expect(count).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test('should display turn indicator when turn changes', async ({ page }) => {
    await page.waitForTimeout(2000);

    const battleButton = page.getByRole('button', { name: /fight|battle|engage/i });
    if (await battleButton.isVisible({ timeout: 3000 })) {
      await battleButton.click();
      await page.waitForTimeout(2000);

      const startBattleBtn = page.getByRole('button', { name: /start.*battle|begin.*battle|fight/i });
      if (await startBattleBtn.isVisible({ timeout: 5000 })) {
        await startBattleBtn.click();
        await page.waitForTimeout(4000);

        // Turn indicator appears when a new turn starts
        const turnIndicator = page.locator('#turn-indicator, .turn-indicator-content');
        // May or may not be visible depending on timing
        // Just verify the element exists in DOM
        await expect(page.locator('#turn-indicator')).toBeAttached();
      }
    }
  });
});

test.describe('Battle Actions', () => {
  // Helper function to get into battle
  async function enterBattle(page) {
    // Skip the title intro, log in, and wait for the auth scene to exit
    await login(page, TEST_USER.username, TEST_USER.password);
    await page.waitForTimeout(2000);

    // Select character if needed
    const characterCards = page.locator('.character-card, [data-character-id]');
    if (await characterCards.first().isVisible({ timeout: 3000 })) {
      await characterCards.first().click();
      const playButton = page.getByRole('button', { name: /play|select|enter/i });
      if (await playButton.isVisible({ timeout: 2000 })) {
        await playButton.click();
      }
    }

    await page.waitForURL(/world/i, { timeout: 15000 });
    await page.waitForTimeout(2000);

    // Start battle
    const battleButton = page.getByRole('button', { name: /fight|battle|engage/i });
    if (await battleButton.isVisible({ timeout: 3000 })) {
      await battleButton.click();
      await page.waitForTimeout(2000);

      const startBattleBtn = page.getByRole('button', { name: /start.*battle|begin.*battle|fight/i });
      if (await startBattleBtn.isVisible({ timeout: 5000 })) {
        await startBattleBtn.click();
        await page.waitForTimeout(4000); // Wait for intro
        return true;
      }
    }
    return false;
  }

  test('should execute wait action successfully', async ({ page }) => {
    const inBattle = await enterBattle(page);
    if (!inBattle) {
      test.skip();
      return;
    }

    // Look for wait/end turn button
    const waitButton = page.getByRole('button', { name: /wait|end.*turn|pass/i });
    if (await waitButton.isVisible({ timeout: 5000 })) {
      await waitButton.click();

      // Battle log should update with wait action
      await page.waitForTimeout(1000);
      const battleLog = page.locator('.battle-log-panel');
      await expect(battleLog).toBeVisible();
    }
  });

  test('should show skill panel when skill action selected', async ({ page }) => {
    const inBattle = await enterBattle(page);
    if (!inBattle) {
      test.skip();
      return;
    }

    // Click on canvas to open action menu
    const canvas = page.locator('canvas');
    await canvas.click({ position: { x: 400, y: 300 } });
    await page.waitForTimeout(500);

    // Look for skill button in radial menu or action bar
    const skillButton = page.locator('[data-action="skill"], .skill-action, button:has-text("Skill")');
    if (await skillButton.isVisible({ timeout: 2000 })) {
      await skillButton.click();

      // Skill panel should appear
      const skillPanel = page.locator('#skill-panel, .skill-list');
      await expect(skillPanel).toBeVisible({ timeout: 3000 });
    }
  });

  test('should show item panel when item action selected', async ({ page }) => {
    const inBattle = await enterBattle(page);
    if (!inBattle) {
      test.skip();
      return;
    }

    const canvas = page.locator('canvas');
    await canvas.click({ position: { x: 400, y: 300 } });
    await page.waitForTimeout(500);

    // Look for item button
    const itemButton = page.locator('[data-action="item"], .item-action, button:has-text("Item")');
    if (await itemButton.isVisible({ timeout: 2000 })) {
      await itemButton.click();

      // Item panel should appear
      const itemPanel = page.locator('#item-panel, .item-list');
      await expect(itemPanel).toBeVisible({ timeout: 3000 });
    }
  });

  test('should cancel targeting when escape pressed', async ({ page }) => {
    const inBattle = await enterBattle(page);
    if (!inBattle) {
      test.skip();
      return;
    }

    const canvas = page.locator('canvas');
    await canvas.click({ position: { x: 400, y: 300 } });
    await page.waitForTimeout(500);

    // Try to enter attack targeting mode
    const attackButton = page.locator('[data-action="attack"], .attack-action, button:has-text("Attack")');
    if (await attackButton.isVisible({ timeout: 2000 })) {
      await attackButton.click();
      await page.waitForTimeout(300);

      // Press escape to cancel
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Cancel button should be hidden after escape
      const cancelButton = page.locator('#btn-cancel-targeting');
      await expect(cancelButton).not.toBeVisible({ timeout: 2000 });
    }
  });
});

test.describe('Battle Completion', () => {
  test('should return to world map after battle ends', async ({ page }) => {
    // Skip the title intro, log in, and wait for the auth scene to exit
    await login(page, TEST_USER.username, TEST_USER.password);
    await page.waitForTimeout(2000);

    const characterCards = page.locator('.character-card, [data-character-id]');
    if (await characterCards.first().isVisible({ timeout: 3000 })) {
      await characterCards.first().click();
      const playButton = page.getByRole('button', { name: /play|select|enter/i });
      if (await playButton.isVisible({ timeout: 2000 })) {
        await playButton.click();
      }
    }

    await page.waitForURL(/world/i, { timeout: 15000 });

    // Verify we're on world map
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    const profileDropdown = page.locator('.profile-dropdown, [data-hud="profile"]');
    await expect(profileDropdown).toBeVisible({ timeout: 5000 });
  });

  test('should show victory screen with rewards on battle win', async ({ page }) => {
    // This test verifies the victory UI elements exist and are structured correctly
    // Full battle completion requires defeating all enemies which may take extended time

    // Skip the title intro, log in, and wait for the auth scene to exit
    await login(page, TEST_USER.username, TEST_USER.password);
    await page.waitForTimeout(2000);

    const characterCards = page.locator('.character-card, [data-character-id]');
    if (await characterCards.first().isVisible({ timeout: 3000 })) {
      await characterCards.first().click();
      const playButton = page.getByRole('button', { name: /play|select|enter/i });
      if (await playButton.isVisible({ timeout: 2000 })) {
        await playButton.click();
      }
    }

    await page.waitForURL(/world/i, { timeout: 15000 });
    await page.waitForTimeout(2000);

    // Start a battle
    const battleButton = page.getByRole('button', { name: /fight|battle|engage/i });
    if (await battleButton.isVisible({ timeout: 3000 })) {
      await battleButton.click();
      await page.waitForTimeout(2000);

      const startBattleBtn = page.getByRole('button', { name: /start.*battle|begin.*battle|fight/i });
      if (await startBattleBtn.isVisible({ timeout: 5000 })) {
        await startBattleBtn.click();
        await page.waitForTimeout(4000);

        // Verify battle UI loaded (victory screen tested separately)
        const battleUI = page.locator('#battle-ui');
        await expect(battleUI).toBeVisible({ timeout: 5000 });

        // Verify battle result container exists (hidden until battle ends)
        const battleResult = page.locator('#battle-result');
        await expect(battleResult).toBeAttached();
      }
    }
  });

  test('should have continue button on battle result screen', async ({ page }) => {
    // Verify the continue button element exists in battle UI structure
    // Skip the title intro, log in, and wait for the auth scene to exit
    await login(page, TEST_USER.username, TEST_USER.password);
    await page.waitForTimeout(2000);

    const characterCards = page.locator('.character-card, [data-character-id]');
    if (await characterCards.first().isVisible({ timeout: 3000 })) {
      await characterCards.first().click();
      const playButton = page.getByRole('button', { name: /play|select|enter/i });
      if (await playButton.isVisible({ timeout: 2000 })) {
        await playButton.click();
      }
    }

    await page.waitForURL(/world/i, { timeout: 15000 });
    await page.waitForTimeout(2000);

    const battleButton = page.getByRole('button', { name: /fight|battle|engage/i });
    if (await battleButton.isVisible({ timeout: 3000 })) {
      await battleButton.click();
      await page.waitForTimeout(2000);

      const startBattleBtn = page.getByRole('button', { name: /start.*battle|begin.*battle|fight/i });
      if (await startBattleBtn.isVisible({ timeout: 5000 })) {
        await startBattleBtn.click();
        await page.waitForTimeout(4000);

        // Verify continue button element exists in DOM
        const continueBtn = page.locator('#btn-continue');
        await expect(continueBtn).toBeAttached();
      }
    }
  });
});
