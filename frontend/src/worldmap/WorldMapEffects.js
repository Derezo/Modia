/**
 * WorldMapEffects - Parchment-style world map renderer with fog of war
 * Hand-drawn aesthetic with hatching patterns and discovery mechanics
 */

import { FogOfWarState, renderPolygonReveal, expandPolygon } from './FogOfWarState.js';
import { renderOrganicPath, renderPathReveal } from './PathRenderer.js';

export class WorldMapEffects {
  constructor(assetLoader) {
    this.assetLoader = assetLoader;

    // Parchment texture (procedurally generated)
    this.parchmentTexture = null;

    // Fog of war canvas (offscreen at 1/4 resolution)
    this.fogCanvas = null;
    this.fogCtx = null;

    // Enhanced fog state with polygon detection
    this.fogState = new FogOfWarState();

    // Discovery state (legacy - maintained for backward compatibility)
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

    // Filter nodes by reachability if provided
    // This ensures fog of war only reveals nodes that are actually reachable
    const filteredNodes = reachableNodes
      ? nodes.filter(node => reachableNodes.has(node.id))
      : nodes;

    for (const node of filteredNodes) {
      this.discoveredNodes.add(node.id);
      if (node.visited) {
        this.visitedNodes.add(node.id);
      }
    }

    // Filter connections to only include those between reachable nodes
    const filteredConnections = reachableNodes
      ? connections.filter(conn =>
        reachableNodes.has(conn.from_node_id) && reachableNodes.has(conn.to_node_id)
      )
      : connections;

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
    // DEBUG: Test if solid fill works but pattern doesn't
    ctx.fillStyle = '#f4e4bc';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Temporarily skip pattern fill to test
    // if (!this.parchmentTexture) {
    //   ctx.fillStyle = '#f4e4bc';
    //   ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    //   return;
    // }
    // const pattern = ctx.createPattern(this.parchmentTexture, 'repeat');
    // ctx.fillStyle = pattern;
    // ctx.fillRect(0, 0, canvasWidth, canvasHeight);

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
   * Layer 5: Fog of war overlay
   * - Visited nodes: fully cleared with progressive radius based on neighbors
   * - Unvisited but discovered nodes: lightened fog (visible but dimmed)
   * - Paths between visited nodes: fully cleared (organic curves)
   * - Paths to unvisited adjacent nodes: lightened fog (organic curves)
   * - Polygons formed by visited nodes: filled for enclosed areas
   */
  renderFogOfWar(ctx, cameraX, cameraY, canvasWidth, canvasHeight, nodes, connections = [], watchtowerView = null) {
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

    // First pass: Fill detected polygons (enclosed visited areas)
    const polygons = this.fogState.getPolygons();
    for (const polygon of polygons) {
      // Convert polygon node IDs to screen coordinates
      const vertices = polygon.map(nodeId => {
        const node = nodeMap.get(nodeId);
        if (!node) return null;
        return {
          x: (node.x_coord * this.nodeSpacing + cameraX) * scale,
          y: (node.y_coord * this.nodeSpacing + cameraY) * scale
        };
      }).filter(v => v !== null);

      if (vertices.length >= 3) {
        // Expand polygon slightly for softer edges
        const expanded = expandPolygon(vertices, 8 * scale);
        renderPolygonReveal(this.fogCtx, expanded, 0.9);
      }
    }

    // Second pass: Draw path reveals with gradient edges
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

      // Both visited: full clear (opacity 1.0)
      // One visited, one unvisited: partial clear (opacity 0.6)
      const bothVisited = fromVisited && toVisited;
      const baseOpacity = bothVisited ? 1.0 : 0.6;
      const baseWidth = (bothVisited ? 44 : 32) * scale;

      if (this.useOrganicPaths) {
        // Use organic path reveal with Catmull-Rom splines
        // Pass scale factor so curves are generated at full scale then scaled down
        renderPathReveal(
          this.fogCtx,
          x1, y1, x2, y2,
          conn.from_node_id, conn.to_node_id,
          baseWidth,
          baseOpacity,
          scale
        );
      } else {
        // Legacy: bezier curve reveal
        const control = this.getPathControlPoint(x1, y1, x2, y2, conn.from_node_id, conn.to_node_id);

        const passes = [
          { widthMult: 2.0, opacityMult: 0.15 },
          { widthMult: 1.5, opacityMult: 0.3 },
          { widthMult: 1.0, opacityMult: 0.7 },
          { widthMult: 0.6, opacityMult: 1.0 }
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
    }

    // Third pass: Draw node reveals with progressive radii
    for (const node of nodes) {
      if (!this.discoveredNodes.has(node.id)) continue;

      const screenX = (node.x_coord * this.nodeSpacing + cameraX) * scale;
      const screenY = (node.y_coord * this.nodeSpacing + cameraY) * scale;
      const visited = this.visitedNodes.has(node.id);

      // Use progressive reveal radius from fog state
      const baseRevealRadius = this.fogState.getRevealRadius(node.id);
      const revealRadius = baseRevealRadius * scale;

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

    // Fourth pass: Watchtower reveal - large circular area centered on watchtower
    if (watchtowerView && watchtowerView.watchtowerNode) {
      const wtNode = watchtowerView.watchtowerNode;
      const wtScreenX = (wtNode.x_coord * this.nodeSpacing + cameraX) * scale;
      const wtScreenY = (wtNode.y_coord * this.nodeSpacing + cameraY) * scale;

      // Use dynamic reveal radius from API (default 1500px if not set)
      const watchtowerRevealRadius = (watchtowerView.revealRadiusPixels || 1500) * scale;

      // Create soft-edged radial gradient for watchtower reveal
      const wtGradient = this.fogCtx.createRadialGradient(
        wtScreenX, wtScreenY, 0,
        wtScreenX, wtScreenY, watchtowerRevealRadius
      );
      // Full clear in center, fading to transparent at edges
      wtGradient.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
      wtGradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.7)');
      wtGradient.addColorStop(0.85, 'rgba(0, 0, 0, 0.3)');
      wtGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

      this.fogCtx.fillStyle = wtGradient;
      this.fogCtx.beginPath();
      this.fogCtx.arc(wtScreenX, wtScreenY, watchtowerRevealRadius, 0, Math.PI * 2);
      this.fogCtx.fill();

      // Fifth pass: Individual fog clearing for revealed (but not discovered) nodes
      // This creates additional "spot reveals" at each node location
      const revealedNodes = watchtowerView.revealedNodes || [];
      for (const revNode of revealedNodes) {
        // Skip nodes already in discovered set (they have their own reveals in third pass)
        if (this.discoveredNodes.has(revNode.id)) continue;

        const nodeScreenX = (revNode.x_coord * this.nodeSpacing + cameraX) * scale;
        const nodeScreenY = (revNode.y_coord * this.nodeSpacing + cameraY) * scale;

        // Calculate opacity based on distance from watchtower (closer = clearer)
        const distancePixels = revNode.distance_from_watchtower || 0;
        const maxDistance = watchtowerView.revealRadiusPixels || 1500;
        const distanceRatio = Math.min(distancePixels / maxDistance, 1.0);
        // Opacity fades from 0.7 (near) to 0.3 (far)
        const nodeOpacity = 0.7 - (distanceRatio * 0.4);

        // Small reveal radius for individual nodes (40-60px scaled)
        const nodeRevealRadius = 50 * scale;

        const nodeGradient = this.fogCtx.createRadialGradient(
          nodeScreenX, nodeScreenY, 0,
          nodeScreenX, nodeScreenY, nodeRevealRadius
        );
        nodeGradient.addColorStop(0, `rgba(0, 0, 0, ${nodeOpacity})`);
        nodeGradient.addColorStop(0.6, `rgba(0, 0, 0, ${nodeOpacity * 0.6})`);
        nodeGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

        this.fogCtx.fillStyle = nodeGradient;
        this.fogCtx.beginPath();
        this.fogCtx.arc(nodeScreenX, nodeScreenY, nodeRevealRadius, 0, Math.PI * 2);
        this.fogCtx.fill();
      }

      // Sixth pass: Revealed connections between watchtower-revealed nodes
      const revealedConnections = watchtowerView.revealedConnections || [];
      const revealedNodeMap = new Map(revealedNodes.map(n => [n.id, n]));

      for (const conn of revealedConnections) {
        const fromNode = revealedNodeMap.get(conn.from_node_id);
        const toNode = revealedNodeMap.get(conn.to_node_id);

        if (!fromNode || !toNode) continue;

        // Skip connections where both nodes are already discovered (handled in second pass)
        const fromDiscovered = this.discoveredNodes.has(fromNode.id);
        const toDiscovered = this.discoveredNodes.has(toNode.id);
        if (fromDiscovered && toDiscovered) continue;

        const x1 = (fromNode.x_coord * this.nodeSpacing + cameraX) * scale;
        const y1 = (fromNode.y_coord * this.nodeSpacing + cameraY) * scale;
        const x2 = (toNode.x_coord * this.nodeSpacing + cameraX) * scale;
        const y2 = (toNode.y_coord * this.nodeSpacing + cameraY) * scale;

        // Render at 50% opacity for watchtower-revealed connections
        const baseOpacity = 0.5;
        const baseWidth = 28 * scale;

        if (this.useOrganicPaths) {
          renderPathReveal(
            this.fogCtx,
            x1, y1, x2, y2,
            conn.from_node_id, conn.to_node_id,
            baseWidth,
            baseOpacity,
            scale
          );
        } else {
          // Legacy: bezier curve reveal
          const control = this.getPathControlPoint(x1, y1, x2, y2, conn.from_node_id, conn.to_node_id);
          this.fogCtx.strokeStyle = `rgba(0, 0, 0, ${baseOpacity})`;
          this.fogCtx.lineWidth = baseWidth;
          this.fogCtx.beginPath();
          this.fogCtx.moveTo(x1, y1);
          this.fogCtx.quadraticCurveTo(control.x, control.y, x2, y2);
          this.fogCtx.stroke();
        }
      }
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
