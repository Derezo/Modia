import {
  computeTemplateMapAssetBundleManifestFullHash,
  hashCanonicalV3Value
} from '@modia/shared';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const BATTLE_ART_RENDERER_MANIFEST_HASH_DOMAIN =
  'modia:battle-art:renderer-manifest:v1';
const ASSET_REF_KEYS = Object.freeze([
  'assetBundleId',
  'key',
  'contentVersion',
  'contentHash',
  'immutableUrl'
]);
const RUNTIME_BUNDLE_KEYS = Object.freeze([
  'schemaVersion',
  'id',
  'version',
  'manifestFullHash',
  'rendererManifestFullHash',
  'renderProfile',
  'assets',
  'renderers'
]);
const RENDERER_KEYS = Object.freeze([
  'id',
  'theme',
  'category',
  'contentVersion',
  'sha256',
  'immutableUrl',
  'width',
  'height',
  'pivot',
  'anchor',
  'footprint',
  'collision',
  'drawBounds',
  'occlusionBounds',
  'stratum'
]);
const RENDERER_VARIANT_KEYS = Object.freeze([
  'direction',
  'routeTopology',
  'ecologyProfile',
  'tier',
  'heightDelta',
  'surfaceVariant'
]);
const RENDER_PROFILE = Object.freeze({
  id: 'iso64-retina-v3',
  sourcePixelScale: 4,
  tileWidth: 64,
  tileHeight: 32,
  elevationStep: 16
});
const RENDERER_CATEGORIES = new Set([
  'surface',
  'route-transition',
  'connection-slope',
  'connection-stairs',
  'exposed-face-boundary',
  'blocking-obstacle',
  'nonblocking-decoration'
]);
const RENDERER_STRATA = new Set([
  'surface',
  'route',
  'connection',
  'boundary',
  'obstacle',
  'decoration'
]);
const RENDERER_CATEGORY_CONTRACT = Object.freeze({
  surface: Object.freeze({ collision: 'none', stratum: 'surface' }),
  'route-transition': Object.freeze({ collision: 'none', stratum: 'route' }),
  'connection-stairs': Object.freeze({
    collision: 'connection',
    stratum: 'connection'
  }),
  'connection-slope': Object.freeze({
    collision: 'connection',
    stratum: 'connection'
  }),
  'exposed-face-boundary': Object.freeze({
    collision: 'boundary',
    stratum: 'boundary'
  }),
  'blocking-obstacle': Object.freeze({ collision: 'solid', stratum: 'obstacle' }),
  'nonblocking-decoration': Object.freeze({
    collision: 'none',
    stratum: 'decoration'
  })
});
const RUNTIME_BUNDLE_REGISTRY_KEYS = Object.freeze([
  'schemaVersion',
  'bundles'
]);

let battleMapV3CurrentRuntimeManifest = null;
let battleMapV3SelectedRuntimeManifest = null;
let battleMapV3RuntimeManifests = Object.freeze([]);

function exactKeys(value, expected, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length ||
      actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${path} must contain exactly ${wanted.join(', ')}`);
  }
}

function exactKeysWithOptional(value, expected, optional, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  const required = new Set(expected);
  const allowed = new Set([...expected, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${path}.${key} is unsupported`);
    }
  }
  for (const key of required) {
    if (!(key in value)) {
      throw new TypeError(`${path}.${key} is required`);
    }
  }
}

