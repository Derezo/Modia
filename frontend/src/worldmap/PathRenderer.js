/**
 * PathRenderer - Organic path rendering using Catmull-Rom splines
 * Creates natural S-curves for paths between world map nodes
 */

import { SeededRandom } from '@shared/constants.js';

/**
 * Generate organic path control points using seeded noise
 * @param {number} x1 - Start node screen X position
 * @param {number} y1 - Start node screen Y position
 * @param {number} x2 - End node screen X position
 * @param {number} y2 - End node screen Y position
 * @param {number} fromNodeId - Source node ID for deterministic seeding
 * @param {number} toNodeId - Destination node ID for deterministic seeding
 * @returns {Array<{x: number, y: number}>} Array of control points including endpoints
 */
export function generatePathControlPoints(x1, y1, x2, y2, fromNodeId, toNodeId) {
  // Create deterministic seed from both node IDs (order-independent)
  const seedValue = Math.min(fromNodeId, toNodeId) * 1000000 + Math.max(fromNodeId, toNodeId);
  const rng = new SeededRandom(seedValue);

  // Calculate path length and number of control points (2-5 based on distance)
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const numPoints = Math.max(2, Math.min(5, Math.floor(length / 80) + 2));

  // Handle zero-length paths
  if (length < 1) {
    return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  }

  // Calculate tangent and perpendicular vectors
  const tangentX = dx / length;
  const tangentY = dy / length;
  const perpX = -tangentY;
  const perpY = tangentX;

  // Generate intermediate control points with seeded offsets
  const points = [{ x: x1, y: y1 }];

  for (let i = 1; i < numPoints - 1; i++) {
    const t = i / (numPoints - 1);

    // Base position along straight line
    const baseX = x1 + dx * t;
    const baseY = y1 + dy * t;

    // Seeded perpendicular offset (creates S-curves)
    // Use sin wave modulated by random to create natural curves
    const direction = Math.sin(t * Math.PI * 2) * (rng.next() - 0.5);
    const amplitude = length * 0.15 * (0.5 + rng.next() * 0.5);

    points.push({
      x: baseX + perpX * direction * amplitude,
      y: baseY + perpY * direction * amplitude
    });
  }

  points.push({ x: x2, y: y2 });
  return points;
}

/**
 * Catmull-Rom spline interpolation between four points
 * @param {Object} p0 - Point before start
 * @param {Object} p1 - Start point
 * @param {Object} p2 - End point
 * @param {Object} p3 - Point after end
 * @param {number} t - Interpolation parameter [0, 1]
 * @param {number} tension - Spline tension (0.5 = Catmull-Rom, 0 = linear, 1 = tight)
 * @returns {{x: number, y: number}} Interpolated point
 */
export function catmullRomPoint(p0, p1, p2, p3, t, tension = 0.5) {
  const t2 = t * t;
  const t3 = t2 * t;

  // Catmull-Rom matrix with tension parameter
  const alpha = tension;

  const x = (
    (-alpha * p0.x + (2 - alpha) * p1.x + (alpha - 2) * p2.x + alpha * p3.x) * t3 +
    (2 * alpha * p0.x + (alpha - 3) * p1.x + (3 - 2 * alpha) * p2.x - alpha * p3.x) * t2 +
    (-alpha * p0.x + alpha * p2.x) * t +
    p1.x
  );

  const y = (
    (-alpha * p0.y + (2 - alpha) * p1.y + (alpha - 2) * p2.y + alpha * p3.y) * t3 +
    (2 * alpha * p0.y + (alpha - 3) * p1.y + (3 - 2 * alpha) * p2.y - alpha * p3.y) * t2 +
    (-alpha * p0.y + alpha * p2.y) * t +
    p1.y
  );

  return { x, y };
}

/**
 * Generate points along a Catmull-Rom spline through control points
 * @param {Array<{x: number, y: number}>} controlPoints - Array of control points
 * @param {number} segmentsPerSpan - Number of line segments per span between control points
 * @returns {Array<{x: number, y: number}>} Array of points along the spline
 */
export function generateSplinePoints(controlPoints, segmentsPerSpan = 8) {
  if (controlPoints.length < 2) {
    return controlPoints;
  }

  if (controlPoints.length === 2) {
    // For 2 points, just interpolate linearly
    const result = [];
    for (let i = 0; i <= segmentsPerSpan; i++) {
      const t = i / segmentsPerSpan;
      result.push({
        x: controlPoints[0].x + (controlPoints[1].x - controlPoints[0].x) * t,
        y: controlPoints[0].y + (controlPoints[1].y - controlPoints[0].y) * t
      });
    }
    return result;
  }

  const result = [];
  const n = controlPoints.length;

  // For each span between adjacent control points
  for (let i = 0; i < n - 1; i++) {
    // Get the four points needed for Catmull-Rom
    // Clamp indices at boundaries
    const p0 = controlPoints[Math.max(0, i - 1)];
    const p1 = controlPoints[i];
    const p2 = controlPoints[i + 1];
    const p3 = controlPoints[Math.min(n - 1, i + 2)];

    // Generate points along this span
    const isLastSpan = i === n - 2;
    const endT = isLastSpan ? segmentsPerSpan : segmentsPerSpan - 1;

    for (let j = 0; j <= endT; j++) {
      const t = j / segmentsPerSpan;
      result.push(catmullRomPoint(p0, p1, p2, p3, t));
    }
  }

  return result;
}

