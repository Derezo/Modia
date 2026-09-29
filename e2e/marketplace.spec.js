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
 * Marketplace E2E Tests
 *
 * The marketplace is opened from the node action menu of a castle (every
 * character starts at one). Transactions use a second, API-driven player as
 * the counterparty so each test controls the listings it relies on.
 */

const TABS = ['search', 'orders', 'listings', 'inventory', 'history'];

async function openMarketplace(page) {
  await clickNodeAction(page, 'marketplace');
  await waitForScene(page, 'marketplace');
  await expect(page.locator('.marketplace-container')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.marketplace-tab[data-tab="search"]')).toHaveClass(/active/);
}

function tab(page, name) {
  return page.locator(`.marketplace-tab[data-tab="${name}"]`);
}

function tableRows(page) {
  return page.locator('#main-content .item-data-table-row');
}

/**
 * Buy the cheapest in-stock equipment item from the castle blacksmith and
 * return its sellable instance. Blacksmith stock is shared by every player
 * at the node, so the item is chosen at run time.
 */
async function acquireEquipment(request, player) {
  const { body: current } = await apiCall(request, 'GET', '/world/current', { token: player.token });
  const nodeId = current.currentNode.id;
  const { body: shop } = await apiCall(request, 'GET', `/shops/${nodeId}/blacksmith`, { token: player.token });
  const [template] = shop.items
    .filter(item => item.equipmentSlot && item.quantity > 0 && item.buyPrice <= player.gold)
    .sort((a, b) => a.buyPrice - b.buyPrice);
  expect(template, 'the blacksmith has equipment in stock').toBeTruthy();
  await apiCall(request, 'POST', `/shops/${nodeId}/blacksmith/buy`, {
    token: player.token,
    data: { itemTemplateId: template.templateId, quantity: 1, characterId: player.character.id }
  });
  const { body: sellable } = await apiCall(request, 'GET', '/marketplace/inventory/sellable', { token: player.token });
  const instance = sellable.items.find(item => item.templateId === template.templateId);
  expect(instance).toBeTruthy();
  return instance;
}

async function createListing(request, player, instance, price) {
  const { body } = await apiCall(request, 'POST', '/marketplace/listings', {
    token: player.token,
    data: { characterId: player.character.id, characterItemId: instance.instanceId, price }
  });
  return body.listing;
}

test.describe('Marketplace System', () => {
  let player;

  test.beforeEach(async ({ page, request }) => {
    player = await createPlayer(request);
    await enterWorldMap(page, player);
    await openMarketplace(page);
  });

  test('should show the header with gold and trading character', async ({ page }) => {
    await expect(page.locator('.marketplace-title h2')).toHaveText(/Marketplace/i);
    await expect(page.locator('.marketplace-title')).toContainText(`Trading as: ${player.character.name}`);
    await expect(page.locator('.marketplace-gold')).toBeVisible();
    await expect(page.locator('#player-gold')).toHaveText(player.gold.toLocaleString('en-US'));
  });

  test('should show every tab with empty order and listing counts', async ({ page }) => {
    for (const name of TABS) {
      await expect(tab(page, name)).toBeVisible();
    }
    await expect(tab(page, 'search')).toHaveText(/Browse Items/i);
    await expect(tab(page, 'orders')).toHaveText('My Orders (0)');
    await expect(tab(page, 'listings')).toHaveText('Equipment For Sale (0)');
  });

  test('should switch tabs', async ({ page }) => {
    for (const name of ['orders', 'listings', 'inventory', 'history', 'search']) {
      await tab(page, name).click();
      await expect(tab(page, name)).toHaveClass(/active/);
      for (const other of TABS.filter(candidate => candidate !== name)) {
        await expect(tab(page, other)).not.toHaveClass(/active/);
      }
      await expect(page.locator('#main-content')).toBeVisible();
      await expect(page.locator('#side-panel')).toBeVisible();
    }
  });

  test('should filter the browse list by search text', async ({ page }) => {
    const rows = tableRows(page);
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    const total = await rows.count();

    await page.locator('#main-content .item-data-table-search').fill('Leather Boots');

    await expect(rows.filter({ hasText: 'Leather Boots' }).first()).toBeVisible();
    await expect.poll(() => rows.count()).toBeLessThan(total);
    const names = await rows.allInnerTexts();
    for (const text of names) {
      expect(text).toMatch(/Leather Boots/);
    }
  });

  test('should open the item panel when a browse row is selected', async ({ page }) => {
    await page.locator('#main-content .item-data-table-search').fill('Leather Boots');
    await tableRows(page).filter({ hasText: 'Leather Boots' }).first().click();

    await expect(page.locator('#side-panel')).toContainText('Leather Boots - Available Listings', { timeout: 10000 });
  });

  test('should list sellable inventory on the Sell Items tab', async ({ page, request }) => {
    const { body } = await apiCall(request, 'GET', '/marketplace/inventory/sellable', { token: player.token });
    expect(body.items.length).toBeGreaterThan(0);

    await tab(page, 'inventory').click();

    await expect(tableRows(page)).toHaveCount(body.items.length, { timeout: 10000 });
    await expect(tableRows(page).filter({ hasText: body.items[0].name }).first()).toBeVisible();
  });

  test('should return to the world map from the back button', async ({ page }) => {
    await page.locator('#back-btn').click();

    await waitForWorldMapReady(page);
    await expect(page.locator('.marketplace-container')).toHaveCount(0);
  });
});

test.describe('Marketplace Transactions', () => {
  test('should count existing listings in the tab label on open', async ({ page, request }) => {
    // Known bug: MarketplaceScene.loadInitialData() stores myOrders and
    // myListings but never calls updateTabs(), so the labels keep the "(0)"
    // they were created with until another action refreshes them. When this
    // test starts failing as "expected to fail", the bug is fixed: delete the
    // test.fail() line.
    test.fail(true, 'MarketplaceScene tab counts are not refreshed after the initial load');

    const player = await createPlayer(request);
    const boots = await acquireEquipment(request, player);
    await createListing(request, player, boots, 400);
    await enterWorldMap(page, player);
    await openMarketplace(page);

    await expect(tab(page, 'listings')).toHaveText('Equipment For Sale (1)');
  });

  test('should create a listing from the Sell Items tab', async ({ page, request }) => {
    const player = await createPlayer(request);
    const boots = await acquireEquipment(request, player);
    await enterWorldMap(page, player);
    await openMarketplace(page);

    await tab(page, 'inventory').click();
    await tableRows(page).filter({ hasText: boots.name }).first().click();
    const priceInput = page.locator('#listing-price');
    await expect(priceInput).toBeVisible({ timeout: 5000 });
    await priceInput.fill('321');
    await page.locator('#create-listing-btn').click();

    await expect(page.locator('.parchment-toast').filter({ hasText: /Listing Created/i }))
      .toBeVisible({ timeout: 10000 });
    await expect(tab(page, 'listings')).toHaveText('Equipment For Sale (1)');

    await tab(page, 'listings').click();
    await expect(tableRows(page).filter({ hasText: boots.name })).toHaveCount(1);

    const { body } = await apiCall(request, 'GET', '/marketplace/listings/mine', { token: player.token });
    expect(body.listings).toHaveLength(1);
    expect(body.listings[0]).toMatchObject({ generatedName: boots.name, price: 321 });
  });

  test('should cancel an own listing and return the item', async ({ page, request }) => {
    const player = await createPlayer(request);
    const boots = await acquireEquipment(request, player);
    await createListing(request, player, boots, 400);
    await enterWorldMap(page, player);
    await openMarketplace(page);

    await tab(page, 'listings').click();
    await expect(tableRows(page)).toHaveCount(1, { timeout: 10000 });
    await tableRows(page).filter({ hasText: boots.name }).first().click();
    await page.locator('.cancel-listing-btn').click();

    await expect(page.locator('.parchment-toast').filter({ hasText: /Listing Cancelled/i }))
      .toBeVisible({ timeout: 10000 });
    await expect(tab(page, 'listings')).toHaveText('Equipment For Sale (0)');
    await expect(tableRows(page)).toHaveCount(0);

    const { body: mine } = await apiCall(request, 'GET', '/marketplace/listings/mine', { token: player.token });
    expect(mine.listings).toHaveLength(0);
    const { body: sellable } = await apiCall(request, 'GET', '/marketplace/inventory/sellable', { token: player.token });
    expect(sellable.items.map(item => item.instanceId)).toContain(boots.instanceId);
  });

  test('should buy another player\'s listing and deduct the price', async ({ page, request }) => {
    const seller = await createPlayer(request);
    const boots = await acquireEquipment(request, seller);
    const price = 100 + Math.floor(Math.random() * 400);
    const listing = await createListing(request, seller, boots, price);
    const { body: sellerBefore } = await apiCall(request, 'GET', '/auth/me', { token: seller.token });

    const buyer = await createPlayer(request);
    await enterWorldMap(page, buyer);
    await openMarketplace(page);

    await page.locator('#main-content .item-data-table-search').fill(boots.name);
    await tableRows(page).filter({ hasText: boots.name }).first().click();
    const buyButton = page.locator(`.equipment-buy-btn[data-listing-id="${listing.listingId}"]`);
    await expect(buyButton).toHaveText(`Buy for ${price}g`, { timeout: 10000 });
    await buyButton.click();

    const dialog = page.locator('.market-confirm-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.confirm-row.total .confirm-gold')).toHaveText(`${price}g`);
    await dialog.locator('.confirm-btn-confirm').click();

    await expect(page.locator('.parchment-toast').filter({ hasText: /Purchase Complete/i }))
      .toBeVisible({ timeout: 10000 });
    await expect(page.locator('#player-gold')).toHaveText((buyer.gold - price).toLocaleString('en-US'));

    const { body: buyerMe } = await apiCall(request, 'GET', '/auth/me', { token: buyer.token });
    expect(buyerMe.user.gold).toBe(buyer.gold - price);
    const { body: sellerListings } = await apiCall(request, 'GET', '/marketplace/listings/mine', { token: seller.token });
    expect(sellerListings.listings).toHaveLength(0);
    // The seller is paid the price less the marketplace fee.
    const { body: sellerAfter } = await apiCall(request, 'GET', '/auth/me', { token: seller.token });
    expect(sellerAfter.user.gold).toBeGreaterThan(sellerBefore.user.gold);
    expect(sellerAfter.user.gold).toBeLessThanOrEqual(sellerBefore.user.gold + price);
  });
});
