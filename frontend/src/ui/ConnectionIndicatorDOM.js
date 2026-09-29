/**
 * @module ConnectionIndicatorDOM
 * @description DOM-based visual indicator for WebSocket connection quality.
 *
 * Renders as a small dot in the top-right corner of the viewport.
 * Shows connection state through color and optional animation:
 * - Green dot: Healthy connection
 * - Yellow dot: Degraded connection (high latency or minor retries)
 * - Orange pulsing dot: Unstable connection
 * - Red dot: Disconnected
 * - Gray spinner: Reconnecting
 *
 * Unlike the canvas-based ConnectionIndicator, this is a DOM element that can be
 * displayed globally without requiring an active canvas scene.
 *
 * @see connectionQuality.js - Connection state manager
 * @see ConnectionIndicator.js - Canvas-based version for battle HUD
 */

import { ConnectionState } from '../api/connectionQuality.js';

/**
 * DOM-based visual indicator for WebSocket connection quality.
 */
export class ConnectionIndicatorDOM {
  /**
   * Create a DOM connection indicator.
   * @param {import('../api/connectionQuality.js').ConnectionQualityManager} qualityManager - Connection quality manager instance
   * @param {Object} options - Configuration options
   * @param {boolean} [options.showLatency=false] - Whether to show latency in tooltip
   * @param {boolean} [options.hideWhenHealthy=false] - Hide indicator when connection is healthy
   * @param {string} [options.position='top-right'] - Position: 'top-right', 'top-left', 'bottom-right', 'bottom-left'
   */
  constructor(qualityManager, options = {}) {
    this.qualityManager = qualityManager;
    this.options = {
      showLatency: options.showLatency ?? false,
      hideWhenHealthy: options.hideWhenHealthy ?? false,
      position: options.position ?? 'top-right'
    };

    // DOM elements
    this.container = null;
    this.dot = null;
    this.tooltip = null;

    // State tracking
    this.currentState = null;
    this.visible = false;
    this.hasEverConnected = false;

    // Colors for each state
    this.colors = {
      [ConnectionState.HEALTHY]: '#22c55e',      // Green
      [ConnectionState.DEGRADED]: '#eab308',     // Yellow
      [ConnectionState.UNSTABLE]: '#f97316',     // Orange
      [ConnectionState.DISCONNECTED]: '#ef4444', // Red
      [ConnectionState.RECONNECTING]: '#9ca3af', // Gray
      [ConnectionState.RATE_LIMITED]: '#a855f7'  // Purple
    };

    // State labels for tooltip
    this.stateLabels = {
      [ConnectionState.HEALTHY]: 'Connected',
      [ConnectionState.DEGRADED]: 'Slow Connection',
      [ConnectionState.UNSTABLE]: 'Unstable Connection',
      [ConnectionState.DISCONNECTED]: 'Disconnected',
      [ConnectionState.RECONNECTING]: 'Reconnecting...',
      [ConnectionState.RATE_LIMITED]: 'Rate Limited'
    };

    // Subscribe to state changes
    this.unsubscribe = this.qualityManager.onChange((stateInfo) => {
      this.handleStateChange(stateInfo);
    });

    // Create DOM elements
    this.createElements();
  }

  /**
   * Create the DOM elements for the indicator.
   */
  createElements() {
    // Inject styles if not already present
    this.injectStyles();

    // Create container
    this.container = document.createElement('div');
    this.container.className = `connection-indicator-dom connection-indicator-${this.options.position}`;
    this.container.setAttribute('role', 'status');
    this.container.setAttribute('aria-live', 'polite');

    // Create the dot indicator
    this.dot = document.createElement('div');
    this.dot.className = 'connection-indicator-dot';
    this.container.appendChild(this.dot);

    // Create tooltip
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'connection-indicator-tooltip';
    this.container.appendChild(this.tooltip);

    // Add hover listener for tooltip
    this.container.addEventListener('mouseenter', () => {
      this.tooltip.classList.add('visible');
    });
    this.container.addEventListener('mouseleave', () => {
      this.tooltip.classList.remove('visible');
    });

    // Initially hidden until first connection
    this.container.style.display = 'none';
  }

