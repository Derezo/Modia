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

    // Debug mode (enabled via URL parameter ?fogDebug=true)
    this.fogDebugMode = new URLSearchParams(window.location.search).get('fogDebug') === 'true';

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

    // Region data for castle coloring
    this.regions = [];
    this.castleNodes = [];

    // Quest marker manager reference
    this.questMarkerManager = null;

    // Region colors by race (matching WorldMapScene)
    this.regionColors = {
      human: '#8B7355',    // Brown/earth
      elf: '#2E8B57',      // Forest green
      dwarf: '#708090',    // Slate gray
      vampire: '#4B0082',  // Indigo/purple
      orc: '#8B0000'       // Dark red
    };
  }

  /**
   * Set region data for enhanced castle rendering
   * @param {Array} regions - Region data from API
   * @param {Array} castleNodes - Array of castle node objects
   */
  setRegionData(regions, castleNodes) {
    this.regions = regions || [];
    this.castleNodes = castleNodes || [];
  }

  /**
   * Set quest marker manager for rendering quest markers on minimap
   * @param {QuestMarkerManager} questMarkerManager - Quest marker manager instance
   */
  setQuestMarkers(questMarkerManager) {
    this.questMarkerManager = questMarkerManager || null;
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

    if (this.fogDebugMode) {
      console.log('[WorldMapMinimap] Content canvas created:', this.size, 'x', this.size);
    }
  }

  /**
   * Validate canvas state and attempt recovery if invalid
   * Called per-frame to detect and recover from canvas context loss
   * @returns {boolean} True if canvas is valid (or was recovered)
   */
  validateAndRecoverCanvas() {
    // Check if content canvas and context exist
    if (!this.contentCanvas || !this.contentCtx) {
      console.warn('[WorldMapMinimap] Canvas/context missing, recreating...');
      this.createContentCanvas();
      return !!this.contentCtx;
    }

    // Check if canvas has valid dimensions
    if (this.contentCanvas.width === 0 || this.contentCanvas.height === 0) {
      console.warn('[WorldMapMinimap] Canvas has zero dimensions, recreating...');
      this.createContentCanvas();
      return !!this.contentCtx;
    }

    // Check for context loss (WebGL-style detection for 2D context)
    // The isContextLost() method doesn't exist on 2D contexts, but we can check
    // if the context is still valid by attempting a basic operation
    try {
      // Simple validation: check if we can read a property
      // This is much cheaper than drawing and reading pixels
      // eslint-disable-next-line no-unused-vars
      const _ = this.contentCtx.canvas;
      return true;
    } catch (e) {
      console.error('[WorldMapMinimap] Canvas context invalid:', e.message);
      this.createContentCanvas();
      return !!this.contentCtx;
    }
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

    // Validate canvas state before drawing
    const frameValid = this.frameCanvas && this.frameCanvas.width > 0 && this.frameCanvas.height > 0;
    const contentValid = this.contentCanvas && this.contentCanvas.width > 0 && this.contentCanvas.height > 0;

    // One-time diagnostic if canvases are invalid
    if (!this._canvasValidationLogged && (!frameValid || !contentValid)) {
      console.error('[Minimap] Canvas validation failed:', {
        frameCanvas: this.frameCanvas ? `${this.frameCanvas.width}x${this.frameCanvas.height}` : 'null',
        contentCanvas: this.contentCanvas ? `${this.contentCanvas.width}x${this.contentCanvas.height}` : 'null',
        frameCtx: !!this.frameCtx,
        contentCtx: !!this.contentCtx
      });
      this._canvasValidationLogged = true;
    }

    // Draw frame
    if (frameValid) {
      ctx.drawImage(this.frameCanvas, x, y);
    }

    // Draw content
    if (contentValid) {
      ctx.drawImage(this.contentCanvas, x + this.frameWidth, y + this.frameWidth);
    }

    // One-time test: verify drawImage actually produced output
    if (!this._drawImageTestDone && frameValid) {
      try {
        const testPixel = ctx.getImageData(x + 5, y + 5, 1, 1).data;
        const hasContent = testPixel[3] > 0; // Check alpha channel
        if (!hasContent) {
          console.error('[Minimap] drawImage produced no visible output! Canvas may be in bad state.');
          console.error('[Minimap] Test pixel at', x + 5, y + 5, ':', testPixel);
        }
        this._drawImageTestDone = true;
      } catch (e) {
        console.error('[Minimap] getImageData failed:', e.message);
      }
    }

    // Draw viewport rectangle (dynamic, on top)
    this.renderViewport(ctx, x + this.frameWidth, y + this.frameWidth,
      cameraX, cameraY, canvasWidth, canvasHeight, nodeSpacing);
  }

  /**
   * Render minimap content to offscreen canvas
   */
  renderContent(nodes, connections, currentNode, discoveredNodes, visitedNodes) {
    // Per-frame validation with automatic recovery
    if (!this.validateAndRecoverCanvas()) {
      console.warn('[WorldMapMinimap] Canvas recovery failed, skipping render');
      return;
    }

    const ctx = this.contentCtx;

    // FALLBACK: If discoveredNodes is empty, create a set from all nodes
    const effectiveDiscovered = discoveredNodes.size > 0
      ? discoveredNodes
      : new Set(nodes.map(n => n.id));

    const effectiveVisited = visitedNodes.size > 0
      ? visitedNodes
      : new Set(nodes.filter(n => n.visited).map(n => n.id));

    // Log fallback activation once for debugging
    if (!this._fallbackLogged && discoveredNodes.size === 0 && nodes.length > 0) {
      console.warn('[WorldMapMinimap] discoveredNodes empty, using fallback with all', nodes.length, 'nodes');
      this._fallbackLogged = true;
    }

    // Verify canvas dimensions match expected size
    if (this.contentCanvas.width !== this.size || this.contentCanvas.height !== this.size) {
      this.contentCanvas.width = this.size;
      this.contentCanvas.height = this.size;
    }

    // Save context state and perform complete reset
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);  // Reset transform matrix
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.setLineDash([]);

    // Clear with parchment background
    ctx.fillStyle = '#f4e4bc';
    ctx.fillRect(0, 0, this.size, this.size);

    // Render fog of war base
    this.renderFogBase(ctx);

    // Render path and node reveals (cut through fog)
    this.renderFogReveals(ctx, nodes, connections, effectiveDiscovered, effectiveVisited);

    // Render paths on top of fog
    this.renderPaths(ctx, nodes, connections, effectiveDiscovered, effectiveVisited);

    // Render node symbols
    this.renderNodes(ctx, nodes, currentNode, effectiveDiscovered, effectiveVisited);

    // Render quest markers (small dots on nodes with quests)
    this.renderQuestMarkers(ctx, nodes, effectiveDiscovered);

    // Render current player marker
    if (currentNode) {
      this.renderPlayerMarker(ctx, currentNode);
    }

    ctx.restore();
  }

  /**
   * Render fog of war base layer
   */
  renderFogBase(ctx) {
    // Use 50% opacity in debug mode for visibility
    const opacity = this.fogDebugMode ? 0.5 : 0.85;
    ctx.fillStyle = `rgba(60, 45, 30, ${opacity})`;
    ctx.fillRect(0, 0, this.size, this.size);

    // Debug mode: draw green corner square to confirm rendering
    if (this.fogDebugMode) {
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(this.size - 12, this.size - 12, 10, 10);
    }
  }

  /**
   * Render fog reveals for discovered areas
   */
  renderFogReveals(ctx, nodes, connections, discoveredNodes, visitedNodes) {
    ctx.save();
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

    ctx.restore();
  }

  /**
   * Render paths between discovered nodes
   */
  renderPaths(ctx, nodes, connections, discoveredNodes, visitedNodes) {
    ctx.save();
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
    ctx.restore();
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

      this.renderNodeSymbol(ctx, pos.x, pos.y, node, isCurrent, isVisited);
    }
  }

  /**
   * Render individual node symbol
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {Object} node - Full node object (for region_race access)
   * @param {boolean} isCurrent - Whether this is the current node
   * @param {boolean} isVisited - Whether node has been visited
   */
  renderNodeSymbol(ctx, x, y, node, isCurrent, isVisited) {
    ctx.save();

    const nodeType = typeof node === 'object' ? node.node_type : node;
    const regionRace = typeof node === 'object' ? node.region_race : null;

    const symbol = this.nodeSymbols[nodeType] || { shape: 'circle', color: '#4a4a6a', size: 3 };
    const size = isCurrent ? symbol.size + 2 : symbol.size;
    const alpha = isVisited ? 1.0 : 0.7;

    // Use region color for castle nodes (5-region system)
    let fillColor = symbol.color;
    if (nodeType === 'castle' && regionRace && this.regionColors[regionRace]) {
      fillColor = this.regionColors[regionRace];
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = isCurrent ? '#ffd700' : fillColor;
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

    ctx.restore();
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
   * Render quest markers as small colored dots on nodes with active quests
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Array} nodes - All world nodes
   * @param {Set} discoveredNodes - Set of discovered node IDs
   */
  renderQuestMarkers(ctx, nodes, discoveredNodes) {
    if (!this.questMarkerManager) return;

    // Quest marker colors
    const QUEST_COLORS = {
      daily: '#b87333',   // Copper
      weekly: '#ffd700'   // Gold
    };

    for (const node of nodes) {
      // Only show markers on discovered nodes
      if (!discoveredNodes.has(node.id)) continue;

      // Skip nodes without quest markers
      if (!this.questMarkerManager.hasMarker(node.id)) continue;

      const marker = this.questMarkerManager.getMarkerForNode(node.id);
      if (!marker) continue;

      const pos = this.worldToMinimap(node.x_coord, node.y_coord);
      const dotRadius = 3;

      // Offset the dot slightly from the node center
      const offsetX = 4;
      const offsetY = -4;

      ctx.save();
      ctx.globalAlpha = 0.85;

      // Draw quest type dot (weekly takes priority for color)
      const dotColor = marker.hasWeekly ? QUEST_COLORS.weekly : QUEST_COLORS.daily;

      // Draw dot
      ctx.beginPath();
      ctx.arc(pos.x + offsetX, pos.y + offsetY, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = dotColor;
      ctx.fill();

      // Subtle border
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      ctx.restore();
    }
  }

  /**
   * Render pulsing player marker
   */
  renderPlayerMarker(ctx, currentNode) {
    ctx.save();

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

    ctx.restore();
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

    let rectX = minimapX + topLeft.x;
    let rectY = minimapY + topLeft.y;
    let rectW = bottomRight.x - topLeft.x;
    let rectH = bottomRight.y - topLeft.y;

    // Clamp viewport rectangle to minimap bounds
    const minX = minimapX;
    const minY = minimapY;
    const maxX = minimapX + this.size;
    const maxY = minimapY + this.size;

    // Adjust rectangle to stay within minimap
    if (rectX < minX) {
      rectW -= (minX - rectX);
      rectX = minX;
    }
    if (rectY < minY) {
      rectH -= (minY - rectY);
      rectY = minY;
    }
    if (rectX + rectW > maxX) {
      rectW = maxX - rectX;
    }
    if (rectY + rectH > maxY) {
      rectH = maxY - rectY;
    }

    // Don't draw if viewport covers entire minimap or is invalid
    if (rectW <= 0 || rectH <= 0 || (rectW >= this.size - 4 && rectH >= this.size - 4)) {
      return;
    }

    // Save context state before drawing
    ctx.save();

    // Draw viewport rectangle
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(rectX, rectY, rectW, rectH);

    // Inner glow
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rectX + 1, rectY + 1, rectW - 2, rectH - 2);

    ctx.restore();
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
