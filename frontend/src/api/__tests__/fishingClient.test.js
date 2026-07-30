import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../client.js';

describe('ApiClient fishing session protocol', () => {
  it('includes the session identity in every session mutation', async () => {
    const client = new ApiClient('/api');
    const requests = [];

    client.post = async (endpoint, body) => {
      requests.push({ endpoint, body });
      return { success: true };
    };

    await client.registerCatch(42, 'session-123');
    await client.claimBigOne(42, 'session-123');
    await client.endFishing(42, 'session-123');

    assert.deepEqual(requests, [
      {
        endpoint: '/fishing/42/catch',
        body: { sessionId: 'session-123' }
      },
      {
        endpoint: '/fishing/42/big-one',
        body: { sessionId: 'session-123' }
      },
      {
        endpoint: '/fishing/42/end',
        body: { sessionId: 'session-123' }
      }
    ]);
  });

  it('supports node-specific hydration and user-wide refresh recovery', async () => {
    const client = new ApiClient('/api');
    const endpoints = [];

    client.get = async endpoint => {
      endpoints.push(endpoint);
      return { active: false };
    };

    await client.getFishingStatus(42);
    await client.getActiveFishingStatus();

    assert.deepEqual(endpoints, [
      '/fishing/42/status',
      '/fishing/status'
    ]);
  });
});
