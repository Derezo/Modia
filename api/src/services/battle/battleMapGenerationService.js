/**
 * Authoritative battle-map generation boundary.
 *
 * New V2 maps are generated only when both the server rollout and the client
 * capability negotiation opt in. Existing callers therefore remain on V1
 * until they explicitly carry the versioned battle-map protocol.
 */

import { dispatchBattleMapGeneration } from '../../../../shared/mapGeneration.js';
import {
  BATTLE_MUTABLE_STATE_V1_FIELDS,
  createBattleMutableStateV1,
  negotiateBattleMapCapabilities
} from '../../../../shared/battleStateProtocol.js';
import {
  BATTLE_MAP_V2_FLAT_FIELDS,
  battleMapV2ToFlatState
} from '../../../../shared/battleMap/BattleMapAdapter.js';
import {
  recordBattleMapGenerationFailed,
  recordBattleMapGenerationStarted,
  recordBattleMapGenerationSucceeded,
  scheduleBattleMapV2Shadow
} from './BattleMapOperations.js';

export const BATTLE_MAP_V2_ENABLED_MODES_ENV = 'BATTLE_MAP_V2_ENABLED_MODES';
export const LEGACY_BATTLE_MAP_VERSION = 1;
export const CURRENT_BATTLE_MAP_VERSION = 2;

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

/**
 * Canonical server-side rollout gate. The environment value is a comma
 * separated list of exact mode names, or "*" to enable every mode.
 */
export function isBattleMapV2EnabledForMode(
  mode,
  enabledModes = process.env[BATTLE_MAP_V2_ENABLED_MODES_ENV]
) {
  if (typeof mode !== 'string' || mode.length === 0) {
    throw new TypeError('Battle-map mode must be a non-empty string');
  }
  if (typeof enabledModes !== 'string' || enabledModes.trim().length === 0) {
    return false;
  }
  const configuredModes = new Set(
    enabledModes.split(',').map(value => value.trim()).filter(Boolean)
  );
  return configuredModes.has('*') || configuredModes.has(mode);
}

/**
 * Select one deterministic generation version from the server rollout and
 * the client's protocol capabilities.
 */
export function selectBattleMapGenerationVersion({
  mode,
  allowV2 = isBattleMapV2EnabledForMode(mode),
  clientCapabilities = null
}) {
  const negotiation = negotiateBattleMapCapabilities({
    clientCapabilities,
    allowNewV2: allowV2
  });
  if (!negotiation.compatible) {
    const error = new Error(negotiation.code || 'Battle-map capabilities are incompatible');
    error.code = negotiation.code || 'BATTLE_MAP_CAPABILITIES_INCOMPATIBLE';
    error.negotiation = negotiation;
    throw error;
  }
  return negotiation.selectedBattleMapSchemaVersion === CURRENT_BATTLE_MAP_VERSION
    ? CURRENT_BATTLE_MAP_VERSION
    : LEGACY_BATTLE_MAP_VERSION;
}

/**
 * Keep only the closed, mutable combat vocabulary. This lets callers pass a
 * familiar flat engine state without allowing it to shadow immutable map data.
 */
export function extractBattleMutableState(initialState = {}) {
  assertPlainObject(initialState, 'initialMutableState');
  const mutableInput = {};
  for (const field of BATTLE_MUTABLE_STATE_V1_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(initialState, field)) {
      mutableInput[field] = initialState[field];
    }
  }
  return createBattleMutableStateV1(mutableInput);
}

/**
 * Project a trusted flat engine successor into the closed mutable protocol.
 * Declared map fields are deliberately omitted, while every other unknown key
 * remains visible to createBattleMutableStateV1 and therefore fails closed.
 */
export function extractBattleMutableStateForCommit(flatState = {}) {
  assertPlainObject(flatState, 'flatState');
  const mutableInput = {};
  for (const [field, value] of Object.entries(flatState)) {
    if (!BATTLE_MAP_V2_FLAT_FIELDS.includes(field)) {
      mutableInput[field] = value;
    }
  }
  return createBattleMutableStateV1(mutableInput);
}

