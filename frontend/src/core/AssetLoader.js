/**
 * @module AssetLoader
 * @description Handles loading and caching of sprite assets with fallback to emoji/colors.
 *
 * Key responsibilities:
 * - Image loading with caching and request deduplication
 * - Size-aware asset selection (getOptimalSize) for optimal display
 * - Terrain tile loading with biome fallback (forest as default)
 * - Character and enemy sprite/portrait management
 * - Node sprite loading (world map icons)
 * - Item icon compositing with rarity/augment overlays
 *
 * Size selection strategy:
 * - Portraits: 64px (default), 128px, 256px - smallest >= display size
 * - Nodes: 48px, 64px, 96px (default), 128px, 256px - smallest >= display size
 * - Items: 32px, 64px (default), 128px - directory-based
 * - Icons: 16-128px - directory-based
 *
 * @see assetPaths.js - Path generation utilities
 * @see IconLoader.js - Icon-specific loading
 */

import {
  getAssetPath,
  getNpcPortraitId,
  getNpcVisualIdentity,
  getPlayerCharacterPathCandidates,
  SIZE_PRESETS,
  DEFAULT_SIZES,
  getOptimalSize
} from '@modia/shared/assetPaths';
import { assetCache } from './AssetCache.js';
import {
  loadItemComposite as loadItemCompositeImpl,
  composeItemSprite as composeItemSpriteImpl,
  getItemComposite as getItemCompositeImpl,
  preloadOverlays as preloadOverlaysImpl,
  preloadItemComposites as preloadItemCompositesImpl,
  RARITY_ALPHA,
  COMPOSITE_SIZE
} from './assetLoader/ItemCompositing.js';
import { OBSTACLE_ASSET_CATALOG, getObstacleAssetCategory } from '@modia/shared/obstacles';
import {
  CHARACTER_ANIMATIONS,
  ENEMY_ANIMATIONS,
  getEnemySpriteAnimationCandidates,
  getEnemySpritePathCandidates,
  getPlayerCharacterAnimations,
  resolveSpriteBiome
} from './BattleAssetConfig.js';
import {
  assertV2AssetCapability,
  getV2VisualCapabilities
} from '@modia/shared/mapgen/v2/renderCapabilities';

const V2_TRANSITION_STYLES = Object.freeze({
  'terrain-edge': Object.freeze({
    color: '#514737',
    alpha: 0.46,
    lineWidth: 2
  }),
  shore: Object.freeze({
    color: '#d8c690',
    alpha: 0.72,
    lineWidth: 3
  }),
  bank: Object.freeze({
    color: '#6e5538',
    alpha: 0.68,
    lineWidth: 3
  }),
  wetness: Object.freeze({
    color: '#74a4b8',
    alpha: 0.48,
    lineWidth: 4
  }),
  'route-edge': Object.freeze({
    color: '#4d3927',
    alpha: 0.72,
    lineWidth: 3
  }),
  'route-shoulder': Object.freeze({
    color: '#826542',
    alpha: 0.58,
    lineWidth: 4
  }),
  'route-center': Object.freeze({
    color: '#ac8757',
    alpha: 0.5,
    lineWidth: 3
  }),
  cliff: Object.freeze({
    color: '#313237',
    alpha: 0.82,
    lineWidth: 3
  }),
  slope: Object.freeze({
    color: '#b7a276',
    alpha: 0.7,
    lineWidth: 2
  }),
  stairs: Object.freeze({
    color: '#d1c2a0',
    alpha: 0.76,
    lineWidth: 3
  })
});

const V2_DECORATION_STYLES = Object.freeze({
  'ground-cover': Object.freeze({
    color: '#496b35',
    accentColor: '#829a50',
    alpha: 0.82,
    radius: 2
  }),
  'leaf-litter': Object.freeze({
    color: '#765036',
    accentColor: '#a77b4d',
    alpha: 0.78,
    radius: 2
  }),
  mushroom: Object.freeze({
    color: '#bd6c51',
    accentColor: '#e3c99a',
    alpha: 0.9,
    radius: 2
  }),
  crystal: Object.freeze({
    color: '#72c9d6',
    accentColor: '#d2fbff',
    alpha: 0.88,
    radius: 2
  }),
  talus: Object.freeze({
    color: '#77756f',
    accentColor: '#aaa59a',
    alpha: 0.86,
    radius: 2
  }),
  scrub: Object.freeze({
    color: '#6d7040',
    accentColor: '#a5a365',
    alpha: 0.82,
    radius: 2
  }),
  reeds: Object.freeze({
    color: '#7d843a',
    accentColor: '#bdad5d',
    alpha: 0.84,
    radius: 2
  }),
  debris: Object.freeze({
    color: '#66503f',
    accentColor: '#9c7654',
    alpha: 0.82,
    radius: 2
  }),
  rubble: Object.freeze({
    color: '#77746d',
    accentColor: '#aaa49a',
    alpha: 0.86,
    radius: 2
  }),
  moss: Object.freeze({
    color: '#4f713f',
    accentColor: '#82a263',
    alpha: 0.82,
    radius: 2
  }),
  ash: Object.freeze({
    color: '#696967',
    accentColor: '#99958e',
    alpha: 0.72,
    radius: 2
  })
});

const V2_DIRT_SURFACE_STYLES = Object.freeze({
  bridge: Object.freeze({ color: '#80613f', accentColor: '#a17a4c' }),
  castle: Object.freeze({ color: '#82664a', accentColor: '#a58764' }),
  cave: Object.freeze({ color: '#67513d', accentColor: '#826b52' }),
  forest: Object.freeze({ color: '#765632', accentColor: '#9a7544' }),
  mountain: Object.freeze({ color: '#786247', accentColor: '#9a8260' })
});

const V2_DIRECTION_CODES = Object.freeze({
  north: 'n',
  east: 'e',
  south: 's',
  west: 'w',
  n: 'n',
  e: 'e',
  s: 's',
  w: 'w'
});

function stableStringHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class AssetLoader {
  constructor() {
    this.cache = new Map();
    this.loading = new Map();
    this.battleMapV3Assets = new Map();
    this.assetCache = assetCache;
    this.manifest = null;
    this.basePath = '/assets';
    this.initialized = false;

    // Track failed lookups to avoid spamming console with duplicate warnings
    // Key format: "type:biome:terrain" or "type:biome:direction:levels"
    this.failedLookups = new Set();

    // Node type aliases (worldgen name → sprite name)
    this.nodeTypeAliases = {
      fishing_spot: 'fishing',
      merchant_caravan: 'caravan'
    };

    // Fallback emoji for when sprites aren't loaded
    this.fallbackEmoji = {
      node: {
        castle: '🏰',
        city: '🏛️',
        village: '🏘️',
        forest: '🌲',
        cave: '🕳️',
        mountain: '⛰️',
        bridge: '🌉',
        guild: '⚔️',
        palace: '👑',
        keep: '🏯',
        chest: '📦',
        shrine: '⛩️',
        discovery: '✨',
        tavern: '🍺',
        shop: '🏪',
        blacksmith: '⚒️',
        apothecary: '⚗️',
        fishing: '🎣',
        fishing_spot: '🎣',
        ruins: '🏚️',
        watchtower: '🗼',
        farm: '🌾',
        caravan: '🐫',
        merchant_caravan: '🐫',
        guild_warrior: '⚔️',
        guild_wizard: '🔮',
        guild_monk: '☯️',
        guild_chemist: '⚗️'
      },
      // Rarity colors for fallback border/glow rendering
      rarity: {
        common: '#9d9d9d',     // Gray
        uncommon: '#1eff00',   // Green
        rare: '#0070dd',       // Blue
        epic: '#a335ee',       // Purple
        legendary: '#ff8000'   // Orange
      },
      // Augment colors for fallback effect rendering
      augment: {
        fire: '#ff4500',       // Orange-red
        ice: '#00bfff',        // Deep sky blue
        lightning: '#ffd700',  // Gold/yellow
        poison: '#32cd32',     // Lime green
        holy: '#fffacd',       // Lemon chiffon (light gold)
        dark: '#4b0082'        // Indigo
      },
      character: {
        warrior: 'W',
        wizard: 'M',
        monk: 'K',
        chemist: 'C'
      },
      terrain: {
        grass: '#6b8e23',   // Olive green
        dirt: '#80613f',    // Authored code-native V2 route surface
        stone: '#8b8682',   // Warm gray (walkable)
        forest: '#228b22',  // Forest green
        water: '#4682b4',   // Steel blue
        rock: '#8b4513',    // Brown-red (IMPASSABLE - distinct from stone)
        lava: '#ff4500',    // Orange-red
        cliff: '#2f2f2f',   // Dark charcoal
        tree: '#228b22'     // Forest green
      }
    };
  }

  /**
   * Log a warning once per unique lookup key to prevent console spam during render loops.
   * Used by getWallTexture, loadWallTexture, getSlopeSprite, loadSlopeSprite.
   * @param {string} lookupKey - Unique key identifying the failed lookup (e.g., "wall:cave:rock")
   * @param {string} message - Warning message to log
   * @private
   */
  _warnOnce(lookupKey, message) {
    if (!this.failedLookups.has(lookupKey)) {
      this.failedLookups.add(lookupKey);
      console.warn(message);
    }
  }

  /**
   * Select one exact authored resource from a validated V2 capability.
   * Variant indexes never wrap or fall through to another palette/material.
   * @private
   */
  _getV2ResourcePath(capability, variantIndex = 0) {
    if (!Number.isSafeInteger(variantIndex) || variantIndex < 0 ||
        variantIndex >= capability.resourcePaths.length) {
      throw new RangeError(
        `Invalid variant ${String(variantIndex)} for V2 render asset ` +
        capability.assetKey
      );
    }
    return capability.resourcePaths[variantIndex];
  }

  _getV2VariantIndex(capability, options = {}) {
    if (options.variantIndex !== undefined) return options.variantIndex;
    if (options.selectionKey === undefined ||
        capability.resourcePaths.length <= 1) {
      return 0;
    }
    return stableStringHash(options.selectionKey) %
      capability.resourcePaths.length;
  }

  _assertV2ExpectedPalette(capability, expectedPalette) {
    if (expectedPalette !== undefined &&
        capability.palette !== expectedPalette) {
      throw new RangeError(
        `V2 render asset ${capability.assetKey} belongs to palette ` +
        `${capability.palette}, expected ${expectedPalette}`
      );
    }
  }

  /**
   * Resolve a V2 asset key exactly. Authored sprites are read only from their
   * catalogued path; code-native assets return immutable renderer descriptors.
   */
  getBattleMapV2Asset(assetKey, options = {}) {
    const capability = assertV2AssetCapability(assetKey);
    this._assertV2ExpectedPalette(capability, options.expectedPalette);
    const variantIndex = this._getV2VariantIndex(capability, options);

    if (capability.source.startsWith('authored-sprite')) {
      const resourcePath = this._getV2ResourcePath(
        capability,
        variantIndex
      );
      const result = this.cache.get(resourcePath) ?? null;
      if (!result) {
        this._warnOnce(
          `v2:${assetKey}:${variantIndex}`,
          '[AssetLoader] Exact V2 asset not found: ' +
          `assetKey=${assetKey}, variant=${variantIndex}`
        );
      }
      return result;
    }

    if (capability.source === 'code-native-surface') {
      const style = capability.semantic === 'dirt'
        ? V2_DIRT_SURFACE_STYLES[capability.palette]
        : null;
      if (!style) {
        throw new RangeError(
          `No code-native surface renderer for V2 asset ${assetKey}`
        );
      }
      return Object.freeze({
        type: 'code-native',
        assetKey,
        renderer: capability.renderer,
        ...style
      });
    }

    if (capability.source === 'code-native-overlay') {
      const style = capability.capabilityKind === 'transition'
        ? V2_TRANSITION_STYLES[capability.semantic]
        : capability.capabilityKind === 'decoration'
          ? V2_DECORATION_STYLES[capability.semantic]
          : null;
      if (!style) {
        throw new RangeError(
          `No code-native overlay renderer for V2 asset ${assetKey}`
        );
      }
      return Object.freeze({
        type: 'code-native',
        assetKey,
        renderer: capability.renderer,
        ...style
      });
    }

    throw new RangeError(`Unsupported V2 asset source for ${assetKey}`);
  }

  /**
   * Load a V2 authored asset from its exact catalogued path. Code-native
   * assets resolve immediately without network traffic.
   */
  async loadBattleMapV2Asset(assetKey, options = {}) {
    const capability = assertV2AssetCapability(assetKey);
    this._assertV2ExpectedPalette(capability, options.expectedPalette);
    if (capability.source.startsWith('code-native')) {
      return this.getBattleMapV2Asset(assetKey, options);
    }

    const variantIndex = this._getV2VariantIndex(capability, options);
    const resourcePath = this._getV2ResourcePath(capability, variantIndex);
    try {
      return await this.loadImage(resourcePath);
    } catch {
      this._warnOnce(
        `v2:${assetKey}:${variantIndex}`,
        '[AssetLoader] Failed to load exact V2 asset: ' +
        `assetKey=${assetKey}, variant=${variantIndex}`
      );
      return null;
    }
  }

  _getBattleMapV3AssetIdentity(asset) {
    return `${asset?.assetBundleId}:${asset?.key}:${asset?.contentVersion}`;
  }

  /**
   * Return only the already verified image for an exact V3 asset reference.
   * There is deliberately no key, biome, or legacy artwork fallback.
   */
  getBattleMapV3Asset(asset) {
    const entry = this.battleMapV3Assets.get(
      this._getBattleMapV3AssetIdentity(asset)
    );
    if (!entry ||
        entry.asset.contentHash !== asset?.contentHash ||
        entry.asset.immutableUrl !== asset?.immutableUrl) {
      return null;
    }
    return entry.image;
  }

  async _decodeBattleMapV3Image(bytes, immutableUrl) {
    const blob = new Blob([bytes]);
    if (typeof globalThis.createImageBitmap === 'function') {
      return globalThis.createImageBitmap(blob);
    }
    if (typeof Image !== 'function' ||
        typeof URL?.createObjectURL !== 'function') {
      throw new Error(`No image decoder is available for ${immutableUrl}`);
    }

    const blobUrl = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error(`Failed to decode image: ${immutableUrl}`));
      };
      image.src = blobUrl;
    });
  }

  /**
   * Fetch raw bytes, verify SHA-256, then decode and expose a V3 image.
   */
  async loadBattleMapV3Asset(asset) {
    const existing = this.getBattleMapV3Asset(asset);
    if (existing) return existing;

    const identity = this._getBattleMapV3AssetIdentity(asset);
    const loadingKey = `battle-map-v3:${identity}`;
    if (this.loading.has(loadingKey)) {
      return this.loading.get(loadingKey);
    }

    const loadPromise = (async () => {
      try {
        const bytes = await this.assetCache.fetchVerifiedBytes(asset);
        const image = await this._decodeBattleMapV3Image(
          bytes,
          asset.immutableUrl
        );
        this.battleMapV3Assets.set(identity, {
          asset: Object.freeze({ ...asset }),
          image
        });
        return image;
      } finally {
        this.loading.delete(loadingKey);
      }
    })();
    this.loading.set(loadingKey, loadPromise);
    return loadPromise;
  }

  /**
   * Strictly preload every V3 reference. Any missing, corrupt, or undecodable
   * asset rejects the whole operation so BattleScene remains blocked.
   */
  async preloadBattleMapV3Assets(assets, { onProgress } = {}) {
    if (!Array.isArray(assets) || assets.length === 0) {
      throw new TypeError('BattleMapV3 requires a non-empty asset manifest');
    }
    let loaded = 0;
    return Promise.all(assets.map(asset =>
      this.loadBattleMapV3Asset(asset).then(image => {
        loaded++;
        onProgress?.(loaded, assets.length);
        return image;
      })
    ));
  }

  /**
   * Initialize asset loader
   * Sets up the persistent Cache API storage for cross-session caching
   */
  async init() {
    if (this.initialized) return;

    // Initialize persistent cache (Cache API for cross-session storage)
    await assetCache.init();

    // Manifest is reserved for future use (asset versioning, preload lists)
    // but is not currently needed for asset loading
    this.manifest = { version: 0, terrain: {}, characters: {}, enemies: {}, nodes: {}, items: {} };

    this.initialized = true;
  }

  /**
   * Load an image with multi-layer caching
   *
   * Cache layers (checked in order):
   * 1. In-memory Map (hot access during gameplay)
   * 2. Cache API (persistent across browser sessions)
   * 3. Network fetch (stores result in both caches)
   *
   * @param {string} src - Image URL to load
   * @returns {Promise<HTMLImageElement>} Loaded image element
   */
  async loadImage(src) {
    // Layer 1: Check in-memory cache (hot access)
    if (this.cache.has(src)) {
      return this.cache.get(src);
    }

    // Deduplication: Check if already loading this image
    if (this.loading.has(src)) {
      return this.loading.get(src);
    }

    // Start loading with Cache API integration
    const loadPromise = (async () => {
      try {
        // Layer 2 & 3: Use Cache API (checks cache, falls back to network)
        const response = await assetCache.fetchWithCache(src);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Convert response to blob URL for Image element
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        // Create Image from blob URL
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            // Store in in-memory cache for hot access
            this.cache.set(src, img);
            this.loading.delete(src);
            // Note: blobUrl is intentionally not revoked to keep image valid
            // Browser will reclaim memory when img is garbage collected
            resolve(img);
          };
          img.onerror = () => {
            URL.revokeObjectURL(blobUrl);
            this.loading.delete(src);
            reject(new Error(`Failed to decode image: ${src}`));
          };
          img.src = blobUrl;
        });
      } catch (error) {
        this.loading.delete(src);
        throw new Error(`Failed to load image: ${src} - ${error.message}`);
      }
    })();

    this.loading.set(src, loadPromise);
    return loadPromise;
  }

  /**
   * Map node type to sprite biome directory
   * Each biome has its own tile set; forest is used as fallback for nodes without unique terrain.
   * @param {string} nodeType - Node type (forest, cave, mountain, etc.)
   * @returns {string} Biome directory
   */
  getSpriteBiome(nodeType) {
    return resolveSpriteBiome(nodeType);
  }

  /**
   * Load terrain tile sprite
   *
   * Uses shared assetPaths module for consistent path construction.
   * Falls back through: biome-specific -> forest biome with variant -> forest biome without variant.
   *
   * @param {string} terrain - Terrain type (grass, stone, forest, etc.)
   * @param {string} nodeType - Node type for biome-specific tiles (forest, cave, mountain, etc.)
   * @param {number} [variant=0] - Tile variant index (0-3)
   * @returns {Promise<HTMLImageElement|null>} Loaded tile image or null if not found
   */
  async loadTile(terrain, nodeType, variant = 0) {
    const biome = this.getSpriteBiome(nodeType);
    const tileId = `${terrain}_${variant}`;

    // Try biome-specific tile first
    const biomePath = getAssetPath('tiles', tileId, { subcategory: biome });
    try {
      return await this.loadImage(biomePath);
    } catch {
      // Fallback to forest biome (default)
      if (biome !== 'forest') {
        const forestPath = getAssetPath('tiles', tileId, { subcategory: 'forest' });
        try {
          return await this.loadImage(forestPath);
        } catch {
          // Try without variant
          const noVariantPath = getAssetPath('tiles', terrain, { subcategory: 'forest' });
          try {
            return await this.loadImage(noVariantPath);
          } catch {
            return null;
          }
        }
      }
      return null;
    }
  }

  /**
   * Get terrain tile (sync, returns null if not cached)
   * @param {string} terrain - Terrain type
   * @param {string} nodeType - Node type for biome lookup
   * @param {number} [variant=0] - Tile variant index
   */
  getTile(terrain, nodeType, variant = 0) {
    const biome = this.getSpriteBiome(nodeType);
    const primaryPath = `${this.basePath}/sprites/terrain/${biome}/${terrain}_${variant}.webp`;
    const fallbackPath = `${this.basePath}/sprites/terrain/forest/${terrain}_${variant}.webp`;

    return this.cache.get(primaryPath) ||
           this.cache.get(fallbackPath) ||
           this.cache.get(`${this.basePath}/sprites/terrain/forest/${terrain}.webp`) ||
           null;
  }

  /**
   * Load character sprite sheet
   *
   * SPRITE SHEET FORMAT: Vertical strip, 64x512 pixels (8 frames stacked vertically)
   * - Each frame is 64x64 pixels
   * - Frames 0-3: Idle animation cycle
   * - Frames 4-7: Walk/action animation cycle
   *
   * To extract a frame:
   *   const frameHeight = sprite.height / 8;
   *   const sourceY = frameIndex * frameHeight;
   *   ctx.drawImage(sprite, 0, sourceY, sprite.width, frameHeight, ...);
   *
   * See docs/FRONTEND_TECHNICAL_PATTERNS.md for full sprite documentation.
   *
   * @param {Object} character - Character object with race/gender/class for
   *   portrait-matched variant resolution
   * @param {string} animation - Animation type (idle, walk, attack, hit, death, victory)
   * @param {string} [type='player'] - 'player' or 'enemy'
   * @returns {Promise<HTMLImageElement|null>} Loaded sprite or null if failed
   */
  async loadCharacterSprite(character, animation, type = 'player') {
    if (type !== 'player') {
      const source = typeof character === 'object' && character !== null
        ? {
          ...character,
          enemyId: character.visualIdentity?.visualId
            || character.visualId
            || character.enemyId
            || character.sprite_id
            || character.spriteId
            || character.id
            || character.class
        }
        : { enemyId: character };
      const identity = getNpcVisualIdentity(source);
      return identity.visualId
        ? this.loadEnemySprite(identity.visualId, animation, identity.primaryBiome)
        : null;
    }

    if (typeof character !== 'object' || character === null) return null;
    const paths = getPlayerCharacterPathCandidates(character, { animation });

    for (const path of paths) {
      try {
        return await this.loadImage(path);
      } catch {
        // Continue only to another animation alias for this exact identity.
      }
    }
    return null;
  }

  /**
   * Get character sprite (sync)
   */
  getCharacterSprite(character, animation, type = 'player') {
    if (type !== 'player') {
      const source = typeof character === 'object' && character !== null
        ? {
          ...character,
          enemyId: character.visualIdentity?.visualId
            || character.visualId
            || character.enemyId
            || character.sprite_id
            || character.spriteId
            || character.id
            || character.class
        }
        : { enemyId: character };
      const identity = getNpcVisualIdentity(source);
      return identity.visualId
        ? this.getEnemySprite(identity.visualId, animation, identity.primaryBiome)
        : null;
    }

    if (typeof character !== 'object' || character === null) return null;
    const paths = getPlayerCharacterPathCandidates(character, { animation });

    for (const path of paths) {
      const sprite = this.cache.get(path);
      if (sprite) return sprite;
    }
    return null;
  }

  // =====================
  // Equipment-Aware Character Sprites
  // =====================

  /**
   * Generate equipment hash for cache key
   * This should match the hash generated on the server
   */
  generateEquipmentHash(character) {
    const equipped = {
      race: character.race?.toLowerCase() || 'human',
      class: character.class?.toLowerCase() || 'wizard',
      weapon: this.getEquippedItemId(character, 'main_hand'),
      armor: this.getEquippedItemId(character, 'body'),
      head: this.getEquippedItemId(character, 'head')
    };

    // Simple hash function for client-side
    const str = JSON.stringify(equipped);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).substring(0, 12).padStart(12, '0');
  }

  /**
   * Get equipped item ID from character
   */
  getEquippedItemId(character, slot) {
    if (!character.equippedItems) return 'none';
    const item = character.equippedItems[slot];
    return item?.template_id?.toString() || item?.name?.toLowerCase().replace(/\s+/g, '_') || 'none';
  }

  /**
   * Get sprite path for equipped character
   */
  getEquippedSpritePath(character, animation = 'idle') {
    const race = character.race?.toLowerCase() || 'human';
    const charClass = character.class?.toLowerCase() || 'wizard';
    const hash = this.generateEquipmentHash(character);
    return `${this.basePath}/characters/equipped/${race}_${charClass}_${hash}/${animation}.webp`;
  }

  /**
   * Load equipped character sprite
   * Falls back to base class sprite if equipped version not available
   */
  async loadEquippedCharacterSprite(character, animation = 'idle') {
    const equippedPath = this.getEquippedSpritePath(character, animation);

    try {
      return await this.loadImage(equippedPath);
    } catch {
      // Fallback to base class sprite
      return this.loadCharacterSprite(character, animation, 'player');
    }
  }

  /**
   * Get equipped character sprite (sync)
   * Returns null if not cached, caller should trigger async load
   */
  getEquippedCharacterSprite(character, animation = 'idle') {
    const equippedPath = this.getEquippedSpritePath(character, animation);
    return this.cache.get(equippedPath) || null;
  }

  /**
   * Check if equipped sprite exists in cache
   */
  hasEquippedSprite(character, animation = 'idle') {
    const equippedPath = this.getEquippedSpritePath(character, animation);
    return this.cache.has(equippedPath);
  }

  /**
   * Preload equipped character sprites
   * Loads all animations for the character's current equipment
   */
  async preloadEquippedCharacter(character, animations = ['idle', 'walk', 'attack', 'hit', 'death', 'dead']) {
    const promises = animations.map(anim =>
      this.loadEquippedCharacterSprite(character, anim)
    );
    return Promise.allSettled(promises);
  }

  /**
   * Request sprite generation from server (for on-demand generation)
   * This triggers the server to generate the sprite if it doesn't exist
   */
  async requestEquippedSpriteGeneration(characterId, apiClient) {
    if (!apiClient) {
      console.warn('API client not available for sprite generation');
      return null;
    }

    try {
      const response = await apiClient.get(`/api/sprites/character/${characterId}`);
      if (response.sprites) {
        // Preload all generated sprites
        const loadPromises = Object.values(response.sprites).map(path =>
          this.loadImage(path)
        );
        await Promise.allSettled(loadPromises);
      }
      return response;
    } catch (error) {
      console.warn('Failed to request sprite generation:', error.message);
      return null;
    }
  }

  /**
   * Load enemy sprite
   * @param {string} enemyId - Enemy identifier (wolf, goblin_warrior, etc.)
   * @param {string} animation - Animation type
   * @param {string} biome - Requested biome (forest, cave, mountain, bridge, palace)
   */
  async loadEnemySprite(enemyId, animation = 'idle', biome = 'forest') {
    for (const path of this.getEnemySpritePathCandidates(enemyId, animation, biome)) {
      try {
        return await this.loadImage(path);
      } catch {
        // Continue through canonical, requested-biome, and animation fallbacks.
      }
    }
    return null;
  }

  /**
   * Get enemy sprite (sync)
   */
  getEnemySprite(enemyId, animation = 'idle', biome = 'forest') {
    for (const path of this.getEnemySpritePathCandidates(enemyId, animation, biome)) {
      const sprite = this.cache.get(path);
      if (sprite) return sprite;
    }
    return null;
  }

  /**
   * Build ordered, duplicate-free paths for an enemy sprite lookup.
   */
  getEnemySpritePathCandidates(enemyId, animation = 'idle', biome = 'forest') {
    return getEnemySpritePathCandidates(enemyId, animation, biome)
      .map(path => `${this.basePath}${path.slice('/assets'.length)}`);
  }

  /**
   * Load world map node sprite
   * Node filenames no longer have 'node_' prefix (e.g., castle.webp not node_castle.webp)
   * @param {string} nodeType - Node type (castle, city, village, etc.)
   * @param {string} [guildClass] - For guild nodes, the class (warrior, wizard, monk, chemist)
   */
  async loadNodeSprite(nodeType, guildClass = null) {
    // Resolve aliases first (e.g., fishing_spot → fishing)
    const resolvedType = this.nodeTypeAliases[nodeType] || nodeType;

    // Handle guild class variants - try class-specific sprite first
    if (resolvedType === 'guild' && guildClass) {
      const classPath = getAssetPath('nodes', `guild_${guildClass}`);
      try {
        return await this.loadImage(classPath);
      } catch {
        // Fall back to generic guild sprite
      }
    }

    const path = getAssetPath('nodes', resolvedType);
    try {
      return await this.loadImage(path);
    } catch {
      return null;
    }
  }

  /**
   * Get node sprite (sync)
   * Node filenames no longer have 'node_' prefix
   */
  getNodeSprite(nodeType, guildClass = null) {
    // Resolve aliases first (e.g., fishing_spot → fishing)
    const resolvedType = this.nodeTypeAliases[nodeType] || nodeType;

    // Handle guild class variants - try class-specific sprite first
    if (resolvedType === 'guild' && guildClass) {
      const classPath = getAssetPath('nodes', `guild_${guildClass}`);
      const classSprite = this.cache.get(classPath);
      if (classSprite) return classSprite;
      // Fall back to generic guild sprite
    }

    const path = getAssetPath('nodes', resolvedType);
    return this.cache.get(path) || null;
  }

  // =====================
  // Size-Aware Asset Methods
  // =====================

  /**
   * Get portrait URL with appropriate size for display context
   *
   * Uses getOptimalSize() to select the smallest asset size >= display size.
   * This ensures crisp rendering without loading unnecessarily large assets.
   *
   * @param {Object} character - Character object with race, gender, class properties
   * @param {string} [character.race='human'] - Character race
   * @param {string} [character.gender='other'] - Character gender
   * @param {string} [character.class='warrior'] - Character class
   * @param {number} [displaySize=64] - Target display size in pixels
   * @returns {string} Portrait URL with optimal size
   *
   * @example
   * // Get URL for 48px display (will use 64px asset)
   * const url = assetLoader.getPortraitUrl(character, 48);
   * // => '/assets/portraits/64/human_male_warrior.webp'
   *
   * @example
   * // Get URL for 100px display (will use 128px asset)
   * const url = assetLoader.getPortraitUrl(character, 100);
   * // => '/assets/portraits/128/human_male_warrior.webp'
   */
  getPortraitUrl(character, displaySize = 64) {
    const race = (character.race || 'human').toLowerCase();
    const gender = (character.gender || 'other').toLowerCase();
    const charClass = (character.class || 'warrior').toLowerCase();
    const id = `${race}_${gender}_${charClass}`;
    const optimalSize = getOptimalSize('portraits', displaySize);
    return getAssetPath('portraits', id, { size: optimalSize });
  }

  /**
   * Get enemy portrait URL with appropriate size
   *
   * IMPORTANT: This method adds the 'enemy_' prefix to the enemyId.
   * Pass the database sprite_id (e.g., 'goblin_warrior'), NOT the full
   * portrait ID (e.g., 'enemy_goblin_warrior').
   *
   * @param {string|Object} enemyId - Visual id or canonical NPC DTO
   * @param {number} [displaySize=64] - Target display size in pixels
   * @returns {string} Enemy portrait URL with optimal size
   *
   * @example
   * // Correct: pass sprite_id from database
   * const url = assetLoader.getEnemyPortraitUrl('giant_spider', 40);
   * // => '/assets/portraits/64/enemy_giant_spider.webp'
   *
   * // Wrong: do NOT pass the full portrait ID with prefix
   * // assetLoader.getEnemyPortraitUrl('enemy_giant_spider', 40);
   * // Would incorrectly produce: '/assets/portraits/64/enemy_enemy_giant_spider.webp'
   */
  getEnemyPortraitUrl(enemyId, displaySize = 64) {
    const optimalSize = getOptimalSize('portraits', displaySize);
    return getAssetPath('portraits', getNpcPortraitId(enemyId), { size: optimalSize });
  }

  /**
   * Load portrait with appropriate size
   *
   * @param {Object} character - Character object with race, gender, class
   * @param {number} [displaySize=64] - Target display size in pixels
   * @returns {Promise<HTMLImageElement|null>} Loaded portrait image or null if failed
   */
  async loadPortrait(character, displaySize = 64) {
    const url = this.getPortraitUrl(character, displaySize);
    try {
      return await this.loadImage(url);
    } catch {
      return null;
    }
  }

  /**
   * Load enemy portrait with appropriate size
   *
   * @param {string} enemyId - Enemy identifier
   * @param {number} [displaySize=64] - Target display size in pixels
   * @returns {Promise<HTMLImageElement|null>} Loaded portrait image or null if failed
   */
  async loadEnemyPortrait(enemyId, displaySize = 64) {
    const url = this.getEnemyPortraitUrl(enemyId, displaySize);
    try {
      return await this.loadImage(url);
    } catch {
      return null;
    }
  }

  /**
   * Load world map node sprite at appropriate size
   *
   * @param {string} nodeType - Node type (castle, city, village, etc.)
   * @param {Object} [options={}] - Options
   * @param {number} [options.size] - Target display size (uses optimal size selection)
   * @param {string} [options.guildClass] - For guild nodes, the class variant
   * @returns {Promise<HTMLImageElement|null>} Loaded node sprite or null if failed
   *
   * @example
   * // Load castle node for 50px display (will try 64px variant via getOptimalSize)
   * const sprite = await assetLoader.loadNodeSpriteAtSize('castle', { size: 50 });
   */
  async loadNodeSpriteAtSize(nodeType, options = {}) {
    const { size = DEFAULT_SIZES.nodes, guildClass = null } = options;
    const resolvedType = this.nodeTypeAliases[nodeType] || nodeType;
    const optimalSize = getOptimalSize('nodes', size);

    // Build node ID with optional guild class (no node_ prefix)
    let id = resolvedType;
    if (resolvedType === 'guild' && guildClass) {
      id = `guild_${guildClass}`;
    }

    const path = getAssetPath('nodes', id, { size: optimalSize });

    try {
      return await this.loadImage(path);
    } catch {
      // Fallback: if requested size variant doesn't exist, try default size
      if (optimalSize !== DEFAULT_SIZES.nodes) {
        const fallbackPath = getAssetPath('nodes', id, { size: DEFAULT_SIZES.nodes });
        try {
          return await this.loadImage(fallbackPath);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  /**
   * Get node sprite URL at appropriate size (sync, for URL generation only)
   * Node IDs no longer have 'node_' prefix
   *
   * @param {string} nodeType - Node type
   * @param {Object} [options={}] - Options
   * @param {number} [options.size] - Target display size
   * @param {string} [options.guildClass] - For guild nodes, the class variant
   * @returns {string} Node sprite URL
   */
  getNodeSpriteUrl(nodeType, options = {}) {
    const { size = DEFAULT_SIZES.nodes, guildClass = null } = options;
    const resolvedType = this.nodeTypeAliases[nodeType] || nodeType;
    const optimalSize = getOptimalSize('nodes', size);

    // Build node ID without node_ prefix
    let id = resolvedType;
    if (resolvedType === 'guild' && guildClass) {
      id = `guild_${guildClass}`;
    }

    return getAssetPath('nodes', id, { size: optimalSize });
  }

  /**
   * Preload node sprites at multiple sizes
   *
   * @param {number[]} sizes - Array of sizes to preload
   * @returns {Promise<PromiseSettledResult<HTMLImageElement>[]>}
   */
  async preloadNodesAtSizes(sizes = [48, 64, 96, 128, 256]) {
    const nodeTypes = [
      'castle', 'city', 'village', 'keep', 'palace',
      'forest', 'cave', 'mountain', 'bridge',
      'fishing', 'ruins', 'watchtower', 'farm', 'caravan',
      'chest', 'shrine', 'discovery',
      'tavern', 'shop', 'blacksmith', 'apothecary', 'guild'
    ];
    const guildClasses = ['warrior', 'wizard', 'monk', 'chemist'];

    const promises = [];

    for (const size of sizes) {
      // Regular nodes
      for (const type of nodeTypes) {
        promises.push(this.loadNodeSpriteAtSize(type, { size }));
      }
      // Guild class variants
      for (const cls of guildClasses) {
        promises.push(this.loadNodeSpriteAtSize('guild', { size, guildClass: cls }));
      }
    }

    const results = await Promise.allSettled(promises);
    const loaded = results.filter(r => r.status === 'fulfilled' && r.value).length;
    console.log(`[AssetLoader] Node preload at sizes ${sizes.join(',')}: ${loaded}/${results.length} loaded`);
    return results;
  }

  /**
   * Load item icon
   * @param {Object} item - Item object with a canonical sprite ID and type
   * @param {number} [displaySize=64] - Logical display size in pixels
   */
  async loadItemIcon(item, displaySize = 64) {
    const spriteId = item.spriteId || item.sprite_id;
    if (!spriteId) return null;

    const subcategory = this.getItemCategory(item.itemType || item.item_type || item.type);
    const path = getAssetPath('items', spriteId, {
      subcategory,
      size: getOptimalSize('items', displaySize)
    });

    try {
      return await this.loadImage(path);
    } catch {
      return null;
    }
  }

  /**
   * Get item icon (sync)
   * @param {Object} item - Item object with a canonical sprite ID and type
   * @param {number} [displaySize=64] - Logical display size in pixels
   */
  getItemIcon(item, displaySize = 64) {
    const spriteId = item.spriteId || item.sprite_id;
    if (!spriteId) return null;

    const subcategory = this.getItemCategory(item.itemType || item.item_type || item.type);
    const path = getAssetPath('items', spriteId, {
      subcategory,
      size: getOptimalSize('items', displaySize)
    });

    return this.cache.get(path) || null;
  }

  /**
   * Load obstacle sprite
   * @param {string} obstacleType - Type (rock_small, oak_tree, etc.)
   * @param {string} category - Category (rocks, trees)
   */
  async loadObstacle(obstacleType, category) {
    const normalizedCategory = this.getObstacleCategory(obstacleType, category);
    const path = `${this.basePath}/obstacles/${normalizedCategory}/${obstacleType}.webp`;
    try {
      return await this.loadImage(path);
    } catch {
      return null;
    }
  }

  /**
   * Get obstacle sprite (sync)
   */
  getObstacle(obstacleType, category) {
    const normalizedCategory = this.getObstacleCategory(obstacleType, category);
    return this.cache.get(`${this.basePath}/obstacles/${normalizedCategory}/${obstacleType}.webp`) || null;
  }

  getObstacleCategory(obstacleType, category) {
    return getObstacleAssetCategory(obstacleType, category);
  }

  /**
   * Get item category from type
   */
  getItemCategory(type) {
    const categories = {
      weapon: 'weapons',
      sword: 'weapons',
      axe: 'weapons',
      staff: 'weapons',
      wand: 'weapons',
      mace: 'weapons',
      polearm: 'weapons',
      fist: 'weapons',
      dagger: 'weapons',
      bow: 'weapons',
      armor: 'armor',
      helmet: 'armor',
      helm: 'armor',
      head: 'armor',
      body: 'armor',
      legs: 'armor',
      feet: 'armor',
      robe: 'armor',
      boots: 'armor',
      shield: 'armor',
      accessory: 'accessories',
      ring: 'accessories',
      amulet: 'accessories',
      cloak: 'accessories',
      belt: 'accessories',
      gloves: 'accessories',
      gauntlets: 'accessories',
      consumable: 'consumables',
      potion: 'consumables',
      scroll: 'consumables',
      material: 'consumables',
      food: 'consumables',
      key_item: 'consumables'
    };
    return categories[String(type || '').toLowerCase()] || 'weapons';
  }

  // =====================
  // Layered Item Compositing System
  // Delegates to ./assetLoader/ItemCompositing.js
  // =====================

  /**
   * Rarity overlay alpha values for compositing (re-exported from ItemCompositing)
   */
  static RARITY_ALPHA = RARITY_ALPHA;

  /**
   * Standard overlay size for item compositing (re-exported from ItemCompositing)
   */
  static COMPOSITE_SIZE = COMPOSITE_SIZE;

  /**
   * Load and composite an item sprite with rarity and augment overlays
   * @param {string} itemId - Item template identifier
   * @param {string} category - Item category (weapons, armor, accessories, etc.)
   * @param {string} [rarity='common'] - Item rarity (common, uncommon, rare, epic, legendary)
   * @param {string|null} [augment=null] - Augment type (fire, ice, lightning, poison, holy, dark)
   * @returns {Promise<HTMLImageElement|null>} Composited item image or null if base not found
   */
  async loadItemComposite(itemId, category, rarity = 'common', augment = null) {
    const context = { cache: this.cache, loadImage: this.loadImage.bind(this) };
    return loadItemCompositeImpl(context, this.basePath, itemId, category, rarity, augment);
  }

  /**
   * Compose an item sprite with rarity and augment overlays using canvas
   * @param {HTMLImageElement} base - Base item sprite
   * @param {HTMLImageElement|null} rarityOverlay - Rarity glow overlay
   * @param {HTMLImageElement|null} augmentOverlay - Augment effect overlay
   * @param {string} rarity - Rarity level for alpha calculation
   * @returns {HTMLImageElement} Composited image
   */
  composeItemSprite(base, rarityOverlay, augmentOverlay, rarity) {
    return composeItemSpriteImpl(base, rarityOverlay, augmentOverlay, rarity);
  }

  /**
   * Get cached item composite (sync version)
   * Returns null if the composite is not in cache
   * Use loadItemComposite() to load asynchronously
   * @param {string} itemId - Item template identifier
   * @param {string} category - Item category (unused but kept for API consistency)
   * @param {string} [rarity='common'] - Item rarity
   * @param {string|null} [augment=null] - Augment type
   * @returns {HTMLImageElement|null} Cached composite or null
   */
  getItemComposite(itemId, category, rarity = 'common', augment = null) {
    return getItemCompositeImpl(this.cache, itemId, category, rarity, augment);
  }

  /**
   * Preload all overlay assets (rarity and augment overlays)
   * Call this during initial asset loading to ensure overlays are ready
   * @returns {Promise<PromiseSettledResult<HTMLImageElement>[]>}
   */
  async preloadOverlays() {
    return preloadOverlaysImpl(this.loadImage.bind(this), this.basePath);
  }

  /**
   * Preload item composites for a list of items
   * Useful for preloading inventory or shop items
   * @param {Array<{itemId: string, category: string, rarity?: string, augment?: string}>} items
   * @returns {Promise<PromiseSettledResult<HTMLImageElement>[]>}
   */
  async preloadItemComposites(items) {
    const context = { cache: this.cache, loadImage: this.loadImage.bind(this) };
    return preloadItemCompositesImpl(context, this.basePath, items);
  }

  // =====================
  // Stacking Tile System Methods
  // =====================

  /**
   * Get wall texture for a terrain/biome type
   * Wall textures are vertical strips that tile based on elevation height
   * @param {string} biome - Biome type (forest, cave, mountain, bridge, castle)
   * @param {string} terrain - Terrain type (grass, stone, etc.)
   * @returns {HTMLImageElement|null} Wall texture image or null if not found
   */
  getWallTexture(biome, terrain = 'default') {
    // Wall files use flat path: {biome}/wall_{biome}_{terrain}.webp
    const key = `${this.basePath}/sprites/terrain/${biome}/wall_${biome}_${terrain}.webp`;
    const fallbackKey = `${this.basePath}/sprites/terrain/${biome}/wall_${biome}_default.webp`;
    // Additional fallback: base biome which has generic terrain walls
    const baseFallbackKey = `${this.basePath}/sprites/terrain/base/wall_base_${terrain}.webp`;
    const ultimateFallbackKey = `${this.basePath}/sprites/terrain/base/wall_base_default.webp`;

    const result = this.cache.get(key) ||
                   this.cache.get(fallbackKey) ||
                   this.cache.get(baseFallbackKey) ||
                   this.cache.get(ultimateFallbackKey);

    if (!result) {
      this._warnOnce(`wall:${biome}:${terrain}`, `[AssetLoader] Wall texture not found: biome=${biome}, terrain=${terrain}`);
    }
    return result || null;
  }

  /**
   * Load wall texture for a terrain/biome type
   * @param {string} biome - Biome type
   * @param {string} terrain - Terrain type
   * @returns {Promise<HTMLImageElement|null>}
   */
  async loadWallTexture(biome, terrain = 'default') {
    // Wall files use flat path: {biome}/wall_{biome}_{terrain}.webp
    const paths = [
      `${this.basePath}/sprites/terrain/${biome}/wall_${biome}_${terrain}.webp`,
      `${this.basePath}/sprites/terrain/${biome}/wall_${biome}_default.webp`,
      // Additional fallback: base biome which has generic terrain walls
      `${this.basePath}/sprites/terrain/base/wall_base_${terrain}.webp`,
      `${this.basePath}/sprites/terrain/base/wall_base_default.webp`
    ];

    for (const path of paths) {
      try {
        return await this.loadImage(path);
      } catch {
        // Try next path
      }
    }

    this._warnOnce(`wall:${biome}:${terrain}`, `[AssetLoader] Failed to load wall texture: biome=${biome}, terrain=${terrain}`);
    return null;
  }

  /**
   * Get slope sprite for elevation transitions
   * @param {string} biome - Biome type
   * @param {string} direction - Slope direction (north, south, east, west)
   * @param {number} levels - Number of elevation levels (1-3)
   * @returns {HTMLImageElement|null} Slope sprite or null if not found
   */
  getSlopeSprite(biome, direction, levels = 1, options = {}) {
    const { kind = 'slope', exact = false } = options;
    const normalizedDirection = {
      n: 'north',
      e: 'east',
      s: 'south',
      w: 'west'
    }[direction] ?? direction;
    if (exact) {
      const directionCode = V2_DIRECTION_CODES[normalizedDirection];
      const capability = assertV2AssetCapability(
        `${biome}:connection:${kind}:${directionCode}:${levels}`
      );
      const exactPath = this._getV2ResourcePath(capability);
      const result = this.cache.get(exactPath) ?? null;
      if (!result) {
        this._warnOnce(
          `connection:${biome}:${kind}:${normalizedDirection}:${levels}`,
          '[AssetLoader] Exact V2 connection sprite not found: ' +
          `biome=${biome}, kind=${kind}, direction=${normalizedDirection}, ` +
          `variant=${levels}`
        );
      }
      return result;
    }

    // Slope files use flat path: {biome}/slope_{biome}_{direction}_{levels}.webp
    const key = `${this.basePath}/sprites/terrain/${biome}/slope_${biome}_${normalizedDirection}_${levels}.webp`;
    const fallbackKey = `${this.basePath}/sprites/terrain/${biome}/slope_${biome}_${normalizedDirection}_1.webp`;
    // Additional fallback: base biome
    const baseFallbackKey = `${this.basePath}/sprites/terrain/base/slope_base_${normalizedDirection}_${levels}.webp`;
    const baseDefaultKey = `${this.basePath}/sprites/terrain/base/slope_base_${normalizedDirection}_1.webp`;

    const result = this.cache.get(key) ||
                   this.cache.get(fallbackKey) ||
                   this.cache.get(baseFallbackKey) ||
                   this.cache.get(baseDefaultKey);

    if (!result) {
      this._warnOnce(`slope:${biome}:${normalizedDirection}:${levels}`, `[AssetLoader] Slope sprite not found: biome=${biome}, direction=${normalizedDirection}, levels=${levels}`);
    }
    return result || null;
  }

  /**
   * Load slope sprite for elevation transitions
   * @param {string} biome - Biome type
   * @param {string} direction - Slope direction
   * @param {number} levels - Number of elevation levels (1-3)
   * @returns {Promise<HTMLImageElement|null>}
   */
  async loadSlopeSprite(biome, direction, levels = 1, options = {}) {
    const { kind = 'slope', exact = false } = options;
    const normalizedDirection = {
      n: 'north',
      e: 'east',
      s: 'south',
      w: 'west'
    }[direction] ?? direction;
    if (exact) {
      const directionCode = V2_DIRECTION_CODES[normalizedDirection];
      const capability = assertV2AssetCapability(
        `${biome}:connection:${kind}:${directionCode}:${levels}`
      );
      const exactPath = this._getV2ResourcePath(capability);
      try {
        return await this.loadImage(exactPath);
      } catch {
        this._warnOnce(
          `connection:${biome}:${kind}:${normalizedDirection}:${levels}`,
          '[AssetLoader] Failed to load exact V2 connection sprite: ' +
          `biome=${biome}, kind=${kind}, direction=${normalizedDirection}, ` +
          `variant=${levels}`
        );
        return null;
      }
    }

    // Slope files use flat path: {biome}/slope_{biome}_{direction}_{levels}.webp
    const paths = [
      `${this.basePath}/sprites/terrain/${biome}/slope_${biome}_${normalizedDirection}_${levels}.webp`,
      `${this.basePath}/sprites/terrain/${biome}/slope_${biome}_${normalizedDirection}_1.webp`,
      // Additional fallback: base biome
      `${this.basePath}/sprites/terrain/base/slope_base_${normalizedDirection}_${levels}.webp`,
      `${this.basePath}/sprites/terrain/base/slope_base_${normalizedDirection}_1.webp`
    ];

    for (const path of paths) {
      try {
        return await this.loadImage(path);
      } catch {
        // Try next path
      }
    }

    this._warnOnce(`slope:${biome}:${normalizedDirection}:${levels}`, `[AssetLoader] Failed to load slope sprite: biome=${biome}, direction=${normalizedDirection}, levels=${levels}`);
    return null;
  }

  /**
   * Get top tile sprite for stacking (flat surface only)
   * @param {string} biome - Biome type
   * @param {string} terrain - Terrain type
   * @returns {HTMLImageElement|null} Top tile sprite or null
   */
  getTopTileSprite(biome, terrain) {
    // First try new naming convention with _top suffix
    const newKey = `${this.basePath}/sprites/terrain/${biome}/${terrain}_top.webp`;
    // Then try biome-specific terrain without suffix (current system)
    const biomeKey = `${this.basePath}/sprites/terrain/${biome}/${terrain}.webp`;
    // Fall back to base biome with variant
    const baseKey = `${this.basePath}/sprites/terrain/forest/${terrain}_0.webp`;

    return this.cache.get(newKey) ||
           this.cache.get(biomeKey) ||
           this.cache.get(baseKey) ||
           null;
  }

  /**
   * Load top tile sprite for stacking
   * @param {string} biome - Biome type
   * @param {string} terrain - Terrain type
   * @returns {Promise<HTMLImageElement|null>}
   */
  async loadTopTileSprite(biome, terrain) {
    const paths = [
      `${this.basePath}/sprites/terrain/${biome}/${terrain}_top.webp`,
      `${this.basePath}/sprites/terrain/${biome}/${terrain}.webp`,
      `${this.basePath}/sprites/terrain/forest/${terrain}_0.webp`
    ];

    for (const path of paths) {
      try {
        return await this.loadImage(path);
      } catch {
        // Try next path
      }
    }
    return null;
  }

  /**
   * Preload stacking tile assets for a biome
   * Loads wall textures, slopes, and top tiles
   * @param {string} biome - Biome type
   * @param {Object} options - Preload options
   */
  async preloadStackingTileAssets(biome, options = {}) {
    const { terrainTypes = AssetLoader.TERRAIN_TYPES } = options;
    const directions = ['north', 'south', 'east', 'west'];
    const levels = [1, 2, 3];
    const promises = [];

    // Load wall textures for each terrain type
    for (const terrain of terrainTypes) {
      promises.push(this.loadWallTexture(biome, terrain));
      promises.push(this.loadTopTileSprite(biome, terrain));
    }

    // Load default wall texture
    promises.push(this.loadWallTexture(biome, 'default'));

    // V1 retains its permissive slope preload. V2 authored connection art is
    // loaded by exact key so stairs can never be disguised by a slope/base
    // fallback.
    for (const direction of directions) {
      for (const level of levels) {
        promises.push(this.loadSlopeSprite(biome, direction, level));
      }
      promises.push(this.loadSlopeSprite(
        biome,
        direction,
        1,
        { kind: 'slope', exact: true }
      ));
      promises.push(this.loadSlopeSprite(
        biome,
        direction,
        2,
        { kind: 'stairs', exact: true }
      ));
    }

    const results = await Promise.allSettled(promises);
    const loaded = results.filter(r => r.status === 'fulfilled' && r.value).length;
    console.log(`[AssetLoader] Stacking tile preload for ${biome}: ${loaded}/${results.length} loaded`);
    return results;
  }

  // =====================
  // Fallback Methods
  // =====================

  /**
   * Get fallback emoji for a category
   */
  getFallbackEmoji(category, type) {
    // Item renderers use ItemIcon's explicit missing-asset marker. Do not
    // silently disguise missing canonical sprites with type emoji.
    if (category === 'item' || category === 'items') return '✗';
    return this.fallbackEmoji[category]?.[type] || '❓';
  }

  /**
   * Get fallback color for terrain
   */
  getFallbackTerrainColor(terrain) {
    return this.fallbackEmoji.terrain[terrain] || '#4a4a4a';
  }

  /**
   * Get fallback character letter
   */
  getFallbackCharacterLetter(charClass) {
    return this.fallbackEmoji.character[charClass] || 'X';
  }

  /**
   * Get fallback color for item rarity (for border/glow effects)
   * @param {string} rarity - Rarity level
   * @returns {string} CSS color string
   */
  getFallbackRarityColor(rarity) {
    return this.fallbackEmoji.rarity?.[rarity] || this.fallbackEmoji.rarity?.common || '#9d9d9d';
  }

  /**
   * Get fallback color for item augment (for effect rendering)
   * @param {string} augment - Augment type
   * @returns {string} CSS color string
   */
  getFallbackAugmentColor(augment) {
    return this.fallbackEmoji.augment?.[augment] || '#ffffff';
  }

  // =====================
  // Preloading
  // =====================

  /**
   * Standard terrain types for preloading
   */
  static TERRAIN_TYPES = ['grass', 'stone', 'rock', 'forest', 'water', 'lava', 'cliff', 'tree'];
  static VARIANTS_PER_TERRAIN = 4;
  static ELEVATION_LEVELS = [1, 2, 3];
  static CHARACTER_ANIMATIONS = CHARACTER_ANIMATIONS;
  static ENEMY_ANIMATIONS = ENEMY_ANIMATIONS;

  /**
   * Size presets from shared module (exposed for convenience)
   */
  static SIZE_PRESETS = SIZE_PRESETS;
  static DEFAULT_SIZES = DEFAULT_SIZES;

  /**
   * Static utility to get optimal size without instance
   * @param {string} category - Asset category
   * @param {number} displaySize - Target display size
   * @returns {number} Optimal preset size
   */
  static getOptimalSize(category, displaySize) {
    return getOptimalSize(category, displaySize);
  }

  /**
   * Preload terrain tiles for a biome (unified stacking system)
   * Loads floor tiles and wall textures - elevation variants are deprecated.
   * @param {string} nodeType - Node type for biome-specific sprites
   * @param {Object} options - Preload options
   * @param {boolean} options.includeElevation - DEPRECATED: ignored, elevation sprites no longer used
   * @param {boolean} options.includeWalls - Also preload wall textures (default: true)
   * @param {Function} options.onProgress - Optional callback (loaded, total) for progress tracking
   * @param {boolean} options.requireV2Assets - Reject if any exact V2 asset is unavailable
   */
  async preloadTerrainSet(nodeType, options = {}) {
    const {
      includeWalls = true,
      onProgress,
      requireV2Assets = false
    } = options;
    const promises = [];
    const requiredV2PromiseIndexes = new Set();
    const biome = this.getSpriteBiome(nodeType);
    let v2VisualCapabilities = null;
    try {
      v2VisualCapabilities = getV2VisualCapabilities(nodeType);
    } catch {
      // Legacy node types outside the V2 recipe registry retain their
      // existing permissive preload behavior.
    }
    const v2Palette = v2VisualCapabilities?.palette ?? biome;
    let loaded = 0;

    // Progress tracking wrapper
    const trackProgress = (promise) => promise.then(result => {
      loaded++;
      onProgress?.(loaded, promises.length);
      return result;
    }).catch(err => {
      loaded++;
      onProgress?.(loaded, promises.length);
      throw err;
    });
    const pushV2Asset = (promise, assetKey) => {
      if (requireV2Assets) {
        requiredV2PromiseIndexes.add(promises.length);
        promises.push(Promise.resolve(promise).then(asset => {
          if (!asset) {
            throw new Error(`Required V2 asset unavailable: ${assetKey}`);
          }
          return asset;
        }));
        return;
      }
      promises.push(promise);
    };

    // Load base floor tile variants for all terrain types
    for (const terrain of AssetLoader.TERRAIN_TYPES) {
      for (let v = 0; v < AssetLoader.VARIANTS_PER_TERRAIN; v++) {
        promises.push(this.loadTile(terrain, nodeType, v));
      }

      // Load wall textures for the stacking system
      if (includeWalls) {
        promises.push(this.loadWallTexture(biome, terrain));
      }
    }

    // Load default wall texture for fallback
    if (includeWalls) {
      promises.push(this.loadWallTexture(biome, 'default'));
    }

    if (v2VisualCapabilities) {
      const assetKey = `${v2Palette}:face:stone`;
      pushV2Asset(this.loadBattleMapV2Asset(assetKey), assetKey);
    }

    // V2 floors are exact capability-key lookups. Load every authored variant
    // from the recipe palette in addition to the legacy fallback set above.
    // Code-native materials (currently dirt) resolve without network traffic.
    for (const [material, capability] of Object.entries(
      v2VisualCapabilities?.variants ?? {}
    )) {
      for (let variantIndex = 0;
        variantIndex < capability.count;
        variantIndex++
      ) {
        const assetKey = `${v2Palette}:floor:${material}`;
        pushV2Asset(this.loadBattleMapV2Asset(
          assetKey,
          { variantIndex }
        ), `${assetKey}:${variantIndex}`);
      }
    }

    // BattleGrid consumes persisted V2 connections synchronously during draw.
    // Preload every authored directional connection before the scene starts.
    for (const direction of ['north', 'south', 'east', 'west']) {
      pushV2Asset(this.loadSlopeSprite(
        v2Palette,
        direction,
        1,
        { kind: 'slope', exact: true }
      ), `${v2Palette}:connection:slope:${direction}:1`);
      pushV2Asset(this.loadSlopeSprite(
        v2Palette,
        direction,
        2,
        { kind: 'stairs', exact: true }
      ), `${v2Palette}:connection:stairs:${direction}:2`);
    }

    // Track progress for each promise
    const trackedPromises = promises.map(p => trackProgress(p));
    const results = await Promise.allSettled(trackedPromises);
    const loadedCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
    const failed = results.filter(r => r.status === 'rejected');
    console.log(`[AssetLoader] Terrain preload for ${nodeType}: ${loadedCount}/${results.length} loaded`);
    if (failed.length > 0) {
      console.warn(`[AssetLoader] ${failed.length} terrain tiles failed:`, failed[0]?.reason?.message);
    }
    const requiredFailures = results.filter(
      (result, index) =>
        requiredV2PromiseIndexes.has(index) && result.status === 'rejected'
    );
    if (requiredFailures.length > 0) {
      throw new AggregateError(
        requiredFailures.map(result => result.reason),
        `${requiredFailures.length} required V2 terrain asset(s) failed to load`
      );
    }
    return results;
  }

  /**
   * Preload character sprites
   * @param {Object} character - Canonical race/gender/class player identity
   * @param {Object} options - Preload options
   * @param {string[]} options.animations - Animation types to preload (default: idle, walk, attack, hit, death, dead)
   * @param {Function} options.onProgress - Optional callback (loaded, total) for progress tracking
   */
  async preloadCharacter(character, options = {}) {
    const identity = character?.visualIdentity?.kind === 'player'
      ? character.visualIdentity
      : character;
    if (
      !identity
      || typeof identity !== 'object'
      || !identity.race
      || !identity.gender
      || !(identity.class || identity.className)
    ) {
      throw new TypeError('preloadCharacter requires a canonical race/gender/class player identity');
    }

    const animations = options.animations || getPlayerCharacterAnimations(character);
    const { onProgress } = options;
    const promises = animations.map(async anim => {
      const sprite = await this.loadCharacterSprite(character, anim);
      if (!sprite) {
        throw new Error(`Missing canonical player sprite ${identity.race}/${identity.gender}/${identity.class || identity.className}/${anim}`);
      }
      return sprite;
    });
    let loaded = 0;

    // Progress tracking wrapper
    const trackProgress = (promise) => promise.then(result => {
      loaded++;
      onProgress?.(loaded, promises.length);
      return result;
    }).catch(err => {
      loaded++;
      onProgress?.(loaded, promises.length);
      throw err;
    });

    const trackedPromises = promises.map(p => trackProgress(p));
    const results = await Promise.allSettled(trackedPromises);
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map(result => result.reason),
        `${failures.length} canonical player sprite(s) failed to preload`
      );
    }
    return results;
  }

  /**
   * Preload enemies for a biome
   * @param {string} biome - Biome type for enemy sprites
   * @param {Array<string|Object>} enemyIds - Visual IDs or canonical NPC DTOs
   * @param {Object} options - Preload options
   * @param {Function} options.onProgress - Optional callback (loaded, total) for progress tracking
   */
  async preloadEnemies(biome, enemyIds, options = {}) {
    const { onProgress } = options;
    const animations = AssetLoader.ENEMY_ANIMATIONS;
    const promises = [];
    let loaded = 0;

    for (const enemy of enemyIds) {
      const identity = getNpcVisualIdentity(
        typeof enemy === 'object' ? enemy : { enemyId: enemy },
        { fallbackBiome: typeof enemy === 'object' ? biome : 'forest' }
      );
      if (!identity.visualId) continue;
      for (const anim of animations) {
        promises.push(this.loadEnemySprite(identity.visualId, anim, identity.primaryBiome));
      }
    }

    // Progress tracking wrapper
    const trackProgress = (promise) => promise.then(result => {
      loaded++;
      onProgress?.(loaded, promises.length);
      return result;
    }).catch(err => {
      loaded++;
      onProgress?.(loaded, promises.length);
      throw err;
    });

    const trackedPromises = promises.map(p => trackProgress(p));
    return Promise.allSettled(trackedPromises);
  }

  /**
   * Preload all node sprites
   */
  async preloadNodes() {
    const nodeTypes = [
      // Settlements
      'castle', 'city', 'village', 'keep', 'palace',
      // Battle terrain
      'forest', 'cave', 'mountain', 'bridge',
      // Activity nodes
      'fishing', 'ruins', 'watchtower', 'farm', 'caravan',
      // Terminators
      'chest', 'shrine', 'discovery',
      // Commerce
      'tavern', 'shop', 'blacksmith', 'apothecary'
    ];
    const guildClasses = ['warrior', 'wizard', 'monk', 'chemist'];

    const promises = [
      ...nodeTypes.map(type => this.loadNodeSprite(type)),
      // Generic guild sprite
      this.loadNodeSprite('guild'),
      // Class-specific guild sprites
      ...guildClasses.map(cls => this.loadNodeSprite('guild', cls))
    ];

    return Promise.allSettled(promises);
  }

  /**
   * Load world map backdrop tile
   * @param {string} tileName - Tile name (world_grass, world_water, etc.)
   */
  async loadBackdropTile(tileName) {
    const path = `${this.basePath}/nodes/backdrop/${tileName}.webp`;
    try {
      return await this.loadImage(path);
    } catch {
      return null;
    }
  }

  /**
   * Get backdrop tile (sync)
   */
  getBackdropTile(tileName) {
    return this.cache.get(`${this.basePath}/nodes/backdrop/${tileName}.webp`) || null;
  }

  /**
   * Load world map path texture
   * @param {string} pathType - Path type (dirt_road, stone_path, bridge_planks)
   */
  async loadPathTexture(pathType) {
    const path = `${this.basePath}/nodes/paths/${pathType}.webp`;
    try {
      return await this.loadImage(path);
    } catch {
      return null;
    }
  }

  /**
   * Get path texture (sync)
   */
  getPathTexture(pathType) {
    return this.cache.get(`${this.basePath}/nodes/paths/${pathType}.webp`) || null;
  }

  /**
   * Preload world map backdrop and path textures
   */
  async preloadWorldMapAssets() {
    const backdropTiles = ['world_grass', 'world_water', 'world_forest', 'world_mountain', 'world_desert'];
    const pathTextures = ['dirt_road', 'stone_path', 'bridge_planks'];

    const promises = [
      ...backdropTiles.map(tile => this.loadBackdropTile(tile)),
      ...pathTextures.map(path => this.loadPathTexture(path)),
      this.preloadNodes()
    ];

    const results = await Promise.allSettled(promises);
    const loaded = results.filter(r => r.status === 'fulfilled' && r.value).length;
    console.log(`Preloaded ${loaded}/${results.length} world map assets`);
    return results;
  }

  /**
   * Preload obstacle sprites for all categories
   * This should be called before battles to ensure obstacles render correctly
   * @param {Object} options - Preload options
   * @param {Function} options.onProgress - Optional callback (loaded, total) for progress tracking
   * @param {boolean} options.requireV2Assets - Reject missing/non-exact V2 records
   */
  async preloadObstacles(options = {}) {
    const { onProgress, requireV2Assets = false } = options;
    // Battles pass their exact map manifest so mobile clients do not decode
    // every giant obstacle source. Retain the complete set as a compatibility
    // fallback for callers that do not yet provide a manifest.
    const defaultObstacles = OBSTACLE_ASSET_CATALOG;
    const descriptors = Array.isArray(options.obstacles)
      ? options.obstacles.map(obstacle => {
        if (obstacle.assetKey) {
          return {
            assetKey: obstacle.assetKey,
            selectionKey: obstacle.id
          };
        }
        return {
          type: obstacle.variant || obstacle.id || obstacle.type,
          category: this.getObstacleCategory(
            obstacle.variant || obstacle.id,
            obstacle.type || obstacle.category
          )
        };
      })
      : Object.entries(defaultObstacles).flatMap(([category, types]) =>
        types.map(type => ({ type, category }))
      );
    const uniqueDescriptors = Array.from(new Map(
      descriptors
        .filter(item => item.assetKey || item.type)
        .map(item => [
          item.assetKey
            ? `${item.assetKey}:${item.selectionKey}`
            : `${item.category}:${item.type}`,
          item
        ])
    ).values());

    const promises = [];
    const requiredV2PromiseIndexes = new Set();
    let loaded = 0;

    for (const descriptor of uniqueDescriptors) {
      if (requireV2Assets && !descriptor.assetKey) {
        throw new Error(
          `Required V2 map asset is missing an assetKey: ${descriptor.type}`
        );
      }
      const promise = descriptor.assetKey
        ? this.loadBattleMapV2Asset(descriptor.assetKey, {
          selectionKey: descriptor.selectionKey
        })
        : this.loadObstacle(descriptor.type, descriptor.category);
      if (requireV2Assets) {
        requiredV2PromiseIndexes.add(promises.length);
        promises.push(Promise.resolve(promise).then(asset => {
          if (!asset) {
            throw new Error(
              `Required V2 asset unavailable: ${descriptor.assetKey}`
            );
          }
          return asset;
        }));
      } else {
        promises.push(promise);
      }
    }

    // Progress tracking wrapper
    const trackProgress = (promise) => promise.then(result => {
      loaded++;
      onProgress?.(loaded, promises.length);
      return result;
    }).catch(err => {
      loaded++;
      onProgress?.(loaded, promises.length);
      throw err;
    });

    const trackedPromises = promises.map(p => trackProgress(p));
    const results = await Promise.allSettled(trackedPromises);
    const loadedCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
    console.log(`Preloaded ${loadedCount}/${results.length} obstacle sprites`);
    const requiredFailures = results.filter(
      (result, index) =>
        requiredV2PromiseIndexes.has(index) && result.status === 'rejected'
    );
    if (requiredFailures.length > 0) {
      throw new AggregateError(
        requiredFailures.map(result => result.reason),
        `${requiredFailures.length} required V2 map asset(s) failed to load`
      );
    }
    return results;
  }

  /**
   * Preload assets for battle scene
   * @param {string} nodeType
   * @param {Object[]} playerCharacters - Canonical race/gender/class identities
   * @param {Array<string|Object>} enemyIds
   */
  async preloadBattleAssets(nodeType, playerCharacters = [], enemyIds = []) {
    console.log(`Preloading battle assets for ${nodeType}...`);

    const tasks = [
      this.preloadTerrainSet(nodeType),
      ...playerCharacters.map(character => this.preloadCharacter(character)),
      // Enemy identity is independent of the encounter terrain. Registered NPCs
      // resolve their canonical biome; legacy unknown IDs use one stable fallback.
      this.preloadEnemies('forest', enemyIds)
    ];

    const results = await Promise.allSettled(tasks);
    const loaded = results.filter(r => r.status === 'fulfilled').length;
    console.log(`Preloaded ${loaded}/${results.length} asset groups`);

    return results;
  }

  // =====================
  // Cache Management
  // =====================

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics including in-memory and persistent storage info
   */
  getStats() {
    return {
      cachedImages: this.cache.size,
      loadingImages: this.loading.size,
      persistentCacheAvailable: assetCache.isAvailable()
    };
  }

  /**
   * Get detailed cache statistics including persistent storage
   * @returns {Promise<Object>} Detailed cache statistics
   */
  async getDetailedStats() {
    const basicStats = this.getStats();
    const storageEstimate = await assetCache.getStorageEstimate();

    return {
      ...basicStats,
      persistentStorage: storageEstimate
    };
  }

  /**
   * Clear cache and failed lookup tracking
   * @param {Object} options - Clear options
   * @param {boolean} options.clearPersistent - Also clear the persistent Cache API storage (default: false)
   */
  async clearCache(options = {}) {
    const { clearPersistent = false } = options;

    // Clear in-memory caches
    this.cache.clear();
    this.loading.clear();
    this.battleMapV3Assets.clear();
    this.failedLookups.clear();

    // Optionally clear persistent cache
    if (clearPersistent) {
      await assetCache.clear();
    }
  }

  /**
   * Check if sprite exists in cache
   */
  hasSprite(path) {
    return this.cache.has(path);
  }
}
