/**
 * ElevationMapper - Generates multi-level elevation data for battle maps
 *
 * Creates elevation grids with valid transitions (ramps, stairs, cliffs, ledges)
 * to enable vertical tactical gameplay. Ensures all areas remain reachable
 * through proper connection placement.
 *
 * Elevation levels:
 * - -1 (PIT): Pits, trenches - can drop into, hard to climb out
 * - 0 (GROUND): Ground level - default
 * - 1 (RAISED): Raised platforms, small hills
 * - 2 (HIGH): High ground, cliffs
 * - 3 (PEAK): Mountain peaks - rare
 *
 * Connection types:
 * - ramp: Gentle slope, no movement penalty
 * - stairs: Steps, +1 movement cost
 * - ledge: One-way drop (can go down, not up)
 * - cliff: Impassable wall
 *
 * CRITICAL: All random operations use seeded random for server/client sync.
 */

import { SimplexNoise } from './algorithms/PerlinNoise.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Elevation level definitions
 */
export const ELEVATION_LEVELS = {
  PIT: -1,
  GROUND: 0,
  RAISED: 1,
  HIGH: 2,
  PEAK: 3
};

/**
 * Connection type definitions for elevation transitions
 */
export const CONNECTION_TYPES = {
  RAMP: 'ramp',
  STAIRS: 'stairs',
  LEDGE: 'ledge',
  CLIFF: 'cliff'
};

/**
 * Direction vectors for 4-directional connections
 */
export const DIRECTIONS = {
  N: { dx: 0, dy: -1, name: 'n', opposite: 's' },
  S: { dx: 0, dy: 1, name: 's', opposite: 'n' },
  E: { dx: 1, dy: 0, name: 'e', opposite: 'w' },
  W: { dx: -1, dy: 0, name: 'w', opposite: 'e' }
};

/**
 * Default elevation generation options
 */
export const DEFAULT_OPTIONS = {
  maxElevation: 3,
  minElevation: -1,
  noiseScale: 0.08,
  noiseOctaves: 3,
  noisePersistence: 0.5,
  pitChance: 0.05,       // Chance of generating pits
  peakChance: 0.03,      // Chance of peak terrain
  flattenEdges: true,    // Keep map edges at ground level
  edgeMargin: 2,         // Tiles from edge to flatten
  rampPreference: 0.4,   // Preference for ramps over stairs
  stairsPreference: 0.35, // Preference for stairs over ledges
  minRampsPerLevel: 2,   // Minimum ramps between adjacent levels
  ensureConnectivity: true // Ensure all areas are reachable
};

// ============================================================================
// ELEVATION MAPPER CLASS
// ============================================================================

/**
 * ElevationMapper - Generates elevation data for tactical battle maps
 */
export class ElevationMapper {
  /**
   * Create a new ElevationMapper
   * @param {Object} options - Configuration options
   * @param {number} options.maxElevation - Maximum elevation level (default 3)
   * @param {number} options.minElevation - Minimum elevation level (default -1)
   * @param {number} options.noiseScale - Perlin noise scale (default 0.08)
   * @param {number} options.pitChance - Chance of pit generation (default 0.05)
   * @param {number} options.peakChance - Chance of peak terrain (default 0.03)
   * @param {boolean} options.flattenEdges - Keep edges at ground level (default true)
   * @param {number} options.rampPreference - Preference for ramps (default 0.4)
   */
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Generate elevation data for a battle map
   *
   * @param {number} width - Map width in tiles
   * @param {number} height - Map height in tiles
   * @param {Function} random - Seeded random function returning 0-1
   * @param {string[][]} terrain - Optional terrain grid for context
   * @returns {Object} { elevation: number[][], connections: Object[][] }
   */
  generateElevation(width, height, random, terrain = null) {
    // Generate base elevation from noise
    const elevation = this._generateBaseElevation(width, height, random);

    // Apply terrain-based modifications if terrain is provided
    if (terrain) {
      this._applyTerrainModifiers(elevation, terrain);
    }

    // Flatten edges if configured
    if (this.options.flattenEdges) {
      this._flattenEdges(elevation, this.options.edgeMargin);
    }

    // Smooth elevation transitions
    this._smoothElevation(elevation, random);

    // Generate connections (ramps, stairs, ledges, cliffs)
    const connections = this._generateConnections(elevation, random);

    // Ensure connectivity if configured
    if (this.options.ensureConnectivity) {
      this._ensureConnectivity(elevation, connections, random);
    }

    return { elevation, connections };
  }

