import { TITLE_COLORS } from '../TitleColors.js';

/**
 * Renders a static wooden bridge spanning the vertical river.
 * The bridge is horizontal, allowing soldiers and monsters to cross.
 */
export class BridgeRenderer {
  constructor(x, y, width, height) {
    // Bridge position (x, y is the left edge, centered vertically at y)
    this.x = x;
    this.y = y;
    this.width = width;   // How far the bridge spans (across river)
    this.height = height; // Bridge deck thickness

    // Visual dimensions
    this.plankWidth = 12;
    this.postHeight = 20;
    this.postWidth = 8;
    this.railHeight = 6;
  }

  render(ctx) {
    ctx.save();

    // Shadow on water
    this.renderShadow(ctx);

    // Support posts
    this.renderPosts(ctx);

    // Main bridge deck
    this.renderDeck(ctx);

    // Side rails
    this.renderRails(ctx);

    ctx.restore();
  }

  renderShadow(ctx) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(
      this.x + 4,
      this.y + this.height + 2,
      this.width,
      8
    );
  }

  renderPosts(ctx) {
    const postPositions = [
      this.x,
      this.x + this.width / 3,
      this.x + (this.width * 2) / 3,
      this.x + this.width - this.postWidth
    ];

    for (const px of postPositions) {
      // Post going down into water
      ctx.fillStyle = TITLE_COLORS.wood.dark;
      ctx.fillRect(
        px,
        this.y + this.height,
        this.postWidth,
        this.postHeight
      );

      // Post highlight
      ctx.fillStyle = TITLE_COLORS.wood.mid;
      ctx.fillRect(
        px + 1,
        this.y + this.height,
        2,
        this.postHeight - 2
      );

      // Top cap on posts (above deck)
      ctx.fillStyle = TITLE_COLORS.wood.mid;
      ctx.fillRect(
        px - 1,
        this.y - this.railHeight - 4,
        this.postWidth + 2,
        this.railHeight + 4
      );

      // Post cap highlight
      ctx.fillStyle = TITLE_COLORS.wood.light;
      ctx.fillRect(
        px,
        this.y - this.railHeight - 3,
        2,
        this.railHeight + 2
      );
    }
  }

  renderDeck(ctx) {
    // Base deck shadow
    ctx.fillStyle = TITLE_COLORS.wood.dark;
    ctx.fillRect(this.x, this.y + 2, this.width, this.height);

    // Main deck
    ctx.fillStyle = TITLE_COLORS.wood.mid;
    ctx.fillRect(this.x, this.y, this.width, this.height);

    // Individual planks
    ctx.strokeStyle = TITLE_COLORS.wood.dark;
    ctx.lineWidth = 1;

    for (let px = this.x; px < this.x + this.width; px += this.plankWidth) {
      ctx.beginPath();
      ctx.moveTo(px, this.y);
      ctx.lineTo(px, this.y + this.height);
      ctx.stroke();
    }

    // Plank highlights
    ctx.strokeStyle = TITLE_COLORS.wood.light;
    ctx.lineWidth = 0.5;

    for (let px = this.x + 2; px < this.x + this.width; px += this.plankWidth) {
      ctx.beginPath();
      ctx.moveTo(px, this.y + 1);
      ctx.lineTo(px, this.y + this.height - 1);
      ctx.stroke();
    }

    // Top edge highlight
    ctx.fillStyle = TITLE_COLORS.wood.light;
    ctx.fillRect(this.x, this.y, this.width, 1);

    // Bottom edge shadow
    ctx.fillStyle = TITLE_COLORS.wood.dark;
    ctx.fillRect(this.x, this.y + this.height - 1, this.width, 1);

    // Metal reinforcement bands
    ctx.fillStyle = TITLE_COLORS.metal.dark;
    const bandPositions = [
      this.x + this.width * 0.2,
      this.x + this.width * 0.5,
      this.x + this.width * 0.8
    ];

    for (const bx of bandPositions) {
      ctx.fillRect(bx - 2, this.y - 1, 4, this.height + 2);

      // Band highlight
      ctx.fillStyle = TITLE_COLORS.metal.light;
      ctx.fillRect(bx - 1, this.y, 1, this.height);
      ctx.fillStyle = TITLE_COLORS.metal.dark;
    }
  }

  renderRails(ctx) {
    // Side rails (top and bottom of bridge)
    const railY1 = this.y - this.railHeight;
    const railY2 = this.y + this.height;

    // Top rail (closer to camera)
    ctx.fillStyle = TITLE_COLORS.wood.mid;
    ctx.fillRect(this.x, railY1, this.width, this.railHeight);

    // Rail shadow
    ctx.fillStyle = TITLE_COLORS.wood.dark;
    ctx.fillRect(this.x, railY1 + this.railHeight - 1, this.width, 1);

    // Rail highlight
    ctx.fillStyle = TITLE_COLORS.wood.light;
    ctx.fillRect(this.x, railY1, this.width, 1);

    // Cross beams on rail
    ctx.strokeStyle = TITLE_COLORS.wood.dark;
    ctx.lineWidth = 2;
    for (let rx = this.x + 15; rx < this.x + this.width - 10; rx += 25) {
      ctx.beginPath();
      ctx.moveTo(rx, railY1);
      ctx.lineTo(rx + 8, railY1 + this.railHeight);
      ctx.stroke();
    }
  }

  /**
   * Check if a point is on the bridge (for collision/walking)
   */
  isOnBridge(x, y) {
    return x >= this.x && x <= this.x + this.width &&
           y >= this.y - 10 && y <= this.y + this.height + 10;
  }
}
