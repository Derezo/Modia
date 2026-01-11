import { TITLE_COLORS, hexToRgba } from '../TitleColors.js';

/**
 * Renders a stormy, ominous background for the title animation.
 * Features dark sky, animated clouds, rain particles, and lightning flashes.
 */
export class StormyBackgroundRenderer {
  constructor(width, height) {
    this.width = width;
    this.height = height;

    // Cloud system
    this.clouds = [];
    this.initClouds();

    // Rain system
    this.rainDrops = [];
    this.maxRain = 150;
    this.initRain();

    // Lightning system
    this.lightningTimer = 0;
    this.lightningActive = false;
    this.lightningDuration = 0;
    this.lightningMaxDuration = 150; // ms
    this.nextLightning = 2000 + Math.random() * 3000; // 2-5 seconds
    this.lightningBolt = null; // Store bolt points for rendering

    // Ground colors (muted for stormy mood)
    this.groundY = height * 0.65;

    // Grass mounds scattered across the ground
    this.grassMounds = [];
    this.initGrassMounds();
  }

  initGrassMounds() {
    // Create grass clumps across the ground area
    const moundCount = 35;
    for (let i = 0; i < moundCount; i++) {
      const moundWidth = 20 + Math.random() * 40;
      const moundHeight = 8 + Math.random() * 16;
      const bladeCount = 5 + Math.floor(Math.random() * 8);
      const bladeSpacing = moundWidth / (bladeCount + 1);

      // Pre-compute blade properties for static rendering
      const blades = [];
      for (let b = 0; b < bladeCount; b++) {
        blades.push({
          x: -moundWidth / 2 + bladeSpacing * (b + 1) + (Math.random() - 0.5) * 6,
          height: moundHeight * (0.8 + Math.random() * 0.6),
          lean: (Math.random() - 0.5) * 0.4,
          colorAlt: b % 2 === 0,
          hasEdge: Math.random() > 0.5
        });
      }

      // Pre-compute accent blades
      const accents = [];
      for (let a = 0; a < 3; a++) {
        accents.push({
          x: -moundWidth / 3 + Math.random() * (moundWidth * 0.66),
          height: moundHeight * 0.3 + Math.random() * moundHeight * 0.3
        });
      }

      this.grassMounds.push({
        x: Math.random() * this.width,
        y: this.groundY + 10 + Math.random() * (this.height - this.groundY - 30),
        width: moundWidth,
        height: moundHeight,
        shade: Math.random() * 0.2,
        blades,
        accents
      });
    }
    // Sort by y for proper depth
    this.grassMounds.sort((a, b) => a.y - b.y);
  }

  initClouds() {
    // Create layered clouds at different depths
    const cloudCount = 12;
    for (let i = 0; i < cloudCount; i++) {
      this.clouds.push({
        x: Math.random() * this.width * 1.5 - this.width * 0.25,
        y: 20 + Math.random() * (this.height * 0.3),
        width: 80 + Math.random() * 120,
        height: 30 + Math.random() * 40,
        speed: 0.008 + Math.random() * 0.012, // pixels per ms
        opacity: 0.4 + Math.random() * 0.3,
        layer: Math.floor(Math.random() * 3) // 0 = back, 2 = front
      });
    }
    // Sort by layer for proper rendering
    this.clouds.sort((a, b) => a.layer - b.layer);
  }

  initRain() {
    for (let i = 0; i < this.maxRain; i++) {
      this.rainDrops.push(this.createRainDrop());
    }
  }

  createRainDrop() {
    return {
      x: Math.random() * (this.width + 100) - 50,
      y: Math.random() * this.height,
      length: 8 + Math.random() * 12,
      speed: 0.4 + Math.random() * 0.2, // pixels per ms
      opacity: 0.3 + Math.random() * 0.4
    };
  }

  update(deltaTime) {
    // Update clouds
    for (const cloud of this.clouds) {
      cloud.x += cloud.speed * deltaTime;
      // Wrap around
      if (cloud.x > this.width + cloud.width / 2) {
        cloud.x = -cloud.width;
      }
    }

    // Update rain
    for (const drop of this.rainDrops) {
      // Rain falls diagonally (wind from left)
      drop.y += drop.speed * deltaTime;
      drop.x += drop.speed * 0.3 * deltaTime; // Wind drift

      // Reset when off screen
      if (drop.y > this.height || drop.x > this.width + 50) {
        drop.y = -drop.length;
        drop.x = Math.random() * (this.width + 100) - 100;
        drop.opacity = 0.3 + Math.random() * 0.4;
      }
    }

    // Update lightning timer
    this.lightningTimer += deltaTime;

    if (this.lightningActive) {
      this.lightningDuration += deltaTime;
      if (this.lightningDuration >= this.lightningMaxDuration) {
        this.lightningActive = false;
        this.lightningDuration = 0;
        this.lightningBolt = null;
      }
    } else if (this.lightningTimer >= this.nextLightning) {
      this.triggerLightning();
      this.lightningTimer = 0;
      this.nextLightning = 2000 + Math.random() * 3000;
    }
  }

