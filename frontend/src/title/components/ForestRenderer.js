import { TITLE_COLORS } from '../TitleColors.js';

/**
 * Renders a dense, layered forest with pine and oak trees.
 * Trees are organized into back, mid, and front layers for depth.
 * Extends across the right portion of the screen.
 */
export class ForestRenderer {
  constructor(x, y, baseTreeCount = 10, screenWidth = 800, screenHeight = 600) {
    this.x = x;
    this.y = y;
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;

    // Tree layers: back (distant), mid, front (closest)
    this.backTrees = [];
    this.midTrees = [];
    this.frontTrees = [];

    this.generateForest(baseTreeCount);
  }

  generateForest(baseCount) {
    const forestWidth = this.screenWidth - this.x + 50; // Extend past screen edge
    const forestHeight = this.screenHeight * 0.55; // Cover more vertical space

    // Back layer - smaller, more faded, densely packed
    const backCount = Math.floor(baseCount * 2.5);
    for (let i = 0; i < backCount; i++) {
      this.backTrees.push({
        x: Math.random() * forestWidth - 20,
        y: -30 + Math.random() * (forestHeight * 0.4),
        scale: 0.35 + Math.random() * 0.25,
        type: Math.random() > 0.3 ? 'pine' : 'oak',
        shade: 0.2 + Math.random() * 0.15,
        layer: 'back'
      });
    }

    // Mid layer - medium size, main forest body
    const midCount = Math.floor(baseCount * 2);
    for (let i = 0; i < midCount; i++) {
      this.midTrees.push({
        x: -10 + Math.random() * forestWidth,
        y: 20 + Math.random() * (forestHeight * 0.5),
        scale: 0.5 + Math.random() * 0.35,
        type: Math.random() > 0.35 ? 'pine' : 'oak',
        shade: 0.1 + Math.random() * 0.1,
        layer: 'mid'
      });
    }

    // Front layer - larger, more detailed, sparser
    const frontCount = Math.floor(baseCount * 1.5);
    for (let i = 0; i < frontCount; i++) {
      this.frontTrees.push({
        x: -30 + Math.random() * (forestWidth + 40),
        y: 60 + Math.random() * (forestHeight * 0.6),
        scale: 0.7 + Math.random() * 0.45,
        type: Math.random() > 0.4 ? 'pine' : 'oak',
        shade: Math.random() * 0.08,
        layer: 'front'
      });
    }

    // Sort each layer by y for proper depth
    this.backTrees.sort((a, b) => a.y - b.y);
    this.midTrees.sort((a, b) => a.y - b.y);
    this.frontTrees.sort((a, b) => a.y - b.y);
  }

  update(_deltaTime) {
    // Static trees - no animation needed
  }

  /**
   * Render back layer only (behind entities)
   */
  renderBackLayer(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);

    // Render back trees with fog effect
    ctx.globalAlpha = 0.6;
    for (const tree of this.backTrees) {
      this.renderTree(ctx, tree);
    }