function assertRendererVariant(value, path, category) {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some(key => !RENDERER_VARIANT_KEYS.includes(key))) {
    throw new TypeError(
      `${path} must contain only ${RENDERER_VARIANT_KEYS.join(', ')}`
    );
  }
  if (value.direction !== undefined &&
      !['n', 'e', 's', 'w'].includes(value.direction)) {
    throw new TypeError(`${path}.direction must be cardinal`);
  }
  if (value.routeTopology !== undefined) {
    const topologies = new Set([
      'isolated',
      'end-n',
      'end-e',
      'end-s',
      'end-w',
      'straight-ns',
      'straight-ew',
      'corner-ne',
      'corner-es',
      'corner-sw',
      'corner-wn',
      'tee-nes',
      'tee-esw',
      'tee-nsw',
      'tee-wne',
      'cross'
    ]);
    if (!topologies.has(value.routeTopology)) {
      throw new TypeError(`${path}.routeTopology is unsupported`);
    }
  }
  if (value.ecologyProfile !== undefined) {
    safeString(value.ecologyProfile, `${path}.ecologyProfile`);
  }
  if (value.tier !== undefined &&
      (!Number.isSafeInteger(value.tier) || value.tier < 1)) {
    throw new TypeError(`${path}.tier must be a positive integer`);
  }
  if (value.heightDelta !== undefined &&
      (!Number.isSafeInteger(value.heightDelta) ||
        value.heightDelta < 1 ||
        value.heightDelta > 64)) {
    throw new TypeError(`${path}.heightDelta must be a positive integer`);
  }
  if (value.surfaceVariant !== undefined) {
    if (!Number.isSafeInteger(value.surfaceVariant) ||
        value.surfaceVariant < 0 ||
        value.surfaceVariant > 7) {
      throw new TypeError(
        `${path}.surfaceVariant must be an integer from 0 through 7`
      );
    }
    if (category !== 'surface') {
      throw new TypeError(
        `${path}.surfaceVariant is supported only by surface renderers`
      );
    }
  }
}

function safeString(value, path) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
}

function positiveInteger(value, path, maximum = 16384) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${path} must be an integer from 1 through ${maximum}`);
  }
}

function assertPoint(value, path, bounds = null) {
  exactKeys(value, ['x', 'y'], path);
  for (const key of ['x', 'y']) {
    if (!Number.isSafeInteger(value[key])) {
      throw new TypeError(`${path}.${key} must be an integer`);
    }
  }
  if (bounds && (
    value.x < 0 || value.y < 0 ||
    value.x > bounds.width || value.y > bounds.height
  )) {
    throw new TypeError(`${path} must be within renderer dimensions`);
  }
}

function assertRect(
  value,
  path,
  bounds = null,
  allowTileOffsets = false,
  allowEmpty = false
) {
  exactKeys(value, ['x', 'y', 'width', 'height'], path);
  if (!Number.isSafeInteger(value.x) || !Number.isSafeInteger(value.y)) {
    throw new TypeError(`${path} origin must contain integers`);
  }
  const isEmpty = value.width === 0 && value.height === 0;
  if (!isEmpty || !allowEmpty) {
    positiveInteger(value.width, `${path}.width`);
    positiveInteger(value.height, `${path}.height`);
  } else if (value.x !== 0 || value.y !== 0) {
    throw new TypeError(
      `${path} empty bounds must use the canonical zero rectangle`
    );
  }
  if (!allowTileOffsets && (
    value.x < 0 || value.y < 0 ||
    value.x + value.width > bounds.width ||
    value.y + value.height > bounds.height
  )) {
    throw new TypeError(`${path} must be within renderer dimensions`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function assertAssetRecord(value, path, assetBundleId = value?.assetBundleId) {
  exactKeys(value, ASSET_REF_KEYS, path);
  if (typeof value.assetBundleId !== 'string' ||
      value.assetBundleId.length === 0 ||
      value.assetBundleId !== assetBundleId) {
    throw new TypeError(`${path}.assetBundleId is invalid`);
  }
  if (typeof value.key !== 'string' || value.key.length === 0) {
    throw new TypeError(`${path}.key is invalid`);
  }
  if (!Number.isSafeInteger(value.contentVersion) ||
      value.contentVersion < 1) {
    throw new TypeError(`${path}.contentVersion is invalid`);
  }
  if (!SHA256_PATTERN.test(value.contentHash)) {
    throw new TypeError(`${path}.contentHash must be a lowercase sha256 hash`);
  }
  assertImmutableAssetUrl(value.immutableUrl, `${path}.immutableUrl`);
  return value;
}

function assertImmutableAssetUrl(value, path) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${path} must be a strict immutable URL`);
  }
  try {
    const rootRelative = value.startsWith('/') && !value.startsWith('//');
    const parsed = new URL(
      value,
      rootRelative ? 'https://modia.invalid' : undefined
    );
    if ((!rootRelative && parsed.protocol !== 'https:') ||
        parsed.username || parsed.password || parsed.hash || parsed.search ||
        value.includes('\\') ||
        (rootRelative && parsed.pathname !== value)) {
      throw new TypeError(`${path} must be a strict immutable URL`);
    }
    for (const segment of parsed.pathname.split('/').filter(Boolean)) {
      const decoded = decodeURIComponent(segment);
      if (decoded === '.' || decoded === '..' || decoded.includes('/')) {
        throw new TypeError(`${path} contains a path traversal segment`);
      }
    }
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith(path)) {
      throw error;
    }
    throw new TypeError(`${path} must be root-relative or absolute HTTPS`);
  }
}

