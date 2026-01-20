/**
 * ParameterSchema - Defines and validates algorithm parameters
 *
 * Provides:
 * - Parameter definitions with types, ranges, and defaults
 * - Validation functions for parameter values
 * - Documentation for algorithm configuration
 *
 * This allows runtime configuration of algorithms while ensuring
 * values are within valid ranges.
 */

// ============================================================================
// PARAMETER TYPES
// ============================================================================

/**
 * Parameter type definitions
 */
export const PARAM_TYPES = {
  NUMBER: 'number',
  INTEGER: 'integer',
  BOOLEAN: 'boolean',
  STRING: 'string',
  ENUM: 'enum',
  ARRAY: 'array',
  OBJECT: 'object'
};

// ============================================================================
// ALGORITHM PARAMETER DEFINITIONS
// ============================================================================

/**
 * Parameter definitions for all algorithms
 */
export const ALGORITHM_PARAMS = {
  /**
   * Perlin Noise parameters
   */
  perlinTerrain: [
    {
      name: 'scale',
      type: PARAM_TYPES.NUMBER,
      min: 0.01,
      max: 0.5,
      default: 0.1,
      description: 'Noise frequency scale. Lower = larger features.'
    },
    {
      name: 'octaves',
      type: PARAM_TYPES.INTEGER,
      min: 1,
      max: 8,
      default: 4,
      description: 'Number of noise layers for detail.'
    },
    {
      name: 'persistence',
      type: PARAM_TYPES.NUMBER,
      min: 0.1,
      max: 0.9,
      default: 0.5,
      description: 'Amplitude reduction per octave.'
    },
    {
      name: 'waterLevel',
      type: PARAM_TYPES.NUMBER,
      min: -1,
      max: 1,
      default: -0.3,
      description: 'Noise threshold for water terrain.'
    }
  ],

  /**
   * Cellular Automata parameters
   */
  cellularAutomata: [
    {
      name: 'initialFill',
      type: PARAM_TYPES.NUMBER,
      min: 0.2,
      max: 0.7,
      default: 0.45,
      description: 'Initial wall density percentage.'
    },
    {
      name: 'iterations',
      type: PARAM_TYPES.INTEGER,
      min: 1,
      max: 10,
      default: 4,
      description: 'Number of CA smoothing passes.'
    },
    {
      name: 'birthThreshold',
      type: PARAM_TYPES.INTEGER,
      min: 3,
      max: 8,
      default: 5,
      description: 'Neighbor count to birth new wall.'
    },
    {
      name: 'surviveThreshold',
      type: PARAM_TYPES.INTEGER,
      min: 2,
      max: 8,
      default: 4,
      description: 'Neighbor count to keep wall alive.'
    },
    {
      name: 'preset',
      type: PARAM_TYPES.ENUM,
      values: ['cave', 'crypt', 'organic', 'sparse'],
      default: 'cave',
      description: 'Preset CA rule configuration.'
    }
  ],

  /**
   * Room Carver parameters
   */
  roomCarver: [
    {
      name: 'roomCount',
      type: PARAM_TYPES.INTEGER,
      min: 1,
      max: 10,
      default: 3,
      description: 'Number of rooms to generate.'
    },
    {
      name: 'minRoomSize',
      type: PARAM_TYPES.INTEGER,
      min: 4,
      max: 15,
      default: 6,
      description: 'Minimum room dimension.'
    },
    {
      name: 'maxRoomSize',
      type: PARAM_TYPES.INTEGER,
      min: 6,
      max: 20,
      default: 12,
      description: 'Maximum room dimension.'
    },
    {
      name: 'roomShape',
      type: PARAM_TYPES.ENUM,
      values: ['rectangle', 'oval', 'irregular'],
      default: 'rectangle',
      description: 'Shape of generated rooms.'
    },
    {
      name: 'padding',
      type: PARAM_TYPES.INTEGER,
      min: 1,
      max: 5,
      default: 2,
      description: 'Minimum space between rooms.'
    },
    {
      name: 'preset',
      type: PARAM_TYPES.ENUM,
      values: ['dungeon', 'cave', 'arena', 'ruins'],
      default: 'dungeon',
      description: 'Preset room configuration.'
    }
  ],

  /**
   * Path Carver parameters
   */
  pathCarver: [
    {
      name: 'pathCount',
      type: PARAM_TYPES.INTEGER,
      min: 1,
      max: 6,
      default: 2,
      description: 'Number of paths to carve.'
    },
    {
      name: 'pathWidth',
      type: PARAM_TYPES.INTEGER,
      min: 1,
      max: 5,
      default: 2,
      description: 'Width of carved paths.'
    },
    {
      name: 'wanderStrength',
      type: PARAM_TYPES.NUMBER,
      min: 0,
      max: 0.8,
      default: 0.3,
      description: 'How much paths deviate from straight.'
    },
    {
      name: 'pathStyle',
      type: PARAM_TYPES.ENUM,
      values: ['drunkard', 'bezier', 'direct'],
      default: 'drunkard',
      description: 'Path generation algorithm.'
    }
  ],

  /**
   * Cluster Placer parameters
   */
  clusterPlacer: [
    {
      name: 'clusterCount',
      type: PARAM_TYPES.INTEGER,
      min: 1,
      max: 10,
      default: 3,
      description: 'Number of clusters to place.'
    },
    {
      name: 'clusterSize',
      type: PARAM_TYPES.INTEGER,
      min: 2,
      max: 12,
      default: 5,
      description: 'Average tiles per cluster.'
    },
    {
      name: 'clusterSpread',
      type: PARAM_TYPES.INTEGER,
      min: 1,
      max: 5,
      default: 2,
      description: 'How spread out tiles in cluster are.'
    },
    {
      name: 'shape',
      type: PARAM_TYPES.ENUM,
      values: ['gaussian', 'randomWalk', 'elongated'],
      default: 'gaussian',
      description: 'Cluster shape distribution.'
    },
    {
      name: 'preset',
      type: PARAM_TYPES.ENUM,
      values: ['treeGrove', 'rockFormation', 'waterPool', 'lavaPool', 'denseForest'],
      default: 'treeGrove',
      description: 'Preset cluster configuration.'
    }
  ],

  /**
   * Elevation parameters
   */
  elevation: [
    {
      name: 'maxElevation',
      type: PARAM_TYPES.INTEGER,
      min: 1,
      max: 5,
      default: 3,
      description: 'Maximum elevation level.'
    },
    {
      name: 'pitChance',
      type: PARAM_TYPES.NUMBER,
      min: 0,
      max: 0.2,
      default: 0.05,
      description: 'Probability of pit terrain.'
    },
    {
      name: 'peakChance',
      type: PARAM_TYPES.NUMBER,
      min: 0,
      max: 0.1,
      default: 0.03,
      description: 'Probability of peak terrain.'
    },
    {
      name: 'rampPreference',
      type: PARAM_TYPES.NUMBER,
      min: 0.1,
      max: 0.8,
      default: 0.4,
      description: 'Preference for ramps over stairs.'
    }
  ],

  /**
   * Cover grid parameters
   */
  coverGrid: [
    {
      name: 'density',
      type: PARAM_TYPES.NUMBER,
      min: 0.05,
      max: 0.4,
      default: 0.15,
      description: 'Cover placement density.'
    },
    {
      name: 'minCover',
      type: PARAM_TYPES.INTEGER,
      min: 2,
      max: 10,
      default: 4,
      description: 'Minimum cover positions.'
    },
    {
      name: 'maxCover',
      type: PARAM_TYPES.INTEGER,
      min: 5,
      max: 30,
      default: 20,
      description: 'Maximum cover positions.'
    },
    {
      name: 'highCoverRatio',
      type: PARAM_TYPES.NUMBER,
      min: 0.1,
      max: 0.6,
      default: 0.35,
      description: 'Ratio of high vs low cover.'
    }
  ]
};

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate a single parameter value
 *
 * @param {Object} paramDef - Parameter definition
 * @param {*} value - Value to validate
 * @returns {{valid: boolean, error?: string, coerced?: *}}
 */
