import { TITLE_COLORS } from '../TitleColors.js';

/**
 * Particle emitter for dust/footstep effects.
 * Creates puffs of dust behind moving entities.
 */
export class DustEmitter {
  constructor() {
    this.particles = [];
    this.maxParticles = 150;
  }

  /**
   * Emit a burst of dust particles at a position.
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {number} direction - Movement direction (1 = right, -1 = left)
   * @param {number} intensity - Particle count multiplier (default 1)
   */
  emit(x, y, direction = 1, intensity = 1) {
    const count = Math.floor(4 + 3 * intensity);

    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) break;

      // Particles move opposite to travel direction
      const angle = (Math.PI * 0.5) + (direction * Math.PI * 0.25) + (Math.random() - 0.5) * 0.8;
      const speed = 25 + Math.random() * 40;

      this.particles.push({
        x,
        y,
        velocityX: Math.cos(angle) * speed * -direction,
        velocityY: -Math.abs(Math.sin(angle) * speed) - 15, // Upward bias
        gravity: 50, // Light gravity
        alpha: 0.5 + Math.random() * 0.3,
        decay: 0.7 + Math.random() * 0.5,
        size: 2 + Math.random() * 3,
        color: this.getRandomDustColor()
      });
    }
  }

  /**
   * Emit a large burst for collision impact.
   * @param {number} x - X position
   * @param {number} y - Y position
   */
  emitImpact(x, y) {
    const count = 20;

    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) break;

      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 80;

      this.particles.push({
        x,
        y,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed - 30,
        gravity: 60,
        alpha: 0.6 + Math.random() * 0.3,
        decay: 0.5 + Math.random() * 0.4,
        size: 3 + Math.random() * 4,
        color: this.getRandomDustColor()
      });
    }
  }

  getRandomDustColor() {
    const colors = [
      TITLE_COLORS.dust.light,
      TITLE_COLORS.dust.mid,
      TITLE_COLORS.dust.dark
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  update(deltaTime) {
    const dt = deltaTime / 1000;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      // Physics
      p.x += p.velocityX * dt;
      p.y += p.velocityY * dt;
      p.velocityY += p.gravity * dt;

      // Drag (dust slows down)
      p.velocityX *= 0.97;
      p.velocityY *= 0.98;

      // Fade
      p.alpha -= p.decay * dt;
      p.size *= 0.995;

      // Remove dead particles
      if (p.alpha <= 0 || p.size < 0.5) {
        this.particles.splice(i, 1);
      }
    }
  }

  render(ctx) {
    ctx.save();

    for (const p of this.particles) {
      ctx.globalAlpha = p.alpha * 0.7;
      ctx.fillStyle = p.color;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Clear all particles.
   */
  clear() {
    this.particles = [];
  }
}
