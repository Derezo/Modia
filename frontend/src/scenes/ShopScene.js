import { Scene } from './Scene.js';
import { responsive } from '../core/Responsive.js';
import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentGradientTextured,
  getParchmentBorder,
  getParchmentShadow,
  getParchmentScrollbarCSS
} from '../ui/parchment/index.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import { Icon } from '../components/Icon.js';
import { ItemDataTable } from '../components/ItemDataTable/index.js';

// Local alias for cleaner access
const P = PARCHMENT_COLORS;

/**
 * ShopScene - Buy and sell items at NPC shops
 * Supports blacksmith, apothecary, and farm shop types
 *
 * Uses the parchment UI theme for a medieval manuscript aesthetic.
 */
export class ShopScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.abortController = null;
    this.responsiveUnsubscribe = null;

    // Shop data
    this.nodeId = null;
    this.shopType = null;
    this.shopName = '';
    this.shopInventory = [];
    this.sellableItems = [];
    this.playerGold = 0;

    // Caravan-specific data
    this.caravanRefreshTime = null;
    this.refreshCountdownInterval = null;

    // UI state
    this.activeTab = 'buy'; // 'buy' or 'sell'
    this.selectedItem = null;
    this.purchaseQuantity = 1;

    // ItemDataTable instance
    this.itemTable = null;
  }

  async enter(data = {}) {
    this.nodeId = data.nodeId;
    this.shopType = data.shopType;
    this.shopName = this.getShopName(data.shopType);
    this.playerGold = this.game.state.get('user')?.gold || 0;

    if (!this.nodeId || !this.shopType) {
      parchmentToast.error('Invalid Shop', 'Could not open this shop');
      this.game.scenes.switchTo('worldMap');
      return;
    }

    this.addStyles();
    this.createUI();
    this.setupEventListeners();

    // Subscribe to responsive breakpoint changes
    this.responsiveUnsubscribe = responsive.onChange(() => this.onBreakpointChange());

    // Play regional shop music and ambient sounds
    if (this.game.musicContext) {
      this.game.musicContext.playNodeMusic('shop');
    }
    this.game.audio?.playAmbient('shop_bustle');

    await this.loadShopData();
  }

  exit() {
    // Stop ambient sounds
    this.game.audio?.stopAmbient();

    if (this.responsiveUnsubscribe) {
      this.responsiveUnsubscribe();
      this.responsiveUnsubscribe = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.refreshCountdownInterval) {
      clearInterval(this.refreshCountdownInterval);
      this.refreshCountdownInterval = null;
    }
    if (this.itemTable) {
      this.itemTable.destroy();
      this.itemTable = null;
    }
    if (this.uiElement) {
      this.uiElement.remove();
      this.uiElement = null;
    }
  }

  /**
   * Handle responsive breakpoint changes - rebuild UI for new screen size
   */
  onBreakpointChange() {
    if (this.uiElement) {
      const selectedId = this.activeTab === 'buy'
        ? this.selectedItem?.templateId
        : this.selectedItem?.instanceId;
      const prevTab = this.activeTab;
      const prevQty = this.purchaseQuantity;

      // Destroy existing table
      if (this.itemTable) {
        this.itemTable.destroy();
        this.itemTable = null;
      }

      this.uiElement.remove();
      this.createUI();
      this.setupEventListeners();
      this.renderInventory();

      // Restore state
      this.activeTab = prevTab;
      this.purchaseQuantity = prevQty;
      this.updateTabs();

      if (selectedId) {
        this.selectItem(selectedId);
      }
    }
  }

  getShopName(shopType) {
    const names = {
      blacksmith: 'Blacksmith',
      apothecary: 'Apothecary',
      farm: 'Farm Store',
      caravan: 'Merchant Caravan'
    };
    return names[shopType] || 'Shop';
  }

  getShopIcon(shopType) {
    const icons = {
      blacksmith: 'anvil',
      apothecary: 'flask',
      farm: 'wheat',
      caravan: 'cart'
    };
    return icons[shopType] || 'store';
  }

  isCaravan() {
    return this.shopType === 'caravan';
  }

  async loadShopData() {
    try {
      if (this.isCaravan()) {
        // Caravan uses special endpoint and doesn't support selling
        const caravanData = await this.game.api.getCaravanInventory(this.nodeId);
        this.shopInventory = caravanData.items || [];
        this.sellableItems = []; // Caravans don't buy from players
        this.caravanRefreshTime = caravanData.nextRefresh ? new Date(caravanData.nextRefresh) : null;

        // Start refresh countdown
        this.startRefreshCountdown();
      } else {
        const [shopData, sellData] = await Promise.all([
          this.game.api.getShopInventory(this.nodeId, this.shopType),
          this.game.api.getSellableItems(this.nodeId, this.shopType)
        ]);

        this.shopInventory = shopData.items || [];
        this.sellableItems = sellData.items || [];
      }

      this.renderInventory();
    } catch (err) {
      console.error('Failed to load shop data:', err);
      parchmentToast.error('Shop Error', 'Failed to load shop inventory');
    }
  }

  startRefreshCountdown() {
    if (this.refreshCountdownInterval) {
      clearInterval(this.refreshCountdownInterval);
    }

    this.updateRefreshCountdown();
    this.refreshCountdownInterval = setInterval(() => {
      this.updateRefreshCountdown();
    }, 60000); // Update every minute
  }

  updateRefreshCountdown() {
    const countdownEl = this.uiElement?.querySelector('#caravan-countdown');
    if (!countdownEl || !this.caravanRefreshTime) return;

    const now = new Date();
    const diff = this.caravanRefreshTime - now;

    if (diff <= 0) {
      countdownEl.textContent = 'Refreshing soon...';
      return;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      countdownEl.textContent = `Refreshes in ${hours}h ${minutes}m`;
    } else {
      countdownEl.textContent = `Refreshes in ${minutes}m`;
    }
  }

  addStyles() {
    if (document.getElementById('shop-scene-styles')) return;

    const _isMobile = responsive.isMobile();
    const _isTablet = responsive.isTablet();

    const style = document.createElement('style');
    style.id = 'shop-scene-styles';
    style.textContent = `
      .shop-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: ${getParchmentGradientTextured()};
        display: flex;
        flex-direction: column;
        font-family: Georgia, 'Times New Roman', serif;
        color: ${P.text.primary};
      }

      .shop-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 24px;
        background: linear-gradient(to bottom, ${P.dark}, ${P.mid});
        border-bottom: ${getParchmentBorder(3)};
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      }

      .shop-title {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .shop-title h2 {
        margin: 0;
        color: ${P.text.primary};
        font-size: 22px;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .shop-gold {
        display: flex;
        align-items: center;
        gap: 8px;
        color: ${P.accent.burgundy};
        font-size: 18px;
        font-weight: bold;
        text-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
      }

      .shop-gold-icon {
        display: flex;
        align-items: center;
      }
      .shop-gold-icon img {
        width: 20px;
        height: 20px;
      }

      .shop-tabs {
        display: flex;
        gap: 4px;
        padding: 12px 24px;
        background: linear-gradient(to bottom, ${P.mid}, ${P.light});
        border-bottom: ${getParchmentBorder()};
      }

      .shop-tab {
        padding: 10px 24px;
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
        border: 2px solid ${P.border};
        border-bottom: none;
        border-radius: 8px 8px 0 0;
        color: ${P.text.secondary};
        cursor: pointer;
        transition: all 0.2s;
        font-size: 14px;
        font-weight: bold;
        font-family: Georgia, serif;
      }

      .shop-tab:hover {
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
        color: ${P.text.primary};
      }

      .shop-tab.active {
        background: linear-gradient(to bottom, #e8d9a8, #d4c498);
        border-color: ${P.accent.burgundy};
        color: ${P.text.primary};
        box-shadow: 0 -2px 6px rgba(107, 45, 61, 0.3);
      }

      .shop-content {
        flex: 1;
        display: flex;
        padding: 16px;
        gap: 16px;
        overflow: hidden;
      }

      @media (max-width: 768px) {
        .shop-content {
          flex-direction: column;
        }
        .shop-detail-panel {
          width: 100% !important;
          max-height: 280px;
        }
      }

      .shop-items-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder()};
        border-radius: 6px;
        box-shadow: ${getParchmentShadow()};
      }

      .shop-panel-header {
        padding: 12px 16px;
        background: linear-gradient(to bottom, ${P.dark}, ${P.mid});
        border-bottom: ${getParchmentBorder()};
        border-radius: 4px 4px 0 0;
        color: ${P.text.primary};
        font-weight: bold;
        font-size: 14px;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .shop-items-table-container {
        flex: 1;
        overflow: hidden;
        padding: 0;
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
      }

      .shop-items-table-container .item-data-table-container {
        border: none;
        border-radius: 0;
        height: 100%;
      }

      .shop-items-table-container .item-data-table-body {
        max-height: none;
        height: calc(100% - 80px); /* Account for filters and header */
      }

      .shop-item {
        background: ${getParchmentGradient()};
        border: 2px solid ${P.border};
        border-radius: 6px;
        padding: 12px;
        cursor: pointer;
        transition: all 0.2s;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
      }

      .shop-item:hover {
        border-color: ${P.accent.burgundy};
        background: linear-gradient(to bottom, #e8d9a8, #d4c498);
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
      }

      .shop-item.selected {
        border-color: ${P.accent.burgundy};
        background: linear-gradient(to bottom, #e8d9a8, #d4c498);
        box-shadow: 0 0 0 2px rgba(107, 45, 61, 0.3), 0 4px 8px rgba(0, 0, 0, 0.2);
      }

      .shop-item.out-of-stock {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .shop-item-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 8px;
      }

      .shop-item-name {
        font-weight: bold;
        color: ${P.text.primary};
        font-size: 14px;
      }

      .shop-item-price {
        color: ${P.accent.burgundy};
        font-weight: bold;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .shop-item-info {
        display: flex;
        gap: 12px;
        font-size: 12px;
        color: ${P.text.secondary};
        margin-bottom: 6px;
      }

      .shop-item-type {
        text-transform: capitalize;
      }

      .shop-item-supply {
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: bold;
      }

      .supply-scarce { background: ${P.state.error}; color: #fff; }
      .supply-low { background: #b86f00; color: #fff; }
      .supply-medium { background: ${P.state.warning}; color: ${P.text.primary}; }
      .supply-high { background: ${P.state.success}; color: #fff; }
      .supply-surplus { background: ${P.state.info}; color: #fff; }

      .shop-item-stats {
        font-size: 11px;
        color: ${P.state.info};
      }

      .shop-item-desc {
        font-size: 11px;
        color: ${P.text.muted};
        margin-top: 4px;
        font-style: italic;
      }

      .shop-detail-panel {
        width: 300px;
        display: flex;
        flex-direction: column;
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder()};
        border-radius: 6px;
        box-shadow: ${getParchmentShadow()};
      }

      .detail-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: 16px;
        overflow-y: auto;
      }

      .detail-header {
        text-align: center;
        padding-bottom: 16px;
        border-bottom: 1px solid ${P.border};
        margin-bottom: 16px;
      }

      .detail-name {
        font-size: 18px;
        font-weight: bold;
        color: ${P.text.primary};
        margin-bottom: 4px;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .detail-type {
        color: ${P.text.secondary};
        font-size: 13px;
        text-transform: capitalize;
      }

      .detail-stats {
        margin-bottom: 16px;
      }

      .detail-stat-row {
        display: flex;
        justify-content: space-between;
        padding: 6px 0;
        border-bottom: 1px solid rgba(139, 115, 85, 0.3);
      }

      .detail-stat-label {
        color: ${P.text.secondary};
      }

      .detail-stat-value {
        color: ${P.state.info};
        font-weight: bold;
      }

      .detail-stat-value.positive {
        color: ${P.state.success};
      }

      .detail-desc {
        color: ${P.text.secondary};
        font-size: 13px;
        font-style: italic;
        padding: 12px;
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
        border: 1px solid ${P.border};
        border-radius: 4px;
        margin-bottom: 16px;
      }

      .detail-actions {
        margin-top: auto;
        padding-top: 16px;
        border-top: 1px solid ${P.border};
      }

      .quantity-selector {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        margin-bottom: 12px;
      }

      .quantity-btn {
        width: 36px;
        height: 36px;
        border-radius: 6px;
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
        border: 2px solid ${P.border};
        color: ${P.text.primary};
        font-size: 18px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.2s;
        font-family: Georgia, serif;
      }

      .quantity-btn:hover:not(:disabled) {
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
        border-color: ${P.accent.burgundy};
      }

      .quantity-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .quantity-value {
        font-size: 18px;
        font-weight: bold;
        color: ${P.text.primary};
        min-width: 40px;
        text-align: center;
      }

      .total-price {
        text-align: center;
        margin-bottom: 12px;
      }

      .total-label {
        color: ${P.text.secondary};
        font-size: 12px;
      }

      .total-value {
        color: ${P.accent.burgundy};
        font-size: 20px;
        font-weight: bold;
        text-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
      }

      .total-value.cannot-afford {
        color: ${P.state.error};
      }

      .action-btn {
        width: 100%;
        padding: 12px;
        font-size: 16px;
        font-weight: bold;
        font-family: Georgia, serif;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .action-btn.buy-btn {
        background: linear-gradient(to bottom, ${P.state.info}, #3a5068);
        border: 2px solid ${P.borderDark};
        color: #fff;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }

      .action-btn.buy-btn:hover:not(:disabled) {
        background: linear-gradient(to bottom, #3a5068, ${P.state.info});
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
      }

      .action-btn.sell-btn {
        background: linear-gradient(to bottom, ${P.state.success}, #3a5538);
        border: 2px solid ${P.borderDark};
        color: #fff;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }

      .action-btn.sell-btn:hover:not(:disabled) {
        background: linear-gradient(to bottom, #3a5538, ${P.state.success});
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
      }

      .action-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .empty-message {
        text-align: center;
        color: ${P.text.muted};
        padding: 40px;
        font-size: 14px;
        font-style: italic;
      }

      /* Rarity borders - preserved for item distinction */
      .rarity-common { border-left: 3px solid #9e9e9e; }
      .rarity-uncommon { border-left: 3px solid #1eff00; }
      .rarity-rare { border-left: 3px solid #0070dd; }
      .rarity-epic { border-left: 3px solid #a335ee; }
      .rarity-legendary { border-left: 3px solid #ff8000; }

      /* Caravan-specific styles */
      .caravan-refresh-info {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        background: linear-gradient(to right, rgba(139, 90, 43, 0.2), transparent);
        border-bottom: 1px solid ${P.border};
        font-size: 13px;
        color: ${P.text.secondary};
      }

      .caravan-refresh-icon {
        font-size: 14px;
      }

      .caravan-exclusive-badge {
        display: inline-block;
        padding: 2px 8px;
        background: linear-gradient(to bottom, #8B5A2B, #5D3A1A);
        color: #FFD700;
        font-size: 10px;
        font-weight: bold;
        border-radius: 4px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border: 1px solid #A0522D;
        text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
        margin-left: 6px;
      }

      .sold-out-badge {
        display: inline-block;
        padding: 3px 10px;
        background: linear-gradient(to bottom, #8B0000, #4a0000);
        color: #fff;
        font-size: 11px;
        font-weight: bold;
        border-radius: 4px;
        text-transform: uppercase;
        letter-spacing: 1px;
        border: 1px solid #5a0000;
        text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
      }

      .shop-item.sold-out {
        opacity: 0.6;
        background: linear-gradient(to bottom, #d0c0a0, #bdb39a);
      }

      .shop-item.sold-out .shop-item-name {
        text-decoration: line-through;
        color: ${P.text.muted};
      }

      .regional-specialty-badge {
        display: inline-block;
        padding: 2px 6px;
        background: linear-gradient(to bottom, ${P.state.info}, #3a5068);
        color: #fff;
        font-size: 9px;
        font-weight: bold;
        border-radius: 3px;
        text-transform: uppercase;
        margin-left: 4px;
      }

      .character-tag {
        font-size: 10px;
        color: ${P.accent.burgundy};
        background: rgba(107, 45, 61, 0.15);
        padding: 2px 6px;
        border-radius: 4px;
        margin-left: 8px;
        border: 1px solid rgba(107, 45, 61, 0.3);
      }

      .back-btn {
        padding: 10px 20px;
        font-size: 14px;
        font-weight: bold;
        font-family: Georgia, serif;
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
        border: 2px solid ${P.border};
        border-radius: 6px;
        color: ${P.text.primary};
        cursor: pointer;
        transition: all 0.2s;
      }

      .back-btn:hover {
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
        border-color: ${P.borderDark};
      }

      /* Themed Scrollbars */
      ${getParchmentScrollbarCSS('.shop-inventory-list')}
      ${getParchmentScrollbarCSS('.shop-panel')}
      ${getParchmentScrollbarCSS('.shop-content')}
    `;
    document.head.appendChild(style);
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'shop-container';

    const isCaravan = this.isCaravan();

    container.innerHTML = `
      <div class="shop-header">
        <div class="shop-title">
          <h2>${this.shopName}</h2>
          ${isCaravan ? '<span class="caravan-exclusive-badge">Exclusive Goods</span>' : ''}
        </div>
        <div style="display: flex; align-items: center; gap: 16px;">
          <div class="shop-gold">
            <div class="shop-gold-icon">${Icon.html('resources', 'gold', { size: 'sm' })}</div>
            <span id="player-gold">${this.playerGold.toLocaleString()}</span>
          </div>
          <button class="back-btn" id="back-btn">Back to Map</button>
        </div>
      </div>

      ${isCaravan ? `
        <div class="caravan-refresh-info">
          <span class="caravan-refresh-icon">⏱</span>
          <span id="caravan-countdown">Calculating...</span>
        </div>
      ` : ''}

      <div class="shop-tabs" ${isCaravan ? 'style="display: none;"' : ''}>
        <div class="shop-tab ${this.activeTab === 'buy' ? 'active' : ''}" data-tab="buy">Buy</div>
        <div class="shop-tab ${this.activeTab === 'sell' ? 'active' : ''}" data-tab="sell">Sell</div>
      </div>

      <div class="shop-content">
        <div class="shop-items-panel">
          <div class="shop-panel-header" id="items-header">
            ${this.activeTab === 'buy' ? 'Shop Inventory' : 'Your Items'}
          </div>
          <div class="shop-items-table-container" id="items-table-container">
            <!-- ItemDataTable will be rendered here -->
          </div>
        </div>

        <div class="shop-detail-panel">
          <div class="shop-panel-header">Item Details</div>
          <div class="detail-content" id="detail-content">
            <div class="empty-message">Select an item to view details</div>
          </div>
        </div>
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
      this.game.audio?.playUI('button_click');
      this.game.scenes.switchTo('worldMap');
    }, opts);

    // Tab switching
    this.uiElement.querySelectorAll('.shop-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.game.audio?.playUI('button_click');
        this.activeTab = tab.dataset.tab;
        this.selectedItem = null;
        this.purchaseQuantity = 1;
        this.updateTabs();
        this.renderInventory();
        this.renderDetailPanel();
      }, opts);
    });
  }

  updateTabs() {
    this.uiElement.querySelectorAll('.shop-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === this.activeTab);
    });
    this.uiElement.querySelector('#items-header').textContent =
      this.activeTab === 'buy' ? 'Shop Inventory' : 'Your Items';
  }

  renderInventory() {
    const containerEl = this.uiElement.querySelector('#items-table-container');
    const rawItems = this.activeTab === 'buy' ? this.shopInventory : this.sellableItems;
    const isBuyMode = this.activeTab === 'buy';

    // Destroy existing table if any
    if (this.itemTable) {
      this.itemTable.destroy();
      this.itemTable = null;
    }

    // Transform items to match ItemDataTable expected format
    const items = rawItems.map(item => this.transformItemForTable(item, isBuyMode));

    // Create ItemDataTable with appropriate variant
    this.itemTable = new ItemDataTable(containerEl, {
      items,
      variant: isBuyMode ? 'shop' : 'inventory',
      columns: isBuyMode
        ? ['rarity', 'iconName', 'supplyLevel', 'quantity', 'price']
        : ['rarity', 'iconName', 'type', 'quantity', 'price'],
      filters: {
        showTypeFilter: true,
        showRarityFilter: true,
        showSearch: true,
        showAugmentFilter: false
      },
      selectionMode: 'single',
      emptyMessage: isBuyMode ? 'No items available for purchase' : 'No items to sell',
      maxHeight: 600,
      onRowSelect: (item) => {
        this.handleTableRowSelect(item, isBuyMode);
      },
      onRowDoubleClick: (item) => {
        // Quick buy/sell on double-click
        this.handleTableRowSelect(item, isBuyMode);
        if (isBuyMode) {
          this.handleBuy();
        } else {
          this.handleSell();
        }
      }
    });
  }

  /**
   * Transform raw item data to ItemDataTable format
   * @param {Object} item - Raw item from API
   * @param {boolean} isBuyMode - Whether in buy mode
   * @returns {Object} Transformed item
   */
  transformItemForTable(item, isBuyMode) {
    // Map rarity number to string if needed
    const rarityMap = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    const rarity = typeof item.rarity === 'number'
      ? rarityMap[item.rarity - 1] || 'common'
      : item.rarity || 'common';

    const isCaravan = this.isCaravan();

    return {
      // Identity
      templateId: item.templateId,
      instanceId: item.instanceId,
      id: isCaravan ? item.id : (isBuyMode ? item.templateId : item.instanceId),

      // Display
      name: item.name,
      type: item.type,
      rarity,
      description: item.description,
      quantity: isCaravan ? item.stock : item.quantity,
      price: isCaravan ? item.price : (isBuyMode ? item.buyPrice : item.sellPrice),

      // Stats
      baseStats: item.statBonuses || {},

      // Shop-specific
      supplyLevel: item.supplyLevel,
      supplyLabel: item.supplyLabel,

      // Caravan-specific
      caravanExclusive: item.caravanExclusive || isCaravan,
      soldOut: isCaravan && item.stock <= 0,
      regionalSpecialty: item.regionalSpecialty,

      // Original item reference for detail panel
      _original: item
    };
  }

  /**
   * Handle row selection from ItemDataTable
   * @param {Object} item - Selected item (transformed)
   * @param {boolean} isBuyMode - Whether in buy mode
   */
  handleTableRowSelect(item, _isBuyMode) {
    // Get the original item for the detail panel
    const originalItem = item._original;
    if (!originalItem) return;

    this.selectedItem = originalItem;
    this.purchaseQuantity = 1;
    this.renderDetailPanel();
  }

  selectItem(itemId) {
    const items = this.activeTab === 'buy' ? this.shopInventory : this.sellableItems;
    const idKey = this.activeTab === 'buy' ? 'templateId' : 'instanceId';

    this.selectedItem = items.find(i => i[idKey] === itemId);
    this.purchaseQuantity = 1;

    // Update table selection
    if (this.itemTable && itemId) {
      this.itemTable.selectItem(itemId);
    }

    this.renderDetailPanel();
  }

  renderDetailPanel() {
    const detailEl = this.uiElement.querySelector('#detail-content');

    if (!this.selectedItem) {
      detailEl.innerHTML = '<div class="empty-message">Select an item to view details</div>';
      return;
    }

    const item = this.selectedItem;
    const isBuyMode = this.activeTab === 'buy';
    const isCaravan = this.isCaravan();

    // Handle caravan items differently
    const unitPrice = isCaravan ? item.price : (isBuyMode ? item.buyPrice : item.sellPrice);
    const totalPrice = unitPrice * this.purchaseQuantity;
    const maxQty = isCaravan ? item.stock : item.quantity;
    const canAfford = isBuyMode ? (this.playerGold >= totalPrice) : true;
    const isSoldOut = isCaravan && maxQty <= 0;

    const statsHtml = this.renderDetailStats(item);

    // Build badges HTML
    let badgesHtml = '';
    if (isCaravan || item.caravanExclusive) {
      badgesHtml += '<span class="caravan-exclusive-badge">Exclusive</span>';
    }
    if (item.regionalSpecialty) {
      badgesHtml += `<span class="regional-specialty-badge">${item.regionalSpecialty}</span>`;
    }

    detailEl.innerHTML = `
      <div class="detail-header">
        <div class="detail-name">${item.name}${badgesHtml}</div>
        <div class="detail-type">${item.type}${item.equipmentSlot ? ` - ${this.formatSlot(item.equipmentSlot)}` : ''}</div>
      </div>

      ${item.description ? `<div class="detail-desc">${item.description}</div>` : ''}

      ${statsHtml ? `<div class="detail-stats">${statsHtml}</div>` : ''}

      ${isSoldOut ? `
        <div class="detail-actions">
          <div style="text-align: center; padding: 20px;">
            <span class="sold-out-badge">SOLD OUT</span>
            <p style="margin-top: 12px; color: ${P.text.muted}; font-size: 12px;">
              Check back after the caravan restocks
            </p>
          </div>
        </div>
      ` : `
        <div class="detail-actions">
          <div class="quantity-selector">
            <button class="quantity-btn" id="qty-minus" ${this.purchaseQuantity <= 1 ? 'disabled' : ''}>-</button>
            <span class="quantity-value">${this.purchaseQuantity}</span>
            <button class="quantity-btn" id="qty-plus" ${this.purchaseQuantity >= maxQty ? 'disabled' : ''}>+</button>
          </div>

          <div class="total-price">
            <div class="total-label">${isBuyMode ? 'Total Cost' : 'Total Value'}</div>
            <div class="total-value ${!canAfford ? 'cannot-afford' : ''}">${totalPrice.toLocaleString()}g</div>
          </div>

          <button class="action-btn ${isBuyMode ? 'buy-btn' : 'sell-btn'}"
                  id="action-btn"
                  ${(!canAfford || maxQty <= 0) ? 'disabled' : ''}>
            ${isBuyMode ? 'Purchase' : 'Sell'}
          </button>
        </div>
      `}
    `;

    // Event listeners for detail panel
    detailEl.querySelector('#qty-minus')?.addEventListener('click', () => {
      if (this.purchaseQuantity > 1) {
        this.purchaseQuantity--;
        this.renderDetailPanel();
      }
    });

    detailEl.querySelector('#qty-plus')?.addEventListener('click', () => {
      if (this.purchaseQuantity < maxQty) {
        this.purchaseQuantity++;
        this.renderDetailPanel();
      }
    });

    detailEl.querySelector('#action-btn')?.addEventListener('click', async () => {
      if (isBuyMode) {
        await this.handleBuy();
      } else {
        await this.handleSell();
      }
    });
  }

  renderDetailStats(item) {
    const stats = item.statBonuses;
    if (!stats || Object.keys(stats).length === 0) return '';

    const statNames = {
      strength: 'Strength',
      intelligence: 'Intelligence',
      agility: 'Agility',
      vitality: 'Vitality',
      luck: 'Luck',
      hp_max: 'Max HP',
      mp_max: 'Max MP'
    };

    let html = '';
    for (const [key, value] of Object.entries(stats)) {
      const label = statNames[key] || key;
      const sign = value > 0 ? '+' : '';
      html += `
        <div class="detail-stat-row">
          <span class="detail-stat-label">${label}</span>
          <span class="detail-stat-value positive">${sign}${value}</span>
        </div>
      `;
    }

    if (item.levelRequirement && item.levelRequirement > 1) {
      html += `
        <div class="detail-stat-row">
          <span class="detail-stat-label">Required Level</span>
          <span class="detail-stat-value">${item.levelRequirement}</span>
        </div>
      `;
    }

    return html;
  }

  async handleBuy() {
    if (!this.selectedItem) return;

    try {
      let result;

      if (this.isCaravan()) {
        // Use caravan-specific API
        result = await this.game.api.buyFromCaravan(
          this.nodeId,
          this.selectedItem.id,
          this.purchaseQuantity
        );
      } else {
        result = await this.game.api.buyFromShop(
          this.nodeId,
          this.shopType,
          this.selectedItem.templateId,
          this.purchaseQuantity
        );
      }

      this.playerGold = result.remainingGold;
      this.updateGoldDisplay();
      this.game.state.set('user', { ...this.game.state.get('user'), gold: this.playerGold });

      // Play purchase sound
      this.game.audio?.playSFX('gold_spend');

      parchmentToast.success('Purchase Complete', result.message);

      // Refresh shop data
      await this.loadShopData();
      this.selectedItem = null;
      this.purchaseQuantity = 1;
      this.renderDetailPanel();

    } catch (err) {
      parchmentToast.error('Purchase Failed', err.message);
    }
  }

  async handleSell() {
    if (!this.selectedItem) return;

    try {
      const result = await this.game.api.sellToShop(
        this.nodeId,
        this.shopType,
        this.selectedItem.instanceId,
        this.purchaseQuantity
      );

      this.playerGold = result.newGold;
      this.updateGoldDisplay();
      this.game.state.set('user', { ...this.game.state.get('user'), gold: this.playerGold });

      // Play sell sound
      this.game.audio?.playSFX('gold_receive');

      parchmentToast.success('Item Sold', result.message);

      // Refresh shop data
      await this.loadShopData();
      this.selectedItem = null;
      this.purchaseQuantity = 1;
      this.renderDetailPanel();

    } catch (err) {
      parchmentToast.error('Sale Failed', err.message);
    }
  }

  updateGoldDisplay() {
    const goldEl = this.uiElement.querySelector('#player-gold');
    if (goldEl) {
      goldEl.textContent = this.playerGold.toLocaleString();
    }
  }

  formatStats(stats) {
    if (!stats || Object.keys(stats).length === 0) return '';

    const abbrevs = {
      strength: 'STR',
      intelligence: 'INT',
      agility: 'AGI',
      vitality: 'VIT',
      luck: 'LCK',
      hp_max: 'HP',
      mp_max: 'MP'
    };

    return Object.entries(stats)
      .map(([key, value]) => {
        const abbr = abbrevs[key] || key.toUpperCase();
        const sign = value > 0 ? '+' : '';
        return `${abbr} ${sign}${value}`;
      })
      .join(', ');
  }

  formatSlot(slot) {
    const names = {
      main_hand: 'Main Hand',
      off_hand: 'Off Hand',
      head: 'Head',
      body: 'Body',
      legs: 'Legs',
      feet: 'Feet',
      accessory: 'Accessory'
    };
    return names[slot] || slot;
  }

  getRarityClass(rarity) {
    const rarityNum = typeof rarity === 'number' ? rarity : 1;
    const classes = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    return `rarity-${classes[rarityNum - 1] || 'common'}`;
  }

  update(_deltaTime) {
    // No per-frame updates needed
  }

  render(ctx) {
    // UI is HTML-based, but draw a subtle parchment background on canvas
    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    gradient.addColorStop(0, P.light);
    gradient.addColorStop(0.5, P.mid);
    gradient.addColorStop(1, P.dark);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
