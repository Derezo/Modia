/**
 * WorldMapMinimap - Parchment-style minimap for world navigation
 * Renders fog of war, node icons, paths, and viewport indicator
 */
export class WorldMapMinimap {
  constructor(assetLoader) {
    this.assetLoader = assetLoader;

    // Dimensions and positioning
    this.size = 150;           // Square minimap size
    this.padding = 8;          // Internal padding
    this.margin = 10;          // Margin from canvas edge
    this.frameWidth = 4;       // Border thickness

    // Offscreen canvases for caching
    this.frameCanvas = null;   // Static parchment frame
    this.frameCtx = null;
    this.contentCanvas = null; // Main minimap content
    this.contentCtx = null;

    // World bounds (calculated from nodes)
    this.worldBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    this.worldScale = 1;       // Scale factor: world coords to minimap pixels

    // Animation state
    this.pulsePhase = 0;

    // Node symbols configuration
    this.nodeSymbols = {
      castle:   { shape: 'square',   color: '#c9a959', size: 6 },
      palace:   { shape: 'diamond',  color: '#ffd700', size: 7 },
      city:     { shape: 'circle',   color: '#4a90d9', size: 5 },
      village:  { shape: 'circle',   color: '#4a7c4a', size: 3 },
      forest:   { shape: 'triangle', color: '#2d5a2d', size: 3 },
      mountain: { shape: 'triangle', color: '#7a7a9a', size: 4 },
      cave:     { shape: 'circle',   color: '#5a5a7a', size: 3 },
      bridge:   { shape: 'rect',     color: '#8b7355', size: 3 },
      guild:    { shape: 'star',     color: '#9a6acd', size: 4 }
    };
  }

  /**
   * Initialize the minimap
   */
  async init() {
    this.generateFrame();
    this.createContentCanvas();
  }

  /**
   * Create content canvas for minimap rendering
   */
  createContentCanvas() {
    this.contentCanvas = document.createElement('canvas');
    this.contentCanvas.width = this.size;
    this.contentCanvas.height = this.size;
    this.contentCtx = this.contentCanvas.getContext('2d');
  }

  /**
   * Generate parchment-style frame (cached once)
   */
  generateFrame() {
    const totalSize = this.size + this.frameWidth * 2;
    this.frameCanvas = document.createElement('canvas');
    this.frameCanvas.width = totalSize;
    this.frameCanvas.height = totalSize;
    this.frameCtx = this.frameCanvas.getContext('2d');

    const ctx = this.frameCtx;
    const w = totalSize;
    const h = totalSize;

    // Outer dark border (wood frame)
    ctx.fillStyle = '#3d2914';
    ctx.fillRect(0, 0, w, h);

    // Inner parchment background
    ctx.fillStyle = '#f4e4bc';
    ctx.fillRect(this.frameWidth, this.frameWidth,
                 this.size, this.size);

    // Inner border highlight
    ctx.strokeStyle = '#c9a959';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.frameWidth + 0.5, this.frameWidth + 0.5,
                   this.size - 1, this.size - 1);

    // Corner decorations (small ornamental dots)
    ctx.fillStyle = '#c9a959';
    const cornerOffset = 6;
    const dotSize = 3;

    // Top-left
    ctx.beginPath();
    ctx.arc(cornerOffset, cornerOffset, dotSize, 0, Math.PI * 2);
    ctx.fill();

    // Top-right
    ctx.beginPath();
    ctx.arc(w - cornerOffset, cornerOffset, dotSize, 0, Math.PI * 2);
    ctx.fill();

    // Bottom-left
    ctx.beginPath();
    ctx.arc(cornerOffset, h - cornerOffset, dotSize, 0, Math.PI * 2);
    ctx.fill();

    // Bottom-right
    ctx.beginPath();
    ctx.arc(w - cornerOffset, h - cornerOffset, dotSize, 0, Math.PI * 2);
    ctx.fill();

