import { FormationTheme } from '../FormationTheme.js';

/**
 * ClockworkTheme - Chemist Guild advancement battle formation
 *
 * Steampunk clockwork factory with turning gears, steam pipes,
 * bubbling beakers, brass aesthetic, and mechanical atmosphere.
 */
export class ClockworkTheme extends FormationTheme {
  constructor(scene) {
    super(scene);
    this.particleTimer = 0;
    this.gearRotation = 0;
    this.steamBurstTimer = 0;
    this.bubbleTimer = 0;
  }

  static get config() {
    return {
      name: 'clockwork',

      background: {
        gradient: ['#2a2520', '#1a1510'],
        gradientAngle: 180
      },

      grid: {
        tileColor: '#4a4030',
        tileColorOccupied: '#5a5040',
        tileColorHover: '#6a6050',
        tileBorder: '#8b7355',
        tileBorderOccupied: '#d4a550',
        tileBorderHover: '#e8c060',
        highlightPulse: true,
        highlightColor: 'rgba(212, 165, 80, 0.4)'
      },

      chrome: {
        borderColor: '#8b7355',
        backgroundColor: 'rgba(30, 25, 20, 0.8)',
        accentColor: '#4caf50'
      },

      ambient: {
        particles: ['steam', 'spark', 'bubble'],
        lightFlicker: true,
        lightIntensity: 0.9
      },

      button: {
        type: 'lever',
        primaryColor: '#8b7355',
        secondaryColor: '#5a4a3a',
        accentColor: '#4caf50'
      }
    };
  }

  init() {
    super.init();
    this.particleTimer = 0;
    this.gearRotation = 0;
    this.steamBurstTimer = 0;
    this.bubbleTimer = 0;
  }

  update(deltaTime) {
    super.update(deltaTime);

    // Gear rotation
    this.gearRotation += deltaTime * 0.0003;

    // Steam burst timing
    this.steamBurstTimer += deltaTime;
    if (this.steamBurstTimer > 3000) {
      this.steamBurstTimer = 0;
      this.createSteamBurst();
    }

    // Bubble timing
    this.bubbleTimer += deltaTime;
    if (this.bubbleTimer > 500) {
      this.bubbleTimer = 0;
      this.createBubble();
    }

    // Regular particles
    this.particleTimer += deltaTime;
    const spawnRate = 200 / this.getParticleMultiplier();

    if (this.particleTimer >= spawnRate) {
      this.particleTimer = 0;
      this.spawnParticles();
    }
  }

  createSteamBurst() {
    const canvas = this.scene.gridCanvas;
    if (!canvas) return;

    // Burst of steam from random pipe
    const pipeX = Math.random() < 0.5 ? canvas.width * 0.1 : canvas.width * 0.9;

    for (let i = 0; i < 6; i++) {
      this.particles.push({
        x: pipeX,
        y: canvas.height * (0.3 + Math.random() * 0.3),
        vx: (pipeX < canvas.width / 2 ? 1 : -1) * (20 + Math.random() * 15),
        vy: -10 - Math.random() * 10,
        size: 15 + Math.random() * 20,
        color: 'rgba(255, 255, 255, 0.3)',
        alpha: 0.3,
        life: 1.5 + Math.random(),
        maxLife: 2.5
      });
    }
  }

  createBubble() {
    const canvas = this.scene.gridCanvas;
    if (!canvas) return;

    // Bubble from beaker
    this.particles.push({
      x: canvas.width * 0.85 + Math.random() * 20 - 10,
      y: canvas.height * 0.75,
      vx: -2 + Math.random() * 4,
      vy: -15 - Math.random() * 10,
      size: 3 + Math.random() * 4,
      color: ['rgba(100, 255, 100, 0.5)', 'rgba(150, 100, 255, 0.5)', 'rgba(255, 200, 100, 0.5)'][Math.floor(Math.random() * 3)],
      alpha: 0.5,
      life: 1 + Math.random(),
      maxLife: 2
    });
  }

