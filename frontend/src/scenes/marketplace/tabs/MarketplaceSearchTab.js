/**
 * MarketplaceSearchTab - Browse and search marketplace items
 */

import { ItemDataTable } from '../../../components/ItemDataTable/index.js';
import { marketConfirmDialog } from '../../../components/MarketConfirmDialog.js';
import { ItemIcon } from '../../../components/ItemIcon.js';
import { parchmentToast } from '../../../ui/parchment/ParchmentToast.js';
import { getRarityName, formatStatName, RARITY_COLORS } from '../marketplaceUtils.js';
import { loadOrderBook, renderOrderBookAndTrade, initMarketDashboard } from './MarketplaceTradePanel.js';
import { escapeHtml } from '../../../utils/escapeHtml.js';

/**
 * Render the Search/Browse tab
 * @param {HTMLElement} mainContent - Main content area
 * @param {HTMLElement} sidePanel - Side panel area
 * @param {Object} context - Shared context from MarketplaceScene
 */
export function renderSearchTab(mainContent, sidePanel, context) {
  const { searchResults, selectedItem, browseTable } = context;

  // Destroy existing browse table if any
  if (browseTable) {
    browseTable.destroy();
    context.browseTable = null;
  }

  mainContent.innerHTML = `
    <div class="marketplace-browse-table" id="browse-table-container">
      <!-- ItemDataTable will be rendered here -->
    </div>
  `;

  // Transform search results to ItemDataTable format
  const items = searchResults.map(item => transformItemForBrowseTable(item));

  // Create ItemDataTable for browse
  const tableContainer = mainContent.querySelector('#browse-table-container');
  context.browseTable = new ItemDataTable(tableContainer, {
    items,
    variant: 'marketplace',
    columns: ['rarity', 'iconName', 'stats', 'augments', 'price', 'seller'],
    filters: {
      showTypeFilter: true,
      showRarityFilter: true,
      showAugmentFilter: true,
      showSearch: true
    },
    selectionMode: 'single',
    emptyMessage: 'No items found. Try adjusting your search.',
    maxHeight: 600,
    onRowSelect: (item) => handleBrowseItemSelect(item, sidePanel, context),
    onRowDoubleClick: (item) => handleBrowseItemSelect(item, sidePanel, context)
  });

  // Side panel
  if (selectedItem) {
    renderUnifiedItemPanel(sidePanel, selectedItem, context);
  } else {
    sidePanel.innerHTML = `
      <div class="ui-panel" style="flex: 1; display: flex; align-items: center; justify-content: center;">
        <div class="empty-message">Select an item to view order book and trade</div>
      </div>
    `;
  }
}

/**
 * Transform raw marketplace item data for ItemDataTable
 * @param {Object} item - Raw item from search results
 * @returns {Object} Transformed item for table display
 */
export function transformItemForBrowseTable(item) {
  const rarity = getRarityName(item.rarity);
  const isEquipment = !item.isStackable;
  const hasListings = item.listingCount > 0;

  // Determine price to display
  let displayPrice;
  if (isEquipment && hasListings) {
    displayPrice = item.minListingPrice;
  } else {
    displayPrice = item.bestAsk || item.bestBid || item.basePrice || null;
  }

  // Build seller info for equipment listings
  let sellerInfo = '';
  if (isEquipment) {
    sellerInfo = hasListings ? `${item.listingCount} listing${item.listingCount !== 1 ? 's' : ''}` : 'No listings';
  } else {
    sellerInfo = `Vol: ${item.volume24h || 0}`;
  }

  return {
    // Identity
    id: item.id,
    templateId: item.id,

    // Display
    name: item.name,
    type: item.itemType,
    rarity,
    description: item.description,
    price: displayPrice,
    spriteId: item.spriteId,

    // Stats (from base stats if available)
    baseStats: item.baseStats || {},
    bonusStats: {},

    // Augments
    augments: item.augments || [],

    // Marketplace-specific
    seller: sellerInfo,
    isEquipment,
    hasListings,
    listingCount: item.listingCount,
    minListingPrice: item.minListingPrice,
    maxListingPrice: item.maxListingPrice,
    bestBid: item.bestBid,
    bestAsk: item.bestAsk,
    volume24h: item.volume24h,
    isStackable: item.isStackable,

    // Original item reference
    _original: item
  };
}

/**
 * Handle item selection from browse table
 * @param {Object} item - Selected item (transformed)
 * @param {HTMLElement} sidePanel - Side panel element
 * @param {Object} context - Shared context
 */
