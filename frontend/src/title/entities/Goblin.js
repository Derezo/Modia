import { TITLE_COLORS } from '../TitleColors.js';

/**
 * A pixel art goblin entity that rushes from the forest.
 * 16x16 pixel sprite with bouncy walk animation.
 */
export class Goblin {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.targetX = x;
    this.targetY = y;

    // Movement
    this.speed = 55; // Faster than soldiers
    this.isMoving = false;

    // Animation
    this.frame = 0;
    this.frameTimer = 0;
    this.frameDuration = 110; // Faster animation

    // Bounce effect
    this.bouncePhase = Math.random() * Math.PI * 2;
    this.bounceSpeed = 0.012;
    this.bounceHeight = 3;

    // Scale for rendering
    this.scale = 2.5;

    // Direction (1 = right, -1 = left)
    this.direction = -1; // Start facing left (toward castle)
  }

  moveTo(targetX, targetY) {
    this.targetX = targetX;
    this.targetY = targetY;
    this.isMoving = true;

    // Set direction based on target
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

    // Walk animation
    if (this.isMoving) {
      this.frameTimer += deltaTime;
      if (this.frameTimer >= this.frameDuration) {
        this.frameTimer = 0;
        this.frame = (this.frame + 1) % 4;
      }
    }

    // Movement
    if (this.isMoving) {
      const dx = this.targetX - this.x;
      const dy = this.targetY - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 2) {
        this.x += (dx / dist) * this.speed * dt;
        this.y += (dy / dist) * this.speed * dt;
      } else {
        this.x = this.targetX;
        this.y = this.targetY;
        this.isMoving = false;
      }
    }
  }

  render(ctx) {
    ctx.save();

    // Apply bounce offset
    const bounceY = Math.abs(Math.sin(this.bouncePhase)) * this.bounceHeight;
    ctx.translate(Math.floor(this.x), Math.floor(this.y - bounceY));
    ctx.scale(this.scale * this.direction, this.scale);

    // Draw pixel art goblin
    this.drawGoblin(ctx);

    ctx.restore();
  }

  drawGoblin(ctx) {
    // 16x16 pixel goblin (shorter and stockier)
    const legOffset = this.isMoving ? Math.sin(this.frame * Math.PI / 2) * 1.5 : 0;

    // Pointy ears
    ctx.fillStyle = TITLE_COLORS.goblin.skin;
    ctx.fillRect(-6, -14, 2, 3);
    ctx.fillRect(4, -14, 2, 3);

    // Head
    ctx.fillStyle = TITLE_COLORS.goblin.skin;
    ctx.fillRect(-4, -12, 8, 5);

    // Eyes (beady red)
    ctx.fillStyle = TITLE_COLORS.goblin.eyes;
    ctx.fillRect(-3, -10, 2, 2);
    ctx.fillRect(1, -10, 2, 2);

    // Nose
    ctx.fillStyle = TITLE_COLORS.goblin.skinDark;
    ctx.fillRect(-1, -9, 2, 2);

    // Mouth (toothy grin)
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(-2, -7, 4, 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-1, -7, 1, 1);
    ctx.fillRect(1, -7, 1, 1);

    // Body (ragged cloth)
    ctx.fillStyle = TITLE_COLORS.goblin.cloth;
    ctx.fillRect(-4, -6, 8, 4);

    // Arms
    ctx.fillStyle = TITLE_COLORS.goblin.skin;
    ctx.fillRect(-6, -5, 2, 3);
    ctx.fillRect(4, -5, 2, 3);

    // Legs
    ctx.fillStyle = TITLE_COLORS.goblin.skinDark;
    ctx.fillRect(-3, -2, 2, 2 + legOffset);
    ctx.fillRect(1, -2, 2, 2 - legOffset);

    // Crude weapon (club)
    ctx.fillStyle = TITLE_COLORS.goblin.weapon;
    ctx.fillRect(5, -8, 2, 7);
    ctx.fillRect(4, -9, 4, 2);
  }
}
