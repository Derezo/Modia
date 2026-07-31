import { readFile } from 'node:fs/promises';

import {
  assertBattleMapV3CatalogMapPins,
  normalizeBattleMapV3CatalogRelease,
  normalizeBattleMapV3Final,
  selectBattleMapV3CatalogEntry
} from '../../../../shared/index.js';

export const BATTLE_MAP_V3_ACTIVE_RELEASE_SCHEMA =
  'battle-map-v3-active-release-pin-v1';
export const BATTLE_MAP_V3_ACTIVE_RELEASE_PATH = new URL(
  '../../../../battle-maps/catalog/active-release.json',
  import.meta.url
);

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:/-]{0,127})$/;
const PIN_KEYS = Object.freeze([
  'schemaVersion',
  'catalogReleaseId',
  'catalogPath',
  'catalogFullHash',
  'maps'
]);
const MAP_PIN_KEYS = Object.freeze([
  'contentId',
  'contentVersion',
  'path',
  'fullHash'
]);
let deployedReleasePromise = null;

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertClosed(value, keys, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object`);
  for (const key of keys) {
    if (!own(value, key)) throw new TypeError(`${label}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new TypeError(`${label}.${key} is not allowed`);
  }
}

function assertSafeId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase safe identifier`);
  }
}

function assertHash(value, label) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase sha256 hash`);
  }
}

function assertTrackedPath(value, label) {
  if (typeof value !== 'string'
    || value.length === 0
    || value.startsWith('/')
    || value.includes('\\')
    || value.includes('?')
    || value.includes('#')) {
    throw new TypeError(`${label} must be a tracked root-relative path`);
  }
  const segments = value.split('/');
  if (segments.some(segment => {
    if (segment.length === 0) return true;
    try {
      const decoded = decodeURIComponent(segment);
      return decoded === '.' || decoded === '..' || decoded.includes('/');
    } catch {
      return true;
    }
  })) {
    throw new TypeError(`${label} must not contain empty, encoded, or traversal segments`);
  }
}

export function assertBattleMapV3ActiveReleasePin(value) {
  assertClosed(value, PIN_KEYS, 'BattleMapV3ActiveReleasePin');
  if (value.schemaVersion !== BATTLE_MAP_V3_ACTIVE_RELEASE_SCHEMA) {
    throw new TypeError(
      `BattleMapV3ActiveReleasePin.schemaVersion must equal ${BATTLE_MAP_V3_ACTIVE_RELEASE_SCHEMA}`
    );
  }
  assertSafeId(value.catalogReleaseId, 'BattleMapV3ActiveReleasePin.catalogReleaseId');
  assertTrackedPath(value.catalogPath, 'BattleMapV3ActiveReleasePin.catalogPath');
  assertHash(value.catalogFullHash, 'BattleMapV3ActiveReleasePin.catalogFullHash');
  if (!Array.isArray(value.maps) || value.maps.length === 0) {
    throw new TypeError('BattleMapV3ActiveReleasePin.maps must be a non-empty array');
  }
  const identities = new Set();
  const paths = new Set();
  value.maps.forEach((map, index) => {
    const label = `BattleMapV3ActiveReleasePin.maps[${index}]`;
    assertClosed(map, MAP_PIN_KEYS, label);
    assertSafeId(map.contentId, `${label}.contentId`);
    if (!Number.isSafeInteger(map.contentVersion) || map.contentVersion < 1) {
      throw new TypeError(`${label}.contentVersion must be a positive safe integer`);
    }
    assertTrackedPath(map.path, `${label}.path`);
    assertHash(map.fullHash, `${label}.fullHash`);
    const identity = `${map.contentId}@${map.contentVersion}`;
    if (identities.has(identity)) throw new TypeError(`Duplicate V3 map identity ${identity}`);
    if (paths.has(map.path)) throw new TypeError(`Duplicate V3 map path ${map.path}`);
    identities.add(identity);
    paths.add(map.path);
  });
  return value;
}

