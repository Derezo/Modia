/**
 * Terrain - Terrain types, movement costs, and passability
 * SINGLE SOURCE OF TRUTH for terrain-related constants used by both server and client
 */

// ============================================================================
// ELEVATION SYSTEM
// ============================================================================

/**
 * Elevation levels for multi-level battle maps
 * Extended range from -3 to +8 for dramatic vertical gameplay
 *
 * Negative levels (below ground):
 * -3 (DEEP_PIT): Deep dungeon pits, dangerous chasms
 * -2 (PIT): Standard pits, trap areas
 * -1 (TRENCH): Shallow trenches, moats
 *
 * Ground and raised levels:
 *  0 (GROUND): Ground level - default
 *  1 (RAISED): Raised platforms, small hills
 *  2 (HIGH): High ground, cliffs
 *  3 (VERY_HIGH): Very high structures
 *
 * Elevated structures:
 *  4 (PEAK): Mountain peaks
 *  5 (SPIRE): Tower spires
 *  6 (TOWER): Tower structures
 *  7 (TOWER_TOP): Tower tops
 *  8 (CLOUD): Maximum height - sky platforms
 */
export const ELEVATION_LEVELS = {
  DEEP_PIT: -3,
  PIT: -2,
  TRENCH: -1,
  GROUND: 0,
  RAISED: 1,
  HIGH: 2,
  VERY_HIGH: 3,
  PEAK: 4,
  SPIRE: 5,
  TOWER: 6,
  TOWER_TOP: 7,
  CLOUD: 8
};

/**
 * Representative normalized values for each semantic tactical level. Values
 * sit near the middle of discretizeElevation's bands so round-tripping is
 * stable across generation, rendering, and server pathfinding.
 */
export const NORMALIZED_ELEVATION_BY_LEVEL = Object.freeze({
  [-3]: 0.025,
  [-2]: 0.075,
  [-1]: 0.14,
  [0]: 0.33,
  [1]: 0.54,
  [2]: 0.66,
  [3]: 0.77,
  [4]: 0.86,
  [5]: 0.92,
  [6]: 0.955,
  [7]: 0.98,
  [8]: 0.995
});

/**
 * Convert a semantic elevation level to the canonical normalized band center.
 * Invalid values safely resolve to ground.
 *
 * @param {number} level - Semantic level (-3..8)
 * @returns {number} Normalized elevation (0..1)
 */
export function elevationLevelToNormalized(level) {
  if (!Number.isFinite(level)) return NORMALIZED_ELEVATION_BY_LEVEL[0];
  const rounded = Math.max(
    ELEVATION_LEVELS.DEEP_PIT,
    Math.min(ELEVATION_LEVELS.CLOUD, Math.round(level))
  );
  return NORMALIZED_ELEVATION_BY_LEVEL[rounded];
}

/**
 * Resolve an elevation grid's representation. Explicit formats win; legacy
 * untagged integer grids are semantic levels, while any fractional sample
 * identifies the current normalized representation.
 *
 * @param {number[][]} elevation - Elevation grid
 * @param {'auto'|'discrete'|'normalized'} format - Declared representation
 * @returns {'discrete'|'normalized'} Resolved representation
 */
export function inferElevationFormat(elevation, format = 'auto') {
  if (format === 'discrete' || format === 'normalized') return format;
  if (!Array.isArray(elevation)) return 'normalized';

  for (const row of elevation) {
    if (!Array.isArray(row)) continue;
    for (const value of row) {
      if (Number.isFinite(value) && !Number.isInteger(value)) return 'normalized';
    }
  }
  return 'discrete';
}

/**
 * Adapt legacy semantic elevation grids to the normalized representation used
 * by shared 3D pathfinding. Normalized inputs are returned without allocation.
 *
 * @param {number[][]} elevation - Elevation grid
 * @param {'auto'|'discrete'|'normalized'} format - Declared representation
 * @returns {number[][]|*} Canonical normalized grid, or the original non-grid value
 */
