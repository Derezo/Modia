/**
 * Authoritative battle-map generation boundary.
 *
 * New V3 selection is automatic when the tracked active catalog contains an
 * eligible map. Client capability never negotiates that selection downward:
 * an incompatible client receives an upgrade-required error. Only genuine
 * absence of eligible catalog content enters the explicit V2 compatibility
 * path. The older V1/V2 negotiation helpers below remain for their persisted
 * compatibility contract; they are not V3 activation controls.
 */

import { dispatchBattleMapGeneration } from '../../../../shared/mapGeneration.js';
import {
  BATTLE_MUTABLE_STATE_V1_FIELDS,
  createBattleMutableStateV1,
  negotiateBattleMapCapabilities
} from '../../../../shared/battleStateProtocol.js';
import {
  BATTLE_MAP_V2_FLAT_FIELDS,
  BATTLE_MAP_V3_FLAT_FIELDS,
  BATTLE_MAP_SCHEMA_VERSION,
  assignBattleMapV3Spawns,
  battleMapV2ToFlatState,
  battleMapV3ToFlatState,
  resolveBattleMapV3CapacityBands,
  resolveBattleMapV3TeamLayout,
  resolveBattleMapV3Theme,
  resolveBattleMapV3Tier
} from '../../../../shared/index.js';
import {
  recordBattleMapGenerationFailed,
  recordBattleMapGenerationStarted,
  recordBattleMapGenerationSucceeded,
  recordAuthoredMapCatalogCoverage,
  recordAuthoredMapCatalogSelectionFailed
} from './BattleMapOperations.js';
import {
  selectDeployedBattleMapV3
} from './BattleMapV3CatalogRuntime.js';
import {
  resolveBattleMapEcologyProfile
} from './BattleMapEcologyContext.js';

