import { test, expect } from './fixtures.js';
import {
  apiCall,
  clickNodeAction,
  createPlayer,
  enterWorldMap,
  waitForScene,
  waitForWorldMapReady
} from './helpers/index.js';

/**
 * Shop E2E Tests
 *
 * A fresh character starts at its region castle, which has a blacksmith and
 * an apothecary, 1,000 gold and a few starter consumables. Shop stock is
 * shared by every player at a node, so prices and stock are read at test
 * time rather than hard-coded.
 *
 * Caravan shops are not covered: the current world seed has no caravan node.
 */

function parseGold(text) {
  return Number.parseInt(String(text).replace(/[^0-9]/g, ''), 10);
}

async function openShop(page, shopType) {
  await clickNodeAction(page, shopType);
  await waitForScene(page, 'shop');
  await expect(page.locator('.shop-container')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.shop-container .item-data-table-row').first()).toBeVisible({ timeout: 10000 });
}

test.describe('Shop System', () => {
  let player;

  test.beforeEach(async ({ page, request }) => {
    player = await createPlayer(request);
    await enterWorldMap(page, player);
  });

  test('should open the blacksmith with the buy tab active', async ({ page }) => {
    await openShop(page, 'blacksmith');

    await expect(page.locator('.shop-title h2')).toHaveText(/blacksmith/i);
    await expect(page.locator('.shop-tab[data-tab="buy"]')).toHaveClass(/active/);
    await expect(page.locator('#items-header')).toHaveText(/Shop Inventory/i);
  });

  test('should list the same items as the shop API', async ({ page, request }) => {
    await openShop(page, 'blacksmith');

    const { body: currentNode } = await apiCall(request, 'GET', '/world/current', { token: player.token });
    const { body } = await apiCall(request, 'GET', `/shops/${currentNode.currentNode.id}/blacksmith`, { token: player.token });
    const rows = page.locator('.shop-container .item-data-table-row');
    await expect(rows).toHaveCount(body.items.length);
    for (const item of body.items.slice(0, 3)) {
      await expect(rows.filter({ hasText: item.name }).first()).toBeVisible();
    }
  });

  test('should display the player gold in the shop header', async ({ page }) => {
    await openShop(page, 'blacksmith');

    await expect(page.locator('.shop-gold')).toBeVisible();
    await expect(page.locator('#player-gold')).toHaveText(player.gold.toLocaleString('en-US'));
  });

  test('should switch between buy and sell tabs', async ({ page }) => {
    await openShop(page, 'blacksmith');

    const sellTab = page.locator('.shop-tab[data-tab="sell"]');
    await sellTab.click();
    await expect(sellTab).toHaveClass(/active/);
    await expect(page.locator('#items-header')).toHaveText(/Your Items/i);
    // A new character carries starter consumables to sell.
    await expect(page.locator('.shop-container .item-data-table-row').first()).toBeVisible({ timeout: 10000 });

    const buyTab = page.locator('.shop-tab[data-tab="buy"]');
    await buyTab.click();
    await expect(buyTab).toHaveClass(/active/);
    await expect(sellTab).not.toHaveClass(/active/);
    await expect(page.locator('#items-header')).toHaveText(/Shop Inventory/i);
  });

  test('should show item details, quantity and total price', async ({ page }) => {
    await openShop(page, 'blacksmith');

    await page.locator('.shop-container .item-data-table-row').first().click();

    await expect(page.locator('.shop-detail-panel .detail-name')).toBeVisible();
    await expect(page.locator('#action-btn')).toHaveText(/Purchase/);
    await expect(page.locator('.quantity-value')).toHaveText('1');
    await expect(page.locator('#qty-minus')).toBeDisabled();

    const unitPrice = parseGold(await page.locator('.total-value').textContent());
    expect(unitPrice).toBeGreaterThan(0);
    await expect(page.locator('.total-value')).toHaveText(/^[\d,]+g$/);

    await page.locator('#qty-plus').click();
    await expect(page.locator('.quantity-value')).toHaveText('2');
    await expect(page.locator('.total-value')).toHaveText(`${(unitPrice * 2).toLocaleString('en-US')}g`);

    await page.locator('#qty-minus').click();
    await expect(page.locator('.quantity-value')).toHaveText('1');
  });

  test('should disable purchase when the total exceeds the player gold', async ({ page, request }) => {
    const { body: current } = await apiCall(request, 'GET', '/world/current', { token: player.token });
    const { body } = await apiCall(request, 'GET', `/shops/${current.currentNode.id}/apothecary`, { token: player.token });
    const [item] = body.items
      .filter(candidate => candidate.buyPrice * candidate.quantity > player.gold)
      .sort((a, b) => b.buyPrice - a.buyPrice);
    expect(item, 'the apothecary stocks enough of one item to exceed 1,000 gold').toBeTruthy();

    await openShop(page, 'apothecary');
    await page.locator('.shop-container .item-data-table-row').filter({ hasText: item.name }).first().click();
    await expect(page.locator('.shop-detail-panel .detail-name')).toContainText(item.name);

    const neededQuantity = Math.floor(player.gold / item.buyPrice) + 1;
    for (let quantity = 1; quantity < neededQuantity; quantity++) {
      await page.locator('#qty-plus').click();
      await expect(page.locator('.quantity-value')).toHaveText(String(quantity + 1));
    }

    await expect(page.locator('.total-value')).toHaveClass(/cannot-afford/);
    await expect(page.locator('#action-btn')).toBeDisabled();
  });

  test('should return to the world map from the back button', async ({ page }) => {
    await openShop(page, 'blacksmith');

    await page.locator('#back-btn').click();

    await waitForWorldMapReady(page);
    await expect(page.locator('.shop-container')).toHaveCount(0);
  });
});

test.describe('Shop Transactions', () => {
  let player;

  test.beforeEach(async ({ page, request }) => {
    player = await createPlayer(request);
    await enterWorldMap(page, player);
  });

  test('should purchase an item and deduct its price', async ({ page, request }) => {
    await openShop(page, 'apothecary');
    const goldDisplay = page.locator('#player-gold');
    const initialGold = parseGold(await goldDisplay.textContent());
    expect(initialGold).toBe(player.gold);

    const row = page.locator('.shop-container .item-data-table-row').filter({ hasText: 'Health Potion' }).first();
    await row.click();
    await expect(page.locator('.shop-detail-panel .detail-name')).toContainText('Health Potion');
    const price = parseGold(await page.locator('.total-value').textContent());

    await page.locator('#action-btn').click();

    await expect(page.locator('.parchment-toast').filter({ hasText: /purchase|bought/i }))
      .toBeVisible({ timeout: 10000 });
    await expect(goldDisplay).toHaveText((initialGold - price).toLocaleString('en-US'));

    const { body } = await apiCall(request, 'GET', '/auth/me', { token: player.token });
    expect(body.user.gold).toBe(initialGold - price);
  });

  test('should sell an item and add its value', async ({ page, request }) => {
    await openShop(page, 'apothecary');
    const goldDisplay = page.locator('#player-gold');
    const initialGold = parseGold(await goldDisplay.textContent());

    await page.locator('.shop-tab[data-tab="sell"]').click();
    await expect(page.locator('#items-header')).toHaveText(/Your Items/i);
    const row = page.locator('.shop-container .item-data-table-row').first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.click();

    await expect(page.locator('#action-btn')).toHaveText(/Sell/);
    const value = parseGold(await page.locator('.total-value').textContent());
    expect(value).toBeGreaterThan(0);

    await page.locator('#action-btn').click();

    await expect(page.locator('.parchment-toast').filter({ hasText: /sold|sale/i }))
      .toBeVisible({ timeout: 10000 });
    await expect(goldDisplay).toHaveText((initialGold + value).toLocaleString('en-US'));

    const { body } = await apiCall(request, 'GET', '/auth/me', { token: player.token });
    expect(body.user.gold).toBe(initialGold + value);
  });
});