export function normalizeElevationGrid(elevation, format = 'auto') {
  if (!Array.isArray(elevation)) return elevation;
  if (inferElevationFormat(elevation, format) === 'normalized') return elevation;

  return elevation.map(row => Array.isArray(row)
    ? row.map(elevationLevelToNormalized)
    : row
  );
}

/**
 * Discretize raw elevation value (0-1 float) to elevation level (-3 to +8)
 * SINGLE SOURCE OF TRUTH for elevation discretization used by pathfinding and rendering
 *
 * Distribution is weighted toward ground level for natural terrain:
 * - Extreme depths (-3 to -2) and heights (+5 to +8) are rare
 * - Ground level (0) is most common (30% of range)
 *
 * @param {number} rawElevation - Raw elevation value (0-1 float or already discrete)
 * @returns {number} Discrete elevation level (-3 to +8)
 */
export function discretizeElevation(rawElevation) {
  if (rawElevation === null || rawElevation === undefined) return ELEVATION_LEVELS.GROUND;

  // If already discrete (not in 0-1 range), return as-is
  if (rawElevation < 0 || rawElevation > 1) {
    return Math.round(rawElevation);
  }

  // Discretize 0-1 floats to elevation levels
  // Weighted toward ground level for natural terrain distribution
  if (rawElevation < 0.05) return ELEVATION_LEVELS.DEEP_PIT;   // -3 (rare)
  if (rawElevation < 0.10) return ELEVATION_LEVELS.PIT;        // -2
  if (rawElevation < 0.18) return ELEVATION_LEVELS.TRENCH;     // -1
  if (rawElevation < 0.48) return ELEVATION_LEVELS.GROUND;     // 0 (most common)
  if (rawElevation < 0.60) return ELEVATION_LEVELS.RAISED;     // 1
  if (rawElevation < 0.72) return ELEVATION_LEVELS.HIGH;       // 2
  if (rawElevation < 0.82) return ELEVATION_LEVELS.VERY_HIGH;  // 3
  if (rawElevation < 0.90) return ELEVATION_LEVELS.PEAK;       // 4
  if (rawElevation < 0.94) return ELEVATION_LEVELS.SPIRE;      // 5
  if (rawElevation < 0.97) return ELEVATION_LEVELS.TOWER;      // 6
  if (rawElevation < 0.99) return ELEVATION_LEVELS.TOWER_TOP;  // 7
  return ELEVATION_LEVELS.CLOUD;                                // 8 (very rare)
}

/**
 * Get elevation level name for UI display
 * @param {number} level - Discrete elevation level (-3 to +8)
 * @returns {string} Human-readable elevation name
 */
export function getElevationName(level) {
  const names = {
    [-3]: 'Deep Pit',
    [-2]: 'Pit',
    [-1]: 'Trench',
    [0]: 'Ground',
    [1]: 'Raised',
    [2]: 'High',
    [3]: 'Very High',
    [4]: 'Peak',
    [5]: 'Spire',
    [6]: 'Tower',
    [7]: 'Tower Top',
    [8]: 'Cloud'
  };
  return names[level] ?? 'Ground';
}

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
 * Updated for extended elevation range (-3 to +8)
 */
export const ELEVATION_RULES = {
  MAX_CLIMB: 1,              // Maximum elevation levels a unit can climb in one move
  MAX_DROP: 3,               // Maximum elevation levels a unit can drop in one move
  DROP_DAMAGE_THRESHOLD: 4,  // Drops greater than this cause fall damage
  CLIFF_THRESHOLD: 4         // 4+ level difference = impassable cliff
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
  // Updated colors with better distinction between stone and rock
  // Rock is now brown-red instead of gray to clearly indicate impassable terrain
  const colors = {
    grass: '#6b8e23',   // Olive green
    stone: '#8b8682',   // Warm gray (walkable)
    forest: '#228b22',  // Forest green
    water: '#4682b4',   // Steel blue
    rock: '#8b4513',    // Brown-red (IMPASSABLE - distinct from stone)
    lava: '#ff4500',    // Orange-red
    cliff: '#2f2f2f',   // Dark charcoal
    tree: '#228b22'     // Forest green (same as forest)
  };
  return colors[terrain] || '#6b8e23';
}
