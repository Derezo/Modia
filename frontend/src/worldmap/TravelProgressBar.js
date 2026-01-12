/**
 * TravelProgressBar - Shows travel progress below stamina bar
 * Displays destination name and animated progress during world map travel
 */

export class TravelProgressBar {
  constructor() {
    // Position below StaminaBar (which is at y=70, height=34)
    this.x = 10;
    this.y = 110; // 70 + 34 + 6px gap
    this.width = 160;
    this.height = 24;

    // Travel state
    this.isActive = false;
    this.destination = '';
    this.progress = 0; // 0-1
    this.startTime = 0;
    this.duration = 0;

    // Visibility animation
    this.opacity = 0;
    this.fadeSpeed = 4; // Fade in/out per second
  }

  /**
   * Start showing travel progress
   * @param {string} destination - Name of destination node
   * @param {number} duration - Travel duration in ms
   */
  startTravel(destination, duration) {
    this.isActive = true;
    this.destination = destination;
    this.duration = duration;
    this.startTime = Date.now();
    this.progress = 0;
  }

  /**
   * Mark travel as complete (triggers fade out)
   */
  complete() {
    this.isActive = false;
    this.progress = 1;
  }

  /**
   * Cancel travel (immediate hide)
   */
  cancel() {
    this.isActive = false;
    this.progress = 0;
    this.opacity = 0;
  }

  /**
   * Update animation state
   * @param {number} deltaTime - Time in ms
   */
  update(deltaTime) {
    const dt = deltaTime / 1000;

    // Update progress if actively traveling
    if (this.isActive && this.duration > 0) {
      const elapsed = Date.now() - this.startTime;
      this.progress = Math.min(1, elapsed / this.duration);
    }

    // Fade in when active, fade out when complete
    const targetOpacity = this.isActive ? 1 : 0;
    if (this.opacity !== targetOpacity) {
      const diff = targetOpacity - this.opacity;
      const change = Math.sign(diff) * Math.min(Math.abs(diff), this.fadeSpeed * dt);
      this.opacity += change;
      this.opacity = Math.max(0, Math.min(1, this.opacity));
    }
  }

  /**
   * Check if bar should be rendered (has opacity)
   * @returns {boolean}
   */
  isVisible() {
    return this.opacity > 0.01;
  }

  /**
   * Render the progress bar
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (!this.isVisible()) return;

    const { x, y, width, height } = this;

    ctx.save();
    ctx.globalAlpha = this.opacity;

    // Draw container background (parchment style, matching StaminaBar)
    ctx.fillStyle = 'rgba(60, 45, 30, 0.85)';
    ctx.strokeStyle = '#8b7355';
    ctx.lineWidth = 2;

    // Rounded rectangle
    const radius = 6;
    ctx.beginPath();
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
    ctx.fill();
    ctx.stroke();

    // Travel icon (arrow) and destination name
    ctx.fillStyle = '#c4a574';
    ctx.font = 'bold 11px serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Truncate destination name if too long
    let displayName = this.destination;
    const maxTextWidth = width - 50; // Leave room for progress
    while (ctx.measureText(displayName).width > maxTextWidth && displayName.length > 3) {
      displayName = displayName.slice(0, -1);
    }
    if (displayName !== this.destination) {
      displayName += '...';
    }

    ctx.fillText(`\u2192 ${displayName}`, x + 8, y + height / 2);

    // Progress bar on right side
    const barWidth = 40;
    const barHeight = 8;
    const barX = x + width - barWidth - 8;
    const barY = y + (height - barHeight) / 2;

    // Progress bar background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // Progress bar border
    ctx.strokeStyle = '#5a4a3a';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);

    // Progress bar fill (gold gradient)
    if (this.progress > 0) {
      const fillWidth = Math.max(0, this.progress * barWidth - 2);
      const gradient = ctx.createLinearGradient(barX, barY, barX, barY + barHeight);
      gradient.addColorStop(0, '#ffd700');
      gradient.addColorStop(0.5, '#daa520');
      gradient.addColorStop(1, '#b8860b');

      ctx.fillStyle = gradient;
      ctx.fillRect(barX + 1, barY + 1, fillWidth, barHeight - 2);
    }

    ctx.restore();
  }
}
