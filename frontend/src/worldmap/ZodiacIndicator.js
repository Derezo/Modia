/**
 * ZodiacIndicator - HUD element showing zodiac crystal collection progress
 *
 * Displays a compact indicator on the world map showing how many
 * zodiac crystals have been collected out of 12. Clicking opens
 * the RelicCollectionModal.
 *
 * Renders to canvas alongside StaminaBar in the top-left area.
 */

export class ZodiacIndicator {
  constructor() {
    // Collection state
    this.collected = 0;
    this.total = 12;
    this.collectionComplete = false;

    // Position and size (below stamina bar)
    this.x = 10;
    this.y = 110; // Stamina bar is at y=70, height=34
    this.width = 100;
    this.height = 28;

    // Animation state for new crystal notification
    this.glowIntensity = 0;
    this.glowDirection = 1;
    this.showNewCrystalGlow = false;

    // Click handler reference
    this.onClick = null;
  }

  /**
   * Update collection data from API response
   * @param {Object} data - { totalCollected, collectionComplete }
   */
  setCollection(data) {
    if (!data) return;

    const prevCollected = this.collected;
    this.collected = data.totalCollected ?? this.collected;
    this.total = 12;
    this.collectionComplete = data.collectionComplete ?? false;

    // Trigger glow animation if new crystal was collected
    if (this.collected > prevCollected && prevCollected > 0) {
      this.showNewCrystalGlow = true;
      this.glowIntensity = 1;

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
      this.showNewCrystalGlow = true;
      this.glowIntensity = 1;
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
   * Check if point is within indicator bounds
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {boolean}
   */
  containsPoint(x, y) {
    return x >= this.x && x <= this.x + this.width &&
           y >= this.y && y <= this.y + this.height;
  }

  /**
   * Handle click event
   */
  handleClick() {
    if (this.onClick) {
      this.onClick();
    }
    // Clear glow on click (user has seen the collection)
    this.showNewCrystalGlow = false;
  }

  /**
   * Update animation state
   * @param {number} deltaTime - Time in milliseconds
   */
  update(deltaTime) {
    // Animate glow for new crystal notification
    if (this.showNewCrystalGlow) {
      // Pulse effect
      this.glowIntensity += this.glowDirection * (deltaTime / 1000) * 2;

      if (this.glowIntensity >= 1) {
        this.glowIntensity = 1;
        this.glowDirection = -1;
      } else if (this.glowIntensity <= 0.3) {
        this.glowIntensity = 0.3;
        this.glowDirection = 1;
      }
    }
  }

  /**
   * Render the zodiac indicator
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    const { x, y, width, height } = this;

    ctx.save();

    // Draw glow effect for new crystal
    if (this.showNewCrystalGlow) {
      const glowRadius = 8;
      const glowGradient = ctx.createRadialGradient(
        x + width / 2, y + height / 2, 0,
        x + width / 2, y + height / 2, width / 2 + glowRadius
      );
      glowGradient.addColorStop(0, `rgba(255, 215, 0, ${this.glowIntensity * 0.5})`);
      glowGradient.addColorStop(1, 'rgba(255, 215, 0, 0)');

      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.ellipse(x + width / 2, y + height / 2, width / 2 + glowRadius, height / 2 + glowRadius, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw container background (parchment style, matching StaminaBar)
    ctx.fillStyle = 'rgba(60, 45, 30, 0.85)';
    ctx.strokeStyle = this.collectionComplete ? '#ffd700' : '#8b7355';
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

    // Crystal icon (unicode zodiac symbol or star)
    const iconX = x + 10;
    const iconY = y + height / 2;

    // Draw a simple crystal shape
    ctx.fillStyle = this.collectionComplete ? '#ffd700' : '#c4a574';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u2726', iconX, iconY); // Four-pointed star

    // Collection count text
    ctx.font = 'bold 12px serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const countText = `${this.collected}/${this.total}`;
    const textX = x + 22;

    // Draw outline for readability
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeText(countText, textX, iconY);

    // Draw fill
    ctx.fillStyle = this.collectionComplete ? '#ffd700' : '#c4a574';
    ctx.fillText(countText, textX, iconY);

    // Label
    ctx.font = '10px serif';
    ctx.fillStyle = '#a08565';
    ctx.textAlign = 'right';
    ctx.fillText('Zodiac', x + width - 8, iconY);

    // Collection complete indicator
    if (this.collectionComplete) {
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('\u2713', x + width - 20, iconY); // Checkmark
    }

    ctx.restore();
  }
}
