/**
 * PathCarver - Corridor and path generation using various carving techniques
 *
 * Provides multiple algorithms for carving paths through terrain:
 * - Drunkard's Walk: Random walk with directional bias toward target
 * - Bezier: Smooth curved paths using quadratic bezier curves
 * - Direct: Straight corridors with optional width variation
 *
 * Useful for:
 * - Connecting spawn areas to objectives
 * - Creating natural-looking pathways through forests/caves
 * - Carving corridors in dungeon-style maps
 * - Ensuring traversability between map regions
 *
 * CRITICAL: All methods must use the random function deterministically
 * to maintain server/client sync.
 */

/**
 * Path style presets for common use cases
 */
export const PATH_STYLE_PRESETS = {
  drunkard: {
    pathWidth: 2,
    wanderStrength: 0.3,
    stepVariation: 0.1
  },
  bezier: {
    pathWidth: 2,
    controlPointOffset: 0.3,
    segmentCount: 20
  },
  direct: {
    pathWidth: 2,
    widthVariation: 0.0
  }
};

/**
 * PathCarver Algorithm for corridor/path generation
 */
export class PathCarverAlgorithm {
  /**
   * @param {Object} options - Algorithm options
   * @param {number} options.pathWidth - Width of carved paths in tiles (default 2)
   * @param {number} options.pathCount - Number of paths to carve (default 2)
   * @param {number} options.wanderStrength - Path deviation 0-1 (default 0.3)
   * @param {string} options.floorTerrain - Terrain type for paths (default 'stone')
   * @param {string} options.pathStyle - Algorithm: 'drunkard', 'bezier', 'direct'
   */
  constructor(options = {}) {
    this.pathWidth = options.pathWidth ?? 2;
    this.pathCount = options.pathCount ?? 2;
    this.wanderStrength = Math.max(0, Math.min(1, options.wanderStrength ?? 0.3));
    this.floorTerrain = options.floorTerrain || 'stone';
    this.pathStyle = options.pathStyle || 'drunkard';
  }

  /**
   * Apply path carving to terrain
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {function} random - Seeded random function
   * @param {Object} options - Runtime options
   * @param {number} options.intensity - Path coverage intensity (0-1)
   * @param {Object} options.bounds - Optional bounded region {x, y, width, height}
   * @param {Array<{start: {x,y}, end: {x,y}}>} options.endpoints - Optional explicit path endpoints
   */
  apply(terrain, random, options = {}) {
    const intensity = Math.max(0, Math.min(1, options.intensity ?? 0.5));
    const bounds = options.bounds || {
      x: 0,
      y: 0,
      width: terrain[0].length,
      height: terrain.length
    };

    // Calculate number of paths based on intensity
    const effectivePathCount = Math.max(1, Math.round(this.pathCount * (0.5 + intensity)));

    // Generate or use provided endpoints
    const endpoints = options.endpoints || this._generateEndpoints(
      bounds.width,
      bounds.height,
      effectivePathCount,
      random
    );

    // Carve each path
    for (const endpoint of endpoints) {
      const resolveCoordinate = (point, axis, extent) => {
        const absolute = point?.[axis];
        if (Number.isFinite(absolute)) return absolute;
        const ratio = point?.[`${axis}Ratio`];
        if (Number.isFinite(ratio)) {
          return Math.round(Math.max(0, Math.min(1, ratio)) * (extent - 1));
        }
        return 0;
      };

      // Adjust endpoints for bounds offset
      const start = {
        x: bounds.x + resolveCoordinate(endpoint.start, 'x', bounds.width),
        y: bounds.y + resolveCoordinate(endpoint.start, 'y', bounds.height)
      };
      const end = {
        x: bounds.x + resolveCoordinate(endpoint.end, 'x', bounds.width),
        y: bounds.y + resolveCoordinate(endpoint.end, 'y', bounds.height)
      };

      // Select carving algorithm based on style
      switch (this.pathStyle) {
        case 'bezier':
          this._carveBezierPath(terrain, start, end, random);
          break;
        case 'direct':
          this._carveDirectPath(terrain, start, end, random);
          break;
        case 'drunkard':
        default:
          this._carveDrunkardPath(terrain, start, end, random);
          break;
      }
    }
  }

  /**
   * Generate default path endpoints (left-to-right connections)
   * @param {number} width - Map width
   * @param {number} height - Map height
   * @param {number} count - Number of path endpoints to generate
   * @param {function} random - Seeded random function
   * @returns {Array<{start: {x,y}, end: {x,y}}>} Generated endpoints
   */
  _generateEndpoints(width, height, count, random) {
    const endpoints = [];
    const margin = Math.max(2, this.pathWidth);
    const usableHeight = height - (margin * 2);

    // Distribute paths vertically with some variation
    for (let i = 0; i < count; i++) {
      // Base Y position evenly distributed
      const baseY = margin + Math.floor((usableHeight / (count + 1)) * (i + 1));

      // Add some random variation
      const yVariation = Math.floor(random() * (usableHeight / (count + 2)));
      const startY = Math.max(margin, Math.min(height - margin - 1, baseY + yVariation - usableHeight / (count + 4)));
      const endY = Math.max(margin, Math.min(height - margin - 1, baseY - yVariation + usableHeight / (count + 4)));

      endpoints.push({
        start: { x: margin, y: Math.floor(startY) },
        end: { x: width - margin - 1, y: Math.floor(endY) }
      });
    }

    return endpoints;
  }

