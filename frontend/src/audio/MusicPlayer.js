/**
 * MusicPlayer - Background music playback with crossfade support
 *
 * Handles music playback with smooth transitions between tracks.
 * Uses Web Audio API for precise control over volume and fading.
 */

import { AUDIO_MANIFEST } from './AudioAssets.js';
import { debugLog } from '../utils/debugLogger.js';

export class MusicPlayer {
  constructor(audioContext, audioAssets) {
    this.context = audioContext;
    this.assets = audioAssets;

    // Current track state
    this.currentTrack = null;
    this.currentSource = null;
    this.currentGain = null;

    // Crossfade state
    this.nextSource = null;
    this.nextGain = null;
    this.isCrossfading = false;

    // Volume settings (0-1)
    this.masterVolume = 1.0;
    this.musicVolume = 0.7;
    this.effectiveVolume = this.masterVolume * this.musicVolume;

    // State
    this.isPlaying = false;
    this.isPaused = false;
    this.isEnabled = true;

    // Fade timers
    this.fadeTimer = null;
  }

  /**
   * Play a music track
   * @param {string} trackId - Track identifier from manifest
   * @param {Object} options - Playback options
   * @param {boolean} options.crossfade - Whether to crossfade from current track
   * @param {number} options.fadeInMs - Override fade-in duration
   * @param {boolean} options.restart - Force restart if same track
   */
  async play(trackId, options = {}) {
    if (!this.isEnabled) return;

    const { crossfade = true, fadeInMs = null, restart = false } = options;

    // Skip if same track already playing (unless restart requested)
    if (this.currentTrack === trackId && this.isPlaying && !restart) {
      return;
    }

    const config = AUDIO_MANIFEST.music?.[trackId];
    if (!config) {
      console.warn(`Unknown music track: ${trackId}`);
      return;
    }

    try {
      // Resume audio context if suspended (browser autoplay policy)
      if (this.context.state === 'suspended') {
        await this.context.resume();
      }

      // Load the audio buffer
      const buffer = await this.assets.getBuffer('music', trackId);

      // Determine fade duration
      const fadeIn = fadeInMs !== null ? fadeInMs : config.fadeIn;

      if (crossfade && this.isPlaying && this.currentSource) {
        await this._crossfadeTo(buffer, trackId, config, fadeIn);
      } else {
        // Stop current track immediately if no crossfade
        if (this.currentSource) {
          this._stopCurrentTrack(0);
        }
        await this._startTrack(buffer, trackId, config, fadeIn);
      }
    } catch (error) {
      console.warn(`Failed to play music track ${trackId}:`, error.message);
    }
  }

  /**
   * Stop music playback
   * @param {boolean} fadeOut - Whether to fade out
   */
  stop(fadeOut = true) {
    if (!this.currentSource) return;

    const config = AUDIO_MANIFEST.music?.[this.currentTrack];
    const fadeOutMs = fadeOut && config ? config.fadeOut : 0;

    this._stopCurrentTrack(fadeOutMs);
    this.isPlaying = false;
    this.isPaused = false;
  }

  /**
   * Pause music playback
   */
  pause() {
    if (!this.isPlaying || this.isPaused) return;

    // Web Audio API doesn't have native pause, so we fade out quickly
    // and mark as paused for resume
    if (this.currentGain) {
      this.currentGain.gain.setTargetAtTime(0, this.context.currentTime, 0.1);
    }
    this.isPaused = true;
  }

