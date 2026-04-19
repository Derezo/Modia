import { TITLE_COLORS } from '../TitleColors.js';

/**
 * Climactic light burst effect when armies collide.
 * Multi-layered radial explosion with rays and particles.
 */
export class LightBurst {
  constructor(x, y, targetWidth = 800, targetHeight = 600) {
    this.x = x;
    this.y = y;
    this.targetWidth = targetWidth;
    this.targetHeight = targetHeight;

    this.active = false;
    this.timer = 0;
    this.duration = 2200; // 2.2 seconds

    // Effect components
    this.flashAlpha = 0;
    this.rays = [];
    this.particles = [];
    this.ringRadius = 0;
    this.ringAlpha = 0;

    // Configuration
    this.rayCount = 18;
    this.maxRayLength = 450;
    this.particleCount = 100;
    this.maxRingRadius = 600;
  }

  /**
   * Trigger the light burst effect.
   */
  trigger() {
    this.active = true;
    this.timer = 0;
    this.flashAlpha = 1;
    this.ringRadius = 0;
    this.ringAlpha = 1;
    this.rays = [];
    this.particles = [];

    // Initialize rays
    for (let i = 0; i < this.rayCount; i++) {
      const angle = (Math.PI * 2 / this.rayCount) * i + (Math.random() - 0.5) * 0.15;
      this.rays.push({
        angle,
        length: 0,
        targetLength: this.maxRayLength * (0.5 + Math.random() * 0.5),
        width: 4 + Math.random() * 6,
        alpha: 1,
        speed: 0.7 + Math.random() * 0.5
      });
    }

    // Initialize particles
    for (let i = 0; i < this.particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 120 + Math.random() * 220;
      this.particles.push({
        x: 0,
        y: 0,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed,
        gravity: 35 + Math.random() * 30,
        size: 3 + Math.random() * 5,
        alpha: 1,
        decay: 0.5 + Math.random() * 0.4,
        color: Math.random() < 0.65 ? TITLE_COLORS.effects.gold : TITLE_COLORS.effects.white
      });
    }
  }

  update(deltaTime) {
    if (!this.active) return;

    const dt = deltaTime / 1000;
    this.timer += deltaTime;

    // Check completion
    if (this.timer >= this.duration && this.particles.length === 0) {
      this.active = false;
      return;
    }

    const _progress = Math.min(1, this.timer / this.duration);

    // Flash decay (quick)
    if (this.timer < 150) {
      this.flashAlpha = 1;
    } else {
      this.flashAlpha = Math.max(0, this.flashAlpha - 3 * dt);
    }

    // Ray expansion
    const rayProgress = Math.min(1, this.timer / 600);
    const rayEased = this.easeOutCubic(rayProgress);

    for (const ray of this.rays) {
      ray.length = ray.targetLength * rayEased * ray.speed;
      if (this.timer > 500) {
        ray.alpha = Math.max(0, 1 - (this.timer - 500) / 1000);
      }
    }

    // Ring expansion
    const ringProgress = Math.min(1, this.timer / 1200);
    const ringEased = this.easeOutCubic(ringProgress);
    this.ringRadius = this.maxRingRadius * ringEased;
    this.ringAlpha = Math.max(0, 1 - ringProgress);

    // Particle physics
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.velocityX * dt;
      p.y += p.velocityY * dt;
      p.velocityY += p.gravity * dt;
      p.velocityX *= 0.98;
      p.alpha -= p.decay * dt;
      p.size *= 0.99;

      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  render(ctx) {
    if (!this.active && this.flashAlpha <= 0) return;

    ctx.save();

    // Layer 1: Full-screen white flash
    if (this.flashAlpha > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${this.flashAlpha * 0.85})`;
      ctx.fillRect(0, 0, this.targetWidth, this.targetHeight);
    }

    // Layer 2: Central radial glow
    if (this.timer < 1200) {
      const glowAlpha = Math.max(0, 1 - this.timer / 1200);
      const glowRadius = 80 + this.easeOutCubic(Math.min(1, this.timer / 400)) * 200;

      const gradient = ctx.createRadialGradient(
        this.x, this.y, 0,
        this.x, this.y, glowRadius
      );
      gradient.addColorStop(0, `rgba(255, 255, 255, ${glowAlpha})`);
      gradient.addColorStop(0.3, `rgba(255, 248, 220, ${glowAlpha * 0.7})`);
      gradient.addColorStop(0.6, `rgba(255, 215, 0, ${glowAlpha * 0.4})`);
      gradient.addColorStop(1, 'rgba(255, 215, 0, 0)');

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.targetWidth, this.targetHeight);
    }

    // Layer 3: Light rays
    ctx.lineCap = 'round';
    for (const ray of this.rays) {
      if (ray.alpha <= 0 || ray.length <= 0) continue;

      const endX = this.x + Math.cos(ray.angle) * ray.length;
      const endY = this.y + Math.sin(ray.angle) * ray.length;

      const rayGradient = ctx.createLinearGradient(this.x, this.y, endX, endY);
      rayGradient.addColorStop(0, `rgba(255, 255, 255, ${ray.alpha})`);
      rayGradient.addColorStop(0.4, `rgba(255, 248, 200, ${ray.alpha * 0.6})`);
      rayGradient.addColorStop(1, 'rgba(255, 215, 0, 0)');

      ctx.strokeStyle = rayGradient;
      ctx.lineWidth = ray.width;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }

    // Layer 4: Shockwave rings
    if (this.ringAlpha > 0) {
      // Outer ring
      ctx.strokeStyle = `rgba(255, 215, 0, ${this.ringAlpha * 0.5})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.ringRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Inner ring
      ctx.strokeStyle = `rgba(255, 255, 255, ${this.ringAlpha * 0.35})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.ringRadius * 0.65, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Layer 5: Particles with glow
    for (const p of this.particles) {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = p.size * 1.5;

      ctx.beginPath();
      ctx.arc(this.x + p.x, this.y + p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    ctx.restore();
  }

  /**
   * Check if the effect is complete.
   */
  isComplete() {
    return !this.active && this.flashAlpha <= 0;
  }

  /**
   * Get the current flash alpha for transition coordination.
   */
  getFlashAlpha() {
    return this.flashAlpha;
  }

  easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
}
