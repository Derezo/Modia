/**
 * Handles input events for the world map (mouse, touch, wheel)
 * Manages dragging, clicking, and touch interactions
 */
export class WorldMapInputHandler {
  /**
   * @param {Object} scene - WorldMapScene instance
   */
  constructor(scene) {
    this.scene = scene;
    this.abortController = null;
  }

  /**
   * Setup all input handlers for the world map
   * Call this in scene.enter()
   */
  setup() {
    const canvas = this.scene.game.canvas;

    // Create abort controller for cleanup
    this.abortController = new AbortController();
    const opts = { signal: this.abortController.signal };

    canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e), opts);
    canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e), opts);
    canvas.addEventListener('mouseup', () => this.handleMouseUp(), opts);
    canvas.addEventListener('click', () => this.handleClick(), opts);
    canvas.addEventListener('wheel', (e) => this.handleWheel(e), opts);

    // Mobile touch support
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchMoved = false;

    canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), opts);
    canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), opts);
    canvas.addEventListener('touchend', () => this.handleTouchEnd(), opts);
  }

  /**
   * Cleanup input handlers
   * Call this in scene.exit()
   */
  destroy() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  handleMouseDown(e) {
    this.scene.dragging = true;
    this.scene.dragStartX = e.clientX;
    this.scene.dragStartY = e.clientY;
  }

  handleMouseMove(e) {
    const scene = this.scene;

    if (scene.dragging) {
      const dx = e.clientX - scene.dragStartX;
      const dy = e.clientY - scene.dragStartY;
      scene.cameraX += dx / scene.game.scale;
      scene.cameraY += dy / scene.game.scale;
      scene.dragStartX = e.clientX;
      scene.dragStartY = e.clientY;
    }

    // Update hovered node
    const pos = scene.game.input.getPointerPosition();
    const newHoveredNode = scene.getNodeAtPosition(pos.x, pos.y);

    // If hovered node changed, update path preview and tooltip
    if (newHoveredNode?.id !== scene.hoveredNode?.id) {
      scene.hoveredNode = newHoveredNode;
      scene.pathSystem.updatePathPreview(newHoveredNode);
      scene.updateHoverTooltip(newHoveredNode);
    }
  }

  handleMouseUp() {
    this.scene.dragging = false;
  }

  handleClick() {
    const scene = this.scene;
    const pos = scene.game.input.getPointerPosition();

    // Check HUD panel click first (handles zodiac and other elements)
    if (scene.hudPanel && scene.hudPanel.handleClick(pos.x, pos.y)) {
      return;
    }

    // Check minimap click
    if (scene.minimap) {
      const minimapNode = scene.minimap.handleClick(
        pos.x, pos.y,
        scene.game.canvas.width, scene.game.canvas.height,
        scene.nodes,
        scene.currentNode?.id,
        (node) => scene.isNodeAdjacent(node)
      );
      if (minimapNode) {
        scene.travelToNode(minimapNode);
        return;
      }
    }

    // Regular map click
    const clickedNode = scene.getNodeAtPosition(pos.x, pos.y);

    if (clickedNode && clickedNode.id !== scene.currentNode?.id) {
      scene.travelToNode(clickedNode);
    }
  }

  handleWheel(e) {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    this.scene.zoom = Math.max(0.5, Math.min(2, this.scene.zoom * zoomFactor));
  }

  handleTouchStart(e) {
    if (e.touches.length === 1) {
      this.touchStartX = e.touches[0].clientX;
      this.touchStartY = e.touches[0].clientY;
      this.touchMoved = false;

      // Update hovered node on touch start for tooltip
      const scene = this.scene;
      const pos = scene.game.input.getPointerPosition();
      const touchedNode = scene.getNodeAtPosition(pos.x, pos.y);

      if (touchedNode?.id !== scene.hoveredNode?.id) {
        scene.hoveredNode = touchedNode;
        scene.pathSystem.updatePathPreview(touchedNode);
        scene.updateHoverTooltip(touchedNode);
      }
    }
  }

  handleTouchMove(e) {
    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - this.touchStartX;
      const dy = e.touches[0].clientY - this.touchStartY;

      // If moved more than 10px, consider it a drag
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        this.touchMoved = true;
        // Hide tooltip during drag
        if (this.scene.nodeHoverTooltip) {
          this.scene.nodeHoverTooltip.hide();
        }
      }
    }
  }

  handleTouchEnd() {
    const scene = this.scene;

    // If touch moved, don't handle as tap
    if (this.touchMoved) {
      this.touchMoved = false;
      return;
    }

    // Hide tooltip when tapping on empty space
    const pos = scene.game.input.getPointerPosition();
    const touchedNode = scene.getNodeAtPosition(pos.x, pos.y);

    if (!touchedNode) {
      scene.hoveredNode = null;
      if (scene.nodeHoverTooltip) {
        scene.nodeHoverTooltip.hide();
      }
    }
  }
}
