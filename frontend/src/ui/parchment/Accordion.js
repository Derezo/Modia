/**
 * Accordion - Collapsible panel component with parchment styling
 *
 * A collapsible section component that maintains the parchment aesthetic
 * with smooth expand/collapse animations and optional state persistence.
 *
 * Features:
 * - Animated expand/collapse with CSS transitions
 * - Optional localStorage state persistence
 * - Badge indicator support (for action indicators)
 * - Context-dependent default state (open if badge present)
 * - Click header to toggle
 *
 * Usage:
 *   const accordion = new Accordion({
 *     id: 'equipment-section',
 *     title: 'Equipment',
 *     badge: '3 upgrades',
 *     defaultOpen: true,
 *     persist: true
 *   });
 *   container.appendChild(accordion.element);
 *   accordion.setContent('<div>Equipment list here</div>');
 *
 * Options:
 *   @param {string} id - Unique identifier (required for persistence)
 *   @param {string} title - Header title text
 *   @param {string} badge - Optional badge text (e.g., "3 points")
 *   @param {boolean} defaultOpen - Initial state if no persisted state
 *   @param {boolean} persist - Whether to save state to localStorage
 *   @param {Function} onToggle - Callback when expanded state changes
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentBorder,
  getParchmentTextShadow,
  getParchmentInsetShadow
} from './ParchmentTheme.js';

const STYLE_ID = 'parchment-accordion-styles';
const STORAGE_PREFIX = 'accordion:';

export class Accordion {
  /**
   * @param {Object} options - Accordion configuration
   * @param {string} options.id - Unique identifier for persistence
   * @param {string} options.title - Header title text
   * @param {string} [options.badge] - Optional badge text
   * @param {boolean} [options.defaultOpen=false] - Initial expanded state
   * @param {boolean} [options.persist=true] - Persist state to localStorage
   * @param {Function} [options.onToggle] - Callback(isExpanded) when toggled
   */
  constructor(options = {}) {
    this.options = {
      id: options.id || `accordion-${Date.now()}`,
      title: options.title || 'Section',
      badge: options.badge || null,
      defaultOpen: options.defaultOpen !== undefined ? options.defaultOpen : false,
      persist: options.persist !== false,
      onToggle: options.onToggle || null
    };

    this.element = null;
    this.headerElement = null;
    this.contentElement = null;
    this.contentWrapper = null;
    this.chevronElement = null;
    this.badgeElement = null;
    this.isExpanded = false;
    this.abortController = new AbortController();

    this.injectStyles();
    this.createElement();
    this.initializeState();
    this.setupEventListeners();
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
      /* Accordion Base */
      .parchment-accordion {
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.md};
        overflow: hidden;
        margin-bottom: ${PARCHMENT_SPACING.sm};
        background: ${PARCHMENT_COLORS.mid};
      }

      /* Header */
      .parchment-accordion__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: ${PARCHMENT_SPACING.sm} ${PARCHMENT_SPACING.md};
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.mid} 0%, ${PARCHMENT_COLORS.dark} 100%);
        cursor: pointer;
        user-select: none;
        transition: background 0.2s ease;
      }

      .parchment-accordion__header:hover {
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.light} 0%, ${PARCHMENT_COLORS.mid} 100%);
      }

      .parchment-accordion__header:active {
        background: ${PARCHMENT_COLORS.dark};
      }

      /* Title and badge container */
      .parchment-accordion__title-group {
        display: flex;
        align-items: center;
        gap: ${PARCHMENT_SPACING.sm};
        flex: 1;
        min-width: 0;
      }

      .parchment-accordion__title {
        margin: 0;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.lg};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.primary};
        text-shadow: ${getParchmentTextShadow()};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Badge */
      .parchment-accordion__badge {
        padding: 2px 8px;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.xs};
        font-weight: ${PARCHMENT_TYPOGRAPHY.weights.bold};
        color: ${PARCHMENT_COLORS.text.inverse};
        background: ${PARCHMENT_COLORS.accent.burgundy};
        border-radius: 10px;
        white-space: nowrap;
      }

      .parchment-accordion__badge--success {
        background: ${PARCHMENT_COLORS.state.success};
      }

      .parchment-accordion__badge--warning {
        background: ${PARCHMENT_COLORS.state.warning};
        color: ${PARCHMENT_COLORS.text.primary};
      }

      /* Chevron */
      .parchment-accordion__chevron {
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: ${PARCHMENT_COLORS.text.secondary};
        transition: transform 0.3s ease;
        flex-shrink: 0;
      }

      .parchment-accordion--expanded .parchment-accordion__chevron {
        transform: rotate(180deg);
      }

      /* Content wrapper (for animation) */
      .parchment-accordion__wrapper {
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.3s ease;
      }

      .parchment-accordion--expanded .parchment-accordion__wrapper {
        max-height: 2000px; /* Large enough for most content */
      }

      /* Content area */
      .parchment-accordion__content {
        padding: ${PARCHMENT_SPACING.md};
        background: linear-gradient(135deg, rgba(180, 160, 130, 0.05) 0%, transparent 50%),
                    linear-gradient(225deg, rgba(100, 80, 60, 0.05) 0%, transparent 50%),
                    ${PARCHMENT_COLORS.light};
        border-top: 1px solid ${PARCHMENT_COLORS.border};
        box-shadow: ${getParchmentInsetShadow()};
      }

      /* Empty state */
      .parchment-accordion__empty {
        text-align: center;
        padding: ${PARCHMENT_SPACING.lg};
        color: ${PARCHMENT_COLORS.text.muted};
        font-style: italic;
      }

      /* Loading state */
      .parchment-accordion__loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: ${PARCHMENT_SPACING.lg};
        color: ${PARCHMENT_COLORS.text.muted};
      }

      .parchment-accordion__loading::after {
        content: '';
        width: 16px;
        height: 16px;
        margin-left: ${PARCHMENT_SPACING.sm};
        border: 2px solid ${PARCHMENT_COLORS.border};
        border-top-color: ${PARCHMENT_COLORS.borderDark};
        border-radius: 50%;
        animation: accordion-spin 0.8s linear infinite;
      }

      @keyframes accordion-spin {
        to { transform: rotate(360deg); }
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Create the accordion DOM structure
   */
  createElement() {
    this.element = document.createElement('div');
    this.element.className = 'parchment-accordion';
    this.element.id = this.options.id;

    // Build HTML
    this.element.innerHTML = `
      <div class="parchment-accordion__header" role="button" tabindex="0" aria-expanded="false">
        <div class="parchment-accordion__title-group">
          <h4 class="parchment-accordion__title">${this.escapeHtml(this.options.title)}</h4>
          ${this.options.badge ? `<span class="parchment-accordion__badge">${this.escapeHtml(this.options.badge)}</span>` : ''}
        </div>
        <span class="parchment-accordion__chevron">&#9660;</span>
      </div>
      <div class="parchment-accordion__wrapper">
        <div class="parchment-accordion__content"></div>
      </div>
    `;

    // Store references
    this.headerElement = this.element.querySelector('.parchment-accordion__header');
    this.contentWrapper = this.element.querySelector('.parchment-accordion__wrapper');
    this.contentElement = this.element.querySelector('.parchment-accordion__content');
    this.chevronElement = this.element.querySelector('.parchment-accordion__chevron');
    this.badgeElement = this.element.querySelector('.parchment-accordion__badge');
  }

  /**
   * Initialize the expanded state from storage or defaults
   */
  initializeState() {
    let initialState = this.options.defaultOpen;

    // Check localStorage if persistence is enabled
    if (this.options.persist) {
      const stored = localStorage.getItem(STORAGE_PREFIX + this.options.id);
      if (stored !== null) {
        initialState = stored === 'true';
      } else if (this.options.badge) {
        // Default to open if badge is present (action available)
        initialState = true;
      }
    }

    // Apply initial state without animation
    if (initialState) {
      this.element.classList.add('parchment-accordion--expanded');
      this.headerElement.setAttribute('aria-expanded', 'true');
    }
    this.isExpanded = initialState;
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    const signal = this.abortController.signal;

    // Click to toggle
    this.headerElement.addEventListener('click', () => this.toggle(), { signal });

    // Keyboard support
    this.headerElement.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggle();
      }
    }, { signal });
  }

  /**
   * Toggle the accordion state
   */
  toggle() {
    this.isExpanded = !this.isExpanded;

    if (this.isExpanded) {
      this.element.classList.add('parchment-accordion--expanded');
    } else {
      this.element.classList.remove('parchment-accordion--expanded');
    }

    this.headerElement.setAttribute('aria-expanded', String(this.isExpanded));

    // Persist state
    if (this.options.persist) {
      localStorage.setItem(STORAGE_PREFIX + this.options.id, String(this.isExpanded));
    }

    // Callback
    if (this.options.onToggle) {
      this.options.onToggle(this.isExpanded);
    }
  }

  /**
   * Expand the accordion
   */
  expand() {
    if (!this.isExpanded) {
      this.toggle();
    }
  }

  /**
   * Collapse the accordion
   */
  collapse() {
    if (this.isExpanded) {
      this.toggle();
    }
  }

  /**
   * Set the content
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
   * Append content
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
   * Clear content
   */
  clearContent() {
    if (this.contentElement) {
      this.contentElement.innerHTML = '';
    }
  }

  /**
   * Show loading state
   * @param {string} message - Loading message
   */
  showLoading(message = 'Loading') {
    this.setContent(`<div class="parchment-accordion__loading">${this.escapeHtml(message)}</div>`);
  }

  /**
   * Show empty state
   * @param {string} message - Empty state message
   */
  showEmpty(message = 'No items') {
    this.setContent(`<div class="parchment-accordion__empty">${this.escapeHtml(message)}</div>`);
  }

  /**
   * Update the title
   * @param {string} title - New title text
   */
  setTitle(title) {
    const titleEl = this.element.querySelector('.parchment-accordion__title');
    if (titleEl) {
      titleEl.textContent = title;
    }
    this.options.title = title;
  }

  /**
   * Update the badge
   * @param {string|null} badge - Badge text or null to remove
   * @param {string} [variant] - Badge variant: 'default' | 'success' | 'warning'
   */
  setBadge(badge, variant = 'default') {
    const titleGroup = this.element.querySelector('.parchment-accordion__title-group');

    // Remove existing badge
    if (this.badgeElement) {
      this.badgeElement.remove();
      this.badgeElement = null;
    }

    // Add new badge if provided
    if (badge) {
      const badgeEl = document.createElement('span');
      badgeEl.className = 'parchment-accordion__badge';
      if (variant !== 'default') {
        badgeEl.classList.add(`parchment-accordion__badge--${variant}`);
      }
      badgeEl.textContent = badge;
      titleGroup.appendChild(badgeEl);
      this.badgeElement = badgeEl;
    }

    this.options.badge = badge;
  }

  /**
   * Get the content element for direct manipulation
   * @returns {HTMLElement}
   */
  getContentElement() {
    return this.contentElement;
  }

  /**
   * Query selector within content
   * @param {string} selector - CSS selector
   * @returns {Element|null}
   */
  querySelector(selector) {
    return this.contentElement?.querySelector(selector);
  }

  /**
   * Query selector all within content
   * @param {string} selector - CSS selector
   * @returns {NodeList}
   */
  querySelectorAll(selector) {
    return this.contentElement?.querySelectorAll(selector) || [];
  }

  /**
   * Check if accordion is currently expanded
   * @returns {boolean}
   */
  isOpen() {
    return this.isExpanded;
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
   * Clean up resources
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
    this.contentWrapper = null;
    this.chevronElement = null;
    this.badgeElement = null;
  }
}

export default Accordion;
