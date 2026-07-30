import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ApiError } from '../client.js';

describe('ApiClient battle-map protocol', () => {
  it('loads Zodiac availability for the authoritative battle character', async () => {
    const client = new ApiClient('/api');
    let request;
    client.get = async (endpoint, options) => {
      request = { endpoint, options };
      return { availableAbilities: [] };
    };
    const signal = new AbortController().signal;

    await client.getAvailableZodiacAbilities(9, 77, { signal });

    assert.deepEqual(request, {
      endpoint: '/battle/9/zodiac-abilities/77',
      options: { signal }
    });
  });

  it('submits Zodiac abilities outside the generic action endpoint', async () => {
    const client = new ApiClient('/api');
    let request;
    client.post = async (endpoint, body, options) => {
      request = { endpoint, body, options };
      return { success: true };
    };

    await client.useZodiacAbility({
      battleId: 9,
      characterId: 77,
      abilityKey: 'dreamwave',
      targetUnitId: 'enemy-2',
      actionSequence: 6,
      commandId: 'zodiac-command-123',
      stateRevision: 12
    });

    assert.deepEqual(request, {
      endpoint: '/battle/9/zodiac-ability',
      body: {
        characterId: 77,
        abilityKey: 'dreamwave',
        targetUnitId: 'enemy-2',
        actionSequence: 6,
        commandId: 'zodiac-command-123',
        stateRevision: 12
      },
      options: { timeoutMs: 15000 }
    });
  });

  it('preserves battle command identity and item inventory identity', async () => {
    const client = new ApiClient('/api');
    let request;
    client.post = async (endpoint, body, options) => {
      request = { endpoint, body, options };
      return { success: true };
    };

    await client.submitBattleAction({
      battleId: 9,
      actionType: 'item',
      unitId: 'chemist',
      targetTile: { x: 2, y: 3 },
      skillId: 'potion',
      inventoryId: 77,
      actionSequence: 4,
      commandId: 'command-123',
      stateRevision: 12
    });

    assert.deepEqual(request, {
      endpoint: '/battle/action',
      body: {
        battleId: 9,
        actionType: 'item',
        unitId: 'chemist',
        targetTile: { x: 2, y: 3 },
        skillId: 'potion',
        inventoryId: 77,
        actionSequence: 4,
        commandId: 'command-123',
        stateRevision: 12
      },
      options: {
        timeoutMs: 15000
      }
    });
  });

  it('bounds battle action requests and marks timeout as ambiguous', async (t) => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
    t.after(() => { globalThis.fetch = previousFetch; });

    const client = new ApiClient('/api');
    await assert.rejects(
      client.submitBattleAction({
        battleId: 9,
        actionType: 'wait',
        unitId: 'player',
        commandId: 'command-timeout'
      }, { timeoutMs: 10 }),
      error => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.isTimeout, true);
        assert.equal(error.isNetworkError, true);
        assert.equal(error.data, null);
        return true;
      }
    );
  });

  it('keeps structured non-success battle state on ApiError', async (t) => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      status: 409,
      ok: false,
      async json() {
        return {
          error: 'Already acted this turn',
          stateRevision: 8,
          state: { activeUnitId: 'player' },
          availableActions: { canMove: true, canAct: false }
        };
      }
    });
    t.after(() => { globalThis.fetch = previousFetch; });

    const client = new ApiClient('/api');
    await assert.rejects(
      client.submitBattleAction({
        battleId: 9,
        actionType: 'attack',
        unitId: 'player',
        commandId: 'command-409'
      }),
      error => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 409);
        assert.equal(error.data.stateRevision, 8);
        assert.deepEqual(error.data.availableActions, {
          canMove: true,
          canAct: false
        });
        return true;
      }
    );
  });

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

    await client.startBossTrial(37, 91);

    assert.equal(request.endpoint, '/advancement/boss/start');
    assert.equal(request.body.characterId, 37);
    assert.equal(request.body.nodeId, 91);
    assert.deepEqual(
      request.body.battleMapCapabilities.supportedBattleMapSchemaVersions,
      [1, 2]
    );
    assert.deepEqual(
      request.body.battleMapCapabilities.supportedMutableStateProtocolVersions,
      [1]
    );
  });

  it('includes the selected guild node when accepting an advancement quest', async () => {
    const client = new ApiClient('/api');
    let request;
    client.post = async (endpoint, body) => {
      request = { endpoint, body };
      return { success: true };
    };

    await client.acceptAdvancementQuest(37, 12, 91);

    assert.deepEqual(request, {
      endpoint: '/advancement/accept',
      body: {
        characterId: 37,
        questTemplateId: 12,
        nodeId: 91
      }
    });
  });
});
