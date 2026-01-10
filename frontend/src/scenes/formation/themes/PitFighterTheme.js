import { FormationTheme } from '../FormationTheme.js';

/**
 * PitFighterTheme - Coliseum PvP battle formation
 *
 * Underground fighting pit aesthetic with crowd silhouettes,
 * torchlight, and gritty arena atmosphere.
 */
export class PitFighterTheme extends FormationTheme {
  constructor(scene) {
    super(scene);
    this.particleTimer = 0;
    this.torchFlicker = 1.0;
    this.crowdWave = 0;
  }

  static get config() {
    return {
      name: 'pitfighter',

      background: {
        gradient: ['#1a1008', '#0a0804'],
        gradientAngle: 180
      },

      grid: {
        tileColor: '#3a3020',
        tileColorOccupied: '#4a4030',
        tileColorHover: '#5a5040',
        tileBorder: '#5a4a3a',
        tileBorderOccupied: '#8b4513',
        tileBorderHover: '#cd853f',
        highlightPulse: true,
        highlightColor: 'rgba(255, 140, 0, 0.4)'
      },

      chrome: {
        borderColor: '#5a3a2a',
        backgroundColor: 'rgba(20, 10, 5, 0.7)',
        accentColor: '#cd853f'
      },

      ambient: {
        particles: ['dust', 'ember', 'smoke'],
        lightFlicker: true,
        lightIntensity: 0.9
      },

      button: {
        type: 'fist',
        primaryColor: '#8b4513',
        secondaryColor: '#5a3020',
        accentColor: '#ff6b00'
      }
    };
  }

  init() {
    super.init();
    this.particleTimer = 0;
    this.torchFlicker = 1.0;
    this.crowdWave = 0;
  }

  update(deltaTime) {
    super.update(deltaTime);

    // Torch flicker effect
    this.torchFlicker = 0.85 + Math.random() * 0.15;

    // Crowd wave animation
    this.crowdWave = (this.animationFrame % 3000) / 3000;

    // Spawn particles
    this.particleTimer += deltaTime;
    const spawnRate = 150 / this.getParticleMultiplier();

    if (this.particleTimer >= spawnRate) {
      this.particleTimer = 0;
      this.spawnParticles();
    }
  }

  spawnParticles() {
    const canvas = this.scene.gridCanvas;
    if (!canvas) return;

    const types = ['dust', 'ember', 'smoke'];
    const type = types[Math.floor(Math.random() * types.length)];
    const particle = this.createParticle(type, canvas.width, canvas.height);

    if (particle) {
      this.particles.push(particle);
    }

    while (this.particles.length > 60) {
      this.particles.shift();
    }
  }

  createParticle(type, width, height) {
    switch (type) {
      case 'dust':
        return {
          x: Math.random() * width,
          y: height + 10,
          vx: -5 + Math.random() * 10,
          vy: -20 - Math.random() * 15,
          size: 2 + Math.random() * 3,
          color: 'rgba(180, 140, 100, 0.4)',
          alpha: 0.4,
          life: 2 + Math.random() * 2,
          maxLife: 4
        };

      case 'ember':
        return {
          x: Math.random() < 0.5 ? 20 + Math.random() * 30 : width - 50 + Math.random() * 30,
          y: height * 0.3 + Math.random() * height * 0.4,
          vx: -3 + Math.random() * 6,
          vy: -30 - Math.random() * 20,
          size: 1 + Math.random() * 2,
          color: ['#ff6b00', '#ff8c00', '#ffa500'][Math.floor(Math.random() * 3)],
          alpha: 0.8,
          life: 1.5 + Math.random() * 1.5,
          maxLife: 3
        };

      case 'smoke':
        return {
          x: Math.random() < 0.5 ? 30 : width - 30,
          y: height * 0.5,
          vx: (Math.random() - 0.5) * 10,
          vy: -15 - Math.random() * 10,
          size: 15 + Math.random() * 20,
          color: 'rgba(80, 60, 40, 0.15)',
          alpha: 0.15,
          life: 3 + Math.random() * 2,
          maxLife: 5
        };

      default:
        return null;
    }
  }

