import {
  canonicalizeJson,
  deepCloneJsonValue,
  deepFreeze
} from '../canonicalJson.js';
import {
  assertTemplateMapBlueprint,
  computeTemplateMapBlueprintFullHash
} from './blueprint.js';
import {
  BATTLE_MAP_V3_HASH_VERSION,
  BATTLE_MAP_V3_SCHEMA_VERSION,
  BATTLE_MAP_V3_TERRAIN_GENERATION_VERSION,
  assertBattleMapV3Candidate
} from './schema.js';
import { hashCanonicalV3Value } from './hashes.js';
import {
  assertBattleMapV3Topology,
  calculateTraversalPathCost,
  createBattleMapV3TraversalView
} from './traversalView.js';
import {
  SAFE_ID_PATTERN,
  SHA256_PATTERN
} from './validation.js';

export const TEMPLATE_MAP_COMPILER_VERSION = 5;
export const TEMPLATE_MAP_TILE_CATALOG_HASH_DOMAIN =
  'modia:template-map-compiler:tile-catalog:v1';
export const TEMPLATE_MAP_ASSET_BUNDLE_HASH_DOMAIN =
  'modia:template-map-compiler:asset-bundle:v1';
export const TEMPLATE_MAP_SOURCE_SIDECAR_HASH_DOMAIN =
  'modia:battle-map-source-sidecar:v1';

const CONTEXT_KEYS = Object.freeze([
  'identity', 'sourceSidecar', 'renderProfile', 'tileCatalog', 'assetBundle',
  'provenance'
]);
const IDENTITY_KEYS = Object.freeze([
  'contentId', 'contentVersion', 'templateRevision', 'theme',
  'tierEligibility', 'supportedModes'
]);
const PROFILE_V1_KEYS = Object.freeze([
  'id', 'theme', 'assetBundleId', 'elevationFaceSymbols', 'assetBindings'
]);
const PROFILE_V2_KEYS = Object.freeze([
  'schemaVersion', 'id', 'theme', 'ecologyProfile', 'assetBundleId',
  'scene', 'surfaceVariantCount', 'elevationFaceSymbols', 'assetBindings'
]);
const TILE_CATALOG_KEYS = Object.freeze([
  'id', 'version', 'fullHash', 'renderProfileId', 'materials'
]);
const ASSET_BUNDLE_KEYS = Object.freeze([
  'id', 'version', 'manifestFullHash', 'rendererManifestFullHash', 'assets'
]);
const PROVENANCE_KEYS = Object.freeze([
  'sourceSidecar', 'approvedBlueprint', 'compiler', 'validator'
]);
const ASSET_CATEGORIES = new Set([
  'surface', 'connection', 'obstacle', 'decoration', 'boundary', 'route'
]);
const BINDING_MATCH_KEYS = Object.freeze([
  'direction', 'heightDelta', 'routeTopology', 'surfaceVariant',
  'ecologyProfile', 'tier'
]);
const DIRECTIONS = Object.freeze(['n', 'e', 's', 'w']);
const ROUTE_TOPOLOGIES = new Set([
  'isolated',
  'end-n', 'end-e', 'end-s', 'end-w',
  'straight-ns', 'straight-ew',
  'corner-ne', 'corner-es', 'corner-sw', 'corner-wn',
  'tee-nes', 'tee-esw', 'tee-nsw', 'tee-wne',
  'cross'
]);
const SCENE_SILHOUETTES = new Set(['organic-island', 'rectangular-platform']);
const SCENE_EXTERIORS = new Set([
  'forest-canopy', 'cave-rock', 'mountain-crag', 'architectural-skirt', 'none'
]);
const SCENE_BACKDROPS = new Set([
  'sky-gradient', 'cavern-gradient', 'architectural-gradient'
]);
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(message, code = 'INVALID_TEMPLATE_MAP_COMPILER_INPUT') {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function exactObject(value, name, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)) {
    fail(`${name} must be a plain object`);
  }
  for (const key of keys) {
    if (!own(value, key)) fail(`${name}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`${name}.${key} is not allowed`);
  }
}

function safeId(value, name) {
  if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) {
    fail(`${name} must be a safe lowercase ID`);
  }
}

function integer(value, name, { min = 1 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) fail(`${name} must be an integer >= ${min}`);
}

function sha256(value, name) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail(`${name} must be a sha256 content pin`);
  }
}

function uniqueSafeIds(values, name) {
  if (!Array.isArray(values) || values.length === 0) fail(`${name} must be a non-empty array`);
  const seen = new Set();
  values.forEach((value, index) => {
    safeId(value, `${name}[${index}]`);
    if (seen.has(value)) fail(`${name}[${index}] duplicates ${value}`);
    seen.add(value);
  });
}

function safeIdMap(value, name) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)
  ) {
    fail(`${name} must be a plain object`);
  }
  const entries = Object.entries(value);
  if (entries.length === 0) fail(`${name} must be non-empty`);
  for (const [key, mappedValue] of entries) {
    safeId(key, `${name}.${key} material`);
    safeId(mappedValue, `${name}.${key}`);
  }
}

function validateScene(scene, name) {
  exactObject(scene, name, ['silhouette', 'exterior', 'backdrop']);
  if (!SCENE_SILHOUETTES.has(scene.silhouette)) {
    fail(`${name}.silhouette is not supported`);
  }
  if (!SCENE_EXTERIORS.has(scene.exterior)) {
    fail(`${name}.exterior is not supported`);
  }
  exactObject(scene.backdrop, `${name}.backdrop`, [
    'kind', 'topColor', 'horizonColor', 'bottomColor', 'hazeColor'
  ]);
  if (!SCENE_BACKDROPS.has(scene.backdrop.kind)) {
    fail(`${name}.backdrop.kind is not supported`);
  }
  for (const key of ['topColor', 'horizonColor', 'bottomColor', 'hazeColor']) {
    if (typeof scene.backdrop[key] !== 'string'
      || !HEX_COLOR_PATTERN.test(scene.backdrop[key])) {
      fail(`${name}.backdrop.${key} must be a #RRGGBB color`);
    }
  }
}