async function handleBrowseItemSelect(item, sidePanel, context) {
  const { game } = context;
  const originalItem = item._original;
  if (!originalItem) return;

  // Unsubscribe from previous item if different
  if (context.selectedItem && context.selectedItem.id !== originalItem.id) {
    game.socket?.unsubscribeFromItem(context.selectedItem.id);
  }

  context.selectedItem = originalItem;
  context.orderPrice = originalItem.bestAsk || originalItem.bestBid || originalItem.basePrice || 10;
  context.orderQuantity = 1;

  // Subscribe to new item updates
  game.socket?.subscribeToItem(originalItem.id);

  // Render unified panel
  await renderUnifiedItemPanel(sidePanel, originalItem, context);
}

/**
 * Render unified item detail panel for both stackable and equipment items
 * @param {HTMLElement} sidePanel - The side panel container
 * @param {Object} item - The selected item
 * @param {Object} context - Shared context
 */
async function renderUnifiedItemPanel(sidePanel, item, context) {
  const { game } = context;
  const isEquipment = item.isEquipment || !item.isStackable;

  // Show loading state
  sidePanel.innerHTML = `
    <div id="market-dashboard-container" class="market-dashboard-container" style="margin-bottom: 12px;"></div>
    <div class="ui-panel" style="padding: 20px; text-align: center;">
      <div class="loading-spinner"></div>
      <div style="margin-top: 10px; color: #5a4a3a;">Loading...</div>
    </div>
  `;

  // Initialize MarketDashboard for price chart (works for all items)
  initMarketDashboard(sidePanel, item, context);

  if (isEquipment) {
    // Load equipment listings from API
    try {
      const data = await game.api.getItemListings(item.id);
      context.equipmentListings = data.listings || [];
      renderEquipmentDetailPanel(sidePanel, item, context);
    } catch (err) {
      console.error('Failed to load equipment listings:', err);
      renderEquipmentDetailPanel(sidePanel, item, context);
    }
  } else {
    // Load order book for stackable items
    await loadOrderBook(item.id, context);
    renderOrderBookAndTrade(sidePanel, context);
  }
}

/**
 * Render equipment item detail panel with listings
 * @param {HTMLElement} sidePanel - Side panel container
 * @param {Object} item - Selected item
 * @param {Object} context - Shared context
 */
function renderEquipmentDetailPanel(sidePanel, item, context) {
  const listings = context.equipmentListings || [];

  // Keep the dashboard container, replace the rest
  const dashboardHtml = sidePanel.querySelector('#market-dashboard-container')?.outerHTML ||
    '<div id="market-dashboard-container" class="market-dashboard-container" style="margin-bottom: 12px;"></div>';

  sidePanel.innerHTML = `
    ${dashboardHtml}

    <div class="ui-panel">
      <div class="ui-panel-header">${escapeHtml(item.name || '')} - Available Listings</div>
      <div class="equipment-listings-container" style="max-height: 400px; overflow-y: auto; padding: 8px;">
        ${listings.length > 0 ? listings.map((listing, index) => renderEquipmentListingCard(listing, item, index)).join('') : `
          <div class="empty-message" style="padding: 20px; text-align: center; color: #7a6a5a; font-style: italic;">
            No listings available for this item.<br><br>
            Be the first to list one!
          </div>
        `}
      </div>
    </div>
  `;

  sidePanel.querySelectorAll('[data-equipment-listing-icon]').forEach((container) => {
    const listing = listings[Number(container.dataset.equipmentListingIcon)];
    if (!listing?.augments?.length) return;

    ItemIcon.compositeHtml({
      item: getEquipmentListingIconItem(listing, item),
      size: 'md'
    }).then((html) => {
      if (container.isConnected) container.innerHTML = html;
    }).catch(() => {
      // Preserve the canonical base icon on optional overlay failure.
    });
  });

  // Re-init dashboard if needed
  if (!sidePanel.querySelector('#market-dashboard-container canvas')) {
    initMarketDashboard(sidePanel, item, context);
  }

  // Attach buy handlers
  sidePanel.querySelectorAll('.equipment-buy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const listingId = parseInt(btn.dataset.listingId);
      const listing = listings.find(l => l.listingId === listingId);
      if (listing) {
        handleBuyListing(listing, context);
      }
    });
  });
}

/**
 * Render a single equipment listing card
 * @param {Object} listing - Listing data
 * @param {Object} templateItem - Selected item template
 * @param {number} index - Listing index
 * @returns {string} HTML string
 */
