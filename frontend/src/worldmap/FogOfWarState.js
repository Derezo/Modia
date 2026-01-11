/**
 * FogOfWarState - Enhanced fog state tracking with polygon detection
 * Manages discovery state and calculates progressive reveal radii
 */

/**
 * Enhanced fog state tracking with neighbor-based reveal radius
 */
export class FogOfWarState {
  constructor() {
    this.visitedNodes = new Set();
    this.discoveredNodes = new Set();
    this.neighborCounts = new Map();  // nodeId -> discovered neighbor count
    this.revealRadii = new Map();     // nodeId -> calculated reveal radius
    this.polygons = [];               // Detected closed polygons
    this.needsRecalc = true;

    // Connection graph for polygon detection
    this.adjacencyMap = new Map();    // nodeId -> Set of connected nodeIds
  }

  /**
   * Update fog state from node and connection data
   * @param {Array} nodes - Array of node objects with visited/discovery_method properties
   * @param {Array} connections - Array of connection objects with from_node_id/to_node_id
   */
  updateFromNodes(nodes, connections) {
    this.discoveredNodes.clear();
    this.visitedNodes.clear();
    this.neighborCounts.clear();
    this.adjacencyMap.clear();

    // Build discovered/visited sets
    for (const node of nodes) {
      this.discoveredNodes.add(node.id);
      if (node.visited) {
        this.visitedNodes.add(node.id);
      }
    }

    // Build adjacency map from connections
    for (const conn of connections) {
      const fromId = conn.from_node_id;
      const toId = conn.to_node_id;

      if (!this.adjacencyMap.has(fromId)) {
        this.adjacencyMap.set(fromId, new Set());
      }
      if (!this.adjacencyMap.has(toId)) {
        this.adjacencyMap.set(toId, new Set());
      }

      this.adjacencyMap.get(fromId).add(toId);
      this.adjacencyMap.get(toId).add(fromId);
    }

    // Count discovered neighbors for each node
    for (const nodeId of this.discoveredNodes) {
      const neighbors = this.adjacencyMap.get(nodeId) || new Set();
      let discoveredCount = 0;

      for (const neighborId of neighbors) {
        if (this.discoveredNodes.has(neighborId)) {
          discoveredCount++;
        }
      }

      this.neighborCounts.set(nodeId, discoveredCount);
    }

    // Calculate reveal radii based on neighbor counts
    this.calculateRevealRadii();

    // Detect polygons for filled areas
    this.polygons = this.findPolygons();

    this.needsRecalc = false;
  }

  /**
   * Calculate progressive reveal radii based on discovered neighbors
   * More discovered neighbors = larger reveal radius
   */
  calculateRevealRadii() {
    const BASE_RADIUS = 80;  // Base reveal radius for visited nodes
    const UNVISITED_RADIUS = 40;  // Smaller radius for discovered but unvisited

    for (const nodeId of this.discoveredNodes) {
      const isVisited = this.visitedNodes.has(nodeId);
      const neighborCount = this.neighborCounts.get(nodeId) || 0;

      const baseRadius = isVisited ? BASE_RADIUS : UNVISITED_RADIUS;

      // Progressive bonus based on discovered neighbors:
      // 1 neighbor: +10% radius
      // 2 neighbors: +25% radius
      // 3+ neighbors: +50% radius
      let bonus = 1.0;
      if (neighborCount >= 3) {
        bonus = 1.5;
      } else if (neighborCount === 2) {
        bonus = 1.25;
      } else if (neighborCount === 1) {
        bonus = 1.1;
      }

      this.revealRadii.set(nodeId, baseRadius * bonus);
    }
  }

  /**
   * Get reveal radius for a node
   * @param {number} nodeId - Node ID
   * @returns {number} Reveal radius in pixels
   */
  getRevealRadius(nodeId) {
    return this.revealRadii.get(nodeId) || 40;
  }

