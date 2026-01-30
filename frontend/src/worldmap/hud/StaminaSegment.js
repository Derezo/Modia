/**
 * StaminaSegment - Renders the stamina bar segment for World Map HUD
 *
 * Enhanced version of StaminaBar with liquid-fill animation effects:
 * - Wave animation on filled segments (2Hz, 2px amplitude)
 * - Shimmer sweep on regenerating segment (1.5s cycle)
 * - Particle spawning on stamina gain
 *
 * Structure (40px height):
 * +--------------------------------+
 * | Stamina        [7/8] [ICON]   |  <- 16px header
 * | [====|====|====|====|  | | |] |  <- 20px segmented bar
 * | [Regen progress shimmer     ] |  <- 4px regen indicator
 * +--------------------------------+
 *
 * @module StaminaSegment
 */

import { HUD_COLORS } from '../../ui/parchment/ParchmentTheme.js';

/** Header row height in pixels */
const HEADER_HEIGHT = 16;

/** Segmented bar height in pixels */
const BAR_HEIGHT = 20;

/** Regen indicator height in pixels */
const REGEN_INDICATOR_HEIGHT = 4;

/** Wave animation frequency in Hz */
const WAVE_FREQUENCY = 2;

/** Wave amplitude in pixels */
const WAVE_AMPLITUDE = 2;

/** Shimmer sweep cycle duration in seconds */
const SHIMMER_CYCLE = 1.5;

/** Animation speed for smooth stamina transitions (points per second) */
const ANIMATION_SPEED = 8;

/** Two times PI for calculations */
const TWO_PI = Math.PI * 2;

/**
 * StaminaSegment class for rendering stamina with liquid-fill animation
 */
export class StaminaSegment {
  constructor() {
    // Stamina state
    this.current = 8;
    this.max = 8;
    this.nextRegenAt = null;
    this.regenIntervalSeconds = 120; // 2 minutes default

    // Animation state
    this.displayCurrent = 8;
    this.wavePhase = 0;
    this.shimmerPhase = 0;

    // Reference to external particle system (set by panel)
    this.particleSystem = null;

    // Track previous current for gain detection
    this.previousCurrent = 8;
  }

  /**
   * Set reference to the particle system for spawning effects
   * @param {HUDParticleSystem} particleSystem
   */
  setParticleSystem(particleSystem) {
    this.particleSystem = particleSystem;
  }

  /**
   * Update stamina from API response
   * @param {Object} staminaInfo - {current, max, nextRegenAt, regenIntervalSeconds}
   * @param {boolean} instant - If true, skip animation and show immediately
   */
  setStamina(staminaInfo, instant = false) {
    if (!staminaInfo) return;

    const isFirstLoad = this.current === this.max && this.displayCurrent === this.max;
    const oldCurrent = this.current;

    // Clamp to 0 minimum in case server returns negative (safety net)
    this.current = Math.max(0, staminaInfo.current ?? this.current);
    this.max = staminaInfo.max ?? this.max;
    this.nextRegenAt = staminaInfo.nextRegenAt ? new Date(staminaInfo.nextRegenAt) : null;
    this.regenIntervalSeconds = staminaInfo.regenIntervalSeconds ?? this.regenIntervalSeconds;

    // On first load or if instant, set display to match current immediately
    if (isFirstLoad || instant) {
      this.displayCurrent = this.current;
      this.previousCurrent = this.current;
    }

    // Track gain for particle effects (not on first load)
    if (!isFirstLoad && this.current > oldCurrent) {
      this.previousCurrent = oldCurrent;
    }
  }