function validateBindingMatch(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${name} must be a plain object`);
  }
  const keys = Object.keys(value);
  if (keys.length === 0) fail(`${name} must select at least one concrete capability`);
  for (const key of keys) {
    if (!BINDING_MATCH_KEYS.includes(key)) fail(`${name}.${key} is not allowed`);
  }
  if (own(value, 'direction') && !DIRECTIONS.includes(value.direction)) {
    fail(`${name}.direction must be n, e, s, or w`);
  }
  if (own(value, 'heightDelta')) {
    integer(value.heightDelta, `${name}.heightDelta`);
  }
  if (own(value, 'routeTopology') && !ROUTE_TOPOLOGIES.has(value.routeTopology)) {
    fail(`${name}.routeTopology is not supported`);
  }
  if (own(value, 'surfaceVariant')) {
    integer(value.surfaceVariant, `${name}.surfaceVariant`, { min: 0 });
    if (value.surfaceVariant > 7) fail(`${name}.surfaceVariant must be <= 7`);
  }
  if (own(value, 'ecologyProfile')) {
    safeId(value.ecologyProfile, `${name}.ecologyProfile`);
  }
  if (own(value, 'tier')) integer(value.tier, `${name}.tier`);
}

function versionedPin(value, name) {
  exactObject(value, name, ['id', 'version', 'fullHash']);
  safeId(value.id, `${name}.id`);
  integer(value.version, `${name}.version`);
  sha256(value.fullHash, `${name}.fullHash`);
}

function validateCompilerContext(context, blueprint) {
  canonicalizeJson(context);
  exactObject(context, 'compilerContext', CONTEXT_KEYS);
  exactObject(context.identity, 'compilerContext.identity', IDENTITY_KEYS);
  safeId(context.identity.contentId, 'compilerContext.identity.contentId');
  integer(context.identity.contentVersion, 'compilerContext.identity.contentVersion');
  integer(context.identity.templateRevision, 'compilerContext.identity.templateRevision');
  safeId(context.identity.theme, 'compilerContext.identity.theme');
  uniqueSafeIds(context.identity.tierEligibility, 'compilerContext.identity.tierEligibility');
  uniqueSafeIds(context.identity.supportedModes, 'compilerContext.identity.supportedModes');

  const source = context.sourceSidecar;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    fail('compilerContext.sourceSidecar must be the complete approved sidecar object');
  }
  for (const key of [
    'schemaVersion', 'id', 'theme', 'status', 'tierEligibility',
    'supportedModes', 'mapProfile', 'topologyIntent', 'heightIntent',
    'routeIntent', 'spawnIntent', 'candidateMaps', 'pins', 'review'
  ]) {
    if (!own(source, key)) fail(`compilerContext.sourceSidecar.${key} is required`);
  }
  safeId(source.id, 'compilerContext.sourceSidecar.id');
  if (source.id !== blueprint.templateId) {
    fail('sourceSidecar.id must exactly match the blueprint templateId');
  }
  if (source.status !== 'approved' || source.review?.decision !== 'approved') {
    fail('sourceSidecar must carry an explicit approved review');
  }
  if (source.theme !== context.identity.theme) {
    fail('sourceSidecar.theme must exactly match identity.theme');
  }
  if (canonicalizeJson(source.tierEligibility)
    !== canonicalizeJson(context.identity.tierEligibility)) {
    fail('sourceSidecar.tierEligibility must exactly match identity.tierEligibility');
  }
  if (canonicalizeJson(source.supportedModes)
    !== canonicalizeJson(context.identity.supportedModes)) {
    fail('sourceSidecar.supportedModes must exactly match identity.supportedModes');
  }
  if (!Array.isArray(source.candidateMaps)
    || !source.candidateMaps.includes(blueprint.candidateId)) {
    fail('sourceSidecar.candidateMaps must include the blueprint candidateId');
  }
  exactObject(source.mapProfile, 'compilerContext.sourceSidecar.mapProfile', [
    'width', 'height', 'orientation', 'cameraFraming', 'playerCapacity',
    'candidatePoolSize', 'maxAssignableOpponents'
  ]);
  exactObject(
    source.mapProfile.playerCapacity,
    'compilerContext.sourceSidecar.mapProfile.playerCapacity',
    ['minimum', 'maximum']
  );
  integer(source.mapProfile.width, 'compilerContext.sourceSidecar.mapProfile.width');
  integer(source.mapProfile.height, 'compilerContext.sourceSidecar.mapProfile.height');
  integer(
    source.mapProfile.playerCapacity.minimum,
    'compilerContext.sourceSidecar.mapProfile.playerCapacity.minimum'
  );
  integer(
    source.mapProfile.playerCapacity.maximum,
    'compilerContext.sourceSidecar.mapProfile.playerCapacity.maximum'
  );
  if (source.mapProfile.playerCapacity.maximum < source.mapProfile.playerCapacity.minimum) {
    fail('sourceSidecar mapProfile playerCapacity maximum must be >= minimum');
  }
  integer(
    source.mapProfile.candidatePoolSize,
    'compilerContext.sourceSidecar.mapProfile.candidatePoolSize'
  );
  integer(
    source.mapProfile.maxAssignableOpponents,
    'compilerContext.sourceSidecar.mapProfile.maxAssignableOpponents'
  );
  if (blueprint.dimensions.width !== source.mapProfile.width
    || blueprint.dimensions.height !== source.mapProfile.height) {
    fail('blueprint dimensions must exactly match the approved sourceSidecar mapProfile');
  }
  const capacities = blueprint.spawn.capacities;
  if (capacities.playerCapacity < source.mapProfile.playerCapacity.minimum
    || capacities.playerCapacity > source.mapProfile.playerCapacity.maximum
    || capacities.candidatePoolSize !== source.mapProfile.candidatePoolSize
    || capacities.maxAssignableOpponents !== source.mapProfile.maxAssignableOpponents) {
    fail('blueprint spawn capacities must exactly satisfy the approved sourceSidecar mapProfile');
  }
  if (!Array.isArray(source.topologyIntent.areas)
    || !Array.isArray(source.topologyIntent.relationships)) {
    fail('sourceSidecar.topologyIntent must declare areas and relationships');
  }
  const regionIds = new Set(blueprint.regions.map(region => region.id));
  const sidecarAreaIds = new Set(
    source.topologyIntent.areas.map(area => area?.id).filter(Boolean)
  );
  for (const area of source.topologyIntent.areas) {
    if (area?.required === true && !regionIds.has(area.id)) {
      fail(`blueprint is missing required sidecar topology area ${area.id}`);
    }
  }
  for (const relationship of source.topologyIntent.relationships) {
    if (!sidecarAreaIds.has(relationship?.from)
      || !sidecarAreaIds.has(relationship?.to)) {
      fail('sourceSidecar topology relationship references an unknown area');
    }
    if (relationship?.required === true
      && (!regionIds.has(relationship.from) || !regionIds.has(relationship.to))) {
      fail(
        `blueprint is missing required topology relationship endpoints `
        + `${relationship.from}->${relationship.to}`
      );
    }
  }
  exactObject(source.heightIntent.levelCount, 'compilerContext.sourceSidecar.heightIntent.levelCount', [
    'minimum', 'maximum'
  ]);
  integer(
    source.heightIntent.levelCount.minimum,
    'compilerContext.sourceSidecar.heightIntent.levelCount.minimum'
  );
  integer(
    source.heightIntent.levelCount.maximum,
    'compilerContext.sourceSidecar.heightIntent.levelCount.maximum'
  );
  integer(
    source.heightIntent.maxGradualSlope,
    'compilerContext.sourceSidecar.heightIntent.maxGradualSlope',
    { min: 0 }
  );
  const authoredLevels = new Set();
  blueprint.elevation.forEach((row, y) => row.forEach((level, x) => {
    if (blueprint.renderMask[y][x]) authoredLevels.add(level);
  }));
  if (authoredLevels.size < source.heightIntent.levelCount.minimum
    || authoredLevels.size > source.heightIntent.levelCount.maximum) {
    fail('blueprint elevation level count violates the approved sidecar heightIntent');
  }
  if (blueprint.connections.some(connection =>
    connection.traversable
    && Math.abs(
      blueprint.elevation[connection.to.y][connection.to.x]
      - blueprint.elevation[connection.from.y][connection.from.x]
    ) > source.heightIntent.maxGradualSlope
  )) {
    fail('blueprint traversable elevation exceeds the approved sidecar maxGradualSlope');
  }
  integer(
    source.routeIntent.minimumApproachesPerFormation,
    'compilerContext.sourceSidecar.routeIntent.minimumApproachesPerFormation'
  );
  integer(
    source.spawnIntent.minimumApproaches,
    'compilerContext.sourceSidecar.spawnIntent.minimumApproaches'
  );
  integer(
    source.spawnIntent.localClearanceTiles,
    'compilerContext.sourceSidecar.spawnIntent.localClearanceTiles',
    { min: 0 }
  );
  const requiredApproaches = Math.max(
    source.routeIntent.minimumApproachesPerFormation,
    source.spawnIntent.minimumApproaches
  );
  for (const side of ['player', 'opponent']) {
    if (blueprint.spawn.exits.filter(exit => exit.side === side).length < requiredApproaches) {
      fail(`blueprint ${side} formation has fewer than ${requiredApproaches} approved approaches`);
    }
  }
  if (!Array.isArray(source.spawnIntent.candidateRoles)) {
    fail('sourceSidecar.spawnIntent.candidateRoles must be an array');
  }
  const candidateTags = new Set([
    ...blueprint.spawn.opponentCandidates.flatMap(candidate => candidate.tags),
    ...blueprint.spawn.opponentZones.flatMap(zone => zone.tags)
  ]);
  for (const role of source.spawnIntent.candidateRoles) {
    safeId(role, 'compilerContext.sourceSidecar.spawnIntent.candidateRoles[]');
    if (!candidateTags.has(role)) {
      fail(`blueprint opponent pool is missing approved candidate role ${role}`);
    }
  }
  const localClearance = source.spawnIntent.localClearanceTiles;
  if (localClearance > 0) {
    if (blueprint.spawn.opponentCandidates.some(candidate =>
      candidate.minimumClearance < localClearance
    )) {
      fail('blueprint opponent candidates violate sidecar localClearanceTiles');
    }
    const explicitCandidateCells = new Set(
      blueprint.spawn.opponentCandidates.map(candidate =>
        `${candidate.cell.x},${candidate.cell.y}`
      )
    );
    if (blueprint.spawn.opponentZones.some(zone =>
      zone.cells.some(cell => !explicitCandidateCells.has(`${cell.x},${cell.y}`))
    )) {
      fail(
        'every zone pool cell must be an explicit candidate when sidecar localClearanceTiles is positive'
      );
    }
    const playerClearanceAnchors = new Set(
      blueprint.spawn.protectedClearances
        .filter(clearance => clearance.side === 'player' && clearance.radius >= localClearance)
        .map(clearance => clearance.anchorId)
    );
    if (blueprint.spawn.playerSlots.some(slot => !playerClearanceAnchors.has(slot.id))) {
      fail('blueprint player slots violate sidecar localClearanceTiles');
    }
  }

  const renderProfileV2 =
    context.renderProfile?.schemaVersion === 'battle-map-render-profile-v2';
  exactObject(
    context.renderProfile,
    'compilerContext.renderProfile',
    renderProfileV2 ? PROFILE_V2_KEYS : PROFILE_V1_KEYS
  );
  safeId(context.renderProfile.id, 'compilerContext.renderProfile.id');
  safeId(context.renderProfile.theme, 'compilerContext.renderProfile.theme');
  safeId(context.renderProfile.assetBundleId, 'compilerContext.renderProfile.assetBundleId');
  safeIdMap(
    context.renderProfile.elevationFaceSymbols,
    'compilerContext.renderProfile.elevationFaceSymbols'
  );
  if (context.renderProfile.theme !== context.identity.theme) {
    fail('compilerContext.renderProfile.theme must exactly match identity.theme');
  }
  if (renderProfileV2) {
    safeId(
      context.renderProfile.ecologyProfile,
      'compilerContext.renderProfile.ecologyProfile'
    );
    integer(
      context.renderProfile.surfaceVariantCount,
      'compilerContext.renderProfile.surfaceVariantCount'
    );
    if (context.renderProfile.surfaceVariantCount > 8) {
      fail('compilerContext.renderProfile.surfaceVariantCount must be <= 8');
    }
    validateScene(context.renderProfile.scene, 'compilerContext.renderProfile.scene');
  }

  exactObject(context.tileCatalog, 'compilerContext.tileCatalog', TILE_CATALOG_KEYS);
  safeId(context.tileCatalog.id, 'compilerContext.tileCatalog.id');
  integer(context.tileCatalog.version, 'compilerContext.tileCatalog.version');
  sha256(context.tileCatalog.fullHash, 'compilerContext.tileCatalog.fullHash');
  safeId(context.tileCatalog.renderProfileId, 'compilerContext.tileCatalog.renderProfileId');
  if (context.tileCatalog.renderProfileId !== context.renderProfile.id) {
    fail('compilerContext.tileCatalog.renderProfileId must exactly match renderProfile.id');
  }

  exactObject(context.assetBundle, 'compilerContext.assetBundle', ASSET_BUNDLE_KEYS);
  safeId(context.assetBundle.id, 'compilerContext.assetBundle.id');
  integer(context.assetBundle.version, 'compilerContext.assetBundle.version');
  sha256(context.assetBundle.manifestFullHash, 'compilerContext.assetBundle.manifestFullHash');
  sha256(
    context.assetBundle.rendererManifestFullHash,
    'compilerContext.assetBundle.rendererManifestFullHash'
  );
  if (context.assetBundle.id !== context.renderProfile.assetBundleId) {
    fail('compilerContext.assetBundle.id must exactly match renderProfile.assetBundleId');
  }

  exactObject(context.provenance, 'compilerContext.provenance', PROVENANCE_KEYS);
  for (const key of PROVENANCE_KEYS) {
    versionedPin(context.provenance[key], `compilerContext.provenance.${key}`);
  }
  if (context.provenance.sourceSidecar.id !== context.sourceSidecar.id) {
    fail('sourceSidecar provenance id must exactly match the approved sidecar');
  }
  if (context.provenance.approvedBlueprint.id !== blueprint.candidateId) {
    fail('approvedBlueprint.id must exactly match the blueprint candidateId');
  }
  if (context.provenance.compiler.version !== TEMPLATE_MAP_COMPILER_VERSION) {
    fail(`compiler provenance version must equal ${TEMPLATE_MAP_COMPILER_VERSION}`);
  }
}

function createMaterialIndex(tileCatalog) {
  if (!Array.isArray(tileCatalog.materials) || tileCatalog.materials.length === 0) {
    fail('compilerContext.tileCatalog.materials must be a non-empty array');
  }
  const index = new Map();
  tileCatalog.materials.forEach((record, position) => {
    const name = `compilerContext.tileCatalog.materials[${position}]`;
    exactObject(record, name, ['symbol', 'material', 'passable', 'movementCost']);
    safeId(record.symbol, `${name}.symbol`);
    safeId(record.material, `${name}.material`);
    if (typeof record.passable !== 'boolean') fail(`${name}.passable must be a boolean`);
    if (typeof record.movementCost !== 'number' || !Number.isFinite(record.movementCost)
      || record.movementCost < 0) {
      fail(`${name}.movementCost must be a finite non-negative number`);
    }
    if (index.has(record.symbol)) fail(`ambiguous tile material symbol ${record.symbol}`);
    index.set(record.symbol, record);
  });
  return index;
}

function createAssetIndex(assetBundle) {
  if (!Array.isArray(assetBundle.assets) || assetBundle.assets.length === 0) {
    fail('compilerContext.assetBundle.assets must be a non-empty array');
  }
  const index = new Map();
  assetBundle.assets.forEach((record, position) => {
    const name = `compilerContext.assetBundle.assets[${position}]`;
    exactObject(record, name, ['key', 'contentVersion', 'contentHash', 'immutableUrl']);
    safeId(record.key, `${name}.key`);
    integer(record.contentVersion, `${name}.contentVersion`);
    sha256(record.contentHash, `${name}.contentHash`);
    if (typeof record.immutableUrl !== 'string' || record.immutableUrl.length === 0) {
      fail(`${name}.immutableUrl must be a non-empty immutable URL`);
    }
    if (index.has(record.key)) fail(`ambiguous asset record key ${record.key}`);
    index.set(record.key, record);
  });
  return index;
}

function createBindingResolver(
  renderProfile,
  assetBundle,
  usedFamilies,
  requiredFamilies
) {
  if (!Array.isArray(renderProfile.assetBindings) || renderProfile.assetBindings.length === 0) {
    fail('compilerContext.renderProfile.assetBindings must be a non-empty array');
  }
  const assets = createAssetIndex(assetBundle);
  const bindings = new Map();
  const renderProfileV2 =
    renderProfile.schemaVersion === 'battle-map-render-profile-v2';
  renderProfile.assetBindings.forEach((record, position) => {
    const name = `compilerContext.renderProfile.assetBindings[${position}]`;
    const bindingV2 = own(record, 'match');
    exactObject(
      record,
      name,
      bindingV2
        ? ['category', 'symbol', 'match', 'assetKey']
        : ['category', 'symbol', 'assetKey']
    );
    if (renderProfileV2 !== bindingV2) {
      fail(
        `${name} must ${renderProfileV2 ? '' : 'not '}use a concrete match record`
      );
    }
    if (!ASSET_CATEGORIES.has(record.category)) fail(`${name}.category is unknown`);
    safeId(record.symbol, `${name}.symbol`);
    safeId(record.assetKey, `${name}.assetKey`);
    if (bindingV2) validateBindingMatch(record.match, `${name}.match`);
    const key = `${record.category}:${record.symbol}`;
    const records = bindings.get(key) ?? [];
    const canonicalMatch = bindingV2 ? canonicalizeJson(record.match) : '';
    if (records.some(existing => existing.canonicalMatch === canonicalMatch)) {
      fail(`ambiguous render-profile asset binding ${key} match ${canonicalMatch}`);
    }
    records.push({
      assetKey: record.assetKey,
      match: bindingV2 ? record.match : {},
      canonicalMatch
    });
    bindings.set(key, records);
  });
  const missingBindings = [...requiredFamilies]
    .filter(family => !bindings.has(family))
    .sort();
  const missingAssets = [...bindings]
    .flatMap(([family, records]) =>
      records
        .filter(record => !assets.has(record.assetKey))
        .map(record => `${family}->${record.assetKey}`)
    )
    .sort();
  if (missingBindings.length > 0 || missingAssets.length > 0) {
    fail(
      [
        missingBindings.length ? `missing bindings: ${missingBindings.join(', ')}` : null,
        missingAssets.length ? `missing asset records: ${missingAssets.join(', ')}` : null
      ].filter(Boolean).join('; '),
      'MISSING_BATTLE_MAP_V3_ASSET'
    );
  }

  return (category, symbol, capabilities = {}) => {
    const family = `${category}:${symbol}`;
    usedFamilies.add(family);
    const candidates = (bindings.get(family) ?? [])
      .filter(record => Object.entries(record.match).every(
        ([key, value]) => capabilities[key] === value
      ))
      .sort((left, right) =>
        Object.keys(right.match).length - Object.keys(left.match).length
      );
    if (candidates.length === 0) {
      fail(
        `missing exact render-profile asset binding for ${family} `
        + `capabilities ${canonicalizeJson(capabilities)}`,
        'MISSING_BATTLE_MAP_V3_ASSET'
      );
    }
    const specificity = Object.keys(candidates[0].match).length;
    if (
      candidates.length > 1
      && Object.keys(candidates[1].match).length === specificity
    ) {
      fail(
        `ambiguous render-profile asset binding for ${family} `
        + `capabilities ${canonicalizeJson(capabilities)}`
      );
    }
    const assetKey = candidates[0].assetKey;
    const asset = assets.get(assetKey);
    return {
      assetBundleId: assetBundle.id,
      key: asset.key,
      contentVersion: asset.contentVersion,
      contentHash: asset.contentHash,
      immutableUrl: asset.immutableUrl
    };
  };
}

function direction(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 1 && dy === 0) return 'e';
  if (dx === -1 && dy === 0) return 'w';
  if (dx === 0 && dy === 1) return 's';
  if (dx === 0 && dy === -1) return 'n';
  fail(`connection ${from.x},${from.y} to ${to.x},${to.y} is not cardinal`, 'INVALID_BATTLE_MAP_V3_TOPOLOGY');
}

function reverseDirection(value) {
  return ({ n: 's', e: 'w', s: 'n', w: 'e' })[value];
}

function lowToHighDirection(record, heightDelta) {
  const authored = direction(record.from, record.to);
  return heightDelta < 0 ? reverseDirection(authored) : authored;
}

function commonCapabilities(renderProfile, identity) {
  if (renderProfile.schemaVersion !== 'battle-map-render-profile-v2') return {};
  const capabilities = {
    ecologyProfile: renderProfile.ecologyProfile
  };
  if (identity.tierEligibility.length === 1) {
    const match = /^tier-(\d+)$/.exec(identity.tierEligibility[0]);
    if (match) capabilities.tier = Number(match[1]);
  }
  return capabilities;
}

function deterministicSurfaceVariant(x, y, identity, count) {
  const mixed = (
    Math.imul(x + 1, 73856093)
    ^ Math.imul(y + 1, 19349663)
    ^ Math.imul(identity.contentVersion, 83492791)
    ^ Math.imul(identity.templateRevision, 2654435761)
  ) >>> 0;
  return mixed % count;
}

function undirectedEdgeKey(left, right) {
  const values = [
    `${left.x},${left.y}`,
    `${right.x},${right.y}`
  ].sort();
  return values.join('~');
}

function compileElevationFaces(blueprint, {
  elevationFaceSymbols,
  resolveAsset,
  authoredBoundaryIds,
  baseCapabilities,
  directionalAssets
}) {
  const traversableConnectionEdges = new Set(
    blueprint.connections
      .filter(record =>
        record.traversable === true &&
        ['slope', 'stairs'].includes(record.kind)
      )
      .map(record => undirectedEdgeKey(record.from, record.to))
  );
  const faces = [];
  const directions = [
    { direction: 'e', dx: 1, dy: 0 },
    { direction: 's', dx: 0, dy: 1 }
  ];
  for (let y = 0; y < blueprint.dimensions.height; y += 1) {
    for (let x = 0; x < blueprint.dimensions.width; x += 1) {
      if (blueprint.renderMask[y][x] !== true) continue;
      const exposedEdges = [];
      for (const candidate of directions) {
        const nx = x + candidate.dx;
        const ny = y + candidate.dy;
        if (
          nx >= blueprint.dimensions.width
          || ny >= blueprint.dimensions.height
          || blueprint.renderMask[ny][nx] !== true
          || blueprint.elevation[y][x] <= blueprint.elevation[ny][nx]
          || traversableConnectionEdges.has(undirectedEdgeKey(
            { x, y },
            { x: nx, y: ny }
          ))
        ) continue;
        exposedEdges.push({
          edge: {
            cell: { x, y },
            direction: candidate.direction
          },
          levelCount:
            blueprint.elevation[y][x] - blueprint.elevation[ny][nx]
        });
      }
      if (exposedEdges.length === 0) continue;
      const materialSymbol = blueprint.surfaceGrid[y][x].material;
      const faceSymbol = elevationFaceSymbols[materialSymbol];
      if (!faceSymbol) {
        fail(
          `render profile lacks an elevation-face binding for material ${materialSymbol}`,
          'MISSING_BATTLE_MAP_V3_ASSET'
        );
      }
      const maximumLevelCount = Math.max(
        ...exposedEdges.map(record => record.levelCount)
      );
      for (let levelOffset = 1; levelOffset <= maximumLevelCount; levelOffset += 1) {
        if (!directionalAssets) {
          const id = levelOffset === 1
            ? `boundary:elevation-face:${x}:${y}`
            : `boundary:elevation-face:${x}:${y}:${levelOffset}`;
          if (authoredBoundaryIds.has(id)) {
            fail(`derived elevation face collides with authored boundary ${id}`);
          }
          const face = {
            id,
            kind: 'elevation-face',
            edges: exposedEdges
              .filter(record => record.levelCount >= levelOffset)
              .map(record => record.edge),
            featureId: blueprint.surfaceGrid[y][x].featureId,
            sceneOnly: true,
            asset: resolveAsset('boundary', faceSymbol, baseCapabilities)
          };
          if (levelOffset > 1) face.levelOffset = levelOffset;
          faces.push(face);
          continue;
        }
        for (const record of exposedEdges.filter(
          candidate => candidate.levelCount >= levelOffset
        )) {
          const id = levelOffset === 1
            ? `boundary:elevation-face:${x}:${y}:${record.edge.direction}`
            : `boundary:elevation-face:${x}:${y}:${record.edge.direction}:${levelOffset}`;
          if (authoredBoundaryIds.has(id)) {
            fail(`derived elevation face collides with authored boundary ${id}`);
          }
          const face = {
            id,
            kind: 'elevation-face',
            edges: [record.edge],
            featureId: blueprint.surfaceGrid[y][x].featureId,
            sceneOnly: true,
            asset: resolveAsset('boundary', faceSymbol, {
              ...baseCapabilities,
              direction: record.edge.direction,
              heightDelta: 1
            })
          };
          if (levelOffset > 1) face.levelOffset = levelOffset;
          faces.push(face);
        }
      }
    }
  }
  return faces;
}

function compileAuthoredBoundaries(
  blueprint,
  resolveAsset,
  baseCapabilities,
  directionalAssets
) {
  const records = [];
  for (const record of blueprint.boundaries) {
    if (!directionalAssets) {
      records.push({
        id: record.id,
        kind: record.kind,
        edges: record.edges,
        featureId: record.featureId,
        sceneOnly: record.sceneOnly,
        asset: resolveAsset('boundary', record.assetFamily, baseCapabilities)
      });
      continue;
    }
    const byDirection = new Map();
    for (const edge of record.edges) {
      const edges = byDirection.get(edge.direction) ?? [];
      edges.push(edge);
      byDirection.set(edge.direction, edges);
    }
    const split = byDirection.size > 1;
    for (const [edgeDirection, edges] of byDirection) {
      records.push({
        id: split ? `${record.id}:${edgeDirection}` : record.id,
        kind: record.kind,
        edges,
        featureId: record.featureId,
        sceneOnly: record.sceneOnly,
        asset: resolveAsset('boundary', record.assetFamily, {
          ...baseCapabilities,
          direction: edgeDirection,
          heightDelta: 1
        })
      });
    }
  }
  return records;
}

function routeTopologyForCell(cell, routeCellKeys) {
  const neighbors = [
    ['n', 0, -1],
    ['e', 1, 0],
    ['s', 0, 1],
    ['w', -1, 0]
  ].filter(([, dx, dy]) =>
    routeCellKeys.has(`${cell.x + dx},${cell.y + dy}`)
  ).map(([value]) => value);
  const mask = neighbors.join('');
  return ({
    '': 'isolated',
    n: 'end-n',
    e: 'end-e',
    s: 'end-s',
    w: 'end-w',
    ns: 'straight-ns',
    ew: 'straight-ew',
    ne: 'corner-ne',
    es: 'corner-es',
    sw: 'corner-sw',
    nw: 'corner-wn',
    nes: 'tee-nes',
    esw: 'tee-esw',
    nsw: 'tee-nsw',
    new: 'tee-wne',
    nesw: 'cross'
  })[mask] ?? fail(`unsupported route neighbor mask ${mask}`);
}

function compileRouteVisualAssets(
  route,
  resolveAsset,
  baseCapabilities
) {
  const routeCellKeys = new Set(
    route.cells.map(cell => `${cell.x},${cell.y}`)
  );
  const groups = new Map();
  for (const cell of route.cells) {
    const topology = routeTopologyForCell(cell, routeCellKeys);
    const asset = resolveAsset('route', route.assetFamily, {
      ...baseCapabilities,
      routeTopology: topology
    });
    const key = `${topology}:${asset.key}`;
    const group = groups.get(key) ?? {
      role: topology,
      cells: [],
      asset
    };
    group.cells.push(cell);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function compileFeatures(blueprint) {
  return [
    ...blueprint.regions.map(region => ({
      id: region.id,
      kind: region.kind,
      cells: region.cells,
      ownerFeatureId: null,
      annotations: region.annotations
    })),
    ...blueprint.features
  ];
}

function assertRequiredSidecarRelationships(candidate, sourceSidecar) {
  const regions = new Map(candidate.features.map(feature => [feature.id, feature]));
  const view = createBattleMapV3TraversalView(candidate, {
    movementPolicy: { ignoreUnits: true }
  });
  for (const relationship of sourceSidecar.topologyIntent.relationships) {
    if (relationship.required !== true) continue;
    const from = regions.get(relationship.from);
    const to = regions.get(relationship.to);
    const connected = from.cells.some(start =>
      candidate.playableMask[start.y]?.[start.x] === true
      && candidate.terrain[start.y]?.[start.x]?.passable === true
      && to.cells.some(goal =>
        candidate.playableMask[goal.y]?.[goal.x] === true
        && candidate.terrain[goal.y]?.[goal.x]?.passable === true
        && Number.isFinite(calculateTraversalPathCost(view, { start, goal }))
      )
    );
    if (!connected) {
      fail(
        `required sidecar topology relationship ${relationship.from}->`
        + `${relationship.to} is not traversably connected`,
        'INVALID_BATTLE_MAP_V3_TOPOLOGY'
      );
    }
  }
}

function blueprintAssetFamilies(blueprint) {
  return new Set([
    ...blueprint.surfaceGrid.flat()
      .filter(Boolean)
      .map(cell => `surface:${cell.material}`),
    ...blueprint.connections.map(record => `connection:${record.assetFamily}`),
    ...blueprint.obstacles.map(record => `obstacle:${record.assetFamily}`),
    ...blueprint.decorations.map(record => `decoration:${record.assetFamily}`),
    ...blueprint.boundaries.map(record => `boundary:${record.assetFamily}`),
    ...blueprint.routes.map(record => `route:${record.assetFamily}`)
  ]);
}

function verifyExpectedAssets(blueprint, usedFamilies) {
  const expected = new Set(
    blueprint.expectedAssetFamilies.map(record => `${record.category}:${record.symbol}`)
  );
  const missingDeclarations = [...usedFamilies].filter(key => !expected.has(key)).sort();
  const unreferenced = [...expected].filter(key => !usedFamilies.has(key)).sort();
  if (missingDeclarations.length > 0 || unreferenced.length > 0) {
    const details = [
      missingDeclarations.length ? `undeclared used families: ${missingDeclarations.join(', ')}` : null,
      unreferenced.length ? `unreferenced expected families: ${unreferenced.join(', ')}` : null
    ].filter(Boolean).join('; ');
    fail(`blueprint asset-family closure failed (${details})`, 'INVALID_BATTLE_MAP_V3_ASSET_CLOSURE');
  }
}

export async function computeTemplateMapTileCatalogFullHash(tileCatalog) {
  return hashCanonicalV3Value(TEMPLATE_MAP_TILE_CATALOG_HASH_DOMAIN, {
    id: tileCatalog.id,
    version: tileCatalog.version,
    renderProfileId: tileCatalog.renderProfileId,
    materials: tileCatalog.materials
  });
}

export async function computeTemplateMapAssetBundleManifestFullHash(assetBundle) {
  return hashCanonicalV3Value(TEMPLATE_MAP_ASSET_BUNDLE_HASH_DOMAIN, {
    id: assetBundle.id,
    version: assetBundle.version,
    assets: assetBundle.assets,
    rendererManifestFullHash: assetBundle.rendererManifestFullHash
  });
}

export async function computeTemplateMapSourceSidecarFullHash(sourceSidecar) {
  return hashCanonicalV3Value(TEMPLATE_MAP_SOURCE_SIDECAR_HASH_DOMAIN, sourceSidecar);
}

/**
 * Deterministically compile one reviewed symbolic blueprint into an unhashed
 * BattleMap V3 candidate. The returned value is deeply frozen.
 */
export async function compileTemplateMapBlueprint(blueprintInput, contextInput) {
  assertTemplateMapBlueprint(blueprintInput);
  const blueprint = deepCloneJsonValue(blueprintInput);
  const context = deepCloneJsonValue(contextInput);
  validateCompilerContext(context, blueprint);
  const blueprintFullHash = await computeTemplateMapBlueprintFullHash(blueprint);
  if (context.provenance.approvedBlueprint.fullHash !== blueprintFullHash) {
    fail(
      'approvedBlueprint.fullHash does not match the exact symbolic blueprint bytes',
      'TEMPLATE_MAP_BLUEPRINT_HASH_MISMATCH'
    );
  }
  // One approved source template intentionally owns three approved blueprint
  // variants. The sidecar therefore pins the immutable approval-index hash,
  // while provenance.approvedBlueprint pins the exact variant compiled here.
  // The offline lifecycle verifies index membership before invoking the
  // compiler; accepting only one blueprint hash in this field would require
  // mutating the approved sidecar between variants.
  if (!SHA256_PATTERN.test(
    context.sourceSidecar.pins?.approvedBlueprintSha256 ?? ''
  )) {
    fail('sourceSidecar pins must include an approved-blueprint index hash');
  }
  if (context.sourceSidecar.pins?.compilerSha256
    !== context.provenance.compiler.fullHash) {
    fail('sourceSidecar pins must approve the exact compiler hash');
  }

  const materials = createMaterialIndex(context.tileCatalog);
  const elevationFaceSymbols = context.renderProfile.elevationFaceSymbols;
  for (const materialSymbol of Object.keys(elevationFaceSymbols)) {
    if (!materials.has(materialSymbol)) {
      fail(
        `render profile elevation-face material ${materialSymbol} is absent from the tile catalog`
      );
    }
  }
  for (const materialSymbol of materials.keys()) {
    if (!own(elevationFaceSymbols, materialSymbol)) {
      fail(
        `render profile lacks an elevation-face symbol for tile material ${materialSymbol}`,
        'MISSING_BATTLE_MAP_V3_ASSET'
      );
    }
  }
  const usedFamilies = new Set();
  const requiredFamilies = blueprintAssetFamilies(blueprint);
  for (const faceSymbol of new Set(Object.values(elevationFaceSymbols))) {
    requiredFamilies.add(`boundary:${faceSymbol}`);
  }
  verifyExpectedAssets(blueprint, requiredFamilies);
  const resolveAsset = createBindingResolver(
    context.renderProfile,
    context.assetBundle,
    usedFamilies,
    requiredFamilies
  );
  const baseCapabilities = commonCapabilities(
    context.renderProfile,
    context.identity
  );
  const directionalAssets =
    context.renderProfile.schemaVersion === 'battle-map-render-profile-v2';
  const [tileCatalogFullHash, assetBundleManifestFullHash] = await Promise.all([
    computeTemplateMapTileCatalogFullHash(context.tileCatalog),
    computeTemplateMapAssetBundleManifestFullHash(context.assetBundle)
  ]);
  const sourceSidecarFullHash =
    await computeTemplateMapSourceSidecarFullHash(context.sourceSidecar);
  if (context.provenance.sourceSidecar.fullHash !== sourceSidecarFullHash) {
    fail(
      'sourceSidecar.fullHash does not match the exact approved sidecar bytes',
      'TEMPLATE_MAP_SOURCE_SIDECAR_HASH_MISMATCH'
    );
  }
  if (context.tileCatalog.fullHash !== tileCatalogFullHash) {
    fail(
      'tileCatalog.fullHash does not match the exact compiler material records',
      'TEMPLATE_MAP_TILE_CATALOG_HASH_MISMATCH'
    );
  }
  if (context.assetBundle.manifestFullHash !== assetBundleManifestFullHash) {
    fail(
      'assetBundle.manifestFullHash does not match the exact compiler asset records',
      'TEMPLATE_MAP_ASSET_BUNDLE_HASH_MISMATCH'
    );
  }
  const { width, height } = blueprint.dimensions;
  const terrain = [];
  const visualCells = [];
  for (let y = 0; y < height; y += 1) {
    const terrainRow = [];
    const visualRow = [];
    for (let x = 0; x < width; x += 1) {
      const symbolic = blueprint.surfaceGrid[y][x];
      if (symbolic === null) {
        terrainRow.push(null);
        visualRow.push(null);
        continue;
      }
      const material = materials.get(symbolic.material);
      if (!material) {
        fail(`surfaceGrid[${y}][${x}] references missing tile material ${symbolic.material}`);
      }
      if (blueprint.playableMask[y][x] && !material.passable) {
        fail(`playable surfaceGrid[${y}][${x}] resolves to impassable material ${symbolic.material}`);
      }
      terrainRow.push({
        material: material.material,
        passable: material.passable,
        movementCost: material.movementCost,
        featureId: symbolic.featureId
      });
      visualRow.push({
        surface: resolveAsset('surface', symbolic.material, directionalAssets
          ? {
            ...baseCapabilities,
            surfaceVariant: deterministicSurfaceVariant(
              x,
              y,
              context.identity,
              context.renderProfile.surfaceVariantCount
            )
          }
          : baseCapabilities),
        overlays: []
      });
    }
    terrain.push(terrainRow);
    visualCells.push(visualRow);
  }

  const elevationConnections = blueprint.connections.map(record => {
    const heightDelta = blueprint.elevation[record.to.y][record.to.x]
      - blueprint.elevation[record.from.y][record.from.x];
    return {
      id: record.id,
      from: record.from,
      to: record.to,
      direction: direction(record.from, record.to),
      kind: record.kind,
      heightDelta,
      traversable: record.traversable,
      bidirectional: record.bidirectional,
      featureId: record.featureId,
      asset: (
        record.kind === 'stairs'
        || (record.kind === 'slope' && directionalAssets)
      )
        ? resolveAsset('connection', record.assetFamily, {
          ...baseCapabilities,
          direction: lowToHighDirection(record, heightDelta),
          heightDelta: Math.abs(heightDelta)
        })
        : null
    };
  });
  const obstacles = blueprint.obstacles.map(record => ({
    id: record.id,
    kind: record.kind,
    cells: record.cells,
    blocking: true,
    movementCost: 0,
    featureId: record.featureId,
    anchor: record.anchor,
    occlusionBounds: record.occlusionBounds,
    asset: resolveAsset('obstacle', record.assetFamily, baseCapabilities)
  }));
  const decorations = blueprint.decorations.map(record => ({
    id: record.id,
    kind: record.kind,
    cell: record.cell,
    featureId: record.featureId,
    anchor: record.anchor,
    asset: resolveAsset('decoration', record.assetFamily, baseCapabilities)
  }));
  const authoredBoundaries = compileAuthoredBoundaries(
    blueprint,
    resolveAsset,
    baseCapabilities,
    directionalAssets
  );
  const boundaries = [
    ...authoredBoundaries,
    ...compileElevationFaces(blueprint, {
      elevationFaceSymbols,
      resolveAsset,
      authoredBoundaryIds: new Set(authoredBoundaries.map(record => record.id)),
      baseCapabilities,
      directionalAssets
    })
  ];
  const routes = blueprint.routes.map(record => {
    const material = materials.get(record.material);
    if (!material) fail(`route ${record.id} references missing tile material ${record.material}`);
    if (!material.passable) fail(`route ${record.id} resolves to impassable material ${record.material}`);
    return {
      id: record.id,
      kind: record.kind,
      material: material.material,
      cells: record.cells,
      required: record.required,
      width: record.width,
      featureId: record.featureId,
      visualAssets: directionalAssets
        ? compileRouteVisualAssets(
          record,
          resolveAsset,
          baseCapabilities
        )
        : [{
          role: 'center',
          cells: record.cells,
          asset: resolveAsset('route', record.assetFamily, baseCapabilities)
        }]
    };
  });

  const candidate = {
    battleMapSchemaVersion: BATTLE_MAP_V3_SCHEMA_VERSION,
    terrainGenerationVersion: BATTLE_MAP_V3_TERRAIN_GENERATION_VERSION,
    contentId: context.identity.contentId,
    contentVersion: context.identity.contentVersion,
    templateId: blueprint.templateId,
    templateRevision: context.identity.templateRevision,
    theme: context.identity.theme,
    renderProfileId: context.renderProfile.id,
    tierEligibility: context.identity.tierEligibility,
    supportedModes: context.identity.supportedModes,
    dimensions: blueprint.dimensions,
    provenance: {
      sourceSidecar: context.provenance.sourceSidecar,
      approvedBlueprint: context.provenance.approvedBlueprint,
      assetBundle: {
        id: context.assetBundle.id,
        version: context.assetBundle.version,
        manifestFullHash: context.assetBundle.manifestFullHash
      },
      tileCatalog: {
        id: context.tileCatalog.id,
        version: context.tileCatalog.version,
        fullHash: context.tileCatalog.fullHash
      },
      compiler: context.provenance.compiler,
      validator: context.provenance.validator
    },
    renderMask: blueprint.renderMask,
    playableMask: blueprint.playableMask,
    terrain,
    elevation: blueprint.elevation,
    elevationConnections,
    visualCells,
    obstacles,
    decorations,
    boundaries,
    routes,
    features: compileFeatures(blueprint),
    spawnContract: blueprint.spawn,
    hashVersion: BATTLE_MAP_V3_HASH_VERSION
  };
  if (context.renderProfile.schemaVersion === 'battle-map-render-profile-v2') {
    candidate.ecologyProfile = context.renderProfile.ecologyProfile;
    candidate.scene = context.renderProfile.scene;
  }

  verifyExpectedAssets(blueprint, usedFamilies);
  assertBattleMapV3Candidate(candidate);
  assertRequiredSidecarRelationships(candidate, context.sourceSidecar);
  assertBattleMapV3Topology(candidate);
  return deepFreeze(candidate);
}
