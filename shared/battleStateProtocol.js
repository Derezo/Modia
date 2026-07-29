import {
  BATTLE_MAP_HASH_VERSION,
  BATTLE_MAP_SCHEMA_VERSION,
  BATTLE_MAP_V2_FLAT_FIELDS,
  TERRAIN_GENERATION_VERSION,
  assertBattleMapV2Final
} from './battleMap/index.js';
import { deepCloneJsonValue, deepFreeze } from './battleMap/canonicalJson.js';

export const BATTLE_MUTABLE_STATE_PROTOCOL_VERSION = 1;

export const BATTLE_STATE_BYTE_BUDGETS = deepFreeze({
  persistedMapUncompressed: 2_000_000,
  initialSnapshotUncompressed: 4_000_000,
  mutableUpdateUncompressed: 1_000_000,
  initialSnapshotCompressed: 1_250_000,
  mutableUpdateCompressed: 256_000
});

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const UPDATE_ID_PATTERN = /^[^:]+:[0-9]+$/;
const MAX_JSON_DEPTH = 20;
const MAX_JSON_ENTRIES = 50_000;
const MAX_JSON_STRING_LENGTH = 100_000;

/**
 * This is the complete top-level mutable state vocabulary for protocol V1.
 * Nested combat records remain bounded JSON values because skills, effects,
 * equipment, boss phases, and reward records already have independently
 * versioned gameplay catalogs. No immutable map field is legal anywhere at
 * this boundary.
 */
export const BATTLE_MUTABLE_STATE_V1_FIELDS = deepFreeze([
  'turn',
  'turnCount',
  'round',
  'phase',
  'activeUnitIndex',
  'activeUnitId',
  'activeUnit',
  'currentActorIndex',
  'status',
  'battleType',
  'player1Id',
  'player2Id',
  'debugOptions',
  'units',
  'consumables',
  'bossStates',
  'turnPredictions',
  'log',
  'disconnectedPlayers',
  'abandonedPlayers',
  'winnerId',
  'rewards',
  'endedAt',
  'isAdvancementBattle',
  'challengerCharacterId'
]);

const MUTABLE_ARRAY_FIELDS = new Set([
  'units',
  'consumables',
  'turnPredictions',
  'log',
  'disconnectedPlayers',
  'abandonedPlayers'
]);

const MUTABLE_OBJECT_FIELDS = new Set(['debugOptions', 'bossStates']);
const NULLABLE_FIELDS = new Set([
  'activeUnitId',
  'activeUnit',
  'winnerId',
  'rewards',
  'endedAt',
  'player2Id',
  'challengerCharacterId'
]);

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object`);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertNonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer`);
  }
}

function assertClosedKeys(value, keys, label) {
  assertPlainObject(value, label);
  for (const key of keys) {
    if (!own(value, key)) throw new TypeError(`${label}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new TypeError(`${label}.${key} is not allowed`);
  }
}

function assertBoundedJson(value, label, state = { entries: 0 }, depth = 0) {
  if (depth > MAX_JSON_DEPTH) throw new TypeError(`${label} exceeds maximum JSON depth`);
  state.entries += 1;
  if (state.entries > MAX_JSON_ENTRIES) throw new TypeError(`${label} exceeds maximum JSON entries`);

  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must contain only finite numbers`);
    return;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_JSON_STRING_LENGTH) throw new TypeError(`${label} contains an oversized string`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertBoundedJson(entry, `${label}[${index}]`, state, depth + 1));
    return;
  }
  if (!isPlainObject(value)) throw new TypeError(`${label} must contain only JSON values`);
  for (const [key, entry] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new TypeError(`${label}.${key} is forbidden`);
    }
    assertBoundedJson(entry, `${label}.${key}`, state, depth + 1);
  }
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function assertWithinUncompressedBudget(value, budget, label) {
  const size = utf8ByteLength(value);
  if (size > budget) throw new RangeError(`${label} is ${size} bytes; budget is ${budget}`);
  return size;
}