  /**
   * Update animation state
   * @param {number} deltaTime - Time in milliseconds
   */
  update(deltaTime) {
    const dt = deltaTime / 1000; // Convert to seconds

    // Update wave animation phase (continuous)
    this.wavePhase += WAVE_FREQUENCY * TWO_PI * dt;
    if (this.wavePhase > TWO_PI) {
      this.wavePhase -= TWO_PI;
    }

    // Update shimmer animation phase (continuous)
    this.shimmerPhase += dt / SHIMMER_CYCLE;
    if (this.shimmerPhase > 1) {
      this.shimmerPhase -= 1;
    }

    // Smooth animation towards current value
    const diff = this.current - this.displayCurrent;
    if (Math.abs(diff) > 0.01) {
      const change = Math.sign(diff) * Math.min(Math.abs(diff), ANIMATION_SPEED * dt);
      this.displayCurrent += change;
    } else {
      this.displayCurrent = this.current;
    }

    // Check if regeneration should have occurred (client-side prediction)
    if (this.nextRegenAt && this.current < this.max) {
      const now = new Date();
      if (now >= this.nextRegenAt) {
        // Regen happened, increment and recalculate next regen
        this.previousCurrent = this.current;
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
   * Render the stamina segment
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Left edge X position
   * @param {number} y - Top edge Y position
   * @param {number} width - Available width
   */
  render(ctx, x, y, width) {
    ctx.save();

    // Render header row
    this.renderHeader(ctx, x, y, width);

    // Render segmented bar
    const barY = y + HEADER_HEIGHT;
    this.renderBar(ctx, x, barY, width);

    // Render regen indicator
    const regenY = barY + BAR_HEIGHT;
    this.renderRegenIndicator(ctx, x, regenY, width);

    ctx.restore();
  }

  /**
   * Render the header row with label and value
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Left edge X
   * @param {number} y - Top edge Y
   * @param {number} width - Available width
   */
  renderHeader(ctx, x, y, width) {
    // Stamina label
    ctx.fillStyle = '#c4a574';
    ctx.font = 'bold 11px serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Stamina', x + 4, y + 2);

    // Stamina value with outline for readability
    ctx.font = 'bold 12px serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    const staminaText = `${Math.floor(this.displayCurrent)}/${this.max}`;

    // Draw outline
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeText(staminaText, x + width - 4, y + 1);

    // Draw fill with gold color
    ctx.fillStyle = HUD_COLORS.stamina.full;
    ctx.fillText(staminaText, x + width - 4, y + 1);
  }

  /**
   * Render the segmented stamina bar with liquid-fill effect
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Left edge X
   * @param {number} y - Top edge Y
   * @param {number} width - Available width
   */
  renderBar(ctx, x, y, width) {
    const barWidth = width - 8; // Padding on sides
    const barX = x + 4;
    const segmentWidth = barWidth / this.max;
    const segmentGap = 2; // Gap between segments

    // Bar background (empty state)
    ctx.fillStyle = HUD_COLORS.stamina.empty;
    ctx.fillRect(barX, y, barWidth, BAR_HEIGHT);

    // Render each segment
    const filledSegments = Math.floor(this.displayCurrent);
    const partialFill = this.displayCurrent - filledSegments;

    for (let i = 0; i < this.max; i++) {
      const segX = barX + i * segmentWidth;
      const innerWidth = segmentWidth - segmentGap;

      if (i < filledSegments) {
        // Fully filled segment with liquid animation
        this.renderFilledSegment(ctx, segX, y, innerWidth, BAR_HEIGHT, 1);
      } else if (i === filledSegments && partialFill > 0.01) {
        // Partially filled segment (animating)
        this.renderFilledSegment(ctx, segX, y, innerWidth, BAR_HEIGHT, partialFill);
      } else if (i === this.current && this.current < this.max) {
        // Regenerating segment
        const regenProgress = this.getRegenProgress();
        if (regenProgress > 0) {
          this.renderRegenSegment(ctx, segX, y, innerWidth, BAR_HEIGHT, regenProgress);
        }
      }

      // Segment divider (subtle)
      if (i < this.max - 1) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(segX + innerWidth, y, segmentGap, BAR_HEIGHT);
      }
    }

    // Bar border
    ctx.strokeStyle = '#5a4a3a';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, y, barWidth, BAR_HEIGHT);

    // Spawn particles on stamina gain
    this.checkAndSpawnGainParticles(barX, y, segmentWidth);
  }

