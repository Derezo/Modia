/**
 * GridCursor - Keyboard navigation cursor for battle grid
 *
 * Features:
 * - Diamond outline cursor on grid
 * - WASD/arrows move cursor (when no menu open)
 * - Enter/Space: select tile or open menu on unit
 * - Tab: cycle through units
 * - Visual: white diamond with subtle pulse
 */
export class GridCursor {
  constructor(game, grid) {
    this.game = game;
    this.grid = grid;

    // Cursor position (grid coordinates)
    this.x = 0;
    this.y = 0;

    // State
    this.isVisible = false;
    this.isActive = false; // Active when keyboard is being used

    // Animation
    this.pulsePhase = 0;
    this.opacity = 0.7;

    // Visual settings
    this.color = '#ffffff';
    this.strokeWidth = 2;

    // Callbacks
    this.callbacks = {};

    // Bound handlers
    this.boundKeydownHandler = this.handleKeydown.bind(this);

    // Movement cooldown to prevent too-fast navigation
    this.lastMoveTime = 0;
    this.moveCooldown = 120; // ms between moves
  }

  /**
   * Initialize cursor with callbacks
   */
  create(callbacks = {}) {
    this.callbacks = callbacks;
    document.addEventListener('keydown', this.boundKeydownHandler);
  }

  /**
   * Set cursor position
   */
  setPosition(x, y) {
    // Clamp to grid bounds
    const bounds = this.grid.getBounds();
    this.x = Math.max(0, Math.min(bounds.width - 1, x));
    this.y = Math.max(0, Math.min(bounds.height - 1, y));
  }

  /**
   * Move cursor by offset
   */
  move(dx, dy) {
    const now = Date.now();
    if (now - this.lastMoveTime < this.moveCooldown) return false;

    this.lastMoveTime = now;
    this.setPosition(this.x + dx, this.y + dy);
    this.activate();

    // Notify callback
    this.callbacks.onMove?.(this.x, this.y);

    return true;
  }

  /**
   * Get current position
   */
  getPosition() {
    return { x: this.x, y: this.y };
  }

  /**
   * Show the cursor
   */
  show() {
    this.isVisible = true;
  }

  /**
   * Hide the cursor
   */
  hide() {
    this.isVisible = false;
    this.isActive = false;
  }

  /**
   * Activate cursor (show it was used recently)
   */
  activate() {
    this.isActive = true;
    this.isVisible = true;
  }

  /**
   * Handle keyboard input
   */
  handleKeydown(e) {
    if (!this.isVisible) return;

    // Don't handle if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Check if any menu is open (let them handle keys)
    if (this.callbacks.isMenuOpen?.()) return;

    let handled = false;

    // Grid cursor uses arrow keys only (WASD is for camera panning)
    switch (e.key) {
      case 'ArrowUp':
        handled = this.move(0, -1);
        break;
      case 'ArrowDown':
        handled = this.move(0, 1);
        break;
      case 'ArrowLeft':
        handled = this.move(-1, 0);
        break;
      case 'ArrowRight':
        handled = this.move(1, 0);
        break;
      case 'Enter':
      case ' ':
        if (this.isActive) {
          e.preventDefault();
          this.callbacks.onSelect?.(this.x, this.y);
          handled = true;
        }
        break;
      case 'Tab':
        e.preventDefault();
        this.callbacks.onCycleUnit?.(e.shiftKey ? -1 : 1);
        handled = true;
        break;
    }

    if (handled) {
      e.preventDefault();
    }
  }

  /**
   * Update animation
   */
  update(deltaTime) {
    if (!this.isVisible) return;

    // Pulse animation
    this.pulsePhase += deltaTime * 3;
    this.opacity = 0.5 + Math.sin(this.pulsePhase) * 0.2;

    // Fade out if inactive
    if (!this.isActive) {
      this.opacity *= 0.7;
    }
  }

  /**
   * Render the cursor
   */
  render(ctx, camera) {
    if (!this.isVisible || this.opacity < 0.1) return;

    // Get screen position for cursor tile
    const worldPos = this.grid.gridToScreenWorld(this.x, this.y);
    const screenPos = camera.worldToScreen(worldPos.x, worldPos.y);

    // Get tile dimensions for diamond shape
    const tileWidth = this.grid.tileWidth;
    const tileHeight = this.grid.tileHeight;

    ctx.save();

    // Draw diamond cursor
    ctx.strokeStyle = this.color;
    ctx.lineWidth = this.strokeWidth;
    ctx.globalAlpha = this.opacity;

    // Diamond path
    ctx.beginPath();
    ctx.moveTo(screenPos.x, screenPos.y - tileHeight / 2); // Top
    ctx.lineTo(screenPos.x + tileWidth / 2, screenPos.y);   // Right
    ctx.lineTo(screenPos.x, screenPos.y + tileHeight / 2); // Bottom
    ctx.lineTo(screenPos.x - tileWidth / 2, screenPos.y);   // Left
    ctx.closePath();
    ctx.stroke();

    // Inner glow effect when active
    if (this.isActive) {
      ctx.globalAlpha = this.opacity * 0.3;
      ctx.fillStyle = this.color;
      ctx.fill();

      // Outer glow
      ctx.globalAlpha = this.opacity * 0.5;
      ctx.lineWidth = this.strokeWidth + 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Cycle to next/previous unit
   */
  cycleToUnit(units, direction = 1) {
    if (!units || units.length === 0) return;

    // Find current unit at cursor
    let currentIndex = -1;
    for (let i = 0; i < units.length; i++) {
      if (units[i].gridX === this.x && units[i].gridY === this.y) {
        currentIndex = i;
        break;
      }
    }

    // Move to next/previous unit
    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = units.length - 1;
    if (nextIndex >= units.length) nextIndex = 0;

    const nextUnit = units[nextIndex];
    if (nextUnit) {
      this.setPosition(nextUnit.gridX, nextUnit.gridY);
      this.activate();
      this.callbacks.onMove?.(this.x, this.y);
    }
  }

  /**
   * Center cursor on unit
   */
  centerOnUnit(unit) {
    if (unit) {
      this.setPosition(unit.gridX, unit.gridY);
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    document.removeEventListener('keydown', this.boundKeydownHandler);
  }
}
