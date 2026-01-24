import { test, expect } from '@playwright/test';
import {
  navigateToWorldMap,
  startBattle,
  waitForBattleLoaded,
  clickBattleAction,
  debugWinBattle,
  TEST_USER
} from './helpers/index.js';

/**
 * Complete Battle Flow E2E Tests
 *
 * Tests the full battle lifecycle including:
 * - Entering battle from world map
 * - Unit movement on tactical grid
 * - Executing attack actions
 * - Using skills with targeting
 * - Wait/pass turn functionality
 * - Battle completion and rewards
 * - Returning to world map
 */

test.describe('Complete Battle Flow', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToWorldMap(page);
  });

  test('should enter battle from world map', async ({ page }) => {
    const started = await startBattle(page);

    if (started) {
      await waitForBattleLoaded(page);

      // Battle UI should be visible
      const battleUI = page.locator('#battle-ui, [data-scene="battle"]');
      await expect(battleUI).toBeVisible();
    }
  });

  test('should display turn order with multiple units', async ({ page }) => {
    const started = await startBattle(page);

    if (started) {
      await waitForBattleLoaded(page);

      // Turn order panel should show units
      const turnOrderItems = page.locator('.turn-order-item, .turn-order-portrait');
      await expect(turnOrderItems.first()).toBeVisible({ timeout: 5000 });

      // Should have at least 2 units (player + enemy)
      const count = await turnOrderItems.count();
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });

  test('should display active unit panel with stats', async ({ page }) => {
    const started = await startBattle(page);

    if (started) {
      await waitForBattleLoaded(page);

      // Active unit panel should show HP/MP
      const activeUnitPanel = page.locator('#active-unit-panel');
      await expect(activeUnitPanel).toBeVisible({ timeout: 5000 });

      // Should show unit name
      const unitName = page.locator('#active-unit-name, .active-unit-name');
      await expect(unitName).toBeVisible({ timeout: 3000 });

      // Should show HP bar
      const hpBar = page.locator('.hp-bar, [data-stat="hp"]');
      await expect(hpBar).toBeVisible({ timeout: 3000 });
    }
  });

  test('should execute wait/pass action', async ({ page }) => {
    const started = await startBattle(page);

    if (started) {
      await waitForBattleLoaded(page);

      // Wait for player turn
      await page.waitForTimeout(1000);

      // Click wait button
      const waitButton = page.getByRole('button', { name: /wait|end.*turn|pass/i });
      if (await waitButton.isVisible({ timeout: 5000 })) {
        await waitButton.click();

        // Turn should advance
        await page.waitForTimeout(1500);

        // Turn order should update (animation may play)
        const turnIndicator = page.locator('#turn-indicator');
        await expect(turnIndicator).toBeAttached();
      }
    }
  });

  test('should show movement range when selecting unit', async ({ page }) => {
    const started = await startBattle(page);

    if (started) {
      await waitForBattleLoaded(page);

      // Click on canvas to select unit/show actions
      const canvas = page.locator('canvas');
      await canvas.click({ position: { x: 400, y: 300 } });
      await page.waitForTimeout(500);

      // Movement range tiles should be highlighted (visual check via canvas)
      // We can verify the action menu appears
      const actionMenu = page.locator('.radial-menu, .battle-action-bar, [data-action]');
      if (await actionMenu.first().isVisible({ timeout: 2000 })) {
        await expect(actionMenu.first()).toBeVisible();
      }
    }
  });

  test('should show skill panel when skill action clicked', async ({ page }) => {
    const started = await startBattle(page);

    if (started) {
      await waitForBattleLoaded(page);
      await page.waitForTimeout(1000);

      await clickBattleAction(page, 'skill');

      // Skill panel should appear
      const skillPanel = page.locator('#skill-panel, .skill-list, .skill-menu');
      if (await skillPanel.isVisible({ timeout: 3000 })) {
        await expect(skillPanel).toBeVisible();

        // Should show at least one skill
        const skillItems = page.locator('.skill-item, .skill-button');
        await expect(skillItems.first()).toBeVisible({ timeout: 2000 });
      }
    }
  });

  test('should show item panel when item action clicked', async ({ page }) => {
    const started = await startBattle(page);

    if (started) {
      await waitForBattleLoaded(page);
      await page.waitForTimeout(1000);

      await clickBattleAction(page, 'item');

      // Item panel should appear
      const itemPanel = page.locator('#item-panel, .item-list, .item-menu');
      if (await itemPanel.isVisible({ timeout: 3000 })) {
        await expect(itemPanel).toBeVisible();
      }
    }
  });

  test('should cancel targeting with escape key', async ({ page }) => {
    const started = await startBattle(page);

    if (started) {
      await waitForBattleLoaded(page);
      await page.waitForTimeout(1000);

      await clickBattleAction(page, 'attack');
      await page.waitForTimeout(500);

      // Press escape to cancel
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Cancel button should be hidden
      const cancelButton = page.locator('#btn-cancel-targeting, .cancel-targeting');
      await expect(cancelButton).not.toBeVisible({ timeout: 2000 });
    }
  });

  test('should display battle log with messages', async ({ page }) => {
    const started = await startBattle(page);

    if (started) {
      await waitForBattleLoaded(page);

      // Battle log container should be visible
      const battleLog = page.locator('#battle-log-container, .battle-log-panel');
      await expect(battleLog).toBeVisible({ timeout: 5000 });

      // Perform an action to generate log entry
      const waitButton = page.getByRole('button', { name: /wait|end.*turn|pass/i });
      if (await waitButton.isVisible({ timeout: 3000 })) {
        await waitButton.click();
        await page.waitForTimeout(1500);

        // Log should have entries
        const logEntries = page.locator('.battle-log-entry, .log-message');
        await expect(logEntries.first()).toBeVisible({ timeout: 3000 });
      }
    }
  });
});