function assertNoImmutableMapFields(value, label) {
  assertPlainObject(value, label);
  for (const key of BATTLE_MAP_V2_FLAT_FIELDS) {
    if (own(value, key)) throw new TypeError(`${label}.${key} is immutable map data`);
  }
  if (own(value, 'mapSeed') || own(value, 'collision') || own(value, 'map')) {
    throw new TypeError(`${label} cannot carry a map alias or collision grid`);
  }
}

export function createBattleMutableStateV1(input = {}, lifecycle = {}) {
  assertPlainObject(input, 'input');
  assertPlainObject(lifecycle, 'lifecycle');
  assertNoImmutableMapFields(input, 'input');

  for (const key of Object.keys(input)) {
    if (!BATTLE_MUTABLE_STATE_V1_FIELDS.includes(key)) {
      throw new TypeError(`input.${key} is not part of BattleMutableStateV1`);
    }
  }
  for (const key of Object.keys(lifecycle)) {
    if (!BATTLE_MUTABLE_STATE_V1_FIELDS.includes(key)) {
      throw new TypeError(`lifecycle.${key} is not part of BattleMutableStateV1`);
    }
  }

  const source = { ...input, ...lifecycle };
  const mutable = {};
  for (const key of BATTLE_MUTABLE_STATE_V1_FIELDS) {
    if (own(source, key)) {
      mutable[key] = source[key];
    } else if (MUTABLE_ARRAY_FIELDS.has(key)) {
      mutable[key] = [];
    } else if (MUTABLE_OBJECT_FIELDS.has(key)) {
      mutable[key] = {};
    } else if (NULLABLE_FIELDS.has(key)) {
      mutable[key] = null;
    } else {
      switch (key) {
        case 'turn':
        case 'turnCount':
        case 'round':
        case 'activeUnitIndex':
        case 'currentActorIndex':
          mutable[key] = 0;
          break;
        case 'phase':
          mutable[key] = 'active';
          break;
        case 'status':
          mutable[key] = 'active';
          break;
        case 'battleType':
          mutable[key] = 'pve';
          break;
        case 'player1Id':
          mutable[key] = null;
          break;
        case 'isAdvancementBattle':
          mutable[key] = false;
          break;
        default:
          throw new TypeError(`No BattleMutableStateV1 default for ${key}`);
      }
    }
  }
  assertBattleMutableStateV1(mutable);
  assertWithinUncompressedBudget(
    mutable,
    BATTLE_STATE_BYTE_BUDGETS.mutableUpdateUncompressed,
    'BattleMutableStateV1'
  );
  return deepFreeze(deepCloneJsonValue(mutable));
}

export function assertBattleMutableStateV1(value) {
  assertClosedKeys(value, BATTLE_MUTABLE_STATE_V1_FIELDS, 'BattleMutableStateV1');
  assertNoImmutableMapFields(value, 'BattleMutableStateV1');

  for (const key of MUTABLE_ARRAY_FIELDS) {
    if (!Array.isArray(value[key])) throw new TypeError(`BattleMutableStateV1.${key} must be an array`);
  }
  for (const key of MUTABLE_OBJECT_FIELDS) {
    assertPlainObject(value[key], `BattleMutableStateV1.${key}`);
  }
  for (const key of NULLABLE_FIELDS) {
    if (value[key] !== null) assertBoundedJson(value[key], `BattleMutableStateV1.${key}`);
  }
  if (value.player1Id !== null && !['number', 'string'].includes(typeof value.player1Id)) {
    throw new TypeError('BattleMutableStateV1.player1Id must be a string, number, or null');
  }
  if (typeof value.isAdvancementBattle !== 'boolean') {
    throw new TypeError('BattleMutableStateV1.isAdvancementBattle must be a boolean');
  }
  assertBoundedJson(value, 'BattleMutableStateV1');
  return value;
}

const UPDATE_KEYS = deepFreeze([
  'protocolVersion',
  'battleId',
  'battleMapSchemaVersion',
  'terrainGenerationVersion',
  'fullHash',
  'baseStateRevision',
  'stateRevision',
  'updateId',
  'mutableState'
]);

