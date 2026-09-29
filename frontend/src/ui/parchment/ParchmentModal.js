/**
 * ParchmentModal - Medieval-styled modal dialog component for confirmations and forms
 *
 * Features:
 * - Three size variants: sm, md, lg
 * - Optional close button in header
 * - Click outside to close (configurable)
 * - ESC key to close (configurable)
 * - Focus trap within modal when open
 * - Body scroll lock when open
 * - Multiple modal stacking with z-index management
 * - Smooth fade/scale animations
 * - Clean event cleanup with AbortController
 *
 * Usage:
 *   const modal = new ParchmentModal({
 *     title: 'Confirm Action',
 *     content: 'Are you sure you want to proceed?',
 *     size: 'md',
 *     closable: true,
 *     closeOnOverlay: true,
 *     closeOnEscape: true,
 *     actions: [
 *       { label: 'Cancel', variant: 'secondary', onClick: () => modal.close() },
 *       { label: 'Confirm', variant: 'primary', onClick: () => { ... } }
 *     ],
 *     onClose: () => {},
 *     onOpen: () => {}
 *   });
 *   modal.open();
 *   modal.close();
 */

import { PARCHMENT_COLORS } from './ParchmentTheme.js';
import ParchmentButton from './ParchmentButton.js';

const STYLE_ID = 'parchment-modal-styles';

// Track open modals for stacking z-index
const openModals = [];
const baseZIndex = 1000;

/**
 * Get the next z-index for a new modal
 * @returns {number}
 */
function getNextZIndex() {
  return baseZIndex + (openModals.length * 10);
}

/**
 * Register a modal as open
 * @param {ParchmentModal} modal
 */
function registerModal(modal) {
  openModals.push(modal);
}

/**
 * Unregister a modal when closed
 * @param {ParchmentModal} modal
 */
function unregisterModal(modal) {
  const index = openModals.indexOf(modal);
  if (index > -1) {
    openModals.splice(index, 1);
  }
}

/**
 * Check if this is the topmost modal
 * @param {ParchmentModal} modal
 * @returns {boolean}
 */
function isTopModal(modal) {
  return openModals.length > 0 && openModals[openModals.length - 1] === modal;
}

export class ParchmentModal {
  /**
   * @param {Object} options - Modal configuration
   * @param {string} [options.title] - Modal title text
   * @param {string|HTMLElement} [options.content] - Modal body content (string or element)
   * @param {string} [options.size='md'] - Size variant: 'sm' | 'md' | 'lg'
   * @param {boolean} [options.closable=true] - Show close button in header
   * @param {boolean} [options.closeOnOverlay=true] - Close when clicking overlay
   * @param {boolean} [options.closeOnEscape=true] - Close when pressing ESC
   * @param {Array} [options.actions] - Footer action buttons array
   * @param {Function} [options.onClose] - Callback when modal closes
   * @param {Function} [options.onOpen] - Callback when modal opens
   */
  constructor(options = {}) {
    this.options = {
      title: options.title || '',
      content: options.content || '',
      size: options.size || 'md',
      closable: options.closable !== false,
      closeOnOverlay: options.closeOnOverlay !== false,
      closeOnEscape: options.closeOnEscape !== false,
      actions: options.actions || [],
      onClose: options.onClose || null,
      onOpen: options.onOpen || null
    };

    this.element = null;
    this.overlayElement = null;
    this.modalElement = null;
    this.contentElement = null;
    this.abortController = null;
    this.isOpen = false;
    this.triggerElement = null;
    this.buttons = [];
    this.previousActiveElement = null;
    this.previousOverflow = null;

    this.injectStyles();
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
      /* Parchment Modal Overlay */
      .parchment-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        justify-content: center;
        align-items: center;
        opacity: 0;
        transition: opacity 0.2s ease-out;
        padding: 20px;
        box-sizing: border-box;
      }

      @supports (backdrop-filter: blur(4px)) {
        .parchment-modal-overlay {
          backdrop-filter: blur(4px);
        }
      }

      .parchment-modal-overlay.visible {
        opacity: 1;
      }