  /**
   * Resume paused music
   */
  resume() {
    if (!this.isPaused || !this.currentSource) return;

    if (this.currentGain) {
      this.currentGain.gain.setTargetAtTime(
        this.effectiveVolume * (AUDIO_MANIFEST.music?.[this.currentTrack]?.volume || 1.0),
        this.context.currentTime,
        0.1
      );
    }
    this.isPaused = false;
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
   * Set music-specific volume
   * @param {number} volume - Volume level (0-100)
   */
  setMusicVolume(volume) {
    this.musicVolume = Math.max(0, Math.min(1, volume / 100));
    this._updateVolume();
  }

  /**
   * Enable/disable music
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
      track: this.currentTrack,
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      isEnabled: this.isEnabled,
      volume: this.effectiveVolume
    };
  }

  /**
   * Start playing a track
   * @private
   */
  async _startTrack(buffer, trackId, config, fadeInMs) {
    // Create source node
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = config.loop !== false;

    // Create gain node for volume control
    const gain = this.context.createGain();
    gain.gain.value = fadeInMs > 0 ? 0 : this.effectiveVolume * config.volume;

    // Connect nodes: source -> gain -> destination
    source.connect(gain);
    gain.connect(this.context.destination);

    // Start playback
    source.start(0);

    // Handle track ending (for non-looping tracks)
    source.onended = () => {
      if (this.currentTrack === trackId && !source.loop) {
        this.currentTrack = null;
        this.currentSource = null;
        this.currentGain = null;
        this.isPlaying = false;
      }
    };

    // Store references
    this.currentSource = source;
    this.currentGain = gain;
    this.currentTrack = trackId;
    this.isPlaying = true;
    this.isPaused = false;

    debugLog('audio.logMusicChanges', 'Now playing:', trackId, { loop: config.loop !== false, fadeIn: fadeInMs });

    // Fade in if needed
    if (fadeInMs > 0) {
      gain.gain.setTargetAtTime(
        this.effectiveVolume * config.volume,
        this.context.currentTime,
        fadeInMs / 1000 / 3 // Time constant (reaches ~95% in 3 time constants)
      );
    }
  }

  /**
   * Crossfade to a new track
   * @private
   */
  async _crossfadeTo(buffer, trackId, config, fadeInMs) {
    if (this.isCrossfading) {
      // If already crossfading, complete immediately
      this._completeCrossfade();
    }

    this.isCrossfading = true;

    // Create new source
    const nextSource = this.context.createBufferSource();
    nextSource.buffer = buffer;
    nextSource.loop = config.loop !== false;

    const nextGain = this.context.createGain();
    nextGain.gain.value = 0;

    nextSource.connect(nextGain);
    nextGain.connect(this.context.destination);

    // Start the new track at zero volume
    nextSource.start(0);

    // Handle track ending
    nextSource.onended = () => {
      if (this.currentTrack === trackId && !nextSource.loop) {
        this.currentTrack = null;
        this.currentSource = null;
        this.currentGain = null;
        this.isPlaying = false;
      }
    };

    this.nextSource = nextSource;
    this.nextGain = nextGain;

    // Get fade durations
    const oldConfig = AUDIO_MANIFEST.music?.[this.currentTrack];
    const fadeOutMs = oldConfig?.fadeOut || fadeInMs;
    const fadeDuration = Math.max(fadeInMs, fadeOutMs) / 1000;
    const timeConstant = fadeDuration / 3;

    // Fade out old track
    if (this.currentGain) {
      this.currentGain.gain.setTargetAtTime(0, this.context.currentTime, timeConstant);
    }

    // Fade in new track
    nextGain.gain.setTargetAtTime(
      this.effectiveVolume * config.volume,
      this.context.currentTime,
      timeConstant
    );

    debugLog('audio.logMusicChanges', 'Crossfading to:', trackId, { from: this.currentTrack, fadeMs: fadeDuration * 1000 });

    // Complete crossfade after duration
    const crossfadeDuration = fadeDuration * 3 * 1000; // 3 time constants for ~95% complete
    this.fadeTimer = setTimeout(() => {
      this._completeCrossfade();
      this.currentSource = nextSource;
      this.currentGain = nextGain;
      this.currentTrack = trackId;
      this.nextSource = null;
      this.nextGain = null;
    }, crossfadeDuration);
  }

  /**
   * Complete an in-progress crossfade
   * @private
   */
  _completeCrossfade() {
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }

    // Stop old source
    if (this.currentSource && this.currentSource !== this.nextSource) {
      try {
        this.currentSource.stop();
      } catch (e) {
        // Already stopped
      }
      if (this.currentGain) {
        this.currentGain.disconnect();
      }
    }

    this.isCrossfading = false;
  }

  /**
   * Stop the current track
   * @private
   */
  _stopCurrentTrack(fadeOutMs) {
    if (!this.currentSource) return;

    // Capture references before timeout to prevent race conditions
    // (a new track could start before the timeout fires)
    const sourceToStop = this.currentSource;
    const gainToDisconnect = this.currentGain;
    const _trackToStop = this.currentTrack;

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
        // Only clear refs if they haven't changed (no new track started)
        if (this.currentSource === sourceToStop) {
          this.currentSource = null;
          this.currentGain = null;
          this.currentTrack = null;
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
      this.currentTrack = null;
    }
  }

  /**
   * Update effective volume and apply to current track
   * @private
   */
  _updateVolume() {
    this.effectiveVolume = this.masterVolume * this.musicVolume;

    if (this.currentGain && this.currentTrack && !this.isPaused) {
      const config = AUDIO_MANIFEST.music?.[this.currentTrack];
      const targetVolume = this.effectiveVolume * (config?.volume || 1.0);
      this.currentGain.gain.setTargetAtTime(targetVolume, this.context.currentTime, 0.05);
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.stop(false);
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
  }
}
