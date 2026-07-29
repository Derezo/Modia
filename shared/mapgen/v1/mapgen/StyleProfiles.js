/**
 * StyleProfiles - High-level style mappings for map generation
 *
 * Style profiles provide pre-configured parameter ranges that define
 * the overall feel of generated maps. They act as templates that
 * archetypes can reference to achieve consistent aesthetics.
 *
 * Profile categories:
 * - Density: How cluttered vs sparse the map is
 * - Structure: Organic vs geometric
 * - Difficulty: Open vs constrained movement
 */

// ============================================================================
// STYLE PROFILE DEFINITIONS
// ============================================================================

/**
 * Complete style profile definitions
 */
export const STYLE_PROFILES = {
  /**
   * Clean - Open spaces, minimal clutter
   * Good for: Open fields, arenas, plains
   */
  clean: {
    name: 'clean',
    displayName: 'Clean',
    description: 'Open spaces with minimal obstacles',
    parameterRanges: {
      // Lower density values
      density: { min: 0.05, max: 0.15 },
      obstacleCount: { min: 0.5, max: 0.8 },
      clusterCount: { min: 0.5, max: 0.7 },
      clusterSize: { min: 0.6, max: 0.9 },

      // More open passages
      pathWidth: { min: 1.2, max: 1.5 },
      wanderStrength: { min: 0.6, max: 0.9 },

      // Fewer rooms, larger
      roomCount: { min: 0.5, max: 0.8 },
      roomSize: { min: 1.1, max: 1.4 }
    },
    algorithmWeights: {
      perlinTerrain: 1.0,
      pathCarver: 0.8,
      clusterPlacer: 0.6,
      roomCarver: 0.7,
      cellularAutomata: 0.5
    }
  },

  /**
   * Cluttered - Dense obstacles, many features
   * Good for: Dense forests, ruins, crowded dungeons
   */
  cluttered: {
    name: 'cluttered',
    displayName: 'Cluttered',
    description: 'Dense obstacles and features',
    parameterRanges: {
      // Higher density values
      density: { min: 0.2, max: 0.35 },
      obstacleCount: { min: 1.2, max: 1.6 },
      clusterCount: { min: 1.3, max: 1.8 },
      clusterSize: { min: 1.0, max: 1.3 },

      // Narrower passages
      pathWidth: { min: 0.7, max: 0.9 },
      wanderStrength: { min: 1.0, max: 1.4 },

      // More rooms, smaller
      roomCount: { min: 1.2, max: 1.5 },
      roomSize: { min: 0.7, max: 0.9 }
    },
    algorithmWeights: {
      perlinTerrain: 0.9,
      pathCarver: 1.2,
      clusterPlacer: 1.5,
      roomCarver: 1.0,
      cellularAutomata: 1.2
    }
  },

  /**
   * Natural - Organic, irregular shapes
   * Good for: Caves, forests, natural formations
   */
  natural: {
    name: 'natural',
    displayName: 'Natural',
    description: 'Organic irregular shapes',
    parameterRanges: {
      density: { min: 0.1, max: 0.25 },
      obstacleCount: { min: 0.8, max: 1.2 },
      clusterCount: { min: 0.9, max: 1.3 },
      clusterSize: { min: 0.9, max: 1.2 },

      // Winding paths
      pathWidth: { min: 0.9, max: 1.1 },
      wanderStrength: { min: 1.2, max: 1.6 },

      // Organic room shapes
      roomCount: { min: 0.8, max: 1.1 },
      roomSize: { min: 0.9, max: 1.1 }
    },
    algorithmWeights: {
      perlinTerrain: 1.3,
      pathCarver: 1.0,
      clusterPlacer: 1.2,
      roomCarver: 0.9,
      cellularAutomata: 1.4
    },
    preferredShapes: {
      room: 'oval',
      cluster: 'randomWalk',
      path: 'drunkard'
    }
  },

  /**
   * Structured - Geometric, regular patterns
   * Good for: Dungeons, castles, man-made structures
   */
  structured: {
    name: 'structured',
    displayName: 'Structured',
    description: 'Geometric regular patterns',
    parameterRanges: {
      density: { min: 0.1, max: 0.2 },
      obstacleCount: { min: 0.7, max: 1.0 },
      clusterCount: { min: 0.6, max: 0.9 },
      clusterSize: { min: 0.8, max: 1.0 },

      // Straight corridors
      pathWidth: { min: 1.0, max: 1.2 },
      wanderStrength: { min: 0.2, max: 0.5 },

      // Regular rooms
      roomCount: { min: 1.0, max: 1.3 },
      roomSize: { min: 0.9, max: 1.1 }
    },
    algorithmWeights: {
      perlinTerrain: 0.7,
      pathCarver: 1.3,
      clusterPlacer: 0.8,
      roomCarver: 1.4,
      cellularAutomata: 0.8
    },
    preferredShapes: {
      room: 'rectangle',
      cluster: 'gaussian',
      path: 'direct'
    }
  },

  /**
   * Organic - Soft transitions, flowing shapes
   * Good for: Swamps, flowing water, gentle terrain
   */
  organic: {
    name: 'organic',
    displayName: 'Organic',
    description: 'Soft flowing shapes',
    parameterRanges: {
      density: { min: 0.12, max: 0.22 },
      obstacleCount: { min: 0.9, max: 1.2 },
      clusterCount: { min: 1.0, max: 1.4 },
      clusterSize: { min: 1.0, max: 1.3 },

      // Flowing paths
      pathWidth: { min: 1.0, max: 1.3 },
      wanderStrength: { min: 1.0, max: 1.3 },

      // Oval rooms
      roomCount: { min: 0.9, max: 1.2 },
      roomSize: { min: 1.0, max: 1.2 }
    },
    algorithmWeights: {
      perlinTerrain: 1.2,
      pathCarver: 1.1,
      clusterPlacer: 1.3,
      roomCarver: 1.0,
      cellularAutomata: 1.3
    },
    preferredShapes: {
      room: 'oval',
      cluster: 'gaussian',
      path: 'bezier'
    }
  },

  /**
   * Maze - Complex winding paths, many dead ends
   * Good for: Labyrinthine dungeons, confusing caves
   */
  maze: {
    name: 'maze',
    displayName: 'Maze',
    description: 'Complex winding paths',
    parameterRanges: {
      density: { min: 0.25, max: 0.4 },
      obstacleCount: { min: 1.0, max: 1.4 },
      clusterCount: { min: 0.7, max: 1.0 },
      clusterSize: { min: 0.7, max: 0.9 },

      // Narrow winding paths
      pathWidth: { min: 0.6, max: 0.8 },
      wanderStrength: { min: 1.4, max: 2.0 },

      // Small connecting rooms
      roomCount: { min: 1.2, max: 1.6 },
      roomSize: { min: 0.6, max: 0.8 }
    },
    algorithmWeights: {
      perlinTerrain: 0.8,
      pathCarver: 1.5,
      clusterPlacer: 0.7,
      roomCarver: 0.9,
      cellularAutomata: 1.6
    },
    preferredShapes: {
      room: 'rectangle',
      cluster: 'elongated',
      path: 'drunkard'
    }
  }
};

