/**
 * CoverGridSystem - Tactical cover placement for battle maps
 *
 * Generates purposeful obstacle placement with:
 * - Lane-based layout (left, center, right advancement paths)
 * - Cover levels (low: +10% defense, high: +25% defense)
 * - Placement strategies (symmetric, staggered, defensive)
 * - Integration with obstacle placement system
 *
 * Cover grid values:
 * - 0: No cover
 * - 1: Low cover (half-height obstacles, +10% defense)
 * - 2: High cover (full-height obstacles, +25% defense)
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Cover level definitions
 */
export const COVER_LEVELS = {
  NONE: 0,
  LOW: 1,
  HIGH: 2
};

/**
 * Cover defense bonuses
 */
export const COVER_BONUSES = {
  [COVER_LEVELS.NONE]: 0,
  [COVER_LEVELS.LOW]: 0.10,   // +10% defense
  [COVER_LEVELS.HIGH]: 0.25  // +25% defense
};

/**
 * Default lane configuration
 */
export const DEFAULT_LANE_CONFIG = {
  count: 3,              // Number of lanes (left, center, right)
  bufferFromEdge: 3,     // Buffer from map edges
  laneOverlap: 2,        // Tiles where lanes overlap
  zones: ['entry', 'middle', 'exit'], // Zone names
  zoneRatios: [0.2, 0.6, 0.2]  // Relative size of each zone
};

/**
 * Cover placement strategies
 */
export const COVER_STRATEGIES = {
  /** Mirror cover across map center for competitive fairness */
  SYMMETRIC: 'symmetric',
  /** Alternating cover for advancement gameplay */
  STAGGERED: 'staggered',
  /** Heavier cover near spawns */
  DEFENSIVE: 'defensive',
  /** Evenly distributed sparse cover */
  SCATTERED: 'scattered',
  /** Cover concentrated at chokepoints */
  CHOKEPOINT: 'chokepoint',
  /** Cover around the perimeter */
  PERIMETER: 'perimeter'
};

// ============================================================================
// COVER GRID SYSTEM CLASS
// ============================================================================

/**
 * CoverGridSystem - Manages tactical cover placement
 */
export class CoverGridSystem {
  /**
   * Create a cover grid system
   *
   * @param {number} width - Map width
   * @param {number} height - Map height
   * @param {Object} options - Configuration options
   */
  constructor(width, height, options = {}) {
    this.width = width;
    this.height = height;
    this.laneConfig = { ...DEFAULT_LANE_CONFIG, ...options.laneConfig };

    // Cover grid: 0=none, 1=low, 2=high
    this.grid = this._createEmptyGrid();

    // Track placed cover positions
    this.coverPositions = [];

    // Lane boundaries
    this.lanes = this._calculateLanes();
  }

  /**
   * Create empty cover grid
   * @private
   */
  _createEmptyGrid() {
    const grid = [];
    for (let y = 0; y < this.height; y++) {
      grid.push(new Array(this.width).fill(COVER_LEVELS.NONE));
    }
    return grid;
  }

  /**
   * Calculate lane boundaries
   * @private
   */
  _calculateLanes() {
    const { count, bufferFromEdge, laneOverlap } = this.laneConfig;
    const usableHeight = this.height - (bufferFromEdge * 2);
    const laneHeight = Math.floor(usableHeight / count);
    const lanes = [];

    for (let i = 0; i < count; i++) {
      const yStart = bufferFromEdge + (i * laneHeight) - (i > 0 ? laneOverlap : 0);
      const yEnd = bufferFromEdge + ((i + 1) * laneHeight) + (i < count - 1 ? laneOverlap : 0);

      lanes.push({
        index: i,
        name: ['left', 'center', 'right'][i] || `lane_${i}`,
        yStart: Math.max(0, yStart),
        yEnd: Math.min(this.height - 1, yEnd),
        xStart: 5,  // After player spawn
        xEnd: this.width - 5  // Before enemy spawn
      });
    }

    return lanes;
  }

