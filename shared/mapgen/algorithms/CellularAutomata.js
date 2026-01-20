/**
 * CellularAutomata - Cave and organic shape generation
 *
 * Uses cellular automata rules (similar to Conway's Game of Life)
 * to generate organic, natural-looking cave systems and rooms.
 *
 * Common rule sets:
 * - B5678/S45678: Classic cave generation (walls become floors naturally)
 * - B678/S345678: More open spaces with some walls
 * - B6/S12345678: Island-like formations
 *
 * CRITICAL: All methods must use the random function deterministically
 * to maintain server/client sync.
 */

/**
 * Rule set presets for different generation styles
 */
export const RULE_PRESETS = {
  cave: {
    birth: [5, 6, 7, 8],    // Cell becomes wall if 5+ neighbors are walls
    survive: [4, 5, 6, 7, 8], // Wall survives if 4+ neighbors are walls
    initialFill: 0.45,        // 45% initial wall density
    iterations: 4             // Number of smoothing passes
  },
  crypt: {
    birth: [6, 7, 8],
    survive: [3, 4, 5, 6, 7, 8],
    initialFill: 0.40,
    iterations: 5
  },
  organic: {
    birth: [5, 6, 7, 8],
    survive: [5, 6, 7, 8],
    initialFill: 0.48,
    iterations: 3
  },
  sparse: {
    birth: [6, 7, 8],
    survive: [5, 6, 7, 8],
    initialFill: 0.35,
    iterations: 4
  }
};

/**
 * Cellular Automata Algorithm for cave/organic generation
 */
export class CellularAutomataAlgorithm {
  /**
   * @param {Object} options - Algorithm options
   * @param {number[]} options.birth - Neighbor counts that create new walls
   * @param {number[]} options.survive - Neighbor counts that keep walls alive
   * @param {number} options.initialFill - Initial random fill percentage (0-1)
   * @param {number} options.iterations - Number of CA iterations
   * @param {string} options.wallTerrain - Terrain type for walls
   * @param {string} options.floorTerrain - Terrain type for floors
   */
  constructor(options = {}) {
    const preset = RULE_PRESETS[options.preset] || RULE_PRESETS.cave;

    this.birth = new Set(options.birth || preset.birth);
    this.survive = new Set(options.survive || preset.survive);
    this.initialFill = options.initialFill ?? preset.initialFill;
    this.iterations = options.iterations ?? preset.iterations;
    this.wallTerrain = options.wallTerrain || 'rock';
    this.floorTerrain = options.floorTerrain || 'stone';
  }

  /**
   * Apply cellular automata to terrain
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {function} random - Seeded random function
   * @param {Object} options - Runtime options
   * @param {number} options.intensity - Effect intensity (0-1)
   * @param {Object} options.bounds - Optional bounded region {x, y, width, height}
   */
  apply(terrain, random, options = {}) {
    const intensity = options.intensity || 0.7;
    const bounds = options.bounds || {
      x: 0,
      y: 0,
      width: terrain[0].length,
      height: terrain.length
    };

    // Create binary grid (true = wall, false = floor)
    const grid = this._createInitialGrid(bounds.width, bounds.height, random);

    // Run CA iterations
    for (let i = 0; i < this.iterations; i++) {
      this._iterate(grid, bounds.width, bounds.height);
    }

    // Apply to terrain with intensity blending
    this._applyToTerrain(terrain, grid, bounds, random, intensity);
  }

