/**
 * @module SettingsStateManager
 * @description Manages settings state, persistence, and validation for the SettingsScene.
 *
 * Key responsibilities:
 * - Load settings from API
 * - Save settings to API
 * - Deep merge with defaults
 * - Track unsaved changes
 * - Reset to defaults
 *
 * @see SettingsScene.js - Main scene orchestration
 * @see SettingsPanelRenderer.js - Panel rendering
 * @see SettingsAccessibility.js - Accessibility feature application
 */

// Default settings structure (the single client copy; Game.js imports it).
// IMPORTANT: This structure is mirrored in api/src/routes/settings.js
// (backend defaults and validation). Keep both in sync when making changes.
export const DEFAULT_SETTINGS = {
  battle: {
    actionMenuStyle: 'radial',
    showDamageNumbers: true,
    showBattleGrid: true,
    autoEndTurn: false,
    confirmEndTurn: true,
    showDamagePreview: true,
    showMissChance: true,
    battleLogPosition: 'right',
    battleLogVisible: true
  },
  audio: {
    masterVolume: 80,
    musicVolume: 70,
    sfxVolume: 80,
    uiVolume: 70,
    muted: false,
    musicEnabled: true,
    sfxEnabled: true,
    ambientEnabled: true
  },
  display: {
    animationSpeed: 'normal',
    cameraZoom: 1.0,
    showFloatingText: true,
    screenShake: true
  },
  accessibility: {
    highContrast: false,
    reducedMotion: false,
    textSize: 'medium',
    colorBlindMode: 'none',
    fontFamily: 'default',
    lineSpacing: 'normal',
    cursorSize: 'normal',
    screenReaderHints: false
  },
  gameplay: {
    confirmTravel: false
  },
  social: {
    showOnlineStatus: true,
    allowPartyInvites: true,
    allowFriendRequests: true,
    chatTimestamps: true
  },
  developer: {
    enabled: false,
    audio: {
      logMusicChanges: false,
      logRegionInfo: false,
      logSFXPlayback: false,
      logMissingAssets: true
    },
    network: {
      logAPIRequests: false,
      logWebSocketMessages: false
    },
    state: {
      logStateChanges: false,
      logSceneTransitions: false
    },
    battle: {
      logTurnEvents: false,
      logDamageCalculations: false
    },
    performance: {
      showFPS: false,
      logSlowFrames: false
    }
  }
};

/**
 * Manages settings state and persistence
 */
export class SettingsStateManager {
  /**
   * @param {Object} api - API client instance
   */
  constructor(api) {
    this.api = api;
    this.settings = null;
    this.originalSettings = null;
    this.hasChanges = false;
  }

  /**
   * Load settings from the API
   * @returns {Promise<Object>} The loaded settings
   */
  async loadSettings() {
    try {
      const result = await this.api.getSettings();
      // Deep merge with defaults to ensure all fields exist
      this.settings = this.deepMerge(DEFAULT_SETTINGS, result.settings);
      this.originalSettings = JSON.parse(JSON.stringify(this.settings));
      this.hasChanges = false;
      return this.settings;
    } catch (err) {
      console.error('Failed to load settings:', err);
      // Use defaults
      this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      this.originalSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      this.hasChanges = false;
      return this.settings;
    }
  }

  /**
   * Save settings to the API
   * @returns {Promise<void>}
   */
  async saveSettings() {
    await this.api.updateSettings(this.settings);
    this.originalSettings = JSON.parse(JSON.stringify(this.settings));
    this.hasChanges = false;
  }

  /**
   * Reset settings to defaults (does not save)
   * @returns {Object} The default settings
   */
  resetToDefaults() {
    this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    this.updateChangesState();
    return this.settings;
  }

  /**
   * Restore settings to last saved state (cancel changes)
   */
  cancelChanges() {
    if (this.hasChanges) {
      this.settings = JSON.parse(JSON.stringify(this.originalSettings));
      this.hasChanges = false;
    }
  }

  /**
   * Get current settings
   * @returns {Object} Current settings
   */
  getSettings() {
    return this.settings;
  }

  /**
   * Check if there are unsaved changes
   * @returns {boolean}
   */
  hasUnsavedChanges() {
    return this.hasChanges;
  }

  /**
   * Set a specific setting value by path
   * @param {string} path - Dot-separated path (e.g., 'battle.showDamageNumbers')
   * @param {*} value - The value to set
   */
  setSettingValue(path, value) {
    const parts = path.split('.');
    let obj = this.settings;

    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }

    obj[parts[parts.length - 1]] = value;
    this.updateChangesState();
  }

  /**
   * Get a specific setting value by path
   * @param {string} path - Dot-separated path (e.g., 'battle.showDamageNumbers')
   * @returns {*} The setting value
   */
  getSettingValue(path) {
    const parts = path.split('.');
    let obj = this.settings;

    for (const part of parts) {
      if (obj === undefined || obj === null) return undefined;
      obj = obj[part];
    }

    return obj;
  }

  /**
   * Update the hasChanges state by comparing to original
   */
  updateChangesState() {
    this.hasChanges = JSON.stringify(this.settings) !== JSON.stringify(this.originalSettings);
  }

  /**
   * Deep merge two objects
   * @param {Object} target - Target object
   * @param {Object} source - Source object
   * @returns {Object} Merged object
   */
  deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
}
