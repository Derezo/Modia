/**
 * @module WorldMapPathSystem
 * @description Manages path preview, reachability calculations, and path caching for the world map.
 *
 * Key responsibilities:
 * - Path preview state management (hover path display)
 * - LRU cache for path calculations to reduce API calls
 * - Reachable node calculation via BFS traversal
 * - Path preview rendering with color-coded affordability/blocking states
 *
 * @see WorldMapScene.js - Parent scene that owns this system
 * @see PathRenderer.js - Spline generation for organic path curves
 */

import { generatePathControlPoints, generateSplinePoints } from './PathRenderer.js';

// Cache size limit for path preview calculations (LRU eviction when exceeded)
const PATH_CACHE_MAX_SIZE = 100;

/**
 * WorldMapPathSystem - Handles path preview caching and reachability calculations
 */
export class WorldMapPathSystem {
  /**
   * @param {Object} scene - The WorldMapScene instance
   */
  constructor(scene) {
    this.scene = scene;

    // Path preview state
    this.previewPath = null; // Array of node IDs for hover path preview
    this.previewCost = 0;
    this.previewAffordable = true;
    this.previewBlockedNodes = []; // Node IDs that are blocked in the path
    this.previewPathBlocked = false; // True if path is blocked by intermediate nodes
    this.previewOriginBlocked = false; // True if current node is blocked
    this.previewCannotReach = false; // True if destination cannot be reached from origin

    // Cache for path calculations (LRU eviction)
    this.pathPreviewCache = new Map();
    this._pathPreviewRequestId = 0; // Track async requests to prevent stale updates

    // Reachability state (for node blocking system)
    this.reachableNodes = new Set(); // Set of node IDs reachable from current position
  }

  /**
   * Update path preview when hovering over a node
   * @param {Object|null} node - The hovered node or null to clear preview
   */
  async updatePathPreview(node) {
    // Track request ID to handle race conditions from rapid mouse movements
    const requestId = ++this._pathPreviewRequestId;

    const { currentNode, isTraveling, hudPanel } = this.scene;

    // Clear preview if no node hovered, traveling, or hovering current node
    if (!node || isTraveling || !currentNode || node.id === currentNode.id) {
      this.previewPath = null;
      this.previewCost = 0;
      this.previewAffordable = true;
      this.previewOriginBlocked = false;
      this.previewCannotReach = false;
      return;
    }

    // Check if node is discovered
    if (!this.scene.isNodeDiscovered(node)) {
      this.previewPath = null;
      this.previewCost = 0;
      this.previewAffordable = false;
      this.previewOriginBlocked = false;
      this.previewCannotReach = false;
      return;
    }

    // Check cache first
    const cacheKey = `${currentNode.id}-${node.id}`;
    if (this.pathPreviewCache.has(cacheKey)) {
      const cached = this.pathPreviewCache.get(cacheKey);
      this.previewPath = cached.path;
      this.previewCost = cached.cost;
      this.previewAffordable = hudPanel ? hudPanel.staminaSegment.current >= cached.cost : true;
      this.previewBlockedNodes = cached.blockedNodes || [];
      this.previewPathBlocked = cached.pathBlocked || false;
      this.previewOriginBlocked = cached.originBlocked || false;
      this.previewCannotReach = cached.cannotReachFromOrigin || false;
      return;
    }

    // Fetch path from server
    try {
      const result = await this.scene.game.api.getPathPreview(node.id);

      // Discard stale response if a newer request was made
      if (requestId !== this._pathPreviewRequestId) return;

      this.previewPath = result.path;
      this.previewCost = result.cost;
      this.previewAffordable = result.affordable;
      this.previewBlockedNodes = result.blockedNodes || [];
      this.previewPathBlocked = result.pathBlocked || false;
      this.previewOriginBlocked = result.originBlocked || false;
      this.previewCannotReach = result.cannotReachFromOrigin || false;

      // Cache the result with LRU eviction
      if (this.pathPreviewCache.size >= PATH_CACHE_MAX_SIZE) {
        // Evict oldest entry (first key in Map maintains insertion order)
        const firstKey = this.pathPreviewCache.keys().next().value;
        this.pathPreviewCache.delete(firstKey);
      }
      this.pathPreviewCache.set(cacheKey, {
        path: result.path,
        cost: result.cost,
        blockedNodes: result.blockedNodes || [],
        pathBlocked: result.pathBlocked || false,
        originBlocked: result.originBlocked || false,
        cannotReachFromOrigin: result.cannotReachFromOrigin || false
      });
    } catch (err) {
      // Log for debugging but don't show user-facing error
      console.warn('Path preview fetch failed:', err.message);

      // Discard if stale request
      if (requestId !== this._pathPreviewRequestId) return;

      this.previewPath = null;
      this.previewCost = 0;
      this.previewAffordable = false;
      this.previewBlockedNodes = [];
      this.previewPathBlocked = false;
      this.previewOriginBlocked = false;
      this.previewCannotReach = false;
    }
  }