export function validateParam(paramDef, value) {
  // Use default if undefined
  if (value === undefined) {
    return { valid: true, coerced: paramDef.default };
  }

  switch (paramDef.type) {
    case PARAM_TYPES.NUMBER:
      if (typeof value !== 'number' || isNaN(value)) {
        return { valid: false, error: `Expected number for ${paramDef.name}` };
      }
      if (paramDef.min !== undefined && value < paramDef.min) {
        return { valid: true, coerced: paramDef.min };
      }
      if (paramDef.max !== undefined && value > paramDef.max) {
        return { valid: true, coerced: paramDef.max };
      }
      return { valid: true, coerced: value };

    case PARAM_TYPES.INTEGER:
      const intValue = Math.round(value);
      if (typeof value !== 'number' || isNaN(value)) {
        return { valid: false, error: `Expected integer for ${paramDef.name}` };
      }
      if (paramDef.min !== undefined && intValue < paramDef.min) {
        return { valid: true, coerced: paramDef.min };
      }
      if (paramDef.max !== undefined && intValue > paramDef.max) {
        return { valid: true, coerced: paramDef.max };
      }
      return { valid: true, coerced: intValue };

    case PARAM_TYPES.BOOLEAN:
      return { valid: true, coerced: Boolean(value) };

    case PARAM_TYPES.STRING:
      if (typeof value !== 'string') {
        return { valid: false, error: `Expected string for ${paramDef.name}` };
      }
      return { valid: true, coerced: value };

    case PARAM_TYPES.ENUM:
      if (!paramDef.values.includes(value)) {
        return { valid: false, error: `Invalid value for ${paramDef.name}. Expected one of: ${paramDef.values.join(', ')}` };
      }
      return { valid: true, coerced: value };

    default:
      return { valid: true, coerced: value };
  }
}

