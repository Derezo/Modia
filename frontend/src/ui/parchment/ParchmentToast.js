/**
 * ParchmentToast - Unified parchment-styled toast notification system
 *
 * Replaces both ToastManager.js and MarketToast.js with a consistent
 * medieval parchment aesthetic for all game notifications.
 */

import { escapeHtml } from '../../utils/escapeHtml.js';

class ParchmentToastManager {
  constructor() {
    this.container = null;
    this.toasts = [];
    this.maxToasts = 5;
    this.defaultDuration = 4000;
    this.stylesInjected = false;
    // 'top' (default, under the HUD) or 'bottom' (for screens whose top edge
    // holds controls, e.g. the marketplace tab bar). See setPlacement().
    this.placement = 'top';

    // Duplicate detection
    this.recentToasts = new Map(); // signature -> timestamp
    this.dedupeWindow = 2000; // 2 second cooldown for identical toasts
  }

  /**
   * Ensure the toast container and styles exist in the DOM
   */
  ensureContainer() {
    if (!this.stylesInjected) {
      this.injectStyles();
      this.stylesInjected = true;
    }

    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'parchment-toast-container';
      document.body.appendChild(this.container);
    }
    this.applyPlacement();

    return this.container;
  }

  /**
   * Anchor the toast stack at the top or bottom centre of the viewport.
   * Scenes whose top edge holds interactive chrome (tab bars) switch to
   * 'bottom' on enter and restore 'top' on exit.
   * @param {'top'|'bottom'} placement
   */
  setPlacement(placement) {
    this.placement = placement === 'bottom' ? 'bottom' : 'top';
    this.applyPlacement();
  }

  applyPlacement() {
    if (!this.container) return;
    this.container.classList.toggle('parchment-toast-container--bottom', this.placement === 'bottom');
  }

  /**
   * Inject CSS styles for the toast system
   */
  injectStyles() {
    if (document.getElementById('parchment-toast-styles')) return;

    const style = document.createElement('style');
    style.id = 'parchment-toast-styles';
    style.textContent = `
      /* z-index 10000 sits above every modal layer: ParchmentModal overlays
         stack from 1000 in steps of 10, NotificationCenter 9500-9600,
         PartyInviteModal 9700, ConnectionIndicator 9999. Only the tooltip
         (10001) is higher. */
      .parchment-toast-container {
        position: fixed;
        top: 60px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
        width: 400px;
        max-width: calc(100vw - 40px);
      }

      .parchment-toast {
        background: linear-gradient(to bottom, #e8dcc8, #d9ccb8);
        border: 2px solid #8b7355;
        border-radius: 4px;
        padding: 12px 40px 12px 48px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        position: relative;
        pointer-events: auto;
        cursor: pointer;
        overflow: hidden;
        opacity: 0;
        transform: translateY(-20px);
        transition: opacity 0.3s ease-out, transform 0.3s ease-out;
        font-family: Georgia, serif;
        color: #2d2418;
      }

      .parchment-toast.visible {
        opacity: 1;
        transform: translateY(0);
      }

      /* Bottom anchor: newest toast nearest the edge, sliding up into place */
      .parchment-toast-container.parchment-toast-container--bottom {
        top: auto;
        bottom: 32px;
        flex-direction: column-reverse;
      }

      .parchment-toast-container--bottom .parchment-toast:not(.visible):not(.removing) {
        transform: translateY(20px);
      }

      .parchment-toast.removing {
        opacity: 0;
        transform: translateX(100px);
        transition: opacity 0.25s ease-in, transform 0.25s ease-in;
      }

      /* Type-specific left border colors */
      .parchment-toast-success { border-left: 4px solid #4a7548; }
      .parchment-toast-error { border-left: 4px solid #8b4444; }
      .parchment-toast-warning { border-left: 4px solid #c9a227; }
      .parchment-toast-info { border-left: 4px solid #4a6088; }

      /* Circular icon indicator */
      .parchment-toast-icon {
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
        font-weight: bold;
        color: #fff;
        flex-shrink: 0;
      }

      .parchment-toast-success .parchment-toast-icon { background: #4a7548; }
      .parchment-toast-error .parchment-toast-icon { background: #8b4444; }
      .parchment-toast-warning .parchment-toast-icon { background: #c9a227; }
      .parchment-toast-info .parchment-toast-icon { background: #4a6088; }

      /* Content area */
      .parchment-toast-content {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .parchment-toast-title {
        font-weight: bold;
        font-size: 14px;
        color: #2d2418;
        line-height: 1.3;
      }

      .parchment-toast-message {
        font-size: 13px;
        color: #5a4a3a;
        line-height: 1.4;
        word-wrap: break-word;
      }

      /* Close button */
      .parchment-toast-close {
        position: absolute;
        top: 8px;
        right: 8px;
        background: none;
        border: none;
        color: #7a6a5a;
        cursor: pointer;
        font-size: 18px;
        padding: 4px;
        line-height: 1;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background-color 0.15s, color 0.15s;
      }

      .parchment-toast-close:hover {
        color: #2d2418;
        background: rgba(0, 0, 0, 0.08);
      }

      /* Progress bar */
      .parchment-toast-progress {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 3px;
        width: 100%;
        transform-origin: left;
        animation: parchmentToastProgress var(--toast-duration) linear forwards;
      }

      .parchment-toast-success .parchment-toast-progress { background: #4a7548; }
      .parchment-toast-error .parchment-toast-progress { background: #8b4444; }
      .parchment-toast-warning .parchment-toast-progress { background: #c9a227; }
      .parchment-toast-info .parchment-toast-progress { background: #4a6088; }

      /* Progress bar when paused (on hover) */
      .parchment-toast:hover .parchment-toast-progress {
        animation-play-state: paused;
      }

      @keyframes parchmentToastProgress {
        from { transform: scaleX(1); }
        to { transform: scaleX(0); }
      }

      /* Responsive adjustments */
      @media (max-width: 480px) {
        .parchment-toast-container {
          top: 20px;
          width: calc(100vw - 20px);
        }

        .parchment-toast-container.parchment-toast-container--bottom {
          top: auto;
          bottom: 16px;
        }

        .parchment-toast {
          padding: 10px 36px 10px 44px;
        }

        .parchment-toast-icon {
          width: 22px;
          height: 22px;
          font-size: 12px;
          left: 10px;
        }

        .parchment-toast-title {
          font-size: 13px;
        }

        .parchment-toast-message {
          font-size: 12px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Show a toast notification
   * @param {Object} options - Toast configuration
   * @param {string} options.type - 'success', 'error', 'warning', 'info'
   * @param {string} options.title - Toast title (required)
   * @param {string} [options.message] - Optional description
   * @param {number} [options.duration=4000] - Duration in milliseconds
   * @param {Function} [options.onClick] - Click callback
   * @returns {Object} Toast reference with id and element
   */
  show(options) {
    const {
      type = 'info',
      title,
      message = '',
      duration = this.defaultDuration,
      onClick = null
    } = options;

    if (!title) {
      console.warn('ParchmentToast: title is required');
      return null;
    }

    // Duplicate detection - skip if identical toast was shown recently
    const signature = `${type}:${title}:${message}`;
    const now = Date.now();
    if (this.recentToasts.has(signature)) {
      const lastTime = this.recentToasts.get(signature);
      if (now - lastTime < this.dedupeWindow) {
        return null; // Skip duplicate
      }
    }
    this.recentToasts.set(signature, now);

    // Clean up old entries periodically (every 10 toasts or so)
    if (this.recentToasts.size > 20) {
      for (const [key, time] of this.recentToasts) {
        if (now - time > this.dedupeWindow) {
          this.recentToasts.delete(key);
        }
      }
    }

    this.ensureContainer();

    // Remove oldest toast if at max
    if (this.toasts.length >= this.maxToasts) {
      this.removeToast(this.toasts[0].id);
    }

    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const icons = {
      success: '\u2713', // checkmark
      error: '\u2715',   // X
      warning: '!',
      info: 'i'
    };

    const toast = document.createElement('div');
    toast.className = `parchment-toast parchment-toast-${type}`;
    toast.dataset.id = id;
    toast.style.setProperty('--toast-duration', `${duration}ms`);

    toast.innerHTML = `
      <div class="parchment-toast-icon">${icons[type] || icons.info}</div>
      <div class="parchment-toast-content">
        <div class="parchment-toast-title">${escapeHtml(title)}</div>
        ${message ? `<div class="parchment-toast-message">${escapeHtml(message)}</div>` : ''}
      </div>
      <button class="parchment-toast-close" aria-label="Close notification">&times;</button>
      <div class="parchment-toast-progress"></div>
    `;

    // Track remaining time for pause/resume
    let remainingTime = duration;
    let startTime = Date.now();
    let timeoutId = null;
    let isPaused = false;

    // Set up auto-dismiss timer
    const startTimer = () => {
      startTime = Date.now();
      timeoutId = setTimeout(() => {
        this.removeToast(id);
      }, remainingTime);
    };

    const pauseTimer = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        remainingTime -= Date.now() - startTime;
        isPaused = true;
      }
    };

    const resumeTimer = () => {
      if (isPaused && remainingTime > 0) {
        isPaused = false;
        startTimer();
      }
    };

    // Pause timer on hover
    toast.addEventListener('mouseenter', pauseTimer);
    toast.addEventListener('mouseleave', resumeTimer);

    // Close button handler
    const closeBtn = toast.querySelector('.parchment-toast-close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (timeoutId) clearTimeout(timeoutId);
      this.removeToast(id);
    });

    // Toast body click handler
    toast.addEventListener('click', (e) => {
      if (e.target === closeBtn || closeBtn.contains(e.target)) return;

      if (onClick) {
        onClick();
      }
      if (timeoutId) clearTimeout(timeoutId);
      this.removeToast(id);
    });

    // Add to container
    this.container.appendChild(toast);

    // Store toast reference
    const toastRef = {
      id,
      element: toast,
      type,
      timeoutId: null,
      pauseTimer,
      resumeTimer
    };
    this.toasts.push(toastRef);

    // Animate in on next frame
    requestAnimationFrame(() => {
      toast.classList.add('visible');
    });

    // Start auto-dismiss timer
    if (duration > 0) {
      startTimer();
      toastRef.timeoutId = timeoutId;
    }

    return toastRef;
  }

  /**
   * Remove a toast by ID
   * @param {string} id - Toast ID
   */
  removeToast(id) {
    const index = this.toasts.findIndex(t => t.id === id);
    if (index === -1) return;

    const toastRef = this.toasts[index];
    const toast = toastRef.element;

    // Clear any pending timeout
    if (toastRef.timeoutId) {
      clearTimeout(toastRef.timeoutId);
    }

    // Animate out
    toast.classList.remove('visible');
    toast.classList.add('removing');

    // Remove from DOM after animation
    setTimeout(() => {
      toast.remove();
    }, 250);

    // Remove from tracking array
    this.toasts.splice(index, 1);
  }


  /**
   * Show a success toast
   * @param {string} title - Toast title
   * @param {string} [message] - Optional description
   * @param {number} [duration] - Duration in ms
   * @returns {Object} Toast reference
   */
  success(title, message, duration) {
    return this.show({ type: 'success', title, message, duration });
  }

  /**
   * Show an error toast
   * @param {string} title - Toast title
   * @param {string} [message] - Optional description
   * @param {number} [duration] - Duration in ms
   * @returns {Object} Toast reference
   */
  error(title, message, duration) {
    return this.show({ type: 'error', title, message, duration });
  }

  /**
   * Show a warning toast
   * @param {string} title - Toast title
   * @param {string} [message] - Optional description
   * @param {number} [duration] - Duration in ms
   * @returns {Object} Toast reference
   */
  warning(title, message, duration) {
    return this.show({ type: 'warning', title, message, duration });
  }

  /**
   * Show an info toast
   * @param {string} title - Toast title
   * @param {string} [message] - Optional description
   * @param {number} [duration] - Duration in ms
   * @returns {Object} Toast reference
   */
  info(title, message, duration) {
    return this.show({ type: 'info', title, message, duration });
  }

  /**
   * Clear all toasts
   */
  clearAll() {
    // Copy array since removeToast modifies it
    [...this.toasts].forEach(toast => this.removeToast(toast.id));
  }

  /**
   * Destroy the toast manager and clean up DOM
   */
  destroy() {
    this.clearAll();
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    const styles = document.getElementById('parchment-toast-styles');
    if (styles) {
      styles.remove();
    }
    this.stylesInjected = false;
  }
}

// Export singleton instance
export const parchmentToast = new ParchmentToastManager();

// Also export the class for cases where multiple instances are needed
export { ParchmentToastManager };

export default parchmentToast;
