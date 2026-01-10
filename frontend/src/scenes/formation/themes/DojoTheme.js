import { FormationTheme } from '../FormationTheme.js';

/**
 * DojoTheme - Monk Guild advancement battle formation
 *
 * Traditional Asian dojo with wooden floors, shoji screens,
 * hanging scrolls, incense, and serene atmosphere.
 */
export class DojoTheme extends FormationTheme {
  constructor(scene) {
    super(scene);
    this.particleTimer = 0;
    this.incenseWave = 0;
    this.lightShift = 0;
  }

  static get config() {
    return {
      name: 'dojo',

      background: {
        gradient: ['#f5e6d3', '#e8d4c0'],
        gradientAngle: 180
      },

      grid: {
        tileColor: '#c4a882',
        tileColorOccupied: '#b8986a',
        tileColorHover: '#d4b892',
        tileBorder: '#8b7355',
        tileBorderOccupied: '#f9a825',
        tileBorderHover: '#ffc107',
        highlightPulse: true,
        highlightColor: 'rgba(249, 168, 37, 0.4)'
      },

      chrome: {
        borderColor: '#8b7355',
        backgroundColor: 'rgba(245, 230, 211, 0.8)',
        accentColor: '#c62828'
      },

      ambient: {
        particles: ['incense', 'dust', 'petal'],
        lightFlicker: false,
        lightIntensity: 1.0
      },

      button: {
        type: 'palm',
        primaryColor: '#8b7355',
        secondaryColor: '#5a4a3a',
        accentColor: '#c62828'
      }
    };
  }

  init() {
    super.init();
    this.particleTimer = 0;
    this.incenseWave = 0;
    this.lightShift = 0;
  }

  update(deltaTime) {
    super.update(deltaTime);

    // Incense smoke wave
    this.incenseWave = (this.animationFrame % 4000) / 4000;

    // Light shifting through screens
    this.lightShift = Math.sin(this.animationFrame * 0.0005) * 0.1;

    // Spawn particles
    this.particleTimer += deltaTime;
    const spawnRate = 300 / this.getParticleMultiplier();

    if (this.particleTimer >= spawnRate) {
      this.particleTimer = 0;
      this.spawnParticles();
    }
  }

  spawnParticles() {
    const canvas = this.scene.gridCanvas;
    if (!canvas) return;

    const types = ['incense', 'dust', 'petal'];
    const weights = [0.5, 0.35, 0.15]; // Weighted selection
    let rand = Math.random();
    let type = types[0];

    for (let i = 0; i < weights.length; i++) {
      if (rand < weights[i]) {
        type = types[i];
        break;
      }
      rand -= weights[i];
    }

    const particle = this.createParticle(type, canvas.width, canvas.height);

    if (particle) {
      this.particles.push(particle);
    }

    while (this.particles.length > 40) {
      this.particles.shift();
    }
  }

  createParticle(type, width, height) {
    switch (type) {
      case 'incense':
        return {
          x: width * 0.15,
          y: height * 0.7,
          vx: 3 + Math.random() * 5,
          vy: -8 - Math.random() * 5,
          size: 8 + Math.random() * 12,
          color: 'rgba(180, 170, 160, 0.15)',
          alpha: 0.15,
          life: 4 + Math.random() * 3,
          maxLife: 7
        };

      case 'dust':
        return {
          x: Math.random() * width,
          y: Math.random() * height * 0.5,
          vx: -1 + Math.random() * 2,
          vy: 0.5 + Math.random(),
          size: 1 + Math.random(),
          color: 'rgba(200, 180, 150, 0.4)',
          alpha: 0.4,
          life: 5 + Math.random() * 3,
          maxLife: 8
        };

      case 'petal':
        return {
          x: Math.random() * width,
          y: -10,
          vx: -5 + Math.random() * 3,
          vy: 15 + Math.random() * 10,
          size: 3 + Math.random() * 2,
          color: ['#ffb7c5', '#ffc0cb', '#ff9999'][Math.floor(Math.random() * 3)],
          alpha: 0.7,
          life: 4 + Math.random() * 2,
          maxLife: 6
        };

      default:
        return null;
    }
  }

