import {
  canonicalizeJson,
  deepCloneJsonValue,
  deepFreeze
} from '../canonicalJson.js';
import {
  hashCanonicalV3Value,
  normalizeBattleMapV3Final
} from './hashes.js';
import {
  array,
  assertion,
  boolean,
  exactObject,
  integer,
  push,
  safeId,
  sha256,
  uniqueRecordIds,
  uniqueStrings
} from './validation.js';

export const BATTLE_MAP_V3_CATALOG_SCHEMA_VERSION = 3;
export const BATTLE_MAP_V3_SELECTOR_VERSION = 2;
export const BATTLE_MAP_V3_SUPPORTED_CATALOG_SCHEMA_VERSIONS =
  Object.freeze([1, 2, 3]);
export const BATTLE_MAP_V3_SUPPORTED_SELECTOR_VERSIONS =
  Object.freeze([1, 2]);
export const BATTLE_MAP_V3_MAX_WEIGHT = 1_000_000;
export const BATTLE_MAP_V3_CATALOG_HASH_DOMAIN =
  'modia:battle-map-v3:catalog-release:v3';
export const BATTLE_MAP_V3_CATALOG_PROJECTION_SCHEMA =
  'battle-map-v3-catalog-release/projection-v3';
const LEGACY_V1_CATALOG_HASH_DOMAIN =
  'modia:battle-map-v3:catalog-release:v1';
const LEGACY_V1_CATALOG_PROJECTION_SCHEMA =
  'battle-map-v3-catalog-release/projection-v1';
const LEGACY_V2_CATALOG_HASH_DOMAIN =
  'modia:battle-map-v3:catalog-release:v2';
const LEGACY_V2_CATALOG_PROJECTION_SCHEMA =
  'battle-map-v3-catalog-release/projection-v2';

const RELEASE_KEYS = Object.freeze([
  'catalogSchemaVersion', 'catalogReleaseId', 'selectorVersion',
  'assetBundlePins', 'entries'
]);
const FINAL_RELEASE_KEYS = Object.freeze([...RELEASE_KEYS, 'catalogFullHash']);
const ENTRY_V1_KEYS = Object.freeze([
  'id', 'mapContentId', 'mapContentVersion', 'mapFullHash',
  'catalogReleaseId', 'theme', 'renderProfileId', 'tierEligibility',
  'supportedModes', 'orientation', 'teamLayout', 'dimensions',
  'playerCapacity', 'candidatePoolSize', 'maxAssignableOpponents',
  'assetBundleId', 'assetBundleManifestFullHash', 'weight',
  'bossCapable', 'competitiveParity', 'sourceTemplateId'
]);
const ENTRY_V2_KEYS = Object.freeze([
  ...ENTRY_V1_KEYS.slice(0, 7),
  'ecologyProfile',
  ...ENTRY_V1_KEYS.slice(7)
]);
const ENTRY_V3_KEYS = Object.freeze([
  ...ENTRY_V2_KEYS.slice(0, 17),
  'assetBundleVersion',
  ...ENTRY_V2_KEYS.slice(17)
]);
const ASSET_PIN_V1_V2_KEYS = Object.freeze([
  'assetBundleId', 'manifestFullHash'
]);
const ASSET_PIN_V3_KEYS = Object.freeze([
  'assetBundleId', 'assetBundleVersion', 'manifestFullHash'
]);

function validateAssetPin(value, path, errors, schemaVersion) {
  const keys = schemaVersion >= 3 ? ASSET_PIN_V3_KEYS : ASSET_PIN_V1_V2_KEYS;
  if (!exactObject(value, path, keys, errors)) return;
  safeId(value.assetBundleId, `${path}.assetBundleId`, errors);
  if (schemaVersion >= 3) {
    integer(value.assetBundleVersion, `${path}.assetBundleVersion`, errors, {
      min: 1
    });
  }
  sha256(value.manifestFullHash, `${path}.manifestFullHash`, errors);
}

function validateDimensions(value, path, errors) {
  if (!exactObject(value, path, ['width', 'height'], errors)) return;
  integer(value.width, `${path}.width`, errors, { min: 1, max: 256 });
  integer(value.height, `${path}.height`, errors, { min: 1, max: 256 });
}

