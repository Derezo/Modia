import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_MAP_HASH_VERSION,
  BATTLE_MAP_V3_HASH_VERSION,
  createMinimalBattleMapV2FinalFixture,
  createMinimalBattleMapV3FinalFixture
} from './battleMap/index.js';
import {
  applyBattleMutableStateUpdateV1,
  assertBattleMutableStateUpdateV1,
  createBattleMapCapabilities,
  createBattleMutableStateUpdateV1,
  createBattleMutableStateV1,
  createBattleStateSnapshotV1,
  negotiateBattleMapCapabilities
} from './battleStateProtocol.js';

function mutable(overrides = {}) {
  return createBattleMutableStateV1({
    turn: 1,
    units: [{ id: 'p1', hp: 10, tileX: 0, tileY: 0 }],
    ...overrides
  });
}

describe('BattleMutableStateV1', () => {
  it('normalizes every closed field and rejects immutable or unknown fields', () => {
    const value = mutable();
    assert.equal(Object.isFrozen(value), true);
    assert.equal(value.turn, 1);
    assert.deepEqual(value.disconnectedPlayers, []);

    assert.throws(
      () => createBattleMutableStateV1({ terrain: [['grass']] }),
      /immutable map data/
    );
    assert.throws(
      () => createBattleMutableStateV1({ arbitraryPatch: true }),
      /not part of BattleMutableStateV1/
    );
  });
});

describe('BattleMutableStateUpdateV1', () => {
  it('uses an exact map reference, consecutive revisions, and stable update identity', () => {
    const update = createBattleMutableStateUpdateV1({
      battleId: 12,
      battleMapSchemaVersion: 2,
      terrainGenerationVersion: 2,
      fullHash: `sha256:${'a'.repeat(64)}`,
      baseStateRevision: 4,
      stateRevision: 5,
      mutableState: mutable()
    });
    assert.equal(update.updateId, '12:5');
    assert.equal(assertBattleMutableStateUpdateV1(update), update);

    assert.throws(
      () => assertBattleMutableStateUpdateV1({ ...update, stateRevision: 7 }),
      /baseStateRevision \+ 1/
    );
    assert.throws(
      () => assertBattleMutableStateUpdateV1({ ...update, path: '/terrain/0/0' }),
      /not allowed/
    );
    assert.throws(
      () => assertBattleMutableStateUpdateV1({
        ...update,
        battleMapSchemaVersion: 3,
        terrainGenerationVersion: 2
      }),
      /Unsupported battle map version pair 3\/2/
    );
  });

  it('carries an exact V3 hash reference without changing the mutable protocol', async () => {
    const map = await createMinimalBattleMapV3FinalFixture();
    const update = createBattleMutableStateUpdateV1({
      battleId: 'v3-battle',
      battleMapSchemaVersion: 3,
      terrainGenerationVersion: 3,
      fullHash: map.hashes.fullHash,
      baseStateRevision: 7,
      stateRevision: 8,
      mutableState: mutable()
    });

    assert.equal(update.protocolVersion, 1);
    assert.equal(update.fullHash, map.hashes.fullHash);
    assert.equal(assertBattleMutableStateUpdateV1(update), update);
  });

  it('applies ordered updates, ignores duplicates, and fails closed on gaps and map mismatch', () => {
    const fullHash = `sha256:${'b'.repeat(64)}`;
    const update = createBattleMutableStateUpdateV1({
      battleId: 'battle-a',
      battleMapSchemaVersion: 2,
      terrainGenerationVersion: 2,
      fullHash,
      baseStateRevision: 3,
      stateRevision: 4,
      mutableState: mutable({ turn: 2 })
    });
    const current = {
      battleMapSchemaVersion: 2,
      terrainGenerationVersion: 2,
      fullHash,
      stateRevision: 3,
      updateId: 'battle-a:3'
    };
    assert.equal(applyBattleMutableStateUpdateV1(current, update).status, 'applied');
    assert.equal(
      applyBattleMutableStateUpdateV1({ ...current, stateRevision: 4, updateId: update.updateId }, update).status,
      'duplicate'
    );
    assert.equal(
      applyBattleMutableStateUpdateV1({ ...current, stateRevision: 2 }, update).reason,
      'revision_gap'
    );
    assert.equal(
      applyBattleMutableStateUpdateV1({ ...current, fullHash: `sha256:${'c'.repeat(64)}` }, update).reason,
      'map_reference_mismatch'
    );
  });
});

