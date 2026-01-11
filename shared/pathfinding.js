/**
 * Pathfinding - Movement calculations for tactical combat
 * SINGLE SOURCE OF TRUTH for pathfinding used by both server and client
 *
 * Contains Dijkstra (reachable tiles) and A* (optimal path) algorithms
 * with terrain cost support.
 */

import { getTerrainMovementCost, isImpassable } from './terrain.js';

/**
 * Get all tiles reachable within a movement range using Dijkstra's algorithm
 * Accounts for terrain movement costs
 *
 * @param {number} startX - Starting X position
 * @param {number} startY - Starting Y position
 * @param {number} range - Maximum movement cost (not Manhattan distance)
 * @param {string[][]} terrain - 2D terrain grid
 * @param {Array} units - Array of units with { tileX, tileY, hp } or { x, y, hp }
 * @param {number} mapWidth - Map width in tiles
 * @param {number} mapHeight - Map height in tiles
 * @returns {Array} Array of { x, y, cost } reachable tiles (excludes start)
 */
export function getReachableTiles(startX, startY, range, terrain, units, mapWidth, mapHeight) {
  const costs = new Map();
  const visited = new Set();
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

    // Get 4-directional neighbors
    const neighbors = [
      { x: current.x - 1, y: current.y },
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y - 1 },
      { x: current.x, y: current.y + 1 }
    ];

    for (const neighbor of neighbors) {
      // Check bounds
      if (neighbor.x < 0 || neighbor.y < 0 ||
          neighbor.x >= mapWidth || neighbor.y >= mapHeight) continue;

      // Get terrain and cost
      const tileTerrain = terrain?.[neighbor.y]?.[neighbor.x] || 'grass';
      const terrainCost = getTerrainMovementCost(tileTerrain);

      // Skip impassable terrain
      if (terrainCost === Infinity) continue;

      // Check for other units (can't move through occupied tiles)
      const occupied = isOccupied(neighbor.x, neighbor.y, units, startX, startY);
      if (occupied) continue;

      const newCost = current.cost + terrainCost;
      const key = `${neighbor.x},${neighbor.y}`;

      // Only add if within range AND (not seen OR found cheaper path)
      if (newCost <= range && (!costs.has(key) || costs.get(key) > newCost)) {
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
 * Calculate minimum movement cost to reach target tile using Dijkstra's algorithm
 * Returns Infinity if target is unreachable within maxCost
 *
 * @param {number} startX - Starting X position
 * @param {number} startY - Starting Y position
 * @param {number} targetX - Target X position
 * @param {number} targetY - Target Y position
 * @param {string[][]} terrain - 2D terrain grid
 * @param {Array} units - Array of units
 * @param {number} maxCost - Maximum movement cost to search
 * @param {number} mapWidth - Map width in tiles
 * @param {number} mapHeight - Map height in tiles
 * @returns {number} Path cost to reach target, or Infinity if unreachable
 */
export function calculatePathCost(startX, startY, targetX, targetY, terrain, units, maxCost, mapWidth, mapHeight) {
  // If no terrain data, fall back to Manhattan distance for backwards compatibility
  if (!terrain) {
    return Math.abs(targetX - startX) + Math.abs(targetY - startY);
  }

  const costs = new Map();
  const visited = new Set();
  const queue = [{ x: startX, y: startY, cost: 0 }];

  costs.set(`${startX},${startY}`, 0);

  while (queue.length > 0) {
    // Sort by cost (simple priority queue)
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    const currentKey = `${current.x},${current.y}`;

    // Skip if already processed
    if (visited.has(currentKey)) continue;
    visited.add(currentKey);

    // Found target - return the cost
    if (current.x === targetX && current.y === targetY) {
      return current.cost;
    }

    // Get 4-directional neighbors
    const neighbors = [
      { x: current.x - 1, y: current.y },
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y - 1 },
      { x: current.x, y: current.y + 1 }
    ];

    for (const neighbor of neighbors) {
      // Check bounds
      if (neighbor.x < 0 || neighbor.y < 0 ||
          neighbor.x >= mapWidth || neighbor.y >= mapHeight) continue;

      // Get terrain and cost
      const tileTerrain = terrain?.[neighbor.y]?.[neighbor.x] || 'grass';
      const terrainCost = getTerrainMovementCost(tileTerrain);

      // Skip impassable terrain
      if (terrainCost === Infinity) continue;

      // Check for other units (can't move through them, except target tile)
      const isTargetTile = neighbor.x === targetX && neighbor.y === targetY;
      if (!isTargetTile) {
        const occupied = isOccupied(neighbor.x, neighbor.y, units, startX, startY);
        if (occupied) continue;
      }

      const newCost = current.cost + terrainCost;
      const key = `${neighbor.x},${neighbor.y}`;

      // Only add if within range and (not seen OR found cheaper path)
      if (newCost <= maxCost && (!costs.has(key) || costs.get(key) > newCost)) {
        costs.set(key, newCost);
        queue.push({ x: neighbor.x, y: neighbor.y, cost: newCost });
      }
    }
  }

  // Target not reachable within movement range
  return Infinity;
}

/**
 * Find optimal path between two points using A* algorithm
 * Returns array of { x, y } waypoints from start to end (inclusive)
 *
 * @param {number} startX - Starting X position
 * @param {number} startY - Starting Y position
 * @param {number} endX - Destination X position
 * @param {number} endY - Destination Y position
 * @param {string[][]} terrain - 2D terrain grid
 * @param {Array} units - Array of units
 * @param {number} mapWidth - Map width in tiles
 * @param {number} mapHeight - Map height in tiles
 * @returns {Array|null} Array of { x, y } waypoints, or null if no path exists
 */
export function findPath(startX, startY, endX, endY, terrain, units, mapWidth, mapHeight) {
  const openSet = [{ x: startX, y: startY, g: 0, f: 0, parent: null }];
  const closedSet = new Set();
  const gScores = new Map();

  gScores.set(`${startX},${startY}`, 0);

  // Heuristic: Manhattan distance
  const heuristic = (x1, y1, x2, y2) => Math.abs(x1 - x2) + Math.abs(y1 - y2);

  while (openSet.length > 0) {
    // Get node with lowest f score
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift();
    const currentKey = `${current.x},${current.y}`;

    // Reached goal
    if (current.x === endX && current.y === endY) {
      return reconstructPath(current);
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

      // Check bounds
      if (neighbor.x < 0 || neighbor.y < 0 ||
          neighbor.x >= mapWidth || neighbor.y >= mapHeight) continue;

      // Get terrain cost
      const tileTerrain = terrain?.[neighbor.y]?.[neighbor.x] || 'grass';
      const terrainCost = getTerrainMovementCost(tileTerrain);

      // Skip impassable terrain
      if (terrainCost === Infinity) continue;

      // Check for units (allow moving to destination even if occupied)
      const isDestination = neighbor.x === endX && neighbor.y === endY;
      if (!isDestination) {
        const occupied = isOccupied(neighbor.x, neighbor.y, units, startX, startY);
        if (occupied) continue;
      }

      const tentativeG = current.g + terrainCost;

      if (!gScores.has(neighborKey) || tentativeG < gScores.get(neighborKey)) {
        gScores.set(neighborKey, tentativeG);

        const h = heuristic(neighbor.x, neighbor.y, endX, endY);
        const f = tentativeG + h;

        // Remove existing entry if present
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
 * Reconstruct path from A* result node
 * @param {Object} node - End node with parent chain
 * @returns {Array} Array of { x, y } from start to end
 */
function reconstructPath(node) {
  const path = [];
  let current = node;

  while (current) {
    path.unshift({ x: current.x, y: current.y });
    current = current.parent;
  }

  return path;
}

/**
 * Check if a tile is occupied by a living unit
 * Supports both { tileX, tileY } and { x, y } formats
 *
 * @param {number} x - X position to check
 * @param {number} y - Y position to check
 * @param {Array} units - Array of units
 * @param {number} excludeX - X position to exclude (typically the moving unit's position)
 * @param {number} excludeY - Y position to exclude
 * @returns {boolean} True if tile is occupied by another unit
 */
function isOccupied(x, y, units, excludeX = null, excludeY = null) {
  if (!units || !Array.isArray(units)) return false;

  for (const unit of units) {
    // Support both server format (tileX/tileY) and client format (gridX/gridY or x/y)
    const unitX = unit.tileX ?? unit.gridX ?? unit.x;
    const unitY = unit.tileY ?? unit.gridY ?? unit.y;
    const unitHP = unit.hp ?? unit.currentHp ?? 1;

    // Skip dead units
    if (unitHP <= 0) continue;

    // Skip the excluded position (the unit that's moving)
    if (excludeX !== null && excludeY !== null &&
        unitX === excludeX && unitY === excludeY) continue;

    if (unitX === x && unitY === y) {
      return true;
    }
  }

  return false;
}

/**
 * Get Manhattan distance between two points
 * @param {number} x1 - First X position
 * @param {number} y1 - First Y position
 * @param {number} x2 - Second X position
 * @param {number} y2 - Second Y position
 * @returns {number} Manhattan distance
 */
export function getManhattanDistance(x1, y1, x2, y2) {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

/**
 * Get all tiles within attack range (Manhattan distance, not terrain-based)
 * @param {number} startX - Starting X position
 * @param {number} startY - Starting Y position
 * @param {number} attackRange - Maximum attack range
 * @param {number} mapWidth - Map width in tiles
 * @param {number} mapHeight - Map height in tiles
 * @returns {Array} Array of { x, y, distance } tiles
 */
export function getAttackableTiles(startX, startY, attackRange, mapWidth, mapHeight) {
  const attackable = [];

  for (let dx = -attackRange; dx <= attackRange; dx++) {
    for (let dy = -attackRange; dy <= attackRange; dy++) {
      const distance = Math.abs(dx) + Math.abs(dy);
      if (distance > 0 && distance <= attackRange) {
        const x = startX + dx;
        const y = startY + dy;
        // Check bounds
        if (x >= 0 && x < mapWidth && y >= 0 && y < mapHeight) {
          attackable.push({ x, y, distance });
        }
      }
    }
  }

  return attackable;
}

/**
 * Check if a valid path exists between two areas (ignoring units)
 * Used for map validation to ensure playable terrain
 *
 * @param {number} startX - Starting X position
 * @param {number} startY - Starting Y position
 * @param {number} endX - Destination X position
 * @param {number} endY - Destination Y position
 * @param {string[][]} terrain - 2D terrain grid
 * @param {number} mapWidth - Map width in tiles
 * @param {number} mapHeight - Map height in tiles
 * @returns {boolean} True if a path exists between start and end
 */
export function hasValidPath(startX, startY, endX, endY, terrain, mapWidth, mapHeight) {
  // Use BFS for simple reachability check
  const visited = new Set();
  const queue = [{ x: startX, y: startY }];
  visited.add(`${startX},${startY}`);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current.x === endX && current.y === endY) return true;

    const neighbors = [
      { x: current.x - 1, y: current.y },
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y - 1 },
      { x: current.x, y: current.y + 1 }
    ];

    for (const neighbor of neighbors) {
      const key = `${neighbor.x},${neighbor.y}`;
      if (visited.has(key)) continue;
      if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= mapWidth || neighbor.y >= mapHeight) continue;

      const tileTerrain = terrain?.[neighbor.y]?.[neighbor.x] || 'grass';
      if (isImpassable(tileTerrain)) continue;

      visited.add(key);
      queue.push(neighbor);
    }
  }
  return false;
}

/**
 * Analyze map connectivity between spawn areas
 * Tests multiple paths from player spawn to enemy spawn
 *
 * @param {string[][]} terrain - 2D terrain grid
 * @param {number} mapWidth - Map width in tiles
 * @param {number} mapHeight - Map height in tiles
 * @returns {Object} { pathCount, hasMinimumPaths, bottlenecks }
 */
export function analyzeMapConnectivity(terrain, mapWidth, mapHeight) {
  const playerSpawnX = 2;
  const enemySpawnX = mapWidth - 3;
  const testRows = [
    Math.floor(mapHeight * 0.25),
    Math.floor(mapHeight * 0.5),
    Math.floor(mapHeight * 0.75)
  ];

  let pathCount = 0;
  const bottlenecks = [];

  for (const row of testRows) {
    if (hasValidPath(playerSpawnX, row, enemySpawnX, row, terrain, mapWidth, mapHeight)) {
      pathCount++;
    }
  }

  // Check for bottlenecks (columns with very few passable tiles)
  for (let x = 5; x < mapWidth - 5; x++) {
    let passableCount = 0;
    for (let y = 0; y < mapHeight; y++) {
      if (!isImpassable(terrain[y]?.[x])) passableCount++;
    }
    if (passableCount < 4) bottlenecks.push({ x, passableCount });
  }

  return { pathCount, hasMinimumPaths: pathCount >= 2, bottlenecks };
}
