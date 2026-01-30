/**
 * HUDFrameRenderer - Renders simple wooden frame for World Map HUD panel
 *
 * Features:
 * - 3px dark wood outer border
 * - 1px inner bevel highlight on top/left edges
 * - 1px muted brass inset line
 * - Cached to offscreen canvas for performance (static render)
 */
import { HUD_COLORS } from '../../ui/parchment/ParchmentTheme.js';

export class HUDFrameRenderer {
  constructor() {
    this.cacheCanvas = null;
    this.cachedWidth = 0;
    this.cachedHeight = 0;
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

    // 2. Outer border (3px dark wood)
    ctx.strokeStyle = HUD_COLORS.frame.outer;
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);

    // 3. Inner bevel highlight (1px on top/left edges only)
    ctx.strokeStyle = HUD_COLORS.frame.inner;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(3.5, h - 3.5);
    ctx.lineTo(3.5, 3.5);
    ctx.lineTo(w - 3.5, 3.5);
    ctx.stroke();

    // 4. Muted brass inset line (1px)
    ctx.strokeStyle = HUD_COLORS.frame.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(4.5, 4.5, w - 9, h - 9);
  }

  render(ctx, x, y, width, height) {
    this.ensureCache(width, height);
    ctx.drawImage(this.cacheCanvas, x, y);
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