function resolveTrackedUrl(workspaceRootUrl, trackedPath) {
  const resolved = new URL(trackedPath, workspaceRootUrl);
  if (resolved.protocol !== 'file:' || !resolved.href.startsWith(workspaceRootUrl.href)) {
    throw new TypeError(`Tracked BattleMapV3 path escapes the workspace: ${trackedPath}`);
  }
  return resolved;
}

async function defaultReadJson(url) {
  const source = await readFile(url, 'utf8');
  return JSON.parse(source);
}

/**
 * Load and verify one release unit from its tracked active pin. Missing or
 * corrupt tracked content throws; only a valid release with no eligible entry
 * may produce migration coverage absence.
 */
export async function loadBattleMapV3ReleaseFromPin(pin, {
  readJson = defaultReadJson,
  workspaceRootUrl = new URL('../../../../', import.meta.url)
} = {}) {
  const pinSnapshot = structuredClone(pin);
  assertBattleMapV3ActiveReleasePin(pinSnapshot);
  const release = await normalizeBattleMapV3CatalogRelease(
    await readJson(resolveTrackedUrl(workspaceRootUrl, pinSnapshot.catalogPath))
  );
  if (release.catalogReleaseId !== pinSnapshot.catalogReleaseId
    || release.catalogFullHash !== pinSnapshot.catalogFullHash) {
    throw new Error('Active BattleMapV3 pin does not match its catalog release');
  }

  const maps = [];
  const mapsByIdentity = new Map();
  for (const mapPin of pinSnapshot.maps) {
    const map = await normalizeBattleMapV3Final(
      await readJson(resolveTrackedUrl(workspaceRootUrl, mapPin.path))
    );
    const identity = `${map.contentId}@${map.contentVersion}`;
    if (identity !== `${mapPin.contentId}@${mapPin.contentVersion}`
      || map.hashes.fullHash !== mapPin.fullHash) {
      throw new Error(`Active BattleMapV3 map pin mismatch for ${identity}`);
    }
    maps.push(map);
    mapsByIdentity.set(identity, map);
  }
  await assertBattleMapV3CatalogMapPins(release, maps);
  const mapIndex = Object.freeze({
    get: identity => mapsByIdentity.get(identity),
    has: identity => mapsByIdentity.has(identity)
  });
  return Object.freeze({
    pin: Object.freeze({
      ...pinSnapshot,
      maps: Object.freeze(pinSnapshot.maps.map(mapPin => Object.freeze(mapPin)))
    }),
    release,
    maps: Object.freeze(maps),
    mapsByIdentity: mapIndex
  });
}

export async function loadDeployedBattleMapV3Catalog({
  readJson = defaultReadJson,
  activeReleaseUrl = BATTLE_MAP_V3_ACTIVE_RELEASE_PATH,
  workspaceRootUrl = new URL('../../../../', import.meta.url)
} = {}) {
  if (readJson !== defaultReadJson || activeReleaseUrl !== BATTLE_MAP_V3_ACTIVE_RELEASE_PATH) {
    const pin = await readJson(activeReleaseUrl);
    return loadBattleMapV3ReleaseFromPin(pin, { readJson, workspaceRootUrl });
  }
  deployedReleasePromise ??= readJson(activeReleaseUrl).then(pin =>
    loadBattleMapV3ReleaseFromPin(pin, { readJson, workspaceRootUrl })
  );
  return deployedReleasePromise;
}

export async function selectDeployedBattleMapV3(query, {
  loadCatalog = loadDeployedBattleMapV3Catalog
} = {}) {
  const deployed = await loadCatalog();
  const selection = await selectBattleMapV3CatalogEntry(deployed.release, query);
  if (selection.coverage === 'absent') {
    return Object.freeze({ ...selection, map: null });
  }
  const identity = `${selection.entry.mapContentId}@${selection.entry.mapContentVersion}`;
  const map = deployed.mapsByIdentity.get(identity);
  if (!map || map.hashes.fullHash !== selection.entry.mapFullHash) {
    throw new Error(`Selected BattleMapV3 artifact ${identity} is missing or corrupt`);
  }
  return Object.freeze({ ...selection, map });
}
