import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../client.js';

describe('ApiClient world activities', () => {
  it('claims a chest at the selected node', async () => {
    const client = new ApiClient('/api');
    let request;

    client.post = async (endpoint, body) => {
      request = { endpoint, body };
      return { success: true };
    };

    await client.claimChest(42);

    assert.deepEqual(request, {
      endpoint: '/world/nodes/42/claim-chest',
      body: undefined
    });
  });

  it('visits a shrine at the selected node', async () => {
    const client = new ApiClient('/api');
    let request;

    client.post = async (endpoint, body) => {
      request = { endpoint, body };
      return { success: true };
    };

    await client.visitShrine(84);

    assert.deepEqual(request, {
      endpoint: '/world/nodes/84/visit-shrine',
      body: undefined
    });
  });
});