  /**
   * Check if a node is visited
   * @param {number} nodeId - Node ID
   * @returns {boolean}
   */
  isVisited(nodeId) {
    return this.visitedNodes.has(nodeId);
  }

  /**
   * Check if a node is discovered (visible on map)
   * @param {number} nodeId - Node ID
   * @returns {boolean}
   */
  isDiscovered(nodeId) {
    return this.discoveredNodes.has(nodeId);
  }

  /**
   * Find minimal cycles (polygons) in the visited node graph
   * Only includes polygons where ALL vertices are visited
   * @returns {Array<Array<number>>} Array of node ID arrays forming polygons
   */
  findPolygons() {
    const detector = new PolygonDetector();
    return detector.findMinimalCycles(
      this.visitedNodes,
      this.adjacencyMap,
      5  // Max polygon size (triangles, quads, pentagons)
    );
  }

  /**
   * Get all detected polygons
   * @returns {Array<Array<number>>} Array of node ID arrays
   */
  getPolygons() {
    return this.polygons;
  }
}

/**
 * PolygonDetector - Finds minimal cycles in the node graph
 * Used to identify enclosed areas for fog reveal
 */
export class PolygonDetector {
  /**
   * Find minimal cycles (triangles, quads, etc.) in the visited node graph
   * @param {Set<number>} visitedNodes - Set of visited node IDs
   * @param {Map<number, Set<number>>} adjacencyMap - Node adjacency graph
   * @param {number} maxSize - Maximum polygon size to detect
   * @returns {Array<Array<number>>} Array of node ID arrays forming polygons
   */
  findMinimalCycles(visitedNodes, adjacencyMap, maxSize = 5) {
    const polygons = [];
    const visitedArray = Array.from(visitedNodes);
    const found = new Set();  // Track found polygons to avoid duplicates

    // For each visited node, try to find cycles starting from it
    for (const startNode of visitedArray) {
      const cycles = this.findCyclesFromNode(
        startNode,
        visitedNodes,
        adjacencyMap,
        maxSize
      );

      for (const cycle of cycles) {
        // Normalize cycle (start with smallest ID, consistent direction)
        const normalized = this.normalizeCycle(cycle);
        const key = normalized.join(',');

        if (!found.has(key)) {
          found.add(key);
          polygons.push(normalized);
        }
      }
    }

    return polygons;
  }

  /**
   * Find cycles starting from a specific node using BFS
   * @param {number} startNode - Starting node ID
   * @param {Set<number>} visitedNodes - Set of visited node IDs
   * @param {Map<number, Set<number>>} adjacencyMap - Node adjacency graph
   * @param {number} maxSize - Maximum cycle size
   * @returns {Array<Array<number>>} Found cycles
   */
  findCyclesFromNode(startNode, visitedNodes, adjacencyMap, maxSize) {
    const cycles = [];

    // BFS with path tracking
    // Each queue entry: [currentNode, path, visited set for this path]
    const queue = [[startNode, [startNode], new Set([startNode])]];

    while (queue.length > 0) {
      const [current, path, pathVisited] = queue.shift();

      // Check if path is too long
      if (path.length > maxSize) {
        continue;
      }

      // Get neighbors
      const neighbors = adjacencyMap.get(current);
      if (!neighbors) continue;

      for (const neighbor of neighbors) {
        // Only consider visited nodes
        if (!visitedNodes.has(neighbor)) {
          continue;
        }

        // Check if we've found a cycle back to start
        if (neighbor === startNode && path.length >= 3) {
          cycles.push([...path]);
          continue;
        }

        // Skip if already in this path (except for returning to start)
        if (pathVisited.has(neighbor)) {
          continue;
        }

        // Only explore nodes greater than start to avoid finding same cycle multiple times
        if (neighbor < startNode) {
          continue;
        }

        // Continue BFS
        const newPath = [...path, neighbor];
        const newVisited = new Set(pathVisited);
        newVisited.add(neighbor);
        queue.push([neighbor, newPath, newVisited]);
      }
    }

    return cycles;
  }

