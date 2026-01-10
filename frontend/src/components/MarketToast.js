/**
 * Market Toast Notifications
 * Parchment-styled slide-in notifications for marketplace events
 */

class MarketToastManager {
  constructor() {
    this.container = null;
    this.toasts = [];
    this.maxToasts = 5;
  }

  ensureContainer() {
    if (!this.container) {
      this.addStyles();

      this.container = document.createElement('div');
      this.container.className = 'market-toast-container';
      document.body.appendChild(this.container);
    }
    return this.container;
  }

  addStyles() {
    if (document.getElementById('market-toast-styles')) return;

    const style = document.createElement('style');
    style.id = 'market-toast-styles';
    style.textContent = `
      .market-toast-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 3000;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
      }

      .market-toast {
        background: linear-gradient(to bottom, #e8dcc8, #d9ccb8);
        border: 2px solid #8b7355;
        border-radius: 4px;
        padding: 12px 16px 12px 44px;
        min-width: 280px;
        max-width: 400px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        position: relative;
        pointer-events: auto;
        opacity: 0;
        transform: translateX(100%);
        transition: opacity 0.3s ease-out, transform 0.3s ease-out;
        overflow: hidden;
      }

      .market-toast.visible {
        opacity: 1;
        transform: translateX(0);
      }

      .market-toast.removing {
        opacity: 0;
        transform: translateX(100%);
      }

      .market-toast-success { border-left: 4px solid #4a7548; }
      .market-toast-error { border-left: 4px solid #8b4444; }
      .market-toast-warning { border-left: 4px solid #c9a227; }
      .market-toast-info { border-left: 4px solid #4a6088; }

      .market-toast-icon {
        position: absolute;
        left: 12px;
        top: 50%;
        transform: translateY(-50%);
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        color: white;
        font-weight: bold;
      }

      .market-toast-success .market-toast-icon { background: #4a7548; }
      .market-toast-error .market-toast-icon { background: #8b4444; }
      .market-toast-warning .market-toast-icon { background: #c9a227; }
      .market-toast-info .market-toast-icon { background: #4a6088; }

      .market-toast-content {
        color: #2d2418;
        font-family: Georgia, serif;
        font-size: 14px;
      }

      .market-toast-title {
        font-weight: bold;
        margin-bottom: 4px;
      }

      .market-toast-message {
        color: #5a4a3a;
        font-size: 13px;
      }

      .market-toast-close {
        position: absolute;
        top: 8px;
        right: 8px;
        background: none;
        border: none;
        color: #7a6a5a;
        cursor: pointer;
        font-size: 16px;
        padding: 4px;
        line-height: 1;
      }

      .market-toast-close:hover {
        color: #2d2418;
      }

      .market-toast-progress {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 3px;
        width: 100%;
        transform-origin: left;
        animation: marketToastProgress var(--toast-duration) linear forwards;
      }

      .market-toast-success .market-toast-progress { background: #4a7548; }
      .market-toast-error .market-toast-progress { background: #8b4444; }
      .market-toast-warning .market-toast-progress { background: #c9a227; }
      .market-toast-info .market-toast-progress { background: #4a6088; }

      @keyframes marketToastProgress {
        from { transform: scaleX(1); }
        to { transform: scaleX(0); }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Show a toast notification
   * @param {Object} options
   * @param {string} options.type - 'success', 'error', 'warning', 'info'
   * @param {string} options.title - Toast title
   * @param {string} options.message - Toast message
   * @param {number} options.duration - Duration in ms (default 4000)
   */
  show(options) {
    const { type = 'info', title, message, duration = 4000 } = options;

    this.ensureContainer();

    // Remove oldest toast if at max
    if (this.toasts.length >= this.maxToasts) {
      this.removeToast(this.toasts[0]);
    }

    const icons = {
      success: '\u2713',
      error: '\u2715',
      warning: '!',
      info: 'i'
    };

    const toast = document.createElement('div');
    toast.className = `market-toast market-toast-${type}`;
    toast.style.setProperty('--toast-duration', `${duration}ms`);
    toast.innerHTML = `
      <div class="market-toast-icon">${icons[type]}</div>
      <div class="market-toast-content">
        ${title ? `<div class="market-toast-title">${this.escapeHtml(title)}</div>` : ''}
        ${message ? `<div class="market-toast-message">${this.escapeHtml(message)}</div>` : ''}
      </div>
      <button class="market-toast-close">&times;</button>
      <div class="market-toast-progress"></div>
    `;

    this.container.appendChild(toast);
    this.toasts.push(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.add('visible');
    });

    // Close button
    toast.querySelector('.market-toast-close').addEventListener('click', () => {
      this.removeToast(toast);
    });

    // Auto-dismiss
    const timeoutId = setTimeout(() => {
      this.removeToast(toast);
    }, duration);

    // Store timeout for cleanup
    toast.dataset.timeoutId = timeoutId;

    return toast;
  }

  removeToast(toast) {
    if (!toast || !this.toasts.includes(toast)) return;

    // Clear timeout
    if (toast.dataset.timeoutId) {
      clearTimeout(parseInt(toast.dataset.timeoutId));
    }

    toast.classList.remove('visible');
    toast.classList.add('removing');

    setTimeout(() => {
      const index = this.toasts.indexOf(toast);
      if (index > -1) {
        this.toasts.splice(index, 1);
      }
      toast.remove();
    }, 300);
  }

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Convenience methods
  success(title, message, duration) {
    return this.show({ type: 'success', title, message, duration });
  }

  error(title, message, duration) {
    return this.show({ type: 'error', title, message, duration });
  }

  warning(title, message, duration) {
    return this.show({ type: 'warning', title, message, duration });
  }

  info(title, message, duration) {
    return this.show({ type: 'info', title, message, duration });
  }
}

// Export singleton instance
export const marketToast = new MarketToastManager();
