/**
 * StaminaRestoreModal - Purchase stamina restoration for gold
 *
 * Allows players to restore stamina at town nodes.
 * Requires the Vitality Charm relic.
 */

import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from '../ui/parchment/index.js';

const P = PARCHMENT_COLORS;

export class StaminaRestoreModal {
  /**
   * @param {Object} options
   * @param {Object} options.game - Game instance
   * @param {number} options.currentStamina - Current stamina
   * @param {number} options.maxStamina - Maximum stamina
   * @param {number} options.costPerPoint - Gold cost per stamina point
   * @param {number} options.userGold - User's current gold
   * @param {Function} options.onRestore - Callback when restore confirmed (amount) => void
   * @param {Function} options.onClose - Callback when modal closes
   */
  constructor(options) {
    this.game = options.game;
    this.currentStamina = options.currentStamina;
    this.maxStamina = options.maxStamina;
    this.costPerPoint = options.costPerPoint || 100;
    this.userGold = options.userGold || 0;
    this.onRestore = options.onRestore;
    this.onClose = options.onClose;

    this.element = null;
    this.abortController = null;

    // Selected amount to restore
    this.selectedAmount = Math.min(
      this.maxStamina - this.currentStamina,
      Math.floor(this.userGold / this.costPerPoint)
    );

    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById('stamina-restore-modal-styles')) return;

