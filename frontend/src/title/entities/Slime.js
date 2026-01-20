import { TITLE_COLORS } from '../TitleColors.js';

/**
 * A pixel art slime entity that hops from the forest.
 * 16x16 pixel sprite with squash/stretch animation.
 */
export class Slime {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.groundY = y;
    this.targetX = x;
    this.targetY = y;

    // Bounce physics
    this.bouncePhase = Math.random() * Math.PI * 2;
    this.bounceSpeed = 0.007;
    this.bounceHeight = 18;
    this.hopHeight = 0;

    // Squash/stretch
    this.squashFactor = 1.0;

    // Movement
    this.speed = 35;
    this.isMoving = false;

    // Base dimensions
    this.baseWidth = 14;
    this.baseHeight = 10;

    // Scale for rendering
    this.scale = 2.5;

    // Direction
    this.direction = -1; // Facing left toward castle
  }

  moveTo(targetX, targetY) {
    this.targetX = targetX;
    this.targetY = targetY;
    this.groundY = targetY;
    this.isMoving = true;

    if (targetX > this.x) {
      this.direction = 1;
    } else if (targetX < this.x) {
      this.direction = -1;
    }
  }

  update(deltaTime) {
    const dt = deltaTime / 1000;

    // Bounce animation
    this.bouncePhase += this.bounceSpeed * deltaTime;

    // Calculate hop height (absolute sine for continuous bouncing)
    const bounceT = Math.abs(Math.sin(this.bouncePhase));
    this.hopHeight = bounceT * this.bounceHeight;

    // Calculate squash/stretch based on phase
    const stretchPhase = Math.sin(this.bouncePhase);
    if (stretchPhase > 0) {
      // Rising/at peak - stretch vertically
      this.squashFactor = 1.0 + (stretchPhase * 0.3);
    } else {
      // Falling/at ground - squash horizontally
      this.squashFactor = 1.0 + (stretchPhase * 0.25);
    }

    // Movement (only while bouncing forward)
    if (this.isMoving) {
      const dx = this.targetX - this.x;
      const dy = this.targetY - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 2) {
        // Move faster when in air (during hop)
        const moveSpeed = this.speed * (0.5 + bounceT * 0.5);
        this.x += (dx / dist) * moveSpeed * dt;
        this.groundY += (dy / dist) * moveSpeed * dt;
      } else {
        this.x = this.targetX;
        this.groundY = this.targetY;
        this.isMoving = false;
      }
    }

    // Update y position based on ground and hop
    this.y = this.groundY - this.hopHeight;
  }

  render(ctx) {
    ctx.save();
    ctx.translate(Math.floor(this.x), Math.floor(this.y));

    // Apply squash/stretch (scale inversely to preserve volume)
    const scaleY = this.squashFactor;
    const scaleX = 1 / this.squashFactor;
    ctx.scale(this.scale * scaleX * this.direction, this.scale * scaleY);

    // Draw pixel art slime
    this.drawSlime(ctx);

    ctx.restore();

    // Draw shadow on ground
    this.drawShadow(ctx);
  }

  drawSlime(ctx) {
    // Main body (blob shape using rectangles for pixel art style)
    const w = this.baseWidth;
    const _h = this.baseHeight;

    // Bottom row (widest)
    ctx.fillStyle = TITLE_COLORS.slime.dark;
    ctx.fillRect(-w / 2 + 1, -2, w - 2, 2);

    // Main body rows
    ctx.fillStyle = TITLE_COLORS.slime.body;
    ctx.fillRect(-w / 2, -4, w, 2);
    ctx.fillRect(-w / 2, -6, w, 2);

    // Upper body (narrower)
    ctx.fillRect(-w / 2 + 1, -8, w - 2, 2);
    ctx.fillRect(-w / 2 + 2, -10, w - 4, 2);

    // Highlight (lighter green)
    ctx.fillStyle = TITLE_COLORS.slime.highlight;
    ctx.fillRect(-w / 2 + 2, -8, 3, 2);
    ctx.fillRect(-w / 2 + 3, -6, 2, 2);

    // Shine spot (white)
    ctx.fillStyle = TITLE_COLORS.slime.shine;
    ctx.fillRect(-w / 2 + 3, -7, 2, 1);

    // Eyes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-3, -6, 2, 2);
    ctx.fillRect(1, -6, 2, 2);

    // Pupils
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(-2, -5, 1, 1);
    ctx.fillRect(2, -5, 1, 1);
  }

  drawShadow(ctx) {
    // Shadow gets smaller/lighter when slime is higher
    const shadowScale = 1 - (this.hopHeight / this.bounceHeight) * 0.4;
    const shadowAlpha = 0.25 * shadowScale;

    ctx.save();
    ctx.translate(this.x, this.groundY);
    ctx.scale(this.scale * shadowScale, this.scale * 0.3);

    ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
    ctx.beginPath();
    ctx.ellipse(0, 2, 6, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
