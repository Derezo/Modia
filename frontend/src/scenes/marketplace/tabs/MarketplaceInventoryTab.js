/**
 * MarketplaceInventoryTab - Displays sellable items from user's inventory
 */

import { ItemDataTable } from '../../../components/ItemDataTable/index.js';
import { ItemIcon } from '../../../components/ItemIcon.js';
import { parchmentToast } from '../../../ui/parchment/ParchmentToast.js';
import { buildListingRequest, formatListingStats, getRarityName, RARITY_COLORS } from '../marketplaceUtils.js';
import { escapeHtml } from '../../../utils/escapeHtml.js';
import { renderAugmentList } from '../../../components/AugmentList.js';

/**
 * Render the Sell Items (Inventory) tab
 * @param {HTMLElement} mainContent - Main content area
 * @param {HTMLElement} sidePanel - Side panel area
 * @param {Object} context - Shared context from MarketplaceScene
 */
export function renderInventoryTab(mainContent, sidePanel, context) {
  const { sellableItems, inventoryTable } = context;

  // Destroy existing inventory table if any
  if (inventoryTable) {
    inventoryTable.destroy();
    context.inventoryTable = null;
  }

  // Transform sellable items to ItemDataTable format
  const items = sellableItems.map(item => transformSellableItemForTable(item));

  mainContent.innerHTML = `
    <div class="marketplace-browse-table" id="inventory-table-container">
      <!-- ItemDataTable will be rendered here -->
    </div>
  `;

  // Create ItemDataTable for sellable inventory
  const tableContainer = mainContent.querySelector('#inventory-table-container');
  context.inventoryTable = new ItemDataTable(tableContainer, {
    items,
    variant: 'sellable',
    // Stats and augments help pick what to list; the table hides them itself
    // when it is narrow (phones).
    columns: ['rarity', 'iconName', 'stats', 'augments', 'quantity', 'estimatedPrice'],
    filters: {
      showTypeFilter: true,
      showRarityFilter: true,
      showSearch: true,
      showAugmentFilter: false
    },
    selectionMode: 'single',
    emptyMessage: 'No items available to sell. Unequip items or acquire more items to list them here.',
    maxHeight: null, // Height comes from the flex layout in marketplace.css
    onRowSelect: (item) => showSellItemPanel(item, sidePanel, context)
  });

  // Initial side panel state
  sidePanel.innerHTML = `
    <div class="ui-panel" style="flex: 1;">
      <div class="ui-panel-header">List Item for Sale</div>
      <div style="padding: 16px; font-family: Georgia, serif;">
        <div style="margin-bottom: 12px;">
          <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Available Items</div>
          <div style="font-size: 18px; color: #2d2418; font-family: Georgia, serif; font-variant-numeric: tabular-nums;">${sellableItems.length}</div>
        </div>
        <div class="empty-message" style="padding: 20px 0; font-size: 12px;">
          Select an item to set a price and list it for sale
        </div>
      </div>
    </div>
  `;
}

/**
 * Transform a sellable item to ItemDataTable format
 * @param {Object} item - Raw item from API
 * @returns {Object} Transformed item for table
 */
function transformSellableItemForTable(item) {
  const rarity = getRarityName(item.rarity);

  return {
    // Identity
    id: item.instanceId,
    instanceId: item.instanceId,
    templateId: item.templateId,

    // Display
    name: item.name,
    type: item.type,
    rarity,
    description: item.description,
    quantity: item.quantity,
    estimatedPrice: item.estimatedPrice,
    spriteId: item.spriteId,

    // Stats
    baseStats: item.baseStats || {},
    bonusStats: item.bonusStats || {},

    // Augments
    augments: item.augments || [],

    // Original reference
    _original: item
  };
}

/**
 * Show sell item panel with price input
 * @param {Object} item - Selected item (transformed)
 * @param {HTMLElement} sidePanel - Side panel element
 * @param {Object} context - Shared context
 */