function renderEquipmentListingCard(listing, templateItem, index) {
  const {
    listingId,
    generatedName,
    rarity,
    material,
    baseStats,
    bonusStats,
    augments,
    askPrice,
    sellerName
  } = listing;

  // Format stats
  const baseStatsHtml = Object.entries(baseStats || {})
    .map(([stat, val]) => `<span class="stat-badge">+${val} ${formatStatName(stat)}</span>`)
    .join('');

  const bonusStatsHtml = Object.entries(bonusStats || {})
    .map(([stat, val]) => `<span class="stat-badge bonus">+${val} ${formatStatName(stat)}</span>`)
    .join('');

  // Format augments
  const augmentsHtml = (augments || []).map(aug => {
    const augName = aug.category || aug.name || aug;
    return `<span class="augment-badge">${augName}</span>`;
  }).join('');

  const rarityColor = RARITY_COLORS[rarity] || RARITY_COLORS.common;
  const iconItem = getEquipmentListingIconItem(listing, templateItem);

  return `
    <div class="equipment-listing-card" style="
      background: linear-gradient(to bottom, #e8dcc8 0%, #d9ccb8 100%);
      border: 2px solid #8b7355;
      border-radius: 6px;
      margin-bottom: 8px;
      padding: 10px;
    ">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px;">
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
          <span data-equipment-listing-icon="${index}">${ItemIcon.html({ item: iconItem, size: 'md' })}</span>
          <div>
            <div style="font-weight: bold; color: ${rarityColor};">${escapeHtml(generatedName || '')}</div>
            <div style="font-size: 12px; color: #5a4a3a;">${[rarity, material].filter(Boolean).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' • ')}</div>
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-weight: bold; color: #2d2418;">${askPrice.toLocaleString()}g</div>
          <div style="font-size: 12px; color: #7a6a5a;">by ${escapeHtml(sellerName || '')}</div>
        </div>
      </div>
      ${(baseStatsHtml || bonusStatsHtml || augmentsHtml) ? `
        <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; font-size: 12px;">
          ${baseStatsHtml}${bonusStatsHtml}${augmentsHtml}
        </div>
      ` : ''}
      <button class="equipment-buy-btn" data-listing-id="${listingId}" style="
        width: 100%;
        padding: 6px 12px;
        background: linear-gradient(to bottom, #5a9e4a 0%, #4a8e3a 100%);
        border: 2px solid #3a7e2a;
        border-radius: 4px;
        color: white;
        font-weight: bold;
        cursor: pointer;
      ">Buy for ${askPrice.toLocaleString()}g</button>
    </div>
  `;
}

/**
 * Merge listing-instance fields with its selected template for ItemIcon.
 * @param {Object} listing - Marketplace listing instance
 * @param {Object} templateItem - Selected item template
 * @returns {Object} ItemIcon-compatible item
 */
function getEquipmentListingIconItem(listing, templateItem) {
  return {
    ...templateItem,
    ...listing,
    name: listing.generatedName || templateItem?.name,
    itemType: listing.itemType || templateItem?.itemType,
    spriteId: listing.spriteId || templateItem?.spriteId
  };
}

/**
 * Handle buying an individual item listing
 * @param {Object} listing - Listing to buy
 * @param {Object} context - Shared context
 */
async function handleBuyListing(listing, context) {
  const { game, activeCharacter, playerGold, updateGoldDisplay, loadInitialData, itemPanel } = context;

  if (!activeCharacter) {
    parchmentToast.error('No Character', 'No character selected for trading');
    return;
  }

  // Show confirmation dialog
  marketConfirmDialog.show({
    title: 'Confirm Purchase',
    action: 'buy',
    item: {
      name: listing.generatedName,
      rarity: listing.rarity,
      itemType: listing.itemType || context.selectedItem?.itemType,
      spriteId: listing.spriteId || context.selectedItem?.spriteId,
      augments: listing.augments || []
    },
    quantity: 1,
    price: listing.askPrice,
    total: listing.askPrice,
    currentGold: playerGold,
    onConfirm: async () => {
      try {
        const result = await game.api.buyItemListing(
          listing.listingId,
          activeCharacter.id
        );

        // Update gold
        context.playerGold = result.gold;
        updateGoldDisplay();
        game.state.set('user', { ...game.state.get('user'), gold: result.gold });

        // Play purchase sound effect
        game.audio?.playInteraction('gold_spend');

        parchmentToast.success('Purchase Complete', `Bought ${result.purchase.itemName} for ${result.purchase.price}g`);

        // Close panel and refresh
        itemPanel?.close();
        await loadInitialData();

      } catch (err) {
        parchmentToast.error('Purchase Failed', err.message);
      }
    },
    onCancel: () => {}
  });
}
