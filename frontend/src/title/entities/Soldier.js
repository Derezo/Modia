import { TITLE_COLORS } from '../TitleColors.js';

/**
 * A detailed pixel art soldier entity that marches from the castle.
 * Features armor, cape, sword, and shield with walk animation.
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
    this.scale = 2.2;

    // Direction (1 = right, -1 = left)
    this.direction = 1;

    // Slight variation for visual interest
    this.variation = Math.random();

    // Shadow overlay (fades as soldier emerges from doorway)
    this.shadowOpacity = 0.75;
    this.shadowFadeRate = 0.002; // per ms

    // Offscreen canvas for shadow masking (larger for crisp rendering)
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = 80;
    this.offscreenCanvas.height = 100;
    this.offscreenCtx = this.offscreenCanvas.getContext('2d');
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

      // Fade shadow as soldier emerges from doorway
      if (this.shadowOpacity > 0) {
        this.shadowOpacity = Math.max(0, this.shadowOpacity - this.shadowFadeRate * deltaTime);
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
    // If shadow is active, render to offscreen canvas first for proper masking
    if (this.shadowOpacity > 0) {
      const offCtx = this.offscreenCtx;
      const ow = this.offscreenCanvas.width;
      const oh = this.offscreenCanvas.height;

      // Clear offscreen canvas
      offCtx.clearRect(0, 0, ow, oh);

      // Draw soldier centered in offscreen canvas
      offCtx.save();
      offCtx.translate(ow / 2, oh - 10);
      offCtx.scale(this.direction, 1);
      this.drawSoldier(offCtx);

      // Apply shadow using source-atop (only draws where soldier pixels exist)
      offCtx.globalCompositeOperation = 'source-atop';
      offCtx.fillStyle = `rgba(15, 10, 20, ${this.shadowOpacity})`;
      offCtx.fillRect(-ow, -oh, ow * 2, oh * 2);
      offCtx.restore();

      // Draw offscreen canvas to main canvas with scaling
      ctx.save();
      ctx.translate(Math.floor(this.x), Math.floor(this.y));
      ctx.scale(this.scale, this.scale);
      ctx.drawImage(this.offscreenCanvas, -ow / 2, -oh + 10);
      ctx.restore();
    } else {
      // No shadow - draw directly for better performance
      ctx.save();
      ctx.translate(Math.floor(this.x), Math.floor(this.y));
      ctx.scale(this.scale * this.direction, this.scale);
      this.drawSoldier(ctx);
      ctx.restore();
    }
  }

  drawSoldier(ctx) {
    // Animation offsets
    const legOffset = this.isMoving ? Math.sin(this.frame * Math.PI / 2) * 2 : 0;
    const armOffset = this.isMoving ? Math.sin(this.frame * Math.PI / 2) * 1.5 : 0;
    const bodyBob = this.isMoving ? Math.abs(Math.sin(this.frame * Math.PI / 2)) * 0.5 : 0;

    // Cape (behind body)
    this.drawCape(ctx, bodyBob);

    // Left arm with shield (behind body)
    this.drawShieldArm(ctx, -armOffset);

    // Legs
    this.drawLegs(ctx, legOffset);

    // Body and armor
    this.drawBody(ctx, bodyBob);

    // Head and helmet
    this.drawHead(ctx, bodyBob);

    // Right arm with sword (in front)
    this.drawSwordArm(ctx, armOffset, bodyBob);
  }

  drawCape(ctx, bob) {
    // Flowing cape behind the soldier
    ctx.fillStyle = TITLE_COLORS.flag.secondary;

    const capeWave = this.isMoving ? Math.sin(this.frame * Math.PI / 2) * 2 : 0;

    ctx.beginPath();
    ctx.moveTo(-2, -9 - bob); // Top attachment
    ctx.lineTo(2, -9 - bob);
    ctx.quadraticCurveTo(4 + capeWave, -4, 3 + capeWave * 0.5, 2);
    ctx.lineTo(-3 - capeWave * 0.5, 2);
    ctx.quadraticCurveTo(-4 - capeWave, -4, -2, -9 - bob);
    ctx.closePath();
    ctx.fill();

    // Cape highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.moveTo(-1, -8 - bob);
    ctx.lineTo(0, -8 - bob);
    ctx.lineTo(1 + capeWave * 0.3, -2);
    ctx.lineTo(-1 - capeWave * 0.3, -2);
    ctx.closePath();
    ctx.fill();
  }

  drawShieldArm(ctx, offset) {
    // Left arm
    ctx.fillStyle = TITLE_COLORS.soldier.armor;
    ctx.fillRect(-6, -8 + offset * 0.5, 2, 4);

    // Gauntlet
    ctx.fillStyle = TITLE_COLORS.metal.dark;
    ctx.fillRect(-6, -5 + offset * 0.5, 2, 2);

    // Shield
    ctx.fillStyle = TITLE_COLORS.metal.mid;
    ctx.beginPath();
    ctx.moveTo(-9, -9 + offset * 0.3);
    ctx.lineTo(-5, -9 + offset * 0.3);
    ctx.lineTo(-5, -2 + offset * 0.3);
    ctx.lineTo(-7, 0 + offset * 0.3);
    ctx.lineTo(-9, -2 + offset * 0.3);
    ctx.closePath();
    ctx.fill();

    // Shield border
    ctx.strokeStyle = TITLE_COLORS.metal.dark;
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Shield emblem
    ctx.fillStyle = TITLE_COLORS.flag.primary;
    ctx.fillRect(-8, -7 + offset * 0.3, 2, 4);

    // Shield highlight
    ctx.fillStyle = TITLE_COLORS.metal.light;
    ctx.fillRect(-9, -9 + offset * 0.3, 1, 5);
  }

  drawLegs(ctx, offset) {
    // Leg armor/greaves
    const legColor = TITLE_COLORS.soldier.armor;
    const bootColor = TITLE_COLORS.soldier.boots;

    // Left leg
    ctx.fillStyle = legColor;
    ctx.fillRect(-3, -2, 2, 2 + Math.max(0, offset));

    ctx.fillStyle = bootColor;
    ctx.fillRect(-3, 0 + Math.max(0, offset), 2, 2);

    // Right leg
    ctx.fillStyle = legColor;
    ctx.fillRect(1, -2, 2, 2 + Math.max(0, -offset));

    ctx.fillStyle = bootColor;
    ctx.fillRect(1, 0 + Math.max(0, -offset), 2, 2);

    // Knee guards
    ctx.fillStyle = TITLE_COLORS.metal.light;
    ctx.fillRect(-3, -2, 2, 1);
    ctx.fillRect(1, -2, 2, 1);
  }

  drawBody(ctx, bob) {
    // Chainmail underlay
    ctx.fillStyle = TITLE_COLORS.metal.dark;
    ctx.fillRect(-4, -9 - bob, 8, 7);

    // Breastplate
    ctx.fillStyle = TITLE_COLORS.soldier.armor;
    ctx.fillRect(-3, -8 - bob, 6, 5);

    // Breastplate detail - center ridge
    ctx.fillStyle = TITLE_COLORS.metal.light;
    ctx.fillRect(-0.5, -8 - bob, 1, 4);

    // Breastplate shading
    ctx.fillStyle = TITLE_COLORS.soldier.armorDark;
    ctx.fillRect(-3, -8 - bob, 1, 5);
    ctx.fillRect(2, -8 - bob, 1, 5);

    // Belt
    ctx.fillStyle = TITLE_COLORS.wood.dark;
    ctx.fillRect(-4, -3 - bob, 8, 1);

    // Belt buckle
    ctx.fillStyle = TITLE_COLORS.flag.primary;
    ctx.fillRect(-1, -3 - bob, 2, 1);

    // Shoulder pauldrons
    ctx.fillStyle = TITLE_COLORS.soldier.armor;
    ctx.beginPath();
    ctx.arc(-4, -8 - bob, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(4, -8 - bob, 2, 0, Math.PI * 2);
    ctx.fill();

    // Pauldron highlights
    ctx.fillStyle = TITLE_COLORS.metal.light;
    ctx.beginPath();
    ctx.arc(-4.5, -8.5 - bob, 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(3.5, -8.5 - bob, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  drawHead(ctx, bob) {
    // Neck
    ctx.fillStyle = TITLE_COLORS.soldier.skin;
    ctx.fillRect(-1, -11 - bob, 2, 2);

    // Helmet base
    ctx.fillStyle = TITLE_COLORS.soldier.armor;
    ctx.fillRect(-4, -16 - bob, 8, 5);

    // Helmet dome
    ctx.beginPath();
    ctx.arc(0, -16 - bob, 4, Math.PI, 0);
    ctx.fill();

    // Helmet visor
    ctx.fillStyle = TITLE_COLORS.metal.dark;
    ctx.fillRect(-3, -13 - bob, 6, 2);

    // Eye slit
    ctx.fillStyle = '#1a1a2a';
    ctx.fillRect(-2, -12 - bob, 4, 1);

    // Helmet crest
    ctx.fillStyle = TITLE_COLORS.flag.secondary;
    ctx.beginPath();
    ctx.moveTo(0, -20 - bob);
    ctx.lineTo(-1, -16 - bob);
    ctx.lineTo(1, -16 - bob);
    ctx.closePath();
    ctx.fill();

    // Helmet highlight
    ctx.fillStyle = TITLE_COLORS.metal.light;
    ctx.fillRect(-3, -16 - bob, 1, 3);

    // Chin guard
    ctx.fillStyle = TITLE_COLORS.soldier.armor;
    ctx.fillRect(-2, -11 - bob, 4, 1);
  }

  drawSwordArm(ctx, offset, bob) {
    // Right arm
    ctx.fillStyle = TITLE_COLORS.soldier.armor;
    ctx.fillRect(4, -8 - bob - offset * 0.5, 2, 4);

    // Gauntlet
    ctx.fillStyle = TITLE_COLORS.metal.dark;
    ctx.fillRect(4, -5 - bob - offset * 0.5, 2, 2);

    // Sword
    const swordAngle = this.isMoving ? 0.2 + offset * 0.05 : 0.3;

    ctx.save();
    ctx.translate(5, -4 - bob - offset * 0.5);
    ctx.rotate(swordAngle);

    // Blade
    ctx.fillStyle = TITLE_COLORS.soldier.sword;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(1, -10);
    ctx.lineTo(2, -10);
    ctx.lineTo(3, 0);
    ctx.closePath();
    ctx.fill();

    // Blade edge highlight
    ctx.fillStyle = '#e0e0e8';
    ctx.fillRect(0.5, -9, 0.5, 8);

    // Cross guard
    ctx.fillStyle = TITLE_COLORS.flag.primary;
    ctx.fillRect(-1, 0, 5, 1);

    // Handle
    ctx.fillStyle = TITLE_COLORS.soldier.swordHandle;
    ctx.fillRect(1, 1, 1.5, 3);

    // Pommel
    ctx.fillStyle = TITLE_COLORS.flag.primary;
    ctx.beginPath();
    ctx.arc(1.75, 4.5, 1, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
