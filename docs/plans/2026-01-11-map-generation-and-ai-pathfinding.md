# Map Generation Validation & AI Strategic Pathfinding

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure procedurally generated battle maps always have viable paths between spawn areas, and make AI strategically navigate around obstacles over multiple turns.

**Architecture:** Two-phase approach: (1) Add path validation to map generation with regeneration/carving fallbacks, (2) Add strategic pathfinding layer to AI that computes long-term paths to enemies and scores movement toward path waypoints.

**Tech Stack:** Shared JavaScript modules (pathfinding.js, mapGeneration.js, terrain.js), Node.js AI services

---

## Phase 1: Map Generation Validation

### Task 1: Add Path Validation Function to Shared Pathfinding

**Files:**
- Modify: `shared/pathfinding.js` (add new export)
- Test: Manual testing via node REPL

**Step 1: Add `hasValidPath` function**

Add this function after `findPath`:

```javascript
/**
 * Check if a valid path exists between two areas (ignoring units)
 * Used for map validation to ensure playable terrain
 *
 * @param {number} startX - Starting X position
 * @param {number} startY - Starting Y position
 * @param {number} endX - Target X position
 * @param {number} endY - Target Y position
 * @param {string[][]} terrain - 2D terrain grid
 * @param {number} mapWidth - Map width in tiles
 * @param {number} mapHeight - Map height in tiles
 * @returns {boolean} True if a path exists
 */
export function hasValidPath(startX, startY, endX, endY, terrain, mapWidth, mapHeight) {
  // Use BFS for simple reachability check (faster than A* for just existence)
  const visited = new Set();
  const queue = [{ x: startX, y: startY }];

  visited.add(`${startX},${startY}`);

  while (queue.length > 0) {
    const current = queue.shift();

    if (current.x === endX && current.y === endY) {
      return true;
    }

    const neighbors = [
      { x: current.x - 1, y: current.y },
      { x: current.x + 1, y: current.y },
      { x: current.x, y: current.y - 1 },
      { x: current.x, y: current.y + 1 }
    ];

    for (const neighbor of neighbors) {
      const key = `${neighbor.x},${neighbor.y}`;
      if (visited.has(key)) continue;

      if (neighbor.x < 0 || neighbor.y < 0 ||
          neighbor.x >= mapWidth || neighbor.y >= mapHeight) continue;

      const tileTerrain = terrain?.[neighbor.y]?.[neighbor.x] || 'grass';
      if (isImpassable(tileTerrain)) continue;

      visited.add(key);
      queue.push(neighbor);
    }
  }

  return false;
}

/**
 * Find multiple valid paths between spawn areas to ensure map connectivity
 * Returns path count and bottleneck information
 *
 * @param {string[][]} terrain - 2D terrain grid
 * @param {number} mapWidth - Map width
 * @param {number} mapHeight - Map height
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
      if (!isImpassable(terrain[y]?.[x])) {
        passableCount++;
      }
    }
    if (passableCount < 4) {
      bottlenecks.push({ x, passableCount });
    }
  }

  return {
    pathCount,
    hasMinimumPaths: pathCount >= 2,
    bottlenecks
  };
}
```

**Step 2: Export the new functions**

Update the imports at the top to include `isImpassable`:

```javascript
import { getTerrainMovementCost, isImpassable } from './terrain.js';
```

---

### Task 2: Add Map Validation and Path Carving to Map Generation

**Files:**
- Modify: `shared/mapGeneration.js`

**Step 1: Add path carving function**

Add after `clearSpawnAreas`:

```javascript
/**
 * Carve paths through impassable terrain to ensure map connectivity
 * Uses a corridor-based approach to create natural-looking paths
 *
 * @param {string[][]} terrain - Terrain grid to modify in place
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {function} random - Seeded random function
 */
function carveConnectingPaths(terrain, width, height, random) {
  const playerSpawnX = 4;
  const enemySpawnX = width - 5;

  // Carve 2-3 horizontal corridors at different heights
  const corridorCount = 2 + Math.floor(random() * 2); // 2-3 corridors
  const corridorRows = [];

  for (let i = 0; i < corridorCount; i++) {
    // Distribute corridors evenly with some randomness
    const baseY = Math.floor((height / (corridorCount + 1)) * (i + 1));
    const offsetY = Math.floor(random() * 5) - 2; // -2 to +2
    const y = Math.max(2, Math.min(height - 3, baseY + offsetY));
    corridorRows.push(y);
  }

  for (const corridorY of corridorRows) {
    // Carve main corridor with some vertical wandering
    let currentY = corridorY;

    for (let x = playerSpawnX; x <= enemySpawnX; x++) {
      // Carve current tile and one above/below for width
      for (let dy = -1; dy <= 1; dy++) {
        const y = currentY + dy;
        if (y >= 0 && y < height && isImpassable(terrain[y][x])) {
          terrain[y][x] = 'stone'; // Replace impassable with stone
        }
      }

      // Occasionally shift corridor up or down for natural look
      if (random() < 0.15) {
        const shift = random() < 0.5 ? -1 : 1;
        currentY = Math.max(2, Math.min(height - 3, currentY + shift));
      }
    }
  }
}

/**
 * Validate map has sufficient paths and carve if needed
 * @param {string[][]} terrain - Terrain grid
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {function} random - Seeded random function
 * @returns {boolean} True if map is now valid
 */
function ensureMapConnectivity(terrain, width, height, random) {
  // Import dynamically to avoid circular dependency
  const { analyzeMapConnectivity } = require('./pathfinding.js');

  const analysis = analyzeMapConnectivity(terrain, width, height);

  if (!analysis.hasMinimumPaths) {
    carveConnectingPaths(terrain, width, height, random);
    return true; // Modified
  }

  // Also carve through severe bottlenecks
  for (const bottleneck of analysis.bottlenecks) {
    if (bottleneck.passableCount < 2) {
      // Carve a path through this column
      const midY = Math.floor(height / 2);
      for (let dy = -2; dy <= 2; dy++) {
        const y = midY + dy;
        if (y >= 0 && y < height && isImpassable(terrain[y][bottleneck.x])) {
          terrain[y][bottleneck.x] = 'stone';
        }
      }
    }
  }

  return analysis.bottlenecks.length > 0;
}
```

**Step 2: Update generateTerrain to validate and fix**

Modify the `generateTerrain` function to call validation after clearing spawn areas:

```javascript
export function generateTerrain(seed, nodeType, width = 32, height = 32) {
  const random = createSeededRandom(seed);
  const terrain = [];
  const obstacles = [];
  const variants = [];

  const terrainWeights = getTerrainWeights(nodeType);

  for (let y = 0; y < height; y++) {
    const terrainRow = [];
    const obstacleRow = [];
    const variantRow = [];

    for (let x = 0; x < width; x++) {
      // 1. Terrain selection
      const roll = random();
      let cumulative = 0;
      let selectedTerrain = 'grass';

      for (const [terrainType, weight] of Object.entries(terrainWeights)) {
        cumulative += weight;
        if (roll < cumulative) {
          selectedTerrain = terrainType;
          break;
        }
      }
      terrainRow.push(selectedTerrain);

      // 2. Tile variant (0-3 for visual variety)
      variantRow.push(Math.floor(random() * 4));

      // 3. Obstacle generation (random consumption depends on terrain type)
      obstacleRow.push(generateObstacleForTerrain(selectedTerrain, nodeType, random));
    }

    terrain.push(terrainRow);
    obstacles.push(obstacleRow);
    variants.push(variantRow);
  }

  // Clear spawn areas (left 5 columns for players, right 5 columns for enemies)
  clearSpawnAreas(terrain, obstacles, width, height);

  // NEW: Ensure map has valid paths between sides
  ensureMapConnectivity(terrain, width, height, random);

  return { terrain, obstacles, variants };
}
```

---

### Task 3: Reduce Mountain Terrain Impassable Density

**Files:**
- Modify: `shared/terrain.js`

**Step 1: Rebalance mountain terrain weights**

Change the mountain weights to reduce impassable terrain from 40% to ~25%:

```javascript
export const TERRAIN_WEIGHTS = {
  forest: { grass: 0.6, forest: 0.25, stone: 0.1, rock: 0.05 },
  cave: { stone: 0.5, rock: 0.2, water: 0.15, lava: 0.05, grass: 0.1 },
  mountain: { stone: 0.45, rock: 0.15, grass: 0.30, cliff: 0.10 }, // Changed: less rock, more grass
  bridge: { stone: 0.6, water: 0.3, grass: 0.1 },
  castle: { stone: 0.7, grass: 0.3 },
  default: { grass: 0.7, stone: 0.2, forest: 0.1 }
};
```

This changes mountain from `40% impassable` (30% rock + 10% cliff) to `25% impassable` (15% rock + 10% cliff).

---

## Phase 2: AI Strategic Pathfinding