function assetIdentity(asset) {
  return `${asset.assetBundleId}:${asset.key}:${asset.contentVersion}`;
}

function validateAndDedupeAssets(records, path = 'assets') {
  const byIdentity = new Map();
  const hashesByUrl = new Map();

  records.forEach((asset, index) => {
    assertAssetRecord(asset, `${path}[${index}]`);
    const knownHash = hashesByUrl.get(asset.immutableUrl);
    if (knownHash !== undefined && knownHash !== asset.contentHash) {
      throw new TypeError(
        `BattleMapV3 asset URL/hash conflict for ${asset.immutableUrl}`
      );
    }
    hashesByUrl.set(asset.immutableUrl, asset.contentHash);

    const identity = assetIdentity(asset);
    const known = byIdentity.get(identity);
    if (known && (known.contentHash !== asset.contentHash ||
        known.immutableUrl !== asset.immutableUrl)) {
      throw new TypeError(
        `BattleMapV3 asset identity conflict for ${identity}`
      );
    }
    byIdentity.set(identity, asset);
  });

  return Array.from(byIdentity.values());
}

function collectAuthoredAssetRecords(layer, records = []) {
  if (!Array.isArray(layer)) return records;
  for (const value of layer) {
    if (Array.isArray(value)) {
      collectAuthoredAssetRecords(value, records);
    } else if (value?.assetKey) {
      records.push(value);
    }
  }
  return records;
}

function assertRuntimeBundleEnvelope(manifest) {
  exactKeys(
    manifest,
    RUNTIME_BUNDLE_KEYS,
    'BattleMapV3 runtime manifest'
  );
  if (manifest.schemaVersion !== 'battle-art-runtime-bundle-v1') {
    throw new TypeError('BattleMapV3 runtime manifest schemaVersion is unsupported');
  }
  if (typeof manifest.id !== 'string' || manifest.id.length === 0) {
    throw new TypeError('BattleMapV3 runtime manifest id is invalid');
  }
  if (!Number.isSafeInteger(manifest.version) || manifest.version < 1) {
    throw new TypeError('BattleMapV3 runtime manifest version is invalid');
  }
  if (!SHA256_PATTERN.test(manifest.manifestFullHash)) {
    throw new TypeError(
      'BattleMapV3 runtime manifest manifestFullHash must be a lowercase sha256 hash'
    );
  }
  if (!SHA256_PATTERN.test(manifest.rendererManifestFullHash)) {
    throw new TypeError(
      'BattleMapV3 runtime manifest rendererManifestFullHash must be a lowercase sha256 hash'
    );
  }
  exactKeys(
    manifest.renderProfile,
    ['id', 'sourcePixelScale', 'tileWidth', 'tileHeight', 'elevationStep'],
    'BattleMapV3 runtime manifest.renderProfile'
  );
  for (const [key, expected] of Object.entries(RENDER_PROFILE)) {
    if (manifest.renderProfile[key] !== expected) {
      throw new TypeError(
        `BattleMapV3 runtime manifest.renderProfile.${key} must equal ${expected}`
      );
    }
  }
}

