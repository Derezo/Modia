import { FormationTheme } from '../FormationTheme.js';

/**
 * ArmoryTheme - Warrior Guild advancement battle formation
 *
 * Armory staging ground with weapon racks, armor stands,
 * glowing forge, and martial preparation atmosphere.
 */
export class ArmoryTheme extends FormationTheme {
  constructor(scene) {
    super(scene);
    this.particleTimer = 0;
    this.forgeGlow = 1.0;
    this.sparkTimer = 0;
  }

  static get config() {
    return {
      name: 'armory',

      background: {
        gradient: ['#2a2020', '#1a1515'],
        gradientAngle: 180
      },

      grid: {
        tileColor: '#3a3535',
        tileColorOccupied: '#4a4545',
        tileColorHover: '#5a5555',
        tileBorder: '#5a4a4a',
        tileBorderOccupied: '#c62828',
        tileBorderHover: '#ef5350',
        highlightPulse: true,
        highlightColor: 'rgba(255, 100, 50, 0.4)'
      },

      chrome: {
        borderColor: '#5a4a4a',
        backgroundColor: 'rgba(30, 20, 20, 0.7)',
        accentColor: '#ff6b35'
      },

      ambient: {
        particles: ['spark', 'ember', 'smoke'],
        lightFlicker: true,
        lightIntensity: 0.95
      },

      button: {
        type: 'axe',
        primaryColor: '#8b4513',
        secondaryColor: '#5a3020',
        accentColor: '#ff6b35'
      }
    };
  }

  init() {
    super.init();
    this.particleTimer = 0;
    this.forgeGlow = 1.0;
    this.sparkTimer = 0;
  }

  update(deltaTime) {
    super.update(deltaTime);

    // Forge glow pulsing
    this.forgeGlow = 0.8 + Math.sin(this.animationFrame * 0.003) * 0.2;

    // Spark burst timing
    this.sparkTimer += deltaTime;
    if (this.sparkTimer > 2000) {
      this.sparkTimer = 0;
      this.createSparkBurst();
    }

    // Regular particles
    this.particleTimer += deltaTime;
    const spawnRate = 180 / this.getParticleMultiplier();

    if (this.particleTimer >= spawnRate) {
      this.particleTimer = 0;
      this.spawnParticles();
    }
  }

  createSparkBurst() {
    const canvas = this.scene.gridCanvas;
    if (!canvas) return;

    // Burst of sparks from the forge
    for (let i = 0; i < 8; i++) {
      this.particles.push({
        x: canvas.width * 0.85,
        y: canvas.height * 0.6,
        vx: -30 - Math.random() * 40,
        vy: -50 - Math.random() * 30,
        size: 1 + Math.random() * 2,
        color: ['#ff6b00', '#ffa500', '#ffcc00'][Math.floor(Math.random() * 3)],
        alpha: 1,
        life: 0.8 + Math.random() * 0.5,
        maxLife: 1.3
      });
    }
  }

  spawnParticles() {
    const canvas = this.scene.gridCanvas;
    if (!canvas) return;

    const types = ['ember', 'smoke'];
    const type = types[Math.floor(Math.random() * types.length)];
    const particle = this.createParticle(type, canvas.width, canvas.height);

    if (particle) {
      this.particles.push(particle);
    }

    while (this.particles.length > 50) {
      this.particles.shift();
    }
  }

  createParticle(type, width, height) {
    switch (type) {
      case 'ember':
        return {
          x: width * 0.8 + Math.random() * width * 0.15,
          y: height * 0.5 + Math.random() * height * 0.3,
          vx: -10 - Math.random() * 15,
          vy: -20 - Math.random() * 15,
          size: 1 + Math.random() * 1.5,
          color: ['#ff6b00', '#ff8c00'][Math.floor(Math.random() * 2)],
          alpha: 0.8,
          life: 1.5 + Math.random() * 1,
          maxLife: 2.5
        };

      case 'smoke':
        return {
          x: width * 0.85,
          y: height * 0.4,
          vx: -5 + Math.random() * 10,
          vy: -15 - Math.random() * 10,
          size: 20 + Math.random() * 25,
          color: 'rgba(60, 50, 50, 0.2)',
          alpha: 0.2,
          life: 3 + Math.random() * 2,
          maxLife: 5
        };

      default:
        return null;
    }
  }

