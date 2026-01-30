/**
 * CrystalOrb - Canvas renderer for zodiac crystal orbs
 *
 * Renders animated crystal orbs with constellation patterns for both
 * the collection grid view and detail modal.
 */

import { getConstellation, getZodiacInfo, getElementColors } from './ConstellationData.js';
import { CrystalParticles } from './CrystalParticles.js';

export class CrystalOrb {
  /**
   * @param {Object} options
   * @param {string} options.sign - Zodiac sign name (lowercase)
   * @param {number} options.size - Orb size in pixels
   * @param {boolean} options.collected - Whether crystal is collected
   * @param {boolean} options.showConstellation - Whether to show constellation lines
   * @param {boolean} options.animated - Whether to animate
   */
  constructor(options) {
    this.sign = options.sign;
    this.size = options.size || 32;
    this.collected = options.collected !== false;
    this.showConstellation = options.showConstellation !== false;
    this.animated = options.animated !== false;

    // Get data
    this.constellation = getConstellation(this.sign);
    this.zodiacInfo = getZodiacInfo(this.sign);
    this.colors = getElementColors(this.sign);

    // Animation state
    this.rotation = 0;
    this.glowPhase = 0;
    this.starTwinkle = this.constellation.stars.map(() => ({
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 1.5
    }));

    // Particles (only for larger sizes)
    this.particles = null;
    if (this.size >= 128 && this.collected) {
      this.particles = new CrystalParticles(25);
      this.particles.setBounds(this.size / 2, this.size / 2, this.size * 0.4);
      this.particles.spawnAmbient(20, this.colors.star);
    }

    // Create offscreen canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.size;
    this.canvas.height = this.size;
    this.ctx = this.canvas.getContext('2d');
  }

  update(deltaTime) {
    if (!this.animated) return;

    const dt = deltaTime / 1000;

    // Slow rotation
    this.rotation += dt * 0.02;

    // Glow pulse (3s cycle)
    this.glowPhase += dt * (Math.PI * 2 / 3);

    // Star twinkle
    for (const twinkle of this.starTwinkle) {
      twinkle.phase += dt * twinkle.speed;
    }

    // Particles
    if (this.particles) {
      this.particles.update(deltaTime);
    }
  }

  render() {
    const ctx = this.ctx;
    const size = this.size;
    const center = size / 2;
    const orbRadius = size * 0.42;

    // Clear
    ctx.clearRect(0, 0, size, size);

    if (!this.collected) {
      // Uncollected: dark silhouette
      this.renderUncollected(ctx, center, orbRadius);
      return this.canvas;
    }

    // Outer glow
    const glowIntensity = 0.4 + Math.sin(this.glowPhase) * 0.15;
    const gradient = ctx.createRadialGradient(
      center, center, orbRadius * 0.8,
      center, center, orbRadius * 1.3
    );
    gradient.addColorStop(0, this.colors.glow.replace('0.5', String(glowIntensity)));
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    // Orb body
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, orbRadius, 0, Math.PI * 2);
    ctx.clip();

    // Orb fill gradient
    const orbGradient = ctx.createRadialGradient(
      center - orbRadius * 0.3, center - orbRadius * 0.3, 0,
      center, center, orbRadius
    );
    orbGradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    orbGradient.addColorStop(0.5, `${this.colors.primary}44`);
    orbGradient.addColorStop(1, `${this.colors.secondary}66`);
    ctx.fillStyle = orbGradient;
    ctx.fill();

    // Constellation lines and stars
    if (this.showConstellation) {
      this.renderConstellation(ctx, center, orbRadius);
    }

    // Particles
    if (this.particles) {
      this.particles.render(ctx);
    }

    ctx.restore();

    // Glass reflection highlight
    ctx.beginPath();
    ctx.ellipse(
      center - orbRadius * 0.25,
      center - orbRadius * 0.25,
      orbRadius * 0.3, orbRadius * 0.15,
      -Math.PI / 4, 0, Math.PI * 2
    );
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fill();

    // Orb border
    ctx.beginPath();
    ctx.arc(center, center, orbRadius, 0, Math.PI * 2);
    ctx.strokeStyle = this.colors.primary + '88';
    ctx.lineWidth = size >= 128 ? 2 : 1;
    ctx.stroke();

    return this.canvas;
  }

  renderConstellation(ctx, center, orbRadius) {
    const scale = orbRadius * 1.6;
    const offsetX = center - scale * 0.5;
    const offsetY = center - scale * 0.5;

    // Lines
    ctx.strokeStyle = this.colors.star + '88';
    ctx.lineWidth = this.size >= 128 ? 1.5 : 0.5;
    ctx.beginPath();
    for (const [i1, i2] of this.constellation.lines) {
      const s1 = this.constellation.stars[i1];
      const s2 = this.constellation.stars[i2];
      ctx.moveTo(offsetX + s1.x * scale, offsetY + s1.y * scale);
      ctx.lineTo(offsetX + s2.x * scale, offsetY + s2.y * scale);
    }
    ctx.stroke();

    // Stars
    for (let i = 0; i < this.constellation.stars.length; i++) {
      const star = this.constellation.stars[i];
      const twinkle = this.starTwinkle[i];
      const alpha = 0.6 + Math.sin(twinkle.phase) * 0.4;

      const x = offsetX + star.x * scale;
      const y = offsetY + star.y * scale;
      const baseSize = this.size >= 128 ? 3 : 1.5;
      const starSize = baseSize * star.brightness * (0.8 + Math.sin(twinkle.phase) * 0.2);

      ctx.fillStyle = this.colors.star;
      ctx.globalAlpha = alpha * star.brightness;
      ctx.beginPath();
      ctx.arc(x, y, starSize, 0, Math.PI * 2);
      ctx.fill();

      // Glow for bright stars
      if (star.brightness > 0.7 && this.size >= 128) {
        const starGlow = ctx.createRadialGradient(x, y, 0, x, y, starSize * 3);
        starGlow.addColorStop(0, this.colors.star + '66');
        starGlow.addColorStop(1, 'transparent');
        ctx.fillStyle = starGlow;
        ctx.fillRect(x - starSize * 3, y - starSize * 3, starSize * 6, starSize * 6);
      }
    }
    ctx.globalAlpha = 1;
  }

  renderUncollected(ctx, center, orbRadius) {
    // Dark silhouette orb
    const gradient = ctx.createRadialGradient(
      center, center, 0,
      center, center, orbRadius
    );
    gradient.addColorStop(0, 'rgba(60, 50, 40, 0.6)');
    gradient.addColorStop(0.8, 'rgba(40, 30, 25, 0.8)');
    gradient.addColorStop(1, 'rgba(30, 25, 20, 0.9)');

    ctx.beginPath();
    ctx.arc(center, center, orbRadius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Mystical outline glow
    const glowIntensity = 0.2 + Math.sin(this.glowPhase * 0.5) * 0.1;
    ctx.strokeStyle = `rgba(139, 115, 85, ${glowIntensity})`;
    ctx.lineWidth = this.size >= 128 ? 2 : 1;
    ctx.stroke();

    // Question mark for large sizes
    if (this.size >= 128) {
      ctx.fillStyle = 'rgba(139, 115, 85, 0.4)';
      ctx.font = `bold ${this.size * 0.3}px Georgia`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', center, center);
    }
  }

  destroy() {
    // Help browser release GPU memory faster by zeroing canvas dimensions
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    this.canvas = null;
    this.ctx = null;
    if (this.particles) {
      this.particles.clear();
    }
    this.particles = null;
  }
}
