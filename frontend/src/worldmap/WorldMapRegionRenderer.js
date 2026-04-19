/**
 * Renders region boundaries and related visual elements on the world map
 */
export class WorldMapRegionRenderer {
  /**
   * @param {Object} scene - WorldMapScene instance
   */
  constructor(scene) {
    this.scene = scene;
  }

  /**
   * Render region boundaries as subtle colored zones
   * Uses convex hull approximation based on region nodes
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  renderRegionBoundaries(ctx) {
    const {
      regions,
      nodes,
      nodeSpacing,
      cameraX,
      cameraY,
      pathSystem,
      nodeRenderer
    } = this.scene;

    if (!regions || regions.length === 0) return;

    ctx.save();

    for (const region of regions) {
      if (!region.race || !region.castleNodeId) continue;

      // Find all nodes belonging to this region
      const regionNodes = nodes.filter(n =>
        n.region_race === region.race &&
        pathSystem.isNodeReachable(n.id)
      );

      if (regionNodes.length < 3) continue;

      // Get region colors
      const colors = nodeRenderer.getRegionColor(region.race);

      // Calculate convex hull of region nodes for boundary
      const points = regionNodes.map(n => ({
        x: n.x_coord * nodeSpacing + cameraX,
        y: n.y_coord * nodeSpacing + cameraY
      }));

      const hull = this.computeConvexHull(points);
      if (hull.length < 3) continue;

      // Draw filled region with low opacity
      ctx.beginPath();
      ctx.moveTo(hull[0].x, hull[0].y);
      for (let i = 1; i < hull.length; i++) {
        ctx.lineTo(hull[i].x, hull[i].y);
      }
      ctx.closePath();

      ctx.fillStyle = colors.primary;
      ctx.globalAlpha = 0.05;
      ctx.fill();

      // Draw boundary line
      ctx.strokeStyle = colors.border;
      ctx.globalAlpha = 0.15;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  /**
   * Compute convex hull using Graham scan algorithm
   * @param {Array<{x: number, y: number}>} points - Points to compute hull for
   * @returns {Array<{x: number, y: number}>} Convex hull vertices in CCW order
   */
  computeConvexHull(points) {
    if (points.length < 3) return points;

    // Find the bottommost point (or leftmost if tied)
    let start = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i].y > points[start].y ||
          (points[i].y === points[start].y && points[i].x < points[start].x)) {
        start = i;
      }
    }

    // Swap start point to beginning
    [points[0], points[start]] = [points[start], points[0]];
    const pivot = points[0];

    // Sort by polar angle with respect to pivot
    const sorted = points.slice(1).sort((a, b) => {
      const angleA = Math.atan2(a.y - pivot.y, a.x - pivot.x);
      const angleB = Math.atan2(b.y - pivot.y, b.x - pivot.x);
      if (angleA !== angleB) return angleA - angleB;
      // If same angle, sort by distance (closer first)
      const distA = (a.x - pivot.x) ** 2 + (a.y - pivot.y) ** 2;
      const distB = (b.x - pivot.x) ** 2 + (b.y - pivot.y) ** 2;
      return distA - distB;
    });

    // Build hull using stack
    const hull = [pivot];

    for (const p of sorted) {
      // Remove points that make a clockwise turn
      while (hull.length > 1) {
        const top = hull[hull.length - 1];
        const second = hull[hull.length - 2];
        const cross = (top.x - second.x) * (p.y - second.y) -
                     (top.y - second.y) * (p.x - second.x);
        if (cross <= 0) {
          hull.pop();
        } else {
          break;
        }
      }
      hull.push(p);
    }

    return hull;
  }
}
