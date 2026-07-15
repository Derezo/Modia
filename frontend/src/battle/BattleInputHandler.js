import { responsive } from '../core/Responsive.js';

/**
 * @module BattleInputHandler
 * @description Handles all user input for the battle scene including mouse, touch, and keyboard.
 *
 * Key responsibilities:
 * - Canvas mouse/touch event handling (click, drag, pan)
 * - Keyboard shortcuts (camera, cancel, tile cycling)
 * - Tile cycling system for overlapping elevated tiles
 * - Mobile long-press gesture for manual tile cycling
 * - Context menu and radial menu triggering
 *
 * Tile Cycling:
 * - Auto-cycles through overlapping tiles every 1.5 seconds
 * - Manual cycling via Tab key or mobile long-press (400ms)
 * - Pauses auto-cycle when user manually selects
 *
 * @see BattleScene.js - Main scene that uses this handler
 * @see GridCursor.js - Keyboard grid navigation (separate handler)
 * @see BattleCamera.js - Camera panning controlled via input
 */

/**
 * BattleInputHandler - Manages all user input for BattleScene
 */
export class BattleInputHandler {
  /**
   * @param {BattleScene} scene - The battle scene instance
   */
  constructor(scene) {
    this.scene = scene;
    this.game = scene.game;

    // Tile cycling state
    this.tileCandidates = [];           // All candidate tiles at hover position
    this.tileCycleIndex = 0;            // Currently selected candidate index
    this.tileCycleTimer = 0;            // Timer for auto-cycling (ms)
    this.tileCyclePaused = false;       // Pause when user manually selects
    this.tileCycleDuration = 1500;      // 1.5 second auto-cycle interval
    this.lastTileCyclePosition = null;  // Track position changes to reset cycling

    // Mobile long-press state
    this.longPressTimer = null;         // Mobile long-press timer for manual cycling
    this.longPressStartPos = null;      // Position at long-press start
    this.touchStartPos = null;          // Canvas-space start position for tap/pan discrimination
    this.touchStartClientPos = null;    // CSS-pixel start position for device-independent touch slop
    this.touchLastPos = null;           // Most recent canvas-space touch position
    this.touchMoved = false;            // True once movement exceeds the tap slop
    this.touchLongPressTriggered = false;
    this.touchHadMultiplePointers = false;

    // Pinch-zoom state — consumed from game.input.getPinchState() each frame
    this.wasPinching = false;
    this.pinchReleaseCooldown = 0;      // frames to ignore taps after pinch release

    // Event cleanup
    this.abortController = null;
  }

