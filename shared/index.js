/**
 * Shared Module Index - Re-exports for convenience
 *
 * Usage:
 *   import { SeededRandom, RACES } from '@modia/shared';
 *   import { generateTerrain } from '@modia/shared/mapGeneration';
 *   import * as terrain from '@modia/shared/terrain';
 */

// Constants
export {
  RACES,
  CLASSES,
  ADVANCED_CLASSES,
  GENDERS,
  NODE_TYPES,
  BATTLE_NODE_TYPES,
  CASTLE_FEATURES,
  CITY_OPTIONS,
  MAX_PARTY_SIZE,
  MAX_BATTLE_PARTY_SIZE,
  MAX_CHARACTER_LEVEL,
  STARTING_GOLD,
  STARTING_EXPERIENCE,
  MAX_GOLD,
  RACE_BASE_STATS,
  CLASS_GROWTH,
  CLASS_MOVEMENT,
  SeededRandom,
  expForLevel,
  calculateStats
} from './constants.js';

// Name data
export { NAME_POOLS } from './nameData.js';

// Terrain
export {
  IMPASSABLE_TERRAIN,
  TERRAIN_COSTS,
  TERRAIN_WEIGHTS,
  isImpassable,
  getTerrainMovementCost,
  getTerrainWeights,
  getTerrainColor
} from './terrain.js';

// Map Generation
export {
  DEFAULT_LEGACY_TERRAIN_GENERATION_VERSION,
  SUPPORTED_TERRAIN_GENERATION_VERSIONS,
  UnsupportedTerrainGenerationVersionError,
  dispatchBattleMapGeneration,
  generateBattleMap,
  generateBattleMapV2,
  normalizeBattleMapV2Request,
  generateTerrain,
  generateTerrainOnly,
  generateSpawnPositions,
  validateSpawnPositions,
  SpawnPlacer,
  AI_SPAWN_CONFIGS
} from './mapGeneration.js';

export {
  V2_GENERATOR_AVAILABLE,
  V2_PRODUCTION_NODE_TYPES,
  getV2Recipe,
  V2_RENDER_CAPABILITY_CATALOG,
  getV2VisualCapabilities,
  ORGANIC_QUALITY_THRESHOLDS,
  evaluateOrganicQuality,
  measureOrganicQuality,
  validateHydrologyIntegrity
} from './mapgen/v2/index.js';

// Versioned Battle Map contract
export * from './battleMap/index.js';
export * from './battleStateProtocol.js';

// Pathfinding
export {
  getReachableTiles,
  calculatePathCost,
  findPath,
  getManhattanDistance,
  getAttackableTiles,
  DEFAULT_MOVEMENT_POLICY,
  createTraversalView,
  validateTraversalView,
  isWithinTraversalBounds,
  getTraversalOccupant,
  getElevationConnection,
  canEnterTile,
  getStepCost,
  getReachableTilesForTraversal,
  calculateTraversalPathCost,
  findTraversalPath
} from './pathfinding.js';

// Battle Math
export {
  calculatePhysicalDamage,
  calculateMagicalDamage,
  calculateHealing,
  calculateHitChance,
  calculateCritChance,
  calculateCritMultiplier,
  calculateDamagePreview,
  calculateInitiative
} from './battleMath.js';

// Asset Paths
export {
  SIZE_PRESETS,
  DEFAULT_SIZES,
  ASSET_CATEGORIES,
  ENEMY_BIOME_ALIASES,
  NPC_PRIMARY_BIOMES,
  ENEMY_PRIMARY_BIOMES,
  getAssetPath,
  getNpcVisualIdentity,
  getNpcSpriteBiomeCandidates,
  getNpcCharacterPathCandidates,
  getNpcPortraitId,
  resolveEnemyBiomeAlias,
  getOriginalsPath,
  getOutputPath,
  getAllSizeVariants,
  isValidSize,
  getDefaultSize,
  getOptimalSize,
  parseAssetFilename
} from './assetPaths.js';