  renderBackground(ctx, width, height) {
    // Dark stone gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#2a2020');
    gradient.addColorStop(0.5, '#201818');
    gradient.addColorStop(1, '#1a1515');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Stone floor texture
    this.renderStoneFloor(ctx, width, height);

    // Weapon racks on left
    this.renderWeaponRacks(ctx, width, height);

    // Armor stands on right
    this.renderArmorStands(ctx, width, height);

    // Forge in corner
    this.renderForge(ctx, width, height);

    // Ambient metal gleams
    this.renderMetalGleams(ctx, width, height);
  }

  renderStoneFloor(ctx, width, height) {
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = '#4a3a3a';
    ctx.lineWidth = 1;

    // Floor stone pattern
    const stoneSize = 30;
    for (let y = height * 0.6; y < height; y += stoneSize) {
      for (let x = 0; x < width; x += stoneSize * 1.5) {
        const offset = Math.floor(y / stoneSize) % 2 === 0 ? stoneSize * 0.75 : 0;
        ctx.strokeRect(x + offset, y, stoneSize * 1.4, stoneSize * 0.9);
      }
    }

    ctx.globalAlpha = 1;
  }

  renderWeaponRacks(ctx, width, height) {
    const rackX = width * 0.05;
    const rackWidth = width * 0.12;

    // Rack frame
    ctx.fillStyle = '#3a2a20';
    ctx.fillRect(rackX, height * 0.15, rackWidth, height * 0.7);

    // Horizontal bars
    ctx.fillStyle = '#2a1a10';
    for (let y = height * 0.2; y < height * 0.8; y += 40) {
      ctx.fillRect(rackX, y, rackWidth, 4);
    }

    // Weapons (silhouettes)
    const weapons = [
      { type: 'sword', y: height * 0.22 },
      { type: 'axe', y: height * 0.35 },
      { type: 'spear', y: height * 0.48 },
      { type: 'mace', y: height * 0.61 },
      { type: 'sword', y: height * 0.74 }
    ];

    ctx.fillStyle = '#5a5a6a';
    weapons.forEach(w => {
      const wx = rackX + rackWidth * 0.3;
      switch (w.type) {
        case 'sword':
          ctx.fillRect(wx, w.y, 3, 35);
          ctx.fillRect(wx - 6, w.y + 28, 15, 4);
          break;
        case 'axe':
          ctx.fillRect(wx, w.y, 3, 35);
          ctx.beginPath();
          ctx.moveTo(wx - 8, w.y + 5);
          ctx.lineTo(wx + 2, w.y);
          ctx.lineTo(wx + 2, w.y + 15);
          ctx.fill();
          break;
        case 'spear':
          ctx.fillRect(wx, w.y, 2, 40);
          ctx.beginPath();
          ctx.moveTo(wx + 1, w.y - 8);
          ctx.lineTo(wx - 3, w.y);
          ctx.lineTo(wx + 5, w.y);
          ctx.fill();
          break;
        case 'mace':
          ctx.fillRect(wx, w.y + 10, 3, 25);
          ctx.beginPath();
          ctx.arc(wx + 1, w.y + 6, 8, 0, Math.PI * 2);
          ctx.fill();
          break;
      }
    });
  }

