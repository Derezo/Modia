/**
 * ConstraintValidator - Validates and repairs map generation output
 *
 * Replaces the simple BFS connectivity check with comprehensive validation:
 * - Walkable ratio within bounds
 * - POI reachability from both spawns
 * - Dead-end limits
 * - Multiple approach paths
 * - Minimum passable width
 *
 * When constraints are violated, targeted repairs are attempted:
 * - Connect disconnected components
 * - Carve shortcuts to reduce path length
 * - Fill dead-ends
 * - Widen bottlenecks
 */

import { isImpassable } from '../terrain.js';

// ============================================================================
// CONSTRAINT VIOLATION TYPES
// ============================================================================

/**
 * Types of constraint violations
 */
export const VIOLATION_TYPES = {
  WALKABLE_TOO_LOW: 'walkableTooLow',
  WALKABLE_TOO_HIGH: 'walkableTooHigh',
  POI_UNREACHABLE: 'poiUnreachable',
  TOO_MANY_DEAD_ENDS: 'tooManyDeadEnds',
  INSUFFICIENT_PATHS: 'insufficientPaths',
  PATH_TOO_LONG: 'pathTooLong',
  BOTTLENECK_TOO_NARROW: 'bottleneckTooNarrow',
  DISCONNECTED_REGIONS: 'disconnectedRegions'
};

// ============================================================================
// CONSTRAINT VALIDATOR CLASS
// ============================================================================

/**
 * ConstraintValidator - Validates map against archetype constraints
 */
export class ConstraintValidator {
  /**
   * Create a constraint validator
   *
   * @param {Object} constraints - Constraint configuration from archetype
   */
  constructor(constraints = {}) {
    this.constraints = {
      minWalkableRatio: constraints.minWalkableRatio ?? 0.45,
      maxWalkableRatio: constraints.maxWalkableRatio ?? 0.85,
      poiReachability: constraints.poiReachability !== false,
      maxDeadEnds: constraints.maxDeadEnds ?? 5,
      minApproachPaths: constraints.minApproachPaths ?? 2,
      maxPathLengthRatio: constraints.maxPathLengthRatio ?? 2.5,
      minPassableWidth: constraints.minPassableWidth ?? 2,
      maxRepairIterations: constraints.maxRepairIterations ?? 5
    };
  }

  /**
   * Validate terrain against constraints
   *
   * @param {string[][]} terrain - Terrain grid
   * @param {Object[][]} obstacles - Obstacles grid
   * @param {number} width - Map width
   * @param {number} height - Map height
   * @returns {Object} Validation result { valid, violations, metrics }
   */
  validate(terrain, obstacles, width, height) {
    const metrics = this._calculateMetrics(terrain, obstacles, width, height);
    const violations = [];

    // Check walkable ratio
    if (metrics.walkableRatio < this.constraints.minWalkableRatio) {
      violations.push({
        type: VIOLATION_TYPES.WALKABLE_TOO_LOW,
        expected: this.constraints.minWalkableRatio,
        actual: metrics.walkableRatio,
        severity: 'high'
      });
    }

    if (metrics.walkableRatio > this.constraints.maxWalkableRatio) {
      violations.push({
        type: VIOLATION_TYPES.WALKABLE_TOO_HIGH,
        expected: this.constraints.maxWalkableRatio,
        actual: metrics.walkableRatio,
        severity: 'low'
      });
    }

    // Check connectivity
    if (metrics.componentCount > 1) {
      violations.push({
        type: VIOLATION_TYPES.DISCONNECTED_REGIONS,
        expected: 1,
        actual: metrics.componentCount,
        severity: 'critical'
      });
    }

    // Check spawn-to-spawn connectivity
    if (!metrics.spawnsConnected) {
      violations.push({
        type: VIOLATION_TYPES.POI_UNREACHABLE,
        details: 'Spawns not connected',
        severity: 'critical'
      });
    }

    // Check dead ends
    if (metrics.deadEndCount > this.constraints.maxDeadEnds) {
      violations.push({
        type: VIOLATION_TYPES.TOO_MANY_DEAD_ENDS,
        expected: this.constraints.maxDeadEnds,
        actual: metrics.deadEndCount,
        severity: 'medium'
      });
    }

    // Check path length ratio
    if (metrics.pathLengthRatio > this.constraints.maxPathLengthRatio) {
      violations.push({
        type: VIOLATION_TYPES.PATH_TOO_LONG,
        expected: this.constraints.maxPathLengthRatio,
        actual: metrics.pathLengthRatio,
        severity: 'medium'
      });
    }

    // Check approach paths
    if (metrics.approachPathCount < this.constraints.minApproachPaths) {
      violations.push({
        type: VIOLATION_TYPES.INSUFFICIENT_PATHS,
        expected: this.constraints.minApproachPaths,
        actual: metrics.approachPathCount,
        severity: 'medium'
      });
    }

    // Check bottlenecks
    if (metrics.minPassageWidth < this.constraints.minPassableWidth) {
      violations.push({
        type: VIOLATION_TYPES.BOTTLENECK_TOO_NARROW,
        expected: this.constraints.minPassableWidth,
        actual: metrics.minPassageWidth,
        severity: 'medium'
      });
    }

    return {
      valid: violations.length === 0,
      violations,
      metrics
    };
  }

