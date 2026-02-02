/**
 * IconLoader - Icon loading and caching utility
 *
 * Handles loading PNG icons at appropriate sizes and caching them for reuse.
 * Works with the icon generation pipeline that produces multiple size variants.
 *
 * Usage:
 *   import { iconLoader } from './core/IconLoader.js';
 *
 *   // Async load (returns Promise<HTMLImageElement>)
 *   const img = await iconLoader.load('menu', 'formation', 24);
 *
 *   // Sync get from cache (returns HTMLImageElement or null)
 *   const cached = iconLoader.get('menu', 'formation', 24);
 *
 *   // Preload multiple icons
 *   await iconLoader.preloadCategory('menu', ['formation', 'inventory', 'settings']);
 */

import { getAssetPath, SIZE_PRESETS } from '@shared/assetPaths.js';

/** Available PNG sizes from the generation script */
const AVAILABLE_SIZES = SIZE_PRESETS.icons;

export class IconLoader {
  constructor() {
    /** @type {Map<string, HTMLImageElement>} Cache of loaded icon images */
    this.cache = new Map();

    /** @type {Map<string, Promise<HTMLImageElement>>} Pending load promises */
    this.pending = new Map();

    /** @type {Set<string>} Set of icons that failed to load */
    this.failedIcons = new Set();
  }

  /**
   * Get the optimal available size for a requested size
   * Returns the smallest available size that is >= requested size,
   * or the largest available if requested is larger than all options.
   *
   * @param {number} requestedSize - Desired icon size in pixels
   * @returns {number} Optimal available size
   */
  getOptimalSize(requestedSize) {
    const availableSizes = SIZE_PRESETS.icons;
    // Find smallest size >= requested
    for (const size of availableSizes) {
      if (size >= requestedSize) {
        return size;
      }
    }
    // Return largest if requested is bigger than all options
    return availableSizes[availableSizes.length - 1];
  }

  /**
   * Normalize icon name for file lookup
   * Icon files use snake_case (e.g., magic_dark.webp), so names are passed through unchanged.
   * @param {string} name - Icon name
   * @returns {string} Normalized name (unchanged)
   */
  normalizeName(name) {
    // Icon files use snake_case, so pass through unchanged
    return name;
  }

  /**
   * Build cache key for an icon
   * @param {string} category - Icon category (e.g., 'menu', 'action')
   * @param {string} name - Icon name (e.g., 'formation', 'attack')
   * @param {number} size - Icon size in pixels
   * @returns {string} Cache key
   */
  getCacheKey(category, name, size) {
    const normalizedName = this.normalizeName(name);
    return `${category}-${normalizedName}@${size}`;
  }

  /**
   * Build URL path for an icon
   * @param {string} category - Icon category
   * @param {string} name - Icon name. Accepts either snake_case (from code constants)
   *                        or kebab-case (matching file names). Internally normalized
   *                        to kebab-case to match file naming convention.
   * @param {number} size - Icon size
   * @returns {string} URL path
   */
  getIconPath(category, name, size) {
    const normalizedName = this.normalizeName(name);
    const optimalSize = this.getOptimalSize(size);

    return getAssetPath('icons', normalizedName, {
      subcategory: category,
      size: optimalSize,
      useLegacyPath: true
    });
  }

  /**
   * Load an icon image asynchronously
   * Returns cached image if available, otherwise loads and caches.
   *
   * @param {string} category - Icon category (e.g., 'menu', 'action')
   * @param {string} name - Icon name (e.g., 'formation', 'attack')
   * @param {number} [size=24] - Desired icon size in pixels
   * @returns {Promise<HTMLImageElement>} Loaded image element
   */
  async load(category, name, size = 24) {
    const optimalSize = this.getOptimalSize(size);
    const cacheKey = this.getCacheKey(category, name, optimalSize);

    // Return cached image
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Return pending promise if already loading
    if (this.pending.has(cacheKey)) {
      return this.pending.get(cacheKey);
    }

    // Check if previously failed
    if (this.failedIcons.has(cacheKey)) {
      return Promise.reject(new Error(`Icon previously failed to load: ${cacheKey}`));
    }

    // Create load promise
    const loadPromise = new Promise((resolve, reject) => {
      const img = new Image();
      const iconPath = this.getIconPath(category, name, optimalSize);

      img.onload = () => {
        this.cache.set(cacheKey, img);
        this.pending.delete(cacheKey);
        resolve(img);
      };

      img.onerror = () => {
        this.pending.delete(cacheKey);
        this.failedIcons.add(cacheKey);
        reject(new Error(`Failed to load icon: ${iconPath}`));
      };

      img.src = iconPath;
    });

    this.pending.set(cacheKey, loadPromise);
    return loadPromise;
  }

