/**
 * ClusterPlacer - Clustered feature placement for battle maps
 *
 * Places clustered features like tree groves, rock formations, and water pools
 * on battle maps using random walk and Gaussian distribution for natural-looking
 * organic shapes.
 *
 * Features:
 * - Configurable cluster count, size, and spread
 * - Spawn area avoidance (columns 0-5 and 27-31)
 * - Edge avoidance for natural placement
 * - Multiple preset configurations for common feature types
 *
 * CRITICAL: All methods must use the random function deterministically
 * to maintain server/client sync.
 */

/**
 * Preset configurations for common cluster types
 */
export const CLUSTER_PRESETS = {
  treeGrove: {
    featureTerrain: 'tree',
    clusterSize: 6,
    clusterSpread: 2,
    clusterCount: 3
  },
  rockFormation: {
    featureTerrain: 'rock',
    clusterSize: 4,
    clusterSpread: 1,
    clusterCount: 3
  },
  waterPool: {
    featureTerrain: 'water',
    clusterSize: 5,
    clusterSpread: 2,
    clusterCount: 2
  },
  lavaPool: {
    featureTerrain: 'lava',
    clusterSize: 4,
    clusterSpread: 2,
    clusterCount: 2
  },
  denseForest: {
    featureTerrain: 'tree',
    clusterSize: 8,
    clusterSpread: 3,
    clusterCount: 4
  },
  scatteredRocks: {
    featureTerrain: 'rock',
    clusterSize: 3,
    clusterSpread: 1,
    clusterCount: 5
  }
};

/**
 * Cluster shape modes for different visual styles
 */
export const CLUSTER_SHAPES = {
  RANDOM_WALK: 'randomWalk',      // Organic, irregular shapes
  GAUSSIAN: 'gaussian',            // More circular, centered
  ELONGATED: 'elongated'           // Stretched in one direction (for paths)
};

/**
 * Cluster Placer Algorithm for feature grouping
 */
export class ClusterPlacerAlgorithm {
  /**
   * @param {Object} options - Algorithm options
   * @param {number} options.clusterCount - Number of clusters to place (default: 3)
   * @param {number} options.clusterSize - Average tiles per cluster (default: 5)
   * @param {number} options.clusterSpread - How spread out cluster tiles are (default: 3)
   * @param {string} options.featureTerrain - Terrain type to place (default: 'tree')
   * @param {number} options.avoidEdges - Minimum distance from map edges (default: 5)
   * @param {boolean} options.avoidSpawns - Keep clusters away from spawn areas (default: true)
   * @param {string} options.shape - Cluster shape mode (default: 'randomWalk')
   * @param {string} options.preset - Use a preset configuration by name
   */
  constructor(options = {}) {
    // Apply preset if specified
    const preset = options.preset ? CLUSTER_PRESETS[options.preset] : {};

    this.clusterCount = options.clusterCount ?? preset.clusterCount ?? 3;
    this.clusterSize = options.clusterSize ?? preset.clusterSize ?? 5;
    this.clusterSpread = options.clusterSpread ?? preset.clusterSpread ?? 3;
    this.featureTerrain = options.featureTerrain ?? preset.featureTerrain ?? 'tree';
    this.avoidEdges = options.avoidEdges ?? 5;
    this.avoidSpawns = options.avoidSpawns ?? true;
    this.shape = options.shape ?? CLUSTER_SHAPES.RANDOM_WALK;

    // Spawn areas (standard battle map spawn columns)
    this.leftSpawnEnd = 5;    // Columns 0-5 are left spawn
    this.rightSpawnStart = 27; // Columns 27-31 are right spawn
  }

  /**
   * Apply cluster placement to terrain
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {function} random - Seeded random function returning 0-1
   * @param {Object} options - Runtime options
   * @param {number} options.intensity - Effect intensity 0-1 (scales cluster count and size)
   * @param {Object} options.bounds - Optional region constraint {x, y, width, height}
   * @param {string[]} options.avoidTerrain - Array of terrain types to not overwrite
   */
  apply(terrain, random, options = {}) {
    const intensity = options.intensity ?? 1.0;
    const bounds = options.bounds || {
      x: 0,
      y: 0,
      width: terrain[0].length,
      height: terrain.length
    };
    const avoidTerrain = options.avoidTerrain || [];

    // Scale cluster count and size by intensity
    const scaledCount = Math.max(1, Math.round(this.clusterCount * intensity));
    const scaledSize = Math.max(2, Math.round(this.clusterSize * intensity));

    // Track placed tiles to avoid overlap
    const placedTiles = new Set();

    // Place each cluster
    for (let i = 0; i < scaledCount; i++) {
      const center = this._findClusterCenter(terrain, random, bounds, placedTiles);
      if (!center) continue; // Could not find valid center

      const clusterTiles = this._getClusterTiles(
        center,
        scaledSize,
        this.clusterSpread,
        random
      );

      // Apply cluster tiles to terrain
      for (const tile of clusterTiles) {
        if (this._isValidPosition(tile.x, tile.y, terrain, bounds, avoidTerrain)) {
          terrain[tile.y][tile.x] = this.featureTerrain;
          placedTiles.add(`${tile.x},${tile.y}`);
        }
      }
    }
  }

