import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { caches: {} };

const { AssetCache } = await import('../AssetCache.js');

describe('AssetCache network freshness', () => {
  it('bypasses the browser HTTP cache on Cache API misses', async () => {
    const fetchCalls = [];
    const cachedResponses = [];
    const responseClone = { source: 'clone' };
    const response = {
      ok: true,
      clone() { return responseClone; }
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      fetchCalls.push(args);
      return response;
    };

    try {
      const assetCache = new AssetCache();
      assetCache.cache = {
        async match() { return undefined; },
        async put(url, cachedResponse) {
          cachedResponses.push({ url, cachedResponse });
        }
      };

      const result = await assetCache.fetchWithCache('/assets/tiles/forest/grass_0.webp');

      assert.equal(assetCache.cacheName, 'modia-assets-v3');
      assert.equal(result, response);
      assert.deepEqual(fetchCalls, [[
        '/assets/tiles/forest/grass_0.webp',
        { cache: 'no-store' }
      ]]);
      assert.deepEqual(cachedResponses, [{
        url: '/assets/tiles/forest/grass_0.webp',
        cachedResponse: responseClone
      }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
