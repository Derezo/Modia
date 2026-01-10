import { Scene } from './Scene.js';

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
  }

  async enter(data = {}) {
    this.playerGold = this.game.state.get('user')?.gold || 0;

    // Get active character for trading
    const party = this.game.state.get('party') || [];
    this.activeCharacter = party.find(c => c.party_slot === 1) || party[0];

    if (!this.activeCharacter) {
      this.game.showNotification('No character available for trading', 'error');
      this.game.scenes.switchTo('worldMap');
      return;
    }

    this.addStyles();
    this.createUI();
    this.setupEventListeners();
    await this.loadInitialData();
  }

  exit() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
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
      .marketplace-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        display: flex;
        flex-direction: column;
      }

      .marketplace-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 20px;
        background: rgba(0,0,0,0.3);
        border-bottom: 1px solid #3a3a5a;
      }

      .marketplace-title {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .marketplace-title h2 {
        margin: 0;
        color: #ffd700;
        font-size: 20px;
      }

      .marketplace-gold {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #ffd700;
        font-size: 16px;
        font-weight: bold;
      }

      .marketplace-tabs {
        display: flex;
        gap: 4px;
        padding: 10px 20px;
        background: rgba(0,0,0,0.2);
        border-bottom: 1px solid #3a3a5a;
      }

      .marketplace-tab {
        padding: 8px 20px;
        background: rgba(0,0,0,0.3);
        border: 2px solid transparent;
        border-radius: 6px 6px 0 0;
        color: #8a8aaa;
        cursor: pointer;
        transition: all 0.2s;
        font-size: 13px;
        font-weight: bold;
      }

      .marketplace-tab:hover {
        background: rgba(74, 144, 217, 0.2);
        color: #6ab0f3;
      }

      .marketplace-tab.active {
        background: rgba(255, 215, 0, 0.2);
        border-color: #ffd700;
        color: #ffd700;
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

      .search-bar {
        display: flex;
        gap: 8px;
        padding: 10px;
        background: rgba(0,0,0,0.2);
        border-radius: 6px;
        margin-bottom: 12px;
      }

      .search-bar input {
        flex: 1;
        padding: 8px 12px;
        background: rgba(0,0,0,0.4);
        border: 1px solid #3a3a5a;
        border-radius: 4px;
        color: #fff;
        font-size: 14px;
      }

      .search-bar input:focus {
        outline: none;
        border-color: #6ab0f3;
      }

      .search-bar select {
        padding: 8px 12px;
        background: rgba(0,0,0,0.4);
        border: 1px solid #3a3a5a;
        border-radius: 4px;
        color: #fff;
        font-size: 14px;
        cursor: pointer;
      }

      .items-grid {
        flex: 1;
        overflow-y: auto;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 8px;
        padding: 4px;
      }

      .market-item {
        background: rgba(0,0,0,0.3);
        border: 2px solid #3a3a5a;
        border-radius: 6px;
        padding: 10px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .market-item:hover {
        border-color: #6ab0f3;
        background: rgba(74, 144, 217, 0.1);
      }

      .market-item.selected {
        border-color: #ffd700;
        background: rgba(255, 215, 0, 0.1);
      }

      .market-item-name {
        font-weight: bold;
        color: #fff;
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
        color: #8a8aaa;
        margin-bottom: 4px;
      }

      .market-item-prices {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
      }

      .bid-price {
        color: #4caf50;
      }

      .ask-price {
        color: #f44336;
      }

      .no-price {
        color: #666;
      }

      .order-book-panel {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .order-book-header {
        display: flex;
        justify-content: space-between;
        padding: 8px 12px;
        background: rgba(0,0,0,0.3);
        font-size: 11px;
        color: #8a8aaa;
        border-bottom: 1px solid #3a3a5a;
      }

      .order-book-content {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
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
        cursor: pointer;
        position: relative;
      }

      .order-book-row:hover {
        background: rgba(255,255,255,0.05);
      }

      .order-book-row.ask {
        color: #f44336;
      }

      .order-book-row.bid {
        color: #4caf50;
      }

      .order-book-row .depth-bar {
        position: absolute;
        top: 0;
        bottom: 0;
        right: 0;
        opacity: 0.15;
      }

      .order-book-row.ask .depth-bar {
        background: #f44336;
      }

      .order-book-row.bid .depth-bar {
        background: #4caf50;
      }

      .order-book-spread {
        text-align: center;
        padding: 6px;
        background: rgba(0,0,0,0.3);
        font-size: 11px;
        color: #8a8aaa;
        border-top: 1px solid #3a3a5a;
        border-bottom: 1px solid #3a3a5a;
      }

      .trade-panel {
        background: rgba(0,0,0,0.2);
        border-radius: 6px;
        padding: 12px;
      }

      .trade-panel-header {
        font-weight: bold;
        color: #ffd700;
        margin-bottom: 12px;
        text-align: center;
      }

      .side-toggle {
        display: flex;
        gap: 4px;
        margin-bottom: 12px;
      }

      .side-btn {
        flex: 1;
        padding: 10px;
        border: 2px solid #3a3a5a;
        border-radius: 6px;
        background: rgba(0,0,0,0.3);
        color: #8a8aaa;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
      }

      .side-btn.buy.active {
        background: rgba(76, 175, 80, 0.3);
        border-color: #4caf50;
        color: #4caf50;
      }

      .side-btn.sell.active {
        background: rgba(244, 67, 54, 0.3);
        border-color: #f44336;
        color: #f44336;
      }

      .order-type-toggle {
        display: flex;
        gap: 4px;
        margin-bottom: 12px;
      }

      .order-type-btn {
        flex: 1;
        padding: 6px;
        border: 1px solid #3a3a5a;
        border-radius: 4px;
        background: rgba(0,0,0,0.2);
        color: #8a8aaa;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .order-type-btn.active {
        background: rgba(74, 144, 217, 0.3);
        border-color: #6ab0f3;
        color: #6ab0f3;
      }

      .trade-input-group {
        margin-bottom: 10px;
      }

      .trade-input-group label {
        display: block;
        font-size: 11px;
        color: #8a8aaa;
        margin-bottom: 4px;
      }

      .trade-input-group input {
        width: 100%;
        padding: 8px 10px;
        background: rgba(0,0,0,0.4);
        border: 1px solid #3a3a5a;
        border-radius: 4px;
        color: #fff;
        font-size: 14px;
        box-sizing: border-box;
      }

      .trade-input-group input:focus {
        outline: none;
        border-color: #6ab0f3;
      }

      .trade-summary {
        padding: 10px;
        background: rgba(0,0,0,0.3);
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
        border-top: 1px solid #3a3a5a;
        font-weight: bold;
      }

      .trade-summary-label {
        color: #8a8aaa;
      }

      .trade-summary-value {
        color: #fff;
      }

      .trade-summary-value.buy {
        color: #4caf50;
      }

      .trade-summary-value.sell {
        color: #f44336;
      }

      .trade-btn {
        width: 100%;
        padding: 12px;
        font-size: 14px;
        font-weight: bold;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .trade-btn.buy {
        background: #4caf50;
        border: none;
        color: #fff;
      }

      .trade-btn.buy:hover {
        background: #43a047;
      }

      .trade-btn.sell {
        background: #f44336;
        border: none;
        color: #fff;
      }

      .trade-btn.sell:hover {
        background: #e53935;
      }

      .trade-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .my-orders-list {
        flex: 1;
        overflow-y: auto;
      }

      .my-order {
        background: rgba(0,0,0,0.3);
        border: 1px solid #3a3a5a;
        border-radius: 6px;
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
        color: #fff;
        font-size: 13px;
      }

      .my-order-side {
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: bold;
      }

      .my-order-side.buy {
        background: rgba(76, 175, 80, 0.3);
        color: #4caf50;
      }

      .my-order-side.sell {
        background: rgba(244, 67, 54, 0.3);
        color: #f44336;
      }

      .my-order-info {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        color: #8a8aaa;
        margin-bottom: 8px;
      }

      .my-order-progress {
        height: 4px;
        background: rgba(0,0,0,0.4);
        border-radius: 2px;
        margin-bottom: 8px;
        overflow: hidden;
      }

      .my-order-progress-bar {
        height: 100%;
        background: #6ab0f3;
        transition: width 0.3s;
      }

      .cancel-order-btn {
        width: 100%;
        padding: 6px;
        background: rgba(244, 67, 54, 0.2);
        border: 1px solid #f44336;
        border-radius: 4px;
        color: #f44336;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .cancel-order-btn:hover {
        background: rgba(244, 67, 54, 0.4);
      }

      .trade-history-list {
        flex: 1;
        overflow-y: auto;
      }

      .trade-row {
        display: flex;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: 1px solid rgba(255,255,255,0.05);
        font-size: 12px;
      }

      .trade-row-time {
        color: #666;
        font-size: 10px;
      }

      .empty-message {
        text-align: center;
        color: #666;
        padding: 30px;
        font-size: 13px;
      }

      .rarity-1 { border-left: 3px solid #9e9e9e; }
      .rarity-2 { border-left: 3px solid #4caf50; }
      .rarity-3 { border-left: 3px solid #2196f3; }
      .rarity-4 { border-left: 3px solid #9c27b0; }
      .rarity-5 { border-left: 3px solid #ff9800; }
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
          <span style="color: #8a8aaa; font-size: 12px;">Trading as: ${this.activeCharacter?.name || 'Unknown'}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 16px;">
          <div class="marketplace-gold">
            <span>Gold:</span>
            <span id="player-gold">${this.playerGold}</span>
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
          this.selectedItem = item;
          this.orderPrice = item.bestAsk || item.bestBid || item.basePrice || 10;
          this.orderQuantity = 1;
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
              ? this.orderPrice + 'g'
              : (this.orderSide === 'buy'
                  ? (this.orderBook?.bestAsk || '-') + 'g'
                  : (this.orderBook?.bestBid || '-') + 'g')}
          </span>
        </div>
        <div class="trade-summary-row">
          <span class="trade-summary-label">Quantity</span>
          <span class="trade-summary-value">${this.orderQuantity}</span>
        </div>
        <div class="trade-summary-row">
          <span class="trade-summary-label">Total</span>
          <span class="trade-summary-value ${this.orderSide}" style="${!canAfford ? 'color: #f44336;' : ''}">
            ${total > 0 ? total + 'g' : '-'}
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

      this.game.showNotification(result.message, 'success');

      // Refresh data
      await this.loadOrderBook(this.selectedItem.id);
      const ordersData = await this.game.api.getMyOrders();
      this.myOrders = ordersData.orders || [];
      this.updateTabs();
      this.renderContent();

    } catch (err) {
      this.game.showNotification(err.message, 'error');
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
        <div style="padding: 16px;">
          <div style="margin-bottom: 12px;">
            <div style="color: #8a8aaa; font-size: 12px; margin-bottom: 4px;">Buy Orders</div>
            <div style="font-size: 18px; color: #4caf50;">
              ${this.myOrders.filter(o => o.side === 'buy').length}
            </div>
          </div>
          <div style="margin-bottom: 12px;">
            <div style="color: #8a8aaa; font-size: 12px; margin-bottom: 4px;">Sell Orders</div>
            <div style="font-size: 18px; color: #f44336;">
              ${this.myOrders.filter(o => o.side === 'sell').length}
            </div>
          </div>
          <div>
            <div style="color: #8a8aaa; font-size: 12px; margin-bottom: 4px;">Gold Reserved</div>
            <div style="font-size: 18px; color: #ffd700;">
              ${this.myOrders
                .filter(o => o.side === 'buy')
                .reduce((sum, o) => sum + (o.price * o.quantityRemaining), 0)}g
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

      this.game.showNotification(result.message, 'success');

      // Refresh orders
      const ordersData = await this.game.api.getMyOrders();
      this.myOrders = ordersData.orders || [];
      this.updateTabs();
      this.renderContent();

    } catch (err) {
      this.game.showNotification(err.message, 'error');
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
                    <span style="color: #fff;">${trade.itemName}</span>
                  </div>
                  <div style="text-align: right;">
                    <div style="color: #ffd700;">${trade.totalGold}g (${trade.price}g x ${trade.quantity})</div>
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
        <div style="padding: 16px;">
          <div style="margin-bottom: 12px;">
            <div style="color: #8a8aaa; font-size: 12px; margin-bottom: 4px;">Total Trades</div>
            <div style="font-size: 18px; color: #fff;">${myTrades.length}</div>
          </div>
          <div style="margin-bottom: 12px;">
            <div style="color: #8a8aaa; font-size: 12px; margin-bottom: 4px;">Gold Spent</div>
            <div style="font-size: 18px; color: #f44336;">${buyTotal}g</div>
          </div>
          <div style="margin-bottom: 12px;">
            <div style="color: #8a8aaa; font-size: 12px; margin-bottom: 4px;">Gold Earned</div>
            <div style="font-size: 18px; color: #4caf50;">${sellTotal}g</div>
          </div>
          <div>
            <div style="color: #8a8aaa; font-size: 12px; margin-bottom: 4px;">Net P/L</div>
            <div style="font-size: 18px; color: ${sellTotal - buyTotal >= 0 ? '#4caf50' : '#f44336'};">
              ${sellTotal - buyTotal >= 0 ? '+' : ''}${sellTotal - buyTotal}g
            </div>
          </div>
        </div>
      </div>
    `;
  }

  updateGoldDisplay() {
    const goldEl = this.uiElement?.querySelector('#player-gold');
    if (goldEl) {
      goldEl.textContent = this.playerGold;
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
    // UI is HTML-based
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
