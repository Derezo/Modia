/**
 * @module AssetCache
 * @description Persistent browser storage for game assets using the Cache API.
 *
 * Key responsibilities:
 * - Opens and manages a versioned cache for assets
 * - Provides cache-first fetching with network fallback
 * - Clears old cache versions on initialization
 * - Reports cache storage estimates for debugging
 *
 * The Cache API persists assets across browser sessions, reducing load times
 * for returning players. The in-memory Map in AssetLoader remains for hot access
 * during gameplay.
 *
 * @see AssetLoader.js - Uses this for persistent storage
 */

export class AssetCache {
  constructor() {
    // v3 invalidates caches that may have been repopulated from the browser's
    // immutable HTTP cache after the canonical tile rebuild.
    // v4 invalidates same-URL player/NPC strips replaced during the animation
    // and visual-identity repair. Without a version bump, Cache API entries
    // survive a page refresh and can hide the corrected artwork indefinitely.
    this.cacheName = 'modia-assets-v4';
    this.cache = null;
    this.available = 'caches' in window;
  }

  /**
   * Initialize the asset cache
   * Opens the cache and clears old versions
   * @returns {Promise<boolean>} True if cache initialized successfully
   */
  async init() {
    if (!this.available) {
      console.warn('[AssetCache] Cache API not available in this browser');
      return false;
    }

    try {
      // Clear old cache versions before opening current
      await this.clearOldCaches();

      // Open the current cache
      this.cache = await caches.open(this.cacheName);
      console.log('[AssetCache] Initialized cache:', this.cacheName);
      return true;
    } catch (error) {
      console.error('[AssetCache] Failed to initialize:', error);
      this.available = false;
      return false;
    }
  }

  /**
   * Fetch a resource with cache-first strategy
   * Checks cache first, falls back to network, stores result in cache
   * @param {string} url - URL to fetch
   * @returns {Promise<Response>} Response from cache or network
   */
  async fetchWithCache(url) {
    // Cache API is the authoritative persistent asset cache. Bypass the
    // browser HTTP cache on a miss so an immutable, same-URL response cannot
    // repopulate it with an older terrain build.
    if (!this.available || !this.cache) {
      return fetch(url, { cache: 'no-store' });
    }

    try {
      // Check cache first
      const cachedResponse = await this.cache.match(url);
      if (cachedResponse) {
        return cachedResponse;
      }

      // Fetch from network
      const networkResponse = await fetch(url, { cache: 'no-store' });

      // Only cache successful responses
      if (networkResponse.ok) {
        // Clone the response since we need to return it AND store it
        // (Response body can only be read once)
        const responseToCache = networkResponse.clone();

        // Store in cache asynchronously (don't await to avoid blocking)
        this.cache.put(url, responseToCache).catch(err => {
          console.warn('[AssetCache] Failed to cache:', url, err.message);
        });
      }

      return networkResponse;
    } catch (error) {
      // If network fails, try cache as last resort (stale-while-error)
      const cachedResponse = await this.cache.match(url);
      if (cachedResponse) {
        console.log('[AssetCache] Serving stale from cache:', url);
        return cachedResponse;
      }
      throw error;
    }
  }

  /**
   * Fetch and verify an immutable BattleMapV3 asset as raw bytes.
   *
   * Unlike the legacy cache-first path, bytes are never persisted until their
   * WebCrypto SHA-256 digest matches the authoritative asset reference.
   * Corrupt persistent entries are evicted and retried from the network.
   *
   * @param {{immutableUrl: string, contentHash: string}} asset
   * @returns {Promise<Uint8Array>}
   */
  async fetchVerifiedBytes(asset) {
    const { immutableUrl, contentHash } = asset ?? {};
    if (typeof immutableUrl !== 'string' || immutableUrl.length === 0 ||
        !/^sha256:[a-f0-9]{64}$/.test(contentHash ?? '')) {
      throw new TypeError('BattleMapV3 asset reference is invalid');
    }

    const verifyResponse = async response => {
      const bytes = new Uint8Array(await response.arrayBuffer());
      await verifyBattleMapV3Sha256(bytes, contentHash, immutableUrl);
      return bytes;
    };

    if (this.available && this.cache) {
      const cachedResponse = await this.cache.match(immutableUrl);
      if (cachedResponse) {
        try {
          return await verifyResponse(cachedResponse);
        } catch (error) {
          await this.cache.delete(immutableUrl);
          if (!(error instanceof BattleMapV3AssetIntegrityError)) throw error;
        }
      }
    }

    const networkResponse = await fetch(immutableUrl, { cache: 'no-store' });
    if (!networkResponse.ok) {
      throw new Error(
        `BattleMapV3 asset request failed (${networkResponse.status}): ${immutableUrl}`
      );
    }

    const bytes = await verifyResponse(networkResponse);
    if (this.available && this.cache) {
      const headers = new Headers(networkResponse.headers);
      try {
        await this.cache.put(
          immutableUrl,
          new Response(bytes, { status: 200, headers })
        );
      } catch (error) {
        console.warn(
          '[AssetCache] Failed to cache verified BattleMapV3 asset:',
          immutableUrl,
          error.message
        );
      }
    }
    return bytes;
  }

