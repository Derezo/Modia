/**
 * HUDFrameRenderer - Renders ornate medieval frame for World Map HUD panel
 *
 * Features:
 * - 4px gold filigree border with double-line effect
 * - Corner ornaments (stylized fleur-de-lis, 8x8px)
 * - Edge filigree (small diamonds every 20px)
 * - Subtle ambient glow (0.5Hz pulse)
 * - Cached to offscreen canvas for performance
 */
import { HUD_COLORS } from '../../ui/parchment/ParchmentTheme.js';

const CORNER_SIZE = 8;
const DIAMOND_SPACING = 20;
const DIAMOND_SIZE = 3;

export class HUDFrameRenderer {
  constructor() {
    this.cacheCanvas = null;
    this.cachedWidth = 0;
    this.cachedHeight = 0;
    this.glowPhase = 0;
  }

  ensureCache(width, height) {
    if (this.cacheCanvas && this.cachedWidth === width && this.cachedHeight === height) return;
    this.cacheCanvas = document.createElement('canvas');
    this.cacheCanvas.width = width;
    this.cacheCanvas.height = height;
    this.cachedWidth = width;
    this.cachedHeight = height;
    this.renderToCache();
  }

  renderToCache() {
    const ctx = this.cacheCanvas.getContext('2d');
    const w = this.cachedWidth;
    const h = this.cachedHeight;

    ctx.clearRect(0, 0, w, h);

    // 1. Fill background
    ctx.fillStyle = HUD_COLORS.panel.background;
    ctx.fillRect(0, 0, w, h);

    // 2. Outer border (2px dark wood)
    ctx.strokeStyle = HUD_COLORS.frame.outer;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);

    // 3. Inner border (2px mid wood)
    ctx.strokeStyle = HUD_COLORS.frame.inner;
    ctx.strokeRect(3, 3, w - 6, h - 6);

    // 4. Gold filigree double-line border
    ctx.strokeStyle = HUD_COLORS.frame.filigree;
    ctx.lineWidth = 1;
    ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.strokeRect(7, 7, w - 14, h - 14);

    // 5. Corner ornaments
    this.drawCornerOrnaments(ctx, w, h);

    // 6. Edge diamonds
    this.drawEdgeDiamonds(ctx, w, h);
  }

  drawCornerOrnaments(ctx, w, h) {
    ctx.fillStyle = HUD_COLORS.frame.filigree;
    ctx.strokeStyle = HUD_COLORS.frame.filigreeShadow;
    ctx.lineWidth = 0.5;

    const corners = [
      [CORNER_SIZE, CORNER_SIZE, 0],
      [w - CORNER_SIZE, CORNER_SIZE, Math.PI / 2],
      [w - CORNER_SIZE, h - CORNER_SIZE, Math.PI],
      [CORNER_SIZE, h - CORNER_SIZE, -Math.PI / 2]
    ];

    for (const [cx, cy, rot] of corners) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);

      // Simplified fleur-de-lis: central and left petals via bezier curves
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.bezierCurveTo(-2, -4, -2, -2, 0, 0);
      ctx.bezierCurveTo(2, -2, 2, -4, 0, -6);
      ctx.moveTo(-6, 0);
      ctx.bezierCurveTo(-4, -2, -2, -2, 0, 0);
      ctx.bezierCurveTo(-2, 2, -4, 2, -6, 0);
      ctx.fill();
      ctx.stroke();

      // Center diamond
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.lineTo(2, 0);
      ctx.lineTo(0, 2);
      ctx.lineTo(-2, 0);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
  }

  drawEdgeDiamonds(ctx, w, h) {
    ctx.fillStyle = HUD_COLORS.frame.filigree;
    const offset = CORNER_SIZE + 10;

    const drawDiamond = (x, y) => {
      ctx.beginPath();
      ctx.moveTo(x, y - DIAMOND_SIZE);
      ctx.lineTo(x + DIAMOND_SIZE, y);
      ctx.lineTo(x, y + DIAMOND_SIZE);
      ctx.lineTo(x - DIAMOND_SIZE, y);
      ctx.closePath();
      ctx.fill();
    };

    // Horizontal edges
    for (let x = offset; x < w - offset; x += DIAMOND_SPACING) {
      drawDiamond(x, 6);
      drawDiamond(x, h - 6);
    }

    // Vertical edges
    for (let y = offset; y < h - offset; y += DIAMOND_SPACING) {
      drawDiamond(6, y);
      drawDiamond(w - 6, y);
    }
  }

  update(deltaTime) {
    this.glowPhase += (deltaTime / 1000) * Math.PI; // 0.5Hz
    if (this.glowPhase > Math.PI * 2) this.glowPhase -= Math.PI * 2;
  }

  render(ctx, x, y, width, height) {
    this.ensureCache(width, height);

    const glowIntensity = 0.15 + Math.sin(this.glowPhase) * 0.05;

    ctx.save();
    ctx.shadowColor = HUD_COLORS.frame.filigree;
    ctx.shadowBlur = 8 * glowIntensity;
    ctx.drawImage(this.cacheCanvas, x, y);
    ctx.restore();
  }

  invalidateCache() {
    this.cacheCanvas = null;
    this.cachedWidth = 0;
    this.cachedHeight = 0;
  }

  destroy() {
    // Help browser release GPU memory faster by zeroing canvas dimensions
    if (this.cacheCanvas) {
      this.cacheCanvas.width = 0;
      this.cacheCanvas.height = 0;
    }
    this.invalidateCache();
  }
}
