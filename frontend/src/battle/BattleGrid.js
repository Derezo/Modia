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
import { generateTerrain } from '@modia/shared/mapGeneration';
import {
  isImpassable,
  getTerrainMovementCost,
  getTerrainColor,
  discretizeElevation,
  getElevationName,
  inferElevationFormat,
  normalizeElevationGrid
} from '@modia/shared/terrain';
import {
  canEnterTile,
  createTraversalView as createSharedTraversalView
} from '@modia/shared/traversal';
import { isBlockingObstacle } from '@modia/shared/obstacles';
import {
  getV2VisualCapabilities
} from '@modia/shared/mapgen/v2/renderCapabilities';
import { resolveSpriteBiome } from '../core/BattleAssetConfig.js';

// Stacking tile rendering constants
const WALL_HEIGHT_PER_LEVEL = 16; // Pixels per elevation level for wall faces
const OCCLUSION_ALPHA = 0.35; // Transparency for tiles blocking units
const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;
const TILE_SPRITE_SIZE = 64;
const MAP_EDGE_SKIRT = 4;
const DIRECTION_NAMES = Object.freeze({
  n: 'north',
  e: 'east',
  s: 'south',
  w: 'west'
});
const V2_CONNECTION_RENDER_KINDS = Object.freeze({
  ramp: 'slope',
  slope: 'slope',
  long_ramp: 'slope',
  stairs: 'stairs',
  multi_stairs: 'stairs'
});
const VISUAL_ANCHOR_ORDER = Object.freeze({
  exposed_face: 0,
  below_prop: 1,
  tile_top: 2,
  above_connection: 3
});
// Note: Elevation limits (-3 to +8) are defined in shared/terrain.js as ELEVATION_LEVELS

function isCompleteGrid(grid, width, height) {
  return Array.isArray(grid) &&
    grid.length === height &&
    grid.every(row => Array.isArray(row) && row.length === width);
}

function createFilledGrid(width, height, value) {
  return Array.from({ length: height }, () => Array(width).fill(value));
}

function toRowMajorLayer(layer, width, height, emptyValue = null) {
  const grid = createFilledGrid(width, height, emptyValue);
  if (!Array.isArray(layer)) return grid;

  if (layer.some(Array.isArray)) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        grid[y][x] = layer[y]?.[x] ?? emptyValue;
      }
    }
    return grid;
  }

  for (const entry of layer) {
    const x = entry?.x ?? entry?.tileX ?? entry?.gridX;
    const y = entry?.y ?? entry?.tileY ?? entry?.gridY;
    if (Number.isInteger(x) && Number.isInteger(y) &&
        x >= 0 && y >= 0 && x < width && y < height) {
      grid[y][x] = entry;
    }
  }
  return grid;
}

function visualRecordCompare(left, right) {
  return (left?.stratum ?? VISUAL_ANCHOR_ORDER[left?.anchor] ?? 0) -
      (right?.stratum ?? VISUAL_ANCHOR_ORDER[right?.anchor] ?? 0) ||
    (left?.precedence ?? 0) - (right?.precedence ?? 0) ||
    String(left?.kind ?? '').localeCompare(String(right?.kind ?? '')) ||
    String(left?.id ?? '').localeCompare(String(right?.id ?? ''));
}

function toVisualRecordGrid(layer, width, height) {
  const grid = createFilledGrid(width, height, null)
    .map(row => row.map(() => []));
  if (!Array.isArray(layer)) return grid;

  if (layer.some(Array.isArray)) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const value = layer[y]?.[x];
        const records = Array.isArray(value)
          ? value
          : value && typeof value === 'object'
            ? [value]
            : [];
        grid[y][x] = [...records].sort(visualRecordCompare);
      }
    }
    return grid;
  }

  for (const record of layer) {
    const x = record?.x ?? record?.tileX ?? record?.gridX;
    const y = record?.y ?? record?.tileY ?? record?.gridY;
    if (Number.isInteger(x) && Number.isInteger(y) &&
        x >= 0 && y >= 0 && x < width && y < height) {
      grid[y][x].push(record);
    }
  }
  for (const row of grid) {
    for (const records of row) records.sort(visualRecordCompare);
  }
  return grid;
}

function toVariantGrid(layer, width, height) {
  if (!Array.isArray(layer)) return createFilledGrid(width, height, 0);
  if (layer.some(Array.isArray)) {
    return toRowMajorLayer(layer, width, height, 0).map(row =>
      row.map(value => Number.isSafeInteger(value?.variantIndex)
        ? value.variantIndex
        : Number.isSafeInteger(value)
          ? value
          : 0)
    );
  }

  const grid = createFilledGrid(width, height, 0);
  for (const record of layer) {
    const x = record?.x;
    const y = record?.y;
    if (Number.isInteger(x) && Number.isInteger(y) &&
        x >= 0 && y >= 0 && x < width && y < height &&
        Number.isSafeInteger(record?.variantIndex)) {
      grid[y][x] = record.variantIndex;
    }
  }
  return grid;
}

function normalizeTerrainCell(cell) {
  if (typeof cell === 'string') return cell;
  if (!cell || typeof cell !== 'object') return 'grass';
  if (cell.passable === false) return 'rock';
  return cell.material ?? cell.terrain ?? cell.type ?? 'grass';
}

