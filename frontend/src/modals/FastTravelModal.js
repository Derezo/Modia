/**
 * FastTravelModal - Select destination for fast travel
 *
 * Shows available region castles and their travel costs.
 * Requires the Wayfarer's Compass relic.
 */

import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from '../ui/parchment/index.js';
import { escapeHtml } from '../utils/escapeHtml.js';

const P = PARCHMENT_COLORS;

export class FastTravelModal {
  /**
   * @param {Object} options
   * @param {Object} options.game - Game instance
   * @param {Array} options.destinations - Available castle destinations
   * @param {number} options.currentRegionId - Current region ID
   * @param {Function} options.onTravel - Callback when travel selected (destination) => void
   * @param {Function} options.onClose - Callback when modal closes
   */
  constructor(options) {
    this.game = options.game;
    this.destinations = options.destinations || [];
    this.currentRegionId = options.currentRegionId;
    this.onTravel = options.onTravel;
    this.onClose = options.onClose;

    this.element = null;
    this.abortController = null;

    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById('fast-travel-modal-styles')) return;

    const style = document.createElement('style');
    style.id = 'fast-travel-modal-styles';
    style.textContent = `
      .fast-travel-overlay {
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

      .fast-travel-modal {
        background: ${getParchmentGradient()};
        border: ${getParchmentBorder(3)};
        border-radius: 12px;
        box-shadow: ${getParchmentShadow()}, 0 0 40px rgba(0, 0, 0, 0.5);
        max-width: 400px;
        width: 90%;
        max-height: 80vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .fast-travel-header {
        padding: 16px 20px;
        background: linear-gradient(to bottom, ${P.dark}, ${P.mid});
        border-bottom: ${getParchmentBorder()};
        text-align: center;
      }

      .fast-travel-title {
        margin: 0 0 4px 0;
        color: ${P.accent.gold};
        font-size: 20px;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
      }

      .fast-travel-subtitle {
        color: ${P.text.secondary};
        font-size: 13px;
        font-style: italic;
      }

      .fast-travel-content {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
      }

      .fast-travel-destination {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        margin-bottom: 8px;
        background: rgba(139, 115, 85, 0.1);
        border: 1px solid rgba(139, 115, 85, 0.3);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .fast-travel-destination:hover {
        background: rgba(139, 115, 85, 0.2);
        border-color: ${P.accent.copper};
        transform: translateX(4px);
      }

      .fast-travel-destination--current {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .fast-travel-destination--current:hover {
        background: rgba(139, 115, 85, 0.1);
        border-color: rgba(139, 115, 85, 0.3);
        transform: none;
      }

      .fast-travel-dest-info {
        flex: 1;
      }

      .fast-travel-dest-name {
        font-weight: bold;
        color: ${P.text.primary};
        font-size: 14px;
        margin-bottom: 4px;
      }

      .fast-travel-dest-region {
        color: ${P.text.secondary};
        font-size: 12px;
        text-transform: capitalize;
      }

      .fast-travel-dest-cost {
        font-weight: bold;
        color: ${P.accent.gold};
        font-size: 14px;
        white-space: nowrap;
      }

      .fast-travel-footer {
        padding: 12px 16px;
        border-top: ${getParchmentBorder()};
        display: flex;
        justify-content: center;
      }

      .fast-travel-btn {
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

      .fast-travel-btn:hover {
        background: linear-gradient(to bottom, ${P.light}, ${P.mid});
      }

      @media (max-width: 480px) {
        .fast-travel-modal {
          width: 95%;
          max-height: 85vh;
        }

        .fast-travel-destination {
          padding: 10px 12px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'fast-travel-overlay';

    const modal = document.createElement('div');
    modal.className = 'fast-travel-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'fast-travel-header';
    header.innerHTML = `
      <h2 class="fast-travel-title">Fast Travel</h2>
      <p class="fast-travel-subtitle">Select a destination castle</p>
    `;
    modal.appendChild(header);

    // Content - destination list
    const content = document.createElement('div');
    content.className = 'fast-travel-content';

    for (const dest of this.destinations) {
      const destEl = document.createElement('div');
      destEl.className = 'fast-travel-destination';

      if (dest.isCurrentRegion) {
        destEl.classList.add('fast-travel-destination--current');
      } else {
        destEl.addEventListener('click', () => {
          if (this.onTravel) {
            this.onTravel(dest);
          }
        }, { signal: this.abortController.signal });
      }

      destEl.innerHTML = `
        <div class="fast-travel-dest-info">
          <div class="fast-travel-dest-name">${escapeHtml(dest.name)}</div>
          <div class="fast-travel-dest-region">${escapeHtml(dest.regionRace)} Homeland</div>
        </div>
        <div class="fast-travel-dest-cost">${dest.isCurrentRegion ? 'Current' : dest.cost + 'g'}</div>
      `;

      content.appendChild(destEl);
    }

    modal.appendChild(content);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'fast-travel-footer';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'fast-travel-btn';
    closeBtn.textContent = 'Cancel';
    closeBtn.addEventListener('click', () => this.close(), { signal: this.abortController.signal });
    footer.appendChild(closeBtn);

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