function formationCoordinates(point, side) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
    return { depth: 0, lateral: 0 };
  }
  const canonicalSide = ['east', 'north', 'south', 'west']
    .find(candidate => side === candidate || side?.endsWith(`_${candidate}`));
  switch (canonicalSide) {
    case 'east':
      return { depth: -point.x, lateral: point.y };
    case 'north':
      return { depth: point.y, lateral: point.x };
    case 'south':
      return { depth: -point.y, lateral: point.x };
    case 'west':
    default:
      return { depth: point.x, lateral: point.y };
  }
}

function sourceFormationSide(mode, usesEnemySide) {
  if (mode === 'pvp' || mode === 'pvp_coliseum') {
    // The established arena formation grid authors player one from the south
    // and player two from the north. V2 deliberately mirrors those sides.
    return usesEnemySide ? 'north' : 'south';
  }
  return usesEnemySide ? 'east' : 'west';
}

function assignFormationGroup(units, slots, sourceSide) {
  const indexedUnits = units.map((unit, index) => ({
    index,
    unit,
    ...formationCoordinates({ x: unit.tileX, y: unit.tileY }, sourceSide)
  }));
  const orderedSlots = slots.map((slot, index) => ({
    index,
    slot,
    ...formationCoordinates(slot, slot.side)
  }));
  const compareFormation = (left, right) => (
    left.depth - right.depth
    || left.lateral - right.lateral
    || left.index - right.index
  );
  indexedUnits.sort(compareFormation);
  orderedSlots.sort(compareFormation);

  const assigned = new Map();
  indexedUnits.forEach(({ index }, formationIndex) => {
    const slot = orderedSlots[formationIndex]?.slot;
    if (slot) assigned.set(index, slot);
  });
  return units.map((unit, index) => {
    const slot = assigned.get(index);
    return slot ? { ...unit, tileX: slot.x, tileY: slot.y } : unit;
  });
}

function assignV2SpawnPositions(mutableState, finalMap, mode) {
  const playerSlots = finalMap.spawnLayout.slots
    .filter(slot => slot.id.startsWith('spawn:player-'));
  const enemySlots = finalMap.spawnLayout.slots
    .filter(slot => slot.id.startsWith('spawn:enemy-'));
  const playerUnits = [];
  const enemyUnits = [];
  for (const unit of mutableState.units) {
    const usesEnemySide = mode === 'pvp' || mode === 'pvp_coliseum'
      ? unit.teamId === 2
      : unit.type === 'enemy';
    (usesEnemySide ? enemyUnits : playerUnits).push(unit);
  }
  const assignedPlayers = assignFormationGroup(
    playerUnits,
    playerSlots,
    sourceFormationSide(mode, false)
  );
  const assignedEnemies = assignFormationGroup(
    enemyUnits,
    enemySlots,
    sourceFormationSide(mode, true)
  );
  const assignedById = new Map(
    [...assignedPlayers, ...assignedEnemies].map(unit => [unit.id, unit])
  );
  const units = mutableState.units.map(unit => assignedById.get(unit.id) ?? unit);
  return createBattleMutableStateV1({ ...mutableState, units });
}

/**
 * Generate a map and both persistence/engine representations.
 *
 * `finalMap` is non-null only for V2. `legacyFlatState` is non-null only for
 * V1. Repository callers pass those mutually exclusive values directly to
 * BattleStateRepository.createBattle and use `mutableState` as its
 * initialMutableState.
 */