function normalizeObstacleCell(cell) {
  if (!cell || typeof cell !== 'object') return cell;
  if (typeof cell.blocking !== 'boolean') return cell;
  return {
    ...cell,
    type: cell.type ?? cell.kind,
    passable: !cell.blocking
  };
}

function getConnectionDirection(from, to) {
  if (to.x === from.x && to.y === from.y - 1) return 'n';
  if (to.x === from.x + 1 && to.y === from.y) return 'e';
  if (to.x === from.x && to.y === from.y + 1) return 's';
  if (to.x === from.x - 1 && to.y === from.y) return 'w';
  return null;
}

function reverseConnectionDirection(direction) {
  return { n: 's', e: 'w', s: 'n', w: 'e' }[direction] ?? null;
}

/**
 * V2 slope art is anchored on the low endpoint and names the direction from
 * low to high. Persisted connections may be authored from either endpoint, so
 * canonicalize their visual origin without changing the traversal record.
 */
function getV2ConnectionRenderPlacement(connection) {
  const endpointDirection = connection.direction ??
    getConnectionDirection(connection.from, connection.to);
  if (!endpointDirection) return null;
  if ((connection.elevationDelta ?? 0) < 0) {
    return {
      from: connection.to,
      direction: reverseConnectionDirection(endpointDirection)
    };
  }
  return {
    from: connection.from,
    direction: endpointDirection
  };
}

function toConnectionGrid(layer, width, height, elevation) {
  if (!Array.isArray(layer) || layer.length === 0) return null;
  if (layer.some(Array.isArray)) {
    return toRowMajorLayer(layer, width, height);
  }

  const grid = createFilledGrid(width, height, null);
  for (const record of layer) {
    if (!record?.from || !record?.to) continue;
    if (![record.from.x, record.from.y, record.to.x, record.to.y]
      .every(Number.isInteger) ||
        record.from.x < 0 || record.from.x >= width ||
        record.from.y < 0 || record.from.y >= height ||
        record.to.x < 0 || record.to.x >= width ||
        record.to.y < 0 || record.to.y >= height) {
      continue;
    }

    const direction = record.direction ??
      getConnectionDirection(record.from, record.to);
    if (!direction) continue;

    const fromElevation = discretizeElevation(
      elevation?.[record.from.y]?.[record.from.x] ?? 0
    );
    const toElevation = discretizeElevation(
      elevation?.[record.to.y]?.[record.to.x] ?? 0
    );
    const connection = {
      ...record,
      type: record.type ?? record.kind,
      levels: record.levels ?? Math.max(
        1,
        Math.abs(toElevation - fromElevation)
      )
    };
    grid[record.from.y][record.from.x] ||= {};
    grid[record.from.y][record.from.x][direction] = connection;

    if (record.bidirectional) {
      const reverse = reverseConnectionDirection(direction);
      grid[record.to.y][record.to.x] ||= {};
      grid[record.to.y][record.to.x][reverse] = {
        ...connection,
        elevationDelta: Number.isFinite(record.elevationDelta)
          ? -record.elevationDelta
          : record.elevationDelta
      };
    }
  }
  return grid;
}

function adaptMovementPolicy(
  movementPolicy,
  terrainRecords,
  obstacleRecords
) {
  const {
    canTraverseTerrain,
    canTraverseObstacle,
    getStepCost,
    ...basePolicy
  } = movementPolicy;

  return {
    ...basePolicy,
    canTraverseTerrain(context) {
      const record = terrainRecords[context.to.y][context.to.x];
      const terrainCost = Number.isFinite(record?.movementCost)
        ? record.movementCost
        : context.terrainCost;
      const fallback = record && typeof record === 'object'
        ? record.passable !== false && Number.isFinite(terrainCost)
        : Number.isFinite(context.terrainCost);
      if (!canTraverseTerrain) return fallback;
      return canTraverseTerrain({
        ...context,
        terrain: record,
        terrainCost
      }) ?? fallback;
    },
    canTraverseObstacle(context) {
      const record = obstacleRecords?.[context.to.y]?.[context.to.x] ?? null;
      const fallback = record?.blocking === true
        ? false
        : !isBlockingObstacle(record);
      if (!canTraverseObstacle) return fallback;
      return canTraverseObstacle({ ...context, obstacle: record }) ?? fallback;
    },
    getStepCost(context) {
      const terrain = terrainRecords[context.to.y][context.to.x];
      const obstacle = obstacleRecords?.[context.to.y]?.[context.to.x] ?? null;
      const terrainCost = Number.isFinite(terrain?.movementCost)
        ? terrain.movementCost
        : context.terrainCost;
      const obstacleCost = obstacle && obstacle.blocking !== true &&
        Number.isFinite(obstacle.movementCost)
        ? obstacle.movementCost
        : 0;
      const defaultCost = terrainCost + context.elevationCost + obstacleCost;
      if (!getStepCost) return defaultCost;
      return getStepCost({
        ...context,
        terrain,
        terrainCost,
        obstacle,
        obstacleCost,
        defaultCost
      }) ?? defaultCost;
    }
  };
}