/**
 * Collect every immutable asset reference in a verified BattleMapV3 payload.
 * Duplicate references are collapsed, while a URL or logical asset identity
 * resolving to conflicting bytes is rejected before any request is made.
 */
export function collectBattleMapV3AssetManifest(map) {
  if (map?.battleMapSchemaVersion !== 3) {
    throw new TypeError('BattleMapV3 asset collection requires schema 3');
  }

  const records = [];
  for (const row of map.visualCells ?? []) {
    for (const cell of row ?? []) {
      if (!cell) continue;
      records.push(cell.surface, ...(cell.overlays ?? []));
    }
  }
  for (const connection of map.elevationConnections ?? []) {
    if (connection.asset) records.push(connection.asset);
  }
  for (const obstacle of map.obstacles ?? []) {
    records.push(obstacle.asset);
  }
  for (const decoration of map.decorations ?? []) {
    records.push(decoration.asset);
  }
  for (const boundary of map.boundaries ?? []) {
    records.push(boundary.asset);
  }
  for (const route of map.routes ?? []) {
    for (const visual of route.visualAssets ?? []) {
      records.push(visual.asset);
    }
  }

  return validateAndDedupeAssets(records, 'battleMapV3.assets');
}

/**
 * Structurally validate and set a runtime manifest. This synchronous injection
 * point supports already-trusted fixtures and callers; production bootstrap
 * must use a cryptographically verifying install function before V3 readiness
 * changes.
 *
 * Interface:
 * { id, version, manifestFullHash, assets:
 *   [{ key, contentVersion, contentHash, immutableUrl }] }
 */
