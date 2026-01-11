/**
 * Map Generation - Seeded terrain and obstacle generation for battle maps
 * SINGLE SOURCE OF TRUTH for map generation used by both server and client
 *
 * CRITICAL: Random consumption pattern must be EXACTLY preserved for deterministic maps.
 * Any change to random() call order will cause server/client terrain desync.
 */

import { SeededRandom } from './constants.js';
import { getTerrainWeights, isImpassable } from './terrain.js';

/**
 * Create a seeded random function (Mulberry32 algorithm)
 * This matches the existing pattern in api/src/routes/battle.js and frontend BattleGrid.js
 * @param {number} seed - Seed value
 * @returns {function} Random function that returns 0-1
 */
function createSeededRandom(seed) {
  let currentSeed = seed;
  return function() {
    let t = currentSeed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Obstacle configuration by terrain type
 * Defines what obstacles can appear on impassable terrain
 */
const OBSTACLE_MAP = {
  rock: { category: 'rocks', options: ['rock_small', 'rock_medium', 'rock_large'] },
  tree: { category: 'trees', options: ['oak_tree', 'pine_tree', 'dead_tree'] },
  forest: { category: 'trees', options: ['oak_tree', 'pine_tree'] }, // Note: forest terrain is walkable
  cliff: { category: 'rocks', options: ['rock_large', 'mountain_boulder'] },
  lava: null, // No obstacle, just lava tile
  water: null  // No obstacle, just water tile
};

/**
 * Decorative obstacles by biome type
 */
const DECORATIVE_OBSTACLES = {
  forest: ['grass_tufts', 'wildflowers', 'fallen_log'],
  cave: ['cave_crystals', 'stalagmite'],
  mountain: ['grass_tufts', 'stone_ruins'],
  bridge: ['grass_tufts'],
  castle: ['stone_ruins']
};

/**
 * Get random decorative obstacle for a biome
 * @param {string} nodeType - Biome/node type
 * @param {function} random - Seeded random function
 * @returns {string} Decorative obstacle variant name
 */
function getRandomDecorativeObstacle(nodeType, random) {
  const options = DECORATIVE_OBSTACLES[nodeType] || DECORATIVE_OBSTACLES.forest;
  return options[Math.floor(random() * options.length)];
}

/**
 * Generate obstacle for a terrain tile
 * CRITICAL: Random consumption pattern must match frontend BattleGrid.generateObstacleForTerrain exactly
 *
 * @param {string} terrain - Terrain type at this tile
 * @param {string} nodeType - Biome/node type
 * @param {function} random - Seeded random function
 * @returns {Object|null} Obstacle data { type, variant } or null
 */
function generateObstacleForTerrain(terrain, nodeType, random) {
  if (!isImpassable(terrain)) {
    // Walkable terrain: possible decorative obstacles
    if (nodeType === 'forest' && terrain === 'grass') {
      // Forest grass: 15% chance for tree
      if (random() < 0.15) {
        const treeOptions = ['oak_tree', 'pine_tree'];
        return { type: 'trees', variant: treeOptions[Math.floor(random() * treeOptions.length)] };
      }
      // 5% chance for other decoratives
      if (random() < 0.05) {
        return { type: 'decorative', variant: getRandomDecorativeObstacle(nodeType, random) };
      }
    } else {
      // Other biomes: 5% chance for decorative obstacles on walkable terrain
      if (random() < 0.05) {
        return { type: 'decorative', variant: getRandomDecorativeObstacle(nodeType, random) };
      }
    }
    return null;
  }

  // Impassable terrain: generate terrain-specific obstacle
  const config = OBSTACLE_MAP[terrain];
  if (!config) return null;

  const variant = config.options[Math.floor(random() * config.options.length)];
  return { type: config.category, variant };
}

/**
 * Generate terrain and obstacles from a seed value
 * CRITICAL: This function must produce IDENTICAL results on server and client for the same seed
 *
 * Random consumption pattern per tile (in order):
 * 1. Terrain selection roll
 * 2. Tile variant roll (for visual variety)
 * 3. Obstacle generation (variable calls depending on terrain/biome)
 *
 * @param {number} seed - Seed value for deterministic generation
 * @param {string} nodeType - Biome/node type (forest, cave, mountain, bridge, castle)
 * @param {number} width - Map width in tiles (default 32)
 * @param {number} height - Map height in tiles (default 32)
 * @returns {Object} { terrain: string[][], obstacles: Object[][], variants: number[][] }
 */
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

  // Ensure connectivity between spawn areas, carve paths if needed
  // CRITICAL: Pass obstacles so carved paths clear obstacles too
  ensureMapConnectivity(terrain, obstacles, width, height, random);

  return { terrain, obstacles, variants };
}

/**
 * Clear spawn areas to ensure walkable tiles for unit placement
 * @param {string[][]} terrain - Terrain grid to modify in place
 * @param {Object[][]} obstacles - Obstacle grid to modify in place
 * @param {number} width - Map width
 * @param {number} height - Map height
 */
function clearSpawnAreas(terrain, obstacles, width, height) {
  // Player spawn area (left side, columns 0-4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < 5; x++) {
      if (terrain[y] && isImpassable(terrain[y][x])) {
        terrain[y][x] = 'grass';
      }
      // Clear obstacles in spawn areas
      if (obstacles[y]) {
        obstacles[y][x] = null;
      }
    }
  }

  // Enemy spawn area (right side, last 5 columns)
  for (let y = 0; y < height; y++) {
    for (let x = width - 5; x < width; x++) {
      if (terrain[y] && isImpassable(terrain[y][x])) {
        terrain[y][x] = 'grass';
      }
      // Clear obstacles in spawn areas
      if (obstacles[y]) {
        obstacles[y][x] = null;
      }
    }
  }
}

