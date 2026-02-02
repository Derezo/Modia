/**
 * MusicPlayer - Background music playback with crossfade support
 *
 * Handles music playback with smooth transitions between tracks.
 * Uses HTML5 Audio with MediaElementSourceNode for streaming playback,
 * allowing music to start playing before the entire file downloads.
 */

import { AUDIO_MANIFEST } from './AudioAssets.js';
import { debugLog } from '../utils/debugLogger.js';

export class MusicPlayer {
  constructor(audioContext, audioAssets) {
    this.context = audioContext;
    this.assets = audioAssets; // Keep reference for potential fallback use

    // Two audio elements for crossfade (A/B switching)
    this.audioElements = [new Audio(), new Audio()];
    this.mediaSources = [null, null];
    this.elementGains = [null, null];
    this.activeIndex = 0;

    // Current track state
    this.currentTrack = null;
    this.currentSource = null; // Reference to active Audio element
    this.currentGain = null;   // Reference to active GainNode

    // Crossfade state
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

    // Configure audio elements for streaming
    this._initAudioElements();
  }

  /**
   * Initialize audio elements with optimal settings
   * @private
   */
  _initAudioElements() {
    for (const audio of this.audioElements) {
      // Enable preloading metadata but not full audio
      audio.preload = 'metadata';
      // Cross-origin for CDN assets if needed
      audio.crossOrigin = 'anonymous';
    }
  }