  /**
   * Carve path using drunkard's walk algorithm
   * Random walk with bias toward target position
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {{x: number, y: number}} start - Starting position
   * @param {{x: number, y: number}} end - Target position
   * @param {function} random - Seeded random function
   */
  _carveDrunkardPath(terrain, start, end, random) {
    const width = terrain[0].length;
    const height = terrain.length;

    let x = start.x;
    let y = start.y;

    // Maximum steps to prevent infinite loops
    const maxSteps = (width + height) * 3;
    let steps = 0;

    while ((x !== end.x || y !== end.y) && steps < maxSteps) {
      // Carve at current position
      this._carveCircle(terrain, x, y, Math.floor(this.pathWidth / 2));

      // Calculate direction toward target
      const dx = end.x - x;
      const dy = end.y - y;

      // Determine movement based on wander strength
      let moveX = 0;
      let moveY = 0;

      if (random() < this.wanderStrength) {
        // Random movement (drunk walk)
        const randomDir = Math.floor(random() * 4);
        switch (randomDir) {
          case 0: moveX = 1; break;
          case 1: moveX = -1; break;
          case 2: moveY = 1; break;
          case 3: moveY = -1; break;
        }
      } else {
        // Biased movement toward target
        if (Math.abs(dx) > Math.abs(dy)) {
          // Prefer horizontal movement
          moveX = dx > 0 ? 1 : -1;
          // Occasionally move vertically for variety
          if (random() < 0.3 && dy !== 0) {
            moveY = dy > 0 ? 1 : -1;
            moveX = 0;
          }
        } else if (dy !== 0) {
          // Prefer vertical movement
          moveY = dy > 0 ? 1 : -1;
          // Occasionally move horizontally for variety
          if (random() < 0.3 && dx !== 0) {
            moveX = dx > 0 ? 1 : -1;
            moveY = 0;
          }
        } else if (dx !== 0) {
          moveX = dx > 0 ? 1 : -1;
        }
      }

      // Apply movement with bounds checking
      const newX = x + moveX;
      const newY = y + moveY;

      if (newX >= 0 && newX < width && newY >= 0 && newY < height) {
        x = newX;
        y = newY;
      } else {
        // If blocked, force movement toward target
        if (dx !== 0 && x + (dx > 0 ? 1 : -1) >= 0 && x + (dx > 0 ? 1 : -1) < width) {
          x += dx > 0 ? 1 : -1;
        } else if (dy !== 0 && y + (dy > 0 ? 1 : -1) >= 0 && y + (dy > 0 ? 1 : -1) < height) {
          y += dy > 0 ? 1 : -1;
        }
      }

      steps++;
    }

    // Ensure we carve the end point
    this._carveCircle(terrain, end.x, end.y, Math.floor(this.pathWidth / 2));
  }

  /**
   * Carve path using quadratic bezier curve
   * Creates smooth, flowing paths with control point
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {{x: number, y: number}} start - Starting position
   * @param {{x: number, y: number}} end - Target position
   * @param {function} random - Seeded random function
   */
  _carveBezierPath(terrain, start, end, random) {
    const width = terrain[0].length;
    const height = terrain.length;

    // Calculate midpoint
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;

    // Calculate perpendicular offset for control point
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const pathLength = Math.sqrt(dx * dx + dy * dy);

    // Perpendicular direction (normalized)
    const perpX = -dy / pathLength;
    const perpY = dx / pathLength;

    // Control point offset based on wander strength and random
    const offsetMagnitude = pathLength * this.wanderStrength * (random() * 2 - 1);
    const controlPoint = {
      x: midX + perpX * offsetMagnitude,
      y: midY + perpY * offsetMagnitude
    };

    // Number of segments for bezier curve
    const segments = Math.max(10, Math.floor(pathLength / 2));

    // Draw bezier curve by sampling points
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;

      // Quadratic bezier formula: B(t) = (1-t)^2*P0 + 2*(1-t)*t*P1 + t^2*P2
      const oneMinusT = 1 - t;
      const x = Math.round(
        oneMinusT * oneMinusT * start.x +
        2 * oneMinusT * t * controlPoint.x +
        t * t * end.x
      );
      const y = Math.round(
        oneMinusT * oneMinusT * start.y +
        2 * oneMinusT * t * controlPoint.y +
        t * t * end.y
      );

      // Bounds check and carve
      if (x >= 0 && x < width && y >= 0 && y < height) {
        this._carveCircle(terrain, x, y, Math.floor(this.pathWidth / 2));
      }
    }

