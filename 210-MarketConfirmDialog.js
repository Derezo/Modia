/**
 * Market Confirmation Dialog
 * Parchment-styled modal for confirming marketplace transactions
 */

import { escapeHtml } from '../utils/escapeHtml.js';
import { ItemIcon } from './ItemIcon.js';

export class MarketConfirmDialog {
  constructor() {
    this.overlay = null;
    this.onConfirm = null;
    this.onCancel = null;
    this.escHandler = null;
  }

  /**
   * Show confirmation dialog
   * @param {Object} options
   * @param {string} options.title - Dialog title
   * @param {string} options.action - 'buy' or 'sell'
   * @param {Object} options.item - Item being traded
   * @param {number} options.quantity - Quantity
   * @param {number} options.price - Price per unit
   * @param {number} options.total - Total gold
   * @param {number} options.currentGold - Player's current gold (for buy validation)
   * @param {Function} options.onConfirm - Callback when confirmed
   * @param {Function} options.onCancel - Callback when cancelled
   */
  show(options) {
    const { title, action, item, quantity, price, total, currentGold, onConfirm, onCancel } = options;

    this.onConfirm = onConfirm;
    this.onCancel = onCancel;

    const isBuy = action === 'buy';
    const canAfford = !isBuy || currentGold >= total;

    // Get rarity color
    const rarityColors = {
      1: '#7a7a7a', // Common
      2: '#4a7548', // Uncommon
      3: '#4a6088', // Rare
      4: '#6b4488', // Epic
      5: '#c9a227', // Legendary
      common: '#7a7a7a',
      uncommon: '#4a7548',
      rare: '#4a6088',
      epic: '#6b4488',
      legendary: '#c9a227'
    };
    const rarityColor = rarityColors[item.rarity] || rarityColors[1];

    this.addStyles(isBuy, rarityColor);

    this.overlay = document.createElement('div');
    this.overlay.className = 'market-confirm-overlay';
    this.overlay.dataset.action = action;
    this.overlay.innerHTML = `
      <div class="market-confirm-dialog">
        <div class="confirm-seal">${isBuy ? '$' : '$'}</div>
        <h3 class="confirm-title">${title}</h3>

        <div class="confirm-item-preview" style="border-left-color: ${rarityColor};">
          <div class="confirm-item-icon" data-confirm-item-icon>
            ${ItemIcon.html({ item, size: 'md' })}
          </div>
          <div>
            <div class="confirm-item-name">${escapeHtml(item.name)}</div>
            <div class="confirm-item-type">${escapeHtml(item.itemType || 'Item')}</div>
          </div>
        </div>

        <div class="confirm-summary">
          <div class="confirm-row">
            <span>Quantity</span>
            <span class="confirm-row-value">${quantity.toLocaleString()}</span>
          </div>
          <div class="confirm-row">
            <span>Price per unit</span>
            <span class="confirm-row-value confirm-gold">${price.toLocaleString()}g</span>
          </div>
          <div class="confirm-row total">
            <span>${isBuy ? 'Total Cost' : 'Total Proceeds'}</span>
            <span class="confirm-row-value confirm-gold">${total.toLocaleString()}g</span>
          </div>
        </div>

        ${!canAfford ? '<div class="confirm-warning">Insufficient gold!</div>' : ''}

        <div class="confirm-actions">
          <button class="confirm-btn confirm-btn-cancel">Cancel</button>
          <button class="confirm-btn confirm-btn-confirm" ${!canAfford ? 'disabled' : ''}>
            Confirm ${isBuy ? 'Purchase' : 'Sale'}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);

    if (item.augments?.length > 0) {
      const iconContainer = this.overlay.querySelector('[data-confirm-item-icon]');
      ItemIcon.compositeHtml({ item, size: 'md' })
        .then((html) => {
          if (iconContainer?.isConnected) iconContainer.innerHTML = html;
        })
        .catch(() => {
          // Retain the canonical base icon if optional compositing fails.
        });
    }

    // Animate in
    requestAnimationFrame(() => {
      this.overlay.classList.add('visible');
    });

    // Event handlers
    this.overlay.querySelector('.confirm-btn-cancel').addEventListener('click', () => this.cancel());
    this.overlay.querySelector('.confirm-btn-confirm').addEventListener('click', () => this.confirm());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.cancel();
    });

    // ESC key to cancel
    this.escHandler = (e) => {
      if (e.key === 'Escape') this.cancel();
    };
    document.addEventListener('keydown', this.escHandler);
  }

  addStyles(_isBuy, _rarityColor) {
    if (document.getElementById('market-confirm-dialog-styles')) return;

    const style = document.createElement('style');
    style.id = 'market-confirm-dialog-styles';
    style.textContent = `
      .market-confirm-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
        opacity: 0;
        transition: opacity 0.2s ease-out;
      }

      .market-confirm-overlay.visible {
        opacity: 1;
      }

