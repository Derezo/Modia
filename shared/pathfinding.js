/**
 * Pathfinding - Movement calculations for tactical combat
 * SINGLE SOURCE OF TRUTH for pathfinding used by both server and client
 *
 * Contains Dijkstra (reachable tiles) and A* (optimal path) algorithms
 * with terrain cost support.
 */

import {
  getTerrainMovementCost,
  isImpassable,
  getElevationMovementCost,
  canTraverseElevation,
  discretizeElevation,
  ELEVATION_RULES
} from './terrain.js';

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

// ============================================================================
// ELEVATION-AWARE PATHFINDING (3D)
// ============================================================================

/**
 * Calculate movement cost for elevation connection types
 * Slopes and long ramps cost 0.5 movement per level traversed.
 * Multi-stairs cost 1 movement per level traversed.
 * Other connections use the base traversal cost.
 *
 * @param {Object} connectionData - Connection data with type and levels
 * @param {number} baseCost - Base traversal cost from canTraverseElevation
 * @returns {number} Adjusted movement cost
 */
function getConnectionMovementCost(connectionData, baseCost) {
  if (!connectionData) return baseCost;

  switch (connectionData.type) {
    case 'slope':
    case 'long_ramp':
      return Math.ceil((connectionData.levels || 1) * 0.5);
    case 'multi_stairs':
      return connectionData.levels || 1;
    default:
      return baseCost;
  }
}

/**
 * Get all tiles reachable within a movement range, accounting for elevation
 * Uses Dijkstra's algorithm with elevation costs and traversal rules
 *
 * @param {number} startX - Starting X position
 * @param {number} startY - Starting Y position
 * @param {number} startZ - Starting elevation level (optional, will be looked up)
 * @param {number} range - Maximum movement cost
 * @param {string[][]} terrain - 2D terrain grid
 * @param {number[][]} elevation - 2D elevation grid (null for flat maps)
 * @param {Object[][]} connections - 2D grid of elevation connections (null for flat maps)
 * @param {Array} units - Array of units with { tileX, tileY, hp }
 * @param {number} mapWidth - Map width in tiles
 * @param {number} mapHeight - Map height in tiles
 * @param {Object} options - Optional movement options
 * @param {number} options.maxClimb - Max climb height (default 1)
 * @param {number} options.maxDrop - Max drop height (default 2)
 * @returns {Array} Array of { x, y, z, cost } reachable tiles (excludes start)
 */
