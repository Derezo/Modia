import {
  canonicalizeJson,
  canonicalJsonBytes,
  deepCloneJsonValue,
  deepFreeze
} from '../canonicalJson.js';
import {
  assertBattleMapV3Candidate,
  assertBattleMapV3Final
} from './schema.js';

export const BATTLE_MAP_V3_PROJECTION_SCHEMAS = Object.freeze({
  authoritative: 'battle-map-v3-authoritative/projection-v1',
  visual: 'battle-map-v3-visual/projection-v1',
  full: 'battle-map-v3-full/projection-v1'
});

export const BATTLE_MAP_V3_HASH_DOMAINS = Object.freeze({
  authoritativeHash: 'modia:battle-map-v3:authoritative:v1',
  visualHash: 'modia:battle-map-v3:visual:v1',
  fullHash: 'modia:battle-map-v3:full:v1'
});

const verifiedFrozenFinalMaps = new WeakSet();

function identity(candidate) {
  const value = {
    battleMapSchemaVersion: candidate.battleMapSchemaVersion,
    terrainGenerationVersion: candidate.terrainGenerationVersion,
    contentId: candidate.contentId,
    contentVersion: candidate.contentVersion,
    templateId: candidate.templateId,
    templateRevision: candidate.templateRevision,
    theme: candidate.theme,
    renderProfileId: candidate.renderProfileId,
    tierEligibility: candidate.tierEligibility,
    supportedModes: candidate.supportedModes,
    dimensions: candidate.dimensions,
    hashVersion: candidate.hashVersion
  };
  if (Object.hasOwn(candidate, 'ecologyProfile')) {
    value.ecologyProfile = candidate.ecologyProfile;
  }
  return value;
}

function authoritativeConnection(record) {
  const { asset: _asset, ...authoritative } = record;
  return authoritative;
}

function authoritativeObstacle(record) {
  const {
    asset: _asset,
    anchor: _anchor,
    occlusionBounds: _occlusionBounds,
    ...authoritative
  } = record;
  return authoritative;
}

function authoritativeRoute(record) {
  const { visualAssets: _visualAssets, ...authoritative } = record;
  return authoritative;
}

export function createBattleMapV3AuthoritativeProjection(candidate) {
  assertBattleMapV3Candidate(candidate);
  return {
    projectionSchema: BATTLE_MAP_V3_PROJECTION_SCHEMAS.authoritative,
    identity: identity(candidate),
    provenance: {
      sourceSidecar: candidate.provenance.sourceSidecar,
      approvedBlueprint: candidate.provenance.approvedBlueprint,
      compiler: candidate.provenance.compiler,
      validator: candidate.provenance.validator
    },
    renderMask: candidate.renderMask,
    playableMask: candidate.playableMask,
    terrain: candidate.terrain,
    elevation: candidate.elevation,
    elevationConnections: candidate.elevationConnections.map(authoritativeConnection),
    obstacles: candidate.obstacles.map(authoritativeObstacle),
    routes: candidate.routes.map(authoritativeRoute),
    features: candidate.features,
    spawnContract: candidate.spawnContract
  };
}

export function createBattleMapV3VisualProjection(candidate) {
  assertBattleMapV3Candidate(candidate);
  const projection = {
    projectionSchema: BATTLE_MAP_V3_PROJECTION_SCHEMAS.visual,
    identity: identity(candidate),
    assetPins: {
      assetBundle: candidate.provenance.assetBundle,
      tileCatalog: candidate.provenance.tileCatalog
    },
    renderMask: candidate.renderMask,
    visualCells: candidate.visualCells,
    elevationConnections: candidate.elevationConnections.map(record => ({
      id: record.id,
      from: record.from,
      to: record.to,
      direction: record.direction,
      kind: record.kind,
      asset: record.asset
    })),
    obstacles: candidate.obstacles.map(record => ({
      id: record.id,
      anchor: record.anchor,
      occlusionBounds: record.occlusionBounds,
      asset: record.asset
    })),
    decorations: candidate.decorations,
    boundaries: candidate.boundaries,
    routes: candidate.routes.map(record => ({
      id: record.id,
      kind: record.kind,
      cells: record.cells,
      width: record.width,
      visualAssets: record.visualAssets
    }))
  };
  if (Object.hasOwn(candidate, 'scene')) projection.scene = candidate.scene;
  return projection;
}