function prepareBattleMapV3RuntimeManifest(manifest) {
  assertRuntimeBundleEnvelope(manifest);
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    throw new TypeError('BattleMapV3 runtime manifest assets must be non-empty');
  }

  const assets = validateAndDedupeAssets(
    manifest.assets.map((asset, index) => {
      exactKeys(
        asset,
        ['key', 'contentVersion', 'contentHash', 'immutableUrl'],
        `BattleMapV3 runtime manifest.assets[${index}]`
      );
      return { assetBundleId: manifest.id, ...asset };
    }),
    'BattleMapV3 runtime manifest.assets'
  );
  if (!Array.isArray(manifest.renderers) ||
      manifest.renderers.length !== assets.length) {
    throw new TypeError(
      'BattleMapV3 runtime manifest requires one renderer per exact asset'
    );
  }

  const assetByKey = new Map(assets.map(asset => [asset.key, asset]));
  if (assetByKey.size !== assets.length) {
    throw new TypeError('BattleMapV3 runtime manifest asset keys must be unique');
  }
  const renderers = manifest.renderers.map((renderer, index) => {
    const path = `BattleMapV3 runtime manifest.renderers[${index}]`;
    exactKeysWithOptional(renderer, RENDERER_KEYS, ['variant'], path);
    assertRendererVariant(renderer.variant, `${path}.variant`, renderer.category);
    safeString(renderer.id, `${path}.id`);
    safeString(renderer.theme, `${path}.theme`);
    if (!RENDERER_CATEGORIES.has(renderer.category)) {
      throw new TypeError(`${path}.category is unsupported`);
    }
    positiveInteger(renderer.contentVersion, `${path}.contentVersion`);
    if (!SHA256_PATTERN.test(renderer.sha256)) {
      throw new TypeError(`${path}.sha256 must be a lowercase sha256 hash`);
    }
    assertImmutableAssetUrl(renderer.immutableUrl, `${path}.immutableUrl`);
    positiveInteger(renderer.width, `${path}.width`, 4096);
    positiveInteger(renderer.height, `${path}.height`, 4096);
    if (
      renderer.width % RENDER_PROFILE.sourcePixelScale !== 0 ||
      renderer.height % RENDER_PROFILE.sourcePixelScale !== 0
    ) {
      throw new TypeError(`${path} dimensions must divide by sourcePixelScale`);
    }
    const bounds = { width: renderer.width, height: renderer.height };
    assertPoint(renderer.pivot, `${path}.pivot`, bounds);
    assertPoint(renderer.anchor, `${path}.anchor`, bounds);
    assertRect(renderer.footprint, `${path}.footprint`, null, true);
    exactKeys(renderer.collision, ['kind', 'cells'], `${path}.collision`);
    const categoryContract = RENDERER_CATEGORY_CONTRACT[renderer.category];
    if (renderer.collision.kind !== categoryContract.collision) {
      throw new TypeError(`${path}.collision.kind does not match renderer category`);
    }
    if (!Array.isArray(renderer.collision.cells)) {
      throw new TypeError(`${path}.collision.cells must be an array`);
    }
    renderer.collision.cells.forEach((cell, cellIndex) =>
      assertPoint(
        cell,
        `${path}.collision.cells[${cellIndex}]`,
        {
          width: renderer.footprint.width - 1,
          height: renderer.footprint.height - 1
        }
      )
    );
    const collisionCells = new Set(
      renderer.collision.cells.map(cell => `${cell.x},${cell.y}`)
    );
    if (collisionCells.size !== renderer.collision.cells.length) {
      throw new TypeError(`${path}.collision.cells must be unique`);
    }
    if (
      (renderer.collision.kind === 'none') !==
      (renderer.collision.cells.length === 0)
    ) {
      throw new TypeError(`${path}.collision cells do not match collision kind`);
    }
    assertRect(renderer.drawBounds, `${path}.drawBounds`, bounds);
    assertRect(
      renderer.occlusionBounds,
      `${path}.occlusionBounds`,
      bounds,
      false,
      categoryContract.collision === 'none'
    );
    if (!RENDERER_STRATA.has(renderer.stratum)) {
      throw new TypeError(`${path}.stratum is unsupported`);
    }
    if (renderer.stratum !== categoryContract.stratum) {
      throw new TypeError(`${path}.stratum does not match renderer category`);
    }
    const asset = assetByKey.get(renderer.id);
    if (
      !asset ||
      asset.contentVersion !== renderer.contentVersion ||
      asset.contentHash !== renderer.sha256 ||
      asset.immutableUrl !== renderer.immutableUrl
    ) {
      throw new TypeError(
        `BattleMapV3 asset/renderer closure mismatch for ${renderer.id}`
      );
    }
    return deepFreeze(structuredClone(renderer));
  });
  const rendererIndex = new Map(renderers.map(renderer => [renderer.id, renderer]));
  if (rendererIndex.size !== renderers.length) {
    throw new TypeError('BattleMapV3 runtime renderer ids must be unique');
  }

  const frozenAssets = Object.freeze(assets.map(Object.freeze));
  return {
    schemaVersion: manifest.schemaVersion,
    id: manifest.id,
    version: manifest.version,
    manifestFullHash: manifest.manifestFullHash,
    rendererManifestFullHash: manifest.rendererManifestFullHash,
    renderProfile: Object.freeze({ ...manifest.renderProfile }),
    assets: frozenAssets,
    renderers: Object.freeze(renderers),
    assetIndex: new Map(assets.map(asset => [assetIdentity(asset), asset])),
    rendererIndex
  };
}

function publicRuntimeManifest(manifest) {
  return Object.freeze({
    schemaVersion: manifest.schemaVersion,
    id: manifest.id,
    version: manifest.version,
    manifestFullHash: manifest.manifestFullHash,
    rendererManifestFullHash: manifest.rendererManifestFullHash,
    renderProfile: manifest.renderProfile,
    assets: manifest.assets,
    renderers: manifest.renderers
  });
}

function installPreparedRuntimeManifests(manifests) {
  battleMapV3RuntimeManifests = Object.freeze([...manifests]);
  battleMapV3CurrentRuntimeManifest = manifests.at(-1) ?? null;
  battleMapV3SelectedRuntimeManifest = battleMapV3CurrentRuntimeManifest;
}

