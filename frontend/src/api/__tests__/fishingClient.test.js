import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, createFishingActionId } from '../client.js';

const ACTIONS = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000007'
];

describe('ApiClient authoritative fishing protocol', () => {
  it('uses the setup, status, and active-session hydration endpoints', async () => {
    const client = new ApiClient('/api');
    const endpoints = [];
    client.get = async endpoint => {
      endpoints.push(endpoint);
      return {};
    };

    await client.getFishingSetup(42);
    await client.getFishingStatus(42);
    await client.getActiveFishingStatus();

    assert.deepEqual(endpoints, [
      '/fishing/42/setup',
      '/fishing/42/status',
      '/fishing/status'
    ]);
  });

  it('keeps the Game refresh contract for nested authoritative sessions', async () => {
    const client = new ApiClient('/api');
    client.get = async () => ({
      session: {
        active: true,
        sessionId: 'session-restore',
        nodeId: 42,
        nodeName: 'Quiet Pond'
      }
    });

    const status = await client.getActiveFishingStatus();

    assert.equal(status.active, true);
    assert.equal(status.nodeId, 42);
    assert.equal(status.nodeName, 'Quiet Pond');
  });

  it('marks expired baskets as collectable for refresh recovery', async () => {
    const client = new ApiClient('/api');
    client.get = async () => ({
      session: {
        sessionId: 'expired-session',
        nodeId: 17,
        status: 'expired',
        active: false,
        expired: true
      }
    });

    const status = await client.getActiveFishingStatus();

    assert.equal(status.active, false);
    assert.equal(status.collectable, true);
    assert.equal(status.nodeId, 17);
  });

  it('sends a caller-stable UUID actionId with every fishing mutation', async () => {
    const client = new ApiClient('/api');
    const requests = [];
    client.post = async (endpoint, body) => {
      requests.push({ endpoint, body });
      return {};
    };

    await client.startFishing(42, ACTIONS[0]);
    await client.updateFishingGear(
      42,
      'session-1',
      { rodKey: 'riverwood_rod', tackleKey: 'earthworm' },
      ACTIONS[1]
    );
    await client.beginFishingCast(42, 'session-1', ACTIONS[2]);
    await client.releaseFishingCast(42, 'session-1', 'attempt-1', ACTIONS[3]);
    await client.hookFishingCast(42, 'session-1', 'attempt-1', ACTIONS[4]);
    await client.reelFishingCast(42, 'session-1', 'attempt-1', 'left', 2, ACTIONS[5]);
    await client.resolveFishingCast(42, 'session-1', 'attempt-1', ACTIONS[6]);

    assert.deepEqual(requests, [
      { endpoint: '/fishing/42/start', body: { actionId: ACTIONS[0] } },
      {
        endpoint: '/fishing/42/gear',
        body: {
          actionId: ACTIONS[1],
          sessionId: 'session-1',
          rodKey: 'riverwood_rod',
          tackleKey: 'earthworm'
        }
      },
      {
        endpoint: '/fishing/42/cast',
        body: { actionId: ACTIONS[2], sessionId: 'session-1' }
      },
      {
        endpoint: '/fishing/42/casts/attempt-1/release',
        body: { actionId: ACTIONS[3], sessionId: 'session-1' }
      },
      {
        endpoint: '/fishing/42/casts/attempt-1/hook',
        body: { actionId: ACTIONS[4], sessionId: 'session-1' }
      },
      {
        endpoint: '/fishing/42/casts/attempt-1/reel',
        body: {
          actionId: ACTIONS[5],
          sessionId: 'session-1',
          direction: 'left',
          cueIndex: 2
        }
      },
      {
        endpoint: '/fishing/42/casts/attempt-1/resolve',
        body: { actionId: ACTIONS[6], sessionId: 'session-1' }
      }
    ]);
  });

  it('generates RFC 4122 version-four IDs when no action ID is supplied', async () => {
    const generated = createFishingActionId();
    assert.match(
      generated,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    const client = new ApiClient('/api');
    let body;
    client.post = async (_endpoint, requestBody) => {
      body = requestBody;
      return {};
    };
    await client.endFishing(42, 'session-1');
    assert.match(
      body.actionId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    assert.equal(body.sessionId, 'session-1');
  });
});
