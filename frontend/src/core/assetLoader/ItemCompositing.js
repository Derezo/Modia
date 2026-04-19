/**
 * @module ItemCompositing
 * @description Item sprite compositing with rarity and augment overlays.
 *
 * Key responsibilities:
 * - Loading base item sprites
 * - Compositing rarity glow overlays
 * - Compositing augment effect overlays
 * - Caching composited results
 *
 * @see AssetLoader.js - Main orchestrator that delegates to this module
 */

/**
 * Rarity overlay alpha values for compositing
 * Higher rarity = more visible glow effect
 */
export const RARITY_ALPHA = {
  common: 0,        // No overlay for common items
  uncommon: 0.5,
  rare: 0.65,
  epic: 0.75,
  legendary: 0.85
};

/**
 * Standard overlay size for item compositing
 */
export const COMPOSITE_SIZE = 128;

/**
 * Load and composite an item sprite with rarity and augment overlays
 * @param {Object} context - AssetLoader context with cache and loadImage
 * @param {string} basePath - Base asset path
 * @param {string} itemId - Item template identifier
 * @param {string} category - Item category (weapons, armor, accessories, etc.)
 * @param {string} [rarity='common'] - Item rarity (common, uncommon, rare, epic, legendary)
 * @param {string|null} [augment=null] - Augment type (fire, ice, lightning, poison, holy, dark)
 * @returns {Promise<HTMLImageElement|null>} Composited item image or null if base not found
 */
export async function loadItemComposite(context, basePath, itemId, category, rarity = 'common', augment = null) {
  const { cache, loadImage } = context;

  // Generate cache key for this specific combination
  const cacheKey = `item_${itemId}_${rarity}_${augment || 'none'}`;

  // Return cached composite if available
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  // Load base item sprite
  const baseItemPath = `${basePath}/items/${category}/${itemId}.webp`;
  let baseImage;
  try {
    baseImage = await loadImage(baseItemPath);
  } catch {
    console.warn(`[ItemCompositing] Failed to load base item: ${baseItemPath}`);
    return null;
  }

  // Load rarity overlay if not common
  let rarityOverlay = null;
  if (rarity && rarity !== 'common') {
    const size = COMPOSITE_SIZE;
    const rarityPath = `${basePath}/overlays/${size}/rarity/rarity_${rarity}.webp`;
    try {
      rarityOverlay = await loadImage(rarityPath);
    } catch {
      console.warn(`[ItemCompositing] Rarity overlay not found: ${rarityPath}`);
    }
  }

  // Load augment overlay if specified
  let augmentOverlay = null;
  if (augment) {
    const size = COMPOSITE_SIZE;
    const augmentPath = `${basePath}/overlays/${size}/augments/augment_${augment}.webp`;
    try {
      augmentOverlay = await loadImage(augmentPath);
    } catch {
      console.warn(`[ItemCompositing] Augment overlay not found: ${augmentPath}`);
    }
  }

  // Compose the final sprite
  const composite = composeItemSprite(baseImage, rarityOverlay, augmentOverlay, rarity);

  // Cache the composited image
  cache.set(cacheKey, composite);

  return composite;
}

/**
 * Compose an item sprite with rarity and augment overlays using canvas
 * @param {HTMLImageElement} base - Base item sprite
 * @param {HTMLImageElement|null} rarityOverlay - Rarity glow overlay
 * @param {HTMLImageElement|null} augmentOverlay - Augment effect overlay
 * @param {string} rarity - Rarity level for alpha calculation
 * @returns {HTMLImageElement} Composited image
 */
export function composeItemSprite(base, rarityOverlay, augmentOverlay, rarity) {
  const size = COMPOSITE_SIZE;

  // Create offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Clear canvas
  ctx.clearRect(0, 0, size, size);

  // Draw base sprite with normal blend mode
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1.0;
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

  // Apply augment overlay with additive blend
  if (augmentOverlay) {
    ctx.globalAlpha = 0.6;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(augmentOverlay, 0, 0, size, size);
  }

  // Reset context state
  ctx.globalAlpha = 1.0;
  ctx.globalCompositeOperation = 'source-over';

  // Convert canvas to Image
  const compositeImage = new Image();
  compositeImage.src = canvas.toDataURL('image/png');

  return compositeImage;
}

/**
 * Get cached item composite (sync version)
 * Returns null if the composite is not in cache
 * @param {Map} cache - Cache map
 * @param {string} itemId - Item template identifier
 * @param {string} [rarity='common'] - Item rarity
 * @param {string|null} [augment=null] - Augment type
 * @returns {HTMLImageElement|null} Cached composite or null
 */
export function getItemComposite(cache, itemId, rarity = 'common', augment = null) {
  const cacheKey = `item_${itemId}_${rarity}_${augment || 'none'}`;
  return cache.get(cacheKey) || null;
}

/**
 * Preload all overlay assets (rarity and augment overlays)
 * Call this during initial asset loading to ensure overlays are ready
 * @param {Function} loadImage - Image loading function
 * @param {string} basePath - Base asset path
 * @returns {Promise<PromiseSettledResult<HTMLImageElement>[]>}
 */
export async function preloadOverlays(loadImage, basePath) {
  const rarities = ['uncommon', 'rare', 'epic', 'legendary'];
  const augments = [
    // Elemental augments
    'fire', 'ice', 'lightning', 'poison', 'holy', 'dark', 'earth', 'wind',
    // Combat augments
    'critical', 'lifesteal', 'speed', 'pierce', 'stun', 'chain',
    // Special augments
    'arcane', 'fortune', 'vitality', 'slayer'
  ];

  const size = COMPOSITE_SIZE;
  const promises = [
    // Preload rarity overlays
    ...rarities.map(rarity =>
      loadImage(`${basePath}/overlays/${size}/rarity/rarity_${rarity}.webp`)
        .catch(() => null) // Don't fail if overlay doesn't exist
    ),
    // Preload augment overlays
    ...augments.map(augment =>
      loadImage(`${basePath}/overlays/${size}/augments/augment_${augment}.webp`)
        .catch(() => null) // Don't fail if overlay doesn't exist
    )
  ];

  const results = await Promise.allSettled(promises);
  const loaded = results.filter(r => r.status === 'fulfilled' && r.value).length;
  console.log(`[ItemCompositing] Overlay preload: ${loaded}/${results.length} loaded`);
  return results;
}

/**
 * Preload item composites for a list of items
 * Useful for preloading inventory or shop items
 * @param {Object} context - AssetLoader context with cache and loadImage
 * @param {string} basePath - Base asset path
 * @param {Array<{itemId: string, category: string, rarity?: string, augment?: string}>} items
 * @returns {Promise<PromiseSettledResult<HTMLImageElement>[]>}
 */
export async function preloadItemComposites(context, basePath, items) {
  const promises = items.map(item =>
    loadItemComposite(
      context,
      basePath,
      item.itemId,
      item.category,
      item.rarity || 'common',
      item.augment || null
    )
  );

  const results = await Promise.allSettled(promises);
  const loaded = results.filter(r => r.status === 'fulfilled' && r.value).length;
  console.log(`[ItemCompositing] Item composite preload: ${loaded}/${results.length} loaded`);
  return results;
}
