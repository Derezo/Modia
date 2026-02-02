/**
 * @module BattleConfirmationUI
 * @description Confirmation dialogs and notifications for battle UI.
 *
 * Key responsibilities:
 * - Turn indicator display (whose turn it is)
 * - Confirmation panel for actions (flee, etc.)
 * - Battle result display (victory/defeat)
 * - Notification messages during battle
 *
 * @see BattleUI.js - Main battle UI that delegates confirmation rendering
 * @see BattleScene.js - Orchestrates battle and triggers notifications
 */

import { parchmentToast } from '../ui/parchment/ParchmentToast.js';

/**
 * BattleConfirmationUI - Confirmation dialogs and notifications for battle
 */
export class BattleConfirmationUI {
  /**
   * @param {Object} battleUI - Reference to parent BattleUI instance
   */
  constructor(battleUI) {
    this.battleUI = battleUI;
    this.turnIndicatorTimeout = null;
  }

  /**
   * Get the main UI element from parent
   * @returns {HTMLElement|null}
   */
  get element() {
    return this.battleUI?.element;
  }

  /**
   * Show turn indicator (displays whose turn it is)
   * @param {string} unitName - Name of the unit whose turn it is
   * @param {string} unitType - Type of unit: 'player', 'player_local', 'player_remote', 'enemy'
   * @param {number} duration - How long to show the indicator (ms), default 2000
   */
  showTurnIndicator(unitName, unitType, duration = 2000) {
    const indicator = this.element?.querySelector('#turn-indicator');
    const content = this.element?.querySelector('.turn-indicator-content');
    const text = this.element?.querySelector('#turn-indicator-text');

    if (!indicator || !content || !text) return;

    // Clear any existing timeout
    if (this.turnIndicatorTimeout) {
      clearTimeout(this.turnIndicatorTimeout);
    }

    // Set text and style based on unit type
    let displayText = '';
    if (unitType === 'player_local') {
      displayText = 'Your Turn!';
    } else if (unitType === 'player_remote') {
      displayText = `${unitName}'s Turn`;
    } else if (unitType === 'enemy') {
      displayText = `Enemy: ${unitName}`;
    } else {
      displayText = `${unitName}'s Turn`;
    }

    text.textContent = displayText;

    // Remove old type classes and add new one
    content.classList.remove('player', 'player_local', 'player_remote', 'enemy');
    content.classList.add(unitType || 'player');

    // Reset animation by forcing reflow
    indicator.style.display = 'none';
    void indicator.offsetWidth; // Force reflow
    indicator.style.display = 'block';

    // Hide after duration
    this.turnIndicatorTimeout = setTimeout(() => {
      indicator.style.display = 'none';
    }, duration);
  }

  /**
   * Hide turn indicator immediately
   */
  hideTurnIndicator() {
    const indicator = this.element?.querySelector('#turn-indicator');
    if (indicator) {
      indicator.style.display = 'none';
    }
    if (this.turnIndicatorTimeout) {
      clearTimeout(this.turnIndicatorTimeout);
      this.turnIndicatorTimeout = null;
    }
  }

  /**
   * Show confirmation panel
   * @param {string} text - Confirmation message to display
   */
  showConfirmation(text) {
    const panel = this.element?.querySelector('#confirm-panel');
    const textEl = this.element?.querySelector('#confirm-text');
    if (panel) panel.style.display = 'block';
    if (textEl) textEl.textContent = text;
  }

  /**
   * Hide confirmation panel
   */
  hideConfirmation() {
    const panel = this.element?.querySelector('#confirm-panel');
    if (panel) panel.style.display = 'none';
  }

  /**
   * Show battle result
   * @param {string} status - 'victory' or 'defeat'
   * @param {Object|null} rewards - Optional rewards object with gold and experience
   */
  showResult(status, rewards = null) {
    const panel = this.element?.querySelector('#battle-result');
    const title = this.element?.querySelector('#result-title');
    const rewardsEl = this.element?.querySelector('#result-rewards');

    if (!panel) return;

    panel.style.display = 'block';

    if (title) {
      if (status === 'victory') {
        title.textContent = 'Victory!';
        title.style.color = '#ffd700';
      } else if (status === 'defeat') {
        title.textContent = 'Defeat';
        title.style.color = '#f44336';
      } else if (status === 'surrender') {
        title.textContent = 'Surrendered';
        title.style.color = '#ff9800';
      } else if (status === 'draw') {
        title.textContent = 'Draw';
        title.style.color = '#9e9e9e';
      }
    }

    if (rewardsEl && rewards) {
      let rewardsHtml = '';

      if (rewards.gold !== undefined) {
        rewardsHtml += `
          <div style="margin-bottom: 8px;">
            <span style="color: #ffd700;">Gold:</span>
            <span style="color: #fff;">+${rewards.gold}</span>
          </div>
        `;
      }

      if (rewards.experience !== undefined) {
        rewardsHtml += `
          <div style="margin-bottom: 8px;">
            <span style="color: #4caf50;">Experience:</span>
            <span style="color: #fff;">+${rewards.experience}</span>
          </div>
        `;
      }

      if (rewards.ratingChange !== undefined) {
        const ratingColor = rewards.ratingChange >= 0 ? '#4caf50' : '#f44336';
        const ratingPrefix = rewards.ratingChange >= 0 ? '+' : '';
        rewardsHtml += `
          <div>
            <span style="color: #d4af37;">Rating:</span>
            <span style="color: ${ratingColor};">${ratingPrefix}${rewards.ratingChange}</span>
          </div>
        `;
      }

      rewardsEl.innerHTML = rewardsHtml || '';
    } else if (rewardsEl) {
      rewardsEl.innerHTML = '';
    }
  }

  /**
   * Hide battle result panel
   */
  hideResult() {
    const panel = this.element?.querySelector('#battle-result');
    if (panel) panel.style.display = 'none';
  }

  /**
   * Show a temporary notification message
   * Uses the unified parchment toast system for consistent styling.
   * @param {string} message - The message to display
   * @param {string} type - Notification type: 'info', 'warning', 'error', 'success'
   * @param {number} duration - How long to show (ms), default 3000
   */
  showNotification(message, type = 'info', duration = 3000) {
    const toastMethod = parchmentToast[type] || parchmentToast.info;
    toastMethod.call(parchmentToast, message, '', duration);
  }

  /**
   * Clear all notifications in the battle notification container
   */
  clearNotifications() {
    const container = this.element?.querySelector('#notification-container');
    if (container) {
      container.innerHTML = '';
    }
  }

  /**
   * Setup confirmation-specific event listeners
   * @param {Object} callbacks - Callback functions
   * @param {AbortSignal} signal - Abort signal for cleanup
   */
  setupEventListeners(callbacks, signal) {
    const opts = { signal };

    this.element?.querySelector('#btn-confirm')?.addEventListener('click', () => {
      callbacks.onConfirm?.();
    }, opts);

    this.element?.querySelector('#btn-cancel')?.addEventListener('click', () => {
      callbacks.onCancel?.();
    }, opts);

    this.element?.querySelector('#btn-continue')?.addEventListener('click', () => {
      callbacks.onContinue?.();
    }, opts);
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.turnIndicatorTimeout) {
      clearTimeout(this.turnIndicatorTimeout);
      this.turnIndicatorTimeout = null;
    }
    this.battleUI = null;
  }
}
