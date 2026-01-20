/**
 * Map Generation - Seeded terrain and obstacle generation for battle maps
 * SINGLE SOURCE OF TRUTH for map generation used by both server and client
 *
 * This module provides the main entry point for battle map generation.
 * It integrates with the AlgorithmPipeline system for procedural terrain
 * generation while maintaining backwards compatibility with existing code.
 *
 * DETERMINISM: Same seed always produces identical output. The random
 * consumption pattern changed in the pipeline refactor, so old seeds
 * will produce different maps, but new maps remain fully deterministic.
 */

import { isImpassable, getTerrainWeights } from './terrain.js';
import { AlgorithmPipeline } from './mapgen/AlgorithmPipeline.js';
import { getNodeConfig, getObstacleRulesForTerrain } from './mapgen/nodeTypeAlgorithms.js';
import { SpawnPlacer, AI_SPAWN_CONFIGS } from './mapgen/SpawnPlacer.js';

// New archetype system imports (Phase 1)
import {
  ARCHETYPES,
  getArchetype,
  selectArchetypeForNode,
  getArchetypeNames
} from './mapgen/archetypes/index.js';

// PRNG Streams for deterministic isolation (Phase 8)
import { createPRNGStreams, PRNGStreams } from './mapgen/PRNGStreams.js';

// Constraint validation and repair (Phase 4)
import { ConstraintValidator } from './mapgen/ConstraintValidator.js';

// Tactical cover system (Phase 5)
import { CoverGridSystem, COVER_LEVELS } from './mapgen/CoverGridSystem.js';

// Layer context for algorithm cooperation (Phase 2)
import { LayerContext } from './mapgen/LayerContext.js';

// Style profiles for parameter tuning (Phase 7)
import { getStyleProfile, applyStyleProfile } from './mapgen/StyleProfiles.js';

// ============================================================================
// OBSTACLE CONFIGURATION
// ============================================================================

/**
 * Obstacle configuration by terrain type
 * Defines what obstacles can appear on impassable terrain
 */
const OBSTACLE_MAP = {
  rock: { category: 'rocks', options: ['rock_small', 'rock_medium', 'rock_large'] },
  tree: { category: 'trees', options: ['oak_tree', 'pine_tree', 'dead_tree'] },
  forest: { category: 'trees', options: ['oak_tree', 'pine_tree'] },
  cliff: { category: 'rocks', options: ['rock_large', 'mountain_boulder'] },
  lava: null,
  water: null
};

/**
 * Decorative obstacles by biome type (fallback)
 */
const DECORATIVE_OBSTACLES = {
  forest: ['grass_tufts', 'wildflowers', 'fallen_log'],
  cave: ['cave_crystals', 'stalagmite'],
  mountain: ['grass_tufts', 'stone_ruins'],
  bridge: ['grass_tufts'],
  castle: ['stone_ruins']
};

// ============================================================================
// SEEDED RANDOM UTILITY
// ============================================================================

/**
 * Create a seeded random function (Mulberry32 algorithm)
 * @param {number} seed - Seed value
 * @returns {function} Random function that returns 0-1
 */
