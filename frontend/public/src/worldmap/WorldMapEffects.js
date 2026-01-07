/**
 * WorldMapEffects - Parchment-style world map renderer with fog of war
 * Hand-drawn aesthetic with hatching patterns and discovery mechanics
 */

export class WorldMapEffects {
  constructor(assetLoader) {
    this.assetLoader = assetLoader;

    // Parchment texture (procedurally generated)
    this.parchmentTexture = null;

    // Fog of war canvas (offscreen at 1/4 resolution)
    this.fogCanvas = null;
    this.fogCtx = null;

    // Discovery state
    this.discoveredNodes = new Set();
    this.visitedNodes = new Set();

    // Seeded random for consistent hatching
    this.hatchSeed = 12345;

    // Node spacing (should match WorldMapScene)
    this.nodeSpacing = 60;

    // Animation state
    this.glowPhase = 0;
    this.glowSpeed = 0.003;

    // Particles (kept for compatibility but simplified)
    this.particles = [];
  }

  /**
   * Initialize assets
   */
  async init() {
    this.parchmentTexture = this.generateParchmentTexture();
  }

  /**
   * Generate parchment texture procedurally
   */
  generateParchmentTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Base color - warm parchment
    ctx.fillStyle = '#f4e4bc';
    ctx.fillRect(0, 0, 256, 256);