### Task 4: Add Strategic Path Calculator to AI

**Files:**
- Create: `api/src/services/ai/strategicPathfinding.js`

**Step 1: Create the strategic pathfinding module**

```javascript
/**
 * Strategic Pathfinding - Multi-turn path planning for AI
 *
 * Computes long-term paths to targets and determines optimal
 * movement toward waypoints over multiple turns.
 */

import { findPath, getManhattanDistance } from '../../../../shared/pathfinding.js';

/**
 * Calculate the strategic path from a unit to the nearest enemy
 * Returns the full path and the next waypoint to move toward
 *
 * @param {Object} unit - The moving unit
 * @param {Object} state - Battle state
 * @returns {Object} { path, nextWaypoint, turnsToReach, targetEnemy }
 */
export function calculateStrategicPath(unit, state) {
  const enemies = state.units.filter(u =>
    u.type !== unit.type && u.hp > 0
  );

  if (enemies.length === 0) {
    return { path: null, nextWaypoint: null, turnsToReach: Infinity, targetEnemy: null };
  }

  // Find path to each enemy and pick the shortest
  let bestPath = null;
  let bestEnemy = null;
  let bestCost = Infinity;

  for (const enemy of enemies) {
    const path = findPath(
      unit.tileX, unit.tileY,
      enemy.tileX, enemy.tileY,
      state.terrain,
      state.units,
      state.mapWidth || 32,
      state.mapHeight || 32
    );

    if (path && path.length < bestCost) {
      bestPath = path;
      bestEnemy = enemy;
      bestCost = path.length;
    }
  }

  if (!bestPath) {
    return { path: null, nextWaypoint: null, turnsToReach: Infinity, targetEnemy: null };
  }

  // Calculate turns to reach based on movement and path cost
  const movementPerTurn = unit.movement || 3;
  const turnsToReach = Math.ceil((bestPath.length - 1) / movementPerTurn);

  // Next waypoint is the tile we should move toward this turn
  // It's the furthest tile on the path within our movement range
  const nextWaypointIndex = Math.min(movementPerTurn, bestPath.length - 1);
  const nextWaypoint = bestPath[nextWaypointIndex];

  return {
    path: bestPath,
    nextWaypoint,
    turnsToReach,
    targetEnemy: bestEnemy
  };
}

/**
 * Score a movement tile based on strategic path progress
 * Higher score = tile moves us closer along the optimal path
 *
 * @param {Object} tile - Tile to evaluate { x, y }
 * @param {Object} strategicInfo - From calculateStrategicPath
 * @param {Object} unit - The moving unit
 * @returns {number} Strategic score (0-100)
 */
export function scoreStrategicMovement(tile, strategicInfo, unit) {
  if (!strategicInfo.path || !strategicInfo.nextWaypoint) {
    return 0;
  }

  const { path, nextWaypoint, targetEnemy } = strategicInfo;

  // Check if this tile is on our strategic path
  const isOnPath = path.some(p => p.x === tile.x && p.y === tile.y);

  // Distance from this tile to next waypoint
  const distToWaypoint = getManhattanDistance(
    tile.x, tile.y,
    nextWaypoint.x, nextWaypoint.y
  );

  // Distance from this tile to target enemy
  const distToEnemy = getManhattanDistance(
    tile.x, tile.y,
    targetEnemy.tileX, targetEnemy.tileY
  );

  // Current distance to enemy
  const currentDistToEnemy = getManhattanDistance(
    unit.tileX, unit.tileY,
    targetEnemy.tileX, targetEnemy.tileY
  );

  let score = 0;

  // Bonus for being on the optimal path
  if (isOnPath) {
    score += 40;
  }

  // Bonus for moving closer to the next waypoint (max 30)
  const waypointProgress = Math.max(0, 30 - distToWaypoint * 5);
  score += waypointProgress;

  // Bonus for reducing distance to enemy (max 30)
  const enemyProgress = (currentDistToEnemy - distToEnemy) * 10;
  score += Math.max(0, Math.min(30, enemyProgress));

  return score;
}

/**
 * Find the best movement tile for strategic advancement
 * Considers both immediate tactical value and long-term path
 *
 * @param {Object} unit - Moving unit
 * @param {Array} reachableTiles - Tiles unit can move to
 * @param {Object} state - Battle state
 * @returns {Object} { tile, strategicScore, strategicInfo }
 */
export function findBestStrategicMove(unit, reachableTiles, state) {
  const strategicInfo = calculateStrategicPath(unit, state);

  if (!strategicInfo.path) {
    // No path found - return null, let tactical AI handle it
    return { tile: null, strategicScore: 0, strategicInfo };
  }

  let bestTile = null;
  let bestScore = -Infinity;

  for (const tile of reachableTiles) {
    const score = scoreStrategicMovement(tile, strategicInfo, unit);
    if (score > bestScore) {
      bestScore = score;
      bestTile = tile;
    }
  }

  return {
    tile: bestTile,
    strategicScore: bestScore,
    strategicInfo
  };
}
```