function createSeededRandom(seed) {
  let currentSeed = seed;
  return function() {
    let t = currentSeed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ============================================================================
// OBSTACLE GENERATION
// ============================================================================

/**
 * Get random decorative obstacle for a biome
 * @param {string} nodeType - Biome/node type
 * @param {function} random - Seeded random function
 * @returns {string} Decorative obstacle variant name
 */
function getRandomDecorativeObstacle(nodeType, random) {
  const options = DECORATIVE_OBSTACLES[nodeType] || DECORATIVE_OBSTACLES.forest;
  return options[Math.floor(random() * options.length)];
}

/**
 * Generate obstacle for a terrain tile using node config rules
 * @param {string} terrain - Terrain type at this tile
 * @param {string} nodeType - Biome/node type
 * @param {function} random - Seeded random function
 * @param {Object} nodeConfig - Node configuration with obstacle rules
 * @returns {Object|null} Obstacle data { type, variant } or null
 */
function generateObstacleForTile(terrain, nodeType, random, nodeConfig) {
  // If we have obstacle rules in the config, use them
  if (nodeConfig && nodeConfig.obstacleRules) {
    const rules = getObstacleRulesForTerrain(nodeConfig, terrain);

    for (const rule of rules) {
      if (random() < rule.chance) {
        const variant = rule.variants[Math.floor(random() * rule.variants.length)];
        return { type: rule.type, variant };
      }
    }
    return null;
  }

  // Fallback to legacy obstacle generation
  return generateObstacleForTerrainLegacy(terrain, nodeType, random);
}

/**
 * Legacy obstacle generation for backwards compatibility
 * @param {string} terrain - Terrain type at this tile
 * @param {string} nodeType - Biome/node type
 * @param {function} random - Seeded random function
 * @returns {Object|null} Obstacle data { type, variant } or null
 */
function generateObstacleForTerrainLegacy(terrain, nodeType, random) {
  if (!isImpassable(terrain)) {
    // Walkable terrain: possible decorative obstacles
    if (nodeType === 'forest' && terrain === 'grass') {
      if (random() < 0.15) {
        const treeOptions = ['oak_tree', 'pine_tree'];
        return { type: 'trees', variant: treeOptions[Math.floor(random() * treeOptions.length)] };
      }
      if (random() < 0.05) {
        return { type: 'decorative', variant: getRandomDecorativeObstacle(nodeType, random) };
      }
    } else {
      if (random() < 0.05) {
        return { type: 'decorative', variant: getRandomDecorativeObstacle(nodeType, random) };
      }
    }
    return null;
  }

  // Impassable terrain: generate terrain-specific obstacle
  const config = OBSTACLE_MAP[terrain];
  if (!config) return null;

  const variant = config.options[Math.floor(random() * config.options.length)];
  return { type: config.category, variant };
}

/**
 * Generate obstacles for the entire terrain grid
 * @param {string[][]} terrain - Terrain grid
 * @param {string} nodeType - Biome/node type
 * @param {function} random - Seeded random function
 * @param {Object} nodeConfig - Optional node configuration
 * @returns {Object[][]} Obstacle grid
 */
function generateObstacles(terrain, nodeType, random, nodeConfig = null) {
  const height = terrain.length;
  const width = terrain[0]?.length || 0;
  const obstacles = [];

  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      row.push(generateObstacleForTile(terrain[y][x], nodeType, random, nodeConfig));
    }
    obstacles.push(row);
  }

  return obstacles;
}

// ============================================================================
// SPAWN AREA CLEARING
// ============================================================================

/**
 * Clear spawn areas to ensure walkable tiles for unit placement
 * @param {string[][]} terrain - Terrain grid to modify in place
 * @param {Object[][]} obstacles - Obstacle grid to modify in place
 * @param {number} width - Map width
 * @param {number} height - Map height
 */
export function clearSpawnAreas(terrain, obstacles, width, height) {
  // Player spawn area (left side, columns 0-4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < 5; x++) {
      if (terrain[y] && isImpassable(terrain[y][x])) {
        terrain[y][x] = 'grass';
      }
      if (obstacles[y]) {
        obstacles[y][x] = null;
      }
    }
  }

  // Enemy spawn area (right side, last 5 columns)
  for (let y = 0; y < height; y++) {
    for (let x = width - 5; x < width; x++) {
      if (terrain[y] && isImpassable(terrain[y][x])) {
        terrain[y][x] = 'grass';
      }
      if (obstacles[y]) {
        obstacles[y][x] = null;
      }
    }
  }
}

// ============================================================================
// MAP CONNECTIVITY
// ============================================================================

/**
 * Pre-compute corridor data for deterministic carving
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {function} random - Seeded random function
 * @returns {Array} Corridor data with positions and wander decisions
 */
function precomputeCorridorData(width, height, random) {
  const playerSpawnX = 4;
  const enemySpawnX = width - 5;
  const corridorCount = 2 + Math.floor(random() * 2);
  const corridors = [];

  for (let i = 0; i < corridorCount; i++) {
    const baseY = Math.floor((height / (corridorCount + 1)) * (i + 1));
    const offsetY = Math.floor(random() * 5) - 2;
    const startY = Math.max(2, Math.min(height - 3, baseY + offsetY));

    const wanderData = [];
    for (let x = playerSpawnX; x <= enemySpawnX; x++) {
      const shouldWander = random() < 0.15;
      const wanderDir = random() < 0.5 ? -1 : 1;
      wanderData.push({ shouldWander, wanderDir });
    }

    corridors.push({ startY, wanderData, playerSpawnX, enemySpawnX });
  }

  return corridors;
}