/**
 * Validate all parameters for an algorithm
 *
 * @param {string} algorithmName - Algorithm name
 * @param {Object} params - Parameters to validate
 * @returns {{valid: boolean, errors: string[], coerced: Object}}
 */
export function validateAlgorithmParams(algorithmName, params = {}) {
  const paramDefs = ALGORITHM_PARAMS[algorithmName];
  if (!paramDefs) {
    return { valid: true, errors: [], coerced: params };
  }

  const errors = [];
  const coerced = {};

  for (const paramDef of paramDefs) {
    const result = validateParam(paramDef, params[paramDef.name]);
    if (!result.valid) {
      errors.push(result.error);
    }
    coerced[paramDef.name] = result.coerced;
  }

  // Copy through any extra params not in schema
  for (const key of Object.keys(params)) {
    if (coerced[key] === undefined) {
      coerced[key] = params[key];
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    coerced
  };
}

/**
 * Get default parameters for an algorithm
 *
 * @param {string} algorithmName - Algorithm name
 * @returns {Object} Default parameter values
 */
export function getDefaultParams(algorithmName) {
  const paramDefs = ALGORITHM_PARAMS[algorithmName];
  if (!paramDefs) return {};

  const defaults = {};
  for (const paramDef of paramDefs) {
    defaults[paramDef.name] = paramDef.default;
  }
  return defaults;
}

/**
 * Get parameter documentation for an algorithm
 *
 * @param {string} algorithmName - Algorithm name
 * @returns {Array} Parameter documentation
 */
export function getParamDocs(algorithmName) {
  return ALGORITHM_PARAMS[algorithmName] || [];
}

/**
 * Get all algorithm names with parameter definitions
 *
 * @returns {string[]} Algorithm names
 */
export function getAlgorithmNames() {
  return Object.keys(ALGORITHM_PARAMS);
}

export default {
  PARAM_TYPES,
  ALGORITHM_PARAMS,
  validateParam,
  validateAlgorithmParams,
  getDefaultParams,
  getParamDocs,
  getAlgorithmNames
};
