/**
 * ItemIcon - Item graphics component with correct asset path resolution
 *
 * Dedicated component for rendering item sprites (weapons, armor, accessories,
 * consumables). Uses the items asset pipeline path structure:
 *   /assets/items/{size}/{subcategory}/{sprite_id}.webp
 *
 * Unlike Icon which uses /assets/icons/png/{size}/{category}/{name}.webp,
 * ItemIcon uses the items asset structure with proper subcategory mapping.
 *
 * Usage:
 *   // Basic usage with sprite_id from item template
 *   ItemIcon.html({ spriteId: 'sword_short', itemType: 'weapon', rarity: 'rare' })
 *
 *   // With size specification
 *   ItemIcon.html({ spriteId: 'armor_leather', itemType: 'armor', size: 'lg' })
 *
 *   // Full item object
 *   ItemIcon.html({ item: inventoryItem, size: 'md' })
 */

import { getAssetPath, getOptimalSize } from '../../../shared/assetPaths.js';
import { responsive } from '../core/Responsive.js';
import { overlayCompositor } from '../utils/OverlayCompositor.js';
import { installImageFallbackHandler } from '../utils/imageFallback.js';

/**
 * Size mappings matching Icon component for consistency
 */
const SIZE_MAP = {
  sm: { mobile: 24, tablet: 24, desktop: 24 },
  md: { mobile: 32, tablet: 32, desktop: 32 },
  lg: { mobile: 48, tablet: 48, desktop: 48 },
  xl: { mobile: 64, tablet: 64, desktop: 64 }
};

/**
 * Map item_type to asset subcategory
 * @param {string} itemType - Item type from template
 * @returns {string} Subcategory for asset path
 */
function getSubcategory(itemType) {
  if (!itemType) return 'weapons';

  const type = itemType.toLowerCase();

  // Weapon types
  if (['weapon', 'sword', 'axe', 'staff', 'wand', 'bow', 'dagger', 'mace', 'polearm', 'fist'].includes(type)) {
    return 'weapons';
  }

  // Armor types
  if (['armor', 'helmet', 'helm', 'body', 'boots', 'head', 'legs', 'feet', 'robe', 'shield'].includes(type)) {
    return 'armor';
  }

  // Accessory types
  if (['accessory', 'ring', 'amulet', 'cloak', 'belt', 'gloves', 'gauntlets'].includes(type)) {
    return 'accessories';
  }

  // Consumable types
  if (['consumable', 'potion', 'scroll', 'material', 'food', 'key_item', 'misc'].includes(type)) {
    return 'consumables';
  }

  // Default to weapons
  return 'weapons';
}

/**
 * Get optimal asset size for display size
 * Uses the centralized getOptimalSize from assetPaths.js
 * @param {number} displaySize - Target display size in pixels
 * @returns {number} Best available asset size
 */
function getOptimalAssetSize(displaySize) {
  return getOptimalSize('items', displaySize);
}

/**
 * Get pixel size for current breakpoint
 * @param {string} sizeKey - Size key (sm, md, lg, xl)
 * @returns {number} Size in pixels
 */
function getPixelSize(sizeKey) {
  const sizeConfig = SIZE_MAP[sizeKey] || SIZE_MAP.md;
  const breakpoint = responsive.currentBreakpoint || 'desktop';
  return sizeConfig[breakpoint] || sizeConfig.desktop;
}

/**
 * Rarity to CSS class mapping
 */
const RARITY_CLASSES = {
  1: 'common',
  2: 'uncommon',
  3: 'rare',
  4: 'epic',
  5: 'legendary',
  common: 'common',
  uncommon: 'uncommon',
  rare: 'rare',
  epic: 'epic',
  legendary: 'legendary'
};

/**
 * Fallback display for missing sprites - shows red X to make errors visible
 */
const FALLBACK_DISPLAY = '✗';

import { escapeHtmlAttribute } from '../utils/escapeHtml.js';

export class ItemIcon {
  /**
   * Resolve the canonical image URL used by the item asset pipeline.
   *
   * This is intentionally side-effect free so canvas renderers can use the
   * exact same source as the DOM component without injecting styles or
   * duplicating item type/subcategory rules.
   *
   * @param {Object} options - Same item options accepted by {@link ItemIcon.html}
   * @returns {string|null} Canonical item image URL, or null without a sprite ID
   */
  static getSrc(options = {}) {
    const item = options.item || {};
    const spriteId = options.spriteId || item.sprite_id || item.spriteId;

    if (!spriteId) return null;

    const itemType = options.itemType || item.item_type || item.itemType || item.type || 'weapon';
    const size = options.size || 'md';
    const subcategory = getSubcategory(itemType);
    const pixelSize = getPixelSize(size);
    const assetSize = getOptimalAssetSize(pixelSize);

    return getAssetPath('items', spriteId, {
      subcategory,
      size: assetSize
    });
  }

