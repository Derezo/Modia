import { TITLE_COLORS } from '../TitleColors.js';

/**
 * Renders a castle gate with double doors that swing outward.
 * Positioned in front of the castle to release soldiers.
 */
export class CastleGateRenderer {
  constructor(x, y, scale = 1) {
    this.x = x;
    this.y = y;
    this.scale = scale;

    // Gate dimensions
    this.archWidth = 50 * scale;
    this.archHeight = 60 * scale;
    this.doorWidth = 22 * scale;
    this.doorHeight = 50 * scale;
    this.stoneThickness = 8 * scale;

    // Door animation
    this.doorAngle = 0;          // 0 = closed, PI/2 = fully open
    this.targetAngle = 0;
    this.animationSpeed = 0.0018; // radians per ms
    this.isOpening = false;
  }

  /**
   * Start opening the doors
   */
  open() {
    this.targetAngle = Math.PI / 2;
    this.isOpening = true;
  }

  /**
   * Close the doors
   */
  close() {
    this.targetAngle = 0;
  }

  /**
   * Check if doors are fully open
   */
  isOpen() {
    return this.doorAngle >= Math.PI / 2 - 0.05;
  }

  /**
   * Check if doors are fully closed
   */
  isClosed() {
    return this.doorAngle < 0.05;
  }

  /**
   * Check if currently animating
   */
  isAnimating() {
    return Math.abs(this.doorAngle - this.targetAngle) > 0.02;
  }

  update(deltaTime) {
    if (this.doorAngle < this.targetAngle) {
      // Opening - use easing (slow start, accelerate)
      const remaining = this.targetAngle - this.doorAngle;
      const speedMultiplier = 0.5 + (this.doorAngle / (Math.PI / 2)) * 1.5;
      this.doorAngle = Math.min(
        this.targetAngle,
        this.doorAngle + this.animationSpeed * speedMultiplier * deltaTime
      );
    } else if (this.doorAngle > this.targetAngle) {
      // Closing
      this.doorAngle = Math.max(
        this.targetAngle,
        this.doorAngle - this.animationSpeed * deltaTime
      );
    }
  }

  render(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);

    // Render order: arch back, doors, arch front
    this.renderArchBack(ctx);
    this.renderDoors(ctx);
    this.renderArchFront(ctx);