export function getReachableTiles3D(
  startX, startY, startZ,
  range,
  terrain, elevation, connections,
  units,
  mapWidth, mapHeight,
  options = {}
) {
  // If no elevation data, fall back to 2D pathfinding
  if (!elevation) {
    const tiles2D = getReachableTiles(startX, startY, range, terrain, units, mapWidth, mapHeight);
    return tiles2D.map(t => ({ ...t, z: 0 }));
  }

  const maxClimb = options.maxClimb ?? ELEVATION_RULES.MAX_CLIMB;
  const maxDrop = options.maxDrop ?? ELEVATION_RULES.MAX_DROP;

  // Get actual starting elevation from grid if not provided
  // Apply discretization to ensure consistent level comparison
  const rawStartZ = startZ ?? (elevation[startY]?.[startX] ?? 0);
  const actualStartZ = discretizeElevation(rawStartZ);

  const costs = new Map();
  const visited = new Set();
  const queue = [{ x: startX, y: startY, z: actualStartZ, cost: 0 }];

  costs.set(`${startX},${startY}`, 0);

  while (queue.length > 0) {
    // Sort by cost (simple priority queue)
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    const currentKey = `${current.x},${current.y}`;

    // Skip if already processed
    if (visited.has(currentKey)) continue;
    visited.add(currentKey);

    // Get 4-directional neighbors
    const neighbors = [
      { x: current.x - 1, y: current.y, dir: 'w' },
      { x: current.x + 1, y: current.y, dir: 'e' },
      { x: current.x, y: current.y - 1, dir: 'n' },
      { x: current.x, y: current.y + 1, dir: 's' }
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

      // Check elevation traversal (discretize raw elevation values)
      const rawNeighborZ = elevation[neighbor.y]?.[neighbor.x] ?? 0;
      const neighborZ = discretizeElevation(rawNeighborZ);
      const connectionType = connections?.[current.y]?.[current.x]?.[neighbor.dir]?.type || null;

      const traversal = canTraverseElevation(
        current.z,
        neighborZ,
        connectionType,
        { maxClimb, maxDrop }
      );

      if (!traversal.canTraverse) continue;

      // Check for other units
      const occupied = isOccupied(neighbor.x, neighbor.y, units, startX, startY);
      if (occupied) continue;

      // Calculate total movement cost
      // Use connection-specific cost for slopes, multi-stairs, and long ramps
      const connectionData = connections?.[current.y]?.[current.x]?.[neighbor.dir];
      const elevationCost = getConnectionMovementCost(connectionData, traversal.moveCost);
      const newCost = current.cost + terrainCost + elevationCost;
      const key = `${neighbor.x},${neighbor.y}`;

      // Only add if within range AND (not seen OR found cheaper path)
      if (newCost <= range && (!costs.has(key) || costs.get(key) > newCost)) {
        costs.set(key, newCost);
        queue.push({ x: neighbor.x, y: neighbor.y, z: neighborZ, cost: newCost });
      }
    }
  }

  // Build reachable array from costs map (excluding start position)
  const reachable = [];
  for (const [key, cost] of costs) {
    if (key === `${startX},${startY}`) continue;
    const [x, y] = key.split(',').map(Number);
    // Return discrete elevation levels for consistency
    const rawZ = elevation[y]?.[x] ?? 0;
    const z = discretizeElevation(rawZ);
    reachable.push({ x, y, z, cost });
  }

  return reachable;
}

/**
 * Find optimal path between two points using A* algorithm with elevation
 * Returns array of { x, y, z } waypoints from start to end (inclusive)
 *
 * @param {number} startX - Starting X position
 * @param {number} startY - Starting Y position
 * @param {number} endX - Destination X position
 * @param {number} endY - Destination Y position
 * @param {string[][]} terrain - 2D terrain grid
 * @param {number[][]} elevation - 2D elevation grid (null for flat maps)
 * @param {Object[][]} connections - 2D grid of elevation connections
 * @param {Array} units - Array of units
 * @param {number} mapWidth - Map width in tiles
 * @param {number} mapHeight - Map height in tiles
 * @param {Object} options - Movement options
 * @returns {Array|null} Array of { x, y, z } waypoints, or null if no path exists
 */
