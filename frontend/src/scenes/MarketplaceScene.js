import { Scene } from './Scene.js';
import { marketConfirmDialog } from '../components/MarketConfirmDialog.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { MarketplaceItemPanel } from '../components/MarketplaceItemPanel.js';
import { ItemDataTable } from '../components/ItemDataTable/index.js';
import { MarketDashboard } from '../components/MarketDashboard.js';

/**
 * MarketplaceScene - Full Order Book Trading Interface
 * Allows players to place buy/sell orders and trade items with each other
 */
export class MarketplaceScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.abortController = null;

    // Data
    this.searchResults = [];
    this.selectedItem = null;
    this.orderBook = null;
    this.tradeHistory = [];
    this.myOrders = [];
    this.myListings = [];
    this.sellableItems = []; // Items from inventory that can be listed
    this.playerGold = 0;
    this.activeCharacter = null;

    // UI state
    this.activeTab = 'search'; // 'search', 'orders', 'history', 'listings'
    this.orderSide = 'buy'; // 'buy' or 'sell'
    this.orderType = 'limit'; // 'limit' or 'market'
    this.orderPrice = 0;
    this.orderQuantity = 1;
    this.searchQuery = '';
    this.searchType = '';
    this.searchAugment = ''; // Augment category filter

    // Item panel for viewing unique item listings
    this.itemPanel = null;

    // ItemDataTable instance for browse grid
    this.browseTable = null;

    // ItemDataTable instance for My Listings tab
    this.listingsTable = null;

    // ItemDataTable instance for My Inventory tab
    this.inventoryTable = null;

    // MarketDashboard for price charts
    this.marketDashboard = null;

    // WebSocket handlers
    this.wsHandlers = null;
  }

  async enter(data = {}) {
    // Check if character is at a node with marketplace feature
    const currentNode = this.game.state.get('currentNode');
    const features = currentNode?.features || [];

    if (!features.includes('marketplace')) {
      this.showTravelPrompt(currentNode);
      return;
    }

    this.playerGold = this.game.state.get('user')?.gold || 0;

    // Get active character for trading
    this.activeCharacter = this.game.state.get('activeCharacter');

    if (!this.activeCharacter) {
      parchmentToast.error('No Character', 'No character available for trading. Please select a character first.');
      this.game.scenes.switchTo('characterSelect');
      return;
    }

    this.addStyles();
    this.createUI();
    this.setupEventListeners();
    this.setupWebSocketHandlers();
    this.game.socket?.joinMarketplace();

    // Initialize item panel for viewing unique item listings
    this.itemPanel = new MarketplaceItemPanel(this.game);

    await this.loadInitialData();
  }

  showTravelPrompt(currentNode) {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.className = 'marketplace-travel-modal';
    modal.innerHTML = `
      <div class="modal-backdrop" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      "></div>
      <div class="modal-content" style="
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
        border: 3px solid #6b5344;
        border-radius: 8px;
        padding: 24px;
        max-width: 400px;
        text-align: center;
        z-index: 1001;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      ">
        <h3 style="
          color: #2d2418;
          font-family: Georgia, serif;
          font-size: 20px;
          margin: 0 0 16px 0;
        ">Marketplace Access Required</h3>
        <p style="
          color: #5a4a3a;
          margin: 0 0 8px 0;
        ">The marketplace is located at the <strong>Castle</strong>.</p>
        <p style="
          color: #7a6a5a;
          font-size: 14px;
          margin: 0 0 24px 0;
        ">Current location: <strong>${currentNode?.name || 'Unknown'}</strong></p>
        <div style="display: flex; gap: 12px; justify-content: center;">
          <button id="marketplace-back-btn" style="
            padding: 10px 20px;
            background: linear-gradient(to bottom, #c9b899 0%, #bfae8a 100%);
            border: 2px solid #8b7355;
            border-radius: 4px;
            color: #2d2418;
            font-family: Georgia, serif;
            cursor: pointer;
          ">Back to Map</button>
        </div>
      </div>
    `;

    this.game.uiOverlay.appendChild(modal);

    // Handle back button
    modal.querySelector('#marketplace-back-btn')?.addEventListener('click', () => {
      modal.remove();
      this.game.scenes.switchTo('worldMap');
    });

    // Handle backdrop click
    modal.querySelector('.modal-backdrop')?.addEventListener('click', () => {
      modal.remove();
      this.game.scenes.switchTo('worldMap');
    });
  }

  exit() {
    // Leave marketplace WebSocket room
    this.game.socket?.leaveMarketplace();

    // Unsubscribe from item updates
    if (this.selectedItem) {
      this.game.socket?.unsubscribeFromItem(this.selectedItem.id);
    }

    // Clean up WebSocket handlers
    this.cleanupWebSocketHandlers();

    // Close item panel if open
    if (this.itemPanel) {
      this.itemPanel.close();
      this.itemPanel = null;
    }

    // Destroy browse table
    if (this.browseTable) {
      this.browseTable.destroy();
      this.browseTable = null;
    }

    // Destroy listings table
    if (this.listingsTable) {
      this.listingsTable.destroy();
      this.listingsTable = null;
    }

    // Destroy inventory table
    if (this.inventoryTable) {
      this.inventoryTable.destroy();
      this.inventoryTable = null;
    }

    // Destroy market dashboard
    if (this.marketDashboard) {
      this.marketDashboard.destroy();
      this.marketDashboard = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
  }

  setupWebSocketHandlers() {
    if (!this.game.socket) return;

    this.wsHandlers = {
      'marketplace:orderbook_update': (payload) => {
        if (this.selectedItem?.id === payload.itemTemplateId) {
          // Update local order book data
          this.orderBook = {
            ...this.orderBook,
            bids: payload.bids,
            asks: payload.asks,
            bestBid: payload.bestBid,
            bestAsk: payload.bestAsk,
            spread: payload.spread
          };
          // Re-render order book panel
          const sidePanel = this.uiElement?.querySelector('#side-panel');
          if (sidePanel) {
            this.renderOrderBookAndTrade(sidePanel);
          }
        }
      },

      'marketplace:order_filled': (payload) => {
        const action = payload.side === 'buy' ? 'Bought' : 'Sold';
        parchmentToast.success(
          'Order Filled',
          `${action} ${payload.quantity}x ${payload.itemName} @ ${payload.price}g`
        );

        // Update gold display
        if (payload.newGoldBalance !== undefined) {
          this.playerGold = payload.newGoldBalance;
          this.updateGoldDisplay();
        }

        // Refresh orders tab if viewing
        if (this.activeTab === 'orders') {
          this.loadMyOrders();
        }
      },

      'marketplace:trade_executed': (payload) => {
        // Add to local trade history if viewing this item
        if (this.selectedItem?.id === payload.itemTemplateId) {
          if (!this.tradeHistory) this.tradeHistory = [];
          this.tradeHistory.unshift({
            price: payload.price,
            quantity: payload.quantity,
            executedAt: new Date(payload.timestamp)
          });
          // Keep only last 20 trades
          this.tradeHistory = this.tradeHistory.slice(0, 20);
        }
      },

      'marketplace:order_cancelled': (payload) => {
        parchmentToast.info('Order Cancelled', 'Your order has been cancelled successfully');

        // Refresh orders list
        if (this.activeTab === 'orders') {
          this.loadMyOrders();
        }
      },

      'marketplace:subscribed': (payload) => {
        console.log(`Subscribed to item ${payload.itemTemplateId} updates`);
      },

      'marketplace:order_expired': (payload) => {
        const action = payload.side === 'buy' ? 'Buy order' : 'Sell order';
        parchmentToast.warning(
          'Order Expired',
          `${action} for ${payload.quantityExpired}x ${payload.itemName} has expired`
        );

        // Refresh orders list if viewing
        if (this.activeTab === 'orders') {
          this.loadMyOrders();
        }

        // Refresh listings if a sell order expired
        if (payload.side === 'sell' && this.activeTab === 'listings') {
          this.loadMyListings();
        }
      }
    };

    // Register all handlers
    Object.entries(this.wsHandlers).forEach(([type, handler]) => {
      this.game.socket.on(type, handler);
    });
  }

  cleanupWebSocketHandlers() {
    if (!this.game.socket || !this.wsHandlers) return;

    // Unregister all handlers
    Object.entries(this.wsHandlers).forEach(([type, handler]) => {
      this.game.socket.off(type, handler);
    });
    this.wsHandlers = null;
  }

  async loadMyOrders() {
    try {
      const ordersData = await this.game.api.getMyOrders();
      this.myOrders = ordersData.orders || [];
      this.updateTabs();
      this.renderContent();
    } catch (err) {
      console.error('Failed to load orders:', err);
    }
  }

  async loadInitialData() {
    try {
      const [searchData, ordersData, listingsData, sellableData] = await Promise.all([
        this.game.api.searchMarketItems('', null, null, 30),
        this.game.api.getMyOrders(),
        this.game.api.getMyListings(),
        this.game.api.getSellableInventory()
      ]);

      this.searchResults = searchData.items || [];
      this.myOrders = ordersData.orders || [];
      this.myListings = listingsData.listings || [];
      this.sellableItems = sellableData.items || [];

      this.renderContent();
    } catch (err) {
      console.error('Failed to load marketplace data:', err);
      parchmentToast.error('Load Failed', 'Failed to load marketplace data');
    }
  }

  addStyles() {
    if (document.getElementById('marketplace-scene-styles')) return;

    const style = document.createElement('style');
    style.id = 'marketplace-scene-styles';
    style.textContent = `
      /* ========================================
         MARKETPLACE - Medieval Market Theme
         ======================================== */

      .marketplace-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background:
          linear-gradient(135deg, rgba(180, 160, 130, 0.1) 0%, transparent 50%),
          linear-gradient(225deg, rgba(100, 80, 60, 0.1) 0%, transparent 50%),
          linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
        border: 4px solid #6b5344;
        box-shadow:
          inset 0 0 30px rgba(139, 115, 85, 0.3),
          0 8px 24px rgba(0, 0, 0, 0.4);
        display: flex;
        flex-direction: column;
      }

      /* Header - Wooden Beam Style */
      .marketplace-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 20px;
        background: linear-gradient(to bottom, #a0845c 0%, #8b7355 50%, #6b5344 100%);
        border-bottom: 3px solid #4a3a2a;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .marketplace-title {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .marketplace-title h2 {
        margin: 0;
        color: #f0e8d8;
        font-family: Georgia, serif;
        font-size: 20px;
        text-shadow: 2px 2px 0 #4a3a2a;
      }

      .marketplace-title span {
        color: #d4c4a8;
        font-family: Georgia, serif;
      }

      .marketplace-gold {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #2d2418;  /* Dark brown for readable gold amounts */
        font-family: Consolas, monospace;
        font-size: 16px;
        font-weight: bold;
        text-shadow: 0 1px 2px rgba(255, 255, 255, 0.3);
      }

      /* Tabs - Parchment Style */
      .marketplace-tabs {
        display: flex;
        gap: 4px;
        padding: 10px 20px;
        background: linear-gradient(to bottom, #c9b899 0%, #bfae8a 100%);
        border-bottom: 2px solid #8b7355;
      }

      .marketplace-tab {
        padding: 8px 20px;
        background: linear-gradient(to bottom, #c9b899 0%, #bfae8a 100%);
        border: 2px solid #8b7355;
        border-bottom: none;
        border-radius: 6px 6px 0 0;
        color: #5a4a3a;
        font-family: Georgia, serif;
        font-size: 13px;
        font-weight: normal;
        cursor: pointer;
        transition: all 0.2s;
        margin-bottom: -2px;
      }

      .marketplace-tab:hover {
        background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
        color: #2d2418;
      }

      .marketplace-tab.active {
        background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 100%);
        color: #2d2418;
        font-weight: bold;
      }

      .marketplace-content {
        flex: 1;
        display: flex;
        padding: 12px;
        gap: 12px;
        overflow: hidden;
        min-height: 0;
      }

      .marketplace-left {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .marketplace-right {
        width: 340px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      /* Search Bar */
      .search-bar {
        display: flex;
        gap: 8px;
        padding: 10px;
        background: linear-gradient(to bottom, #e8dcc8 0%, #d9ccb8 100%);
        border: 2px solid #8b7355;
        border-radius: 4px;
        margin-bottom: 12px;
      }

      .search-bar input {
        flex: 1;
        padding: 8px 12px;
        background: #f5edd8;
        border: 2px solid #8b7355;
        border-radius: 4px;
        color: #2d2418;
        font-family: Georgia, serif;
        font-size: 14px;
      }

      .search-bar input:focus {
        outline: none;
        border-color: #6b5344;
        box-shadow: 0 0 0 2px rgba(139, 115, 85, 0.3);
      }

      .search-bar input::placeholder {
        color: #7a6a5a;
      }

      .search-bar select {
        padding: 8px 12px;
        background: #f5edd8;
        border: 2px solid #8b7355;
        border-radius: 4px;
        color: #2d2418;
        font-family: Georgia, serif;
        font-size: 14px;
        cursor: pointer;
      }

      .search-bar select:focus {
        outline: none;
        border-color: #6b5344;
      }

      /* Items Grid */
      .items-grid {
        flex: 1;
        overflow-y: auto;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 8px;
        padding: 4px;
      }

      /* Item Cards - Parchment Pieces */
      .market-item {
        background: linear-gradient(to bottom, #e8dcc8 0%, #d9ccb8 50%, #cfc0a8 100%);
        border: 2px solid #8b7355;
        border-radius: 4px;
        padding: 10px;
        cursor: pointer;
        transition: all 0.2s;
        position: relative;
        color: #2d2418;
        font-family: Georgia, serif;
      }

      .market-item:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
        border-color: #6b5344;
      }

      .market-item.selected {
        border-color: #4a3a2a;
        background: linear-gradient(to bottom, #f0e8d8 0%, #e8dcc8 50%, #d9ccb8 100%);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3), inset 0 0 8px rgba(139, 115, 85, 0.3);
      }

      .market-item-name {
        font-weight: bold;
        color: #2d2418;
        font-size: 13px;
        margin-bottom: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .market-item-info {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: #5a4a3a;
        margin-bottom: 4px;
      }

      .market-item-prices {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        font-family: Consolas, monospace;
      }

      .bid-price {
        color: #3d6b35;
      }

      .ask-price {
        color: #8b4444;
      }

      .no-price {
        color: #7a6a5a;
      }

      /* Order Book - Ledger Style */
      .order-book-panel {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        background: linear-gradient(to bottom, #f0e8d8 0%, #e8dcc8 100%);
        border: 3px solid #6b5344;
        border-radius: 4px;
      }

      .order-book-panel .ui-panel-header {
        background: linear-gradient(to bottom, #8b7355 0%, #7a6345 100%);
        color: #f0e8d8;
        padding: 8px 12px;
        font-family: Georgia, serif;
        font-weight: bold;
        border-bottom: 2px solid #4a3a2a;
      }

      .order-book-header {
        display: flex;
        justify-content: space-between;
        padding: 8px 12px;
        background: linear-gradient(to bottom, #c9b899 0%, #bfae8a 100%);
        font-family: Georgia, serif;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #2d2418;
        border-bottom: 2px solid #8b7355;
      }

      .order-book-content {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        background: linear-gradient(to bottom, #f5edd8 0%, #f0e8d8 100%);
      }

      .order-book-asks, .order-book-bids {
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      .order-book-asks {
        justify-content: flex-end;
      }

      .order-book-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 12px;
        font-size: 12px;
        font-family: Consolas, monospace;
        cursor: pointer;
        position: relative;
        transition: background 0.15s;
      }

      .order-book-row:hover {
        background: rgba(139, 115, 85, 0.15);
      }

      .order-book-row.ask {
        color: #8b4444;
        border-left: 3px solid #8b5555;
      }

      .order-book-row.bid {
        color: #3d6b35;
        border-left: 3px solid #4a7548;
      }

      .order-book-row .depth-bar {
        position: absolute;
        top: 0;
        bottom: 0;
        right: 0;
        opacity: 0.12;
      }

      .order-book-row.ask .depth-bar {
        background: #8b5555;
      }

      .order-book-row.bid .depth-bar {
        background: #4a7548;
      }

      .order-book-spread {
        text-align: center;
        padding: 6px;
        background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 100%);
        font-family: Consolas, monospace;
        font-size: 11px;
        color: #5a4a3a;
        border-top: 2px solid #8b7355;
        border-bottom: 2px solid #8b7355;
      }

      /* Trade Panel */
      .trade-panel {
        background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 100%);
        border: 2px solid #8b7355;
        border-radius: 4px;
        padding: 16px;
      }

      .trade-panel-header {
        font-weight: bold;
        font-family: Georgia, serif;
        color: #2d2418;
        margin-bottom: 12px;
        text-align: center;
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      /* Side Toggle - Wax Seal Style */
      .side-toggle {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
        justify-content: center;
      }

      .side-btn {
        width: 50px;
        height: 50px;
        border-radius: 50%;
        border: 3px solid #4a3a2a;
        font-family: Georgia, serif;
        font-weight: bold;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        text-transform: uppercase;
      }

      .side-btn.buy {
        background: linear-gradient(to bottom, #c9b899, #bfae8a);
        color: #5a4a3a;
      }

      .side-btn.buy:hover {
        background: linear-gradient(to bottom, #d4c4a8, #c9b899);
      }

      .side-btn.buy.active {
        background: radial-gradient(circle at 30% 30%, #5a9e4a 0%, #3d7530 100%);
        color: white;
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .side-btn.sell {
        background: linear-gradient(to bottom, #c9b899, #bfae8a);
        color: #5a4a3a;
      }

      .side-btn.sell:hover {
        background: linear-gradient(to bottom, #d4c4a8, #c9b899);
      }

      .side-btn.sell.active {
        background: radial-gradient(circle at 30% 30%, #c45a5a 0%, #8b3030 100%);
        color: white;
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .order-type-toggle {
        display: flex;
        gap: 4px;
        margin-bottom: 12px;
      }

      .order-type-btn {
        flex: 1;
        padding: 6px;
        border: 2px solid #8b7355;
        border-radius: 4px;
        background: linear-gradient(to bottom, #c9b899 0%, #bfae8a 100%);
        color: #5a4a3a;
        font-family: Georgia, serif;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .order-type-btn:hover {
        background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 100%);
      }

      .order-type-btn.active {
        background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 100%);
        border-color: #6b5344;
        color: #2d2418;
        font-weight: bold;
      }

      /* Trade Inputs */
      .trade-input-group {
        margin-bottom: 10px;
      }

      .trade-input-group label {
        display: block;
        font-family: Georgia, serif;
        font-size: 11px;
        color: #5a4a3a;
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .trade-input-group input {
        width: 100%;
        padding: 8px 10px;
        background: #f5edd8;
        border: 2px solid #8b7355;
        border-radius: 4px;
        color: #2d2418;
        font-family: Consolas, monospace;
        font-size: 14px;
        box-sizing: border-box;
      }

      .trade-input-group input:focus {
        outline: none;
        border-color: #6b5344;
        box-shadow: 0 0 0 2px rgba(139, 115, 85, 0.3);
      }

      /* Trade Summary */
      .trade-summary {
        padding: 10px;
        background: linear-gradient(to bottom, #e8dcc8 0%, #d9ccb8 100%);
        border: 1px solid #8b7355;
        border-radius: 4px;
        margin-bottom: 12px;
      }

      .trade-summary-row {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        margin-bottom: 4px;
      }

      .trade-summary-row:last-child {
        margin-bottom: 0;
        padding-top: 6px;
        border-top: 1px solid #8b7355;
        font-weight: bold;
      }

      .trade-summary-label {
        font-family: Georgia, serif;
        color: #5a4a3a;
      }

      .trade-summary-value {
        font-family: Consolas, monospace;
        color: #2d2418;
      }

      .trade-summary-value.buy {
        color: #3d6b35;
      }

      .trade-summary-value.sell {
        color: #8b4444;
      }

      /* Trade Button */
      .trade-btn {
        width: 100%;
        padding: 12px;
        font-family: Georgia, serif;
        font-size: 14px;
        font-weight: bold;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
        text-transform: uppercase;
        letter-spacing: 1px;
      }

      .trade-btn.buy {
        background: linear-gradient(to bottom, #5a9e4a 0%, #4a8c3a 100%);
        border: 2px solid #3d7530;
        color: white;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }

      .trade-btn.buy:hover {
        background: linear-gradient(to bottom, #6aae5a 0%, #5a9e4a 100%);
        transform: translateY(-1px);
      }

      .trade-btn.sell {
        background: linear-gradient(to bottom, #c45a5a 0%, #a84040 100%);
        border: 2px solid #8b3030;
        color: white;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }

      .trade-btn.sell:hover {
        background: linear-gradient(to bottom, #d46a6a 0%, #c45a5a 100%);
        transform: translateY(-1px);
      }

      .trade-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      /* My Orders List */
      .my-orders-list {
        flex: 1;
        overflow-y: auto;
        min-height: 0;
      }

      .my-order {
        background: linear-gradient(to bottom, #e8dcc8 0%, #d9ccb8 100%);
        border: 2px solid #8b7355;
        border-radius: 4px;
        padding: 10px;
        margin-bottom: 8px;
      }

      .my-order-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
      }

      .my-order-item {
        font-weight: bold;
        font-family: Georgia, serif;
        color: #2d2418;
        font-size: 13px;
      }

      .my-order-side {
        padding: 2px 8px;
        border-radius: 4px;
        font-family: Georgia, serif;
        font-size: 11px;
        font-weight: bold;
      }

      .my-order-side.buy {
        background: linear-gradient(to bottom, #5a9e4a, #4a8c3a);
        color: white;
      }

      .my-order-side.sell {
        background: linear-gradient(to bottom, #c45a5a, #a84040);
        color: white;
      }

      .my-order-info {
        display: flex;
        justify-content: space-between;
        font-family: Consolas, monospace;
        font-size: 12px;
        color: #5a4a3a;
        margin-bottom: 8px;
      }

      .my-order-progress {
        height: 4px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 2px;
        margin-bottom: 8px;
        overflow: hidden;
        border: 1px solid #8b7355;
      }

      .my-order-progress-bar {
        height: 100%;
        background: linear-gradient(to right, #8b7355, #a0845c);
        transition: width 0.3s;
      }

      .cancel-order-btn {
        width: 100%;
        padding: 6px;
        background: linear-gradient(to bottom, #c9b899 0%, #bfae8a 100%);
        border: 2px solid #8b5555;
        border-radius: 4px;
        color: #8b4444;
        font-family: Georgia, serif;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .cancel-order-btn:hover {
        background: linear-gradient(to bottom, #c45a5a 0%, #a84040 100%);
        color: white;
        border-color: #8b3030;
      }

      /* Trade History */
      .trade-history-list {
        flex: 1;
        overflow-y: auto;
      }

      .trade-row {
        display: flex;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: 1px solid #c9b899;
        font-size: 12px;
        color: #2d2418;
      }

      .trade-row:hover {
        background: rgba(139, 115, 85, 0.1);
      }

      .trade-row-time {
        color: #7a6a5a;
        font-size: 10px;
        font-family: Consolas, monospace;
      }

      .empty-message {
        text-align: center;
        color: #7a6a5a;
        font-family: Georgia, serif;
        padding: 30px;
        font-size: 13px;
        font-style: italic;
      }

      /* Rarity Indicators */
      .rarity-1 { border-left: 3px solid #7a6a5a; }
      .rarity-2 { border-left: 3px solid #4a7548; }
      .rarity-3 { border-left: 3px solid #4a6a8b; }
      .rarity-4 { border-left: 3px solid #6b4488; }
      .rarity-5 { border-left: 3px solid #aa8833; }

      /* UI Panel Overrides for Parchment Theme */
      .marketplace-container .ui-panel {
        background: linear-gradient(to bottom, #f0e8d8 0%, #e8dcc8 100%);
        border: 2px solid #8b7355;
        border-radius: 4px;
      }

      .marketplace-container .ui-panel-header {
        background: linear-gradient(to bottom, #8b7355 0%, #7a6345 100%);
        color: #f0e8d8;
        padding: 8px 12px;
        font-family: Georgia, serif;
        font-weight: bold;
        border-bottom: 2px solid #4a3a2a;
        border-radius: 2px 2px 0 0;
      }

      /* Scrollbar Styling */
      .marketplace-container ::-webkit-scrollbar {
        width: 10px;
      }

      .marketplace-container ::-webkit-scrollbar-track {
        background: #c9b899;
        border-radius: 4px;
      }

      .marketplace-container ::-webkit-scrollbar-thumb {
        background: #8b7355;
        border-radius: 4px;
      }

      .marketplace-container ::-webkit-scrollbar-thumb:hover {
        background: #6b5344;
      }

      /* Button Override for Back Button */
      .marketplace-header .btn-secondary {
        background: linear-gradient(to bottom, #c9b899 0%, #bfae8a 100%);
        border: 2px solid #8b7355;
        border-radius: 4px;
        color: #2d2418;
        font-family: Georgia, serif;
        padding: 8px 16px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .marketplace-header .btn-secondary:hover {
        background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 100%);
        transform: translateY(-1px);
      }

      .marketplace-header .btn-primary {
        background: linear-gradient(to bottom, #5a9e4a 0%, #4a8c3a 100%);
        border: 2px solid #3d7530;
        border-radius: 4px;
        color: white;
        font-family: Georgia, serif;
        padding: 8px 16px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .marketplace-header .btn-primary:hover {
        background: linear-gradient(to bottom, #6aae5a 0%, #5a9e4a 100%);
        transform: translateY(-1px);
      }

      /* Gold Display */
      .gold-display {
        color: #2d2418;  /* Dark brown for readable gold amounts */
        font-family: Consolas, monospace;
        font-weight: bold;
        text-shadow: 0 1px 2px rgba(255, 255, 255, 0.3);
      }

      /* ItemDataTable Container for Browse Tab */
      .marketplace-browse-table {
        flex: 1;
        overflow: hidden;
        background: linear-gradient(to bottom, #f0e8d8 0%, #e8dcc8 100%);
        border: 2px solid #8b7355;
        border-radius: 4px;
      }

      .marketplace-browse-table .item-data-table-container {
        border: none;
        border-radius: 0;
        height: 100%;
        background: transparent;
      }

      .marketplace-browse-table .item-data-table-body {
        max-height: none;
        height: calc(100% - 80px);
      }

      /* Marketplace-specific table styling */
      .marketplace-browse-table .item-data-table-row {
        cursor: pointer;
      }

      .marketplace-browse-table .item-data-table-row:hover {
        background: rgba(139, 115, 85, 0.2);
      }

      /* Equipment Listing Badges */
      .stat-badge {
        display: inline-block;
        padding: 2px 6px;
        background: linear-gradient(to bottom, #e8dcc8 0%, #d9ccb8 100%);
        border: 1px solid #8b7355;
        border-radius: 3px;
        color: #2d2418;
        font-family: Consolas, monospace;
      }

      .stat-badge.bonus {
        background: linear-gradient(to bottom, #d4e8c8 0%, #c4d8b8 100%);
        border-color: #5a8b45;
        color: #2d5a18;
      }

      .augment-badge {
        display: inline-block;
        padding: 2px 6px;
        background: linear-gradient(to bottom, #e0d0f0 0%, #d0c0e0 100%);
        border: 1px solid #8b6bbb;
        border-radius: 3px;
        color: #4a2a6a;
        font-family: Georgia, serif;
        font-style: italic;
      }

      /* Loading spinner */
      .loading-spinner {
        width: 30px;
        height: 30px;
        border: 3px solid #c9b899;
        border-top-color: #8b7355;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'marketplace-container';

    container.innerHTML = `
      <div class="marketplace-header">
        <div class="marketplace-title">
          <h2>Marketplace</h2>
          <span style="font-size: 12px;">Trading as: ${this.activeCharacter?.name || 'Unknown'}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 16px;">
          <div class="marketplace-gold">
            <span>Gold:</span>
            <span id="player-gold">${this.playerGold.toLocaleString()}</span>
          </div>
          <button class="btn btn-secondary" id="back-btn">Back to Map</button>
        </div>
      </div>

      <div class="marketplace-tabs">
        <div class="marketplace-tab ${this.activeTab === 'search' ? 'active' : ''}" data-tab="search">Browse Items</div>
        <div class="marketplace-tab ${this.activeTab === 'orders' ? 'active' : ''}" data-tab="orders">My Orders (${this.myOrders.length})</div>
        <div class="marketplace-tab ${this.activeTab === 'listings' ? 'active' : ''}" data-tab="listings">Equipment For Sale (${this.myListings.length})</div>
        <div class="marketplace-tab ${this.activeTab === 'inventory' ? 'active' : ''}" data-tab="inventory">Sell Items</div>
        <div class="marketplace-tab ${this.activeTab === 'history' ? 'active' : ''}" data-tab="history">Trade History</div>
      </div>

      <div class="marketplace-content">
        <div class="marketplace-left" id="main-content"></div>
        <div class="marketplace-right" id="side-panel"></div>
      </div>
    `;

    this.game.uiOverlay.appendChild(container);
    this.uiElement = container;
  }

  setupEventListeners() {
    this.abortController = new AbortController();
    const opts = { signal: this.abortController.signal };

    // Back button
    this.uiElement.querySelector('#back-btn')?.addEventListener('click', () => {
      this.game.scenes.switchTo('worldMap');
    }, opts);

    // Tab switching
    this.uiElement.querySelectorAll('.marketplace-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.activeTab = tab.dataset.tab;
        this.updateTabs();
        this.renderContent();
      }, opts);
    });
  }

  updateTabs() {
    this.uiElement.querySelectorAll('.marketplace-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === this.activeTab);
    });

    // Update orders count
    const ordersTab = this.uiElement.querySelector('[data-tab="orders"]');
    if (ordersTab) {
      ordersTab.textContent = `My Orders (${this.myOrders.length})`;
    }

    // Update listings count
    const listingsTab = this.uiElement.querySelector('[data-tab="listings"]');
    if (listingsTab) {
      listingsTab.textContent = `Equipment For Sale (${this.myListings.length})`;
    }
  }

  renderContent() {
    // Close slide-out item panel when switching tabs
    if (this.itemPanel?.isOpen) {
      this.itemPanel.close();
    }

    const mainContent = this.uiElement.querySelector('#main-content');
    const sidePanel = this.uiElement.querySelector('#side-panel');

    switch (this.activeTab) {
      case 'search':
        this.renderSearchTab(mainContent, sidePanel);
        break;
      case 'orders':
        this.renderOrdersTab(mainContent, sidePanel);
        break;
      case 'listings':
        this.renderListingsTab(mainContent, sidePanel);
        break;
      case 'inventory':
        this.renderInventoryTab(mainContent, sidePanel);
        break;
      case 'history':
        this.renderHistoryTab(mainContent, sidePanel);
        break;
    }
  }

  renderSearchTab(mainContent, sidePanel) {
    // Destroy existing browse table if any
    if (this.browseTable) {
      this.browseTable.destroy();
      this.browseTable = null;
    }

    mainContent.innerHTML = `
      <div class="marketplace-browse-table" id="browse-table-container">
        <!-- ItemDataTable will be rendered here -->
      </div>
    `;

    // Transform search results to ItemDataTable format
    const items = this.searchResults.map(item => this.transformItemForBrowseTable(item));

    // Create ItemDataTable for browse
    const tableContainer = mainContent.querySelector('#browse-table-container');
    this.browseTable = new ItemDataTable(tableContainer, {
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
      onRowSelect: (item) => this.handleBrowseItemSelect(item),
      onRowDoubleClick: (item) => this.handleBrowseItemDoubleClick(item)
    });

    // Side panel
    if (this.selectedItem) {
      this.renderOrderBookAndTrade(sidePanel);
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
  transformItemForBrowseTable(item) {
    // Map rarity number to string if needed
    const rarityMap = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    const rarity = typeof item.rarity === 'number'
      ? rarityMap[item.rarity - 1] || 'common'
      : item.rarity || 'common';

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
   */
  handleBrowseItemSelect(item) {
    const originalItem = item._original;
    if (!originalItem) return;

    // Unsubscribe from previous item if different
    if (this.selectedItem && this.selectedItem.id !== originalItem.id) {
      this.game.socket?.unsubscribeFromItem(this.selectedItem.id);
    }

    this.selectedItem = originalItem;
    this.orderPrice = originalItem.bestAsk || originalItem.bestBid || originalItem.basePrice || 10;
    this.orderQuantity = 1;

    // Subscribe to new item updates
    this.game.socket?.subscribeToItem(originalItem.id);

    // Render unified side panel for ALL items
    const sidePanel = this.uiElement?.querySelector('#side-panel');
    if (sidePanel) {
      this.renderUnifiedItemPanel(sidePanel, originalItem);
    }
  }

  /**
   * Render unified item detail panel for both stackable and equipment items
   * @param {HTMLElement} sidePanel - The side panel container
   * @param {Object} item - The selected item
   */
  async renderUnifiedItemPanel(sidePanel, item) {
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
    this.initMarketDashboard(sidePanel, item);

    if (isEquipment) {
      // Load equipment listings from API
      try {
        const data = await this.game.api.getItemListings(item.id);
        this.equipmentListings = data.listings || [];
        this.renderEquipmentDetailPanel(sidePanel, item);
      } catch (err) {
        console.error('Failed to load equipment listings:', err);
        this.renderEquipmentDetailPanel(sidePanel, item);
      }
    } else {
      // Load order book for stackable items
      await this.loadOrderBook(item.id);
      this.renderOrderBookAndTrade(sidePanel);
    }
  }

  /**
   * Initialize MarketDashboard in the given container
   */
  initMarketDashboard(sidePanel, item) {
    const dashboardContainer = sidePanel.querySelector('#market-dashboard-container');
    if (dashboardContainer) {
      if (this.marketDashboard) {
        this.marketDashboard.destroy();
      }
      this.marketDashboard = new MarketDashboard(dashboardContainer, {
        game: this.game,
        onBuy: (_selectedItem, _price) => {
          this.orderSide = 'buy';
          this.orderType = 'market';
          this.orderQuantity = 1;
          this.handlePlaceOrder();
        }
      });
      this.marketDashboard.setItem({
        ...item,
        templateId: item.id,
        itemType: item.type || item.itemType || (item.isStackable ? 'consumable' : 'equipment')
      });
    }
  }

  /**
   * Render equipment item detail panel with listings
   */
  renderEquipmentDetailPanel(sidePanel, item) {
    const listings = this.equipmentListings || [];

    // Keep the dashboard container, replace the rest
    const dashboardHtml = sidePanel.querySelector('#market-dashboard-container')?.outerHTML ||
      '<div id="market-dashboard-container" class="market-dashboard-container" style="margin-bottom: 12px;"></div>';

    sidePanel.innerHTML = `
      ${dashboardHtml}

      <div class="ui-panel">
        <div class="ui-panel-header">${item.name} - Available Listings</div>
        <div class="equipment-listings-container" style="max-height: 400px; overflow-y: auto; padding: 8px;">
          ${listings.length > 0 ? listings.map(listing => this.renderEquipmentListingCard(listing)).join('') : `
            <div class="empty-message" style="padding: 20px; text-align: center; color: #7a6a5a; font-style: italic;">
              No listings available for this item.<br><br>
              Be the first to list one!
            </div>
          `}
        </div>
      </div>
    `;

    // Re-init dashboard if needed
    if (!sidePanel.querySelector('#market-dashboard-container canvas')) {
      this.initMarketDashboard(sidePanel, item);
    }

    // Attach buy handlers
    sidePanel.querySelectorAll('.equipment-buy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const listingId = parseInt(btn.dataset.listingId);
        const listing = listings.find(l => l.listingId === listingId);
        if (listing) {
          this.handleBuyListing(listing);
        }
      });
    });
  }

  /**
   * Render a single equipment listing card
   */
  renderEquipmentListingCard(listing) {
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
    const formatStatName = (stat) => stat.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());

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

    const rarityColor = {
      common: '#7a6a5a',
      uncommon: '#4a7548',
      rare: '#4a6a8b',
      epic: '#6b4488',
      legendary: '#aa8833'
    }[rarity] || '#7a6a5a';

    return `
      <div class="equipment-listing-card" style="
        background: linear-gradient(to bottom, #e8dcc8 0%, #d9ccb8 100%);
        border: 2px solid #8b7355;
        border-radius: 6px;
        margin-bottom: 8px;
        padding: 10px;
      ">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
          <div>
            <div style="font-weight: bold; color: ${rarityColor};">${generatedName}</div>
            <div style="font-size: 11px; color: #5a4a3a;">${[rarity, material].filter(Boolean).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' • ')}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: bold; color: #2d2418;">${askPrice.toLocaleString()}g</div>
            <div style="font-size: 10px; color: #7a6a5a;">by ${sellerName}</div>
          </div>
        </div>
        ${(baseStatsHtml || bonusStatsHtml || augmentsHtml) ? `
          <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; font-size: 11px;">
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
   * Handle double-click on browse table item
   * @param {Object} item - Double-clicked item (transformed)
   */
  handleBrowseItemDoubleClick(item) {
    // Use unified selection for all items
    this.handleBrowseItemSelect(item);
  }

  renderItemsGrid() {
    if (this.searchResults.length === 0) {
      return '<div class="empty-message">No items found</div>';
    }

    return this.searchResults.map(item => {
      // For non-stackable items, show listing info instead of order book info
      const hasListings = item.listingCount > 0;
      const isEquipment = !item.isStackable;

      // Price display: for equipment show listing prices, for consumables show order book
      let priceHtml;
      if (isEquipment && hasListings) {
        const priceRange = item.minListingPrice === item.maxListingPrice
          ? `${item.minListingPrice}g`
          : `${item.minListingPrice} - ${item.maxListingPrice}g`;
        priceHtml = `
          <div class="market-item-listings" style="color: #2d2418; font-size: 12px; font-family: Consolas, monospace; font-weight: bold;">
            ${item.listingCount} listing${item.listingCount !== 1 ? 's' : ''} • ${priceRange}
          </div>
        `;
      } else if (isEquipment) {
        priceHtml = `
          <div class="market-item-listings" style="color: #7a6a5a; font-size: 11px; font-style: italic;">
            No listings available
          </div>
        `;
      } else {
        // Stackable items - show order book prices
        priceHtml = `
          <div class="market-item-prices">
            <span class="${item.bestBid ? 'bid-price' : 'no-price'}">
              Bid: ${item.bestBid ? item.bestBid + 'g' : '-'}
            </span>
            <span class="${item.bestAsk ? 'ask-price' : 'no-price'}">
              Ask: ${item.bestAsk ? item.bestAsk + 'g' : '-'}
            </span>
          </div>
        `;
      }

      return `
        <div class="market-item rarity-${item.rarity} ${this.selectedItem?.id === item.id ? 'selected' : ''}"
             data-item-id="${item.id}"
             data-is-equipment="${isEquipment}">
          <div class="market-item-name">${item.name}</div>
          <div class="market-item-info">
            <span>${this.capitalize(item.itemType)}</span>
            <span>${isEquipment ? (hasListings ? 'Unique' : '') : 'Vol: ' + item.volume24h}</span>
          </div>
          ${priceHtml}
        </div>
      `;
    }).join('');
  }

  attachItemClickHandlers(container) {
    container.querySelectorAll('.market-item').forEach(el => {
      el.addEventListener('click', async () => {
        const itemId = parseInt(el.dataset.itemId);
        const item = this.searchResults.find(i => i.id === itemId);

        if (item) {
          // Use unified panel for all items
          const sidePanel = this.uiElement?.querySelector('#side-panel');
          if (sidePanel) {
            // Unsubscribe from previous item if different
            if (this.selectedItem && this.selectedItem.id !== itemId) {
              this.game.socket?.unsubscribeFromItem(this.selectedItem.id);
            }

            this.selectedItem = item;
            this.orderPrice = item.bestAsk || item.bestBid || item.basePrice || 10;
            this.orderQuantity = 1;

            // Subscribe to new item updates
            this.game.socket?.subscribeToItem(itemId);

            // Render unified panel
            this.renderUnifiedItemPanel(sidePanel, item);
          }
        }
      });
    });
  }

  /**
   * Open the item panel to show individual listings for equipment items
   */
  openItemPanel(item) {
    if (!this.itemPanel) {
      this.itemPanel = new MarketplaceItemPanel(this.game);
    }

    this.itemPanel.open(
      item.id,
      item.name,
      // onBuy callback
      (listing) => this.handleBuyListing(listing),
      // onClose callback
      () => {
        // Panel closed
      }
    );
  }

  /**
   * Handle buying an individual item listing
   */
  async handleBuyListing(listing) {
    if (!this.activeCharacter) {
      parchmentToast.error('No Character', 'No character selected for trading');
      return;
    }

    // Show confirmation dialog
    marketConfirmDialog.show({
      title: 'Confirm Purchase',
      action: 'buy',
      item: {
        name: listing.generatedName,
        rarity: listing.rarity
      },
      quantity: 1,
      price: listing.askPrice,
      total: listing.askPrice,
      currentGold: this.playerGold,
      onConfirm: async () => {
        try {
          const result = await this.game.api.buyItemListing(
            listing.listingId,
            this.activeCharacter.id
          );

          // Update gold
          this.playerGold = result.gold;
          this.updateGoldDisplay();
          this.game.state.set('user', { ...this.game.state.get('user'), gold: result.gold });

          parchmentToast.success('Purchase Complete', `Bought ${result.purchase.itemName} for ${result.purchase.price}g`);

          // Close panel and refresh
          this.itemPanel?.close();
          await this.loadInitialData();

        } catch (err) {
          parchmentToast.error('Purchase Failed', err.message);
        }
      },
      onCancel: () => {}
    });
  }

  async loadOrderBook(itemTemplateId) {
    try {
      const [orderBookData, historyData] = await Promise.all([
        this.game.api.getOrderBook(itemTemplateId),
        this.game.api.getTradeHistory(itemTemplateId, 20)
      ]);
      this.orderBook = orderBookData;
      this.tradeHistory = historyData.trades || [];
    } catch (err) {
      console.error('Failed to load order book:', err);
      this.orderBook = null;
      this.tradeHistory = [];
    }
  }

  renderOrderBookAndTrade(sidePanel) {
    const item = this.selectedItem;
    const book = this.orderBook;

    // Calculate max quantity for depth bars
    const maxQty = Math.max(
      ...((book?.asks || []).map(a => a.quantity)),
      ...((book?.bids || []).map(b => b.quantity)),
      1
    );

    sidePanel.innerHTML = `
      <div id="market-dashboard-container" class="market-dashboard-container" style="margin-bottom: 12px;"></div>

      <div class="ui-panel order-book-panel">
        <div class="ui-panel-header">${item.name} - Order Book</div>
        <div class="order-book-header">
          <span>Price</span>
          <span>Quantity</span>
        </div>
        <div class="order-book-content">
          <div class="order-book-asks">
            ${(book?.asks || []).slice().reverse().map(ask => `
              <div class="order-book-row ask" data-price="${ask.price}">
                <span>${ask.price}g</span>
                <span>${ask.quantity}</span>
                <div class="depth-bar" style="width: ${(ask.quantity / maxQty) * 100}%"></div>
              </div>
            `).join('') || '<div class="empty-message" style="padding: 10px;">No sell orders</div>'}
          </div>
          <div class="order-book-spread">
            Spread: ${book?.spread !== null ? book.spread + 'g' : '-'} |
            Best Bid: ${book?.bestBid || '-'}g |
            Best Ask: ${book?.bestAsk || '-'}g
          </div>
          <div class="order-book-bids">
            ${(book?.bids || []).map(bid => `
              <div class="order-book-row bid" data-price="${bid.price}">
                <span>${bid.price}g</span>
                <span>${bid.quantity}</span>
                <div class="depth-bar" style="width: ${(bid.quantity / maxQty) * 100}%"></div>
              </div>
            `).join('') || '<div class="empty-message" style="padding: 10px;">No buy orders</div>'}
          </div>
        </div>
      </div>

      <div class="trade-panel">
        <div class="trade-panel-header">Place Order</div>

        <div class="side-toggle">
          <button class="side-btn buy ${this.orderSide === 'buy' ? 'active' : ''}" data-side="buy">Buy</button>
          <button class="side-btn sell ${this.orderSide === 'sell' ? 'active' : ''}" data-side="sell">Sell</button>
        </div>

        <div class="order-type-toggle">
          <button class="order-type-btn ${this.orderType === 'limit' ? 'active' : ''}" data-type="limit">Limit</button>
          <button class="order-type-btn ${this.orderType === 'market' ? 'active' : ''}" data-type="market">Market</button>
        </div>

        ${this.orderType === 'limit' ? `
          <div class="trade-input-group">
            <label>Price (gold)</label>
            <input type="number" id="order-price" value="${this.orderPrice}" min="1">
          </div>
        ` : ''}

        <div class="trade-input-group">
          <label>Quantity</label>
          <input type="number" id="order-quantity" value="${this.orderQuantity}" min="1" max="9999">
        </div>

        ${this.renderTradeSummary()}

        <button class="trade-btn ${this.orderSide}" id="place-order-btn">
          ${this.orderSide === 'buy' ? 'Place Buy Order' : 'Place Sell Order'}
        </button>
      </div>

      ${this.tradeHistory.length > 0 ? `
        <div class="ui-panel" style="max-height: 150px; overflow-y: auto; display: flex; flex-direction: column;">
          <div class="ui-panel-header">Recent Trades</div>
          <div class="trade-history-list">
            ${this.tradeHistory.slice(0, 10).map(trade => `
              <div class="trade-row">
                <span>${trade.price}g x ${trade.quantity}</span>
                <span class="trade-row-time">${this.formatTime(trade.executedAt)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;

    // Attach trade panel handlers
    this.attachTradePanelHandlers(sidePanel);

    // Initialize MarketDashboard for price chart
    const dashboardContainer = sidePanel.querySelector('#market-dashboard-container');
    if (dashboardContainer) {
      // Destroy existing dashboard if any
      if (this.marketDashboard) {
        this.marketDashboard.destroy();
      }

      // Create new dashboard
      this.marketDashboard = new MarketDashboard(dashboardContainer, {
        game: this.game,
        onBuy: (_selectedItem, _price) => {
          // Quick buy at market price
          this.orderSide = 'buy';
          this.orderType = 'market';
          this.orderQuantity = 1;
          this.handlePlaceOrder();
        }
      });

      // Set the selected item to load price history
      this.marketDashboard.setItem({
        ...item,
        templateId: item.id,
        itemType: item.itemType || 'consumable'
      });
    }
  }

  renderTradeSummary() {
    const total = this.orderType === 'limit'
      ? this.orderPrice * this.orderQuantity
      : (this.orderSide === 'buy'
          ? (this.orderBook?.bestAsk || 0) * this.orderQuantity
          : (this.orderBook?.bestBid || 0) * this.orderQuantity);

    const canAfford = this.orderSide === 'buy' ? this.playerGold >= total : true;

    return `
      <div class="trade-summary">
        <div class="trade-summary-row">
          <span class="trade-summary-label">${this.orderType === 'market' ? 'Est. Price' : 'Price'}</span>
          <span class="trade-summary-value">
            ${this.orderType === 'limit'
              ? this.orderPrice.toLocaleString() + 'g'
              : (this.orderSide === 'buy'
                  ? (this.orderBook?.bestAsk ? this.orderBook.bestAsk.toLocaleString() : '-') + 'g'
                  : (this.orderBook?.bestBid ? this.orderBook.bestBid.toLocaleString() : '-') + 'g')}
          </span>
        </div>
        <div class="trade-summary-row">
          <span class="trade-summary-label">Quantity</span>
          <span class="trade-summary-value">${this.orderQuantity.toLocaleString()}</span>
        </div>
        <div class="trade-summary-row">
          <span class="trade-summary-label">Total</span>
          <span class="trade-summary-value ${this.orderSide}" style="${!canAfford ? 'color: #8b4444;' : ''}">
            ${total > 0 ? total.toLocaleString() + 'g' : '-'}
            ${!canAfford ? ' (Insufficient)' : ''}
          </span>
        </div>
      </div>
    `;
  }

  attachTradePanelHandlers(container) {
    // Side toggle
    container.querySelectorAll('.side-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.orderSide = btn.dataset.side;
        this.renderOrderBookAndTrade(container);
      });
    });

    // Order type toggle
    container.querySelectorAll('.order-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.orderType = btn.dataset.type;
        this.renderOrderBookAndTrade(container);
      });
    });

    // Price input
    const priceInput = container.querySelector('#order-price');
    if (priceInput) {
      priceInput.addEventListener('input', () => {
        this.orderPrice = parseInt(priceInput.value) || 1;
        container.querySelector('.trade-summary').outerHTML = this.renderTradeSummary();
      });
    }

    // Quantity input
    const qtyInput = container.querySelector('#order-quantity');
    if (qtyInput) {
      qtyInput.addEventListener('input', () => {
        this.orderQuantity = Math.max(1, Math.min(9999, parseInt(qtyInput.value) || 1));
        container.querySelector('.trade-summary').outerHTML = this.renderTradeSummary();
      });
    }

    // Click on order book row to set price
    container.querySelectorAll('.order-book-row').forEach(row => {
      row.addEventListener('click', () => {
        const price = parseInt(row.dataset.price);
        if (price && priceInput) {
          this.orderPrice = price;
          priceInput.value = price;
          container.querySelector('.trade-summary').outerHTML = this.renderTradeSummary();
        }
      });
    });

    // Place order button
    container.querySelector('#place-order-btn')?.addEventListener('click', () => {
      this.handlePlaceOrder();
    });
  }

  async handlePlaceOrder() {
    if (!this.selectedItem || !this.activeCharacter) return;

    // Calculate price and total for confirmation
    const price = this.orderType === 'limit'
      ? this.orderPrice
      : (this.orderSide === 'buy'
          ? (this.orderBook?.bestAsk || 0)
          : (this.orderBook?.bestBid || 0));

    const total = price * this.orderQuantity;

    // Validate before showing dialog
    if (this.orderSide === 'buy' && this.playerGold < total) {
      parchmentToast.error('Insufficient Gold', `You need ${total.toLocaleString()}g but only have ${this.playerGold.toLocaleString()}g`);
      return;
    }

    if (this.orderType === 'market' && price === 0) {
      parchmentToast.warning('No Orders Available', `No ${this.orderSide === 'buy' ? 'sell' : 'buy'} orders available for market execution`);
      return;
    }

    // Show confirmation dialog
    const dialogTitle = this.orderSide === 'buy'
      ? `Confirm Purchase`
      : `Confirm Sale`;

    marketConfirmDialog.show({
      title: dialogTitle,
      action: this.orderSide,
      item: this.selectedItem,
      quantity: this.orderQuantity,
      price: price,
      total: total,
      currentGold: this.playerGold,
      onConfirm: () => this.executeOrder(),
      onCancel: () => {
        // User cancelled, do nothing
      }
    });
  }

  async executeOrder() {
    if (!this.selectedItem || !this.activeCharacter) {
      console.error('[MarketplaceScene] Cannot execute order - missing:', {
        selectedItem: !!this.selectedItem,
        activeCharacter: !!this.activeCharacter
      });
      return;
    }

    console.log('[MarketplaceScene] Executing order:', {
      itemId: this.selectedItem.id,
      itemName: this.selectedItem.name,
      side: this.orderSide,
      type: this.orderType,
      price: this.orderPrice,
      quantity: this.orderQuantity,
      characterId: this.activeCharacter.id
    });

    try {
      let result;
      if (this.orderType === 'limit') {
        result = await this.game.api.placeLimitOrder(
          this.selectedItem.id,
          this.orderSide,
          this.orderPrice,
          this.orderQuantity,
          this.activeCharacter.id
        );
        console.log('[MarketplaceScene] Order placed, result:', result);
      } else {
        result = await this.game.api.placeMarketOrder(
          this.selectedItem.id,
          this.orderSide,
          this.orderQuantity,
          this.activeCharacter.id
        );
      }

      // Update gold
      this.playerGold = result.gold;
      this.updateGoldDisplay();
      this.game.state.set('user', { ...this.game.state.get('user'), gold: result.gold });

      // Show success toast
      const action = this.orderSide === 'buy' ? 'Buy' : 'Sell';
      const orderTypeLabel = this.orderType === 'limit' ? 'limit' : 'market';
      parchmentToast.success(
        `${action} Order Placed`,
        `${orderTypeLabel.charAt(0).toUpperCase() + orderTypeLabel.slice(1)} order for ${this.orderQuantity}x ${this.selectedItem.name}`
      );

      // Refresh data
      console.log('[MarketplaceScene] Refreshing data...');
      await this.loadOrderBook(this.selectedItem.id);
      const ordersData = await this.game.api.getMyOrders();
      console.log('[MarketplaceScene] My orders:', ordersData);
      this.myOrders = ordersData.orders || [];
      this.updateTabs();
      this.renderContent();
      console.log('[MarketplaceScene] Order flow complete, myOrders count:', this.myOrders.length);

    } catch (err) {
      console.error('[MarketplaceScene] Order failed:', err);
      parchmentToast.error('Order Failed', err.message);
    }
  }

  renderOrdersTab(mainContent, sidePanel) {
    mainContent.innerHTML = `
      <div class="ui-panel" style="flex: 1; display: flex; flex-direction: column;">
        <div class="ui-panel-header">My Open Orders</div>
        <div class="my-orders-list">
          ${this.myOrders.length === 0
            ? '<div class="empty-message">No open orders</div>'
            : this.myOrders.map(order => this.renderMyOrder(order)).join('')}
        </div>
      </div>
    `;

    // Attach cancel handlers
    mainContent.querySelectorAll('.cancel-order-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = parseInt(btn.dataset.orderId);
        await this.handleCancelOrder(orderId);
      });
    });

    sidePanel.innerHTML = `
      <div class="ui-panel" style="flex: 1;">
        <div class="ui-panel-header">Order Summary</div>
        <div style="padding: 16px; font-family: Georgia, serif;">
          <div style="margin-bottom: 12px;">
            <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Buy Orders</div>
            <div style="font-size: 18px; color: #3d6b35; font-family: Consolas, monospace;">
              ${this.myOrders.filter(o => o.side === 'buy').length}
            </div>
          </div>
          <div style="margin-bottom: 12px;">
            <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Sell Orders</div>
            <div style="font-size: 18px; color: #8b4444; font-family: Consolas, monospace;">
              ${this.myOrders.filter(o => o.side === 'sell').length}
            </div>
          </div>
          <div>
            <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Gold Reserved</div>
            <div style="font-size: 18px; color: #2d2418; font-family: Consolas, monospace; font-weight: bold; text-shadow: 0 1px 2px rgba(255,255,255,0.3);">
              ${this.myOrders
                .filter(o => o.side === 'buy')
                .reduce((sum, o) => sum + (o.price * o.quantityRemaining), 0).toLocaleString()}g
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderMyOrder(order) {
    const fillPercent = (order.quantityFilled / order.quantity) * 100;

    return `
      <div class="my-order">
        <div class="my-order-header">
          <span class="my-order-item">${order.itemName}</span>
          <span class="my-order-side ${order.side}">${order.side.toUpperCase()}</span>
        </div>
        <div class="my-order-info">
          <span>${order.price}g x ${order.quantityRemaining}/${order.quantity}</span>
          <span>${order.status}</span>
        </div>
        <div class="my-order-progress">
          <div class="my-order-progress-bar" style="width: ${fillPercent}%"></div>
        </div>
        <button class="cancel-order-btn" data-order-id="${order.id}">Cancel Order</button>
      </div>
    `;
  }

  async handleCancelOrder(orderId) {
    try {
      const result = await this.game.api.cancelOrder(orderId);

      // Update gold
      this.playerGold = result.gold;
      this.updateGoldDisplay();
      this.game.state.set('user', { ...this.game.state.get('user'), gold: result.gold });

      // Show success toast
      parchmentToast.success('Order Cancelled', 'Your order has been cancelled and funds returned');

      // Refresh orders
      const ordersData = await this.game.api.getMyOrders();
      this.myOrders = ordersData.orders || [];
      this.updateTabs();
      this.renderContent();

    } catch (err) {
      parchmentToast.error('Cancel Failed', err.message);
    }
  }

  /**
   * Render the My Listings tab - shows active item listings
   * @param {HTMLElement} mainContent - Main content area
   * @param {HTMLElement} sidePanel - Side panel area
   */
  renderListingsTab(mainContent, sidePanel) {
    // Destroy existing listings table if any
    if (this.listingsTable) {
      this.listingsTable.destroy();
      this.listingsTable = null;
    }

    // Transform listings to ItemDataTable format
    const items = this.myListings.map(listing => this.transformListingForTable(listing));

    mainContent.innerHTML = `
      <div class="marketplace-browse-table" id="listings-table-container">
        <!-- ItemDataTable will be rendered here -->
      </div>
    `;

    // Create ItemDataTable for listings
    const tableContainer = mainContent.querySelector('#listings-table-container');
    this.listingsTable = new ItemDataTable(tableContainer, {
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
      maxHeight: 600,
      onRowSelect: (item) => this.showListingDetails(item, sidePanel)
    });

    // Initial side panel state
    sidePanel.innerHTML = `
      <div class="ui-panel" style="flex: 1;">
        <div class="ui-panel-header">Listing Summary</div>
        <div style="padding: 16px; font-family: Georgia, serif;">
          <div style="margin-bottom: 12px;">
            <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Active Listings</div>
            <div style="font-size: 18px; color: #2d2418; font-family: Consolas, monospace;">${this.myListings.length}</div>
          </div>
          <div style="margin-bottom: 12px;">
            <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Total Value</div>
            <div style="font-size: 18px; color: #2d2418; font-family: Consolas, monospace; font-weight: bold;">
              ${this.myListings.reduce((sum, l) => sum + (l.askPrice || 0), 0).toLocaleString()}g
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
  transformListingForTable(listing) {
    const rarityMap = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    const rarity = typeof listing.rarity === 'number'
      ? rarityMap[listing.rarity - 1] || 'common'
      : listing.rarity || 'common';

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
   */
  showListingDetails(item, sidePanel) {
    const listing = item._original;
    if (!listing) return;

    const listedDate = listing.listedAt ? new Date(listing.listedAt) : null;
    const statsHtml = this.formatListingStats(listing);

    sidePanel.innerHTML = `
      <div class="ui-panel" style="flex: 1; display: flex; flex-direction: column;">
        <div class="ui-panel-header">Listing Details</div>
        <div style="padding: 16px; font-family: Georgia, serif; flex: 1;">
          <div style="text-align: center; margin-bottom: 16px;">
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
              <div style="font-size: 14px; color: #2d2418;">${this.formatTime(listedDate)}</div>
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

    // Attach cancel handler
    sidePanel.querySelector('.cancel-listing-btn')?.addEventListener('click', async () => {
      await this.handleCancelListing(listing.listingId);
    });
  }

  /**
   * Format listing stats for display
   * @param {Object} listing - Listing data
   * @returns {string} HTML string of stats
   */
  formatListingStats(listing) {
    const stats = { ...(listing.baseStats || {}), ...(listing.bonusStats || {}) };
    const entries = Object.entries(stats).filter(([, v]) => v && v !== 0);

    if (entries.length === 0) return '';

    const statNames = {
      strength: 'STR', intelligence: 'INT', agility: 'AGI', vitality: 'VIT',
      defense: 'DEF', magicDefense: 'MDEF', attack: 'ATK', magicAttack: 'MATK'
    };

    return entries.map(([k, v]) => {
      const name = statNames[k] || k.toUpperCase();
      const sign = v > 0 ? '+' : '';
      return `<div style="display: flex; justify-content: space-between; padding: 2px 0;">
        <span style="color: #5a4a3a;">${name}</span>
        <span style="color: #3d6b35; font-family: Consolas, monospace;">${sign}${v}</span>
      </div>`;
    }).join('');
  }

  /**
   * Handle cancelling a listing
   * @param {number} listingId - ID of listing to cancel
   */
  async handleCancelListing(listingId) {
    try {
      await this.game.api.cancelItemListing(listingId);

      parchmentToast.success('Listing Cancelled', 'Your item has been returned to your inventory');

      // Refresh listings
      const listingsData = await this.game.api.getMyListings();
      this.myListings = listingsData.listings || [];
      this.updateTabs();
      this.renderContent();

    } catch (err) {
      parchmentToast.error('Cancel Failed', err.message);
    }
  }

  /**
   * Render the Sell Items (My Inventory) tab - shows items that can be listed
   * @param {HTMLElement} mainContent - Main content area
   * @param {HTMLElement} sidePanel - Side panel area
   */
  renderInventoryTab(mainContent, sidePanel) {
    // Destroy existing inventory table if any
    if (this.inventoryTable) {
      this.inventoryTable.destroy();
      this.inventoryTable = null;
    }

    // Transform sellable items to ItemDataTable format
    const items = this.sellableItems.map(item => this.transformSellableItemForTable(item));

    mainContent.innerHTML = `
      <div class="marketplace-browse-table" id="inventory-table-container">
        <!-- ItemDataTable will be rendered here -->
      </div>
    `;

    // Create ItemDataTable for sellable inventory
    const tableContainer = mainContent.querySelector('#inventory-table-container');
    this.inventoryTable = new ItemDataTable(tableContainer, {
      items,
      variant: 'sellable',
      columns: ['rarity', 'iconName', 'quantity', 'estimatedPrice'],
      filters: {
        showTypeFilter: true,
        showRarityFilter: true,
        showSearch: true,
        showAugmentFilter: false
      },
      selectionMode: 'single',
      emptyMessage: 'No items available to sell. Unequip items or acquire more items to list them here.',
      maxHeight: 600,
      onRowSelect: (item) => this.showSellItemPanel(item, sidePanel)
    });

    // Initial side panel state
    sidePanel.innerHTML = `
      <div class="ui-panel" style="flex: 1;">
        <div class="ui-panel-header">List Item for Sale</div>
        <div style="padding: 16px; font-family: Georgia, serif;">
          <div style="margin-bottom: 12px;">
            <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Available Items</div>
            <div style="font-size: 18px; color: #2d2418; font-family: Consolas, monospace;">${this.sellableItems.length}</div>
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
  transformSellableItemForTable(item) {
    const rarityMap = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    const rarity = typeof item.rarity === 'number'
      ? rarityMap[item.rarity - 1] || 'common'
      : item.rarity || 'common';

    return {
      // Identity
      id: item.instanceId,
      instanceId: item.instanceId,
      templateId: item.templateId,
      characterId: item.characterId,

      // Display
      name: item.name,
      type: item.type,
      rarity,
      description: item.description,
      quantity: item.quantity,
      estimatedPrice: item.estimatedPrice,

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
   */
  showSellItemPanel(item, sidePanel) {
    const originalItem = item._original;
    if (!originalItem) return;

    const suggestedPrice = originalItem.estimatedPrice || originalItem.basePrice || 100;
    const statsHtml = this.formatListingStats(originalItem);

    sidePanel.innerHTML = `
      <div class="ui-panel" style="flex: 1; display: flex; flex-direction: column;">
        <div class="ui-panel-header">List for Sale</div>
        <div style="padding: 16px; font-family: Georgia, serif; flex: 1;">
          <div style="text-align: center; margin-bottom: 16px;">
            <div style="font-size: 18px; font-weight: bold; color: #2d2418;">${item.name}</div>
            <div style="font-size: 12px; color: #5a4a3a; text-transform: capitalize;">${item.type || 'Item'}</div>
            <div style="font-size: 11px; color: #7a6a5a; margin-top: 4px;">From: ${originalItem.characterName}</div>
          </div>

          ${statsHtml ? `
            <div style="margin-bottom: 16px; padding: 10px; background: rgba(139, 115, 85, 0.1); border-radius: 4px;">
              ${statsHtml}
            </div>
          ` : ''}

          <div style="margin-bottom: 16px;">
            <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase;">Suggested Price</div>
            <div style="font-size: 16px; color: #7a6a5a; font-family: Consolas, monospace;">
              ~${suggestedPrice.toLocaleString()}g
            </div>
          </div>

          <div style="margin-bottom: 16px;">
            <label style="display: block; color: #5a4a3a; font-size: 12px; margin-bottom: 6px; text-transform: uppercase;">Your Price</label>
            <input type="number" id="listing-price" value="${suggestedPrice}" min="1" style="
              width: 100%;
              padding: 10px;
              font-size: 18px;
              font-family: Consolas, monospace;
              background: #f5edd8;
              border: 2px solid #8b7355;
              border-radius: 4px;
              color: #2d2418;
              box-sizing: border-box;
            " />
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

    // Attach create listing handler
    sidePanel.querySelector('#create-listing-btn')?.addEventListener('click', async () => {
      const priceInput = sidePanel.querySelector('#listing-price');
      const price = parseInt(priceInput?.value, 10);

      if (!price || price < 1) {
        parchmentToast.error('Invalid Price', 'Please enter a valid price');
        return;
      }

      await this.handleCreateListing(originalItem, price);
    });
  }

  /**
   * Handle creating a new listing
   * @param {Object} item - Item to list
   * @param {number} price - Listing price
   */
  async handleCreateListing(item, price) {
    try {
      await this.game.api.createItemListing(
        item.characterId,
        item.instanceId,
        price
      );

      parchmentToast.success('Listing Created', `${item.name} listed for ${price.toLocaleString()}g`);

      // Refresh data
      const [listingsData, sellableData] = await Promise.all([
        this.game.api.getMyListings(),
        this.game.api.getSellableInventory()
      ]);

      this.myListings = listingsData.listings || [];
      this.sellableItems = sellableData.items || [];
      this.updateTabs();
      this.renderContent();

    } catch (err) {
      parchmentToast.error('Listing Failed', err.message);
    }
  }

  async renderHistoryTab(mainContent, sidePanel) {
    // Load user's trade history
    let myTrades = [];
    try {
      const result = await this.game.api.getMyTrades(50);
      myTrades = result.trades || [];
    } catch (err) {
      console.error('Failed to load trade history:', err);
    }

    mainContent.innerHTML = `
      <div class="ui-panel" style="flex: 1; display: flex; flex-direction: column;">
        <div class="ui-panel-header">My Trade History</div>
        <div class="trade-history-list" style="flex: 1; overflow-y: auto;">
          ${myTrades.length === 0
            ? '<div class="empty-message">No trades yet</div>'
            : myTrades.map(trade => `
                <div class="trade-row" style="display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <span class="my-order-side ${trade.side}" style="margin-right: 8px; padding: 2px 6px;">
                      ${trade.side.toUpperCase()}
                    </span>
                    <span style="color: #2d2418; font-family: Georgia, serif;">${trade.itemName}</span>
                  </div>
                  <div style="text-align: right;">
                    <div style="color: #2d2418; font-family: Consolas, monospace; font-weight: bold;">${trade.totalGold.toLocaleString()}g (${trade.price.toLocaleString()}g x ${trade.quantity})</div>
                    <div class="trade-row-time">${this.formatTime(trade.executedAt)}</div>
                  </div>
                </div>
              `).join('')}
        </div>
      </div>
    `;

    // Calculate stats
    const buyTotal = myTrades.filter(t => t.side === 'buy').reduce((s, t) => s + t.totalGold, 0);
    const sellTotal = myTrades.filter(t => t.side === 'sell').reduce((s, t) => s + t.totalGold, 0);

    sidePanel.innerHTML = `
      <div class="ui-panel" style="flex: 1;">
        <div class="ui-panel-header">Trading Stats</div>
        <div style="padding: 16px; font-family: Georgia, serif;">
          <div style="margin-bottom: 12px;">
            <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Total Trades</div>
            <div style="font-size: 18px; color: #2d2418; font-family: Consolas, monospace;">${myTrades.length}</div>
          </div>
          <div style="margin-bottom: 12px;">
            <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Gold Spent</div>
            <div style="font-size: 18px; color: #8b4444; font-family: Consolas, monospace;">${buyTotal.toLocaleString()}g</div>
          </div>
          <div style="margin-bottom: 12px;">
            <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Gold Earned</div>
            <div style="font-size: 18px; color: #3d6b35; font-family: Consolas, monospace;">${sellTotal.toLocaleString()}g</div>
          </div>
          <div>
            <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Net P/L</div>
            <div style="font-size: 18px; color: ${sellTotal - buyTotal >= 0 ? '#3d6b35' : '#8b4444'}; font-family: Consolas, monospace;">
              ${sellTotal - buyTotal >= 0 ? '+' : ''}${(sellTotal - buyTotal).toLocaleString()}g
            </div>
          </div>
        </div>
      </div>
    `;
  }

  updateGoldDisplay() {
    const goldEl = this.uiElement?.querySelector('#player-gold');
    if (goldEl) {
      goldEl.textContent = this.playerGold.toLocaleString();
    }
  }

  formatTime(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ') : '';
  }

  update(deltaTime) {
    // No per-frame updates needed
  }

  render(ctx) {
    // UI is HTML-based - draw parchment background
    ctx.fillStyle = '#c9b899';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