    ctx.restore();
  }

  renderArchBack(ctx) {
    // Dark interior behind doors
    ctx.fillStyle = '#1a1a2a';
    ctx.fillRect(
      -this.archWidth / 2 + this.stoneThickness,
      -this.archHeight + this.stoneThickness,
      this.archWidth - this.stoneThickness * 2,
      this.archHeight - this.stoneThickness
    );
  }

  renderDoors(ctx) {
    // Left door (hinged on left side, swings left/outward)
    ctx.save();
    // Pivot point is left edge of left door
    const leftDoorX = -this.archWidth / 2 + this.stoneThickness + 2;
    ctx.translate(leftDoorX, 0);
    ctx.rotate(-this.doorAngle); // Negative to swing outward (left)

    this.renderSingleDoor(ctx, true);
    ctx.restore();

    // Right door (hinged on right side, swings right/outward)
    ctx.save();
    // Pivot point is right edge of right door
    const rightDoorX = this.archWidth / 2 - this.stoneThickness - 2;
    ctx.translate(rightDoorX, 0);
    ctx.rotate(this.doorAngle); // Positive to swing outward (right)

    this.renderSingleDoor(ctx, false);
    ctx.restore();
  }

  renderSingleDoor(ctx, isLeft) {
    const doorX = isLeft ? 0 : -this.doorWidth;
    const doorY = -this.doorHeight;

    // Door shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(doorX + 2, doorY + 2, this.doorWidth, this.doorHeight);

    // Main door wood
    ctx.fillStyle = TITLE_COLORS.wood.mid;
    ctx.fillRect(doorX, doorY, this.doorWidth, this.doorHeight);

    // Vertical plank lines
    ctx.strokeStyle = TITLE_COLORS.wood.dark;
    ctx.lineWidth = 1;
    const plankWidth = this.doorWidth / 3;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(doorX + i * plankWidth, doorY);
      ctx.lineTo(doorX + i * plankWidth, doorY + this.doorHeight);
      ctx.stroke();
    }

    // Horizontal reinforcement bands
    ctx.fillStyle = TITLE_COLORS.metal.dark;
    const bandHeight = 4 * this.scale;
    const bandPositions = [
      doorY + this.doorHeight * 0.15,
      doorY + this.doorHeight * 0.5,
      doorY + this.doorHeight * 0.85
    ];

    for (const by of bandPositions) {
      ctx.fillRect(doorX, by, this.doorWidth, bandHeight);

      // Band highlight
      ctx.fillStyle = TITLE_COLORS.metal.light;
      ctx.fillRect(doorX, by, this.doorWidth, 1);
      ctx.fillStyle = TITLE_COLORS.metal.dark;

      // Rivets
      ctx.fillStyle = TITLE_COLORS.metal.mid;
      ctx.beginPath();
      ctx.arc(doorX + 4, by + bandHeight / 2, 2, 0, Math.PI * 2);
      ctx.arc(doorX + this.doorWidth - 4, by + bandHeight / 2, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = TITLE_COLORS.metal.dark;
    }

    // Door handle/ring
    const handleX = isLeft ? doorX + this.doorWidth - 6 : doorX + 6;
    const handleY = doorY + this.doorHeight * 0.55;

    ctx.fillStyle = TITLE_COLORS.metal.mid;
    ctx.beginPath();
    ctx.arc(handleX, handleY, 4, 0, Math.PI * 2);
    ctx.fill();

    // Ring
    ctx.strokeStyle = TITLE_COLORS.metal.dark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(handleX, handleY + 6, 5, 0, Math.PI);
    ctx.stroke();

    // Door edge highlight
    ctx.fillStyle = TITLE_COLORS.wood.light;
    if (isLeft) {
      ctx.fillRect(doorX, doorY, 2, this.doorHeight);
    } else {
      ctx.fillRect(doorX + this.doorWidth - 2, doorY, 2, this.doorHeight);
    }

    // Door edge shadow
    ctx.fillStyle = TITLE_COLORS.wood.dark;
    if (isLeft) {
      ctx.fillRect(doorX + this.doorWidth - 1, doorY, 1, this.doorHeight);
    } else {
      ctx.fillRect(doorX, doorY, 1, this.doorHeight);
    }
  }

  renderArchFront(ctx) {
    // Stone archway frame (in front of doors when they swing out)
    const halfWidth = this.archWidth / 2;
    const archTop = -this.archHeight;

    // Left pillar
    ctx.fillStyle = TITLE_COLORS.stone.mid;
    ctx.fillRect(-halfWidth, archTop, this.stoneThickness, this.archHeight);

    // Right pillar
    ctx.fillRect(halfWidth - this.stoneThickness, archTop, this.stoneThickness, this.archHeight);

    // Arch top (curved)
    ctx.beginPath();
    ctx.moveTo(-halfWidth, archTop);
    ctx.lineTo(-halfWidth, archTop - 10);
    ctx.quadraticCurveTo(0, archTop - 25, halfWidth, archTop - 10);
    ctx.lineTo(halfWidth, archTop);
    ctx.closePath();
    ctx.fill();

    // Stone block lines on pillars
    ctx.strokeStyle = TITLE_COLORS.stone.dark;
    ctx.lineWidth = 1;

    for (let y = archTop; y < 0; y += 12 * this.scale) {
      // Left pillar blocks
      ctx.beginPath();
      ctx.moveTo(-halfWidth, y);
      ctx.lineTo(-halfWidth + this.stoneThickness, y);
      ctx.stroke();

      // Right pillar blocks
      ctx.beginPath();
      ctx.moveTo(halfWidth - this.stoneThickness, y);
      ctx.lineTo(halfWidth, y);
      ctx.stroke();
    }

    // Pillar highlights
    ctx.fillStyle = TITLE_COLORS.stone.light;
    ctx.fillRect(-halfWidth, archTop, 2, this.archHeight);
    ctx.fillRect(halfWidth - 2, archTop, 2, this.archHeight);

    // Pillar shadows
    ctx.fillStyle = TITLE_COLORS.stone.dark;
    ctx.fillRect(-halfWidth + this.stoneThickness - 2, archTop, 2, this.archHeight);
    ctx.fillRect(halfWidth - this.stoneThickness, archTop, 2, this.archHeight);

    // Arch keystone
    ctx.fillStyle = TITLE_COLORS.stone.light;
    ctx.beginPath();
    ctx.moveTo(-6, archTop - 20);
    ctx.lineTo(6, archTop - 20);
    ctx.lineTo(8, archTop - 8);
    ctx.lineTo(-8, archTop - 8);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = TITLE_COLORS.stone.dark;
    ctx.stroke();
  }

  /**
   * Get the spawn point for soldiers (just inside the gate)
   */
  getSoldierSpawnPoint() {
    return {
      x: this.x,
      y: this.y - this.doorHeight * 0.3
    };
  }
}
