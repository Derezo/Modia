/**
 * AudioAssets - Asset manifest and preloading for game audio
 *
 * Defines all music tracks, sound effects, and UI sounds used in the game.
 * Supports placeholder audio generation via Web Audio API oscillators.
 */

// Audio asset definitions organized by category
export const AUDIO_MANIFEST = {
  music: {
    world_exploration: {
      path: '/assets/audio/music/world_exploration.mp3',
      loop: true,
      volume: 0.7,
      fadeIn: 2000,
      fadeOut: 1500
    },
    battle_combat: {
      path: '/assets/audio/music/battle_combat.mp3',
      loop: true,
      volume: 0.8,
      fadeIn: 1000,
      fadeOut: 1000
    },
    victory_fanfare: {
      path: '/assets/audio/music/victory_fanfare.mp3',
      loop: false,
      volume: 0.9,
      fadeIn: 0,
      fadeOut: 500
    },
    defeat_jingle: {
      path: '/assets/audio/music/defeat_jingle.mp3',
      loop: false,
      volume: 0.8,
      fadeIn: 0,
      fadeOut: 500
    },
    title_theme: {
      path: '/assets/audio/music/title_theme.mp3',
      loop: true,
      volume: 0.75,
      fadeIn: 2000,
      fadeOut: 2000
    },
    tavern_ambience: {
      path: '/assets/audio/music/tavern_ambience.mp3',
      loop: true,
      volume: 0.6,
      fadeIn: 1500,
      fadeOut: 1000
    },
    shop_theme: {
      path: '/assets/audio/music/shop_theme.mp3',
      loop: true,
      volume: 0.5,
      fadeIn: 1000,
      fadeOut: 500
    }
  },

  sfx: {
    // Combat sounds
    attack_hit: {
      path: '/assets/audio/sfx/attack_hit.mp3',
      volume: 0.8,
      variations: 3  // attack_hit_1.mp3, attack_hit_2.mp3, etc.
    },
    skill_cast: {
      path: '/assets/audio/sfx/skill_cast.mp3',
      volume: 0.7
    },
    critical_hit: {
      path: '/assets/audio/sfx/critical_hit.mp3',
      volume: 0.9
    },
    heal: {
      path: '/assets/audio/sfx/heal.mp3',
      volume: 0.7
    },
    miss: {
      path: '/assets/audio/sfx/miss.mp3',
      volume: 0.5
    },

    // Movement sounds
    footstep: {
      path: '/assets/audio/sfx/footstep.mp3',
      volume: 0.4,
      variations: 4
    },

    // Notification sounds
    level_up: {
      path: '/assets/audio/sfx/level_up.mp3',
      volume: 0.8
    },
    item_pickup: {
      path: '/assets/audio/sfx/item_pickup.mp3',
      volume: 0.6
    },
    gold_coins: {
      path: '/assets/audio/sfx/gold_coins.mp3',
      volume: 0.5
    },

    // Battle state sounds
    turn_start: {
      path: '/assets/audio/sfx/turn_start.mp3',
      volume: 0.6
    },
    enemy_turn: {
      path: '/assets/audio/sfx/enemy_turn.mp3',
      volume: 0.5
    }
  },

  ui: {
    button_click: {
      path: '/assets/audio/ui/button_click.mp3',
      volume: 0.5
    },
    button_hover: {
      path: '/assets/audio/ui/button_hover.mp3',
      volume: 0.3
    },
    menu_open: {
      path: '/assets/audio/ui/menu_open.mp3',
      volume: 0.4
    },
    menu_close: {
      path: '/assets/audio/ui/menu_close.mp3',
      volume: 0.4
    },
    tab_switch: {
      path: '/assets/audio/ui/tab_switch.mp3',
      volume: 0.3
    },
    error: {
      path: '/assets/audio/ui/error.mp3',
      volume: 0.5
    },
    success: {
      path: '/assets/audio/ui/success.mp3',
      volume: 0.5
    },
    notification: {
      path: '/assets/audio/ui/notification.mp3',
      volume: 0.4
    }
  }
};

/**
 * Placeholder audio generator configuration
 * Used when actual audio files are not available
 */
