/**
 * ZodiacSegment - Renders the zodiac crystal collection indicator in the World Map HUD
 *
 * Displays 12 crystal dots showing collection progress.
 * Collected crystals glow gold with ambient pulse.
 * New crystal collections trigger a pulse animation.
 *
 * Structure (36px height):
 * +--------------------------------+
 * | [*] 7/12   Zodiac Crystals    |  <- 18px header with star icon
 * | [******* - - - - -]            |  <- 18px crystal dot row
 * +--------------------------------+
 *
 * Does NOT draw its own background - that's handled by WorldMapHUDPanel.
 */

import { HUD_COLORS } from '../../ui/parchment/ParchmentTheme.js';

/** Total number of zodiac crystals */
const TOTAL_CRYSTALS = 12;

/** Crystal dot diameter in pixels */
const DOT_DIAMETER = 6;

/** Spacing between crystal dots in pixels */
const DOT_SPACING = 8;

/** Duration of new crystal pulse animation in ms */
const PULSE_DURATION = 500;

/** Duration of ambient glow cycle in ms */
const AMBIENT_GLOW_CYCLE = 2000;

/** Two times PI for circle calculations */
const TWO_PI = Math.PI * 2;

export class ZodiacSegment {
  constructor() {
    // Collection state
    this.collected = 0;
    this.total = TOTAL_CRYSTALS;
    this.collectionComplete = false;

    // Animation state for new crystal notification
    this.newCrystalAnim = {
      active: false,
      dotIndex: -1,
      phase: 0 // 0-1 progress through animation
    };

    // Ambient glow phase (0 to 2*PI)
    this.glowPhase = 0;

    // Click handler reference
    this.onClick = null;

    // Bounds for hit detection (set during render)
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
  }

  /**
   * Update collection data from API response
   * @param {Object} data - { totalCollected, collectionComplete }
   */
  setCollection(data) {
    if (!data) return;

    const prevCollected = this.collected;
    this.collected = data.totalCollected ?? this.collected;
    this.total = TOTAL_CRYSTALS;
    this.collectionComplete = data.collectionComplete ?? false;

    // Trigger pulse animation if new crystal was collected
    if (this.collected > prevCollected && prevCollected > 0) {
      this.newCrystalAnim = {
        active: true,
        dotIndex: this.collected - 1, // Zero-indexed
        phase: 0
      };

      // Store flag in sessionStorage for cross-scene notification
      sessionStorage.setItem('zodiac_new_crystal', 'true');
    }
  }

  /**
   * Check for and clear the new crystal notification flag
   */
  checkNewCrystalFlag() {
    const flag = sessionStorage.getItem('zodiac_new_crystal');
    if (flag === 'true') {
      this.newCrystalAnim = {
        active: true,
        dotIndex: Math.max(0, this.collected - 1),
        phase: 0
      };
      sessionStorage.removeItem('zodiac_new_crystal');
    }
  }

  /**
   * Set click handler for opening the modal
   * @param {Function} handler - () => void
   */
  setClickHandler(handler) {
    this.onClick = handler;
  }

  /**
   * Check if point is within segment bounds
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {boolean}
   */
  containsPoint(x, y) {
    const { x: bx, y: by, width, height } = this.bounds;
    return x >= bx && x <= bx + width && y >= by && y <= by + height;
  }

  /**
   * Handle click event
   */
  handleClick() {
    if (this.onClick) {
      this.onClick();
    }
    // Clear animation on click (user has seen the collection)
    this.newCrystalAnim.active = false;
  }

  /**
   * Update animation state
   * @param {number} deltaTime - Time in milliseconds
   */
  update(deltaTime) {
    // Update ambient glow phase (2 second cycle)
    this.glowPhase += (deltaTime / AMBIENT_GLOW_CYCLE) * TWO_PI;
    if (this.glowPhase >= TWO_PI) {
      this.glowPhase -= TWO_PI;
    }

    // Update new crystal pulse animation
    if (this.newCrystalAnim.active) {
      this.newCrystalAnim.phase += deltaTime / PULSE_DURATION;

      if (this.newCrystalAnim.phase >= 1) {
        this.newCrystalAnim.active = false;
        this.newCrystalAnim.phase = 0;
      }
    }
  }

