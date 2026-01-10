import { FormationTheme } from '../FormationTheme.js';

/**
 * ArcaneChamberTheme - Wizard Guild advancement battle formation
 *
 * Dark stone chamber with glowing summoning circle, floating runes,
 * candles, and arcane energy particles.
 */
export class ArcaneChamberTheme extends FormationTheme {
  constructor(scene) {
    super(scene);
    this.particleTimer = 0;
    this.runeRotation = 0;
    this.candleFlicker = [];
    this.pulsePhase = 0;
  }

  static get config() {
    return {
      name: 'arcanechamber',

      background: {
        gradient: ['#1a0a2e', '#0d0518'],
        gradientAngle: 180
      },

      grid: {
        tileColor: '#2a1a4a',
        tileColorOccupied: '#3a2a5a',
        tileColorHover: '#4a3a6a',
        tileBorder: '#6a4a8a',
        tileBorderOccupied: '#9a6aaa',
        tileBorderHover: '#ba8aca',
        highlightPulse: true,
        highlightColor: 'rgba(180, 130, 255, 0.4)'
      },

      chrome: {
        borderColor: '#6a4a8a',
        backgroundColor: 'rgba(20, 10, 40, 0.7)',
        accentColor: '#ffd700'
      },

      ambient: {
        particles: ['arcane', 'sparkle', 'mote'],
        lightFlicker: true,
        lightIntensity: 0.85
      },

      button: {
        type: 'spellbook',
        primaryColor: '#4a2882',
        secondaryColor: '#2d1a4e',
        accentColor: '#ffd700'
      }
    };
  }

  init() {
    super.init();
    this.particleTimer = 0;
    this.runeRotation = 0;
    this.pulsePhase = 0;

    // Initialize candle flicker states
    this.candleFlicker = [];
    for (let i = 0; i < 8; i++) {
      this.candleFlicker.push(0.8 + Math.random() * 0.2);
    }
  }

  update(deltaTime) {
    super.update(deltaTime);

    // Rune rotation
    this.runeRotation += deltaTime * 0.0002;

    // Pulse phase for summoning circle
    this.pulsePhase = (this.animationFrame % 3000) / 3000;

    // Update candle flicker
    for (let i = 0; i < this.candleFlicker.length; i++) {
      this.candleFlicker[i] = 0.7 + Math.random() * 0.3;
    }

    // Spawn particles
    this.particleTimer += deltaTime;
    const spawnRate = 100 / this.getParticleMultiplier();

    if (this.particleTimer >= spawnRate) {
      this.particleTimer = 0;
      this.spawnParticles();
    }
  }

  spawnParticles() {
    const canvas = this.scene.gridCanvas;
    if (!canvas) return;

    const types = ['arcane', 'sparkle', 'mote'];
    const type = types[Math.floor(Math.random() * types.length)];
    const particle = this.createParticle(type, canvas.width, canvas.height);

    if (particle) {
      this.particles.push(particle);
    }

    while (this.particles.length > 70) {
      this.particles.shift();
    }
  }

