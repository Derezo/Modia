/**
 * @module BattlePvPUI
 * @description PvP-specific UI elements for battle.
 *
 * Key responsibilities:
 * - PvP turn timer display and updates
 * - Surrender button and confirmation modal
 * - Opponent disconnection overlay
 * - Opponent turn indicator (waiting state)
 *
 * @see BattleUI.js - Main battle UI that delegates PvP rendering
 * @see BattleScene.js - Orchestrates battle and manages PvP state
 */

/**
 * BattlePvPUI - PvP-specific UI components for battle
 */
export class BattlePvPUI {
  /**
   * @param {Object} battleUI - Reference to parent BattleUI instance
   */
  constructor(battleUI) {
    this.battleUI = battleUI;
    this.isPvPMode = false;
  }

  /**
   * Get the main UI element from parent
   * @returns {HTMLElement|null}
   */
  get element() {
    return this.battleUI?.element;
  }

  /**
   * Enable PvP mode - shows PvP-specific UI elements
   */
  enablePvPMode() {
    this.isPvPMode = true;

    // Show surrender button
    const surrenderPanel = this.element?.querySelector('#pvp-surrender-panel');
    if (surrenderPanel) {
      surrenderPanel.style.display = 'block';
    }

    // Show turn timer
    const timerPanel = this.element?.querySelector('#pvp-turn-timer');
    if (timerPanel) {
      timerPanel.style.display = 'block';
    }
  }

  /**
   * Disable PvP mode - hides PvP-specific UI elements
   */
  disablePvPMode() {
    this.isPvPMode = false;

    // Hide surrender button
    const surrenderPanel = this.element?.querySelector('#pvp-surrender-panel');
    if (surrenderPanel) {
      surrenderPanel.style.display = 'none';
    }

    // Hide turn timer
    this.hideTurnTimer();

    // Hide opponent indicators
    this.hideOpponentTurnIndicator();
    this.hideDisconnectedOverlay();
    this.hideTimeoutWarning();
  }

  /**
   * Update PvP turn timer
   * @param {number} remainingSeconds - Seconds remaining in turn
   * @param {number} totalSeconds - Total turn time (default 60)
   */
  updateTurnTimer(remainingSeconds, totalSeconds = 60) {
    const timerText = this.element?.querySelector('#pvp-timer-text');
    const timerProgress = this.element?.querySelector('.pvp-timer-progress');

    if (!timerText || !timerProgress) return;

    // Update text
    timerText.textContent = Math.ceil(remainingSeconds);

    // Update progress circle (283 is the circumference of r=45 circle)
    const circumference = 283;
    const progress = remainingSeconds / totalSeconds;
    const offset = circumference * (1 - progress);
    timerProgress.style.strokeDashoffset = offset;

    // Update color based on remaining time
    timerProgress.classList.remove('warning', 'critical');
    if (remainingSeconds <= 10) {
      timerProgress.classList.add('critical');
    } else if (remainingSeconds <= 15) {
      timerProgress.classList.add('warning');
    }
  }

  /**
   * Hide turn timer (during opponent's turn in PvP)
   */
  hideTurnTimer() {
    const timerPanel = this.element?.querySelector('#pvp-turn-timer');
    if (timerPanel) {
      timerPanel.style.display = 'none';
    }
  }

  /**
   * Show turn timer (during player's turn in PvP)
   */
  showTurnTimer() {
    if (!this.isPvPMode) return;

    const timerPanel = this.element?.querySelector('#pvp-turn-timer');
    if (timerPanel) {
      timerPanel.style.display = 'block';
    }
  }

  /**
   * Show surrender confirmation modal
   */
  showSurrenderModal() {
    const modal = this.element?.querySelector('#surrender-confirm-modal');
    if (modal) {
      modal.style.display = 'flex';
    }
  }

