/**
 * BattleFireworks - Canvas-based particle fireworks system for victory celebrations
 * Uses a medieval fantasy color palette (gold, copper, orange, cream)
 */

// Medieval fantasy firework color palette
const FIREWORK_COLORS = {
  primary: [
    '#ffd700',  // Gold
    '#c9a227',  // Parchment gold
    '#b87333',  // Copper
    '#ff8c00',  // Dark orange
  ],
  secondary: [
    '#ffaa44',  // Light orange
    '#ffcc88',  // Cream
    '#8b7355',  // Parchment border
    '#ffffff',  // White spark
  ]
};

const MAX_PARTICLES = 500;

/**
 * Single firework with trail and explosion
 */
class Firework {
  constructor(x, targetY, color, canvasHeight) {
    this.x = x;
    this.y = canvasHeight + 20;  // Start below screen
    this.targetY = targetY;
    this.color = color;
    this.canvasHeight = canvasHeight;
    this.velocity = -450 - Math.random() * 100;  // Upward velocity with variance
    this.trail = [];
    this.exploded = false;
    this.particles = [];
    this.finished = false;
  }

  update(dt) {
    if (!this.exploded) {
      // Rising phase
      this.y += this.velocity * dt;
      this.velocity += 300 * dt;  // Gravity slows ascent

      // Add trail particle
      this.trail.push({ x: this.x, y: this.y, alpha: 1 });
      if (this.trail.length > 8) this.trail.shift();

      // Fade trail
      for (const t of this.trail) {
        t.alpha -= dt * 2;
      }

      // Check if reached apex or target
      if (this.y <= this.targetY || this.velocity >= -50) {
        this.explode();
      }
    } else {
      // Explosion phase - update particles
      this.updateParticles(dt);
    }
  }

  explode() {
    this.exploded = true;
    this.trail = [];
    const particleCount = 30 + Math.floor(Math.random() * 20);

    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 / particleCount) * i + (Math.random() - 0.5) * 0.3;
      const speed = 80 + Math.random() * 120;

      this.particles.push({
        x: this.x,
        y: this.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2 + Math.random() * 4,
        alpha: 1,
        color: this.getParticleColor(),
        decay: 0.4 + Math.random() * 0.4
      });
    }
  }

  getParticleColor() {
    // 70% primary color, 30% secondary variation
    if (Math.random() < 0.7) return this.color;
    return FIREWORK_COLORS.secondary[
      Math.floor(Math.random() * FIREWORK_COLORS.secondary.length)
    ];
  }

  updateParticles(dt) {
    let aliveCount = 0;

    for (const p of this.particles) {
      if (p.alpha <= 0) continue;

      // Apply physics
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 80 * dt;  // Gravity

      // Fade out
      p.alpha -= p.decay * dt;
      p.size *= 0.99;

      if (p.alpha > 0) aliveCount++;
    }

    // Mark as finished when all particles are gone
    if (aliveCount === 0 && this.exploded) {
      this.finished = true;
    }
  }

  render(ctx) {
    // Draw trail (for rising fireworks)
    if (!this.exploded) {
      ctx.save();
      for (let i = 0; i < this.trail.length; i++) {
        const t = this.trail[i];
        if (t.alpha <= 0) continue;
        const alpha = (i / this.trail.length) * 0.7 * t.alpha;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(t.x, t.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw leading spark
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Draw explosion particles
    for (const p of this.particles) {
      if (p.alpha <= 0) continue;

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = p.size * 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  getParticleCount() {
    return this.particles.filter(p => p.alpha > 0).length;
  }
}

/**
 * BattleFireworks - Manages multiple fireworks
 */
export class BattleFireworks {
  constructor(canvas, targetWidth = 800, targetHeight = 600) {
    this.canvas = canvas;
    this.targetWidth = targetWidth;
    this.targetHeight = targetHeight;
    this.fireworks = [];
  }

  /**
   * Launch a single firework
   * @param {number} x - X position to launch from
   * @param {number} targetY - Y position to explode at
   * @param {string} [color] - Optional color override
   */
  launchFirework(x, targetY, color) {
    // Check particle limit
    const totalParticles = this.getTotalParticleCount();
    if (totalParticles >= MAX_PARTICLES) return;

    const fireworkColor = color ||
      FIREWORK_COLORS.primary[Math.floor(Math.random() * FIREWORK_COLORS.primary.length)];

    this.fireworks.push(new Firework(x, targetY, fireworkColor, this.targetHeight));
  }

  /**
   * Launch a wave of fireworks
   * @param {number} count - Number of fireworks to launch
   */
  launchWave(count) {
    const margin = this.targetWidth * 0.15;
    const width = this.targetWidth - margin * 2;

    for (let i = 0; i < count; i++) {
      // Stagger launches slightly
      setTimeout(() => {
        const x = margin + Math.random() * width;
        const targetY = this.targetHeight * (0.25 + Math.random() * 0.25);
        this.launchFirework(x, targetY);
      }, i * 100 + Math.random() * 100);
    }
  }

  /**
   * Update all fireworks
   * @param {number} dt - Delta time in seconds
   */
  update(dt) {
    for (const firework of this.fireworks) {
      firework.update(dt);
    }

    // Remove finished fireworks
    this.fireworks = this.fireworks.filter(f => !f.finished);
  }

  /**
   * Render all fireworks
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    for (const firework of this.fireworks) {
      firework.render(ctx);
    }
  }

  /**
   * Get total particle count across all fireworks
   */
  getTotalParticleCount() {
    return this.fireworks.reduce((sum, f) => sum + f.getParticleCount(), 0);
  }

  /**
   * Check if any fireworks are still active
   */
  isActive() {
    return this.fireworks.length > 0;
  }

  /**
   * Clear all fireworks
   */
  clear() {
    this.fireworks = [];
  }
}