  /**
   * Generate cover grid using specified strategy
   *
   * @param {string} strategy - Cover placement strategy
   * @param {function} random - Seeded random function
   * @param {Object} options - Generation options
   * @returns {number[][]} Cover grid
   */
  generate(strategy, random, options = {}) {
    const density = options.density ?? 0.15;
    const minCover = options.minCover ?? 4;
    const maxCover = options.maxCover ?? 20;

    // Reset grid
    this.grid = this._createEmptyGrid();
    this.coverPositions = [];

    switch (strategy) {
      case COVER_STRATEGIES.SYMMETRIC:
        this._generateSymmetric(random, density, minCover, maxCover);
        break;
      case COVER_STRATEGIES.STAGGERED:
        this._generateStaggered(random, density, minCover, maxCover);
        break;
      case COVER_STRATEGIES.DEFENSIVE:
        this._generateDefensive(random, density, minCover, maxCover);
        break;
      case COVER_STRATEGIES.SCATTERED:
        this._generateScattered(random, density, minCover, maxCover);
        break;
      case COVER_STRATEGIES.CHOKEPOINT:
        this._generateChokepoint(random, density, minCover, maxCover);
        break;
      case COVER_STRATEGIES.PERIMETER:
        this._generatePerimeter(random, density, minCover, maxCover);
        break;
      default:
        this._generateScattered(random, density, minCover, maxCover);
    }

    return this.grid;
  }

  /**
   * Generate symmetric cover (mirrored across center)
   * @private
   */
  _generateSymmetric(random, density, minCover, maxCover) {
    const centerX = Math.floor(this.width / 2);
    const coverCount = Math.floor(minCover + random() * (maxCover - minCover));

    // Generate cover on left half, mirror to right
    const halfCount = Math.floor(coverCount / 2);

    for (let i = 0; i < halfCount; i++) {
      // Use Poisson-like distribution
      const pos = this._findCoverPosition(5, centerX - 2, random);
      if (!pos) continue;

      const level = random() < 0.4 ? COVER_LEVELS.HIGH : COVER_LEVELS.LOW;
      this._placeCover(pos.x, pos.y, level);

      // Mirror to right side
      const mirrorX = this.width - 1 - pos.x;
      if (mirrorX >= centerX + 2 && mirrorX < this.width - 5) {
        this._placeCover(mirrorX, pos.y, level);
      }
    }
  }

  /**
   * Generate staggered cover (alternating positions)
   * @private
   */
  _generateStaggered(random, density, minCover, maxCover) {
    const coverCount = Math.floor(minCover + random() * (maxCover - minCover));

    // Create staggered columns
    const columnSpacing = Math.floor((this.width - 10) / 5);

    for (let col = 0; col < 5; col++) {
      const x = 5 + (col * columnSpacing) + Math.floor(random() * 3);
      const offset = col % 2 === 0 ? 0 : Math.floor(this.height / 6);

      for (let i = 0; i < Math.floor(coverCount / 5); i++) {
        const y = this.laneConfig.bufferFromEdge + offset + (i * Math.floor(this.height / 4));
        if (y >= this.height - this.laneConfig.bufferFromEdge) continue;

        const level = random() < 0.35 ? COVER_LEVELS.HIGH : COVER_LEVELS.LOW;
        this._placeCover(x + Math.floor(random() * 2), y + Math.floor(random() * 2), level);
      }
    }
  }

  /**
   * Generate defensive cover (heavy near spawns)
   * @private
   */
  _generateDefensive(random, density, minCover, maxCover) {
    const coverCount = Math.floor(minCover + random() * (maxCover - minCover));

    // More cover near spawns
    const spawnZoneWidth = 8;

    // Player spawn area
    for (let i = 0; i < Math.floor(coverCount * 0.35); i++) {
      const pos = this._findCoverPosition(5, 5 + spawnZoneWidth, random);
      if (pos) {
        const level = random() < 0.5 ? COVER_LEVELS.HIGH : COVER_LEVELS.LOW;
        this._placeCover(pos.x, pos.y, level);
      }
    }

    // Enemy spawn area
    for (let i = 0; i < Math.floor(coverCount * 0.35); i++) {
      const pos = this._findCoverPosition(this.width - 5 - spawnZoneWidth, this.width - 5, random);
      if (pos) {
        const level = random() < 0.5 ? COVER_LEVELS.HIGH : COVER_LEVELS.LOW;
        this._placeCover(pos.x, pos.y, level);
      }
    }

    // Light cover in middle
    for (let i = 0; i < Math.floor(coverCount * 0.3); i++) {
      const pos = this._findCoverPosition(5 + spawnZoneWidth, this.width - 5 - spawnZoneWidth, random);
      if (pos) {
        const level = random() < 0.3 ? COVER_LEVELS.HIGH : COVER_LEVELS.LOW;
        this._placeCover(pos.x, pos.y, level);
      }
    }
  }

