import { TITLE_COLORS } from '../TitleColors.js';

/**
 * A pixel art soldier entity that marches from the castle.
 * 16x16 pixel sprite with walk animation.
 */
export class Soldier {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.targetX = x;
    this.targetY = y;

    // Movement
    this.speed = 45; // pixels per second
    this.isMoving = false;

    // Animation
    this.frame = 0;
    this.frameTimer = 0;
    this.frameDuration = 140; // ms per frame

    // Scale for rendering
    this.scale = 2.5;

    // Direction (1 = right, -1 = left)
    this.direction = 1;
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

    // Animation
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
    ctx.translate(Math.floor(this.x), Math.floor(this.y));
    ctx.scale(this.scale * this.direction, this.scale);

    // Draw pixel art soldier
    this.drawSoldier(ctx);

    ctx.restore();
  }

  drawSoldier(ctx) {
    // 16x16 pixel soldier (drawn from center-bottom)
    // All coordinates relative to center-bottom at (0, 0)

    const legOffset = this.isMoving ? Math.sin(this.frame * Math.PI / 2) * 1.5 : 0;

    // Helmet
    ctx.fillStyle = TITLE_COLORS.soldier.armor;
    ctx.fillRect(-3, -16, 6, 3);
    ctx.fillRect(-4, -13, 8, 3);

    // Helmet crest
    ctx.fillStyle = TITLE_COLORS.flag.secondary;
    ctx.fillRect(-1, -18, 2, 2);

    // Face
    ctx.fillStyle = TITLE_COLORS.soldier.skin;
    ctx.fillRect(-3, -10, 6, 3);

    // Body armor
    ctx.fillStyle = TITLE_COLORS.soldier.armor;
    ctx.fillRect(-4, -7, 8, 4);

    // Armor detail
    ctx.fillStyle = TITLE_COLORS.soldier.armorDark;
    ctx.fillRect(-4, -6, 1, 3);
    ctx.fillRect(3, -6, 1, 3);

    // Belt
    ctx.fillStyle = TITLE_COLORS.wood.dark;
    ctx.fillRect(-4, -3, 8, 1);

    // Legs
    ctx.fillStyle = TITLE_COLORS.soldier.boots;
    // Left leg
    ctx.fillRect(-3, -2, 2, 2 + legOffset);
    // Right leg
    ctx.fillRect(1, -2, 2, 2 - legOffset);

    // Sword (on right side)
    ctx.fillStyle = TITLE_COLORS.soldier.sword;
    ctx.fillRect(4, -10, 2, 8);

    // Sword handle
    ctx.fillStyle = TITLE_COLORS.soldier.swordHandle;
    ctx.fillRect(4, -11, 2, 2);
    ctx.fillRect(3, -10, 4, 1);

    // Shield (on left side)
    ctx.fillStyle = TITLE_COLORS.metal.mid;
    ctx.fillRect(-7, -9, 3, 6);

    // Shield emblem
    ctx.fillStyle = TITLE_COLORS.flag.primary;
    ctx.fillRect(-6, -8, 1, 4);
  }
}
