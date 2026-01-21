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
    this.elevationPixelsPerLevel = 8; // Pixels per elevation level for rendering

    // World-space origin offset (for centering the isometric diamond)
    this.offsetX = 0;
    this.offsetY = 0;

    // Terrain data (generated from seed)
    this.terrain = [];

    // Obstacle layer data
    this.obstacles = [];

    // Elevation data (0 = ground level, 1-3 = elevated, -1 = pit)
    this.elevation = [];

    // Elevation connections for transition indicators
    this.elevationConnections = [];

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
    // Request elevation data for 3D rendering
    const mapData = generateTerrain(seed, nodeType, this.width, this.height, {
      elevation: true
    });

    this.terrain = mapData.terrain;
    this.obstacles = mapData.obstacles;
    this.tileVariants = mapData.variants;

    // Store elevation data if provided
    if (mapData.elevation) {
      this.elevation = mapData.elevation;
    } else {
      // Initialize flat elevation grid if not provided
      this.elevation = Array.from({ length: this.height }, () =>
        Array(this.width).fill(0)
      );
    }
  }

  /**
   * Set elevation data directly (for server-provided battle state)
   * @param {number[][]} elevationGrid - 2D grid of elevation values
   */
  setElevation(elevationGrid) {
    if (elevationGrid && Array.isArray(elevationGrid)) {
      this.elevation = elevationGrid;
    }
  }

  /**
   * Get elevation at position
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @returns {number} Elevation level (0 = ground, 1-3 = elevated, -1 = pit)
   */
  getElevation(x, y) {
    if (!this.isInBounds(x, y)) return 0;

    // Elevation from grid may be 0-1 normalized, convert to discrete levels
    const rawElev = this.elevation[y]?.[x] ?? 0;

    // If normalized (0-1), convert to discrete levels (-1 to 3)
    if (rawElev >= 0 && rawElev <= 1) {
      if (rawElev < 0.25) return -1;  // Pit
      if (rawElev < 0.45) return 0;   // Ground
      if (rawElev < 0.6) return 1;    // Raised
      if (rawElev < 0.75) return 2;   // High
      return 3;                        // Peak
    }

    // Already discrete, return as-is
    return Math.round(rawElev);
  }

  /**
   * Convert grid coordinates to world position (before camera transform)
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @param {boolean} includeElevation - Whether to include elevation offset (default true)
   * @returns {Object} { x, y } world position
   */
  gridToScreenWorld(gridX, gridY, includeElevation = true) {
    const worldX = (gridX - gridY) * (this.tileWidth / 2);
    let worldY = (gridX + gridY) * (this.tileHeight / 2);

    // Apply elevation offset - elevated tiles render higher (lower Y value)
    if (includeElevation) {
      const elevation = this.getElevation(gridX, gridY);
      worldY -= elevation * this.elevationPixelsPerLevel;
    }

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
   *
   * Elevation-aware: When tiles are elevated, they render higher (lower Y).
   * This can cause visual overlap where clicking on an elevated tile's surface
   * could incorrectly map to a tile "behind" it. We check nearby elevated tiles
   * to find the correct visual hit.
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

    // First, get base grid position (ignoring elevation)
    const halfTileWidth = this.tileWidth / 2;
    const halfTileHeight = this.tileHeight / 2;

    const isoX = worldX / halfTileWidth;
    const isoY = worldY / halfTileHeight;

    const baseGridX = Math.round((isoX + isoY) / 2);
    const baseGridY = Math.round((isoY - isoX) / 2);

    // Check if base position is in bounds
    if (!this.isInBounds(baseGridX, baseGridY)) {
      return { x: baseGridX, y: baseGridY };
    }

    // Check for elevated tiles that might visually overlap
    // Tiles in "front" (higher x+y sum) that are elevated can appear
    // to be at the same visual position as tiles behind them
    const candidates = [];

    // Search nearby tiles for elevated ones that might contain the click
    const searchRadius = 3; // Max elevation is 3, so check 3 rows ahead
    for (let dy = -1; dy <= searchRadius; dy++) {
      for (let dx = -1; dx <= searchRadius; dx++) {
        const checkX = baseGridX + dx;
        const checkY = baseGridY + dy;

        if (!this.isInBounds(checkX, checkY)) continue;

        const elevation = this.getElevation(checkX, checkY);

        // Get the world position of this tile (with elevation)
        const tileWorld = this.gridToScreenWorld(checkX, checkY, true);

        // Check if click point is within this tile's diamond
        if (this.isPointInTileDiamond(worldX, worldY, tileWorld.x, tileWorld.y)) {
          // Calculate depth for sorting (higher depth = closer to camera)
          const depth = checkX + checkY;
          candidates.push({ x: checkX, y: checkY, depth, elevation });
        }
      }
    }

    // If we found candidates, return the one closest to the camera (highest depth)
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.depth - a.depth);
      return { x: candidates[0].x, y: candidates[0].y };
    }

    // Fall back to base grid position
    return { x: baseGridX, y: baseGridY };
  }

  /**
   * Check if a world-space point is within a tile's diamond shape
   * @param {number} pointX - Point X in world space
   * @param {number} pointY - Point Y in world space
   * @param {number} tileCenterX - Tile center X in world space
   * @param {number} tileCenterY - Tile center Y in world space
   * @returns {boolean} True if point is inside the tile's diamond
   */
  isPointInTileDiamond(pointX, pointY, tileCenterX, tileCenterY) {
    // Diamond check: for a point to be inside an isometric diamond,
    // |dx| / halfWidth + |dy| / halfHeight <= 1
    const dx = Math.abs(pointX - tileCenterX);
    const dy = Math.abs(pointY - tileCenterY);
    const halfWidth = this.tileWidth / 2;
    const halfHeight = this.tileHeight / 2;

    return (dx / halfWidth) + (dy / halfHeight) <= 1;
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
   * Accounts for elevation by checking extreme elevations at map corners
   */
  getMapPixelDimensions() {
    // For isometric grid, calculate bounding box
    // The isometric diamond has corners at:
    // - Top (north): grid (0, height-1) - negative X, mid Y
    // - Right (east): grid (width-1, 0) - positive X, mid Y
    // - Bottom (south): grid (width-1, height-1) - center X, max Y
    // - Left (west): grid (0, 0) - center X, min Y

    // Use flat coordinates for base positions (elevation = false)
    const north = this.gridToScreenWorld(0, this.height - 1, false);
    const east = this.gridToScreenWorld(this.width - 1, 0, false);
    const south = this.gridToScreenWorld(this.width - 1, this.height - 1, false);
    const west = this.gridToScreenWorld(0, 0, false);

    // Find min/max elevation to expand bounds
    let minElevation = 0;
    let maxElevation = 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const elev = this.getElevation(x, y);
        minElevation = Math.min(minElevation, elev);
        maxElevation = Math.max(maxElevation, elev);
      }
    }

    // Calculate elevation pixel offsets
    const elevationOffset = maxElevation * this.elevationPixelsPerLevel;
    const wallHeight = maxElevation * this.elevationPixelsPerLevel;

    // Correctly calculate bounds considering all corners
    const minX = Math.min(north.x, west.x) - this.tileWidth / 2;
    const maxX = Math.max(east.x, south.x) + this.tileWidth / 2;
    // MinY extends upward for elevated tiles, maxY extends downward for wall faces
    const minY = Math.min(west.y, north.y, east.y) - this.tileHeight / 2 - elevationOffset;
    const maxY = Math.max(south.y, north.y, east.y) + this.tileHeight / 2 + wallHeight;

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
   *
   * Elevation rendering:
   * - Screen position (screenX, screenY) is already elevation-adjusted
   * - Elevated sprites have wall faces extending BELOW the diamond top
   * - Sprite is positioned so the diamond top aligns with screenX/screenY center
   * - Wall faces extend downward from there
   *
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {number} screenX - Screen X position (tile center, elevation-adjusted)
   * @param {number} screenY - Screen Y position (tile center, elevation-adjusted)
   * @param {string} terrain - Terrain type
   * @param {string|null} highlight - Highlight color or null
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  renderTileAt(ctx, screenX, screenY, terrain, highlight = null, gridX = 0, gridY = 0) {
    const variant = this.getTileVariant(gridX, gridY);
    const elevation = this.getElevation(gridX, gridY);

    // Try elevation-specific sprite first for non-zero elevation
    let sprite = null;
    if (elevation !== 0) {
      sprite = this.assetLoader?.getElevatedTile(terrain, elevation, this.nodeType);
    }

    // Fall back to base variant if no elevation sprite
    if (!sprite) {
      sprite = this.assetLoader?.getTile(terrain, this.nodeType, variant);
    }

    if (sprite) {
      // Elevated sprites are taller - wall faces extend below the diamond top
      // The diamond top face (64x64 inscribed area) should be centered at screenX, screenY
      // For elevated tiles: sprite is 64 wide, taller than 64
      // Draw so the TOP of the diamond aligns with flat tile position
      // The extra height extends downward
      const spriteWidth = sprite.width || this.spriteSize;
      const spriteHeight = sprite.height || this.spriteSize;

      // Position sprite so the diamond top face center is at (screenX, screenY)
      // For elevated sprites, the diamond top is at the top of the image
      // Wall faces extend below, so we draw at normal position
      ctx.drawImage(
        sprite,
        screenX - spriteWidth / 2,
        screenY - this.spriteSize / 2,  // Position based on standard tile height
        spriteWidth,
        spriteHeight
      );
    } else {
      // Fallback: Draw isometric diamond with terrain color
      this.renderFallbackTile(ctx, screenX, screenY, terrain, elevation);
    }

    // Apply highlight overlay on top of the tile's visible surface
    // Highlight is drawn at the same screenX/screenY (already elevation-adjusted)
    if (highlight) {
      this.renderTileHighlight(ctx, screenX, screenY, highlight);
    }
  }

  /**
   * Render fallback tile (isometric diamond when no sprite available)
   * Supports elevation rendering with wall faces
   */
  renderFallbackTile(ctx, screenX, screenY, terrain, elevation = 0) {
    const baseColor = this.getTerrainColor(terrain);

    // For elevated tiles, draw wall faces first (they go behind the top)
    if (elevation > 0) {
      const wallHeight = elevation * this.elevationPixelsPerLevel;
      const darkColor = this.darkenColor(baseColor, 0.6);
      const sideColor = this.darkenColor(baseColor, 0.75);

      // South-east wall face (right side, darker)
      ctx.beginPath();
      ctx.moveTo(screenX + this.tileWidth / 2, screenY);                    // Top right
      ctx.lineTo(screenX, screenY + this.tileHeight / 2);                   // Top bottom
      ctx.lineTo(screenX, screenY + this.tileHeight / 2 + wallHeight);      // Bottom
      ctx.lineTo(screenX + this.tileWidth / 2, screenY + wallHeight);       // Bottom right
      ctx.closePath();
      ctx.fillStyle = darkColor;
      ctx.fill();

      // South-west wall face (left side, slightly lighter)
      ctx.beginPath();
      ctx.moveTo(screenX - this.tileWidth / 2, screenY);                    // Top left
      ctx.lineTo(screenX, screenY + this.tileHeight / 2);                   // Top bottom
      ctx.lineTo(screenX, screenY + this.tileHeight / 2 + wallHeight);      // Bottom
      ctx.lineTo(screenX - this.tileWidth / 2, screenY + wallHeight);       // Bottom left
      ctx.closePath();
      ctx.fillStyle = sideColor;
      ctx.fill();
    }

    // Draw top diamond face
    ctx.beginPath();
    ctx.moveTo(screenX, screenY - this.tileHeight / 2);           // Top
    ctx.lineTo(screenX + this.tileWidth / 2, screenY);            // Right
    ctx.lineTo(screenX, screenY + this.tileHeight / 2);           // Bottom
    ctx.lineTo(screenX - this.tileWidth / 2, screenY);            // Left
    ctx.closePath();

    // Fill with terrain color
    ctx.fillStyle = baseColor;
    ctx.fill();

    // Draw outline
    ctx.strokeStyle = '#2a2a4a';
    ctx.lineWidth = 1;
    ctx.stroke();

    // For pits, draw a darker inset to show depth
    if (elevation < 0) {
      const darkColor = this.darkenColor(baseColor, 0.5);

      // Draw a smaller inset diamond to show depth (inset scales with pit depth)
      const inset = 4 + Math.abs(elevation);
      ctx.beginPath();
      ctx.moveTo(screenX, screenY - this.tileHeight / 2 + inset);
      ctx.lineTo(screenX + this.tileWidth / 2 - inset * 2, screenY);
      ctx.lineTo(screenX, screenY + this.tileHeight / 2 - inset);
      ctx.lineTo(screenX - this.tileWidth / 2 + inset * 2, screenY);
      ctx.closePath();
      ctx.fillStyle = darkColor;
      ctx.fill();
    }
  }

  /**
   * Darken a hex color by a factor
   */
  darkenColor(hex, factor) {
    // Parse hex color
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return hex;

    const r = Math.round(parseInt(result[1], 16) * factor);
    const g = Math.round(parseInt(result[2], 16) * factor);
    const b = Math.round(parseInt(result[3], 16) * factor);

    return `rgb(${r},${g},${b})`;
  }

  /**
   * Render tile highlight overlay
   */
  renderTileHighlight(ctx, screenX, screenY, highlight) {
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
    } else {
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
   * Build a sorted list of tiles for rendering (painter's algorithm)
   * Sorts by depth: back-to-front, with elevation affecting sort order
   * @param {Object} camera - Optional camera for culling
   * @returns {Array} Array of { x, y, screenX, screenY, depth } sorted back-to-front
   */
  buildRenderOrder(camera = null) {
    const tiles = [];

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const screenPos = this.gridToScreen(x, y, camera);

        // Cull tiles that are off-screen (with margin for elevated tiles)
        if (camera) {
          const margin = 64; // Extra margin for tall elevated tiles
          if (screenPos.x < -this.tileWidth - margin ||
              screenPos.x > this.canvas.width + this.tileWidth + margin ||
              screenPos.y < -this.tileHeight - margin ||
              screenPos.y > this.canvas.height + this.tileHeight + margin * 3) {
            continue;
          }
        }

        const elevation = this.getElevation(x, y);

        // Depth calculation for painter's algorithm:
        // Base depth is sum of x + y (isometric row)
        // Subtract small elevation factor so higher tiles render slightly later
        // This ensures wall faces of elevated tiles render behind adjacent flat tiles
        const baseDepth = x + y;
        const elevationFactor = elevation * 0.001; // Small factor to not disrupt row order
        const depth = baseDepth - elevationFactor;

        tiles.push({ x, y, screenX: screenPos.x, screenY: screenPos.y, depth, elevation });
      }
    }

    // Sort back-to-front (lower depth first)
    tiles.sort((a, b) => a.depth - b.depth);

    return tiles;
  }

  /**
   * Render the entire grid with optional camera
   */
  render(ctx, highlights = {}, camera = null) {
    // Build sorted render order
    const renderOrder = this.buildRenderOrder(camera);

    // Render all tiles in sorted order (terrain + obstacles together)
    for (const tile of renderOrder) {
      const terrain = this.getTerrain(tile.x, tile.y);
      const key = `${tile.x},${tile.y}`;
      const highlight = highlights[key] || null;

      // Render terrain tile
      this.renderTileAt(ctx, tile.screenX, tile.screenY, terrain, highlight, tile.x, tile.y);

      // Render obstacle if present (drawn right after its terrain for proper layering)
      const obstacle = this.getObstacle(tile.x, tile.y);
      if (obstacle) {
        this.renderObstacleAt(ctx, tile.screenX, tile.screenY, obstacle);
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

  /**
   * Cleanup resources - call when BattleGrid is destroyed
   * Stops any running timers and clears state
   */
  destroy() {
    this.clearIntentHighlights();
    this.terrain = null;
    this.elevation = null;
    this.tileVariants = null;
    this.obstacles = null;
  }
}