  /**
   * Generate scattered cover (even distribution)
   * @private
   */
  _generateScattered(random, density, minCover, maxCover) {
    const coverCount = Math.floor(minCover + random() * (maxCover - minCover));

    for (let i = 0; i < coverCount; i++) {
      const pos = this._findCoverPosition(5, this.width - 5, random);
      if (pos) {
        const level = random() < 0.35 ? COVER_LEVELS.HIGH : COVER_LEVELS.LOW;
        this._placeCover(pos.x, pos.y, level);
      }
    }
  }

  /**
   * Generate chokepoint cover
   * @private
   */
  _generateChokepoint(random, density, minCover, maxCover) {
    const coverCount = Math.floor(minCover + random() * (maxCover - minCover));
    const centerX = Math.floor(this.width / 2);

    // Create cover clusters at key positions
    const keyPositions = [
      { x: centerX - 6, y: Math.floor(this.height * 0.25) },
      { x: centerX + 6, y: Math.floor(this.height * 0.25) },
      { x: centerX, y: Math.floor(this.height * 0.5) },
      { x: centerX - 6, y: Math.floor(this.height * 0.75) },
      { x: centerX + 6, y: Math.floor(this.height * 0.75) }
    ];

    const coversPerPosition = Math.floor(coverCount / keyPositions.length);

    for (const keyPos of keyPositions) {
      for (let i = 0; i < coversPerPosition; i++) {
        const x = keyPos.x + Math.floor((random() - 0.5) * 4);
        const y = keyPos.y + Math.floor((random() - 0.5) * 4);

        if (x >= 5 && x < this.width - 5 && y >= 2 && y < this.height - 2) {
          const level = i === 0 ? COVER_LEVELS.HIGH : COVER_LEVELS.LOW;
          this._placeCover(x, y, level);
        }
      }
    }
  }

  /**
   * Generate perimeter cover
   * @private
   */
  _generatePerimeter(random, density, minCover, maxCover) {
    const coverCount = Math.floor(minCover + random() * (maxCover - minCover));
    const buffer = this.laneConfig.bufferFromEdge + 2;

    // Top edge
    for (let i = 0; i < Math.floor(coverCount * 0.25); i++) {
      const x = 5 + Math.floor(random() * (this.width - 10));
      const y = buffer + Math.floor(random() * 3);
      const level = random() < 0.4 ? COVER_LEVELS.HIGH : COVER_LEVELS.LOW;
      this._placeCover(x, y, level);
    }

    // Bottom edge
    for (let i = 0; i < Math.floor(coverCount * 0.25); i++) {
      const x = 5 + Math.floor(random() * (this.width - 10));
      const y = this.height - buffer - Math.floor(random() * 3);
      const level = random() < 0.4 ? COVER_LEVELS.HIGH : COVER_LEVELS.LOW;
      this._placeCover(x, y, level);
    }

    // Center sparse
    for (let i = 0; i < Math.floor(coverCount * 0.5); i++) {
      const pos = this._findCoverPosition(
        Math.floor(this.width * 0.3),
        Math.floor(this.width * 0.7),
        random
      );
      if (pos) {
        const level = random() < 0.3 ? COVER_LEVELS.HIGH : COVER_LEVELS.LOW;
        this._placeCover(pos.x, pos.y, level);
      }
    }
  }

