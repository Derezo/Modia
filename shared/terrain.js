/**
 * Terrain - Terrain types, movement costs, and passability
 * SINGLE SOURCE OF TRUTH for terrain-related constants used by both server and client
 */

// ============================================================================
// ELEVATION SYSTEM
// ============================================================================

/**
 * Elevation levels for multi-level battle maps
 * -1 (PIT): Pits, trenches - can drop into, hard to climb out
 *  0 (GROUND): Ground level - default
 *  1 (RAISED): Raised platforms, small hills
 *  2 (HIGH): High ground, cliffs
 *  3 (PEAK): Mountain peaks - rare
 */
export const ELEVATION_LEVELS = {
  PIT: -1,
  GROUND: 0,
  RAISED: 1,
  HIGH: 2,
  PEAK: 3
};

/**
 * Connection types for elevation transitions
 * - ramp: Gentle slope, no movement penalty, bidirectional
 * - stairs: Steps, +1 movement cost, bidirectional
 * - ledge: One-way drop (can go down, not up)
 * - cliff: Impassable wall (requires abilities to traverse)
 */
export const ELEVATION_CONNECTION_TYPES = {
  RAMP: 'ramp',
  STAIRS: 'stairs',
  LEDGE: 'ledge',
  CLIFF: 'cliff'
};

/**
 * Movement cost modifiers for elevation connections
 * Added to base terrain movement cost
 */
export const ELEVATION_MOVEMENT_COSTS = {
  ramp: 0,        // No extra cost - gentle slope
  stairs: 1,      // +1 movement cost
  ledge: 0,       // No cost to drop down
  cliff: Infinity // Impassable without special abilities
};

/**
 * Elevation traversal rules
 */
export const ELEVATION_RULES = {
  MAX_CLIMB: 1,     // Maximum elevation levels a unit can climb in one move
  MAX_DROP: 2,      // Maximum elevation levels a unit can drop in one move
  DROP_DAMAGE_THRESHOLD: 3 // Drops greater than this cause fall damage
};

/**
 * Get movement cost for an elevation connection type
 * @param {string} connectionType - Connection type ('ramp', 'stairs', 'ledge', 'cliff')
 * @returns {number} Additional movement cost (0-Infinity)
 */
export function getElevationMovementCost(connectionType) {
  if (!connectionType) return 0;
  return ELEVATION_MOVEMENT_COSTS[connectionType] ?? 0;
}

/**
 * Check if a unit can traverse an elevation change
 * @param {number} fromElevation - Starting elevation level
 * @param {number} toElevation - Target elevation level
 * @param {string} connectionType - Type of connection between tiles
 * @param {Object} options - Optional traversal options
 * @param {number} options.maxClimb - Override max climb (default from ELEVATION_RULES)
 * @param {number} options.maxDrop - Override max drop (default from ELEVATION_RULES)
 * @returns {Object} { canTraverse: boolean, moveCost: number, isOneWay: boolean }
 */
export function canTraverseElevation(fromElevation, toElevation, connectionType, options = {}) {
  const maxClimb = options.maxClimb ?? ELEVATION_RULES.MAX_CLIMB;
  const maxDrop = options.maxDrop ?? ELEVATION_RULES.MAX_DROP;
  const elevDiff = toElevation - fromElevation;

  // Same level - always traversable
  if (elevDiff === 0) {
    return { canTraverse: true, moveCost: 0, isOneWay: false };
  }

  // Going up (climbing)
  if (elevDiff > 0) {
    // Check climb limits
    if (elevDiff > maxClimb && connectionType !== ELEVATION_CONNECTION_TYPES.RAMP &&
        connectionType !== ELEVATION_CONNECTION_TYPES.STAIRS) {
      return { canTraverse: false, moveCost: Infinity, isOneWay: false };
    }

    // Ledges cannot be climbed
    if (connectionType === ELEVATION_CONNECTION_TYPES.LEDGE) {
      return { canTraverse: false, moveCost: Infinity, isOneWay: true };
    }

    // Cliffs are impassable
    if (connectionType === ELEVATION_CONNECTION_TYPES.CLIFF) {
      return { canTraverse: false, moveCost: Infinity, isOneWay: false };
    }

    // Ramps and stairs can be climbed
    const moveCost = getElevationMovementCost(connectionType);
    return { canTraverse: true, moveCost, isOneWay: false };
  }

  // Going down (dropping)
  const dropHeight = Math.abs(elevDiff);

  // Check drop limits
  if (dropHeight > maxDrop) {
    return { canTraverse: false, moveCost: Infinity, isOneWay: false };
  }

  // Ledges allow one-way drops
  if (connectionType === ELEVATION_CONNECTION_TYPES.LEDGE) {
    return { canTraverse: true, moveCost: 0, isOneWay: true };
  }

  // Cliffs can be dropped if within limits
  if (connectionType === ELEVATION_CONNECTION_TYPES.CLIFF) {
    return { canTraverse: dropHeight <= maxDrop, moveCost: 0, isOneWay: true };
  }

  // Ramps and stairs work both ways
  const moveCost = getElevationMovementCost(connectionType);
  return { canTraverse: true, moveCost, isOneWay: false };
}

// ============================================================================
// TERRAIN TYPES
// ============================================================================

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
  mountain: { stone: 0.45, rock: 0.15, grass: 0.30, cliff: 0.10 },
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
