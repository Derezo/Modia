/**
 * ParchmentButton - Medieval-styled button component with parchment aesthetic
 *
 * Features:
 * - Four variants: primary, secondary, danger, ghost
 * - Three sizes: sm, md, lg
 * - Optional icon support
 * - Disabled state handling
 * - Clean event cleanup with AbortController
 *
 * Usage:
 *   const button = new ParchmentButton({
 *     label: 'Confirm',
 *     variant: 'primary',
 *     size: 'md',
 *     onClick: () => console.log('clicked')
 *   });
 *   container.appendChild(button.element);
 *   button.destroy(); // Clean up when done
 */

import { escapeHtml } from '../../utils/escapeHtml.js';

const COLORS = {
  light: '#d4c4a8',
  mid: '#c9b899',
  dark: '#bfae8a',
  border: '#8b7355',
  borderDark: '#6b5344',
  text: {
    primary: '#2d2418',
    secondary: '#5a4a3a',
    light: '#f0e8d8'
  },
  state: {
    error: '#8b4444',
    errorDark: '#7a4545'
  }
};

export default class ParchmentButton {
  /**
   * @param {Object} options
   * @param {string} options.label - Button text
   * @param {string} options.variant - 'primary' | 'secondary' | 'danger' | 'ghost' (default: 'primary')
   * @param {string} options.size - 'sm' | 'md' | 'lg' (default: 'md')
   * @param {boolean} options.disabled - Whether button is disabled (default: false)
   * @param {HTMLElement|string} options.icon - Optional icon element or HTML string
   * @param {Function} options.onClick - Click callback
   */
  constructor(options = {}) {
    this.label = options.label || 'Button';
    this.variant = options.variant || 'primary';
    this.size = options.size || 'md';
    this.disabled = options.disabled || false;
    this.icon = options.icon || null;
    this.onClick = options.onClick || null;

    this.element = null;
    this.abortController = null;

    this.createElement();
    this.addStyles();
    this.bindEvents();
  }

  /**
   * Create the button DOM element
   */
  createElement() {
    this.element = document.createElement('button');
    this.element.type = 'button';
    this.updateElement();
  }

  /**
   * Update element classes and content
   */
  updateElement() {
    this.element.className = `parchment-btn parchment-btn--${this.variant} parchment-btn--${this.size}`;

    if (this.disabled) {
      this.element.classList.add('parchment-btn--disabled');
      this.element.disabled = true;
    } else {
      this.element.disabled = false;
    }

    // Build inner content
    let html = '';

    if (this.icon) {
      const iconHtml = typeof this.icon === 'string' ? this.icon : '';
      html += `<span class="parchment-btn__icon">${iconHtml}</span>`;
    }

    html += `<span class="parchment-btn__label">${escapeHtml(this.label)}</span>`;

    this.element.innerHTML = html;

    // If icon is an HTMLElement, append it
    if (this.icon && typeof this.icon !== 'string') {
      const iconContainer = this.element.querySelector('.parchment-btn__icon');
      if (iconContainer) {
        iconContainer.innerHTML = '';
        iconContainer.appendChild(this.icon);
      }
    }
  }

