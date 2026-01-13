/**
 * ProfileDropdown - Unified profile/menu/notification HUD component
 *
 * A parchment-themed dropdown menu that replaces the old NotificationBell.
 * Displays user avatar, gold, notification badge, and provides quick access
 * to common game screens and settings.
 *
 * Features:
 * - Trigger element with avatar, gold display, and notification badge
 * - Expandable notifications section
 * - Navigation menu items with icons
 * - Contextual items (Party shown only when in party)
 * - WebSocket integration for real-time notification updates
 * - AbortController-based event cleanup
 *
 * Usage:
 *   const profileDropdown = new ProfileDropdown(game);
 *   profileDropdown.show();
 *   profileDropdown.destroy();
 */

import {
  PARCHMENT_COLORS,
  PARCHMENT_TYPOGRAPHY,
  PARCHMENT_SPACING,
  PARCHMENT_RADIUS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from './ParchmentTheme.js';
import { Icon } from '../../components/Icon.js';

const STYLE_ID = 'profile-dropdown-styles';

// Notification type configuration - uses Icon component
const NOTIFICATION_TYPES = {
  friend_request: { category: 'notifications', name: 'friend-request', color: '#4a9eff', label: 'Friend Request' },
  friend_accepted: { category: 'notifications', name: 'friend-accepted', color: '#4ade80', label: 'Friend Accepted' },
  party_invite: { category: 'notifications', name: 'party-invite', color: '#f59e0b', label: 'Party Invite' },
  match_found: { category: 'notifications', name: 'match-found', color: '#ef4444', label: 'Match Found' },
  match_result: { category: 'notifications', name: 'match-result', color: '#a855f7', label: 'Match Result' },
  lfg_application: { category: 'notifications', name: 'lfg-application', color: '#06b6d4', label: 'LFG Application' },
  system: { category: 'notifications', name: 'system', color: '#6b7280', label: 'System' }
};

// Menu item icon mappings
const MENU_ICONS = {
  formation: { category: 'menu', name: 'formation' },
  inventory: { category: 'menu', name: 'inventory' },
  characters: { category: 'menu', name: 'characters' },
  party: { category: 'menu', name: 'party' },
  friends: { category: 'menu', name: 'friends' },
  leaderboard: { category: 'menu', name: 'leaderboard' },
  settings: { category: 'menu', name: 'settings' },
  logout: { category: 'menu', name: 'logout' }
};

// Class icon mappings for avatar fallback
const CLASS_ICONS = {
  // Base classes
  warrior: { category: 'classes', name: 'warrior' },
  wizard: { category: 'classes', name: 'wizard' },
  monk: { category: 'classes', name: 'monk' },
  chemist: { category: 'classes', name: 'chemist' },
  // Advanced classes - Warrior line
  berserker: { category: 'classes', name: 'berserker' },
  paladin: { category: 'classes', name: 'paladin' },
  guardian: { category: 'classes', name: 'guardian' },
  warlord: { category: 'classes', name: 'warlord' },
  // Advanced classes - Wizard line
  sorcerer: { category: 'classes', name: 'sorcerer' },
  summoner: { category: 'classes', name: 'summoner' },
  conjurer: { category: 'classes', name: 'conjurer' },
  oracle: { category: 'classes', name: 'oracle' },
  // Advanced classes - Monk line
  ninja: { category: 'classes', name: 'ninja' },
  martial_artist: { category: 'classes', name: 'martial_artist' },
  brawler: { category: 'classes', name: 'brawler' },
  ascetic: { category: 'classes', name: 'ascetic' },
  // Advanced classes - Chemist line
  alchemist: { category: 'classes', name: 'alchemist' },
  medic: { category: 'classes', name: 'medic' },
  plague_doctor: { category: 'classes', name: 'plague_doctor' },
  artificer: { category: 'classes', name: 'artificer' }
};

export class ProfileDropdown {
  /**
   * @param {Object} game - Game instance
   */
  constructor(game) {
    this.game = game;

    // State
    this.isVisible = false;
    this.isOpen = false;
    this.isNotificationsExpanded = false;
    this.unreadCount = 0;
    this.notifications = [];
    this.gold = 0;

    // DOM elements
    this.triggerElement = null;
    this.dropdownElement = null;
    this.badgeElement = null;
    this.goldElement = null;
    this.avatarElement = null;
    this.notificationListElement = null;

    // Cleanup
    this.abortController = new AbortController();
    this.wsUnsubscribers = []; // WebSocket handler cleanup functions

    this.injectStyles();
    this.create();
    this.setupWebSocketHandlers();
    this.fetchInitialData();
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
      /* Profile Dropdown Container */
      .profile-dropdown {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 9000;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      /* Trigger Button */
      .profile-dropdown__trigger {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 14px 8px 8px;
        background: ${getParchmentGradient('to bottom')};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.lg};
        cursor: pointer;
        box-shadow: ${getParchmentShadow(false)};
        transition: transform 0.15s, box-shadow 0.15s;
        position: relative;
      }

      .profile-dropdown__trigger:hover {
        transform: translateY(-1px);
        box-shadow: ${getParchmentShadow(true)};
      }

      .profile-dropdown__trigger:active {
        transform: translateY(0);
      }

      /* Avatar */
      .profile-dropdown__avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 2px solid ${PARCHMENT_COLORS.border};
        background: ${PARCHMENT_COLORS.dark};
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        flex-shrink: 0;
      }

      .profile-dropdown__avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .profile-dropdown__avatar-fallback {
        font-size: 20px;
        color: ${PARCHMENT_COLORS.text.secondary};
      }

      /* Gold Display - Floating below profile button */
      .profile-dropdown__gold-float {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 6px 12px;
        margin-top: 8px;
        background: rgba(0, 0, 0, 0.6);
        border: 1px solid ${PARCHMENT_COLORS.border};
        border-radius: ${PARCHMENT_RADIUS.md};
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      .profile-dropdown__gold-float .profile-dropdown__gold-icon {
        font-size: 16px;
      }

      .profile-dropdown__gold-float .profile-dropdown__gold-value {
        color: ${PARCHMENT_COLORS.accent.burgundy};
        font-weight: bold;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
        text-shadow:
          -1px -1px 0 #000,
          1px -1px 0 #000,
          -1px 1px 0 #000,
          1px 1px 0 #000,
          0 0 3px rgba(0, 0, 0, 0.8);
      }

      /* Notification Badge */
      .profile-dropdown__badge {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 20px;
        height: 20px;
        background: #ef4444;
        border-radius: 10px;
        color: white;
        font-size: 11px;
        font-weight: bold;
        font-family: Arial, sans-serif;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 0 5px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        border: 2px solid ${PARCHMENT_COLORS.light};
      }

      .profile-dropdown__badge--visible {
        display: flex;
      }

      /* Dropdown Menu */
      .profile-dropdown__menu {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        width: 260px;
        background: ${getParchmentGradient('to bottom')};
        border: ${getParchmentBorder()};
        border-radius: ${PARCHMENT_RADIUS.lg};
        box-shadow: ${getParchmentShadow(true)};
        opacity: 0;
        visibility: hidden;
        transform: translateY(-8px);
        transition: opacity 0.2s, visibility 0.2s, transform 0.2s;
        overflow: hidden;
      }

      .profile-dropdown__menu--open {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }

      /* Notifications Section */
      .profile-dropdown__notifications {
        border-bottom: 1px solid ${PARCHMENT_COLORS.border};
      }

      .profile-dropdown__notifications-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        cursor: pointer;
        transition: background 0.15s;
      }

      .profile-dropdown__notifications-header:hover {
        background: rgba(0, 0, 0, 0.05);
      }

      .profile-dropdown__notifications-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: bold;
        color: ${PARCHMENT_COLORS.text.primary};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .profile-dropdown__notifications-count {
        background: #ef4444;
        color: white;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 8px;
        font-family: Arial, sans-serif;
      }

      .profile-dropdown__notifications-toggle {
        font-size: 12px;
        color: ${PARCHMENT_COLORS.text.muted};
        transition: transform 0.2s;
      }

      .profile-dropdown__notifications-toggle--expanded {
        transform: rotate(180deg);
      }

      .profile-dropdown__notifications-list {
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.3s ease;
      }

      .profile-dropdown__notifications-list--expanded {
        max-height: 200px;
        overflow-y: auto;
      }

      .profile-dropdown__notification-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-top: 1px solid ${PARCHMENT_COLORS.borderLight};
        cursor: pointer;
        transition: background 0.15s;
      }

      .profile-dropdown__notification-item:hover {
        background: rgba(0, 0, 0, 0.05);
      }

      .profile-dropdown__notification-icon {
        font-size: 18px;
        flex-shrink: 0;
      }

      .profile-dropdown__notification-content {
        flex: 1;
        min-width: 0;
      }

      .profile-dropdown__notification-title {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${PARCHMENT_COLORS.text.primary};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .profile-dropdown__notification-time {
        font-size: 10px;
        color: ${PARCHMENT_COLORS.text.muted};
      }

      .profile-dropdown__notification-actions {
        display: flex;
        gap: 6px;
        margin-top: 6px;
      }

      .profile-dropdown__notification-action {
        padding: 4px 10px;
        font-size: 11px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.15s;
        font-family: inherit;
      }

      .profile-dropdown__notification-action--primary {
        background: ${PARCHMENT_COLORS.accent.copper};
        border: 1px solid ${PARCHMENT_COLORS.borderDark};
        color: white;
      }

      .profile-dropdown__notification-action--primary:hover {
        background: #c98343;
      }

      .profile-dropdown__notification-action--secondary {
        background: transparent;
        border: 1px solid ${PARCHMENT_COLORS.border};
        color: ${PARCHMENT_COLORS.text.secondary};
      }

      .profile-dropdown__notification-action--secondary:hover {
        background: rgba(0, 0, 0, 0.05);
      }

      .profile-dropdown__view-all {
        display: block;
        text-align: center;
        padding: 8px;
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        color: ${PARCHMENT_COLORS.accent.copper};
        text-decoration: none;
        cursor: pointer;
        transition: color 0.15s;
        border-top: 1px solid ${PARCHMENT_COLORS.borderLight};
      }

      .profile-dropdown__view-all:hover {
        color: #c98343;
      }

      .profile-dropdown__notifications-empty {
        padding: 12px 14px;
        text-align: center;
        color: ${PARCHMENT_COLORS.text.muted};
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.sm};
        font-style: italic;
      }

      /* Menu Items */
      .profile-dropdown__menu-section {
        padding: 8px 0;
      }

      .profile-dropdown__menu-section--divider {
        border-top: 1px solid ${PARCHMENT_COLORS.border};
      }

      .profile-dropdown__menu-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        cursor: pointer;
        transition: background 0.15s;
        color: ${PARCHMENT_COLORS.text.primary};
        text-decoration: none;
      }

      .profile-dropdown__menu-item:hover {
        background: rgba(0, 0, 0, 0.08);
      }

      .profile-dropdown__menu-item--danger {
        color: ${PARCHMENT_COLORS.state.error};
      }

      .profile-dropdown__menu-icon {
        font-size: 16px;
        text-align: center;
        flex-shrink: 0;
      }

      .profile-dropdown__menu-label {
        font-size: ${PARCHMENT_TYPOGRAPHY.sizes.base};
      }

      /* Shake animation for new notifications */
      @keyframes profileShake {
        0%, 100% { transform: rotate(0); }
        20% { transform: rotate(5deg); }
        40% { transform: rotate(-5deg); }
        60% { transform: rotate(5deg); }
        80% { transform: rotate(-5deg); }
      }

      .profile-dropdown__trigger--shake {
        animation: profileShake 0.5s ease-in-out;
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Create the dropdown DOM structure
   */
  create() {
    // Container
    const container = document.createElement('div');
    container.className = 'profile-dropdown';
    container.style.display = 'none';

    // Trigger button (avatar and badge only)
    this.triggerElement = document.createElement('div');
    this.triggerElement.className = 'profile-dropdown__trigger';
    this.triggerElement.innerHTML = `
      <div class="profile-dropdown__avatar">
        <span class="profile-dropdown__avatar-fallback">👤</span>
      </div>
      <div class="profile-dropdown__badge">0</div>
    `;

    this.avatarElement = this.triggerElement.querySelector('.profile-dropdown__avatar');
    this.badgeElement = this.triggerElement.querySelector('.profile-dropdown__badge');

    // Floating gold display (below trigger)
    this.goldFloatElement = document.createElement('div');
    this.goldFloatElement.className = 'profile-dropdown__gold-float';
    this.goldFloatElement.innerHTML = `
      <span class="profile-dropdown__gold-icon">${Icon.html('resources', 'gold', { size: 'sm' })}</span>
      <span class="profile-dropdown__gold-value">0</span>
    `;
    this.goldElement = this.goldFloatElement.querySelector('.profile-dropdown__gold-value');

    // Dropdown menu
    this.dropdownElement = document.createElement('div');
    this.dropdownElement.className = 'profile-dropdown__menu';

    this.renderDropdownContent();

    container.appendChild(this.triggerElement);
    container.appendChild(this.goldFloatElement);
    container.appendChild(this.dropdownElement);

    this.element = container;
    document.body.appendChild(container);

    this.bindEvents();
  }

  /**
   * Render the dropdown content
   */
  renderDropdownContent() {
    const hasParty = this.game.state?.get('party') || this.game.partyStatusBar?.party;

    this.dropdownElement.innerHTML = `
      <!-- Notifications Section -->
      <div class="profile-dropdown__notifications">
        <div class="profile-dropdown__notifications-header">
          <div class="profile-dropdown__notifications-title">
            Notifications
            ${this.unreadCount > 0 ? `<span class="profile-dropdown__notifications-count">${this.unreadCount > 99 ? '99+' : this.unreadCount}</span>` : ''}
          </div>
          <span class="profile-dropdown__notifications-toggle ${this.isNotificationsExpanded ? 'profile-dropdown__notifications-toggle--expanded' : ''}">▼</span>
        </div>
        <div class="profile-dropdown__notifications-list ${this.isNotificationsExpanded ? 'profile-dropdown__notifications-list--expanded' : ''}">
          ${this.renderNotificationItems()}
        </div>
      </div>

      <!-- Main Menu Items -->
      <div class="profile-dropdown__menu-section">
        <div class="profile-dropdown__menu-item" data-action="formation">
          <span class="profile-dropdown__menu-icon">${Icon.html('menu', 'formation', { size: 'sm' })}</span>
          <span class="profile-dropdown__menu-label">Formation</span>
        </div>
        <div class="profile-dropdown__menu-item" data-action="inventory">
          <span class="profile-dropdown__menu-icon">${Icon.html('menu', 'inventory', { size: 'sm' })}</span>
          <span class="profile-dropdown__menu-label">Inventory</span>
        </div>
        <div class="profile-dropdown__menu-item" data-action="characters">
          <span class="profile-dropdown__menu-icon">${Icon.html('menu', 'characters', { size: 'sm' })}</span>
          <span class="profile-dropdown__menu-label">Characters</span>
        </div>
        ${hasParty ? `
        <div class="profile-dropdown__menu-item" data-action="party">
          <span class="profile-dropdown__menu-icon">${Icon.html('menu', 'party', { size: 'sm' })}</span>
          <span class="profile-dropdown__menu-label">Party</span>
        </div>
        ` : ''}
        <div class="profile-dropdown__menu-item" data-action="friends">
          <span class="profile-dropdown__menu-icon">${Icon.html('menu', 'friends', { size: 'sm' })}</span>
          <span class="profile-dropdown__menu-label">Friends</span>
        </div>
        <div class="profile-dropdown__menu-item" data-action="leaderboard">
          <span class="profile-dropdown__menu-icon">${Icon.html('menu', 'leaderboard', { size: 'sm' })}</span>
          <span class="profile-dropdown__menu-label">Leaderboards</span>
        </div>
      </div>

      <!-- Settings and Logout -->
      <div class="profile-dropdown__menu-section profile-dropdown__menu-section--divider">
        <div class="profile-dropdown__menu-item" data-action="settings">
          <span class="profile-dropdown__menu-icon">${Icon.html('menu', 'settings', { size: 'sm' })}</span>
          <span class="profile-dropdown__menu-label">Settings</span>
        </div>
        <div class="profile-dropdown__menu-item profile-dropdown__menu-item--danger" data-action="logout">
          <span class="profile-dropdown__menu-icon">${Icon.html('menu', 'logout', { size: 'sm' })}</span>
          <span class="profile-dropdown__menu-label">Logout</span>
        </div>
      </div>
    `;

    this.notificationListElement = this.dropdownElement.querySelector('.profile-dropdown__notifications-list');
  }

  /**
   * Render notification items HTML
   */
  renderNotificationItems() {
    if (this.notifications.length === 0) {
      return '<div class="profile-dropdown__notifications-empty">No new notifications</div>';
    }

    // Show only first 3 notifications
    const displayNotifications = this.notifications.slice(0, 3);

    let html = displayNotifications.map(notification => {
      const typeConfig = NOTIFICATION_TYPES[notification.type] || NOTIFICATION_TYPES.system;
      const timeAgo = this.getTimeAgo(new Date(notification.created_at));
      const actions = this.getNotificationActions(notification);
      const notificationIcon = Icon.html(typeConfig.category, typeConfig.name, { size: 'sm' });

      return `
        <div class="profile-dropdown__notification-item" data-notification-id="${notification.id}">
          <span class="profile-dropdown__notification-icon">${notificationIcon}</span>
          <div class="profile-dropdown__notification-content">
            <div class="profile-dropdown__notification-title">${this.escapeHtml(notification.title)}</div>
            <div class="profile-dropdown__notification-time">${timeAgo}</div>
            ${actions}
          </div>
        </div>
      `;
    }).join('');

    // Add "View All" link
    html += `<a class="profile-dropdown__view-all" data-action="view-all-notifications">View All Notifications</a>`;

    return html;
  }

  /**
   * Get action buttons HTML for a notification
   */
  getNotificationActions(notification) {
    let actions = [];

    switch (notification.type) {
      case 'friend_request':
        actions = [
          { action: 'accept', label: 'Accept', primary: true },
          { action: 'decline', label: 'Decline', primary: false }
        ];
        break;
      case 'party_invite':
        actions = [
          { action: 'accept', label: 'Join', primary: true },
          { action: 'decline', label: 'Decline', primary: false }
        ];
        break;
      case 'lfg_application':
        actions = [
          { action: 'accept', label: 'Invite', primary: true },
          { action: 'decline', label: 'Ignore', primary: false }
        ];
        break;
      default:
        return '';
    }

    if (actions.length === 0) return '';

    return `
      <div class="profile-dropdown__notification-actions">
        ${actions.map(a => `
          <button class="profile-dropdown__notification-action profile-dropdown__notification-action--${a.primary ? 'primary' : 'secondary'}"
                  data-notification-action="${a.action}"
                  data-notification-id="${notification.id}">
            ${a.label}
          </button>
        `).join('')}
      </div>
    `;
  }

  /**
   * Bind event handlers
   */
  bindEvents() {
    const signal = this.abortController.signal;

    // Toggle dropdown on trigger click
    this.triggerElement.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown();
    }, { signal });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (this.isOpen && !this.element.contains(e.target)) {
        this.closeDropdown();
      }
    }, { signal });

    // Close dropdown on ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.closeDropdown();
        e.stopPropagation();
      }
    }, { signal });

    // Delegate click events for dropdown items
    this.dropdownElement.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action], [data-notification-action], [data-notification-id]');
      if (!target) return;

      e.stopPropagation();

      // Handle notification actions
      if (target.dataset.notificationAction) {
        const notificationId = parseInt(target.dataset.notificationId);
        const action = target.dataset.notificationAction;
        this.handleNotificationAction(notificationId, action);
        return;
      }

      // Handle menu actions
      const action = target.dataset.action;
      if (action) {
        this.handleMenuAction(action);
      }
    }, { signal });

    // Handle notifications header click for expand/collapse
    this.dropdownElement.addEventListener('click', (e) => {
      const header = e.target.closest('.profile-dropdown__notifications-header');
      if (header) {
        this.toggleNotifications();
      }
    }, { signal });
  }

  /**
   * Setup WebSocket event handlers
   */
  setupWebSocketHandlers() {
    if (!this.game.socket) return;

    // New notification received
    const unsub1 = this.game.socket.on('notification:new', (notification) => {
      this.unreadCount++;
      this.notifications.unshift(notification);
      this.updateBadge();
      this.animateTrigger();

      if (this.isOpen && this.isNotificationsExpanded) {
        this.renderDropdownContent();
        this.bindDropdownItemEvents();
      }
    });
    this.wsUnsubscribers.push(unsub1);

    // Notification cancelled/expired
    const unsub2 = this.game.socket.on('notification:cancelled', (data) => {
      this.unreadCount = Math.max(0, this.unreadCount - 1);
      this.notifications = this.notifications.filter(n => n.id !== data.id);
      this.updateBadge();

      if (this.isOpen) {
        this.renderDropdownContent();
        this.bindDropdownItemEvents();
      }
    });
    this.wsUnsubscribers.push(unsub2);

    // Gold update
    const unsub3 = this.game.socket.on('gold:update', (data) => {
      this.setGold(data.gold);
    });
    this.wsUnsubscribers.push(unsub3);

    // Party update
    const unsub4 = this.game.socket.on('party:update', () => {
      if (this.isOpen) {
        this.renderDropdownContent();
        this.bindDropdownItemEvents();
      }
    });
    this.wsUnsubscribers.push(unsub4);
  }

  /**
   * Re-bind events for dynamically rendered dropdown items
   */
  bindDropdownItemEvents() {
    // Events are delegated, so no need to rebind
  }

  /**
   * Fetch initial data
   */
  async fetchInitialData() {
    await Promise.all([
      this.fetchUnreadCount(),
      this.fetchNotifications(),
      this.fetchGold()
    ]);
  }

  /**
   * Fetch unread notification count
   */
  async fetchUnreadCount() {
    try {
      const response = await this.game.api.get('/notifications/unread-count');
      if (response.success) {
        this.unreadCount = response.count;
        this.updateBadge();
      }
    } catch (error) {
      console.error('Failed to fetch notification count:', error);
    }
  }

  /**
   * Fetch recent notifications
   */
  async fetchNotifications() {
    try {
      const response = await this.game.api.get('/notifications');
      if (response.success) {
        this.notifications = response.notifications || [];
        if (this.isOpen) {
          this.renderDropdownContent();
        }
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    }
  }

  /**
   * Fetch current gold amount
   */
  async fetchGold() {
    try {
      // Get gold from user state (authoritative source)
      const user = this.game.state?.get('user');
      if (user?.gold !== undefined) {
        this.setGold(user.gold);
        return;
      }

      // Fallback to auth/me API if not in state
      const response = await this.game.api.get('/auth/me');
      if (response.user) {
        this.setGold(response.user.gold || 0);
      }
    } catch (error) {
      // Silently fail - gold display is non-critical
    }
  }

  /**
   * Update avatar display
   */
  updateAvatar() {
    const characters = this.game.state?.get('characters') || [];
    const leader = characters.find(c => c.isLeader) || characters[0];

    if (leader?.portrait) {
      this.avatarElement.innerHTML = `<img src="${leader.portrait}" alt="Avatar">`;
    } else if (leader?.class) {
      // Use class icon fallback from Icon component
      const classKey = leader.class.toLowerCase();
      const classConfig = CLASS_ICONS[classKey];
      if (classConfig) {
        this.avatarElement.innerHTML = `<span class="profile-dropdown__avatar-fallback">${Icon.html(classConfig.category, classConfig.name, { size: 'md' })}</span>`;
      } else {
        this.avatarElement.innerHTML = `<span class="profile-dropdown__avatar-fallback">${Icon.html('menu', 'characters', { size: 'md' })}</span>`;
      }
    } else {
      this.avatarElement.innerHTML = `<span class="profile-dropdown__avatar-fallback">${Icon.html('menu', 'characters', { size: 'md' })}</span>`;
    }
  }

  /**
   * Set gold display
   */
  setGold(amount) {
    this.gold = amount;
    if (this.goldElement) {
      this.goldElement.textContent = this.formatGold(amount);
    }
  }

  /**
   * Format gold number with commas
   */
  formatGold(amount) {
    if (amount >= 1000000) {
      return (amount / 1000000).toFixed(1) + 'M';
    }
    if (amount >= 10000) {
      return (amount / 1000).toFixed(1) + 'k';
    }
    return amount.toLocaleString();
  }

  /**
   * Update notification badge
   */
  updateBadge() {
    if (this.unreadCount > 0) {
      this.badgeElement.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
      this.badgeElement.classList.add('profile-dropdown__badge--visible');
    } else {
      this.badgeElement.classList.remove('profile-dropdown__badge--visible');
    }

    // Also update the notifications count in dropdown if open
    const countElement = this.dropdownElement.querySelector('.profile-dropdown__notifications-count');
    if (countElement) {
      if (this.unreadCount > 0) {
        countElement.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
        countElement.style.display = '';
      } else {
        countElement.style.display = 'none';
      }
    }
  }

  /**
   * Animate trigger on new notification
   */
  animateTrigger() {
    this.triggerElement.classList.remove('profile-dropdown__trigger--shake');
    void this.triggerElement.offsetWidth; // Force reflow
    this.triggerElement.classList.add('profile-dropdown__trigger--shake');
  }

  /**
   * Toggle dropdown visibility
   */
  toggleDropdown() {
    if (this.isOpen) {
      this.closeDropdown();
    } else {
      this.openDropdown();
    }
  }

  /**
   * Open dropdown
   */
  openDropdown() {
    this.isOpen = true;
    this.dropdownElement.classList.add('profile-dropdown__menu--open');
    this.renderDropdownContent();
  }

  /**
   * Close dropdown
   */
  closeDropdown() {
    this.isOpen = false;
    this.dropdownElement.classList.remove('profile-dropdown__menu--open');
  }

  /**
   * Toggle notifications expansion
   */
  toggleNotifications() {
    this.isNotificationsExpanded = !this.isNotificationsExpanded;

    const toggle = this.dropdownElement.querySelector('.profile-dropdown__notifications-toggle');
    const list = this.dropdownElement.querySelector('.profile-dropdown__notifications-list');

    if (toggle) {
      toggle.classList.toggle('profile-dropdown__notifications-toggle--expanded', this.isNotificationsExpanded);
    }

    if (list) {
      list.classList.toggle('profile-dropdown__notifications-list--expanded', this.isNotificationsExpanded);
    }
  }

  /**
   * Handle menu item action
   */
  handleMenuAction(action) {
    this.closeDropdown();

    switch (action) {
      case 'formation':
        this.game.scenes.switchTo('formation');
        break;
      case 'inventory':
        this.game.scenes.switchTo('inventory');
        break;
      case 'characters':
        this.game.scenes.switchTo('characterSelect');
        break;
      case 'party':
        // Could open party panel or navigate to party scene
        if (this.game.partyStatusBar) {
          this.game.partyStatusBar.togglePanel();
        }
        break;
      case 'friends':
        // Navigate to Social Hub - unified social features
        this.game.scenes.switchTo('socialHub');
        break;
      case 'leaderboard':
        this.game.scenes.switchTo('leaderboard');
        break;
      case 'settings':
        this.game.scenes.switchTo('settings');
        break;
      case 'logout':
        this.handleLogout();
        break;
      case 'view-all-notifications':
        if (this.game.notificationCenter) {
          this.game.notificationCenter.open();
        }
        break;
    }
  }

  /**
   * Handle notification action button click
   */
  async handleNotificationAction(notificationId, action) {
    const notification = this.notifications.find(n => n.id === notificationId);
    if (!notification) return;

    try {
      switch (notification.type) {
        case 'friend_request':
          if (action === 'accept') {
            await this.game.api.post(`/friends/accept/${notification.payload.requestId}`);
            this.game.toastManager?.success('Friend Added', 'You are now friends!');
          } else {
            await this.game.api.post(`/friends/decline/${notification.payload.requestId}`);
          }
          break;

        case 'party_invite':
          if (action === 'accept') {
            await this.game.api.acceptPartyInvite(notification.payload.inviteId);
            this.game.toastManager?.success('Joined Party', 'You have joined the party!');
            this.game.partyStatusBar?.refresh();
          } else {
            await this.game.api.declinePartyInvite(notification.payload.inviteId);
          }
          break;

        case 'lfg_application':
          if (action === 'accept') {
            await this.game.api.inviteToParty(
              notification.payload.partyId,
              notification.payload.applicantUsername
            );
            this.game.toastManager?.success('Invite Sent', 'Party invite sent!');
          }
          break;
      }

      // Dismiss notification after action
      await this.dismissNotification(notificationId);

    } catch (error) {
      console.error('Notification action failed:', error);
      this.game.toastManager?.error('Action Failed', error.message || 'Something went wrong');
    }
  }

  /**
   * Dismiss a notification
   */
  async dismissNotification(notificationId) {
    try {
      await this.game.api.delete(`/notifications/${notificationId}`);
      this.notifications = this.notifications.filter(n => n.id !== notificationId);
      this.unreadCount = Math.max(0, this.unreadCount - 1);
      this.updateBadge();
      this.renderDropdownContent();
    } catch (error) {
      console.error('Failed to dismiss notification:', error);
    }
  }

  /**
   * Handle logout action
   */
  async handleLogout() {
    try {
      const refreshToken = this.game.state.get('refreshToken');
      if (refreshToken) {
        await this.game.api.logout(refreshToken);
      }
    } catch (error) {
      console.error('Logout error:', error);
    }

    // Clear state regardless of API success
    this.game.state.set('token', null);
    this.game.state.set('refreshToken', null);
    this.game.state.set('user', null);
    this.game.state.persist();

    // Disconnect WebSocket
    this.game.socket?.disconnect();

    // Destroy notification system
    this.game.destroyNotificationSystem();

    // Navigate to login
    this.game.scenes.switchTo('login');
  }

  /**
   * Get relative time string
   */
  getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString();
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Show the profile dropdown
   */
  show() {
    this.isVisible = true;
    this.element.style.display = '';
    this.updateAvatar();
    this.fetchInitialData();
  }

  /**
   * Hide the profile dropdown
   */
  hide() {
    this.isVisible = false;
    this.closeDropdown();
    this.element.style.display = 'none';
  }

  /**
   * Refresh data
   */
  refresh() {
    this.fetchInitialData();
    this.updateAvatar();
    this.renderDropdownContent();
  }

  /**
   * Update unread count externally
   */
  setUnreadCount(count) {
    this.unreadCount = count;
    this.updateBadge();
  }

  /**
   * Decrement unread count
   */
  decrementCount() {
    this.unreadCount = Math.max(0, this.unreadCount - 1);
    this.updateBadge();
  }

  /**
   * Clean up and destroy
   */
  destroy() {
    // Abort all event listeners
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Clean up WebSocket handlers
    for (const unsub of this.wsUnsubscribers) {
      if (typeof unsub === 'function') unsub();
    }
    this.wsUnsubscribers = [];

    // Remove from DOM
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    this.element = null;
    this.triggerElement = null;
    this.dropdownElement = null;
    this.badgeElement = null;
    this.goldElement = null;
    this.avatarElement = null;
    this.notificationListElement = null;
  }
}

export default ProfileDropdown;