describe('battle map capability negotiation and snapshots', () => {
  it('keeps absent capability on V1 and rejects an existing V2 map', async () => {
    const map = await createMinimalBattleMapV2FinalFixture();
    assert.equal(
      negotiateBattleMapCapabilities({ clientCapabilities: null }).selectedBattleMapSchemaVersion,
      1
    );
    assert.equal(
      negotiateBattleMapCapabilities({ clientCapabilities: null, existingMap: map }).code,
      'battle_map_upgrade_required'
    );
  });

  it('selects cached delivery only for an exact verified map reference', async () => {
    const map = await createMinimalBattleMapV2FinalFixture();
    const capabilities = createBattleMapCapabilities({
      supportedBattleMapSchemaVersions: [1, 2],
      supportedHashVersions: [BATTLE_MAP_HASH_VERSION],
      supportedMutableStateProtocolVersions: [1],
      cachedMaps: [{
        battleMapSchemaVersion: 2,
        terrainGenerationVersion: 2,
        fullHash: map.diagnostics.hashes.fullHash
      }]
    });
    const selected = negotiateBattleMapCapabilities({
      clientCapabilities: capabilities,
      existingMap: map
    });
    assert.equal(selected.compatible, true);
    assert.equal(selected.mapDelivery, 'cached');

    const snapshot = createBattleStateSnapshotV1({
      battleId: 9,
      stateRevision: 2,
      battleMap: map,
      mutableState: mutable(),
      mapDelivery: selected.mapDelivery
    });
    assert.equal(snapshot.battleMap, null);
    assert.equal(snapshot.fullHash, map.diagnostics.hashes.fullHash);
  });

  it('requires V3 capability, never downgrades, and always delivers a full verified V3 map', async () => {
    const map = await createMinimalBattleMapV3FinalFixture();
    const absent = negotiateBattleMapCapabilities({
      clientCapabilities: null,
      existingMap: map
    });
    assert.deepEqual(absent, {
      compatible: false,
      code: 'battle_map_upgrade_required',
      requiredBattleMapSchemaVersion: 3,
      requiredHashVersion: BATTLE_MAP_V3_HASH_VERSION,
      requiredMutableStateProtocolVersion: 1
    });

    const v2Only = createBattleMapCapabilities({
      supportedBattleMapSchemaVersions: [1, 2],
      supportedHashVersions: [BATTLE_MAP_HASH_VERSION]
    });
    assert.equal(negotiateBattleMapCapabilities({
      clientCapabilities: v2Only,
      existingMap: map
    }).compatible, false);

    const v3 = createBattleMapCapabilities({
      supportedBattleMapSchemaVersions: [1, 2, 3],
      supportedHashVersions: [BATTLE_MAP_HASH_VERSION, BATTLE_MAP_V3_HASH_VERSION]
    });
    const selected = negotiateBattleMapCapabilities({
      clientCapabilities: v3,
      existingMap: map,
      allowNewV2: true
    });
    assert.equal(selected.selectedBattleMapSchemaVersion, 3);
    assert.equal(selected.mapDelivery, 'full');

    const snapshot = createBattleStateSnapshotV1({
      battleId: 'v3-battle',
      stateRevision: 4,
      battleMap: map,
      mutableState: mutable(),
      mapDelivery: selected.mapDelivery
    });
    assert.equal(snapshot.battleMap.contentId, map.contentId);
    assert.equal(snapshot.fullHash, map.hashes.fullHash);
    assert.throws(
      () => createBattleStateSnapshotV1({
        battleId: 'v3-battle',
        stateRevision: 5,
        battleMap: map,
        mutableState: mutable(),
        mapDelivery: 'cached'
      }),
      /require full map delivery/
    );
    assert.throws(
      () => createBattleMapCapabilities({
        supportedBattleMapSchemaVersions: [1, 2, 3],
        supportedHashVersions: [BATTLE_MAP_V3_HASH_VERSION],
        cachedMaps: [{
          battleMapSchemaVersion: 3,
          terrainGenerationVersion: 3,
          fullHash: map.hashes.fullHash
        }]
      }),
      /not a cacheable V2 map reference/
    );
  });
});
