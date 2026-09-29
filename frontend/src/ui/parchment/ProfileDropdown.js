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
  PARCHMENT_RADIUS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentShadow
} from './ParchmentTheme.js';
import { Icon } from '../../components/Icon.js';
import { getAssetPath, getOptimalSize } from '@shared/assetPaths.js';
import { escapeHtml } from '../../utils/escapeHtml.js';
import { parchmentToast } from './ParchmentToast.js';

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
        /* Anchored to the visible game canvas (Game.publishCanvasAnchor), not
           the viewport, so it never floats in a letterbox gutter. */
        top: calc(var(--game-canvas-top, 0px) + 16px);
        right: calc(var(--game-canvas-right, 0px) + 16px);
        z-index: 9000;
        font-family: ${PARCHMENT_TYPOGRAPHY.fontFamily};
      }

      /* Trigger Button - Minimal transparent container */
      .profile-dropdown__trigger {
        display: flex;
        align-items: center;
        gap: 0;
        padding: 0;
        background: transparent;
        border: none;
        cursor: pointer;
        box-shadow: none;
        position: relative;
      }

      .profile-dropdown__trigger:hover,
      .profile-dropdown__trigger:active {
        transform: none;
        box-shadow: none;
      }

      .profile-dropdown__trigger:focus-visible .profile-dropdown__avatar {
        outline: 2px solid #4a9eff;
        outline-offset: 2px;
      }

      /* Avatar - 48px copper ring */
      .profile-dropdown__avatar {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 2.5px solid #b87333;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        flex-shrink: 0;
        box-shadow:
          0 2px 8px rgba(0, 0, 0, 0.4),
          0 1px 3px rgba(0, 0, 0, 0.3),
          inset 0 0 0 1px rgba(0, 0, 0, 0.1);
        transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
      }

      .profile-dropdown__avatar:hover {
        transform: scale(1.05);
        box-shadow:
          0 2px 12px rgba(184, 115, 51, 0.5),
          0 4px 16px rgba(0, 0, 0, 0.4);
        border-color: #c98343;
      }

      .profile-dropdown__avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .profile-dropdown__avatar-fallback {
        font-size: 24px;
        color: #5a4a3a;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
      }

      /* Gold Display - Inline floating text */
      .profile-dropdown__gold-inline {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-left: 10px;
        padding: 0;
        background: transparent;
        border: none;
      }

      .profile-dropdown__gold-inline .profile-dropdown__gold-icon {
        font-size: 18px;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
      }

      .profile-dropdown__gold-inline .profile-dropdown__gold-value {
        color: #c9a227;
        font-weight: bold;
        font-size: 15px;
        text-shadow:
          -1px -1px 0 #1a1a1a,
          1px -1px 0 #1a1a1a,
          -1px 1px 0 #1a1a1a,
          1px 1px 0 #1a1a1a,
          0 0 4px rgba(0, 0, 0, 0.8),
          0 2px 4px rgba(0, 0, 0, 0.6);
      }

      /* Notification Badge - Repositioned for portrait */
      .profile-dropdown__badge {
        position: absolute;
        top: -2px;
        left: 34px;
        min-width: 18px;
        height: 18px;
        background: #ef4444;
        border-radius: 9px;
        color: white;
        font-size: var(--font-size-sm, 12px);
        font-weight: bold;
        font-family: Arial, sans-serif;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 0 5px;
        box-shadow:
          0 2px 4px rgba(0, 0, 0, 0.4),
          0 0 0 2px rgba(255, 255, 255, 0.9);
        z-index: 1;
      }

      .profile-dropdown__badge--visible {
        display: flex;
      }

      /* Dropdown Menu */
      .profile-dropdown__menu {
        position: absolute;
        top: calc(100% + 8px);
        right: -8px;
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
        font-size: var(--font-size-sm, 12px);
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
        min-height: var(--touch-target, 36px);
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
        font-size: var(--font-size-sm, 12px);
        color: ${PARCHMENT_COLORS.text.muted};
      }

      .profile-dropdown__notification-actions {
        display: flex;
        gap: 6px;
        margin-top: 6px;
      }

      .profile-dropdown__notification-action {
        padding: 4px 10px;
        font-size: var(--font-size-sm, 12px);
        min-height: var(--touch-target, 36px);
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
        min-height: var(--touch-target, 36px);
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
        min-width: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
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

    // Inline gold display (inside trigger, after avatar)
    this.goldInlineElement = document.createElement('div');
    this.goldInlineElement.className = 'profile-dropdown__gold-inline';
    this.goldInlineElement.innerHTML = `
      <span class="profile-dropdown__gold-icon">${Icon.html('resources', 'gold', { size: 'sm' })}</span>
      <span class="profile-dropdown__gold-value">0</span>
    `;
    this.goldElement = this.goldInlineElement.querySelector('.profile-dropdown__gold-value');

    // Add gold display inside trigger for horizontal inline layout
    this.triggerElement.appendChild(this.goldInlineElement);

    // Dropdown menu
    this.dropdownElement = document.createElement('div');
    this.dropdownElement.className = 'profile-dropdown__menu';

    this.renderDropdownContent();

    container.appendChild(this.triggerElement);
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
          <span class="profile-dropdown__menu-icon">${Icon.html('menu', 'formation', { size: 'lg' })}</span>
          <span class="profile-dropdown__menu-label">Formation</span>
        </div>
        ${hasParty ? `
        <div class="profile-dropdown__menu-item" data-action="party">
          <span class="profile-dropdown__menu-icon">${Icon.html('menu', 'party', { size: 'lg' })}</span>
          <span class="profile-dropdown__menu-label">Party</span>
        </div>
        ` : ''}
        <div class="profile-dropdown__menu-item" data-action="friends">
          <span class="profile-dropdown__menu-icon">${Icon.html('menu', 'friends', { size: 'lg' })}</span>
          <span class="profile-dropdown__menu-label">Social Hub</span>
        </div>
        <div class="profile-dropdown__menu-item" data-action="quests">
          <span class="profile-dropdown__menu-icon">${Icon.html('menu', 'quest', { size: 'lg' })}</span>
          <span class="profile-dropdown__menu-label">Quest Board</span>
        </div>
        <div class="profile-dropdown__menu-item" data-action="relics">
          <span class="profile-dropdown__menu-icon">${Icon.html('menu', 'equipment', { size: 'lg' })}</span>
          <span class="profile-dropdown__menu-label">Relics</span>
        </div>
        <div class="profile-dropdown__menu-item" data-action="leaderboard">
          <span class="profile-dropdown__menu-icon">${Icon.html('menu', 'leaderboard', { size: 'lg' })}</span>
          <span class="profile-dropdown__menu-label">Leaderboards</span>
        </div>
      </div>

      <!-- Settings and Logout -->
      <div class="profile-dropdown__menu-section profile-dropdown__menu-section--divider">
        <div class="profile-dropdown__menu-item" data-action="settings">
          <span class="profile-dropdown__menu-icon">${Icon.html('menu', 'settings', { size: 'lg' })}</span>
          <span class="profile-dropdown__menu-label">Settings</span>
        </div>
        <div class="profile-dropdown__menu-item profile-dropdown__menu-item--danger" data-action="logout">
          <span class="profile-dropdown__menu-icon">${Icon.html('menu', 'logout', { size: 'lg' })}</span>
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
            <div class="profile-dropdown__notification-title">${escapeHtml(notification.title)}</div>
            <div class="profile-dropdown__notification-time">${timeAgo}</div>
            ${actions}
          </div>
        </div>
      `;
    }).join('');

    // Add "View All" link
    html += '<a class="profile-dropdown__view-all" data-action="view-all-notifications">View All Notifications</a>';

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
   * Constructs portrait URL from character properties (race, gender, class)
   */
  updateAvatar() {
    const characters = this.game.state?.get('characters') || [];
    const leader = characters.find(c => c.isLeader) || characters[0];

    if (leader?.race && leader?.class) {
      // Construct portrait URL from character properties
      const race = leader.race.toLowerCase();
      const charClass = leader.class.toLowerCase();
      const gender = (leader.gender || 'male').toLowerCase();
      const portraitId = `${race}_${gender}_${charClass}`;
      const optimalSize = getOptimalSize('portraits', 48);
      const portraitUrl = getAssetPath('portraits', portraitId, { size: optimalSize });

      // Create img element with JS-based error handler to avoid inline HTML injection issues
      const img = document.createElement('img');
      img.src = portraitUrl;
      img.alt = 'Avatar';
      img.onerror = () => {
        // Simple text fallback - first letter of class name
        const initial = charClass.charAt(0).toUpperCase();
        this.avatarElement.innerHTML = `<span class="profile-dropdown__avatar-fallback">${initial}</span>`;
      };
      this.avatarElement.innerHTML = '';
      this.avatarElement.appendChild(img);
    } else if (leader?.class) {
      // Use class initial as fallback
      const initial = leader.class.charAt(0).toUpperCase();
      this.avatarElement.innerHTML = `<span class="profile-dropdown__avatar-fallback">${initial}</span>`;
    } else {
      this.avatarElement.innerHTML = '<span class="profile-dropdown__avatar-fallback">?</span>';
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
      case 'quests':
        this.game.scenes.switchTo('questBoard');
        break;
      case 'relics':
        this.openRelicCollection();
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
   * Open the relic collection. The world map scene owns the opener; other
   * scenes fall back to opening the modal directly.
   */
  async openRelicCollection() {
    const scene = this.game.scenes?.getCurrentScene?.();
    if (typeof scene?.openRelicCollectionModal === 'function') {
      await scene.openRelicCollectionModal();
      return;
    }
    try {
      const { RelicCollectionModal } = await import('../../modals/RelicCollectionModal.js');
      const modal = new RelicCollectionModal({
        game: this.game,
        onClose: () => modal.destroy()
      });
      await modal.show();
    } catch (err) {
      console.error('Failed to open relic collection modal:', err);
      parchmentToast.error('Error', 'Failed to load relic collection.');
    }
  }

  /**
   * Handle notification action button click
   */
  async handleNotificationAction(notificationId, action) {
    const notification = this.notifications.find(n => n.id === notificationId);
    if (!notification) return;

    // Prevent double-click by removing notification immediately (optimistic update)
    this.notifications = this.notifications.filter(n => n.id !== notificationId);
    this.unreadCount = Math.max(0, this.unreadCount - 1);
    this.updateBadge();
    this.renderDropdownContent();

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

      // Dismiss notification on server (local state already updated above)
      await this.game.api.delete(`/notifications/${notificationId}`);

    } catch (error) {
      console.error('Notification action failed:', error);
      this.game.toastManager?.error('Action Failed', error.message || 'Something went wrong');
      // Restore notification on failure
      this.notifications.unshift(notification);
      this.unreadCount++;
      this.updateBadge();
      this.renderDropdownContent();
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

    // Stop token refresh manager
    this.game.tokenRefreshManager?.stop();

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
   * Show the profile dropdown
   */
  show() {
    this.isVisible = true;
    this.element.style.display = '';
    this.updateAvatar();
    // The party list often arrives after the dropdown is shown (world map
    // loads it asynchronously); follow it instead of leaving a '?' portrait.
    if (!this.charactersUnsubscribe && typeof this.game.state?.subscribe === 'function') {
      this.charactersUnsubscribe = this.game.state.subscribe('characters', () => this.updateAvatar());
    }
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

    if (this.charactersUnsubscribe) {
      this.charactersUnsubscribe();
      this.charactersUnsubscribe = null;
    }

    // Remove from DOM
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    this.element = null;
    this.triggerElement = null;
    this.dropdownElement = null;
    this.badgeElement = null;
    this.goldElement = null;
    this.goldInlineElement = null;
    this.avatarElement = null;
    this.notificationListElement = null;
  }
}

export default ProfileDropdown;