export const BATTLE_MAP_V2_ENABLED_MODES_ENV = 'BATTLE_MAP_V2_ENABLED_MODES';
export const LEGACY_BATTLE_MAP_VERSION = 1;
export const CURRENT_BATTLE_MAP_VERSION = 2;
export const AUTHORED_BATTLE_MAP_VERSION = 3;

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
  enabledModes = ''
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
  const immutableFields = new Set([
    ...BATTLE_MAP_V2_FLAT_FIELDS,
    ...BATTLE_MAP_V3_FLAT_FIELDS
  ]);
  for (const [field, value] of Object.entries(flatState)) {
    if (!immutableFields.has(field)) {
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

function splitCombatSides(units, mode) {
  const playerUnits = [];
  const opponentUnits = [];
  for (const unit of units) {
    const usesOpponentSide = mode === 'pvp' || mode === 'pvp_coliseum'
      ? unit.teamId === 2
      : unit.type === 'enemy';
    (usesOpponentSide ? opponentUnits : playerUnits).push(unit);
  }
  return { playerUnits, opponentUnits };
}

function assignV3SpawnPositions(mutableState, finalMap, mode, encounterSeed) {
  const { playerUnits, opponentUnits } = splitCombatSides(mutableState.units, mode);
  const assignment = assignBattleMapV3Spawns({
    map: finalMap,
    playerUnits,
    opponentUnits,
    encounterSeed
  });
  const cellsByUnitId = new Map([
    ...assignment.playerAssignments,
    ...assignment.opponentAssignments
  ].map(record => [String(record.unitId), record.cell]));
  const units = mutableState.units.map(unit => {
    const cell = cellsByUnitId.get(String(unit.id));
    if (!cell) throw new TypeError(`BattleMapV3 spawn assignment omitted unit ${unit.id}`);
    return { ...unit, tileX: cell.x, tileY: cell.y };
  });
  return {
    mutableState: createBattleMutableStateV1({ ...mutableState, units }),
    assignment
  };
}

function requireClientMapSupport(map, declarations) {
  for (const clientCapabilities of declarations) {
    const negotiation = negotiateBattleMapCapabilities({
      clientCapabilities,
      existingMap: map
    });
    if (!negotiation.compatible) {
      const error = new Error(negotiation.code || 'Battle-map capabilities are incompatible');
      error.code = negotiation.code || 'BATTLE_MAP_CAPABILITIES_INCOMPATIBLE';
      error.negotiation = negotiation;
      throw error;
    }
  }
}

function clientDeclarations(primary, additional) {
  if (!Array.isArray(additional)) {
    throw new TypeError('additionalClientCapabilities must be an array');
  }
  return [primary, ...additional];
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
  clientCapabilities = null,
  additionalClientCapabilities = [],
  authoritativeTheme = null,
  ecologyContext = null,
  difficultyTier = null,
  guildTier = null,
  competitiveBand = null,
  namedDefaultBand = null,
  requireBossCapable = false,
  maxAttempts
}, {
  selectV3 = selectDeployedBattleMapV3,
  dispatch = dispatchBattleMapGeneration
} = {}) {
  const initialCombatState = extractBattleMutableState(initialMutableState);
  const theme = resolveBattleMapV3Theme({
    nodeType,
    mode,
    authoritativeTheme: authoritativeTheme
      ?? (nodeType === 'palace' ? 'castle' : null)
  });
  const ecologyProfile = ecologyContext?.ecologyProfile
    ?? resolveBattleMapEcologyProfile({
      nodeType: ecologyContext?.node?.type ?? nodeType ?? theme,
      regionRace: ecologyContext?.region?.race ?? null
    })
    ?? resolveBattleMapEcologyProfile({ nodeType: theme });
  if (ecologyProfile === null) {
    throw new TypeError(`No authoritative ecology profile exists for theme ${theme}`);
  }
  const tier = resolveBattleMapV3Tier({
    mode,
    difficultyTier,
    guildTier,
    competitiveBand,
    namedDefaultBand
  });
  const capacityBands = resolveBattleMapV3CapacityBands({
    playerCount,
    opponentCount: enemyCount
  });
  let selection;
  try {
    selection = await selectV3({
      encounterSeed: terrainSeed,
      theme,
      sourceTier: tier.sourceTier,
      selectionBand: tier.selectionBand,
      mode,
      ...capacityBands,
      dimensions: { width: mapWidth, height: mapHeight },
      teamLayout: resolveBattleMapV3TeamLayout(mode),
      playerCount,
      opponentCount: enemyCount,
      requireBossCapable,
      requireCompetitiveParity: mode === 'pvp' || mode === 'pvp_coliseum',
      ecologyProfile
    });
  } catch (error) {
    recordAuthoredMapCatalogSelectionFailed();
    throw error;
  }
  recordAuthoredMapCatalogCoverage(selection.coverage);
  const declarations = clientDeclarations(
    clientCapabilities,
    additionalClientCapabilities
  );

  if (selection.coverage === 'selected') {
    requireClientMapSupport(selection.map, declarations);
    recordBattleMapGenerationStarted({ version: AUTHORED_BATTLE_MAP_VERSION });
    const generationStartedAt = performance.now();
    try {
      const spawned = assignV3SpawnPositions(
        initialCombatState,
        selection.map,
        mode,
        terrainSeed
      );
      const flatState = await battleMapV3ToFlatState(
        selection.map,
        spawned.mutableState
      );
      recordBattleMapGenerationSucceeded({
        version: AUTHORED_BATTLE_MAP_VERSION,
        mode,
        nodeType: theme,
        terrainSeed,
        mapWidth,
        mapHeight,
        durationMs: performance.now() - generationStartedAt,
        map: selection.map
      });
      return Object.freeze({
        battleMapSchemaVersion: AUTHORED_BATTLE_MAP_VERSION,
        terrainGenerationVersion: AUTHORED_BATTLE_MAP_VERSION,
        mapSeed: terrainSeed,
        mapWidth,
        mapHeight,
        finalMap: selection.map,
        legacyFlatState: null,
        mutableState: spawned.mutableState,
        flatState,
        selectionProvenance: selection.provenance,
        spawnAssignment: spawned.assignment,
        catalogCoverage: 'selected',
        ecologyContext
      });
    } catch (error) {
      recordBattleMapGenerationFailed({
        version: AUTHORED_BATTLE_MAP_VERSION,
        mode,
        nodeType: theme,
        terrainSeed,
        mapWidth,
        mapHeight,
        durationMs: performance.now() - generationStartedAt,
        error
      });
      throw error;
    }
  }

  if (selection.coverage !== 'absent') {
    throw new TypeError(`Unknown BattleMapV3 catalog coverage state ${selection.coverage}`);
  }
  const terrainGenerationVersion = CURRENT_BATTLE_MAP_VERSION;
  requireClientMapSupport({
    battleMapSchemaVersion: BATTLE_MAP_SCHEMA_VERSION,
    terrainGenerationVersion: CURRENT_BATTLE_MAP_VERSION
  }, declarations);

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
  const options = v2Options;

  recordBattleMapGenerationStarted({ version: terrainGenerationVersion });
  const generationStartedAt = performance.now();
  let generatedMap;
  try {
    generatedMap = await dispatch({
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
    flatState,
    selectionProvenance: null,
    spawnAssignment: null,
    catalogCoverage: 'absent',
    ecologyContext
  });
}

export default {
  generateBattleMap,
  extractBattleMutableState,
  isBattleMapV2EnabledForMode,
  selectBattleMapGenerationVersion
};
