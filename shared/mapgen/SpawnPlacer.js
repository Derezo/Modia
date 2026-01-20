/**
 * SpawnPlacer - Tactical unit spawn positioning for battle maps
 *
 * Generates spawn positions for player units (west side) and enemy units (east side)
 * based on terrain, obstacles, and AI behavior patterns. Ensures all units have
 * valid walkable positions that support their tactical role.
 *
 * Player Spawning:
 * - West side of map (columns 1-4)
 * - 3x5 column formation for party of up to 15
 * - All positions guaranteed walkable
 * - Clears any obstacles in spawn area
 *
 * Enemy Spawning:
 * - East side of map with positioning based on AI type
 * - Tactical placement supports AI behavior patterns
 * - Respects terrain features (elevation, cover)
 *
 * CRITICAL: All methods must use the random function deterministically
 * to maintain server/client sync.
 */

import { isImpassable, getTerrainMovementCost } from '../terrain.js';

/**
 * AI type spawn configurations
 * Defines positioning strategy for each AI behavioral pattern
 */
export const AI_SPAWN_CONFIGS = {
  /**
   * Aggressive - Forward positioned, spread out to attack quickly
   */
  aggressive: {
    name: 'Aggressive',
    xRange: { min: 25, max: 30 },
    ySpread: 'wide',
    clusterSize: 0,
    preferElevation: false,
    preferCover: false,
    description: 'Forward positioning, spread formation'
  },

  /**
   * Defensive - Back line, near obstacles for cover, prefer high ground
   */
  defensive: {
    name: 'Defensive',
    xRange: { min: 28, max: 31 },
    ySpread: 'tight',
    clusterSize: 0,
    preferElevation: true,
    preferCover: true,
    description: 'Backline positioning with cover'
  },

  /**
   * Support - Behind other enemies, protected position
   */
  support: {
    name: 'Support',
    xRange: { min: 29, max: 31 },
    ySpread: 'tight',
    clusterSize: 0,
    preferElevation: false,
    preferCover: true,
    description: 'Protected backline position'
  },

  /**
   * Tactical - Mixed positioning based on unit role
   * Ranged on high ground, melee forward
   */
  tactical: {
    name: 'Tactical',
    xRange: { min: 25, max: 31 },
    ySpread: 'mixed',
    clusterSize: 0,
    preferElevation: true,
    preferCover: false,
    description: 'Role-based positioning'
  },

  /**
   * Pack - Tight cluster formation in clearings
   */
  pack: {
    name: 'Pack',
    xRange: { min: 26, max: 30 },
    ySpread: 'tight',
    clusterSize: 3,
    preferElevation: false,
    preferCover: false,
    description: 'Tight cluster formation'
  },

  /**
   * Ambush - Flanking positions, behind obstacles on edges
   */
  ambush: {
    name: 'Ambush',
    xRange: { min: 20, max: 30 },
    ySpread: 'flanking',
    clusterSize: 0,
    preferElevation: false,
    preferCover: true,
    description: 'Flanking positions behind cover'
  },

  /**
   * Berserker - Forward aggressive, no tactical consideration
   */
  berserker: {
    name: 'Berserker',
    xRange: { min: 24, max: 28 },
    ySpread: 'wide',
    clusterSize: 0,
    preferElevation: false,
    preferCover: false,
    description: 'Maximum forward positioning'
  },

  /**
   * Ranged - Backline with good sightlines, prefer elevation
   */
  ranged: {
    name: 'Ranged',
    xRange: { min: 28, max: 31 },
    ySpread: 'spread',
    clusterSize: 0,
    preferElevation: true,
    preferCover: false,
    description: 'Elevated backline with sightlines'
  },

  /**
   * Boss - Center-back with room to maneuver
   */
  boss: {
    name: 'Boss',
    xRange: { min: 27, max: 30 },
    ySpread: 'centered',
    clusterSize: 0,
    preferElevation: true,
    preferCover: false,
    description: 'Central commanding position'
  }
};

/**
 * Spawn quality weights for position scoring
 */
const QUALITY_WEIGHTS = {
  elevation: 15,      // Points per elevation level
  nearCover: 10,      // Points for adjacent obstacle
  distanceFromEdge: 5, // Points for not being at edge
  walkableTerrain: 20, // Points for low movement cost terrain
  sightlines: 8       // Points for clear attack angles
};

/**
 * SpawnPlacer - Generates tactical spawn positions for battle maps
 */
