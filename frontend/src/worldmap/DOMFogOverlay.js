/**
 * DOMFogOverlay - DOM-based SVG mask overlay for fog of war rendering
 *
 * Replaces canvas-based fog rendering with a more reliable DOM/SVG approach
 * that doesn't suffer from canvas context loss under memory pressure.
 *
 * The overlay positions itself to exactly match the game canvas position and
 * uses an SVG viewBox matching the canvas logical dimensions.
 *
 * @see FogOfWarState.js - Provides reveal radii and polygon detection
 */

import { generateSVGPathData } from './PathRenderer.js';

export class DOMFogOverlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.overlayDiv = null;
    this.svgElement = null;
    this.maskElement = null;
    this.fogRect = null;

    // State tracking
    this.discoveredNodes = new Set();
    this.visitedNodes = new Set();
    this.nodePositions = new Map();  // nodeId -> {x, y, radius}
    this.connectionData = [];         // Array of {from, to, visited}

    // Camera state
    this.cameraX = 0;
    this.cameraY = 0;
    this.nodeSpacing = 60;

    // Canvas dimensions (logical size)
    this.canvasWidth = 1280;
    this.canvasHeight = 720;

    // Minimap cutout dimensions (matches WorldMapMinimap)
    this.minimapSize = 150;
    this.minimapMargin = 10;
    this.minimapFrameWidth = 4;

    // Health check state
    this.healthCheckCounter = 0;
    this.healthCheckInterval = 60; // Check every 60 frames

    // Debug mode
    this.debugMode = new URLSearchParams(window.location.search).get('fogDebug') === 'true';

    // Unique ID for SVG elements
    this.maskId = `fog-mask-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    // Resize observer
    this.resizeObserver = null;
  }

  /**
   * Initialize DOM elements
   */
  init() {
    // Get canvas dimensions
    this.canvasWidth = this.canvas.width;
    this.canvasHeight = this.canvas.height;

    // Create overlay container div - will be positioned to match canvas
    this.overlayDiv = document.createElement('div');
    this.overlayDiv.className = 'fog-overlay';
    this.overlayDiv.style.cssText = `
      position: absolute;
      pointer-events: none;
      overflow: hidden;
    `;

    // Position to match canvas
    this.updateOverlayPosition();

    if (this.debugMode) {
      this.overlayDiv.style.border = '3px solid red';
      console.log('[DOMFogOverlay] Debug mode enabled');
    }

    // Create SVG element with viewBox matching canvas logical dimensions
    this.svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svgElement.setAttribute('viewBox', `0 0 ${this.canvasWidth} ${this.canvasHeight}`);
    this.svgElement.setAttribute('preserveAspectRatio', 'none');
    this.svgElement.style.cssText = `
      width: 100%;
      height: 100%;
      display: block;
    `;

    // Create defs for mask and filter
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    // Create blur filter for soft edges
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', `${this.maskId}-blur`);
    const feGaussianBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
    feGaussianBlur.setAttribute('stdDeviation', '8');
    filter.appendChild(feGaussianBlur);
    defs.appendChild(filter);

    // Create mask element
    this.maskElement = document.createElementNS('http://www.w3.org/2000/svg', 'mask');
    this.maskElement.setAttribute('id', this.maskId);

    // White background (fog everywhere)
    const maskBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    maskBg.setAttribute('x', '0');
    maskBg.setAttribute('y', '0');
    maskBg.setAttribute('width', String(this.canvasWidth));
    maskBg.setAttribute('height', String(this.canvasHeight));
    maskBg.setAttribute('fill', 'white');
    this.maskElement.appendChild(maskBg);

    // Container group for reveal elements (will be populated dynamically)
    this.revealsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.revealsGroup.setAttribute('class', 'fog-reveals');
    this.revealsGroup.setAttribute('filter', `url(#${this.maskId}-blur)`);
    this.maskElement.appendChild(this.revealsGroup);

    // Minimap cutout - black rectangle to always show minimap through fog
    this.minimapCutout = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    this.updateMinimapCutout();
    this.maskElement.appendChild(this.minimapCutout);

    defs.appendChild(this.maskElement);
    this.svgElement.appendChild(defs);

    // Create the fog rectangle that uses the mask
    this.fogRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    this.fogRect.setAttribute('x', '0');
    this.fogRect.setAttribute('y', '0');
    this.fogRect.setAttribute('width', String(this.canvasWidth));
    this.fogRect.setAttribute('height', String(this.canvasHeight));
    this.fogRect.setAttribute('fill', 'rgba(60, 45, 30, 0.85)'); // Dark sepia fog
    this.fogRect.setAttribute('mask', `url(#${this.maskId})`);

    if (this.debugMode) {
      this.fogRect.setAttribute('fill', 'rgba(60, 45, 30, 0.5)'); // 50% opacity for debug
    }

    this.svgElement.appendChild(this.fogRect);
    this.overlayDiv.appendChild(this.svgElement);

    // Insert into container (parent of canvas)
    this.canvas.parentElement.appendChild(this.overlayDiv);

    // Set up resize observer to keep overlay aligned with canvas
    this.resizeObserver = new ResizeObserver(() => {
      this.updateOverlayPosition();
    });
    this.resizeObserver.observe(this.canvas);

    if (this.debugMode) {
      console.log('[DOMFogOverlay] Initialized with canvas dimensions:', this.canvasWidth, 'x', this.canvasHeight);
    }
  }

  /**
   * Update overlay position to match canvas
   */
  updateOverlayPosition() {
    if (!this.overlayDiv || !this.canvas) return;

    // Get canvas position relative to its parent container
    const canvasRect = this.canvas.getBoundingClientRect();
    const containerRect = this.canvas.parentElement.getBoundingClientRect();

    // Calculate offset from container
    const offsetX = canvasRect.left - containerRect.left;
    const offsetY = canvasRect.top - containerRect.top;

    // Match canvas CSS dimensions and position
    this.overlayDiv.style.left = `${offsetX}px`;
    this.overlayDiv.style.top = `${offsetY}px`;
    this.overlayDiv.style.width = `${canvasRect.width}px`;
    this.overlayDiv.style.height = `${canvasRect.height}px`;

    if (this.debugMode) {
      console.log('[DOMFogOverlay] Position updated:', {
        offset: { x: offsetX, y: offsetY },
        size: { width: canvasRect.width, height: canvasRect.height }
      });
    }
  }

  /**
   * Update minimap cutout position
   */
  updateMinimapCutout() {
    if (!this.minimapCutout) return;

    const totalSize = this.minimapSize + this.minimapFrameWidth * 2;
    const cutoutX = this.canvasWidth - totalSize - this.minimapMargin;
    const cutoutY = this.canvasHeight - totalSize - this.minimapMargin;

    this.minimapCutout.setAttribute('x', String(cutoutX));
    this.minimapCutout.setAttribute('y', String(cutoutY));
    this.minimapCutout.setAttribute('width', String(totalSize));
    this.minimapCutout.setAttribute('height', String(totalSize));
    this.minimapCutout.setAttribute('fill', 'black'); // Black = transparent in mask
  }

  /**
   * Update discovery state from node and connection data
   * @param {Array} nodes - Array of node objects
   * @param {Array} connections - Array of connection objects
   * @param {Set} discoveredNodes - Set of discovered node IDs
   * @param {Set} visitedNodes - Set of visited node IDs
   * @param {Object} fogState - FogOfWarState instance with reveal radii
   */
  updateDiscoveryState(nodes, connections, discoveredNodes, visitedNodes, fogState) {
    this.discoveredNodes = discoveredNodes;
    this.visitedNodes = visitedNodes;

    // Build node positions map
    this.nodePositions.clear();
    for (const node of nodes) {
      if (discoveredNodes.has(node.id)) {
        const radius = fogState ? fogState.getRevealRadius(node.id) : 80;
        this.nodePositions.set(node.id, {
          x: node.x_coord,
          y: node.y_coord,
          radius: radius,
          visited: visitedNodes.has(node.id)
        });
      }
    }

    // Build connection data
    this.connectionData = [];
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    for (const conn of connections) {
      const fromNode = nodeMap.get(conn.from_node_id);
      const toNode = nodeMap.get(conn.to_node_id);

      if (!fromNode || !toNode) continue;

      const fromVisited = visitedNodes.has(fromNode.id);
      const toVisited = visitedNodes.has(toNode.id);

      // Only include connections where at least one node is visited
      if (!fromVisited && !toVisited) continue;

      this.connectionData.push({
        from: { x: fromNode.x_coord, y: fromNode.y_coord, id: fromNode.id },
        to: { x: toNode.x_coord, y: toNode.y_coord, id: toNode.id },
        bothVisited: fromVisited && toVisited
      });
    }

    // Rebuild SVG reveals
    this.rebuildReveals();

    if (this.debugMode) {
      console.log('[DOMFogOverlay] Discovery state updated:', {
        discovered: discoveredNodes.size,
        visited: visitedNodes.size,
        connections: this.connectionData.length
      });
    }
  }

  /**
   * Rebuild SVG mask reveals based on current state
   */
  rebuildReveals() {
    if (!this.revealsGroup) return;

    // Clear existing reveals (but keep any gradients in defs)
    while (this.revealsGroup.firstChild) {
      this.revealsGroup.removeChild(this.revealsGroup.firstChild);
    }

    // Clean up old gradients
    const defs = this.svgElement.querySelector('defs');
    const oldGradients = defs.querySelectorAll('radialGradient');
    oldGradients.forEach(g => g.remove());

    // Add connection reveals (paths between nodes)
    // Uses Catmull-Rom splines to match the visible path rendering in PathRenderer
    for (const conn of this.connectionData) {
      const x1 = conn.from.x * this.nodeSpacing;
      const y1 = conn.from.y * this.nodeSpacing;
      const x2 = conn.to.x * this.nodeSpacing;
      const y2 = conn.to.y * this.nodeSpacing;

      const pathWidth = conn.bothVisited ? 44 : 32;
      const opacity = conn.bothVisited ? 1.0 : 0.6;

      // Generate SVG path data using Catmull-Rom splines (matches visible paths)
      const pathData = generateSVGPathData(x1, y1, x2, y2, conn.from.id, conn.to.id);

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData);
      path.setAttribute('stroke', `rgba(0, 0, 0, ${opacity})`);
      path.setAttribute('stroke-width', String(pathWidth));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('fill', 'none');

      this.revealsGroup.appendChild(path);
    }

    // Add node reveals (circles with gradients)
    for (const [nodeId, nodeData] of this.nodePositions) {
      const x = nodeData.x * this.nodeSpacing;
      const y = nodeData.y * this.nodeSpacing;
      const radius = nodeData.radius;
      const opacity = nodeData.visited ? 1.0 : 0.6;

      // Create radial gradient for soft edges
      const gradientId = `reveal-gradient-${this.maskId}-${nodeId}`;
      const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
      gradient.setAttribute('id', gradientId);

      const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop1.setAttribute('offset', '0%');
      stop1.setAttribute('stop-color', 'black');
      stop1.setAttribute('stop-opacity', String(opacity));

      const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop2.setAttribute('offset', '50%');
      stop2.setAttribute('stop-color', 'black');
      stop2.setAttribute('stop-opacity', String(opacity * 0.7));

      const stop3 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      stop3.setAttribute('offset', '100%');
      stop3.setAttribute('stop-color', 'black');
      stop3.setAttribute('stop-opacity', '0');

      gradient.appendChild(stop1);
      gradient.appendChild(stop2);
      gradient.appendChild(stop3);

      // Add gradient to defs
      defs.appendChild(gradient);

      // Create circle using gradient
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(x));
      circle.setAttribute('cy', String(y));
      circle.setAttribute('r', String(radius));
      circle.setAttribute('fill', `url(#${gradientId})`);

      this.revealsGroup.appendChild(circle);
    }
  }

  /**
   * Update camera position - transforms the reveals group
   * @param {number} cameraX - Camera X offset
   * @param {number} cameraY - Camera Y offset
   */
  updateCamera(cameraX, cameraY) {
    this.cameraX = cameraX;
    this.cameraY = cameraY;

    if (this.revealsGroup) {
      this.revealsGroup.setAttribute('transform', `translate(${cameraX}, ${cameraY})`);
    }

    // Periodic health check
    this.healthCheckCounter++;
    if (this.healthCheckCounter >= this.healthCheckInterval) {
      this.healthCheckCounter = 0;
      this.validateHealth();
    }
  }

  /**
   * Validate DOM element health and reinitialize if needed
   */
  validateHealth() {
    // Check if overlay is still connected to DOM
    if (!this.overlayDiv || !this.overlayDiv.isConnected) {
      console.warn('[DOMFogOverlay] Overlay detached from DOM, reinitializing...');
      this.destroy();
      this.init();
      this.rebuildReveals();
      return false;
    }

    // Check if SVG is still valid
    if (!this.svgElement || !this.svgElement.isConnected) {
      console.warn('[DOMFogOverlay] SVG element invalid, reinitializing...');
      this.destroy();
      this.init();
      this.rebuildReveals();
      return false;
    }

    return true;
  }

  /**
   * Set node spacing (world units to pixels)
   * @param {number} spacing - Pixels per world unit
   */
  setNodeSpacing(spacing) {
    if (this.nodeSpacing !== spacing) {
      this.nodeSpacing = spacing;
      this.rebuildReveals();
    }
  }

  /**
   * Update canvas dimensions if they change
   * @param {number} width - Canvas logical width
   * @param {number} height - Canvas logical height
   */
  setCanvasDimensions(width, height) {
    if (this.canvasWidth !== width || this.canvasHeight !== height) {
      this.canvasWidth = width;
      this.canvasHeight = height;

      // Update SVG viewBox
      if (this.svgElement) {
        this.svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`);
      }

      // Update fog rect
      if (this.fogRect) {
        this.fogRect.setAttribute('width', String(width));
        this.fogRect.setAttribute('height', String(height));
      }

      // Update mask background
      const maskBg = this.maskElement?.querySelector('rect');
      if (maskBg) {
        maskBg.setAttribute('width', String(width));
        maskBg.setAttribute('height', String(height));
      }

      // Update minimap cutout
      this.updateMinimapCutout();

      // Update overlay position
      this.updateOverlayPosition();
    }
  }

  /**
   * Cleanup DOM elements
   */
  destroy() {
    // Stop observing
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.overlayDiv && this.overlayDiv.parentNode) {
      this.overlayDiv.parentNode.removeChild(this.overlayDiv);
    }

    this.overlayDiv = null;
    this.svgElement = null;
    this.maskElement = null;
    this.revealsGroup = null;
    this.fogRect = null;
    this.minimapCutout = null;

    if (this.debugMode) {
      console.log('[DOMFogOverlay] Destroyed');
    }
  }
}