      .market-confirm-dialog {
        background: linear-gradient(to bottom, #d4c4a8 0%, #c9b899 50%, #bfae8a 100%);
        border: 4px solid #6b5344;
        border-radius: 8px;
        padding: 24px;
        min-width: 320px;
        max-width: 400px;
        box-shadow:
          0 8px 32px rgba(0, 0, 0, 0.5),
          inset 0 1px 0 rgba(255, 255, 255, 0.2);
        position: relative;
        transform: translateY(-20px);
        transition: transform 0.2s ease-out;
      }

      .market-confirm-overlay.visible .market-confirm-dialog {
        transform: translateY(0);
      }

      .confirm-seal {
        position: absolute;
        top: -20px;
        left: 50%;
        transform: translateX(-50%);
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 3px solid #4a3a2a;
        box-shadow: 0 3px 6px rgba(0, 0, 0, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 20px;
        font-weight: bold;
      }

      .market-confirm-overlay[data-action="buy"] .confirm-seal {
        background: radial-gradient(circle at 30% 30%, #5a9e4a, #3d7530);
      }

      .market-confirm-overlay[data-action="sell"] .confirm-seal {
        background: radial-gradient(circle at 30% 30%, #c45a5a, #8b3030);
      }

      .confirm-title {
        color: #2d2418;
        font-family: Georgia, serif;
        font-size: 20px;
        margin: 8px 0 20px;
        text-align: center;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .confirm-item-preview {
        background: linear-gradient(to bottom, #e8dcc8, #d9ccb8);
        border: 2px solid #8b7355;
        border-left: 4px solid #7a7a7a;
        border-radius: 4px;
        padding: 12px;
        margin-bottom: 16px;
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .confirm-item-name {
        color: #2d2418;
        font-family: Georgia, serif;
        font-weight: bold;
      }

      .confirm-item-type {
        color: #7a6a5a;
        font-size: 12px;
        text-transform: capitalize;
      }

      .confirm-summary {
        background: #f0e8d8;
        border: 1px solid #8b7355;
        border-radius: 4px;
        padding: 12px;
        margin-bottom: 20px;
      }

      .confirm-row {
        display: flex;
        justify-content: space-between;
        padding: 6px 0;
        color: #5a4a3a;
        font-family: Georgia, serif;
      }

      .confirm-row:not(:last-child) {
        border-bottom: 1px dashed #c9b899;
      }

      .confirm-row.total {
        color: #2d2418;
        font-weight: bold;
        font-size: 16px;
        padding-top: 10px;
        margin-top: 4px;
        border-top: 2px solid #8b7355;
        border-bottom: none;
      }

      .confirm-row-value {
        font-family: Consolas, monospace;
      }

      .confirm-gold {
        color: #2d2418;  /* Dark brown for readable gold amounts */
        font-weight: bold;
      }

      .confirm-warning {
        background: rgba(200, 100, 100, 0.2);
        border: 1px solid #8b4444;
        border-radius: 4px;
        padding: 8px 12px;
        margin-bottom: 16px;
        color: #8b4444;
        font-size: 13px;
        text-align: center;
        font-family: Georgia, serif;
      }

      .confirm-actions {
        display: flex;
        gap: 12px;
        justify-content: center;
      }

      .confirm-btn {
        padding: 10px 24px;
        border-radius: 4px;
        font-family: Georgia, serif;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .confirm-btn:hover {
        transform: translateY(-1px);
      }

      .confirm-btn:active {
        transform: translateY(0);
      }

      .confirm-btn-cancel {
        background: linear-gradient(to bottom, #c9b899, #bfae8a);
        border: 2px solid #8b7355;
        color: #5a4a3a;
      }

      .confirm-btn-cancel:hover {
        background: linear-gradient(to bottom, #d4c4a8, #c9b899);
      }

      .confirm-btn-confirm {
        color: white;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      }

      .confirm-btn-confirm:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      .confirm-btn-confirm:disabled:hover {
        transform: none;
      }

      /* Buy action styling */
      .market-confirm-overlay[data-action="buy"] .confirm-btn-confirm {
        background: linear-gradient(to bottom, #5a9e4a, #4a8c3a);
        border: 2px solid #3d7530;
      }

      .market-confirm-overlay[data-action="buy"] .confirm-btn-confirm:hover:not(:disabled) {
        background: linear-gradient(to bottom, #6ab05a, #5a9e4a);
      }

      /* Sell action styling */
      .market-confirm-overlay[data-action="sell"] .confirm-btn-confirm {
        background: linear-gradient(to bottom, #c45a5a, #a84040);
        border: 2px solid #8b3030;
      }

      .market-confirm-overlay[data-action="sell"] .confirm-btn-confirm:hover:not(:disabled) {
        background: linear-gradient(to bottom, #d46a6a, #c45a5a);
      }
    `;
    document.head.appendChild(style);
  }

  confirm() {
    if (this.onConfirm) this.onConfirm();
    this.close();
  }

  cancel() {
    if (this.onCancel) this.onCancel();
    this.close();
  }

  close() {
    if (this.escHandler) {
      document.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
    if (this.overlay) {
      this.overlay.classList.remove('visible');
      setTimeout(() => {
        if (this.overlay) {
          this.overlay.remove();
          this.overlay = null;
        }
      }, 200);
    }
  }

}

// Singleton for easy use
export const marketConfirmDialog = new MarketConfirmDialog();
