/**
 * PathRenderer - Organic path rendering using Catmull-Rom splines
 * Creates natural S-curves for paths between world map nodes
 * Supports variance levels for dynamic curve intensity
 */

import { SeededRandom } from '@modia/shared/constants';

/**
 * Colorblind-safe route styling. Route meaning is encoded by pattern and width,
 * with color acting only as a secondary cue.
 */
export function getWorldRouteStyle(
  pathType = 'road',
  routeKind = null,
  visited = true,
  displayScale = 1
) {
  const styles = {
    road: { color: '#5d4e37', width: 4, lineDash: [] },
    trail: { color: '#315b45', width: 2, lineDash: [12, 3] },
    bridge: { color: '#8b5a2b', width: 5, lineDash: [14, 3] },
    tunnel: { color: '#343442', width: 3, lineDash: [2, 4] }
  };
  const wildernessDashes = {
    road: [8, 5],
    trail: [8, 5, 2, 5],
    bridge: [14, 5, 2, 5],
    tunnel: [2, 5, 2, 8]
  };
  const clampedScale = Math.min(2, Math.max(0.5,
    Number.isFinite(displayScale) ? displayScale : 1
  ));
  const normalizedType = Object.hasOwn(styles, pathType)
    ? pathType
    : routeKind === 'wilderness'
      ? 'trail'
      : 'road';
  const style = styles[normalizedType] ?? styles.road;
  const lineDash = routeKind === 'wilderness'
    ? wildernessDashes[normalizedType]
    : style.lineDash;
  const routeRisk = routeKind === 'trade'
    ? 'Lower-risk combat'
    : routeKind === 'wilderness'
      ? 'Higher-risk wilderness'
      : null;
  const segmentLabel = normalizedType === 'bridge'
    ? 'bridge crossing'
    : normalizedType === 'tunnel'
      ? 'tunnel passage'
      : normalizedType;
  const label = routeRisk
    ? `${routeRisk} ${segmentLabel}`
    : normalizedType === 'road' || normalizedType === 'trail'
      ? 'Regional path'
      : `${segmentLabel.charAt(0).toUpperCase()}${segmentLabel.slice(1)}`;
  return {
    ...style,
    dashed: lineDash.length > 0,
    color: visited ? style.color : `${style.color}99`,
    // Canvas is displayed with CSS scaling. Compensating here keeps route
    // patterns legible across the supported 0.5x-2x display-scale range.
    width: style.width / clampedScale,
    lineDash: lineDash.map((length) => length / clampedScale),
    label
  };
}

/**
 * Path variance configuration for different curve intensities
 * - extreme (5%): Chaotic, highly bent paths with dramatic curves
 * - significant (20%): Noticeable bends and curves
 * - soft (75%): Gentle S-curves (original behavior)
 */
const VARIANCE_CONFIG = {
  extreme: {
    amplitudeMultiplier: 3.5,    // Much wider curves
    frequencyMultiplier: 2.0,    // More oscillations in the path
    controlPointBonus: 2,        // Extra control points for complexity
    maxAmplitude: 120            // Cap on curve displacement
  },
  significant: {
    amplitudeMultiplier: 2.0,
    frequencyMultiplier: 1.5,
    controlPointBonus: 1,
    maxAmplitude: 80
  },
  soft: {
    amplitudeMultiplier: 1.0,
    frequencyMultiplier: 1.0,
    controlPointBonus: 0,
    maxAmplitude: 40
  }
};

/**
 * Determine path variance level from seed (deterministic)
 * @param {number} seedValue - The seed value for this path
 * @returns {'extreme'|'significant'|'soft'} Variance level
 */