export function createBattleMutableStateUpdateV1({
  battleId,
  battleMapSchemaVersion,
  terrainGenerationVersion,
  fullHash,
  baseStateRevision,
  stateRevision,
  mutableState
}) {
  const update = {
    protocolVersion: BATTLE_MUTABLE_STATE_PROTOCOL_VERSION,
    battleId,
    battleMapSchemaVersion,
    terrainGenerationVersion,
    fullHash,
    baseStateRevision,
    stateRevision,
    updateId: `${battleId}:${stateRevision}`,
    mutableState
  };
  assertBattleMutableStateUpdateV1(update);
  assertWithinUncompressedBudget(
    update,
    BATTLE_STATE_BYTE_BUDGETS.mutableUpdateUncompressed,
    'BattleMutableStateUpdateV1'
  );
  return deepFreeze(deepCloneJsonValue(update));
}

export function assertBattleMutableStateUpdateV1(value) {
  assertClosedKeys(value, UPDATE_KEYS, 'BattleMutableStateUpdateV1');
  if (value.protocolVersion !== BATTLE_MUTABLE_STATE_PROTOCOL_VERSION) {
    throw new TypeError('BattleMutableStateUpdateV1.protocolVersion must equal 1');
  }
  if (!['number', 'string'].includes(typeof value.battleId) || String(value.battleId).length === 0) {
    throw new TypeError('BattleMutableStateUpdateV1.battleId must be a number or string');
  }
  assertNonnegativeInteger(value.baseStateRevision, 'BattleMutableStateUpdateV1.baseStateRevision');
  assertNonnegativeInteger(value.stateRevision, 'BattleMutableStateUpdateV1.stateRevision');
  if (value.stateRevision !== value.baseStateRevision + 1) {
    throw new TypeError('BattleMutableStateUpdateV1.stateRevision must equal baseStateRevision + 1');
  }
  if (value.battleMapSchemaVersion !== 1 && value.battleMapSchemaVersion !== BATTLE_MAP_SCHEMA_VERSION) {
    throw new TypeError('BattleMutableStateUpdateV1.battleMapSchemaVersion is unsupported');
  }
  if (value.terrainGenerationVersion !== 1 && value.terrainGenerationVersion !== TERRAIN_GENERATION_VERSION) {
    throw new TypeError('BattleMutableStateUpdateV1.terrainGenerationVersion is unsupported');
  }
  if (value.battleMapSchemaVersion === 2) {
    if (typeof value.fullHash !== 'string' || !HASH_PATTERN.test(value.fullHash)) {
      throw new TypeError('BattleMutableStateUpdateV1.fullHash must be a V2 sha256 hash');
    }
  } else if (value.fullHash !== null) {
    throw new TypeError('BattleMutableStateUpdateV1.fullHash must be null for V1 maps');
  }
  assertNonEmptyString(value.updateId, 'BattleMutableStateUpdateV1.updateId');
  if (!UPDATE_ID_PATTERN.test(value.updateId)
    || value.updateId !== `${value.battleId}:${value.stateRevision}`) {
    throw new TypeError('BattleMutableStateUpdateV1.updateId must equal battleId:stateRevision');
  }
  assertBattleMutableStateV1(value.mutableState);
  return value;
}

export function applyBattleMutableStateUpdateV1(current, update) {
  assertPlainObject(current, 'current');
  assertBattleMutableStateUpdateV1(update);
  assertNonnegativeInteger(current.stateRevision, 'current.stateRevision');

  const sameMap = current.battleMapSchemaVersion === update.battleMapSchemaVersion
    && current.terrainGenerationVersion === update.terrainGenerationVersion
    && current.fullHash === update.fullHash;
  if (!sameMap) {
    return deepFreeze({ status: 'resync_required', reason: 'map_reference_mismatch' });
  }
  if (update.stateRevision < current.stateRevision) {
    return deepFreeze({ status: 'duplicate', reason: 'older_revision' });
  }
  if (update.stateRevision === current.stateRevision) {
    if (current.updateId === update.updateId) {
      return deepFreeze({ status: 'duplicate', reason: 'known_update' });
    }
    return deepFreeze({ status: 'resync_required', reason: 'revision_conflict' });
  }
  if (update.baseStateRevision !== current.stateRevision) {
    return deepFreeze({ status: 'resync_required', reason: 'revision_gap' });
  }
  return deepFreeze({
    status: 'applied',
    stateRevision: update.stateRevision,
    updateId: update.updateId,
    mutableState: deepCloneJsonValue(update.mutableState)
  });
}