    // Add noise for paper texture
    const imageData = ctx.getImageData(0, 0, 256, 256);
    const rng = this.seededRandom(this.hatchSeed);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const noise = (rng() - 0.5) * 20;
      imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + noise));     // R
      imageData.data[i + 1] = Math.max(0, Math.min(255, imageData.data[i + 1] + noise)); // G
      imageData.data[i + 2] = Math.max(0, Math.min(255, imageData.data[i + 2] + noise / 2)); // B (less blue)
    }
    ctx.putImageData(imageData, 0, 0);

    // Add age stains
    ctx.globalAlpha = 0.08;
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = `rgba(139, 90, 43, ${rng() * 0.3})`;
      ctx.beginPath();
      ctx.arc(
        rng() * 256,
        rng() * 256,
        20 + rng() * 40,
        0, Math.PI * 2
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    return canvas;
  }

  /**
   * Simple seeded random number generator
   */
  seededRandom(seed) {
    let s = seed;
    return function() {
      s = Math.sin(s) * 10000;
      return s - Math.floor(s);
    };
  }

  /**
   * Update discovery state from node data
   */
  updateDiscoveryState(nodes) {
    this.discoveredNodes.clear();
    this.visitedNodes.clear();

    for (const node of nodes) {
      this.discoveredNodes.add(node.id);
      if (node.visited) {
        this.visitedNodes.add(node.id);
      }
    }
  }

  /**
   * Update animation state
   */
  update(deltaTime) {
    this.glowPhase += this.glowSpeed * deltaTime;
    if (this.glowPhase > Math.PI * 2) {
      this.glowPhase -= Math.PI * 2;
    }
  }

  /**
   * Main render function - 6 layer system
   */
  render(ctx, cameraX, cameraY, canvasWidth, canvasHeight, nodes, connections) {
    // Layer 1: Parchment background
    this.renderParchmentBackground(ctx, canvasWidth, canvasHeight);

    // Layer 2: Region illustrations (hatching patterns)
    this.renderRegionIllustrations(ctx, cameraX, cameraY, nodes);

    // Layer 3: Paths as hand-drawn lines
    this.renderHandDrawnPaths(ctx, cameraX, cameraY, connections, nodes);

    // Layer 4: Node markers
    this.renderNodeMarkers(ctx, cameraX, cameraY, nodes);

    // Layer 5: Fog of war overlay
    this.renderFogOfWar(ctx, cameraX, cameraY, canvasWidth, canvasHeight, nodes);

    // Layer 6: Labels for visited nodes
    this.renderNodeLabels(ctx, cameraX, cameraY, nodes);
  }

  /**
   * Legacy render method for compatibility
   */
  renderBackdrop(ctx, cameraX, cameraY, canvasWidth, canvasHeight) {
    this.renderParchmentBackground(ctx, canvasWidth, canvasHeight);
  }

  /**
   * Layer 1: Tiled parchment background with vignette
   */
  renderParchmentBackground(ctx, canvasWidth, canvasHeight) {
    if (!this.parchmentTexture) {
      ctx.fillStyle = '#f4e4bc';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      return;
    }

    const pattern = ctx.createPattern(this.parchmentTexture, 'repeat');
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Subtle vignette effect
    const gradient = ctx.createRadialGradient(
      canvasWidth / 2, canvasHeight / 2, 0,
      canvasWidth / 2, canvasHeight / 2, Math.max(canvasWidth, canvasHeight) * 0.7
    );
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.15)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  }

  /**
   * Layer 2: Region illustrations using hatching patterns
   */
  renderRegionIllustrations(ctx, cameraX, cameraY, nodes) {
    for (const node of nodes) {
      if (!this.discoveredNodes.has(node.id)) continue;

      const screenX = node.x_coord * this.nodeSpacing + cameraX;
      const screenY = node.y_coord * this.nodeSpacing + cameraY;
      const radius = this.getRegionRadius(node.node_type);

      ctx.save();
      ctx.globalAlpha = 0.25;

      switch (node.node_type) {
        case 'forest':
          this.drawForestHatching(ctx, screenX, screenY, radius, node.id);
          break;
        case 'mountain':
        case 'cave':
          this.drawMountainPeaks(ctx, screenX, screenY, radius, node.id);
          break;
        case 'bridge':
          this.drawWaterWaves(ctx, screenX, screenY, radius);
          break;
      }

      ctx.restore();
    }
  }

  /**
   * Draw forest crosshatch pattern
   */
  drawForestHatching(ctx, x, y, radius, seed) {
    ctx.strokeStyle = '#2d5016';
    ctx.lineWidth = 1;

    const rng = this.seededRandom(seed);
    const spacing = 8;

    // Crosshatch lines
    for (let i = -radius; i < radius; i += spacing) {
      const wobble1 = (rng() - 0.5) * 3;
      const wobble2 = (rng() - 0.5) * 3;

      ctx.beginPath();
      ctx.moveTo(x + i + wobble1, y - radius);
      ctx.lineTo(x + i + radius + wobble2, y + radius);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x + i + radius + wobble1, y - radius);
      ctx.lineTo(x + i + wobble2, y + radius);
      ctx.stroke();
    }
  }

  /**
   * Draw mountain peak symbols
   */
  drawMountainPeaks(ctx, x, y, radius, seed) {
    ctx.strokeStyle = '#4a4a4a';
    ctx.lineWidth = 1;

    const rng = this.seededRandom(seed);
    const peakCount = Math.floor(radius / 15);

    for (let i = 0; i < peakCount; i++) {
      const px = x + (rng() - 0.5) * radius * 1.5;
      const py = y + (rng() - 0.5) * radius * 1.5;
      const size = 8 + rng() * 12;

      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - size / 2, py + size);
      ctx.lineTo(px + size / 2, py + size);
      ctx.closePath();
      ctx.stroke();
    }
  }

  /**
   * Draw water wave lines
   */
  drawWaterWaves(ctx, x, y, radius) {
    ctx.strokeStyle = '#1a5276';
    ctx.lineWidth = 1;

    const waveCount = Math.floor(radius / 12);
    for (let i = 0; i < waveCount; i++) {
      const wy = y - radius / 2 + i * 12;
      ctx.beginPath();
      ctx.moveTo(x - radius, wy);
      for (let wx = -radius; wx < radius; wx += 12) {
        ctx.quadraticCurveTo(
          x + wx + 6, wy - 4,
          x + wx + 12, wy
        );
      }
      ctx.stroke();
    }
  }

  /**
   * Get region influence radius by node type
   */
  getRegionRadius(nodeType) {
    const radii = {
      castle: 100, palace: 90, city: 70,
      forest: 60, mountain: 60, cave: 45,
      village: 45, guild: 45, bridge: 35
    };
    return radii[nodeType] || 45;
  }

  /**
   * Layer 3: Hand-drawn style paths
   */
  renderHandDrawnPaths(ctx, cameraX, cameraY, connections, nodes) {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    ctx.strokeStyle = '#5d4e37';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]); // Dashed for hand-drawn look

    for (const conn of connections) {
      const fromNode = nodeMap.get(conn.from_node_id);
      const toNode = nodeMap.get(conn.to_node_id);

      if (!fromNode || !toNode) continue;

      // Only draw if both nodes discovered
      if (!this.discoveredNodes.has(fromNode.id) ||
          !this.discoveredNodes.has(toNode.id)) continue;

      const x1 = fromNode.x_coord * this.nodeSpacing + cameraX;
      const y1 = fromNode.y_coord * this.nodeSpacing + cameraY;
      const x2 = toNode.x_coord * this.nodeSpacing + cameraX;
      const y2 = toNode.y_coord * this.nodeSpacing + cameraY;

      // Slightly wavy line for hand-drawn effect
      ctx.beginPath();
      ctx.moveTo(x1, y1);

      const segments = 5;
      for (let i = 1; i <= segments; i++) {
        const t = i / segments;
        const x = x1 + (x2 - x1) * t;
        const y = y1 + (y2 - y1) * t;
        const wobble = Math.sin(i * 2.5 + fromNode.id) * 2;
        ctx.lineTo(x + wobble, y + wobble);
      }

      ctx.stroke();
    }

    ctx.setLineDash([]);
  }

  /**
   * Layer 4: Node markers with icons
   */
  renderNodeMarkers(ctx, cameraX, cameraY, nodes) {
    for (const node of nodes) {
      if (!this.discoveredNodes.has(node.id)) continue;

      const screenX = node.x_coord * this.nodeSpacing + cameraX;
      const screenY = node.y_coord * this.nodeSpacing + cameraY;
      const visited = this.visitedNodes.has(node.id);

      // Marker circle with pulse for current location
      const baseRadius = 12;
      const radius = baseRadius + (visited ? Math.sin(this.glowPhase) * 2 : 0);

      ctx.beginPath();
      ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
      ctx.fillStyle = visited ? '#c9a959' : '#8b7355';
      ctx.fill();
      ctx.strokeStyle = '#3d2914';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Node type icon
      ctx.fillStyle = '#3d2914';
      ctx.font = '10px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const icons = {
        castle: '\u2655',   // Queen chess piece
        village: '\u2302',  // House
        city: '\u2616',     // Tower
        forest: '\u2698',   // Flower
        mountain: '\u25B2', // Triangle
        cave: '\u25CF',     // Circle
        bridge: '\u2248',   // Approximately equal (waves)
        guild: '\u2694',    // Crossed swords
        palace: '\u265B'    // King chess piece
      };
      ctx.fillText(icons[node.node_type] || '\u25CF', screenX, screenY);
    }
  }

  /**
   * Layer 5: Fog of war overlay
   * - Visited nodes: fully cleared
   * - Unvisited but discovered nodes: lightened fog (visible but dimmed)
   * - Paths between visited nodes: fully cleared (curved)
   * - Paths to unvisited adjacent nodes: lightened fog (curved)
   */
  renderFogOfWar(ctx, cameraX, cameraY, canvasWidth, canvasHeight, nodes, connections = []) {
    // Create fog canvas at 1/4 resolution for performance
    const scale = 0.25;
    const fogW = Math.ceil(canvasWidth * scale);
    const fogH = Math.ceil(canvasHeight * scale);

    if (!this.fogCanvas || this.fogCanvas.width !== fogW || this.fogCanvas.height !== fogH) {
      this.fogCanvas = document.createElement('canvas');
      this.fogCanvas.width = fogW;
      this.fogCanvas.height = fogH;
      this.fogCtx = this.fogCanvas.getContext('2d');
    }

    // Fill with dark fog (sepia-toned to match parchment)
    this.fogCtx.fillStyle = 'rgba(60, 45, 30, 0.85)';
    this.fogCtx.fillRect(0, 0, fogW, fogH);

    // Build node map for quick lookup
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // Cut out discovered areas using destination-out
    this.fogCtx.globalCompositeOperation = 'destination-out';

    // First pass: Draw path reveals with gradient edges (paths should be under node reveals)
    this.fogCtx.lineCap = 'round';
    this.fogCtx.lineJoin = 'round';

    for (const conn of connections) {
      const fromNode = nodeMap.get(conn.from_node_id);
      const toNode = nodeMap.get(conn.to_node_id);

      if (!fromNode || !toNode) continue;

      // Only draw paths where at least one node is visited
      const fromVisited = this.visitedNodes.has(fromNode.id);
      const toVisited = this.visitedNodes.has(toNode.id);

      if (!fromVisited && !toVisited) continue;

      const x1 = (fromNode.x_coord * this.nodeSpacing + cameraX) * scale;
      const y1 = (fromNode.y_coord * this.nodeSpacing + cameraY) * scale;
      const x2 = (toNode.x_coord * this.nodeSpacing + cameraX) * scale;
      const y2 = (toNode.y_coord * this.nodeSpacing + cameraY) * scale;

      // Calculate bezier control point (same algorithm as WorldMapScene)
      const control = this.getPathControlPoint(x1, y1, x2, y2, conn.from_node_id, conn.to_node_id);

      // Both visited: full clear (opacity 1.0)
      // One visited, one unvisited: partial clear (opacity 0.6)
      const bothVisited = fromVisited && toVisited;
      const baseOpacity = bothVisited ? 1.0 : 0.6;
      const baseWidth = (bothVisited ? 44 : 32) * scale; // +25% width

      // Draw multiple passes for gradient edge effect (outer to inner)
      // This creates a soft foggy edge similar to node reveals
      const passes = [
        { widthMult: 2.0, opacityMult: 0.15 },  // Outer soft edge
        { widthMult: 1.5, opacityMult: 0.3 },   // Mid edge
        { widthMult: 1.0, opacityMult: 0.7 },   // Inner edge
        { widthMult: 0.6, opacityMult: 1.0 }    // Core
      ];

      for (const pass of passes) {
        const opacity = baseOpacity * pass.opacityMult;
        this.fogCtx.strokeStyle = `rgba(0, 0, 0, ${opacity})`;
        this.fogCtx.lineWidth = baseWidth * pass.widthMult;
        this.fogCtx.beginPath();
        this.fogCtx.moveTo(x1, y1);
        this.fogCtx.quadraticCurveTo(control.x, control.y, x2, y2);
        this.fogCtx.stroke();
      }
    }

    // Second pass: Draw node reveals
    for (const node of nodes) {
      if (!this.discoveredNodes.has(node.id)) continue;

      const screenX = (node.x_coord * this.nodeSpacing + cameraX) * scale;
      const screenY = (node.y_coord * this.nodeSpacing + cameraY) * scale;
      const visited = this.visitedNodes.has(node.id);

      // Visited: larger radius, full clear
      // Unvisited but discovered: smaller radius, partial clear (lightened fog)
      // +25% radius increase
      const revealRadius = (visited ? 100 : 50) * scale;
      const centerOpacity = visited ? 1.0 : 0.6;
      const edgeOpacity = visited ? 0.8 : 0.4;

      const gradient = this.fogCtx.createRadialGradient(
        screenX, screenY, 0,
        screenX, screenY, revealRadius
      );
      gradient.addColorStop(0, `rgba(0, 0, 0, ${centerOpacity})`);
      gradient.addColorStop(0.5, `rgba(0, 0, 0, ${edgeOpacity})`);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

      this.fogCtx.fillStyle = gradient;
      this.fogCtx.beginPath();
      this.fogCtx.arc(screenX, screenY, revealRadius, 0, Math.PI * 2);
      this.fogCtx.fill();
    }

    this.fogCtx.globalCompositeOperation = 'source-over';

    // Draw fog to main canvas
    ctx.drawImage(this.fogCanvas, 0, 0, canvasWidth, canvasHeight);
  }

  /**
   * Calculate bezier control point for curved path (matches WorldMapScene algorithm)
   */
  getPathControlPoint(x1, y1, x2, y2, fromNodeId, toNodeId) {
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

  /**
   * Layer 6: Node labels (only for visited nodes)
   */
  renderNodeLabels(ctx, cameraX, cameraY, nodes) {
    ctx.font = '11px serif';
    ctx.textAlign = 'center';

    for (const node of nodes) {
      if (!this.visitedNodes.has(node.id)) continue;

      const screenX = node.x_coord * this.nodeSpacing + cameraX;
      const screenY = node.y_coord * this.nodeSpacing + cameraY + 22;

      // Text shadow for readability
      ctx.fillStyle = '#f4e4bc';
      ctx.fillText(node.name, screenX + 1, screenY + 1);

      // Main text
      ctx.fillStyle = '#3d2914';
      ctx.fillText(node.name, screenX, screenY);
    }
  }

  /**
   * Render node glow effect (for selected/hovered nodes)
   */
  renderNodeGlow(ctx, x, y, radius, color, pulse = true) {
    const glowIntensity = pulse
      ? 0.4 + Math.sin(this.glowPhase) * 0.2
      : 0.5;

    const glowRadius = pulse
      ? radius + 5 + Math.sin(this.glowPhase) * 3
      : radius + 5;

    const gradient = ctx.createRadialGradient(x, y, radius * 0.5, x, y, glowRadius);
    gradient.addColorStop(0, this.hexToRgba(color, glowIntensity));
    gradient.addColorStop(0.5, this.hexToRgba(color, glowIntensity * 0.5));
    gradient.addColorStop(1, this.hexToRgba(color, 0));

    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  /**
   * Convert hex to rgba
   */
  hexToRgba(hex, alpha) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return `rgba(255, 255, 255, ${alpha})`;

    const r = parseInt(result[1], 16);
    const g = parseInt(result[2], 16);
    const b = parseInt(result[3], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Legacy methods for compatibility
  calculateBiomeRegions(nodes) {
    this.updateDiscoveryState(nodes);
  }

  renderParticles(ctx) {
    // Simplified - no particles in parchment style
  }

  spawnAmbientParticles(x, y, nodeType) {
    // Disabled for parchment style
  }

  clearParticles() {
    this.particles = [];
  }

  renderTexturedPath(ctx, x1, y1, x2, y2, pathType, controlPoint) {
    // Not used in parchment style, but keep for compatibility
    ctx.strokeStyle = '#5d4e37';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(controlPoint.x, controlPoint.y, x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
