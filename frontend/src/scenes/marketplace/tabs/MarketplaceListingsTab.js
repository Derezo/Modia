/**
 * MarketplaceListingsTab - Displays user's active item listings
 */

import { ItemDataTable } from '../../../components/ItemDataTable/index.js';
import { ItemIcon } from '../../../components/ItemIcon.js';
import { parchmentToast } from '../../../ui/parchment/ParchmentToast.js';
import { formatTime, formatListingStats, getRarityName } from '../marketplaceUtils.js';

/**
 * Render the My Listings tab
 * @param {HTMLElement} mainContent - Main content area
 * @param {HTMLElement} sidePanel - Side panel area
 * @param {Object} context - Shared context from MarketplaceScene
 */
export function renderListingsTab(mainContent, sidePanel, context) {
  const { myListings, listingsTable } = context;

  // Destroy existing listings table if any
  if (listingsTable) {
    listingsTable.destroy();
    context.listingsTable = null;
  }

  // Transform listings to ItemDataTable format
  const items = myListings.map(listing => transformListingForTable(listing));

  mainContent.innerHTML = `
    <div class="marketplace-browse-table" id="listings-table-container">
      <!-- ItemDataTable will be rendered here -->
    </div>
  `;

  // Create ItemDataTable for listings
  const tableContainer = mainContent.querySelector('#listings-table-container');
  context.listingsTable = new ItemDataTable(tableContainer, {
    items,
    variant: 'marketplace',
    columns: ['rarity', 'iconName', 'stats', 'augments', 'price'],
    filters: {
      showTypeFilter: true,
      showRarityFilter: true,
      showSearch: true,
      showAugmentFilter: false
    },
    selectionMode: 'single',
    emptyMessage: 'You have no active listings. List items from your inventory to start selling!',
    maxHeight: null, // Height comes from the flex layout in marketplace.css
    onRowSelect: (item) => showListingDetails(item, sidePanel, context)
  });

  // Initial side panel state
  sidePanel.innerHTML = `
    <div class="ui-panel" style="flex: 1;">
      <div class="ui-panel-header">Listing Summary</div>
      <div style="padding: 16px; font-family: Georgia, serif;">
        <div style="margin-bottom: 12px;">
          <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Active Listings</div>
          <div style="font-size: 18px; color: #2d2418; font-family: Consolas, monospace;">${myListings.length}</div>
        </div>
        <div style="margin-bottom: 12px;">
          <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Total Value</div>
          <div style="font-size: 18px; color: #2d2418; font-family: Consolas, monospace; font-weight: bold;">
            ${myListings.reduce((sum, l) => sum + (l.askPrice || 0), 0).toLocaleString()}g
          </div>
        </div>
        <div class="empty-message" style="padding: 20px 0; font-size: 12px;">
          Select a listing to view details or cancel it
        </div>
      </div>
    </div>
  `;
}

/**
 * Transform a listing to ItemDataTable format
 * @param {Object} listing - Raw listing from API
 * @returns {Object} Transformed item for table
 */
function transformListingForTable(listing) {
  const rarity = getRarityName(listing.rarity);

  return {
    // Identity
    id: listing.listingId,
    listingId: listing.listingId,
    instanceId: listing.instanceId,

    // Display
    name: listing.generatedName || listing.itemName || 'Unknown Item',
    type: listing.itemType,
    rarity,
    price: listing.askPrice,
    spriteId: listing.spriteId,

    // Stats
    baseStats: listing.baseStats || {},
    bonusStats: listing.bonusStats || {},

    // Augments
    augments: listing.augments || [],

    // Listing metadata
    listedAt: listing.listedAt,

    // Original reference
    _original: listing
  };
}

/**
 * Show listing details in side panel
 * @param {Object} item - Selected listing (transformed)
 * @param {HTMLElement} sidePanel - Side panel element
 * @param {Object} context - Shared context
 */
function showListingDetails(item, sidePanel, context) {
  const listing = item._original;
  if (!listing) return;

  const listedDate = listing.listedAt ? new Date(listing.listedAt) : null;
  const statsHtml = formatListingStats(listing);

  sidePanel.innerHTML = `
    <div class="ui-panel" style="flex: 1; display: flex; flex-direction: column;">
      <div class="ui-panel-header">Listing Details</div>
      <div style="padding: 16px; font-family: Georgia, serif; flex: 1;">
        <div style="text-align: center; margin-bottom: 16px;">
          <div data-active-listing-icon style="display: flex; justify-content: center; margin-bottom: 8px;">
            ${ItemIcon.html({ item, size: 'lg' })}
          </div>
          <div style="font-size: 18px; font-weight: bold; color: #2d2418;">${item.name}</div>
          <div style="font-size: 12px; color: #5a4a3a; text-transform: capitalize;">${listing.itemType || 'Item'}</div>
        </div>

        ${statsHtml ? `
          <div style="margin-bottom: 16px; padding: 10px; background: rgba(139, 115, 85, 0.1); border-radius: 4px;">
            ${statsHtml}
          </div>
        ` : ''}

        <div style="margin-bottom: 16px;">
          <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase;">Asking Price</div>
          <div style="font-size: 24px; color: #2d2418; font-family: Consolas, monospace; font-weight: bold;">
            ${(listing.askPrice || 0).toLocaleString()}g
          </div>
        </div>

        ${listedDate ? `
          <div style="margin-bottom: 16px;">
            <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase;">Listed</div>
            <div style="font-size: 14px; color: #2d2418;">${formatTime(listedDate)}</div>
          </div>
        ` : ''}

        <button class="cancel-listing-btn" data-listing-id="${listing.listingId}" style="
          width: 100%;
          padding: 12px;
          background: linear-gradient(to bottom, #c45a5a 0%, #a84040 100%);
          border: 2px solid #8b3030;
          border-radius: 4px;
          color: white;
          font-family: Georgia, serif;
          font-size: 14px;
          font-weight: bold;
          cursor: pointer;
          text-transform: uppercase;
          letter-spacing: 1px;
        ">Cancel Listing</button>
      </div>
    </div>
  `;

  if (item.augments?.length > 0) {
    const iconContainer = sidePanel.querySelector('[data-active-listing-icon]');
    ItemIcon.compositeHtml({ item, size: 'lg' })
      .then((html) => {
        if (iconContainer?.isConnected) iconContainer.innerHTML = html;
      })
      .catch(() => {
        // Keep the canonical base icon when overlay compositing fails.
      });
  }

  // Attach cancel handler
  sidePanel.querySelector('.cancel-listing-btn')?.addEventListener('click', async () => {
    await handleCancelListing(listing.listingId, context);
  });
}

/**
 * Handle cancelling a listing
 * @param {number} listingId - ID of listing to cancel
 * @param {Object} context - Shared context
 */
async function handleCancelListing(listingId, context) {
  const { game, updateTabs, renderContent } = context;

  try {
    await game.api.cancelItemListing(listingId);

    parchmentToast.success('Listing Cancelled', 'Your item has been returned to your inventory');

    // Refresh listings
    const listingsData = await game.api.getMyListings();
    context.myListings = listingsData.listings || [];
    updateTabs();
    renderContent();

  } catch (err) {
    parchmentToast.error('Cancel Failed', err.message);
  }
}