  /**
   * Render a filled segment with liquid wave effect
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Segment X
   * @param {number} y - Segment Y
   * @param {number} width - Segment width
   * @param {number} height - Segment height
   * @param {number} fillAmount - Fill amount (0-1)
   */
  renderFilledSegment(ctx, x, y, width, height, fillAmount) {
    ctx.save();

    // Clip to segment bounds
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    // Calculate fill from bottom
    const fillHeight = height * fillAmount;
    const fillY = y + height - fillHeight;

    // Create layered gradient for depth
    const gradient = ctx.createLinearGradient(x, fillY, x, y + height);
    gradient.addColorStop(0, HUD_COLORS.stamina.full);
    gradient.addColorStop(0.4, HUD_COLORS.stamina.mid);
    gradient.addColorStop(1, HUD_COLORS.stamina.low);

    // Draw base fill
    ctx.fillStyle = gradient;
    ctx.fillRect(x, fillY, width, fillHeight);

    // Draw wave effect at the fill edge
    if (fillAmount < 1 && fillAmount > 0.1) {
      this.renderWaveEdge(ctx, x, fillY, width);
    }

    // Add highlight for 3D effect
    const highlightGradient = ctx.createLinearGradient(x, y, x + width, y);
    highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    highlightGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
    highlightGradient.addColorStop(1, 'rgba(0, 0, 0, 0.1)');
    ctx.fillStyle = highlightGradient;
    ctx.fillRect(x, fillY, width, fillHeight);

    // Inner glow at top of liquid
    if (fillAmount > 0.2) {
      const glowGradient = ctx.createLinearGradient(x, fillY, x, fillY + 4);
      glowGradient.addColorStop(0, HUD_COLORS.stamina.wave);
      glowGradient.addColorStop(1, 'rgba(255, 223, 128, 0)');
      ctx.fillStyle = glowGradient;
      ctx.fillRect(x, fillY, width, 4);
    }

    ctx.restore();
  }

  /**
   * Render wave effect at the liquid fill edge
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Start X
   * @param {number} y - Fill edge Y
   * @param {number} width - Segment width
   */
  renderWaveEdge(ctx, x, y, width) {
    ctx.beginPath();
    ctx.moveTo(x, y);

    // Draw wavy line across the top of the fill
    const steps = Math.ceil(width / 2);
    for (let i = 0; i <= steps; i++) {
      const px = x + (i / steps) * width;
      // Phase offset based on position for traveling wave effect
      const waveOffset = (i / steps) * Math.PI * 2;
      const py = y + Math.sin(this.wavePhase + waveOffset) * WAVE_AMPLITUDE;
      ctx.lineTo(px, py);
    }

    // Complete the shape to fill below the wave
    ctx.lineTo(x + width, y + WAVE_AMPLITUDE + 4);
    ctx.lineTo(x, y + WAVE_AMPLITUDE + 4);
    ctx.closePath();

    // Fill with wave highlight color
    ctx.fillStyle = HUD_COLORS.stamina.wave;
    ctx.fill();
  }

  /**
   * Render regenerating segment with shimmer effect
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Segment X
   * @param {number} y - Segment Y
   * @param {number} width - Segment width
   * @param {number} height - Segment height
   * @param {number} progress - Regen progress (0-1)
   */
  renderRegenSegment(ctx, x, y, width, height, progress) {
    ctx.save();

    // Clip to segment bounds
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    // Calculate fill from bottom
    const fillHeight = height * progress;
    const fillY = y + height - fillHeight;

    // Dimmer gradient for regenerating portion
    const gradient = ctx.createLinearGradient(x, fillY, x, y + height);
    gradient.addColorStop(0, 'rgba(255, 215, 0, 0.4)');
    gradient.addColorStop(0.5, 'rgba(218, 165, 32, 0.35)');
    gradient.addColorStop(1, 'rgba(184, 134, 11, 0.3)');

    ctx.fillStyle = gradient;
    ctx.fillRect(x, fillY, width, fillHeight);

    // Shimmer sweep effect
    this.renderShimmerSweep(ctx, x, fillY, width, fillHeight);

    ctx.restore();
  }

