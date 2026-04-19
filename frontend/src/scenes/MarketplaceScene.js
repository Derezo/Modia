import { Scene } from './Scene.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { MarketplaceItemPanel } from '../components/MarketplaceItemPanel.js';
import { responsive } from '../core/Responsive.js';

// Import extracted CSS
import './marketplace/marketplace.css';

// Import tab components
import {
  renderSearchTab,
  renderOrdersTab,
  renderListingsTab,
  renderInventoryTab,
  renderHistoryTab,
  renderOrderBookAndTrade
} from './marketplace/tabs/index.js';

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
    this.equipmentListings = [];

    // UI state
    this.activeTab = 'search'; // 'search', 'orders', 'history', 'listings'
    this.orderSide = 'buy'; // 'buy' or 'sell'
    this.orderType = 'limit'; // 'limit' or 'market'
    this.orderPrice = 0;
    this.orderQuantity = 1;

    // Item panel for viewing unique item listings
    this.itemPanel = null;

    // ItemDataTable instances
    this.browseTable = null;
    this.listingsTable = null;
    this.inventoryTable = null;

    // MarketDashboard for price charts
    this.marketDashboard = null;

    // WebSocket handlers
    this.wsHandlers = null;

    // Responsive subscription
    this._responsiveUnsubscribe = null;
  }

  async enter(_data = {}) {
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
      parchmentToast.error('No Character', 'No character available for trading. Please reload the page.');
      this.game.scenes.switchTo('worldMap');
      return;
    }

    this.addStyles();
    this.createUI();
    this.setupEventListeners();
    this.setupWebSocketHandlers();
    this.game.socket?.joinMarketplace();

    // Subscribe to responsive breakpoint changes
    this._responsiveUnsubscribe = responsive.onChange(() => this.onBreakpointChange());

    // Initialize item panel for viewing unique item listings
    this.itemPanel = new MarketplaceItemPanel(this.game);

    // Play marketplace music and ambient sounds
    if (this.game.musicContext) {
      this.game.musicContext.playExplorationMusic();
    }
    this.game.audio?.playAmbient('shop_bustle');

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
    // Unsubscribe from responsive changes
    if (this._responsiveUnsubscribe) {
      this._responsiveUnsubscribe();
      this._responsiveUnsubscribe = null;
    }

    // Stop ambient sounds
    this.game.audio?.stopAmbient();

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
            renderOrderBookAndTrade(sidePanel, this.getContext());
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

      'marketplace:order_cancelled': (_payload) => {
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

  async loadMyListings() {
    try {
      const listingsData = await this.game.api.getMyListings();
      this.myListings = listingsData.listings || [];
      this.updateTabs();
      this.renderContent();
    } catch (err) {
      console.error('Failed to load listings:', err);
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
    // CSS is now loaded via import './marketplace/marketplace.css'
    // This method is kept for backward compatibility but does nothing
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

  /**
   * Get context object for tab components
   * Returns this scene instance - tab components can access all properties directly
   */
  getContext() {
    // Return the scene instance with bound methods
    // This allows tab components to read/write state directly
    const scene = this;
    return {
      // Forward all property access to the scene
      get game() { return scene.game; },
      get searchResults() { return scene.searchResults; },
      get selectedItem() { return scene.selectedItem; },
      set selectedItem(val) { scene.selectedItem = val; },
      get orderBook() { return scene.orderBook; },
      set orderBook(val) { scene.orderBook = val; },
      get tradeHistory() { return scene.tradeHistory; },
      set tradeHistory(val) { scene.tradeHistory = val; },
      get myOrders() { return scene.myOrders; },
      set myOrders(val) { scene.myOrders = val; },
      get myListings() { return scene.myListings; },
      set myListings(val) { scene.myListings = val; },
      get sellableItems() { return scene.sellableItems; },
      set sellableItems(val) { scene.sellableItems = val; },
      get playerGold() { return scene.playerGold; },
      set playerGold(val) { scene.playerGold = val; },
      get activeCharacter() { return scene.activeCharacter; },
      get equipmentListings() { return scene.equipmentListings; },
      set equipmentListings(val) { scene.equipmentListings = val; },

      // UI state
      get orderSide() { return scene.orderSide; },
      set orderSide(val) { scene.orderSide = val; },
      get orderType() { return scene.orderType; },
      set orderType(val) { scene.orderType = val; },
      get orderPrice() { return scene.orderPrice; },
      set orderPrice(val) { scene.orderPrice = val; },
      get orderQuantity() { return scene.orderQuantity; },
      set orderQuantity(val) { scene.orderQuantity = val; },

      // Component refs
      get browseTable() { return scene.browseTable; },
      set browseTable(val) { scene.browseTable = val; },
      get listingsTable() { return scene.listingsTable; },
      set listingsTable(val) { scene.listingsTable = val; },
      get inventoryTable() { return scene.inventoryTable; },
      set inventoryTable(val) { scene.inventoryTable = val; },
      get marketDashboard() { return scene.marketDashboard; },
      set marketDashboard(val) { scene.marketDashboard = val; },
      get itemPanel() { return scene.itemPanel; },

      // Methods bound to this scene
      updateGoldDisplay: () => scene.updateGoldDisplay(),
      updateTabs: () => scene.updateTabs(),
      renderContent: () => scene.renderContent(),
      loadInitialData: () => scene.loadInitialData()
    };
  }

  renderContent() {
    // Close slide-out item panel when switching tabs
    if (this.itemPanel?.isOpen) {
      this.itemPanel.close();
    }

    const mainContent = this.uiElement.querySelector('#main-content');
    const sidePanel = this.uiElement.querySelector('#side-panel');
    const context = this.getContext();

    switch (this.activeTab) {
      case 'search':
        renderSearchTab(mainContent, sidePanel, context);
        break;
      case 'orders':
        renderOrdersTab(mainContent, sidePanel, context);
        break;
      case 'listings':
        renderListingsTab(mainContent, sidePanel, context);
        break;
      case 'inventory':
        renderInventoryTab(mainContent, sidePanel, context);
        break;
      case 'history':
        renderHistoryTab(mainContent, sidePanel, context);
        break;
    }
  }

  updateGoldDisplay() {
    const goldEl = this.uiElement?.querySelector('#player-gold');
    if (goldEl) {
      goldEl.textContent = this.playerGold.toLocaleString();
    }
  }

  /**
   * Handle responsive breakpoint changes
   * The marketplace CSS already handles responsive styles via media queries,
   * but we re-render content to ensure any dynamically created elements adapt.
   */
  onBreakpointChange() {
    // Re-render content to apply any responsive changes
    this.renderContent();
  }

  update(_deltaTime) {
    // No per-frame updates needed
  }

  render(ctx) {
    // UI is HTML-based - draw parchment background
    ctx.fillStyle = '#c9b899';
    ctx.fillRect(0, 0, this.game.targetWidth, this.game.targetHeight);
  }
}
