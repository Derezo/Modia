/**
 * BattleGrid - Isometric grid rendering for tactical combat (supports 32x32 with camera)
 *
 * Uses shared modules for terrain generation to ensure server/client consistency.
 */
import { generateTerrain } from '@shared/mapGeneration.js';
import { isImpassable, getTerrainMovementCost, getTerrainColor } from '@shared/terrain.js';

export class BattleGrid {
  constructor(canvas, width = 32, height = 32) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;
    this.tileWidth = 64;   // Visual diamond width (for grid spacing)
    this.tileHeight = 32;  // Visual diamond height (for grid spacing)
    this.spriteSize = 64;  // Sprite canvas size (64x64 with diamond inscribed)

    // World-space origin offset (for centering the isometric diamond)
    this.offsetX = 0;
    this.offsetY = 0;

    // Terrain data (generated from seed)
    this.terrain = [];

    // Obstacle layer data
    this.obstacles = [];

    // Asset loader reference (set externally)
    this.assetLoader = null;

    // Current node type for biome-specific sprites
    this.nodeType = 'forest';

    // Tile variant mapping for visual variety (seeded per-tile)
    this.tileVariants = [];

    // Intent highlight state (for enemy visualization)
    this.intentHighlights = new Map();  // key -> { color, endTime, pulsePhase }
    this.intentHighlightTimer = null;
  }

  /**
   * Set the asset loader for sprite rendering
   */
  setAssetLoader(assetLoader) {
    this.assetLoader = assetLoader;
  }

  /**
   * Generate terrain from a seed value using shared mapGeneration module
   * This ensures server/client terrain is identical for the same seed
   */
  generateTerrain(seed, nodeType = 'forest') {
    this.nodeType = nodeType;

    // Use shared generateTerrain for deterministic map generation
    const mapData = generateTerrain(seed, nodeType, this.width, this.height);

    this.terrain = mapData.terrain;
    this.obstacles = mapData.obstacles;
    this.tileVariants = mapData.variants;
  }

  /**
   * Convert grid coordinates to world position (before camera transform)
   */
  gridToScreenWorld(gridX, gridY) {
    const worldX = (gridX - gridY) * (this.tileWidth / 2);
    const worldY = (gridX + gridY) * (this.tileHeight / 2);
    return { x: worldX, y: worldY };
  }

  /**
   * Convert grid coordinates to screen position
   * If camera is provided, applies camera transform
   */
  gridToScreen(gridX, gridY, camera = null) {
    const world = this.gridToScreenWorld(gridX, gridY);
    if (camera) {
      return camera.worldToScreen(world.x, world.y);
    }
    // Fallback for non-camera usage (legacy)
    return {
      x: world.x + this.canvas.width / 2,
      y: world.y + 120
    };
  }

  /**
   * Convert screen position to grid coordinates
   * If camera is provided, applies camera transform
   */
  screenToGrid(screenX, screenY, camera = null) {
    let worldX, worldY;
    if (camera) {
      const world = camera.screenToWorld(screenX, screenY);
      worldX = world.x;
      worldY = world.y;
    } else {
      // Fallback for non-camera usage (legacy)
      worldX = screenX - this.canvas.width / 2;
      worldY = screenY - 120;
    }

    // Isometric to grid conversion with proper rounding
    // Use round instead of floor for better centering on tile diamonds
    const halfTileWidth = this.tileWidth / 2;
    const halfTileHeight = this.tileHeight / 2;

    // Convert world coords to isometric grid coords
    const isoX = worldX / halfTileWidth;
    const isoY = worldY / halfTileHeight;

    // Grid coords from isometric (with rounding for center-of-tile detection)
    const gridX = Math.round((isoX + isoY) / 2);
    const gridY = Math.round((isoY - isoX) / 2);

    return { x: gridX, y: gridY };
  }

  /**
   * Check if coordinates are within grid bounds
   */
  isInBounds(x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /**
   * Get terrain at position
   */
  getTerrain(x, y) {
    if (!this.isInBounds(x, y)) return null;
    return this.terrain[y]?.[x] || 'grass';
  }

  /**
   * Check if terrain is impassable (uses shared terrain module)
   */
  isImpassable(terrain) {
    return isImpassable(terrain);
  }

  /**
   * Check if a tile is walkable
   */
  isWalkable(x, y) {
    if (!this.isInBounds(x, y)) return false;
    const terrain = this.getTerrain(x, y);
    return !isImpassable(terrain);
  }

  /**
   * Get terrain movement cost (uses shared terrain module)
   */
  getMovementCost(x, y) {
    const terrain = this.getTerrain(x, y);
    return getTerrainMovementCost(terrain);
  }

  /**
   * Get terrain color for rendering (uses shared terrain module)
   */
  getTerrainColor(terrain) {
    return getTerrainColor(terrain);
  }

  /**
   * Calculate the pixel dimensions of the entire map in world space
   */
  getMapPixelDimensions() {
    // For isometric grid, calculate bounding box
    // The isometric diamond has corners at:
    // - Top (north): grid (0, height-1) - negative X, mid Y
    // - Right (east): grid (width-1, 0) - positive X, mid Y
    // - Bottom (south): grid (width-1, height-1) - center X, max Y
    // - Left (west): grid (0, 0) - center X, min Y

    const north = this.gridToScreenWorld(0, this.height - 1);
    const east = this.gridToScreenWorld(this.width - 1, 0);
    const south = this.gridToScreenWorld(this.width - 1, this.height - 1);
    const west = this.gridToScreenWorld(0, 0);

    // Correctly calculate bounds considering all corners
    const minX = Math.min(north.x, west.x) - this.tileWidth / 2;
    const maxX = Math.max(east.x, south.x) + this.tileWidth / 2;
    const minY = Math.min(west.y, north.y, east.y) - this.tileHeight / 2;
    const maxY = Math.max(south.y, north.y, east.y) + this.tileHeight / 2;

    return {
      width: maxX - minX,
      height: maxY - minY,
      // World-space bounds
      worldMinX: minX,
      worldMinY: minY,
      worldMaxX: maxX,
      worldMaxY: maxY,
      // Legacy offset (for non-camera rendering)
      offsetX: -minX,
      offsetY: -minY
    };
  }

  /**
   * Get the center of the map in world coordinates
   */
  getMapCenter() {
    const centerX = Math.floor(this.width / 2);
    const centerY = Math.floor(this.height / 2);
    return this.gridToScreenWorld(centerX, centerY);
  }

  /**
   * Render a single isometric tile at screen position
   */
  renderTileAt(ctx, screenX, screenY, terrain, highlight = null, gridX = 0, gridY = 0) {
    // Try to render sprite if asset loader is available
    const sprite = this.assetLoader?.getTile(terrain, this.nodeType, this.getTileVariant(gridX, gridY));

    if (sprite) {
      // Draw 64x64 sprite centered on tile position
      // Diamond center is at canvas center, so offset by half sprite size
      ctx.drawImage(
        sprite,
        screenX - this.spriteSize / 2,
        screenY - this.spriteSize / 2,
        this.spriteSize,
        this.spriteSize
      );
    } else {
      // Fallback: Draw isometric diamond with color
      ctx.beginPath();
      ctx.moveTo(screenX, screenY - this.tileHeight / 2);           // Top
      ctx.lineTo(screenX + this.tileWidth / 2, screenY);            // Right
      ctx.lineTo(screenX, screenY + this.tileHeight / 2);           // Bottom
      ctx.lineTo(screenX - this.tileWidth / 2, screenY);            // Left
      ctx.closePath();

      // Fill with terrain color
      ctx.fillStyle = this.getTerrainColor(terrain);
      ctx.fill();

      // Draw outline
      ctx.strokeStyle = '#2a2a4a';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Apply highlight overlay (always on top)
    if (highlight) {
      ctx.beginPath();
      ctx.moveTo(screenX, screenY - this.tileHeight / 2);
      ctx.lineTo(screenX + this.tileWidth / 2, screenY);
      ctx.lineTo(screenX, screenY + this.tileHeight / 2);
      ctx.lineTo(screenX - this.tileWidth / 2, screenY);
      ctx.closePath();

      // First darken the tile for contrast
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fill();

      // Then apply the colored highlight
      ctx.fillStyle = highlight;
      ctx.fill();

      // Add a subtle border for better visibility
      ctx.strokeStyle = highlight.replace(/[\d.]+\)$/, '0.8)');
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  /**
   * Get tile variant for visual variety
   */
  getTileVariant(gridX, gridY) {
    return this.tileVariants[gridY]?.[gridX] || 0;
  }

  /**
   * Render obstacle at screen position
   */
  renderObstacleAt(ctx, screenX, screenY, obstacle) {
    if (!obstacle) return;

    const sprite = this.assetLoader?.getObstacle(obstacle.variant, obstacle.type);

    if (sprite) {
      // Obstacles are drawn above the tile, offset upward
      const obstacleHeight = sprite.height || 64;
      ctx.drawImage(
        sprite,
        screenX - sprite.width / 2,
        screenY - obstacleHeight + this.tileHeight / 2,
        sprite.width,
        sprite.height
      );
    } else if (obstacle.type !== 'decorative') {
      // Fallback: Draw a simple shape for impassable obstacles
      ctx.fillStyle = obstacle.type === 'trees' ? '#2d4a2d' : '#4a4a4a';
      ctx.beginPath();
      if (obstacle.type === 'trees') {
        // Triangle for trees
        ctx.moveTo(screenX, screenY - 40);
        ctx.lineTo(screenX + 16, screenY);
        ctx.lineTo(screenX - 16, screenY);
      } else {
        // Rectangle for rocks
        ctx.rect(screenX - 12, screenY - 20, 24, 20);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /**
   * Render a single isometric tile (legacy method without camera)
   */
  renderTile(ctx, gridX, gridY, highlight = null) {
    const { x, y } = this.gridToScreen(gridX, gridY);
    const terrain = this.getTerrain(gridX, gridY);
    this.renderTileAt(ctx, x, y, terrain, highlight, gridX, gridY);
  }

  /**
   * Get obstacle at position
   */
  getObstacle(x, y) {
    if (!this.isInBounds(x, y)) return null;
    return this.obstacles[y]?.[x] || null;
  }

  /**
   * Render the entire grid with optional camera
   */
  render(ctx, highlights = {}, camera = null) {
    // If no camera, use simple full render
    if (!camera) {
      // First pass: render terrain
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const key = `${x},${y}`;
          const highlight = highlights[key] || null;
          this.renderTile(ctx, x, y, highlight);
        }
      }
      // Second pass: render obstacles (back to front for proper layering)
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const { x: screenX, y: screenY } = this.gridToScreen(x, y);
          const obstacle = this.getObstacle(x, y);
          this.renderObstacleAt(ctx, screenX, screenY, obstacle);
        }
      }
      return;
    }

    // With camera, render only visible tiles (with culling)
    // First pass: terrain tiles
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const screenPos = this.gridToScreen(x, y, camera);

        // Cull tiles that are off-screen
        if (screenPos.x < -this.tileWidth || screenPos.x > this.canvas.width + this.tileWidth ||
            screenPos.y < -this.tileHeight || screenPos.y > this.canvas.height + this.tileHeight) {
          continue;
        }

        const terrain = this.getTerrain(x, y);
        const key = `${x},${y}`;
        const highlight = highlights[key] || null;
        this.renderTileAt(ctx, screenPos.x, screenPos.y, terrain, highlight, x, y);
      }
    }

    // Second pass: obstacles (rendered after terrain for proper layering)
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const screenPos = this.gridToScreen(x, y, camera);

        // Cull obstacles that are off-screen (with larger margin for tall obstacles)
        if (screenPos.x < -this.tileWidth * 2 || screenPos.x > this.canvas.width + this.tileWidth * 2 ||
            screenPos.y < -100 || screenPos.y > this.canvas.height + this.tileHeight) {
          continue;
        }

        const obstacle = this.getObstacle(x, y);
        this.renderObstacleAt(ctx, screenPos.x, screenPos.y, obstacle);
      }
    }
  }

  /**
   * Get tile at screen position (for click detection)
   */
  getTileAtScreen(screenX, screenY, camera = null) {
    const { x, y } = this.screenToGrid(screenX, screenY, camera);
    if (this.isInBounds(x, y)) {
      return { x, y };
    }
    return null;
  }

  // =========================================================================
  // INTENT HIGHLIGHT SYSTEM (for enemy turn visualization)
  // =========================================================================

  /**
   * Get highlight color for intent type
   */
  getIntentHighlightColor(highlightType) {
    const colors = {
      movement_range: 'rgba(64, 128, 255, 0.4)',    // Blue - movement options
      attack_range: 'rgba(255, 64, 64, 0.4)',       // Red - attack options
      target_path: 'rgba(255, 200, 64, 0.5)',       // Gold - selected path
      target_tile: 'rgba(255, 64, 64, 0.6)',        // Bright red - attack target
      aoe: 'rgba(200, 64, 255, 0.5)'                // Purple - area of effect
    };
    return colors[highlightType] || 'rgba(255, 255, 255, 0.3)';
  }

  /**
   * Show intent highlight for enemy visualization
   * @param {string} highlightType - Type of highlight (movement_range, attack_range, etc.)
   * @param {Array} tiles - Array of { x, y } tile positions
   * @param {number} duration - Duration to show highlight (ms)
   */
  showIntentHighlight(highlightType, tiles, duration = 500) {
    const color = this.getIntentHighlightColor(highlightType);
    const endTime = Date.now() + duration;
    const isPulsing = highlightType === 'target_tile';

    // Clear existing highlights of same type
    this.clearIntentHighlightsByType(highlightType);

    // Add new highlights
    for (const tile of tiles) {
      const key = `${tile.x},${tile.y}`;
      this.intentHighlights.set(key, {
        type: highlightType,
        color,
        endTime,
        isPulsing,
        pulsePhase: 0
      });
    }

    // Start cleanup timer if not already running
    if (!this.intentHighlightTimer) {
      this.intentHighlightTimer = setInterval(() => this.updateIntentHighlights(), 50);
    }
  }

  /**
   * Clear intent highlights of a specific type
   */
  clearIntentHighlightsByType(highlightType) {
    for (const [key, highlight] of this.intentHighlights.entries()) {
      if (highlight.type === highlightType) {
        this.intentHighlights.delete(key);
      }
    }
  }

  /**
   * Clear all intent highlights
   */
  clearIntentHighlights() {
    this.intentHighlights.clear();
    if (this.intentHighlightTimer) {
      clearInterval(this.intentHighlightTimer);
      this.intentHighlightTimer = null;
    }
  }

  /**
   * Update intent highlights (remove expired, update pulse)
   */
  updateIntentHighlights() {
    const now = Date.now();
    let hasActiveHighlights = false;

    for (const [key, highlight] of this.intentHighlights.entries()) {
      if (now >= highlight.endTime) {
        this.intentHighlights.delete(key);
      } else {
        hasActiveHighlights = true;
        // Update pulse phase for pulsing highlights
        if (highlight.isPulsing) {
          highlight.pulsePhase = (highlight.pulsePhase + 0.15) % (Math.PI * 2);
        }
      }
    }

    // Stop timer if no active highlights
    if (!hasActiveHighlights && this.intentHighlightTimer) {
      clearInterval(this.intentHighlightTimer);
      this.intentHighlightTimer = null;
    }
  }

  /**
   * Get combined highlights (merges intent highlights with passed highlights)
   */
  getCombinedHighlights(passedHighlights = {}) {
    const combined = { ...passedHighlights };

    for (const [key, highlight] of this.intentHighlights.entries()) {
      // Intent highlights take precedence over regular highlights
      let color = highlight.color;

      // Apply pulse effect for pulsing highlights
      if (highlight.isPulsing) {
        const pulse = (Math.sin(highlight.pulsePhase) + 1) / 2;  // 0-1
        const alpha = 0.4 + pulse * 0.4;  // 0.4-0.8
        color = color.replace(/[\d.]+\)$/, `${alpha})`);
      }

      combined[key] = color;
    }

    return combined;
  }

  /**
   * Render with intent highlights
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Object} highlights - Regular highlights
   * @param {Object} camera - Camera for screen transforms
   */
  renderWithIntentHighlights(ctx, highlights = {}, camera = null) {
    const combinedHighlights = this.getCombinedHighlights(highlights);
    this.render(ctx, combinedHighlights, camera);
  }
}
