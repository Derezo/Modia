/**
 * LayerContext - Shared context between map generation algorithms
 *
 * Enables cooperation between algorithms by sharing state:
 * - Terrain state from previous algorithms
 * - Noise maps for consistent terrain features
 * - Seed regions where refinement algorithms should operate
 * - Room and path definitions for structural consistency
 * - POI locations for connectivity requirements
 *
 * Algorithm roles interact with context:
 * - 'macro': Populates noiseMap and seedRegions, defines large-scale structure
 * - 'refinement': Reads seedRegions, operates only within those areas
 * - 'structure': Adds rooms and paths, respects existing structure
 * - 'detail': Adds clusters, avoids critical paths and rooms
 *
 * CRITICAL: Context enables deterministic cooperation - algorithms
 * don't compete, they build on each other's work.
 */

// ============================================================================
// LAYER CONTEXT CLASS
// ============================================================================

/**
 * LayerContext - Manages shared state between generation algorithms
 */
export class LayerContext {
  /**
   * Create a new layer context
   *
   * @param {number} width - Map width in tiles
   * @param {number} height - Map height in tiles
   */
  constructor(width, height) {
    this.width = width;
    this.height = height;

    // Current terrain state (reference to main terrain array)
    this.terrain = null;

    // Raw noise values from macro layer (values typically -1 to 1)
    this.noiseMap = null;

    // Seed regions for CA to operate on (Set<string> of "x,y" keys)
    this.seedRegions = null;

    // Edge tiles between terrain types for boundary smoothing
    this.boundaryTiles = null;

    // Room definitions placed by structure algorithms
    this.rooms = [];

    // Path segments carved by path algorithms
    this.paths = [];

    // Points of interest (spawns, objectives, etc.)
    this.pois = [];

    // Elevation data if generated
    this.elevation = null;

    // Cover grid if generated
    this.coverGrid = null;

    // Generation metadata
    this.meta = {
      algorithmOrder: [],
      passes: 0
    };
  }

  /**
   * Initialize terrain reference
   *
   * @param {string[][]} terrain - Terrain grid
   */
  setTerrain(terrain) {
    this.terrain = terrain;
  }

  /**
   * Set metadata value
   *
   * @param {string} key - Metadata key
   * @param {*} value - Metadata value
   */
  setMetadata(key, value) {
    this.meta[key] = value;
  }

  /**
   * Get metadata value
   *
   * @param {string} key - Metadata key
   * @returns {*} Metadata value or undefined
   */
  getMetadata(key) {
    return this.meta[key];
  }

  /**
   * Get terrain at position
   *
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {string|null} Terrain type or null if out of bounds
   */
  getTerrain(x, y) {
    if (!this.terrain) return null;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return this.terrain[y][x];
  }

  /**
   * Set terrain at position
   *
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {string} terrainType - Terrain type to set
   */
  setTerrainAt(x, y, terrainType) {
    if (!this.terrain) return;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.terrain[y][x] = terrainType;
  }

  // ==========================================================================
  // NOISE MAP METHODS
  // ==========================================================================

  /**
   * Set the noise map from macro algorithm
   *
   * @param {number[][]} noiseMap - 2D array of noise values
   */
  setNoiseMap(noiseMap) {
    this.noiseMap = noiseMap;
  }

  /**
   * Get noise value at position
   *
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {number|null} Noise value or null
   */
  getNoise(x, y) {
    if (!this.noiseMap) return null;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return this.noiseMap[y][x];
  }

  /**
   * Create noise map from terrain using threshold mapping
   *
   * @param {Object} thresholds - Terrain to noise value mapping
   * @returns {number[][]} Generated noise map
   */
  createNoiseMapFromTerrain(thresholds) {
    if (!this.terrain) return null;

    const noiseMap = [];
    for (let y = 0; y < this.height; y++) {
      const row = [];
      for (let x = 0; x < this.width; x++) {
        const terrain = this.terrain[y][x];
        row.push(thresholds[terrain] ?? 0);
      }
      noiseMap.push(row);
    }

    this.noiseMap = noiseMap;
    return noiseMap;
  }

  // ==========================================================================
  // SEED REGION METHODS
  // ==========================================================================

  /**
   * Set seed regions from macro algorithm
   * These are tiles where refinement algorithms should operate
   *
   * @param {Set<string>} regions - Set of "x,y" coordinate strings
   */
  setSeedRegions(regions) {
    this.seedRegions = regions;
  }