  /**
   * Render shimmer sweep animation
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Start X
   * @param {number} y - Start Y
   * @param {number} width - Area width
   * @param {number} height - Area height
   */
  renderShimmerSweep(ctx, x, y, width, height) {
    // Shimmer position based on phase
    const shimmerWidth = width * 0.6;
    const shimmerX = x - shimmerWidth + (width + shimmerWidth * 2) * this.shimmerPhase;

    // Create shimmer gradient
    const shimmerGradient = ctx.createLinearGradient(shimmerX, y, shimmerX + shimmerWidth, y);
    shimmerGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    shimmerGradient.addColorStop(0.5, HUD_COLORS.stamina.shimmer);
    shimmerGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    ctx.fillStyle = shimmerGradient;
    ctx.fillRect(x, y, width, height);
  }

  /**
   * Render the regen indicator bar at the bottom
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Left edge X
   * @param {number} y - Top edge Y
   * @param {number} width - Available width
   */
  renderRegenIndicator(ctx, x, y, width) {
    const barWidth = width - 8;
    const barX = x + 4;

    if (this.current >= this.max) {
      // Full stamina - no indicator needed, just subtle line
      ctx.fillStyle = 'rgba(139, 115, 85, 0.2)';
      ctx.fillRect(barX, y, barWidth, REGEN_INDICATOR_HEIGHT);
      return;
    }

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(barX, y, barWidth, REGEN_INDICATOR_HEIGHT);

    // Progress fill
    const progress = this.getRegenProgress();
    if (progress > 0) {
      const progressWidth = barWidth * progress;
      const progressGradient = ctx.createLinearGradient(barX, y, barX + progressWidth, y);
      progressGradient.addColorStop(0, 'rgba(255, 215, 0, 0.6)');
      progressGradient.addColorStop(1, 'rgba(255, 215, 0, 0.3)');

      ctx.fillStyle = progressGradient;
      ctx.fillRect(barX, y, progressWidth, REGEN_INDICATOR_HEIGHT);

      // Shimmer on progress bar
      const shimmerX = barX + progressWidth * this.shimmerPhase;
      const shimmerGrad = ctx.createLinearGradient(shimmerX - 10, y, shimmerX + 10, y);
      shimmerGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      shimmerGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
      shimmerGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');

      ctx.fillStyle = shimmerGrad;
      ctx.fillRect(barX, y, progressWidth, REGEN_INDICATOR_HEIGHT);
    }

    // Border
    ctx.strokeStyle = 'rgba(90, 74, 58, 0.5)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(barX, y, barWidth, REGEN_INDICATOR_HEIGHT);
  }

  /**
   * Check if stamina was gained and spawn particles at fill edge
   * @param {number} barX - Bar start X
   * @param {number} barY - Bar Y
   * @param {number} segmentWidth - Width of each segment
   */
  checkAndSpawnGainParticles(barX, barY, segmentWidth) {
    if (!this.particleSystem) return;

    // Check if display has caught up and we had a gain
    if (this.previousCurrent < this.current &&
        Math.abs(this.displayCurrent - this.current) < 0.1) {
      // Spawn particles at the new filled segment edge
      const filledSegments = Math.floor(this.current);
      const particleX = barX + (filledSegments - 0.5) * segmentWidth;
      const particleY = barY + BAR_HEIGHT * 0.5;

      this.particleSystem.spawnGoldSparkle(particleX, particleY, 5);

      // Reset previous to current to prevent re-triggering
      this.previousCurrent = this.current;
    }
  }

  /**
   * Get the total height of this segment
   * @returns {number}
   */
  getHeight() {
    return HEADER_HEIGHT + BAR_HEIGHT + REGEN_INDICATOR_HEIGHT;
  }
}

export default StaminaSegment;