function validateEntry(value, path, errors, releaseId, assetPins, schemaVersion) {
  const keys = schemaVersion >= 3
    ? ENTRY_V3_KEYS
    : schemaVersion === 2
      ? ENTRY_V2_KEYS
      : ENTRY_V1_KEYS;
  if (!exactObject(value, path, keys, errors)) return;
  safeId(value.id, `${path}.id`, errors);
  safeId(value.mapContentId, `${path}.mapContentId`, errors);
  integer(value.mapContentVersion, `${path}.mapContentVersion`, errors, { min: 1 });
  sha256(value.mapFullHash, `${path}.mapFullHash`, errors);
  safeId(value.catalogReleaseId, `${path}.catalogReleaseId`, errors);
  if (value.catalogReleaseId !== releaseId) {
    push(errors, `${path}.catalogReleaseId`, `must equal release id ${releaseId}`);
  }
  safeId(value.theme, `${path}.theme`, errors);
  if (schemaVersion >= 2) {
    safeId(value.ecologyProfile, `${path}.ecologyProfile`, errors);
  }
  safeId(value.renderProfileId, `${path}.renderProfileId`, errors);
  uniqueStrings(value.tierEligibility, `${path}.tierEligibility`, errors, { min: 1 });
  uniqueStrings(value.supportedModes, `${path}.supportedModes`, errors, { min: 1 });
  safeId(value.orientation, `${path}.orientation`, errors);
  safeId(value.teamLayout, `${path}.teamLayout`, errors);
  validateDimensions(value.dimensions, `${path}.dimensions`, errors);
  integer(value.playerCapacity, `${path}.playerCapacity`, errors, { min: 1, max: 5 });
  integer(value.candidatePoolSize, `${path}.candidatePoolSize`, errors, { min: 1, max: 65536 });
  integer(value.maxAssignableOpponents, `${path}.maxAssignableOpponents`, errors, { min: 1, max: 64 });
  if (Number.isSafeInteger(value.maxAssignableOpponents)
    && Number.isSafeInteger(value.candidatePoolSize)
    && value.maxAssignableOpponents > value.candidatePoolSize) {
    push(errors, path, 'maxAssignableOpponents must not exceed candidatePoolSize');
  }
  safeId(value.assetBundleId, `${path}.assetBundleId`, errors);
  if (schemaVersion >= 3) {
    integer(value.assetBundleVersion, `${path}.assetBundleVersion`, errors, {
      min: 1
    });
  }
  sha256(value.assetBundleManifestFullHash, `${path}.assetBundleManifestFullHash`, errors);
  const assetPin = schemaVersion >= 3
    ? `${value.assetBundleId}\0${value.assetBundleVersion}`
    : value.assetBundleId;
  const pinnedHash = assetPins.get(assetPin);
  if (pinnedHash === undefined) {
    const versionSuffix = schemaVersion >= 3
      ? `@${value.assetBundleVersion}`
      : '';
    push(
      errors,
      `${path}.assetBundleId`,
      `asset bundle ${value.assetBundleId}${versionSuffix} is not pinned by the release`
    );
  } else if (pinnedHash !== value.assetBundleManifestFullHash) {
    push(errors, `${path}.assetBundleManifestFullHash`, 'must equal the release asset-bundle pin');
  }
  integer(value.weight, `${path}.weight`, errors, { min: 0, max: BATTLE_MAP_V3_MAX_WEIGHT });
  boolean(value.bossCapable, `${path}.bossCapable`, errors);
  boolean(value.competitiveParity, `${path}.competitiveParity`, errors);
  safeId(value.sourceTemplateId, `${path}.sourceTemplateId`, errors);
}