  /**
   * Resolve a composited item image for canvas or DOM consumers while keeping
   * category, size, rarity, and augment handling in one place.
   * @param {Object} options - Same item options accepted by compositeHtml
   * @returns {Promise<string|null>} Composited data URL, or null without a sprite ID
   */
  static async getCompositeSrc(options = {}) {
    const item = options.item || {};
    const spriteId = options.spriteId || item.sprite_id || item.spriteId;
    if (!spriteId) return null;

    const itemType = options.itemType || item.item_type || item.itemType || item.type || 'weapon';
    const rarity = options.rarity || item.rarity || 'common';
    // Pass augment objects through whole: the compositor resolves each one's
    // category, effect type or stat to an overlay (resolveAugmentOverlayId).
    const augments = (options.augments || item.augments || []).filter(Boolean);
    const size = options.size || 'md';

    return overlayCompositor.composite({
      spriteId,
      subcategory: getSubcategory(itemType),
      size: getPixelSize(size),
      rarity,
      augments
    });
  }

  /**
   * Generate HTML string for item icon
   *
   * @param {Object} options - Configuration options
   * @param {string} [options.spriteId] - Sprite ID from item template (e.g., 'sword_short')
   * @param {string} [options.itemType] - Item type (weapon, armor, accessory, consumable)
   * @param {string|number} [options.rarity] - Rarity for border styling
   * @param {Object} [options.item] - Full item object (alternative to individual props)
   * @param {'sm'|'md'|'lg'|'xl'} [options.size='md'] - Size category
   * @param {string} [options.className] - Additional CSS classes
   * @param {string} [options.title] - Tooltip text
   * @returns {string} HTML string
   */
  static html(options = {}) {
    installImageFallbackHandler();

    // Inject styles once
    ItemIcon.injectStyles();

    // Extract from item object if provided
    const item = options.item || {};
    const spriteId = options.spriteId || item.sprite_id || item.spriteId;
    const itemType = options.itemType || item.item_type || item.itemType || item.type || 'weapon';
    const rarity = options.rarity || item.rarity || 'common';
    const size = options.size || 'md';
    const className = options.className || '';
    const title = options.title || item.name || '';

    // Get subcategory and sizes
    const pixelSize = getPixelSize(size);

    // Build path
    const imgPath = ItemIcon.getSrc({ ...options, item, spriteId, itemType, size });
    const useFallback = !imgPath;

    // Get rarity class
    const rarityClass = RARITY_CLASSES[rarity] || 'common';

    // Build class names
    const classes = ['modia-item-icon', `modia-item-icon--${size}`, `modia-item-icon--${rarityClass}`];
    if (className) classes.push(className);

    // Build title attribute
    const titleAttr = title ? `title="${escapeHtmlAttribute(title)}"` : '';
    const classAttr = escapeHtmlAttribute(classes.join(' '));

    if (useFallback) {
      console.error('[ItemIcon] No spriteId provided for item:', item.name || 'unknown');
      return `<span class="${classAttr} modia-item-icon--error" ${titleAttr}>
        <span class="modia-item-icon__fallback">${FALLBACK_DISPLAY}</span>
      </span>`;
    }

    // Pre-compute fallback presentation using static values only.
    const fallbackSize = Math.round(pixelSize * 0.6);

    return `<span class="${classAttr}" ${titleAttr}>
      <img class="modia-item-icon__img" src="${escapeHtmlAttribute(imgPath)}" alt=""
           style="width: ${pixelSize}px; height: ${pixelSize}px;"
           draggable="false"
           data-image-fallback data-fallback-display="flex"
           data-fallback-error-class="modia-item-icon--error">
      <span class="modia-item-icon__fallback" style="display:none;font-size:${fallbackSize}px;">${FALLBACK_DISPLAY}</span>
    </span>`;
  }