export class BattleGrid {
  constructor(canvas, width = 32, height = 32) {
    this.canvas = canvas;
    this.width = width;
    this.height = height;
    this.tileWidth = TILE_WIDTH;
    this.tileHeight = TILE_HEIGHT;
    // Logical draw size. Source sprites are 2x retina assets (128x128), but
    // geometry and anchoring remain stable at 64x64 CSS pixels.
    this.spriteSize = TILE_SPRITE_SIZE;
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
    this.terrainTraversalData = [];

    // Obstacle layer data
    this.obstacles = [];
    this.obstacleTraversalData = [];

    // Elevation data (0 = ground level, 1-3 = elevated, -1 = pit)
    this.elevation = [];
    this.elevationFormat = 'normalized';
    this.elevationConnections = [];

    // Asset loader reference (set externally)
    this.assetLoader = null;

    // Current node type for biome-specific sprites
    this.nodeType = 'forest';

    // Tile variant mapping for visual variety (seeded per-tile)
    this.tileVariants = [];
    this.semanticVariants = false;
    this.v2RenderPalette = null;

    // Persisted, non-authoritative visual layers. These are indexed by tile
    // once at hydration time so render order does not depend on input order.
    this.transitions = [];
    this.decorations = [];

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
    this.semanticVariants = false;
    this.v2RenderPalette = null;

    // Use shared generateTerrain for deterministic map generation
    // Request elevation data for 3D rendering
    const mapData = generateTerrain(seed, nodeType, this.width, this.height, {
      elevation: true
    });

    this.setTerrain(mapData.terrain);
    this.setObstacles(mapData.obstacles);
    this.tileVariants = mapData.variants;

    // Store elevation data if provided
    if (mapData.elevation) {
      this.elevation = mapData.elevation;
      this.elevationFormat = 'normalized';
    } else {
      // Initialize flat elevation grid if not provided
      this.elevation = Array.from({ length: this.height }, () =>
        Array(this.width).fill(0)
      );
      this.elevationFormat = 'discrete';
    }
    this.elevationConnections = Array.isArray(mapData.elevationConnections)
      ? mapData.elevationConnections
      : [];
  }

  /**
   * Set elevation data directly (for server-provided battle state)
   * @param {number[][]} elevationGrid - 2D grid of elevation values
   */
  setElevation(elevationGrid, format = 'auto') {
    if (elevationGrid && Array.isArray(elevationGrid)) {
      this.elevation = elevationGrid;
      // Infer at grid scope so ambiguous individual values 0 and 1 retain the
      // correct legacy meaning. The inference contract lives in shared code.
      this.elevationFormat = inferElevationFormat(elevationGrid, format);
    }
  }

  /**
   * Set terrain data directly (for server-provided battle state)
   * @param {string[][]} terrainGrid - 2D grid of terrain type strings
   */
  setTerrain(terrainGrid) {
    if (terrainGrid && Array.isArray(terrainGrid)) {
      this.terrainTraversalData = terrainGrid;
      this.terrain = toRowMajorLayer(
        terrainGrid,
        this.width,
        this.height,
        'grass'
      ).map(row => row.map(normalizeTerrainCell));
    }
  }

  setTileVariants(variantGrid) {
    if (variantGrid && Array.isArray(variantGrid)) {
      this.semanticVariants = !variantGrid.some(Array.isArray);
      this.v2RenderPalette = this.semanticVariants
        ? getV2VisualCapabilities(this.nodeType).palette
        : null;
      this.tileVariants = toVariantGrid(
        variantGrid,
        this.width,
        this.height
      );
    }
  }

  setTransitions(transitions) {
    if (Array.isArray(transitions)) {
      this.transitions = toVisualRecordGrid(
        transitions,
        this.width,
        this.height
      );
    }
  }

  setDecorations(decorations) {
    if (Array.isArray(decorations)) {
      this.decorations = toVisualRecordGrid(
        decorations,
        this.width,
        this.height
      );
    }
  }

  setObstacles(obstacleGrid) {
    if (obstacleGrid && Array.isArray(obstacleGrid)) {
      this.obstacleTraversalData = obstacleGrid;
      this.obstacles = toRowMajorLayer(
        obstacleGrid,
        this.width,
        this.height
      ).map(row => row.map(normalizeObstacleCell));
    }
  }

  setElevationConnections(connectionGrid) {
    if (connectionGrid && Array.isArray(connectionGrid)) {
      this.elevationConnections = connectionGrid;
    }
  }

  getTransitions(x, y) {
    if (!this.isInBounds(x, y)) return [];
    return this.transitions[y]?.[x] ?? [];
  }

  getDecorations(x, y) {
    if (!this.isInBounds(x, y)) return [];
    return this.decorations[y]?.[x] ?? [];
  }