// ============================================================================
// STYLE PROFILE FUNCTIONS
// ============================================================================

/**
 * Get a style profile by name
 *
 * @param {string} name - Profile name
 * @returns {Object|null} Style profile or null
 */
export function getStyleProfile(name) {
  return STYLE_PROFILES[name] || null;
}

/**
 * Get all style profile names
 *
 * @returns {string[]} Array of profile names
 */
export function getStyleProfileNames() {
  return Object.keys(STYLE_PROFILES);
}

/**
 * Apply style profile multipliers to base parameters
 *
 * @param {Object} baseParams - Base algorithm parameters
 * @param {string} profileName - Style profile name
 * @param {function} random - Seeded random for range selection
 * @returns {Object} Modified parameters
 */
export function applyStyleProfile(baseParams, profileName, random) {
  const profile = STYLE_PROFILES[profileName];
  if (!profile) return { ...baseParams };

  const modified = { ...baseParams };
  const ranges = profile.parameterRanges;

  // Apply multipliers from ranges
  for (const [param, range] of Object.entries(ranges)) {
    if (modified[param] !== undefined) {
      // Generate random multiplier within range
      const multiplier = range.min + random() * (range.max - range.min);
      modified[param] = modified[param] * multiplier;
    }
  }

  // Apply preferred shapes if defined
  if (profile.preferredShapes) {
    if (profile.preferredShapes.room && modified.roomShape === undefined) {
      modified.roomShape = profile.preferredShapes.room;
    }
    if (profile.preferredShapes.cluster && modified.clusterShape === undefined) {
      modified.clusterShape = profile.preferredShapes.cluster;
    }
    if (profile.preferredShapes.path && modified.pathStyle === undefined) {
      modified.pathStyle = profile.preferredShapes.path;
    }
  }

  return modified;
}