function validateCatalogRelease(value, final) {
  const errors = [];
  const root = final ? 'BattleMapV3CatalogRelease' : 'BattleMapV3CatalogReleaseCandidate';
  if (!exactObject(value, root, final ? FINAL_RELEASE_KEYS : RELEASE_KEYS, errors)) {
    return { valid: false, errors };
  }
  if (!BATTLE_MAP_V3_SUPPORTED_CATALOG_SCHEMA_VERSIONS.includes(
    value.catalogSchemaVersion
  )) {
    push(errors, `${root}.catalogSchemaVersion`, 'must be a supported catalog schema');
  }
  safeId(value.catalogReleaseId, `${root}.catalogReleaseId`, errors);
  const expectedSelectorVersion = value.catalogSchemaVersion === 3
    ? 2
    : value.catalogSchemaVersion;
  if (
    !BATTLE_MAP_V3_SUPPORTED_SELECTOR_VERSIONS.includes(value.selectorVersion)
    || value.selectorVersion !== expectedSelectorVersion
  ) {
    push(
      errors,
      `${root}.selectorVersion`,
      `must be supported and equal ${expectedSelectorVersion} for catalog schema `
        + value.catalogSchemaVersion
    );
  }
  const assetPins = new Map();
  if (array(value.assetBundlePins, `${root}.assetBundlePins`, errors, { min: 1 })) {
    value.assetBundlePins.forEach((pin, index) => {
      const path = `${root}.assetBundlePins[${index}]`;
      validateAssetPin(pin, path, errors, value.catalogSchemaVersion);
      const identity = value.catalogSchemaVersion >= 3
        ? `${pin?.assetBundleId}\0${pin?.assetBundleVersion}`
        : pin?.assetBundleId;
      if (assetPins.has(identity)) {
        const versionSuffix = value.catalogSchemaVersion >= 3
          ? `@${pin?.assetBundleVersion}`
          : '';
        push(
          errors,
          path,
          `duplicate asset bundle ${pin?.assetBundleId}${versionSuffix}`
        );
      }
      assetPins.set(identity, pin?.manifestFullHash);
      if (index > 0) {
        const previous = value.assetBundlePins[index - 1];
        const previousId = previous?.assetBundleId;
        const currentId = pin?.assetBundleId;
        const outOfOrder = value.catalogSchemaVersion >= 3
          ? previousId > currentId
            || (
              previousId === currentId
              && previous?.assetBundleVersion >= pin?.assetBundleVersion
            )
          : previousId >= currentId;
        if (outOfOrder) {
          push(
            errors,
            path,
            value.catalogSchemaVersion >= 3
              ? 'pins must be strictly ordered by assetBundleId then assetBundleVersion'
              : 'pins must be strictly ordered by assetBundleId'
          );
        }
      }
    });
  }
  if (array(value.entries, `${root}.entries`, errors, { min: 1 })) {
    uniqueRecordIds(value.entries, `${root}.entries`, errors);
    const mapPins = new Set();
    value.entries.forEach((entry, index) => {
      const path = `${root}.entries[${index}]`;
      validateEntry(
        entry,
        path,
        errors,
        value.catalogReleaseId,
        assetPins,
        value.catalogSchemaVersion
      );
      const pin = `${entry?.mapContentId}@${entry?.mapContentVersion}`;
      if (mapPins.has(pin)) push(errors, path, `duplicate map pin ${pin}`);
      mapPins.add(pin);
      if (index > 0 && value.entries[index - 1]?.mapContentId >= entry?.mapContentId) {
        push(errors, path, 'entries must be strictly ordered by mapContentId');
      }
    });
  }
  if (final) sha256(value.catalogFullHash, `${root}.catalogFullHash`, errors);
  return { valid: errors.length === 0, errors };
}

export function validateBattleMapV3CatalogReleaseCandidate(value) {
  return validateCatalogRelease(value, false);
}

export function validateBattleMapV3CatalogRelease(value) {
  return validateCatalogRelease(value, true);
}

export function assertBattleMapV3CatalogReleaseCandidate(value) {
  assertion(
    validateBattleMapV3CatalogReleaseCandidate(value),
    'BattleMapV3CatalogReleaseCandidate',
    'INVALID_BATTLE_MAP_V3_CATALOG'
  );
  return value;
}

export function assertBattleMapV3CatalogRelease(value) {
  assertion(
    validateBattleMapV3CatalogRelease(value),
    'BattleMapV3CatalogRelease',
    'INVALID_BATTLE_MAP_V3_CATALOG'
  );
  return value;
}

export function createBattleMapV3CatalogHashProjection(candidate) {
  assertBattleMapV3CatalogReleaseCandidate(candidate);
  const projectionSchema = candidate.catalogSchemaVersion === 1
    ? LEGACY_V1_CATALOG_PROJECTION_SCHEMA
    : candidate.catalogSchemaVersion === 2
      ? LEGACY_V2_CATALOG_PROJECTION_SCHEMA
      : BATTLE_MAP_V3_CATALOG_PROJECTION_SCHEMA;
  return {
    projectionSchema,
    catalogSchemaVersion: candidate.catalogSchemaVersion,
    catalogReleaseId: candidate.catalogReleaseId,
    selectorVersion: candidate.selectorVersion,
    assetBundlePins: candidate.assetBundlePins,
    entries: candidate.entries
  };
}

export async function computeBattleMapV3CatalogHash(candidate) {
  const domain = candidate.catalogSchemaVersion === 1
    ? LEGACY_V1_CATALOG_HASH_DOMAIN
    : candidate.catalogSchemaVersion === 2
      ? LEGACY_V2_CATALOG_HASH_DOMAIN
      : BATTLE_MAP_V3_CATALOG_HASH_DOMAIN;
  return hashCanonicalV3Value(
    domain,
    createBattleMapV3CatalogHashProjection(candidate)
  );
}

