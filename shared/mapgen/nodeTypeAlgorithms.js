/**
 * Node Type Algorithm Configurations
 *
 * Defines algorithm pools and obstacle rules for each node/biome type in the
 * battle map system. This is the configuration layer that maps node types to
 * their procedural generation algorithms.
 *
 * Each node type defines:
 * - baseTerrain: Default terrain type for uncovered areas
 * - algorithmPool: Array of algorithm configurations to apply in order
 * - obstacleRules: What obstacles can spawn on which terrain types
 *
 * Algorithm pool entries have:
 * - name: Unique identifier for debugging/logging
 * - algorithm: Class name from algorithms/ directory
 * - priority: Application order (lower = earlier)
 * - required: If true, always included; if false, may be skipped
 * - options: Algorithm-specific configuration
 *
 * CRITICAL: Algorithm order matters for terrain layering. Lower priority
 * algorithms apply first, creating base terrain that higher priority
 * algorithms can modify or carve into.
 */

// ============================================================================
// BASE NODE TYPE CONFIGURATIONS
// ============================================================================

/**
 * Core node type configurations for standard battle map biomes
 */
export const NODE_TYPE_CONFIGS = {
  /**
   * Forest - Natural woodland with clearings and trails
   * Base: Grass with forest patches, rock outcrops
   * Features: Tree groves, clearings, natural paths
   */
  forest: {
    baseTerrain: 'grass',
    algorithmPool: [
      {
        name: 'perlinTerrain',
        algorithm: 'PerlinNoise',
        priority: 1,
        required: true,
        options: {
          scale: 0.08,
          octaves: 4,
          persistence: 0.5,
          thresholds: {
            rock: 0.7,     // High noise = rock outcrops
            forest: 0.3,   // Medium noise = dense forest terrain
            grass: -1.0    // Low noise = open grass
          }
        }
      },
      {
        name: 'forestClearing',
        algorithm: 'RoomCarver',
        priority: 2,
        required: false,
        options: {
          preset: 'cave',
          floorTerrain: 'grass',
          roomCount: 2,
          minRoomSize: 6,
          maxRoomSize: 12,
          roomShape: 'oval',
          padding: 3
        }
      },
      {
        name: 'forestTrail',
        algorithm: 'PathCarver',
        priority: 3,
        required: false,
        options: {
          pathWidth: 2,
          pathCount: 1,
          wanderStrength: 0.4,
          floorTerrain: 'grass',
          pathStyle: 'drunkard'
        }
      },
      {
        name: 'treeGroves',
        algorithm: 'ClusterPlacer',
        priority: 4,
        required: false,
        options: {
          preset: 'treeGrove',
          featureTerrain: 'tree',
          clusterCount: 3,
          clusterSize: 6,
          clusterSpread: 2,
          shape: 'randomWalk'
        }
      }
    ],
    obstacleRules: {
      tree: { onTerrain: ['grass', 'forest'], chance: 0.15, variants: ['oak_tree', 'pine_tree'] },
      rock: { onTerrain: ['rock'], chance: 0.8, variants: ['rock_small', 'rock_medium', 'rock_large'] }
    }
  },

  /**
   * Cave - Underground caverns with chambers and tunnels
   * Base: Stone floors with rock walls
   * Features: Organic cave chambers, tunnels, crystal/pool clusters
   */
  cave: {
    baseTerrain: 'stone',
    algorithmPool: [
      {
        name: 'caveChambers',
        algorithm: 'CellularAutomata',
        priority: 1,
        required: true,
        options: {
          preset: 'cave',
          wallTerrain: 'rock',
          floorTerrain: 'stone',
          initialFill: 0.45,
          iterations: 4
        }
      },
      {
        name: 'largeChamber',
        algorithm: 'RoomCarver',
        priority: 2,
        required: false,
        options: {
          preset: 'cave',
          floorTerrain: 'stone',
          roomCount: 2,
          minRoomSize: 8,
          maxRoomSize: 14,
          roomShape: 'oval',
          padding: 3
        }
      },
      {
        name: 'tunnelNetwork',
        algorithm: 'PathCarver',
        priority: 3,
        required: false,
        options: {
          pathWidth: 3,
          pathCount: 2,
          wanderStrength: 0.25,
          floorTerrain: 'stone',
          pathStyle: 'drunkard'
        }
      },
      {
        name: 'crystalClusters',
        algorithm: 'ClusterPlacer',
        priority: 4,
        required: false,
        options: {
          featureTerrain: 'water',  // Crystals represented as water pools
          clusterCount: 2,
          clusterSize: 4,
          clusterSpread: 2,
          shape: 'gaussian'
        }
      }
    ],
    obstacleRules: {
      rock: { onTerrain: ['rock'], chance: 0.9, variants: ['rock_medium', 'rock_large', 'stalagmite'] },
      crystal: { onTerrain: ['stone'], chance: 0.03, variants: ['cave_crystals', 'stalagmite'] }
    }
  },

  /**
   * Mountain - Rocky highlands with sparse vegetation
   * Base: Stone with rock formations and grass patches
   * Features: Rocky outcrops, mountain passes, scattered rocks
   */
  mountain: {
    baseTerrain: 'stone',
    algorithmPool: [
      {
        name: 'rockyTerrain',
        algorithm: 'PerlinNoise',
        priority: 1,
        required: true,
        options: {
          scale: 0.12,
          octaves: 5,
          persistence: 0.6,
          thresholds: {
            cliff: 0.75,   // Highest areas = impassable cliffs
            rock: 0.4,     // Mid-high = rock terrain
            stone: 0.1,    // Mid = stone floor
            grass: -1.0    // Low = grass patches in valleys
          }
        }
      },
      {
        name: 'mountainPass',
        algorithm: 'PathCarver',
        priority: 2,
        required: false,
        options: {
          pathWidth: 3,
          pathCount: 1,
          wanderStrength: 0.2,
          floorTerrain: 'stone',
          pathStyle: 'bezier'
        }
      },
      {
        name: 'rockFormations',
        algorithm: 'ClusterPlacer',
        priority: 3,
        required: false,
        options: {
          preset: 'rockFormation',
          featureTerrain: 'rock',
          clusterCount: 4,
          clusterSize: 4,
          clusterSpread: 2,
          shape: 'randomWalk'
        }
      }
    ],
    obstacleRules: {
      rock: { onTerrain: ['rock', 'cliff'], chance: 0.85, variants: ['rock_large', 'mountain_boulder'] },
      smallRock: { onTerrain: ['stone'], chance: 0.1, variants: ['rock_small', 'rock_medium'] }
    }
  },

  /**
   * Bridge - River crossing with limited terrain
   * Base: Stone bridge over water
   * Features: River flowing through, bridge structure
   */
  bridge: {
    baseTerrain: 'water',
    algorithmPool: [
      {
        name: 'riverChannel',
        algorithm: 'PathCarver',
        priority: 1,
        required: true,
        options: {
          pathWidth: 8,
          pathCount: 1,
          wanderStrength: 0.15,
          floorTerrain: 'water',
          pathStyle: 'bezier',
          // River flows top-to-bottom
          endpoints: [
            { start: { x: 16, y: 0 }, end: { x: 16, y: 31 } }
          ]
        }
      },
      {
        name: 'bridgePlatform',
        algorithm: 'RoomCarver',
        priority: 2,
        required: true,
        options: {
          floorTerrain: 'stone',
          roomCount: 1,
          minRoomSize: 6,
          maxRoomSize: 10,
          roomShape: 'rectangle',
          padding: 2
        }
      }
    ],
    obstacleRules: {
      // Bridge has minimal obstacles - mostly open for tactical combat
    }
  },

  /**
   * Castle - Structured stone rooms and corridors
   * Base: Stone floors with room layouts
   * Features: Rectangular rooms, corridors connecting them
   */
  castle: {
    baseTerrain: 'stone',
    algorithmPool: [
      {
        name: 'stoneRooms',
        algorithm: 'RoomCarver',
        priority: 1,
        required: true,
        options: {
          preset: 'dungeon',
          floorTerrain: 'stone',
          roomCount: 4,
          minRoomSize: 6,
          maxRoomSize: 12,
          roomShape: 'rectangle',
          padding: 2
        }
      },
      {
        name: 'corridors',
        algorithm: 'PathCarver',
        priority: 2,
        required: true,
        options: {
          pathWidth: 3,
          pathCount: 3,
          wanderStrength: 0.05,
          floorTerrain: 'stone',
          pathStyle: 'direct'
        }
      }
    ],
    obstacleRules: {
      pillar: { onTerrain: ['stone'], chance: 0.02, variants: ['stone_ruins', 'pillar'] }
    }
  }
};