---

### Task 5: Integrate Strategic Pathfinding into Utility Factors

**Files:**
- Modify: `api/src/services/ai/utilityFactors.js`

**Step 1: Add import for strategic pathfinding**

Add at the top of the file:

```javascript
import { calculateStrategicPath, scoreStrategicMovement } from './strategicPathfinding.js';
```

**Step 2: Add strategic movement factor**

Add this new factor function:

```javascript
/**
 * Strategic path progress factor
 * Rewards movement that follows the optimal path to enemies
 *
 * @param {Object} context - Evaluation context
 * @returns {number} Factor value (0-1)
 */
export function strategicPathProgress(context) {
  const { unit, action, state } = context;

  if (action.type !== 'move') {
    return 0;
  }

  // Calculate strategic path
  const strategicInfo = calculateStrategicPath(unit, state);

  if (!strategicInfo.path) {
    return 0;
  }

  // Score this movement
  const score = scoreStrategicMovement(
    action.position,
    strategicInfo,
    unit
  );

  // Normalize to 0-1 range (max score is ~100)
  return Math.min(1, score / 100);
}

/**
 * Penalize waiting when enemies are far away
 * Encourages movement toward combat
 *
 * @param {Object} context - Evaluation context
 * @returns {number} Factor value (0-1, where 1 = bad to wait)
 */
export function waitingPenalty(context) {
  const { unit, action, state } = context;

  if (action.type !== 'wait') {
    return 0;
  }

  // Check if any enemy is in attack range
  const enemies = state.units.filter(u => u.type !== unit.type && u.hp > 0);
  const attackRange = unit.attackRange || 1;

  const enemyInRange = enemies.some(enemy => {
    const dist = getManhattanDistance(unit.tileX, unit.tileY, enemy.tileX, enemy.tileY);
    return dist <= attackRange;
  });

  if (enemyInRange) {
    return 0; // Waiting might be tactical if enemy in range
  }

  // No enemy in range - penalize waiting
  // Calculate how far the nearest enemy is
  const strategicInfo = calculateStrategicPath(unit, state);

  if (strategicInfo.turnsToReach > 1) {
    return 0.8; // Strong penalty for waiting when enemies are far
  }

  return 0.3; // Mild penalty
}
```

**Step 3: Export the new factors**

Add to the exports at the bottom of the file.

---

### Task 6: Update Pattern Weights to Use Strategic Factors

**Files:**
- Modify: `api/src/services/ai/patternWeights.js`

**Step 1: Add strategic weights to aggressive pattern**

Find the `aggressive` pattern configuration and add:

```javascript
aggressive: {
  // ... existing weights ...
  strategicPathProgress: 0.25,  // ADD: Reward moving along optimal path
  waitingPenalty: -0.3,         // ADD: Penalize waiting when far from enemies
},
```

**Step 2: Add to other relevant patterns**

Add similar weights to `tactical`, `hit-and-run`, and `pack` patterns:

```javascript
tactical: {
  // ... existing weights ...
  strategicPathProgress: 0.20,
  waitingPenalty: -0.2,
},

'hit-and-run': {
  // ... existing weights ...
  strategicPathProgress: 0.15,
  waitingPenalty: -0.1,  // Lower penalty - hit-and-run might wait tactically
},

pack: {
  // ... existing weights ...
  strategicPathProgress: 0.20,
  waitingPenalty: -0.25,
},
```

---

### Task 7: Update State Evaluator to Include Strategic Factors

**Files:**
- Modify: `api/src/services/ai/stateEvaluator.js`

**Step 1: Import new factors**

Add to imports:

```javascript
import { strategicPathProgress, waitingPenalty } from './utilityFactors.js';
```

**Step 2: Register new factors in factor registry**

Add to the `FACTOR_REGISTRY` object:

```javascript
const FACTOR_REGISTRY = {
  // ... existing factors ...
  strategicPathProgress,
  waitingPenalty,
};
```

---

## Phase 3: Testing & Validation