  /**
   * Create initial random grid
   */
  _createInitialGrid(width, height, random) {
    const grid = [];
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        // Edges are always walls for containment
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
          row.push(true);
        } else {
          row.push(random() < this.initialFill);
        }
      }
      grid.push(row);
    }
    return grid;
  }

  /**
   * Run one CA iteration
   */
  _iterate(grid, width, height) {
    const newGrid = [];

    for (let y = 0; y < height; y++) {
      const newRow = [];
      for (let x = 0; x < width; x++) {
        // Count living (wall) neighbors
        const neighbors = this._countNeighbors(grid, x, y, width, height);
        const isWall = grid[y][x];

        // Apply rules
        let newState;
        if (isWall) {
          newState = this.survive.has(neighbors);
        } else {
          newState = this.birth.has(neighbors);
        }
        newRow.push(newState);
      }
      newGrid.push(newRow);
    }

    // Copy back to original grid
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        grid[y][x] = newGrid[y][x];
      }
    }
  }

  /**
   * Count neighboring walls (8-directional)
   */
  _countNeighbors(grid, x, y, width, height) {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;

        const nx = x + dx;
        const ny = y + dy;

        // Out of bounds counts as wall
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          count++;
        } else if (grid[ny][nx]) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Apply CA result to terrain grid
   */
  _applyToTerrain(terrain, grid, bounds, random, intensity) {
    for (let y = 0; y < bounds.height; y++) {
      for (let x = 0; x < bounds.width; x++) {
        const tx = bounds.x + x;
        const ty = bounds.y + y;

        // Skip if outside terrain bounds
        if (ty >= terrain.length || tx >= terrain[0].length) continue;

        // Apply with intensity probability
        if (random() < intensity) {
          terrain[ty][tx] = grid[y][x] ? this.wallTerrain : this.floorTerrain;
        }
      }
    }
  }

  /**
   * Generate standalone CA map (for region analysis)
   * @param {number} width - Map width
   * @param {number} height - Map height
   * @param {function} random - Seeded random function
   * @returns {boolean[][]} Binary grid (true = wall)
   */
  generateGrid(width, height, random) {
    const grid = this._createInitialGrid(width, height, random);

    for (let i = 0; i < this.iterations; i++) {
      this._iterate(grid, width, height);
    }

    return grid;
  }

  /**
   * Find connected regions (flood fill) in a CA grid
   * Useful for ensuring cave connectivity or finding rooms
   * @param {boolean[][]} grid - Binary grid
   * @returns {Array} Array of regions, each containing { cells: [{x,y}], size }
   */
  findRegions(grid) {
    const height = grid.length;
    const width = grid[0].length;
    const visited = new Set();
    const regions = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const key = `${x},${y}`;
        if (visited.has(key) || grid[y][x]) continue; // Skip walls and visited

        // Flood fill to find region
        const region = { cells: [], size: 0 };
        const queue = [{ x, y }];
        visited.add(key);

        while (queue.length > 0) {
          const cell = queue.shift();
          region.cells.push(cell);
          region.size++;

          // Check 4-directional neighbors
          const neighbors = [
            { x: cell.x - 1, y: cell.y },
            { x: cell.x + 1, y: cell.y },
            { x: cell.x, y: cell.y - 1 },
            { x: cell.x, y: cell.y + 1 }
          ];

          for (const n of neighbors) {
            const nkey = `${n.x},${n.y}`;
            if (n.x < 0 || n.y < 0 || n.x >= width || n.y >= height) continue;
            if (visited.has(nkey) || grid[n.y][n.x]) continue;

            visited.add(nkey);
            queue.push(n);
          }
        }

        regions.push(region);
      }
    }

    // Sort by size (largest first)
    regions.sort((a, b) => b.size - a.size);
    return regions;
  }

  /**
   * Connect disconnected regions by carving tunnels
   * @param {boolean[][]} grid - Binary grid to modify
   * @param {Array} regions - Regions from findRegions()
   * @param {function} random - Seeded random for tunnel variation
   */
  connectRegions(grid, regions, random) {
    if (regions.length <= 1) return;

    // Connect each region to the largest (main) region
    const mainRegion = regions[0];

    for (let i = 1; i < regions.length; i++) {
      const region = regions[i];

      // Find closest cells between regions
      let closest = { dist: Infinity, from: null, to: null };

      for (const cell of region.cells) {
        for (const mainCell of mainRegion.cells) {
          const dist = Math.abs(cell.x - mainCell.x) + Math.abs(cell.y - mainCell.y);
          if (dist < closest.dist) {
            closest = { dist, from: cell, to: mainCell };
          }
        }
      }

      // Carve tunnel between closest points
      if (closest.from && closest.to) {
        this._carveTunnel(grid, closest.from, closest.to, random);
        // Add connected cells to main region for next iteration
        mainRegion.cells.push(...region.cells);
      }
    }
  }

  /**
   * Carve a tunnel between two points
   */
  _carveTunnel(grid, from, to, random) {
    let x = from.x;
    let y = from.y;

    while (x !== to.x || y !== to.y) {
      grid[y][x] = false; // Clear wall

      // Random preference for horizontal or vertical
      if (x !== to.x && (y === to.y || random() < 0.5)) {
        x += x < to.x ? 1 : -1;
      } else if (y !== to.y) {
        y += y < to.y ? 1 : -1;
      }
    }
    grid[to.y][to.x] = false;
  }

  /**
   * Apply cellular automata only within seed regions
   *
   * This method enables Perlin+CA cooperation: Perlin defines large-scale
   * structure and marks transition zones, CA then smooths only those zones.
   *
   * @param {string[][]} terrain - Terrain grid to modify
   * @param {function} random - Seeded random function
   * @param {Object} options - Runtime options
   * @param {number} options.intensity - Effect intensity (0-1)
   * @param {Set<string>} options.seedRegions - Set of "x,y" coords to operate on
   * @param {Object} options.context - LayerContext with seed regions
   * @param {boolean} options.smoothBoundaries - Blend edges with surrounding terrain
   */
  applyToSeedRegions(terrain, random, options = {}) {
    const intensity = options.intensity || 0.7;
    const context = options.context || null;
    const smoothBoundaries = options.smoothBoundaries !== false;

    // Get seed regions from options or context
    let seedRegions = options.seedRegions;
    if (!seedRegions && context) {
      seedRegions = context.seedRegions;
    }

    // If no seed regions, fall back to full apply
    if (!seedRegions || seedRegions.size === 0) {
      return this.apply(terrain, random, options);
    }

    const bounds = options.bounds || {
      x: 0,
      y: 0,
      width: terrain[0].length,
      height: terrain.length
    };

    // Create binary grid (true = wall, false = floor) for seed regions only
    const grid = this._createGridFromSeedRegions(
      terrain,
      seedRegions,
      bounds.width,
      bounds.height
    );

    // Run CA iterations only on seed region tiles
    for (let i = 0; i < this.iterations; i++) {
      this._iterateSeedRegionsOnly(grid, seedRegions, bounds.width, bounds.height);
    }

    // Apply results back to terrain
    this._applyToTerrainSeedRegions(terrain, grid, bounds, seedRegions, random, intensity);

    // Smooth boundaries between CA-processed and original terrain
    if (smoothBoundaries) {
      this._smoothBoundaries(terrain, seedRegions, bounds, random);
    }
  }

  /**
   * Create binary grid from terrain, marking only seed regions
   * @private
   */
  _createGridFromSeedRegions(terrain, seedRegions, width, height) {
    const grid = [];

    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        const key = `${x},${y}`;
        if (!seedRegions.has(key)) {
          // Not in seed region - preserve terrain state as fixed
          // Mark as wall if impassable, floor otherwise
          const isWall = this._isWallTerrain(terrain[y]?.[x]);
          row.push(isWall);
        } else {
          // In seed region - start with random based on existing terrain
          const isWall = this._isWallTerrain(terrain[y]?.[x]);
          row.push(isWall);
        }
      }
      grid.push(row);
    }

    return grid;
  }

  /**
   * Check if terrain type should be treated as a wall
   * @private
   */
  _isWallTerrain(terrain) {
    return terrain === 'rock' || terrain === 'cliff' || terrain === this.wallTerrain;
  }

  /**
   * Run CA iteration only on seed region tiles
   * @private
   */
  _iterateSeedRegionsOnly(grid, seedRegions, width, height) {
    const changes = [];

    // Calculate new states for seed region tiles only
    for (const key of seedRegions) {
      const [x, y] = key.split(',').map(Number);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;

      // Count living (wall) neighbors
      const neighbors = this._countNeighbors(grid, x, y, width, height);
      const isWall = grid[y][x];

      // Apply rules
      let newState;
      if (isWall) {
        newState = this.survive.has(neighbors);
      } else {
        newState = this.birth.has(neighbors);
      }

      // Record change if different
      if (newState !== isWall) {
        changes.push({ x, y, newState });
      }
    }

    // Apply changes
    for (const change of changes) {
      grid[change.y][change.x] = change.newState;
    }
  }

  /**
   * Apply CA results to terrain for seed regions only
   * @private
   */
  _applyToTerrainSeedRegions(terrain, grid, bounds, seedRegions, random, intensity) {
    for (const key of seedRegions) {
      const [x, y] = key.split(',').map(Number);
      const tx = bounds.x + x;
      const ty = bounds.y + y;

      // Skip if outside terrain bounds
      if (ty >= terrain.length || tx >= terrain[0].length) continue;
      if (ty < 0 || tx < 0) continue;

      // Apply with intensity probability
      if (random() < intensity) {
        terrain[ty][tx] = grid[y][x] ? this.wallTerrain : this.floorTerrain;
      }
    }
  }

  /**
   * Smooth boundaries between CA-processed and original areas
   * Provides visual blending at the edges of seed regions
   * @private
   */
  _smoothBoundaries(terrain, seedRegions, bounds, random) {
    const boundaryBlendChance = 0.5;

    for (const key of seedRegions) {
      const [x, y] = key.split(',').map(Number);
      const tx = bounds.x + x;
      const ty = bounds.y + y;

      if (ty >= terrain.length || tx >= terrain[0].length) continue;
      if (ty < 0 || tx < 0) continue;

      // Check if this is a boundary tile (adjacent to non-seed tile)
      const neighbors = [
        `${x-1},${y}`, `${x+1},${y}`,
        `${x},${y-1}`, `${x},${y+1}`
      ];

      const isBoundary = neighbors.some(nkey => !seedRegions.has(nkey));

      if (isBoundary && random() < boundaryBlendChance) {
        // Get neighboring terrain that isn't in seed region
        const adjacentTerrains = [];
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          const ntx = bounds.x + nx;
          const nty = bounds.y + ny;
          const nkey = `${nx},${ny}`;

          if (!seedRegions.has(nkey) &&
              nty >= 0 && nty < terrain.length &&
              ntx >= 0 && ntx < terrain[0].length) {
            adjacentTerrains.push(terrain[nty][ntx]);
          }
        }

        // Blend with adjacent terrain occasionally
        if (adjacentTerrains.length > 0 && random() < 0.3) {
          const blendTerrain = adjacentTerrains[Math.floor(random() * adjacentTerrains.length)];
          terrain[ty][tx] = blendTerrain;
        }
      }
    }
  }
}

export default CellularAutomataAlgorithm;