      /* Modal Container */
      .parchment-modal {
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.light} 0%, ${PARCHMENT_COLORS.mid} 50%, ${PARCHMENT_COLORS.dark} 100%);
        border: 3px solid ${PARCHMENT_COLORS.border};
        border-radius: 6px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4),
                    inset 0 1px 0 rgba(255, 255, 255, 0.3),
                    inset 0 -1px 0 rgba(0, 0, 0, 0.1);
        font-family: 'Georgia', 'Times New Roman', serif;
        color: ${PARCHMENT_COLORS.text.primary};
        display: flex;
        flex-direction: column;
        max-height: calc(100vh - 40px);
        transform: scale(0.9);
        transition: transform 0.2s ease-out;
      }

      .parchment-modal-overlay.visible .parchment-modal {
        transform: scale(1);
      }

      /* Size Variants */
      .parchment-modal--sm {
        max-width: 320px;
        width: 100%;
      }

      .parchment-modal--md {
        max-width: 480px;
        width: 100%;
      }

      .parchment-modal--lg {
        max-width: 640px;
        width: 100%;
      }

      /* Modal Header */
      .parchment-modal-header {
        padding: 12px 16px;
        border-bottom: 2px solid ${PARCHMENT_COLORS.border};
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.mid} 0%, ${PARCHMENT_COLORS.dark} 100%);
        border-radius: 3px 3px 0 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
      }

      .parchment-modal-title {
        margin: 0;
        font-size: 18px;
        font-weight: bold;
        color: ${PARCHMENT_COLORS.text.primary};
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
        line-height: 1.3;
      }

      /* Close Button */
      .parchment-modal-close {
        background: none;
        border: none;
        font-size: 28px;
        line-height: 1;
        color: ${PARCHMENT_COLORS.text.secondary};
        cursor: pointer;
        padding: 0 4px;
        margin: -4px -4px -4px 8px;
        border-radius: 4px;
        transition: all 0.15s ease;
        font-family: inherit;
      }

      .parchment-modal-close:hover {
        color: ${PARCHMENT_COLORS.text.primary};
        background: rgba(139, 115, 85, 0.2);
      }

      .parchment-modal-close:focus {
        outline: none;
        box-shadow: 0 0 0 2px rgba(139, 115, 85, 0.4);
      }

      /* Modal Content */
      .parchment-modal-content {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
        line-height: 1.5;
      }

      .parchment-modal-content p {
        margin: 0 0 12px;
      }

      .parchment-modal-content p:last-child {
        margin-bottom: 0;
      }

      /* Modal Footer */
      .parchment-modal-footer {
        padding: 12px 16px;
        border-top: 2px solid ${PARCHMENT_COLORS.border};
        background: linear-gradient(to bottom, ${PARCHMENT_COLORS.mid} 0%, ${PARCHMENT_COLORS.dark} 100%);
        border-radius: 0 0 3px 3px;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        flex-shrink: 0;
      }

      /* No header variant */
      .parchment-modal--no-header .parchment-modal-content {
        border-radius: 3px 3px 0 0;
      }

      /* No footer variant */
      .parchment-modal--no-footer .parchment-modal-content {
        border-radius: 0 0 3px 3px;
      }

      /* No header and no footer */
      .parchment-modal--no-header.parchment-modal--no-footer .parchment-modal-content {
        border-radius: 3px;
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Create the modal DOM structure
   */
  createElement() {
    // Create overlay
    this.overlayElement = document.createElement('div');
    this.overlayElement.className = 'parchment-modal-overlay';
    this.overlayElement.style.zIndex = getNextZIndex();

    // Create modal container
    this.modalElement = document.createElement('div');
    this.modalElement.className = `parchment-modal parchment-modal--${this.options.size}`;
    this.modalElement.setAttribute('role', 'dialog');
    this.modalElement.setAttribute('aria-modal', 'true');
    if (this.options.title) {
      this.modalElement.setAttribute('aria-labelledby', 'parchment-modal-title');
    }

    // Build modal structure
    const hasHeader = this.options.title || this.options.closable;
    const hasFooter = this.options.actions.length > 0;

    if (!hasHeader) {
      this.modalElement.classList.add('parchment-modal--no-header');
    }
    if (!hasFooter) {
      this.modalElement.classList.add('parchment-modal--no-footer');
    }

    // Header
    if (hasHeader) {
      const header = document.createElement('div');
      header.className = 'parchment-modal-header';

      const title = document.createElement('h2');
      title.className = 'parchment-modal-title';
      title.id = 'parchment-modal-title';
      title.textContent = this.options.title;
      header.appendChild(title);

      if (this.options.closable) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'parchment-modal-close';
        closeBtn.type = 'button';
        closeBtn.innerHTML = '&times;';
        closeBtn.setAttribute('aria-label', 'Close modal');
        header.appendChild(closeBtn);
      }

      this.modalElement.appendChild(header);
    }

    // Content
    this.contentElement = document.createElement('div');
    this.contentElement.className = 'parchment-modal-content';
    this.setContent(this.options.content);
    this.modalElement.appendChild(this.contentElement);

    // Footer with action buttons
    if (hasFooter) {
      const footer = document.createElement('div');
      footer.className = 'parchment-modal-footer';

      this.options.actions.forEach((action) => {
        const button = new ParchmentButton({
          label: action.label,
          variant: action.variant || 'secondary',
          size: 'md',
          disabled: action.disabled || false,
          onClick: action.onClick
        });
        this.buttons.push(button);
        footer.appendChild(button.element);
      });

      this.modalElement.appendChild(footer);
    }

    this.overlayElement.appendChild(this.modalElement);
    this.element = this.overlayElement;
  }

  /**
   * Set the modal content
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
   * Update the modal title
   * @param {string} title - New title text
   */
  setTitle(title) {
    const titleElement = this.modalElement?.querySelector('.parchment-modal-title');
    if (titleElement) {
      titleElement.textContent = title;
    }
    this.options.title = title;
  }

  /**
   * Bind event handlers
   */
  bindEvents() {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Close button click
    const closeBtn = this.modalElement.querySelector('.parchment-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.close();
      }, { signal });
    }

    // Overlay click (close on backdrop click)
    if (this.options.closeOnOverlay) {
      this.overlayElement.addEventListener('click', (e) => {
        if (e.target === this.overlayElement) {
          this.close();
        }
      }, { signal });
    }

    // ESC key to close
    if (this.options.closeOnEscape) {
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen && isTopModal(this)) {
          e.preventDefault();
          this.close();
        }
      }, { signal });
    }

    // Focus trap
    this.modalElement.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        this.handleTabKey(e);
      }
    }, { signal });
  }

  /**
   * Handle Tab key for focus trapping
   * @param {KeyboardEvent} e
   */
  handleTabKey(e) {
    const focusableElements = this.getFocusableElements();
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey) {
      // Shift+Tab: going backward
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
    } else {
      // Tab: going forward
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    }
  }

  /**
   * Get all focusable elements within the modal
   * @returns {HTMLElement[]}
   */
  getFocusableElements() {
    const selector = [
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])'
    ].join(', ');

    return Array.from(this.modalElement.querySelectorAll(selector));
  }

  /**
   * Lock body scroll
   */
  lockScroll() {
    this.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  /**
   * Unlock body scroll
   */
  unlockScroll() {
    // Only unlock if this is the last modal
    if (openModals.length <= 1) {
      document.body.style.overflow = this.previousOverflow || '';
    }
  }

  /**
   * Open the modal
   */
  open() {
    if (this.isOpen) return;

    // Store the currently focused element to return focus later
    this.previousActiveElement = document.activeElement;

    // Create DOM structure
    this.createElement();
    this.bindEvents();

    // Register modal and lock scroll
    registerModal(this);
    this.lockScroll();

    // Add to DOM
    document.body.appendChild(this.element);

    // Trigger animation
    requestAnimationFrame(() => {
      // The modal may have been closed or destroyed before this frame ran
      // (fast open/close, or throttled rAF in a background tab).
      if (!this.isOpen || this.isClosing || !this.overlayElement || !this.modalElement) return;
      this.overlayElement.classList.add('visible');

      // Focus the first focusable element or the modal itself
      const focusable = this.getFocusableElements();
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        this.modalElement.setAttribute('tabindex', '-1');
        this.modalElement.focus();
      }
    });

    this.isOpen = true;

    // Call onOpen callback
    if (this.options.onOpen) {
      this.options.onOpen();
    }
  }

  /**
   * Close the modal
   */
  close() {
    if (!this.isOpen || this.isClosing) return;
    this.isClosing = true;

    this.overlayElement?.classList.remove('visible');

    // Wait for animation to complete before removing from DOM
    setTimeout(() => {
      this.destroy();
    }, 200);

    // Call onClose callback
    if (this.options.onClose) {
      this.options.onClose();
    }
  }

  /**
   * Clean up resources and remove from DOM
   */
  destroy() {
    this.isOpen = false;
    this.isClosing = false;

    // Unregister modal and unlock scroll
    unregisterModal(this);
    this.unlockScroll();

    // Abort all event listeners
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Destroy button components
    this.buttons.forEach(button => button.destroy());
    this.buttons = [];

    // Remove from DOM
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    // Return focus to the trigger element
    if (this.previousActiveElement && typeof this.previousActiveElement.focus === 'function') {
      this.previousActiveElement.focus();
    }

    this.element = null;
    this.overlayElement = null;
    this.modalElement = null;
    this.contentElement = null;
    this.previousActiveElement = null;
  }

  /**
   * Update action button state
   * @param {number} index - Button index
   * @param {Object} options - Button options to update
   */
  updateAction(index, options) {
    if (this.buttons[index]) {
      this.buttons[index].update(options);
    }
  }

  /**
   * Check if modal is currently open
   * @returns {boolean}
   */
  isVisible() {
    return this.isOpen;
  }
}

export default ParchmentModal;