  /**
   * Hide surrender confirmation modal
   */
  hideSurrenderModal() {
    const modal = this.element?.querySelector('#surrender-confirm-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  /**
   * Show opponent disconnected overlay
   * @param {number} remainingSeconds - Seconds until forfeit
   */
  showDisconnectedOverlay(remainingSeconds) {
    const overlay = this.element?.querySelector('#opponent-disconnected-overlay');
    const countdown = this.element?.querySelector('#disconnect-countdown');

    if (overlay && countdown) {
      overlay.style.display = 'flex';
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      countdown.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }

  /**
   * Update the disconnected overlay countdown
   * @param {number} remainingSeconds - Seconds until forfeit
   */
  updateDisconnectedCountdown(remainingSeconds) {
    const countdown = this.element?.querySelector('#disconnect-countdown');
    if (countdown) {
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      countdown.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }

  /**
   * Hide opponent disconnected overlay
   */
  hideDisconnectedOverlay() {
    const overlay = this.element?.querySelector('#opponent-disconnected-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  /**
   * Show opponent turn indicator (PvP - waiting for opponent's action)
   * @param {string} opponentName - Name of the opponent
   */
  showOpponentTurnIndicator(opponentName) {
    const indicator = this.element?.querySelector('#opponent-turn-indicator');
    const text = this.element?.querySelector('#opponent-turn-text');

    if (indicator && text) {
      text.textContent = `Waiting for ${opponentName}...`;
      indicator.style.display = 'block';
    }
  }

  /**
   * Hide opponent turn indicator
   */
  hideOpponentTurnIndicator() {
    const indicator = this.element?.querySelector('#opponent-turn-indicator');
    if (indicator) {
      indicator.style.display = 'none';
    }
  }

  /**
   * Show a persistent timeout warning badge
   * @param {number} timeoutsRemaining - Number of timeouts remaining (1 or 2)
   */
  showTimeoutWarning(timeoutsRemaining) {
    // Find or create the warning badge element
    let badge = this.element?.querySelector('#pvp-timeout-warning');

    if (!badge) {
      // Create badge if it doesn't exist
      const timerPanel = this.element?.querySelector('#pvp-turn-timer');
      if (!timerPanel) return;

      badge = document.createElement('div');
      badge.id = 'pvp-timeout-warning';
      badge.style.cssText = `
        position: absolute;
        top: -8px;
        right: -8px;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: bold;
        text-transform: uppercase;
        animation: pulse 1s ease-in-out infinite;
        z-index: 10;
      `;
      timerPanel.style.position = 'relative';
      timerPanel.appendChild(badge);

      // Add pulse animation if not already in document
      if (!document.querySelector('#pvp-warning-styles')) {
        const style = document.createElement('style');
        style.id = 'pvp-warning-styles';
        style.textContent = `
          @keyframes pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.05); opacity: 0.8; }
          }
        `;
        document.head.appendChild(style);
      }
    }

    // Update badge appearance based on severity
    if (timeoutsRemaining === 1) {
      // Critical - red pulsing badge
      badge.textContent = 'FINAL WARNING';
      badge.style.backgroundColor = '#dc2626';
      badge.style.color = '#fff';
      badge.style.boxShadow = '0 0 8px rgba(220, 38, 38, 0.6)';
    } else {
      // Warning - yellow badge
      badge.textContent = `${timeoutsRemaining} left`;
      badge.style.backgroundColor = '#f59e0b';
      badge.style.color = '#000';
      badge.style.boxShadow = '0 0 8px rgba(245, 158, 11, 0.4)';
    }

    badge.style.display = 'block';
  }

  /**
   * Hide the timeout warning badge
   */
  hideTimeoutWarning() {
    const badge = this.element?.querySelector('#pvp-timeout-warning');
    if (badge) {
      badge.style.display = 'none';
    }
  }

  /**
   * Check if PvP mode is active
   * @returns {boolean}
   */
  isActive() {
    return this.isPvPMode;
  }

  /**
   * Setup PvP-specific event listeners
   * @param {Object} callbacks - Callback functions
   * @param {AbortSignal} signal - Abort signal for cleanup
   */
  setupEventListeners(callbacks, signal) {
    const opts = { signal };

    // PvP Surrender button
    this.element?.querySelector('#btn-surrender')?.addEventListener('click', () => {
      this.showSurrenderModal();
    }, opts);

    // Surrender modal confirm
    this.element?.querySelector('#btn-confirm-surrender')?.addEventListener('click', () => {
      this.hideSurrenderModal();
      callbacks.onSurrender?.();
    }, opts);

    // Surrender modal cancel
    this.element?.querySelector('#btn-cancel-surrender')?.addEventListener('click', () => {
      this.hideSurrenderModal();
    }, opts);
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.isPvPMode = false;
    this.battleUI = null;
  }
}
