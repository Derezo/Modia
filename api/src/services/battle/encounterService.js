/**
 * @module encounterService
 * @description Handles battle encounter generation including terrain, enemies, and map seeds.
 *
 * Key responsibilities:
 * - Legacy random map seed generation with a configurable modulus
 * - Stable signed 32-bit terrain seed derivation from world-node identity
 * - Terrain generation with elevation validation
 * - Encounter setup orchestration
 *
 * @see ../enemyService.js - Enemy group generation
 * @see ../../../../shared/mapGeneration.js - Terrain generation algorithms
 */

import { dispatchBattleMapGeneration } from '../../../../shared/mapGeneration.js';

/**
 * Modulus for legacy random map seed generation.
 * Seeds are integers in range [0, MAP_SEED_MODULUS).
 * Using 1,000,000 provides sufficient variety while keeping seeds human-readable.
 */
export const MAP_SEED_MODULUS = 1_000_000;

/**
 * Default battle map dimensions
 */
export const DEFAULT_MAP_WIDTH = 32;
export const DEFAULT_MAP_HEIGHT = 32;

/**
 * Version of the node-seed-to-tactical-map contract.
 *
 * Increment this when either the seed derivation or terrain generation contract
 * changes. Active battles retain this value together with their authoritative
 * map layers, so reconnects never need to regenerate terrain.
 */
export const TERRAIN_GENERATION_VERSION = 1;

/**
 * Fixed namespace for tactical terrain seeds. Keeping this derivation local to
 * encounter terrain prevents enemy selection, placement, and combat randomness
 * from sharing or advancing the terrain stream.
 */
const TERRAIN_SEED_NAMESPACE = 'modia:tactical-terrain';

/**
 * Generate a random map seed for battle terrain generation.
 * @returns {number} Integer seed in range [0, MAP_SEED_MODULUS)
 */
export function generateMapSeed() {
  return Math.floor(Math.random() * MAP_SEED_MODULUS);
}

/**
 * Derive the tactical terrain seed from the stable world-node contract.
 *
 * @param {number|string} localSeed - Persisted world_nodes.local_seed
 * @param {string} nodeType - Node type used by the terrain generator
 * @param {number} [terrainGenerationVersion=1] - Versioned derivation contract
 * @returns {number} Signed 32-bit integer seed
 */
export function deriveEncounterTerrainSeed(
  localSeed,
  nodeType,
  terrainGenerationVersion = TERRAIN_GENERATION_VERSION
) {
  const numericLocalSeed = typeof localSeed === 'string'
    ? Number(localSeed)
    : localSeed;

  if (!Number.isSafeInteger(numericLocalSeed)) {
    throw new TypeError('Encounter terrain localSeed must be a safe integer');
  }
  if (typeof nodeType !== 'string' || nodeType.length === 0) {
    throw new TypeError('Encounter terrain nodeType must be a non-empty string');
  }
  if (!Number.isSafeInteger(terrainGenerationVersion) || terrainGenerationVersion < 1) {
    throw new TypeError('Encounter terrain generation version must be a positive integer');
  }

  // FNV-1a provides a stable 32-bit mix for the explicit, versioned contract.
  const contract = `${TERRAIN_SEED_NAMESPACE}:${terrainGenerationVersion}:${nodeType}:${numericLocalSeed}`;
  let hash = 0x811C9DC5;
  for (let index = 0; index < contract.length; index++) {
    hash ^= contract.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash | 0;
}

/**
 * Generate battle terrain with elevation data.
 *
 * @param {number} mapSeed - Seed for deterministic terrain generation
 * @param {string} nodeType - Node type (forest, cave, mountain, etc.)
 * @param {number} [width=32] - Map width in tiles
 * @param {number} [height=32] - Map height in tiles
 * @param {number} [terrainGenerationVersion=1] - Explicit generator version
 * @returns {{terrain: number[][], elevation: number[][]|null, mapSeed: number, mapWidth: number, mapHeight: number}}
 */
export function generateBattleTerrain(
  mapSeed,
  nodeType,
  width = DEFAULT_MAP_WIDTH,
  height = DEFAULT_MAP_HEIGHT,
  terrainGenerationVersion = TERRAIN_GENERATION_VERSION
) {
  const mapData = dispatchBattleMapGeneration({
    terrainGenerationVersion,
    terrainSeed: mapSeed,
    nodeType,
    mapWidth: width,
    mapHeight: height,
    options: { elevation: true }
  });
  const terrain = mapData.terrain;

  // Validate elevation data before returning
  let elevation = mapData.elevation;
  if (elevation && (!Array.isArray(elevation) || elevation.length !== height ||
      !elevation[0] || elevation[0].length !== width)) {
    console.warn('[Encounter] Invalid elevation data dimensions, using flat map');
    elevation = null;  // Fall back to 2D pathfinding
  }

  return {
    terrain,
    elevation,
    elevationFormat: mapData.elevationFormat,
    obstacles: mapData.obstacles,
    variants: mapData.variants,
    mapSeed,
    mapWidth: width,
    mapHeight: height
  };
}

/**
 * Generate a complete battle encounter including terrain and map data.
 * This is the main entry point for PvE battle initialization.
 *
 * The preferred call shape is an explicit stable contract:
 * `generateEncounterTerrain({ nodeType, localSeed, terrainGenerationVersion })`.
 * The legacy `(nodeType, width, height)` form remains random for compatibility.
 *
 * @param {string|{nodeType: string, localSeed: number|string, terrainGenerationVersion?: number, width?: number, height?: number}} contractOrNodeType
 *   Stable encounter contract or legacy node type
 * @param {number} [width=32] - Map width
 * @param {number} [height=32] - Map height
 * @returns {{terrain: number[][], elevation: number[][]|null, mapSeed: number, mapWidth: number, mapHeight: number, terrainGenerationVersion?: number}}
 */
export function generateEncounterTerrain(
  contractOrNodeType,
  width = DEFAULT_MAP_WIDTH,
  height = DEFAULT_MAP_HEIGHT
) {
  if (contractOrNodeType && typeof contractOrNodeType === 'object') {
    const {
      nodeType,
      localSeed,
      terrainGenerationVersion = TERRAIN_GENERATION_VERSION,
      width: contractWidth = width,
      height: contractHeight = height
    } = contractOrNodeType;
    const mapSeed = deriveEncounterTerrainSeed(localSeed, nodeType, terrainGenerationVersion);

    return {
      ...generateBattleTerrain(
        mapSeed,
        nodeType,
        contractWidth,
        contractHeight,
        terrainGenerationVersion
      ),
      terrainGenerationVersion
    };
  }

  const nodeType = contractOrNodeType;
  const mapSeed = generateMapSeed();
  return generateBattleTerrain(mapSeed, nodeType, width, height);
}