/**
 * Replace the registry with one already-trusted runtime bundle. This remains
 * the synchronous fixture and compatibility entry point for callers that only
 * need the current bundle.
 */
export function setBattleMapV3RuntimeManifest(manifest) {
  const prepared = prepareBattleMapV3RuntimeManifest(manifest);
  installPreparedRuntimeManifests([prepared]);
  return publicRuntimeManifest(prepared);
}

async function assertRuntimeBundleProvenance(manifest) {
  const rendererManifestFullHash = await hashCanonicalV3Value(
    BATTLE_ART_RENDERER_MANIFEST_HASH_DOMAIN,
    {
      id: manifest.id,
      version: manifest.version,
      renderProfile: manifest.renderProfile,
      renderers: manifest.renderers
    }
  );
  if (rendererManifestFullHash !== manifest.rendererManifestFullHash) {
    throw new TypeError(
      'BattleMapV3 runtime manifest rendererManifestFullHash does not match its canonical renderer projection'
    );
  }

  const manifestFullHash =
    await computeTemplateMapAssetBundleManifestFullHash(manifest);
  if (manifestFullHash !== manifest.manifestFullHash) {
    throw new TypeError(
      'BattleMapV3 runtime manifest manifestFullHash does not match its canonical asset-bundle projection'
    );
  }
}

export async function installBattleMapV3RuntimeBundle(manifest) {
  assertRuntimeBundleEnvelope(manifest);
  if (!Array.isArray(manifest.assets) || !Array.isArray(manifest.renderers)) {
    throw new TypeError(
      'BattleMapV3 runtime manifest assets and renderers must be arrays'
    );
  }
  await assertRuntimeBundleProvenance(manifest);
  if (
    manifest.assets.length === 0 &&
    manifest.renderers.length === 0
  ) {
    return false;
  }
  setBattleMapV3RuntimeManifest(manifest);
  return true;
}

/**
 * Verify and atomically install every immutable bundle in the generated
 * runtime registry. Registry order is release order, so the final bundle
 * remains the compatibility "current" bundle while map-bound lookups always
 * select by the full provenance triple.
 */
export async function installBattleMapV3RuntimeBundleRegistry(registry) {
  exactKeys(
    registry,
    RUNTIME_BUNDLE_REGISTRY_KEYS,
    'BattleMapV3 runtime bundle registry'
  );
  if (
    registry.schemaVersion !== 'battle-art-runtime-bundle-registry-v1'
  ) {
    throw new TypeError(
      'BattleMapV3 runtime bundle registry schemaVersion is unsupported'
    );
  }
  if (!Array.isArray(registry.bundles)) {
    throw new TypeError(
      'BattleMapV3 runtime bundle registry bundles must be an array'
    );
  }

  const prepared = [];
  const provenanceTriples = new Set();
  const hashesByImmutableUrl = new Map();
  for (const [index, manifest] of registry.bundles.entries()) {
    assertRuntimeBundleEnvelope(manifest);
    if (!Array.isArray(manifest.assets) || !Array.isArray(manifest.renderers)) {
      throw new TypeError(
        `BattleMapV3 runtime bundle registry.bundles[${index}] ` +
        'assets and renderers must be arrays'
      );
    }
    await assertRuntimeBundleProvenance(manifest);

    const triple = runtimeBundleProvenanceIdentity(manifest);
    if (provenanceTriples.has(triple)) {
      throw new TypeError(
        `BattleMapV3 runtime bundle registry contains ambiguous bundle ${triple}`
      );
    }
    provenanceTriples.add(triple);

    if (manifest.assets.length === 0 && manifest.renderers.length === 0) {
      continue;
    }
    const preparedManifest = prepareBattleMapV3RuntimeManifest(manifest);
    for (const asset of preparedManifest.assets) {
      const knownHash = hashesByImmutableUrl.get(asset.immutableUrl);
      if (knownHash !== undefined && knownHash !== asset.contentHash) {
        throw new TypeError(
          'BattleMapV3 runtime bundle registry URL/hash conflict for ' +
          asset.immutableUrl
        );
      }
      hashesByImmutableUrl.set(asset.immutableUrl, asset.contentHash);
    }
    prepared.push(preparedManifest);
  }

  if (prepared.length === 0) return false;
  installPreparedRuntimeManifests(prepared);
  return true;
}

