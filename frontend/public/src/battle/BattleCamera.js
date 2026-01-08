/**
 * BattleCamera - Hybrid auto-follow and manual pan camera for battle grid
 */
export class BattleCamera {
  constructor(canvasWidth, canvasHeight) {
    // Camera position (world coordinates - where camera is looking)
    this.x = 0;
    this.y = 0;

    // Target position for smooth interpolation
    this.targetX = 0;
    this.targetY = 0;

    // Viewport dimensions
    this.viewportWidth = canvasWidth;
    this.viewportHeight = canvasHeight;

    // Camera modes
    this.mode = 'follow'; // 'follow' | 'manual'
    this.followTarget = null; // Unit to follow

    // Interpolation settings
    this.lerpSpeed = 5; // Higher = faster camera movement
    this.snapThreshold = 1; // Distance below which we snap to target

    // Manual pan state
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.panStartCameraX = 0;
    this.panStartCameraY = 0;

    // Bounds (set based on map size)
    this.minX = 0;
    this.minY = 0;
    this.maxX = 0;
    this.maxY = 0;
  }

  /**
   * Set map bounds for camera clamping
   * @param {number} mapPixelWidth - Total width of the map in pixels
   * @param {number} mapPixelHeight - Total height of the map in pixels
   * @param {number} worldMinX - Minimum X in world coordinates (default: -width/2 for centered)
   * @param {number} worldMinY - Minimum Y in world coordinates (default: 0)
   */
  setBounds(mapPixelWidth, mapPixelHeight, worldMinX = null, worldMinY = null) {
    // Camera position represents center of viewport in world coordinates
    // For isometric grids, world coordinates can be negative
    const halfViewportW = this.viewportWidth / 2;
    const halfViewportH = this.viewportHeight / 2;

    // If world bounds aren't specified, assume map is centered on X and starts at 0 for Y
    const minWorldX = worldMinX !== null ? worldMinX : -mapPixelWidth / 2;
    const minWorldY = worldMinY !== null ? worldMinY : 0;
    const maxWorldX = minWorldX + mapPixelWidth;
    const maxWorldY = minWorldY + mapPixelHeight;

    // Camera bounds: allow camera center to move such that viewport stays within map
    this.minX = minWorldX + halfViewportW;
    this.minY = minWorldY + halfViewportH;
    this.maxX = Math.max(maxWorldX - halfViewportW, this.minX);
    this.maxY = Math.max(maxWorldY - halfViewportH, this.minY);
  }

  /**
   * Set map bounds using world-space bounding box
   */
  setBoundsFromWorld(worldMinX, worldMinY, worldMaxX, worldMaxY) {
    const halfViewportW = this.viewportWidth / 2;
    const halfViewportH = this.viewportHeight / 2;

    this.minX = worldMinX + halfViewportW;
    this.minY = worldMinY + halfViewportH;
    this.maxX = Math.max(worldMaxX - halfViewportW, this.minX);
    this.maxY = Math.max(worldMaxY - halfViewportH, this.minY);
  }

  /**
   * Set unit to auto-follow
   */
  setFollowTarget(unit) {
    this.followTarget = unit;
    if (unit && this.mode === 'follow') {
      // Immediately update target when following
      this.targetX = unit.screenX;
      this.targetY = unit.screenY;
      this.clampTarget();
    }
  }

  /**
   * Switch to manual mode (player broke free)
   * Cancels any active turn transition
   */
  enterManualMode() {
    this.mode = 'manual';
    // Cancel turn transition if user takes manual control
    if (this.turnTransitionActive) {
      this.turnTransitionActive = false;
      this.onTurnTransitionComplete = null;
    }
  }

  /**
   * Return to follow mode (spacebar pressed)
   */
  returnToFollowMode() {
    this.mode = 'follow';
    if (this.followTarget) {
      this.targetX = this.followTarget.screenX;
      this.targetY = this.followTarget.screenY;
      this.clampTarget();
    }
  }

  /**
   * Start panning (mouse/touch down)
   */
  startPan(screenX, screenY) {
    this.isPanning = true;
    this.panStartX = screenX;
    this.panStartY = screenY;
    this.panStartCameraX = this.x;
    this.panStartCameraY = this.y;
  }

  /**
   * Update pan position (mouse/touch move)
   */
  updatePan(screenX, screenY) {
    if (!this.isPanning) return;

    const dx = screenX - this.panStartX;
    const dy = screenY - this.panStartY;

    this.targetX = this.panStartCameraX - dx;
    this.targetY = this.panStartCameraY - dy;
    this.clampTarget();
    this.enterManualMode();
  }

  /**
   * End panning
   */
  endPan() {
    this.isPanning = false;
  }

