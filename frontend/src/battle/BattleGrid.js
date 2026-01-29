/**
 * @module BattleGrid
 * @description Isometric grid rendering for tactical combat with unified stacking tile system.
 *
 * Key responsibilities:
 * - Grid coordinate to screen position conversion (isometric projection)
 * - Terrain rendering with elevation via stacking tiles (floor + wall strips)
 * - Occlusion detection for units behind elevated tiles
 * - Movement range and attack preview highlighting
 * - Intent highlight system for enemy turn visualization
 *
 * Rendering System (Unified Stacking):
 * - Floor tiles: 64x64 sprites with diamond mask (flat texture + isometric transform)
 * - Wall strips: 64x16 sprites stacked vertically for elevation
 * - Procedural fallback: Colored polygons when sprites unavailable
 *
 * @see BattleCamera.js - Camera transforms and viewport
 * @see BattleScene.js - Orchestrates grid rendering
 * @see AssetLoader.js - Provides tile sprites and wall textures
 * @see shared/terrain.js - Terrain types, movement costs, elevation limits
 */
import { generateTerrain } from '@shared/mapGeneration.js';
import { isImpassable, getTerrainMovementCost, getTerrainColor, discretizeElevation, getElevationName } from '@shared/terrain.js';

// Stacking tile rendering constants
const WALL_HEIGHT_PER_LEVEL = 16; // Pixels per elevation level for wall faces
const OCCLUSION_ALPHA = 0.35; // Transparency for tiles blocking units
// Note: Elevation limits (-3 to +8) are defined in shared/terrain.js as ELEVATION_LEVELS

export class BattleGrid {
  constructor(canvas, width = 32, height = 32) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;
    this.tileWidth = 64;   // Visual diamond width (for grid spacing)
    this.tileHeight = 32;  // Visual diamond height (for grid spacing)
    this.spriteSize = 64;  // Sprite canvas size (64x64 with diamond inscribed)
    this.elevationPixelsPerLevel = WALL_HEIGHT_PER_LEVEL; // Pixels per elevation level for rendering

    // Stacking tile system state
    this.useStackingTiles = true; // Enable new stacking tile rendering
    this.occlusionCache = new Map(); // Cache for occlusion calculations
    this.occlusionCacheDirty = true; // Flag to invalidate cache

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
   * Get elevation at position (discrete level)
   * Uses shared discretizeElevation for consistency with pathfinding
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @returns {number} Elevation level (0 = ground, 1-3 = elevated, -1 = pit)
   */
  getElevation(x, y) {
    if (!this.isInBounds(x, y)) return 0;
    const rawElev = this.elevation[y]?.[x] ?? 0;
    return discretizeElevation(rawElev);
  }