export function clearBattleMapV3RuntimeManifest() {
  battleMapV3CurrentRuntimeManifest = null;
  battleMapV3SelectedRuntimeManifest = null;
  battleMapV3RuntimeManifests = Object.freeze([]);
}

export function isBattleMapV3RuntimeReady() {
  return battleMapV3CurrentRuntimeManifest !== null;
}

export function getBattleMapV3RenderProfile() {
  const runtimeManifest = battleMapV3SelectedRuntimeManifest;
  if (!runtimeManifest) {
    throw new Error('BattleMapV3 runtime asset bundle is not selected');
  }
  return runtimeManifest.renderProfile;
}

export function getBattleMapV3RendererDescriptor(asset) {
  const runtimeManifest = battleMapV3SelectedRuntimeManifest;
  if (!runtimeManifest) {
    throw new Error('BattleMapV3 runtime asset bundle is not selected');
  }
  const runtimeAsset = runtimeManifest.assetIndex.get(assetIdentity(asset));
  const renderer = runtimeManifest.rendererIndex.get(asset?.key);
  if (
    !runtimeAsset ||
    !renderer ||
    runtimeAsset.contentHash !== asset?.contentHash ||
    runtimeAsset.immutableUrl !== asset?.immutableUrl ||
    renderer.sha256 !== asset?.contentHash ||
    renderer.contentVersion !== asset?.contentVersion
  ) {
    throw new Error(
      `BattleMapV3 runtime renderer does not contain exact asset ${asset?.key}`
    );
  }
  return renderer;
}

function runtimeBundleProvenanceIdentity(pin) {
  return JSON.stringify([
    pin?.id,
    pin?.version,
    pin?.manifestFullHash
  ]);
}

export function assertBattleMapV3RuntimeManifestSupportsMap(map) {
  if (!battleMapV3CurrentRuntimeManifest) {
    throw new Error('BattleMapV3 runtime asset manifest is not ready');
  }
  battleMapV3SelectedRuntimeManifest = null;
  const pin = map?.provenance?.assetBundle;
  const provenanceIdentity = runtimeBundleProvenanceIdentity(pin);
  const matches = battleMapV3RuntimeManifests.filter(manifest =>
    runtimeBundleProvenanceIdentity(manifest) === provenanceIdentity
  );
  if (matches.length !== 1) {
    throw new Error('BattleMapV3 map asset-bundle pin is unavailable at runtime');
  }
  const runtimeManifest = matches[0];

  for (const asset of collectBattleMapV3AssetManifest(map)) {
    const runtimeAsset =
      runtimeManifest.assetIndex.get(assetIdentity(asset));
    if (!runtimeAsset ||
        runtimeAsset.contentHash !== asset.contentHash ||
        runtimeAsset.immutableUrl !== asset.immutableUrl ||
        !runtimeManifest.rendererIndex.has(asset.key)) {
      throw new Error(
        `BattleMapV3 runtime manifest does not contain exact asset ${asset.key}`
      );
    }
  }
  battleMapV3SelectedRuntimeManifest = runtimeManifest;
  return true;
}

/**
 * Build the map-specific visual preload manifest consumed by BattleScene.
 */
export function collectBattleMapAssetManifest(state, grid) {
  if (state?.battleMapSchemaVersion === 3) {
    return collectBattleMapV3AssetManifest(state);
  }
  if (state?.battleMapSchemaVersion === 2) {
    return collectAuthoredAssetRecords([
      state.obstacles,
      state.transitions,
      state.decorations
    ]);
  }

  return Array.from(new Map(
    (grid?.obstacles?.flat?.() ?? []).filter(Boolean).map(obstacle => [
      `${obstacle.type}:${obstacle.variant}`,
      obstacle
    ])
  ).values());
}