  /**
   * Get pan distance since pan started
   */
  getPanDistance() {
    if (!this.isPanning) return 0;
    const dx = this.x - this.panStartCameraX;
    const dy = this.y - this.panStartCameraY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Move camera with keyboard (WASD/arrows)
   */
  moveByKeys(dx, dy, deltaTime) {
    const speed = 400; // pixels per second
    this.targetX += dx * speed * deltaTime;
    this.targetY += dy * speed * deltaTime;
    this.clampTarget();
    this.enterManualMode();
  }

  /**
   * Clamp target position to bounds
   */
  clampTarget() {
    this.targetX = Math.max(this.minX, Math.min(this.maxX, this.targetX));
    this.targetY = Math.max(this.minY, Math.min(this.maxY, this.targetY));
  }

  /**
   * Update camera position (call each frame)
   */
  update(deltaTime) {
    // In follow mode, update target to follow unit
    // Skip during turn transition to avoid overwriting transition target
    if (this.mode === 'follow' && this.followTarget && !this.turnTransitionActive) {
      this.targetX = this.followTarget.screenX;
      this.targetY = this.followTarget.screenY;
      this.clampTarget();
    }

    // Smooth interpolation (lerp)
    const t = 1 - Math.exp(-this.lerpSpeed * deltaTime);

    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < this.snapThreshold) {
      this.x = this.targetX;
      this.y = this.targetY;
    } else {
      this.x += dx * t;
      this.y += dy * t;
    }
  }

  /**
   * Convert world position to screen position
   */
  worldToScreen(worldX, worldY) {
    return {
      x: worldX - this.x + this.viewportWidth / 2,
      y: worldY - this.y + this.viewportHeight / 2
    };
  }

  /**
   * Convert screen position to world position
   */
  screenToWorld(screenX, screenY) {
    return {
      x: screenX + this.x - this.viewportWidth / 2,
      y: screenY + this.y - this.viewportHeight / 2
    };
  }

  /**
   * Check if a world-space rectangle is visible in viewport
   */
  isVisible(worldX, worldY, width = 64, height = 64) {
    const screen = this.worldToScreen(worldX, worldY);
    return (
      screen.x + width > 0 &&
      screen.x - width < this.viewportWidth &&
      screen.y + height > 0 &&
      screen.y - height < this.viewportHeight
    );
  }

  /**
   * Get visible tile range for culling (approximate)
   * Returns {minX, maxX, minY, maxY} in grid coordinates
   */
  getVisibleTileRange(gridWidth, gridHeight, tileWidth, tileHeight) {
    // Approximate bounds based on viewport and tile size
    // Add padding for isometric tiles that extend beyond their grid cell
    const padding = 4;

    // Calculate rough grid bounds based on camera position
    // For isometric grids, this is approximate
    const tilesInViewX = Math.ceil(this.viewportWidth / tileWidth) + padding * 2;
    const tilesInViewY = Math.ceil(this.viewportHeight / tileHeight) + padding * 2;

    // Center tile based on camera
    const centerTileX = Math.floor(gridWidth / 2);
    const centerTileY = Math.floor(gridHeight / 2);

    return {
      minX: Math.max(0, centerTileX - tilesInViewX),
      maxX: Math.min(gridWidth - 1, centerTileX + tilesInViewX),
      minY: Math.max(0, centerTileY - tilesInViewY),
      maxY: Math.min(gridHeight - 1, centerTileY + tilesInViewY)
    };
  }

  /**
   * Center camera on a specific world position
   */
  centerOn(worldX, worldY, instant = false) {
    this.targetX = worldX;
    this.targetY = worldY;
    this.clampTarget();

    if (instant) {
      this.x = this.targetX;
      this.y = this.targetY;
    }
  }

  /**
   * Start a smooth turn transition to focus on a new active unit
   * @param {number} targetX - World X coordinate to pan to
   * @param {number} targetY - World Y coordinate to pan to
   * @param {Function} onComplete - Optional callback when pan completes
   * @param {number} duration - Transition duration in ms (default 800)
   */
  startTurnTransition(targetX, targetY, onComplete = null, duration = 800) {
    this.turnTransitionActive = true;
    this.turnTransitionStart = { x: this.x, y: this.y };
    this.turnTransitionTarget = { x: targetX, y: targetY };
    this.turnTransitionTimer = 0;
    this.turnTransitionDuration = duration;
    this.onTurnTransitionComplete = onComplete;
    this.mode = 'follow'; // Ensure follow mode
  }

  /**
   * Update turn transition animation (called from update)
   * @param {number} deltaTime - Time since last frame (seconds)
   * @returns {boolean} True if transition is active
   */
  updateTurnTransition(deltaTime) {
    if (!this.turnTransitionActive) return false;

    this.turnTransitionTimer += deltaTime * 1000;
    const progress = Math.min(1, this.turnTransitionTimer / this.turnTransitionDuration);

    // Ease-out cubic for smooth deceleration
    const easedProgress = this.easeOutCubic(progress);

    // Interpolate camera position
    const startX = this.turnTransitionStart.x;
    const startY = this.turnTransitionStart.y;
    const endX = this.turnTransitionTarget.x;
    const endY = this.turnTransitionTarget.y;

    this.targetX = startX + (endX - startX) * easedProgress;
    this.targetY = startY + (endY - startY) * easedProgress;
    this.clampTarget();

    // Also update actual position for smoother feel during transition
    this.x = this.targetX;
    this.y = this.targetY;

    // Check completion
    if (progress >= 1) {
      this.turnTransitionActive = false;
      if (this.onTurnTransitionComplete) {
        this.onTurnTransitionComplete();
        this.onTurnTransitionComplete = null;
      }
    }

    return this.turnTransitionActive;
  }

  /**
   * Check if a turn transition is currently active
   */
  isTurnTransitioning() {
    return this.turnTransitionActive || false;
  }

  /**
   * Ease-out cubic easing function
   */
  easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
}
