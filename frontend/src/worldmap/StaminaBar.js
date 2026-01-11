/**
 * StaminaBar - Displays stamina info for world map travel
 * Medieval-styled UI component with progress bar and regen timer
 */

export class StaminaBar {
  constructor() {
    // Stamina state
    this.current = 0;
    this.max = 8;
    this.nextRegenAt = null;
    this.regenIntervalSeconds = 120; // 2 minutes

    // Position and size
    this.x = 20;
    this.y = 120; // Below party info
    this.width = 180;
    this.height = 50;

    // Animation
    this.displayCurrent = 0; // For smooth animation
    this.animationSpeed = 5; // Points per second
  }

  /**
   * Update stamina from API response
   * @param {Object} staminaInfo - {current, max, nextRegenAt, regenIntervalSeconds}
   */
  setStamina(staminaInfo) {
    if (!staminaInfo) return;

    this.current = staminaInfo.current ?? this.current;
    this.max = staminaInfo.max ?? this.max;
    this.nextRegenAt = staminaInfo.nextRegenAt ? new Date(staminaInfo.nextRegenAt) : null;
    this.regenIntervalSeconds = staminaInfo.regenIntervalSeconds ?? this.regenIntervalSeconds;
  }

  /**
   * Update animation state
   * @param {number} deltaTime - Time in ms
   */
  update(deltaTime) {
    // Smooth animation towards current value
    const diff = this.current - this.displayCurrent;
    if (Math.abs(diff) > 0.01) {
      const change = Math.sign(diff) * Math.min(Math.abs(diff), this.animationSpeed * deltaTime / 1000);
      this.displayCurrent += change;
    } else {
      this.displayCurrent = this.current;
    }

    // Check if regeneration should have occurred
    if (this.nextRegenAt && this.current < this.max) {
      const now = new Date();
      if (now >= this.nextRegenAt) {
        // Regen happened, increment and recalculate next regen
        this.current = Math.min(this.max, this.current + 1);
        if (this.current < this.max) {
          this.nextRegenAt = new Date(now.getTime() + this.regenIntervalSeconds * 1000);
        } else {
          this.nextRegenAt = null;
        }
      }
    }
  }

  /**
   * Get time until next regen in seconds
   * @returns {number|null}
   */
  getSecondsUntilRegen() {
    if (!this.nextRegenAt || this.current >= this.max) return null;
    const now = new Date();
    const diff = (this.nextRegenAt.getTime() - now.getTime()) / 1000;
    return Math.max(0, Math.round(diff));
  }

  /**
   * Format time for display
   * @param {number} seconds
   * @returns {string}
   */
  formatTime(seconds) {
    if (seconds === null) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  }

  /**
   * Render the stamina bar
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    const { x, y, width, height } = this;

    ctx.save();

    // Draw container background (parchment style)
    ctx.fillStyle = 'rgba(60, 45, 30, 0.85)';
    ctx.strokeStyle = '#8b7355';
    ctx.lineWidth = 2;

    // Rounded rectangle
    const radius = 8;
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

    // Inner border for depth
    ctx.strokeStyle = 'rgba(139, 115, 85, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + radius + 2, y + 2);
    ctx.lineTo(x + width - radius - 2, y + 2);
    ctx.stroke();

    // Stamina label
    ctx.fillStyle = '#c4a574';
    ctx.font = 'bold 12px serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Stamina', x + 10, y + 8);

    // Stamina value
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 14px serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.floor(this.displayCurrent)}/${this.max}`, x + width - 10, y + 6);

    // Progress bar background
    const barX = x + 10;
    const barY = y + 26;
    const barWidth = width - 20;
    const barHeight = 12;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // Progress bar border
    ctx.strokeStyle = '#5a4a3a';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);

    // Progress bar fill
    const fillWidth = (this.displayCurrent / this.max) * barWidth;
    const gradient = ctx.createLinearGradient(barX, barY, barX, barY + barHeight);
    gradient.addColorStop(0, '#ffd700');
    gradient.addColorStop(0.5, '#daa520');
    gradient.addColorStop(1, '#b8860b');
    ctx.fillStyle = gradient;
    ctx.fillRect(barX + 1, barY + 1, Math.max(0, fillWidth - 2), barHeight - 2);

    // Progress bar segments (visual divisions)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1;
    for (let i = 1; i < this.max; i++) {
      const segX = barX + (i / this.max) * barWidth;
      ctx.beginPath();
      ctx.moveTo(segX, barY);
      ctx.lineTo(segX, barY + barHeight);
      ctx.stroke();
    }

    // Regen timer
    const secondsUntilRegen = this.getSecondsUntilRegen();
    if (secondsUntilRegen !== null) {
      ctx.fillStyle = '#8a9a6a';
      ctx.font = '11px serif';
      ctx.textAlign = 'center';
      ctx.fillText(`+1 in ${this.formatTime(secondsUntilRegen)}`, x + width / 2, y + height - 10);
    } else if (this.current >= this.max) {
      ctx.fillStyle = '#6a8a6a';
      ctx.font = '11px serif';
      ctx.textAlign = 'center';
      ctx.fillText('Full', x + width / 2, y + height - 10);
    }

    ctx.restore();
  }
}