  /**
   * Find a valid cover position using Poisson-like sampling
   * @private
   */
  _findCoverPosition(minX, maxX, random) {
    const minSpacing = 3;
    const maxAttempts = 30;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = minX + Math.floor(random() * (maxX - minX));
      const y = this.laneConfig.bufferFromEdge +
                Math.floor(random() * (this.height - this.laneConfig.bufferFromEdge * 2));

      // Check spacing from existing cover
      let valid = true;
      for (const pos of this.coverPositions) {
        const dist = Math.abs(x - pos.x) + Math.abs(y - pos.y);
        if (dist < minSpacing) {
          valid = false;
          break;
        }
      }

      if (valid) {
        return { x, y };
      }
    }

    return null;
  }

  /**
   * Place cover at position
   * @private
   */
  _placeCover(x, y, level) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;

    this.grid[y][x] = level;
    this.coverPositions.push({ x, y, level });
  }

  /**
   * Get cover level at position
   *
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {number} Cover level (0, 1, or 2)
   */
  getCoverAt(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return COVER_LEVELS.NONE;
    }
    return this.grid[y][x];
  }

  /**
   * Get defense bonus at position
   *
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {number} Defense bonus multiplier
   */
  getDefenseBonus(x, y) {
    const level = this.getCoverAt(x, y);
    return COVER_BONUSES[level] || 0;
  }

  /**
   * Get all cover positions
   *
   * @returns {Array<{x: number, y: number, level: number}>}
   */
  getCoverPositions() {
    return [...this.coverPositions];
  }

  /**
   * Map cover grid to obstacle types
   * Used by obstacle placement system
   *
   * @param {Object} mapping - Cover level to obstacle type mapping
   * @param {Function} random - Seeded random function for deterministic variant selection
   * @returns {Array<{x: number, y: number, type: string, variant: string}>}
   */
  mapToObstacles(mapping = {}, random = null) {
    const defaultMapping = {
      [COVER_LEVELS.LOW]: { type: 'rocks', variants: ['rock_small', 'rock_medium'] },
      [COVER_LEVELS.HIGH]: { type: 'rocks', variants: ['rock_large', 'mountain_boulder'] }
    };

    const finalMapping = { ...defaultMapping, ...mapping };
    const obstacles = [];

    // Use seeded random if provided, fall back to Math.random for backward compatibility
    const rng = random || Math.random;

    for (const pos of this.coverPositions) {
      const obstacleConfig = finalMapping[pos.level];
      if (obstacleConfig) {
        obstacles.push({
          x: pos.x,
          y: pos.y,
          type: obstacleConfig.type,
          variant: obstacleConfig.variants[
            Math.floor(rng() * obstacleConfig.variants.length)
          ],
          coverLevel: pos.level
        });
      }
    }

    return obstacles;
  }

  /**
   * Get lane at position
   *
   * @param {number} y - Y coordinate
   * @returns {Object|null} Lane object or null
   */
  getLaneAt(y) {
    for (const lane of this.lanes) {
      if (y >= lane.yStart && y <= lane.yEnd) {
        return lane;
      }
    }
    return null;
  }

  /**
   * Get statistics about cover distribution
   *
   * @returns {Object} Cover statistics
   */
  getStats() {
    let lowCount = 0;
    let highCount = 0;

    for (const pos of this.coverPositions) {
      if (pos.level === COVER_LEVELS.LOW) lowCount++;
      if (pos.level === COVER_LEVELS.HIGH) highCount++;
    }

    return {
      total: this.coverPositions.length,
      low: lowCount,
      high: highCount,
      density: this.coverPositions.length / (this.width * this.height),
      lanes: this.lanes.length
    };
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Create a cover grid for a map
 *
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {string} strategy - Cover strategy
 * @param {function} random - Seeded random function
 * @param {Object} options - Generation options
 * @returns {number[][]} Cover grid
 */
export function generateCoverGrid(width, height, strategy, random, options = {}) {
  const system = new CoverGridSystem(width, height, options);
  return system.generate(strategy, random, options);
}

export default CoverGridSystem;
