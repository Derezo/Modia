import {
  assertBattleMapV2Candidate,
  assertBattleMapV2Final,
  BATTLE_MAP_HASH_VERSION,
  ELEVATION_FORMAT,
  TRANSITION_ANCHORS,
  TRANSITION_KINDS
} from './schema.js';
import {
  canonicalizeJson,
  canonicalJsonBytes,
  deepCloneJsonValue,
  deepFreeze
} from './canonicalJson.js';

export const AUTHORITATIVE_PROJECTION_SCHEMA = 'battle-map-authoritative-v2/projection-v1';
export const VISUAL_PROJECTION_SCHEMA = 'battle-map-visual-v2/projection-v1';
export const FULL_PROJECTION_SCHEMA = 'battle-map-full-v2/projection-v1';

export const BATTLE_MAP_HASH_DOMAINS = Object.freeze({
  authoritativeHash: 'battle-map-authoritative-v2',
  visualHash: 'battle-map-visual-v2',
  fullHash: 'battle-map-full-v2'
});

const verifiedFrozenFinalMaps = new WeakSet();

function exactObject(value, path, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  const actual = Object.keys(value);
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new TypeError(`${path}.${key} is required`);
  }
  for (const key of actual) {
    if (!keys.includes(key)) throw new TypeError(`${path}.${key} is not allowed`);
  }
}

export function createBattleMapAuthoritativeProjection(candidate) {
  assertBattleMapV2Candidate(candidate);
  const diagnostics = candidate.diagnostics;
  return {
    projectionSchema: AUTHORITATIVE_PROJECTION_SCHEMA,
    battleMapSchemaVersion: candidate.battleMapSchemaVersion,
    terrainGenerationVersion: candidate.terrainGenerationVersion,
    terrainSeed: candidate.terrainSeed,
    mapWidth: candidate.mapWidth,
    mapHeight: candidate.mapHeight,
    nodeType: candidate.nodeType,
    biome: candidate.biome,
    archetype: candidate.archetype,
    generation: {
      resolvedRecipe: diagnostics.resolvedRecipe,
      attempt: diagnostics.attempt,
      streamVersion: diagnostics.streamVersion,
      algorithms: diagnostics.algorithms
    },
    terrain: candidate.terrain,
    elevation: candidate.elevation,
    elevationConnections: candidate.elevationConnections,
    obstacles: candidate.obstacles,
    spawnLayout: candidate.spawnLayout,
    features: candidate.features
  };
}

export function createBattleMapVisualProjection(candidate) {
  assertBattleMapV2Candidate(candidate);
  return {
    projectionSchema: VISUAL_PROJECTION_SCHEMA,
    battleMapSchemaVersion: candidate.battleMapSchemaVersion,
    mapWidth: candidate.mapWidth,
    mapHeight: candidate.mapHeight,
    variants: candidate.variants,
    transitions: candidate.transitions,
    decorations: candidate.decorations
  };
}

export function createBattleMapFullProjection(candidate) {
  assertBattleMapV2Candidate(candidate);
  return {
    projectionSchema: FULL_PROJECTION_SCHEMA,
    map: candidate
  };
}

export function assertBattleMapAuthoritativeProjection(value) {
  exactObject(value, 'BattleMapAuthoritativeProjectionV1', [
    'projectionSchema', 'battleMapSchemaVersion', 'terrainGenerationVersion',
    'terrainSeed', 'mapWidth', 'mapHeight', 'nodeType', 'biome', 'archetype',
    'generation', 'terrain', 'elevation', 'elevationConnections', 'obstacles',
    'spawnLayout', 'features'
  ]);
  if (value.projectionSchema !== AUTHORITATIVE_PROJECTION_SCHEMA) {
    throw new TypeError(`projectionSchema must equal ${AUTHORITATIVE_PROJECTION_SCHEMA}`);
  }
  exactObject(value.generation, 'BattleMapAuthoritativeProjectionV1.generation', [
    'resolvedRecipe', 'attempt', 'streamVersion', 'algorithms'
  ]);
  // Reuse the complete candidate validator with closed neutral fields for data
  // deliberately excluded from this projection.
  assertBattleMapV2Candidate({
    battleMapSchemaVersion: value.battleMapSchemaVersion,
    terrainGenerationVersion: value.terrainGenerationVersion,
    terrainSeed: value.terrainSeed,
    mapWidth: value.mapWidth,
    mapHeight: value.mapHeight,
    nodeType: value.nodeType,
    biome: value.biome,
    archetype: value.archetype,
    elevationFormat: ELEVATION_FORMAT,
    terrain: value.terrain,
    elevation: value.elevation,
    elevationConnections: value.elevationConnections,
    obstacles: value.obstacles,
    spawnLayout: value.spawnLayout,
    variants: [],
    transitions: [],
    decorations: [],
    features: value.features,
    diagnostics: {
      resolvedRecipe: value.generation.resolvedRecipe,
      attempt: value.generation.attempt,
      streamVersion: value.generation.streamVersion,
      hashVersion: BATTLE_MAP_HASH_VERSION,
      algorithms: value.generation.algorithms,
      hardValidation: { valid: true, checks: [] },
      tacticalValidation: { passed: true, checks: [] },
      qualityMetrics: { score: 0, metrics: [] }
    }
  });
  return value;
}

