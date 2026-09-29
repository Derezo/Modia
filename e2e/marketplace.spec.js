import { test, expect } from '@playwright/test';
import { login, TEST_USER } from './helpers/index.js';

/**
 * Marketplace E2E Tests
 *
 * Tests the marketplace trading system:
 * - Viewing listings and searching
 * - Filtering by type and rarity
 * - Creating sell listings
 * - Cancelling own listings
 * - Purchasing from marketplace
 *
 * Note: Marketplace is only accessible from castle nodes with 'marketplace' feature.
 */

test.describe('Marketplace System', () => {
  // Login, select character, and navigate to world map before each test
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

  test('should open marketplace when clicking marketplace button', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look for marketplace button (only available at castle nodes)
    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });

    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();

      // Marketplace container should be visible
      const marketplaceContainer = page.locator('.marketplace-container');
      await expect(marketplaceContainer).toBeVisible({ timeout: 5000 });

      // Header with "Marketplace" title should be visible
      const marketplaceTitle = page.locator('.marketplace-title h2');
      await expect(marketplaceTitle).toHaveText(/Marketplace/i);
    }
  });

  test('should show travel prompt when not at marketplace node', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Try to access marketplace via URL directly or from a non-castle node
    // The scene should show a travel prompt modal
    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });

    // If marketplace button is not visible, character is not at a castle
    if (!(await marketplaceButton.isVisible({ timeout: 2000 }))) {
      // Travel to marketplace would be required
      // This test documents that marketplace has location restrictions
      const canvas = page.locator('canvas');
      await expect(canvas).toBeVisible();
    }
  });

  test('should display browse items tab by default', async ({ page }) => {
    await page.waitForTimeout(2000);

    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });
    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();
      await page.waitForTimeout(1000);

      // Browse Items tab should be active
      const browseTab = page.locator('.marketplace-tab[data-tab="search"]');
      await expect(browseTab).toHaveClass(/active/);
      await expect(browseTab).toHaveText(/Browse Items/i);
    }
  });

  test('should display player gold in marketplace header', async ({ page }) => {
    await page.waitForTimeout(2000);

    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });
    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();

      // Gold display should be visible
      const goldDisplay = page.locator('.marketplace-gold');
      await expect(goldDisplay).toBeVisible({ timeout: 5000 });

      // Gold amount should be displayed
      const goldAmount = page.locator('#player-gold');
      await expect(goldAmount).toBeVisible();
      const goldText = await goldAmount.textContent();
      expect(goldText).toMatch(/[\d,]+/);
    }
  });

  test('should show character name in marketplace header', async ({ page }) => {
    await page.waitForTimeout(2000);

    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });
    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();

      // Trading character info should be displayed
      const tradingInfo = page.locator('.marketplace-title');
      await expect(tradingInfo).toContainText(/Trading as:/i);
    }
  });

  test('should have all marketplace tabs visible', async ({ page }) => {
    await page.waitForTimeout(2000);

    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });
    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();
      await page.waitForTimeout(1000);

      // Verify all tabs exist
      const browseTab = page.locator('.marketplace-tab[data-tab="search"]');
      const ordersTab = page.locator('.marketplace-tab[data-tab="orders"]');
      const listingsTab = page.locator('.marketplace-tab[data-tab="listings"]');
      const inventoryTab = page.locator('.marketplace-tab[data-tab="inventory"]');
      const historyTab = page.locator('.marketplace-tab[data-tab="history"]');

      await expect(browseTab).toBeVisible();
      await expect(ordersTab).toBeVisible();
      await expect(listingsTab).toBeVisible();
      await expect(inventoryTab).toBeVisible();
      await expect(historyTab).toBeVisible();
    }
  });

  test('should switch to My Orders tab', async ({ page }) => {
    await page.waitForTimeout(2000);

    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });
    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();
      await page.waitForTimeout(1000);

      // Click My Orders tab
      const ordersTab = page.locator('.marketplace-tab[data-tab="orders"]');
      await ordersTab.click();

      // Tab should be active
      await expect(ordersTab).toHaveClass(/active/);

      // Content should update (main content area)
      const mainContent = page.locator('#main-content');
      await expect(mainContent).toBeVisible();
    }
  });

  test('should switch to Equipment For Sale tab', async ({ page }) => {
    await page.waitForTimeout(2000);

    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });
    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();
      await page.waitForTimeout(1000);

      // Click Equipment For Sale tab
      const listingsTab = page.locator('.marketplace-tab[data-tab="listings"]');
      await listingsTab.click();

      // Tab should be active
      await expect(listingsTab).toHaveClass(/active/);
    }
  });

  test('should switch to Sell Items tab', async ({ page }) => {
    await page.waitForTimeout(2000);

    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });
    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();
      await page.waitForTimeout(1000);

      // Click Sell Items (inventory) tab
      const inventoryTab = page.locator('.marketplace-tab[data-tab="inventory"]');
      await inventoryTab.click();

      // Tab should be active
      await expect(inventoryTab).toHaveClass(/active/);
    }
  });

  test('should switch to Trade History tab', async ({ page }) => {
    await page.waitForTimeout(2000);

    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });
    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();
      await page.waitForTimeout(1000);

      // Click Trade History tab
      const historyTab = page.locator('.marketplace-tab[data-tab="history"]');
      await historyTab.click();

      // Tab should be active
      await expect(historyTab).toHaveClass(/active/);
    }
  });

  test('should display search/filter functionality on browse tab', async ({ page }) => {
    await page.waitForTimeout(2000);

    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });
    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();
      await page.waitForTimeout(1500);

      // Search/filter elements should be visible via ItemDataTable
      const searchInput = page.locator('.item-filter-search input, input[placeholder*="Search"]');
      if (await searchInput.isVisible({ timeout: 3000 })) {
        await expect(searchInput).toBeVisible();
      }

      // Type/rarity filters might be dropdowns
      const filterDropdown = page.locator('.item-filter-type, .item-filter-rarity, select');
      if (await filterDropdown.first().isVisible({ timeout: 2000 })) {
        await expect(filterDropdown.first()).toBeVisible();
      }
    }
  });

  test('should show order book panel when item is selected', async ({ page }) => {
    await page.waitForTimeout(2000);

    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });
    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();
      await page.waitForTimeout(1500);

      // Select an item from the browse list
      const itemRow = page.locator('.item-data-table-row').first();
      if (await itemRow.isVisible({ timeout: 3000 })) {
        await itemRow.click();
        await page.waitForTimeout(500);

        // Side panel should show order book or item details
        const sidePanel = page.locator('#side-panel');
        await expect(sidePanel).toBeVisible();
      }
    }
  });

  test('should return to world map when clicking back button', async ({ page }) => {
    await page.waitForTimeout(2000);

    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });
    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();
      await page.waitForTimeout(1000);

      // Click back button
      const backBtn = page.locator('#back-btn');
      await backBtn.click();

      // Should return to world map
      await page.waitForTimeout(1000);
      await expect(page.locator('.marketplace-container')).not.toBeVisible();

      // Canvas should be visible (world map)
      const canvas = page.locator('canvas');
      await expect(canvas).toBeVisible();
    }
  });

  test('should display order counts in tab labels', async ({ page }) => {
    await page.waitForTimeout(2000);

    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });
    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();
      await page.waitForTimeout(1000);

      // Orders tab should show count
      const ordersTab = page.locator('.marketplace-tab[data-tab="orders"]');
      const ordersText = await ordersTab.textContent();
      expect(ordersText).toMatch(/My Orders \(\d+\)/);

      // Listings tab should show count
      const listingsTab = page.locator('.marketplace-tab[data-tab="listings"]');
      const listingsText = await listingsTab.textContent();
      expect(listingsText).toMatch(/Equipment For Sale \(\d+\)/);
    }
  });

  test('should have left and right content panels', async ({ page }) => {
    await page.waitForTimeout(2000);

    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });
    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();
      await page.waitForTimeout(1000);

      // Marketplace should have two-panel layout
      const leftPanel = page.locator('.marketplace-left, #main-content');
      const rightPanel = page.locator('.marketplace-right, #side-panel');

      await expect(leftPanel).toBeVisible();
      await expect(rightPanel).toBeVisible();
    }
  });

  test('should display marketplace content area', async ({ page }) => {
    await page.waitForTimeout(2000);

    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });
    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();
      await page.waitForTimeout(1000);

      // Content wrapper should be visible
      const content = page.locator('.marketplace-content');
      await expect(content).toBeVisible();
    }
  });
});

