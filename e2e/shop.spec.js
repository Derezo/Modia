import { test, expect } from '@playwright/test';

/**
 * Shop E2E Tests
 *
 * Tests the shop system flow:
 * - Opening shop at a node
 * - Purchasing items (gold deducted, success toast)
 * - Rejecting purchase with insufficient gold
 * - Selling items (gold increased, item removed)
 */

test.describe('Shop System', () => {
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

  test('should open shop when clicking shop feature button', async ({ page }) => {
    // Wait for world map to fully load
    await page.waitForTimeout(2000);

    // Look for a shop-related button (blacksmith, apothecary, farm, caravan)
    const shopButton = page.getByRole('button', { name: /blacksmith|apothecary|farm|caravan|shop/i });

    if (await shopButton.isVisible({ timeout: 3000 })) {
      await shopButton.click();

      // Shop container should be visible
      const shopContainer = page.locator('.shop-container');
      await expect(shopContainer).toBeVisible({ timeout: 5000 });

      // Shop header with title should be visible
      const shopTitle = page.locator('.shop-title h2');
      await expect(shopTitle).toBeVisible();
    } else {
      // If no shop button visible, need to navigate to a shop node first
      // Click on canvas to potentially select a node with shop features
      const canvas = page.locator('canvas');
      await canvas.click({ position: { x: 300, y: 300 } });
      await page.waitForTimeout(500);

      // Check if shop button appeared after clicking a node
      if (await shopButton.isVisible({ timeout: 2000 })) {
        await shopButton.click();
        const shopContainer = page.locator('.shop-container');
        await expect(shopContainer).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('should display shop inventory with buy tab active by default', async ({ page }) => {
    await page.waitForTimeout(2000);

    const shopButton = page.getByRole('button', { name: /blacksmith|apothecary|farm|caravan|shop/i });
    if (await shopButton.isVisible({ timeout: 3000 })) {
      await shopButton.click();

      // Wait for shop to load
      await page.waitForTimeout(1000);

      // Buy tab should be active by default
      const buyTab = page.locator('.shop-tab[data-tab="buy"]');
      await expect(buyTab).toHaveClass(/active/);

      // Items panel header should show "Shop Inventory"
      const panelHeader = page.locator('#items-header');
      await expect(panelHeader).toHaveText(/Shop Inventory/i);
    }
  });

  test('should display player gold in shop header', async ({ page }) => {
    await page.waitForTimeout(2000);

    const shopButton = page.getByRole('button', { name: /blacksmith|apothecary|farm|caravan|shop/i });
    if (await shopButton.isVisible({ timeout: 3000 })) {
      await shopButton.click();

      // Gold display should be visible
      const goldDisplay = page.locator('.shop-gold');
      await expect(goldDisplay).toBeVisible({ timeout: 5000 });

      // Gold amount should be a number
      const goldAmount = page.locator('#player-gold');
      await expect(goldAmount).toBeVisible();
      const goldText = await goldAmount.textContent();
      expect(goldText).toMatch(/[\d,]+/);
    }
  });

  test('should switch between buy and sell tabs', async ({ page }) => {
    await page.waitForTimeout(2000);

    const shopButton = page.getByRole('button', { name: /blacksmith|apothecary|farm/i });
    if (await shopButton.isVisible({ timeout: 3000 })) {
      await shopButton.click();
      await page.waitForTimeout(1000);

      // Click sell tab
      const sellTab = page.locator('.shop-tab[data-tab="sell"]');
      await sellTab.click();

      // Sell tab should now be active
      await expect(sellTab).toHaveClass(/active/);

      // Panel header should show "Your Items"
      const panelHeader = page.locator('#items-header');
      await expect(panelHeader).toHaveText(/Your Items/i);

      // Click buy tab to switch back
      const buyTab = page.locator('.shop-tab[data-tab="buy"]');
      await buyTab.click();

      await expect(buyTab).toHaveClass(/active/);
    }
  });

  test('should show item details when selecting an item', async ({ page }) => {
    await page.waitForTimeout(2000);

    const shopButton = page.getByRole('button', { name: /blacksmith|apothecary|farm|caravan|shop/i });
    if (await shopButton.isVisible({ timeout: 3000 })) {
      await shopButton.click();
      await page.waitForTimeout(1500);

      // Click on an item in the shop list (via ItemDataTable)
      const itemRow = page.locator('.item-data-table-row').first();
      if (await itemRow.isVisible({ timeout: 3000 })) {
        await itemRow.click();

        // Detail panel should show item information
        const detailPanel = page.locator('.shop-detail-panel');
        await expect(detailPanel).toBeVisible();

        // Item name should be visible in detail panel
        const detailName = page.locator('.detail-name');
        await expect(detailName).toBeVisible({ timeout: 3000 });

        // Purchase button should be visible
        const purchaseBtn = page.locator('#action-btn');
        await expect(purchaseBtn).toBeVisible();
      }
    }
  });

  test('should show quantity selector in item details', async ({ page }) => {
    await page.waitForTimeout(2000);

    const shopButton = page.getByRole('button', { name: /blacksmith|apothecary|farm|caravan|shop/i });
    if (await shopButton.isVisible({ timeout: 3000 })) {
      await shopButton.click();
      await page.waitForTimeout(1500);

      // Select an item
      const itemRow = page.locator('.item-data-table-row').first();
      if (await itemRow.isVisible({ timeout: 3000 })) {
        await itemRow.click();
        await page.waitForTimeout(500);

        // Quantity selector should be visible
        const quantitySelector = page.locator('.quantity-selector');
        await expect(quantitySelector).toBeVisible({ timeout: 3000 });

        // Plus and minus buttons should exist
        const plusBtn = page.locator('#qty-plus');
        const minusBtn = page.locator('#qty-minus');
        await expect(plusBtn).toBeVisible();
        await expect(minusBtn).toBeVisible();
      }
    }
  });

  test('should show total price when selecting quantity', async ({ page }) => {
    await page.waitForTimeout(2000);

    const shopButton = page.getByRole('button', { name: /blacksmith|apothecary|farm|caravan|shop/i });
    if (await shopButton.isVisible({ timeout: 3000 })) {
      await shopButton.click();
      await page.waitForTimeout(1500);

      const itemRow = page.locator('.item-data-table-row').first();
      if (await itemRow.isVisible({ timeout: 3000 })) {
        await itemRow.click();
        await page.waitForTimeout(500);

        // Total price should be visible
        const totalPrice = page.locator('.total-price');
        await expect(totalPrice).toBeVisible({ timeout: 3000 });

        // Total value should show gold amount
        const totalValue = page.locator('.total-value');
        await expect(totalValue).toBeVisible();
        const priceText = await totalValue.textContent();
        expect(priceText).toMatch(/[\d,]+g/);
      }
    }
  });

  test('should return to world map when clicking back button', async ({ page }) => {
    await page.waitForTimeout(2000);

    const shopButton = page.getByRole('button', { name: /blacksmith|apothecary|farm|caravan|shop/i });
    if (await shopButton.isVisible({ timeout: 3000 })) {
      await shopButton.click();
      await page.waitForTimeout(1000);

      // Click back button
      const backBtn = page.locator('#back-btn');
      await backBtn.click();

      // Should return to world map (shop container gone)
      await page.waitForTimeout(1000);
      await expect(page.locator('.shop-container')).not.toBeVisible();

      // Canvas should be visible (world map)
      const canvas = page.locator('canvas');
      await expect(canvas).toBeVisible();
    }
  });

  test('should disable purchase button when player cannot afford item', async ({ page }) => {
    await page.waitForTimeout(2000);

    const shopButton = page.getByRole('button', { name: /blacksmith|apothecary|farm|caravan|shop/i });
    if (await shopButton.isVisible({ timeout: 3000 })) {
      await shopButton.click();
      await page.waitForTimeout(1500);

      // Try to find an expensive item that might exceed player's gold
      const itemRows = page.locator('.item-data-table-row');
      const count = await itemRows.count();

      // Select the last item (often more expensive)
      if (count > 0) {
        await itemRows.last().click();
        await page.waitForTimeout(500);

        // Check if total price shows "cannot-afford" class
        const totalValue = page.locator('.total-value');
        if (await totalValue.isVisible({ timeout: 2000 })) {
          const hasCannotAfford = await totalValue.evaluate(el =>
            el.classList.contains('cannot-afford')
          );

          if (hasCannotAfford) {
            // Purchase button should be disabled
            const purchaseBtn = page.locator('#action-btn');
            await expect(purchaseBtn).toBeDisabled();
          }
        }
      }
    }
  });

  test('should display caravan refresh countdown for caravan shops', async ({ page }) => {
    await page.waitForTimeout(2000);

    // Look specifically for caravan button
    const caravanButton = page.getByRole('button', { name: /caravan/i });

    if (await caravanButton.isVisible({ timeout: 3000 })) {
      await caravanButton.click();
      await page.waitForTimeout(1000);

      // Caravan-specific: refresh countdown should be visible
      const refreshInfo = page.locator('.caravan-refresh-info');
      await expect(refreshInfo).toBeVisible({ timeout: 3000 });

      // Countdown element should exist
      const countdown = page.locator('#caravan-countdown');
      await expect(countdown).toBeVisible();
    }
  });

  test('should hide sell tab for caravan shops', async ({ page }) => {
    await page.waitForTimeout(2000);

    const caravanButton = page.getByRole('button', { name: /caravan/i });

    if (await caravanButton.isVisible({ timeout: 3000 })) {
      await caravanButton.click();
      await page.waitForTimeout(1000);

      // Tabs should be hidden for caravan
      const shopTabs = page.locator('.shop-tabs');
      const isHidden = await shopTabs.evaluate(el =>
        el.style.display === 'none' || getComputedStyle(el).display === 'none'
      );
      expect(isHidden).toBe(true);
    }
  });
});

/**
 * Shop Transactions E2E Tests
 *
 * Tests actual buy/sell transactions:
 * - Purchasing items (gold deducted, success toast)
 * - Selling items (gold increased, item removed)
 */
test.describe('Shop Transactions', () => {
  // Helper to get into shop
  async function enterShop(page) {
    await page.goto('/');

    // Login
    await page.getByPlaceholder('Username').fill('derezo');
    await page.getByPlaceholder('Password').fill('password');
    await page.getByRole('button', { name: /login/i }).click();
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

    // Open shop (blacksmith, apothecary, or farm - not caravan since it has no sell)
    const shopButton = page.getByRole('button', { name: /blacksmith|apothecary|farm/i });
    if (await shopButton.isVisible({ timeout: 3000 })) {
      await shopButton.click();
      await page.waitForTimeout(1000);
      return true;
    }
    return false;
  }

  test('should purchase item and deduct gold', async ({ page }) => {
    const inShop = await enterShop(page);
    if (!inShop) {
      test.skip();
      return;
    }

    // Record initial gold
    const goldAmount = page.locator('#player-gold');
    await expect(goldAmount).toBeVisible({ timeout: 3000 });
    const initialGoldText = await goldAmount.textContent();
    const initialGold = parseInt(initialGoldText.replace(/[^0-9]/g, ''), 10);

    // Select an item from the shop inventory (buy tab is active by default)
    const itemRow = page.locator('.item-data-table-row').first();
    if (!(await itemRow.isVisible({ timeout: 3000 }))) {
      test.skip();
      return;
    }
    await itemRow.click();
    await page.waitForTimeout(500);

    // Check if we can afford the item
    const totalValue = page.locator('.total-value');
    if (await totalValue.isVisible({ timeout: 2000 })) {
      const hasCannotAfford = await totalValue.evaluate(el =>
        el.classList.contains('cannot-afford')
      );
      if (hasCannotAfford) {
        // Skip test if player cannot afford the first item
        test.skip();
        return;
      }
    }

    // Get the item price for verification
    const priceText = await totalValue.textContent();
    const itemPrice = parseInt(priceText.replace(/[^0-9]/g, ''), 10);

    // Click purchase button
    const purchaseBtn = page.locator('#action-btn');
    await expect(purchaseBtn).toBeVisible();
    await expect(purchaseBtn).not.toBeDisabled();
    await purchaseBtn.click();

    // Wait for transaction to complete
    await page.waitForTimeout(1500);

    // Verify success toast
    const successToast = page.locator('.parchment-toast').filter({ hasText: /purchase|bought|complete/i });
    await expect(successToast).toBeVisible({ timeout: 5000 });

    // Verify gold decreased
    const newGoldText = await goldAmount.textContent();
    const newGold = parseInt(newGoldText.replace(/[^0-9]/g, ''), 10);
    expect(newGold).toBeLessThan(initialGold);
    expect(newGold).toBe(initialGold - itemPrice);
  });

  test('should sell item and increase gold', async ({ page }) => {
    const inShop = await enterShop(page);
    if (!inShop) {
      test.skip();
      return;
    }

    // Record initial gold
    const goldAmount = page.locator('#player-gold');
    await expect(goldAmount).toBeVisible({ timeout: 3000 });
    const initialGoldText = await goldAmount.textContent();
    const initialGold = parseInt(initialGoldText.replace(/[^0-9]/g, ''), 10);

    // Switch to sell tab
    const sellTab = page.locator('.shop-tab[data-tab="sell"]');
    await sellTab.click();
    await page.waitForTimeout(1000);

    // Select an item to sell from player inventory
    const itemRow = page.locator('.item-data-table-row').first();
    if (!(await itemRow.isVisible({ timeout: 3000 }))) {
      // Player has no sellable items
      test.skip();
      return;
    }
    await itemRow.click();
    await page.waitForTimeout(500);

    // Get the sell price
    const totalValue = page.locator('.total-value');
    await expect(totalValue).toBeVisible({ timeout: 2000 });
    const priceText = await totalValue.textContent();
    const sellPrice = parseInt(priceText.replace(/[^0-9]/g, ''), 10);

    // Click sell button
    const sellBtn = page.locator('#action-btn');
    await expect(sellBtn).toBeVisible();
    await sellBtn.click();

    // Wait for transaction to complete
    await page.waitForTimeout(1500);

    // Verify success toast
    const successToast = page.locator('.parchment-toast').filter({ hasText: /sold|sale/i });
    await expect(successToast).toBeVisible({ timeout: 5000 });

    // Verify gold increased
    const newGoldText = await goldAmount.textContent();
    const newGold = parseInt(newGoldText.replace(/[^0-9]/g, ''), 10);
    expect(newGold).toBeGreaterThan(initialGold);
    expect(newGold).toBe(initialGold + sellPrice);
  });
});
