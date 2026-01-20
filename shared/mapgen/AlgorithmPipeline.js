/**
 * AlgorithmPipeline - Core orchestration engine for map generation algorithms
 *
 * This is the central system that coordinates algorithm selection and execution
 * for procedural battle map generation. It manages a registry of available
 * algorithms, handles random selection with configurable rates, and executes
 * selected algorithms in priority order.
 *
 * Key features:
 * - Registry-based algorithm management
 * - Seeded random algorithm selection (~50% of available algorithms)
 * - Priority-ordered execution (terrain-shaping first, details last)
 * - Intensity-based algorithm strength (0.1-0.9)
 * - Fully deterministic - same seed produces identical output
 *
 * CRITICAL: All random operations use the provided seeded random function
 * to maintain server/client sync.
 */

import { PerlinNoiseAlgorithm } from './algorithms/PerlinNoise.js';
import { CellularAutomataAlgorithm } from './algorithms/CellularAutomata.js';
import { RoomCarverAlgorithm } from './algorithms/RoomCarver.js';
import { PathCarverAlgorithm } from './algorithms/PathCarver.js';
import { ClusterPlacerAlgorithm } from './algorithms/ClusterPlacer.js';

/**
 * Algorithm categories for execution priority
 * Lower priority numbers execute first
 */
export const ALGORITHM_CATEGORIES = {
  terrain: 1,    // Base terrain shaping (perlin, cellular automata)
  structure: 2,  // Structural features (rooms, paths)
  detail: 3      // Detail placement (clusters, decorations)
};

/**
 * Default algorithm configurations
 */
export const DEFAULT_ALGORITHM_CONFIGS = {
  perlinTerrain: {
    name: 'perlinTerrain',
    class: PerlinNoiseAlgorithm,
    priority: 1,
    category: 'terrain',
    options: {
      scale: 0.1,
      octaves: 4,
      persistence: 0.5
    }
  },
  cellularCaves: {
    name: 'cellularCaves',
    class: CellularAutomataAlgorithm,
    priority: 1,
    category: 'terrain',
    options: {
      preset: 'cave'
    }
  },
  cellularCrypt: {
    name: 'cellularCrypt',
    class: CellularAutomataAlgorithm,
    priority: 1,
    category: 'terrain',
    options: {
      preset: 'crypt'
    }
  },
  dungeonRooms: {
    name: 'dungeonRooms',
    class: RoomCarverAlgorithm,
    priority: 2,
    category: 'structure',
    options: {
      preset: 'dungeon'
    }
  },
  caveRooms: {
    name: 'caveRooms',
    class: RoomCarverAlgorithm,
    priority: 2,
    category: 'structure',
    options: {
      preset: 'cave'
    }
  },
  arenaRoom: {
    name: 'arenaRoom',
    class: RoomCarverAlgorithm,
    priority: 2,
    category: 'structure',
    options: {
      preset: 'arena'
    }
  },
  drunkardPaths: {
    name: 'drunkardPaths',
    class: PathCarverAlgorithm,
    priority: 2,
    category: 'structure',
    options: {
      pathStyle: 'drunkard',
      pathCount: 2,
      wanderStrength: 0.3
    }
  },
  bezierPaths: {
    name: 'bezierPaths',
    class: PathCarverAlgorithm,
    priority: 2,
    category: 'structure',
    options: {
      pathStyle: 'bezier',
      pathCount: 2,
      wanderStrength: 0.4
    }
  },
  directCorridors: {
    name: 'directCorridors',
    class: PathCarverAlgorithm,
    priority: 2,
    category: 'structure',
    options: {
      pathStyle: 'direct',
      pathCount: 3
    }
  },
  treeGroves: {
    name: 'treeGroves',
    class: ClusterPlacerAlgorithm,
    priority: 3,
    category: 'detail',
    options: {
      preset: 'treeGrove'
    }
  },
  rockFormations: {
    name: 'rockFormations',
    class: ClusterPlacerAlgorithm,
    priority: 3,
    category: 'detail',
    options: {
      preset: 'rockFormation'
    }
  },
  waterPools: {
    name: 'waterPools',
    class: ClusterPlacerAlgorithm,
    priority: 3,
    category: 'detail',
    options: {
      preset: 'waterPool'
    }
  },
  lavaPools: {
    name: 'lavaPools',
    class: ClusterPlacerAlgorithm,
    priority: 3,
    category: 'detail',
    options: {
      preset: 'lavaPool'
    }
  },
  denseForest: {
    name: 'denseForest',
    class: ClusterPlacerAlgorithm,
    priority: 3,
    category: 'detail',
    options: {
      preset: 'denseForest'
    }
  }
};

