/**
 * AudioAssets - Asset manifest and preloading for game audio
 *
 * This is the main entry point that re-exports from modular manifest files.
 * All original exports are maintained for backward compatibility.
 *
 * Total: 55 music tracks + 244 sound effects = 299 audio assets
 */

import { debugLog } from '../utils/debugLogger.js';

// Import from modular helpers
export {
  REGIONS,
  RACE_TO_REGION,
  NODE_TYPES,
  BATTLE_TYPES,
  PLAYER_GUILDS,
  MONSTER_ARCHETYPES,
  getRegionalMusicKey,
  getBattleMusicKey,
  getSkillSoundKey,
  getUiSoundKey,
  getInteractionSoundKey,
  getAmbientSoundKey
} from './helpers/audioHelpers.js';

// Import individual manifests
import { MUSIC_MANIFEST } from './manifests/musicManifest.js';
import { SFX_MANIFEST } from './manifests/sfxManifest.js';
import { UI_MANIFEST } from './manifests/uiManifest.js';
import { AMBIENT_MANIFEST } from './manifests/ambientManifest.js';
import { INTERACTION_MANIFEST } from './manifests/interactionManifest.js';

// Re-import helpers for local use in AudioAssets class
import {
  NODE_TYPES,
  BATTLE_TYPES,
  getRegionalMusicKey,
  getBattleMusicKey
} from './helpers/audioHelpers.js';

// =============================================================================
// COMBINED AUDIO MANIFEST
// =============================================================================

/**
 * Combined audio manifest - maintains backward compatibility
 */
export const AUDIO_MANIFEST = {
  music: MUSIC_MANIFEST,
  sfx: SFX_MANIFEST,
  ui: UI_MANIFEST,
  ambient: AMBIENT_MANIFEST,
  interactions: INTERACTION_MANIFEST
};

// =============================================================================
// PLACEHOLDER CONFIG
// =============================================================================

/**
 * Placeholder audio generator configuration
 * Used when actual audio files are not available
 */
