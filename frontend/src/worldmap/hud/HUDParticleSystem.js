/**
 * HUDParticleSystem - Shared particle effects for World Map HUD elements
 *
 * Supports multiple effect types:
 * - Gold sparkle particles (stamina fill edges, zodiac collection)
 * - Glow pulse particles (zodiac crystals)
 * - Shimmer sweep particles (stamina regen)
 *
 * Uses object pooling for performance. Maximum 100 active particles.
 */

/** Maximum particles allowed in the system */
const MAX_PARTICLES = 100;

/** Two times PI for circle calculations */
const TWO_PI = Math.PI * 2;

/**
 * Individual particle data structure
 * @typedef {Object} Particle
 * @property {number} x - X position
 * @property {number} y - Y position
 * @property {number} vx - X velocity (pixels per second)
 * @property {number} vy - Y velocity (pixels per second)
 * @property {number} life - Remaining life (ms)
 * @property {number} maxLife - Maximum life (ms)
 * @property {number} size - Current size (pixels)
 * @property {number} baseSize - Starting size (pixels)
 * @property {string} color - Fill color (hex or rgba)
 * @property {number} alpha - Current opacity (0-1)
 * @property {string} mode - Rendering mode: 'circle' or 'star'
 * @property {boolean} active - Whether particle is in use
 */

/**
 * Spawn configuration
 * @typedef {Object} SpawnConfig
 * @property {number} x - Spawn X position
 * @property {number} y - Spawn Y position
 * @property {number} [count=1] - Number of particles to spawn
 * @property {'point'|'ring'|'line'} [pattern='point'] - Spawn pattern
 * @property {string} [color='#ffd700'] - Particle color
 * @property {{min: number, max: number}} [velocityRange] - Velocity range (pixels/sec)
 * @property {{min: number, max: number}} [lifeRange] - Life range (ms)
 * @property {{min: number, max: number}} [sizeRange] - Size range (pixels)
 * @property {'circle'|'star'} [mode='circle'] - Render mode
 * @property {number} [ringRadius=10] - Radius for ring pattern
 * @property {number} [lineLength=20] - Length for line pattern
 * @property {number} [lineAngle=0] - Angle for line pattern (radians)
 * @property {number} [gravity=0] - Gravity effect (pixels/sec^2)
 * @property {number} [fadeIn=0] - Fade in duration (ms)
 */

export class HUDParticleSystem {
  constructor() {
    /**
     * Particle pool - pre-allocated for performance
     * @type {Particle[]}
     */
    this.particles = [];

    // Pre-allocate particle pool
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push(this.createParticle());
    }