// ============================================================================
// RACE SUBTYPE CONFIGURATIONS
// ============================================================================

/**
 * Race-specific subtype configurations that extend base node types
 * with thematic variations for enemy encounters by race
 */
export const RACE_SUBTYPE_CONFIGS = {
  /**
   * Elven Grove - Sacred woodland with symmetrical glades
   * Extends: forest
   * Features: Moonwells, ancient trees, flower rings
   */
  elven_grove: {
    extends: 'forest',
    baseTerrain: 'grass',
    algorithmPool: [
      {
        name: 'groveBase',
        algorithm: 'PerlinNoise',
        priority: 1,
        required: true,
        options: {
          scale: 0.06,
          octaves: 3,
          persistence: 0.4,
          thresholds: {
            forest: 0.5,   // More forest density
            grass: -1.0
          }
        }
      },
      {
        name: 'symmetricalGlade',
        algorithm: 'RoomCarver',
        priority: 2,
        required: true,
        options: {
          floorTerrain: 'grass',
          roomCount: 1,
          minRoomSize: 10,
          maxRoomSize: 14,
          roomShape: 'oval',  // Central clearing
          padding: 4
        }
      },
      {
        name: 'moonwell',
        algorithm: 'ClusterPlacer',
        priority: 3,
        required: true,
        options: {
          featureTerrain: 'water',
          clusterCount: 1,
          clusterSize: 5,
          clusterSpread: 1,
          shape: 'gaussian',
          avoidEdges: 10  // Center the moonwell
        }
      },
      {
        name: 'ancientTrees',
        algorithm: 'ClusterPlacer',
        priority: 4,
        required: false,
        options: {
          featureTerrain: 'tree',
          clusterCount: 4,
          clusterSize: 3,
          clusterSpread: 1,
          shape: 'gaussian'
        }
      }
    ],
    thematicFeatures: ['moonwell', 'ancient_tree', 'flower_ring'],
    obstacleRules: {
      tree: { onTerrain: ['grass', 'forest'], chance: 0.12, variants: ['ancient_tree', 'silver_birch'] }
    }
  },

  /**
   * Dwarven Mine - Underground mining complex with grid rooms
   * Extends: cave
   * Features: BSP grid layout, mine shafts, ore veins
   */
  dwarven_mine: {
    extends: 'cave',
    baseTerrain: 'stone',
    algorithmPool: [
      {
        name: 'mineShafts',
        algorithm: 'CellularAutomata',
        priority: 1,
        required: true,
        options: {
          preset: 'sparse',
          wallTerrain: 'rock',
          floorTerrain: 'stone',
          initialFill: 0.35,
          iterations: 3
        }
      },
      {
        name: 'gridRooms',
        algorithm: 'RoomCarver',
        priority: 2,
        required: true,
        options: {
          preset: 'dungeon',
          floorTerrain: 'stone',
          roomCount: 5,
          minRoomSize: 5,
          maxRoomSize: 9,
          roomShape: 'rectangle',
          padding: 2
        }
      },
      {
        name: 'mineCorridors',
        algorithm: 'PathCarver',
        priority: 3,
        required: true,
        options: {
          pathWidth: 2,
          pathCount: 4,
          wanderStrength: 0.0,  // Straight mine tunnels
          floorTerrain: 'stone',
          pathStyle: 'direct'
        }
      },
      {
        name: 'oreVeins',
        algorithm: 'ClusterPlacer',
        priority: 4,
        required: false,
        options: {
          featureTerrain: 'rock',  // Ore represented as rock clusters
          clusterCount: 3,
          clusterSize: 4,
          clusterSpread: 1,
          shape: 'elongated'
        }
      }
    ],
    thematicFeatures: ['mine_cart_track', 'ore_vein', 'support_beam'],
    obstacleRules: {
      rock: { onTerrain: ['rock'], chance: 0.7, variants: ['ore_vein', 'rock_medium'] },
      minecart: { onTerrain: ['stone'], chance: 0.02, variants: ['mine_cart', 'support_beam'] }
    }
  },

  /**
   * Vampiric Crypt - Gothic underground with coffin rows
   * Extends: cave
   * Features: Gothic corridors, coffin chambers, blood pools
   */
  vampiric_crypt: {
    extends: 'cave',
    baseTerrain: 'stone',
    algorithmPool: [
      {
        name: 'cryptWalls',
        algorithm: 'CellularAutomata',
        priority: 1,
        required: true,
        options: {
          preset: 'crypt',
          wallTerrain: 'rock',
          floorTerrain: 'stone',
          initialFill: 0.40,
          iterations: 5
        }
      },
      {
        name: 'gothicCorridors',
        algorithm: 'PathCarver',
        priority: 2,
        required: true,
        options: {
          pathWidth: 3,
          pathCount: 2,
          wanderStrength: 0.1,
          floorTerrain: 'stone',
          pathStyle: 'direct'
        }
      },
      {
        name: 'coffinChamber',
        algorithm: 'RoomCarver',
        priority: 3,
        required: true,
        options: {
          floorTerrain: 'stone',
          roomCount: 2,
          minRoomSize: 6,
          maxRoomSize: 10,
          roomShape: 'rectangle',
          padding: 3
        }
      },
      {
        name: 'bloodPools',
        algorithm: 'ClusterPlacer',
        priority: 4,
        required: false,
        options: {
          featureTerrain: 'lava',  // Blood pools use lava terrain for red coloring
          clusterCount: 2,
          clusterSize: 4,
          clusterSpread: 2,
          shape: 'gaussian'
        }
      }
    ],
    thematicFeatures: ['coffin', 'blood_pool', 'gothic_pillar', 'candelabra'],
    obstacleRules: {
      rock: { onTerrain: ['rock'], chance: 0.8, variants: ['gothic_pillar', 'tomb_wall'] },
      coffin: { onTerrain: ['stone'], chance: 0.04, variants: ['coffin', 'sarcophagus'] }
    }
  },

  /**
   * Orcish Warcamp - Military encampment with palisades
   * Extends: mountain
   * Features: Camp layout, palisade walls, firepits
   */
  orcish_warcamp: {
    extends: 'mountain',
    baseTerrain: 'grass',
    algorithmPool: [
      {
        name: 'campGround',
        algorithm: 'PerlinNoise',
        priority: 1,
        required: true,
        options: {
          scale: 0.1,
          octaves: 3,
          persistence: 0.4,
          thresholds: {
            rock: 0.8,     // Some rocky areas
            stone: 0.4,    // Trampled ground
            grass: -1.0    // Base grass
          }
        }
      },
      {
        name: 'campTents',
        algorithm: 'RoomCarver',
        priority: 2,
        required: true,
        options: {
          preset: 'ruins',
          floorTerrain: 'stone',  // Trampled tent floors
          roomCount: 4,
          minRoomSize: 4,
          maxRoomSize: 8,
          roomShape: 'irregular',
          padding: 2
        }
      },
      {
        name: 'campPaths',
        algorithm: 'PathCarver',
        priority: 3,
        required: false,
        options: {
          pathWidth: 2,
          pathCount: 2,
          wanderStrength: 0.15,
          floorTerrain: 'stone',
          pathStyle: 'drunkard'
        }
      },
      {
        name: 'palisadeWall',
        algorithm: 'ClusterPlacer',
        priority: 4,
        required: false,
        options: {
          featureTerrain: 'rock',  // Palisade as rock terrain
          clusterCount: 2,
          clusterSize: 8,
          clusterSpread: 1,
          shape: 'elongated'
        }
      }
    ],
    thematicFeatures: ['war_tent', 'palisade', 'firepit', 'weapon_rack'],
    obstacleRules: {
      palisade: { onTerrain: ['grass'], chance: 0.06, variants: ['palisade_wall', 'spike_barrier'] },
      campfire: { onTerrain: ['stone'], chance: 0.03, variants: ['firepit', 'cooking_pot'] }
    }
  },

  /**
   * Human Ruins - Crumbled civilization with overgrowth
   * Extends: castle
   * Features: Ruined walls, rubble, vegetation reclaiming stone
   */
  human_ruins: {
    extends: 'castle',
    baseTerrain: 'stone',
    algorithmPool: [
      {
        name: 'ruinBase',
        algorithm: 'PerlinNoise',
        priority: 1,
        required: true,
        options: {
          scale: 0.09,
          octaves: 4,
          persistence: 0.5,
          thresholds: {
            rock: 0.6,     // Rubble piles
            stone: 0.2,    // Remaining floor
            grass: -1.0    // Overgrowth
          }
        }
      },
      {
        name: 'ruinedRooms',
        algorithm: 'RoomCarver',
        priority: 2,
        required: true,
        options: {
          preset: 'ruins',
          floorTerrain: 'stone',
          roomCount: 3,
          minRoomSize: 5,
          maxRoomSize: 10,
          roomShape: 'irregular',  // Crumbled edges
          padding: 2
        }
      },
      {
        name: 'overgrowth',
        algorithm: 'ClusterPlacer',
        priority: 3,
        required: false,
        options: {
          featureTerrain: 'forest',
          clusterCount: 3,
          clusterSize: 5,
          clusterSpread: 2,
          shape: 'randomWalk'
        }
      },
      {
        name: 'rubblePiles',
        algorithm: 'ClusterPlacer',
        priority: 4,
        required: false,
        options: {
          featureTerrain: 'rock',
          clusterCount: 4,
          clusterSize: 3,
          clusterSpread: 1,
          shape: 'gaussian'
        }
      }
    ],
    thematicFeatures: ['ruined_wall', 'rubble', 'overgrown_pillar', 'broken_statue'],
    obstacleRules: {
      rock: { onTerrain: ['rock'], chance: 0.75, variants: ['rubble', 'fallen_pillar', 'broken_wall'] },
      tree: { onTerrain: ['grass', 'forest'], chance: 0.1, variants: ['overgrown_tree', 'vine_tree'] }
    }
  }
};

