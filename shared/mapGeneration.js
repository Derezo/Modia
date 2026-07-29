/**
 * Versioned battle-map generation facade.
 *
 * The implementation for terrain generation version 1 is isolated under
 * `mapgen/v1/`. Calls through the legacy positional API intentionally default
 * to V1 for compatibility; normalized authoritative calls must use
 * `dispatchBattleMapGeneration` and provide a version explicitly.
 */

import {
  generateTerrain as generateTerrainV1,
  generateTerrainOnly as generateTerrainOnlyV1
} from './mapgen/v1/mapGenerationV1.js';
import {
  generateBattleMapV2,
  normalizeBattleMapV2Request
} from './mapgen/v2/BattleMapGenerator.js';

export const SUPPORTED_TERRAIN_GENERATION_VERSIONS = Object.freeze([1, 2]);
export const DEFAULT_LEGACY_TERRAIN_GENERATION_VERSION = 1;

export class UnsupportedTerrainGenerationVersionError extends RangeError {
  constructor(version) {
    super(`Unsupported terrain generation version: ${String(version)}`);
    this.name = 'UnsupportedTerrainGenerationVersionError';
    this.code = 'UNSUPPORTED_TERRAIN_GENERATION_VERSION';
    this.terrainGenerationVersion = version;
  }
}

/**
 * Dispatch a normalized, explicitly versioned generation request.
 *
 * @param {object} request
 * @param {number} request.terrainGenerationVersion
 * @param {number} request.terrainSeed
 * @param {string} request.nodeType
 * @param {number} [request.mapWidth=32]
 * @param {number} [request.mapHeight=32]
 * @param {object} [request.options]
 * Version 1 returns synchronously for compatibility. Version 2 returns a
 * promise because final hashes are produced with the Web Crypto API.
 *
 * @returns {object|Promise<object>}
 */
export function dispatchBattleMapGeneration(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('Battle-map generation request must be an object');
  }

  const {
    terrainGenerationVersion,
    terrainSeed,
    nodeType,
    mapWidth = 32,
    mapHeight = 32,
    options = {}
  } = request;

  if (!Number.isInteger(terrainGenerationVersion)) {
    throw new TypeError('terrainGenerationVersion must be an explicit integer');
  }

  switch (terrainGenerationVersion) {
    case 1:
      return generateTerrainV1(terrainSeed, nodeType, mapWidth, mapHeight, options);
    case 2:
      if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('BattleMapV2 generation options must be an object');
      }
      // generateBattleMapV2 owns request normalization. Passing an already
      // normalized request through it a second time would expose internal
      // sentinel values such as maxAttempts:null as public input.
      return generateBattleMapV2({
        terrainSeed,
        nodeType,
        mapWidth,
        mapHeight,
        ...options
      });
    default:
      throw new UnsupportedTerrainGenerationVersionError(terrainGenerationVersion);
  }
}

export const generateBattleMap = dispatchBattleMapGeneration;

/**
 * @deprecated New authoritative callers must use dispatchBattleMapGeneration.
 */
export function generateTerrain(seed, nodeType, width = 32, height = 32, options = {}) {
  const {
    terrainGenerationVersion = DEFAULT_LEGACY_TERRAIN_GENERATION_VERSION,
    ...legacyOptions
  } = options || {};

  return dispatchBattleMapGeneration({
    terrainGenerationVersion,
    terrainSeed: seed,
    nodeType,
    mapWidth: width,
    mapHeight: height,
    options: legacyOptions
  });
}

/**
 * @deprecated New authoritative callers must use dispatchBattleMapGeneration.
 */
export function generateTerrainOnly(seed, nodeType, width = 32, height = 32, options = {}) {
  if (!options || Object.keys(options).length === 0) {
    return generateTerrainOnlyV1(seed, nodeType, width, height);
  }
  return generateTerrain(seed, nodeType, width, height, options).terrain;
}

// Compatibility exports remain available without putting mutable runtime or V2
// modules on the frozen V1 generator's import graph.
export * from './mapgen/v1/mapGenerationV1.js';
export {
  generateBattleMapV2,
  normalizeBattleMapV2Request
} from './mapgen/v2/BattleMapGenerator.js';