export async function generateBattleMap({
  terrainSeed,
  nodeType,
  mapWidth = 32,
  mapHeight = 32,
  mode = 'pve',
  playerCount = 1,
  enemyCount = 0,
  enemyCapacity = Math.max(1, enemyCount),
  enemyStrategy = 'formation',
  existingUnits = [],
  initialMutableState = {},
  allowV2 = isBattleMapV2EnabledForMode(mode),
  clientCapabilities = null,
  maxAttempts
}) {
  const terrainGenerationVersion = selectBattleMapGenerationVersion({
    mode,
    allowV2,
    clientCapabilities
  });
  const initialCombatState = extractBattleMutableState(initialMutableState);

  // V2 reserves at least one enemy slot even for encounters whose enemy list
  // is populated after map creation. This preserves the public zero-enemy
  // default while satisfying the generator's positive spawn-capacity contract.
  const v2EnemyCount = Math.max(1, enemyCount);
  const v2EnemyCapacity = Math.max(1, enemyCapacity, v2EnemyCount);
  const v2Options = {
    mode,
    playerCount,
    enemyCount: v2EnemyCount,
    enemyCapacity: v2EnemyCapacity,
    enemyStrategy,
    existingUnits,
    ...(maxAttempts === undefined ? {} : { maxAttempts })
  };
  const options = terrainGenerationVersion === CURRENT_BATTLE_MAP_VERSION
    ? v2Options
    : { elevation: true, includeMetadata: true };

  recordBattleMapGenerationStarted({ version: terrainGenerationVersion });
  const generationStartedAt = performance.now();
  let generatedMap;
  try {
    generatedMap = await dispatchBattleMapGeneration({
      terrainGenerationVersion,
      terrainSeed,
      nodeType,
      mapWidth,
      mapHeight,
      options
    });
  } catch (error) {
    recordBattleMapGenerationFailed({
      version: terrainGenerationVersion,
      mode,
      nodeType,
      terrainSeed,
      mapWidth,
      mapHeight,
      durationMs: performance.now() - generationStartedAt,
      error
    });
    throw error;
  }
  const generationDurationMs = performance.now() - generationStartedAt;
  recordBattleMapGenerationSucceeded({
    version: terrainGenerationVersion,
    mode,
    nodeType,
    terrainSeed,
    mapWidth,
    mapHeight,
    durationMs: generationDurationMs,
    map: generatedMap
  });

  if (terrainGenerationVersion === LEGACY_BATTLE_MAP_VERSION) {
    const shadowOptions = {
      ...v2Options,
      existingUnits: Array.isArray(existingUnits)
        ? existingUnits.map(unit => ({ ...unit }))
        : existingUnits
    };
    scheduleBattleMapV2Shadow({
      request: {
        mode,
        nodeType,
        terrainSeed,
        mapWidth,
        mapHeight
      },
      activeGeneration: {
        version: LEGACY_BATTLE_MAP_VERSION,
        durationMs: generationDurationMs
      },
      generate: () => dispatchBattleMapGeneration({
        terrainGenerationVersion: CURRENT_BATTLE_MAP_VERSION,
        terrainSeed,
        nodeType,
        mapWidth,
        mapHeight,
        options: shadowOptions
      })
    });
  }

  if (terrainGenerationVersion === CURRENT_BATTLE_MAP_VERSION) {
    const mutableState = assignV2SpawnPositions(
      initialCombatState,
      generatedMap,
      mode
    );
    const flatState = await battleMapV2ToFlatState(generatedMap, mutableState);
    return Object.freeze({
      battleMapSchemaVersion: CURRENT_BATTLE_MAP_VERSION,
      terrainGenerationVersion,
      mapSeed: terrainSeed,
      mapWidth,
      mapHeight,
      finalMap: generatedMap,
      legacyFlatState: null,
      mutableState,
      flatState
    });
  }

  const mutableState = initialCombatState;
  const legacyMap = {
    battleMapSchemaVersion: LEGACY_BATTLE_MAP_VERSION,
    terrainGenerationVersion: LEGACY_BATTLE_MAP_VERSION,
    terrainSeed,
    mapWidth,
    mapHeight,
    nodeType,
    terrain: generatedMap.terrain,
    elevation: generatedMap.elevation,
    elevationFormat: generatedMap.elevationFormat,
    obstacles: generatedMap.obstacles,
    variants: generatedMap.variants
  };
  const legacyFlatState = Object.freeze({ ...mutableState, ...legacyMap });
  return Object.freeze({
    battleMapSchemaVersion: LEGACY_BATTLE_MAP_VERSION,
    terrainGenerationVersion,
    mapSeed: terrainSeed,
    mapWidth,
    mapHeight,
    finalMap: null,
    legacyFlatState,
    mutableState,
    flatState: legacyFlatState
  });
}

export default {
  generateBattleMap,
  extractBattleMutableState,
  isBattleMapV2EnabledForMode,
  selectBattleMapGenerationVersion
};
