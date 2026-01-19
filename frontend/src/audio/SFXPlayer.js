/**
 * SFXPlayer - Sound effects playback with pooling
 *
 * Handles short sound effect playback with multiple concurrent sounds.
 * Uses object pooling for efficient memory usage.
 */

import { AUDIO_MANIFEST } from './AudioAssets.js';
import { debugLog } from '../utils/debugLogger.js';

// Maximum concurrent sounds per effect type
const MAX_CONCURRENT_SOUNDS = 8;

// Pool size for reusable gain nodes
const GAIN_POOL_SIZE = 16;

export class SFXPlayer {
  constructor(audioContext, audioAssets) {
    this.context = audioContext;
    this.assets = audioAssets;

    // Volume settings (0-1)
    this.masterVolume = 1.0;
    this.sfxVolume = 0.8;
    this.uiVolume = 0.7;
    this.effectiveVolume = {
      sfx: this.masterVolume * this.sfxVolume,
      ui: this.masterVolume * this.uiVolume
    };

    // State
    this.sfxEnabled = true;
    this.uiEnabled = true;

    // Active sounds tracking (for concurrent sound limiting)
    this.activeSounds = new Map(); // effectId -> count

    // Gain node pool for efficiency
    this.gainPool = [];
    this.activeGainNodes = new Set();

    this._initPool();
  }

  /**
   * Initialize gain node pool
   * @private
   */
  _initPool() {
    for (let i = 0; i < GAIN_POOL_SIZE; i++) {
      const gain = this.context.createGain();
      gain.connect(this.context.destination);
      this.gainPool.push(gain);
    }
  }

  /**
   * Get a gain node from pool or create new one
   * @private
   */
  _getGainNode() {
    let gain = this.gainPool.pop();
    if (!gain) {
      // Pool exhausted, create new node
      gain = this.context.createGain();
      gain.connect(this.context.destination);
    }
    this.activeGainNodes.add(gain);
    return gain;
  }

  /**
   * Return a gain node to the pool
   * @private
   */
  _releaseGainNode(gain) {
    if (this.activeGainNodes.has(gain)) {
      this.activeGainNodes.delete(gain);
      gain.gain.value = 1;
      if (this.gainPool.length < GAIN_POOL_SIZE) {
        this.gainPool.push(gain);
      } else {
        gain.disconnect();
      }
    }
  }

  /**
   * Play a sound effect
   * @param {string} effectId - Effect identifier from manifest
   * @param {Object} options - Playback options
   * @param {number} options.volume - Volume multiplier (0-1)
   * @param {boolean} options.randomVariation - Pick random variation if available
   * @param {number} options.pitchVariation - Random pitch variation range (e.g., 0.1 for +/-10%)
   * @param {number} options.pan - Stereo pan (-1 to 1)
   */
  async play(effectId, options = {}) {
    const {
      volume = 1.0,
      randomVariation = true,
      pitchVariation = 0,
      pan = 0,
      category = 'sfx'  // 'sfx' or 'ui'
    } = options;

    // Check if enabled
    if (category === 'sfx' && !this.sfxEnabled) return;
    if (category === 'ui' && !this.uiEnabled) return;

    // Check concurrent sound limit
    const activeCount = this.activeSounds.get(effectId) || 0;
    if (activeCount >= MAX_CONCURRENT_SOUNDS) {
      return; // Don't play if too many of this sound are already playing
    }

    const config = AUDIO_MANIFEST[category]?.[effectId];
    if (!config) {
      console.warn(`Unknown ${category} effect: ${effectId}`);
      return;
    }

    try {
      // Resume audio context if needed
      if (this.context.state === 'suspended') {
        await this.context.resume();
      }

      // Determine variation
      let variation = null;
      if (randomVariation && config.variations) {
        variation = Math.floor(Math.random() * config.variations);
      }

      // Load buffer
      const buffer = await this.assets.getBuffer(category, effectId, variation);

      // Create source
      const source = this.context.createBufferSource();
      source.buffer = buffer;

      // Apply pitch variation
      if (pitchVariation > 0) {
        const variance = (Math.random() * 2 - 1) * pitchVariation;
        source.playbackRate.value = 1 + variance;
      }

      // Create audio chain
      const effectiveVol = this.effectiveVolume[category] * config.volume * volume;
      const gain = this._getGainNode();
      gain.gain.value = effectiveVol;

      // Apply stereo panning if needed
      let lastNode = source;
      if (pan !== 0) {
        const panner = this.context.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        source.connect(panner);
        panner.connect(gain);
        lastNode = panner;
      } else {
        source.connect(gain);
      }

      // Track active sounds
      this.activeSounds.set(effectId, activeCount + 1);

      debugLog('audio.logSFXPlayback', 'Playing SFX:', effectId, {
        category,
        volume: effectiveVol.toFixed(2),
        variation: variation !== null ? variation : 'none',
        pan
      });

      // Handle completion
      source.onended = () => {
        const count = this.activeSounds.get(effectId) || 0;
        if (count > 0) {
          this.activeSounds.set(effectId, count - 1);
        }
        this._releaseGainNode(gain);
        if (pan !== 0 && lastNode !== source) {
          lastNode.disconnect();
        }
      };

      // Start playback
      source.start(0);

    } catch (error) {
      console.warn(`Failed to play ${category} effect ${effectId}:`, error.message);
    }
  }

