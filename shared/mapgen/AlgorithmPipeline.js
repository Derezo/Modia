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
 * - Archetype-based generation for curated map styles
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
import { PRNGStreams, createPRNGStreams } from './PRNGStreams.js';

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
   * Generate elevation grid based on elevation profile
   * Called early in archetype pipeline so algorithms can use elevation data
   *
   * @param {number} width - Grid width
   * @param {number} height - Grid height
   * @param {Object} profile - Elevation profile from archetype
   * @param {Function} random - Seeded random function
   * @returns {number[][]} 2D elevation grid (-1 to 3 values)
   */
  generateElevation(width, height, profile, random) {
    const elevation = [];
    const {
      type = 'flat',
      maxElevation = 1,
      minElevation = 0,
      noiseScale = 0.1,
      pitChance = 0,
      rampPreference = 0.8
    } = profile;

    // Generate base noise for elevation
    for (let y = 0; y < height; y++) {
      const row = [];
      for (let x = 0; x < width; x++) {
        let elev = 0;

        switch (type) {
          case 'rolling':
            // Gentle rolling hills using noise
            elev = this._noiseAt(x, y, noiseScale, random);
            elev = Math.round(elev * maxElevation);
            elev = Math.max(minElevation, Math.min(maxElevation, elev));
            break;

          case 'depression':
            // Center is lower (caves, pits)
            const centerX = width / 2;
            const centerY = height / 2;
            const distFromCenter = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
            const maxDist = Math.sqrt(centerX ** 2 + centerY ** 2);
            const normalizedDist = distFromCenter / maxDist;

            // Closer to center = lower elevation
            elev = Math.round(normalizedDist * maxElevation + (1 - normalizedDist) * minElevation);
            // Add some noise variation
            elev += Math.round((random() - 0.5) * 0.5);
            elev = Math.max(minElevation, Math.min(maxElevation, elev));

            // Random pit chance near center
            if (pitChance > 0 && normalizedDist < 0.4 && random() < pitChance) {
              elev = -1;
            }
            break;

          case 'canyon':
            // High walls, low center path
            const canyonCenterY = height / 2;
            const distFromCanyonCenter = Math.abs(y - canyonCenterY);
            const pathWidth = height * 0.2;

            if (distFromCanyonCenter < pathWidth) {
              // In the path - ground level
              elev = 0;
            } else {
              // On the walls - elevated
              const wallProgress = (distFromCanyonCenter - pathWidth) / (height / 2 - pathWidth);
              elev = Math.round(wallProgress * maxElevation);
            }
            // Add some noise variation
            elev += Math.round((random() - 0.5) * 0.3);
            elev = Math.max(minElevation, Math.min(maxElevation, elev));
            break;

          case 'multiLevel':
            // Default to ground level - terrain algorithms will set specific elevations
            elev = 0;
            break;

          default:
            // Flat terrain
            elev = 0;
        }

        row.push(elev);
      }
      elevation.push(row);
    }

    return elevation;
  }

  /**
   * Simple noise function for elevation generation
   * Uses seeded random for deterministic results
   * @private
   */
  _noiseAt(x, y, scale, random) {
    // Simple value noise with interpolation
    const scaledX = x * scale;
    const scaledY = y * scale;

    // Generate deterministic noise based on position
    const ix = Math.floor(scaledX);
    const iy = Math.floor(scaledY);
    const fx = scaledX - ix;
    const fy = scaledY - iy;

    // Generate seed offset from random for determinism
    // Consume one random value to establish the offset for this generation pass
    const seedOffset = Math.floor(random() * 2147483647);

    // Use hash-based noise with seed offset for deterministic grid values
    const n00 = this._hashNoise(ix, iy, seedOffset);
    const n10 = this._hashNoise(ix + 1, iy, seedOffset);
    const n01 = this._hashNoise(ix, iy + 1, seedOffset);
    const n11 = this._hashNoise(ix + 1, iy + 1, seedOffset);

    // Bilinear interpolation
    const nx0 = n00 * (1 - fx) + n10 * fx;
    const nx1 = n01 * (1 - fx) + n11 * fx;
    return nx0 * (1 - fy) + nx1 * fy;
  }

  /**
   * Hash-based noise for deterministic values at grid points
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {number} seedOffset - Seed offset for determinism
   * @private
   */
  _hashNoise(x, y, seedOffset) {
    // Simple hash combining x, y, and seed offset
    const hash = ((x * 374761393 + y * 668265263 + seedOffset) ^ 0x85ebca6b) >>> 0;
    return (hash % 1000) / 1000;
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
   * Run an archetype-based generation pipeline
   *
   * Archetypes define curated algorithm sequences with specific roles:
   * - 'macro': Large-scale structure (runs first, others build on it)
   * - 'refinement': Refines macro output (e.g., CA smoothing Perlin edges)
   * - 'structure': Places rooms, corridors, POIs
   * - 'detail': Adds clusters, decorations, minor features
   *
   * @param {Object} archetype - Archetype definition from archetypeDefinitions.js
   * @param {number} width - Map width
   * @param {number} height - Map height
   * @param {Function|PRNGStreams} randomSource - Seeded random function or PRNGStreams
   * @param {Object} options - Additional options
   * @param {Object} options.nodeConfig - Node-specific configuration overrides
   * @param {Object} options.layerContext - Shared context between algorithms
   * @param {number} options.seed - Original seed for metadata
   * @returns {Object} Generation result with terrain, metadata, and archetype info
   */
  runArchetype(archetype, width, height, randomSource, options = {}) {
    if (!archetype) {
      throw new Error('Archetype is required');
    }

    const { nodeConfig = {}, layerContext = null, seed } = options;

    // Determine random source - support both legacy single random and PRNG streams
    let streams = null;
    let random;

    if (randomSource instanceof PRNGStreams) {
      streams = randomSource;
      random = streams.getStream('terrain'); // Default to terrain stream
    } else if (typeof randomSource === 'function') {
      random = randomSource;
    } else {
      throw new Error('randomSource must be a function or PRNGStreams instance');
    }

    // Create initial terrain with archetype's base terrain
    const baseTerrain = archetype.baseTerrain || nodeConfig.baseTerrain || 'grass';
    const terrain = this.createInitialTerrain(width, height, baseTerrain);

    // Create supporting grids
    const obstacles = this.createInitialObstacles(width, height);
    const variantsRandom = streams ? streams.getStream('variants') : random;
    const variants = this.createInitialVariants(width, height, variantsRandom);

    // Generate elevation early if archetype has elevation profile
    // This allows algorithms to reference elevation data during generation
    let elevation = null;
    if (archetype.elevationProfile) {
      const elevationRandom = streams ? streams.getStream('terrain') : random;
      elevation = this.generateElevation(width, height, archetype.elevationProfile, elevationRandom);
    }

    // Track context shared between algorithms
    const context = layerContext || {
      terrain,
      noiseMap: null,
      seedRegions: null,
      rooms: [],
      paths: [],
      pois: []
    };

    // Set elevation in context if generated (allows algorithms to use it)
    if (elevation && context.setElevation) {
      context.setElevation(elevation);
    } else if (elevation) {
      context.elevation = elevation;
    }

    // Execute archetype algorithms in defined order
    const algorithmsUsed = [];

    for (const algorithmSpec of archetype.algorithms) {
      const { name, intensity, role, options: algOptions = {}, seedFromPrevious } = algorithmSpec;

      // Get appropriate random stream based on role
      let algorithmRandom = random;
      if (streams) {
        switch (role) {
          case 'macro':
          case 'refinement':
            algorithmRandom = streams.getStream('terrain');
            break;
          case 'structure':
            algorithmRandom = streams.getStream('structure');
            break;
          case 'detail':
            algorithmRandom = streams.getStream('detail');
            break;
          default:
            algorithmRandom = streams.getStream('terrain');
        }
      }

      // Get algorithm from registry
      const algorithmConfig = this.registry.get(name);

      if (!algorithmConfig) {
        // Try to match by algorithm class name
        const registeredName = this._findAlgorithmByClassPattern(name, algOptions);
        if (!registeredName) {
          console.warn(`Algorithm "${name}" not found in registry, skipping`);
          continue;
        }
        // Use found algorithm instead
        const foundConfig = this.registry.get(registeredName);
        if (!foundConfig) continue;

        try {
          const instance = new foundConfig.class({
            ...foundConfig.options,
            ...algOptions
          });

          // Prepare runtime options
          const runtimeOptions = {
            intensity: intensity ?? 0.5,
            nodeType: nodeConfig.nodeType || archetype.name,
            bounds: { x: 0, y: 0, width, height },
            context,
            seedFromPrevious,
            ...algOptions
          };

          // Execute algorithm
          instance.apply(terrain, algorithmRandom, runtimeOptions);

          algorithmsUsed.push({
            name,
            role,
            intensity,
            success: true
          });
        } catch (error) {
          console.error(`Algorithm "${name}" failed:`, error.message);
          algorithmsUsed.push({
            name,
            role,
            intensity,
            success: false,
            error: error.message
          });
        }
        continue;
      }

      try {
        // Create algorithm instance with merged options
        const instance = new algorithmConfig.class({
          ...algorithmConfig.options,
          ...algOptions
        });

        // Prepare runtime options
        const runtimeOptions = {
          intensity: intensity ?? 0.5,
          nodeType: nodeConfig.nodeType || archetype.name,
          bounds: { x: 0, y: 0, width, height },
          context,
          seedFromPrevious,
          ...algOptions
        };

        // Execute algorithm
        instance.apply(terrain, algorithmRandom, runtimeOptions);

        // Track usage
        algorithmsUsed.push({
          name,
          role,
          intensity,
          success: true
        });
      } catch (error) {
        console.error(`Algorithm "${name}" failed:`, error.message);
        algorithmsUsed.push({
          name,
          role,
          intensity,
          success: false,
          error: error.message
        });
      }
    }

    // Build result
    const result = {
      terrain,
      obstacles,
      variants,
      metadata: {
        archetype: archetype.name,
        displayName: archetype.displayName,
        algorithmsUsed,
        constraints: archetype.constraints,
        styleProfile: archetype.styleProfile,
        elevationProfile: archetype.elevationProfile || null,
        width,
        height,
        baseTerrain
      }
    };

    // Include elevation data if generated
    if (elevation) {
      result.elevation = elevation;
    } else if (context.elevation) {
      result.elevation = context.elevation;
    }

    // Add seed to metadata if provided
    if (seed !== undefined) {
      result.metadata.seed = seed;
    }

    // Include context data in result
    result.context = {
      rooms: context.rooms,
      paths: context.paths,
      pois: context.pois
    };

    return result;
  }

  /**
   * Find an algorithm by matching class pattern or preset
   * @private
   */
  _findAlgorithmByClassPattern(name, options) {
    // Common name patterns to algorithm registry names
    const patternMap = {
      perlinTerrain: 'perlinTerrain',
      perlinMacro: 'perlinTerrain',
      cellularRefine: 'cellularCaves',
      cellularCaves: 'cellularCaves',
      cellularCrypt: 'cellularCrypt',
      caveRooms: 'caveRooms',
      dungeonRooms: 'dungeonRooms',
      arenaRoom: 'arenaRoom',
      drunkardPaths: 'drunkardPaths',
      bezierPaths: 'bezierPaths',
      directCorridors: 'directCorridors',
      treeGroves: 'treeGroves',
      rockFormations: 'rockFormations',
      waterPools: 'waterPools',
      lavaPools: 'lavaPools',
      denseForest: 'denseForest'
    };

    // Try direct pattern match
    if (patternMap[name]) {
      return patternMap[name];
    }

    // Try to infer from options
    if (options.preset === 'cave') {
      return name.includes('cellular') ? 'cellularCaves' : 'caveRooms';
    }
    if (options.preset === 'crypt') {
      return 'cellularCrypt';
    }
    if (options.preset === 'dungeon') {
      return 'dungeonRooms';
    }
    if (options.preset === 'arena') {
      return 'arenaRoom';
    }
    if (options.pathStyle === 'drunkard') {
      return 'drunkardPaths';
    }
    if (options.pathStyle === 'bezier') {
      return 'bezierPaths';
    }
    if (options.pathStyle === 'direct') {
      return 'directCorridors';
    }

    return null;
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
