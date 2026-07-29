import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_MAP_HASH_VERSION,
  createMinimalBattleMapV2CandidateFixture,
  finalizeBattleMapV2,
  createMinimalBattleMapV2FinalFixture
} from '../../../../shared/battleMap/index.js';
import {
  createBattleMutableStateUpdateV1,
  createBattleMutableStateV1,
  createBattleStateSnapshotV1
} from '../../../../shared/battleStateProtocol.js';
import {
  BattleMapSession,
  clearBattleMapSessionCache,
  getBattleMapCapabilities,
  MAX_VERIFIED_BATTLE_MAP_CACHE_ENTRIES
} from '../BattleMapSession.js';

function mutable(overrides = {}) {
  return createBattleMutableStateV1({
    units: [{ id: 'player', hp: 20, tileX: 0, tileY: 0 }],
    turn: 1,
    ...overrides
  });
}

beforeEach(() => clearBattleMapSessionCache());

describe('BattleMapSession', () => {
  it('verifies a full V2 snapshot, caches it, and hydrates every map layer', async () => {
    const map = await createMinimalBattleMapV2FinalFixture();
    const snapshot = createBattleStateSnapshotV1({
      battleId: 12,
      stateRevision: 3,
      battleMap: map,
      mutableState: mutable()
    });
    const session = new BattleMapSession();

    const result = await session.acceptSnapshot(snapshot);

    assert.equal(result.state.terrain, result.map.terrain);
    assert.equal(result.state.elevation, result.map.elevation);
    assert.equal(result.state.variants, result.map.variants);
    assert.equal(result.state.transitions, result.map.transitions);
    assert.equal(result.state.decorations, result.map.decorations);
    assert.equal(result.state.obstacles, result.map.obstacles);
    assert.equal(result.state.elevationConnections, result.map.elevationConnections);
    assert.equal(result.state.units[0].hp, 20);
    assert.deepEqual(getBattleMapCapabilities().cachedMaps, [{
      battleMapSchemaVersion: 2,
      terrainGenerationVersion: 2,
      fullHash: map.diagnostics.hashes.fullHash
    }]);
    assert.deepEqual(getBattleMapCapabilities().supportedHashVersions, [BATTLE_MAP_HASH_VERSION]);
  });

  it('hydrates a cached snapshot only from a previously verified exact map reference', async () => {
    const map = await createMinimalBattleMapV2FinalFixture();
    const full = createBattleStateSnapshotV1({
      battleId: 'battle-cache',
      stateRevision: 1,
      battleMap: map,
      mutableState: mutable()
    });
    const cached = createBattleStateSnapshotV1({
      battleId: 'battle-cache',
      stateRevision: 2,
      battleMap: map,
      mutableState: mutable({ turn: 2 }),
      mapDelivery: 'cached'
    });

    const uncachedSession = new BattleMapSession();
    await assert.rejects(
      () => uncachedSession.acceptSnapshot(cached),
      error => error.code === 'battle_map_cache_miss'
    );

    const primingSession = new BattleMapSession();
    await primingSession.acceptSnapshot(full);
    const rejoinedSession = new BattleMapSession();
    const result = await rejoinedSession.acceptSnapshot(cached);

    assert.equal(result.map, primingSession.battleMap);
    assert.equal(result.state.turn, 2);
    assert.equal(result.state.stateRevision, 2);
  });

  it('bounds advertised cached maps and evicts the least recently used reference', async () => {
    const maps = await Promise.all(
      Array.from({ length: MAX_VERIFIED_BATTLE_MAP_CACHE_ENTRIES + 1 }, (_, index) => {
        const candidate = createMinimalBattleMapV2CandidateFixture();
        candidate.terrainSeed += index;
        return finalizeBattleMapV2(candidate);
      })
    );

    for (let index = 0; index < MAX_VERIFIED_BATTLE_MAP_CACHE_ENTRIES; index++) {
      await new BattleMapSession().acceptSnapshot(createBattleStateSnapshotV1({
        battleId: `cache-${index}`,
        stateRevision: 1,
        battleMap: maps[index],
        mutableState: mutable()
      }));
    }

    // A cached-map hit refreshes entry zero, making entry one the LRU.
    await new BattleMapSession().acceptSnapshot(createBattleStateSnapshotV1({
      battleId: 'cache-0',
      stateRevision: 2,
      battleMap: maps[0],
      mutableState: mutable({ turn: 2 }),
      mapDelivery: 'cached'
    }));
    await new BattleMapSession().acceptSnapshot(createBattleStateSnapshotV1({
      battleId: `cache-${MAX_VERIFIED_BATTLE_MAP_CACHE_ENTRIES}`,
      stateRevision: 1,
      battleMap: maps[MAX_VERIFIED_BATTLE_MAP_CACHE_ENTRIES],
      mutableState: mutable()
    }));

    const capabilities = getBattleMapCapabilities();
    const hashes = capabilities.cachedMaps.map(reference => reference.fullHash);
    assert.equal(capabilities.cachedMaps.length, MAX_VERIFIED_BATTLE_MAP_CACHE_ENTRIES);
    assert.ok(
      new TextEncoder().encode(JSON.stringify(capabilities)).byteLength < 8192,
      'capabilities remain suitable for the rejoin request header'
    );
    assert.equal(hashes.includes(maps[0].diagnostics.hashes.fullHash), true);
    assert.equal(hashes.includes(maps[1].diagnostics.hashes.fullHash), false);
    assert.equal(
      hashes.includes(maps[MAX_VERIFIED_BATTLE_MAP_CACHE_ENTRIES].diagnostics.hashes.fullHash),
      true
    );
  });

  it('fails closed when a V2 map payload does not match its hashes', async () => {
    const map = await createMinimalBattleMapV2FinalFixture();
    const snapshot = structuredClone(createBattleStateSnapshotV1({
      battleId: 9,
      stateRevision: 0,
      battleMap: map,
      mutableState: mutable()
    }));
    snapshot.battleMap.terrain[0][0].movementCost += 1;

    await assert.rejects(
      () => new BattleMapSession().acceptSnapshot(snapshot),
      error => error.code === 'battle_map_verification_failed'
    );
    assert.equal(getBattleMapCapabilities().cachedMaps.length, 0);
  });

  it('applies ordered deltas and detects duplicate, gap, and map-reference recovery cases', async () => {
    const map = await createMinimalBattleMapV2FinalFixture();
    const session = new BattleMapSession();
    await session.acceptSnapshot(createBattleStateSnapshotV1({
      battleId: 42,
      stateRevision: 4,
      battleMap: map,
      mutableState: mutable()
    }));

    const update = createBattleMutableStateUpdateV1({
      battleId: 42,
      battleMapSchemaVersion: 2,
      terrainGenerationVersion: 2,
      fullHash: map.diagnostics.hashes.fullHash,
      baseStateRevision: 4,
      stateRevision: 5,
      mutableState: mutable({ turn: 2 })
    });
    assert.equal(session.acceptUpdate(update).status, 'applied');
    assert.equal(session.state.turn, 2);
    assert.equal(session.acceptUpdate(update).status, 'duplicate');

    const gap = createBattleMutableStateUpdateV1({
      battleId: 42,
      battleMapSchemaVersion: 2,
      terrainGenerationVersion: 2,
      fullHash: map.diagnostics.hashes.fullHash,
      baseStateRevision: 6,
      stateRevision: 7,
      mutableState: mutable({ turn: 3 })
    });
    assert.equal(session.acceptUpdate(gap).reason, 'revision_gap');

    const wrongMap = createBattleMutableStateUpdateV1({
      battleId: 42,
      battleMapSchemaVersion: 2,
      terrainGenerationVersion: 2,
      fullHash: `sha256:${'f'.repeat(64)}`,
      baseStateRevision: 5,
      stateRevision: 6,
      mutableState: mutable({ turn: 3 })
    });
    assert.equal(session.acceptUpdate(wrongMap).reason, 'map_reference_mismatch');
    assert.equal(session.state.turn, 2);
  });

  it('retains the legacy V1 response path and rejects unverified flat V2 state', async () => {
    const session = new BattleMapSession();
    const legacy = {
      battleId: 3,
      mapSeed: 10,
      state: { units: [], terrain: [['grass']] }
    };

    assert.equal(await session.hydrateResponse(legacy), legacy);
    await assert.rejects(
      () => session.hydrateResponse({
        battleId: 3,
        state: { battleMapSchemaVersion: 2, terrainGenerationVersion: 2 }
      }),
      error => error.code === 'battle_map_snapshot_required'
    );
  });
});
