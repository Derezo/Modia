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
  createAdvancementBattleTransportResponse,
  readAdvancementBattleMapCapabilities
} from '../../routes/advancementQuest.js';
import { processColiseumSurrender } from '../../routes/coliseum.js';
import { normalizeQueuedBattleMapCapabilities } from '../../services/coliseum/matchmaking.js';
import { stopCleanupInterval } from '../../services/messageReliability.js';

function v2Capabilities() {
  return createBattleMapCapabilities({
    supportedBattleMapSchemaVersions: [1, 2],
    supportedHashVersions: [BATTLE_MAP_HASH_VERSION],
    supportedMutableStateProtocolVersions: [1]
  });
}

function mutableState() {
  return createBattleMutableStateV1({
    turn: 1,
    units: [{ id: 7, hp: 20, tileX: 0, tileY: 0 }]
  });
}

function v1Envelope() {
  const map = {
    battleMapSchemaVersion: 1,
    terrainGenerationVersion: 1,
    terrainSeed: 91,
    mapWidth: 1,
    mapHeight: 1,
    terrain: [['grass']],
    elevation: [[0]],
    obstacles: []
  };
  return {
    battleId: 41,
    battleMapSchemaVersion: 1,
    terrainGenerationVersion: 1,
    stateRevision: 0,
    map,
    mutableState: mutableState(),
    state: { ...map, ...mutableState() }
  };
}

describe('battle entry-path capability propagation', () => {
  it('validates and detaches capability declarations retained in Coliseum queues', () => {
    const declared = v2Capabilities();
    const queued = normalizeQueuedBattleMapCapabilities(declared);

    assert.deepEqual(queued, declared);
    assert.notStrictEqual(queued, declared);
    assert.notStrictEqual(
      queued.supportedBattleMapSchemaVersions,
      declared.supportedBattleMapSchemaVersions
    );
    assert.equal(normalizeQueuedBattleMapCapabilities(undefined), null);
    assert.throws(
      () => normalizeQueuedBattleMapCapabilities({ cachedMaps: [] }),
      /required|not allowed|must be an array/
    );
  });

  it('reads advancement capabilities from JSON headers and rejects malformed input', () => {
    const declared = v2Capabilities();
    const req = {
      body: {},
      query: {},
      get: () => JSON.stringify(declared)
    };

    assert.deepEqual(readAdvancementBattleMapCapabilities(req), declared);
    assert.throws(
      () => readAdvancementBattleMapCapabilities({
        body: { battleMapCapabilities: '{bad json' },
        query: {},
        get: () => undefined
      }),
      error => error.statusCode === 400
        && error.data?.code === 'battle_map_capabilities_invalid'
    );
  });

  it('preserves advancement V1 compatibility while adding a canonical snapshot', () => {
    const battle = v1Envelope();
    const legacy = { battleId: battle.battleId, state: battle.state };

    assert.strictEqual(
      createAdvancementBattleTransportResponse(legacy, battle, undefined),
      legacy
    );

    const response = createAdvancementBattleTransportResponse(
      legacy,
      battle,
      v2Capabilities()
    );
    assert.equal(response.battleMapCapabilities.selectedBattleMapSchemaVersion, 1);
    assert.equal(response.snapshot.battleId, battle.battleId);
    assert.equal(response.snapshot.stateRevision, battle.stateRevision);
    assert.deepEqual(response.snapshot.mutableState, battle.mutableState);
    assert.deepEqual(response.state, battle.state);
  });

  it('returns only the canonical snapshot for a negotiated V2 advancement map', async () => {
    const map = await createMinimalBattleMapV2FinalFixture();
    const battle = {
      battleId: 42,
      battleMapSchemaVersion: 2,
      terrainGenerationVersion: map.terrainGenerationVersion,
      stateRevision: 3,
      map,
      mutableState: mutableState(),
      state: { raw: 'must not be returned for V2' }
    };

    const response = createAdvancementBattleTransportResponse(
      { battleId: battle.battleId, state: battle.state },
      battle,
      v2Capabilities()
    );

    assert.equal(response.state, undefined);
    assert.equal(response.snapshot.battleMapSchemaVersion, 2);
    assert.deepEqual(response.snapshot.battleMap, map);
    assert.equal(response.snapshot.stateRevision, 3);
  });

  it('invokes the Coliseum surrender lifecycle exactly once and makes retries idempotent', async () => {
    const calls = [];
    const activeRepository = {
      loadBattleForParticipant: async (battleId, userId) => {
        calls.push(['load', battleId, userId]);
        return { battleType: 'pvp_coliseum', status: 'active' };
      }
    };
    const surrender = async (battleId, userId) => {
      calls.push(['surrender', battleId, userId]);
    };

    assert.deepEqual(
      await processColiseumSurrender(51, 8, {
        repository: activeRepository,
        surrender
      }),
      { outcome: 'processed' }
    );
    assert.deepEqual(calls, [
      ['load', 51, 8],
      ['surrender', 51, 8]
    ]);

    calls.length = 0;
    const completed = await processColiseumSurrender(51, 8, {
      repository: {
        loadBattleForParticipant: async () => ({
          battleType: 'pvp_coliseum',
          status: 'victory'
        })
      },
      surrender
    });
    assert.deepEqual(completed, { outcome: 'already_completed' });
    assert.deepEqual(calls, []);
  });

  it('does not surrender non-Coliseum battles', async () => {
    let surrendered = false;
    const result = await processColiseumSurrender(52, 8, {
      repository: {
        loadBattleForParticipant: async () => ({
          battleType: 'pvp',
          status: 'active'
        })
      },
      surrender: async () => {
        surrendered = true;
      }
    });

    assert.deepEqual(result, { outcome: 'not_found' });
    assert.equal(surrendered, false);
  });

  it('wires all three entry paths to their repository and negotiation boundaries', async () => {
    const testDirectory = dirname(fileURLToPath(import.meta.url));
    const sourceRoot = resolve(testDirectory, '../..');
    const [handlers, matchmaking, coliseumRoute, advancementRoute] = await Promise.all([
      readFile(resolve(sourceRoot, 'websocket/messageHandlers.js'), 'utf8'),
      readFile(resolve(sourceRoot, 'services/coliseum/matchmaking.js'), 'utf8'),
      readFile(resolve(sourceRoot, 'routes/coliseum.js'), 'utf8'),
      readFile(resolve(sourceRoot, 'routes/advancementQuest.js'), 'utf8')
    ]);

    assert.match(handlers, /battleMapCapabilities\s*\?\?\s*null/);
    assert.match(matchmaking, /battleMapCapabilities:\s*queuedBattleMapCapabilities/);
    assert.match(coliseumRoute, /loadBattleForParticipant/);
    assert.match(coliseumRoute, /battle\.battleType\s*!==\s*'pvp_coliseum'/);
    assert.match(coliseumRoute, /await surrender\(battleId,\s*userId\)/);
    assert.match(advancementRoute, /\{\s*clientCapabilities:\s*battleMapCapabilities\s*\}/);
    assert.match(advancementRoute, /createAdvancementBattleTransportResponse/);
    assert.match(advancementRoute, /battleStateRepository\.loadBattleForParticipant/);
  });
});

stopCleanupInterval();
