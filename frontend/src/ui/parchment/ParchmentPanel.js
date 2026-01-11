/**
 * ParchmentPanel - Base container component with medieval manuscript styling
 *
 * A flexible container component that provides the parchment aesthetic foundation
 * for building UI panels, dialogs, and sections throughout the game.
 *
 * Features:
 * - Warm tan/brown parchment background with subtle texture
 * - Optional title header with decorative styling
 * - Three variants: default, elevated, inset
 * - Configurable padding, borders, and shadows
 * - AbortController-based event cleanup
 *
 * Usage:
 *   const panel = new ParchmentPanel({
 *     title: 'Inventory',
 *     variant: 'elevated',
 *     padding: 'lg'
 *   });
 *   container.appendChild(panel.element);
 *   panel.setContent('<p>Panel contents here</p>');
 *
 * Options:
 *   @param {string} title - Optional header title
 *   @param {string} variant - 'default' | 'elevated' | 'inset'
 *   @param {string} padding - 'sm' | 'md' | 'lg'
 *   @param {boolean} border - Show border (default: true)
 *   @param {boolean} shadow - Show shadow (default: true)
 *   @param {string} className - Additional CSS class names
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentGradient,
  getParchmentGradientTextured,
  getParchmentBorder,
  getParchmentShadow,
  getParchmentInsetShadow,
  getParchmentTextShadow
} from './ParchmentTheme.js';

const STYLE_ID = 'parchment-panel-styles';

export class ParchmentPanel {
  /**
   * @param {Object} options - Panel configuration
   * @param {string} [options.title] - Optional header title
   * @param {string} [options.variant='default'] - Visual variant: 'default' | 'elevated' | 'inset'
   * @param {string} [options.padding='md'] - Content padding: 'sm' | 'md' | 'lg'
   * @param {boolean} [options.border=true] - Show border
   * @param {boolean} [options.shadow=true] - Show box shadow
   * @param {string} [options.className] - Additional CSS classes
   * @param {string} [options.id] - Element ID
   */
  constructor(options = {}) {
    this.options = {
      title: options.title || null,
      variant: options.variant || 'default',
      padding: options.padding || 'md',
      border: options.border !== false,
      shadow: options.shadow !== false,
      className: options.className || '',
      id: options.id || null
    };

    this.element = null;
    this.headerElement = null;
    this.contentElement = null;
    this.abortController = new AbortController();

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
      /* ParchmentPanel Base */
      .parchment-panel {
        background: ${getParchmentGradientTextured()};
        border-radius: ${PARCHMENT_RADIUS.md};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        color: ${PARCHMENT_COLORS.text.primary};
        box-sizing: border-box;
      }

      /* Border variations */
      .parchment-panel--bordered {
        border: ${getParchmentBorder()};
      }

      /* Shadow variations */
      .parchment-panel--shadowed {
        box-shadow: ${getParchmentShadow(false)};
      }

      /* Variant: elevated (more prominent) */
      .parchment-panel--elevated {
        box-shadow: ${getParchmentShadow(true)};
      }

      /* Variant: inset (recessed appearance) */
      .parchment-panel--inset {
        background:
          linear-gradient(135deg, rgba(100, 80, 60, 0.08) 0%, transparent 50%),
          linear-gradient(225deg, rgba(100, 80, 60, 0.08) 0%, transparent 50%),
          linear-gradient(to bottom, ${PARCHMENT_COLORS.dark} 0%, ${PARCHMENT_COLORS.mid} 50%, ${PARCHMENT_COLORS.dark} 100%);
        box-shadow: ${getParchmentInsetShadow()};
        border-color: ${PARCHMENT_COLORS.borderDark};
      }

      /* Padding variations */
      .parchment-panel--padding-sm .parchment-panel__content {
        padding: ${PARCHMENT_SPACING.sm};
      }

      .parchment-panel--padding-md .parchment-panel__content {
        padding: ${PARCHMENT_SPACING.md};
      }

      .parchment-panel--padding-lg .parchment-panel__content {
        padding: ${PARCHMENT_SPACING.lg};
      }

      /* Header */
      .parchment-panel__header {
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        border-bottom: 2px solid ${PARCHMENT_COLORS.border};
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.mid} 0%, ${PARCHMENT_COLORS.dark} 100%);
        border-radius: ${PARCHMENT_RADIUS.md} ${PARCHMENT_RADIUS.md} 0 0;
      }

      .parchment-panel--inset .parchment-panel__header {
        border-bottom-color: ${PARCHMENT_COLORS.borderDark};
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.dark} 0%, #b0a080 100%);
      }

      .parchment-panel__title {
        margin: 0;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.primary};
        text-shadow: ${getParchmentTextShadow()};
        line-height: 1.3;
      }

      /* Content area */
      .parchment-panel__content {
        padding: ${PARCHMENT_SPACING.md};
        line-height: ${PARCHMENT_TYPOGRAPHY.lineHeight};
      }

      /* With header, content gets different border radius */
      .parchment-panel--has-header .parchment-panel__content {
        border-radius: 0 0 ${PARCHMENT_RADIUS.md} ${PARCHMENT_RADIUS.md};
      }

      /* Common text styles within panel */
      .parchment-panel p {
        margin: 0 0 ${PARCHMENT_SPACING.sm};
        color: ${PARCHMENT_COLORS.text.primary};
      }

      .parchment-panel p:last-child {
        margin-bottom: 0;
      }

      .parchment-panel .text-secondary {
        color: ${PARCHMENT_COLORS.text.secondary};
      }

      .parchment-panel .text-muted {
        color: ${PARCHMENT_COLORS.text.muted};
      }

      .parchment-panel .text-success {
        color: ${PARCHMENT_COLORS.state.success};
      }

      .parchment-panel .text-error {
        color: ${PARCHMENT_COLORS.state.error};
      }

      .parchment-panel .text-warning {
        color: ${PARCHMENT_COLORS.state.warning};
      }

      .parchment-panel .text-info {
        color: ${PARCHMENT_COLORS.state.info};
      }

      /* Divider */
      .parchment-panel hr,
      .parchment-panel .parchment-divider {
        border: none;
        border-top: 1px solid ${PARCHMENT_COLORS.border};
        margin: ${PARCHMENT_SPACING.md} 0;
      }

      /* List styling */
      .parchment-panel ul,
      .parchment-panel ol {
        margin: 0 0 ${PARCHMENT_SPACING.sm};
        padding-left: ${PARCHMENT_SPACING.xl};
      }

      .parchment-panel li {
        margin-bottom: ${PARCHMENT_SPACING.xs};
        color: ${PARCHMENT_COLORS.text.primary};
      }

      /* Hidden state */
      .parchment-panel.hidden {
        display: none;
      }

      /* Disabled state */
      .parchment-panel.disabled {
        opacity: 0.6;
        pointer-events: none;
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Create the panel DOM structure
   */
  createElement() {
    this.element = document.createElement('div');

    // Build class list
    const classes = ['parchment-panel'];

    // Variant
    if (this.options.variant !== 'default') {
      classes.push(`parchment-panel--${this.options.variant}`);
    }

    // Border
    if (this.options.border) {
      classes.push('parchment-panel--bordered');
    }

    // Shadow (only if not using variant-specific shadow)
    if (this.options.shadow && this.options.variant === 'default') {
      classes.push('parchment-panel--shadowed');
    }

    // Padding
    classes.push(`parchment-panel--padding-${this.options.padding}`);

    // Has header
    if (this.options.title) {
      classes.push('parchment-panel--has-header');
    }

    // Additional classes
    if (this.options.className) {
      classes.push(this.options.className);
    }

    this.element.className = classes.join(' ');

    // Set ID if provided
    if (this.options.id) {
      this.element.id = this.options.id;
    }

    // Build inner structure
    let html = '';

    // Header
    if (this.options.title) {
      html += `
        <div class="parchment-panel__header">
          <h3 class="parchment-panel__title">${this.escapeHtml(this.options.title)}</h3>
        </div>
      `;
    }

    // Content
    html += '<div class="parchment-panel__content"></div>';

    this.element.innerHTML = html;

    // Store references
    this.headerElement = this.element.querySelector('.parchment-panel__header');
    this.contentElement = this.element.querySelector('.parchment-panel__content');
  }

  /**
   * Set the panel content
   * @param {string|HTMLElement} content - HTML string or DOM element
   */
  setContent(content) {
    if (!this.contentElement) return;

    if (typeof content === 'string') {
      this.contentElement.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      this.contentElement.innerHTML = '';
      this.contentElement.appendChild(content);
    }
  }

  /**
   * Append content to the panel
   * @param {string|HTMLElement} content - HTML string or DOM element
   */
  appendContent(content) {
    if (!this.contentElement) return;

    if (typeof content === 'string') {
      this.contentElement.insertAdjacentHTML('beforeend', content);
    } else if (content instanceof HTMLElement) {
      this.contentElement.appendChild(content);
    }
  }

  /**
   * Clear the panel content
   */
  clearContent() {
    if (this.contentElement) {
      this.contentElement.innerHTML = '';
    }
  }

  /**
   * Update the panel title
   * @param {string} title - New title text
   */
  setTitle(title) {
    if (!this.headerElement) {
      // Need to create header
      if (title) {
        this.options.title = title;
        const header = document.createElement('div');
        header.className = 'parchment-panel__header';
        header.innerHTML = `<h3 class="parchment-panel__title">${this.escapeHtml(title)}</h3>`;
        this.element.insertBefore(header, this.contentElement);
        this.headerElement = header;
        this.element.classList.add('parchment-panel--has-header');
      }
    } else {
      const titleEl = this.headerElement.querySelector('.parchment-panel__title');
      if (titleEl) {
        titleEl.textContent = title;
      }
    }
  }

  /**
   * Show the panel
   */
  show() {
    this.element.classList.remove('hidden');
  }

  /**
   * Hide the panel
   */
  hide() {
    this.element.classList.add('hidden');
  }

  /**
   * Toggle panel visibility
   * @returns {boolean} New visibility state
   */
  toggle() {
    this.element.classList.toggle('hidden');
    return !this.element.classList.contains('hidden');
  }

  /**
   * Check if panel is visible
   * @returns {boolean}
   */
  isVisible() {
    return !this.element.classList.contains('hidden');
  }

  /**
   * Enable the panel
   */
  enable() {
    this.element.classList.remove('disabled');
  }

  /**
   * Disable the panel
   */
  disable() {
    this.element.classList.add('disabled');
  }

  /**
   * Add an event listener with automatic cleanup
   * @param {string} eventType - Event type
   * @param {Function} handler - Event handler
   * @param {EventTarget} [target] - Target element (defaults to panel element)
   */
  addEventListener(eventType, handler, target = this.element) {
    target.addEventListener(eventType, handler, {
      signal: this.abortController.signal
    });
  }

  /**
   * Query selector within the panel
   * @param {string} selector - CSS selector
   * @returns {Element|null}
   */
  querySelector(selector) {
    return this.element.querySelector(selector);
  }

  /**
   * Query selector all within the panel
   * @param {string} selector - CSS selector
   * @returns {NodeList}
   */
  querySelectorAll(selector) {
    return this.element.querySelectorAll(selector);
  }

  /**
   * Get the content element for direct manipulation
   * @returns {HTMLElement}
   */
  getContentElement() {
    return this.contentElement;
  }

  /**
   * Get the header element
   * @returns {HTMLElement|null}
   */
  getHeaderElement() {
    return this.headerElement;
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} str - String to escape
   * @returns {string}
   */
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Clean up resources and remove from DOM
   */
  destroy() {
    // Abort all event listeners
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Remove from DOM
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    this.element = null;
    this.headerElement = null;
    this.contentElement = null;
  }
}

export default ParchmentPanel;
