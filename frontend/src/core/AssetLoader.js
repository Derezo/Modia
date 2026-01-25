/**
 * AssetLoader - Handles loading and caching of sprite assets
 * Provides fallback to emoji/colors when sprites aren't available
 */
export class AssetLoader {
  constructor() {
    this.cache = new Map();
    this.loading = new Map();
    this.manifest = null;
    this.basePath = '/assets/sprites';
    this.initialized = false;

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
      item: {
        weapon: '⚔️',
        sword: '⚔️',
        axe: '🪓',
        staff: '🪄',
        dagger: '🗡️',
        bow: '🏹',
        shield: '🛡️',
        helmet: '🪖',
        armor: '🎽',
        body: '🎽',
        boots: '👢',
        ring: '💍',
        amulet: '📿',
        accessory: '💍',
        consumable: '🧪',
        potion: '🧪',
        scroll: '📜',
        material: '📦',
        key: '🔑'
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
   * Initialize asset loader and load manifest
   */
  async init() {
    if (this.initialized) return;

    try {
      await this.loadManifest();
    } catch (error) {
      console.warn('Asset manifest not found, sprites may not be available:', error.message);
      this.manifest = { version: 0, terrain: {}, characters: {}, enemies: {}, nodes: {}, items: {} };
    }

    this.initialized = true;
  }

  /**
   * Load asset manifest
   */
  async loadManifest() {
    const response = await fetch(`${this.basePath}/manifest.json`);
    if (!response.ok) {
      throw new Error(`Failed to load manifest: ${response.status}`);
    }
    this.manifest = await response.json();
    return this.manifest;
  }

  /**
   * Load an image with caching
   */
  async loadImage(src) {
    // Check cache
    if (this.cache.has(src)) {
      return this.cache.get(src);
    }

    // Check if already loading
    if (this.loading.has(src)) {
      return this.loading.get(src);
    }

    // Start loading
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
   * Map node type to sprite biome directory
   * Each biome has its own tile set; base is used as fallback when biome tiles don't exist.
   * @param {string} nodeType - Node type (forest, cave, mountain, etc.)
   * @returns {string} Biome directory
   */
  getSpriteBiome(nodeType) {
    const biomeMap = {
      forest: 'forest',
      cave: 'cave',
      mountain: 'mountain',
      bridge: 'bridge',
      castle: 'castle',
      // Village/city use base since they don't have unique terrain
      village: 'base',
      city: 'base',
      default: 'base'
    };
    return biomeMap[nodeType] || biomeMap.default;
  }

  /**
   * Load terrain tile sprite
   * @param {string} terrain - Terrain type (grass, stone, forest, etc.)
   * @param {string} nodeType - Node type for biome-specific tiles (forest, cave, mountain, etc.)
   * @param {number} [variant=0] - Tile variant index (0-3)
   */
  async loadTile(terrain, nodeType, variant = 0) {
    const biome = this.getSpriteBiome(nodeType);
    const path = `${this.basePath}/terrain/${biome}/${terrain}_${variant}.png`;
    try {
      return await this.loadImage(path);
    } catch {
      // Fallback to base biome
      try {
        return await this.loadImage(`${this.basePath}/terrain/base/${terrain}_${variant}.png`);
      } catch {
        // Try without variant
        try {
          return await this.loadImage(`${this.basePath}/terrain/base/${terrain}.png`);
        } catch {
          return null;
        }
      }
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
    const primaryPath = `${this.basePath}/terrain/${biome}/${terrain}_${variant}.png`;
    const fallbackPath = `${this.basePath}/terrain/base/${terrain}_${variant}.png`;

    return this.cache.get(primaryPath) ||
           this.cache.get(fallbackPath) ||
           this.cache.get(`${this.basePath}/terrain/base/${terrain}.png`) ||
           null;
  }

  /**
   * Load elevated terrain tile sprite
   * @deprecated Elevation is now rendered using stacking (separate floor + wall tiles).
   * Use getTile() for floor surfaces and getWallTexture() for wall faces.
   * This method is kept for backward compatibility but always returns null.
   * @param {string} _terrain - Terrain type (unused)
   * @param {number} _elevation - Elevation level (unused)
   * @param {string} _nodeType - Node type (unused)
   * @returns {Promise<null>} Always returns null
   */
  async loadElevatedTile(_terrain, _elevation, _nodeType) {
    // DEPRECATED: Embedded elevation sprites (*_elev*.png, *_pit.png) are no longer used.
    // The unified stacking system renders walls separately from floor tiles.
    // See BattleGrid.renderTileUnified() for the new approach.
    return null;
  }

  /**
   * Get elevated terrain tile (sync)
   * @deprecated Elevation is now rendered using stacking (separate floor + wall tiles).
   * Use getTile() for floor surfaces and getWallTexture() for wall faces.
   * This method is kept for backward compatibility but always returns null.
   * @param {string} _terrain - Terrain type (unused)
   * @param {number} _elevation - Elevation level (unused)
   * @param {string} _nodeType - Node type (unused)
   * @returns {null} Always returns null
   */
  getElevatedTile(_terrain, _elevation, _nodeType) {
    // DEPRECATED: Embedded elevation sprites are no longer used.
    // The unified stacking system renders walls separately from floor tiles.
    return null;
  }

  /**
   * Load elevation transition indicator sprite
   * @param {string} indicatorType - Type: 'ramp', 'stairs', 'ledge', 'cliff'
   * @param {string} nodeType - Node type for biome lookup
   */
  async loadElevationIndicator(indicatorType, nodeType) {
    const biome = this.getSpriteBiome(nodeType);
    const path = `${this.basePath}/terrain/${biome}/indicators/${indicatorType}_indicator.png`;
    try {
      return await this.loadImage(path);
    } catch {
      // Fallback to base biome
      try {
        return await this.loadImage(`${this.basePath}/terrain/base/indicators/${indicatorType}_indicator.png`);
      } catch {
        return null;
      }
    }
  }

  /**
   * Get elevation transition indicator (sync)
   */
  getElevationIndicator(indicatorType, nodeType) {
    const biome = this.getSpriteBiome(nodeType);
    const primaryPath = `${this.basePath}/terrain/${biome}/indicators/${indicatorType}_indicator.png`;
    const fallbackPath = `${this.basePath}/terrain/base/indicators/${indicatorType}_indicator.png`;

    return this.cache.get(primaryPath) || this.cache.get(fallbackPath) || null;
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
   * @param {string} charClass - Character class (warrior, wizard, monk, chemist)
   * @param {string} animation - Animation type (idle, walk, attack, hit, death, victory)
   * @param {string} [type='player'] - 'player' or 'enemy'
   * @returns {Promise<HTMLImageElement|null>} Loaded sprite or null if failed
   */
  async loadCharacterSprite(charClass, animation, type = 'player') {
    const basePath = type === 'player'
      ? `${this.basePath}/characters/player/${charClass}`
      : `${this.basePath}/characters/enemies/${charClass}`;

    const path = `${basePath}/${charClass}_${animation}.png`;
    try {
      return await this.loadImage(path);
    } catch {
      return null;
    }
  }

  /**
   * Get character sprite (sync)
   */
  getCharacterSprite(charClass, animation, type = 'player') {
    const basePath = type === 'player'
      ? `${this.basePath}/characters/player/${charClass}`
      : `${this.basePath}/characters/enemies/${charClass}`;
    return this.cache.get(`${basePath}/${charClass}_${animation}.png`) || null;
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
    return `${this.basePath}/characters/equipped/${race}_${charClass}_${hash}/${animation}.png`;
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
      const charClass = character.class?.toLowerCase() || 'wizard';
      return this.loadCharacterSprite(charClass, animation, 'player');
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
  async preloadEquippedCharacter(character, animations = ['idle', 'walk', 'attack', 'hit', 'death']) {
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
   * @param {string} biome - Biome (forest, cave, mountain, bridge)
   */
  async loadEnemySprite(enemyId, animation = 'idle', biome = 'forest') {
    const path = `${this.basePath}/characters/enemies/${biome}/${enemyId}/${enemyId}_${animation}.png`;
    try {
      return await this.loadImage(path);
    } catch {
      return null;
    }
  }

  /**
   * Get enemy sprite (sync)
   */
  getEnemySprite(enemyId, animation = 'idle', biome = 'forest') {
    const path = `${this.basePath}/characters/enemies/${biome}/${enemyId}/${enemyId}_${animation}.png`;
    return this.cache.get(path) || null;
  }

  /**
   * Load world map node sprite
   * @param {string} nodeType - Node type (castle, city, village, etc.)
   * @param {string} [guildClass] - For guild nodes, the class (warrior, wizard, monk, chemist)
   */
  async loadNodeSprite(nodeType, guildClass = null) {
    // Resolve aliases first (e.g., fishing_spot → fishing)
    const resolvedType = this.nodeTypeAliases[nodeType] || nodeType;

    // Handle guild class variants - try class-specific sprite first
    if (resolvedType === 'guild' && guildClass) {
      const classPath = `${this.basePath}/nodes/node_guild_${guildClass}.png`;
      try {
        return await this.loadImage(classPath);
      } catch {
        // Fall back to generic guild sprite
      }
    }

    const filename = `node_${resolvedType}`;
    const path = `${this.basePath}/nodes/${filename}.png`;
    try {
      return await this.loadImage(path);
    } catch {
      return null;
    }
  }

  /**
   * Get node sprite (sync)
   */
  getNodeSprite(nodeType, guildClass = null) {
    // Resolve aliases first (e.g., fishing_spot → fishing)
    const resolvedType = this.nodeTypeAliases[nodeType] || nodeType;

    // Handle guild class variants - try class-specific sprite first
    if (resolvedType === 'guild' && guildClass) {
      const classSprite = this.cache.get(`${this.basePath}/nodes/node_guild_${guildClass}.png`);
      if (classSprite) return classSprite;
      // Fall back to generic guild sprite
    }

    const filename = `node_${resolvedType}`;
    return this.cache.get(`${this.basePath}/nodes/${filename}.png`) || null;
  }

  /**
   * Load item icon
   * @param {Object} item - Item object with type, templateId, material, rarity
   */
  async loadItemIcon(item) {
    // Try specific item first
    const category = this.getItemCategory(item.type || item.item_type);
    const templateId = item.templateId || item.template_id || item.type;
    const material = item.material || 'default';

    // Try material-specific
    const path = `${this.basePath}/items/${category}/${templateId}_${material}.png`;
    try {
      return await this.loadImage(path);
    } catch {
      // Try base template
      try {
        return await this.loadImage(`${this.basePath}/items/${category}/${templateId}.png`);
      } catch {
        return null;
      }
    }
  }

  /**
   * Get item icon (sync)
   */
  getItemIcon(item) {
    const category = this.getItemCategory(item.type || item.item_type);
    const templateId = item.templateId || item.template_id || item.type;
    const material = item.material || 'default';

    return this.cache.get(`${this.basePath}/items/${category}/${templateId}_${material}.png`)
      || this.cache.get(`${this.basePath}/items/${category}/${templateId}.png`)
      || null;
  }

  /**
   * Load obstacle sprite
   * @param {string} obstacleType - Type (rock_small, oak_tree, etc.)
   * @param {string} category - Category (rocks, trees)
   */
  async loadObstacle(obstacleType, category) {
    const path = `${this.basePath}/obstacles/${category}/${obstacleType}.png`;
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
    return this.cache.get(`${this.basePath}/obstacles/${category}/${obstacleType}.png`) || null;
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
      dagger: 'weapons',
      bow: 'weapons',
      armor: 'armor',
      helmet: 'armor',
      body: 'armor',
      boots: 'armor',
      shield: 'armor',
      accessory: 'accessories',
      ring: 'accessories',
      amulet: 'accessories',
      cloak: 'accessories',
      consumable: 'consumables',
      potion: 'consumables',
      scroll: 'consumables',
      material: 'materials',
      key_item: 'misc'
    };
    return categories[type] || 'misc';
  }

  // =====================
  // Layered Item Compositing System
  // =====================

  /**
   * Rarity overlay alpha values for compositing
   * Higher rarity = more visible glow effect
   */
  static RARITY_ALPHA = {
    common: 0,        // No overlay for common items
    uncommon: 0.5,
    rare: 0.65,
    epic: 0.75,
    legendary: 0.85
  };

  /**
   * Standard overlay size for item compositing
   */
  static COMPOSITE_SIZE = 128;

  /**
   * Load and composite an item sprite with rarity and augment overlays
   * @param {string} itemId - Item template identifier
   * @param {string} category - Item category (weapons, armor, accessories, etc.)
   * @param {string} [rarity='common'] - Item rarity (common, uncommon, rare, epic, legendary)
   * @param {string|null} [augment=null] - Augment type (fire, ice, lightning, poison, holy, dark)
   * @returns {Promise<HTMLImageElement|null>} Composited item image or null if base not found
   */
  async loadItemComposite(itemId, category, rarity = 'common', augment = null) {
    // Generate cache key for this specific combination
    const cacheKey = `item_${itemId}_${rarity}_${augment || 'none'}`;

    // Return cached composite if available
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Load base item sprite
    const basePath = `${this.basePath}/items/${category}/${itemId}.png`;
    let baseImage;
    try {
      baseImage = await this.loadImage(basePath);
    } catch {
      console.warn(`[AssetLoader] Failed to load base item: ${basePath}`);
      return null;
    }

    // Load rarity overlay if not common
    let rarityOverlay = null;
    if (rarity && rarity !== 'common') {
      const rarityPath = `${this.basePath}/overlays/rarity/rarity_${rarity}.png`;
      try {
        rarityOverlay = await this.loadImage(rarityPath);
      } catch {
        console.warn(`[AssetLoader] Rarity overlay not found: ${rarityPath}`);
      }
    }

    // Load augment overlay if specified
    let augmentOverlay = null;
    if (augment) {
      const augmentPath = `${this.basePath}/overlays/augments/augment_${augment}.png`;
      try {
        augmentOverlay = await this.loadImage(augmentPath);
      } catch {
        console.warn(`[AssetLoader] Augment overlay not found: ${augmentPath}`);
      }
    }

    // Compose the final sprite
    const composite = this.composeItemSprite(baseImage, rarityOverlay, augmentOverlay, rarity);

    // Cache the composited image
    this.cache.set(cacheKey, composite);

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
  composeItemSprite(base, rarityOverlay, augmentOverlay, rarity) {
    const size = AssetLoader.COMPOSITE_SIZE;

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
      const rarityAlpha = AssetLoader.RARITY_ALPHA[rarity] || 0;
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
   * Use loadItemComposite() to load asynchronously
   * @param {string} itemId - Item template identifier
   * @param {string} category - Item category (unused but kept for API consistency)
   * @param {string} [rarity='common'] - Item rarity
   * @param {string|null} [augment=null] - Augment type
   * @returns {HTMLImageElement|null} Cached composite or null
   */
  getItemComposite(itemId, category, rarity = 'common', augment = null) {
    const cacheKey = `item_${itemId}_${rarity}_${augment || 'none'}`;
    return this.cache.get(cacheKey) || null;
  }

  /**
   * Preload all overlay assets (rarity and augment overlays)
   * Call this during initial asset loading to ensure overlays are ready
   * @returns {Promise<PromiseSettledResult<HTMLImageElement>[]>}
   */
  async preloadOverlays() {
    const rarities = ['uncommon', 'rare', 'epic', 'legendary'];
    const augments = [
      // Elemental augments
      'fire', 'ice', 'lightning', 'poison', 'holy', 'dark', 'earth', 'wind',
      // Combat augments
      'critical', 'lifesteal', 'speed', 'pierce', 'stun', 'chain'
    ];

    const promises = [
      // Preload rarity overlays
      ...rarities.map(rarity =>
        this.loadImage(`${this.basePath}/overlays/rarity/rarity_${rarity}.png`)
          .catch(() => null) // Don't fail if overlay doesn't exist
      ),
      // Preload augment overlays
      ...augments.map(augment =>
        this.loadImage(`${this.basePath}/overlays/augments/augment_${augment}.png`)
          .catch(() => null) // Don't fail if overlay doesn't exist
      )
    ];

    const results = await Promise.allSettled(promises);
    const loaded = results.filter(r => r.status === 'fulfilled' && r.value).length;
    console.log(`[AssetLoader] Overlay preload: ${loaded}/${results.length} loaded`);
    return results;
  }

  /**
   * Preload item composites for a list of items
   * Useful for preloading inventory or shop items
   * @param {Array<{itemId: string, category: string, rarity?: string, augment?: string}>} items
   * @returns {Promise<PromiseSettledResult<HTMLImageElement>[]>}
   */
  async preloadItemComposites(items) {
    const promises = items.map(item =>
      this.loadItemComposite(
        item.itemId,
        item.category,
        item.rarity || 'common',
        item.augment || null
      )
    );

    const results = await Promise.allSettled(promises);
    const loaded = results.filter(r => r.status === 'fulfilled' && r.value).length;
    console.log(`[AssetLoader] Item composite preload: ${loaded}/${results.length} loaded`);
    return results;
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
    // New convention (primary)
    const key = `${this.basePath}/terrain/${biome}/walls/${terrain}_wall.png`;
    const fallbackKey = `${this.basePath}/terrain/${biome}/walls/default_wall.png`;
    const baseFallbackKey = `${this.basePath}/terrain/base/walls/${terrain}_wall.png`;
    // Legacy convention (fallback)
    const legacyKey = `${this.basePath}/terrain/${biome}/wall_${biome}_${terrain}.png`;
    const legacyDefaultKey = `${this.basePath}/terrain/${biome}/wall_${biome}_default.png`;
    const legacyBaseKey = `${this.basePath}/terrain/base/wall_base_${terrain}.png`;

    return this.cache.get(key) ||
           this.cache.get(fallbackKey) ||
           this.cache.get(baseFallbackKey) ||
           this.cache.get(legacyKey) ||
           this.cache.get(legacyDefaultKey) ||
           this.cache.get(legacyBaseKey) ||
           null;
  }

  /**
   * Load wall texture for a terrain/biome type
   * @param {string} biome - Biome type
   * @param {string} terrain - Terrain type
   * @returns {Promise<HTMLImageElement|null>}
   */
  async loadWallTexture(biome, terrain = 'default') {
    const paths = [
      // New convention (primary)
      `${this.basePath}/terrain/${biome}/walls/${terrain}_wall.png`,
      `${this.basePath}/terrain/${biome}/walls/default_wall.png`,
      `${this.basePath}/terrain/base/walls/${terrain}_wall.png`,
      // Legacy convention (fallback - existing files)
      `${this.basePath}/terrain/${biome}/wall_${biome}_${terrain}.png`,
      `${this.basePath}/terrain/${biome}/wall_${biome}_default.png`,
      `${this.basePath}/terrain/base/wall_base_${terrain}.png`
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
   * Get slope sprite for elevation transitions
   * @param {string} biome - Biome type
   * @param {string} direction - Slope direction (north, south, east, west)
   * @param {number} levels - Number of elevation levels (1-3)
   * @returns {HTMLImageElement|null} Slope sprite or null if not found
   */
  getSlopeSprite(biome, direction, levels = 1) {
    // New convention (primary)
    const key = `${this.basePath}/terrain/${biome}/slopes/${direction}_${levels}.png`;
    const fallbackKey = `${this.basePath}/terrain/${biome}/slopes/${direction}_1.png`;
    const baseFallbackKey = `${this.basePath}/terrain/base/slopes/${direction}_${levels}.png`;
    // Legacy convention (fallback)
    const legacyKey = `${this.basePath}/terrain/${biome}/slope_${biome}_${direction}_${levels}.png`;
    const legacyBaseKey = `${this.basePath}/terrain/base/slope_base_${direction}_${levels}.png`;

    return this.cache.get(key) ||
           this.cache.get(fallbackKey) ||
           this.cache.get(baseFallbackKey) ||
           this.cache.get(legacyKey) ||
           this.cache.get(legacyBaseKey) ||
           null;
  }

  /**
   * Load slope sprite for elevation transitions
   * @param {string} biome - Biome type
   * @param {string} direction - Slope direction
   * @param {number} levels - Number of elevation levels (1-3)
   * @returns {Promise<HTMLImageElement|null>}
   */
  async loadSlopeSprite(biome, direction, levels = 1) {
    const paths = [
      // New convention (primary)
      `${this.basePath}/terrain/${biome}/slopes/${direction}_${levels}.png`,
      `${this.basePath}/terrain/${biome}/slopes/${direction}_1.png`,
      `${this.basePath}/terrain/base/slopes/${direction}_${levels}.png`,
      // Legacy convention (fallback - existing files)
      `${this.basePath}/terrain/${biome}/slope_${biome}_${direction}_${levels}.png`,
      `${this.basePath}/terrain/base/slope_base_${direction}_${levels}.png`
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
   * Get top tile sprite for stacking (flat surface only)
   * @param {string} biome - Biome type
   * @param {string} terrain - Terrain type
   * @returns {HTMLImageElement|null} Top tile sprite or null
   */
  getTopTileSprite(biome, terrain) {
    // First try new naming convention with _top suffix
    const newKey = `${this.basePath}/terrain/${biome}/${terrain}_top.png`;
    // Then try biome-specific terrain without suffix (current system)
    const biomeKey = `${this.basePath}/terrain/${biome}/${terrain}.png`;
    // Fall back to base biome with variant
    const baseKey = `${this.basePath}/terrain/base/${terrain}_0.png`;

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
      `${this.basePath}/terrain/${biome}/${terrain}_top.png`,
      `${this.basePath}/terrain/${biome}/${terrain}.png`,
      `${this.basePath}/terrain/base/${terrain}_0.png`
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

    // Load slope sprites for all directions and levels
    for (const direction of directions) {
      for (const level of levels) {
        promises.push(this.loadSlopeSprite(biome, direction, level));
      }
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
  static INDICATOR_TYPES = ['ramp', 'stairs', 'ledge', 'cliff'];

  /**
   * Preload terrain tiles for a biome (unified stacking system)
   * Loads floor tiles and wall textures - elevation variants are deprecated.
   * @param {string} nodeType - Node type for biome-specific sprites
   * @param {Object} options - Preload options
   * @param {boolean} options.includeElevation - DEPRECATED: ignored, elevation sprites no longer used
   * @param {boolean} options.includeIndicators - Also preload transition indicators
   * @param {boolean} options.includeWalls - Also preload wall textures (default: true)
   */
  async preloadTerrainSet(nodeType, options = {}) {
    const { includeIndicators = true, includeWalls = true } = options;
    const promises = [];
    const biome = this.getSpriteBiome(nodeType);

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

    // Load transition indicators if requested
    if (includeIndicators) {
      for (const indicator of AssetLoader.INDICATOR_TYPES) {
        promises.push(this.loadElevationIndicator(indicator, nodeType));
      }
    }

    const results = await Promise.allSettled(promises);
    const loaded = results.filter(r => r.status === 'fulfilled' && r.value).length;
    const failed = results.filter(r => r.status === 'rejected');
    console.log(`[AssetLoader] Terrain preload for ${nodeType}: ${loaded}/${results.length} loaded`);
    if (failed.length > 0) {
      console.warn(`[AssetLoader] ${failed.length} terrain tiles failed:`, failed[0]?.reason?.message);
    }
    return results;
  }

  /**
   * Preload character sprites
   */
  async preloadCharacter(charClass, animations = ['idle', 'walk', 'attack', 'hit', 'death']) {
    const promises = animations.map(anim => this.loadCharacterSprite(charClass, anim));
    return Promise.allSettled(promises);
  }

  /**
   * Preload enemies for a biome
   */
  async preloadEnemies(biome, enemyIds) {
    const animations = ['idle', 'attack', 'hit', 'death'];
    const promises = [];

    for (const enemyId of enemyIds) {
      for (const anim of animations) {
        promises.push(this.loadEnemySprite(enemyId, anim, biome));
      }
    }

    return Promise.allSettled(promises);
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
    const path = `${this.basePath}/nodes/backdrop/${tileName}.png`;
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
    return this.cache.get(`${this.basePath}/nodes/backdrop/${tileName}.png`) || null;
  }

  /**
   * Load world map path texture
   * @param {string} pathType - Path type (dirt_road, stone_path, bridge_planks)
   */
  async loadPathTexture(pathType) {
    const path = `${this.basePath}/nodes/paths/${pathType}.png`;
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
    return this.cache.get(`${this.basePath}/nodes/paths/${pathType}.png`) || null;
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
   */
  async preloadObstacles() {
    // Define all obstacles by category matching generate-obstacles.js
    const obstacles = {
      rocks: ['rock_small', 'rock_medium', 'rock_large', 'stalagmite', 'mountain_boulder'],
      trees: ['oak_tree', 'pine_tree', 'dead_tree', 'mushroom_large', 'mountain_pine']
    };

    const promises = [];

    for (const [category, obstacleTypes] of Object.entries(obstacles)) {
      for (const obstacleType of obstacleTypes) {
        promises.push(this.loadObstacle(obstacleType, category));
      }
    }

    const results = await Promise.allSettled(promises);
    const loaded = results.filter(r => r.status === 'fulfilled' && r.value).length;
    console.log(`Preloaded ${loaded}/${results.length} obstacle sprites`);
    return results;
  }

  /**
   * Preload assets for battle scene
   */
  async preloadBattleAssets(nodeType, playerClasses, enemyIds) {
    console.log(`Preloading battle assets for ${nodeType}...`);

    const tasks = [
      this.preloadTerrainSet(nodeType),
      ...playerClasses.map(cls => this.preloadCharacter(cls)),
      this.preloadEnemies(nodeType, enemyIds)
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
   */
  getStats() {
    return {
      cachedImages: this.cache.size,
      loadingImages: this.loading.size
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    this.loading.clear();
  }

  /**
   * Check if sprite exists in cache
   */
  hasSprite(path) {
    return this.cache.has(path);
  }
}