  /**
   * Validate and repair terrain
   *
   * @param {string[][]} terrain - Terrain grid (modified in place)
   * @param {Object[][]} obstacles - Obstacles grid (modified in place)
   * @param {number} width - Map width
   * @param {number} height - Map height
   * @param {function} random - Seeded random function
   * @returns {Object} Final validation result
   */
  validateAndRepair(terrain, obstacles, width, height, random) {
    let result = this.validate(terrain, obstacles, width, height);
    let iteration = 0;

    while (!result.valid && iteration < this.constraints.maxRepairIterations) {
      iteration++;

      // Sort violations by severity
      const criticalViolations = result.violations.filter(v => v.severity === 'critical');
      const highViolations = result.violations.filter(v => v.severity === 'high');
      const mediumViolations = result.violations.filter(v => v.severity === 'medium');

      // Repair critical violations first
      for (const violation of criticalViolations) {
        this._repairViolation(violation, terrain, obstacles, width, height, random, result.metrics);
      }

      // Then high severity
      for (const violation of highViolations) {
        this._repairViolation(violation, terrain, obstacles, width, height, random, result.metrics);
      }

      // Then medium (if we have iterations left)
      if (iteration < this.constraints.maxRepairIterations - 1) {
        for (const violation of mediumViolations) {
          this._repairViolation(violation, terrain, obstacles, width, height, random, result.metrics);
        }
      }

      // Re-validate
      result = this.validate(terrain, obstacles, width, height);
    }

    result.repairIterations = iteration;
    return result;
  }