  /**
   * Ensure MediaElementSource is created for an audio element
   * Note: MediaElementSource can only be created once per Audio element
   * @private
   */
  _ensureMediaSource(index) {
    if (!this.mediaSources[index]) {
      const audio = this.audioElements[index];
      this.mediaSources[index] = this.context.createMediaElementSource(audio);
      this.elementGains[index] = this.context.createGain();
      this.mediaSources[index].connect(this.elementGains[index]);
      this.elementGains[index].connect(this.context.destination);
    }
    return {
      audio: this.audioElements[index],
      source: this.mediaSources[index],
      gain: this.elementGains[index]
    };
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

      // Get the track path directly from config
      const trackPath = config.path;

      // Determine fade duration
      const fadeIn = fadeInMs !== null ? fadeInMs : config.fadeIn;

      if (crossfade && this.isPlaying && this.currentSource) {
        await this._crossfadeTo(trackPath, trackId, config, fadeIn);
      } else {
        // Stop current track immediately if no crossfade
        if (this.isPlaying) {
          this._stopCurrentTrack(0);
        }
        await this._startTrack(trackPath, trackId, config, fadeIn);
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

    // Use native HTML5 Audio pause
    if (this.currentSource && this.currentSource.pause) {
      this.currentSource.pause();
    }
    this.isPaused = true;
  }

  /**
   * Resume paused music
   */
  resume() {
    if (!this.isPaused || !this.currentSource) return;

    // Resume audio context if needed
    if (this.context.state === 'suspended') {
      this.context.resume();
    }

    // Use native HTML5 Audio play
    if (this.currentSource && this.currentSource.play) {
      this.currentSource.play().catch(err => {
        console.warn('Failed to resume music:', err.message);
      });
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
   * Start playing a track using HTML5 Audio streaming
   * @private
   */
  async _startTrack(trackPath, trackId, config, fadeInMs) {
    // Use the next audio element (A/B switching)
    const newIndex = this.activeIndex === 0 ? 1 : 0;
    const { audio, gain } = this._ensureMediaSource(newIndex);

    // Set initial volume (0 if fading in, full volume otherwise)
    const targetVolume = this.effectiveVolume * config.volume;
    gain.gain.value = fadeInMs > 0 ? 0 : targetVolume;

    // Set up the audio element
    audio.src = trackPath;
    audio.loop = config.loop !== false;

    // Handle track ending (for non-looping tracks)
    audio.onended = () => {
      if (this.currentTrack === trackId && !audio.loop) {
        this.currentTrack = null;
        this.currentSource = null;
        this.currentGain = null;
        this.isPlaying = false;
      }
    };

    // Handle loading errors
    audio.onerror = () => {
      console.warn(`Failed to load music track: ${trackPath}`);
    };

    // Start playback (streams immediately, doesn't wait for full download)
    try {
      await audio.play();
    } catch (error) {
      console.warn(`Failed to play music track ${trackId}:`, error.message);
      return;
    }

    // Store references
    this.currentSource = audio;
    this.currentGain = gain;
    this.currentTrack = trackId;
    this.activeIndex = newIndex;
    this.isPlaying = true;
    this.isPaused = false;

    debugLog('audio.logMusicChanges', 'Now playing (streaming):', trackId, { loop: config.loop !== false, fadeIn: fadeInMs });

    // Fade in if needed
    if (fadeInMs > 0) {
      gain.gain.setTargetAtTime(
        targetVolume,
        this.context.currentTime,
        fadeInMs / 1000 / 3 // Time constant (reaches ~95% in 3 time constants)
      );
    }
  }

  /**
   * Crossfade to a new track
   * @private
   */
  async _crossfadeTo(trackPath, trackId, config, fadeInMs) {
    if (this.isCrossfading) {
      // If already crossfading, complete immediately
      this._completeCrossfade(true);
    }

    this.isCrossfading = true;

    // Store old track info BEFORE updating currentTrack
    const oldTrackId = this.currentTrack;
    const oldAudio = this.currentSource;
    const oldGain = this.currentGain;
    const oldIndex = this.activeIndex;

    // Update currentTrack immediately to prevent duplicate requests
    this.currentTrack = trackId;

    // Use the other audio element for the new track
    const newIndex = oldIndex === 0 ? 1 : 0;
    const { audio: newAudio, gain: newGain } = this._ensureMediaSource(newIndex);

    // Set up the new audio element
    newAudio.src = trackPath;
    newAudio.loop = config.loop !== false;

    // Start at zero volume
    const targetVolume = this.effectiveVolume * config.volume;
    newGain.gain.value = 0;

    // Handle track ending
    newAudio.onended = () => {
      if (this.currentTrack === trackId && !newAudio.loop) {
        this.currentTrack = null;
        this.currentSource = null;
        this.currentGain = null;
        this.isPlaying = false;
      }
    };

    // Start the new track
    try {
      await newAudio.play();
    } catch (error) {
      console.warn(`Failed to play music track ${trackId}:`, error.message);
      this.isCrossfading = false;
      return;
    }

    // Get fade durations
    const oldConfig = AUDIO_MANIFEST.music?.[oldTrackId];
    const fadeOutMs = oldConfig?.fadeOut || fadeInMs;
    const fadeDuration = Math.max(fadeInMs, fadeOutMs) / 1000;
    const timeConstant = fadeDuration / 3;

    // Fade out old track
    if (oldGain) {
      oldGain.gain.setTargetAtTime(0, this.context.currentTime, timeConstant);
    }

    // Fade in new track
    newGain.gain.setTargetAtTime(
      targetVolume,
      this.context.currentTime,
      timeConstant
    );

    debugLog('audio.logMusicChanges', 'Crossfading to:', trackId, { from: oldTrackId, fadeMs: fadeDuration * 1000 });

    // Update references to new track
    this.currentSource = newAudio;
    this.currentGain = newGain;
    this.activeIndex = newIndex;

    // Complete crossfade after duration - stop old audio
    const crossfadeDuration = fadeDuration * 3 * 1000; // 3 time constants for ~95% complete
    const expectedOldAudio = oldAudio;
    this.fadeTimer = setTimeout(() => {
      // Stop the old audio element
      if (expectedOldAudio) {
        expectedOldAudio.pause();
        expectedOldAudio.currentTime = 0;
      }
      this.isCrossfading = false;
    }, crossfadeDuration);
  }

  /**
   * Complete an in-progress crossfade
   * @param {boolean} immediate - If true, stop old track immediately
   * @private
   */
  _completeCrossfade(immediate = false) {
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }

    if (immediate) {
      // Stop the inactive audio element
      const inactiveIndex = this.activeIndex === 0 ? 1 : 0;
      const inactiveAudio = this.audioElements[inactiveIndex];
      if (inactiveAudio) {
        inactiveAudio.pause();
        inactiveAudio.currentTime = 0;
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

    const audioToStop = this.currentSource;
    const gainToFade = this.currentGain;
    const _trackToStop = this.currentTrack;

    if (fadeOutMs > 0 && gainToFade) {
      // Fade out
      const timeConstant = fadeOutMs / 1000 / 3;
      gainToFade.gain.setTargetAtTime(0, this.context.currentTime, timeConstant);

      // Stop after fade completes
      setTimeout(() => {
        if (audioToStop) {
          audioToStop.pause();
          audioToStop.currentTime = 0;
        }
        // Only clear refs if they haven't changed
        if (this.currentSource === audioToStop) {
          this.currentSource = null;
          this.currentGain = null;
          this.currentTrack = null;
        }
      }, fadeOutMs);
    } else {
      // Stop immediately
      if (audioToStop) {
        audioToStop.pause();
        audioToStop.currentTime = 0;
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

    // Clean up audio elements
    for (let i = 0; i < this.audioElements.length; i++) {
      const audio = this.audioElements[i];
      if (audio) {
        audio.pause();
        audio.src = '';
        audio.onended = null;
        audio.onerror = null;
      }
      // Disconnect gain nodes
      if (this.elementGains[i]) {
        this.elementGains[i].disconnect();
      }
      // Disconnect media sources
      if (this.mediaSources[i]) {
        this.mediaSources[i].disconnect();
      }
    }

    this.audioElements = [null, null];
    this.mediaSources = [null, null];
    this.elementGains = [null, null];
  }
}