function showSellItemPanel(item, sidePanel, context) {
  const originalItem = item._original;
  if (!originalItem) return;

  const suggestedPrice = originalItem.estimatedPrice || originalItem.basePrice || 100;
  const statsHtml = formatListingStats(originalItem);
  const rarity = getRarityName(originalItem.rarity);
  const rarityLabel = rarity.charAt(0).toUpperCase() + rarity.slice(1);
  // Same augment presentation as the item detail and shop panels
  const augmentsHtml = renderAugmentList(originalItem.augments || []);

  sidePanel.innerHTML = `
    <div class="ui-panel" style="flex: 1; display: flex; flex-direction: column;">
      <div class="ui-panel-header">List for Sale</div>
      <div style="padding: 16px; font-family: Georgia, serif; flex: 1;">
        <div style="text-align: center; margin-bottom: 16px;">
          <div data-sell-item-icon style="display: flex; justify-content: center; margin-bottom: 8px;">
            ${ItemIcon.html({ item, size: 'lg' })}
          </div>
          <div style="font-size: 18px; font-weight: bold; color: #2d2418;">${escapeHtml(item.name)}</div>
          <div style="font-size: 12px; color: #5a4a3a;">
            <span style="font-weight: bold; color: ${RARITY_COLORS[rarity] || RARITY_COLORS.common};">${escapeHtml(rarityLabel)}</span>
            <span style="text-transform: capitalize;">${escapeHtml(item.type || 'Item')}</span>
          </div>
          <div style="font-size: 12px; color: #7a6a5a; margin-top: 4px;">Listing as: ${escapeHtml(context.activeCharacter?.name || 'Unknown')}</div>
        </div>

        ${statsHtml ? `
          <div style="margin-bottom: 16px; padding: 10px; background: rgba(139, 115, 85, 0.1); border-radius: 4px;">
            ${statsHtml}
          </div>
        ` : ''}

        ${augmentsHtml ? `
          <div style="margin-bottom: 16px;">
            <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase;">Augments</div>
            ${augmentsHtml}
          </div>
        ` : ''}

        <div style="margin-bottom: 16px;">
          <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase;">Suggested Price</div>
          <div style="font-size: 16px; color: #7a6a5a; font-family: Georgia, serif; font-variant-numeric: tabular-nums;">
            ~${suggestedPrice.toLocaleString()}g
          </div>
        </div>

        <div style="margin-bottom: 16px;">
          <label style="display: block; color: #5a4a3a; font-size: 12px; margin-bottom: 6px; text-transform: uppercase;">Your Price</label>
          <input type="number" id="listing-price" value="${suggestedPrice}" min="1" style="
            width: 100%;
            padding: 10px;
            font-size: 18px;
            font-family: Georgia, serif; font-variant-numeric: tabular-nums;
            background: #f5edd8;
            border: 2px solid #8b7355;
            border-radius: 4px;
            color: #2d2418;
            box-sizing: border-box;
          " />
        </div>

        <div style="margin-bottom: 12px; font-size: 11px; color: #5a4a3a; font-style: italic;">
          A 5% seller fee is taken from the sale price (3% with the Merchant's Seal relic).
        </div>

        <button id="create-listing-btn" style="
          width: 100%;
          padding: 14px;
          background: linear-gradient(to bottom, #5a9e4a 0%, #4a8c3a 100%);
          border: 2px solid #3d7530;
          border-radius: 4px;
          color: white;
          font-family: Georgia, serif;
          font-size: 14px;
          font-weight: bold;
          cursor: pointer;
          text-transform: uppercase;
          letter-spacing: 1px;
        ">List for Sale</button>
      </div>
    </div>
  `;

  if (item.augments?.length > 0) {
    const iconContainer = sidePanel.querySelector('[data-sell-item-icon]');
    ItemIcon.compositeHtml({ item, size: 'lg' })
      .then((html) => {
        if (iconContainer?.isConnected) iconContainer.innerHTML = html;
      })
      .catch(() => {
        // Keep the canonical base icon when overlay compositing fails.
      });
  }

  // Attach create listing handler
  sidePanel.querySelector('#create-listing-btn')?.addEventListener('click', async () => {
    const priceInput = sidePanel.querySelector('#listing-price');
    const price = parseInt(priceInput?.value, 10);

    if (!price || price < 1) {
      parchmentToast.error('Invalid Price', 'Please enter a valid price');
      return;
    }

    await handleCreateListing(originalItem, price, context);
  });
}

/**
 * Handle creating a new listing
 * @param {Object} item - Item to list
 * @param {number} price - Listing price
 * @param {Object} context - Shared context
 */
async function handleCreateListing(item, price, context) {
  const { game, updateTabs, renderContent } = context;

  try {
    const { characterId, characterItemId } = buildListingRequest(item, context.activeCharacter);
    await game.api.createItemListing(characterId, characterItemId, price);

    parchmentToast.success('Listing Created', `${item.name} listed for ${price.toLocaleString()}g`);

    // Refresh data
    const [listingsData, sellableData] = await Promise.all([
      game.api.getMyListings(),
      game.api.getSellableInventory()
    ]);

    context.myListings = listingsData.listings || [];
    context.sellableItems = sellableData.items || [];
    updateTabs();
    renderContent();

  } catch (err) {
    parchmentToast.error('Listing Failed', err.message);
  }
}
