import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../client.js';

describe('ApiClient battle-map protocol', () => {
  it('advertises capabilities and reuses a battle-start key after an ambiguous failure', async () => {
    const client = new ApiClient('/api');
    const requests = [];
    let attempt = 0;
    client.post = async (endpoint, body) => {
      requests.push({ endpoint, body });
      if (attempt++ === 0) throw new Error('Unable to connect to server');
      return { battleId: attempt };
    };

    await assert.rejects(client.startBattle({ formation: {} }));
    await client.startBattle({ formation: {} });
    await client.startBattle({ formation: {} });

    assert.equal(requests[0].endpoint, '/battle/start');
    assert.equal(
      requests[1].body.battleStartRequestId,
      requests[0].body.battleStartRequestId
    );
    assert.notEqual(
      requests[2].body.battleStartRequestId,
      requests[1].body.battleStartRequestId
    );
    assert.deepEqual(
      requests[0].body.battleMapCapabilities.supportedBattleMapSchemaVersions,
      [1, 2]
    );
    assert.deepEqual(
      requests[0].body.battleMapCapabilities.supportedMutableStateProtocolVersions,
      [1]
    );
  });

  it('advertises capabilities on current-battle recovery', async () => {
    const client = new ApiClient('/api');
    let request;
    client.get = async (endpoint, options) => {
      request = { endpoint, options };
      return { battleId: 1 };
    };

    await client.getCurrentBattle();

    assert.equal(request.endpoint, '/battle/current');
    const capabilities = JSON.parse(
      request.options.headers['x-battle-map-capabilities']
    );
    assert.deepEqual(capabilities.supportedBattleMapSchemaVersions, [1, 2]);
    assert.deepEqual(capabilities.supportedMutableStateProtocolVersions, [1]);
  });

  it('advertises capabilities when starting a guild advancement boss trial', async () => {
    const client = new ApiClient('/api');
    let request;
    client.post = async (endpoint, body) => {
      request = { endpoint, body };
      return { battleId: 2 };
    };

    await client.startBossTrial(37);

    assert.equal(request.endpoint, '/advancement/boss/start');
    assert.equal(request.body.characterId, 37);
    assert.deepEqual(
      request.body.battleMapCapabilities.supportedBattleMapSchemaVersions,
      [1, 2]
    );
    assert.deepEqual(
      request.body.battleMapCapabilities.supportedMutableStateProtocolVersions,
      [1]
    );
  });
});
