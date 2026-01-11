import { TITLE_COLORS } from '../TitleColors.js';

/**
 * Renders a background forest with pine and oak trees.
 */
export class ForestRenderer {
  constructor(x, y, treeCount = 10) {
    this.x = x;
    this.y = y;
    this.trees = [];

    // Generate tree positions with variety
    for (let i = 0; i < treeCount; i++) {
      this.trees.push({
        x: i * 32 + (Math.random() - 0.5) * 20,
        y: (Math.random() - 0.5) * 40,
        scale: 0.6 + Math.random() * 0.5,
        type: Math.random() > 0.35 ? 'pine' : 'oak',
        shade: Math.random() * 0.15 // Slight color variation
      });
    }

    // Sort by y for depth ordering (trees further back rendered first)
    this.trees.sort((a, b) => a.y - b.y);
  }

  update(deltaTime) {
    // Static trees - no animation needed
  }

  render(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);

    for (const tree of this.trees) {
      ctx.save();
      ctx.translate(tree.x, tree.y);
      ctx.scale(tree.scale, tree.scale);

      if (tree.type === 'pine') {
        this.renderPineTree(ctx, tree.shade);
      } else {
        this.renderOakTree(ctx, tree.shade);
      }

      ctx.restore();
    }

    ctx.restore();
  }

  renderPineTree(ctx, shade) {
    // Trunk
    ctx.fillStyle = TITLE_COLORS.forest.trunk;
    ctx.fillRect(-5, 0, 10, 35);

    // Trunk texture
    ctx.fillStyle = TITLE_COLORS.forest.trunkDark;
    ctx.fillRect(-3, 5, 2, 25);
    ctx.fillRect(2, 10, 2, 20);

    // Bottom foliage layer
    ctx.fillStyle = this.adjustBrightness(TITLE_COLORS.forest.canopyDark, -shade * 30);
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(-30, 15);
    ctx.lineTo(30, 15);
    ctx.closePath();
    ctx.fill();

    // Middle foliage layer
    ctx.fillStyle = this.adjustBrightness(TITLE_COLORS.forest.canopyMid, -shade * 30);
    ctx.beginPath();
    ctx.moveTo(0, -35);
    ctx.lineTo(-24, 0);
    ctx.lineTo(24, 0);
    ctx.closePath();
    ctx.fill();

    // Top foliage layer
    ctx.fillStyle = this.adjustBrightness(TITLE_COLORS.forest.canopyLight, -shade * 30);
    ctx.beginPath();
    ctx.moveTo(0, -55);
    ctx.lineTo(-18, -25);
    ctx.lineTo(18, -25);
    ctx.closePath();
    ctx.fill();

    // Snow/highlight on tips
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.moveTo(0, -55);
    ctx.lineTo(-6, -40);
    ctx.lineTo(6, -40);
    ctx.closePath();
    ctx.fill();
  }

  renderOakTree(ctx, shade) {
    // Trunk
    ctx.fillStyle = TITLE_COLORS.forest.trunk;
    ctx.fillRect(-6, 0, 12, 30);

    // Trunk texture
    ctx.fillStyle = TITLE_COLORS.forest.trunkDark;
    ctx.fillRect(-4, 5, 3, 20);
    ctx.fillRect(2, 8, 2, 18);

    // Branches visible through canopy
    ctx.strokeStyle = TITLE_COLORS.forest.trunk;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    ctx.lineTo(-15, -15);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(3, 0);
    ctx.lineTo(15, -12);
    ctx.stroke();

    // Canopy circles (multiple overlapping)
    const canopyParts = [
      { x: 0, y: -25, r: 22 },
      { x: -14, y: -18, r: 16 },
      { x: 14, y: -18, r: 16 },
      { x: -8, y: -38, r: 14 },
      { x: 8, y: -38, r: 14 },
      { x: 0, y: -48, r: 12 }
    ];

    // Dark base layer
    ctx.fillStyle = this.adjustBrightness(TITLE_COLORS.forest.canopyDark, -shade * 30);
    for (const part of canopyParts) {
      ctx.beginPath();
      ctx.arc(part.x, part.y, part.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mid layer (slightly offset for 3D effect)
    ctx.fillStyle = this.adjustBrightness(TITLE_COLORS.forest.canopyMid, -shade * 30);
    for (const part of canopyParts) {
      ctx.beginPath();
      ctx.arc(part.x - 2, part.y - 2, part.r * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Light highlight spots
    ctx.fillStyle = this.adjustBrightness(TITLE_COLORS.forest.canopyLight, -shade * 30);
    ctx.beginPath();
    ctx.arc(-6, -32, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(4, -42, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  adjustBrightness(hex, amount) {
    // Simple brightness adjustment
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);

    r = Math.max(0, Math.min(255, r + amount));
    g = Math.max(0, Math.min(255, g + amount));
    b = Math.max(0, Math.min(255, b + amount));

    return `rgb(${r}, ${g}, ${b})`;
  }
}
