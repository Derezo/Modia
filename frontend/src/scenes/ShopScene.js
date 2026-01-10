import { Scene } from './Scene.js';

/**
 * ShopScene - Buy and sell items at NPC shops
 * Supports blacksmith, apothecary, and farm shop types
 */
export class ShopScene extends Scene {
  constructor(game) {
    super(game);
    this.uiElement = null;
    this.abortController = null;

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
      this.game.showNotification('Invalid shop data', 'error');
      this.game.scenes.switchTo('worldMap');
      return;
    }

    this.addStyles();
    this.createUI();
    this.setupEventListeners();
    await this.loadShopData();
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
      this.game.showNotification('Failed to load shop', 'error');
    }
  }

  addStyles() {
    if (document.getElementById('shop-scene-styles')) return;

    const style = document.createElement('style');
    style.id = 'shop-scene-styles';
    style.textContent = `
      .shop-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        display: flex;
        flex-direction: column;
      }

      .shop-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 24px;
        background: rgba(0,0,0,0.3);
        border-bottom: 1px solid #3a3a5a;
      }

      .shop-title {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .shop-title h2 {
        margin: 0;
        color: #ffd700;
      }

      .shop-gold {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #ffd700;
        font-size: 18px;
        font-weight: bold;
      }

      .shop-tabs {
        display: flex;
        gap: 4px;
        padding: 12px 24px;
        background: rgba(0,0,0,0.2);
        border-bottom: 1px solid #3a3a5a;
      }

      .shop-tab {
        padding: 10px 24px;
        background: rgba(0,0,0,0.3);
        border: 2px solid transparent;
        border-radius: 8px 8px 0 0;
        color: #8a8aaa;
        cursor: pointer;
        transition: all 0.2s;
        font-size: 14px;
        font-weight: bold;
      }

      .shop-tab:hover {
        background: rgba(74, 144, 217, 0.2);
        color: #6ab0f3;
      }

      .shop-tab.active {
        background: rgba(255, 215, 0, 0.2);
        border-color: #ffd700;
        color: #ffd700;
      }

      .shop-content {
        flex: 1;
        display: flex;
        padding: 16px;
        gap: 16px;
        overflow: hidden;
      }

      .shop-items-panel {
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      .shop-items-list {
        flex: 1;
        overflow-y: auto;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 12px;
        padding: 8px;
      }

      .shop-item {
        background: rgba(0,0,0,0.3);
        border: 2px solid #3a3a5a;
        border-radius: 8px;
        padding: 12px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .shop-item:hover {
        border-color: #6ab0f3;
        background: rgba(74, 144, 217, 0.1);
      }

      .shop-item.selected {
        border-color: #ffd700;
        background: rgba(255, 215, 0, 0.1);
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
        color: #fff;
        font-size: 14px;
      }

      .shop-item-price {
        color: #ffd700;
        font-weight: bold;
        font-size: 14px;
      }

      .shop-item-info {
        display: flex;
        gap: 12px;
        font-size: 12px;
        color: #8a8aaa;
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

      .supply-scarce { background: #c62828; color: #fff; }
      .supply-low { background: #f57c00; color: #fff; }
      .supply-medium { background: #fbc02d; color: #000; }
      .supply-high { background: #388e3c; color: #fff; }
      .supply-surplus { background: #1976d2; color: #fff; }

      .shop-item-stats {
        font-size: 11px;
        color: #6ab0f3;
      }

      .shop-item-desc {
        font-size: 11px;
        color: #666;
        margin-top: 4px;
        font-style: italic;
      }

      .shop-detail-panel {
        width: 300px;
        display: flex;
        flex-direction: column;
      }

      .detail-content {
        flex: 1;
        display: flex;
        flex-direction: column;
      }

      .detail-header {
        text-align: center;
        padding-bottom: 16px;
        border-bottom: 1px solid #3a3a5a;
        margin-bottom: 16px;
      }

      .detail-name {
        font-size: 18px;
        font-weight: bold;
        color: #ffd700;
        margin-bottom: 4px;
      }

      .detail-type {
        color: #8a8aaa;
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
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }

      .detail-stat-label {
        color: #8a8aaa;
      }

      .detail-stat-value {
        color: #6ab0f3;
        font-weight: bold;
      }

      .detail-stat-value.positive {
        color: #4caf50;
      }

      .detail-desc {
        color: #8a8aaa;
        font-size: 13px;
        font-style: italic;
        padding: 12px;
        background: rgba(0,0,0,0.2);
        border-radius: 6px;
        margin-bottom: 16px;
      }

      .detail-actions {
        margin-top: auto;
        padding-top: 16px;
        border-top: 1px solid #3a3a5a;
      }

      .quantity-selector {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        margin-bottom: 12px;
      }

      .quantity-btn {
        width: 32px;
        height: 32px;
        border-radius: 6px;
        background: rgba(0,0,0,0.4);
        border: 1px solid #3a3a5a;
        color: #fff;
        font-size: 18px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .quantity-btn:hover {
        background: rgba(74, 144, 217, 0.3);
        border-color: #6ab0f3;
      }

      .quantity-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .quantity-value {
        font-size: 18px;
        font-weight: bold;
        color: #fff;
        min-width: 40px;
        text-align: center;
      }

      .total-price {
        text-align: center;
        margin-bottom: 12px;
      }

      .total-label {
        color: #8a8aaa;
        font-size: 12px;
      }

      .total-value {
        color: #ffd700;
        font-size: 20px;
        font-weight: bold;
      }

      .total-value.cannot-afford {
        color: #c62828;
      }

      .action-btn {
        width: 100%;
        padding: 12px;
        font-size: 16px;
        font-weight: bold;
      }

      .empty-message {
        text-align: center;
        color: #8a8aaa;
        padding: 40px;
        font-size: 14px;
      }

      .rarity-common { border-left: 3px solid #9e9e9e; }
      .rarity-uncommon { border-left: 3px solid #4caf50; }
      .rarity-rare { border-left: 3px solid #2196f3; }
      .rarity-epic { border-left: 3px solid #9c27b0; }
      .rarity-legendary { border-left: 3px solid #ff9800; }

      .character-tag {
        font-size: 10px;
        color: #ffd700;
        background: rgba(255, 215, 0, 0.2);
        padding: 2px 6px;
        border-radius: 4px;
        margin-left: 8px;
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
            <span>Gold:</span>
            <span id="player-gold">${this.playerGold}</span>
          </div>
          <button class="btn btn-secondary" id="back-btn">Back to Map</button>
        </div>
      </div>

      <div class="shop-tabs">
        <div class="shop-tab ${this.activeTab === 'buy' ? 'active' : ''}" data-tab="buy">Buy</div>
        <div class="shop-tab ${this.activeTab === 'sell' ? 'active' : ''}" data-tab="sell">Sell</div>
      </div>

      <div class="shop-content">
        <div class="shop-items-panel ui-panel">
          <div class="ui-panel-header" id="items-header">
            ${this.activeTab === 'buy' ? 'Shop Inventory' : 'Your Items'}
          </div>
          <div class="shop-items-list" id="items-list">
            <div class="empty-message">Loading...</div>
          </div>
        </div>

        <div class="shop-detail-panel ui-panel">
          <div class="ui-panel-header">Item Details</div>
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
        ${this.activeTab === 'buy' ? 'No items available' : 'No items to sell'}
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
          <div class="shop-item-price">${price}g</div>
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
          <div class="total-value ${!canAfford ? 'cannot-afford' : ''}">${totalPrice}g</div>
        </div>

        <button class="btn ${isBuyMode ? 'btn-primary' : 'btn-success'} action-btn"
                id="action-btn"
                ${(!canAfford || maxQty <= 0) ? 'disabled' : ''}>
          ${isBuyMode ? 'Buy' : 'Sell'}
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

      this.game.showNotification(result.message, 'success');

      // Refresh shop data
      await this.loadShopData();
      this.selectedItem = null;
      this.purchaseQuantity = 1;
      this.renderDetailPanel();

    } catch (err) {
      this.game.showNotification(err.message, 'error');
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

      this.game.showNotification(result.message, 'success');

      // Refresh shop data
      await this.loadShopData();
      this.selectedItem = null;
      this.purchaseQuantity = 1;
      this.renderDetailPanel();

    } catch (err) {
      this.game.showNotification(err.message, 'error');
    }
  }

  updateGoldDisplay() {
    const goldEl = this.uiElement.querySelector('#player-gold');
    if (goldEl) {
      goldEl.textContent = this.playerGold;
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

  update(deltaTime) {
    // No per-frame updates needed
  }

  render(ctx) {
    // UI is HTML-based
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
}
