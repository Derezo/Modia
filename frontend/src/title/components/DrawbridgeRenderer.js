import { TITLE_COLORS } from '../TitleColors.js';

/**
 * Renders an animated drawbridge that can raise/lower.
 */
export class DrawbridgeRenderer {
  constructor(x, y) {
    this.x = x;
    this.y = y;

    // Bridge dimensions
    this.length = 55;
    this.width = 48;

    // Animation state
    // angle: 0 = lowered (horizontal), PI/2 = raised (vertical)
    this.angle = Math.PI / 2;
    this.targetAngle = Math.PI / 2;
    this.animationSpeed = 0.0015; // radians per ms
  }

  /**
   * Begin lowering the drawbridge
   */
  lower() {
    this.targetAngle = 0;
  }

  /**
   * Begin raising the drawbridge
   */
  raise() {
    this.targetAngle = Math.PI / 2;
  }

  /**
   * Check if fully lowered
   */
  isLowered() {
    return Math.abs(this.angle) < 0.02;
  }

  /**
   * Check if fully raised
   */
  isRaised() {
    return Math.abs(this.angle - Math.PI / 2) < 0.02;
  }

  /**
   * Check if currently animating
   */
  isAnimating() {
    return Math.abs(this.angle - this.targetAngle) > 0.02;
  }

  update(deltaTime) {
    if (this.angle < this.targetAngle) {
      this.angle = Math.min(this.targetAngle, this.angle + this.animationSpeed * deltaTime);
    } else if (this.angle > this.targetAngle) {
      this.angle = Math.max(this.targetAngle, this.angle - this.animationSpeed * deltaTime);
    }
  }

  render(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);

    // When raised, show chains
    if (this.angle > 0.1) {
      this.renderChains(ctx);
    }

    // Rotate bridge (pivot at castle wall)
    ctx.rotate(this.angle);

    // Bridge shadow (when lowered)
    if (this.angle < 0.3) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.fillRect(2, -this.width / 2 + 2, this.length, this.width);
    }

    // Main bridge planks
    ctx.fillStyle = TITLE_COLORS.wood.mid;
    ctx.fillRect(0, -this.width / 2, this.length, this.width);

    // Individual plank lines
    ctx.strokeStyle = TITLE_COLORS.wood.dark;
    ctx.lineWidth = 1;
    const plankWidth = 8;
    for (let i = plankWidth; i < this.width; i += plankWidth) {
      ctx.beginPath();
      ctx.moveTo(0, -this.width / 2 + i);
      ctx.lineTo(this.length, -this.width / 2 + i);
      ctx.stroke();
    }

    // Wood grain texture
    ctx.strokeStyle = TITLE_COLORS.wood.light;
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 6; i++) {
      const y = -this.width / 2 + 4 + i * 8;
      ctx.beginPath();
      ctx.moveTo(5, y + 2);
      ctx.lineTo(this.length - 5, y + 2);
      ctx.stroke();
    }

    // Metal reinforcement bands
    ctx.fillStyle = TITLE_COLORS.metal.dark;
    ctx.fillRect(8, -this.width / 2, 5, this.width);
    ctx.fillRect(28, -this.width / 2, 5, this.width);
    ctx.fillRect(48, -this.width / 2, 5, this.width);

    // Metal rivets on bands
    ctx.fillStyle = TITLE_COLORS.metal.light;
    const rivetPositions = [8, 28, 48];
    for (const rx of rivetPositions) {
      for (let ry = -18; ry <= 18; ry += 12) {
        ctx.beginPath();
        ctx.arc(rx + 2.5, ry, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Edge highlight (top)
    ctx.fillStyle = TITLE_COLORS.wood.light;
    ctx.fillRect(0, -this.width / 2, this.length, 2);

    // Edge shadow (bottom)
    ctx.fillStyle = TITLE_COLORS.wood.dark;
    ctx.fillRect(0, this.width / 2 - 2, this.length, 2);

    ctx.restore();
  }

  renderChains(ctx) {
    ctx.strokeStyle = TITLE_COLORS.metal.chain;
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 3]);

    // Chain tension based on angle
    const tension = 1 - (this.angle / (Math.PI / 2));
    const chainSag = 15 * tension;

    // Calculate bridge end position
    const bridgeEndX = Math.cos(this.angle) * this.length;
    const bridgeEndY = Math.sin(this.angle) * this.length;

    // Left chain (from above gate to bridge corner)
    ctx.beginPath();
    ctx.moveTo(-15, -45); // Anchor above gate
    ctx.quadraticCurveTo(
      bridgeEndX / 2 - 10,
      bridgeEndY / 2 - 20 - chainSag,
      bridgeEndX,
      bridgeEndY - this.width / 2 + 5
    );
    ctx.stroke();

    // Right chain
    ctx.beginPath();
    ctx.moveTo(15, -45);
    ctx.quadraticCurveTo(
      bridgeEndX / 2 + 10,
      bridgeEndY / 2 - 20 - chainSag,
      bridgeEndX,
      bridgeEndY + this.width / 2 - 5
    );
    ctx.stroke();

    ctx.setLineDash([]);

    // Chain anchor points (metal fixtures)
    ctx.fillStyle = TITLE_COLORS.metal.mid;
    ctx.beginPath();
    ctx.arc(-15, -45, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(15, -45, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