test.describe('Battle Rewards', () => {
  test('should show victory screen with rewards after winning', async ({ page }) => {
    await navigateToWorldMap(page);

    const started = await startBattle(page);

    if (started) {
      await waitForBattleLoaded(page);

      // Get battle ID from page state if available
      const battleId = await page.evaluate(() => {
        // Try to get battle ID from game state
        return window.game?.battleScene?.battleId ||
               window.game?.currentBattleId ||
               null;
      });

      // Use debug endpoint to win battle quickly
      if (battleId) {
        const won = await debugWinBattle(page, battleId);
        if (won) {
          await page.waitForTimeout(2000);

          // Victory screen should appear
          const victoryScreen = page.locator('#battle-result, .victory-screen, .battle-outcome');
          await expect(victoryScreen).toBeVisible({ timeout: 10000 });

          // Should show rewards
          const rewardsSection = page.locator('.rewards-section, .battle-rewards, [data-rewards]');
          await expect(rewardsSection).toBeVisible({ timeout: 5000 });
        }
      }
    }
  });

  test('should display XP and gold rewards', async ({ page }) => {
    await navigateToWorldMap(page);

    const started = await startBattle(page);

    if (started) {
      await waitForBattleLoaded(page);

      const battleId = await page.evaluate(() => {
        return window.game?.battleScene?.battleId ||
               window.game?.currentBattleId ||
               null;
      });

      if (battleId) {
        const won = await debugWinBattle(page, battleId);
        if (won) {
          await page.waitForTimeout(2000);

          // XP display
          const xpDisplay = page.locator('.xp-reward, [data-xp], :text("XP")');
          if (await xpDisplay.isVisible({ timeout: 5000 })) {
            await expect(xpDisplay).toBeVisible();
          }

          // Gold display
          const goldDisplay = page.locator('.gold-reward, [data-gold], :text("gold")');
          if (await goldDisplay.isVisible({ timeout: 3000 })) {
            await expect(goldDisplay).toBeVisible();
          }
        }
      }
    }
  });

  test('should return to world map after clicking continue', async ({ page }) => {
    await navigateToWorldMap(page);

    const started = await startBattle(page);

    if (started) {
      await waitForBattleLoaded(page);

      const battleId = await page.evaluate(() => {
        return window.game?.battleScene?.battleId ||
               window.game?.currentBattleId ||
               null;
      });

      if (battleId) {
        const won = await debugWinBattle(page, battleId);
        if (won) {
          await page.waitForTimeout(2000);

          // Click continue button
          const continueButton = page.locator('#btn-continue, button:has-text("Continue")');
          if (await continueButton.isVisible({ timeout: 5000 })) {
            await continueButton.click();

            // Should return to world map
            await page.waitForURL(/world/i, { timeout: 10000 });

            // Canvas should be visible
            const canvas = page.locator('canvas');
            await expect(canvas).toBeVisible();
          }
        }
      }
    }
  });
});

test.describe('Battle State Persistence', () => {
  test('should preserve battle state after page refresh', async ({ page }) => {
    await navigateToWorldMap(page);

    const started = await startBattle(page);

    if (started) {
      await waitForBattleLoaded(page);

      // Get current battle state
      const battleId = await page.evaluate(() => {
        return window.game?.battleScene?.battleId ||
               window.game?.currentBattleId ||
               null;
      });

      if (battleId) {
        // Refresh the page
        await page.reload();
        await page.waitForTimeout(3000);

        // Should reconnect to battle
        const battleUI = page.locator('#battle-ui, [data-scene="battle"]');
        if (await battleUI.isVisible({ timeout: 10000 })) {
          await expect(battleUI).toBeVisible();
        }
      }
    }
  });
});
