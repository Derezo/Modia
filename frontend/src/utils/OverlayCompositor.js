/**
 * OverlayCompositor - Composites item sprites with rarity and augment overlays
 *
 * Provides async compositing of item base sprites with overlay effects.
 * Uses canvas for layer compositing with additive blending for glow effects.
 *
 * Usage:
 *   import { overlayCompositor } from '../utils/OverlayCompositor.js';
 *
 *   const dataUrl = await overlayCompositor.composite({
 *     spriteId: 'sword_short',
 *     subcategory: 'weapons',
 *     size: 64,
 *     rarity: 'epic',
 *     augments: ['fire']
 *   });
 */

import { getAssetPath, getOptimalSize } from '@shared/assetPaths.js';

/**
 * Rarity overlay alpha values for compositing
 * Higher rarity = more visible glow effect
 */
const RARITY_ALPHA = {
  common: 0,
  uncommon: 0.5,
  rare: 0.65,
  epic: 0.75,
  legendary: 0.85
};

/**
 * Map rarity numbers to names
 */
const RARITY_MAP = {
  1: 'common',
  2: 'uncommon',
  3: 'rare',
  4: 'epic',
  5: 'legendary'
};

/**
 * Standard overlay size for asset loading
 */
const OVERLAY_ASSET_SIZE = 128;

/**
 * Base path for assets
 */
const ASSETS_BASE = '/assets';

class OverlayCompositor {
  constructor() {
    this.cache = new Map();
    this.loading = new Map();
  }