export const PLACEHOLDER_CONFIG = {
  music: {
    world_exploration: { frequency: 220, type: 'sine', duration: 0.5, silent: true },
    battle_combat: { frequency: 330, type: 'sawtooth', duration: 0.5, silent: true },
    victory_fanfare: { frequency: 440, type: 'sine', duration: 2, silent: false },
    defeat_jingle: { frequency: 165, type: 'sine', duration: 2, silent: false },
    title_theme: { frequency: 262, type: 'sine', duration: 0.5, silent: true },
    tavern_ambience: { frequency: 196, type: 'sine', duration: 0.5, silent: true },
    shop_theme: { frequency: 247, type: 'sine', duration: 0.5, silent: true }
  },
  sfx: {
    attack_hit: { frequency: 200, type: 'square', duration: 0.1, silent: false },
    skill_cast: { frequency: 600, type: 'sine', duration: 0.3, silent: false },
    critical_hit: { frequency: 800, type: 'sawtooth', duration: 0.15, silent: false },
    heal: { frequency: 523, type: 'sine', duration: 0.4, silent: false },
    miss: { frequency: 100, type: 'triangle', duration: 0.2, silent: false },
    footstep: { frequency: 80, type: 'triangle', duration: 0.05, silent: false },
    level_up: { frequency: 880, type: 'sine', duration: 0.5, silent: false },
    item_pickup: { frequency: 440, type: 'sine', duration: 0.1, silent: false },
    gold_coins: { frequency: 1200, type: 'sine', duration: 0.15, silent: false },
    turn_start: { frequency: 350, type: 'sine', duration: 0.2, silent: false },
    enemy_turn: { frequency: 180, type: 'square', duration: 0.15, silent: false }
  },
  ui: {
    button_click: { frequency: 800, type: 'square', duration: 0.05, silent: false },
    button_hover: { frequency: 600, type: 'sine', duration: 0.03, silent: false },
    menu_open: { frequency: 400, type: 'sine', duration: 0.1, silent: false },
    menu_close: { frequency: 300, type: 'sine', duration: 0.1, silent: false },
    tab_switch: { frequency: 500, type: 'sine', duration: 0.05, silent: false },
    error: { frequency: 150, type: 'sawtooth', duration: 0.2, silent: false },
    success: { frequency: 660, type: 'sine', duration: 0.15, silent: false },
    notification: { frequency: 550, type: 'sine', duration: 0.1, silent: false }
  }
};

/**
 * AudioAssets - Handles loading and caching of audio assets
 */
export class AudioAssets {
  constructor(audioContext) {
    this.context = audioContext;
    this.bufferCache = new Map();
    this.loadingPromises = new Map();
    this.usePlaceholders = true; // Use generated placeholders by default
  }

  /**
   * Get audio asset configuration
   * @param {string} category - 'music', 'sfx', or 'ui'
   * @param {string} id - Asset identifier
   * @returns {Object|null} Asset configuration
   */
  getAssetConfig(category, id) {
    return AUDIO_MANIFEST[category]?.[id] || null;
  }

  /**
   * Load an audio file into a buffer
   * @param {string} path - Path to audio file
   * @returns {Promise<AudioBuffer>}
   */
  async loadAudioBuffer(path) {
    // Check cache
    if (this.bufferCache.has(path)) {
      return this.bufferCache.get(path);
    }

    // Check if already loading
    if (this.loadingPromises.has(path)) {
      return this.loadingPromises.get(path);
    }

    // Start loading
    const loadPromise = this._fetchAndDecode(path);
    this.loadingPromises.set(path, loadPromise);

    try {
      const buffer = await loadPromise;
      this.bufferCache.set(path, buffer);
      this.loadingPromises.delete(path);
      return buffer;
    } catch (error) {
      this.loadingPromises.delete(path);
      throw error;
    }
  }

  /**
   * Fetch and decode audio file
   * @private
   */
  async _fetchAndDecode(path) {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load audio: ${path}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return this.context.decodeAudioData(arrayBuffer);
  }