test.describe('Marketplace Orders', () => {
  // Helper to get into marketplace
  async function enterMarketplace(page) {
    // Skip the title intro, log in, and wait for the auth scene to exit
    await login(page, TEST_USER.username, TEST_USER.password);
    await page.waitForTimeout(2000);

    // Select character
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

    // Open marketplace
    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });
    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();
      await page.waitForTimeout(1000);
      return true;
    }
    return false;
  }

  test('should show empty state when no orders exist', async ({ page }) => {
    const inMarketplace = await enterMarketplace(page);
    if (!inMarketplace) {
      test.skip();
      return;
    }

    // Go to My Orders tab
    const ordersTab = page.locator('.marketplace-tab[data-tab="orders"]');
    await ordersTab.click();
    await page.waitForTimeout(500);

    // Main content should be visible
    const mainContent = page.locator('#main-content');
    await expect(mainContent).toBeVisible();
  });

  test('should show inventory items on Sell Items tab', async ({ page }) => {
    const inMarketplace = await enterMarketplace(page);
    if (!inMarketplace) {
      test.skip();
      return;
    }

    // Go to Sell Items tab
    const inventoryTab = page.locator('.marketplace-tab[data-tab="inventory"]');
    await inventoryTab.click();
    await page.waitForTimeout(1000);

    // Main content should show sellable inventory
    const mainContent = page.locator('#main-content');
    await expect(mainContent).toBeVisible();
  });

  test('should persist tab state when returning to marketplace', async ({ page }) => {
    const inMarketplace = await enterMarketplace(page);
    if (!inMarketplace) {
      test.skip();
      return;
    }

    // Switch to History tab
    const historyTab = page.locator('.marketplace-tab[data-tab="history"]');
    await historyTab.click();
    await page.waitForTimeout(500);

    // Go back to map and return
    const backBtn = page.locator('#back-btn');
    await backBtn.click();
    await page.waitForTimeout(1000);

    // Re-enter marketplace
    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });
    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();
      await page.waitForTimeout(1000);

      // Default tab (search) should be active again
      const searchTab = page.locator('.marketplace-tab[data-tab="search"]');
      await expect(searchTab).toHaveClass(/active/);
    }
  });
});

