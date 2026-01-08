/**
 * Portrait Service
 * Handles generation and caching of character portraits
 *
 * Portraits are 64x64 images of character faces based on race, gender, and class.
 * They are static (unlike equipped character sprites) so we generate all combinations upfront.
 *
 * Portrait path structure: assets/sprites/portraits/{race}_{gender}_{class}.png
 * 120 total combinations: 5 races × 3 genders × 8 classes
 */

const path = require('path');
const fs = require('fs').promises;
const { getPixelLabClient } = require('./pixelLabService');
const { buildPortraitPrompt } = require('../config/pixelLabPrompts');

// All possible combinations
const RACES = ['human', 'elf', 'dwarf', 'vampire', 'orc'];
const GENDERS = ['male', 'female', 'other'];
const CLASSES = ['warrior', 'wizard', 'monk', 'chemist', 'berserker', 'sorcerer', 'ninja', 'alchemist'];

class PortraitService {
  constructor() {
    this.pixelLab = null;
    // Go up from api/ to project root, then into frontend/
    this.portraitDir = path.join(__dirname, '../../../frontend', 'public', 'assets', 'sprites', 'portraits');
    this.generationQueue = new Map();
  }

  /**
   * Initialize the service
   */
  async initialize() {
    if (!this.pixelLab) {
      this.pixelLab = getPixelLabClient();
    }
    await fs.mkdir(this.portraitDir, { recursive: true });
  }

  /**
   * Get portrait filename
   * @param {string} race - Character race
   * @param {string} gender - Character gender
   * @param {string} charClass - Character class
   * @returns {string} Filename
   */
  getPortraitFilename(race, gender, charClass) {
    return `${race}_${gender}_${charClass}.png`;
  }

  /**
   * Get full portrait path
   * @param {string} race - Character race
   * @param {string} gender - Character gender
   * @param {string} charClass - Character class
   * @returns {string} Full file path
   */
  getPortraitPath(race, gender, charClass) {
    return path.join(this.portraitDir, this.getPortraitFilename(race, gender, charClass));
  }

  /**
   * Get portrait URL for frontend
   * @param {string} race - Character race
   * @param {string} gender - Character gender
   * @param {string} charClass - Character class
   * @returns {string} URL path
   */
  getPortraitUrl(race, gender, charClass) {
    return `/assets/sprites/portraits/${this.getPortraitFilename(race, gender, charClass)}`;
  }

  /**
   * Check if portrait exists
   * @param {string} race - Character race
   * @param {string} gender - Character gender
   * @param {string} charClass - Character class
   * @returns {Promise<boolean>}
   */
  async portraitExists(race, gender, charClass) {
    try {
      await fs.access(this.getPortraitPath(race, gender, charClass));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate a single portrait
   * @param {string} race - Character race
   * @param {string} gender - Character gender
   * @param {string} charClass - Character class
   * @param {boolean} force - Force regeneration if exists
   * @returns {Promise<Object>} Generation result
   */
  async generatePortrait(race, gender, charClass, force = false) {
    await this.initialize();

    const portraitPath = this.getPortraitPath(race, gender, charClass);

    // Check if already exists
    if (!force && await this.portraitExists(race, gender, charClass)) {
      return {
        success: true,
        path: portraitPath,
        url: this.getPortraitUrl(race, gender, charClass),
        cached: true
      };
    }

    // Check if generation is in progress
    const queueKey = `${race}_${gender}_${charClass}`;
    if (this.generationQueue.has(queueKey)) {
      return this.generationQueue.get(queueKey);
    }

    // Start generation
    const generationPromise = this._doGeneratePortrait(race, gender, charClass, portraitPath);
    this.generationQueue.set(queueKey, generationPromise);

    try {
      return await generationPromise;
    } finally {
      this.generationQueue.delete(queueKey);
    }
  }

  /**
   * Internal portrait generation
   */
  async _doGeneratePortrait(race, gender, charClass, portraitPath) {
    const prompt = buildPortraitPrompt(race, gender, charClass);
    console.log(`Generating portrait for ${race} ${gender} ${charClass}`);
    console.log(`Prompt: ${prompt}`);

    try {
      const result = await this.pixelLab.generateImageV2({
        description: prompt,
        image_size: { width: 64, height: 64 },
        no_background: true
      });

      await this.pixelLab.saveImage(result, portraitPath);

      return {
        success: true,
        path: portraitPath,
        url: this.getPortraitUrl(race, gender, charClass),
        cached: false
      };
    } catch (error) {
      console.error(`Failed to generate portrait for ${race} ${gender} ${charClass}:`, error.message);
      return {
        success: false,
        error: error.message,
        race,
        gender,
        charClass
      };
    }
  }

  /**
   * Get or generate portrait for a character
   * @param {Object} character - Character object with race, gender, class
   * @returns {Promise<Object>} Portrait info
   */
  async getOrGeneratePortrait(character) {
    const race = character.race?.toLowerCase() || 'human';
    const gender = character.gender?.toLowerCase() || 'other';
    const charClass = character.class?.toLowerCase() || 'warrior';

    return this.generatePortrait(race, gender, charClass);
  }

  /**
   * Generate all missing portraits
   * @param {Function} onProgress - Progress callback (current, total, info)
   * @returns {Promise<Object>} Generation summary
   */
  async generateAllPortraits(onProgress = null) {
    await this.initialize();

    const results = {
      total: RACES.length * GENDERS.length * CLASSES.length,
      generated: 0,
      skipped: 0,
      failed: 0,
      errors: []
    };

    let current = 0;

    for (const race of RACES) {
      for (const gender of GENDERS) {
        for (const charClass of CLASSES) {
          current++;

          if (onProgress) {
            onProgress(current, results.total, { race, gender, charClass });
          }

          // Check if exists
          if (await this.portraitExists(race, gender, charClass)) {
            results.skipped++;
            continue;
          }

          // Generate
          const result = await this.generatePortrait(race, gender, charClass);

          if (result.success) {
            results.generated++;
          } else {
            results.failed++;
            results.errors.push({
              race,
              gender,
              charClass,
              error: result.error
            });
          }

          // Rate limiting - wait between API calls
          await this._delay(500);
        }
      }
    }

    return results;
  }

  /**
   * Get status of all portraits
   * @returns {Promise<Object>} Status summary
   */
  async getPortraitStatus() {
    await this.initialize();

    const status = {
      total: RACES.length * GENDERS.length * CLASSES.length,
      existing: 0,
      missing: [],
      portraits: []
    };

    for (const race of RACES) {
      for (const gender of GENDERS) {
        for (const charClass of CLASSES) {
          const exists = await this.portraitExists(race, gender, charClass);

          if (exists) {
            status.existing++;
            status.portraits.push({
              race,
              gender,
              charClass,
              url: this.getPortraitUrl(race, gender, charClass)
            });
          } else {
            status.missing.push({ race, gender, charClass });
          }
        }
      }
    }

    return status;
  }

  /**
   * Clear all portraits
   * @returns {Promise<boolean>}
   */
  async clearAllPortraits() {
    try {
      await fs.rm(this.portraitDir, { recursive: true, force: true });
      await fs.mkdir(this.portraitDir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Helper delay function
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
let instance = null;

function getPortraitService() {
  if (!instance) {
    instance = new PortraitService();
  }
  return instance;
}

module.exports = {
  PortraitService,
  getPortraitService,
  RACES,
  GENDERS,
  CLASSES
};
