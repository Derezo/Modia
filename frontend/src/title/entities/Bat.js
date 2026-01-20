import { TITLE_COLORS } from '../TitleColors.js';

/**
 * A pixel art bat entity that flies from the forest.
 * 12x12 pixel sprite with wing flapping animation.
 */
export class Bat {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.baseY = y;

    // Movement
    this.velocityX = -55 - Math.random() * 25; // Flying left
    this.isMoving = true;

    // Vertical wave motion
    this.wavePhase = Math.random() * Math.PI * 2;
    this.waveSpeed = 0.004;
    this.waveAmplitude = 18 + Math.random() * 12;

    // Wing animation
    this.frame = 0;
    this.frameTimer = 0;
    this.frameDuration = 70; // Fast flapping

    // Scale for rendering
    this.scale = 2.2;
  }

  update(deltaTime) {
    const dt = deltaTime / 1000;

    // Wing flapping animation
    this.frameTimer += deltaTime;
    if (this.frameTimer >= this.frameDuration) {
      this.frameTimer = 0;
      this.frame = (this.frame + 1) % 3;
    }

    // Horizontal movement
    this.x += this.velocityX * dt;

    // Vertical wave motion
    this.wavePhase += this.waveSpeed * deltaTime;
    this.y = this.baseY + Math.sin(this.wavePhase) * this.waveAmplitude;
  }

  render(ctx) {
    ctx.save();
    ctx.translate(Math.floor(this.x), Math.floor(this.y));
    ctx.scale(this.scale, this.scale);

    // Draw pixel art bat
    this.drawBat(ctx);

    ctx.restore();
  }

  drawBat(ctx) {
    // Wing angle based on frame
    // Frame 0: wings level, Frame 1: wings up, Frame 2: wings down
    const wingAngles = [0, -0.35, 0.25];
    const wingAngle = wingAngles[this.frame];

    // Body
    ctx.fillStyle = TITLE_COLORS.bat.body;
    ctx.fillRect(-2, -2, 4, 3);

    // Head
    ctx.fillRect(-1, -4, 2, 2);

    // Ears
    ctx.fillRect(-2, -5, 1, 1);
    ctx.fillRect(1, -5, 1, 1);

    // Eyes
    ctx.fillStyle = TITLE_COLORS.bat.eyes;
    ctx.fillRect(-1, -4, 1, 1);
    ctx.fillRect(0, -4, 1, 1);

    // Left wing
    ctx.save();
    ctx.rotate(-wingAngle);
    ctx.fillStyle = TITLE_COLORS.bat.wing;
    ctx.beginPath();
    ctx.moveTo(-2, -1);
    ctx.lineTo(-8, -3 + this.frame);
    ctx.lineTo(-7, 0);
    ctx.lineTo(-5, 1);
    ctx.lineTo(-2, 1);
    ctx.closePath();
    ctx.fill();

    // Wing membrane detail
    ctx.fillStyle = TITLE_COLORS.bat.wingMembrane;
    ctx.beginPath();
    ctx.moveTo(-3, -1);
    ctx.lineTo(-6, -2);
    ctx.lineTo(-5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Right wing (mirrored)
    ctx.save();
    ctx.rotate(wingAngle);
    ctx.fillStyle = TITLE_COLORS.bat.wing;
    ctx.beginPath();
    ctx.moveTo(2, -1);
    ctx.lineTo(8, -3 + this.frame);
    ctx.lineTo(7, 0);
    ctx.lineTo(5, 1);
    ctx.lineTo(2, 1);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = TITLE_COLORS.bat.wingMembrane;
    ctx.beginPath();
    ctx.moveTo(3, -1);
    ctx.lineTo(6, -2);
    ctx.lineTo(5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * Check if bat has flown off screen
   */
  isOffScreen(_canvasWidth) {
    return this.x < -30;
  }
}
