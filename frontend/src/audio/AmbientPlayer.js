/**
 * AmbientPlayer - Environmental ambient sound playback
 *
 * Handles non-looping ambient sounds with fade transitions.
 * Plays once per scene enter, stops on scene exit.
 * Lower volume than music to blend into background.
 */

import { AUDIO_MANIFEST } from './AudioAssets.js';
import { debugLog } from '../utils/debugLogger.js';

export class AmbientPlayer {
  constructor(audioContext, audioAssets) {
    this.context = audioContext;
    this.assets = audioAssets;

    // Current ambient state
    this.currentAmbient = null;
    this.currentSource = null;
    this.currentGain = null;

    // Volume settings (0-1 range)
    this.masterVolume = 1.0;
    this.ambientVolume = 0.3; // Lower than music by default

    // State
    this.isPlaying = false;
    this.isEnabled = true;

    // Fade settings
    this.fadeOutMs = 500;
  }

  /**
   * Play an ambient sound
   * @param {string} ambientId - Ambient identifier from manifest
   * @param {Object} options - Playback options
   * @param {number} options.volume - Volume multiplier (0-1)
   * @param {number} options.fadeInMs - Fade in duration
   */
  async play(ambientId, options = {}) {
    if (!this.isEnabled) return;

    const { volume = null, fadeInMs = 300 } = options;

    // Stop current ambient if playing
    if (this.isPlaying && this.currentSource) {
      this._stopCurrentAmbient(this.fadeOutMs);
    }

    const config = AUDIO_MANIFEST.ambient?.[ambientId];
    if (!config) {
      console.warn(`Unknown ambient sound: ${ambientId}`);
      return;
    }

    try {
      // Resume audio context if suspended (browser autoplay policy)
      if (this.context.state === 'suspended') {
        await this.context.resume();
      }

      // Load the audio buffer
      const buffer = await this.assets.getBuffer('ambient', ambientId);

      // Create source node
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = false; // Never loop ambient sounds

      // Create gain node for volume control
      const targetVolume = this._calculateVolume(config.volume, volume);
      const gain = this.context.createGain();
      gain.gain.value = fadeInMs > 0 ? 0 : targetVolume;

      // Connect nodes: source -> gain -> destination
      source.connect(gain);
      gain.connect(this.context.destination);

      // Start playback
      source.start(0);

      // Handle sound ending
      source.onended = () => {
        if (this.currentAmbient === ambientId) {
          this.currentAmbient = null;
          this.currentSource = null;
          this.currentGain = null;
          this.isPlaying = false;
        }
      };

      // Store references
      this.currentSource = source;
      this.currentGain = gain;
      this.currentAmbient = ambientId;
      this.isPlaying = true;

      debugLog('audio.logAmbientChanges', 'Playing ambient:', ambientId, { fadeIn: fadeInMs });

      // Fade in if needed
      if (fadeInMs > 0) {
        gain.gain.setTargetAtTime(
          targetVolume,
          this.context.currentTime,
          fadeInMs / 1000 / 3 // Time constant (reaches ~95% in 3 time constants)
        );
      }
    } catch (error) {
      console.warn(`Failed to play ambient sound ${ambientId}:`, error.message);
    }
  }

  /**
   * Stop ambient playback
   * @param {boolean} fadeOut - Whether to fade out (default: true)
   */
  stop(fadeOut = true) {
    if (!this.currentSource) return;

    const fadeOutMs = fadeOut ? this.fadeOutMs : 0;
    this._stopCurrentAmbient(fadeOutMs);
    this.isPlaying = false;
  }

  /**
   * Set master volume
   * @param {number} volume - Volume level (0-100)
   */
  setMasterVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, volume / 100));
    this._updateVolume();
  }

  /**
   * Set ambient-specific volume
   * @param {number} volume - Volume level (0-100)
   */
  setAmbientVolume(volume) {
    this.ambientVolume = Math.max(0, Math.min(1, volume / 100));
    this._updateVolume();
  }

  /**
   * Enable/disable ambient sounds
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    if (!enabled) {
      this.stop(true);
    }
  }

  /**
   * Get current playback state
   */
  getState() {
    return {
      ambient: this.currentAmbient,
      isPlaying: this.isPlaying,
      isEnabled: this.isEnabled,
      volume: this.masterVolume * this.ambientVolume
    };
  }

  /**
   * Calculate target volume from config and options
   * @private
   */
  _calculateVolume(configVolume, optionVolume) {
    const baseVolume = optionVolume !== null ? optionVolume : (configVolume || 0.3);
    return this.masterVolume * this.ambientVolume * baseVolume;
  }

  /**
   * Stop the current ambient sound
   * @private
   */
  _stopCurrentAmbient(fadeOutMs) {
    if (!this.currentSource) return;

    // Capture references before timeout
    const sourceToStop = this.currentSource;
    const gainToDisconnect = this.currentGain;
    const _ambientToStop = this.currentAmbient;

    if (fadeOutMs > 0 && gainToDisconnect) {
      // Fade out
      const timeConstant = fadeOutMs / 1000 / 3;
      gainToDisconnect.gain.setTargetAtTime(0, this.context.currentTime, timeConstant);

      // Stop after fade completes
      setTimeout(() => {
        try {
          if (sourceToStop) {
            sourceToStop.stop();
          }
        } catch (e) {
          // Already stopped
        }
        if (gainToDisconnect) {
          gainToDisconnect.disconnect();
        }
        // Only clear refs if they haven't changed
        if (this.currentSource === sourceToStop) {
          this.currentSource = null;
          this.currentGain = null;
          this.currentAmbient = null;
        }
      }, fadeOutMs);
    } else {
      // Stop immediately
      try {
        sourceToStop.stop();
      } catch (e) {
        // Already stopped
      }
      if (gainToDisconnect) {
        gainToDisconnect.disconnect();
      }
      this.currentSource = null;
      this.currentGain = null;
      this.currentAmbient = null;
    }
  }

  /**
   * Update effective volume and apply to current sound
   * @private
   */
  _updateVolume() {
    if (this.currentGain && this.currentAmbient) {
      const config = AUDIO_MANIFEST.ambient?.[this.currentAmbient];
      const targetVolume = this._calculateVolume(config?.volume, null);
      this.currentGain.gain.setTargetAtTime(targetVolume, this.context.currentTime, 0.05);
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.stop(false);
  }
}
