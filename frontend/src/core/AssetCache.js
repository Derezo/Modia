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
    this.cacheName = 'modia-assets-v1';
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
    // If Cache API not available, fall back to regular fetch
    if (!this.available || !this.cache) {
      return fetch(url);
    }

    try {
      // Check cache first
      const cachedResponse = await this.cache.match(url);
      if (cachedResponse) {
        return cachedResponse;
      }

      // Fetch from network
      const networkResponse = await fetch(url);

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

// Export singleton instance
export const assetCache = new AssetCache();