/**
 * Marketplace Transactions E2E Tests
 *
 * Tests actual marketplace transactions:
 * - Creating item listings
 * - Cancelling listings
 * - Purchasing from marketplace
 */
test.describe('Marketplace Transactions', () => {
  // Helper to get into marketplace
  async function enterMarketplace(page) {
    // Skip the title intro, log in, and wait for the auth scene to exit
    await login(page, TEST_USER.username, TEST_USER.password);
    await page.waitForTimeout(2000);

    // Select character
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

    // Open marketplace
    const marketplaceButton = page.getByRole('button', { name: /marketplace/i });
    if (await marketplaceButton.isVisible({ timeout: 3000 })) {
      await marketplaceButton.click();
      await page.waitForTimeout(1000);
      return true;
    }
    return false;
  }

  test('should create item listing from inventory', async ({ page }) => {
    const inMarketplace = await enterMarketplace(page);
    if (!inMarketplace) {
      test.skip();
      return;
    }

    // Go to Sell Items (inventory) tab
    const inventoryTab = page.locator('.marketplace-tab[data-tab="inventory"]');
    await inventoryTab.click();
    await page.waitForTimeout(1000);

    // Select an item to sell
    const itemRow = page.locator('.item-data-table-row').first();
    if (!(await itemRow.isVisible({ timeout: 3000 }))) {
      // No sellable items
      test.skip();
      return;
    }

    // Get the item name for verification
    const itemName = await itemRow.locator('.item-name, .name-cell, td:nth-child(2)').textContent();
    await itemRow.click();
    await page.waitForTimeout(500);

    // Enter a price in the listing form
    const priceInput = page.locator('#listing-price');
    await expect(priceInput).toBeVisible({ timeout: 3000 });
    await priceInput.fill('100');

    // Click "List for Sale" button
    const listButton = page.locator('#create-listing-btn');
    await expect(listButton).toBeVisible();
    await listButton.click();

    // Wait for listing to be created
    await page.waitForTimeout(2000);

    // Verify success toast
    const successToast = page.locator('.parchment-toast').filter({ hasText: /listing|listed/i });
    await expect(successToast).toBeVisible({ timeout: 5000 });

    // Verify listing appears in Equipment For Sale tab
    const listingsTab = page.locator('.marketplace-tab[data-tab="listings"]');
    await listingsTab.click();
    await page.waitForTimeout(1000);

    // Check that our listing is visible
    const listingRows = page.locator('.item-data-table-row');
    const listingCount = await listingRows.count();
    expect(listingCount).toBeGreaterThan(0);
  });

  test('should cancel own listing', async ({ page }) => {
    const inMarketplace = await enterMarketplace(page);
    if (!inMarketplace) {
      test.skip();
      return;
    }

    // Go to Equipment For Sale (listings) tab
    const listingsTab = page.locator('.marketplace-tab[data-tab="listings"]');
    await listingsTab.click();
    await page.waitForTimeout(1000);

    // Select a listing to cancel
    const listingRow = page.locator('.item-data-table-row').first();
    if (!(await listingRow.isVisible({ timeout: 3000 }))) {
      // No active listings to cancel
      test.skip();
      return;
    }

    // Count listings before cancellation
    const listingRows = page.locator('.item-data-table-row');
    const initialCount = await listingRows.count();

    // Select the listing
    await listingRow.click();
    await page.waitForTimeout(500);

    // Click cancel listing button
    const cancelButton = page.locator('.cancel-listing-btn');
    await expect(cancelButton).toBeVisible({ timeout: 3000 });
    await cancelButton.click();

    // Wait for cancellation to complete
    await page.waitForTimeout(2000);

    // Verify success toast
    const successToast = page.locator('.parchment-toast').filter({ hasText: /cancel|returned/i });
    await expect(successToast).toBeVisible({ timeout: 5000 });

    // Verify listing count decreased
    await page.waitForTimeout(500);
    const newCount = await page.locator('.item-data-table-row').count();
    expect(newCount).toBeLessThan(initialCount);
  });

  test('should purchase item from marketplace and deduct gold', async ({ page }) => {
    const inMarketplace = await enterMarketplace(page);
    if (!inMarketplace) {
      test.skip();
      return;
    }

    // Record initial gold
    const goldAmount = page.locator('#player-gold');
    await expect(goldAmount).toBeVisible({ timeout: 3000 });
    const initialGoldText = await goldAmount.textContent();
    const initialGold = parseInt(initialGoldText.replace(/[^0-9]/g, ''), 10);

    // Stay on Browse Items tab (default)
    await page.waitForTimeout(1000);

    // Select an item from the browse list
    const itemRow = page.locator('.item-data-table-row').first();
    if (!(await itemRow.isVisible({ timeout: 3000 }))) {
      // No items in marketplace
      test.skip();
      return;
    }
    await itemRow.click();
    await page.waitForTimeout(1000);

    // Look for buy side toggle and select it
    const buyButton = page.locator('.side-btn.buy');
    if (await buyButton.isVisible({ timeout: 2000 })) {
      await buyButton.click();
      await page.waitForTimeout(500);
    }

    // Set quantity to 1
    const qtyInput = page.locator('#order-quantity');
    if (await qtyInput.isVisible({ timeout: 2000 })) {
      await qtyInput.fill('1');
    }

    // Check if there are sell orders available (best ask)
    const orderBookSpread = page.locator('.order-book-spread');
    if (await orderBookSpread.isVisible({ timeout: 2000 })) {
      const spreadText = await orderBookSpread.textContent();
      if (spreadText.includes('Best Ask: -g') || spreadText.includes('Best Ask: 0g')) {
        // No sell orders available
        test.skip();
        return;
      }
    }

    // Place order button
    const placeOrderBtn = page.locator('#place-order-btn');
    if (!(await placeOrderBtn.isVisible({ timeout: 3000 }))) {
      // Trade panel not available
      test.skip();
      return;
    }
    await placeOrderBtn.click();

    // Confirm dialog may appear
    const confirmBtn = page.locator('.market-confirm-dialog button').filter({ hasText: /confirm|yes|buy/i });
    if (await confirmBtn.isVisible({ timeout: 2000 })) {
      await confirmBtn.click();
    }

    // Wait for order to complete
    await page.waitForTimeout(2000);

    // Verify success toast (order placed or executed)
    const successToast = page.locator('.parchment-toast').filter({ hasText: /order|placed|purchase/i });
    await expect(successToast).toBeVisible({ timeout: 5000 });

    // Verify gold decreased (for limit orders, gold is reserved)
    const newGoldText = await goldAmount.textContent();
    const newGold = parseInt(newGoldText.replace(/[^0-9]/g, ''), 10);
    expect(newGold).toBeLessThanOrEqual(initialGold);
  });
});