  /**
   * Clear path cache (called after travel or world data reload)
   */
  clearPathCache() {
    this.pathPreviewCache.clear();
  }

  /**
   * Calculate which nodes are reachable from the current position.
   * Uses BFS traversal through connections, considering node blocking.
   *
   * Rules:
   * - Can reach adjacent nodes including blocked ones (to show them as potential targets)
   * - Cannot traverse THROUGH blocked nodes (they block further paths)
   * - Only considers discovered nodes
   *
   * @returns {Set<number>} Set of reachable node IDs
   */
  calculateReachableNodes() {
    this.reachableNodes = new Set();

    const { currentNode, nodes, connections } = this.scene;

    if (!currentNode || !nodes.length || !connections.length) {
      return this.reachableNodes;
    }

    // Build adjacency map from connections
    const adjacency = new Map();
    for (const conn of connections) {
      if (!adjacency.has(conn.from_node_id)) {
        adjacency.set(conn.from_node_id, []);
      }
      if (!adjacency.has(conn.to_node_id)) {
        adjacency.set(conn.to_node_id, []);
      }
      adjacency.get(conn.from_node_id).push(conn.to_node_id);
      adjacency.get(conn.to_node_id).push(conn.from_node_id);
    }

    // Create node lookup for quick access to blocked status
    const nodeMap = new Map();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    // BFS from current node
    const visited = new Set();
    const queue = [currentNode.id];
    visited.add(currentNode.id);
    this.reachableNodes.add(currentNode.id);

    while (queue.length > 0) {
      const currentId = queue.shift();
      const currentNodeData = nodeMap.get(currentId);

      // If this node is blocked (and not the starting node), we can reach it but not traverse through it
      const isBlocked = currentNodeData?.blocked && currentId !== currentNode.id;

      const neighbors = adjacency.get(currentId) || [];
      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) continue;

        const neighborNode = nodeMap.get(neighborId);
        if (!neighborNode) continue;

        // Only consider discovered nodes
        if (!this.scene.isNodeDiscovered(neighborNode)) continue;

        visited.add(neighborId);
        this.reachableNodes.add(neighborId);

        // Only continue BFS from this neighbor if the current node is not blocked
        // (we can reach neighbors of a blocked node, but we can't traverse through it)
        if (!isBlocked) {
          queue.push(neighborId);
        }
      }
    }

    return this.reachableNodes;
  }

  /**
   * Render path preview (golden glow along the path) using organic curves
   * Color coding:
   * - gold = affordable path
   * - red = not affordable (insufficient stamina)
   * - orange = path blocked by intermediate node
   * - maroon = cannot reach from origin (origin is blocked)
   * @param {CanvasRenderingContext2D} ctx - Canvas context to render on
   */
  renderPathPreview(ctx) {
    if (!this.previewPath || this.previewPath.length < 2) return;

    const { nodes, nodeSpacing, cameraX, cameraY } = this.scene;

    // Determine path color based on blocking/affordability state
    let pathColor, glowColor;
    if (this.previewCannotReach) {
      pathColor = 'rgba(128, 0, 64, 0.6)'; // Maroon for unreachable from origin
      glowColor = 'rgba(128, 0, 64, 0.2)';
    } else if (this.previewPathBlocked) {
      pathColor = 'rgba(255, 140, 0, 0.6)'; // Orange for blocked intermediate
      glowColor = 'rgba(255, 140, 0, 0.2)';
    } else if (!this.previewAffordable) {
      pathColor = 'rgba(180, 80, 80, 0.6)'; // Red for not affordable
      glowColor = 'rgba(180, 80, 80, 0.2)';
    } else {
      pathColor = 'rgba(255, 215, 0, 0.6)'; // Gold for affordable
      glowColor = 'rgba(255, 215, 0, 0.2)';
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw glow effect along the path using organic curves
    for (let i = 0; i < this.previewPath.length - 1; i++) {
      const fromNode = nodes.find(n => n.id === this.previewPath[i]);
      const toNode = nodes.find(n => n.id === this.previewPath[i + 1]);

      if (!fromNode || !toNode) continue;

      // CRITICAL: Normalize node ordering for spline generation
      // Always generate spline with smaller ID first for consistent curves
      const startNode = fromNode.id < toNode.id ? fromNode : toNode;
      const endNode = fromNode.id < toNode.id ? toNode : fromNode;

      const x1 = startNode.x_coord * nodeSpacing + cameraX;
      const y1 = startNode.y_coord * nodeSpacing + cameraY;
      const x2 = endNode.x_coord * nodeSpacing + cameraX;
      const y2 = endNode.y_coord * nodeSpacing + cameraY;

      // Skip if off screen
      const margin = 100;
      if (Math.max(x1, x2) < -margin || Math.min(x1, x2) > this.scene.game.targetWidth + margin ||
          Math.max(y1, y2) < -margin || Math.min(y1, y2) > this.scene.game.targetHeight + margin) {
        continue;
      }

      // Generate organic spline points (using normalized node IDs)
      const controlPoints = generatePathControlPoints(x1, y1, x2, y2, startNode.id, endNode.id);
      const splinePoints = generateSplinePoints(controlPoints, 10);

      if (splinePoints.length < 2) continue;

      // Draw glow (wider, semi-transparent)
      ctx.beginPath();
      ctx.moveTo(splinePoints[0].x, splinePoints[0].y);
      for (let j = 1; j < splinePoints.length; j++) {
        ctx.lineTo(splinePoints[j].x, splinePoints[j].y);
      }
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 12;
      ctx.stroke();

      // Draw main path highlight
      ctx.beginPath();
      ctx.moveTo(splinePoints[0].x, splinePoints[0].y);
      for (let j = 1; j < splinePoints.length; j++) {
        ctx.lineTo(splinePoints[j].x, splinePoints[j].y);
      }
      ctx.strokeStyle = pathColor;
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Check if there is an active path preview
   * @returns {boolean} True if path preview is active
   */
  hasPathPreview() {
    return this.previewPath && this.previewPath.length > 1;
  }

  /**
   * Get reachable nodes set
   * @returns {Set<number>} Set of reachable node IDs
   */
  getReachableNodes() {
    return this.reachableNodes;
  }

  /**
   * Check if a node is reachable
   * @param {number} nodeId - Node ID to check
   * @returns {boolean} True if node is reachable (or if reachability not calculated yet)
   */
  isNodeReachable(nodeId) {
    // If no reachable nodes calculated yet, consider all nodes reachable
    if (this.reachableNodes.size === 0) return true;
    return this.reachableNodes.has(nodeId);
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.pathPreviewCache.clear();
    this.reachableNodes.clear();
    this.previewPath = null;
  }
}
