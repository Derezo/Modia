import {
  assertBattleMapV2Final,
  BATTLE_MAP_SCHEMA_VERSION,
  TERRAIN_GENERATION_VERSION
} from './schema.js';
import {
  assertVerifiedBattleMapV2Final,
  loadAndFreezeBattleMapV2Final
} from './hashes.js';
import {
  deepCloneJsonValue,
  deepFreeze
} from './canonicalJson.js';

const MAP_FIELDS = Object.freeze([
  'battleMapSchemaVersion', 'terrainGenerationVersion', 'terrainSeed',
  'mapWidth', 'mapHeight', 'nodeType', 'biome', 'archetype', 'elevationFormat',
  'terrain', 'elevation', 'elevationConnections', 'obstacles', 'spawnLayout',
  'variants', 'transitions', 'decorations', 'features', 'diagnostics'
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertNoMapFields(value, label) {
  if (!isObject(value)) throw new TypeError(`${label} must be an object`);
  for (const key of MAP_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${label}.${key} cannot shadow immutable BattleMapV2 data`);
    }
  }
}

function pickMapFields(flatState) {
  return Object.fromEntries(MAP_FIELDS.map(key => [key, flatState[key]]));
}

/**
 * Maps the one immutable nested value into the existing flat battle-state
 * representation. Mutable fields cannot shadow any map field.
 */
export async function battleMapV2ToFlatState(finalMap, mutableState = {}) {
  await assertVerifiedBattleMapV2Final(finalMap);
  assertNoMapFields(mutableState, 'mutableState');
  return deepFreeze(deepCloneJsonValue({ ...mutableState, ...finalMap }));
}

/**
 * Loads only an explicitly versioned V2 flat state. Missing version fields are
 * corruption here; callers must deliberately select loadLegacyFlatBattleState.
 */
export async function battleMapV2FromFlatState(flatState) {
  if (!isObject(flatState)) throw new TypeError('flatState must be an object');
  if (!Object.prototype.hasOwnProperty.call(flatState, 'battleMapSchemaVersion')
    || !Object.prototype.hasOwnProperty.call(flatState, 'terrainGenerationVersion')) {
    throw new TypeError('Versioned BattleMapV2 load requires both version fields');
  }
  if (flatState.battleMapSchemaVersion !== BATTLE_MAP_SCHEMA_VERSION
    || flatState.terrainGenerationVersion !== TERRAIN_GENERATION_VERSION) {
    throw new TypeError('Flat state is not BattleMapV2');
  }
  const map = pickMapFields(flatState);
  assertBattleMapV2Final(map);
  return loadAndFreezeBattleMapV2Final(map);
}

/**
 * Separates a flat state without dropping either its immutable map or mutable
 * fields. This is useful for repository/wire adapters during the migration.
 */
export async function splitBattleMapV2FlatState(flatState) {
  const map = await battleMapV2FromFlatState(flatState);
  const mutableState = {};
  for (const [key, value] of Object.entries(flatState)) {
    if (!MAP_FIELDS.includes(key)) mutableState[key] = value;
  }
  return deepFreeze({
    map,
    mutableState: deepCloneJsonValue(mutableState)
  });
}

/**
 * The sole compatibility path that interprets absent versions as V1. It does
 * not fabricate V2 layers or hashes.
 */
export function loadLegacyFlatBattleState(flatState) {
  if (!isObject(flatState)) throw new TypeError('flatState must be an object');
  const schemaVersion = flatState.battleMapSchemaVersion ?? 1;
  const generationVersion = flatState.terrainGenerationVersion ?? 1;
  if (schemaVersion !== 1 || generationVersion !== 1) {
    throw new TypeError('Legacy loader accepts only version 1 or absent versions');
  }
  return deepFreeze(deepCloneJsonValue({
    ...flatState,
    battleMapSchemaVersion: 1,
    terrainGenerationVersion: 1
  }));
}

export const BattleMapAdapter = Object.freeze({
  toFlatState: battleMapV2ToFlatState,
  fromFlatState: battleMapV2FromFlatState,
  splitFlatState: splitBattleMapV2FlatState,
  loadLegacyFlatState: loadLegacyFlatBattleState
});

export { MAP_FIELDS as BATTLE_MAP_V2_FLAT_FIELDS };