  /**
   * Find a valid cluster center position
   * @param {string[][]} terrain - Terrain grid
   * @param {function} random - Seeded random function
   * @param {Object} bounds - Region bounds
   * @param {Set} placedTiles - Already placed tile positions
   * @returns {{x: number, y: number}|null} Center position or null if none found
   */
  _findClusterCenter(terrain, random, bounds, placedTiles) {
    const maxAttempts = 50;

    // Calculate valid range for center placement
    const minX = bounds.x + this.avoidEdges;
    const maxX = bounds.x + bounds.width - this.avoidEdges - 1;
    const minY = bounds.y + this.avoidEdges;
    const maxY = bounds.y + bounds.height - this.avoidEdges - 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Random position within valid range
      const x = Math.floor(random() * (maxX - minX + 1)) + minX;
      const y = Math.floor(random() * (maxY - minY + 1)) + minY;

      // Check spawn area avoidance
      if (this.avoidSpawns) {
        if (x <= this.leftSpawnEnd || x >= this.rightSpawnStart) {
          continue;
        }
      }

      // Check if too close to existing clusters
      let tooClose = false;
      for (const key of placedTiles) {
        const [px, py] = key.split(',').map(Number);
        const dist = Math.abs(x - px) + Math.abs(y - py);
        if (dist < this.clusterSpread * 2) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        return { x, y };
      }
    }

