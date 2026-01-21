/**
 * Archetype Definitions - Curated map generation pipelines
 *
 * Each archetype defines a specific map style with:
 * - algorithms: Ordered list of algorithms to apply with their roles
 * - constraints: Validation rules the generated map must satisfy
 * - coverStrategy: How tactical cover should be placed
 * - styleProfile: High-level style parameters
 *
 * Algorithm roles:
 * - 'macro': Defines large-scale structure (runs first, others build on it)
 * - 'refinement': Refines macro output (e.g., CA smoothing Perlin edges)
 * - 'structure': Places rooms, corridors, POIs
 * - 'detail': Adds clusters, decorations, minor features
 *
 * CRITICAL: Algorithms with seedFromPrevious: true receive the previous
 * algorithm's output region for targeted processing.
 */

import { getConstraints, CONSTRAINT_PRESETS } from './constraints.js';

// ============================================================================
// ARCHETYPE DEFINITIONS
// ============================================================================

/**
 * Complete archetype definitions for all map styles
 */
export const ARCHETYPES = {
  // --------------------------------------------------------------------------
  // OPEN TERRAIN ARCHETYPES
  // --------------------------------------------------------------------------

  /**
   * Open Field - Wide open battlefield with minimal obstacles
   * Good for: Ranged combat, cavalry charges, large-scale battles
   */
  openField: {
    name: 'openField',
    displayName: 'Open Field',
    algorithms: [
      {
        name: 'perlinTerrain',
        intensity: 0.3,
        role: 'macro',
        options: {
          scale: 0.06,
          octaves: 3,
          persistence: 0.4,
          // Lower thresholds to match actual noise distribution (centered around 0)
          // rock: high values only, forest: moderate, grass: negative values
          thresholds: { rock: 0.35, forest: -0.1, grass: -1.0 }
        }
      },
      {
        name: 'rockFormations',
        intensity: 0.3,
        role: 'detail',
        options: {
          preset: 'rockFormation',
          clusterCount: 2,
          clusterSize: 3
        }
      }
    ],
    constraints: getConstraints('open'),
    coverStrategy: 'sparse',
    styleProfile: 'clean',
    baseTerrain: 'grass',
    description: 'Wide open battlefield with scattered obstacles'
  },

  /**
   * Forest Clearing - Central open area surrounded by dense trees
   * Good for: Ambushes, mixed ranged/melee, defensive positions
   */
  forestClearing: {
    name: 'forestClearing',
    displayName: 'Forest Clearing',
    algorithms: [
      {
        name: 'perlinTerrain',
        intensity: 0.5,
        role: 'macro',
        options: {
          scale: 0.08,
          octaves: 4,
          persistence: 0.5,
          // Lower thresholds for more forest coverage
          thresholds: { rock: 0.4, forest: -0.15, grass: -1.0 }
        }
      },
      {
        name: 'centralClearing',
        intensity: 0.8,
        role: 'structure',
        options: {
          preset: 'cave',
          floorTerrain: 'grass',
          roomCount: 1,
          minRoomSize: 10,
          maxRoomSize: 16,
          roomShape: 'oval'
        }
      },
      {
        name: 'treeGroves',
        intensity: 0.6,
        role: 'detail',
        options: {
          preset: 'treeGrove',
          clusterCount: 4,
          clusterSize: 5,
          avoidCenter: true
        }
      }
    ],
    constraints: getConstraints('arena'),
    coverStrategy: 'perimeter',
    styleProfile: 'natural',
    baseTerrain: 'grass',
    description: 'Central clearing surrounded by dense forest'
  },

  /**
   * Plains - Rolling terrain with grass and stone patches
   * Good for: Mobile combat, flanking maneuvers
   */
  plains: {
    name: 'plains',
    displayName: 'Plains',
    algorithms: [
      {
        name: 'perlinTerrain',
        intensity: 0.4,
        role: 'macro',
        options: {
          scale: 0.1,
          octaves: 3,
          persistence: 0.45,
          // Adjusted thresholds for more terrain variety
          thresholds: { rock: 0.35, stone: -0.1, grass: -1.0 }
        }
      },
      {
        name: 'bezierPaths',
        intensity: 0.4,
        role: 'structure',
        options: {
          pathStyle: 'bezier',
          pathCount: 2,
          pathWidth: 2,
          floorTerrain: 'grass'
        }
      }
    ],
    constraints: getConstraints('open', { maxDeadEnds: 2 }),
    coverStrategy: 'scattered',
    styleProfile: 'clean',
    baseTerrain: 'grass',
    description: 'Open rolling terrain with natural paths'
  },

  // --------------------------------------------------------------------------
  // CAVE/DUNGEON ARCHETYPES
  // --------------------------------------------------------------------------

  /**
   * Cave Rooms - Organic chambers connected by natural tunnels
   * Good for: Close combat, choke points, defensive positioning
   */
  caveRooms: {
    name: 'caveRooms',
    displayName: 'Cave Chambers',
    algorithms: [
      {
        name: 'perlinMacro',
        intensity: 1.0,
        role: 'macro',
        options: {
          scale: 0.1,
          octaves: 4,
          persistence: 0.55,
          thresholds: { rock: 0.4, stone: -0.2, grass: -1.0 },
          outputSeedRegions: true
        }
      },
      {
        name: 'cellularRefine',
        intensity: 0.8,
        role: 'refinement',
        seedFromPrevious: true,
        options: {
          preset: 'cave',
          wallTerrain: 'rock',
          floorTerrain: 'stone',
          iterations: 4
        }
      },
      {
        name: 'caveRooms',
        intensity: 0.6,
        role: 'structure',
        options: {
          preset: 'cave',
          floorTerrain: 'stone',
          roomCount: 3,
          minRoomSize: 6,
          maxRoomSize: 12,
          roomShape: 'oval'
        }
      }
    ],
    constraints: getConstraints('cave', { maxDeadEnds: 4 }),
    coverStrategy: 'staggered',
    styleProfile: 'organic',
    baseTerrain: 'stone',
    description: 'Organic cave chambers with natural tunnels'
  },

  /**
   * Tunnel Network - Narrow passages with occasional wide areas
   * Good for: Tactical movement, ambush opportunities
   */
  tunnelNetwork: {
    name: 'tunnelNetwork',
    displayName: 'Tunnel Network',
    algorithms: [
      {
        name: 'cellularCaves',
        intensity: 0.9,
        role: 'macro',
        options: {
          preset: 'sparse',
          wallTerrain: 'rock',
          floorTerrain: 'stone',
          initialFill: 0.55,
          iterations: 5
        }
      },
      {
        name: 'tunnelPaths',
        intensity: 0.7,
        role: 'structure',
        options: {
          pathStyle: 'drunkard',
          pathCount: 3,
          pathWidth: 2,
          wanderStrength: 0.25,
          floorTerrain: 'stone'
        }
      },
      {
        name: 'smallChambers',
        intensity: 0.5,
        role: 'structure',
        options: {
          preset: 'cave',
          floorTerrain: 'stone',
          roomCount: 2,
          minRoomSize: 5,
          maxRoomSize: 8
        }
      }
    ],
    constraints: getConstraints('corridor'),
    coverStrategy: 'chokepoint',
    styleProfile: 'organic',
    baseTerrain: 'rock',
    description: 'Narrow tunnels with occasional chambers'
  },

  /**
   * Crystal Cavern - Cave with water/crystal features
   * Good for: Varied terrain combat, hazard navigation
   */
  crystalCavern: {
    name: 'crystalCavern',
    displayName: 'Crystal Cavern',
    algorithms: [
      {
        name: 'cellularCaves',
        intensity: 0.85,
        role: 'macro',
        options: {
          preset: 'cave',
          wallTerrain: 'rock',
          floorTerrain: 'stone',
          initialFill: 0.45
        }
      },
      {
        name: 'mainChamber',
        intensity: 0.7,
        role: 'structure',
        options: {
          preset: 'arena',
          floorTerrain: 'stone',
          roomCount: 1,
          minRoomSize: 10,
          maxRoomSize: 14
        }
      },
      {
        name: 'crystalPools',
        intensity: 0.5,
        role: 'detail',
        options: {
          preset: 'waterPool',
          clusterCount: 3,
          clusterSize: 4
        }
      }
    ],
    constraints: getConstraints('cave'),
    coverStrategy: 'defensive',
    styleProfile: 'natural',
    baseTerrain: 'stone',
    description: 'Crystal-filled cavern with water features'
  },

  // --------------------------------------------------------------------------
  // DUNGEON ARCHETYPES
  // --------------------------------------------------------------------------

  /**
   * Dungeon Halls - Rectangular rooms with corridors
   * Good for: Structured combat, room-by-room clearing
   */
  dungeonHalls: {
    name: 'dungeonHalls',
    displayName: 'Dungeon Halls',
    algorithms: [
      {
        name: 'dungeonRooms',
        intensity: 1.0,
        role: 'macro',
        options: {
          preset: 'dungeon',
          floorTerrain: 'stone',
          roomCount: 5,
          minRoomSize: 5,
          maxRoomSize: 10,
          roomShape: 'rectangle'
        }
      },
      {
        name: 'corridors',
        intensity: 0.9,
        role: 'structure',
        options: {
          pathStyle: 'direct',
          pathCount: 4,
          pathWidth: 2,
          floorTerrain: 'stone'
        }
      },
      {
        name: 'cellularWalls',
        intensity: 0.4,
        role: 'refinement',
        options: {
          preset: 'crypt',
          iterations: 2
        }
      }
    ],
    constraints: getConstraints('rooms'),
    coverStrategy: 'symmetric',
    styleProfile: 'structured',
    baseTerrain: 'rock',
    description: 'Classic dungeon with rectangular rooms'
  },

  /**
   * Crypt - Gothic chambers with narrow passages
   * Good for: Horror atmosphere, undead encounters
   */
  crypt: {
    name: 'crypt',
    displayName: 'Crypt',
    algorithms: [
      {
        name: 'cryptWalls',
        intensity: 0.9,
        role: 'macro',
        options: {
          preset: 'crypt',
          wallTerrain: 'rock',
          floorTerrain: 'stone',
          initialFill: 0.42,
          iterations: 5
        }
      },
      {
        name: 'burialChambers',
        intensity: 0.7,
        role: 'structure',
        options: {
          preset: 'dungeon',
          floorTerrain: 'stone',
          roomCount: 3,
          minRoomSize: 5,
          maxRoomSize: 9,
          roomShape: 'rectangle'
        }
      },
      {
        name: 'cryptPaths',
        intensity: 0.6,
        role: 'structure',
        options: {
          pathStyle: 'direct',
          pathCount: 2,
          pathWidth: 2,
          floorTerrain: 'stone'
        }
      }
    ],
    constraints: getConstraints('corridor', { maxDeadEnds: 4 }),
    coverStrategy: 'staggered',
    styleProfile: 'structured',
    baseTerrain: 'rock',
    description: 'Gothic crypt with burial chambers'
  },

  // --------------------------------------------------------------------------
  // ARENA ARCHETYPES
  // --------------------------------------------------------------------------

  /**
   * Arena - Central fighting pit with spectator areas
   * Good for: Gladiatorial combat, boss fights
   */
  arena: {
    name: 'arena',
    displayName: 'Arena',
    algorithms: [
      {
        name: 'arenaRoom',
        intensity: 1.0,
        role: 'macro',
        options: {
          preset: 'arena',
          floorTerrain: 'stone',
          roomCount: 1,
          minRoomSize: 16,
          maxRoomSize: 20
        }
      },
      {
        name: 'arenaCover',
        intensity: 0.5,
        role: 'detail',
        options: {
          preset: 'rockFormation',
          clusterCount: 4,
          clusterSize: 2,
          avoidCenter: true
        }
      }
    ],
    constraints: getConstraints('arena', { minApproachPaths: 4 }),
    coverStrategy: 'symmetric',
    styleProfile: 'clean',
    baseTerrain: 'stone',
    description: 'Open arena for gladiatorial combat'
  },

  // --------------------------------------------------------------------------
  // BRIDGE/CROSSING ARCHETYPES
  // --------------------------------------------------------------------------

  /**
   * Bridge Crossing - Linear path over hazard terrain
   * Good for: Defensive battles, chokepoint combat
   */
  bridgeCrossing: {
    name: 'bridgeCrossing',
    displayName: 'Bridge Crossing',
    algorithms: [
      {
        name: 'waterBase',
        intensity: 1.0,
        role: 'macro',
        options: {
          scale: 0.05,
          octaves: 2,
          persistence: 0.3,
          thresholds: { water: -1.0 }
        }
      },
      {
        name: 'bridgePath',
        intensity: 1.0,
        role: 'structure',
        options: {
          pathStyle: 'direct',
          pathCount: 1,
          pathWidth: 4,
          floorTerrain: 'stone',
          endpoints: [
            { start: { xRatio: 0.1, yRatio: 0.5 }, end: { xRatio: 0.9, yRatio: 0.5 } }
          ]
        }
      },
      {
        name: 'landingPads',
        intensity: 0.8,
        role: 'structure',
        options: {
          preset: 'arena',
          floorTerrain: 'stone',
          roomCount: 2,
          minRoomSize: 6,
          maxRoomSize: 8,
          roomShape: 'rectangle'
        }
      }
    ],
    constraints: getConstraints('bridge'),
    coverStrategy: 'defensive',
    styleProfile: 'structured',
    baseTerrain: 'water',
    description: 'Stone bridge over water hazard'
  },

  /**
   * Mountain Pass - Narrow path between cliff walls
   * Good for: Ambushes, elevation-based combat
   */
  mountainPass: {
    name: 'mountainPass',
    displayName: 'Mountain Pass',
    algorithms: [
      {
        name: 'cliffWalls',
        intensity: 0.9,
        role: 'macro',
        options: {
          scale: 0.12,
          octaves: 4,
          persistence: 0.6,
          thresholds: { cliff: 0.5, rock: 0.2, stone: -0.2, grass: -1.0 }
        }
      },
      {
        name: 'passPath',
        intensity: 0.85,
        role: 'structure',
        options: {
          pathStyle: 'bezier',
          pathCount: 1,
          pathWidth: 4,
          wanderStrength: 0.3,
          floorTerrain: 'stone'
        }
      },
      {
        name: 'restAreas',
        intensity: 0.5,
        role: 'structure',
        options: {
          preset: 'cave',
          floorTerrain: 'stone',
          roomCount: 2,
          minRoomSize: 5,
          maxRoomSize: 8
        }
      }
    ],
    constraints: getConstraints('corridor', { minPassableWidth: 3 }),
    coverStrategy: 'staggered',
    styleProfile: 'natural',
    baseTerrain: 'stone',
    description: 'Narrow mountain pass between cliff walls'
  },

  // --------------------------------------------------------------------------
  // SPECIAL ARCHETYPES
  // --------------------------------------------------------------------------

  /**
   * Ruined Castle - Crumbling structure with overgrowth
   * Good for: Exploration combat, varied terrain
   */
  ruinedCastle: {
    name: 'ruinedCastle',
    displayName: 'Ruined Castle',
    algorithms: [
      {
        name: 'ruinBase',
        intensity: 0.6,
        role: 'macro',
        options: {
          scale: 0.09,
          octaves: 4,
          persistence: 0.5,
          thresholds: { rock: 0.6, stone: 0.2, grass: -1.0 }
        }
      },
      {
        name: 'ruinedRooms',
        intensity: 0.7,
        role: 'structure',
        options: {
          preset: 'ruins',
          floorTerrain: 'stone',
          roomCount: 4,
          minRoomSize: 5,
          maxRoomSize: 10,
          roomShape: 'irregular'
        }
      },
      {
        name: 'overgrowth',
        intensity: 0.4,
        role: 'detail',
        options: {
          preset: 'treeGrove',
          featureTerrain: 'forest',
          clusterCount: 3,
          clusterSize: 4
        }
      },
      {
        name: 'rubble',
        intensity: 0.5,
        role: 'detail',
        options: {
          preset: 'rockFormation',
          clusterCount: 4,
          clusterSize: 3
        }
      }
    ],
    constraints: getConstraints('rooms', { maxDeadEnds: 5 }),
    coverStrategy: 'scattered',
    styleProfile: 'organic',
    baseTerrain: 'stone',
    description: 'Crumbling castle walls with nature reclaiming'
  },

  /**
   * Swamp - Difficult terrain with water hazards
   * Good for: Movement-restricted combat, terrain hazards
   */
  swamp: {
    name: 'swamp',
    displayName: 'Swamp',
    algorithms: [
      {
        name: 'swampTerrain',
        intensity: 0.7,
        role: 'macro',
        options: {
          scale: 0.08,
          octaves: 4,
          persistence: 0.55,
          thresholds: { water: 0.5, forest: 0.2, grass: -0.3 }
        }
      },
      {
        name: 'dryPaths',
        intensity: 0.6,
        role: 'structure',
        options: {
          pathStyle: 'drunkard',
          pathCount: 2,
          pathWidth: 2,
          wanderStrength: 0.4,
          floorTerrain: 'grass'
        }
      },
      {
        name: 'treeGroves',
        intensity: 0.5,
        role: 'detail',
        options: {
          preset: 'denseForest',
          clusterCount: 3,
          clusterSize: 5
        }
      }
    ],
    constraints: getConstraints('balanced', { minWalkableRatio: 0.4 }),
    coverStrategy: 'scattered',
    styleProfile: 'natural',
    baseTerrain: 'grass',
    description: 'Treacherous swamp with water hazards'
  },

  /**
   * Volcano - Lava hazards with rock platforms
   * Good for: High-risk combat, environmental hazards
   */
  volcano: {
    name: 'volcano',
    displayName: 'Volcanic Crater',
    algorithms: [
      {
        name: 'lavaTerrain',
        intensity: 0.8,
        role: 'macro',
        options: {
          scale: 0.1,
          octaves: 3,
          persistence: 0.5,
          thresholds: { lava: 0.4, rock: 0.0, stone: -0.3 }
        }
      },
      {
        name: 'stonePaths',
        intensity: 0.7,
        role: 'structure',
        options: {
          pathStyle: 'drunkard',
          pathCount: 2,
          pathWidth: 3,
          wanderStrength: 0.2,
          floorTerrain: 'stone'
        }
      },
      {
        name: 'stonePlatforms',
        intensity: 0.6,
        role: 'structure',
        options: {
          preset: 'arena',
          floorTerrain: 'stone',
          roomCount: 3,
          minRoomSize: 5,
          maxRoomSize: 8
        }
      }
    ],
    constraints: getConstraints('balanced', { minWalkableRatio: 0.35 }),
    coverStrategy: 'defensive',
    styleProfile: 'natural',
    baseTerrain: 'lava',
    description: 'Volcanic crater with lava hazards'
  }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get an archetype by name
 *
 * @param {string} name - Archetype name
 * @returns {Object|null} Archetype definition or null
 */
export function getArchetype(name) {
  return ARCHETYPES[name] || null;
}

/**
 * Get all archetype names
 *
 * @returns {string[]} Array of archetype names
 */
export function getArchetypeNames() {
  return Object.keys(ARCHETYPES);
}

/**
 * Get archetypes by cover strategy
 *
 * @param {string} strategy - Cover strategy name
 * @returns {Object[]} Array of matching archetypes
 */
export function getArchetypesByCoverStrategy(strategy) {
  return Object.values(ARCHETYPES).filter(arch => arch.coverStrategy === strategy);
}

/**
 * Get archetypes by base terrain
 *
 * @param {string} terrain - Base terrain type
 * @returns {Object[]} Array of matching archetypes
 */
export function getArchetypesByBaseTerrain(terrain) {
  return Object.values(ARCHETYPES).filter(arch => arch.baseTerrain === terrain);
}

/**
 * Validate archetype definition structure
 *
 * @param {Object} archetype - Archetype to validate
 * @returns {{valid: boolean, errors: string[]}} Validation result
 */
export function validateArchetypeDefinition(archetype) {
  const errors = [];

  if (!archetype.name) errors.push('Missing name');
  if (!archetype.algorithms || archetype.algorithms.length === 0) {
    errors.push('Must have at least one algorithm');
  }
  if (!archetype.constraints) errors.push('Missing constraints');
  if (!archetype.baseTerrain) errors.push('Missing baseTerrain');

  // Validate algorithms have required fields
  if (archetype.algorithms) {
    archetype.algorithms.forEach((alg, i) => {
      if (!alg.name) errors.push(`Algorithm ${i}: missing name`);
      if (alg.intensity === undefined) errors.push(`Algorithm ${i}: missing intensity`);
      if (!alg.role) errors.push(`Algorithm ${i}: missing role`);
    });

    // Check for macro algorithm
    const hasMacro = archetype.algorithms.some(a => a.role === 'macro');
    if (!hasMacro) errors.push('Should have at least one macro role algorithm');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export default ARCHETYPES;