  renderBackground(ctx, width, height) {
    // Dark gradient background
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#1a1008');
    gradient.addColorStop(0.5, '#0f0a04');
    gradient.addColorStop(1, '#0a0804');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Pit walls (dark edges)
    this.renderPitWalls(ctx, width, height);

    // Crowd silhouettes at top
    this.renderCrowd(ctx, width, height);

    // Torches on sides
    this.renderTorches(ctx, width, height);

    // Blood stains on floor (subtle)
    this.renderBloodStains(ctx, width, height);
  }

  renderPitWalls(ctx, width, height) {
    // Left wall shadow
    const leftGradient = ctx.createLinearGradient(0, 0, width * 0.15, 0);
    leftGradient.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
    leftGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = leftGradient;
    ctx.fillRect(0, 0, width * 0.15, height);

    // Right wall shadow
    const rightGradient = ctx.createLinearGradient(width, 0, width * 0.85, 0);
    rightGradient.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
    rightGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = rightGradient;
    ctx.fillRect(width * 0.85, 0, width * 0.15, height);
  }

  renderCrowd(ctx, width, height) {
    const crowdY = height * 0.05;
    const crowdHeight = height * 0.12;

    // Crowd backdrop
    ctx.fillStyle = 'rgba(30, 20, 10, 0.8)';
    ctx.fillRect(0, 0, width, crowdY + crowdHeight);

    // Silhouette figures
    ctx.fillStyle = '#0a0804';
    const figureCount = Math.floor(width / 15);

    for (let i = 0; i < figureCount; i++) {
      const x = (i / figureCount) * width + 5;
      const waveOffset = Math.sin(this.crowdWave * Math.PI * 2 + i * 0.5) * 3;
      const figureHeight = 8 + Math.random() * 6;

      // Head
      ctx.beginPath();
      ctx.arc(x, crowdY + crowdHeight - figureHeight - 4 + waveOffset, 4, 0, Math.PI * 2);
      ctx.fill();

      // Body
      ctx.fillRect(x - 3, crowdY + crowdHeight - figureHeight + waveOffset, 6, figureHeight);
    }

    // Railing
    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, crowdY + crowdHeight);
    ctx.lineTo(width, crowdY + crowdHeight);
    ctx.stroke();
  }

  renderTorches(ctx, width, height) {
    const torchPositions = [
      { x: 25, y: height * 0.25 },
      { x: width - 25, y: height * 0.25 },
      { x: 25, y: height * 0.55 },
      { x: width - 25, y: height * 0.55 }
    ];

    for (const pos of torchPositions) {
      // Torch bracket
      ctx.fillStyle = '#3a2a1a';
      ctx.fillRect(pos.x - 3, pos.y, 6, 15);

      // Flame glow
      const glowRadius = 30 * this.torchFlicker;
      const glow = ctx.createRadialGradient(pos.x, pos.y - 5, 0, pos.x, pos.y - 5, glowRadius);
      glow.addColorStop(0, `rgba(255, 150, 50, ${0.3 * this.torchFlicker})`);
      glow.addColorStop(0.5, `rgba(255, 100, 0, ${0.15 * this.torchFlicker})`);
      glow.addColorStop(1, 'rgba(255, 50, 0, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y - 5, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // Flame
      ctx.fillStyle = `rgba(255, ${150 + Math.random() * 50}, 0, ${0.8 * this.torchFlicker})`;
      ctx.beginPath();
      ctx.moveTo(pos.x - 4, pos.y);
      ctx.quadraticCurveTo(pos.x, pos.y - 12 * this.torchFlicker, pos.x + 4, pos.y);
      ctx.fill();
    }
  }

  renderBloodStains(ctx, width, height) {
    ctx.globalAlpha = 0.1;

    // Random blood splatter positions
    const stains = [
      { x: width * 0.3, y: height * 0.7, r: 15 },
      { x: width * 0.6, y: height * 0.65, r: 12 },
      { x: width * 0.45, y: height * 0.8, r: 8 }
    ];

    for (const stain of stains) {
      ctx.fillStyle = '#4a0000';
      ctx.beginPath();
      ctx.ellipse(stain.x, stain.y, stain.r, stain.r * 0.6, Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  getContainerStyles() {
    return `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(180deg, #1a1008 0%, #0a0804 100%);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `;
  }

  getTitle() {
    return 'Enter the Pit';
  }
}
