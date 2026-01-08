/**
 * BattlePathfinding - Movement and targeting calculations
 */
export class BattlePathfinding {
  constructor(grid, units) {
    this.grid = grid;
    this.units = units;
  }

  /**
   * Update units reference
   */
  setUnits(units) {
    this.units = units;
  }

  /**
   * Get all tiles reachable within movement range
   * Uses Dijkstra's algorithm with terrain costs
   */
  getReachableTiles(startX, startY, movementRange) {
    const costs = new Map();
    const visited = new Set();  // Track processed tiles to prevent duplicates
    const queue = [{ x: startX, y: startY, cost: 0 }];

    costs.set(`${startX},${startY}`, 0);

    while (queue.length > 0) {
      // Sort by cost (simple priority queue)
      queue.sort((a, b) => a.cost - b.cost);
      const current = queue.shift();
      const currentKey = `${current.x},${current.y}`;

      // Skip if already processed (CRITICAL: prevents duplicate processing)
      if (visited.has(currentKey)) continue;
      visited.add(currentKey);

      // Get neighbors (4-directional)
      const neighbors = [
        { x: current.x - 1, y: current.y },
        { x: current.x + 1, y: current.y },
        { x: current.x, y: current.y - 1 },
        { x: current.x, y: current.y + 1 }
      ];

      for (const neighbor of neighbors) {
        if (!this.isValidMove(neighbor.x, neighbor.y, startX, startY)) continue;

        const terrainCost = this.grid.getMovementCost(neighbor.x, neighbor.y);
        const newCost = current.cost + terrainCost;
        const key = `${neighbor.x},${neighbor.y}`;

        // Only add if within range AND (not seen OR found cheaper path)
        if (newCost <= movementRange && (!costs.has(key) || costs.get(key) > newCost)) {
          costs.set(key, newCost);
          queue.push({ x: neighbor.x, y: neighbor.y, cost: newCost });
        }
      }
    }

    // Build reachable array from costs map (excluding start position)
    const reachable = [];
    for (const [key, cost] of costs) {
      if (key === `${startX},${startY}`) continue;
      const [x, y] = key.split(',').map(Number);
      reachable.push({ x, y, cost });
    }

    return reachable;
  }

  /**
   * Get tiles within attack range (Manhattan distance)
   */
  getAttackableTiles(startX, startY, attackRange) {
    const attackable = [];

    for (let dx = -attackRange; dx <= attackRange; dx++) {
      for (let dy = -attackRange; dy <= attackRange; dy++) {
        const distance = Math.abs(dx) + Math.abs(dy);
        if (distance > 0 && distance <= attackRange) {
          const x = startX + dx;
          const y = startY + dy;
          if (this.grid.isInBounds(x, y)) {
            attackable.push({ x, y, distance });
          }
        }
      }
    }

    return attackable;
  }

  /**
   * Get enemy units within attack range
   */
  getTargetsInRange(startX, startY, attackRange, targetType = 'enemy') {
    const targets = [];
    const attackableTiles = this.getAttackableTiles(startX, startY, attackRange);

    for (const tile of attackableTiles) {
      const unit = this.getUnitAt(tile.x, tile.y);
      if (unit && unit.type === targetType && unit.isAlive()) {
        targets.push({ unit, distance: tile.distance });
      }
    }

    return targets;
  }

  /**
   * Check if a tile is a valid move destination
   */
  isValidMove(x, y, excludeX = null, excludeY = null) {
    // Check bounds
    if (!this.grid.isInBounds(x, y)) return false;

    // Check terrain
    if (!this.grid.isWalkable(x, y)) return false;

    // Check for other units (excluding source position)
    const occupant = this.getUnitAt(x, y);
    if (occupant && !(x === excludeX && y === excludeY)) {
      return false;
    }

    return true;
  }

  /**
   * Get unit at position
   */
  getUnitAt(x, y) {
    for (const unit of this.units.values()) {
      if (unit.gridX === x && unit.gridY === y && unit.isAlive()) {
        return unit;
      }
    }
    return null;
  }

