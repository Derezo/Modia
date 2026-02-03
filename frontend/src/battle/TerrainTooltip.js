/**
 * TerrainTooltip - DOM-based tooltip for battle terrain tiles
 *
 * Shows terrain information when hovering over tiles:
 * - Terrain name (capitalized)
 * - Movement cost (infinity symbol for impassable)
 * - Numeric height (always shown, including ground level)
 *
 * Uses fixed positioning in top-left corner for consistent UX.
 * Uses Parchment UI theme for consistent visual style.
 *
 * Performance optimizations (Firefox-safe):
 * - Fixed position (no layout calculations)
 * - Throttled updates (max 20fps)
 * - Batched DOM writes (only when content changes)
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from '../ui/parchment/ParchmentTheme.js';

const STYLE_ID = 'terrain-tooltip-styles';

// Throttle interval in ms (50ms = 20fps, plenty for a tooltip)
const THROTTLE_MS = 50;

export class TerrainTooltip {
  constructor() {
    this.element = null;
    this.isVisible = false;

    // Throttling state
    this.lastUpdateTime = 0;

    // Cache last content to avoid redundant DOM writes
    this.lastContent = null;

    this.injectStyles();
    this.createElement();
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
        position: fixed;
        /* Aligned with battle menu (left: 16px, top: 16px + 44px height + 8px gap) */
        left: 16px;
        top: 68px;
        pointer-events: none;
        z-index: 100;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.15s ease-out, visibility 0.15s ease-out;
      }

      @media (max-width: 480px) {
        .terrain-tooltip {
          /* Match mobile menu position (left: 8px, top: 8px) */
          left: 8px;
          top: 60px;
        }
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
   * Attach tooltip to a container element
   * @param {HTMLElement} container
   */
  attachTo(container) {
    if (container && this.element && !this.element.parentNode) {
      container.appendChild(this.element);
    }
  }

  /**
   * Show tooltip with terrain information (throttled, fixed position)
   * @param {Object} options
   * @param {string} options.terrain - Terrain type (e.g., 'grass', 'stone')
   * @param {number} options.movementCost - Movement cost (Infinity for impassable)
   * @param {number} options.elevation - Elevation level (-1 to 3)
   */
  show({ terrain, movementCost, elevation }) {
    const now = performance.now();

    // Throttle updates to avoid excessive DOM writes
    if (now - this.lastUpdateTime < THROTTLE_MS) {
      return;
    }
    this.lastUpdateTime = now;

    // Build content key to detect changes
    const contentKey = `${terrain}|${movementCost}|${elevation}`;

    // Only update DOM content if it changed
    if (contentKey !== this.lastContent) {
      this.updateContent(terrain, movementCost, elevation);
      this.lastContent = contentKey;
    }

    // Show if not visible
    if (!this.isVisible) {
      this.isVisible = true;
      this.element.classList.add('terrain-tooltip--visible');
    }
  }

  /**
   * Update tooltip content (DOM writes batched here)
   */
  updateContent(terrain, movementCost, elevation) {
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
  }

  /**
   * Hide tooltip
   */
  hide() {
    if (!this.isVisible) return;

    this.isVisible = false;
    this.element.classList.remove('terrain-tooltip--visible');
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.element?.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