/**
 * Apply pre-computed corridor data to terrain and obstacles
 * @param {string[][]} terrain - Terrain grid to modify
 * @param {Object[][]} obstacles - Obstacles grid to modify
 * @param {number} height - Map height
 * @param {Array} corridorData - Pre-computed corridor data
 */
function applyCorridorCarving(terrain, obstacles, height, corridorData) {
  for (const corridor of corridorData) {
    let currentY = corridor.startY;

    for (let i = 0; i < corridor.wanderData.length; i++) {
      const x = corridor.playerSpawnX + i;
      const { shouldWander, wanderDir } = corridor.wanderData[i];

      for (let dy = -1; dy <= 1; dy++) {
        const y = currentY + dy;
        if (y >= 0 && y < height && isImpassable(terrain[y]?.[x])) {
          terrain[y][x] = 'stone';
          if (obstacles?.[y]) {
            obstacles[y][x] = null;
          }
        }
      }

      if (shouldWander) {
        currentY = Math.max(2, Math.min(height - 3, currentY + wanderDir));
      }
    }
  }
}

/**
 * Ensure map has valid paths between spawn areas
 * @param {string[][]} terrain - Terrain grid to modify in place
 * @param {Object[][]} obstacles - Obstacles grid to modify in place
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {function} random - Seeded random function
 */
export function ensureMapConnectivity(terrain, obstacles, width, height, random) {
  // Always pre-compute corridor data for deterministic random consumption
  const corridorData = precomputeCorridorData(width, height, random);

  const playerSpawnX = 2;
  const enemySpawnX = width - 3;
  const midY = Math.floor(height / 2);

  // BFS connectivity check
  const visited = new Set();
  const queue = [{ x: playerSpawnX, y: midY }];
  visited.add(`${playerSpawnX},${midY}`);
  let reachedEnemy = false;

  while (queue.length > 0 && !reachedEnemy) {
    const current = queue.shift();
    if (current.x >= enemySpawnX) {
      reachedEnemy = true;
      break;
    }

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const key = `${nx},${ny}`;
      if (visited.has(key) || nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (isImpassable(terrain[ny]?.[nx])) continue;
      visited.add(key);
      queue.push({ x: nx, y: ny });
    }
  }

  if (!reachedEnemy) {
    applyCorridorCarving(terrain, obstacles, height, corridorData);
  }
}

// ============================================================================
// PIPELINE-BASED GENERATION
// ============================================================================

// Singleton pipeline instance for reuse
let pipelineInstance = null;

/**
 * Get or create the algorithm pipeline instance
 * @returns {AlgorithmPipeline} Pipeline instance
 */
function getPipeline() {
  if (!pipelineInstance) {
    pipelineInstance = new AlgorithmPipeline({
      defaultSelectionRate: 0.5,
      minIntensity: 0.3,
      maxIntensity: 0.8
    });
  }
  return pipelineInstance;
}

/**
 * Generate terrain using the new algorithm pipeline
 * @param {number} seed - Seed value
 * @param {string} nodeType - Biome/node type
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {Object} options - Generation options
 * @returns {Object} Generated map data
 */
function generateWithPipeline(seed, nodeType, width, height, options = {}) {
  const random = createSeededRandom(seed);
  const pipeline = getPipeline();
  const nodeConfig = getNodeConfig(nodeType);

  // Get algorithm pool from node config or use pipeline defaults
  const algorithmPool = nodeConfig?.algorithmPool
    ? nodeConfig.algorithmPool.map(entry => entry.name)
    : AlgorithmPipeline.getPoolForNodeType(nodeType);

  // Run the pipeline
  const result = pipeline.run(width, height, random, {
    algorithmPool,
    selectionRate: 0.6,
    baseTerrain: nodeConfig?.baseTerrain || 'grass',
    nodeType,
    seed
  });

  // Generate obstacles using node config rules
  const obstacles = generateObstacles(result.terrain, nodeType, random, nodeConfig);

  // Clear spawn areas
  clearSpawnAreas(result.terrain, obstacles, width, height);

  // Ensure connectivity
  ensureMapConnectivity(result.terrain, obstacles, width, height, random);

  // Build return object
  const returnValue = {
    terrain: result.terrain,
    obstacles,
    variants: result.variants
  };

  // Add elevation data if requested
  if (options.elevation || options.includeSpawns) {
    returnValue.elevation = generateElevationData(result.terrain, width, height, random);
  }

  // Generate spawn positions if requested (Phase 5)
  if (options.includeSpawns) {
    const spawner = new SpawnPlacer({ mapWidth: width, mapHeight: height });

    // Generate player spawns
    returnValue.playerSpawns = spawner.generatePlayerSpawns(result.terrain, {
      count: options.playerCount ?? 15,
      obstacles
    });

    // Generate enemy spawns if AI type and count provided
    if (options.enemyAiType && options.enemyCount) {
      returnValue.enemySpawns = spawner.generateEnemySpawns(
        result.terrain,
        obstacles,
        options.enemyAiType,
        options.enemyCount,
        random,
        {
          elevation: returnValue.elevation,
          unitRoles: options.enemyRoles || []
        }
      );
    }
  }

  // Add metadata if requested
  if (options.includeMetadata) {
    returnValue.metadata = result.metadata;
  }

  return returnValue;
}

