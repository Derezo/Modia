import {
  BATTLE_MAP_HASH_VERSION,
  BATTLE_MAP_SCHEMA_VERSION,
  BATTLE_MAP_V3_HASH_VERSION,
  BATTLE_MAP_V3_SCHEMA_VERSION,
  loadAndFreezeBattleMapV2Final,
  loadAndFreezeBattleMapV3Final,
  resolveBattleMapVersionDescriptor
} from '../../../shared/battleMap/index.js';
import {
  BATTLE_MUTABLE_STATE_PROTOCOL_VERSION,
  applyBattleMutableStateUpdateV1,
  assertBattleStateSnapshotV1,
  createBattleMapCapabilities
} from '../../../shared/battleStateProtocol.js';
import { isBattleMapV3RuntimeReady } from './BattleMapAssets.js';

const verifiedMapCache = new Map();
export const MAX_VERIFIED_BATTLE_MAP_CACHE_ENTRIES = 32;

function mapCacheKey({ battleMapSchemaVersion, terrainGenerationVersion, fullHash }) {
  return `${battleMapSchemaVersion}:${terrainGenerationVersion}:${fullHash}`;
}

function getCachedMap(reference) {
  const key = mapCacheKey(reference);
  const map = verifiedMapCache.get(key);
  if (!map) return null;

  // Refresh insertion order so eviction is deterministic least-recently-used.
  verifiedMapCache.delete(key);
  verifiedMapCache.set(key, map);
  return map;
}

function cacheVerifiedMap(reference, map) {
  const key = mapCacheKey(reference);
  verifiedMapCache.delete(key);
  verifiedMapCache.set(key, map);

  while (verifiedMapCache.size > MAX_VERIFIED_BATTLE_MAP_CACHE_ENTRIES) {
    const oldestKey = verifiedMapCache.keys().next().value;
    verifiedMapCache.delete(oldestKey);
  }
}

function v2Reference(map) {
  return {
    battleMapSchemaVersion: map.battleMapSchemaVersion,
    terrainGenerationVersion: map.terrainGenerationVersion,
    fullHash: map.diagnostics.hashes.fullHash
  };
}

function v3Reference(map) {
  return {
    battleMapSchemaVersion: map.battleMapSchemaVersion,
    terrainGenerationVersion: map.terrainGenerationVersion,
    fullHash: map.hashes.fullHash
  };
}

function assertMatchingReference(snapshot, map, reference) {
  if (snapshot.battleMapSchemaVersion !== reference.battleMapSchemaVersion
    || snapshot.terrainGenerationVersion !== reference.terrainGenerationVersion
    || snapshot.fullHash !== reference.fullHash) {
    throw new BattleMapSessionError(
      'battle_map_reference_mismatch',
      'The battle snapshot does not reference the supplied map'
    );
  }
}

function flattenState(map, mutableState, stateRevision) {
  return {
    ...map,
    ...mutableState,
    stateRevision
  };
}

export class BattleMapSessionError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'BattleMapSessionError';
    this.code = code;
  }
}

export function clearBattleMapSessionCache() {
  verifiedMapCache.clear();
}

export function getBattleMapCapabilities({ includeCachedMaps = true } = {}) {
  const v3Ready = isBattleMapV3RuntimeReady();
  return createBattleMapCapabilities({
    supportedBattleMapSchemaVersions: [
      1,
      BATTLE_MAP_SCHEMA_VERSION,
      ...(v3Ready ? [BATTLE_MAP_V3_SCHEMA_VERSION] : [])
    ],
    supportedHashVersions: [
      BATTLE_MAP_HASH_VERSION,
      ...(v3Ready ? [BATTLE_MAP_V3_HASH_VERSION] : [])
    ],
    supportedMutableStateProtocolVersions: [BATTLE_MUTABLE_STATE_PROTOCOL_VERSION],
    cachedMaps: includeCachedMaps
      ? Array.from(verifiedMapCache.values(), v2Reference)
      : []
  });
}

/**
 * Owns one battle's immutable map reference and revisioned mutable state.
 * V2 maps enter the session only after schema and cryptographic verification.
 */
export class BattleMapSession {
  constructor() {
    this.battleId = null;
    this.battleMap = null;
    this.mutableState = null;
    this.state = null;
    this.current = null;
  }

  get capabilities() {
    return getBattleMapCapabilities();
  }

  getCapabilities(options) {
    return getBattleMapCapabilities(options);
  }

