/**
 * WorldMapEffects - Parchment-style world map renderer
 * Hand-drawn aesthetic with hatching patterns and discovery mechanics
 *
 * Note: Fog of war rendering has been moved to DOMFogOverlay.js for reliability.
 * This class still maintains discovery state for use by DOMFogOverlay and minimap.
 */

import { FogOfWarState } from './FogOfWarState.js';
import { renderOrganicPath } from './PathRenderer.js';

export class WorldMapEffects {
  constructor(assetLoader) {
    this.assetLoader = assetLoader;

    // Parchment texture (procedurally generated)
    this.parchmentTexture = null;

    // Enhanced fog state with polygon detection (used by DOMFogOverlay)
    this.fogState = new FogOfWarState();

    // Discovery state (used by DOMFogOverlay and minimap)
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

    // Use organic paths (Catmull-Rom splines)
    this.useOrganicPaths = true;
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
   * @param {Array} nodes - Array of node objects
   * @param {Array} connections - Array of connection objects (optional, for polygon detection)
   * @param {Set} reachableNodes - Set of reachable node IDs (optional, for filtering fog of war)
   */
  updateDiscoveryState(nodes, connections = [], reachableNodes = null) {
    this.discoveredNodes.clear();
    this.visitedNodes.clear();

    // Build visited set first (always valid - these are nodes player has traveled to)
    for (const node of nodes) {
      if (node.visited) {
        this.visitedNodes.add(node.id);
      }
    }

    // Try filtered approach first
    let filteredNodes = reachableNodes
      ? nodes.filter(node => reachableNodes.has(node.id))
      : nodes;

    // FALLBACK 1: If filtering produced empty result, use nodes with discovery data
    if (filteredNodes.length === 0 && nodes.length > 0) {
      console.warn('[WorldMapEffects] Empty reachableNodes filter, using discovery-based fallback');
      filteredNodes = nodes.filter(node => node.visited || node.discovery_method);
    }

    // FALLBACK 2: If still empty, use visited nodes only
    if (filteredNodes.length === 0 && this.visitedNodes.size > 0) {
      console.warn('[WorldMapEffects] No discovered nodes, falling back to visited nodes');
      filteredNodes = nodes.filter(node => this.visitedNodes.has(node.id));
    }

    // FALLBACK 3: Emergency - show ALL nodes to prevent blank map
    if (filteredNodes.length === 0 && nodes.length > 0) {
      console.warn('[WorldMapEffects] Emergency fallback: showing all nodes');
      filteredNodes = nodes;
    }

    for (const node of filteredNodes) {
      this.discoveredNodes.add(node.id);
    }

    // Filter connections to only include those between discovered nodes
    const filteredConnections = connections.filter(conn =>
      this.discoveredNodes.has(conn.from_node_id) && this.discoveredNodes.has(conn.to_node_id)
    );

    // Update enhanced fog state with polygon detection
    this.fogState.updateFromNodes(filteredNodes, filteredConnections);
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
   * Main render function - 7 layer system
   */
  render(ctx, cameraX, cameraY, canvasWidth, canvasHeight, nodes, connections, obstacles = []) {
    // Layer 1: Parchment background
    this.renderParchmentBackground(ctx, canvasWidth, canvasHeight);

    // Layer 2: Terrain obstacles (lakes, mountains, forests)
    this.renderObstacles(ctx, cameraX, cameraY, obstacles);

    // Layer 3: Region illustrations (hatching patterns)
    this.renderRegionIllustrations(ctx, cameraX, cameraY, nodes);

    // Layer 4: Paths as hand-drawn lines
    this.renderHandDrawnPaths(ctx, cameraX, cameraY, connections, nodes);

    // Layer 5: Node markers
    this.renderNodeMarkers(ctx, cameraX, cameraY, nodes);

    // Layer 6: Fog of war overlay
    this.renderFogOfWar(ctx, cameraX, cameraY, canvasWidth, canvasHeight, nodes);

    // Layer 7: Labels for visited nodes
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
    // Fill with parchment texture pattern
    if (!this.parchmentTexture) {
      ctx.fillStyle = '#f4e4bc';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    } else {
      const pattern = ctx.createPattern(this.parchmentTexture, 'repeat');
      // Guard: createPattern can return null if source has 0 dimensions
      if (pattern) {
        ctx.fillStyle = pattern;
      } else {
        ctx.fillStyle = '#f4e4bc'; // Fallback to solid color
      }
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }

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
   * Layer 2: Render terrain obstacles (lakes, mountains, dense forests)
   * Hand-drawn parchment aesthetic
   */
  renderObstacles(ctx, cameraX, cameraY, obstacles) {
    if (!obstacles || obstacles.length === 0) return;

    for (const obs of obstacles) {
      const screenX = obs.x * this.nodeSpacing + cameraX;
      const screenY = obs.y * this.nodeSpacing + cameraY;

      // Use obstacle ID or world coordinates for consistent random seed (prevents jitter)
      const obstacleSeed = obs.id || Math.floor(obs.x * 1000 + obs.y);

      ctx.save();

      switch (obs.obstacle_type) {
        case 'lake':
          this.renderLake(ctx, screenX, screenY, obs.radius * this.nodeSpacing, obstacleSeed);
          break;
        case 'mountain_range':
          this.renderMountainRange(ctx, screenX, screenY, obs.length * this.nodeSpacing, obs.angle, obstacleSeed);
          break;
        case 'dense_forest':
          this.renderDenseForest(ctx, screenX, screenY, obs.radius * this.nodeSpacing, obstacleSeed);
          break;
      }

      ctx.restore();
    }
  }

  /**
   * Render a lake obstacle with hand-drawn style
   * @param {number} seed - Consistent seed for random generation (prevents jitter)
   */
  renderLake(ctx, x, y, radius, seed) {
    // Water fill with gradient
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(100, 149, 237, 0.4)');  // Cornflower blue center
    gradient.addColorStop(0.7, 'rgba(70, 130, 180, 0.35)');  // Steel blue
    gradient.addColorStop(1, 'rgba(70, 130, 180, 0.1)');  // Fade at edges

    ctx.beginPath();
    // Draw slightly irregular circle for organic feel
    const rng = this.seededRandom(seed);
    const points = 20;
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const wobble = 1 + (rng() - 0.5) * 0.15;
      const px = x + Math.cos(angle) * radius * wobble;
      const py = y + Math.sin(angle) * radius * wobble;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    ctx.fillStyle = gradient;
    ctx.fill();

    // Hand-drawn edge
    ctx.strokeStyle = 'rgba(70, 100, 140, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Wave lines for water effect
    ctx.strokeStyle = 'rgba(70, 130, 180, 0.3)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const waveY = y - radius * 0.3 + i * radius * 0.3;
      const waveWidth = radius * 0.6;
      ctx.beginPath();
      ctx.moveTo(x - waveWidth, waveY);
      ctx.bezierCurveTo(
        x - waveWidth * 0.3, waveY - 5,
        x + waveWidth * 0.3, waveY + 5,
        x + waveWidth, waveY
      );
      ctx.stroke();
    }
  }

  /**
   * Render a mountain range obstacle with hand-drawn style
   * @param {number} seed - Consistent seed for random generation (prevents jitter)
   */
  renderMountainRange(ctx, x, y, length, angle, seed) {
    ctx.translate(x, y);
    ctx.rotate(angle);

    const halfLength = length / 2;
    const peakHeight = length * 0.2;
    const numPeaks = Math.floor(length / 30) + 2;

    // Draw mountain silhouette
    ctx.beginPath();
    ctx.moveTo(-halfLength, 0);

    const rng = this.seededRandom(seed);
    for (let i = 0; i <= numPeaks; i++) {
      const peakX = -halfLength + (i / numPeaks) * length;
      const peakY = -peakHeight * (0.6 + rng() * 0.4);

      if (i < numPeaks) {
        // Peak
        ctx.lineTo(peakX, peakY);
        // Valley
        const valleyX = peakX + length / numPeaks * 0.5;
        ctx.lineTo(valleyX, -peakHeight * 0.2 * rng());
      }
    }
    ctx.lineTo(halfLength, 0);
    ctx.closePath();

    // Mountain fill
    const gradient = ctx.createLinearGradient(0, -peakHeight, 0, 0);
    gradient.addColorStop(0, 'rgba(128, 128, 128, 0.4)');  // Gray at peaks
    gradient.addColorStop(0.3, 'rgba(139, 119, 101, 0.35)');  // Brown-gray
    gradient.addColorStop(1, 'rgba(139, 119, 101, 0.1)');  // Fade at base

    ctx.fillStyle = gradient;
    ctx.fill();

    // Hand-drawn outline
    ctx.strokeStyle = 'rgba(100, 80, 60, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Snow caps on peaks
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    for (let i = 0; i < numPeaks; i++) {
      const peakX = -halfLength + ((i + 0.5) / numPeaks) * length;
      ctx.beginPath();
      ctx.arc(peakX, -peakHeight * 0.7, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Render a dense forest obstacle with hand-drawn style
   * @param {number} seed - Consistent seed for random generation (prevents jitter)
   */
  renderDenseForest(ctx, x, y, radius, seed) {
    const rng = this.seededRandom(seed);

    // Dark forest fill
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(34, 85, 34, 0.45)');  // Dark green center
    gradient.addColorStop(0.6, 'rgba(46, 100, 46, 0.35)');
    gradient.addColorStop(1, 'rgba(46, 100, 46, 0.1)');  // Fade at edges

    ctx.beginPath();
    // Irregular shape
    const points = 16;
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const wobble = 1 + (rng() - 0.5) * 0.2;
      const px = x + Math.cos(angle) * radius * wobble;
      const py = y + Math.sin(angle) * radius * wobble;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    ctx.fillStyle = gradient;
    ctx.fill();

    // Tree symbols (simplified triangles)
    ctx.fillStyle = 'rgba(34, 70, 34, 0.4)';
    const numTrees = Math.floor(radius / 15) + 3;
    for (let i = 0; i < numTrees; i++) {
      const treeAngle = rng() * Math.PI * 2;
      const treeDist = rng() * radius * 0.7;
      const treeX = x + Math.cos(treeAngle) * treeDist;
      const treeY = y + Math.sin(treeAngle) * treeDist;
      const treeSize = 8 + rng() * 6;

      ctx.beginPath();
      ctx.moveTo(treeX, treeY - treeSize);
      ctx.lineTo(treeX - treeSize * 0.5, treeY + treeSize * 0.3);
      ctx.lineTo(treeX + treeSize * 0.5, treeY + treeSize * 0.3);
      ctx.closePath();
      ctx.fill();
    }

    // Dashed border
    ctx.strokeStyle = 'rgba(34, 70, 34, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * Layer 3: Region illustrations using hatching patterns
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
   * Layer 3: Hand-drawn style paths using Catmull-Rom splines
   */
  renderHandDrawnPaths(ctx, cameraX, cameraY, connections, nodes) {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

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

      // Check if both nodes are visited for styling
      const bothVisited = this.visitedNodes.has(fromNode.id) && this.visitedNodes.has(toNode.id);

      if (this.useOrganicPaths) {
        // Use Catmull-Rom spline for organic curves
        renderOrganicPath(ctx, x1, y1, x2, y2, fromNode.id, toNode.id, {
          color: bothVisited ? '#5d4e37' : 'rgba(93, 78, 55, 0.6)',
          width: bothVisited ? 2 : 1.5,
          dashed: !bothVisited,
          shadowColor: 'rgba(0, 0, 0, 0.2)',
          shadowOffset: 1
        });
      } else {
        // Legacy: wavy line for hand-drawn effect
        ctx.strokeStyle = bothVisited ? '#5d4e37' : 'rgba(93, 78, 55, 0.6)';
        ctx.lineWidth = bothVisited ? 2 : 1.5;
        ctx.setLineDash(bothVisited ? [] : [5, 5]);

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
        ctx.setLineDash([]);
      }
    }
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
   * Layer 5: Node labels (only for visited nodes)
   *
   * Note: Fog of war rendering moved to DOMFogOverlay.js
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

  renderParticles(_ctx) {
    // Simplified - no particles in parchment style
  }

  spawnAmbientParticles(_x, _y, _nodeType) {
    // Disabled for parchment style
  }

  clearParticles() {
    this.particles = [];
  }

  renderTexturedPath(ctx, x1, y1, x2, y2, pathType, controlPoint, fromNodeId = 0, toNodeId = 0) {
    // Use organic path rendering if enabled and node IDs provided
    if (this.useOrganicPaths && fromNodeId && toNodeId) {
      const style = this.getPathTypeStyle(pathType);
      renderOrganicPath(ctx, x1, y1, x2, y2, fromNodeId, toNodeId, style);

      // Add subtle river/canyon visual hint for bridge paths
      if (pathType === 'bridge') {
        this.renderBridgeWaterHint(ctx, x1, y1, x2, y2);
      }
    } else {
      // Fallback to bezier curve (with proper state isolation)
      ctx.save();
      ctx.strokeStyle = '#5d4e37';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(controlPoint.x, controlPoint.y, x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  /**
   * Render a subtle water/canyon hint at bridge connection midpoint
   * Creates an implied river or canyon that the bridge crosses
   */
  renderBridgeWaterHint(ctx, x1, y1, x2, y2) {
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    // Calculate perpendicular direction for the "river"
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length < 1) return;

    // Perpendicular unit vector
    const perpX = -dy / length;
    const perpY = dx / length;

    // Draw subtle water shimmer perpendicular to the path
    ctx.save();
    ctx.globalAlpha = 0.15;

    // River/canyon line (perpendicular to bridge)
    const riverLength = 25;
    const riverX1 = midX + perpX * riverLength;
    const riverY1 = midY + perpY * riverLength;
    const riverX2 = midX - perpX * riverLength;
    const riverY2 = midY - perpY * riverLength;

    // Draw soft water line
    ctx.beginPath();
    ctx.moveTo(riverX1, riverY1);
    ctx.lineTo(riverX2, riverY2);
    ctx.strokeStyle = '#4a7c9b';  // Soft blue-grey for water
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Add subtle wave pattern
    ctx.globalAlpha = 0.1;
    ctx.strokeStyle = '#6a9cbb';
    ctx.lineWidth = 4;
    ctx.setLineDash([3, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  }

  /**
   * Get style configuration for path type
   */
  getPathTypeStyle(pathType) {
    const styles = {
      road: { color: '#5d4e37', width: 2, dashed: false },
      trail: { color: '#3a5a3a', width: 1.5, dashed: true },
      bridge: { color: '#8b7355', width: 3, dashed: false },
      tunnel: { color: '#2a2a3a', width: 2, dashed: true }
    };
    return styles[pathType] || styles.road;
  }
}
