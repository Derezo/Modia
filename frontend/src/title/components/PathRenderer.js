import { TITLE_COLORS } from '../TitleColors.js';

/**
 * Renders a dirt path/road from the castle to the forest.
 */
export class PathRenderer {
  constructor(points) {
    // Path defined by control points
    // Format: [{ x, y }, { x, y }, ...]
    this.points = points;
    this.pathWidth = 28;
  }

  update(deltaTime) {
    // Static path - no animation
  }

  render(ctx) {
    ctx.save();

    // Draw layers from bottom to top
    this.drawPathLayer(ctx, this.pathWidth + 6, TITLE_COLORS.path.shadow, 2, 2);  // Shadow
    this.drawPathLayer(ctx, this.pathWidth + 2, TITLE_COLORS.path.dark, 0, 0);    // Dark edge
    this.drawPathLayer(ctx, this.pathWidth, TITLE_COLORS.path.mid, 0, 0);         // Main path
    this.drawPathLayer(ctx, this.pathWidth * 0.5, TITLE_COLORS.path.light, 0, 0); // Center highlight

    // Draw texture/detail lines
    this.drawPathTexture(ctx);

    ctx.restore();
  }

  drawPathLayer(ctx, width, color, offsetX, offsetY) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();

    if (this.points.length < 2) return;

    ctx.moveTo(this.points[0].x + offsetX, this.points[0].y + offsetY);

    if (this.points.length === 2) {
      // Simple line
      ctx.lineTo(this.points[1].x + offsetX, this.points[1].y + offsetY);
    } else {
      // Smooth curve through points using quadratic beziers
      for (let i = 1; i < this.points.length - 1; i++) {
        const current = this.points[i];
        const next = this.points[i + 1];

        // Use midpoint as the curve end
        const midX = (current.x + next.x) / 2 + offsetX;
        const midY = (current.y + next.y) / 2 + offsetY;

        ctx.quadraticCurveTo(
          current.x + offsetX,
          current.y + offsetY,
          midX,
          midY
        );
      }

      // Final segment to last point
      const last = this.points[this.points.length - 1];
      ctx.lineTo(last.x + offsetX, last.y + offsetY);
    }

    ctx.stroke();
  }

  drawPathTexture(ctx) {
    // Dashed lines along edges for dirt road texture
    ctx.strokeStyle = TITLE_COLORS.path.dark;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);

    // Sample points along path for texture placement
    const sampleCount = 20;
    for (let i = 0; i < sampleCount; i++) {
      const t = i / sampleCount;
      const point = this.getPointOnPath(t);
      const nextPoint = this.getPointOnPath(Math.min(1, t + 0.05));

      // Calculate perpendicular direction
      const dx = nextPoint.x - point.x;
      const dy = nextPoint.y - point.y;
      const len = Math.sqrt(dx * dx + dy * dy);

      if (len > 0) {
        const perpX = -dy / len;
        const perpY = dx / len;

        // Small marks perpendicular to path direction
        const markOffset = (this.pathWidth / 2) - 3;

        ctx.beginPath();
        ctx.moveTo(point.x + perpX * markOffset, point.y + perpY * markOffset);
        ctx.lineTo(point.x + perpX * (markOffset + 4), point.y + perpY * (markOffset + 4));
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(point.x - perpX * markOffset, point.y - perpY * markOffset);
        ctx.lineTo(point.x - perpX * (markOffset + 4), point.y - perpY * (markOffset + 4));
        ctx.stroke();
      }
    }

    ctx.setLineDash([]);
  }

  getPointOnPath(t) {
    if (this.points.length < 2) {
      return this.points[0] || { x: 0, y: 0 };
    }

    if (this.points.length === 2) {
      return {
        x: this.points[0].x + (this.points[1].x - this.points[0].x) * t,
        y: this.points[0].y + (this.points[1].y - this.points[0].y) * t
      };
    }

    // For curves, approximate by linear interpolation between segments
    const totalSegments = this.points.length - 1;
    const segment = Math.floor(t * totalSegments);
    const segmentT = (t * totalSegments) - segment;

    const i = Math.min(segment, this.points.length - 2);
    const p1 = this.points[i];
    const p2 = this.points[i + 1];

    return {
      x: p1.x + (p2.x - p1.x) * segmentT,
      y: p1.y + (p2.y - p1.y) * segmentT
    };
  }
}
