import {
  BattleMapV3RecordShapes,
  BATTLE_MAP_V3_SCHEMA_VERSION,
  BATTLE_MAP_V3_TERRAIN_GENERATION_VERSION,
  assertBattleMapV3Final,
  loadAndFreezeBattleMapV3Final,
  normalizeBattleMapV3Final
} from './v3/index.js';
import {
  deepCloneJsonValue,
  deepFreeze
} from './canonicalJson.js';

const MAP_FIELDS = Object.freeze([...BattleMapV3RecordShapes.final]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoMapFields(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object`);
  for (const key of MAP_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${label}.${key} cannot shadow immutable BattleMapV3 data`);
    }
  }
}

function pickMapFields(flatState) {
  return Object.fromEntries(
    MAP_FIELDS
      .filter(key => Object.prototype.hasOwnProperty.call(flatState, key))
      .map(key => [key, flatState[key]])
  );
}

/**
 * Project a verified immutable BattleMapV3 and its mutable combat state into
 * the existing persisted flat-state column. V3 map fields are closed and
 * cannot be shadowed by mutable records.
 */
export async function battleMapV3ToFlatState(finalMap, mutableState = {}) {
  const normalizedMap = await normalizeBattleMapV3Final(finalMap);
  assertNoMapFields(mutableState, 'mutableState');
  return deepFreeze(deepCloneJsonValue({ ...mutableState, ...normalizedMap }));
}

/**
 * Load only an explicitly versioned 3/3 flat state. Unknown, absent, crossed,
 * and legacy version pairs fail here instead of entering the V1 adapter.
 */
export async function battleMapV3FromFlatState(flatState) {
  if (!isPlainObject(flatState)) throw new TypeError('flatState must be a plain object');
  if (flatState.battleMapSchemaVersion !== BATTLE_MAP_V3_SCHEMA_VERSION
    || flatState.terrainGenerationVersion !== BATTLE_MAP_V3_TERRAIN_GENERATION_VERSION) {
    throw new TypeError('Flat state is not BattleMapV3');
  }
  const map = pickMapFields(flatState);
  assertBattleMapV3Final(map);
  return loadAndFreezeBattleMapV3Final(map);
}

export async function splitBattleMapV3FlatState(flatState) {
  const map = await battleMapV3FromFlatState(flatState);
  const mutableState = {};
  for (const [key, value] of Object.entries(flatState)) {
    if (!MAP_FIELDS.includes(key)) mutableState[key] = value;
  }
  return deepFreeze({
    map,
    mutableState: deepCloneJsonValue(mutableState)
  });
}

export const BattleMapV3Adapter = Object.freeze({
  toFlatState: battleMapV3ToFlatState,
  fromFlatState: battleMapV3FromFlatState,
  splitFlatState: splitBattleMapV3FlatState
});

export { MAP_FIELDS as BATTLE_MAP_V3_FLAT_FIELDS };