/**
 * AlgorithmPipeline - Orchestrates map generation algorithm selection and execution
 */
export class AlgorithmPipeline {
  /**
   * Create a new algorithm pipeline
   * @param {Object} config - Optional default configuration
   * @param {Object} config.algorithms - Custom algorithm configurations to merge with defaults
   * @param {number} config.defaultSelectionRate - Default selection rate (0-1, default 0.5)
   * @param {number} config.minIntensity - Minimum algorithm intensity (default 0.1)
   * @param {number} config.maxIntensity - Maximum algorithm intensity (default 0.9)
   */
  constructor(config = {}) {
    // Algorithm registry: Map of name -> config
    this.registry = new Map();

    // Default configuration
    this.defaultSelectionRate = config.defaultSelectionRate ?? 0.5;
    this.minIntensity = config.minIntensity ?? 0.1;
    this.maxIntensity = config.maxIntensity ?? 0.9;

    // Register default algorithms
    for (const [name, algorithmConfig] of Object.entries(DEFAULT_ALGORITHM_CONFIGS)) {
      this.registerAlgorithm(name, algorithmConfig.class, {
        priority: algorithmConfig.priority,
        category: algorithmConfig.category,
        options: algorithmConfig.options
      });
    }

    // Merge custom algorithms if provided
    if (config.algorithms) {
      for (const [name, algorithmConfig] of Object.entries(config.algorithms)) {
        this.registerAlgorithm(name, algorithmConfig.class, {
          priority: algorithmConfig.priority,
          category: algorithmConfig.category,
          options: algorithmConfig.options
        });
      }
    }
  }

  /**
   * Register an algorithm in the registry
   * @param {string} name - Unique algorithm identifier
   * @param {Function} AlgorithmClass - Algorithm class constructor
   * @param {Object} config - Algorithm configuration
   * @param {number} config.priority - Execution priority (lower runs first)
   * @param {string} config.category - Algorithm category ('terrain', 'structure', 'detail')
   * @param {Object} config.options - Default options for the algorithm
   */
  registerAlgorithm(name, AlgorithmClass, config = {}) {
    const priority = config.priority ?? ALGORITHM_CATEGORIES[config.category] ?? 2;
    const category = config.category ?? 'structure';

    this.registry.set(name, {
      name,
      class: AlgorithmClass,
      priority,
      category,
      options: config.options || {}
    });
  }

  /**
   * Unregister an algorithm from the registry
   * @param {string} name - Algorithm name to remove
   * @returns {boolean} True if algorithm was removed
   */
  unregisterAlgorithm(name) {
    return this.registry.delete(name);
  }

  /**
   * Get a registered algorithm configuration
   * @param {string} name - Algorithm name
   * @returns {Object|undefined} Algorithm configuration or undefined
   */
  getAlgorithm(name) {
    return this.registry.get(name);
  }

  /**
   * Get all registered algorithm names
   * @returns {string[]} Array of algorithm names
   */
  getRegisteredAlgorithms() {
    return Array.from(this.registry.keys());
  }

  /**
   * Get algorithms by category
   * @param {string} category - Category to filter by ('terrain', 'structure', 'detail')
   * @returns {Object[]} Array of algorithm configurations in that category
   */
  getAlgorithmsByCategory(category) {
    return Array.from(this.registry.values()).filter(alg => alg.category === category);
  }