  /**
   * Check if there's a clear line of sight (for ranged attacks)
   */
  hasLineOfSight(startX, startY, endX, endY) {
    // Use Bresenham's line algorithm
    const dx = Math.abs(endX - startX);
    const dy = Math.abs(endY - startY);
    const sx = startX < endX ? 1 : -1;
    const sy = startY < endY ? 1 : -1;
    let err = dx - dy;

    let x = startX;
    let y = startY;

    while (x !== endX || y !== endY) {
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }

      // Skip start and end positions
      if ((x === startX && y === startY) || (x === endX && y === endY)) continue;

      // Check for blocking terrain
      if (this.grid.isImpassable(this.grid.getTerrain(x, y))) {
        return false;
      }
    }

    return true;
  }

  /**
   * Find path between two points using A*
   */
  findPath(startX, startY, endX, endY) {
    const openSet = [{ x: startX, y: startY, g: 0, f: 0, parent: null }];
    const closedSet = new Set();
    const gScores = new Map();

    gScores.set(`${startX},${startY}`, 0);

    while (openSet.length > 0) {
      // Get node with lowest f score
      openSet.sort((a, b) => a.f - b.f);
      const current = openSet.shift();
      const currentKey = `${current.x},${current.y}`;

      // Reached goal
      if (current.x === endX && current.y === endY) {
        return this.reconstructPath(current);
      }

      closedSet.add(currentKey);

      // Check neighbors
      const neighbors = [
        { x: current.x - 1, y: current.y },
        { x: current.x + 1, y: current.y },
        { x: current.x, y: current.y - 1 },
        { x: current.x, y: current.y + 1 }
      ];

      for (const neighbor of neighbors) {
        const neighborKey = `${neighbor.x},${neighbor.y}`;

        if (closedSet.has(neighborKey)) continue;
        if (!this.isValidMove(neighbor.x, neighbor.y, startX, startY)) {
          // Allow moving to destination even if occupied (for pathfinding calculation)
          if (neighbor.x !== endX || neighbor.y !== endY) continue;
        }

        const terrainCost = this.grid.getMovementCost(neighbor.x, neighbor.y);
        const tentativeG = current.g + terrainCost;

        if (!gScores.has(neighborKey) || tentativeG < gScores.get(neighborKey)) {
          gScores.set(neighborKey, tentativeG);

          const h = this.heuristic(neighbor.x, neighbor.y, endX, endY);
          const f = tentativeG + h;

          const existingIndex = openSet.findIndex(n => n.x === neighbor.x && n.y === neighbor.y);
          if (existingIndex >= 0) {
            openSet.splice(existingIndex, 1);
          }

          openSet.push({
            x: neighbor.x,
            y: neighbor.y,
            g: tentativeG,
            f: f,
            parent: current
          });
        }
      }
    }

    // No path found
    return null;
  }

  /**
   * Heuristic function for A* (Manhattan distance)
   */
  heuristic(x1, y1, x2, y2) {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
  }

  /**
   * Reconstruct path from A* result
   */
  reconstructPath(node) {
    const path = [];
    let current = node;

    while (current) {
      path.unshift({ x: current.x, y: current.y });
      current = current.parent;
    }

    return path;
  }

  /**
   * Get the Manhattan distance between two points
   */
  getDistance(x1, y1, x2, y2) {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
  }

  /**
   * Find closest enemy to a position
   */
  findClosestEnemy(x, y, fromType = 'player') {
    const targetType = fromType === 'player' ? 'enemy' : 'player';
    let closest = null;
    let closestDist = Infinity;

    for (const unit of this.units.values()) {
      if (unit.type !== targetType || !unit.isAlive()) continue;

      const dist = this.getDistance(x, y, unit.gridX, unit.gridY);
      if (dist < closestDist) {
        closestDist = dist;
        closest = unit;
      }
    }

    return closest;
  }

  /**
   * Find weakest enemy (lowest HP)
   */
  findWeakestEnemy(fromType = 'player') {
    const targetType = fromType === 'player' ? 'enemy' : 'player';
    let weakest = null;
    let lowestHP = Infinity;

    for (const unit of this.units.values()) {
      if (unit.type !== targetType || !unit.isAlive()) continue;

      if (unit.hp < lowestHP) {
        lowestHP = unit.hp;
        weakest = unit;
      }
    }

    return weakest;
  }

  /**
   * Get tiles affected by an AoE skill
   * @param {number} targetX - Center tile X
   * @param {number} targetY - Center tile Y
   * @param {number} radius - AoE radius (Manhattan distance)
   * @param {string} pattern - AoE pattern: 'circle', 'cross', 'line', 'cone'
   * @param {number} direction - Direction for directional patterns (0-7)
   * @returns {Array} Array of { x, y, isCenter } objects
   */
  getAoETiles(targetX, targetY, radius = 1, pattern = 'circle', direction = 0) {
    const tiles = [];

    switch (pattern) {
      case 'cross':
        // Center + 4 cardinal directions
        tiles.push({ x: targetX, y: targetY, isCenter: true });
        for (let i = 1; i <= radius; i++) {
          // North, South, East, West
          if (this.grid.isInBounds(targetX, targetY - i)) {
            tiles.push({ x: targetX, y: targetY - i, isCenter: false });
          }
          if (this.grid.isInBounds(targetX, targetY + i)) {
            tiles.push({ x: targetX, y: targetY + i, isCenter: false });
          }
          if (this.grid.isInBounds(targetX - i, targetY)) {
            tiles.push({ x: targetX - i, y: targetY, isCenter: false });
          }
          if (this.grid.isInBounds(targetX + i, targetY)) {
            tiles.push({ x: targetX + i, y: targetY, isCenter: false });
          }
        }
        break;

      case 'line':
        // Line in specified direction
        const dirOffsets = [
          { dx: 0, dy: -1 },  // N
          { dx: 1, dy: -1 },  // NE
          { dx: 1, dy: 0 },   // E
          { dx: 1, dy: 1 },   // SE
          { dx: 0, dy: 1 },   // S
          { dx: -1, dy: 1 },  // SW
          { dx: -1, dy: 0 },  // W
          { dx: -1, dy: -1 }  // NW
        ];
        const offset = dirOffsets[direction % 8];
        for (let i = 0; i <= radius; i++) {
          const x = targetX + offset.dx * i;
          const y = targetY + offset.dy * i;
          if (this.grid.isInBounds(x, y)) {
            tiles.push({ x, y, isCenter: i === 0 });
          }
        }
        break;

      case 'circle':
      default:
        // All tiles within Manhattan distance
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dy = -radius; dy <= radius; dy++) {
            const distance = Math.abs(dx) + Math.abs(dy);
            if (distance <= radius) {
              const x = targetX + dx;
              const y = targetY + dy;
              if (this.grid.isInBounds(x, y)) {
                tiles.push({
                  x,
                  y,
                  isCenter: dx === 0 && dy === 0
                });
              }
            }
          }
        }
        break;
    }

    return tiles;
  }

  /**
   * Get all units affected by an AoE at the given position
   * @param {number} targetX - Center tile X
   * @param {number} targetY - Center tile Y
   * @param {number} radius - AoE radius
   * @param {string} pattern - AoE pattern
   * @returns {Array} Array of units in the AoE area
   */
  getUnitsInAoE(targetX, targetY, radius = 1, pattern = 'circle') {
    const aoeTiles = this.getAoETiles(targetX, targetY, radius, pattern);
    const affectedUnits = [];

    for (const tile of aoeTiles) {
      const unit = this.getUnitAt(tile.x, tile.y);
      if (unit && unit.isAlive()) {
        affectedUnits.push({
          unit,
          isCenter: tile.isCenter
        });
      }
    }

    return affectedUnits;
  }
}
