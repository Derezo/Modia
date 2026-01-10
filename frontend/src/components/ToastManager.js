/**
 * ToastManager - Manages toast notifications
 * Displays temporary popups in the corner of the screen
 */

export class ToastManager {
  constructor(game) {
    this.game = game;
    this.toasts = [];
    this.container = null;
    this.maxToasts = 5;
    this.defaultDuration = 8000; // 8 seconds

    this.createContainer();
    this.setupWebSocketHandler();
  }

  createContainer() {
    // Create container for toasts
    this.container = document.createElement('div');
    this.container.id = 'toast-container';
    this.container.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
      max-width: 350px;
    `;
    document.body.appendChild(this.container);
  }

  setupWebSocketHandler() {
    if (this.game.socket) {
      this.game.socket.on('notification:new', (data) => {
        this.showNotificationToast(data);
      });

      this.game.socket.on('notification:expiring', (data) => {
        // Could show a warning toast or update existing one
        this.showToast({
          title: 'Expiring Soon',
          message: 'A notification is about to expire',
          type: 'warning',
          duration: 3000
        });
      });
    }
  }

  /**
   * Show a toast for a notification
   * @param {object} notification - Notification data from WebSocket
   */
  showNotificationToast(notification) {
    const typeStyles = {
      friend_request: { icon: '👤', color: '#4a9eff' },
      friend_accepted: { icon: '🤝', color: '#4ade80' },
      party_invite: { icon: '⚔️', color: '#f59e0b' },
      match_found: { icon: '🏟️', color: '#ef4444' },
      match_result: { icon: '🏆', color: '#a855f7' },
      lfg_application: { icon: '📋', color: '#06b6d4' },
      system: { icon: 'ℹ️', color: '#6b7280' }
    };

    const style = typeStyles[notification.notificationType] || typeStyles.system;

    this.showToast({
      id: notification.id,
      title: notification.title,
      message: notification.message,
      icon: style.icon,
      color: style.color,
      type: notification.notificationType,
      payload: notification.payload,
      duration: notification.expiresAt
        ? Math.min(this.defaultDuration, new Date(notification.expiresAt) - Date.now())
        : this.defaultDuration,
      onClick: () => this.handleToastClick(notification)
    });
  }

  /**
   * Show a generic toast
   * @param {object} options - Toast options
   */
  showToast(options) {
    const {
      id = Date.now(),
      title,
      message = '',
      icon = 'ℹ️',
      color = '#4a9eff',
      type = 'info',
      duration = this.defaultDuration,
      onClick = null
    } = options;

    // Remove oldest toast if at max
    if (this.toasts.length >= this.maxToasts) {
      this.removeToast(this.toasts[0].id);
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.dataset.id = id;
    toast.style.cssText = `
      background: linear-gradient(135deg, rgba(20, 20, 30, 0.95), rgba(30, 30, 45, 0.95));
      border: 1px solid ${color};
      border-left: 4px solid ${color};
      border-radius: 8px;
      padding: 12px 16px;
      color: #fff;
      font-family: 'Georgia', serif;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      pointer-events: auto;
      cursor: ${onClick ? 'pointer' : 'default'};
      opacity: 0;
      transform: translateX(100%);
      transition: opacity 0.3s, transform 0.3s;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      max-width: 100%;
    `;

    toast.innerHTML = `
      <span style="font-size: 20px; flex-shrink: 0;">${icon}</span>
      <div style="flex: 1; min-width: 0;">
        <div style="font-weight: bold; margin-bottom: 2px; color: ${color};">${title}</div>
        ${message ? `<div style="font-size: 13px; color: #a0a0a0; overflow: hidden; text-overflow: ellipsis;">${message}</div>` : ''}
      </div>
      <button class="toast-close" style="
        background: none;
        border: none;
        color: #666;
        cursor: pointer;
        font-size: 18px;
        padding: 0;
        line-height: 1;
        flex-shrink: 0;
      ">&times;</button>
    `;

    // Click handler for the toast body
    if (onClick) {
      toast.addEventListener('click', (e) => {
        if (!e.target.classList.contains('toast-close')) {
          onClick();
          this.removeToast(id);
        }
      });
    }

    // Close button handler
    toast.querySelector('.toast-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeToast(id);
    });

    this.container.appendChild(toast);

    // Store toast reference
    this.toasts.push({ id, element: toast, type });

    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    });

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        this.removeToast(id);
      }, duration);
    }

    return id;
  }

  /**
   * Remove a toast by ID
   * @param {number|string} id - Toast ID
   */
  removeToast(id) {
    const index = this.toasts.findIndex(t => t.id === id);
    if (index === -1) return;

    const toast = this.toasts[index];
    toast.element.style.opacity = '0';
    toast.element.style.transform = 'translateX(100%)';

    setTimeout(() => {
      toast.element.remove();
    }, 300);

    this.toasts.splice(index, 1);
  }

  /**
   * Handle clicking on a notification toast
   * @param {object} notification - Notification data
   */
  handleToastClick(notification) {
    // Open notification center or handle specific action
    if (this.game.notificationCenter) {
      this.game.notificationCenter.open();
    }

    // Handle specific notification types
    switch (notification.notificationType) {
      case 'party_invite':
        // Open party invite modal
        if (this.game.partyInviteModal && notification.payload?.inviteId) {
          this.game.partyInviteModal.show(notification.payload.inviteId);
        }
        break;
      case 'match_found':
        // Focus coliseum scene if not there
        if (this.game.sceneManager.currentScene?.name !== 'coliseum') {
          // The coliseum scene should handle match_found via its own handler
        }
        break;
      default:
        // Default: just open notification center
        break;
    }
  }

  /**
   * Clear all toasts
   */
  clearAll() {
    [...this.toasts].forEach(toast => this.removeToast(toast.id));
  }

  /**
   * Show a success toast
   */
  success(title, message = '') {
    return this.showToast({ title, message, icon: '✓', color: '#4ade80', type: 'success' });
  }

  /**
   * Show an error toast
   */
  error(title, message = '') {
    return this.showToast({ title, message, icon: '✕', color: '#ef4444', type: 'error' });
  }

  /**
   * Show a warning toast
   */
  warning(title, message = '') {
    return this.showToast({ title, message, icon: '⚠', color: '#f59e0b', type: 'warning' });
  }

  /**
   * Show an info toast
   */
  info(title, message = '') {
    return this.showToast({ title, message, icon: 'ℹ', color: '#4a9eff', type: 'info' });
  }

  /**
   * Cleanup
   */
  destroy() {
    this.clearAll();
    this.container?.remove();
  }
}

export default ToastManager;