export class SpawnPlacer {
  /**
   * Create a new spawn placer
   * @param {Object} options - Configuration options
   * @param {number} options.mapWidth - Map width in tiles (default: 32)
   * @param {number} options.mapHeight - Map height in tiles (default: 32)
   * @param {number} options.playerSpawnColumns - Number of columns for player spawn (default: 4)
   * @param {number} options.minSpawnDistance - Minimum distance between spawns (default: 1)
   */
  constructor(options = {}) {
    this.mapWidth = options.mapWidth ?? 32;
    this.mapHeight = options.mapHeight ?? 32;
    this.playerSpawnColumns = options.playerSpawnColumns ?? 4;
    this.minSpawnDistance = options.minSpawnDistance ?? 1;
  }

  /**
   * Generate player spawn positions on west side of map
   * Uses a 3x5 column formation for up to 15 characters
   *
   * @param {string[][]} terrain - Terrain grid
   * @param {Object} options - Spawn options
   * @param {number} options.count - Number of spawn positions needed (default: 15)
   * @param {Object[][]} options.obstacles - Obstacle grid to modify (clears spawn area)
   * @returns {Array<{x: number, y: number, slot: number}>} Array of spawn positions
   */
  generatePlayerSpawns(terrain, options = {}) {
    const count = options.count ?? 15;
    const obstacles = options.obstacles ?? null;
    const spawns = [];
    const height = terrain.length;

    // Formation: 3 columns, 5 rows centered vertically
    const formationCols = 3;
    const formationRows = Math.ceil(count / formationCols);
    const startCol = 1; // Start at column 1 (leave column 0 as buffer)

    // Center the formation vertically
    const centerY = Math.floor(height / 2);
    const startY = centerY - Math.floor(formationRows / 2);

    let slot = 0;
    for (let row = 0; row < formationRows && slot < count; row++) {
      for (let col = 0; col < formationCols && slot < count; col++) {
        const x = startCol + col;
        const y = startY + row;

        // Validate position is within bounds
        if (y >= 0 && y < height && x >= 0 && x < this.playerSpawnColumns) {
          // Ensure terrain is walkable (it should be cleared, but verify)
          if (!isImpassable(terrain[y]?.[x])) {
            spawns.push({ x, y, slot });

            // Clear any obstacles if grid provided
            if (obstacles && obstacles[y]) {
              obstacles[y][x] = null;
            }
          }
          slot++;
        }
      }
    }

    return spawns;
  }

  /**
   * Generate enemy spawn positions based on AI type
   *
   * @param {string[][]} terrain - Terrain grid
   * @param {Object[][]} obstacles - Obstacle grid
   * @param {string} aiType - Enemy AI behavior type
   * @param {number} count - Number of enemies to spawn
   * @param {function} random - Seeded random function
   * @param {Object} options - Additional options
   * @param {number[][]} options.elevation - Optional elevation grid
   * @param {string[]} options.unitRoles - Optional array of unit roles for tactical positioning
   * @returns {Array<{x: number, y: number, role: string}>} Array of spawn positions
   */
  generateEnemySpawns(terrain, obstacles, aiType, count, random, options = {}) {
    const config = AI_SPAWN_CONFIGS[aiType] || AI_SPAWN_CONFIGS.aggressive;
    const elevation = options.elevation || null;
    const unitRoles = options.unitRoles || [];
    const height = terrain.length;
    const width = terrain[0]?.length || this.mapWidth;

    const spawns = [];
    const usedPositions = new Set();

    // Generate candidate positions based on AI type
    const candidates = this._generateCandidatePositions(
      terrain,
      obstacles,
      config,
      width,
      height,
      random
    );

    // Score each candidate position
    const scoredCandidates = candidates.map(pos => ({
      ...pos,
      score: this._scorePosition(pos, terrain, obstacles, elevation, config)
    }));

    // Sort by score (highest first)
    scoredCandidates.sort((a, b) => b.score - a.score);

    // Select positions based on spawn strategy
    for (let i = 0; i < count && scoredCandidates.length > 0; i++) {
      const role = unitRoles[i] || this._inferRole(i, count, aiType);
      const pos = this._selectPosition(
        scoredCandidates,
        usedPositions,
        config,
        role,
        random
      );

      if (pos) {
        spawns.push({ x: pos.x, y: pos.y, role });
        usedPositions.add(`${pos.x},${pos.y}`);
      }
    }

    // If we don't have enough spawns, fill with fallback positions
    while (spawns.length < count) {
      const fallback = this._getFallbackPosition(
        terrain,
        usedPositions,
        config,
        width,
        height,
        random
      );
      if (fallback) {
        spawns.push({ x: fallback.x, y: fallback.y, role: 'fallback' });
        usedPositions.add(`${fallback.x},${fallback.y}`);
      } else {
        break; // Cannot find any more valid positions
      }
    }

    return spawns;
  }

