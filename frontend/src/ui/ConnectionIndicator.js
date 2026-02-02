/**
 * @module ConnectionIndicator
 * @description Visual indicator for WebSocket connection quality.
 *
 * Rendered as a small dot with optional tooltip in battle HUD.
 * Shows connection state through color and animation:
 * - Green dot: Healthy connection
 * - Yellow dot: Degraded connection (high latency or minor retries)
 * - Orange pulsing dot: Unstable connection
 * - Red dot: Disconnected
 * - Gray spinner: Reconnecting
 *
 * @see connectionQuality.js - Connection state manager
 * @see BattleScene.js - Primary consumer
 */

import { ConnectionState } from '../api/connectionQuality.js';

/**
 * Visual indicator for WebSocket connection quality.
 */
export class ConnectionIndicator {
  /**
   * Create a connection indicator.
   * @param {import('../api/connectionQuality.js').ConnectionQualityManager} qualityManager - Connection quality manager instance
   */
  constructor(qualityManager) {
    this.qualityManager = qualityManager;
    this.x = 0;
    this.y = 0;
    this.radius = 6;
    this.showTooltip = false;
    this.tooltipHoverTime = 0;

    // Animation state
    this.pulsePhase = 0;
    this.spinnerAngle = 0;

    // Colors for each state
    this.colors = {
      [ConnectionState.HEALTHY]: '#22c55e',      // Green
      [ConnectionState.DEGRADED]: '#eab308',     // Yellow
      [ConnectionState.UNSTABLE]: '#f97316',     // Orange
      [ConnectionState.DISCONNECTED]: '#ef4444', // Red
      [ConnectionState.RECONNECTING]: '#9ca3af'  // Gray (spinner)
    };

    // State labels for tooltip
    this.stateLabels = {
      [ConnectionState.HEALTHY]: 'Connected',
      [ConnectionState.DEGRADED]: 'Slow Connection',
      [ConnectionState.UNSTABLE]: 'Unstable Connection',
      [ConnectionState.DISCONNECTED]: 'Disconnected',
      [ConnectionState.RECONNECTING]: 'Reconnecting...'
    };

    // Subscribe to state changes
    this.unsubscribe = this.qualityManager.onChange(() => {
      // State changed - will be reflected in next render
    });
  }

  /**
   * Set indicator position.
   * @param {number} x - X coordinate (typically top-right of battle HUD)
   * @param {number} y - Y coordinate
   */
  setPosition(x, y) {
    this.x = x;
    this.y = y;
  }

  /**
   * Update animations.
   * @param {number} deltaTime - Time since last update in milliseconds
   */
  update(deltaTime) {
    const dt = deltaTime / 1000; // Convert to seconds

    // Pulse animation for unstable state
    this.pulsePhase += dt * 4; // 4 cycles per second
    if (this.pulsePhase > Math.PI * 2) {
      this.pulsePhase -= Math.PI * 2;
    }

    // Spinner rotation for reconnecting state
    this.spinnerAngle += dt * 6; // ~1 rotation per second
    if (this.spinnerAngle > Math.PI * 2) {
      this.spinnerAngle -= Math.PI * 2;
    }
  }

  /**
   * Render the indicator.
   * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
   */
  render(ctx) {
    const { state, latencyMs, pendingRetries } = this.qualityManager.getState();
    const color = this.colors[state] || this.colors[ConnectionState.HEALTHY];

    ctx.save();

    if (state === ConnectionState.RECONNECTING) {
      this.renderSpinner(ctx, color);
    } else if (state === ConnectionState.UNSTABLE) {
      this.renderPulsingDot(ctx, color);
    } else {
      this.renderDot(ctx, color);
    }

    // Render tooltip if hovered
    if (this.showTooltip) {
      this.renderTooltip(ctx, state, latencyMs, pendingRetries);
    }

    ctx.restore();
  }

  /**
   * Render a static dot.
   * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
   * @param {string} color - Fill color
   */
  renderDot(ctx, color) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Subtle border
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /**
   * Render a pulsing dot for unstable state.
   * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
   * @param {string} color - Fill color
   */
  renderPulsingDot(ctx, color) {
    const scale = 1 + Math.sin(this.pulsePhase) * 0.3; // Pulse between 0.7x and 1.3x
    const alpha = 0.7 + Math.sin(this.pulsePhase) * 0.3; // Fade between 0.4 and 1.0

    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * scale, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /**
   * Render a spinning arc for reconnecting state.
   * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
   * @param {string} color - Stroke color
   */
  renderSpinner(ctx, color) {
    const arcLength = Math.PI * 0.75; // 3/4 of a circle

    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, this.spinnerAngle, this.spinnerAngle + arcLength);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  /**
   * Render tooltip with connection details.
   * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
   * @param {string} state - Current connection state
   * @param {number} latencyMs - Current latency in milliseconds
   * @param {number} pendingRetries - Number of pending message retries
   */
  renderTooltip(ctx, state, latencyMs, pendingRetries) {
    const label = this.stateLabels[state] || 'Unknown';
    const details = `Latency: ${latencyMs}ms | Retries: ${pendingRetries}`;

    // Position tooltip to the left of indicator
    const tooltipX = this.x - 150;
    const tooltipY = this.y - 10;
    const tooltipWidth = 140;
    const tooltipHeight = 40;

    // Background with rounded corners
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.beginPath();
    this.roundRect(ctx, tooltipX, tooltipY, tooltipWidth, tooltipHeight, 4);
    ctx.fill();

    // State label text
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, tooltipX + 8, tooltipY + 6);

    // Details text (muted)
    ctx.fillStyle = '#aaa';
    ctx.font = '10px sans-serif';
    ctx.fillText(details, tooltipX + 8, tooltipY + 22);
  }

  /**
   * Helper to draw a rounded rectangle path.
   * Uses native roundRect if available, otherwise fallback.
   * @param {CanvasRenderingContext2D} ctx - Canvas rendering context
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} width - Rectangle width
   * @param {number} height - Rectangle height
   * @param {number} radius - Corner radius
   */
  roundRect(ctx, x, y, width, height, radius) {
    if (ctx.roundRect) {
      ctx.roundRect(x, y, width, height, radius);
    } else {
      // Fallback for older browsers
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }
  }

  /**
   * Handle mouse move to show/hide tooltip.
   * @param {number} x - Mouse X coordinate
   * @param {number} y - Mouse Y coordinate
   */
  handleMouseMove(x, y) {
    const distance = Math.hypot(x - this.x, y - this.y);
    this.showTooltip = distance < this.radius * 3; // Larger hover area
  }

  /**
   * Handle click on the indicator.
   * @param {number} x - Click X coordinate
   * @param {number} y - Click Y coordinate
   * @returns {boolean} True if click was on the indicator
   */
  handleClick(x, y) {
    const distance = Math.hypot(x - this.x, y - this.y);
    return distance < this.radius * 2;
  }

  /**
   * Clean up resources and unsubscribe from state changes.
   */
  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}

export default ConnectionIndicator;
