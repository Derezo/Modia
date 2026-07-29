import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  BATTLE_MAP_HASH_VERSION,
  createMinimalBattleMapV2FinalFixture
} from '../../../../shared/battleMap/index.js';
import {
  createBattleMapCapabilities,
  createBattleMutableStateV1
} from '../../../../shared/battleStateProtocol.js';
import {
  createNegotiatedBattleStateSnapshot,
  getRegisteredBattleMapCapabilities,
  registerBattleMapCapabilities,
  stopCleanupInterval
} from '../../services/messageReliability.js';

function mutableState() {
  return createBattleMutableStateV1({
    turn: 4,
    units: [{ id: 'player-1', hp: 12, tileX: 0, tileY: 0 }]
  });
}

function v1Envelope() {
  return {
    battleId: 10,
    stateRevision: 6,
    battleMapSchemaVersion: 1,
    map: {
      battleMapSchemaVersion: 1,
      terrainGenerationVersion: 1,
      terrainSeed: 123,
      mapWidth: 1,
      mapHeight: 1,
      terrain: [['grass']],
      elevation: [[0]],
      obstacles: []
    },
    mutableState: mutableState(),
    state: { turn: 4, units: [] }
  };
}

async function v2Envelope() {
  const map = await createMinimalBattleMapV2FinalFixture();
  return {
    battleId: 11,
    stateRevision: 9,
    battleMapSchemaVersion: 2,
    map,
    mutableState: mutableState(),
    state: { turn: 4, units: [] }
  };
}

function capabilities({ cachedMaps = [], versions = [1, 2] } = {}) {
  return createBattleMapCapabilities({
    supportedBattleMapSchemaVersions: versions,
    supportedHashVersions: [BATTLE_MAP_HASH_VERSION],
    supportedMutableStateProtocolVersions: [1],
    cachedMaps
  });
}

describe('API battle-map transport negotiation', () => {
  it('preserves the legacy V1 full-map fallback and persisted revision', () => {
    const result = createNegotiatedBattleStateSnapshot(v1Envelope(), undefined);

    assert.equal(result.negotiation.compatible, true);
    assert.equal(result.negotiation.selectedBattleMapSchemaVersion, 1);
    assert.equal(result.snapshot.stateRevision, 6);
    assert.equal(result.snapshot.mapDelivery, 'full');
    assert.equal(result.snapshot.battleMap.terrainSeed, 123);
  });

  it('does not infer V2 support when capabilities are absent', async () => {
    const result = createNegotiatedBattleStateSnapshot(await v2Envelope(), undefined);

    assert.equal(result.negotiation.compatible, false);
    assert.equal(result.negotiation.code, 'battle_map_upgrade_required');
    assert.equal(result.snapshot, null);
  });

  it('delivers a full verified V2 map when the client has no cached reference', async () => {
    const battle = await v2Envelope();
    const result = createNegotiatedBattleStateSnapshot(battle, capabilities());

    assert.equal(result.negotiation.compatible, true);
    assert.equal(result.negotiation.mapDelivery, 'full');
    assert.equal(result.snapshot.stateRevision, 9);
    assert.deepEqual(result.snapshot.battleMap, battle.map);
    assert.equal(result.snapshot.fullHash, battle.map.diagnostics.hashes.fullHash);
  });

  it('uses reference-only delivery only for an exact cached map hash', async () => {
    const battle = await v2Envelope();
    const cachedMaps = [{
      battleMapSchemaVersion: 2,
      terrainGenerationVersion: battle.map.terrainGenerationVersion,
      fullHash: battle.map.diagnostics.hashes.fullHash
    }];
    const result = createNegotiatedBattleStateSnapshot(
      battle,
      capabilities({ cachedMaps }),
      { referenceDeltaEnabled: true }
    );

    assert.equal(result.negotiation.mapDelivery, 'cached');
    assert.equal(result.snapshot.battleMap, null);
    assert.equal(result.snapshot.fullHash, cachedMaps[0].fullHash);
    assert.deepEqual(result.snapshot.mutableState, battle.mutableState);
  });

  it('defaults to a full snapshot while the reference/delta kill switch is off', async () => {
    const battle = await v2Envelope();
    const cachedMaps = [{
      battleMapSchemaVersion: 2,
      terrainGenerationVersion: battle.map.terrainGenerationVersion,
      fullHash: battle.map.diagnostics.hashes.fullHash
    }];
    const result = createNegotiatedBattleStateSnapshot(
      battle,
      capabilities({ cachedMaps })
    );

    assert.equal(result.negotiation.compatible, true);
    assert.equal(result.negotiation.mapDelivery, 'full');
    assert.deepEqual(result.snapshot.battleMap, battle.map);
    assert.equal(result.snapshot.fullHash, cachedMaps[0].fullHash);
  });

  it('fails closed for incompatible and malformed declarations', async () => {
    const battle = await v2Envelope();
    const incompatible = createNegotiatedBattleStateSnapshot(
      battle,
      createBattleMapCapabilities({
        supportedBattleMapSchemaVersions: [1],
        supportedMutableStateProtocolVersions: [1]
      })
    );

    assert.equal(incompatible.negotiation.code, 'battle_map_upgrade_required');
    assert.equal(incompatible.snapshot, null);
    assert.throws(
      () => createNegotiatedBattleStateSnapshot(battle, { cachedMaps: [] }),
      /required|not allowed|must be an array/
    );
  });

  it('retains only explicitly registered capabilities for reliability resync', () => {
    const ws = {};
    assert.equal(getRegisteredBattleMapCapabilities(ws, 12), undefined);

    const declared = capabilities();
    registerBattleMapCapabilities(ws, 12, declared);
    assert.equal(getRegisteredBattleMapCapabilities(ws, 12), declared);

    registerBattleMapCapabilities(ws, 12, undefined);
    assert.equal(getRegisteredBattleMapCapabilities(ws, 12), undefined);
  });

  it('wires HTTP and WebSocket entry points through persisted-map negotiation', async () => {
    const testDirectory = dirname(fileURLToPath(import.meta.url));
    const sourceRoot = resolve(testDirectory, '../..');
    const [route, handlers, reliability] = await Promise.all([
      readFile(resolve(sourceRoot, 'routes/battle.js'), 'utf8'),
      readFile(resolve(sourceRoot, 'websocket/messageHandlers.js'), 'utf8'),
      readFile(resolve(sourceRoot, 'services/messageReliability.js'), 'utf8')
    ]);

    for (const routeMarker of [
      "router.post('/start'",
      "router.get('/current'",
      "router.get('/:battleId/rejoin'"
    ]) {
      assert.ok(route.includes(routeMarker));
    }
    assert.match(route, /readBattleMapCapabilities\(req\)/);
    assert.match(route, /battleStateRepository\.loadBattle/);
    assert.match(route, /createBattleTransportResponse/);
    assert.match(handlers, /battle_map_upgrade_required/);
    assert.match(handlers, /registerBattleMapCapabilities/);
    assert.match(reliability, /getRegisteredBattleMapCapabilities/);
  });
});

stopCleanupInterval();
