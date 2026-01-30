/**
 * TravelSegment - Renders travel progress segment for World Map HUD panel
 *
 * Features:
 * - Slide-in/out animation when travel starts/ends (200ms)
 * - Destination name with truncation and ellipsis
 * - Progress bar with gradient fill and percentage
 * - Does NOT draw its own background (handled by WorldMapHUDPanel)
 *
 * Structure (30px height):
 * +--------------------------------+
 * | -> Greenwood Village           |  <- 14px destination
 * | [=========>           ] 45%    |  <- 16px progress bar
 * +--------------------------------+
 */
import { HUD_COLORS } from '../../ui/parchment/ParchmentTheme.js';

/** Segment height when fully visible */
const SEGMENT_HEIGHT = 30;

/** Animation duration in milliseconds */
const SLIDE_DURATION = 200;

/**
 * Cubic bezier easing function: ease-out (0.4, 0, 0.2, 1)
 * @param {number} t - Progress 0-1
 * @returns {number} Eased value 0-1
 */
function easeOutCubic(t) {
  // Approximation of cubic-bezier(0.4, 0, 0.2, 1)
  // This is a standard Material Design ease-out curve
  return 1 - Math.pow(1 - t, 3);
}

export class TravelSegment {
  constructor() {
    // Travel state
    this.isActive = false;
    this.destination = '';
    this.progress = 0; // 0-1 travel completion
    this.startTime = 0;
    this.duration = 0;

    // Slide animation state
    this.slideProgress = 0; // 0 = hidden, 1 = visible
    this.slideDirection = 0; // 1 = sliding in, -1 = sliding out, 0 = idle
    this.slideStartTime = 0;
  }

  /**
   * Begin travel with slide-in animation
   * @param {string} destination - Name of destination node
   * @param {number} duration - Travel duration in milliseconds
   */
  startTravel(destination, duration) {
    this.isActive = true;
    this.destination = destination;
    this.duration = duration;
    this.startTime = Date.now();
    this.progress = 0;

    // Start slide-in animation
    this.slideDirection = 1;
    this.slideStartTime = Date.now();
  }

  /**
   * Mark travel as complete and trigger slide-out animation
   */
  complete() {
    this.isActive = false;
    this.progress = 1;

    // Start slide-out animation
    this.slideDirection = -1;
    this.slideStartTime = Date.now();
  }

  /**
   * Cancel travel immediately without animation
   */
  cancel() {
    this.isActive = false;
    this.progress = 0;
    this.slideProgress = 0;
    this.slideDirection = 0;
  }

  /**
   * Update travel progress and slide animation
   * @param {number} deltaTime - Time elapsed in milliseconds
   */
  update(_deltaTime) {
    // Update travel progress if actively traveling
    if (this.isActive && this.duration > 0) {
      const elapsed = Date.now() - this.startTime;
      this.progress = Math.min(1, elapsed / this.duration);
    }

    // Update slide animation
    if (this.slideDirection !== 0) {
      const elapsed = Date.now() - this.slideStartTime;
      const animProgress = Math.min(1, elapsed / SLIDE_DURATION);
      const easedProgress = easeOutCubic(animProgress);

      if (this.slideDirection === 1) {
        // Sliding in: 0 -> 1
        this.slideProgress = easedProgress;
      } else {
        // Sliding out: current -> 0
        this.slideProgress = 1 - easedProgress;
      }

      // Animation complete
      if (animProgress >= 1) {
        this.slideDirection = 0;
        if (this.slideProgress < 0.01) {
          this.slideProgress = 0;
        }
      }
    }
  }

  /**
   * Check if segment should be rendered
   * @returns {boolean} True if slideProgress > 0.01
   */
  isVisible() {
    return this.slideProgress > 0.01;
  }

  /**
   * Get current animated height
   * @returns {number} Height in pixels (0 to SEGMENT_HEIGHT)
   */
  getHeight() {
    return SEGMENT_HEIGHT * this.slideProgress;
  }

  /**
   * Render the travel segment
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {number} x - Left position
   * @param {number} y - Top position
   * @param {number} width - Available width
   */
  render(ctx, x, y, width) {
    if (!this.isVisible()) return;

    const currentHeight = this.getHeight();
    const padding = 8;
    const innerWidth = width - padding * 2;

    ctx.save();

    // Clip to current animated height to create slide effect
    ctx.beginPath();
    ctx.rect(x, y, width, currentHeight);
    ctx.clip();

    // Row 1: Destination text (top 14px)
    const destY = y + 2;
    this.renderDestination(ctx, x + padding, destY, innerWidth);

    // Row 2: Progress bar (bottom 16px)
    const barY = y + 14;
    this.renderProgressBar(ctx, x + padding, barY, innerWidth);

    ctx.restore();
  }

  /**
   * Render destination name with arrow
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {number} maxWidth
   */
  renderDestination(ctx, x, y, maxWidth) {
    ctx.fillStyle = HUD_COLORS.travel.text;
    ctx.font = 'bold 11px serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Arrow prefix
    const arrow = '\u2192 '; // Right arrow
    const arrowWidth = ctx.measureText(arrow).width;

    // Calculate max text width (leave room for arrow)
    const maxTextWidth = maxWidth - arrowWidth;

    // Truncate destination name if needed
    let displayName = this.destination;
    const textWidth = ctx.measureText(displayName).width;

    if (textWidth > maxTextWidth) {
      // Need to truncate
      while (displayName.length > 3 && ctx.measureText(displayName + '...').width > maxTextWidth) {
        displayName = displayName.slice(0, -1);
      }
      displayName += '...';
    }

    ctx.fillText(`${arrow}${displayName}`, x, y);
  }

  /**
   * Render progress bar with percentage
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x
   * @param {number} y
   * @param {number} width
   */
  renderProgressBar(ctx, x, y, width) {
    const barHeight = 8;
    const percentWidth = 32; // Space for "100%"
    const barWidth = width - percentWidth - 4;

    // Progress bar background
    ctx.fillStyle = HUD_COLORS.travel.background;
    ctx.fillRect(x, y + 2, barWidth, barHeight);

    // Progress bar border
    ctx.strokeStyle = '#5a4a3a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y + 2, barWidth, barHeight);

    // Progress bar fill with gradient
    if (this.progress > 0) {
      const fillWidth = Math.max(0, this.progress * (barWidth - 2));

      const gradient = ctx.createLinearGradient(x, y + 2, x, y + 2 + barHeight);
      gradient.addColorStop(0, '#ffd700');
      gradient.addColorStop(0.5, HUD_COLORS.travel.fill);
      gradient.addColorStop(1, '#b8860b');

      ctx.fillStyle = gradient;
      ctx.fillRect(x + 1, y + 3, fillWidth, barHeight - 2);
    }

    // Percentage text (right-aligned)
    const percent = Math.floor(this.progress * 100);
    ctx.fillStyle = HUD_COLORS.travel.text;
    ctx.font = 'bold 10px serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`${percent}%`, x + width, y + 1);
  }
}
