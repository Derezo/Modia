/**
 * NotificationCenter - Slide-out drawer showing all notifications
 */

import { parchmentToast } from '../ui/parchment/ParchmentToast.js';
import {
  PARCHMENT_COLORS,
  getParchmentGradient,
  getParchmentBorder,
  getParchmentButtonCSS,
  getParchmentScrollbarCSS,
  getParchmentShadow
} from '../ui/parchment/index.js';
import { escapeHtml } from '../utils/escapeHtml.js';

export class NotificationCenter {
  constructor(game) {
    this.game = game;
    this.element = null;
    this.overlay = null;
    this.notificationList = null;
    this.isOpen = false;
    this.notifications = [];

    this.create();
    this.setupWebSocketHandlers();
  }

  create() {
    // Inject scrollbar styles
    this.injectScrollbarStyles();

    // Overlay
    this.overlay = document.createElement('div');
    this.overlay.id = 'notification-overlay';
    this.overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 9500;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.3s, visibility 0.3s;
    `;
    this.overlay.addEventListener('click', () => this.close());
    document.body.appendChild(this.overlay);

    // Panel
    this.element = document.createElement('div');
    this.element.id = 'notification-center';
    this.element.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      width: 380px;
      max-width: 90vw;
      height: 100%;
      background: ${getParchmentGradient()};
      border-left: ${getParchmentBorder(3)};
      box-shadow: ${getParchmentShadow(true)};
      z-index: 9600;
      transform: translateX(100%);
      transition: transform 0.3s ease-out;
      display: flex;
      flex-direction: column;
      font-family: 'Georgia', serif;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 20px;
      border-bottom: 1px solid ${PARCHMENT_COLORS.border};
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: linear-gradient(to bottom, ${PARCHMENT_COLORS.light}, ${PARCHMENT_COLORS.mid});
    `;
    header.innerHTML = `
      <h2 style="margin: 0; color: ${PARCHMENT_COLORS.text.primary}; font-size: 18px; text-shadow: 0 1px 0 rgba(255,255,255,0.3);">Notifications</h2>
      <div style="display: flex; gap: 10px;">
        <button id="mark-all-read" style="
          ${getParchmentButtonCSS('secondary')}
          padding: 6px 12px;
          font-size: 12px;
        ">Mark All Read</button>
        <button id="close-notifications" style="
          background: transparent;
          border: none;
          color: ${PARCHMENT_COLORS.text.secondary};
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
          transition: color 0.2s;
        ">&times;</button>
      </div>
    `;
    this.element.appendChild(header);

    // Notification list
    this.notificationList = document.createElement('div');
    this.notificationList.id = 'notification-list';
    this.notificationList.className = 'notification-center-list';
    this.notificationList.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      background: ${PARCHMENT_COLORS.mid};
    `;
    this.element.appendChild(this.notificationList);

    // Empty state
    this.emptyState = document.createElement('div');
    this.emptyState.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 200px;
      color: ${PARCHMENT_COLORS.text.muted};
      text-align: center;
    `;
    this.emptyState.innerHTML = `
      <span style="font-size: 48px; margin-bottom: 10px;">&#128276;</span>
      <p style="margin: 0;">No notifications</p>
    `;

    document.body.appendChild(this.element);

    // Event listeners
    header.querySelector('#close-notifications').addEventListener('click', () => this.close());
    header.querySelector('#mark-all-read').addEventListener('click', () => this.markAllAsRead());
    header.querySelector('#close-notifications').addEventListener('mouseenter', (e) => {
      e.target.style.color = PARCHMENT_COLORS.text.primary;
    });
    header.querySelector('#close-notifications').addEventListener('mouseleave', (e) => {
      e.target.style.color = PARCHMENT_COLORS.text.secondary;
    });
    header.querySelector('#mark-all-read').addEventListener('mouseenter', (e) => {
      e.target.style.borderColor = PARCHMENT_COLORS.borderDark;
      e.target.style.background = PARCHMENT_COLORS.dark;
    });
    header.querySelector('#mark-all-read').addEventListener('mouseleave', (e) => {
      e.target.style.borderColor = PARCHMENT_COLORS.border;
      e.target.style.background = PARCHMENT_COLORS.light;
    });
  }

  /**
   * Inject parchment scrollbar styles for the notification list
   */
  injectScrollbarStyles() {
    const styleId = 'notification-center-scrollbar-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = getParchmentScrollbarCSS('.notification-center-list');
    document.head.appendChild(style);
  }

  setupWebSocketHandlers() {
    if (this.game.socket) {
      this.game.socket.on('notification:new', (notification) => {
        // Add to top of list if panel is open
        if (this.isOpen) {
          this.notifications.unshift(notification);
          this.renderNotifications();
        }
      });

      this.game.socket.on('notification:cancelled', (data) => {
        this.notifications = this.notifications.filter(n => n.id !== data.id);
        this.renderNotifications();
      });
    }
  }

