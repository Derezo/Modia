import { Scene } from './Scene.js';
import { marketConfirmDialog } from '../components/MarketConfirmDialog.js';
import { marketToast } from '../components/MarketToast.js';

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
    this.playerGold = 0;
    this.activeCharacter = null;

    // UI state
    this.activeTab = 'search'; // 'search', 'orders', 'history'
    this.orderSide = 'buy'; // 'buy' or 'sell'
    this.orderType = 'limit'; // 'limit' or 'market'
    this.orderPrice = 0;
    this.orderQuantity = 1;
    this.searchQuery = '';
    this.searchType = '';

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
      this.game.showNotification('No character available for trading. Please select a character first.', 'error');
      this.game.scenes.switchTo('characterSelect');
      return;
    }

    this.addStyles();
    this.createUI();
    this.setupEventListeners();
    this.setupWebSocketHandlers();
    this.game.socket?.joinMarketplace();
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
        this.game.showNotification(
          `${action} ${payload.quantity}x ${payload.itemName} @ ${payload.price}g`,
          'success'
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
        this.game.showNotification('Order cancelled successfully', 'info');

        // Refresh orders list
        if (this.activeTab === 'orders') {
          this.loadMyOrders();
        }
      },

      'marketplace:subscribed': (payload) => {
        console.log(`Subscribed to item ${payload.itemTemplateId} updates`);
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
      const [searchData, ordersData] = await Promise.all([
        this.game.api.searchMarketItems('', null, 30),
        this.game.api.getMyOrders()
      ]);

      this.searchResults = searchData.items || [];
      this.myOrders = ordersData.orders || [];

      this.renderContent();
    } catch (err) {
      console.error('Failed to load marketplace data:', err);
      this.game.showNotification('Failed to load marketplace', 'error');
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
        color: #c9a227;
        font-family: Consolas, monospace;
        font-size: 16px;
        font-weight: bold;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
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
        color: #c9a227;
        font-family: Consolas, monospace;
        font-weight: bold;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
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
  }

  renderContent() {
    const mainContent = this.uiElement.querySelector('#main-content');
    const sidePanel = this.uiElement.querySelector('#side-panel');

    switch (this.activeTab) {
      case 'search':
        this.renderSearchTab(mainContent, sidePanel);
        break;
      case 'orders':
        this.renderOrdersTab(mainContent, sidePanel);
        break;
      case 'history':
        this.renderHistoryTab(mainContent, sidePanel);
        break;
    }
  }

  renderSearchTab(mainContent, sidePanel) {
    mainContent.innerHTML = `
      <div class="search-bar">
        <input type="text" id="search-input" placeholder="Search items..." value="${this.searchQuery}">
        <select id="type-filter">
          <option value="">All Types</option>
          <option value="weapon" ${this.searchType === 'weapon' ? 'selected' : ''}>Weapons</option>
          <option value="armor" ${this.searchType === 'armor' ? 'selected' : ''}>Armor</option>
          <option value="accessory" ${this.searchType === 'accessory' ? 'selected' : ''}>Accessories</option>
          <option value="consumable" ${this.searchType === 'consumable' ? 'selected' : ''}>Consumables</option>
          <option value="material" ${this.searchType === 'material' ? 'selected' : ''}>Materials</option>
        </select>
        <button class="btn btn-primary" id="search-btn">Search</button>
      </div>
      <div class="items-grid" id="items-grid">
        ${this.renderItemsGrid()}
      </div>
    `;

    // Search handlers
    const searchInput = mainContent.querySelector('#search-input');
    const typeFilter = mainContent.querySelector('#type-filter');
    const searchBtn = mainContent.querySelector('#search-btn');

    const doSearch = async () => {
      this.searchQuery = searchInput.value;
      this.searchType = typeFilter.value;
      try {
        const result = await this.game.api.searchMarketItems(this.searchQuery, this.searchType || null);
        this.searchResults = result.items || [];
        mainContent.querySelector('#items-grid').innerHTML = this.renderItemsGrid();
        this.attachItemClickHandlers(mainContent);
      } catch (err) {
        this.game.showNotification('Search failed', 'error');
      }
    };

    searchBtn?.addEventListener('click', doSearch);
    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
    });

    this.attachItemClickHandlers(mainContent);

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

  renderItemsGrid() {
    if (this.searchResults.length === 0) {
      return '<div class="empty-message">No items found</div>';
    }

    return this.searchResults.map(item => `
      <div class="market-item rarity-${item.rarity} ${this.selectedItem?.id === item.id ? 'selected' : ''}"
           data-item-id="${item.id}">
        <div class="market-item-name">${item.name}</div>
        <div class="market-item-info">
          <span>${this.capitalize(item.itemType)}</span>
          <span>Vol: ${item.volume24h}</span>
        </div>
        <div class="market-item-prices">
          <span class="${item.bestBid ? 'bid-price' : 'no-price'}">
            Bid: ${item.bestBid ? item.bestBid + 'g' : '-'}
          </span>
          <span class="${item.bestAsk ? 'ask-price' : 'no-price'}">
            Ask: ${item.bestAsk ? item.bestAsk + 'g' : '-'}
          </span>
        </div>
      </div>
    `).join('');
  }

  attachItemClickHandlers(container) {
    container.querySelectorAll('.market-item').forEach(el => {
      el.addEventListener('click', async () => {
        const itemId = parseInt(el.dataset.itemId);
        const item = this.searchResults.find(i => i.id === itemId);
        if (item) {
          // Unsubscribe from previous item
          if (this.selectedItem && this.selectedItem.id !== itemId) {
            this.game.socket?.unsubscribeFromItem(this.selectedItem.id);
          }

          this.selectedItem = item;
          this.orderPrice = item.bestAsk || item.bestBid || item.basePrice || 10;
          this.orderQuantity = 1;

          // Subscribe to new item updates
          this.game.socket?.subscribeToItem(itemId);

          await this.loadOrderBook(itemId);
          this.renderContent();
        }
      });
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
        <div class="ui-panel" style="max-height: 150px; overflow: hidden; display: flex; flex-direction: column;">
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
      marketToast.error('Insufficient Gold', `You need ${total.toLocaleString()}g but only have ${this.playerGold.toLocaleString()}g`);
      return;
    }

    if (this.orderType === 'market' && price === 0) {
      marketToast.warning('No Orders Available', `No ${this.orderSide === 'buy' ? 'sell' : 'buy'} orders available for market execution`);
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
      marketToast.success(
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
      marketToast.error('Order Failed', err.message);
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
            <div style="font-size: 18px; color: #c9a227; font-family: Consolas, monospace; text-shadow: 0 1px 2px rgba(0,0,0,0.3);">
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
      marketToast.success('Order Cancelled', 'Your order has been cancelled and funds returned');

      // Refresh orders
      const ordersData = await this.game.api.getMyOrders();
      this.myOrders = ordersData.orders || [];
      this.updateTabs();
      this.renderContent();

    } catch (err) {
      marketToast.error('Cancel Failed', err.message);
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
                    <div style="color: #c9a227; font-family: Consolas, monospace;">${trade.totalGold.toLocaleString()}g (${trade.price.toLocaleString()}g x ${trade.quantity})</div>
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
