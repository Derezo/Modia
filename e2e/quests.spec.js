import { test, expect } from '@playwright/test';

/**
 * Quest Board E2E Tests
 * Tests the daily/weekly quest system flow
 */

test.describe('Quest Board', () => {
  // Login, select character, and navigate to world map before each test
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // Login with seeded test user
    await page.getByPlaceholder('Username').fill('derezo');
    await page.getByPlaceholder('Password').fill('password');
    await page.getByRole('button', { name: /login/i }).click();

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

  test('should open Quest Board from profile menu', async ({ page }) => {
    // Open profile dropdown
    const profileTrigger = page.locator('.profile-dropdown, .profile-trigger, [data-hud="profile"]');
    await profileTrigger.click();

    // Click Quest Board option
    const questBoardOption = page.getByText(/quest board|quests/i);
    await expect(questBoardOption).toBeVisible({ timeout: 3000 });
    await questBoardOption.click();

    // Quest Board should be visible
    const questBoard = page.locator('.quest-board-container');
    await expect(questBoard).toBeVisible({ timeout: 5000 });

    // Title should be visible
    await expect(page.getByText('Quest Board')).toBeVisible();
  });

  test('should display daily quests with progress bars', async ({ page }) => {
    // Navigate to quest board
    const profileTrigger = page.locator('.profile-dropdown, .profile-trigger, [data-hud="profile"]');
    await profileTrigger.click();
    await page.getByText(/quest board|quests/i).click();

    // Wait for quests to load
    await page.waitForTimeout(1000);

    // Should see Daily tab active by default
    const dailyTab = page.locator('.quest-tab.active', { hasText: /daily/i });
    await expect(dailyTab).toBeVisible();

    // Should display quest cards
    const questCards = page.locator('.quest-card');
    await expect(questCards.first()).toBeVisible({ timeout: 5000 });

    // Each quest should have a progress bar
    const progressBars = page.locator('.quest-progress-bar');
    await expect(progressBars.first()).toBeVisible();
  });

  test('should switch to Weekly quests tab', async ({ page }) => {
    // Navigate to quest board
    const profileTrigger = page.locator('.profile-dropdown, .profile-trigger, [data-hud="profile"]');
    await profileTrigger.click();
    await page.getByText(/quest board|quests/i).click();

    // Wait for quests to load
    await page.waitForTimeout(1000);

    // Click Weekly tab
    const weeklyTab = page.locator('.quest-tab', { hasText: /weekly/i });
    await weeklyTab.click();

    // Weekly tab should be active
    await expect(weeklyTab).toHaveClass(/active/);

    // Should display weekly quest cards
    const questCards = page.locator('.quest-card');
    await expect(questCards.first()).toBeVisible({ timeout: 5000 });
  });

  test('should display streak information', async ({ page }) => {
    // Navigate to quest board
    const profileTrigger = page.locator('.profile-dropdown, .profile-trigger, [data-hud="profile"]');
    await profileTrigger.click();
    await page.getByText(/quest board|quests/i).click();

    // Wait for quests to load
    await page.waitForTimeout(1000);

    // Streak display should be visible on Daily tab
    const streakDisplay = page.locator('.streak-display');
    await expect(streakDisplay).toBeVisible({ timeout: 5000 });

    // Should show streak count
    const streakCount = page.locator('.streak-count');
    await expect(streakCount).toBeVisible();
  });

  test('should display reset countdown timer', async ({ page }) => {
    // Navigate to quest board
    const profileTrigger = page.locator('.profile-dropdown, .profile-trigger, [data-hud="profile"]');
    await profileTrigger.click();
    await page.getByText(/quest board|quests/i).click();

    // Wait for quests to load
    await page.waitForTimeout(1000);

    // Countdown should be visible
    const countdown = page.locator('#countdown-time');
    await expect(countdown).toBeVisible();

    // Countdown should show time format (HH:MM:SS)
    await expect(countdown).toHaveText(/\d{2}:\d{2}:\d{2}|--:--:--/);
  });

  test('should show quest rewards (gold and XP)', async ({ page }) => {
    // Navigate to quest board
    const profileTrigger = page.locator('.profile-dropdown, .profile-trigger, [data-hud="profile"]');
    await profileTrigger.click();
    await page.getByText(/quest board|quests/i).click();

    // Wait for quests to load
    await page.waitForTimeout(1000);

    // Should display gold reward
    const goldReward = page.locator('.quest-reward-gold');
    await expect(goldReward.first()).toBeVisible({ timeout: 5000 });

    // Should display XP reward
    const xpReward = page.locator('.quest-reward-xp');
    await expect(xpReward.first()).toBeVisible();
  });

  test('should show difficulty badge on quests', async ({ page }) => {
    // Navigate to quest board
    const profileTrigger = page.locator('.profile-dropdown, .profile-trigger, [data-hud="profile"]');
    await profileTrigger.click();
    await page.getByText(/quest board|quests/i).click();

    // Wait for quests to load
    await page.waitForTimeout(1000);

    // Should display difficulty badge
    const difficultyBadge = page.locator('.quest-difficulty');
    await expect(difficultyBadge.first()).toBeVisible({ timeout: 5000 });

    // Badge should have difficulty text
    await expect(difficultyBadge.first()).toHaveText(/easy|normal|hard|elite/i);
  });

  test('should have Claim All button', async ({ page }) => {
    // Navigate to quest board
    const profileTrigger = page.locator('.profile-dropdown, .profile-trigger, [data-hud="profile"]');
    await profileTrigger.click();
    await page.getByText(/quest board|quests/i).click();

    // Wait for quests to load
    await page.waitForTimeout(1000);

    // Claim All button should exist
    const claimAllBtn = page.locator('#claim-all-btn');
    await expect(claimAllBtn).toBeVisible();
    await expect(claimAllBtn).toHaveText(/claim all/i);
  });

  test('should return to world map when clicking back', async ({ page }) => {
    // Navigate to quest board
    const profileTrigger = page.locator('.profile-dropdown, .profile-trigger, [data-hud="profile"]');
    await profileTrigger.click();
    await page.getByText(/quest board|quests/i).click();

    // Wait for quest board to load
    await expect(page.locator('.quest-board-container')).toBeVisible({ timeout: 5000 });

    // Click back button
    const backBtn = page.locator('#quest-back-btn');
    await backBtn.click();

    // Should return to world map
    await page.waitForTimeout(1000);
    await expect(page.locator('.quest-board-container')).not.toBeVisible();
  });

  test('should display Perfect Week progress when on Daily tab', async ({ page }) => {
    // Navigate to quest board
    const profileTrigger = page.locator('.profile-dropdown, .profile-trigger, [data-hud="profile"]');
    await profileTrigger.click();
    await page.getByText(/quest board|quests/i).click();

    // Wait for quests to load
    await page.waitForTimeout(1000);

    // Perfect Week display might be visible (depends on character state)
    const perfectWeekDisplay = page.locator('.perfect-week-display');

    // If visible, check it has 7 day indicators
    if (await perfectWeekDisplay.isVisible({ timeout: 2000 })) {
      const dayIndicators = page.locator('.perfect-week-day');
      await expect(dayIndicators).toHaveCount(7);
    }
  });

  test('should show elite badge on elite quests', async ({ page }) => {
    // Navigate to quest board
    const profileTrigger = page.locator('.profile-dropdown, .profile-trigger, [data-hud="profile"]');
    await profileTrigger.click();
    await page.getByText(/quest board|quests/i).click();

    // Wait for quests to load
    await page.waitForTimeout(1000);

    // Check for elite quests (they have special styling)
    const eliteQuests = page.locator('.quest-card.elite-quest');

    // If any elite quests are visible, verify the styling
    if (await eliteQuests.first().isVisible({ timeout: 2000 })) {
      // Elite quests should have the item drop hint
      const itemDropHint = page.locator('.elite-item-drop-hint');
      await expect(itemDropHint.first()).toBeVisible();
      await expect(itemDropHint.first()).toHaveText(/rare equipment/i);
    }
  });
});