  /**
   * Load an image with caching and deduplication
   * @param {string} src - Image source URL
   * @returns {Promise<HTMLImageElement>}
   * @private
   */
  async loadImage(src) {
    if (this.cache.has(src)) {
      return this.cache.get(src);
    }

    if (this.loading.has(src)) {
      return this.loading.get(src);
    }

    const loadPromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.cache.set(src, img);
        this.loading.delete(src);
        resolve(img);
      };
      img.onerror = () => {
        this.loading.delete(src);
        reject(new Error(`Failed to load image: ${src}`));
      };
      img.src = src;
    });

    this.loading.set(src, loadPromise);
    return loadPromise;
  }

  /**
   * Normalize rarity to string format
   * @param {string|number} rarity - Rarity value (name or number 1-5)
   * @returns {string} Rarity name
   * @private
   */
  normalizeRarity(rarity) {
    if (typeof rarity === 'number') {
      return RARITY_MAP[rarity] || 'common';
    }
    return rarity || 'common';
  }

  /**
   * Composite an item sprite with rarity and augment overlays
   *
   * @param {Object} options - Compositing options
   * @param {string} options.spriteId - Item sprite ID (e.g., 'sword_short')
   * @param {string} options.subcategory - Item subcategory (weapons, armor, accessories, consumables)
   * @param {number} [options.size=64] - Output size in pixels
   * @param {string|number} [options.rarity='common'] - Rarity for glow overlay
   * @param {string[]} [options.augments=[]] - Array of augment types (fire, ice, etc.)
   * @returns {Promise<string>} Data URL of composited image
   */
  async composite(options) {
    const {
      spriteId,
      subcategory,
      size = 64,
      rarity = 'common',
      augments = []
    } = options;

    const normalizedRarity = this.normalizeRarity(rarity);

    // Generate cache key for this specific combination
    const augmentKey = augments.length > 0 ? augments.sort().join('_') : 'none';
    const cacheKey = `composite_${spriteId}_${subcategory}_${size}_${normalizedRarity}_${augmentKey}`;

    // Return cached result if available
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Determine optimal asset size for loading
    const assetSize = getOptimalSize('items', size);

    // Load base item sprite
    const basePath = getAssetPath('items', spriteId, {
      subcategory,
      size: assetSize
    });

    let baseImage;
    try {
      baseImage = await this.loadImage(basePath);
    } catch (error) {
      console.warn(`[OverlayCompositor] Failed to load base sprite: ${basePath}`);
      throw error;
    }

    // Load rarity overlay if not common
    let rarityOverlay = null;
    if (normalizedRarity && normalizedRarity !== 'common') {
      const rarityPath = `${ASSETS_BASE}/overlays/${OVERLAY_ASSET_SIZE}/rarity/rarity_${normalizedRarity}.webp`;
      try {
        rarityOverlay = await this.loadImage(rarityPath);
      } catch {
        // Rarity overlay is optional
      }
    }

    // Load augment overlays
    const augmentOverlays = [];
    for (const augment of augments) {
      if (augment) {
        const augmentPath = `${ASSETS_BASE}/overlays/${OVERLAY_ASSET_SIZE}/augments/augment_${augment}.webp`;
        try {
          const overlay = await this.loadImage(augmentPath);
          augmentOverlays.push(overlay);
        } catch {
          // Augment overlay is optional
        }
      }
    }

    // Compose the final sprite
    const dataUrl = this.composeSprite(
      baseImage,
      rarityOverlay,
      augmentOverlays,
      normalizedRarity,
      size
    );

    // Cache the result
    this.cache.set(cacheKey, dataUrl);

    return dataUrl;
  }

  /**
   * Compose layers into a single sprite
   *
   * @param {HTMLImageElement} base - Base item sprite
   * @param {HTMLImageElement|null} rarityOverlay - Rarity glow overlay
   * @param {HTMLImageElement[]} augmentOverlays - Augment effect overlays
   * @param {string} rarity - Rarity level for alpha calculation
   * @param {number} size - Output size in pixels
   * @returns {string} Data URL of composited image
   * @private
   */
  composeSprite(base, rarityOverlay, augmentOverlays, rarity, size) {
    // Create offscreen canvas at target size
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Clear canvas
    ctx.clearRect(0, 0, size, size);

    // Draw base sprite with normal blend mode
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1.0;
    ctx.imageSmoothingEnabled = false; // Preserve pixel art
    ctx.drawImage(base, 0, 0, size, size);

    // Apply rarity overlay with additive blend
    if (rarityOverlay) {
      const rarityAlpha = RARITY_ALPHA[rarity] || 0;
      if (rarityAlpha > 0) {
        ctx.globalAlpha = rarityAlpha;
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(rarityOverlay, 0, 0, size, size);
      }
    }

    // Apply augment overlays with additive blend
    for (const augmentOverlay of augmentOverlays) {
      ctx.globalAlpha = 0.6;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(augmentOverlay, 0, 0, size, size);
    }

    // Reset context state
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';

    return canvas.toDataURL('image/png');
  }

  /**
   * Preload overlay assets for faster compositing
   * @returns {Promise<void>}
   */
  async preloadOverlays() {
    const rarities = ['uncommon', 'rare', 'epic', 'legendary'];
    const augments = [
      // Elemental augments
      'fire', 'ice', 'lightning', 'poison', 'holy', 'dark', 'earth', 'wind',
      // Combat augments
      'critical', 'lifesteal', 'speed', 'pierce', 'stun', 'chain',
      // Special augments
      'arcane', 'fortune', 'vitality', 'slayer'
    ];

    const promises = [
      ...rarities.map(rarity =>
        this.loadImage(`${ASSETS_BASE}/overlays/${OVERLAY_ASSET_SIZE}/rarity/rarity_${rarity}.webp`)
          .catch(() => null)
      ),
      ...augments.map(augment =>
        this.loadImage(`${ASSETS_BASE}/overlays/${OVERLAY_ASSET_SIZE}/augments/augment_${augment}.webp`)
          .catch(() => null)
      )
    ];

    await Promise.allSettled(promises);
  }

  /**
   * Clear the compositor cache
   */
  clearCache() {
    this.cache.clear();
    this.loading.clear();
  }

  /**
   * Get cache statistics
   * @returns {{cachedImages: number, loadingImages: number}}
   */
  getStats() {
    return {
      cachedImages: this.cache.size,
      loadingImages: this.loading.size
    };
  }
}

// Export singleton instance
export const overlayCompositor = new OverlayCompositor();

// Also export class for testing
export { OverlayCompositor };