  /**
   * Fetch notifications from API
   */
  async fetchNotifications() {
    try {
      const response = await this.game.api.request('/notifications');
      if (response.success) {
        this.notifications = response.notifications;
        this.renderNotifications();
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    }
  }

  /**
   * Render the notification list
   */
  renderNotifications() {
    this.notificationList.innerHTML = '';

    if (this.notifications.length === 0) {
      this.notificationList.appendChild(this.emptyState.cloneNode(true));
      return;
    }

    // Parchment-themed type styles with muted colors
    const typeStyles = {
      friend_request: { icon: '&#128100;', color: PARCHMENT_COLORS.state.info, label: 'Friend Request' },
      friend_accepted: { icon: '&#129309;', color: PARCHMENT_COLORS.state.success, label: 'Friend Accepted' },
      party_invite: { icon: '&#9876;', color: PARCHMENT_COLORS.accent.copper, label: 'Party Invite' },
      match_found: { icon: '&#127967;', color: PARCHMENT_COLORS.state.error, label: 'Match Found' },
      match_result: { icon: '&#127942;', color: PARCHMENT_COLORS.accent.burgundy, label: 'Match Result' },
      lfg_application: { icon: '&#128203;', color: PARCHMENT_COLORS.state.info, label: 'LFG Application' },
      system: { icon: '&#8505;', color: PARCHMENT_COLORS.text.muted, label: 'System' }
    };

    this.notifications.forEach(notification => {
      const style = typeStyles[notification.type] || typeStyles.system;
      const isUnread = !notification.read_at;
      const timeAgo = this.getTimeAgo(new Date(notification.created_at));

      const item = document.createElement('div');
      item.className = 'notification-item';
      item.dataset.id = notification.id;
      item.style.cssText = `
        background: ${isUnread ? PARCHMENT_COLORS.light : PARCHMENT_COLORS.mid};
        border: 1px solid ${isUnread ? style.color : PARCHMENT_COLORS.border};
        border-left: 3px solid ${style.color};
        border-radius: 6px;
        padding: 12px;
        margin-bottom: 10px;
        cursor: pointer;
        transition: background 0.2s, transform 0.2s, box-shadow 0.2s;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      `;

      item.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 10px;">
          <span style="font-size: 24px;">${style.icon}</span>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="color: ${style.color}; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: bold;">
                ${style.label}
              </span>
              <span style="color: ${PARCHMENT_COLORS.text.muted}; font-size: 11px;">${timeAgo}</span>
            </div>
            <div style="color: ${PARCHMENT_COLORS.text.primary}; font-weight: ${isUnread ? 'bold' : 'normal'}; margin-bottom: 4px;">
              ${escapeHtml(notification.title)}
            </div>
            ${notification.message ? `<div style="color: ${PARCHMENT_COLORS.text.secondary}; font-size: 13px;">${escapeHtml(notification.message)}</div>` : ''}
            ${this.renderActions(notification, style.color)}
          </div>
          <button class="dismiss-btn" style="
            background: none;
            border: none;
            color: ${PARCHMENT_COLORS.text.muted};
            cursor: pointer;
            font-size: 16px;
            padding: 0;
            opacity: 0.5;
            transition: opacity 0.2s, color 0.2s;
          ">&times;</button>
        </div>
      `;

      // Hover effects
      item.addEventListener('mouseenter', () => {
        item.style.background = PARCHMENT_COLORS.light;
        item.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
        item.querySelector('.dismiss-btn').style.opacity = '1';
        item.querySelector('.dismiss-btn').style.color = PARCHMENT_COLORS.text.secondary;
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = isUnread ? PARCHMENT_COLORS.light : PARCHMENT_COLORS.mid;
        item.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
        item.querySelector('.dismiss-btn').style.opacity = '0.5';
        item.querySelector('.dismiss-btn').style.color = PARCHMENT_COLORS.text.muted;
      });

      // Click handler for the whole item
      item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('dismiss-btn') && !e.target.classList.contains('action-btn')) {
          this.handleNotificationClick(notification);
        }
      });

      // Dismiss button
      item.querySelector('.dismiss-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissNotification(notification.id);
      });

      // Action buttons
      item.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.handleAction(notification, btn.dataset.action);
        });
      });

      this.notificationList.appendChild(item);
    });
  }

  /**
   * Render action buttons based on notification type
   */
  renderActions(notification, color) {
    const actions = [];

    switch (notification.type) {
      case 'friend_request':
        actions.push(
          { action: 'accept', label: 'Accept', primary: true },
          { action: 'decline', label: 'Decline', primary: false }
        );
        break;
      case 'party_invite':
        actions.push(
          { action: 'accept', label: 'Join', primary: true },
          { action: 'decline', label: 'Decline', primary: false }
        );
        break;
      case 'lfg_application':
        actions.push(
          { action: 'accept', label: 'Invite', primary: true },
          { action: 'decline', label: 'Ignore', primary: false }
        );
        break;
      default:
        return '';
    }

    if (actions.length === 0) return '';

    return `
      <div style="display: flex; gap: 8px; margin-top: 10px;">
        ${actions.map(a => `
          <button class="action-btn" data-action="${a.action}" style="
            background: ${a.primary ? color : PARCHMENT_COLORS.light};
            border: 1px solid ${color};
            color: ${a.primary ? PARCHMENT_COLORS.text.inverse : color};
            padding: 6px 14px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-family: inherit;
            font-weight: bold;
            transition: all 0.2s;
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
          ">${a.label}</button>
        `).join('')}
      </div>
    `;
  }

  /**
   * Handle notification click
   */
  async handleNotificationClick(notification) {
    // Mark as read
    if (!notification.read_at) {
      await this.markAsRead(notification.id);
    }

    // Handle based on type
    switch (notification.type) {
      case 'party_invite':
        // Open party invite modal
        if (notification.payload && this.game.showPartyInviteModal) {
          this.close();
          this.game.showPartyInviteModal({
            inviteId: notification.payload.inviteId,
            partyId: notification.payload.partyId,
            partyName: notification.payload.partyName,
            leaderUsername: notification.payload.inviterUsername,
            expiresAt: notification.payload.expiresAt
          });
        }
        break;
      case 'match_result':
        // Could open match details modal
        break;
      case 'friend_accepted':
        // Could open friends list
        break;
      default:
        break;
    }
  }

  /**
   * Handle action button click
   */
  async handleAction(notification, action) {
    try {
      switch (notification.type) {
        case 'friend_request':
          if (action === 'accept') {
            await this.game.api.request(`/friends/accept/${notification.payload.requestId}`, { method: 'POST' });
            parchmentToast.success('Friend Added', 'You are now friends!');
          } else {
            await this.game.api.request(`/friends/decline/${notification.payload.requestId}`, { method: 'POST' });
          }
          break;

        case 'party_invite':
          if (action === 'accept') {
            await this.game.api.request(`/party/multiplayer/join/${notification.payload.inviteId}`, { method: 'POST' });
            parchmentToast.success('Joined Party', 'You have joined the party!');
          } else {
            await this.game.api.request(`/party/multiplayer/decline/${notification.payload.inviteId}`, { method: 'POST' });
          }
          break;

        case 'lfg_application':
          if (action === 'accept') {
            // Invite the applicant to party
            await this.game.api.request(`/party/multiplayer/${notification.payload.partyId}/invite`, {
              method: 'POST',
              body: JSON.stringify({ username: notification.payload.applicantUsername })
            });
            parchmentToast.success('Invite Sent', 'Party invite sent!');
          }
          break;
      }

      // Dismiss the notification after action
      await this.dismissNotification(notification.id);

    } catch (error) {
      console.error('Action failed:', error);
      parchmentToast.error('Action Failed', error.message || 'Something went wrong');
    }
  }

  /**
   * Mark a notification as read
   */
  async markAsRead(notificationId) {
    try {
      await this.game.api.request(`/notifications/${notificationId}/read`, { method: 'POST' });
      const notification = this.notifications.find(n => n.id === notificationId);
      if (notification) {
        notification.read_at = new Date().toISOString();
        this.renderNotifications();
      }
      this.game.notificationBell?.decrementCount();
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead() {
    try {
      await this.game.api.request('/notifications/read-all', { method: 'POST' });
      this.notifications.forEach(n => n.read_at = new Date().toISOString());
      this.renderNotifications();
      this.game.notificationBell?.setUnreadCount(0);
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  }

  /**
   * Dismiss a notification
   */
  async dismissNotification(notificationId) {
    try {
      await this.game.api.request(`/notifications/${notificationId}`, { method: 'DELETE' });
      this.notifications = this.notifications.filter(n => n.id !== notificationId);
      this.renderNotifications();
      // Refresh unread count
      this.game.notificationBell?.fetchUnreadCount();
    } catch (error) {
      console.error('Failed to dismiss notification:', error);
    }
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
   * Open the notification center
   */
  open() {
    this.isOpen = true;
    this.fetchNotifications();
    this.overlay.style.opacity = '1';
    this.overlay.style.visibility = 'visible';
    this.element.style.transform = 'translateX(0)';
  }

  /**
   * Close the notification center
   */
  close() {
    this.isOpen = false;
    this.overlay.style.opacity = '0';
    this.overlay.style.visibility = 'hidden';
    this.element.style.transform = 'translateX(100%)';
  }

  /**
   * Toggle open/close
   */
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }


  /**
   * Cleanup
   */
  destroy() {
    this.element?.remove();
    this.overlay?.remove();
  }
}

export default NotificationCenter;