  /**
   * Inject CSS styles for the indicator.
   */
  injectStyles() {
    if (document.getElementById('connection-indicator-dom-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'connection-indicator-dom-styles';
    style.textContent = `
      /* Below modal overlays (z 1000+) so the dot never sits on top of a
         dialog; it is a status hint, not an alert. */
      .connection-indicator-dom {
        position: fixed;
        z-index: 900;
        display: flex;
        align-items: center;
        gap: 6px;
        pointer-events: auto;
      }

      /* Anchored to the visible game canvas (Game.publishCanvasAnchor), not
         the viewport, so the dot stays on the letterboxed canvas. */
      .connection-indicator-top-right {
        top: calc(var(--game-canvas-top, 0px) + 12px);
        right: calc(var(--game-canvas-right, 0px) + 12px);
      }

      .connection-indicator-top-left {
        top: calc(var(--game-canvas-top, 0px) + 12px);
        left: calc(var(--game-canvas-left, 0px) + 12px);
      }

      .connection-indicator-bottom-right {
        bottom: calc(var(--game-canvas-bottom, 0px) + 12px);
        right: calc(var(--game-canvas-right, 0px) + 12px);
      }

      .connection-indicator-bottom-left {
        bottom: calc(var(--game-canvas-bottom, 0px) + 12px);
        left: calc(var(--game-canvas-left, 0px) + 12px);
      }

      .connection-indicator-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background-color: #22c55e;
        box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.2);
        transition: background-color 0.3s ease;
      }

      .connection-indicator-dot.pulse {
        animation: connection-indicator-pulse 1.5s ease-in-out infinite;
      }

      .connection-indicator-dot.spinner {
        border: 2px solid transparent;
        border-top-color: currentColor;
        background: none !important;
        animation: connection-indicator-spin 0.8s linear infinite;
      }

      @keyframes connection-indicator-pulse {
        0%, 100% {
          transform: scale(1);
          opacity: 1;
        }
        50% {
          transform: scale(1.2);
          opacity: 0.7;
        }
      }

      @keyframes connection-indicator-spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .connection-indicator-tooltip {
        position: absolute;
        right: 100%;
        top: 50%;
        transform: translateY(-50%);
        margin-right: 8px;
        padding: 6px 10px;
        background: rgba(0, 0, 0, 0.85);
        color: #fff;
        font-size: 12px;
        font-family: system-ui, -apple-system, sans-serif;
        border-radius: 4px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
      }

      .connection-indicator-top-left .connection-indicator-tooltip,
      .connection-indicator-bottom-left .connection-indicator-tooltip {
        right: auto;
        left: 100%;
        margin-right: 0;
        margin-left: 8px;
      }

      .connection-indicator-tooltip.visible {
        opacity: 1;
      }

      .connection-indicator-tooltip-label {
        font-weight: 500;
      }

      .connection-indicator-tooltip-details {
        margin-top: 2px;
        font-size: 10px;
        color: #aaa;
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Handle connection quality state change.
   * @param {{state: string, latencyMs: number, pendingRetries: number}} stateInfo - Current state info
   */
  handleStateChange(stateInfo) {
    const { state, latencyMs, pendingRetries } = stateInfo;

    // Track first connection
    if (state === ConnectionState.HEALTHY && !this.hasEverConnected) {
      this.hasEverConnected = true;
    }

    // Don't show indicator until first connection
    if (!this.hasEverConnected) {
      return;
    }

    // Update visibility
    if (this.options.hideWhenHealthy && state === ConnectionState.HEALTHY) {
      this.hide();
      return;
    }

    this.show();
    this.currentState = state;

    // Update dot color and animation
    const color = this.colors[state] || this.colors[ConnectionState.HEALTHY];
    this.dot.style.backgroundColor = color;

    // Remove all animation classes
    this.dot.classList.remove('pulse', 'spinner');

    // Add appropriate animation
    if (state === ConnectionState.RECONNECTING) {
      this.dot.classList.add('spinner');
      this.dot.style.borderTopColor = color;
    } else if (state === ConnectionState.UNSTABLE) {
      this.dot.classList.add('pulse');
    }

    // Update tooltip
    this.updateTooltip(state, latencyMs, pendingRetries);

    // Update aria-label for accessibility
    this.container.setAttribute('aria-label', this.getAriaLabel(state, latencyMs));
  }

  /**
   * Update the tooltip content.
   * @param {string} state - Current connection state
   * @param {number} latencyMs - Current latency in milliseconds
   * @param {number} pendingRetries - Number of pending message retries
   */
  updateTooltip(state, latencyMs, pendingRetries) {
    // "Slow" is only true when latency is high; a degraded state caused by
    // unacknowledged messages at low latency is labelled by its cause.
    const label = state === ConnectionState.DEGRADED && latencyMs <= 200 && pendingRetries > 0
      ? 'Retrying Messages'
      : (this.stateLabels[state] || 'Unknown');
    let html = `<div class="connection-indicator-tooltip-label">${label}</div>`;

    if (this.options.showLatency || state !== ConnectionState.HEALTHY) {
      const details = [];
      if (latencyMs > 0) {
        details.push(`${latencyMs}ms`);
      }
      if (pendingRetries > 0) {
        details.push(`${pendingRetries} ${pendingRetries === 1 ? 'retry' : 'retries'}`);
      }
      if (details.length > 0) {
        html += `<div class="connection-indicator-tooltip-details">${details.join(' | ')}</div>`;
      }
    }

    this.tooltip.innerHTML = html;
  }

  /**
   * Get aria-label for accessibility.
   * @param {string} state - Current connection state
   * @param {number} latencyMs - Current latency
   * @returns {string} Aria label text
   */
  getAriaLabel(state, latencyMs) {
    const label = this.stateLabels[state] || 'Unknown';
    if (latencyMs > 0 && state === ConnectionState.HEALTHY) {
      return `${label}, latency ${latencyMs} milliseconds`;
    }
    return label;
  }

  /**
   * Show the indicator.
   */
  show() {
    if (this.visible) return;

    if (!this.container.parentElement) {
      document.body.appendChild(this.container);
    }
    this.container.style.display = 'flex';
    this.visible = true;
  }

  /**
   * Hide the indicator.
   */
  hide() {
    if (!this.visible) return;

    this.container.style.display = 'none';
    this.visible = false;
  }

  /**
   * Force update the indicator with current state.
   * Useful when first showing the indicator.
   */
  refresh() {
    const stateInfo = this.qualityManager.getState();
    this.handleStateChange(stateInfo);
  }

  /**
   * Check if the indicator is currently visible.
   * @returns {boolean} True if visible
   */
  isVisible() {
    return this.visible;
  }

  /**
   * Clean up resources and remove from DOM.
   */
  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }

    this.container = null;
    this.dot = null;
    this.tooltip = null;
    this.visible = false;
  }
}

export default ConnectionIndicatorDOM;