    // Compass indicator (N) in top-right area
    ctx.fillStyle = '#3d2914';
    ctx.font = 'bold 10px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', w - 15, 15);

    // Small arrow under N
    ctx.beginPath();
    ctx.moveTo(w - 15, 20);
    ctx.lineTo(w - 18, 25);
    ctx.lineTo(w - 12, 25);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Calculate world bounds from nodes
   */
  calculateWorldBounds(nodes) {
    if (!nodes || nodes.length === 0) {
      this.worldBounds = { minX: -10, maxX: 10, minY: -10, maxY: 10 };
      this.worldScale = 1;
      return;
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const node of nodes) {
      minX = Math.min(minX, node.x_coord);
      maxX = Math.max(maxX, node.x_coord);
      minY = Math.min(minY, node.y_coord);
      maxY = Math.max(maxY, node.y_coord);
    }

    // Add padding
    const padX = (maxX - minX) * 0.1 || 5;
    const padY = (maxY - minY) * 0.1 || 5;

    this.worldBounds = {
      minX: minX - padX,
      maxX: maxX + padX,
      minY: minY - padY,
      maxY: maxY + padY
    };

    // Calculate scale to fit world in minimap
    const worldWidth = this.worldBounds.maxX - this.worldBounds.minX;
    const worldHeight = this.worldBounds.maxY - this.worldBounds.minY;
    const availableSize = this.size - this.padding * 2;

    this.worldScale = availableSize / Math.max(worldWidth, worldHeight);
  }

  /**
   * Convert world coordinates to minimap coordinates
   */
  worldToMinimap(worldX, worldY) {
    const availableSize = this.size - this.padding * 2;
    const worldWidth = this.worldBounds.maxX - this.worldBounds.minX;
    const worldHeight = this.worldBounds.maxY - this.worldBounds.minY;

    // Center the content
    const offsetX = (availableSize - worldWidth * this.worldScale) / 2;
    const offsetY = (availableSize - worldHeight * this.worldScale) / 2;

    return {
      x: this.padding + offsetX + (worldX - this.worldBounds.minX) * this.worldScale,
      y: this.padding + offsetY + (worldY - this.worldBounds.minY) * this.worldScale
    };
  }

  /**
   * Convert minimap coordinates to world coordinates
   */
  minimapToWorld(minimapX, minimapY) {
    const availableSize = this.size - this.padding * 2;
    const worldWidth = this.worldBounds.maxX - this.worldBounds.minX;
    const worldHeight = this.worldBounds.maxY - this.worldBounds.minY;

    const offsetX = (availableSize - worldWidth * this.worldScale) / 2;
    const offsetY = (availableSize - worldHeight * this.worldScale) / 2;

    return {
      x: (minimapX - this.padding - offsetX) / this.worldScale + this.worldBounds.minX,
      y: (minimapY - this.padding - offsetY) / this.worldScale + this.worldBounds.minY
    };
  }

  /**
   * Calculate bezier control point for curved path (matches WorldMapEffects)
   */
  getPathControlPoint(x1, y1, x2, y2, fromNodeId, toNodeId) {
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length < 1) return { x: midX, y: midY };

    const perpX = -dy / length;
    const perpY = dx / length;
    const curveAmount = Math.min(length * 0.2, 8); // Scaled for minimap
    const direction = fromNodeId < toNodeId ? 1 : -1;

    return {
      x: midX + perpX * curveAmount * direction,
      y: midY + perpY * curveAmount * direction
    };
  }

  /**
   * Main render function
   */
  render(ctx, state) {
    const {
      nodes,
      connections,
      currentNode,
      discoveredNodes,
      visitedNodes,
      cameraX,
      cameraY,
      canvasWidth,
      canvasHeight,
      nodeSpacing
    } = state;

    // Update animation
    this.pulsePhase = (Date.now() * 0.004) % (Math.PI * 2);

    // Render content to offscreen canvas
    this.renderContent(nodes, connections, currentNode, discoveredNodes, visitedNodes);

    // Calculate position (bottom-right corner)
    const totalSize = this.size + this.frameWidth * 2;
    const x = canvasWidth - totalSize - this.margin;
    const y = canvasHeight - totalSize - this.margin;

    // Draw frame
    ctx.drawImage(this.frameCanvas, x, y);

    // Draw content
    ctx.drawImage(this.contentCanvas, x + this.frameWidth, y + this.frameWidth);

    // Draw viewport rectangle (dynamic, on top)
    this.renderViewport(ctx, x + this.frameWidth, y + this.frameWidth,
                        cameraX, cameraY, canvasWidth, canvasHeight, nodeSpacing);
  }

  /**
   * Render minimap content to offscreen canvas
   */
  renderContent(nodes, connections, currentNode, discoveredNodes, visitedNodes) {
    const ctx = this.contentCtx;

    // Clear with parchment background
    ctx.fillStyle = '#f4e4bc';
    ctx.fillRect(0, 0, this.size, this.size);

    // Render fog of war base
    this.renderFogBase(ctx);

    // Render path and node reveals (cut through fog)
    this.renderFogReveals(ctx, nodes, connections, discoveredNodes, visitedNodes);

    // Render paths on top of fog
    this.renderPaths(ctx, nodes, connections, discoveredNodes, visitedNodes);

    // Render node symbols
    this.renderNodes(ctx, nodes, currentNode, discoveredNodes, visitedNodes);

    // Render current player marker
    if (currentNode) {
      this.renderPlayerMarker(ctx, currentNode);
    }
  }

  /**
   * Render fog of war base layer
   */
  renderFogBase(ctx) {
    ctx.fillStyle = 'rgba(60, 45, 30, 0.85)';
    ctx.fillRect(0, 0, this.size, this.size);
  }

  /**
   * Render fog reveals for discovered areas
   */
  renderFogReveals(ctx, nodes, connections, discoveredNodes, visitedNodes) {
    ctx.globalCompositeOperation = 'destination-out';

    // Reveal paths
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    for (const conn of connections) {
      const fromNode = nodeMap.get(conn.from_node_id);
      const toNode = nodeMap.get(conn.to_node_id);

      if (!fromNode || !toNode) continue;

      const fromVisited = visitedNodes.has(fromNode.id);
      const toVisited = visitedNodes.has(toNode.id);

      if (!fromVisited && !toVisited) continue;

      const pos1 = this.worldToMinimap(fromNode.x_coord, fromNode.y_coord);
      const pos2 = this.worldToMinimap(toNode.x_coord, toNode.y_coord);
      const control = this.getPathControlPoint(pos1.x, pos1.y, pos2.x, pos2.y,
                                                conn.from_node_id, conn.to_node_id);

      const bothVisited = fromVisited && toVisited;
      ctx.strokeStyle = bothVisited ? 'rgba(0,0,0,1.0)' : 'rgba(0,0,0,0.6)';
      ctx.lineWidth = bothVisited ? 8 : 5;

      ctx.beginPath();
      ctx.moveTo(pos1.x, pos1.y);
      ctx.quadraticCurveTo(control.x, control.y, pos2.x, pos2.y);
      ctx.stroke();
    }

    // Reveal nodes
    for (const node of nodes) {
      if (!discoveredNodes.has(node.id)) continue;

      const pos = this.worldToMinimap(node.x_coord, node.y_coord);
      const visited = visitedNodes.has(node.id);

      const radius = visited ? 12 : 8;
      const opacity = visited ? 1.0 : 0.6;

      const gradient = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, radius);
      gradient.addColorStop(0, `rgba(0, 0, 0, ${opacity})`);
      gradient.addColorStop(0.6, `rgba(0, 0, 0, ${opacity * 0.7})`);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Render paths between discovered nodes
   */
  renderPaths(ctx, nodes, connections, discoveredNodes, visitedNodes) {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const conn of connections) {
      const fromNode = nodeMap.get(conn.from_node_id);
      const toNode = nodeMap.get(conn.to_node_id);

      if (!fromNode || !toNode) continue;
      if (!discoveredNodes.has(fromNode.id) || !discoveredNodes.has(toNode.id)) continue;

      const pos1 = this.worldToMinimap(fromNode.x_coord, fromNode.y_coord);
      const pos2 = this.worldToMinimap(toNode.x_coord, toNode.y_coord);
      const control = this.getPathControlPoint(pos1.x, pos1.y, pos2.x, pos2.y,
                                                conn.from_node_id, conn.to_node_id);

      const fromVisited = visitedNodes.has(fromNode.id);
      const toVisited = visitedNodes.has(toNode.id);
      const bothVisited = fromVisited && toVisited;

      // Path shadow
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = bothVisited ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(pos1.x + 1, pos1.y + 1);
      ctx.quadraticCurveTo(control.x + 1, control.y + 1, pos2.x + 1, pos2.y + 1);
      ctx.stroke();

      // Main path
      ctx.strokeStyle = bothVisited ? '#5d4e37' : 'rgba(93, 78, 55, 0.5)';
      ctx.lineWidth = bothVisited ? 2 : 1;
      ctx.setLineDash(bothVisited ? [] : [2, 2]);
      ctx.beginPath();
      ctx.moveTo(pos1.x, pos1.y);
      ctx.quadraticCurveTo(control.x, control.y, pos2.x, pos2.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /**
   * Render node symbols
   */
  renderNodes(ctx, nodes, currentNode, discoveredNodes, visitedNodes) {
    for (const node of nodes) {
      if (!discoveredNodes.has(node.id)) continue;

      const pos = this.worldToMinimap(node.x_coord, node.y_coord);
      const isCurrent = currentNode && node.id === currentNode.id;
      const isVisited = visitedNodes.has(node.id);

      this.renderNodeSymbol(ctx, pos.x, pos.y, node.node_type, isCurrent, isVisited);
    }
  }

  /**
   * Render individual node symbol
   */
  renderNodeSymbol(ctx, x, y, nodeType, isCurrent, isVisited) {
    const symbol = this.nodeSymbols[nodeType] || { shape: 'circle', color: '#4a4a6a', size: 3 };
    const size = isCurrent ? symbol.size + 2 : symbol.size;
    const alpha = isVisited ? 1.0 : 0.7;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = isCurrent ? '#ffd700' : symbol.color;
    ctx.strokeStyle = '#3d2914';
    ctx.lineWidth = 1;

    switch (symbol.shape) {
      case 'square':
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
        ctx.strokeRect(x - size / 2, y - size / 2, size, size);
        break;

      case 'diamond':
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.strokeRect(-size / 2, -size / 2, size, size);
        ctx.restore();
        break;

      case 'circle':
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;

      case 'triangle':
        ctx.beginPath();
        ctx.moveTo(x, y - size / 2);
        ctx.lineTo(x - size / 2, y + size / 2);
        ctx.lineTo(x + size / 2, y + size / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;

      case 'rect':
        ctx.fillRect(x - size, y - size / 3, size * 2, size * 0.66);
        ctx.strokeRect(x - size, y - size / 3, size * 2, size * 0.66);
        break;

      case 'star':
        this.drawStar(ctx, x, y, 5, size, size / 2);
        ctx.fill();
        ctx.stroke();
        break;
    }

    ctx.globalAlpha = 1.0;
  }

  /**
   * Draw a star shape
   */
  drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius) {
    let rot = Math.PI / 2 * 3;
    const step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);

    for (let i = 0; i < spikes; i++) {
      let x = cx + Math.cos(rot) * outerRadius;
      let y = cy + Math.sin(rot) * outerRadius;
      ctx.lineTo(x, y);
      rot += step;

      x = cx + Math.cos(rot) * innerRadius;
      y = cy + Math.sin(rot) * innerRadius;
      ctx.lineTo(x, y);
      rot += step;
    }

    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
  }

  /**
   * Render pulsing player marker
   */
  renderPlayerMarker(ctx, currentNode) {
    const pos = this.worldToMinimap(currentNode.x_coord, currentNode.y_coord);
    const symbol = this.nodeSymbols[currentNode.node_type] || { size: 3 };
    const baseSize = symbol.size + 2;

    // Pulsing ring
    const pulse = 0.4 + Math.sin(this.pulsePhase) * 0.3;
    const ringSize = baseSize + 4 + Math.sin(this.pulsePhase) * 2;

    ctx.globalAlpha = pulse;
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, ringSize, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }

  /**
   * Render viewport rectangle
   */
  renderViewport(ctx, minimapX, minimapY, cameraX, cameraY, canvasWidth, canvasHeight, nodeSpacing) {
    // Calculate viewport corners in world coordinates
    const viewLeft = -cameraX / nodeSpacing;
    const viewTop = -cameraY / nodeSpacing;
    const viewRight = viewLeft + canvasWidth / nodeSpacing;
    const viewBottom = viewTop + canvasHeight / nodeSpacing;

    // Convert to minimap coordinates
    const topLeft = this.worldToMinimap(viewLeft, viewTop);
    const bottomRight = this.worldToMinimap(viewRight, viewBottom);

    const rectX = minimapX + topLeft.x;
    const rectY = minimapY + topLeft.y;
    const rectW = bottomRight.x - topLeft.x;
    const rectH = bottomRight.y - topLeft.y;

    // Draw viewport rectangle
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(rectX, rectY, rectW, rectH);
    ctx.setLineDash([]);

    // Inner glow
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rectX + 1, rectY + 1, rectW - 2, rectH - 2);
  }

  /**
   * Check if a point is within the minimap bounds
   */
  isPointInMinimap(screenX, screenY, canvasWidth, canvasHeight) {
    const totalSize = this.size + this.frameWidth * 2;
    const minimapX = canvasWidth - totalSize - this.margin;
    const minimapY = canvasHeight - totalSize - this.margin;

    return screenX >= minimapX && screenX <= minimapX + totalSize &&
           screenY >= minimapY && screenY <= minimapY + totalSize;
  }

  /**
   * Handle click on minimap, return world coordinates or null
   */
  handleClick(screenX, screenY, canvasWidth, canvasHeight, nodes, currentNodeId, isNodeAdjacent) {
    if (!this.isPointInMinimap(screenX, screenY, canvasWidth, canvasHeight)) {
      return null;
    }

    const totalSize = this.size + this.frameWidth * 2;
    const minimapX = canvasWidth - totalSize - this.margin + this.frameWidth;
    const minimapY = canvasHeight - totalSize - this.margin + this.frameWidth;

    // Convert to minimap-relative coordinates
    const relX = screenX - minimapX;
    const relY = screenY - minimapY;

    // Convert to world coordinates
    const worldPos = this.minimapToWorld(relX, relY);

    // Find closest node
    let closestNode = null;
    let closestDist = Infinity;

    for (const node of nodes) {
      const dx = node.x_coord - worldPos.x;
      const dy = node.y_coord - worldPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < closestDist) {
        closestDist = dist;
        closestNode = node;
      }
    }

    // Check if close enough to a node (within 3 world units)
    if (closestNode && closestDist < 3 && closestNode.id !== currentNodeId) {
      // Check if adjacent (caller provides this function)
      if (isNodeAdjacent && isNodeAdjacent(closestNode)) {
        return closestNode;
      }
    }

    return null;
  }
}