export const PLACEHOLDER_CONFIG = {
  music: {
    // Core tracks
    title_theme: { frequency: 262, type: 'sine', duration: 0.5, silent: true },
    character_create: { frequency: 294, type: 'sine', duration: 0.5, silent: true },
    victory_fanfare: { frequency: 440, type: 'sine', duration: 2, silent: false },
    defeat_jingle: { frequency: 165, type: 'sine', duration: 2, silent: false },
    level_up_fanfare: { frequency: 880, type: 'sine', duration: 0.5, silent: false },
    coliseum_theme: { frequency: 330, type: 'sine', duration: 0.5, silent: true },
    social_hub_theme: { frequency: 247, type: 'sine', duration: 0.5, silent: true },
    guild_advancement: { frequency: 294, type: 'sine', duration: 0.5, silent: true },
    wilderness_ambient: { frequency: 196, type: 'sine', duration: 0.5, silent: true },
    palace_theme: { frequency: 330, type: 'sine', duration: 0.5, silent: true },
    // Regional exploration - all silent (background music)
    heartlands_exploration: { frequency: 294, type: 'sine', duration: 0.5, silent: true },
    sylvan_reaches_exploration: { frequency: 220, type: 'sine', duration: 0.5, silent: true },
    iron_depths_exploration: { frequency: 165, type: 'sine', duration: 0.5, silent: true },
    shadowmere_exploration: { frequency: 247, type: 'sine', duration: 0.5, silent: true },
    bloodplains_exploration: { frequency: 196, type: 'sine', duration: 0.5, silent: true },
    // Battle tracks - all silent (background music)
    heartlands_battle_regular: { frequency: 330, type: 'sawtooth', duration: 0.5, silent: true },
    heartlands_battle_boss: { frequency: 440, type: 'sawtooth', duration: 0.5, silent: true },
    heartlands_battle_pvp: { frequency: 370, type: 'sawtooth', duration: 0.5, silent: true },
    heartlands_battle_story: { frequency: 350, type: 'sawtooth', duration: 0.5, silent: true }
  },
  sfx: {
    // Combat - weapon attacks
    attack_sword_1: { frequency: 200, type: 'square', duration: 0.1, silent: false },
    attack_sword_2: { frequency: 220, type: 'square', duration: 0.1, silent: false },
    attack_sword_3: { frequency: 180, type: 'square', duration: 0.15, silent: false },
    attack_axe_1: { frequency: 150, type: 'square', duration: 0.12, silent: false },
    attack_axe_2: { frequency: 130, type: 'square', duration: 0.15, silent: false },
    attack_bow_1: { frequency: 400, type: 'triangle', duration: 0.2, silent: false },
    attack_bow_2: { frequency: 450, type: 'triangle', duration: 0.25, silent: false },
    attack_fist_1: { frequency: 120, type: 'square', duration: 0.08, silent: false },
    attack_fist_2: { frequency: 140, type: 'square', duration: 0.1, silent: false },
    attack_fist_3: { frequency: 100, type: 'square', duration: 0.12, silent: false },
    // Combat - impacts
    impact_hit: { frequency: 200, type: 'square', duration: 0.1, silent: false },
    impact_critical: { frequency: 800, type: 'sawtooth', duration: 0.15, silent: false },
    impact_miss: { frequency: 100, type: 'triangle', duration: 0.2, silent: false },
    impact_block: { frequency: 300, type: 'square', duration: 0.1, silent: false },
    impact_parry: { frequency: 350, type: 'square', duration: 0.08, silent: false },
    impact_armor: { frequency: 250, type: 'square', duration: 0.1, silent: false },
    // Combat - status effects
    status_burn: { frequency: 600, type: 'sawtooth', duration: 0.3, silent: false },
    status_freeze: { frequency: 800, type: 'sine', duration: 0.3, silent: false },
    status_poison: { frequency: 150, type: 'triangle', duration: 0.4, silent: false },
    status_stun: { frequency: 500, type: 'square', duration: 0.2, silent: false },
    // Skills
    skill_cast: { frequency: 400, type: 'sine', duration: 0.3, silent: false },
    skill_fireball: { frequency: 300, type: 'sawtooth', duration: 0.4, silent: false },
    skill_inferno: { frequency: 250, type: 'sawtooth', duration: 0.6, silent: false },
    skill_ice_shard: { frequency: 600, type: 'sine', duration: 0.3, silent: false },
    skill_blizzard: { frequency: 500, type: 'sine', duration: 0.5, silent: false },
    skill_lightning_bolt: { frequency: 800, type: 'sawtooth', duration: 0.2, silent: false },
    skill_chain_lightning: { frequency: 700, type: 'sawtooth', duration: 0.4, silent: false },
    // Deaths
    player_ko: { frequency: 150, type: 'sine', duration: 0.5, silent: false },
    enemy_death_beast: { frequency: 200, type: 'sawtooth', duration: 0.4, silent: false },
    enemy_death_humanoid: { frequency: 180, type: 'square', duration: 0.3, silent: false },
    enemy_death_undead: { frequency: 100, type: 'triangle', duration: 0.5, silent: false },
    // Turn indicators
    turn_start: { frequency: 600, type: 'sine', duration: 0.15, silent: false },
    enemy_turn: { frequency: 350, type: 'triangle', duration: 0.12, silent: false },
    // Movement
    footstep: { frequency: 100, type: 'triangle', duration: 0.05, silent: false }
  },
  ui: {
    button_click: { frequency: 800, type: 'square', duration: 0.05, silent: false },
    button_hover: { frequency: 600, type: 'sine', duration: 0.03, silent: false },
    menu_open: { frequency: 400, type: 'sine', duration: 0.1, silent: false },
    menu_close: { frequency: 300, type: 'sine', duration: 0.1, silent: false },
    tab_switch: { frequency: 500, type: 'sine', duration: 0.05, silent: false },
    panel_open: { frequency: 450, type: 'sine', duration: 0.1, silent: false },
    panel_close: { frequency: 350, type: 'sine', duration: 0.08, silent: false },
    error: { frequency: 150, type: 'sawtooth', duration: 0.2, silent: false },
    success: { frequency: 660, type: 'sine', duration: 0.15, silent: false },
    warning: { frequency: 350, type: 'sawtooth', duration: 0.15, silent: false },
    confirm: { frequency: 550, type: 'sine', duration: 0.1, silent: false },
    cancel: { frequency: 250, type: 'triangle', duration: 0.1, silent: false },
    notification_general: { frequency: 550, type: 'sine', duration: 0.1, silent: false },
    notification_chat: { frequency: 500, type: 'sine', duration: 0.08, silent: false },
    notification_party: { frequency: 600, type: 'sine', duration: 0.1, silent: false },
    notification_trade: { frequency: 580, type: 'sine', duration: 0.1, silent: false },
    notification_battle: { frequency: 700, type: 'square', duration: 0.12, silent: false },
    notification_guild: { frequency: 520, type: 'sine', duration: 0.1, silent: false },
    countdown_tick: { frequency: 400, type: 'square', duration: 0.05, silent: false },
    countdown_complete: { frequency: 800, type: 'sine', duration: 0.2, silent: false },
    toggle_on: { frequency: 600, type: 'sine', duration: 0.05, silent: false },
    toggle_off: { frequency: 400, type: 'sine', duration: 0.05, silent: false },
    scroll: { frequency: 300, type: 'triangle', duration: 0.03, silent: false },
    typing: { frequency: 500, type: 'square', duration: 0.02, silent: false }
  },
  ambient: {
    tavern_chatter: { frequency: 200, type: 'sine', duration: 0.5, silent: true },
    shop_bustle: { frequency: 220, type: 'sine', duration: 0.5, silent: true },
    fishing_water: { frequency: 180, type: 'sine', duration: 0.5, silent: true },
    ruins_echoes: { frequency: 150, type: 'sine', duration: 0.5, silent: true },
    forest: { frequency: 190, type: 'sine', duration: 0.5, silent: true },
    cave_drips: { frequency: 160, type: 'sine', duration: 0.5, silent: true },
    mountain_wind: { frequency: 140, type: 'sine', duration: 0.5, silent: true },
    palace_echoes: { frequency: 200, type: 'sine', duration: 0.5, silent: true }
  },
  interactions: {
    equip_weapon: { frequency: 350, type: 'square', duration: 0.15, silent: false },
    equip_armor: { frequency: 300, type: 'square', duration: 0.2, silent: false },
    unequip: { frequency: 280, type: 'triangle', duration: 0.12, silent: false },
    item_pickup: { frequency: 600, type: 'sine', duration: 0.1, silent: false },
    item_drop: { frequency: 400, type: 'triangle', duration: 0.1, silent: false },
    item_use: { frequency: 500, type: 'sine', duration: 0.15, silent: false },
    gold_gain: { frequency: 800, type: 'sine', duration: 0.15, silent: false },
    gold_spend: { frequency: 600, type: 'triangle', duration: 0.12, silent: false },
    quest_complete: { frequency: 880, type: 'sine', duration: 0.4, silent: false },
    quest_accept: { frequency: 660, type: 'sine', duration: 0.2, silent: false },
    level_up: { frequency: 880, type: 'sine', duration: 0.5, silent: false },
    chest_open: { frequency: 400, type: 'square', duration: 0.2, silent: false },
    shrine_activate: { frequency: 700, type: 'sine', duration: 0.3, silent: false },
    discovery_found: { frequency: 600, type: 'sine', duration: 0.2, silent: false },
    travel_start: { frequency: 350, type: 'triangle', duration: 0.15, silent: false },
    travel_arrive: { frequency: 500, type: 'sine', duration: 0.15, silent: false },
    party_join: { frequency: 550, type: 'sine', duration: 0.15, silent: false },
    party_leave: { frequency: 400, type: 'triangle', duration: 0.12, silent: false },
    fishing_cast: { frequency: 300, type: 'triangle', duration: 0.2, silent: false },
    fishing_reel: { frequency: 400, type: 'triangle', duration: 0.25, silent: false },
    fishing_big_one: { frequency: 700, type: 'square', duration: 0.2, silent: false },
    puzzle_solve: { frequency: 660, type: 'sine', duration: 0.25, silent: false },
    match_found: { frequency: 880, type: 'sine', duration: 0.3, silent: false },
    gold_receive: { frequency: 700, type: 'sine', duration: 0.15, silent: false }
  }
};