  /**
   * Setup all input event handlers
   */
  setup() {
    this.abortController = new AbortController();
    const opts = { signal: this.abortController.signal };
    const canvas = this.game.canvas;

    // Mouse move - hover detection and pan tracking
    canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e), opts);

    // Mouse down - start panning
    canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e), opts);

    // Mouse up - end panning and handle click
    canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e), opts);

    // Right-click - cancel pending action or show context menu
    canvas.addEventListener('contextmenu', (e) => this.handleContextMenu(e), opts);

    // Keyboard input for camera and actions
    window.addEventListener('keydown', (e) => this.handleKeydown(e), opts);

    // Touch events for mobile
    const touchOpts = { signal: this.abortController.signal, passive: false };
    canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), touchOpts);
    canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), touchOpts);
    canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), touchOpts);
    canvas.addEventListener('touchcancel', (e) => this.handleTouchCancel(e), touchOpts);
  }

  /**
   * Clean up event handlers and timers
   */
  cleanup() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressStartPos = null;
    this.resetTouchGesture();
    this.tileCandidates = [];
  }

  /**
   * Handle mouse move - hover detection and pan tracking
   * @param {MouseEvent} _e - Mouse event (unused, position from input handler)
   */
  handleMouseMove(_e) {
    const pos = this.game.input.getPointerPosition();
    this.updatePointerInteraction(pos, true);
  }

  /**
   * Update hover/cycling state for either a mouse or touch pointer.
   * @param {{x: number, y: number}} pos Canvas-space pointer position
   * @param {boolean} updatePan Whether an active camera pan should be advanced
   */
  updatePointerInteraction(pos, updatePan = false) {
    const scene = this.scene;

    // Update outro sequence button hover state
    if (scene.outroSequence) {
      scene.outroSequence.handleMouseMove(pos.x, pos.y);
    }

    // Update pan if dragging
    if (updatePan && scene.camera.isPanning) {
      scene.camera.updatePan(pos.x, pos.y);
    }

    // Get all tile candidates for cycling (overlapping elevations)
    const candidates = scene.grid.getTileAtScreen(pos.x, pos.y, scene.camera, true);

    // Check if position changed significantly (reset cycling)
    const posKey = `${Math.round(pos.x / 10)},${Math.round(pos.y / 10)}`;
    if (this.lastTileCyclePosition !== posKey) {
      this.lastTileCyclePosition = posKey;
      this.tileCycleIndex = 0;
      this.tileCycleTimer = 0;
      this.tileCyclePaused = false;
    }

    // Candidate geometry can change within the same coarse position bucket
    // (for example while the camera moves), so keep the current list fresh
    // without discarding the user's selected cycle index.
    this.tileCandidates = candidates;
    this.tileCycleIndex = Math.min(
      this.tileCycleIndex,
      Math.max(0, candidates.length - 1)
    );

    // Update hovered tile based on current cycle index (with bounds check)
    if (candidates.length > 0) {
      const safeIndex = Math.min(this.tileCycleIndex, candidates.length - 1);
      const selectedCandidate = candidates[safeIndex];
      scene.hoveredTile = { x: selectedCandidate.x, y: selectedCandidate.y };
    } else {
      scene.hoveredTile = null;
    }

    // Update target info if hovering over unit
    this.updateHoverTargetInfo(pos);
  }

  /** Resolve a click to the candidate currently selected by tile cycling. */
  getCycledTileAtPosition(pos) {
    const candidates = this.scene.grid.getTileAtScreen(
      pos.x,
      pos.y,
      this.scene.camera,
      true
    ) || [];
    if (candidates.length === 0) return null;

    const selected = this.tileCandidates[this.tileCycleIndex];
    const matchingCandidate = selected && candidates.find(candidate =>
      candidate.x === selected.x && candidate.y === selected.y
    );
    const fallback = candidates[Math.min(this.tileCycleIndex, candidates.length - 1)];
    const tile = matchingCandidate || fallback;
    return { x: tile.x, y: tile.y };
  }

  /**
   * Update target info panel based on hover state
   * @param {Object} pos - Screen position { x, y }
   */
  updateHoverTargetInfo(pos) {
    const scene = this.scene;

    // When target is locked (during confirmation), keep showing locked target's info
    if (scene.lockedTarget?.unit) {
      scene.ui.showTargetInfo(scene.lockedTarget.unit);
      // Use locked tile for damage preview to maintain consistency
      scene.updateDamagePreview(scene.lockedTarget.tile, pos);
    } else if (scene.hoveredTile) {
      const unit = scene.getUnitAt(scene.hoveredTile.x, scene.hoveredTile.y);
      if (unit) {
        // Show target info for enemies always, or allies when targeting with skill/item
        // In PvP, determine ally/enemy using teamId comparison
        const localUserId = this.game.localUserId;
        const localTeamId = scene.isPvP
          ? (Array.from(scene.units.values()).find(u => u.ownerId === localUserId)?.teamId ?? 1)
          : 1;
        const isAllyUnit = scene.isPvP ? unit.isAlly(localUserId, localTeamId) : unit.type === 'player';
        const isEnemyUnit = scene.isPvP ? unit.isOpponent(localUserId, localTeamId) : unit.type === 'enemy';
        const isTargetingAlly = ['skill', 'item'].includes(scene.currentAction) && isAllyUnit;
        if (isEnemyUnit || isTargetingAlly) {
          scene.ui.showTargetInfo(unit);
        } else {
          scene.ui.hideTargetInfo();
        }
      } else {
        scene.ui.hideTargetInfo();
      }

      // Show damage preview when hovering over valid targets during attack/skill/item mode
      scene.updateDamagePreview(scene.hoveredTile, pos);
    } else {
      // Hide damage preview when not hovering a tile
      scene.ui.hideDamagePreview();
    }
  }

  /**
   * Handle mouse down - start panning
   * @param {MouseEvent} e - Mouse event
   */
  handleMouseDown(e) {
    if (e?.button !== undefined && e.button !== 0) return;
    if (this.isSuppressedByPinch()) return;
    const pos = this.game.input.getPointerPosition();
    this.scene.camera.startPan(pos.x, pos.y);
  }

  /**
   * Handle mouse up - end panning and handle click
   * @param {MouseEvent} e - Mouse event
   */
  handleMouseUp(e) {
    if (e?.button !== undefined && e.button !== 0) return;
    const scene = this.scene;
    const panDistance = scene.camera.getPanDistance();
    scene.camera.endPan();

    // Ignore the click that follows a pinch-gesture end
    if (this.isSuppressedByPinch()) return;

    // Only register as click if pan distance was small (not a drag)
    if (panDistance < 10) {
      const pos = this.game.input.getPointerPosition();

      // Check if outro sequence is showing continue button
      if (scene.outroSequence && scene.outroSequence.handleClick(pos.x, pos.y)) {
        return; // Click was handled by outro sequence
      }

      const tile = this.getCycledTileAtPosition(pos);
      if (tile) {
        this.handleTileClick(tile.x, tile.y, { mouseX: e.clientX, mouseY: e.clientY });
      }
    }
  }

  /**
   * Handle right-click - cancel pending action or show context menu
   * @param {MouseEvent} e - Mouse event
   */
  handleContextMenu(e) {
    e.preventDefault();
    const scene = this.scene;

    // If there's a pending action, right-click cancels it
    if (scene.pendingAction || scene.currentAction) {
      scene.cancelAction();
      return;
    }

    // Only show context menu if it's player's turn and no action in progress
    const activeUnit = scene.getActiveUnit();
    if (!activeUnit || activeUnit.type !== 'player') {
      return;
    }

    // Hide radial menu if visible
    scene.hideRadialMenu();

    // Show context menu at mouse position
    scene.contextMenu.show(
      e.clientX,
      e.clientY,
      scene.canMove,
      scene.canAct,
      activeUnit.mp
    );
  }

  /**
   * Handle keyboard input
   * @param {KeyboardEvent} e - Keyboard event
   */
  handleKeydown(e) {
    const scene = this.scene;

    // Spacebar - return to follow mode
    if (e.code === 'Space') {
      e.preventDefault();
      scene.camera.returnToFollowMode();
    }

    // Escape - cancel current action and return to action menu
    if (e.code === 'Escape' && scene.currentAction !== null) {
      e.preventDefault();
      scene.cancelAction();
    }

    // Tab - manual tile cycling (for overlapping tiles)
    if (e.code === 'Tab' && this.tileCandidates.length > 1) {
      e.preventDefault();
      this.cycleTileManual();
    }
  }

  /**
   * Handle touch start - setup long-press for tile cycling
   * @param {TouchEvent} e - Touch event
   */
  handleTouchStart(e) {
    e.preventDefault?.();

    // Multi-touch: cancel long-press, leave pinch handling to InputHandler
    if (e.touches.length >= 2) {
      this.touchHadMultiplePointers = true;
      this.cancelLongPress();
      this.touchStartPos = null;
      this.touchStartClientPos = null;
      this.touchLastPos = null;
      this.touchMoved = true;
      if (this.scene.camera.isPanning) this.scene.camera.endPan();
      return;
    }

    if (this.isSuppressedByPinch() || !e.touches[0]) return;

    const touch = e.touches[0];
    const pos = this.getTouchCanvasPosition(touch);
    this.touchHadMultiplePointers = false;
    this.touchStartPos = pos;
    this.touchStartClientPos = { x: touch.clientX, y: touch.clientY };
    this.touchLastPos = pos;
    this.touchMoved = false;
    this.touchLongPressTriggered = false;
    this.longPressStartPos = pos;

    // Touch does not produce a synthetic mouse event because the core input
    // handler prevents the browser default. Perform hover discovery and start
    // the camera gesture explicitly.
    this.updatePointerInteraction(pos, false);
    this.scene.camera.startPan(pos.x, pos.y);

    if (this.tileCandidates.length <= 1) return;

    // Start long-press timer (400ms)
    this.longPressTimer = setTimeout(() => {
      this.touchLongPressTriggered = true;
      this.cycleTileManual();
      // Provide haptic feedback if available
      if (globalThis.navigator?.vibrate) {
        globalThis.navigator.vibrate(50);
      }
      this.longPressTimer = null;
    }, 400);
  }

  /** Convert a DOM touch to the logical canvas coordinate system. */
  getTouchCanvasPosition(touch) {
    if (this.game.input.getCanvasCoords) {
      return this.game.input.getCanvasCoords(touch.clientX, touch.clientY);
    }

    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (touch.clientX - rect.left) * (canvas.width / rect.width),
      y: (touch.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  /**
   * Poll per-frame pinch gesture state and convert to camera zoom.
   * Also suppresses panning/tap-to-select while pinch is active.
   */
  updatePinchZoom() {
    const scene = this.scene;
    if (!scene.camera) return;

    const pinch = this.game.input.getPinchState();

    if (pinch.active) {
      // Cancel any active pan so pinch doesn't drag the camera sideways
      if (scene.camera.isPanning) {
        scene.camera.endPan();
      }

      // Translate distance delta (in screen pixels) to a multiplicative zoom
      // factor. Reference distance of 200px makes a 50px pinch = ~1.25x zoom,
      // which feels natural on a phone without being twitchy.
      if (pinch.distanceDelta !== 0 && pinch.distance > 0) {
        const prevDistance = pinch.distance - pinch.distanceDelta;
        if (prevDistance > 10) {
          const factor = pinch.distance / prevDistance;
          scene.camera.zoomBy(factor);
        }
      }

      this.wasPinching = true;
      this.pinchReleaseCooldown = 8; // ~130ms at 60fps
    } else if (this.wasPinching) {
      this.wasPinching = false;
    }

    if (this.pinchReleaseCooldown > 0) {
      this.pinchReleaseCooldown--;
    }
  }

  /**
   * Whether a recent pinch gesture should suppress tap/click handling.
   */
  isSuppressedByPinch() {
    return this.wasPinching || this.pinchReleaseCooldown > 0;
  }

  /**
   * Handle touch move - cancel long-press if finger moves
   * @param {TouchEvent} e - Touch event
   */
  handleTouchMove(e) {
    e.preventDefault?.();

    if (e.touches.length >= 2) {
      this.touchHadMultiplePointers = true;
      this.cancelLongPress();
      if (this.scene.camera.isPanning) this.scene.camera.endPan();
      return;
    }

    if (!this.touchStartPos || !this.touchStartClientPos || !e.touches[0]) return;

    const touch = e.touches[0];
    const pos = this.getTouchCanvasPosition(touch);
    // Gesture slop is a physical CSS-pixel UX threshold. Measuring in the
    // logical 800x600 canvas made it shrink to ~5px on a 390px phone.
    const dx = touch.clientX - this.touchStartClientPos.x;
    const dy = touch.clientY - this.touchStartClientPos.y;
    const dist = Math.hypot(dx, dy);
    this.touchLastPos = pos;

    // Cancel long-press if the finger moved more than 10 CSS pixels.
    if (dist > 10) {
      this.touchMoved = true;
      this.cancelLongPress();
      this.scene.camera.updatePan(pos.x, pos.y);
    }

    this.updatePointerInteraction(pos, false);
  }

  /**
   * Handle touch end - clear long-press timer
   */
  handleTouchEnd(e) {
    e?.preventDefault?.();

    if (this.touchHadMultiplePointers) {
      this.cancelLongPress();
      if (this.scene.camera.isPanning) this.scene.camera.endPan();
      if (!e?.touches?.length) this.resetTouchGesture();
      return;
    }

    const touch = e?.changedTouches?.[0];
    const pos = touch ? this.getTouchCanvasPosition(touch) : this.touchLastPos;
    const shouldTap = Boolean(
      this.touchStartPos &&
      pos &&
      !this.touchMoved &&
      !this.touchLongPressTriggered &&
      !this.isSuppressedByPinch()
    );

    this.cancelLongPress();
    if (this.scene.camera.isPanning) this.scene.camera.endPan();

    if (shouldTap) {
      this.updatePointerInteraction(pos, false);

      if (this.scene.outroSequence?.handleClick(pos.x, pos.y)) {
        this.resetTouchGesture();
        return;
      }

      const tile = this.getCycledTileAtPosition(pos);
      if (tile) {
        this.handleTileClick(tile.x, tile.y, {
          mouseX: touch?.clientX ?? pos.x,
          mouseY: touch?.clientY ?? pos.y
        });
      }
    }

    this.resetTouchGesture();
  }

  /**
   * Handle touch cancel - clear long-press timer
   */
  handleTouchCancel(e) {
    e?.preventDefault?.();
    this.cancelLongPress();
    if (this.scene.camera.isPanning) this.scene.camera.endPan();
    this.resetTouchGesture();
  }

  cancelLongPress() {
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
    this.longPressStartPos = null;
  }

  resetTouchGesture() {
    this.touchStartPos = null;
    this.touchStartClientPos = null;
    this.touchLastPos = null;
    this.touchMoved = false;
    this.touchLongPressTriggered = false;
    this.touchHadMultiplePointers = false;
  }

  /**
   * Handle click on a tile
   * @param {number} x - Tile X coordinate
   * @param {number} y - Tile Y coordinate
   * @param {Object} mousePos - Optional mouse position { mouseX, mouseY } for context menu
   */
  handleTileClick(x, y, mousePos = null) {
    const scene = this.scene;

    // Delegate to scene's handleTileClick for action logic
    scene.handleTileClick(x, y, mousePos);
  }

  /**
   * Update tile cycling for overlapping elevated tiles
   * Auto-cycles through candidates every 1.5 seconds when multiple tiles overlap
   * @param {number} deltaTime - Time since last frame in milliseconds
   */
  updateTileCycling(deltaTime) {
    const scene = this.scene;

    // Skip if target is locked (during spell/attack targeting confirmation)
    if (scene.lockedTarget) return;

    // Skip if only 0 or 1 candidate, or if cycling is paused (manual selection)
    if (this.tileCandidates.length <= 1 || this.tileCyclePaused) {
      return;
    }

    // Accumulate time
    this.tileCycleTimer += deltaTime;

    // Cycle to next candidate when timer reaches threshold
    if (this.tileCycleTimer >= this.tileCycleDuration) {
      this.tileCycleTimer = 0;
      this.tileCycleIndex = (this.tileCycleIndex + 1) % this.tileCandidates.length;

      // Update hovered tile
      const selectedCandidate = this.tileCandidates[this.tileCycleIndex];
      scene.hoveredTile = { x: selectedCandidate.x, y: selectedCandidate.y };

      // Update damage preview for new hovered tile
      const pos = this.game.input.getPointerPosition();
      scene.updateDamagePreview(scene.hoveredTile, pos);
    }
  }

  /**
   * Manually cycle to next tile candidate (for mobile long-press or keyboard)
   */
  cycleTileManual() {
    if (this.tileCandidates.length <= 1) return;

    // Pause auto-cycling when user manually cycles
    this.tileCyclePaused = true;
    this.tileCycleTimer = 0;

    // Cycle to next candidate
    this.tileCycleIndex = (this.tileCycleIndex + 1) % this.tileCandidates.length;

    // Update hovered tile
    const selectedCandidate = this.tileCandidates[this.tileCycleIndex];
    this.scene.hoveredTile = { x: selectedCandidate.x, y: selectedCandidate.y };

    // Update damage preview
    const pos = this.game.input.getPointerPosition();
    this.scene.updateDamagePreview(this.scene.hoveredTile, pos);
  }

  /**
   * Render tile cycle indicator when multiple tiles overlap at hover position
   * Shows "1/3" style counter with progress arc for auto-cycle timer
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   */
  renderTileCycleIndicator(ctx) {
    const scene = this.scene;

    // Only show when multiple candidates exist
    if (this.tileCandidates.length <= 1 || !scene.hoveredTile) return;

    // Get screen position of hovered tile
    const worldPos = scene.grid.gridToScreenWorld(scene.hoveredTile.x, scene.hoveredTile.y);
    const screenPos = scene.camera.worldToScreen(worldPos.x, worldPos.y);

    // Position indicator at top-right of tile
    const indicatorX = screenPos.x + 24;
    const indicatorY = screenPos.y - 20;
    const radius = 14;

    // Draw background circle
    ctx.beginPath();
    ctx.arc(indicatorX, indicatorY, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fill();

    // Draw progress arc (if not paused)
    if (!this.tileCyclePaused) {
      const progress = this.tileCycleTimer / this.tileCycleDuration;
      const startAngle = -Math.PI / 2; // Start from top
      const endAngle = startAngle + (progress * Math.PI * 2);

      ctx.beginPath();
      ctx.arc(indicatorX, indicatorY, radius - 2, startAngle, endAngle);
      ctx.strokeStyle = 'rgba(100, 180, 255, 0.8)';
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      // Show paused indicator (full ring in different color)
      ctx.beginPath();
      ctx.arc(indicatorX, indicatorY, radius - 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 200, 100, 0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw border
    ctx.beginPath();
    ctx.arc(indicatorX, indicatorY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw counter text "1/3"
    const currentIndex = this.tileCycleIndex + 1;
    const totalCount = this.tileCandidates.length;
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${responsive.getCanvasFontSize('sm')}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${currentIndex}/${totalCount}`, indicatorX, indicatorY);

    // Draw elevation info below counter
    const currentCandidate = this.tileCandidates[this.tileCycleIndex];
    if (currentCandidate && currentCandidate.elevation !== 0) {
      const elevText = currentCandidate.elevation > 0
        ? `+${currentCandidate.elevation}`
        : `${currentCandidate.elevation}`;
      ctx.fillStyle = 'rgba(200, 200, 255, 0.9)';
      ctx.font = `${responsive.getCanvasFontSize('sm')}px Arial`;
      ctx.fillText(elevText, indicatorX, indicatorY + radius + 8);
    }

    // Draw hint text (Tab to cycle)
    if (!scene.isTouchDevice && this.tileCandidates.length > 1) {
      ctx.fillStyle = 'rgba(180, 180, 180, 0.7)';
      ctx.font = `${responsive.getCanvasFontSize('sm')}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText('Tab', indicatorX, indicatorY - radius - 6);
    }
  }

  /**
   * Get current tile candidates for external checks
   * @returns {Array} Array of tile candidates
   */
  getTileCandidates() {
    return this.tileCandidates;
  }

  /**
   * Get current tile cycle index
   * @returns {number} Current index
   */
  getTileCycleIndex() {
    return this.tileCycleIndex;
  }
}
