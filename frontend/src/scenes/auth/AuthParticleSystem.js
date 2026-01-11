/**
 * Ambient floating particles for the auth scene background.
 * Creates a mystical, dreamy atmosphere with slow-drifting golden/white specks.
 */
export class AuthParticleSystem {
  constructor(width, height, count = 18) {
    this.width = width;
    this.height = height;
    this.particles = [];
    this.alpha = 0; // Overall system alpha for fade-in

    // Initialize particles
    for (let i = 0; i < count; i++) {
      this.particles.push(this.createParticle(true));
    }
  }

  /**
   * Create a single particle with random properties.
   * @param {boolean} randomY - If true, random Y; otherwise spawn at bottom
   */
  createParticle(randomY = false) {
    return {
      x: Math.random() * this.width,
      y: randomY ? Math.random() * this.height : this.height + 10,
      size: 1.5 + Math.random() * 2.5,
      alpha: 0.25 + Math.random() * 0.35,
      speedX: (Math.random() - 0.5) * 0.015, // Very slow horizontal drift
      speedY: -0.008 - Math.random() * 0.015, // Gentle upward rise
      // Color: 70% white, 30% gold
      isGold: Math.random() > 0.7,
      // Subtle pulse
      pulseOffset: Math.random() * Math.PI * 2,
      pulseSpeed: 0.001 + Math.random() * 0.001
    };
  }

  /**
   * Fade in the particle system.
   */
  fadeIn() {
    // Alpha will be animated in update
  }

  /**
   * Update particle positions and system alpha.
   * @param {number} deltaTime - Time in milliseconds
   */
  update(deltaTime) {
    // Fade in the system
    if (this.alpha < 1) {
      this.alpha = Math.min(1, this.alpha + deltaTime * 0.001);
    }

    for (const p of this.particles) {
      // Move particle
      p.x += p.speedX * deltaTime;
      p.y += p.speedY * deltaTime;

      // Update pulse
      p.pulseOffset += p.pulseSpeed * deltaTime;

      // Wrap horizontally
      if (p.x < -10) p.x = this.width + 10;
      if (p.x > this.width + 10) p.x = -10;

      // Respawn at bottom when off top
      if (p.y < -10) {
        p.x = Math.random() * this.width;
        p.y = this.height + 10;
        p.size = 1.5 + Math.random() * 2.5;
        p.alpha = 0.25 + Math.random() * 0.35;
        p.isGold = Math.random() > 0.7;
      }
    }
  }

  /**
   * Render all particles with glow effect.
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (this.alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = this.alpha;

    for (const p of this.particles) {
      const pulse = 0.7 + 0.3 * Math.sin(p.pulseOffset);
      const alpha = p.alpha * pulse;

      if (p.isGold) {
        // Golden particle with warm glow
        this.drawGlowingParticle(ctx, p.x, p.y, p.size, alpha, '#d4a54a', '#ffd700');
      } else {
        // White particle with soft glow
        this.drawGlowingParticle(ctx, p.x, p.y, p.size, alpha, '#c0c0d0', '#ffffff');
      }
    }

    ctx.restore();
  }

  /**
   * Draw a single glowing particle.
   */
  drawGlowingParticle(ctx, x, y, size, alpha, glowColor, coreColor) {
    // Outer glow
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, size * 3);
    gradient.addColorStop(0, this.colorWithAlpha(glowColor, alpha * 0.4));
    gradient.addColorStop(0.5, this.colorWithAlpha(glowColor, alpha * 0.15));
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.beginPath();
    ctx.arc(x, y, size * 3, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Core
    ctx.beginPath();
    ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = this.colorWithAlpha(coreColor, alpha);
    ctx.fill();
  }

  /**
   * Helper to create rgba color string.
   */
  colorWithAlpha(hexColor, alpha) {
    // Convert hex to rgb
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * Resize the particle system.
   */
  resize(width, height) {
    this.width = width;
    this.height = height;
  }
}
