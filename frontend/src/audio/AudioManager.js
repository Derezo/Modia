/**
 * AudioManager - Central audio controller for Modia
 *
 * Manages all game audio including music, sound effects, and UI sounds.
 * Integrates with settings system for volume/mute persistence.
 *
 * Usage:
 *   // Initialize in Game.js
 *   this.audio = new AudioManager(this);
 *   await this.audio.init();
 *
 *   // Play music (with crossfade)
 *   this.game.audio.playMusic('world_exploration');
 *
 *   // Play sound effect
 *   this.game.audio.playSFX('attack_hit');
 *
 *   // Play UI sound
 *   this.game.audio.playUI('button_click');
 */

import { AudioAssets } from './AudioAssets.js';
import { MusicPlayer } from './MusicPlayer.js';
import { SFXPlayer } from './SFXPlayer.js';
import { AmbientPlayer } from './AmbientPlayer.js';
import { MusicContext } from './MusicContext.js';

export class AudioManager {
  constructor(game) {
    this.game = game;
    this.context = null;
    this.assets = null;
    this.music = null;
    this.sfx = null;
    this.ambient = null;
    this.musicContext = null;

    // Global state
    this.isMuted = false;
    this.isInitialized = false;
    this.initializationPending = false;

    // Settings subscription cleanup
    this._settingsUnsubscribe = null;

    // User interaction tracking for autoplay policy
    this._hasUserInteraction = false;
    this._boundInteractionHandler = null;
  }

