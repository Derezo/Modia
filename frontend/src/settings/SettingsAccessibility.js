/**
 * @module SettingsAccessibility
 * @description Applies accessibility settings to the game.
 *
 * Key responsibilities:
 * - Apply colorblind filters
 * - Apply text size adjustments
 * - Apply font family changes
 * - Apply line spacing
 * - Apply high contrast mode
 * - Apply cursor size changes
 * - Apply screen reader hints
 * - Handle reduced motion preference
 *
 * @see SettingsScene.js - Main scene orchestration
 * @see SettingsStateManager.js - State and persistence
 * @see Game.js - Game instance with accessibility methods
 */

/**
 * Applies accessibility settings to the game
 */
export class SettingsAccessibility {
  /**
   * @param {Object} game - Game instance
   */
  constructor(game) {
    this.game = game;
  }

  /**
   * Apply all accessibility settings
   * @param {Object} accessibility - Accessibility settings object
   */
  applyAll(accessibility) {
    this.applyColorBlindFilter(accessibility.colorBlindMode);
    this.applyTextSize(accessibility.textSize);
    this.applyFontFamily(accessibility.fontFamily);
    this.applyLineSpacing(accessibility.lineSpacing);
    this.applyHighContrast(accessibility.highContrast);
    this.applyCursorSize(accessibility.cursorSize);
    this.applyScreenReaderHints(accessibility.screenReaderHints);
    this.applyReducedMotion(accessibility.reducedMotion);
  }

  /**
   * Apply colorblind filter - delegates to Game.js
   * @param {string} mode - 'none', 'protanopia', 'deuteranopia', 'tritanopia'
   */
  applyColorBlindFilter(mode) {
    if (this.game.applyColorBlindFilter) {
      this.game.applyColorBlindFilter(mode);
    }
  }

  /**
   * Apply text size setting - delegates to Game.js
   * @param {string} size - 'small', 'medium', 'large'
   */
  applyTextSize(size) {
    if (this.game.applyTextSize) {
      this.game.applyTextSize(size);
    }
  }

  /**
   * Apply font family setting - delegates to Game.js
   * @param {string} family - 'default', 'dyslexic', 'monospace'
   */
  applyFontFamily(family) {
    if (this.game.applyFontFamily) {
      this.game.applyFontFamily(family);
    }
  }

  /**
   * Apply line spacing setting - delegates to Game.js
   * @param {string} spacing - 'compact', 'normal', 'relaxed'
   */
  applyLineSpacing(spacing) {
    if (this.game.applyLineSpacing) {
      this.game.applyLineSpacing(spacing);
    }
  }

  /**
   * Apply high contrast mode - delegates to Game.js
   * @param {boolean} enabled - Whether high contrast mode is enabled
   */
  applyHighContrast(enabled) {
    if (this.game.applyHighContrast) {
      this.game.applyHighContrast(enabled);
    }
  }

  /**
   * Apply cursor size setting - delegates to Game.js
   * @param {string} size - 'small', 'normal', 'large'
   */
  applyCursorSize(size) {
    if (this.game.applyCursorSize) {
      this.game.applyCursorSize(size);
    }
  }

  /**
   * Apply screen reader hints setting - delegates to Game.js
   * @param {boolean} enabled - Whether screen reader hints are enabled
   */
  applyScreenReaderHints(enabled) {
    if (this.game.applyScreenReaderHints) {
      this.game.applyScreenReaderHints(enabled);
    }
  }

  /**
   * Apply reduced motion preference to game state
   * @param {boolean} enabled - Whether reduced motion is enabled
   */
  applyReducedMotion(enabled) {
    if (this.game.state) {
      this.game.state.set('reducedMotion', enabled);
    }
  }
}
