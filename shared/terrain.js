/**
 * Terrain - Terrain types, movement costs, and passability
 * SINGLE SOURCE OF TRUTH for terrain-related constants used by both server and client
 */

// Terrain types that cannot be moved through
export const IMPASSABLE_TERRAIN = ['rock', 'tree', 'lava', 'cliff'];

// Movement costs by terrain type (1 = normal, higher = slower)
// Note: water is passable but costs 3 movement points
export const TERRAIN_COSTS = {
  grass: 1,
  stone: 1,
  forest: 2,
  water: 3
};

// Terrain distribution weights by biome/node type
// Used for seeded terrain generation
export const TERRAIN_WEIGHTS = {
  forest: { grass: 0.6, forest: 0.25, stone: 0.1, rock: 0.05 },
  cave: { stone: 0.5, rock: 0.2, water: 0.15, lava: 0.05, grass: 0.1 },
  mountain: { stone: 0.4, rock: 0.3, grass: 0.2, cliff: 0.1 },
  bridge: { stone: 0.6, water: 0.3, grass: 0.1 },
  castle: { stone: 0.7, grass: 0.3 },
  default: { grass: 0.7, stone: 0.2, forest: 0.1 }
};

/**
 * Check if a terrain type is impassable
 * @param {string} terrain - Terrain type to check
 * @returns {boolean} True if terrain cannot be moved through
 */
export function isImpassable(terrain) {
  return IMPASSABLE_TERRAIN.includes(terrain);
}

/**
 * Get the movement cost for a terrain type
 * @param {string} terrain - Terrain type
 * @returns {number} Movement cost (1-3) or Infinity for impassable
 */
export function getTerrainMovementCost(terrain) {
  if (isImpassable(terrain)) {
    return Infinity;
  }
  return TERRAIN_COSTS[terrain] || 1;
}

/**
 * Get terrain distribution weights for a node/biome type
 * @param {string} nodeType - Node type (forest, cave, mountain, bridge, castle)
 * @returns {Object} Object mapping terrain types to probability weights
 */
export function getTerrainWeights(nodeType) {
  return TERRAIN_WEIGHTS[nodeType] || TERRAIN_WEIGHTS.default;
}

/**
 * Get terrain color for rendering (client-side use)
 * @param {string} terrain - Terrain type
 * @returns {string} Hex color string
 */
export function getTerrainColor(terrain) {
  const colors = {
    grass: '#3d5c3d',
    stone: '#5a5a5a',
    forest: '#2d4a2d',
    water: '#3d5c7a',
    rock: '#4a4a4a',
    lava: '#7a3d3d',
    cliff: '#3a3a3a'
  };
  return colors[terrain] || '#3d5c3d';
}