export function findPath3D(
  startX, startY, endX, endY,
  terrain, elevation, connections,
  units,
  mapWidth, mapHeight,
  options = {}
) {
  // If no elevation data, fall back to 2D pathfinding
  if (!elevation) {
    const path2D = findPath(startX, startY, endX, endY, terrain, units, mapWidth, mapHeight);
    if (!path2D) return null;
    return path2D.map(p => ({ ...p, z: 0 }));
  }

  const maxClimb = options.maxClimb ?? ELEVATION_RULES.MAX_CLIMB;
  const maxDrop = options.maxDrop ?? ELEVATION_RULES.MAX_DROP;

  // Discretize elevations for consistent comparison
  const startZ = discretizeElevation(elevation[startY]?.[startX] ?? 0);
  const endZ = discretizeElevation(elevation[endY]?.[endX] ?? 0);

  const openSet = [{ x: startX, y: startY, z: startZ, g: 0, f: 0, parent: null }];
  const closedSet = new Set();
  const gScores = new Map();

  gScores.set(`${startX},${startY}`, 0);

  // Heuristic: Manhattan distance + elevation difference penalty
  const heuristic = (x1, y1, z1, x2, y2, z2) => {
    const manhattan = Math.abs(x1 - x2) + Math.abs(y1 - y2);
    const elevDiff = Math.abs(z1 - z2);
    // Add small penalty for elevation changes to prefer flatter paths
    return manhattan + (elevDiff * 0.5);
  };

  while (openSet.length > 0) {
    // Get node with lowest f score
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift();
    const currentKey = `${current.x},${current.y}`;

    // Reached goal
    if (current.x === endX && current.y === endY) {
      return reconstructPath3D(current);
    }

    closedSet.add(currentKey);

    // Check neighbors
    const neighbors = [
      { x: current.x - 1, y: current.y, dir: 'w' },
      { x: current.x + 1, y: current.y, dir: 'e' },
      { x: current.x, y: current.y - 1, dir: 'n' },
      { x: current.x, y: current.y + 1, dir: 's' }
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

      // Check elevation traversal (discretize raw elevation)
      const neighborZ = discretizeElevation(elevation[neighbor.y]?.[neighbor.x] ?? 0);
      const connectionType = connections?.[current.y]?.[current.x]?.[neighbor.dir]?.type || null;

      const traversal = canTraverseElevation(
        current.z,
        neighborZ,
        connectionType,
        { maxClimb, maxDrop }
      );

      if (!traversal.canTraverse) continue;

      // Check for units (allow moving to destination even if occupied)
      const isDestination = neighbor.x === endX && neighbor.y === endY;
      if (!isDestination) {
        const occupied = isOccupied(neighbor.x, neighbor.y, units, startX, startY);
        if (occupied) continue;
      }

      // Calculate elevation cost based on connection type
      const connectionData = connections?.[current.y]?.[current.x]?.[neighbor.dir];
      const elevationCost = getConnectionMovementCost(connectionData, traversal.moveCost);
      const tentativeG = current.g + terrainCost + elevationCost;

      if (!gScores.has(neighborKey) || tentativeG < gScores.get(neighborKey)) {
        gScores.set(neighborKey, tentativeG);

        const h = heuristic(neighbor.x, neighbor.y, neighborZ, endX, endY, endZ);
        const f = tentativeG + h;

        // Remove existing entry if present
        const existingIndex = openSet.findIndex(n => n.x === neighbor.x && n.y === neighbor.y);
        if (existingIndex >= 0) {
          openSet.splice(existingIndex, 1);
        }

        openSet.push({
          x: neighbor.x,
          y: neighbor.y,
          z: neighborZ,
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
 * Reconstruct path from A* result node (3D version)
 * @param {Object} node - End node with parent chain
 * @returns {Array} Array of { x, y, z } from start to end
 */
function reconstructPath3D(node) {
  const path = [];
  let current = node;

  while (current) {
    path.unshift({ x: current.x, y: current.y, z: current.z });
    current = current.parent;
  }

  return path;
}

/**
 * Calculate path cost with elevation, stopping at target or when cost exceeds max
 *
 * @param {number} startX - Starting X position
 * @param {number} startY - Starting Y position
 * @param {number} targetX - Target X position
 * @param {number} targetY - Target Y position
 * @param {string[][]} terrain - 2D terrain grid
 * @param {number[][]} elevation - 2D elevation grid
 * @param {Object[][]} connections - 2D connections grid
 * @param {Array} units - Array of units
 * @param {number} maxCost - Maximum movement cost to search
 * @param {number} mapWidth - Map width in tiles
 * @param {number} mapHeight - Map height in tiles
 * @param {Object} options - Movement options
 * @returns {number} Path cost to reach target, or Infinity if unreachable
 */
export function calculatePathCost3D(
  startX, startY, targetX, targetY,
  terrain, elevation, connections,
  units, maxCost,
  mapWidth, mapHeight,
  options = {}
) {
  // If no elevation data, fall back to 2D
  if (!elevation) {
    return calculatePathCost(startX, startY, targetX, targetY, terrain, units, maxCost, mapWidth, mapHeight);
  }

  const maxClimb = options.maxClimb ?? ELEVATION_RULES.MAX_CLIMB;
  const maxDrop = options.maxDrop ?? ELEVATION_RULES.MAX_DROP;

  const costs = new Map();
  const visited = new Set();
  // Discretize starting elevation
  const startZ = discretizeElevation(elevation[startY]?.[startX] ?? 0);
  const queue = [{
    x: startX,
    y: startY,
    z: startZ,
    cost: 0
  }];

  costs.set(`${startX},${startY}`, 0);

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    const currentKey = `${current.x},${current.y}`;

    if (visited.has(currentKey)) continue;
    visited.add(currentKey);

    // Found target
    if (current.x === targetX && current.y === targetY) {
      return current.cost;
    }

    const neighbors = [
      { x: current.x - 1, y: current.y, dir: 'w' },
      { x: current.x + 1, y: current.y, dir: 'e' },
      { x: current.x, y: current.y - 1, dir: 'n' },
      { x: current.x, y: current.y + 1, dir: 's' }
    ];

    for (const neighbor of neighbors) {
      if (neighbor.x < 0 || neighbor.y < 0 ||
          neighbor.x >= mapWidth || neighbor.y >= mapHeight) continue;

      const tileTerrain = terrain?.[neighbor.y]?.[neighbor.x] || 'grass';
      const terrainCost = getTerrainMovementCost(tileTerrain);
      if (terrainCost === Infinity) continue;

      // Discretize neighbor elevation
      const neighborZ = discretizeElevation(elevation[neighbor.y]?.[neighbor.x] ?? 0);
      const connectionType = connections?.[current.y]?.[current.x]?.[neighbor.dir]?.type || null;

      const traversal = canTraverseElevation(current.z, neighborZ, connectionType, { maxClimb, maxDrop });
      if (!traversal.canTraverse) continue;

      const isTargetTile = neighbor.x === targetX && neighbor.y === targetY;
      if (!isTargetTile) {
        const occupied = isOccupied(neighbor.x, neighbor.y, units, startX, startY);
        if (occupied) continue;
      }

      // Handle special connection types for movement cost
      const connectionData = connections?.[current.y]?.[current.x]?.[neighbor.dir];
      const moveCost = getConnectionMovementCost(connectionData, traversal.moveCost);
      const newCost = current.cost + terrainCost + moveCost;
      const key = `${neighbor.x},${neighbor.y}`;

      if (newCost <= maxCost && (!costs.has(key) || costs.get(key) > newCost)) {
        costs.set(key, newCost);
        queue.push({ x: neighbor.x, y: neighbor.y, z: neighborZ, cost: newCost });
      }
    }
  }

  return Infinity;
}

/**
 * Get tiles attackable from a position, considering line of sight and elevation
 * Higher ground provides attack range bonus
 *
 * @param {number} startX - Starting X position
 * @param {number} startY - Starting Y position
 * @param {number} attackRange - Base attack range
 * @param {number[][]} elevation - 2D elevation grid
 * @param {number} mapWidth - Map width in tiles
 * @param {number} mapHeight - Map height in tiles
 * @param {Object} options - Attack options
 * @param {boolean} options.rangedBonus - Whether ranged attacks get elevation bonus
 * @returns {Array} Array of { x, y, z, distance, elevationBonus } tiles
 */
export function getAttackableTiles3D(
  startX, startY, attackRange,
  elevation,
  mapWidth, mapHeight,
  options = {}
) {
  // Fall back to 2D if no elevation
  if (!elevation) {
    return getAttackableTiles(startX, startY, attackRange, mapWidth, mapHeight)
      .map(t => ({ ...t, z: 0, elevationBonus: 0 }));
  }

  const attackable = [];
  // Discretize elevation for consistent level comparison
  const startZ = discretizeElevation(elevation[startY]?.[startX] ?? 0);
  const rangedBonus = options.rangedBonus ?? true;

  // Calculate effective range with elevation bonus for ranged
  const elevationRangeBonus = rangedBonus ? Math.floor(startZ / 2) : 0;
  const effectiveRange = attackRange + elevationRangeBonus;

  for (let dx = -effectiveRange; dx <= effectiveRange; dx++) {
    for (let dy = -effectiveRange; dy <= effectiveRange; dy++) {
      const distance = Math.abs(dx) + Math.abs(dy);
      if (distance > 0 && distance <= effectiveRange) {
        const x = startX + dx;
        const y = startY + dy;

        // Check bounds
        if (x >= 0 && x < mapWidth && y >= 0 && y < mapHeight) {
          // Discretize target elevation
          const targetZ = discretizeElevation(elevation[y]?.[x] ?? 0);
          const elevDiff = startZ - targetZ;

          // Calculate elevation-based bonuses
          // Shooting down is easier (bonus range already applied)
          // Shooting up is harder (no range penalty but damage penalty in battleMath)
          const elevationBonus = elevDiff; // Positive = attacker is higher

          attackable.push({
            x, y, z: targetZ,
            distance,
            elevationBonus
          });
        }
      }
    }
  }

  return attackable;
}

/**
 * Check if there's valid path connectivity between elevated regions
 * Considers ramps, stairs, and ledges
 *
 * @param {number} startX - Starting X position
 * @param {number} startY - Starting Y position
 * @param {number} endX - Destination X position
 * @param {number} endY - Destination Y position
 * @param {string[][]} terrain - 2D terrain grid
 * @param {number[][]} elevation - 2D elevation grid
 * @param {Object[][]} connections - 2D connections grid
 * @param {number} mapWidth - Map width in tiles
 * @param {number} mapHeight - Map height in tiles
 * @returns {boolean} True if a path exists between start and end
 */
export function hasValidPath3D(
  startX, startY, endX, endY,
  terrain, elevation, connections,
  mapWidth, mapHeight
) {
  // Fall back to 2D if no elevation
  if (!elevation) {
    return hasValidPath(startX, startY, endX, endY, terrain, mapWidth, mapHeight);
  }

  const visited = new Set();
  // Discretize starting elevation
  const startZ = discretizeElevation(elevation[startY]?.[startX] ?? 0);
  const queue = [{
    x: startX,
    y: startY,
    z: startZ
  }];
  visited.add(`${startX},${startY}`);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current.x === endX && current.y === endY) return true;

    const neighbors = [
      { x: current.x - 1, y: current.y, dir: 'w' },
      { x: current.x + 1, y: current.y, dir: 'e' },
      { x: current.x, y: current.y - 1, dir: 'n' },
      { x: current.x, y: current.y + 1, dir: 's' }
    ];

    for (const neighbor of neighbors) {
      const key = `${neighbor.x},${neighbor.y}`;
      if (visited.has(key)) continue;
      if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= mapWidth || neighbor.y >= mapHeight) continue;

      const tileTerrain = terrain?.[neighbor.y]?.[neighbor.x] || 'grass';
      if (isImpassable(tileTerrain)) continue;

      // Discretize neighbor elevation
      const neighborZ = discretizeElevation(elevation[neighbor.y]?.[neighbor.x] ?? 0);
      const connectionData = connections?.[current.y]?.[current.x]?.[neighbor.dir];
      const connectionType = connectionData?.type || null;

      // For large elevation diffs without explicit connection, check cliff threshold
      const elevDiff = Math.abs(current.z - neighborZ);
      if (!connectionType && elevDiff >= ELEVATION_RULES.CLIFF_THRESHOLD) {
        continue; // Impassable cliff
      }

      // Allow slope, long_ramp, and multi_stairs for connectivity checks
      // These connection types enable traversal across multiple elevation levels
      let effectiveType = connectionType;
      if (connectionType === 'slope' || connectionType === 'long_ramp' || connectionType === 'multi_stairs') {
        // These special connections allow multi-level traversal
        // Use 'ramp' as base type since canTraverseElevation supports it
        effectiveType = 'ramp';
      }

      const traversal = canTraverseElevation(current.z, neighborZ, effectiveType);
      if (!traversal.canTraverse) continue;

      visited.add(key);
      queue.push({ x: neighbor.x, y: neighbor.y, z: neighborZ });
    }
  }

  return false;
}
