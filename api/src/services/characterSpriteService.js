/**
 * Character Sprite Service
 * Handles on-demand generation of character sprites with equipment
 *
 * Uses PixelLab API to generate sprites and caches them aggressively
 * to avoid regenerating the same equipment combinations.
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const { getPixelLabClient } = require('./pixelLabService');
const { getAssetCacheManager } = require('./assetCacheManager');
const {
  RACE_PROMPTS,
  EQUIPMENT_PROMPTS,
  WIZARD_ANIMATION_ACTIONS,
  STYLE_SUFFIX,
  buildEquippedCharacterPrompt,
  buildWizardAnimationPrompt
} = require('../config/pixelLabPrompts');

// Animation states and their PixelLab templates
const ANIMATION_TEMPLATES = {
  idle: 'breathing-idle',
  walk: 'walking',
  attack: 'attack-forward',
  hit: 'hit-react',
  death: 'death-fall'
};

// Animation frame counts
const ANIMATION_FRAMES = {
  idle: 4,
  walk: 8,
  attack: 6,
  hit: 4,
  death: 8
};

class CharacterSpriteService {
  constructor() {
    this.pixelLab = null;
    this.cacheManager = null;
    this.spriteDir = path.join(process.cwd(), 'frontend', 'public', 'assets', 'sprites', 'characters', 'equipped');
    this.generationQueue = new Map(); // Track in-progress generations
  }

  /**
   * Initialize the service
   */
  async initialize() {
    if (!this.pixelLab) {
      this.pixelLab = getPixelLabClient();
      this.cacheManager = getAssetCacheManager();
    }
    await fs.mkdir(this.spriteDir, { recursive: true });
  }

  /**
   * Generate equipment hash for cache key
   * @param {Object} character - Character data with race, class, and equipped items
   * @returns {string} Hash string for cache lookup
   */
  generateEquipmentHash(character) {
    const equipped = {
      race: character.race?.toLowerCase() || 'human',
      class: character.class?.toLowerCase() || 'wizard',
      weapon: this.getEquippedItemId(character, 'main_hand'),
      armor: this.getEquippedItemId(character, 'body'),
      head: this.getEquippedItemId(character, 'head')
    };

    return crypto.createHash('sha256')
      .update(JSON.stringify(equipped))
      .digest('hex')
      .substring(0, 12);
  }

  /**
   * Get equipped item ID from character data
   */
  getEquippedItemId(character, slot) {
    if (!character.equippedItems) return 'none';
    const item = character.equippedItems[slot];
    return item?.template_id?.toString() || item?.name?.toLowerCase().replace(/\s+/g, '_') || 'none';
  }

  /**
   * Get sprite directory path for a character
   */
  getSpriteDir(race, charClass, hash) {
    return path.join(this.spriteDir, `${race}_${charClass}_${hash}`);
  }

  /**
   * Check if sprite exists for character
   * @param {Object} character - Character data
   * @returns {Object} { exists: boolean, path: string, hash: string }
   */
  async checkSpriteExists(character) {
    await this.initialize();

    const race = character.race?.toLowerCase() || 'human';
    const charClass = character.class?.toLowerCase() || 'wizard';
    const hash = this.generateEquipmentHash(character);
    const spriteDir = this.getSpriteDir(race, charClass, hash);

    try {
      const idlePath = path.join(spriteDir, 'idle.png');
      await fs.access(idlePath);
      return { exists: true, path: spriteDir, hash };
    } catch {
      return { exists: false, path: spriteDir, hash };
    }
  }

  /**
   * Get or generate sprite for character
   * @param {Object} character - Character data with equipment
   * @param {boolean} forceRegenerate - Force regeneration even if cached
   * @returns {Promise<Object>} Sprite info with paths
   */
  async getOrGenerateSprite(character, forceRegenerate = false) {
    await this.initialize();

    const race = character.race?.toLowerCase() || 'human';
    const charClass = character.class?.toLowerCase() || 'wizard';
    const hash = this.generateEquipmentHash(character);
    const spriteDir = this.getSpriteDir(race, charClass, hash);

    // Check if already generated
    if (!forceRegenerate) {
      const { exists } = await this.checkSpriteExists(character);
      if (exists) {
        return this.getSpriteInfo(spriteDir, hash);
      }
    }

    // Check if generation is already in progress
    const queueKey = `${race}_${charClass}_${hash}`;
    if (this.generationQueue.has(queueKey)) {
      // Wait for existing generation to complete
      return this.generationQueue.get(queueKey);
    }

    // Start generation
    const generationPromise = this.generateSprite(character, spriteDir, hash);
    this.generationQueue.set(queueKey, generationPromise);

    try {
      const result = await generationPromise;
      return result;
    } finally {
      this.generationQueue.delete(queueKey);
    }
  }

  /**
   * Generate sprite for character
   */
  async generateSprite(character, spriteDir, hash) {
    const race = character.race?.toLowerCase() || 'human';
    const charClass = character.class?.toLowerCase() || 'wizard';

    // Get equipment descriptions
    const weapon = this.getEquipmentPrompt(character, 'main_hand', 'weapons');
    const armor = this.getEquipmentPrompt(character, 'body', 'armor');

    console.log(`Generating sprite for ${race} ${charClass} with ${weapon || 'default weapon'} and ${armor || 'default armor'}`);

    await fs.mkdir(spriteDir, { recursive: true });

    // Generate base character with 8 directions
    const basePrompt = buildEquippedCharacterPrompt(race, charClass, weapon, armor);
    console.log(`Base prompt: ${basePrompt}`);

    const baseResult = await this.pixelLab.createCharacterWith8Directions({
      description: basePrompt,
      image_size: 64,
      outline: 'selective outline',
      shading: 'medium shading',
      detail: 'medium detail',
      isometric: true
    });

    // Save base sprite
    const basePath = path.join(spriteDir, 'base.png');
    await this.pixelLab.saveImage(baseResult, basePath);

    // Get character_id for animations if available
    const characterId = baseResult.character_id || baseResult.last_response?.character_id;

    // Generate animations
    const animations = ['idle', 'walk', 'attack', 'hit', 'death'];

    for (const anim of animations) {
      const animPath = path.join(spriteDir, `${anim}.png`);

      try {
        let animResult;

        if (characterId) {
          // Use character animation API
          animResult = await this.pixelLab.createCharacterAnimation({
            character_id: characterId,
            animation_template: ANIMATION_TEMPLATES[anim],
            outline: 'selective outline',
            shading: 'medium shading',
            detail: 'medium detail'
          });
        } else {
          // Fallback to text-based animation
          const animPrompt = buildWizardAnimationPrompt(race, anim);
          animResult = await this.pixelLab.animateWithText({
            character_description: basePrompt,
            action_description: animPrompt,
            image_size: 64,
            no_background: true
          });
        }

        await this.pixelLab.saveImage(animResult, animPath);
        console.log(`Generated ${anim} animation for ${race} ${charClass}`);

      } catch (error) {
        console.warn(`Failed to generate ${anim} animation:`, error.message);
        // Copy base as fallback
        await fs.copyFile(basePath, animPath);
      }
    }

    return this.getSpriteInfo(spriteDir, hash);
  }

  /**
   * Get equipment prompt from character
   */
  getEquipmentPrompt(character, slot, type) {
    if (!character.equippedItems) return null;

    const item = character.equippedItems[slot];
    if (!item) return null;

    // Try to find a matching prompt
    const itemKey = item.name?.toLowerCase().replace(/\s+/g, '_');
    if (EQUIPMENT_PROMPTS[type] && EQUIPMENT_PROMPTS[type][itemKey]) {
      return itemKey;
    }

    // Return the item name as-is for the prompt
    return item.name;
  }

  /**
   * Get sprite info for existing sprites
   */
  getSpriteInfo(spriteDir, hash) {
    const relativePath = spriteDir.replace(path.join(process.cwd(), 'frontend', 'public'), '');

    return {
      hash,
      path: spriteDir,
      relativePath,
      sprites: {
        base: `${relativePath}/base.png`,
        idle: `${relativePath}/idle.png`,
        walk: `${relativePath}/walk.png`,
        attack: `${relativePath}/attack.png`,
        hit: `${relativePath}/hit.png`,
        death: `${relativePath}/death.png`
      }
    };
  }

  /**
   * Get sprite URL for frontend
   */
  getSpriteUrl(character, animation = 'idle') {
    const race = character.race?.toLowerCase() || 'human';
    const charClass = character.class?.toLowerCase() || 'wizard';
    const hash = this.generateEquipmentHash(character);

    return `/assets/sprites/characters/equipped/${race}_${charClass}_${hash}/${animation}.png`;
  }

  /**
   * List all generated sprites
   */
  async listGeneratedSprites() {
    await this.initialize();

    try {
      const entries = await fs.readdir(this.spriteDir, { withFileTypes: true });
      const sprites = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const [race, charClass, hash] = entry.name.split('_');
          sprites.push({
            race,
            class: charClass,
            hash,
            path: path.join(this.spriteDir, entry.name)
          });
        }
      }

      return sprites;
    } catch (error) {
      return [];
    }
  }

  /**
   * Clear generated sprites for a character
   */
  async clearSprite(character) {
    const race = character.race?.toLowerCase() || 'human';
    const charClass = character.class?.toLowerCase() || 'wizard';
    const hash = this.generateEquipmentHash(character);
    const spriteDir = this.getSpriteDir(race, charClass, hash);

    try {
      await fs.rm(spriteDir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clear all generated sprites
   */
  async clearAllSprites() {
    try {
      await fs.rm(this.spriteDir, { recursive: true, force: true });
      await fs.mkdir(this.spriteDir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let instance = null;

function getCharacterSpriteService() {
  if (!instance) {
    instance = new CharacterSpriteService();
  }
  return instance;
}

module.exports = {
  CharacterSpriteService,
  getCharacterSpriteService
};