// =============================================================================
// AUDIO ASSETS CLASS
// =============================================================================

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
   * @param {string} category - 'music', 'sfx', 'ui', 'ambient', or 'interactions'
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
      console.warn(`[Audio] Unknown key "${id}" in category "${category}" - check AUDIO_MANIFEST`);
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
        const generateCmd = category === 'music' ? 'music' : 'sfx';
        debugLog('audio.logMissingAssets', `Missing: ${category}/${id} - using placeholder. Generate with: npm run audio:generate:${generateCmd} -- --key ${id}`);
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

    // Default placeholder config - music and ambient should be silent to avoid
    // annoying looping tones when actual audio files are missing
    const isSilentCategory = category === 'music' || category === 'ambient';
    const config = PLACEHOLDER_CONFIG[category]?.[id] || {
      frequency: 440,
      type: 'sine',
      duration: isSilentCategory ? 0.5 : 0.1,
      silent: isSilentCategory
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
   * @param {string} category - 'music', 'sfx', 'ui', 'ambient', or 'interactions'
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
   * Preload assets for a specific region
   * @param {string} region - Region ID
   * @returns {Promise<void>}
   */
  async preloadRegion(region) {
    const assets = [];

    // Regional music
    for (const nodeType of NODE_TYPES) {
      const key = getRegionalMusicKey(region, nodeType);
      if (AUDIO_MANIFEST.music[key]) {
        assets.push({ category: 'music', id: key });
      }
    }

    // Battle music
    for (const battleType of BATTLE_TYPES) {
      const key = getBattleMusicKey(region, battleType);
      if (AUDIO_MANIFEST.music[key]) {
        assets.push({ category: 'music', id: key });
      }
    }

    await this.preload(assets);
    console.log(`Preloaded ${assets.length} assets for region: ${region}`);
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
      loading: this.loadingPromises.size,
      totalManifestEntries: {
        music: Object.keys(AUDIO_MANIFEST.music).length,
        sfx: Object.keys(AUDIO_MANIFEST.sfx).length,
        ui: Object.keys(AUDIO_MANIFEST.ui).length,
        ambient: Object.keys(AUDIO_MANIFEST.ambient).length,
        interactions: Object.keys(AUDIO_MANIFEST.interactions).length
      }
    };
  }
}