function getPathVarianceLevel(seedValue) {
  // Use modulo to deterministically select variance based on seed
  const selector = seedValue % 100;

  if (selector < 5) {
    return 'extreme';     // 5% of paths: chaotic curves
  } else if (selector < 25) {
    return 'significant'; // 20% of paths: noticeable bends
  } else {
    return 'soft';        // 75% of paths: gentle S-curves
  }
}

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
  // Normalize coordinates: always generate from smaller ID to larger ID
  // This ensures identical curves regardless of which direction coordinates are passed,
  // preventing flickering when the perpendicular vector calculation depends on dx/dy sign
  const needsSwap = fromNodeId > toNodeId;
  const [nx1, ny1, nx2, ny2] = needsSwap ? [x2, y2, x1, y1] : [x1, y1, x2, y2];
  const [nFromId, nToId] = needsSwap ? [toNodeId, fromNodeId] : [fromNodeId, toNodeId];

  // Create deterministic seed from both node IDs (order-independent)
  const seedValue = nFromId * 1000000 + nToId;
  const rng = new SeededRandom(seedValue);

  // Determine variance level for this path
  const varianceLevel = getPathVarianceLevel(seedValue);
  const variance = VARIANCE_CONFIG[varianceLevel];

  // Calculate path length and number of control points (2-5 based on distance, plus variance bonus)
  const dx = nx2 - nx1;
  const dy = ny2 - ny1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const baseNumPoints = Math.max(2, Math.min(5, Math.floor(length / 80) + 2));
  const numPoints = baseNumPoints + variance.controlPointBonus;

  // Handle zero-length paths
  if (length < 1) {
    return [{ x: nx1, y: ny1 }, { x: nx2, y: ny2 }];
  }

  // Calculate tangent and perpendicular vectors
  const tangentX = dx / length;
  const tangentY = dy / length;
  const perpX = -tangentY;
  const perpY = tangentX;

  // Generate intermediate control points with seeded offsets
  const points = [{ x: nx1, y: ny1 }];

  for (let i = 1; i < numPoints - 1; i++) {
    const t = i / (numPoints - 1);

    // Base position along straight line
    const baseX = nx1 + dx * t;
    const baseY = ny1 + dy * t;

    // Seeded perpendicular offset (creates S-curves)
    // Use sin wave modulated by random to create natural curves
    // Apply frequency multiplier for more oscillations in higher variance paths
    const direction = Math.sin(t * Math.PI * 2 * variance.frequencyMultiplier) * (rng.next() - 0.5);

    // Calculate amplitude with variance multiplier and cap
    const baseAmplitude = length * 0.15 * (0.5 + rng.next() * 0.5);
    const amplitude = Math.min(baseAmplitude * variance.amplitudeMultiplier, variance.maxAmplitude);

    points.push({
      x: baseX + perpX * direction * amplitude,
      y: baseY + perpY * direction * amplitude
    });
  }

  points.push({ x: nx2, y: ny2 });
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
function catmullRomPoint(p0, p1, p2, p3, t, tension = 0.5) {
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
 * Generate SVG path data string from spline points
 * Used by DOMFogOverlay to render fog cutouts matching visible paths
 * @param {number} x1 - Start X
 * @param {number} y1 - Start Y
 * @param {number} x2 - End X
 * @param {number} y2 - End Y
 * @param {number} fromNodeId - Source node ID
 * @param {number} toNodeId - Destination node ID
 * @param {number} segmentsPerSpan - Number of line segments per span between control points
 * @returns {string} SVG path data string (M/L commands)
 */
export function generateSVGPathData(x1, y1, x2, y2, fromNodeId, toNodeId, segmentsPerSpan = 10) {
  const controlPoints = generatePathControlPoints(x1, y1, x2, y2, fromNodeId, toNodeId);
  const splinePoints = generateSplinePoints(controlPoints, segmentsPerSpan);

  if (splinePoints.length < 2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  let d = `M ${splinePoints[0].x} ${splinePoints[0].y}`;
  for (let i = 1; i < splinePoints.length; i++) {
    d += ` L ${splinePoints[i].x} ${splinePoints[i].y}`;
  }
  return d;
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
    lineDash = dashed ? [5, 5] : [],
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
    if (lineDash.length > 0) {
      ctx.setLineDash(lineDash);
    }

    ctx.beginPath();
    ctx.moveTo(splinePoints[0].x + shadowOffset, splinePoints[0].y + shadowOffset);
    for (let i = 1; i < splinePoints.length; i++) {
      ctx.lineTo(splinePoints[i].x + shadowOffset, splinePoints[i].y + shadowOffset);
    }
    ctx.stroke();
    if (lineDash.length > 0) {
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // Draw main path
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (lineDash.length > 0) {
    ctx.setLineDash(lineDash);
  }

  ctx.beginPath();
  ctx.moveTo(splinePoints[0].x, splinePoints[0].y);
  for (let i = 1; i < splinePoints.length; i++) {
    ctx.lineTo(splinePoints[i].x, splinePoints[i].y);
  }
  ctx.stroke();

  if (lineDash.length > 0) {
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/**
 * Render path with gradient fog reveal effect
 * Used for fog of war cutouts along paths
 * @param {CanvasRenderingContext2D} ctx - Canvas context (should be in destination-out mode)
 * @param {number} x1 - Start X (in target canvas coordinates)
 * @param {number} y1 - Start Y (in target canvas coordinates)
 * @param {number} x2 - End X (in target canvas coordinates)
 * @param {number} y2 - End Y (in target canvas coordinates)
 * @param {number} fromNodeId - Source node ID
 * @param {number} toNodeId - Destination node ID
 * @param {number} baseWidth - Base path width
 * @param {number} baseOpacity - Base opacity for reveal
 * @param {number} scale - Scale factor for coordinate transformation (e.g., 0.25 for 1/4 resolution fog canvas)
 */
export function renderPathReveal(ctx, x1, y1, x2, y2, fromNodeId, toNodeId, baseWidth = 44, baseOpacity = 1.0, scale = 1.0) {
  // When rendering to a scaled canvas (e.g., fog of war at 1/4 resolution),
  // we need to generate control points at full scale to match the visible path curves,
  // then scale the resulting spline points down for the target canvas.
  const fullX1 = scale !== 1.0 ? x1 / scale : x1;
  const fullY1 = scale !== 1.0 ? y1 / scale : y1;
  const fullX2 = scale !== 1.0 ? x2 / scale : x2;
  const fullY2 = scale !== 1.0 ? y2 / scale : y2;

  // Generate control points at full scale for correct curve shape
  const controlPoints = generatePathControlPoints(fullX1, fullY1, fullX2, fullY2, fromNodeId, toNodeId);

  // Generate spline points at full scale
  const fullSplinePoints = generateSplinePoints(controlPoints, 10);

  // Scale down spline points for target canvas rendering
  const splinePoints = scale !== 1.0
    ? fullSplinePoints.map(p => ({ x: p.x * scale, y: p.y * scale }))
    : fullSplinePoints;

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