/**
 * Generate elevation data for terrain (Phase 2 prep)
 * @param {string[][]} terrain - Terrain grid
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {function} random - Seeded random function
 * @returns {number[][]} Elevation grid (0-1 values)
 */
function generateElevationData(terrain, width, height, random) {
  const elevation = [];

  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      // Base elevation from terrain type
      let baseElevation = 0.5;
      const t = terrain[y][x];

      if (t === 'cliff' || t === 'rock') baseElevation = 0.8;
      else if (t === 'mountain') baseElevation = 0.9;
      else if (t === 'water' || t === 'lava') baseElevation = 0.2;
      else if (t === 'stone') baseElevation = 0.5;
      else if (t === 'grass' || t === 'forest') baseElevation = 0.4;

      // Add small random variation
      const variation = (random() - 0.5) * 0.1;
      row.push(Math.max(0, Math.min(1, baseElevation + variation)));
    }
    elevation.push(row);
  }

  return elevation;
}

// ============================================================================
// ARCHETYPE-BASED GENERATION (New System)
// ============================================================================

/**
 * Generate terrain using the archetype system with all phases integrated
 *
 * This is the new generation path that uses:
 * - Phase 8: PRNG Streams for deterministic isolation
 * - Phase 1: Archetype selection and curated algorithm pipelines
 * - Phase 2: LayerContext for algorithm cooperation
 * - Phase 3: Graph-based topology (via archetype algorithms)
 * - Phase 4: Constraint validation and repair
 * - Phase 5: Tactical cover placement
 * - Phase 6: Integrated elevation
 * - Phase 7: Style profile parameter tuning
 *
 * @param {number} seed - Seed value for deterministic generation
 * @param {string} nodeType - Biome/node type (forest, cave, mountain, etc.)
 * @param {number} width - Map width in tiles
 * @param {number} height - Map height in tiles
 * @param {Object} options - Generation options
 * @returns {Object} Generated map with terrain, obstacles, variants, and metadata
 */