// ============================================================================
// ALGORITHM CLASS MAPPING
// ============================================================================

/**
 * Maps algorithm names to their dynamic import functions.
 * Uses dynamic imports to support code splitting and lazy loading.
 *
 * Usage:
 *   const AlgorithmClass = await ALGORITHM_CLASSES.PerlinNoise();
 *   const algorithm = new AlgorithmClass.PerlinNoiseAlgorithm(options);
 */
export const ALGORITHM_CLASSES = {
  PerlinNoise: () => import('./algorithms/PerlinNoise.js'),
  CellularAutomata: () => import('./algorithms/CellularAutomata.js'),
  RoomCarver: () => import('./algorithms/RoomCarver.js'),
  PathCarver: () => import('./algorithms/PathCarver.js'),
  ClusterPlacer: () => import('./algorithms/ClusterPlacer.js')
};

/**
 * Maps algorithm names to their default export class names.
 * Used when extracting the class from a dynamic import.
 */
export const ALGORITHM_CLASS_NAMES = {
  PerlinNoise: 'PerlinNoiseAlgorithm',
  CellularAutomata: 'CellularAutomataAlgorithm',
  RoomCarver: 'RoomCarverAlgorithm',
  PathCarver: 'PathCarverAlgorithm',
  ClusterPlacer: 'ClusterPlacerAlgorithm'
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Deep merge two configuration objects.
 * Arrays are replaced, not concatenated.
 * Objects are recursively merged.
 *
 * @param {Object} base - Base configuration to merge into
 * @param {Object} override - Override configuration (takes precedence)
 * @returns {Object} Merged configuration
 */
export function mergeConfigs(base, override) {
  if (!override) return { ...base };
  if (!base) return { ...override };

  const result = { ...base };

  for (const key of Object.keys(override)) {
    const baseValue = base[key];
    const overrideValue = override[key];

    if (overrideValue === undefined) {
      continue;
    }

    if (Array.isArray(overrideValue)) {
      // Arrays replace entirely
      result[key] = [...overrideValue];
    } else if (overrideValue && typeof overrideValue === 'object' && !Array.isArray(overrideValue)) {
      // Objects merge recursively
      result[key] = mergeConfigs(baseValue || {}, overrideValue);
    } else {
      // Primitives replace
      result[key] = overrideValue;
    }
  }

  return result;
}

/**
 * Get the configuration for a node type, handling inheritance.
 *
 * For base node types (forest, cave, etc.), returns the config directly.
 * For race subtypes (elven_grove, etc.), merges with the extended base type.
 *
 * @param {string} nodeType - Node type identifier (e.g., 'forest', 'elven_grove')
 * @returns {Object|null} Complete node configuration or null if not found
 */
export function getNodeConfig(nodeType) {
  // Check base node types first
  if (NODE_TYPE_CONFIGS[nodeType]) {
    return { ...NODE_TYPE_CONFIGS[nodeType] };
  }

  // Check race subtypes
  if (RACE_SUBTYPE_CONFIGS[nodeType]) {
    const subtypeConfig = RACE_SUBTYPE_CONFIGS[nodeType];

    // If it extends a base type, merge configs
    if (subtypeConfig.extends) {
      const baseConfig = NODE_TYPE_CONFIGS[subtypeConfig.extends];
      if (!baseConfig) {
        console.warn(`Race subtype '${nodeType}' extends unknown base type '${subtypeConfig.extends}'`);
        return { ...subtypeConfig };
      }

      // Merge base config with subtype overrides
      // Subtype algorithmPool completely replaces base algorithmPool
      // obstacleRules are merged
      return {
        ...baseConfig,
        ...subtypeConfig,
        obstacleRules: mergeConfigs(baseConfig.obstacleRules, subtypeConfig.obstacleRules)
      };
    }

    return { ...subtypeConfig };
  }

  // Default to forest if unknown
  console.warn(`Unknown node type '${nodeType}', defaulting to forest`);
  return { ...NODE_TYPE_CONFIGS.forest };
}

/**
 * Get the algorithm class for a given algorithm name.
 * Returns a promise that resolves to the module containing the algorithm class.
 *
 * @param {string} algorithmName - Algorithm name (e.g., 'PerlinNoise')
 * @returns {Promise<Object>} Promise resolving to the algorithm module
 * @throws {Error} If algorithm name is not found
 */
export async function getAlgorithmClass(algorithmName) {
  const loader = ALGORITHM_CLASSES[algorithmName];
  if (!loader) {
    throw new Error(`Unknown algorithm: ${algorithmName}`);
  }
  return await loader();
}

/**
 * Get an instantiated algorithm from a pool entry.
 *
 * @param {Object} poolEntry - Algorithm pool entry with name, algorithm, options
 * @returns {Promise<Object>} Promise resolving to instantiated algorithm
 */
export async function instantiateAlgorithm(poolEntry) {
  const module = await getAlgorithmClass(poolEntry.algorithm);
  const className = ALGORITHM_CLASS_NAMES[poolEntry.algorithm];
  const AlgorithmClass = module[className] || module.default;

  if (!AlgorithmClass) {
    throw new Error(`Could not find class for algorithm: ${poolEntry.algorithm}`);
  }

  return new AlgorithmClass(poolEntry.options || {});
}

/**
 * Get all required algorithms from a node config.
 * Returns algorithms sorted by priority.
 *
 * @param {Object} config - Node configuration object
 * @returns {Object[]} Array of required algorithm pool entries sorted by priority
 */
export function getRequiredAlgorithms(config) {
  if (!config || !config.algorithmPool) {
    return [];
  }

  return config.algorithmPool
    .filter(entry => entry.required === true)
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Get all optional algorithms from a node config.
 * Returns algorithms sorted by priority.
 *
 * @param {Object} config - Node configuration object
 * @returns {Object[]} Array of optional algorithm pool entries sorted by priority
 */
export function getOptionalAlgorithms(config) {
  if (!config || !config.algorithmPool) {
    return [];
  }

  return config.algorithmPool
    .filter(entry => entry.required !== true)
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Select which optional algorithms to include based on a seeded random function.
 * Each optional algorithm has a 50% base chance of being included.
 *
 * @param {Object} config - Node configuration object
 * @param {function} random - Seeded random function returning 0-1
 * @param {number} inclusionChance - Probability for each optional algorithm (default 0.5)
 * @returns {Object[]} Array of selected optional algorithm pool entries
 */
export function selectOptionalAlgorithms(config, random, inclusionChance = 0.5) {
  const optionals = getOptionalAlgorithms(config);

  return optionals.filter(() => random() < inclusionChance);
}

/**
 * Get the full algorithm sequence for a node type.
 * Combines required algorithms with randomly selected optionals.
 *
 * @param {string} nodeType - Node type identifier
 * @param {function} random - Seeded random function
 * @param {number} optionalChance - Inclusion probability for optionals (default 0.5)
 * @returns {Object[]} Sorted array of algorithm pool entries to apply
 */
export function getAlgorithmSequence(nodeType, random, optionalChance = 0.5) {
  const config = getNodeConfig(nodeType);
  if (!config) {
    return [];
  }

  const required = getRequiredAlgorithms(config);
  const selected = selectOptionalAlgorithms(config, random, optionalChance);

  // Combine and sort by priority
  return [...required, ...selected].sort((a, b) => a.priority - b.priority);
}

/**
 * Get obstacle rules for a terrain type within a node config.
 *
 * @param {Object} config - Node configuration object
 * @param {string} terrain - Terrain type to check
 * @returns {Object[]} Array of applicable obstacle rules for this terrain
 */
export function getObstacleRulesForTerrain(config, terrain) {
  if (!config || !config.obstacleRules) {
    return [];
  }

  const applicable = [];

  for (const [obstacleType, rule] of Object.entries(config.obstacleRules)) {
    if (rule.onTerrain && rule.onTerrain.includes(terrain)) {
      applicable.push({
        type: obstacleType,
        ...rule
      });
    }
  }

  return applicable;
}

/**
 * Get all supported node types (base + race subtypes).
 *
 * @returns {string[]} Array of all node type identifiers
 */
export function getAllNodeTypes() {
  return [
    ...Object.keys(NODE_TYPE_CONFIGS),
    ...Object.keys(RACE_SUBTYPE_CONFIGS)
  ];
}

/**
 * Check if a node type is a race subtype.
 *
 * @param {string} nodeType - Node type identifier
 * @returns {boolean} True if this is a race subtype
 */
export function isRaceSubtype(nodeType) {
  return nodeType in RACE_SUBTYPE_CONFIGS;
}

/**
 * Get the base node type for a given node type.
 * Returns the type itself if it's already a base type.
 *
 * @param {string} nodeType - Node type identifier
 * @returns {string} Base node type
 */
export function getBaseNodeType(nodeType) {
  if (NODE_TYPE_CONFIGS[nodeType]) {
    return nodeType;
  }

  const subtype = RACE_SUBTYPE_CONFIGS[nodeType];
  if (subtype && subtype.extends) {
    return subtype.extends;
  }

  return 'forest'; // Default fallback
}