const CAPABILITY_KEYS = deepFreeze([
  'supportedBattleMapSchemaVersions',
  'supportedHashVersions',
  'supportedMutableStateProtocolVersions',
  'cachedMaps'
]);
const CACHED_MAP_KEYS = deepFreeze([
  'battleMapSchemaVersion',
  'terrainGenerationVersion',
  'fullHash'
]);

export function assertBattleMapCapabilities(value) {
  assertClosedKeys(value, CAPABILITY_KEYS, 'battleMapCapabilities');
  const arrayFields = CAPABILITY_KEYS;
  for (const key of arrayFields) {
    if (!Array.isArray(value[key])) throw new TypeError(`battleMapCapabilities.${key} must be an array`);
  }
  for (const version of value.supportedBattleMapSchemaVersions) {
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new TypeError('supportedBattleMapSchemaVersions must contain positive integers');
    }
  }
  for (const version of value.supportedMutableStateProtocolVersions) {
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new TypeError('supportedMutableStateProtocolVersions must contain positive integers');
    }
  }
  value.supportedHashVersions.forEach((version, index) => {
    assertNonEmptyString(version, `battleMapCapabilities.supportedHashVersions[${index}]`);
  });
  value.cachedMaps.forEach((entry, index) => {
    assertClosedKeys(entry, CACHED_MAP_KEYS, `battleMapCapabilities.cachedMaps[${index}]`);
    assertNonnegativeInteger(
      entry.battleMapSchemaVersion,
      `battleMapCapabilities.cachedMaps[${index}].battleMapSchemaVersion`
    );
    assertNonnegativeInteger(
      entry.terrainGenerationVersion,
      `battleMapCapabilities.cachedMaps[${index}].terrainGenerationVersion`
    );
    if (!HASH_PATTERN.test(entry.fullHash)) {
      throw new TypeError(`battleMapCapabilities.cachedMaps[${index}].fullHash must be a sha256 hash`);
    }
  });
  return value;
}

export function createBattleMapCapabilities({
  supportedBattleMapSchemaVersions = [1],
  supportedHashVersions = [],
  supportedMutableStateProtocolVersions = [1],
  cachedMaps = []
} = {}) {
  const capabilities = {
    supportedBattleMapSchemaVersions: [...new Set(supportedBattleMapSchemaVersions)].sort((a, b) => a - b),
    supportedHashVersions: [...new Set(supportedHashVersions)].sort(),
    supportedMutableStateProtocolVersions: [...new Set(supportedMutableStateProtocolVersions)].sort((a, b) => a - b),
    cachedMaps: [...cachedMaps]
  };
  assertBattleMapCapabilities(capabilities);
  return deepFreeze(deepCloneJsonValue(capabilities));
}

export function negotiateBattleMapCapabilities({
  clientCapabilities,
  existingMap = null,
  allowNewV2 = false
}) {
  if (clientCapabilities === undefined || clientCapabilities === null) {
    if (existingMap?.battleMapSchemaVersion === 2) {
      return deepFreeze({
        compatible: false,
        code: 'battle_map_upgrade_required',
        requiredBattleMapSchemaVersion: 2,
        requiredHashVersion: BATTLE_MAP_HASH_VERSION,
        requiredMutableStateProtocolVersion: 1
      });
    }
    return deepFreeze({
      compatible: true,
      selectedBattleMapSchemaVersion: 1,
      selectedHashVersion: null,
      selectedMutableStateProtocolVersion: 1,
      mapDelivery: 'full'
    });
  }

  assertBattleMapCapabilities(clientCapabilities);
  const requestedVersion = existingMap?.battleMapSchemaVersion
    ?? (allowNewV2 && clientCapabilities.supportedBattleMapSchemaVersions.includes(2) ? 2 : 1);
  const hashVersion = requestedVersion === 2 ? BATTLE_MAP_HASH_VERSION : null;
  const compatible = clientCapabilities.supportedBattleMapSchemaVersions.includes(requestedVersion)
    && clientCapabilities.supportedMutableStateProtocolVersions.includes(1)
    && (requestedVersion !== 2 || clientCapabilities.supportedHashVersions.includes(hashVersion));
  if (!compatible) {
    return deepFreeze({
      compatible: false,
      code: 'battle_map_upgrade_required',
      requiredBattleMapSchemaVersion: requestedVersion,
      requiredHashVersion: hashVersion,
      requiredMutableStateProtocolVersion: 1
    });
  }

  let mapDelivery = 'full';
  if (requestedVersion === 2 && existingMap) {
    const cached = clientCapabilities.cachedMaps.some(entry => (
      entry.battleMapSchemaVersion === existingMap.battleMapSchemaVersion
      && entry.terrainGenerationVersion === existingMap.terrainGenerationVersion
      && entry.fullHash === existingMap.diagnostics?.hashes?.fullHash
    ));
    mapDelivery = cached ? 'cached' : 'full';
  }
  return deepFreeze({
    compatible: true,
    selectedBattleMapSchemaVersion: requestedVersion,
    selectedHashVersion: hashVersion,
    selectedMutableStateProtocolVersion: 1,
    mapDelivery
  });
}