  /**
   * Generate candidate spawn positions based on AI configuration
   * @private
   */
  _generateCandidatePositions(terrain, obstacles, config, width, height, random) {
    const candidates = [];
    const { xRange, ySpread } = config;

    // Determine Y range based on spread type
    let yRanges;
    switch (ySpread) {
      case 'flanking':
        // Top and bottom edges
        yRanges = [
          { min: 2, max: 7 },
          { min: height - 8, max: height - 3 }
        ];
        break;
      case 'centered':
        // Center of map
        yRanges = [{ min: Math.floor(height * 0.3), max: Math.floor(height * 0.7) }];
        break;
      case 'tight':
        // Tight center band
        yRanges = [{ min: Math.floor(height * 0.35), max: Math.floor(height * 0.65) }];
        break;
      case 'wide':
      case 'spread':
      case 'mixed':
      default:
        // Full height with edge buffer
        yRanges = [{ min: 3, max: height - 4 }];
        break;
    }

    // Generate candidates in the allowed ranges
    for (const yRange of yRanges) {
      for (let x = xRange.min; x <= Math.min(xRange.max, width - 1); x++) {
        for (let y = yRange.min; y <= Math.min(yRange.max, height - 1); y++) {
          // Check if position is valid
          if (this._isValidSpawnPosition(x, y, terrain, obstacles)) {
            candidates.push({ x, y });
          }
        }
      }
    }

    // Shuffle candidates for randomness while maintaining determinism
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    return candidates;
  }

  /**
   * Check if a spawn position is valid
   * @private
   */
  _isValidSpawnPosition(x, y, terrain, obstacles) {
    // Check terrain bounds
    if (y < 0 || y >= terrain.length) return false;
    if (x < 0 || x >= terrain[0].length) return false;

    // Check terrain is walkable
    if (isImpassable(terrain[y][x])) return false;

    // Check no blocking obstacle
    if (obstacles && obstacles[y]?.[x]) {
      const obstacle = obstacles[y][x];
      // Trees and rocks are blocking
      if (obstacle.type === 'trees' || obstacle.type === 'rocks') {
        return false;
      }
    }

    return true;
  }

  /**
   * Score a position for spawn quality
   * @private
   */
  _scorePosition(pos, terrain, obstacles, elevation, config) {
    let score = 50; // Base score

    // Elevation bonus (if elevation data available and config prefers it)
    if (elevation && config.preferElevation) {
      const elev = elevation[pos.y]?.[pos.x] || 0;
      score += elev * QUALITY_WEIGHTS.elevation;
    }

    // Cover bonus (adjacent to obstacles)
    if (config.preferCover) {
      const hasCover = this._hasAdjacentCover(pos.x, pos.y, obstacles);
      if (hasCover) {
        score += QUALITY_WEIGHTS.nearCover;
      }
    }

    // Distance from edge bonus
    const edgeDist = Math.min(
      pos.y,
      terrain.length - 1 - pos.y,
      terrain[0].length - 1 - pos.x
    );
    score += Math.min(edgeDist, 5) * QUALITY_WEIGHTS.distanceFromEdge;

    // Terrain movement cost penalty (prefer low-cost terrain)
    const moveCost = getTerrainMovementCost(terrain[pos.y][pos.x]);
    if (moveCost <= 1) {
      score += QUALITY_WEIGHTS.walkableTerrain;
    } else if (moveCost <= 2) {
      score += QUALITY_WEIGHTS.walkableTerrain / 2;
    }

    // Sightline bonus (clear path west)
    const sightlines = this._countClearSightlines(pos.x, pos.y, terrain, obstacles);
    score += sightlines * QUALITY_WEIGHTS.sightlines;

    return score;
  }

  /**
   * Check if position has adjacent cover
   * @private
   */
  _hasAdjacentCover(x, y, obstacles) {
    if (!obstacles) return false;

    const directions = [
      [0, -1], [0, 1], [-1, 0], [1, 0]
    ];

    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      if (obstacles[ny]?.[nx]) {
        return true;
      }
    }

