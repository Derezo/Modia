/**
 * Map Generation - Seeded terrain and obstacle generation for battle maps
 * SINGLE SOURCE OF TRUTH for map generation used by both server and client
 *
 * This module provides the main entry point for battle map generation using
 * an 8-phase archetype-based procedural generation system:
 *
 * - Phase 8: PRNG Streams - Isolated random streams for determinism
 * - Phase 1: Archetypes - Curated algorithm pipelines per map type
 * - Phase 2: LayerContext - Algorithm cooperation via shared state
 * - Phase 3: Graph - Topology-driven POI and path generation
 * - Phase 4: Constraints - Validation and automatic repair
 * - Phase 5: Cover - Tactical cover placement with lane system
 * - Phase 6: Elevation - Integrated terrain height
 * - Phase 7: Styles - Parameter tuning via style profiles
 *
 * DETERMINISM: Same seed always produces identical output.
 */

import { isImpassable } from './terrain.js';
import { AlgorithmPipeline } from './mapgen/AlgorithmPipeline.js';
import { getNodeConfig } from './mapgen/nodeTypeAlgorithms.js';
import { SpawnPlacer, AI_SPAWN_CONFIGS, scaleSpawnXRange } from './mapgen/SpawnPlacer.js';

// Archetype system (Phase 1)
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

// Layer context for algorithm cooperation (Phase 2)
import { LayerContext } from './mapgen/LayerContext.js';

// Style profiles for parameter tuning (Phase 7)
import { getStyleProfile, applyStyleProfile } from './mapgen/StyleProfiles.js';

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
// SPAWN AREA CLEARING
// ============================================================================

export const MIN_MAP_DIMENSION = 10;
export const MIN_ARENA_MAP_WIDTH = 11;
export const MIN_ARENA_MAP_HEIGHT = 16;

/**
 * Validate the public map-generation size contract before allocating grids.
 * The algorithms and the two opposing formation zones require at least a
 * 10x10 battlefield.
 *
 * @param {number} width - Requested map width
 * @param {number} height - Requested map height
 * @throws {RangeError} When either dimension is not an integer >= 10
 */
function validateMapDimensions(width, height, nodeType) {
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < MIN_MAP_DIMENSION || height < MIN_MAP_DIMENSION) {
    throw new RangeError(
      `Map dimensions must be integers at least ${MIN_MAP_DIMENSION} tiles; received ${width}x${height}`
    );
  }

  if (nodeType === 'arena' &&
      (width < MIN_ARENA_MAP_WIDTH || height < MIN_ARENA_MAP_HEIGHT)) {
    throw new RangeError(
      `Arena maps must be at least ${MIN_ARENA_MAP_WIDTH}x${MIN_ARENA_MAP_HEIGHT} tiles ` +
      `to contain both 5x4 formation zones; received ${width}x${height}`
    );
  }
}

/**
 * Return every tile rectangle that must remain safe for the battle mode's
 * actual unit-placement coordinates. Standard PvE and guild battles use the
 * west/east strips. Coliseum formations use north/south rectangles as well.
 *
 * @param {string} nodeType - Battle node type
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @returns {Array<{x: number, y: number, width: number, height: number, forceTerrain?: boolean}>}
 */
export function getSpawnProtectionZones(nodeType, width, height) {
  const stripWidth = width >= 24
    ? 7
    : Math.min(5, Math.floor(width / 2));
  const zones = [
    { x: 0, y: 0, width: stripWidth, height },
    { x: width - stripWidth, y: 0, width: stripWidth, height }
  ];

  if (nodeType === 'arena') {
    const formationWidth = Math.max(0, Math.min(9, width - 2));
    const formationHeight = Math.max(0, Math.min(4, height - 4));
    zones.push(
      { x: 2, y: 4, width: formationWidth, height: formationHeight, forceTerrain: true },
      {
        x: 2,
        y: Math.max(0, height - 8),
        width: formationWidth,
        height: Math.min(4, height),
        forceTerrain: true
      }
    );
  }

  return zones;
}

/**
 * Clear spawn areas to ensure walkable tiles for unit placement
 * @param {string[][]} terrain - Terrain grid to modify in place
 * @param {Object[][]} obstacles - Obstacle grid to modify in place
 * @param {number} width - Map width
 * @param {number} height - Map height
 */