  triggerLightning() {
    this.lightningActive = true;
    this.lightningDuration = 0;

    // Generate lightning bolt path
    const startX = this.width * 0.3 + Math.random() * this.width * 0.4;
    const startY = 0;
    const endY = this.height * 0.5 + Math.random() * this.height * 0.2;

    this.lightningBolt = this.generateBoltPath(startX, startY, startX, endY);
  }

  generateBoltPath(x1, y1, x2, y2) {
    const points = [{ x: x1, y: y1 }];
    const segments = 8;
    const deltaY = (y2 - y1) / segments;

    let currentX = x1;
    let currentY = y1;

    for (let i = 1; i < segments; i++) {
      currentY += deltaY;
      // Random horizontal deviation
      currentX += (Math.random() - 0.5) * 60;
      points.push({ x: currentX, y: currentY });

      // Chance for a branch
      if (Math.random() < 0.3 && i > 2 && i < segments - 1) {
        const branchEndX = currentX + (Math.random() - 0.5) * 80;
        const branchEndY = currentY + 30 + Math.random() * 40;
        points.push({ branch: true, x: currentX, y: currentY, endX: branchEndX, endY: branchEndY });
      }
    }

    points.push({ x: x2, y: y2 });
    return points;
  }

  render(ctx) {
    // Dark stormy sky gradient
    const skyGradient = ctx.createLinearGradient(0, 0, 0, this.height);
    skyGradient.addColorStop(0, '#2a2a3a');
    skyGradient.addColorStop(0.3, '#3a3a4a');
    skyGradient.addColorStop(0.6, '#4a4a5a');
    skyGradient.addColorStop(1, '#3a4a3a');
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, this.width, this.height);

    // Render back layer clouds
    this.renderClouds(ctx, 0);

    // Render back rain (behind scene elements)
    this.renderRain(ctx, 0.5);

    // Render mid layer clouds
    this.renderClouds(ctx, 1);

    // Muted ground
    this.renderGround(ctx);

    // Render front layer clouds
    this.renderClouds(ctx, 2);

