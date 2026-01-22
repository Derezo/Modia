/**
 * ElevationMapper - Generates multi-level elevation data for battle maps
 *
 * Creates elevation grids with valid transitions (ramps, stairs, cliffs, ledges)
 * to enable vertical tactical gameplay. Ensures all areas remain reachable
 * through proper connection placement.
 *
 * Elevation levels (extended range -3 to +8):
 * - -3 (DEEP_PIT): Deep chasms, bottomless pits
 * - -2 (PIT): Standard pits, trenches
 * - -1 (TRENCH): Shallow depressions
 * - 0 (GROUND): Ground level - default
 * - 1 (RAISED): Raised platforms, small hills
 * - 2 (HIGH): High ground, cliffs
 * - 3 (VERY_HIGH): Tall platforms, cliff tops
 * - 4 (PEAK): Mountain peaks
 * - 5 (SPIRE): Tower bases, tall formations
 * - 6 (TOWER): Tower mid-sections
 * - 7 (TOWER_TOP): Tower tops
 * - 8 (CLOUD): Floating platforms, extreme heights
 *
 * Connection types:
 * - ramp: Gentle slope, no movement penalty (1 level)
 * - stairs: Steps, +1 movement cost (1-2 levels)
 * - ledge: One-way drop (can go down, not up) (1-2 levels)
 * - cliff: Impassable wall (2+ levels)
 * - slope: Multi-level gradual transition (2-3 levels)
 * - long_ramp: Extended ramp for larger drops (3 levels)
 * - multi_stairs: Multiple stair flights (3-4 levels)
 *
 * CRITICAL: All random operations use seeded random for server/client sync.
 */

import { SimplexNoise } from './algorithms/PerlinNoise.js';
import {
  ELEVATION_LEVELS,
  ELEVATION_CONNECTION_TYPES as CONNECTION_TYPES
} from '../terrain.js';

