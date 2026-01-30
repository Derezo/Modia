/**
 * BattleMenuDropdown - Compact menu for accessing battle modals
 *
 * Replaces inline turn order panel with a dropdown menu trigger that provides
 * quick access to Turn Order and Battle Log modals.
 *
 * Features:
 * - Hamburger menu icon with "Next: [Unit Name]" preview
 * - Dropdown with Turn Order and Battle Log options
 * - Badge showing unread battle log entries
 * - Parchment theme styling
 * - 44px minimum touch targets for mobile
 * - Click outside to close
 *
 * Usage:
 *   const menu = new BattleMenuDropdown({
 *     onOpenTurnOrder: () => turnOrderModal.open(),
 *     onOpenBattleLog: () => battleLogModal.open()
 *   });
 *   document.body.appendChild(menu.element);
 *   menu.show();
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_RADIUS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from '../ui/parchment/ParchmentTheme.js';

const P = PARCHMENT_COLORS;
const T = PARCHMENT_TYPOGRAPHY;

const STYLE_ID = 'battle-menu-dropdown-styles';

export default class BattleMenuDropdown {
  /**
   * @param {Object} options
   * @param {Function} options.onOpenTurnOrder - Callback when Turn Order is clicked
   * @param {Function} options.onOpenBattleLog - Callback when Battle Log is clicked
   */
  constructor(options = {}) {
    this.onOpenTurnOrder = options.onOpenTurnOrder || null;
    this.onOpenBattleLog = options.onOpenBattleLog || null;

    // State
    this.isVisible = false;
    this.isOpen = false;
    this.nextUnitName = '';
    this.unreadCount = 0;

    // DOM elements
    this.element = null;
    this.triggerElement = null;
    this.dropdownElement = null;
    this.nextUnitElement = null;
    this.badgeElement = null;

    // Cleanup
    this.abortController = null;

    this.injectStyles();
    this.create();
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
      /* Battle Menu Dropdown Container */
      .battle-menu-dropdown {
        position: fixed;
        top: 16px;
        left: 16px;
        z-index: 8000;
        font-family: ${T.fontFamily};
        display: none;
      }

      .battle-menu-dropdown--visible {
        display: block;
      }

      /* Trigger Button */
      .battle-menu-dropdown__trigger {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        min-height: 44px;
        background: ${getParchmentGradient('to bottom')};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.md};
        box-shadow: ${getParchmentShadow()};
        cursor: pointer;
        transition: all 0.15s ease;
        user-select: none;
      }

      .battle-menu-dropdown__trigger:hover {
        box-shadow: ${getParchmentShadow(true)};
        transform: translateY(-1px);
      }

      .battle-menu-dropdown__trigger:active {
        transform: translateY(0);
        box-shadow: ${getParchmentShadow()};
      }

      .battle-menu-dropdown__trigger:focus {
        outline: none;
        box-shadow: ${getParchmentShadow()}, 0 0 0 2px ${P.border};
      }

      .battle-menu-dropdown__trigger--open {
        border-color: ${P.borderDark};
      }

      /* Hamburger Icon */
      .battle-menu-dropdown__icon {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        width: 20px;
        height: 20px;
        gap: 3px;
      }

      .battle-menu-dropdown__icon-bar {
        width: 16px;
        height: 2px;
        background: ${P.text.primary};
        border-radius: 1px;
        transition: background 0.15s ease;
      }

      .battle-menu-dropdown__trigger:hover .battle-menu-dropdown__icon-bar {
        background: ${P.borderDark};
      }

      /* Menu Label */
      .battle-menu-dropdown__label {
        font-size: ${T.sizes.sm};
        font-weight: ${T.weights.bold};
        color: ${P.text.primary};
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      /* Next Unit Preview */
      .battle-menu-dropdown__next {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: ${T.sizes.sm};
        color: ${P.text.secondary};
        max-width: 120px;
        overflow: hidden;
      }

      .battle-menu-dropdown__next-label {
        color: ${P.text.muted};
        flex-shrink: 0;
      }

      .battle-menu-dropdown__next-name {
        color: ${P.accent.burgundy};
        font-weight: ${T.weights.bold};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Dropdown Menu */
      .battle-menu-dropdown__menu {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        min-width: 180px;
        background: ${getParchmentGradient('to bottom')};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.md};
        box-shadow: ${getParchmentShadow(true)};
        opacity: 0;
        visibility: hidden;
        transform: translateY(-8px);
        transition: opacity 0.2s ease, visibility 0.2s ease, transform 0.2s ease;
        overflow: hidden;
      }

      .battle-menu-dropdown__menu--open {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      /* Menu Items */
      .battle-menu-dropdown__item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        min-height: 44px;
        cursor: pointer;
        transition: background 0.15s ease, outline 0.15s ease;
        color: ${P.text.primary};
        box-sizing: border-box;
        outline: none;
      }

      .battle-menu-dropdown__item:hover,
      .battle-menu-dropdown__item:focus {
        background: rgba(139, 115, 85, 0.15);
      }

      .battle-menu-dropdown__item:focus {
        outline: 2px solid ${P.border};
        outline-offset: -2px;
      }

      .battle-menu-dropdown__item:active {
        background: rgba(139, 115, 85, 0.25);
      }

      .battle-menu-dropdown__item:not(:last-child) {
        border-bottom: 1px solid rgba(139, 115, 85, 0.2);
      }

      .battle-menu-dropdown__item-content {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .battle-menu-dropdown__item-icon {
        font-size: 16px;
        flex-shrink: 0;
        width: 20px;
        text-align: center;
      }

      .battle-menu-dropdown__item-label {
        font-size: ${T.sizes.base};
        font-weight: ${T.weights.normal};
      }

      /* Unread Badge */
      .battle-menu-dropdown__badge {
        display: none;
        align-items: center;
        justify-content: center;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        background: ${P.state.error};
        border-radius: 10px;
        color: white;
        font-size: 11px;
        font-weight: bold;
        font-family: Arial, sans-serif;
      }

      .battle-menu-dropdown__badge--visible {
        display: flex;
      }

      /* Trigger Badge (shows on collapsed state) */
      .battle-menu-dropdown__trigger-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        display: none;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        background: ${P.state.error};
        border-radius: 9px;
        color: white;
        font-size: 10px;
        font-weight: bold;
        font-family: Arial, sans-serif;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }

      .battle-menu-dropdown__trigger-badge--visible {
        display: flex;
      }

      /* Pulse animation for new entries */
      @keyframes battleMenuBadgePulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.15); }
      }

      .battle-menu-dropdown__badge--pulse,
      .battle-menu-dropdown__trigger-badge--pulse {
        animation: battleMenuBadgePulse 0.4s ease-in-out;
      }

      /* Mobile responsiveness */
      @media (max-width: 480px) {
        .battle-menu-dropdown {
          top: 8px;
          left: 8px;
        }

        .battle-menu-dropdown__trigger {
          padding: 8px 10px;
        }

        .battle-menu-dropdown__label {
          display: none;
        }

        .battle-menu-dropdown__next {
          max-width: 100px;
        }

        .battle-menu-dropdown__menu {
          min-width: 160px;
          max-width: calc(100vw - 24px);
        }
      }

      /* Prevent dropdown from overflowing screen on small screens */
      @media (max-width: 320px) {
        .battle-menu-dropdown__next {
          display: none;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Create the dropdown DOM structure
   */
  create() {
    // Container
    this.element = document.createElement('div');
    this.element.className = 'battle-menu-dropdown';

    // Trigger button
    this.triggerElement = document.createElement('div');
    this.triggerElement.className = 'battle-menu-dropdown__trigger';
    this.triggerElement.setAttribute('role', 'button');
    this.triggerElement.setAttribute('tabindex', '0');
    this.triggerElement.setAttribute('aria-haspopup', 'menu');
    this.triggerElement.setAttribute('aria-expanded', 'false');
    this.triggerElement.setAttribute('aria-label', 'Battle menu');
    this.triggerElement.innerHTML = `
      <div class="battle-menu-dropdown__icon">
        <div class="battle-menu-dropdown__icon-bar"></div>
        <div class="battle-menu-dropdown__icon-bar"></div>
        <div class="battle-menu-dropdown__icon-bar"></div>
      </div>
      <span class="battle-menu-dropdown__label">Menu</span>
      <div class="battle-menu-dropdown__next">
        <span class="battle-menu-dropdown__next-label">Next:</span>
        <span class="battle-menu-dropdown__next-name">--</span>
      </div>
      <div class="battle-menu-dropdown__trigger-badge">0</div>
    `;

    this.nextUnitElement = this.triggerElement.querySelector('.battle-menu-dropdown__next-name');
    this.triggerBadgeElement = this.triggerElement.querySelector('.battle-menu-dropdown__trigger-badge');

    // Dropdown menu
    this.dropdownElement = document.createElement('div');
    this.dropdownElement.className = 'battle-menu-dropdown__menu';
    this.dropdownElement.setAttribute('role', 'menu');
    this.dropdownElement.innerHTML = `
      <div class="battle-menu-dropdown__item" data-action="turn-order" tabindex="0" role="menuitem">
        <div class="battle-menu-dropdown__item-content">
          <span class="battle-menu-dropdown__item-icon" aria-hidden="true">&#128203;</span>
          <span class="battle-menu-dropdown__item-label">Turn Order</span>
        </div>
      </div>
      <div class="battle-menu-dropdown__item" data-action="battle-log" tabindex="0" role="menuitem">
        <div class="battle-menu-dropdown__item-content">
          <span class="battle-menu-dropdown__item-icon" aria-hidden="true">&#128220;</span>
          <span class="battle-menu-dropdown__item-label">Battle Log</span>
        </div>
        <div class="battle-menu-dropdown__badge" aria-label="unread entries">0</div>
      </div>
    `;

    this.badgeElement = this.dropdownElement.querySelector('.battle-menu-dropdown__badge');

    this.element.appendChild(this.triggerElement);
    this.element.appendChild(this.dropdownElement);

    document.body.appendChild(this.element);

    this.bindEvents();
  }

  /**
   * Bind event handlers
   */
  bindEvents() {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Toggle dropdown on trigger click
    this.triggerElement.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown();
    }, { signal });

    // Toggle dropdown on trigger keydown (Enter/Space)
    this.triggerElement.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        this.toggleDropdown();
      }
    }, { signal });

    // Handle menu item clicks
    this.dropdownElement.addEventListener('click', (e) => {
      const item = e.target.closest('.battle-menu-dropdown__item');
      if (!item) return;

      e.stopPropagation();
      const action = item.dataset.action;

      if (action === 'turn-order') {
        this.closeDropdown();
        if (this.onOpenTurnOrder) {
          this.onOpenTurnOrder();
        }
      } else if (action === 'battle-log') {
        this.closeDropdown();
        if (this.onOpenBattleLog) {
          this.onOpenBattleLog();
        }
      }
    }, { signal });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (this.isOpen && !this.element.contains(e.target)) {
        this.closeDropdown();
      }
    }, { signal });

    // Close dropdown on Escape key (don't stop propagation so modals can also close)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.closeDropdown();
        // Don't stopPropagation - let modals handle their own Escape
      }
    }, { signal });

    // Keyboard navigation within dropdown
    this.dropdownElement.addEventListener('keydown', (e) => {
      const items = Array.from(this.dropdownElement.querySelectorAll('.battle-menu-dropdown__item'));
      const currentIndex = items.indexOf(document.activeElement);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
        items[nextIndex]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
        items[prevIndex]?.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        document.activeElement?.click();
      }
    }, { signal });
  }

  /**
   * Toggle dropdown open/closed
   */
  toggleDropdown() {
    if (this.isOpen) {
      this.closeDropdown();
    } else {
      this.openDropdown();
    }
  }

  /**
   * Open the dropdown menu
   */
  openDropdown() {
    this.isOpen = true;
    this.triggerElement.classList.add('battle-menu-dropdown__trigger--open');
    this.triggerElement.setAttribute('aria-expanded', 'true');
    this.dropdownElement.classList.add('battle-menu-dropdown__menu--open');

    // Focus first menu item after animation starts
    requestAnimationFrame(() => {
      const firstItem = this.dropdownElement.querySelector('.battle-menu-dropdown__item');
      if (firstItem) {
        firstItem.focus();
      }
    });
  }

  /**
   * Close the dropdown menu
   */
  closeDropdown() {
    this.isOpen = false;
    this.triggerElement.classList.remove('battle-menu-dropdown__trigger--open');
    this.triggerElement.setAttribute('aria-expanded', 'false');
    this.dropdownElement.classList.remove('battle-menu-dropdown__menu--open');
  }

  /**
   * Update the "Next: [Unit Name]" preview text
   * @param {Object|null} unit - Unit object with name property, or null to clear
   */
  setNextUnit(unit) {
    if (!this.nextUnitElement) return;

    if (unit && unit.name) {
      this.nextUnitName = unit.name;
      this.nextUnitElement.textContent = unit.name;
    } else {
      this.nextUnitName = '';
      this.nextUnitElement.textContent = '--';
    }
  }

  /**
   * Increment the unread badge count
   * Called when a new battle log entry is added
   */
  incrementBadge() {
    this.unreadCount++;
    this.updateBadgeDisplay();
    this.pulseBadge();
  }

  /**
   * Reset the badge count to zero
   * Called when the battle log modal is opened
   */
  resetBadge() {
    this.unreadCount = 0;
    this.updateBadgeDisplay();
  }

  /**
   * Set badge count directly
   * @param {number} count - New badge count
   */
  setBadgeCount(count) {
    this.unreadCount = Math.max(0, count);
    this.updateBadgeDisplay();
  }

  /**
   * Update badge display elements
   */
  updateBadgeDisplay() {
    const displayCount = this.unreadCount > 99 ? '99+' : String(this.unreadCount);

    // Update dropdown menu badge
    if (this.badgeElement) {
      this.badgeElement.textContent = displayCount;
      this.badgeElement.classList.toggle(
        'battle-menu-dropdown__badge--visible',
        this.unreadCount > 0
      );
    }

    // Update trigger badge
    if (this.triggerBadgeElement) {
      this.triggerBadgeElement.textContent = displayCount;
      this.triggerBadgeElement.classList.toggle(
        'battle-menu-dropdown__trigger-badge--visible',
        this.unreadCount > 0
      );
    }
  }

  /**
   * Trigger pulse animation on badge
   */
  pulseBadge() {
    if (this.badgeElement) {
      this.badgeElement.classList.remove('battle-menu-dropdown__badge--pulse');
      void this.badgeElement.offsetWidth; // Force reflow
      this.badgeElement.classList.add('battle-menu-dropdown__badge--pulse');
    }

    if (this.triggerBadgeElement) {
      this.triggerBadgeElement.classList.remove('battle-menu-dropdown__trigger-badge--pulse');
      void this.triggerBadgeElement.offsetWidth; // Force reflow
      this.triggerBadgeElement.classList.add('battle-menu-dropdown__trigger-badge--pulse');
    }
  }

  /**
   * Show the menu dropdown
   */
  show() {
    this.isVisible = true;
    this.element.classList.add('battle-menu-dropdown--visible');
  }

  /**
   * Hide the menu dropdown
   */
  hide() {
    this.isVisible = false;
    this.closeDropdown();
    this.element.classList.remove('battle-menu-dropdown--visible');
  }

  /**
   * Get current unread count
   * @returns {number}
   */
  getUnreadCount() {
    return this.unreadCount;
  }

  /**
   * Check if dropdown is currently open
   * @returns {boolean}
   */
  isDropdownOpen() {
    return this.isOpen;
  }

  /**
   * Clean up and destroy the component
   */
  destroy() {
    // Abort all event listeners
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Remove element from DOM
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    // Clear references
    this.element = null;
    this.triggerElement = null;
    this.dropdownElement = null;
    this.nextUnitElement = null;
    this.badgeElement = null;
    this.triggerBadgeElement = null;
    this.onOpenTurnOrder = null;
    this.onOpenBattleLog = null;
  }
}

export { BattleMenuDropdown };
