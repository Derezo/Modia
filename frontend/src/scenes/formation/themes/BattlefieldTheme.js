import { FormationTheme } from '../FormationTheme.js';

/**
 * BattlefieldTheme - Standard node battle formation
 *
 * Miniature diorama style with actual biome terrain tiles.
 * Used for forest, cave, mountain, bridge battles.
 */
export class BattlefieldTheme extends FormationTheme {
  constructor(scene, nodeType = 'forest') {
    super(scene);
    this.nodeType = nodeType;
    this.particleTimer = 0;
    this.terrainTiles = null;
  }

  static get config() {
    return {
      name: 'battlefield',

      background: {
        gradient: ['#1a2a1a', '#16213e'],
        gradientAngle: 180
      },

      grid: {
        tileColor: '#3d5c3d',
        tileColorOccupied: '#2a4a2a',
        tileColorHover: '#4a6a4a',
        tileBorder: '#2d4a2d',
        tileBorderOccupied: '#4caf50',
        tileBorderHover: '#8bc34a',
        highlightPulse: true,
        highlightColor: 'rgba(255, 215, 0, 0.4)'
      },

      chrome: {
        borderColor: '#5a4a3a',
        backgroundColor: 'rgba(30, 25, 20, 0.6)',
        accentColor: '#6b2d3d',  // Burgundy accent
        frameTexture: 'wood'
      },

      ambient: {
        particles: ['leaf', 'dust', 'mote'],
        lightFlicker: true,
        lightIntensity: 1.0
      },

      button: {
        type: 'swords',
        primaryColor: '#7a8a6a',
        secondaryColor: '#5a6a4a',
        accentColor: '#ffd700'
      }
    };
  }

  /**
   * Get biome-specific configuration overrides
   */
  getBiomeConfig() {
    const biomes = {
      forest: {
        gradient: ['#1a2a1a', '#0f1f0f'],
        particles: ['leaf', 'dust'],
        tileColor: '#3d5c3d',
        ambientColor: 'rgba(100, 150, 80, 0.1)'
      },
      cave: {
        gradient: ['#1a1a2a', '#0f0f1f'],
        particles: ['dust', 'sparkle'],
        tileColor: '#4a4a5a',
        ambientColor: 'rgba(100, 100, 150, 0.1)'
      },
      mountain: {
        gradient: ['#2a2a3a', '#1f1f2a'],
        particles: ['snow', 'dust'],
        tileColor: '#5a5a6a',
        ambientColor: 'rgba(150, 150, 180, 0.1)'
      },
      bridge: {
        gradient: ['#2a2a1a', '#1f1f0f'],
        particles: ['mist', 'dust'],
        tileColor: '#5a4a3a',
        ambientColor: 'rgba(150, 140, 120, 0.1)'
      }
    };

    return biomes[this.nodeType] || biomes.forest;
  }

  init() {
    super.init();
    this.particleTimer = 0;
  }

  update(deltaTime) {
    super.update(deltaTime);

    // Spawn particles periodically
    this.particleTimer += deltaTime;
    const spawnRate = 200 / this.getParticleMultiplier(); // Faster with tension

    if (this.particleTimer >= spawnRate) {
      this.particleTimer = 0;
      this.spawnParticles();
    }
  }

  spawnParticles() {
    const biome = this.getBiomeConfig();
    const canvas = this.scene.gridCanvas;
    if (!canvas) return;

    const particleType = biome.particles[Math.floor(Math.random() * biome.particles.length)];
    const particle = this.createParticle(particleType, canvas.width, canvas.height);
    if (particle) {
      this.particles.push(particle);
    }

    // Limit particle count for performance
    while (this.particles.length > 50) {
      this.particles.shift();
    }
  }

