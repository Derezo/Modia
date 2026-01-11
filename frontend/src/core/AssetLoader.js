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
        palace: '👑'
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
      character: {
        warrior: 'W',
        wizard: 'M',
        monk: 'K',
        chemist: 'C'
      },
      terrain: {
        grass: '#3d5c3d',
        stone: '#5a5a5a',
        forest: '#2d4a2d',
        water: '#3d5c7a',
        rock: '#4a4a4a',
        lava: '#7a3d3d',
        cliff: '#3a3a3a'
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
   * Load terrain tile sprite
   * @param {string} terrain - Terrain type (grass, stone, forest, etc.)
   * @param {string} nodeType - Node type for biome-specific tiles (forest, cave, mountain, etc.)
   * @param {number} [variant=0] - Tile variant index
   */
  async loadTile(terrain, nodeType, variant = 0) {
    const path = `${this.basePath}/terrain/${nodeType}/${terrain}_${variant}.png`;
    try {
      return await this.loadImage(path);
    } catch {
      // Try without variant
      try {
        return await this.loadImage(`${this.basePath}/terrain/${nodeType}/${terrain}.png`);
      } catch {
        return null;
      }
    }
  }

  /**
   * Get terrain tile (sync, returns null if not cached)
   */
  getTile(terrain, nodeType, variant = 0) {
    const path = `${this.basePath}/terrain/${nodeType}/${terrain}_${variant}.png`;
    return this.cache.get(path) || this.cache.get(`${this.basePath}/terrain/${nodeType}/${terrain}.png`) || null;
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
    const filename = guildClass ? `guild_${guildClass}` : nodeType;
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
    const filename = guildClass ? `guild_${guildClass}` : nodeType;
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
    let path = `${this.basePath}/items/${category}/${templateId}_${material}.png`;
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
   * @param {string} category - Category (rocks, trees, decorative)
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

  // =====================
  // Preloading
  // =====================

  /**
   * Preload terrain tiles for a biome
   */
  async preloadTerrainSet(nodeType) {
    if (!this.manifest?.terrain?.[nodeType]) {
      console.warn(`No terrain manifest for ${nodeType}`);
      return [];
    }

    const promises = [];
    const terrainConfig = this.manifest.terrain[nodeType];

    for (const [terrain, config] of Object.entries(terrainConfig)) {
      const variants = config.variants || 1;
      for (let v = 0; v < variants; v++) {
        promises.push(this.loadTile(terrain, nodeType, v));
      }
    }

    return Promise.allSettled(promises);
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
    const nodeTypes = ['castle', 'city', 'village', 'forest', 'cave', 'mountain', 'bridge', 'palace'];
    const guildClasses = ['warrior', 'wizard', 'monk', 'chemist'];

    const promises = [
      ...nodeTypes.map(type => this.loadNodeSprite(type)),
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
      trees: ['oak_tree', 'pine_tree', 'dead_tree', 'mushroom_large', 'mountain_pine'],
      decorative: ['grass_tufts', 'wildflowers', 'cave_crystals', 'fallen_log', 'stone_ruins']
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
