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
  CLASS_ADVANCEMENT,
  ADVANCEMENT_LEVEL_REQUIREMENT,
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
  generateTerrain,
  generateTerrainOnly,
  generateSpawnPositions,
  validateSpawnPositions,
  SpawnPlacer,
  AI_SPAWN_CONFIGS
} from './mapGeneration.js';

// Pathfinding
export {
  getReachableTiles,
  calculatePathCost,
  findPath,
  getManhattanDistance,
  getAttackableTiles
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
  getAssetUrl,
  getLegacyPath,
  getStandardizedPath,
  getOutputPath,
  getAllSizeVariants,
  isValidSize,
  getDefaultSize,
  parseAssetFilename
} from './assetPaths.js';