  renderArmorStands(ctx, width, height) {
    const standPositions = [
      { x: width * 0.12, y: height * 0.3 },
      { x: width * 0.2, y: height * 0.35 }
    ];

    standPositions.forEach(pos => {
      // Stand base
      ctx.fillStyle = '#2a2020';
      ctx.fillRect(pos.x - 8, pos.y + 45, 16, 5);
      ctx.fillRect(pos.x - 2, pos.y + 20, 4, 25);

      // Armor silhouette
      ctx.fillStyle = '#4a4a5a';

      // Helmet
      ctx.beginPath();
      ctx.arc(pos.x, pos.y - 15, 10, 0, Math.PI * 2);
      ctx.fill();

      // Chestplate
      ctx.beginPath();
      ctx.moveTo(pos.x - 12, pos.y);
      ctx.lineTo(pos.x + 12, pos.y);
      ctx.lineTo(pos.x + 10, pos.y + 25);
      ctx.lineTo(pos.x - 10, pos.y + 25);
      ctx.closePath();
      ctx.fill();

      // Shoulder plates
      ctx.beginPath();
      ctx.ellipse(pos.x - 14, pos.y + 2, 6, 4, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(pos.x + 14, pos.y + 2, 6, 4, 0.3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  renderForge(ctx, width, height) {
    const forgeX = width * 0.82;
    const forgeY = height * 0.45;

    // Forge body
    ctx.fillStyle = '#2a2020';
    ctx.fillRect(forgeX - 30, forgeY, 60, 50);

    // Forge opening
    ctx.fillStyle = '#1a1010';
    ctx.fillRect(forgeX - 20, forgeY + 10, 40, 30);

    // Fire glow
    const fireGlow = ctx.createRadialGradient(
      forgeX, forgeY + 25, 0,
      forgeX, forgeY + 25, 50 * this.forgeGlow
    );
    fireGlow.addColorStop(0, `rgba(255, 100, 0, ${0.6 * this.forgeGlow})`);
    fireGlow.addColorStop(0.5, `rgba(255, 50, 0, ${0.3 * this.forgeGlow})`);
    fireGlow.addColorStop(1, 'rgba(255, 0, 0, 0)');
    ctx.fillStyle = fireGlow;
    ctx.beginPath();
    ctx.arc(forgeX, forgeY + 25, 50 * this.forgeGlow, 0, Math.PI * 2);
    ctx.fill();

    // Fire inside
    ctx.fillStyle = `rgba(255, ${150 + Math.random() * 50}, 0, ${0.9 * this.forgeGlow})`;
    ctx.beginPath();
    ctx.moveTo(forgeX - 15, forgeY + 35);
    ctx.quadraticCurveTo(forgeX - 8, forgeY + 10, forgeX, forgeY + 38);
    ctx.quadraticCurveTo(forgeX + 8, forgeY + 15, forgeX + 15, forgeY + 35);
    ctx.fill();

    // Anvil nearby
    ctx.fillStyle = '#3a3a4a';
    ctx.fillRect(forgeX - 50, forgeY + 35, 25, 15);
    ctx.fillRect(forgeX - 45, forgeY + 30, 15, 5);

    // Chimney/hood
    ctx.fillStyle = '#2a2020';
    ctx.beginPath();
    ctx.moveTo(forgeX - 35, forgeY);
    ctx.lineTo(forgeX + 35, forgeY);
    ctx.lineTo(forgeX + 20, forgeY - 40);
    ctx.lineTo(forgeX - 20, forgeY - 40);
    ctx.closePath();
    ctx.fill();
  }

  renderMetalGleams(ctx, width, height) {
    // Random metal gleams on weapons
    ctx.globalAlpha = 0.4 + Math.random() * 0.3;

    const gleamPositions = [
      { x: width * 0.08, y: height * 0.25 },
      { x: width * 0.09, y: height * 0.52 },
      { x: width * 0.15, y: height * 0.32 }
    ];

    ctx.fillStyle = '#fff';
    gleamPositions.forEach(pos => {
      if (Math.random() > 0.7) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    ctx.globalAlpha = 1;
  }

  getContainerStyles() {
    return `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(180deg, #2a2020 0%, #1a1515 100%);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `;
  }

  getTitle() {
    return 'Prove Your Steel';
  }
}