  /**
   * Play a UI sound
   * @param {string} effectId - UI sound identifier
   * @param {Object} options - Playback options
   */
  async playUI(effectId, options = {}) {
    return this.play(effectId, { ...options, category: 'ui' });
  }

  /**
   * Play a combat sound effect
   * @param {string} effectId - Combat effect identifier
   * @param {Object} options - Playback options
   */
  async playCombat(effectId, options = {}) {
    // Combat sounds often benefit from slight pitch variation for variety
    return this.play(effectId, {
      pitchVariation: 0.05,
      ...options,
      category: 'sfx'
    });
  }

  /**
   * Set master volume
   * @param {number} volume - Volume level (0-100)
   */
  setMasterVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, volume / 100));
    this._updateEffectiveVolume();
  }

  /**
   * Set SFX volume
   * @param {number} volume - Volume level (0-100)
   */
  setSFXVolume(volume) {
    this.sfxVolume = Math.max(0, Math.min(1, volume / 100));
    this._updateEffectiveVolume();
  }

  /**
   * Set UI sound volume
   * @param {number} volume - Volume level (0-100)
   */
  setUIVolume(volume) {
    this.uiVolume = Math.max(0, Math.min(1, volume / 100));
    this._updateEffectiveVolume();
  }

  /**
   * Enable/disable SFX
   * @param {boolean} enabled
   */
  setSFXEnabled(enabled) {
    this.sfxEnabled = enabled;
  }

  /**
   * Enable/disable UI sounds
   * @param {boolean} enabled
   */
  setUIEnabled(enabled) {
    this.uiEnabled = enabled;
  }

  /**
   * Update effective volume calculations
   * @private
   */
  _updateEffectiveVolume() {
    this.effectiveVolume = {
      sfx: this.masterVolume * this.sfxVolume,
      ui: this.masterVolume * this.uiVolume
    };
  }

  /**
   * Get current state
   */
  getState() {
    return {
      sfxEnabled: this.sfxEnabled,
      uiEnabled: this.uiEnabled,
      sfxVolume: this.sfxVolume,
      uiVolume: this.uiVolume,
      activeSounds: this.activeSounds.size
    };
  }

  /**
   * Clear sound tracking state
   *
   * Note: This does NOT actually stop playing sounds. Web Audio API
   * BufferSourceNodes cannot be stopped without keeping references to
   * each active source. This method only resets the concurrent sound
   * tracking, allowing new sounds to play even if the limit was reached.
   *
   * Currently playing sounds will continue until they finish naturally.
   * For a full audio cutoff, use AudioManager.destroy() which disconnects
   * all gain nodes from the audio destination.
   */
  stopAll() {
    this.activeSounds.clear();
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.stopAll();
    this.activeGainNodes.forEach(gain => gain.disconnect());
    this.activeGainNodes.clear();
    this.gainPool.forEach(gain => gain.disconnect());
    this.gainPool = [];
  }
}