    return null; // Could not find valid position
  }

  /**
   * Generate cluster tile positions from center
   * @param {{x: number, y: number}} center - Cluster center position
   * @param {number} size - Number of tiles in cluster
   * @param {number} spread - How spread out tiles should be
   * @param {function} random - Seeded random function
   * @returns {Array<{x: number, y: number}>} Array of tile positions
   */
  _getClusterTiles(center, size, spread, random) {
    switch (this.shape) {
      case CLUSTER_SHAPES.GAUSSIAN:
        return this._gaussianCluster(center, size, spread, random);
      case CLUSTER_SHAPES.ELONGATED:
        return this._elongatedCluster(center, size, spread, random);
      case CLUSTER_SHAPES.RANDOM_WALK:
      default:
        return this._randomWalkCluster(center, size, spread, random);
    }
  }

  /**
   * Generate cluster using random walk from center
   * Creates organic, irregular shapes
   * @param {{x: number, y: number}} center - Cluster center
   * @param {number} size - Target number of tiles
   * @param {number} spread - Walk distance multiplier
   * @param {function} random - Seeded random function
   * @returns {Array<{x: number, y: number}>} Tile positions
   */
  _randomWalkCluster(center, size, spread, random) {
    const tiles = [{ x: center.x, y: center.y }];
    const visited = new Set([`${center.x},${center.y}`]);

    // Directional offsets (4-way movement)
    const directions = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 }
    ];

    let current = { ...center };
    let attempts = 0;
    const maxAttempts = size * 10;

    while (tiles.length < size && attempts < maxAttempts) {
      attempts++;

      // Random walk step
      const dir = directions[Math.floor(random() * directions.length)];
      const next = {
        x: current.x + dir.x,
        y: current.y + dir.y
      };

      // Check if within spread distance from center
      const distFromCenter = Math.abs(next.x - center.x) + Math.abs(next.y - center.y);
      if (distFromCenter > spread * 2) {
        // Too far, reset to center
        current = { ...center };
        continue;
      }

      const key = `${next.x},${next.y}`;
      if (!visited.has(key)) {
        tiles.push({ x: next.x, y: next.y });
        visited.add(key);
      }

      current = next;
    }

    return tiles;
  }

  /**
   * Generate cluster using Gaussian distribution
   * Creates more circular, centered shapes
   * @param {{x: number, y: number}} center - Cluster center
   * @param {number} size - Target number of tiles
   * @param {number} spread - Standard deviation
   * @param {function} random - Seeded random function
   * @returns {Array<{x: number, y: number}>} Tile positions
   */
  _gaussianCluster(center, size, spread, random) {
    const tiles = [];
    const visited = new Set();

    let attempts = 0;
    const maxAttempts = size * 15;

    while (tiles.length < size && attempts < maxAttempts) {
      attempts++;

      // Box-Muller transform for Gaussian distribution
      const u1 = random();
      const u2 = random();
      const mag = spread * Math.sqrt(-2 * Math.log(u1 || 0.0001));
      const angle = 2 * Math.PI * u2;

      const offsetX = Math.round(mag * Math.cos(angle));
      const offsetY = Math.round(mag * Math.sin(angle));

      const x = center.x + offsetX;
      const y = center.y + offsetY;
      const key = `${x},${y}`;

      if (!visited.has(key)) {
        tiles.push({ x, y });
        visited.add(key);
      }
    }

    return tiles;
  }

  /**
   * Generate elongated cluster (for paths of trees, etc.)
   * Creates stretched shapes in a random direction
   * @param {{x: number, y: number}} center - Cluster center
   * @param {number} size - Target number of tiles
   * @param {number} spread - Width of the elongation
   * @param {function} random - Seeded random function
   * @returns {Array<{x: number, y: number}>} Tile positions
   */
  _elongatedCluster(center, size, spread, random) {
    const tiles = [];
    const visited = new Set();

    // Random direction angle for elongation
    const angle = random() * Math.PI;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    // Perpendicular direction for width
    const perpX = -dirY;
    const perpY = dirX;

    let attempts = 0;
    const maxAttempts = size * 15;

    while (tiles.length < size && attempts < maxAttempts) {
      attempts++;

      // Position along main axis (Gaussian for natural tapering)
      const u1 = random();
      const u2 = random();
      const alongDist = spread * 1.5 * Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);

      // Position perpendicular (narrower Gaussian)
      const u3 = random();
      const u4 = random();
      const acrossDist = (spread * 0.5) * Math.sqrt(-2 * Math.log(u3 || 0.0001)) * Math.cos(2 * Math.PI * u4);

      const x = Math.round(center.x + alongDist * dirX + acrossDist * perpX);
      const y = Math.round(center.y + alongDist * dirY + acrossDist * perpY);
      const key = `${x},${y}`;

      if (!visited.has(key)) {
        tiles.push({ x, y });
        visited.add(key);
      }
    }

    return tiles;
  }

  /**
   * Check if a position is valid for placing a feature
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {string[][]} terrain - Terrain grid
   * @param {Object} bounds - Region bounds
   * @param {string[]} avoidTerrain - Terrain types to not overwrite
   * @returns {boolean} True if position is valid
   */
  _isValidPosition(x, y, terrain, bounds, avoidTerrain) {
    // Check bounds
    if (y < bounds.y || y >= bounds.y + bounds.height) return false;
    if (x < bounds.x || x >= bounds.x + bounds.width) return false;

    // Check terrain grid bounds
    if (y < 0 || y >= terrain.length) return false;
    if (x < 0 || x >= terrain[0].length) return false;

    // Check edge avoidance
    if (x < this.avoidEdges || x >= terrain[0].length - this.avoidEdges) return false;
    if (y < this.avoidEdges || y >= terrain.length - this.avoidEdges) return false;

    // Check spawn area avoidance
    if (this.avoidSpawns) {
      if (x <= this.leftSpawnEnd || x >= this.rightSpawnStart) return false;
    }

    // Check terrain to avoid
    const currentTerrain = terrain[y][x];
    if (avoidTerrain.includes(currentTerrain)) return false;

    return true;
  }

  /**
   * Grow cluster outward from center using flood-fill expansion
   * Alternative method for controlled cluster growth
   * @param {string[][]} terrain - Terrain grid
   * @param {{x: number, y: number}} center - Cluster center
   * @param {number} size - Target cluster size
   * @param {function} random - Seeded random function
   * @returns {Array<{x: number, y: number}>} Array of tile positions
   */
  _growCluster(terrain, center, size, random) {
    const tiles = [center];
    const visited = new Set([`${center.x},${center.y}`]);
    const frontier = [center];

    // Directional offsets (8-way for smoother growth)
    const directions = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: -1 }
    ];

    while (tiles.length < size && frontier.length > 0) {
      // Pick random frontier cell
      const idx = Math.floor(random() * frontier.length);
      const current = frontier[idx];

      // Shuffle directions for variety
      const shuffled = [...directions];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      let expanded = false;
      for (const dir of shuffled) {
        const nx = current.x + dir.x;
        const ny = current.y + dir.y;
        const key = `${nx},${ny}`;

        if (!visited.has(key) && ny >= 0 && ny < terrain.length && nx >= 0 && nx < terrain[0].length) {
          visited.add(key);

          // Probability decreases with distance from center
          const dist = Math.abs(nx - center.x) + Math.abs(ny - center.y);
          const maxDist = this.clusterSpread * 2;
          const prob = 1 - (dist / maxDist) * 0.5;

          if (random() < prob) {
            tiles.push({ x: nx, y: ny });
            frontier.push({ x: nx, y: ny });
            expanded = true;

            if (tiles.length >= size) break;
          }
        }
      }

      // Remove from frontier if no expansion possible
      if (!expanded) {
        frontier.splice(idx, 1);
      }
    }

    return tiles;
  }
}

export default ClusterPlacerAlgorithm;