  /**
   * Build the authoritative traversal view consumed by client pathfinding.
   */
  createTraversalView(units = [], movementPolicy = {}) {
    const terrainRecords = toRowMajorLayer(
      this.terrainTraversalData,
      this.width,
      this.height,
      'grass'
    );
    const obstacleRecords = Array.isArray(this.obstacleTraversalData)
      ? toRowMajorLayer(
        this.obstacleTraversalData,
        this.width,
        this.height
      )
      : null;
    const terrain = terrainRecords.map(row => row.map(normalizeTerrainCell));
    const obstacles = obstacleRecords?.map(
      row => row.map(normalizeObstacleCell)
    ) ?? null;
    const elevation = isCompleteGrid(this.elevation, this.width, this.height)
      ? normalizeElevationGrid(this.elevation, this.elevationFormat)
      : null;
    const elevationConnections = toConnectionGrid(
      this.elevationConnections,
      this.width,
      this.height,
      elevation
    );

    return createSharedTraversalView({
      terrain,
      obstacles,
      elevation,
      elevationConnections,
      units,
      dimensions: { width: this.width, height: this.height },
      movementPolicy: adaptMovementPolicy(
        movementPolicy,
        terrainRecords,
        obstacleRecords
      )
    });
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
    return this.elevationFormat === 'discrete'
      ? Math.round(rawElev)
      : discretizeElevation(rawElev);
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
      x: world.x + (this.canvas.width / (window.devicePixelRatio || 1)) / 2,
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
      // Reverse visual zoom transform before sampling world coords
      const unzoomed = camera.screenToUnzoomed
        ? camera.screenToUnzoomed(screenX, screenY)
        : { x: screenX, y: screenY };
      const world = camera.screenToWorld(unzoomed.x, unzoomed.y);
      worldX = world.x;
      worldY = world.y;
    } else {
      // Fallback for non-camera usage (legacy)
      worldX = screenX - (this.canvas.width / (window.devicePixelRatio || 1)) / 2;
      worldY = screenY - 120;
    }

    // First, get base grid position (ignoring elevation)
    const halfTileWidth = this.tileWidth / 2;
    const halfTileHeight = this.tileHeight / 2;

    const isoX = worldX / halfTileWidth;
    const isoY = worldY / halfTileHeight;

    const baseGridX = Math.round((isoX + isoY) / 2);
    const baseGridY = Math.round((isoY - isoX) / 2);

    // Check for elevated tiles that might visually overlap
    // Tiles in "front" (higher x+y sum) that are elevated can appear
    // to be at the same visual position as tiles behind them
    const candidates = [];