    // Lightning flash overlay
    if (this.lightningActive) {
      this.renderLightning(ctx);
    }
  }

  renderClouds(ctx, layer) {
    for (const cloud of this.clouds) {
      if (cloud.layer !== layer) continue;

      ctx.save();
      ctx.globalAlpha = cloud.opacity;

      // Darker clouds for stormy effect
      const darkness = 0.3 + (cloud.layer * 0.1);
      ctx.fillStyle = `rgba(60, 60, 70, ${darkness})`;

      // Draw cloud as overlapping circles
      const cx = cloud.x;
      const cy = cloud.y;
      const w = cloud.width;
      const h = cloud.height;

      ctx.beginPath();
      ctx.arc(cx, cy, h * 0.6, 0, Math.PI * 2);
      ctx.arc(cx + w * 0.25, cy - h * 0.15, h * 0.5, 0, Math.PI * 2);
      ctx.arc(cx + w * 0.5, cy, h * 0.55, 0, Math.PI * 2);
      ctx.arc(cx + w * 0.75, cy - h * 0.1, h * 0.45, 0, Math.PI * 2);
      ctx.arc(cx + w, cy, h * 0.5, 0, Math.PI * 2);
      ctx.arc(cx + w * 0.35, cy + h * 0.2, h * 0.35, 0, Math.PI * 2);
      ctx.arc(cx + w * 0.65, cy + h * 0.15, h * 0.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  renderRain(ctx, opacity) {
    ctx.save();
    ctx.strokeStyle = hexToRgba('#8a9aaa', opacity);
    ctx.lineWidth = 1;

    for (const drop of this.rainDrops) {
      ctx.globalAlpha = drop.opacity * opacity;
      ctx.beginPath();
      ctx.moveTo(drop.x, drop.y);
      // Rain falls at an angle (wind effect)
      ctx.lineTo(drop.x + drop.length * 0.3, drop.y + drop.length);
      ctx.stroke();
    }

    ctx.restore();
  }

  renderRainForeground(ctx) {
    // Render foreground rain layer for depth
    this.renderRain(ctx, 0.8);
  }

  renderGround(ctx) {
    const groundGradient = ctx.createLinearGradient(0, this.groundY, 0, this.height);
    groundGradient.addColorStop(0, '#3a4a3a'); // Muted green
    groundGradient.addColorStop(0.3, '#2a3a2a');
    groundGradient.addColorStop(1, '#1a2a1a');
    ctx.fillStyle = groundGradient;
    ctx.fillRect(0, this.groundY, this.width, this.height - this.groundY);

    // Render grass mounds
    this.renderGrassMounds(ctx);
  }

  renderGrassMounds(ctx) {
    for (const mound of this.grassMounds) {
      this.renderGrassMound(ctx, mound);
    }
  }

  renderGrassMound(ctx, mound) {
    ctx.save();
    ctx.translate(mound.x, mound.y);

    const baseGreen = this.adjustGrassColor('#3a5a3a', -mound.shade * 40);
    const darkGreen = this.adjustGrassColor('#2a4a2a', -mound.shade * 40);
    const lightGreen = this.adjustGrassColor('#4a6a4a', -mound.shade * 40);

    // Draw base mound (rounded bump)
    ctx.fillStyle = darkGreen;
    ctx.beginPath();
    ctx.ellipse(0, 0, mound.width / 2, mound.height / 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Draw shaggy grass blades (using pre-computed values)
    for (const blade of mound.blades) {
      const bladeX = blade.x;
      const bladeHeight = blade.height;
      const bladeLean = blade.lean;

      // Draw individual grass blade (tapered)
      ctx.fillStyle = blade.colorAlt ? baseGreen : lightGreen;
      ctx.beginPath();
      ctx.moveTo(bladeX - 2, 0);
      ctx.quadraticCurveTo(
        bladeX + bladeLean * bladeHeight * 0.5,
        -bladeHeight * 0.6,
        bladeX + bladeLean * bladeHeight,
        -bladeHeight
      );
      ctx.quadraticCurveTo(
        bladeX + bladeLean * bladeHeight * 0.5 + 1,
        -bladeHeight * 0.6,
        bladeX + 2,
        0
      );
      ctx.closePath();
      ctx.fill();

      // Add darker edge to some blades for depth
      if (blade.hasEdge) {
        ctx.strokeStyle = darkGreen;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(bladeX - 1, 0);
        ctx.quadraticCurveTo(
          bladeX + bladeLean * bladeHeight * 0.5,
          -bladeHeight * 0.6,
          bladeX + bladeLean * bladeHeight,
          -bladeHeight
        );
        ctx.stroke();
      }
    }

    // Draw tiny accent blades (using pre-computed values)
    ctx.fillStyle = lightGreen;
    for (const accent of mound.accents) {
      ctx.beginPath();
      ctx.moveTo(accent.x, 0);
      ctx.lineTo(accent.x + 1, -accent.height);
      ctx.lineTo(accent.x + 2, 0);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  adjustGrassColor(hex, amount) {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);

    r = Math.max(0, Math.min(255, r + amount));
    g = Math.max(0, Math.min(255, g + amount));
    b = Math.max(0, Math.min(255, b + amount));

    return `rgb(${r}, ${g}, ${b})`;
  }

  renderLightning(ctx) {
    if (!this.lightningBolt) return;

    // Calculate flash intensity (bright at start, fades)
    const progress = this.lightningDuration / this.lightningMaxDuration;
    const flashIntensity = Math.max(0, 1 - progress * 2);
    const boltIntensity = Math.max(0, 1 - progress);

    // Screen flash
    if (flashIntensity > 0) {
      ctx.save();
      ctx.globalAlpha = flashIntensity * 0.4;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    }

    // Draw lightning bolt
    if (boltIntensity > 0) {
      ctx.save();
      ctx.globalAlpha = boltIntensity;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 20;

      ctx.beginPath();
      let prevPoint = null;

      for (const point of this.lightningBolt) {
        if (point.branch) {
          // Draw branch
          ctx.moveTo(point.x, point.y);
          ctx.lineTo(point.endX, point.endY);
        } else {
          if (prevPoint && !prevPoint.branch) {
            ctx.lineTo(point.x, point.y);
          } else {
            ctx.moveTo(point.x, point.y);
          }
          prevPoint = point;
        }
      }
      ctx.stroke();

      // Inner bright core
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#eeeeff';
      ctx.beginPath();
      prevPoint = null;
      for (const point of this.lightningBolt) {
        if (!point.branch) {
          if (prevPoint && !prevPoint.branch) {
            ctx.lineTo(point.x, point.y);
          } else {
            ctx.moveTo(point.x, point.y);
          }
          prevPoint = point;
        }
      }
      ctx.stroke();

      ctx.restore();
    }
  }
}
