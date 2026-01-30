/**
 * ParchmentTooltip - Reusable parchment-styled tooltip component
 *
 * Features:
 * - Instant display (no delay like native title attribute)
 * - Viewport-aware positioning
 * - Smooth fade in/out
 * - Multiline text support with word wrap
 * - Medieval parchment theme styling
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from './ParchmentTheme.js';

const STYLE_ID = 'parchment-tooltip-styles';
const MAX_WIDTH = 250;
const PADDING = 10;

export class ParchmentTooltip {
  constructor() {
    this.element = null;
    this.visible = false;
    this.injectStyles();
    this.createElement();
  }

  /**
   * Inject CSS styles (only once per page)
   */
  injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .parchment-tooltip {
        position: fixed;
        z-index: 10001;
        pointer-events: none;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.15s ease-out, visibility 0.15s ease-out;
        will-change: transform, opacity;
      }

      .parchment-tooltip--visible {
        opacity: 1;
        visibility: visible;
      }

      .parchment-tooltip__content {
        background: ${getParchmentGradient('to bottom')};
        border: ${getParchmentBorder(1)};
        border-radius: 4px;
        box-shadow: ${getParchmentShadow()};
        padding: 6px 10px;
        max-width: ${MAX_WIDTH}px;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${PARCHMENT_COLORS.text.primary};
        line-height: 1.4;
        word-wrap: break-word;
        white-space: pre-wrap;
      }

      /* Arrow indicator */
      .parchment-tooltip__arrow {
        position: absolute;
        width: 0;
        height: 0;
        border: 6px solid transparent;
      }

      .parchment-tooltip--below .parchment-tooltip__arrow {
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        border-bottom-color: ${PARCHMENT_COLORS.border};
      }

      .parchment-tooltip--above .parchment-tooltip__arrow {
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border-top-color: ${PARCHMENT_COLORS.border};
      }

      .parchment-tooltip--left .parchment-tooltip__arrow {
        left: 100%;
        top: 50%;
        transform: translateY(-50%);
        border-left-color: ${PARCHMENT_COLORS.border};
      }

      .parchment-tooltip--right .parchment-tooltip__arrow {
        right: 100%;
        top: 50%;
        transform: translateY(-50%);
        border-right-color: ${PARCHMENT_COLORS.border};
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Create the DOM element
   */
  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'parchment-tooltip';

    this.contentElement = document.createElement('div');
    this.contentElement.className = 'parchment-tooltip__content';

    this.arrowElement = document.createElement('div');
    this.arrowElement.className = 'parchment-tooltip__arrow';

    this.element.appendChild(this.contentElement);
    this.element.appendChild(this.arrowElement);
    document.body.appendChild(this.element);
  }

  /**
   * Show tooltip with text at position
   * @param {string} text - Tooltip text (supports newlines)
   * @param {number} x - X position in viewport
   * @param {number} y - Y position in viewport
   */
  show(text, x, y) {
    if (!text) {
      this.hide();
      return;
    }

    this.contentElement.textContent = text;
    this.visible = true;
    this.element.classList.add('parchment-tooltip--visible');
    this.updatePosition(x, y);
  }

  /**
   * Hide tooltip
   */
  hide() {
    this.visible = false;
    this.element.classList.remove('parchment-tooltip--visible');
  }

  /**
   * Update tooltip position with viewport awareness
   * @param {number} x - X position in viewport
   * @param {number} y - Y position in viewport
   */
  updatePosition(x, y) {
    if (!this.visible) return;

    const rect = this.element.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Calculate dimensions
    const tooltipWidth = rect.width || MAX_WIDTH;
    const tooltipHeight = rect.height || 30;

    // Remove previous position classes
    this.element.classList.remove(
      'parchment-tooltip--above',
      'parchment-tooltip--below',
      'parchment-tooltip--left',
      'parchment-tooltip--right'
    );

    // Default: show below cursor
    let posX = x - tooltipWidth / 2;
    let posY = y + PADDING;
    let position = 'below';

    // Check if tooltip fits below
    if (posY + tooltipHeight > viewportHeight - PADDING) {
      // Show above instead
      posY = y - tooltipHeight - PADDING;
      position = 'above';
    }

    // Horizontal bounds check
    if (posX < PADDING) {
      posX = PADDING;
    } else if (posX + tooltipWidth > viewportWidth - PADDING) {
      posX = viewportWidth - tooltipWidth - PADDING;
    }

    // Vertical bounds check (if still overflowing after flip)
    if (posY < PADDING) {
      posY = PADDING;
    }

    this.element.style.left = `${posX}px`;
    this.element.style.top = `${posY}px`;
    this.element.classList.add(`parchment-tooltip--${position}`);
  }

  /**
   * Clean up and remove from DOM
   */
  destroy() {
    this.hide();
    if (this.element?.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.contentElement = null;
    this.arrowElement = null;
  }
}

// Singleton instance for convenience
let tooltipInstance = null;

/**
 * Get or create the singleton tooltip instance
 * @returns {ParchmentTooltip}
 */
export function getParchmentTooltip() {
  if (!tooltipInstance) {
    tooltipInstance = new ParchmentTooltip();
  }
  return tooltipInstance;
}

export default ParchmentTooltip;
