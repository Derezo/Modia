/**
 * MarketplaceTradePanel - Order book and trade form for stackable items
 */

import { MarketDashboard } from '../../../components/MarketDashboard.js';
import { marketConfirmDialog } from '../../../components/MarketConfirmDialog.js';
import { parchmentToast } from '../../../ui/parchment/ParchmentToast.js';
import { formatTime } from '../marketplaceUtils.js';

/**
 * Load order book data for an item
 * @param {number} itemTemplateId - Item template ID
 * @param {Object} context - Shared context
 */
export async function loadOrderBook(itemTemplateId, context) {
  const { game } = context;

  try {
    const [orderBookData, historyData] = await Promise.all([
      game.api.getOrderBook(itemTemplateId),
      game.api.getTradeHistory(itemTemplateId, 20)
    ]);
    context.orderBook = orderBookData;
    context.tradeHistory = historyData.trades || [];
  } catch (err) {
    console.error('Failed to load order book:', err);
    context.orderBook = null;
    context.tradeHistory = [];
  }
}

/**
 * Render order book and trade panel
 * @param {HTMLElement} sidePanel - Side panel container
 * @param {Object} context - Shared context
 */
export function renderOrderBookAndTrade(sidePanel, context) {
  const { selectedItem: item, orderBook: book, tradeHistory, orderSide, orderType, orderPrice, orderQuantity } = context;

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
        <button class="side-btn buy ${orderSide === 'buy' ? 'active' : ''}" data-side="buy">Buy</button>
        <button class="side-btn sell ${orderSide === 'sell' ? 'active' : ''}" data-side="sell">Sell</button>
      </div>

      <div class="order-type-toggle">
        <button class="order-type-btn ${orderType === 'limit' ? 'active' : ''}" data-type="limit">Limit</button>
        <button class="order-type-btn ${orderType === 'market' ? 'active' : ''}" data-type="market">Market</button>
      </div>

      ${orderType === 'limit' ? `
        <div class="trade-input-group">
          <label>Price (gold)</label>
          <input type="number" id="order-price" value="${orderPrice}" min="1">
        </div>
      ` : ''}

      <div class="trade-input-group">
        <label>Quantity</label>
        <input type="number" id="order-quantity" value="${orderQuantity}" min="1" max="9999">
      </div>

      ${renderTradeSummary(context)}

      <button class="trade-btn ${orderSide}" id="place-order-btn">
        ${orderSide === 'buy' ? 'Place Buy Order' : 'Place Sell Order'}
      </button>
    </div>

    ${tradeHistory.length > 0 ? `
      <div class="ui-panel" style="max-height: 150px; overflow-y: auto; display: flex; flex-direction: column;">
        <div class="ui-panel-header">Recent Trades</div>
        <div class="trade-history-list">
          ${tradeHistory.slice(0, 10).map(trade => `
            <div class="trade-row">
              <span>${trade.price}g x ${trade.quantity}</span>
              <span class="trade-row-time">${formatTime(trade.executedAt)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;

  // Attach trade panel handlers
  attachTradePanelHandlers(sidePanel, context);

  // Initialize MarketDashboard for price chart
  initMarketDashboard(sidePanel, item, context);
}

/**
 * Initialize MarketDashboard in the given container
 * @param {HTMLElement} sidePanel - Side panel container
 * @param {Object} item - Selected item
 * @param {Object} context - Shared context
 */
export function initMarketDashboard(sidePanel, item, context) {
  const { game } = context;
  const dashboardContainer = sidePanel.querySelector('#market-dashboard-container');

  if (dashboardContainer) {
    // Destroy existing dashboard if any
    if (context.marketDashboard) {
      context.marketDashboard.destroy();
    }

    // Create new dashboard
    context.marketDashboard = new MarketDashboard(dashboardContainer, {
      game,
      onBuy: (_selectedItem, _price) => {
        // Quick buy at market price
        context.orderSide = 'buy';
        context.orderType = 'market';
        context.orderQuantity = 1;
        handlePlaceOrder(context);
      }
    });

    // Set the selected item to load price history
    context.marketDashboard.setItem({
      ...item,
      templateId: item.id,
      itemType: item.itemType || item.type || 'consumable'
    });
  }
}

/**
 * Render trade summary section
 * @param {Object} context - Shared context
 * @returns {string} HTML string
 */
function renderTradeSummary(context) {
  const { orderType, orderSide, orderPrice, orderQuantity, orderBook, playerGold } = context;

  const total = orderType === 'limit'
    ? orderPrice * orderQuantity
    : (orderSide === 'buy'
      ? (orderBook?.bestAsk || 0) * orderQuantity
      : (orderBook?.bestBid || 0) * orderQuantity);

  const canAfford = orderSide === 'buy' ? playerGold >= total : true;

  return `
    <div class="trade-summary">
      <div class="trade-summary-row">
        <span class="trade-summary-label">${orderType === 'market' ? 'Est. Price' : 'Price'}</span>
        <span class="trade-summary-value">
          ${orderType === 'limit'
    ? orderPrice.toLocaleString() + 'g'
    : (orderSide === 'buy'
      ? (orderBook?.bestAsk ? orderBook.bestAsk.toLocaleString() : '-') + 'g'
      : (orderBook?.bestBid ? orderBook.bestBid.toLocaleString() : '-') + 'g')}
        </span>
      </div>
      <div class="trade-summary-row">
        <span class="trade-summary-label">Quantity</span>
        <span class="trade-summary-value">${orderQuantity.toLocaleString()}</span>
      </div>
      <div class="trade-summary-row">
        <span class="trade-summary-label">Total</span>
        <span class="trade-summary-value ${orderSide}" style="${!canAfford ? 'color: #8b4444;' : ''}">
          ${total > 0 ? total.toLocaleString() + 'g' : '-'}
          ${!canAfford ? ' (Insufficient)' : ''}
        </span>
      </div>
    </div>
  `;
}

/**
 * Attach event handlers for trade panel
 * @param {HTMLElement} container - Panel container
 * @param {Object} context - Shared context
 */
function attachTradePanelHandlers(container, context) {
  // Side toggle
  container.querySelectorAll('.side-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      context.orderSide = btn.dataset.side;
      renderOrderBookAndTrade(container, context);
    });
  });

  // Order type toggle
  container.querySelectorAll('.order-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      context.orderType = btn.dataset.type;
      renderOrderBookAndTrade(container, context);
    });
  });

  // Price input
  const priceInput = container.querySelector('#order-price');
  if (priceInput) {
    priceInput.addEventListener('input', () => {
      context.orderPrice = parseInt(priceInput.value) || 1;
      container.querySelector('.trade-summary').outerHTML = renderTradeSummary(context);
    });
  }

  // Quantity input
  const qtyInput = container.querySelector('#order-quantity');
  if (qtyInput) {
    qtyInput.addEventListener('input', () => {
      context.orderQuantity = Math.max(1, Math.min(9999, parseInt(qtyInput.value) || 1));
      container.querySelector('.trade-summary').outerHTML = renderTradeSummary(context);
    });
  }

  // Click on order book row to set price
  container.querySelectorAll('.order-book-row').forEach(row => {
    row.addEventListener('click', () => {
      const price = parseInt(row.dataset.price);
      if (price && priceInput) {
        context.orderPrice = price;
        priceInput.value = price;
        container.querySelector('.trade-summary').outerHTML = renderTradeSummary(context);
      }
    });
  });

  // Place order button
  container.querySelector('#place-order-btn')?.addEventListener('click', () => {
    handlePlaceOrder(context);
  });
}

