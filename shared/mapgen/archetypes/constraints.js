/**
 * Archetype Constraints - Validation rules for map generation archetypes
 *
 * Each archetype defines constraints that the generated map must satisfy.
 * The ConstraintValidator uses these to verify map quality and trigger
 * repair operations when needed.
 *
 * Constraint categories:
 * - Space: Minimum open/walkable ratios
 * - Connectivity: Path accessibility requirements
 * - Structure: Dead-end limits, bottleneck widths
 * - Tactical: Cover placement, approach paths
 */

// ============================================================================
// DEFAULT CONSTRAINTS
// ============================================================================

/**
 * Default constraint values for all archetypes
 * Individual archetypes can override any of these
 */
export const DEFAULT_CONSTRAINTS = {
  /** Minimum ratio of walkable tiles (excluding spawn areas) */
  minWalkableRatio: 0.45,

  /** Maximum ratio of walkable tiles (prevents too-open maps) */
  maxWalkableRatio: 0.85,

  /** All POIs must be reachable from both spawn areas */
  poiReachability: true,

  /** Maximum number of dead-end tiles (tiles with only 1 walkable neighbor) */
  maxDeadEnds: 5,

  /** Minimum number of distinct paths from player spawn to enemy spawn */
  minApproachPaths: 2,

  /** Maximum ratio of path length to Manhattan distance */
  maxPathLengthRatio: 2.5,

  /** Minimum width of any passable corridor */
  minPassableWidth: 2,

  /** Maximum iterations for constraint repair */
  maxRepairIterations: 5,

  /** Minimum distance between spawns (in tiles) */
  minSpawnSeparation: 15,

  /** Require clear line from spawn center to map center */
  requireSpawnToCenter: true,

  /** Minimum cover positions in combat zone */
  minCoverPositions: 4,

  /** Maximum cover positions (prevents cluttered maps) */
  maxCoverPositions: 20
};

// ============================================================================
// ARCHETYPE CONSTRAINT PRESETS
// ============================================================================

/**
 * Constraint presets for different map styles
 */