  /**
   * Normalize a cycle to a canonical form
   * Start with smallest node ID, then choose direction giving smallest second element
   * @param {Array<number>} cycle - Array of node IDs forming a cycle
   * @returns {Array<number>} Normalized cycle
   */
  normalizeCycle(cycle) {
    if (cycle.length === 0) return cycle;

    // Find index of minimum element
    let minIdx = 0;
    for (let i = 1; i < cycle.length; i++) {
      if (cycle[i] < cycle[minIdx]) {
        minIdx = i;
      }
    }

    // Rotate to start with minimum
    const rotated = [
      ...cycle.slice(minIdx),
      ...cycle.slice(0, minIdx)
    ];

    // Check if we should reverse (compare second element with last)
    if (rotated.length >= 2) {
      const second = rotated[1];
      const last = rotated[rotated.length - 1];

      if (last < second) {
        // Reverse (keeping first element in place)
        return [rotated[0], ...rotated.slice(1).reverse()];
      }
    }

    return rotated;
  }

  /**
   * Check if a polygon is convex
   * @param {Array<{x: number, y: number}>} points - Polygon vertices
   * @returns {boolean} True if convex
   */
  isConvex(points) {
    if (points.length < 3) return false;

    let sign = 0;

    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      const p3 = points[(i + 2) % points.length];

      const cross = (p2.x - p1.x) * (p3.y - p2.y) - (p2.y - p1.y) * (p3.x - p2.x);

      if (cross !== 0) {
        const newSign = cross > 0 ? 1 : -1;
        if (sign === 0) {
          sign = newSign;
        } else if (sign !== newSign) {
          return false;
        }
      }
    }

    return true;
  }
}

/**
 * Render filled polygon for fog reveal
 * @param {CanvasRenderingContext2D} ctx - Canvas context (should be in destination-out mode)
 * @param {Array<{x: number, y: number}>} vertices - Polygon vertices in screen coordinates
 * @param {number} opacity - Fill opacity
 */
export function renderPolygonReveal(ctx, vertices, opacity = 0.8) {
  if (vertices.length < 3) return;

  ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
  ctx.beginPath();
  ctx.moveTo(vertices[0].x, vertices[0].y);

  for (let i = 1; i < vertices.length; i++) {
    ctx.lineTo(vertices[i].x, vertices[i].y);
  }

  ctx.closePath();
  ctx.fill();
}

/**
 * Calculate centroid of a polygon
 * @param {Array<{x: number, y: number}>} vertices - Polygon vertices
 * @returns {{x: number, y: number}} Centroid point
 */
export function calculatePolygonCentroid(vertices) {
  if (vertices.length === 0) return { x: 0, y: 0 };

  let sumX = 0;
  let sumY = 0;

  for (const v of vertices) {
    sumX += v.x;
    sumY += v.y;
  }

  return {
    x: sumX / vertices.length,
    y: sumY / vertices.length
  };
}

/**
 * Get expanded polygon vertices for softer fog edges
 * @param {Array<{x: number, y: number}>} vertices - Original polygon vertices
 * @param {number} expansion - Expansion distance in pixels
 * @returns {Array<{x: number, y: number}>} Expanded vertices
 */
export function expandPolygon(vertices, expansion) {
  if (vertices.length < 3) return vertices;

  const centroid = calculatePolygonCentroid(vertices);
  const expanded = [];

  for (const v of vertices) {
    const dx = v.x - centroid.x;
    const dy = v.y - centroid.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0) {
      const factor = (dist + expansion) / dist;
      expanded.push({
        x: centroid.x + dx * factor,
        y: centroid.y + dy * factor
      });
    } else {
      expanded.push({ ...v });
    }
  }

  return expanded;
}