  /**
   * Clear old cache versions
   * Removes any caches with 'modia-assets-' prefix but different version number
   * @returns {Promise<void>}
   */
  async clearOldCaches() {
    if (!this.available) return;

    try {
      const cacheNames = await caches.keys();
      const oldCaches = cacheNames.filter(name =>
        name.startsWith('modia-assets-') && name !== this.cacheName
      );

      if (oldCaches.length > 0) {
        console.log('[AssetCache] Clearing old caches:', oldCaches);
        await Promise.all(oldCaches.map(name => caches.delete(name)));
      }
    } catch (error) {
      console.warn('[AssetCache] Failed to clear old caches:', error);
    }
  }

  /**
   * Get storage estimate for debugging
   * @returns {Promise<{usage: number, quota: number, usagePercent: string}|null>}
   */
  async getStorageEstimate() {
    if (!navigator.storage || !navigator.storage.estimate) {
      console.warn('[AssetCache] Storage API not available');
      return null;
    }

    try {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 0;
      const usagePercent = quota > 0
        ? ((usage / quota) * 100).toFixed(2) + '%'
        : 'unknown';

      return {
        usage,
        quota,
        usagePercent,
        usageMB: (usage / (1024 * 1024)).toFixed(2) + ' MB',
        quotaMB: (quota / (1024 * 1024)).toFixed(2) + ' MB'
      };
    } catch (error) {
      console.warn('[AssetCache] Failed to get storage estimate:', error);
      return null;
    }
  }

  /**
   * Check if a URL is in the cache
   * @param {string} url - URL to check
   * @returns {Promise<boolean>}
   */
  async has(url) {
    if (!this.available || !this.cache) return false;

    try {
      const response = await this.cache.match(url);
      return response !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Remove a specific URL from the cache
   * @param {string} url - URL to remove
   * @returns {Promise<boolean>} True if deleted
   */
  async delete(url) {
    if (!this.available || !this.cache) return false;

    try {
      return await this.cache.delete(url);
    } catch (error) {
      console.warn('[AssetCache] Failed to delete:', url, error);
      return false;
    }
  }

  /**
   * Clear the entire cache
   * @returns {Promise<boolean>} True if cleared
   */
  async clear() {
    if (!this.available) return false;

    try {
      const deleted = await caches.delete(this.cacheName);
      if (deleted) {
        // Reopen an empty cache
        this.cache = await caches.open(this.cacheName);
        console.log('[AssetCache] Cache cleared');
      }
      return deleted;
    } catch (error) {
      console.warn('[AssetCache] Failed to clear cache:', error);
      return false;
    }
  }

  /**
   * Check if the cache is available
   * @returns {boolean}
   */
  isAvailable() {
    return this.available && this.cache !== null;
  }
}

export class BattleMapV3AssetIntegrityError extends Error {
  constructor(url, expected, actual) {
    super(
      `BattleMapV3 asset integrity check failed for ${url}: ` +
      `expected ${expected}, received ${actual}`
    );
    this.name = 'BattleMapV3AssetIntegrityError';
    this.code = 'BATTLE_MAP_V3_ASSET_INTEGRITY_FAILED';
    this.url = url;
    this.expected = expected;
    this.actual = actual;
  }
}

async function verifyBattleMapV3Sha256(bytes, expected, url) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto SHA-256 is required for BattleMapV3 assets');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const actual = 'sha256:' + Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');
  if (actual !== expected) {
    throw new BattleMapV3AssetIntegrityError(url, expected, actual);
  }
}

// Export singleton instance
export const assetCache = new AssetCache();