  /**
   * Calculate map metrics for validation
   * @private
   */
  _calculateMetrics(terrain, obstacles, width, height) {
    // Calculate walkable ratio (excluding spawn areas)
    let walkableCount = 0;
    let totalCount = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 5; x < width - 5; x++) { // Exclude spawn columns
        totalCount++;
        if (!isImpassable(terrain[y]?.[x])) {
          if (!this._hasBlockingObstacle(obstacles, x, y)) {
            walkableCount++;
          }
        }
      }
    }

    const walkableRatio = totalCount > 0 ? walkableCount / totalCount : 0;

    // Find connected components
    const components = this._findConnectedComponents(terrain, obstacles, width, height);
    const componentCount = components.length;

    // Check spawn connectivity
    const playerSpawn = { x: 2, y: Math.floor(height / 2) };
    const enemySpawn = { x: width - 3, y: Math.floor(height / 2) };
    const spawnsConnected = this._arePositionsConnected(
      terrain, obstacles, width, height,
      playerSpawn, enemySpawn
    );

    // Count dead ends
    const deadEndCount = this._countDeadEnds(terrain, obstacles, width, height);

    // Calculate path length ratio
    const pathMetrics = this._calculatePathMetrics(terrain, obstacles, width, height);

    // Analyze approach paths
    const approachPathCount = this._countApproachPaths(terrain, obstacles, width, height);

    // Find minimum passage width
    const minPassageWidth = this._findMinimumPassageWidth(terrain, obstacles, width, height);

    return {
      walkableRatio,
      componentCount,
      components,
      spawnsConnected,
      deadEndCount,
      pathLengthRatio: pathMetrics.ratio,
      shortestPathLength: pathMetrics.shortest,
      manhattanDistance: pathMetrics.manhattan,
      approachPathCount,
      minPassageWidth
    };
  }

  /**
   * Check if position has a blocking obstacle
   * @private
   */
  _hasBlockingObstacle(obstacles, x, y) {
    if (!obstacles) return false;
    const obstacle = obstacles[y]?.[x];
    if (!obstacle) return false;
    return obstacle.type === 'trees' || obstacle.type === 'rocks';
  }

  /**
   * Find connected walkable components using flood fill
   * @private
   */
  _findConnectedComponents(terrain, obstacles, width, height) {
    const visited = new Set();
    const components = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const key = `${x},${y}`;
        if (visited.has(key)) continue;
        if (isImpassable(terrain[y]?.[x])) continue;
        if (this._hasBlockingObstacle(obstacles, x, y)) continue;

        // Flood fill this component
        const component = [];
        const queue = [{ x, y }];
        visited.add(key);

        while (queue.length > 0) {
          const pos = queue.shift();
          component.push(pos);

          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = pos.x + dx;
            const ny = pos.y + dy;
            const nkey = `${nx},${ny}`;

            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (visited.has(nkey)) continue;
            if (isImpassable(terrain[ny]?.[nx])) continue;
            if (this._hasBlockingObstacle(obstacles, nx, ny)) continue;

            visited.add(nkey);
            queue.push({ x: nx, y: ny });
          }
        }

        components.push(component);
      }
    }

    // Sort by size descending
    components.sort((a, b) => b.length - a.length);
    return components;
  }

  /**
   * Check if two positions are connected
   * @private
   */
  _arePositionsConnected(terrain, obstacles, width, height, from, to) {
    const visited = new Set();
    const queue = [from];
    visited.add(`${from.x},${from.y}`);

    while (queue.length > 0) {
      const pos = queue.shift();

      if (pos.x === to.x && pos.y === to.y) return true;

      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = pos.x + dx;
        const ny = pos.y + dy;
        const nkey = `${nx},${ny}`;

        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (visited.has(nkey)) continue;
        if (isImpassable(terrain[ny]?.[nx])) continue;
        if (this._hasBlockingObstacle(obstacles, nx, ny)) continue;

        visited.add(nkey);
        queue.push({ x: nx, y: ny });
      }
    }

    return false;
  }

  /**
   * Count dead-end tiles
   * @private
   */
  _countDeadEnds(terrain, obstacles, width, height) {
    let count = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 5; x < width - 5; x++) { // Exclude spawn areas
        if (isImpassable(terrain[y]?.[x])) continue;
        if (this._hasBlockingObstacle(obstacles, x, y)) continue;

        // Count walkable neighbors
        let walkableNeighbors = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (!isImpassable(terrain[ny]?.[nx]) && !this._hasBlockingObstacle(obstacles, nx, ny)) {
            walkableNeighbors++;
          }
        }

        if (walkableNeighbors <= 1) {
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Calculate path metrics (shortest path vs Manhattan distance)
   * @private
   */
  _calculatePathMetrics(terrain, obstacles, width, height) {
    const playerSpawn = { x: 2, y: Math.floor(height / 2) };
    const enemySpawn = { x: width - 3, y: Math.floor(height / 2) };

    const manhattan = Math.abs(enemySpawn.x - playerSpawn.x) + Math.abs(enemySpawn.y - playerSpawn.y);

    // BFS for shortest path
    const shortest = this._findShortestPath(terrain, obstacles, width, height, playerSpawn, enemySpawn);

    return {
      manhattan,
      shortest,
      ratio: shortest === Infinity ? Infinity : shortest / manhattan
    };
  }

  /**
   * Find shortest path length using BFS
   * @private
   */
  _findShortestPath(terrain, obstacles, width, height, from, to) {
    const visited = new Map();
    const queue = [{ x: from.x, y: from.y, dist: 0 }];
    visited.set(`${from.x},${from.y}`, 0);

    while (queue.length > 0) {
      const pos = queue.shift();

      if (pos.x === to.x && pos.y === to.y) return pos.dist;

      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = pos.x + dx;
        const ny = pos.y + dy;
        const nkey = `${nx},${ny}`;

        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (visited.has(nkey)) continue;
        if (isImpassable(terrain[ny]?.[nx])) continue;
        if (this._hasBlockingObstacle(obstacles, nx, ny)) continue;

        visited.set(nkey, pos.dist + 1);
        queue.push({ x: nx, y: ny, dist: pos.dist + 1 });
      }
    }

    return Infinity;
  }

  /**
   * Count distinct approach paths
   * @private
   */
  _countApproachPaths(terrain, obstacles, width, height) {
    // Simplified: count corridor-width passages at center column
    const centerX = Math.floor(width / 2);
    let pathCount = 0;
    let inPath = false;

    for (let y = 0; y < height; y++) {
      const isWalkable = !isImpassable(terrain[y]?.[centerX]) &&
                        !this._hasBlockingObstacle(obstacles, centerX, y);

      if (isWalkable && !inPath) {
        pathCount++;
        inPath = true;
      } else if (!isWalkable) {
        inPath = false;
      }
    }

    return pathCount;
  }

  /**
   * Find minimum passage width
   * @private
   */
  _findMinimumPassageWidth(terrain, obstacles, width, height) {
    let minWidth = Infinity;

    // Check vertical passages at each x
    for (let x = 5; x < width - 5; x++) {
      let currentWidth = 0;
      let hasPassage = false;

      for (let y = 0; y < height; y++) {
        const isWalkable = !isImpassable(terrain[y]?.[x]) &&
                          !this._hasBlockingObstacle(obstacles, x, y);

        if (isWalkable) {
          currentWidth++;
          hasPassage = true;
        } else {
          if (hasPassage && currentWidth > 0 && currentWidth < minWidth) {
            minWidth = currentWidth;
          }
          currentWidth = 0;
        }
      }

      if (hasPassage && currentWidth > 0 && currentWidth < minWidth) {
        minWidth = currentWidth;
      }
    }

    return minWidth === Infinity ? 0 : minWidth;
  }

  /**
   * Repair a specific violation
   * @private
   */
  _repairViolation(violation, terrain, obstacles, width, height, random, metrics) {
    switch (violation.type) {
      case VIOLATION_TYPES.DISCONNECTED_REGIONS:
        this._connectComponents(terrain, obstacles, width, height, random, metrics.components);
        break;

      case VIOLATION_TYPES.POI_UNREACHABLE:
        this._carveSpawnCorridor(terrain, obstacles, width, height, random);
        break;

      case VIOLATION_TYPES.WALKABLE_TOO_LOW:
        this._carveOpenAreas(terrain, obstacles, width, height, random);
        break;

      case VIOLATION_TYPES.TOO_MANY_DEAD_ENDS:
        this._fillDeadEnds(terrain, obstacles, width, height, random);
        break;

      case VIOLATION_TYPES.PATH_TOO_LONG:
        this._carveShortcuts(terrain, obstacles, width, height, random);
        break;

      case VIOLATION_TYPES.BOTTLENECK_TOO_NARROW:
        this._widenBottlenecks(terrain, obstacles, width, height, random);
        break;
    }
  }

  /**
   * Connect disconnected components by carving tunnels
   * @private
   */
  _connectComponents(terrain, obstacles, width, height, random, components) {
    if (components.length < 2) return;

    const mainComponent = components[0];

    for (let i = 1; i < components.length; i++) {
      const otherComponent = components[i];

      // Find closest points between components
      let minDist = Infinity;
      let closestPair = null;

      for (const main of mainComponent) {
        for (const other of otherComponent) {
          const dist = Math.abs(main.x - other.x) + Math.abs(main.y - other.y);
          if (dist < minDist) {
            minDist = dist;
            closestPair = { from: main, to: other };
          }
        }
      }

      if (closestPair) {
        this._carveConnection(terrain, obstacles, closestPair.from, closestPair.to, random);
      }
    }
  }

  /**
   * Carve a connection between two points
   * @private
   */
  _carveConnection(terrain, obstacles, from, to, random) {
    let x = from.x;
    let y = from.y;

    while (x !== to.x || y !== to.y) {
      // Clear tile
      if (isImpassable(terrain[y]?.[x])) {
        terrain[y][x] = 'stone';
      }
      if (obstacles?.[y]) {
        obstacles[y][x] = null;
      }

      // Move toward target
      if (x !== to.x && (y === to.y || random() < 0.5)) {
        x += x < to.x ? 1 : -1;
      } else if (y !== to.y) {
        y += y < to.y ? 1 : -1;
      }
    }
  }

  /**
   * Carve corridor connecting spawn areas
   * @private
   */
  _carveSpawnCorridor(terrain, obstacles, width, height, random) {
    const corridorY = Math.floor(height / 2) + Math.floor((random() - 0.5) * 6);

    for (let x = 4; x < width - 4; x++) {
      for (let dy = -1; dy <= 1; dy++) {
        const y = corridorY + dy;
        if (y >= 0 && y < height) {
          if (isImpassable(terrain[y]?.[x])) {
            terrain[y][x] = 'stone';
          }
          if (obstacles?.[y]) {
            obstacles[y][x] = null;
          }
        }
      }
    }
  }

  /**
   * Carve open areas to increase walkable ratio
   * @private
   */
  _carveOpenAreas(terrain, obstacles, width, height, random) {
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const radius = 4 + Math.floor(random() * 3);

    for (let y = centerY - radius; y <= centerY + radius; y++) {
      for (let x = centerX - radius; x <= centerX + radius; x++) {
        if (x < 5 || x >= width - 5) continue;
        if (y < 0 || y >= height) continue;

        const dist = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
        if (dist <= radius && random() < 0.7) {
          if (isImpassable(terrain[y]?.[x])) {
            terrain[y][x] = 'stone';
          }
          if (obstacles?.[y]) {
            obstacles[y][x] = null;
          }
        }
      }
    }
  }

  /**
   * Fill or widen dead ends
   * @private
   */
  _fillDeadEnds(terrain, obstacles, width, height, random) {
    // Actually widen dead ends rather than fill
    for (let y = 1; y < height - 1; y++) {
      for (let x = 5; x < width - 5; x++) {
        if (isImpassable(terrain[y]?.[x])) continue;

        let walkableNeighbors = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (!isImpassable(terrain[ny]?.[nx])) {
            walkableNeighbors++;
          }
        }

        if (walkableNeighbors <= 1) {
          // Open up a random adjacent wall
          const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
          const shuffled = [...dirs].sort(() => random() - 0.5);

          for (const [dx, dy] of shuffled) {
            const nx = x + dx;
            const ny = y + dy;
            if (isImpassable(terrain[ny]?.[nx])) {
              terrain[ny][nx] = 'stone';
              if (obstacles?.[ny]) {
                obstacles[ny][nx] = null;
              }
              break;
            }
          }
        }
      }
    }
  }

  /**
   * Carve shortcuts to reduce path length
   * @private
   */
  _carveShortcuts(terrain, obstacles, width, height, random) {
    // Carve a relatively direct path
    const startY = Math.floor(height / 2);
    let y = startY;

    for (let x = 6; x < width - 6; x++) {
      // Carve 2-tile wide path
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny >= 0 && ny < height) {
          if (isImpassable(terrain[ny]?.[x])) {
            terrain[ny][x] = 'stone';
          }
          if (obstacles?.[ny]) {
            obstacles[ny][x] = null;
          }
        }
      }

      // Occasional vertical drift
      if (random() < 0.15) {
        y = Math.max(2, Math.min(height - 3, y + (random() < 0.5 ? -1 : 1)));
      }
    }
  }

  /**
   * Widen bottlenecks
   * @private
   */
  _widenBottlenecks(terrain, obstacles, width, height, random) {
    // Find narrow passages and widen them
    for (let x = 5; x < width - 5; x++) {
      let passageStart = -1;
      let passageEnd = -1;

      for (let y = 0; y < height; y++) {
        const isWalkable = !isImpassable(terrain[y]?.[x]);

        if (isWalkable && passageStart === -1) {
          passageStart = y;
        } else if (!isWalkable && passageStart !== -1) {
          passageEnd = y - 1;

          const passageWidth = passageEnd - passageStart + 1;
          if (passageWidth < this.constraints.minPassableWidth) {
            // Widen by carving adjacent
            if (passageStart > 0) {
              terrain[passageStart - 1][x] = 'stone';
              if (obstacles?.[passageStart - 1]) {
                obstacles[passageStart - 1][x] = null;
              }
            }
            if (passageEnd < height - 1) {
              terrain[passageEnd + 1][x] = 'stone';
              if (obstacles?.[passageEnd + 1]) {
                obstacles[passageEnd + 1][x] = null;
              }
            }
          }

          passageStart = -1;
        }
      }
    }
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Validate terrain against constraints
 *
 * @param {string[][]} terrain - Terrain grid
 * @param {Object[][]} obstacles - Obstacles grid
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {Object} constraints - Constraint configuration
 * @returns {Object} Validation result
 */
export function validateTerrain(terrain, obstacles, width, height, constraints = {}) {
  const validator = new ConstraintValidator(constraints);
  return validator.validate(terrain, obstacles, width, height);
}

/**
 * Validate and repair terrain
 *
 * @param {string[][]} terrain - Terrain grid (modified in place)
 * @param {Object[][]} obstacles - Obstacles grid (modified in place)
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {function} random - Seeded random function
 * @param {Object} constraints - Constraint configuration
 * @returns {Object} Final validation result
 */
export function validateAndRepairTerrain(terrain, obstacles, width, height, random, constraints = {}) {
  const validator = new ConstraintValidator(constraints);
  return validator.validateAndRepair(terrain, obstacles, width, height, random);
}

export default ConstraintValidator;