    // Connect discrete points with linear interpolation for continuity
    let prevX = start.x;
    let prevY = start.y;

    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const oneMinusT = 1 - t;
      const currX = Math.round(
        oneMinusT * oneMinusT * start.x +
        2 * oneMinusT * t * controlPoint.x +
        t * t * end.x
      );
      const currY = Math.round(
        oneMinusT * oneMinusT * start.y +
        2 * oneMinusT * t * controlPoint.y +
        t * t * end.y
      );

      // Fill gaps between consecutive bezier points
      this._carveLineBetween(terrain, prevX, prevY, currX, currY);

      prevX = currX;
      prevY = currY;
    }
  }

  /**
   * Carve a straight corridor between two points
   * Uses Bresenham-style line with optional width variation
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {{x: number, y: number}} start - Starting position
   * @param {{x: number, y: number}} end - Target position
   * @param {function} random - Seeded random function
   */
  _carveDirectPath(terrain, start, end, random) {
    // Use L-shaped path (horizontal then vertical) for cleaner corridors
    const useHorizontalFirst = random() < 0.5;
    const midPoint = useHorizontalFirst
      ? { x: end.x, y: start.y }
      : { x: start.x, y: end.y };

    // Carve first segment
    this._carveLineBetween(terrain, start.x, start.y, midPoint.x, midPoint.y);

    // Carve second segment
    this._carveLineBetween(terrain, midPoint.x, midPoint.y, end.x, end.y);

    // Carve corners with slightly larger radius for smooth turns
    this._carveCircle(terrain, midPoint.x, midPoint.y, Math.floor(this.pathWidth / 2) + 1);
  }

  /**
   * Carve a line between two points using Bresenham algorithm
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {number} x0 - Start X
   * @param {number} y0 - Start Y
   * @param {number} x1 - End X
   * @param {number} y1 - End Y
   */
  _carveLineBetween(terrain, x0, y0, x1, y1) {
    const width = terrain[0].length;
    const height = terrain.length;

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let x = x0;
    let y = y0;
    let steps = 0;
    const maxSteps = (width + height) * 2;

    while (steps++ < maxSteps) {
      // Carve at current position
      if (x >= 0 && x < width && y >= 0 && y < height) {
        this._carveCircle(terrain, x, y, Math.floor(this.pathWidth / 2));
      }

      // Check if reached end
      if (x === x1 && y === y1) break;

      const e2 = 2 * err;

      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }

      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /**
   * Carve a circular area at the given position
   * Used to create path width
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {number} cx - Center X
   * @param {number} cy - Center Y
   * @param {number} radius - Carving radius
   */
  _carveCircle(terrain, cx, cy, radius) {
    const width = terrain[0].length;
    const height = terrain.length;

    // Ensure minimum radius of 0 (single tile)
    const r = Math.max(0, radius);

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // Check if within circle (using squared distance to avoid sqrt)
        if (dx * dx + dy * dy <= r * r) {
          const x = cx + dx;
          const y = cy + dy;

          // Bounds check
          if (x >= 0 && x < width && y >= 0 && y < height) {
            terrain[y][x] = this.floorTerrain;
          }
        }
      }
    }
  }

  /**
   * Generate a standalone path map (for external use)
   * @param {number} width - Map width
   * @param {number} height - Map height
   * @param {function} random - Seeded random function
   * @param {string} fillTerrain - Background terrain type
   * @returns {string[][]} Terrain grid with carved paths
   */
  generatePathMap(width, height, random, fillTerrain = 'grass') {
    // Create terrain filled with background
    const terrain = [];
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        row.push(fillTerrain);
      }
      terrain.push(row);
    }

    // Apply path carving
    this.apply(terrain, random, { intensity: 0.7 });

    return terrain;
  }

  /**
   * Check if a path exists between two points in terrain
   * Uses flood fill to verify connectivity
   * @param {string[][]} terrain - Terrain grid
   * @param {{x: number, y: number}} start - Start position
   * @param {{x: number, y: number}} end - End position
   * @param {Set<string>} passableTerrains - Set of terrain types that can be traversed
   * @returns {boolean} True if path exists
   */
  verifyConnectivity(terrain, start, end, passableTerrains) {
    const width = terrain[0].length;
    const height = terrain.length;
    const visited = new Set();
    const queue = [start];

    visited.add(`${start.x},${start.y}`);

    while (queue.length > 0) {
      const current = queue.shift();

      // Check if reached end
      if (current.x === end.x && current.y === end.y) {
        return true;
      }

      // Check 4-directional neighbors
      const neighbors = [
        { x: current.x - 1, y: current.y },
        { x: current.x + 1, y: current.y },
        { x: current.x, y: current.y - 1 },
        { x: current.x, y: current.y + 1 }
      ];

      for (const n of neighbors) {
        const key = `${n.x},${n.y}`;

        // Bounds check
        if (n.x < 0 || n.y < 0 || n.x >= width || n.y >= height) continue;
        if (visited.has(key)) continue;

        // Check if passable
        if (passableTerrains.has(terrain[n.y][n.x])) {
          visited.add(key);
          queue.push(n);
        }
      }
    }

    return false;
  }
}

export default PathCarverAlgorithm;
