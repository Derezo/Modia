import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

globalThis.window = { caches: {} };
globalThis.crypto ??= webcrypto;

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

      assert.equal(assetCache.cacheName, 'modia-assets-v4');
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

  it('verifies V3 raw bytes before placing them in persistent cache', async () => {
    const bytes = new TextEncoder().encode('verified-v3-image');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const contentHash = 'sha256:' +
      Array.from(new Uint8Array(digest), byte =>
        byte.toString(16).padStart(2, '0')
      ).join('');
    const puts = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(bytes, {
      status: 200,
      headers: { 'content-type': 'image/webp' }
    });

    try {
      const cache = new AssetCache();
      cache.cache = {
        async match() { return undefined; },
        async put(url, response) {
          puts.push([url, new Uint8Array(await response.arrayBuffer())]);
        }
      };

      const result = await cache.fetchVerifiedBytes({
        immutableUrl: '/assets/v3/surface.webp',
        contentHash
      });

      assert.deepEqual(result, bytes);
      assert.equal(puts.length, 1);
      assert.equal(puts[0][0], '/assets/v3/surface.webp');
      assert.deepEqual(puts[0][1], bytes);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects corrupt V3 network bytes without caching them', async () => {
    const puts = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      new TextEncoder().encode('corrupt'),
      { status: 200 }
    );

    try {
      const cache = new AssetCache();
      cache.cache = {
        async match() { return undefined; },
        async put(...args) { puts.push(args); }
      };

      await assert.rejects(
        cache.fetchVerifiedBytes({
          immutableUrl: '/assets/v3/corrupt.webp',
          contentHash: `sha256:${'0'.repeat(64)}`
        }),
        error => error.code === 'BATTLE_MAP_V3_ASSET_INTEGRITY_FAILED'
      );
      assert.deepEqual(puts, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