### Task 8: Add Map Generation Tests

**Files:**
- Create: `api/src/tests/mapGeneration.test.js`

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateTerrain } from '../../../shared/mapGeneration.js';
import { analyzeMapConnectivity, hasValidPath } from '../../../shared/pathfinding.js';

describe('Map Generation', () => {
  it('should generate maps with valid paths for mountain biome', () => {
    // Test multiple seeds
    for (let seed = 1; seed <= 20; seed++) {
      const { terrain } = generateTerrain(seed, 'mountain', 32, 32);
      const analysis = analyzeMapConnectivity(terrain, 32, 32);

      assert.ok(
        analysis.hasMinimumPaths,
        `Seed ${seed}: Map should have at least 2 valid paths, found ${analysis.pathCount}`
      );
    }
  });

  it('should have clear spawn areas', () => {
    const { terrain } = generateTerrain(12345, 'mountain', 32, 32);

    // Check player spawn (columns 0-4)
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 5; x++) {
        const isPassable = !['rock', 'cliff', 'lava'].includes(terrain[y][x]);
        assert.ok(isPassable, `Spawn area should be passable at (${x}, ${y})`);
      }
    }
  });

  it('should have path from player to enemy spawn', () => {
    const { terrain } = generateTerrain(99999, 'mountain', 32, 32);

    const hasPath = hasValidPath(2, 16, 29, 16, terrain, 32, 32);
    assert.ok(hasPath, 'Should have path from player to enemy spawn');
  });
});
```

---

### Task 9: Add AI Strategic Pathfinding Tests

**Files:**
- Create: `api/src/tests/aiStrategicPathfinding.test.js`

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateStrategicPath, scoreStrategicMovement } from '../services/ai/strategicPathfinding.js';

describe('AI Strategic Pathfinding', () => {
  const createTestState = () => ({
    mapWidth: 32,
    mapHeight: 32,
    terrain: Array(32).fill(null).map(() => Array(32).fill('grass')),
    units: [
      { id: 1, type: 'player', tileX: 2, tileY: 16, hp: 100, movement: 3 },
      { id: 2, type: 'enemy', tileX: 29, tileY: 16, hp: 100, movement: 3 }
    ]
  });

  it('should find path to nearest enemy', () => {
    const state = createTestState();
    const unit = state.units[0];

    const result = calculateStrategicPath(unit, state);

    assert.ok(result.path, 'Should find a path');
    assert.ok(result.path.length > 0, 'Path should have waypoints');
    assert.strictEqual(result.targetEnemy.id, 2, 'Should target the enemy');
  });

  it('should score movement toward enemy higher', () => {
    const state = createTestState();
    const unit = state.units[0];
    const strategicInfo = calculateStrategicPath(unit, state);

    const moveTowardEnemy = { x: 5, y: 16 }; // Closer to enemy
    const moveAwayFromEnemy = { x: 1, y: 16 }; // Further from enemy

    const scoreToward = scoreStrategicMovement(moveTowardEnemy, strategicInfo, unit);
    const scoreAway = scoreStrategicMovement(moveAwayFromEnemy, strategicInfo, unit);

    assert.ok(scoreToward > scoreAway, 'Moving toward enemy should score higher');
  });

  it('should handle obstacles in path', () => {
    const state = createTestState();
    // Add a wall of rocks in the middle
    for (let y = 10; y < 22; y++) {
      state.terrain[y][15] = 'rock';
    }
    // Leave a gap
    state.terrain[16][15] = 'grass';

    const unit = state.units[0];
    const result = calculateStrategicPath(unit, state);

    assert.ok(result.path, 'Should find path around obstacles');
    // Path should go through the gap at y=16
    const passesGap = result.path.some(p => p.x === 15 && p.y === 16);
    assert.ok(passesGap, 'Path should go through the gap');
  });
});
```

---

## Summary

**Phase 1 (Map Generation):**
1. Add path validation functions to `shared/pathfinding.js`
2. Add path carving to `shared/mapGeneration.js`
3. Rebalance mountain terrain weights in `shared/terrain.js`

**Phase 2 (AI Pathfinding):**
4. Create `strategicPathfinding.js` for long-term path planning
5. Add strategic movement factors to `utilityFactors.js`
6. Add strategic weights to `patternWeights.js`
7. Register factors in `stateEvaluator.js`

**Phase 3 (Testing):**
8. Map generation connectivity tests
9. AI strategic pathfinding tests

**Commit strategy:** Commit after each task with descriptive messages.
