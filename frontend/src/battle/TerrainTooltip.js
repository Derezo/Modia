/**
 * TerrainTooltip - DOM-based tooltip for battle terrain tiles
 *
 * Shows terrain information when hovering during move action:
 * - Terrain name (capitalized)
 * - Movement cost (infinity symbol for impassable)
 * - Numeric height (always shown, including ground level)
 *
 * Uses Parchment UI theme for consistent visual style.
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from '../ui/parchment/ParchmentTheme.js';
import { responsive } from '../core/Responsive.js';

const STYLE_ID = 'terrain-tooltip-styles';

export class TerrainTooltip {
  constructor() {
    this.element = null;
    this.isVisible = false;
    this.isMobile = responsive.isMobile();

    this.injectStyles();
    this.createElement();
    this.setupResponsive();
  }

  /**
   * Inject component styles (only once per page)
   */
  injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .terrain-tooltip {
        position: absolute;
        pointer-events: none;
        z-index: 100;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.1s ease-out, visibility 0.1s ease-out;
        will-change: transform, opacity;
      }

      .terrain-tooltip--visible {
        opacity: 1;
        visibility: visible;
      }

      .terrain-tooltip__card {
        background: ${getParchmentGradient('to bottom')};
        border: ${getParchmentBorder()};
        border-radius: 4px;
        box-shadow: ${getParchmentShadow()};
        padding: 6px 10px;
        display: flex;
        align-items: center;
        gap: 8px;
        white-space: nowrap;
      }

      .terrain-tooltip__terrain {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: 12px;
        font-weight: bold;
        color: ${PARCHMENT_COLORS.text.primary};
      }

      .terrain-tooltip__stat {
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamilyMono};
        font-size: 11px;
        color: ${PARCHMENT_COLORS.text.secondary};
        display: flex;
        align-items: center;
        gap: 2px;
      }

      .terrain-tooltip__stat--cost {
        color: ${PARCHMENT_COLORS.text.secondary};
      }

      .terrain-tooltip__stat--impassable {
        color: ${PARCHMENT_COLORS.state.error};
      }

      .terrain-tooltip__stat--height {
        color: ${PARCHMENT_COLORS.text.muted};
      }

      .terrain-tooltip__stat--elevated {
        color: ${PARCHMENT_COLORS.state.success};
      }

      .terrain-tooltip__stat--pit {
        color: ${PARCHMENT_COLORS.state.error};
      }

      .terrain-tooltip__divider {
        width: 1px;
        height: 14px;
        background: ${PARCHMENT_COLORS.border};
        opacity: 0.5;
      }

      @media (max-width: 768px) {
        .terrain-tooltip__card {
          padding: 5px 8px;
          gap: 6px;
        }

        .terrain-tooltip__terrain {
          font-size: 11px;
        }

        .terrain-tooltip__stat {
          font-size: 10px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Create the DOM structure
   */
  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'terrain-tooltip';

    const card = document.createElement('div');
    card.className = 'terrain-tooltip__card';

    // Terrain name
    this.terrainElement = document.createElement('span');
    this.terrainElement.className = 'terrain-tooltip__terrain';
    card.appendChild(this.terrainElement);

    // Divider
    const divider1 = document.createElement('div');
    divider1.className = 'terrain-tooltip__divider';
    card.appendChild(divider1);

    // Movement cost
    this.costElement = document.createElement('span');
    this.costElement.className = 'terrain-tooltip__stat terrain-tooltip__stat--cost';
    card.appendChild(this.costElement);

    // Divider
    const divider2 = document.createElement('div');
    divider2.className = 'terrain-tooltip__divider';
    card.appendChild(divider2);

    // Height
    this.heightElement = document.createElement('span');
    this.heightElement.className = 'terrain-tooltip__stat terrain-tooltip__stat--height';
    card.appendChild(this.heightElement);

    this.element.appendChild(card);
  }

  /**
   * Setup responsive listener
   */
  setupResponsive() {
    this.responsiveUnsubscribe = responsive.onChange(() => {
      this.isMobile = responsive.isMobile();
    });
  }

  /**
   * Attach tooltip to a container element
   * @param {HTMLElement} container
   */
  attachTo(container) {
    if (container && this.element && !this.element.parentNode) {
      container.appendChild(this.element);
    }
  }

  /**
   * Show tooltip with terrain information
   * @param {Object} options
   * @param {string} options.terrain - Terrain type (e.g., 'grass', 'stone')
   * @param {number} options.movementCost - Movement cost (Infinity for impassable)
   * @param {number} options.elevation - Elevation level (-1 to 3)
   * @param {number} options.x - Viewport X position
   * @param {number} options.y - Viewport Y position
   */
  show({ terrain, movementCost, elevation, x, y }) {
    // Format terrain name (capitalize first letter)
    const terrainName = terrain.charAt(0).toUpperCase() + terrain.slice(1);
    this.terrainElement.textContent = terrainName;

    // Format movement cost
    if (movementCost === Infinity) {
      this.costElement.textContent = '\u221E mov';
      this.costElement.className = 'terrain-tooltip__stat terrain-tooltip__stat--impassable';
    } else {
      this.costElement.textContent = `${movementCost} mov`;
      this.costElement.className = 'terrain-tooltip__stat terrain-tooltip__stat--cost';
    }

    // Format height - always show numeric values
    // h:0 for ground, ↑1/↑2/↑3 for elevated, ↓1 for pits
    let heightText;
    let heightClass = 'terrain-tooltip__stat terrain-tooltip__stat--height';

    if (elevation === 0) {
      heightText = 'h:0';
    } else if (elevation > 0) {
      heightText = `\u2191${elevation}`;
      heightClass = 'terrain-tooltip__stat terrain-tooltip__stat--elevated';
    } else {
      heightText = `\u2193${Math.abs(elevation)}`;
      heightClass = 'terrain-tooltip__stat terrain-tooltip__stat--pit';
    }

    this.heightElement.textContent = heightText;
    this.heightElement.className = heightClass;

    // Position tooltip
    this.updatePosition(x, y);

    // Show
    this.isVisible = true;
    this.element.classList.add('terrain-tooltip--visible');
  }

  /**
   * Update tooltip position
   * @param {number} x - Viewport X position
   * @param {number} y - Viewport Y position
   */
  updatePosition(x, y) {
    if (!this.element) return;

    // Get tooltip dimensions
    const tooltipRect = this.element.getBoundingClientRect();
    const tooltipWidth = tooltipRect.width || 150;
    const tooltipHeight = tooltipRect.height || 30;

    // Get container bounds
    const container = this.element.parentElement;
    const containerRect = container?.getBoundingClientRect() || {
      width: window.innerWidth,
      height: window.innerHeight,
      left: 0,
      top: 0
    };

    // Offset from cursor
    const offsetX = this.isMobile ? 0 : 15;
    const offsetY = this.isMobile ? -40 : -25;

    // Calculate position relative to container
    let posX = x + offsetX;
    let posY = y + offsetY;

    // Keep on screen
    const maxX = containerRect.width - tooltipWidth - 10;
    const maxY = containerRect.height - tooltipHeight - 10;

    posX = Math.max(10, Math.min(posX, maxX));
    posY = Math.max(10, Math.min(posY, maxY));

    this.element.style.left = `${posX}px`;
    this.element.style.top = `${posY}px`;
  }

  /**
   * Hide tooltip
   */
  hide() {
    this.isVisible = false;
    this.element.classList.remove('terrain-tooltip--visible');
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.responsiveUnsubscribe) {
      this.responsiveUnsubscribe();
      this.responsiveUnsubscribe = null;
    }

    if (this.element?.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    this.element = null;
  }
}