  spawnParticles() {
    const canvas = this.scene.gridCanvas;
    if (!canvas) return;

    const types = ['steam', 'spark'];
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
      case 'steam':
        const pipeX = Math.random() < 0.5 ? width * 0.08 : width * 0.92;
        return {
          x: pipeX,
          y: height * 0.4 + Math.random() * height * 0.2,
          vx: (pipeX < width / 2 ? 1 : -1) * (5 + Math.random() * 8),
          vy: -5 - Math.random() * 5,
          size: 10 + Math.random() * 15,
          color: 'rgba(200, 200, 200, 0.15)',
          alpha: 0.15,
          life: 2 + Math.random() * 2,
          maxLife: 4
        };

      case 'spark':
        return {
          x: width * 0.1 + Math.random() * width * 0.1,
          y: height * 0.2 + Math.random() * height * 0.3,
          vx: 5 + Math.random() * 10,
          vy: Math.random() * 10 - 5,
          size: 1 + Math.random(),
          color: '#ffcc00',
          alpha: 0.8,
          life: 0.5 + Math.random() * 0.5,
          maxLife: 1
        };

      default:
        return null;
    }
  }

  renderBackground(ctx, width, height) {
    // Dark bronze gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#2a2520');
    gradient.addColorStop(0.5, '#201a15');
    gradient.addColorStop(1, '#1a1510');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Metal floor
    this.renderMetalFloor(ctx, width, height);

    // Large gears on walls
    this.renderGears(ctx, width, height);

    // Steam pipes
    this.renderSteamPipes(ctx, width, height);

    // Potion rack
    this.renderPotionRack(ctx, width, height);

    // Mechanical arms (decorative)
    this.renderMechanicalArms(ctx, width, height);

    // Control panel
    this.renderControlPanel(ctx, width, height);
  }

  renderMetalFloor(ctx, width, height) {
    const floorY = height * 0.7;

    // Base metal color
    ctx.fillStyle = '#3a3530';
    ctx.fillRect(0, floorY, width, height - floorY);

    // Metal plate pattern
    ctx.strokeStyle = 'rgba(100, 90, 80, 0.4)';
    ctx.lineWidth = 2;

    const plateSize = 35;
    for (let y = floorY; y < height; y += plateSize) {
      for (let x = 0; x < width; x += plateSize) {
        ctx.strokeRect(x + 2, y + 2, plateSize - 4, plateSize - 4);

        // Rivets at corners
        ctx.fillStyle = '#5a5040';
        ctx.beginPath();
        ctx.arc(x + 6, y + 6, 2, 0, Math.PI * 2);
        ctx.arc(x + plateSize - 6, y + 6, 2, 0, Math.PI * 2);
        ctx.arc(x + 6, y + plateSize - 6, 2, 0, Math.PI * 2);
        ctx.arc(x + plateSize - 6, y + plateSize - 6, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  renderGears(ctx, width, height) {
    const gears = [
      { x: width * 0.08, y: height * 0.25, r: 40, teeth: 12 },
      { x: width * 0.15, y: height * 0.45, r: 30, teeth: 10 },
      { x: width * 0.92, y: height * 0.2, r: 35, teeth: 11 },
      { x: width * 0.85, y: height * 0.4, r: 25, teeth: 8 }
    ];

    gears.forEach((gear, i) => {
      const rotation = this.gearRotation * (i % 2 === 0 ? 1 : -1);
      this.drawGear(ctx, gear.x, gear.y, gear.r, gear.teeth, rotation);
    });
  }

  drawGear(ctx, x, y, radius, teeth, rotation) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);

    // Gear body
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    gradient.addColorStop(0, '#8b7355');
    gradient.addColorStop(0.7, '#6a5a45');
    gradient.addColorStop(1, '#5a4a35');
    ctx.fillStyle = gradient;

    // Draw gear shape
    ctx.beginPath();
    const toothDepth = radius * 0.15;
    const toothWidth = (Math.PI * 2) / (teeth * 2);

    for (let i = 0; i < teeth; i++) {
      const angle = (i / teeth) * Math.PI * 2;

      // Outer tooth point
      ctx.lineTo(
        Math.cos(angle - toothWidth * 0.3) * (radius + toothDepth),
        Math.sin(angle - toothWidth * 0.3) * (radius + toothDepth)
      );
      ctx.lineTo(
        Math.cos(angle + toothWidth * 0.3) * (radius + toothDepth),
        Math.sin(angle + toothWidth * 0.3) * (radius + toothDepth)
      );

      // Inner valley
      const nextAngle = ((i + 0.5) / teeth) * Math.PI * 2;
      ctx.lineTo(
        Math.cos(nextAngle) * radius,
        Math.sin(nextAngle) * radius
      );
    }
    ctx.closePath();
    ctx.fill();

    // Center hole
    ctx.fillStyle = '#2a2520';
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.25, 0, Math.PI * 2);
    ctx.fill();

    // Spokes
    ctx.strokeStyle = '#4a4035';
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * radius * 0.3, Math.sin(angle) * radius * 0.3);
      ctx.lineTo(Math.cos(angle) * radius * 0.8, Math.sin(angle) * radius * 0.8);
      ctx.stroke();
    }

    ctx.restore();
  }

  renderSteamPipes(ctx, width, height) {
    // Left pipe
    ctx.fillStyle = '#5a5040';
    ctx.fillRect(width * 0.05, 0, 12, height * 0.6);

    // Pipe joints
    ctx.fillStyle = '#6a6050';
    ctx.fillRect(width * 0.04, height * 0.15, 16, 10);
    ctx.fillRect(width * 0.04, height * 0.35, 16, 10);

    // Right pipe
    ctx.fillStyle = '#5a5040';
    ctx.fillRect(width * 0.93, 0, 12, height * 0.55);

    // Pipe joints
    ctx.fillStyle = '#6a6050';
    ctx.fillRect(width * 0.92, height * 0.1, 16, 10);
    ctx.fillRect(width * 0.92, height * 0.3, 16, 10);

    // Valve wheels
    this.drawValveWheel(ctx, width * 0.06, height * 0.5);
    this.drawValveWheel(ctx, width * 0.94, height * 0.45);
  }

  drawValveWheel(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.gearRotation * 0.5);

    ctx.strokeStyle = '#8b7355';
    ctx.lineWidth = 3;

    // Wheel spokes
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(angle) * 10, Math.sin(angle) * 10);
      ctx.stroke();
    }

    // Outer ring
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.stroke();

    // Center
    ctx.fillStyle = '#6a5a45';
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  renderPotionRack(ctx, width, height) {
    const rackX = width * 0.78;
    const rackY = height * 0.55;

    // Rack frame
    ctx.fillStyle = '#4a4030';
    ctx.fillRect(rackX, rackY, 50, 40);

    // Shelves
    ctx.fillStyle = '#5a5040';
    ctx.fillRect(rackX, rackY + 18, 50, 3);

    // Beakers/flasks
    const beakers = [
      { x: rackX + 10, y: rackY + 5, color: '#4caf50', h: 12 },
      { x: rackX + 25, y: rackY + 3, color: '#9c27b0', h: 14 },
      { x: rackX + 40, y: rackY + 6, color: '#ff9800', h: 11 },
      { x: rackX + 15, y: rackY + 24, color: '#2196f3', h: 10 },
      { x: rackX + 35, y: rackY + 22, color: '#f44336', h: 13 }
    ];

    beakers.forEach(b => {
      // Flask body
      ctx.fillStyle = 'rgba(200, 200, 200, 0.3)';
      ctx.beginPath();
      ctx.moveTo(b.x - 5, b.y + b.h);
      ctx.lineTo(b.x - 3, b.y);
      ctx.lineTo(b.x + 3, b.y);
      ctx.lineTo(b.x + 5, b.y + b.h);
      ctx.closePath();
      ctx.fill();

      // Liquid
      ctx.fillStyle = b.color;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(b.x - 4, b.y + b.h);
      ctx.lineTo(b.x - 2, b.y + b.h * 0.4);
      ctx.lineTo(b.x + 2, b.y + b.h * 0.4);
      ctx.lineTo(b.x + 4, b.y + b.h);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    });
  }

  renderMechanicalArms(ctx, width, height) {
    // Decorative mechanical arm (left side, top)
    ctx.strokeStyle = '#6a5a45';
    ctx.lineWidth = 4;

    // Arm segments
    ctx.beginPath();
    ctx.moveTo(0, height * 0.1);
    ctx.lineTo(width * 0.15, height * 0.15);
    ctx.lineTo(width * 0.2, height * 0.08);
    ctx.stroke();

    // Joints
    ctx.fillStyle = '#8b7355';
    ctx.beginPath();
    ctx.arc(width * 0.15, height * 0.15, 5, 0, Math.PI * 2);
    ctx.fill();

    // Claw/gripper
    ctx.strokeStyle = '#5a4a35';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width * 0.2, height * 0.08);
    ctx.lineTo(width * 0.22, height * 0.05);
    ctx.moveTo(width * 0.2, height * 0.08);
    ctx.lineTo(width * 0.22, height * 0.11);
    ctx.stroke();
  }

  renderControlPanel(ctx, width, height) {
    const panelX = width * 0.35;
    const panelY = height * 0.08;

    // Panel base
    ctx.fillStyle = '#4a4030';
    ctx.fillRect(panelX, panelY, 120, 35);

    // Panel border
    ctx.strokeStyle = '#8b7355';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, 120, 35);

    // Gauges
    for (let i = 0; i < 3; i++) {
      const gx = panelX + 20 + i * 40;
      const gy = panelY + 17;

      // Gauge face
      ctx.fillStyle = '#2a2520';
      ctx.beginPath();
      ctx.arc(gx, gy, 10, 0, Math.PI * 2);
      ctx.fill();

      // Gauge ring
      ctx.strokeStyle = '#8b7355';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Needle
      const needleAngle = -Math.PI * 0.7 + Math.random() * Math.PI * 0.4;
      ctx.strokeStyle = '#f44336';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + Math.cos(needleAngle) * 7, gy + Math.sin(needleAngle) * 7);
      ctx.stroke();
    }

    // Warning light
    const lightOn = Math.sin(this.animationFrame * 0.005) > 0;
    ctx.fillStyle = lightOn ? '#4caf50' : '#2a2a2a';
    ctx.beginPath();
    ctx.arc(panelX + 110, panelY + 8, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  getContainerStyles() {
    return `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(180deg, #2a2520 0%, #1a1510 100%);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `;
  }

  getTitle() {
    return 'The Grand Experiment';
  }
}