/**
 * Handle place order button click
 * @param {Object} context - Shared context
 */
export async function handlePlaceOrder(context) {
  const { selectedItem, activeCharacter, orderSide, orderType, orderPrice, orderQuantity, orderBook, playerGold } = context;

  if (!selectedItem || !activeCharacter) return;

  // Calculate price and total for confirmation
  const price = orderType === 'limit'
    ? orderPrice
    : (orderSide === 'buy'
      ? (orderBook?.bestAsk || 0)
      : (orderBook?.bestBid || 0));

  const total = price * orderQuantity;

  // Validate before showing dialog
  if (orderSide === 'buy' && playerGold < total) {
    parchmentToast.error('Insufficient Gold', `You need ${total.toLocaleString()}g but only have ${playerGold.toLocaleString()}g`);
    return;
  }

  if (orderType === 'market' && price === 0) {
    parchmentToast.warning('No Orders Available', `No ${orderSide === 'buy' ? 'sell' : 'buy'} orders available for market execution`);
    return;
  }

  // Show confirmation dialog
  const dialogTitle = orderSide === 'buy'
    ? 'Confirm Purchase'
    : 'Confirm Sale';

  marketConfirmDialog.show({
    title: dialogTitle,
    action: orderSide,
    item: selectedItem,
    quantity: orderQuantity,
    price: price,
    total: total,
    currentGold: playerGold,
    onConfirm: () => executeOrder(context),
    onCancel: () => {
      // User cancelled, do nothing
    }
  });
}