export function clearSpawnAreas(
  terrain,
  obstacles,
  width,
  height,
  elevation = null,
  spawnTerrain = 'grass',
  nodeType = 'standard'
) {
  for (const zone of getSpawnProtectionZones(nodeType, width, height)) {
    const minX = Math.max(0, zone.x);
    const minY = Math.max(0, zone.y);
    const maxX = Math.min(width, zone.x + zone.width);
    const maxY = Math.min(height, zone.y + zone.height);

    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        if (terrain[y] &&
            (zone.forceTerrain || isImpassable(terrain[y][x]) || terrain[y][x] === 'water')) {
          terrain[y][x] = spawnTerrain;
        }
        if (obstacles[y]) {
          obstacles[y][x] = null;
        }
        // 0.33 discretizes to semantic ground level and works for the public
        // normalized elevation contract.
        if (elevation?.[y]) {
          elevation[y][x] = 0.33;
        }
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
    styleProfile = null
  } = options;

  // Phase 8: Create isolated PRNG streams
  const streams = createPRNGStreams(seed);

  // Phase 1: Select archetype (weighted by node type or explicit)
  let archetype = archetypeName
    ? getArchetype(archetypeName)
    : selectArchetypeForNode(nodeType, () => streams.structure());

  if (!archetype) {
    // Default to openField archetype for unknown node types
    console.warn(`No archetype found for node type: ${nodeType}, using openField`);
    archetype = getArchetype('openField');
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
    layerContext: context,
    seed,
    styleProfile: effectiveStyleProfile
  });

  // Extract results
  const terrain = pipelineResult.terrain;
  const obstacles = pipelineResult.obstacles || [];
  const variants = pipelineResult.variants || generateVariants(width, height, () => streams.variants());

  // Phase 6: Use profile-authored elevation when available. Fallback
  // elevation is generated after terrain validation so repaired corridors do
  // not retain the height of the impassable terrain they replaced.
  let elevationGrid = pipelineResult.elevation || context.elevation;

  // Clear spawn areas before validation
  const spawnTerrain = [
    'cave',
    'mountain',
    'bridge',
    'castle',
    'dungeon',
    'arena',
    'guild',
    'dwarven_mine',
    'vampiric_crypt'
  ].includes(nodeType)
    ? 'stone'
    : 'grass';
  clearSpawnAreas(terrain, obstacles, width, height, elevationGrid, spawnTerrain, nodeType);

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

  // ConstraintValidator repairs the authoritative terrain/obstacle arrays in
  // place and reports the number of iterations in repairIterations.

  if (!elevationGrid && includeElevation) {
    elevationGrid = generateElevationData(terrain, width, height, () => streams.terrain());
  }

  // Validation may repair tiles and fallback elevation is generated only
  // afterward. Reapply the exact battle-mode zones so the final public grids,
  // not merely an intermediate phase, are obstacle-free and ground-flat.
  clearSpawnAreas(terrain, obstacles, width, height, elevationGrid, spawnTerrain, nodeType);

  // Build return value
  const returnValue = {
    terrain,
    obstacles,
    variants
  };

  // Include elevation if requested
  if (includeElevation) {
    returnValue.elevation = elevationGrid;
    returnValue.elevationFormat = 'normalized';
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
    const repairIterations = validationResult.repairIterations ?? 0;
    const finalObstacleCount = obstacles.reduce(
      (count, row) => count + (Array.isArray(row) ? row.filter(Boolean).length : 0),
      0
    );

    returnValue.metadata = {
      ...pipelineResult.metadata,
      obstacleCount: finalObstacleCount,
      archetype: archetype.name,
      styleProfile: effectiveStyleProfile,
      constraints: archetype.constraints,
      validationResult: {
        iterations: repairIterations,
        repaired: repairIterations > 0,
        finalAnalysis: validationResult.metrics
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
 * Uses the archetype-based procedural generation system with:
 * - PRNG Streams for deterministic isolation
 * - Curated algorithm pipelines per archetype
 * - Constraint validation and automatic repair
 * - Tactical cover placement
 *
 * @param {number} seed - Seed value for deterministic generation
 * @param {string} nodeType - Biome/node type (forest, cave, mountain, bridge, castle)
 * @param {number} width - Map width in tiles, integer >= 10 (default 32)
 * @param {number} height - Map height in tiles, integer >= 10 (default 32)
 * @param {Object} options - Optional generation parameters
 * @param {string} options.archetypeName - Explicit archetype to use (overrides node type selection)
 * @param {boolean} options.elevation - Include elevation data (default true)
 * @param {boolean} options.includeMetadata - Include generation metadata (default false)
 * @param {boolean} options.includeSpawns - Generate spawn positions (default false)
 * @param {number} options.playerCount - Number of player spawn slots (default 15)
 * @param {string} options.enemyAiType - AI type for enemy spawn positioning
 * @param {number} options.enemyCount - Number of enemies to spawn
 * @param {string[]} options.enemyRoles - Optional roles for tactical spawn positioning
 * @param {string} options.styleProfile - Style profile for parameter tuning
 * @returns {Object} { terrain, obstacles, variants, elevation?, playerSpawns?, enemySpawns?, metadata? }
 */
export function generateTerrain(seed, nodeType, width = 32, height = 32, options = {}) {
  validateMapDimensions(width, height, nodeType);
  return generateWithArchetypes(seed, nodeType, width, height, options);
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
export { SpawnPlacer, AI_SPAWN_CONFIGS, scaleSpawnXRange };

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