// Re-export for backward compatibility with existing imports from this module
export { ELEVATION_LEVELS, CONNECTION_TYPES };

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
  maxElevation: 8,           // Extended maximum for towers/cloud platforms
  minElevation: -3,          // Extended minimum for deep pits
  noiseScale: 0.06,          // Lower = larger terrain features
  noiseOctaves: 5,           // More octaves = more detail levels
  noisePersistence: 0.6,     // Higher = more height variation
  pitChance: 0.05,           // Chance of generating pits
  peakChance: 0.03,          // Chance of peak terrain
  towerChance: 0.02,         // Chance of tower placement on elevated terrain
  deepPitChance: 0.01,       // Chance of deep pit placement in low areas
  flattenEdges: true,        // Keep map edges at ground level
  edgeMargin: 2,             // Tiles from edge to flatten
  rampPreference: 0.35,      // Preference for ramps over stairs
  stairsPreference: 0.4,     // Preference for stairs over ledges
  minRampsPerLevel: 3,       // Minimum ramps between adjacent levels
  ensureConnectivity: true   // Ensure all areas are reachable
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
   * @param {number} options.maxElevation - Maximum elevation level (default 8)
   * @param {number} options.minElevation - Minimum elevation level (default -3)
   * @param {number} options.noiseScale - Perlin noise scale (default 0.06)
   * @param {number} options.noiseOctaves - Number of noise octaves (default 5)
   * @param {number} options.noisePersistence - Noise persistence (default 0.6)
   * @param {number} options.pitChance - Chance of pit generation (default 0.05)
   * @param {number} options.peakChance - Chance of peak terrain (default 0.03)
   * @param {number} options.towerChance - Chance of tower placement (default 0.02)
   * @param {number} options.deepPitChance - Chance of deep pit placement (default 0.01)
   * @param {boolean} options.flattenEdges - Keep edges at ground level (default true)
   * @param {number} options.rampPreference - Preference for ramps (default 0.35)
   * @param {number} options.stairsPreference - Preference for stairs (default 0.4)
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
   * @returns {Object} { elevation: number[][], connections: Object[][], towers: Array }
   */
  generateElevation(width, height, random, terrain = null) {
    // Generate base elevation from noise
    const elevation = this._generateBaseElevation(width, height, random);

    // Apply terrain-based modifications if terrain is provided
    if (terrain) {
      this._applyTerrainModifiers(elevation, terrain);
    }

    // Generate tall structures (towers, deep pits) in appropriate areas
    const towers = this._generateTallStructures(elevation, random);

    // Flatten edges if configured
    if (this.options.flattenEdges) {
      this._flattenEdges(elevation, this.options.edgeMargin);
    }

    // Smooth elevation transitions
    this._smoothElevation(elevation, random);

    // Generate connections (ramps, stairs, ledges, cliffs)
    const connections = this._generateConnections(elevation, random);

    // Place slopes for multi-level transitions
    this._placeSlopes(elevation, connections);

    // Ensure connectivity if configured
    if (this.options.ensureConnectivity) {
      this._ensureConnectivity(elevation, connections, random);
    }

    return { elevation, connections, towers };
  }

  /**
   * Generate base elevation using Perlin noise
   * Uses extended elevation range (-3 to +8) for more dramatic terrain
   * @private
   */
  _generateBaseElevation(width, height, random) {
    const noise = new SimplexNoise(random);
    const elevation = [];

    const { noiseScale, noiseOctaves, noisePersistence, pitChance, peakChance } = this.options;

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

        // Map noise to elevation levels with extended range
        let level;
        if (noiseValue < -0.6 && random() < pitChance * 3) {
          // Deep pit in very low noise areas
          level = ELEVATION_LEVELS.PIT; // -2 (deep pits handled separately)
        } else if (noiseValue < -0.4 && random() < pitChance * 2) {
          // Standard pit
          level = ELEVATION_LEVELS.TRENCH; // -1
        } else if (noiseValue > 0.8 && random() < peakChance * 3) {
          // Very high peak
          level = ELEVATION_LEVELS.PEAK; // 4
        } else if (noiseValue > 0.6 && random() < peakChance * 2) {
          // High peak
          level = ELEVATION_LEVELS.VERY_HIGH; // 3
        } else if (noiseValue > 0.4) {
          // High ground
          level = ELEVATION_LEVELS.HIGH; // 2
        } else if (noiseValue > 0.15) {
          // Raised terrain
          level = ELEVATION_LEVELS.RAISED; // 1
        } else if (noiseValue < -0.25) {
          // Small chance of trench in medium-low areas
          level = random() < pitChance ? ELEVATION_LEVELS.TRENCH : ELEVATION_LEVELS.GROUND;
        } else {
          // Ground level
          level = ELEVATION_LEVELS.GROUND; // 0
        }

        row.push(level);
      }
      elevation.push(row);
    }

    return elevation;
  }

  /**
   * Generate tall structures (towers, pillars) in elevated areas
   * Called after base elevation to create dramatic vertical features
   * @private
   * @param {number[][]} elevation - Elevation grid to modify
   * @param {Function} random - Seeded random function
   * @returns {Array<{x: number, y: number, height: number}>} Array of tower positions
   */
  _generateTallStructures(elevation, random) {
    const height = elevation.length;
    const width = elevation[0].length;
    const towers = [];
    const { towerChance, deepPitChance, maxElevation, minElevation } = this.options;

    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const currentElev = elevation[y][x];

        // Tower placement on already-elevated terrain
        if (currentElev >= ELEVATION_LEVELS.HIGH && random() < towerChance) {
          const towerHeight = ELEVATION_LEVELS.SPIRE + Math.floor(random() * 3); // 5-7
          elevation[y][x] = Math.min(towerHeight, maxElevation);

          // Create gradual descent around tower base
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              elevation[ny][nx] = Math.max(
                elevation[ny][nx],
                Math.min(towerHeight - 2, ELEVATION_LEVELS.VERY_HIGH)
              );
            }
          }
          towers.push({ x, y, height: elevation[y][x] });
        }

        // Deep pit placement in low areas
        if (currentElev <= ELEVATION_LEVELS.GROUND && random() < deepPitChance) {
          elevation[y][x] = Math.max(ELEVATION_LEVELS.DEEP_PIT, minElevation);

          // Gradual descent into pit
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
              elevation[ny][nx] = Math.min(
                elevation[ny][nx],
                ELEVATION_LEVELS.PIT
              );
            }
          }
        }
      }
    }

    return towers;
  }

  /**
   * Apply terrain-based modifiers to elevation
   * Uses extended elevation levels for more dramatic terrain features
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
          case 'mountain':
            // Mountain terrain is high
            elevation[y][x] = Math.max(elevation[y][x], ELEVATION_LEVELS.HIGH);
            break;
          case 'water':
            // Water is at ground level or lower (shallow water)
            elevation[y][x] = Math.min(elevation[y][x], ELEVATION_LEVELS.GROUND);
            break;
          case 'deep_water':
            // Deep water in trenches
            elevation[y][x] = Math.min(elevation[y][x], ELEVATION_LEVELS.TRENCH);
            break;
          case 'lava':
            // Lava is in pits
            elevation[y][x] = ELEVATION_LEVELS.PIT;
            break;
          case 'chasm':
            // Chasms are deep pits
            elevation[y][x] = ELEVATION_LEVELS.DEEP_PIT;
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
   * With extended range, allows up to 2 level changes between adjacent tiles
   * (preserving tall structures while smoothing general terrain)
   * @private
   */
  _smoothElevation(elevation, random) {
    const height = elevation.length;
    const width = elevation[0].length;
    const passes = 2;
    // Allow steeper gradients for tall structures (towers go from 5+ levels)
    const maxGradient = 2;

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

          // Preserve tall structures (SPIRE and above) from aggressive smoothing
          if (current >= ELEVATION_LEVELS.SPIRE) {
            // Only smooth if ALL neighbors are much lower
            if (maxNeighbor < ELEVATION_LEVELS.HIGH) {
              elevation[y][x] = Math.max(current, maxNeighbor + maxGradient);
            }
            continue;
          }

          // Preserve deep pits from aggressive smoothing
          if (current <= ELEVATION_LEVELS.DEEP_PIT) {
            if (minNeighbor > ELEVATION_LEVELS.TRENCH) {
              elevation[y][x] = Math.min(current, minNeighbor - maxGradient);
            }
            continue;
          }

          // If current is more than maxGradient levels different from neighbors, adjust
          if (current > maxNeighbor + maxGradient) {
            elevation[y][x] = maxNeighbor + maxGradient;
          } else if (current < minNeighbor - maxGradient) {
            elevation[y][x] = minNeighbor - maxGradient;
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
   * Handles extended elevation range with multi-level transitions
   * @private
   */
  _determineConnectionType(elevDiff, random, rampPreference, stairsPreference) {
    // 5+ level difference is always an impassable cliff
    if (elevDiff > 4) {
      return { type: CONNECTION_TYPES.CLIFF, levels: elevDiff };
    }

    if (elevDiff === 4) {
      // 4 level jump: mostly cliff, some multi-stairs
      const roll = random();
      if (roll < 0.3) {
        return { type: 'multi_stairs', levels: 4, steps: 2 };
      }
      return { type: CONNECTION_TYPES.CLIFF, levels: 4 };
    }

    if (elevDiff === 3) {
      // 3 level difference: stairs, long ramp, or cliff
      const roll = random();
      if (roll < 0.4) {
        return { type: 'multi_stairs', levels: 3, steps: 2 };
      }
      if (roll < 0.7) {
        return { type: 'long_ramp', levels: 3 };
      }
      return { type: CONNECTION_TYPES.CLIFF, levels: 3 };
    }

    if (elevDiff === 2) {
      // 2-level drop: can be ledge, stairs, or cliff
      const roll = random();
      if (roll < 0.4) {
        return { type: CONNECTION_TYPES.LEDGE, levels: 2 };
      }
      if (roll < 0.7) {
        return { type: CONNECTION_TYPES.STAIRS, levels: 2 };
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
   * Mark tiles as slopes for multi-level transitions (2-3 levels)
   * Called after connections are generated to add slope transitions
   * @private
   * @param {number[][]} elevation - Elevation grid
   * @param {Object[][]} connections - Connections grid to modify
   */
  _placeSlopes(elevation, connections) {
    const height = elevation.length;
    const width = elevation[0].length;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const currentElev = elevation[y][x];

        for (const dir of Object.values(DIRECTIONS)) {
          const nx = x + dir.dx;
          const ny = y + dir.dy;

          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

          const neighborElev = elevation[ny][nx];
          const elevDiff = Math.abs(currentElev - neighborElev);

          // For 2-3 level transitions, check if we should convert to slope
          if (elevDiff >= 2 && elevDiff <= 3) {
            const existingConn = connections[y][x][dir.name];

            // Only add slope if no existing connection or it's a cliff
            if (!existingConn || existingConn.type === CONNECTION_TYPES.CLIFF) {
              const slopeConnection = {
                type: 'slope',
                direction: currentElev > neighborElev ? 'down' : 'up',
                levels: elevDiff
              };
              connections[y][x][dir.name] = slopeConnection;
              connections[ny][nx][dir.opposite] = slopeConnection;
            }
          }
        }
      }
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
   * Handles extended elevation range with appropriate connection types
   * @private
   */
  _addRampsBetweenLevels(elevation, connections, lowerLevel, higherLevel, count, random) {
    const height = elevation.length;
    const width = elevation[0].length;
    const borderTiles = [];
    const levelDiff = higherLevel - lowerLevel;

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

      // Choose appropriate connection type based on level difference
      let newConnection;
      if (levelDiff === 1) {
        newConnection = {
          type: random() < 0.6 ? CONNECTION_TYPES.RAMP : CONNECTION_TYPES.STAIRS,
          levels: 1
        };
      } else if (levelDiff === 2) {
        newConnection = {
          type: random() < 0.5 ? CONNECTION_TYPES.STAIRS : 'slope',
          levels: 2
        };
      } else if (levelDiff === 3) {
        newConnection = {
          type: random() < 0.5 ? 'long_ramp' : 'multi_stairs',
          levels: 3,
          steps: 2
        };
      } else {
        // 4+ levels - use multi_stairs
        newConnection = {
          type: 'multi_stairs',
          levels: levelDiff,
          steps: Math.ceil(levelDiff / 2)
        };
      }

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
   * Handles extended elevation range with new connection types
   * @param {number[][]} elevation - Elevation grid
   * @param {Object[][]} connections - Connections grid
   * @param {number} fromX - Starting X
   * @param {number} fromY - Starting Y
   * @param {number} toX - Destination X
   * @param {number} toY - Destination Y
   * @param {Object} options - Movement options
   * @param {number} options.maxClimb - Maximum climb height (default 1)
   * @param {number} options.maxDrop - Maximum drop height (default 3)
   * @returns {Object} { canMove: boolean, cost: number, type: string }
   */
  static canMove(elevation, connections, fromX, fromY, toX, toY, options = {}) {
    const maxClimb = options.maxClimb ?? 1;
    const maxDrop = options.maxDrop ?? 3; // Increased default for extended range

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
      // Check connection type for climbing
      if (!connection) {
        if (elevDiff <= maxClimb) {
          return { canMove: true, cost: elevDiff, type: 'climb' };
        }
        return { canMove: false, cost: Infinity, type: 'no_connection' };
      }

      switch (connection.type) {
        case CONNECTION_TYPES.RAMP:
          return { canMove: true, cost: 0, type: 'ramp' };
        case CONNECTION_TYPES.STAIRS:
          return { canMove: true, cost: 1, type: 'stairs' };
        case 'slope':
          // Slopes allow multi-level traversal with cost
          return { canMove: true, cost: connection.levels, type: 'slope' };
        case 'long_ramp':
          // Long ramps for 3-level transitions
          return { canMove: true, cost: 1, type: 'long_ramp' };
        case 'multi_stairs':
          // Multiple stair flights for 3-4 level transitions
          return { canMove: true, cost: connection.steps || 2, type: 'multi_stairs' };
        case CONNECTION_TYPES.LEDGE:
          // Cannot climb up ledges
          return { canMove: false, cost: Infinity, type: 'ledge_wrong_way' };
        case CONNECTION_TYPES.CLIFF:
          return { canMove: false, cost: Infinity, type: 'cliff' };
        default:
          // Unknown connection type - check if within climb limit
          if (elevDiff <= maxClimb) {
            return { canMove: true, cost: elevDiff, type: 'climb' };
          }
          return { canMove: false, cost: Infinity, type: 'unknown' };
      }
    }

    // Going down
    if (elevDiff < 0) {
      const dropHeight = Math.abs(elevDiff);

      // Check connection from the perspective of going down
      if (!connection) {
        // No explicit connection - check if drop is within limits
        if (dropHeight <= maxDrop) {
          return { canMove: true, cost: 0, type: 'drop' };
        }
        return { canMove: false, cost: Infinity, type: 'too_high' };
      }

      switch (connection.type) {
        case CONNECTION_TYPES.RAMP:
          return { canMove: true, cost: 0, type: 'ramp' };
        case CONNECTION_TYPES.STAIRS:
          return { canMove: true, cost: 1, type: 'stairs' };
        case 'slope':
          // Slopes allow multi-level traversal with reduced cost going down
          return { canMove: true, cost: Math.max(0, connection.levels - 1), type: 'slope' };
        case 'long_ramp':
          // Long ramps - easier going down
          return { canMove: true, cost: 0, type: 'long_ramp' };
        case 'multi_stairs':
          // Multiple stair flights - same cost up or down
          return { canMove: true, cost: connection.steps || 2, type: 'multi_stairs' };
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
          // Unknown connection - allow if within drop limit
          if (dropHeight <= maxDrop) {
            return { canMove: true, cost: 0, type: 'drop' };
          }
          return { canMove: false, cost: Infinity, type: 'too_high' };
      }
    }

    return { canMove: false, cost: Infinity, type: 'error' };
  }

  // ==========================================================================
  // INTEGRATION HOOKS - For algorithm cooperation
  // ==========================================================================

  /**
   * Flatten room interior to a single elevation level
   * Called by RoomCarver to ensure room floors are flat
   *
   * @param {number[][]} elevation - Elevation grid to modify
   * @param {Object} bounds - Room bounds { x, y, width, height }
   * @param {number} targetLevel - Target elevation level (default: most common in room)
   * @returns {number} The elevation level used
   */
  static flattenRoomElevation(elevation, bounds, targetLevel = null) {
    const { x, y, width, height } = bounds;

    // If no target level specified, find most common in room
    if (targetLevel === null) {
      const levelCounts = new Map();
      for (let ry = y; ry < y + height; ry++) {
        for (let rx = x; rx < x + width; rx++) {
          const level = ElevationMapper.getElevationAt(elevation, rx, ry);
          levelCounts.set(level, (levelCounts.get(level) || 0) + 1);
        }
      }

      // Find most common level
      let maxCount = 0;
      targetLevel = ELEVATION_LEVELS.GROUND;
      for (const [level, count] of levelCounts) {
        if (count > maxCount) {
          maxCount = count;
          targetLevel = level;
        }
      }
    }

    // Set all tiles in room to target level
    for (let ry = y; ry < y + height; ry++) {
      for (let rx = x; rx < x + width; rx++) {
        if (ry >= 0 && ry < elevation.length && rx >= 0 && rx < elevation[0].length) {
          elevation[ry][rx] = targetLevel;
        }
      }
    }

    return targetLevel;
  }

  /**
   * Enforce gradient along a path
   * Ensures no tile has more than maxGradient elevation change from previous
   * Called by PathCarver to smooth path elevation
   *
   * @param {number[][]} elevation - Elevation grid to modify
   * @param {Array<{x: number, y: number}>} path - Path waypoints
   * @param {number} maxGradient - Maximum elevation change per tile (default 1)
   * @param {function} random - Seeded random for ramp placement
   * @returns {Array<{x: number, y: number, type: string}>} Ramp/stair placements
   */
  static enforcePathGradient(elevation, path, maxGradient = 1, random = null) {
    if (!path || path.length < 2) return [];

    const rampPlacements = [];
    const rampChance = 0.7; // Chance to adjust elevation vs place ramp

    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1];
      const curr = path[i];

      const prevElev = ElevationMapper.getElevationAt(elevation, prev.x, prev.y);
      const currElev = ElevationMapper.getElevationAt(elevation, curr.x, curr.y);
      const elevDiff = currElev - prevElev;

      if (Math.abs(elevDiff) > maxGradient) {
        // Need to fix gradient
        if (random && random() < rampChance) {
          // Adjust current tile elevation
          const newElev = prevElev + Math.sign(elevDiff) * maxGradient;
          if (curr.y >= 0 && curr.y < elevation.length &&
              curr.x >= 0 && curr.x < elevation[0].length) {
            elevation[curr.y][curr.x] = newElev;
          }
        } else {
          // Mark for ramp/stair placement
          const direction = {
            dx: curr.x - prev.x,
            dy: curr.y - prev.y
          };
          rampPlacements.push({
            x: curr.x,
            y: curr.y,
            type: Math.abs(elevDiff) > 1 ? 'stairs' : 'ramp',
            direction,
            elevChange: elevDiff
          });
        }
      }
    }

    return rampPlacements;
  }

  /**
   * Score spawn position based on elevation
   * Higher ground gives tactical advantage
   * Called by SpawnPlacer for position scoring
   *
   * @param {number[][]} elevation - Elevation grid
   * @param {number} x - X position
   * @param {number} y - Y position
   * @param {Object} options - Scoring options
   * @param {boolean} options.preferHighGround - Prefer elevated positions
   * @param {number} options.elevationWeight - Points per elevation level
   * @returns {number} Position score
   */
  static scoreSpawnElevation(elevation, x, y, options = {}) {
    const preferHighGround = options.preferHighGround !== false;
    const elevationWeight = options.elevationWeight ?? 15;

    const level = ElevationMapper.getElevationAt(elevation, x, y);

    if (preferHighGround) {
      // Higher is better
      return level * elevationWeight;
    } else {
      // Middle ground preferred
      const idealLevel = ELEVATION_LEVELS.GROUND;
      const deviation = Math.abs(level - idealLevel);
      return Math.max(0, 30 - deviation * elevationWeight);
    }
  }

  /**
   * Get elevation context for a position
   * Useful for algorithm decisions
   *
   * @param {number[][]} elevation - Elevation grid
   * @param {number} x - X position
   * @param {number} y - Y position
   * @returns {Object} Elevation context
   */
  static getElevationContext(elevation, x, y) {
    const current = ElevationMapper.getElevationAt(elevation, x, y);

    // Get neighbor elevations
    const neighbors = {
      n: ElevationMapper.getElevationAt(elevation, x, y - 1),
      s: ElevationMapper.getElevationAt(elevation, x, y + 1),
      e: ElevationMapper.getElevationAt(elevation, x + 1, y),
      w: ElevationMapper.getElevationAt(elevation, x - 1, y)
    };

    // Calculate statistics
    const neighborValues = Object.values(neighbors).filter(v => v !== null);
    const avgNeighbor = neighborValues.length > 0
      ? neighborValues.reduce((a, b) => a + b, 0) / neighborValues.length
      : current;
    const maxNeighbor = Math.max(...neighborValues, current);
    const minNeighbor = Math.min(...neighborValues, current);

    return {
      current,
      neighbors,
      avgNeighbor,
      maxNeighbor,
      minNeighbor,
      isHighPoint: current >= maxNeighbor,
      isLowPoint: current <= minNeighbor,
      maxSlope: maxNeighbor - minNeighbor
    };
  }

  /**
   * Generate elevation early in pipeline
   * Can be called at start of generation to guide other algorithms
   *
   * @param {number} width - Map width
   * @param {number} height - Map height
   * @param {function} random - Seeded random function
   * @param {Object} options - Generation options
   * @returns {Object} { elevation, connections }
   */
  static generateEarly(width, height, random, options = {}) {
    const mapper = new ElevationMapper(options);
    return mapper.generateElevation(width, height, random, null);
  }
}

export default ElevationMapper;
