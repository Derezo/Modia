/**
 * CrystalParticles - Particle effects for zodiac crystal orb animations
 *
 * Provides ambient drifting particles inside orbs and burst effects.
 */

export class CrystalParticles {
  constructor(maxParticles = 30) {
    this.maxParticles = maxParticles;
    this.particles = [];
    this.centerX = 0;
    this.centerY = 0;
    this.radius = 100;
  }

  /**
   * Set the orb center and radius for particle bounds
   */
  setBounds(centerX, centerY, radius) {
    this.centerX = centerX;
    this.centerY = centerY;
    this.radius = radius;
  }

  /**
   * Spawn ambient drifting particles
   * @param {number} count - Number of particles
   * @param {string} color - Particle color
   */
  spawnAmbient(count, color) {
    for (let i = 0; i < count && this.particles.length < this.maxParticles; i++) {
      // Random position within circular bounds
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * this.radius * 0.8;

      this.particles.push({
        x: this.centerX + Math.cos(angle) * dist,
        y: this.centerY + Math.sin(angle) * dist,
        angle: Math.random() * Math.PI * 2,
        angularVelocity: (Math.random() - 0.5) * 0.5, // Slow circular drift
        orbitRadius: 5 + Math.random() * 15,
        speed: 0.1 + Math.random() * 0.2,
        size: 1 + Math.random() * 2,
        color: color,
        alpha: 0.4 + Math.random() * 0.4,
        alphaPhase: Math.random() * Math.PI * 2,
        life: Infinity // Ambient particles don't die
      });
    }
  }

  /**
   * Spawn burst particles (for selection effect)
   * @param {number} count - Number of particles
   * @param {string} color - Particle color
   */
  spawnBurst(count, color) {
    for (let i = 0; i < count && this.particles.length < this.maxParticles; i++) {
      const angle = (i / count) * Math.PI * 2;
      const speed = 50 + Math.random() * 30;

      this.particles.push({
        x: this.centerX,
        y: this.centerY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2 + Math.random() * 2,
        color: color,
        alpha: 1,
        life: 500 + Math.random() * 200, // ms
        maxLife: 700
      });
    }
  }

  /**
   * Update all particles
   * @param {number} deltaTime - Time in ms
   */
  update(deltaTime) {
    const dt = deltaTime / 1000;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      if (p.life !== Infinity) {
        // Burst particle - linear movement with fade
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= deltaTime;
        p.alpha = Math.max(0, p.life / p.maxLife);

        if (p.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }
      } else {
        // Ambient particle - circular drift
        p.angle += p.angularVelocity * dt;
        p.alphaPhase += dt * 2; // Twinkle
        p.alpha = 0.4 + Math.sin(p.alphaPhase) * 0.3;

        // Keep within bounds
        const dx = p.x - this.centerX;
        const dy = p.y - this.centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > this.radius * 0.85) {
          // Nudge back toward center
          p.x -= dx * 0.01;
          p.y -= dy * 0.01;
        } else {
          // Drift
          p.x += Math.cos(p.angle) * p.speed;
          p.y += Math.sin(p.angle) * p.speed;
        }
      }
    }
  }

  /**
   * Render particles
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    ctx.save();

    for (const p of this.particles) {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Clear all particles
   */
  clear() {
    this.particles = [];
  }
}
