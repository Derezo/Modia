import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ApiClient } from '../client.js';

describe('ApiClient ruins solution submission', () => {
  it('submits the replayable move sequence instead of a client move count', async () => {
    const client = new ApiClient('/api');
    const moves = [7, 8, 5];
    const puzzleVersion = 1;
    let request;

    client.post = async (endpoint, body) => {
      request = { endpoint, body };
      return { success: true };
    };

    await client.solveRuinsPuzzle(42, moves, puzzleVersion);

    assert.deepStrictEqual(request, {
      endpoint: '/ruins/42/solve',
      body: { moves, puzzleVersion }
    });
    assert.strictEqual(request.body.moveCount, undefined);
  });
});