  createParticle(type, width, height) {
    const baseParticle = {
      x: Math.random() * width,
      y: -10,
      size: 2 + Math.random() * 3,
      alpha: 0.3 + Math.random() * 0.4,
      life: 3 + Math.random() * 2,
      maxLife: 5
    };

    switch (type) {
      case 'leaf':
        return {
          ...baseParticle,
          color: ['#4a6a3a', '#5a7a4a', '#3a5a2a'][Math.floor(Math.random() * 3)],
          vx: -20 + Math.random() * 10,
          vy: 30 + Math.random() * 20,
          size: 3 + Math.random() * 2
        };

      case 'dust':
        return {
          ...baseParticle,
          x: Math.random() * width,
          y: Math.random() * height,
          color: 'rgba(200, 180, 150, 0.5)',
          vx: -5 + Math.random() * 10,
          vy: -2 + Math.random() * 4,
          size: 1 + Math.random() * 2,
          life: 2 + Math.random() * 3
        };

      case 'sparkle':
        return {
          ...baseParticle,
          x: Math.random() * width,
          y: Math.random() * height,
          color: ['#7a9aff', '#9abaff', '#5a7aff'][Math.floor(Math.random() * 3)],
          vx: 0,
          vy: -10 - Math.random() * 5,
          size: 1 + Math.random() * 2,
          alpha: 0.5 + Math.random() * 0.5
        };

      case 'snow':
        return {
          ...baseParticle,
          color: 'rgba(255, 255, 255, 0.7)',
          vx: -10 + Math.random() * 20,
          vy: 20 + Math.random() * 15,
          size: 2 + Math.random() * 2
        };

      case 'mist':
        return {
          ...baseParticle,
          x: -20,
          y: height * 0.6 + Math.random() * height * 0.4,
          color: 'rgba(200, 200, 220, 0.2)',
          vx: 15 + Math.random() * 10,
          vy: -2 + Math.random() * 4,
          size: 20 + Math.random() * 30,
          alpha: 0.1 + Math.random() * 0.1,
          life: 5 + Math.random() * 3
        };

      case 'mote':
        return {
          ...baseParticle,
          x: Math.random() * width,
          y: Math.random() * height,
          color: 'rgba(255, 230, 150, 0.6)',
          vx: -2 + Math.random() * 4,
          vy: -5 - Math.random() * 5,
          size: 1 + Math.random(),
          alpha: 0.3 + Math.random() * 0.4
        };

      default:
        return null;
    }
  }

  renderBackground(ctx, width, height) {
    const biome = this.getBiomeConfig();

    // Gradient background
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, biome.gradient[0]);
    gradient.addColorStop(1, biome.gradient[1]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Ambient color overlay
    ctx.fillStyle = biome.ambientColor;
    ctx.fillRect(0, 0, width, height);
  }

  /**
   * Render diorama platform shadow
   */
  renderPlatformShadow(ctx, x, y, width, height) {
    ctx.save();

    // Platform shadow beneath the grid
    const shadowGradient = ctx.createRadialGradient(
      x + width / 2, y + height + 20, 0,
      x + width / 2, y + height + 20, width * 0.6
    );
    shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0.4)');
    shadowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = shadowGradient;
    ctx.beginPath();
    ctx.ellipse(x + width / 2, y + height + 20, width * 0.6, 15, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  getTileColor(isOccupied, isHovered, isPressed) {
    if (isPressed) return '#8b0000';

    const biome = this.getBiomeConfig();

    if (isOccupied) {
      // Slightly darker version of biome tile color
      return this.darkenColor(biome.tileColor, 0.2);
    }
    if (isHovered) {
      // Slightly lighter version
      return this.lightenColor(biome.tileColor, 0.15);
    }

    return biome.tileColor;
  }

  darkenColor(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.max(0, (num >> 16) - Math.floor(255 * amount));
    const g = Math.max(0, ((num >> 8) & 0x00FF) - Math.floor(255 * amount));
    const b = Math.max(0, (num & 0x0000FF) - Math.floor(255 * amount));
    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
  }

  lightenColor(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.min(255, (num >> 16) + Math.floor(255 * amount));
    const g = Math.min(255, ((num >> 8) & 0x00FF) + Math.floor(255 * amount));
    const b = Math.min(255, (num & 0x0000FF) + Math.floor(255 * amount));
    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
  }

  getContainerStyles() {
    const biome = this.getBiomeConfig();

    return `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(180deg, ${biome.gradient[0]} 0%, ${biome.gradient[1]} 100%);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `;
  }

  getTitle() {
    const titles = {
      forest: 'Into the Wilderness',
      cave: 'Descend into Darkness',
      mountain: 'Scale the Heights',
      bridge: 'Hold the Crossing'
    };
    return titles[this.nodeType] || 'Prepare for Battle!';
  }
}