  /**
   * Generate base elevation using Perlin noise
   * @private
   */
  _generateBaseElevation(width, height, random) {
    const noise = new SimplexNoise(random);
    const elevation = [];

    const { noiseScale, noiseOctaves, noisePersistence, pitChance, peakChance, minElevation, maxElevation } = this.options;

    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        // Get noise value (-1 to 1)
        const noiseValue = noise.fbm(
          x * noiseScale,
          y * noiseScale,
          noiseOctaves,
          noisePersistence
        );

        // Map noise to elevation levels
        let level;
        if (noiseValue < -0.4 && random() < pitChance * 2) {
          level = minElevation; // PIT
        } else if (noiseValue > 0.6 && random() < peakChance * 2) {
          level = maxElevation; // PEAK
        } else if (noiseValue > 0.4) {
          level = ELEVATION_LEVELS.HIGH;
        } else if (noiseValue > 0.1) {
          level = ELEVATION_LEVELS.RAISED;
        } else if (noiseValue < -0.3) {
          // Small chance of pit even in medium-low areas
          level = random() < pitChance ? ELEVATION_LEVELS.PIT : ELEVATION_LEVELS.GROUND;
        } else {
          level = ELEVATION_LEVELS.GROUND;
        }

        row.push(level);
      }
      elevation.push(row);
    }

    return elevation;
  }

  /**
   * Apply terrain-based modifiers to elevation
   * @private
   */
  _applyTerrainModifiers(elevation, terrain) {
    const height = elevation.length;
    const width = elevation[0].length;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = terrain[y]?.[x];

        switch (tile) {
          case 'rock':
          case 'cliff':
            // Rock/cliff terrain tends to be elevated
            elevation[y][x] = Math.max(elevation[y][x], ELEVATION_LEVELS.RAISED);
            break;
          case 'water':
            // Water is at ground level or lower
            elevation[y][x] = Math.min(elevation[y][x], ELEVATION_LEVELS.GROUND);
            break;
          case 'lava':
            // Lava is in pits
            elevation[y][x] = ELEVATION_LEVELS.PIT;
            break;
          // grass, stone, forest keep their generated elevation
        }
      }
    }
  }

  /**
   * Flatten map edges to ground level
   * @private
   */
  _flattenEdges(elevation, margin) {
    const height = elevation.length;
    const width = elevation[0].length;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Check if within edge margin
        const distFromEdge = Math.min(x, y, width - 1 - x, height - 1 - y);
        if (distFromEdge < margin) {
          // Gradually transition to ground level
          const factor = distFromEdge / margin;
          const targetLevel = ELEVATION_LEVELS.GROUND;
          const currentLevel = elevation[y][x];
          elevation[y][x] = Math.round(targetLevel + (currentLevel - targetLevel) * factor);
        }
      }
    }
  }

  /**
   * Smooth elevation to avoid jagged transitions
   * Limits elevation changes to 1 level between adjacent tiles
   * @private
   */
  _smoothElevation(elevation, random) {
    const height = elevation.length;
    const width = elevation[0].length;
    const passes = 2;

    for (let pass = 0; pass < passes; pass++) {
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const current = elevation[y][x];

          // Get neighbor elevations
          const neighbors = [
            elevation[y - 1][x],
            elevation[y + 1][x],
            elevation[y][x - 1],
            elevation[y][x + 1]
          ];

          // Check for extreme differences
          const maxNeighbor = Math.max(...neighbors);
          const minNeighbor = Math.min(...neighbors);

          // If current is more than 2 levels different from neighbors, adjust
          if (current > maxNeighbor + 1) {
            elevation[y][x] = maxNeighbor + 1;
          } else if (current < minNeighbor - 1) {
            elevation[y][x] = minNeighbor - 1;
          }
        }
      }
    }
  }

  /**
   * Generate connections between elevation levels
   * Returns a 2D grid where each cell contains connection info
   * @private
   */
  _generateConnections(elevation, random) {
    const height = elevation.length;
    const width = elevation[0].length;
    const { rampPreference, stairsPreference } = this.options;

    // Initialize connections grid
    const connections = [];
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        row.push({});
      }
      connections.push(row);
    }

    // Process each tile to determine connections with neighbors
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const currentElev = elevation[y][x];

        // Check each direction
        for (const dir of Object.values(DIRECTIONS)) {
          const nx = x + dir.dx;
          const ny = y + dir.dy;

          // Skip out of bounds
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

          const neighborElev = elevation[ny][nx];
          const elevDiff = neighborElev - currentElev;

          // Only process connections where we go UP (to avoid duplicates)
          // We'll set both directions at once
          if (elevDiff > 0) {
            const connection = this._determineConnectionType(
              elevDiff,
              random,
              rampPreference,
              stairsPreference
            );

            // Set connection in both directions
            connections[y][x][dir.name] = connection;
            connections[ny][nx][dir.opposite] = connection;
          } else if (elevDiff === 0) {
            // Same level - no special connection needed
            connections[y][x][dir.name] = null;
          }
        }
      }
    }

    return connections;
  }

  /**
   * Determine connection type based on elevation difference
   * @private
   */
  _determineConnectionType(elevDiff, random, rampPreference, stairsPreference) {
    // More than 1 level difference is always a cliff (impassable)
    // unless we specifically place a multi-level ramp
    if (elevDiff > 2) {
      return { type: CONNECTION_TYPES.CLIFF, levels: elevDiff };
    }

    if (elevDiff === 2) {
      // 2-level drop: can be ledge (one-way) or cliff
      const roll = random();
      if (roll < 0.6) {
        return { type: CONNECTION_TYPES.LEDGE, levels: 2 };
      }
      return { type: CONNECTION_TYPES.CLIFF, levels: 2 };
    }

    // 1-level difference: ramp, stairs, or ledge
    const roll = random();
    if (roll < rampPreference) {
      return { type: CONNECTION_TYPES.RAMP, levels: 1 };
    } else if (roll < rampPreference + stairsPreference) {
      return { type: CONNECTION_TYPES.STAIRS, levels: 1 };
    } else {
      return { type: CONNECTION_TYPES.LEDGE, levels: 1 };
    }
  }

  /**
   * Ensure all elevated areas are reachable by adding ramps
   * @private
   */
  _ensureConnectivity(elevation, connections, random) {
    const height = elevation.length;
    const width = elevation[0].length;

    // Find all distinct elevation regions
    const regions = this._findElevationRegions(elevation);

    // For each pair of adjacent levels, ensure there's at least one ramp
    const levelPairs = this._findAdjacentLevelPairs(regions);

    for (const [lowerLevel, higherLevel] of levelPairs) {
      const existingRamps = this._countRampsBetweenLevels(
        elevation, connections, lowerLevel, higherLevel
      );

      const minRamps = this.options.minRampsPerLevel;
      if (existingRamps < minRamps) {
        // Find border tiles between these levels and add ramps
        this._addRampsBetweenLevels(
          elevation, connections, lowerLevel, higherLevel,
          minRamps - existingRamps, random
        );
      }
    }
  }

  /**
   * Find contiguous regions of each elevation level
   * @private
   */
  _findElevationRegions(elevation) {
    const height = elevation.length;
    const width = elevation[0].length;
    const visited = new Set();
    const regions = new Map(); // level -> array of regions (each region is array of {x,y})

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const key = `${x},${y}`;
        if (visited.has(key)) continue;

        const level = elevation[y][x];
        const region = [];
        const queue = [{ x, y }];
        visited.add(key);

        // Flood fill to find connected region
        while (queue.length > 0) {
          const pos = queue.shift();
          region.push(pos);

          for (const dir of Object.values(DIRECTIONS)) {
            const nx = pos.x + dir.dx;
            const ny = pos.y + dir.dy;
            const nkey = `${nx},${ny}`;

            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (visited.has(nkey)) continue;
            if (elevation[ny][nx] !== level) continue;

            visited.add(nkey);
            queue.push({ x: nx, y: ny });
          }
        }

        if (!regions.has(level)) {
          regions.set(level, []);
        }
        regions.get(level).push(region);
      }
    }

    return regions;
  }

  /**
   * Find all pairs of adjacent elevation levels
   * @private
   */
  _findAdjacentLevelPairs(regions) {
    const levels = Array.from(regions.keys()).sort((a, b) => a - b);
    const pairs = [];

    for (let i = 0; i < levels.length - 1; i++) {
      if (levels[i + 1] - levels[i] <= 2) {
        pairs.push([levels[i], levels[i + 1]]);
      }
    }

    return pairs;
  }

  /**
   * Count existing ramps between two elevation levels
   * @private
   */
  _countRampsBetweenLevels(elevation, connections, lowerLevel, higherLevel) {
    const height = elevation.length;
    const width = elevation[0].length;
    let count = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (elevation[y][x] !== lowerLevel) continue;

        const cellConnections = connections[y][x];
        for (const dir of Object.values(DIRECTIONS)) {
          const conn = cellConnections[dir.name];
          if (!conn) continue;

          const nx = x + dir.dx;
          const ny = y + dir.dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

          if (elevation[ny][nx] === higherLevel) {
            if (conn.type === CONNECTION_TYPES.RAMP || conn.type === CONNECTION_TYPES.STAIRS) {
              count++;
            }
          }
        }
      }
    }

    return count;
  }

  /**
   * Add ramps between two elevation levels
   * @private
   */
  _addRampsBetweenLevels(elevation, connections, lowerLevel, higherLevel, count, random) {
    const height = elevation.length;
    const width = elevation[0].length;
    const borderTiles = [];

    // Find all border tiles between these levels
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (elevation[y][x] !== lowerLevel) continue;

        for (const dir of Object.values(DIRECTIONS)) {
          const nx = x + dir.dx;
          const ny = y + dir.dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

          if (elevation[ny][nx] === higherLevel) {
            borderTiles.push({ x, y, dir, nx, ny });
          }
        }
      }
    }

    // Shuffle and pick tiles to add ramps
    for (let i = borderTiles.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [borderTiles[i], borderTiles[j]] = [borderTiles[j], borderTiles[i]];
    }

    const rampsToAdd = Math.min(count, borderTiles.length);
    for (let i = 0; i < rampsToAdd; i++) {
      const tile = borderTiles[i];
      const newConnection = {
        type: random() < 0.6 ? CONNECTION_TYPES.RAMP : CONNECTION_TYPES.STAIRS,
        levels: higherLevel - lowerLevel
      };

      connections[tile.y][tile.x][tile.dir.name] = newConnection;
      connections[tile.ny][tile.nx][tile.dir.opposite] = newConnection;
    }
  }

  /**
   * Get elevation at a specific position
   * @param {number[][]} elevation - Elevation grid
   * @param {number} x - X position
   * @param {number} y - Y position
   * @returns {number} Elevation level or 0 if out of bounds
   */
  static getElevationAt(elevation, x, y) {
    if (!elevation || y < 0 || x < 0 || y >= elevation.length || x >= elevation[0].length) {
      return ELEVATION_LEVELS.GROUND;
    }
    return elevation[y][x];
  }

  /**
   * Get connection between two adjacent tiles
   * @param {Object[][]} connections - Connections grid
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {string} direction - Direction ('n', 's', 'e', 'w')
   * @returns {Object|null} Connection object or null
   */
  static getConnectionAt(connections, x, y, direction) {
    if (!connections || y < 0 || x < 0 || y >= connections.length || x >= connections[0].length) {
      return null;
    }
    return connections[y][x][direction] || null;
  }

  /**
   * Check if movement between two tiles is allowed
   * @param {number[][]} elevation - Elevation grid
   * @param {Object[][]} connections - Connections grid
   * @param {number} fromX - Starting X
   * @param {number} fromY - Starting Y
   * @param {number} toX - Destination X
   * @param {number} toY - Destination Y
   * @param {Object} options - Movement options
   * @param {number} options.maxClimb - Maximum climb height (default 1)
   * @param {number} options.maxDrop - Maximum drop height (default 2)
   * @returns {Object} { canMove: boolean, cost: number, type: string }
   */
  static canMove(elevation, connections, fromX, fromY, toX, toY, options = {}) {
    const maxClimb = options.maxClimb ?? 1;
    const maxDrop = options.maxDrop ?? 2;

    const fromElev = ElevationMapper.getElevationAt(elevation, fromX, fromY);
    const toElev = ElevationMapper.getElevationAt(elevation, toX, toY);
    const elevDiff = toElev - fromElev;

    // Determine direction
    const dx = toX - fromX;
    const dy = toY - fromY;
    let direction = null;
    if (dx === 1) direction = 'e';
    else if (dx === -1) direction = 'w';
    else if (dy === 1) direction = 's';
    else if (dy === -1) direction = 'n';

    if (!direction) {
      return { canMove: false, cost: Infinity, type: 'invalid' };
    }

    const connection = ElevationMapper.getConnectionAt(connections, fromX, fromY, direction);

    // Same level - always allowed
    if (elevDiff === 0) {
      return { canMove: true, cost: 0, type: 'flat' };
    }

    // Going up
    if (elevDiff > 0) {
      if (elevDiff > maxClimb) {
        // Check for multi-level connection
        if (!connection || connection.type === CONNECTION_TYPES.CLIFF) {
          return { canMove: false, cost: Infinity, type: 'cliff' };
        }
        if (connection.type === CONNECTION_TYPES.LEDGE) {
          // Ledges are one-way (down only)
          return { canMove: false, cost: Infinity, type: 'ledge_wrong_way' };
        }
      }

      // Check connection type
      if (!connection) {
        return { canMove: false, cost: Infinity, type: 'no_connection' };
      }

      switch (connection.type) {
        case CONNECTION_TYPES.RAMP:
          return { canMove: true, cost: 0, type: 'ramp' };
        case CONNECTION_TYPES.STAIRS:
          return { canMove: true, cost: 1, type: 'stairs' };
        case CONNECTION_TYPES.LEDGE:
          // Cannot climb up ledges
          return { canMove: false, cost: Infinity, type: 'ledge_wrong_way' };
        case CONNECTION_TYPES.CLIFF:
          return { canMove: false, cost: Infinity, type: 'cliff' };
        default:
          return { canMove: false, cost: Infinity, type: 'unknown' };
      }
    }

    // Going down
    if (elevDiff < 0) {
      const dropHeight = Math.abs(elevDiff);

      if (dropHeight > maxDrop) {
        return { canMove: false, cost: Infinity, type: 'too_high' };
      }

      // Check connection from the perspective of going down
      if (!connection) {
        // No explicit connection - check if drop is within limits
        if (dropHeight <= maxDrop) {
          return { canMove: true, cost: 0, type: 'drop' };
        }
        return { canMove: false, cost: Infinity, type: 'no_connection' };
      }

      switch (connection.type) {
        case CONNECTION_TYPES.RAMP:
          return { canMove: true, cost: 0, type: 'ramp' };
        case CONNECTION_TYPES.STAIRS:
          return { canMove: true, cost: 1, type: 'stairs' };
        case CONNECTION_TYPES.LEDGE:
          // Can always go down ledges
          return { canMove: true, cost: 0, type: 'ledge' };
        case CONNECTION_TYPES.CLIFF:
          // Even cliffs can be descended if within drop limit
          if (dropHeight <= maxDrop) {
            return { canMove: true, cost: 0, type: 'cliff_drop' };
          }
          return { canMove: false, cost: Infinity, type: 'cliff' };
        default:
          return { canMove: true, cost: 0, type: 'drop' };
      }
    }

    return { canMove: false, cost: Infinity, type: 'error' };
  }
}

export default ElevationMapper;
