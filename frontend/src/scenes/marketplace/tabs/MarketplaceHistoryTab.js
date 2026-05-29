/**
 * MarketplaceHistoryTab - Displays user's trade history
 */

import { formatTime } from '../marketplaceUtils.js';
import { escapeHtml } from '../../../utils/escapeHtml.js';

/**
 * Render the Trade History tab
 * @param {HTMLElement} mainContent - Main content area
 * @param {HTMLElement} sidePanel - Side panel area
 * @param {Object} context - Shared context from MarketplaceScene
 */
export async function renderHistoryTab(mainContent, sidePanel, context) {
  const { game } = context;

  // Load user's trade history
  let myTrades = [];
  try {
    const result = await game.api.getMyTrades(50);
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
                  <span style="color: #2d2418; font-family: Georgia, serif;">${escapeHtml(trade.itemName || '')}</span>
                </div>
                <div style="text-align: right;">
                  <div style="color: #2d2418; font-family: Consolas, monospace; font-weight: bold;">${trade.totalGold.toLocaleString()}g (${trade.price.toLocaleString()}g x ${trade.quantity})</div>
                  <div class="trade-row-time">${formatTime(trade.executedAt)}</div>
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
