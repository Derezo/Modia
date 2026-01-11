import { Scene } from './Scene.js';
import { responsive } from '../core/Responsive.js';
import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentGradientTextured,
  getParchmentBorder,
  getParchmentShadow
} from '../ui/parchment/index.js';
import { parchmentToast } from '../ui/parchment/ParchmentToast.js';

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

    // UI state
    this.activeTab = 'buy'; // 'buy' or 'sell'
    this.selectedItem = null;
    this.purchaseQuantity = 1;
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

    await this.loadShopData();
  }

  exit() {
    if (this.responsiveUnsubscribe) {
      this.responsiveUnsubscribe();
      this.responsiveUnsubscribe = null;
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
      farm: 'Farm Store'
    };
    return names[shopType] || 'Shop';
  }

  getShopIcon(shopType) {
    const icons = {
      blacksmith: 'anvil',
      apothecary: 'flask',
      farm: 'wheat'
    };
    return icons[shopType] || 'store';
  }

  async loadShopData() {
    try {
      const [shopData, sellData] = await Promise.all([
        this.game.api.getShopInventory(this.nodeId, this.shopType),
        this.game.api.getSellableItems(this.nodeId, this.shopType)
      ]);

      this.shopInventory = shopData.items || [];
      this.sellableItems = sellData.items || [];

      this.renderInventory();
    } catch (err) {
      console.error('Failed to load shop data:', err);
      parchmentToast.error('Shop Error', 'Failed to load shop inventory');
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
        color: ${P.accent.gold};
        font-size: 22px;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .shop-gold {
        display: flex;
        align-items: center;
        gap: 8px;
        color: ${P.accent.gold};
        font-size: 18px;
        font-weight: bold;
        text-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
      }

      .shop-gold-icon {
        width: 20px;
        height: 20px;
        background: radial-gradient(circle at 30% 30%, #ffd700, #b8860b);
        border-radius: 50%;
        border: 1px solid ${P.borderDark};
        box-shadow: inset 0 -2px 4px rgba(0, 0, 0, 0.3);
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
        border-color: ${P.accent.gold};
        color: ${P.accent.gold};
        box-shadow: 0 -2px 6px rgba(201, 162, 39, 0.3);
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
        color: ${P.accent.gold};
        font-weight: bold;
        font-size: 14px;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .shop-items-list {
        flex: 1;
        overflow-y: auto;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 12px;
        padding: 12px;
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
      }

      @media (max-width: 600px) {
        .shop-items-list {
          grid-template-columns: 1fr;
        }
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
        border-color: ${P.accent.gold};
        background: linear-gradient(to bottom, #e8d9a8, #d4c498);
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
      }

      .shop-item.selected {
        border-color: ${P.accent.gold};
        background: linear-gradient(to bottom, #e8d9a8, #d4c498);
        box-shadow: 0 0 0 2px rgba(201, 162, 39, 0.3), 0 4px 8px rgba(0, 0, 0, 0.2);
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
        color: ${P.accent.gold};
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
        color: ${P.accent.gold};
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
        border-color: ${P.accent.gold};
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
        color: ${P.accent.gold};
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

      .character-tag {
        font-size: 10px;
        color: ${P.accent.gold};
        background: rgba(201, 162, 39, 0.2);
        padding: 2px 6px;
        border-radius: 4px;
        margin-left: 8px;
        border: 1px solid rgba(201, 162, 39, 0.4);
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
    `;
    document.head.appendChild(style);
  }

  createUI() {
    const container = document.createElement('div');
    container.className = 'shop-container';

    container.innerHTML = `
      <div class="shop-header">
        <div class="shop-title">
          <h2>${this.shopName}</h2>
        </div>
        <div style="display: flex; align-items: center; gap: 16px;">
          <div class="shop-gold">
            <div class="shop-gold-icon"></div>
            <span id="player-gold">${this.playerGold.toLocaleString()}</span>
          </div>
          <button class="back-btn" id="back-btn">Back to Map</button>
        </div>
      </div>

      <div class="shop-tabs">
        <div class="shop-tab ${this.activeTab === 'buy' ? 'active' : ''}" data-tab="buy">Buy</div>
        <div class="shop-tab ${this.activeTab === 'sell' ? 'active' : ''}" data-tab="sell">Sell</div>
      </div>

      <div class="shop-content">
        <div class="shop-items-panel">
          <div class="shop-panel-header" id="items-header">
            ${this.activeTab === 'buy' ? 'Shop Inventory' : 'Your Items'}
          </div>
          <div class="shop-items-list" id="items-list">
            <div class="empty-message">Loading...</div>
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
      this.game.scenes.switchTo('worldMap');
    }, opts);

    // Tab switching
    this.uiElement.querySelectorAll('.shop-tab').forEach(tab => {
      tab.addEventListener('click', () => {
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
    const listEl = this.uiElement.querySelector('#items-list');
    const items = this.activeTab === 'buy' ? this.shopInventory : this.sellableItems;

    if (items.length === 0) {
      listEl.innerHTML = `<div class="empty-message">
        ${this.activeTab === 'buy' ? 'No items available for purchase' : 'No items to sell'}
      </div>`;
      return;
    }

    listEl.innerHTML = items.map(item => this.renderItemCard(item)).join('');

    // Add click handlers
    listEl.querySelectorAll('.shop-item').forEach(itemEl => {
      itemEl.addEventListener('click', () => {
        const itemId = this.activeTab === 'buy'
          ? parseInt(itemEl.dataset.templateId)
          : parseInt(itemEl.dataset.instanceId);
        this.selectItem(itemId);
      });
    });
  }

  renderItemCard(item) {
    const isBuyMode = this.activeTab === 'buy';
    const rarityClass = this.getRarityClass(item.rarity);
    const isSelected = isBuyMode
      ? (this.selectedItem?.templateId === item.templateId)
      : (this.selectedItem?.instanceId === item.instanceId);
    const isOutOfStock = isBuyMode && item.quantity <= 0;

    const price = isBuyMode ? item.buyPrice : item.sellPrice;
    const stats = this.formatStats(item.statBonuses);

    let supplyHtml = '';
    if (isBuyMode && item.supplyLevel) {
      supplyHtml = `<span class="shop-item-supply supply-${item.supplyLevel}">${item.supplyLabel}</span>`;
    }

    let charTag = '';
    if (!isBuyMode && item.characterName) {
      charTag = `<span class="character-tag">${item.characterName}</span>`;
    }

    return `
      <div class="shop-item ${rarityClass} ${isSelected ? 'selected' : ''} ${isOutOfStock ? 'out-of-stock' : ''}"
           data-template-id="${item.templateId}"
           data-instance-id="${item.instanceId || ''}">
        <div class="shop-item-header">
          <div class="shop-item-name">${item.name}${charTag}</div>
          <div class="shop-item-price">${price.toLocaleString()}g</div>
        </div>
        <div class="shop-item-info">
          <span class="shop-item-type">${item.type}</span>
          ${supplyHtml}
          ${isBuyMode ? `<span>Qty: ${item.quantity}</span>` : `<span>x${item.quantity}</span>`}
        </div>
        ${stats ? `<div class="shop-item-stats">${stats}</div>` : ''}
        ${item.description ? `<div class="shop-item-desc">${item.description}</div>` : ''}
      </div>
    `;
  }

  selectItem(itemId) {
    const items = this.activeTab === 'buy' ? this.shopInventory : this.sellableItems;
    const idKey = this.activeTab === 'buy' ? 'templateId' : 'instanceId';

    this.selectedItem = items.find(i => i[idKey] === itemId);
    this.purchaseQuantity = 1;

    this.renderInventory();
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
    const unitPrice = isBuyMode ? item.buyPrice : item.sellPrice;
    const totalPrice = unitPrice * this.purchaseQuantity;
    const maxQty = item.quantity;
    const canAfford = isBuyMode ? (this.playerGold >= totalPrice) : true;

    const statsHtml = this.renderDetailStats(item);

    detailEl.innerHTML = `
      <div class="detail-header">
        <div class="detail-name">${item.name}</div>
        <div class="detail-type">${item.type}${item.equipmentSlot ? ` - ${this.formatSlot(item.equipmentSlot)}` : ''}</div>
      </div>

      ${item.description ? `<div class="detail-desc">${item.description}</div>` : ''}

      ${statsHtml ? `<div class="detail-stats">${statsHtml}</div>` : ''}

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
      const result = await this.game.api.buyFromShop(
        this.nodeId,
        this.shopType,
        this.selectedItem.templateId,
        this.purchaseQuantity
      );

      this.playerGold = result.remainingGold;
      this.updateGoldDisplay();
      this.game.state.set('user', { ...this.game.state.get('user'), gold: this.playerGold });

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