  /**
   * Initialize the audio system
   * Must be called after user interaction due to browser autoplay policies
   */
  async init() {
    if (this.isInitialized || this.initializationPending) return;
    this.initializationPending = true;

    try {
      // Create audio context
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        console.warn('Web Audio API not supported');
        return;
      }

      this.context = new AudioContext();

      // Initialize subsystems
      this.assets = new AudioAssets(this.context);
      this.music = new MusicPlayer(this.context, this.assets);
      this.sfx = new SFXPlayer(this.context, this.assets);
      this.ambient = new AmbientPlayer(this.context, this.assets);
      this.musicContext = new MusicContext(this);

      // Subscribe to settings changes
      this._subscribeToSettings();

      // Apply initial settings
      this._applyCurrentSettings();

      // Setup user interaction listener for audio context resume
      this._setupInteractionListener();

      this.isInitialized = true;
      console.log('AudioManager initialized');

    } catch (error) {
      console.error('Failed to initialize AudioManager:', error);
    } finally {
      this.initializationPending = false;
    }
  }

  /**
   * Setup listener for first user interaction to resume audio context
   * @private
   */
  _setupInteractionListener() {
    if (this._hasUserInteraction) return;

    this._boundInteractionHandler = () => {
      this._hasUserInteraction = true;
      if (this.context?.state === 'suspended') {
        this.context.resume().catch(() => {});
      }
      // Remove listeners after first interaction
      document.removeEventListener('click', this._boundInteractionHandler);
      document.removeEventListener('keydown', this._boundInteractionHandler);
      document.removeEventListener('touchstart', this._boundInteractionHandler);
    };

    document.addEventListener('click', this._boundInteractionHandler, { once: true });
    document.addEventListener('keydown', this._boundInteractionHandler, { once: true });
    document.addEventListener('touchstart', this._boundInteractionHandler, { once: true });
  }

  /**
   * Subscribe to settings changes in StateManager
   * @private
   */
  _subscribeToSettings() {
    if (!this.game.state) return;

    // Subscribe to userSettings changes
    this._settingsUnsubscribe = this.game.state.subscribe('userSettings', (settings) => {
      if (settings?.audio) {
        this._applyAudioSettings(settings.audio);
      }
    });
  }

  /**
   * Apply current settings from game state
   * @private
   */
  _applyCurrentSettings() {
    const settings = this.game.state?.get('userSettings');
    if (settings?.audio) {
      this._applyAudioSettings(settings.audio);
    }
  }

  /**
   * Apply audio settings to players
   * @private
   */
  _applyAudioSettings(audioSettings) {
    const {
      masterVolume = 80,
      musicVolume = 70,
      sfxVolume = 80,
      uiVolume = 70,
      ambientVolume = 50,
      muted = false,
      musicEnabled = true,
      sfxEnabled = true,
      ambientEnabled = true
    } = audioSettings;

    // Store mute state
    this.isMuted = muted;

    // Apply to music player
    if (this.music) {
      this.music.setMasterVolume(muted ? 0 : masterVolume);
      this.music.setMusicVolume(musicVolume);
      this.music.setEnabled(musicEnabled && !muted);
    }

    // Apply to SFX player
    if (this.sfx) {
      this.sfx.setMasterVolume(muted ? 0 : masterVolume);
      this.sfx.setSFXVolume(sfxVolume);
      this.sfx.setUIVolume(uiVolume);
      this.sfx.setSFXEnabled(sfxEnabled && !muted);
      this.sfx.setUIEnabled(!muted); // UI sounds follow mute but always enabled
    }

    // Apply to ambient player
    if (this.ambient) {
      this.ambient.setMasterVolume(muted ? 0 : masterVolume);
      this.ambient.setAmbientVolume(ambientVolume);
      this.ambient.setEnabled(ambientEnabled && !muted);
    }
  }

  // =====================
  // Public API - Music
  // =====================

  /**
   * Play a music track
   * @param {string} trackId - Track identifier (e.g., 'world_exploration', 'battle_combat')
   * @param {Object} options - Playback options
   * @param {boolean} options.crossfade - Whether to crossfade from current track (default: true)
   * @param {number} options.fadeInMs - Override fade-in duration
   * @param {boolean} options.restart - Force restart if same track playing
   */
  playMusic(trackId, options = {}) {
    if (!this.isInitialized || !this.music) {
      console.debug(`AudioManager: Cannot play music '${trackId}' - not initialized`);
      return;
    }
    this.music.play(trackId, options);
  }

  /**
   * Stop music playback
   * @param {boolean} fadeOut - Whether to fade out (default: true)
   */
  stopMusic(fadeOut = true) {
    if (!this.isInitialized || !this.music) return;
    this.music.stop(fadeOut);
  }

  /**
   * Pause music playback
   */
  pauseMusic() {
    if (!this.isInitialized || !this.music) return;
    this.music.pause();
  }

  /**
   * Resume paused music
   */
  resumeMusic() {
    if (!this.isInitialized || !this.music) return;
    this.music.resume();
  }

  // =====================
  // Public API - SFX
  // =====================

  /**
   * Play a sound effect
   * @param {string} effectId - Effect identifier (e.g., 'attack_hit', 'critical_hit')
   * @param {Object} options - Playback options
   * @param {number} options.volume - Volume multiplier (0-1)
   * @param {boolean} options.randomVariation - Pick random variation
   * @param {number} options.pitchVariation - Pitch variation range
   * @param {number} options.pan - Stereo pan (-1 to 1)
   */
  playSFX(effectId, options = {}) {
    if (!this.isInitialized || !this.sfx) {
      return;
    }
    this.sfx.play(effectId, { ...options, category: 'sfx' });
  }

  /**
   * Play a UI sound
   * @param {string} effectId - UI sound identifier (e.g., 'button_click', 'menu_open')
   * @param {Object} options - Playback options
   */
  playUI(effectId, options = {}) {
    if (!this.isInitialized || !this.sfx) {
      return;
    }
    this.sfx.playUI(effectId, options);
  }

  /**
   * Play a combat sound effect (with slight pitch variation)
   * @param {string} effectId - Combat effect identifier
   * @param {Object} options - Playback options
   */
  playCombat(effectId, options = {}) {
    if (!this.isInitialized || !this.sfx) {
      return;
    }
    this.sfx.playCombat(effectId, options);
  }

  // =====================
  // Public API - Ambient
  // =====================

  /**
   * Play an ambient sound
   * @param {string} ambientId - Ambient sound identifier (e.g., 'tavern_chatter', 'shop_bustle')
   * @param {Object} options - Playback options
   * @param {number} options.volume - Volume multiplier (0-1)
   * @param {number} options.fadeInMs - Override fade-in duration
   */
  playAmbient(ambientId, options = {}) {
    if (!this.isInitialized || !this.ambient) {
      console.debug(`AudioManager: Cannot play ambient '${ambientId}' - not initialized`);
      return;
    }
    this.ambient.play(ambientId, options);
  }

  /**
   * Stop ambient playback
   * @param {boolean} fadeOut - Whether to fade out (default: true)
   */
  stopAmbient(fadeOut = true) {
    if (!this.isInitialized || !this.ambient) return;
    this.ambient.stop(fadeOut);
  }

  // =====================
  // Public API - Volume Control
  // =====================

  /**
   * Set master volume (affects all audio)
   * @param {number} volume - Volume level (0-100)
   */
  setMasterVolume(volume) {
    if (this.music) this.music.setMasterVolume(volume);
    if (this.sfx) this.sfx.setMasterVolume(volume);
  }

  /**
   * Set music volume
   * @param {number} volume - Volume level (0-100)
   */
  setMusicVolume(volume) {
    if (this.music) this.music.setMusicVolume(volume);
  }

  /**
   * Set sound effects volume
   * @param {number} volume - Volume level (0-100)
   */
  setSFXVolume(volume) {
    if (this.sfx) this.sfx.setSFXVolume(volume);
  }

  /**
   * Set UI sounds volume
   * @param {number} volume - Volume level (0-100)
   */
  setUIVolume(volume) {
    if (this.sfx) this.sfx.setUIVolume(volume);
  }

  /**
   * Set ambient sounds volume
   * @param {number} volume - Volume level (0-100)
   */
  setAmbientVolume(volume) {
    if (this.ambient) this.ambient.setAmbientVolume(volume);
  }

  // =====================
  // Public API - State Control
  // =====================

  /**
   * Mute all audio
   */
  mute() {
    this.isMuted = true;
    if (this.music) {
      this.music.setMasterVolume(0);
    }
    if (this.sfx) {
      this.sfx.setMasterVolume(0);
    }
    if (this.ambient) {
      this.ambient.setMasterVolume(0);
    }
  }

  /**
   * Unmute audio (restore volumes from settings)
   */
  unmute() {
    this.isMuted = false;
    this._applyCurrentSettings();
  }

  /**
   * Toggle mute state
   * @returns {boolean} New mute state
   */
  toggleMute() {
    if (this.isMuted) {
      this.unmute();
    } else {
      this.mute();
    }
    return this.isMuted;
  }

  /**
   * Check if audio is muted
   * @returns {boolean}
   */
  isMutedState() {
    return this.isMuted;
  }

  /**
   * Get audio system state
   * @returns {Object} Current state including volumes and playing tracks
   */
  getState() {
    return {
      isInitialized: this.isInitialized,
      isMuted: this.isMuted,
      hasUserInteraction: this._hasUserInteraction,
      contextState: this.context?.state || 'unavailable',
      music: this.music?.getState() || null,
      sfx: this.sfx?.getState() || null,
      ambient: this.ambient?.getState() || null,
      assetStats: this.assets?.getStats() || null
    };
  }

  // =====================
  // Preloading
  // =====================

  /**
   * Preload audio assets for a scene
   * @param {string} sceneName - Scene identifier
   */
  async preloadForScene(sceneName) {
    if (!this.isInitialized || !this.assets) return;

    const preloadSets = {
      worldMap: [
        { category: 'music', id: 'world_exploration' },
        { category: 'sfx', id: 'footstep' }
      ],
      battle: [
        { category: 'music', id: 'battle_combat' },
        { category: 'music', id: 'victory_fanfare' },
        { category: 'music', id: 'defeat_jingle' },
        { category: 'sfx', id: 'attack_hit' },
        { category: 'sfx', id: 'skill_cast' },
        { category: 'sfx', id: 'critical_hit' },
        { category: 'sfx', id: 'heal' },
        { category: 'sfx', id: 'miss' },
        { category: 'sfx', id: 'turn_start' }
      ],
      shop: [
        { category: 'music', id: 'shop_theme' },
        { category: 'sfx', id: 'gold_coins' },
        { category: 'sfx', id: 'item_pickup' }
      ],
      tavern: [
        { category: 'music', id: 'tavern_ambience' }
      ]
    };

    const assets = preloadSets[sceneName];
    if (assets) {
      await this.assets.preload(assets);
    }
  }

  // =====================
  // Cleanup
  // =====================

  /**
   * Clean up audio resources
   */
  destroy() {
    // Unsubscribe from settings
    if (this._settingsUnsubscribe) {
      this._settingsUnsubscribe();
      this._settingsUnsubscribe = null;
    }

    // Remove interaction listener
    if (this._boundInteractionHandler) {
      document.removeEventListener('click', this._boundInteractionHandler);
      document.removeEventListener('keydown', this._boundInteractionHandler);
      document.removeEventListener('touchstart', this._boundInteractionHandler);
      this._boundInteractionHandler = null;
    }

    // Clean up subsystems
    if (this.music) {
      this.music.destroy();
      this.music = null;
    }

    if (this.sfx) {
      this.sfx.destroy();
      this.sfx = null;
    }

    if (this.ambient) {
      this.ambient.destroy();
      this.ambient = null;
    }

    if (this.assets) {
      this.assets.clearCache();
      this.assets = null;
    }

    // Close audio context
    if (this.context && this.context.state !== 'closed') {
      this.context.close().catch(() => {});
      this.context = null;
    }

    this.isInitialized = false;
    console.log('AudioManager destroyed');
  }
}
