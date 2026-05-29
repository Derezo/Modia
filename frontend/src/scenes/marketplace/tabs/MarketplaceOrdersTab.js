/**
 * MarketplaceOrdersTab - Displays user's open orders
 */

import { parchmentToast } from '../../../ui/parchment/ParchmentToast.js';
import { escapeHtml } from '../../../utils/escapeHtml.js';

/**
 * Render the My Orders tab
 * @param {HTMLElement} mainContent - Main content area
 * @param {HTMLElement} sidePanel - Side panel area
 * @param {Object} context - Shared context from MarketplaceScene
 */
export function renderOrdersTab(mainContent, sidePanel, context) {
  const { myOrders } = context;

  mainContent.innerHTML = `
    <div class="ui-panel" style="flex: 1; display: flex; flex-direction: column;">
      <div class="ui-panel-header">My Open Orders</div>
      <div class="my-orders-list">
        ${myOrders.length === 0
    ? '<div class="empty-message">No open orders</div>'
    : myOrders.map(order => renderMyOrder(order)).join('')}
      </div>
    </div>
  `;

  // Attach cancel handlers
  mainContent.querySelectorAll('.cancel-order-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = parseInt(btn.dataset.orderId);
      await handleCancelOrder(orderId, context);
    });
  });

  sidePanel.innerHTML = `
    <div class="ui-panel" style="flex: 1;">
      <div class="ui-panel-header">Order Summary</div>
      <div style="padding: 16px; font-family: Georgia, serif;">
        <div style="margin-bottom: 12px;">
          <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Buy Orders</div>
          <div style="font-size: 18px; color: #3d6b35; font-family: Consolas, monospace;">
            ${myOrders.filter(o => o.side === 'buy').length}
          </div>
        </div>
        <div style="margin-bottom: 12px;">
          <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Sell Orders</div>
          <div style="font-size: 18px; color: #8b4444; font-family: Consolas, monospace;">
            ${myOrders.filter(o => o.side === 'sell').length}
          </div>
        </div>
        <div>
          <div style="color: #5a4a3a; font-size: 12px; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Gold Reserved</div>
          <div style="font-size: 18px; color: #2d2418; font-family: Consolas, monospace; font-weight: bold; text-shadow: 0 1px 2px rgba(255,255,255,0.3);">
            ${myOrders
    .filter(o => o.side === 'buy')
    .reduce((sum, o) => sum + (o.price * o.quantityRemaining), 0).toLocaleString()}g
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render a single order row
 * @param {Object} order - Order data
 * @returns {string} HTML string
 */
function renderMyOrder(order) {
  const fillPercent = (order.quantityFilled / order.quantity) * 100;

  return `
    <div class="my-order">
      <div class="my-order-header">
        <span class="my-order-item">${escapeHtml(order.itemName || '')}</span>
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

/**
 * Handle cancelling an order
 * @param {number} orderId - Order ID to cancel
 * @param {Object} context - Shared context
 */
async function handleCancelOrder(orderId, context) {
  const { game, updateGoldDisplay, updateTabs, renderContent } = context;

  try {
    const result = await game.api.cancelOrder(orderId);

    // Update gold
    context.playerGold = result.gold;
    updateGoldDisplay();
    game.state.set('user', { ...game.state.get('user'), gold: result.gold });

    // Show success toast
    parchmentToast.success('Order Cancelled', 'Your order has been cancelled and funds returned');

    // Refresh orders
    const ordersData = await game.api.getMyOrders();
    context.myOrders = ordersData.orders || [];
    updateTabs();
    renderContent();

  } catch (err) {
    parchmentToast.error('Cancel Failed', err.message);
  }
}