  renderBackground(ctx, width, height) {
    // Warm cream background
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, `rgba(245, 230, 211, ${1 + this.lightShift})`);
    gradient.addColorStop(1, '#e8d4c0');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Wooden floor
    this.renderWoodenFloor(ctx, width, height);

    // Shoji screens (left and right)
    this.renderShojiScreens(ctx, width, height);

    // Hanging scrolls
    this.renderScrolls(ctx, width, height);

    // Incense burner
    this.renderIncenseBurner(ctx, width, height);

    // Light beams through screens
    this.renderLightBeams(ctx, width, height);
  }

  renderWoodenFloor(ctx, width, height) {
    const floorY = height * 0.55;

    // Floor base color
    ctx.fillStyle = '#c4a882';
    ctx.fillRect(0, floorY, width, height - floorY);

    // Wood grain lines
    ctx.strokeStyle = 'rgba(139, 115, 85, 0.3)';
    ctx.lineWidth = 1;

    const plankWidth = 40;
    for (let x = 0; x < width; x += plankWidth) {
      ctx.beginPath();
      ctx.moveTo(x, floorY);
      ctx.lineTo(x, height);
      ctx.stroke();

      // Grain within planks
      for (let y = floorY; y < height; y += 15) {
        ctx.beginPath();
        ctx.moveTo(x + 5, y);
        ctx.bezierCurveTo(
          x + plankWidth * 0.3, y + 3,
          x + plankWidth * 0.7, y - 3,
          x + plankWidth - 5, y
        );
        ctx.stroke();
      }
    }

    // Floor edge/platform
    ctx.fillStyle = '#8b7355';
    ctx.fillRect(0, floorY - 3, width, 6);
  }

  renderShojiScreens(ctx, width, height) {
    const screenHeight = height * 0.6;

    // Left screen
    this.drawShojiScreen(ctx, 0, 0, width * 0.1, screenHeight);

    // Right screen
    this.drawShojiScreen(ctx, width * 0.9, 0, width * 0.1, screenHeight);

    // Back wall screens (partial)
    ctx.fillStyle = 'rgba(245, 240, 230, 0.3)';
    ctx.fillRect(width * 0.1, 0, width * 0.8, height * 0.15);
  }

  drawShojiScreen(ctx, x, y, w, h) {
    // Screen frame
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect(x, y, w, h);

    // Paper panels
    ctx.fillStyle = 'rgba(255, 250, 240, 0.9)';
    const panelPadding = 4;
    const panelW = w - panelPadding * 2;
    const panelH = (h - panelPadding * 4) / 3;

    for (let i = 0; i < 3; i++) {
      ctx.fillRect(
        x + panelPadding,
        y + panelPadding + i * (panelH + panelPadding),
        panelW,
        panelH
      );
    }

    // Grid lines on panels
    ctx.strokeStyle = '#8b7355';
    ctx.lineWidth = 1;

    for (let i = 0; i < 3; i++) {
      const panelY = y + panelPadding + i * (panelH + panelPadding);

      // Horizontal lines
      ctx.beginPath();
      ctx.moveTo(x + panelPadding, panelY + panelH / 2);
      ctx.lineTo(x + panelPadding + panelW, panelY + panelH / 2);
      ctx.stroke();

      // Vertical lines
      ctx.beginPath();
      ctx.moveTo(x + panelPadding + panelW / 2, panelY);
      ctx.lineTo(x + panelPadding + panelW / 2, panelY + panelH);
      ctx.stroke();
    }
  }

  renderScrolls(ctx, width, height) {
    const scrollPositions = [
      { x: width * 0.25, y: height * 0.05 },
      { x: width * 0.75, y: height * 0.05 }
    ];

    scrollPositions.forEach((pos, i) => {
      // Scroll rod (top)
      ctx.fillStyle = '#3a2a1a';
      ctx.fillRect(pos.x - 25, pos.y, 50, 6);

      // Scroll paper
      ctx.fillStyle = '#f5f0e5';
      ctx.fillRect(pos.x - 20, pos.y + 6, 40, height * 0.35);

      // Scroll rod (bottom)
      ctx.fillStyle = '#3a2a1a';
      ctx.fillRect(pos.x - 25, pos.y + 6 + height * 0.35, 50, 6);

      // Calligraphy (simple representation)
      ctx.fillStyle = '#2a2a2a';
      ctx.font = '16px serif';
      ctx.textAlign = 'center';

      const characters = i === 0 ? ['道', '心', '技'] : ['勇', '気', '力'];
      characters.forEach((char, j) => {
        ctx.fillText(char, pos.x, pos.y + 30 + j * 35);
      });
    });
  }

  renderIncenseBurner(ctx, width, height) {
    const burnerX = width * 0.15;
    const burnerY = height * 0.65;

    // Stand
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(burnerX - 15, burnerY + 15, 30, 5);
    ctx.fillRect(burnerX - 3, burnerY + 5, 6, 10);

    // Bowl
    ctx.fillStyle = '#4a4a4a';
    ctx.beginPath();
    ctx.ellipse(burnerX, burnerY, 12, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Ash/sand inside
    ctx.fillStyle = '#8a8a8a';
    ctx.beginPath();
    ctx.ellipse(burnerX, burnerY - 2, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Incense stick
    ctx.fillStyle = '#654321';
    ctx.save();
    ctx.translate(burnerX + 3, burnerY - 3);
    ctx.rotate(-0.2);
    ctx.fillRect(0, 0, 2, -25);
    ctx.restore();

    // Glowing tip
    ctx.fillStyle = '#ff6b00';
    ctx.beginPath();
    ctx.arc(burnerX + 2, burnerY - 27, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  renderLightBeams(ctx, width, height) {
    // Soft light coming through screens
    ctx.globalAlpha = 0.1 + this.lightShift * 0.5;

    // Left light beam
    const leftGradient = ctx.createLinearGradient(0, 0, width * 0.3, height * 0.5);
    leftGradient.addColorStop(0, 'rgba(255, 250, 230, 0.3)');
    leftGradient.addColorStop(1, 'rgba(255, 250, 230, 0)');
    ctx.fillStyle = leftGradient;
    ctx.beginPath();
    ctx.moveTo(width * 0.1, 0);
    ctx.lineTo(width * 0.3, height * 0.5);
    ctx.lineTo(width * 0.15, height * 0.5);
    ctx.lineTo(0, 0);
    ctx.fill();

    // Right light beam
    const rightGradient = ctx.createLinearGradient(width, 0, width * 0.7, height * 0.5);
    rightGradient.addColorStop(0, 'rgba(255, 250, 230, 0.3)');
    rightGradient.addColorStop(1, 'rgba(255, 250, 230, 0)');
    ctx.fillStyle = rightGradient;
    ctx.beginPath();
    ctx.moveTo(width * 0.9, 0);
    ctx.lineTo(width * 0.7, height * 0.5);
    ctx.lineTo(width * 0.85, height * 0.5);
    ctx.lineTo(width, 0);
    ctx.fill();

    ctx.globalAlpha = 1;
  }

  getTileColor(isOccupied, isHovered, isPressed) {
    if (isPressed) return '#a08060';
    if (isOccupied) return '#b8986a';
    if (isHovered) return '#d4b892';
    return '#c4a882';
  }

  getContainerStyles() {
    return `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(180deg, #f5e6d3 0%, #e8d4c0 100%);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `;
  }

  getTitle() {
    return 'Path of Discipline';
  }
}