const SNAPSHOT_KEYS = deepFreeze([
  'protocolVersion',
  'battleId',
  'stateRevision',
  'battleMapSchemaVersion',
  'terrainGenerationVersion',
  'fullHash',
  'mapDelivery',
  'battleMap',
  'mutableState'
]);

export function createBattleStateSnapshotV1({
  battleId,
  stateRevision,
  battleMap,
  mutableState,
  mapDelivery = 'full'
}) {
  if (mapDelivery !== 'full' && mapDelivery !== 'cached') {
    throw new TypeError('mapDelivery must be full or cached');
  }
  const isV2 = battleMap?.battleMapSchemaVersion === 2;
  if (isV2) assertBattleMapV2Final(battleMap);
  const snapshot = {
    protocolVersion: 1,
    battleId,
    stateRevision,
    battleMapSchemaVersion: isV2 ? 2 : 1,
    terrainGenerationVersion: isV2 ? battleMap.terrainGenerationVersion : 1,
    fullHash: isV2 ? battleMap.diagnostics.hashes.fullHash : null,
    mapDelivery,
    battleMap: mapDelivery === 'full' ? battleMap : null,
    mutableState
  };
  assertBattleStateSnapshotV1(snapshot);
  assertWithinUncompressedBudget(
    snapshot,
    BATTLE_STATE_BYTE_BUDGETS.initialSnapshotUncompressed,
    'BattleStateSnapshotV1'
  );
  return deepFreeze(deepCloneJsonValue(snapshot));
}

export function assertBattleStateSnapshotV1(value) {
  assertClosedKeys(value, SNAPSHOT_KEYS, 'BattleStateSnapshotV1');
  if (value.protocolVersion !== 1) throw new TypeError('BattleStateSnapshotV1.protocolVersion must equal 1');
  assertNonnegativeInteger(value.stateRevision, 'BattleStateSnapshotV1.stateRevision');
  if (value.mapDelivery !== 'full' && value.mapDelivery !== 'cached') {
    throw new TypeError('BattleStateSnapshotV1.mapDelivery is unsupported');
  }
  if (value.mapDelivery === 'cached' && value.battleMap !== null) {
    throw new TypeError('A cached-map snapshot must not resend battleMap');
  }
  if (value.battleMapSchemaVersion === 2) {
    if (!HASH_PATTERN.test(value.fullHash)) throw new TypeError('V2 snapshot fullHash is invalid');
    if (value.mapDelivery === 'full') {
      assertBattleMapV2Final(value.battleMap);
      if (value.battleMap.diagnostics.hashes.fullHash !== value.fullHash) {
        throw new TypeError('V2 snapshot map/hash reference mismatch');
      }
    }
  } else if (value.battleMapSchemaVersion !== 1 || value.fullHash !== null) {
    throw new TypeError('BattleStateSnapshotV1 has an unsupported map reference');
  }
  assertBattleMutableStateV1(value.mutableState);
  return value;
}
