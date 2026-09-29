/**
 * Handles input events for the world map (mouse, touch, wheel)
 * Manages dragging, clicking, and touch interactions
 */
export function findInteractiveNodeAtPosition(scene, screenX, screenY) {
  for (const node of scene.nodes) {
    if (!scene.pathSystem.isNodeReachable(node.id)) continue;

    const nodeX = node.x_coord * scene.nodeSpacing + scene.cameraX;
    const nodeY = node.y_coord * scene.nodeSpacing + scene.cameraY;
    const distance = Math.hypot(screenX - nodeX, screenY - nodeY);
    if (distance <= scene.nodeSize) return node;
  }
  return null;
}

export class WorldMapInputHandler {
  /**
   * @param {Object} scene - WorldMapScene instance
   */
  constructor(scene) {
    this.scene = scene;
    this.abortController = null;
    this.originalCanvasAccessibility = null;
  }

  /**
   * Setup all input handlers for the world map
   * Call this in scene.enter()
   */
  setup() {
    const canvas = this.scene.game.canvas;
    this.originalCanvasAccessibility = {
      tabIndex: canvas.getAttribute('tabindex'),
      role: canvas.getAttribute('role'),
      ariaLabel: canvas.getAttribute('aria-label'),
      ariaDescribedBy: canvas.getAttribute('aria-describedby')
    };
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'region');
    canvas.setAttribute(
      'aria-label',
      'World map. Use arrow keys to inspect reachable locations and Enter to travel.'
    );
    canvas.setAttribute('aria-describedby', 'world-map-node-tooltip');

    // Create abort controller for cleanup
    this.abortController = new AbortController();
    const opts = { signal: this.abortController.signal };

    canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e), opts);
    canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e), opts);
    canvas.addEventListener('mouseup', () => this.handleMouseUp(), opts);
    canvas.addEventListener('click', () => this.handleClick(), opts);
    canvas.addEventListener('wheel', (e) => this.handleWheel(e), opts);
    canvas.addEventListener('keydown', (e) => this.handleKeyDown(e), opts);

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
    if (this.originalCanvasAccessibility) {
      const canvas = this.scene.game.canvas;
      for (const [attribute, value] of [
        ['tabindex', this.originalCanvasAccessibility.tabIndex],
        ['role', this.originalCanvasAccessibility.role],
        ['aria-label', this.originalCanvasAccessibility.ariaLabel],
        ['aria-describedby', this.originalCanvasAccessibility.ariaDescribedBy]
      ]) {
        if (value === null) canvas.removeAttribute(attribute);
        else canvas.setAttribute(attribute, value);
      }
      this.originalCanvasAccessibility = null;
    }
  }

  handleKeyDown(e) {
    const scene = this.scene;
    const reachableNodes = scene.nodes.filter((node) =>
      scene.pathSystem.isNodeReachable(node.id)
    );
    if (reachableNodes.length === 0) return;

    if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const direction = ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1;
      const selectedId = scene.hoveredNode?.id ?? scene.currentNode?.id;
      const selectedIndex = reachableNodes.findIndex((node) => node.id === selectedId);
      const baseIndex = selectedIndex === -1 && direction > 0 ? -1 : Math.max(0, selectedIndex);
      const nextIndex = (baseIndex + direction + reachableNodes.length)
        % reachableNodes.length;
      const node = reachableNodes[nextIndex];
      scene.hoveredNode = node;
      scene.pathSystem.updatePathPreview(node);
      scene.updateHoverTooltip(node);
      return;
    }

    if (e.key === 'Enter' && scene.hoveredNode
        && scene.hoveredNode.id !== scene.currentNode?.id) {
      e.preventDefault();
      scene.travelToNode(scene.hoveredNode);
    } else if (e.key === 'Escape') {
      scene.hoveredNode = null;
      scene.pathSystem.updatePathPreview(null);
      scene.updateHoverTooltip(null);
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
        // Logical size, not canvas.width/height (the DPR-scaled backing store)
        scene.game.targetWidth, scene.game.targetHeight,
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