    ctx.restore();
  }

  /**
   * Render mid layer (behind entities)
   */
  renderMidLayer(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);

    ctx.globalAlpha = 0.85;
    for (const tree of this.midTrees) {
      this.renderTree(ctx, tree);
    }

    ctx.restore();
  }

  /**
   * Render front layer (in front of entities)
   */
  renderFrontLayer(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);

    for (const tree of this.frontTrees) {
      this.renderTree(ctx, tree);
    }

    ctx.restore();
  }

  /**
   * Render all layers (original behavior for backwards compatibility)
   */
  render(ctx) {
    this.renderBackLayer(ctx);
    this.renderMidLayer(ctx);
    // Note: front layer should be rendered after entities
    // This is handled in TitleAnimationEngine
  }

  renderTree(ctx, tree) {
    ctx.save();
    ctx.translate(tree.x, tree.y);
    ctx.scale(tree.scale, tree.scale);

    if (tree.type === 'pine') {
      this.renderPineTree(ctx, tree.shade, tree.layer);
    } else {
      this.renderOakTree(ctx, tree.shade, tree.layer);
    }

    ctx.restore();
  }

  renderPineTree(ctx, shade, layer) {
    const darkMod = layer === 'back' ? -20 : layer === 'mid' ? -10 : 0;

    // Trunk
    ctx.fillStyle = this.adjustBrightness(TITLE_COLORS.forest.trunk, darkMod);
    ctx.fillRect(-5, 0, 10, 35);

    // Trunk texture
    ctx.fillStyle = this.adjustBrightness(TITLE_COLORS.forest.trunkDark, darkMod);
    ctx.fillRect(-3, 5, 2, 25);
    ctx.fillRect(2, 10, 2, 20);

    // Bottom foliage layer
    ctx.fillStyle = this.adjustBrightness(TITLE_COLORS.forest.canopyDark, -shade * 30 + darkMod);
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(-30, 15);
    ctx.lineTo(30, 15);
    ctx.closePath();
    ctx.fill();

    // Middle foliage layer
    ctx.fillStyle = this.adjustBrightness(TITLE_COLORS.forest.canopyMid, -shade * 30 + darkMod);
    ctx.beginPath();
    ctx.moveTo(0, -35);
    ctx.lineTo(-24, 0);
    ctx.lineTo(24, 0);
    ctx.closePath();
    ctx.fill();

    // Top foliage layer
    ctx.fillStyle = this.adjustBrightness(TITLE_COLORS.forest.canopyLight, -shade * 30 + darkMod);
    ctx.beginPath();
    ctx.moveTo(0, -55);
    ctx.lineTo(-18, -25);
    ctx.lineTo(18, -25);
    ctx.closePath();
    ctx.fill();

    // Highlight on tips (more visible on front trees)
    if (layer !== 'back') {
      ctx.fillStyle = `rgba(255, 255, 255, ${layer === 'front' ? 0.2 : 0.12})`;
      ctx.beginPath();
      ctx.moveTo(0, -55);
      ctx.lineTo(-6, -40);
      ctx.lineTo(6, -40);
      ctx.closePath();
      ctx.fill();
    }

    // Add some branch details on front trees
    if (layer === 'front') {
      ctx.strokeStyle = this.adjustBrightness(TITLE_COLORS.forest.canopyDark, -10);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-15, 8);
      ctx.lineTo(-22, 12);
      ctx.moveTo(15, 8);
      ctx.lineTo(22, 12);
      ctx.stroke();
    }
  }

  renderOakTree(ctx, shade, layer) {
    const darkMod = layer === 'back' ? -20 : layer === 'mid' ? -10 : 0;

    // Trunk
    ctx.fillStyle = this.adjustBrightness(TITLE_COLORS.forest.trunk, darkMod);
    ctx.fillRect(-6, 0, 12, 30);

    // Trunk texture
    ctx.fillStyle = this.adjustBrightness(TITLE_COLORS.forest.trunkDark, darkMod);
    ctx.fillRect(-4, 5, 3, 20);
    ctx.fillRect(2, 8, 2, 18);

    // Branches visible through canopy
    ctx.strokeStyle = this.adjustBrightness(TITLE_COLORS.forest.trunk, darkMod);
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
    ctx.fillStyle = this.adjustBrightness(TITLE_COLORS.forest.canopyDark, -shade * 30 + darkMod);
    for (const part of canopyParts) {
      ctx.beginPath();
      ctx.arc(part.x, part.y, part.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mid layer (slightly offset for 3D effect)
    ctx.fillStyle = this.adjustBrightness(TITLE_COLORS.forest.canopyMid, -shade * 30 + darkMod);
    for (const part of canopyParts) {
      ctx.beginPath();
      ctx.arc(part.x - 2, part.y - 2, part.r * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Light highlight spots (more visible on front trees)
    if (layer !== 'back') {
      ctx.fillStyle = this.adjustBrightness(TITLE_COLORS.forest.canopyLight, -shade * 30 + darkMod);
      ctx.beginPath();
      ctx.arc(-6, -32, layer === 'front' ? 10 : 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(4, -42, layer === 'front' ? 8 : 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Extra detail on front trees
    if (layer === 'front') {
      // Subtle leaf texture
      ctx.fillStyle = this.adjustBrightness(TITLE_COLORS.forest.canopyLight, 10);
      for (let i = 0; i < 5; i++) {
        const lx = -12 + Math.random() * 24;
        const ly = -45 + Math.random() * 30;
        ctx.beginPath();
        ctx.arc(lx, ly, 3 + Math.random() * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  adjustBrightness(hex, amount) {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);

    r = Math.max(0, Math.min(255, r + amount));
    g = Math.max(0, Math.min(255, g + amount));
    b = Math.max(0, Math.min(255, b + amount));

    return `rgb(${r}, ${g}, ${b})`;
  }
}
