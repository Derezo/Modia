/**
 * StaminaBar - Displays stamina info for world map travel
 * Medieval-styled UI component with progress bar and regen timer
 */

export class StaminaBar {
  constructor() {
    // Stamina state
    this.current = 8;
    this.max = 8;
    this.nextRegenAt = null;
    this.regenIntervalSeconds = 120; // 2 minutes

    // Position and size
    this.x = 10;
    this.y = 70; // Below player info panel
    this.width = 160;
    this.height = 34; // Compact - no timer text

    // Animation
    this.displayCurrent = 8; // For smooth animation - start at max
    this.animationSpeed = 8; // Points per second
  }

  /**
   * Update stamina from API response
   * @param {Object} staminaInfo - {current, max, nextRegenAt, regenIntervalSeconds}
   * @param {boolean} instant - If true, skip animation and show immediately
   */
  setStamina(staminaInfo, instant = false) {
    if (!staminaInfo) return;

    const isFirstLoad = this.current === this.max && this.displayCurrent === this.max;
    // Clamp to 0 minimum in case server returns negative (safety net)
    this.current = Math.max(0, staminaInfo.current ?? this.current);
    this.max = staminaInfo.max ?? this.max;
    this.nextRegenAt = staminaInfo.nextRegenAt ? new Date(staminaInfo.nextRegenAt) : null;
    this.regenIntervalSeconds = staminaInfo.regenIntervalSeconds ?? this.regenIntervalSeconds;

    // On first load or if instant, set display to match current immediately
    if (isFirstLoad || instant) {
      this.displayCurrent = this.current;
    }
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

    // Check if regeneration should have occurred (client-side prediction)
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
   * Get regen progress (0-1) for visual display
   * @returns {number}
   */
  getRegenProgress() {
    if (!this.nextRegenAt || this.current >= this.max) return 0;
    const now = new Date();
    const msUntilRegen = this.nextRegenAt.getTime() - now.getTime();
    const totalMs = this.regenIntervalSeconds * 1000;
    const elapsed = totalMs - msUntilRegen;
    return Math.max(0, Math.min(1, elapsed / totalMs));
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

    // Stamina label
    ctx.fillStyle = '#c4a574';
    ctx.font = 'bold 11px serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Stamina', x + 8, y + 5);

    // Stamina value
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 12px serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.floor(this.displayCurrent)}/${this.max}`, x + width - 8, y + 4);

    // Progress bar
    const barX = x + 8;
    const barY = y + 20;
    const barWidth = width - 16;
    const barHeight = 10;
    const segmentWidth = barWidth / this.max;

    // Progress bar background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // Progress bar border
    ctx.strokeStyle = '#5a4a3a';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);

    // Create gradient for filled segments
    const filledGradient = ctx.createLinearGradient(barX, barY, barX, barY + barHeight);
    filledGradient.addColorStop(0, '#ffd700');
    filledGradient.addColorStop(0.5, '#daa520');
    filledGradient.addColorStop(1, '#b8860b');

    // Draw filled segments (current stamina)
    const filledSegments = Math.floor(this.displayCurrent);
    if (filledSegments > 0) {
      ctx.fillStyle = filledGradient;
      ctx.fillRect(barX + 1, barY + 1, filledSegments * segmentWidth - 2, barHeight - 2);
    }

    // Draw regenerating segment progress (if regenerating)
    const regenProgress = this.getRegenProgress();
    if (regenProgress > 0 && this.current < this.max) {
      const regenSegmentX = barX + this.current * segmentWidth;
      const regenFillWidth = regenProgress * segmentWidth;

      // Dimmer gradient for regenerating portion
      const regenGradient = ctx.createLinearGradient(barX, barY, barX, barY + barHeight);
      regenGradient.addColorStop(0, 'rgba(255, 215, 0, 0.4)');
      regenGradient.addColorStop(0.5, 'rgba(218, 165, 32, 0.4)');
      regenGradient.addColorStop(1, 'rgba(184, 134, 11, 0.4)');

      ctx.fillStyle = regenGradient;
      ctx.fillRect(regenSegmentX + 1, barY + 1, Math.max(0, regenFillWidth - 1), barHeight - 2);
    }

    // Draw segment dividers
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1;
    for (let i = 1; i < this.max; i++) {
      const segX = barX + i * segmentWidth;
      ctx.beginPath();
      ctx.moveTo(segX, barY);
      ctx.lineTo(segX, barY + barHeight);
      ctx.stroke();
    }

    ctx.restore();
  }
}
