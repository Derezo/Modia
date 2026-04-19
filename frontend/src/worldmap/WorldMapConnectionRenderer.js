import { generatePathControlPoints, generateSplinePoints } from './PathRenderer.js';

/**
 * Renders connections between nodes on the world map
 */
export class WorldMapConnectionRenderer {
  /**
   * @param {Object} scene - WorldMapScene instance
   */
  constructor(scene) {
    this.scene = scene;
  }

  /**
   * Render all visible connections between discovered nodes
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  renderConnections(ctx) {
    const {
      connections,
      nodes,
      nodeSpacing,
      cameraX,
      cameraY,
      pathSystem,
      effects,
      game
    } = this.scene;

    for (const conn of connections) {
      const fromNode = nodes.find(n => n.id === conn.from_node_id);
      const toNode = nodes.find(n => n.id === conn.to_node_id);

      if (fromNode && toNode) {
        // Skip connections where either endpoint is not reachable
        if (!pathSystem.isNodeReachable(fromNode.id) &&
            !pathSystem.isNodeReachable(toNode.id)) {
          continue;
        }

        const x1 = fromNode.x_coord * nodeSpacing + cameraX;
        const y1 = fromNode.y_coord * nodeSpacing + cameraY;
        const x2 = toNode.x_coord * nodeSpacing + cameraX;
        const y2 = toNode.y_coord * nodeSpacing + cameraY;

        // Skip if completely off screen
        const margin = 50;
        const minX = Math.min(x1, x2) - margin;
        const maxX = Math.max(x1, x2) + margin;
        const minY = Math.min(y1, y2) - margin;
        const maxY = Math.max(y1, y2) + margin;
        if (maxX < 0 || minX > game.targetWidth || maxY < 0 || minY > game.targetHeight) {
          continue;
        }

        // Calculate control point for bezier curve (legacy fallback)
        const control = this.getPathControlPoint(x1, y1, x2, y2, conn.from_node_id, conn.to_node_id);

        // Use effects system for path rendering (organic or textured)
        if (effects) {
          // Pass node IDs for organic path generation
          effects.renderTexturedPath(ctx, x1, y1, x2, y2, conn.path_type, control, conn.from_node_id, conn.to_node_id);
        } else {
          // Fallback to simple bezier path (with proper state isolation)
          ctx.save();
          const style = this.getPathStyle(conn.path_type);

          // Draw path shadow for depth
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(control.x, control.y, x2, y2);
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
          ctx.lineWidth = style.width + 2;
          ctx.stroke();

          // Draw main path
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(control.x, control.y, x2, y2);
          ctx.strokeStyle = style.color;
          ctx.lineWidth = style.width;
          if (style.dashed) {
            ctx.setLineDash([5, 5]);
          }
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  /**
   * Render locked path indicators when player is on a blocked node
   * Shows lock icons on paths leading to undiscovered destinations
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  renderLockedPaths(ctx) {
    const {
      currentNode,
      connections,
      nodes,
      nodeSpacing,
      cameraX,
      cameraY,
      game
    } = this.scene;

    // Only render when player is on a blocked node
    if (!currentNode?.blocked) return;

    for (const conn of connections) {
      const fromNode = nodes.find(n => n.id === conn.from_node_id);
      const toNode = nodes.find(n => n.id === conn.to_node_id);

      if (!fromNode || !toNode) continue;

      // Check if this connection involves the current node
      const currentNodeId = currentNode.id;
      const isCurrentNodeInConnection =
        conn.from_node_id === currentNodeId || conn.to_node_id === currentNodeId;

      if (!isCurrentNodeInConnection) continue;

      // Determine which node is the destination (the one that's not current)
      const destinationNode = conn.from_node_id === currentNodeId ? toNode : fromNode;

      // Show lock if destination is discovered but not visited
      // (discovered via adjacency, not by traveling there)
      const isDestinationUndiscovered =
        this.scene.isNodeDiscovered(destinationNode) && !destinationNode.visited;

      if (isDestinationUndiscovered) {
        // Use normalized node ordering for consistent spline generation (smaller ID first)
        const startNode = fromNode.id < toNode.id ? fromNode : toNode;
        const endNode = fromNode.id < toNode.id ? toNode : fromNode;

        const x1 = startNode.x_coord * nodeSpacing + cameraX;
        const y1 = startNode.y_coord * nodeSpacing + cameraY;
        const x2 = endNode.x_coord * nodeSpacing + cameraX;
        const y2 = endNode.y_coord * nodeSpacing + cameraY;

        // Skip if off screen (use same 50px margin as regular connections for consistency)
        const margin = 50;
        if (Math.max(x1, x2) < -margin || Math.min(x1, x2) > game.targetWidth + margin ||
            Math.max(y1, y2) < -margin || Math.min(y1, y2) > game.targetHeight + margin) {
          continue;
        }

        // Generate organic spline points matching the actual path curves
        const controlPoints = generatePathControlPoints(x1, y1, x2, y2, startNode.id, endNode.id);
        const splinePoints = generateSplinePoints(controlPoints, 10);

        if (splinePoints.length < 2) continue;

        // Draw locked path overlay following the organic curve
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(splinePoints[0].x, splinePoints[0].y);
        for (let j = 1; j < splinePoints.length; j++) {
          ctx.lineTo(splinePoints[j].x, splinePoints[j].y);
        }
        ctx.strokeStyle = 'rgba(180, 80, 60, 0.5)';
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.restore();

        // Calculate midpoint along the spline for lock icon
        const midIndex = Math.floor(splinePoints.length / 2);
        const midX = splinePoints[midIndex].x;
        const midY = splinePoints[midIndex].y;

        // Draw lock icon background and icon (isolated canvas state)
        ctx.save();
        ctx.beginPath();
        ctx.arc(midX, midY, 12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(60, 40, 30, 0.85)';
        ctx.fill();
        ctx.strokeStyle = '#a85040';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw lock icon
        ctx.fillStyle = '#6b2d3d';  // Burgundy accent for blocked paths
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('\u{1F512}', midX, midY);
        ctx.restore();
      }
    }
  }

  /**
   * Render watchtower-revealed connections with dashed lines at reduced opacity
   * These are connections visible from the watchtower but not yet discovered
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  renderWatchtowerConnections(ctx) {
    const { watchtowerView, nodes, nodeSpacing, cameraX, cameraY, game } = this.scene;

    if (!watchtowerView) return;

    const { revealedNodes, revealedConnections } = watchtowerView;

    // Create lookup for revealed nodes (not in main nodes list)
    const discoveredNodeIds = new Set(nodes.map(n => n.id));
    const revealedNodeMap = new Map(revealedNodes.map(n => [n.id, n]));

    ctx.save();
    ctx.globalAlpha = 0.5;

    for (const conn of revealedConnections) {
      // Skip if both nodes are already discovered (connection already rendered)
      if (discoveredNodeIds.has(conn.from_node_id) && discoveredNodeIds.has(conn.to_node_id)) {
        continue;
      }

      // Get node data from either revealed nodes or existing nodes
      const fromNode = revealedNodeMap.get(conn.from_node_id) ||
                       nodes.find(n => n.id === conn.from_node_id);
      const toNode = revealedNodeMap.get(conn.to_node_id) ||
                     nodes.find(n => n.id === conn.to_node_id);

      if (!fromNode || !toNode) continue;

      const x1 = fromNode.x_coord * nodeSpacing + cameraX;
      const y1 = fromNode.y_coord * nodeSpacing + cameraY;
      const x2 = toNode.x_coord * nodeSpacing + cameraX;
      const y2 = toNode.y_coord * nodeSpacing + cameraY;

      // Skip if off screen
      const margin = 50;
      if (Math.max(x1, x2) < -margin || Math.min(x1, x2) > game.targetWidth + margin ||
          Math.max(y1, y2) < -margin || Math.min(y1, y2) > game.targetHeight + margin) {
        continue;
      }

      // Use Catmull-Rom splines to match visible path rendering
      // generatePathControlPoints already handles coordinate normalization
      const controlPoints = generatePathControlPoints(x1, y1, x2, y2, fromNode.id, toNode.id);
      const splinePoints = generateSplinePoints(controlPoints, 10);

      ctx.beginPath();
      if (splinePoints.length >= 2) {
        ctx.moveTo(splinePoints[0].x, splinePoints[0].y);
        for (let i = 1; i < splinePoints.length; i++) {
          ctx.lineTo(splinePoints[i].x, splinePoints[i].y);
        }
      } else {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.strokeStyle = 'rgba(180, 160, 100, 0.6)'; // Golden-brown for watchtower reveal
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  /**
   * Calculate bezier control point for curved path between two nodes
   * @param {number} x1 - Start X
   * @param {number} y1 - Start Y
   * @param {number} x2 - End X
   * @param {number} y2 - End Y
   * @param {number} fromNodeId - Start node ID for consistent direction
   * @param {number} toNodeId - End node ID for consistent direction
   * @returns {{x: number, y: number}} Control point
   */
  getPathControlPoint(x1, y1, x2, y2, fromNodeId, toNodeId) {
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length < 1) return { x: midX, y: midY }; // Avoid division by zero

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

  /**
   * Get path styling based on path type
   * @param {string} pathType - Type of path (road, trail, bridge, tunnel)
   * @returns {{color: string, width: number, dashed?: boolean}} Style config
   */
  getPathStyle(pathType) {
    const styles = {
      road: { color: '#5a5a7a', width: 3 },
      trail: { color: '#3a5a3a', width: 2 },
      bridge: { color: '#8b7355', width: 4 },
      tunnel: { color: '#2a2a3a', width: 3, dashed: true }
    };
    return styles[pathType] || styles.road;
  }
}