  /**
   * Render the zodiac segment
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Left position
   * @param {number} y - Top position
   * @param {number} width - Available width
   */
  render(ctx, x, y, width) {
    const height = 36;

    // Store bounds for hit detection
    this.bounds = { x, y, width, height };

    ctx.save();

    // ========== Header Row (18px) ==========
    const headerY = y + 9; // Vertically centered in top 18px

    // Star icon
    ctx.fillStyle = this.collectionComplete ? HUD_COLORS.zodiac.collected : '#c4a574';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u2726', x + 4, headerY); // Four-pointed star

    // Collection count
    ctx.font = 'bold 11px serif';
    const countText = `${this.collected}/${this.total}`;

    // Draw text outline for readability
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeText(countText, x + 18, headerY);

    // Draw text fill
    ctx.fillStyle = this.collectionComplete ? HUD_COLORS.zodiac.collected : '#c4a574';
    ctx.fillText(countText, x + 18, headerY);

    // Label text
    ctx.font = '10px serif';
    ctx.fillStyle = '#a08565';
    ctx.textAlign = 'right';
    ctx.fillText('Zodiac Crystals', x + width - 4, headerY);

    // ========== Crystal Dot Row (18px) ==========
    const dotRowY = y + 18 + 9; // Vertically centered in bottom 18px
    const totalDotsWidth = (TOTAL_CRYSTALS * DOT_DIAMETER) + ((TOTAL_CRYSTALS - 1) * (DOT_SPACING - DOT_DIAMETER));
    const dotsStartX = x + (width - totalDotsWidth) / 2; // Center the dots

    // Calculate ambient glow intensity (0.3 to 1.0)
    const ambientGlow = 0.65 + 0.35 * Math.sin(this.glowPhase);

    for (let i = 0; i < TOTAL_CRYSTALS; i++) {
      const dotX = dotsStartX + i * DOT_SPACING + DOT_DIAMETER / 2;
      const dotY = dotRowY;
      const isCollected = i < this.collected;
      const isAnimating = this.newCrystalAnim.active && i === this.newCrystalAnim.dotIndex;

      // Calculate scale for animation
      let scale = 1.0;
      if (isAnimating) {
        // Pulse: 1.0 -> 1.3 -> 1.0 using sine wave
        const pulsePhase = this.newCrystalAnim.phase * Math.PI;
        scale = 1.0 + 0.3 * Math.sin(pulsePhase);
      }

      const radius = (DOT_DIAMETER / 2) * scale;

      // Draw ambient glow for collected crystals
      if (isCollected && !isAnimating) {
        const glowRadius = radius + 3 * ambientGlow;
        const glowGradient = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, glowRadius);
        glowGradient.addColorStop(0, `rgba(255, 215, 0, ${0.4 * ambientGlow})`);
        glowGradient.addColorStop(1, 'rgba(255, 215, 0, 0)');

        ctx.fillStyle = glowGradient;
        ctx.beginPath();
        ctx.arc(dotX, dotY, glowRadius, 0, TWO_PI);
        ctx.fill();
      }

      // Draw pulse animation (radial expansion)
      if (isAnimating) {
        // Expanding ring that fades
        const pulseRadius = radius + 10 * this.newCrystalAnim.phase;
        const pulseAlpha = 0.8 * (1 - this.newCrystalAnim.phase);

        const pulseGradient = ctx.createRadialGradient(dotX, dotY, radius, dotX, dotY, pulseRadius);
        pulseGradient.addColorStop(0, `rgba(255, 215, 0, ${pulseAlpha})`);
        pulseGradient.addColorStop(1, 'rgba(255, 215, 0, 0)');

        ctx.fillStyle = pulseGradient;
        ctx.beginPath();
        ctx.arc(dotX, dotY, pulseRadius, 0, TWO_PI);
        ctx.fill();
      }

      // Draw the dot
      ctx.beginPath();
      ctx.arc(dotX, dotY, radius, 0, TWO_PI);

      if (isCollected) {
        // Collected: gold fill with glow
        ctx.fillStyle = HUD_COLORS.zodiac.collected;
        ctx.fill();

        // Inner highlight
        const highlightGradient = ctx.createRadialGradient(
          dotX - radius * 0.3, dotY - radius * 0.3, 0,
          dotX, dotY, radius
        );
        highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
        highlightGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
        highlightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

        ctx.fillStyle = highlightGradient;
        ctx.fill();
      } else {
        // Empty: dark outline only
        ctx.strokeStyle = HUD_COLORS.zodiac.empty;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Collection complete indicator
    if (this.collectionComplete) {
      ctx.fillStyle = HUD_COLORS.zodiac.collected;
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'left';
      ctx.fillText('\u2713', x + 52, headerY); // Checkmark after count
    }

    ctx.restore();
  }
}