    const style = document.createElement('style');
    style.id = 'stamina-restore-modal-styles';
    style.textContent = `
      .stamina-restore-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        font-family: Georgia, 'Times New Roman', serif;
      }

      .stamina-restore-modal {
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder(3)};
        border-radius: 12px;
        box-shadow: ${getParchmentShadow()}, 0 0 40px rgba(0, 0, 0, 0.5);
        max-width: 360px;
        width: 90%;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .stamina-restore-header {
        padding: 16px 20px;
        background: linear-gradient(to bottom, ${P.dark}, ${P.mid});
        border-bottom: ${getParchmentBorder()};
        text-align: center;
      }

      .stamina-restore-title {
        margin: 0 0 4px 0;
        color: ${P.accent.gold};
        font-size: 20px;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
      }

      .stamina-restore-subtitle {
        color: ${P.text.secondary};
        font-size: 13px;
        font-style: italic;
      }

      .stamina-restore-content {
        padding: 20px;
      }

      .stamina-restore-status {
        display: flex;
        justify-content: space-between;
        padding: 12px 16px;
        background: rgba(139, 115, 85, 0.1);
        border: 1px solid rgba(139, 115, 85, 0.3);
        border-radius: 8px;
        margin-bottom: 16px;
      }

      .stamina-restore-label {
        color: ${P.text.secondary};
        font-size: 13px;
      }

      .stamina-restore-value {
        font-weight: bold;
        color: ${P.text.primary};
        font-size: 14px;
      }

      .stamina-restore-value--gold {
        color: ${P.accent.gold};
      }

      .stamina-restore-slider-container {
        margin: 20px 0;
      }

      .stamina-restore-slider-label {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
        color: ${P.text.secondary};
        font-size: 13px;
      }

      .stamina-restore-slider-value {
        font-weight: bold;
        color: ${P.accent.gold};
      }

      .stamina-restore-slider {
        width: 100%;
        height: 8px;
        border-radius: 4px;
        background: rgba(139, 115, 85, 0.3);
        appearance: none;
        cursor: pointer;
      }

      .stamina-restore-slider::-webkit-slider-thumb {
        appearance: none;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: ${P.accent.copper};
        border: 2px solid ${P.accent.gold};
        cursor: pointer;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .stamina-restore-slider::-moz-range-thumb {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: ${P.accent.copper};
        border: 2px solid ${P.accent.gold};
        cursor: pointer;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .stamina-restore-cost {
        text-align: center;
        padding: 12px;
        background: linear-gradient(to bottom, ${P.dark}, ${P.mid});
        border-radius: 8px;
        margin-top: 16px;
      }

      .stamina-restore-cost-label {
        color: ${P.text.secondary};
        font-size: 12px;
        margin-bottom: 4px;
      }

      .stamina-restore-cost-value {
        font-size: 20px;
        font-weight: bold;
        color: ${P.accent.gold};
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
      }

      .stamina-restore-footer {
        padding: 12px 16px;
        border-top: ${getParchmentBorder()};
        display: flex;
        justify-content: center;
        gap: 12px;
      }

      .stamina-restore-btn {
        padding: 8px 24px;
        border: ${getParchmentBorder()};
        border-radius: 6px;
        font-family: inherit;
        font-size: 13px;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.15s ease;
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
        color: ${P.text.primary};
      }

      .stamina-restore-btn:hover {
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
      }

      .stamina-restore-btn--primary {
        background: linear-gradient(to bottom, ${P.accent.copper}, #9a5f23);
        color: ${P.text.inverse};
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
      }

      .stamina-restore-btn--primary:hover {
        background: linear-gradient(to bottom, #d4a44a, ${P.accent.copper});
      }

      .stamina-restore-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .stamina-restore-btn:disabled:hover {
        background: linear-gradient(to bottom, ${P.mid}, ${P.dark});
      }

      @media (max-width: 480px) {
        .stamina-restore-modal {
          width: 95%;
        }
      }
    `;
    document.head.appendChild(style);
  }

  createElement() {
    const missingStamina = this.maxStamina - this.currentStamina;
    const maxAffordable = Math.floor(this.userGold / this.costPerPoint);
    const maxRestoreAmount = Math.min(missingStamina, maxAffordable);

    this.element = document.createElement('div');
    this.element.className = 'stamina-restore-overlay';

    const modal = document.createElement('div');
    modal.className = 'stamina-restore-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'stamina-restore-header';
    header.innerHTML = `
      <h2 class="stamina-restore-title">Rest at Town</h2>
      <p class="stamina-restore-subtitle">Restore stamina for gold</p>
    `;
    modal.appendChild(header);

    // Content
    const content = document.createElement('div');
    content.className = 'stamina-restore-content';

    // Status info
    content.innerHTML = `
      <div class="stamina-restore-status">
        <div>
          <div class="stamina-restore-label">Current Stamina</div>
          <div class="stamina-restore-value">${this.currentStamina} / ${this.maxStamina}</div>
        </div>
        <div style="text-align: right;">
          <div class="stamina-restore-label">Your Gold</div>
          <div class="stamina-restore-value stamina-restore-value--gold">${this.userGold}g</div>
        </div>
      </div>
    `;

    // Slider container
    const sliderContainer = document.createElement('div');
    sliderContainer.className = 'stamina-restore-slider-container';

    const sliderLabel = document.createElement('div');
    sliderLabel.className = 'stamina-restore-slider-label';
    sliderLabel.innerHTML = `
      <span>Stamina to restore:</span>
      <span class="stamina-restore-slider-value">${this.selectedAmount}</span>
    `;
    sliderContainer.appendChild(sliderLabel);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'stamina-restore-slider';
    slider.min = 1;
    slider.max = Math.max(1, maxRestoreAmount);
    slider.value = this.selectedAmount;

    if (maxRestoreAmount <= 0) {
      slider.disabled = true;
    }

    slider.addEventListener('input', (e) => {
      this.selectedAmount = parseInt(e.target.value, 10);
      sliderLabel.querySelector('.stamina-restore-slider-value').textContent = this.selectedAmount;
      costValue.textContent = `${this.selectedAmount * this.costPerPoint}g`;
      restoreBtn.disabled = this.selectedAmount <= 0;
    }, { signal: this.abortController.signal });

    sliderContainer.appendChild(slider);
    content.appendChild(sliderContainer);

    // Cost display
    const costDiv = document.createElement('div');
    costDiv.className = 'stamina-restore-cost';
    costDiv.innerHTML = `
      <div class="stamina-restore-cost-label">Total Cost</div>
      <div class="stamina-restore-cost-value">${this.selectedAmount * this.costPerPoint}g</div>
    `;
    const costValue = costDiv.querySelector('.stamina-restore-cost-value');
    content.appendChild(costDiv);

    modal.appendChild(content);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'stamina-restore-footer';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'stamina-restore-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.close(), { signal: this.abortController.signal });
    footer.appendChild(cancelBtn);

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'stamina-restore-btn stamina-restore-btn--primary';
    restoreBtn.textContent = 'Rest';
    restoreBtn.disabled = this.selectedAmount <= 0;
    restoreBtn.addEventListener('click', () => {
      if (this.onRestore && this.selectedAmount > 0) {
        this.onRestore(this.selectedAmount);
      }
    }, { signal: this.abortController.signal });
    footer.appendChild(restoreBtn);

    modal.appendChild(footer);
    this.element.appendChild(modal);

    // Close on overlay click
    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) {
        this.close();
      }
    }, { signal: this.abortController.signal });
  }

  show() {
    this.abortController = new AbortController();
    this.createElement();
    this.game.uiOverlay.appendChild(this.element);
  }

  close() {
    if (this.onClose) {
      this.onClose();
    }
  }

  destroy() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.element?.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
