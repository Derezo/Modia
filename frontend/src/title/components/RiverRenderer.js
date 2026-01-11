import { TITLE_COLORS, hexToRgba } from '../TitleColors.js';

/**
 * Renders a flowing river/moat with animated waves and foam particles.
 */
export class RiverRenderer {
  constructor(y, width, height = 45) {
    this.y = y;
    this.width = width;
    this.height = height;

    // Wave animation
    this.waveOffset = 0;
    this.waveSpeed = 0.002;
    this.waveAmplitude = 3;
    this.waveFrequency = 0.03;

    // Foam particles
    this.foamParticles = [];
    this.maxFoam = 25;
    this.foamSpawnTimer = 0;
    this.foamSpawnRate = 80; // ms between spawns

    // Sparkles
    this.sparkles = [];
    this.maxSparkles = 12;
    this.sparkleTimer = 0;
  }

  update(deltaTime) {
    const dt = deltaTime / 1000;

    // Animate waves
    this.waveOffset += this.waveSpeed * deltaTime;

    // Spawn foam particles
    this.foamSpawnTimer += deltaTime;
    if (this.foamSpawnTimer >= this.foamSpawnRate && this.foamParticles.length < this.maxFoam) {
      this.foamSpawnTimer = 0;
      this.spawnFoamParticle();
    }

    // Update foam particles
    for (let i = this.foamParticles.length - 1; i >= 0; i--) {
      const p = this.foamParticles[i];
      p.x += p.velocityX * dt;
      p.alpha -= 0.25 * dt;

      if (p.alpha <= 0 || p.x > this.width + 20) {
        this.foamParticles.splice(i, 1);
      }
    }

    // Spawn sparkles randomly
    this.sparkleTimer += deltaTime;
    if (this.sparkleTimer >= 150 && Math.random() < 0.3 && this.sparkles.length < this.maxSparkles) {
      this.sparkleTimer = 0;
      this.sparkles.push({
        x: Math.random() * this.width,
        y: this.y + 10 + Math.random() * (this.height - 20),
        alpha: 1,
        decay: 1.2 + Math.random() * 0.8
      });
    }

    // Update sparkles
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      this.sparkles[i].alpha -= this.sparkles[i].decay * dt;
      if (this.sparkles[i].alpha <= 0) {
        this.sparkles.splice(i, 1);
      }
    }
  }

  spawnFoamParticle() {
    this.foamParticles.push({
      x: -10,
      y: this.y + 5 + Math.random() * (this.height - 10),
      velocityX: 35 + Math.random() * 25,
      size: 2 + Math.random() * 3,
      alpha: 0.5 + Math.random() * 0.3
    });
  }

  render(ctx) {
    ctx.save();

    // Create clipping path for wavy edges
    ctx.beginPath();
    ctx.moveTo(0, this.y);

    // Top wavy edge
    for (let x = 0; x <= this.width; x += 8) {
      const waveY = Math.sin((x * this.waveFrequency) + this.waveOffset) * this.waveAmplitude;
      ctx.lineTo(x, this.y + waveY);
    }

    // Bottom edge (straight)
    ctx.lineTo(this.width, this.y + this.height);
    ctx.lineTo(0, this.y + this.height);
    ctx.closePath();

    // Water gradient
    const gradient = ctx.createLinearGradient(0, this.y, 0, this.y + this.height);
    gradient.addColorStop(0, TITLE_COLORS.water.light);
    gradient.addColorStop(0.4, TITLE_COLORS.water.mid);
    gradient.addColorStop(1, TITLE_COLORS.water.deep);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Wave highlight lines
    ctx.strokeStyle = hexToRgba(TITLE_COLORS.water.surface, 0.4);
    ctx.lineWidth = 1.5;

    for (let row = 0; row < 3; row++) {
      const rowY = this.y + 10 + row * 12;
      ctx.beginPath();
      ctx.moveTo(0, rowY);

      for (let x = 0; x < this.width; x += 6) {
        const wave = Math.sin(this.waveOffset * 1.5 + x * 0.04 + row * 0.7) * 2;
        ctx.lineTo(x, rowY + wave);
      }
      ctx.stroke();
    }

    // Top bank foam line
    ctx.strokeStyle = hexToRgba(TITLE_COLORS.water.foam, 0.6);
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 6]);

    ctx.beginPath();
    ctx.moveTo(0, this.y + 3);
    for (let x = 0; x < this.width; x += 4) {
      const wave = Math.sin(this.waveOffset * 2 + x * 0.06) * 1.5;
      ctx.lineTo(x, this.y + 3 + wave);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Foam particles
    ctx.fillStyle = TITLE_COLORS.water.foam;
    for (const p of this.foamParticles) {
      ctx.globalAlpha = p.alpha * 0.7;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sparkles
    for (const s of this.sparkles) {
      ctx.globalAlpha = s.alpha;
      ctx.fillStyle = TITLE_COLORS.water.sparkle;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}
