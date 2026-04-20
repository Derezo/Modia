/**
 * @module encounterService
 * @description Handles battle encounter generation including terrain, enemies, and map seeds.
 *
 * Key responsibilities:
 * - Map seed generation with configurable modulus
 * - Terrain generation with elevation validation
 * - Encounter setup orchestration
 *
 * @see ../enemyService.js - Enemy group generation
 * @see ../../../../shared/mapGeneration.js - Terrain generation algorithms
 */

import { generateTerrain } from '../../../../shared/mapGeneration.js';

/**
 * Modulus for map seed generation.
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
 * Generate a random map seed for battle terrain generation.
 * @returns {number} Integer seed in range [0, MAP_SEED_MODULUS)
 */
export function generateMapSeed() {
  return Math.floor(Math.random() * MAP_SEED_MODULUS);
}

/**
 * Generate battle terrain with elevation data.
 *
 * @param {number} mapSeed - Seed for deterministic terrain generation
 * @param {string} nodeType - Node type (forest, cave, mountain, etc.)
 * @param {number} [width=32] - Map width in tiles
 * @param {number} [height=32] - Map height in tiles
 * @returns {{terrain: number[][], elevation: number[][]|null, mapSeed: number, mapWidth: number, mapHeight: number}}
 */
export function generateBattleTerrain(mapSeed, nodeType, width = DEFAULT_MAP_WIDTH, height = DEFAULT_MAP_HEIGHT) {
  // Generate terrain with elevation using shared module
  const mapData = generateTerrain(mapSeed, nodeType, width, height, { elevation: true });
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
    mapSeed,
    mapWidth: width,
    mapHeight: height
  };
}

/**
 * Generate a complete battle encounter including terrain and map data.
 * This is the main entry point for PvE battle initialization.
 *
 * @param {string} nodeType - Node type for terrain generation
 * @param {number} [width=32] - Map width
 * @param {number} [height=32] - Map height
 * @returns {{terrain: number[][], elevation: number[][]|null, mapSeed: number, mapWidth: number, mapHeight: number}}
 */
export function generateEncounterTerrain(nodeType, width = DEFAULT_MAP_WIDTH, height = DEFAULT_MAP_HEIGHT) {
  const mapSeed = generateMapSeed();
  return generateBattleTerrain(mapSeed, nodeType, width, height);
}