    return false;
  }

  /**
   * Count clear sightlines from position (simplified)
   * @private
   */
  _countClearSightlines(x, y, terrain, obstacles) {
    let clear = 0;

    // Check west direction (toward player spawn)
    for (let checkX = x - 1; checkX >= x - 5 && checkX >= 0; checkX--) {
      if (isImpassable(terrain[y]?.[checkX])) break;
      if (obstacles?.[y]?.[checkX]?.type === 'trees') break;
      if (obstacles?.[y]?.[checkX]?.type === 'rocks') break;
      clear++;
    }

    return Math.min(clear, 5);
  }

  /**
   * Select a position from candidates based on config and role
   * @private
   */
  _selectPosition(candidates, usedPositions, config, role, random) {
    // Filter out already used positions and positions too close to others
    const available = candidates.filter(pos => {
      const key = `${pos.x},${pos.y}`;
      if (usedPositions.has(key)) return false;

      // Check minimum distance from other spawns
      for (const usedKey of usedPositions) {
        const [ux, uy] = usedKey.split(',').map(Number);
        const dist = Math.abs(pos.x - ux) + Math.abs(pos.y - uy);
        if (dist < this.minSpawnDistance + 1) {
          return false;
        }
      }

      return true;
    });

    if (available.length === 0) return null;

    // For pack AI, prefer positions near existing spawns
    if (config.clusterSize > 0 && usedPositions.size > 0) {
      // Sort by proximity to existing spawns
      available.sort((a, b) => {
        const distA = this._minDistanceToSet(a, usedPositions);
        const distB = this._minDistanceToSet(b, usedPositions);
        return distA - distB;
      });
      // Take from top candidates with some randomness
      const topN = Math.min(3, available.length);
      const idx = Math.floor(random() * topN);
      return available[idx];
    }

    // For tactical AI with roles, adjust selection
    if (config.name === 'Tactical' && (role === 'ranged' || role === 'support')) {
      // Prefer higher x values (further back)
      available.sort((a, b) => b.x - a.x);
      const topN = Math.min(3, available.length);
      const idx = Math.floor(random() * topN);
      return available[idx];
    }

    // Default: select from top scored candidates with randomness
    const topN = Math.min(5, available.length);
    const idx = Math.floor(random() * topN);
    return available[idx];
  }

  /**
   * Calculate minimum Manhattan distance from position to a set of positions
   * @private
   */
  _minDistanceToSet(pos, positionSet) {
    let minDist = Infinity;
    for (const key of positionSet) {
      const [x, y] = key.split(',').map(Number);
      const dist = Math.abs(pos.x - x) + Math.abs(pos.y - y);
      if (dist < minDist) minDist = dist;
    }
    return minDist;
  }

  /**
   * Infer unit role based on position in spawn order
   * @private
   */
  _inferRole(index, total, aiType) {
    if (aiType === 'tactical') {
      // First half are frontline, second half are backline
      return index < total / 2 ? 'melee' : 'ranged';
    }
    if (aiType === 'support') {
      return 'support';
    }
    return 'standard';
  }

  /**
   * Get a fallback spawn position when candidates are exhausted
   * @private
   */
  _getFallbackPosition(terrain, usedPositions, config, width, height, random) {
    const maxAttempts = 100;
    const { xRange } = config;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = Math.floor(random() * (xRange.max - xRange.min + 1)) + xRange.min;
      const y = Math.floor(random() * (height - 6)) + 3; // Buffer from edges

      if (x >= width) continue;

      const key = `${x},${y}`;
      if (usedPositions.has(key)) continue;

      if (!isImpassable(terrain[y]?.[x])) {
        return { x, y };
      }
    }

    return null;
  }

  /**
   * Validate spawn positions are all walkable
   *
   * @param {Array<{x: number, y: number}>} spawns - Spawn positions to validate
   * @param {string[][]} terrain - Terrain grid
   * @param {Object[][]} obstacles - Obstacle grid
   * @returns {{valid: boolean, invalidPositions: Array}} Validation result
   */
  validateSpawns(spawns, terrain, obstacles) {
    const invalidPositions = [];

    for (const spawn of spawns) {
      if (!this._isValidSpawnPosition(spawn.x, spawn.y, terrain, obstacles)) {
        invalidPositions.push(spawn);
      }
    }

    return {
      valid: invalidPositions.length === 0,
      invalidPositions
    };
  }

  /**
   * Get spawn quality score for a position
   *
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {string[][]} terrain - Terrain grid
   * @param {number[][]} elevation - Optional elevation grid
   * @param {string} aiType - AI type for context
   * @returns {number} Quality score (0-100+)
   */
  getSpawnQuality(x, y, terrain, elevation, aiType) {
    const config = AI_SPAWN_CONFIGS[aiType] || AI_SPAWN_CONFIGS.aggressive;
    return this._scorePosition({ x, y }, terrain, null, elevation, config);
  }

  /**
   * Clear spawn area obstacles and ensure walkable terrain
   *
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {Object[][]} obstacles - Obstacle grid to modify
   * @param {string} side - 'player' or 'enemy'
   */
  clearSpawnArea(terrain, obstacles, side) {
    const height = terrain.length;
    const width = terrain[0]?.length || 32;

    let xStart, xEnd;
    if (side === 'player') {
      xStart = 0;
      xEnd = this.playerSpawnColumns;
    } else {
      xStart = width - 5;
      xEnd = width;
    }

    for (let y = 0; y < height; y++) {
      for (let x = xStart; x < xEnd; x++) {
        // Clear impassable terrain
        if (isImpassable(terrain[y]?.[x])) {
          terrain[y][x] = 'grass';
        }
        // Clear obstacles
        if (obstacles?.[y]) {
          obstacles[y][x] = null;
        }
      }
    }
  }
}

export default SpawnPlacer;