  /**
   * Get or generate audio buffer for an asset
   * @param {string} category - Asset category
   * @param {string} id - Asset identifier
   * @param {number} [variation] - Optional variation index
   * @returns {Promise<AudioBuffer>}
   */
  async getBuffer(category, id, variation = null) {
    const config = this.getAssetConfig(category, id);
    if (!config) {
      console.warn(`Unknown audio asset: ${category}/${id}`);
      return this.generatePlaceholder(category, id);
    }

    let path = config.path;

    // Handle variations
    if (variation !== null && config.variations) {
      const ext = path.substring(path.lastIndexOf('.'));
      const base = path.substring(0, path.lastIndexOf('.'));
      path = `${base}_${variation}${ext}`;
    }

    try {
      // Try to load actual audio file
      return await this.loadAudioBuffer(path);
    } catch (error) {
      // Fall back to placeholder
      if (this.usePlaceholders) {
        console.debug(`Using placeholder for ${category}/${id}: ${error.message}`);
        return this.generatePlaceholder(category, id);
      }
      throw error;
    }
  }

  /**
   * Generate a placeholder audio buffer using oscillator
   * @param {string} category - Asset category
   * @param {string} id - Asset identifier
   * @returns {AudioBuffer}
   */
  generatePlaceholder(category, id) {
    const cacheKey = `placeholder:${category}/${id}`;
    if (this.bufferCache.has(cacheKey)) {
      return this.bufferCache.get(cacheKey);
    }

    const config = PLACEHOLDER_CONFIG[category]?.[id] || {
      frequency: 440,
      type: 'sine',
      duration: 0.1,
      silent: false
    };

    const sampleRate = this.context.sampleRate;
    const duration = config.duration;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = this.context.createBuffer(1, numSamples, sampleRate);
    const channelData = buffer.getChannelData(0);

    if (config.silent) {
      // Generate silence for background music placeholders
      for (let i = 0; i < numSamples; i++) {
        channelData[i] = 0;
      }
    } else {
      // Generate a simple tone with envelope
      const frequency = config.frequency;
      const attackTime = 0.01;
      const releaseTime = Math.min(0.1, duration * 0.3);
      const attackSamples = Math.floor(sampleRate * attackTime);
      const releaseSamples = Math.floor(sampleRate * releaseTime);

      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        let sample;

        // Generate waveform based on type
        switch (config.type) {
          case 'square':
            sample = Math.sin(2 * Math.PI * frequency * t) > 0 ? 0.3 : -0.3;
            break;
          case 'sawtooth':
            sample = 0.3 * (2 * ((frequency * t) % 1) - 1);
            break;
          case 'triangle':
            sample = 0.4 * (2 * Math.abs(2 * ((frequency * t) % 1) - 1) - 1);
            break;
          case 'sine':
          default:
            sample = 0.4 * Math.sin(2 * Math.PI * frequency * t);
        }

        // Apply envelope (attack and release)
        let envelope = 1;
        if (i < attackSamples) {
          envelope = i / attackSamples;
        } else if (i > numSamples - releaseSamples) {
          envelope = (numSamples - i) / releaseSamples;
        }

        channelData[i] = sample * envelope;
      }
    }

    this.bufferCache.set(cacheKey, buffer);
    return buffer;
  }

  /**
   * Preload all assets in a category
   * @param {string} category - 'music', 'sfx', or 'ui'
   * @returns {Promise<void>}
   */
  async preloadCategory(category) {
    const assets = AUDIO_MANIFEST[category];
    if (!assets) return;

    const promises = Object.keys(assets).map(id =>
      this.getBuffer(category, id).catch(err => {
        console.warn(`Failed to preload ${category}/${id}:`, err.message);
      })
    );

    await Promise.allSettled(promises);
    console.log(`Preloaded ${Object.keys(assets).length} ${category} assets`);
  }

  /**
   * Preload specific assets
   * @param {Array<{category: string, id: string}>} assets - Assets to preload
   */
  async preload(assets) {
    const promises = assets.map(({ category, id }) =>
      this.getBuffer(category, id).catch(err => {
        console.warn(`Failed to preload ${category}/${id}:`, err.message);
      })
    );

    await Promise.allSettled(promises);
  }

  /**
   * Clear audio buffer cache
   */
  clearCache() {
    this.bufferCache.clear();
    this.loadingPromises.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      cachedBuffers: this.bufferCache.size,
      loading: this.loadingPromises.size
    };
  }
}