  /**
   * Get elevation name for UI display
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @returns {string} Human-readable elevation name
   */
  getElevationName(x, y) {
    return getElevationName(this.getElevation(x, y));
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
   * Render a simple terrain diamond (for top surface fallback)
   */
  renderTerrainDiamond(ctx, screenX, screenY, terrain) {
    const baseColor = this.getTerrainColor(terrain);

    ctx.beginPath();
    ctx.moveTo(screenX, screenY - this.tileHeight / 2);
    ctx.lineTo(screenX + this.tileWidth / 2, screenY);
    ctx.lineTo(screenX, screenY + this.tileHeight / 2);
    ctx.lineTo(screenX - this.tileWidth / 2, screenY);
    ctx.closePath();

    ctx.fillStyle = baseColor;
    ctx.fill();

    ctx.strokeStyle = '#2a2a4a';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /**
   * Get wall color based on terrain type
   * @param {string} terrain - Terrain type
   * @param {number} _elevation - Elevation level (reserved for depth-based color variation)
   * @returns {string} Hex color for wall
   */
  getWallColor(terrain, _elevation) {
    const baseColors = {
      grass: '#5a4a2a',
      stone: '#6b6b6b',
      forest: '#4a3a2a',
      water: '#3a5a6a',
      rock: '#5a5a5a',
      cliff: '#4a4a4a',
      lava: '#8b2a0a',
      tree: '#3a2a1a',
      default: '#5a4a3a'
    };
    return baseColors[terrain] || baseColors.default;
  }

  // =========================================================================
  // OCCLUSION DETECTION SYSTEM
  // =========================================================================

  /**
   * Check if a unit is visually occluded by a tile
   * A unit is occluded if a tile is "in front" of it in isometric space and tall enough to block
   *
   * @param {Object} unit - Unit with gridX, gridY, z properties
   * @param {Object} tile - Tile with x, y, elevation properties
   * @returns {boolean} True if the tile occludes the unit
   */
  isUnitOccludedBy(unit, tile) {
    const unitX = unit.gridX ?? unit.x ?? unit.tileX;
    const unitY = unit.gridY ?? unit.y ?? unit.tileY;
    const unitZ = unit.z ?? unit.elevation ?? 0;

    const tileX = tile.x;
    const tileY = tile.y;
    const tileZ = tile.elevation ?? 0;

    // Tile is "in front" in isometric space if (tileX + tileY) > (unitX + unitY)
    const tileDepth = tileX + tileY;
    const unitDepth = unitX + unitY;

    if (tileDepth <= unitDepth) return false;

    // Tile must be tall enough to block the unit
    // Consider both vertical distance and tile height
    const tileHeight = Math.max(0, tileZ) * WALL_HEIGHT_PER_LEVEL;
    const unitVisualY = unitZ * WALL_HEIGHT_PER_LEVEL;

    // Check if tile's wall would visually overlap with unit's position
    // Tighten depth check - only tiles immediately in front can occlude
    const depthDiff = tileDepth - unitDepth;
    if (depthDiff > 1) return false; // Only 1 row forward can occlude

    // Add horizontal proximity check - tile must be near the unit
    const horizontalDist = Math.abs(tileX - unitX) + Math.abs(tileY - unitY);
    if (horizontalDist > 2) return false; // Too far away horizontally

    return tileHeight > unitVisualY + 8; // 8px buffer
  }

  /**
   * Get all units that would be occluded by a tile
   * @param {Object} tile - Tile to check
   * @param {Array} units - All units on the battlefield
   * @returns {Array} Units that are occluded by this tile
   */
  getOccludedUnits(tile, units) {
    if (!units || units.length === 0) return [];
    return units.filter(unit => this.isUnitOccludedBy(unit, tile));
  }

  /**
   * Build occlusion map for all tiles given current unit positions
   * @param {Array} units - All units on the battlefield
   * @returns {Map} Map of "x,y" -> occluded (boolean)
   */
  buildOcclusionMap(units) {
    const occlusionMap = new Map();

    if (!units || units.length === 0) return occlusionMap;

    // For each tile with elevation > 0, check if it occludes any unit
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const elevation = this.getElevation(x, y);
        if (elevation <= 0) continue; // Only elevated tiles can occlude

        const tile = { x, y, elevation };
        const occludedUnits = this.getOccludedUnits(tile, units);

        if (occludedUnits.length > 0) {
          occlusionMap.set(`${x},${y}`, true);
        }
      }
    }

    return occlusionMap;
  }

  /**
   * Invalidate occlusion cache (call when units move)
   */
  invalidateOcclusionCache() {
    this.occlusionCacheDirty = true;
    this.occlusionCache.clear();
  }

  /**
   * Update occlusion cache if dirty
   * @param {Array} units - Current unit positions
   */
  updateOcclusionCache(units) {
    if (!this.occlusionCacheDirty) return;

    this.occlusionCache = this.buildOcclusionMap(units);
    this.occlusionCacheDirty = false;
  }

  /**
   * Check if a tile should be rendered with occlusion transparency
   * @param {number} x - Grid X
   * @param {number} y - Grid Y
   * @returns {boolean} True if tile should be transparent
   */
  isTileOccluding(x, y) {
    return this.occlusionCache.get(`${x},${y}`) || false;
  }

  // =========================================================================
  // ENHANCED RENDER METHODS WITH STACKING TILES
  // =========================================================================

