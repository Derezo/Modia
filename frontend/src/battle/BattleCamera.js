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
    this.panLastX = 0;
    this.panLastY = 0;
    this.panStartCameraX = 0;
    this.panStartCameraY = 0;

    // Bounds (set based on map size)
    this.minX = 0;
    this.minY = 0;
    this.maxX = 0;
    this.maxY = 0;

    // Zoom state — visual only (applied via ctx.scale around viewport center).
    // worldToScreen / screenToWorld stay in logical space; screenToWorldZoomed
    // inverts the zoom transform for hit-testing.
    this.zoom = 1.0;
    // Large 32x32 isometric maps need to reach roughly 0.2 on narrow phones.
    this.minZoom = 0.15;
    this.maxZoom = 2.0;

    // Screen shake state
    this.screenShakeEnabled = true; // Default enabled, set via setScreenShakeEnabled
    this.shakeActive = false;
    this.shakeIntensity = 0;
    this.shakeDuration = 0;
    this.shakeTimer = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
  }

  setZoom(z) {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, z));
    this._recomputeClampFromBounds();
    this.clampTarget();
  }

  /**
   * Update viewport dimensions and recompute bounds
   * Call this when canvas/viewport size changes
   */
  updateViewport(width, height) {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this._recomputeClampFromBounds();
    this.clampTarget();
  }

  zoomBy(factor) {
    this.setZoom(this.zoom * factor);
  }

  /**
   * Convert a screen-space pixel (after ctx.scale has visually zoomed the grid)
   * to the equivalent unscaled screen coord, so callers can pass it into
   * screenToWorld() or grid.screenToGrid() without awareness of zoom.
   */
  screenToUnzoomed(screenX, screenY) {
    const cx = this.viewportWidth / 2;
    const cy = this.viewportHeight / 2;
    return {
      x: (screenX - cx) / this.zoom + cx,
      y: (screenY - cy) / this.zoom + cy
    };
  }

  /** Apply the same viewport-centred zoom used by the canvas render pass. */
  screenToZoomed(screenX, screenY) {
    const cx = this.viewportWidth / 2;
    const cy = this.viewportHeight / 2;
    return {
      x: (screenX - cx) * this.zoom + cx,
      y: (screenY - cy) * this.zoom + cy
    };
  }

  /**
   * Set map bounds for camera clamping
   * @param {number} mapPixelWidth - Total width of the map in pixels
   * @param {number} mapPixelHeight - Total height of the map in pixels
   * @param {number} worldMinX - Minimum X in world coordinates (default: -width/2 for centered)
   * @param {number} worldMinY - Minimum Y in world coordinates (default: 0)
   */
  setBounds(mapPixelWidth, mapPixelHeight, worldMinX = null, worldMinY = null) {
    // Store raw world bounds; clampTarget() applies zoom-aware half-viewport.
    const minWorldX = worldMinX !== null ? worldMinX : -mapPixelWidth / 2;
    const minWorldY = worldMinY !== null ? worldMinY : 0;
    this.worldBounds = {
      minX: minWorldX,
      minY: minWorldY,
      maxX: minWorldX + mapPixelWidth,
      maxY: minWorldY + mapPixelHeight
    };
    this._recomputeClampFromBounds();
  }

  /**
   * Set map bounds using world-space bounding box
   */
  setBoundsFromWorld(worldMinX, worldMinY, worldMaxX, worldMaxY) {
    this.worldBounds = { minX: worldMinX, minY: worldMinY, maxX: worldMaxX, maxY: worldMaxY };
    this._recomputeClampFromBounds();
  }

  /**
   * Recompute min/max clamp bounds from the stored world bounds and current zoom.
   * Visible world area shrinks as zoom increases (viewport/zoom), so the camera
   * center can approach the map edges more closely.
   */
  _recomputeClampFromBounds() {
    if (!this.worldBounds) return;
    const zoom = this.zoom || 1;
    const halfVisibleW = (this.viewportWidth / zoom) / 2;
    const halfVisibleH = (this.viewportHeight / zoom) / 2;
    const mapWidth = this.worldBounds.maxX - this.worldBounds.minX;
    const mapHeight = this.worldBounds.maxY - this.worldBounds.minY;

    if (halfVisibleW * 2 >= mapWidth) {
      this.minX = this.maxX = (this.worldBounds.minX + this.worldBounds.maxX) / 2;
    } else {
      this.minX = this.worldBounds.minX + halfVisibleW;
      this.maxX = this.worldBounds.maxX - halfVisibleW;
    }

    if (halfVisibleH * 2 >= mapHeight) {
      this.minY = this.maxY = (this.worldBounds.minY + this.worldBounds.maxY) / 2;
    } else {
      this.minY = this.worldBounds.minY + halfVisibleH;
      this.maxY = this.worldBounds.maxY - halfVisibleH;
    }
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
    this.panLastX = screenX;
    this.panLastY = screenY;
    this.panStartCameraX = this.x;
    this.panStartCameraY = this.y;
  }

  /**
   * Update pan position (mouse/touch move)
   */
  updatePan(screenX, screenY) {
    if (!this.isPanning) return;

    this.panLastX = screenX;
    this.panLastY = screenY;

    // Divide by zoom so 1 screen pixel of finger drag moves the world by
    // 1 screen pixel regardless of current zoom level.
    const zoom = this.zoom || 1;
    const dx = (screenX - this.panStartX) / zoom;
    const dy = (screenY - this.panStartY) / zoom;

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
    // Pointer displacement is immediate and still works when the camera is
    // clamped at a map edge or has not yet advanced its interpolation frame.
    const dx = this.panLastX - this.panStartX;
    const dy = this.panLastY - this.panStartY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Move camera with keyboard (arrow keys only - WASD reserved for action hotkeys)
   */
  moveByKeys(dx, dy, deltaTime) {
    const speed = 400; // pixels per second
    const dt = deltaTime / 1000; // Convert ms to seconds
    this.targetX += dx * speed * dt;
    this.targetY += dy * speed * dt;
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
    // Process turn transition if active (MUST be first - updates target position)
    if (this.turnTransitionActive) {
      this.updateTurnTransition(deltaTime);
    }

    // In follow mode, update target to follow unit
    // Skip during turn transition to avoid overwriting transition target
    if (this.mode === 'follow' && this.followTarget && !this.turnTransitionActive) {
      this.targetX = this.followTarget.screenX;
      this.targetY = this.followTarget.screenY;
      this.clampTarget();
    }

    // Smooth interpolation (lerp)
    const dt = deltaTime / 1000; // Convert ms to seconds
    const t = 1 - Math.exp(-this.lerpSpeed * dt);

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
   * Check if a world-space rectangle is visible in viewport.
   * Visible area grows as zoom shrinks (viewport / zoom).
   */
  isVisible(worldX, worldY, width = 64, height = 64) {
    const screen = this.worldToScreen(worldX, worldY);
    const zoom = this.zoom || 1;
    const visibleW = this.viewportWidth / zoom;
    const visibleH = this.viewportHeight / zoom;
    const halfExtraW = (visibleW - this.viewportWidth) / 2;
    const halfExtraH = (visibleH - this.viewportHeight) / 2;
    return (
      screen.x + width > -halfExtraW &&
      screen.x - width < this.viewportWidth + halfExtraW &&
      screen.y + height > -halfExtraH &&
      screen.y - height < this.viewportHeight + halfExtraH
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

  /** Backwards-compatible semantic alias used by modal navigation. */
  panTo(worldX, worldY) {
    this.centerOn(worldX, worldY, false);
    this.enterManualMode();
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

    this.turnTransitionTimer += deltaTime; // deltaTime already in ms
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

  /**
   * Set whether screen shake effects are enabled (user setting)
   * @param {boolean} enabled
   */
  setScreenShakeEnabled(enabled) {
    this.screenShakeEnabled = enabled !== false;
  }

  /**
   * Trigger a screen shake effect
   * @param {number} intensity - Shake intensity (pixels of displacement)
   * @param {number} duration - Shake duration in milliseconds
   */
  triggerShake(intensity = 5, duration = 200) {
    if (!this.screenShakeEnabled) return;

    this.shakeIntensity = intensity;
    this.shakeDuration = duration;
    this.shakeTimer = 0;
    this.shakeActive = true;
  }

  /**
   * Get current shake offset to apply to render transform
   * Should be called each frame to get the current offset
   * @returns {{ x: number, y: number }}
   */
  getShakeOffset() {
    if (!this.shakeActive || !this.screenShakeEnabled) {
      return { x: 0, y: 0 };
    }
    return { x: this.shakeOffsetX || 0, y: this.shakeOffsetY || 0 };
  }

  /**
   * Update screen shake animation (call each frame)
   * @param {number} deltaTime - Time since last frame in ms
   */
  updateShake(deltaTime) {
    if (!this.shakeActive) return;

    this.shakeTimer += deltaTime;
    if (this.shakeTimer >= this.shakeDuration) {
      this.shakeActive = false;
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
      return;
    }

    // Decay intensity over time
    const progress = this.shakeTimer / this.shakeDuration;
    const currentIntensity = this.shakeIntensity * (1 - progress);

    // Random offset within intensity range
    this.shakeOffsetX = (Math.random() - 0.5) * 2 * currentIntensity;
    this.shakeOffsetY = (Math.random() - 0.5) * 2 * currentIntensity;
  }
}