/**
 * Pre-compute corridor data to ensure consistent random consumption
 * CRITICAL: This must always be called to maintain seeded determinism
 *
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {function} random - Seeded random function
 * @returns {Array} Corridor data with positions and wander decisions
 */
function precomputeCorridorData(width, height, random) {
  const playerSpawnX = 4;
  const enemySpawnX = width - 5;
  const corridorCount = 2 + Math.floor(random() * 2); // 2-3 corridors
  const corridors = [];

  for (let i = 0; i < corridorCount; i++) {
    const baseY = Math.floor((height / (corridorCount + 1)) * (i + 1));
    const offsetY = Math.floor(random() * 5) - 2;
    const startY = Math.max(2, Math.min(height - 3, baseY + offsetY));

    // Pre-compute wander decisions for each column
    const wanderData = [];
    for (let x = playerSpawnX; x <= enemySpawnX; x++) {
      const shouldWander = random() < 0.15;
      const wanderDir = random() < 0.5 ? -1 : 1;
      wanderData.push({ shouldWander, wanderDir });
    }

    corridors.push({ startY, wanderData, playerSpawnX, enemySpawnX });
  }

  return corridors;
}

/**
 * Apply pre-computed corridor data to terrain and obstacles
 *
 * @param {string[][]} terrain - Terrain grid to modify
 * @param {Object[][]} obstacles - Obstacles grid to modify
 * @param {number} height - Map height
 * @param {Array} corridorData - Pre-computed corridor data
 */
function applyCorridorCarving(terrain, obstacles, height, corridorData) {
  for (const corridor of corridorData) {
    let currentY = corridor.startY;

    for (let i = 0; i < corridor.wanderData.length; i++) {
      const x = corridor.playerSpawnX + i;
      const { shouldWander, wanderDir } = corridor.wanderData[i];

      // Carve a 3-tile wide corridor
      for (let dy = -1; dy <= 1; dy++) {
        const y = currentY + dy;
        if (y >= 0 && y < height && isImpassable(terrain[y]?.[x])) {
          terrain[y][x] = 'stone';
          // Also clear any obstacles on carved tiles
          if (obstacles?.[y]) {
            obstacles[y][x] = null;
          }
        }
      }

      // Apply wander if needed
      if (shouldWander) {
        currentY = Math.max(2, Math.min(height - 3, currentY + wanderDir));
      }
    }
  }
}

/**
 * Ensure map has valid paths between spawn areas, carve if needed
 * Uses BFS to check connectivity and carves paths if disconnected
 *
 * CRITICAL: Always pre-computes corridor data to maintain consistent random
 * consumption, regardless of whether carving is needed. This ensures
 * server/client terrain sync with identical seeds.
 *
 * @param {string[][]} terrain - Terrain grid to modify in place
 * @param {Object[][]} obstacles - Obstacles grid to modify in place
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {function} random - Seeded random function
 */
function ensureMapConnectivity(terrain, obstacles, width, height, random) {
  // ALWAYS pre-compute corridor data to consume random values consistently
  // This ensures determinism regardless of whether we need to carve
  const corridorData = precomputeCorridorData(width, height, random);

  const playerSpawnX = 2;
  const enemySpawnX = width - 3;
  const midY = Math.floor(height / 2);

  // Quick connectivity check using BFS
  const visited = new Set();
  const queue = [{ x: playerSpawnX, y: midY }];
  visited.add(`${playerSpawnX},${midY}`);
  let reachedEnemy = false;

  while (queue.length > 0 && !reachedEnemy) {
    const current = queue.shift();
    if (current.x >= enemySpawnX) {
      reachedEnemy = true;
      break;
    }

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const key = `${nx},${ny}`;
      if (visited.has(key) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (isImpassable(terrain[ny]?.[nx])) continue;
      visited.add(key);
      queue.push({ x: nx, y: ny });
    }
  }

  // Only apply carving if path doesn't exist (corridorData already computed)
  if (!reachedEnemy) {
    applyCorridorCarving(terrain, obstacles, height, corridorData);
  }
}

/**
 * Generate terrain only (without obstacles/variants) for server-side validation
 * Uses SAME random consumption pattern as generateTerrain to ensure terrain matches
 *
 * @param {number} seed - Seed value
 * @param {string} nodeType - Biome type
 * @param {number} width - Map width (default 32)
 * @param {number} height - Map height (default 32)
 * @returns {string[][]} 2D terrain grid
 */
export function generateTerrainOnly(seed, nodeType, width = 32, height = 32) {
  const result = generateTerrain(seed, nodeType, width, height);
  return result.terrain;
}