  /**
   * Add component styles (only once per page)
   */
  addStyles() {
    if (document.getElementById('parchment-button-styles')) return;

    const style = document.createElement('style');
    style.id = 'parchment-button-styles';
    style.textContent = `
      /* Parchment Button Base */
      .parchment-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        border-radius: 4px;
        font-family: 'Georgia', 'Times New Roman', serif;
        font-weight: bold;
        cursor: pointer;
        transition: all 0.15s ease;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.2);
        box-shadow:
          0 2px 4px rgba(0, 0, 0, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.2);
        white-space: nowrap;
        user-select: none;
      }

      .parchment-btn:active:not(.parchment-btn--disabled) {
        transform: translateY(1px);
        box-shadow:
          0 1px 2px rgba(0, 0, 0, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
      }

      .parchment-btn:focus {
        outline: none;
        box-shadow:
          0 2px 4px rgba(0, 0, 0, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.2),
          0 0 0 2px rgba(139, 115, 85, 0.4);
      }

      /* Size Variants */
      .parchment-btn--sm {
        padding: 6px 12px;
        font-size: var(--font-size-sm, 12px);
        min-height: calc(var(--button-height, 36px) - 8px);
        min-width: var(--touch-target, 36px);
      }

      .parchment-btn--md {
        padding: 10px 18px;
        font-size: var(--font-size-md, 14px);
        min-height: var(--button-height, 36px);
        min-width: var(--touch-target, 36px);
      }

      .parchment-btn--lg {
        padding: 14px 24px;
        font-size: var(--font-size-lg, 16px);
        min-height: calc(var(--button-height, 36px) + 8px);
        min-width: var(--touch-target, 36px);
      }

      /* Primary Variant - Brown gradient */
      .parchment-btn--primary {
        background: linear-gradient(to bottom, #8b7355 0%, #7a6345 100%);
        border: 2px solid ${COLORS.borderDark};
        color: ${COLORS.text.light};
        text-shadow: 0 1px 1px rgba(0, 0, 0, 0.3);
      }

      .parchment-btn--primary:hover:not(.parchment-btn--disabled) {
        background: linear-gradient(to bottom, #9b8365 0%, #8a7355 100%);
      }

      /* Secondary Variant - Light parchment */
      .parchment-btn--secondary {
        background: linear-gradient(to bottom, ${COLORS.light} 0%, ${COLORS.mid} 50%, ${COLORS.dark} 100%);
        border: 2px solid ${COLORS.border};
        color: ${COLORS.text.primary};
      }

      .parchment-btn--secondary:hover:not(.parchment-btn--disabled) {
        background: linear-gradient(to bottom, #e0d0b4 0%, ${COLORS.light} 50%, ${COLORS.mid} 100%);
      }

      /* Danger Variant - Red gradient */
      .parchment-btn--danger {
        background: linear-gradient(to bottom, #8b5555 0%, #7a4545 100%);
        border: 2px solid #6b4040;
        color: ${COLORS.text.light};
        text-shadow: 0 1px 1px rgba(0, 0, 0, 0.3);
      }

      .parchment-btn--danger:hover:not(.parchment-btn--disabled) {
        background: linear-gradient(to bottom, #9b6565 0%, #8a5555 100%);
      }

      /* Ghost Variant - Transparent with border */
      .parchment-btn--ghost {
        background: transparent;
        border: 2px solid ${COLORS.border};
        color: ${COLORS.text.primary};
        box-shadow: none;
      }

      .parchment-btn--ghost:hover:not(.parchment-btn--disabled) {
        background: rgba(139, 115, 85, 0.1);
      }

      .parchment-btn--ghost:active:not(.parchment-btn--disabled) {
        background: rgba(139, 115, 85, 0.2);
        box-shadow: none;
      }

      .parchment-btn--ghost:focus {
        box-shadow: 0 0 0 2px rgba(139, 115, 85, 0.4);
      }

      /* Disabled State */
      .parchment-btn--disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Icon styling */
      .parchment-btn__icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .parchment-btn__icon svg {
        width: 1em;
        height: 1em;
      }

      .parchment-btn__label {
        flex: 1;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Bind event handlers
   */
  bindEvents() {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.element.addEventListener('click', (e) => {
      if (!this.disabled && this.onClick) {
        this.onClick(e);
      }
    }, { signal });
  }

  /**
   * Update button properties
   * @param {Object} options - Properties to update
   */
  update(options = {}) {
    if (options.label !== undefined) {
      this.label = options.label;
    }
    if (options.variant !== undefined) {
      this.variant = options.variant;
    }
    if (options.size !== undefined) {
      this.size = options.size;
    }
    if (options.disabled !== undefined) {
      this.disabled = options.disabled;
    }
    if (options.icon !== undefined) {
      this.icon = options.icon;
    }
    if (options.onClick !== undefined) {
      this.onClick = options.onClick;
    }

    this.updateElement();
  }

  /**
   * Set disabled state
   * @param {boolean} disabled
   */
  setDisabled(disabled) {
    this.disabled = disabled;
    this.updateElement();
  }

  /**
   * Set button label
   * @param {string} label
   */
  setLabel(label) {
    this.label = label;
    this.updateElement();
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    this.element = null;
    this.onClick = null;
  }
}

export { ParchmentButton, COLORS };