export const CONSTRAINT_PRESETS = {
  /**
   * Open field - Minimal obstacles, wide open spaces
   */
  open: {
    minWalkableRatio: 0.70,
    maxWalkableRatio: 0.95,
    maxDeadEnds: 0,
    minApproachPaths: 4,
    maxPathLengthRatio: 1.8,
    minPassableWidth: 4,
    minCoverPositions: 2,
    maxCoverPositions: 8
  },

  /**
   * Arena - Central open area with defined boundaries
   */
  arena: {
    minWalkableRatio: 0.55,
    maxWalkableRatio: 0.75,
    maxDeadEnds: 0,
    minApproachPaths: 3,
    maxPathLengthRatio: 2.0,
    minPassableWidth: 3,
    minCoverPositions: 4,
    maxCoverPositions: 12
  },

  /**
   * Corridor - Narrow passages connecting areas
   */
  corridor: {
    minWalkableRatio: 0.35,
    maxWalkableRatio: 0.55,
    maxDeadEnds: 3,
    minApproachPaths: 2,
    maxPathLengthRatio: 3.0,
    minPassableWidth: 2,
    minCoverPositions: 6,
    maxCoverPositions: 15
  },

  /**
   * Rooms - Distinct chambers connected by paths
   */
  rooms: {
    minWalkableRatio: 0.40,
    maxWalkableRatio: 0.65,
    maxDeadEnds: 4,
    minApproachPaths: 2,
    maxPathLengthRatio: 2.8,
    minPassableWidth: 2,
    minCoverPositions: 5,
    maxCoverPositions: 18
  },

  /**
   * Cave - Organic open spaces with natural barriers
   */
  cave: {
    minWalkableRatio: 0.40,
    maxWalkableRatio: 0.60,
    maxDeadEnds: 6,
    minApproachPaths: 2,
    maxPathLengthRatio: 2.5,
    minPassableWidth: 2,
    minCoverPositions: 4,
    maxCoverPositions: 16
  },

  /**
   * Bridge - Linear path with limited lateral movement
   */
  bridge: {
    minWalkableRatio: 0.25,
    maxWalkableRatio: 0.45,
    maxDeadEnds: 2,
    minApproachPaths: 1,
    maxPathLengthRatio: 2.0,
    minPassableWidth: 3,
    minCoverPositions: 2,
    maxCoverPositions: 6
  },

  /**
   * Maze - Complex winding paths with many choices
   */
  maze: {
    minWalkableRatio: 0.35,
    maxWalkableRatio: 0.55,
    maxDeadEnds: 8,
    minApproachPaths: 3,
    maxPathLengthRatio: 4.0,
    minPassableWidth: 2,
    minCoverPositions: 8,
    maxCoverPositions: 20
  },

  /**
   * Balanced - Standard tactical map
   */
  balanced: {
    minWalkableRatio: 0.45,
    maxWalkableRatio: 0.70,
    maxDeadEnds: 4,
    minApproachPaths: 2,
    maxPathLengthRatio: 2.5,
    minPassableWidth: 2,
    minCoverPositions: 5,
    maxCoverPositions: 15
  }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get constraints for an archetype by merging preset with defaults
 *
 * @param {string} presetName - Name of the constraint preset
 * @param {Object} overrides - Additional constraint overrides
 * @returns {Object} Complete constraint configuration
 */
export function getConstraints(presetName, overrides = {}) {
  const preset = CONSTRAINT_PRESETS[presetName] || CONSTRAINT_PRESETS.balanced;

  return {
    ...DEFAULT_CONSTRAINTS,
    ...preset,
    ...overrides
  };
}

/**
 * Validate that constraints are internally consistent
 *
 * @param {Object} constraints - Constraints to validate
 * @returns {{valid: boolean, errors: string[]}} Validation result
 */
export function validateConstraintConfig(constraints) {
  const errors = [];

  // Check ratio bounds
  if (constraints.minWalkableRatio >= constraints.maxWalkableRatio) {
    errors.push('minWalkableRatio must be less than maxWalkableRatio');
  }

  if (constraints.minWalkableRatio < 0.15) {
    errors.push('minWalkableRatio too low - maps need at least 15% walkable space');
  }

  if (constraints.maxWalkableRatio > 0.98) {
    errors.push('maxWalkableRatio too high - maps need some terrain variety');
  }

  // Check path requirements
  if (constraints.minApproachPaths < 1) {
    errors.push('minApproachPaths must be at least 1');
  }

  if (constraints.maxPathLengthRatio < 1.0) {
    errors.push('maxPathLengthRatio must be at least 1.0 (direct path)');
  }

  // Check cover bounds
  if (constraints.minCoverPositions >= constraints.maxCoverPositions) {
    errors.push('minCoverPositions must be less than maxCoverPositions');
  }

  // Check passable width
  if (constraints.minPassableWidth < 1) {
    errors.push('minPassableWidth must be at least 1');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get a constraint value with fallback to default
 *
 * @param {Object} constraints - Constraint object
 * @param {string} key - Constraint key
 * @returns {*} Constraint value
 */
export function getConstraint(constraints, key) {
  if (constraints && constraints[key] !== undefined) {
    return constraints[key];
  }
  return DEFAULT_CONSTRAINTS[key];
}

/**
 * Create a strict version of constraints (tighter bounds)
 *
 * @param {Object} constraints - Base constraints
 * @returns {Object} Stricter constraints
 */
export function strictenConstraints(constraints) {
  return {
    ...constraints,
    minWalkableRatio: Math.min(constraints.minWalkableRatio + 0.05, constraints.maxWalkableRatio - 0.1),
    maxDeadEnds: Math.max(0, constraints.maxDeadEnds - 2),
    minApproachPaths: constraints.minApproachPaths + 1,
    maxPathLengthRatio: constraints.maxPathLengthRatio - 0.3,
    minPassableWidth: constraints.minPassableWidth + 1
  };
}

/**
 * Create a relaxed version of constraints (looser bounds)
 *
 * @param {Object} constraints - Base constraints
 * @returns {Object} Relaxed constraints
 */
export function relaxConstraints(constraints) {
  return {
    ...constraints,
    minWalkableRatio: Math.max(0.25, constraints.minWalkableRatio - 0.1),
    maxDeadEnds: constraints.maxDeadEnds + 3,
    minApproachPaths: Math.max(1, constraints.minApproachPaths - 1),
    maxPathLengthRatio: constraints.maxPathLengthRatio + 0.5,
    minPassableWidth: Math.max(1, constraints.minPassableWidth - 1)
  };
}

export default {
  DEFAULT_CONSTRAINTS,
  CONSTRAINT_PRESETS,
  getConstraints,
  validateConstraintConfig,
  getConstraint,
  strictenConstraints,
  relaxConstraints
};