function generateWithArchetypes(seed, nodeType, width, height, options = {}) {
  const {
    archetypeName = null,
    elevation: includeElevation = true,
    includeMetadata = false,
    includeSpawns = false,
    playerCount = 15,
    enemyAiType = null,
    enemyCount = 0,
    enemyRoles = [],
    coverStrategy = null,
    styleProfile = null
  } = options;

  // Phase 8: Create isolated PRNG streams
  const streams = createPRNGStreams(seed);

  // Phase 1: Select archetype (weighted by node type or explicit)
  const archetype = archetypeName
    ? getArchetype(archetypeName)
    : selectArchetypeForNode(nodeType, () => streams.structure());

  if (!archetype) {
    // Fallback to legacy pipeline if no archetype found
    console.warn(`No archetype found for node type: ${nodeType}, falling back to legacy pipeline`);
    return generateWithPipeline(seed, nodeType, width, height, options);
  }

  // Get style profile (from archetype or explicit)
  const effectiveStyleProfile = styleProfile || archetype.styleProfile || 'natural';

  // Phase 2: Create layer context for algorithm cooperation
  const context = new LayerContext(width, height);
  context.setMetadata('archetype', archetype.name);
  context.setMetadata('nodeType', nodeType);
  context.setMetadata('seed', seed);
  context.setMetadata('styleProfile', effectiveStyleProfile);

  // Phase 1+2: Run archetype through pipeline with context
  const pipeline = getPipeline();
  const nodeConfig = getNodeConfig(nodeType);

  const pipelineResult = pipeline.runArchetype(archetype, width, height, streams, {
    nodeConfig,
    context,
    styleProfile: effectiveStyleProfile
  });

  // Extract results
  let terrain = pipelineResult.terrain;
  let obstacles = pipelineResult.obstacles || [];
  const variants = pipelineResult.variants || generateVariants(width, height, () => streams.variants());

  // Phase 6: Generate or use elevation from context
  let elevationGrid = context.elevation;
  if (!elevationGrid && includeElevation) {
    elevationGrid = generateElevationData(terrain, width, height, () => streams.terrain());
  }

  // Phase 5: Generate tactical cover
  const effectiveCoverStrategy = coverStrategy || archetype.coverStrategy || 'staggered';
  const coverSystem = new CoverGridSystem(width, height);
  coverSystem.generate(effectiveCoverStrategy, () => streams.cover(), {
    archetype: archetype.name
  });

  // Map cover to obstacles (merge with existing)
  const coverObstacles = coverSystem.mapToObstacles({}, () => streams.obstacles());
  obstacles = mergeObstacles(obstacles, coverObstacles, width, height);

  // Clear spawn areas before validation
  clearSpawnAreas(terrain, obstacles, width, height);

  // Phase 4: Validate and repair constraints
  const constraints = archetype.constraints || {};
  const validator = new ConstraintValidator(constraints);
  const validationResult = validator.validateAndRepair(
    terrain,
    obstacles,
    width,
    height,
    () => streams.repair()
  );

  // Apply any repairs
  if (validationResult.repaired) {
    terrain = validationResult.terrain;
    obstacles = validationResult.obstacles;
  }

  // Build return value
  const returnValue = {
    terrain,
    obstacles,
    variants
  };

  // Include elevation if requested
  if (includeElevation) {
    returnValue.elevation = elevationGrid;
  }

  // Include cover grid data for debugging/rendering
  if (options.includeCoverGrid) {
    returnValue.coverGrid = coverGrid;
  }

  // Generate spawn positions if requested
  if (includeSpawns) {
    const spawner = new SpawnPlacer({ mapWidth: width, mapHeight: height });

    // Player spawns
    returnValue.playerSpawns = spawner.generatePlayerSpawns(terrain, {
      count: playerCount,
      obstacles
    });

    // Enemy spawns with elevation scoring
    if (enemyAiType && enemyCount) {
      returnValue.enemySpawns = spawner.generateEnemySpawns(
        terrain,
        obstacles,
        enemyAiType,
        enemyCount,
        () => streams.spawns(),
        {
          elevation: elevationGrid,
          unitRoles: enemyRoles
        }
      );
    }
  }

  // Include metadata if requested
  if (includeMetadata) {
    returnValue.metadata = {
      ...pipelineResult.metadata,
      archetype: archetype.name,
      styleProfile: effectiveStyleProfile,
      coverStrategy: effectiveCoverStrategy,
      constraints: archetype.constraints,
      validationResult: {
        iterations: validationResult.iterations,
        repaired: validationResult.repaired,
        finalAnalysis: validationResult.finalAnalysis
      },
      context: {
        roomCount: context.rooms.length,
        pathCount: context.paths.length,
        poiCount: context.pois.length
      }
    };
  }

  return returnValue;
}

/**
 * Generate tile variants grid
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {function} random - Random function
 * @returns {number[][]} Variant indices (0-3)
 */
function generateVariants(width, height, random) {
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
 * Merge two obstacle grids, preferring non-null values from the second grid
 * @param {Object[][]} base - Base obstacle grid
 * @param {Object[][]} overlay - Overlay obstacle grid
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @returns {Object[][]} Merged obstacle grid
 */
function mergeObstacles(base, overlay, width, height) {
  // If no base, return overlay or empty grid
  if (!base || base.length === 0) {
    return overlay || Array.from({ length: height }, () => Array(width).fill(null));
  }

  // If no overlay, return base
  if (!overlay || overlay.length === 0) {
    return base;
  }

  const merged = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      // Prefer overlay if it has an obstacle, otherwise use base
      const baseObs = base[y]?.[x];
      const overlayObs = overlay[y]?.[x];
      row.push(overlayObs || baseObs);
    }
    merged.push(row);
  }
  return merged;
}

// ============================================================================
// MAIN EXPORT FUNCTIONS
// ============================================================================