  createParticle(type, width, height) {
    const centerX = width / 2;
    const centerY = height / 2;

    switch (type) {
      case 'arcane':
        // Particles that orbit the center
        const angle = Math.random() * Math.PI * 2;
        const radius = 80 + Math.random() * 40;
        return {
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius * 0.5,
          vx: Math.sin(angle) * 20,
          vy: -Math.cos(angle) * 10 - 15,
          size: 2 + Math.random() * 2,
          color: ['#b480ff', '#8040ff', '#ffd700'][Math.floor(Math.random() * 3)],
          alpha: 0.7,
          life: 2 + Math.random() * 2,
          maxLife: 4
        };

      case 'sparkle':
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: 0,
          vy: 0,
          size: 1 + Math.random(),
          color: '#fff',
          alpha: Math.random(),
          life: 0.5 + Math.random() * 0.5,
          maxLife: 1
        };

      case 'mote':
        return {
          x: Math.random() * width,
          y: height + 10,
          vx: -5 + Math.random() * 10,
          vy: -25 - Math.random() * 15,
          size: 1.5 + Math.random() * 1.5,
          color: 'rgba(255, 215, 0, 0.6)',
          alpha: 0.6,
          life: 3 + Math.random() * 2,
          maxLife: 5
        };

      default:
        return null;
    }
  }

  renderBackground(ctx, width, height) {
    // Dark purple gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#1a0a2e');
    gradient.addColorStop(0.5, '#120820');
    gradient.addColorStop(1, '#0d0518');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Stone walls texture (subtle)
    this.renderStoneWalls(ctx, width, height);

    // Floating candles
    this.renderCandles(ctx, width, height);

    // Summoning circle
    this.renderSummoningCircle(ctx, width, height);

    // Bookshelves silhouettes
    this.renderBookshelves(ctx, width, height);
  }

  renderStoneWalls(ctx, width, height) {
    ctx.globalAlpha = 0.1;
    ctx.strokeStyle = '#3a2a5a';
    ctx.lineWidth = 1;

    // Horizontal stone lines
    for (let y = 0; y < height; y += 25) {
      ctx.beginPath();
      ctx.moveTo(0, y + Math.random() * 5);
      ctx.lineTo(width, y + Math.random() * 5);
      ctx.stroke();
    }

    // Vertical mortar lines
    for (let x = 0; x < width; x += 40) {
      const offset = Math.floor(x / 40) % 2 === 0 ? 0 : 12;
      for (let y = offset; y < height; y += 25) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 12);
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;
  }

  renderCandles(ctx, width, height) {
    const candlePositions = [
      { x: width * 0.1, y: height * 0.2 },
      { x: width * 0.9, y: height * 0.2 },
      { x: width * 0.15, y: height * 0.5 },
      { x: width * 0.85, y: height * 0.5 },
      { x: width * 0.2, y: height * 0.75 },
      { x: width * 0.8, y: height * 0.75 },
      { x: width * 0.35, y: height * 0.15 },
      { x: width * 0.65, y: height * 0.15 }
    ];

    candlePositions.forEach((pos, i) => {
      const flicker = this.candleFlicker[i] || 1;
      const floatOffset = Math.sin(this.animationFrame * 0.002 + i) * 3;

      // Candle glow
      const glow = ctx.createRadialGradient(
        pos.x, pos.y + floatOffset - 8, 0,
        pos.x, pos.y + floatOffset - 8, 25 * flicker
      );
      glow.addColorStop(0, `rgba(255, 200, 100, ${0.3 * flicker})`);
      glow.addColorStop(0.5, `rgba(255, 150, 50, ${0.15 * flicker})`);
      glow.addColorStop(1, 'rgba(255, 100, 0, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y + floatOffset - 8, 25 * flicker, 0, Math.PI * 2);
      ctx.fill();

      // Candle body
      ctx.fillStyle = '#e8dcc8';
      ctx.fillRect(pos.x - 2, pos.y + floatOffset, 4, 12);

      // Flame
      ctx.fillStyle = `rgba(255, ${180 + Math.random() * 40}, 50, ${flicker})`;
      ctx.beginPath();
      ctx.moveTo(pos.x - 3, pos.y + floatOffset);
      ctx.quadraticCurveTo(pos.x, pos.y + floatOffset - 10 * flicker, pos.x + 3, pos.y + floatOffset);
      ctx.fill();
    });
  }

  renderSummoningCircle(ctx, width, height) {
    const centerX = width / 2;
    const centerY = height / 2 + 20;
    const radius = Math.min(width, height) * 0.35;
    const pulseIntensity = 0.5 + Math.sin(this.pulsePhase * Math.PI * 2) * 0.3;

    ctx.save();
    ctx.translate(centerX, centerY);

    // Outer circle glow
    const outerGlow = ctx.createRadialGradient(0, 0, radius * 0.8, 0, 0, radius * 1.2);
    outerGlow.addColorStop(0, `rgba(180, 130, 255, ${0.1 * pulseIntensity})`);
    outerGlow.addColorStop(1, 'rgba(180, 130, 255, 0)');
    ctx.fillStyle = outerGlow;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.2, 0, Math.PI * 2);
    ctx.fill();

    // Main circle
    ctx.strokeStyle = `rgba(180, 130, 255, ${0.6 * pulseIntensity})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Inner circle
    ctx.strokeStyle = `rgba(255, 215, 0, ${0.5 * pulseIntensity})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.7, 0, Math.PI * 2);
    ctx.stroke();

    // Rotating runes
    ctx.rotate(this.runeRotation);
    const runes = ['⚝', '✧', '◈', '✦', '⬡', '◇'];
    ctx.font = '14px serif';
    ctx.fillStyle = `rgba(255, 215, 0, ${0.7 * pulseIntensity})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const runeX = Math.cos(angle) * radius * 0.85;
      const runeY = Math.sin(angle) * radius * 0.85;
      ctx.fillText(runes[i], runeX, runeY);
    }

    // Pentagram (subtle)
    ctx.rotate(-this.runeRotation);
    ctx.strokeStyle = `rgba(180, 130, 255, ${0.3 * pulseIntensity})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const angle = (i * 4 * Math.PI / 5) - Math.PI / 2;
      const x = Math.cos(angle) * radius * 0.6;
      const y = Math.sin(angle) * radius * 0.6;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.restore();
  }

  renderBookshelves(ctx, width, height) {
    // Left bookshelf silhouette
    ctx.fillStyle = 'rgba(15, 5, 25, 0.8)';
    ctx.fillRect(0, height * 0.1, width * 0.08, height * 0.85);

    // Right bookshelf silhouette
    ctx.fillRect(width * 0.92, height * 0.1, width * 0.08, height * 0.85);

    // Book spines (subtle)
    ctx.fillStyle = 'rgba(60, 40, 80, 0.5)';
    for (let y = height * 0.15; y < height * 0.9; y += 20) {
      ctx.fillRect(2, y, width * 0.06, 15);
      ctx.fillRect(width * 0.94, y, width * 0.06, 15);
    }
  }

  getContainerStyles() {
    return `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(180deg, #1a0a2e 0%, #0d0518 100%);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `;
  }

  getTitle() {
    return 'The Arcane Trial';
  }
}