  /**
   * Randomly select algorithms from a pool
   * Each selected algorithm gets a random intensity value (0.1-0.9)
   *
   * @param {string[]} pool - Array of algorithm names to select from
   * @param {Function} random - Seeded random function returning 0-1
   * @param {number} selectionRate - Probability of selecting each algorithm (0-1, default 0.5)
   * @returns {Array<{algorithm: Object, intensity: number, options: Object}>} Selected algorithms with intensity
   */
  selectAlgorithms(pool, random, selectionRate = this.defaultSelectionRate) {
    const selected = [];

    // Filter pool to only include registered algorithms
    const validPool = pool.filter(name => this.registry.has(name));

    // Iterate through pool in consistent order for determinism
    for (const name of validPool) {
      // Random selection based on rate
      if (random() < selectionRate) {
        const algorithmConfig = this.registry.get(name);

        // Generate random intensity within configured range
        const intensity = this.minIntensity +
          random() * (this.maxIntensity - this.minIntensity);

        selected.push({
          algorithm: algorithmConfig,
          intensity,
          options: { ...algorithmConfig.options }
        });
      }
    }

    // Sort by priority (lower priority runs first)
    selected.sort((a, b) => a.algorithm.priority - b.algorithm.priority);

    return selected;
  }

  /**
   * Create initial terrain grid filled with base terrain
   * @param {number} width - Grid width in tiles
   * @param {number} height - Grid height in tiles
   * @param {string} baseTerrain - Base terrain type to fill with (default 'grass')
   * @returns {string[][]} 2D terrain grid
   */
  createInitialTerrain(width, height, baseTerrain = 'grass') {
    const terrain = [];

    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        row.push(baseTerrain);
      }
      terrain.push(row);
    }

    return terrain;
  }

  /**
   * Create initial obstacles grid (empty)
   * @param {number} width - Grid width
   * @param {number} height - Grid height
   * @returns {Object[][]} 2D obstacle grid (all null)
   */
  createInitialObstacles(width, height) {
    const obstacles = [];

    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        row.push(null);
      }
      obstacles.push(row);
    }

    return obstacles;
  }

  /**
   * Create initial tile variants grid
   * @param {number} width - Grid width
   * @param {number} height - Grid height
   * @param {Function} random - Seeded random function
   * @returns {number[][]} 2D variant grid (0-3 values)
   */
  createInitialVariants(width, height, random) {
    const variants = [];

    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        row.push(Math.floor(random() * 4));
      }
      variants.push(row);
    }

    return variants;
  }

  /**
   * Execute selected algorithms in sequence on terrain
   *
   * @param {string[][]} terrain - Terrain grid to modify (modified in place)
   * @param {Function} random - Seeded random function
   * @param {Array<{algorithm: Object, intensity: number, options: Object}>} selectedAlgorithms - Algorithms to execute
   * @param {Object} nodeConfig - Optional node-specific configuration
   * @param {string} nodeConfig.nodeType - Node/biome type
   * @param {Object} nodeConfig.bounds - Bounded region {x, y, width, height}
   * @returns {Object} Execution result with metadata
   */
  execute(terrain, random, selectedAlgorithms, nodeConfig = {}) {
    const algorithmsUsed = [];
    const width = terrain[0]?.length || 32;
    const height = terrain.length || 32;

    // Create supporting grids
    const obstacles = this.createInitialObstacles(width, height);
    const variants = this.createInitialVariants(width, height, random);

    // Execute each algorithm in priority order
    for (const selection of selectedAlgorithms) {
      const { algorithm, intensity, options } = selection;

      try {
        // Create algorithm instance with configured options
        const instance = new algorithm.class(options);

        // Prepare runtime options
        const runtimeOptions = {
          intensity,
          nodeType: nodeConfig.nodeType,
          bounds: nodeConfig.bounds || {
            x: 0,
            y: 0,
            width,
            height
          },
          ...options
        };

        // Execute the algorithm
        instance.apply(terrain, random, runtimeOptions);

        // Track which algorithms were used
        algorithmsUsed.push({
          name: algorithm.name,
          category: algorithm.category,
          intensity
        });
      } catch (error) {
        // Log error but continue with other algorithms
        console.error(`Algorithm "${algorithm.name}" failed:`, error.message);
      }
    }

    return {
      terrain,
      obstacles,
      variants,
      metadata: {
        algorithmsUsed: algorithmsUsed.map(a => a.name),
        algorithmDetails: algorithmsUsed,
        width,
        height,
        nodeType: nodeConfig.nodeType
      }
    };
  }

  /**
   * Full pipeline execution: select and execute algorithms
   * Convenience method that combines selection and execution
   *
   * @param {number} width - Map width
   * @param {number} height - Map height
   * @param {Function} random - Seeded random function
   * @param {Object} config - Pipeline configuration
   * @param {string[]} config.algorithmPool - Algorithms to potentially select from
   * @param {number} config.selectionRate - Selection probability (0-1)
   * @param {string} config.baseTerrain - Initial terrain type
   * @param {string} config.nodeType - Node/biome type
   * @param {number} config.seed - Original seed value (for metadata)
   * @returns {Object} Complete generation result
   */
  run(width, height, random, config = {}) {
    const {
      algorithmPool = this.getRegisteredAlgorithms(),
      selectionRate = this.defaultSelectionRate,
      baseTerrain = 'grass',
      nodeType = 'forest',
      seed
    } = config;

    // Create initial terrain
    const terrain = this.createInitialTerrain(width, height, baseTerrain);

    // Select algorithms
    const selectedAlgorithms = this.selectAlgorithms(algorithmPool, random, selectionRate);

    // Execute pipeline
    const result = this.execute(terrain, random, selectedAlgorithms, { nodeType });

    // Add seed to metadata if provided
    if (seed !== undefined) {
      result.metadata.seed = seed;
    }

    return result;
  }

  /**
   * Create a pipeline with specific algorithms (no random selection)
   * Useful for deterministic map types where you always want certain algorithms
   *
   * @param {Array<{name: string, intensity?: number, options?: Object}>} algorithmSpecs - Algorithms to use
   * @returns {Array<{algorithm: Object, intensity: number, options: Object}>} Prepared algorithm list
   */
  prepareAlgorithms(algorithmSpecs) {
    const prepared = [];

    for (const spec of algorithmSpecs) {
      const algorithmConfig = this.registry.get(spec.name);

      if (!algorithmConfig) {
        console.warn(`Algorithm "${spec.name}" not found in registry, skipping`);
        continue;
      }

      prepared.push({
        algorithm: algorithmConfig,
        intensity: spec.intensity ?? 0.5,
        options: { ...algorithmConfig.options, ...spec.options }
      });
    }

    // Sort by priority
    prepared.sort((a, b) => a.algorithm.priority - b.algorithm.priority);

    return prepared;
  }

  /**
   * Execute a predetermined set of algorithms (no random selection)
   *
   * @param {number} width - Map width
   * @param {number} height - Map height
   * @param {Function} random - Seeded random function
   * @param {Array<{name: string, intensity?: number, options?: Object}>} algorithmSpecs - Algorithms to execute
   * @param {Object} nodeConfig - Node configuration
   * @returns {Object} Generation result
   */
  runWithAlgorithms(width, height, random, algorithmSpecs, nodeConfig = {}) {
    const { baseTerrain = 'grass' } = nodeConfig;

    // Create initial terrain
    const terrain = this.createInitialTerrain(width, height, baseTerrain);

    // Prepare algorithms
    const preparedAlgorithms = this.prepareAlgorithms(algorithmSpecs);

    // Execute pipeline
    return this.execute(terrain, random, preparedAlgorithms, nodeConfig);
  }

  /**
   * Get a preset algorithm pool for a specific biome/node type
   * @param {string} nodeType - Node/biome type
   * @returns {string[]} Algorithm names suitable for this node type
   */
  static getPoolForNodeType(nodeType) {
    const pools = {
      forest: ['perlinTerrain', 'drunkardPaths', 'treeGroves', 'rockFormations'],
      cave: ['cellularCaves', 'caveRooms', 'bezierPaths', 'rockFormations'],
      dungeon: ['cellularCrypt', 'dungeonRooms', 'directCorridors'],
      mountain: ['perlinTerrain', 'drunkardPaths', 'rockFormations'],
      swamp: ['perlinTerrain', 'bezierPaths', 'waterPools', 'treeGroves'],
      volcano: ['cellularCaves', 'drunkardPaths', 'lavaPools', 'rockFormations'],
      plains: ['perlinTerrain', 'bezierPaths', 'rockFormations'],
      bridge: ['directCorridors', 'waterPools'],
      castle: ['dungeonRooms', 'directCorridors'],
      arena: ['arenaRoom', 'rockFormations']
    };

    return pools[nodeType] || pools.forest;
  }
}

export default AlgorithmPipeline;