/**
 * Get algorithm weight for a style profile
 *
 * @param {string} profileName - Style profile name
 * @param {string} algorithmName - Algorithm name
 * @returns {number} Weight multiplier (default 1.0)
 */
export function getAlgorithmWeight(profileName, algorithmName) {
  const profile = STYLE_PROFILES[profileName];
  if (!profile || !profile.algorithmWeights) return 1.0;
  return profile.algorithmWeights[algorithmName] ?? 1.0;
}

/**
 * Get intensity range for an algorithm based on style
 *
 * @param {string} profileName - Style profile name
 * @param {string} algorithmName - Algorithm name
 * @param {number} baseIntensity - Base intensity value
 * @returns {{min: number, max: number}} Intensity range
 */
export function getIntensityRange(profileName, algorithmName, baseIntensity = 0.5) {
  const weight = getAlgorithmWeight(profileName, algorithmName);
  const adjusted = baseIntensity * weight;

  return {
    min: Math.max(0.1, adjusted - 0.15),
    max: Math.min(0.9, adjusted + 0.15)
  };
}

/**
 * Blend two style profiles
 *
 * @param {string} profileA - First profile name
 * @param {string} profileB - Second profile name
 * @param {number} blendFactor - Blend factor (0 = all A, 1 = all B)
 * @returns {Object} Blended profile parameters
 */
export function blendProfiles(profileA, profileB, blendFactor = 0.5) {
  const a = STYLE_PROFILES[profileA];
  const b = STYLE_PROFILES[profileB];

  if (!a) return b ? { ...b.parameterRanges } : {};
  if (!b) return { ...a.parameterRanges };

  const blended = {};
  const allParams = new Set([
    ...Object.keys(a.parameterRanges),
    ...Object.keys(b.parameterRanges)
  ]);

  for (const param of allParams) {
    const rangeA = a.parameterRanges[param] || { min: 1, max: 1 };
    const rangeB = b.parameterRanges[param] || { min: 1, max: 1 };

    blended[param] = {
      min: rangeA.min * (1 - blendFactor) + rangeB.min * blendFactor,
      max: rangeA.max * (1 - blendFactor) + rangeB.max * blendFactor
    };
  }

  return blended;
}

/**
 * Suggest a style profile based on archetype properties
 *
 * @param {Object} archetype - Archetype definition
 * @returns {string} Suggested profile name
 */
export function suggestStyleProfile(archetype) {
  if (!archetype) return 'natural';

  const name = archetype.name?.toLowerCase() || '';
  const baseTerrain = archetype.baseTerrain || 'grass';

  // Match based on archetype characteristics
  if (name.includes('arena') || name.includes('open') || name.includes('plains')) {
    return 'clean';
  }
  if (name.includes('dungeon') || name.includes('castle') || name.includes('crypt')) {
    return 'structured';
  }
  if (name.includes('cave') || name.includes('tunnel')) {
    return 'organic';
  }
  if (name.includes('maze') || name.includes('labyrinth')) {
    return 'maze';
  }
  if (name.includes('forest') || name.includes('swamp') || name.includes('ruin')) {
    return 'cluttered';
  }

  // Match based on terrain
  if (baseTerrain === 'stone' || baseTerrain === 'rock') {
    return 'structured';
  }
  if (baseTerrain === 'grass' || baseTerrain === 'forest') {
    return 'natural';
  }
  if (baseTerrain === 'water' || baseTerrain === 'lava') {
    return 'organic';
  }

  return 'natural';
}

export default {
  STYLE_PROFILES,
  getStyleProfile,
  getStyleProfileNames,
  applyStyleProfile,
  getAlgorithmWeight,
  getIntensityRange,
  blendProfiles,
  suggestStyleProfile
};