/**
 * Generate terrain and obstacles from a seed value
 *
 * @param {number} seed - Seed value for deterministic generation
 * @param {string} nodeType - Biome/node type (forest, cave, mountain, bridge, castle)
 * @param {number} width - Map width in tiles (default 32)
 * @param {number} height - Map height in tiles (default 32)
 * @param {Object} options - Optional generation parameters
 * @param {boolean} options.useNewPipeline - Use new algorithm pipeline (default true)
 * @param {boolean} options.useArchetypes - Use new archetype system (default false for now)
 * @param {string} options.archetypeName - Explicit archetype to use (overrides node type selection)
 * @param {boolean} options.elevation - Include elevation data (default false)
 * @param {boolean} options.includeMetadata - Include generation metadata (default false)
 * @param {boolean} options.includeSpawns - Generate spawn positions (default false)
 * @param {number} options.playerCount - Number of player spawn slots (default 15)
 * @param {string} options.enemyAiType - AI type for enemy spawn positioning
 * @param {number} options.enemyCount - Number of enemies to spawn
 * @param {string[]} options.enemyRoles - Optional roles for tactical spawn positioning
 * @param {string} options.coverStrategy - Cover placement strategy (symmetric, staggered, etc.)
 * @param {string} options.styleProfile - Style profile for parameter tuning
 * @param {boolean} options.includeCoverGrid - Include raw cover grid data
 * @returns {Object} { terrain, obstacles, variants, elevation?, playerSpawns?, enemySpawns?, metadata? }
 */
export function generateTerrain(seed, nodeType, width = 32, height = 32, options = {}) {
  const {
    useNewPipeline = true,
    useArchetypes = false,
    archetypeName = null,
    elevation = false,
    includeMetadata = false,
    includeSpawns = false,
    playerCount = 15,
    enemyAiType = null,
    enemyCount = 0,
    enemyRoles = [],
    coverStrategy = null,
    styleProfile = null,
    includeCoverGrid = false
  } = options;

  // Use new archetype system if enabled
  if (useArchetypes) {
    return generateWithArchetypes(seed, nodeType, width, height, {
      archetypeName,
      elevation,
      includeMetadata,
      includeSpawns,
      playerCount,
      enemyAiType,
      enemyCount,
      enemyRoles,
      coverStrategy,
      styleProfile,
      includeCoverGrid
    });
  }

  // Use new pipeline by default
  if (useNewPipeline) {
    return generateWithPipeline(seed, nodeType, width, height, {
      elevation,
      includeMetadata,
      includeSpawns,
      playerCount,
      enemyAiType,
      enemyCount,
      enemyRoles
    });
  }

  // Legacy generation path (for testing/comparison)
  return generateTerrainLegacy(seed, nodeType, width, height);
}

/**
 * Legacy terrain generation (pre-pipeline)
 * Kept for backwards compatibility testing
 * @private
 */
function generateTerrainLegacy(seed, nodeType, width, height) {
  const random = createSeededRandom(seed);
  const terrain = [];
  const obstacles = [];
  const variants = [];

  const terrainWeights = getTerrainWeights(nodeType);

  for (let y = 0; y < height; y++) {
    const terrainRow = [];
    const obstacleRow = [];
    const variantRow = [];

    for (let x = 0; x < width; x++) {
      // Terrain selection
      const roll = random();
      let cumulative = 0;
      let selectedTerrain = 'grass';

      for (const [terrainType, weight] of Object.entries(terrainWeights)) {
        cumulative += weight;
        if (roll < cumulative) {
          selectedTerrain = terrainType;
          break;
        }
      }
      terrainRow.push(selectedTerrain);

      // Tile variant
      variantRow.push(Math.floor(random() * 4));

      // Obstacle generation
      obstacleRow.push(generateObstacleForTerrainLegacy(selectedTerrain, nodeType, random));
    }

    terrain.push(terrainRow);
    obstacles.push(obstacleRow);
    variants.push(variantRow);
  }

  clearSpawnAreas(terrain, obstacles, width, height);
  ensureMapConnectivity(terrain, obstacles, width, height, random);

  return { terrain, obstacles, variants };
}

/**
 * Generate terrain only (without obstacles/variants) for server-side validation
 *
 * @param {number} seed - Seed value
 * @param {string} nodeType - Biome type
 * @param {number} width - Map width (default 32)
 * @param {number} height - Map height (default 32)
 * @returns {string[][]} 2D terrain grid
 */