  /**
   * Check if a position is in a seed region
   *
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {boolean} True if position is in seed region
   */
  isInSeedRegion(x, y) {
    if (!this.seedRegions) return true; // No regions = operate everywhere
    return this.seedRegions.has(`${x},${y}`);
  }

  /**
   * Generate seed regions from noise thresholds
   * Tiles with noise in the specified range become seed regions
   *
   * @param {number} minThreshold - Minimum noise value (inclusive)
   * @param {number} maxThreshold - Maximum noise value (inclusive)
   * @returns {Set<string>} Generated seed regions
   */
  generateSeedRegionsFromNoise(minThreshold, maxThreshold) {
    if (!this.noiseMap) return new Set();

    const regions = new Set();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const noise = this.noiseMap[y][x];
        if (noise >= minThreshold && noise <= maxThreshold) {
          regions.add(`${x},${y}`);
        }
      }
    }

    this.seedRegions = regions;
    return regions;
  }

  /**
   * Get seed regions as coordinate array
   *
   * @returns {Array<{x: number, y: number}>} Array of coordinates
   */
  getSeedRegionCoords() {
    if (!this.seedRegions) return [];

    return Array.from(this.seedRegions).map(key => {
      const [x, y] = key.split(',').map(Number);
      return { x, y };
    });
  }

  // ==========================================================================
  // BOUNDARY METHODS
  // ==========================================================================

  /**
   * Find boundary tiles between terrain types
   * These are edges where refinement algorithms should blend
   *
   * @param {string} terrainA - First terrain type
   * @param {string} terrainB - Second terrain type
   * @returns {Set<string>} Set of boundary tile coordinates
   */
  findBoundaryTiles(terrainA, terrainB) {
    if (!this.terrain) return new Set();

    const boundaries = new Set();
    const directions = [[0, -1], [0, 1], [-1, 0], [1, 0]];

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const current = this.terrain[y][x];
        if (current !== terrainA && current !== terrainB) continue;

        for (const [dx, dy] of directions) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;

          const neighbor = this.terrain[ny][nx];
          if ((current === terrainA && neighbor === terrainB) ||
              (current === terrainB && neighbor === terrainA)) {
            boundaries.add(`${x},${y}`);
            break;
          }
        }
      }
    }

    this.boundaryTiles = boundaries;
    return boundaries;
  }

  /**
   * Check if position is on a boundary
   *
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {boolean} True if on boundary
   */
  isOnBoundary(x, y) {
    if (!this.boundaryTiles) return false;
    return this.boundaryTiles.has(`${x},${y}`);
  }

  // ==========================================================================
  // ROOM METHODS
  // ==========================================================================

  /**
   * Add a room definition
   *
   * @param {Object} room - Room definition
   * @param {number} room.x - Room X position
   * @param {number} room.y - Room Y position
   * @param {number} room.width - Room width
   * @param {number} room.height - Room height
   * @param {string} room.type - Room type identifier
   * @param {string} room.terrain - Floor terrain type
   */
  addRoom(room) {
    this.rooms.push({
      id: `room_${this.rooms.length}`,
      ...room,
      center: {
        x: Math.floor(room.x + room.width / 2),
        y: Math.floor(room.y + room.height / 2)
      }
    });
  }

  /**
   * Check if position is inside any room
   *
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {Object|null} Room containing position or null
   */
  getRoomAt(x, y) {
    for (const room of this.rooms) {
      if (x >= room.x && x < room.x + room.width &&
          y >= room.y && y < room.y + room.height) {
        return room;
      }
    }
    return null;
  }

  /**
   * Get all room centers
   *
   * @returns {Array<{x: number, y: number, roomId: string}>}
   */
  getRoomCenters() {
    return this.rooms.map(room => ({
      x: room.center.x,
      y: room.center.y,
      roomId: room.id
    }));
  }

  // ==========================================================================
  // PATH METHODS
  // ==========================================================================

  /**
   * Add a path segment
   *
   * @param {Object} path - Path definition
   * @param {Array<{x: number, y: number}>} path.points - Path waypoints
   * @param {number} path.width - Path width
   * @param {string} path.type - Path type identifier
   */
  addPath(path) {
    this.paths.push({
      id: `path_${this.paths.length}`,
      ...path
    });
  }

  /**
   * Check if position is on any path
   *
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {boolean} True if on a path
   */
  isOnPath(x, y) {
    const halfWidth = 1; // Check 3x3 area for paths

    for (const path of this.paths) {
      for (const point of path.points) {
        if (Math.abs(x - point.x) <= halfWidth && Math.abs(y - point.y) <= halfWidth) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Get all path points as a set
   *
   * @returns {Set<string>} Set of path coordinate strings
   */
  getPathPoints() {
    const points = new Set();
    for (const path of this.paths) {
      for (const point of path.points) {
        points.add(`${point.x},${point.y}`);
      }
    }
    return points;
  }

  // ==========================================================================
  // POI METHODS
  // ==========================================================================

  /**
   * Add a point of interest
   *
   * @param {Object} poi - POI definition
   * @param {number} poi.x - POI X position
   * @param {number} poi.y - POI Y position
   * @param {string} poi.type - POI type (playerSpawn, enemySpawn, objective, etc.)
   * @param {string} poi.role - POI role for pathfinding priority
   */
  addPOI(poi) {
    this.pois.push({
      id: `poi_${this.pois.length}`,
      ...poi
    });
  }

  /**
   * Get POIs by type
   *
   * @param {string} type - POI type
   * @returns {Array} Matching POIs
   */
  getPOIsByType(type) {
    return this.pois.filter(poi => poi.type === type);
  }

  /**
   * Check if position is near a POI
   *
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} radius - Check radius
   * @returns {Object|null} Nearby POI or null
   */
  getNearbyPOI(x, y, radius = 3) {
    for (const poi of this.pois) {
      const dist = Math.abs(x - poi.x) + Math.abs(y - poi.y);
      if (dist <= radius) return poi;
    }
    return null;
  }

  // ==========================================================================
  // ELEVATION METHODS
  // ==========================================================================

  /**
   * Set elevation data
   *
   * @param {number[][]} elevation - Elevation grid
   */
  setElevation(elevation) {
    this.elevation = elevation;
  }

  /**
   * Get elevation at position
   *
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {number|null} Elevation value or null
   */
  getElevation(x, y) {
    if (!this.elevation) return null;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    return this.elevation[y][x];
  }

  // ==========================================================================
  // COVER GRID METHODS
  // ==========================================================================

  /**
   * Set cover grid
   *
   * @param {number[][]} coverGrid - Cover grid (0=none, 1=low, 2=high)
   */
  setCoverGrid(coverGrid) {
    this.coverGrid = coverGrid;
  }

  /**
   * Get cover value at position
   *
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {number} Cover level (0=none, 1=low, 2=high)
   */
  getCover(x, y) {
    if (!this.coverGrid) return 0;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.coverGrid[y][x];
  }

  // ==========================================================================
  // METADATA METHODS
  // ==========================================================================

  /**
   * Record algorithm execution
   *
   * @param {string} algorithmName - Algorithm name
   * @param {string} role - Algorithm role
   */
  recordAlgorithm(algorithmName, role) {
    this.meta.algorithmOrder.push({ name: algorithmName, role, pass: this.meta.passes });
  }

  /**
   * Increment pass counter
   */
  incrementPass() {
    this.meta.passes++;
  }

  /**
   * Export context state for debugging/serialization
   *
   * @returns {Object} Serializable context state
   */
  export() {
    return {
      width: this.width,
      height: this.height,
      rooms: this.rooms,
      paths: this.paths,
      pois: this.pois,
      meta: this.meta,
      hasNoiseMap: this.noiseMap !== null,
      hasSeedRegions: this.seedRegions !== null,
      hasElevation: this.elevation !== null,
      hasCoverGrid: this.coverGrid !== null
    };
  }

  /**
   * Reset context for reuse
   */
  reset() {
    this.terrain = null;
    this.noiseMap = null;
    this.seedRegions = null;
    this.boundaryTiles = null;
    this.rooms = [];
    this.paths = [];
    this.pois = [];
    this.elevation = null;
    this.coverGrid = null;
    this.meta = {
      algorithmOrder: [],
      passes: 0
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new layer context
 *
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @returns {LayerContext} New context instance
 */
export function createLayerContext(width, height) {
  return new LayerContext(width, height);
}

export default LayerContext;