export function assertBattleMapVisualProjection(value) {
  exactObject(value, 'BattleMapVisualProjectionV1', [
    'projectionSchema', 'battleMapSchemaVersion', 'mapWidth', 'mapHeight',
    'variants', 'transitions', 'decorations'
  ]);
  if (value.projectionSchema !== VISUAL_PROJECTION_SCHEMA) {
    throw new TypeError(`projectionSchema must equal ${VISUAL_PROJECTION_SCHEMA}`);
  }
  if (value.battleMapSchemaVersion !== 2) throw new TypeError('battleMapSchemaVersion must equal 2');
  if (!Number.isSafeInteger(value.mapWidth) || value.mapWidth < 1) throw new TypeError('mapWidth must be a positive safe integer');
  if (!Number.isSafeInteger(value.mapHeight) || value.mapHeight < 1) throw new TypeError('mapHeight must be a positive safe integer');
  if (!Array.isArray(value.variants) || !Array.isArray(value.transitions) || !Array.isArray(value.decorations)) {
    throw new TypeError('Visual projection layers must be arrays');
  }
  const inBounds = (record, path) => {
    if (!Number.isSafeInteger(record.x) || record.x < 0 || record.x >= value.mapWidth
      || !Number.isSafeInteger(record.y) || record.y < 0 || record.y >= value.mapHeight) {
      throw new TypeError(`${path} coordinate is out of bounds`);
    }
  };
  const nonEmpty = item => typeof item === 'string' && item.length > 0;
  const idsByLayer = {
    variants: new Set(),
    transitions: new Set(),
    decorations: new Set()
  };
  const stableId = (id, path, ids) => {
    if (!nonEmpty(id) || ids.has(id)) throw new TypeError(`${path}.id must be a unique non-empty string`);
    ids.add(id);
  };
  value.variants.forEach((record, index) => {
    const path = `BattleMapVisualProjectionV1.variants[${index}]`;
    exactObject(record, path, ['id', 'x', 'y', 'material', 'variantIndex', 'featureId']);
    inBounds(record, path);
    stableId(record.id, path, idsByLayer.variants);
    if (!nonEmpty(record.material)
      || !Number.isSafeInteger(record.variantIndex) || record.variantIndex < 0
      || (record.featureId !== null && !nonEmpty(record.featureId))) {
      throw new TypeError(`${path} has invalid fields`);
    }
  });
  value.transitions.forEach((record, index) => {
    const path = `BattleMapVisualProjectionV1.transitions[${index}]`;
    exactObject(record, path, ['id', 'x', 'y', 'kind', 'directionMask', 'assetKey', 'anchor', 'stratum', 'precedence', 'featureId']);
    inBounds(record, path);
    stableId(record.id, path, idsByLayer.transitions);
    if (!nonEmpty(record.assetKey)
      || !TRANSITION_KINDS.includes(record.kind) || !TRANSITION_ANCHORS.includes(record.anchor)
      || !Number.isSafeInteger(record.directionMask) || record.directionMask < 0 || record.directionMask > 15
      || !Number.isSafeInteger(record.stratum) || !Number.isSafeInteger(record.precedence)
      || (record.featureId !== null && !nonEmpty(record.featureId))) {
      throw new TypeError(`${path} has invalid fields`);
    }
  });
  value.decorations.forEach((record, index) => {
    const path = `BattleMapVisualProjectionV1.decorations[${index}]`;
    exactObject(record, path, ['id', 'x', 'y', 'kind', 'assetKey', 'variantIndex', 'anchor', 'featureId']);
    inBounds(record, path);
    stableId(record.id, path, idsByLayer.decorations);
    if (!nonEmpty(record.kind) || !nonEmpty(record.assetKey)
      || !Number.isSafeInteger(record.variantIndex) || record.variantIndex < 0
      || !TRANSITION_ANCHORS.includes(record.anchor)
      || (record.featureId !== null && !nonEmpty(record.featureId))) {
      throw new TypeError(`${path} has invalid fields`);
    }
  });
  canonicalizeJson(value);
  return value;
}

export function assertBattleMapFullProjection(value) {
  exactObject(value, 'BattleMapFullProjectionV1', ['projectionSchema', 'map']);
  if (value.projectionSchema !== FULL_PROJECTION_SCHEMA) {
    throw new TypeError(`projectionSchema must equal ${FULL_PROJECTION_SCHEMA}`);
  }
  assertBattleMapV2Candidate(value.map);
  return value;
}

function candidateFromFinal(finalMap) {
  const { hashes: _hashes, ...candidateDiagnostics } = finalMap.diagnostics;
  return {
    ...finalMap,
    diagnostics: candidateDiagnostics
  };
}