export function generateTerrainOnly(seed, nodeType, width = 32, height = 32) {
  const result = generateTerrain(seed, nodeType, width, height);
  return result.terrain;
}

// ============================================================================
// SPAWN GENERATION EXPORTS
// ============================================================================

// Re-export SpawnPlacer and configs for direct use
export { SpawnPlacer, AI_SPAWN_CONFIGS };

/**
 * Generate spawn positions for an existing terrain/obstacle grid
 * Use this when you already have terrain and need to add spawns separately
 *
 * @param {string[][]} terrain - Existing terrain grid
 * @param {Object[][]} obstacles - Existing obstacle grid
 * @param {Object} options - Spawn generation options
 * @param {number} options.seed - Seed for deterministic enemy spawn positioning
 * @param {number} options.playerCount - Number of player spawn slots (default 15)
 * @param {string} options.enemyAiType - AI type for enemy positioning
 * @param {number} options.enemyCount - Number of enemies to spawn
 * @param {string[]} options.enemyRoles - Optional unit roles for tactical positioning
 * @param {number[][]} options.elevation - Optional elevation grid
 * @returns {Object} { playerSpawns, enemySpawns }
 */
export function generateSpawnPositions(terrain, obstacles, options = {}) {
  const {
    seed = Date.now(),
    playerCount = 15,
    enemyAiType = 'aggressive',
    enemyCount = 5,
    enemyRoles = [],
    elevation = null
  } = options;

  const random = createSeededRandom(seed);
  const width = terrain[0]?.length || 32;
  const height = terrain.length || 32;
  const spawner = new SpawnPlacer({ mapWidth: width, mapHeight: height });

  const result = {
    playerSpawns: spawner.generatePlayerSpawns(terrain, {
      count: playerCount,
      obstacles
    }),
    enemySpawns: spawner.generateEnemySpawns(
      terrain,
      obstacles,
      enemyAiType,
      enemyCount,
      random,
      {
        elevation,
        unitRoles: enemyRoles
      }
    )
  };

  return result;
}

/**
 * Validate spawn positions are all walkable
 *
 * @param {Array<{x: number, y: number}>} spawns - Array of spawn positions
 * @param {string[][]} terrain - Terrain grid
 * @param {Object[][]} obstacles - Obstacle grid
 * @returns {Object} { valid: boolean, invalidPositions: Array }
 */
export function validateSpawnPositions(spawns, terrain, obstacles) {
  const spawner = new SpawnPlacer();
  return spawner.validateSpawns(spawns, terrain, obstacles);
}

// ============================================================================
// ARCHETYPE SYSTEM EXPORTS
// ============================================================================

// Re-export archetype system components for direct use
export {
  ARCHETYPES,
  getArchetype,
  selectArchetypeForNode,
  getArchetypeNames
} from './mapgen/archetypes/index.js';

// Re-export PRNG streams for deterministic generation
export {
  createPRNGStreams,
  PRNGStreams,
  STREAM_SALTS,
  mulberry32
} from './mapgen/PRNGStreams.js';

// Re-export constraint validation
export { ConstraintValidator, VIOLATION_TYPES } from './mapgen/ConstraintValidator.js';

// Re-export default constraints from archetypes
export { DEFAULT_CONSTRAINTS, CONSTRAINT_PRESETS } from './mapgen/archetypes/constraints.js';

// Re-export cover grid system
export {
  CoverGridSystem,
  COVER_LEVELS,
  COVER_BONUSES,
  DEFAULT_LANE_CONFIG as LANE_CONFIG,
  COVER_STRATEGIES
} from './mapgen/CoverGridSystem.js';

// Re-export layer context for algorithm cooperation
export { LayerContext } from './mapgen/LayerContext.js';

// Re-export style profiles for parameter tuning
export {
  STYLE_PROFILES,
  getStyleProfile,
  getStyleProfileNames,
  applyStyleProfile,
  getAlgorithmWeight,
  blendProfiles,
  suggestStyleProfile
} from './mapgen/StyleProfiles.js';

// Re-export parameter schema for algorithm configuration
export {
  PARAM_TYPES,
  ALGORITHM_PARAMS,
  validateParam,
  validateAlgorithmParams,
  getDefaultParams,
  getParamDocs,
  getAlgorithmNames
} from './mapgen/ParameterSchema.js';

// Re-export graph system for topology-driven generation
export {
  TopologyGraph,
  POIGenerator,
  GraphBuilder
} from './mapgen/graph/index.js';