  /**
   * Synchronously get an icon from cache
   * Returns null if icon is not cached.
   *
   * @param {string} category - Icon category
   * @param {string} name - Icon name
   * @param {number} [size=24] - Desired icon size in pixels
   * @returns {HTMLImageElement|null} Cached image or null
   */
  get(category, name, size = 24) {
    const optimalSize = this.getOptimalSize(size);
    const cacheKey = this.getCacheKey(category, name, optimalSize);
    return this.cache.get(cacheKey) || null;
  }

  /**
   * Check if an icon is loaded in cache
   * @param {string} category - Icon category
   * @param {string} name - Icon name
   * @param {number} [size=24] - Desired icon size in pixels
   * @returns {boolean} True if icon is cached
   */
  has(category, name, size = 24) {
    const optimalSize = this.getOptimalSize(size);
    const cacheKey = this.getCacheKey(category, name, optimalSize);
    return this.cache.has(cacheKey);
  }

  /**
   * Preload multiple icons from a category
   * Useful for batch loading icons needed by a scene.
   *
   * @param {string} category - Icon category
   * @param {string[]} names - Array of icon names to preload
   * @param {number} [size=24] - Desired icon size
   * @returns {Promise<Map<string, HTMLImageElement>>} Map of name to loaded image
   */
  async preloadCategory(category, names, size = 24) {
    const results = new Map();

    const loadPromises = names.map(async (name) => {
      try {
        const img = await this.load(category, name, size);
        results.set(name, img);
      } catch (err) {
        console.warn(`Failed to preload icon ${category}-${name}:`, err.message);
      }
    });

    await Promise.all(loadPromises);
    return results;
  }

  /**
   * Preload icons at multiple sizes
   * Useful for responsive icons that may need different sizes.
   *
   * @param {string} category - Icon category
   * @param {string} name - Icon name
   * @param {number[]} [sizes=AVAILABLE_SIZES] - Sizes to preload
   * @returns {Promise<Map<number, HTMLImageElement>>} Map of size to loaded image
   */
  async preloadSizes(category, name, sizes = AVAILABLE_SIZES) {
    const results = new Map();

    const loadPromises = sizes.map(async (size) => {
      try {
        const img = await this.load(category, name, size);
        results.set(size, img);
      } catch (err) {
        console.warn(`Failed to preload ${category}-${name}@${size}:`, err.message);
      }
    });

    await Promise.all(loadPromises);
    return results;
  }

  /**
   * Clear specific icon from cache
   * @param {string} category - Icon category
   * @param {string} name - Icon name
   * @param {number} [size] - Specific size to clear, or all sizes if omitted
   */
  clear(category, name, size) {
    if (size !== undefined) {
      const optimalSize = this.getOptimalSize(size);
      const cacheKey = this.getCacheKey(category, name, optimalSize);
      this.cache.delete(cacheKey);
      this.failedIcons.delete(cacheKey);
    } else {
      // Clear all sizes
      for (const s of AVAILABLE_SIZES) {
        const cacheKey = this.getCacheKey(category, name, s);
        this.cache.delete(cacheKey);
        this.failedIcons.delete(cacheKey);
      }
    }
  }

  /**
   * Clear entire cache
   */
  clearAll() {
    this.cache.clear();
    this.pending.clear();
    this.failedIcons.clear();
  }

  /**
   * Get cache statistics
   * @returns {{cached: number, pending: number, failed: number}} Cache stats
   */
  getStats() {
    return {
      cached: this.cache.size,
      pending: this.pending.size,
      failed: this.failedIcons.size
    };
  }
}

/**
 * Singleton instance of IconLoader
 * Import this for icon loading throughout the app.
 */
export const iconLoader = new IconLoader();