    /**
     * Number of active particles
     * @type {number}
     */
    this.activeCount = 0;
  }

  /**
   * Create a new inactive particle for the pool
   * @returns {Particle}
   */
  createParticle() {
    return {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 0,
      size: 0,
      baseSize: 0,
      color: '#ffd700',
      alpha: 1,
      mode: 'circle',
      active: false,
      gravity: 0,
      fadeInDuration: 0,
      age: 0
    };
  }

  /**
   * Get an inactive particle from the pool
   * @returns {Particle|null}
   */
  getParticle() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.particles[i].active) {
        return this.particles[i];
      }
    }
    return null;
  }

  /**
   * Generate a random number in range
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  randomRange(min, max) {
    return min + Math.random() * (max - min);
  }

  /**
   * Spawn particles with the given configuration
   * @param {SpawnConfig} config
   */
  spawn(config) {
    const {
      x,
      y,
      count = 1,
      pattern = 'point',
      color = '#ffd700',
      velocityRange = { min: 10, max: 30 },
      lifeRange = { min: 300, max: 600 },
      sizeRange = { min: 1, max: 3 },
      mode = 'circle',
      ringRadius = 10,
      lineLength = 20,
      lineAngle = 0,
      gravity = 0,
      fadeIn = 0
    } = config;

    for (let i = 0; i < count; i++) {
      const particle = this.getParticle();
      if (!particle) {
        // Pool exhausted
        break;
      }

      // Calculate spawn position based on pattern
      let spawnX = x;
      let spawnY = y;
      const angle = Math.random() * TWO_PI;

      switch (pattern) {
        case 'ring': {
          spawnX = x + Math.cos(angle) * ringRadius;
          spawnY = y + Math.sin(angle) * ringRadius;
          break;
        }
        case 'line': {
          const t = count > 1 ? i / (count - 1) : 0.5;
          const offset = (t - 0.5) * lineLength;
          spawnX = x + Math.cos(lineAngle) * offset;
          spawnY = y + Math.sin(lineAngle) * offset;
          // Add slight perpendicular jitter
          const perpAngle = lineAngle + Math.PI / 2;
          const jitter = this.randomRange(-2, 2);
          spawnX += Math.cos(perpAngle) * jitter;
          spawnY += Math.sin(perpAngle) * jitter;
          break;
        }
        case 'point':
        default:
          // Point spawn - already at x, y
          break;
      }

      // Calculate velocity
      const speed = this.randomRange(velocityRange.min, velocityRange.max);
      const velocityAngle = Math.random() * TWO_PI;

      // Initialize particle
      particle.x = spawnX;
      particle.y = spawnY;
      particle.vx = Math.cos(velocityAngle) * speed;
      particle.vy = Math.sin(velocityAngle) * speed;
      particle.life = this.randomRange(lifeRange.min, lifeRange.max);
      particle.maxLife = particle.life;
      particle.baseSize = this.randomRange(sizeRange.min, sizeRange.max);
      particle.size = particle.baseSize;
      particle.color = color;
      particle.alpha = fadeIn > 0 ? 0 : 1;
      particle.mode = mode;
      particle.active = true;
      particle.gravity = gravity;
      particle.fadeInDuration = fadeIn;
      particle.age = 0;

      this.activeCount++;
    }
  }

  /**
   * Update all active particles
   * @param {number} deltaTime - Time elapsed in milliseconds
   */
  update(deltaTime) {
    const dt = deltaTime / 1000; // Convert to seconds for physics

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;

      // Update age
      p.age += deltaTime;

      // Apply gravity
      if (p.gravity !== 0) {
        p.vy += p.gravity * dt;
      }

      // Update position
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Update life
      p.life -= deltaTime;

      if (p.life <= 0) {
        // Particle died
        p.active = false;
        this.activeCount--;
        continue;
      }

      // Calculate life ratio (0 = dead, 1 = full life)
      const lifeRatio = p.life / p.maxLife;

      // Handle fade in
      if (p.fadeInDuration > 0 && p.age < p.fadeInDuration) {
        p.alpha = p.age / p.fadeInDuration;
      } else {
        // Fade out in last 30% of life
        if (lifeRatio < 0.3) {
          p.alpha = lifeRatio / 0.3;
        } else {
          p.alpha = 1;
        }
      }

      // Shrink particle as it ages
      p.size = p.baseSize * (0.3 + lifeRatio * 0.7);
    }
  }

  /**
   * Render all active particles to canvas
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    if (this.activeCount === 0) return;

    ctx.save();

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;

      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;

      if (p.mode === 'star') {
        this.renderStar(ctx, p.x, p.y, p.size);
      } else {
        // Default circle mode
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TWO_PI);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /**
   * Render a 4-pointed star
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Center X
   * @param {number} y - Center Y
   * @param {number} size - Star size
   */
  renderStar(ctx, x, y, size) {
    const outerRadius = size;
    const innerRadius = size * 0.4;
    const points = 4;

    ctx.beginPath();

    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i * Math.PI) / points - Math.PI / 2;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;

      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }

    ctx.closePath();
    ctx.fill();
  }

  /**
   * Clear all active particles
   */
  clear() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles[i].active = false;
    }
    this.activeCount = 0;
  }

  /**
   * Get the number of active particles
   * @returns {number}
   */
  getActiveCount() {
    return this.activeCount;
  }

  // ========== Preset Effect Methods ==========

  /**
   * Spawn gold sparkle effect (for stamina fill, zodiac collection)
   * @param {number} x - Center X
   * @param {number} y - Center Y
   * @param {number} [count=5] - Number of particles
   */
  spawnGoldSparkle(x, y, count = 5) {
    this.spawn({
      x,
      y,
      count,
      pattern: 'point',
      color: '#ffd700',
      velocityRange: { min: 15, max: 40 },
      lifeRange: { min: 400, max: 700 },
      sizeRange: { min: 1.5, max: 3 },
      mode: 'star',
      gravity: 20
    });
  }

  /**
   * Spawn glow pulse effect (for zodiac crystals)
   * @param {number} x - Center X
   * @param {number} y - Center Y
   * @param {number} [radius=8] - Ring radius
   */
  spawnGlowPulse(x, y, radius = 8) {
    this.spawn({
      x,
      y,
      count: 8,
      pattern: 'ring',
      ringRadius: radius,
      color: '#fffacd',
      velocityRange: { min: 5, max: 15 },
      lifeRange: { min: 500, max: 800 },
      sizeRange: { min: 2, max: 4 },
      mode: 'circle',
      fadeIn: 100
    });
  }

  /**
   * Spawn shimmer sweep effect (for stamina regen)
   * @param {number} x - Start X
   * @param {number} y - Center Y
   * @param {number} [length=30] - Sweep length
   * @param {number} [angle=0] - Sweep angle (radians)
   */
  spawnShimmerSweep(x, y, length = 30, angle = 0) {
    this.spawn({
      x,
      y,
      count: 6,
      pattern: 'line',
      lineLength: length,
      lineAngle: angle,
      color: 'rgba(255, 223, 128, 0.8)',
      velocityRange: { min: 5, max: 20 },
      lifeRange: { min: 300, max: 500 },
      sizeRange: { min: 1, max: 2.5 },
      mode: 'circle',
      gravity: -10
    });
  }
}