function candidateFromFinal(release) {
  const { catalogFullHash: _catalogFullHash, ...candidate } = release;
  return candidate;
}

export async function finalizeBattleMapV3CatalogRelease(candidate) {
  assertBattleMapV3CatalogReleaseCandidate(candidate);
  const clone = deepCloneJsonValue(candidate);
  clone.catalogFullHash = await computeBattleMapV3CatalogHash(clone);
  assertBattleMapV3CatalogRelease(clone);
  if (clone.catalogFullHash !== await computeBattleMapV3CatalogHash(candidateFromFinal(clone))) {
    throw new Error('BattleMapV3 catalog hash verification failed during finalization');
  }
  return deepFreeze(clone);
}

export async function verifyBattleMapV3CatalogRelease(release) {
  const snapshot = deepCloneJsonValue(release);
  assertBattleMapV3CatalogRelease(snapshot);
  if (snapshot.catalogFullHash
    !== await computeBattleMapV3CatalogHash(candidateFromFinal(snapshot))) return false;
  try {
    return canonicalizeJson(snapshot) === canonicalizeJson(deepCloneJsonValue(release));
  } catch {
    return false;
  }
}

export async function assertVerifiedBattleMapV3CatalogRelease(release) {
  if (!await verifyBattleMapV3CatalogRelease(release)) {
    const error = new Error('BattleMapV3 catalog hash verification failed');
    error.code = 'BATTLE_MAP_V3_CATALOG_HASH_MISMATCH';
    throw error;
  }
  return release;
}

/**
 * Publication-time cross-check for the release's map pins and selection
 * metadata. Hash verification alone proves catalog immutability; this check
 * additionally proves that every record describes the exact verified map it
 * will load.
 */
export async function assertBattleMapV3CatalogMapPins(release, finalMaps) {
  if (!Array.isArray(finalMaps)) {
    throw new TypeError('BattleMapV3 catalog map pins require an array of final maps');
  }
  const mapInputs = [...finalMaps];
  const normalizedRelease = await normalizeBattleMapV3CatalogRelease(release);
  const mapsByPin = new Map();
  for (const input of mapInputs) {
    const map = await normalizeBattleMapV3Final(input);
    const pin = `${map.contentId}@${map.contentVersion}`;
    if (mapsByPin.has(pin)) throw new TypeError(`Duplicate BattleMapV3 map pin ${pin}`);
    mapsByPin.set(pin, map);
  }
  for (const entry of normalizedRelease.entries) {
    const pin = `${entry.mapContentId}@${entry.mapContentVersion}`;
    const map = mapsByPin.get(pin);
    if (!map) throw new TypeError(`Catalog entry ${entry.id} references missing map pin ${pin}`);
    const expected = {
      mapFullHash: map.hashes.fullHash,
      theme: map.theme,
      renderProfileId: map.renderProfileId,
      tierEligibility: map.tierEligibility,
      supportedModes: map.supportedModes,
      dimensions: map.dimensions,
      playerCapacity: map.spawnContract.capacities.playerCapacity,
      candidatePoolSize: map.spawnContract.capacities.candidatePoolSize,
      maxAssignableOpponents: map.spawnContract.capacities.maxAssignableOpponents,
      assetBundleId: map.provenance.assetBundle.id,
      assetBundleManifestFullHash: map.provenance.assetBundle.manifestFullHash,
      sourceTemplateId: map.templateId
    };
    if (normalizedRelease.catalogSchemaVersion >= 2) {
      expected.ecologyProfile = map.ecologyProfile;
    }
    if (normalizedRelease.catalogSchemaVersion >= 3) {
      expected.assetBundleVersion = map.provenance.assetBundle.version;
    }
    for (const [key, expectedValue] of Object.entries(expected)) {
      if (canonicalizeJson(entry[key]) !== canonicalizeJson(expectedValue)) {
        const error = new Error(`Catalog entry ${entry.id}.${key} does not match verified map ${pin}`);
        error.code = 'BATTLE_MAP_V3_CATALOG_MAP_PIN_MISMATCH';
        throw error;
      }
    }
  }
  return normalizedRelease;
}

export async function normalizeBattleMapV3CatalogRelease(release) {
  const clone = deepCloneJsonValue(release);
  await assertVerifiedBattleMapV3CatalogRelease(clone);
  return deepFreeze(clone);
}

export const BattleMapV3CatalogRecordShapes = Object.freeze({
  candidate: RELEASE_KEYS,
  release: FINAL_RELEASE_KEYS,
  entry: ENTRY_V3_KEYS,
  assetBundlePin: ASSET_PIN_V3_KEYS
});