  /**
   * Get the sprite biome string for current node type
   * @returns {string} Biome directory name
   */
  getSpriteBiome() {
    const biomeMap = {
      cave: 'cave',
      mountain: 'mountain',
      forest: 'forest',
      bridge: 'bridge',
      castle: 'castle',
      village: 'base',
      city: 'base',
      default: 'base'
    };
    return biomeMap[this.nodeType] || biomeMap.default;
  }

  /**
   * Render the grid with stacking tiles and occlusion
   * Uses the unified stacking tile system for consistent elevation rendering
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Object} highlights - Highlight map { "x,y": color }
   * @param {Object} camera - Camera for transforms
   * @param {Array} units - Units for occlusion calculation (optional)
   */
  renderWithOcclusion(ctx, highlights = {}, camera = null, units = []) {
    // Update occlusion cache if needed
    if (units && units.length > 0) {
      this.updateOcclusionCache(units);
    }

    // Use the standard render method which now uses unified stacking
    this.render(ctx, highlights, camera);
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
   * Uses the unified stacking tile system for consistent elevation rendering
   */
  render(ctx, highlights = {}, camera = null) {
    // Merge intent highlights with passed highlights
    const combinedHighlights = this.getCombinedHighlights(highlights);

    // Build sorted render order
    const renderOrder = this.buildRenderOrder(camera);

    // Render all tiles in sorted order using unified stacking system
    for (const tile of renderOrder) {
      const key = `${tile.x},${tile.y}`;
      const highlight = combinedHighlights[key] || null;

      // Use unified rendering (stacking system - separate floor + wall tiles)
      this.renderTileUnified(ctx, tile.screenX, tile.screenY, tile.x, tile.y, highlight);

      // Render obstacle if present (drawn right after its terrain for proper layering)
      const obstacle = this.getObstacle(tile.x, tile.y);
      if (obstacle) {
        this.renderObstacleAt(ctx, tile.screenX, tile.screenY, obstacle);
      }
    }
  }

  /**
   * Get tile at screen position (for click detection)
   * @param {number} screenX - Screen X position
   * @param {number} screenY - Screen Y position
   * @param {Object} camera - Camera for transforms
   * @param {boolean} returnAllCandidates - If true, returns array of all candidates
   * @returns {Object|Array|null} Single tile, array of candidates, or null
   */
  getTileAtScreen(screenX, screenY, camera = null, returnAllCandidates = false) {
    if (returnAllCandidates) {
      return this.screenToGridCandidates(screenX, screenY, camera);
    }
    const { x, y } = this.screenToGrid(screenX, screenY, camera);
    if (this.isInBounds(x, y)) {
      return { x, y };
    }
    return null;
  }

  /**
   * Get all tile candidates at a screen position (for tile cycling on overlapping elevations)
   * Returns all tiles whose visual diamond contains the click point, sorted by depth (front-to-back)
   *
   * @param {number} screenX - Screen X position
   * @param {number} screenY - Screen Y position
   * @param {Object} camera - Camera for transforms
   * @returns {Array} Array of { x, y, depth, elevation } sorted front-to-back (highest depth first)
   */
  screenToGridCandidates(screenX, screenY, camera = null) {
    let worldX, worldY;
    if (camera) {
      const world = camera.screenToWorld(screenX, screenY);
      worldX = world.x;
      worldY = world.y;
    } else {
      worldX = screenX - this.canvas.width / 2;
      worldY = screenY - 120;
    }

    // Get base grid position (ignoring elevation)
    const halfTileWidth = this.tileWidth / 2;
    const halfTileHeight = this.tileHeight / 2;

    const isoX = worldX / halfTileWidth;
    const isoY = worldY / halfTileHeight;

    const baseGridX = Math.round((isoX + isoY) / 2);
    const baseGridY = Math.round((isoY - isoX) / 2);

    const candidates = [];

    // Search nearby tiles for elevated ones that might contain the click
    // Max elevation is 8, so check up to 8 rows ahead
    const searchRadius = 8;
    for (let dy = -2; dy <= searchRadius; dy++) {
      for (let dx = -2; dx <= searchRadius; dx++) {
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

    // Sort front-to-back (highest depth first - closest to camera)
    candidates.sort((a, b) => b.depth - a.depth);

    return candidates;
  }

  // =========================================================================
  // UNIFIED TILE RENDERING (Pure Stacking System)
  // =========================================================================

  /**
   * Render a single tile using the unified stacking system
   * This is the new standard rendering method - separate floor + wall tiles
   *
   * Rendering order:
   * 1. For elevation > 0: render wall strips stacked bottom-to-top, then floor on top
   * 2. For elevation = 0: render floor tile only
   * 3. For elevation < 0: render pit with inset shadow
   *
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {number} screenX - Screen X position (tile center)
   * @param {number} screenY - Screen Y position (tile center, already elevation-adjusted)
   * @param {number} gridX - Grid X position
   * @param {number} gridY - Grid Y position
   * @param {string} highlight - Optional highlight color
   */
  renderTileUnified(ctx, screenX, screenY, gridX, gridY, highlight = null) {
    const terrain = this.getTerrain(gridX, gridY);
    const elevation = this.getElevation(gridX, gridY);
    const variant = this.getTileVariant(gridX, gridY);
    const biome = this.getSpriteBiome();

    // Check if this tile should be rendered with occlusion transparency
    const alpha = this.isTileOccluding(gridX, gridY) ? OCCLUSION_ALPHA : 1.0;

    ctx.save();
    if (alpha < 1.0) {
      ctx.globalAlpha = alpha;
    }

    if (elevation > 0) {
      // Elevated tiles: render wall strips + floor on top
      // screenY is already elevation-adjusted, so calculate base position
      const wallHeight = elevation * WALL_HEIGHT_PER_LEVEL;
      const baseScreenY = screenY + wallHeight; // Ground level position

      // Render wall faces (procedural or textured)
      this.renderUnifiedWalls(ctx, screenX, baseScreenY, elevation, terrain, biome);

      // Render floor tile on top (at elevated position)
      this.renderUnifiedFloor(ctx, screenX, screenY, terrain, biome, variant);
    } else if (elevation < 0) {
      // Pit tiles: render floor with inset shadow
      this.renderUnifiedPit(ctx, screenX, screenY, terrain, biome, variant, elevation);
    } else {
      // Ground level: render floor tile only
      this.renderUnifiedFloor(ctx, screenX, screenY, terrain, biome, variant);
    }

    ctx.restore();

    // Apply highlight on top
    if (highlight) {
      this.renderTileHighlight(ctx, screenX, screenY, highlight);
    }
  }

  /**
   * Render wall faces for elevated tiles using the stacking system
   * Walls are rendered as stacked strips from bottom to top
   *
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {number} screenX - Tile center X
   * @param {number} screenY - Ground level Y (base of the wall)
   * @param {number} elevation - Number of elevation levels
   * @param {string} terrain - Terrain type
   * @param {string} biome - Biome type
   */
  renderUnifiedWalls(ctx, screenX, screenY, elevation, terrain, biome) {
    const wallTexture = this.assetLoader?.getWallTexture(biome, terrain);
    const halfWidth = this.tileWidth / 2;
    const halfHeight = this.tileHeight / 2;
    const wallHeight = elevation * WALL_HEIGHT_PER_LEVEL;
    const topY = screenY - wallHeight; // Where the floor sits

    if (wallTexture) {
      // Textured wall rendering - tile the texture vertically
      this.renderTexturedWall(ctx, screenX, topY, screenY, wallTexture, halfWidth, halfHeight);
    } else {
      // Procedural wall rendering - colored polygons
      this.renderProceduralWall(ctx, screenX, topY, screenY, terrain, halfWidth, halfHeight);
    }
  }

  /**
   * Render textured wall faces
   */
  renderTexturedWall(ctx, screenX, topY, bottomY, wallTexture, halfWidth, halfHeight) {
    const wallHeight = bottomY - topY;
    const tileH = 16; // Wall strip height

    // Left wall face (south-west)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(screenX - halfWidth, topY);
    ctx.lineTo(screenX, topY + halfHeight);
    ctx.lineTo(screenX, bottomY + halfHeight);
    ctx.lineTo(screenX - halfWidth, bottomY);
    ctx.closePath();
    ctx.clip();

    for (let h = 0; h < wallHeight; h += tileH) {
      const drawH = Math.min(tileH, wallHeight - h);
      ctx.drawImage(
        wallTexture,
        0, 0, wallTexture.width, tileH,
        screenX - halfWidth, topY + h, halfWidth, drawH
      );
    }
    ctx.restore();

    // Right wall face (south-east) - slightly darker
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(screenX + halfWidth, topY);
    ctx.lineTo(screenX, topY + halfHeight);
    ctx.lineTo(screenX, bottomY + halfHeight);
    ctx.lineTo(screenX + halfWidth, bottomY);
    ctx.closePath();
    ctx.clip();

    ctx.globalAlpha = (ctx.globalAlpha || 1.0) * 0.8;
    for (let h = 0; h < wallHeight; h += tileH) {
      const drawH = Math.min(tileH, wallHeight - h);
      ctx.drawImage(
        wallTexture,
        0, 0, wallTexture.width, tileH,
        screenX, topY + h, halfWidth, drawH
      );
    }
    ctx.restore();
  }

  /**
   * Render procedural (colored) wall faces
   */
  renderProceduralWall(ctx, screenX, topY, bottomY, terrain, halfWidth, halfHeight) {
    const baseColor = this.getWallColor(terrain, 1);
    const darkColor = this.darkenColor(baseColor, 0.7);
    const sideColor = this.darkenColor(baseColor, 0.85);

    // Left wall face (south-west, slightly lighter)
    ctx.beginPath();
    ctx.moveTo(screenX - halfWidth, topY);
    ctx.lineTo(screenX, topY + halfHeight);
    ctx.lineTo(screenX, bottomY + halfHeight);
    ctx.lineTo(screenX - halfWidth, bottomY);
    ctx.closePath();
    ctx.fillStyle = sideColor;
    ctx.fill();

    // Right wall face (south-east, darker)
    ctx.beginPath();
    ctx.moveTo(screenX + halfWidth, topY);
    ctx.lineTo(screenX, topY + halfHeight);
    ctx.lineTo(screenX, bottomY + halfHeight);
    ctx.lineTo(screenX + halfWidth, bottomY);
    ctx.closePath();
    ctx.fillStyle = darkColor;
    ctx.fill();
  }

  /**
   * Render a floor tile (the top surface)
   *
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {number} screenX - Tile center X
   * @param {number} screenY - Tile center Y (at elevation height)
   * @param {string} terrain - Terrain type
   * @param {string} biome - Biome type
   * @param {number} variant - Tile variant index
   */
  renderUnifiedFloor(ctx, screenX, screenY, terrain, biome, variant) {
    // Try to get floor tile sprite (base variant, no elevation embedded)
    const sprite = this.assetLoader?.getTile(terrain, biome, variant);

    if (sprite) {
      const spriteWidth = sprite.width || this.spriteSize;
      const spriteHeight = sprite.height || this.spriteSize;

      // Draw sprite centered on the screen position
      // The diamond center is at spriteSize/2 for standard tiles
      ctx.drawImage(
        sprite,
        screenX - spriteWidth / 2,
        screenY - this.spriteSize / 2,
        spriteWidth,
        spriteHeight
      );
    } else {
      // Fallback: procedural diamond
      this.renderTerrainDiamond(ctx, screenX, screenY, terrain);
    }
  }

  /**
   * Render a pit tile (elevation < 0)
   *
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {number} screenX - Tile center X
   * @param {number} screenY - Tile center Y
   * @param {string} terrain - Terrain type
   * @param {string} biome - Biome type
   * @param {number} variant - Tile variant index
   * @param {number} elevation - Negative elevation level
   */
  renderUnifiedPit(ctx, screenX, screenY, terrain, biome, variant, elevation) {
    // First render the base floor
    this.renderUnifiedFloor(ctx, screenX, screenY, terrain, biome, variant);

    // Then overlay a darker inset to show depth
    const baseColor = this.getTerrainColor(terrain);
    const darkColor = this.darkenColor(baseColor, 0.5);
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
    this.elevationConnections = null;
    this.occlusionCache.clear();
    this.occlusionCache = null;
  }
}