  /**
   * Normalize an HTTP start/current/rejoin response. Snapshot-bearing responses
   * are authoritative; responses without a snapshot remain on the V1 path.
   */
  async hydrateResponse(response) {
    if (!response || typeof response !== 'object') {
      throw new TypeError('Battle response must be an object');
    }

    if (response.snapshot) {
      if (response.battleId !== undefined
        && String(response.battleId) !== String(response.snapshot.battleId)) {
        throw new BattleMapSessionError(
          'battle_id_mismatch',
          'The response and snapshot refer to different battles'
        );
      }
      const accepted = await this.acceptSnapshot(response.snapshot);
      return {
        ...response,
        battleId: response.battleId ?? response.snapshot.battleId,
        state: accepted.state,
        mapSeed: accepted.map?.terrainSeed ?? response.mapSeed,
        mapWidth: accepted.map?.mapWidth ??
          accepted.map?.dimensions?.width ??
          response.mapWidth,
        mapHeight: accepted.map?.mapHeight ??
          accepted.map?.dimensions?.height ??
          response.mapHeight,
        nodeType: accepted.map?.nodeType ??
          accepted.map?.theme ??
          response.nodeType
      };
    }

    const state = response.state;
    if (!state || typeof state !== 'object') {
      throw new TypeError('Battle response must include state or snapshot');
    }
    if (state.battleMapSchemaVersion !== undefined
      || state.terrainGenerationVersion !== undefined) {
      const descriptor = resolveBattleMapVersionDescriptor({
        battleMapSchemaVersion: state.battleMapSchemaVersion,
        terrainGenerationVersion: state.terrainGenerationVersion
      });
      if (descriptor.battleMapSchemaVersion !== 1) {
        throw new BattleMapSessionError(
          'battle_map_snapshot_required',
          `BattleMapV${descriptor.battleMapSchemaVersion} state must be delivered in a verified snapshot`
        );
      }
    }

    this.battleId = response.battleId ?? this.battleId;
    this.battleMap = state;
    this.mutableState = state;
    this.state = state;
    this.current = {
      battleMapSchemaVersion: 1,
      terrainGenerationVersion: 1,
      fullHash: null,
      stateRevision: Number.isSafeInteger(response.stateRevision) ? response.stateRevision : 0,
      updateId: null
    };
    return response;
  }

  async acceptSnapshot(snapshot) {
    assertBattleStateSnapshotV1(snapshot);
    if (!['number', 'string'].includes(typeof snapshot.battleId)
      || String(snapshot.battleId).length === 0) {
      throw new BattleMapSessionError(
        'battle_id_invalid',
        'The snapshot must identify its battle'
      );
    }
    if (this.battleId !== null && String(snapshot.battleId) !== String(this.battleId)) {
      throw new BattleMapSessionError(
        'battle_id_mismatch',
        'The snapshot belongs to a different battle'
      );
    }

    let map;
    if (snapshot.battleMapSchemaVersion === BATTLE_MAP_SCHEMA_VERSION) {
      if (snapshot.mapDelivery === 'full') {
        try {
          map = await loadAndFreezeBattleMapV2Final(snapshot.battleMap);
        } catch (error) {
          verifiedMapCache.delete(mapCacheKey(snapshot));
          throw new BattleMapSessionError(
            'battle_map_verification_failed',
            'The authoritative battle map failed verification',
            { cause: error }
          );
        }
        assertMatchingReference(snapshot, map, v2Reference(map));
        cacheVerifiedMap(snapshot, map);
      } else {
        map = getCachedMap(snapshot);
        if (!map) {
          throw new BattleMapSessionError(
            'battle_map_cache_miss',
            'The server referenced a battle map that is not cached locally'
          );
        }
        assertMatchingReference(snapshot, map, v2Reference(map));
      }
    } else if (snapshot.battleMapSchemaVersion === BATTLE_MAP_V3_SCHEMA_VERSION) {
      if (snapshot.mapDelivery !== 'full') {
        throw new BattleMapSessionError(
          'battle_map_v3_full_snapshot_required',
          'BattleMapV3 must be delivered as a complete verified map'
        );
      }
      try {
        map = await loadAndFreezeBattleMapV3Final(snapshot.battleMap);
      } catch (error) {
        throw new BattleMapSessionError(
          'battle_map_verification_failed',
          'The authoritative BattleMapV3 payload failed verification',
          { cause: error }
        );
      }
      assertMatchingReference(snapshot, map, v3Reference(map));
    } else {
      if (snapshot.mapDelivery !== 'full' || !snapshot.battleMap) {
        throw new BattleMapSessionError(
          'legacy_map_missing',
          'A V1 snapshot must include its complete map'
        );
      }
      map = snapshot.battleMap;
    }

    this.battleId = snapshot.battleId;
    this.battleMap = map;
    this.mutableState = snapshot.mutableState;
    this.current = {
      battleMapSchemaVersion: snapshot.battleMapSchemaVersion,
      terrainGenerationVersion: snapshot.terrainGenerationVersion,
      fullHash: snapshot.fullHash,
      stateRevision: snapshot.stateRevision,
      updateId: snapshot.stateRevision > 0
        ? `${snapshot.battleId}:${snapshot.stateRevision}`
        : null
    };
    this.state = flattenState(map, snapshot.mutableState, snapshot.stateRevision);

    return {
      status: 'applied',
      source: 'snapshot',
      map,
      state: this.state,
      stateRevision: snapshot.stateRevision
    };
  }

  acceptUpdate(update) {
    if (!this.current || !this.battleMap) {
      return { status: 'resync_required', reason: 'snapshot_required' };
    }
    if (String(update?.battleId) !== String(this.battleId)) {
      return { status: 'resync_required', reason: 'battle_id_mismatch' };
    }

    const result = applyBattleMutableStateUpdateV1(this.current, update);
    if (result.status !== 'applied') return result;

    this.mutableState = result.mutableState;
    this.current = {
      ...this.current,
      stateRevision: result.stateRevision,
      updateId: result.updateId
    };
    this.state = flattenState(this.battleMap, result.mutableState, result.stateRevision);
    return {
      ...result,
      state: this.state,
      map: this.battleMap
    };
  }
}
