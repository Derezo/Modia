/**
 * NotificationBell - HUD icon showing notification count
 * Clicking opens the NotificationCenter
 */

export class NotificationBell {
  constructor(game) {
    this.game = game;
    this.element = null;
    this.badge = null;
    this.unreadCount = 0;
    this.isVisible = false;

    this.create();
    this.setupWebSocketHandlers();
    this.fetchUnreadCount();
  }

  create() {
    this.element = document.createElement('div');
    this.element.id = 'notification-bell';
    this.element.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9000;
      width: 44px;
      height: 44px;
      background: linear-gradient(135deg, rgba(20, 20, 30, 0.9), rgba(30, 30, 45, 0.9));
      border: 2px solid #4a4a6a;
      border-radius: 50%;
      cursor: pointer;
      display: none;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s, border-color 0.2s;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    `;

    // Bell icon
    const bellIcon = document.createElement('span');
    bellIcon.innerHTML = '🔔';
    bellIcon.style.cssText = `
      font-size: 22px;
      transition: transform 0.2s;
    `;
    this.element.appendChild(bellIcon);

    // Unread badge
    this.badge = document.createElement('div');
    this.badge.className = 'notification-badge';
    this.badge.style.cssText = `
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 20px;
      height: 20px;
      background: #ef4444;
      border-radius: 10px;
      color: white;
      font-size: 12px;
      font-weight: bold;
      font-family: Arial, sans-serif;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 0 6px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    `;
    this.element.appendChild(this.badge);

    // Hover effect
    this.element.addEventListener('mouseenter', () => {
      this.element.style.borderColor = '#7a7aaa';
      this.element.style.transform = 'scale(1.1)';
      bellIcon.style.transform = 'rotate(15deg)';
    });

    this.element.addEventListener('mouseleave', () => {
      this.element.style.borderColor = '#4a4a6a';
      this.element.style.transform = 'scale(1)';
      bellIcon.style.transform = 'rotate(0)';
    });

    // Click handler
    this.element.addEventListener('click', () => {
      this.onClick();
    });

    document.body.appendChild(this.element);
  }

  setupWebSocketHandlers() {
    if (this.game.socket) {
      // New notification received
      this.game.socket.on('notification:new', () => {
        this.unreadCount++;
        this.updateBadge();
        this.animateBell();
      });

      // Notification cancelled/expired
      this.game.socket.on('notification:cancelled', () => {
        this.unreadCount = Math.max(0, this.unreadCount - 1);
        this.updateBadge();
      });
    }
  }

  /**
   * Fetch unread count from API
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
   * Update the badge display
   */
  updateBadge() {
    if (this.unreadCount > 0) {
      this.badge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
      this.badge.style.display = 'flex';
    } else {
      this.badge.style.display = 'none';
    }
  }

  /**
   * Animate the bell when new notification arrives
   */
  animateBell() {
    const bellIcon = this.element.querySelector('span');
    bellIcon.style.animation = 'none';

    // Force reflow
    void bellIcon.offsetWidth;

    // Add shake animation
    bellIcon.style.animation = 'bellShake 0.5s ease-in-out';

    // Add shake keyframes if not present
    if (!document.querySelector('#bell-shake-keyframes')) {
      const style = document.createElement('style');
      style.id = 'bell-shake-keyframes';
      style.textContent = `
        @keyframes bellShake {
          0%, 100% { transform: rotate(0); }
          20% { transform: rotate(20deg); }
          40% { transform: rotate(-20deg); }
          60% { transform: rotate(15deg); }
          80% { transform: rotate(-10deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }

  /**
   * Handle bell click
   */
  onClick() {
    if (this.game.notificationCenter) {
      this.game.notificationCenter.toggle();
    }
  }

  /**
   * Show the bell
   */
  show() {
    this.isVisible = true;
    this.element.style.display = 'flex';
    this.fetchUnreadCount();
  }

  /**
   * Hide the bell
   */
  hide() {
    this.isVisible = false;
    this.element.style.display = 'none';
  }

  /**
   * Update count after reading notifications
   * @param {number} count - New unread count
   */
  setUnreadCount(count) {
    this.unreadCount = count;
    this.updateBadge();
  }

  /**
   * Decrement count by one
   */
  decrementCount() {
    this.unreadCount = Math.max(0, this.unreadCount - 1);
    this.updateBadge();
  }

  /**
   * Cleanup
   */
  destroy() {
    this.element?.remove();
  }
}

export default NotificationBell;
