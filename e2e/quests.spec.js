import { test, expect } from './fixtures.js';
import {
  apiCall,
  createPlayer,
  enterWorldMap,
  openProfileMenuItem,
  waitForScene,
  waitForWorldMapReady
} from './helpers/index.js';

/**
 * Quest Board E2E Tests
 *
 * The board is opened from the profile menu and shows the active
 * character's daily and weekly quests.
 *
 * TODO(quest refresh race): the board requests daily and weekly quests in
 * parallel, and on a character's first visit both requests race to create
 * the period's quests; one of them fails with 409 "Resource already exists"
 * and the board shows "No quests available". Until the API's quest refresh is
 * concurrency-safe, each test creates the quests with sequential API reads
 * before opening the board. Remove the warm-up once the race is fixed.
 */

async function warmQuests(request, player) {
  const { body: daily } = await apiCall(request, 'GET', `/quests/daily/${player.character.id}`, { token: player.token });
  const { body: weekly } = await apiCall(request, 'GET', `/quests/weekly/${player.character.id}`, { token: player.token });
  return { daily, weekly };
}

async function openQuestBoard(page) {
  await openProfileMenuItem(page, 'quests');
  await waitForScene(page, 'questBoard');
  await expect(page.locator('.quest-board-container')).toBeVisible({ timeout: 10000 });
}

test.describe('Quest Board', () => {
  let player;
  let quests;

  test.beforeEach(async ({ page, request }) => {
    player = await createPlayer(request);
    quests = await warmQuests(request, player);
    expect(quests.daily.quests.length).toBeGreaterThan(0);
    expect(quests.weekly.quests.length).toBeGreaterThan(0);
    await enterWorldMap(page, player);
  });

  test('should open the Quest Board from the profile menu', async ({ page }) => {
    await openQuestBoard(page);

    await expect(page.locator('.quest-title')).toHaveText('Quest Board');
    await expect(page.locator('.quest-tab.active')).toHaveAttribute('data-tab', 'daily');
  });

  test('should list the daily quests with progress and rewards', async ({ page }) => {
    await openQuestBoard(page);

    const cards = page.locator('.quest-card');
    await expect(cards).toHaveCount(quests.daily.quests.length, { timeout: 10000 });
    await expect(page.locator('.quest-progress-bar')).toHaveCount(quests.daily.quests.length);

    for (const quest of quests.daily.quests) {
      const card = cards.filter({ hasText: quest.questName });
      await expect(card).toHaveCount(1);
      await expect(card.locator('.quest-difficulty')).toHaveText(quest.difficulty);
      if (quest.rewards.gold) {
        await expect(card.locator('.quest-reward-gold')).toContainText(String(quest.rewards.gold));
      }
      if (quest.rewards.xp) {
        await expect(card.locator('.quest-reward-xp')).toContainText(`${quest.rewards.xp} XP`);
      }
    }
  });

  test('should switch to the weekly quests tab', async ({ page }) => {
    await openQuestBoard(page);
    await expect(page.locator('.quest-card')).toHaveCount(quests.daily.quests.length, { timeout: 10000 });

    const weeklyTab = page.locator('.quest-tab[data-tab="weekly"]');
    await weeklyTab.click();

    await expect(weeklyTab).toHaveClass(/active/);
    await expect(page.locator('.quest-card')).toHaveCount(quests.weekly.quests.length);
    for (const quest of quests.weekly.quests) {
      await expect(page.locator('.quest-card').filter({ hasText: quest.questName })).toHaveCount(1);
    }
    // Streak and Perfect Week are daily-only.
    await expect(page.locator('.streak-display')).toHaveCount(0);
    await expect(page.locator('.perfect-week-display')).toHaveCount(0);
  });

  test('should show the streak and Perfect Week progress on the daily tab', async ({ page }) => {
    await openQuestBoard(page);

    await expect(page.locator('.streak-count')).toHaveText(
      `${quests.daily.streak.currentStreak} Day Streak`, { timeout: 10000 }
    );
    await expect(page.locator('.perfect-week-day')).toHaveCount(7);
  });

  test('should count down to the next reset', async ({ page }) => {
    await openQuestBoard(page);

    await expect(page.locator('#countdown-time')).toHaveText(/^\d{2,}:\d{2}:\d{2}$/, { timeout: 10000 });
  });

  test('should disable Claim All while nothing is complete', async ({ page }) => {
    await openQuestBoard(page);
    await expect(page.locator('.quest-card')).toHaveCount(quests.daily.quests.length, { timeout: 10000 });

    await expect(page.locator('.quest-card.claimable')).toHaveCount(0);
    await expect(page.locator('#claim-all-btn')).toBeDisabled();
  });

  test('should return to the world map from the back button', async ({ page }) => {
    await openQuestBoard(page);

    await page.locator('#quest-back-btn').click();

    await waitForWorldMapReady(page);
    await expect(page.locator('.quest-board-container')).toHaveCount(0);
  });
});