    // Search nearby tiles for elevated ones that might contain the click
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
  isWalkable(x, y, { from = null, units = [], movementPolicy = {} } = {}) {
    if (!this.isInBounds(x, y)) return false;

    if (!from) {
      // Surface walkability is direction-independent. Actual movement paths
      // provide `from` and retain the normal elevation rules.
      const probe = [
        { x: x - 1, y },
        { x: x + 1, y },
        { x, y: y - 1 },
        { x, y: y + 1 }
      ].find(point => this.isInBounds(point.x, point.y));
      if (!probe) {
        const terrain = this.getTerrain(x, y);
        const obstacle = this.obstacles[y]?.[x] ?? null;
        return !isImpassable(terrain) && !isBlockingObstacle(obstacle);
      }
      const surfacePolicy = {
        ...movementPolicy,
        canTraverseElevation: movementPolicy.canTraverseElevation ??
          (() => true)
      };
      return canEnterTile(
        this.createTraversalView(units, surfacePolicy),
        probe,
        { x, y },
        { start: probe }
      );
    }

    return canEnterTile(
      this.createTraversalView(units, movementPolicy),
      from,
      { x, y },
      { start: from }
    );
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
   * Return the canonical persisted connection records whose visual origin is
   * this tile. V2 uses flat records; legacy connection grids remain accepted.
   */
  getElevationConnectionsForRender(gridX, gridY) {
    if (!Array.isArray(this.elevationConnections)) return [];
    if (!this.elevationConnections.some(Array.isArray)) {
      return this.elevationConnections
        .map(record => ({
          record,
          placement: getV2ConnectionRenderPlacement(record)
        }))
        .filter(({ placement }) =>
          placement?.from?.x === gridX &&
          placement?.from?.y === gridY
        )
        .sort((left, right) =>
          String(left.record.id ?? '').localeCompare(
            String(right.record.id ?? '')
          )
        )
        .map(({ record, placement }) => ({
          ...record,
          renderDirection: placement.direction
        }));
    }

    const cell = this.elevationConnections[gridY]?.[gridX];
    if (!cell || typeof cell !== 'object') return [];
    return Object.entries(cell)
      .filter(([direction, connection]) =>
        Object.hasOwn(DIRECTION_NAMES, direction) && connection
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([direction, connection]) => ({
        ...connection,
        direction,
        from: { x: gridX, y: gridY }
      }));
  }


  /**
   * Render a simple terrain diamond (for top surface fallback)
   */
  renderTerrainDiamond(
    ctx,
    screenX,
    screenY,
    terrain,
    drawOutline = true,
    colorOverride = null
  ) {
    const baseColor = colorOverride ?? this.getTerrainColor(terrain);

    ctx.beginPath();
    ctx.moveTo(screenX, screenY - this.tileHeight / 2);
    ctx.lineTo(screenX + this.tileWidth / 2, screenY);
    ctx.lineTo(screenX, screenY + this.tileHeight / 2);
    ctx.lineTo(screenX - this.tileWidth / 2, screenY);
    ctx.closePath();

    ctx.fillStyle = baseColor;
    ctx.fill();

    if (drawOutline) {
      ctx.strokeStyle = 'rgba(25, 28, 34, 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
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
    const renderPosition = unit.getRenderGridPosition?.();
    const unitX = renderPosition?.x ?? unit.gridX ?? unit.x ?? unit.tileX;
    const unitY = renderPosition?.y ?? unit.gridY ?? unit.y ?? unit.tileY;
    const unitZ = renderPosition?.elevation ?? unit.z ?? unit.elevation ?? 0;

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
    if (this.semanticVariants) {
      return this.v2RenderPalette ??
        getV2VisualCapabilities(this.nodeType).palette;
    }
    return resolveSpriteBiome(this.nodeType);
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
  renderObstacleAt(ctx, screenX, screenY, obstacle, alpha = 1) {
    if (!obstacle) return;

    const exactV2Asset = this.semanticVariants && obstacle.assetKey;
    const sprite = exactV2Asset
      ? this.assetLoader?.getBattleMapV2Asset?.(
        obstacle.assetKey,
        {
          selectionKey: obstacle.id,
          expectedPalette: this.getSpriteBiome()
        }
      )
      : this.assetLoader?.getObstacle(obstacle.variant, obstacle.type);

    if (sprite) {
      // Generated obstacle sources can be 1024px. Always render against a
      // logical footprint so an asset's source resolution cannot engulf maps.
      const isTree = obstacle.type === 'trees' || obstacle.type === 'tree';
      const maxWidth = isTree ? 64 : 48;
      const maxHeight = isTree ? 88 : 56;
      const scale = Math.min(maxWidth / sprite.width, maxHeight / sprite.height, 1);
      const drawWidth = sprite.width * scale;
      const drawHeight = sprite.height * scale;
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.drawImage(
        sprite,
        screenX - drawWidth / 2,
        screenY - drawHeight + this.tileHeight / 2,
        drawWidth,
        drawHeight
      );
      ctx.restore();
    } else if (!exactV2Asset) {
      ctx.save();
      ctx.globalAlpha *= alpha;
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
      ctx.restore();
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

        // Camera.isVisible accounts for zoomed-out view bounds. The old screen
        // rectangle culling dropped valid tiles whenever zoom was below 1.
        if (camera) {
          const worldPos = this.gridToScreenWorld(x, y);
          if (!camera.isVisible(worldPos.x, worldPos.y, this.tileWidth * 2, 192)) continue;
        }

        const elevation = this.getElevation(x, y);

        // Depth calculation for painter's algorithm:
        // Base depth is sum of x + y (isometric row)
        // Subtract a small elevation factor so higher tiles render slightly
        // earlier, keeping their wall faces behind adjacent flat tiles.
        const baseDepth = x + y;
        const elevationFactor = elevation * 0.001; // Small factor to not disrupt row order
        const depth = baseDepth - elevationFactor;

        tiles.push({ x, y, screenX: screenPos.x, screenY: screenPos.y, baseDepth, depth, elevation });
      }
    }

    // Sort back-to-front (lower depth first)
    tiles.sort((a, b) => a.depth - b.depth || a.y - b.y || a.x - b.x);

    return tiles;
  }

  /**
   * Render the entire grid with optional camera
   * Uses the unified stacking tile system for consistent elevation rendering
   */
  render(ctx, highlights = {}, camera = null, options = {}) {
    // Merge intent highlights with passed highlights
    const combinedHighlights = this.getCombinedHighlights(highlights);

    // Build sorted render order
    const renderOrder = this.buildRenderOrder(camera);

    // Terrain, props, and units share one painter queue. Fractional entity
    // depths preserve the visual footpoint while a unit walks between rows.
    // A half-row bias places a unit on its tile but behind the next foreground
    // row, allowing cliffs and props to occlude it naturally.
    const commands = renderOrder.map(tile => ({
      kind: 'tile',
      order: tile.depth,
      tieY: tile.y,
      tieX: tile.x,
      tile
    }));

    for (const entity of options.entities || []) {
      const entityDepth = typeof entity.getRenderDepth === 'function'
        ? entity.getRenderDepth()
        : (entity.gridX ?? entity.x ?? entity.tileX ?? 0) +
          (entity.gridY ?? entity.y ?? entity.tileY ?? 0);
      commands.push({
        kind: 'entity',
        order: entityDepth + 0.5,
        tieY: entity.gridY ?? entity.y ?? 0,
        tieX: entity.gridX ?? entity.x ?? 0,
        entity
      });
    }

    commands.sort((a, b) =>
      a.order - b.order ||
      (a.kind === b.kind ? 0 : a.kind === 'tile' ? -1 : 1) ||
      a.tieY - b.tieY ||
      a.tieX - b.tieX
    );

    for (const command of commands) {
      if (command.kind === 'entity') {
        options.renderEntity?.(command.entity);
        continue;
      }

      const tile = command.tile;
      const highlight = combinedHighlights[`${tile.x},${tile.y}`] || null;
      this.renderTileUnified(ctx, tile.screenX, tile.screenY, tile.x, tile.y, highlight);

      const obstacle = this.getObstacle(tile.x, tile.y);
      if (obstacle) {
        const obstacleAlpha = this.isTileOccluding(tile.x, tile.y) ? OCCLUSION_ALPHA : 1;
        this.renderObstacleAt(ctx, tile.screenX, tile.screenY, obstacle, obstacleAlpha);
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
      // Reverse visual zoom transform before sampling world coords
      const unzoomed = camera.screenToUnzoomed
        ? camera.screenToUnzoomed(screenX, screenY)
        : { x: screenX, y: screenY };
      const world = camera.screenToWorld(unzoomed.x, unzoomed.y);
      worldX = world.x;
      worldY = world.y;
    } else {
      worldX = screenX - (this.canvas.width / (window.devicePixelRatio || 1)) / 2;
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

    if (elevation >= 0) {
      // Render only the portions of the two camera-facing sides that are
      // actually exposed relative to their neighbors.
      this.renderUnifiedWalls(ctx, screenX, screenY, gridX, gridY, elevation, terrain, biome);
      this.renderSemanticTransitions(
        ctx,
        screenX,
        screenY,
        gridX,
        gridY,
        'exposed_face'
      );
      this.renderDecorations(
        ctx,
        screenX,
        screenY,
        gridX,
        gridY,
        'exposed_face'
      );
      this.renderUnifiedFloor(ctx, screenX, screenY, terrain, biome, variant);
    } else {
      // Pit tiles: render floor with inset shadow
      this.renderUnifiedPit(ctx, screenX, screenY, terrain, biome, variant, elevation);
    }

    this.renderSemanticTransitions(
      ctx,
      screenX,
      screenY,
      gridX,
      gridY,
      ['below_prop', 'tile_top']
    );
    this.renderDecorations(
      ctx,
      screenX,
      screenY,
      gridX,
      gridY,
      ['below_prop', 'tile_top']
    );
    this.renderElevationConnections(
      ctx,
      screenX,
      screenY,
      gridX,
      gridY,
      biome
    );
    this.renderSemanticTransitions(
      ctx,
      screenX,
      screenY,
      gridX,
      gridY,
      'above_connection'
    );
    this.renderDecorations(
      ctx,
      screenX,
      screenY,
      gridX,
      gridY,
      'above_connection'
    );

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
  renderUnifiedWalls(ctx, screenX, screenY, gridX, gridY, elevation, terrain, biome) {
    const wallTexture = this.semanticVariants
      ? this.assetLoader?.getBattleMapV2Asset?.(
        `${biome}:face:stone`
      )
      : this.assetLoader?.getWallTexture(biome, terrain);
    const halfWidth = this.tileWidth / 2;
    const halfHeight = this.tileHeight / 2;
    const southWestInBounds = this.isInBounds(gridX, gridY + 1);
    const southEastInBounds = this.isInBounds(gridX + 1, gridY);
    const southWestElevation = southWestInBounds ? this.getElevation(gridX, gridY + 1) : Math.min(0, elevation);
    const southEastElevation = southEastInBounds ? this.getElevation(gridX + 1, gridY) : Math.min(0, elevation);
    const leftExposure = Math.max(0, elevation - southWestElevation) * WALL_HEIGHT_PER_LEVEL +
      (southWestInBounds ? 0 : MAP_EDGE_SKIRT);
    const rightExposure = Math.max(0, elevation - southEastElevation) * WALL_HEIGHT_PER_LEVEL +
      (southEastInBounds ? 0 : MAP_EDGE_SKIRT);

    if (leftExposure <= 0 && rightExposure <= 0) return;

    if (wallTexture) {
      this.renderTexturedWall(
        ctx, screenX, screenY, leftExposure, rightExposure,
        wallTexture, halfWidth, halfHeight
      );
    } else {
      this.renderProceduralWall(
        ctx, screenX, screenY, leftExposure, rightExposure,
        terrain, halfWidth, halfHeight
      );
    }
  }

  /**
   * Render textured wall faces
   */
  renderTexturedWall(ctx, screenX, topY, leftExposure, rightExposure, wallTexture, halfWidth, halfHeight) {
    const renderFace = (startX, startY, faceX, faceY, exposure, brightness) => {
      for (let offset = 0; offset < exposure; offset += WALL_HEIGHT_PER_LEVEL) {
        const segmentHeight = Math.min(WALL_HEIGHT_PER_LEVEL, exposure - offset);
        ctx.save();
        // Affine-map the full material strip into the slanted parallelogram.
        // This fills the lower wedge that the previous rectangular clip missed.
        ctx.transform(
          faceX / wallTexture.width,
          faceY / wallTexture.width,
          0,
          segmentHeight / wallTexture.height,
          startX,
          startY + offset
        );
        ctx.filter = `brightness(${brightness})`;
        ctx.drawImage(wallTexture, 0, 0);
        ctx.restore();
      }
    };

    if (leftExposure > 0) {
      renderFace(screenX - halfWidth, topY, halfWidth, halfHeight, leftExposure, 0.94);
    }
    if (rightExposure > 0) {
      renderFace(screenX, topY + halfHeight, halfWidth, -halfHeight, rightExposure, 0.76);
    }
  }

  /**
   * Render procedural (colored) wall faces
   */
  renderProceduralWall(ctx, screenX, topY, leftExposure, rightExposure, terrain, halfWidth, halfHeight) {
    const baseColor = this.getWallColor(terrain, 1);
    const darkColor = this.darkenColor(baseColor, 0.7);
    const sideColor = this.darkenColor(baseColor, 0.85);

    if (leftExposure > 0) {
      ctx.beginPath();
      ctx.moveTo(screenX - halfWidth, topY);
      ctx.lineTo(screenX, topY + halfHeight);
      ctx.lineTo(screenX, topY + halfHeight + leftExposure);
      ctx.lineTo(screenX - halfWidth, topY + leftExposure);
      ctx.closePath();
      ctx.fillStyle = sideColor;
      ctx.fill();
    }

    if (rightExposure > 0) {
      ctx.beginPath();
      ctx.moveTo(screenX, topY + halfHeight);
      ctx.lineTo(screenX + halfWidth, topY);
      ctx.lineTo(screenX + halfWidth, topY + rightExposure);
      ctx.lineTo(screenX, topY + halfHeight + rightExposure);
      ctx.closePath();
      ctx.fillStyle = darkColor;
      ctx.fill();
    }
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
    // BattleMapV2 variants opt into exact palette/material resolution. V1
    // keeps the existing permissive biome fallback for compatibility.
    const sprite = this.semanticVariants
      ? this.assetLoader?.getBattleMapV2Asset?.(
        `${biome}:floor:${terrain}`,
        { variantIndex: variant }
      )
      : this.assetLoader?.getTile(terrain, biome, variant);

    // A solid underlay prevents sub-pixel cracks when the camera or browser
    // applies fractional zoom. It also gives graceful output during loading.
    this.renderTerrainDiamond(
      ctx,
      screenX,
      screenY,
      terrain,
      false,
      sprite?.type === 'code-native' ? sprite.color : null
    );

    if (sprite && sprite.type !== 'code-native') {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        sprite,
        screenX - this.spriteSize / 2,
        screenY - this.spriteSize / 2,
        this.spriteSize,
        this.spriteSize
      );
    } else if (sprite?.type === 'code-native') {
      this.renderCodeNativeSurface(
        ctx,
        screenX,
        screenY,
        variant,
        sprite
      );
    }
  }

  /**
   * Draw persisted ramps/stairs after the floor and before connection overlays.
   * V2 connection art is exact: the loader must return the requested authored
   * direction/kind rather than substituting another biome or elevation.
   */
  renderElevationConnections(
    ctx,
    screenX,
    screenY,
    gridX,
    gridY,
    biome
  ) {
    const isV2 = !this.elevationConnections.some(Array.isArray);
    for (const connection of this.getElevationConnectionsForRender(gridX, gridY)) {
      const shortDirection = connection.renderDirection ??
        connection.direction ??
        getConnectionDirection(connection.from, connection.to);
      const direction = DIRECTION_NAMES[shortDirection] ?? shortDirection;
      if (!direction) continue;
      const persistedKind = connection.kind ?? connection.type;
      const kind = isV2
        ? V2_CONNECTION_RENDER_KINDS[persistedKind]
        : ['stairs', 'multi_stairs'].includes(persistedKind)
          ? 'stairs'
          : 'slope';
      // Ledges and cliffs are exposed-face semantics, not traversable ramps.
      if (!kind) continue;
      const assetVariant = connection.assetVariant ??
        (kind === 'stairs' ? 2 : 1);
      const sprite = this.assetLoader?.getSlopeSprite(
        biome,
        direction,
        assetVariant,
        { kind, exact: isV2 }
      );
      if (!sprite) continue;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        sprite,
        screenX - this.spriteSize / 2,
        screenY - this.spriteSize / 2,
        this.spriteSize,
        this.spriteSize
      );
    }
  }

  renderSemanticTransitions(
    ctx,
    screenX,
    screenY,
    gridX,
    gridY,
    anchors
  ) {
    const accepted = new Set(Array.isArray(anchors) ? anchors : [anchors]);
    for (const record of this.getTransitions(gridX, gridY)) {
      if (!accepted.has(record.anchor)) continue;
      const descriptor = this.assetLoader?.getBattleMapV2Asset?.(
        record.assetKey,
        { expectedPalette: this.getSpriteBiome() }
      );
      if (!descriptor) continue;
      if (descriptor.type === 'code-native') {
        this.renderCodeNativeTransition(ctx, screenX, screenY, record, descriptor);
      } else {
        ctx.drawImage(
          descriptor,
          screenX - this.spriteSize / 2,
          screenY - this.spriteSize / 2,
          this.spriteSize,
          this.spriteSize
        );
      }
    }
  }

  renderDecorations(
    ctx,
    screenX,
    screenY,
    gridX,
    gridY,
    anchors = null
  ) {
    const accepted = anchors === null
      ? null
      : new Set(Array.isArray(anchors) ? anchors : [anchors]);
    for (const record of this.getDecorations(gridX, gridY)) {
      if (accepted && !accepted.has(record.anchor)) continue;
      const descriptor = this.assetLoader?.getBattleMapV2Asset?.(
        record.assetKey,
        {
          variantIndex: record.variantIndex,
          expectedPalette: this.getSpriteBiome()
        }
      );
      if (!descriptor) continue;
      if (descriptor.type === 'code-native') {
        this.renderCodeNativeDecoration(ctx, screenX, screenY, record, descriptor);
      } else {
        ctx.drawImage(
          descriptor,
          screenX - this.spriteSize / 2,
          screenY - this.spriteSize / 2,
          this.spriteSize,
          this.spriteSize
        );
      }
    }
  }

  renderCodeNativeSurface(ctx, screenX, screenY, variant, descriptor) {
    if (!descriptor.accentColor) return;
    const seed = (variant ?? 0) * 13 + 7;
    ctx.save();
    ctx.globalAlpha *= 0.28;
    ctx.fillStyle = descriptor.accentColor;
    for (let index = 0; index < 4; index++) {
      const offsetX = ((seed + index * 17) % 35) - 17;
      const maxY = Math.max(
        2,
        Math.floor(
          (this.tileHeight / 2 - 2) *
          (1 - Math.abs(offsetX) / (this.tileWidth / 2))
        )
      );
      const offsetY = ((seed + index * 11) % (maxY * 2 + 1)) - maxY;
      ctx.beginPath();
      ctx.arc(screenX + offsetX, screenY + offsetY, 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  renderCodeNativeTransition(ctx, screenX, screenY, record, descriptor) {
    const vertices = {
      n: [screenX, screenY - this.tileHeight / 2],
      e: [screenX + this.tileWidth / 2, screenY],
      s: [screenX, screenY + this.tileHeight / 2],
      w: [screenX - this.tileWidth / 2, screenY]
    };
    const edges = {
      n: [vertices.n, vertices.e],
      e: [vertices.e, vertices.s],
      s: [vertices.s, vertices.w],
      w: [vertices.w, vertices.n]
    };
    const bits = { n: 1, e: 2, s: 4, w: 8 };
    ctx.save();
    ctx.strokeStyle = descriptor.color;
    ctx.lineWidth = descriptor.lineWidth;
    ctx.globalAlpha *= descriptor.alpha;
    ctx.lineCap = 'round';
    if (record.anchor === 'exposed_face') {
      const currentElevation = this.getElevation(record.x, record.y);
      const faceDirections = {
        e: {
          edge: [vertices.e, vertices.s],
          neighbor: { x: record.x + 1, y: record.y }
        },
        s: {
          edge: [vertices.s, vertices.w],
          neighbor: { x: record.x, y: record.y + 1 }
        }
      };
      for (const direction of ['e', 's']) {
        if ((record.directionMask & bits[direction]) === 0) continue;
        const face = faceDirections[direction];
        const neighborElevation = this.isInBounds(
          face.neighbor.x,
          face.neighbor.y
        )
          ? this.getElevation(face.neighbor.x, face.neighbor.y)
          : Math.min(0, currentElevation);
        const exposure = Math.max(
          0,
          currentElevation - neighborElevation
        ) * WALL_HEIGHT_PER_LEVEL;
        if (exposure <= 0) continue;
        // Keep the semantic stroke inside the visible wall face so the floor
        // rendered next cannot cover it.
        const faceOffset = Math.max(
          2,
          Math.min(exposure - 1, Math.round(exposure * 0.55))
        );
        const [from, to] = face.edge;
        ctx.beginPath();
        ctx.moveTo(from[0], from[1] + faceOffset);
        ctx.lineTo(to[0], to[1] + faceOffset);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    for (const direction of ['n', 'e', 's', 'w']) {
      if ((record.directionMask & bits[direction]) === 0) continue;
      const [from, to] = edges[direction];
      ctx.beginPath();
      ctx.moveTo(from[0], from[1]);
      ctx.lineTo(to[0], to[1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  renderCodeNativeDecoration(ctx, screenX, screenY, record, descriptor) {
    const seed = (record.variantIndex ?? 0) + record.x * 17 + record.y * 31;
    const offsetX = (seed % 9) - 4;
    const offsetY = (Math.floor(seed / 3) % 5) - 1;
    ctx.save();
    ctx.globalAlpha *= descriptor.alpha;
    ctx.fillStyle = descriptor.color;
    ctx.strokeStyle = descriptor.accentColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(
      screenX + offsetX,
      screenY + offsetY,
      descriptor.radius,
      0,
      Math.PI * 2
    );
    ctx.fill();
    if (descriptor.accentColor) ctx.stroke();
    ctx.restore();
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
    const inset = 4 + Math.abs(elevation);

    ctx.beginPath();
    ctx.moveTo(screenX, screenY - this.tileHeight / 2 + inset);
    ctx.lineTo(screenX + this.tileWidth / 2 - inset * 2, screenY);
    ctx.lineTo(screenX, screenY + this.tileHeight / 2 - inset);
    ctx.lineTo(screenX - this.tileWidth / 2 + inset * 2, screenY);
    ctx.closePath();
    ctx.fillStyle = `rgba(8, 12, 18, ${Math.min(0.58, 0.2 + Math.abs(elevation) * 0.1)})`;
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
  renderWithIntentHighlights(ctx, highlights = {}, camera = null, options = {}) {
    this.render(ctx, highlights, camera, options);
  }

  /**
   * Cleanup resources - call when BattleGrid is destroyed
   * Stops any running timers and clears state
   */
  destroy() {
    this.clearIntentHighlights();
    this.terrain = null;
    this.terrainTraversalData = null;
    this.elevation = null;
    this.elevationConnections = null;
    this.tileVariants = null;
    this.semanticVariants = false;
    this.v2RenderPalette = null;
    this.transitions = null;
    this.decorations = null;
    this.obstacles = null;
    this.obstacleTraversalData = null;
    this.occlusionCache.clear();
    this.occlusionCache = null;
  }
}