function subtleCrypto() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto SHA-256 is required to hash BattleMapV2 values');
  }
  return subtle;
}

async function hashProjection(domain, projection) {
  const domainBytes = new TextEncoder().encode(domain);
  const projectionBytes = canonicalJsonBytes(projection);
  const input = new Uint8Array(domainBytes.length + 1 + projectionBytes.length);
  input.set(domainBytes);
  input[domainBytes.length] = 0;
  input.set(projectionBytes, domainBytes.length + 1);
  const digest = new Uint8Array(await subtleCrypto().digest('SHA-256', input));
  let hexadecimal = '';
  for (const byte of digest) hexadecimal += byte.toString(16).padStart(2, '0');
  return `sha256:${hexadecimal}`;
}

export function createBattleMapProjections(candidate) {
  return {
    authoritative: createBattleMapAuthoritativeProjection(candidate),
    visual: createBattleMapVisualProjection(candidate),
    full: createBattleMapFullProjection(candidate)
  };
}

export function createBattleMapCanonicalVectors(candidate) {
  const projections = createBattleMapProjections(candidate);
  const canonicalJson = {
    authoritative: canonicalizeJson(projections.authoritative),
    visual: canonicalizeJson(projections.visual),
    full: canonicalizeJson(projections.full)
  };
  return {
    projections,
    canonicalJson,
    canonicalUtf8Bytes: {
      authoritative: Array.from(new TextEncoder().encode(canonicalJson.authoritative)),
      visual: Array.from(new TextEncoder().encode(canonicalJson.visual)),
      full: Array.from(new TextEncoder().encode(canonicalJson.full))
    }
  };
}

export async function computeBattleMapHashes(candidate) {
  const projections = createBattleMapProjections(candidate);
  const [authoritativeHash, visualHash, fullHash] = await Promise.all([
    hashProjection(BATTLE_MAP_HASH_DOMAINS.authoritativeHash, projections.authoritative),
    hashProjection(BATTLE_MAP_HASH_DOMAINS.visualHash, projections.visual),
    hashProjection(BATTLE_MAP_HASH_DOMAINS.fullHash, projections.full)
  ]);
  return { authoritativeHash, visualHash, fullHash };
}

/**
 * Candidate-to-final transition. The input candidate is never mutated. Hash
 * attachment is the only structural change made to the validated clone.
 */
export async function finalizeBattleMapV2(candidate) {
  assertBattleMapV2Candidate(candidate);
  if (candidate.diagnostics.hardValidation.valid !== true) {
    throw new TypeError('Cannot finalize a BattleMapV2 candidate that failed hard validation');
  }
  const candidateClone = deepCloneJsonValue(candidate);
  const hashes = await computeBattleMapHashes(candidateClone);
  candidateClone.diagnostics.hashes = hashes;
  assertBattleMapV2Final(candidateClone);
  const independentlyComputed = await computeBattleMapHashes(candidateFromFinal(candidateClone));
  if (!hashesEqual(hashes, independentlyComputed)) {
    throw new Error('BattleMapV2 hash verification failed during finalization');
  }
  const finalMap = deepFreeze(candidateClone);
  verifiedFrozenFinalMaps.add(finalMap);
  return finalMap;
}

function hashesEqual(left, right) {
  return left.authoritativeHash === right.authoritativeHash
    && left.visualHash === right.visualHash
    && left.fullHash === right.fullHash;
}

export async function verifyBattleMapV2Final(finalMap) {
  if (verifiedFrozenFinalMaps.has(finalMap)) return true;
  assertBattleMapV2Final(finalMap);
  const candidate = candidateFromFinal(finalMap);
  assertBattleMapV2Candidate(candidate);
  const computed = await computeBattleMapHashes(candidate);
  return hashesEqual(finalMap.diagnostics.hashes, computed);
}

export async function assertVerifiedBattleMapV2Final(finalMap) {
  if (!await verifyBattleMapV2Final(finalMap)) {
    const error = new Error('BattleMapV2 hash verification failed');
    error.code = 'BATTLE_MAP_HASH_MISMATCH';
    throw error;
  }
  return finalMap;
}

/**
 * Returns a trusted immutable snapshot of a final map. Only identities created
 * by finalization or this normalizer may take the fast path. Every other input
 * is cloned before the first await so verification and later serialization
 * cannot observe different values from an accessor-backed source object.
 */
export async function normalizeBattleMapV2Final(finalMap) {
  if (verifiedFrozenFinalMaps.has(finalMap)) return finalMap;
  const clone = deepCloneJsonValue(finalMap);
  await assertVerifiedBattleMapV2Final(clone);
  const frozenClone = deepFreeze(clone);
  verifiedFrozenFinalMaps.add(frozenClone);
  return frozenClone;
}

/**
 * Final wire/persistence gate. Canonical inputs retain their exact identity;
 * untrusted inputs become a verified, recursively frozen canonical snapshot.
 */
export async function loadAndFreezeBattleMapV2Final(finalMap) {
  return normalizeBattleMapV2Final(finalMap);
}
