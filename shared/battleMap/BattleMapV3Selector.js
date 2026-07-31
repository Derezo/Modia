import {
  canonicalJsonBytes,
  deepCloneJsonValue,
  deepFreeze
} from './canonicalJson.js';
import {
  BATTLE_MAP_V3_SUPPORTED_SELECTOR_VERSIONS,
  normalizeBattleMapV3CatalogRelease
} from './v3/index.js';

export const BATTLE_MAP_V3_SELECTOR_DOMAIN = 'modia:battle-map-v3-selector:v2';
const LEGACY_SELECTOR_DOMAIN = 'modia:battle-map-v3-selector:v1';

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_VALUE_PATTERN = /^[a-z0-9](?:[a-z0-9._:/-]{0,127})$/;
const QUERY_KEYS = Object.freeze([
  'encounterSeed',
  'theme',
  'ecologyProfile',
  'sourceTier',
  'selectionBand',
  'mode',
  'partyCapacityBand',
  'opposingRosterCapacityBand',
  'dimensions',
  'teamLayout',
  'playerCount',
  'opponentCount',
  'requireBossCapable',
  'requireCompetitiveParity'
]);
const SELECTOR_INPUT_V1_KEYS = Object.freeze([
  'domain',
  'selectorVersion',
  'catalogReleaseId',
  'encounterSeed',
  'theme',
  'selectionBand',
  'mode',
  'partyCapacityBand',
  'opposingRosterCapacityBand'
]);
const SELECTOR_INPUT_V2_KEYS = Object.freeze([
  ...SELECTOR_INPUT_V1_KEYS.slice(0, 6),
  'ecologyProfile',
  ...SELECTOR_INPUT_V1_KEYS.slice(6)
]);
const PROVENANCE_V1_KEYS = Object.freeze([
  'catalogReleaseId',
  'catalogFullHash',
  'selectorVersion',
  'selectorDigest',
  'encounterSeed',
  'theme',
  'sourceTier',
  'selectionBand',
  'mode',
  'partyCapacityBand',
  'opposingRosterCapacityBand',
  'selectedEntryId',
  'mapContentId',
  'mapContentVersion',
  'mapFullHash'
]);
const PROVENANCE_V2_KEYS = Object.freeze([
  ...PROVENANCE_V1_KEYS.slice(0, 7),
  'ecologyProfile',
  ...PROVENANCE_V1_KEYS.slice(7)
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

function assertClosedKeys(value, keys, label) {
  assertPlainObject(value, label);
  for (const key of keys) {
    if (!own(value, key)) throw new TypeError(`${label}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new TypeError(`${label}.${key} is not allowed`);
  }
}

function assertSafeValue(value, label) {
  if (typeof value !== 'string' || !SAFE_VALUE_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase safe identifier`);
  }
}

function assertSafeInteger(value, label, { minimum = Number.MIN_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be a safe integer >= ${minimum}`);
  }
}

function assertDimensions(value, label) {
  assertClosedKeys(value, ['width', 'height'], label);
  assertSafeInteger(value.width, `${label}.width`, { minimum: 1 });
  assertSafeInteger(value.height, `${label}.height`, { minimum: 1 });
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
}

export function assertBattleMapV3SelectionQuery(value) {
  assertClosedKeys(value, QUERY_KEYS, 'BattleMapV3SelectionQuery');
  assertSafeInteger(value.encounterSeed, 'BattleMapV3SelectionQuery.encounterSeed');
  assertSafeValue(value.theme, 'BattleMapV3SelectionQuery.theme');
  if (value.ecologyProfile !== null) {
    assertSafeValue(
      value.ecologyProfile,
      'BattleMapV3SelectionQuery.ecologyProfile'
    );
  }
  if (value.sourceTier !== null) {
    assertSafeInteger(value.sourceTier, 'BattleMapV3SelectionQuery.sourceTier', { minimum: 1 });
  }
  assertSafeValue(value.selectionBand, 'BattleMapV3SelectionQuery.selectionBand');
  assertSafeValue(value.mode, 'BattleMapV3SelectionQuery.mode');
  assertSafeValue(value.partyCapacityBand, 'BattleMapV3SelectionQuery.partyCapacityBand');
  assertSafeValue(
    value.opposingRosterCapacityBand,
    'BattleMapV3SelectionQuery.opposingRosterCapacityBand'
  );
  assertDimensions(value.dimensions, 'BattleMapV3SelectionQuery.dimensions');
  assertSafeValue(value.teamLayout, 'BattleMapV3SelectionQuery.teamLayout');
  assertSafeInteger(value.playerCount, 'BattleMapV3SelectionQuery.playerCount', { minimum: 1 });
  assertSafeInteger(value.opponentCount, 'BattleMapV3SelectionQuery.opponentCount', { minimum: 0 });
  assertBoolean(value.requireBossCapable, 'BattleMapV3SelectionQuery.requireBossCapable');
  assertBoolean(
    value.requireCompetitiveParity,
    'BattleMapV3SelectionQuery.requireCompetitiveParity'
  );
  return value;
}

export function createBattleMapV3SelectionQuery({
  encounterSeed,
  theme,
  ecologyProfile = null,
  sourceTier = null,
  selectionBand,
  mode,
  partyCapacityBand,
  opposingRosterCapacityBand,
  dimensions,
  teamLayout,
  playerCount,
  opponentCount,
  requireBossCapable = false,
  requireCompetitiveParity = false
}) {
  const query = {
    encounterSeed,
    theme,
    ecologyProfile,
    sourceTier,
    selectionBand,
    mode,
    partyCapacityBand,
    opposingRosterCapacityBand,
    dimensions,
    teamLayout,
    playerCount,
    opponentCount,
    requireBossCapable,
    requireCompetitiveParity
  };
  assertBattleMapV3SelectionQuery(query);
  return deepFreeze(deepCloneJsonValue(query));
}

export function createBattleMapV3SelectorInput(release, query) {
  assertBattleMapV3SelectionQuery(query);
  const input = {
    domain: release.selectorVersion === 1
      ? LEGACY_SELECTOR_DOMAIN
      : BATTLE_MAP_V3_SELECTOR_DOMAIN,
    selectorVersion: release.selectorVersion,
    catalogReleaseId: release.catalogReleaseId,
    encounterSeed: query.encounterSeed,
    theme: query.theme,
    selectionBand: query.selectionBand,
    mode: query.mode,
    partyCapacityBand: query.partyCapacityBand,
    opposingRosterCapacityBand: query.opposingRosterCapacityBand
  };
  if (release.selectorVersion === 2) {
    input.ecologyProfile = query.ecologyProfile;
  }
  assertClosedKeys(
    input,
    release.selectorVersion === 1
      ? SELECTOR_INPUT_V1_KEYS
      : SELECTOR_INPUT_V2_KEYS,
    'BattleMapV3SelectorInput'
  );
  return deepFreeze(input);
}

async function sha256Canonical(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto SHA-256 is required for BattleMapV3 selection');
  const digest = new Uint8Array(await subtle.digest('SHA-256', canonicalJsonBytes(value)));
  let hexadecimal = '';
  for (const byte of digest) hexadecimal += byte.toString(16).padStart(2, '0');
  return `sha256:${hexadecimal}`;
}

function isSelectionEligible(entry, query) {
  return entry.theme === query.theme
    && (!own(entry, 'ecologyProfile')
      || entry.ecologyProfile === query.ecologyProfile)
    && entry.tierEligibility.includes(query.selectionBand)
    && entry.supportedModes.includes(query.mode)
    && entry.dimensions.width === query.dimensions.width
    && entry.dimensions.height === query.dimensions.height
    && entry.teamLayout === query.teamLayout
    && (!query.requireBossCapable || entry.bossCapable)
    && (!query.requireCompetitiveParity || entry.competitiveParity);
}

function hasRequiredCapacity(entry, query) {
  return entry.playerCapacity >= query.playerCount
    && entry.maxAssignableOpponents >= query.opponentCount;
}

function digestInteger(digest) {
  return BigInt(`0x${digest.slice('sha256:'.length)}`);
}

export async function selectBattleMapV3CatalogEntry(release, inputQuery) {
  const normalizedRelease = await normalizeBattleMapV3CatalogRelease(release);
  const query = createBattleMapV3SelectionQuery(inputQuery);
  const selectorInput = createBattleMapV3SelectorInput(normalizedRelease, query);
  const selectorDigest = await sha256Canonical(selectorInput);
  // Exact formation sizes are deliberately absent from the selection pool
  // and digest. The catalog's stable supported-capacity bands remain in the
  // digest for selector-v1 compatibility, while actual capacity is an
  // acceptance check on the chosen entry and never causes silent reselection.
  const selectableEntries = normalizedRelease.entries
    .filter(entry => isSelectionEligible(entry, query))
    .sort((left, right) => left.mapContentId.localeCompare(right.mapContentId));

  if (selectableEntries.length === 0) {
    return deepFreeze({
      coverage: 'absent',
      selectorInput,
      selectorDigest,
      eligibleMapContentIds: [],
      entry: null,
      provenance: null
    });
  }

  const totalWeight = selectableEntries.reduce((total, entry) => total + entry.weight, 0);
  if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0) {
    const error = new Error('Eligible BattleMapV3 catalog weights must have a positive safe total');
    error.code = 'BATTLE_MAP_V3_SELECTOR_ZERO_WEIGHT';
    throw error;
  }
  const target = digestInteger(selectorDigest) % BigInt(totalWeight);
  let cumulative = 0n;
  let selected = null;
  for (const entry of selectableEntries) {
    cumulative += BigInt(entry.weight);
    if (target < cumulative) {
      selected = entry;
      break;
    }
  }
  if (selected === null) {
    throw new Error('BattleMapV3 selector failed to resolve a weighted range');
  }
  if (!hasRequiredCapacity(selected, query)) {
    const error = new Error(
      `Selected BattleMapV3 entry ${selected.id} does not satisfy the `
        + 'requested roster capacity'
    );
    error.code = 'BATTLE_MAP_V3_SELECTED_MAP_CAPACITY_MISMATCH';
    error.selectorDigest = selectorDigest;
    error.selectedEntryId = selected.id;
    error.playerCapacity = selected.playerCapacity;
    error.maxAssignableOpponents = selected.maxAssignableOpponents;
    throw error;
  }

  const provenance = {
    catalogReleaseId: normalizedRelease.catalogReleaseId,
    catalogFullHash: normalizedRelease.catalogFullHash,
    selectorVersion: normalizedRelease.selectorVersion,
    selectorDigest,
    encounterSeed: query.encounterSeed,
    theme: query.theme,
    sourceTier: query.sourceTier,
    selectionBand: query.selectionBand,
    mode: query.mode,
    partyCapacityBand: query.partyCapacityBand,
    opposingRosterCapacityBand: query.opposingRosterCapacityBand,
    selectedEntryId: selected.id,
    mapContentId: selected.mapContentId,
    mapContentVersion: selected.mapContentVersion,
    mapFullHash: selected.mapFullHash
  };
  if (normalizedRelease.selectorVersion === 2) {
    provenance.ecologyProfile = query.ecologyProfile;
  }
  assertBattleMapV3SelectionProvenance(provenance);
  return deepFreeze({
    coverage: 'selected',
    selectorInput,
    selectorDigest,
    eligibleMapContentIds: selectableEntries.map(entry => entry.mapContentId),
    entry: selected,
    provenance
  });
}

export function assertBattleMapV3SelectionProvenance(value) {
  const version = value?.selectorVersion;
  assertClosedKeys(
    value,
    version === 1 ? PROVENANCE_V1_KEYS : PROVENANCE_V2_KEYS,
    'BattleMapV3SelectionProvenance'
  );
  assertSafeValue(value.catalogReleaseId, 'BattleMapV3SelectionProvenance.catalogReleaseId');
  if (!HASH_PATTERN.test(value.catalogFullHash)) {
    throw new TypeError('BattleMapV3SelectionProvenance.catalogFullHash must be a sha256 hash');
  }
  if (!BATTLE_MAP_V3_SUPPORTED_SELECTOR_VERSIONS.includes(value.selectorVersion)) {
    throw new TypeError(
      'BattleMapV3SelectionProvenance.selectorVersion must be supported'
    );
  }
  if (!HASH_PATTERN.test(value.selectorDigest)) {
    throw new TypeError('BattleMapV3SelectionProvenance.selectorDigest must be a sha256 hash');
  }
  assertSafeInteger(value.encounterSeed, 'BattleMapV3SelectionProvenance.encounterSeed');
  assertSafeValue(value.theme, 'BattleMapV3SelectionProvenance.theme');
  if (value.selectorVersion === 2) {
    assertSafeValue(
      value.ecologyProfile,
      'BattleMapV3SelectionProvenance.ecologyProfile'
    );
  }
  if (value.sourceTier !== null) {
    assertSafeInteger(value.sourceTier, 'BattleMapV3SelectionProvenance.sourceTier', { minimum: 1 });
  }
  for (const key of [
    'selectionBand',
    'mode',
    'partyCapacityBand',
    'opposingRosterCapacityBand',
    'selectedEntryId',
    'mapContentId'
  ]) {
    assertSafeValue(value[key], `BattleMapV3SelectionProvenance.${key}`);
  }
  assertSafeInteger(
    value.mapContentVersion,
    'BattleMapV3SelectionProvenance.mapContentVersion',
    { minimum: 1 }
  );
  if (!HASH_PATTERN.test(value.mapFullHash)) {
    throw new TypeError('BattleMapV3SelectionProvenance.mapFullHash must be a sha256 hash');
  }
  return value;
}

export const BattleMapV3SelectorRecordShapes = Object.freeze({
  query: QUERY_KEYS,
  selectorInput: SELECTOR_INPUT_V2_KEYS,
  provenance: PROVENANCE_V2_KEYS
});