/**
 * Execute the order
 * @param {Object} context - Shared context
 */
async function executeOrder(context) {
  const { game, selectedItem, activeCharacter, orderSide, orderType, orderPrice, orderQuantity, updateGoldDisplay, updateTabs, renderContent } = context;

  if (!selectedItem || !activeCharacter) {
    console.error('[MarketplaceTradePanel] Cannot execute order - missing data');
    return;
  }

  console.log('[MarketplaceTradePanel] Executing order:', {
    itemId: selectedItem.id,
    itemName: selectedItem.name,
    side: orderSide,
    type: orderType,
    price: orderPrice,
    quantity: orderQuantity,
    characterId: activeCharacter.id
  });

  try {
    let result;
    if (orderType === 'limit') {
      result = await game.api.placeLimitOrder(
        selectedItem.id,
        orderSide,
        orderPrice,
        orderQuantity,
        activeCharacter.id
      );
      console.log('[MarketplaceTradePanel] Order placed, result:', result);
    } else {
      result = await game.api.placeMarketOrder(
        selectedItem.id,
        orderSide,
        orderQuantity,
        activeCharacter.id
      );
    }

    // Update gold
    context.playerGold = result.gold;
    updateGoldDisplay();
    game.state.set('user', { ...game.state.get('user'), gold: result.gold });

    // Play appropriate sound effect
    if (orderSide === 'buy') {
      game.audio?.playSFX('gold_spend');
    } else {
      game.audio?.playSFX('gold_receive');
    }

    // Show success toast
    const action = orderSide === 'buy' ? 'Buy' : 'Sell';
    const orderTypeLabel = orderType === 'limit' ? 'limit' : 'market';
    parchmentToast.success(
      `${action} Order Placed`,
      `${orderTypeLabel.charAt(0).toUpperCase() + orderTypeLabel.slice(1)} order for ${orderQuantity}x ${selectedItem.name}`
    );

    // Refresh data
    console.log('[MarketplaceTradePanel] Refreshing data...');
    await loadOrderBook(selectedItem.id, context);
    const ordersData = await game.api.getMyOrders();
    console.log('[MarketplaceTradePanel] My orders:', ordersData);
    context.myOrders = ordersData.orders || [];
    updateTabs();
    renderContent();
    console.log('[MarketplaceTradePanel] Order flow complete, myOrders count:', context.myOrders.length);

  } catch (err) {
    console.error('[MarketplaceTradePanel] Order failed:', err);
    parchmentToast.error('Order Failed', err.message);
  }
}