  /**
   * Generate HTML with composited overlay sprite
   *
   * Asynchronously composites item sprite with rarity and augment overlays,
   * returning HTML with a data URL for the composited image.
   *
   * @param {Object} options - Configuration options
   * @param {string} [options.spriteId] - Sprite ID from item template (e.g., 'sword_short')
   * @param {string} [options.itemType] - Item type (weapon, armor, accessory, consumable)
   * @param {string|number} [options.rarity] - Rarity for border styling and overlay
   * @param {string[]} [options.augments=[]] - Array of augment types (fire, ice, etc.)
   * @param {Object} [options.item] - Full item object (alternative to individual props)
   * @param {'sm'|'md'|'lg'|'xl'} [options.size='md'] - Size category
   * @param {string} [options.className] - Additional CSS classes
   * @param {string} [options.title] - Tooltip text
   * @returns {Promise<string>} HTML string with composited image
   */
  static async compositeHtml(options = {}) {
    // Inject styles once
    ItemIcon.injectStyles();

    // Extract from item object if provided
    const item = options.item || {};
    const spriteId = options.spriteId || item.sprite_id || item.spriteId;
    const rarity = options.rarity || item.rarity || 'common';
    const size = options.size || 'md';
    const className = options.className || '';
    const title = options.title || item.name || '';

    // Get subcategory and sizes
    const pixelSize = getPixelSize(size);

    // Get rarity class
    const rarityClass = RARITY_CLASSES[rarity] || 'common';

    // Build class names
    const classes = ['modia-item-icon', `modia-item-icon--${size}`, `modia-item-icon--${rarityClass}`];
    if (className) classes.push(className);

    // Build title attribute
    const titleAttr = title ? `title="${escapeHtmlAttribute(title)}"` : '';
    const classAttr = escapeHtmlAttribute(classes.join(' '));

    // If no spriteId, return error fallback
    if (!spriteId) {
      console.error('[ItemIcon] No spriteId provided for compositeHtml, item:', item.name || 'unknown');
      return `<span class="${classAttr} modia-item-icon--error" ${titleAttr}>
        <span class="modia-item-icon__fallback">${FALLBACK_DISPLAY}</span>
      </span>`;
    }

    // Composite the sprite with overlays
    try {
      const dataUrl = await ItemIcon.getCompositeSrc({ ...options, item, spriteId, rarity, size });

      return `<span class="${classAttr}" ${titleAttr}>
        <img class="modia-item-icon__img" src="${escapeHtmlAttribute(dataUrl)}" alt=""
             style="width: ${pixelSize}px; height: ${pixelSize}px;"
             draggable="false">
      </span>`;
    } catch (err) {
      // Show error state instead of masking with emoji
      console.error('[ItemIcon] Composite failed for:', spriteId, err);
      return `<span class="${classAttr} modia-item-icon--error" ${titleAttr}>
        <span class="modia-item-icon__fallback">${FALLBACK_DISPLAY}</span>
      </span>`;
    }
  }

  /**
   * Inject component styles (once)
   */
  static injectStyles() {
    if (document.getElementById('modia-item-icon-styles')) return;

    const style = document.createElement('style');
    style.id = 'modia-item-icon-styles';
    style.textContent = `
      /* ItemIcon Component Base */
      .modia-item-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        vertical-align: middle;
        user-select: none;
        background: #2a2420;
        border-radius: 4px;
        border: 2px solid #5a4a3a;
        padding: 2px;
      }

      /* Size variants */
      .modia-item-icon--sm {
        min-width: 28px;
        min-height: 28px;
      }

      .modia-item-icon--md {
        min-width: 36px;
        min-height: 36px;
      }

      .modia-item-icon--lg {
        min-width: 52px;
        min-height: 52px;
      }

      .modia-item-icon--xl {
        min-width: 68px;
        min-height: 68px;
      }

      /* Rarity borders */
      .modia-item-icon--common {
        border-color: #5a4a3a;
      }

      .modia-item-icon--uncommon {
        border-color: #2d6b2d;
        box-shadow: 0 0 4px rgba(45, 107, 45, 0.3);
      }

      .modia-item-icon--rare {
        border-color: #0055aa;
        box-shadow: 0 0 6px rgba(0, 85, 170, 0.4);
      }

      .modia-item-icon--epic {
        border-color: #7722aa;
        box-shadow: 0 0 8px rgba(119, 34, 170, 0.5);
      }

      .modia-item-icon--legendary {
        border-color: #cc6600;
        box-shadow: 0 0 10px rgba(204, 102, 0, 0.6);
      }

      /* Image */
      .modia-item-icon__img {
        display: block;
        image-rendering: pixelated;
        image-rendering: -moz-crisp-edges;
        image-rendering: crisp-edges;
      }

      /* Fallback display */
      .modia-item-icon__fallback {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        font-size: 16px;
        color: #cc3333;
        font-weight: bold;
      }

      /* Error state - red border to make missing sprites obvious */
      .modia-item-icon--error {
        border-color: #cc3333;
        background: rgba(204, 51, 51, 0.15);
      }
    `;
    document.head.appendChild(style);
  }
}

export default ItemIcon;