export function createBattleMapV3FullProjection(candidate) {
  assertBattleMapV3Candidate(candidate);
  return {
    projectionSchema: BATTLE_MAP_V3_PROJECTION_SCHEMAS.full,
    map: candidate
  };
}

export function createBattleMapV3Projections(candidate) {
  return {
    authoritative: createBattleMapV3AuthoritativeProjection(candidate),
    visual: createBattleMapV3VisualProjection(candidate),
    full: createBattleMapV3FullProjection(candidate)
  };
}

function subtleCrypto() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto SHA-256 is required to hash BattleMapV3 values');
  return subtle;
}

export async function hashCanonicalV3Value(domain, value) {
  const encoder = new TextEncoder();
  const domainBytes = encoder.encode(domain);
  const valueBytes = canonicalJsonBytes(value);
  const input = new Uint8Array(domainBytes.length + 1 + valueBytes.length);
  input.set(domainBytes);
  input[domainBytes.length] = 0;
  input.set(valueBytes, domainBytes.length + 1);
  const digest = new Uint8Array(await subtleCrypto().digest('SHA-256', input));
  let hexadecimal = '';
  for (const byte of digest) hexadecimal += byte.toString(16).padStart(2, '0');
  return `sha256:${hexadecimal}`;
}

export async function computeBattleMapV3Hashes(candidate) {
  const projections = createBattleMapV3Projections(candidate);
  const [authoritativeHash, visualHash, fullHash] = await Promise.all([
    hashCanonicalV3Value(BATTLE_MAP_V3_HASH_DOMAINS.authoritativeHash, projections.authoritative),
    hashCanonicalV3Value(BATTLE_MAP_V3_HASH_DOMAINS.visualHash, projections.visual),
    hashCanonicalV3Value(BATTLE_MAP_V3_HASH_DOMAINS.fullHash, projections.full)
  ]);
  return { authoritativeHash, visualHash, fullHash };
}

function candidateFromFinal(finalMap) {
  const { hashes: _hashes, ...candidate } = finalMap;
  return candidate;
}

function hashesEqual(left, right) {
  return left.authoritativeHash === right.authoritativeHash
    && left.visualHash === right.visualHash
    && left.fullHash === right.fullHash;
}

export async function finalizeBattleMapV3(candidate) {
  assertBattleMapV3Candidate(candidate);
  const clone = deepCloneJsonValue(candidate);
  clone.hashes = await computeBattleMapV3Hashes(clone);
  assertBattleMapV3Final(clone);
  const recomputed = await computeBattleMapV3Hashes(candidateFromFinal(clone));
  if (!hashesEqual(clone.hashes, recomputed)) {
    throw new Error('BattleMapV3 hash verification failed during finalization');
  }
  const finalMap = deepFreeze(clone);
  verifiedFrozenFinalMaps.add(finalMap);
  return finalMap;
}

export async function verifyBattleMapV3Final(finalMap) {
  if (verifiedFrozenFinalMaps.has(finalMap)) return true;
  const snapshot = deepCloneJsonValue(finalMap);
  assertBattleMapV3Final(snapshot);
  const candidate = candidateFromFinal(snapshot);
  assertBattleMapV3Candidate(candidate);
  if (!hashesEqual(snapshot.hashes, await computeBattleMapV3Hashes(candidate))) return false;
  try {
    return canonicalizeJson(snapshot) === canonicalizeJson(deepCloneJsonValue(finalMap));
  } catch {
    return false;
  }
}

export async function assertVerifiedBattleMapV3Final(finalMap) {
  if (!await verifyBattleMapV3Final(finalMap)) {
    const error = new Error('BattleMapV3 hash verification failed');
    error.code = 'BATTLE_MAP_V3_HASH_MISMATCH';
    throw error;
  }
  return finalMap;
}

export async function normalizeBattleMapV3Final(finalMap) {
  if (verifiedFrozenFinalMaps.has(finalMap)) return finalMap;
  const clone = deepCloneJsonValue(finalMap);
  await assertVerifiedBattleMapV3Final(clone);
  const frozen = deepFreeze(clone);
  verifiedFrozenFinalMaps.add(frozen);
  return frozen;
}

export async function loadAndFreezeBattleMapV3Final(finalMap) {
  return normalizeBattleMapV3Final(finalMap);
}