/**
 * Render an organic path using Catmull-Rom spline
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {number} x1 - Start X
 * @param {number} y1 - Start Y
 * @param {number} x2 - End X
 * @param {number} y2 - End Y
 * @param {number} fromNodeId - Source node ID
 * @param {number} toNodeId - Destination node ID
 * @param {Object} style - Style configuration
 * @param {string} style.color - Stroke color
 * @param {number} style.width - Line width
 * @param {boolean} style.dashed - Use dashed line
 * @param {string} style.shadowColor - Shadow color (optional)
 * @param {number} style.shadowOffset - Shadow offset (optional)
 */
export function renderOrganicPath(ctx, x1, y1, x2, y2, fromNodeId, toNodeId, style = {}) {
  const {
    color = '#5d4e37',
    width = 2,
    dashed = false,
    shadowColor = null,
    shadowOffset = 2
  } = style;

  // Generate control points
  const controlPoints = generatePathControlPoints(x1, y1, x2, y2, fromNodeId, toNodeId);

  // Generate spline points
  const splinePoints = generateSplinePoints(controlPoints, 10);

  if (splinePoints.length < 2) return;

  // Draw shadow if specified
  if (shadowColor) {
    ctx.save();
    ctx.strokeStyle = shadowColor;
    ctx.lineWidth = width + 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(splinePoints[0].x + shadowOffset, splinePoints[0].y + shadowOffset);
    for (let i = 1; i < splinePoints.length; i++) {
      ctx.lineTo(splinePoints[i].x + shadowOffset, splinePoints[i].y + shadowOffset);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Draw main path
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (dashed) {
    ctx.setLineDash([5, 5]);
  }

  ctx.beginPath();
  ctx.moveTo(splinePoints[0].x, splinePoints[0].y);
  for (let i = 1; i < splinePoints.length; i++) {
    ctx.lineTo(splinePoints[i].x, splinePoints[i].y);
  }
  ctx.stroke();

  if (dashed) {
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/**
 * Render path with gradient fog reveal effect
 * Used for fog of war cutouts along paths
 * @param {CanvasRenderingContext2D} ctx - Canvas context (should be in destination-out mode)
 * @param {number} x1 - Start X
 * @param {number} y1 - Start Y
 * @param {number} x2 - End X
 * @param {number} y2 - End Y
 * @param {number} fromNodeId - Source node ID
 * @param {number} toNodeId - Destination node ID
 * @param {number} baseWidth - Base path width
 * @param {number} baseOpacity - Base opacity for reveal
 */
export function renderPathReveal(ctx, x1, y1, x2, y2, fromNodeId, toNodeId, baseWidth = 44, baseOpacity = 1.0) {
  // Generate control points
  const controlPoints = generatePathControlPoints(x1, y1, x2, y2, fromNodeId, toNodeId);

  // Generate spline points
  const splinePoints = generateSplinePoints(controlPoints, 10);

  if (splinePoints.length < 2) return;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Draw multiple passes for gradient edge effect (outer to inner)
  const passes = [
    { widthMult: 2.0, opacityMult: 0.15 },  // Outer soft edge
    { widthMult: 1.5, opacityMult: 0.3 },   // Mid edge
    { widthMult: 1.0, opacityMult: 0.7 },   // Inner edge
    { widthMult: 0.6, opacityMult: 1.0 }    // Core
  ];

  for (const pass of passes) {
    const opacity = baseOpacity * pass.opacityMult;
    ctx.strokeStyle = `rgba(0, 0, 0, ${opacity})`;
    ctx.lineWidth = baseWidth * pass.widthMult;

    ctx.beginPath();
    ctx.moveTo(splinePoints[0].x, splinePoints[0].y);
    for (let i = 1; i < splinePoints.length; i++) {
      ctx.lineTo(splinePoints[i].x, splinePoints[i].y);
    }
    ctx.stroke();
  }
}

/**
 * Get the legacy bezier control point for backward compatibility
 * This matches the original WorldMapScene algorithm
 * @param {number} x1 - Start X
 * @param {number} y1 - Start Y
 * @param {number} x2 - End X
 * @param {number} y2 - End Y
 * @param {number} fromNodeId - Source node ID
 * @param {number} toNodeId - Destination node ID
 * @returns {{x: number, y: number}} Control point
 */
export function getLegacyControlPoint(x1, y1, x2, y2, fromNodeId, toNodeId) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);

  if (length < 1) return { x: midX, y: midY };

  // Perpendicular vector
  const perpX = -dy / length;
  const perpY = dx / length;

  // Curve amount proportional to path length (capped)
  const curveAmount = Math.min(length * 0.2, 40);

  // Consistent direction based on node ID ordering
  const direction = fromNodeId < toNodeId ? 1 : -1;

  return {
    x: midX + perpX * curveAmount * direction,
    y: midY + perpY * curveAmount * direction
  };
}
